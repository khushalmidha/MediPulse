import { Router } from "express";
import validateStaff, { requireRole } from "../middleware/validateStaff.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";
import {
  createTariffHandler,
  getTariffsHandler,
  createInpatientInvoiceHandler,
  getInpatientInvoicesHandler,
  getInvoiceByIdHandler,
  accrueBedDaysHandler,
  registerTpaPreAuthHandler,
  getTpaPreAuthsHandler,
  applyTpaPreAuthToInvoiceHandler,
  recordInvoicePaymentHandler,
  issueCreditNoteHandler,
  createGoodsReceiptNoteHandler,
  getGoodsReceiptNotesHandler,
  getGoodsReceiptNoteByNumberHandler,
  verifyAndReconcileGrnHandler,
  getCentralStoreStockHandler,
  getWardStockHandler,
  requestWardStockHandler,
  getWardStockRequisitionsHandler,
  getWardStockRequisitionByNumberHandler,
  fulfillWardStockTransferHandler,
} from "../controller/hospitalRevenueStock.js";

const hospitalRevenueStockRouter = Router();
hospitalRevenueStockRouter.use(nosqlGuard);

// 1. Tariffs
hospitalRevenueStockRouter.post(
  "/tariffs",
  validateStaff,
  requireRole("HOSPITAL_ADMIN"),
  createTariffHandler
);
hospitalRevenueStockRouter.get(
  "/tariffs",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "PHARMACIST"),
  getTariffsHandler
);

// 2. Inpatient Invoices & Folio
hospitalRevenueStockRouter.post(
  "/invoices",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "RECEPTIONIST"),
  createInpatientInvoiceHandler
);
hospitalRevenueStockRouter.get(
  "/invoices",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"),
  getInpatientInvoicesHandler
);
hospitalRevenueStockRouter.get(
  "/invoices/:id",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"),
  getInvoiceByIdHandler
);
hospitalRevenueStockRouter.post(
  "/invoices/:id/accrue-bed-days",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "RECEPTIONIST"),
  accrueBedDaysHandler
);

// 3. TPA Pre-Authorizations & Split Billing
hospitalRevenueStockRouter.post(
  "/tpa-pre-auths",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "RECEPTIONIST"),
  registerTpaPreAuthHandler
);
hospitalRevenueStockRouter.get(
  "/tpa-pre-auths",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"),
  getTpaPreAuthsHandler
);
hospitalRevenueStockRouter.post(
  "/invoices/:id/apply-tpa",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "RECEPTIONIST"),
  applyTpaPreAuthToInvoiceHandler
);

// 4. Payments & Credit Notes
hospitalRevenueStockRouter.post(
  "/invoices/:id/payments",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "RECEPTIONIST"),
  recordInvoicePaymentHandler
);
hospitalRevenueStockRouter.post(
  "/invoices/:id/credit-notes",
  validateStaff,
  requireRole("HOSPITAL_ADMIN"),
  issueCreditNoteHandler
);

// 5. Procurement & GRN
hospitalRevenueStockRouter.post(
  "/grn",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "PHARMACIST"),
  createGoodsReceiptNoteHandler
);
hospitalRevenueStockRouter.get(
  "/grn",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "PHARMACIST"),
  getGoodsReceiptNotesHandler
);
hospitalRevenueStockRouter.get(
  "/grn/:grnNumber",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "PHARMACIST"),
  getGoodsReceiptNoteByNumberHandler
);
hospitalRevenueStockRouter.post(
  "/grn/:grnNumber/reconcile",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "PHARMACIST"),
  verifyAndReconcileGrnHandler
);

// 6. Central Store Stock
hospitalRevenueStockRouter.get(
  "/stock/central",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "PHARMACIST", "DOCTOR", "NURSE"),
  getCentralStoreStockHandler
);

// 7. Ward Stock
hospitalRevenueStockRouter.get(
  "/stock/ward",
  validateStaff,
  requireRole("HOSPITAL_ADMIN", "PHARMACIST", "DOCTOR", "NURSE"),
  getWardStockHandler
);

// 8. Ward Stock Requisitions & Transfers
hospitalRevenueStockRouter.post(
  "/stock/requisitions",
  validateStaff,
  requireRole("NURSE", "DOCTOR", "HOSPITAL_ADMIN"),
  requestWardStockHandler
);
hospitalRevenueStockRouter.get(
  "/stock/requisitions",
  validateStaff,
  requireRole("NURSE", "DOCTOR", "HOSPITAL_ADMIN", "PHARMACIST"),
  getWardStockRequisitionsHandler
);
hospitalRevenueStockRouter.get(
  "/stock/requisitions/:requisitionNumber",
  validateStaff,
  requireRole("NURSE", "DOCTOR", "HOSPITAL_ADMIN", "PHARMACIST"),
  getWardStockRequisitionByNumberHandler
);
hospitalRevenueStockRouter.post(
  "/stock/requisitions/:requisitionNumber/fulfill",
  validateStaff,
  requireRole("PHARMACIST", "HOSPITAL_ADMIN"),
  fulfillWardStockTransferHandler
);

export default hospitalRevenueStockRouter;
