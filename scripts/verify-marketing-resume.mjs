// Marketing batched-send verification (Jeff fix, 2026-11-07):
// a Marketing campaign send is capped per invocation, saves its
// progress in the durable mkrecipient rows, and can be safely
// resumed — by an admin pressing Resume, or by the campaign
// sweep once the interrupted run goes stale — without ever
// emailing a recipient twice. Proves:
//   1. a 30-recipient send stops at the 25 batch cap, still
//      "sending", with exactly 25 "sent" recipient rows;
//   2. a fresh "sending" campaign is NOT advanced by the sweep
//      (the staleness guard protects a live send);
//   3. Resume completes it: results count all 30 (25 skipped
//      already-sent + 5 new), one row per recipient, exactly
//      one completion event;
//   4. the production stall: a second campaign capped at 25,
//      its record aged past the stale threshold, the server
//      restarted, and ONE sweep call (the exact production
//      trigger) completes it — possible in a single run only
//      because the 25 already-sent are skipped, not re-sent.
// Run: node scripts/verify-marketing-resume.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9019;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@mkresume.dev";
const ADMIN_PW = "verify-mkresume-pass";
const uq = String(Date.now()).slice(-6);

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; failures.push(name); console.error(`FAIL ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-mkresume-"));
const dbPath = path.join(tmp, "db.json");
const seed = {};
function seedCreator(city, i) {
  const id = `${city.toLowerCase()}${i}_${uq}`;
  const email = `${id}@fixtures.dev`;
  seed[`user:${id}`] = { id, role: "creator", status: "approved", name: `${city} Creator ${i}`, email, market: "Not listed yet", city, state: "OK", country: "United States", tester: false, createdAt: new Date().toISOString(), creator: { handle: id, followerCount: 3000, localAudiencePct: 70, categories: ["Food & Drink"], tierBand: "Locals" } };
  seed[`email:${email}`] = { userId: id };
}
for (let i = 0; i < 30; i++) seedCreator("Resumeton", i);
for (let i = 0; i < 30; i++) seedCreator("Sweepville", i);
fs.writeFileSync(dbPath, JSON.stringify(seed));

const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbPath, SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD: ADMIN_PW, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_VERIFY_TOKEN: "verify-mkresume-token" };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES", "GA4_PROPERTY_ID", "GA_SERVICE_ACCOUNT_JSON", "SIGNL_SWEEP_TOKEN"]) delete env[k];

function client() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let d = null;
    try { d = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data: d, text };
  };
}
const readDb = () => JSON.parse(fs.readFileSync(dbPath, "utf8"));
const sentRows = (campId) => Object.values(readDb()).filter((v) => v && v.campaignId === campId && v.status === "sent" && v.sentAt).length;
const rowCount = (campId) => Object.keys(readDb()).filter((k) => k.startsWith(`mkrecipient:${campId}:`)).length;
const campRec = (campId) => readDb()[`mkcampaign:${campId}`];
const sentEvents = (campId) => Object.values(readDb()).filter((v) => v && v.type === "marketing_campaign_sent" && v.subjectId === campId).length;

let server = null;
async function boot() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { const r = await fetch(BASE + "/api/bootstrap"); up = r.status > 0; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  return up;
}
async function stop() {
  if (!server) return;
  const s = server; server = null;
  await new Promise((res) => { s.once("exit", res); s.kill(); setTimeout(res, 3000); });
}

try {
  check("dev server boots", await boot());

  const admin = client();
  const login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin logs in", login.status === 200, String(login.status));

  const board = await admin("GET", "/api/admin/marketing");
  const specFor = (city) => {
    const def = (board.data.segments || []).find((s) => s.spec && s.spec.demandCity && (s.label || "").includes(city));
    return def && def.spec;
  };
  const specR = specFor("Resumeton");
  const specS = specFor("Sweepville");
  check("both demand-city segments resolve with 30 people", !!specR && !!specS, JSON.stringify((board.data.segments || []).map((s) => s.label)));

  async function makeCampaign(spec, subject) {
    const draft = await admin("POST", "/api/admin/marketing/campaigns", { segment: spec, channel: "email", subject, text: "Hi {firstName},\n\nA short proof note." });
    const id = draft.data && draft.data.campaign && draft.data.campaign.id;
    await admin("POST", `/api/admin/marketing/campaigns/${id}/submit`, {});
    const ap = await admin("POST", `/api/admin/marketing/campaigns/${id}/approve`, {});
    check(`campaign "${subject}" approved with 30 frozen recipients`, ap.status === 200 && ap.data.campaign.recipientIds.length === 30, `${ap.status} ${ap.data && ap.data.campaign && ap.data.campaign.recipientIds.length}`);
    return id;
  }

  // ---- Campaign 1: cap, staleness guard, resume ----
  const c1 = await makeCampaign(specR, "Resume proof one");
  const send1 = await admin("POST", `/api/admin/marketing/campaigns/${c1}/send`, {});
  check("capped send returns the campaign still 'sending'", send1.status === 200 && send1.data.campaign.status === "sending", `${send1.status} ${send1.data && send1.data.campaign && send1.data.campaign.status}`);
  check("sendProgress reports the 25 sent so far", !!send1.data.campaign.sendProgress && send1.data.campaign.sendProgress.sent === 25, JSON.stringify(send1.data.campaign.sendProgress || null));
  check("exactly 25 'sent' recipient rows after the capped send", sentRows(c1) === 25, String(sentRows(c1)));
  check("no completion event written for a partial send", sentEvents(c1) === 0, String(sentEvents(c1)));

  const sendAgain = await admin("POST", `/api/admin/marketing/campaigns/${c1}/send`, {});
  check("pressing Send on a sending campaign is refused", sendAgain.status === 400, String(sendAgain.status));

  const sweep1 = await admin("POST", "/api/admin/campaign/sweep", {});
  check("sweep endpoint answers", sweep1.status === 200, String(sweep1.status));
  check("fresh 'sending' campaign is NOT advanced by the sweep (staleness guard)", sentRows(c1) === 25 && campRec(c1).status === "sending", `${sentRows(c1)} ${campRec(c1).status}`);

  const res1 = await admin("POST", `/api/admin/marketing/campaigns/${c1}/resume`, {});
  check("resume completes the campaign", res1.status === 200 && res1.data.campaign.status === "sent", `${res1.status} ${res1.data && res1.data.campaign && res1.data.campaign.status}`);
  check("final results count all 30 (25 skipped + 5 new)", !!res1.data.campaign.results && res1.data.campaign.results.sent === 30 && res1.data.campaign.results.failed === 0, JSON.stringify(res1.data.campaign.results || null));
  check("30 recipient rows — one per person, none duplicated", rowCount(c1) === 30 && sentRows(c1) === 30, `${rowCount(c1)} ${sentRows(c1)}`);
  check("exactly one completion event after resume", sentEvents(c1) === 1, String(sentEvents(c1)));

  const resBad = await admin("POST", `/api/admin/marketing/campaigns/${c1}/resume`, {});
  check("resume of a completed campaign is refused", resBad.status === 400, String(resBad.status));

  // ---- Campaign 2: the production stall, healed by one sweep ----
  const c2 = await makeCampaign(specS, "Resume proof two");
  const send2 = await admin("POST", `/api/admin/marketing/campaigns/${c2}/send`, {});
  check("campaign 2 also caps at 25 and stays 'sending'", send2.status === 200 && send2.data.campaign.status === "sending" && sentRows(c2) === 25, `${send2.status} ${sentRows(c2)}`);

  await stop();
  const db = readDb();
  db[`mkcampaign:${c2}`].updatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  fs.writeFileSync(dbPath, JSON.stringify(db));
  check("server restarts on the aged record", await boot());
  const admin2 = client();
  const login2 = await admin2("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin logs in after restart", login2.status === 200, String(login2.status));

  const sweep2 = await admin2("POST", "/api/admin/campaign/sweep", {});
  check("one production sweep call completes the stale campaign", sweep2.status === 200 && campRec(c2).status === "sent", `${sweep2.status} ${campRec(c2).status}`);
  check("campaign 2: 30 'sent' rows, one per person", rowCount(c2) === 30 && sentRows(c2) === 30, `${rowCount(c2)} ${sentRows(c2)}`);
  check("campaign 2: results count all 30 in a single run (skip-counted, not re-sent)", !!campRec(c2).results && campRec(c2).results.sent === 30, JSON.stringify(campRec(c2).results || null));
  check("campaign 2: exactly one completion event", sentEvents(c2) === 1, String(sentEvents(c2)));
} finally {
  await stop();
}

console.log(`\nverify-marketing-resume: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("FAILURES: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
