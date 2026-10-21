import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const encounterJourneySchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true },
    departmentId: { type: objectId, ref: "Department", required: true },
    tokenId: { type: objectId, ref: "OpdToken" },
    appointmentId: { type: objectId, ref: "Appointment" },
    patientId: { type: objectId, ref: "user" },
    familyMemberId: { type: objectId },
    personKey: { type: String },
    isWalkIn: { type: Boolean, default: false },
    linkedUserId: { type: objectId, ref: "user" },
    linkedAt: Date,
    claimProofId: { type: String },
    ticketNumber: { type: String, required: true },
    qrPayload: { type: String },

    currentStage: {
      type: String,
      enum: [
        "booked",
        "checked_in",
        "reception",
        "vitals",
        "consultation",
        "diagnostics",
        "pharmacy",
        "completed",
        "cancelled",
      ],
      default: "booked",
    },

    requiredSteps: {
      type: [String],
      default: ["reception", "vitals", "consultation"],
    },

    currentDestination: {
      locationId: { type: objectId, ref: "HospitalLocation" },
      name: { type: String, default: "not recorded" },
      building: String,
      floor: String,
      roomNumber: String,
      instructions: String,
    },

    stageHistory: [
      {
        stage: { type: String, required: true },
        fromStage: String,
        actorId: { type: objectId },
        actorRole: String,
        actorName: String,
        timestamp: { type: Date, default: Date.now },
        locationId: { type: objectId },
        locationName: String,
        notes: String,
        reason: String,
        isOverride: { type: Boolean, default: false },
      },
    ],

    physicalFile: {
      hasPhysicalFile: { type: Boolean, default: false },
      fileBarcode: String,
      currentHolderId: { type: objectId },
      currentHolderRole: String,
      currentHolderName: String,
      locationId: { type: objectId },
      locationName: { type: String, default: "not recorded" },
      lastHandoffAt: Date,
      handoffHistory: [
        {
          handoffId: { type: String },
          fromActorId: { type: objectId },
          fromActorName: String,
          fromActorRole: String,
          toActorId: { type: objectId },
          toActorName: String,
          toActorRole: String,
          fromLocationId: { type: objectId },
          toLocationId: { type: objectId },
          toLocationName: { type: String, default: "not recorded" },
          timestamp: { type: Date, default: Date.now },
          status: { type: String, enum: ["pending", "acknowledged", "refused"], default: "pending" },
          acknowledgedAt: Date,
          refusedAt: Date,
          reason: String,
        },
      ],
    },

    digitalCustody: {
      currentResponsibleStaffId: { type: objectId },
      role: String,
      assignedAt: Date,
    },

    revision: { type: Number, default: 0 },
  },
  { timestamps: true, autoIndex: false }
);

encounterJourneySchema.index(
  { tokenId: 1 },
  { unique: true, name: "ag01_encounter_token_unique", partialFilterExpression: { tokenId: { $type: "objectId" } } }
);
encounterJourneySchema.index(
  { appointmentId: 1 },
  { unique: true, name: "ag01_encounter_appointment_unique", partialFilterExpression: { appointmentId: { $type: "objectId" } } }
);
encounterJourneySchema.index({ hospitalId: 1, currentStage: 1 }, { name: "ag01_encounter_hospital_stage" });
encounterJourneySchema.index({ hospitalId: 1, departmentId: 1 }, { name: "ag01_encounter_hospital_department" });
encounterJourneySchema.index({ hospitalId: 1, ticketNumber: 1 }, { name: "ag01_encounter_hospital_ticket" });
encounterJourneySchema.index(
  { patientId: 1, createdAt: -1 },
  { name: "ag01_encounter_patient_created", partialFilterExpression: { patientId: { $type: "objectId" } } }
);
encounterJourneySchema.index(
  { hospitalId: 1, "physicalFile.currentHolderId": 1 },
  { name: "ag04_encounter_custody_holder" }
);

const EncounterJourney = mongoose.model("EncounterJourney", encounterJourneySchema);

export default EncounterJourney;
