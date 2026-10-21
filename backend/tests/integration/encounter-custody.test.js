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
import { localServiceDate } from "../../services/queueContext.js";
import {
  initializeEncounterJourney,
  registerPhysicalFile,
  handoffPhysicalFile,
  acceptPhysicalFileHandoff,
  refusePhysicalFileHandoff,
  getCustodyWorklist,
  getEncounterCustodyDetails,
  getEncounterGuidance,
} from "../../services/encounterJourneyService.js";
import { applyClinicalSchema } from "../../services/clinicalSchema.js";

const targets = localTestTargets();
const suffix = crypto.randomBytes(6).toString("hex");
const uri = new URL(targets.mongo);
uri.pathname = `/medipulse_test_encounter_custody_${suffix}`;

let hospital, foreignHospital, department, staffDoctor, nurseStaff, receptionistStaff, adminStaff, foreignStaff, inactiveStaff;
let receptionLocation, vitalsLocation, foreignLocation, inactiveLocation;
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
    name: "AG04 Custody Test Hospital",
    slug: `hosp-ag04-${suffix}`,
    registrationNumber: `REG-AG04-${suffix}`,
    email: `hosp.ag04.${suffix}@example.com`,
    type: "clinic",
    status: "active",
    isEmailVerified: true,
    address: { street: "100 Medical Way", city: "Mumbai", state: "MH", postalCode: "400001", country: "IN" },
    settings: { timezone: "Asia/Kolkata", tokenPrefix: "T", queueSessionIds: ["day"] },
  });

  foreignHospital = await Hospital.create({
    name: "Foreign Custody Hospital",
    slug: `hosp-foreign-ag04-${suffix}`,
    registrationNumber: `REG-FAG04-${suffix}`,
    email: `foreign.ag04.${suffix}@example.com`,
    type: "clinic",
    status: "active",
    isEmailVerified: true,
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

  staffDoctor = await HospitalStaff.create({
    hospitalId: hospital._id,
    departmentIds: [department._id],
    name: "Dr. Marcus Vance",
    email: `dr.marcus.${suffix}@example.com`,
    role: "DOCTOR",
    password: "Password@123",
    inviteStatus: "accepted",
    isActive: true,
  });

  nurseStaff = await HospitalStaff.create({
    hospitalId: hospital._id,
    departmentIds: [department._id],
    name: "Nurse Clara",
    email: `nurse.clara.${suffix}@example.com`,
    role: "NURSE",
    password: "Password@123",
    inviteStatus: "accepted",
    isActive: true,
  });

  receptionistStaff = await HospitalStaff.create({
    hospitalId: hospital._id,
    departmentIds: [department._id],
    name: "Receptionist Roy",
    email: `receptionist.roy.${suffix}@example.com`,
    role: "RECEPTIONIST",
    password: "Password@123",
    inviteStatus: "accepted",
    isActive: true,
  });

  adminStaff = await HospitalStaff.create({
    hospitalId: hospital._id,
    departmentIds: [department._id],
    name: "Admin Alice",
    email: `admin.alice.${suffix}@example.com`,
    role: "HOSPITAL_ADMIN",
    adminAccess: true,
    password: "Password@123",
    inviteStatus: "accepted",
    isActive: true,
  });

  foreignStaff = await HospitalStaff.create({
    hospitalId: foreignHospital._id,
    name: "Foreign Doctor",
    email: `foreign.doc.${suffix}@example.com`,
    role: "DOCTOR",
    password: "Password@123",
    inviteStatus: "accepted",
    isActive: true,
  });

  inactiveStaff = await HospitalStaff.create({
    hospitalId: hospital._id,
    name: "Inactive Nurse",
    email: `inactive.nurse.${suffix}@example.com`,
    role: "NURSE",
    password: "Password@123",
    inviteStatus: "accepted",
    isActive: false,
  });

  receptionLocation = await HospitalLocation.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    name: "Central Reception Desk",
    roomNumber: "REC-1",
    floor: "Ground",
    building: "Main Wing",
    serviceType: "reception",
    status: "active",
  });

  vitalsLocation = await HospitalLocation.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    name: "Triage & Vitals Room",
    roomNumber: "VIT-101",
    floor: "1st Floor",
    building: "Main Wing",
    serviceType: "vitals",
    status: "active",
  });

  foreignLocation = await HospitalLocation.create({
    hospitalId: foreignHospital._id,
    name: "Foreign Desk",
    roomNumber: "F-1",
    floor: "1",
    building: "Foreign Wing",
    serviceType: "reception",
    status: "active",
  });

  inactiveLocation = await HospitalLocation.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    name: "Decommissioned Station",
    roomNumber: "DEC-0",
    floor: "Basement",
    building: "Old Wing",
    serviceType: "reception",
    status: "inactive",
  });
});

