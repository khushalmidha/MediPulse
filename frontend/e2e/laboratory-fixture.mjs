const orderId = "000000000000000000000071", authorId = "000000000000000000000072";
export async function handleLaboratory({ req,state,reply,hospitalId,staff }) {
  const path = new URL(req.url,"http://fixture.invalid").pathname;
  if (!state.laboratory || !path.startsWith("/api/labs/")) return false;
  const respond = (data,status=200) => { reply(data,status); return true; };
  const role = state.staffRole || "LAB_TECH";
  state.labReads = (state.labReads || 0) + (req.method === "GET" ? 1 : 0);
  const record = state.labRecord ||= { _id:orderId,hospitalId,departmentId:staff.departmentIds[0],serviceDepartmentId:staff.departmentIds[0],
    orderingDoctorId:staff._id,orderingDoctorName:"Dr. Dr. Synthetic Clinician",patientInfo:{name:"Synthetic Laboratory Patient"},orderStatus:"collected",
    workflowVersion:1,workflowRevision:0,reportVersion:1,reportVersions:[],results:[],accessionBarcode:"LAB-SYNTHETIC-1",
    tests:[{ testCode:"SYN",testName:"Synthetic Test",parameters:[{code:"P",name:"Synthetic parameter",valueType:"number",unit:"configured-unit",referenceRangeText:"Configured interval",refMin:2,refMax:4,criticalHigh:5}] }] };
  if (req.method === "GET" && state.labReadStatus) return respond({message:"Synthetic laboratory access denied"},state.labReadStatus);
  if (path === "/api/labs/capabilities") return respond({ reviewDepartmentIds:state.labApproved?[staff.departmentIds[0]]:[],collectionBeforeBilling:true });
  if (path === "/api/labs/reviewers" && req.method === "GET") return respond({ reviewers:[{_id:authorId,name:"Synthetic Reviewer",role:"LAB_TECH",departmentIds:staff.departmentIds,reviewDepartmentIds:state.labApproved?staff.departmentIds:[]}],departments:[{_id:staff.departmentIds[0],name:"Synthetic Laboratory"}] });
  if (path.startsWith("/api/labs/reviewers/") && req.method === "POST") {
    let raw=""; for await (const chunk of req) raw+=chunk; const body=JSON.parse(raw);
    if (req.headers["x-csrf-token"] !== "fixture-staff-csrf") return respond({message:"Invalid fixture CSRF"},403);
    state.labApproval=body; state.labApproved=body.enabled; return respond({approval:{enabled:body.enabled}});
  }
  if (path === "/api/labs/orders" && req.method === "GET") {
    state.labOrderReads=(state.labOrderReads || 0)+1;
    return respond({orders:[record]});
  }
  if (path === "/api/labs/orders/"+orderId && req.method === "GET") return respond({order:record});
  const action = /\/orders\/[^/]+\/(collect|reject|results|verify|release|correct|acknowledge-critical)$/.exec(path);
  if (!action || req.method === "GET") return false;
  let raw=""; for await (const chunk of req) raw+=chunk; const body=JSON.parse(raw),key=req.headers["idempotency-key"],kind=action[1];
  (state.labRequests ||= []).push({kind,key,body});
  if (req.headers["x-csrf-token"] !== "fixture-staff-csrf") return respond({message:"Invalid fixture CSRF"},403);
  if (!key) return respond({message:"Command key required"},428);
  if ((state.labKeys ||= []).includes(key)) return respond({order:record,replayed:true,message:"Previously recorded command confirmed"});
  if (state.labStale) { state.labStale=false; record.workflowRevision++; }
  if (body.expectedRevision !== record.workflowRevision) return respond({message:"Laboratory order changed; refresh before retrying"},409);
  if (["results","correct"].includes(kind)) {
    const results = body.results.map(row=>({ ...row,parameterName:"Synthetic parameter",unit:"configured-unit",referenceRangeText:"Configured interval",flag:row.value>=5?"critical_high":"normal",isCritical:row.value>=5 }));
    record.reportVersion=record.reportVersions.length+1; record.reportVersions.push({version:record.reportVersion,results,authorId:state.labOwnResult?staff._id:authorId,authorName:"Synthetic Technician",correctionReason:body.reason});
    record.results=results; record.orderStatus="result_entered";
  } else if (kind === "verify") {
    if (!state.labApproved) return respond({message:"Explicit hospital approval required"},403);
    const version=record.reportVersions.at(-1); version.verifiedAt=new Date().toISOString(); version.verifiedByName="Synthetic Reviewer"; record.orderStatus="verified";
    if (version.results.some(row=>row.isCritical)) version.criticalTask={assignedDoctorId:staff._id,createdAt:new Date().toISOString()};
  } else if (kind === "release") { record.reportVersions.at(-1).releasedAt=new Date().toISOString(); record.orderStatus="released"; }
  else if (kind === "collect") { record.orderStatus="collected"; }
  else if (kind === "reject") { record.orderStatus="rejected"; record.rejectedReason=body.reason; record.recollectionRequested=body.requestRecollection; }
  else if (kind === "acknowledge-critical") { const report=record.reportVersions.find(version=>version.version===body.reportVersion); report.criticalTask.acknowledgedAt=new Date().toISOString(); }
  record.workflowRevision++; state.labKeys.push(key);
  if (state.labLoseResponse) { state.labLoseResponse=false; return respond({message:"Synthetic lost response after commit"},503); }
  return respond({order:record,message:kind === "correct"?"Correction saved as draft":"Laboratory command recorded",role});
}
