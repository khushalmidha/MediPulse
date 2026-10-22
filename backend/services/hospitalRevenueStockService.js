import mongoose from "mongoose";
import crypto from "crypto";
import {
  HospitalTariff,
  InpatientInvoice,
  TpaPreAuth,
  CentralStoreStock,
  WardStock,
  GoodsReceiptNote,
  WardStockRequisition,
} from "../model/hospitalRevenueStock.js";
import Hospital from "../model/hospital.js";
import { IpdAdmission, Ward } from "../model/inpatient.js";
import User from "../model/user.js";
import HospitalStaff from "../model/hospitalStaff.js";
import Department from "../model/department.js";
import { accessError } from "./hospitalAccess.js";
import { moneyTransaction } from "./moneyTransaction.js";
import { assertTenantNotSuspended, checkFeatureEntitlement } from "./saasOperationsService.js";

let testDouble = null;
export const setRevenueStockTestDouble = (double) => {
  if (process.env.NODE_ENV !== "test") throw new Error("Enterprise test adapters are only available in tests");
  testDouble = double;
};

const assertDbConnected = () => {
  if (!testDouble && mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }
};

/**
 * 1. Tariff Master
 */
export const createTariff = async ({
  hospitalId,
  tariffCode,
  tariffName,
  category,
  roomType = "all",
  rateMinor,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.createTariff) {
    return testDouble.createTariff({ hospitalId, tariffCode, tariffName, category, roomType, rateMinor, actor });
  }

  const cleanCode = String(tariffCode || "").trim().toUpperCase();
  if (!cleanCode) throw accessError(400, "Tariff code is required");
  if (!tariffName || !String(tariffName).trim()) throw accessError(400, "Tariff name is required");
  if (!category) throw accessError(400, "Tariff category is required");

  const rate = Number(rateMinor);
  if (isNaN(rate) || rate < 0) throw accessError(400, "Valid rate in minor currency units (>= 0) is required");

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  assertTenantNotSuspended(hospital);
  checkFeatureEntitlement(hospital, "enterprise_procurement");

  const existing = await HospitalTariff.findOne({ hospitalId, tariffCode: cleanCode });
  if (existing) {
    throw accessError(409, `Tariff with code '${cleanCode}' already exists in this hospital`);
  }

  const tariff = await HospitalTariff.create({
    hospitalId,
    tariffCode: cleanCode,
    tariffName: String(tariffName).trim(),
    category,
    roomType,
    rateMinor: Math.round(rate),
  });

  return tariff;
};

export const getTariffs = async ({ hospitalId, category = null }) => {
  assertDbConnected();
  if (testDouble?.getTariffs) return testDouble.getTariffs({ hospitalId, category });

  const query = { hospitalId, isActive: true };
  if (category) query.category = category;
  return await HospitalTariff.find(query).sort({ tariffCode: 1 }).lean();
};

/**
 * 2. Inpatient Invoice & Bed-Day Auto-Accrual
 */
export const createInpatientInvoice = async ({ hospitalId, admissionId, patientId, actor }) => {
  assertDbConnected();
  if (testDouble?.createInpatientInvoice) {
    return testDouble.createInpatientInvoice({ hospitalId, admissionId, patientId, actor });
  }

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  assertTenantNotSuspended(hospital);
  checkFeatureEntitlement(hospital, "enterprise_procurement");

  const invoiceNumber =
    "INV-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const invoice = await InpatientInvoice.create({
    hospitalId,
    invoiceNumber,
    admissionId,
    patientId,
    status: "draft",
    grossTotalMinor: 0,
    netTotalMinor: 0,
    balancePayableMinor: 0,
  });

  return { success: true, invoice };
};

