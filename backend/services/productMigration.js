import mongoose from "mongoose";
import crypto from "node:crypto";
import Hospital from "../model/hospital.js";
import HospitalDomain from "../model/hospitalDomain.js";
import Appointment from "../model/appointment.js";
import OpdToken from "../model/opdToken.js";
import { explicitPractice } from "./queueContext.js";
import { hostOptions } from "./productHosts.js";
import { canClaimCustomDomain, normalizeHostname, RESERVED_HOST_LABELS } from "../util/productHosts.js";
const { EJSON } = mongoose.mongo.BSON;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = row => crypto.createHash("sha256").update(JSON.stringify(canonical(JSON.parse(EJSON.stringify(row, { relaxed: false }))))).digest("hex");
const models = [Hospital, HospitalDomain, Appointment, OpdToken];
const name = Model => Model.collection.collectionName;
const patchRow = (Model, row, after) => {
  const before = Object.fromEntries(Object.keys(after).map(key => [key, { exists: Object.hasOwn(row, key), value: row[key] }]));
  const projected = { ...row, ...after };
  return { collection: name(Model), id: row._id, before, after, beforeHash: hash(row), afterHash: hash(projected) };
};
export async function inspectProductMigration() {
  const rows = [], issues = [], warnings = [];
  for (const Model of [Appointment, OpdToken]) for (const row of await Model.collection.find({}).toArray()) {
    const context = explicitPractice(row);
    if (!/^((independent|hospital):[a-f0-9]{24})$/.test(row.practiceKey || "") || !row.queueKey?.startsWith(`${row.practiceKey}:`) || !row.serviceDate || !row.sessionId) { issues.push("visit_queue_migration_required"); continue; }
    if (Model === OpdToken && (context.practiceType !== "hospital" || String(row.hospitalId) !== context.hospitalId)) { issues.push("token_hospital_context_mismatch"); continue; }
    if (row.visitMode !== context.visitMode || context.practiceType === "hospital" && row.visitMode !== "in_person" || context.practiceType === "independent" && row.visitMode !== "online") { issues.push("visit_mode_context_mismatch"); continue; }
    const after = { practiceType: context.practiceType, ...(context.hospitalId ? { hospitalId: new mongoose.Types.ObjectId(context.hospitalId) } : {}) };
    if (row.practiceType && row.practiceType !== after.practiceType || row.hospitalId && String(row.hospitalId) !== context.hospitalId) { issues.push("explicit_context_mismatch"); continue; }
    if (Object.entries(after).some(([key, value]) => String(row[key]) !== String(value))) rows.push(patchRow(Model, row, after));
  }
  const seen = new Set();
  for (const hospital of await Hospital.collection.find({}).toArray()) {
    if (RESERVED_HOST_LABELS.includes(hospital.slug)) warnings.push("reserved_hospital_slug_uses_path_fallback");
    const raw = hospital.websiteConfig?.customDomain;
    if (!raw) continue;
    const domain = normalizeHostname(raw);
    if (!canClaimCustomDomain(raw, hostOptions()) || raw.includes(":") || seen.has(domain)) { issues.push("invalid_or_duplicate_legacy_domain"); continue; }
    seen.add(domain);
    const existing = await HospitalDomain.collection.findOne({ _id: domain });
    if (existing && String(existing.hospitalId) !== String(hospital._id)) { issues.push("conflicting_domain_reservation"); continue; }
    if (!existing) {
      const after = { _id: domain, hospitalId: hospital._id, challenge: `medipulse-${crypto.randomBytes(24).toString("hex")}`, verified: false, state: "pending" };
      rows.push({ collection: name(HospitalDomain), id: domain, insert: true, after, afterHash: hash(after) });
      rows.push(patchRow(Hospital, hospital, { websiteConfig: { ...hospital.websiteConfig, customDomain: domain, customDomainVerified: false } }));
    }
  }
  return { task: "P07", database: mongoose.connection.name, rows, issues, warnings };
}
export async function applyProductMigration(plan, rollback = false) {
  if (plan.task !== "P07" || plan.database !== mongoose.connection.name || plan.issues?.length || !Array.isArray(plan.rows)) throw new Error("Invalid product migration target");
  // Explicitly create the unique ownership collection before transactional inserts.
  if (!rollback) await HospitalDomain.createIndexes();
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    for (const item of plan.rows) {
      const Model = models.find(model => name(model) === item.collection);
      if (!Model) throw new Error("Invalid collection");
      const current = await Model.collection.findOne({ _id: item.id }, { session });
      const expected = rollback ? item.afterHash : item.beforeHash;
      if (item.insert && !rollback ? current !== null : !current || hash(current) !== expected) throw new Error("Data changed; migration requires fresh review");
    }
    for (const item of plan.rows) {
      const collection = models.find(model => name(model) === item.collection).collection;
      if (item.insert) {
        if (rollback) await collection.deleteOne({ _id: item.id }, { session });
        else await collection.insertOne(item.after, { session });
      } else if (rollback) {
        const set = {}, unset = {};
        for (const [key, prior] of Object.entries(item.before)) { if (prior.exists) set[key] = prior.value; else unset[key] = ""; }
        await collection.updateOne({ _id: item.id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session });
      } else await collection.updateOne({ _id: item.id }, { $set: item.after }, { session });
    }
  }); } finally { await session.endSession(); }
}
