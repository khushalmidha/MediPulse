import crypto from "node:crypto";
import mongoose from "mongoose";
import Appointment from "../model/appointment.js";
import OpdToken from "../model/opdToken.js";
import EncounterJourney from "../model/encounterJourney.js";
import LabOrder from "../model/labOrder.js";
import Prescription from "../model/prescription.js";
import { queueContext, patientKey } from "./queueContext.js";

export const FOXO_ACCOUNTS = Object.freeze({ patient: "khushalmidha24@gmail.com", doctor: "khushalmidha18@gmail.com" });
export const FOXO_LABEL = "SYNTHETIC FOXO DEMO — fictional history, not medical advice or an actual consultation.";
const { ObjectId } = mongoose.mongo;
const { EJSON } = mongoose.mongo.BSON;
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const foxoHash = value => crypto.createHash("sha256").update(JSON.stringify(stable(EJSON.serialize(value, { relaxed: false })))).digest("hex");
const oid = text => new ObjectId(crypto.createHash("sha256").update(text).digest("hex").slice(0, 24));
const same = (a, b) => String(a) === String(b);
const opts = session => session ? { session } : {};

async function source(db, session) {
  const options = opts(session);
  const patient = await db.collection("users").findOne({ email: FOXO_ACCOUNTS.patient }, { ...options, projection: { _id: 1, email: 1, firstName: 1, familyMembers: 1, careIdentityRevision: 1 } });
  const doctor = await db.collection("doctors").findOne({ email: FOXO_ACCOUNTS.doctor }, { ...options, projection: { _id: 1, email: 1, firstName: 1 } });
  if (!patient || !doctor) throw new Error("The confirmed patient and doctor accounts must already exist");
  const staff = await db.collection("hospitalstaffs").find({ email: FOXO_ACCOUNTS.doctor, doctorId: doctor._id, role: "DOCTOR", isActive: true, inviteStatus: "accepted" },
    { ...options, projection: { _id: 1, hospitalId: 1, departmentIds: 1, doctorId: 1, role: 1, isActive: 1, inviteStatus: 1 } }).limit(2).toArray();
  if (staff.length !== 1) throw new Error("Exactly one active linked hospital doctor is required");
  const member = staff[0];
  const hospital = await db.collection("hospitals").findOne({ _id: member.hospitalId, status: "active" },
    { ...options, projection: { _id: 1, name: 1, slug: 1, status: 1, "settings.timezone": 1, "settings.queueSessionIds": 1 } });
  const departments = await db.collection("departments").find({ _id: { $in: member.departmentIds || [] }, hospitalId: member.hospitalId, status: "active" },
    { ...options, projection: { _id: 1, hospitalId: 1, name: 1, status: 1 } }).limit(3).toArray();
  const department = departments.find(item => /pa?ediatr/i.test(item.name));
  if (!hospital?.slug || !department) throw new Error("An active published hospital route and assigned paediatric department are required");
  return { patient, doctor, staff: member, hospital, department };
}

export function deriveDemoMetrics(rows) {
  const byCollection = {};
  for (const row of rows) {
    byCollection[row.collection] = (byCollection[row.collection] || 0) + 1;
  }
  const tokens = rows.filter(r => r.collection === "opdtokens").map(r => r.document);
  const appointments = rows.filter(r => r.collection === "appointments").map(r => r.document);
  const encounters = rows.filter(r => r.collection === "encounterjourneys").map(r => r.document);
  const labs = rows.filter(r => r.collection === "laborders").map(r => r.document);
  const prescriptions = rows.filter(r => r.collection === "prescriptions").map(r => r.document);

  const completedVisits = tokens.filter(t => t.status === "completed").length;
  const followUpVisits = tokens.filter(t => t.visitType === "follow_up").length;
  const releasedLabs = labs.filter(l => l.orderStatus === "released").length;
  const partialPrescriptions = prescriptions.filter(p => p.status === "partially_dispensed").length;
  const physicalFiles = encounters.filter(e => e.physicalFile?.hasPhysicalFile).length;
  const totalMedicationsPrescribed = prescriptions.reduce((acc, p) => acc + (p.items?.length || 0), 0);
  const totalMedicationsDispensed = prescriptions.reduce((acc, p) => acc + (p.items?.filter(i => i.itemStatus === "dispensed").length || 0), 0);

  return {
    totalEntities: rows.length,
    byCollection,
    clinical: {
      completedVisits,
      followUpVisits,
      releasedLabs,
      partialPrescriptions,
      physicalFilesTracked: physicalFiles,
      totalMedicationsPrescribed,
      totalMedicationsDispensed,
    },
    provenance: {
      derivedFromActualData: true,
      synthetic: true,
      disclaimer: FOXO_LABEL,
    }
  };
}

