import LabTestCatalog from "../model/labTestCatalog.js";
import PharmacyInventory from "../model/pharmacyInventory.js";
import { accessError, requireRecordId } from "./hospitalAccess.js";
import { labDefinitions } from "./labDefinitions.js";

export function clinicalText(value, label, max = 4000) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > max) throw accessError(400, `${label} must be text of at most ${max} characters`);
  return value.trim();
}

const whole = (value, label, max) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw accessError(400, `${label} must be a positive whole number up to ${max}`);
  return value;
};

export async function resolveClinicalItems(hospitalId, input, kind) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 30) throw accessError(400, "Provide between one and thirty distinct care items");
  const key = kind === "lab" ? "catalogId" : "inventoryId";
  const ids = input.map(item => requireRecordId(item?.[key], key));
  if (new Set(ids).size !== ids.length) throw accessError(400, "Duplicate care items are not allowed");
  const Model = kind === "lab" ? LabTestCatalog : PharmacyInventory;
  const records = await Model.find({ _id: { $in: ids }, hospitalId, isActive: true }).lean();
  if (records.length !== ids.length) throw accessError(403, "All care items must be active in this hospital catalog");
  const byId = new Map(records.map(record => [String(record._id), record]));
  if (kind === "lab" && new Set(records.map(record => record.code)).size !== records.length) throw accessError(409, "Colliding laboratory test codes require reviewed catalog repair");
  if (kind === "lab" && records.reduce((sum, record) => sum + (record.parameters || []).length, 0) > 180) throw accessError(400, "An order supports at most 180 configured laboratory parameters");
  return input.map((item, index) => {
    const record = byId.get(ids[index]);
    const price = kind === "lab" ? record.priceMinor : record.unitPriceMinor;
    if (!Number.isSafeInteger(price) || price < 0) throw accessError(409, "Catalog price needs reviewed repair");
    if (kind === "lab") {
      const parameters = labDefinitions(record.parameters || []);
      if (!parameters.length) throw accessError(409, "Catalog test needs reviewed parameter definitions before ordering");
      return { catalogId: record._id, testCode: record.code, testName: record.name, category: record.category, priceMinor: price,
        definitionDate: record.updatedAt || record.createdAt, specimenType: record.specimenType, parameters };
    }
    const directions = clinicalText(item.directions, "Medication directions", 1000);
    if (!directions) throw accessError(400, "Explicit clinician medication directions are required");
    return { inventoryId: record._id, medicationCode: record.medicationCode, medicationName: record.medicationName,
      directions, durationDays: whole(item.durationDays, "Duration", 365),
      quantityPrescribed: whole(item.quantityPrescribed, "Prescribed quantity", 100000),
      quantityDispensed: 0, unitPriceMinor: price, itemStatus: "pending" };
  });
}
