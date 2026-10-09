/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { getSocket } from "../socket";
import { BACKEND_URL } from "../utils";
import CoPilotSidebar from "./CoPilotSidebar";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare,
  User, Stethoscope, BrainCircuit, FileText, X, Send
} from "lucide-react";

const MED_KEYWORDS = [
  "aspirin", "ibuprofen", "paracetamol", "acetaminophen", "metformin",
  "insulin", "warfarin", "atorvastatin", "amoxicillin", "azithromycin",
  "omeprazole", "amlodipine",
];
const SYMPTOM_KEYWORDS = [
  "chest pain", "chest tightness", "left arm pain", "jaw pain",
  "severe headache", "vision changes", "difficulty breathing",
  "shortness of breath", "lip swelling", "high fever", "stiff neck",
  "dizziness", "vomiting", "abdominal pain",
];

const AppointmentVideoCall = ({
  appointmentId,
  doctorName = "",
  patientName = "",
  doctorPhoto = "",
  patientPhoto = "",
  onCallEnd,
}) => {
  const { role, user } = useAuth();
  const onCallEndRef = useRef(onCallEnd);
  useEffect(() => { onCallEndRef.current = onCallEnd; }, [onCallEnd]);
  const peerConnectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  // FIXED: Ending the call could fire the parent callback twice (local click + server broadcast),
  // and the person who ended it was left on a stale "Waiting for..." screen.
  const callEndedRef = useRef(false);
  const teardownCallRef = useRef(() => {});

  const [mediaAttempt, setMediaAttempt] = useState(0);
  const [ending, setEnding] = useState(false);
  const [mediaNotice, setMediaNotice] = useState("");
  const [relayNotice, setRelayNotice] = useState("");
  const pendingIceCandidatesRef = useRef([]);
  const transcriptBufferRef = useRef("");
  const fullTranscriptRef = useRef("");
  const mentionedMedsRef = useRef([]);
  const mentionedSymptomsRef = useRef([]);
  const firstChunkRef = useRef(true);

  const [error, setError] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("waiting");
  const [presence, setPresence] = useState({ doctorJoined: false, patientJoined: false, ready: false });
  const [copilotActive, setCopilotActive] = useState(false);
  const [copilotSuggestions, setCopilotSuggestions] = useState([]);
  const [voiceCaptureUnavailable, setVoiceCaptureUnavailable] = useState(false);
  const [activeSidePanel, setActiveSidePanel] = useState(null); // 'copilot', 'chat', 'reports', or null
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [reports, setReports] = useState([]);
  const [selectedReportUrl, setSelectedReportUrl] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  // UI controls state
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // Call duration timer
  useEffect(() => {
    if (!presence.ready) return;
    const timer = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [presence.ready]);

  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const toggleMute = () => {
    if (!localStreamRef.current) return;
    const audioTracks = localStreamRef.current.getAudioTracks();
    audioTracks.forEach((t) => { t.enabled = isMuted; });
    setIsMuted((prev) => !prev);
  };

  const toggleCamera = () => {
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    videoTracks.forEach((t) => { t.enabled = isCameraOff; });
    setIsCameraOff((prev) => !prev);
  };

  const endCall = async () => {
    if (callEndedRef.current || ending) return;
    if (role !== "doctor") { teardownCallRef.current(); return; }
    setEnding(true);
    try {
      await axios.post(`${BACKEND_URL}/appointment/${appointmentId}/end`, {}, { withCredentials: true });
      teardownCallRef.current();
    } catch (err) { setError(err.response?.data?.message || "Unable to end the visit. Please retry."); }
    finally { setEnding(false); }
  };

  const appendTranscriptText = (text) => {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;
    transcriptBufferRef.current = `${transcriptBufferRef.current} ${cleanText}`.trim();
    fullTranscriptRef.current = `${fullTranscriptRef.current} ${cleanText}`.trim();
    const lower = cleanText.toLowerCase();
    MED_KEYWORDS.forEach((kw) => {
      if (lower.includes(kw) && !mentionedMedsRef.current.includes(kw)) mentionedMedsRef.current.push(kw);
    });
    SYMPTOM_KEYWORDS.forEach((kw) => {
      if (lower.includes(kw) && !mentionedSymptomsRef.current.includes(kw)) mentionedSymptomsRef.current.push(kw);
    });
  };

  const mergeSuggestions = (incoming = []) => {
    if (!incoming.length) return;
    setCopilotSuggestions((current) => {
      const seen = new Set(current.map((item) => item.id || `${item.type}:${item.message}`));
      const next = incoming.filter((item) => {
        const key = item.id || `${item.type}:${item.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return [...current, ...next].slice(-30);
    });
    if (incoming.some((item) => item.severity === "high")) setActiveSidePanel("copilot");
  };

  const sendTranscriptChunk = async () => {
    if (role !== "doctor" || !appointmentId) return;
    const chunk = transcriptBufferRef.current.trim();
    if (!chunk) return;
    transcriptBufferRef.current = "";
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/copilot/${appointmentId}/analyze`,
        { transcriptChunk: chunk, isFirstChunk: firstChunkRef.current, allMentionedMeds: mentionedMedsRef.current, allMentionedSymptoms: mentionedSymptomsRef.current },
        { withCredentials: true },
      );
      firstChunkRef.current = false;
      mergeSuggestions(response.data.suggestions || []);
    } catch (err) {
      console.error("Co-Pilot analyze failed:", err);
      transcriptBufferRef.current = `${chunk} ${transcriptBufferRef.current}`.trim();
    }
  };


  useEffect(() => {
    let mounted = true, mediaReady = false, joining = false, negotiating = false, reconnectAttempts = 0;
    let peerPromise = null, peerGeneration = 0, recoveryTimer;
    callEndedRef.current = false;
    setError(""); setMediaNotice(""); setIsCameraOff(false); setIsMuted(false);
    const socket = getSocket();
    const closePeer = () => {
      peerGeneration++; peerPromise = null;
      const peer = peerConnectionRef.current;
      if (peer) { peer.onconnectionstatechange = null; peer.onicecandidate = null; peer.ontrack = null; peer.close(); }
      peerConnectionRef.current = null; remoteStreamRef.current = null; pendingIceCandidatesRef.current = [];
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
    const credentials = async () => {
      const { data } = await axios.get(`${BACKEND_URL}/appointment/${appointmentId}/call-credentials`, { withCredentials: true });
      if (mounted) setRelayNotice(data.relayConfigured ? "" : "Relay service is not configured. Some networks may prevent this call.");
      return { iceServers: data.iceServers };
    };
    const ensurePeer = async () => {
      if (peerConnectionRef.current) return peerConnectionRef.current;
      if (peerPromise) return peerPromise;
      const generation = peerGeneration;
      peerPromise = (async () => {
        const config = await credentials();
        if (!mounted || callEndedRef.current || generation !== peerGeneration) throw new Error("Call connection changed");
        const peer = new RTCPeerConnection(config);
        peerConnectionRef.current = peer;
        localStreamRef.current?.getTracks().forEach(track => peer.addTrack(track, localStreamRef.current));
        peer.onicecandidate = event => { if (event.candidate) socket.emit("appointment:ice-candidate", { appointmentId, candidate: event.candidate }); };
        peer.ontrack = event => {
          const stream = event.streams?.[0] || remoteStreamRef.current || new MediaStream();
          if (!event.streams?.[0]) stream.addTrack(event.track);
          remoteStreamRef.current = stream;
          if (remoteVideoRef.current) { remoteVideoRef.current.srcObject = stream; remoteVideoRef.current.play().catch(() => {}); }
        };
        peer.onconnectionstatechange = () => {
          if (!mounted || callEndedRef.current) return;
          const state = peer.connectionState;
          if (state === "connected") { reconnectAttempts = 0; clearTimeout(recoveryTimer); setConnectionStatus("connected"); }
          if (state === "connecting") setConnectionStatus("connecting");
          if (["disconnected", "failed"].includes(state)) {
            setConnectionStatus("reconnecting"); clearTimeout(recoveryTimer);
            recoveryTimer = setTimeout(() => {
              if (!mounted || callEndedRef.current || peer.connectionState === "connected") return;
              if (++reconnectAttempts > 3) { setConnectionStatus("failed"); setError("Connection could not recover. Retry the call."); return; }
              if (role === "doctor") offer(true).catch(() => setError("Unable to reconnect. Retry the call."));
              else socket.emit("appointment:renegotiate", { appointmentId });
            }, 2000);
          }
        };
        return peer;
      })();
      try { return await peerPromise; } finally { peerPromise = null; }
    };
    const flushCandidates = async peer => {
      if (!peer.remoteDescription) return;
      for (const candidate of pendingIceCandidatesRef.current.splice(0)) await peer.addIceCandidate(candidate).catch(() => {});
    };
    const offer = async (restart = false) => {
      if (role !== "doctor" || !mediaReady || negotiating || !socket.connected || callEndedRef.current) return;
      negotiating = true;
      try {
        const peer = await ensurePeer();
        if (peer.signalingState !== "stable") return;
        if (restart) peer.setConfiguration(await credentials());
        const sdp = await peer.createOffer({ iceRestart: restart });
        await peer.setLocalDescription(sdp);
        if (mounted) socket.emit("appointment:offer", { appointmentId, sdp });
      } finally { negotiating = false; }
    };
    const teardownCall = () => {
      if (callEndedRef.current || !mounted) return;
      callEndedRef.current = true; clearTimeout(recoveryTimer); closePeer();
      localStreamRef.current?.getTracks().forEach(track => track.stop()); localStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setPresence({ doctorJoined: false, patientJoined: false, ready: false }); setConnectionStatus("ended");
      socket.emit("leaveAppointmentRoom", { appointmentId }); onCallEndRef.current?.();
    };
    teardownCallRef.current = teardownCall;
    const recover = async () => {
      if (!mounted || !mediaReady || callEndedRef.current || !socket.connected || joining) return;
      joining = true;
      try {
        const { data } = await axios.get(`${BACKEND_URL}/appointment/${appointmentId}`, { withCredentials: true });
        if (!mounted || callEndedRef.current) return;
        if (!["queued", "active"].includes(data.status)) { teardownCall(); return; }
        socket.timeout(7000).emit("joinAppointmentRoom", { appointmentId }, (err, result) => {
          if (!mounted || callEndedRef.current) return;
          joining = false;
          if (err || !result?.ok) { setError(result?.message || "Unable to join. Retry the call."); return; }
          setError("");
        });
      } catch (err) {
        joining = false;
        if (mounted) setError(err.response?.status === 401 ? "Your session ended. Sign in again." : "Unable to refresh the call. Retrying...");
      }
    };
    const onPresence = payload => {
      if (!mounted || !mediaReady || callEndedRef.current || payload.appointmentId !== appointmentId) return;
      setPresence({ doctorJoined: payload.doctorJoined, patientJoined: payload.patientJoined, ready: payload.ready });
      if (!payload.ready) { closePeer(); setConnectionStatus("waiting"); }
      else if (peerConnectionRef.current?.connectionState !== "connected") {
        setConnectionStatus("connecting"); offer().catch(() => setError("Unable to connect. Retry the call."));
      }
    };
    const onOffer = async payload => {
      if (role === "doctor" || !mounted || !mediaReady || callEndedRef.current || payload.appointmentId !== appointmentId) return;
      try {
        const peer = await ensurePeer();
        await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp)); await flushCandidates(peer);
        const sdp = await peer.createAnswer(); await peer.setLocalDescription(sdp);
        if (mounted) socket.emit("appointment:answer", { appointmentId, sdp });
      } catch { if (mounted) setError("Call negotiation failed. Retry the call."); }
    };
    const onAnswer = async payload => {
      const peer = peerConnectionRef.current;
      if (role !== "doctor" || payload.appointmentId !== appointmentId || !peer || peer.signalingState !== "have-local-offer") return;
      try { await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp)); await flushCandidates(peer); }
      catch { if (mounted) setError("Call negotiation failed. Retry the call."); }
    };
    const onCandidate = async payload => {
      if (!mounted || callEndedRef.current || payload.appointmentId !== appointmentId) return;
      const candidate = new RTCIceCandidate(payload.candidate), peer = peerConnectionRef.current;
      if (!peer?.remoteDescription) { pendingIceCandidatesRef.current.push(candidate); return; }
      await peer.addIceCandidate(candidate).catch(() => {});
    };
    const onEnded = payload => { if (payload.appointmentId === appointmentId) teardownCall(); };
    const onDisconnect = reason => {
      if (callEndedRef.current || !mounted) return;
      joining = false; closePeer(); setConnectionStatus("reconnecting");
      if (reason === "io server disconnect") setError("Your session or permissions changed. Sign in again.");
    };
    const onRenegotiate = payload => { if (payload.appointmentId === appointmentId) offer(true).catch(() => setError("Unable to reconnect. Retry the call.")); };
    const onChat = msg => { if (msg.appointmentId === appointmentId) setChatMessages(prev => [...prev, msg]); };
    const listeners = { connect: recover, disconnect: onDisconnect, "appointment:presence": onPresence,
      "appointment:offer": onOffer, "appointment:answer": onAnswer, "appointment:ice-candidate": onCandidate,
      "appointment:ended": onEnded, "appointment:renegotiate": onRenegotiate, "appointment:chat-message": onChat };
    for (const [event, listener] of Object.entries(listeners)) socket.on(event, listener);
    if (!socket.connected) socket.connect();
    const setup = async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera and microphone require a secure browser connection.");
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); }
      catch {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          if (mounted) { setIsCameraOff(true); setMediaNotice("Camera unavailable. Connected with audio only."); }
        } catch { throw new Error("Microphone access is required. Allow it in browser settings, then retry."); }
      }
      if (!mounted) { stream.getTracks().forEach(track => track.stop()); return; }
      localStreamRef.current = stream; mediaReady = true;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      await recover();
    };
    setup().catch(err => { if (mounted) { setError(err.message); setConnectionStatus("failed"); } });
    const interval = setInterval(recover, 10000);
    document.addEventListener("visibilitychange", recover); window.addEventListener("online", recover);
    return () => {
      mounted = false; clearInterval(interval); clearTimeout(recoveryTimer);
      socket.emit("leaveAppointmentRoom", { appointmentId });
      for (const [event, listener] of Object.entries(listeners)) socket.off(event, listener);
      document.removeEventListener("visibilitychange", recover); window.removeEventListener("online", recover);
      closePeer(); localStreamRef.current?.getTracks().forEach(track => track.stop()); localStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
    };
  }, [appointmentId, mediaAttempt, role]);

  // Speech recognition for Co-Pilot
  useEffect(() => {
    if (role !== "doctor" || !appointmentId) return undefined;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceCaptureUnavailable(true); return undefined; }

    // FIXED: On mobile the Web Speech API ignores `continuous`, so it ended after every phrase and
    // the `onend` handler restarted it instantly. Each restart replayed the system listening chime
    // ("trin trin" every few seconds) and re-grabbed the microphone, which cut the WebRTC audio and
    // made the call feel disconnected. Voice capture is a convenience feature, so it is disabled on
    // mobile instead of breaking the actual consultation audio.
    const isMobileDevice =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobileDevice) {
      setVoiceCaptureUnavailable(true);
      return undefined;
    }

    let mounted = true;
    let shouldRestart = true;
    let restartTimer = null;
    let isRunning = false;
    let consecutiveRestarts = 0;
    const MAX_CONSECUTIVE_RESTARTS = 20;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText = `${finalText} ${event.results[i][0].transcript}`.trim();
      }
      // A successful result means the session is healthy, so allow restarts again.
      if (finalText) consecutiveRestarts = 0;
      appendTranscriptText(finalText);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldRestart = false;
        setVoiceCaptureUnavailable(true);
        setCopilotActive(false);
      }
    };
    recognition.onend = () => {
      isRunning = false;
      // Never restart once the call is over, or the browser keeps holding the microphone.
      if (!mounted || !shouldRestart || callEndedRef.current) return;
      consecutiveRestarts += 1;
      if (consecutiveRestarts > MAX_CONSECUTIVE_RESTARTS) {
        // Recognition is failing in a loop (no speech service / no permission). Stop retrying
        // instead of beeping at the doctor forever.
        setVoiceCaptureUnavailable(true);
        setCopilotActive(false);
        return;
      }
      // Debounced restart, so we never spin in a tight start/end loop.
      restartTimer = setTimeout(() => {
        if (!mounted || !shouldRestart || isRunning || callEndedRef.current) return;
        try {
          recognition.start();
          isRunning = true;
        } catch { /* Browser is still releasing the previous session */ }
      }, 1500);
    };
    try {
      recognition.start();
      isRunning = true;
      setCopilotActive(true);
      setVoiceCaptureUnavailable(false);
    } catch (err) {
      console.error("Co-Pilot speech recognition failed:", err);
      setVoiceCaptureUnavailable(true);
    }
    return () => {
      mounted = false;
      shouldRestart = false;
      if (restartTimer) clearTimeout(restartTimer);
      setCopilotActive(false);
      try { recognition.abort(); } catch { /* Ignore */ }
      try { recognition.stop(); } catch { /* Ignore */ }
    };
  }, [appointmentId, role]);

  // Periodic transcript flush
  useEffect(() => {
    if (role !== "doctor" || !appointmentId) return undefined;
    const interval = setInterval(() => sendTranscriptChunk(), 30000);
    return () => clearInterval(interval);
  }, [appointmentId, role]);

  // Co-pilot socket
  useEffect(() => {
    if (role !== "doctor" || !appointmentId) return undefined;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    const handleSuggestion = ({ appointmentId: inId, suggestions = [] }) => {
      if (inId !== appointmentId) return;
      mergeSuggestions(suggestions);
    };
    socket.emit("joinCopilotSession", { appointmentId });
    socket.on("copilot:suggestion", handleSuggestion);
    axios
      .get(`${BACKEND_URL}/api/copilot/${appointmentId}/suggestions`, { withCredentials: true })
      .then((response) => mergeSuggestions(response.data.suggestions || []))
      .catch(() => {});
    return () => {
      socket.off("copilot:suggestion", handleSuggestion);
    };
  }, [appointmentId, role]);

  useEffect(() => {
    if (activeSidePanel === "reports") {
      axios.get(`${BACKEND_URL}/appointment/history`, { withCredentials: true })
        .then(res => setReports(res.data))
        .catch(console.error);
    }
  }, [activeSidePanel]);

  // Who is the remote participant
  const remoteLabel = role === "doctor" ? (patientName || "Patient") : (doctorName ? `Dr. ${doctorName}` : "Doctor");
  const selfLabel = role === "doctor" ? "You (Doctor)" : "You (Patient)";
  const remotePhoto = role === "doctor" ? patientPhoto : doctorPhoto;

  const statusColor = {
    waiting: "bg-amber-500",
    connecting: "bg-red-500 dark:bg-red-600",
    connected: "bg-green-500",
    reconnecting: "bg-orange-500",
    failed: "bg-red-500",
    ended: "bg-slate-500",
  }[connectionStatus] || "bg-gray-50 dark:bg-slate-900";

  const statusText = {
    waiting: role === "doctor" ? "Waiting for patient..." : "Waiting for doctor...",
    connecting: "Connecting...",
    connected: "Connected",
    reconnecting: "Reconnecting...",
    failed: "Connection failed",
    // FIXED: After the call ended this fell back to "Waiting for patient/doctor...".
    ended: "Call ended",
  }[connectionStatus] || connectionStatus;

  const hasEnded = connectionStatus === "ended";


  return (
    <div className="flex gap-3 xl:gap-4">
      {/* Main video area */}
      <div className="relative flex-1 min-w-0">
        {/* ── Main remote video container ── */}
        <div className="relative overflow-hidden rounded-2xl bg-slate-950 shadow-2xl" style={{ minHeight: "520px" }}>
          {/* Remote video (large) */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
            style={{ minHeight: "520px" }}
          />

          {/* Waiting overlay */}
          {!presence.ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-red-950">
              <div className="flex h-28 w-28 items-center justify-center rounded-full bg-slate-800 border-4 border-slate-700 mb-6 overflow-hidden">
                {remotePhoto ? (
                  <img src={remotePhoto} alt={remoteLabel} className="h-full w-full object-cover" />
                ) : (
                  role === "doctor" ? (
                    <User size={52} className="text-slate-400" />
                  ) : (
                    <Stethoscope size={52} className="text-slate-400" />
                  )
                )}
              </div>
              <p className="text-lg font-bold text-white">{remoteLabel}</p>
              <p className="mt-2 text-sm text-slate-400">{statusText}</p>
              {!hasEnded && (
                <div className="mt-5 flex gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-500 dark:bg-red-600 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 rounded-full bg-red-500 dark:bg-red-600 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-2 w-2 rounded-full bg-red-500 dark:bg-red-600 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              )}
            </div>
          )}

          {/* Remote participant name tag */}
          {presence.ready && (
            <div className="absolute top-4 left-4 flex items-center gap-2 rounded-xl bg-black/50 backdrop-blur-sm px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 overflow-hidden">
                {remotePhoto ? (
                  <img src={remotePhoto} alt={remoteLabel} className="h-full w-full object-cover" />
                ) : role === "doctor" ? (
                  <User size={16} className="text-slate-300" />
                ) : (
                  <Stethoscope size={16} className="text-slate-300" />
                )}
              </div>
              <div>
                <p className="text-xs font-bold text-white leading-none">{remoteLabel}</p>
              </div>
            </div>
          )}

          {/* Connection status badge */}
          <div className="absolute top-4 right-4 flex items-center gap-2 rounded-full bg-black/50 backdrop-blur-sm px-3 py-1.5">
            <span className={`h-2 w-2 rounded-full ${statusColor} ${connectionStatus === "connecting" ? "animate-pulse" : ""}`} />
            <span className="text-xs font-semibold text-white">{statusText}</span>
          </div>

          {/* Call duration */}
          {presence.ready && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 backdrop-blur-sm px-4 py-1.5">
              <span className="text-sm font-bold text-white font-mono">{formatDuration(callDuration)}</span>
            </div>
          )}

          {/* Self video — bottom right, larger */}
          <div className="absolute bottom-20 right-4 overflow-hidden rounded-xl border-2 border-white/20 shadow-2xl bg-slate-900"
            style={{ width: "180px", height: "135px" }}>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={`h-full w-full object-cover ${isCameraOff ? "opacity-0" : ""}`}
            />
            {isCameraOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
                <VideoOff size={28} className="text-slate-400" />
              </div>
            )}
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 px-2 py-1.5">
              <p className="text-xs font-bold text-white truncate">{selfLabel}</p>
            </div>
            {isMuted && (
              <div className="absolute top-2 left-2 rounded-full bg-red-500 p-1">
                <MicOff size={10} className="text-white" />
              </div>
            )}
          </div>

          {/* Controls bar */}
          <div className="absolute bottom-4 left-2 right-2 flex flex-wrap items-center justify-center gap-2 bg-slate-900/90 dark:bg-black/90 px-2 py-2 rounded-2xl sm:bottom-6 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:flex-nowrap sm:gap-3 sm:px-6 sm:py-3 sm:rounded-full shadow-2xl backdrop-blur border border-white/10 dark:border-red-900/50">
            {/* Mute */}
            <button
              onClick={toggleMute}
              title={isMuted ? "Unmute" : "Mute"}
              className={`flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 ${isMuted ? "bg-red-500 hover:bg-red-400" : "bg-white/10 dark:bg-slate-950/10 hover:bg-white/20 dark:bg-slate-950/20 dark:bg-gray-800 dark:hover:bg-gray-700"} text-white`}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            {/* Camera */}
            <button
              onClick={toggleCamera}
              title={isCameraOff ? "Turn on camera" : "Turn off camera"}
              className={`flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 ${isCameraOff ? "bg-red-500 hover:bg-red-400" : "bg-white/10 dark:bg-slate-950/10 hover:bg-white/20 dark:bg-slate-950/20 dark:bg-gray-800 dark:hover:bg-gray-700"} text-white`}
            >
              {isCameraOff ? <VideoOff size={20} /> : <Video size={20} />}
            </button>

            {/* End call */}
            <button
              onClick={endCall} disabled={ending}
              title={role === "doctor" ? "End consultation" : "Leave call"} aria-label={role === "doctor" ? "End consultation" : "Leave call"}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-500 transition-all duration-200 text-white shadow-lg shadow-red-600/40"
            >
              <PhoneOff size={24} />
            </button>

            {/* Co-Pilot toggle (doctor only) */}
            {role === "doctor" && (
              <button
                onClick={() => setActiveSidePanel((c) => c === "copilot" ? null : "copilot")}
                title="Toggle AI Co-Pilot"
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 ${activeSidePanel === "copilot" ? "bg-red-500 dark:bg-red-600 hover:bg-blue-400" : "bg-white/10 dark:bg-slate-950/10 hover:bg-white/20 dark:bg-slate-950/20 dark:bg-gray-800 dark:hover:bg-gray-700"} text-white relative`}
              >
                <BrainCircuit size={20} />
                {copilotSuggestions.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                    {copilotSuggestions.length > 9 ? "9+" : copilotSuggestions.length}
                  </span>
                )}
              </button>
            )}

            {/* Chat */}
            <button
              onClick={() => setActiveSidePanel((c) => c === "chat" ? null : "chat")}
              title="Toggle Chat"
              className={`flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 ${activeSidePanel === "chat" ? "bg-red-500 dark:bg-red-600 hover:bg-blue-400" : "bg-white/10 dark:bg-slate-950/10 hover:bg-white/20 dark:bg-slate-950/20 dark:bg-gray-800 dark:hover:bg-gray-700"} text-white`}
            >
              <MessageSquare size={20} />
            </button>

            {/* Reports */}
            <button
              onClick={() => setActiveSidePanel((c) => c === "reports" ? null : "reports")}
              title="Toggle Reports"
              className={`flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 ${activeSidePanel === "reports" ? "bg-red-500 dark:bg-red-600 hover:bg-blue-400" : "bg-white/10 dark:bg-slate-950/10 hover:bg-white/20 dark:bg-slate-950/20 dark:bg-gray-800 dark:hover:bg-gray-700"} text-white`}
            >
              <FileText size={20} />
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p role="alert">{error}</p>
            {!hasEnded && <button type="button" onClick={() => setMediaAttempt(value => value + 1)} className="mt-2 rounded border border-red-700 px-3 py-2 font-semibold">Retry call</button>}
          </div>
        )}

        {mediaNotice && !hasEnded && <p className="mt-3 text-sm text-amber-800" role="status">{mediaNotice}</p>}
        {relayNotice && !hasEnded && <p className="mt-3 text-sm text-amber-800" role="status">{relayNotice}</p>}

        {/* Presence indicator */}
        {!presence.ready && !hasEnded && (
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <strong>{role === "doctor" ? "Patient" : "Doctor"}</strong> has not joined yet. The call will start automatically once both participants are in the room.
          </div>
        )}
      </div>

      {/* Side Panels */}
      {activeSidePanel && (
        <div className="flex flex-col w-full xl:w-96 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xl overflow-hidden h-full" style={{ maxHeight: "calc(100vh - 100px)" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950">
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 capitalize">
              {activeSidePanel === "copilot" ? "AI Co-Pilot" : activeSidePanel}
            </h2>
            <button onClick={() => setActiveSidePanel(null)} className="p-1 text-gray-500 hover:bg-gray-200 dark:hover:bg-slate-800 rounded-md">
              <X size={16} />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {activeSidePanel === "copilot" && role === "doctor" && (
              <CoPilotSidebar
                collapsed={false}
                isActive={copilotActive}
                onToggle={() => setActiveSidePanel(null)}
                suggestions={copilotSuggestions}
                voiceUnavailable={voiceCaptureUnavailable}
              />
            )}
            
            {activeSidePanel === "chat" && (
              <div className="flex flex-col h-full">
                <div className="flex-1 p-4 space-y-3 overflow-y-auto">
                  {chatMessages.length === 0 ? (
                    <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-10">No messages yet. Start chatting!</p>
                  ) : (
                    chatMessages.map((msg, i) => (
                      <div key={i} className={`flex flex-col ${msg.senderId === user?.id ? "items-end" : "items-start"}`}>
                        <div className={`px-3 py-2 rounded-xl text-sm ${msg.senderId === user?.id ? "bg-red-600 dark:bg-red-700 text-white" : "bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white"}`}>
                          {msg.text}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="p-3 border-t border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <div className="flex items-center gap-2">
                    <input 
                      type="text" 
                      value={chatInput} 
                      onChange={(e) => setChatInput(e.target.value)} 
                      placeholder="Type a message..." 
                      className="flex-1 bg-gray-100 dark:bg-slate-800 border-none rounded-full px-4 py-2 text-sm text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && chatInput.trim()) {
                          const socket = getSocket();
                          const msg = { appointmentId, text: chatInput.trim(), senderId: user?.id || role };
                          socket.emit("appointment:chat-message", msg);
                          setChatMessages(prev => [...prev, msg]);
                          setChatInput("");
                        }
                      }}
                    />
                    <button 
                      onClick={() => {
                        if (chatInput.trim()) {
                          const socket = getSocket();
                          const msg = { appointmentId, text: chatInput.trim(), senderId: user?.id || role };
                          socket.emit("appointment:chat-message", msg);
                          setChatMessages(prev => [...prev, msg]);
                          setChatInput("");
                        }
                      }}
                      className="p-2 bg-red-600 dark:bg-red-700 text-white rounded-full hover:bg-blue-700"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {activeSidePanel === "reports" && (
              <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-900">
                <div className="p-2 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">Shared Medical Reports</span>
                  <button onClick={() => setIsFullscreen(true)} className="px-2 py-1 bg-slate-600 text-white rounded hover:bg-slate-700">Full Screen</button>
                </div>
                <div className="p-2 border-b border-gray-200 dark:border-red-900/40 overflow-x-auto whitespace-nowrap">
                   {reports.map(r => (
                     <button key={r._id} onClick={() => setSelectedReportUrl(r.fileUrl)} className={`px-3 py-1 text-xs border rounded mr-2 ${selectedReportUrl === r.fileUrl ? 'bg-red-100 border-red-500' : 'bg-white dark:bg-slate-950 text-gray-800 dark:text-slate-200'}`}>
                        {r.title}
                     </button>
                   ))}
                   {reports.length === 0 && <span className="text-xs text-gray-500">No reports found</span>}
                </div>
                <div className="flex-1 w-full relative">
                  {selectedReportUrl ? (
                    <iframe 
                      src={selectedReportUrl} 
                      title="Medical Report" 
                      className="w-full h-full border-0" 
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm text-gray-400">Select a report to view</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isFullscreen && selectedReportUrl && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col">
          <div className="flex justify-end p-4">
            <button onClick={() => setIsFullscreen(false)} className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-red-700">
              <X size={20} /> Close Full Screen
            </button>
          </div>
          <div className="flex-1 w-full p-4 pt-0">
            <iframe src={selectedReportUrl} className="w-full h-full border-0 bg-white dark:bg-slate-950 rounded-lg" />
          </div>
        </div>
      )}

    </div>
  );
};

export default AppointmentVideoCall;

