import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import { Ward, Room, Bed, IpdAdmission } from "../../model/inpatient.js";
import {
  InpatientOrder,
  NursingVitals,
  MedicationAdministrationRecord,
  NurseShiftHandover,
} from "../../model/nursingCare.js";
import { localTestTargets } from "../../util/testTargets.js";
import {
  createInpatientOrder,
  discontinueInpatientOrder,
  recordNursingVitals,
  administerMedication,
  recordMedicationOmission,
  recordShiftHandover,
  getInpatientFlowsheet,
} from "../../services/nursingCareService.js";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import AuthSession from "../../model/authSession.js";
import nursingRouter from "../../routes/nursingCare.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_nursing_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id();
const departmentId = id();
const doctorId = id();
const nurse1Id = id();
const nurse2Id = id();
const patientId = id();
const wardId = id();
const roomId = id();
const bedId = id();
let admissionId;
let db;

before(async (t) => {
  try {
    await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 3000 });
    db = mongoose.connection.db;
  } catch {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
  }
});

after(async () => {
  await db?.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!db) return;
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
    await db.collection(collection.name).deleteMany({});
  }

  await Hospital.create({
    _id: hospitalId,
    name: "Max Super Specialty Enterprise Hospital",
    slug: "max-super",
    registrationNumber: "REG-MAX-001",
    type: "private",
    email: "max-super@example.test",
    address: { city: "New Delhi", state: "Delhi" },
    status: "active",
    subscription: { plan: "enterprise", status: "active" },
  });

  await Department.create({
    _id: departmentId,
    hospitalId,
    name: "Internal Medicine",
    code: "MED-INT",
    status: "active",
    opd: { consultationFee: 500, isActive: true },
  });

  await Doctor.create({
    _id: doctorId,
    firstName: "Deepak",
    lastName: "Mehta",
    email: "deepak.mehta@max.test",
    password: "Password@123",
    gender: "male",
    specialization: "General Medicine",
    experience: { years: 14, expertise: "General Medicine" },
  });

  await HospitalStaff.create([
    {
      _id: nurse1Id,
      hospitalId,
      departmentIds: [departmentId],
      name: "Staff Nurse Priya Nair",
      email: "priya.nair@max.test",
      role: "NURSE",
      isActive: true,
    },
    {
      _id: nurse2Id,
      hospitalId,
      departmentIds: [departmentId],
      name: "Charge Nurse Anjali Sharma",
      email: "anjali.sharma@max.test",
      role: "NURSE",
      isActive: true,
    },
  ]);

  await User.create({
    _id: patientId,
    firstName: "Vikramaditya",
    lastName: "Rao",
    email: "vikram.rao@test.org",
    password: "Password@123",
    gender: "male",
    phoneNumber: 9123456789,
  });

  await Ward.create({
    _id: wardId,
    hospitalId,
    name: "Medical HDU",
    code: "WARD-HDU",
  });

  await Room.create({
    _id: roomId,
    hospitalId,
    wardId,
    roomNumber: "HDU-01",
  });

  await Bed.create({
    _id: bedId,
    hospitalId,
    wardId,
    roomId,
    bedNumber: "HDU-BED-01",
    status: "occupied",
  });

  const adm = await IpdAdmission.create({
    hospitalId,
    admissionNumber: "IPD-MAX-1001",
    patientId,
    admittingDoctorId: doctorId,
    departmentId,
    currentWardId: wardId,
    currentRoomId: roomId,
    currentBedId: bedId,
    admittingDiagnosis: "Community-Acquired Lobar Pneumonia with Sepsis",
    status: "admitted",
  });
  admissionId = adm._id;
});

