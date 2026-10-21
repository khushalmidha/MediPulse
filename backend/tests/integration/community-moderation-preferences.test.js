import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { localTestTargets } from "../../util/testTargets.js";
import Community from "../../model/community.js";
import Message from "../../model/message.js";
import Event from "../../model/event.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import AuthSession from "../../model/authSession.js";
import OutboxJob from "../../model/outboxJob.js";
import communityRouter from "../../routes/community.js";
import eventRouter from "../../routes/event.js";
import { deliverOutboxJob } from "../../services/outboxDelivery.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_comm_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
let server, origin;

const doctorOrganizerId = id();
const memberUser1Id = id();
const memberUser2Id = id();
const nonMemberUserId = id();

let doctorToken = null;
let member1Token = null;
let member2Token = null;
let nonMemberToken = null;

let communityId = null;

async function makeSessionToken(principalId, role) {
  const sid = crypto.randomUUID();
  await AuthSession.create({
    _id: sid,
    principalId,
    kind: role,
    csrfToken: "isolated-csrf",
    expiresAt: new Date(Date.now() + 600000),
  });
  return jwt.sign(
    {
      sid,
      id: String(principalId),
      role,
      name: role === "doctor" ? "Dr. Organizer" : `Member ${String(principalId).slice(-4)}`,
    },
    process.env.TOKEN_KEY,
    { expiresIn: "1h" }
  );
}

before(async () => {
  process.env.TOKEN_KEY = "test-secret-key-32-chars-long-comm-test!!";
  process.env.REQUIRE_CLINICAL_SCHEMA = "false";
  process.env.DISABLE_SCHEDULE_CRON = "true";
  process.env.TEST_DATABASE_URL = uri.toString();

  await mongoose.connect(uri.toString(), { directConnection: true });

  await Doctor.create({
    _id: doctorOrganizerId,
    firstName: "Organizer",
    lastName: "Doctor",
    gender: "other",
    experience: { expertise: "Cardiology", years: 10 },
    email: "organizer@example.com",
    password: "Password123!",
    isPublished: true,
    credentialVerification: { status: "verified" },
    independentPractice: { enabled: true },
  });

  await User.create([
    {
      _id: memberUser1Id,
      firstName: "Alice",
      lastName: "Member",
      gender: "other",
      email: "alice@example.com",
      password: "Password123!",
    },
    {
      _id: memberUser2Id,
      firstName: "Bob",
      lastName: "Member",
      gender: "other",
      email: "bob@example.com",
      password: "Password123!",
    },
    {
      _id: nonMemberUserId,
      firstName: "Eve",
      lastName: "Outsider",
      gender: "other",
      email: "eve@example.com",
      password: "Password123!",
    },
  ]);

  doctorToken = await makeSessionToken(doctorOrganizerId, "doctor");
  member1Token = await makeSessionToken(memberUser1Id, "user");
  member2Token = await makeSessionToken(memberUser2Id, "user");
  nonMemberToken = await makeSessionToken(nonMemberUserId, "user");

  const communityDoc = await Community.create({
    title: "Cardiology & Wellness Hub",
    bio: "Doctor-moderated cardiovascular support and learning community.",
    category: "Health",
    author: doctorOrganizerId,
    members: [doctorOrganizerId, memberUser1Id, memberUser2Id],
    memberPreferences: [
      {
        memberId: memberUser1Id,
        emailNotifications: true,
        inAppNotifications: true,
      },
      {
        memberId: memberUser2Id,
        emailNotifications: false,
        inAppNotifications: false,
      },
    ],
  });
  communityId = communityDoc._id;

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/community", communityRouter);
  app.use("/api/event", eventRouter);

  server = app.listen(0);
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(r => server.close(r));
  await mongoose.connection?.dropDatabase().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  await closeRedis().catch(() => {});
});

