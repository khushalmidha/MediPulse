import { schedulingModels } from "../model/scheduling.js";
export const inspectSchedulingSchema = async () => {
  const collections = [];
  for (const Model of schedulingModels) {
    let indexes = [];
    try { indexes = await Model.collection.listIndexes().toArray(); } catch (error) { if (error.code !== 26) throw error; }
    const missing = [], conflicts = [];
    for (const [key, options] of Model.schema.indexes()) {
      const row = indexes.find(index => JSON.stringify(index.key) === JSON.stringify(key));
      if (row && (row.name !== options.name || Boolean(row.unique) !== Boolean(options.unique) || Boolean(row.sparse) !== Boolean(options.sparse))) conflicts.push(options.name);
      else if (!row) { if (indexes.some(index => index.name === options.name)) conflicts.push(options.name); else missing.push({ key, options }); }
    }
    collections.push({ collection: Model.collection.collectionName, count: await Model.countDocuments({}), indexes, missing, conflicts });
  }
  return { ready: collections.every(item => item.indexes.some(index => index.name === "_id_") && !item.missing.length && !item.conflicts.length), collections };
};
export const assertSchedulingSchema = async () => { if (!(await inspectSchedulingSchema()).ready) throw new Error("P09 scheduling schema initialization is required"); };
export const applySchedulingSchema = async () => {
  const plan = await inspectSchedulingSchema();
  if (plan.collections.some(item => item.conflicts.length)) throw new Error("Resolve scheduling index conflicts before initialization");
  for (const Model of schedulingModels) {
    if (!(await Model.db.db.listCollections({ name: Model.collection.collectionName }).toArray()).length) await Model.createCollection();
    const item = plan.collections.find(row => row.collection === Model.collection.collectionName);
    for (const { key, options } of item.missing) await Model.collection.createIndex(key, options);
  }
  await assertSchedulingSchema(); return plan;
};
export const rollbackSchedulingSchema = async snapshot => {
  if (snapshot.task !== "P09" || snapshot.database !== schedulingModels[0].db.name || !Array.isArray(snapshot.collections)) throw new Error("Backup does not match this database/task");
  // Older APIs cannot safely process scheduled reservations; refuse rollback after use.
  for (const Model of schedulingModels) if (await Model.countDocuments({})) throw new Error("Scheduling data exists; keep P09 and recover forward");
  const permitted = [];
  for (const item of snapshot.collections) {
    const Model = schedulingModels.find(row => row.collection.collectionName === item.collection);
    if (!Model) throw new Error("Unknown scheduling collection");
    const current = await Model.collection.listIndexes().toArray();
    for (const index of item.missing || []) {
      const definition = Model.schema.indexes().find(([key, options]) => options.name === index.options?.name && JSON.stringify(key) === JSON.stringify(index.key));
      if (!definition || Boolean(definition[1].unique) !== Boolean(index.options.unique) || Boolean(definition[1].sparse) !== Boolean(index.options.sparse)) throw new Error("Backup contains an unknown index");
      const row = current.find(entry => entry.name === index.options.name);
      if (row && (JSON.stringify(row.key) !== JSON.stringify(index.key) || Boolean(row.unique) !== Boolean(index.options.unique) || Boolean(row.sparse) !== Boolean(index.options.sparse))) throw new Error("Index changed after initialization");
      if (row) permitted.push({ Model, name: row.name });
    }
  }
  for (const { Model, name } of permitted) await Model.collection.dropIndex(name);
};
