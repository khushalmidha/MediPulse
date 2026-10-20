const visitId = "000000000000000000000003", familyId = "000000000000000000000022";
export async function handleClinical({ req, state, reply, hospitalId, staff }) {
  if (!state.clinical) return false;
  const url = new URL(req.url, "http://127.0.0.1:19080"), path = url.pathname;
  if (path === "/__fixture/patch" && req.method === "POST") { let raw = ""; for await (const chunk of req) raw += chunk; Object.assign(state, JSON.parse(raw || "{}")); reply(state); return true; }
  const hospital = path.startsWith("/api/opd/"), queuePath = path === "/appointment/doctor/queue" || path === `/api/opd/${hospitalId}/${staff._id}/queue`;
  const visit = { _id: visitId, status: hospital ? "in_consultation" : "active", visitMode: "in_person", revision: state.clinicalRevision || 4, familyMemberId: familyId, patientDisplayName: state.clinicalName || "Synthetic Family Patient", patientInfo: { name: state.clinicalName || "Synthetic Family Patient" }, user: { firstName: "Synthetic", lastName: "Account Owner" }, doctorNotes: state.clinicalNotes || "Recorded clinician note", soapNote: state.clinicalSoap || null, consultationNotes: state.clinicalNotes || "Recorded clinician note", displayToken: "T001", aiTriage: { patientBrief: { agentSummary: "Synthetic optional draft" } }, patientBrief: { agentSummary: "Synthetic optional draft" }, vitals: { pulse: 0, recordedAt: "2026-10-11T00:00:00Z" }, receiptText: state.clinicalReceipt || "" };
  if (queuePath) {
    state.clinicalQueueReads = (state.clinicalQueueReads || 0) + 1;
    if (state.clinicalReadStatus) { reply({ message: "Synthetic clinical queue unavailable" }, state.clinicalReadStatus); return true; }
    const selected = hospital ? url.searchParams.get("sessionId") || "morning" : url.searchParams.get("queueKey") || "hospital:clinical";
    if (state.clinicalRevoked && selected === "hospital:clinical") { reply({ message: "Synthetic hospital queue revoked" }, 403); return true; }
    const waiting = Array.from({ length: state.clinicalMany ? 11 : 2 }, (_, index) => ({ ...visit, _id: (30 + index).toString(16).padStart(24, "0"), status: hospital ? "vitals_done" : "queued", patientDisplayName: `Synthetic Ready ${index + 1}`, patientInfo: { name: `Synthetic Ready ${index + 1}` }, displayToken: `T${index + 2}`, estimatedWaitMinutes: index === 0 ? 0 : null }));
    const payload = { queueKey: selected, queueRevision: state.clinicalQueueRevision || 10, sessionId: selected, sessionIds: ["morning", "evening"], queues: [{ queueKey: "hospital:clinical", visitMode: "in_person", hospitalName: "Fixture Hospital", sessionId: "morning", serviceDate: "2026-10-11" }, { queueKey: "independent:clinical", visitMode: "online", sessionId: "day", serviceDate: "2026-10-11" }], reservations: Array.from({ length: state.clinicalManyReservations ? 11 : 1 }, (_, index) => ({ ...visit, _id: (80 + index).toString(16).padStart(24, "0"), patientDisplayName: "Synthetic Reserved " + (index + 1), patientInfo: { name: "Synthetic Reserved " + (index + 1) }, status: "reserved", displayToken: "R" + (index + 1) })), completed: state.clinicalEnded ? 1 : 0, pendingCount: waiting.length, waiting, queue: waiting, currentlyServing: state.clinicalIdle || state.clinicalEnded || selected === "evening" ? null : visit, activeAppointment: state.clinicalIdle || state.clinicalEnded || selected === "independent:clinical" ? null : visit };
    reply(payload); return true;
  }
  if ((path.startsWith("/appointment/") || path.startsWith("/api/opd/tokens/") || path.startsWith("/api/opd-ai/tokens/") || path.startsWith("/copilot/")) && req.method !== "GET") {
    const expectedCsrf = path.startsWith("/api/") ? "fixture-staff-csrf" : "fixture-account-csrf";
    if (req.headers["x-csrf-token"] !== expectedCsrf) { reply({ message: "Invalid synthetic clinician CSRF" }, 403); return true; }
    let raw = ""; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw || "{}");
    state.clinicalRequests ||= []; state.clinicalRequests.push({ path, body });
    if (state.clinicalWriteDelay) await new Promise(resolve => setTimeout(resolve, state.clinicalWriteDelay));
    if (state.clinicalWriteStatus) { reply({ message: "Synthetic clinician write refused" }, state.clinicalWriteStatus); return true; }
    if (path.endsWith("/generate-soap")) {
      if(body.revision!==visit.revision){reply({message:"Synthetic stale visit revision"},409);return true;}
      state.clinicalRevision=visit.revision+1;state.clinicalNotes=body.doctorNotes;state.clinicalSoapSource=body.doctorNotes;
      state.clinicalSoap={version:state.clinicalRevision,isDraft:true,clinicianApproved:false,subjective:"Synthetic reviewed context",objective:"Not discussed",assessment:"Synthetic draft assessment",plan:body.doctorNotes};
      reply({revision:state.clinicalRevision,soapNote:state.clinicalSoap});return true;
    }
    if (path.endsWith("/soap-note/approve")) {
      if(body.revision!==visit.revision || body.noteVersion!==state.clinicalSoap?.version || state.clinicalSoapSource!==state.clinicalNotes){reply({message:"Synthetic SOAP changed"},409);return true;}
      state.clinicalRevision=visit.revision+1;state.clinicalSoap={...state.clinicalSoap,clinicianApproved:true,isDraft:false};reply({revision:state.clinicalRevision,soapNote:state.clinicalSoap});return true;
    }
    if (path.endsWith("/notes")) { if(body.revision!==visit.revision){reply({message:"Synthetic stale visit revision"},409);return true;} state.clinicalRevision=visit.revision+1; state.clinicalNotes = body.doctorNotes; if(state.clinicalSoap)state.clinicalSoap={...state.clinicalSoap,clinicianApproved:false,isDraft:true}; reply({ doctorNotes: body.doctorNotes, revision: state.clinicalRevision, message: "Doctor notes saved" }); return true; }
    if (path.endsWith("/receipt")) { if(body.revision!==visit.revision){reply({message:"Synthetic stale visit revision"},409);return true;} state.clinicalRevision=visit.revision+1; state.clinicalNotes = body.doctorNotes; state.clinicalReceipt = "Synthetic clinician-review draft"; reply({ doctorNotes: body.doctorNotes, receiptText: state.clinicalReceipt, revision: state.clinicalRevision }); return true; }
    if (path.endsWith("/copilot")) { reply({ suggestion: "Synthetic optional assistant draft", context: { patientBrief: visit.patientBrief } }); return true; }
    if (path.endsWith("/refund")) { state.clinicalRefunds = (state.clinicalRefunds || 0) + 1; reply({ compensationStatus: state.clinicalRefundPending ? "pending" : "completed" }, state.clinicalRefundPending ? 202 : 200); return true; }
    if (["/complete", "/end"].some(suffix => path.endsWith(suffix))) { if (body.revision !== visit.revision) { reply({ message: "Synthetic stale visit revision" }, 409); return true; } state.clinicalEnded = true; state.clinicalNotes = body.notes || state.clinicalNotes; reply({ message: "Consultation completed" }); return true; }
    if (path.endsWith("/start") || path.endsWith("/start-consultation")) { if (body.revision !== visit.revision) { reply({ message: "Synthetic stale visit revision" }, 409); return true; } state.clinicalIdle = false; reply({ message: "Consultation started" }); return true; }
  }
  return false;
}
