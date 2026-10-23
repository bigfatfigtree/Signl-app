#!/usr/bin/env node
// Founding business wave verification (Jeff, 2026-10-23).
//
// Proves, against a throwaway local DB and the mail stub:
//   - the business wave template renders Jeff's exact copy per
//     recipient: subject with the full business name, greeting,
//     prose category + neighborhood, the prebuilt signup link
//     (biz/market/category/src=business-wave, %20-encoded), the
//     no-commitment framing, first-name-only sign-off, no em
//     dashes; campaignEmailFor dispatches it ONLY for the
//     business campaign id;
//   - the staged import file (signl-campaign-run/
//     business-wave-import.json, the exact 10) imports through
//     the admin endpoint into a DISARMED campaign with 10
//     queued; re-import dedupes; business-field validation
//     rejects a recipient missing its greeting; creator imports
//     are unaffected by the branch;
//   - business recipients store NO handle, so claim evidence
//     (which only indexes handled recipients) can never read
//     them as creator evidence;
//   - armed in the TEST harness only, the sweep sends the wave
//     through the same machinery and the records flip to sent;
//     an emptied queue auto-disarms. (Production stays disarmed
//     until Jeff's go; this suite never touches production.)
//   - the client ships the prefill: parseBizParams, the
//     join-business landing, applyBizPrefill with the pre-built
//     notice, and registerBusiness sending signupSource; a
//     business registered with signupSource "business-wave" is
//     stored with that source and stays founding-gated.
//
// Run: node scripts/verify-businesswave.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8977;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "test-admin-password-123";
const CAMPAIGN_ID = "founding-businesses-2026-10";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const require = createRequire(import.meta.url);
const router = require("../netlify/functions/lib/router.js");
const importFile = JSON.parse(fs.readFileSync(path.join(root, "..", "signl-campaign-run", "business-wave-import.json"), "utf8"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-bizwave-"));
const dbFile = path.join(tmp, "db.json");
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", SIGNL_CAMPAIGN_PACE_MS: "0", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  server = null;
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up");
}
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const piece of setCookie.split(/,(?=[^;]+=)/)) {
      const m = piece.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, data, text };
  };
}

