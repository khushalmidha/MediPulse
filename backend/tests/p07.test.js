import { createSnapshotGuard } from "../../frontend/src/utils/queueSnapshot.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyHostname, normalizeHostname, canClaimCustomDomain, RESERVED_HOST_LABELS } from "../util/productHosts.js";
import { resolveProductLocation } from "../../frontend/src/utils/productLocation.js";
import { queueContext, validateRequestedContext } from "../services/queueContext.js";
test("host normalization and parser copies agree", async () => {
  assert.equal(await readFile(new URL("../util/productHosts.js", import.meta.url), "utf8"), await readFile(new URL("../../frontend/src/utils/productHosts.js", import.meta.url), "utf8"));
  assert.equal(normalizeHostname(" FIXTURE.MEDIPULSE.LIVE.:443 "), "fixture.medipulse.live");
  for (const input of ["https://medipulse.live", "evil@medipulse.live", "fixture/other", "foo..live", "-foo.live", "foo.live:99999", "foo.live?x=1", "foo\\bar.live"]) assert.equal(normalizeHostname(input), null);
});
test("product hosts reserve platform names and fail closed on unknown hosts", () => {
  assert.equal(classifyHostname("medipulse.live").kind, "company");
  assert.equal(classifyHostname("WWW.MEDIPULSE.LIVE.").kind, "company");
  assert.equal(classifyHostname("connect.medipulse.live").kind, "connect");
  assert.equal(classifyHostname("app.medipulse.live").kind, "staff");
  for (const [label, expected] of [["connect", "connect"], ["app", "staff"], ["api", "unknown"]]) assert.equal(classifyHostname(`${label}.medipulse.live`, { appDomains: [`${label}.medipulse.live`] }).kind, expected);
  assert.deepEqual(classifyHostname("fixture.medipulse.live"), { host: "fixture.medipulse.live", kind: "hospital", slug: "fixture" });
  for (const label of RESERVED_HOST_LABELS.filter(value => !["www", "app", "connect"].includes(value))) assert.equal(classifyHostname(`${label}.medipulse.live`).kind, "unknown");
  for (const host of ["other.vercel.app", "evilmedipulse.live", "fixture.medipulse.live.evil.test", "a.b.medipulse.live"]) assert.equal(classifyHostname(host).kind, "unknown");
});
test("exact deployment aliases and external custom candidates are explicit", () => {
  assert.equal(classifyHostname("preview.vercel.app", { appDomains: ["preview.vercel.app"] }).kind, "company");
  assert.equal(classifyHostname("evil.preview.vercel.app", { appDomains: ["preview.vercel.app"] }).kind, "unknown");
  assert.equal(classifyHostname("care.example.test", { customDomainsEnabled: true }).kind, "custom");
  assert.equal(canClaimCustomDomain("connect.medipulse.live"), false);
  assert.equal(canClaimCustomDomain("fixture.medipulse.live"), false);
  assert.equal(canClaimCustomDomain("localhost"), false);
});
test("fallback basenames preserve nested care routes and host products", () => {
  const resolve = pathname => resolveProductLocation({ hostname: "medipulse.live", pathname });
  assert.equal(resolve("/").kind, "company");
  assert.equal(resolve("/connect/doctor/appointments").basename, "/connect");
  assert.equal(resolve("/connectivity").kind, "company");
  assert.equal(resolve("/hospital/login").kind, "staff");
  assert.equal(resolve("/staff/accept-invite").kind, "staff");
  assert.equal(resolve("/hospitals/fixture/visits/id").basename, "/hospitals/fixture");
  assert.equal(resolveProductLocation({ hostname: "connect.medipulse.live", pathname: "/login" }).basename, "/");
  assert.equal(resolveProductLocation({ hostname: "app.medipulse.live", pathname: "/login" }).kind, "staff");
});
test("explicit practice context rejects cross-product booking overrides", () => {
  const hospital = { _id: "hospital", settings: { queueSessionIds: ["day"] } };
  const independent = queueContext({ doctorId: "doctor" }), local = queueContext({ doctorId: "doctor", hospital });
  assert.equal(independent.practiceType, "independent"); assert.equal(independent.visitMode, "online");
  assert.equal(local.practiceType, "hospital"); assert.equal(local.hospitalId, "hospital");
  validateRequestedContext({}, local);
  validateRequestedContext({ practiceType: "hospital", visitMode: "in_person", hospitalId: "hospital" }, local);
  for (const body of [{ practiceType: "independent" }, { visitMode: "online" }, { hospitalId: "other" }, { queueKey: independent.queueKey }]) assert.throws(() => validateRequestedContext(body, local), { status: 409 });
});

test("queue authorization failures from prior requests cannot reset a new context", () => {
  const guard = createSnapshotGuard(), old = guard.begin("hospital-one");
  assert.equal(guard.isCurrent(old), true);
  const next = guard.begin("hospital-two"); assert.equal(guard.isCurrent(old), false);
  assert.equal(guard.isCurrent(next), true);
  guard.begin("hospital-two"); assert.equal(guard.isCurrent(next), false);
  guard.reset(); assert.equal(guard.isCurrent(old), false);
});

test("confirmed Vercel company alias is exact, product-aware and unavailable for tenant claims", () => {
  const alias = "medi-pulse-gamma.vercel.app";
  assert.equal(classifyHostname(alias).kind, "company");
  assert.equal(resolveProductLocation({ hostname: alias, pathname: "/connect/doctors" }).basename, "/connect");
  assert.equal(resolveProductLocation({ hostname: alias, pathname: "/hospital/login" }).kind, "staff");
  assert.equal(canClaimCustomDomain(alias), false);
  assert.equal(classifyHostname(alias, { baseDomain: "other.test" }).kind, "unknown");
  for (const host of ["evil." + alias, alias + ".evil.test", "other.vercel.app"]) assert.equal(classifyHostname(host).kind, "unknown");
});
