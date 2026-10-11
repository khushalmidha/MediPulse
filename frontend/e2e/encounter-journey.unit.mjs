import test from "node:test";
import assert from "node:assert/strict";

export function formatGuidanceDestination(dest) {
  if (!dest || !dest.name || dest.name === "not recorded") {
    return {
      title: "Not recorded",
      location: "Ask reception for directions",
      instructions: dest?.instructions || "Follow directions from hospital staff.",
    };
  }
  const parts = [dest.building, dest.floor, dest.roomNumber ? `Room ${dest.roomNumber}` : null].filter(Boolean);
  return {
    title: dest.name,
    location: parts.length > 0 ? parts.join(" · ") : "Hospital Campus",
    instructions: dest.instructions || `Proceed to ${dest.name}`,
  };
}

export function formatFileCustody(file) {
  if (!file || !file.tracked) {
    return {
      status: "Electronic record only",
      holder: "Digital workflow",
      location: "Electronic queue",
    };
  }
  return {
    status: "Physical file active",
    holder: file.holder || "not recorded",
    location: file.location || "not recorded",
  };
}

export function validateWalkInLinking(token, user) {
  if (!token?.isWalkIn) return { allowed: false, reason: "Not a walk-in token" };
  if (token.linkedUserId) return { allowed: false, reason: "Already linked to an account" };
  if (!user?._id) return { allowed: false, reason: "Authentication required" };
  return { allowed: true, userId: user._id };
}

test("P12: Encounter guidance formatting, custody fallback and walk-in linking", async (t) => {
  await t.test("formats complete destination with building, floor and room", () => {
    const dest = {
      name: "Cardiology OPD Room 204",
      building: "Tower B",
      floor: "2nd Floor",
      roomNumber: "204",
      instructions: "Follow blue line from elevator to Room 204",
    };
    const formatted = formatGuidanceDestination(dest);
    assert.equal(formatted.title, "Cardiology OPD Room 204");
    assert.equal(formatted.location, "Tower B · 2nd Floor · Room 204");
    assert.equal(formatted.instructions, "Follow blue line from elevator to Room 204");
  });

  await t.test("falls back to 'not recorded' when destination is missing or unknown", () => {
    const formatted = formatGuidanceDestination(null);
    assert.equal(formatted.title, "Not recorded");
    assert.equal(formatted.location, "Ask reception for directions");

    const formattedNotRecorded = formatGuidanceDestination({ name: "not recorded" });
    assert.equal(formattedNotRecorded.title, "Not recorded");
  });

  await t.test("shows 'not recorded' for physical file location when unknown", () => {
    const custody = formatFileCustody({
      tracked: true,
      holder: "Nurse Sarah",
      location: "not recorded",
    });
    assert.equal(custody.status, "Physical file active");
    assert.equal(custody.holder, "Nurse Sarah");
    assert.equal(custody.location, "not recorded");
  });

  await t.test("allows valid walk-in account linking and prevents double linking", () => {
    const user = { _id: "usr_001" };
    const walkInToken = { isWalkIn: true, linkedUserId: null };

    const result = validateWalkInLinking(walkInToken, user);
    assert.equal(result.allowed, true);
    assert.equal(result.userId, "usr_001");

    // Double linking is blocked
    const alreadyLinkedToken = { isWalkIn: true, linkedUserId: "usr_001" };
    const blocked = validateWalkInLinking(alreadyLinkedToken, user);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, "Already linked to an account");

    // Regular non-walk-in token cannot be linked
    const regularToken = { isWalkIn: false };
    const invalid = validateWalkInLinking(regularToken, user);
    assert.equal(invalid.allowed, false);
    assert.equal(invalid.reason, "Not a walk-in token");
  });
});
