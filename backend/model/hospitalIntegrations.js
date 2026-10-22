import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

// 1. External Interface Contract Schema
const externalInterfaceContractSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    interfaceType: {
      type: String,
      enum: ["LIS_HL7", "LIS_ASTM", "PACS_DICOM", "SSO_SAML", "SSO_OIDC", "ABDM_BRIDGE"],
      required: true,
      index: true,
    },
    contractVersion: { type: String, required: true, trim: true },
    endpointUrl: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["configured", "active", "downtime_hold", "disabled"],
      default: "configured",
      index: true,
    },
    downtimeOwnership: {
      primaryContact: { type: String, required: true },
      escalationMinutes: { type: Number, default: 30 },
      offlineQueuePolicy: {
        type: String,
        enum: ["store_and_forward", "fail_closed"],
        default: "store_and_forward",
      },
    },
    authConfig: {
      clientId: { type: String, default: "" },
      issuerUrl: { type: String, default: "" },
      certificateFingerprint: { type: String, default: "" },
    },
    lastHeartbeat: { type: Date, default: null },
  },
  { timestamps: true }
);

externalInterfaceContractSchema.index({ hospitalId: 1, interfaceType: 1 }, { unique: true });

// 2. LIS (Laboratory Information System) Message & Replay Log
const lisMessageLogSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    messageControlId: { type: String, required: true, index: true },
    messageType: {
      type: String,
      enum: ["HL7_ORU_R01", "HL7_OML_O21", "ASTM_E1394"],
      required: true,
      index: true,
    },
    accessionNumber: { type: String, required: true, index: true },
    direction: { type: String, enum: ["inbound", "outbound"], default: "inbound" },
    payloadHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["received", "processed", "replay_queued", "error"],
      default: "received",
      index: true,
    },
    replayCount: { type: Number, default: 0, min: 0 },
    errorMessage: { type: String, default: "" },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Replace the legacy global message ID index only through reviewed migration.
lisMessageLogSchema.index({ hospitalId: 1, messageControlId: 1 }, { unique: true });

// 3. PACS / DICOM Study Reference Schema (stores metadata only, zero raw pixel bloat)
const dicomStudyReferenceSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    studyInstanceUid: { type: String, required: true, unique: true, index: true },
    accessionNumber: { type: String, required: true, index: true },
    patientId: { type: objectId, ref: "user", required: true, index: true },
    modality: {
      type: String,
      enum: ["CT", "MRI", "XR", "US", "NM", "PET", "OT"],
      required: true,
      index: true,
    },
    studyDescription: { type: String, required: true, trim: true },
    seriesCount: { type: Number, default: 1, min: 1 },
    instanceCount: { type: Number, default: 1, min: 1 },
    wadoRsUri: { type: String, required: true },
    reportSummary: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// 4. Enterprise SSO Configuration Schema
const enterpriseSsoProfileSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, unique: true, index: true },
    idpType: {
      type: String,
      enum: ["azure_ad", "okta", "generic_saml", "generic_oidc"],
      required: true,
    },
    entityId: { type: String, required: true, trim: true },
    metadataUrl: { type: String, default: "", trim: true },
    scimEnabled: { type: Boolean, default: false },
    autoProvisionRoles: [{ type: String }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// 5. Disaster Recovery & Restoration Drill Audit Schema
const disasterRecoveryAuditSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    drillId: { type: String, required: true, unique: true, index: true },
    drillDate: { type: Date, default: Date.now },
    drillType: {
      type: String,
      enum: ["cold_standby_restore", "oplog_replay_check", "failover_simulation"],
      required: true,
    },
    measuredRpoMinutes: { type: Number, required: true, min: 0 },
    measuredRtoMinutes: { type: Number, required: true, min: 0 },
    rpoTargetMet: { type: Boolean, required: true },
    rtoTargetMet: { type: Boolean, required: true },
    recordsIntegrityVerified: { type: Boolean, required: true },
    conductedBy: { type: String, required: true, trim: true },
    status: { type: String, enum: ["passed", "failed", "recorded_unverified"], required: true, index: true },
    reportedIntegrityVerified: Boolean,
    evidenceStatus: { type: String, enum: ["self_reported"] },
    auditNotes: { type: String, default: "" },
  },
  { timestamps: true }
);

export const ExternalInterfaceContract =
  mongoose.models.ExternalInterfaceContract ||
  mongoose.model("ExternalInterfaceContract", externalInterfaceContractSchema);

export const LisMessageLog =
  mongoose.models.LisMessageLog || mongoose.model("LisMessageLog", lisMessageLogSchema);

export const DicomStudyReference =
  mongoose.models.DicomStudyReference ||
  mongoose.model("DicomStudyReference", dicomStudyReferenceSchema);

export const EnterpriseSsoProfile =
  mongoose.models.EnterpriseSsoProfile ||
  mongoose.model("EnterpriseSsoProfile", enterpriseSsoProfileSchema);

export const DisasterRecoveryAudit =
  mongoose.models.DisasterRecoveryAudit ||
  mongoose.model("DisasterRecoveryAudit", disasterRecoveryAuditSchema);

export default {
  ExternalInterfaceContract,
  LisMessageLog,
  DicomStudyReference,
  EnterpriseSsoProfile,
  DisasterRecoveryAudit,
};
