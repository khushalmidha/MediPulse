import { useEffect, useState } from "react";
import axios from "axios";
import { Calendar, MapPin, User, Video, ArrowLeft } from "lucide-react";
import { BACKEND_URL } from "../utils";
import { Banner, Button, Card, EmptyState, LoadingState, StatusBadge } from "../components/ui";

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
    <main className="mp-page" style={{ maxWidth: 960 }}>
      <div className="mp-section-heading">
        <div>
          <p className="mp-eyebrow">Event Archive</p>
          <h1>Past Events</h1>
          <p>A historical record of completed community workshops and awareness programs.</p>
        </div>
        <Button to="/events" variant="secondary">
          <ArrowLeft size={16} /> Upcoming events
        </Button>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {loading ? (
        <LoadingState>Loading past events archive...</LoadingState>
      ) : !events.length ? (
        <Card>
          <EmptyState
            title="No past events found."
            action={<Button to="/events">View upcoming events</Button>}
          >
            Past events will be cataloged here once sessions conclude.
          </EmptyState>
        </Card>
      ) : (
        <div className="mp-stack" style={{ gap: 16 }}>
          {events.map((event) => (
            <Card key={event._id} aria-label={event.title}>
              <div className="mp-card-heading" style={{ marginBottom: 12 }}>
                <div>
                  <h2 style={{ fontSize: "1.15rem", margin: "0 0 4px", fontWeight: 750 }}>{event.title}</h2>
                  <p className="mp-field-hint" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    <Calendar size={14} /> {formatEventDate(event.time)}
                  </p>
                </div>
                <StatusBadge tone="neutral">Completed</StatusBadge>
              </div>

              <p style={{ margin: "10px 0", color: "var(--mp-text)", lineHeight: 1.55 }}>{event.bio}</p>

              {event.location && (
                <p style={{ margin: "6px 0", fontSize: "0.88rem", color: "var(--mp-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                  {event.kind === "offline" ? <MapPin size={14} /> : <Video size={14} />} {event.location}
                </p>
              )}

              {event.author_name && (
                <p className="mp-field-hint" style={{ margin: "8px 0 0", display: "flex", alignItems: "center", gap: 6 }}>
                  <User size={13} /> Hosted by <strong>{event.author_name}</strong>
                  {event.community_name && ` · ${event.community_name}`}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </main>
  );
};

export default PastEvents;
