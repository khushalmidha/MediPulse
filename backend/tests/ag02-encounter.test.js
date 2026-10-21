import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import EncounterJourney from "../model/encounterJourney.js";
import {
  initializeEncounterJourney,
  getEncounterGuidance,
} from "../services/encounterJourneyService.js";

test("AG02: EncounterJourney schema includes personKey and autoIndex is disabled", () => {
  assert.equal(EncounterJourney.schema.options.autoIndex, false);
  const personKeyPath = EncounterJourney.schema.path("personKey");
  assert.ok(personKeyPath, "personKey path must exist in EncounterJourney schema");
  assert.equal(personKeyPath.instance, "String");

  const indexes = EncounterJourney.schema.indexes();
  const tokenIdx = indexes.find(([, opt]) => opt.name === "ag01_encounter_token_unique");
  assert.ok(tokenIdx, "ag01_encounter_token_unique must exist");
  assert.equal(tokenIdx[1].unique, true);

  const apptIdx = indexes.find(([, opt]) => opt.name === "ag01_encounter_appointment_unique");
  assert.ok(apptIdx, "ag01_encounter_appointment_unique must exist");
  assert.equal(apptIdx[1].unique, true);
});

test("AG02: initializeEncounterJourney returns null when database is disconnected", async () => {
  // Ensure connection is disconnected
  const readyState = mongoose.connection?.readyState;
  if (readyState === 0) {
    const result = await initializeEncounterJourney({
      hospitalId: new mongoose.Types.ObjectId(),
      departmentId: new mongoose.Types.ObjectId(),
      tokenId: new mongoose.Types.ObjectId(),
    });
    assert.equal(result, null);
  }
});
