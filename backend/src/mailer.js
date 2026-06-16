// Email delivery via SMTP (nodemailer). Configuration lives in
// notificationSettings.smtp and is editable by superadmins from the app.
//
//   smtp: {
//     enabled, host, port, secure (true=465/SSL),
//     username, password, fromName, fromAddress,
//     health: "ok" | "not work" | "unable", lastTestAt
//   }

let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch { /* installed at deploy time */ }

function smtpConfigured(smtp) {
  return Boolean(smtp && smtp.host && smtp.port && smtp.fromAddress);
}

function buildTransport(smtp) {
  if (!nodemailer) throw new Error("nodemailer is not installed");
  if (!smtpConfigured(smtp)) throw new Error("SMTP is not fully configured");
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port),
    secure: Boolean(smtp.secure),
    auth: smtp.username ? { user: smtp.username, pass: smtp.password || "" } : undefined,
    connectionTimeout: 12000,
    greetingTimeout: 12000
  });
}

// Send one email. Returns { ok, error }.
async function sendMail(smtp, { to, subject, text, html }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter((a) => a && String(a).includes("@"));
  if (!recipients.length) return { ok: false, error: "No valid recipients" };
  try {
    const transport = buildTransport(smtp);
    const from = smtp.fromName ? `"${smtp.fromName}" <${smtp.fromAddress}>` : smtp.fromAddress;
    await transport.sendMail({ from, to: recipients.join(", "), subject, text, html });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { smtpConfigured, sendMail };
