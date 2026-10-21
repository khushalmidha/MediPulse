import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { localTestTargets } from "../../util/testTargets.js";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import Doctor from "../../model/doctor.js";
import User from "../../model/user.js";
import OpdToken from "../../model/opdToken.js";
import Appointment from "../../model/appointment.js";
import EncounterJourney from "../../model/encounterJourney.js";
import BookingOperation from "../../model/bookingOperation.js";
import Wallet from "../../model/wallet.js";
import VirtualTransaction from "../../model/virtualTransaction.js";
import { CareSession, CareSlot, CareReservation, ScheduleOperation } from "../../model/scheduling.js";
import { queueContext, patientKey, localServiceDate } from "../../services/queueContext.js";
import { createQueueBooking, resumeQueueBooking, findBookingReplay } from "../../services/queueBooking.js";
import { confirmCareReservation } from "../../services/scheduling.js";
import { transitionVisit } from "../../services/visitTransitions.js";
import {
  initializeEncounterJourney,
  getEncounterGuidance,
} from "../../services/encounterJourneyService.js";
import { applyClinicalSchema } from "../../services/clinicalSchema.js";

const targets = localTestTargets();
const suffix = crypto.randomBytes(6).toString("hex");
const uri = new URL(targets.mongo);
uri.pathname = `/medipulse_test_encounter_recovery_${suffix}`;

let hospital, department, staffDoctor, platformDoctor, receptionistStaff;
const today = localServiceDate(new Date(), "Asia/Kolkata");
const id = () => new mongoose.Types.ObjectId();

const createPatient = async (pTag) => {
  const user = await User.create({
    firstName: "Patient",
    lastName: pTag,
    email: `patient.${pTag}.${suffix}@example.com`,
    password: "Password@123",
    role: "user",
    gender: "male",
    phone: "9876543210",
  });
  await Wallet.create({
    userId: user._id,
    userRole: "user",
    balance: 1000,
    balanceMinor: 100000,
    totalSent: 0,
    totalSentMinor: 0,
    totalReceived: 0,
    totalReceivedMinor: 0,
    currency: "INR",
    status: "active",
    initialCreditApplied: true,
  });
  return user;
};

before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });

  await Promise.all([
    Hospital.createIndexes(),
    Department.createIndexes(),
    HospitalStaff.createIndexes(),
    Doctor.createIndexes(),
    User.createIndexes(),
    OpdToken.createIndexes(),
    Appointment.createIndexes(),
    EncounterJourney.createIndexes(),
    BookingOperation.createIndexes(),
    Wallet.createIndexes(),
    VirtualTransaction.createIndexes(),
    CareSession.createIndexes(),
    CareSlot.createIndexes(),
    CareReservation.createIndexes(),
    ScheduleOperation.createIndexes(),
  ]);
  await applyClinicalSchema();

  hospital = await Hospital.create({
    name: "Recovery Test Hospital",
    slug: `hosp-${suffix}`,
    registrationNumber: `REG-${suffix}`,
    email: `hosp.${suffix}@example.com`,
    type: "clinic",
    status: "active",
    address: { street: "123 Main St", city: "Mumbai", state: "MH", postalCode: "400001", country: "IN" },
    settings: { timezone: "Asia/Kolkata", tokenPrefix: "T", queueSessionIds: ["day", "morn"] },
  });

  department = await Department.create({
    hospitalId: hospital._id,
    name: "General Medicine",
    slug: "general-medicine",
    status: "active",
    opd: { consultationFee: 100, isAvailable: true },
  });

  platformDoctor = await Doctor.create({
    firstName: "Priya",
    lastName: "Verma",
    email: `dr.verma.${suffix}@example.com`,
    password: "Password@123",
    role: "doctor",
    gender: "other",
    experience: { years: 10, expertise: "General Medicine" },
    consultationFee: 100,
    licenseNumber: `LIC-${suffix}`,
    doctorProfile: { consultationFee: 100 },
    queueTimezone: "Asia/Kolkata",
    queueSessionIds: ["day", "morn"],
  });

  staffDoctor = await HospitalStaff.create({
    hospitalId: hospital._id,
    departmentIds: [department._id],
    doctorId: platformDoctor._id,
    name: "Priya Verma",
    firstName: "Priya",
    lastName: "Verma",
    email: `staff.dr.${suffix}@example.com`,
    password: "Password@123",
    role: "DOCTOR",
    isActive: true,
    inviteStatus: "accepted",
    doctorProfile: { consultationFee: 100 },
  });

  receptionistStaff = await HospitalStaff.create({
    hospitalId: hospital._id,
    departmentIds: [department._id],
    name: "Rita Desk",
    firstName: "Rita",
    lastName: "Desk",
    email: `reception.${suffix}@example.com`,
    password: "Password@123",
    role: "RECEPTIONIST",
    isActive: true,
    inviteStatus: "accepted",
  });

  await Wallet.create({
    userId: platformDoctor._id,
    userRole: "doctor",
    balance: 0,
    balanceMinor: 0,
    totalSent: 0,
    totalSentMinor: 0,
    totalReceived: 0,
    totalReceivedMinor: 0,
    currency: "INR",
    status: "active",
  });
});

