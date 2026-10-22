import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import AuthSession from "../../model/authSession.js";
import { Ward, Room, Bed, IpdAdmission } from "../../model/inpatient.js";
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
  getWardStockRequisitions,
} from "../../services/hospitalRevenueStockService.js";
import hospitalRevenueStockRouter from "../../routes/hospitalRevenueStock.js";

let uri = null;
try {
  uri = new URL(localTestTargets().mongo);
  uri.pathname = "/medipulse_test_rev_stock_" + crypto.randomBytes(6).toString("hex");
} catch {
  // Gracefully fallback when test targets not present in ambient environment
}

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id();
const foreignHospitalId = id();
const departmentId = id();
const staffId = id();
const doctorId = id();
const patientId = id();
const admissionId = id();
const wardId = id();
const roomId = id();
const bedId = id();
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

  await Hospital.create({
    _id: foreignHospitalId,
    name: "Apollo Global Foreign Hospital",
    slug: "apollo-foreign",
    registrationNumber: "REG-APOLLO-999",
    type: "private",
    email: "foreign@apollo.test",
    address: { city: "Delhi", state: "Delhi" },
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

  await Doctor.create({
    _id: doctorId,
    firstName: "Ananya",
    lastName: "Roy",
    email: "ananya.roy@fortis.test",
    password: "Password@123",
    gender: "female",
    specialization: "Internal Medicine",
    experience: { years: 10, expertise: "Internal Medicine" },
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

  await Room.create({
    _id: roomId,
    hospitalId,
    wardId,
    roomNumber: "102",
    roomType: "semi_private",
    genderSuitability: "any",
    totalBeds: 2,
  });

  await Bed.create({
    _id: bedId,
    hospitalId,
    wardId,
    roomId,
    bedNumber: "BED-01",
    status: "occupied",
    currentPatientId: patientId,
  });

  await IpdAdmission.create({
    _id: admissionId,
    hospitalId,
    admissionNumber: "ADM-SSD-2026-001",
    patientId,
    admittingDoctorId: doctorId,
    attendingDoctorId: doctorId,
    departmentId,
    currentWardId: wardId,
    currentRoomId: roomId,
    currentBedId: bedId,
    admittingDiagnosis: "Community-acquired pneumonia",
    status: "admitted",
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

  await t.test("3. Service queries for invoices, pre-auths, stock, GRN, and requisitions", async () => {
    // Test service queries directly
    const invoices = await getInpatientInvoices({ hospitalId });
    assert.equal(invoices.success, true);
    assert.ok(Array.isArray(invoices.invoices));

    const preAuths = await getTpaPreAuths({ hospitalId });
    assert.equal(preAuths.success, true);
    assert.ok(Array.isArray(preAuths.preAuths));

    const centralStock = await getCentralStoreStock({ hospitalId });
    assert.equal(centralStock.success, true);
    assert.ok(Array.isArray(centralStock.stock));

    const wardStock = await getWardStock({ hospitalId, wardId });
    assert.equal(wardStock.success, true);
    assert.ok(Array.isArray(wardStock.stock));

    const grns = await getGoodsReceiptNotes({ hospitalId });
    assert.equal(grns.success, true);
    assert.ok(Array.isArray(grns.grns));

    const requisitions = await getWardStockRequisitions({ hospitalId });
    assert.equal(requisitions.success, true);
    assert.ok(Array.isArray(requisitions.requisitions));
  });

  await t.test("4. Comprehensive HTTP Router Integration: Auth, Roles, Isolation, Splitting, Reconcile & Idempotency", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/revenue", hospitalRevenueStockRouter);
    app.use("/api/procurement", hospitalRevenueStockRouter);

    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const server = app.listen(0);
    await once(server, "listening");
    const port = server.address().port;
    const apiOrigin = `http://127.0.0.1:${port}`;

    try {
      // Helper to generate authenticated sessions
      const createStaffSession = async ({ role, adminAccess = false, hId = hospitalId }) => {
        const staffMember = await HospitalStaff.create({
          hospitalId: hId,
          departmentIds: [departmentId],
          name: `Staff Member ${role}`,
          email: `staff.${role.toLowerCase()}.${crypto.randomBytes(4).toString("hex")}@fortis.test`,
          role,
          adminAccess,
          isActive: true,
          inviteStatus: "accepted",
        });
        const sid = crypto.randomUUID();
        await AuthSession.create({
          _id: sid,
          principalId: staffMember._id,
          kind: "staff",
          authVersion: 0,
          csrfToken: "csrf-token-test",
          expiresAt: new Date(Date.now() + 600000),
        });
        const token = jwt.sign(
          {
            id: String(staffMember._id),
            sid,
            role,
            type: "staff",
            hospitalId: String(hId),
          },
          process.env.TOKEN_KEY || "local-development-signing-key-replace-before-production"
        );
        return { staff: staffMember, token };
      };

      const { token: adminToken } = await createStaffSession({ role: "HOSPITAL_ADMIN", adminAccess: true });
      const { token: receptionistToken } = await createStaffSession({ role: "RECEPTIONIST" });
      const { token: nurseToken } = await createStaffSession({ role: "NURSE" });
      const { token: pharmacistToken } = await createStaffSession({ role: "PHARMACIST" });
      const { token: foreignAdminToken } = await createStaffSession({ role: "HOSPITAL_ADMIN", adminAccess: true, hId: foreignHospitalId });

      const request = async (path, { method = "GET", token, body } = {}) => {
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${apiOrigin}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
      };

      // 4.1 Unauthenticated requests return 401
      const unauthRes = await request("/api/revenue/invoices");
      assert.equal(unauthRes.status, 401);

      // 4.2 Role boundaries
      // Only HOSPITAL_ADMIN can create tariffs: NURSE gets 403
      const nurseTariffRes = await request("/api/revenue/tariffs", {
        method: "POST",
        token: nurseToken,
        body: { tariffCode: "ICU-TEST", tariffName: "ICU Bed", category: "room_rent", rateMinor: 500000 },
      });
      assert.equal(nurseTariffRes.status, 403);

      // Only HOSPITAL_ADMIN & PHARMACIST can reconcile GRN: NURSE gets 403
      const nurseReconcileRes = await request("/api/procurement/grn/GRN-FAKE/reconcile", {
        method: "POST",
        token: nurseToken,
      });
      assert.equal(nurseReconcileRes.status, 403);

      // Only PHARMACIST & HOSPITAL_ADMIN can fulfill stock transfer: NURSE gets 403
      const nurseFulfillRes = await request("/api/procurement/stock/requisitions/WSR-FAKE/fulfill", {
        method: "POST",
        token: nurseToken,
        body: { transferIdempotencyKey: "test", itemsToIssue: [] },
      });
      assert.equal(nurseFulfillRes.status, 403);

      // 4.3 Tariff Master via Admin HTTP
      const roomTariffRes = await request("/api/revenue/tariffs", {
        method: "POST",
        token: adminToken,
        body: {
          tariffCode: "ROOM-DELUXE",
          tariffName: "Deluxe Suite Room Rent",
          category: "room_rent",
          roomType: "deluxe",
          rateMinor: 600000, // 6,000 INR
        },
      });
      assert.equal(roomTariffRes.status, 201);
      assert.equal(roomTariffRes.data.tariff.tariffCode, "ROOM-DELUXE");

      const nursingTariffRes = await request("/api/revenue/tariffs", {
        method: "POST",
        token: adminToken,
        body: {
          tariffCode: "NURSE-DELUXE",
          tariffName: "Deluxe Nursing Service",
          category: "nursing_care",
          roomType: "deluxe",
          rateMinor: 150000, // 1,500 INR
        },
      });
      assert.equal(nursingTariffRes.status, 201);

      // List tariffs (receptionist allowed)
      const listTariffsRes = await request("/api/revenue/tariffs", {
        method: "GET",
        token: receptionistToken,
      });
      assert.equal(listTariffsRes.status, 200);
      assert.ok(listTariffsRes.data.tariffs.length >= 2);

      // 4.4 Inpatient Invoice creation via HTTP
      const createInvRes = await request("/api/revenue/invoices", {
        method: "POST",
        token: receptionistToken,
        body: { admissionId, patientId },
      });
      assert.equal(createInvRes.status, 201);
      const httpInvoiceId = createInvRes.data.invoice._id;

      // 4.5 Auto-accrue bed-days via HTTP (2 days)
      const accrueRes = await request(`/api/revenue/invoices/${httpInvoiceId}/accrue-bed-days`, {
        method: "POST",
        token: receptionistToken,
        body: {
          accrualDates: ["2026-10-24", "2026-10-25"],
          roomType: "deluxe",
        },
      });
      assert.equal(accrueRes.status, 200);
      // (6,000 + 1,500) * 2 = 15,000.00 INR = 1,500,000 paise
      assert.equal(accrueRes.data.grossTotalMinor, 1500000);
      assert.equal(accrueRes.data.accruedDaysCount, 2);

      // 4.6 Register TPA Pre-Auth via HTTP
      const registerTpaRes = await request("/api/revenue/tpa-pre-auths", {
        method: "POST",
        token: receptionistToken,
        body: {
          admissionId,
          patientId,
          insuranceCompany: "Star Health Insurance",
          tpaName: "Medi Assist TPA",
          policyNumber: "POL-STAR-55109",
          corporateId: "CORP-TECH-88",
          preAuthApprovedLimitMinor: 1200000, // 12,000 INR
          copayPercentage: 10,
        },
      });
      assert.equal(registerTpaRes.status, 201);
      const httpTpaId = registerTpaRes.data.preAuth._id;

      // 4.7 Apply TPA Split Billing via HTTP
      const applyTpaRes = await request(`/api/revenue/invoices/${httpInvoiceId}/apply-tpa`, {
        method: "POST",
        token: receptionistToken,
        body: { tpaPreAuthId: httpTpaId },
      });
      assert.equal(applyTpaRes.status, 200);
      // 90% of 15,000 = 13,500 -> capped at 12,000 INR (1,200,000 paise)
      // Patient copay = 3,000 INR (300,000 paise)
      assert.equal(applyTpaRes.data.splitBilling.tpaApprovedMinor, 1200000);
      assert.equal(applyTpaRes.data.splitBilling.copayAmountMinor, 300000);
      assert.equal(applyTpaRes.data.splitBilling.patientBalancePayableMinor, 300000);

      // 4.8 Issue Credit Note Discount via HTTP (Admin only)
      const creditNoteRes = await request(`/api/revenue/invoices/${httpInvoiceId}/credit-notes`, {
        method: "POST",
        token: adminToken,
        body: {
          amountMinor: 50000, // 500 INR courtesy discount
          reason: "Hospital Executive Courtesy Discount",
        },
      });
      assert.equal(creditNoteRes.status, 200);
      assert.ok(creditNoteRes.data.creditNoteNumber.startsWith("CRN-"));

      // 4.9 Record Payment via HTTP
      const currentInvoice = await request(`/api/revenue/invoices/${httpInvoiceId}`, {
        token: receptionistToken,
      });
      const balanceToPay = currentInvoice.data.invoice.balancePayableMinor;
      assert.ok(balanceToPay > 0);

      const payRes = await request(`/api/revenue/invoices/${httpInvoiceId}/payments`, {
        method: "POST",
        token: receptionistToken,
        body: {
          amountMinor: balanceToPay,
          paymentMode: "card_pos",
          paymentReference: "POS-HDFC-991122",
        },
      });
      assert.equal(payRes.status, 200);
      assert.equal(payRes.data.balancePayableMinor, 0);
      assert.equal(payRes.data.status, "settled");

      // 4.10 Procurement GRN creation via HTTP (Pharmacist)
      const createGrnRes = await request("/api/procurement/grn", {
        method: "POST",
        token: pharmacistToken,
        body: {
          vendorName: "Cipla Healthcare Supply",
          purchaseOrderRef: "PO-CIPLA-8812",
          invoiceNumber: "INV-CIPLA-4411",
          invoiceDate: "2026-10-22",
          items: [
            {
              itemCode: "MED-PAR-100",
              itemName: "Paracetamol 100ml IV",
              batchNumber: "PARA-OCT26",
              expiryDate: new Date("2028-05-01"),
              quantityReceived: 100,
              unitCostMinor: 4500, // 45 INR
            },
          ],
        },
      });
      assert.equal(createGrnRes.status, 201);
      const httpGrnNumber = createGrnRes.data.grn.grnNumber;

      // 4.11 Reconcile GRN into Central Store Stock via HTTP
      const reconcileRes = await request(`/api/procurement/grn/${httpGrnNumber}/reconcile`, {
        method: "POST",
        token: pharmacistToken,
      });
      assert.equal(reconcileRes.status, 200);
      assert.equal(reconcileRes.data.reconciledItemsCount, 1);

      // Double-reconciliation rejected with 400
      const doubleReconcileRes = await request(`/api/procurement/grn/${httpGrnNumber}/reconcile`, {
        method: "POST",
        token: pharmacistToken,
      });
      assert.equal(doubleReconcileRes.status, 400);

      // Verify central store stock
      const centralStockRes = await request("/api/procurement/stock/central?search=PAR", {
        token: pharmacistToken,
      });
      assert.equal(centralStockRes.status, 200);
      const parStock = centralStockRes.data.stock.find((s) => s.itemCode === "MED-PAR-100");
      assert.ok(parStock);
      assert.equal(parStock.totalQuantity, 100);

      // 4.12 Ward Nurse requests stock requisition via HTTP
      const reqStockRes = await request("/api/procurement/stock/requisitions", {
        method: "POST",
        token: nurseToken,
        body: {
          wardId,
          items: [{ itemCode: "MED-PAR-100", quantityRequested: 30 }],
        },
      });
      assert.equal(reqStockRes.status, 201);
      const httpReqNumber = reqStockRes.data.requisition.requisitionNumber;

      // 4.13 Pharmacist fulfills stock transfer via HTTP with transferIdempotencyKey
      const httpKey = "IDEMP-KEY-PARA-HTTP-01";
      const fulfillRes = await request(`/api/procurement/stock/requisitions/${httpReqNumber}/fulfill`, {
        method: "POST",
        token: pharmacistToken,
        body: {
          transferIdempotencyKey: httpKey,
          itemsToIssue: [{ itemCode: "MED-PAR-100", quantityToIssue: 30 }],
        },
      });
      assert.equal(fulfillRes.status, 200);
      assert.equal(fulfillRes.data.idempotentReplay, false);
      assert.equal(fulfillRes.data.status, "fulfilled");

      // Verify central stock decremented: 100 - 30 = 70
      const centralStockAfter = await CentralStoreStock.findOne({ hospitalId, itemCode: "MED-PAR-100" });
      assert.equal(centralStockAfter.totalQuantity, 70);

      // Verify ward stock incremented: 30
      const wardStockAfter = await WardStock.findOne({ hospitalId, wardId, itemCode: "MED-PAR-100" });
      assert.equal(wardStockAfter.totalQuantity, 30);

      // 4.14 Idempotent transfer replay via HTTP does NOT duplicate or deduct again
      const replayRes = await request(`/api/procurement/stock/requisitions/${httpReqNumber}/fulfill`, {
        method: "POST",
        token: pharmacistToken,
        body: {
          transferIdempotencyKey: httpKey,
          itemsToIssue: [{ itemCode: "MED-PAR-100", quantityToIssue: 30 }],
        },
      });
      assert.equal(replayRes.status, 200);
      assert.equal(replayRes.data.idempotentReplay, true);

      const centralStockReplay = await CentralStoreStock.findOne({ hospitalId, itemCode: "MED-PAR-100" });
      assert.equal(centralStockReplay.totalQuantity, 70); // Still 70!

      // 4.15 Tenant Isolation: Foreign hospital staff cannot see Fortis invoice
      const foreignInvRes = await request(`/api/revenue/invoices/${httpInvoiceId}`, {
        token: foreignAdminToken,
      });
      assert.equal(foreignInvRes.status, 404);
    } finally {
      server.close();
    }
  });
});
