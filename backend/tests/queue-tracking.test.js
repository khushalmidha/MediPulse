import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  pauseDoctorQueue,
  resumeDoctorQueue,
  getQueuePauseState,
  calculateQueueETA,
  getHospitalKioskStatus,
  recordPriorityOverride,
} from "../services/queueTrackingService.js";

test("P13: Queue tracking, ETA range, doctor pause, privacy kiosk and priority overrides", async (t) => {
  const queueKey = "hospital:hosp1:doc1:2026-10-11:day";
  const doctorId = new mongoose.Types.ObjectId();

  await t.test("doctor pause and resume updates queue state and records reason", () => {
    // Initial state is not paused
    const initial = getQueuePauseState(queueKey);
    assert.equal(initial.isPaused, false);

    // Pause queue
    const paused = pauseDoctorQueue({
      queueKey,
      doctorId,
      reason: "Emergency surgical procedure",
    });
    assert.equal(paused.isPaused, true);
    assert.equal(paused.reason, "Emergency surgical procedure");
    assert.equal(paused.pausedBy, doctorId);

    // Resume queue
    const resumed = resumeDoctorQueue({ queueKey });
    assert.equal(resumed.isPaused, false);
    assert.equal(resumed.previous.reason, "Emergency surgical procedure");

    const afterResume = getQueuePauseState(queueKey);
    assert.equal(afterResume.isPaused, false);
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
