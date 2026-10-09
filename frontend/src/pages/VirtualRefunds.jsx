import { bookingRequestKey, clearBookingRequest } from "../utils/bookingRequest";
import { useAuth } from "../context/AuthContext";
import { useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "../utils";

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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 p-6">
      <div className="mx-auto max-w-2xl rounded-xl bg-white dark:bg-slate-950 p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Request Refund</h1>
        <p className="mt-1 text-sm text-gray-600">Demo INR credits only. Leave amount empty to refund the remaining balance. Cancel booked visits from their appointment page.</p>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <input
            value={form.transactionId}
            onChange={(event) => setForm((prev) => ({ ...prev, transactionId: event.target.value }))}
            aria-label="Original transactionId" placeholder="Original transactionId"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            required
          />
          <input
            value={form.amount}
            onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
            aria-label="Partial refund amount" placeholder="Optional partial refund amount"
            type="number"
            min="0.01"
            step="0.01"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <textarea
            value={form.reason}
            onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
            aria-label="Refund reason" placeholder="Reason"
            rows={4}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button disabled={busy || !user?._id} className="rounded-md bg-amber-600 px-4 py-2 text-white disabled:bg-gray-400">{busy ? "Processing..." : "Issue Refund"}</button>
        </form>
      </div>
      {message && <p className="mx-auto mt-4 max-w-2xl text-sm text-blue-700">{message}</p>}
    </div>
  );
};

export default VirtualRefunds;
