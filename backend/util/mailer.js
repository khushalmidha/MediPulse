import nodemailer from "nodemailer";
import dns from "node:dns";
import { lookup as lookupDns } from "node:dns/promises";

const requiredMailConfig = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
const RESEND_API_URL = "https://api.resend.com/emails";
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const smtpConnectionErrorCodes = new Set(["ECONNECTION", "ESOCKET", "ETIMEDOUT", "ENETUNREACH", "ECONNREFUSED"]);

dns.setDefaultResultOrder("ipv4first");

const resolveSmtpHost = async () => {
  if (process.env.SMTP_FORCE_IPV4 === "false") {
    return process.env.SMTP_HOST;
  }

  const { address } = await lookupDns(process.env.SMTP_HOST, { family: 4 });
  return address;
};

const lookupSmtpHost = (hostname, options, callback) => {
  if (process.env.SMTP_FORCE_IPV4 === "false") {
    dns.lookup(hostname, options, callback);
    return;
  }

  dns.lookup(hostname, { ...options, family: 4 }, callback);
};

const getSmtpConfigs = () => {
  const primary = {
    label: "primary",
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
  };

  const configs = [primary];
  const isGmail = (process.env.SMTP_HOST || "").toLowerCase() === "smtp.gmail.com";

  if (isGmail && primary.port !== 465) {
    configs.push({ label: "gmail-ssl-fallback", port: 465, secure: true });
  }

  return configs;
};

const isSmtpConnectionError = (error) => {
  const message = error?.message || "";
  return smtpConnectionErrorCodes.has(error?.code) || /timeout|ENETUNREACH|ECONNREFUSED/i.test(message);
};

