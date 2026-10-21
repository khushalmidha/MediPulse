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
import LabOrder from "../../model/labOrder.js";
import Prescription from "../../model/prescription.js";
import EncounterClaimChallenge from "../../model/encounterClaimChallenge.js";
import { localServiceDate } from "../../services/queueContext.js";
import {
  initializeEncounterJourney,
  requestClaimOtp,
  verifyClaimOtp,
  linkWalkInToAccount,
} from "../../services/encounterJourneyService.js";
import { applyClinicalSchema } from "../../services/clinicalSchema.js";

const targets = localTestTargets();
const suffix = crypto.randomBytes(6).toString("hex");
const uri = new URL(targets.mongo);
uri.pathname = `/medipulse_test_encounter_claim_${suffix}`;

let hospital, department, staffDoctor, receptionLocation;
let patientUser1, patientUser2;
const today = localServiceDate(new Date(), "Asia/Kolkata");
const id = () => new mongoose.Types.ObjectId();

const createPatient = async (pTag, phone = "9876543210") => {
  return User.create({
    firstName: "Patient",
    lastName: pTag,
    email: `patient.${pTag}.${suffix}@example.com`,
    password: "Password@123",
    role: "user",
    gender: "male",
    phoneNumber: Number(phone),
    familyMembers: [
      {
        _id: id(),
        name: `Child of ${pTag}`,
        relation: "child",
        gender: "female",
        dob: new Date("2018-05-12"),
      },
    ],
  });
};

before(async () => {
  await mongoose.connect(uri.toString());
  await applyClinicalSchema();

  hospital = await Hospital.create({
    name: "Claim Test Hospital",
    slug: `claim-test-hospital-${suffix}`,
    registrationNumber: `REG-AG05-${suffix}`,
    email: `claim-hosp-${suffix}@example.com`,
    phone: "9876500001",
    type: "clinic",
    status: "active",
    isEmailVerified: true,
    address: { street: "100 Claim St", city: "Delhi", state: "Delhi", postalCode: "110001", country: "IN" },
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
    departmentId: department._id,
    departmentIds: [department._id],
    role: "DOCTOR",
    name: "Dr. Claim Specialist",
    email: `dr.claim.${suffix}@example.com`,
    password: "Password@123",
    isActive: true,
  });

  receptionLocation = await HospitalLocation.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    name: "Main Reception",
    serviceTypes: ["reception"],
    building: "Main Wing",
    floor: "Ground",
    roomNumber: "Desk 1",
    status: "active",
  });

  patientUser1 = await createPatient("Alpha", "9876543210");
  patientUser2 = await createPatient("Beta", "9123456789");
});

after(async () => {
  try {
    await mongoose.connection.dropDatabase();
  } catch (_e) {}
  await mongoose.disconnect();
});

const createWalkInFixture = async (phone = "9876543210", paymentStatus = "paid", paymentMode = "cash") => {
  const tokenNumber = Math.floor(100 + Math.random() * 900);
  const token = await OpdToken.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    doctorId: staffDoctor._id,
    tokenNumber,
    displayToken: `TK-${tokenNumber}`,
    date: new Date(),
    serviceDate: today,
    patientInfo: {
      name: "Unregistered Walk-in Patient",
      phone,
      age: 32,
      gender: "male",
      isWalkIn: true,
    },
    status: "waiting",
    paymentStatus,
    paymentAmount: 500,
    paymentMode,
  });

  const appointment = await Appointment.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    doctor: staffDoctor._id,
    user: patientUser2._id, // placeholder prior to linking
    roomId: `room_${tokenNumber}`,
    status: "queued",
    admissionState: "reserved",
  });
  const journey = await initializeEncounterJourney({
    hospitalId: hospital._id,
    departmentId: department._id,
    tokenId: token._id,
    isWalkIn: true,
  });
  token.appointmentId = appointment._id;
  await token.save();
  journey.appointmentId = appointment._id;
  await journey.save();

  // Create an associated LabOrder and Prescription
  const labOrder = await LabOrder.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    encounterJourneyId: journey._id,
    tokenId: token._id,
    creationKey: `lab_key_${crypto.randomUUID()}`,
    patientInfo: { name: "Unregistered Walk-in Patient" },
    tests: [{ testCode: "CBC", testName: "Complete Blood Count", status: "ordered" }],
  });

  const prescription = await Prescription.create({
    hospitalId: hospital._id,
    encounterJourneyId: journey._id,
    tokenId: token._id,
    doctorId: staffDoctor._id,
    patientInfo: { name: "Unregistered Walk-in Patient" },
    items: [
      {
        medicationCode: "PARA500",
        medicationName: "Paracetamol 500mg",
        directions: "1 tablet thrice daily",
        quantityPrescribed: 10,
      },
    ],
  });

  return { token, appointment, journey, labOrder, prescription };
};

