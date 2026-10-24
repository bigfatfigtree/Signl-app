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
//
// Named sender profiles (Jeff, 2026-10-24): the env pair above is
// the "default" profile and keeps its exact behavior. Three
// OPTIONAL profiles send from the signlteam.com mailboxes (the
// second sending domain, a Google Workspace secondary domain):
//   creators    SIGNL_SMTP_USER_CREATORS    + SIGNL_SMTP_PASS_CREATORS
//   team        SIGNL_SMTP_USER_TEAM        + SIGNL_SMTP_PASS_TEAM
//   hello_team  SIGNL_SMTP_USER_HELLO_TEAM  + SIGNL_SMTP_PASS_HELLO_TEAM
// A profile is usable only when BOTH of its vars are set; otherwise
// it resolves to unavailable, mirroring how the Stripe wiring
// no-ops without keys. Callers pick a profile with the optional
// `profile` / `fromMailbox` field on sendEmail. Asking for an
// unavailable NON-default profile never falls back to sending from
// the default identity: sendEmail refuses with reason
// "sender_profile_unavailable", and the campaign sweep checks
// availability up front so it can skip and log instead. Mail sent
// from a signlteam profile carries Reply-To: hello@joinsignl.com
// (the watched inbox) unless the caller passes its own replyTo.
// The display name stays "SIGNL"; the From address is the
// profile's own mailbox (its SMTP user).
const tls = require("tls");

function emailEnabled() {
  return !!(process.env.SIGNL_SMTP_USER && process.env.SIGNL_SMTP_PASS);
}

// The Reply-To every signlteam.com send defaults to: replies land
// in the hello@joinsignl.com inbox the reply watch already reads,
// never in a warm-up mailbox nobody monitors.
const TEAM_REPLY_TO = "hello@joinsignl.com";

const SENDER_PROFILES = {
  default: { userEnv: "SIGNL_SMTP_USER", passEnv: "SIGNL_SMTP_PASS", replyTo: null },
  creators: { userEnv: "SIGNL_SMTP_USER_CREATORS", passEnv: "SIGNL_SMTP_PASS_CREATORS", replyTo: TEAM_REPLY_TO },
  team: { userEnv: "SIGNL_SMTP_USER_TEAM", passEnv: "SIGNL_SMTP_PASS_TEAM", replyTo: TEAM_REPLY_TO },
  hello_team: { userEnv: "SIGNL_SMTP_USER_HELLO_TEAM", passEnv: "SIGNL_SMTP_PASS_HELLO_TEAM", replyTo: TEAM_REPLY_TO },
};
const SENDER_PROFILE_NAMES = Object.keys(SENDER_PROFILES);

// Resolve a sender profile by name. No name (or "default") is the
// shipped default profile. An unknown non-empty name resolves to
// null: a typo'd selector must fail loudly, never silently send
// from the default identity. Env is read at call time so the
// verify suites can pin profiles per server, and so adding the
// vars in Netlify activates a profile with no code change.
function senderProfile(name) {
  const key = name === undefined || name === null || name === "" ? "default" : String(name);
  if (!Object.prototype.hasOwnProperty.call(SENDER_PROFILES, key)) return null;
  const def = SENDER_PROFILES[key];
  const user = process.env[def.userEnv] || "";
  const pass = process.env[def.passEnv] || "";
  const available = !!(user && pass);
  let from = null;
  if (key === "default") {
    from = process.env.SIGNL_MAIL_FROM || "SIGNL <hello@joinsignl.com>";
  } else if (user) {
    from = `SIGNL <${user}>`;
  }
  return { name: key, user, pass, available, from, replyTo: def.replyTo, team: key !== "default" };
}

function senderProfileAvailable(name) {
  const p = senderProfile(name);
  return !!(p && p.available);
}

// Marketing-style sends (campaign outreach, and any transactional
// mail whose copy promises "unsubscribe at any time") carry a real
// List-Unsubscribe header, so the promise in the copy is one the
// reader can actually act on from their mail app.
const UNSUBSCRIBE_ADDR = "hello@joinsignl.com";
function listUnsubscribeHeader() {
  return `List-Unsubscribe: <mailto:${UNSUBSCRIBE_ADDR}?subject=unsubscribe>`;
}

function smtpSend({ to, subject, text, listUnsubscribe, profile, replyTo }) {
  return new Promise((resolve, reject) => {
    const host = process.env.SIGNL_SMTP_HOST || "smtp.gmail.com";
    const port = parseInt(process.env.SIGNL_SMTP_PORT || "465", 10);
    const prof = profile || senderProfile("default");
    const user = prof.user;
    const pass = prof.pass;
    const from = prof.from || "SIGNL <hello@joinsignl.com>";
    const fromAddr = (from.match(/<([^>]+)>/) || [null, from])[1];
    const replyToAddr = replyTo || prof.replyTo || null;

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
          ...(replyToAddr ? [`Reply-To: ${replyToAddr}`] : []),
          ...(listUnsubscribe ? [listUnsubscribeHeader()] : []),
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
// exactly the real SMTP transport. The one profile rule the stub
// still enforces: an explicitly requested NON-default profile
// that is not configured refuses (sender_profile_unavailable),
// exactly like production, so a suite can prove the campaign
// sweep's wrong-identity refusal under the stub. No existing
// caller passes a profile, so default-profile stub behavior is
// byte-identical to before.
const MAIL_STUB = process.env.SIGNL_MAIL_STUB === "1";

async function sendEmail({ to, subject, text, listUnsubscribe, profile, fromMailbox, replyTo }) {
  const selector = profile !== undefined && profile !== null && profile !== "" ? profile : fromMailbox;
  const prof = senderProfile(selector);
  if (selector !== undefined && selector !== null && selector !== "" && !prof) {
    return { sent: false, queued: false, reason: "sender_profile_unknown" };
  }
  if (prof.name !== "default" && !prof.available) {
    return { sent: false, queued: false, reason: "sender_profile_unavailable" };
  }
  if (MAIL_STUB) {
    if (/stubfail/i.test(String(to))) return { sent: false, queued: false, reason: "stub_failure" };
    return { sent: true, stub: true };
  }
  if (!prof.available) return { sent: false, queued: true, reason: "transport_not_configured" };
  try {
    await smtpSend({ to, subject, text, listUnsubscribe: !!listUnsubscribe, profile: prof, replyTo });
    return { sent: true };
  } catch (e) {
    return { sent: false, queued: false, reason: String(e && e.message || e).slice(0, 200) };
  }
}

module.exports = { emailEnabled, sendEmail, listUnsubscribeHeader, UNSUBSCRIBE_ADDR, senderProfile, senderProfileAvailable, SENDER_PROFILE_NAMES, TEAM_REPLY_TO };
