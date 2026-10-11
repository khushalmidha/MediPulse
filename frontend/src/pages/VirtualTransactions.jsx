import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Download, Search, RefreshCw, Filter } from "lucide-react";
import { BACKEND_URL } from "../utils";
import { Banner, Button, Card, EmptyState, LoadingState, StatusBadge } from "../components/ui";

const typeTone = {
  PAYMENT: "info",
  TOPUP: "positive",
  REFUND: "warning",
};

const statusTone = {
  SUCCESS: "positive",
  FAILED: "danger",
  REFUNDED: "warning",
  PENDING: "info",
};

const VirtualTransactions = () => {
  const [filters, setFilters] = useState({ page: 1, limit: 10, type: "", status: "", search: "" });
  const [payload, setPayload] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await axios.get(`${BACKEND_URL}/vpay/transactions`, {
        withCredentials: true,
        params: filters,
      });
      setPayload(res.data);
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not load transactions");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onExport = async () => {
    setExporting(true);
    try {
      const res = await axios.get(`${BACKEND_URL}/vpay/transactions/export`, {
        withCredentials: true,
        params: filters,
        responseType: "blob",
      });
      const link = document.createElement("a");
      const url = URL.createObjectURL(res.data);
      link.href = url;
      link.download = "virtual-transactions.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error.response?.data?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="mp-page" style={{ maxWidth: 1120 }}>
      <div className="mp-section-heading">
        <div>
          <p className="mp-eyebrow">Virtual Wallet & Ledger</p>
          <h1>Transaction History</h1>
          <p>Audited ledger for simulated demo credits. No actual monetary exchange takes place.</p>
        </div>
        <div className="mp-actions">
          <Button variant="secondary" onClick={fetchData} disabled={loading}>
            <RefreshCw size={15} className={loading ? "mp-spin" : ""} /> Refresh
          </Button>
          <Button variant="secondary" onClick={onExport} disabled={exporting}>
            <Download size={15} /> {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </div>

      {message && <Banner tone="error">{message}</Banner>}

      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "end" }}>
          <div>
            <label htmlFor="search-tx" style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>
              Search
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="search-tx"
                value={filters.search}
                onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value, page: 1 }))}
                placeholder="Search transaction or ref ID..."
                className="mp-input"
                style={{ paddingLeft: 32 }}
              />
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--mp-muted)" }} />
            </div>
          </div>

          <div>
            <label htmlFor="filter-type" style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>
              Transaction Type
            </label>
            <select
              id="filter-type"
              value={filters.type}
              onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value, page: 1 }))}
              className="mp-input"
            >
              <option value="">All Types</option>
              <option value="PAYMENT">PAYMENT</option>
              <option value="TOPUP">TOPUP</option>
              <option value="REFUND">REFUND</option>
            </select>
          </div>

          <div>
            <label htmlFor="filter-status" style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>
              Status
            </label>
            <select
              id="filter-status"
              value={filters.status}
              onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value, page: 1 }))}
              className="mp-input"
            >
              <option value="">All Status</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
              <option value="REFUNDED">REFUNDED</option>
              <option value="PENDING">PENDING</option>
            </select>
          </div>

          <div>
            <Button onClick={fetchData} style={{ width: "100%" }}>
              <Filter size={15} /> Apply
            </Button>
          </div>
        </div>
      </Card>

      {loading && !payload.items.length ? (
        <LoadingState>Loading transaction records...</LoadingState>
      ) : !payload.items.length ? (
        <Card>
          <EmptyState
            title="No transactions found."
            action={<Button to="/wallet/refunds" variant="secondary">Request refund</Button>}
          >
            Transactions will appear here once bookings or top-ups are executed.
          </EmptyState>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="mp-table-scroll" role="region" aria-label="Transactions table" tabIndex={0}>
            <table className="mp-table">
              <thead>
                <tr>
                  <th scope="col">Transaction ID</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Recorded At</th>
                </tr>
              </thead>
              <tbody>
                {payload.items.map((item) => (
                  <tr key={item._id}>
                    <td>
                      <code style={{ fontSize: "0.82rem", background: "var(--mp-accent-soft)", padding: "2px 6px", borderRadius: 4 }}>
                        {item.transactionId}
                      </code>
                    </td>
                    <td>
                      <StatusBadge tone={typeTone[item.type] || "neutral"}>
                        {item.type}
                      </StatusBadge>
                    </td>
                    <td>
                      <StatusBadge tone={statusTone[item.status] || "neutral"}>
                        {item.status}
                      </StatusBadge>
                    </td>
                    <td style={{ fontWeight: 700, fontFamily: "var(--mp-font-mono, monospace)" }}>
                      INR {Number(item.amount || 0).toFixed(2)}
                    </td>
                    <td style={{ color: "var(--mp-muted)", fontSize: "0.85rem" }}>
                      {item.referenceId || "—"}
                    </td>
                    <td style={{ color: "var(--mp-muted)", fontSize: "0.85rem" }}>
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderTop: "1px solid var(--mp-border)" }}>
            <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--mp-muted)" }}>
              Page <strong>{filters.page}</strong> of <strong>{payload.totalPages || 1}</strong> ({payload.total || 0} total)
            </p>
            <div className="mp-actions">
              <Button
                variant="secondary"
                disabled={filters.page <= 1}
                onClick={() => setFilters((p) => ({ ...p, page: p.page - 1 }))}
              >
                Prev
              </Button>
              <Button
                variant="secondary"
                disabled={filters.page >= (payload.totalPages || 1)}
                onClick={() => setFilters((p) => ({ ...p, page: p.page + 1 }))}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <Button to="/wallet/refunds" variant="secondary">
          Request Refund
        </Button>
        <Button to="/wallet/notifications" variant="secondary">
          Payment Notifications
        </Button>
      </div>
    </main>
  );
};

export default VirtualTransactions;
