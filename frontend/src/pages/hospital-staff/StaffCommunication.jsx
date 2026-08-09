import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { BellRing, Building2, FlaskConical, MessageSquare, RefreshCcw, SendHorizontal, UserRound } from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { getSocket } from "../../socket";

const readStaffSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem("medipulse.hospitalAdmin") || "null");
  } catch {
    return null;
  }
};

const tabs = [
  { id: "department", label: "Department", icon: Building2 },
  { id: "direct", label: "Direct Messages", icon: UserRound },
  { id: "patient_context", label: "Patient Context", icon: UserRound },
  { id: "lab", label: "Lab Notifications", icon: FlaskConical },
];

const formatTime = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(new Date(value))
    : "";

const StaffCommunication = () => {
  const saved = useMemo(readStaffSession, []);
  const staff = saved?.staff;
  const hospital = saved?.hospital;
  const hospitalId = staff?.hospitalId || hospital?._id;
  const staffId = staff?._id || staff?.id;
  const firstDepartmentId = staff?.departmentIds?.[0] || "";
  const [activeTab, setActiveTab] = useState("patient_context");
  const [tokenId, setTokenId] = useState("");
  const [departmentId, setDepartmentId] = useState(firstDepartmentId);
  const [recipientStaffId, setRecipientStaffId] = useState("");
  const [directory, setDirectory] = useState({ departments: [], staff: [] });
  const [staffSearch, setStaffSearch] = useState("");
  const [content, setContent] = useState("");
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef(null);
  const shouldScrollRef = useRef(false); // Only auto-scroll on NEW messages, not initial load

  const conversationType = activeTab === "lab" ? "announcement" : activeTab;
  const messageType = activeTab === "lab" ? "lab_alert" : "text";

  const currentFilters = useMemo(
    () => ({
      conversationType,
      tokenId: activeTab === "patient_context" ? tokenId : "",
      departmentId: activeTab === "department" ? departmentId : "",
      recipientStaffId: activeTab === "direct" ? recipientStaffId : "",
      messageType: activeTab === "lab" ? "lab_alert" : "",
    }),
    [activeTab, conversationType, departmentId, recipientStaffId, tokenId],
  );

  const matchesCurrentThread = useCallback(
    (incoming) => {
      if (activeTab === "lab") return incoming.messageType === "lab_alert";
      if (incoming.conversationType !== conversationType) return false;
      if (activeTab === "patient_context") return !tokenId || incoming.tokenId?.toString() === tokenId;
      if (activeTab === "department") return !departmentId || incoming.departmentId?.toString() === departmentId;
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

  const loadMessages = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      Object.entries(currentFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const response = await axios.get(`${BACKEND_URL}/api/staff-messages?${params.toString()}`, { withCredentials: true });
      setMessages(response.data.items || []);
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to load staff messages");
    } finally {
      setLoading(false);
    }
  }, [currentFilters, hospitalId]);

  const loadDirectory = useCallback(async () => {
    if (!hospitalId) return;
    const response = await axios.get(`${BACKEND_URL}/api/staff-messages/directory`, { withCredentials: true });
    setDirectory(response.data || { departments: [], staff: [] });
    if (!departmentId) setDepartmentId(firstDepartmentId || response.data?.departments?.[0]?._id || "");
  }, [departmentId, firstDepartmentId, hospitalId]);

  useEffect(() => {
    loadDirectory().catch(() => {});
    loadMessages();
  }, [loadDirectory, loadMessages]);

  useEffect(() => {
    if (!hospitalId) return undefined;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    socket.emit("staff:joinHospital", { hospitalId });

    const onMessage = (incoming) => {
      if (!matchesCurrentThread(incoming)) return;
      setMessages((current) => {
        if (current.some((item) => item._id === incoming._id)) return current;
        shouldScrollRef.current = true; // Mark: scroll on new socket message
        return [...current, incoming];
      });
    };

    socket.on("staff:newMessage", onMessage);
    socket.on("lab:order-received", onMessage);
    return () => {
      socket.off("staff:newMessage", onMessage);
      socket.off("lab:order-received", onMessage);
    };
  }, [hospitalId, matchesCurrentThread]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !shouldScrollRef.current) return;
    // Only auto-scroll when a NEW message arrives via socket (not on initial load)
    list.scrollTop = list.scrollHeight;
    shouldScrollRef.current = false;
  }, [messages]);

  const sendMessage = async (event) => {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || !hospitalId) return;
    if (activeTab === "patient_context" && !tokenId) {
      setMessage("Token ID is required for patient context chat");
      return;
    }
    if (activeTab === "department" && !departmentId) {
      setMessage("Department ID is required for department chat");
      return;
    }
    if (activeTab === "direct" && !recipientStaffId) {
      setMessage("Choose a staff member for direct message");
      return;
    }

    setMessage("");
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    socket.emit(
      "staff:sendMessage",
      {
        hospitalId,
        conversationType,
        content: trimmed,
        tokenId: activeTab === "patient_context" ? tokenId : undefined,
        departmentId: activeTab === "department" ? departmentId : undefined,
        recipientStaffId: activeTab === "direct" ? recipientStaffId : undefined,
        messageType,
        metadata: activeTab === "lab" ? { feed: "lab_notifications" } : undefined,
      },
      (response) => {
        if (!response?.ok) {
          setMessage(response?.message || "Could not send message");
          return;
        }
        setContent("");
        // Scroll to bottom after sending
        shouldScrollRef.current = true;
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      },
    );
  };

  if (!hospitalId) {
    return <div className="min-h-screen bg-gray-50 dark:bg-slate-900 p-8">Staff session not found. Sign in as hospital staff first.</div>;
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-900 px-4 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase text-blue-600 dark:text-red-500">{hospital?.name || "Hospital"} Staff Hub</p>
              <h1 className="text-2xl font-extrabold text-gray-950">Internal Communication</h1>
              <p className="mt-2 text-sm text-gray-600">Coordinate patient updates, department messages, and lab alerts in one realtime workspace.</p>
            </div>
            <button onClick={loadMessages} className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium">
              <RefreshCcw size={16} />
              Refresh
            </button>
          </div>
          {message && <p className="mt-4 rounded-md bg-blue-50 p-3 text-sm text-blue-700">{message}</p>}
        </section>

        <section className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="rounded-xl bg-white dark:bg-slate-950 p-4 shadow-sm">
            <div className="space-y-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold ${selected ? "bg-blue-600 dark:bg-red-700 text-white" : "text-gray-700 hover:bg-gray-100"}`}
                  >
                    <Icon size={18} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 space-y-3 border-t border-gray-100 pt-4">
              {activeTab === "patient_context" && (
                <input value={tokenId} onChange={(e) => setTokenId(e.target.value)} placeholder="Patient token ID" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
              )}
              {activeTab === "department" && (
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase text-gray-500">Department channels</p>
                  {directory.departments.map((department) => (
                    <button
                      key={department._id}
                      onClick={() => setDepartmentId(department._id)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${departmentId === department._id ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50 dark:bg-slate-900"}`}
                    >
                      # {department.name}
                    </button>
                  ))}
                </div>
              )}
              {activeTab === "direct" && (
                <div className="space-y-3">
                  <input value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)} placeholder="Search staff" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {directory.staff
                      .filter((member) => member._id !== staffId)
                      .filter((member) => `${member.name} ${member.email} ${member.role}`.toLowerCase().includes(staffSearch.toLowerCase()))
                      .map((member) => (
                        <button
                          key={member._id}
                          onClick={() => setRecipientStaffId(member._id)}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${recipientStaffId === member._id ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50 dark:bg-slate-900"}`}
                        >
                          <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-xs font-bold">
                            {member.profilePhoto ? <img src={member.profilePhoto} alt={member.name} className="h-full w-full object-cover" /> : member.name?.slice(0, 2)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold">{member.name}</span>
                            <span className="block text-xs text-gray-500">{member.role.replace("_", " ")}</span>
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
              <p className="rounded-md bg-gray-50 dark:bg-slate-900 p-3 text-xs text-gray-500">
                Signed in as <span className="font-semibold text-gray-700">{staff?.name || staff?.firstName || "Staff"}</span>
              </p>
            </div>
          </aside>

          <section className="flex min-h-[620px] flex-col rounded-xl bg-white dark:bg-slate-950 shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:text-red-500">
                  {activeTab === "lab" ? <BellRing size={20} /> : <MessageSquare size={20} />}
                </div>
                <div>
                  <h2 className="font-bold text-gray-950">
                    {activeTab === "department"
                      ? `# ${directory.departments.find((department) => department._id === departmentId)?.name || "Department"}`
                      : activeTab === "direct"
                        ? directory.staff.find((member) => member._id === recipientStaffId)?.name || "Direct Messages"
                        : tabs.find((tab) => tab.id === activeTab)?.label}
                  </h2>
                  <p className="text-xs text-gray-500">{loading ? "Loading messages..." : `${messages.length} messages`}</p>
                </div>
              </div>
            </div>

            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-gray-50 dark:bg-slate-900 p-5">
              {messages.map((item) => {
                const mine = item.sender?.toString() === staffId;
                return (
                  <div key={item._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[78%] rounded-xl px-4 py-3 shadow-sm ${mine ? "bg-blue-600 dark:bg-red-700 text-white" : "bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100"}`}>
                      <div className={`mb-1 flex items-center gap-2 text-xs ${mine ? "text-blue-100" : "text-gray-500"}`}>
                        <span className="font-semibold">{item.senderName || "Staff"}</span>
                        <span>{item.senderRole}</span>
                        <span>{formatTime(item.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.content}</p>
                    </div>
                  </div>
                );
              })}
              {!messages.length && !loading && <p className="rounded-lg bg-white dark:bg-slate-950 p-5 text-center text-sm text-gray-500">No messages yet.</p>}
            </div>

            <form onSubmit={sendMessage} className="border-t border-gray-100 p-4">
              <div className="flex gap-3">
                <input
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={activeTab === "lab" ? "Post lab alert..." : "Type message..."}
                  maxLength={2000}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                />
                <button className="inline-flex items-center gap-2 rounded-md bg-blue-600 dark:bg-red-700 px-4 py-2.5 text-sm font-bold text-white">
                  <SendHorizontal size={16} />
                  Send
                </button>
              </div>
            </form>
          </section>
        </section>
      </div>
    </main>
  );
};

export default StaffCommunication;