export const accrueBedDays = async ({ hospitalId, invoiceId, accrualDates = [], roomType, actor }) => {
  assertDbConnected();
  if (testDouble?.accrueBedDays) {
    return testDouble.accrueBedDays({ hospitalId, invoiceId, accrualDates, roomType, actor });
  }

  if (!Array.isArray(accrualDates) || accrualDates.length === 0) {
    throw accessError(400, "One or more accrual dates (YYYY-MM-DD) are required");
  }

  return await moneyTransaction(async (session) => {
    const invoice = await InpatientInvoice.findOne({ _id: invoiceId, hospitalId }).session(session);
    if (!invoice) throw accessError(404, "Inpatient invoice not found");

    // Look up room tariff and nursing tariff for roomType
    const roomTariff = await HospitalTariff.findOne({
      hospitalId,
      category: "room_rent",
      roomType: { $in: [roomType, "all"] },
      isActive: true,
    }).session(session);

    const nursingTariff = await HospitalTariff.findOne({
      hospitalId,
      category: "nursing_care",
      roomType: { $in: [roomType, "all"] },
      isActive: true,
    }).session(session);

    let newlyAccruedCount = 0;

    for (const dateStr of accrualDates) {
      // Uniqueness check: cannot duplicate accrual for the same calendar date
      const alreadyAccrued = invoice.lineItems.some(
        (item) => item.category === "room_rent" && item.accrualDate === dateStr
      );
      if (alreadyAccrued) {
        continue; // Idempotent skip for already accrued bed-day
      }

      if (roomTariff) {
        invoice.lineItems.push({
          lineItemId: "LI-" + crypto.randomBytes(4).toString("hex"),
          tariffCode: roomTariff.tariffCode,
          description: `${roomTariff.tariffName} (${dateStr})`,
          category: "room_rent",
          accrualDate: dateStr,
          unitPriceMinor: roomTariff.rateMinor,
          quantity: 1,
          totalMinor: roomTariff.rateMinor,
        });
      }

      if (nursingTariff) {
        invoice.lineItems.push({
          lineItemId: "LI-" + crypto.randomBytes(4).toString("hex"),
          tariffCode: nursingTariff.tariffCode,
          description: `${nursingTariff.tariffName} (${dateStr})`,
          category: "nursing_care",
          accrualDate: dateStr,
          unitPriceMinor: nursingTariff.rateMinor,
          quantity: 1,
          totalMinor: nursingTariff.rateMinor,
        });
      }

      newlyAccruedCount++;
    }

    // Recalculate invoice gross and net
    invoice.grossTotalMinor = invoice.lineItems.reduce((acc, item) => acc + item.totalMinor, 0);
    invoice.netTotalMinor = Math.max(0, invoice.grossTotalMinor - (invoice.discountMinor || 0));

    // Recalculate balance payable considering TPA approved and payments
    invoice.balancePayableMinor = Math.max(
      0,
      invoice.netTotalMinor - (invoice.tpaApprovedMinor || 0) - (invoice.paidMinor || 0)
    );

    if (invoice.status === "draft" && newlyAccruedCount > 0) {
      invoice.status = "interim";
    }

    invoice.version = (invoice.version || 0) + 1;
    await invoice.save({ session });

    return {
      success: true,
      invoice,
      accruedDaysCount: newlyAccruedCount,
      grossTotalMinor: invoice.grossTotalMinor,
      balancePayableMinor: invoice.balancePayableMinor,
    };
  });
};

/**
 * 3. TPA Pre-Authorization & Split Billing
 */
