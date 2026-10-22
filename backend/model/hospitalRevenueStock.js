import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

// 1. Hospital Tariff Master Schema
const hospitalTariffSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    tariffCode: { type: String, required: true, trim: true, uppercase: true },
    tariffName: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["room_rent", "nursing_care", "consultation", "investigation", "procedure", "equipment"],
      required: true,
      index: true,
    },
    roomType: {
      type: String,
      enum: ["general", "semi_private", "private", "deluxe", "icu", "hdu", "all"],
      default: "all",
      index: true,
    },
    rateMinor: { type: Number, required: true, min: 0 }, // in minor currency units (e.g. paise / cents)
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

hospitalTariffSchema.index({ hospitalId: 1, tariffCode: 1 }, { unique: true });

// 2. Inpatient Invoice & Financial Folio Schema
const invoiceLineItemSchema = new mongoose.Schema({
  lineItemId: { type: String, required: true },
  tariffCode: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  accrualDate: { type: String, default: null }, // YYYY-MM-DD for room/nursing bed-day uniqueness
  unitPriceMinor: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  totalMinor: { type: Number, required: true, min: 0 },
  addedAt: { type: Date, default: Date.now },
});

const invoicePaymentSchema = new mongoose.Schema({
  receiptNumber: { type: String, required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  paymentMode: {
    type: String,
    enum: ["cash", "upi_manual", "card_pos", "tpa_settlement", "credit_note"],
    required: true,
  },
  paymentReference: { type: String, default: "" },
  receivedByStaffId: { type: objectId, ref: "HospitalStaff", default: null },
  receivedAt: { type: Date, default: Date.now },
});

const creditNoteSchema = new mongoose.Schema({
  creditNoteNumber: { type: String, required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  reason: { type: String, required: true },
  issuedByStaffId: { type: objectId, ref: "HospitalStaff", default: null },
  issuedAt: { type: Date, default: Date.now },
});

const inpatientInvoiceSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    admissionId: { type: objectId, ref: "IpdAdmission", required: true, index: true },
    patientId: { type: objectId, ref: "user", required: true, index: true },
    status: {
      type: String,
      enum: ["draft", "interim", "finalized", "settled", "cancelled"],
      default: "draft",
      index: true,
    },
    lineItems: [invoiceLineItemSchema],
    grossTotalMinor: { type: Number, default: 0, min: 0 },
    discountMinor: { type: Number, default: 0, min: 0 },
    netTotalMinor: { type: Number, default: 0, min: 0 },
    tpaPreAuthId: { type: objectId, ref: "TpaPreAuth", default: null },
    tpaApprovedMinor: { type: Number, default: 0, min: 0 },
    copayAmountMinor: { type: Number, default: 0, min: 0 },
    paidMinor: { type: Number, default: 0, min: 0 },
    balancePayableMinor: { type: Number, default: 0, min: 0 },
    payments: [invoicePaymentSchema],
    creditNotes: [creditNoteSchema],
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// 3. Corporate Insurance TPA Pre-Authorization Schema
const tpaPreAuthSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    claimNumber: { type: String, required: true, unique: true, index: true },
    admissionId: { type: objectId, ref: "IpdAdmission", required: true, index: true },
    patientId: { type: objectId, ref: "user", required: true, index: true },
    insuranceCompany: { type: String, required: true, trim: true },
    tpaName: { type: String, required: true, trim: true },
    policyNumber: { type: String, required: true, trim: true },
    corporateId: { type: String, default: "", trim: true },
    preAuthApprovedLimitMinor: { type: Number, required: true, min: 0 },
    copayPercentage: { type: Number, default: 0, min: 0, max: 100 },
    status: {
      type: String,
      enum: ["pending", "pre_auth_approved", "enhanced", "rejected", "claim_settled"],
      default: "pre_auth_approved",
      index: true,
    },
    settlementReference: { type: String, default: "" },
  },
  { timestamps: true }
);

// 4. Central Store Stock & Batches Schema
const stockBatchSchema = new mongoose.Schema({
  batchNumber: { type: String, required: true },
  expiryDate: { type: Date, required: true },
  quantity: { type: Number, required: true, min: 0 },
  unitCostMinor: { type: Number, default: 0, min: 0 },
});

const centralStoreStockSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    itemCode: { type: String, required: true, uppercase: true, trim: true },
    itemName: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["medication", "consumable", "surgical", "implant", "general"],
      default: "medication",
    },
    batches: [stockBatchSchema],
    totalQuantity: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

centralStoreStockSchema.index({ hospitalId: 1, itemCode: 1 }, { unique: true });

// 5. Ward Stock Schema
const wardStockSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    wardId: { type: objectId, ref: "Ward", required: true, index: true },
    itemCode: { type: String, required: true, uppercase: true, trim: true },
    itemName: { type: String, required: true, trim: true },
    batches: [stockBatchSchema],
    totalQuantity: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

wardStockSchema.index({ hospitalId: 1, wardId: 1, itemCode: 1 }, { unique: true });

// 6. Goods Receipt Note (GRN) Schema
const grnItemSchema = new mongoose.Schema({
  itemCode: { type: String, required: true, uppercase: true },
  itemName: { type: String, required: true },
  batchNumber: { type: String, required: true },
  expiryDate: { type: Date, required: true },
  quantityReceived: { type: Number, required: true, min: 1 },
  unitCostMinor: { type: Number, required: true, min: 0 },
  totalCostMinor: { type: Number, required: true, min: 0 },
});

const goodsReceiptNoteSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    grnNumber: { type: String, required: true, unique: true, index: true },
    vendorName: { type: String, required: true, trim: true },
    purchaseOrderRef: { type: String, default: "", trim: true },
    invoiceNumber: { type: String, required: true, trim: true },
    invoiceDate: { type: Date, required: true },
    receivedByStaffId: { type: objectId, ref: "HospitalStaff", required: true },
    items: [grnItemSchema],
    totalAmountMinor: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["draft", "received", "verified", "reconciled"],
      default: "received",
      index: true,
    },
    verifiedByStaffId: { type: objectId, ref: "HospitalStaff", default: null },
    verifiedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// 7. Ward Stock Requisition Schema
const requisitionItemSchema = new mongoose.Schema({
  itemCode: { type: String, required: true, uppercase: true },
  itemName: { type: String, required: true },
  batchNumber: { type: String, default: "" },
  quantityRequested: { type: Number, required: true, min: 1 },
  quantityIssued: { type: Number, default: 0, min: 0 },
});

const wardStockRequisitionSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    requisitionNumber: { type: String, required: true, unique: true, index: true },
    wardId: { type: objectId, ref: "Ward", required: true, index: true },
    requestedByStaffId: { type: objectId, ref: "HospitalStaff", required: true },
    items: [requisitionItemSchema],
    status: {
      type: String,
      enum: ["requested", "partially_issued", "fulfilled", "cancelled"],
      default: "requested",
      index: true,
    },
    transferIdempotencyKey: { type: String, default: null, index: true },
    transferCommands: [{ key: String, fingerprint: String, recordedAt: Date }],
    issuedByStaffId: { type: objectId, ref: "HospitalStaff", default: null },
    issuedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const HospitalTariff =
  mongoose.models.HospitalTariff || mongoose.model("HospitalTariff", hospitalTariffSchema);
export const InpatientInvoice =
  mongoose.models.InpatientInvoice || mongoose.model("InpatientInvoice", inpatientInvoiceSchema);
export const TpaPreAuth =
  mongoose.models.TpaPreAuth || mongoose.model("TpaPreAuth", tpaPreAuthSchema);
export const CentralStoreStock =
  mongoose.models.CentralStoreStock || mongoose.model("CentralStoreStock", centralStoreStockSchema);
export const WardStock =
  mongoose.models.WardStock || mongoose.model("WardStock", wardStockSchema);
export const GoodsReceiptNote =
  mongoose.models.GoodsReceiptNote || mongoose.model("GoodsReceiptNote", goodsReceiptNoteSchema);
export const WardStockRequisition =
  mongoose.models.WardStockRequisition || mongoose.model("WardStockRequisition", wardStockRequisitionSchema);

export default {
  HospitalTariff,
  InpatientInvoice,
  TpaPreAuth,
  CentralStoreStock,
  WardStock,
  GoodsReceiptNote,
  WardStockRequisition,
};
