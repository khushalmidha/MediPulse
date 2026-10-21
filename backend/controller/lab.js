import { listClinicalRecords, loadClinicalRecord, patientClinicalRecords, pick } from "../services/clinicalOrderAccess.js";
import { labDefinitions } from "../services/labDefinitions.js";
import { clinicalText } from "../services/clinicalOrderItems.js";
import { clinicalStaff, pick as safePick } from "../services/clinicalOrderAccess.js";
import { labReviewDepartments } from "../services/labCapabilities.js";
import { approveLabReviewer } from "../services/labWorkflow.js";
import HospitalStaff from "../model/hospitalStaff.js";
import Department from "../model/department.js";
import asyncHandler from "../middleware/asyncHandler.js";
import LabOrder from "../model/labOrder.js";
import LabTestCatalog from "../model/labTestCatalog.js";
import {
  createLabOrder,
  clearOrderBilling,
  collectSample,
  rejectSample,
  enterLabResults,
  verifyLabResults,
  releaseLabResults,
  correctLabReport,
  acknowledgeCriticalValue,
} from "../services/labService.js";

const getHospitalIdFromReq = (req) => {
  return req.staff?.hospitalId;
};

export const getLabCatalog = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const catalog = await LabTestCatalog.find({ hospitalId, isActive: true }).sort({ category: 1, name: 1 });
  return res.json({ catalog });
});

export const createLabCatalogItem = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const { category, specimenType, parameters, priceMinor = 0, turnaroundHours = 4 } = req.body;
  const code = clinicalText(req.body.code, "Test code", 80), name = clinicalText(req.body.name, "Test name", 150);
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0 || !Number.isFinite(turnaroundHours) || turnaroundHours <= 0 || turnaroundHours > 8760) return res.status(400).json({ message: "Invalid catalog price or turnaround" });
  if (!code || !name) return res.status(400).json({ message: "Test code and name are required" });

  const existing = await LabTestCatalog.findOne({ hospitalId, code: code.trim().toUpperCase() });
  if (existing) return res.status(409).json({ message: "Test code already exists in this hospital catalog" });

  const item = new LabTestCatalog({
    hospitalId,
    code: code.trim().toUpperCase(),
    name: name.trim(),
    category: category || "General",
    specimenType: specimenType || "Whole Blood",
    parameters: labDefinitions(parameters || []),
    priceMinor,
    turnaroundHours,
  });

  await item.save();
  return res.status(201).json({ message: "Catalog test created", item });
});

export const postCreateLabOrder = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const creationKey = req.get("Idempotency-Key") || req.get("x-creation-key") || req.get("x-request-key") || req.body.creationKey || req.body.requestKey;

  const order = await createLabOrder({
    hospitalId,
    encounterJourneyId: req.body.encounterJourneyId,
    tokenId: req.body.tokenId,
    patientId: req.body.patientId,
    familyMemberId: req.body.familyMemberId,
    personKey: req.body.personKey,
    departmentId: req.body.departmentId,
    serviceDepartmentId: req.body.serviceDepartmentId,
    patientInfo: req.body.patientInfo,
    orderingDoctorId: req.staff.id,
    orderingDoctorName: req.staff.name || "Attending Physician",
    tests: req.body.tests,
    clinicalNotes: req.body.clinicalNotes,
    creationKey,
    actor: { id: req.staff.id, name: req.staff.name, role: req.staff.role },
  });

  const isReplayed = Boolean(order.$locals?.replayed);
  const status = isReplayed ? 200 : 201;
  return res.status(status).json({
    message: isReplayed ? "Laboratory order replayed" : "Laboratory order placed",
    order: labStaffView(order),
    replayed: isReplayed,
  });
});

export const listLabOrders = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const orders = await listClinicalRecords(LabOrder, req.staff, "lab", req.query);
  return res.json({ orders: orders.map(labStaffView) });
});

export const getLabOrderById = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const { id } = req.params;

  const order = await loadClinicalRecord(LabOrder, id, hospitalId, req.staff, "lab");

  return res.json({ order: labStaffView(order) });
});

export const patchClearBilling = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await clearOrderBilling({
    orderId: req.params.id,
    requestKey: req.get("Idempotency-Key"),
    expectedRevision: req.body.expectedRevision,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Billing Staff", role: req.staff.role },
  });
  return res.json({ message: "Billing cleared", order: pick(order, ["_id", "orderStatus", "createdAt", "updatedAt"]) });
});

export const patchCollectSample = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await collectSample({
    orderId: req.params.id,
    requestKey: req.get("Idempotency-Key"),
    expectedRevision: req.body.expectedRevision,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Phlebotomist", role: req.staff.role },
    customBarcode: req.body.barcode,
  });
  return res.json({ message: "Sample accessioned", order: labStaffView(order), replayed: Boolean(order.$locals.replayed) });
});

