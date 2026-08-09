import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Activity, Bot, CheckCircle2, Clock, RefreshCcw, Stethoscope, UserRound, XCircle } from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { getSocket } from "../../socket";

const readStaffSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem("medipulse.hospitalAdmin") || "null");
  } catch {
    return null;
  }
};

const patientName = (token) =>
  token?.patientInfo?.name || token?.patientId?.firstName || "Walk-in patient";

const TokenCard = ({ token, index, onStart, onNoShow }) => {
  const brief = token.aiTriage?.patientBrief;
  const urgency = brief?.urgencyLevel || "ROUTINE";
  const waitMinutes = token.estimatedWaitMinutes || (index + 1) * 12;
  return (
  <div className="rounded-lg border border-gray-200 dark:border-red-900/40 bg-white dark:bg-slate-950 p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-bold text-gray-950">#{index + 1} · {token.displayToken}</p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${urgency === "HIGH" ? "bg-red-100 text-red-700" : "bg-red-100 text-blue-700"}`}>{urgency}</span>
        </div>
        <p className="text-sm text-gray-600">{patientName(token)}</p>
        <p className="mt-1 text-xs font-semibold uppercase text-red-600 dark:text-red-500">{token.status.replace("_", " ")} · ETA {waitMinutes} min</p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onNoShow(token._id)} className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
          No-show
        </button>
        <button onClick={() => onStart(token._id)} className="rounded-md bg-red-600 dark:bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Start
        </button>
      </div>
    </div>
    {token.chiefComplaint && <p className="mt-3 text-sm text-gray-700">Complaint: {token.chiefComplaint}</p>}
    {brief?.agentSummary && (
      <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-blue-950">
        <p className="font-bold">AI triage brief</p>
        <p className="mt-1 line-clamp-2">{brief.agentSummary}</p>
        {!!brief.uncoveredAreas?.length && (
          <p className="mt-2 text-xs text-blue-700">Ask next: {brief.uncoveredAreas.slice(0, 3).join(", ")}</p>
        )}
      </div>
    )}
    {token.vitals?.recordedAt && (
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-green-50 p-3 text-xs text-green-900">
        <span>BP: {token.vitals.bp || "-"}</span>
        <span>Temp: {token.vitals.temperature || "-"}</span>
        <span>Pulse: {token.vitals.pulse || "-"}</span>
        <span>SpO2: {token.vitals.oxygenSat || "-"}</span>
      </div>
    )}
  </div>
  );
};