export const registerTpaPreAuth = async ({
  hospitalId,
  admissionId,
  patientId,
  insuranceCompany,
  tpaName,
  policyNumber,
  corporateId = "",
  preAuthApprovedLimitMinor,
  copayPercentage = 0,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.registerTpaPreAuth) {
    return testDouble.registerTpaPreAuth({
      hospitalId,
      admissionId,
      patientId,
      insuranceCompany,
      tpaName,
      policyNumber,
      corporateId,
      preAuthApprovedLimitMinor,
      copayPercentage,
      actor,
    });
  }

  if (!insuranceCompany || !String(insuranceCompany).trim()) throw accessError(400, "Insurance company is required");
  if (!tpaName || !String(tpaName).trim()) throw accessError(400, "TPA name is required");
  if (!policyNumber || !String(policyNumber).trim()) throw accessError(400, "Policy number is required");

  const limit = Number(preAuthApprovedLimitMinor);
  if (isNaN(limit) || limit < 0) throw accessError(400, "Valid pre-auth approved limit in minor units is required");

  const copay = Number(copayPercentage);
  if (isNaN(copay) || copay < 0 || copay > 100) {
    throw accessError(400, "Co-pay percentage must be between 0 and 100");
  }

  const claimNumber =
    "CLM-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const preAuth = await TpaPreAuth.create({
    hospitalId,
    claimNumber,
    admissionId,
    patientId,
    insuranceCompany: String(insuranceCompany).trim(),
    tpaName: String(tpaName).trim(),
    policyNumber: String(policyNumber).trim(),
    corporateId: String(corporateId).trim(),
    preAuthApprovedLimitMinor: Math.round(limit),
    copayPercentage: copay,
    status: "pre_auth_approved",
  });

  return { success: true, preAuth };
};

export const applyTpaPreAuthToInvoice = async ({ hospitalId, invoiceId, tpaPreAuthId, actor }) => {
  assertDbConnected();
  if (testDouble?.applyTpaPreAuthToInvoice) {
    return testDouble.applyTpaPreAuthToInvoice({ hospitalId, invoiceId, tpaPreAuthId, actor });
  }

  return await moneyTransaction(async (session) => {
    const invoice = await InpatientInvoice.findOne({ _id: invoiceId, hospitalId }).session(session);
    if (!invoice) throw accessError(404, "Inpatient invoice not found");

    const preAuth = await TpaPreAuth.findOne({ _id: tpaPreAuthId, hospitalId }).session(session);
    if (!preAuth) throw accessError(404, "TPA pre-auth record not found");

    // Split billing formula:
    // Net total is split into: TPA portion and Patient Co-pay portion
    const patientPortionFraction = preAuth.copayPercentage / 100;
    const tpaMaxEligible = Math.floor(invoice.netTotalMinor * (1 - patientPortionFraction));
    const tpaApproved = Math.min(preAuth.preAuthApprovedLimitMinor, tpaMaxEligible);
    const copayAmount = invoice.netTotalMinor - tpaApproved;

    invoice.tpaPreAuthId = preAuth._id;
    invoice.tpaApprovedMinor = tpaApproved;
    invoice.copayAmountMinor = copayAmount;

    // Patient balance payable = copayAmount - paidAdvance
    invoice.balancePayableMinor = Math.max(0, copayAmount - (invoice.paidMinor || 0));

    invoice.version = (invoice.version || 0) + 1;
    await invoice.save({ session });

    return {
      success: true,
      invoice,
      splitBilling: {
        grossTotalMinor: invoice.grossTotalMinor,
        netTotalMinor: invoice.netTotalMinor,
        tpaApprovedMinor: tpaApproved,
        copayAmountMinor: copayAmount,
        patientPaidMinor: invoice.paidMinor,
        patientBalancePayableMinor: invoice.balancePayableMinor,
      },
    };
  });
};

/**
 * 4. Payments, Credit Notes & Reconciliation
 */
