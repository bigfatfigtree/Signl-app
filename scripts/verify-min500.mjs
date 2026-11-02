#!/usr/bin/env node
// The 500 minimum verification (Jeff's ruling, 2026-11-01:
// "500 followers needs to be the minimum everywhere.").
//
// Proves, against throwaway local stores:
//   Phase 1 (fresh store, new records):
//     - a full-form sign-up at 499 total does NOT complete the
//       profile gate; the audience checklist item stays open and
//       its detail states the minimum and the counted total;
//     - exactly 500 completes; a stacked 300 + 250 completes;
//     - the profile save path holds the same gate (300 stays
//       open, 600 flips complete);
//     - a manual admin approval of a known sub-500 applicant is
//       refused (422), the record stays pending in a clear
//       under-minimum state, and the hold is logged;
//     - an evidence-matched (Rule A) sign-up at 300 is HELD, not
//       silently approved: no approval event, no approval email,
//       the sign-up confirmation still goes out carrying the
//       plain minimum line;
//     - an evidence-matched (Rule A) sign-up at 800 approves at
//       sign-up exactly as before.
//   Phase 2 (pre-seeded store, the production shapes):
//     - an approved, finished creator created BEFORE the ruling
//       with a 300 total is grandfathered: still complete, still
//       on the sitemap, still serving the full public page, and
//       the profile backfill does not flag them incomplete;
//     - a pending pre-ruling record at 300 can still be approved
//       by hand (the hold never reaches grandfathered records).
//   Source checks: the plain statement rides the claim form, the
//   full sign-up, the basics card, and the pending screen.
//
// Run: node scripts/verify-min500.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8993;
const PORT2 = 8994;
const BASE = `http://127.0.0.1:${PORT}`;
const BASE2 = `http://127.0.0.1:${PORT2}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_003>";
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const MIN_LINE = "SIGNL starts at 500 total followers across your platforms.";

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}

function startServer(db, port) {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL, ADMIN_PASSWORD };
  const s = spawn("node", ["scripts/dev-server.mjs", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  s.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return s;
}
async function waitUp(base) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not come up on ${base}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-min500-"));
const DB = path.join(tmp, "db.json");
const DB2 = path.join(tmp, "db2.json");

console.log("== Phase 1: the gate and the approval holds (new records) ==");
const server = startServer(DB, PORT);
await waitUp(BASE);
const admin = new Client(BASE);
{
  const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", r.status === 200 && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
}
async function eventsOf(type) {
  const r = await admin.req("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=500`);
  return (r.data && r.data.events) || [];
}
function fullForm(email, handle, market, city, extra = {}) {
  const c = new Client(BASE);
  return c.req("POST", "/api/auth/register", {
    role: "creator", name: "Min Five Hundred", email, password: "<redacted>", market, city, handle,
    followerCount: 0, localAudiencePct: 60, categories: ["Food & Drink"], ...AGREE, ...extra,
  }).then((r) => ({ c, r }));
}

// --- the completion gate ---
const g499 = await fullForm("gate499@fixtures.dev", "gate499", "Virginia Beach", "Virginia Beach", { followerCount: 499 });
check("gate: 499 sign-up registers", g499.r.status === 201, `status=${g499.r.status}`);
check("gate: 499 does NOT complete the profile", g499.r.data.user.creator.profileComplete === false, `profileComplete=${g499.r.data.user.creator.profileComplete}`);
{
  const items = (g499.r.data.user.profileCompletion || {}).items || [];
  const aud = items.find((i) => i.id === "audience");
  check("gate: audience item open at 499", !!aud && aud.done === false);
  check("gate: audience detail states the minimum + counted total", !!aud && aud.detail.includes(MIN_LINE) && aud.detail.includes("499"), aud && aud.detail);
  check("gate: other required items still done at 499", items.filter((i) => i.required && i.id !== "audience").every((i) => i.done));
}
const g500 = await fullForm("gate500@fixtures.dev", "gate500", "Virginia Beach", "Virginia Beach", { followerCount: 500 });
check("gate: exactly 500 completes the profile", g500.r.status === 201 && g500.r.data.user.creator.profileComplete === true, `status=${g500.r.status} complete=${g500.r.data.user.creator.profileComplete}`);
const gStack = await fullForm("gatestack@fixtures.dev", "gatestack", "Virginia Beach", "Virginia Beach", { followerCount: 300, audienceStack: { tiktok: 250 } });
check("gate: stacked 300 + 250 = 550 completes", gStack.r.status === 201 && gStack.r.data.user.creator.totalAudience === 550 && gStack.r.data.user.creator.profileComplete === true, `total=${gStack.r.data.user.creator.totalAudience} complete=${gStack.r.data.user.creator.profileComplete}`);
{
  const completed = (await eventsOf("profile_completed")).filter((e) => e.subjectId === g499.r.data.user.id);
  check("gate: no profile_completed event logged for the 499 sign-up", completed.length === 0, `n=${completed.length}`);
}

