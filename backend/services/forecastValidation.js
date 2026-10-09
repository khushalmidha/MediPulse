const invalid = () => { throw Object.assign(new Error("Forecast provider returned invalid data"), { status: 502 }); };
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000;
const text = value => typeof value === "string" && value.trim().length > 0 && value.length <= 500;
export function validateForecast(raw, type, departments = []) {
  let items;
  try { items = typeof raw === "string" ? JSON.parse(raw.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, "")) : raw; }
  catch { invalid(); }
  if (!Array.isArray(items) || items.length < 1 || items.length > 8) invalid();
  const identities = new Set();
  return items.map(item => {
    if (!item || !text(item.explanation) || !count(item.recommendedReserve)) invalid();
    if (type === "beds") {
      const department = departments.find(dept => dept.name === item.departmentId?.name);
      if (!department || !["ICU", "General Ward"].includes(item.bedType)
        || !["High", "Medium", "Low"].includes(item.confidence) || !count(item.predictedDemand)) invalid();
      const identity = `${department._id}:${item.bedType}`;
      if (identities.has(identity)) invalid(); identities.add(identity);
      return { departmentId: { _id: department._id, name: department.name }, bedType: item.bedType,
        confidence: item.confidence, explanation: item.explanation.trim(), predictedDemand: item.predictedDemand, recommendedReserve: item.recommendedReserve };
    }
    if (type !== "blood" || !["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].includes(item.bloodGroup)
      || !["high", "medium", "low"].includes(item.shortageRisk) || !count(item.predictedUnits) || identities.has(item.bloodGroup)) invalid();
    identities.add(item.bloodGroup);
    return { bloodGroup: item.bloodGroup, shortageRisk: item.shortageRisk, predictedUnits: item.predictedUnits,
      recommendedReserve: item.recommendedReserve, explanation: item.explanation.trim() };
  });
}