export const patchRejectSample = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await rejectSample({
    orderId: req.params.id,
    requestKey: req.get("Idempotency-Key"),
    expectedRevision: req.body.expectedRevision,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Lab Staff", role: req.staff.role },
    reason: req.body.reason,
    requestRecollection: req.body.requestRecollection,
  });
  return res.json({ message: "Sample rejected", order: labStaffView(order), replayed: Boolean(order.$locals.replayed) });
});

export const postEnterLabResults = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await enterLabResults({
    orderId: req.params.id,
    requestKey: req.get("Idempotency-Key"),
    expectedRevision: req.body.expectedRevision,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Technician", role: req.staff.role },
    results: req.body.results,
  });
  return res.json({ message: "Results entered", order: labStaffView(order), replayed: Boolean(order.$locals.replayed) });
});

export const patchVerifyLabResults = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await verifyLabResults({
    orderId: req.params.id,
    requestKey: req.get("Idempotency-Key"),
    expectedRevision: req.body.expectedRevision,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Pathologist", role: req.staff.role },
  });
  return res.json({ message: "Findings verified", order: labStaffView(order), replayed: Boolean(order.$locals.replayed) });
});

export const patchReleaseLabResults = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await releaseLabResults({
    orderId: req.params.id,
    requestKey: req.get("Idempotency-Key"),
    expectedRevision: req.body.expectedRevision,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Supervisor", role: req.staff.role },
  });
  return res.json({ message: "Report released", order: labStaffView(order), replayed: Boolean(order.$locals.replayed) });
});

export const postCorrectLabReport = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await correctLabReport({
    orderId: req.params.id,
    requestKey: req.get("Idempotency-Key"),
    expectedRevision: req.body.expectedRevision,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Pathologist", role: req.staff.role },
    reason: req.body.reason,
    newResults: req.body.results,
  });
  return res.json({ message: "Corrected report version created", order: labStaffView(order), replayed: Boolean(order.$locals.replayed) });
});

export const postAcknowledgeCritical = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await acknowledgeCriticalValue({
    orderId: req.params.id,
    requestKey: req.get("Idempotency-Key"),
    expectedRevision: req.body.expectedRevision,
    reportVersion: req.body.reportVersion,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Clinician", role: req.staff.role },
  });
  return res.json({ message: "Critical alert acknowledged", order: labStaffView(order), replayed: Boolean(order.$locals.replayed) });
});

export const getPatientLabResults = asyncHandler(async (req, res) => {
  const results = await patientClinicalRecords(LabOrder, req.auth, "lab");
  return res.json({ results });
});

function labStaffView(document) {
  const order = document.toObject?.() || document;
  return safePick(order, ["_id", "hospitalId", "departmentId", "serviceDepartmentId", "tokenId", "patientId", "familyMemberId", "personKey", "encounterJourneyId", "auditHistory", "patientInfo", "orderingDoctorId", "orderingDoctorName", "clinicalNotes", "tests", "orderStatus", "accessionBarcode", "collectedAt", "collectedBy", "collectedByName", "rejectedReason", "recollectionRequested", "results", "technicianName", "verifiedByName", "verifiedAt", "releasedAt", "reportVersion", "reportVersions", "workflowVersion", "workflowRevision", "createdAt", "updatedAt"]);
}
export const getLabCapabilities = asyncHandler(async (req, res) => {
  const staff = await clinicalStaff(req.staff, req.staff.hospitalId);
  return res.json({ reviewDepartmentIds: labReviewDepartments(staff), collectionBeforeBilling: true });
});
export const postLabReviewerApproval = asyncHandler(async (req, res) => {
  const approval = await approveLabReviewer({ hospitalId: req.staff.hospitalId, actor: req.staff, staffId: req.params.staffId,
    enabled: req.body.enabled, departmentIds: req.body.departmentIds, qualificationReference: req.body.qualificationReference });
  return res.json({ approval });
});
export const getLabReviewers = asyncHandler(async (req, res) => {
  const actor = await clinicalStaff(req.staff, req.staff.hospitalId);
  if (actor.role !== "HOSPITAL_ADMIN" && !actor.adminAccess) return res.status(403).json({ message: "Hospital administration is required" });
  const search = clinicalText(req.query.search, "Staff search", 100);
  const filter = { hospitalId: actor.hospitalId, isActive: true, inviteStatus: "accepted", role: { $in: ["DOCTOR", "LAB_TECH"] } };
  if (search) filter.name = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  const records = await HospitalStaff.find(filter).sort({ name: 1, _id: 1 }).limit(101).lean();
  const departments = await Department.find({ hospitalId: actor.hospitalId, status: "active", _id: { $in: records.flatMap(s => s.departmentIds) } }).select("name").lean();
  return res.json({ truncated: records.length > 100, reviewers: records.slice(0,100).map(s => ({ _id: s._id, name: s.name, role: s.role,
    departmentIds: (s.departmentIds || []).map(String), reviewDepartmentIds: labReviewDepartments(s), approvedAt: s.labReviewApproval?.approvedAt })), departments });
});
