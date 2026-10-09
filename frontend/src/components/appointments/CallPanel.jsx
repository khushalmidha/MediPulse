/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import AppointmentVideoCall from "../AppointmentVideoCall";
import { Button, Card } from "../ui";
export default function CallPanel({ appointmentId, onRefresh }) {
  const [left, setLeft] = useState(false);
  useEffect(() => setLeft(false), [appointmentId]);
  const leave = useCallback(() => { setLeft(true); onRefresh(); }, [onRefresh]);
  return <Card><h2>Your online consultation</h2><p>Leaving the call keeps your consultation active. The doctor ends the visit when care is finished.</p>{left ? <Button onClick={() => setLeft(false)}>Rejoin call</Button> : <AppointmentVideoCall appointmentId={appointmentId} onCallEnd={leave} />}</Card>;
}
