import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { labDefinitions, resolveLabResults } from "../services/labDefinitions.js";
import { labReviewDepartments } from "../services/labCapabilities.js";
import { generateAccessionBarcode, verifyLabResults } from "../services/labService.js";
import { labCommand } from "../services/labWorkflow.js";
const definitions = labDefinitions([{ code: "SYN", name: "Synthetic parameter", unit: "configured", refMin: 2, refMax: 4, criticalLow: 1, criticalHigh: 5 }]);
const tests = [{ testCode: "SYN-TEST", parameters: definitions }];
const input = value => [{ testCode: "SYN-TEST", parameterCode: "SYN", value, flag: "normal", unit: "forged" }];
test("laboratory flags and labels derive only from the ordered snapshot", () => {
  for (const [value, flag] of [[0,"critical_low"],[1,"critical_low"],[1.5,"low"],[2,"normal"],[4,"normal"],[4.5,"high"],[5,"critical_high"]]) {
    const result = resolveLabResults(tests, input(value))[0]; assert.equal(result.flag, flag); assert.equal(result.unit, "configured");
  }
});
test("laboratory definitions reject inverted, text and nonfinite thresholds", () => {
  for (const extra of [{ refMin: 6 }, { criticalLow: 3 }, { criticalHigh: 3 }, { refMax: NaN }, { valueType: "text" }]) assert.throws(() => labDefinitions([{ ...definitions[0], ...extra }]), error => error.status === 400);
  assert.throws(() => labDefinitions([definitions[0],definitions[0]]), error => error.status === 400);
});
test("laboratory values require complete exact parameter identities and typed values", () => {
  for (const bad of [[], input("3"), input(Infinity), [{ ...input(3)[0], testCode: "foreign" }]]) assert.throws(() => resolveLabResults(tests,bad), error => error.status === 400);
  const textual = [{ testCode: "TXT", parameters: labDefinitions([{ code: "T", name: "Synthetic text", valueType: "text" }]) }];
  assert.equal(resolveLabResults(textual,[{ testCode: "TXT", parameterCode: "T", value: " synthetic " }])[0].value, "synthetic");
});
test("accession identifiers are deterministic per order and distinct per collection", () => {
  const a = new mongoose.Types.ObjectId(), b = new mongoose.Types.ObjectId();
  assert.equal(generateAccessionBarcode(a), generateAccessionBarcode(a)); assert.notEqual(generateAccessionBarcode(a),generateAccessionBarcode(b));
  assert.notEqual(generateAccessionBarcode(a,1),generateAccessionBarcode(a,2)); assert.throws(() => generateAccessionBarcode(a,0));
});
test("administrative access does not grant laboratory review and approval must match membership", () => {
  const staff = { _id: "s", role: "LAB_TECH", departmentIds: ["lab"], adminAccess: true };
  assert.deepEqual(labReviewDepartments(staff),[]);
  staff.labReviewApproval = { enabled: true, approvedBy: "admin", approvedAt: new Date(), qualificationReference: "synthetic review", departmentIds: ["lab","other"] };
  assert.deepEqual(labReviewDepartments(staff),["lab"]); staff.labReviewApproval.approvedBy = "s"; assert.deepEqual(labReviewDepartments(staff),[]);
});
test("laboratory commands fail closed when disconnected", async () => {
  await assert.rejects(verifyLabResults({}), error => error.status === 503);
});
test("unknown laboratory command kinds are rejected before any database write", async () => {
  await assert.rejects(labCommand({},"__proto__"),error=>error.status === 400);
});
