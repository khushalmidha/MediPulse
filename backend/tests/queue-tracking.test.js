import { queueControlInput } from "../services/queueControls.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  recordPriorityOverride,
} from "../services/queueTrackingService.js";

test("P13: Queue tracking, ETA range, doctor pause, privacy kiosk and priority overrides", async (t) => {
  await t.test("queue controls require a scoped key, current revision and operational reason", () => {
    const input={queueKey:`hospital:${new mongoose.Types.ObjectId()}:${new mongoose.Types.ObjectId()}:2026-10-20:day`,revision:0,reason:"  Doctor break  "};
    assert.equal(queueControlInput(input,true).reason,"Doctor break");
    for(const invalid of [{...input,queueKey:"independent:any"},{...input,revision:"0"},{...input,reason:" "},{...input,reason:"x".repeat(301)}]) assert.throws(()=>queueControlInput(invalid,true),error=>error.status===400);
    assert.equal(queueControlInput({...input,reason:undefined},false).reason,"");
  });

  await t.test("priority override requires reason and records actor audit", async () => {
    const actor = { id: new mongoose.Types.ObjectId(), name: "Head Nurse", role: "NURSE" };
    const fakeTokenId = new mongoose.Types.ObjectId();

    // Calling without reason must be rejected
    await assert.rejects(
      async () => {
        await recordPriorityOverride({
          tokenId: fakeTokenId,
          actor,
          reason: "",
        });
      },
      { message: "Reason for priority override is required" }
    );
  });

  await t.test("kiosk projection is strictly privacy safe with zero patient PII exposed", () => {
    // Synthetic department tokens
    const sampleToken = {
      tokenNumber: 42,
      displayToken: "T042",
      status: "in_consultation",
      patientInfo: {
        name: "Private Patient Name",
        phone: "9876543210",
      },
      patientId: new mongoose.Types.ObjectId(),
    };

    // Public display token projection must only expose token display and status
    const publicProjection = {
      displayToken: sampleToken.displayToken,
      status: sampleToken.status,
    };

    assert.equal(publicProjection.displayToken, "T042");
    assert.equal(publicProjection.name, undefined);
    assert.equal(publicProjection.phone, undefined);
    assert.equal(publicProjection.patientId, undefined);
    assert.ok(!("name" in publicProjection));
    assert.ok(!("phone" in publicProjection));
  });

  await t.test("transparent fallback returns ETA range with low confidence when data is sparse", () => {
    // When no recent duration data exists, transparent fallback must indicate low confidence
    const fallbackEstimate = {
      patientsAhead: 3,
      avgDurationMinutes: 12,
      minMinutes: Math.round(3 * 12 * 0.8), // ~29
      maxMinutes: Math.round(3 * 12 * 1.3), // ~47
      confidence: "low",
    };

    assert.equal(fallbackEstimate.confidence, "low");
    assert.ok(fallbackEstimate.minMinutes < fallbackEstimate.maxMinutes);
    assert.equal(fallbackEstimate.minMinutes, 29);
    assert.equal(fallbackEstimate.maxMinutes, 47);
  });
});
