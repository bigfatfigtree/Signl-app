#!/usr/bin/env node
// Creator outreach campaign verification (Jeff, 2026-10-19).
//
// Proves, against a throwaway local DB and the test mailer stub
// (SIGNL_MAIL_STUB=1: no network, ever; "stubfail" addresses fail,
// everything else reports sent):
//   - the approved template renders server side: Hampton Roads vs
//     other-market paragraphs, first-name greeting with the
//     "Hi there," fallback, the prefilled claim link, the first
//     name only sign-off, no em dashes;
//   - non-admins are refused on every campaign surface;
//   - import dedupes by email, validates shape, and records
//     blocklist addresses as skipped instead of queueing them;
//   - the sweep sends only when the campaign is armed AND the
//     clock is inside the 08:00-21:00 ET window (time-traveled via
//     the TEST_MODE-only `now` in the sweep call), in batches of 8;
//   - an emptied queue auto-disarms; more than 2 send failures in a
//     run stop the run and set lastError; total sends per campaign
//     are capped at 80 in code;
//   - every send logs a campaign_email_sent event.
//
// Run: node scripts/verify-campaign.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8927;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "test-admin-password-123";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-campaign-"));
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
    if (setCookie) for (const part of setCookie.split(/,(?=[^;]+=)/)) {
      const m = part.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html error page */ }
    return { status: res.status, data, text };
  };
}

