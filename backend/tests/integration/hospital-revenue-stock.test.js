import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import { Ward } from "../../model/inpatient.js";
import {
  HospitalTariff,
  InpatientInvoice,
  TpaPreAuth,
  CentralStoreStock,
  WardStock,
  GoodsReceiptNote,
  WardStockRequisition,
} from "../../model/hospitalRevenueStock.js";
import { localTestTargets } from "../../util/testTargets.js";
import {
  createTariff,
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
} from "../../services/hospitalRevenueStockService.js";

let uri = null;
try {
  uri = new URL(localTestTargets().mongo);
  uri.pathname = "/medipulse_test_rev_stock_" + crypto.randomBytes(6).toString("hex");
} catch {
  // Gracefully fallback when test targets not present in ambient environment
}

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id();
const departmentId = id();
const staffId = id();
const patientId = id();
const admissionId = id();
const wardId = id();
let db;

before(async (t) => {
  if (!uri) {
    t.skip("Local test targets not configured; skipping live integration tests");
    return;
  }
  try {
    await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 3000 });
    db = mongoose.connection.db;
  } catch {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
  }
});

after(async () => {
  await db?.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!db) return;
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
    await db.collection(collection.name).deleteMany({});
  }

  await Hospital.create({
    _id: hospitalId,
    name: "Fortis Memorial Enterprise Hospital",
    slug: "fortis-enterprise",
    registrationNumber: "REG-FORTIS-001",
    type: "private",
    email: "fortis-enterprise@example.test",
    address: { city: "Gurugram", state: "Haryana" },
    status: "active",
    subscription: { plan: "enterprise", status: "active" },
  });

  await Department.create({
    _id: departmentId,
    hospitalId,
    name: "Finance & Stores",
    code: "FIN-STORE",
    status: "active",
    opd: { consultationFee: 500, isActive: true },
  });

  await HospitalStaff.create({
    _id: staffId,
    hospitalId,
    departmentIds: [departmentId],
    name: "Head of Billing & Stores Rajesh Khanna",
    email: "rajesh.khanna@fortis.test",
    role: "HOSPITAL_ADMIN",
    isActive: true,
  });

  await User.create({
    _id: patientId,
    firstName: "Sunil",
    lastName: "Gavaskar",
    email: "sunil.g@test.org",
    password: "Password@123",
    gender: "male",
    phoneNumber: 9812345678,
  });

  await Ward.create({
    _id: wardId,
    hospitalId,
    name: "Surgical Step-Down",
    code: "WARD-SSD",
  });
});

