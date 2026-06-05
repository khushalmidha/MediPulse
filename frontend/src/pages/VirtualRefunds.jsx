import { useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "../utils";

const VirtualRefunds = () => {
  const [form, setForm] = useState({ transactionId: "", amount: "", reason: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
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
      const requestId = `refund-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const res = await axios.post(
        `${BACKEND_URL}/vpay/refund`,
        { ...payload, requestId },
        { withCredentials: true, headers: { "x-idempotency-key": requestId } },
      );
      setMessage(res.data.message || "Refund processed");
      setForm({ transactionId: "", amount: "", reason: "" });
    } catch (error) {
      setMessage(error.response?.data?.message || "Refund failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl rounded-xl bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Request Refund</h1>
        <p className="mt-1 text-sm text-gray-600">Issue a virtual refund against a successful PAYMENT transaction.</p>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <input
            value={form.transactionId}
            onChange={(event) => setForm((prev) => ({ ...prev, transactionId: event.target.value }))}
            placeholder="Original transactionId"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            required
          />
          <input
            value={form.amount}
            onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
            placeholder="Optional partial refund amount"
            type="number"
            min="0.01"
            step="0.01"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <textarea
            value={form.reason}
            onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
            placeholder="Reason"
            rows={4}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button disabled={busy} className="rounded-md bg-amber-600 px-4 py-2 text-white disabled:bg-gray-400">{busy ? "Processing..." : "Issue Refund"}</button>
        </form>
      </div>
      {message && <p className="mx-auto mt-4 max-w-2xl text-sm text-blue-700">{message}</p>}
    </div>
  );
};

export default VirtualRefunds;