// --- the profile save path holds the same gate ---
const saver = await fullForm("saver@fixtures.dev", "saver757", "Virginia Beach", "Virginia Beach", { followerCount: 0 });
check("save path: 0-count sign-up registers incomplete", saver.r.status === 201 && saver.r.data.user.creator.profileComplete === false);
{
  const ap = await admin.req("POST", "/api/admin/review", { userId: saver.r.data.user.id, decision: "approve" });
  check("save path: approval of a not-yet-counted (0) creator still works", ap.status === 200 && ap.data.user.status === "approved", `status=${ap.status}`);
  await saver.c.req("PATCH", "/api/me/profile", { audienceStack: { instagram: 300 }, followerCount: 300 });
  const me1 = await saver.c.req("GET", "/api/auth/me");
  check("save path: saving a 300 total keeps the profile unfinished", me1.data.user.creator.profileComplete === false, `complete=${me1.data.user.creator.profileComplete}`);
  const aud = ((me1.data.user.profileCompletion || {}).items || []).find((i) => i.id === "audience");
  check("save path: checklist detail carries the minimum at 300", !!aud && aud.done === false && aud.detail.includes(MIN_LINE), aud && aud.detail);
  await saver.c.req("PATCH", "/api/me/profile", { audienceStack: { instagram: 600 }, followerCount: 600 });
  const me2 = await saver.c.req("GET", "/api/auth/me");
  check("save path: saving a 600 total flips the profile complete", me2.data.user.creator.profileComplete === true, `complete=${me2.data.user.creator.profileComplete}`);
}

// --- manual approval hold ---
const hold = await fullForm("holdme@fixtures.dev", "holdme757", "Virginia Beach", "Virginia Beach", { followerCount: 300 });
{
  const ap = await admin.req("POST", "/api/admin/review", { userId: hold.r.data.user.id, decision: "approve" });
  check("manual hold: approving a known 300 is refused", ap.status === 422, `status=${ap.status}`);
  check("manual hold: refusal states the plain minimum", !!(ap.data && ap.data.error && ap.data.error.includes(MIN_LINE)), ap.data && ap.data.error);
  const apps = await admin.req("GET", "/api/admin/applications");
  check("manual hold: record stays in the pending queue", (apps.data.pending || []).some((u) => u.id === hold.r.data.user.id));
  const row = (apps.data.pending || []).find((u) => u.id === hold.r.data.user.id);
  check("manual hold: pending row carries the under-minimum state", !!row && !!row.underMinimum && row.underMinimum.total === 300, JSON.stringify(row && row.underMinimum));
  const heldEv = (await eventsOf("application_held_under_minimum")).filter((e) => e.subjectId === hold.r.data.user.id);
  check("manual hold: hold event logged once", heldEv.length === 1, `n=${heldEv.length}`);
  const apprEv = (await eventsOf("application_approved")).filter((e) => e.subjectId === hold.r.data.user.id);
  check("manual hold: no approval event fired", apprEv.length === 0, `n=${apprEv.length}`);
}
{
  const ap = await admin.req("POST", "/api/admin/review", { userId: g500.r.data.user.id, decision: "approve" });
  check("manual: approving an exactly-500 creator works", ap.status === 200 && ap.data.user.status === "approved", `status=${ap.status}`);
}

// --- auto-decision hold (Rule A pair, under the minimum) ---
const autoHold = await fullForm("xoxoerinsmith@gmail.com", "xoxoerinsmith", "Richmond", "Richmond", { followerCount: 300 });
check("auto hold: matched 300 sign-up registers", autoHold.r.status === 201, `status=${autoHold.r.status}`);
check("auto hold: NOT silently approved, stays pending", autoHold.r.data.user.status === "pending", `status=${autoHold.r.data.user.status}`);
check("auto hold: under-minimum state rides the claimant payload", !!autoHold.r.data.user.underMinimum && autoHold.r.data.user.underMinimum.total === 300, JSON.stringify(autoHold.r.data.user.underMinimum));
{
  const id = autoHold.r.data.user.id;
  check("auto hold: no approval event", (await eventsOf("application_approved")).filter((e) => e.subjectId === id).length === 0);
  check("auto hold: hold event logged once", (await eventsOf("application_held_under_minimum")).filter((e) => e.subjectId === id).length === 1);
  check("auto hold: no approval email queued", (await eventsOf("approval_email_queued")).filter((e) => e.subjectId === id).length === 0);
  const confirm = (await eventsOf("signup_confirmation_email_queued")).filter((e) => e.subjectId === id);
  check("auto hold: sign-up confirmation still queued", confirm.length === 1, `n=${confirm.length}`);
  // The queued event stores subject + metadata, never the body
  // (deliverEmail), so the body's minimum line is proven at the
  // source below: every confirmation builder carries it.
}