const getTransporter = async (smtpConfig = getSmtpConfigs()[0]) => {
  const missing = requiredMailConfig.filter((key) => !process.env[key]);
  if (missing.length) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Mail service is not configured. Missing: ${missing.join(", ")}`);
    }

    console.warn(
      `Mail service is not configured. Missing: ${missing.join(", ")}. Using console fallback in development.`,
    );

    return {
      sendMail: async ({ to, subject, text }) => {
        console.log("[mail:fallback]", { to, subject, text });
        return { messageId: `dev-${Date.now()}` };
      },
    };
  }

  const smtpHost = await resolveSmtpHost();

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    family: 4,
    lookup: lookupSmtpHost,
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 60000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 30000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 60000),
    tls: {
      servername: process.env.SMTP_HOST,
    },
    logger: process.env.SMTP_DEBUG === "true",
    debug: process.env.SMTP_DEBUG === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const verifyMailTransport = async () => {
  if (process.env.BREVO_API_KEY) {
    console.log("Mail provider: Brevo API");
    return;
  }

  if (process.env.RESEND_API_KEY) {
    console.log("Mail provider: Resend API");
    return;
  }

  const missing = requiredMailConfig.filter((key) => !process.env[key]);
  if (missing.length) {
    console.warn(`SMTP verify skipped. Missing: ${missing.join(", ")}`);
    return;
  }

  const configs = getSmtpConfigs();

  for (const [index, smtpConfig] of configs.entries()) {
    try {
      const resolvedHost = await resolveSmtpHost().catch(() => null);
      console.log("SMTP provider:", {
        host: process.env.SMTP_HOST,
        resolvedHost,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        label: smtpConfig.label,
        forceIpv4: process.env.SMTP_FORCE_IPV4 !== "false",
      });
      const transporter = await getTransporter(smtpConfig);
      await transporter.verify();
      console.log(`SMTP Ready (${smtpConfig.label})`);
      return;
    } catch (error) {
      console.error("SMTP Error:", {
        message: error.message,
        code: error.code,
        command: error.command,
        responseCode: error.responseCode,
        host: process.env.SMTP_HOST,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        label: smtpConfig.label,
        forceIpv4: process.env.SMTP_FORCE_IPV4 !== "false",
        resolvedHost: await resolveSmtpHost().catch(() => null),
      });

      if (!isSmtpConnectionError(error) || index === configs.length - 1) {
        return;
      }
    }
  }
};

const sendWithResend = async ({ from, to, subject, text, html }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        text,
        html,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || `Resend email failed with status ${response.status}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

const parseMailFrom = (from) => {
  const fallbackEmail = process.env.SMTP_USER || process.env.BREVO_SENDER_EMAIL;
  const match = String(from || "").match(/^(.*?)\s*<([^>]+)>$/);

  if (match) {
    return {
      name: match[1].replace(/^"|"$/g, "").trim() || "MediPulse",
      email: match[2].trim(),
    };
  }

  return {
    name: process.env.BREVO_SENDER_NAME || "MediPulse",
    email: String(from || process.env.BREVO_SENDER_EMAIL || fallbackEmail || "").trim(),
  };
};

const sendWithBrevo = async ({ from, to, subject, text, html }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const sender = parseMailFrom(process.env.BREVO_SENDER_EMAIL || from);

  try {
    const response = await fetch(BREVO_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender,
        to: (Array.isArray(to) ? to : [to]).map((email) => ({ email })),
        subject,
        textContent: text,
        htmlContent: html,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || `Brevo email failed with status ${response.status}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

const sendMail = async (mailOptions) => {
  if (process.env.BREVO_API_KEY) {
    try {
      return await sendWithBrevo(mailOptions);
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Brevo email request timed out");
      }
      throw error;
    }
  }

  if (process.env.RESEND_API_KEY) {
    try {
      return await sendWithResend(mailOptions);
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Resend email request timed out");
      }
      throw error;
    }
  }

  const configs = getSmtpConfigs();
  let lastError;

  for (const [index, smtpConfig] of configs.entries()) {
    const transporter = await getTransporter(smtpConfig);

    try {
      return await transporter.sendMail(mailOptions);
    } catch (error) {
      lastError = error;

      if (error?.code === "EAUTH" || /Username and Password not accepted/i.test(error?.message || "")) {
        throw new Error(
          "Gmail authentication failed. Use a Google App Password in SMTP_PASS, not your normal Gmail password.",
        );
      }

      if (!isSmtpConnectionError(error) || index === configs.length - 1) {
        throw error;
      }

      console.warn(`SMTP send failed on ${smtpConfig.label}; trying next SMTP option.`, {
        message: error.message,
        code: error.code,
      });
    }
  }

  throw lastError;
};

const sendAppointmentOtpMail = async ({ to, patientName, doctorName, otp }) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  await sendMail({
    from,
    to,
    subject: "Your MediPulse appointment booking OTP",
    text: `Hi ${patientName || "there"},

Your OTP for booking an appointment with ${doctorName} is ${otp}.

This OTP is valid for 10 minutes. If you did not request this booking, please ignore this email.

MediPulse`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">MediPulse appointment OTP</h2>
        <p>Hi ${patientName || "there"},</p>
        <p>Your OTP for booking an appointment with <strong>${doctorName}</strong> is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 18px 0;">${otp}</p>
        <p>This OTP is valid for 10 minutes.</p>
        <p style="color: #6b7280;">If you did not request this booking, please ignore this email.</p>
      </div>
    `,
  });
};

const sendPasswordResetOtpMail = async ({ to, accountName, otp }) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  await sendMail({
    from,
    to,
    subject: "Your MediPulse password reset OTP",
    text: `Hi ${accountName || "there"},

Your MediPulse password reset OTP is ${otp}.

This OTP is valid for 10 minutes. If you did not request this, please ignore this email.

MediPulse`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">MediPulse password reset OTP</h2>
        <p>Hi ${accountName || "there"},</p>
        <p>Your password reset OTP is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 18px 0;">${otp}</p>
        <p>This OTP is valid for 10 minutes.</p>
      </div>
    `,
  });
};

const sendAppointmentBookedMail = async ({ to, patientName, doctorName, appointmentId }) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  await sendMail({
    from,
    to,
    subject: "Your MediPulse appointment is booked",
    text: `Hi ${patientName || "there"},

Your appointment with Dr. ${doctorName || "Doctor"} has been booked and added to the live queue.

Appointment ID: ${appointmentId}

MediPulse`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Appointment booked successfully</h2>
        <p>Hi ${patientName || "there"},</p>
        <p>Your appointment with <strong>Dr. ${doctorName || "Doctor"}</strong> has been booked and added to the live queue.</p>
        <p style="color: #6b7280;">Appointment ID: ${appointmentId}</p>
      </div>
    `,
  });
};