after(async () => {
  try {
    await mongoose.connection.dropDatabase();
  } catch {}
  await mongoose.disconnect();
});

test("AG04: initial physical file registration sets holder, location, file barcode, and records initial acknowledged event", async () => {
  const patient = await createPatient("CustodyReg");
  const token = await OpdToken.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    doctorId: staffDoctor._id,
    patientId: patient._id,
    tokenNumber: 401,
    displayToken: "T-401",
    patientInfo: { name: "Patient CustodyReg", age: 30, gender: "male" },
    source: "hospital_booking",
    status: "waiting",
    date: today,
  });

  const encounter = await initializeEncounterJourney({
    hospitalId: hospital._id,
    departmentId: department._id,
    tokenId: token._id,
    patientId: patient._id,
  });

  assert.equal(encounter.physicalFile.hasPhysicalFile, false);

  const registered = await registerPhysicalFile({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    actor: receptionistStaff,
    fileBarcode: "PF-401-A",
    locationId: receptionLocation._id,
    reason: "Chart created at check-in",
  });

  assert.equal(registered.physicalFile.hasPhysicalFile, true);
  assert.equal(registered.physicalFile.fileBarcode, "PF-401-A");
  assert.equal(String(registered.physicalFile.currentHolderId), String(receptionistStaff._id));
  assert.equal(registered.physicalFile.currentHolderName, receptionistStaff.name);
  assert.equal(registered.physicalFile.currentHolderRole, "RECEPTIONIST");
  assert.equal(registered.physicalFile.locationName, receptionLocation.name);
  assert.equal(String(registered.physicalFile.locationId), String(receptionLocation._id));
  assert.equal(registered.physicalFile.handoffHistory.length, 1);
  assert.equal(registered.physicalFile.handoffHistory[0].status, "acknowledged");
  assert.equal(registered.physicalFile.handoffHistory[0].reason, "Chart created at check-in");
  assert.equal(registered.revision, 1);

  // Attempting to re-register fails with 409 Conflict
  await assert.rejects(
    async () => {
      await registerPhysicalFile({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        actor: receptionistStaff,
        fileBarcode: "PF-401-B",
      });
    },
    (err) => err.status === 409 && err.message.includes("already registered")
  );
});

test("AG04: sender initiates handoff to recipient staff; custody stays with sender and request acknowledged=true is ignored", async () => {
  const patient = await createPatient("CustodySend");
  const token = await OpdToken.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    doctorId: staffDoctor._id,
    patientId: patient._id,
    tokenNumber: 402,
    displayToken: "T-402",
    patientInfo: { name: "Patient CustodySend", age: 32, gender: "male" },
    source: "hospital_booking",
    status: "waiting",
    date: today,
  });

  const encounter = await initializeEncounterJourney({
    hospitalId: hospital._id,
    departmentId: department._id,
    tokenId: token._id,
    patientId: patient._id,
  });

  await registerPhysicalFile({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    actor: receptionistStaff,
    locationId: receptionLocation._id,
  });

  // Receptionist initiates handoff to Nurse Clara
  // Note: Pass acknowledged: true to verify it is IGNORED!
  const handedOff = await handoffPhysicalFile({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    fromActor: receptionistStaff,
    toActorId: nurseStaff._id,
    locationId: vitalsLocation._id,
    reason: "Transfer file for vitals recording",
    expectedRevision: 1,
    acknowledged: true, // Should be ignored
  });

  // Current holder MUST remain receptionist
  assert.equal(String(handedOff.physicalFile.currentHolderId), String(receptionistStaff._id));
  assert.equal(handedOff.physicalFile.currentHolderName, receptionistStaff.name);
  assert.equal(handedOff.physicalFile.locationName, receptionLocation.name);
  assert.equal(handedOff.revision, 2);

  // A pending handoff entry is created
  assert.equal(handedOff.physicalFile.handoffHistory.length, 2);
  const pending = handedOff.physicalFile.handoffHistory[1];
  assert.equal(pending.status, "pending");
  assert.equal(String(pending.fromActorId), String(receptionistStaff._id));
  assert.equal(String(pending.toActorId), String(nurseStaff._id));
  assert.equal(pending.toActorName, nurseStaff.name);
  assert.equal(pending.toActorRole, "NURSE");
  assert.equal(pending.toLocationName, vitalsLocation.name);
  assert.equal(pending.reason, "Transfer file for vitals recording");
});

