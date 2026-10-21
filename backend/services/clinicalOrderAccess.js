import HospitalStaff from "../model/hospitalStaff.js";
import Department from "../model/department.js";
import OpdToken from "../model/opdToken.js";
import EncounterJourney from "../model/encounterJourney.js";
import User from "../model/user.js";
import { canReviewLab, labReviewDepartments } from "./labCapabilities.js";
import { accessError, idOf, requireRecordId, departmentMember, validVisitReferences } from "./hospitalAccess.js";

const doctorField = kind => kind === "lab" ? "orderingDoctorId" : "prescribingDoctorId";
const serviceRole = kind => kind === "lab" ? "LAB_TECH" : "PHARMACIST";
const same = (a, b) => idOf(a) === idOf(b);
const patientFields = ["name", "age", "gender", "phone"];
export const pick = (record, fields) => Object.fromEntries(fields.filter(key => record?.[key] !== undefined).map(key => [key, record[key]]));

// Resolve the persisted principal: a body-supplied role, name or adminAccess is never clinical authority.
export async function clinicalStaff(actor, hospitalId, { session = null } = {}) {
  requireRecordId(actor?.id, "staff");
  requireRecordId(hospitalId, "hospital");
  const staff = await HospitalStaff.findOne({ _id: actor.id, hospitalId, isActive: true, inviteStatus: "accepted" }).session(session).lean();
  if (!staff) throw accessError(403, "Active hospital staff membership is required");
  return staff;
}

async function checkPatient(token, session = null) {
  if (token.familyMemberId && !token.patientId) throw accessError(403, "Visit family identity is inconsistent");
  if (token.patientId) {
    const filter = { _id: token.patientId };
    // Historical care remains accessible after a family member is archived.
    if (token.familyMemberId) filter["familyMembers._id"] = token.familyMemberId;
    if (!await User.exists(filter).session(session)) throw accessError(403, "Visit patient identity needs reviewed repair");
  }
}

async function checkEncounter(encounterId, token, session = null) {
  if (!encounterId) return;
  requireRecordId(encounterId, "encounter");
  const encounter = await EncounterJourney.findOne({ _id: encounterId, hospitalId: token.hospitalId }).session(session).lean();
  if (!encounter || !same(encounter.tokenId, token._id)
    || !same(encounter.departmentId, token.departmentId) || !same(encounter.patientId, token.patientId)
    || !same(encounter.familyMemberId, token.familyMemberId)) throw accessError(403, "Encounter does not match this visit");
}

export async function clinicalRecordVisit(record, kind, { session = null } = {}) {
  if (!record.tokenId || !record.departmentId) throw accessError(403, "Clinical record needs reviewed visit linkage");
  const token = await OpdToken.findOne({ _id: record.tokenId, hospitalId: record.hospitalId }).session(session).lean();
  if (!token || !same(record.departmentId, token.departmentId) || !same(record.patientId, token.patientId)
    || !same(record.familyMemberId, token.familyMemberId) || !same(record[doctorField(kind)], token.doctorId)
    || record.personKey !== token.personKey || !token.patientInfo?.name
    || record.patientInfo?.name !== token.patientInfo.name || !await validVisitReferences(token, { session })) {
    throw accessError(403, "Clinical record identity does not match its visit");
  }
  await checkPatient(token, session);
  await checkEncounter(record.encounterJourneyId, token, session);
  return token;
}

export async function assertClinicalRecordAccess(staff, record, kind, { billing = false, session = null } = {}) {
  if (!same(staff.hospitalId, record.hospitalId)) throw accessError(403, "Clinical record belongs to another hospital");
  const token = await clinicalRecordVisit(record, kind, { session });
  if (billing && ["HOSPITAL_ADMIN", "RECEPTIONIST"].includes(staff.role)) return;
  if (kind === "lab" && canReviewLab(staff, record)
    && await Department.exists({ _id: record.serviceDepartmentId, hospitalId: record.hospitalId, status: "active" }).session(session)) return;
  if (staff.role === "DOCTOR" && same(staff._id, token.doctorId)) return;
  if (["NURSE", "DEPARTMENT_HEAD"].includes(staff.role) && departmentMember(staff, token.departmentId)) return;
  if (staff.role === serviceRole(kind) && record.serviceDepartmentId
    && departmentMember(staff, record.serviceDepartmentId)
    && await Department.exists({ _id: record.serviceDepartmentId, hospitalId: record.hospitalId, status: "active" }).session(session)) return;
  throw accessError(403, "You are not assigned to this clinical task");
}

export async function loadClinicalRecord(Model, id, hospitalId, actor, kind, roles, options) {
  requireRecordId(id, "clinical record");
  const staff = await clinicalStaff(actor, hospitalId, options);
  if (roles && !roles.includes(staff.role)) throw accessError(403, "This staff role cannot perform this clinical action");
  const record = await Model.findOne({ _id: id, hospitalId }).session(options?.session || null);
  if (!record) throw accessError(404, "Clinical record not found in this hospital");
  await assertClinicalRecordAccess(staff, record, kind, options);
  record.$locals.clinicalActor = { id: String(staff._id), name: staff.name, role: staff.role };
  return record;
}

