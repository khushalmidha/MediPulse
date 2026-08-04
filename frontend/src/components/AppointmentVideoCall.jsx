/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { getSocket } from "../socket";
import { BACKEND_URL } from "../utils";
import CoPilotSidebar from "./CoPilotSidebar";
import SoapNoteModal from "./SoapNoteModal";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Maximize2, MessageSquare, Settings,
  User, Stethoscope, Wifi, WifiOff, MonitorUp,
} from "lucide-react";

const getStaticIceServers = () => {
  const servers = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  const turnUrls = (import.meta.env.VITE_TURN_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  if (turnUrls.length) {
    servers.push({
      urls: turnUrls,
      username: import.meta.env.VITE_TURN_USERNAME || undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL || undefined,
    });
  }

  return servers;
};

let meteredIceServersPromise = null;

const fetchMeteredIceServers = async () => {
  const meteredApp = import.meta.env.VITE_METERED_TURN_APP || "";
  const meteredApiKey = import.meta.env.VITE_METERED_TURN_API_KEY || "";
  const meteredUrl =
    import.meta.env.VITE_METERED_TURN_URL ||
    (meteredApp && meteredApiKey
      ? `https://${meteredApp}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredApiKey)}`
      : "");

  if (!meteredUrl) return null;

  if (!meteredIceServersPromise) {
    meteredIceServersPromise = fetch(meteredUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Metered TURN request failed: ${response.status}`);
        return response.json();
      })
      .then((iceServers) => (Array.isArray(iceServers) && iceServers.length ? iceServers : null))
      .catch((err) => {
        console.error("Metered TURN credentials error:", err);
        return null;
      });
  }

  return meteredIceServersPromise;
};

const getRtcConfig = async () => {
  const meteredIceServers = await fetchMeteredIceServers();
  return { iceServers: meteredIceServers || getStaticIceServers() };
};

const CONSENT_KEYWORDS = ["yes", "i consent", "i agree", "agree", "consent", "i do"];
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
  doctorNotes = "",
  onConsentDetected,
  onSoapSaved,
  doctorName = "",
  patientName = "",
  doctorPhoto = "",
  patientPhoto = "",
  onCallEnd,
}) => {
  const { role } = useAuth();
  const peerConnectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const transcriptBufferRef = useRef("");
  const fullTranscriptRef = useRef("");
  const mentionedMedsRef = useRef([]);
  const mentionedSymptomsRef = useRef([]);
  const firstChunkRef = useRef(true);

  const [error, setError] = useState("");
  const [consentStatus, setConsentStatus] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("waiting");
  const [presence, setPresence] = useState({ doctorJoined: false, patientJoined: false, ready: false });
  const [copilotActive, setCopilotActive] = useState(false);
  const [copilotCollapsed, setCopilotCollapsed] = useState(false);
  const [copilotSuggestions, setCopilotSuggestions] = useState([]);
  const [isGeneratingSoap, setIsGeneratingSoap] = useState(false);
  const [showSoapModal, setShowSoapModal] = useState(false);
  const [soapNote, setSoapNote] = useState(null);
  const [voiceCaptureUnavailable, setVoiceCaptureUnavailable] = useState(false);

  // UI controls state
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callStartedAt, setCallStartedAt] = useState(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  // Call duration timer
  useEffect(() => {
    if (!presence.ready) return;
    setCallStartedAt(Date.now());
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

  const endCall = () => {
    const socket = getSocket();
    socket.emit("appointment:end", { appointmentId });
    if (onCallEnd) onCallEnd();
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
    if (incoming.some((item) => item.severity === "high")) setCopilotCollapsed(false);
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

  const handleGenerateSoap = async () => {
    await sendTranscriptChunk();
    setIsGeneratingSoap(true);
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/copilot/${appointmentId}/generate-soap`,
        { doctorNotes },
        { withCredentials: true },
      );
      setSoapNote(response.data.soapNote);
      setShowSoapModal(true);
    } catch (err) {
      console.error("SOAP generation failed:", err);
      setError("Could not generate SOAP note right now");
    } finally {
      setIsGeneratingSoap(false);
    }
  };

  const flushPendingIceCandidates = async (connection) => {
    if (!connection.remoteDescription) return;
    const candidates = pendingIceCandidatesRef.current.splice(0);
    for (const candidate of candidates) {
      try { await connection.addIceCandidate(candidate); }
      catch (err) { console.error("Failed to add queued ICE candidate:", err); }
    }
  };

  const ensurePeerConnection = async (socket) => {
    if (peerConnectionRef.current) return peerConnectionRef.current;
    const connection = new RTCPeerConnection(await getRtcConfig());
    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit("appointment:ice-candidate", { appointmentId, candidate: event.candidate });
    };
    connection.ontrack = (event) => {
      const stream = event.streams?.[0] || remoteStreamRef.current || new MediaStream();
      if (!event.streams?.[0]) stream.addTrack(event.track);
      remoteStreamRef.current = stream;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(() => {});
      }
      setHasRemoteVideo(true);
      setConnectionStatus("connected");
    };
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (state === "connected") setConnectionStatus("connected");
      if (state === "connecting") setConnectionStatus("connecting");
      if (state === "disconnected") setConnectionStatus("reconnecting");
      if (state === "failed") setConnectionStatus("failed");
    };
    const localStream = localStreamRef.current;
    if (localStream) localStream.getTracks().forEach((track) => connection.addTrack(track, localStream));
    peerConnectionRef.current = connection;
    return connection;
  };

  const createOffer = async (socket) => {
    if (role !== "doctor") return;
    const connection = await ensurePeerConnection(socket);
    if (connection.signalingState !== "stable") return;
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    socket.emit("appointment:offer", { appointmentId, sdp: offer });
  };

  useEffect(() => {
    let mounted = true;
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const setupMedia = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    };

    const onPresence = async ({ appointmentId: inId, doctorJoined, patientJoined, ready }) => {
      if (inId !== appointmentId) return;
      setPresence({ doctorJoined, patientJoined, ready });
      if (!ready) { setConnectionStatus("waiting"); return; }
      setConnectionStatus("connecting");
      if (role === "doctor") await createOffer(socket);
    };

    const onPeerJoined = async ({ appointmentId: inId, ready }) => {
      if (inId !== appointmentId || !ready) return;
      await createOffer(socket);
    };

    const onOffer = async ({ appointmentId: inId, sdp }) => {
      if (inId !== appointmentId) return;
      const connection = await ensurePeerConnection(socket);
      await connection.setRemoteDescription(new RTCSessionDescription(sdp));
      await flushPendingIceCandidates(connection);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      socket.emit("appointment:answer", { appointmentId, sdp: answer });
    };

    const onAnswer = async ({ appointmentId: inId, sdp }) => {
      if (inId !== appointmentId || !peerConnectionRef.current) return;
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      await flushPendingIceCandidates(peerConnectionRef.current);
    };

    const onIceCandidate = async ({ appointmentId: inId, candidate }) => {
      if (inId !== appointmentId || !peerConnectionRef.current) return;
      const iceCandidate = new RTCIceCandidate(candidate);
      if (!peerConnectionRef.current.remoteDescription) {
        pendingIceCandidatesRef.current.push(iceCandidate);
        return;
      }
      try { await peerConnectionRef.current.addIceCandidate(iceCandidate); }
      catch (err) { console.error("Failed to add ICE candidate:", err); }
    };

    const onCallEnded = ({ appointmentId: inId }) => {
      if (inId !== appointmentId) return;
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      pendingIceCandidatesRef.current = [];
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      if (peerConnectionRef.current) { peerConnectionRef.current.close(); peerConnectionRef.current = null; }
    };

    socket.on("appointment:peer-joined", onPeerJoined);
    socket.on("appointment:presence", onPresence);
    socket.on("appointment:offer", onOffer);
    socket.on("appointment:answer", onAnswer);
    socket.on("appointment:ice-candidate", onIceCandidate);
    socket.on("appointment:ended", onCallEnded);

    setupMedia()
      .then(() => {
        socket.emit("joinAppointmentRoom", { appointmentId }, (response) => {
          if (!response?.ok) { setError(response?.message || "Unable to join appointment room"); return; }
          setPresence({ doctorJoined: Boolean(response.doctorJoined), patientJoined: Boolean(response.patientJoined), ready: Boolean(response.ready) });
          setConnectionStatus(response.ready ? "connecting" : "waiting");
        });
      })
      .catch(() => setError("Camera or microphone permission is required for this call"));

    return () => {
      mounted = false;
      socket.emit("leaveAppointmentRoom", { appointmentId });
      socket.off("appointment:peer-joined", onPeerJoined);
      socket.off("appointment:presence", onPresence);
      socket.off("appointment:offer", onOffer);
      socket.off("appointment:answer", onAnswer);
      socket.off("appointment:ice-candidate", onIceCandidate);
      socket.off("appointment:ended", onCallEnded);
      if (peerConnectionRef.current) { peerConnectionRef.current.close(); peerConnectionRef.current = null; }
      if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null; }
      remoteStreamRef.current = null;
      pendingIceCandidatesRef.current = [];
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
  }, [appointmentId]);

  // Speech recognition for Co-Pilot
  useEffect(() => {
    if (role !== "doctor" || !appointmentId) return undefined;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceCaptureUnavailable(true); return undefined; }
    let mounted = true;
    let shouldRestart = true;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText = `${finalText} ${event.results[i][0].transcript}`.trim();
      }
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
      if (!mounted || !shouldRestart) return;
      try { recognition.start(); } catch { /* Browser restarting */ }
    };
    try {
      recognition.start();
      setCopilotActive(true);
      setVoiceCaptureUnavailable(false);
    } catch (err) {
      console.error("Co-Pilot speech recognition failed:", err);
      setVoiceCaptureUnavailable(true);
    }
    return () => {
      mounted = false;
      shouldRestart = false;
      setCopilotActive(false);
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
    const handleSoapReady = ({ appointmentId: inId, soapNote: incomingSoap }) => {
      if (inId !== appointmentId) return;
      setSoapNote(incomingSoap);
      setShowSoapModal(true);
    };
    socket.emit("joinCopilotSession", { appointmentId });
    socket.on("copilot:suggestion", handleSuggestion);
    socket.on("copilot:soap-ready", handleSoapReady);
    axios
      .get(`${BACKEND_URL}/api/copilot/${appointmentId}/suggestions`, { withCredentials: true })
      .then((response) => {
        mergeSuggestions(response.data.suggestions || []);
        if (response.data.soapNote) setSoapNote(response.data.soapNote);
      })
      .catch(() => {});
    return () => {
      socket.off("copilot:suggestion", handleSuggestion);
      socket.off("copilot:soap-ready", handleSoapReady);
    };
  }, [appointmentId, role]);

  // Who is the remote participant
  const remoteLabel = role === "doctor" ? (patientName || "Patient") : (doctorName ? `Dr. ${doctorName}` : "Doctor");
  const selfLabel = role === "doctor" ? "You (Doctor)" : "You (Patient)";
  const remotePhoto = role === "doctor" ? patientPhoto : doctorPhoto;

  const statusColor = {
    waiting: "bg-amber-500",
    connecting: "bg-blue-500",
    connected: "bg-green-500",
    reconnecting: "bg-orange-500",
    failed: "bg-red-500",
  }[connectionStatus] || "bg-gray-500";

  const statusText = {
    waiting: role === "doctor" ? "Waiting for patient..." : "Waiting for doctor...",
    connecting: "Connecting...",
    connected: "Connected",
    reconnecting: "Reconnecting...",
    failed: "Connection failed",
  }[connectionStatus] || connectionStatus;

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
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950">
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
              <div className="mt-5 flex gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
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
          <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-6 py-4">
            {/* Mute */}
            <button
              onClick={toggleMute}
              title={isMuted ? "Unmute" : "Mute"}
              className={`flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 ${isMuted ? "bg-red-500 hover:bg-red-400" : "bg-white/20 hover:bg-white/30"} backdrop-blur text-white`}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            {/* Camera */}
            <button
              onClick={toggleCamera}
              title={isCameraOff ? "Turn on camera" : "Turn off camera"}
              className={`flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 ${isCameraOff ? "bg-red-500 hover:bg-red-400" : "bg-white/20 hover:bg-white/30"} backdrop-blur text-white`}
            >
              {isCameraOff ? <VideoOff size={20} /> : <Video size={20} />}
            </button>

            {/* End call */}
            <button
              onClick={endCall}
              title="End call"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-500 transition-all duration-200 text-white shadow-lg shadow-red-600/40"
            >
              <PhoneOff size={24} />
            </button>

            {/* Co-Pilot toggle (doctor only) */}
            {role === "doctor" && (
              <button
                onClick={() => setCopilotCollapsed((c) => !c)}
                title="Toggle AI Co-Pilot"
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 ${copilotActive ? "bg-blue-500 hover:bg-blue-400" : "bg-white/20 hover:bg-white/30"} backdrop-blur text-white relative`}
              >
                <MessageSquare size={20} />
                {copilotSuggestions.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                    {copilotSuggestions.length > 9 ? "9+" : copilotSuggestions.length}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Presence indicator */}
        {!presence.ready && (
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <strong>{role === "doctor" ? "Patient" : "Doctor"}</strong> has not joined yet. The call will start automatically once both participants are in the room.
          </div>
        )}
      </div>

      {/* Co-Pilot sidebar (doctor only) */}
      {role === "doctor" && (
        <CoPilotSidebar
          collapsed={copilotCollapsed}
          isActive={copilotActive}
          isGenerating={isGeneratingSoap}
          onGenerateSoap={handleGenerateSoap}
          onToggle={() => setCopilotCollapsed((c) => !c)}
          suggestions={copilotSuggestions}
          voiceUnavailable={voiceCaptureUnavailable}
        />
      )}

      {showSoapModal && (
        <SoapNoteModal
          appointmentId={appointmentId}
          onClose={() => setShowSoapModal(false)}
          onSaved={(savedSoap) => {
            setSoapNote(savedSoap);
            onSoapSaved?.(savedSoap);
          }}
          soapNote={soapNote}
        />
      )}
    </div>
  );
};

export default AppointmentVideoCall;
