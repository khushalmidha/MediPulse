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
import HospitalLocation from "../../model/hospitalLocation.js";
import BookingOperation from "../../model/bookingOperation.js";
import Wallet from "../../model/wallet.js";
import VirtualTransaction from "../../model/virtualTransaction.js";
import { CareSession, CareSlot, CareReservation, ScheduleOperation } from "../../model/scheduling.js";
import { queueContext, patientKey, localServiceDate } from "../../services/queueContext.js";
import { createQueueBooking } from "../../services/queueBooking.js";
import { transitionVisit } from "../../services/visitTransitions.js";
import {
  initializeEncounterJourney,
  transitionEncounterStage,
  resolveDestinationForStage,
  getEncounterGuidance,
} from "../../services/encounterJourneyService.js";
import {
  getLocations,
  createLocation,
  updateLocation,
  transitionStage,
} from "../../controller/encounterJourney.js";
import { applyClinicalSchema } from "../../services/clinicalSchema.js";

const targets = localTestTargets();
const suffix = crypto.randomBytes(6).toString("hex");
const uri = new URL(targets.mongo);
uri.pathname = `/medipulse_test_encounter_stage_dest_${suffix}`;

let hospital, foreignHospital, department, foreignDepartment, staffDoctor, platformDoctor, nurseStaff, receptionistStaff, adminStaff;
let receptionLocation, vitalsLocation, consultationLocation, inactiveLocation, foreignLocation;
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
    HospitalLocation.createIndexes(),
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
    name: "AG03 Stage Test Hospital",
    slug: `hosp-ag03-${suffix}`,
    registrationNumber: `REG-AG03-${suffix}`,
    email: `hosp.ag03.${suffix}@example.com`,
    type: "clinic",
    status: "active",
    address: { street: "100 Medical Way", city: "Mumbai", state: "MH", postalCode: "400001", country: "IN" },
    settings: { timezone: "Asia/Kolkata", tokenPrefix: "T", queueSessionIds: ["day"] },
  });

  foreignHospital = await Hospital.create({
    name: "Foreign Hospital",
    slug: `hosp-foreign-${suffix}`,
    registrationNumber: `REG-FOREIGN-${suffix}`,
    email: `foreign.${suffix}@example.com`,
    type: "clinic",
    status: "active",
    address: { street: "999 Far St", city: "Delhi", state: "DL", postalCode: "110001", country: "IN" },
    settings: { timezone: "Asia/Kolkata", tokenPrefix: "T", queueSessionIds: ["day"] },
  });

  department = await Department.create({
    hospitalId: hospital._id,
    name: "General Medicine",
    slug: "general-medicine",
    code: "GENMED",
    status: "active",
    opd: { consultationFee: 100, isAvailable: true },
  });

  foreignDepartment = await Department.create({
    hospitalId: foreignHospital._id,
    name: "Foreign Surgery",
    slug: "foreign-surgery",
    code: "SURG",
    status: "active",
    opd: { consultationFee: 200, isAvailable: true },
  });

  platformDoctor = await Doctor.create({
    firstName: "Rohan",
    lastName: "Mehta",
    email: `dr.mehta.${suffix}@example.com`,
    password: "Password@123",
    role: "doctor",
    gender: "male",
    experience: { years: 8, expertise: "General Medicine" },
    consultationFee: 100,
    licenseNumber: `LIC-AG03-${suffix}`,
    doctorProfile: { consultationFee: 100 },
    queueTimezone: "Asia/Kolkata",
    queueSessionIds: ["day"],
  });

  staffDoctor = await HospitalStaff.create({
    hospitalId: hospital._id,
    departmentIds: [department._id],
    doctorId: platformDoctor._id,
    name: "Dr. Rohan Mehta",
    firstName: "Rohan",
    lastName: "Mehta",
    email: `staff.dr.mehta.${suffix}@example.com`,
    password: "Password@123",
    role: "DOCTOR",
    isActive: true,
    inviteStatus: "accepted",
    doctorProfile: { consultationFee: 100 },
  });

  nurseStaff = await HospitalStaff.create({
    hospitalId: hospital._id,
    departmentIds: [department._id],
    name: "Nurse Tara",
    firstName: "Tara",
    lastName: "Sharma",
    email: `nurse.tara.${suffix}@example.com`,
    password: "Password@123",
    role: "NURSE",
    isActive: true,
    inviteStatus: "accepted",
  });

  receptionistStaff = await HospitalStaff.create({
    hospitalId: hospital._id,
    departmentIds: [department._id],
    name: "Desk Sunil",
    firstName: "Sunil",
    lastName: "Kumar",
    email: `sunil.desk.${suffix}@example.com`,
    password: "Password@123",
    role: "RECEPTIONIST",
    isActive: true,
    inviteStatus: "accepted",
  });

  adminStaff = await HospitalStaff.create({
    hospitalId: hospital._id,
    departmentIds: [department._id],
    name: "Admin Vikram",
    firstName: "Vikram",
    lastName: "Singhania",
    email: `admin.vikram.${suffix}@example.com`,
    password: "Password@123",
    role: "HOSPITAL_ADMIN",
    adminAccess: true,
    isActive: true,
    inviteStatus: "accepted",
  });

  // Valid configured locations for hospital
  receptionLocation = await HospitalLocation.create({
    hospitalId: hospital._id,
    name: "Central Reception Desk A",
    type: "desk",
    building: "Main Wing",
    floor: "Ground",
    roomNumber: "G-01",
    serviceType: "reception",
    instructions: "Report to Desk A for token verification.",
    status: "active",
  });

  vitalsLocation = await HospitalLocation.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    name: "OPD Triage Station 1",
    type: "station",
    building: "Main Wing",
    floor: "1st Floor",
    roomNumber: "101",
    serviceType: "vitals",
    instructions: "Proceed to Station 1 for vital signs check.",
    status: "active",
  });

  consultationLocation = await HospitalLocation.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    name: "Consultation Chamber 102",
    type: "room",
    building: "Main Wing",
    floor: "1st Floor",
    roomNumber: "102",
    serviceType: "consultation",
    instructions: "Wait outside Chamber 102 until called by doctor.",
    status: "active",
  });

  inactiveLocation = await HospitalLocation.create({
    hospitalId: hospital._id,
    name: "Old Reception Desk (Closed)",
    type: "desk",
    serviceType: "reception",
    status: "inactive",
  });

  foreignLocation = await HospitalLocation.create({
    hospitalId: foreignHospital._id,
    name: "Foreign Surgery Desk",
    type: "desk",
    serviceType: "reception",
    status: "active",
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

test("AG03: sequential check-in, vitals, start and completion update the same encounter once, advancing destination and preserving prior events", async () => {
  const patient = await createPatient("seq");
  const context = queueContext({
    hospital,
    doctorId: staffDoctor._id,
    sessionId: "day",
    serviceDate: today,
  });
  const person = patientKey(patient._id);
  const requestKey = `req-seq-${suffix}`;

  const result = await createQueueBooking({
    request: { actorKey: `patient:${patient._id}`, kind: "opd", requestKey, fingerprint: crypto.randomBytes(16).toString("hex") },
    context,
    personKey: person,
    fee: 100,
    payerId: patient._id,
    receiverId: platformDoctor._id,
    tokenData: {
      hospitalId: hospital._id,
      departmentId: department._id,
      doctorId: staffDoctor._id,
      patientId: patient._id,
      patientInfo: { name: "Patient Seq", phone: "9876543210", isWalkIn: false },
      visitType: "new",
      visitMode: "in_person",
      tokenPrefix: "T",
      paymentAmount: 100,
      paymentMode: "wallet",
    },
    appointmentData: {
      doctor: platformDoctor._id,
      user: patient._id,
      visitMode: "in_person",
      roomId: `room-${id()}`,
    },
  });

  const tokenId = result.token._id;
  const initialEncounter = await EncounterJourney.findOne({ tokenId });
  assert.ok(initialEncounter);
  assert.equal(initialEncounter.currentStage, "booked");
  assert.equal(initialEncounter.currentDestination.name, receptionLocation.name);
  assert.equal(initialEncounter.stageHistory.length, 1);
  const initialRevision = initialEncounter.revision;

  // 1. Check In
  await transitionVisit({
    tokenId,
    action: "check_in",
    actor: receptionistStaff,
  });

  const afterCheckIn = await EncounterJourney.findOne({ tokenId });
  assert.equal(String(afterCheckIn._id), String(initialEncounter._id), "Must update same encounter document");
  assert.equal(afterCheckIn.currentStage, "checked_in");
  assert.equal(afterCheckIn.revision, initialRevision + 1);
  assert.equal(afterCheckIn.stageHistory.length, 2);
  const checkInHistory = afterCheckIn.stageHistory[1];
  assert.equal(checkInHistory.stage, "checked_in");
  assert.equal(checkInHistory.fromStage, "booked");
  assert.equal(String(checkInHistory.actorId), String(receptionistStaff._id));
  assert.equal(checkInHistory.actorRole, "RECEPTIONIST");
  assert.equal(checkInHistory.actorName, "Desk Sunil");
  assert.equal(checkInHistory.isOverride, false);

  // 2. Vitals
  await transitionVisit({
    tokenId,
    action: "vitals",
    actor: nurseStaff,
    tokenFields: { vitals: { bp: "120/80", temperature: "98.6" } },
  });

  const afterVitals = await EncounterJourney.findOne({ tokenId });
  assert.equal(String(afterVitals._id), String(initialEncounter._id));
  assert.equal(afterVitals.currentStage, "vitals");
  assert.equal(afterVitals.revision, initialRevision + 2);
  assert.equal(afterVitals.stageHistory.length, 3);
  const vitalsHistory = afterVitals.stageHistory[2];
  assert.equal(vitalsHistory.stage, "vitals");
  assert.equal(vitalsHistory.fromStage, "checked_in");
  assert.equal(String(vitalsHistory.actorId), String(nurseStaff._id));
  assert.equal(vitalsHistory.actorRole, "NURSE");
  // Destination now points to consultation chamber
  assert.equal(String(afterVitals.currentDestination.locationId), String(consultationLocation._id));
  assert.equal(afterVitals.currentDestination.name, consultationLocation.name);

  // 3. Consultation Start
  await transitionVisit({
    tokenId,
    action: "start",
    actor: staffDoctor,
  });

  const afterStart = await EncounterJourney.findOne({ tokenId });
  assert.equal(String(afterStart._id), String(initialEncounter._id));
  assert.equal(afterStart.currentStage, "consultation");
  assert.equal(afterStart.revision, initialRevision + 3);
  assert.equal(afterStart.stageHistory.length, 4);
  const startHistory = afterStart.stageHistory[3];
  assert.equal(startHistory.stage, "consultation");
  assert.equal(startHistory.fromStage, "vitals");
  assert.equal(String(startHistory.actorId), String(staffDoctor._id));
  assert.equal(startHistory.actorRole, "DOCTOR");

  // 4. Consultation Complete
  await transitionVisit({
    tokenId,
    action: "complete",
    actor: staffDoctor,
    tokenFields: { diagnosis: "Healthy" },
  });

  const afterComplete = await EncounterJourney.findOne({ tokenId });
  assert.equal(String(afterComplete._id), String(initialEncounter._id));
  assert.equal(afterComplete.currentStage, "completed");
  assert.equal(afterComplete.revision, initialRevision + 4);
  assert.equal(afterComplete.stageHistory.length, 5);
  const completeHistory = afterComplete.stageHistory[4];
  assert.equal(completeHistory.stage, "completed");
  assert.equal(completeHistory.fromStage, "consultation");
  assert.equal(String(completeHistory.actorId), String(staffDoctor._id));
  assert.equal(completeHistory.actorRole, "DOCTOR");

  // Crucial check: All 5 prior events are intact in chronological order!
  assert.deepEqual(
    afterComplete.stageHistory.map((h) => h.stage),
    ["booked", "checked_in", "vitals", "consultation", "completed"]
  );
});

test("AG03: replaces fabricated destination fallbacks with explicitly unknown instructions when location is unconfigured", async () => {
  // A second hospital with NO configured locations
  const unconfiguredHosp = await Hospital.create({
    name: "Unconfigured Hospital",
    slug: `hosp-unconf-${suffix}`,
    registrationNumber: `REG-UNCONF-${suffix}`,
    email: `unconf.${suffix}@example.com`,
    type: "clinic",
    status: "active",
    address: { street: "1 Road", city: "Mumbai", state: "MH", postalCode: "400001", country: "IN" },
    settings: { timezone: "Asia/Kolkata", tokenPrefix: "T", queueSessionIds: ["day"] },
  });
  const unconfDept = await Department.create({
    hospitalId: unconfiguredHosp._id,
    name: "General",
    slug: "gen",
    status: "active",
    opd: { consultationFee: 50, isAvailable: true },
  });

  const journey = await initializeEncounterJourney({
    hospitalId: unconfiguredHosp._id,
    departmentId: unconfDept._id,
    tokenId: id(),
    ticketNumber: "T101",
    personKey: "person-unconf",
  });

  assert.ok(journey);
  // Verify destination is NOT fabricated (not "Main Reception")
  assert.equal(journey.currentDestination.name, "not recorded");
  assert.equal(journey.currentDestination.instructions, "Location not configured. Please consult hospital staff.");

  const guidance = await getEncounterGuidance({ encounterId: journey._id });
  assert.equal(guidance.destination.name, "not recorded");
  assert.equal(guidance.destination.instructions, "Location not configured. Please consult hospital staff.");
});

test("AG03: rejects foreign and inactive destination locations on stage transition", async () => {
  const patient = await createPatient("dest-check");
  const journey = await initializeEncounterJourney({
    hospitalId: hospital._id,
    departmentId: department._id,
    tokenId: id(),
    ticketNumber: "T202",
    personKey: patientKey(patient._id),
  });

  // 1. Attempt transition with a location from another hospital
  await assert.rejects(
    transitionEncounterStage({
      encounterId: journey._id,
      hospitalId: hospital._id,
      toStage: "checked_in",
      locationId: foreignLocation._id,
    }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Location does not belong to this hospital/i);
      return true;
    }
  );

  // 2. Attempt transition with an inactive location
  await assert.rejects(
    transitionEncounterStage({
      encounterId: journey._id,
      hospitalId: hospital._id,
      toStage: "checked_in",
      locationId: inactiveLocation._id,
    }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Destination location is inactive/i);
      return true;
    }
  );
});

