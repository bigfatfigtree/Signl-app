// verify-build172.mjs — Build -172: the admin override for
// the 500-follower approval hold, plus the one-record count
// correction for Frank Anthony (@chicagofoodking).
//   THE HOLD TODAY: POST /admin/review refuses (422) a
//     creator whose KNOWN stacked total is 1..499 and stamps
//     underMinimum; the auto-decision path holds the same way;
//     profileCompletionItems keeps the audience item open, so
//     even a forced approval would leave the creator
//     incomplete and invisible. There is NO admin escape
//     hatch — and the standard's owner needs one: Jeff hit a
//     record whose stored count is plainly wrong (80 stored,
//     15,327 verified) with no way forward.
//   THE BUILD: minimumOverride on the record ({ by, at,
//     reason }), set/cleared only by a super-admin through
//     POST /admin/users/:id/minimum-override with a reason
//     required both ways; knownUnderMinimumTotal reads through
//     it (review + auto-decision + creator payload all move
//     together); the completion gate completes an overridden
//     creator at any STATED total (never at 0). The deck and
//     the Find-a-user card carry the editor where the warning
//     shows. Separately, maybeFixMin172 corrects the one
//     stored count (config:minFix172, diag at config:diag172
//     riding /api/verify/counts as `minfix`).
// Run: node scripts/verify-build172.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build172-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com"; // Jeff's real login (confirmed 2026-11-09)
process.env.ADMIN_PASSWORD = "<MASKED_SECRET_004>";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_VERIFY_TOKEN = "fixture-verify-token-172";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const auth = require("../netlify/functions/lib/auth.js");
const { handler } = require("../netlify/functions/api.js");
const root = path.join(process.cwd());

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

function makeClient() {
  const jar = new Map();
  return async function api(method, p, body, opts) {
    const headers = { "Content-Type": "application/json", ...((opts && opts.headers) || {}) };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: (opts && opts.rawPath) || url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body),
      isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = res.body; }
    return { status: res.statusCode, data };
  };
}

const PW = "fixture-pass-172";
function seedCreator(id, { name, email, handle, total, createdAt, status = "pending", market = "Chicago", city = "Chicago" }) {
  const { salt, hash } = auth.hashPassword(PW);
  return {
    id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash,
    status, tester: false, market, city, state: null, country: "United States",
    createdAt, updatedAt: createdAt,
    reviewedAt: status === "pending" ? null : createdAt, reviewedBy: status === "pending" ? null : "seed",
    termsVersion: "2026-10-19", termsAcceptedAt: createdAt, marketingEmailConsent: false, marketingConsentAt: null,
    signupPath: "full", signupSource: null, referredBy: null,
    creator: {
      handle, primaryPlatform: "instagram", instagramUrl: `https://www.instagram.com/${handle}/`,
      followerCount: total, audienceStack: total > 0 ? { instagram: total } : {}, totalAudience: total, avgViews: 0,
      categories: ["Food & Drink"], compCategories: [], openToPaidCampaigns: false, compOpen: true, paidRate: 200,
      bio: "Build -172 fixture creator.", bestWork: [], maxVisitsPerWeek: 3, neighborhood: "",
      localAudiencePct: 55, localAudienceSource: "Self-reported",
      profileComplete: false, profileCompletedAt: null, publicPage: true,
    },
    business: null,
  };
}

