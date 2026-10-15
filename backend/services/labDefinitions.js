import { accessError } from "./hospitalAccess.js";
import { clinicalText } from "./clinicalOrderItems.js";

// These are hospital-configured definitions, never AI-generated clinical thresholds.
export function labDefinitions(parameters) {
  if (!Array.isArray(parameters) || parameters.length > 60) throw accessError(400, "Invalid laboratory parameter definitions");
  const seen = new Set();
  return parameters.map(p => {
    const code = clinicalText(p?.code, "Parameter code", 80), name = clinicalText(p?.name, "Parameter name", 150);
    if (!code || !name || seen.has(code)) throw accessError(400, "Parameter codes and names must be present and distinct");
    seen.add(code);
    const result = { code, name, unit: clinicalText(p.unit, "Unit", 80), referenceRangeText: clinicalText(p.referenceRangeText, "Reference range", 300), valueType: p.valueType || "number" };
    if (!["number", "text"].includes(result.valueType)) throw accessError(400, "Invalid result value type");
    for (const key of ["refMin", "refMax", "criticalLow", "criticalHigh"]) {
      if (p[key] !== undefined && p[key] !== null) {
        if (result.valueType !== "number" || typeof p[key] !== "number" || !Number.isFinite(p[key])) throw accessError(400, "Thresholds must be finite numbers on numeric parameters");
        result[key] = p[key];
      }
    }
    if ((result.refMin !== undefined && result.refMax !== undefined && result.refMin > result.refMax)
      || (result.criticalLow !== undefined && result.criticalHigh !== undefined && result.criticalLow >= result.criticalHigh)
      || (result.criticalLow !== undefined && result.refMin !== undefined && result.criticalLow > result.refMin)
      || (result.criticalHigh !== undefined && result.refMax !== undefined && result.criticalHigh < result.refMax)) throw accessError(400, "Inconsistent laboratory thresholds require review");
    return result;
  });
}

export function resolveLabResults(tests, input) {
  const definitions = tests.flatMap(t => (t.parameters || []).map(p => ({ ...p.toObject?.() || p, testCode: t.testCode })));
  if (!definitions.length || definitions.length > 180) throw accessError(409, "Order parameter definitions need reviewed repair");
  if (!Array.isArray(input) || input.length !== definitions.length) throw accessError(400, "Enter every ordered parameter exactly once");
  const rows = new Map();
  for (const row of input) {
    if (!row || typeof row.testCode !== "string" || typeof row.parameterCode !== "string") throw accessError(400, "Test and parameter codes are required");
    const key = JSON.stringify([row.testCode, row.parameterCode]);
    if (rows.has(key)) throw accessError(400, "Duplicate result parameter");
    rows.set(key, row);
  }
  return definitions.map(p => {
    const row = rows.get(JSON.stringify([p.testCode, p.code]));
    if (!row) throw accessError(400, "Result does not match the ordered catalog snapshot");
    let value, flag = "normal";
    if (p.valueType === "text") {
      value = clinicalText(row.value, "Result value", 2000);
      if (!value) throw accessError(400, "Text result is required");
    } else {
      if (typeof row.value !== "number" || !Number.isFinite(row.value)) throw accessError(400, "Numeric results must be finite numbers");
      value = row.value;
      if (p.criticalLow !== undefined && value <= p.criticalLow) flag = "critical_low";
      else if (p.criticalHigh !== undefined && value >= p.criticalHigh) flag = "critical_high";
      else if (p.refMin !== undefined && value < p.refMin) flag = "low";
      else if (p.refMax !== undefined && value > p.refMax) flag = "high";
    }
    return { testCode: p.testCode, parameterCode: p.code, parameterName: p.name, value, unit: p.unit,
      referenceRangeText: p.referenceRangeText, flag, isCritical: flag.startsWith("critical_") };
  });
}