test("Task AG21: Hospital Revenue, Procurement and Stock Operations (Integration)", async (t) => {
  if (!db) {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
    return;
  }

  await t.test("1. Tariff creation, bed-day auto-accrual, and TPA split billing in MongoDB", async () => {
    // 1. Create tariffs
    await createTariff({
      hospitalId,
      tariffCode: "ROOM-SSD",
      tariffName: "Step-Down Ward Bed Charge",
      category: "room_rent",
      roomType: "semi_private",
      rateMinor: 400000, // 4,000 INR
    });

    await createTariff({
      hospitalId,
      tariffCode: "NURSE-SSD",
      tariffName: "Step-Down Nursing Service",
      category: "nursing_care",
      roomType: "semi_private",
      rateMinor: 100000, // 1,000 INR
    });

    // 2. Create Inpatient Invoice
    const invRes = await createInpatientInvoice({ hospitalId, admissionId, patientId });
    assert.equal(invRes.success, true);
    const invoiceId = invRes.invoice._id;

    // 3. Accrue Bed Days: 2 days (2026-10-22, 2026-10-23)
    const accrualRes = await accrueBedDays({
      hospitalId,
      invoiceId,
      accrualDates: ["2026-10-22", "2026-10-23"],
      roomType: "semi_private",
    });
    // (4,000 + 1,000) * 2 = 10,000.00 INR = 1,000,000 paise
    assert.equal(accrualRes.grossTotalMinor, 1000000);

    // 4. Register TPA Pre-Auth & apply
    const paRes = await registerTpaPreAuth({
      hospitalId,
      admissionId,
      patientId,
      insuranceCompany: "ICICI Lombard",
      tpaName: "Vidal Health TPA",
      policyNumber: "POL-ICICI-11029",
      preAuthApprovedLimitMinor: 800000, // 8,000 INR
      copayPercentage: 10,
    });

    const splitRes = await applyTpaPreAuthToInvoice({
      hospitalId,
      invoiceId,
      tpaPreAuthId: paRes.preAuth._id,
    });
    // 90% of 10,000 = 9,000 -> capped at limit 8,000 INR (800,000 paise)
    // Copay = 2,000 INR (200,000 paise)
    assert.equal(splitRes.splitBilling.tpaApprovedMinor, 800000);
    assert.equal(splitRes.splitBilling.patientBalancePayableMinor, 200000);

    // 5. Payment of 200,000 paise settles the patient invoice
    const payRes = await recordInvoicePayment({
      hospitalId,
      invoiceId,
      amountMinor: 200000,
      paymentMode: "upi_manual",
      paymentReference: "UPI-ICICI-992211",
      actor: { staffId },
    });
    assert.equal(payRes.balancePayableMinor, 0);
    assert.equal(payRes.status, "settled");

    const savedInvoice = await InpatientInvoice.findById(invoiceId);
    assert.equal(savedInvoice.status, "settled");
    assert.equal(savedInvoice.paidMinor, 200000);
  });

  await t.test("2. Procurement GRN reconciliation and idempotent ward stock transfer", async () => {
    // 1. Create GRN
    const grnRes = await createGoodsReceiptNote({
      hospitalId,
      vendorName: "Sun Pharma Distributors",
      invoiceNumber: "INV-SUN-1002",
      invoiceDate: "2026-10-21",
      items: [
        {
          itemCode: "MED-MER-1G",
          itemName: "Meropenem 1g IV",
          batchNumber: "MERO-B-101",
          expiryDate: new Date("2028-10-21"),
          quantityReceived: 80,
          unitCostMinor: 12000,
        },
      ],
      actor: { staffId },
    });

    // 2. Reconcile GRN into Central Store
    await verifyAndReconcileGrn({
      hospitalId,
      grnNumber: grnRes.grn.grnNumber,
      actor: { staffId },
    });

    const centralStock = await CentralStoreStock.findOne({ hospitalId, itemCode: "MED-MER-1G" });
    assert.equal(centralStock.totalQuantity, 80);

    // 3. Request Ward Stock
    const reqRes = await requestWardStock({
      hospitalId,
      wardId,
      items: [{ itemCode: "MED-MER-1G", quantityRequested: 25 }],
      actor: { staffId },
    });

    // 4. Fulfill transfer
    const key = "IDEMP-TRANSFER-MERO-01";
    const transferRes = await fulfillWardStockTransfer({
      hospitalId,
      requisitionNumber: reqRes.requisition.requisitionNumber,
      transferIdempotencyKey: key,
      itemsToIssue: [{ itemCode: "MED-MER-1G", quantityToIssue: 25 }],
      actor: { staffId },
    });
    assert.equal(transferRes.idempotentReplay, false);
    assert.equal(transferRes.status, "fulfilled");

    // Central store decremented: 80 - 25 = 55
    const updatedCentral = await CentralStoreStock.findOne({ hospitalId, itemCode: "MED-MER-1G" });
    assert.equal(updatedCentral.totalQuantity, 55);

    // Ward stock incremented: 0 + 25 = 25
    const wardStock = await WardStock.findOne({ hospitalId, wardId, itemCode: "MED-MER-1G" });
    assert.equal(wardStock.totalQuantity, 25);

    // 5. Idempotent Retry with same key preserves quantities
    const retryRes = await fulfillWardStockTransfer({
      hospitalId,
      requisitionNumber: reqRes.requisition.requisitionNumber,
      transferIdempotencyKey: key,
      itemsToIssue: [{ itemCode: "MED-MER-1G", quantityToIssue: 25 }],
      actor: { staffId },
    });
    assert.equal(retryRes.idempotentReplay, true);

    const checkCentral = await CentralStoreStock.findOne({ hospitalId, itemCode: "MED-MER-1G" });
    assert.equal(checkCentral.totalQuantity, 55); // Still 55!
  });
});
