import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import {
  ShieldAlert,
  BarChart3,
  KeyRound,
  Download,
  LifeBuoy,
  CreditCard,
  Building2,
  RefreshCw,
} from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, Dialog, Field, LoadingState, StatusBadge } from "../../components/ui";

export default function SaaSOperationsConsole() {
  const { staffUser, staffHospital } = useAuth();
  const hospitalId = staffUser?.hospitalId || staffHospital?._id;

  const [metrics, setMetrics] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modals
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [setupLinkResult, setSetupLinkResult] = useState(null);
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDesc, setTicketDesc] = useState("");
  const [ticketPriority, setTicketPriority] = useState("medium");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState("");
  const [exportData, setExportData] = useState(null);

  const fetchTenantData = useCallback(async () => {
    if (!hospitalId) return;
    try {
      setLoading(true);
      const [metricsRes, tenantRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/saas/tenants/${hospitalId}/metrics`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/api/saas/tenants/${hospitalId}`, { withCredentials: true }),
      ]);
      setMetrics(metricsRes.data.metrics);
      setTenant(tenantRes.data.hospital);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load operational data");
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => {
    fetchTenantData();
  }, [fetchTenantData]);

  const handleGenerateSetupLink = async () => {
    setActionBusy(true);
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/saas/tenants/${hospitalId}/setup-link`,
        {},
        { withCredentials: true }
      );
      setSetupLinkResult(res.data);
      setActionFeedback("");
    } catch (err) {
      setActionFeedback(err.response?.data?.message || "Failed to generate setup link");
    } finally {
      setActionBusy(false);
    }
  };

  const handleSubmitTicket = async () => {
    if (!ticketSubject.trim() || !ticketDesc.trim()) {
      setActionFeedback("Subject and description are required");
      return;
    }
    setActionBusy(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/saas/tenants/${hospitalId}/support-tickets`,
        { subject: ticketSubject.trim(), description: ticketDesc.trim(), priority: ticketPriority },
        { withCredentials: true }
      );
      setSupportModalOpen(false);
      setTicketSubject("");
      setTicketDesc("");
      fetchTenantData();
    } catch (err) {
      setActionFeedback(err.response?.data?.message || "Failed to submit ticket");
    } finally {
      setActionBusy(false);
    }
  };

  const handleExportData = async () => {
    setActionBusy(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/saas/tenants/${hospitalId}/export`, {
        withCredentials: true,
      });
      setExportData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || "Export failed");
    } finally {
      setActionBusy(false);
    }
  };

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
          <p className="mp-eyebrow">Platform Administration · Multi-Tenant Operations</p>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Building2 size={28} style={{ color: "var(--mp-teal)" }} />
            SaaS Onboarding & Tenant Operations
          </h1>
          <p style={{ color: "var(--mp-text-muted)" }}>
            Server-enforced subscription entitlements, expiring administrative setup invitations, operational metrics, and compliance exports.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={fetchTenantData} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </Button>
        </div>
      </div>

      {error && <Banner tone="danger" style={{ marginBottom: 16 }}>{error}</Banner>}

      {tenant?.suspension?.isSuspended && (
        <Banner tone="danger" style={{ marginBottom: 20 }}>
          <ShieldAlert size={18} /> <strong>Tenant Suspended:</strong> {tenant.suspension.reason} (Suspended by {tenant.suspension.suspendedBy})
        </Banner>
      )}

      {loading && !tenant ? (
        <LoadingState>Loading SaaS operations data...</LoadingState>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Top Row: Subscription Status & Operational Metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
            {/* Plan Card */}
            <Card>
              <h2 style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <CreditCard size={18} style={{ color: "var(--mp-teal)" }} /> Subscription Plan & Entitlements
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 24, fontWeight: 700, textTransform: "capitalize" }}>
                  {tenant?.subscription?.plan || "Starter"} Plan
                </span>
                <StatusBadge status={tenant?.subscription?.status || "active"} />
              </div>

              <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 6, color: "var(--mp-text-muted)" }}>
                <div>Max Staff Entitlement: <strong>{tenant?.subscription?.entitlements?.maxStaff || 10} members</strong></div>
                <div>Max Departments: <strong>{tenant?.subscription?.entitlements?.maxDepartments || 3} depts</strong></div>
                <div>
                  Enabled Features:{" "}
                  <strong>{(tenant?.subscription?.entitlements?.features || ["opd", "queue"]).join(", ")}</strong>
                </div>
              </div>
            </Card>

            {/* Metrics Overview Card */}
            <Card>
              <h2 style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <BarChart3 size={18} style={{ color: "var(--mp-teal)" }} /> Operational Performance (Privacy-Safe)
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--mp-text-muted)" }}>Total Bookings</p>
                  <strong style={{ fontSize: 20 }}>{metrics?.totalBookings ?? 0}</strong>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--mp-text-muted)" }}>Completed Visits</p>
                  <strong style={{ fontSize: 20, color: "#10b981" }}>{metrics?.completedVisits ?? 0}</strong>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--mp-text-muted)" }}>No-Show Rate</p>
                  <strong style={{ fontSize: 20 }}>{metrics?.noShowRatePercent ?? 0}%</strong>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--mp-text-muted)" }}>Staff Setup Progress</p>
                  <strong style={{ fontSize: 20, color: "var(--mp-teal)" }}>
                    {metrics?.staffSetupCompletionPercent ?? 0}%
                  </strong>
                </div>
              </div>
            </Card>
          </div>

          {/* Actions & Tools */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            {/* Expiring Setup Invitation */}
            <Card>
              <h2 style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <KeyRound size={18} style={{ color: "var(--mp-teal)" }} /> Administrator Setup Links
              </h2>
              <p style={{ fontSize: 13, color: "var(--mp-text-muted)", marginBottom: 16 }}>
                Generate a secure, single-use 48-hour expiring onboarding link instead of transmitting plain passwords over email.
              </p>
              <Button onClick={() => setSetupModalOpen(true)} style={{ width: "100%", justifyContent: "center" }}>
                Generate Expiring Setup Link
              </Button>
            </Card>

            {/* Support Tickets */}
            <Card>
              <h2 style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <LifeBuoy size={18} style={{ color: "var(--mp-teal)" }} /> Platform Support & Tickets
              </h2>
              <p style={{ fontSize: 13, color: "var(--mp-text-muted)", marginBottom: 16 }}>
                Report operational concerns, delivery bottlenecks, or tenant configuration issues directly to platform operations.
              </p>
              <Button
                variant="secondary"
                onClick={() => setSupportModalOpen(true)}
                style={{ width: "100%", justifyContent: "center" }}
              >
                File Support Ticket
              </Button>
            </Card>

            {/* Compliance Export */}
            <Card>
              <h2 style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Download size={18} style={{ color: "var(--mp-teal)" }} /> Tenant Export & Data Retention
              </h2>
              <p style={{ fontSize: 13, color: "var(--mp-text-muted)", marginBottom: 16 }}>
                Export tenant operational configurations, department directories, and public profiles in accordance with HIPAA / NDHM standards.
              </p>
              <Button
                variant="secondary"
                onClick={handleExportData}
                disabled={actionBusy}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {actionBusy ? "Exporting..." : "Export Tenant Data"}
              </Button>
            </Card>
          </div>

          {/* Export JSON Preview */}
          {exportData && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Compliance Export Generated ({exportData.retentionPolicy})</h3>
                <Button variant="ghost" onClick={() => setExportData(null)}>Close</Button>
              </div>
              <pre
                style={{
                  background: "rgba(15, 23, 42, 0.05)",
                  padding: 16,
                  borderRadius: 8,
                  maxHeight: 240,
                  overflowY: "auto",
                  fontSize: 12,
                }}
              >
                {JSON.stringify(exportData, null, 2)}
              </pre>
            </Card>
          )}

          {/* Support Tickets List */}
          {tenant?.supportTickets?.length > 0 && (
            <Card>
              <h3 style={{ marginBottom: 12 }}>Recent Support Inquiries</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tenant.supportTickets.map((t, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 12px",
                      background: "rgba(15, 23, 42, 0.02)",
                      borderRadius: 6,
                    }}
                  >
                    <div>
                      <strong>[{t.ticketId}] {t.subject}</strong>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--mp-text-muted)" }}>
                        {t.description} · Priority: {t.priority}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Setup Link Modal */}
      <Dialog
        open={setupModalOpen}
        onClose={() => {
          setSetupModalOpen(false);
          setSetupLinkResult(null);
        }}
        title="Hospital Admin Onboarding Link"
      >
        <p>
          Generates a single-use cryptographically signed link valid for 48 hours. The recipient can securely configure their credentials.
        </p>
        {!setupLinkResult ? (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <Button onClick={handleGenerateSetupLink} disabled={actionBusy}>
              {actionBusy ? "Generating..." : "Generate 48-Hour Link"}
            </Button>
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <Field
              label="Secure Invitation URL"
              readOnly
              value={setupLinkResult.setupUrl}
              style={{ fontFamily: "monospace" }}
            />
            <p style={{ fontSize: 12, color: "var(--mp-text-muted)" }}>
              Expires on: {new Date(setupLinkResult.expiresAt).toLocaleString()}
            </p>
          </div>
        )}
        {actionFeedback && <Banner tone="danger">{actionFeedback}</Banner>}
        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={() => setSetupModalOpen(false)}>
            Close
          </Button>
        </div>
      </Dialog>

      {/* Support Ticket Modal */}
      <Dialog
        open={supportModalOpen}
        onClose={() => setSupportModalOpen(false)}
        title="Submit Platform Support Ticket"
      >
        <Field
          label="Subject"
          value={ticketSubject}
          onChange={(e) => setTicketSubject(e.target.value)}
          placeholder="Brief summary of the inquiry or issue..."
          required
        />
        <Field
          as="textarea"
          label="Detailed Description"
          value={ticketDesc}
          onChange={(e) => setTicketDesc(e.target.value)}
          placeholder="Provide necessary operational context..."
          required
        />
        <Field
          as="select"
          label="Priority"
          value={ticketPriority}
          onChange={(e) => setTicketPriority(e.target.value)}
        >
          <option value="low">Low - General inquiry</option>
          <option value="medium">Medium - Operational question</option>
          <option value="high">High - Feature bottleneck</option>
          <option value="urgent">Urgent - Care workflow impacted</option>
        </Field>
        {actionFeedback && <Banner tone="danger">{actionFeedback}</Banner>}
        <div className="mp-actions" style={{ marginTop: 20 }}>
          <Button variant="secondary" onClick={() => setSupportModalOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmitTicket} disabled={actionBusy}>
            {actionBusy ? "Submitting..." : "Submit Ticket"}
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