test("AG03: rejects skipped required stages without override reason, and accepts with valid override audit", async () => {
  const patient = await createPatient("override-check");
  const journey = await initializeEncounterJourney({
    hospitalId: hospital._id,
    departmentId: department._id,
    tokenId: id(),
    ticketNumber: "T303",
    personKey: patientKey(patient._id),
    requiredSteps: ["reception", "vitals", "consultation"],
  });

  assert.equal(journey.currentStage, "booked");

  // Attempt skipping vitals directly into consultation without overrideReason
  await assert.rejects(
    transitionEncounterStage({
      encounterId: journey._id,
      hospitalId: hospital._id,
      toStage: "consultation",
      actor: staffDoctor,
      overrideReason: "",
    }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Skipped required stages require an override reason/i);
      return true;
    }
  );

  // Attempt again WITH an explicit override reason
  const overrideReason = "Emergency direct admission approved by medical director";
  const updated = await transitionEncounterStage({
    encounterId: journey._id,
    hospitalId: hospital._id,
    toStage: "consultation",
    actor: staffDoctor,
    overrideReason,
  });

  assert.equal(updated.currentStage, "consultation");
  assert.equal(updated.stageHistory.length, 2);
  const lastHistory = updated.stageHistory.at(-1);
  assert.equal(lastHistory.stage, "consultation");
  assert.equal(lastHistory.isOverride, true);
  assert.equal(lastHistory.reason, overrideReason);
  assert.equal(String(lastHistory.actorId), String(staffDoctor._id));
});

