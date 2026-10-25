#!/usr/bin/env node
// Admin Campaign tab: business campaign parity (Jeff, 2026-10-23).
//
// The founding business wave shipped its engine (campaign id
// founding-businesses-2026-10, import endpoint, sweep) before
// the Admin tab rendered it. This suite proves, against a
// throwaway local DB:
//   - the admin campaign payload serves all FOUR registry
//     campaigns, and the business campaign is present at zero
//     state (defined, disarmed, all counts zero, no sends)
//     before anything is imported into it;
//   - the hello@ founding lane (founding-creators-hello-2026-10,
//     added 2026-10-25) is present at the same zero state, on
//     the default sender profile, as a creator campaign in the
//     registry next to the founding campaign it mirrors;
//   - the payload shape the business card's Import button posts
//     ({ campaignId: "founding-businesses-2026-10", recipients })
//     lands in the business queue and nowhere else;
//   - the arm / disarm endpoints the card's button calls accept
//     the business campaignId;
//   - the served client carries the generalized registry (all
//     three campaigns with kinds), the "Business outreach
//     campaigns" section, the business card's own import box
//     (suffix -business) and business-field import copy, the
//     generic campaignId import wiring, and the unchanged
//     creator cards (titles, ids, creator import copy).
//
// Run: node scripts/verify-campaignadmin.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8983;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";
const BUSINESS_ID = "founding-businesses-2026-10";
const CREATOR_IDS = ["founding-creators-2026-10", "founding-creators-hello-2026-10", "founding-crossover-2026-10"];
const HELLO_ID = "founding-creators-hello-2026-10";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-campaignadmin-"));
const dbFile = path.join(tmp, "db.json");
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", SIGNL_CAMPAIGN_PACE_MS: "0", CAMPAIGN_DAILY_CAP: "", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
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
  startServer();
  await waitUp();
  const anon = makeClient();
  const admin = makeClient();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  part("payload: all four campaigns, business at zero state");
  const anonStatus = await anon("GET", `/api/admin/campaign?campaignId=${BUSINESS_ID}`);
  check("anonymous campaign read is refused", anonStatus.status === 401 || anonStatus.status === 403, String(anonStatus.status));
  for (const id of [...CREATOR_IDS, BUSINESS_ID]) {
    const s = await admin("GET", `/api/admin/campaign?campaignId=${id}`);
    check(`${id}: payload present at zero state`, s.status === 200 && s.data.campaign.id === id && s.data.campaign.armed === false, JSON.stringify(s.data).slice(0, 200));
    check(`${id}: zero counts, no sends`, s.data.counts.queued === 0 && s.data.counts.sent === 0 && s.data.counts.bounced === 0 && s.data.counts.skipped === 0 && s.data.counts.total === 0 && (s.data.recentSends || []).length === 0, JSON.stringify(s.data.counts));
    check(`${id}: shared daily ceiling reported (shipped default 150)`, s.data.campaign.dailyCeiling === 150 && typeof s.data.campaign.sentToday === "number", JSON.stringify(s.data.campaign).slice(0, 200));
    check(`${id}: fresh campaign sits on the default sender profile`, s.data.campaign.fromMailbox === "default", JSON.stringify(s.data.campaign).slice(0, 200));
  }
  const helloStatus = await admin("GET", `/api/admin/campaign?campaignId=${HELLO_ID}`);
  check("hello@ lane: defined on the default sender profile (hello@joinsignl.com)", helloStatus.data.campaign.id === HELLO_ID && helloStatus.data.campaign.fromMailbox === "default", JSON.stringify(helloStatus.data.campaign).slice(0, 250));

  part("business card import posts the business campaignId");
  const boxPayload = {
    campaignId: BUSINESS_ID,
    recipients: [
      { email: "cardcafe@fixtures.dev", businessName: "Card Cafe", greeting: "Card team", category: "cafe", appCategory: "Coffee & Bakery", neighborhood: "Downtown", market: "Virginia Beach" },
      { email: "cardcuts@fixtures.dev", businessName: "Card Cuts", greeting: "Alisa", category: "barber shop", appCategory: "Salon & Barbershop", neighborhood: "Uptown", market: "Virginia Beach" },
    ],
  };
  const imp = await admin("POST", "/api/admin/campaign/import", boxPayload);
  check("business box payload imports both recipients", imp.status === 200 && imp.data.campaignId === BUSINESS_ID && imp.data.imported === 2, JSON.stringify(imp.data).slice(0, 250));
  const bizAfter = await admin("GET", `/api/admin/campaign?campaignId=${BUSINESS_ID}`);
  check("business queue holds the pair, still disarmed", bizAfter.data.counts.queued === 2 && bizAfter.data.counts.total === 2 && bizAfter.data.campaign.armed === false, JSON.stringify(bizAfter.data.counts));
  for (const id of CREATOR_IDS) {
    const s = await admin("GET", `/api/admin/campaign?campaignId=${id}`);
    check(`${id}: untouched by the business import`, s.data.counts.total === 0, JSON.stringify(s.data.counts));
  }

  part("arm / disarm accept the business campaignId");
  const arm = await admin("POST", "/api/admin/campaign/arm", { campaignId: BUSINESS_ID });
  check("arm flips the business campaign", arm.status === 200 && arm.data.campaign.id === BUSINESS_ID && arm.data.campaign.armed === true, JSON.stringify(arm.data).slice(0, 200));
  const disarm = await admin("POST", "/api/admin/campaign/disarm", { campaignId: BUSINESS_ID });
  check("disarm flips it back as a manual pause", disarm.status === 200 && disarm.data.campaign.armed === false && disarm.data.campaign.disarmReason === "manual", JSON.stringify(disarm.data).slice(0, 200));
  const bizFinal = await admin("GET", `/api/admin/campaign?campaignId=${BUSINESS_ID}`);
  check("queue survives the arm/disarm round trip", bizFinal.data.counts.queued === 2, JSON.stringify(bizFinal.data.counts));

  part("client: registry + business section + creator cards unchanged");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("registry covers all four campaigns with kinds", appJs.includes('campaignId: "founding-creators-2026-10"') && appJs.includes('campaignId: "founding-creators-hello-2026-10"') && appJs.includes('campaignId: "founding-crossover-2026-10"') && appJs.includes('campaignId: "founding-businesses-2026-10"') && appJs.includes('kind: "creator"') && appJs.includes('kind: "business"'));
  check("hello@ lane card renders from the registry", appJs.includes('"Founding creators (hello@ lane)"') && appJs.includes('suffix: "-hello"'));
  check("business card renders from the registry", appJs.includes('"Founding businesses"') && appJs.includes('suffix: "-business"'));
  check("Business outreach campaigns section is rendered", appJs.includes("Business outreach campaigns") && appJs.includes("businessSections"));
  check("business card has its own import box suffix", appJs.includes('id="campaign-import-text${meta.suffix}"') && appJs.includes("campaign-import-note${meta.suffix}"));
  check("import handler posts the section's own campaignId", appJs.includes("importCampaignRecipients") && appJs.includes('api("POST", "/admin/campaign/import"') && appJs.includes("campaignId: meta.campaignId"));
  check("business import copy names the business fields", appJs.includes("email, businessName, greeting, category, appCategory, neighborhood and market are required"));
  check("creator cards unchanged: titles", appJs.includes('"Founding creators"') && appJs.includes('"Platform crossover creators"'));
  check("creator cards unchanged: import copy + placeholder", appJs.includes("email, handle, market and opener are required; name is optional") && appJs.includes('"handle":"casey","market":"Richmond","opener":"your Carytown posts"'));
  check("creator section heading unchanged", appJs.includes("Creator outreach campaigns"));
  const served = await anon("GET", "/app.js");
  check("served app.js carries the business section", served.status === 200 && served.text.includes("Business outreach campaigns") && served.text.includes('campaignId: "founding-businesses-2026-10"') && served.text.includes('"Founding businesses"'), String(served.status));
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nverify-campaignadmin: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