export async function listClinicalRecords(Model, staff, kind, query) {
  const filter = { hospitalId: staff.hospitalId };
  for (const field of ["status", "barcode", "tokenId", "encounterJourneyId"]) {
    if (query[field] !== undefined && (typeof query[field] !== "string" || query[field].length > 100)) {
      throw accessError(400, "Invalid clinical worklist filter");
    }
  }
  if (query.tokenId) {
    requireRecordId(query.tokenId, "visit token");
    filter.tokenId = query.tokenId;
  }
  if (query.encounterJourneyId) {
    requireRecordId(query.encounterJourneyId, "encounter");
    filter.encounterJourneyId = query.encounterJourneyId;
  }
  if (staff.role === "DOCTOR") {
    const reviewDepartments = kind === "lab" ? labReviewDepartments(await clinicalStaff(staff, staff.hospitalId)) : [];
    if (reviewDepartments.length) filter.$or = [{ [doctorField(kind)]: staff.id }, { serviceDepartmentId: { $in: reviewDepartments } }];
    else filter[doctorField(kind)] = staff.id;
  }
  else if (["NURSE", "DEPARTMENT_HEAD"].includes(staff.role)) filter.departmentId = { $in: staff.departmentIds };
  else if (staff.role === serviceRole(kind)) filter.serviceDepartmentId = { $in: staff.departmentIds };
  else throw accessError(403, "Clinical task access is required");
  if (query.status) filter[kind === "lab" ? "orderStatus" : "status"] = query.status;
  if (kind === "lab" && query.barcode) filter.accessionBarcode = query.barcode;
  if (kind === "lab" && query.critical !== undefined) {
    if (query.critical !== "pending") throw accessError(400, "Invalid critical task filter");
    if (staff.role !== "DOCTOR") throw accessError(403, "Assigned clinician access is required for critical acknowledgement tasks");
    filter.orderingDoctorId = staff.id;
    filter.reportVersions = { $elemMatch: { "criticalTask.assignedDoctorId": staff.id,
      "criticalTask.createdAt": { $exists: true }, "criticalTask.acknowledgedAt": { $exists: false } } };
  }
  const records = await Model.find(filter).sort({ createdAt: -1 }).limit(100);
  const permitted = [];
  const principal = kind === "lab" ? await clinicalStaff(staff, staff.hospitalId) : { ...staff, _id: staff.id };
  for (const record of records) {
    try { await assertClinicalRecordAccess(principal, record, kind); permitted.push(record); }
    catch (error) { if (error.status !== 403) throw error; }
  }
  return permitted;
}

export async function resolveClinicalCreation(input, kind, { session = null } = {}) {
  const staff = await clinicalStaff(input.actor, input.hospitalId, { session });
  if (staff.role !== "DOCTOR") throw accessError(403, "An assigned clinician must create this order");
  let tokenId = input.tokenId;
  if (!tokenId && input.encounterJourneyId) {
    requireRecordId(input.encounterJourneyId, "encounter");
    const encounter = await EncounterJourney.findOne({ _id: input.encounterJourneyId, hospitalId: input.hospitalId }).session(session).lean();
    tokenId = encounter?.tokenId;
  }
  requireRecordId(tokenId, "visit token");
  const token = await OpdToken.findOne({ _id: tokenId, hospitalId: staff.hospitalId }).session(session).lean();
  if (!token) throw accessError(404, "Visit not found in this hospital");
  if (!same(token.doctorId, staff._id) || !departmentMember(staff, token.departmentId)
    || !await validVisitReferences(token, { session })) throw accessError(403, "Only the assigned visit doctor may order care");
  if (token.status !== "in_consultation") throw accessError(409, "Orders require an active consultation");
  if (session) {
    const locked = await OpdToken.findOneAndUpdate(
      { _id: token._id, hospitalId: staff.hospitalId, status: "in_consultation" },
      { $set: { updatedAt: new Date() } },
      { session, new: true }
    );
    if (!locked) throw accessError(409, "Orders require an active consultation");
  }
  for (const field of ["patientId", "familyMemberId", "departmentId", "personKey"]) {
    if (input[field] !== undefined && input[field] !== null && !same(input[field], token[field])) {
      throw accessError(403, "Supplied identity does not match this visit");
    }
  }
  const suppliedDoctor = input[doctorField(kind)];
  if (suppliedDoctor && !same(suppliedDoctor, staff._id)) throw accessError(403, "Supplied doctor is not the assigned clinician");
  await checkPatient(token, session);
  await checkEncounter(input.encounterJourneyId, token, session);
  if (!token.patientInfo?.name?.trim()) throw accessError(409, "Visit patient snapshot needs reviewed repair");
  const serviceDepartmentId = requireRecordId(input.serviceDepartmentId, "service department");
  if (!await Department.exists({ _id: serviceDepartmentId, hospitalId: staff.hospitalId, status: "active" }).session(session)
    || !await HospitalStaff.exists({ hospitalId: staff.hospitalId, departmentIds: serviceDepartmentId,
      role: serviceRole(kind), isActive: true, inviteStatus: "accepted" }).session(session)) {
    throw accessError(403, "Choose an active department assigned to this care service");
  }
  return {
    hospitalId: staff.hospitalId, tokenId: token._id, encounterJourneyId: input.encounterJourneyId || undefined,
    departmentId: token.departmentId, serviceDepartmentId, patientId: token.patientId,
    familyMemberId: token.familyMemberId, personKey: token.personKey, patientInfo: pick(token.patientInfo, patientFields),
    [doctorField(kind)]: staff._id,
    [kind === "lab" ? "orderingDoctorName" : "prescribingDoctorName"]: staff.name,
    actor: { id: staff._id, name: staff.name, role: staff.role },
  };
}