export const recordInvoicePayment = async ({
  hospitalId,
  invoiceId,
  amountMinor,
  paymentMode,
  paymentReference = "",
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.recordInvoicePayment) {
    return testDouble.recordInvoicePayment({ hospitalId, invoiceId, amountMinor, paymentMode, paymentReference, actor });
  }

  const amt = Number(amountMinor);
  if (isNaN(amt) || amt <= 0) throw accessError(400, "Valid positive payment amount is required");

  const validModes = ["cash", "upi_manual", "card_pos", "tpa_settlement", "credit_note"];
  if (!validModes.includes(paymentMode)) {
    throw accessError(400, `Invalid payment mode: '${paymentMode}'. Allowed: [${validModes.join(", ")}]`);
  }

  return await moneyTransaction(async (session) => {
    const invoice = await InpatientInvoice.findOne({ _id: invoiceId, hospitalId }).session(session);
    if (!invoice) throw accessError(404, "Inpatient invoice not found");

    if (["settled", "cancelled"].includes(invoice.status)) {
      throw accessError(400, `Cannot apply payment to ${invoice.status} invoice`);
    }

    if (amt > invoice.balancePayableMinor) {
      throw accessError(
        400,
        `Payment amount (${amt}) exceeds outstanding balance (${invoice.balancePayableMinor})`
      );
    }

    const receiptNumber =
      "RCP-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

    invoice.payments.push({
      receiptNumber,
      amountMinor: amt,
      paymentMode,
      paymentReference: String(paymentReference).trim(),
      receivedByStaffId: actor?.staffId || null,
      receivedAt: new Date(),
    });

    invoice.paidMinor = (invoice.paidMinor || 0) + amt;
    invoice.balancePayableMinor = Math.max(0, invoice.balancePayableMinor - amt);

    if (invoice.balancePayableMinor === 0) {
      invoice.status = "settled";
    }

    invoice.version = (invoice.version || 0) + 1;
    await invoice.save({ session });

    return {
      success: true,
      receiptNumber,
      paidMinor: invoice.paidMinor,
      balancePayableMinor: invoice.balancePayableMinor,
      status: invoice.status,
    };
  });
};

export const issueCreditNote = async ({ hospitalId, invoiceId, amountMinor, reason, actor }) => {
  assertDbConnected();
  if (testDouble?.issueCreditNote) {
    return testDouble.issueCreditNote({ hospitalId, invoiceId, amountMinor, reason, actor });
  }

  const amt = Number(amountMinor);
  if (isNaN(amt) || amt <= 0) throw accessError(400, "Valid positive credit note amount is required");
  if (!reason || !String(reason).trim()) throw accessError(400, "Credit note reason is required");

  return await moneyTransaction(async (session) => {
    const invoice = await InpatientInvoice.findOne({ _id: invoiceId, hospitalId }).session(session);
    if (!invoice) throw accessError(404, "Inpatient invoice not found");

    if (amt > invoice.netTotalMinor) {
      throw accessError(400, `Credit note amount (${amt}) exceeds invoice net total (${invoice.netTotalMinor})`);
    }

    const creditNoteNumber =
      "CRN-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

    invoice.creditNotes.push({
      creditNoteNumber,
      amountMinor: amt,
      reason: String(reason).trim(),
      issuedByStaffId: actor?.staffId || null,
      issuedAt: new Date(),
    });

    invoice.discountMinor = (invoice.discountMinor || 0) + amt;
    invoice.netTotalMinor = Math.max(0, invoice.grossTotalMinor - invoice.discountMinor);
    invoice.balancePayableMinor = Math.max(
      0,
      invoice.netTotalMinor - (invoice.tpaApprovedMinor || 0) - (invoice.paidMinor || 0)
    );

    invoice.version = (invoice.version || 0) + 1;
    await invoice.save({ session });

    return {
      success: true,
      creditNoteNumber,
      netTotalMinor: invoice.netTotalMinor,
      balancePayableMinor: invoice.balancePayableMinor,
    };
  });
};

/**
 * 5. Procurement, Goods Receipt Note (GRN) & Central Store Stock
 */
