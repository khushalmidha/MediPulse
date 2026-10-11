import { listClinicalRecords, loadClinicalRecord, patientClinicalRecords, pick } from "../services/clinicalOrderAccess.js";
import mongoose from "mongoose";
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

  const { code, name, category, specimenType, parameters, priceMinor, turnaroundHours } = req.body;
  if (!code || !name) return res.status(400).json({ message: "Test code and name are required" });

  const existing = await LabTestCatalog.findOne({ hospitalId, code: code.trim().toUpperCase() });
  if (existing) return res.status(409).json({ message: "Test code already exists in this hospital catalog" });

  const item = new LabTestCatalog({
    hospitalId,
    code: code.trim().toUpperCase(),
    name: name.trim(),
    category: category || "General",
    specimenType: specimenType || "Whole Blood",
    parameters: Array.isArray(parameters) ? parameters : [],
    priceMinor: Number(priceMinor) || 0,
    turnaroundHours: Number(turnaroundHours) || 4,
  });

  await item.save();
  return res.status(201).json({ message: "Catalog test created", item });
});

export const postCreateLabOrder = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

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
    actor: { id: req.staff.id, name: req.staff.name, role: req.staff.role },
  });

  return res.status(201).json({ message: "Laboratory order placed", order });
});

export const listLabOrders = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const orders = await listClinicalRecords(LabOrder, req.staff, "lab", req.query);
  return res.json({ orders });
});

export const getLabOrderById = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const { id } = req.params;

  const order = await loadClinicalRecord(LabOrder, id, hospitalId, req.staff, "lab");

  return res.json({ order });
});

export const patchClearBilling = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await clearOrderBilling({
    orderId: req.params.id,
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
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Phlebotomist", role: req.staff.role },
    customBarcode: req.body.barcode,
  });
  return res.json({ message: "Sample accessioned", order });
});

export const patchRejectSample = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await rejectSample({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Lab Staff", role: req.staff.role },
    reason: req.body.reason,
    requestRecollection: req.body.requestRecollection,
  });
  return res.json({ message: "Sample rejected", order });
});

export const postEnterLabResults = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await enterLabResults({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Technician", role: req.staff.role },
    results: req.body.results,
  });
  return res.json({ message: "Results entered", order });
});

export const patchVerifyLabResults = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await verifyLabResults({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Pathologist", role: req.staff.role },
  });
  return res.json({ message: "Findings verified", order });
});

export const patchReleaseLabResults = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await releaseLabResults({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Supervisor", role: req.staff.role },
  });
  return res.json({ message: "Report released", order });
});

export const postCorrectLabReport = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await correctLabReport({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Pathologist", role: req.staff.role },
    reason: req.body.reason,
    newResults: req.body.results,
  });
  return res.json({ message: "Corrected report version created", order });
});

export const postAcknowledgeCritical = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });
  const order = await acknowledgeCriticalValue({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name || "Clinician", role: req.staff.role },
  });
  return res.json({ message: "Critical alert acknowledged", order });
});

export const getPatientLabResults = asyncHandler(async (req, res) => {
  const results = await patientClinicalRecords(LabOrder, req.auth, "lab");
  return res.json({ results });
});