test("AG04: handoff initiation rejects unauthorized callers, foreign recipients, inactive staff, self-transfer, and concurrent pending handoffs", async () => {
  const patient = await createPatient("CustodyVal");
  const token = await OpdToken.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    doctorId: staffDoctor._id,
    patientId: patient._id,
    tokenNumber: 403,
    displayToken: "T-403",
    patientInfo: { name: "Patient CustodyVal", age: 40, gender: "male" },
    source: "hospital_booking",
    status: "waiting",
    date: today,
  });

  const encounter = await initializeEncounterJourney({
    hospitalId: hospital._id,
    departmentId: department._id,
    tokenId: token._id,
    patientId: patient._id,
  });

  await registerPhysicalFile({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    actor: receptionistStaff,
    locationId: receptionLocation._id,
  });

  // 1. Non-holder staff (Doctor) without admin rights cannot initiate handoff
  await assert.rejects(
    async () => {
      await handoffPhysicalFile({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        fromActor: staffDoctor,
        toActorId: nurseStaff._id,
        expectedRevision: 1,
      });
    },
    (err) => err.status === 403 && err.message.includes("Only the current file holder")
  );

  // 2. Foreign recipient staff member is rejected
  await assert.rejects(
    async () => {
      await handoffPhysicalFile({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        fromActor: receptionistStaff,
        toActorId: foreignStaff._id,
        expectedRevision: 1,
      });
    },
    (err) => err.status === 400 && err.message.includes("Recipient staff member not found")
  );

  // 3. Inactive staff member is rejected
  await assert.rejects(
    async () => {
      await handoffPhysicalFile({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        fromActor: receptionistStaff,
        toActorId: inactiveStaff._id,
        expectedRevision: 1,
      });
    },
    (err) => err.status === 400 && err.message.includes("Recipient staff member not found")
  );

  // 4. Transfer to self is rejected
  await assert.rejects(
    async () => {
      await handoffPhysicalFile({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        fromActor: receptionistStaff,
        toActorId: receptionistStaff._id,
        expectedRevision: 1,
      });
    },
    (err) => err.status === 400 && err.message.includes("Cannot hand off physical file to yourself")
  );

  // 5. Inactive or foreign location is rejected
  await assert.rejects(
    async () => {
      await handoffPhysicalFile({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        fromActor: receptionistStaff,
        toActorId: nurseStaff._id,
        locationId: foreignLocation._id,
        expectedRevision: 1,
      });
    },
    (err) => err.status === 400 && err.message.includes("Destination location not found")
  );

  await assert.rejects(
    async () => {
      await handoffPhysicalFile({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        fromActor: receptionistStaff,
        toActorId: nurseStaff._id,
        locationId: inactiveLocation._id,
        expectedRevision: 1,
      });
    },
    (err) => err.status === 400 && err.message.includes("Destination location not found")
  );

  // 6. Stale revision is rejected
  await assert.rejects(
    async () => {
      await handoffPhysicalFile({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        fromActor: receptionistStaff,
        toActorId: nurseStaff._id,
        expectedRevision: 999,
      });
    },
    (err) => err.status === 409 && err.message.includes("revision conflict")
  );

  // Successfully create valid pending handoff
  await handoffPhysicalFile({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    fromActor: receptionistStaff,
    toActorId: nurseStaff._id,
    expectedRevision: 1,
  });

  // 7. Duplicate pending handoff is rejected with 409
  await assert.rejects(
    async () => {
      await handoffPhysicalFile({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        fromActor: receptionistStaff,
        toActorId: nurseStaff._id,
        expectedRevision: 2,
      });
    },
    (err) => err.status === 409 && err.message.includes("already pending")
  );
});

