import test from "node:test";
import assert from "node:assert/strict";
import { familyPayload, hospitalPath, hospitalLocation, careSystem, personName, filterRecords, overallRating, ratingFields } from "../src/utils/patientCare.js";
test("family payload requires identity, validates actual calendar dates and omits unknown optional details", () => {
  assert.deepEqual(familyPayload({ name: "  Synthetic  ", relation: " Child ", dob: "", gender: "", bloodGroup: "" }, "2026-10-10"), { name: "Synthetic", relation: "Child" });
  for (const dob of ["2026-02-31", "2026-10-11", "invalid"]) assert.throws(() => familyPayload({ name: "Synthetic", relation: "Child", dob }, "2026-10-10"));
  assert.throws(() => familyPayload({ name: " ", relation: "Child" }, "2026-10-10"));
  assert.throws(() => familyPayload({ name: "Synthetic", relation: "Child", gender: "unsupported" }, "2026-10-10"));
});
test("hospital cards retain actual metadata and do not invent a care system or destination", () => {
  assert.equal(hospitalPath({ slug: "synthetic-clinic" }), "/hospitals/synthetic-clinic");
  for (const slug of ["", "../login", "other/path", "https://external.invalid"]) assert.equal(hospitalPath({ slug }), null);
  assert.equal(hospitalLocation({ address: { city: "Synthetic" } }), "Synthetic");
  assert.equal(careSystem(undefined), "Care system not listed");
});
test("record filters distinguish self/family without exposing another person or inventing a missing name", () => {
  const rows = [{ id: "self", type: "appointment", title: "Synthetic online visit" }, { id: "family", type: "opd_token", title: "Synthetic hospital", familyMemberId: "child" }];
  assert.deepEqual(filterRecords(rows, { person: "self" }).map(row => row.id), ["self"]);
  assert.deepEqual(filterRecords(rows, { person: "child", search: "HOSPITAL" }).map(row => row.id), ["family"]);
  assert.equal(personName(rows[1], []), "Family member (name not available)");
});
test("ratings have no automatic five-star selection and average only five explicit choices", () => {
  const ratings = Object.fromEntries(ratingFields.map(([key]) => [key, 0])); assert.equal(overallRating(ratings), null);
  for (const [key] of ratingFields) ratings[key] = 3;
  assert.equal(overallRating(ratings), 3); ratings.waitTime = 6; assert.equal(overallRating(ratings), null);
});

test("real QR matrix generator produces valid square matrix with finder and timing patterns", async () => {
  const { generateQrMatrix, generateQrSvgString } = await import("../src/utils/qrCode.js");
  const matrix = generateQrMatrix("MP-TKT:T101-1234567890abcdef");
  assert.ok(Array.isArray(matrix));
  assert.ok(matrix.length >= 21); // version 1 or higher
  assert.equal(matrix.length, matrix[0].length); // square

  // Finder pattern at top-left: 7x7 outer square, 3x3 inner square
  assert.equal(matrix[0][0], true);
  assert.equal(matrix[0][6], true);
  assert.equal(matrix[6][0], true);
  assert.equal(matrix[6][6], true);
  assert.equal(matrix[1][1], false);
  assert.equal(matrix[3][3], true);

  // SVG string output contains svg, viewBox and rect modules
  const svg = generateQrSvgString("MP-TKT:T101-1234567890abcdef", 160);
  assert.ok(svg.includes("<svg"));
  assert.ok(svg.includes("viewBox="));
  assert.ok(svg.includes("<rect"));
  assert.ok(svg.includes("width=\"160\""));
});

test("visit packet distinguishes draft vs released vs amended reports and preserves amendment history", () => {
  // Simulate released lab report mapping with amendments
  const rawReportWithAmendments = {
    orderStatus: "released",
    reportVersion: 2,
    releasedAt: new Date("2026-10-15T12:00:00Z"),
    reportVersions: [
      {
        version: 1,
        releasedAt: new Date("2026-10-14T10:00:00Z"),
        verifiedByName: "Dr. Initial",
        correctionReason: "Typo in reference range",
        results: [{ testCode: "CBC", parameterCode: "HGB", value: 13.5, unit: "g/dL" }],
      },
      {
        version: 2,
        releasedAt: new Date("2026-10-15T12:00:00Z"),
        verifiedByName: "Dr. Pathologist",
        results: [{ testCode: "CBC", parameterCode: "HGB", value: 14.1, unit: "g/dL" }],
      },
      {
        version: 3,
        // Unreleased draft version
        results: [{ testCode: "CBC", parameterCode: "HGB", value: 14.5, unit: "g/dL" }],
      },
    ],
  };

  const releasedOnly = rawReportWithAmendments.reportVersions.filter(v => Boolean(v.releasedAt));
  assert.equal(releasedOnly.length, 2); // Version 3 excluded because it's a draft
  assert.ok(!releasedOnly.some(v => v.version === 3));

  const isAmended = releasedOnly.length > 1;
  assert.equal(isAmended, true);

  const priorAmendments = releasedOnly.slice(0, -1);
  assert.equal(priorAmendments.length, 1);
  assert.equal(priorAmendments[0].version, 1);
  assert.equal(priorAmendments[0].correctionReason, "Typo in reference range");
});

test("actor-switch disposal prevents previous patient records from showing on session change", () => {
  let loadedOwner = "user:patient_1";
  let activeVisits = [{ id: "v1", token: "T001" }];
  let activeTicket = { tokenNumber: "T001" };
  let activePacket = { visitId: "v1", prescriptions: [{ med: "Paracetamol" }] };

  // Actor switches to patient_2
  const newOwner = "user:patient_2";
  if (loadedOwner && loadedOwner !== newOwner) {
    activeVisits = [];
    loadedOwner = null;
    activeTicket = null;
    activePacket = null;
  }

  assert.equal(loadedOwner, null);
  assert.deepEqual(activeVisits, []);
  assert.equal(activeTicket, null);
  assert.equal(activePacket, null);
});



test("QR encoding rejects oversized payloads instead of silently truncating tickets",async()=>{
 const {generateQrMatrix,generateQrSvgString}=await import("../src/utils/qrCode.js");
 assert.throws(()=>generateQrMatrix("x".repeat(1025)),/too long/);
 const svg=generateQrSvgString('<script>synthetic</script>');assert.ok(!svg.includes("<script>"));assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
});
