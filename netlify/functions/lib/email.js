// Transactional email for SIGNL (sign-up confirmations, approval
// notices). Zero-dependency SMTP client (implicit TLS, AUTH LOGIN)
// so the function bundle needs no extra packages.
//
// Transport activates only when these env vars are set in Netlify:
//   SIGNL_SMTP_USER  e.g. hello@joinsignl.com
//   SIGNL_SMTP_PASS  a Gmail App Password for that mailbox
// Optional: SIGNL_SMTP_HOST (default smtp.gmail.com),
//           SIGNL_SMTP_PORT (default 465),
//           SIGNL_MAIL_FROM (default "SIGNL <hello@joinsignl.com>")
//
// When the transport is not configured, sendEmail reports
// { sent: false, queued: true } and the caller logs a *_queued event:
// the email is recorded in the dataset, never faked as sent.
const tls = require("tls");

function emailEnabled() {
  return !!(process.env.SIGNL_SMTP_USER && process.env.SIGNL_SMTP_PASS);
}

function smtpSend({ to, subject, text }) {
  return new Promise((resolve, reject) => {
    const host = process.env.SIGNL_SMTP_HOST || "smtp.gmail.com";
    const port = parseInt(process.env.SIGNL_SMTP_PORT || "465", 10);
    const user = process.env.SIGNL_SMTP_USER;
    const pass = process.env.SIGNL_SMTP_PASS;
    const from = process.env.SIGNL_MAIL_FROM || "SIGNL <hello@joinsignl.com>";
    const fromAddr = (from.match(/<([^>]+)>/) || [null, from])[1];

    const socket = tls.connect(port, host, { servername: host });
    socket.setEncoding("utf8");
    socket.setTimeout(15000);

    let buffer = "";
    const waiters = [];
    function onData(chunk) {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf("\n")) > -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        // SMTP multiline replies end with "250 " (space, not dash).
        if (/^\d{3} /.test(line) && waiters.length) {
          const w = waiters.shift();
          w(line);
        }
      }
    }
    socket.on("data", onData);
    socket.on("timeout", () => { socket.destroy(); reject(new Error("SMTP timeout")); });
    socket.on("error", reject);

    function reply() {
      return new Promise((res) => waiters.push(res));
    }
    function expect(code, line) {
      if (!line.startsWith(String(code))) throw new Error(`SMTP expected ${code}, got: ${line}`);
    }
    async function cmd(line, code) {
      const p = reply();
      socket.write(line + "\r\n");
      expect(code, await p);
    }

    (async () => {
      try {
        expect(220, await reply());
        await cmd(`EHLO app.joinsignl.com`, 250);
        await cmd("AUTH LOGIN", 334);
        await cmd(Buffer.from(user).toString("base64"), 334);
        await cmd(Buffer.from(pass).toString("base64"), 235);
        await cmd(`MAIL FROM:<${fromAddr}>`, 250);
        await cmd(`RCPT TO:<${to}>`, 250);
        await cmd("DATA", 354);
        const msg = [
          `From: ${from}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=utf-8",
          "",
          text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, ".."),
          ".",
        ].join("\r\n");
        const p = reply();
        socket.write(msg + "\r\n");
        expect(250, await p);
        socket.write("QUIT\r\n");
        socket.end();
        resolve(true);
      } catch (e) {
        socket.destroy();
        reject(e);
      }
    })();
  });
}

// Test-only mailer stub (the verify suites set SIGNL_MAIL_STUB=1):
// sendEmail never touches the network. Addresses containing
// "stubfail" report a failure; everything else reports sent, so the
// suites can drive success and failure paths deterministically.
// Production never sets this flag; with it unset, behavior below is
// exactly the real SMTP transport.
const MAIL_STUB = process.env.SIGNL_MAIL_STUB === "1";

async function sendEmail({ to, subject, text }) {
  if (MAIL_STUB) {
    if (/stubfail/i.test(String(to))) return { sent: false, queued: false, reason: "stub_failure" };
    return { sent: true, stub: true };
  }
  if (!emailEnabled()) return { sent: false, queued: true, reason: "transport_not_configured" };
  try {
    await smtpSend({ to, subject, text });
    return { sent: true };
  } catch (e) {
    return { sent: false, queued: false, reason: String(e && e.message || e).slice(0, 200) };
  }
}

module.exports = { emailEnabled, sendEmail };