const DoctorOpdConsole = () => {
  const saved = useMemo(readStaffSession, []);
  const staff = saved?.staff;
  const hospital = saved?.hospital;
  const hospitalId = staff?.hospitalId || hospital?._id;
  const doctorId = staff?._id || staff?.id;
  const [queue, setQueue] = useState({ currentlyServing: null, waiting: [], completed: 0, noShows: 0 });
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("Suggest focused consultation questions and red flags");
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiBrief, setAiBrief] = useState(null);

  const loadQueue = async () => {
    if (!hospitalId || !doctorId) return;
    const response = await axios.get(`${BACKEND_URL}/api/opd/${hospitalId}/${doctorId}/queue`, { withCredentials: true });
    setQueue(response.data);
  };

  useEffect(() => {
    loadQueue().catch((error) => setMessage(error.response?.data?.message || "Unable to load OPD queue")).finally(() => setLoading(false));
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    const refresh = () => loadQueue().catch(() => {});
    socket.on("opd:token-issued", refresh);
    socket.on("opd:vitals-ready", refresh);
    socket.on("opd:consultation-started", refresh);
    socket.on("opd:consultation-completed", refresh);
    socket.on("opd:no-show", refresh);
    const interval = window.setInterval(refresh, 12000);
    return () => {
      socket.off("opd:token-issued", refresh);
      socket.off("opd:vitals-ready", refresh);
      socket.off("opd:consultation-started", refresh);
      socket.off("opd:consultation-completed", refresh);
      socket.off("opd:no-show", refresh);
      window.clearInterval(interval);
    };
  }, [hospitalId, doctorId]);

  const startConsultation = async (tokenId) => {
    setMessage("");
    try {
      await axios.patch(`${BACKEND_URL}/api/opd/tokens/${tokenId}/start-consultation`, {}, { withCredentials: true });
      await loadQueue();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not start consultation");
    }
  };

  const completeConsultation = async () => {
    if (!queue.currentlyServing?._id) return;
    setMessage("");
    try {
      await axios.patch(`${BACKEND_URL}/api/opd/tokens/${queue.currentlyServing._id}/complete`, { notes }, { withCredentials: true });
      setNotes("");
      await loadQueue();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not complete consultation");
    }
  };

  const loadAiContext = async (tokenId) => {
    if (!tokenId) return;
    try {
      const response = await axios.get(`${BACKEND_URL}/api/opd-ai/tokens/${tokenId}/context`, { withCredentials: true });
      setAiBrief(response.data.aiTriage?.patientBrief || null);
      setAiSuggestion(response.data.doctorCopilot?.lastSuggestion || "");
    } catch {
      setAiBrief(null);
    }
  };

  useEffect(() => {
    loadAiContext(queue.currentlyServing?._id);
  }, [queue.currentlyServing?._id]);

  const askCopilot = async () => {
    if (!queue.currentlyServing?._id) return;
    setMessage("");
    try {
      const response = await axios.post(`${BACKEND_URL}/api/opd-ai/tokens/${queue.currentlyServing._id}/copilot`, { prompt: aiPrompt }, { withCredentials: true });
      setAiSuggestion(response.data.suggestion);
      setAiBrief(response.data.context?.patientBrief || aiBrief);
    } catch (error) {
      setMessage(error.response?.data?.message || "Co-Pilot unavailable right now");
    }
  };

  const markNoShow = async (tokenId) => {
    setMessage("");
    try {
      await axios.patch(`${BACKEND_URL}/api/opd/tokens/${tokenId}/no-show`, {}, { withCredentials: true });
      await loadQueue();
    } catch (error) {
      setMessage(error.response?.data?.message || "Could not mark no-show");
    }
  };

  if (!hospitalId || !doctorId) {
    return <div className="min-h-screen bg-gray-50 dark:bg-slate-900 p-8">Doctor staff session not found. Sign in as hospital staff first.</div>;
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-900 px-4 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase text-red-600 dark:text-red-500">{hospital?.name || "Hospital"} OPD</p>
              <h1 className="text-2xl font-extrabold text-gray-950">Doctor OPD Console</h1>
            </div>
            <button onClick={loadQueue} className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium">
              <RefreshCcw size={16} />
              Refresh
            </button>
          </div>
          {message && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-blue-700">{message}</p>}
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ["Waiting", queue.waiting?.length || 0, Clock],
            ["Completed", queue.completed || 0, CheckCircle2],
            ["No Shows", queue.noShows || 0, XCircle],
            ["Status", queue.currentlyServing ? "In consultation" : "Ready", Activity],
          ].map(([label, value, Icon]) => (
            <div key={label} className="rounded-xl bg-white dark:bg-slate-950 p-5 shadow-sm">
              <Icon className="text-red-600 dark:text-red-500" />
              <p className="mt-3 text-sm text-gray-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-gray-950">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-950">
              <Stethoscope className="text-red-600 dark:text-red-500" />
              Currently Seeing
            </h2>
            {queue.currentlyServing ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-5">
                <p className="text-2xl font-black text-blue-950">{queue.currentlyServing.displayToken}</p>
                <p className="mt-1 text-gray-700">{patientName(queue.currentlyServing)}</p>
                <p className="mt-3 text-sm text-gray-700">Complaint: {queue.currentlyServing.chiefComplaint || "Not recorded"}</p>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Consultation notes, diagnosis, prescription..."
                  className="mt-4 min-h-36 w-full rounded-md border border-red-200 bg-white dark:bg-slate-950 p-3 text-sm outline-none focus:border-red-500"
                />
                <button onClick={completeConsultation} className="mt-4 rounded-md bg-red-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white">
                  End Consultation
                </button>
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-gray-50 dark:bg-slate-900 p-5 text-gray-600">No active consultation. Start the next ready patient from the queue.</p>
            )}
          </div>

          <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-950">
              <Bot className="text-red-600 dark:text-red-500" />
              Doctor Co-Pilot
            </h2>
            {aiBrief ? (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                <p className="font-bold">Patient brief</p>
                <p className="mt-1">{aiBrief.agentSummary}</p>
                <p className="mt-2 text-xs">Urgency: {aiBrief.urgencyLevel || "ROUTINE"}</p>
                {!!aiBrief.suggestedDoctorQuestions?.length && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
                    {aiBrief.suggestedDoctorQuestions.slice(0, 4).map((question) => <li key={question}>{question}</li>)}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-gray-50 dark:bg-slate-900 p-4 text-sm text-gray-500">AI triage brief will appear when the patient completes OPD triage.</p>
            )}
            <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} className="mt-4 min-h-24 w-full rounded-md border border-gray-300 p-3 text-sm outline-none focus:border-red-500" />
            <button onClick={askCopilot} disabled={!queue.currentlyServing} className="mt-3 rounded-md bg-red-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-400">
              Ask Co-Pilot
            </button>
            {aiSuggestion && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-red-50 p-4 text-sm text-blue-950">{aiSuggestion}</p>}
          </div>

          <div className="rounded-xl bg-white dark:bg-slate-950 p-6 shadow-sm lg:col-span-2">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-950">
              <UserRound className="text-red-600 dark:text-red-500" />
              Queue
            </h2>
            <div className="mt-4 space-y-3">
              {loading ? (
                <p className="text-sm text-gray-500">Loading queue...</p>
              ) : queue.waiting?.length ? (
                queue.waiting.map((token, index) => (
                  <TokenCard key={token._id} token={token} index={index} onStart={startConsultation} onNoShow={markNoShow} />
                ))
              ) : (
                <p className="rounded-lg bg-gray-50 dark:bg-slate-900 p-5 text-sm text-gray-500">No waiting patients.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export default DoctorOpdConsole;
