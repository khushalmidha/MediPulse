import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Bell, CheckCheck, RefreshCw, ArrowLeft } from "lucide-react";
import { BACKEND_URL } from "../utils";
import { Banner, Button, Card, EmptyState, LoadingState, StatusBadge } from "../components/ui";

const VirtualNotifications = () => {
  const [payload, setPayload] = useState({ items: [], total: 0 });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await axios.get(`${BACKEND_URL}/vpay/notifications`, {
        withCredentials: true,
        params: { unreadOnly, limit: 20, page: 1 },
      });
      setPayload(res.data);
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to load notifications");
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markRead = async (id) => {
    try {
      await axios.patch(`${BACKEND_URL}/vpay/notifications/${id}/read`, {}, { withCredentials: true });
      await fetchNotifications();
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to mark notification read");
    }
  };

  return (
    <main className="mp-page" style={{ maxWidth: 840 }}>
      <div className="mp-section-heading">
        <div>
          <p className="mp-eyebrow">Virtual Wallet</p>
          <h1>Payment Notifications</h1>
          <p>Realtime updates for simulated deposits, appointment debits, and balance adjustments.</p>
        </div>
        <div className="mp-actions">
          <Button variant="secondary" onClick={fetchNotifications} disabled={loading}>
            <RefreshCw size={15} className={loading ? "mp-spin" : ""} /> Refresh
          </Button>
          <Button to="/wallet/transactions" variant="secondary">
            <ArrowLeft size={15} /> Transactions
          </Button>
        </div>
      </div>

      {message && <Banner tone="error">{message}</Banner>}

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.9rem", color: "var(--mp-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            <Bell size={16} /> Filter alerts
          </span>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.9rem", fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
              className="mp-checkbox"
            />
            Unread only
          </label>
        </div>
      </Card>

      {loading && !payload.items.length ? (
        <LoadingState>Loading payment alerts...</LoadingState>
      ) : !payload.items.length ? (
        <Card>
          <EmptyState
            title="No notifications found."
            action={<Button to="/wallet/transactions" variant="secondary">View transaction history</Button>}
          >
            {unreadOnly ? "You have read all payment notifications." : "No wallet activities recorded yet."}
          </EmptyState>
        </Card>
      ) : (
        <div className="mp-stack" style={{ gap: 12 }}>
          {payload.items.map((item) => (
            <Card
              key={item._id}
              style={{
                borderLeft: item.isRead ? "3px solid transparent" : "3px solid var(--mp-primary)",
                background: item.isRead ? "var(--mp-surface)" : "var(--mp-accent-soft)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{item.title}</h3>
                    <StatusBadge tone={item.isRead ? "neutral" : "info"}>
                      {item.isRead ? "Read" : "Unread"}
                    </StatusBadge>
                  </div>
                  <p style={{ margin: "4px 0 8px", color: "var(--mp-text)", fontSize: "0.92rem", lineHeight: 1.5 }}>
                    {item.message}
                  </p>
                  <p className="mp-field-hint" style={{ margin: 0 }}>
                    {item.type} · {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>

                {!item.isRead && (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => markRead(item._id)}
                    title="Mark as read"
                  >
                    <CheckCheck size={14} /> Mark read
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
};

export default VirtualNotifications;
