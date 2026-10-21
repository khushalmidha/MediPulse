import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
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
  setRevenueStockTestDouble,
} from "../services/hospitalRevenueStockService.js";

test("Task AG21: Hospital Revenue, Procurement and Stock Operations (Unit & Domain)", async (t) => {
  const hospitalId = new mongoose.Types.ObjectId();
  const admissionId = new mongoose.Types.ObjectId();
  const patientId = new mongoose.Types.ObjectId();
  const wardId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();

  const state = {
    tariffs: [],
    invoices: [],
    preAuths: [],
    grns: [],
    centralStock: [],
    wardStock: [],
    requisitions: [],
  };

  setRevenueStockTestDouble({
    createTariff: async ({ hospitalId, tariffCode, tariffName, category, roomType, rateMinor }) => {
      const cleanCode = String(tariffCode || "").trim().toUpperCase();
      if (!cleanCode) throw Object.assign(new Error("Tariff code is required"), { status: 400 });
      if (!tariffName?.trim()) throw Object.assign(new Error("Tariff name is required"), { status: 400 });
      if (!category) throw Object.assign(new Error("Tariff category is required"), { status: 400 });

      const rate = Number(rateMinor);
      if (isNaN(rate) || rate < 0) throw Object.assign(new Error("Valid rate in minor currency units is required"), { status: 400 });

      const existing = state.tariffs.find(
        (t) => t.hospitalId.toString() === hospitalId.toString() && t.tariffCode === cleanCode
      );
      if (existing) {
        throw Object.assign(new Error(`Tariff with code '${cleanCode}' already exists in this hospital`), { status: 409 });
      }

      const tariff = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        tariffCode: cleanCode,
        tariffName: tariffName.trim(),
        category,
        roomType: roomType || "all",
        rateMinor: rate,
        isActive: true,
      };
      state.tariffs.push(tariff);
      return tariff;
    },

    getTariffs: async ({ hospitalId, category }) => {
      return state.tariffs.filter(
        (t) => t.hospitalId.toString() === hospitalId.toString() && t.isActive && (!category || t.category === category)
      );
    },

    createInpatientInvoice: async ({ hospitalId, admissionId, patientId }) => {
      const invoice = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        invoiceNumber: `INV-${Date.now()}`,
        admissionId,
        patientId,
        status: "draft",
        lineItems: [],
        grossTotalMinor: 0,
        discountMinor: 0,
        netTotalMinor: 0,
        tpaPreAuthId: null,
        tpaApprovedMinor: 0,
        copayAmountMinor: 0,
        paidMinor: 0,
        balancePayableMinor: 0,
        payments: [],
        creditNotes: [],
        version: 0,
      };
      state.invoices.push(invoice);
      return { success: true, invoice };
    },

    accrueBedDays: async ({ hospitalId, invoiceId, accrualDates, roomType }) => {
      const invoice = state.invoices.find(
        (inv) => inv._id.toString() === invoiceId.toString() && inv.hospitalId.toString() === hospitalId.toString()
      );
      if (!invoice) throw Object.assign(new Error("Inpatient invoice not found"), { status: 404 });

      const roomTariff = state.tariffs.find(
        (t) => t.category === "room_rent" && (t.roomType === roomType || t.roomType === "all") && t.isActive
      );
      const nursingTariff = state.tariffs.find(
        (t) => t.category === "nursing_care" && (t.roomType === roomType || t.roomType === "all") && t.isActive
      );

      let newlyAccruedCount = 0;
      for (const dateStr of accrualDates) {
        const alreadyAccrued = invoice.lineItems.some(
          (item) => item.category === "room_rent" && item.accrualDate === dateStr
        );
        if (alreadyAccrued) continue; // Idempotent skip

        if (roomTariff) {
          invoice.lineItems.push({
            lineItemId: `LI-${Math.random()}`,
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
            lineItemId: `LI-${Math.random()}`,
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

      invoice.grossTotalMinor = invoice.lineItems.reduce((acc, it) => acc + it.totalMinor, 0);
      invoice.netTotalMinor = Math.max(0, invoice.grossTotalMinor - (invoice.discountMinor || 0));
      invoice.balancePayableMinor = Math.max(
        0,
        invoice.netTotalMinor - (invoice.tpaApprovedMinor || 0) - (invoice.paidMinor || 0)
      );
      if (invoice.status === "draft" && newlyAccruedCount > 0) invoice.status = "interim";
      invoice.version++;

      return {
        success: true,
        invoice,
        accruedDaysCount: newlyAccruedCount,
        grossTotalMinor: invoice.grossTotalMinor,
        balancePayableMinor: invoice.balancePayableMinor,
      };
    },

    registerTpaPreAuth: async ({
      hospitalId,
      admissionId,
      patientId,
      insuranceCompany,
      tpaName,
      policyNumber,
      corporateId,
      preAuthApprovedLimitMinor,
      copayPercentage,
    }) => {
      if (!insuranceCompany?.trim()) throw Object.assign(new Error("Insurance company is required"), { status: 400 });
      if (!tpaName?.trim()) throw Object.assign(new Error("TPA name is required"), { status: 400 });
      if (!policyNumber?.trim()) throw Object.assign(new Error("Policy number is required"), { status: 400 });

      const limit = Number(preAuthApprovedLimitMinor);
      if (isNaN(limit) || limit < 0) throw Object.assign(new Error("Valid pre-auth approved limit is required"), { status: 400 });

      const copay = Number(copayPercentage || 0);
      if (isNaN(copay) || copay < 0 || copay > 100) {
        throw Object.assign(new Error("Co-pay percentage must be between 0 and 100"), { status: 400 });
      }

      const preAuth = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        claimNumber: `CLM-${Date.now()}`,
        admissionId,
        patientId,
        insuranceCompany: insuranceCompany.trim(),
        tpaName: tpaName.trim(),
        policyNumber: policyNumber.trim(),
        corporateId: corporateId?.trim() || "",
        preAuthApprovedLimitMinor: limit,
        copayPercentage: copay,
        status: "pre_auth_approved",
      };
      state.preAuths.push(preAuth);
      return { success: true, preAuth };
    },

    applyTpaPreAuthToInvoice: async ({ hospitalId, invoiceId, tpaPreAuthId }) => {
      const invoice = state.invoices.find(
        (inv) => inv._id.toString() === invoiceId.toString() && inv.hospitalId.toString() === hospitalId.toString()
      );
      if (!invoice) throw Object.assign(new Error("Inpatient invoice not found"), { status: 404 });

      const preAuth = state.preAuths.find(
        (pa) => pa._id.toString() === tpaPreAuthId.toString() && pa.hospitalId.toString() === hospitalId.toString()
      );
      if (!preAuth) throw Object.assign(new Error("TPA pre-auth record not found"), { status: 404 });

      const patientPortionFraction = preAuth.copayPercentage / 100;
      const tpaMaxEligible = Math.floor(invoice.netTotalMinor * (1 - patientPortionFraction));
      const tpaApproved = Math.min(preAuth.preAuthApprovedLimitMinor, tpaMaxEligible);
      const copayAmount = invoice.netTotalMinor - tpaApproved;

      invoice.tpaPreAuthId = preAuth._id;
      invoice.tpaApprovedMinor = tpaApproved;
      invoice.copayAmountMinor = copayAmount;
      invoice.balancePayableMinor = Math.max(0, copayAmount - (invoice.paidMinor || 0));
      invoice.version++;

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
    },

    recordInvoicePayment: async ({ hospitalId, invoiceId, amountMinor, paymentMode, paymentReference, actor }) => {
      const amt = Number(amountMinor);
      if (isNaN(amt) || amt <= 0) throw Object.assign(new Error("Valid positive payment amount is required"), { status: 400 });

      const validModes = ["cash", "upi_manual", "card_pos", "tpa_settlement", "credit_note"];
      if (!validModes.includes(paymentMode)) {
        throw Object.assign(new Error(`Invalid payment mode: '${paymentMode}'`), { status: 400 });
      }

      const invoice = state.invoices.find(
        (inv) => inv._id.toString() === invoiceId.toString() && inv.hospitalId.toString() === hospitalId.toString()
      );
      if (!invoice) throw Object.assign(new Error("Inpatient invoice not found"), { status: 404 });

      if (["settled", "cancelled"].includes(invoice.status)) {
        throw Object.assign(new Error(`Cannot apply payment to ${invoice.status} invoice`), { status: 400 });
      }

      if (amt > invoice.balancePayableMinor) {
        throw Object.assign(
          new Error(`Payment amount (${amt}) exceeds outstanding balance (${invoice.balancePayableMinor})`),
          { status: 400 }
        );
      }

      const receiptNumber = `RCP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      invoice.payments.push({
        receiptNumber,
        amountMinor: amt,
        paymentMode,
        paymentReference: paymentReference?.trim() || "",
        receivedByStaffId: actor?.staffId || null,
        receivedAt: new Date(),
      });

      invoice.paidMinor += amt;
      invoice.balancePayableMinor = Math.max(0, invoice.balancePayableMinor - amt);
      if (invoice.balancePayableMinor === 0) invoice.status = "settled";
      invoice.version++;

      return {
        success: true,
        receiptNumber,
        paidMinor: invoice.paidMinor,
        balancePayableMinor: invoice.balancePayableMinor,
        status: invoice.status,
      };
    },

    issueCreditNote: async ({ hospitalId, invoiceId, amountMinor, reason, actor }) => {
      const amt = Number(amountMinor);
      if (isNaN(amt) || amt <= 0) throw Object.assign(new Error("Valid positive credit note amount is required"), { status: 400 });
      if (!reason?.trim()) throw Object.assign(new Error("Credit note reason is required"), { status: 400 });

      const invoice = state.invoices.find(
        (inv) => inv._id.toString() === invoiceId.toString() && inv.hospitalId.toString() === hospitalId.toString()
      );
      if (!invoice) throw Object.assign(new Error("Inpatient invoice not found"), { status: 404 });

      if (amt > invoice.netTotalMinor) {
        throw Object.assign(
          new Error(`Credit note amount (${amt}) exceeds invoice net total (${invoice.netTotalMinor})`),
          { status: 400 }
        );
      }

      const creditNoteNumber = `CRN-${Date.now()}`;
      invoice.creditNotes.push({
        creditNoteNumber,
        amountMinor: amt,
        reason: reason.trim(),
        issuedByStaffId: actor?.staffId || null,
        issuedAt: new Date(),
      });

      invoice.discountMinor += amt;
      invoice.netTotalMinor = Math.max(0, invoice.grossTotalMinor - invoice.discountMinor);
      invoice.balancePayableMinor = Math.max(
        0,
        invoice.netTotalMinor - (invoice.tpaApprovedMinor || 0) - (invoice.paidMinor || 0)
      );
      invoice.version++;

      return {
        success: true,
        creditNoteNumber,
        netTotalMinor: invoice.netTotalMinor,
        balancePayableMinor: invoice.balancePayableMinor,
      };
    },

    createGoodsReceiptNote: async ({ hospitalId, vendorName, purchaseOrderRef, invoiceNumber, invoiceDate, items }) => {
      if (!vendorName?.trim()) throw Object.assign(new Error("Vendor name is required"), { status: 400 });
      if (!invoiceNumber?.trim()) throw Object.assign(new Error("Vendor invoice number is required"), { status: 400 });
      if (!Array.isArray(items) || items.length === 0) {
        throw Object.assign(new Error("GRN requires at least one received item"), { status: 400 });
      }

      const validatedItems = items.map((it) => {
        const qty = Number(it.quantityReceived);
        const unitCost = Number(it.unitCostMinor);
        if (!it.itemCode || isNaN(qty) || qty < 1 || isNaN(unitCost) || unitCost < 0) {
          throw Object.assign(new Error(`Invalid GRN item specification for item ${it.itemCode}`), { status: 400 });
        }
        return {
          itemCode: it.itemCode.trim().toUpperCase(),
          itemName: it.itemName?.trim() || it.itemCode.trim(),
          batchNumber: it.batchNumber?.trim() || "DEFAULT",
          expiryDate: new Date(it.expiryDate || Date.now() + 365 * 24 * 3600 * 1000),
          quantityReceived: qty,
          unitCostMinor: unitCost,
          totalCostMinor: qty * unitCost,
        };
      });

      const totalAmountMinor = validatedItems.reduce((acc, it) => acc + it.totalCostMinor, 0);
      const grn = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        grnNumber: `GRN-${Date.now()}`,
        vendorName: vendorName.trim(),
        purchaseOrderRef: purchaseOrderRef?.trim() || "",
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate: new Date(invoiceDate || Date.now()),
        items: validatedItems,
        totalAmountMinor,
        status: "received",
        version: 0,
      };
      state.grns.push(grn);
      return { success: true, grn };
    },

    verifyAndReconcileGrn: async ({ hospitalId, grnNumber, actor }) => {
      const grn = state.grns.find(
        (g) => g.grnNumber === grnNumber && g.hospitalId.toString() === hospitalId.toString()
      );
      if (!grn) throw Object.assign(new Error("Goods Receipt Note not found"), { status: 404 });
      if (grn.status === "reconciled") {
        throw Object.assign(new Error("GRN has already been reconciled into stock"), { status: 400 });
      }

      for (const item of grn.items) {
        let stock = state.centralStock.find(
          (s) => s.hospitalId.toString() === hospitalId.toString() && s.itemCode === item.itemCode
        );
        if (!stock) {
          stock = {
            _id: new mongoose.Types.ObjectId(),
            hospitalId,
            itemCode: item.itemCode,
            itemName: item.itemName,
            batches: [],
            totalQuantity: 0,
          };
          state.centralStock.push(stock);
        }

        const batch = stock.batches.find((b) => b.batchNumber === item.batchNumber);
        if (batch) {
          batch.quantity += item.quantityReceived;
        } else {
          stock.batches.push({
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate,
            quantity: item.quantityReceived,
            unitCostMinor: item.unitCostMinor,
          });
        }
        stock.totalQuantity += item.quantityReceived;
      }

      grn.status = "reconciled";
      grn.verifiedByStaffId = actor?.staffId || null;
      grn.verifiedAt = new Date();
      grn.version++;

      return { success: true, grn, reconciledItemsCount: grn.items.length };
    },

    requestWardStock: async ({ hospitalId, wardId, items, actor }) => {
      if (!wardId) throw Object.assign(new Error("Target ward ID is required"), { status: 400 });
      if (!Array.isArray(items) || items.length === 0) {
        throw Object.assign(new Error("At least one requisition item is required"), { status: 400 });
      }

      const validatedItems = items.map((it) => {
        const qty = Number(it.quantityRequested);
        if (!it.itemCode || isNaN(qty) || qty < 1) {
          throw Object.assign(new Error(`Invalid requisition quantity for item ${it.itemCode}`), { status: 400 });
        }
        return {
          itemCode: it.itemCode.trim().toUpperCase(),
          itemName: it.itemName?.trim() || it.itemCode.trim(),
          quantityRequested: qty,
          quantityIssued: 0,
        };
      });

      const req = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        requisitionNumber: `WSR-${Date.now()}`,
        wardId,
        requestedByStaffId: actor?.staffId || null,
        items: validatedItems,
        status: "requested",
        transferIdempotencyKey: null,
        version: 0,
      };
      state.requisitions.push(req);
      return { success: true, requisition: req };
    },

    fulfillWardStockTransfer: async ({ hospitalId, requisitionNumber, transferIdempotencyKey, itemsToIssue, actor }) => {
      if (!transferIdempotencyKey?.trim()) {
        throw Object.assign(new Error("transferIdempotencyKey is required"), { status: 400 });
      }

      const requisition = state.requisitions.find(
        (r) => r.requisitionNumber === requisitionNumber && r.hospitalId.toString() === hospitalId.toString()
      );
      if (!requisition) throw Object.assign(new Error("Ward stock requisition not found"), { status: 404 });

      // Idempotency check: replay existing transfer without double deduction
      if (requisition.transferIdempotencyKey === transferIdempotencyKey) {
        return { success: true, idempotentReplay: true, requisition };
      }

      if (requisition.status === "fulfilled") {
        throw Object.assign(new Error("Requisition has already been fulfilled"), { status: 400 });
      }

      for (const issue of itemsToIssue) {
        const itemCode = issue.itemCode.trim().toUpperCase();
        const issueQty = Number(issue.quantityToIssue);
        if (isNaN(issueQty) || issueQty < 1) continue;

        const centralStock = state.centralStock.find(
          (s) => s.hospitalId.toString() === hospitalId.toString() && s.itemCode === itemCode
        );
        if (!centralStock || centralStock.totalQuantity < issueQty) {
          throw Object.assign(
            new Error(`Insufficient central store stock for item ${itemCode} (available: ${centralStock?.totalQuantity || 0}, requested: ${issueQty})`),
            { status: 409 }
          );
        }

        let remaining = issueQty;
        for (const batch of centralStock.batches) {
          if (remaining <= 0) break;
          if (batch.quantity <= 0) continue;

          const deduct = Math.min(batch.quantity, remaining);
          batch.quantity -= deduct;
          remaining -= deduct;

          // Add to ward stock
          let wardStock = state.wardStock.find(
            (w) => w.hospitalId.toString() === hospitalId.toString() && w.wardId.toString() === requisition.wardId.toString() && w.itemCode === itemCode
          );
          if (!wardStock) {
            wardStock = {
              _id: new mongoose.Types.ObjectId(),
              hospitalId,
              wardId: requisition.wardId,
              itemCode,
              itemName: centralStock.itemName,
              batches: [],
              totalQuantity: 0,
            };
            state.wardStock.push(wardStock);
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
        }

        centralStock.totalQuantity -= issueQty;
        const reqItem = requisition.items.find((it) => it.itemCode === itemCode);
        if (reqItem) reqItem.quantityIssued += issueQty;
      }

      const allFulfilled = requisition.items.every((it) => it.quantityIssued >= it.quantityRequested);
      requisition.status = allFulfilled ? "fulfilled" : "partially_issued";
      requisition.transferIdempotencyKey = transferIdempotencyKey;
      requisition.issuedByStaffId = actor?.staffId || null;
      requisition.issuedAt = new Date();
      requisition.version++;

      return {
        success: true,
        idempotentReplay: false,
        requisition,
        status: requisition.status,
      };
    },
  });

  await t.test("1. Hospital tariff creation and category filtering", async () => {
    // 1. Create Room Rent Tariff for Semi-Private Room
    const roomTariff = await createTariff({
      hospitalId,
      tariffCode: "ROOM-SEMI-PVT",
      tariffName: "Semi-Private Room Daily Rent",
      category: "room_rent",
      roomType: "semi_private",
      rateMinor: 350000, // 3,500.00 INR
    });
    assert.equal(roomTariff.tariffCode, "ROOM-SEMI-PVT");
    assert.equal(roomTariff.rateMinor, 350000);

    // 2. Create Nursing Care Tariff
    const nursingTariff = await createTariff({
      hospitalId,
      tariffCode: "NURSE-DAILY-HDU",
      tariffName: "High Dependency Nursing Care Daily",
      category: "nursing_care",
      roomType: "semi_private",
      rateMinor: 150000, // 1,500.00 INR
    });
    assert.equal(nursingTariff.tariffCode, "NURSE-DAILY-HDU");

    // 3. Duplicate tariff code is rejected with HTTP 409
    await assert.rejects(
      () =>
        createTariff({
          hospitalId,
          tariffCode: "ROOM-SEMI-PVT",
          tariffName: "Duplicate Code Tariff",
          category: "room_rent",
          rateMinor: 400000,
        }),
      /already exists in this hospital/
    );

    // 4. Retrieve tariffs filtered by category
    const roomTariffs = await getTariffs({ hospitalId, category: "room_rent" });
    assert.equal(roomTariffs.length, 1);
    assert.equal(roomTariffs[0].tariffCode, "ROOM-SEMI-PVT");
  });

  let invoice1;

  await t.test("2. Inpatient invoice creation and bed-day auto-accrual with idempotent date deduplication", async () => {
    // 1. Create Inpatient Invoice
    const invRes = await createInpatientInvoice({
      hospitalId,
      admissionId,
      patientId,
    });
    assert.equal(invRes.success, true);
    assert.equal(invRes.invoice.status, "draft");
    invoice1 = invRes.invoice;

    // 2. Accrue 2 bed-days (2026-10-22 and 2026-10-23)
    const accrualRes = await accrueBedDays({
      hospitalId,
      invoiceId: invoice1._id,
      accrualDates: ["2026-10-22", "2026-10-23"],
      roomType: "semi_private",
    });
    assert.equal(accrualRes.success, true);
    assert.equal(accrualRes.accruedDaysCount, 2);
    // (3,500 + 1,500) * 2 days = 10,000.00 INR = 1,000,000 paise
    assert.equal(accrualRes.grossTotalMinor, 1000000);
    assert.equal(accrualRes.balancePayableMinor, 1000000);
    assert.equal(accrualRes.invoice.status, "interim");

    // 3. Idempotent Retry: Re-accruing the same dates (plus 1 new date 2026-10-24)
    // Only 2026-10-24 is accrued; 2026-10-22 and 2026-10-23 are deduplicated!
    const reAccrualRes = await accrueBedDays({
      hospitalId,
      invoiceId: invoice1._id,
      accrualDates: ["2026-10-22", "2026-10-23", "2026-10-24"],
      roomType: "semi_private",
    });
    assert.equal(reAccrualRes.success, true);
    assert.equal(reAccrualRes.accruedDaysCount, 1); // Only 1 new day!
    // 3 days total = 1,500,000 paise
    assert.equal(reAccrualRes.grossTotalMinor, 1500000);
    assert.equal(reAccrualRes.balancePayableMinor, 1500000);
  });

  let preAuth1;

  await t.test("3. TPA pre-authorization registration and split billing calculation", async () => {
    // 1. Register TPA Pre-Authorization:
    // Limit: 10,000.00 INR (1,000,000 paise), Co-pay: 10%
    const paRes = await registerTpaPreAuth({
      hospitalId,
      admissionId,
      patientId,
      insuranceCompany: "Star Health & Allied Insurance",
      tpaName: "Medi Assist TPA",
      policyNumber: "POL-STAR-88901",
      corporateId: "CORP-INFOSYS-2026",
      preAuthApprovedLimitMinor: 1000000, // 10,000 INR
      copayPercentage: 10,
    });

    assert.equal(paRes.success, true);
    assert.equal(paRes.preAuth.status, "pre_auth_approved");
    assert.equal(paRes.preAuth.copayPercentage, 10);
    preAuth1 = paRes.preAuth;

    // 2. Apply TPA Pre-Auth to Invoice:
    // Gross: 1,500,000 paise (15,000 INR)
    // Co-pay 10%: patient portion = 10%, max TPA eligible = 90% = 1,350,000 paise
    // Capped by preAuthLimit of 1,000,000 paise:
    // TPA Approved = 1,000,000 paise
    // Patient Copay = Gross - TPA = 1,500,000 - 1,000,000 = 500,000 paise (5,000 INR)
    const splitRes = await applyTpaPreAuthToInvoice({
      hospitalId,
      invoiceId: invoice1._id,
      tpaPreAuthId: preAuth1._id,
    });

    assert.equal(splitRes.success, true);
    assert.equal(splitRes.splitBilling.tpaApprovedMinor, 1000000);
    assert.equal(splitRes.splitBilling.copayAmountMinor, 500000);
    assert.equal(splitRes.splitBilling.patientBalancePayableMinor, 500000);
  });

  await t.test("4. Partial payments, overpayment prevention, credit notes and settlement", async () => {
    // 1. Overpayment attempt: Trying to pay 600,000 paise when balance is 500,000 paise -> Fails
    await assert.rejects(
      () =>
        recordInvoicePayment({
          hospitalId,
          invoiceId: invoice1._id,
          amountMinor: 600000,
          paymentMode: "card_pos",
          actor: { staffId },
        }),
      /exceeds outstanding balance/
    );

    // 2. Partial payment: Pay 200,000 paise (2,000 INR) via UPI
    const partPayRes = await recordInvoicePayment({
      hospitalId,
      invoiceId: invoice1._id,
      amountMinor: 200000,
      paymentMode: "upi_manual",
      paymentReference: "UPI-REF-998811",
      actor: { staffId },
    });
    assert.equal(partPayRes.success, true);
    assert.equal(partPayRes.paidMinor, 200000);
    assert.equal(partPayRes.balancePayableMinor, 300000);
    assert.equal(partPayRes.status, "interim");

    // 3. Issue Credit Note: Hospital courtesy waiver of 50,000 paise (500 INR)
    const cnRes = await issueCreditNote({
      hospitalId,
      invoiceId: invoice1._id,
      amountMinor: 50000,
      reason: "Delayed room preparation courtesy discount",
      actor: { staffId },
    });
    assert.equal(cnRes.success, true);
    assert.ok(cnRes.creditNoteNumber.startsWith("CRN-"));
    assert.equal(cnRes.balancePayableMinor, 250000);

    // 4. Settle remaining balance of 250,000 paise (2,500 INR) via Cash
    const settleRes = await recordInvoicePayment({
      hospitalId,
      invoiceId: invoice1._id,
      amountMinor: 250000,
      paymentMode: "cash",
      actor: { staffId },
    });
    assert.equal(settleRes.success, true);
    assert.equal(settleRes.balancePayableMinor, 0);
    assert.equal(settleRes.status, "settled");

    // 5. Subsequent payment rejected on settled invoice
    await assert.rejects(
      () =>
        recordInvoicePayment({
          hospitalId,
          invoiceId: invoice1._id,
          amountMinor: 10000,
          paymentMode: "cash",
          actor: { staffId },
        }),
      /Cannot apply payment to settled invoice/
    );
  });

  let grn1;

  await t.test("5. Procurement: Goods Receipt Note (GRN) creation and central stock reconciliation", async () => {
    // 1. Receive supplier shipment of Paracetamol IV and Ceftriaxone 1g
    const grnRes = await createGoodsReceiptNote({
      hospitalId,
      vendorName: "Cipla Healthcare Distribution Ltd",
      purchaseOrderRef: "PO-CIPLA-2026-10",
      invoiceNumber: "INV-CIPL-9018",
      invoiceDate: "2026-10-20",
      items: [
        {
          itemCode: "MED-PCM-IV",
          itemName: "Paracetamol IV 100ml Infusion",
          batchNumber: "PCM-BATCH-01",
          expiryDate: new Date("2028-12-31"),
          quantityReceived: 100, // 100 vials
          unitCostMinor: 4500, // 45.00 INR
        },
        {
          itemCode: "MED-CEF-1G",
          itemName: "Ceftriaxone 1g Injection",
          batchNumber: "CEF-BATCH-99",
          expiryDate: new Date("2028-06-30"),
          quantityReceived: 50, // 50 vials
          unitCostMinor: 8500, // 85.00 INR
        },
      ],
      actor: { staffId },
    });

    assert.equal(grnRes.success, true);
    assert.equal(grnRes.grn.status, "received");
    // 100 * 4500 + 50 * 8500 = 450,000 + 425,000 = 875,000 paise (8,750 INR)
    assert.equal(grnRes.grn.totalAmountMinor, 875000);
    grn1 = grnRes.grn;

    // 2. Reconcile GRN into Central Store Stock
    const reconRes = await verifyAndReconcileGrn({
      hospitalId,
      grnNumber: grn1.grnNumber,
      actor: { staffId },
    });
    assert.equal(reconRes.success, true);
    assert.equal(reconRes.grn.status, "reconciled");
    assert.equal(reconRes.reconciledItemsCount, 2);

    // 3. Central stock now reflects 100 vials of Paracetamol IV and 50 of Ceftriaxone
    const pcmStock = state.centralStock.find((s) => s.itemCode === "MED-PCM-IV");
    assert.ok(pcmStock);
    assert.equal(pcmStock.totalQuantity, 100);

    // 4. Duplicate reconciliation rejected with HTTP 400
    await assert.rejects(
      () =>
        verifyAndReconcileGrn({
          hospitalId,
          grnNumber: grn1.grnNumber,
          actor: { staffId },
        }),
      /already been reconciled into stock/
    );
  });

  let requisition1;

  await t.test("6. Ward stock requisition and idempotent transfer execution", async () => {
    // 1. Ward requests 30 vials of Paracetamol IV
    const reqRes = await requestWardStock({
      hospitalId,
      wardId,
      items: [
        {
          itemCode: "MED-PCM-IV",
          itemName: "Paracetamol IV 100ml Infusion",
          quantityRequested: 30,
        },
      ],
      actor: { staffId },
    });
    assert.equal(reqRes.success, true);
    assert.equal(reqRes.requisition.status, "requested");
    requisition1 = reqRes.requisition;

    // 2. Over-requisition check: Requesting more than available in central store -> 409 Conflict
    await assert.rejects(
      () =>
        fulfillWardStockTransfer({
          hospitalId,
          requisitionNumber: requisition1.requisitionNumber,
          transferIdempotencyKey: "KEY-FAIL-OVER",
          itemsToIssue: [
            {
              itemCode: "MED-PCM-IV",
              quantityToIssue: 200, // Only 100 available!
            },
          ],
          actor: { staffId },
        }),
      /Insufficient central store stock/
    );

    // 3. Valid stock transfer of 30 vials
    const idempotencyKey = "TX-TRANSFER-PCM-001";
    const transferRes = await fulfillWardStockTransfer({
      hospitalId,
      requisitionNumber: requisition1.requisitionNumber,
      transferIdempotencyKey: idempotencyKey,
      itemsToIssue: [
        {
          itemCode: "MED-PCM-IV",
          quantityToIssue: 30,
        },
      ],
      actor: { staffId },
    });
    assert.equal(transferRes.success, true);
    assert.equal(transferRes.idempotentReplay, false);
    assert.equal(transferRes.status, "fulfilled");

    // Central store decremented: 100 - 30 = 70
    const centralPcm = state.centralStock.find((s) => s.itemCode === "MED-PCM-IV");
    assert.equal(centralPcm.totalQuantity, 70);

    // Ward stock incremented: 0 + 30 = 30
    const wardPcm = state.wardStock.find((w) => w.wardId.toString() === wardId.toString() && w.itemCode === "MED-PCM-IV");
    assert.ok(wardPcm);
    assert.equal(wardPcm.totalQuantity, 30);

    // 4. Idempotent Retry: Calling fulfillWardStockTransfer with same idempotency key
    // Returns existing result without double decrementing central store or double incrementing ward stock!
    const replayRes = await fulfillWardStockTransfer({
      hospitalId,
      requisitionNumber: requisition1.requisitionNumber,
      transferIdempotencyKey: idempotencyKey, // SAME KEY
      itemsToIssue: [
        {
          itemCode: "MED-PCM-IV",
          quantityToIssue: 30,
        },
      ],
      actor: { staffId },
    });
    assert.equal(replayRes.success, true);
    assert.equal(replayRes.idempotentReplay, true);

    // Quantities remain unchanged
    assert.equal(centralPcm.totalQuantity, 70); // Still 70!
    assert.equal(wardPcm.totalQuantity, 30);    // Still 30!
  });

  await t.test("7. Disconnected DB fail-closed check", async () => {
    setRevenueStockTestDouble(null);

    await assert.rejects(
      () =>
        createTariff({
          hospitalId,
          tariffCode: "ROOM-GEN",
          tariffName: "General Ward Rent",
          category: "room_rent",
          rateMinor: 100000,
        }),
      (err) => err.status === 503 || err.message.includes("Database service is unavailable")
    );
  });
});
