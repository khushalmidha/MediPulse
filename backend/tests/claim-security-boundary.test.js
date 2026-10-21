import test from "node:test";
import assert from "node:assert/strict";
import EncounterJourney from "../model/encounterJourney.js";
import {requestClaimOtp,verifyClaimOtp,linkWalkInToAccount} from "../services/encounterJourneyService.js";

test("walk-in claim stages refuse synthetic proof outside tests before any record read",async t=>{
 const prior=process.env.NODE_ENV;
 const read=t.mock.method(EncounterJourney,"findById",()=>{throw new Error("Unexpected read");});
 try {
  for(const mode of ["production","development",undefined]){
   if(mode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=mode;
   for(const action of [requestClaimOtp,verifyClaimOtp,linkWalkInToAccount])await assert.rejects(action({encounterId:"000000000000000000000001",userId:"000000000000000000000002",otp:"123456",claimProof:"synthetic"}),error=>error.status===503 && /not configured/.test(error.message));
  }
  assert.equal(read.mock.callCount(),0);
 } finally {if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;}
});