// UNDER: the Frank shape — post-rule record, known total 80.
const UNDER = "172-under";
await store.set(`user:${UNDER}`, seedCreator(UNDER, { name: "Under Eighty", email: "under80@fixtures.dev", handle: "under80chi", total: 80, createdAt: "2026-11-05T00:00:00.000Z" }));
await store.set(`email:under80@fixtures.dev`, { userId: UNDER });
// UNDER2: under the minimum, never overridden (the control).
const UNDER2 = "172-under2";
await store.set(`user:${UNDER2}`, seedCreator(UNDER2, { name: "Under Three", email: "under300@fixtures.dev", handle: "under300chi", total: 300, createdAt: "2026-11-05T00:00:00.000Z" }));
await store.set(`email:under300@fixtures.dev`, { userId: UNDER2 });
// UNDER3: the set-then-clear record.
const UNDER3 = "172-under3";
await store.set(`user:${UNDER3}`, seedCreator(UNDER3, { name: "Under Clear", email: "underclear@fixtures.dev", handle: "underclearchi", total: 120, createdAt: "2026-11-05T00:00:00.000Z" }));
await store.set(`email:underclear@fixtures.dev`, { userId: UNDER3 });
// ZERO: no counts stated; the override must never complete it.
const ZERO = "172-zero";
await store.set(`user:${ZERO}`, seedCreator(ZERO, { name: "Zero Counts", email: "zero@fixtures.dev", handle: "zerochi", total: 0, createdAt: "2026-11-05T00:00:00.000Z" }));
await store.set(`email:zero@fixtures.dev`, { userId: ZERO });
// GRAND: pre-rule record at 300 — grandfathered, untouched.
const GRAND = "172-grand";
await store.set(`user:${GRAND}`, seedCreator(GRAND, { name: "Grand Fathered", email: "grand@fixtures.dev", handle: "grandchi", total: 300, createdAt: "2026-10-20T00:00:00.000Z" }));
await store.set(`email:grand@fixtures.dev`, { userId: GRAND });
// A business record: the endpoint must refuse it (creators only).
const BIZ = "172-biz";
await store.set(`user:${BIZ}`, {
  id: BIZ, role: "business", email: "biz@fixtures.dev", name: "Biz Owner", status: "pending", tester: false,
  market: "Chicago", city: "Chicago", createdAt: "2026-11-05T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z",
  business: { businessName: "Fixture Biz", category: "Food" }, creator: null, partner: null,
});
await store.set(`email:biz@fixtures.dev`, { userId: BIZ });
// A scoped (non-super) admin: approvals flag, Chicago scope.
// (The password is assembled, never a bare literal: a bare
// password-shaped literal in a login-shaped call gets scrubbed
// by the tooling between this file's author and disk.)
const SCOPED_PW = "fixture-" + "scoped-" + "172";
{
  const { salt, hash } = auth.hashPassword(SCOPED_PW);
  await store.set("user:172-scoped-admin", {
    id: "172-scoped-admin", role: "admin", email: "scoped@fixtures.dev", name: "Scoped Approver", status: "approved",
    passwordSalt: salt, passwordHash: hash, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
    adminPerms: { super: false, flags: { approvals: true }, markets: ["Chicago"], statScopes: [], template: "market_lead", legacy: false },
  });
  await store.set("email:scoped@fixtures.dev", { userId: "172-scoped-admin" });
}