function generatePitchCards(source, family, rows) {
  const tokens = rows.filter(r => r.collection === "opdtokens").map(r => r.document);
  const appointments = rows.filter(r => r.collection === "appointments").map(r => r.document);
  const encounters = rows.filter(r => r.collection === "encounterjourneys").map(r => r.document);
  const labs = rows.filter(r => r.collection === "laborders").map(r => r.document);
  const prescriptions = rows.filter(r => r.collection === "prescriptions").map(r => r.document);

  return [
    {
      id: "pitch-card-01-discovery-booking",
      title: "Family Care & In-Person Booking",
      stage: "booking",
      actorRole: "PATIENT",
      actorName: source.patient.firstName || "Parent",
      summary: "Parent schedules paediatric checkups for child Aarav with Dr. Khushal Midha, establishing continuous family health identity.",
      records: {
        patientId: source.patient._id,
        familyMemberId: family._id,
        doctorId: source.staff._id,
        hospitalId: source.hospital._id,
        appointmentIds: appointments.map(a => a._id),
        tokenIds: tokens.map(t => t._id)
      },
      status: "connected"
    },
    {
      id: "pitch-card-02-reception-guidance",
      title: "Reception Arrival, QR Guidance & Physical File Custody",
      stage: "reception",
      actorRole: "RECEPTIONIST",
      actorName: "Reception Desk",
      summary: "Aarav arrives at the clinic; ticket DEMO-2 provides destination guidance; physical paper file custody is handed off to nursing with acknowledged transfer.",
      records: {
        encounterJourneyId: encounters[1]?._id,
        tokenId: tokens[1]?._id,
        ticketNumber: encounters[1]?.ticketNumber,
        fileBarcode: encounters[1]?.physicalFile?.fileBarcode,
        qrPayload: encounters[1]?.qrPayload
      },
      status: "connected"
    },
    {
      id: "pitch-card-03-clinical-consultation",
      title: "Clinician Consultation & Structured Notes",
      stage: "consultation",
      actorRole: "DOCTOR",
      actorName: "Dr. Khushal Midha",
      summary: "Paediatrician examines Aarav for cough, records clinical notes with follow-up instructions, and orders diagnostic lab work and prescriptions.",
      records: {
        appointmentId: appointments[1]?._id,
        doctorId: source.staff._id,
        departmentId: source.department._id,
        visitType: tokens[1]?.visitType,
        hasFollowUpAdvice: true
      },
      status: "connected"
    },
    {
      id: "pitch-card-04-lab-investigation",
      title: "Diagnostic Lab Worklist & Released Report",
      stage: "diagnostics",
      actorRole: "LAB_TECH",
      actorName: "Lead Pathologist",
      summary: "Specimen DEMO-BARCODE-001 collected; CBC and CRP inflammatory markers analyzed; report version 1 verified and released to patient timeline.",
      records: {
        labOrderId: labs[0]?._id,
        accessionBarcode: labs[0]?.accessionBarcode,
        orderStatus: labs[0]?.orderStatus,
        reportVersion: labs[0]?.reportVersion,
        parametersCount: labs[0]?.results?.length
      },
      status: "connected"
    },
    {
      id: "pitch-card-05-pharmacy-fulfillment",
      title: "Pharmacy Verification, Batch Allocation & Partial Dispensing",
      stage: "pharmacy",
      actorRole: "PHARMACIST",
      actorName: "Hospital Pharmacist",
      summary: "Pharmacist fulfills prescription DEMO-RX-VERIFY-001; dispenses 6/10 Amoxicillin doses from batch BATCH-AMOX-2026A while keeping Saline drops pending.",
      records: {
        prescriptionId: prescriptions[0]?._id,
        verificationToken: prescriptions[0]?.verificationToken,
        status: prescriptions[0]?.status,
        dispensedBatch: "BATCH-AMOX-2026A",
        remainingQuantity: 4
      },
      status: "connected"
    },
    {
      id: "pitch-card-06-care-packet-dashboard",
      title: "Patient Care Packet & Hospital Operations Dashboard",
      stage: "completed",
      actorRole: "SYSTEM",
      actorName: "MediPulse Platform",
      summary: "Parent accesses complete historical timeline across wellness, illness, lab reports, and follow-up. Clinic operations dashboard displays metrics derived from real records.",
      records: {
        totalVisits: tokens.length,
        familyId: family._id,
        patientId: source.patient._id,
        hospitalId: source.hospital._id,
        metricsDerived: true
      },
      status: "connected"
    }
  ];
}

