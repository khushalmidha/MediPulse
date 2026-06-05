import { useEffect, useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "../utils";

const VirtualAdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [message, setMessage] = useState("");
  const [topup, setTopup] = useState({ targetId: "", targetRole: "user", amount: 100, description: "Demo top-up" });

  const fetchData = async () => {
    try {
      const [statsRes, walletsRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/vpay/admin/stats`, { withCredentials: true }),
        axios.get(`${BACKEND_URL}/vpay/admin/wallets`, { withCredentials: true, params: { limit: 20, page: 1 } }),
      ]);
      setStats(statsRes.data);
      setWallets(walletsRes.data.items || []);
    } catch (error) {
      setMessage(error.response?.data?.message || "Admin data fetch failed. Ensure your user id is in ADMIN_USER_IDS");
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
    setMessage("");
    try {
      const requestId = `topup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const res = await axios.post(
        `${BACKEND_URL}/vpay/wallet/topup`,
        { ...topup, requestId },
        { withCredentials: true, headers: { "x-idempotency-key": requestId } },
      );
      setMessage(res.data.message || "Top-up done");
      await fetchData();
    } catch (error) {
      setMessage(error.response?.data?.message || "Top-up failed");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Virtual Payments Admin</h1>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">Money in circulation</p>
            <p className="text-2xl font-semibold">INR {(stats?.totalVirtualMoneyInCirculation || 0).toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">Total payments</p>
            <p className="text-2xl font-semibold">INR {(stats?.totalPayments || 0).toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">Revenue simulation</p>
            <p className="text-2xl font-semibold">INR {(stats?.revenueSimulation || 0).toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">Total refunds</p>
            <p className="text-2xl font-semibold">INR {(stats?.totalRefunds || 0).toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">Active wallets</p>
            <p className="text-2xl font-semibold">{stats?.activeUsers || 0}</p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">Payment count</p>
            <p className="text-2xl font-semibold">{stats?.totalPaymentCount || 0}</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Most Active Doctors</h2>
            <div className="mt-3 space-y-3">
              {(stats?.mostActiveDoctors || []).map((doctor) => (
                <div key={doctor.doctorId} className="flex items-center justify-between rounded-lg border border-gray-100 p-3 text-sm">
                  <div>
                    <p className="font-medium text-gray-900">{doctor.doctorName || doctor.doctorId}</p>
                    <p className="text-gray-500">{doctor.paymentCount} payments</p>
                  </div>
                  <p className="font-semibold text-gray-900">INR {Number(doctor.totalVolume || 0).toFixed(2)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Daily Transaction Volume</h2>
            <div className="mt-3 space-y-2">
              {(stats?.dailyTransactionVolume || []).map((day) => (
                <div key={day._id} className="grid grid-cols-[1fr_auto_auto] gap-3 text-sm">
                  <span className="text-gray-600">{day._id}</span>
                  <span className="text-gray-500">{day.count} txns</span>
                  <span className="font-medium">INR {Number(day.amount || 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <form onSubmit={onTopup} className="rounded-xl bg-white p-5 shadow-sm grid gap-3 md:grid-cols-5">
          <input value={topup.targetId} onChange={(e) => setTopup((p) => ({ ...p, targetId: e.target.value }))} placeholder="Target user id" className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2" required />
          <select value={topup.targetRole} onChange={(e) => setTopup((p) => ({ ...p, targetRole: e.target.value }))} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="user">User</option>
            <option value="doctor">Doctor</option>
          </select>
          <input type="number" min="1" step="0.01" value={topup.amount} onChange={(e) => setTopup((p) => ({ ...p, amount: e.target.value }))} className="rounded-md border border-gray-300 px-3 py-2 text-sm" required />
          <button className="rounded-md bg-blue-600 px-4 py-2 text-white">Top-up</button>
        </form>

        <div className="rounded-xl bg-white p-5 shadow-sm overflow-x-auto">
          <h2 className="text-lg font-semibold text-gray-900">Wallet Controls</h2>
          <table className="mt-3 min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2">Wallet</th>
                <th className="py-2">Role</th>
                <th className="py-2">Balance</th>
                <th className="py-2">Status</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((wallet) => (
                <tr key={wallet._id} className="border-t border-gray-100">
                  <td className="py-2 font-mono text-xs">{wallet.userId}</td>
                  <td className="py-2">{wallet.userRole}</td>
                  <td className="py-2">INR {Number(wallet.balance || 0).toFixed(2)}</td>
                  <td className="py-2 capitalize">{wallet.status}</td>
                  <td className="py-2">
                    {wallet.status === "active" ? (
                      <button onClick={() => changeWalletStatus(wallet._id, "freeze")} className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-700">Freeze</button>
                    ) : (
                      <button onClick={() => changeWalletStatus(wallet._id, "unfreeze")} className="rounded-md border border-emerald-200 px-3 py-1 text-xs text-emerald-700">Unfreeze</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {message && <p className="mx-auto mt-4 max-w-7xl text-sm text-blue-700">{message}</p>}
    </div>
  );
};

export default VirtualAdminDashboard;
