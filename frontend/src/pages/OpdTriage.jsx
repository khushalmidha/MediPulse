import { useEffect, useState } from "react";
import axios from "axios";
import { Bot, SendHorizontal } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { BACKEND_URL } from "../utils";

const OpdTriage = () => {
  const [searchParams] = useSearchParams();
  const [tokenId, setTokenId] = useState(searchParams.get("token") || "");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [brief, setBrief] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const start = async () => {
    if (!tokenId) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await axios.get(`${BACKEND_URL}/api/opd-ai/tokens/${tokenId}/triage/start`, { withCredentials: true });
      setMessages([{ role: "agent", text: response.data.message }]);
      setBrief(response.data.patientBrief || null);
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to start OPD triage");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tokenId) start();
  }, []);

  const send = async (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || !tokenId) return;
    setInput("");
    setMessages((current) => [...current, { role: "patient", text }]);
    try {
      const response = await axios.post(`${BACKEND_URL}/api/opd-ai/tokens/${tokenId}/triage/message`, { message: text }, { withCredentials: true });
      setMessages((current) => [...current, { role: "agent", text: response.data.message }]);
      if (response.data.patientBrief) setBrief(response.data.patientBrief);
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to continue triage");
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <section className="mx-auto max-w-3xl rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Bot size={24} />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase text-blue-600">OPD AI Triage</p>
            <h1 className="text-2xl font-extrabold text-gray-950">Prepare your doctor summary</h1>
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <input value={tokenId} onChange={(event) => setTokenId(event.target.value)} placeholder="Paste OPD token ID" className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <button onClick={start} disabled={loading || !tokenId} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-400">Start</button>
        </div>

        {message && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{message}</p>}

        <div className="mt-6 h-[420px] space-y-3 overflow-y-auto rounded-lg bg-gray-50 p-4">
          {messages.map((item, index) => (
            <div key={`${item.role}-${index}`} className={`flex ${item.role === "patient" ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${item.role === "patient" ? "bg-blue-600 text-white" : "bg-white text-gray-800 shadow-sm"}`}>{item.text}</p>
            </div>
          ))}
          {!messages.length && <p className="text-center text-sm text-gray-500">Start triage to answer a few quick questions.</p>}
        </div>

        {brief && (
          <div className="mt-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
            <p className="font-bold">Doctor summary ready</p>
            <p className="mt-1">{brief.agentSummary}</p>
          </div>
        )}

        <form onSubmit={send} className="mt-4 flex gap-3">
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Type your answer..." className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          <button className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-bold text-white">
            <SendHorizontal size={16} />
            Send
          </button>
        </form>
      </section>
    </main>
  );
};

export default OpdTriage;
