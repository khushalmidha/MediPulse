import { useEffect, useState, useCallback } from "react";
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
import { BACKEND_URL } from "../../utils";
import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../../components/ui";

export default function PharmacyConsole() {
  const { staffUser, staffHospital } = useAuth();
  const hospitalId = staffUser?.hospitalId || staffHospital?._id;

  const [activeTab, setActiveTab] = useState("prescriptions"); // 'prescriptions' | 'inventory'
  const [prescriptions, setPrescriptions] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Dialog states
  const [selectedPrescription, setSelectedPrescription] = useState(null);
  const [actionType, setActionType] = useState(null); // 'dispense' | 'return' | 'qr'
  const [actionBusy, setActionBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState("");

  // Form states
  const [dispenseItems, setDispenseItems] = useState([]);
  const [returnItems, setReturnItems] = useState([]);
  const [returnReason, setReturnReason] = useState("");

  const fetchData = useCallback(async () => {
    if (!hospitalId) return;
    try {
      setLoading(true);
      const [rxRes, invRes] = await Promise.all([
        axios.get(
          `${BACKEND_URL}/api/pharmacy/prescriptions?hospitalId=${encodeURIComponent(hospitalId)}${
            statusFilter !== "all" ? `&status=${encodeURIComponent(statusFilter)}` : ""
          }`,
          { withCredentials: true }
        ),
        axios.get(`${BACKEND_URL}/api/pharmacy/inventory?hospitalId=${encodeURIComponent(hospitalId)}`, {
          withCredentials: true,
        }),
      ]);
      setPrescriptions(rxRes.data.prescriptions || []);
      setInventory(invRes.data.inventory || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load pharmacy data");
    } finally {
      setLoading(false);
    }
  }, [hospitalId, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openAction = (rx, type) => {
    setSelectedPrescription(rx);
    setActionType(type);
    setActionFeedback("");

    if (type === "dispense") {
      setDispenseItems(
        (rx.items || []).map((i) => ({
          itemId: i._id,
          medicationCode: i.medicationCode,
          medicationName: i.medicationName,
          quantityPrescribed: i.quantityPrescribed,
          quantityAlreadyDispensed: i.quantityDispensed || 0,
          quantityToDispense: Math.max(0, i.quantityPrescribed - (i.quantityDispensed || 0)),
          batchNumber: "",
        }))
      );
    } else if (type === "return") {
      setReturnReason("");
      setReturnItems(
        (rx.items || [])
          .filter((i) => (i.quantityDispensed || 0) > 0)
          .map((i) => ({
            itemId: i._id,
            medicationCode: i.medicationCode,
            medicationName: i.medicationName,
            quantityDispensed: i.quantityDispensed,
            quantity: i.quantityDispensed,
          }))
      );
    }
  };

  const closeAction = () => {
    if (!actionBusy) {
      setSelectedPrescription(null);
      setActionType(null);
      setActionFeedback("");
    }
  };

  const submitDispense = async () => {
    setActionBusy(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/pharmacy/prescriptions/${selectedPrescription._id}/dispense`,
        { hospitalId, items: dispenseItems },
        { withCredentials: true }
      );
      closeAction();
      fetchData();
    } catch (err) {
      setActionFeedback(err.response?.data?.message || "Failed to dispense medications");
    } finally {
      setActionBusy(false);
    }
  };

  const submitReturn = async () => {
    if (!returnReason.trim()) {
      setActionFeedback("Return reason is required");
      return;
    }
    setActionBusy(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/pharmacy/prescriptions/${selectedPrescription._id}/return`,
        { hospitalId, items: returnItems, reason: returnReason.trim() },
        { withCredentials: true }
      );
      closeAction();
      fetchData();
    } catch (err) {
      setActionFeedback(err.response?.data?.message || "Failed to process return");
    } finally {
      setActionBusy(false);
    }
  };

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
      className="mp-page"
      style={{
        maxWidth: 1400,
        margin: "0 auto",
        padding: "32px 24px",
      }}
    >
      <div className="mp-section-heading" style={{ marginBottom: 24 }}>
        <div>
          <p className="mp-eyebrow">Hospital Pharmacy · Medication Dispensing</p>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Pill size={28} style={{ color: "var(--mp-teal)" }} />
            Hospital Pharmacy Operations
          </h1>
          <p style={{ color: "var(--mp-text-muted)" }}>
            Fulfill clinician-approved prescriptions, track batch stock and expiries, record verified dispensing, and manage returns.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={fetchData} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </Button>
        </div>
      </div>

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
                  placeholder="Search patient, medication or RX..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ minWidth: 260, marginBottom: 0 }}
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
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <h3 style={{ margin: 0, fontSize: 18 }}>{rx.patientInfo?.name || "Patient"}</h3>
                        <StatusBadge status={rx.status} />
                        {rx.verificationToken && (
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: 12,
                              padding: "2px 8px",
                              borderRadius: 4,
                              background: "rgba(15, 23, 42, 0.05)",
                              fontWeight: 600,
                            }}
                          >
                            {rx.verificationToken}
                          </span>
                        )}
                      </div>

                      <p style={{ margin: "4px 0", fontSize: 13, color: "var(--mp-text-muted)" }}>
                        Prescribed by: {rx.prescribingDoctorName || "Doctor"} · Date:{" "}
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
                              background: "rgba(15, 23, 42, 0.02)",
                              padding: "8px 12px",
                              borderRadius: 6,
                              fontSize: 13,
                            }}
                          >
                            <div>
                              <strong>{item.medicationName}</strong> ({item.medicationCode}) ·{" "}
                              <span style={{ color: "var(--mp-text-muted)" }}>{item.directions}</span>
                              {item.batchNumber && (
                                <span style={{ marginLeft: 8, fontFamily: "monospace", color: "var(--mp-teal)" }}>
                                  Batch: {item.batchNumber}
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span>
                                Qty: {item.quantityDispensed || 0} / {item.quantityPrescribed}
                              </span>
                              <StatusBadge status={item.itemStatus} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {["approved_by_doctor", "partially_dispensed"].includes(rx.status) && (
                        <Button onClick={() => openAction(rx, "dispense")} style={{ gap: 6 }}>
                          <PackageCheck size={16} /> Dispense Medication
                        </Button>
                      )}

                      {["partially_dispensed", "dispensed"].includes(rx.status) && (
                        <Button variant="secondary" onClick={() => openAction(rx, "return")} style={{ gap: 6 }}>
                          <RotateCcw size={16} /> Process Return
                        </Button>
                      )}

                      <Button variant="ghost" onClick={() => openAction(rx, "qr")} style={{ gap: 6 }}>
                        <QrCode size={16} /> QR Verification
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
                    <p style={{ margin: "4px 0", fontSize: 13, color: "var(--mp-text-muted)" }}>
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
                        <th style={{ padding: "6px 8px" }}>Available Qty</th>
                        <th style={{ padding: "6px 8px" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(item.batches || []).map((b, idx) => {
                        const isExpired = new Date(b.expiryDate) < new Date();
                        return (
                          <tr key={idx} style={{ borderBottom: "1px solid rgba(15, 23, 42, 0.05)" }}>
                            <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{b.batchNumber}</td>
                            <td style={{ padding: "6px 8px" }}>
                              {new Date(b.expiryDate).toLocaleDateString()}
                            </td>
                            <td style={{ padding: "6px 8px", fontWeight: 600 }}>{b.quantityAvailable}</td>
                            <td style={{ padding: "6px 8px" }}>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: isExpired ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.15)",
                                  color: isExpired ? "#ef4444" : "#10b981",
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
        <p>Confirm the quantities and batches dispensed to the patient.</p>
        <div style={{ maxHeight: 360, overflowY: "auto", margin: "16px 0" }}>
          {dispenseItems.map((item, idx) => (
            <div
              key={idx}
              style={{
                padding: 12,
                background: "rgba(15, 23, 42, 0.03)",
                borderRadius: 6,
                marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <strong>{item.medicationName}</strong>
                <span style={{ fontSize: 12, color: "var(--mp-text-muted)" }}>
                  Prescribed: {item.quantityPrescribed} (Already dispensed: {item.quantityAlreadyDispensed})
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field
                  label="Quantity to Dispense"
                  type="number"
                  min="0"
                  max={item.quantityPrescribed - item.quantityAlreadyDispensed}
                  value={item.quantityToDispense}
                  onChange={(e) => {
                    const updated = [...dispenseItems];
                    updated[idx].quantityToDispense = Number(e.target.value);
                    setDispenseItems(updated);
                  }}
                  disabled={actionBusy}
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
                  disabled={actionBusy}
                  style={{ marginBottom: 0 }}
                />
              </div>
            </div>
          ))}
        </div>

        {actionFeedback && <Banner tone="danger">{actionFeedback}</Banner>}

        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={closeAction} disabled={actionBusy}>
            Cancel
          </Button>
          <Button onClick={submitDispense} disabled={actionBusy}>
            {actionBusy ? "Processing..." : "Confirm Dispensing"}
          </Button>
        </div>
      </Dialog>

      {/* Return Modal */}
      <Dialog
        open={actionType === "return"}
        onClose={closeAction}
        title="Process Medication Return"
      >
        <p>Restores dispensed items back to inventory stock with an audited justification.</p>
        <Field
          label="Mandatory Reason for Return"
          value={returnReason}
          onChange={(e) => setReturnReason(e.target.value)}
          placeholder="e.g. Patient allergic reaction / clinician discontinued order..."
          required
          disabled={actionBusy}
        />

        <div style={{ maxHeight: 240, overflowY: "auto", margin: "16px 0" }}>
          {returnItems.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: 8,
                background: "rgba(15, 23, 42, 0.03)",
                borderRadius: 6,
                marginBottom: 8,
              }}
            >
              <div>
                <strong>{item.medicationName}</strong>
                <p style={{ margin: 0, fontSize: 11, color: "var(--mp-text-muted)" }}>
                  Dispensed: {item.quantityDispensed}
                </p>
              </div>
              <Field
                type="number"
                min="1"
                max={item.quantityDispensed}
                value={item.quantity}
                onChange={(e) => {
                  const updated = [...returnItems];
                  updated[idx].quantity = Number(e.target.value);
                  setReturnItems(updated);
                }}
                disabled={actionBusy}
                style={{ width: 90, marginBottom: 0 }}
              />
            </div>
          ))}
        </div>

        {actionFeedback && <Banner tone="danger">{actionFeedback}</Banner>}

        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={closeAction} disabled={actionBusy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submitReturn} disabled={actionBusy}>
            {actionBusy ? "Processing..." : "Confirm Return"}
          </Button>
        </div>
      </Dialog>

      {/* QR Code Dialog */}
      <Dialog
        open={actionType === "qr"}
        onClose={closeAction}
        title="Prescription QR Verification"
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
            <QrCode size={160} style={{ color: "#0f172a" }} />
          </div>
          <p
            style={{
              marginTop: 16,
              fontFamily: "monospace",
              fontSize: 16,
              fontWeight: 700,
              color: "var(--mp-teal)",
            }}
          >
            {selectedPrescription?.verificationToken}
          </p>
          <p style={{ fontSize: 13, color: "var(--mp-text-muted)", maxWidth: 360, margin: "8px auto 0" }}>
            Controlled verification token for patient collection and pharmacy auditing without exposing confidential medical records.
          </p>
        </div>
        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={closeAction}>
            Close
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
