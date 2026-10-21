import test from "node:test";
import assert from "node:assert/strict";
import { getDoctorQueue } from "../controller/appointment.js";
import Appointment from "../model/appointment.js";
import Doctor from "../model/doctor.js";
import Hospital from "../model/hospital.js";
import HospitalStaff from "../model/hospitalStaff.js";
import OpdToken from "../model/opdToken.js";
import QueueRevision from "../model/queueRevision.js";
import { queueContext } from "../services/queueContext.js";

const doctorId = "000000000000000000000001";
const doctor = { _id: doctorId, queueSessionIds: ["day", "evening"] };
const context = sessionId => queueContext({ doctorId, doctor, sessionId });
const query = rows => {
  const chain = { select: () => chain, sort: () => chain, populate: () => chain, lean: async () => rows,
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) };
  return chain;
};
const appointment = (queue, extra = {}) => ({
  _id: "000000000000000000000002", doctor: doctorId, ...queue, status: "queued", admissionState: "arrived",
  createdAt: new Date(0), user: { _id: "000000000000000000000003", firstName: "Synthetic", lastName: "Patient" }, ...extra,
});
const setup = (t, rows = [], revisions = [4]) => {
  t.mock.method(Doctor, "findById", async () => doctor);
  t.mock.method(HospitalStaff, "findOne", async () => null);
  t.mock.method(HospitalStaff, "find", () => query([]));
  t.mock.method(Hospital, "find", () => query([]));
  t.mock.method(OpdToken, "find", () => query([]));
  let reads = 0;
  const revisionRead = t.mock.method(QueueRevision, "findById", () => query({ revision: revisions[Math.min(reads++, revisions.length - 1)] }));
  const visits = t.mock.method(Appointment, "find", () => query(rows));
  return { visits, revisionRead };
};
const invoke = async (queueKey, role = "doctor") => {
  let body, status;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
  await getDoctorQueue({ auth: { id: doctorId, role }, query: queueKey ? { queueKey } : {} }, res);
  return { status, body };
};

test("doctor queue reads booked visits once for a stable revision", async t => {
  const queue = context(), row = appointment(queue), { visits, revisionRead } = setup(t, [row]);
  const { status, body } = await invoke();
  assert.equal(status, 200);
  assert.equal(body.queueKey, queue.queueKey);
  assert.equal(body.pendingCount, 1);
  assert.equal(body.queue[0].patientDisplayName, "Synthetic Patient");
  assert.equal(body.queueRevision, 4);
  assert.equal(visits.mock.callCount(), 1);
  assert.equal(revisionRead.mock.callCount(), 3);
  assert.deepEqual(visits.mock.calls[0].arguments[0].doctor, { $in: [doctorId] });
});

test("selected session keeps its own appointments and revision", async t => {
  const day = context(), evening = context("evening");
  const { visits, revisionRead } = setup(t, [appointment(day), appointment(evening, { _id: "evening-visit" })]);
  const { body } = await invoke(evening.queueKey);
  assert.equal(body.queueKey, evening.queueKey);
  assert.deepEqual(body.queue.map(row => row._id), ["evening-visit"]);
  assert.ok(revisionRead.mock.calls.every(call => call.arguments[0] === evening.queueKey));
  assert.equal(visits.mock.callCount(), 1);
});

test("a concurrent booking retries only the changed snapshot", async t => {
  const queue = context(), { visits } = setup(t, [], [4, 5, 5, 5]);
  let reads = 0;
  visits.mock.mockImplementation(() => query(++reads > 1 ? [appointment(queue)] : []));
  const { body } = await invoke();
  assert.equal(body.queueRevision, 5);
  assert.equal(body.pendingCount, 1);
  assert.equal(visits.mock.callCount(), 2);
});

test("inaccessible queues and patient access remain rejected", async t => {
  const { visits } = setup(t);
  await assert.rejects(invoke("independent:another-doctor:day"), { status: 403 });
  assert.equal((await invoke(undefined, "user")).status, 403);
  assert.equal(visits.mock.callCount(), 1);
});

test("malformed queue selections are rejected before reading a revision", async t => {
  const { visits, revisionRead } = setup(t);
  await assert.rejects(invoke({ other: "queue" }), { status: 403 });
  assert.equal(visits.mock.callCount(), 0);
  assert.equal(revisionRead.mock.callCount(), 0);
});

test("reserved and future visits stay separate from the ready queue", async t => {
  const queue = context();
  setup(t, [appointment(queue), appointment(queue, { _id: "reserved", admissionState: "reserved" }),
    appointment(queue, { _id: "future", scheduledStart: new Date(Date.now() + 86400000) })]);
  const { body } = await invoke();
  assert.equal(body.pendingCount, 1);
  assert.deepEqual(body.reservations.map(row => row._id), ["reserved", "future"]);
});
