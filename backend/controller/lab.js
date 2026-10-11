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
  return (
    req.params.hospitalId ||
    req.body.hospitalId ||
    req.query.hospitalId ||
    req.staffHospital?._id ||
    req.staffUser?.hospitalId ||
    req.auth?.hospitalId
  );
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
    patientId: req.body.patientId || req.auth?.id,
    patientInfo: req.body.patientInfo,
    orderingDoctorId: req.body.orderingDoctorId || req.auth?.id,
    orderingDoctorName: req.body.orderingDoctorName || req.auth?.name,
    tests: req.body.tests,
    clinicalNotes: req.body.clinicalNotes,
    actor: { id: req.auth?.id, name: req.auth?.name || "Doctor" },
  });

  return res.status(201).json({ message: "Laboratory order placed", order });
});

export const listLabOrders = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const filter = { hospitalId };
  if (req.query.status) {
    filter.orderStatus = req.query.status;
  }
  if (req.query.barcode) {
    filter.accessionBarcode = req.query.barcode;
  }

  const orders = await LabOrder.find(filter).sort({ createdAt: -1 }).limit(100);
  return res.json({ orders });
});

export const getLabOrderById = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const { id } = req.params;

  const order = await LabOrder.findOne({ _id: id, ...(hospitalId ? { hospitalId } : {}) });
  if (!order) return res.status(404).json({ message: "Laboratory order not found" });

  return res.json({ order });
});

export const patchClearBilling = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const order = await clearOrderBilling({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.auth?.id, name: req.auth?.name || "Billing Staff" },
  });
  return res.json({ message: "Billing cleared", order });
});

export const patchCollectSample = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const order = await collectSample({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.auth?.id, name: req.auth?.name || "Phlebotomist" },
    customBarcode: req.body.barcode,
  });
  return res.json({ message: "Sample accessioned", order });
});

export const patchRejectSample = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const order = await rejectSample({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.auth?.id, name: req.auth?.name || "Lab Staff" },
    reason: req.body.reason,
    requestRecollection: req.body.requestRecollection,
  });
  return res.json({ message: "Sample rejected", order });
});

export const postEnterLabResults = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const order = await enterLabResults({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.auth?.id, name: req.auth?.name || "Technician" },
    results: req.body.results,
  });
  return res.json({ message: "Results entered", order });
});

export const patchVerifyLabResults = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const order = await verifyLabResults({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.auth?.id, name: req.auth?.name || "Pathologist" },
  });
  return res.json({ message: "Findings verified", order });
});

export const patchReleaseLabResults = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const order = await releaseLabResults({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.auth?.id, name: req.auth?.name || "Supervisor" },
  });
  return res.json({ message: "Report released", order });
});

export const postCorrectLabReport = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const order = await correctLabReport({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.auth?.id, name: req.auth?.name || "Pathologist" },
    reason: req.body.reason,
    newResults: req.body.results,
  });
  return res.json({ message: "Corrected report version created", order });
});

export const postAcknowledgeCritical = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const order = await acknowledgeCriticalValue({
    orderId: req.params.id,
    hospitalId,
    actor: { id: req.auth?.id, name: req.auth?.name || "Clinician" },
  });
  return res.json({ message: "Critical alert acknowledged", order });
});

export const getPatientLabResults = asyncHandler(async (req, res) => {
  if (!req.auth || !req.auth.id) return res.status(401).json({ message: "Authentication required" });

  const orders = await LabOrder.find({
    patientId: req.auth.id,
    orderStatus: "released",
  })
    .populate("hospitalId", "name slug")
    .sort({ releasedAt: -1 })
    .lean();

  return res.json({ results: orders });
});
