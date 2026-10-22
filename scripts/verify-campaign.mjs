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
//     run stop the run and set lastError;
//   - a GLOBAL daily ceiling of 40 sends per America/New_York
//     calendar day, counted across all campaigns (it protects the
//     sending domain): sends stop at 40 within one ET day, hitting
//     the ceiling is not an error (campaigns stay armed, no
//     lastError), sends resume the next ET day, and a campaign's
//     lifetime total may pass the old 80 cap across days;
//   - every send logs a campaign_email_sent event;
//   - the Campaign tab's paste-import box is served in app.js and
//     the exact payload shape it posts imports cleanly over a full
//     admin session, without arming anything;
//   - tester accounts (user.tester, set via POST /api/admin/tester,
//     admin only) never receive campaign sends: their email is
//     skipped at import, and an address flagged tester after it was
//     queued is pruned by the sweep before any send;
//   - the second campaign (founding-crossover-2026-10) for creators
//     already on national platforms: its template renders the
//     additive, non-exclusive pitch with the approved subject, the
//     template dispatch never sends crossover recipients the
//     founding email, imports dedupe within the campaign AND
//     against the founding campaign (skip reason cross_campaign),
//     and the global 40/day ceiling binds across both real
//     campaigns combined.
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
  check("founding email carries the approval status sentence", hr.text.includes("If you apply, you will get a decision or a clear status within 2 business days."));
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
    role: "creator", name: "Case Creator", email: "case-creator@fixtures.dev", password: "password123",
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
    good.push({ email: `good${String(i).padStart(2, "0")}@fixtures.dev`, name: `Good Creator ${i}`, handle: `good${i}`, market: "Hampton Roads", opener: "your Virginia Beach posts" });
  }
  const imp1 = await admin("POST", "/api/admin/campaign/import", {
    recipients: [
      ...good,
      { email: "skipme@fixtures.dev", name: "Skip Me", handle: "skipme", market: "Richmond", opener: "your posts" },
      { email: "not-an-email", handle: "x", market: "Richmond", opener: "your posts" },
      { email: "noopener@fixtures.dev", handle: "noopener", market: "Richmond" },
    ],
    skipEmails: ["skipme@fixtures.dev"],
  });
  check("import accepted", imp1.status === 200, JSON.stringify(imp1.data));
  check("10 good recipients imported", imp1.data.imported === 10, JSON.stringify(imp1.data));
  check("blocklist address recorded as skipped, not queued", imp1.data.skipped === 1, JSON.stringify(imp1.data));
  check("invalid email + missing opener refused as invalid", imp1.data.invalid.length === 2, JSON.stringify(imp1.data.invalid));
  const imp2 = await admin("POST", "/api/admin/campaign/import", { recipients: [...good, { email: "skipme@fixtures.dev", name: "Skip Me", handle: "skipme", market: "Richmond", opener: "your posts" }] });
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
      { email: "stubfail1@fixtures.dev", name: "Fail One", handle: "fail1", market: "Hampton Roads", opener: "your posts" },
      { email: "stubfail2@fixtures.dev", name: "Fail Two", handle: "fail2", market: "Hampton Roads", opener: "your posts" },
      { email: "stubfail3@fixtures.dev", name: "Fail Three", handle: "fail3", market: "Hampton Roads", opener: "your posts" },
      { email: "zgood1@fixtures.dev", name: "Zed One", handle: "zgood1", market: "Hampton Roads", opener: "your posts" },
      { email: "zgood2@fixtures.dev", name: "Zed Two", handle: "zgood2", market: "Hampton Roads", opener: "your posts" },
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

  // ---------- Part F: the global daily ceiling (40/day, ET) ----------
  part("F: daily ceiling");
  const DAY2 = "2026-10-20T15:00:00.000Z"; // 11:00 EDT, the next ET day
  const DAY3 = "2026-10-21T15:00:00.000Z"; // 11:00 EDT, the day after
  const capRecipients = [];
  for (let i = 1; i <= 85; i++) {
    capRecipients.push({ email: `cap${String(i).padStart(3, "0")}@fixtures.dev`, name: `Cap Creator ${i}`, handle: `cap${i}`, market: "Richmond", opener: "your Richmond posts" });
  }
  const capImp = await admin("POST", "/api/admin/campaign/import", { campaignId: "daily-test", recipients: capRecipients });
  check("daily-test import queued 85", capImp.status === 200 && capImp.data.imported === 85, JSON.stringify(capImp.data));
  await admin("POST", "/api/admin/campaign/arm", { campaignId: "daily-test" });
  // Part D already sent 10 today (ET 2026-10-19) on the default
  // campaign, and the ceiling is global, so only 30 of today's 40
  // remain for this campaign.
  let day1Sent = 0;
  let lastSweep = null;
  for (let i = 0; i < 10; i++) {
    lastSweep = await admin("POST", "/api/admin/campaign/sweep", { now: IN_WINDOW });
    day1Sent += lastSweep.data.sweep.sent;
    if (lastSweep.data.sweep.sent === 0) break;
  }
  check("same-day sweeps stop when the global day total hits 40 (10 earlier + 30 here)", day1Sent === 30, `day1=${day1Sent}`);
  check("the zero-send sweep reports the ceiling honestly (sentToday 40 of 40, ceiling hit, not an error)", lastSweep.data.sweep.sent === 0 && lastSweep.data.sweep.sentToday === 40 && lastSweep.data.sweep.dailyCeiling === 40 && lastSweep.data.sweep.dailyCeilingHit >= 1, JSON.stringify(lastSweep.data.sweep));
  const day1Status = await admin("GET", "/api/admin/campaign?campaignId=daily-test");
  check("queue waits at 30 sent / 55 queued", day1Status.data.counts.sent === 30 && day1Status.data.counts.queued === 55, JSON.stringify(day1Status.data.counts));
  check("hitting the ceiling is not an error: still armed, no lastError, no disarm reason", day1Status.data.campaign.armed === true && !day1Status.data.campaign.lastError && !day1Status.data.campaign.disarmReason, JSON.stringify(day1Status.data.campaign));
  check("campaign view exposes the daily ceiling, today's count field, and the runaway backstop", day1Status.data.campaign.dailyCeiling === 40 && typeof day1Status.data.campaign.sentToday === "number" && day1Status.data.campaign.backstop === 1000, JSON.stringify(day1Status.data.campaign));
  check("no backstop event fired", (await countEvents(admin, "campaign_runaway_backstop_reached")) === 0);
  const day1Default = await admin("GET", "/api/admin/campaign");
  check("the ceiling is global: the default campaign's 10 earlier sends count toward the same 40", day1Default.data.counts.sent === 10 && day1Status.data.counts.sent + day1Default.data.counts.sent === 40, JSON.stringify({ daily: day1Status.data.counts, dflt: day1Default.data.counts }));
  // The next ET day the ceiling resets and sending resumes.
  let day2Sent = 0;
  for (let i = 0; i < 10; i++) {
    const s = await admin("POST", "/api/admin/campaign/sweep", { now: DAY2 });
    day2Sent += s.data.sweep.sent;
    if (s.data.sweep.sent === 0) break;
  }
  check("the next ET day sends resume and stop at that day's 40", day2Sent === 40, `day2=${day2Sent}`);
  const day2Status = await admin("GET", "/api/admin/campaign?campaignId=daily-test");
  check("after day 2: 70 sent / 15 queued, still armed", day2Status.data.counts.sent === 70 && day2Status.data.counts.queued === 15 && day2Status.data.campaign.armed === true, JSON.stringify({ counts: day2Status.data.counts, armed: day2Status.data.campaign.armed }));
  // A third day drains the queue: the lifetime total passes the
  // old 80 cap, which no longer exists as a limit.
  let day3Sent = 0;
  for (let i = 0; i < 10; i++) {
    const s = await admin("POST", "/api/admin/campaign/sweep", { now: DAY3 });
    day3Sent += s.data.sweep.sent;
    if (s.data.sweep.sent === 0) break;
  }
  check("day 3 sends the remaining 15", day3Sent === 15, `day3=${day3Sent}`);
  const day3Status = await admin("GET", "/api/admin/campaign?campaignId=daily-test");
  check("lifetime total passes the old 80 cap (85 sent) and the drained queue auto-disarms", day3Status.data.counts.sent === 85 && day3Status.data.counts.queued === 0 && day3Status.data.campaign.armed === false && day3Status.data.campaign.disarmReason === "queue_empty", JSON.stringify({ counts: day3Status.data.counts, campaign: day3Status.data.campaign }));

  // ---------- Part G: client copy guards ----------
  part("G: client copy");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("campaign tab wired in the client", appJs.includes("loadCampaign") && appJs.includes("/admin/campaign"));
  check("arm/pause control wired in the client", appJs.includes("toggleCampaignArm") && appJs.includes("/admin/campaign/arm") && appJs.includes("/admin/campaign/disarm"));
  check("paste-import box rendered in the campaign tab", appJs.includes('id="campaign-import-text${meta.suffix}"') && appJs.includes("Paste recipients (JSON array)") && appJs.includes(">Import recipients</button>"));
  check("import handler posts the box payload to the endpoint", appJs.includes("importCampaignRecipients") && appJs.includes('api("POST", "/admin/campaign/import"') && appJs.includes('campaignId: "founding-creators-2026-10"'));
  const servedJs = await anon("GET", "/app.js");
  check("served app.js carries the import box + handler", servedJs.status === 200 && servedJs.text.includes('id="campaign-import-text${meta.suffix}"') && servedJs.text.includes("importCampaignRecipients") && servedJs.text.includes("/admin/campaign/import"), String(servedJs.status));

  // ---------- Part H: the paste-box payload shape, end to end ----------
  part("H: paste-box import");
  const queuedBefore = (await admin("GET", "/api/admin/campaign")).data.counts.queued;
  const boxImp = await admin("POST", "/api/admin/campaign/import", {
    campaignId: "founding-creators-2026-10",
    recipients: [
      { email: "pasteone@fixtures.dev", name: "Paste One", handle: "paste1", market: "Hampton Roads", opener: "your Granby Street posts" },
      { email: "pastetwo@fixtures.dev", handle: "paste2", market: "Hampton Roads", opener: "your Ocean View posts" },
    ],
  });
  check("box-shaped payload imports (explicit campaignId, name optional)", boxImp.status === 200 && boxImp.data.imported === 2, JSON.stringify(boxImp.data));
  const afterBox = await admin("GET", "/api/admin/campaign");
  check("imported pair queued on the default campaign", afterBox.data.counts.queued === queuedBefore + 2, JSON.stringify(afterBox.data.counts));
  check("campaign stays disarmed after a box import (import never arms)", afterBox.data.campaign.armed === false, JSON.stringify(afterBox.data.campaign));

  // ---------- Part I: tester accounts never receive campaign sends ----------
  part("I: tester exclusion");
  const tony = makeClient();
  const tonyReg = await tony("POST", "/api/auth/register", {
    role: "creator", name: "Tony Tester", email: "tony-tester@fixtures.dev", password: "password123",
    market: "Hampton Roads", city: "Norfolk", handle: "tonytester", categories: ["Food & Drink"],
    compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 2500, avgViews: 700,
    localAudiencePct: 55, bio: "", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("tester candidate registered", tonyReg.status === 201, JSON.stringify(tonyReg.data));
  const tonyId = tonyReg.data.user.id;
  check("registration stores tester: false by default", tonyReg.data.user.tester === false, JSON.stringify(tonyReg.data.user.tester));
  const tonyApprove = await admin("POST", "/api/admin/review", { userId: tonyId, decision: "approve" });
  check("tester candidate approved", tonyApprove.status === 200 && tonyApprove.data.user.status === "approved", JSON.stringify(tonyApprove.data));
  check("toggle refuses anonymous callers (401)", (await anon("POST", "/api/admin/tester", { userId: tonyId, tester: true })).status === 401);
  check("toggle refuses non-admin creators (403)", (await creator("POST", "/api/admin/tester", { userId: tonyId, tester: true })).status === 403);
  check("toggle refuses an unknown user (404)", (await admin("POST", "/api/admin/tester", { userId: "nobody", tester: true })).status === 404);
  check("toggle refuses a non-boolean flag (400)", (await admin("POST", "/api/admin/tester", { userId: tonyId, tester: "yes" })).status === 400);
  const flip = await admin("POST", "/api/admin/tester", { userId: tonyId, tester: true });
  check("admin flags the creator as tester", flip.status === 200 && flip.data.user.tester === true, JSON.stringify(flip.data));
  check("creator_marked_tester event logged", (await countEvents(admin, "creator_marked_tester")) === 1);
  const impT = await admin("POST", "/api/admin/campaign/import", {
    campaignId: "tester-test",
    recipients: [
      { email: "tony-tester@fixtures.dev", name: "Tony Tester", handle: "tonytester", market: "Hampton Roads", opener: "your posts" },
      { email: "lateflag@fixtures.dev", name: "Late Flag", handle: "lateflag", market: "Hampton Roads", opener: "your posts" },
      { email: "realprospect@fixtures.dev", name: "Real Prospect", handle: "realprospect", market: "Hampton Roads", opener: "your posts" },
    ],
  });
  check("import skips the tester account address, queues the other two", impT.status === 200 && impT.data.imported === 2 && impT.data.skipped === 1, JSON.stringify(impT.data));
  const tStatus = await admin("GET", "/api/admin/campaign?campaignId=tester-test");
  check("tester-test queue: 2 queued, 1 skipped, 0 sent", tStatus.data.counts.queued === 2 && tStatus.data.counts.skipped === 1 && tStatus.data.counts.sent === 0, JSON.stringify(tStatus.data.counts));
  // Flag the second address AFTER it was already queued: the sweep
  // must prune it from the queue rather than send to it.
  const late = makeClient();
  const lateReg = await late("POST", "/api/auth/register", {
    role: "creator", name: "Late Flag", email: "lateflag@fixtures.dev", password: "password123",
    market: "Hampton Roads", city: "Norfolk", handle: "lateflag", categories: ["Food & Drink"],
    compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 1800, avgViews: 500,
    localAudiencePct: 48, bio: "", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("late-flag creator registered", lateReg.status === 201, JSON.stringify(lateReg.data));
  await admin("POST", "/api/admin/review", { userId: lateReg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/tester", { userId: lateReg.data.user.id, tester: true });
  await admin("POST", "/api/admin/campaign/arm", { campaignId: "tester-test" });
  const sentEventsBefore = await countEvents(admin, "campaign_email_sent");
  // Part F exhausted the daily ceiling for ET 2026-10-19 (IN_WINDOW's
  // day), so this sweep time-travels to a fresh ET day; the tester
  // behavior under test does not depend on the date.
  const sweepT = await admin("POST", "/api/admin/campaign/sweep", { now: "2026-10-22T15:00:00.000Z" });
  check("sweep sends only to the real prospect and prunes the newly flagged tester", sweepT.data.sweep.sent === 1 && sweepT.data.sweep.skippedTesters === 1, JSON.stringify(sweepT.data.sweep));
  check("exactly one campaign_email_sent event from the tester-test sweep", (await countEvents(admin, "campaign_email_sent")) === sentEventsBefore + 1);
  check("the pruned recipient is logged (campaign_recipient_skipped)", (await countEvents(admin, "campaign_recipient_skipped")) >= 1);
  const tAfter = await admin("GET", "/api/admin/campaign?campaignId=tester-test");
  check("after the sweep: 1 sent, 2 skipped, queue empty, auto-disarmed", tAfter.data.counts.sent === 1 && tAfter.data.counts.skipped === 2 && tAfter.data.counts.queued === 0 && tAfter.data.campaign.armed === false, JSON.stringify({ counts: tAfter.data.counts, armed: tAfter.data.campaign.armed }));
  const unflip = await admin("POST", "/api/admin/tester", { userId: tonyId, tester: false });
  check("admin can move a tester back to the roster", unflip.status === 200 && unflip.data.user.tester === false, JSON.stringify(unflip.data));
  check("creator_unmarked_tester event logged", (await countEvents(admin, "creator_unmarked_tester")) === 1);

  // ---------- Part J: the crossover campaign (founding-crossover-2026-10) ----------
  part("J: crossover campaign");
  const { crossoverEmail, campaignEmailFor, CROSSOVER_CAMPAIGN_ID } = require("../netlify/functions/lib/router.js");
  check("crossover campaign id is the shipped one", CROSSOVER_CAMPAIGN_ID === "founding-crossover-2026-10", CROSSOVER_CAMPAIGN_ID);
  const xo = crossoverEmail({ name: "Jordan Lee", handle: "jordancreates", market: "Richmond", opener: "your GRIN campaign posts and your Shockoe Bottom food reviews" });
  check("crossover subject: national platforms plus a local layer in the market", xo.subject === "Your national platforms, plus a local layer in Richmond", xo.subject);
  check("crossover greeting uses the first name only", xo.text.startsWith("Hi Jordan,"), xo.text.slice(0, 40));
  check("crossover opener slot is filled", xo.text.includes("I found you through your GRIN campaign posts and your Shockoe Bottom food reviews."));
  check("platforms named the approved generic way", xo.text.includes("platforms like Grin, Cohley, or Momfluence"));
  check("additive and non-exclusive: keep every national deal", xo.text.includes("not asking you to leave any of them") && xo.text.includes("nothing about SIGNL is exclusive") && xo.text.includes("Keep every national deal you have."));
  check("local perks: comps, honest post within 48 hours, tracked public track record", xo.text.includes("Local businesses comp you a meal, a service, or an experience") && xo.text.includes("post honestly about it within 48 hours") && xo.text.includes("Every visit is tracked") && xo.text.includes("public track record"));
  check("local money route 1: own paid rate, keep 97 percent, business covers 3 percent, escrow released when the post is live", xo.text.includes("set a paid rate on your SIGNL profile") && xo.text.includes("you keep 97 percent of your rate") && xo.text.includes("the business covers another 3 percent") && xo.text.includes("SIGNL holds the payment and releases it when your post is live"));
  check("local money route 2: 15k+ followers first in line for paid cash campaigns", xo.text.includes("15k+ followers are first in line for paid cash campaigns"));
  check("why local pays: the audience share in the market is the number SIGNL leads with", xo.text.includes("cannot tell a business what share of a creator's audience lives in its market") && xo.text.includes("SIGNL leads with exactly that number"));
  check("founding mechanics: free profile, spot held in sign-up order, founding-market paragraph", xo.text.includes("Your founding profile is free") && xo.text.includes("your spot is held in sign-up order") && xo.text.includes("Richmond is a founding market: sign-ups are open now and offers open city by city as the roster fills, in the next 30 to 90 days."));
  check("crossover claim link is the full prefilled URL", xo.text.includes("https://app.joinsignl.com/?handle=jordancreates&market=Richmond"));
  check("crossover email carries the approval status sentence", xo.text.includes("If you apply, you will get a decision or a clear status within 2 business days."));
  check("crossover sign-off is Jeff, Founder, SIGNL, with the tagline", xo.text.includes("\nJeff\nFounder, SIGNL\nhello@joinsignl.com | joinsignl.com\nNational platforms sell reach. We sell regulars."));
  check("no last name anywhere in the crossover email", !xo.text.includes("Rimmer") && !xo.subject.includes("Rimmer"));
  check("no em dashes anywhere in the crossover email", !xo.text.includes("—") && !xo.subject.includes("—"));
  const xoHr = crossoverEmail({ name: "", handle: "hrfoodie", market: "Hampton Roads", opener: "your Momfluence posts" });
  check("crossover missing name falls back to Hi there,", xoHr.text.startsWith("Hi there,"), xoHr.text.slice(0, 40));
  check("crossover Hampton Roads paragraph carries the November launch", xoHr.text.includes("Hampton Roads launches in November, and our opening push is Black Friday weekend."));
  check("template dispatch: the crossover id renders the crossover subject", campaignEmailFor(CROSSOVER_CAMPAIGN_ID, { name: "A B", handle: "ab", market: "Richmond", opener: "your posts" }).subject === "Your national platforms, plus a local layer in Richmond");
  check("template dispatch: the founding id renders the founding subject", campaignEmailFor("founding-creators-2026-10", { name: "A B", handle: "ab", market: "Richmond", opener: "your posts" }).subject === "A founding creator spot in Richmond");
  check("template dispatch: any other campaign keeps the founding template", campaignEmailFor("daily-test", { name: "A B", handle: "ab", market: "Richmond", opener: "your posts" }).subject === "A founding creator spot in Richmond");
  // Cross-campaign dedupe: pasteone@fixtures.dev already sits in
  // the founding campaign (Part H). Importing it into crossover
  // must record it skipped with reason cross_campaign, never queue
  // it, and the import response must report the cross count.
  const xoRecipients = [{ email: "pasteone@fixtures.dev", name: "Paste One", handle: "paste1", market: "Hampton Roads", opener: "your Granby Street posts" }];
  for (let i = 1; i <= 45; i++) {
    xoRecipients.push({ email: `xo${String(i).padStart(2, "0")}@fixtures.dev`, name: `Crossover Creator ${i}`, handle: `xo${i}`, market: "Richmond", opener: "your national campaign posts" });
  }
  const foundingBefore = await admin("GET", "/api/admin/campaign");
  const xoImp = await admin("POST", "/api/admin/campaign/import", { campaignId: "founding-crossover-2026-10", recipients: xoRecipients });
  check("crossover import queues the 45 fresh addresses", xoImp.status === 200 && xoImp.data.imported === 45, JSON.stringify(xoImp.data));
  check("the founding-campaign address is skipped and reported as cross_campaign", xoImp.data.skipped === 1 && xoImp.data.crossCampaign === 1, JSON.stringify(xoImp.data));
  const xoStatus = await admin("GET", "/api/admin/campaign?campaignId=founding-crossover-2026-10");
  check("crossover queue lives under its own campaign keys: 45 queued, 1 skipped, 0 sent", xoStatus.data.counts.queued === 45 && xoStatus.data.counts.skipped === 1 && xoStatus.data.counts.sent === 0 && xoStatus.data.campaign.id === "founding-crossover-2026-10", JSON.stringify(xoStatus.data.counts));
  check("crossover starts disarmed (import never arms)", xoStatus.data.campaign.armed === false, JSON.stringify(xoStatus.data.campaign));
  const foundingAfterImp = await admin("GET", "/api/admin/campaign");
  check("founding campaign counts untouched by the crossover import", JSON.stringify(foundingAfterImp.data.counts) === JSON.stringify(foundingBefore.data.counts), JSON.stringify({ before: foundingBefore.data.counts, after: foundingAfterImp.data.counts }));
  const xoDup = await admin("POST", "/api/admin/campaign/import", { campaignId: "founding-crossover-2026-10", recipients: xoRecipients });
  check("re-import into crossover dedupes within the campaign", xoDup.status === 200 && xoDup.data.imported === 0 && xoDup.data.duplicates === 46, JSON.stringify(xoDup.data));
  // The global ceiling binds across BOTH real campaigns combined:
  // on a fresh ET day, arm founding (2 queued from Part H) and
  // crossover (45 queued) and sweep until a run sends nothing.
  // The day's combined total must stop at exactly 40.
  await admin("POST", "/api/admin/campaign/arm", {});
  await admin("POST", "/api/admin/campaign/arm", { campaignId: "founding-crossover-2026-10" });
  const foundingSentBefore = (await admin("GET", "/api/admin/campaign")).data.counts.sent;
  const DAYJ = "2026-10-23T15:00:00.000Z"; // a fresh ET day, 11:00 EDT
  let lastJSweep = null;
  for (let i = 0; i < 12; i++) {
    lastJSweep = await admin("POST", "/api/admin/campaign/sweep", { now: DAYJ });
    if (lastJSweep.data.sweep.sent === 0) break;
  }
  const foundingAfterJ = await admin("GET", "/api/admin/campaign");
  const xoAfterJ = await admin("GET", "/api/admin/campaign?campaignId=founding-crossover-2026-10");
  const dayJTotal = (foundingAfterJ.data.counts.sent - foundingSentBefore) + xoAfterJ.data.counts.sent;
  check("both real campaigns together stop at the day's 40", dayJTotal === 40, `dayJ=${dayJTotal} foundingDay=${foundingAfterJ.data.counts.sent - foundingSentBefore} crossover=${xoAfterJ.data.counts.sent}`);
  check("crossover did the bulk of the day's sending from its own queue", xoAfterJ.data.counts.sent >= 38, JSON.stringify(xoAfterJ.data.counts));
  check("the ceiling sweep reports sentToday 40 with the ceiling hit, not an error", lastJSweep.data.sweep.sent === 0 && lastJSweep.data.sweep.sentToday === 40 && lastJSweep.data.sweep.dailyCeilingHit >= 1, JSON.stringify(lastJSweep.data.sweep));
  check("crossover stays armed with queue remaining and no lastError", xoAfterJ.data.campaign.armed === true && xoAfterJ.data.counts.queued === 45 - xoAfterJ.data.counts.sent && !xoAfterJ.data.campaign.lastError, JSON.stringify({ counts: xoAfterJ.data.counts, armed: xoAfterJ.data.campaign.armed }));
  // Client guards for the two-campaign tab.
  check("campaign tab renders both campaign sections", appJs.includes("CAMPAIGN_SECTIONS") && appJs.includes("campaignSectionHtml") && appJs.includes("Platform crossover creators") && appJs.includes("founding-crossover-2026-10"));
  check("crossover import posts the crossover campaign id", appJs.includes('campaignId: "founding-crossover-2026-10"'));
  const servedJs2 = await anon("GET", "/app.js");
  check("served app.js carries the crossover campaign", servedJs2.status === 200 && servedJs2.text.includes("founding-crossover-2026-10") && servedJs2.text.includes("campaignSectionHtml"), String(servedJs2.status));
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nCampaign verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
