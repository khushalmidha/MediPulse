import { useEffect, useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "../utils";

const VirtualNotifications = () => {
  const [payload, setPayload] = useState({ items: [], total: 0 });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [message, setMessage] = useState("");

  const fetchNotifications = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/vpay/notifications`, {
        withCredentials: true,
        params: { unreadOnly, limit: 20, page: 1 },
      });
      setPayload(res.data);
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to load notifications");
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, [unreadOnly]);

  const markRead = async (id) => {
    try {
      await axios.patch(`${BACKEND_URL}/vpay/notifications/${id}/read`, {}, { withCredentials: true });
      await fetchNotifications();
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to mark notification read");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Payment Notifications</h1>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Unread only
          </label>
        </div>

        <div className="mt-4 divide-y divide-gray-100">
          {payload.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No notifications found.</p>
          ) : (
            payload.items.map((item) => (
              <div key={item._id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div>
                  <p className="font-medium text-gray-900">{item.title}</p>
                  <p className="mt-1 text-sm text-gray-600">{item.message}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {item.type} · {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
                {!item.isRead && (
                  <button
                    onClick={() => markRead(item._id)}
                    className="rounded-md border border-blue-200 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                  >
                    Mark read
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      {message && <p className="mx-auto mt-4 max-w-4xl text-sm text-blue-700">{message}</p>}
    </div>
  );
};

export default VirtualNotifications;
