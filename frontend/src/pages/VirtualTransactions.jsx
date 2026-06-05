import { useEffect, useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "../utils";

const VirtualTransactions = () => {
  const [filters, setFilters] = useState({ page: 1, limit: 10, type: "", status: "", search: "" });
  const [payload, setPayload] = useState({ items: [], total: 0, totalPages: 1 });
  const [message, setMessage] = useState("");

  const fetchData = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/vpay/transactions`, {
        withCredentials: true,
        params: filters,
      });
      setPayload(res.data);
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not load transactions");
    }
  };

  useEffect(() => {
    fetchData();
  }, [filters.page, filters.limit, filters.type, filters.status]);

  const onExport = async () => {
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
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Transaction History</h1>
          <button onClick={onExport} className="rounded-md border border-blue-200 px-3 py-2 text-sm text-blue-700">Export CSV</button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <input value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value, page: 1 }))} placeholder="Search" className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <select value={filters.type} onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value, page: 1 }))} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">All Types</option>
            <option value="PAYMENT">PAYMENT</option>
            <option value="TOPUP">TOPUP</option>
            <option value="REFUND">REFUND</option>
          </select>
          <select value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value, page: 1 }))} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">All Status</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="FAILED">FAILED</option>
            <option value="REFUNDED">REFUNDED</option>
            <option value="PENDING">PENDING</option>
          </select>
          <button onClick={fetchData} className="rounded-md bg-blue-600 px-4 py-2 text-white">Apply</button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2">Transaction</th>
                <th className="py-2">Type</th>
                <th className="py-2">Status</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Reference</th>
                <th className="py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {payload.items.map((item) => (
                <tr key={item._id} className="border-t border-gray-100">
                  <td className="py-2">{item.transactionId}</td>
                  <td className="py-2">{item.type}</td>
                  <td className="py-2">{item.status}</td>
                  <td className="py-2">INR {Number(item.amount || 0).toFixed(2)}</td>
                  <td className="py-2">{item.referenceId || "-"}</td>
                  <td className="py-2">{new Date(item.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">Page {filters.page} / {payload.totalPages || 1}</p>
          <div className="flex gap-2">
            <button disabled={filters.page <= 1} onClick={() => setFilters((p) => ({ ...p, page: p.page - 1 }))} className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-50">Prev</button>
            <button disabled={filters.page >= (payload.totalPages || 1)} onClick={() => setFilters((p) => ({ ...p, page: p.page + 1 }))} className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
      {message && <p className="mx-auto mt-4 max-w-6xl text-sm text-blue-700">{message}</p>}
    </div>
  );
};

export default VirtualTransactions;