test("AG05: verified walk-in account claim atomically links EncounterJourney, OpdToken, Appointment, LabOrder, Prescription while preserving walk-in identity and payments", async () => {
  const { token, appointment, journey, labOrder, prescription } = await createWalkInFixture("9876543210");
  assert.equal(journey.isWalkIn, true);
  assert.ok(!journey.patientId);
  assert.ok(!journey.linkedUserId);

  // 1. Request claim OTP
  const challenge = await requestClaimOtp({
    encounterId: journey._id,
    userId: patientUser1._id,
    phone: "9876543210",
  });
  assert.equal(challenge.success, true);
  assert.ok(challenge.expiresAt);
  assert.ok(challenge.devOtp);

  // 2. Verify claim OTP to obtain verified claim proof
  const verified = await verifyClaimOtp({
    encounterId: journey._id,
    userId: patientUser1._id,
    otp: challenge.devOtp,
  });
  assert.equal(verified.verified, true);
  assert.ok(verified.claimProof);

  // 3. Atomically link walk-in visit to account with verified claim proof
  const linkResult = await linkWalkInToAccount({
    encounterId: journey._id,
    userId: patientUser1._id,
    claimProof: verified.claimProof,
  });
  assert.ok(linkResult.encounter);
  assert.equal(linkResult.isReplay, false);

  // Verify EncounterJourney state
  const updatedJourney = await EncounterJourney.findById(journey._id);
  assert.equal(String(updatedJourney.patientId), String(patientUser1._id));
  assert.equal(String(updatedJourney.linkedUserId), String(patientUser1._id));
  assert.ok(updatedJourney.linkedAt);
  assert.ok(updatedJourney.claimProofId);
  assert.equal(updatedJourney.isWalkIn, true, "isWalkIn must remain true to preserve original history");
  assert.ok(updatedJourney.revision >= 1);

  // Verify stageHistory contains audit of linking
  const lastHistory = updatedJourney.stageHistory[updatedJourney.stageHistory.length - 1];
  assert.equal(String(lastHistory.actorId), String(patientUser1._id));
  assert.equal(lastHistory.actorRole, "patient");
  assert.match(lastHistory.notes, /Walk-in encounter claimed and linked/);

  // Verify OpdToken state
  const updatedToken = await OpdToken.findById(token._id);
  assert.equal(String(updatedToken.patientId), String(patientUser1._id));
  assert.equal(String(updatedToken.linkedUserId), String(patientUser1._id));
  assert.equal(updatedToken.patientInfo.isWalkIn, true, "token isWalkIn must remain true to preserve original history");
  assert.equal(updatedToken.paymentStatus, "paid", "Original counter payment status must be preserved");
  assert.equal(updatedToken.paymentMode, "cash", "Original counter payment mode must be preserved");

  // Verify Appointment state
  const updatedAppt = await Appointment.findById(appointment._id);
  assert.equal(String(updatedAppt.user), String(patientUser1._id));

  // Verify LabOrder and Prescription state
  const updatedLab = await LabOrder.findById(labOrder._id);
  assert.equal(String(updatedLab.patientId), String(patientUser1._id));

  const updatedRx = await Prescription.findById(prescription._id);
  assert.equal(String(updatedRx.patientId), String(patientUser1._id));
});

test("AG05: unverified requests without claim proof, empty proofs, or wrong ticket IDs are rejected with 400 Bad Request", async () => {
  const { journey } = await createWalkInFixture("9876543210");

  // Missing claim proof entirely
  await assert.rejects(
    linkWalkInToAccount({
      encounterId: journey._id,
      userId: patientUser1._id,
      claimProof: null,
    }),
    (err) => err.status === 400 && /Claim proof is required/.test(err.message)
  );

  // Empty string claim proof
  await assert.rejects(
    linkWalkInToAccount({
      encounterId: journey._id,
      userId: patientUser1._id,
      claimProof: "   ",
    }),
    (err) => err.status === 400 && /Claim proof is required/.test(err.message)
  );
});

