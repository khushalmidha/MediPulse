import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { ArrowRight, CheckCircle2, Activity, Bot, ChevronRight } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { BACKEND_URL } from "../utils";

const OpdTriage = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [brief, setBrief] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const { doctorId } = useParams();
  const navigate = useNavigate();

  const currentAgentMessage = messages.slice().reverse().find(m => m.role === "agent")?.text || "";

  const start = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await axios.get(`${BACKEND_URL}/api/triage/start`, { withCredentials: true });
      setMessages([{ role: "agent", text: response.data.message }]);
      setBrief(response.data.patientBrief || null);
      setStep(1);
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to start OPD triage");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    start();
  }, []);

  const completeTriage = async () => {
    setIsCompleting(true);
    try {
      const response = await axios.post(`${BACKEND_URL}/api/triage/complete`, {}, { withCredentials: true });
      setBrief(response.data.patientBrief);
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to complete triage");
      setIsCompleting(false);
    }
  };

  const send = async (event) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;
    
    setInput("");
    setMessages((current) => [...current, { role: "patient", text }]);
    setLoading(true);
    
    try {
      const response = await axios.post(`${BACKEND_URL}/api/triage/message`, { message: text }, { withCredentials: true });
      setMessages((current) => [...current, { role: "agent", text: response.data.message }]);
      if (response.data.isBriefReady) {
        completeTriage();
      } else {
        setStep(s => s + 1);
      }
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to continue triage");
    } finally {
      setLoading(false);
    }
  };

  // Auto-focus input when step changes
  const inputRef = useRef(null);
  useEffect(() => {
    if (!loading && !brief && inputRef.current) {
      inputRef.current.focus();
    }
  }, [loading, brief, step]);

  if (brief) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full bg-white dark:bg-slate-950 rounded-3xl shadow-xl overflow-hidden animate-[fadeIn_0.5s_ease-out]">
          <div className="bg-gradient-to-r from-red-600 to-red-600 p-8 text-center text-white">
            <div className="w-20 h-20 bg-white/20 dark:bg-slate-950/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
              <CheckCircle2 size={40} className="text-white" />
            </div>
            <h1 className="text-3xl font-black mb-2">Triage Complete!</h1>
            <p className="text-red-100 text-lg">Your health profile is ready for the doctor.</p>
          </div>
          
          <div className="p-8">
            <div className="mb-8">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">AI Summary</h3>
              <p className="text-slate-800 dark:text-slate-200 text-lg leading-relaxed">{brief.agentSummary}</p>
            </div>

            {brief?.predictedDisease && brief.predictedDisease !== "Unknown" && (
              <div className="mb-8 p-4 rounded-2xl bg-red-50 border border-indigo-100 flex items-start gap-4">
                <Activity className="text-indigo-500 shrink-0 mt-1" size={24} />
                <div>
                  <h3 className="text-sm font-bold text-indigo-900 uppercase tracking-wider mb-1">Preliminary AI Assessment</h3>
                  <p className="text-indigo-800 font-medium">The AI detected patterns consistent with <span className="font-black bg-indigo-200 px-2 py-0.5 rounded text-indigo-900">{brief.predictedDisease}</span>.</p>
                  <p className="text-red-600 text-sm mt-1">This has been securely attached to your file for the doctor's review.</p>
                </div>
              </div>
            )}

            <button 
              onClick={() => {
                if (doctorId) {
                  navigate(`/appointment/book/${doctorId}`);
                } else {
                  navigate("/doctors");
                }
              }}
              className="w-full flex items-center justify-center gap-2 bg-red-600 dark:bg-red-700 hover:bg-blue-700 text-white font-bold text-lg py-4 px-8 rounded-2xl transition-all hover:shadow-lg hover:shadow-red-500/30"
            >
              Proceed to Booking <ArrowRight />
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans">
      <div className="flex-1 flex flex-col justify-center max-w-4xl mx-auto w-full px-6 py-12">
        
        {/* Header */}
        <div className="absolute top-8 left-8 flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center text-red-600 dark:text-red-500">
            <Bot size={24} />
          </div>
          <span className="font-black text-xl tracking-tight text-slate-800 dark:text-slate-200">MediPulse Triage</span>
        </div>

        {/* Progress indicator */}
        <div className="absolute top-10 right-8 text-sm font-bold text-slate-400">
          Question {step}
        </div>

        {/* Main interactive area */}
        <div className="w-full">
          {message && (
            <div className="mb-8 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium">
              {message}
            </div>
          )}

          {isCompleting ? (
            <div className="text-center animate-[pulse_2s_ease-in-out_infinite]">
              <Activity size={48} className="text-red-500 mx-auto mb-6" />
              <h2 className="text-3xl font-light text-slate-600">Analyzing your symptoms...</h2>
              <p className="text-slate-400 mt-2">Our AI is preparing your clinical brief and running diagnostic models.</p>
            </div>
          ) : (
            <div key={step} className="animate-[slideInUp_0.5s_ease-out]">
              <h1 className="text-4xl md:text-5xl font-light text-slate-800 dark:text-slate-200 leading-tight mb-12">
                {currentAgentMessage || "Loading..."}
              </h1>

              <form onSubmit={send} className="relative group">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={loading}
                  placeholder="Type your answer here..."
                  className="w-full text-2xl md:text-3xl font-medium text-red-600 dark:text-red-500 placeholder:text-slate-300 bg-transparent border-b-2 border-slate-200 focus:border-red-600 pb-4 outline-none transition-colors disabled:opacity-50"
                  autoFocus
                />
                <button 
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="absolute right-0 bottom-4 text-red-600 dark:text-red-500 hover:text-blue-800 disabled:text-slate-300 transition-colors"
                >
                  <span className="sr-only">Submit</span>
                  <div className="bg-red-50 group-focus-within:bg-red-100 p-2 rounded-lg">
                    <ChevronRight size={32} />
                  </div>
                </button>
              </form>
              
              <div className="mt-6 flex items-center gap-2 text-sm font-medium text-slate-400">
                <span className="bg-slate-100 px-2 py-1 rounded">Enter ↵</span> to submit
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Global CSS for animations (can also go in index.css) */}
      <style>{`
        @keyframes slideInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </main>
  );
};

export default OpdTriage;
