import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "../utils";
import { getSocket } from "../socket";

export default function useConsultationMedia(appointmentId, role, onLeave) {
  const localVideo = useRef(null), remoteVideo = useRef(null), stream = useRef(null), remoteStream = useRef(null);
  const attachLocalVideo = useCallback(node => { localVideo.current = node; if (node && stream.current) { node.srcObject = stream.current; node.play().catch(() => {}); } }, []);
  const attachRemoteVideo = useCallback(node => { remoteVideo.current = node; if (node) node.srcObject = remoteStream.current; }, []);
  const stopRef = useRef(() => {}), negotiateRef = useRef(() => {}), announceRef = useRef(() => {});
  const callback = useRef(onLeave), intent = useRef({ muted: false, cameraOff: false }), alive = useRef(false);
  callback.current = onLeave;
  const [attempt, setAttempt] = useState(0), [status, setStatus] = useState("preparing");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [relayNotice, setRelayNotice] = useState("");
  const [visit, setVisit] = useState(null), [ready, setReady] = useState(false), [deviceBusy, setDeviceBusy] = useState(false);
  const [muted, setMuted] = useState(false), [cameraOff, setCameraOff] = useState(false), [remoteMedia, setRemoteMedia] = useState(null);
  const [messages, setMessages] = useState([]), [chatNotice, setChatNotice] = useState("");
  useEffect(() => {
    let mounted = true, ended = false, mediaReady = false, joining = false, negotiating = false, generation = 0, retries = 0;
    let peer = null, peerPromise = null, candidates = [], recoveryTimer, negotiationTimer;
    const socket = getSocket(), abort = new AbortController();
    alive.current = true; setStatus("preparing"); setError(""); setNotice(""); setRelayNotice(""); setReady(false); setRemoteMedia(null);
    const current = () => mounted && !ended;
    const request = path => axios.get(BACKEND_URL + path, { withCredentials: true, signal: abort.signal, timeout: 12000 });
    function closePeer() {
      generation++; peerPromise = null; candidates = []; clearTimeout(negotiationTimer);
      if (peer) { peer.onicecandidate = null; peer.ontrack = null; peer.onconnectionstatechange = null; peer.close(); }
      peer = null; remoteStream.current = null; if (remoteVideo.current) remoteVideo.current.srcObject = null;
    }
    function disposeMedia() {
      stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
      if (localVideo.current) localVideo.current.srcObject = null;
    }
    function stop(reason = "left") {
      if (!current()) return;
      ended = true; clearTimeout(recoveryTimer); closePeer(); disposeMedia(); abort.abort();
      setReady(false); setStatus("ended"); socket.emit("leaveAppointmentRoom", { appointmentId }); callback.current?.(reason);
    }
    stopRef.current = stop;
    function announce() { if (current() && mediaReady && socket.connected) socket.emit("appointment:media-state", { appointmentId, ...intent.current }); }
    announceRef.current = announce;
    async function ensurePeer() {
      if (peer) return peer;
      if (peerPromise) return peerPromise;
      const version = generation;
      const pending = (async () => {
        const { data } = await request(`/appointment/${appointmentId}/call-credentials`);
        if (!current() || version !== generation) throw new Error("Connection changed");
        setRelayNotice(data.relayConfigured ? "" : "A relay is unavailable. Some networks may prevent this call.");
        const connection = new RTCPeerConnection({ iceServers: data.iceServers }); peer = connection;
        stream.current?.getTracks().forEach(track => connection.addTrack(track, stream.current));
        connection.onicecandidate = event => { if (current() && peer === connection && event.candidate) socket.emit("appointment:ice-candidate", { appointmentId, candidate: event.candidate }); };
        connection.ontrack = event => {
          if (!current() || peer !== connection) return;
          const remote = event.streams?.[0] || remoteVideo.current?.srcObject || new MediaStream();
          if (!event.streams?.[0]) remote.addTrack(event.track);
          remoteStream.current = remote;
          if (remoteVideo.current) {
            const video = remoteVideo.current; if (video.srcObject !== remote) video.srcObject = remote;
            video.play().catch(() => { if (current() && video.paused) setNotice("Press Play audio to hear the other participant."); });
          }
        };
        connection.onconnectionstatechange = () => {
          if (!current() || peer !== connection) return;
          if (connection.connectionState === "connected") { retries = 0; clearTimeout(recoveryTimer); clearTimeout(negotiationTimer); setStatus("connected"); setError(""); announce(); }
          else if (connection.connectionState === "connecting") setStatus("connecting");
          else if (["disconnected", "failed"].includes(connection.connectionState)) { setStatus("reconnecting"); scheduleRecovery(); }
        };
        return connection;
      })();
      peerPromise = pending;
      try { return await pending; } finally { if (peerPromise === pending) peerPromise = null; }
    }
    function scheduleRecovery(delay = 2000) {
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(() => {
        if (!current() || peer?.connectionState === "connected") return;
        if (++retries > 3) { setStatus("failed"); setError("Connection could not recover. Retry the call."); return; }
        closePeer(); negotiating = false; setStatus("reconnecting");
        if (role === "doctor") offer().catch(failNegotiation);
        else { socket.emit("appointment:renegotiate", { appointmentId }); scheduleRecovery(8000); }
      }, delay);
    }
    function failNegotiation(error) {
      if (!current()) return;
      if ([401, 403, 404].includes(error?.response?.status)) { stop("access-lost"); return; }
      setStatus("reconnecting"); scheduleRecovery();
    }
    async function offer() {
      if (role !== "doctor" || !current() || !mediaReady || negotiating || !socket.connected) return;
      negotiating = true;
      try {
        const connection = await ensurePeer();
        if (!current() || peer !== connection || connection.signalingState !== "stable") return;
        const sdp = await connection.createOffer();
        if (!current() || peer !== connection) return;
        await connection.setLocalDescription(sdp);
        if (!current() || peer !== connection) return;
        socket.emit("appointment:offer", { appointmentId, sdp });
        clearTimeout(negotiationTimer); negotiationTimer = setTimeout(() => { if (current() && peer === connection && connection.connectionState !== "connected") scheduleRecovery(0); }, 8000);
      } finally { negotiating = false; }
    }
    negotiateRef.current = async track => {
      if (!current()) { track?.stop(); return; }
      if (peer && track) {
        const sender = peer.getSenders().find(item => item.track?.kind === track.kind) || peer.getTransceivers().find(item => item.receiver.track.kind === track.kind)?.sender;
        if (sender) await sender.replaceTrack(track); else peer.addTrack(track, stream.current);
      }
      if (!current()) return;
      if (role === "doctor") await offer(); else socket.emit("appointment:renegotiate", { appointmentId });
      announce();
    };
    async function flush(connection) { if (!connection.remoteDescription) return; for (const item of candidates.splice(0)) { if (!current() || peer !== connection) return; await connection.addIceCandidate(item).catch(() => {}); } }
    async function recover() {
      if (!current() || !mediaReady || joining || !socket.connected) return;
      joining = true;
      try {
        const { data } = await request(`/appointment/${appointmentId}`);
        if (!current()) return;
        if (data.status !== "active" || data.visitMode === "in_person") { stop("ended"); return; }
        setVisit(data);
        socket.timeout(7000).emit("joinAppointmentRoom", { appointmentId }, (err, result) => {
          if (!current()) return;
          joining = false;
          if (err || !result?.ok) { setError(result?.message || "Unable to join. Retry the call."); return; }
          announce();
        });
      } catch (err) {
        joining = false;
        if (current() && [401, 403, 404].includes(err.response?.status)) { stop("access-lost"); return; }
        if (current()) setError("Unable to refresh the call. Retry when online.");
      }
    }
    const handlers = {
      connect: recover,
      disconnect: () => { joining = false; if (current()) { closePeer(); setStatus("reconnecting"); } },
      "appointment:presence": payload => {
        if (!current() || !mediaReady || payload.appointmentId !== appointmentId) return;
        if (!payload.ready) { closePeer(); setStatus("waiting"); setRemoteMedia(null); clearTimeout(recoveryTimer); }
        else { announce(); if (peer?.connectionState !== "connected") { setStatus("connecting"); if (role === "doctor") offer().catch(failNegotiation); else if (!peer) scheduleRecovery(8000); } }
      },
      "appointment:offer": async payload => {
        if (role === "doctor" || !current() || !mediaReady || payload.appointmentId !== appointmentId) return;
        try {
          if (peer && peer.signalingState !== "stable") closePeer();
          const connection = await ensurePeer(); if (!current() || peer !== connection) return;
          await connection.setRemoteDescription(payload.sdp); await flush(connection);
          if (!current() || peer !== connection) return;
          const sdp = await connection.createAnswer(); await connection.setLocalDescription(sdp);
          if (current() && peer === connection) socket.emit("appointment:answer", { appointmentId, sdp });
        } catch (error) { failNegotiation(error); }
      },
      "appointment:answer": async payload => {
        const connection = peer;
        if (role !== "doctor" || !current() || payload.appointmentId !== appointmentId || !connection || connection.signalingState !== "have-local-offer") return;
        try { await connection.setRemoteDescription(payload.sdp); if (current() && peer === connection) await flush(connection); } catch (error) { failNegotiation(error); }
      },
      "appointment:ice-candidate": async payload => {
        if (!current() || payload.appointmentId !== appointmentId) return;
        try { const candidate = new RTCIceCandidate(payload.candidate); if (!peer?.remoteDescription) { if (candidates.length < 128) candidates.push(candidate); } else await peer.addIceCandidate(candidate).catch(() => {}); } catch { /* Ignore malformed signaling. */ }
      },
      "appointment:ended": payload => { if (payload.appointmentId === appointmentId) stop("ended"); },
      "appointment:renegotiate": payload => { if (current() && payload.appointmentId === appointmentId && role === "doctor") { closePeer(); negotiating = false; offer().catch(failNegotiation); } },
      "appointment:media-state": payload => { if (current() && payload.appointmentId === appointmentId) setRemoteMedia({ muted: payload.muted, cameraOff: payload.cameraOff }); },
      "appointment:chat-message": payload => { if (current() && payload.appointmentId === appointmentId && typeof payload.text === "string") setMessages(items => [...items, { ...payload, own: false }].slice(-100)); },
    };
    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
    if (!socket.connected) socket.connect();
    async function setup() {
      const { data } = await request(`/appointment/${appointmentId}`);
      if (!current()) return;
      if (data.status !== "active" || data.visitMode === "in_person") throw new Error("This online consultation has not started or has already ended.");
      setVisit(data);
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera and microphone require a secure browser connection.");
      let media;
      try { media = await navigator.mediaDevices.getUserMedia({ audio: true, video: !intent.current.cameraOff }); }
      catch { try { media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); if (current()) { intent.current.cameraOff = true; setCameraOff(true); setNotice("Camera unavailable. Connected with audio only."); } } catch { throw new Error("Microphone access is required. Allow it in browser settings, then retry."); } }
      if (!current()) { media.getTracks().forEach(track => track.stop()); return; }
      media.getAudioTracks().forEach(track => { track.enabled = !intent.current.muted; });
      media.getVideoTracks().forEach(track => { track.enabled = !intent.current.cameraOff; });
      stream.current = media; mediaReady = true; setReady(true); setMuted(intent.current.muted); setCameraOff(intent.current.cameraOff || !media.getVideoTracks().length);
      if (localVideo.current) { localVideo.current.srcObject = media; localVideo.current.play().catch(() => {}); }
      await recover();
    }
    setup().catch(err => { if (current()) { setError(err.response?.status === 401 ? "Your session ended. Sign in again." : err.message || "Unable to prepare the call."); setStatus("failed"); } });
    const interval = setInterval(recover, 10000);
    window.addEventListener("online", recover); document.addEventListener("visibilitychange", recover);
    return () => {
      mounted = false; alive.current = false; abort.abort(); clearInterval(interval); clearTimeout(recoveryTimer); closePeer(); disposeMedia();
      socket.emit("leaveAppointmentRoom", { appointmentId });
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
      window.removeEventListener("online", recover); document.removeEventListener("visibilitychange", recover);
    };
  }, [appointmentId, role, attempt]);
  const toggleMic = () => {
    if (!ready) return;
    intent.current.muted = !intent.current.muted; stream.current?.getAudioTracks().forEach(track => { track.enabled = !intent.current.muted; });
    setMuted(intent.current.muted); announceRef.current();
  };
  const toggleCamera = async () => {
    if (!ready || deviceBusy) return;
    if (!intent.current.cameraOff) { intent.current.cameraOff = true; stream.current?.getVideoTracks().forEach(track => { track.enabled = false; }); setCameraOff(true); announceRef.current(); return; }
    setDeviceBusy(true);
    const existing = stream.current, existingTrack = existing?.getVideoTracks().find(track => track.readyState === "live");
    try {
      if (existingTrack) existingTrack.enabled = true;
      else {
        const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (!alive.current || stream.current !== existing) { media.getTracks().forEach(track => track.stop()); return; }
        const track = media.getVideoTracks()[0]; if (!track) throw new Error();
        existing.getVideoTracks().forEach(item => { existing.removeTrack(item); item.stop(); }); existing.addTrack(track);
        await negotiateRef.current(track);
      }
      if (!alive.current || stream.current !== existing) return;
      intent.current.cameraOff = false; setCameraOff(false); setNotice(""); announceRef.current();
    } catch { if (alive.current) setNotice("Camera could not start. Check camera access and try again; audio remains available."); }
    finally { if (alive.current) setDeviceBusy(false); }
  };
  const sendMessage = text => {
    const socket = getSocket(), value = text.trim().slice(0, 1000);
    if (!value || !ready || !socket.connected) { setChatNotice("Message not sent. Reconnect before sending."); return false; }
    socket.emit("appointment:chat-message", { appointmentId, text: value }); setMessages(items => [...items, { text: value, own: true, timestamp: new Date().toISOString() }].slice(-100)); setChatNotice(""); return true;
  };
  const clearPlaybackNotice = () => setNotice(value => value.startsWith("Press Play audio") ? "" : value);
  const resumeAudio = async () => { try { await remoteVideo.current?.play(); clearPlaybackNotice(); } catch { setNotice("Press Play audio to hear the other participant."); } };
  return { localVideo, remoteVideo, attachLocalVideo, attachRemoteVideo, clearPlaybackNotice, resumeAudio, status, error, notice, relayNotice, visit, ready, muted, cameraOff, remoteMedia, deviceBusy, messages, chatNotice,
    toggleMic, toggleCamera, sendMessage, stop: () => stopRef.current("left"), retry: () => setAttempt(value => value + 1) };
}