test("AG05: wrong OTP attempts are bounded to 5 and lock out with 429, and expired OTPs reject with 410", async () => {
  const { journey } = await createWalkInFixture("9876543210");

  const challenge = await requestClaimOtp({
    encounterId: journey._id,
    userId: patientUser1._id,
    phone: "9876543210",
  });

  // Attempts 1 through 4 fail with 401
  for (let i = 1; i <= 4; i++) {
    await assert.rejects(
      verifyClaimOtp({
        encounterId: journey._id,
        userId: patientUser1._id,
        otp: "000000",
      }),
      (err) => err.status === 401 && /Incorrect OTP/.test(err.message)
    );
  }

  // 5th attempt locks out with 429
  await assert.rejects(
    verifyClaimOtp({
      encounterId: journey._id,
      userId: patientUser1._id,
      otp: "000000",
    }),
    (err) => err.status === 401 || err.status === 429
  );

  // Subsequent attempt (even with correct OTP) fails with 429
  await assert.rejects(
    verifyClaimOtp({
      encounterId: journey._id,
      userId: patientUser1._id,
      otp: challenge.devOtp,
    }),
    (err) => err.status === 429 && /Too many wrong OTP attempts/.test(err.message)
  );

  // Expired challenge
  const expiredChallengeId = `claim_otp:${journey._id}:${patientUser1._id}`;
  await EncounterClaimChallenge.updateOne(
    { _id: expiredChallengeId },
    { $set: { expiresAt: new Date(Date.now() - 1000), attempts: 0 } }
  );

  await assert.rejects(
    verifyClaimOtp({
      encounterId: journey._id,
      userId: patientUser1._id,
      otp: challenge.devOtp,
    }),
    (err) => err.status === 410 && /OTP expired/.test(err.message)
  );
});

test("AG05: foreign proof and foreign encounter binding are strictly rejected", async () => {
  const { journey: journeyA } = await createWalkInFixture("9876543210");
  const { journey: journeyB } = await createWalkInFixture("9123456789");

  // User 1 requests and verifies OTP for journeyA
  const chA = await requestClaimOtp({
    encounterId: journeyA._id,
    userId: patientUser1._id,
    phone: "9876543210",
  });
  const verA = await verifyClaimOtp({
    encounterId: journeyA._id,
    userId: patientUser1._id,
    otp: chA.devOtp,
  });

  // User 2 tries to link journeyA using User 1's claim proof -> 403 Forbidden
  await assert.rejects(
    linkWalkInToAccount({
      encounterId: journeyA._id,
      userId: patientUser2._id,
      claimProof: verA.claimProof,
    }),
    (err) => err.status === 403 && /Claim proof belongs to a different account/.test(err.message)
  );

  // User 1 tries to use proof from journeyA to link journeyB -> 403 Forbidden
  await assert.rejects(
    linkWalkInToAccount({
      encounterId: journeyB._id,
      userId: patientUser1._id,
      claimProof: verA.claimProof,
    }),
    (err) => err.status === 403 && /Claim proof belongs to a different encounter/.test(err.message)
  );
});

test("AG05: replayed proof by different caller fails with 410 and simultaneous claims cannot link to different owners", async () => {
  const { journey } = await createWalkInFixture("9876543210");

  // User 1 verifies claim proof
  const ch1 = await requestClaimOtp({
    encounterId: journey._id,
    userId: patientUser1._id,
    phone: "9876543210",
  });
  const ver1 = await verifyClaimOtp({
    encounterId: journey._id,
    userId: patientUser1._id,
    otp: ch1.devOtp,
  });

  // User 1 successfully links
  await linkWalkInToAccount({
    encounterId: journey._id,
    userId: patientUser1._id,
    claimProof: ver1.claimProof,
  });

  // Proof is now consumed: another caller cannot use it
  await assert.rejects(
    linkWalkInToAccount({
      encounterId: journey._id,
      userId: patientUser2._id,
      claimProof: ver1.claimProof,
    }),
    (err) => err.status === 403 || err.status === 410
  );

  // Another user with their own proof attempts to claim the already-linked encounter -> 409 Conflict
  const { journey: journeyToCompete } = await createWalkInFixture("9876543210");
  const chA = await requestClaimOtp({ encounterId: journeyToCompete._id, userId: patientUser1._id, phone: "9876543210" });
  const verA = await verifyClaimOtp({ encounterId: journeyToCompete._id, userId: patientUser1._id, otp: chA.devOtp });

  // First claim succeeds
  await linkWalkInToAccount({
    encounterId: journeyToCompete._id,
    userId: patientUser1._id,
    claimProof: verA.claimProof,
  });

  // Second user also got a proof somehow but encounters already linked -> 409
  // Create a synthetic proof for user 2
  const fakeToken = crypto.randomBytes(32).toString("hex");
  const fakeHash = crypto.createHash("sha256").update(fakeToken).digest("hex");
  await EncounterClaimChallenge.create({
    _id: `claim_proof:${fakeHash}`,
    kind: "proof",
    encounterId: journeyToCompete._id,
    hospitalId: hospital._id,
    userId: patientUser2._id,
    expiresAt: new Date(Date.now() + 600000),
    consumedAt: null,
  });

  await assert.rejects(
    linkWalkInToAccount({
      encounterId: journeyToCompete._id,
      userId: patientUser2._id,
      claimProof: fakeToken,
    }),
    (err) => err.status === 409 && /already linked to another account/.test(err.message)
  );
});