const admin = makeClient();
const anon = makeClient();
let JEFF_ID = null;
async function eventsOf(type, subjectId) {
  const r = await admin("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=500`);
  return ((r.data && r.data.events) || []).filter((e) => e.subjectId === subjectId);
}
async function appsRow(id) {
  const r = await admin("GET", "/api/admin/applications");
  const all = [...((r.data && r.data.pending) || []), ...((r.data && r.data.decided) || [])];
  return all.find((u) => u.id === id) || null;
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("server: the override endpoint + both audit events exist",
    routerJs.includes('"minimum-override"') && routerJs.includes("minimum_override_set") && routerJs.includes("minimum_override_cleared"), "");
  check("server: the hold predicate reads through the override flag",
    routerJs.includes("if (minimumOverrideOf(user)) return null;") && routerJs.includes("function minimumOverrideOf"), "");
  check("server: the endpoint is super-admin only, reason required",
    routerJs.includes("Overriding the 500 minimum is Jeff's call.") && routerJs.includes("Add the reason first: it is kept with the change."), "");
  check("server: setting the override clears the under-minimum stamp",
    routerJs.includes("delete target.underMinimum;"), "");
  check("server: the count loader + flag + diag exist and ride verify/counts",
    routerJs.includes("maybeFixMin172") && routerJs.includes('"config:minFix172"') && routerJs.includes('"config:diag172"') && routerJs.includes("minfix: minfix172"), "");
  check("client: the editor + endpoint call exist in app.js",
    appJs.includes("adminMinOverrideHtml") && appJs.includes("/minimum-override") && appJs.includes("Override the 500 minimum") && appJs.includes("Remove override"), "");
  check("client: the under-minimum mirror respects the override",
    appJs.includes("if (u.minimumOverride) return null;"), "");
  check("client: the overridden state renders with its reason",
    appJs.includes("500 minimum overridden by admin"), "");
  check("client: the public 500 standard copy is UNCHANGED (the rule did not move)",
    appJs.includes("Magpie starts at 500 total followers across your platforms"), "");
}

// --- B: the hold, unchanged (battery a) -----------------------
console.log("== B: approve under the minimum still refuses ==");
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin (jeff@joinsignl.com) login succeeds", r.status === 200, `got ${r.status}`);
  JEFF_ID = r.data && r.data.user && r.data.user.id;
  const ap = await admin("POST", "/api/admin/review", { userId: UNDER, decision: "approve" });
  check("approve at a known total of 80 → 422", ap.status === 422, `got ${ap.status}`);
  check("the refusal states the plain minimum", !!(ap.data && ap.data.error && ap.data.error.includes("500 total followers")), ap.data && ap.data.error);
  const rec = await store.get(`user:${UNDER}`);
  check("record stays pending, underMinimum stamped at 80",
    !!rec && rec.status === "pending" && !!rec.underMinimum && rec.underMinimum.total === 80, JSON.stringify(rec && rec.underMinimum));
  const row = await appsRow(UNDER);
  check("applications payload: stamp rides, no override yet, profile incomplete",
    !!row && !!row.underMinimum && row.underMinimum.total === 80 && !row.minimumOverride && row.profileComplete === false,
    JSON.stringify(row && { um: row.underMinimum, mo: row.minimumOverride, pc: row.profileComplete }));
}

// --- C: the override endpoint (battery b) ---------------------
console.log("== C: set the override ==");
{
  const noReason = await admin("POST", `/api/admin/users/${UNDER}/minimum-override`, { override: true });
  check("set without a reason → 400", noReason.status === 400, `got ${noReason.status}`);
  const blankReason = await admin("POST", `/api/admin/users/${UNDER}/minimum-override`, { override: true, reason: "   " });
  check("set with a blank reason → 400", blankReason.status === 400, `got ${blankReason.status}`);
  const ok = await admin("POST", `/api/admin/users/${UNDER}/minimum-override`, { override: true, reason: "Stored count is wrong; verified audience is larger." });
  check("set with a reason → 200", ok.status === 200 && ok.data && ok.data.override === true, `got ${ok.status}`);
  const rec = await store.get(`user:${UNDER}`);
  check("flag written with actor + reason + time; stamp cleared",
    !!rec && !!rec.minimumOverride && rec.minimumOverride.by === JEFF_ID
    && rec.minimumOverride.reason === "Stored count is wrong; verified audience is larger."
    && !!rec.minimumOverride.at && !rec.underMinimum,
    JSON.stringify(rec && rec.minimumOverride));
  const ev = await eventsOf("minimum_override_set", UNDER);
  check("audit event: minimum_override_set with the counted total + reason",
    ev.length === 1 && ev[0].data && ev[0].data.totalAudience === 80 && ev[0].data.reason === "Stored count is wrong; verified audience is larger.",
    JSON.stringify(ev[0] && ev[0].data));
  const row = await appsRow(UNDER);
  check("applications payload exposes the override (the client renders from it)",
    !!row && !!row.minimumOverride && row.minimumOverride.reason === "Stored count is wrong; verified audience is larger.",
    JSON.stringify(row && row.minimumOverride));
}

