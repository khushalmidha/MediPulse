import asyncHandler from "../middleware/asyncHandler.js";
import {
  createTariff,
  getTariffs,
  createInpatientInvoice,
  accrueBedDays,
  registerTpaPreAuth,
  applyTpaPreAuthToInvoice,
  recordInvoicePayment,
  issueCreditNote,
  createGoodsReceiptNote,
  verifyAndReconcileGrn,
  requestWardStock,
  fulfillWardStockTransfer,
  getInpatientInvoices,
  getInvoiceById,
  getTpaPreAuths,
  getCentralStoreStock,
  getWardStock,
  getGoodsReceiptNotes,
  getGoodsReceiptNoteByNumber,
  getWardStockRequisitions,
  getWardStockRequisitionByNumber,
} from "../services/hospitalRevenueStockService.js";

const getHospitalId = (req) => {
  return req.staff?.hospitalId || req.hospitalContext?.hospitalId;
};

const getActor = (req) => {
  return {
    staffId: req.staff?.id,
    role: req.staff?.role,
    name: req.staff?.name,
    email: req.staff?.email,
  };
};

// 1. Tariffs
export const createTariffHandler = asyncHandler(async (req, res) => {
  const tariff = await createTariff({
    hospitalId: getHospitalId(req),
    tariffCode: req.body.tariffCode,
    tariffName: req.body.tariffName,
    category: req.body.category,
    roomType: req.body.roomType,
    rateMinor: req.body.rateMinor,
    actor: getActor(req),
  });
  res.status(201).json({ success: true, tariff });
});

export const getTariffsHandler = asyncHandler(async (req, res) => {
  const tariffs = await getTariffs({
    hospitalId: getHospitalId(req),
    category: req.query.category || null,
  });
  res.json({ success: true, tariffs });
});

// 2. Inpatient Invoices & Folio
export const createInpatientInvoiceHandler = asyncHandler(async (req, res) => {
  const result = await createInpatientInvoice({
    hospitalId: getHospitalId(req),
    admissionId: req.body.admissionId,
    patientId: req.body.patientId,
    actor: getActor(req),
  });
  res.status(201).json(result);
});

export const getInpatientInvoicesHandler = asyncHandler(async (req, res) => {
  const result = await getInpatientInvoices({
    hospitalId: getHospitalId(req),
    status: req.query.status || null,
    patientId: req.query.patientId || null,
    admissionId: req.query.admissionId || null,
    limit: req.query.limit,
    page: req.query.page,
  });
  res.json(result);
});

export const getInvoiceByIdHandler = asyncHandler(async (req, res) => {
  const result = await getInvoiceById({
    hospitalId: getHospitalId(req),
    invoiceId: req.params.id,
  });
  res.json(result);
});

export const accrueBedDaysHandler = asyncHandler(async (req, res) => {
  const result = await accrueBedDays({
    hospitalId: getHospitalId(req),
    invoiceId: req.params.id,
    accrualDates: req.body.accrualDates,
    roomType: req.body.roomType,
    actor: getActor(req),
  });
  res.json(result);
});

// 3. Insurance TPA Pre-Authorization & Split Billing
export const registerTpaPreAuthHandler = asyncHandler(async (req, res) => {
  const result = await registerTpaPreAuth({
    hospitalId: getHospitalId(req),
    admissionId: req.body.admissionId,
    patientId: req.body.patientId,
    insuranceCompany: req.body.insuranceCompany,
    tpaName: req.body.tpaName,
    policyNumber: req.body.policyNumber,
    corporateId: req.body.corporateId,
    preAuthApprovedLimitMinor: req.body.preAuthApprovedLimitMinor,
    copayPercentage: req.body.copayPercentage,
    actor: getActor(req),
  });
  res.status(201).json(result);
});

export const getTpaPreAuthsHandler = asyncHandler(async (req, res) => {
  const result = await getTpaPreAuths({
    hospitalId: getHospitalId(req),
    admissionId: req.query.admissionId || null,
    patientId: req.query.patientId || null,
    status: req.query.status || null,
  });
  res.json(result);
});

