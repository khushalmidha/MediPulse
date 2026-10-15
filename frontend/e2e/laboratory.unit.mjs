import test from "node:test";
import assert from "node:assert/strict";
import { labActions, labParameters, labInputResults, labRangeLabel, pendingLabKey, readPendingLab } from "../src/utils/laboratory.js";
import { scopeForPath } from "../src/utils/sessionScope.js";
test("laboratory actions use role, explicit approval and independent review",()=>{
  const order={workflowVersion:1,orderStatus:"result_entered",serviceDepartmentId:"lab",reportVersions:[{authorId:"author"}]};
  assert.deepEqual(labActions(order,{role:"LAB_TECH",_id:"author"},["lab"]),["reject","results"]);
  assert.ok(labActions(order,{role:"LAB_TECH",_id:"reviewer"},["lab"]).includes("verify"));
  assert.equal(labActions(order,{role:"HOSPITAL_ADMIN",_id:"admin"}).length,0);
  assert.equal(labActions({...order,workflowVersion:undefined},{role:"LAB_TECH"},["lab"]).length,0);
});
test("result forms preserve zero, distinguish identical parameter codes in different tests and exclude client flags",()=>{
  const order={tests:[{testCode:"A",parameters:[{code:"P",name:"Synthetic",valueType:"number"}]},{testCode:"B",parameters:[{code:"P",name:"Text",valueType:"text"}]}],results:[{testCode:"A",parameterCode:"P",value:0},{testCode:"B",parameterCode:"P",value:"synthetic"}]};
  assert.deepEqual(labInputResults(labParameters(order)),[{testCode:"A",parameterCode:"P",value:0},{testCode:"B",parameterCode:"P",value:"synthetic"}]);
  assert.throws(()=>labInputResults([{...labParameters(order)[0],value:""}]));
});
test("saved laboratory commands are scoped and malformed packets do not disappear silently",()=>{
  assert.notEqual(pendingLabKey("one","staff"),pendingLabKey("two","staff"));
  assert.notEqual(pendingLabKey("hospital","one"),pendingLabKey("hospital","two"));
  assert.equal(readPendingLab({getItem:()=>null},"key"),null); assert.throws(()=>readPendingLab({getItem:()=>"broken"},"key"));
});
test("reviewer approval writes and capability reads use the staff session scope",()=>{
  for(const path of ["/api/labs/capabilities","/api/labs/reviewers","/backend/api/labs/reviewers/staff/approval"]) assert.equal(scopeForPath(path),"staff");
});
test("range display uses only configured values and preserves zero bounds",()=>{
  assert.equal(labRangeLabel(),"");
  assert.equal(labRangeLabel({refMin:0,refMax:4,criticalHigh:5}),"Configured interval: 0 to 4 · Critical high: ≥ 5");
});