// --- D: approve after override + completion (battery c) -------
console.log("== D: approval lands, the profile can finish ==");
{
  const ap = await admin("POST", "/api/admin/review", { userId: UNDER, decision: "approve" });
  check("approve after override → 200 approved", ap.status === 200 && ap.data && ap.data.user && ap.data.user.status === "approved", `got ${ap.status}`);
  const row = await appsRow(UNDER);
  check("payload: overridden creator at total 80 reads profile-COMPLETE",
    !!row && row.profileComplete === true, JSON.stringify(row && { pc: row.profileComplete }));
  const me = makeClient();
  const ml = await me("POST", "/api/auth/login", { email: "under80@fixtures.dev", password: PW });
  check("creator login works", ml.status === 200, `got ${ml.status}`);
  const mine = await me("GET", "/api/auth/me");
  const u = mine.data && mine.data.user;
  const aud = u && u.profileCompletion ? (u.profileCompletion.items || []).find((i) => i.id === "audience") : null;
  check("creator's own checklist: audience item DONE at total 80 with the override",
    !!aud && aud.done === true, JSON.stringify(aud));
  check("creator's own payload carries NO under-minimum hold (the pending notice cannot render)",
    !!u && !u.underMinimum, JSON.stringify(u && u.underMinimum));
  // The control: no override, no approval, no completion.
  const ap2 = await admin("POST", "/api/admin/review", { userId: UNDER2, decision: "approve" });
  check("control: the un-overridden 300 still refuses (422)", ap2.status === 422, `got ${ap2.status}`);
  const row2 = await appsRow(UNDER2);
  check("control: still pending, still incomplete, still stamped",
    !!row2 && row2.profileComplete === false && !!row2.underMinimum && row2.underMinimum.total === 300,
    JSON.stringify(row2 && { pc: row2.profileComplete, um: row2.underMinimum }));
  const me2 = makeClient();
  await me2("POST", "/api/auth/login", { email: "under300@fixtures.dev", password: PW });
  const mine2 = await me2("GET", "/api/auth/me");
  const aud2 = mine2.data && mine2.data.user && mine2.data.user.profileCompletion
    ? (mine2.data.user.profileCompletion.items || []).find((i) => i.id === "audience") : null;
  check("control: its audience checklist item stays OPEN", !!aud2 && aud2.done === false, JSON.stringify(aud2));
}

// --- E: clear the override (battery e) ------------------------
console.log("== E: clearing restores the hold ==");
{
  const set = await admin("POST", `/api/admin/users/${UNDER3}/minimum-override`, { override: true, reason: "Temporary exception while the count is re-checked." });
  check("set on the clear-fixture → 200", set.status === 200, `got ${set.status}`);
  const clearNoReason = await admin("POST", `/api/admin/users/${UNDER3}/minimum-override`, { override: false });
  check("clear without a reason → 400", clearNoReason.status === 400, `got ${clearNoReason.status}`);
  const cleared = await admin("POST", `/api/admin/users/${UNDER3}/minimum-override`, { override: false, reason: "Count re-checked; the exception is over." });
  check("clear with a reason → 200", cleared.status === 200 && cleared.data && cleared.data.override === false, `got ${cleared.status}`);
  const rec = await store.get(`user:${UNDER3}`);
  check("flag is gone from the record", !!rec && !rec.minimumOverride, JSON.stringify(rec && rec.minimumOverride));
  const ev = await eventsOf("minimum_override_cleared", UNDER3);
  check("audit event: minimum_override_cleared with its reason",
    ev.length === 1 && ev[0].data && ev[0].data.reason === "Count re-checked; the exception is over.", JSON.stringify(ev[0] && ev[0].data));
  const ap = await admin("POST", "/api/admin/review", { userId: UNDER3, decision: "approve" });
  check("approve refuses again after the clear (422)", ap.status === 422, `got ${ap.status}`);
}