function graph(source, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) throw new Error("Explicit valid rehearsal date required");
  const { patient, staff, hospital, department } = source;
  const tag = `foxo-v1:${patient._id}:${staff._id}:${date}`;
  const runId = oid(tag), familyId = oid(`foxo-family-v1:${patient._id}:${staff._id}`);
  const family = { _id: familyId, name: "Aarav — Synthetic Demo Child", relation: "child", dob: new Date("2018-06-15T00:00:00Z"), gender: "male" };
  const scenarios = [
    [21, "Routine child wellness discussion", "Fictional baseline visit for demonstrating a connected family timeline. General paediatric wellness assessment, milestones appropriate. No medication or investigations required."],
    [10, "Mild cough and blocked nose reported for two days", "Fictional symptom-intake example. Child evaluated for upper respiratory congestion. Prescribed pediatric antibiotic suspension and saline nasal drops. Advised follow-up in one week if symptoms persist."],
    [3, "Follow-up discussion of the earlier fictional cough", "Fictional follow-up linked to the same child, hospital, department and doctor. Follow-up assessment confirms resolution of acute respiratory symptoms. Child recovered; discharged from acute episode."],
  ];
  const rows = [];
  let linkedLabOrderId = null;
  let linkedPrescriptionId = null;

  for (const [index, [days, complaint, notes]] of scenarios.entries()) {
    const start = new Date(Date.parse(date + "T04:30:00Z") - days * 86400000), end = new Date(+start + 15 * 60000);
    const context = queueContext({ hospital, doctorId: staff._id, now: start });
    const tokenId = oid(`${tag}:token:${index}`), appointmentId = oid(`${tag}:appointment:${index}`), encounterId = oid(`${tag}:encounter:${index}`);
    const common = { ...context, personKey: patientKey(patient._id, familyId), familyMemberId: familyId, createdAt: start, updatedAt: end, revision: 0 };
    const summary = `${FOXO_LABEL}\n${notes}`;
    const token = { _id: tokenId, ...common, hospitalId: hospital._id, departmentId: department._id, doctorId: staff._id, patientId: patient._id,
      appointmentId, tokenNumber: 900001 + index, displayToken: `DEMO-${index + 1}`, date: start,
      patientInfo: { name: family.name, age: 8, gender: "male", isWalkIn: false }, visitType: index === 2 ? "follow_up" : "new",
      chiefComplaint: `[Synthetic demo] ${complaint}`, status: "completed", arrivedAt: start,
      consultationStartedAt: start, consultationEndedAt: end, consultationNotes: summary,
      paymentStatus: "waived", paymentAmount: 0 };
    const appointment = { _id: appointmentId, ...common, hospitalId: hospital._id, doctor: staff._id, user: patient._id, opdTokenId: tokenId,
      appointmentType: "hospital_in_person", admissionState: "arrived", checkedInAt: start, roomId: `synthetic-foxo-${appointmentId}`,
      status: "completed", startedAt: start, endedAt: end, endedBy: "system", doctorNotes: summary,
      feeSnapshot: { amountMinor: 0, currency: "INR", demo: true } };

    // Detailed encounter journey with physical custody and multi-stage steps for visit 1 (cough scenario)
    const encounter = {
      _id: encounterId,
      hospitalId: hospital._id,
      departmentId: department._id,
      tokenId,
      appointmentId,
      patientId: patient._id,
      familyMemberId: familyId,
      isWalkIn: false,
      ticketNumber: `DEMO-${index + 1}`,
      qrPayload: `DEMO-TICKET-AARAV-00${index + 1}`,
      currentStage: "completed",
      requiredSteps: index === 1
        ? ["reception", "vitals", "consultation", "diagnostics", "pharmacy"]
        : ["reception", "vitals", "consultation"],
      currentDestination: {
        name: "Paediatric OPD Room 102",
        building: "Main Block",
        floor: "1st Floor",
        roomNumber: "102",
        instructions: "Please proceed to Paediatric Consultation Room 102"
      },
      stageHistory: index === 1 ? [
        { stage: "reception", actorRole: "RECEPTIONIST", actorName: "Reception Desk", timestamp: start, notes: "Patient arrived and checked in" },
        { stage: "vitals", actorRole: "NURSE", actorName: "Staff Nurse", timestamp: new Date(+start + 3 * 60000), notes: "Vitals recorded: Temp 99.1F, Pulse 92 bpm, SpO2 99%" },
        { stage: "consultation", actorRole: "DOCTOR", actorName: "Dr. Khushal Midha", timestamp: new Date(+start + 6 * 60000), notes: "Clinical consultation conducted, CBC ordered, Rx generated" },
        { stage: "diagnostics", actorRole: "LAB_TECH", actorName: "Lab Technician", timestamp: new Date(+start + 10 * 60000), notes: "Blood sample collected and processed" },
        { stage: "pharmacy", actorRole: "PHARMACIST", actorName: "Hospital Pharmacist", timestamp: new Date(+start + 13 * 60000), notes: "Partial medication dispensed" },
        { stage: "completed", actorRole: "SYSTEM", actorName: "Synthetic fixture importer", timestamp: end, notes: summary, reason: "Explicit synthetic recording fixture" }
      ] : [
        { stage: "reception", actorRole: "RECEPTIONIST", actorName: "Reception Desk", timestamp: start, notes: "Patient arrived" },
        { stage: "vitals", actorRole: "NURSE", actorName: "Staff Nurse", timestamp: new Date(+start + 4 * 60000), notes: "Vitals normal" },
        { stage: "consultation", actorRole: "DOCTOR", actorName: "Dr. Khushal Midha", timestamp: new Date(+start + 7 * 60000), notes: summary },
        { stage: "completed", actorRole: "SYSTEM", actorName: "Synthetic fixture importer", timestamp: end, notes: summary, reason: "Explicit synthetic recording fixture" }
      ],
      physicalFile: {
        hasPhysicalFile: index === 1,
        fileBarcode: index === 1 ? "FILE-AARAV-2026-001" : undefined,
        currentHolderRole: index === 1 ? "MEDICAL_RECORDS" : undefined,
        currentHolderName: index === 1 ? "Central Medical Records" : undefined,
        locationName: index === 1 ? "Medical Records Archive" : "not recorded",
        lastHandoffAt: index === 1 ? end : undefined,
        handoffHistory: index === 1 ? [
          {
            handoffId: `${tag}:handoff:1`,
            fromActorRole: "RECEPTION",
            fromActorName: "Reception Staff",
            toActorRole: "NURSE",
            toActorName: "Staff Nurse",
            timestamp: start,
            status: "acknowledged",
            acknowledgedAt: new Date(+start + 2 * 60000),
            reason: "Intake vitals handoff"
          },
          {
            handoffId: `${tag}:handoff:2`,
            fromActorRole: "NURSE",
            fromActorName: "Staff Nurse",
            toActorRole: "DOCTOR",
            toActorName: "Dr. Khushal Midha",
            timestamp: new Date(+start + 5 * 60000),
            status: "acknowledged",
            acknowledgedAt: new Date(+start + 6 * 60000),
            reason: "Consultation physical chart transfer"
          },
          {
            handoffId: `${tag}:handoff:3`,
            fromActorRole: "DOCTOR",
            fromActorName: "Dr. Khushal Midha",
            toActorRole: "MEDICAL_RECORDS",
            toActorName: "Central Medical Records",
            timestamp: end,
            status: "acknowledged",
            acknowledgedAt: end,
            reason: "Encounter completion chart return"
          }
        ] : []
      },
      createdAt: start,
      updatedAt: end,
      revision: 0
    };

    for (const [Model, document] of [[OpdToken, token], [Appointment, appointment], [EncounterJourney, encounter]]) {
      if (new Model(document).validateSync()) throw new Error("Synthetic graph does not satisfy the current document schema");
      rows.push({ collection: Model.collection.name, document });
    }

    // Connect real diagnostic LabOrder and Prescription to visit 1 (cough scenario)
    if (index === 1) {
      linkedLabOrderId = oid(`${tag}:lab:1`);
      linkedPrescriptionId = oid(`${tag}:prescription:1`);

      const labResults = [
        { testCode: "CBC", parameterCode: "WBC", parameterName: "Total Leukocyte Count", value: 7200, unit: "/cumm", referenceRangeText: "5000 - 12000", flag: "normal", isCritical: false },
        { testCode: "CBC", parameterCode: "CRP", parameterName: "C-Reactive Protein", value: 3.2, unit: "mg/L", referenceRangeText: "< 5.0", flag: "normal", isCritical: false },
        { testCode: "CBC", parameterCode: "HB", parameterName: "Hemoglobin", value: 12.8, unit: "g/dL", referenceRangeText: "11.5 - 15.5", flag: "normal", isCritical: false }
      ];

      const labOrder = {
        _id: linkedLabOrderId,
        hospitalId: hospital._id,
        departmentId: department._id,
        encounterJourneyId: encounterId,
        tokenId,
        patientId: patient._id,
        familyMemberId: familyId,
        personKey: common.personKey,
        creationKey: `${tag}:lab:1`,
        requestHash: foxoHash({ test: "CBC", date: start }),
        patientInfo: { name: family.name, age: 8, gender: "male", phone: "9876543210" },
        orderingDoctorId: staff._id,
        orderingDoctorName: "Dr. Khushal Midha (Paediatrics)",
        clinicalNotes: "Complete blood count and inflammatory markers to assess acute pediatric cough",
        tests: [
          {
            testCode: "CBC",
            testName: "Complete Blood Count & Inflammatory Markers",
            category: "Hematology",
            priceMinor: 45000,
            specimenType: "Whole Blood EDTA",
            parameters: [
              { code: "WBC", name: "Total Leukocyte Count", unit: "/cumm", referenceRangeText: "5000 - 12000", valueType: "number" },
              { code: "CRP", name: "C-Reactive Protein", unit: "mg/L", referenceRangeText: "< 5.0", valueType: "number" },
              { code: "HB", name: "Hemoglobin", unit: "g/dL", referenceRangeText: "11.5 - 15.5", valueType: "number" }
            ]
          }
        ],
        orderStatus: "released",
        accessionBarcode: "DEMO-BARCODE-001",
        collectedAt: start,
        collectedByName: "Nurse Staff",
        resultEnteredAt: end,
        technicianName: "Lab Technician",
        verifiedAt: end,
        verifiedByName: "Lead Pathologist",
        releasedAt: end,
        releasedByName: "Lead Pathologist",
        reportVersion: 1,
        results: labResults,
        reportVersions: [
          {
            version: 1,
            results: labResults,
            authorId: staff._id,
            authorName: "Lab Technician",
            enteredAt: start,
            verifiedById: staff._id,
            verifiedByName: "Lead Pathologist",
            verifiedAt: end,
            releasedById: staff._id,
            releasedByName: "Lead Pathologist",
            releasedAt: end
          }
        ],
        auditHistory: [
          { stage: "ordered", actorName: "Dr. Khushal Midha", timestamp: start },
          { stage: "collected", actorName: "Nurse Staff", timestamp: start },
          { stage: "released", actorName: "Lead Pathologist", timestamp: end }
        ],
        createdAt: start,
        updatedAt: end
      };

      const prescription = {
        _id: linkedPrescriptionId,
        hospitalId: hospital._id,
        departmentId: department._id,
        encounterJourneyId: encounterId,
        tokenId,
        patientId: patient._id,
        familyMemberId: familyId,
        personKey: common.personKey,
        creationKey: `${tag}:rx:1`,
        requestHash: foxoHash({ rx: "PEDI-COUGH", date: start }),
        patientInfo: { name: family.name, age: 8, gender: "male", phone: "9876543210" },
        prescribingDoctorId: staff._id,
        prescribingDoctorName: "Dr. Khushal Midha (Paediatrics)",
        diagnosis: "Upper respiratory tract congestion — mild viral",
        version: 1,
        status: "partially_dispensed",
        verificationToken: "DEMO-RX-VERIFY-001",
        items: [
          {
            medicationCode: "AMOX-250",
            medicationName: "Amoxicillin 250mg/5ml Oral Suspension",
            directions: "5ml twice daily after meals for 5 days",
            durationDays: 5,
            quantityPrescribed: 10,
            quantityDispensed: 6,
            quantityFulfilled: 6,
            quantityReturned: 0,
            batchNumber: "BATCH-AMOX-2026A",
            unitPriceMinor: 2500,
            itemStatus: "dispensed"
          },
          {
            medicationCode: "SALINE-DROP",
            medicationName: "Pediatric Saline Nasal Drops",
            directions: "2 drops in each nostril before sleep as needed",
            durationDays: 5,
            quantityPrescribed: 2,
            quantityDispensed: 0,
            quantityFulfilled: 0,
            quantityReturned: 0,
            batchNumber: "BATCH-SALINE-2026B",
            unitPriceMinor: 1200,
            itemStatus: "pending"
          }
        ],
        fulfillmentRevision: 1,
        fulfillmentOperations: [
          {
            key: `${tag}:op:dispense:1`,
            requestHash: foxoHash({ dispense: "AMOX-250", quantity: 6 }),
            kind: "dispense",
            actorId: staff._id,
            actorName: "Hospital Pharmacist",
            at: end,
            reason: "Initial partial dispensing: 6 doses supplied; patient to collect remaining balance next visit",
            resultingStatus: "partially_dispensed",
            allocations: [
              {
                itemId: oid(`${tag}:rxitem:amox`),
                inventoryId: oid(`${tag}:inventory:amox`),
                batchId: oid(`${tag}:batch:amox`),
                batchNumber: "BATCH-AMOX-2026A",
                expiryDate: new Date("2027-12-31T00:00:00Z"),
                quantity: 6
              }
            ]
          }
        ],
        auditHistory: [
          { stage: "approved_by_doctor", actorName: "Dr. Khushal Midha", timestamp: start },
          { stage: "partially_dispensed", actorName: "Hospital Pharmacist", timestamp: end, notes: "Initial partial dispensing executed" }
        ],
        createdAt: start,
        updatedAt: end
      };

      for (const [Model, document] of [[LabOrder, labOrder], [Prescription, prescription]]) {
        if (new Model(document).validateSync()) throw new Error("Synthetic graph does not satisfy the current document schema");
        rows.push({ collection: Model.collection.name, document });
      }
    }
  }

  const pitchCards = generatePitchCards(source, family, rows);
  const metrics = deriveDemoMetrics(rows);
  const manifest = {
    task: "FOXO_DEMO_V1",
    datasetVersion: 1,
    scenarioDate: date,
    totalDocuments: rows.length,
    byCollection: metrics.byCollection,
    suppressOutgoing: true,
    linkedLabOrderId,
    linkedPrescriptionId
  };

  return { runId, family, rows, pitchCards, metrics, manifest };
}

