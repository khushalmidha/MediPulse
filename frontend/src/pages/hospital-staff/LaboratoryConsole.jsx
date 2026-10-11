import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import {
  FlaskConical,
  CheckCircle,
  AlertTriangle,
  Barcode,
  Search,
  RefreshCw,
  FileCheck,
  FileText,
  XCircle,
} from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../../components/ui";

export default function LaboratoryConsole() {
  const { staffUser, staffHospital } = useAuth();
  const hospitalId = staffUser?.hospitalId || staffHospital?._id;

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Dialog states
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [actionType, setActionType] = useState(null); // 'collect' | 'reject' | 'results' | 'verify' | 'release' | 'correct'
  const [actionBusy, setActionBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState("");

  // Form states
  const [barcodeInput, setBarcodeInput] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [requestRecollection, setRequestRecollection] = useState(true);
  const [parameterResults, setParameterResults] = useState([]);
  const [correctionReason, setCorrectionReason] = useState("");

  const fetchOrders = useCallback(async () => {
    if (!hospitalId) return;
    try {
      setLoading(true);
      const url = `${BACKEND_URL}/api/labs/orders?hospitalId=${encodeURIComponent(hospitalId)}${
        statusFilter !== "all" ? `&status=${encodeURIComponent(statusFilter)}` : ""
      }`;
      const res = await axios.get(url, { withCredentials: true });
      setOrders(res.data.orders || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load laboratory orders");
    } finally {
      setLoading(false);
    }
  }, [hospitalId, statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const openAction = (order, type) => {
    setSelectedOrder(order);
    setActionType(type);
    setActionFeedback("");
    if (type === "collect") {
      setBarcodeInput(`LAB-${String(hospitalId).slice(-4).toUpperCase()}-${Date.now().toString().slice(-6)}`);
    } else if (type === "results") {
      // Initialize results template from tests
      const initial = (order.tests || []).flatMap((t) => [
        {
          parameterCode: `${t.testCode}-RESULT`,
          parameterName: `${t.testName} Value`,
          value: "",
          unit: "units",
          referenceRangeText: "Standard Range",
          flag: "normal",
          isCritical: false,
        },
      ]);
      setParameterResults(order.results?.length ? order.results : initial);
    } else if (type === "correct") {
      setCorrectionReason("");
      setParameterResults(order.results || []);
    } else if (type === "reject") {
      setRejectReason("");
      setRequestRecollection(true);
    }
  };

  const closeAction = () => {
    if (!actionBusy) {
      setSelectedOrder(null);
      setActionType(null);
      setActionFeedback("");
    }
  };

  const submitCollect = async () => {
    setActionBusy(true);
    try {
      await axios.patch(
        `${BACKEND_URL}/api/labs/orders/${selectedOrder._id}/collect`,
        { hospitalId, barcode: barcodeInput },
        { withCredentials: true }
      );
      closeAction();
      fetchOrders();
    } catch (err) {
      setActionFeedback(err.response?.data?.message || "Failed to collect sample");
    } finally {
      setActionBusy(false);
    }
  };

  const submitReject = async () => {
    if (!rejectReason.trim()) {
      setActionFeedback("Please provide a reason for sample rejection");
      return;
    }
    setActionBusy(true);
    try {
      await axios.patch(
        `${BACKEND_URL}/api/labs/orders/${selectedOrder._id}/reject`,
        { hospitalId, reason: rejectReason.trim(), requestRecollection },
        { withCredentials: true }
      );
      closeAction();
      fetchOrders();
    } catch (err) {
      setActionFeedback(err.response?.data?.message || "Failed to reject sample");
    } finally {
      setActionBusy(false);
    }
  };

  const submitResults = async () => {
    setActionBusy(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/labs/orders/${selectedOrder._id}/results`,
        { hospitalId, results: parameterResults },
        { withCredentials: true }
      );
      closeAction();
      fetchOrders();
    } catch (err) {
      setActionFeedback(err.response?.data?.message || "Failed to save results");
    } finally {
      setActionBusy(false);
    }
  };

  const submitVerify = async () => {
    setActionBusy(true);
    try {
      await axios.patch(
        `${BACKEND_URL}/api/labs/orders/${selectedOrder._id}/verify`,
        { hospitalId },
        { withCredentials: true }
      );
      closeAction();
      fetchOrders();
    } catch (err) {
      setActionFeedback(err.response?.data?.message || "Failed to verify results");
    } finally {
      setActionBusy(false);
    }
  };

  const submitRelease = async () => {
    setActionBusy(true);
    try {
      await axios.patch(
        `${BACKEND_URL}/api/labs/orders/${selectedOrder._id}/release`,
        { hospitalId },
        { withCredentials: true }
      );
      closeAction();
      fetchOrders();
    } catch (err) {
      setActionFeedback(err.response?.data?.message || "Failed to release report");
    } finally {
      setActionBusy(false);
    }
  };

  const submitCorrection = async () => {
    if (!correctionReason.trim()) {
      setActionFeedback("Correction reason is required");
      return;
    }
    setActionBusy(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/labs/orders/${selectedOrder._id}/correct`,
        { hospitalId, reason: correctionReason.trim(), results: parameterResults },
        { withCredentials: true }
      );
      closeAction();
      fetchOrders();
    } catch (err) {
      setActionFeedback(err.response?.data?.message || "Failed to submit correction");
    } finally {
      setActionBusy(false);
    }
  };

  const handleAcknowledgeCritical = async (orderId) => {
    try {
      await axios.post(
        `${BACKEND_URL}/api/labs/orders/${orderId}/acknowledge-critical`,
        { hospitalId },
        { withCredentials: true }
      );
      fetchOrders();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to acknowledge critical alert");
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.patientInfo?.name?.toLowerCase().includes(q) ||
      o.accessionBarcode?.toLowerCase().includes(q) ||
      (o.tests || []).some((t) => t.testName?.toLowerCase().includes(q) || t.testCode?.toLowerCase().includes(q))
    );
  });

  return (
    <main
      className="mp-page"
      style={{
        maxWidth: 1400,
        margin: "0 auto",
        padding: "32px 24px",
      }}
    >
      <div className="mp-section-heading" style={{ marginBottom: 24 }}>
        <div>
          <p className="mp-eyebrow">Diagnostic Services · Hospital Workflow</p>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FlaskConical size={28} style={{ color: "var(--mp-teal)" }} />
            Laboratory Worklist & Diagnostics
          </h1>
          <p style={{ color: "var(--mp-text-muted)" }}>
            Tenant-scoped laboratory operations: specimen accessioning, technician entry, pathologist verification, and patient report release.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={fetchOrders} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </Button>
        </div>
      </div>

      {error && <Banner tone="danger" style={{ marginBottom: 16 }}>{error}</Banner>}

      {/* Filter Tabs & Search */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { id: "all", label: "All Orders" },
              { id: "ordered", label: "Pending Collection" },
              { id: "collected", label: "Specimen Accessioned" },
              { id: "result_entered", label: "Awaiting Verification" },
              { id: "verified", label: "Verified / Ready to Release" },
              { id: "released", label: "Released Reports" },
              { id: "rejected", label: "Rejected / Recollection" },
            ].map((tab) => (
              <Button
                key={tab.id}
                variant={statusFilter === tab.id ? "primary" : "ghost"}
                onClick={() => setStatusFilter(tab.id)}
                style={{ padding: "6px 14px", fontSize: 13 }}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Search size={16} style={{ color: "var(--mp-text-muted)" }} />
            <Field
              type="search"
              placeholder="Search by patient, barcode, or test..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ minWidth: 260, marginBottom: 0 }}
            />
          </div>
        </div>
      </Card>

      {/* Orders List */}
      {loading && !orders.length ? (
        <LoadingState>Loading laboratory orders...</LoadingState>
      ) : !filteredOrders.length ? (
        <Card>
          <EmptyState
            title="No laboratory orders found"
            action={
              statusFilter !== "all" ? (
                <Button variant="secondary" onClick={() => setStatusFilter("all")}>
                  Clear status filter
                </Button>
              ) : null
            }
          >
            {searchQuery
              ? "No orders match your search query."
              : "When physicians prescribe diagnostic orders during consultations, they will appear in this worklist."}
          </EmptyState>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {filteredOrders.map((order) => {
            const isCritical = order.criticalValueAlert?.isCritical;
            const isAcknowledged = Boolean(order.criticalValueAlert?.acknowledgedAt);

            return (
              <Card
                key={order._id}
                style={{
                  borderLeft: isCritical && !isAcknowledged ? "4px solid #ef4444" : "1px solid var(--mp-border)",
                }}
              >
                {/* Critical Alert Notice */}
                {isCritical && !isAcknowledged && (
                  <div
                    style={{
                      background: "rgba(239, 68, 68, 0.1)",
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      marginBottom: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#ef4444", fontWeight: 600 }}>
                      <AlertTriangle size={18} /> CRITICAL VALUE ALERT: Immediate clinician review required!
                    </span>
                    <Button
                      variant="danger"
                      onClick={() => handleAcknowledgeCritical(order._id)}
                      style={{ padding: "4px 10px", fontSize: 12 }}
                    >
                      Acknowledge Alert
                    </Button>
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: 16,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <h3 style={{ margin: 0, fontSize: 18 }}>{order.patientInfo?.name || "Patient"}</h3>
                      <StatusBadge status={order.orderStatus} />
                      {order.reportVersion > 1 && (
                        <span
                          style={{
                            fontSize: 12,
                            padding: "2px 8px",
                            borderRadius: 12,
                            background: "rgba(14, 165, 233, 0.15)",
                            color: "#0284c7",
                            fontWeight: 600,
                          }}
                        >
                          Rev v{order.reportVersion}
                        </span>
                      )}
                    </div>

                    <p style={{ margin: "4px 0", fontSize: 13, color: "var(--mp-text-muted)" }}>
                      Age: {order.patientInfo?.age || "N/A"} · Gender: {order.patientInfo?.gender || "N/A"} ·
                      Ordered by: {order.orderingDoctorName || "Physician"}
                    </p>

                    {order.accessionBarcode && (
                      <p
                        style={{
                          margin: "6px 0",
                          fontFamily: "monospace",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontWeight: 600,
                          color: "var(--mp-teal)",
                        }}
                      >
                        <Barcode size={16} /> {order.accessionBarcode}
                      </p>
                    )}

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                      {(order.tests || []).map((t, idx) => (
                        <span
                          key={idx}
                          style={{
                            background: "rgba(15, 23, 42, 0.05)",
                            padding: "4px 10px",
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 500,
                          }}
                        >
                          {t.testName} ({t.testCode})
                        </span>
                      ))}
                    </div>

                    {order.rejectedReason && (
                      <p style={{ marginTop: 8, color: "#ef4444", fontSize: 13 }}>
                        <strong>Rejection Reason:</strong> {order.rejectedReason}
                        {order.recollectionRequested && " (Recollection required)"}
                      </p>
                    )}
                  </div>

                  {/* Actions according to workflow state */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["ordered", "billing_cleared", "rejected"].includes(order.orderStatus) && (
                      <Button onClick={() => openAction(order, "collect")} style={{ gap: 6 }}>
                        <Barcode size={16} /> Accession Specimen
                      </Button>
                    )}

                    {["ordered", "billing_cleared", "collected"].includes(order.orderStatus) && (
                      <Button variant="danger" onClick={() => openAction(order, "reject")} style={{ gap: 6 }}>
                        <XCircle size={16} /> Reject Sample
                      </Button>
                    )}

                    {["collected", "processing", "result_entered"].includes(order.orderStatus) && (
                      <Button onClick={() => openAction(order, "results")} style={{ gap: 6 }}>
                        <FileText size={16} /> Enter Results
                      </Button>
                    )}

                    {order.orderStatus === "result_entered" && (
                      <Button variant="primary" onClick={() => openAction(order, "verify")} style={{ gap: 6 }}>
                        <CheckCircle size={16} /> Verify Findings
                      </Button>
                    )}

                    {order.orderStatus === "verified" && (
                      <Button variant="primary" onClick={() => openAction(order, "release")} style={{ gap: 6 }}>
                        <FileCheck size={16} /> Release Report
                      </Button>
                    )}

                    {["verified", "released"].includes(order.orderStatus) && (
                      <Button variant="secondary" onClick={() => openAction(order, "correct")} style={{ gap: 6 }}>
                        Amend / Correct
                      </Button>
                    )}
                  </div>
                </div>

                {/* Results preview if entered */}
                {order.results?.length > 0 && (
                  <div
                    style={{
                      marginTop: 16,
                      paddingTop: 16,
                      borderTop: "1px solid var(--mp-border)",
                    }}
                  >
                    <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                      Findings ({order.results.length} parameters) · Verified by {order.verifiedByName || "Pending"}:
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                      {order.results.map((r, i) => (
                        <div
                          key={i}
                          style={{
                            background:
                              r.flag?.includes("critical")
                                ? "rgba(239, 68, 68, 0.15)"
                                : r.flag === "high" || r.flag === "low"
                                ? "rgba(245, 158, 11, 0.15)"
                                : "rgba(241, 245, 249, 0.7)",
                            padding: "6px 12px",
                            borderRadius: 6,
                            fontSize: 12,
                          }}
                        >
                          <strong>{r.parameterName}:</strong> {r.value} {r.unit}
                          {r.referenceRangeText && ` (Ref: ${r.referenceRangeText})`}
                          {r.flag !== "normal" && (
                            <span style={{ marginLeft: 6, fontWeight: 700, textTransform: "uppercase" }}>
                              [{r.flag}]
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Collect Modal */}
      <Dialog
        open={actionType === "collect"}
        onClose={closeAction}
        title="Accession Specimen & Barcode Generation"
      >
        <p>Assign a unique accession barcode for physical tube/specimen tracking in laboratory analyzers.</p>
        <Field
          label="Accession Barcode"
          value={barcodeInput}
          onChange={(e) => setBarcodeInput(e.target.value)}
          disabled={actionBusy}
          required
        />
        {actionFeedback && <Banner tone="danger">{actionFeedback}</Banner>}
        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={closeAction} disabled={actionBusy}>
            Cancel
          </Button>
          <Button onClick={submitCollect} disabled={actionBusy}>
            {actionBusy ? "Saving..." : "Confirm Accession"}
          </Button>
        </div>
      </Dialog>

      {/* Reject Modal */}
      <Dialog
        open={actionType === "reject"}
        onClose={closeAction}
        title="Reject Specimen"
      >
        <p>Record the physical rejection reason (e.g., hemolyzed sample, insufficient volume, incorrect tube).</p>
        <Field
          as="textarea"
          label="Rejection Reason"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          disabled={actionBusy}
          placeholder="State reason clearly for clinician and phlebotomy team..."
          required
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, margin: "12px 0" }}>
          <input
            type="checkbox"
            checked={requestRecollection}
            onChange={(e) => setRequestRecollection(e.target.checked)}
          />
          Flag patient for immediate specimen recollection
        </label>
        {actionFeedback && <Banner tone="danger">{actionFeedback}</Banner>}
        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={closeAction} disabled={actionBusy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submitReject} disabled={actionBusy}>
            {actionBusy ? "Recording..." : "Confirm Rejection"}
          </Button>
        </div>
      </Dialog>

      {/* Results Entry & Correction Modal */}
      <Dialog
        open={actionType === "results" || actionType === "correct"}
        onClose={closeAction}
        title={actionType === "correct" ? "Amend Laboratory Findings" : "Enter Laboratory Results"}
      >
        {actionType === "correct" && (
          <Field
            label="Mandatory Reason for Report Amendment"
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
            disabled={actionBusy}
            placeholder="e.g. Dilution factor re-checked / sample rerun..."
            required
          />
        )}

        <div style={{ maxHeight: 360, overflowY: "auto", margin: "16px 0" }}>
          {parameterResults.map((param, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr",
                gap: 8,
                alignItems: "center",
                marginBottom: 10,
                padding: 8,
                background: "rgba(15, 23, 42, 0.03)",
                borderRadius: 6,
              }}
            >
              <div>
                <strong>{param.parameterName}</strong>
                <p style={{ margin: 0, fontSize: 11, color: "var(--mp-text-muted)" }}>{param.parameterCode}</p>
              </div>

              <Field
                placeholder="Value"
                value={param.value}
                onChange={(e) => {
                  const updated = [...parameterResults];
                  updated[idx].value = e.target.value;
                  setParameterResults(updated);
                }}
                disabled={actionBusy}
                style={{ marginBottom: 0 }}
              />

              <Field
                placeholder="Unit"
                value={param.unit}
                onChange={(e) => {
                  const updated = [...parameterResults];
                  updated[idx].unit = e.target.value;
                  setParameterResults(updated);
                }}
                disabled={actionBusy}
                style={{ marginBottom: 0 }}
              />

              <Field
                as="select"
                value={param.flag}
                onChange={(e) => {
                  const updated = [...parameterResults];
                  updated[idx].flag = e.target.value;
                  updated[idx].isCritical = e.target.value.includes("critical");
                  setParameterResults(updated);
                }}
                disabled={actionBusy}
                style={{ marginBottom: 0 }}
              >
                <option value="normal">Normal</option>
                <option value="low">Low</option>
                <option value="high">High</option>
                <option value="critical_low">Critical Low</option>
                <option value="critical_high">Critical High</option>
              </Field>
            </div>
          ))}
        </div>

        {actionFeedback && <Banner tone="danger">{actionFeedback}</Banner>}

        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={closeAction} disabled={actionBusy}>
            Cancel
          </Button>
          <Button onClick={actionType === "correct" ? submitCorrection : submitResults} disabled={actionBusy}>
            {actionBusy ? "Saving..." : actionType === "correct" ? "Save Corrected Report" : "Save Findings"}
          </Button>
        </div>
      </Dialog>

      {/* Verify Confirmation Modal */}
      <Dialog
        open={actionType === "verify"}
        onClose={closeAction}
        title="Verify & Authorize Laboratory Findings"
      >
        <p>
          You are confirming that the entered results have been reviewed according to clinical standards.
          Once verified, the report can be released to the patient portal and ordering physician.
        </p>
        {actionFeedback && <Banner tone="danger">{actionFeedback}</Banner>}
        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={closeAction} disabled={actionBusy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submitVerify} disabled={actionBusy}>
            {actionBusy ? "Authorizing..." : "Authorize & Verify"}
          </Button>
        </div>
      </Dialog>

      {/* Release Confirmation Modal */}
      <Dialog
        open={actionType === "release"}
        onClose={closeAction}
        title="Release Report to Patient"
      >
        <p>
          This will make the verified findings immediately accessible to the patient and mark the diagnostic
          step complete on their encounter journey.
        </p>
        {actionFeedback && <Banner tone="danger">{actionFeedback}</Banner>}
        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={closeAction} disabled={actionBusy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submitRelease} disabled={actionBusy}>
            {actionBusy ? "Releasing..." : "Release Report"}
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
