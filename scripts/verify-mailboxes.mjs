#!/usr/bin/env node
// Multi-mailbox sender verification (Jeff, 2026-10-24).
//
// Proves, against a throwaway local DB and the test mailer stub
// (SIGNL_MAIL_STUB=1 in the spawned server only):
//   - lib/email.js resolves named sender profiles from env: the
//     default profile keeps its byte-exact behavior (unconfigured
//     reports { queued: true, transport_not_configured }); a
//     signlteam profile is usable only when BOTH its vars are
//     set, its From is "SIGNL <its own mailbox>", its Reply-To
//     defaults to hello@joinsignl.com, and an unknown profile
//     name fails loudly instead of resolving to the default;
//   - sendEmail asked for an unavailable NON-default profile
//     refuses with sender_profile_unavailable and never falls
//     back to the default identity (checked in-process with the
//     stub OFF, plus an available-profile case that provably
//     attempts the profile's own transport);
//   - the campaign admin surface: GET reports fromMailbox
//     "default" for untouched campaigns and per-profile
//     availability; POST /admin/campaign/sender is admin-only,
//     validates the value, persists it, and logs an event;
//   - wrong-identity refusal in the sweep: a campaign set to the
//     "team" profile with NO team env vars sends nothing, stays
//     armed and queued, sets a plain lastError, and logs
//     campaign_sender_unavailable;
//   - the warm-up cap: with SIGNL_TEAMMAIL_DAILY_CAP pinned to 3
//     and the creators profile configured, a sweep sends exactly
//     3, a second same-day sweep sends 0 and reports teamCapHit,
//     sends are stamped fromMailbox "creators", and the next ET
//     day the cap resets;
//   - the default campaign still sends end to end under the stub
//     with recentSends stamped "default".
//
// Run: node scripts/verify-mailboxes.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8939;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-mailboxes-"));
const dbFile = path.join(tmp, "db.json");
let server = null;

const PROFILE_ENV_KEYS = [
  "SIGNL_SMTP_USER", "SIGNL_SMTP_PASS",
  "SIGNL_SMTP_USER_CREATORS", "SIGNL_SMTP_PASS_CREATORS",
  "SIGNL_SMTP_USER_TEAM", "SIGNL_SMTP_PASS_TEAM",
  "SIGNL_SMTP_USER_HELLO_TEAM", "SIGNL_SMTP_PASS_HELLO_TEAM",
  "SIGNL_SMTP_HOST", "SIGNL_SMTP_PORT", "SIGNL_TEAMMAIL_DAILY_CAP",
];

