// Behavioral test: password reset + change password (UX audit
// fix, 2026-10-22). Before this build a forgotten password was a
// permanent lockout: registration 409ed on the existing email and
// no recovery route existed.
//
// Pins: forgot never reveals whether an account exists (same 200
// either way, and no email is queued for an unknown address), the
// emailed token is single-use and expires (short TTL injected for
// the suite), a successful reset revokes every other session,
// businesses are covered by the same shared auth, and change
// password requires the current password and keeps the caller's
// session while revoking the rest. TEST_MODE (the documented
// dev-only SIGNL_TEST_ALLOW_BUSINESS flag) echoes the reset token
// in the forgot response so the flow is drivable without a mailbox.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { passwordResetEmail } from "../netlify/functions/lib/router.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok -", name); }
  else { failed++; console.log("  FAIL -", name, detail ? `| ${String(detail).slice(0, 300)}` : ""); }
}

function client() {
  let cookie = "";
  return async (method, p, body) => {
    const headers = { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, json, text, cookie };
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/bootstrap`);
      if (r.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Events are read through the admin API, the same way the other
// suites observe queued email (deliverEmail logs before the forgot
// response returns, so no polling is needed).
let adminClient = null;
async function eventsOf(type) {
  const r = await adminClient("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=500`);
  return (r.json && r.json.events) || [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- unit: the reset email itself ----------
{
  const mail = passwordResetEmail({ name: "Reset Tester", email: "r@fixtures.dev" }, "https://app.joinsignl.com/?reset=tok123");
  check("reset email subject names the reset", /reset/i.test(mail.subject), mail.subject);
  check("reset email carries the reset link", mail.text.includes("https://app.joinsignl.com/?reset=tok123"), mail.text);
  check("reset email says the link works once and expires in an hour", mail.text.includes("works once") && mail.text.includes("one hour"), mail.text);
  check("reset email signs as Jeff", mail.text.includes("\nJeff\nFounder, SIGNL\n"), mail.text);
  check("reset email has no em dashes", !mail.text.includes("—") && !mail.text.includes("–"));
  check("reset email has no lock language", !/\block(ed|s|ing)?\b/i.test(mail.text) && !/\block(ed|s|ing)?\b/i.test(mail.subject));
}

// ---------- client surface ----------
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("sign-in form carries a Forgot password link and the 30-day line", appJs.includes("Forgot password?") && appJs.includes("You will stay signed in on this device for 30 days."));
  check("client has the forgot + reset views wired to the API", appJs.includes("renderForgot") && appJs.includes("renderReset") && appJs.includes('"/auth/forgot"') && appJs.includes('"/auth/reset"') && appJs.includes('"/auth/change-password"'));
  check("client surfaces a friendly connection error, not a raw status", appJs.includes("We could not reach SIGNL. Check your connection and try again."));
  check("account surfaces show Signed in as and the change-password form", appJs.includes("Signed in as") && appJs.includes("accountHtml") && appJs.includes("doChangePassword"));
  check("client carries no lock language in the claim surfaces", !/Founding spots lock in sign-up order/.test(appJs) && appJs.includes("Founding spots are held in sign-up order"));
}

const DB = path.join(root, ".verify-passwordreset-db.json");
try { fs.unlinkSync(DB); } catch { /* fresh run */ }
const server = spawn("node", ["scripts/dev-server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_DEV_SEED: "1", SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", SIGNL_RESET_TTL_MS: "6000", ADMIN_EMAIL: "admin@fixtures.dev", ADMIN_PASSWORD: "<MASKED_SECRET_002>", APP_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => process.stdout.write("[server] " + d));
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  adminClient = client();
  const adminLogin = await adminClient("POST", "/api/auth/login", { email: "admin@fixtures.dev", password: "<MASKED_SECRET_002>" });
  check("admin session opens for event reads", adminLogin.status === 200, JSON.stringify(adminLogin.json));

  // robots.txt is a real file on the app domain now.
  const robots = await fetch(`${BASE}/robots.txt`);
  const robotsText = await robots.text();
  check("robots.txt serves the app policy (allow shell, disallow /api/)", robots.status === 200 && robotsText.includes("User-agent: *") && robotsText.includes("Disallow: /api/"), `${robots.status} ${robotsText.slice(0, 80)}`);

  // ---------- a creator to reset ----------
  const creator = client();
  const reg = await creator("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "pwreset@fixtures.dev", password: "originalpass1",
    market: "Hampton Roads", handle: "pwreset757", primaryPlatform: "instagram",
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("creator registers for the reset flow", reg.status === 200 || reg.status === 201, JSON.stringify(reg.json));

  // A live session that the reset must revoke.
  const sessionA = client();
  const loginA = await sessionA("POST", "/api/auth/login", { email: "pwreset@fixtures.dev", password: "originalpass1" });
  check("creator can sign in before the reset", loginA.status === 200, JSON.stringify(loginA.json));

  // ---------- no enumeration ----------
  const anon = client();
  const ghost = await anon("POST", "/api/auth/forgot", { email: "ghost@fixtures.dev" });
  check("forgot for an unknown email still answers 200 ok", ghost.status === 200 && ghost.json && ghost.json.ok === true, JSON.stringify(ghost));
  check("forgot for an unknown email returns no token, even in test mode", !ghost.json || !ghost.json.devResetToken, JSON.stringify(ghost.json));
  const ghostEvents = await eventsOf("password_reset_email_queued");
  check("no reset email is queued for an unknown email", !ghostEvents.some((e) => e.data && e.data.to === "ghost@fixtures.dev"), JSON.stringify(ghostEvents.map((e) => e.data && e.data.to)));

  // ---------- happy path ----------
  const forgot = await anon("POST", "/api/auth/forgot", { email: "pwreset@fixtures.dev" });
  check("forgot for a real account answers the same neutral 200", forgot.status === 200 && forgot.json && forgot.json.ok === true, JSON.stringify(forgot.json));
  check("test mode echoes the reset token for the suite", !!forgot.json.devResetToken);
  const token = forgot.json.devResetToken;
  const queuedEvents = await eventsOf("password_reset_email_queued");
  check("the reset email was queued for the real account", queuedEvents.some((e) => e.data && e.data.to === "pwreset@fixtures.dev"), JSON.stringify(queuedEvents.map((e) => e.data && e.data.to)));

  const wrong = await anon("POST", "/api/auth/reset", { token: "not-a-real-token", password: "brandnewpass1" });
  check("reset with a wrong token is a 400", wrong.status === 400, JSON.stringify(wrong.json));

  const short = await anon("POST", "/api/auth/reset", { token, password: "short" });
  check("reset with a short password is a 400 and does not burn the token", short.status === 400, JSON.stringify(short.json));

  const done = await anon("POST", "/api/auth/reset", { token, password: "brandnewpass1" });
  check("reset with the real token succeeds", done.status === 200 && done.json.ok === true, JSON.stringify(done.json));

  const reused = await anon("POST", "/api/auth/reset", { token, password: "anotherpass12" });
  check("the same token cannot be used twice", reused.status === 400, JSON.stringify(reused.json));

  const oldLogin = await client()("POST", "/api/auth/login", { email: "pwreset@fixtures.dev", password: "originalpass1" });
  check("the old password no longer signs in", oldLogin.status === 401, JSON.stringify(oldLogin.json));
  const newLogin = await client()("POST", "/api/auth/login", { email: "pwreset@fixtures.dev", password: "brandnewpass1" });
  check("the new password signs in", newLogin.status === 200, JSON.stringify(newLogin.json));

  const meA = await sessionA("GET", "/api/auth/me");
  check("a reset revokes sessions opened before it", meA.status === 401, JSON.stringify(meA.json));

  // ---------- expiry ----------
  const forgot2 = await anon("POST", "/api/auth/forgot", { email: "pwreset@fixtures.dev" });
  const token2 = forgot2.json.devResetToken;
  check("a second forgot issues a fresh token", !!token2 && token2 !== token);
  await sleep(6400);
  const expired = await anon("POST", "/api/auth/reset", { token: token2, password: "whateverpass1" });
  check("an expired token is refused with the expired message", expired.status === 400 && /expired/i.test(expired.json.error || ""), JSON.stringify(expired.json));

  // ---------- businesses share the same auth ----------
  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Reset Owner", businessName: "Reset Tacos", email: "pwreset-biz@fixtures.dev",
    password: "bizoriginal1", market: "Hampton Roads", city: "Norfolk", category: "Restaurants, Cafes & Food Trucks",
    planId: "launch", agreedTerms: true,
  });
  check("business registers for the reset flow", bizReg.status === 200 || bizReg.status === 201, JSON.stringify(bizReg.json));
  const bizForgot = await anon("POST", "/api/auth/forgot", { email: "pwreset-biz@fixtures.dev" });
  const bizReset = await anon("POST", "/api/auth/reset", { token: bizForgot.json.devResetToken, password: "bizbrandnew1" });
  check("business password reset succeeds through the same endpoints", bizReset.status === 200, JSON.stringify(bizReset.json));
  const bizLogin = await client()("POST", "/api/auth/login", { email: "pwreset-biz@fixtures.dev", password: "bizbrandnew1" });
  check("business signs in with the reset password", bizLogin.status === 200, JSON.stringify(bizLogin.json));

  // ---------- change password (authenticated) ----------
  const b1 = client();
  const b2 = client();
  await b1("POST", "/api/auth/login", { email: "pwreset-biz@fixtures.dev", password: "bizbrandnew1" });
  await b2("POST", "/api/auth/login", { email: "pwreset-biz@fixtures.dev", password: "bizbrandnew1" });
  const wrongCurrent = await b1("POST", "/api/auth/change-password", { currentPassword: "not-the-password", newPassword: "bizchanged12" });
  check("change password with a wrong current password is refused", wrongCurrent.status === 401, JSON.stringify(wrongCurrent.json));
  const shortNew = await b1("POST", "/api/auth/change-password", { currentPassword: "bizbrandnew1", newPassword: "short" });
  check("change password enforces the 10 character minimum", shortNew.status === 400, JSON.stringify(shortNew.json));
  const changed = await b1("POST", "/api/auth/change-password", { currentPassword: "bizbrandnew1", newPassword: "bizchanged12" });
  check("change password succeeds with the current password", changed.status === 200 && changed.json.ok === true, JSON.stringify(changed.json));
  const meB2 = await b2("GET", "/api/auth/me");
  check("change password revokes the account's other sessions", meB2.status === 401, JSON.stringify(meB2.json));
  const meB1 = await b1("GET", "/api/auth/me");
  check("the session that changed the password stays signed in", meB1.status === 200, JSON.stringify(meB1.json));
  const relogin = await client()("POST", "/api/auth/login", { email: "pwreset-biz@fixtures.dev", password: "bizchanged12" });
  check("sign-in works with the changed password", relogin.status === 200, JSON.stringify(relogin.json));

  // Registration now points an existing email at the recovery route.
  const dupe = await client()("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "pwreset@fixtures.dev", password: "whateverpass1",
    market: "Hampton Roads", handle: "another757", primaryPlatform: "instagram",
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("registering an existing email points at Forgot password", dupe.status === 409 && /Forgot password/.test(dupe.json.error || ""), JSON.stringify(dupe.json));
} finally {
  try { server.kill("SIGKILL"); } catch { /* already gone */ }
  try { fs.unlinkSync(DB); } catch { /* cleanup only */ }
}

console.log(`\nverify-passwordreset: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