const sendAppointmentRefundMail = async ({
  to,
  patientName,
  doctorName,
  appointmentId,
  amount,
}) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  await sendMail({
    from,
    to,
    subject: "Your MediPulse booking was refunded",
    text: `Hi ${patientName || "there"},

Your appointment request with Dr. ${doctorName || "Doctor"} was cancelled.
INR ${Number(amount || 0).toFixed(2)} has been refunded to your wallet.

Appointment ID: ${appointmentId}

MediPulse`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Booking refunded</h2>
        <p>Hi ${patientName || "there"},</p>
        <p>Your appointment request with <strong>Dr. ${doctorName || "Doctor"}</strong> was cancelled.</p>
        <p><strong>INR ${Number(amount || 0).toFixed(2)}</strong> has been refunded to your wallet.</p>
        <p style="color: #6b7280;">Appointment ID: ${appointmentId}</p>
      </div>
    `,
  });
};

const sendHospitalWelcomeMail = async ({ to, hospitalName }) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || process.env.BREVO_SENDER_EMAIL;

  await sendMail({
    from,
    to,
    subject: "MediPulse hospital registration received",
    text: `Hi,

Your hospital registration for ${hospitalName} has been received and is pending platform verification.

MediPulse`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Registration received</h2>
        <p>Your hospital registration for <strong>${hospitalName}</strong> has been received.</p>
        <p>Our platform team will verify it and activate your hospital workspace.</p>
      </div>
    `,
  });
};

const sendHospitalAdminAlertMail = async ({ to, hospitalName, email, city, approveUrl, rejectUrl }) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || process.env.BREVO_SENDER_EMAIL;

  if (!to) return;

  await sendMail({
    from,
    to,
    subject: `New MediPulse hospital registration: ${hospitalName}`,
    text: `New hospital registration:

Hospital: ${hospitalName}
Email: ${email}
City: ${city}

Approve: ${approveUrl || "Not available"}
Reject: ${rejectUrl || "Not available"}`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">New hospital registration</h2>
        <p><strong>${hospitalName}</strong> has applied to join MediPulse.</p>
        <p>Email: ${email}</p>
        <p>City: ${city || "Not provided"}</p>
        ${
          approveUrl && rejectUrl
            ? `<p style="margin: 24px 0;">
                <a href="${approveUrl}" style="display: inline-block; margin-right: 12px; padding: 12px 18px; border-radius: 8px; background: #16a34a; color: #ffffff; text-decoration: none; font-weight: 700;">Approve Hospital</a>
                <a href="${rejectUrl}" style="display: inline-block; padding: 12px 18px; border-radius: 8px; background: #dc2626; color: #ffffff; text-decoration: none; font-weight: 700;">Reject</a>
              </p>`
            : ""
        }
      </div>
    `,
  });
};

const sendHospitalApprovedMail = async ({ to, hospitalName, adminName, hospitalId, loginUrl, email, password }) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || process.env.BREVO_SENDER_EMAIL;

  await sendMail({
    from,
    to,
    subject: `${hospitalName} is approved on MediPulse`,
    text: `Hi ${adminName || "there"},

Your hospital ${hospitalName} has been approved on MediPulse.

Login URL: ${loginUrl}
Hospital ID: ${hospitalId}
Email: ${email}
${password ? `Password: ${password}` : "Password: Use the password you created during signup."}

After signing in, change your password from the staff account settings when available.

MediPulse`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Hospital approved</h2>
        <p>Hi ${adminName || "there"},</p>
        <p><strong>${hospitalName}</strong> has been approved on MediPulse.</p>
        <div style="margin: 18px 0; padding: 16px; border-radius: 10px; background: #f8fafc; border: 1px solid #e5e7eb;">
          <p style="margin: 0 0 8px;"><strong>Hospital ID:</strong> ${hospitalId}</p>
          <p style="margin: 0 0 8px;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 0;"><strong>Password:</strong> ${password || "Use the password created during signup"}</p>
        </div>
        <p style="margin: 24px 0;">
          <a href="${loginUrl}" style="display: inline-block; padding: 12px 18px; border-radius: 8px; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 700;">Open MediPulse Login</a>
        </p>
        <p style="color: #6b7280;">You can change the password later from staff account settings.</p>
      </div>
    `,
  });
};

