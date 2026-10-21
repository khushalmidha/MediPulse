/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowRight, Building2, CalendarDays, RefreshCcw, Printer, Link2, MapPin, FileText, QrCode } from "lucide-react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { useHospitalBrand } from "../../components/ProductShell";
import { useCareResource } from "../../hooks/useCareResource";
import { careLabels, feeText, visitTime } from "../../utils/appointments";
import { Banner, Button, Card, Dialog, EmptyState, LoadingState, StatusBadge } from "../../components/ui";
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
  const [linkingVisitId, setLinkingVisitId] = useState(null);
  const [linkFeedback, setLinkFeedback] = useState("");

  useEffect(() => {
    if (!isAuth || role !== "user" || !ownerId) return undefined;
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

  const visible = loadedOwner === ownerId ? (tokenId ? visits.filter((visit) => visit._id === tokenId) : visits) : [];

  const handleLinkWalkIn = async (visitId) => {
    setLinkingVisitId(visitId);
    setLinkFeedback("");
    try {
      await axios.post(`${BACKEND_URL}/api/encounters/${visitId}/link-account`, {}, { withCredentials: true });
      setLinkFeedback("Walk-in visit linked successfully to your account!");
      refreshAll();
    } catch (err) {
      setLinkFeedback(err.response?.data?.message || "Could not link walk-in visit to account.");
    } finally {
      setLinkingVisitId(null);
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
                          {visit.status === "reserved"
                            ? "Reception Desk · Check-in"
                            : visit.status === "vitals_done" || visit.status === "waiting"
                            ? "Consultation Room"
                            : visit.status === "in_consultation"
                            ? "Doctor Consultation"
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
                                : "Physical file active")
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
                        onClick={() => setActiveTicket(visit)}
                      >
                        <Printer size={15} /> Print Ticket / QR
                      </Button>
                      {isWalkIn && (
                        <Button
                          variant="secondary"
                          size="small"
                          disabled={linkingVisitId === visit._id}
                          onClick={() => handleLinkWalkIn(visit._id)}
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

      {/* Ticket / QR Modal */}
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

            <div style={{ margin: "16px auto", padding: 16, background: "var(--mp-surface-subtle)", borderRadius: 12, border: "1px dashed var(--mp-border)", maxWidth: 280 }}>
              <QrCode size={96} style={{ margin: "0 auto", color: "var(--mp-text)" }} />
              <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "var(--mp-muted)", fontFamily: "monospace" }}>
                MEDIPULSE-QR-{activeTicket._id?.substring(0, 8)}
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

      <div className="mp-actions">
        <Button to="/" variant="ghost">
          <Building2 size={17} /> Hospital home
        </Button>
      </div>
    </main>
  );
}
