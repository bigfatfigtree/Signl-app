// End-to-end verification of signup source capture (Jeff,
// 2026-10-21). Segment and channel pages tag their claim links
// with ?src= (moms, students, dads, foodies, linkedin, learn);
// the app client persists it like the referral credit and sends
// it at registration; the server sanitizes it to a short slug
// and stores it on the user record as signupSource; admin sees
// it in the applicant payload. This suite walks quick claim +
// full signup + invalid/absent/overlong values + the admin
// payload + the application event, and statically asserts the
// client wiring.
// Run: node scripts/verify-src.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8941;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";
const DB = path.join(os.tmpdir(), `signl-verify-src-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`);
  }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (v) jar.set(k, v); else jar.delete(k);
      }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data };
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + "/api/bootstrap");
      if (res.ok) return true;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: {
    ...process.env,
    SIGNL_LOCAL: "1",
    SIGNL_LOCAL_DB: DB,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    APP_URL: BASE,
    SIGNL_TEST_ALLOW_BUSINESS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  check("dev server comes up", await waitForServer());

  // ---------- quick claim carries the source ----------
  const claimer = client();
  const claim = await claimer("POST", "/api/auth/register", {
    role: "creator", quickClaim: true,
    email: "srcmoms@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", handle: "srcmoms",
    signupSource: "moms",
    ...AGREE,
  });
  check("quick claim with src returns 201", claim.status === 201, JSON.stringify(claim.data));
  check("quick claim stores signupSource on the record", !!claim.data.user && claim.data.user.signupSource === "moms", JSON.stringify(claim.data.user && claim.data.user.signupSource));
  const claimerId = claim.data.user && claim.data.user.id;

  // ---------- full signup carries the source ----------
  const full = client();
  const fullReg = await full("POST", "/api/auth/register", {
    role: "creator", name: "Src Student", email: "srcstudents@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Richmond", city: "Richmond", handle: "srcstudents",
    followerCount: 3200, localAudiencePct: 55, categories: ["Food & Drink"],
    signupSource: "students",
    ...AGREE,
  });
  check("full signup with src returns 201", fullReg.status === 201, JSON.stringify(fullReg.data));
  check("full signup stores signupSource on the record", !!fullReg.data.user && fullReg.data.user.signupSource === "students", JSON.stringify(fullReg.data.user && fullReg.data.user.signupSource));

  // ---------- invalid values are sanitized ----------
  const dirty = client();
  const dirtyReg = await dirty("POST", "/api/auth/register", {
    role: "creator", quickClaim: true,
    email: "srcdirty@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Raleigh", handle: "srcdirty",
    signupSource: "Moms Page!! <x>",
    ...AGREE,
  });
  check("src with spaces/case/markup is sanitized to a slug", dirtyReg.status === 201 && !!dirtyReg.data.user && dirtyReg.data.user.signupSource === "momspagex", JSON.stringify(dirtyReg.data.user && dirtyReg.data.user.signupSource));

  const junk = client();
  const junkReg = await junk("POST", "/api/auth/register", {
    role: "creator", quickClaim: true,
    email: "srcjunk@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Raleigh", handle: "srcjunk",
    signupSource: "!! $$ %%",
    ...AGREE,
  });
  check("src of pure junk stores nothing", junkReg.status === 201 && !!junkReg.data.user && junkReg.data.user.signupSource === undefined, JSON.stringify(junkReg.data.user && junkReg.data.user.signupSource));

  const long = client();
  const longReg = await long("POST", "/api/auth/register", {
    role: "creator", quickClaim: true,
    email: "srclong@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Raleigh", handle: "srclong",
    signupSource: "a".repeat(60),
    ...AGREE,
  });
  check("overlong src is capped at 40 chars", longReg.status === 201 && !!longReg.data.user && longReg.data.user.signupSource === "a".repeat(40), JSON.stringify(longReg.data.user && longReg.data.user.signupSource));

  // ---------- absent src leaves the record unchanged ----------
  const plain = client();
  const plainReg = await plain("POST", "/api/auth/register", {
    role: "creator", quickClaim: true,
    email: "srcplain@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", handle: "srcplain",
    ...AGREE,
  });
  check("no src at all: record carries no signupSource", plainReg.status === 201 && !!plainReg.data.user && plainReg.data.user.signupSource === undefined, JSON.stringify(plainReg.data.user && Object.keys(plainReg.data.user)));

  // ---------- admin sees the source ----------
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login 200", adminLogin.status === 200, String(adminLogin.status));
  const apps = await admin("GET", "/api/admin/applications");
  const rows = [...((apps.data && apps.data.pending) || []), ...((apps.data && apps.data.decided) || [])];
  const momsUser = rows.find((r) => r.id === claimerId);
  check("admin applications payload includes signupSource", !!momsUser && momsUser.signupSource === "moms", JSON.stringify(momsUser && momsUser.signupSource));

  // ---------- the application event carries it too ----------
  const events = await admin("GET", "/api/admin/events?limit=500&type=application_submitted");
  const evs = (events.data && events.data.events) || [];
  check("application_submitted event records the signup source", evs.some((e) => e.data && e.data.signupSource === "moms"), JSON.stringify(evs.slice(0, 2)));

  // ---------- static client wiring ----------
  const appJs = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public", "app.js"), "utf8");
  check("client reads ?src= on landing", appJs.includes('params.get("src")'));
  check("client persists src alongside the referral credit", appJs.includes('localStorage.setItem("signl_src"') && appJs.includes('localStorage.getItem("signl_src")'));
  check("both signup payloads send signupSource", (appJs.match(/signupSource: storedSrc\(\) \|\| undefined/g) || []).length === 2);
  check("admin applicant detail shows the Source label", appJs.includes("Source: ${esc(u.signupSource)}"));
  check("client copy has no em dashes in the src block", !/storedSrc[\s\S]{0,400}—/.test(appJs));
} finally {
  server.kill("SIGKILL");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nverify-src: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
