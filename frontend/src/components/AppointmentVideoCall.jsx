import { useEffect, useRef, useState } from "react";
import { getSocket } from "../socket";

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

const AppointmentVideoCall = ({ appointmentId, onConsentDetected }) => {
  const peerConnectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [error, setError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [consentStatus, setConsentStatus] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("Waiting for the other participant");

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
      
      setIsRecording(true);
      
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

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
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
  );
};

export default AppointmentVideoCall;
