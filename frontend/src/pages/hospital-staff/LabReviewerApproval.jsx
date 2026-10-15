import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "../../utils";
import { Banner, Button, Card, Field } from "../../components/ui";

export default function LabReviewerApproval() {
  const [reviewers,setReviewers] = useState([]), [departments,setDepartments] = useState([]), [search,setSearch] = useState("");
  const [staffId,setStaffId] = useState(""), [departmentId,setDepartmentId] = useState(""), [reference,setReference] = useState("");
  const [message,setMessage] = useState(""), [busy,setBusy] = useState(false), [truncated,setTruncated] = useState(false);
  const alive = useRef(true), controller = useRef(null), writing = useRef(false);
  const load = useCallback(async () => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    try {
      const response = await axios.get(`${BACKEND_URL}/api/labs/reviewers?search=${encodeURIComponent(search)}`,{ signal:request.signal,withCredentials:true,timeout:15000 });
      if (!alive.current || request.signal.aborted) return;
      setReviewers(response.data.reviewers); setDepartments(response.data.departments); setTruncated(response.data.truncated);
    } catch (error) { if (alive.current && !request.signal.aborted) { setReviewers([]); setMessage(error.response?.data?.message || "Reviewer list is unavailable."); } }
  },[search]);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; controller.current?.abort(); }; },[load]);
  const save = async enabled => {
    if (writing.current) return;
    if (!staffId || enabled && (!departmentId || !reference.trim())) { setMessage("Choose a staff member, department and reviewed qualification reference."); return; }
    writing.current = true; setBusy(true); const request = new AbortController(); controller.current = request;
    try {
      await axios.post(`${BACKEND_URL}/api/labs/reviewers/${staffId}/approval`,{ enabled,departmentIds:enabled?[departmentId]:[],qualificationReference:reference.trim() },{ signal:request.signal,withCredentials:true,timeout:15000 });
      if (alive.current && !request.signal.aborted) { setMessage(enabled?"Reviewer approval recorded.":"Reviewer approval revoked."); setReference(""); load(); }
    } catch (error) { if (alive.current && !request.signal.aborted) setMessage(error.response?.data?.message || "Approval response was not confirmed. Reload the reviewer list before retrying."); }
    finally { if (alive.current) { writing.current = false; setBusy(false); } }
  };
  const target = reviewers.find(staff=>staff._id===staffId);
  return <Card className="mp-lab-approval"><h2>Reviewer approvals</h2><p>Record the hospital’s review of a staff member’s qualifications. Portal administration does not confer clinical review permission. Staff cannot approve themselves.</p>
    {message && <Banner>{message}</Banner>}{truncated && <Banner tone="warning">Showing the first 100 matches. Refine the staff search.</Banner>}
    <div className="mp-lab-filters"><Field label="Find reviewer" type="search" value={search} disabled={busy} onChange={event=>setSearch(event.target.value)} />
      <Field label="Reviewer" as="select" value={staffId} disabled={busy} onChange={event=>{setStaffId(event.target.value);setDepartmentId("");}}><option value="">Choose staff</option>{reviewers.map(staff=><option key={staff._id} value={staff._id}>{staff.name} · {staff.role}</option>)}</Field>
      <Field label="Review department" as="select" value={departmentId} disabled={busy} onChange={event=>setDepartmentId(event.target.value)}><option value="">Choose assigned department</option>{departments.filter(department=>target?.departmentIds.includes(department._id)).map(department=><option key={department._id} value={department._id}>{department.name}</option>)}</Field>
      <Field label="Qualification review reference" value={reference} maxLength={500} disabled={busy} onChange={event=>setReference(event.target.value)} hint="Use a reviewed internal credential or approval reference; do not paste patient details." />
    </div>{target && <p>Currently approved departments: {target.reviewDepartmentIds.map(id=>departments.find(dept=>dept._id===id)?.name || id).join(", ") || "None"}. A new approval replaces the current department scope.</p>}
    <div className="mp-lab-actions"><Button disabled={busy} onClick={()=>save(true)}>Record reviewed approval</Button><Button variant="secondary" disabled={busy || !target?.reviewDepartmentIds.length} onClick={()=>save(false)}>Revoke approval</Button></div>
  </Card>;
}