test("AG04: only designated recipient can accept file custody; transfers holder and location, updates revision", async () => {
  const patient = await createPatient("CustodyAccept");
  const token = await OpdToken.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    doctorId: staffDoctor._id,
    patientId: patient._id,
    tokenNumber: 404,
    displayToken: "T-404",
    patientInfo: { name: "Patient CustodyAccept", age: 28, gender: "male" },
    source: "hospital_booking",
    status: "waiting",
    date: today,
  });

  const encounter = await initializeEncounterJourney({
    hospitalId: hospital._id,
    departmentId: department._id,
    tokenId: token._id,
    patientId: patient._id,
  });

  await registerPhysicalFile({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    actor: receptionistStaff,
    locationId: receptionLocation._id,
  });

  await handoffPhysicalFile({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    fromActor: receptionistStaff,
    toActorId: nurseStaff._id,
    locationId: vitalsLocation._id,
    expectedRevision: 1,
  });

  // Unauthorized staff member (Dr. Marcus) attempts to accept
  await assert.rejects(
    async () => {
      await acceptPhysicalFileHandoff({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        actor: staffDoctor,
        expectedRevision: 2,
      });
    },
    (err) => err.status === 403 && err.message.includes("Only the designated recipient")
  );

  // Stale revision is rejected
  await assert.rejects(
    async () => {
      await acceptPhysicalFileHandoff({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        actor: nurseStaff,
        expectedRevision: 0,
      });
    },
    (err) => err.status === 409 && err.message.includes("revision conflict")
  );

  // Designated recipient (Nurse Clara) accepts custody
  const accepted = await acceptPhysicalFileHandoff({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    actor: nurseStaff,
    locationId: vitalsLocation._id,
    expectedRevision: 2,
  });

  assert.equal(String(accepted.physicalFile.currentHolderId), String(nurseStaff._id));
  assert.equal(accepted.physicalFile.currentHolderName, nurseStaff.name);
  assert.equal(accepted.physicalFile.currentHolderRole, "NURSE");
  assert.equal(accepted.physicalFile.locationName, vitalsLocation.name);
  assert.equal(String(accepted.physicalFile.locationId), String(vitalsLocation._id));
  assert.equal(accepted.revision, 3);

  const pending = accepted.physicalFile.handoffHistory[1];
  assert.equal(pending.status, "acknowledged");
  assert.ok(pending.acknowledgedAt);

  // Accepting again throws 409 Conflict (no pending handoff)
  await assert.rejects(
    async () => {
      await acceptPhysicalFileHandoff({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        actor: nurseStaff,
        expectedRevision: 3,
      });
    },
    (err) => err.status === 409 && err.message.includes("No pending file handoff")
  );
});

test("AG04: recipient refusal preserves current holder custody, audits refusal reason, and requires non-empty reason", async () => {
  const patient = await createPatient("CustodyRefuse");
  const token = await OpdToken.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    doctorId: staffDoctor._id,
    patientId: patient._id,
    tokenNumber: 405,
    displayToken: "T-405",
    patientInfo: { name: "Patient CustodyRefuse", age: 55, gender: "male" },
    source: "hospital_booking",
    status: "waiting",
    date: today,
  });

  const encounter = await initializeEncounterJourney({
    hospitalId: hospital._id,
    departmentId: department._id,
    tokenId: token._id,
    patientId: patient._id,
  });

  await registerPhysicalFile({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    actor: nurseStaff,
    locationId: vitalsLocation._id,
  });

  // Nurse hands off to Doctor
  await handoffPhysicalFile({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    fromActor: nurseStaff,
    toActorId: staffDoctor._id,
    expectedRevision: 1,
  });

  // 1. Third party (Receptionist) attempts to refuse
  await assert.rejects(
    async () => {
      await refusePhysicalFileHandoff({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        actor: receptionistStaff,
        reason: "Refused by receptionist",
        expectedRevision: 2,
      });
    },
    (err) => err.status === 403 && err.message.includes("Only the designated recipient")
  );

  // 2. Doctor attempts to refuse without a reason
  await assert.rejects(
    async () => {
      await refusePhysicalFileHandoff({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        actor: staffDoctor,
        reason: "   ",
        expectedRevision: 2,
      });
    },
    (err) => err.status === 400 && err.message.includes("Refusal reason is required")
  );

  // 3. Stale revision
  await assert.rejects(
    async () => {
      await refusePhysicalFileHandoff({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        actor: staffDoctor,
        reason: "Emergency called",
        expectedRevision: 0,
      });
    },
    (err) => err.status === 409 && err.message.includes("revision conflict")
  );

  // 4. Doctor refuses with valid reason and revision
  const refused = await refusePhysicalFileHandoff({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    actor: staffDoctor,
    reason: "Doctor called to emergency theatre",
    expectedRevision: 2,
  });

  // CUSTODY REMAINS WITH NURSE!
  assert.equal(String(refused.physicalFile.currentHolderId), String(nurseStaff._id));
  assert.equal(refused.physicalFile.currentHolderName, nurseStaff.name);
  assert.equal(refused.physicalFile.locationName, vitalsLocation.name);
  assert.equal(refused.revision, 3);

  const pendingEntry = refused.physicalFile.handoffHistory[1];
  assert.equal(pendingEntry.status, "refused");
  assert.equal(pendingEntry.reason, "Doctor called to emergency theatre");
  assert.ok(pendingEntry.refusedAt);

  // Refusing again throws 409 Conflict
  await assert.rejects(
    async () => {
      await refusePhysicalFileHandoff({
        encounterId: encounter._id,
        hospitalId: hospital._id,
        actor: staffDoctor,
        reason: "Refusing again",
        expectedRevision: 3,
      });
    },
    (err) => err.status === 409 && err.message.includes("No pending file handoff")
  );
});

