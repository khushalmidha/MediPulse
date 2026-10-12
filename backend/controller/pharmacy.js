import { receivePharmacyBatch } from "../services/pharmacyFulfillment.js";
import { listClinicalRecords, loadClinicalRecord, patientClinicalRecords, pick } from "../services/clinicalOrderAccess.js";
import asyncHandler from "../middleware/asyncHandler.js";
import PharmacyInventory from "../model/pharmacyInventory.js";
import Prescription from "../model/prescription.js";
import {
  createPrescription,
  dispensePrescription,
  returnPrescriptionItems,
  verifyPrescriptionQR,
} from "../services/pharmacyService.js";

const getHospitalIdFromReq = (req) => {
  return req.staff?.hospitalId;
};

export const listPharmacyInventory = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const items = await PharmacyInventory.find({ hospitalId, isActive: true }).sort({ medicationName: 1 });
  return res.json({ inventory: items.map(item => ({ ...pick(item, ["_id", "hospitalId", "medicationCode", "medicationName", "genericName", "dosageForm", "strength", "unitPriceMinor", "totalStock", "reorderThreshold", "isActive"]),
    batches: item.batches.map(batch => pick(batch, ["_id", "batchNumber", "expiryDate", "quantityAvailable", "quantityReserved", "quantityQuarantined"])) })) });
});

export const createPharmacyItem = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const { medicationCode, medicationName, genericName, dosageForm, strength, unitPriceMinor, reorderThreshold } = req.body;
  if (!medicationCode || !medicationName) {
    return res.status(400).json({ message: "Medication code and name are required" });
  }

  const existing = await PharmacyInventory.findOne({ hospitalId, medicationCode: medicationCode.trim().toUpperCase() });
  if (existing) {
    return res.status(409).json({ message: "Medication code already exists in this hospital pharmacy catalog" });
  }

  const item = new PharmacyInventory({
    hospitalId,
    medicationCode: medicationCode.trim().toUpperCase(),
    medicationName: medicationName.trim(),
    genericName: genericName?.trim() || "",
    dosageForm: dosageForm || "tablet",
    strength: strength?.trim() || "",
    unitPriceMinor: Number(unitPriceMinor) || 0,
    reorderThreshold: Number(reorderThreshold) || 20,
    batches: [],
    totalStock: 0,
  });

  await item.save();
  return res.status(201).json({ message: "Medication item created", item });
});

export const addInventoryBatch = asyncHandler(async (req, res) => {
  const inventory = await receivePharmacyBatch({
    inventoryId: req.params.id, hospitalId: req.staff.hospitalId, actor: req.staff,
    requestKey: req.get("Idempotency-Key"), batchNumber: req.body.batchNumber,
    expiryDate: req.body.expiryDate, quantity: req.body.quantity,
  });
  return res.status(201).json({ message: "Inventory receipt recorded", inventory });
});

export const postCreatePrescription = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const prescription = await createPrescription({
    hospitalId,
    encounterJourneyId: req.body.encounterJourneyId,
    tokenId: req.body.tokenId,
    patientId: req.body.patientId,
    familyMemberId: req.body.familyMemberId,
    personKey: req.body.personKey,
    departmentId: req.body.departmentId,
    serviceDepartmentId: req.body.serviceDepartmentId,
    patientInfo: req.body.patientInfo,
    prescribingDoctorId: req.staff.id,
    prescribingDoctorName: req.staff.name || "Attending Physician",
    diagnosis: req.body.diagnosis,
    items: req.body.items,
    actor: { id: req.staff.id, name: req.staff.name, role: req.staff.role },
  });

  return res.status(201).json({ message: "Prescription approved by clinician", prescription });
});

export const listPrescriptions = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const prescriptions = await listClinicalRecords(Prescription, req.staff, "pharmacy", req.query);
  return res.json({ prescriptions });
});

export const getPrescriptionById = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  const { id } = req.params;

  const prescription = await loadClinicalRecord(Prescription, id, hospitalId, req.staff, "pharmacy");

  return res.json({ prescription });
});

export const postDispensePrescription = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const prescription = await dispensePrescription({
    prescriptionId: req.params.id,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name, role: req.staff.role },
    dispenseItems: req.body.items,
    requestKey: req.get("Idempotency-Key"),
    expectedRevision: req.body.expectedRevision,
  });

  return res.json({ message: "Dispensing recorded", prescription, replayed: prescription.$locals?.replayed || false });
});

export const postReturnPrescription = asyncHandler(async (req, res) => {
  const hospitalId = getHospitalIdFromReq(req);
  if (!hospitalId) return res.status(400).json({ message: "Hospital identifier is required" });

  const prescription = await returnPrescriptionItems({
    prescriptionId: req.params.id,
    hospitalId,
    actor: { id: req.staff.id, name: req.staff.name, role: req.staff.role },
    returnItems: req.body.items,
    reason: req.body.reason,
    requestKey: req.get("Idempotency-Key"),
    expectedRevision: req.body.expectedRevision,
  });

  return res.json({ message: "Medication return recorded in quarantine", prescription, replayed: prescription.$locals?.replayed || false });
});

export const getVerifyQR = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const result = await verifyPrescriptionQR({ verificationToken: token });
  return res.json(result);
});

export const getPatientPrescriptions = asyncHandler(async (req, res) => {
  const prescriptions = await patientClinicalRecords(Prescription, req.auth, "pharmacy");
  return res.json({ prescriptions });
});