function startServer() {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", SIGNL_CAMPAIGN_PACE_MS: "0", CAMPAIGN_DAILY_CAP: "", SIGNL_TEAMMAIL_DAILY_CAP: "3", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD, SIGNL_SMTP_USER_CREATORS: "creators@signlteam.com", SIGNL_SMTP_PASS_CREATORS: "stub-app-password" };
  // The team / hello_team profiles must be ABSENT in the server
  // env (unavailable on purpose), and no default SMTP pair either:
  // the stub carries default sends exactly like the other suites.
  for (const k of ["SIGNL_SMTP_USER", "SIGNL_SMTP_PASS", "SIGNL_SMTP_USER_TEAM", "SIGNL_SMTP_PASS_TEAM", "SIGNL_SMTP_USER_HELLO_TEAM", "SIGNL_SMTP_PASS_HELLO_TEAM", "SIGNL_SMTP_HOST", "SIGNL_SMTP_PORT"]) delete env[k];
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
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
const DAY2 = "2026-10-20T15:00:00.000Z";
const DAY3 = "2026-10-21T15:00:00.000Z";

// The in-process unit parts run with the mail stub OFF (this
// suite process never sets SIGNL_MAIL_STUB; only the spawned
// server gets it). Save and clear every profile env var so the
// resolution checks are deterministic whatever the shell holds.
const savedEnv = {};
for (const k of PROFILE_ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
function restoreEnv() {
  for (const k of PROFILE_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

try {
  // ---------- Part U: profile resolution in lib/email.js ----------
  part("U: profile resolution");
  process.env.SIGNL_LOCAL = "1";
  process.env.SIGNL_LOCAL_DB = path.join(tmp, "unit-db.json");
  const require = createRequire(import.meta.url);
  const email = require("../netlify/functions/lib/email.js");
  const { senderProfile, sendEmail, SENDER_PROFILE_NAMES, TEAM_REPLY_TO } = email;
  check("profile registry names the four profiles", JSON.stringify(SENDER_PROFILE_NAMES) === JSON.stringify(["default", "creators", "team", "hello_team"]), JSON.stringify(SENDER_PROFILE_NAMES));
  check("no-arg resolution is the default profile", senderProfile().name === "default" && senderProfile("default").name === "default");
  check("default profile is unavailable with no env (byte-compat baseline)", senderProfile().available === false);
  const dflt = await sendEmail({ to: "someone@fixtures.dev", subject: "s", text: "t" });
  check("default send unconfigured still reports queued transport_not_configured", dflt.sent === false && dflt.queued === true && dflt.reason === "transport_not_configured", JSON.stringify(dflt));
  check("unknown profile name resolves to null, never to default", senderProfile("bogus") === null);
  const unknown = await sendEmail({ to: "someone@fixtures.dev", subject: "s", text: "t", profile: "bogus" });
  check("sendEmail with an unknown profile fails loudly", unknown.sent === false && unknown.queued === false && unknown.reason === "sender_profile_unknown", JSON.stringify(unknown));
  check("creators profile unavailable with neither var set", senderProfile("creators").available === false);
  const unavail = await sendEmail({ to: "someone@fixtures.dev", subject: "s", text: "t", profile: "creators" });
  check("unavailable creators profile refuses, never falls back to default", unavail.sent === false && unavail.queued === false && unavail.reason === "sender_profile_unavailable", JSON.stringify(unavail));
  const unavailAlias = await sendEmail({ to: "someone@fixtures.dev", subject: "s", text: "t", fromMailbox: "team" });
  check("the fromMailbox selector refuses the same way", unavailAlias.sent === false && unavailAlias.reason === "sender_profile_unavailable", JSON.stringify(unavailAlias));
  process.env.SIGNL_SMTP_USER_CREATORS = "creators@signlteam.com";
  check("one var alone does not make a profile usable", senderProfile("creators").available === false);
  process.env.SIGNL_SMTP_PASS_CREATORS = "app-password-fixture";
  const creatorsProf = senderProfile("creators");
  check("both vars set: creators profile available", creatorsProf.available === true);
  check("From stays SIGNL with the profile's own mailbox", creatorsProf.from === "SIGNL <creators@signlteam.com>", creatorsProf.from);
  check("signlteam Reply-To defaults to hello@joinsignl.com", creatorsProf.replyTo === "hello@joinsignl.com" && TEAM_REPLY_TO === "hello@joinsignl.com", String(creatorsProf.replyTo));
  check("team flag set on signlteam profiles only", creatorsProf.team === true && senderProfile("default").team === false);
  check("hello_team profile carries the same Reply-To default", senderProfile("hello_team").replyTo === "hello@joinsignl.com");
  // An available profile provably attempts its OWN transport:
  // point SMTP at a dead local port and the refusal reasons are
  // gone; what comes back is a raw connection error.
  process.env.SIGNL_SMTP_HOST = "127.0.0.1";
  process.env.SIGNL_SMTP_PORT = "9";
  const attempted = await sendEmail({ to: "someone@fixtures.dev", subject: "s", text: "t", profile: "creators" });
  check("available profile attempts transport (no availability/queued refusal)", attempted.sent === false && attempted.queued === false && attempted.reason !== "sender_profile_unavailable" && attempted.reason !== "transport_not_configured", JSON.stringify(attempted));
  delete process.env.SIGNL_SMTP_HOST;
  delete process.env.SIGNL_SMTP_PORT;

  // ---------- Part U2: router-side mailbox helpers ----------
  part("U2: router helpers");
  const router = require("../netlify/functions/lib/router.js");
  check("campaignFromMailbox defaults a bare config to default", router.campaignFromMailbox({}) === "default" && router.campaignFromMailbox(null) === "default");
  check("campaignFromMailbox keeps a valid stored value", router.campaignFromMailbox({ fromMailbox: "creators" }) === "creators" && router.campaignFromMailbox({ fromMailbox: "hello_team" }) === "hello_team");
  check("campaignFromMailbox normalizes junk to default", router.campaignFromMailbox({ fromMailbox: "gmail" }) === "default");
  check("teamMailDailyCap ships at 25 with no env", router.teamMailDailyCap() === 25, String(router.teamMailDailyCap()));
  process.env.SIGNL_TEAMMAIL_DAILY_CAP = "3";
  check("teamMailDailyCap honors the env override", router.teamMailDailyCap() === 3);
  process.env.SIGNL_TEAMMAIL_DAILY_CAP = "junk";
  check("teamMailDailyCap falls back on an invalid value", router.teamMailDailyCap() === 25);
  delete process.env.SIGNL_TEAMMAIL_DAILY_CAP;
  restoreEnv();

  startServer();
  await waitUp();
  const admin = await adminClient();
  const anon = makeClient();

  // ---------- Part A: payload defaults + availability ----------
  part("A: payload");
  const status0 = await admin("GET", "/api/admin/campaign");
  check("untouched campaign reports fromMailbox default", status0.data.campaign.fromMailbox === "default", JSON.stringify(status0.data.campaign).slice(0, 250));
  check("payload reports per-profile availability from env", status0.data.senderProfiles && status0.data.senderProfiles.creators === true && status0.data.senderProfiles.team === false && status0.data.senderProfiles.hello_team === false && status0.data.senderProfiles.default === false, JSON.stringify(status0.data.senderProfiles));
  check("payload reports the warm-up cap (pinned 3 for this suite)", status0.data.campaign.teamMailDailyCap === 3, JSON.stringify(status0.data.campaign).slice(0, 250));

  // ---------- Part B: the sender endpoint ----------
  part("B: sender endpoint");
  check("anonymous sender change refused", (await anon("POST", "/api/admin/campaign/sender", { fromMailbox: "creators" })).status === 401);
  const creator = makeClient();
  const reg = await creator("POST", "/api/auth/register", {
    role: "creator", name: "Case Creator", email: "case-creator@fixtures.dev", password: "password123",
    market: "Hampton Roads", city: "Norfolk", handle: "casecreator", categories: ["Food & Drink"],
    compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 3000, avgViews: 900,
    localAudiencePct: 62, bio: "", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("creator registered for the refusal check", reg.status === 201, JSON.stringify(reg.data));
  check("creator refused on sender change", (await creator("POST", "/api/admin/campaign/sender", { fromMailbox: "creators" })).status === 403);
  check("an unknown mailbox value is refused (400)", (await admin("POST", "/api/admin/campaign/sender", { fromMailbox: "gmail" })).status === 400);
  check("a junk campaign id is refused (400)", (await admin("POST", "/api/admin/campaign/sender", { campaignId: "Bad Id!", fromMailbox: "creators" })).status === 400);
  const setCreators = await admin("POST", "/api/admin/campaign/sender", { fromMailbox: "creators" });
  check("admin sets the default campaign's mailbox to creators", setCreators.status === 200 && setCreators.data.campaign.fromMailbox === "creators" && setCreators.data.campaign.senderAvailable === true, JSON.stringify(setCreators.data).slice(0, 250));
  check("sender change event logged", (await countEvents(admin, "campaign_sender_changed")) >= 1);
  const setBack = await admin("POST", "/api/admin/campaign/sender", { fromMailbox: "default" });
  check("mailbox can be set back to default", setBack.status === 200 && setBack.data.campaign.fromMailbox === "default", JSON.stringify(setBack.data).slice(0, 200));

  // ---------- Part C: wrong-identity refusal in the sweep ----------
  part("C: wrong-identity refusal");
  const impC = await admin("POST", "/api/admin/campaign/import", {
    campaignId: "team-unavailable",
    recipients: [1, 2, 3].map((i) => ({ email: `teamu${i}@fixtures.dev`, name: `Team U${i}`, handle: `teamu${i}`, market: "Richmond", opener: "your posts" })),
  });
  check("refusal fixture imports 3", impC.status === 200 && impC.data.imported === 3, JSON.stringify(impC.data));
  await admin("POST", "/api/admin/campaign/sender", { campaignId: "team-unavailable", fromMailbox: "team" });
  await admin("POST", "/api/admin/campaign/arm", { campaignId: "team-unavailable" });
  const sentEventsBefore = await countEvents(admin, "campaign_email_sent");
  const sweepC = await admin("POST", "/api/admin/campaign/sweep", { now: IN_WINDOW });
  check("sweep sends nothing for the unavailable-mailbox campaign", sweepC.data.sweep.sent === 0 && sweepC.data.sweep.attempted === 0, JSON.stringify(sweepC.data.sweep));
  check("sweep reports senderUnavailable", sweepC.data.sweep.senderUnavailable >= 1, JSON.stringify(sweepC.data.sweep));
  check("no campaign_email_sent events were logged (nothing left from the wrong identity)", (await countEvents(admin, "campaign_email_sent")) === sentEventsBefore);
  check("campaign_sender_unavailable event logged", (await countEvents(admin, "campaign_sender_unavailable")) >= 1);
  const statusC = await admin("GET", "/api/admin/campaign?campaignId=team-unavailable");
  check("queue untouched: 3 queued, 0 sent, still armed", statusC.data.counts.queued === 3 && statusC.data.counts.sent === 0 && statusC.data.campaign.armed === true, JSON.stringify(statusC.data.counts));
  check("lastError explains the skip in plain words", typeof statusC.data.campaign.lastError === "string" && statusC.data.campaign.lastError.includes("Sender mailbox") && statusC.data.campaign.lastError.includes("team"), String(statusC.data.campaign.lastError));
  check("campaign view flags the chosen mailbox as unavailable", statusC.data.campaign.fromMailbox === "team" && statusC.data.campaign.senderAvailable === false, JSON.stringify(statusC.data.campaign).slice(0, 250));
  await admin("POST", "/api/admin/campaign/disarm", { campaignId: "team-unavailable" });

  // ---------- Part D: warm-up cap enforcement ----------
  part("D: warm-up cap");
  const impD = await admin("POST", "/api/admin/campaign/import", {
    campaignId: "creators-cap",
    recipients: Array.from({ length: 10 }, (_, i) => ({ email: `capc${i + 1}@fixtures.dev`, name: `Cap C${i + 1}`, handle: `capc${i + 1}`, market: "Richmond", opener: "your posts" })),
  });
  check("cap fixture imports 10", impD.status === 200 && impD.data.imported === 10, JSON.stringify(impD.data));
  await admin("POST", "/api/admin/campaign/sender", { campaignId: "creators-cap", fromMailbox: "creators" });
  await admin("POST", "/api/admin/campaign/arm", { campaignId: "creators-cap" });
  const sweepD1 = await admin("POST", "/api/admin/campaign/sweep", { now: IN_WINDOW });
  check("first sweep stops at the profile cap of 3, inside a batch of 8", sweepD1.data.sweep.sent === 3 && sweepD1.data.sweep.teamCap === 3, JSON.stringify(sweepD1.data.sweep));
  const statusD1 = await admin("GET", "/api/admin/campaign?campaignId=creators-cap");
  check("after the capped sweep: 3 sent / 7 queued", statusD1.data.counts.sent === 3 && statusD1.data.counts.queued === 7, JSON.stringify(statusD1.data.counts));
  check("recent sends are stamped from the creators mailbox", (statusD1.data.recentSends || []).length === 3 && statusD1.data.recentSends.every((s) => s.fromMailbox === "creators"), JSON.stringify(statusD1.data.recentSends));
  const sweepD2 = await admin("POST", "/api/admin/campaign/sweep", { now: IN_WINDOW });
  check("second same-day sweep sends 0 and reports the cap hit", sweepD2.data.sweep.sent === 0 && sweepD2.data.sweep.teamCapHit >= 1, JSON.stringify(sweepD2.data.sweep));
  const statusD2 = await admin("GET", "/api/admin/campaign?campaignId=creators-cap");
  check("hitting the cap is not an error: still armed, no lastError", statusD2.data.campaign.armed === true && !statusD2.data.campaign.lastError, JSON.stringify(statusD2.data.campaign).slice(0, 250));
  const sweepD3 = await admin("POST", "/api/admin/campaign/sweep", { now: DAY2 });
  check("the next ET day the cap resets and 3 more send", sweepD3.data.sweep.sent === 3, JSON.stringify(sweepD3.data.sweep));
  const statusD3 = await admin("GET", "/api/admin/campaign?campaignId=creators-cap");
  check("after day 2: 6 sent / 4 queued", statusD3.data.counts.sent === 6 && statusD3.data.counts.queued === 4, JSON.stringify(statusD3.data.counts));
  await admin("POST", "/api/admin/campaign/disarm", { campaignId: "creators-cap" });

  // ---------- Part E: the default path is unchanged ----------
  part("E: default path");
  const impE = await admin("POST", "/api/admin/campaign/import", {
    recipients: [1, 2].map((i) => ({ email: `plain${i}@fixtures.dev`, name: `Plain ${i}`, handle: `plain${i}`, market: "Richmond", opener: "your posts" })),
  });
  check("default fixture imports 2", impE.status === 200 && impE.data.imported === 2, JSON.stringify(impE.data));
  await admin("POST", "/api/admin/campaign/arm", {});
  const sweepE = await admin("POST", "/api/admin/campaign/sweep", { now: DAY3 });
  check("default campaign sends both under the stub", sweepE.data.sweep.sent === 2 && sweepE.data.sweep.senderUnavailable === 0, JSON.stringify(sweepE.data.sweep));
  const statusE = await admin("GET", "/api/admin/campaign");
  check("default sends are stamped fromMailbox default", (statusE.data.recentSends || []).length >= 2 && statusE.data.recentSends.slice(0, 2).every((s) => s.fromMailbox === "default"), JSON.stringify(statusE.data.recentSends));
  check("drained default queue auto-disarms as before", statusE.data.campaign.armed === false && statusE.data.campaign.disarmReason === "queue_empty", JSON.stringify(statusE.data.campaign).slice(0, 250));

  // ---------- Part F: client guards ----------
  part("F: client");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("sender select rendered on the campaign card", appJs.includes('id="campaign-sender${meta.suffix}"') && appJs.includes("CAMPAIGN_SENDER_OPTIONS"));
  check("sender select posts to the sender endpoint", appJs.includes("setCampaignSender") && appJs.includes('api("POST", "/admin/campaign/sender"') && appJs.includes("fromMailbox: sel.value"));
  check("card carries the not-active warning copy", appJs.includes("campaignSenderNote") && appJs.includes("NOT active") && appJs.includes("hello@signlteam.com"));
  const served = await anon("GET", "/app.js");
  check("served app.js carries the sender select", served.status === 200 && served.text.includes("campaign-sender") && served.text.includes("/admin/campaign/sender"), String(served.status));
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
} finally {
  restoreEnv();
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nMailbox verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
