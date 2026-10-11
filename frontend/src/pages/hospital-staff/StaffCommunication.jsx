import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  BellRing,
  Building2,
  FlaskConical,
  MessageSquare,
  RefreshCcw,
  SendHorizontal,
  UserRound,
  ArrowRight,
} from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { getSocket } from "../../socket";
import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, EmptyState, Field, LoadingState } from "../../components/ui";
import "../../components/staff/staffCommunication.css";

const tabs = [
  { id: "department", label: "Department Channel", icon: Building2 },
  { id: "direct", label: "Direct Messages", icon: UserRound },
  { id: "patient_context", label: "Patient Context", icon: MessageSquare },
  { id: "lab", label: "Lab Notifications", icon: FlaskConical },
];

const formatTime = (value) => {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    }).format(new Date(value));
  } catch {
    return "";
  }
};

const StaffCommunication = () => {
  const { staffUser, staffHospital, isStaffAuth, loader } = useAuth();
  const hospitalId = staffUser?.hospitalId || staffHospital?._id;
  const staffId = staffUser?._id || staffUser?.id;
  const firstDepartmentId = staffUser?.departmentIds?.[0] || "";

  const [activeTab, setActiveTab] = useState("department");
  const [tokenId, setTokenId] = useState("");
  const [departmentId, setDepartmentId] = useState(firstDepartmentId);
  const [recipientStaffId, setRecipientStaffId] = useState("");
  const [directory, setDirectory] = useState({ departments: [], staff: [] });
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");
  const [content, setContent] = useState("");
  const [messages, setMessages] = useState([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState("error");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const listRef = useRef(null);
  const shouldScrollRef = useRef(false);

  // Clear data if active staff or hospital session switches
  const sessionIdentity = `${hospitalId || ""}:${staffId || ""}`;
  const prevSessionRef = useRef(sessionIdentity);
  useEffect(() => {
    if (prevSessionRef.current !== sessionIdentity) {
      prevSessionRef.current = sessionIdentity;
      setMessages([]);
      setDirectory({ departments: [], staff: [] });
      setStatusMessage("");
      setContent("");
      setRecipientStaffId("");
      setTokenId("");
    }
  }, [sessionIdentity]);

  const conversationType = activeTab === "lab" ? "patient_context" : activeTab;
  const messageType = activeTab === "lab" ? "lab_alert" : "text";

  const currentFilters = useMemo(
    () => ({
      conversationType,
      tokenId: ["patient_context", "lab"].includes(activeTab) ? tokenId : "",
      departmentId: activeTab === "department" ? departmentId : "",
      recipientStaffId: activeTab === "direct" ? recipientStaffId : "",
      messageType: activeTab === "lab" ? "lab_alert" : "",
    }),
    [activeTab, conversationType, departmentId, recipientStaffId, tokenId],
  );

  const matchesCurrentThread = useCallback(
    (incoming) => {
      if (!incoming) return false;
      if (activeTab === "lab") return incoming.messageType === "lab_alert";
      if (incoming.conversationType !== conversationType) return false;
      if (activeTab === "patient_context") return !tokenId || String(incoming.tokenId) === String(tokenId);
      if (activeTab === "department") return !departmentId || String(incoming.departmentId) === String(departmentId);
      if (activeTab === "direct") {
        return (
          incoming.conversationType === "direct" &&
          (!recipientStaffId ||
            (String(incoming.sender) === String(recipientStaffId) && String(incoming.recipientStaffId) === String(staffId)) ||
            (String(incoming.sender) === String(staffId) && String(incoming.recipientStaffId) === String(recipientStaffId)))
        );
      }
      return true;
    },
    [activeTab, conversationType, departmentId, recipientStaffId, staffId, tokenId],
  );

  const loadDirectory = useCallback(async () => {
    if (!hospitalId || !isStaffAuth) return;
    setDirectoryLoading(true);
    try {
      const response = await axios.get(`${BACKEND_URL}/api/staff-messages/directory`, { withCredentials: true });
      const nextDirectory = response.data || { departments: [], staff: [] };
      setDirectory(nextDirectory);
      if (!departmentId) {
        setDepartmentId(firstDepartmentId || nextDirectory.departments?.[0]?._id || "");
      }
    } catch (error) {
      setStatusMessage(error.response?.data?.message || "Unable to load hospital staff directory");
      setStatusTone("error");
    } finally {
      setDirectoryLoading(false);
    }
  }, [departmentId, firstDepartmentId, hospitalId, isStaffAuth]);

  const markRead = useCallback(async (msgList) => {
    if (!isStaffAuth || !msgList?.length) return;
    const unread = msgList
      .filter((m) => m && m._id && String(m.sender) !== String(staffId) && !m.readBy?.some((r) => String(r.staffId) === String(staffId)))
      .map((m) => m._id);
    if (!unread.length) return;
    try {
      await axios.patch(`${BACKEND_URL}/api/staff-messages/read`, { messageIds: unread.slice(0, 100) }, { withCredentials: true });
    } catch {
      // Best-effort read receipt
    }
  }, [isStaffAuth, staffId]);

  const loadMessages = useCallback(async () => {
    if (!hospitalId || !isStaffAuth) return;
    setLoading(true);
    setStatusMessage("");
    try {
      const params = new URLSearchParams();
      Object.entries(currentFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const response = await axios.get(`${BACKEND_URL}/api/staff-messages?${params.toString()}`, { withCredentials: true });
      const items = response.data.items || [];
      setMessages(items);
      shouldScrollRef.current = true;
      markRead(items);
    } catch (error) {
      setStatusMessage(error.response?.data?.message || "Unable to load staff messages");
      setStatusTone("error");
    } finally {
      setLoading(false);
    }
  }, [currentFilters, hospitalId, isStaffAuth, markRead]);

  useEffect(() => {
    if (hospitalId && isStaffAuth) {
      loadDirectory();
    }
  }, [hospitalId, isStaffAuth, loadDirectory]);

  useEffect(() => {
    if (hospitalId && isStaffAuth) {
      loadMessages();
    }
  }, [hospitalId, isStaffAuth, loadMessages]);

  useEffect(() => {
    if (!hospitalId || !isStaffAuth) return undefined;
    const socket = getSocket("staff");
    if (!socket.connected) socket.connect();
    socket.emit("staff:joinHospital", { hospitalId });

    const onMessage = (incoming) => {
      if (!matchesCurrentThread(incoming)) return;
      setMessages((current) => {
        if (current.some((item) => item._id === incoming._id)) return current;
        shouldScrollRef.current = true;
        const next = [...current, incoming];
        markRead([incoming]);
        return next;
      });
    };

    socket.on("staff:newMessage", onMessage);
    socket.on("lab:order-received", onMessage);
    return () => {
      socket.off("staff:newMessage", onMessage);
      socket.off("lab:order-received", onMessage);
    };
  }, [hospitalId, isStaffAuth, matchesCurrentThread, markRead]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !shouldScrollRef.current) return;
    list.scrollTop = list.scrollHeight;
    shouldScrollRef.current = false;
  }, [messages]);

  const sendMessage = async (event) => {
    event?.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || !hospitalId || sending) return;

    if (["patient_context", "lab"].includes(activeTab) && !tokenId) {
      setStatusMessage("A patient token ID is required for patient context updates and lab alerts.");
      setStatusTone("error");
      return;
    }
    if (activeTab === "department" && !departmentId) {
      setStatusMessage("Select a department channel before sending.");
      setStatusTone("error");
      return;
    }
    if (activeTab === "direct" && !recipientStaffId) {
      setStatusMessage("Select a staff colleague to send a direct message.");
      setStatusTone("error");
      return;
    }

    setStatusMessage("");
    setSending(true);
    const socket = getSocket("staff");
    if (!socket.connected) socket.connect();

    socket.emit(
      "staff:sendMessage",
      {
        hospitalId,
        conversationType,
        content: trimmed,
        tokenId: ["patient_context", "lab"].includes(activeTab) ? tokenId : undefined,
        departmentId: activeTab === "department" ? departmentId : undefined,
        recipientStaffId: activeTab === "direct" ? recipientStaffId : undefined,
        messageType,
        metadata: activeTab === "lab" ? { feed: "lab_notifications" } : undefined,
      },
      (response) => {
        setSending(false);
        if (!response?.ok) {
          setStatusMessage(response?.message || "Could not deliver message to the staff channel.");
          setStatusTone("error");
          return;
        }
        setContent("");
        shouldScrollRef.current = true;
      },
    );
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const filteredStaff = useMemo(() => {
    const search = staffSearch.trim().toLowerCase();
    return (directory.staff || [])
      .filter((member) => String(member._id) !== String(staffId))
      .filter((member) => {
        if (!search) return true;
        return (
          member.name?.toLowerCase().includes(search) ||
          member.email?.toLowerCase().includes(search) ||
          member.role?.toLowerCase().includes(search)
        );
      });
  }, [directory.staff, staffId, staffSearch]);

  const activeChannelTitle = useMemo(() => {
    if (activeTab === "department") {
      const dept = directory.departments?.find((d) => String(d._id) === String(departmentId));
      return dept ? `# ${dept.name}` : "Department Channel";
    }
    if (activeTab === "direct") {
      const colleague = directory.staff?.find((s) => String(s._id) === String(recipientStaffId));
      return colleague ? colleague.name : "Direct Messages";
    }
    if (activeTab === "patient_context") {
      return tokenId ? `Visit Token ${tokenId}` : "Patient Context Updates";
    }
    if (activeTab === "lab") {
      return tokenId ? `Lab Alerts: Token ${tokenId}` : "Laboratory Alerts";
    }
    return "Staff Communication";
  }, [activeTab, departmentId, directory.departments, directory.staff, recipientStaffId, tokenId]);

  if (loader) {
    return (
      <main className="mp-page">
        <LoadingState>Loading staff workspace...</LoadingState>
      </main>
    );
  }

  if (!isStaffAuth || !hospitalId) {
    return (
      <main className="mp-page">
        <Card>
          <EmptyState
            title="Sign in to your hospital workspace"
            action={
              <Button to="/hospital/login">
                Staff sign in <ArrowRight size={16} />
              </Button>
            }
          >
            Access to hospital staff communication requires an active staff session.
          </EmptyState>
        </Card>
      </main>
    );
  }

  return (
    <main className="mp-page mp-staff-comm">
      <div className="mp-section-heading">
        <div>
          <p className="mp-eyebrow">{staffHospital?.name || "Hospital"} Staff Hub</p>
          <h1>Internal Communication</h1>
          <p>Coordinate patient updates, department messages, and lab alerts in one realtime workspace.</p>
        </div>
        <Button
          variant="secondary"
          onClick={loadMessages}
          disabled={loading}
          aria-label="Refresh conversation messages"
        >
          <RefreshCcw size={16} className={loading ? "mp-spin" : ""} />
          Refresh
        </Button>
      </div>

      {statusMessage && <Banner tone={statusTone}>{statusMessage}</Banner>}

      <div className="mp-staff-comm-layout">
        {/* Sidebar Channels & Directory */}
        <aside className="mp-staff-comm-sidebar" aria-label="Communication channels">
          <Card>
            <div className="mp-card-heading">
              <h2>Channels</h2>
            </div>
            <nav className="mp-staff-comm-channels" aria-label="Channel tabs">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isSelected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setStatusMessage("");
                    }}
                    className="mp-staff-channel-btn"
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Department Channel Sub-options */}
            {activeTab === "department" && (
              <div className="mp-staff-channel-sub">
                <p className="mp-field-hint" style={{ fontWeight: 650 }}>Department Channels</p>
                {directoryLoading ? (
                  <LoadingState>Loading departments...</LoadingState>
                ) : !directory.departments?.length ? (
                  <p className="mp-field-hint">No departments available.</p>
                ) : (
                  <div className="mp-staff-directory-list">
                    {directory.departments.map((dept) => (
                      <button
                        key={dept._id}
                        type="button"
                        aria-selected={String(departmentId) === String(dept._id)}
                        onClick={() => setDepartmentId(dept._id)}
                        className="mp-staff-channel-btn"
                        style={{ padding: "8px 12px", fontSize: "0.82rem" }}
                      >
                        <Building2 size={15} aria-hidden="true" />
                        <span># {dept.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Direct Messages Sub-options */}
            {activeTab === "direct" && (
              <div className="mp-staff-channel-sub">
                <Field
                  label="Search staff"
                  placeholder="Name, role, or email..."
                  value={staffSearch}
                  onChange={(e) => setStaffSearch(e.target.value)}
                />
                <div className="mp-staff-directory-list" role="listbox" aria-label="Hospital staff members">
                  {directoryLoading ? (
                    <LoadingState>Loading staff list...</LoadingState>
                  ) : !filteredStaff.length ? (
                    <p className="mp-field-hint" style={{ padding: "8px 0" }}>No colleagues found.</p>
                  ) : (
                    filteredStaff.map((colleague) => (
                      <button
                        key={colleague._id}
                        type="button"
                        role="option"
                        aria-selected={String(recipientStaffId) === String(colleague._id)}
                        onClick={() => setRecipientStaffId(colleague._id)}
                        className="mp-staff-member-btn"
                      >
                        <span className="mp-staff-member-avatar" aria-hidden="true">
                          {colleague.profilePhoto ? (
                            <img src={colleague.profilePhoto} alt="" />
                          ) : (
                            colleague.name?.slice(0, 2).toUpperCase() || "ST"
                          )}
                        </span>
                        <div className="mp-staff-member-info">
                          <span className="mp-staff-member-name">{colleague.name}</span>
                          <span className="mp-staff-member-role">{colleague.role?.replace("_", " ")}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Patient Context & Lab Context Token Input */}
            {["patient_context", "lab"].includes(activeTab) && (
              <div className="mp-staff-channel-sub">
                <Field
                  label="Patient Token ID"
                  placeholder="Enter visit token id (e.g. 64f...)"
                  value={tokenId}
                  onChange={(e) => setTokenId(e.target.value.trim())}
                  hint="Filters messages linked to this care encounter"
                />
              </div>
            )}

            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--mp-border)" }}>
              <p className="mp-field-hint">
                Signed in as <strong>{staffUser?.name || staffUser?.firstName || "Staff Member"}</strong> ({staffUser?.role?.replace("_", " ") || "Staff"})
              </p>
            </div>
          </Card>
        </aside>

        {/* Conversation Workspace */}
        <section className="mp-staff-chat-window mp-card" aria-label="Conversation window">
          <header className="mp-staff-chat-header">
            <div className="mp-staff-chat-title-group">
              <div className="mp-staff-chat-icon" aria-hidden="true">
                {activeTab === "lab" ? <BellRing size={20} /> : <MessageSquare size={20} />}
              </div>
              <div>
                <h2>{activeChannelTitle}</h2>
                <p>
                  {loading
                    ? "Updating messages..."
                    : `${messages.length} ${messages.length === 1 ? "message" : "messages"}`}
                </p>
              </div>
            </div>
          </header>

          <div
            ref={listRef}
            className="mp-staff-messages-list"
            role="log"
            aria-live="polite"
            aria-label="Message stream"
          >
            {loading && !messages.length ? (
              <LoadingState>Loading conversation...</LoadingState>
            ) : !messages.length ? (
              <EmptyState title="No messages in this channel yet.">
                {activeTab === "direct" && !recipientStaffId
                  ? "Select a colleague from the staff list to start a conversation."
                  : ["patient_context", "lab"].includes(activeTab) && !tokenId
                  ? "Enter a patient token ID to inspect visit communications."
                  : "Post an update to begin coordinating with your care team."}
              </EmptyState>
            ) : (
              messages.map((item) => {
                const isMine = String(item.sender) === String(staffId);
                return (
                  <div
                    key={item._id}
                    className={`mp-staff-bubble-row ${isMine ? "mp-staff-bubble-row--mine" : "mp-staff-bubble-row--theirs"}`}
                  >
                    <article
                      className={`mp-staff-bubble ${isMine ? "mp-staff-bubble--mine" : "mp-staff-bubble--theirs"}`}
                      aria-label={`${item.senderName || "Staff"} at ${formatTime(item.createdAt)}`}
                    >
                      <div className="mp-staff-bubble-meta">
                        <strong>{item.senderName || "Staff"}</strong>
                        {item.senderRole && <span>· {item.senderRole.replace("_", " ")}</span>}
                        <span>· {formatTime(item.createdAt)}</span>
                      </div>
                      <p className="mp-staff-bubble-content">{item.content}</p>
                    </article>
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={sendMessage} className="mp-staff-compose-form" aria-label="Compose message">
            <textarea
              className="mp-staff-compose-input"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                activeTab === "lab"
                  ? "Post laboratory alert or specimen update..."
                  : "Type a message for your care team (Press Enter to send)..."
              }
              maxLength={2000}
              aria-label="Message text"
              rows={1}
            />
            <Button
              type="submit"
              disabled={sending || !content.trim()}
              aria-label="Send message"
            >
              <SendHorizontal size={16} />
              {sending ? "Sending..." : "Send"}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
};

export default StaffCommunication;
