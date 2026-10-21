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

export function validateWalkInLinking(token, user, options = {}) {
  if (!token?.isWalkIn) return { allowed: false, reason: "Not a walk-in token" };
  if (token.linkedUserId) return { allowed: false, reason: "Already linked to an account" };
  if (!user?._id) return { allowed: false, reason: "Authentication required" };
  if (options.claimProofRequired && (!options.claimProof || !options.claimProof.trim())) {
    return { allowed: false, reason: "Claim proof is required" };
  }
  if (options.expiresAt && new Date(options.expiresAt) <= new Date()) {
    return { allowed: false, reason: "Claim proof expired" };
  }
  return { allowed: true, userId: user._id };
}

export function validateCustodyHandoff({ file, currentStaffId, toStaffId, expectedRevision, isAdmin = false }) {
  if (!toStaffId) return { allowed: false, reason: "Target recipient is required" };
  if (String(currentStaffId) === String(toStaffId)) return { allowed: false, reason: "Cannot hand off file to yourself" };
  if (typeof expectedRevision !== "number") return { allowed: false, reason: "expectedRevision must be a number" };
  if (file?.currentHolderId && String(file.currentHolderId) !== String(currentStaffId) && !isAdmin) {
    return { allowed: false, reason: "Only current holder or admin can initiate handoff" };
  }
  if (file?.pendingHandoff) return { allowed: false, reason: "A handoff is already pending" };
  return { allowed: true };
}

export function validateHandoffAcceptance({ pendingHandoff, callerStaffId, expectedRevision }) {
  if (!pendingHandoff) return { allowed: false, reason: "No pending handoff to accept" };
  if (typeof expectedRevision !== "number") return { allowed: false, reason: "expectedRevision must be a number" };
  if (String(pendingHandoff.toActorId) !== String(callerStaffId)) {
    return { allowed: false, reason: "Only designated recipient can accept file custody" };
  }
  return { allowed: true };
}

export function validateHandoffRefusal({ pendingHandoff, callerStaffId, reason, expectedRevision, isAdmin = false }) {
  if (!pendingHandoff) return { allowed: false, reason: "No pending handoff to refuse" };
  if (!reason || !reason.trim()) return { allowed: false, reason: "Refusal reason is required" };
  if (typeof expectedRevision !== "number") return { allowed: false, reason: "expectedRevision must be a number" };
  if (String(pendingHandoff.toActorId) !== String(callerStaffId) && !isAdmin) {
    return { allowed: false, reason: "Only designated recipient can refuse file custody" };
  }
  return { allowed: true };
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

    const result = validateWalkInLinking(walkInToken, user, { claimProofRequired: true, claimProof: "proof_123" });
    assert.equal(result.allowed, true);
    assert.equal(result.userId, "usr_001");

    // Missing claim proof is blocked
    const missingProof = validateWalkInLinking(walkInToken, user, { claimProofRequired: true, claimProof: "" });
    assert.equal(missingProof.allowed, false);
    assert.equal(missingProof.reason, "Claim proof is required");

    // Expired claim proof is blocked
    const expiredProof = validateWalkInLinking(walkInToken, user, {
      claimProofRequired: true,
      claimProof: "proof_123",
      expiresAt: new Date(Date.now() - 5000),
    });
    assert.equal(expiredProof.allowed, false);
    assert.equal(expiredProof.reason, "Claim proof expired");

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

  await t.test("validates physical file custody handoff, recipient acceptance, and refusal rules", () => {
    // 1. Cannot hand off to self
    const selfHandoff = validateCustodyHandoff({
      file: { currentHolderId: "staff_01" },
      currentStaffId: "staff_01",
      toStaffId: "staff_01",
      expectedRevision: 1,
    });
    assert.equal(selfHandoff.allowed, false);
    assert.equal(selfHandoff.reason, "Cannot hand off file to yourself");

    // 2. Non-holder cannot initiate handoff
    const nonHolderHandoff = validateCustodyHandoff({
      file: { currentHolderId: "staff_01" },
      currentStaffId: "staff_02",
      toStaffId: "staff_03",
      expectedRevision: 1,
    });
    assert.equal(nonHolderHandoff.allowed, false);

    // 3. Holder initiates valid handoff
    const validHandoff = validateCustodyHandoff({
      file: { currentHolderId: "staff_01" },
      currentStaffId: "staff_01",
      toStaffId: "staff_02",
      expectedRevision: 1,
    });
    assert.equal(validHandoff.allowed, true);

    // 4. Non-recipient cannot accept
    const wrongRecipient = validateHandoffAcceptance({
      pendingHandoff: { toActorId: "staff_02" },
      callerStaffId: "staff_03",
      expectedRevision: 2,
    });
    assert.equal(wrongRecipient.allowed, false);

    // 5. Designated recipient can accept
    const correctRecipient = validateHandoffAcceptance({
      pendingHandoff: { toActorId: "staff_02" },
      callerStaffId: "staff_02",
      expectedRevision: 2,
    });
    assert.equal(correctRecipient.allowed, true);

    // 6. Refusal requires non-empty reason
    const emptyRefusal = validateHandoffRefusal({
      pendingHandoff: { toActorId: "staff_02" },
      callerStaffId: "staff_02",
      reason: "   ",
      expectedRevision: 2,
    });
    assert.equal(emptyRefusal.allowed, false);

    // 7. Designated recipient can refuse with reason
    const validRefusal = validateHandoffRefusal({
      pendingHandoff: { toActorId: "staff_02" },
      callerStaffId: "staff_02",
      reason: "Not on duty in this department",
      expectedRevision: 2,
    });
    assert.equal(validRefusal.allowed, true);
  });
});
