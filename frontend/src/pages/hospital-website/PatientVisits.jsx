/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowRight, Building2, CalendarDays, RefreshCcw, Printer, Link2, MapPin, FileText, QrCode, ShieldCheck, CheckCircle2 } from "lucide-react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { useHospitalBrand } from "../../components/ProductShell";
import { useCareResource } from "../../hooks/useCareResource";
import { careLabels, feeText, visitTime } from "../../utils/appointments";
import { Banner, Button, Card, Dialog, EmptyState, LoadingState, StatusBadge } from "../../components/ui";
import { QrCodeSvg } from "../../utils/qrCode.js";
import { BACKEND_URL } from "../../utils";

export default function PatientVisits({ slug }) {
  const { isAuth, role, user, loader } = useAuth();
  const { hospital } = useHospitalBrand();
  const ownerId = user?._id;
  const scheduled = useCareResource(isAuth && role === "user" ? "/api/scheduling/reservations?limit=50" : null, ownerId, 10000);
  const { tokenId } = useParams();
  const [loadedOwner, setLoadedOwner] = useState(null), [visits, setVisits] = useState([]);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0), [refreshedAt, setRefreshedAt] = useState(null);
  const [activeTicket, setActiveTicket] = useState(null);
  const [activePacket, setActivePacket] = useState(null);
  const [packetLoading, setPacketLoading] = useState(false);
  const [packetError, setPacketError] = useState("");
  const [linkingVisitId, setLinkingVisitId] = useState(null);
  const [linkFeedback, setLinkFeedback] = useState("");

  useEffect(() => {
    if (!isAuth || role !== "user" || !ownerId) {
      setVisits([]);
      setLoadedOwner(null);
      setActiveTicket(null);
      setActivePacket(null);
      return undefined;
    }
    if (loadedOwner && loadedOwner !== ownerId) {
      setVisits([]);
      setLoadedOwner(null);
      setActiveTicket(null);
      setActivePacket(null);
    }
    let disposed = false, sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      try {
        const profile = await axios.get(BACKEND_URL + "/api/hospitals/" + encodeURIComponent(slug));
        const response = await axios.get(BACKEND_URL + "/api/opd/" + profile.data.hospital._id + "/my-token", { withCredentials: true });
        if (!disposed && request === sequence) {
          setLoadedOwner(ownerId);
          setVisits(response.data.tokens || (response.data.token ? [response.data.token] : []));
          setError("");
          setLoading(false);
          setRefreshedAt(new Date());
        }
      } catch {
        if (!disposed && request === sequence) {
          setError("Unable to refresh your visit. Please try again.");
          setLoading(false);
        }
      }
    };
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => { disposed = true; clearInterval(interval); };
  }, [slug, isAuth, role, ownerId, attempt]);

  const scheduledVisits = (scheduled.data?.visits || []).filter(
    (item) => item.session.hospitalId === hospital?._id && (!tokenId || item.reservation.tokenId === tokenId)
  );

  const refreshAll = () => {
    setAttempt((value) => value + 1);
    scheduled.refresh();
  };

  const [claimDialogVisit, setClaimDialogVisit] = useState(null);
  const [claimStep, setClaimStep] = useState("init");
  const [claimOtp, setClaimOtp] = useState("");
  const [claimPhone, setClaimPhone] = useState("");
  const [claimFamilyId, setClaimFamilyId] = useState("");
  const [claimError, setClaimError] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimNotice, setClaimNotice] = useState("");

  const visible = loadedOwner === ownerId ? (tokenId ? visits.filter((visit) => visit._id === tokenId) : visits) : [];

  const openPacketModal = async (visit) => {
    setActivePacket(null);
    setPacketLoading(true);
    setPacketError("");
    try {
      const res = await axios.get(`${BACKEND_URL}/api/patients/me/visits/${visit._id}/packet`, { withCredentials: true });
      setActivePacket(res.data?.packet || null);
    } catch (err) {
      setPacketError(err.response?.data?.message || "Unable to load released visit documents.");
    } finally {
      setPacketLoading(false);
    }
  };

  const openClaimModal = (visit) => {
    setClaimDialogVisit(visit);
    setClaimStep("init");
    setClaimOtp("");
    setClaimPhone(visit.patientInfo?.phone || (user?.phoneNumber ? String(user.phoneNumber) : ""));
    setClaimFamilyId("");
    setClaimError("");
    setClaimNotice("");
  };

  const handleRequestOtp = async () => {
    if (!claimDialogVisit) return;
    setClaimLoading(true);
    setClaimError("");
    try {
      const res = await axios.post(
        `${BACKEND_URL}/api/encounters/${claimDialogVisit._id}/claim-challenge`,
        {
          phone: claimPhone || undefined,
          familyMemberId: claimFamilyId || undefined,
        },
        { withCredentials: true }
      );
      setClaimNotice(res.data?.message || "Verification code sent!");
      setClaimStep("otp_sent");
    } catch (err) {
      setClaimError(err.response?.data?.message || "Could not request verification code.");
    } finally {
      setClaimLoading(false);
    }
  };

  const handleVerifyAndLink = async () => {
    if (!claimDialogVisit || !claimOtp) return;
    setClaimLoading(true);
    setClaimError("");
    try {
      const verifyRes = await axios.post(
        `${BACKEND_URL}/api/encounters/${claimDialogVisit._id}/verify-claim`,
        { otp: claimOtp },
        { withCredentials: true }
      );
      const claimProof = verifyRes.data?.claimProof;
      if (!claimProof) throw new Error("Could not obtain verified claim proof.");

      const linkRes = await axios.post(
        `${BACKEND_URL}/api/encounters/${claimDialogVisit._id}/link-account`,
        {
          claimProof,
          familyMemberId: claimFamilyId || undefined,
        },
        { withCredentials: true }
      );

      setLinkFeedback(linkRes.data?.message || "Walk-in visit linked successfully to your account!");
      setClaimDialogVisit(null);
      refreshAll();
    } catch (err) {
      setClaimError(err.response?.data?.message || err.message || "Could not link walk-in visit to account.");
    } finally {
      setClaimLoading(false);
    }
  };

  return (
    <main className="mp-page mp-page--patient">
      <div className="mp-section-heading">
        <div>
          <p className="mp-eyebrow">Your hospital care journey</p>
          <h1>My hospital visits</h1>
          <p>{hospital?.name || "Follow your active hospital visits"}</p>
        </div>
        {isAuth && role === "user" && (
          <Button variant="secondary" onClick={refreshAll}>
            <RefreshCcw size={16} /> Refresh visits
          </Button>
        )}
      </div>

      {linkFeedback && (
        <Banner tone={linkFeedback.includes("success") ? "positive" : "error"}>
          {linkFeedback}
        </Banner>
      )}

      {loader ? (
        <LoadingState>Loading your patient session...</LoadingState>
      ) : !isAuth || role !== "user" ? (
        <Card>
          <EmptyState
            title="Your visit, in one place"
            action={
              <Button to="/login">
                Patient sign in <ArrowRight size={16} />
              </Button>
            }
          >
            Sign in as a patient to see your visit.
          </EmptyState>
        </Card>
      ) : (
        <>
          {scheduled.error && (
            <Banner action={<Button onClick={scheduled.refresh} variant="secondary">Retry reservations</Button>}>
              {scheduled.error}
            </Banner>
          )}

          {scheduledVisits.length > 0 && (
            <section className="mp-stack" aria-label="Scheduled hospital visits">
              <h2>Your reservations</h2>
              <div className="mp-visit-grid">
                {scheduledVisits.map((item) => (
                  <Card key={item.reservation._id}>
                    <div className="mp-card-heading">
                      <h3>{careLabels[item.session.appointmentType]}</h3>
                      <StatusBadge
                        status={
                          item.reservation.state === "confirmed" && item.appointment?.admissionState === "reserved"
                            ? "reserved"
                            : item.appointment?.status || item.reservation.state
                        }
                      />
                    </div>
                    <p>{visitTime(item.reservation.startsAt, item.session.timezone)}</p>
                    <p className="mp-field-hint">
                      {feeText(item.reservation.fee)} demo credits · {item.session.timezone}
                    </p>
                    <p>{item.nextStep}</p>
                    <Button to={"/reservations/" + item.reservation._id}>Follow this reservation</Button>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {error && (
            <Banner action={<Button variant="secondary" size="small" onClick={refreshAll}>Retry</Button>}>
              {error} {refreshedAt && "Displayed details are from the last successful refresh."}
            </Banner>
          )}

          {loading && !error ? (
            <LoadingState>Loading your visit...</LoadingState>
          ) : !visible.length && !error ? (
            <Card>
              <EmptyState
                title="No active visit found at this hospital."
                action={<Button to="/" variant="secondary">Explore hospital care</Button>}
              >
                New reservations appear here after booking. Ask reception if you need help finding an existing visit.
              </EmptyState>
            </Card>
          ) : (
            <div className="mp-visit-grid">
              {visible.map((visit) => {
                const isWalkIn = Boolean(visit.patientInfo?.isWalkIn);
                return (
                  <Card key={visit._id} aria-label="Current visit">
                    <div className="mp-card-heading">
                      <span className="mp-eyebrow" style={{ margin: 0 }}>Your OPD token</span>
                      <StatusBadge status={visit.status} />
                    </div>

                    <div className="mp-visit-token">
                      <h2>Token {visit.displayToken || visit.tokenNumber}</h2>
                      <CalendarDays size={25} aria-hidden="true" style={{ color: "var(--mp-accent-ink)" }} />
                    </div>

                    <dl className="mp-details">
                      <div>
                        <dt>Service date</dt>
                        <dd>{visit.serviceDate || "Not supplied"}</dd>
                      </div>
                      <div>
                        <dt>Care session</dt>
                        <dd>{visit.sessionId || "Not supplied"}</dd>
                      </div>
                      <div>
                        <dt>Visit mode</dt>
                        <dd>In person</dd>
                      </div>
                      {visit.patientInfo?.name && (
                        <div>
                          <dt>Patient</dt>
                          <dd>{visit.patientInfo.name}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Next Destination</dt>
                        <dd style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <MapPin size={14} style={{ color: "var(--mp-primary)" }} />
                          {visit.currentDestination?.name && visit.currentDestination.name !== "not recorded"
                            ? `${visit.currentDestination.name}${visit.currentDestination.building ? ` · ${visit.currentDestination.building}` : ""}${visit.currentDestination.floor ? ` (${visit.currentDestination.floor})` : ""}`
                            : "not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt>Physical file</dt>
                        <dd style={{ color: "var(--mp-muted)", fontSize: "0.88rem" }}>
                          <FileText size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                          {visit.physicalFile?.tracked
                            ? (visit.physicalFile?.location && visit.physicalFile.location !== "not recorded"
                                ? `Tracked at ${visit.physicalFile.location}`
                                : "Physical file active (location not recorded)")
                            : "Electronic record only"}
                        </dd>
                      </div>
                    </dl>

                    <p className="mp-visit-note">
                      {visit.status === "reserved"
                        ? "Your visit is reserved. Check in with reception when you arrive to join the care queue."
                        : visit.status === "in_consultation"
                        ? "Your consultation is ready. Follow the hospital staff instructions when called."
                        : "The hospital team will call you when your consultation is ready. Ask reception for directions."}
                    </p>

                    <div className="mp-actions" style={{ flexWrap: "wrap", gap: 8 }}>
                      <Button
                        to={visit.scheduleReservationId ? "/reservations/" + visit.scheduleReservationId : "/visits/" + visit._id}
                      >
                        Open this visit <ArrowRight size={16} />
                      </Button>
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => openPacketModal(visit)}
                      >
                        <FileText size={15} /> Care Packet & Records
                      </Button>
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => setActiveTicket(visit)}
                      >
                        <Printer size={15} /> Print Ticket / QR
                      </Button>
                      {isWalkIn && (
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => openClaimModal(visit)}
                        >
                          <Link2 size={15} /> Link to My Account
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {refreshedAt && (
            <p className="mp-field-hint" style={{ marginTop: 20 }}>
              Last refreshed {refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Updates refresh every 10 seconds.
            </p>
          )}
        </>
      )}

      {/* Ticket / QR Modal with Real Scannable QR */}
      {activeTicket && (
        <Dialog
          open={Boolean(activeTicket)}
          onClose={() => setActiveTicket(null)}
          title={`OPD Token Ticket #${activeTicket.displayToken || activeTicket.tokenNumber}`}
        >
          <div className="mp-stack" style={{ textAlign: "center", padding: "16px 0" }}>
            <p className="mp-eyebrow" style={{ margin: 0 }}>{hospital?.name || "MediPulse Hospital Network"}</p>
            <div style={{ fontSize: "2.8rem", fontWeight: 900, color: "var(--mp-primary)", margin: "8px 0" }}>
              {activeTicket.displayToken || `T${activeTicket.tokenNumber}`}
            </div>
            <p style={{ margin: 0, fontWeight: 700 }}>
              {activeTicket.patientInfo?.name || "Patient Walk-in"}
            </p>
            <p className="mp-field-hint">
              Date: {activeTicket.serviceDate || new Date().toLocaleDateString()} · In-Person OPD
            </p>

            <div style={{ margin: "16px auto", padding: 16, background: "#ffffff", borderRadius: 12, border: "1px dashed var(--mp-border)", width: "fit-content" }}>
              <QrCodeSvg value={`MP-TKT:${activeTicket.qrPayload || activeTicket.displayToken || activeTicket.tokenNumber || activeTicket._id}`} size={160} style={{ color: "#0f172a" }} />
              <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "#64748b", fontFamily: "monospace" }}>
                {activeTicket.ticketNumber ? `TICKET ${activeTicket.ticketNumber}` : (activeTicket.displayToken || `TOKEN #${activeTicket.tokenNumber}`)}
              </p>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--mp-muted)", maxWidth: 360, margin: "0 auto 16px" }}>
              Present this token or QR code at hospital check-in, triage stations, and pharmacy pickup.
            </p>

            <div className="mp-actions" style={{ justifyContent: "center" }}>
              <Button onClick={() => window.print()}>
                <Printer size={16} /> Print Ticket
              </Button>
              <Button variant="secondary" onClick={() => setActiveTicket(null)}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Visit Care Packet Modal */}
      {(activePacket || packetLoading || packetError) && (
        <Dialog
          open={Boolean(activePacket || packetLoading || packetError)}
          onClose={() => { setActivePacket(null); setPacketError(""); }}
          title={`Visit Care Packet · ${activePacket?.displayToken || "Hospital Consultation"}`}
        >
          <div className="mp-stack" style={{ padding: "12px 0", maxHeight: "75vh", overflowY: "auto" }}>
            {packetLoading && <LoadingState>Loading released visit packet and documents...</LoadingState>}
            {packetError && <Banner tone="error">{packetError}</Banner>}

            {activePacket && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--mp-border)", paddingBottom: 12 }}>
                  <div>
                    <p className="mp-eyebrow" style={{ margin: 0 }}>{activePacket.hospital?.name || "Hospital Network"}</p>
                    <h3 style={{ margin: "4px 0" }}>Token {activePacket.displayToken} · {activePacket.department?.name || "General OPD"}</h3>
                    <p className="mp-field-hint" style={{ margin: 0 }}>Date: {activePacket.serviceDate} · In-Person OPD</p>
                  </div>
                  <StatusBadge status={activePacket.status} />
                </div>

                <div style={{ background: "var(--mp-surface-subtle)", padding: 12, borderRadius: 8, fontSize: "0.88rem" }}>
                  <div><strong>Destination:</strong> {activePacket.destination}</div>
                  <div><strong>Medical Records File:</strong> {activePacket.physicalFile}</div>
                  {activePacket.doctor?.name && <div><strong>Attending Doctor:</strong> Dr. {activePacket.doctor.name} ({activePacket.doctor.specialization})</div>}
                </div>

                {/* Clinician-Approved SOAP Summary */}
                <section style={{ border: "1px solid var(--mp-border)", borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <h4 style={{ margin: 0 }}>Clinician-Reviewed Summary</h4>
                    {activePacket.soapSummary ? (
                      <span style={{ fontSize: "0.75rem", background: "var(--mp-success-subtle, #dcfce7)", color: "var(--mp-success, #166534)", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                        Clinician Approved
                      </span>
                    ) : (
                      <span style={{ fontSize: "0.75rem", color: "var(--mp-muted)" }}>
                        Pending Clinician Review
                      </span>
                    )}
                  </div>
                  {activePacket.soapSummary ? (
                    <div className="mp-stack" style={{ gap: 8, fontSize: "0.88rem" }}>
                      {activePacket.soapSummary.subjective && <div><strong>Subjective:</strong> {activePacket.soapSummary.subjective}</div>}
                      {activePacket.soapSummary.objective && <div><strong>Objective:</strong> {activePacket.soapSummary.objective}</div>}
                      {activePacket.soapSummary.assessment && <div><strong>Assessment:</strong> {activePacket.soapSummary.assessment}</div>}
                      {activePacket.soapSummary.plan && <div><strong>Plan:</strong> {activePacket.soapSummary.plan}</div>}
                      <p className="mp-field-hint" style={{ fontSize: "0.75rem", marginTop: 4 }}>
                        Reviewed & approved by {activePacket.soapSummary.approvedByName} on {new Date(activePacket.soapSummary.approvedAt).toLocaleString()}
                      </p>
                    </div>
                  ) : (
                    <p className="mp-field-hint" style={{ margin: 0 }}>
                      {activePacket.consultationNotes ? activePacket.consultationNotes : "No released clinician notes or approved summary recorded for this visit yet."}
                    </p>
                  )}
                </section>

                {/* Released Laboratory Reports */}
                <section style={{ border: "1px solid var(--mp-border)", borderRadius: 8, padding: 12 }}>
                  <h4 style={{ margin: "0 0 8px 0" }}>Released Laboratory Reports</h4>
                  {activePacket.labReports && activePacket.labReports.length > 0 ? (
                    <div className="mp-stack" style={{ gap: 12 }}>
                      {activePacket.labReports.map((lab, idx) => (
                        <div key={lab._id || idx} style={{ background: "var(--mp-surface-subtle)", padding: 10, borderRadius: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <strong>{lab.tests?.map(t => t.testName).join(", ") || "Diagnostic Test"}</strong>
                            <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: 4, fontWeight: 600, background: lab.documentStatus === "amended" ? "#fef3c7" : "#dcfce7", color: lab.documentStatus === "amended" ? "#92400e" : "#166534" }}>
                              {lab.documentStatus === "amended" ? `Amended (v${lab.reportVersion})` : "Released"}
                            </span>
                          </div>
                          <table style={{ width: "100%", fontSize: "0.82rem", borderCollapse: "collapse", marginTop: 4 }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid var(--mp-border)", textAlign: "left" }}>
                                <th style={{ padding: "4px 6px" }}>Parameter</th>
                                <th style={{ padding: "4px 6px" }}>Value</th>
                                <th style={{ padding: "4px 6px" }}>Reference</th>
                                <th style={{ padding: "4px 6px" }}>Flag</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(lab.results || []).map((res, rIdx) => (
                                <tr key={rIdx} style={{ borderBottom: "1px solid var(--mp-border-subtle, #f1f5f9)" }}>
                                  <td style={{ padding: "4px 6px" }}>{res.parameterName || res.parameterCode}</td>
                                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{res.value} {res.unit}</td>
                                  <td style={{ padding: "4px 6px", color: "var(--mp-muted)" }}>{res.referenceRangeText || "—"}</td>
                                  <td style={{ padding: "4px 6px" }}>
                                    {res.isCritical ? (
                                      <span style={{ color: "#b91c1c", fontWeight: 700 }}>CRITICAL</span>
                                    ) : res.flag && res.flag !== "NORMAL" ? (
                                      <span style={{ color: "#d97706" }}>{res.flag}</span>
                                    ) : (
                                      <span style={{ color: "#166534" }}>Normal</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {lab.amendmentHistory && lab.amendmentHistory.length > 0 && (
                            <div style={{ marginTop: 8, padding: "6px 8px", background: "#f8fafc", borderRadius: 4, fontSize: "0.76rem" }}>
                              <span style={{ fontWeight: 600, color: "#64748b" }}>Prior Version History: </span>
                              {lab.amendmentHistory.map(hist => `v${hist.version} (released ${new Date(hist.releasedAt).toLocaleDateString()} - ${hist.reason})`).join("; ")}
                            </div>
                          )}
                          <p className="mp-field-hint" style={{ fontSize: "0.74rem", margin: "6px 0 0" }}>
                            Verified by {lab.verifiedByName || "Clinical Pathologist"} · Released {new Date(lab.releasedAt).toLocaleString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mp-field-hint" style={{ margin: 0 }}>No released laboratory reports linked to this visit.</p>
                  )}
                </section>

                {/* Approved Prescriptions */}
                <section style={{ border: "1px solid var(--mp-border)", borderRadius: 8, padding: 12 }}>
                  <h4 style={{ margin: "0 0 8px 0" }}>Prescriptions & Fulfillment</h4>
                  {activePacket.prescriptions && activePacket.prescriptions.length > 0 ? (
                    <div className="mp-stack" style={{ gap: 10 }}>
                      {activePacket.prescriptions.map((rx, idx) => (
                        <div key={rx._id || idx} style={{ background: "var(--mp-surface-subtle)", padding: 10, borderRadius: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontWeight: 600 }}>Prescription #{String(rx._id).substring(0, 8)}</span>
                            <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: 4, fontWeight: 600, background: rx.documentStatus === "dispensed" ? "#dcfce7" : "#e0f2fe", color: rx.documentStatus === "dispensed" ? "#166534" : "#0369a1" }}>
                              {rx.documentStatus === "partially_fulfilled" ? "Partially Dispensed" : rx.documentStatus === "dispensed" ? "Dispensed" : "Approved by Doctor"}
                            </span>
                          </div>
                          <ul style={{ margin: "4px 0", paddingLeft: 18, fontSize: "0.85rem" }}>
                            {(rx.items || []).map((item, iIdx) => (
                              <li key={iIdx} style={{ marginBottom: 4 }}>
                                <strong>{item.medicationName}</strong> — {item.directions} ({item.durationDays} days) · Prescribed: {item.quantityPrescribed}, Dispensed: {item.quantityDispensed || 0}
                              </li>
                            ))}
                          </ul>
                          <p className="mp-field-hint" style={{ fontSize: "0.74rem", margin: "4px 0 0" }}>
                            Prescribed by Dr. {rx.prescribingDoctorName || "Attending Physician"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mp-field-hint" style={{ margin: 0 }}>No approved prescriptions for this visit.</p>
                  )}
                </section>

                <div className="mp-actions" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                  <Button onClick={() => window.print()}>
                    <Printer size={16} /> Print Complete Packet
                  </Button>
                  <Button variant="secondary" onClick={() => setActivePacket(null)}>
                    Close
                  </Button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}

      {/* Walk-in Account Claim Modal */}
      {claimDialogVisit && (
        <Dialog
          open={Boolean(claimDialogVisit)}
          onClose={() => setClaimDialogVisit(null)}
          title={`Claim Walk-in Visit #${claimDialogVisit.displayToken || claimDialogVisit.tokenNumber}`}
        >
          <div className="mp-stack" style={{ padding: "8px 0" }}>
            <p className="mp-field-hint">
              Link this hospital walk-in ticket to your patient account to track consultation progress, view prescriptions, and access test results.
            </p>

            {claimError && <Banner tone="error">{claimError}</Banner>}
            {claimNotice && <Banner tone="positive">{claimNotice}</Banner>}

            <div style={{ background: "var(--mp-surface-subtle)", padding: 12, borderRadius: 8, fontSize: "0.9rem" }}>
              <div><strong>Token:</strong> {claimDialogVisit.displayToken || `T${claimDialogVisit.tokenNumber}`}</div>
              {claimDialogVisit.patientInfo?.name && (
                <div><strong>Patient:</strong> {claimDialogVisit.patientInfo.name}</div>
              )}
              <div><strong>Service Date:</strong> {claimDialogVisit.serviceDate || "Today"}</div>
            </div>

            {user?.familyMembers && user.familyMembers.length > 0 && (
              <div className="mp-form-field">
                <label htmlFor="claim-family-select" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                  Link visit to
                </label>
                <select
                  id="claim-family-select"
                  value={claimFamilyId}
                  onChange={(e) => setClaimFamilyId(e.target.value)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--mp-border)",
                    background: "var(--mp-surface)",
                    color: "var(--mp-text)",
                  }}
                >
                  <option value="">Myself ({user.firstName || "Account Owner"})</option>
                  {user.familyMembers.map((fam) => (
                    <option key={fam._id} value={fam._id}>
                      {fam.name} ({fam.relation || "Family"})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {claimStep === "init" ? (
              <div className="mp-stack" style={{ gap: 12, marginTop: 8 }}>
                <div className="mp-form-field">
                  <label htmlFor="claim-phone-input" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                    Verification Phone Number
                  </label>
                  <input
                    id="claim-phone-input"
                    type="tel"
                    placeholder="10-digit mobile number"
                    value={claimPhone}
                    onChange={(e) => setClaimPhone(e.target.value)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: "1px solid var(--mp-border)",
                      background: "var(--mp-surface)",
                      color: "var(--mp-text)",
                    }}
                  />
                  <span className="mp-field-hint" style={{ fontSize: "0.78rem" }}>
                    Must match the contact number recorded during walk-in check-in.
                  </span>
                </div>

                <div className="mp-actions" style={{ justifyContent: "flex-end", marginTop: 8 }}>
                  <Button variant="secondary" onClick={() => setClaimDialogVisit(null)}>
                    Cancel
                  </Button>
                  <Button onClick={handleRequestOtp} disabled={claimLoading}>
                    {claimLoading ? "Sending OTP..." : "Send Verification Code"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mp-stack" style={{ gap: 12, marginTop: 8 }}>
                <div className="mp-form-field">
                  <label htmlFor="claim-otp-input" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                    Enter 6-Digit Code
                  </label>
                  <input
                    id="claim-otp-input"
                    type="text"
                    maxLength={6}
                    placeholder="e.g. 123456"
                    value={claimOtp}
                    onChange={(e) => setClaimOtp(e.target.value)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: "1px solid var(--mp-border)",
                      background: "var(--mp-surface)",
                      color: "var(--mp-text)",
                      letterSpacing: "4px",
                      fontWeight: 700,
                      fontSize: "1.1rem",
                      textAlign: "center",
                    }}
                  />
                </div>

                <div className="mp-actions" style={{ justifyContent: "space-between", marginTop: 8 }}>
                  <Button variant="ghost" size="small" onClick={() => setClaimStep("init")} disabled={claimLoading}>
                    Change phone / resend
                  </Button>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button variant="secondary" onClick={() => setClaimDialogVisit(null)}>
                      Cancel
                    </Button>
                    <Button onClick={handleVerifyAndLink} disabled={claimLoading || claimOtp.length < 4}>
                      {claimLoading ? "Linking..." : "Verify & Link Account"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Dialog>
      )}

      <div className="mp-actions">
        <Button to="/" variant="ghost">
          <Building2 size={17} /> Hospital home
        </Button>
      </div>
    </main>
  );
}