export const createGoodsReceiptNote = async ({
  hospitalId,
  vendorName,
  purchaseOrderRef = "",
  invoiceNumber,
  invoiceDate,
  items = [],
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.createGoodsReceiptNote) {
    return testDouble.createGoodsReceiptNote({
      hospitalId,
      vendorName,
      purchaseOrderRef,
      invoiceNumber,
      invoiceDate,
      items,
      actor,
    });
  }

  if (!vendorName || !String(vendorName).trim()) throw accessError(400, "Vendor name is required");
  if (!invoiceNumber || !String(invoiceNumber).trim()) throw accessError(400, "Vendor invoice number is required");
  if (!Array.isArray(items) || items.length === 0) throw accessError(400, "GRN requires at least one received item");

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  assertTenantNotSuspended(hospital);
  checkFeatureEntitlement(hospital, "enterprise_procurement");

  const validatedItems = items.map((it) => {
    const qty = Number(it.quantityReceived);
    const unitCost = Number(it.unitCostMinor);
    if (!it.itemCode || isNaN(qty) || qty < 1 || isNaN(unitCost) || unitCost < 0) {
      throw accessError(400, `Invalid GRN item specification for item ${it.itemCode || "unknown"}`);
    }
    return {
      itemCode: String(it.itemCode).trim().toUpperCase(),
      itemName: String(it.itemName || it.itemCode).trim(),
      batchNumber: String(it.batchNumber || "DEFAULT").trim(),
      expiryDate: new Date(it.expiryDate || Date.now() + 365 * 24 * 3600 * 1000),
      quantityReceived: qty,
      unitCostMinor: unitCost,
      totalCostMinor: qty * unitCost,
    };
  });

  const totalAmountMinor = validatedItems.reduce((acc, it) => acc + it.totalCostMinor, 0);

  const grnNumber =
    "GRN-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const grn = await GoodsReceiptNote.create({
    hospitalId,
    grnNumber,
    vendorName: String(vendorName).trim(),
    purchaseOrderRef: String(purchaseOrderRef).trim(),
    invoiceNumber: String(invoiceNumber).trim(),
    invoiceDate: new Date(invoiceDate || Date.now()),
    receivedByStaffId: actor?.staffId || null,
    items: validatedItems,
    totalAmountMinor,
    status: "received",
  });

  return { success: true, grn };
};

export const verifyAndReconcileGrn = async ({ hospitalId, grnNumber, actor }) => {
  assertDbConnected();
  if (testDouble?.verifyAndReconcileGrn) {
    return testDouble.verifyAndReconcileGrn({ hospitalId, grnNumber, actor });
  }

  return await moneyTransaction(async (session) => {
    const grn = await GoodsReceiptNote.findOne({ grnNumber, hospitalId }).session(session);
    if (!grn) throw accessError(404, "Goods Receipt Note not found");

    if (grn.status === "reconciled") {
      throw accessError(400, "GRN has already been reconciled into stock");
    }

    // Atomically increment central store stock for each item & batch
    for (const item of grn.items) {
      let stock = await CentralStoreStock.findOne({ hospitalId, itemCode: item.itemCode }).session(session);
      if (!stock) {
        stock = new CentralStoreStock({
          hospitalId,
          itemCode: item.itemCode,
          itemName: item.itemName,
          batches: [],
          totalQuantity: 0,
        });
      }

      const existingBatch = stock.batches.find((b) => b.batchNumber === item.batchNumber);
      if (existingBatch) {
        existingBatch.quantity += item.quantityReceived;
      } else {
        stock.batches.push({
          batchNumber: item.batchNumber,
          expiryDate: item.expiryDate,
          quantity: item.quantityReceived,
          unitCostMinor: item.unitCostMinor,
        });
      }

      stock.totalQuantity += item.quantityReceived;
      await stock.save({ session });
    }

    grn.status = "reconciled";
    grn.verifiedByStaffId = actor?.staffId || null;
    grn.verifiedAt = new Date();
    grn.version = (grn.version || 0) + 1;
    await grn.save({ session });

    return {
      success: true,
      grn,
      reconciledItemsCount: grn.items.length,
    };
  });
};

/**
 * 6. Ward Stock Requisition & Idempotent Stock Transfer
 */