export const applyTpaPreAuthToInvoiceHandler = asyncHandler(async (req, res) => {
  const result = await applyTpaPreAuthToInvoice({
    hospitalId: getHospitalId(req),
    invoiceId: req.params.id,
    tpaPreAuthId: req.body.tpaPreAuthId,
    actor: getActor(req),
  });
  res.json(result);
});

// 4. Payments & Credit Notes
export const recordInvoicePaymentHandler = asyncHandler(async (req, res) => {
  const result = await recordInvoicePayment({
    hospitalId: getHospitalId(req),
    invoiceId: req.params.id,
    amountMinor: req.body.amountMinor,
    paymentMode: req.body.paymentMode,
    paymentReference: req.body.paymentReference,
    actor: getActor(req),
  });
  res.json(result);
});

export const issueCreditNoteHandler = asyncHandler(async (req, res) => {
  const result = await issueCreditNote({
    hospitalId: getHospitalId(req),
    invoiceId: req.params.id,
    amountMinor: req.body.amountMinor,
    reason: req.body.reason,
    actor: getActor(req),
  });
  res.json(result);
});

// 5. Procurement & GRN
export const createGoodsReceiptNoteHandler = asyncHandler(async (req, res) => {
  const result = await createGoodsReceiptNote({
    hospitalId: getHospitalId(req),
    vendorName: req.body.vendorName,
    purchaseOrderRef: req.body.purchaseOrderRef,
    invoiceNumber: req.body.invoiceNumber,
    invoiceDate: req.body.invoiceDate,
    items: req.body.items,
    actor: getActor(req),
  });
  res.status(201).json(result);
});

export const getGoodsReceiptNotesHandler = asyncHandler(async (req, res) => {
  const result = await getGoodsReceiptNotes({
    hospitalId: getHospitalId(req),
    status: req.query.status || null,
    limit: req.query.limit,
    page: req.query.page,
  });
  res.json(result);
});

export const getGoodsReceiptNoteByNumberHandler = asyncHandler(async (req, res) => {
  const result = await getGoodsReceiptNoteByNumber({
    hospitalId: getHospitalId(req),
    grnNumber: req.params.grnNumber,
  });
  res.json(result);
});

export const verifyAndReconcileGrnHandler = asyncHandler(async (req, res) => {
  const result = await verifyAndReconcileGrn({
    hospitalId: getHospitalId(req),
    grnNumber: req.params.grnNumber,
    actor: getActor(req),
  });
  res.json(result);
});

// 6. Central Store Stock
export const getCentralStoreStockHandler = asyncHandler(async (req, res) => {
  const result = await getCentralStoreStock({
    hospitalId: getHospitalId(req),
    category: req.query.category || null,
    search: req.query.search || "",
  });
  res.json(result);
});

// 7. Ward Stock
export const getWardStockHandler = asyncHandler(async (req, res) => {
  const result = await getWardStock({
    hospitalId: getHospitalId(req),
    wardId: req.query.wardId || null,
    search: req.query.search || "",
  });
  res.json(result);
});

// 8. Ward Stock Requisitions & Transfers
export const requestWardStockHandler = asyncHandler(async (req, res) => {
  const result = await requestWardStock({
    hospitalId: getHospitalId(req),
    wardId: req.body.wardId,
    items: req.body.items,
    actor: getActor(req),
  });
  res.status(201).json(result);
});

export const getWardStockRequisitionsHandler = asyncHandler(async (req, res) => {
  const result = await getWardStockRequisitions({
    hospitalId: getHospitalId(req),
    wardId: req.query.wardId || null,
    status: req.query.status || null,
    limit: req.query.limit,
    page: req.query.page,
  });
  res.json(result);
});

export const getWardStockRequisitionByNumberHandler = asyncHandler(async (req, res) => {
  const result = await getWardStockRequisitionByNumber({
    hospitalId: getHospitalId(req),
    requisitionNumber: req.params.requisitionNumber,
  });
  res.json(result);
});

export const fulfillWardStockTransferHandler = asyncHandler(async (req, res) => {
  const result = await fulfillWardStockTransfer({
    hospitalId: getHospitalId(req),
    requisitionNumber: req.params.requisitionNumber,
    transferIdempotencyKey: req.body.transferIdempotencyKey,
    itemsToIssue: req.body.itemsToIssue,
    actor: getActor(req),
  });
  res.json(result);
});

export default {
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
};
