// Explicit, additive schema preparation. Never imported by application startup.
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { reelsModels } from '../model/reel.js';
import { requireDatabaseUrl } from '../util/databaseConfig.js';

export async function inspectReelsSchema() {
  const result = [];
  for (const model of reelsModels) {
    let indexes = []; try { indexes = await model.collection.indexes(); } catch (error) { if (error.code !== 26) throw error; }
    const expected = model.schema.indexes();
    result.push({ collection: model.collection.name, missing: expected.filter(([, opts]) => !indexes.some(i => i.name === opts.name)).map(([, opts]) => opts.name),
      conflicts: expected.filter(([keys, opts]) => indexes.some(i => i.name === opts.name && (JSON.stringify(i.key) !== JSON.stringify(keys) || Boolean(i.unique) !== Boolean(opts.unique) || i.expireAfterSeconds !== opts.expireAfterSeconds))).map(([, opts]) => opts.name) });
  }
  return result;
}
export async function applyReelsSchema() {
  const before = await inspectReelsSchema();
  if (before.some(row => row.conflicts.length)) throw new Error('Conflicting indexes: reviewed repair required');
  for (const model of reelsModels) { await model.createCollection(); await model.createIndexes(); }
  return inspectReelsSchema();
}
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  try {
    const uri = requireDatabaseUrl(process.env), url = new URL(uri), apply = process.argv.includes('--apply');
    if (apply && !process.argv.includes(`--confirm-database=${url.pathname.slice(1)}`)) throw new Error('Apply requires exact --confirm-database=<name> after backup/rehearsal/approval');
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'read-only', indexes: apply ? await applyReelsSchema() : await inspectReelsSchema() }, null, 2));
  } catch (error) { console.error(error.code === 11000 ? 'Duplicate records prevent index creation; originals preserved for reviewed repair' : error.message); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
}