const sendHospitalRejectedMail = async ({ to, hospitalName, reason }) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || process.env.BREVO_SENDER_EMAIL;

  await sendMail({
    from,
    to,
    subject: `${hospitalName} registration update`,
    text: `Hi,

Your hospital registration for ${hospitalName} was not approved right now.

Reason: ${reason || "Please contact MediPulse support for details."}

MediPulse`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Hospital registration update</h2>
        <p>Your hospital registration for <strong>${hospitalName}</strong> was not approved right now.</p>
        <p><strong>Reason:</strong> ${reason || "Please contact MediPulse support for details."}</p>
      </div>
    `,
  });
};

const sendStaffInviteMail = async ({ to, staffName, hospitalName, inviteUrl }) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || process.env.BREVO_SENDER_EMAIL;

  await sendMail({
    from,
    to,
    subject: `You're invited to join ${hospitalName} on MediPulse`,
    text: `Hi ${staffName || "there"},

You have been invited to join ${hospitalName} on MediPulse.

Accept invite: ${inviteUrl}

This invite expires in 48 hours.`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">MediPulse staff invite</h2>
        <p>Hi ${staffName || "there"},</p>
        <p>You have been invited to join <strong>${hospitalName}</strong> on MediPulse.</p>
        <p style="margin: 24px 0;">
          <a href="${inviteUrl}" style="display: inline-block; padding: 12px 18px; border-radius: 8px; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 700;">Accept invite</a>
        </p>
        <p style="color: #6b7280;">This invite expires in 48 hours.</p>
      </div>
    `,
  });
};

const sendStaffRemovalOtpMail = async ({ to, adminName, staffName, otp }) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || process.env.BREVO_SENDER_EMAIL;

  await sendMail({
    from,
    to,
    subject: "MediPulse staff removal OTP",
    text: `Hi ${adminName || "Admin"},

Your OTP to remove ${staffName || "this staff member"} from hospital staff is ${otp}.

This OTP is valid for 10 minutes. If you did not request this, ignore this email.

MediPulse`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Staff removal OTP</h2>
        <p>Hi ${adminName || "Admin"},</p>
        <p>Your OTP to remove <strong>${staffName || "this staff member"}</strong> is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 18px 0;">${otp}</p>
        <p>This OTP is valid for 10 minutes.</p>
      </div>
    `,
  });
};

const sendReviewRequestMail = async ({ to, patientName, hospitalName, tokenDisplay, reviewUrl }) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || process.env.BREVO_SENDER_EMAIL;

  await sendMail({
    from,
    to,
    subject: `How was your visit at ${hospitalName}?`,
    text: `Hi ${patientName || "there"},

Thanks for visiting ${hospitalName}. Please rate your experience for token ${tokenDisplay || ""}.

Review link: ${reviewUrl}

MediPulse`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">How was your visit?</h2>
        <p>Hi ${patientName || "there"},</p>
        <p>Thanks for visiting <strong>${hospitalName}</strong>. Your feedback helps patients choose better care.</p>
        ${tokenDisplay ? `<p>Visit token: <strong>${tokenDisplay}</strong></p>` : ""}
        <p style="margin: 24px 0;">
          <a href="${reviewUrl}" style="display: inline-block; padding: 12px 18px; border-radius: 8px; background: #2563eb; color: #ffffff; text-decoration: none; font-weight: 700;">Rate your experience</a>
        </p>
      </div>
    `,
  });
};

export {
  sendHospitalAdminAlertMail,
  sendHospitalApprovedMail,
  sendHospitalRejectedMail,
  sendHospitalWelcomeMail,
  sendAppointmentBookedMail,
  sendAppointmentOtpMail,
  sendAppointmentRefundMail,
  sendPasswordResetOtpMail,
  sendReviewRequestMail,
  sendStaffInviteMail,
  sendStaffRemovalOtpMail,
  verifyMailTransport,
};
