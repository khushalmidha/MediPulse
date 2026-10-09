import OutboxJob from "../model/outboxJob.js";
import QueueRevision from "../model/queueRevision.js";
import BookingChallenge from "../model/bookingChallenge.js";
import Appointment from "../model/appointment.js";
export const durableModels = [OutboxJob, QueueRevision, BookingChallenge, Appointment];
export async function inspectDurableSchema() {
  const collections = [];
  for (const Model of durableModels) {
    let indexes = [];
    try { indexes = await Model.collection.listIndexes().toArray(); } catch (error) { if (error.code !== 26) throw error; }
    const missing = [], conflicts = [];
    for (const [key, options] of Model.schema.indexes().filter(([, options]) => options.name?.startsWith("p06_"))) {
      const existing = indexes.find(index => JSON.stringify(index.key) === JSON.stringify(key));
      if (existing && (existing.expireAfterSeconds !== options.expireAfterSeconds || Boolean(existing.unique) !== Boolean(options.unique))) conflicts.push(options.name);
      else if (!existing) {
        if (indexes.some(index => index.name === options.name)) conflicts.push(options.name);
        else missing.push({ key, options });
      }
    }
    collections.push({ collection: Model.collection.collectionName, count: await Model.countDocuments({}), indexes, missing, conflicts });
  }
  return { collections, ready: collections.every(item => item.indexes.length > 0 && !item.missing.length && !item.conflicts.length) };
}
export async function applyDurableSchema() {
  const plan = await inspectDurableSchema();
  if (plan.collections.some(item => item.conflicts.length)) throw new Error("Conflicting durable indexes require operator review");
  for (const item of plan.collections) for (const index of item.missing) {
    const Model = durableModels.find(model => model.collection.collectionName === item.collection);
    await Model.collection.createIndex(index.key, index.options);
  }
  // QueueRevision uses Mongo's built-in unique _id index, so explicitly create its collection.
  if (!(await QueueRevision.db.db.listCollections({ name: QueueRevision.collection.collectionName }).toArray()).length) await QueueRevision.createCollection();
  await assertDurableSchema();
}
export async function assertDurableSchema() {
  if (!(await inspectDurableSchema()).ready) throw new Error("P06 durable indexes require initialization");
}