export const requestWardStock = async ({ hospitalId, wardId, items = [], actor }) => {
  assertDbConnected();
  if (testDouble?.requestWardStock) {
    return testDouble.requestWardStock({ hospitalId, wardId, items, actor });
  }

  if (!wardId) throw accessError(400, "Target ward ID is required");
  if (!Array.isArray(items) || items.length === 0) throw accessError(400, "At least one requisition item is required");

  const validatedItems = items.map((it) => {
    const qty = Number(it.quantityRequested);
    if (!it.itemCode || isNaN(qty) || qty < 1) {
      throw accessError(400, `Invalid requisition quantity for item ${it.itemCode || "unknown"}`);
    }
    return {
      itemCode: String(it.itemCode).trim().toUpperCase(),
      itemName: String(it.itemName || it.itemCode).trim(),
      quantityRequested: qty,
      quantityIssued: 0,
    };
  });

  const requisitionNumber =
    "WSR-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const req = await WardStockRequisition.create({
    hospitalId,
    requisitionNumber,
    wardId,
    requestedByStaffId: actor?.staffId || null,
    items: validatedItems,
    status: "requested",
  });

  return { success: true, requisition: req };
};

export const fulfillWardStockTransfer = async ({
  hospitalId,
  requisitionNumber,
  transferIdempotencyKey,
  itemsToIssue = [],
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.fulfillWardStockTransfer) {
    return testDouble.fulfillWardStockTransfer({
      hospitalId,
      requisitionNumber,
      transferIdempotencyKey,
      itemsToIssue,
      actor,
    });
  }

  if (!transferIdempotencyKey || !String(transferIdempotencyKey).trim()) {
    throw accessError(400, "transferIdempotencyKey is required to guarantee atomic transfer deduplication");
  }

  return await moneyTransaction(async (session) => {
    const requisition = await WardStockRequisition.findOne({ requisitionNumber, hospitalId }).session(session);
    if (!requisition) throw accessError(404, "Ward stock requisition not found");

    // Idempotency check: If already fulfilled with the same idempotency key, return existing state
    if (requisition.transferIdempotencyKey === transferIdempotencyKey) {
      return {
        success: true,
        idempotentReplay: true,
        requisition,
      };
    }

    if (requisition.status === "fulfilled") {
      throw accessError(400, "Requisition has already been fulfilled");
    }

    // Process item transfers: Decrement Central Store -> Increment Ward Stock
    for (const issue of itemsToIssue) {
      const itemCode = String(issue.itemCode).trim().toUpperCase();
      const issueQty = Number(issue.quantityToIssue);
      if (isNaN(issueQty) || issueQty < 1) continue;

      const centralStock = await CentralStoreStock.findOne({ hospitalId, itemCode }).session(session);
      if (!centralStock || centralStock.totalQuantity < issueQty) {
        throw accessError(
          409,
          `Insufficient central store stock for item ${itemCode} (available: ${centralStock?.totalQuantity || 0}, requested: ${issueQty})`
        );
      }

      // Deduct from central store batches
      let remainingToDeduct = issueQty;
      for (const batch of centralStock.batches) {
        if (remainingToDeduct <= 0) break;
        if (batch.quantity <= 0) continue;

        const deduct = Math.min(batch.quantity, remainingToDeduct);
        batch.quantity -= deduct;
        remainingToDeduct -= deduct;

        // Add to Ward Stock
        let wardStock = await WardStock.findOne({ hospitalId, wardId: requisition.wardId, itemCode }).session(session);
        if (!wardStock) {
          wardStock = new WardStock({
            hospitalId,
            wardId: requisition.wardId,
            itemCode,
            itemName: centralStock.itemName,
            batches: [],
            totalQuantity: 0,
          });
        }

        const wardBatch = wardStock.batches.find((b) => b.batchNumber === batch.batchNumber);
        if (wardBatch) {
          wardBatch.quantity += deduct;
        } else {
          wardStock.batches.push({
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            quantity: deduct,
            unitCostMinor: batch.unitCostMinor,
          });
        }
        wardStock.totalQuantity += deduct;
        await wardStock.save({ session });
      }

      centralStock.totalQuantity -= issueQty;
      await centralStock.save({ session });

      // Update requisition item
      const reqItem = requisition.items.find((it) => it.itemCode === itemCode);
      if (reqItem) {
        reqItem.quantityIssued += issueQty;
      }
    }

    const allFulfilled = requisition.items.every((it) => it.quantityIssued >= it.quantityRequested);
    requisition.status = allFulfilled ? "fulfilled" : "partially_issued";
    requisition.transferIdempotencyKey = transferIdempotencyKey;
    requisition.issuedByStaffId = actor?.staffId || null;
    requisition.issuedAt = new Date();
    requisition.version = (requisition.version || 0) + 1;
    await requisition.save({ session });

    return {
      success: true,
      idempotentReplay: false,
      requisition,
      status: requisition.status,
    };
  });
};

