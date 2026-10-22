/* eslint-disable react/prop-types */
import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import {
  Network,
  Server,
  HardDrive,
  KeyRound,
  Activity,
  Plus,
  RefreshCw,
  ExternalLink,
  Layers,
} from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../../components/ui";

const CONTRACT_STATUS_TONES = {
  configured: "info",
  active: "positive",
  downtime_hold: "warning",
  disabled: "danger",
};

const LIS_STATUS_TONES = {
  received: "neutral",
  processed: "positive",
  replay_queued: "warning",
  error: "danger",
};

const MODALITY_COLORS = {
  CT: { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE" },
  MRI: { bg: "#FAF5FF", text: "#7E22CE", border: "#E9D5FF" },
  XR: { bg: "#ECFDF5", text: "#047857", border: "#A7F3D0" },
  US: { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A" },
  PET: { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA" },
  NM: { bg: "#F0FDF4", text: "#15803D", border: "#BBF7D0" },
  OT: { bg: "#F8FAFC", text: "#334155", border: "#CBD5E1" },
};

export default function IntegrationsConsole({ initialTab = "contracts" }) {
  const { staffUser, isStaffAuth } = useAuth();
  if (!isStaffAuth) {
    return (
      <main className="mp-page">
        <Card>
          <h1>Hospital Staff Authentication Required</h1>
          <p>Please sign in with your hospital staff account to access External Interfaces & Operating Acceptance.</p>
        </Card>
      </main>
    );
  }
  return <IntegrationsWorkspace key={`${staffUser?._id || staffUser?.id}:${staffUser?.hospitalId}`} initialTab={initialTab} />;
}

function IntegrationsWorkspace({ initialTab = "contracts" }) {
  const { staffUser } = useAuth();
  const isAdmin = staffUser?.role === "HOSPITAL_ADMIN" || Boolean(staffUser?.adminAccess);

  const [activeTab, setActiveTab] = useState(initialTab);
  const [feedback, setFeedback] = useState(null);

  // Tab 1: Contracts state
  const [contracts, setContracts] = useState([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractType, setContractType] = useState("LIS_HL7");
  const [contractVersion, setContractVersion] = useState("HL7-v2.5.1");
  const [contractEndpoint, setContractEndpoint] = useState("https://lis.hospital.internal/hl7");
  const [contractContact, setContractContact] = useState("Systems Lead (ext 104)");
  const [contractSlaMinutes, setContractSlaMinutes] = useState("30");
  const [contractQueuePolicy, setContractQueuePolicy] = useState("store_and_forward");

  // Tab 2: LIS logs state
  const [lisLogs, setLisLogs] = useState([]);
  const [lisLoading, setLisLoading] = useState(false);
  const [lisModalOpen, setLisModalOpen] = useState(false);
  const [lisMessageControlId, setLisMessageControlId] = useState("");
  const [lisMessageType, setLisMessageType] = useState("HL7_ORU_R01");
  const [lisAccessionNo, setLisAccessionNo] = useState("");
  const [lisPayloadStr, setLisPayloadStr] = useState('{"test": "CBC", "hb": 14.2}');

  // Tab 3: PACS / DICOM state
  const [studies, setStudies] = useState([]);
  const [studiesLoading, setStudiesLoading] = useState(false);
  const [studyModalOpen, setStudyModalOpen] = useState(false);
  const [selectedStudy, setSelectedStudy] = useState(null);
  const [viewerModalOpen, setViewerModalOpen] = useState(false);
  const [studyUid, setStudyUid] = useState("");
  const [studyAccessionNo, setStudyAccessionNo] = useState("");
  const [studyPatientId, setStudyPatientId] = useState("");
  const [studyModality, setStudyModality] = useState("CT");
  const [studyDescription, setStudyDescription] = useState("");
  const [studySeriesCount, setStudySeriesCount] = useState("4");
  const [studyInstanceCount, setStudyInstanceCount] = useState("120");
  const [studyWadoUri, setStudyWadoUri] = useState("");
  const [studyReport, setStudyReport] = useState("");

  // Tab 4: SSO state
  const [ssoProfile, setSsoProfile] = useState(null);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoModalOpen, setSsoModalOpen] = useState(false);
  const [ssoIdpType, setSsoIdpType] = useState("azure_ad");
  const [ssoEntityId, setSsoEntityId] = useState("");
  const [ssoMetadataUrl, setSsoMetadataUrl] = useState("");
  const [ssoScimEnabled, setSsoScimEnabled] = useState(false);

  // Tab 5: DR & Acceptance state
  const [drAudits, setDrAudits] = useState([]);
  const [drLoading, setDrLoading] = useState(false);
  const [acceptanceReport, setAcceptanceReport] = useState(null);
  const [drModalOpen, setDrModalOpen] = useState(false);
  const [drType, setDrType] = useState("cold_standby_restore");
  const [drRpoMinutes, setDrRpoMinutes] = useState("5");
  const [drRtoMinutes, setDrRtoMinutes] = useState("25");
  const [drConductedBy, setDrConductedBy] = useState("DR Lead");
  const [drNotes, setDrNotes] = useState("");

  const authHeaders = useMemo(() => {
    return {
      withCredentials: true,
      headers: {
        "Content-Type": "application/json",
      },
    };
  }, []);

  // Fetch Contracts
  const loadContracts = useCallback(async () => {
    setContractsLoading(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/integrations/contracts`, authHeaders);
      if (res.data?.success) setContracts(res.data.contracts || []);
    } catch (err) {
      console.error("Failed to load interface contracts:", err);
    } finally {
      setContractsLoading(false);
    }
  }, [authHeaders]);

  // Fetch LIS Logs
  const loadLisLogs = useCallback(async () => {
    setLisLoading(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/integrations/lis/logs`, authHeaders);
      if (res.data?.success) setLisLogs(res.data.logs || []);
    } catch (err) {
      console.error("Failed to load LIS message logs:", err);
    } finally {
      setLisLoading(false);
    }
  }, [authHeaders]);

  // Fetch DICOM Studies
  const loadDicomStudies = useCallback(async () => {
    setStudiesLoading(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/integrations/pacs/studies`, authHeaders);
      if (res.data?.success) setStudies(res.data.studies || []);
    } catch (err) {
      console.error("Failed to load DICOM studies:", err);
    } finally {
      setStudiesLoading(false);
    }
  }, [authHeaders]);

  // Fetch SSO Profile
  const loadSsoProfile = useCallback(async () => {
    setSsoLoading(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/api/integrations/sso/profile`, authHeaders);
      if (res.data?.success) setSsoProfile(res.data.profile || null);
    } catch (err) {
      console.error("Failed to load SSO profile:", err);
    } finally {
      setSsoLoading(false);
    }
  }, [authHeaders]);

  // Fetch DR Audits & Acceptance Report
  const loadDrAndAcceptance = useCallback(async () => {
    setDrLoading(true);
    try {
      const [drRes, repRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/integrations/dr/audits`, authHeaders),
        axios.get(`${BACKEND_URL}/api/enterprise/acceptance/report`, authHeaders),
      ]);
      if (drRes.data?.success) setDrAudits(drRes.data.audits || []);
      if (repRes.data?.success) setAcceptanceReport(repRes.data.report || null);
    } catch (err) {
      console.error("Failed to load DR audits and acceptance report:", err);
    } finally {
      setDrLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (activeTab === "contracts") loadContracts();
    if (activeTab === "lis") loadLisLogs();
    if (activeTab === "pacs") loadDicomStudies();
    if (activeTab === "sso") loadSsoProfile();
    if (activeTab === "dr") loadDrAndAcceptance();
  }, [activeTab, loadContracts, loadLisLogs, loadDicomStudies, loadSsoProfile, loadDrAndAcceptance]);

  // Tab 1: Contract Handlers
  const handleSaveContract = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/integrations/contracts`,
        {
          interfaceType: contractType,
          contractVersion,
          endpointUrl: contractEndpoint,
          downtimeOwnership: {
            primaryContact: contractContact,
            escalationMinutes: Number(contractSlaMinutes),
            offlineQueuePolicy: contractQueuePolicy,
          },
        },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({ tone: "positive", message: `Interface contract '${contractType}' configured successfully.` });
        setContractModalOpen(false);
        loadContracts();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.error || err.message });
    }
  };

  // Tab 2: LIS Handlers
  const handleSendLisMessage = async (e) => {
    e.preventDefault();
    let parsedPayload;
    try {
      parsedPayload = JSON.parse(lisPayloadStr);
    } catch {
      setFeedback({ tone: "error", message: "Payload must be valid JSON format" });
      return;
    }
    const ctrlId = lisMessageControlId || `MSG-HL7-${Date.now()}`;
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/integrations/lis/inbound`,
        {
          messageControlId: ctrlId,
          messageType: lisMessageType,
          accessionNumber: lisAccessionNo,
          payload: parsedPayload,
        },
        authHeaders
      );
      if (res.data?.success) {
        const replayMsg = res.data.idempotentReplay ? " (Idempotent Replay)" : "";
        setFeedback({ tone: "positive", message: `LIS Message ${ctrlId} processed${replayMsg}.` });
        setLisModalOpen(false);
        setLisMessageControlId("");
        setLisAccessionNo("");
        loadLisLogs();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.error || err.message });
    }
  };

  const handleReplayLis = async (msgCtrlId) => {
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/integrations/lis/logs/${msgCtrlId}/replay`,
        {},
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({ tone: "positive", message: `Message ${msgCtrlId} replayed (Count: ${res.data.replayCount}).` });
        loadLisLogs();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.error || err.message });
    }
  };

  // Tab 3: PACS Handlers
  const handleRegisterDicom = async (e) => {
    e.preventDefault();
    const uid = studyUid || `1.2.840.113619.2.55.3.${Date.now()}`;
    const uri = studyWadoUri || `https://pacs.hospital.internal/wado/studies/${uid}`;
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/integrations/pacs/studies`,
        {
          studyInstanceUid: uid,
          accessionNumber: studyAccessionNo,
          patientId: studyPatientId,
          modality: studyModality,
          studyDescription,
          seriesCount: Number(studySeriesCount),
          instanceCount: Number(studyInstanceCount),
          wadoRsUri: uri,
          reportSummary: studyReport,
        },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({ tone: "positive", message: `DICOM study registered: ${res.data.study.studyInstanceUid}` });
        setStudyModalOpen(false);
        setStudyUid("");
        setStudyAccessionNo("");
        setStudyPatientId("");
        setStudyDescription("");
        setStudyReport("");
        loadDicomStudies();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.error || err.message });
    }
  };

  // Tab 4: SSO Handlers
  const handleSaveSso = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/integrations/sso/configure`,
        {
          idpType: ssoIdpType,
          entityId: ssoEntityId,
          metadataUrl: ssoMetadataUrl,
          scimEnabled: ssoScimEnabled,
          autoProvisionRoles: ["DOCTOR", "NURSE"],
        },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({ tone: "positive", message: "Enterprise SSO and SCIM settings saved successfully." });
        setSsoModalOpen(false);
        loadSsoProfile();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.error || err.message });
    }
  };

  // Tab 5: DR Handlers
  const handleRecordDr = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/integrations/dr/drills`,
        {
          drillType: drType,
          measuredRpoMinutes: Number(drRpoMinutes),
          measuredRtoMinutes: Number(drRtoMinutes),
          recordsIntegrityVerified: true,
          conductedBy: drConductedBy,
          auditNotes: drNotes,
        },
        authHeaders
      );
      if (res.data?.success) {
        setFeedback({
          tone: "positive",
          message: `Disaster Recovery observation recorded (Drill: ${res.data.audit.drillId}). Status: recorded_unverified.`,
        });
        setDrModalOpen(false);
        setDrNotes("");
        loadDrAndAcceptance();
      }
    } catch (err) {
      setFeedback({ tone: "error", message: err.response?.data?.error || err.message });
    }
  };

  return (
    <main className="mp-page" style={{ maxWidth: 1400, margin: "0 auto", padding: "1.5rem" }}>
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
            <Network style={{ color: "#2563EB" }} /> Hospital Integrations & Operating Acceptance
          </h1>
          <p style={{ margin: "0.25rem 0 0", color: "#64748B" }}>
            LIS Analyzer HL7/ASTM Messaging, PACS DICOM Study Metadata, Enterprise SSO/SCIM & DR Operating Acceptance
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <StatusBadge tone={isAdmin ? "positive" : "info"}>
            {staffUser?.role} • {staffUser?.name || "Staff"}
          </StatusBadge>
          <Button
            variant="outline"
            onClick={() => {
              if (activeTab === "contracts") loadContracts();
              if (activeTab === "lis") loadLisLogs();
              if (activeTab === "pacs") loadDicomStudies();
              if (activeTab === "sso") loadSsoProfile();
              if (activeTab === "dr") loadDrAndAcceptance();
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

      {/* Tabs */}
      <nav style={{ display: "flex", gap: "0.5rem", borderBottom: "2px solid #E2E8F0", marginBottom: "1.5rem" }}>
        <button
          type="button"
          onClick={() => setActiveTab("contracts")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "contracts" ? "3px solid #2563EB" : "3px solid transparent",
            color: activeTab === "contracts" ? "#2563EB" : "#64748B",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <Server size={18} /> Interface Contracts
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("lis")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "lis" ? "3px solid #059669" : "3px solid transparent",
            color: activeTab === "lis" ? "#059669" : "#64748B",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <Activity size={18} /> LIS Analyzer Exchange
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("pacs")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "pacs" ? "3px solid #7C3AED" : "3px solid transparent",
            color: activeTab === "pacs" ? "#7C3AED" : "#64748B",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <Layers size={18} /> PACS / DICOM Imaging
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("sso")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "sso" ? "3px solid #D97706" : "3px solid transparent",
            color: activeTab === "sso" ? "#D97706" : "#64748B",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <KeyRound size={18} /> Enterprise SSO & SCIM
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("dr")}
          style={{
            padding: "0.75rem 1.25rem",
            fontWeight: 600,
            border: "none",
            background: "none",
            borderBottom: activeTab === "dr" ? "3px solid #DC2626" : "3px solid transparent",
            color: activeTab === "dr" ? "#DC2626" : "#64748B",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <HardDrive size={18} /> DR Drills & Acceptance
        </button>
      </nav>

      {/* TAB 1: EXTERNAL INTERFACE CONTRACTS */}
      {activeTab === "contracts" && (
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
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Registered Interface Contracts</h2>
              <p style={{ margin: "0.25rem 0 0", color: "#64748B", fontSize: "0.875rem" }}>
                Active external interfaces, downtime ownership contacts, escalation SLAs and queue policies
              </p>
            </div>
            {isAdmin && (
              <Button onClick={() => setContractModalOpen(true)}>
                <Plus size={16} /> Configure Interface Contract
              </Button>
            )}
          </div>

          <Card style={{ padding: "1rem" }}>
            {contractsLoading ? (
              <LoadingState>Loading external interface contracts...</LoadingState>
            ) : contracts.length === 0 ? (
              <EmptyState title="No external interface contracts configured yet" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#F1F5F9", textAlign: "left" }}>
                      <th style={{ padding: "0.75rem" }}>Interface Type</th>
                      <th style={{ padding: "0.75rem" }}>Version</th>
                      <th style={{ padding: "0.75rem" }}>Endpoint URL</th>
                      <th style={{ padding: "0.75rem" }}>Downtime Contact & SLA</th>
                      <th style={{ padding: "0.75rem" }}>Offline Policy</th>
                      <th style={{ padding: "0.75rem" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.map((c) => (
                      <tr key={c._id} style={{ borderBottom: "1px solid #E2E8F0" }}>
                        <td style={{ padding: "0.75rem", fontWeight: 700, color: "#1E40AF" }}>
                          {c.interfaceType}
                        </td>
                        <td style={{ padding: "0.75rem" }}>{c.contractVersion}</td>
                        <td style={{ padding: "0.75rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#475569" }}>
                          {c.endpointUrl}
                        </td>
                        <td style={{ padding: "0.75rem" }}>
                          <div>{c.downtimeOwnership?.primaryContact}</div>
                          <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
                            Escalation: {c.downtimeOwnership?.escalationMinutes} mins
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase" }}>
                            {c.downtimeOwnership?.offlineQueuePolicy?.replace("_", " ")}
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem" }}>
                          <StatusBadge tone={CONTRACT_STATUS_TONES[c.status] || "neutral"}>{c.status}</StatusBadge>
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

      {/* TAB 2: LIS MESSAGE EXCHANGE & REPLAY */}
      {activeTab === "lis" && (
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
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>LIS Analyzer Message Exchange</h2>
              <p style={{ margin: "0.25rem 0 0", color: "#64748B", fontSize: "0.875rem" }}>
                Inbound HL7/ASTM lab messages, payload SHA-256 hash validation and replay idempotency
              </p>
            </div>
            <Button onClick={() => setLisModalOpen(true)}>
              <Plus size={16} /> Simulate Inbound LIS Message
            </Button>
          </div>

          <Card style={{ padding: "1rem" }}>
            {lisLoading ? (
              <LoadingState>Loading LIS message exchange logs...</LoadingState>
            ) : lisLogs.length === 0 ? (
              <EmptyState title="No LIS messages exchanged yet" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#F1F5F9", textAlign: "left" }}>
                      <th style={{ padding: "0.75rem" }}>Message Control ID</th>
                      <th style={{ padding: "0.75rem" }}>Type</th>
                      <th style={{ padding: "0.75rem" }}>Accession #</th>
                      <th style={{ padding: "0.75rem" }}>Payload Hash (SHA-256)</th>
                      <th style={{ padding: "0.75rem" }}>Status</th>
                      <th style={{ padding: "0.75rem", textAlign: "center" }}>Replay Count</th>
                      <th style={{ padding: "0.75rem", textAlign: "center" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lisLogs.map((log) => (
                      <tr key={log._id} style={{ borderBottom: "1px solid #E2E8F0" }}>
                        <td style={{ padding: "0.75rem", fontWeight: 700, color: "#0F172A" }}>
                          {log.messageControlId}
                        </td>
                        <td style={{ padding: "0.75rem" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#047857" }}>
                            {log.messageType}
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem" }}>{log.accessionNumber}</td>
                        <td style={{ padding: "0.75rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#64748B" }}>
                          {log.payloadHash?.slice(0, 16)}...
                        </td>
                        <td style={{ padding: "0.75rem" }}>
                          <StatusBadge tone={LIS_STATUS_TONES[log.status] || "neutral"}>{log.status}</StatusBadge>
                        </td>
                        <td style={{ padding: "0.75rem", textAlign: "center", fontWeight: 600 }}>
                          {log.replayCount}
                        </td>
                        <td style={{ padding: "0.75rem", textAlign: "center" }}>
                          <Button
                            size="small"
                            variant="outline"
                            onClick={() => handleReplayLis(log.messageControlId)}
                          >
                            Replay
                          </Button>
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

      {/* TAB 3: PACS / DICOM IMAGING */}
      {activeTab === "pacs" && (
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
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>PACS / DICOM Diagnostic Studies</h2>
              <p style={{ margin: "0.25rem 0 0", color: "#64748B", fontSize: "0.875rem" }}>
                Zero raw pixel bloat: Study Instance UIDs, Accessions, WADO-RS viewer endpoints and radiology summaries
              </p>
            </div>
            <Button onClick={() => setStudyModalOpen(true)}>
              <Plus size={16} /> Register DICOM Study
            </Button>
          </div>

          <Card style={{ padding: "1rem" }}>
            {studiesLoading ? (
              <LoadingState>Loading DICOM study references...</LoadingState>
            ) : studies.length === 0 ? (
              <EmptyState title="No DICOM studies registered yet" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#F1F5F9", textAlign: "left" }}>
                      <th style={{ padding: "0.75rem" }}>Modality</th>
                      <th style={{ padding: "0.75rem" }}>Study Description</th>
                      <th style={{ padding: "0.75rem" }}>Study UID & Accession</th>
                      <th style={{ padding: "0.75rem" }}>Patient</th>
                      <th style={{ padding: "0.75rem", textAlign: "center" }}>Series / Instances</th>
                      <th style={{ padding: "0.75rem", textAlign: "center" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studies.map((s) => {
                      const modStyle = MODALITY_COLORS[s.modality] || MODALITY_COLORS.OT;
                      return (
                        <tr key={s._id} style={{ borderBottom: "1px solid #E2E8F0" }}>
                          <td style={{ padding: "0.75rem" }}>
                            <span
                              style={{
                                padding: "0.2rem 0.5rem",
                                borderRadius: "4px",
                                fontWeight: 700,
                                fontSize: "0.75rem",
                                background: modStyle.bg,
                                color: modStyle.text,
                                border: `1px solid ${modStyle.border}`,
                              }}
                            >
                              {s.modality}
                            </span>
                          </td>
                          <td style={{ padding: "0.75rem", fontWeight: 600 }}>{s.studyDescription}</td>
                          <td style={{ padding: "0.75rem" }}>
                            <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#0F172A" }}>
                              {s.studyInstanceUid}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "#64748B" }}>Acc: {s.accessionNumber}</div>
                          </td>
                          <td style={{ padding: "0.75rem" }}>
                            {s.patientId?.firstName} {s.patientId?.lastName}
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "center", fontSize: "0.875rem" }}>
                            {s.seriesCount} series • {s.instanceCount} images
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "center" }}>
                            <Button
                              size="small"
                              variant="outline"
                              onClick={() => {
                                setSelectedStudy(s);
                                setViewerModalOpen(true);
                              }}
                            >
                              <ExternalLink size={14} /> View Study
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 4: ENTERPRISE SSO & SCIM */}
      {activeTab === "sso" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Enterprise SSO & Directory Provisioning</h2>
              <p style={{ margin: "0.25rem 0 0", color: "#64748B", fontSize: "0.875rem" }}>
                Federated Identity Providers (Azure AD, Okta, SAML 2.0, OIDC) & SCIM Automated Lifecycle Management
              </p>
            </div>
            {isAdmin && (
              <Button onClick={() => setSsoModalOpen(true)}>
                <KeyRound size={16} /> Configure Enterprise SSO
              </Button>
            )}
          </div>

          <Card style={{ padding: "1.25rem" }}>
            {ssoLoading ? (
              <LoadingState>Loading SSO profile...</LoadingState>
            ) : !ssoProfile ? (
              <EmptyState title="No Enterprise SSO profile active">
                <p>Configure an Identity Provider (IdP) to enable staff single sign-on and SCIM auto-provisioning.</p>
              </EmptyState>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#64748B" }}>Identity Provider Type</div>
                  <div style={{ fontWeight: 700, fontSize: "1.125rem", color: "#1E3A8A", textTransform: "uppercase" }}>
                    {ssoProfile.idpType?.replace("_", " ")}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#64748B" }}>SSO Status</div>
                  <StatusBadge tone="positive">Active & Federated</StatusBadge>
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#64748B" }}>Entity ID / Issuer</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.875rem" }}>{ssoProfile.entityId}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#64748B" }}>Metadata Federation URL</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.875rem", color: "#475569" }}>
                    {ssoProfile.metadataUrl || "Manual Certificate"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#64748B" }}>SCIM Automated Provisioning</div>
                  <div style={{ fontWeight: 600, color: ssoProfile.scimEnabled ? "#059669" : "#64748B" }}>
                    {ssoProfile.scimEnabled ? "Enabled (Directory Sync)" : "Disabled"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#64748B" }}>Auto-Provisioned Roles</div>
                  <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.25rem" }}>
                    {ssoProfile.autoProvisionRoles?.map((r) => (
                      <span
                        key={r}
                        style={{
                          background: "#F1F5F9",
                          padding: "0.15rem 0.4rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                        }}
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 5: DISASTER RECOVERY DRILLS & OPERATING ACCEPTANCE */}
      {activeTab === "dr" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Acceptance Report Section */}
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.5rem 0" }}>
              Enterprise Operating Acceptance Report
            </h2>
            <Card style={{ padding: "1.25rem", borderLeft: "4px solid #DC2626" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "0.875rem", color: "#64748B" }}>Operating Acceptance Status</div>
                  <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#DC2626" }}>
                    {acceptanceReport?.operatingAcceptance?.status?.toUpperCase() || "NOT ACCEPTED"}
                  </div>
                </div>
                <StatusBadge tone="danger">Boundary Enforced</StatusBadge>
              </div>

              <div style={{ marginTop: "1rem", fontSize: "0.875rem", color: "#475569" }}>
                <strong>Truthful Operating Disclaimer:</strong> {acceptanceReport?.operatingAcceptance?.disclaimer}
              </div>

              <div style={{ marginTop: "1rem", borderTop: "1px solid #E2E8F0", paddingTop: "0.75rem" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", fontWeight: 600 }}>Milestone Tracking</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
                  {acceptanceReport &&
                    Object.entries(acceptanceReport.milestones || {}).map(([key, m]) => (
                      <div key={key} style={{ padding: "0.5rem", background: "#F8FAFC", borderRadius: "6px" }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: 700 }}>{key}</div>
                        <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
                          Status: {m.status} (Task: {m.taskId})
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </Card>
          </div>

          {/* DR Drills Section */}
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
                <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Disaster Recovery (DR) Restoration Drills</h2>
                <p style={{ margin: "0.25rem 0 0", color: "#64748B", fontSize: "0.875rem" }}>
                  RPO/RTO restoration drill logs with unverified observation status boundary preservation
                </p>
              </div>
              {isAdmin && (
                <Button onClick={() => setDrModalOpen(true)}>
                  <Plus size={16} /> Record DR Drill Observation
                </Button>
              )}
            </div>

            <Card style={{ padding: "1rem" }}>
              {drLoading ? (
                <LoadingState>Loading disaster recovery audits...</LoadingState>
              ) : drAudits.length === 0 ? (
                <EmptyState title="No disaster recovery drill observations recorded yet" />
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#F1F5F9", textAlign: "left" }}>
                        <th style={{ padding: "0.75rem" }}>Drill ID</th>
                        <th style={{ padding: "0.75rem" }}>Drill Type</th>
                        <th style={{ padding: "0.75rem" }}>Date</th>
                        <th style={{ padding: "0.75rem", textAlign: "right" }}>Measured RPO</th>
                        <th style={{ padding: "0.75rem", textAlign: "right" }}>Measured RTO</th>
                        <th style={{ padding: "0.75rem" }}>Conducted By</th>
                        <th style={{ padding: "0.75rem" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drAudits.map((a) => (
                        <tr key={a._id} style={{ borderBottom: "1px solid #E2E8F0" }}>
                          <td style={{ padding: "0.75rem", fontWeight: 700, color: "#0F172A" }}>{a.drillId}</td>
                          <td style={{ padding: "0.75rem" }}>{a.drillType?.replace("_", " ")}</td>
                          <td style={{ padding: "0.75rem", color: "#64748B" }}>
                            {new Date(a.drillDate || a.createdAt).toISOString().slice(0, 10)}
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: 600 }}>
                            {a.measuredRpoMinutes} mins
                          </td>
                          <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: 600 }}>
                            {a.measuredRtoMinutes} mins
                          </td>
                          <td style={{ padding: "0.75rem" }}>{a.conductedBy}</td>
                          <td style={{ padding: "0.75rem" }}>
                            <StatusBadge tone="warning">{a.status}</StatusBadge>
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

      {/* DIALOG 1: Configure Contract */}
      <Dialog open={contractModalOpen} onClose={() => setContractModalOpen(false)} title="Configure Interface Contract">
        <form onSubmit={handleSaveContract} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="Interface Type"
            as="select"
            value={contractType}
            onChange={(e) => setContractType(e.target.value)}
          >
            <option value="LIS_HL7">LIS - HL7 v2.x (Laboratory)</option>
            <option value="LIS_ASTM">LIS - ASTM E1394 (Analyzers)</option>
            <option value="PACS_DICOM">PACS - DICOMweb / WADO-RS (Imaging)</option>
            <option value="SSO_SAML">SSO - SAML 2.0 (Identity)</option>
            <option value="SSO_OIDC">SSO - OpenID Connect (Identity)</option>
            <option value="ABDM_BRIDGE">ABDM - Ayushman Bharat Digital Mission</option>
          </Field>
          <Field
            label="Contract Version"
            required
            value={contractVersion}
            onChange={(e) => setContractVersion(e.target.value)}
            placeholder="e.g. HL7-v2.5.1"
          />
          <Field
            label="Endpoint URL"
            required
            value={contractEndpoint}
            onChange={(e) => setContractEndpoint(e.target.value)}
            placeholder="https://interface.hospital.internal/endpoint"
          />
          <Field
            label="Downtime Primary Contact"
            required
            value={contractContact}
            onChange={(e) => setContractContact(e.target.value)}
            placeholder="e.g. Systems Engineer Ramesh (ext 104)"
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <Field
              label="Escalation SLA (Minutes)"
              type="number"
              value={contractSlaMinutes}
              onChange={(e) => setContractSlaMinutes(e.target.value)}
            />
            <Field
              label="Offline Queue Policy"
              as="select"
              value={contractQueuePolicy}
              onChange={(e) => setContractQueuePolicy(e.target.value)}
            >
              <option value="store_and_forward">Store and Forward</option>
              <option value="fail_closed">Fail Closed</option>
            </Field>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setContractModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Save Contract
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 2: Simulate Inbound LIS Message */}
      <Dialog open={lisModalOpen} onClose={() => setLisModalOpen(false)} title="Simulate Inbound LIS Message">
        <form onSubmit={handleSendLisMessage} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="Message Control ID"
            value={lisMessageControlId}
            onChange={(e) => setLisMessageControlId(e.target.value)}
            placeholder="Auto-generated if empty"
            hint="Unique analyzer message tracking ID for replay deduplication"
          />
          <Field
            label="Message Type"
            as="select"
            value={lisMessageType}
            onChange={(e) => setLisMessageType(e.target.value)}
          >
            <option value="HL7_ORU_R01">HL7 ORU_R01 (Observation Results)</option>
            <option value="HL7_OML_O21">HL7 OML_O21 (Lab Order Confirmation)</option>
            <option value="ASTM_E1394">ASTM E1394 (Direct Instrument Data)</option>
          </Field>
          <Field
            label="Accession Number"
            required
            value={lisAccessionNo}
            onChange={(e) => setLisAccessionNo(e.target.value)}
            placeholder="e.g. ACC-LAB-2026-99"
          />
          <Field
            label="Message Payload (JSON)"
            as="textarea"
            rows={4}
            required
            value={lisPayloadStr}
            onChange={(e) => setLisPayloadStr(e.target.value)}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setLisModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Ingest Message
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 3: Register DICOM Study */}
      <Dialog open={studyModalOpen} onClose={() => setStudyModalOpen(false)} title="Register PACS / DICOM Study">
        <form onSubmit={handleRegisterDicom} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="Study Instance UID"
            value={studyUid}
            onChange={(e) => setStudyUid(e.target.value)}
            placeholder="Auto-generated if empty (e.g. 1.2.840.113619.2...)"
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <Field
              label="Accession #"
              required
              value={studyAccessionNo}
              onChange={(e) => setStudyAccessionNo(e.target.value)}
              placeholder="e.g. RAD-2026-001"
            />
            <Field
              label="Patient ID"
              required
              value={studyPatientId}
              onChange={(e) => setStudyPatientId(e.target.value)}
              placeholder="Patient User ObjectId"
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.75rem" }}>
            <Field
              label="Modality"
              as="select"
              value={studyModality}
              onChange={(e) => setStudyModality(e.target.value)}
            >
              <option value="CT">CT (Computed Tomography)</option>
              <option value="MRI">MRI (Magnetic Resonance)</option>
              <option value="XR">XR (X-Ray)</option>
              <option value="US">US (Ultrasound)</option>
              <option value="PET">PET (Positron Emission)</option>
              <option value="NM">NM (Nuclear Medicine)</option>
            </Field>
            <Field
              label="Study Description"
              required
              value={studyDescription}
              onChange={(e) => setStudyDescription(e.target.value)}
              placeholder="e.g. Brain MRI with Diffusion & Perfusion"
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: "0.75rem" }}>
            <Field
              label="Series Count"
              type="number"
              value={studySeriesCount}
              onChange={(e) => setStudySeriesCount(e.target.value)}
            />
            <Field
              label="Instance Count"
              type="number"
              value={studyInstanceCount}
              onChange={(e) => setStudyInstanceCount(e.target.value)}
            />
            <Field
              label="WADO URI (Viewer)"
              value={studyWadoUri}
              onChange={(e) => setStudyWadoUri(e.target.value)}
              placeholder="Auto-generated if empty"
            />
          </div>
          <Field
            label="Radiology Report Summary"
            as="textarea"
            rows={3}
            value={studyReport}
            onChange={(e) => setStudyReport(e.target.value)}
            placeholder="Impression summary..."
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setStudyModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Register Study Reference
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 4: View DICOM Study */}
      <Dialog
        open={viewerModalOpen}
        onClose={() => setViewerModalOpen(false)}
        title={`DICOM Study: ${selectedStudy?.studyDescription || "Imaging"}`}
      >
        {selectedStudy && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ background: "#F8FAFC", padding: "1rem", borderRadius: "8px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "0.875rem" }}>
                <div>
                  <span style={{ color: "#64748B" }}>Modality:</span> <strong>{selectedStudy.modality}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748B" }}>Accession:</span> <strong>{selectedStudy.accessionNumber}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748B" }}>Series / Images:</span>{" "}
                  <strong>
                    {selectedStudy.seriesCount} series / {selectedStudy.instanceCount} frames
                  </strong>
                </div>
                <div>
                  <span style={{ color: "#64748B" }}>Study UID:</span>{" "}
                  <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{selectedStudy.studyInstanceUid}</span>
                </div>
              </div>
            </div>

            <div>
              <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", fontWeight: 600 }}>Radiologist Summary</h4>
              <p style={{ margin: 0, padding: "0.75rem", background: "#EFF6FF", borderRadius: "6px", fontSize: "0.875rem", color: "#1E3A8A" }}>
                {selectedStudy.reportSummary || "No diagnostic impression summary recorded."}
              </p>
            </div>

            <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: "0.75rem" }}>
              <div style={{ fontSize: "0.75rem", color: "#64748B", marginBottom: "0.25rem" }}>WADO-RS Endpoint</div>
              <div style={{ padding: "0.5rem", background: "#F1F5F9", borderRadius: "4px", fontFamily: "monospace", fontSize: "0.75rem", wordBreak: "break-all" }}>
                {selectedStudy.wadoRsUri}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.5rem" }}>
              <Button variant="primary" onClick={() => setViewerModalOpen(false)}>
                Close Viewer
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* DIALOG 5: Configure SSO */}
      <Dialog open={ssoModalOpen} onClose={() => setSsoModalOpen(false)} title="Configure Enterprise Identity Provider">
        <form onSubmit={handleSaveSso} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="Identity Provider (IdP)"
            as="select"
            value={ssoIdpType}
            onChange={(e) => setSsoIdpType(e.target.value)}
          >
            <option value="azure_ad">Microsoft Entra ID (Azure AD)</option>
            <option value="okta">Okta Workforce Identity</option>
            <option value="generic_saml">Generic SAML 2.0</option>
            <option value="generic_oidc">Generic OpenID Connect</option>
          </Field>
          <Field
            label="Entity ID / Issuer URI"
            required
            value={ssoEntityId}
            onChange={(e) => setSsoEntityId(e.target.value)}
            placeholder="spn:medanta-enterprise-identity"
          />
          <Field
            label="Metadata URL (Optional)"
            value={ssoMetadataUrl}
            onChange={(e) => setSsoMetadataUrl(e.target.value)}
            placeholder="https://login.microsoftonline.com/.../federationmetadata.xml"
          />
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              id="scimCheck"
              checked={ssoScimEnabled}
              onChange={(e) => setSsoScimEnabled(e.target.checked)}
            />
            <label htmlFor="scimCheck" style={{ fontSize: "0.875rem", fontWeight: 600 }}>
              Enable SCIM 2.0 Automated User Directory Provisioning
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setSsoModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Save SSO Configuration
            </Button>
          </div>
        </form>
      </Dialog>

      {/* DIALOG 6: Record DR Drill */}
      <Dialog open={drModalOpen} onClose={() => setDrModalOpen(false)} title="Record Disaster Recovery Drill Observation">
        <form onSubmit={handleRecordDr} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Field
            label="Drill Type"
            as="select"
            value={drType}
            onChange={(e) => setDrType(e.target.value)}
          >
            <option value="cold_standby_restore">Cold Standby Database Restore</option>
            <option value="oplog_replay_check">Oplog Point-in-Time Replay</option>
            <option value="failover_simulation">Multi-AZ Database Failover</option>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <Field
              label="Measured RPO (Minutes)"
              type="number"
              required
              value={drRpoMinutes}
              onChange={(e) => setDrRpoMinutes(e.target.value)}
            />
            <Field
              label="Measured RTO (Minutes)"
              type="number"
              required
              value={drRtoMinutes}
              onChange={(e) => setDrRtoMinutes(e.target.value)}
            />
          </div>
          <Field
            label="Conducted By"
            required
            value={drConductedBy}
            onChange={(e) => setDrConductedBy(e.target.value)}
            placeholder="e.g. IT Disaster Recovery Lead"
          />
          <Field
            label="Audit Notes"
            as="textarea"
            rows={3}
            value={drNotes}
            onChange={(e) => setDrNotes(e.target.value)}
            placeholder="Observations, replication lag notes..."
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <Button variant="ghost" onClick={() => setDrModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Record Observation
            </Button>
          </div>
        </form>
      </Dialog>
    </main>
  );
}