export function patientClinicalView(record, kind) {
  if (kind === "lab") {
    const releasedReports = (record.reportVersions || []).filter(version => Boolean(version.releasedAt));
    const isLegacyReleased = record.orderStatus === "released" && !record.workflowVersion;
    if (releasedReports.length === 0 && !isLegacyReleased) {
      return null;
    }
    const view = pick(record, ["_id", "hospitalId", "tokenId", "departmentId", "familyMemberId", "patientInfo", "createdAt", "updatedAt"]);
    view.patientInfo = pick(record.patientInfo, patientFields);
    const latestReport = releasedReports[releasedReports.length - 1] || [...(record.reportVersions || [])].reverse().find(version => version.releasedAt);
    Object.assign(view, pick(record, ["orderingDoctorName", "releasedAt", "reportVersion"]));
    view.orderStatus = "released";
    view.documentStatus = releasedReports.length > 1 ? "amended" : "released";
    if (latestReport) {
      view.reportVersion = latestReport.version;
      view.releasedAt = latestReport.releasedAt;
      view.verifiedByName = latestReport.verifiedByName;
    }
    view.tests = (record.tests || []).map(item => pick(item, ["testCode", "testName", "category"]));
    view.results = (latestReport?.results || record.results || []).map(item => pick(item, ["testCode", "parameterCode", "parameterName", "value", "unit", "referenceRangeText", "flag", "isCritical"]));
    if (releasedReports.length > 1) {
      view.amendmentHistory = releasedReports.slice(0, -1).map(v => ({
        version: v.version,
        releasedAt: v.releasedAt,
        verifiedByName: v.verifiedByName,
        reason: v.correctionReason || "Amended report version",
        status: "amended",
        results: (v.results || []).map(item => pick(item, ["testCode", "parameterCode", "parameterName", "value", "unit", "referenceRangeText", "flag", "isCritical"])),
      }));
    }
    return view;
  } else {
    if (!["approved_by_doctor", "partially_dispensed", "dispensed", "returned"].includes(record.status)) {
      return null;
    }
    const view = pick(record, ["_id", "hospitalId", "tokenId", "departmentId", "familyMemberId", "patientInfo", "createdAt", "updatedAt"]);
    view.patientInfo = pick(record.patientInfo, patientFields);
    Object.assign(view, pick(record, ["status", "prescribingDoctorName", "diagnosis", "version", "dispensedAt"]));
    view.documentStatus = record.status === "partially_dispensed" ? "partially_fulfilled" : record.status;
    view.items = (record.items || []).map(item => pick(item, ["medicationCode", "medicationName", "directions", "durationDays", "quantityPrescribed", "quantityDispensed", "quantityFulfilled", "quantityReturned", "itemStatus"]));
    return view;
  }
}

export async function patientClinicalRecords(Model, auth, kind) {
  if (auth?.role !== "user") throw accessError(403, "Patient account access is required");
  const filter = { patientId: auth.id };
  if (kind === "lab") {
    filter.$or = [
      { orderStatus: "released", workflowVersion: { $exists: false } },
      { reportVersions: { $elemMatch: { releasedAt: { $exists: true, $ne: null } } } },
    ];
  } else {
    filter.status = { $in: ["approved_by_doctor", "partially_dispensed", "dispensed", "returned"] };
  }
  const records = await Model.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  const views = [];
  for (const record of records) {
    try {
      await clinicalRecordVisit(record, kind);
      const item = patientClinicalView(record, kind);
      if (item) views.push(item);
    }
    catch (error) { if (error.status !== 403) throw error; }
  }
  // Populate only the allowlisted tenant identity after integrity checks.
  return Model.populate(views, { path: "hospitalId", select: "name slug" });
}
