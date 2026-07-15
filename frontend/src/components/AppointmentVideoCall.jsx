/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { getSocket } from "../socket";
import { BACKEND_URL } from "../utils";
import CoPilotSidebar from "./CoPilotSidebar";
import SoapNoteModal from "./SoapNoteModal";

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
        if (!response.ok) {
          throw new Error(`Metered TURN request failed with status ${response.status}`);
        }
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
  return {
    iceServers: meteredIceServers || getStaticIceServers(),
  };
};

const CONSENT_KEYWORDS = ["yes", "i consent", "i agree", "agree", "consent", "i do"];
const MED_KEYWORDS = [
  "aspirin",
  "ibuprofen",
  "paracetamol",
  "acetaminophen",
  "metformin",
  "insulin",
  "warfarin",
  "atorvastatin",
  "amoxicillin",
  "azithromycin",
  "omeprazole",
  "amlodipine",
];
const SYMPTOM_KEYWORDS = [
  "chest pain",
  "chest tightness",
  "left arm pain",
  "jaw pain",
  "severe headache",
  "vision changes",
  "difficulty breathing",
  "shortness of breath",
  "lip swelling",
  "high fever",
  "stiff neck",
  "dizziness",
  "vomiting",
  "abdominal pain",
];

const AppointmentVideoCall = ({
  appointmentId,
  doctorNotes = "",
  onConsentDetected,
  onSoapSaved,
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
  const [connectionStatus, setConnectionStatus] = useState("Waiting for the other participant");
  const [copilotActive, setCopilotActive] = useState(false);
  const [copilotCollapsed, setCopilotCollapsed] = useState(false);
  const [copilotSuggestions, setCopilotSuggestions] = useState([]);
  const [isGeneratingSoap, setIsGeneratingSoap] = useState(false);
  const [showSoapModal, setShowSoapModal] = useState(false);
  const [soapNote, setSoapNote] = useState(null);
  const [voiceCaptureUnavailable, setVoiceCaptureUnavailable] = useState(false);

  const appendTranscriptText = (text) => {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;

    transcriptBufferRef.current = `${transcriptBufferRef.current} ${cleanText}`.trim();
    fullTranscriptRef.current = `${fullTranscriptRef.current} ${cleanText}`.trim();

    const lower = cleanText.toLowerCase();
    MED_KEYWORDS.forEach((keyword) => {
      if (lower.includes(keyword) && !mentionedMedsRef.current.includes(keyword)) {
        mentionedMedsRef.current.push(keyword);
      }
    });
    SYMPTOM_KEYWORDS.forEach((keyword) => {
      if (lower.includes(keyword) && !mentionedSymptomsRef.current.includes(keyword)) {
        mentionedSymptomsRef.current.push(keyword);
      }
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
    if (incoming.some((item) => item.severity === "high")) {
      setCopilotCollapsed(false);
    }
  };

  const sendTranscriptChunk = async () => {
    if (role !== "doctor" || !appointmentId) return;
    const chunk = transcriptBufferRef.current.trim();
    if (!chunk) return;

    transcriptBufferRef.current = "";
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/copilot/${appointmentId}/analyze`,
        {
          transcriptChunk: chunk,
          isFirstChunk: firstChunkRef.current,
          allMentionedMeds: mentionedMedsRef.current,
          allMentionedSymptoms: mentionedSymptomsRef.current,
        },
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
      try {
        await connection.addIceCandidate(candidate);
      } catch (err) {
        console.error("Failed to add queued ICE candidate:", err);
      }
    }
  };

  const ensurePeerConnection = async (socket) => {
    if (peerConnectionRef.current) return peerConnectionRef.current;

    const connection = new RTCPeerConnection(await getRtcConfig());
    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit("appointment:ice-candidate", {
        appointmentId,
        candidate: event.candidate,
      });
    };
    connection.ontrack = (event) => {
      const stream = event.streams?.[0] || remoteStreamRef.current || new MediaStream();
      if (!event.streams?.[0]) {
        stream.addTrack(event.track);
      }
      remoteStreamRef.current = stream;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(() => {});
      }
      setConnectionStatus("Remote video connected");
    };
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (state === "connected") setConnectionStatus("Connected");
      if (state === "connecting") setConnectionStatus("Connecting video");
      if (state === "disconnected") setConnectionStatus("Reconnecting video");
      if (state === "failed") {
        setConnectionStatus("Video connection failed. A TURN server may be required.");
      }
    };

    const localStream = localStreamRef.current;
    if (localStream) {
      localStream.getTracks().forEach((track) => connection.addTrack(track, localStream));
    }

    peerConnectionRef.current = connection;
    return connection;
  };

  const startVoiceRecording = () => {
    if (!localStreamRef.current) return;
    
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(localStreamRef.current);
      const scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);
      
      analyser.smoothingTimeConstant = 0.8;
      analyser.fftSize = 1024;
      
      microphone.connect(analyser);
      analyser.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      
      scriptProcessor.onaudioprocess = () => {
        analyser.getByteFrequencyData(buffer);
        const average = buffer.reduce((a, b) => a + b) / buffer.length;
        
        if (average > 30) {
          detectVoiceConsent();
        }
      };
      
      return () => {
        scriptProcessor.disconnect();
        analyser.disconnect();
        microphone.disconnect();
      };
    } catch (err) {
      console.error("Voice recording setup error:", err);
    }
  };

  const detectVoiceConsent = async () => {
    if (consentStatus === "detected") return;
    
    try {
      const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      recognition.continuous = false;
      recognition.interimResults = false;
      
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.toLowerCase().trim();
        const hasConsent = CONSENT_KEYWORDS.some(keyword => transcript.includes(keyword));
        
        if (hasConsent) {
          setConsentStatus("detected");
          if (onConsentDetected) {
            onConsentDetected({
              detected: true,
              keywords: transcript.split(" "),
              timestamp: new Date(),
            });
          }
        }
      };
      
      recognition.onerror = () => {
        // Silent error handling for consent detection
      };
      
      recognition.start();
    } catch (err) {
      console.error("Voice recognition error:", err);
    }
  };

  const createOffer = async (socket) => {
    const connection = await ensurePeerConnection(socket);
    if (connection.signalingState !== "stable") return;
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    socket.emit("appointment:offer", { appointmentId, sdp: offer });
    startVoiceRecording();
  };

  useEffect(() => {
    let mounted = true;
    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
    }

    const setupMedia = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      if (!mounted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    };

    const onPeerJoined = async ({ appointmentId: incomingId }) => {
      if (incomingId !== appointmentId) return;
      await createOffer(socket);
    };

    const onOffer = async ({ appointmentId: incomingId, sdp }) => {
      if (incomingId !== appointmentId) return;
      const connection = await ensurePeerConnection(socket);
      await connection.setRemoteDescription(new RTCSessionDescription(sdp));
      await flushPendingIceCandidates(connection);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      socket.emit("appointment:answer", { appointmentId, sdp: answer });
    };

    const onAnswer = async ({ appointmentId: incomingId, sdp }) => {
      if (incomingId !== appointmentId || !peerConnectionRef.current) return;
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      await flushPendingIceCandidates(peerConnectionRef.current);
    };

    const onIceCandidate = async ({ appointmentId: incomingId, candidate }) => {
      if (incomingId !== appointmentId || !peerConnectionRef.current) return;
      const iceCandidate = new RTCIceCandidate(candidate);
      if (!peerConnectionRef.current.remoteDescription) {
        pendingIceCandidatesRef.current.push(iceCandidate);
        return;
      }
      try {
        await peerConnectionRef.current.addIceCandidate(iceCandidate);
      } catch (err) {
        console.error("Failed to add ICE candidate:", err);
      }
    };

    const onCallEnded = ({ appointmentId: incomingId }) => {
      if (incomingId !== appointmentId) return;
      const localStream = localStreamRef.current;
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      pendingIceCandidatesRef.current = [];
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    };

    socket.on("appointment:peer-joined", onPeerJoined);
    socket.on("appointment:offer", onOffer);
    socket.on("appointment:answer", onAnswer);
    socket.on("appointment:ice-candidate", onIceCandidate);
    socket.on("appointment:ended", onCallEnded);

    setupMedia()
      .then(() => {
        socket.emit("joinAppointmentRoom", { appointmentId }, (response) => {
          if (!response?.ok) {
            setError(response?.message || "Unable to join appointment room");
          }
        });
      })
      .catch(() => {
        setError("Camera or microphone permission is required for this call");
      });

    return () => {
      mounted = false;
      socket.emit("leaveAppointmentRoom", { appointmentId });
      socket.off("appointment:peer-joined", onPeerJoined);
      socket.off("appointment:offer", onOffer);
      socket.off("appointment:answer", onAnswer);
      socket.off("appointment:ice-candidate", onIceCandidate);
      socket.off("appointment:ended", onCallEnded);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      remoteStreamRef.current = null;
      pendingIceCandidatesRef.current = [];
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
  }, [appointmentId]);

  useEffect(() => {
    if (role !== "doctor" || !appointmentId) return undefined;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceCaptureUnavailable(true);
      return undefined;
    }

    let mounted = true;
    let shouldRestart = true;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onresult = (event) => {
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) {
          finalText = `${finalText} ${event.results[index][0].transcript}`.trim();
        }
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
      try {
        recognition.start();
      } catch {
        // Browser may already be restarting recognition.
      }
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
      try {
        recognition.stop();
      } catch {
        // Ignore browser stop race.
      }
    };
  }, [appointmentId, role]);

  useEffect(() => {
    if (role !== "doctor" || !appointmentId) return undefined;
    const interval = setInterval(() => {
      sendTranscriptChunk();
    }, 30000);

    return () => clearInterval(interval);
  }, [appointmentId, role]);

  useEffect(() => {
    if (role !== "doctor" || !appointmentId) return undefined;
    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
    }

    const handleSuggestion = ({ appointmentId: incomingId, suggestions = [] }) => {
      if (incomingId !== appointmentId) return;
      mergeSuggestions(suggestions);
    };

    const handleSoapReady = ({ appointmentId: incomingId, soapNote: incomingSoap }) => {
      if (incomingId !== appointmentId) return;
      setSoapNote(incomingSoap);
      setShowSoapModal(true);
    };

    socket.emit("joinCopilotSession", { appointmentId });
    socket.on("copilot:suggestion", handleSuggestion);
    socket.on("copilot:soap-ready", handleSoapReady);

    axios
      .get(`${BACKEND_URL}/api/copilot/${appointmentId}/suggestions`, {
        withCredentials: true,
      })
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

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-black">
              <video ref={remoteVideoRef} autoPlay playsInline className="h-60 w-full object-cover" />
              <div className="bg-gray-900 px-3 py-2 text-xs text-gray-100">{connectionStatus}</div>
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-black">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="h-60 w-full object-cover"
              />
              <div className="bg-gray-900 px-3 py-2 text-xs text-gray-100">Your video</div>
            </div>
          </div>
        </div>
        {role === "doctor" && (
          <CoPilotSidebar
            collapsed={copilotCollapsed}
            isActive={copilotActive}
            isGenerating={isGeneratingSoap}
            onGenerateSoap={handleGenerateSoap}
            onToggle={() => setCopilotCollapsed((current) => !current)}
            suggestions={copilotSuggestions}
            voiceUnavailable={voiceCaptureUnavailable}
          />
        )}
      </div>
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