test("AG13: Community moderation, pagination and preference delivery", async (t) => {

  await t.test("1. Bounded and paginated message history", async () => {
    // Seed 5 messages
    for (let i = 1; i <= 5; i++) {
      await Message.create({
        community: communityId,
        author: memberUser1Id,
        author_name: "Alice Member",
        content: `Message ${i} from Alice`,
      });
    }

    // Query with page=1, limit=2
    const resPage1 = await fetch(`${origin}/api/community/${communityId}?page=1&limit=2`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.equal(resPage1.status, 200);
    const bodyPage1 = await resPage1.json();
    assert.ok(bodyPage1.pagination);
    assert.equal(bodyPage1.pagination.page, 1);
    assert.equal(bodyPage1.pagination.limit, 2);
    assert.equal(bodyPage1.pagination.totalMessages, 5);
    assert.equal(bodyPage1.pagination.totalPages, 3);
    assert.equal(bodyPage1.messages.length, 2);
    assert.equal(bodyPage1.messages[0].content, "Message 1 from Alice");
    assert.equal(bodyPage1.messages[1].content, "Message 2 from Alice");

    // Query with page=2, limit=2
    const resPage2 = await fetch(`${origin}/api/community/${communityId}?page=2&limit=2`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.equal(resPage2.status, 200);
    const bodyPage2 = await resPage2.json();
    assert.equal(bodyPage2.messages.length, 2);
    assert.equal(bodyPage2.messages[0].content, "Message 3 from Alice");

    // Non-member access is rejected
    const resForbidden = await fetch(`${origin}/api/community/${communityId}?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${nonMemberToken}` },
    });
    assert.equal(resForbidden.status, 403);
  });

  await t.test("2. Bounded and paginated community member list with zero preference or report leakage", async () => {
    const resMembers = await fetch(`${origin}/api/community/${communityId}/members?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.equal(resMembers.status, 200);
    const body = await resMembers.json();

    assert.ok(body.pagination);
    assert.equal(body.pagination.totalMembers, 3);
    assert.equal(body.members.length, 3);

    // Verify sanitization: no memberPreferences, reports, passwords, or emails exposed
    for (const member of body.members) {
      assert.ok(member._id);
      assert.ok(member.name);
      assert.ok(member.role);
      assert.equal(Object.hasOwn(member, "memberPreferences"), false);
      assert.equal(Object.hasOwn(member, "reports"), false);
      assert.equal(Object.hasOwn(member, "password"), false);
      assert.equal(Object.hasOwn(member, "email"), false);
    }
  });

  let messageToReportId = null;

  await t.test("3. Reporting a message with validation and duplicate prevention", async () => {
    // Member 1 creates a message
    const msg = await Message.create({
      community: communityId,
      author: memberUser1Id,
      author_name: "Alice Member",
      content: "Suspicious unverified medical claim regarding raw supplements",
    });
    messageToReportId = msg._id;

    // Empty reason fails with 400
    const emptyRes = await fetch(`${origin}/api/community/${communityId}/messages/${messageToReportId}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member2Token}`,
      },
      body: JSON.stringify({ reason: "   " }),
    });
    assert.equal(emptyRes.status, 400);

    // Valid report succeeds
    const reportRes = await fetch(`${origin}/api/community/${communityId}/messages/${messageToReportId}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member2Token}`,
      },
      body: JSON.stringify({ reason: "Potentially harmful unverified claim" }),
    });
    assert.equal(reportRes.status, 200);
    const reportBody = await reportRes.json();
    assert.equal(reportBody.message, "Message reported for doctor review");

    // Duplicate report by same user is rejected with 409
    const dupRes = await fetch(`${origin}/api/community/${communityId}/messages/${messageToReportId}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member2Token}`,
      },
      body: JSON.stringify({ reason: "Duplicate complaint" }),
    });
    assert.equal(dupRes.status, 409);
  });

  await t.test("4. Restricted evidence visibility: ordinary members never see reports", async () => {
    const resMessages = await fetch(`${origin}/api/community/${communityId}?page=1&limit=50`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.equal(resMessages.status, 200);
    const body = await resMessages.json();
    const reportedMessage = body.messages.find(m => String(m._id) === String(messageToReportId));
    assert.ok(reportedMessage);

    // Reports array must be completely stripped for ordinary members
    assert.equal(Object.hasOwn(reportedMessage, "reports"), false);
    assert.equal(Object.hasOwn(reportedMessage, "originalContent"), false);
    assert.equal(Object.hasOwn(reportedMessage, "moderatedBy"), false);
    assert.equal(Object.hasOwn(reportedMessage, "moderatedAt"), false);
  });

  await t.test("5. Doctor organizer sees full report evidence in moderation queue", async () => {
    // Non-organizer is denied access to reports with 403
    const forbiddenRes = await fetch(`${origin}/api/community/${communityId}/reports`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.equal(forbiddenRes.status, 403);

    // Doctor organizer can view all reports with preserved evidence
    const organizerRes = await fetch(`${origin}/api/community/${communityId}/reports`, {
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    assert.equal(organizerRes.status, 200);
    const organizerBody = await organizerRes.json();
    assert.ok(Array.isArray(organizerBody.reports));
    assert.ok(organizerBody.reports.length > 0);

    const reportItem = organizerBody.reports.find(r => String(r._id) === String(messageToReportId));
    assert.ok(reportItem);
    assert.ok(Array.isArray(reportItem.reports));
    assert.equal(reportItem.reports[0].reason, "Potentially harmful unverified claim");
    assert.equal(String(reportItem.reports[0].reportedBy), String(memberUser2Id));
  });

  await t.test("6. Organizer moderation removes message, preserves audit evidence, and hides from members", async () => {
    // Non-organizer cannot moderate (403)
    const unauthorizedMod = await fetch(`${origin}/api/community/${communityId}/messages/${messageToReportId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.equal(unauthorizedMod.status, 403);

    // Organizer moderates the message
    const modRes = await fetch(`${origin}/api/community/${communityId}/messages/${messageToReportId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    assert.equal(modRes.status, 200);

    // Check message in database: evidence is preserved
    const dbMsg = await Message.findById(messageToReportId);
    assert.equal(dbMsg.isRemoved, true);
    assert.equal(dbMsg.originalContent, "Suspicious unverified medical claim regarding raw supplements");
    assert.equal(dbMsg.content, "[This message was removed by the doctor moderator]");
    assert.equal(String(dbMsg.moderatedBy), String(doctorOrganizerId));
    assert.ok(dbMsg.moderatedAt);

    // Ordinary members no longer see this message
    const memberMessages = await fetch(`${origin}/api/community/${communityId}?page=1&limit=50`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    const memberBody = await memberMessages.json();
    const found = memberBody.messages.find(m => String(m._id) === String(messageToReportId));
    assert.equal(found, undefined);

    // Organizer CAN still inspect the removed message in chat history with audit fields
    const orgMessages = await fetch(`${origin}/api/community/${communityId}?page=1&limit=50`, {
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    const orgBody = await orgMessages.json();
    const orgFound = orgBody.messages.find(m => String(m._id) === String(messageToReportId));
    assert.ok(orgFound);
    assert.equal(orgFound.isRemoved, true);
    assert.equal(orgFound.originalContent, "Suspicious unverified medical claim regarding raw supplements");
    assert.equal(String(orgFound.moderatedBy), String(doctorOrganizerId));
  });

  await t.test("7. Organizer can dismiss false reports, keeping message active", async () => {
    // Create another message and report it
    const msg2 = await Message.create({
      community: communityId,
      author: memberUser2Id,
      author_name: "Bob Member",
      content: "Is walking 30 minutes daily good for heart health?",
    });

    await fetch(`${origin}/api/community/${communityId}/messages/${msg2._id}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member1Token}`,
      },
      body: JSON.stringify({ reason: "Unnecessary question" }),
    });

    // Organizer dismisses report
    const dismissRes = await fetch(`${origin}/api/community/${communityId}/messages/${msg2._id}/dismiss`, {
      method: "POST",
      headers: { Authorization: `Bearer ${doctorToken}` },
    });
    assert.equal(dismissRes.status, 200);

    const dbMsg2 = await Message.findById(msg2._id);
    assert.equal(dbMsg2.reportsDismissed, true);
    assert.equal(dbMsg2.isRemoved, false);
    assert.equal(String(dbMsg2.dismissedBy), String(doctorOrganizerId));
  });

  await t.test("8. Typed and race-safe member notification preferences", async () => {
    // Non-boolean values rejected with 400
    const invalidRes = await fetch(`${origin}/api/community/${communityId}/preferences`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member1Token}`,
      },
      body: JSON.stringify({ emailNotifications: "invalid_string" }),
    });
    assert.equal(invalidRes.status, 400);

    // Valid update succeeds
    const updateRes = await fetch(`${origin}/api/community/${communityId}/preferences`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member1Token}`,
      },
      body: JSON.stringify({ emailNotifications: false, inAppNotifications: true }),
    });
    assert.equal(updateRes.status, 200);
    const updateBody = await updateRes.json();
    assert.equal(updateBody.preferences.emailNotifications, false);
    assert.equal(updateBody.preferences.inAppNotifications, true);

    // GET preferences returns the caller's preferences
    const getRes = await fetch(`${origin}/api/community/${communityId}/preferences`, {
      headers: { Authorization: `Bearer ${member1Token}` },
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.emailNotifications, false);
    assert.equal(getBody.inAppNotifications, true);

    // Concurrent preference updates remain consistent
    await Promise.all([
      fetch(`${origin}/api/community/${communityId}/preferences`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${member1Token}`,
        },
        body: JSON.stringify({ emailNotifications: true, inAppNotifications: false }),
      }),
      fetch(`${origin}/api/community/${communityId}/preferences`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${member2Token}`,
        },
        body: JSON.stringify({ emailNotifications: true, inAppNotifications: true }),
      }),
    ]);

    const commAfter = await Community.findById(communityId);
    const m1Pref = commAfter.memberPreferences.find(p => String(p.memberId) === String(memberUser1Id));
    const m2Pref = commAfter.memberPreferences.find(p => String(p.memberId) === String(memberUser2Id));
    assert.equal(m1Pref.emailNotifications, true);
    assert.equal(m1Pref.inAppNotifications, false);
    assert.equal(m2Pref.emailNotifications, true);
    assert.equal(m2Pref.inAppNotifications, true);
  });

  await t.test("9. Durable outbox job generation on announcements adhering to member preferences", async () => {
    // Member 2 opts out of all notifications
    await fetch(`${origin}/api/community/${communityId}/preferences`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member2Token}`,
      },
      body: JSON.stringify({ emailNotifications: false, inAppNotifications: false }),
    });

    // Member 1 opts in to inAppNotifications
    await fetch(`${origin}/api/community/${communityId}/preferences`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${member1Token}`,
      },
      body: JSON.stringify({ emailNotifications: false, inAppNotifications: true }),
    });

    // Organizer posts announcement
    const announceRes = await fetch(`${origin}/api/community/${communityId}/announcements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${doctorToken}`,
      },
      body: JSON.stringify({
        title: "Hypertension Guidelines 2026",
        content: "Please review the updated sodium guidance posted in our files section.",
      }),
    });
    assert.equal(announceRes.status, 201);
    const announceBody = await announceRes.json();
    assert.ok(announceBody.announcement._id);

    // Verify outbox jobs created
    const jobs = await OutboxJob.find({ kind: "community.announcement" });
    assert.ok(jobs.length > 0);

    // Member 1 should have a job
    const member1Job = jobs.find(j => String(j.payload.memberId) === String(memberUser1Id));
    assert.ok(member1Job);
    assert.equal(member1Job.payload.announcementTitle, "Hypertension Guidelines 2026");

    // Member 2 (opted out of both) should NOT have a job
    const member2Job = jobs.find(j => String(j.payload.memberId) === String(memberUser2Id));
    assert.equal(member2Job, undefined);

    // Deliver job via deliverOutboxJob
    const emitted = [];
    const fakeIo = {
      to: (room) => ({
        emit: (evt, data) => emitted.push({ room, evt, data }),
      }),
    };

    const deliveryResult = await deliverOutboxJob(member1Job, fakeIo);
    assert.notEqual(deliveryResult?.skipped, true);
    assert.ok(emitted.some(e => e.room === `user:${memberUser1Id}` && e.evt === "community:announcement"));
  });

  await t.test("10. Durable outbox job generation on events adhering to member preferences", async () => {
    const eventRes = await fetch(`${origin}/api/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${doctorToken}`,
      },
      body: JSON.stringify({
        communityId: String(communityId),
        title: "Live Q&A on Cardiac Care",
        bio: "Interactive discussion on post-OPD cardiac rehab.",
        kind: "online",
        time: new Date(Date.now() + 86400000).toISOString(),
        reminders: ["1h"],
      }),
    });
    assert.equal(eventRes.status, 201);

    // Verify event reminder job created for member 1
    const eventJobs = await OutboxJob.find({ kind: "community.event_reminder" });
    const member1EventJob = eventJobs.find(j => String(j.payload.memberId) === String(memberUser1Id));
    assert.ok(member1EventJob);
    assert.equal(member1EventJob.payload.eventTitle, "Live Q&A on Cardiac Care");

    // Member 2 (opted out of both) should NOT have an event reminder job
    const member2EventJob = eventJobs.find(j => String(j.payload.memberId) === String(memberUser2Id));
    assert.equal(member2EventJob, undefined);

    // Deliver event reminder job
    const emitted = [];
    const fakeIo = {
      to: (room) => ({
        emit: (evt, data) => emitted.push({ room, evt, data }),
      }),
    };

    const deliveryResult = await deliverOutboxJob(member1EventJob, fakeIo);
    assert.notEqual(deliveryResult?.skipped, true);
    assert.ok(emitted.some(e => e.room === `user:${memberUser1Id}` && e.evt === "community:event_reminder"));
  });
});
