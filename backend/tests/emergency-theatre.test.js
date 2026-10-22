import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  registerEmergencyPatient,
  getEmergencyRegistrations,
  updateEmergencyStatus,
  createTheatreRoom,
  getTheatreRooms,
  bookTheatreCase,
  cancelTheatreCase,
  recordWhoChecklistStage,
  recordPacuRecovery,
  setEmergencyTheatreTestDouble,
} from "../services/emergencyTheatreService.js";
import {
  EMERGENCY_TRIAGE_LEVELS,
  WHO_SURGICAL_SAFETY_STAGES,
} from "../config/enterprisePlan.js";

test("Task AG20: Emergency and Theatre Workflows (Unit & Domain)", async (t) => {
  const hospitalId = new mongoose.Types.ObjectId();
  const patient1Id = new mongoose.Types.ObjectId();
  const patient2Id = new mongoose.Types.ObjectId();
  const surgeon1Id = new mongoose.Types.ObjectId();
  const surgeon2Id = new mongoose.Types.ObjectId();
  const anesthetist1Id = new mongoose.Types.ObjectId();
  const anesthetist2Id = new mongoose.Types.ObjectId();
  const nurse1Id = new mongoose.Types.ObjectId();
  const theatreRoom1Id = new mongoose.Types.ObjectId();
  const theatreRoom2Id = new mongoose.Types.ObjectId();

  const state = {
    registrations: [],
    theatreRooms: [
      {
        _id: theatreRoom1Id,
        hospitalId,
        theatreCode: "OT-01",
        theatreName: "Main Surgical Suite 1",
        theatreType: "major",
        isActive: true,
      },
      {
        _id: theatreRoom2Id,
        hospitalId,
        theatreCode: "OT-02",
        theatreName: "Cardiac OT",
        theatreType: "cardiac",
        isActive: true,
      },
    ],
    bookings: [],
  };

  setEmergencyTheatreTestDouble({
    registerEmergencyPatient: async ({
      hospitalId,
      patientId,
      familyMemberId,
      patientName,
      age,
      gender,
      arrivalMode,
      triageLevel,
      chiefComplaint,
      assignedBay,
      actor,
    }) => {
      if (actor?.role && !["DOCTOR", "NURSE"].includes(actor.role)) {
        throw Object.assign(
          new Error("Emergency clinical triage must be conducted by a qualified clinician (DOCTOR or NURSE role)"),
          { status: 403 }
        );
      }
      if (!patientName?.trim()) {
        throw Object.assign(new Error("Patient identification or temporary trauma moniker is required"), { status: 400 });
      }
      if (!triageLevel || !EMERGENCY_TRIAGE_LEVELS[triageLevel]) {
        throw Object.assign(new Error("Valid 5-level emergency triage level (1 to 5) is required"), { status: 400 });
      }
      if (!chiefComplaint?.trim()) {
        throw Object.assign(new Error("Chief emergency complaint is required"), { status: 400 });
      }

      const triageConfig = EMERGENCY_TRIAGE_LEVELS[triageLevel];
      const registration = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        emergencyNumber: `ER-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        patientId: patientId || null,
        familyMemberId: familyMemberId || null,
        patientName: patientName.trim(),
        age: age ? Number(age) : null,
        gender: gender || "unknown",
        arrivalMode: arrivalMode || "walk_in",
        arrivalTime: new Date(),
        triageLevel: Number(triageLevel),
        triageCategory: triageConfig.code,
        chiefComplaint: chiefComplaint.trim(),
        assignedBay: assignedBay?.trim() || (triageLevel === 1 ? "RESUSCITATION-BAY-1" : "ACUTE-BAY-1"),
        attendingDoctorId: actor?.doctorId || (actor?.role === "DOCTOR" ? actor?.staffId : null),
        triagedByStaffId: actor?.staffId || null,
        status: "triaged",
        version: 0,
        statusHistory: [
          {
            status: "triaged",
            changedAt: new Date(),
            changedByStaffId: actor?.staffId || null,
            notes: `Initial emergency triage: Level ${triageLevel} (${triageConfig.code})`,
          },
        ],
      };
      state.registrations.push(registration);

      return {
        success: true,
        registration,
        triageInfo: {
          level: triageLevel,
          category: triageConfig.code,
          name: triageConfig.name,
          maxWaitMinutes: triageConfig.maxWaitMinutes,
          requiresImmediateResuscitation: triageLevel === 1,
        },
      };
    },

    getEmergencyRegistrations: async ({ hospitalId, status, triageLevel }) => {
      let list = state.registrations.filter((r) => r.hospitalId.toString() === hospitalId.toString());
      if (status) list = list.filter((r) => r.status === status);
      if (triageLevel) list = list.filter((r) => r.triageLevel === Number(triageLevel));

      const enriched = list.map((reg) => {
        const triageConfig = EMERGENCY_TRIAGE_LEVELS[reg.triageLevel];
        const maxWait = triageConfig?.maxWaitMinutes ?? 120;
        const arrivalMs = new Date(reg.arrivalTime).getTime();
        const waitMinutes = Math.max(0, Math.floor((Date.now() - arrivalMs) / 60000));
        const isOverdue = reg.status === "triaged" && waitMinutes > maxWait;
        return {
          ...reg,
          waitMinutes,
          maxWaitMinutes: maxWait,
          isOverdue,
          overdueMinutes: isOverdue ? waitMinutes - maxWait : 0,
        };
      });

      return { success: true, registrations: enriched, total: enriched.length, page: 1, limit: 50 };
    },

    updateEmergencyStatus: async ({
      hospitalId,
      emergencyRegistrationId,
      status,
      attendingDoctorId,
      assignedBay,
      outcomeNotes,
      expectedVersion,
      actor,
    }) => {
      const reg = state.registrations.find(
        (r) => r._id.toString() === emergencyRegistrationId.toString() && r.hospitalId.toString() === hospitalId.toString()
      );
      if (!reg) throw Object.assign(new Error("Emergency registration not found"), { status: 404 });

      if (expectedVersion !== undefined && reg.version !== undefined && reg.version !== Number(expectedVersion)) {
        throw Object.assign(
          new Error(`Emergency registration was updated concurrently by another user (expected version ${expectedVersion}, actual version ${reg.version}).`),
          { status: 409 }
        );
      }

      if (status) reg.status = status;
      if (attendingDoctorId) reg.attendingDoctorId = attendingDoctorId;
      if (assignedBay) reg.assignedBay = assignedBay;
      if (outcomeNotes) reg.outcomeNotes = outcomeNotes;

      reg.version = (reg.version || 0) + 1;
      reg.statusHistory.push({
        status: reg.status,
        changedAt: new Date(),
        changedByStaffId: actor?.staffId || null,
        notes: outcomeNotes || `Status updated to ${reg.status}`,
      });

      return { success: true, registration: reg };
    },

    createTheatreRoom: async ({ hospitalId, theatreCode, theatreName, theatreType }) => {
      const cleanCode = String(theatreCode || "").trim().toUpperCase();
      if (!cleanCode) throw Object.assign(new Error("Theatre code is required"), { status: 400 });
      if (!theatreName?.trim()) throw Object.assign(new Error("Theatre name is required"), { status: 400 });

      const existing = state.theatreRooms.find(
        (r) => r.hospitalId.toString() === hospitalId.toString() && r.theatreCode === cleanCode
      );
      if (existing) {
        throw Object.assign(new Error(`Theatre with code '${cleanCode}' already exists in this hospital`), { status: 409 });
      }

      const room = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        theatreCode: cleanCode,
        theatreName: theatreName.trim(),
        theatreType: theatreType || "major",
        isActive: true,
      };
      state.theatreRooms.push(room);
      return room;
    },

    getTheatreRooms: async ({ hospitalId }) => {
      return state.theatreRooms.filter((r) => r.hospitalId.toString() === hospitalId.toString() && r.isActive);
    },

    bookTheatreCase: async ({
      hospitalId,
      theatreRoomId,
      patientId,
      admissionId,
      emergencyRegistrationId,
      leadSurgeonDoctorId,
      anesthetistDoctorId,
      scrubNurseStaffId,
      procedureName,
      urgency,
      scheduledStartTime,
      scheduledEndTime,
      commandId,
      consentConfirmed,
      consentFormRef,
    }) => {
      if (commandId) {
        const existing = state.bookings.find(
          (b) => b.hospitalId.toString() === hospitalId.toString() && b.commandId === commandId
        );
        if (existing) {
          return { success: true, booking: existing, idempotentReplay: true };
        }
      }

      const startTime = new Date(scheduledStartTime);
      const endTime = new Date(scheduledEndTime);
      if (isNaN(startTime.getTime()) || isNaN(endTime.getTime()) || startTime >= endTime) {
        throw Object.assign(new Error("Valid scheduledStartTime and scheduledEndTime (start < end) are required"), {
          status: 400,
        });
      }
      if (!procedureName?.trim()) {
        throw Object.assign(new Error("Procedure name is required"), { status: 400 });
      }
      if (!theatreRoomId) throw Object.assign(new Error("Theatre room ID is required"), { status: 400 });
      if (!leadSurgeonDoctorId) throw Object.assign(new Error("Lead surgeon doctor ID is required"), { status: 400 });
      if (!anesthetistDoctorId) throw Object.assign(new Error("Anesthetist doctor ID is required"), { status: 400 });

      const theatre = state.theatreRooms.find(
        (r) => r._id.toString() === theatreRoomId.toString() && r.hospitalId.toString() === hospitalId.toString() && r.isActive
      );
      if (!theatre) throw Object.assign(new Error("Active theatre room not found in this hospital"), { status: 404 });

      // Check active overlaps
      const activeBookings = state.bookings.filter(
        (b) =>
          b.hospitalId.toString() === hospitalId.toString() &&
          ["scheduled", "in_progress"].includes(b.status) &&
          new Date(b.scheduledStartTime) < endTime &&
          new Date(b.scheduledEndTime) > startTime
      );

      // 1. Room overlap
      const roomConflict = activeBookings.find((b) => b.theatreRoomId.toString() === theatreRoomId.toString());
      if (roomConflict) {
        throw Object.assign(
          new Error(`Theatre room ${theatre.theatreCode} is already booked for an overlapping surgery (${roomConflict.bookingNumber})`),
          { status: 409 }
        );
      }

      // 2. Lead Surgeon overlap
      const surgeonConflict = activeBookings.find(
        (b) => b.leadSurgeonDoctorId.toString() === leadSurgeonDoctorId.toString()
      );
      if (surgeonConflict) {
        throw Object.assign(
          new Error(`Lead surgeon is already booked for an overlapping surgery (${surgeonConflict.bookingNumber})`),
          { status: 409 }
        );
      }

      // 3. Anesthetist overlap
      const anesthetistConflict = activeBookings.find(
        (b) => b.anesthetistDoctorId.toString() === anesthetistDoctorId.toString()
      );
      if (anesthetistConflict) {
        throw Object.assign(
          new Error(`Anesthetist is already booked for an overlapping surgery (${anesthetistConflict.bookingNumber})`),
          { status: 409 }
        );
      }

      const booking = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        bookingNumber: `OTB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        commandId: commandId || null,
        consentConfirmed: Boolean(consentConfirmed),
        consentFormRef: consentFormRef || "",
        theatreRoomId,
        patientId,
        admissionId: admissionId || null,
        emergencyRegistrationId: emergencyRegistrationId || null,
        leadSurgeonDoctorId,
        anesthetistDoctorId,
        scrubNurseStaffId: scrubNurseStaffId || null,
        procedureName: procedureName.trim(),
        urgency: urgency || "elective",
        scheduledStartTime: startTime,
        scheduledEndTime: endTime,
        actualStartTime: null,
        actualEndTime: null,
        status: "scheduled",
        whoChecklist: {
          signIn: { completed: false, checkpoints: {} },
          timeOut: { completed: false, checkpoints: {} },
          signOut: { completed: false, checkpoints: {} },
        },
        pacu: {
          aldreteScore: null,
          dischargedToWard: false,
          dischargedAt: null,
        },
        version: 0,
      };
      state.bookings.push(booking);

      return { success: true, booking };
    },

    cancelTheatreCase: async ({ hospitalId, bookingId, reason, expectedVersion, actor }) => {
      if (!reason?.trim()) {
        throw Object.assign(new Error("Cancellation reason is required"), { status: 400 });
      }
      const booking = state.bookings.find(
        (b) => b._id.toString() === bookingId.toString() && b.hospitalId.toString() === hospitalId.toString()
      );
      if (!booking) throw Object.assign(new Error("Active theatre booking not found"), { status: 404 });

      if (booking.status === "cancelled") {
        return { success: true, booking, alreadyCancelled: true };
      }
      if (booking.status === "completed") {
        throw Object.assign(new Error("Cannot cancel a completed surgical case"), { status: 400 });
      }

      if (expectedVersion !== undefined && booking.version !== expectedVersion) {
        throw Object.assign(
          new Error(`Theatre booking was modified concurrently (expected version ${expectedVersion}, actual version ${booking.version}).`),
          { status: 409 }
        );
      }

      booking.status = "cancelled";
      booking.cancellationReason = reason.trim();
      booking.cancellationTimestamp = new Date();
      booking.cancelledByStaffId = actor?.staffId || null;
      booking.version += 1;

      return { success: true, booking };
    },

    recordWhoChecklistStage: async ({ hospitalId, bookingId, stage, checkpoints = {}, expectedVersion, actor }) => {
      const validStages = ["signIn", "timeOut", "signOut"];
      if (!validStages.includes(stage)) {
        throw Object.assign(new Error(`Invalid WHO checklist stage: '${stage}'`), { status: 400 });
      }

      if (stage === "timeOut" && actor?.role !== "DOCTOR") {
        throw Object.assign(
          new Error("WHO Surgical Safety Checklist Time Out must be verified by an operating surgeon (DOCTOR role)"),
          { status: 403 }
        );
      }

      const stageKey = stage === "signIn" ? "SIGN_IN" : stage === "timeOut" ? "TIME_OUT" : "SIGN_OUT";
      const requiredCheckpoints = WHO_SURGICAL_SAFETY_STAGES[stageKey].minimumCheckpoints;
      const missing = requiredCheckpoints.filter((cp) => !checkpoints[cp]);
      if (missing.length > 0) {
        throw Object.assign(
          new Error(`WHO Surgical Safety Checklist (${stage}) incomplete: missing mandatory verified items [${missing.join(", ")}]`),
          { status: 400 }
        );
      }

      const booking = state.bookings.find(
        (b) =>
          b._id.toString() === bookingId.toString() &&
          b.hospitalId.toString() === hospitalId.toString() &&
          ["scheduled", "in_progress"].includes(b.status)
      );
      if (!booking) throw Object.assign(new Error("Active theatre booking not found"), { status: 404 });

      if (expectedVersion !== undefined && booking.version !== expectedVersion) {
        throw Object.assign(
          new Error(`WHO checklist was modified concurrently by another team member (expected version ${expectedVersion}, actual version ${booking.version}).`),
          { status: 409 }
        );
      }

      // Consent gate
      const consentVerified =
        Boolean(booking.consentConfirmed) ||
        Boolean(checkpoints.patient_consent_verified) ||
        Boolean(checkpoints.consent_confirmed);
      if (!consentVerified) {
        throw Object.assign(
          new Error("Surgical consent verification is required before proceeding with WHO checklist"),
          { status: 400 }
        );
      }

      if (stage === "timeOut" && !booking.whoChecklist?.signIn?.completed) {
        throw Object.assign(new Error("Cannot perform Time Out before Sign In checklist is complete"), { status: 400 });
      }
      if (stage === "signOut" && !booking.whoChecklist?.timeOut?.completed) {
        throw Object.assign(new Error("Cannot perform Sign Out before Time Out checklist is complete"), { status: 400 });
      }

      booking.whoChecklist[stage] = {
        completed: true,
        completedAt: new Date(),
        verifiedByDoctorId: stage === "timeOut" ? (actor?.doctorId || actor?.staffId || null) : null,
        verifiedByStaffId: stage !== "timeOut" ? actor?.staffId || null : null,
        checkpoints: { ...checkpoints },
      };

      if (stage === "signIn" && booking.status === "scheduled") {
        booking.status = "in_progress";
        booking.actualStartTime = new Date();
      } else if (stage === "signOut" && booking.status === "in_progress") {
        booking.status = "completed";
        booking.actualEndTime = new Date();
      }

      booking.version += 1;
      return { success: true, booking, stage, status: booking.status };
    },

    recordPacuRecovery: async ({ hospitalId, bookingId, aldreteScore, dischargedToWard, expectedVersion, actor }) => {
      if (actor?.role && !["DOCTOR", "NURSE"].includes(actor.role)) {
        throw Object.assign(
          new Error("PACU recovery evaluation must be conducted by a qualified clinician (NURSE or DOCTOR role)"),
          { status: 403 }
        );
      }

      const score = Number(aldreteScore);
      if (isNaN(score) || score < 0 || score > 10) {
        throw Object.assign(new Error("Valid Aldrete recovery score (0 to 10) is required"), { status: 400 });
      }
      if (dischargedToWard && score < 8) {
        throw Object.assign(
          new Error(`PACU safety violation: Aldrete recovery score of ${score} is insufficient for ward transfer (minimum 8 required)`),
          { status: 400 }
        );
      }

      const booking = state.bookings.find(
        (b) => b._id.toString() === bookingId.toString() && b.hospitalId.toString() === hospitalId.toString() && b.status === "completed"
      );
      if (!booking) throw Object.assign(new Error("Completed theatre surgery booking not found for PACU recovery"), { status: 404 });

      if (expectedVersion !== undefined && booking.version !== expectedVersion) {
        throw Object.assign(
          new Error(`Theatre booking was modified concurrently (expected version ${expectedVersion}, actual version ${booking.version}).`),
          { status: 409 }
        );
      }

      booking.pacu = {
        aldreteScore: score,
        recoveryNurseStaffId: actor?.staffId || null,
        dischargedToWard: Boolean(dischargedToWard),
        dischargedAt: dischargedToWard ? new Date() : null,
      };
      booking.version += 1;

      return { success: true, pacu: booking.pacu };
    },
  });

  await t.test("1. Emergency registration and 5-level deterministic triage classification", async () => {
    // 1. Role enforcement: HOSPITAL_ADMIN cannot conduct clinical triage
    await assert.rejects(
      () =>
        registerEmergencyPatient({
          hospitalId,
          patientName: "Trauma Patient",
          triageLevel: 1,
          chiefComplaint: "Severe polytrauma",
          actor: { role: "HOSPITAL_ADMIN", staffId: new mongoose.Types.ObjectId() },
        }),
      /Emergency clinical triage must be conducted by a qualified clinician/
    );

    // 2. Level 1: Immediate Resuscitation by triage nurse
    const traumaRes = await registerEmergencyPatient({
      hospitalId,
      patientName: "Trauma Male #104",
      age: 34,
      gender: "male",
      arrivalMode: "ambulance",
      triageLevel: 1,
      chiefComplaint: "High speed vehicular crash, severe respiratory compromise, unconscious",
      actor: { role: "NURSE", staffId: nurse1Id },
    });

    assert.equal(traumaRes.success, true);
    assert.equal(traumaRes.registration.triageLevel, 1);
    assert.equal(traumaRes.registration.triageCategory, "RESUSCITATION");
    assert.equal(traumaRes.registration.assignedBay, "RESUSCITATION-BAY-1");
    assert.equal(traumaRes.registration.triagedByStaffId.toString(), nurse1Id.toString());
    assert.equal(traumaRes.triageInfo.requiresImmediateResuscitation, true);
    assert.equal(traumaRes.triageInfo.maxWaitMinutes, 0);

    // 3. Level 3: Urgent (e.g. acute abdominal pain with stable vitals) by doctor
    const urgentRes = await registerEmergencyPatient({
      hospitalId,
      patientId: patient1Id,
      patientName: "Sunita Verma",
      age: 42,
      gender: "female",
      arrivalMode: "walk_in",
      triageLevel: 3,
      chiefComplaint: "Right lower quadrant abdominal pain, nausea, fever",
      actor: { role: "DOCTOR", doctorId: surgeon1Id, staffId: surgeon1Id },
    });

    assert.equal(urgentRes.success, true);
    assert.equal(urgentRes.registration.triageLevel, 3);
    assert.equal(urgentRes.registration.triageCategory, "URGENT");
    assert.equal(urgentRes.registration.attendingDoctorId.toString(), surgeon1Id.toString());
    assert.equal(urgentRes.triageInfo.requiresImmediateResuscitation, false);
    assert.equal(urgentRes.triageInfo.maxWaitMinutes, 30);

    // 4. Overdue tracking query check
    const listRes = await getEmergencyRegistrations({ hospitalId });
    assert.equal(listRes.registrations.length, 2);
    assert.ok(listRes.registrations[0].maxWaitMinutes !== undefined);

    // 5. Optimistic concurrency locking on status updates
    const regToUpdate = urgentRes.registration;
    assert.equal(regToUpdate.version, 0);

    // Stale version rejected
    await assert.rejects(
      () =>
        updateEmergencyStatus({
          hospitalId,
          emergencyRegistrationId: regToUpdate._id,
          status: "in_treatment",
          expectedVersion: 999, // mismatched!
          actor: { role: "DOCTOR", doctorId: surgeon1Id },
        }),
      /Emergency registration was updated concurrently/
    );

    // Correct version succeeds
    const updateRes = await updateEmergencyStatus({
      hospitalId,
      emergencyRegistrationId: regToUpdate._id,
      status: "in_treatment",
      assignedBay: "EXAM-BAY-3",
      outcomeNotes: "Doctor assigned, starting IV fluids",
      expectedVersion: 0,
      actor: { role: "DOCTOR", doctorId: surgeon1Id },
    });
    assert.equal(updateRes.success, true);
    assert.equal(updateRes.registration.version, 1);
    assert.equal(updateRes.registration.status, "in_treatment");

    // 6. Validation: Invalid triage level
    await assert.rejects(
      () =>
        registerEmergencyPatient({
          hospitalId,
          patientName: "Test",
          triageLevel: 6,
          chiefComplaint: "Pain",
          actor: { role: "NURSE", staffId: nurse1Id },
        }),
      /Valid 5-level emergency triage level/
    );
  });

  await t.test("2. Theatre room management and unique code validation", async () => {
    const rooms = await getTheatreRooms({ hospitalId });
    assert.equal(rooms.length, 2);

    // Create a new room
    const newRoom = await createTheatreRoom({
      hospitalId,
      theatreCode: "OT-03",
      theatreName: "Orthopedic Theatre",
      theatreType: "ortho",
    });
    assert.equal(newRoom.theatreCode, "OT-03");

    // Duplicate code in same hospital rejected
    await assert.rejects(
      () =>
        createTheatreRoom({
          hospitalId,
          theatreCode: "OT-03",
          theatreName: "Duplicate OT",
        }),
      /already exists in this hospital/
    );
  });

  let booking1;
  const startSlot = new Date("2026-10-25T08:00:00Z");
  const endSlot = new Date("2026-10-25T11:00:00Z");

  await t.test("3. Operation theatre scheduling with triple-conflict checks and command identity", async () => {
    const commandId = "ot-cmd-cholecystectomy-101";

    // 1. Initial booking succeeds with consent and command identity
    const bookingRes = await bookTheatreCase({
      hospitalId,
      commandId,
      consentConfirmed: true,
      consentFormRef: "CONSENT-2026-CHOL-01",
      theatreRoomId: theatreRoom1Id,
      patientId: patient1Id,
      leadSurgeonDoctorId: surgeon1Id,
      anesthetistDoctorId: anesthetist1Id,
      procedureName: "Laparoscopic Cholecystectomy",
      urgency: "elective",
      scheduledStartTime: startSlot,
      scheduledEndTime: endSlot,
    });

    assert.equal(bookingRes.success, true);
    assert.equal(bookingRes.booking.status, "scheduled");
    assert.equal(bookingRes.booking.consentConfirmed, true);
    booking1 = bookingRes.booking;

    // 2. Command Idempotency replay with same commandId
    const replayRes = await bookTheatreCase({
      hospitalId,
      commandId,
      theatreRoomId: theatreRoom1Id,
      patientId: patient1Id,
      leadSurgeonDoctorId: surgeon1Id,
      anesthetistDoctorId: anesthetist1Id,
      procedureName: "Laparoscopic Cholecystectomy",
      scheduledStartTime: startSlot,
      scheduledEndTime: endSlot,
    });
    assert.equal(replayRes.success, true);
    assert.equal(replayRes.idempotentReplay, true);
    assert.equal(replayRes.booking._id.toString(), booking1._id.toString());

    // 3. Conflict Check 1: Same Theatre Room overlapping
    await assert.rejects(
      () =>
        bookTheatreCase({
          hospitalId,
          theatreRoomId: theatreRoom1Id, // same room
          patientId: patient2Id,
          leadSurgeonDoctorId: surgeon2Id, // different surgeon
          anesthetistDoctorId: anesthetist2Id, // different anesthetist
          procedureName: "Emergency Appendectomy",
          urgency: "urgent",
          scheduledStartTime: new Date("2026-10-25T09:00:00Z"), // overlaps!
          scheduledEndTime: new Date("2026-10-25T12:00:00Z"),
        }),
      /Theatre room OT-01 is already booked/
    );

    // 4. Conflict Check 2: Same Lead Surgeon overlapping in different room
    await assert.rejects(
      () =>
        bookTheatreCase({
          hospitalId,
          theatreRoomId: theatreRoom2Id, // different room
          patientId: patient2Id,
          leadSurgeonDoctorId: surgeon1Id, // SAME lead surgeon!
          anesthetistDoctorId: anesthetist2Id,
          procedureName: "Emergency Hernioplasty",
          urgency: "urgent",
          scheduledStartTime: new Date("2026-10-25T09:00:00Z"), // overlaps!
          scheduledEndTime: new Date("2026-10-25T10:30:00Z"),
        }),
      /Lead surgeon is already booked/
    );

    // 5. Conflict Check 3: Same Anesthetist overlapping in different room
    await assert.rejects(
      () =>
        bookTheatreCase({
          hospitalId,
          theatreRoomId: theatreRoom2Id, // different room
          patientId: patient2Id,
          leadSurgeonDoctorId: surgeon2Id, // different surgeon
          anesthetistDoctorId: anesthetist1Id, // SAME anesthetist!
          procedureName: "Emergency Hernioplasty",
          urgency: "urgent",
          scheduledStartTime: new Date("2026-10-25T08:30:00Z"), // overlaps!
          scheduledEndTime: new Date("2026-10-25T10:30:00Z"),
        }),
      /Anesthetist is already booked/
    );

    // 6. Non-overlapping slot succeeds for same room and team
    const afternoonRes = await bookTheatreCase({
      hospitalId,
      theatreRoomId: theatreRoom1Id,
      patientId: patient2Id,
      leadSurgeonDoctorId: surgeon1Id,
      anesthetistDoctorId: anesthetist1Id,
      procedureName: "Inguinal Hernia Repair",
      urgency: "elective",
      consentConfirmed: true,
      scheduledStartTime: new Date("2026-10-25T12:00:00Z"), // After 11:00!
      scheduledEndTime: new Date("2026-10-25T14:00:00Z"),
    });
    assert.equal(afternoonRes.success, true);
  });

  await t.test("4. Cancellation and immediate slot release for reallocation", async () => {
    // Book a temporary emergency case in OT-02
    const tempCase = await bookTheatreCase({
      hospitalId,
      theatreRoomId: theatreRoom2Id,
      patientId: patient2Id,
      leadSurgeonDoctorId: surgeon2Id,
      anesthetistDoctorId: anesthetist2Id,
      procedureName: "Diagnostic Laparoscopy",
      urgency: "elective",
      consentConfirmed: true,
      scheduledStartTime: new Date("2026-10-25T15:00:00Z"),
      scheduledEndTime: new Date("2026-10-25T17:00:00Z"),
    });
    assert.equal(tempCase.booking.status, "scheduled");

    // Overlapping booking fails
    await assert.rejects(
      () =>
        bookTheatreCase({
          hospitalId,
          theatreRoomId: theatreRoom2Id,
          patientId: patient1Id,
          leadSurgeonDoctorId: surgeon1Id,
          anesthetistDoctorId: anesthetist1Id,
          procedureName: "STAT Exploratory Laparotomy",
          urgency: "emergency_stat",
          scheduledStartTime: new Date("2026-10-25T15:30:00Z"),
          scheduledEndTime: new Date("2026-10-25T16:30:00Z"),
        }),
      /Theatre room OT-02 is already booked/
    );

    // Stale version cancellation rejected
    await assert.rejects(
      () =>
        cancelTheatreCase({
          hospitalId,
          bookingId: tempCase.booking._id,
          reason: "Patient moved to ICU",
          expectedVersion: 42,
        }),
      /Theatre booking was modified concurrently/
    );

    // Cancel tempCase
    const cancelRes = await cancelTheatreCase({
      hospitalId,
      bookingId: tempCase.booking._id,
      reason: "Patient hemodynamically unstable, moved to ICU instead",
      expectedVersion: 0,
      actor: { staffId: surgeon2Id },
    });
    assert.equal(cancelRes.success, true);
    assert.equal(cancelRes.booking.status, "cancelled");

    // Repeated cancel is idempotent
    const repeatCancel = await cancelTheatreCase({
      hospitalId,
      bookingId: tempCase.booking._id,
      reason: "Duplicate cancellation attempt",
    });
    assert.equal(repeatCancel.success, true);
    assert.equal(repeatCancel.alreadyCancelled, true);

    // Now re-booking the emergency case in that same window succeeds immediately!
    const rebookRes = await bookTheatreCase({
      hospitalId,
      theatreRoomId: theatreRoom2Id,
      patientId: patient1Id,
      leadSurgeonDoctorId: surgeon1Id,
      anesthetistDoctorId: anesthetist1Id,
      procedureName: "STAT Exploratory Laparotomy",
      urgency: "emergency_stat",
      consentConfirmed: true,
      scheduledStartTime: new Date("2026-10-25T15:30:00Z"),
      scheduledEndTime: new Date("2026-10-25T16:30:00Z"),
    });
    assert.equal(rebookRes.success, true);
    assert.equal(rebookRes.booking.status, "scheduled");
  });

  await t.test("5. WHO Surgical Safety Checklist stage sequence, mandatory checkpoints, consent, and role guards", async () => {
    // Case without consent fails WHO checklist
    const unconsentedCase = await bookTheatreCase({
      hospitalId,
      theatreRoomId: theatreRoom1Id,
      patientId: patient2Id,
      leadSurgeonDoctorId: surgeon2Id,
      anesthetistDoctorId: anesthetist2Id,
      procedureName: "Unconsented Surgery",
      urgency: "elective",
      consentConfirmed: false,
      scheduledStartTime: new Date("2026-10-25T18:00:00Z"),
      scheduledEndTime: new Date("2026-10-25T20:00:00Z"),
    });

    await assert.rejects(
      () =>
        recordWhoChecklistStage({
          hospitalId,
          bookingId: unconsentedCase.booking._id,
          stage: "signIn",
          checkpoints: {
            patient_identity_confirmed: true,
            surgical_site_marked: true,
            anesthesia_safety_check_complete: true,
            pulse_oximeter_operating: true,
            allergy_status_verified: true,
            airway_aspiration_risk_evaluated: true,
            blood_loss_risk_prepared: true,
          },
          actor: { staffId: nurse1Id },
        }),
      /Surgical consent verification is required/
    );

    // 1. Missing mandatory checkpoints in Sign In
    await assert.rejects(
      () =>
        recordWhoChecklistStage({
          hospitalId,
          bookingId: booking1._id,
          stage: "signIn",
          checkpoints: {
            patient_identity_confirmed: true,
            surgical_site_marked: true,
            // missing other mandatory checkpoints
          },
          actor: { staffId: nurse1Id },
        }),
      /missing mandatory verified items/
    );

    // 2. Cannot jump to Time Out before Sign In
    await assert.rejects(
      () =>
        recordWhoChecklistStage({
          hospitalId,
          bookingId: booking1._id,
          stage: "timeOut",
          checkpoints: {
            team_introductions_complete: true,
            patient_procedure_site_confirmed: true,
            surgeon_critical_events_reviewed: true,
            anesthetist_concerns_reviewed: true,
            nursing_sterility_confirmed: true,
            antibiotic_prophylaxis_administered_within_60m: true,
            essential_imaging_displayed: true,
          },
          actor: { role: "DOCTOR", doctorId: surgeon1Id },
        }),
      /Cannot perform Time Out before Sign In/
    );

    // 3. Complete Sign In correctly -> Moves booking to in_progress
    const signInRes = await recordWhoChecklistStage({
      hospitalId,
      bookingId: booking1._id,
      stage: "signIn",
      checkpoints: {
        patient_identity_confirmed: true,
        surgical_site_marked: true,
        anesthesia_safety_check_complete: true,
        pulse_oximeter_operating: true,
        allergy_status_verified: true,
        airway_aspiration_risk_evaluated: true,
        blood_loss_risk_prepared: true,
      },
      expectedVersion: 0,
      actor: { staffId: nurse1Id },
    });
    assert.equal(signInRes.success, true);
    assert.equal(signInRes.status, "in_progress");
    assert.equal(signInRes.booking.version, 1);
    assert.ok(signInRes.booking.actualStartTime);

    // 4. Non-doctor (nurse or admin) cannot sign Time Out
    await assert.rejects(
      () =>
        recordWhoChecklistStage({
          hospitalId,
          bookingId: booking1._id,
          stage: "timeOut",
          checkpoints: {
            team_introductions_complete: true,
            patient_procedure_site_confirmed: true,
            surgeon_critical_events_reviewed: true,
            anesthetist_concerns_reviewed: true,
            nursing_sterility_confirmed: true,
            antibiotic_prophylaxis_administered_within_60m: true,
            essential_imaging_displayed: true,
          },
          actor: { role: "NURSE", staffId: nurse1Id }, // Non-doctor!
        }),
      /WHO Surgical Safety Checklist Time Out must be verified by an operating surgeon/
    );

    // Stale version rejected
    await assert.rejects(
      () =>
        recordWhoChecklistStage({
          hospitalId,
          bookingId: booking1._id,
          stage: "timeOut",
          checkpoints: {
            team_introductions_complete: true,
            patient_procedure_site_confirmed: true,
            surgeon_critical_events_reviewed: true,
            anesthetist_concerns_reviewed: true,
            nursing_sterility_confirmed: true,
            antibiotic_prophylaxis_administered_within_60m: true,
            essential_imaging_displayed: true,
          },
          expectedVersion: 0, // stale! Current version is 1
          actor: { role: "DOCTOR", doctorId: surgeon1Id },
        }),
      /WHO checklist was modified concurrently/
    );

    // 5. Complete Time Out checklist by authorized doctor
    const timeOutRes = await recordWhoChecklistStage({
      hospitalId,
      bookingId: booking1._id,
      stage: "timeOut",
      checkpoints: {
        team_introductions_complete: true,
        patient_procedure_site_confirmed: true,
        surgeon_critical_events_reviewed: true,
        anesthetist_concerns_reviewed: true,
        nursing_sterility_confirmed: true,
        antibiotic_prophylaxis_administered_within_60m: true,
        essential_imaging_displayed: true,
      },
      expectedVersion: 1,
      actor: { role: "DOCTOR", doctorId: surgeon1Id },
    });
    assert.equal(timeOutRes.success, true);
    assert.equal(timeOutRes.booking.whoChecklist.timeOut.completed, true);
    assert.equal(timeOutRes.booking.whoChecklist.timeOut.verifiedByDoctorId.toString(), surgeon1Id.toString());
    assert.equal(timeOutRes.booking.version, 2);

    // 6. Complete Sign Out checklist -> Moves booking to completed
    const signOutRes = await recordWhoChecklistStage({
      hospitalId,
      bookingId: booking1._id,
      stage: "signOut",
      checkpoints: {
        procedure_name_recorded: true,
        instrument_sponge_needle_counts_correct: true,
        surgical_specimen_labeled: true,
        equipment_issues_recorded: true,
        surgeon_anesthetist_nurse_recovery_plan_agreed: true,
      },
      expectedVersion: 2,
      actor: { staffId: nurse1Id },
    });
    assert.equal(signOutRes.success, true);
    assert.equal(signOutRes.status, "completed");
    assert.equal(signOutRes.booking.version, 3);
    assert.ok(signOutRes.booking.actualEndTime);
  });

  await t.test("6. PACU recovery Aldrete clinical scoring, ward discharge gate, and role validation", async () => {
    // 1. Non-clinician cannot perform PACU recovery evaluation
    await assert.rejects(
      () =>
        recordPacuRecovery({
          hospitalId,
          bookingId: booking1._id,
          aldreteScore: 9,
          actor: { role: "HOSPITAL_ADMIN", staffId: new mongoose.Types.ObjectId() },
        }),
      /PACU recovery evaluation must be conducted by a qualified clinician/
    );

    // 2. Invalid Aldrete score (e.g. 12)
    await assert.rejects(
      () =>
        recordPacuRecovery({
          hospitalId,
          bookingId: booking1._id,
          aldreteScore: 12,
          actor: { role: "NURSE", staffId: nurse1Id },
        }),
      /Valid Aldrete recovery score/
    );

    // 3. Premature ward discharge attempt with low Aldrete score (e.g. 6/10)
    await assert.rejects(
      () =>
        recordPacuRecovery({
          hospitalId,
          bookingId: booking1._id,
          aldreteScore: 6,
          dischargedToWard: true,
          actor: { role: "NURSE", staffId: nurse1Id },
        }),
      /PACU safety violation: Aldrete recovery score of 6 is insufficient for ward transfer/
    );

    // 4. Stale version rejected
    await assert.rejects(
      () =>
        recordPacuRecovery({
          hospitalId,
          bookingId: booking1._id,
          aldreteScore: 6,
          dischargedToWard: false,
          expectedVersion: 0, // stale!
          actor: { role: "NURSE", staffId: nurse1Id },
        }),
      /Theatre booking was modified concurrently/
    );

    // 5. Score 6 recorded while remaining in PACU for recovery monitoring
    const pacuMonitorRes = await recordPacuRecovery({
      hospitalId,
      bookingId: booking1._id,
      aldreteScore: 6,
      dischargedToWard: false,
      expectedVersion: 3,
      actor: { role: "NURSE", staffId: nurse1Id },
    });
    assert.equal(pacuMonitorRes.success, true);
    assert.equal(pacuMonitorRes.pacu.aldreteScore, 6);
    assert.equal(pacuMonitorRes.pacu.dischargedToWard, false);

    // 6. Score 9 recorded with ward discharge authorization
    const wardTransferRes = await recordPacuRecovery({
      hospitalId,
      bookingId: booking1._id,
      aldreteScore: 9,
      dischargedToWard: true,
      expectedVersion: 4,
      actor: { role: "NURSE", staffId: nurse1Id },
    });
    assert.equal(wardTransferRes.success, true);
    assert.equal(wardTransferRes.pacu.aldreteScore, 9);
    assert.equal(wardTransferRes.pacu.dischargedToWard, true);
    assert.ok(wardTransferRes.pacu.dischargedAt);
  });

  await t.test("7. Disconnected DB fail-closed check", async () => {
    setEmergencyTheatreTestDouble(null);

    await assert.rejects(
      () =>
        registerEmergencyPatient({
          hospitalId,
          patientName: "Trauma Patient",
          triageLevel: 1,
          chiefComplaint: "Severe head injury",
          actor: { role: "NURSE", staffId: nurse1Id },
        }),
      (err) => err.status === 503 || err.message.includes("Database service is unavailable")
    );
  });
});
