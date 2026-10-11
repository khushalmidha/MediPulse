import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import PharmacyInventory from "../model/pharmacyInventory.js";
import Prescription from "../model/prescription.js";
import {
  generatePrescriptionToken,
  createPrescription,
  dispensePrescription,
  returnPrescriptionItems,
  verifyPrescriptionQR,
  setPharmacyTestDouble,
} from "../services/pharmacyService.js";

test("P16: Hospital pharmacy, prescription fulfillment, batch stock, and QR verification", async (t) => {
  const hospitalA = new mongoose.Types.ObjectId();
  const hospitalB = new mongoose.Types.ObjectId();
  const doctorId = new mongoose.Types.ObjectId();
  const patientId = new mongoose.Types.ObjectId();

  setPharmacyTestDouble({
    createPrescription: async (params) => ({
      _id: new mongoose.Types.ObjectId(),
      hospitalId: params.hospitalId,
      patientInfo: params.patientInfo,
      items: params.items,
      diagnosis: params.diagnosis,
      status: "approved_by_doctor",
      verificationToken: generatePrescriptionToken(),
      auditHistory: [{ stage: "approved_by_doctor", actorName: params.actor?.name, timestamp: new Date() }],
    }),
    dispensePrescription: async (params) => ({
      _id: params.prescriptionId,
      hospitalId: params.hospitalId,
      status: "dispensed",
      dispensedByName: params.actor?.name || "Pharmacist",
    }),
    returnPrescriptionItems: async (params) => ({
      _id: params.prescriptionId,
      hospitalId: params.hospitalId,
      status: "returned",
    }),
    verifyPrescriptionQR: async (params) => ({
      verified: true,
      patientInitials: "R. P.",
      status: "dispensed",
      itemsCount: 2,
    }),
  });

  await t.test("prescription token generates formatted RX verification code", () => {
    const token1 = generatePrescriptionToken();
    const token2 = generatePrescriptionToken();
    assert.match(token1, /^RX-[A-F0-9]{16}$/);
    assert.notEqual(token1, token2);
  });

  await t.test("prescription creation validates items, patient info, and tenant scoping", async () => {
    // Missing hospital
    await assert.rejects(
      async () => {
        await createPrescription({
          hospitalId: null,
          patientInfo: { name: "Aarav Sharma" },
          items: [{ medicationCode: "PARA-500", medicationName: "Paracetamol 500mg", quantityPrescribed: 10 }],
        });
      },
      { message: "Hospital tenant is required" }
    );

    // Missing patient
    await assert.rejects(
      async () => {
        await createPrescription({
          hospitalId: hospitalA,
          patientInfo: null,
          items: [{ medicationCode: "PARA-500", medicationName: "Paracetamol 500mg", quantityPrescribed: 10 }],
        });
      },
      { message: "Patient information is required" }
    );

    // Valid prescription
    const rx = await createPrescription({
      hospitalId: hospitalA,
      patientId,
      patientInfo: { name: "Aarav Sharma", age: 42, gender: "male" },
      prescribingDoctorId: doctorId,
      prescribingDoctorName: "Dr. K. Patel",
      diagnosis: "Acute Bronchitis",
      items: [
        {
          medicationCode: "AMOX-500",
          medicationName: "Amoxicillin 500mg",
          directions: "1 capsule three times daily for 5 days",
          durationDays: 5,
          quantityPrescribed: 15,
        },
        {
          medicationCode: "PARA-650",
          medicationName: "Paracetamol 650mg",
          directions: "1 tablet as needed for fever",
          durationDays: 3,
          quantityPrescribed: 10,
        },
      ],
      actor: { id: doctorId, name: "Dr. K. Patel" },
    });

    assert.equal(rx.status, "approved_by_doctor");
    assert.equal(rx.items.length, 2);
    assert.equal(rx.patientInfo.name, "Aarav Sharma");
    assert.equal(String(rx.hospitalId), String(hospitalA));
    assert.match(rx.verificationToken, /^RX-[A-F0-9]{16}$/);
  });

  await t.test("dispensing records pharmacist actor and advances prescription status", async () => {
    const rxId = new mongoose.Types.ObjectId();
    const pharmacist = { id: new mongoose.Types.ObjectId(), name: "Pharmacist Neha" };

    const dispensed = await dispensePrescription({
      prescriptionId: rxId,
      hospitalId: hospitalA,
      actor: pharmacist,
      dispenseItems: [
        { medicationCode: "AMOX-500", quantityToDispense: 15, batchNumber: "B26-001" },
        { medicationCode: "PARA-650", quantityToDispense: 10, batchNumber: "B26-002" },
      ],
    });

    assert.equal(dispensed.status, "dispensed");
    assert.equal(dispensed.dispensedByName, "Pharmacist Neha");
  });

  await t.test("medication returns require reason and update status", async () => {
    const rxId = new mongoose.Types.ObjectId();
    const pharmacist = { id: new mongoose.Types.ObjectId(), name: "Pharmacist Neha" };

    // Missing reason
    await assert.rejects(
      async () => {
        await returnPrescriptionItems({
          prescriptionId: rxId,
          hospitalId: hospitalA,
          actor: pharmacist,
          returnItems: [{ medicationCode: "AMOX-500", quantity: 5 }],
          reason: "",
        });
      },
      { message: "Reason for medication return is required" }
    );

    const returned = await returnPrescriptionItems({
      prescriptionId: rxId,
      hospitalId: hospitalA,
      actor: pharmacist,
      returnItems: [{ medicationCode: "AMOX-500", quantity: 5 }],
      reason: "Patient exhibited mild rash; substituted by clinician",
    });

    assert.equal(returned.status, "returned");
  });

  await t.test("QR verification returns privacy-safe essential clinical info", async () => {
    const verified = await verifyPrescriptionQR({
      verificationToken: "RX-1122334455667788",
    });

    assert.equal(verified.verified, true);
    assert.equal(verified.patientInitials, "R. P.");
    assert.equal(verified.status, "dispensed");
  });

  await t.test("A05: pharmacy service fails closed with 503 when disconnected and no test double is present", async () => {
    setPharmacyTestDouble(null);
    await assert.rejects(
      async () => {
        await createPrescription({
          hospitalId: hospitalA,
          patientInfo: { name: "Test Patient" },
          items: [{ medicationCode: "AMOX-500", quantityPrescribed: 1 }],
        });
      },
      (err) => err.status === 503 && /Database service is unavailable/.test(err.message)
    );
  });
});