export async function inspectFoxoDemo(db, date, session) {
  const resolved = await source(db, session), data = graph(resolved, date);
  const prior = await db.collection("demofixtureruns").findOne({ _id: data.runId }, opts(session));
  if (prior) return { task: "FOXO_DEMO_V1", mode: "existing", runId: data.runId, date, database: db.databaseName, manifest: prior.manifest || data.manifest };
  if (resolved.patient.familyMembers?.some(member => same(member._id, data.family._id) || member.name === data.family.name)) throw new Error("Existing synthetic family needs reviewed reuse; no duplicate profile will be added");
  for (const row of data.rows) {
    if (await db.collection(row.collection).findOne({ _id: row.document._id }, { ...opts(session), projection: { _id: 1 } })) throw new Error("A planned identity is already occupied");
    if (row.collection === "opdtokens" && await db.collection(row.collection).findOne({ queueKey: row.document.queueKey, tokenNumber: row.document.tokenNumber }, { ...opts(session), projection: { _id: 1 } })) throw new Error("A historical token number is occupied; nothing will be renumbered");
  }
  const plan = { task: "FOXO_DEMO_V1", mode: "additive", database: db.databaseName, date, source: resolved, ...data };
  return { ...plan, hash: foxoHash(plan) };
}

export async function applyFoxoDemo(db, client, plan, { approved = false, writersPaused = false, backupVerified = false, fault } = {}) {
  if (!approved || !writersPaused || !backupVerified || plan?.task !== "FOXO_DEMO_V1" || plan.mode !== "additive" || plan.database !== db.databaseName) throw new Error("An exact approved plan, private backup and paused writers are required");
  const { hash, ...contents } = plan;
  if (hash !== foxoHash(contents)) throw new Error("Plan integrity mismatch");
  if (fault && process.env.NODE_ENV !== "test") throw new Error("Fault injection is test-only");
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const previous = await db.collection("demofixtureruns").findOne({ _id: plan.runId }, { session });
      if (previous) {
        if (previous.planHash !== hash) throw new Error("Existing run belongs to another plan");
        for (const row of plan.rows) {
          const actual = await db.collection(row.collection).findOne({ _id: row.document._id }, { session });
          if (!actual || foxoHash(actual) !== foxoHash(row.document)) throw new Error("Seeded history changed; retain it for reviewed follow-up");
        }
        const patient = await db.collection("users").findOne({ _id: plan.source.patient._id }, { session });
        const family = patient?.familyMembers?.find(item => same(item._id, plan.family._id));
        if (!family || foxoHash(family) !== foxoHash(plan.family)) throw new Error("Seeded family changed; no recreation or overwrite is allowed");
        return { replay: true, addedVisits: 0, addedLabs: 0, addedPrescriptions: 0, insertedDocuments: 0 };
      }
      const fresh = await inspectFoxoDemo(db, plan.date, session);
      if (fresh.hash !== hash) throw new Error("Source data changed; prepare and review a fresh plan");
      await db.collection("users").updateOne({ _id: plan.source.patient._id }, { $push: { familyMembers: plan.family }, $inc: { careIdentityRevision: 1 } }, { session });
      for (const row of plan.rows) await db.collection(row.collection).insertOne(row.document, { session });
      if (fault) await fault();
      await db.collection("demofixtureruns").insertOne({
        _id: plan.runId,
        task: plan.task,
        planHash: hash,
        createdAt: new Date(),
        synthetic: true,
        familyId: plan.family._id,
        patientId: plan.source.patient._id,
        manifest: plan.manifest,
        metrics: plan.metrics,
        pitchCards: plan.pitchCards,
        references: plan.rows.map(row => ({ collection: row.collection, id: row.document._id }))
      }, { session });
      return {
        replay: false,
        addedVisits: plan.rows.filter(r => r.collection === "appointments").length,
        addedLabs: plan.rows.filter(r => r.collection === "laborders").length,
        addedPrescriptions: plan.rows.filter(r => r.collection === "prescriptions").length,
        addedFamilyProfiles: 1,
        insertedDocuments: plan.rows.length,
        metrics: plan.metrics,
        pitchCardsCount: plan.pitchCards?.length || 6
      };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
  } finally { await session.endSession(); }
}