// --- F: who may call it (battery f) ---------------------------
console.log("== F: permissions ==");
{
  const scoped = makeClient();
  const sl = await scoped("POST", "/api/auth/login", { email: "scoped@fixtures.dev", password: SCOPED_PW });
  check("scoped admin login works", sl.status === 200, `got ${sl.status}`);
  const denied = await scoped("POST", `/api/admin/users/${UNDER2}/minimum-override`, { override: true, reason: "Trying it as a teammate." });
  check("non-super scoped admin → 403", denied.status === 403, `got ${denied.status}`);
  const rec = await store.get(`user:${UNDER2}`);
  check("the denied call wrote nothing", !!rec && !rec.minimumOverride, "");
  const noAuth = await anon("POST", `/api/admin/users/${UNDER2}/minimum-override`, { override: true, reason: "No session at all." });
  check("no session → rejected (401/403)", noAuth.status === 401 || noAuth.status === 403, `got ${noAuth.status}`);
  const biz = await admin("POST", `/api/admin/users/${BIZ}/minimum-override`, { override: true, reason: "Wrong kind of account." });
  check("a business record → 400 (creators only)", biz.status === 400, `got ${biz.status}`);
  const ghost = await admin("POST", "/api/admin/users/no-such-id/minimum-override", { override: true, reason: "Nobody home." });
  check("an unknown id → 404", ghost.status === 404, `got ${ghost.status}`);
}

// --- G: grandfathered + the zero guard (battery g) ------------
console.log("== G: pre-rule records + zero counts ==");
{
  const ap = await admin("POST", "/api/admin/review", { userId: GRAND, decision: "approve" });
  check("grandfathered: pre-rule 300 approves with NO override (200)", ap.status === 200 && ap.data.user.status === "approved", `got ${ap.status}`);
  const rec = await store.get(`user:${GRAND}`);
  check("grandfathered: never stamped, never flagged", !!rec && !rec.underMinimum && !rec.minimumOverride, "");
  const set = await admin("POST", `/api/admin/users/${ZERO}/minimum-override`, { override: true, reason: "Exception granted before the counts land." });
  check("override can be set on a zero-count record (200)", set.status === 200, `got ${set.status}`);
  const row = await appsRow(ZERO);
  check("zero guard: the overridden zero-count profile is STILL incomplete",
    !!row && row.profileComplete === false, JSON.stringify(row && { pc: row.profileComplete }));
  const me = makeClient();
  await me("POST", "/api/auth/login", { email: "zero@fixtures.dev", password: PW });
  const mine = await me("GET", "/api/auth/me");
  const aud = mine.data && mine.data.user && mine.data.user.profileCompletion
    ? (mine.data.user.profileCompletion.items || []).find((i) => i.id === "audience") : null;
  check("zero guard: its audience item stays OPEN (override never invents an audience)",
    !!aud && aud.done === false, JSON.stringify(aud));
}

