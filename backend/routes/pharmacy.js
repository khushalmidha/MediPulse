import { Router } from "express";
import {
  listPharmacyInventory,
  createPharmacyItem,
  addInventoryBatch,
  postCreatePrescription,
  listPrescriptions,
  getPrescriptionById,
  postDispensePrescription,
  postReturnPrescription,
  getVerifyQR,
  getPatientPrescriptions,
} from "../controller/pharmacy.js";
import validateStaff from "../middleware/validateStaff.js";
import userValidation from "../middleware/validateUser.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";

const pharmacyRouter = Router();
pharmacyRouter.use(nosqlGuard);

// Public / Patient QR verification (privacy-controlled)
pharmacyRouter.get("/verify-qr/:token", getVerifyQR);

// Patient access to their prescriptions
pharmacyRouter.get("/patient-prescriptions", userValidation, getPatientPrescriptions);

// Inventory
pharmacyRouter.get("/inventory", validateStaff, listPharmacyInventory);
pharmacyRouter.post("/inventory", validateStaff, createPharmacyItem);
pharmacyRouter.post("/inventory/:id/batches", validateStaff, addInventoryBatch);

// Prescriptions workflow
pharmacyRouter.get("/prescriptions", validateStaff, listPrescriptions);
pharmacyRouter.post("/prescriptions", validateStaff, postCreatePrescription);
pharmacyRouter.get("/prescriptions/:id", validateStaff, getPrescriptionById);
pharmacyRouter.post("/prescriptions/:id/dispense", validateStaff, postDispensePrescription);
pharmacyRouter.post("/prescriptions/:id/return", validateStaff, postReturnPrescription);

export default pharmacyRouter;
