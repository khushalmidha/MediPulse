import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { BACKEND_URL } from "../utils";

const formatEventDate = (value) => {
  if (!value) return "Date not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const PastEvents = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    axios
      .get(`${BACKEND_URL}/event`, {
        params: { status: "past" },
        withCredentials: true,
      })
      .then((response) => setEvents(response.data.events || []))
      .catch((err) => setError(err.response?.data?.message || "Unable to load past events"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Past Events</h1>
            <p className="mt-2 text-gray-600">A record of completed community and NGO activities.</p>
          </div>
          <Link to="/events" className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700">
            Upcoming events
          </Link>
        </div>

        {loading ? (
          <p className="text-gray-600">Loading events...</p>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : events.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-600">
            No past events found.
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event._id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">{event.title}</h2>
                  <span className="text-sm text-gray-500">{formatEventDate(event.time)}</span>
                </div>
                <p className="mt-2 text-sm text-gray-700">{event.bio}</p>
                {event.location && <p className="mt-2 text-sm text-gray-500">{event.location}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PastEvents;
