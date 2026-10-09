import AuthSession from "../model/authSession.js";
import AuthChallenge from "../model/authChallenge.js";
export const authModels = [AuthSession, AuthChallenge];
export async function inspectAuthSchema() {
  const collections = [];
  for (const Model of authModels) {
    let indexes = [];
    try { indexes = await Model.collection.listIndexes().toArray(); } catch (error) { if (error.code !== 26) throw error; }
    const missing = [], conflicts = [];
    for (const [key, options] of Model.schema.indexes()) {
      const existing = indexes.find(index => JSON.stringify(index.key) === JSON.stringify(key));
      if (existing && (existing.expireAfterSeconds !== options.expireAfterSeconds || Boolean(existing.unique) !== Boolean(options.unique))) conflicts.push(options.name);
      else if (!existing) {
        if (indexes.some(index => index.name === options.name)) conflicts.push(options.name);
        else missing.push({ key, options });
      }
    }
    collections.push({ collection: Model.collection.collectionName, count: await Model.countDocuments({}), indexes, missing, conflicts });
  }
  return { collections, ready: collections.every(item => !item.missing.length && !item.conflicts.length) };
}
export async function applyAuthSchema() {
  const plan = await inspectAuthSchema();
  if (plan.collections.some(item => item.conflicts.length)) throw new Error("Conflicting auth indexes require operator review");
  for (const item of plan.collections) for (const index of item.missing) {
    const Model = authModels.find(model => model.collection.collectionName === item.collection);
    await Model.collection.createIndex(index.key, index.options);
  }
  await assertAuthSchema();
}
export async function assertAuthSchema() {
  if (!(await inspectAuthSchema()).ready) throw new Error("P05 auth indexes require initialization");
}
