/* eslint-disable react/prop-types */
import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Monitor, RefreshCw, ShieldCheck, Clock, Users, ArrowLeft, AlertCircle } from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { Banner, Button, Card, LoadingState, StatusBadge } from "../../components/ui";

export default function HospitalKiosk({ slug: propSlug } = {}) {
  const params = useParams();
  const slug = propSlug || params?.slug;
  const [hospital, setHospital] = useState(null);
  const [kioskData, setKioskData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const abortRef = useRef(null);

  const fetchKiosk = useCallback(async (signal) => {
    try {
      let hospitalRecord = hospital;
      if (!hospitalRecord) {
        const hRes = await axios.get(`${BACKEND_URL}/api/hospitals/${encodeURIComponent(slug)}`, { signal });
        hospitalRecord = hRes.data.hospital;
        setHospital(hospitalRecord);
      }

      if (hospitalRecord?._id) {
        const kRes = await axios.get(`${BACKEND_URL}/api/hospitals/${hospitalRecord._id}/kiosk-display`, { signal });
        setKioskData(kRes.data.kiosk);
      }
      setError("");
      setLastUpdated(new Date());
    } catch (err) {
      if (axios.isCancel(err) || err?.name === "CanceledError") return;
      setError(err.response?.data?.message || "Failed to update live queue display.");
    } finally {
      setLoading(false);
    }
  }, [slug, hospital]);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    fetchKiosk(controller.signal);

    const interval = setInterval(() => {
      const pollController = new AbortController();
      abortRef.current = pollController;
      fetchKiosk(pollController.signal);
    }, 6000);

    return () => {
      clearInterval(interval);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchKiosk]);

  const displayItems = (kioskData?.queues && kioskData.queues.length > 0)
    ? kioskData.queues
    : (kioskData?.departments || []);

  return (
    <main
      className="mp-page"
      style={{
        maxWidth: 1400,
        minHeight: "100vh",
        padding: "24px 32px",
        background: "var(--mp-bg)",
        overflowX: "hidden",
      }}
    >
      {/* Kiosk Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: "2px solid var(--mp-border)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Monitor size={28} style={{ color: "var(--mp-primary)" }} />
            <h1 style={{ margin: 0, fontSize: "2rem", fontWeight: 850 }}>
              {hospital?.name || "Hospital"} · Live OPD Queue Board
            </h1>
          </div>
          <p className="mp-field-hint" style={{ margin: "4px 0 0", display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={14} style={{ color: "var(--mp-success)" }} />
            Privacy-Protected Public Board · Patient names and medical records are not displayed
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ textAlign: "right", fontSize: "0.85rem", color: "var(--mp-muted)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Clock size={13} /> {lastUpdated.toLocaleTimeString()}
            </div>
            <span>Auto-refreshes every 6s</span>
          </div>

          <Button variant="secondary" onClick={() => fetchKiosk()}>
            <RefreshCw size={15} /> Refresh
          </Button>

          <Button to={`/hospitals/${slug}`} variant="ghost">
            <ArrowLeft size={16} /> Hospital portal
          </Button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {loading && !kioskData ? (
        <LoadingState>Loading live queue display...</LoadingState>
      ) : !displayItems.length ? (
        <Card style={{ textAlign: "center", padding: "64px 24px" }}>
          <Users size={48} style={{ color: "var(--mp-muted)", margin: "0 auto 16px" }} />
          <h2 style={{ fontSize: "1.4rem", fontWeight: 750 }}>No OPD Sessions Active</h2>
          <p className="mp-field-hint">
            There are currently no active patient queues in consultation at this hospital.
          </p>
          <div style={{ marginTop: 16 }}>
            <Button to={`/hospitals/${slug}`}>Book an OPD Token</Button>
          </div>
        </Card>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
            gap: 24,
          }}
        >
          {displayItems.map((item) => {
            const isPaused = Boolean(item.isPaused);
            const nowServing = item.nowServing;
            const itemKey = item.queueKey || `${item.doctorId || item.departmentId}:${item.sessionId || "day"}`;
            const doctorName = item.doctorName;
            const subtitle = doctorName
              ? `${item.departmentName || "General OPD"}${item.specialization ? ` · ${item.specialization}` : ""}`
              : (item.departmentCode || "OPD");

            return (
              <Card
                key={itemKey}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  border: isPaused
                    ? "2px solid var(--mp-warning, #f59e0b)"
                    : "2px solid var(--mp-border)",
                  borderRadius: "var(--mp-radius-lg, 14px)",
                  padding: 24,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
                  background: isPaused ? "var(--mp-surface-subtle)" : "var(--mp-surface)",
                }}
              >
                {/* Header: Title, Specialization & Status Badge */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                    marginBottom: 16,
                    paddingBottom: 12,
                    borderBottom: "1px solid var(--mp-border)",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h2
                      style={{
                        margin: 0,
                        fontSize: "1.25rem",
                        fontWeight: 800,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={doctorName || item.departmentName}
                    >
                      {doctorName || item.departmentName}
                    </h2>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                      <span className="mp-field-hint" style={{ fontWeight: 650 }}>
                        {subtitle}
                      </span>
                      {item.sessionId && item.sessionId !== "day" && (
                        <span
                          style={{
                            fontSize: "0.72rem",
                            padding: "2px 6px",
                            borderRadius: 4,
                            background: "var(--mp-surface-subtle)",
                            border: "1px solid var(--mp-border)",
                            fontWeight: 650,
                            textTransform: "capitalize",
                          }}
                        >
                          {item.sessionId.replace(/^s_/, "")}
                        </span>
                      )}
                    </div>
                  </div>

                  <StatusBadge tone={isPaused ? "warning" : nowServing ? "positive" : "neutral"}>
                    {isPaused ? "Queue Paused" : nowServing ? "Consulting" : "Waiting"}
                  </StatusBadge>
                </div>

                {/* Now Serving Big Display */}
                <div
                  style={{
                    background: isPaused
                      ? "rgba(245, 158, 11, 0.08)"
                      : nowServing
                      ? "var(--mp-accent-soft)"
                      : "var(--mp-surface-subtle)",
                    borderRadius: 12,
                    padding: "20px 16px",
                    textAlign: "center",
                    marginBottom: 20,
                    border: isPaused
                      ? "2px solid var(--mp-warning, #f59e0b)"
                      : nowServing
                      ? "2px solid var(--mp-primary)"
                      : "1px solid var(--mp-border)",
                  }}
                >
                  <p
                    className="mp-eyebrow"
                    style={{
                      color: isPaused
                        ? "var(--mp-warning, #d97706)"
                        : nowServing
                        ? "var(--mp-primary)"
                        : "var(--mp-muted)",
                      fontSize: "0.85rem",
                      fontWeight: 750,
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                    }}
                  >
                    {isPaused && <AlertCircle size={14} />}
                    {isPaused ? "QUEUE PAUSED" : "NOW SERVING"}
                  </p>
                  <div
                    style={{
                      fontSize: "3.4rem",
                      fontWeight: 900,
                      fontFamily: "var(--mp-font-mono, monospace)",
                      color: isPaused
                        ? "var(--mp-warning, #d97706)"
                        : nowServing
                        ? "var(--mp-primary)"
                        : "var(--mp-muted)",
                      letterSpacing: 2,
                      margin: "4px 0",
                    }}
                  >
                    {nowServing || "—"}
                  </div>
                  <p
                    className="mp-field-hint"
                    style={{ margin: 0, fontSize: "0.82rem" }}
                  >
                    {isPaused
                      ? "Consultation temporarily paused · Please standby"
                      : nowServing
                      ? "Please proceed to consultation room"
                      : "Next patient will be announced shortly"}
                  </p>
                </div>

                {/* Next in Line Tokens */}
                <div style={{ marginTop: "auto" }}>
                  <p
                    style={{
                      fontSize: "0.88rem",
                      fontWeight: 700,
                      color: "var(--mp-muted)",
                      marginBottom: 8,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>NEXT IN LINE</span>
                    <span>{item.totalWaiting} waiting</span>
                  </p>

                  {!(item.nextInLine || []).length ? (
                    <p className="mp-field-hint" style={{ fontStyle: "italic", margin: "6px 0" }}>
                      No upcoming tokens in queue
                    </p>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {item.nextInLine.map((tokenEntry, idx) => {
                        const tokenDisplay = typeof tokenEntry === "object" ? tokenEntry.displayToken : tokenEntry;
                        const isPriority = Boolean(tokenEntry?.isPriority || (tokenEntry?.priority || 0) > 0);

                        return (
                          <span
                            key={`${tokenDisplay}-${idx}`}
                            style={{
                              background: isPriority
                                ? "rgba(239, 68, 68, 0.08)"
                                : "var(--mp-surface)",
                              border: isPriority
                                ? "1.5px solid var(--mp-danger, #ef4444)"
                                : "1px solid var(--mp-border)",
                              padding: "6px 12px",
                              borderRadius: 8,
                              fontFamily: "var(--mp-font-mono, monospace)",
                              fontWeight: 750,
                              fontSize: "1.02rem",
                              color: isPriority
                                ? "var(--mp-danger, #dc2626)"
                                : idx === 0
                                ? "var(--mp-text)"
                                : "var(--mp-muted)",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            {isPriority && <span style={{ fontSize: "0.75rem" }}>⚡</span>}
                            {tokenDisplay}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
