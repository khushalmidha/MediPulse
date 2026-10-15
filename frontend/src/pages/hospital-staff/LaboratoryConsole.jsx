import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { FlaskConical, RefreshCw } from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { formatDoctorName } from "../../utils/appointments";
import { labActions, labParameters, labInputResults, labRangeLabel, pendingLabKey, readPendingLab } from "../../utils/laboratory";
import { useAuth } from "../../context/AuthContext";
import { Banner, Button, Card, Dialog, EmptyState, Field, LoadingState, StatusBadge } from "../../components/ui";
import LabReviewerApproval from "./LabReviewerApproval";
import "./laboratory.css";

const labels = { collect: "Collect specimen", reject: "Reject specimen", results: "Enter results", verify: "Verify findings",
  release: "Release report", correct: "Draft correction", "acknowledge-critical": "Acknowledge critical result" };
const rangeFor = (order,row) => labRangeLabel(order.tests?.find(test=>test.testCode === row.testCode)?.parameters?.find(parameter=>parameter.code === row.parameterCode)) || row.referenceRangeText;
export default function LaboratoryConsole() {
  const { staffUser, isStaffAuth } = useAuth();
  if (!isStaffAuth || !staffUser?.adminAccess && !["DOCTOR","NURSE","LAB_TECH","DEPARTMENT_HEAD","HOSPITAL_ADMIN"].includes(staffUser?.role)) return <main className="mp-page"><Card><h1>Hospital laboratory access is needed</h1><p>Sign in with your assigned hospital staff account.</p></Card></main>;
  return <LabWorkspace key={`${staffUser._id}:${staffUser.hospitalId}:${staffUser.role}:${Boolean(staffUser.adminAccess)}:${(staffUser.departmentIds || []).join(",")}`} />;
}
function LabWorkspace() {
  const { staffUser } = useAuth(), hospitalId = staffUser.hospitalId;
  const adminOnly = !["DOCTOR","NURSE","LAB_TECH","DEPARTMENT_HEAD"].includes(staffUser.role), canAdmin = staffUser.role === "HOSPITAL_ADMIN" || staffUser.adminAccess;
  const [approval, setApproval] = useState(adminOnly), [orders,setOrders] = useState([]), [reviewIds,setReviewIds] = useState([]);
  const [loading,setLoading] = useState(true), [error,setError] = useState(""), [notice,setNotice] = useState("");
  const [filter,setFilter] = useState("all"), [search,setSearch] = useState("");
  const [selected,setSelected] = useState(null), [kind,setKind] = useState(null), [parameters,setParameters] = useState([]);
  const [reason,setReason] = useState(""), [recollect,setRecollect] = useState(true), [targetVersion,setTargetVersion] = useState(null);
  const [busy,setBusy] = useState(false), [feedback,setFeedback] = useState("");
  const storageKey = pendingLabKey(hospitalId,staffUser._id);
  const [pendingState] = useState(() => { try { return { packet: readPendingLab(sessionStorage,storageKey) }; } catch { return { problem: "Restore session storage before recording laboratory commands." }; } });
  const [pending,setPending] = useState(pendingState.packet), [storageProblem,setStorageProblem] = useState(pendingState.problem || "");
  const alive = useRef(true), reads = useRef(null), writes = useRef(null), submitting = useRef(false);
  const fetchOrders = useCallback(async () => {
    if (adminOnly) { setLoading(false); return; }
    reads.current?.abort(); const controller = new AbortController(); reads.current = controller;
    setLoading(true);
    try {
      const config = { withCredentials: true, signal: controller.signal, timeout: 15000 };
      const [worklist,permissions] = await Promise.all([axios.get(`${BACKEND_URL}/api/labs/orders${filter === "critical" ? "?critical=pending" : ""}`,config),axios.get(`${BACKEND_URL}/api/labs/capabilities`,config)]);
      if (!alive.current || controller.signal.aborted) return;
      setOrders(worklist.data.orders || []); setReviewIds(permissions.data.reviewDepartmentIds || []); setError("");
    } catch (err) { if (alive.current && !controller.signal.aborted) { setOrders([]); setReviewIds([]); if ([401,403].includes(err.response?.status)) { setSelected(null); setKind(null); } setError(err.response?.data?.message || "Laboratory worklist is unavailable. Please retry."); } }
    finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  },[adminOnly,filter]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; reads.current?.abort(); writes.current?.abort(); }; },[]);
  useEffect(() => { fetchOrders(); },[fetchOrders]);
  const close = () => { if (!submitting.current) { setSelected(null); setKind(null); setFeedback(""); } };
  const open = (order,action,version) => { setSelected(order); setKind(action); setTargetVersion(version); setParameters(labParameters(order)); setReason(""); setRecollect(true); setFeedback(""); };
  const resume = async () => {
    reads.current?.abort(); const controller = new AbortController(); reads.current = controller;
    try {
      const response = await axios.get(`${BACKEND_URL}/api/labs/orders/${pending.orderId}`,{ withCredentials:true, signal:controller.signal,timeout:15000 });
      if (!alive.current || controller.signal.aborted) return;
      open(response.data.order,pending.kind,pending.body.reportVersion);
    } catch (err) { if (alive.current && !controller.signal.aborted) { if ([401,403].includes(err.response?.status)) setOrders([]); setError("Restore access to confirm the saved laboratory command."); } }
  };
  const submit = async () => {
    if (submitting.current || storageProblem) return;
    let packet = pending;
    if (!packet) {
      try {
        const body = { expectedRevision: selected.workflowRevision };
        if (["results","correct"].includes(kind)) body.results = labInputResults(parameters);
        if (["correct","reject"].includes(kind)) { if (!reason.trim()) throw new Error("A reason is required."); body.reason = reason.trim(); }
        if (kind === "reject") body.requestRecollection = recollect;
        if (kind === "acknowledge-critical") body.reportVersion = targetVersion;
        packet = { orderId:selected._id,kind,key:crypto.randomUUID(),body };
        sessionStorage.setItem(storageKey,JSON.stringify(packet)); setPending(packet);
      } catch (err) { setFeedback(err.message.includes("required") || err.message.includes("Enter") || err.message.includes("definitions") ? err.message : "Session storage is unavailable. This command was not sent."); return; }
    }
    submitting.current = true; setBusy(true); setFeedback("");
    const controller = new AbortController(); writes.current = controller;
    try {
      const response = await axios.request({ url:`${BACKEND_URL}/api/labs/orders/${packet.orderId}/${packet.kind}`,
        method:["results","correct","acknowledge-critical"].includes(packet.kind) ? "POST" : "PATCH",data:packet.body,
        headers:{ "Idempotency-Key":packet.key },withCredentials:true,signal:controller.signal,timeout:20000 });
      if (!alive.current || controller.signal.aborted) return;
      sessionStorage.removeItem(storageKey); setPending(null); setSelected(null); setKind(null); setNotice(response.data.message || "Laboratory command recorded"); fetchOrders();
    } catch (err) {
      if (!alive.current || controller.signal.aborted) return;
      const definitive = [400,409,413,422,428].includes(err.response?.status);
      if (definitive) {
        try { sessionStorage.removeItem(storageKey); setPending(null); } catch { setStorageProblem("Restore storage to resolve this command."); return; }
        fetchOrders();
      }
      if ([401,403].includes(err.response?.status)) { setOrders([]); setReviewIds([]); setSelected(null); setKind(null); setError("Laboratory access is unavailable. Restore access to confirm the saved command."); }
      setFeedback(definitive ? err.response?.data?.message || "Command rejected" : "The response was not confirmed. Retry the same saved command after access or service is restored.");
    } finally { if (alive.current) { submitting.current = false; setBusy(false); } }
  };
  const visible = orders.filter(order => (filter === "all" || filter === "critical" || order.orderStatus === filter)
    && `${order.patientInfo?.name || ""} ${order.accessionBarcode || ""} ${(order.tests || []).map(t=>t.testName).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="mp-page mp-laboratory">
    <div className="mp-section-heading"><div><p className="mp-eyebrow">Hospital laboratory</p><h1><FlaskConical size={28} /> Laboratory worklist</h1><p>Track specimens, review findings and release versioned reports.</p></div><Button variant="secondary" onClick={fetchOrders} disabled={loading || adminOnly}><RefreshCw size={16} /> Refresh</Button></div>
    {canAdmin && <div className="mp-lab-actions"><Button variant="secondary" onClick={()=>setApproval(v=>!v)}>{approval ? "Close reviewer approvals" : "Manage reviewer approvals"}</Button></div>}
    {approval && canAdmin && <LabReviewerApproval />}
    {adminOnly ? <Card><p>Hospital administration records reviewer approvals. Clinical reports require an assigned clinical role and department.</p></Card> : <>
      {error && <Banner tone="danger">{error}</Banner>}{notice && <Banner tone="positive">{notice}</Banner>}{storageProblem && <Banner tone="danger">{storageProblem}</Banner>}
      {pending && <Banner tone="warning">A laboratory command needs confirmation before another can be recorded. <Button onClick={resume} disabled={busy}>Resume command</Button></Banner>}
      <Card className="mp-lab-filters"><Field label="Search worklist" type="search" value={search} onChange={e=>setSearch(e.target.value)} /><Field label="Workflow status" as="select" value={filter} onChange={e=>setFilter(e.target.value)}>
        <option value="all">All assigned orders</option>{staffUser.role === "DOCTOR" && <option value="critical">Pending critical acknowledgements</option>}{["ordered","billing_cleared","collected","result_entered","verified","released","rejected"].map(status=><option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}
      </Field></Card>
      {loading ? <LoadingState>Loading laboratory orders…</LoadingState> : !visible.length ? <Card><EmptyState title="No laboratory orders found">Orders appear here when an assigned clinician requests testing.</EmptyState></Card> : visible.map(order => <Card key={order._id} className="mp-lab-record">
        <div className="mp-lab-record-heading"><h2>{order.patientInfo?.name || "Patient"}</h2><StatusBadge status={order.orderStatus} /></div>
        <p className="mp-lab-muted">Ordered by {formatDoctorName(order.orderingDoctorName)} · Current report v{order.reportVersion}</p>
        <p>{(order.tests || []).map(t=>t.testName).join(" · ")}</p>{order.accessionBarcode && <p className="mp-lab-accession">Accession: {order.accessionBarcode}</p>}
        {order.workflowVersion !== 1 && <Banner tone="warning">Historical workflow needs reviewed provenance repair before further changes.</Banner>}
        {order.workflowVersion !== 1 && order.results?.length > 0 && <section className="mp-lab-report"><h3>Historical findings · {order.orderStatus}</h3><p className="mp-lab-muted">Original record preserved. Verification provenance has not been established by this workflow.</p><div className="mp-lab-values">{order.results.map((row,index)=><div key={index}><strong>{row.parameterName}</strong><span>{String(row.value)} {row.unit}</span><small>{row.referenceRangeText}</small></div>)}</div></section>}
        {order.rejectedReason && <Banner tone="warning">Specimen rejected: {order.rejectedReason}</Banner>}
        <div className="mp-lab-actions">{labActions(order,staffUser,reviewIds).map(action=><Button key={action} variant={["reject","correct"].includes(action)?"secondary":"primary"} disabled={Boolean(pending) || Boolean(storageProblem)} onClick={()=>open(order,action)}>{labels[action]}</Button>)}</div>
        {(order.reportVersions || []).map(report=><section key={report.version} className="mp-lab-report" aria-label={`Report version ${report.version}`}>
          <h3>Report v{report.version} · {report.releasedAt ? "Released" : report.verifiedAt ? "Verified" : "Draft"}</h3>
          {report.correctionReason && <p>Correction: {report.correctionReason}</p>}
          <p className="mp-lab-muted">Entered by {report.authorName} · Reviewed by {report.verifiedByName || "Pending independent review"}</p>
          <div className="mp-lab-values">{report.results.map(row=><div key={`${row.testCode}:${row.parameterCode}`}><strong>{row.parameterName}</strong><span>{String(row.value)} {row.unit}</span><span className={row.isCritical?"mp-lab-critical":"mp-lab-muted"}>{row.flag.replaceAll("_"," ")}</span><small>{rangeFor(order,row)}</small></div>)}</div>
          {report.criticalTask?.createdAt && <Banner tone={report.criticalTask.acknowledgedAt?"positive":"warning"}>{report.criticalTask.acknowledgedAt ? "Assigned clinician acknowledged this version." : "Critical result: assigned clinician acknowledgement pending."}
            {!report.criticalTask.acknowledgedAt && report.criticalTask.assignedDoctorId === staffUser._id && <Button disabled={Boolean(pending)||Boolean(storageProblem)} onClick={()=>open(order,"acknowledge-critical",report.version)}>Acknowledge critical result v{report.version}</Button>}
          </Banner>}
        </section>)}
      </Card>)}
    </>}
    <Dialog open={Boolean(selected)} onClose={close} title={labels[kind] || "Laboratory command"}>
      {selected && <><p>{selected.patientInfo?.name} · {targetVersion ? `Report v${targetVersion}` : `Current report v${selected.reportVersion}`}</p>{feedback && <Banner tone="danger">{feedback}</Banner>}
        {["verify","release","acknowledge-critical"].includes(kind) && <div className="mp-lab-values">{(selected.reportVersions?.find(report=>report.version === (targetVersion || selected.reportVersion))?.results || []).map(row=><div key={`${row.testCode}:${row.parameterCode}`}><strong>{row.testCode} · {row.parameterName}</strong><span>{String(row.value)} {row.unit}</span><span className={row.isCritical?"mp-lab-critical":"mp-lab-muted"}>{row.flag.replaceAll("_"," ")}</span><small>{rangeFor(selected,row)}</small></div>)}</div>}
        {pending ? <><Banner tone="warning">This saved {labels[pending.kind]?.toLowerCase()} command retains its original values and revision for retry.</Banner>
          {pending.body.results?.map(row=><p key={`${row.testCode}:${row.parameterCode}`}>Saved {row.testCode} / {row.parameterCode}: {String(row.value)}</p>)}
          {pending.body.reason && <p>Saved reason: {pending.body.reason}</p>}
        </> : <>
          {kind === "collect" && <p>The server assigns a unique accession. Collection is allowed before billing clearance.</p>}
          {kind === "reject" && <label className="mp-lab-checkbox"><input type="checkbox" checked={recollect} onChange={e=>setRecollect(e.target.checked)} /> Request recollection</label>}
          {["reject","correct"].includes(kind) && <Field label="Reason" as="textarea" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} required />}
          {["results","correct"].includes(kind) && <div className="mp-lab-parameters">{parameters.map((row,index)=><Field key={`${row.testCode}:${row.code}`} label={`${row.testCode} — ${row.name}`} hint={[row.unit,labRangeLabel(row)].filter(Boolean).join(" · ")} type={row.valueType === "text"?"text":"number"} step="any" value={row.value} onChange={e=>setParameters(previous=>previous.map((p,i)=>i===index?{...p,value:e.target.value}:p))} required />)}</div>}
          {kind === "verify" && <p>Review every finding against the ordered definitions. Your approval and identity will be recorded on this version.</p>}
          {kind === "release" && <p>Publish this verified version to the patient. Earlier released versions are preserved.</p>}
          {kind === "correct" && <p>This creates a draft requiring fresh independent review and release. The prior released report remains visible to the patient.</p>}
          {kind === "acknowledge-critical" && <p>Confirm that you reviewed the critical findings on this exact version. This records acknowledgement; it does not record treatment or email delivery.</p>}
        </>}
        <div className="mp-lab-actions"><Button variant="secondary" onClick={close} disabled={busy}>Close for now</Button><Button onClick={submit} disabled={busy || Boolean(storageProblem)}>{busy?"Recording…":pending?"Retry saved command":"Confirm command"}</Button></div>
      </>}
    </Dialog>
  </main>;
}
