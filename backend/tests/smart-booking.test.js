import test from "node:test";
import assert from "node:assert/strict";
import { GoogleGenerativeAI, GoogleGenerativeAIAbortError } from "@google/generative-ai";
import { smartBookingAssessment } from "../controller/triage.js";
import Doctor from "../model/doctor.js";

const valid = { predictedDisease: "Needs clinician review", specialty: "Dermatology", severity: "LOW", esi_level: 5 };
test.beforeEach(t => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "synthetic-test-key";
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  t.mock.method(console, "error", () => {});
});
const provider = (t, run) => {
  const generate = t.mock.fn(run || (async () => ({ response: { text: () => JSON.stringify(valid) } })));
  const model = t.mock.method(GoogleGenerativeAI.prototype, "getGenerativeModel", () => ({ generateContent: generate }));
  return { model, generate };
};
const doctors = (t, rows = []) => {
  const query = { select: () => query, limit: () => query, lean: async () => rows };
  return t.mock.method(Doctor, "find", () => query);
};
const invoke = async symptoms => {
  let status, body;
  const res = { status(code) { status = code; return this; }, json(value) { body = value; } };
  await smartBookingAssessment({ body: { symptoms } }, res);
  return { status, body };
};

test("provider rate limits return a sanitized recoverable outage, not an assessment or HTTP 500", async t => {
  provider(t, async () => { throw Object.assign(new Error("provider-private-detail api-key=secret"), { status: 429 }); });
  const find = doctors(t), result = await invoke("Synthetic nonurgent concern");
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "AI_ASSESSMENT_UNAVAILABLE");
  assert.equal(result.body.reason, "rate_limited");
  assert.match(result.body.message, /browse doctors/i);
  assert.doesNotMatch(JSON.stringify(result), /secret|provider-private-detail/);
  assert.equal(result.body.severity, undefined);
  assert.equal(find.mock.callCount(), 0);
});

test("null and malformed provider JSON do not invent a normal urgency result", async t => {
  const { generate } = provider(t);
  const find = doctors(t);
  for (const text of ["null", "[]", "not JSON", JSON.stringify({ ...valid, specialty: {} }), JSON.stringify({ ...valid, esi_level: 0 })]) {
    generate.mock.mockImplementation(async () => ({ response: { text: () => text } }));
    const result = await invoke("Synthetic concern");
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "AI_ASSESSMENT_UNAVAILABLE");
    assert.equal(result.body.reason, "invalid_response");
    assert.equal(result.body.severity, undefined);
  }
  assert.equal(find.mock.callCount(), 0);
});

test("provider access, request and service errors retain safe actionable classifications", async t => {
  const { generate } = provider(t);
  for (const [status, reason] of [[400, "provider_request_rejected"], [401, "provider_access_denied"], [403, "provider_access_denied"], [404, "model_unavailable"], [500, "provider_unavailable"], [503, "provider_unavailable"]]) {
    generate.mock.mockImplementation(async () => { throw Object.assign(new Error("private provider detail"), { status }); });
    const result = await invoke("Synthetic concern");
    assert.equal(result.status, 503);
    assert.equal(result.body.reason, reason);
    assert.doesNotMatch(JSON.stringify(result), /private provider detail/);
  }
});

test("the real SDK's abort error is reported as a timeout", async t => {
  provider(t, async () => { throw new GoogleGenerativeAIAbortError("private provider timeout"); });
  const result = await invoke("Synthetic concern");
  assert.equal(result.status, 503);
  assert.equal(result.body.reason, "timeout");
});

test("valid structured and fenced JSON retain actual doctor fees and profile identity", async t => {
  const { model, generate } = provider(t);
  const find = doctors(t, [{ _id: "synthetic-doctor", firstName: "Synthetic", lastName: "Doctor", experience: { expertise: "Dermatology", years: 0 }, consultationFee: 725 }]);
  for (const text of [JSON.stringify(valid), "```json\n" + JSON.stringify(valid) + "\n``` "]) {
    generate.mock.mockImplementation(async () => ({ response: { text: () => text } }));
    const { status, body } = await invoke(" Synthetic concern ");
    assert.equal(status, 200);
    assert.equal(body.specialty, "Dermatology");
    assert.equal(body.ranked_doctors[0].fee, 725);
    assert.equal(body.ranked_doctors[0].experience, 0);
    assert.deepEqual(find.mock.calls.at(-1).arguments[0], { "experience.expertise": "Dermatology" });
  }
  assert.equal(model.mock.calls[0].arguments[0].generationConfig.responseMimeType, "application/json");
  assert.equal(model.mock.calls[0].arguments[1].timeout, 10000);
  assert.equal(generate.mock.calls[0].arguments[0].contents[0].parts[0].text, "Synthetic concern");
});

test("blank, oversized and nontext symptoms are rejected without a model request", async t => {
  const { model } = provider(t);
  for (const symptoms of [undefined, null, "", "  ", [], {}, "x".repeat(4001)]) assert.equal((await invoke(symptoms)).status, 400);
  assert.equal(model.mock.callCount(), 0);
});

test("missing provider configuration remains an explicit outage", async t => {
  delete process.env.GEMINI_API_KEY;
  const { model } = provider(t);
  const result = await invoke("Synthetic concern");
  assert.equal(result.status, 503);
  assert.equal(result.body.reason, "not_configured");
  assert.equal(model.mock.callCount(), 0);
});

test("a provider that never settles is bounded without automatic billable retries", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { generate } = provider(t, () => new Promise(() => {}));
  const pending = invoke("Synthetic concern");
  t.mock.timers.tick(11000);
  const { status, body } = await pending;
  assert.equal(status, 503);
  assert.equal(body.code, "AI_ASSESSMENT_UNAVAILABLE");
  assert.equal(body.reason, "timeout");
  assert.equal(generate.mock.callCount(), 1);
});

test("existing red-flag rules work without AI and do not offer booking profiles", async t => {
  delete process.env.GEMINI_API_KEY;
  const { model } = provider(t), find = doctors(t);
  const { status, body } = await invoke("Chest pain spreading to my left arm");
  assert.equal(status, 200);
  assert.equal(body.severity, "EMERGENCY");
  assert.ok(body.safetyFlags.length > 0);
  assert.deepEqual(body.ranked_doctors, []);
  assert.equal(model.mock.callCount(), 0);
  assert.equal(find.mock.callCount(), 0);
});

test("provider emergency output skips directory lookup even if its severity disagrees", async t => {
  provider(t, async () => ({ response: { text: () => JSON.stringify({ ...valid, esi_level: 1 }) } }));
  const find = doctors(t), { status, body } = await invoke("Synthetic concern");
  assert.equal(status, 200);
  assert.deepEqual(body.ranked_doctors, []);
  assert.equal(find.mock.callCount(), 0);
});

test("directory outages do not expose database details or report an empty successful result", async t => {
  provider(t);
  t.mock.method(Doctor, "find", () => { throw new Error("private mongodb://credentials@example.invalid"); });
  const result = await invoke("Synthetic concern");
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "DOCTOR_DIRECTORY_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result), /mongodb|credentials/);
});
