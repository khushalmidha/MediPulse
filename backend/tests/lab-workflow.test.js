import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import LabTestCatalog from "../model/labTestCatalog.js";
import LabOrder from "../model/labOrder.js";
import {
  generateAccessionBarcode,
  createLabOrder,
  clearOrderBilling,
  collectSample,
  rejectSample,
  enterLabResults,
  verifyLabResults,
  releaseLabResults,
  correctLabReport,
  acknowledgeCriticalValue,
  setLabTestDouble,
} from "../services/labService.js";

test("P15: Laboratory workflow, tenant isolation, critical values, and versioned reports", async (t) => {
  const hospitalA = new mongoose.Types.ObjectId();
  const hospitalB = new mongoose.Types.ObjectId();
  const doctorId = new mongoose.Types.ObjectId();
  const patientId = new mongoose.Types.ObjectId();

  setLabTestDouble({
    createLabOrder: async (params) => ({
      _id: new mongoose.Types.ObjectId(),
      hospitalId: params.hospitalId,
      patientInfo: params.patientInfo,
      tests: params.tests,
      orderStatus: "ordered",
      clinicalNotes: params.clinicalNotes,
      auditHistory: [{ stage: "ordered", actorName: params.actor?.name, timestamp: new Date() }],
    }),
    collectSample: async (params) => ({
      _id: params.orderId,
      hospitalId: params.hospitalId,
      orderStatus: "collected",
      accessionBarcode: params.customBarcode || generateAccessionBarcode(params.hospitalId),
    }),
    rejectSample: async (params) => ({
      _id: params.orderId,
      hospitalId: params.hospitalId,
      orderStatus: "rejected",
      rejectedReason: params.reason,
      recollectionRequested: params.requestRecollection,
    }),
    enterLabResults: async (params) => ({
      _id: params.orderId,
      hospitalId: params.hospitalId,
      orderStatus: "result_entered",
      results: params.results,
      criticalValueAlert: { isCritical: params.hasCritical },
    }),
    verifyLabResults: async (params) => ({
      _id: params.orderId,
      hospitalId: params.hospitalId,
      orderStatus: "verified",
    }),
    releaseLabResults: async (params) => ({
      _id: params.orderId,
      hospitalId: params.hospitalId,
      orderStatus: "released",
    }),
    correctLabReport: async (params) => ({
      _id: params.orderId,
      hospitalId: params.hospitalId,
      reportVersion: 2,
      orderStatus: "verified",
    }),
    acknowledgeCriticalValue: async (params) => ({
      _id: params.orderId,
      hospitalId: params.hospitalId,
      criticalValueAlert: { isCritical: true, acknowledgedBy: params.actor?.name || "Clinician" },
    }),
  });

  await t.test("barcode generator produces unique accession codes with hospital prefix", () => {
    const code1 = generateAccessionBarcode(hospitalA);
    const code2 = generateAccessionBarcode(hospitalA);
    assert.match(code1, /^LAB-[A-Z0-9]{4}-\d+$/);
    assert.notEqual(code1, code2);
  });

  await t.test("lab order creation validates patient info, test catalog, and tenant scoping", async () => {
    // Missing hospital tenant
    await assert.rejects(
      async () => {
        await createLabOrder({
          hospitalId: null,
          patientInfo: { name: "Rohan Patel" },
          tests: [{ testCode: "CBC", testName: "Complete Blood Count" }],
        });
      },
      { message: "Hospital tenant is required" }
    );

    // Missing patient info
    await assert.rejects(
      async () => {
        await createLabOrder({
          hospitalId: hospitalA,
          patientInfo: null,
          tests: [{ testCode: "CBC", testName: "Complete Blood Count" }],
        });
      },
      { message: "Patient information is required" }
    );

    // Valid order creation
    const order = await createLabOrder({
      hospitalId: hospitalA,
      patientId,
      patientInfo: { name: "Rohan Patel", age: 34, gender: "male" },
      orderingDoctorId: doctorId,
      orderingDoctorName: "Dr. Aarti Sharma",
      tests: [
        { testCode: "CBC", testName: "Complete Blood Count", category: "Hematology", priceMinor: 45000 },
        { testCode: "LFT", testName: "Liver Function Test", category: "Biochemistry", priceMinor: 65000 },
      ],
      clinicalNotes: "Fever and suspected jaundice",
      actor: { id: doctorId, name: "Dr. Aarti Sharma" },
    });

    assert.equal(order.orderStatus, "ordered");
    assert.equal(order.tests.length, 2);
    assert.equal(order.patientInfo.name, "Rohan Patel");
    assert.equal(String(order.hospitalId), String(hospitalA));
  });

  await t.test("sample collection assigns accession barcode and tracks phlebotomist", async () => {
    const orderId = new mongoose.Types.ObjectId();
    const collector = { id: new mongoose.Types.ObjectId(), name: "Sister Maria" };

    const collected = await collectSample({
      orderId,
      hospitalId: hospitalA,
      actor: collector,
      customBarcode: "LAB-HOSA-992144",
    });

    assert.equal(collected.orderStatus, "collected");
    assert.equal(collected.accessionBarcode, "LAB-HOSA-992144");
  });

  await t.test("sample rejection requires reason and supports recollection flagging", async () => {
    const orderId = new mongoose.Types.ObjectId();
    const labTech = { id: new mongoose.Types.ObjectId(), name: "Vikram Tech" };

    // Missing rejection reason
    await assert.rejects(
      async () => {
        await rejectSample({
          orderId,
          hospitalId: hospitalA,
          actor: labTech,
          reason: "",
        });
      },
      { message: "Reason for sample rejection is required" }
    );

    const rejected = await rejectSample({
      orderId,
      hospitalId: hospitalA,
      actor: labTech,
      reason: "Grossly hemolyzed specimen",
      requestRecollection: true,
    });

    assert.equal(rejected.orderStatus, "rejected");
    assert.equal(rejected.rejectedReason, "Grossly hemolyzed specimen");
    assert.equal(rejected.recollectionRequested, true);
  });

  await t.test("results entry triggers critical value alert when parameter is marked critical", async () => {
    const orderId = new mongoose.Types.ObjectId();
    const labTech = { id: new mongoose.Types.ObjectId(), name: "Vikram Tech" };

    const normalResults = [
      { parameterCode: "HB", parameterName: "Hemoglobin", value: 14.5, unit: "g/dL", flag: "normal" },
      { parameterCode: "WBC", parameterName: "Total Leukocyte Count", value: 7200, unit: "/cumm", flag: "normal" },
    ];

    const normalOrder = await enterLabResults({
      orderId,
      hospitalId: hospitalA,
      actor: labTech,
      results: normalResults,
    });
    assert.equal(normalOrder.orderStatus, "result_entered");
    assert.equal(normalOrder.criticalValueAlert.isCritical, false);

    // Critical potassium finding
    const criticalResults = [
      { parameterCode: "K", parameterName: "Serum Potassium", value: 6.8, unit: "mEq/L", flag: "critical_high" },
    ];

    const criticalOrder = await enterLabResults({
      orderId,
      hospitalId: hospitalA,
      actor: labTech,
      results: criticalResults,
    });
    assert.equal(criticalOrder.criticalValueAlert.isCritical, true);

    // Acknowledge critical alert
    const doctor = { id: doctorId, name: "Dr. Aarti Sharma" };
    const ack = await acknowledgeCriticalValue({
      orderId,
      hospitalId: hospitalA,
      actor: doctor,
    });
    assert.equal(ack.criticalValueAlert.acknowledgedBy, "Dr. Aarti Sharma");
  });

  await t.test("verification, release, and versioned report correction lifecycle", async () => {
    const orderId = new mongoose.Types.ObjectId();
    const supervisor = { id: new mongoose.Types.ObjectId(), name: "Dr. Sen (Chief Pathologist)" };

    const verified = await verifyLabResults({
      orderId,
      hospitalId: hospitalA,
      actor: supervisor,
    });
    assert.equal(verified.orderStatus, "verified");

    const released = await releaseLabResults({
      orderId,
      hospitalId: hospitalA,
      actor: supervisor,
    });
    assert.equal(released.orderStatus, "released");

    // Amendment / correction
    const corrected = await correctLabReport({
      orderId,
      hospitalId: hospitalA,
      actor: supervisor,
      reason: "Sample re-run on calibrated second analyzer",
      newResults: [
        { parameterCode: "K", parameterName: "Serum Potassium", value: 5.1, unit: "mEq/L", flag: "normal" },
      ],
    });

    assert.equal(corrected.reportVersion, 2);
    assert.equal(corrected.orderStatus, "verified");
  });

  await t.test("A05: lab service fails closed with 503 when disconnected and no test double is present", async () => {
    setLabTestDouble(null);
    await assert.rejects(
      async () => {
        await createLabOrder({
          hospitalId: hospitalA,
          patientInfo: { name: "Test Patient" },
          tests: [{ testCode: "CBC", testName: "Complete Blood Count" }],
        });
      },
      (err) => err.status === 503 && /Database service is unavailable/.test(err.message)
    );
  });
});
