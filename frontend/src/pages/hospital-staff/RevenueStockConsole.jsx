/* eslint-disable react/prop-types */
import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import {
  Receipt,
  FileText,
  ShieldCheck,
  Package,
  Layers,
  ArrowRightLeft,
  Plus,
  RefreshCw,
  CheckCircle2,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../../components/ui";

const formatCurrency = (minor = 0) => {
  const val = Number(minor) / 100;
  return "₹" + val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const INVOICE_STATUS_TONES = {
  draft: "neutral",
  interim: "info",
  finalized: "warning",
  settled: "positive",
  cancelled: "danger",
};

const TPA_STATUS_TONES = {
  pending: "warning",
  pre_auth_approved: "positive",
  enhanced: "info",
  rejected: "danger",
  claim_settled: "neutral",
};

const REQUISITION_STATUS_TONES = {
  requested: "warning",
  partially_issued: "info",
  fulfilled: "positive",
  cancelled: "danger",
};

export default function RevenueStockConsole({ initialTab = "billing" }) {
  const { staffUser, isStaffAuth } = useAuth();
  if (!isStaffAuth) {
    return (
      <main className="mp-page mp-enterprise">
        <Card>
          <h1>Hospital Staff Authentication Required</h1>
          <p>Please sign in with your hospital staff account to access Revenue, Procurement and Stock operations.</p>
        </Card>
      </main>
    );
  }
  return <RevenueStockWorkspace key={`${staffUser?._id || staffUser?.id}:${staffUser?.hospitalId}:${staffUser?.role}:${Boolean(staffUser?.adminAccess)}`} initialTab={initialTab} />;
}

function RevenueStockWorkspace({ initialTab = "billing" }) {
  const { staffUser } = useAuth();
  const isAdmin = staffUser?.role === "HOSPITAL_ADMIN" || Boolean(staffUser?.adminAccess);
  const isPharmacist = staffUser?.role === "PHARMACIST" || isAdmin;

  const [activeTab, setActiveTab] = useState(initialTab);
  const [feedback, setFeedback] = useState(null);

  // Tab 1: Billing & Folio
  const [invoices, setInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("all");
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [createInvoiceModalOpen, setCreateInvoiceModalOpen] = useState(false);
  const [accrueModalOpen, setAccrueModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [creditNoteModalOpen, setCreditNoteModalOpen] = useState(false);

  // Form states for billing
  const [newInvAdmissionId, setNewInvAdmissionId] = useState("");
  const [newInvPatientId, setNewInvPatientId] = useState("");
  const [accrueDatesStr, setAccrueDatesStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [accrueRoomType, setAccrueRoomType] = useState("semi_private");
  const [payAmountRupees, setPayAmountRupees] = useState("");
  const [payMode, setPayMode] = useState("upi_manual");
  const [payRef, setPayRef] = useState("");
  const [creditNoteRupees, setCreditNoteRupees] = useState("");
  const [creditNoteReason, setCreditNoteReason] = useState("");

  // Tab 2: Insurance & TPA Pre-Auth
  const [tpaPreAuths, setTpaPreAuths] = useState([]);
  const [tpaLoading, setTpaLoading] = useState(false);
  const [createTpaModalOpen, setCreateTpaModalOpen] = useState(false);
  const [applyTpaModalOpen, setApplyTpaModalOpen] = useState(false);

  // Form states for TPA
  const [tpaAdmissionId, setTpaAdmissionId] = useState("");
  const [tpaPatientId, setTpaPatientId] = useState("");
  const [tpaInsuranceCo, setTpaInsuranceCo] = useState("");
  const [tpaName, setTpaName] = useState("");
  const [tpaPolicyNo, setTpaPolicyNo] = useState("");
  const [tpaCorpId, setTpaCorpId] = useState("");
  const [tpaLimitRupees, setTpaLimitRupees] = useState("");
  const [tpaCopayPercent, setTpaCopayPercent] = useState("10");
  const [applySelectedTpaId, setApplySelectedTpaId] = useState("");

  // Tab 3: Central Store & Procurement (GRN)
  const [grns, setGrns] = useState([]);
  const [centralStock, setCentralStock] = useState([]);
  const [grnLoading, setGrnLoading] = useState(false);
  const [stockSearch, setStockSearch] = useState("");
  const [stockCategoryFilter, setStockCategoryFilter] = useState("all");
  const [createGrnModalOpen, setCreateGrnModalOpen] = useState(false);

  // Form state for GRN
  const [grnVendor, setGrnVendor] = useState("");
  const [grnPoRef, setGrnPoRef] = useState("");
  const [grnInvoiceNo, setGrnInvoiceNo] = useState("");
  const [grnInvoiceDate, setGrnInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [grnItemCode, setGrnItemCode] = useState("");
  const [grnItemName, setGrnItemName] = useState("");
  const [grnBatchNo, setGrnBatchNo] = useState("");
  const [grnExpiryDate, setGrnExpiryDate] = useState("");
  const [grnQty, setGrnQty] = useState("");
  const [grnUnitCostRupees, setGrnUnitCostRupees] = useState("");

  // Tab 4: Ward Stock & Requisitions
  const [wardStock, setWardStock] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [wardLoading, setWardLoading] = useState(false);
  const [selectedWardId, setSelectedWardId] = useState("");
  const [createReqModalOpen, setCreateReqModalOpen] = useState(false);
  const [fulfillReqModalOpen, setFulfillReqModalOpen] = useState(false);
  const [selectedRequisition, setSelectedRequisition] = useState(null);

  // Form state for Requisition & Fulfill
  const [reqWardId, setReqWardId] = useState("");
  const [reqItemCode, setReqItemCode] = useState("");
  const [reqQty, setReqQty] = useState("");
  const [fulfillIssueQty, setFulfillIssueQty] = useState("");
  const [fulfillIdempKey, setFulfillIdempKey] = useState("");

  const authHeaders = useMemo(() => {
    return {
      withCredentials: true,
      headers: {
        "Content-Type": "application/json",
      },
    };
  }, []);

  // Fetch Invoices
  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    try {
      const url = `${BACKEND_URL}/api/revenue/invoices${
        invoiceStatusFilter !== "all" ? `?status=${invoiceStatusFilter}` : ""
      }`;
      const res = await axios.get(url, authHeaders);
      if (res.data?.success) {
        setInvoices(res.data.invoices || []);
        if (selectedInvoice) {
          const updated = res.data.invoices.find((i) => i._id === selectedInvoice._id);
          if (updated) setSelectedInvoice(updated);
        }
      }
    } catch (err) {
      console.error("Failed to load inpatient invoices:", err);
    } finally {
      setInvoicesLoading(false);
    }
  }, [authHeaders, invoiceStatusFilter, selectedInvoice]);

  // Fetch TPA Pre-Auths
  const loadTpaPreAuths = useCallback(async () => {
    setTpaLoading(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/revenue/tpa-pre-auths`, authHeaders);
      if (res.data?.success) {
        setTpaPreAuths(res.data.preAuths || []);
      }
    } catch (err) {
      console.error("Failed to load TPA pre-auths:", err);
    } finally {
      setTpaLoading(false);
    }
  }, [authHeaders]);

  // Fetch Procurement (GRN & Central Stock)
  const loadProcurement = useCallback(async () => {
    setGrnLoading(true);
    try {
      const [grnRes, stockRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/procurement/grn`, authHeaders),
        axios.get(
          `${BACKEND_URL}/api/procurement/stock/central?search=${encodeURIComponent(stockSearch)}${
            stockCategoryFilter !== "all" ? `&category=${stockCategoryFilter}` : ""
          }`,
          authHeaders
        ),
      ]);
      if (grnRes.data?.success) setGrns(grnRes.data.grns || []);
      if (stockRes.data?.success) setCentralStock(stockRes.data.stock || []);
    } catch (err) {
      console.error("Failed to load procurement data:", err);
    } finally {
      setGrnLoading(false);
    }
  }, [authHeaders, stockSearch, stockCategoryFilter]);

  // Fetch Ward Stock & Requisitions
  const loadWardOperations = useCallback(async () => {
    setWardLoading(true);
    try {
      const [reqRes, stockRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/procurement/stock/requisitions`, authHeaders),
        axios.get(
          `${BACKEND_URL}/api/procurement/stock/ward${selectedWardId ? `?wardId=${selectedWardId}` : ""}`,
          authHeaders
        ),
      ]);
      if (reqRes.data?.success) setRequisitions(reqRes.data.requisitions || []);
      if (stockRes.data?.success) setWardStock(stockRes.data.stock || []);
    } catch (err) {
      console.error("Failed to load ward stock and requisitions:", err);
    } finally {
      setWardLoading(false);
    }
  }, [authHeaders, selectedWardId]);

  useEffect(() => {
    if (activeTab === "billing") loadInvoices();
    if (activeTab === "insurance") loadTpaPreAuths();
    if (activeTab === "procurement") loadProcurement();
    if (activeTab === "stock") loadWardOperations();
  }, [activeTab, loadInvoices, loadTpaPreAuths, loadProcurement, loadWardOperations]);

  // Financial Stats
  const revenueStats = useMemo(() => {
    const total = invoices.length;
    const settled = invoices.filter((i) => i.status === "settled").length;
    const interim = invoices.filter((i) => i.status === "interim").length;
    const totalOutstandingMinor = invoices.reduce((acc, i) => acc + (i.balancePayableMinor || 0), 0);
    const totalCollectedMinor = invoices.reduce((acc, i) => acc + (i.paidMinor || 0), 0);
    return { total, settled, interim, totalOutstandingMinor, totalCollectedMinor };
  }, [invoices]);

  // Tab 1: Create Invoice Handlers
  const handleCreateInvoice = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/revenue/invoices`,
        { admissionId: newInvAdmissionId, patientId: newInvPatientId },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({ tone: "positive", message: `Inpatient invoice created: ${res.data.invoice.invoiceNumber}` });
        setCreateInvoiceModalOpen(false);
        setNewInvAdmissionId("");
        setNewInvPatientId("");
        loadInvoices();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.message || err.response?.data?.error || err.message });
    }
  };

  const handleAccrueBedDays = async (e) => {
    e.preventDefault();
    if (!selectedInvoice) return;
    const dates = accrueDatesStr
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/revenue/invoices/${selectedInvoice._id}/accrue-bed-days`,
        { accrualDates: dates, roomType: accrueRoomType },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({
          tone: "positive",
          message: `Accrued ${res.data.accruedDaysCount} bed-days. New gross total: ${formatCurrency(
            res.data.grossTotalMinor
          )}`,
        });
        setAccrueModalOpen(false);
        loadInvoices();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.message || err.response?.data?.error || err.message });
    }
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!selectedInvoice) return;
    const amtMinor = Math.round(Number(payAmountRupees) * 100);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/revenue/invoices/${selectedInvoice._id}/payments`,
        { amountMinor: amtMinor, paymentMode: payMode, paymentReference: payRef },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({
          tone: "positive",
          message: `Payment of ${formatCurrency(amtMinor)} recorded (Receipt: ${res.data.receiptNumber}). Status: ${
            res.data.status
          }`,
        });
        setPaymentModalOpen(false);
        setPayAmountRupees("");
        setPayRef("");
        loadInvoices();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.message || err.response?.data?.error || err.message });
    }
  };

  const handleIssueCreditNote = async (e) => {
    e.preventDefault();
    if (!selectedInvoice) return;
    const amtMinor = Math.round(Number(creditNoteRupees) * 100);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/revenue/invoices/${selectedInvoice._id}/credit-notes`,
        { amountMinor: amtMinor, reason: creditNoteReason },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({
          tone: "positive",
          message: `Credit note ${res.data.creditNoteNumber} issued for ${formatCurrency(amtMinor)}.`,
        });
        setCreditNoteModalOpen(false);
        setCreditNoteRupees("");
        setCreditNoteReason("");
        loadInvoices();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.message || err.response?.data?.error || err.message });
    }
  };

  // Tab 2: TPA Handlers
  const handleRegisterTpa = async (e) => {
    e.preventDefault();
    const limitMinor = Math.round(Number(tpaLimitRupees) * 100);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/revenue/tpa-pre-auths`,
        {
          admissionId: tpaAdmissionId,
          patientId: tpaPatientId,
          insuranceCompany: tpaInsuranceCo,
          tpaName: tpaName,
          policyNumber: tpaPolicyNo,
          corporateId: tpaCorpId,
          preAuthApprovedLimitMinor: limitMinor,
          copayPercentage: Number(tpaCopayPercent),
        },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({ tone: "positive", message: `TPA Pre-Auth registered: ${res.data.preAuth.claimNumber}` });
        setCreateTpaModalOpen(false);
        setTpaAdmissionId("");
        setTpaPatientId("");
        setTpaInsuranceCo("");
        setTpaName("");
        setTpaPolicyNo("");
        setTpaCorpId("");
        setTpaLimitRupees("");
        loadTpaPreAuths();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.message || err.response?.data?.error || err.message });
    }
  };

  const handleApplyTpaToInvoice = async (e) => {
    e.preventDefault();
    if (!selectedInvoice || !applySelectedTpaId) return;
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/revenue/invoices/${selectedInvoice._id}/apply-tpa`,
        { tpaPreAuthId: applySelectedTpaId },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({
          tone: "positive",
          message: `TPA Split Billing applied! Approved: ${formatCurrency(
            res.data.splitBilling.tpaApprovedMinor
          )}, Patient Copay: ${formatCurrency(res.data.splitBilling.copayAmountMinor)}`,
        });
        setApplyTpaModalOpen(false);
        loadInvoices();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.message || err.response?.data?.error || err.message });
    }
  };

  // Tab 3: Procurement & GRN Handlers
  const handleCreateGrn = async (e) => {
    e.preventDefault();
    const unitCostMinor = Math.round(Number(grnUnitCostRupees) * 100);
    const qty = Number(grnQty);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/procurement/grn`,
        {
          vendorName: grnVendor,
          purchaseOrderRef: grnPoRef,
          invoiceNumber: grnInvoiceNo,
          invoiceDate: grnInvoiceDate,
          items: [
            {
              itemCode: grnItemCode,
              itemName: grnItemName || grnItemCode,
              batchNumber: grnBatchNo || "BATCH-" + Date.now().toString(36).toUpperCase(),
              expiryDate: grnExpiryDate || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
              quantityReceived: qty,
              unitCostMinor,
            },
          ],
        },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({
          tone: "positive",
          message: `GRN created: ${res.data.grn.grnNumber} for ${formatCurrency(res.data.grn.totalAmountMinor)}. Ready for reconciliation.`,
        });
        setCreateGrnModalOpen(false);
        setGrnVendor("");
        setGrnPoRef("");
        setGrnInvoiceNo("");
        setGrnItemCode("");
        setGrnItemName("");
        setGrnBatchNo("");
        setGrnExpiryDate("");
        setGrnQty("");
        setGrnUnitCostRupees("");
        loadProcurement();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.message || err.response?.data?.error || err.message });
    }
  };

  const handleReconcileGrn = async (grnNumber) => {
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/procurement/grn/${grnNumber}/reconcile`,
        {},
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({
          tone: "positive",
          message: `GRN ${grnNumber} successfully reconciled! Central store stock updated atomically.`,
        });
        loadProcurement();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.message || err.response?.data?.error || err.message });
    }
  };

  // Tab 4: Ward Requisition Handlers
  const handleRequestWardStock = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/procurement/stock/requisitions`,
        {
          wardId: reqWardId,
          items: [{ itemCode: reqItemCode, quantityRequested: Number(reqQty) }],
        },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({
          tone: "positive",
          message: `Ward requisition ${res.data.requisition.requisitionNumber} submitted.`,
        });
        setCreateReqModalOpen(false);
        setReqWardId("");
        setReqItemCode("");
        setReqQty("");
        loadWardOperations();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.message || err.response?.data?.error || err.message });
    }
  };

  const handleFulfillTransfer = async (e) => {
    e.preventDefault();
    if (!selectedRequisition) return;
    const key = fulfillIdempKey || `TRANSFER-${selectedRequisition.requisitionNumber}-${Date.now()}`;
    const targetItem = selectedRequisition.items[0];
    const qty = fulfillIssueQty.trim() === "" ? targetItem.quantityRequested - targetItem.quantityIssued : Number(fulfillIssueQty);
    if (!Number.isSafeInteger(qty) || qty <= 0) { setFeedback({ tone: "error", message: "Enter a positive whole issue quantity." }); return; }
    setFulfillIdempKey(key);

    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/procurement/stock/requisitions/${selectedRequisition.requisitionNumber}/fulfill`,
        {
          transferIdempotencyKey: key,
          itemsToIssue: [{ itemCode: targetItem.itemCode, quantityToIssue: qty }],
        },
        authHeaders
      );
      if (res.data?.success) {
        const replayMsg = res.data.idempotentReplay ? " (Idempotent Replay Verified)" : "";
        setFeedback({
          tone: "positive",
          message: `Stock transfer fulfilled${replayMsg}! Central Store decremented and Ward stock incremented.`,
        });
        setFulfillReqModalOpen(false);
        setFulfillIssueQty("");
        setFulfillIdempKey("");
        loadWardOperations();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.message || err.response?.data?.error || err.message });
    }
  };

  return (
    <main className="mp-page mp-enterprise" style={{ maxWidth: 1400, margin: "0 auto", padding: "1.5rem" }}>
      {/* Header */}
      <header
        style={{
          marginBottom: "1.5rem",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "1.875rem",
              fontWeight: 700,
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <Receipt style={{ color: "#059669" }} /> Hospital Revenue, Procurement & Stock Console
          </h1>
          <p style={{ margin: "0.25rem 0 0", color: "var(--mp-muted)" }}>
            Inpatient Folio & Auto Bed-Day Accrual, TPA Split Billing, Goods Receipt Notes (GRN) & Idempotent Ward Stock Transfers
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <StatusBadge tone={isAdmin ? "positive" : isPharmacist ? "info" : "neutral"}>
            {staffUser?.role} • {staffUser?.name || "Staff"}
          </StatusBadge>
          <Button
            variant="outline"
            onClick={() => {
              if (activeTab === "billing") loadInvoices();
              if (activeTab === "insurance") loadTpaPreAuths();
              if (activeTab === "procurement") loadProcurement();
              if (activeTab === "stock") loadWardOperations();
            }}
          >
            <RefreshCw size={16} /> Refresh
          </Button>
        </div>
      </header>

      {feedback && (
        <div style={{ marginBottom: "1rem" }}>
          <Banner tone={feedback.tone} onDismiss={() => setFeedback(null)}>
            {feedback.message}
          </Banner>
        </div>
      )}

      {/* Stats Bar */}
      <div className="mp-enterprise-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <Card style={{ padding: "1rem", background: "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#065F46" }}>Total Inpatient Invoices</span>
            <FileText size={18} style={{ color: "#059669" }} />
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#064E3B", marginTop: "0.5rem" }}>
            {revenueStats.total}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#047857", marginTop: "0.25rem" }}>
            {revenueStats.settled} settled • {revenueStats.interim} interim
          </div>
        </Card>

        <Card style={{ padding: "1rem", background: "linear-gradient(135deg, var(--mp-accent-soft) 0%, #DBEAFE 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1E40AF" }}>Total Revenue Collected</span>
            <TrendingUp size={18} style={{ color: "var(--mp-primary)" }} />
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1E3A8A", marginTop: "0.5rem" }}>
            {formatCurrency(revenueStats.totalCollectedMinor)}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--mp-primary)", marginTop: "0.25rem" }}>
            Direct Patient Payments & Settled Claims
          </div>
        </Card>

        <Card style={{ padding: "1rem", background: "linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#92400E" }}>Outstanding Balances</span>
            <DollarSign size={18} style={{ color: "#D97706" }} />
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#78350F", marginTop: "0.5rem" }}>
            {formatCurrency(revenueStats.totalOutstandingMinor)}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#B45309", marginTop: "0.25rem" }}>
            Pending Patient Copay & Self-Pay Due
          </div>
        </Card>

        <Card style={{ padding: "1rem", background: "linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#6B21A8" }}>Central Inventory Items</span>
            <Package size={18} style={{ color: "#9333EA" }} />
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#581C87", marginTop: "0.5rem" }}>
            {centralStock.length}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#7E22CE", marginTop: "0.25rem" }}>
            {grns.length} GRNs recorded • {requisitions.length} Ward Transfers
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <nav className="mp-enterprise-tabs" style={{ display: "flex", gap: "0.5rem", borderBottom: "2px solid var(--mp-border)", marginBottom: "1.5rem" }}>
        <button
          type="button"
          onClick={() => setActiveTab("billing")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "billing" ? "3px solid #059669" : "3px solid transparent",
            color: activeTab === "billing" ? "#059669" : "var(--mp-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <Receipt size={18} /> Inpatient Billing & Folio
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("insurance")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "insurance" ? "3px solid var(--mp-primary)" : "3px solid transparent",
            color: activeTab === "insurance" ? "var(--mp-primary)" : "var(--mp-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <ShieldCheck size={18} /> Corporate Insurance & TPA Claims
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("procurement")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "procurement" ? "3px solid #D97706" : "3px solid transparent",
            color: activeTab === "procurement" ? "#D97706" : "var(--mp-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <Package size={18} /> Central Store & GRN
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("stock")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "stock" ? "3px solid #7C3AED" : "3px solid transparent",
            color: activeTab === "stock" ? "#7C3AED" : "var(--mp-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <ArrowRightLeft size={18} /> Ward Stock Requisitions
        </button>
      </nav>

      {/* TAB 1: INPATIENT BILLING & FINANCIAL FOLIO */}
      {activeTab === "billing" && (
        <div>
          {/* Controls */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "1rem",
              marginBottom: "1rem",
            }}
          >
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <select
                value={invoiceStatusFilter}
                onChange={(e) => setInvoiceStatusFilter(e.target.value)}
                style={{ padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
              >
                <option value="all">All Invoices</option>
                <option value="draft">Draft</option>
                <option value="interim">Interim</option>
                <option value="finalized">Finalized</option>
                <option value="settled">Settled</option>
              </select>
            </div>
            <Button onClick={() => setCreateInvoiceModalOpen(true)}>
              <Plus size={16} /> New Inpatient Invoice
            </Button>
          </div>

          {/* Master Detail View */}
          <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: selectedInvoice ? "1fr 1fr" : "1fr", gap: "1.5rem" }}>
            {/* Invoices List */}
            <Card style={{ padding: "1rem" }}>
              <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 1rem 0" }}>Inpatient Invoices</h2>
              {invoicesLoading ? (
                <LoadingState>Loading inpatient invoices...</LoadingState>
              ) : invoices.length === 0 ? (
                <EmptyState title="No inpatient invoices found" />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {invoices.map((inv) => {
                    const isSelected = selectedInvoice?._id === inv._id;
                    return (
                      <div
                        key={inv._id}
                        onClick={() => setSelectedInvoice(inv)}
                        style={{
                          padding: "1rem",
                          borderRadius: "8px",
                          border: isSelected ? "2px solid #059669" : "1px solid var(--mp-border)",
                          background: isSelected ? "#F0FDF4" : "#FFFFFF",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700, fontSize: "1rem", color: "var(--mp-text)" }}>
                            {inv.invoiceNumber}
                          </span>
                          <StatusBadge tone={INVOICE_STATUS_TONES[inv.status] || "neutral"}>
                            {inv.status}
                          </StatusBadge>
                        </div>
                        <div style={{ fontSize: "0.875rem", color: "var(--mp-muted)", marginTop: "0.25rem" }}>
                          Patient: {inv.patientId?.firstName} {inv.patientId?.lastName} • Admission:{" "}
                          {inv.admissionId?.admissionNumber || "N/A"}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: "0.5rem",
                            paddingTop: "0.5rem",
                            borderTop: "1px dashed var(--mp-border)",
                            fontSize: "0.875rem",
                          }}
                        >
                          <span>
                            Net Total: <strong>{formatCurrency(inv.netTotalMinor)}</strong>
                          </span>
                          <span style={{ color: inv.balancePayableMinor > 0 ? "#DC2626" : "#059669" }}>
                            Balance Due: <strong>{formatCurrency(inv.balancePayableMinor)}</strong>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Selected Folio Details */}
            {selectedInvoice && (
              <Card style={{ padding: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>
                      Folio: {selectedInvoice.invoiceNumber}
                    </h2>
                    <p style={{ margin: "0.25rem 0 0", color: "var(--mp-muted)", fontSize: "0.875rem" }}>
                      Patient: {selectedInvoice.patientId?.firstName} {selectedInvoice.patientId?.lastName} (
                      {selectedInvoice.patientId?.phoneNumber})
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => setSelectedInvoice(null)}>
                    Close
                  </Button>
                </div>

                {/* Financial Summary */}
                <div className="mp-enterprise-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "0.75rem",
                    margin: "1rem 0",
                    padding: "0.75rem",
                    background: "var(--mp-surface-subtle)",
                    borderRadius: "8px",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>Gross Total</div>
                    <div style={{ fontWeight: 600 }}>{formatCurrency(selectedInvoice.grossTotalMinor)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>Courtesy Discounts (Credit Notes)</div>
                    <div style={{ fontWeight: 600, color: "#059669" }}>
                      -{formatCurrency(selectedInvoice.discountMinor)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>TPA Insurance Approved</div>
                    <div style={{ fontWeight: 600, color: "var(--mp-primary)" }}>
                      {formatCurrency(selectedInvoice.tpaApprovedMinor)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>Patient Co-Pay Amount</div>
                    <div style={{ fontWeight: 600, color: "#D97706" }}>
                      {formatCurrency(selectedInvoice.copayAmountMinor)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>Total Paid / Advance</div>
                    <div style={{ fontWeight: 600, color: "#059669" }}>
                      {formatCurrency(selectedInvoice.paidMinor)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>Balance Payable</div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "1.125rem",
                        color: selectedInvoice.balancePayableMinor > 0 ? "#DC2626" : "#059669",
                      }}
                    >
                      {formatCurrency(selectedInvoice.balancePayableMinor)}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
                  <Button variant="outline" onClick={() => setAccrueModalOpen(true)}>
                    <Layers size={14} /> Accrue Bed-Days
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setApplySelectedTpaId(tpaPreAuths[0]?._id || "");
                      setApplyTpaModalOpen(true);
                    }}
                  >
                    <ShieldCheck size={14} /> Apply TPA Split
                  </Button>
                  <Button
                    variant="primary"
                    disabled={selectedInvoice.balancePayableMinor <= 0}
                    onClick={() => {
                      setPayAmountRupees((selectedInvoice.balancePayableMinor / 100).toFixed(2));
                      setPaymentModalOpen(true);
                    }}
                  >
                    <DollarSign size={14} /> Record Payment
                  </Button>
                  {isAdmin && (
                    <Button variant="ghost" onClick={() => setCreditNoteModalOpen(true)}>
                      Issue Credit Note
                    </Button>
                  )}
                </div>

                {/* Line Items Table */}
                <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: "1rem 0 0.5rem 0" }}>Folio Line Items</h3>
                {selectedInvoice.lineItems?.length === 0 ? (
                  <p style={{ color: "#94A3B8", fontSize: "0.875rem" }}>No line items accrued yet.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "var(--mp-surface-muted)", textAlign: "left" }}>
                          <th style={{ padding: "0.5rem" }}>Category</th>
                          <th style={{ padding: "0.5rem" }}>Description</th>
                          <th style={{ padding: "0.5rem" }}>Date</th>
                          <th style={{ padding: "0.5rem", textAlign: "right" }}>Rate</th>
                          <th style={{ padding: "0.5rem", textAlign: "right" }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedInvoice.lineItems?.map((li) => (
                          <tr key={li.lineItemId} style={{ borderBottom: "1px solid var(--mp-border)" }}>
                            <td style={{ padding: "0.5rem" }}>
                              <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase" }}>
                                {li.category.replace("_", " ")}
                              </span>
                            </td>
                            <td style={{ padding: "0.5rem" }}>{li.description}</td>
                            <td style={{ padding: "0.5rem", color: "var(--mp-muted)" }}>{li.accrualDate || "-"}</td>
                            <td style={{ padding: "0.5rem", textAlign: "right" }}>
                              {formatCurrency(li.unitPriceMinor)}
                            </td>
                            <td style={{ padding: "0.5rem", textAlign: "right", fontWeight: 600 }}>
                              {formatCurrency(li.totalMinor)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Payments Section */}
                {selectedInvoice.payments?.length > 0 && (
                  <div style={{ marginTop: "1rem" }}>
                    <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: "0.5rem 0" }}>Payment Receipts</h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      {selectedInvoice.payments.map((p) => (
                        <div
                          key={p.receiptNumber}
                          style={{
                            padding: "0.5rem 0.75rem",
                            background: "#F0FDF4",
                            border: "1px solid #BBF7D0",
                            borderRadius: "6px",
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "0.875rem",
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 600, color: "#166534" }}>{p.receiptNumber}</span> (
                            {p.paymentMode.toUpperCase()}) • {p.paymentReference || "Direct"}
                          </div>
                          <div style={{ fontWeight: 700, color: "#166534" }}>
                            +{formatCurrency(p.amountMinor)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CORPORATE INSURANCE & TPA PRE-AUTHORIZATION */}
      {activeTab === "insurance" && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1rem",
            }}
          >
            <div>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>TPA Pre-Authorization Registry</h2>
              <p style={{ margin: "0.25rem 0 0", color: "var(--mp-muted)", fontSize: "0.875rem" }}>
                Pre-authorization caps, patient co-pay percentage calculation, and claims clearance
              </p>
            </div>
            <Button onClick={() => setCreateTpaModalOpen(true)}>
              <Plus size={16} /> Register TPA Pre-Auth
            </Button>
          </div>

          <Card style={{ padding: "1rem" }}>
            {tpaLoading ? (
              <LoadingState>Loading TPA Pre-Authorizations...</LoadingState>
            ) : tpaPreAuths.length === 0 ? (
              <EmptyState title="No corporate TPA pre-authorizations registered yet" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--mp-surface-muted)", textAlign: "left" }}>
                      <th style={{ padding: "0.75rem" }}>Claim #</th>
                      <th style={{ padding: "0.75rem" }}>Insurance & TPA</th>
                      <th style={{ padding: "0.75rem" }}>Policy #</th>
                      <th style={{ padding: "0.75rem" }}>Corporate ID</th>
                      <th style={{ padding: "0.75rem", textAlign: "right" }}>Approved Limit</th>
                      <th style={{ padding: "0.75rem", textAlign: "right" }}>Co-Pay %</th>
                      <th style={{ padding: "0.75rem" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tpaPreAuths.map((pa) => (
                      <tr key={pa._id} style={{ borderBottom: "1px solid var(--mp-border)" }}>
                        <td style={{ padding: "0.75rem", fontWeight: 700, color: "#1E3A8A" }}>{pa.claimNumber}</td>
                        <td style={{ padding: "0.75rem" }}>
                          <div>{pa.insuranceCompany}</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>TPA: {pa.tpaName}</div>
                        </td>
                        <td style={{ padding: "0.75rem" }}>{pa.policyNumber}</td>
                        <td style={{ padding: "0.75rem", color: "var(--mp-muted)" }}>{pa.corporateId || "Retail"}</td>
                        <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: 700, color: "#059669" }}>
                          {formatCurrency(pa.preAuthApprovedLimitMinor)}
                        </td>
                        <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: 600 }}>
                          {pa.copayPercentage}%
                        </td>
                        <td style={{ padding: "0.75rem" }}>
                          <StatusBadge tone={TPA_STATUS_TONES[pa.status] || "neutral"}>{pa.status}</StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 3: CENTRAL STORE & PROCUREMENT (GRN) */}
      {activeTab === "procurement" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* GRN Section */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem",
              }}
            >
              <div>
                <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Goods Receipt Notes (GRN)</h2>
                <p style={{ margin: "0.25rem 0 0", color: "var(--mp-muted)", fontSize: "0.875rem" }}>
                  Vendor receipts, invoice verification and atomic reconciliation into central stock batches
                </p>
              </div>
              {isPharmacist && (
                <Button onClick={() => setCreateGrnModalOpen(true)}>
                  <Plus size={16} /> New Goods Receipt Note
                </Button>
              )}
            </div>

            <Card style={{ padding: "1rem" }}>
              {grnLoading ? (
                <LoadingState>Loading Goods Receipt Notes...</LoadingState>
              ) : grns.length === 0 ? (
                <EmptyState title="No Goods Receipt Notes registered yet" />
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "var(--mp-surface-muted)", textAlign: "left" }}>
                        <th style={{ padding: "0.75rem" }}>GRN #</th>
                        <th style={{ padding: "0.75rem" }}>Vendor & PO</th>
                        <th style={{ padding: "0.75rem" }}>Invoice</th>
                        <th style={{ padding: "0.75rem" }}>Items</th>
                        <th style={{ padding: "0.75rem", textAlign: "right" }}>Total Amount</th>
                        <th style={{ padding: "0.75rem" }}>Status</th>
                        <th style={{ padding: "0.75rem", textAlign: "center" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grns.map((g) => (
                        <tr key={g._id} style={{ borderBottom: "1px solid var(--mp-border)" }}>
                          <td style={{ padding: "0.75rem", fontWeight: 700, color: "var(--mp-text)" }}>{g.grnNumber}</td>
                          <td style={{ padding: "0.75rem" }}>
                            <div>{g.vendorName}</div>
                            <div style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>PO: {g.purchaseOrderRef || "Direct"}</div>
                          </td>
                          <td style={{ padding: "0.75rem" }}>{g.invoiceNumber}</td>
                          <td style={{ padding: "0.75rem" }}>
                            {g.items?.map((it, idx) => (
                              <div key={idx} style={{ fontSize: "0.75rem" }}>
                                {it.itemCode} (Qty: {it.quantityReceived})
                              </div>
                            ))}
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: 700 }}>
                            {formatCurrency(g.totalAmountMinor)}
                          </td>
                          <td style={{ padding: "0.75rem" }}>
                            <StatusBadge tone={g.status === "reconciled" ? "positive" : "warning"}>
                              {g.status}
                            </StatusBadge>
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "center" }}>
                            {g.status !== "reconciled" && isPharmacist && (
                              <Button
                                size="small"
                                variant="primary"
                                onClick={() => handleReconcileGrn(g.grnNumber)}
                              >
                                Reconcile into Stock
                              </Button>
                            )}
                            {g.status === "reconciled" && (
                              <span style={{ fontSize: "0.75rem", color: "#059669", fontWeight: 600 }}>
                                <CheckCircle2 size={14} style={{ display: "inline", verticalAlign: "middle" }} /> Stock
                                Updated
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Central Stock Inventory */}
          <div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
                marginBottom: "1rem",
              }}
            >
              <div>
                <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Central Store Inventory</h2>
                <p style={{ margin: "0.25rem 0 0", color: "var(--mp-muted)", fontSize: "0.875rem" }}>
                  Active items, batch numbers, expiry tracking and available quantities in central warehouse
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Search code or name..."
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  style={{ padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
                />
                <select
                  value={stockCategoryFilter}
                  onChange={(e) => setStockCategoryFilter(e.target.value)}
                  style={{ padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid #CBD5E1" }}
                >
                  <option value="all">All Categories</option>
                  <option value="medication">Medication</option>
                  <option value="consumable">Consumable</option>
                  <option value="surgical">Surgical</option>
                  <option value="implant">Implant</option>
                  <option value="general">General</option>
                </select>
              </div>
            </div>

            <Card style={{ padding: "1rem" }}>
              {centralStock.length === 0 ? (
                <EmptyState title="No items in central store stock" />
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "var(--mp-surface-muted)", textAlign: "left" }}>
                        <th style={{ padding: "0.75rem" }}>Item Code</th>
                        <th style={{ padding: "0.75rem" }}>Item Name</th>
                        <th style={{ padding: "0.75rem" }}>Category</th>
                        <th style={{ padding: "0.75rem" }}>Batches & Expiry</th>
                        <th style={{ padding: "0.75rem", textAlign: "right" }}>Total Available Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {centralStock.map((s) => (
                        <tr key={s._id} style={{ borderBottom: "1px solid var(--mp-border)" }}>
                          <td style={{ padding: "0.75rem", fontWeight: 700, color: "var(--mp-text)" }}>{s.itemCode}</td>
                          <td style={{ padding: "0.75rem" }}>{s.itemName}</td>
                          <td style={{ padding: "0.75rem" }}>
                            <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase" }}>
                              {s.category}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem" }}>
                            {s.batches?.map((b, idx) => (
                              <div key={idx} style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>
                                {b.batchNumber} (Exp: {new Date(b.expiryDate).toISOString().slice(0, 10)}) • Qty:{" "}
                                <strong>{b.quantity}</strong>
                              </div>
                            ))}
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: 700, fontSize: "1rem" }}>
                            {s.totalQuantity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* TAB 4: WARD STOCK & REQUISITIONS */}
      {activeTab === "stock" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Requisitions List */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem",
              }}
            >
              <div>
                <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Ward Stock Requisitions</h2>
                <p style={{ margin: "0.25rem 0 0", color: "var(--mp-muted)", fontSize: "0.875rem" }}>
                  Ward nurse requests & atomic, idempotent transfer fulfillment from Central Store
                </p>
              </div>
              <Button onClick={() => setCreateReqModalOpen(true)}>
                <Plus size={16} /> Request Stock from Central Store
              </Button>
            </div>

            <Card style={{ padding: "1rem" }}>
              {wardLoading ? (
                <LoadingState>Loading ward requisitions...</LoadingState>
              ) : requisitions.length === 0 ? (
                <EmptyState title="No ward stock requisitions found" />
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "var(--mp-surface-muted)", textAlign: "left" }}>
                        <th style={{ padding: "0.75rem" }}>Requisition #</th>
                        <th style={{ padding: "0.75rem" }}>Ward</th>
                        <th style={{ padding: "0.75rem" }}>Items Requested</th>
                        <th style={{ padding: "0.75rem" }}>Status</th>
                        <th style={{ padding: "0.75rem" }}>Idempotency Key</th>
                        <th style={{ padding: "0.75rem", textAlign: "center" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requisitions.map((req) => (
                        <tr key={req._id} style={{ borderBottom: "1px solid var(--mp-border)" }}>
                          <td style={{ padding: "0.75rem", fontWeight: 700, color: "#6D28D9" }}>
                            {req.requisitionNumber}
                          </td>
                          <td style={{ padding: "0.75rem" }}>{req.wardId?.name || "General Ward"}</td>
                          <td style={{ padding: "0.75rem" }}>
                            {req.items?.map((it, idx) => (
                              <div key={idx} style={{ fontSize: "0.75rem" }}>
                                {it.itemCode}: Requested {it.quantityRequested} • Issued {it.quantityIssued}
                              </div>
                            ))}
                          </td>
                          <td style={{ padding: "0.75rem" }}>
                            <StatusBadge tone={REQUISITION_STATUS_TONES[req.status] || "neutral"}>
                              {req.status}
                            </StatusBadge>
                          </td>
                          <td style={{ padding: "0.75rem", fontSize: "0.75rem", color: "var(--mp-muted)" }}>
                            {req.transferIdempotencyKey || "Not Transferred"}
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "center" }}>
                            {req.status !== "fulfilled" && isPharmacist && (
                              <Button
                                size="small"
                                variant="primary"
                                onClick={() => {
                                  setSelectedRequisition(req);
                                  setFulfillIssueQty(String(req.items[0]?.quantityRequested || 1));
                                  setFulfillIdempKey(`IDEMP-TX-${req.requisitionNumber}-${Date.now().toString(36)}`);
                                  setFulfillReqModalOpen(true);
                                }}
                              >
                                Fulfill Stock Transfer
                              </Button>
                            )}
                            {req.status === "fulfilled" && (
                              <span style={{ fontSize: "0.75rem", color: "#059669", fontWeight: 600 }}>
                                <CheckCircle2 size={14} style={{ display: "inline", verticalAlign: "middle" }} />{" "}
                                Fulfilled
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Current Ward Inventory */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Ward Stock Inventories</h2>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.875rem", color: "var(--mp-muted)" }}>Filter by Ward ID:</span>
                <input
                  type="text"
                  placeholder="Ward ObjectId..."
                  value={selectedWardId}
                  onChange={(e) => setSelectedWardId(e.target.value)}
                  style={{ padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.875rem" }}
                />
              </div>
            </div>
            <Card style={{ padding: "1rem" }}>
              {wardStock.length === 0 ? (
                <EmptyState title="No stock items allocated to wards yet" />
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "var(--mp-surface-muted)", textAlign: "left" }}>
                        <th style={{ padding: "0.75rem" }}>Ward</th>
                        <th style={{ padding: "0.75rem" }}>Item Code</th>
                        <th style={{ padding: "0.75rem" }}>Item Name</th>
                        <th style={{ padding: "0.75rem" }}>Batches</th>
                        <th style={{ padding: "0.75rem", textAlign: "right" }}>Total Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wardStock.map((ws) => (
                        <tr key={ws._id} style={{ borderBottom: "1px solid var(--mp-border)" }}>
                          <td style={{ padding: "0.75rem", fontWeight: 600 }}>{ws.wardId?.name || "Ward"}</td>
                          <td style={{ padding: "0.75rem", fontWeight: 700 }}>{ws.itemCode}</td>
                          <td style={{ padding: "0.75rem" }}>{ws.itemName}</td>
                          <td style={{ padding: "0.75rem" }}>
                            {ws.batches?.map((b, idx) => (
                              <div key={idx} style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>
                                {b.batchNumber}: Qty {b.quantity}
                              </div>
                            ))}
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: 700, fontSize: "1rem" }}>
                            {ws.totalQuantity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* DIALOG 1: Create Inpatient Invoice */}
      <Dialog
        open={createInvoiceModalOpen}
        onClose={() => setCreateInvoiceModalOpen(false)}
        title="Create Inpatient Invoice"
      >
        <form onSubmit={handleCreateInvoice} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="IPD Admission ID"
            required
            value={newInvAdmissionId}
            onChange={(e) => setNewInvAdmissionId(e.target.value)}
            placeholder="e.g. 60f8d9b1a1..."
            hint="MongoDB ObjectId of the active patient admission"
          />
          <Field
            label="Patient User ID"
            required
            value={newInvPatientId}
            onChange={(e) => setNewInvPatientId(e.target.value)}
            placeholder="e.g. 60f8d9b1a2..."
            hint="MongoDB ObjectId of the registered patient user"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setCreateInvoiceModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Generate Draft Invoice
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 2: Accrue Bed-Days */}
      <Dialog
        open={accrueModalOpen}
        onClose={() => setAccrueModalOpen(false)}
        title={`Accrue Bed-Days for ${selectedInvoice?.invoiceNumber}`}
      >
        <form onSubmit={handleAccrueBedDays} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="Room Type"
            as="select"
            value={accrueRoomType}
            onChange={(e) => setAccrueRoomType(e.target.value)}
          >
            <option value="general">General Ward</option>
            <option value="semi_private">Semi-Private</option>
            <option value="private">Private</option>
            <option value="deluxe">Deluxe Suite</option>
            <option value="icu">ICU</option>
            <option value="hdu">HDU</option>
          </Field>
          <Field
            label="Accrual Dates (YYYY-MM-DD, comma-separated)"
            required
            value={accrueDatesStr}
            onChange={(e) => setAccrueDatesStr(e.target.value)}
            hint="Idempotent: Dates already accrued on this folio are automatically skipped to prevent double-billing."
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setAccrueModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Accrue Bed Charges
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 3: Record Payment */}
      <Dialog
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        title={`Record Payment for ${selectedInvoice?.invoiceNumber}`}
      >
        <form onSubmit={handleRecordPayment} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="Amount (INR)"
            required
            type="number"
            step="0.01"
            value={payAmountRupees}
            onChange={(e) => setPayAmountRupees(e.target.value)}
            hint={`Maximum payable balance: ${
              selectedInvoice ? formatCurrency(selectedInvoice.balancePayableMinor) : "₹0.00"
            }`}
          />
          <Field
            label="Payment Mode"
            as="select"
            value={payMode}
            onChange={(e) => setPayMode(e.target.value)}
          >
            <option value="upi_manual">UPI / QR Code</option>
            <option value="card_pos">Card POS Terminal</option>
            <option value="cash">Cash Counter</option>
            <option value="tpa_settlement">TPA Insurance Direct Settlement</option>
          </Field>
          <Field
            label="Payment Reference / Txn ID"
            value={payRef}
            onChange={(e) => setPayRef(e.target.value)}
            placeholder="e.g. UPI-TX-883391"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setPaymentModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Issue Receipt & Settle
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 4: Issue Credit Note */}
      <Dialog
        open={creditNoteModalOpen}
        onClose={() => setCreditNoteModalOpen(false)}
        title={`Issue Credit Note for ${selectedInvoice?.invoiceNumber}`}
      >
        <form onSubmit={handleIssueCreditNote} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="Credit Note Amount (INR)"
            required
            type="number"
            step="0.01"
            value={creditNoteRupees}
            onChange={(e) => setCreditNoteRupees(e.target.value)}
          />
          <Field
            label="Reason for Credit Note / Courtesy Discount"
            required
            value={creditNoteReason}
            onChange={(e) => setCreditNoteReason(e.target.value)}
            placeholder="e.g. Executive courtesy discount or billing adjustment"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setCreditNoteModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Apply Credit Note
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 5: Register TPA Pre-Auth */}
      <Dialog
        open={createTpaModalOpen}
        onClose={() => setCreateTpaModalOpen(false)}
        title="Register Corporate Insurance TPA Pre-Authorization"
      >
        <form onSubmit={handleRegisterTpa} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="IPD Admission ID"
            required
            value={tpaAdmissionId}
            onChange={(e) => setTpaAdmissionId(e.target.value)}
            placeholder="Admission ObjectId"
          />
          <Field
            label="Patient User ID"
            required
            value={tpaPatientId}
            onChange={(e) => setTpaPatientId(e.target.value)}
            placeholder="Patient ObjectId"
          />
          <Field
            label="Insurance Company"
            required
            value={tpaInsuranceCo}
            onChange={(e) => setTpaInsuranceCo(e.target.value)}
            placeholder="e.g. Star Health, ICICI Lombard, Max Bupa"
          />
          <Field
            label="TPA Name"
            required
            value={tpaName}
            onChange={(e) => setTpaName(e.target.value)}
            placeholder="e.g. Vidal Health, Medi Assist, Paramount"
          />
          <Field
            label="Policy Number"
            required
            value={tpaPolicyNo}
            onChange={(e) => setTpaPolicyNo(e.target.value)}
            placeholder="e.g. POL-882201"
          />
          <Field
            label="Corporate ID / Employer (Optional)"
            value={tpaCorpId}
            onChange={(e) => setTpaCorpId(e.target.value)}
            placeholder="e.g. CORP-INFOSYS"
          />
          <Field
            label="Pre-Auth Approved Limit (INR)"
            required
            type="number"
            value={tpaLimitRupees}
            onChange={(e) => setTpaLimitRupees(e.target.value)}
            placeholder="e.g. 50000"
          />
          <Field
            label="Patient Co-Pay Percentage (%)"
            required
            type="number"
            min="0"
            max="100"
            value={tpaCopayPercent}
            onChange={(e) => setTpaCopayPercent(e.target.value)}
            hint="e.g. 10% co-pay means patient is responsible for 10% of hospital charges."
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setCreateTpaModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Register Pre-Auth
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 6: Apply TPA to Invoice */}
      <Dialog
        open={applyTpaModalOpen}
        onClose={() => setApplyTpaModalOpen(false)}
        title="Apply TPA Pre-Auth & Compute Split Billing"
      >
        <form onSubmit={handleApplyTpaToInvoice} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ fontSize: "0.875rem", color: "var(--mp-muted)" }}>
            Applying TPA Pre-Authorization divides the invoice into an approved insurer portion and a patient co-pay
            portion based on the co-pay percentage and approved financial limit.
          </p>
          <Field
            label="Select Approved TPA Pre-Authorization"
            as="select"
            value={applySelectedTpaId}
            onChange={(e) => setApplySelectedTpaId(e.target.value)}
          >
            {tpaPreAuths.map((pa) => (
              <option key={pa._id} value={pa._id}>
                {pa.claimNumber} - {pa.insuranceCompany} (Limit: {formatCurrency(pa.preAuthApprovedLimitMinor)}, Co-Pay:{" "}
                {pa.copayPercentage}%)
              </option>
            ))}
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setApplyTpaModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Calculate & Apply Split Billing
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 7: Create GRN */}
      <Dialog
        open={createGrnModalOpen}
        onClose={() => setCreateGrnModalOpen(false)}
        title="Create Goods Receipt Note (GRN)"
      >
        <form onSubmit={handleCreateGrn} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="Vendor / Distributor Name"
            required
            value={grnVendor}
            onChange={(e) => setGrnVendor(e.target.value)}
            placeholder="e.g. Sun Pharma Distributors Ltd"
          />
          <Field
            label="Purchase Order Ref"
            value={grnPoRef}
            onChange={(e) => setGrnPoRef(e.target.value)}
            placeholder="e.g. PO-2026-OCT-01"
          />
          <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <Field
              label="Vendor Invoice #"
              required
              value={grnInvoiceNo}
              onChange={(e) => setGrnInvoiceNo(e.target.value)}
              placeholder="e.g. INV-99120"
            />
            <Field
              label="Invoice Date"
              type="date"
              required
              value={grnInvoiceDate}
              onChange={(e) => setGrnInvoiceDate(e.target.value)}
            />
          </div>
          <div style={{ borderTop: "1px dashed #CBD5E1", paddingTop: "0.75rem" }}>
            <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", fontWeight: 600 }}>Received Item</h4>
            <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <Field
                label="Item Code"
                required
                value={grnItemCode}
                onChange={(e) => setGrnItemCode(e.target.value)}
                placeholder="e.g. MED-MER-1G"
              />
              <Field
                label="Item Name"
                value={grnItemName}
                onChange={(e) => setGrnItemName(e.target.value)}
                placeholder="e.g. Meropenem 1g Injection"
              />
            </div>
            <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.5rem" }}>
              <Field
                label="Batch Number"
                value={grnBatchNo}
                onChange={(e) => setGrnBatchNo(e.target.value)}
                placeholder="e.g. BATCH-OCT26-01"
              />
              <Field
                label="Expiry Date"
                type="date"
                value={grnExpiryDate}
                onChange={(e) => setGrnExpiryDate(e.target.value)}
              />
            </div>
            <div className="mp-enterprise-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.5rem" }}>
              <Field
                label="Quantity Received"
                required
                type="number"
                min="1"
                value={grnQty}
                onChange={(e) => setGrnQty(e.target.value)}
              />
              <Field
                label="Unit Cost (INR)"
                required
                type="number"
                step="0.01"
                value={grnUnitCostRupees}
                onChange={(e) => setGrnUnitCostRupees(e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setCreateGrnModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Save Goods Receipt Note
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 8: Request Ward Stock */}
      <Dialog
        open={createReqModalOpen}
        onClose={() => setCreateReqModalOpen(false)}
        title="Request Ward Stock Requisition"
      >
        <form onSubmit={handleRequestWardStock} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="Target Ward ID"
            required
            value={reqWardId}
            onChange={(e) => setReqWardId(e.target.value)}
            placeholder="e.g. Ward ObjectId"
          />
          <Field
            label="Item Code"
            required
            value={reqItemCode}
            onChange={(e) => setReqItemCode(e.target.value)}
            placeholder="e.g. MED-MER-1G"
          />
          <Field
            label="Quantity Requested"
            required
            type="number"
            min="1"
            value={reqQty}
            onChange={(e) => setReqQty(e.target.value)}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setCreateReqModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Submit Requisition
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 9: Fulfill Ward Stock Transfer */}
      <Dialog
        open={fulfillReqModalOpen}
        onClose={() => setFulfillReqModalOpen(false)}
        title={`Fulfill Stock Transfer for ${selectedRequisition?.requisitionNumber}`}
      >
        <form onSubmit={handleFulfillTransfer} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ fontSize: "0.875rem", color: "var(--mp-muted)" }}>
            This will atomically decrement Central Store stock batches and increment Ward stock inventory with
            strict idempotency protection.
          </p>
          <Field
            label="Quantity to Issue"
            required
            type="number"
            min="1"
            value={fulfillIssueQty}
            onChange={(e) => setFulfillIssueQty(e.target.value)}
          />
          <Field
            label="Transfer Idempotency Key"
            required
            value={fulfillIdempKey}
            onChange={(e) => setFulfillIdempKey(e.target.value)}
            hint="Guarantees atomic deduplication: identical keys replay the transfer without double-deduction."
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setFulfillReqModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Execute Atomic Transfer
            </Button>
          </div>
        </form>
      </Dialog>
    </main>
  );
}