export async function rollbackFoxoDemo(db, client, plan, { approved = false, writersPaused = false, backupVerified = false } = {}) {
  if (!approved || !writersPaused || !backupVerified || plan?.task !== "FOXO_DEMO_V1" || plan.database !== db.databaseName) {
    throw new Error("An exact approved plan, private backup and paused writers are required for rollback");
  }
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const run = await db.collection("demofixtureruns").findOne({ _id: plan.runId }, { session });
      if (!run) throw new Error("Fixture run not found; rollback refused");
      if (run.planHash !== plan.hash) throw new Error("Plan hash mismatch; rollback refused");

      // Verify that no document was modified since apply
      for (const row of plan.rows) {
        const actual = await db.collection(row.collection).findOne({ _id: row.document._id }, { session });
        if (!actual) throw new Error(`Document ${row.document._id} in ${row.collection} missing; rollback refused`);
        if (foxoHash(actual) !== foxoHash(row.document)) {
          throw new Error(`Document ${row.document._id} in ${row.collection} was modified; rollback refused to preserve clinical history`);
        }
      }

      // Check that patient still has the synthetic family member
      const patient = await db.collection("users").findOne({ _id: plan.source.patient._id }, { session });
      const family = patient?.familyMembers?.find(item => same(item._id, plan.family._id));
      if (!family || foxoHash(family) !== foxoHash(plan.family)) {
        throw new Error("Synthetic family was modified or removed; rollback refused");
      }

      // Delete all seeded documents
      for (const row of plan.rows) {
        const delResult = await db.collection(row.collection).deleteOne({ _id: row.document._id }, { session });
        if (delResult.deletedCount !== 1) throw new Error(`Failed to delete ${row.document._id} in ${row.collection}`);
      }

      // Remove family member from user and decrement careIdentityRevision
      await db.collection("users").updateOne(
        { _id: plan.source.patient._id },
        {
          $pull: { familyMembers: { _id: plan.family._id } },
          $inc: { careIdentityRevision: 1 }
        },
        { session }
      );

      // Remove demo fixture run
      await db.collection("demofixtureruns").deleteOne({ _id: plan.runId }, { session });

      return {
        rolledBack: true,
        removedVisits: plan.rows.filter(r => r.collection === "appointments").length,
        removedLabs: plan.rows.filter(r => r.collection === "laborders").length,
        removedPrescriptions: plan.rows.filter(r => r.collection === "prescriptions").length,
        removedDocuments: plan.rows.length,
        removedFamilyProfiles: 1
      };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
  } finally {
    await session.endSession();
  }
}
