export const labActions = (order, staff, departments = []) => {
  if (order.workflowVersion !== 1) return [];
  const status = order.orderStatus, role = staff.role, actions = [];
  if (["NURSE", "LAB_TECH"].includes(role) && (["ordered","billing_cleared"].includes(status) || status === "rejected" && order.recollectionRequested)) actions.push("collect");
  if (role === "LAB_TECH" && ["collected","processing","result_entered"].includes(status)) actions.push("reject","results");
  if (["DOCTOR","LAB_TECH"].includes(role) && ["verified","released"].includes(status)) actions.push("correct");
  const report = order.reportVersions?.at(-1);
  if (["DOCTOR","LAB_TECH"].includes(role) && departments.includes(order.serviceDepartmentId) && report?.authorId !== staff._id) {
    if (status === "result_entered") actions.push("verify");
    if (status === "verified") actions.push("release");
  }
  return actions;
};
export const labParameters = order => (order.tests || []).flatMap(test => (test.parameters || []).map(parameter => ({ ...parameter, testCode: test.testCode,
  value: (order.results || []).find(row => row.testCode === test.testCode && row.parameterCode === parameter.code)?.value ?? "" })));
export function labRangeLabel(parameter = {}) {
  const parts = [parameter.referenceRangeText].filter(Boolean);
  const { refMin, refMax, criticalLow, criticalHigh } = parameter;
  if (refMin !== undefined || refMax !== undefined) parts.push(`Configured interval: ${refMin !== undefined ? refMin : "open"} to ${refMax !== undefined ? refMax : "open"}`);
  if (criticalLow !== undefined) parts.push(`Critical low: ≤ ${criticalLow}`);
  if (criticalHigh !== undefined) parts.push(`Critical high: ≥ ${criticalHigh}`);
  return parts.join(" · ");
}
export function labInputResults(parameters) {
  if (!parameters.length) throw new Error("This order needs reviewed parameter definitions.");
  return parameters.map(row => {
    if (row.value === "" || row.value === undefined || String(row.value).trim() === "") throw new Error("Enter every ordered parameter.");
    const value = row.valueType === "text" ? String(row.value).trim() : Number(row.value);
    if (row.valueType !== "text" && !Number.isFinite(value)) throw new Error("Enter finite numeric values.");
    return { testCode: row.testCode, parameterCode: row.code, value };
  });
}
export const pendingLabKey = (hospital, staff) => `medipulse.lab.pending.v1:${hospital}:${staff}`;
export function readPendingLab(storage,key) {
  const raw = storage.getItem(key); if (!raw) return null;
  const packet = JSON.parse(raw);
  if (!packet || !["collect","reject","results","correct","verify","release","acknowledge-critical"].includes(packet.kind)
    || !/^[a-f\d]{24}$/i.test(packet.orderId) || !/^[A-Za-z0-9._:-]{8,128}$/.test(packet.key)
    || !Number.isSafeInteger(packet.body?.expectedRevision) || packet.body.expectedRevision < 0) throw new Error("Saved laboratory command needs review");
  return packet;
}
