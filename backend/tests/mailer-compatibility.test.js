import test from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { sendMail } from "../util/mailer.js";

test("upgraded mailer renders the actual delivery payload without external delivery", async t => {
  const configured = { MAIL_DELIVERY: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "2525", SMTP_SECURE: "false", SMTP_USER: "synthetic@example.invalid", SMTP_PASS: "synthetic-only", SMTP_FORCE_IPV4: "false", BREVO_API_KEY: "", RESEND_API_KEY: "" };
  const previous = Object.fromEntries(Object.keys(configured).map(key => [key, process.env[key]]));
  const createTransport = nodemailer.createTransport.bind(nodemailer);
  const transport = createTransport({ streamTransport: true, buffer: true, newline: "unix", disableFileAccess: true, disableUrlAccess: true });
  const intercepted = t.mock.method(nodemailer, "createTransport", options => {
    assert.equal(options.host, "127.0.0.1"); assert.equal(options.port, 2525); assert.equal(options.secure, false);
    return transport;
  });
  Object.assign(process.env, configured);
  try {
    const result = await sendMail({ from: "synthetic@example.invalid", to: "recipient@example.invalid", subject: "Synthetic appointment update", text: "Synthetic visit timeline", html: "<p>Synthetic visit timeline</p>" });
    assert.equal(intercepted.mock.callCount(), 1);
    assert.deepEqual(result.envelope.to, ["recipient@example.invalid"]);
    assert.ok(Buffer.isBuffer(result.message));
    assert.match(result.message.toString(), /Subject: Synthetic appointment update/);
    assert.match(result.message.toString(), /Synthetic visit timeline/);
    assert.match(result.message.toString(), /Content-Type: multipart\/alternative/);
  } finally {
    transport.close();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
