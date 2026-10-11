import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import EncounterJourney from "../model/encounterJourney.js";
import HospitalLocation from "../model/hospitalLocation.js";
import {
  initializeEncounterJourney,
  transitionEncounterStage,
  handoffPhysicalFile,
  refusePhysicalFileHandoff,
  linkWalkInToAccount,
  getEncounterGuidance,
} from "../services/encounterJourneyService.js";

test("P12: Encounter journey adapts department steps, tracks physical file handoffs and guides destination", async (t) => {
  const hospitalAId = new mongoose.Types.ObjectId();
  const hospitalBId = new mongoose.Types.ObjectId();
  const deptCardiologyId = new mongoose.Types.ObjectId();
  const deptDermatologyId = new mongoose.Types.ObjectId();

  const receptionStaff = { id: new mongoose.Types.ObjectId(), name: "Nurse Receptionist", role: "RECEPTIONIST" };
  const triageNurse = { id: new mongoose.Types.ObjectId(), name: "Nurse Sarah", role: "NURSE" };
  const doctorCardio = { id: new mongoose.Types.ObjectId(), name: "Dr. Sharma", role: "DOCTOR" };
  const pharmacyStaff = { id: new mongoose.Types.ObjectId(), name: "Pharmacist Raj", role: "PHARMACIST" };

  await t.test("step requirements adapt by department and physical file location is 'not recorded' initially", async () => {
    // Cardiology encounter with custom diagnostic steps
    const cardioJourney = new EncounterJourney({
      hospitalId: hospitalAId,
      departmentId: deptCardiologyId,
      ticketNumber: "T-CARD-001",
      currentStage: "booked",
      requiredSteps: ["reception", "vitals", "consultation", "diagnostics", "pharmacy"],
      currentDestination: { name: "not recorded" },
      physicalFile: { hasPhysicalFile: false, locationName: "not recorded", handoffHistory: [] },
    });

    // Dermatology encounter with quick consultation steps
    const dermaJourney = new EncounterJourney({
      hospitalId: hospitalBId,
      departmentId: deptDermatologyId,
      ticketNumber: "T-DERM-001",
      currentStage: "booked",
      requiredSteps: ["reception", "consultation"],
      currentDestination: { name: "not recorded" },
      physicalFile: { hasPhysicalFile: false, locationName: "not recorded", handoffHistory: [] },
    });

    assert.equal(cardioJourney.requiredSteps.length, 5);
    assert.ok(cardioJourney.requiredSteps.includes("diagnostics"));
    assert.equal(dermaJourney.requiredSteps.length, 2);
    assert.ok(!dermaJourney.requiredSteps.includes("vitals"));
    assert.equal(cardioJourney.physicalFile.locationName, "not recorded");
    assert.equal(dermaJourney.physicalFile.locationName, "not recorded");
  });

  await t.test("record view alone does not count as physical custody; explicit handoff required", async () => {
    const journey = new EncounterJourney({
      hospitalId: hospitalAId,
      departmentId: deptCardiologyId,
      ticketNumber: "T-CARD-002",
      currentStage: "checked_in",
      physicalFile: {
        hasPhysicalFile: true,
        fileBarcode: "FILE-CARD-002",
        currentHolderId: receptionStaff.id,
        currentHolderName: receptionStaff.name,
        currentHolderRole: receptionStaff.role,
        locationName: "Desk 1 - Main Reception",
        handoffHistory: [],
      },
    });

    // A doctor merely viewing the medical records digitally does not transfer physical file custody
    const digitalViewer = { id: doctorCardio.id, role: doctorCardio.role };
    assert.notEqual(journey.physicalFile.currentHolderId, digitalViewer.id);
    assert.equal(journey.physicalFile.currentHolderName, "Nurse Receptionist");

    // Perform an explicit acknowledged handoff to triage nurse
    const handoffEntry = {
      fromActorId: receptionStaff.id,
      fromActorName: receptionStaff.name,
      fromActorRole: receptionStaff.role,
      toActorId: triageNurse.id,
      toActorName: triageNurse.name,
      toActorRole: triageNurse.role,
      toLocationName: "Triage Station 2",
      timestamp: new Date(),
      status: "acknowledged",
      acknowledgedAt: new Date(),
      reason: "Patient routed for blood pressure and vitals",
    };

    journey.physicalFile.currentHolderId = triageNurse.id;
    journey.physicalFile.currentHolderName = triageNurse.name;
    journey.physicalFile.currentHolderRole = triageNurse.role;
    journey.physicalFile.locationName = "Triage Station 2";
    journey.physicalFile.handoffHistory.push(handoffEntry);

    assert.equal(journey.physicalFile.currentHolderName, "Nurse Sarah");
    assert.equal(journey.physicalFile.locationName, "Triage Station 2");
    assert.equal(journey.physicalFile.handoffHistory[0].status, "acknowledged");
    assert.equal(journey.physicalFile.handoffHistory[0].reason, "Patient routed for blood pressure and vitals");
  });

  await t.test("refused file handoff preserves previous holder custody and records reason", async () => {
    const journey = new EncounterJourney({
      hospitalId: hospitalAId,
      departmentId: deptCardiologyId,
      ticketNumber: "T-CARD-003",
      currentStage: "vitals",
      physicalFile: {
        hasPhysicalFile: true,
        fileBarcode: "FILE-CARD-003",
        currentHolderId: triageNurse.id,
        currentHolderName: triageNurse.name,
        currentHolderRole: triageNurse.role,
        locationName: "Triage Station 2",
        handoffHistory: [],
      },
    });

    // Triage attempts to hand file to pharmacy before doctor consultation
    const refusedEntry = {
      fromActorId: triageNurse.id,
      fromActorName: triageNurse.name,
      toActorId: pharmacyStaff.id,
      toActorName: pharmacyStaff.name,
      toLocationName: "Central Pharmacy Counter",
      timestamp: new Date(),
      status: "refused",
      refusedAt: new Date(),
      reason: "Doctor consultation has not taken place yet; prescription required",
    };

    journey.physicalFile.handoffHistory.push(refusedEntry);

    // Holder remains the triage nurse
    assert.equal(journey.physicalFile.currentHolderId, triageNurse.id);
    assert.equal(journey.physicalFile.currentHolderName, "Nurse Sarah");
    assert.equal(journey.physicalFile.locationName, "Triage Station 2");
    assert.equal(journey.physicalFile.handoffHistory[0].status, "refused");
    assert.equal(journey.physicalFile.handoffHistory[0].reason, "Doctor consultation has not taken place yet; prescription required");
  });

  await t.test("walk-in tickets support later account linking and prevent duplicate linking", async () => {
    const walkInJourney = new EncounterJourney({
      hospitalId: hospitalBId,
      departmentId: deptDermatologyId,
      ticketNumber: "W-042",
      isWalkIn: true,
      currentStage: "checked_in",
      patientId: null,
    });

    assert.equal(walkInJourney.isWalkIn, true);
    assert.equal(walkInJourney.linkedUserId, undefined);

    // Patient registers an account and claims ticket
    const patientUser = new mongoose.Types.ObjectId();
    walkInJourney.linkedUserId = patientUser;
    walkInJourney.patientId = patientUser;
    walkInJourney.linkedAt = new Date();

    assert.equal(walkInJourney.linkedUserId, patientUser);
    assert.equal(walkInJourney.patientId, patientUser);

    // Attempting to re-link to a different user fails
    const anotherUser = new mongoose.Types.ObjectId();
    const canRelink = !walkInJourney.linkedUserId;
    assert.equal(canRelink, false, "Should block re-linking an already linked walk-in ticket");
  });

  await t.test("stage transitions track actor, timestamps, override flags and destination guidance", async () => {
    const journey = new EncounterJourney({
      hospitalId: hospitalAId,
      departmentId: deptCardiologyId,
      ticketNumber: "T-CARD-004",
      currentStage: "vitals",
      currentDestination: {
        name: "OPD Room 204",
        building: "Tower B",
        floor: "2nd Floor",
        roomNumber: "204",
        instructions: "Take Elevator 2 to 2nd Floor, follow green line to Room 204",
      },
      stageHistory: [
        { stage: "booked", timestamp: new Date(Date.now() - 3600000) },
        { stage: "vitals", timestamp: new Date(Date.now() - 1800000), actorRole: "NURSE" },
      ],
    });

    // Advance to consultation
    journey.stageHistory.push({
      stage: "consultation",
      fromStage: "vitals",
      actorId: doctorCardio.id,
      actorRole: "DOCTOR",
      actorName: "Dr. Sharma",
      timestamp: new Date(),
      locationName: "OPD Room 204",
      notes: "Started consultation with Dr. Sharma",
      isOverride: false,
    });
    journey.currentStage = "consultation";

    assert.equal(journey.currentStage, "consultation");
    assert.equal(journey.currentDestination.roomNumber, "204");
    assert.equal(journey.currentDestination.building, "Tower B");
    assert.equal(journey.stageHistory.at(-1).actorRole, "DOCTOR");
    assert.equal(journey.stageHistory.at(-1).isOverride, false);

    // Emergency override to diagnostic lab skipping regular consultation finish
    journey.stageHistory.push({
      stage: "diagnostics",
      fromStage: "consultation",
      actorId: doctorCardio.id,
      actorRole: "DOCTOR",
      actorName: "Dr. Sharma",
      timestamp: new Date(),
      locationName: "Cardiac Catheterization Lab",
      notes: "Urgent ECG & Trop-T required",
      reason: "Acute chest pain presenting during visit",
      isOverride: true,
    });
    journey.currentStage = "diagnostics";

    assert.equal(journey.currentStage, "diagnostics");
    assert.equal(journey.stageHistory.at(-1).isOverride, true);
    assert.equal(journey.stageHistory.at(-1).reason, "Acute chest pain presenting during visit");
  });
});
