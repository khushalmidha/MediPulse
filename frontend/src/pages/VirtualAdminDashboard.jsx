import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { PlusCircle, RefreshCw, Lock, Unlock, ArrowLeft } from "lucide-react";
import { bookingRequestKey, clearBookingRequest } from "../utils/bookingRequest";
import { useAuth } from "../context/AuthContext";
import { BACKEND_URL } from "../utils";
import { Banner, Button, Card, StatusBadge } from "../components/ui";

const VirtualAdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [message, setMessage] = useState("");
  const { user, role } = useAuth();
  const requestScope = `topup:${role}:${user?._id || "guest"}`;
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [topup, setTopup] = useState({ targetId: "", targetRole: "user", amount: 100, description: "Demo top-up" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, walletsRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/vpay/admin/stats`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/vpay/admin/wallets`, { withCredentials: true, params: { limit: 20, page: 1 } }),
      ]);
      setStats(statsRes.data);
      setWallets(walletsRes.data.items || []);
    } catch (error) {
      setMessage(error.response?.data?.message || "Admin data fetch failed. Ensure your user id is in ADMIN_USER_IDS");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const changeWalletStatus = async (walletId, action) => {
    setMessage("");
    try {
      await axios.patch(`${BACKEND_URL}/vpay/admin/wallets/${walletId}/${action}`, {}, { withCredentials: true });
      await fetchData();
    } catch (error) {
      setMessage(error.response?.data?.message || "Wallet action failed");
    }
  };

  const onTopup = async (event) => {
    event.preventDefault();
    if (busy || !user?._id) return;
    setBusy(true);
    setMessage("");
    try {
      const payload = { ...topup, amount: String(topup.amount) };
      const requestId = await bookingRequestKey(requestScope, payload);
      const res = await axios.post(
        `${BACKEND_URL}/vpay/wallet/topup`,
        { ...payload, requestId },
        { withCredentials: true, headers: { "Idempotency-Key": requestId } },
      );
      clearBookingRequest(requestScope);
      setMessage(res.data.message || "Demo top-up completed");
      await fetchData();
    } catch (error) {
      if ([400, 402, 403, 404, 422].includes(error.response?.status)) clearBookingRequest(requestScope);
      setMessage(error.response?.data?.message || "Could not confirm the demo top-up. Retry the same details.");
    } finally {
      setBusy(false);
    }
  };

  const isSuccess = message === "Demo top-up completed" || (!message.includes("Could not confirm") && !message.includes("failed") && message.length > 0);

  return (
    <main className="mp-page" style={{ maxWidth: 1200 }}>
      <div className="mp-section-heading">
        <div>
          <p className="mp-eyebrow">Platform Operations</p>
          <h1>Virtual Payments Admin</h1>
          <p>Demo INR credits only. No real money is collected. All wallet transactions are simulated for testing and demonstrations.</p>
        </div>
        <div className="mp-actions">
          <Button variant="secondary" onClick={fetchData} disabled={loading}>
            <RefreshCw size={15} className={loading ? "mp-spin" : ""} /> Refresh
          </Button>
          <Button to="/wallet/transactions" variant="secondary">
            <ArrowLeft size={15} /> All transactions
          </Button>
        </div>
      </div>

      {message && (
        <Banner tone={isSuccess ? "positive" : "error"}>
          {message}
        </Banner>
      )}

      {/* Analytics Overview Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        <Card>
          <p className="mp-field-hint" style={{ margin: "0 0 6px" }}>Demo credits in circulation</p>
          <p style={{ margin: 0, fontSize: "1.45rem", fontWeight: 800, fontFamily: "var(--mp-font-mono, monospace)", color: "var(--mp-primary)" }}>
            INR {(stats?.totalVirtualMoneyInCirculation || 0).toFixed(2)}
          </p>
        </Card>
        <Card>
          <p className="mp-field-hint" style={{ margin: "0 0 6px" }}>Total payments</p>
          <p style={{ margin: 0, fontSize: "1.45rem", fontWeight: 800, fontFamily: "var(--mp-font-mono, monospace)" }}>
            INR {(stats?.totalPayments || 0).toFixed(2)}
          </p>
        </Card>
        <Card>
          <p className="mp-field-hint" style={{ margin: "0 0 6px" }}>Revenue simulation</p>
          <p style={{ margin: 0, fontSize: "1.45rem", fontWeight: 800, fontFamily: "var(--mp-font-mono, monospace)" }}>
            INR {(stats?.revenueSimulation || 0).toFixed(2)}
          </p>
        </Card>
        <Card>
          <p className="mp-field-hint" style={{ margin: "0 0 6px" }}>Total refunds</p>
          <p style={{ margin: 0, fontSize: "1.45rem", fontWeight: 800, fontFamily: "var(--mp-font-mono, monospace)", color: "var(--mp-warning)" }}>
            INR {(stats?.totalRefunds || 0).toFixed(2)}
          </p>
        </Card>
        <Card>
          <p className="mp-field-hint" style={{ margin: "0 0 6px" }}>Active wallets</p>
          <p style={{ margin: 0, fontSize: "1.45rem", fontWeight: 800 }}>
            {stats?.activeUsers || 0}
          </p>
        </Card>
        <Card>
          <p className="mp-field-hint" style={{ margin: "0 0 6px" }}>Payment count</p>
          <p style={{ margin: 0, fontSize: "1.45rem", fontWeight: 800 }}>
            {stats?.totalPaymentCount || 0}
          </p>
        </Card>
      </div>

      {/* Top-up Form */}
      <Card>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 750, margin: "0 0 4px" }}>Issue Demo Credit Top-up</h2>
          <p className="mp-field-hint" style={{ margin: 0 }}>Allocate simulated credits directly to any registered user or doctor wallet.</p>
        </div>

        <form onSubmit={onTopup} className="mp-form">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, alignItems: "end" }}>
            <div className="mp-field">
              <label htmlFor="target-user-id">Target user id *</label>
              <input
                id="target-user-id"
                name="targetId"
                aria-label="Target user id"
                placeholder="Account object ID..."
                value={topup.targetId}
                onChange={(e) => setTopup((p) => ({ ...p, targetId: e.target.value }))}
                className="mp-input"
                required
              />
            </div>

            <div className="mp-field">
              <label htmlFor="target-role">Target wallet role</label>
              <select
                id="target-role"
                name="targetRole"
                aria-label="Target wallet role"
                value={topup.targetRole}
                onChange={(e) => setTopup((p) => ({ ...p, targetRole: e.target.value }))}
                className="mp-input"
              >
                <option value="user">User</option>
                <option value="doctor">Doctor</option>
              </select>
            </div>

            <div className="mp-field">
              <label htmlFor="topup-amount">Demo top-up amount *</label>
              <input
                id="topup-amount"
                name="amount"
                aria-label="Demo top-up amount"
                type="number"
                min="0.01"
                step="0.01"
                value={topup.amount}
                onChange={(e) => setTopup((p) => ({ ...p, amount: e.target.value }))}
                className="mp-input"
                required
              />
            </div>

            <div>
              <Button
                type="submit"
                disabled={busy || !user?._id}
                style={{ width: "100%" }}
              >
                <PlusCircle size={16} /> {busy ? "Processing..." : "Top-up"}
              </Button>
            </div>
          </div>
        </form>
      </Card>

      {/* Grid: Doctors & Volume */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <Card>
          <div className="mp-card-heading" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 750, margin: 0 }}>Most Active Doctors</h2>
            <StatusBadge tone="info">Demo Volume</StatusBadge>
          </div>
          {!(stats?.mostActiveDoctors || []).length ? (
            <p className="mp-field-hint">No doctor payment activity recorded yet.</p>
          ) : (
            <div className="mp-stack" style={{ gap: 10 }}>
              {(stats?.mostActiveDoctors || []).map((doctor) => (
                <div
                  key={doctor.doctorId}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    borderRadius: "var(--mp-radius, 8px)",
                    background: "var(--mp-surface-subtle, rgba(0,0,0,0.02))",
                    border: "1px solid var(--mp-border)",
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: "0.92rem" }}>
                      {doctor.doctorName || doctor.doctorId}
                    </p>
                    <p className="mp-field-hint" style={{ margin: 0 }}>
                      {doctor.paymentCount} payments
                    </p>
                  </div>
                  <p style={{ margin: 0, fontWeight: 800, fontFamily: "var(--mp-font-mono, monospace)" }}>
                    INR {Number(doctor.totalVolume || 0).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="mp-card-heading" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 750, margin: 0 }}>Daily Transaction Volume</h2>
            <StatusBadge tone="neutral">Last 7 Days</StatusBadge>
          </div>
          {!(stats?.dailyTransactionVolume || []).length ? (
            <p className="mp-field-hint">No daily transaction metrics recorded yet.</p>
          ) : (
            <div className="mp-stack" style={{ gap: 8 }}>
              {(stats?.dailyTransactionVolume || []).map((day) => (
                <div
                  key={day._id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 12,
                    fontSize: "0.88rem",
                    padding: "8px 10px",
                    borderBottom: "1px solid var(--mp-border)",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{day._id}</span>
                  <span style={{ color: "var(--mp-muted)" }}>{day.count} txns</span>
                  <span style={{ fontWeight: 750, fontFamily: "var(--mp-font-mono, monospace)" }}>
                    INR {Number(day.amount || 0).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Wallet Controls */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--mp-border)" }}>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 750, margin: "0 0 4px" }}>Wallet Controls</h2>
          <p className="mp-field-hint" style={{ margin: 0 }}>Inspect and manage simulated account balances, freezing suspicious or test accounts.</p>
        </div>

        <div className="mp-table-scroll" role="region" aria-label="Wallet Controls table" tabIndex={0}>
          <table className="mp-table">
            <thead>
              <tr>
                <th scope="col">User / Wallet ID</th>
                <th scope="col">Role</th>
                <th scope="col">Balance</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {!wallets.length ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 24, color: "var(--mp-muted)" }}>
                    No wallets loaded.
                  </td>
                </tr>
              ) : (
                wallets.map((wallet) => (
                  <tr key={wallet._id}>
                    <td>
                      <code style={{ fontSize: "0.82rem", background: "var(--mp-accent-soft)", padding: "2px 6px", borderRadius: 4 }}>
                        {wallet.userId}
                      </code>
                    </td>
                    <td>
                      <StatusBadge tone="neutral">{wallet.userRole}</StatusBadge>
                    </td>
                    <td style={{ fontWeight: 750, fontFamily: "var(--mp-font-mono, monospace)" }}>
                      INR {Number(wallet.balance || 0).toFixed(2)}
                    </td>
                    <td>
                      <StatusBadge tone={wallet.status === "active" ? "positive" : "danger"}>
                        {wallet.status}
                      </StatusBadge>
                    </td>
                    <td>
                      {wallet.status === "active" ? (
                        <Button
                          variant="danger"
                          size="small"
                          onClick={() => changeWalletStatus(wallet._id, "freeze")}
                        >
                          <Lock size={13} /> Freeze
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => changeWalletStatus(wallet._id, "unfreeze")}
                        >
                          <Unlock size={13} /> Unfreeze
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
};

export default VirtualAdminDashboard;
