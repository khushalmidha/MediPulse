/* eslint-disable react/prop-types */
import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Monitor, RefreshCw, ShieldCheck, Clock, Users, ArrowLeft } from "lucide-react";
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

  const fetchKiosk = useCallback(async () => {
    try {
      let hospitalRecord = hospital;
      if (!hospitalRecord) {
        const hRes = await axios.get(`${BACKEND_URL}/api/hospitals/${encodeURIComponent(slug)}`);
        hospitalRecord = hRes.data.hospital;
        setHospital(hospitalRecord);
      }

      if (hospitalRecord?._id) {
        const kRes = await axios.get(`${BACKEND_URL}/api/hospitals/${hospitalRecord._id}/kiosk-display`);
        setKioskData(kRes.data.kiosk);
      }
      setError("");
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update live queue display.");
    } finally {
      setLoading(false);
    }
  }, [slug, hospital]);

  useEffect(() => {
    fetchKiosk();
    const interval = setInterval(fetchKiosk, 6000);
    return () => clearInterval(interval);
  }, [fetchKiosk]);

  return (
    <main
      className="mp-page"
      style={{
        maxWidth: 1400,
        minHeight: "100vh",
        padding: "24px 32px",
        background: "var(--mp-bg)",
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

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ textAlign: "right", fontSize: "0.85rem", color: "var(--mp-muted)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Clock size={13} /> {lastUpdated.toLocaleTimeString()}
            </div>
            <span>Auto-refreshes every 6s</span>
          </div>

          <Button variant="secondary" onClick={fetchKiosk}>
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
      ) : !(kioskData?.departments || []).length ? (
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
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 24,
          }}
        >
          {kioskData.departments.map((dept) => (
            <Card
              key={dept.departmentId}
              style={{
                display: "flex",
                flexDirection: "column",
                border: "2px solid var(--mp-border)",
                borderRadius: "var(--mp-radius-lg, 14px)",
                padding: 24,
                boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
              }}
            >
              {/* Dept Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                  paddingBottom: 12,
                  borderBottom: "1px solid var(--mp-border)",
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 800 }}>
                    {dept.departmentName}
                  </h2>
                  <span className="mp-field-hint" style={{ fontWeight: 650 }}>
                    {dept.departmentCode}
                  </span>
                </div>
                <StatusBadge tone={dept.nowServing ? "positive" : "neutral"}>
                  {dept.nowServing ? "Consulting" : "Waiting"}
                </StatusBadge>
              </div>

              {/* Now Serving Big Display */}
              <div
                style={{
                  background: dept.nowServing
                    ? "var(--mp-accent-soft)"
                    : "var(--mp-surface-subtle)",
                  borderRadius: 12,
                  padding: "20px 16px",
                  textAlign: "center",
                  marginBottom: 20,
                  border: dept.nowServing ? "2px solid var(--mp-primary)" : "1px solid var(--mp-border)",
                }}
              >
                <p
                  className="mp-eyebrow"
                  style={{
                    color: dept.nowServing ? "var(--mp-primary)" : "var(--mp-muted)",
                    fontSize: "0.85rem",
                    fontWeight: 750,
                    margin: 0,
                  }}
                >
                  NOW SERVING
                </p>
                <div
                  style={{
                    fontSize: "3.4rem",
                    fontWeight: 900,
                    fontFamily: "var(--mp-font-mono, monospace)",
                    color: dept.nowServing ? "var(--mp-primary)" : "var(--mp-muted)",
                    letterSpacing: 2,
                    margin: "4px 0",
                  }}
                >
                  {dept.nowServing || "—"}
                </div>
                <p
                  className="mp-field-hint"
                  style={{ margin: 0, fontSize: "0.82rem" }}
                >
                  {dept.nowServing ? "Please proceed to consultation room" : "Next patient will be announced shortly"}
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
                  <span>{dept.totalWaiting} waiting</span>
                </p>

                {!(dept.nextInLine || []).length ? (
                  <p className="mp-field-hint" style={{ fontStyle: "italic", margin: "6px 0" }}>
                    No upcoming tokens in queue
                  </p>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {dept.nextInLine.map((tokenNum, idx) => (
                      <span
                        key={tokenNum}
                        style={{
                          background: "var(--mp-surface)",
                          border: "1px solid var(--mp-border)",
                          padding: "6px 14px",
                          borderRadius: 8,
                          fontFamily: "var(--mp-font-mono, monospace)",
                          fontWeight: 750,
                          fontSize: "1.05rem",
                          color: idx === 0 ? "var(--mp-text)" : "var(--mp-muted)",
                        }}
                      >
                        {tokenNum}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
