/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { Calendar, MapPin, Plus, User, Video } from "lucide-react";
import { BACKEND_URL } from "../utils";
import { useAuth } from "../context/AuthContext";
import { Banner, Button, Card, EmptyState, Field, LoadingState, StatusBadge } from "../components/ui";

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
  <Card key={event._id} aria-label={event.title}>
    <div className="mp-card-heading" style={{ marginBottom: 12 }}>
      <div>
        <h2 style={{ fontSize: "1.2rem", margin: "0 0 4px", fontWeight: 750 }}>{event.title}</h2>
        <p className="mp-field-hint" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <Calendar size={14} /> {formatEventDate(event.time)}
        </p>
      </div>
      <StatusBadge tone={event.kind === "offline" ? "positive" : "info"}>
        {event.kind === "offline" ? "In person" : "Virtual"}
      </StatusBadge>
    </div>

    <p style={{ margin: "12px 0", color: "var(--mp-text)", lineHeight: 1.55 }}>{event.bio}</p>

    {event.location && (
      <p style={{ margin: "8px 0" }}>
        {event.kind === "offline" ? (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--mp-accent-ink)", fontWeight: 650, display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.88rem" }}
          >
            <MapPin size={15} /> {event.location}
          </a>
        ) : (
          <span style={{ color: "var(--mp-muted)", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.88rem" }}>
            <Video size={15} /> {event.location}
          </span>
        )}
      </p>
    )}

    {event.author_name && (
      <p className="mp-field-hint" style={{ margin: "10px 0 0", display: "flex", alignItems: "center", gap: 6 }}>
        <User size={13} /> Hosted by <strong>{event.author_name}</strong>
        {event.community_name && ` · ${event.community_name}`}
      </p>
    )}
  </Card>
);

const Events = () => {
  const { role } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [formTone, setFormTone] = useState("info");
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

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

  const handleCreateEvent = async (e) => {
    e.preventDefault();
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
      setFormTone("info");
      setEventForm({
        title: "",
        bio: "",
        location: "",
        community_name: "",
        kind: "online",
        time: "",
        reminders: "",
      });
      setShowForm(false);
      await loadEvents();
    } catch (err) {
      setFormMessage(err.response?.data?.message || "Unable to create event");
      setFormTone("error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="mp-page" style={{ maxWidth: 960 }}>
      <div className="mp-section-heading">
        <div>
          <p className="mp-eyebrow">Community Activities</p>
          <h1>Upcoming Events</h1>
          <p>Health awareness sessions, doctor webinars, and community meetups.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {role === "doctor" && (
            <Button onClick={() => setShowForm(!showForm)}>
              <Plus size={16} /> {showForm ? "Close Form" : "Host Event"}
            </Button>
          )}
          <Button to="/events/past" variant="secondary">
            Past events
          </Button>
        </div>
      </div>

      {formMessage && <Banner tone={formTone}>{formMessage}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      {role === "doctor" && showForm && (
        <Card as="form" onSubmit={handleCreateEvent} noValidate style={{ marginBottom: 24 }}>
          <div className="mp-card-heading">
            <h2>Create Community Event</h2>
          </div>
          <div className="mp-form-grid">
            <Field
              label="Event Title"
              required
              placeholder="e.g. Heart Health & Hypertension Q&A"
              value={eventForm.title}
              onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
            />
            <Field
              label="Community Name"
              required
              placeholder="Associated care community name"
              value={eventForm.community_name}
              onChange={(e) => setEventForm({ ...eventForm, community_name: e.target.value })}
            />
            <div className="mp-form-row">
              <Field
                as="select"
                label="Event Format"
                value={eventForm.kind}
                onChange={(e) => setEventForm({ ...eventForm, kind: e.target.value })}
              >
                <option value="online">Virtual / Online Meeting</option>
                <option value="offline">In Person</option>
              </Field>
              <Field
                type="datetime-local"
                label="Date & Time"
                required
                value={eventForm.time}
                onChange={(e) => setEventForm({ ...eventForm, time: e.target.value })}
              />
            </div>
            <Field
              label="Location or Meeting Link"
              placeholder="Physical venue address or secure video URL"
              value={eventForm.location}
              onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
            />
            <Field
              as="textarea"
              label="Event Details & Agenda"
              required
              placeholder="Topics covered, speaker background, and what participants will learn..."
              value={eventForm.bio}
              onChange={(e) => setEventForm({ ...eventForm, bio: e.target.value })}
            />
            <Field
              label="Reminders (comma separated)"
              placeholder="e.g. 24h, 1h"
              value={eventForm.reminders}
              onChange={(e) => setEventForm({ ...eventForm, reminders: e.target.value })}
            />
            <div className="mp-actions" style={{ marginTop: 8 }}>
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "Creating..." : "Publish Event"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {loading ? (
        <LoadingState>Loading upcoming events...</LoadingState>
      ) : !events.length ? (
        <Card>
          <EmptyState
            title="No upcoming events scheduled."
            action={
              role === "doctor" ? (
                <Button onClick={() => setShowForm(true)}>Host the first event</Button>
              ) : (
                <Button to="/events/past" variant="secondary">Browse past events</Button>
              )
            }
          >
            Check back soon for new community wellness workshops and live discussions.
          </EmptyState>
        </Card>
      ) : (
        <div className="mp-stack" style={{ gap: 16 }}>
          {events.map((event) => (
            <EventCard key={event._id} event={event} />
          ))}
        </div>
      )}
    </main>
  );
};

export default Events;