async function adminClient() {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error("admin login failed: " + r.status);
  return c;
}
async function countEvents(admin, type) {
  const r = await admin("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=2000`);
  return (r.data.events || []).length;
}

const IN_WINDOW = "2026-10-19T15:00:00.000Z"; // 11:00 EDT
const OUTSIDE_WINDOW = "2026-10-20T03:30:00.000Z"; // 23:30 EDT the night before

try {
  // ---------- Part A: the approved template, rendered server side ----------
  part("A: template");
  process.env.SIGNL_LOCAL = "1";
  process.env.SIGNL_LOCAL_DB = path.join(tmp, "unit-db.json");
  const require = createRequire(import.meta.url);
  const { campaignEmail } = require("../netlify/functions/lib/router.js");
  const hr = campaignEmail({ name: "Maya Reed", handle: "maya757", market: "Hampton Roads", opener: "your Oceanfront food posts" });
  check("subject names the market", hr.subject === "A founding creator spot in Hampton Roads", hr.subject);
  check("greeting uses the first name only", hr.text.startsWith("Hi Maya,"), hr.text.slice(0, 40));
  check("opener slot is filled", hr.text.includes("I found you through your Oceanfront food posts."));
  check("Hampton Roads paragraph carries the Black Friday launch", hr.text.includes("Hampton Roads launches in November, and our opening push is Black Friday weekend."));
  check("claim link is prefilled with handle + market", hr.text.includes("app.joinsignl.com/?handle=maya757&market=Hampton%20Roads"));
  check("sign-off is Jeff, Founder, SIGNL, with the tagline", hr.text.includes("\nJeff\nFounder, SIGNL\nhello@joinsignl.com | joinsignl.com\nNational platforms sell reach. We sell regulars."));
  check("no last name anywhere in the email", !hr.text.includes("Rimmer") && !hr.subject.includes("Rimmer"));
  check("no em dashes anywhere in the email", !hr.text.includes("—") && !hr.subject.includes("—"));
  const rva = campaignEmail({ name: "", handle: "rvabites", market: "Richmond", opener: "your Carytown posts" });
  check("missing name falls back to Hi there,", rva.text.startsWith("Hi there,"), rva.text.slice(0, 40));
  check("other markets get the founding paragraph", rva.text.includes("Richmond is a founding market: sign-ups are open now and offers open city by city as the roster fills, in the next 30 to 90 days."));
  check("other markets never mention Black Friday", !rva.text.includes("Black Friday"));
  check("other-market claim link encodes its market", rva.text.includes("app.joinsignl.com/?handle=rvabites&market=Richmond"));

  startServer();
  await waitUp();
  const admin = await adminClient();

  // ---------- Part B: non-admins refused everywhere ----------
  part("B: auth");
  const anon = makeClient();
  check("unauthenticated campaign status refused", (await anon("GET", "/api/admin/campaign")).status === 401);
  check("unauthenticated sweep refused (no token configured)", (await anon("POST", "/api/admin/campaign/sweep", {})).status === 403);
  const creator = makeClient();
  const reg = await creator("POST", "/api/auth/register", {
    role: "creator", name: "Case Creator", email: "case-creator@example.com", password: "password123",
    market: "Hampton Roads", city: "Norfolk", handle: "casecreator", categories: ["Food & Drink"],
    compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 3000, avgViews: 900,
    localAudiencePct: 62, bio: "", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("creator registered for the refusal checks", reg.status === 201, JSON.stringify(reg.data));
  check("creator refused on campaign status", (await creator("GET", "/api/admin/campaign")).status === 403);
  check("creator refused on import", (await creator("POST", "/api/admin/campaign/import", { recipients: [] })).status === 403);
  check("creator refused on arm", (await creator("POST", "/api/admin/campaign/arm", {})).status === 403);
  check("creator refused on disarm", (await creator("POST", "/api/admin/campaign/disarm", {})).status === 403);
  check("creator refused on sweep", (await creator("POST", "/api/admin/campaign/sweep", {})).status === 403);

  // ---------- Part C: import validation, dedupe, blocklist ----------
  part("C: import");
  const good = [];
  for (let i = 1; i <= 10; i++) {
    good.push({ email: `good${String(i).padStart(2, "0")}@example.com`, name: `Good Creator ${i}`, handle: `good${i}`, market: "Hampton Roads", opener: "your Virginia Beach posts" });
  }
  const imp1 = await admin("POST", "/api/admin/campaign/import", {
    recipients: [
      ...good,
      { email: "skipme@example.com", name: "Skip Me", handle: "skipme", market: "Richmond", opener: "your posts" },
      { email: "not-an-email", handle: "x", market: "Richmond", opener: "your posts" },
      { email: "noopener@example.com", handle: "noopener", market: "Richmond" },
    ],
    skipEmails: ["skipme@example.com"],
  });
  check("import accepted", imp1.status === 200, JSON.stringify(imp1.data));
  check("10 good recipients imported", imp1.data.imported === 10, JSON.stringify(imp1.data));
  check("blocklist address recorded as skipped, not queued", imp1.data.skipped === 1, JSON.stringify(imp1.data));
  check("invalid email + missing opener refused as invalid", imp1.data.invalid.length === 2, JSON.stringify(imp1.data.invalid));
  const imp2 = await admin("POST", "/api/admin/campaign/import", { recipients: [...good, { email: "skipme@example.com", name: "Skip Me", handle: "skipme", market: "Richmond", opener: "your posts" }] });
  check("re-import dedupes every existing address", imp2.status === 200 && imp2.data.imported === 0 && imp2.data.duplicates === 11, JSON.stringify(imp2.data));
  const status1 = await admin("GET", "/api/admin/campaign");
  check("status shows the queue", status1.data.counts.queued === 10 && status1.data.counts.skipped === 1 && status1.data.counts.sent === 0 && status1.data.counts.total === 11, JSON.stringify(status1.data.counts));
  check("default campaign id + starts disarmed", status1.data.campaign.id === "founding-creators-2026-10" && status1.data.campaign.armed === false, JSON.stringify(status1.data.campaign));
  const unknown = await admin("GET", "/api/admin/campaign?campaignId=never-imported");
  check("unknown campaign reads as an empty disarmed queue", unknown.status === 200 && unknown.data.counts.total === 0 && unknown.data.campaign.armed === false, JSON.stringify(unknown.data));
  check("import events logged", (await countEvents(admin, "campaign_recipients_imported")) >= 2);

  // ---------- Part D: arm gating, window, batch, auto-disarm ----------
  part("D: sweep gating");
  const disarmedSweep = await admin("POST", "/api/admin/campaign/sweep", { now: IN_WINDOW });
  check("disarmed campaign sends nothing", disarmedSweep.status === 200 && disarmedSweep.data.sweep.sent === 0, JSON.stringify(disarmedSweep.data));
  const arm = await admin("POST", "/api/admin/campaign/arm", {});
  check("arm works", arm.status === 200 && arm.data.campaign.armed === true, JSON.stringify(arm.data));
  check("campaign_armed event logged", (await countEvents(admin, "campaign_armed")) >= 1);
  const outsideSweep = await admin("POST", "/api/admin/campaign/sweep", { now: OUTSIDE_WINDOW });
  check("outside the window the sweep sends nothing", outsideSweep.data.sweep.sent === 0 && outsideSweep.data.sweep.windowClosed >= 1, JSON.stringify(outsideSweep.data));
  const sentBefore = await countEvents(admin, "campaign_email_sent");
  const batch1 = await admin("POST", "/api/admin/campaign/sweep", { now: IN_WINDOW });
  check("first in-window sweep sends one batch of 8", batch1.data.sweep.sent === 8, JSON.stringify(batch1.data.sweep));
  check("one campaign_email_sent event per send", (await countEvents(admin, "campaign_email_sent")) === sentBefore + 8);
  const midStatus = await admin("GET", "/api/admin/campaign");
  check("queue drains 8 sent / 2 queued", midStatus.data.counts.sent === 8 && midStatus.data.counts.queued === 2, JSON.stringify(midStatus.data.counts));
  check("recent sends carry timestamps + message refs", (midStatus.data.recentSends || []).length === 8 && midStatus.data.recentSends.every((s) => s.sentAt && s.messageRef), JSON.stringify(midStatus.data.recentSends && midStatus.data.recentSends[0]));
  check("still armed with queue remaining", midStatus.data.campaign.armed === true);
  const batch2 = await admin("POST", "/api/admin/campaign/sweep", { now: IN_WINDOW });
  check("second sweep sends the remaining 2", batch2.data.sweep.sent === 2, JSON.stringify(batch2.data.sweep));
  const drained = await admin("GET", "/api/admin/campaign");
  check("emptied queue auto-disarms", drained.data.campaign.armed === false && drained.data.campaign.disarmReason === "queue_empty", JSON.stringify(drained.data.campaign));
  check("queue-empty event logged", (await countEvents(admin, "campaign_queue_empty")) >= 1);

  // ---------- Part E: failure stop ----------
  part("E: failure stop");
  const failImp = await admin("POST", "/api/admin/campaign/import", {
    campaignId: "failure-test",
    recipients: [
      { email: "stubfail1@example.com", name: "Fail One", handle: "fail1", market: "Hampton Roads", opener: "your posts" },
      { email: "stubfail2@example.com", name: "Fail Two", handle: "fail2", market: "Hampton Roads", opener: "your posts" },
      { email: "stubfail3@example.com", name: "Fail Three", handle: "fail3", market: "Hampton Roads", opener: "your posts" },
      { email: "zgood1@example.com", name: "Zed One", handle: "zgood1", market: "Hampton Roads", opener: "your posts" },
      { email: "zgood2@example.com", name: "Zed Two", handle: "zgood2", market: "Hampton Roads", opener: "your posts" },
    ],
  });
  check("failure-test import queued 5", failImp.status === 200 && failImp.data.imported === 5, JSON.stringify(failImp.data));
  await admin("POST", "/api/admin/campaign/arm", { campaignId: "failure-test" });
  const failSweep = await admin("POST", "/api/admin/campaign/sweep", { now: IN_WINDOW });
  check("run stops after the 3rd failure (more than 2)", failSweep.data.sweep.failed === 3 && failSweep.data.sweep.attempted === 3 && failSweep.data.sweep.sent === 0, JSON.stringify(failSweep.data.sweep));
  const failStatus = await admin("GET", "/api/admin/campaign?campaignId=failure-test");
  check("lastError is set on the campaign", typeof failStatus.data.campaign.lastError === "string" && failStatus.data.campaign.lastError.length > 0, JSON.stringify(failStatus.data.campaign));
  check("failed recipients stay queued for a later retry (nothing burned)", failStatus.data.counts.queued === 5 && failStatus.data.counts.sent === 0, JSON.stringify(failStatus.data.counts));
  check("one campaign_email_failed event per failure", (await countEvents(admin, "campaign_email_failed")) === 3);
  const disarm = await admin("POST", "/api/admin/campaign/disarm", { campaignId: "failure-test" });
  check("manual disarm works", disarm.status === 200 && disarm.data.campaign.armed === false, JSON.stringify(disarm.data));
  check("campaign_disarmed event logged", (await countEvents(admin, "campaign_disarmed")) >= 1);

  // ---------- Part F: the 80-send cap ----------
  part("F: send cap");
  const capRecipients = [];
  for (let i = 1; i <= 85; i++) {
    capRecipients.push({ email: `cap${String(i).padStart(3, "0")}@example.com`, name: `Cap Creator ${i}`, handle: `cap${i}`, market: "Richmond", opener: "your Richmond posts" });
  }
  const capImp = await admin("POST", "/api/admin/campaign/import", { campaignId: "cap-test", recipients: capRecipients });
  check("cap-test import queued 85", capImp.status === 200 && capImp.data.imported === 85, JSON.stringify(capImp.data));
  await admin("POST", "/api/admin/campaign/arm", { campaignId: "cap-test" });
  let totalSent = 0;
  for (let i = 0; i < 14; i++) {
    const s = await admin("POST", "/api/admin/campaign/sweep", { now: IN_WINDOW });
    totalSent += s.data.sweep.sent;
    if (s.data.sweep.sent === 0) break;
  }
  check("sweeps stop at exactly 80 sends", totalSent === 80, `total=${totalSent}`);
  const capStatus = await admin("GET", "/api/admin/campaign?campaignId=cap-test");
  check("cap leaves 5 queued and disarms by cap", capStatus.data.counts.sent === 80 && capStatus.data.counts.queued === 5 && capStatus.data.campaign.armed === false && capStatus.data.campaign.disarmReason === "send_cap_reached", JSON.stringify({ counts: capStatus.data.counts, campaign: capStatus.data.campaign }));
  check("cap event logged", (await countEvents(admin, "campaign_send_cap_reached")) >= 1);
  const afterCap = await admin("POST", "/api/admin/campaign/sweep", { now: IN_WINDOW });
  check("no sends after the cap", afterCap.data.sweep.sent === 0, JSON.stringify(afterCap.data.sweep));

  // ---------- Part G: client copy guards ----------
  part("G: client copy");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("campaign tab wired in the client", appJs.includes("loadCampaign") && appJs.includes("/admin/campaign"));
  check("arm/pause control wired in the client", appJs.includes("toggleCampaignArm") && appJs.includes("/admin/campaign/arm") && appJs.includes("/admin/campaign/disarm"));
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nCampaign verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
