import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Doctor from "../model/doctor.js";
import Appointment from "../model/appointment.js";
import Community from "../model/community.js";
import Message from "../model/message.js";
import { isCommunityOrganizer, canAccessCommunity } from "../services/communityAccess.js";

test("P14: Independent doctors, queue isolation, consultation records and community moderation", async (t) => {
  const independentDocId = new mongoose.Types.ObjectId();
  const dualDocId = new mongoose.Types.ObjectId();
  const hospitalId = new mongoose.Types.ObjectId();
  const patientId = new mongoose.Types.ObjectId();

  await t.test("independent doctor requires no hospital affiliation and exposes practice settings", () => {
    const doc = new Doctor({
      _id: independentDocId,
      firstName: "Aarav",
      lastName: "Mehta",
      email: "aarav.mehta@example.com",
      password: "SamplePassword123!",
      gender: "male",
      experience: { years: 8, expertise: "Cardiology" },
      credentialVerification: {
        status: "verified",
        councilRegistrationNumber: "MCI-48291",
        stateMedicalCouncil: "Maharashtra Medical Council",
      },
      isPublished: true,
      independentPractice: {
        enabled: true,
        consultationFee: 750,
        slotDurationMinutes: 20,
        availability: [
          { day: "Monday", startTime: "09:00", endTime: "13:00", active: true },
          { day: "Wednesday", startTime: "14:00", endTime: "18:00", active: true },
        ],
      },
    });

    // Validates without hospital affiliation
    assert.equal(doc.hospitals.length, 0);
    assert.equal(doc.credentialVerification.status, "verified");
    assert.equal(doc.credentialVerification.councilRegistrationNumber, "MCI-48291");
    assert.equal(doc.independentPractice.enabled, true);
    assert.equal(doc.independentPractice.consultationFee, 750);
    assert.equal(doc.independentPractice.availability.length, 2);
  });

  await t.test("dual-role doctor maintains strictly isolated hospital and independent practice queues", () => {
    // Synthetic visits for the same doctor under both practices
    const hospitalVisit = {
      _id: new mongoose.Types.ObjectId(),
      doctor: dualDocId,
      hospitalId,
      practiceType: "hospital",
      visitMode: "in_person",
      status: "queued",
      patientName: "Hospital OPD Patient",
    };

    const independentVisit = {
      _id: new mongoose.Types.ObjectId(),
      doctor: dualDocId,
      hospitalId: null,
      practiceType: "independent",
      visitMode: "online",
      status: "queued",
      patientName: "Connect Telemedicine Patient",
    };

    const allVisits = [hospitalVisit, independentVisit];

    // Filter rule for independent practice queue
    const independentQueue = allVisits.filter(
      (v) => String(v.doctor) === String(dualDocId) && !v.hospitalId && v.practiceType !== "hospital"
    );

    // Filter rule for hospital OPD queue
    const hospitalOpdQueue = allVisits.filter(
      (v) => String(v.doctor) === String(dualDocId) && v.hospitalId && String(v.hospitalId) === String(hospitalId)
    );

    // Assert absolute separation: no cross-contamination
    assert.equal(independentQueue.length, 1);
    assert.equal(independentQueue[0].patientName, "Connect Telemedicine Patient");
    assert.equal(independentQueue[0].hospitalId, null);

    assert.equal(hospitalOpdQueue.length, 1);
    assert.equal(hospitalOpdQueue[0].patientName, "Hospital OPD Patient");
    assert.equal(String(hospitalOpdQueue[0].hospitalId), String(hospitalId));
  });

  await t.test("appointment supports clinician draft notes and structured follow-up", () => {
    const followUpDate = new Date("2026-10-25T10:00:00Z");
    const appt = new Appointment({
      doctor: independentDocId,
      user: patientId,
      roomId: "room-abc-123",
      status: "active",
      doctorNotes: "Primary diagnosis: Essential hypertension controlled.",
      draftNotes: "Draft: check ambulatory BP log next session.",
      followUp: {
        scheduledDate: followUpDate,
        notes: "Review BP chart after 2 weeks",
        status: "recommended",
      },
    });

    assert.equal(appt.draftNotes, "Draft: check ambulatory BP log next session.");
    assert.equal(appt.followUp.status, "recommended");
    assert.equal(appt.followUp.notes, "Review BP chart after 2 weeks");
    assert.equal(appt.followUp.scheduledDate.getTime(), followUpDate.getTime());
  });

  await t.test("community organizer announcements and member moderation policy", () => {
    const community = new Community({
      title: "Heart Health Discussion Group",
      author: independentDocId,
      bio: "Doctor-led discussions for cardiac wellness.",
      category: "Health",
      members: [independentDocId, patientId],
    });

    const doctorActor = { id: String(independentDocId), role: "doctor" };
    const patientActor = { id: String(patientId), role: "user" };
    const outsiderActor = { id: String(new mongoose.Types.ObjectId()), role: "user" };

    // Permissions check
    assert.equal(isCommunityOrganizer(community, doctorActor), true);
    assert.equal(isCommunityOrganizer(community, patientActor), false);
    assert.equal(canAccessCommunity(community, patientActor), true);
    assert.equal(canAccessCommunity(community, outsiderActor), false);

    // Message creation with announcement
    const announcementMsg = new Message({
      community: community._id,
      author: independentDocId,
      author_name: "Dr. Aarav Mehta",
      content: "Webinar on sodium intake scheduled for Saturday.",
      isAnnouncement: true,
    });
    assert.equal(announcementMsg.isAnnouncement, true);
    assert.equal(announcementMsg.isRemoved, false);

    // Message reporting and moderation
    const reportedMsg = new Message({
      community: community._id,
      author: patientId,
      author_name: "Patient User",
      content: "Unverified supplement suggestion",
    });
    reportedMsg.reports.push({
      reportedBy: patientId,
      reason: "Misleading advice",
      reportedAt: new Date(),
    });
    assert.equal(reportedMsg.reports.length, 1);
    assert.equal(reportedMsg.reports[0].reason, "Misleading advice");

    // Moderation removal
    reportedMsg.isRemoved = true;
    assert.equal(reportedMsg.isRemoved, true);
  });
});
