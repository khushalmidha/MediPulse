import { useState } from "react";
import axios from "axios";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { bookingRequestKey, clearBookingRequest } from "../utils/bookingRequest";
import { useAuth } from "../context/AuthContext";
import { BACKEND_URL } from "../utils";
import { Banner, Button, Card } from "../components/ui";

const VirtualRefunds = () => {
  const [form, setForm] = useState({ transactionId: "", amount: "", reason: "" });
  const [message, setMessage] = useState("");
  const { user, role } = useAuth();
  const requestScope = `refund:${role}:${user?._id || "guest"}`;
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    if (busy || !user?._id) return;
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        transactionId: form.transactionId,
        reason: form.reason,
      };
      if (form.amount) {
        payload.amount = Number(form.amount);
      }
      const requestId = await bookingRequestKey(requestScope, payload);
      const res = await axios.post(
        `${BACKEND_URL}/vpay/refund`,
        { ...payload, requestId },
        { withCredentials: true, headers: { "Idempotency-Key": requestId } },
      );
      clearBookingRequest(requestScope);
      setMessage(res.data.message || "Demo refund completed");
      setForm({ transactionId: "", amount: "", reason: "" });
    } catch (error) {
      if ([400, 402, 403, 404, 422].includes(error.response?.status)) clearBookingRequest(requestScope);
      setMessage(error.response?.data?.message || "Could not confirm the demo refund. Retry the same details.");
    } finally {
      setBusy(false);
    }
  };

  const isSuccess = message === "Demo refund completed" || (!message.includes("Could not confirm") && !message.includes("failed") && message.length > 0);

  return (
    <main className="mp-page" style={{ maxWidth: 720 }}>
      <div className="mp-section-heading">
        <div>
          <p className="mp-eyebrow">Virtual Payments</p>
          <h1>Request Refund</h1>
          <p>Demo INR credits only. Leave amount empty to refund the remaining balance. Cancel booked visits from their appointment page.</p>
        </div>
        <Button to="/wallet/transactions" variant="secondary">
          <ArrowLeft size={16} /> Transaction history
        </Button>
      </div>

      {message && (
        <Banner tone={isSuccess ? "positive" : "error"}>
          {message}
        </Banner>
      )}

      <Card>
        <form onSubmit={onSubmit} className="mp-form" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="mp-field">
            <label htmlFor="tx-id">Original transactionId *</label>
            <input
              id="tx-id"
              name="transactionId"
              aria-label="Original transactionId"
              placeholder="e.g. TXN_01HX72..."
              value={form.transactionId}
              onChange={(event) => setForm((prev) => ({ ...prev, transactionId: event.target.value }))}
              className="mp-input"
              required
            />
            <p className="mp-field-hint">The transaction ID from your simulated billing statement or booking receipt.</p>
          </div>

          <div className="mp-field">
            <label htmlFor="partial-amount">Partial refund amount</label>
            <input
              id="partial-amount"
              name="amount"
              aria-label="Partial refund amount"
              placeholder="Leave empty for full remaining balance"
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
              className="mp-input"
            />
            <p className="mp-field-hint">Specify an amount in demo INR, or leave blank to return the full original amount.</p>
          </div>

          <div className="mp-field">
            <label htmlFor="refund-reason">Refund reason</label>
            <textarea
              id="refund-reason"
              name="reason"
              aria-label="Refund reason"
              placeholder="Describe the reason for reversal..."
              rows={3}
              value={form.reason}
              onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
              className="mp-input"
            />
          </div>

          <div className="mp-actions" style={{ marginTop: 8 }}>
            <Button
              type="submit"
              disabled={busy || !user?._id}
              style={{ minWidth: 160 }}
            >
              <RotateCcw size={16} /> {busy ? "Processing..." : "Issue Refund"}
            </Button>
            <Button to="/wallet/transactions" variant="secondary">
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
};

export default VirtualRefunds;
