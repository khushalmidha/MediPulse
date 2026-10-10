import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { localTestTargets } from "../../util/testTargets.js";
import { planDemoRecovery, applyDemoRecovery, verifyDemoPreservation, restoreDemoRecovery, recoveryHash } from "../../services/demoRecovery.js";
import OpdToken from "../../model/opdToken.js";
import Appointment from "../../model/appointment.js";
import VirtualRefund from "../../model/virtualRefund.js";

test("isolated transactional demo preservation rejects drift and restores exact BSON originals", async () => {
  const targets = localTestTargets(), url = new URL(targets.mongo);
  url.pathname = `/medipulse_test_p23_${crypto.randomBytes(5).toString("hex")}`;
  await mongoose.connect(url.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  try {
    const models = [OpdToken, Appointment, VirtualRefund];
    for (const model of models) await model.createCollection();
    const appointment = { _id: new mongoose.Types.ObjectId(), status: "cancelled", createdAt: new Date("2025-01-01"), payment: { amount: mongoose.mongo.BSON.Decimal128.fromString("123.00") } };
    const token = { _id: new mongoose.Types.ObjectId(), appointmentId: appointment._id, status: "waiting" };
    const refund = { _id: new mongoose.Types.ObjectId(), status: "COMPLETED", amount: 123 };
    for (const [model, row] of [[OpdToken, token], [Appointment, appointment], [VirtualRefund, refund]]) await model.collection.insertOne(row);
    const plan = planDemoRecovery({ database: mongoose.connection.name, tokens: [token], appointments: [appointment], refunds: [refund],
      queue: { tokens: [token], appointments: [{ ...appointment, visitMode: "online" }], issues: ["linked_state_mismatch"] },
      money: { plans: [[], [], [], [appointment]], issues: ["invalid_refund_link"] } });
    const approved = { syntheticConfirmed: true, writersPaused: true, backupVerified: true };
    await assert.rejects(applyDemoRecovery(mongoose.connection, { ...plan, fingerprints: { ...plan.fingerprints, appointments: "changed" } }, approved), /Data changed/);
    assert.equal(await Appointment.collection.countDocuments(), 1);
    const result = await applyDemoRecovery(mongoose.connection, plan, approved);
    assert.equal(result.preserved, 3); await verifyDemoPreservation(mongoose.connection, plan, result.runId);
    for (const model of models) assert.equal(await model.collection.countDocuments(), 0);
    const drift = { _id: new mongoose.Types.ObjectId(), status: "completed" };
    await Appointment.collection.insertOne(drift);
    await assert.rejects(restoreDemoRecovery(mongoose.connection, result.runId, approved), /Data changed/);
    assert.equal(await OpdToken.collection.countDocuments(), 0);
    await Appointment.collection.deleteOne({ _id: drift._id });
    await restoreDemoRecovery(mongoose.connection, result.runId, approved);
    for (const [model, row] of [[OpdToken, token], [Appointment, appointment], [VirtualRefund, refund]]) assert.equal(recoveryHash(await model.collection.findOne({ _id: row._id })), recoveryHash(row));
    assert.equal(await mongoose.connection.db.collection("p23_preserved_demo_records").countDocuments(), 3);
    await assert.rejects(restoreDemoRecovery(mongoose.connection, result.runId, approved), /unavailable/);
  } finally {
    localTestTargets({ TEST_DATABASE_URL: url.href, TEST_REDIS_URL: targets.redis });
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