try {
  part("unit: template + links for all 10");
  check("import file carries exactly the 10 recipients", Array.isArray(importFile.recipients) && importFile.recipients.length === 10);
  check("import file targets the business campaign", importFile.campaignId === CAMPAIGN_ID && router.BUSINESS_CAMPAIGN_ID === CAMPAIGN_ID);
  for (const r of importFile.recipients) {
    const mail = router.campaignEmailFor(CAMPAIGN_ID, r);
    const expectedLink = `https://app.joinsignl.com/?biz=${encodeURIComponent(r.businessName)}&market=Virginia%20Beach&category=${encodeURIComponent(r.appCategory)}&src=business-wave`;
    check(`${r.businessName}: subject carries the full name`, mail.subject === `Your SIGNL founding spot is pre-built, ${r.businessName}`, mail.subject);
    check(`${r.businessName}: greeting + spot sentence + link`, mail.text.startsWith(`Hi ${r.greeting},\n`) && mail.text.includes(`my pick for the ${r.category} spot in ${r.neighborhood}`) && mail.text.includes(expectedLink));
    check(`${r.businessName}: framing + sign-off + no em dash`, mail.text.includes("Claiming it costs nothing and commits you to nothing.") && mail.text.endsWith("Jeff\nFounder, SIGNL") && !mail.text.includes("—") && !mail.subject.includes("—"));
  }
  const terrapin = router.businessWaveEmail(importFile.recipients[0]);
  check("Terrapin link is exact", router.businessSignupLink(importFile.recipients[0]) === "https://app.joinsignl.com/?biz=Terrapin%20Restaurant&market=Virginia%20Beach&category=Restaurant&src=business-wave", router.businessSignupLink(importFile.recipients[0]));
  const creatorMail = router.campaignEmailFor(router.DEFAULT_CAMPAIGN_ID, { name: "Test Person", handle: "testperson", market: "Raleigh", opener: "your Raleigh food posts" });
  check("default campaign still renders the creator template", creatorMail.subject === "A founding creator spot in Raleigh", creatorMail.subject);

  part("http: import lands disarmed with 10 queued");
  startServer();
  await waitUp();
  const anonImport = await makeClient()("POST", "/api/admin/campaign/import", importFile);
  check("non-admin import is refused", anonImport.status === 401 || anonImport.status === 403, String(anonImport.status));
  const admin = makeClient();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const imp = await admin("POST", "/api/admin/campaign/import", importFile);
  check("import accepts all 10", imp.status === 200 && imp.data.imported === 10 && (imp.data.invalid || []).length === 0, JSON.stringify(imp.data).slice(0, 300));
  const status1 = await admin("GET", `/api/admin/campaign?campaignId=${CAMPAIGN_ID}`);
  check("campaign sits DISARMED with 10 queued", status1.data.campaign.armed === false && status1.data.counts.queued === 10 && status1.data.counts.sent === 0, JSON.stringify(status1.data).slice(0, 300));
  const imp2 = await admin("POST", "/api/admin/campaign/import", importFile);
  check("re-import dedupes (10 duplicates, 0 new)", imp2.data.imported === 0 && imp2.data.duplicates === 10, JSON.stringify(imp2.data).slice(0, 200));
  const badImp = await admin("POST", "/api/admin/campaign/import", { campaignId: CAMPAIGN_ID, recipients: [{ email: "nogreeting@fixtures.dev", businessName: "No Greeting Co", category: "cafe", appCategory: "Coffee & Bakery", neighborhood: "Downtown" }] });
  check("missing greeting is invalid, not queued", badImp.data.imported === 0 && badImp.data.invalid.length === 1 && /greeting/.test(badImp.data.invalid[0].reason), JSON.stringify(badImp.data).slice(0, 250));
  const creatorImp = await admin("POST", "/api/admin/campaign/import", { recipients: [{ email: "wavecreator@fixtures.dev", name: "Wave Creator", handle: "wavecreator", market: "Raleigh", opener: "your Raleigh posts" }] });
  check("creator import path is unaffected", creatorImp.status === 200 && creatorImp.data.imported === 1, JSON.stringify(creatorImp.data).slice(0, 200));

  part("http: sweep sends the wave in the test harness");
  await admin("POST", "/api/admin/campaign/arm", { campaignId: CAMPAIGN_ID });
  const sweep = await admin("POST", "/api/admin/campaign/sweep", { now: "2026-10-24T15:00:00Z" });
  check("sweep runs", sweep.status === 200 && sweep.data.ok === true, JSON.stringify(sweep.data).slice(0, 200));
  const sweep2 = await admin("POST", "/api/admin/campaign/sweep", { now: "2026-10-24T15:05:00Z" });
  const status2 = await admin("GET", `/api/admin/campaign?campaignId=${CAMPAIGN_ID}`);
  check("all 10 sent across batches", status2.data.counts.sent === 10 && status2.data.counts.queued === 0, JSON.stringify(status2.data.counts));
  check("emptied queue auto-disarmed the campaign", status2.data.campaign.armed === false && status2.data.campaign.disarmReason === "queue_empty", JSON.stringify(status2.data.campaign));
  const recent = status2.data.recentSends || [];
  check("sent records carry business name and NO handle", recent.length > 0 && recent.every((r) => (r.handle || "") === "") && recent.some((r) => r.name === "Terrapin Restaurant"), JSON.stringify(recent).slice(0, 250));

  part("http: prefill client + signupSource storage");
  const appJs = await (await fetch(`${BASE}/app.js`)).text();
  check("app.js ships parseBizParams + bizPrefill landing", appJs.includes("function parseBizParams") && appJs.includes("state.bizPrefill = bizParams") && appJs.includes('state.view = "join-business"'));
  check("app.js ships applyBizPrefill with the pre-built notice", appJs.includes("function applyBizPrefill") && appJs.includes("We pre-built this founding registration for"));
  check("registerBusiness sends signupSource", appJs.includes("signupSource: storedSrc() || undefined"));
  const bizClient = makeClient();
  const reg = await bizClient("POST", "/api/auth/register", {
    role: "business", name: "Wave Owner", businessName: "Wave Test Cafe", email: "wavebiz@fixtures.dev",
    password: "<MASKED_SECRET_002>", market: "Virginia Beach", city: "Virginia Beach", category: "Coffee & Bakery",
    planId: "self-service", agreedTerms: true, signupSource: "business-wave",
  });
  check("business-wave registration stores the source", (reg.status === 200 || reg.status === 201) && reg.data.user.signupSource === "business-wave", JSON.stringify(reg.data).slice(0, 250));
  check("business-wave registration stays founding-gated", reg.data.user.business.accessState === "founding", JSON.stringify(reg.data.user.business));
} finally {
  await stopServer();
}

console.log(`\nverify-businesswave: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
