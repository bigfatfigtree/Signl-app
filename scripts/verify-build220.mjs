// Build -220 verification: ADD-A-SIDE CREATOR FACTS.
// The in-app "Add a creator side" form (Build -180) never asked
// for a follower count or a local audience %, so a creator side
// added from inside an account was created at 0 before
// Build -215 (Chelsea Moubarak's creator side, 2026-11-19) and
// could only be refused by the -215 register gate after it.
// -220 adds the two fields to the form, in the claim form's
// wording, and sends them with the add-side submission; the
// -215 gate validates and the record builder writes them on
// first create.
//
// Layers:
//   1. Source pins (stamp, the two form fields, the submit
//      handler sending followerCount + localAudiencePct).
//   2. API end-to-end against the dev server: an approved
//      business adds a creator side — without the count (400),
//      without the local % (400), then with both (created
//      pending, facts stored on the record on first write,
//      link mutual, business side untouched).
// Run: node scripts/verify-build220.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const PORT = 8951;
const STUB_PORT = 8952;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-220-pass";
const DB = path.join(os.tmpdir(), `signl-verify-build220-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

// ---------------- source pins ----------------
console.log("== source pins ==");
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const idxHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
check("build stamp is 2026.11.20-220 (lib + shell)", buildJs.includes("2026.11.20-220") && idxHtml.includes("2026.11.20-220"));
check("client: add-side form asks the follower count", appJs.includes('id="as180-followers"'));
check("client: add-side form asks the local %", appJs.includes('id="as180-localpct"'));
check("client: add-side submit sends followerCount + localAudiencePct", appJs.includes("body.followerCount = fc") && appJs.includes("body.localAudiencePct = lp"));

// ---------------- AI stub (never expected to be called) ----------------
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "STUB AI ANSWER" } }] }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));

// ---------------- dev server harness ----------------
function client() {
  const jar = new Map();
  return async (method, p, body) => {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, data };
  };
}
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1", SIG_AI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`, SIG_AI_API_KEY: "stub-key", SIG_AI_MODEL: "stub-model" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
function readDb() { return JSON.parse(fs.readFileSync(DB, "utf8")); }
function usersWithEmail(db, email) {
  return Object.entries(db).filter(([k, v]) => k.startsWith("user:") && v && v.email === email).map(([, v]) => v);
}

const EMAIL = "chelsea220@fixtures.dev";
const PW = "chelsea-pass-220";
const BIZ_NAME = "Fixture Friday Furniture 220";

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200, JSON.stringify(adminLogin.data).slice(0, 120));

  console.log("== an approved business adds a creator side ==");
  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Chelsea Fixture", email: EMAIL, password: PW,
    businessName: BIZ_NAME, category: "Retail", market: "Nashville", city: "Nashville", agreedTerms: true,
  });
  check("business registers (pending)", bizReg.status === 201 && bizReg.data.user.role === "business", JSON.stringify(bizReg.data).slice(0, 200));
  const bizId = bizReg.data.user.id;
  const appr = await admin("POST", "/api/admin/review", { userId: bizId, decision: "approve" });
  check("business approved through the normal review", appr.status === 200 && appr.data.user.status === "approved", JSON.stringify(appr.data).slice(0, 160));

  const sideBase = { role: "creator", quickClaim: true, handle: "fixturefriday220", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true };

  const noFacts = await biz("POST", "/api/auth/add-side", { ...sideBase });
  check("add-side WITHOUT the count -> 400 follower count required", noFacts.status === 400 && /follower count is required/i.test(JSON.stringify(noFacts.data)), JSON.stringify(noFacts.data).slice(0, 200));
  check("the refusal created nothing", usersWithEmail(readDb(), EMAIL).length === 1);

  const noPct = await biz("POST", "/api/auth/add-side", { ...sideBase, followerCount: 12345 });
  check("add-side WITHOUT the local % -> 400 local % required", noPct.status === 400 && /local audience percentage is required/i.test(JSON.stringify(noPct.data)), JSON.stringify(noPct.data).slice(0, 200));
  check("the second refusal created nothing", usersWithEmail(readDb(), EMAIL).length === 1);

  const withFacts = await biz("POST", "/api/auth/add-side", { ...sideBase, followerCount: 12345, localAudiencePct: 65 });
  check("add-side WITH both facts -> creator side created", (withFacts.status === 200 || withFacts.status === 201) && withFacts.data.user.role === "creator", JSON.stringify(withFacts.data).slice(0, 200));
  check("creator side lands PENDING (normal review still applies)", withFacts.data.user.status === "pending", withFacts.data.user.status);
  const creatorId = withFacts.data.user.id;

  const db = readDb();
  const recs = usersWithEmail(db, EMAIL);
  check("exactly two records for the email (one per side)", recs.length === 2, String(recs.length));
  const creatorRec = recs.find((u) => u.role === "creator");
  const bizRec = recs.find((u) => u.role === "business");
  check("stored creator record carries the count on first write", !!creatorRec && creatorRec.creator.followerCount === 12345 && creatorRec.creator.totalAudience === 12345 && creatorRec.creator.audienceStack && creatorRec.creator.audienceStack.instagram === 12345, JSON.stringify(creatorRec && creatorRec.creator).slice(0, 240));
  check("stored creator record carries the local % on first write", !!creatorRec && creatorRec.creator.localAudiencePct === 65 && creatorRec.creator.localAudienceSource === "Self-reported", JSON.stringify(creatorRec && creatorRec.creator).slice(0, 240));
  check("link is mutual", !!creatorRec && creatorRec.linkedAccountId === bizId && !!bizRec && bizRec.linkedAccountId === creatorId);
  check("business side untouched (approved, name, no creator payload)", !!bizRec && bizRec.status === "approved" && bizRec.business.businessName === BIZ_NAME && !bizRec.creator);

  const me = await biz("GET", "/api/auth/me");
  check("session now sits on the creator side", me.status === 200 && me.data.user.role === "creator" && me.data.user.id === creatorId, JSON.stringify(me.data).slice(0, 160));
} finally {
  await stopServer();
  stub.close();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`\nverify-build220: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