after(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

let test1Patient;
let test2Patient;

test("AG02: immediate hospital booking creates OpdToken, Appointment, and exactly one EncounterJourney bound to tenant, department, personKey and token", async () => {
  test1Patient = await createPatient("p1");
  const context = queueContext({
    hospital,
    doctorId: staffDoctor._id,
    sessionId: "day",
    serviceDate: today,
  });
  const person = patientKey(test1Patient._id);
  const requestKey = `req-book-${suffix}-1`;
  const request = {
    actorKey: `patient:${test1Patient._id}`,
    kind: "opd",
    requestKey,
    fingerprint: crypto.randomBytes(16).toString("hex"),
  };

  const result = await createQueueBooking({
    request,
    context,
    personKey: person,
    fee: 100,
    payerId: test1Patient._id,
    receiverId: platformDoctor._id,
    tokenData: {
      hospitalId: hospital._id,
      departmentId: department._id,
      doctorId: staffDoctor._id,
      patientId: test1Patient._id,
      patientInfo: { name: "Patient p1", phone: "9876543210", isWalkIn: false },
      visitType: "new",
      chiefComplaint: "Fever and cough",
      visitMode: "in_person",
      tokenPrefix: "T",
      paymentAmount: 100,
      paymentMode: "wallet",
    },
    appointmentData: {
      doctor: platformDoctor._id,
      user: test1Patient._id,
      visitMode: "in_person",
      roomId: `room-${id()}`,
    },
  });

  assert.equal(result.operation.state, "completed");
  assert.ok(result.token, "Token must be created");
  assert.ok(result.appointment, "Appointment must be created");

  // Verify exactly one encounter journey was created in the booking transaction
  const encounters = await EncounterJourney.find({ tokenId: result.token._id });
  assert.equal(encounters.length, 1, "Must have exactly one encounter journey");

  const encounter = encounters[0];
  assert.equal(String(encounter.hospitalId), String(hospital._id));
  assert.equal(String(encounter.departmentId), String(department._id));
  assert.equal(String(encounter.tokenId), String(result.token._id));
  assert.equal(String(encounter.appointmentId), String(result.appointment._id));
  assert.equal(String(encounter.patientId), String(test1Patient._id));
  assert.equal(encounter.personKey, person);
  assert.equal(encounter.isWalkIn, false);
  assert.equal(encounter.currentStage, "booked");
  assert.ok(encounter.qrPayload, "QR payload must be generated");
});

test("AG02: concurrent duplicate booking requests with identical request key yield one encounter and no second debit", async () => {
  test2Patient = await createPatient("p2");
  const context = queueContext({
    hospital,
    doctorId: staffDoctor._id,
    sessionId: "day",
    serviceDate: today,
  });
  const person = patientKey(test2Patient._id);
  const requestKey = `req-concurrent-${suffix}-2`;
  const fingerprint = crypto.randomBytes(16).toString("hex");

  const makeRequest = () => ({
    actorKey: `patient:${test2Patient._id}`,
    kind: "opd",
    requestKey,
    fingerprint,
  });

  const walletBefore = await Wallet.findOne({ userId: test2Patient._id, userRole: "user" });

  // Fire two concurrent booking requests with the same Idempotency-Key
  const [res1, res2] = await Promise.all([
    createQueueBooking({
      request: makeRequest(),
      context,
      personKey: person,
      fee: 100,
      payerId: test2Patient._id,
      receiverId: platformDoctor._id,
      tokenData: {
        hospitalId: hospital._id,
        departmentId: department._id,
        doctorId: staffDoctor._id,
        patientId: test2Patient._id,
        patientInfo: { name: "Patient p2", phone: "9876543210", isWalkIn: false },
        visitType: "new",
        chiefComplaint: "Follow-up check",
        visitMode: "in_person",
        tokenPrefix: "T",
        paymentAmount: 100,
        paymentMode: "wallet",
      },
      appointmentData: {
        doctor: platformDoctor._id,
        user: test2Patient._id,
        visitMode: "in_person",
        roomId: `room-${id()}`,
      },
    }),
    createQueueBooking({
      request: makeRequest(),
      context,
      personKey: person,
      fee: 100,
      payerId: test2Patient._id,
      receiverId: platformDoctor._id,
      tokenData: {
        hospitalId: hospital._id,
        departmentId: department._id,
        doctorId: staffDoctor._id,
        patientId: test2Patient._id,
        patientInfo: { name: "Patient p2", phone: "9876543210", isWalkIn: false },
        visitType: "new",
        chiefComplaint: "Follow-up check",
        visitMode: "in_person",
        tokenPrefix: "T",
        paymentAmount: 100,
        paymentMode: "wallet",
      },
      appointmentData: {
        doctor: platformDoctor._id,
        user: test2Patient._id,
        visitMode: "in_person",
        roomId: `room-${id()}`,
      },
    }),
  ]);

  // Both calls resolve
  assert.equal(res1.operation.state, "completed");
  assert.equal(res2.operation.state, "completed");

  // One is fresh, one is replay (or both share operation)
  const tokenId = res1.token._id;
  assert.equal(String(res2.token._id), String(tokenId));

  // Exactly one encounter exists
  const encounters = await EncounterJourney.find({ tokenId });
  assert.equal(encounters.length, 1, "Exactly one encounter journey for concurrent same-key requests");

  // Only one debit occurred
  const walletAfter = await Wallet.findOne({ userId: test2Patient._id, userRole: "user" });
  assert.equal(walletBefore.balanceMinor - walletAfter.balanceMinor, 10000, "Exactly one fee was deducted");
});

test("AG02: replayed booking returns existing encounter and preserves identity", async () => {
  const requestKey = `req-concurrent-${suffix}-2`;
  const replay = await findBookingReplay({
    actorKey: `patient:${test2Patient._id}`,
    kind: "opd",
    requestKey,
    fingerprint: (await BookingOperation.findOne({ requestKey })).fingerprint,
  });

  assert.ok(replay);
  assert.equal(replay.replay, true);
  assert.ok(replay.token);

  const encounters = await EncounterJourney.find({ tokenId: replay.token._id });
  assert.equal(encounters.length, 1);
});

test("AG02: failed derived journey is repaired on replay after simulated restart without changing original history", async () => {
  // Take the token from test 1
  const existingToken = await OpdToken.findOne({ hospitalId: hospital._id, patientId: test1Patient._id });
  assert.ok(existingToken);

  const originalTokenRevision = existingToken.revision;
  const originalTokenDate = existingToken.createdAt;

  // Simulate a corrupted/deleted derived encounter journey (e.g. legacy visit or crash before encounter write)
  await EncounterJourney.deleteMany({ tokenId: existingToken._id });

  // Verify journey is currently missing
  const beforeGuidance = await EncounterJourney.findOne({ tokenId: existingToken._id });
  assert.equal(beforeGuidance, null);

  // Calling getEncounterGuidance triggers transparent replay repair
  const guidance = await getEncounterGuidance({ tokenId: existingToken._id });
  assert.ok(guidance, "Guidance must be returned after repair");
  assert.equal(guidance.ticketNumber, existingToken.displayToken);

  // Encounter journey is newly recreated with exact source identity
  const repairedJourney = await EncounterJourney.findOne({ tokenId: existingToken._id });
  assert.ok(repairedJourney, "Encounter journey must be repaired");
  assert.equal(String(repairedJourney.hospitalId), String(hospital._id));
  assert.equal(String(repairedJourney.departmentId), String(existingToken.departmentId));
  assert.equal(String(repairedJourney.patientId), String(test1Patient._id));
  assert.equal(repairedJourney.personKey, existingToken.personKey);

  // Crucial check: original token history is unaltered!
  const unchangedToken = await OpdToken.findById(existingToken._id);
  assert.equal(unchangedToken.revision, originalTokenRevision, "Token revision must be unaltered");
  assert.equal(unchangedToken.createdAt.getTime(), originalTokenDate.getTime(), "Token creation date must be preserved");
});

test("AG02: assisted walk-in booking initializes encounter with isWalkIn: true and stage checked_in", async () => {
  const context = queueContext({
    hospital,
    doctorId: staffDoctor._id,
    sessionId: "day",
    serviceDate: today,
  });
  const person = `walkin:${receptionistStaff._id}:${suffix}-walkin`;
  const requestKey = `req-walkin-${suffix}`;
  const request = {
    actorKey: `staff:${receptionistStaff._id}`,
    kind: "opd",
    requestKey,
    fingerprint: crypto.randomBytes(16).toString("hex"),
  };

  const result = await createQueueBooking({
    request,
    context,
    personKey: person,
    fee: 0,
    payerId: undefined,
    receiverId: platformDoctor._id,
    tokenData: {
      hospitalId: hospital._id,
      departmentId: department._id,
      doctorId: staffDoctor._id,
      patientId: undefined,
      patientInfo: { name: "Walkin Patient", isWalkIn: true },
      visitType: "new",
      visitMode: "in_person",
      tokenPrefix: "T",
      arrivedAt: new Date(),
    },
  });

  assert.equal(result.operation.state, "completed");
  assert.ok(result.token);

  const encounters = await EncounterJourney.find({ tokenId: result.token._id });
  assert.equal(encounters.length, 1);
  const enc = encounters[0];
  assert.equal(enc.isWalkIn, true);
  assert.equal(enc.currentStage, "checked_in");
  assert.equal(enc.patientId, undefined);
  assert.equal(enc.personKey, person);
});

test("AG02: scheduled hospital appointment confirmation creates exactly one encounter in booked stage", async () => {
  const patient6 = await createPatient("p6");
  const careSession = await CareSession.create({
    hospitalId: hospital._id,
    doctorId: staffDoctor._id,
    departmentId: department._id,
    canonicalDoctorId: platformDoctor._id,
    practiceKey: `hospital:${hospital._id}`,
    queueKey: `hospital:${hospital._id}:${staffDoctor._id}:${today}:day`,
    sessionId: "day",
    serviceDate: today,
    timezone: "Asia/Kolkata",
    appointmentType: "hospital_in_person",
    startsAt: new Date(Date.now() + 3600000),
    endsAt: new Date(Date.now() + 7200000),
    feeMinor: 10000,
    currency: "INR",
    policy: { holdMinutes: 10, cancelBeforeMinutes: 60, rescheduleBeforeMinutes: 60 },
  });

  const slot = await CareSlot.create({
    session: careSession._id,
    canonicalDoctorId: platformDoctor._id,
    practiceKey: careSession.practiceKey,
    startsAt: new Date(Date.now() + 3600000),
    endsAt: new Date(Date.now() + 5400000),
    capacity: 5,
    occupied: 1,
  });

  const person = patientKey(patient6._id);
  const reservation = await CareReservation.create({
    session: careSession._id,
    slot: slot._id,
    canonicalDoctorId: platformDoctor._id,
    user: patient6._id,
    personKey: person,
    state: "held",
    expiresAt: new Date(Date.now() + 600000),
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    feeMinor: 10000,
    currency: "INR",
    revision: 1,
  });

  const confirmReq = {
    auth: { id: String(patient6._id), role: "user" },
    params: { reservationId: String(reservation._id) },
    headers: { "idempotency-key": `idem-confirm-${suffix}` },
  };

  const confirmRes = await confirmCareReservation(confirmReq);
  assert.equal(confirmRes.reservation.state, "confirmed");
  assert.ok(confirmRes.reservation.tokenId);
  assert.ok(confirmRes.reservation.appointmentId);

  // Verify encounter journey exists
  const encounters = await EncounterJourney.find({ tokenId: confirmRes.reservation.tokenId });
  assert.equal(encounters.length, 1);
  const enc = encounters[0];
  assert.equal(String(enc.appointmentId), String(confirmRes.reservation.appointmentId));
  assert.equal(enc.currentStage, "booked");
  assert.equal(enc.isWalkIn, false);
  assert.equal(enc.personKey, person);

  // Replay confirmation preserves same encounter
  const replayRes = await confirmCareReservation(confirmReq);
  assert.equal(replayRes.replay, true);
  const encountersAfterReplay = await EncounterJourney.find({ tokenId: confirmRes.reservation.tokenId });
  assert.equal(encountersAfterReplay.length, 1);
});

test("AG02: visitTransitions advances encounter stage with stageHistory and repairs missing encounter on check-in", async () => {
  const patient7 = await createPatient("p7");
  const legacyTokenId = id();
  const legacyApptId = id();
  const queueKey = `hospital:${hospital._id}:${staffDoctor._id}:${today}:day`;
  const legacyToken = await OpdToken.create({
    _id: legacyTokenId,
    hospitalId: hospital._id,
    departmentId: department._id,
    doctorId: staffDoctor._id,
    patientId: patient7._id,
    personKey: patientKey(patient7._id),
    appointmentId: legacyApptId,
    tokenNumber: 99,
    displayToken: "T099",
    date: new Date(`${today}T00:00:00Z`),
    serviceDate: today,
    sessionId: "day",
    queueKey,
    status: "reserved",
    revision: 1,
  });

  const legacyAppt = await Appointment.create({
    _id: legacyApptId,
    doctor: platformDoctor._id,
    user: patient7._id,
    opdTokenId: legacyTokenId,
    queueKey,
    serviceDate: today,
    sessionId: "day",
    personKey: legacyToken.personKey,
    hospitalId: hospital._id,
    departmentId: department._id,
    roomId: `room-${id()}`,
    status: "queued",
    admissionState: "reserved",
    revision: 1,
  });

  // Verify NO encounter exists initially for this legacy token
  const noEnc = await EncounterJourney.findOne({ tokenId: legacyTokenId });
  assert.equal(noEnc, null);

  // Perform check-in visit transition
  await transitionVisit({
    tokenId: legacyTokenId,
    action: "check_in",
  });

  // Encounter was created on the fly and advanced to checked_in with stageHistory
  const repairedEnc = await EncounterJourney.findOne({ tokenId: legacyTokenId });
  assert.ok(repairedEnc, "Encounter must be repaired during visit transition");
  assert.equal(repairedEnc.currentStage, "checked_in");
  assert.ok(repairedEnc.stageHistory.length >= 2, "Must contain initial and checked_in stage history entries");
  assert.equal(repairedEnc.stageHistory.at(-1).stage, "checked_in");
});
