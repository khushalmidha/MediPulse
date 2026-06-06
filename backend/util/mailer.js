import nodemailer from "nodemailer";

const requiredMailConfig = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
const RESEND_API_URL = "https://api.resend.com/emails";

const getTransporter = () => {
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

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    family: 4,
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 60000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 30000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 60000),
    tls: {
      servername: process.env.SMTP_HOST,
    },
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const verifyMailTransport = async () => {
  if (process.env.RESEND_API_KEY) {
    console.log("Mail provider: Resend API");
    return;
  }

  const missing = requiredMailConfig.filter((key) => !process.env[key]);
  if (missing.length) {
    console.warn(`SMTP verify skipped. Missing: ${missing.join(", ")}`);
    return;
  }

  try {
    await getTransporter().verify();
    console.log("SMTP Ready");
  } catch (error) {
    console.error("SMTP Error:", {
      message: error.message,
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE,
    });
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

const sendMail = async (mailOptions) => {
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

  const transporter = getTransporter();

  try {
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    if (error?.code === "EAUTH" || /Username and Password not accepted/i.test(error?.message || "")) {
      throw new Error(
        "Gmail authentication failed. Use a Google App Password in SMTP_PASS, not your normal Gmail password.",
      );
    }

    throw error;
  }
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

const sendAppointmentApprovalMail = async ({
  to,
  doctorName,
  patientName,
  appointmentId,
  approveUrl,
  cancelUrl,
}) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  await sendMail({
    from,
    to,
    subject: "Confirm your MediPulse appointment request",
    text: `Hi ${patientName || "there"},

Please confirm your appointment request with Dr. ${doctorName || "Doctor"}.

Approve: ${approveUrl}
Cancel and refund: ${cancelUrl}

Appointment ID: ${appointmentId}

MediPulse`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Confirm your appointment request</h2>
        <p>Hi ${patientName || "there"},</p>
        <p>Please confirm your appointment request with <strong>Dr. ${doctorName || "Doctor"}</strong>.</p>
        <p style="margin: 24px 0;">
          <a href="${approveUrl}" style="display: inline-block; margin-right: 12px; padding: 12px 18px; border-radius: 8px; background: #16a34a; color: #ffffff; text-decoration: none; font-weight: 700;">Approve</a>
          <a href="${cancelUrl}" style="display: inline-block; padding: 12px 18px; border-radius: 8px; background: #dc2626; color: #ffffff; text-decoration: none; font-weight: 700;">Cancel & Refund</a>
        </p>
        <p style="color: #6b7280;">Appointment ID: ${appointmentId}</p>
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

Your appointment with Dr. ${doctorName || "Doctor"} has been approved and booked successfully.

Appointment ID: ${appointmentId}

MediPulse`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Appointment booked successfully</h2>
        <p>Hi ${patientName || "there"},</p>
        <p>Your appointment with <strong>Dr. ${doctorName || "Doctor"}</strong> has been approved and booked successfully.</p>
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

export {
  sendAppointmentApprovalMail,
  sendAppointmentBookedMail,
  sendAppointmentOtpMail,
  sendAppointmentRefundMail,
  sendPasswordResetOtpMail,
  verifyMailTransport,
};