/**
 * 7. Inpatient Invoices & Folio Queries
 */
export const getInpatientInvoices = async ({
  hospitalId,
  status = null,
  patientId = null,
  admissionId = null,
  limit = 50,
  page = 1,
}) => {
  assertDbConnected();
  if (testDouble?.getInpatientInvoices) {
    return testDouble.getInpatientInvoices({ hospitalId, status, patientId, admissionId, limit, page });
  }

  const query = { hospitalId };
  if (status) query.status = status;
  if (patientId) query.patientId = patientId;
  if (admissionId) query.admissionId = admissionId;

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (parsedPage - 1) * parsedLimit;

  const [invoices, total] = await Promise.all([
    InpatientInvoice.find(query)
      .populate("patientId", "firstName lastName email phoneNumber")
      .populate("admissionId", "admissionNumber roomNumber bedNumber careClass")
      .populate("tpaPreAuthId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    InpatientInvoice.countDocuments(query),
  ]);

  return { success: true, invoices, total, page: parsedPage, limit: parsedLimit };
};

export const getInvoiceById = async ({ hospitalId, invoiceId }) => {
  assertDbConnected();
  if (testDouble?.getInvoiceById) {
    return testDouble.getInvoiceById({ hospitalId, invoiceId });
  }

  const invoice = await InpatientInvoice.findOne({ _id: invoiceId, hospitalId })
    .populate("patientId", "firstName lastName email phoneNumber")
    .populate("admissionId", "admissionNumber roomNumber bedNumber careClass attendingDoctorId")
    .populate("tpaPreAuthId")
    .lean();

  if (!invoice) throw accessError(404, "Inpatient invoice not found");
  return { success: true, invoice };
};

/**
 * 8. TPA Pre-Authorizations Queries
 */
export const getTpaPreAuths = async ({ hospitalId, admissionId = null, patientId = null, status = null }) => {
  assertDbConnected();
  if (testDouble?.getTpaPreAuths) {
    return testDouble.getTpaPreAuths({ hospitalId, admissionId, patientId, status });
  }

  const query = { hospitalId };
  if (admissionId) query.admissionId = admissionId;
  if (patientId) query.patientId = patientId;
  if (status) query.status = status;

  const preAuths = await TpaPreAuth.find(query)
    .populate("patientId", "firstName lastName email phoneNumber")
    .populate("admissionId", "admissionNumber roomNumber bedNumber")
    .sort({ createdAt: -1 })
    .lean();

  return { success: true, preAuths };
};

/**
 * 9. Stock & Inventory Queries
 */
export const getCentralStoreStock = async ({ hospitalId, category = null, search = "" }) => {
  assertDbConnected();
  if (testDouble?.getCentralStoreStock) {
    return testDouble.getCentralStoreStock({ hospitalId, category, search });
  }

  const query = { hospitalId };
  if (category) query.category = category;
  if (search && String(search).trim()) {
    const s = String(search).trim();
    query.$or = [
      { itemCode: { $regex: s, $options: "i" } },
      { itemName: { $regex: s, $options: "i" } },
    ];
  }

  const stock = await CentralStoreStock.find(query).sort({ itemName: 1 }).lean();
  return { success: true, stock };
};

export const getWardStock = async ({ hospitalId, wardId = null, search = "" }) => {
  assertDbConnected();
  if (testDouble?.getWardStock) {
    return testDouble.getWardStock({ hospitalId, wardId, search });
  }

  const query = { hospitalId };
  if (wardId) query.wardId = wardId;
  if (search && String(search).trim()) {
    const s = String(search).trim();
    query.$or = [
      { itemCode: { $regex: s, $options: "i" } },
      { itemName: { $regex: s, $options: "i" } },
    ];
  }

  const stock = await WardStock.find(query)
    .populate("wardId", "name code")
    .sort({ itemName: 1 })
    .lean();
  return { success: true, stock };
};

/**
 * 10. Procurement (GRN) & Requisition Queries
 */
export const getGoodsReceiptNotes = async ({ hospitalId, status = null, limit = 50, page = 1 }) => {
  assertDbConnected();
  if (testDouble?.getGoodsReceiptNotes) {
    return testDouble.getGoodsReceiptNotes({ hospitalId, status, limit, page });
  }

  const query = { hospitalId };
  if (status) query.status = status;

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (parsedPage - 1) * parsedLimit;

  const [grns, total] = await Promise.all([
    GoodsReceiptNote.find(query)
      .populate("receivedByStaffId", "name role")
      .populate("verifiedByStaffId", "name role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    GoodsReceiptNote.countDocuments(query),
  ]);

  return { success: true, grns, total, page: parsedPage, limit: parsedLimit };
};

export const getGoodsReceiptNoteByNumber = async ({ hospitalId, grnNumber }) => {
  assertDbConnected();
  if (testDouble?.getGoodsReceiptNoteByNumber) {
    return testDouble.getGoodsReceiptNoteByNumber({ hospitalId, grnNumber });
  }

  const grn = await GoodsReceiptNote.findOne({ hospitalId, grnNumber })
    .populate("receivedByStaffId", "name role")
    .populate("verifiedByStaffId", "name role")
    .lean();

  if (!grn) throw accessError(404, "Goods Receipt Note not found");
  return { success: true, grn };
};

export const getWardStockRequisitions = async ({
  hospitalId,
  wardId = null,
  status = null,
  limit = 50,
  page = 1,
}) => {
  assertDbConnected();
  if (testDouble?.getWardStockRequisitions) {
    return testDouble.getWardStockRequisitions({ hospitalId, wardId, status, limit, page });
  }

  const query = { hospitalId };
  if (wardId) query.wardId = wardId;
  if (status) query.status = status;

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (parsedPage - 1) * parsedLimit;

  const [requisitions, total] = await Promise.all([
    WardStockRequisition.find(query)
      .populate("wardId", "name code")
      .populate("requestedByStaffId", "name role")
      .populate("issuedByStaffId", "name role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    WardStockRequisition.countDocuments(query),
  ]);

  return { success: true, requisitions, total, page: parsedPage, limit: parsedLimit };
};

export const getWardStockRequisitionByNumber = async ({ hospitalId, requisitionNumber }) => {
  assertDbConnected();
  if (testDouble?.getWardStockRequisitionByNumber) {
    return testDouble.getWardStockRequisitionByNumber({ hospitalId, requisitionNumber });
  }

  const requisition = await WardStockRequisition.findOne({ hospitalId, requisitionNumber })
    .populate("wardId", "name code")
    .populate("requestedByStaffId", "name role")
    .populate("issuedByStaffId", "name role")
    .lean();

  if (!requisition) throw accessError(404, "Ward stock requisition not found");
  return { success: true, requisition };
};

export default {
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
};