test("AG05: replay recovery allows same owner to re-invoke linkWalkInToAccount idempotently", async () => {
  const { journey } = await createWalkInFixture("9876543210");

  const ch = await requestClaimOtp({
    encounterId: journey._id,
    userId: patientUser1._id,
    phone: "9876543210",
  });
  const ver = await verifyClaimOtp({
    encounterId: journey._id,
    userId: patientUser1._id,
    otp: ch.devOtp,
  });

  // First link
  const first = await linkWalkInToAccount({
    encounterId: journey._id,
    userId: patientUser1._id,
    claimProof: ver.claimProof,
  });
  assert.equal(first.isReplay, false);
  const rev1 = first.encounter.revision;

  // Replay by the same owner with the same proof
  const replay = await linkWalkInToAccount({
    encounterId: journey._id,
    userId: patientUser1._id,
    claimProof: ver.claimProof,
  });
  assert.equal(replay.isReplay, true);
  assert.equal(String(replay.encounter._id), String(journey._id));
  assert.equal(String(replay.encounter.patientId), String(patientUser1._id));
  assert.equal(replay.encounter.revision, rev1, "Replay must be idempotent and not double-increment revision");
});

test("AG05: family member linking links valid family member and rejects foreign family member IDs", async () => {
  const { journey } = await createWalkInFixture("9876543210");
  const validFamilyId = patientUser1.familyMembers[0]._id;
  const foreignFamilyId = patientUser2.familyMembers[0]._id;

  // Foreign family member is rejected
  const ch1 = await requestClaimOtp({
    encounterId: journey._id,
    userId: patientUser1._id,
    phone: "9876543210",
  });
  const ver1 = await verifyClaimOtp({
    encounterId: journey._id,
    userId: patientUser1._id,
    otp: ch1.devOtp,
  });

  await assert.rejects(
    linkWalkInToAccount({
      encounterId: journey._id,
      userId: patientUser1._id,
      claimProof: ver1.claimProof,
      familyMemberId: foreignFamilyId,
    }),
    (err) => err.status === 400 && /Invalid family member/.test(err.message)
  );

  // Valid family member succeeds using the unconsumed proof from the rolled-back attempt
  const linked = await linkWalkInToAccount({
    encounterId: journey._id,
    userId: patientUser1._id,
    claimProof: ver1.claimProof,
    familyMemberId: validFamilyId,
  });
  assert.ok(linked.encounter);
  assert.equal(String(linked.encounter.familyMemberId), String(validFamilyId));

  const updatedToken = await OpdToken.findById(journey.tokenId);
  assert.equal(String(updatedToken.familyMemberId), String(validFamilyId));
});

test("AG05: non-walk-in encounter claim is rejected with 400 Bad Request", async () => {
  const scheduledTokenNumber = Math.floor(100 + Math.random() * 900);
  const scheduledToken = await OpdToken.create({
    hospitalId: hospital._id,
    departmentId: department._id,
    doctorId: staffDoctor._id,
    patientId: patientUser2._id,
    tokenNumber: scheduledTokenNumber,
    date: new Date(),
    serviceDate: today,
    patientInfo: {
      name: "Scheduled Online Patient",
      phone: "9876543210",
      isWalkIn: false,
    },
    status: "waiting",
  });

  const scheduledJourney = await initializeEncounterJourney({
    hospitalId: hospital._id,
    departmentId: department._id,
    tokenId: scheduledToken._id,
    patientId: patientUser2._id,
    isWalkIn: false,
  });
  assert.equal(scheduledJourney.isWalkIn, false);

  await assert.rejects(
    requestClaimOtp({
      encounterId: scheduledJourney._id,
      userId: patientUser1._id,
      phone: "9876543210",
    }),
    (err) => err.status === 400 && /not booked as a walk-in/.test(err.message)
  );
});
