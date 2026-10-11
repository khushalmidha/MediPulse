import { useState } from "react";
import { Users, Share2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Banner, Button, Card, Dialog, EmptyState, StatusBadge } from "./ui";

export default function RecommendedCommunities() {
  const { communities, leaveCommunity } = useAuth();
  const [selected, setSelected] = useState(null), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState("");
  const items = Array.isArray(communities) ? communities : communities?.items || [];
  const leave = async () => {
    if (busy || !selected) return;
    setBusy(true); setFeedback("");
    const succeeded = await leaveCommunity(selected._id);
    setBusy(false);
    if (succeeded) setSelected(null);
    else setFeedback("We could not leave this community. Please try again.");
  };
  const share = async community => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname.startsWith("/connect") ? "/connect" : ""}/communities#${community._id}`);
      setFeedback("Community link copied.");
    } catch { setFeedback("Clipboard is unavailable. Open the community to share its address."); }
  };
  return <section aria-labelledby="dashboard-communities"><div className="mp-section-heading"><div><p className="mp-eyebrow">Stay connected</p><h2 id="dashboard-communities">Your communities</h2><p>People and conversations you have chosen to follow.</p></div><Button to="/communities" variant="secondary">Explore communities</Button></div>
    {!selected && feedback && <Banner tone="info">{feedback}</Banner>}
    {communities == null ? <Card><EmptyState title="Community memberships unavailable" action={<Button to="/communities" variant="secondary">Open communities</Button>} /></Card> : !items.length ? <Card><EmptyState title="You have not joined a community yet" action={<Button to="/communities">Find a community</Button>} /></Card> : <div className="mp-dashboard-community-grid">{items.map(community => <Card key={community._id} className="mp-stack"><div className="mp-card-heading"><Users size={22} aria-hidden="true" /><StatusBadge>{community.category || "Community"}</StatusBadge></div><h3>{community.title}</h3><p className="mp-field-hint">{community.bio || "Open this community to see its conversations."}</p><div className="mp-actions"><Button to={`/communities#${community._id}`} variant="secondary">Open community</Button><Button variant="ghost" onClick={() => share(community)} aria-label={`Copy link to ${community.title}`}><Share2 size={16} aria-hidden="true" /></Button><Button variant="ghost" onClick={() => { setSelected(community); setFeedback(""); }}>Leave</Button></div></Card>)}</div>}
    <Dialog open={Boolean(selected)} onClose={() => { if (!busy) setSelected(null); }} title="Leave community"><p>Leave {selected?.title}? You can rejoin later.</p>{feedback && <Banner>{feedback}</Banner>}<div className="mp-actions"><Button variant="secondary" disabled={busy} onClick={() => setSelected(null)} data-autofocus>Keep membership</Button><Button variant="danger" disabled={busy} onClick={leave}>{busy ? "Leaving..." : "Leave community"}</Button></div></Dialog>
  </section>;
}