// --- auto-decision control (Rule A pair, above the minimum) ---
const autoOk = await fullForm("919eats@gmail.com", "919eats", "Raleigh", "Raleigh", { followerCount: 800 });
check("auto control: matched 800 approves at sign-up", autoOk.r.status === 201 && autoOk.r.data.user.status === "approved", `status=${autoOk.r.status}/${autoOk.r.data.user.status}`);
check("auto control: no under-minimum state on the approved record", !autoOk.r.data.user.underMinimum);
server.kill("SIGTERM");
await new Promise((r) => setTimeout(r, 400));

console.log("== Phase 2: grandfathered records (created before the ruling) ==");
function seedCreator(id, { name, email, market, city, handle, status, createdAt, total, complete }) {
  return {
    id, role: "creator", email, name, passwordSalt: "seed", passwordHash: "seed",
    status, tester: false, market, city, state: null, country: "United States", createdAt, updatedAt: createdAt,
    reviewedAt: status === "pending" ? null : createdAt, reviewedBy: status === "pending" ? null : "seed",
    termsVersion: "2026-10-19", termsAcceptedAt: createdAt, marketingEmailConsent: false, marketingConsentAt: null,
    signupPath: "full", signupSource: null, referredBy: null,
    creator: {
      handle, primaryPlatform: "instagram", instagramUrl: `https://www.instagram.com/${handle}/`,
      followerCount: total, audienceStack: { instagram: total }, totalAudience: total, avgViews: 0,
      tierBand: "Neighbors", suggestedTier: "Neighbors", computedTier: "Neighbors",
      categories: ["Food & Drink"], compCategories: [], openToPaidCampaigns: false, compOpen: true, paidRate: 200,
      bio: "Grandfathered seed creator, here before the minimum.", bestWork: [], maxVisitsPerWeek: 3, neighborhood: "",
      localAudiencePct: 55, localAudienceSource: "Self-reported",
      profileComplete: complete, profileCompletedAt: complete ? createdAt : null, publicPage: true,
    },
    business: null,
  };
}
{
  const data = {};
  data["user:seed-grand-300"] = seedCreator("seed-grand-300", { name: "Grand Seed", email: "grandseed@fixtures.dev", market: "Virginia Beach", city: "Virginia Beach", handle: "grandseed300", status: "approved", createdAt: "2026-10-20T12:00:00.000Z", total: 300, complete: true });
  data["user:seed-grand-pending"] = seedCreator("seed-grand-pending", { name: "Grand Pending", email: "grandpending@fixtures.dev", market: "Virginia Beach", city: "Virginia Beach", handle: "grandpending757", status: "pending", createdAt: "2026-10-21T12:00:00.000Z", total: 300, complete: false });
  fs.writeFileSync(DB2, JSON.stringify(data));
}
const server2 = startServer(DB2, PORT2);
await waitUp(BASE2);
const admin2 = new Client(BASE2);
await admin2.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
{
  const sm = await (await fetch(`${BASE2}/sitemap.xml`)).text();
  check("grandfather: 300-total pre-ruling creator stays on the sitemap", sm.includes("/c/grandseed300"));
  const page = await (await fetch(`${BASE2}/c/grandseed300`)).text();
  check("grandfather: full public page still served (not a stub)", page.includes("Grandfathered seed creator"), page.slice(0, 120));
  const bf = await admin2.req("POST", "/api/admin/profile-backfill", {});
  const flagged = ((bf.data && bf.data.audit && bf.data.audit.approvedIncomplete) || []).map((x) => x.userId);
  check("grandfather: backfill does not flag the pre-ruling creator incomplete", !flagged.includes("seed-grand-300"), JSON.stringify(flagged));
  const ap = await admin2.req("POST", "/api/admin/review", { userId: "seed-grand-pending", decision: "approve" });
  check("grandfather: pre-ruling pending 300 can still be approved by hand", ap.status === 200 && ap.data.user.status === "approved", `status=${ap.status}`);
}
server2.kill("SIGTERM");
await new Promise((r) => setTimeout(r, 400));

console.log("== Source: the plain statement on every joining surface ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("copy: claim form states the minimum", appJs.includes("SIGNL starts at 500 total followers across your platforms."));
  check("copy: full sign-up tier line states the minimum", appJs.includes("SIGNL starts at 500 total followers across your platforms. Neighbors 500 to 2k"));
  check("copy: basics card states the minimum", appJs.includes("<strong>SIGNL starts at 500 total followers across your platforms</strong>"));
  check("copy: pending screen states the minimum", appJs.includes("One founding standard: SIGNL starts at 500 total followers across your platforms."));
  check("copy: join form shows the under-minimum count message", appJs.includes("You have ${total.toLocaleString()} counted so far"));
  const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const emailLineUses = (routerSrc.match(/^\s+MIN_AUDIENCE_LINE,$/gm) || []).length;
  check("copy: all four confirmation emails + the approval email carry the minimum line", emailLineUses >= 5, `uses=${emailLineUses}`);
}

console.log(`\nMIN-500 SUITE: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", fails.join(" | ")); process.exit(1); }