test("AG03: rejects stale transitions and transitions on terminal encounters", async () => {
  const patient = await createPatient("stale-check");
  const journey = await initializeEncounterJourney({
    hospitalId: hospital._id,
    departmentId: department._id,
    tokenId: id(),
    ticketNumber: "T404",
    personKey: patientKey(patient._id),
  });

  // Stale revision rejection
  await assert.rejects(
    transitionEncounterStage({
      encounterId: journey._id,
      hospitalId: hospital._id,
      toStage: "checked_in",
      expectedRevision: 999,
    }),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /Encounter changed; refresh before retrying/i);
      return true;
    }
  );

  // Transition to completed
  await transitionEncounterStage({
    encounterId: journey._id,
    hospitalId: hospital._id,
    toStage: "completed",
    overrideReason: "Direct completion for test",
  });

  // Attempt further transition on completed encounter
  await assert.rejects(
    transitionEncounterStage({
      encounterId: journey._id,
      hospitalId: hospital._id,
      toStage: "consultation",
      overrideReason: "Attempt re-open",
    }),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /Cannot transition a completed or cancelled encounter/i);
      return true;
    }
  );
});

test("AG03: hospital location administration validates tenant, department, service types, and permissions", async () => {
  // 1. Non-admin staff rejected
  const nonAdminReq = {
    params: { id: String(hospital._id) },
    staff: { id: String(nurseStaff._id), hospitalId: String(hospital._id), role: "NURSE", adminAccess: false },
    body: { name: "Nurse Desk" },
  };
  const mockRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      status(c) { res.statusCode = c; return res; },
      json(b) { res.body = b; return res; },
    };
    return res;
  };

  await assert.rejects(createLocation(nonAdminReq, mockRes()), (err) => {
    assert.equal(err.status, 403);
    assert.match(err.message, /Hospital admin access is required/i);
    return true;
  });

  // 2. Admin creating location with foreign department rejected
  const foreignDeptReq = {
    params: { id: String(hospital._id) },
    staff: { id: String(adminStaff._id), hospitalId: String(hospital._id), role: "HOSPITAL_ADMIN", adminAccess: true },
    body: { name: "Cross Dept Desk", departmentId: String(foreignDepartment._id) },
  };
  await assert.rejects(createLocation(foreignDeptReq, mockRes()), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /Department does not belong to this hospital/i);
    return true;
  });

  // 3. Admin creating location with invalid service type rejected
  const badServiceReq = {
    params: { id: String(hospital._id) },
    staff: { id: String(adminStaff._id), hospitalId: String(hospital._id), role: "HOSPITAL_ADMIN", adminAccess: true },
    body: { name: "Bad Service Desk", serviceType: "unknown_service" },
  };
  await assert.rejects(createLocation(badServiceReq, mockRes()), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /Invalid service type/i);
    return true;
  });

  // 4. Admin successfully creates location
  const validReq = {
    params: { id: String(hospital._id) },
    staff: { id: String(adminStaff._id), hospitalId: String(hospital._id), role: "HOSPITAL_ADMIN", adminAccess: true },
    body: {
      name: "New Cardiology Desk",
      type: "desk",
      building: "North Wing",
      floor: "2nd",
      roomNumber: "201",
      departmentId: String(department._id),
      serviceType: "reception",
      instructions: "Take the north elevator to 2nd floor",
    },
  };
  const createRes = mockRes();
  await createLocation(validReq, createRes);
  assert.equal(createRes.statusCode, 201);
  assert.ok(createRes.body.location);
  const createdLoc = createRes.body.location;
  assert.equal(createdLoc.name, "New Cardiology Desk");

  // 5. Update location (modify instructions and toggle status)
  const updateReq = {
    params: { id: String(hospital._id), locationId: String(createdLoc._id) },
    staff: { id: String(adminStaff._id), hospitalId: String(hospital._id), role: "HOSPITAL_ADMIN", adminAccess: true },
    body: { status: "inactive", instructions: "Temporarily closed for renovation" },
  };
  const updateRes = mockRes();
  await updateLocation(updateReq, updateRes);
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.location.status, "inactive");
  assert.equal(updateRes.body.location.instructions, "Temporarily closed for renovation");

  // 6. getLocations filters
  const getActiveRes = mockRes();
  await getLocations({ params: { id: String(hospital._id) }, query: {} }, getActiveRes);
  assert.ok(getActiveRes.body.locations.every((l) => l.status === "active"));
  assert.ok(!getActiveRes.body.locations.some((l) => String(l._id) === String(createdLoc._id)));

  const getAllRes = mockRes();
  await getLocations({ params: { id: String(hospital._id) }, query: { includeInactive: "true" } }, getAllRes);
  assert.ok(getAllRes.body.locations.some((l) => String(l._id) === String(createdLoc._id)));
});
