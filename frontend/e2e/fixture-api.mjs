import { createServer } from "node:http";
import { createRequire } from "node:module";
const { Server } = createRequire(new URL("../../backend/package.json", import.meta.url))("socket.io");

// Synthetic contracts only. No application modules, secrets, providers or databases.
const doctor = { _id: "000000000000000000000001", firstName: "Fixture", lastName: "Doctor", consultationFee: 500, specialization: "General Medicine" };
const community = { _id: "000000000000000000000040", title: "Fixture Care Community", bio: "Synthetic community summary", category: "Health", author: doctor._id, memberCount: 7, createdAt: "2026-10-09T00:00:00Z" };
const appointmentId = "000000000000000000000003";
let state = { guest: false, failBooking: false, bookings: 0, bookingKeys: [], nurse: false, doctorSession: false, checkedIn: false, hidePending: false, topupKeys: [], refundKeys: [], topups: 0, refunds: 0 };
const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:15173");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Idempotency-Key,Authorization,X-CSRF-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  const reply = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  if (req.method === "OPTIONS") return reply({});
  const path = new URL(req.url, "http://127.0.0.1:19080").pathname.replace(/\/$/, "");
  if (path === "/health/live") return reply({ status: "alive" });
  if (path === "/__fixture/reset" && req.method === "POST") {
    let body = ""; for await (const chunk of req) body += chunk;
    state = { guest: false, failBooking: false, bookings: 0, bookingKeys: [], nurse: false, doctorSession: false, checkedIn: false, hidePending: false, topupKeys: [], refundKeys: [], topups: 0, refunds: 0, ...JSON.parse(body || "{}") }; return reply(state);
  }
  if (path === "/__fixture/state") return reply(state);
  const callDoctor = state.callMode ? (req.headers.cookie || "").includes("fixtureRole=doctor") : state.doctorSession;
  if (path === "/__fixture/disconnect-doctor" && req.method === "POST") {
    for (const socket of io.sockets.sockets.values()) if (socket.data.callRole === "doctor") socket.conn.close();
    return reply({ disconnected: true });
  }
  if (state.callMode && path === `/appointment/${appointmentId}/call-credentials`) return reply({ iceServers: [], relayConfigured: true, expiresAt: null });
  if (state.callMode && path === `/appointment/${appointmentId}/end` && req.method === "POST") {
    if (!callDoctor || req.headers["x-csrf-token"] !== "fixture-account-csrf") return reply({ message: "Forbidden" }, 403);
    state.callEnded = true; state.ends = (state.ends || 0) + 1;
    io.to(`appointment:${appointmentId}`).emit("appointment:ended", { appointmentId });
    return reply({ message: "Consultation completed" });
  }
  if (state.callMode && path === `/appointment/${appointmentId}`) return reply({ _id: appointmentId, status: state.callEnded ? "completed" : "active", visitMode: "online", revision: state.callEnded ? 3 : 2 });
  const hospitalId = "000000000000000000000004", departmentId = "000000000000000000000006";
  const staff = { _id: "000000000000000000000005", name: "Fixture Nurse", role: "NURSE", hospitalId, departmentIds: [departmentId] };
  if (path === "/verify/staff") return state.nurse ? reply({ csrfToken: "fixture-staff-csrf", data: staff, role: "NURSE", hospital: { _id: hospitalId, name: "Fixture Hospital" } }) : reply({ message: "Synthetic patient session" }, 401);
  if (path === "/verify") return state.guest || state.nurse ? reply({}, 401) : callDoctor ? reply({csrfToken:"fixture-account-csrf",role:"doctor",data:doctor}) : reply({ csrfToken: "fixture-account-csrf", role: "user", data: { _id: "000000000000000000000002", firstName: "Fixture", lastName: "Patient", communities: state.communitySummary ? [community._id] : [] } });
  if (["/user/logout", "/user/staff/logout"].includes(path) && req.method === "POST") {
    const expected = path.includes("staff") ? "fixture-staff-csrf" : "fixture-account-csrf";
    if (req.headers["x-csrf-token"] !== expected) return reply({ message: "Invalid synthetic CSRF" }, 403);
    res.setHeader("Set-Cookie", "token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    state.guest = true; state.nurse = false; state.logouts = (state.logouts || 0) + 1;
    return reply({ message: "Signed out" });
  }
  if (path === "/user/login" && req.method === "POST") {
    state.guest = false; state.nurse = false;
    res.setHeader("Set-Cookie", ["staffToken=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0", "token=fixture-opaque-session; Path=/; HttpOnly; SameSite=Lax"]);
    return reply({ csrfToken: "fixture-account-csrf", success: true, result: { _id: "000000000000000000000002", firstName: "Fixture", lastName: "Patient" } }, 201);
  }
  if (path === "/community/user" || path === "/community") return reply(state.communitySummary ? [community] : []);
  if (path === `/community/${community._id}`) return reply([]);
  if (path === "/api/hospitals/resolve-host") {
    const host = new URL(req.url, "http://127.0.0.1:19080").searchParams.get("host");
    return ["fixture.medipulse.live", "care.example.test"].includes(host) ? reply({ hospital: { _id: hospitalId, slug: "fixture", name: "Fixture Hospital" } }) : reply({ message: "Website unavailable" }, 404);
  }
  if (path === "/api/hospitals") return reply({ items: [{ _id: hospitalId, slug: "fixture", name: "Fixture Hospital", type: "clinic", address: { city: "Fixture", state: "Fixture" }, branding: {}, stats: {} }] });
  if (path === "/api/hospitals/fixture") return reply({ hospital: { _id: hospitalId, slug: "fixture", name: "Fixture Hospital", address: { city: "Fixture", state: "Fixture" }, settings: { queueSessionIds: ["day"] }, branding: { primaryColor: state.brandColor || "#115e59" } },
    departments: [{ _id: departmentId, name: "Fixture OPD" }], doctors: [{ ...doctor, name: "Fixture Doctor", departmentIds: [departmentId], doctorProfile: { consultationFee: 500 } }] });
  if (path === "/api/hospitals/fixture/queue-status") return reply({ departments: [{ id: departmentId, name: "Fixture OPD", currentToken: null, todayTokensIssued: 1, estimatedWait: 0 }] });
  if (path === `/api/reviews/hospital/${hospitalId}`) return reply({ items: [] });
  if (path === `/api/opd/${hospitalId}/${departmentId}/book` && req.method === "POST") {
    if (req.headers["x-csrf-token"] !== "fixture-account-csrf") return reply({ message: "Invalid synthetic CSRF" }, 403);
    let body = ""; for await (const chunk of req) body += chunk;
    state.hospitalBooking = JSON.parse(body);
    return reply({ token: { _id: appointmentId, displayToken: "T001", status: "reserved" }, displayToken: "T001", queuePosition: 0, estimatedWaitMinutes: null }, 201);
  }
  if (path === `/api/opd/${hospitalId}/my-token`) {
    if (state.failVisits) return reply({ message: "Synthetic visits outage" }, 503);
    const token = { _id: appointmentId, displayToken: "T001", serviceDate: "2026-10-09", sessionId: "day", status: state.opdCalled ? "in_consultation" : "waiting", revision: state.opdCalled ? 3 : 2 };
    return reply({ token, tokens: state.secondToken ? [token, { ...token, _id: "000000000000000000000007", displayToken: "T002" }] : [token] });
  }
  if (path === "/__fixture/stale-opd-hint" && req.method === "POST") { io.emit("opd:patient-called", { displayToken: "STALE" }); return reply({ sent: true }); }
  if (path === "/count") return reply({ users: 0, doctors: 1, communities: 0 });
  if (path === "/vpay/admin/stats") return reply({});
  if (path === "/vpay/admin/wallets") return reply({ items: [] });
  if (["/vpay/wallet/topup", "/vpay/refund"].includes(path) && req.method === "POST") {
    if (req.headers["x-csrf-token"] !== "fixture-account-csrf") return reply({ message: "Invalid synthetic account CSRF" }, 403);
    const requestKey = req.headers["idempotency-key"];
    if (!requestKey) return reply({ message: "Fixture requires Idempotency-Key" }, 400);
    const topup = path.endsWith("topup"), keys = topup ? state.topupKeys : state.refundKeys;
    if (!keys.includes(requestKey)) state[topup ? "topups" : "refunds"]++;
    keys.push(requestKey);
    return reply({ message: topup ? "Demo top-up completed" : "Demo refund completed" });
  }
  if (path === "/vpay/wallet/dashboard") return reply({ wallet: { balance: 1000 }, recentTransactions: [] });
  if (path === `/doctor/${doctor._id}`) return reply({ user: { ...doctor, communities: state.communitySummary ? [community] : [] }, communities: state.communitySummary ? [community] : [] });
  if (path === `/doctor/${doctor._id}/hospitals`) return reply({ hospitals: [] });
  if (path === "/appointment/history" || path === "/appointment/my-appointments") return reply({ appointments: [] });
  if (state.callMode && path === `/appointment/doctor/${doctor._id}/pending`) return reply({ queueKey: "independent:fixture", queueRevision: state.callEnded ? 3 : 2, pendingCount: 0,
    myAppointment: state.callEnded ? null : { _id: appointmentId, status: "active", visitMode: "online", revision: 2 } });
  if (path === `/appointment/doctor/${doctor._id}/pending`) return reply({ pendingCount: state.bookings, myAppointment: state.bookings && !state.failBooking && !state.hidePending ? { _id: appointmentId, status: "queued", queuePosition: 1 } : null });
  if (path === `/appointment/book/${doctor._id}` && req.method === "POST") {
    if (req.headers["x-csrf-token"] !== "fixture-account-csrf") return reply({ message: "Invalid synthetic account CSRF" }, 403);
    const requestKey = req.headers["idempotency-key"];
    if (!requestKey) return reply({ message: "Fixture requires Idempotency-Key" }, 400);
    if (!state.bookingKeys.includes(requestKey)) state.bookings++;
    state.bookingKeys.push(requestKey);
    return state.failBooking ? reply({ message: "Synthetic insufficient demo balance" }, 402) : reply({ appointmentId });
  }
  if (path === `/api/triage/start/${appointmentId}`) return reply({ message: "Fixture question: what brings you here today?", patientBrief: null });
  if (path === "/api/staff-messages/directory") return reply({ departments: [{ _id: departmentId, name: "Fixture OPD" }], staff: [{ ...doctor, role: "DOCTOR", name: "Fixture Doctor", departmentIds: [departmentId] }] });
  const reserved = { _id: appointmentId, displayToken: "T001", revision: state.vitalsDone ? 3 : state.checkedIn ? 2 : 1, status: state.vitalsDone ? "vitals_done" : state.checkedIn ? "waiting" : "reserved", patientInfo: { name: "Fixture Patient" } };
  if (path === `/api/opd/${hospitalId}/${doctor._id}/queue`) return reply({ waiting: [...(state.checkedIn ? [reserved] : []), ...(state.issuedTokens ? [{ ...reserved, _id: "000000000000000000000008", displayToken: "T002", status: "waiting" }] : [])], reservations: state.checkedIn ? [] : [reserved], currentlyServing: null });
  if (path === `/api/opd/${hospitalId}/${departmentId}/token` && req.method === "POST") {
    if (req.headers["x-csrf-token"] !== "fixture-staff-csrf") return reply({ message: "Invalid synthetic staff CSRF" }, 403);
    let body = ""; for await (const chunk of req) body += chunk;
    state.walkIn = JSON.parse(body); state.issuedTokens = (state.issuedTokens || 0) + 1;
    return reply({ token: { ...reserved, displayToken: "T002", status: "waiting" } }, 201);
  }
  if (path === `/api/opd/tokens/${appointmentId}/vitals` && req.method === "PATCH") {
    if (req.headers["x-csrf-token"] !== "fixture-staff-csrf") return reply({ message: "Invalid synthetic staff CSRF" }, 403);
    let body = ""; for await (const chunk of req) body += chunk;
    state.savedVitals = JSON.parse(body); state.vitalsDone = true;
    return reply({ token: { ...reserved, status: "vitals_done" } });
  }
  if (path === `/api/opd/tokens/${appointmentId}/check-in` && req.method === "PATCH") { if (req.headers["x-csrf-token"] !== "fixture-staff-csrf") return reply({ message: "Invalid synthetic staff CSRF" }, 403); state.checkedIn = true; return reply({ token: { ...reserved, status: "waiting", revision: 2 } }); }
  if (state.callMode && path === "/appointment/doctor/queue") return reply({ queueKey: "independent:fixture", queueRevision: state.callEnded ? 3 : 2,
    queues: [{ queueKey: "independent:fixture", visitMode: "online", serviceDate: "2026-10-09", sessionId: "day" }], pendingCount: 0, queue: [], reservations: [],
    activeAppointment: state.callEnded ? null : { _id: appointmentId, status: "active", visitMode: "online", revision: 2, user: { firstName: "Fixture", lastName: "Patient" } } });
  if (path === "/appointment/doctor/queue") {
    const requested = new URL(req.url, "http://127.0.0.1:19080").searchParams.get("queueKey");
    const selected = requested || (state.revokeHospitalQueue ? "independent:fixture" : "hospital:fixture");
    if (state.revokeHospitalQueue && selected === "hospital:fixture") return reply({ message: "Hospital queue unavailable" }, 403);
    return reply({ queueKey: selected, queues: [{ queueKey: "hospital:fixture", visitMode: "in_person", serviceDate: "2026-10-09", sessionId: "day" },
      { queueKey: "independent:fixture", visitMode: "online", serviceDate: "2026-10-09", sessionId: "day" }], pendingCount: 0, queue: [], reservations: [],
      activeAppointment: selected === "hospital:fixture" ? { _id: appointmentId, status: "active", visitMode: "in_person", user: { firstName: "Fixture", lastName: "Patient" } } : null });
  }
  if (path === "/api/reviews/pending") return reply({ pending: null });
  if (path === "/api/reviews/platform/homepage") return reply({ reviews: [] });
  return reply({ message: "No synthetic fixture for this request" }, 404);
});
// Actual local WebRTC uses synthetic Socket.IO signaling and host candidates only.
const io = new Server(server, { cors: { origin: "http://127.0.0.1:15173", credentials: true } });
const presence = room => {
  const members = [...io.sockets.sockets.values()].filter(socket => socket.rooms.has(room));
  const doctorJoined = members.some(socket => socket.data.callRole === "doctor"), patientJoined = members.some(socket => socket.data.callRole === "user");
  return { appointmentId, doctorJoined, patientJoined, ready: doctorJoined && patientJoined };
};
io.on("connection", socket => {
  socket.data.callRole = (socket.handshake.headers.cookie || "").includes("fixtureRole=doctor") ? "doctor" : "user";
  if (state.callMode && socket.data.callRole === "doctor") state.doctorConnections = (state.doctorConnections || 0) + 1;
  const room = `appointment:${appointmentId}`;
  socket.on("joinAppointmentRoom", (payload, ack) => {
    if (!state.callMode || state.callEnded || payload.appointmentId !== appointmentId) return ack?.({ ok: false });
    socket.join(room); const result = presence(room); io.to(room).emit("appointment:presence", result); ack?.({ ok: true, ...result });
  });
  socket.on("leaveAppointmentRoom", () => { socket.leave(room); io.to(room).emit("appointment:presence", presence(room)); });
  socket.on("disconnect", () => { io.to(room).emit("appointment:presence", presence(room)); });
  for (const event of ["appointment:offer", "appointment:answer", "appointment:ice-candidate", "appointment:renegotiate", "appointment:chat-message"])
    socket.on(event, payload => { if (socket.rooms.has(room) && !state.callEnded) socket.to(room).emit(event, payload); });
});
server.listen(19080, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => io.close(() => process.exit(0)));
