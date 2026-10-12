import "./pharmacy.css";
import { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import {
  Pill,
  PackageCheck,
  Search,
  RefreshCw,
  QrCode,
  RotateCcw,
  Boxes,
  ClipboardList,
} from "lucide-react";
import { returnAllocations, pendingPharmacyKey, readPendingPharmacy } from "../../utils/pharmacy";
import { formatDoctorName } from "../../utils/appointments";
import { BACKEND_URL } from "../../utils";
import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../../components/ui";

export default function PharmacyConsole() {
  const { staffUser, isStaffAuth } = useAuth();
  if (!isStaffAuth || staffUser?.role !== "PHARMACIST") return <main className="mp-page"><Card><h1>Hospital pharmacy access is needed</h1><p>Sign in with your assigned pharmacist account to view this workspace.</p></Card></main>;
  return <PharmacyWorkspace key={`${staffUser._id}:${staffUser.hospitalId}`} />;
}

function PharmacyWorkspace() {
  const { staffUser, staffHospital } = useAuth();
  const hospitalId = staffUser.hospitalId || staffHospital?._id;
  const storageKey = pendingPharmacyKey(hospitalId, staffUser._id);
  const [activeTab, setActiveTab] = useState("prescriptions");
  const [prescriptions, setPrescriptions] = useState([]), [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"), [searchQuery, setSearchQuery] = useState("");
  const [selectedPrescription, setSelectedPrescription] = useState(null), [actionType, setActionType] = useState(null);
  const [actionBusy, setActionBusy] = useState(false), [actionFeedback, setActionFeedback] = useState("");
  const [dispenseItems, setDispenseItems] = useState([]), [returnItems, setReturnItems] = useState([]), [returnReason, setReturnReason] = useState("");
  const [notice, setNotice] = useState(""), [pending, setPending] = useState(null);
  const [pendingProblem, setPendingProblem] = useState("");
  const alive = useRef(false), readController = useRef(null), actionController = useRef(null), submitting = useRef(false);

  const fetchData = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    setLoading(true);
    try {
      const [rxRes, invRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/pharmacy/prescriptions`, { params: statusFilter === "all" ? {} : { status: statusFilter }, withCredentials: true, signal: controller.signal }),
        axios.get(`${BACKEND_URL}/api/pharmacy/inventory`, { withCredentials: true, signal: controller.signal }),
      ]);
      if (!alive.current || controller.signal.aborted) return;
      setPrescriptions(rxRes.data.prescriptions || []); setInventory(invRes.data.inventory || []); setError("");
    } catch (err) {
      if (!alive.current || controller.signal.aborted) return;
      setError(err.response?.data?.message || "Failed to load pharmacy data");
      if ([401,403].includes(err.response?.status)) { setPrescriptions([]); setInventory([]); setSelectedPrescription(null); setActionType(null); }
    } finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  }, [statusFilter]);

  useEffect(() => {
    alive.current = true;
    try { setPending(readPendingPharmacy(sessionStorage, storageKey)); }
    catch { setPendingProblem("The saved operation cannot be read. Restore access to this tab's session storage and reload before recording another operation."); }
    fetchData();
    return () => { alive.current = false; readController.current?.abort(); actionController.current?.abort(); };
  }, [fetchData, storageKey]);

  const openAction = (rx, type) => {
    if (pending || pendingProblem || submitting.current) return;
    setSelectedPrescription(rx); setActionType(type); setActionFeedback(""); setReturnReason("");
    if (type === "dispense") setDispenseItems((rx.items || []).filter(item => !item.quantityReturned && item.itemStatus !== "cancelled")
      .map(item => ({ itemId: item._id, medicationName: item.medicationName, quantityPrescribed: item.quantityPrescribed,
        quantityAlreadyDispensed: item.quantityFulfilled ?? item.quantityDispensed ?? 0,
        quantityToDispense: 0, batchNumber: "" })).filter(item => item.quantityAlreadyDispensed < item.quantityPrescribed));
    if (type === "return") setReturnItems(returnAllocations(rx));
  };
  const resetDialog = () => { setSelectedPrescription(null); setActionType(null); setActionFeedback(""); };
  const closeAction = () => { if (!submitting.current) resetDialog(); };
  const resumePending = async () => {
    if (!pending || submitting.current) return;
    const controller = new AbortController(); actionController.current = controller;
    submitting.current = true; setActionBusy(true);
    try {
      const response = await axios.get(`${BACKEND_URL}/api/pharmacy/prescriptions/${pending.rxId}`, { withCredentials: true, signal: controller.signal });
      if (!alive.current || controller.signal.aborted) return;
      setSelectedPrescription(response.data.prescription); setActionType(pending.kind); setActionFeedback("");
    } catch (err) { if (alive.current && !controller.signal.aborted) setError(err.response?.data?.message || "Could not resume the saved operation"); }
    finally { if (alive.current) { submitting.current = false; setActionBusy(false); } }
  };
  const submitOperation = async kind => {
    if (submitting.current || !selectedPrescription) return;
    let packet = pending;
    if (!packet) {
      const rows = kind === "dispense" ? dispenseItems : returnItems, field = kind === "dispense" ? "quantityToDispense" : "quantity";
      if (rows.some(row => !Number.isSafeInteger(row[field]) || row[field] < 0)) { setActionFeedback("Enter whole quantities of zero or more; zero skips an item."); return; }
      const selected = rows.filter(row => row[field] > 0);
      if (!selected.length) { setActionFeedback("Select at least one positive quantity."); return; }
      if (kind === "return" && !returnReason.trim()) { setActionFeedback("Return reason is required"); return; }
      packet = { rxId: selectedPrescription._id, kind, key: crypto.randomUUID(), body: {
        expectedRevision: selectedPrescription.fulfillmentRevision || 0,
        items: selected.map(row => kind === "dispense" ? { itemId: row.itemId, quantityToDispense: row.quantityToDispense, batchNumber: row.batchNumber }
          : { allocationId: row.allocationId, quantity: row.quantity }),
        ...(kind === "return" ? { reason: returnReason.trim() } : {}),
      } };
      // Retain only the pending command, scoped to this staff account/tab. Never cache clinical responses.
      try { sessionStorage.setItem(storageKey, JSON.stringify(packet)); }
      catch { setActionFeedback("Session storage is unavailable. This operation was not sent; restore storage and retry."); return; }
      setPending(packet);
    }
    submitting.current = true; setActionBusy(true); setActionFeedback("");
    const controller = new AbortController(); actionController.current = controller;
    try {
      const response = await axios.post(`${BACKEND_URL}/api/pharmacy/prescriptions/${packet.rxId}/${packet.kind}`, packet.body,
        { withCredentials: true, headers: { "Idempotency-Key": packet.key }, signal: controller.signal, timeout: 20000 });
      if (!alive.current || controller.signal.aborted) return;
      sessionStorage.removeItem(storageKey); setPending(null); resetDialog();
      setNotice(response.data.message || "Operation recorded"); fetchData();
    } catch (err) {
      if (!alive.current || controller.signal.aborted) return;
      const definitive = [400,409,422,428].includes(err.response?.status);
      if (definitive) {
        try { sessionStorage.removeItem(storageKey); }
        catch { setActionFeedback("Restore session storage before resolving this saved operation."); return; }
        setPending(null); fetchData();
      }
      setActionFeedback(definitive ? err.response.data?.message || "Operation rejected" : "The response was not confirmed. Retry this same operation; its quantities and operation key have been retained.");
    } finally { if (alive.current) { submitting.current = false; setActionBusy(false); } }
  };
  const submitDispense = () => submitOperation("dispense");
  const submitReturn = () => submitOperation("return");

  const filteredPrescriptions = prescriptions.filter((rx) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      rx.patientInfo?.name?.toLowerCase().includes(q) ||
      rx.verificationToken?.toLowerCase().includes(q) ||
      (rx.items || []).some((i) => i.medicationName?.toLowerCase().includes(q) || i.medicationCode?.toLowerCase().includes(q))
    );
  });

  return (
    <main
      className="mp-page mp-pharmacy"
      style={{
        maxWidth: 1400,
        width: "100%",
        margin: "0 auto",
        padding: "32px 24px",
      }}
    >
      <div className="mp-section-heading" style={{ marginBottom: 24 }}>
        <div>
          <p className="mp-eyebrow">Hospital Pharmacy · Medication Dispensing</p>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Pill size={28} style={{ color: "var(--mp-accent)" }} />
            Hospital Pharmacy Operations
          </h1>
          <p style={{ color: "var(--mp-muted)" }}>
            Fulfill clinician-approved prescriptions, track batch stock and expiries, record verified dispensing, and manage returns.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={fetchData} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </Button>
        </div>
      </div>

      {pendingProblem && <Banner tone="danger">{pendingProblem}</Banner>}
      {notice && <Banner tone="positive">{notice}</Banner>}
      {pending && <Banner tone="warning">One pharmacy operation needs confirmation. Resume it before recording another. <Button onClick={resumePending} disabled={actionBusy}>Resume operation</Button></Banner>}
      {error && <Banner tone="danger" style={{ marginBottom: 16 }}>{error}</Banner>}

      {/* Main Switcher: Prescriptions vs Inventory */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <Button
          variant={activeTab === "prescriptions" ? "primary" : "secondary"}
          onClick={() => setActiveTab("prescriptions")}
          style={{ gap: 8 }}
        >
          <ClipboardList size={16} /> Prescription Queue ({prescriptions.length})
        </Button>
        <Button
          variant={activeTab === "inventory" ? "primary" : "secondary"}
          onClick={() => setActiveTab("inventory")}
          style={{ gap: 8 }}
        >
          <Boxes size={16} /> Medication Stock & Batches ({inventory.length})
        </Button>
      </div>

      {activeTab === "prescriptions" ? (
        <>
          {/* Filters & Search */}
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { id: "all", label: "All Statuses" },
                  { id: "approved_by_doctor", label: "Pending Dispense" },
                  { id: "partially_dispensed", label: "Partially Dispensed" },
                  { id: "dispensed", label: "Fully Dispensed" },
                  { id: "returned", label: "Returned" },
                ].map((tab) => (
                  <Button
                    key={tab.id}
                    variant={statusFilter === tab.id ? "primary" : "ghost"}
                    onClick={() => setStatusFilter(tab.id)} disabled={actionBusy || Boolean(pending)}
                    style={{ padding: "6px 14px", fontSize: 13 }}
                  >
                    {tab.label}
                  </Button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Search size={16} style={{ color: "var(--mp-muted)" }} />
                <Field
                  label="Search prescriptions"
                  type="search"
                  placeholder="Search patient, medication or RX..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ minWidth: 180, width: "100%", marginBottom: 0 }}
                />
              </div>
            </div>
          </Card>

          {/* Prescriptions List */}
          {loading && !prescriptions.length ? (
            <LoadingState>Loading prescriptions...</LoadingState>
          ) : !filteredPrescriptions.length ? (
            <Card>
              <EmptyState title="No prescriptions in queue">
                {searchQuery
                  ? "No prescriptions match your search query."
                  : "Prescriptions approved by attending doctors will appear here for pharmacy fulfillment."}
              </EmptyState>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {filteredPrescriptions.map((rx) => (
                <Card key={rx._id}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: 16,
                    }}
                  >
                    <div className="mp-pharmacy-record-info">
                      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
                        <h3 style={{ margin: 0, fontSize: 18 }}>{rx.patientInfo?.name || "Patient"}</h3>
                        <StatusBadge status={rx.status} />
                        {rx.verificationToken && (
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: 12,
                              padding: "2px 8px",
                              borderRadius: 4,
                              background: "var(--mp-surface-muted)",
                              fontWeight: 600,
                            }}
                          >
                            {rx.verificationToken}
                          </span>
                        )}
                      </div>

                      <p style={{ margin: "4px 0", fontSize: 13, color: "var(--mp-muted)" }}>
                        Prescribed by: {formatDoctorName(rx.prescribingDoctorName)} · Date:{" "}
                        {new Date(rx.createdAt).toLocaleDateString()}
                        {rx.dispensedByName && ` · Dispensed by: ${rx.dispensedByName}`}
                      </p>

                      {rx.diagnosis && (
                        <p style={{ margin: "6px 0", fontSize: 13, fontStyle: "italic" }}>
                          Clinical Diagnosis: {rx.diagnosis}
                        </p>
                      )}

                      {/* Items list */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                        {(rx.items || []).map((item, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: 10,
                              background: "var(--mp-surface-muted)",
                              padding: "8px 12px",
                              borderRadius: 6,
                              fontSize: 13,
                            }}
                          >
                            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                              <strong>{item.medicationName}</strong> ({item.medicationCode}) ·{" "}
                              <span style={{ color: "var(--mp-muted)" }}>{item.directions}</span>
                              {item.batchNumber && !(rx.fulfillmentOperations || []).length && (
                                <span style={{ marginLeft: 8, fontFamily: "monospace", color: "var(--mp-accent)" }}>
                                  Batch: {item.batchNumber}
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                              <span>
                                Held: {item.quantityDispensed || 0} / {item.quantityPrescribed} · Returned: {item.quantityReturned || 0}
                              </span>
                              <StatusBadge status={item.itemStatus} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div aria-label="Recorded batch operations" style={{ flexBasis: "100%", color: "var(--mp-muted)", fontSize: 13 }}>
                      {(rx.fulfillmentOperations || []).map(operation => <p key={operation._id}>
                        {operation.kind === "return" ? "Returned to quarantine" : "Dispensed"}: {operation.allocations.map(row => `${row.batchNumber} × ${row.quantity}`).join(", ")}
                      </p>)}
                      {rx.fulfillmentLedgerVersion !== 1 && rx.items.some(item => item.quantityDispensed > 0) && <Banner tone="warning">Earlier dispensing has no batch allocations. Reviewed repair is needed before another stock operation.</Banner>}
                    </div>
                    {/* Actions */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {["approved_by_doctor", "partially_dispensed"].includes(rx.status) && (
                        <Button disabled={Boolean(pendingProblem) || Boolean(pending) || (rx.items.some(item => item.quantityDispensed > 0) && rx.fulfillmentLedgerVersion !== 1)} onClick={() => openAction(rx, "dispense")} style={{ gap: 6 }}>
                          <PackageCheck size={16} /> Dispense Medication
                        </Button>
                      )}

                      {["partially_dispensed", "dispensed"].includes(rx.status) && (
                        <Button variant="secondary" disabled={Boolean(pendingProblem) || Boolean(pending) || rx.fulfillmentLedgerVersion !== 1} onClick={() => openAction(rx, "return")} style={{ gap: 6 }}>
                          <RotateCcw size={16} /> Process Return
                        </Button>
                      )}

                      <Button variant="ghost" disabled={Boolean(pendingProblem) || Boolean(pending)} onClick={() => openAction(rx, "qr")} style={{ gap: 6 }}>
                        <QrCode size={16} /> Verify Document
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        /* Inventory Tab */
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!inventory.length ? (
            <Card>
              <EmptyState title="No medication inventory loaded">
                Medication stock records with batch numbers and expiration dates will appear here.
              </EmptyState>
            </Card>
          ) : (
            inventory.map((item) => (
              <Card key={item._id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 18 }}>{item.medicationName}</h3>
                    <p style={{ margin: "4px 0", fontSize: 13, color: "var(--mp-muted)" }}>
                      Code: {item.medicationCode} · Form: {item.dosageForm} · Strength: {item.strength || "Standard"}
                    </p>
                    <p style={{ margin: "6px 0", fontWeight: 600 }}>
                      Total Stock: {item.totalStock} units{" "}
                      {item.totalStock <= item.reorderThreshold && (
                        <span style={{ color: "#ef4444", fontSize: 12, marginLeft: 8 }}>
                          (Low Stock Alert - Threshold: {item.reorderThreshold})
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Batches Table */}
                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid var(--mp-border)" }}>
                        <th style={{ padding: "6px 8px" }}>Batch #</th>
                        <th style={{ padding: "6px 8px" }}>Expiry Date</th>
                        <th style={{ padding: "6px 8px" }}>On-hand Qty</th>
                        <th style={{ padding: "6px 8px" }}>Reserved Qty</th>
                        <th style={{ padding: "6px 8px" }}>Quarantined Qty</th>
                        <th style={{ padding: "6px 8px" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(item.batches || []).map((b, idx) => {
                        const isExpired = new Date(b.expiryDate) < new Date();
                        return (
                          <tr key={idx} style={{ borderBottom: "1px solid var(--mp-border)" }}>
                            <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{b.batchNumber}</td>
                            <td style={{ padding: "6px 8px" }}>
                              {new Date(b.expiryDate).toLocaleDateString()}
                            </td>
                            <td style={{ padding: "6px 8px", fontWeight: 600 }}>{b.quantityAvailable}</td>
                            <td style={{ padding: "6px 8px" }}>{b.quantityReserved || 0}</td>
                            <td style={{ padding: "6px 8px" }}>{b.quantityQuarantined || 0}</td>
                            <td style={{ padding: "6px 8px" }}>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: isExpired ? "var(--mp-surface-muted)" : "var(--mp-accent-soft)",
                                  color: isExpired ? "var(--mp-danger)" : "var(--mp-accent-ink)",
                                }}
                              >
                                {isExpired ? "EXPIRED" : "VALID"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Dispense Modal */}
      <Dialog
        open={actionType === "dispense"}
        onClose={closeAction}
        title="Dispense Prescription Medications"
      >
        {pending && <Banner tone="info">Saved dispensing quantities: {pending.body.items.map(row => row.quantityToDispense).join(", ")}. Retry confirms this original operation.</Banner>}
        <p>Enter quantities to dispense. Zero skips an item. Leave the batch blank to use eligible stock in expiry order.</p>
        <div style={{ maxHeight: 360, overflowY: "auto", margin: "16px 0" }}>
          {dispenseItems.map((item, idx) => (
            <div
              key={idx}
              style={{
                padding: 12,
                background: "var(--mp-surface-muted)",
                borderRadius: 6,
                marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <strong>{item.medicationName}</strong>
                <span style={{ fontSize: 12, color: "var(--mp-muted)" }}>
                  Prescribed: {item.quantityPrescribed} (Already dispensed: {item.quantityAlreadyDispensed})
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                <Field
                  label="Quantity to Dispense"
                  type="number"
                  min="0"
                  step="1"
                  max={item.quantityPrescribed - item.quantityAlreadyDispensed}
                  value={item.quantityToDispense}
                  onChange={(e) => {
                    const updated = [...dispenseItems];
                    updated[idx].quantityToDispense = Number(e.target.value);
                    setDispenseItems(updated);
                  }}
                  disabled={actionBusy || Boolean(pending)}
                  style={{ marginBottom: 0 }}
                />
                <Field
                  label="Batch Number (Optional)"
                  placeholder="e.g. B26-0881"
                  value={item.batchNumber}
                  onChange={(e) => {
                    const updated = [...dispenseItems];
                    updated[idx].batchNumber = e.target.value;
                    setDispenseItems(updated);
                  }}
                  disabled={actionBusy || Boolean(pending)}
                  style={{ marginBottom: 0 }}
                />
              </div>
            </div>
          ))}
        </div>

        {actionFeedback && <Banner tone="danger">{actionFeedback}</Banner>}

        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={closeAction} disabled={actionBusy}>
            {pending ? "Close for now" : "Cancel"}
          </Button>
          <Button onClick={submitDispense} disabled={actionBusy}>
            {actionBusy ? "Processing..." : pending ? "Retry Same Dispensing" : "Confirm Dispensing"}
          </Button>
        </div>
      </Dialog>

      {/* Return Modal */}
      <Dialog
        open={actionType === "return"}
        onClose={closeAction}
        title="Process Medication Return"
      >
        {pending && <Banner tone="info">Saved return quantities: {pending.body.items.map(row => row.quantity).join(", ")}. Reason: {pending.body.reason}</Banner>}
        <p>Record returned units against their original batches. Returns are quarantined and do not increase stock available for dispensing.</p>
        <Field
          label="Mandatory Reason for Return"
          value={returnReason}
          onChange={(e) => setReturnReason(e.target.value)}
          placeholder="e.g. Patient allergic reaction / clinician discontinued order..."
          required
          maxLength={1000}
          disabled={actionBusy || Boolean(pending)}
        />

        <div style={{ maxHeight: 240, overflowY: "auto", margin: "16px 0" }}>
          {returnItems.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                padding: 8,
                background: "var(--mp-surface-muted)",
                borderRadius: 6,
                marginBottom: 8,
              }}
            >
              <div>
                <strong>{item.medicationName}</strong>
                <p style={{ margin: 0, fontSize: 11, color: "var(--mp-muted)" }}>
                  Batch: {item.batchNumber} · Available to return: {item.quantityDispensed}
                </p>
              </div>
              <Field
                label={`Return quantity for ${item.medicationName}, batch ${item.batchNumber}`}
                type="number"
                min="0"
                step="1"
                max={item.quantityDispensed}
                value={item.quantity}
                onChange={(e) => {
                  const updated = [...returnItems];
                  updated[idx].quantity = Number(e.target.value);
                  setReturnItems(updated);
                }}
                disabled={actionBusy || Boolean(pending)}
                style={{ width: 150, maxWidth: "100%", marginBottom: 0 }}
              />
            </div>
          ))}
        </div>

        {actionFeedback && <Banner tone="danger">{actionFeedback}</Banner>}

        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={closeAction} disabled={actionBusy}>
            {pending ? "Close for now" : "Cancel"}
          </Button>
          <Button variant="danger" onClick={submitReturn} disabled={actionBusy}>
            {actionBusy ? "Processing..." : pending ? "Retry Same Return" : "Confirm Return"}
          </Button>
        </div>
      </Dialog>

      {/* QR Code Dialog */}
      <Dialog
        open={actionType === "qr"}
        onClose={closeAction}
        title="Prescription Verification"
      >
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div
            style={{
              display: "inline-block",
              padding: 24,
              background: "#fff",
              borderRadius: 12,
              border: "1px solid var(--mp-border)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
            }}
          >
            <QrCode size={32} style={{ color: "#0f172a" }} />
          </div>
          <p
            style={{
              marginTop: 16,
              fontFamily: "monospace",
              fontSize: 16,
              fontWeight: 700,
              color: "var(--mp-accent)",
            }}
          >
            {selectedPrescription?.verificationToken}
          </p>
          <p style={{ fontSize: 13, color: "var(--mp-muted)", maxWidth: 360, margin: "8px auto 0" }}>
            Verify document status using the link below. Clinical information requires an authorized account.
          </p>
        </div>
        <div className="mp-actions" style={{ marginTop: 20 }}>
          <a href={`${BACKEND_URL}/api/pharmacy/verify-qr/${selectedPrescription?.verificationToken}`} target="_blank" rel="noopener noreferrer">Open verification link</a>
          <Button variant="secondary" onClick={closeAction}>
            Close
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