test("Task AG19: Inpatient Clinical Orders, Nursing and Medication Administration (Integration)", async (t) => {
  if (!db) {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
    return;
  }

  await t.test("1. Clinician order creation automatically schedules eMAR doses in MongoDB", async () => {
    const res = await createInpatientOrder({
      hospitalId,
      admissionId,
      patientId,
      orderType: "medication",
      medicationDetails: {
        drugName: "Piperacillin-Tazobactam",
        dose: "4.5g",
        route: "iv",
        frequency: "tds", // every 8h
        durationDays: 3,
      },
      nursingInstructions: "Infuse over 4 hours (extended infusion)",
      actor: { doctorId },
    });

    assert.equal(res.success, true);
    assert.equal(res.order.medicationDetails.drugName, "Piperacillin-Tazobactam");
    // 3 days * 3 doses/day = 9 scheduled doses
    assert.equal(res.scheduledDosesCount, 9);

    const savedEmars = await MedicationAdministrationRecord.find({ orderId: res.order._id });
    assert.equal(savedEmars.length, 9);
    assert.ok(savedEmars.every((e) => e.status === "scheduled"));
  });

  await t.test("2. Nursing vitals calculation correctly records NEWS2 and triggers doctor escalation", async () => {
    // Vitals with severe tachypnea and hypoxia
    const vitals = {
      respirationRate: 26, // 3
      spO2: 91,            // 3
      supplementalOxygen: true, // 2
      systolicBP: 95,      // 2
      pulse: 115,          // 2
      consciousness: "A",  // 0
      temperature: 38.5,   // 1
      painScore: 4,
    };

    const res = await recordNursingVitals({
      hospitalId,
      admissionId,
      vitals,
      actor: { staffId: nurse1Id },
    });

    assert.equal(res.success, true);
    assert.ok(res.news2.score >= 7);
    assert.equal(res.news2.riskLevel, "HIGH");
    assert.equal(res.news2.requiresCodeBlue, true);

    const savedVitals = await NursingVitals.findById(res.vitals._id);
    assert.ok(savedVitals);
    assert.equal(savedVitals.news2.requiresDoctorEscalation, true);
  });

  await t.test("3. eMAR administration enforces 5 rights and dual-nurse witness on controlled substances", async () => {
    // Order Fentanyl (Schedule X Narcotic)
    const orderRes = await createInpatientOrder({
      hospitalId,
      admissionId,
      patientId,
      orderType: "medication",
      medicationDetails: {
        drugName: "Fentanyl Citrate",
        dose: "50mcg",
        route: "iv",
        frequency: "stat",
        isControlledSubstance: true,
      },
      actor: { doctorId },
    });

    const emar = await MedicationAdministrationRecord.findOne({ orderId: orderRes.order._id });
    assert.ok(emar);

    // Missing dual witness on narcotic -> Fails
    await assert.rejects(
      () =>
        administerMedication({
          hospitalId,
          emarId: emar._id,
          fiveRightsVerified: {
            rightPatient: true,
            rightDrug: true,
            rightDose: true,
            rightRoute: true,
            rightTime: true,
          },
          actor: { staffId: nurse1Id },
        }),
      /Mandatory dual-nurse verification missing/
    );

    // Legitimate administration with secondary nurse witness
    await assert.rejects(administerMedication({
      hospitalId,
      emarId: emar._id,
      fiveRightsVerified: {
        rightPatient: true,
        rightDrug: true,
        rightDose: true,
        rightRoute: true,
        rightTime: true,
      },
      dualWitnessStaffId: nurse2Id,
      dualWitnessSignature: "Charge Nurse Anjali Sharma RN",
      actor: { staffId: nurse1Id },
    }), error => error.status === 503 && /authenticated medication witness/.test(error.message));

    const updated = await MedicationAdministrationRecord.findById(emar._id);
    assert.equal(updated.status, "scheduled");
    assert.equal(updated.dualWitnessStaffId, null);
  });

  await t.test("4. Shift handover logs structured summary and critical alerts", async () => {
    await createInpatientOrder({
      hospitalId,
      admissionId,
      patientId,
      orderType: "medication",
      medicationDetails: {
        drugName: "Piperacillin-Tazobactam",
        dose: "4.5g",
        route: "iv",
        frequency: "tds",
        durationDays: 3,
      },
      nursingInstructions: "Infuse over 4 hours (extended infusion)",
      actor: { doctorId },
    });

    const handover = await recordShiftHandover({
      hospitalId,
      wardId,
      shiftDate: "2026-10-22",
      shiftType: "evening",
      outgoingNurseStaffId: nurse1Id,
      incomingNurseStaffId: nurse2Id,
      patientSummaries: [
        {
          admissionId,
          bedNumber: "HDU-BED-01",
          patientName: "Vikramaditya Rao",
          diagnosis: "Lobar Pneumonia",
          news2Score: 7,
          pendingTasks: ["Repeat ABG at 20:00", "Monitor SpO2 on 4L nasal cannula"],
          criticalAlerts: "High NEWS2 score, Code Blue outreach notified",
        },
      ],
      codeBlueEvents: [],
      handoverNotes: "Patient required non-rebreather mask escalation during afternoon shift.",
      actor: { staffId: nurse1Id },
    });

    assert.equal(handover.success, true);
    assert.equal(handover.criticalPatientsCount, 1);

    const savedHandover = await NurseShiftHandover.findById(handover.handover._id);
    assert.ok(savedHandover);
    assert.equal(savedHandover.shiftType, "evening");

    // Flowsheet check
    const flowsheet = await getInpatientFlowsheet({ hospitalId, admissionId });
    assert.ok(flowsheet.activeOrders.length >= 1);
  });

  await t.test("5. Nursing HTTP router integration: authentication, role gating, eMAR bedside verification, and tenant isolation", async () => {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use("/api/nursing", nursingRouter);
    app.use((error, req, res, next) => {
      const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : error.code === 11000 ? 409 : 500);
      res.status(status).json({ message: status < 500 ? error.message : "Request could not be completed" });
    });

    const server = app.listen(0);
    await once(server, "listening");
    const apiOrigin = `http://127.0.0.1:${server.address().port}`;

    try {
      const foreignHospitalId = id();
      await Hospital.create({
        _id: foreignHospitalId,
        name: "Foreign General Hospital",
        slug: "foreign-general-" + crypto.randomBytes(4).toString("hex"),
        registrationNumber: "REG-FOR-" + crypto.randomBytes(4).toString("hex"),
        type: "private",
        email: "foreign@general.test",
        address: { city: "Bengaluru", state: "Karnataka" },
        status: "active",
        subscription: { plan: "enterprise", status: "active" },
      });

      const createStaffSession = async ({ role, adminAccess = false, hId = hospitalId }) => {
        const staffMember = await HospitalStaff.create({
          hospitalId: hId,
          departmentIds: [departmentId],
          name: `Staff Member ${role}`,
          email: `staff.${role.toLowerCase()}.${crypto.randomBytes(4).toString("hex")}@max.test`,
          role,
          adminAccess,
          isActive: true,
          inviteStatus: "accepted",
        });
        const sid = crypto.randomUUID();
        await AuthSession.create({
          _id: sid,
          principalId: staffMember._id,
          kind: "staff",
          authVersion: 0,
          csrfToken: "csrf-token-test",
          expiresAt: new Date(Date.now() + 600000),
        });
        const token = jwt.sign(
          { id: String(staffMember._id), sid, role, type: "staff", hospitalId: String(hId) },
          process.env.TOKEN_KEY || "local-development-signing-key-replace-before-production"
        );
        return { staff: staffMember, token };
      };

      const { token: adminToken } = await createStaffSession({ role: "HOSPITAL_ADMIN", adminAccess: true });
      const { token: doctorToken, staff: staffDoc } = await createStaffSession({ role: "DOCTOR" });
      const { token: nurseToken, staff: staffNurse1 } = await createStaffSession({ role: "NURSE" });
      const { token: witnessNurseToken, staff: staffNurse2 } = await createStaffSession({ role: "NURSE" });
      const { token: pharmacistToken } = await createStaffSession({ role: "PHARMACIST" });
      const { token: foreignToken } = await createStaffSession({ role: "HOSPITAL_ADMIN", adminAccess: true, hId: foreignHospitalId });

      const request = async (path, { method = "GET", token, body } = {}) => {
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${apiOrigin}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
      };

      // 1. Unauthenticated request -> 401
      const unauth = await request("/api/nursing/orders");
      assert.equal(unauth.status, 401);

      // 2. Nurse attempting to prescribe orders -> 403 (orders require DOCTOR or HOSPITAL_ADMIN)
      const nursePrescribe = await request("/api/nursing/orders", {
        method: "POST",
        token: nurseToken,
        body: { admissionId, orderType: "medication", medicationDetails: { drugName: "Amoxicillin", dose: "500mg" } },
      });
      assert.equal(nursePrescribe.status, 403);

      // 3. Doctor creating Inpatient Medication Order -> 201
      const orderRes = await request("/api/nursing/orders", {
        method: "POST",
        token: doctorToken,
        body: {
          admissionId,
          orderType: "medication",
          medicationDetails: {
            drugName: "Meropenem",
            dose: "1g",
            route: "iv",
            frequency: "tds",
            durationDays: 2,
            isControlledSubstance: false,
          },
          nursingInstructions: "Administer via slow IV bolus",
        },
      });
      assert.equal(orderRes.status, 201);
      assert.equal(orderRes.data.success, true);
      assert.equal(orderRes.data.order.medicationDetails.drugName, "Meropenem");
      const orderId = orderRes.data.order._id;
      // 2 days * 3 doses/day = 6 scheduled doses
      assert.equal(orderRes.data.scheduledDosesCount, 6);

      // 4. Query orders via HTTP -> 200
      const listOrders = await request(`/api/nursing/orders?admissionId=${admissionId}`, { token: nurseToken });
      assert.equal(listOrders.status, 200);
      assert.ok(listOrders.data.orders.some((o) => o._id === orderId));

      // 5. Query flowsheet via HTTP -> 200
      const flowsheetRes = await request(`/api/nursing/admissions/${admissionId}/flowsheet`, { token: nurseToken });
      assert.equal(flowsheetRes.status, 200);
      assert.ok(flowsheetRes.data.activeOrders.length >= 1);
      assert.ok(flowsheetRes.data.emarSchedule.length >= 6);
      const scheduledEmar = flowsheetRes.data.emarSchedule.find((e) => e.orderId._id === orderId && e.status === "scheduled");
      assert.ok(scheduledEmar);

      // 6. Doctor attempting to administer medication -> 403 (bedside administration is strictly NURSE role)
      const docAdmin = await request(`/api/nursing/emar/${scheduledEmar._id}/administer`, {
        method: "POST",
        token: doctorToken,
        body: {
          fiveRightsVerified: { rightPatient: true, rightDrug: true, rightDose: true, rightRoute: true, rightTime: true },
        },
      });
      assert.equal(docAdmin.status, 403);

      // 7. Nurse administers medication without complete 5-rights -> 400
      const badRightsAdmin = await request(`/api/nursing/emar/${scheduledEmar._id}/administer`, {
        method: "POST",
        token: nurseToken,
        body: {
          fiveRightsVerified: { rightPatient: false, rightDrug: true, rightDose: true, rightRoute: true, rightTime: true },
        },
      });
      assert.equal(badRightsAdmin.status, 400);

      // 8. Nurse administers medication with complete 5-rights -> 200
      const validAdmin = await request(`/api/nursing/emar/${scheduledEmar._id}/administer`, {
        method: "POST",
        token: nurseToken,
        body: {
          fiveRightsVerified: { rightPatient: true, rightDrug: true, rightDose: true, rightRoute: true, rightTime: true },
          injectionSite: "Left forearm IV cannula",
        },
      });
      assert.equal(validAdmin.status, 200);
      assert.equal(validAdmin.data.success, true);
      assert.equal(validAdmin.data.emar.status, "administered");

      // 9. Replay attempt on already administered dose -> 404
      const replayAdmin = await request(`/api/nursing/emar/${scheduledEmar._id}/administer`, {
        method: "POST",
        token: nurseToken,
        body: {
          fiveRightsVerified: { rightPatient: true, rightDrug: true, rightDose: true, rightRoute: true, rightTime: true },
        },
      });
      assert.equal(replayAdmin.status, 404);

      // 10. Nurse records high-frequency vitals triggering NEWS2 code escalation -> 201
      const vitalsRes = await request(`/api/nursing/admissions/${admissionId}/vitals`, {
        method: "POST",
        token: nurseToken,
        body: {
          vitals: {
            respirationRate: 28,
            spO2: 90,
            supplementalOxygen: true,
            systolicBP: 85,
            pulse: 125,
            consciousness: "V",
            temperature: 39.0,
            painScore: 6,
          },
        },
      });
      assert.equal(vitalsRes.status, 201);
      assert.equal(vitalsRes.data.success, true);
      assert.ok(vitalsRes.data.news2.score >= 7);
      assert.equal(vitalsRes.data.news2.requiresCodeBlue, true);

      // 11. Controlled Substance (Fentanyl) requires dual-nurse witness
      const narcoticOrderRes = await request("/api/nursing/orders", {
        method: "POST",
        token: doctorToken,
        body: {
          admissionId,
          orderType: "medication",
          medicationDetails: {
            drugName: "Fentanyl IV",
            dose: "25mcg",
            route: "iv",
            frequency: "stat",
            isControlledSubstance: true,
          },
        },
      });
      assert.equal(narcoticOrderRes.status, 201);
      const narcoticOrderId = narcoticOrderRes.data.order._id;

      const flowsheetNarcotic = await request(`/api/nursing/admissions/${admissionId}/flowsheet`, { token: nurseToken });
      const narcoticEmar = flowsheetNarcotic.data.emarSchedule.find((e) => e.orderId._id === narcoticOrderId && e.status === "scheduled");
      assert.ok(narcoticEmar);

      // Missing secondary witness -> 403
      const missingWitnessRes = await request(`/api/nursing/emar/${narcoticEmar._id}/administer`, {
        method: "POST",
        token: nurseToken,
        body: {
          fiveRightsVerified: { rightPatient: true, rightDrug: true, rightDose: true, rightRoute: true, rightTime: true },
        },
      });
      assert.equal(missingWitnessRes.status, 403);

      // Self-witnessing attempt -> 403
      const selfWitnessRes = await request(`/api/nursing/emar/${narcoticEmar._id}/administer`, {
        method: "POST",
        token: nurseToken,
        body: {
          fiveRightsVerified: { rightPatient: true, rightDrug: true, rightDose: true, rightRoute: true, rightTime: true },
          dualWitnessStaffId: staffNurse1._id, // same nurse!
          dualWitnessSignature: "Staff Nurse Priya",
        },
      });
      assert.equal(selfWitnessRes.status, 403);

      // Valid administration with secondary nurse witness -> 200
      const validNarcoticAdmin = await request(`/api/nursing/emar/${narcoticEmar._id}/administer`, {
        method: "POST",
        token: nurseToken,
        body: {
          fiveRightsVerified: { rightPatient: true, rightDrug: true, rightDose: true, rightRoute: true, rightTime: true },
          dualWitnessStaffId: staffNurse2._id,
          dualWitnessSignature: "Charge Nurse Anjali Sharma RN",
        },
      });
      assert.equal(validNarcoticAdmin.status, 503);
      assert.equal((await MedicationAdministrationRecord.findById(narcoticEmar._id)).status, "scheduled");

      // 12. Medication Omission / Refusal logging via HTTP -> 200
      const nextScheduledDose = flowsheetNarcotic.data.emarSchedule.find(
        (e) => e.orderId._id === orderId && e.status === "scheduled" && e._id !== scheduledEmar._id
      );
      assert.ok(nextScheduledDose);

      const omitRes = await request(`/api/nursing/emar/${nextScheduledDose._id}/omit`, {
        method: "POST",
        token: nurseToken,
        body: {
          omissionReason: "fasting_for_procedure",
          omissionNote: "NPO for emergency CT scan",
        },
      });
      assert.equal(omitRes.status, 200);
      assert.equal(omitRes.data.emar.status, "omitted");
      assert.equal(omitRes.data.emar.omissionReason, "fasting_for_procedure");

      // 13. Order Discontinuation cancels future scheduled doses -> 200
      const discRes = await request(`/api/nursing/orders/${orderId}/discontinue`, {
        method: "POST",
        token: doctorToken,
        body: { reason: "De-escalated to oral amoxicillin-clavulanate" },
      });
      assert.equal(discRes.status, 200);
      assert.equal(discRes.data.order.status, "discontinued");
      assert.ok(discRes.data.cancelledDosesCount >= 1);

      // 14. Structured Shift Handover via HTTP -> 201
      const handoverRes = await request("/api/nursing/handover", {
        method: "POST",
        token: nurseToken,
        body: {
          wardId,
          shiftDate: "2026-10-22",
          shiftType: "night",
          outgoingNurseStaffId: staffNurse1._id,
          incomingNurseStaffId: staffNurse2._id,
          patientSummaries: [
            {
              admissionId,
              bedNumber: "HDU-BED-01",
              patientName: "Vikramaditya Rao",
              diagnosis: "Lobar Pneumonia",
              news2Score: 8,
              pendingTasks: ["Repeat blood gas at 02:00"],
              criticalAlerts: "NEWS2 8 - Code Blue alert active",
            },
          ],
          codeBlueEvents: [],
          handoverNotes: "Night shift handover complete; high acuity monitoring active.",
        },
      });
      assert.equal(handoverRes.status, 201);
      assert.equal(handoverRes.data.handover.shiftType, "night");
      assert.equal(handoverRes.data.criticalPatientsCount, 1);

      // 15. Query Handovers via HTTP -> 200
      const listHandovers = await request(`/api/nursing/handovers?wardId=${wardId}&shiftDate=2026-10-22`, { token: nurseToken });
      assert.equal(listHandovers.status, 200);
      assert.ok(listHandovers.data.handovers.length >= 1);

      // 16. Tenant Boundary Isolation: Foreign Hospital staff cannot view or access admissions of Hospital 1
      const foreignFlowsheet = await request(`/api/nursing/admissions/${admissionId}/flowsheet`, { token: foreignToken });
      assert.equal(foreignFlowsheet.status, 200);
      assert.equal(foreignFlowsheet.data.activeOrders.length, 0);
      assert.equal(foreignFlowsheet.data.vitalsHistory.length, 0);
      assert.equal(foreignFlowsheet.data.emarSchedule.length, 0);

      const foreignPrescribe = await request("/api/nursing/orders", {
        method: "POST",
        token: foreignToken,
        body: {
          admissionId,
          orderType: "medication",
          medicationDetails: { drugName: "Foreign Med", dose: "100mg" },
        },
      });
      assert.equal(foreignPrescribe.status, 404);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});



test("AG19 review: string checks and inactive source orders cannot authorize a dose", async () => {
  assert.ok(db, "Isolated Mongo is required");
  const made = await createInpatientOrder({ hospitalId, admissionId, patientId, orderType: "medication", medicationDetails: { drugName: "Synthetic item", dose: "Recorded dose", frequency: "stat" }, actor: { doctorId } });
  const emar = await MedicationAdministrationRecord.findOne({ orderId: made.order._id });
  const input = { hospitalId, emarId: emar._id, actor: { staffId: nurse1Id }, fiveRightsVerified: { rightPatient: true, rightDrug: true, rightDose: true, rightRoute: true, rightTime: true } };
  await assert.rejects(administerMedication({ ...input, fiveRightsVerified: { ...input.fiveRightsVerified, rightPatient: "false" } }), error => error.status === 400);
  await InpatientOrder.updateOne({ _id: made.order._id }, { $set: { status: "discontinued" } });
  await assert.rejects(administerMedication(input), error => error.status === 409);
  assert.equal((await MedicationAdministrationRecord.findById(emar._id)).status, "scheduled");
});
