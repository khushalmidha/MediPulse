/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import AppointmentVideoCall from "../AppointmentVideoCall";
import { Button, Card } from "../ui";
export default function CallPanel({ appointmentId, onRefresh, onRequestEnd, patientName, doctorName }) {
  const [left, setLeft] = useState(false), [ended, setEnded] = useState(false), [joined, setJoined] = useState(false), [exitMessage, setExitMessage] = useState("");
  useEffect(() => { setLeft(false); setEnded(false); setJoined(false); }, [appointmentId]);
  const leave = useCallback(reason => { setLeft(true); setEnded(["ended", "access-lost"].includes(reason)); setExitMessage(reason === "access-lost" ? "Call access is unavailable. Refresh the visit or sign in again." : "This consultation has ended."); onRefresh?.(); }, [onRefresh]);
  return <Card className="mp-consultation-panel"><h2>Your online consultation</h2><p>Leaving the call keeps your consultation active. The doctor completes the visit after reviewing care and notes.</p>{!joined || left ? <div className="mp-call-lobby"><h3>{ended ? exitMessage : left ? "You left the call" : "Ready for your consultation?"}</h3><p>{ended ? "Refresh this visit to check its latest status." : left ? "You can rejoin while the consultation is active." : "Camera and microphone start after you join. You can mute, turn off your camera or open fullscreen during the call."}</p>{!ended && <Button onClick={() => { setJoined(true); setLeft(false); }}>{left ? "Rejoin call" : "Join call"}</Button>}</div> : <AppointmentVideoCall appointmentId={appointmentId} onCallEnd={leave} onRequestEnd={onRequestEnd} patientName={patientName} doctorName={doctorName} />}</Card>;
}