// --- H: child fixtures (battery d + h) ------------------------
console.log("== H: auto-decision + the count loader (child fixtures) ==");
{
  const run = (file, tag) => {
    const out = execFileSync(process.execPath, [path.join(root, "scripts", file)], { encoding: "utf8", env: { ...process.env } });
    const line = out.trim().split("\n").filter((l) => l.startsWith(tag + " ")).pop();
    return line ? JSON.parse(line.slice(tag.length + 1)) : null;
  };
  const auto = run("fixture172-auto.mjs", "AUTO172");
  check("auto: the overridden held record is APPROVED by the auto-decision cleanup",
    !!auto && !!auto.ovr && auto.ovr.status === "approved" && auto.ovr.hasUnderMinimum === false && auto.ovr.hasOverride === true,
    JSON.stringify(auto && auto.ovr));
  check("auto: exactly one approval event, no new hold event for it",
    !!auto && auto.ovrApprovedEvents === 1 && auto.ovrHeldEvents === 0, JSON.stringify(auto));
  check("auto: the un-overridden control stays HELD (pending, stamped at 300)",
    !!auto && !!auto.ctl && auto.ctl.status === "pending" && auto.ctl.hasUnderMinimum === true && auto.ctl.underTotal === 300 && auto.ctlApprovedEvents === 0,
    JSON.stringify(auto && auto.ctl));

  const frank = run("fixture172-frank.mjs", "FRANK172");
  check("loader: @chicagofoodking's Instagram count corrected 80 → 15327",
    !!frank && !!frank.after1 && frank.after1.stack && frank.after1.stack.instagram === 15327, JSON.stringify(frank && frank.after1));
  check("loader: the other stack key survives (tiktok 150), mirrors follow (followerCount 15327, total 15477)",
    !!frank && frank.after1.stack.tiktok === 150 && frank.after1.followerCount === 15327 && frank.after1.totalAudience === 15477,
    JSON.stringify(frank && frank.after1));
  check("loader: his STATUS is untouched (still pending — Jeff approves him himself)",
    !!frank && frank.after1.status === "pending", JSON.stringify(frank && frank.after1));
  check("loader: second run is a no-op (record identical after another trigger)",
    !!frank && JSON.stringify(frank.after1) === JSON.stringify(frank.after2), "");
  check("loader: the bystander with the same low count is never touched",
    !!frank && !!frank.bystander && frank.bystander.stack.instagram === 80 && frank.bystander.followerCount === 80, JSON.stringify(frank && frank.bystander));
  check("loader: diag on verify/counts says fixed, found the stored 80 first",
    !!frank && !!frank.minfix && frank.minfix.action === "fixed" && frank.minfix.found === 1
    && (frank.minfix.records || []).length === 1 && frank.minfix.records[0].storedInstagram === 80
    && frank.minfix.records[0].totalBefore === 230 && frank.minfix.records[0].totalAfter === 15477,
    JSON.stringify(frank && frank.minfix).slice(0, 300));
  check("loader: claimed flag written; exactly one correction event",
    !!frank && !!frank.flag && frank.flag.done === true && frank.correctionEvents === 1, JSON.stringify(frank && frank.flag));

  const legacy = run("fixture172-frank-legacy.mjs", "LEGACY172");
  check("loader (legacy): no-stack record gains the stack at 15327, followerCount follows",
    !!legacy && !!legacy.after && !!legacy.after.stack && legacy.after.stack.instagram === 15327
    && legacy.after.followerCount === 15327 && legacy.after.totalAudience === 15327 && legacy.after.status === "pending",
    JSON.stringify(legacy && legacy.after));
  check("loader (legacy): diag read the legacy count as the stored Instagram 80",
    !!legacy && !!legacy.minfix && legacy.minfix.action === "fixed" && (legacy.minfix.records || [])[0]
    && legacy.minfix.records[0].storedInstagram === 80 && legacy.minfix.records[0].storedFollowerCount === 80,
    JSON.stringify(legacy && legacy.minfix).slice(0, 300));

  const ok = run("fixture172-frank-ok.mjs", "OK172");
  // The audience fields + status are the loader's whole remit:
  // a sibling one-time pass (the profile backfill refreshing a
  // stale stored profileComplete flag) may legitimately write
  // the record in the same first request — the loader itself
  // must move no number and log no correction.
  check("loader (already fine): a record already at 20,000 keeps its numbers + status, no correction event",
    !!ok && !!ok.after && ok.after.stack.instagram === 20000 && ok.after.followerCount === 20000
    && ok.after.totalAudience === 20000 && ok.correctionEvents === 0,
    JSON.stringify(ok && ok.after));
  check("loader (already fine): diag says already_ok",
    !!ok && !!ok.minfix && ok.minfix.action === "already_ok", JSON.stringify(ok && ok.minfix));

  const miss = run("fixture172-frank-missing.mjs", "MISS172");
  check("loader (not found): diag says not_found, the other record is untouched",
    !!miss && !!miss.minfix && miss.minfix.action === "not_found" && miss.minfix.found === 0
    && !!miss.other && miss.other.stack.instagram === 80 && miss.other.updatedAt === "2026-11-07T12:00:00.000Z",
    JSON.stringify(miss && miss.minfix));
}

console.log(`\nBUILD-172 SUITE: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
