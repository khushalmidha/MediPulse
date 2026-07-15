/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "../utils";

const TriageChat = ({ appointmentId, onCompleted }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isBriefReady, setIsBriefReady] = useState(false);
  const [urgencyLevel, setUrgencyLevel] = useState(null);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    let mounted = true;
    const start = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await axios.get(
          `${BACKEND_URL}/api/triage/${appointmentId}/start`,
          { withCredentials: true },
        );
        if (!mounted) return;
        setMessages([{ role: "agent", text: response.data.message }]);
      } catch (err) {
        if (!mounted) return;
        setError(
          err.response?.data?.message ||
            "AI is temporarily unavailable, your appointment is unaffected",
        );
      } finally {
        if (mounted) setLoading(false);
      }
    };
    start();
    return () => {
      mounted = false;
    };
  }, [appointmentId]);

  const completeBrief = async (nextUrgency) => {
    const response = await axios.post(
      `${BACKEND_URL}/api/triage/${appointmentId}/complete`,
      {},
      { withCredentials: true },
    );
    setIsBriefReady(true);
    setUrgencyLevel(nextUrgency || response.data.patientBrief?.urgencyLevel || null);
    setMessages((current) => [
      ...current,
      {
        role: "agent",
        text: "Your doctor now has your health summary. You're all set for your appointment!",
      },
    ]);
    onCompleted?.(response.data.patientBrief);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || isBriefReady) return;

    setInput("");
    setError("");
    setMessages((current) => [...current, { role: "patient", text }]);
    setLoading(true);
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/triage/${appointmentId}/message`,
        { message: text },
        { withCredentials: true },
      );
      setMessages((current) => [...current, { role: "agent", text: response.data.message }]);
      setUrgencyLevel(response.data.urgencyLevel || null);
      if (response.data.isBriefReady) {
        await completeBrief(response.data.urgencyLevel);
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "AI is temporarily unavailable, your appointment is unaffected",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex max-h-[78vh] flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-xl">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <h2 className="text-lg font-bold text-slate-950">Pre-Consultation AI Triage</h2>
        <p className="mt-1 text-sm text-slate-600">
          Answer a few focused questions so your doctor sees a short health summary before the call.
        </p>
      </div>

      {urgencyLevel === "EMERGENCY" && (
        <div className="bg-red-600 px-5 py-3 text-sm font-bold text-white">
          Please seek emergency care immediately. Call 112 or go to nearest ER.
        </div>
      )}

      {error && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`flex ${message.role === "patient" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                message.role === "patient"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "bg-blue-100 text-blue-950"
              }`}
            >
              {message.role === "agent" && (
                <span className="mb-1 inline-flex rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  AI
                </span>
              )}
              <p className="whitespace-pre-wrap">{message.text}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-blue-100 px-4 py-3 text-blue-950">
              <span className="inline-flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-blue-500" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-blue-500 [animation-delay:120ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-blue-500 [animation-delay:240ms]" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 bg-white p-4">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading || isBriefReady}
          placeholder={
            isBriefReady ? "Health summary submitted" : "Type your answer..."
          }
          className="min-h-20 w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100"
        />
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={sendMessage}
            disabled={loading || isBriefReady || !input.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default TriageChat;