test("AG04: operational custody worklist segregates incoming, outgoing, and held files; patient guidance preserves privacy", async () => {
  const patient = await createPatient("CustodyWorklist");
  const token = await OpdToken.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    doctorId: staffDoctor._id,
    patientId: patient._id,
    tokenNumber: 406,
    displayToken: "T-406",
    patientInfo: { name: "Patient CustodyWorklist", age: 45, gender: "male" },
    source: "hospital_booking",
    status: "waiting",
    date: today,
  });

  const encounter = await initializeEncounterJourney({
    hospitalId: hospital._id,
    departmentId: department._id,
    tokenId: token._id,
    patientId: patient._id,
  });

  await registerPhysicalFile({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    actor: nurseStaff,
    fileBarcode: "PF-406",
    locationId: vitalsLocation._id,
  });

  // Nurse currently holds file PF-406
  let nurseWorklist = await getCustodyWorklist({ hospitalId: hospital._id, staffId: nurseStaff._id });
  const initialHeld = nurseWorklist.held.find((h) => h.fileBarcode === "PF-406");
  assert.ok(initialHeld);
  assert.equal(initialHeld.hasPendingOutgoing, false);
  assert.ok(!nurseWorklist.incoming.some((i) => i.fileBarcode === "PF-406"));
  assert.ok(!nurseWorklist.outgoing.some((o) => o.fileBarcode === "PF-406"));

  // Nurse sends handoff to Doctor
  await handoffPhysicalFile({
    encounterId: encounter._id,
    hospitalId: hospital._id,
    fromActor: nurseStaff,
    toActorId: staffDoctor._id,
    expectedRevision: 1,
    reason: "Chart for Dr. Vance",
  });

  nurseWorklist = await getCustodyWorklist({ hospitalId: hospital._id, staffId: nurseStaff._id });
  const pendingHeld = nurseWorklist.held.find((h) => h.fileBarcode === "PF-406");
  assert.ok(pendingHeld);
  assert.equal(pendingHeld.hasPendingOutgoing, true);
  const nurseOutgoing = nurseWorklist.outgoing.find((o) => o.fileBarcode === "PF-406");
  assert.ok(nurseOutgoing);
  assert.equal(nurseOutgoing.toActorName, staffDoctor.name);

  const docWorklist = await getCustodyWorklist({ hospitalId: hospital._id, staffId: staffDoctor._id });
  const docIncoming = docWorklist.incoming.find((i) => i.fileBarcode === "PF-406");
  assert.ok(docIncoming);
  assert.equal(docIncoming.fromActorName, nurseStaff.name);

  // Guidance checks
  // Staff guidance includes internal holder and pending handoff
  const staffGuidance = await getEncounterGuidance({ encounterId: encounter._id });
  assert.equal(staffGuidance.physicalFile.tracked, true);
  assert.equal(staffGuidance.physicalFile.fileBarcode, "PF-406");
  assert.equal(staffGuidance.physicalFile.holder, nurseStaff.name);
  assert.equal(staffGuidance.physicalFile.holderRole, "NURSE");
  assert.equal(staffGuidance.physicalFile.location, vitalsLocation.name);
  assert.ok(staffGuidance.physicalFile.pendingHandoff);
  assert.equal(String(staffGuidance.physicalFile.pendingHandoff.toActorId), String(staffDoctor._id));

  // Custody details endpoint check
  const custodyDetails = await getEncounterCustodyDetails({ encounterId: encounter._id, hospitalId: hospital._id });
  assert.equal(custodyDetails.physicalFile.hasPhysicalFile, true);
  assert.equal(custodyDetails.physicalFile.currentHolderName, nurseStaff.name);
  assert.equal(custodyDetails.physicalFile.pendingHandoff.toActorName, staffDoctor.name);
  assert.equal(custodyDetails.physicalFile.handoffHistory.length, 2);
});
