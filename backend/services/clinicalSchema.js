import mongoose from "mongoose";
import EncounterJourney from "../model/encounterJourney.js";
import LabOrder from "../model/labOrder.js";
import Prescription from "../model/prescription.js";
import { accessError } from "./hospitalAccess.js";

export const clinicalModels = [EncounterJourney, LabOrder, Prescription];

const canonical = value => (value && typeof value === "object" ? JSON.stringify(Object.entries(value).sort()) : String(value));

export async function inspectClinicalSchema() {
  if (mongoose.connection?.readyState !== 1) {
    return {
      ready: false,
      collections: clinicalModels.map(Model => ({
        collection: Model.collection.collectionName,
        count: 0,
        indexes: [],
        missing: Model.schema.indexes().filter(([, o]) => o.name?.startsWith("ag01_")).map(([key, options]) => ({ key, options })),
        conflicts: [],
      })),
      issues: ["database_unavailable"],
      summary: { collections: clinicalModels.length, issues: 1, missingTotal: 0, conflictsTotal: 0 },
    };
  }

  const collections = [];
  const issues = [];

  for (const Model of clinicalModels) {
    let indexes = [];
    try {
      indexes = await Model.collection.listIndexes().toArray();
    } catch (error) {
      if (error.code !== 26 && error.codeName !== "NamespaceNotFound") throw error;
    }

    const missing = [];
    const conflicts = [];
    const ag01Indexes = Model.schema.indexes().filter(([, options]) => options.name?.startsWith("ag01_"));

    for (const [key, options] of ag01Indexes) {
      const existing = indexes.find(idx => idx.name === options.name || canonical(idx.key) === canonical(key));
      if (existing) {
        const keyMismatch = canonical(existing.key) !== canonical(key);
        const uniqueMismatch = Boolean(existing.unique) !== Boolean(options.unique);
        const sparseMismatch = Boolean(existing.sparse) !== Boolean(options.sparse);
        const partialMismatch = canonical(existing.partialFilterExpression) !== canonical(options.partialFilterExpression);

        if (keyMismatch || uniqueMismatch || sparseMismatch || partialMismatch || existing.name !== options.name) {
          conflicts.push(options.name);
        }
      } else {
        if (indexes.some(idx => idx.name === options.name)) {
          conflicts.push(options.name);
        } else {
          missing.push({ key, options });
        }
      }
    }

    let count = 0;
    try {
      count = await Model.countDocuments({});
    } catch (error) {
      if (error.code !== 26 && error.codeName !== "NamespaceNotFound") throw error;
    }

    collections.push({
      collection: Model.collection.collectionName,
      count,
      indexes,
      missing,
      conflicts,
    });
  }

  // Provenance / duplicate checks on existing data
  try {
    const dupTokens = await EncounterJourney.collection.aggregate([
      { $match: { tokenId: { $exists: true, $ne: null } } },
      { $group: { _id: "$tokenId", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    if (dupTokens.length) issues.push("duplicate_encounter_token");

    const dupAppointments = await EncounterJourney.collection.aggregate([
      { $match: { appointmentId: { $exists: true, $ne: null } } },
      { $group: { _id: "$appointmentId", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    if (dupAppointments.length) issues.push("duplicate_encounter_appointment");
  } catch (error) {
    if (error.code !== 26 && error.codeName !== "NamespaceNotFound") throw error;
  }

  try {
    const dupLabKeys = await LabOrder.collection.aggregate([
      { $match: { creationKey: { $exists: true, $type: "string" } } },
      { $group: { _id: { hospitalId: "$hospitalId", creationKey: "$creationKey" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    if (dupLabKeys.length) issues.push("duplicate_lab_order_creation_key");

    const dupBarcodes = await LabOrder.collection.aggregate([
      { $match: { accessionBarcode: { $exists: true, $type: "string" } } },
      { $group: { _id: "$accessionBarcode", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    if (dupBarcodes.length) issues.push("duplicate_lab_order_accession_barcode");
  } catch (error) {
    if (error.code !== 26 && error.codeName !== "NamespaceNotFound") throw error;
  }

  try {
    const dupRxKeys = await Prescription.collection.aggregate([
      { $match: { creationKey: { $exists: true, $type: "string" } } },
      { $group: { _id: { hospitalId: "$hospitalId", creationKey: "$creationKey" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    if (dupRxKeys.length) issues.push("duplicate_prescription_creation_key");

    const dupRxTokens = await Prescription.collection.aggregate([
      { $match: { verificationToken: { $exists: true, $type: "string" } } },
      { $group: { _id: "$verificationToken", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    if (dupRxTokens.length) issues.push("duplicate_prescription_verification_token");
  } catch (error) {
    if (error.code !== 26 && error.codeName !== "NamespaceNotFound") throw error;
  }

  const ready = collections.every(item => item.indexes.length > 0 && !item.missing.length && !item.conflicts.length) && issues.length === 0;

  return {
    ready,
    collections,
    issues,
    summary: {
      collections: collections.length,
      issues: issues.length,
      missingTotal: collections.reduce((sum, c) => sum + c.missing.length, 0),
      conflictsTotal: collections.reduce((sum, c) => sum + c.conflicts.length, 0),
    },
  };
}

export async function applyClinicalSchema({ dryRun = false } = {}) {
  const plan = await inspectClinicalSchema();

  if (plan.issues.length) {
    throw new Error(`Clinical data duplicates require operator review; no indexes applied: ${plan.issues.join(", ")}`);
  }

  if (plan.collections.some(item => item.conflicts.length)) {
    const allConflicts = plan.collections.flatMap(i => i.conflicts);
    throw new Error(`Conflicting clinical indexes require operator review: ${allConflicts.join(", ")}`);
  }

  if (dryRun) return plan;

  for (const Model of clinicalModels) {
    const collName = Model.collection.collectionName;
    const existing = await Model.db.db.listCollections({ name: collName }).toArray();
    if (!existing.length) {
      await Model.createCollection();
    }
    const item = plan.collections.find(c => c.collection === collName);
    if (item?.missing?.length) {
      for (const { key, options } of item.missing) {
        await Model.collection.createIndex(key, options);
      }
    }
  }

  await assertClinicalSchema();
  return plan;
}

export async function rollbackClinicalSchema(snapshot) {
  if (
    !snapshot ||
    snapshot.task !== "AG01" ||
    snapshot.database !== mongoose.connection.name ||
    !Array.isArray(snapshot.collections)
  ) {
    throw new Error("Backup does not match this database/task");
  }

  for (const item of snapshot.collections) {
    const Model = clinicalModels.find(m => m.collection.collectionName === item.collection);
    if (!Model) throw new Error("Unknown clinical collection in backup");

    const indexes = item.missing || item.indexes || [];
    for (const index of indexes) {
      const indexName = index.options?.name || index.name;
      const indexKey = index.key;
      const permitted = Model.schema.indexes().find(
        ([key, options]) => options.name === indexName && (!indexKey || canonical(key) === canonical(indexKey))
      );
      if (!indexName?.startsWith("ag01_") || !permitted) {
        throw new Error("Backup contains an invalid or non-AG01 index");
      }
    }
  }

  for (const item of snapshot.collections) {
    const Model = clinicalModels.find(m => m.collection.collectionName === item.collection);
    let current = [];
    try {
      current = await Model.collection.listIndexes().toArray();
    } catch (err) {
      if (err.code !== 26 && err.codeName !== "NamespaceNotFound") throw err;
    }

    const indexes = item.missing || item.indexes || [];
    for (const index of indexes) {
      const indexName = index.options?.name || index.name;
      const row = current.find(idx => idx.name === indexName);
      if (row) {
        await Model.collection.dropIndex(indexName);
      }
    }
  }
}

export async function assertClinicalSchema() {
  const plan = await inspectClinicalSchema();
  if (!plan.ready) {
    const detail = plan.issues.length
      ? `data duplicates: ${plan.issues.join(", ")}`
      : plan.collections
          .filter(c => c.missing.length || c.conflicts.length)
          .map(c => `${c.collection} (missing: ${c.missing.length}, conflicts: ${c.conflicts.length})`)
          .join("; ");
    throw new Error(`AG01 clinical and encounter schema requires initialization: ${detail}`);
  }
}

export async function assertClinicalWorkflowReady({ workflow = "clinical" } = {}) {
  try {
    await assertClinicalSchema();
  } catch (err) {
    throw accessError(503, `${workflow} workflow is undergoing maintenance. Clinical schema initialization is required.`);
  }
}
