import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { BACKEND_URL } from "../utils";
import { useAuth } from "../context/AuthContext";

const formatEventDate = (value) => {
  if (!value) return "Date not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const EventCard = ({ event }) => (
  <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{event.title}</h2>
        <p className="mt-1 text-sm text-gray-500">{formatEventDate(event.time)}</p>
      </div>
      <span
        className={`rounded-full px-3 py-1 text-xs font-semibold ${
          event.kind === "offline"
            ? "bg-green-100 text-green-800"
            : "bg-blue-100 text-blue-800"
        }`}
      >
        {event.kind === "offline" ? "In person" : "Virtual"}
      </span>
    </div>
    <p className="mt-3 text-sm text-gray-700">{event.bio}</p>
    {event.location && (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex text-sm font-medium text-blue-700 hover:text-blue-800"
      >
        {event.location}
      </a>
    )}
    {event.author_name && (
      <p className="mt-3 text-xs text-gray-500">Hosted by {event.author_name}</p>
    )}
  </div>
);

const Events = () => {
  const { role } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [eventForm, setEventForm] = useState({
    title: "",
    bio: "",
    location: "",
    community_name: "",
    kind: "online",
    time: "",
    reminders: "",
  });

  const loadEvents = () =>
    axios
      .get(`${BACKEND_URL}/event`, {
        params: { status: "upcoming" },
        withCredentials: true,
      })
      .then((response) => setEvents(response.data.events || []));

  useEffect(() => {
    loadEvents()
      .catch((err) => setError(err.response?.data?.message || "Unable to load upcoming events"))
      .finally(() => setLoading(false));
  }, []);

  const handleCreateEvent = async (event) => {
    event.preventDefault();
    setCreating(true);
    setFormMessage("");
    try {
      await axios.post(
        `${BACKEND_URL}/event`,
        {
          ...eventForm,
          reminders: eventForm.reminders
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        },
        { withCredentials: true },
      );
      setFormMessage("Event created successfully");
      setEventForm({
        title: "",
        bio: "",
        location: "",
        community_name: "",
        kind: "online",
        time: "",
        reminders: "",
      });
      await loadEvents();
    } catch (err) {
      setFormMessage(err.response?.data?.message || "Unable to create event");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Upcoming Events</h1>
            <p className="mt-2 text-gray-600">Community activities, awareness sessions, and NGO programs.</p>
          </div>
          <Link to="/events/past" className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700">
            Past events
          </Link>
        </div>

        {role === "doctor" && (
          <form onSubmit={handleCreateEvent} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Create Community Event</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input
                value={eventForm.title}
                onChange={(event) => setEventForm((form) => ({ ...form, title: event.target.value }))}
                placeholder="Event title"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                required
              />
              <input
                value={eventForm.community_name}
                onChange={(event) => setEventForm((form) => ({ ...form, community_name: event.target.value }))}
                placeholder="Community name"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                required
              />
              <select
                value={eventForm.kind}
                onChange={(event) => setEventForm((form) => ({ ...form, kind: event.target.value }))}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="online">Virtual</option>
                <option value="offline">In person</option>
              </select>
              <input
                type="datetime-local"
                value={eventForm.time}
                onChange={(event) => setEventForm((form) => ({ ...form, time: event.target.value }))}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                required
              />
              <input
                value={eventForm.location}
                onChange={(event) => setEventForm((form) => ({ ...form, location: event.target.value }))}
                placeholder="Location or meeting link"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 md:col-span-2"
              />
              <textarea
                value={eventForm.bio}
                onChange={(event) => setEventForm((form) => ({ ...form, bio: event.target.value }))}
                placeholder="Event details"
                className="min-h-24 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 md:col-span-2"
                required
              />
              <input
                value={eventForm.reminders}
                onChange={(event) => setEventForm((form) => ({ ...form, reminders: event.target.value }))}
                placeholder="Reminders separated by commas"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 md:col-span-2"
                required
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={creating}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:bg-gray-400"
              >
                {creating ? "Creating..." : "Create Event"}
              </button>
              {formMessage && <p className="text-sm text-blue-700">{formMessage}</p>}
            </div>
          </form>
        )}

        {loading ? (
          <p className="text-gray-600">Loading events...</p>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : events.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-600">
            No upcoming events are scheduled yet.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {events.map((event) => (
              <EventCard key={event._id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Events;
