#!/usr/bin/env node
// verify-build245.mjs — Build -245: the Momentum blue check
// (Jeff, 2026-11-21: "Blue check at 300 (Standout)").
//
//   1. DERIVE, never store: blueCheck is computed from the same
//      Momentum points every surface reads (createMomentum):
//      299 points -> no check, 300 -> check, on detailFor,
//      summaryFor, the Discover card, and the public profile
//      payload shape. The only stored fields are the one-time
//      message receipts (blueCheckEarnedAt / blueCheckBand50At).
//   2. THE MOMENTS: crossing 300 fires ONE in-app notification
//      (kind blue_check_earned, EN + ES) plus ONE Maggie platform
//      message (in-app only, no email); first entering the last
//      50 points fires ONE near-check message naming the real gap
//      and the creator's own fastest step; a creator already at
//      300+ never gets the near-check message; nothing refires on
//      later payload builds.
//   3. MAGGIE: canon carries the rule; the fact sheet carries
//      earned / gap / band / fastest step; the deterministic
//      answerer answers "what is the blue check"; the
//      conversational layer works the gap in once per
//      conversation inside 100 points (stronger inside 50) and
//      stays silent once it has been raised or once earned.
//   4. CLIENT pins: the check renders beside the name on the
//      feed card, the profile hero, the deck card and the public
//      booking page; the explainer sheet reads in plain words in
//      EN + ES; the Momentum ladder shows the four levels with
//      the check at the 300 marker and the fill running on to
//      Cornerstone. No em dashes in any new copy.
//
// Part A is unit + source pins. Part B boots the real server
// (SIGNL_LOCAL, temp DB) with seeded creators at 249 / 250 /
// 300 / 320 points and exercises login + /auth/me + Discover.
//
// Run: node scripts/verify-build245.mjs

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const router = require("../netlify/functions/lib/router.js");
const auth = require("../netlify/functions/lib/auth.js");
const sigdata = require("../netlify/functions/lib/sigdata.js");
const sigconvo = require("../netlify/functions/lib/sigconvo.js");

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// ----------------------------------------------------------------
part("A: stamp + derive rule");
check("build stamp is >= 2026.11.21-245 and agrees in both homes",
  // Relaxed at Build -246 (was exact-match -245): the -243/-244
  // suites pin >= for the same reason, so a later build does
  // not fail this suite on the stamp alone.
  (() => { const a = read("netlify/functions/lib/build.js").match(/BUILD_ID = "2026\.11\.21-(\d+)"/); const b = read("public/index.html").match(/window\.__SIGNL_BUILD__ = "2026\.11\.21-(\d+)"/); return !!a && !!b && a[1] === b[1] && Number(a[1]) >= 245; })(), "");
check("BLUE_CHECK_POINTS is 300 and the band opens at 250",
  router.BLUE_CHECK_POINTS === 300 && router.BLUE_CHECK_BAND50_POINTS === 250, "");
check("blueCheckFromPoints: 0 / 299 -> false, 300 / 750 -> true, junk -> false",
  router.blueCheckFromPoints(0) === false && router.blueCheckFromPoints(299) === false
  && router.blueCheckFromPoints(300) === true && router.blueCheckFromPoints(750) === true
  && router.blueCheckFromPoints(undefined) === false && router.blueCheckFromPoints("300") === true, "");

// Referrals-only Momentum fixtures: +3 per sign-up, +10 per
// approval, no milestone bonuses (no first posts), bare profile.
function referralFixture(signups, approved) {
  const referrer = { id: "u-ref-245", role: "creator", status: "approved", email: "ref245@test.io", name: "Ref Cat", market: "Nashville", city: "Nashville", creator: { handle: "refcat245" }, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" };
  const users = [referrer];
  for (let i = 0; i < signups; i++) {
    users.push({ id: `u-ref-245-${i}`, role: "creator", status: i < approved ? "approved" : "pending", email: `ref245-${i}@test.io`, name: `Ref ${i}`, market: "Nashville", city: "Nashville", referredBy: "refcat245", creator: { handle: `ref245x${i}` }, createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", reviewedAt: "2026-11-03T00:00:00.000Z" });
  }
  return { referrer, users };
}
{
  const f299 = referralFixture(43, 17); // 43*3 + 17*10 = 299
  const m299 = router.createMomentum({ users: f299.users, bookings: [], posts: [], reviews: [], bizReviews: [] });
  const d299 = m299.detailFor(f299.referrer);
  check("fixture lands on exactly 299 points", d299.points === 299, `got ${d299.points}`);
  check("299 points: detailFor.blueCheck is false", d299.blueCheck === false, "");
  check("299 points: summaryFor.blueCheck is false", m299.summaryFor(f299.referrer).blueCheck === false, "");
  const f300 = referralFixture(40, 18); // 40*3 + 18*10 = 300
  const m300 = router.createMomentum({ users: f300.users, bookings: [], posts: [], reviews: [], bizReviews: [] });
  const d300 = m300.detailFor(f300.referrer);
  check("fixture lands on exactly 300 points", d300.points === 300, `got ${d300.points}`);
  check("300 points: detailFor.blueCheck is true", d300.blueCheck === true, "");
  check("300 points: summaryFor.blueCheck is true", m300.summaryFor(f300.referrer).blueCheck === true, "");
}

// ----------------------------------------------------------------
part("A: fastest step");
{
  // The checklist shape is the REAL one detailFor emits: the
  // reviews row reads done once the creator has EVER reviewed,
  // while dueBookingId marks a fresh due review on the same row.
  const step = router.blueCheckFastestStep245({ checklist: [
    { id: "photo", points: 10, done: false },
    { id: "reviews", points: 10, done: true, dueBookingId: "b1" },
    { id: "bio", points: 5, done: false },
  ] });
  check("a due review beats an equal-points profile step (real shape: done plus due)", !!step && step.id === "reviews", step && step.id);
  const stepDueOnly = router.blueCheckFastestStep245({ checklist: [
    { id: "performance", points: 5, done: true, dueBookingId: "b9" },
    { id: "photo", points: 10, done: true },
  ] });
  check("a due report is offered even after the first report (never null)", !!stepDueOnly && stepDueOnly.id === "performance", stepDueOnly && stepDueOnly.id);
  const stepDoneNoDue = router.blueCheckFastestStep245({ checklist: [
    { id: "reviews", points: 10, done: true },
    { id: "photo", points: 10, done: false },
  ] });
  check("a finished review with nothing due is not offered again", !!stepDoneNoDue && stepDoneNoDue.id === "photo", stepDoneNoDue && stepDoneNoDue.id);
  const step2 = router.blueCheckFastestStep245({ checklist: [
    { id: "bio", points: 5, done: false },
    { id: "geo", points: 10, done: false },
    { id: "photo", points: 10, done: true },
  ] });
  check("biggest open profile step wins, done steps skipped", !!step2 && step2.id === "geo", step2 && step2.id);
  const step3 = router.blueCheckFastestStep245({ checklist: [
    { id: "ontime", points: 20, done: false },
    { id: "referrals", points: 3, done: false },
  ] });
  check("steps that need a business or a booking are never offered", step3 === null, step3 && step3.id);
}

// ----------------------------------------------------------------
part("A: Maggie facts + answers");
{
  const d = {
    user: { id: "u-maggie-245", role: "creator", status: "approved", market: "Nashville", creator: { handle: "maggiecat245" } },
    full: {
      momentum: { points: 270, signups: 4, approved: 2, ledger: [], checklist: [
        { id: "photo", points: 10, done: false },
        { id: "reviews", points: 10, done: true, dueBookingId: "b9" },
      ] },
      profileCompletion: { complete: true }, publicRoster: [],
    },
    level: { name: "Regular", nextName: "Standout", nextAt: 300 },
    bookings: [], posts: [], readout: {},
  };
  const f = sigdata.buildCreatorFacts(d);
  check("fact sheet carries the blue check block", !!f.blueCheck && f.blueCheck.points === 270 && f.blueCheck.earned === false, JSON.stringify(f.blueCheck));
  check("gap is 30, inside both bands", f.blueCheck.gap === 30 && f.blueCheck.within100 === true && f.blueCheck.within50 === true, JSON.stringify(f.blueCheck));
  check("fastest step is the due review", !!f.blueCheck.fastestStep && /review the business/.test(f.blueCheck.fastestStep.phrase) && f.blueCheck.fastestStep.points === 10, JSON.stringify(f.blueCheck.fastestStep));
  const lines = sigdata.factsLines("creator", f).join("\n");
  check("facts lines state the gap and the fastest step", /Blue check: not yet/.test(lines) && /30 away from the 300/.test(lines) && /review the business from your finished visit/.test(lines), lines.slice(0, 200));
  const ans = sigdata.answerFacts("creator", f, "what is the blue check?", []);
  check("Maggie answers the blue check question with the real gap", typeof ans === "string" && /300 Momentum points/.test(ans) && /30 to go/.test(ans) && /fastest way there/.test(ans), String(ans).slice(0, 200));
  const fEarned = sigdata.buildCreatorFacts({ ...d, full: { ...d.full, momentum: { ...d.full.momentum, points: 320 } } });
  const ansEarned = sigdata.answerFacts("creator", fEarned, "do I have the blue check?", []);
  check("an earned creator hears she has it, and that it is never bought", typeof ansEarned === "string" && /You have the blue check/.test(ansEarned) && /320/.test(ansEarned) && /never bought/.test(ansEarned), String(ansEarned).slice(0, 200));
}

// ----------------------------------------------------------------
part("A: Maggie conversation");
{
  const facts = { role: "creator", profileComplete: true, missingLabels: [], momentumPoints: 280,
    blueCheck: { points: 280, earned: false, gap: 20, within100: true, within50: true, fastestStep: { phrase: "add your profile photo", points: 10 } } };
  const greet = sigconvo.sigConverse("creator", facts, "hey", [], { firstName: "Test" });
  check("inside 50, a greeting works the gap in", !!greet && /just 20 from the blue check at 300/.test(greet.text) && /fastest way there/.test(greet.text), greet && greet.text);
  const again = sigconvo.sigConverse("creator", facts, "hey", [
    { who: "user", text: "hey" },
    { who: "sig", text: "Hey, Test. Right now: you are at 280 Momentum points, just 20 from the blue check at 300. Want the fastest way there?" },
  ], { firstName: "Test" });
  check("once raised in a conversation, the nudge stays silent", !!again && !/blue check/i.test(again.text), again && again.text);
  const yes = sigconvo.sigConverse("creator", facts, "yes", [
    { who: "sig", text: "Hey, Test. Right now: you are at 280 Momentum points, just 20 from the blue check at 300. Want the fastest way there?" },
  ], { firstName: "Test" });
  check("a yes gets the fastest path with the real gap", !!yes && /20 points from the blue check/.test(yes.text) && /add your profile photo/.test(yes.text) && /\+3 when a creator joins/.test(yes.text), yes && yes.text);
  const factsFar = { ...facts, momentumPoints: 150, blueCheck: { points: 150, earned: false, gap: 150, within100: false, within50: false, fastestStep: null } };
  const greetFar = sigconvo.sigConverse("creator", factsFar, "hey", [], { firstName: "Test" });
  check("outside 100 points, no nudge", !!greetFar && !/blue check/i.test(greetFar.text), greetFar && greetFar.text);
  const factsEarned = { ...facts, momentumPoints: 320, blueCheck: { points: 320, earned: true, gap: 0, within100: false, within50: false, fastestStep: null } };
  const greetEarned = sigconvo.sigConverse("creator", factsEarned, "hey", [], { firstName: "Test" });
  check("at 300+, no nudge, plain points spot", !!greetEarned && !/blue check/i.test(greetEarned.text) && /320 Momentum points/.test(greetEarned.text), greetEarned && greetEarned.text);
}

// ----------------------------------------------------------------
part("A: source pins");
{
  const rsrc = read("netlify/functions/lib/router.js");
  check("router derives the card check from the momentum summary", /card\.blueCheck = !!card\.momentum\.blueCheck/.test(rsrc), "");
  check("router public profile derives from the same points", /blueCheck: momSummary\.blueCheck/.test(rsrc) && /const momSummary = momentum\.summaryFor\(u\);/.test(rsrc), "");
  check("lineup members carry the check from the card", /blueCheck: !!card\.blueCheck/.test(rsrc), "");
  check("saved cards get the same momentum patch as discover", /favMomCtx/.test(rsrc) && /card\.momentum = favMomCtx\.momentum\.summaryFor\(c\)/.test(rsrc), "");
  check("bench cards derive from the ledger points beside the total", /blueCheck: blueCheckFromPoints\(momentumPoints/.test(rsrc), "");
  check("the roster page handler passes a real momentum context", /rosterMembers\(rosterCtx\.users, market\.name, category, rosterCtx\.momentum\)/.test(rsrc), "");
  check("the moments skip tester records", /isTester\(user\)/.test(rsrc.slice(rsrc.indexOf("async function maybeBlueCheckMoments245"), rsrc.indexOf("async function withFounding"))), "");
  const psrc = read("netlify/functions/lib/profile-meta.js");
  check("public roster cards render the check when the payload carries it", /ROSTER_BLUE_CHECK_245/.test(psrc) && /card\.blueCheck \? ROSTER_BLUE_CHECK_245/.test(psrc), "");
  check("bookme payload copies the derived check", /payload\.blueCheck = full\.blueCheck/.test(rsrc), "");
  check("the moments fire from the creator's own payload build", /await maybeBlueCheckMoments245\(user, pub\.momentum\)/.test(rsrc), "");
  check("both moment engines are named and in-app only", /engine: "blue-check-earned-245"/.test(rsrc) && /engine: "blue-check-band50-245"/.test(rsrc) && /blue_check_earned/.test(rsrc), "");
  const hook = rsrc.slice(rsrc.indexOf("async function maybeBlueCheckMoments245"), rsrc.indexOf("async function withFounding"));
  check("no em dashes in the moment copy", !hook.includes("—"), "");
  check("the check itself is a pure points comparison", /function blueCheckFromPoints\(points\) \{\s*return \(Number\(points\) \|\| 0\) >= BLUE_CHECK_POINTS;\s*\}/.test(rsrc), "");

  const asrc = read("public/app.js");
  check("feed card name carries the check", /u226-name">\$\{esc\(c\.name \|\| ""\)\}\$\{blueCheck226Html\(c\)\}/.test(asrc), "");
  // Ship-time pin repair (2026-11-21, -245 rebase): bench and lineup call sites use the small
  // variant blueCheck226Html(c, true) per the reviewer tap-target fix; count both call forms.
  check("lineup rows and bench cards carry the check beside the name", (asrc.match(/blueCheck226Html\(c(?:, true)?\)/g) || []).length >= 5, "");
  check("profile hero name carries the check", /u226-heroname">\$\{esc\(first\)\}\$\{blueCheck226Html\(c\)\}/.test(asrc), "");
  check("public booking page name carries the check", /bookme-name">\$\{esc\(profileDisplayName\(p\)\)\}\$\{blueCheck226Html\(p\)\}/.test(asrc), "");
  const sheet = asrc.slice(asrc.indexOf("function blueCheckSheet226Html"), asrc.indexOf("function openBlueCheck226"));
  check("explainer sheet: Standout at 300, ways to earn, 18 hours early, never bought (EN)",
    /300 Momentum points/.test(sheet) && /delivering posts on time, reviewing businesses, and inviting/.test(sheet) && /18 hours early/.test(sheet) && /earned, never bought/.test(sheet), "");
  check("explainer sheet: full ES parity",
    /300 puntos de Momentum/.test(sheet) && /18 horas antes/.test(sheet) && /nunca se compra/.test(sheet), "");
  check("no em dashes in the explainer sheet", !sheet.includes("—"), "");
  const meter = asrc.slice(asrc.indexOf("function momentumMeter226Html"), asrc.indexOf("function momentumHtml"));
  check("ladder carries all four levels with the check at the 300 marker",
    /Starter 0/.test(meter) && /Regular 100/.test(meter) && /Standout 300/.test(meter) && /Cornerstone 750/.test(meter) && /u226-meter-check/.test(meter) && /left: 40%|40%/.test(meter), "");
  check("ladder keeps filling past the check and carries the one line",
    /Math\.min\(100/.test(meter) && /More Momentum, higher on the list businesses see\./.test(meter) && /Inviting creators is the fastest way/.test(meter), "");
  check("no em dashes in the ladder copy", !meter.includes("—"), "");
  const css = read("public/theme-v3.css");
  check("CSS carries the check and the ladder", /\.u226-bluecheck \{/.test(css) && /\.u226-meter-track \{/.test(css) && /\.u226-meter-check \{/.test(css), "");
  const canon = read("netlify/functions/lib/sigai.js");
  check("Maggie canon teaches the blue check", /The blue check: a creator who reaches 300 Momentum points/.test(canon) && /never bought/.test(canon) && /within 100 points/.test(canon), "");
}

// ----------------------------------------------------------------
part("B: seeded server");
const PORT = 9011;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin245@signl.test";
const ADMIN_PASSWORD = "AdminPass245!";
const PW = "LongEnough1!";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-245-"));
const dbFile = path.join(tmp, "db.json");

function seedUser(db, { id, role, status = "approved", email, name, market = "Nashville", creator = null, business = null }) {
  const { salt, hash } = auth.hashPassword(PW);
  const rec = { id, role, status, email, name, passwordSalt: salt, passwordHash: hash, market, city: "Nashville", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" };
  if (creator) rec.creator = creator;
  if (business) rec.business = business;
  db[`user:${id}`] = rec;
  db[`email:${email.toLowerCase()}`] = { userId: id };
  return rec;
}
// Minimal finished profile: city + categories + local % + a
// 600-follower stack. Worth exactly +5 Momentum (the local %).
function finishedCreator(handle, extra = {}) {
  return { handle, followerCount: 600, localAudiencePct: 80, categories: ["Food"], ...extra };
}
function seedReferrals(db, handle, signups, approved) {
  for (let i = 0; i < signups; i++) {
    const id = `u245-ref-${handle}-${i}`;
    db[`user:${id}`] = { id, role: "creator", status: i < approved ? "approved" : "pending", email: `${id}@test.io`, name: `Ref ${handle} ${i}`, market: "Nashville", city: "Nashville", referredBy: handle, creator: { handle: `ref${handle}${i}` }, createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", reviewedAt: "2026-11-03T00:00:00.000Z" };
  }
}
const db = {};
// 245 referral points + 5 profile = 250: first entry into the band.
seedUser(db, { id: "u245-band", role: "creator", email: "band245@test.io", name: "Band Cat", creator: finishedCreator("bandcat245", { publicPage: true }) });
seedReferrals(db, "bandcat245", 35, 14);
// 295 + 5 = 300: the crossing.
seedUser(db, { id: "u245-cross", role: "creator", email: "cross245@test.io", name: "Cross Cat", creator: finishedCreator("crosscat245", { publicPage: true }) });
seedReferrals(db, "crosscat245", 35, 19);
// 315 + 5 = 320, congratulation already fired (stamp on record).
seedUser(db, { id: "u245-over", role: "creator", email: "over245@test.io", name: "Over Cat", creator: finishedCreator("overcat245", { blueCheckEarnedAt: "2026-11-20T00:00:00.000Z" }) });
seedReferrals(db, "overcat245", 35, 21);
// 244 + 5 = 249: below the band, nothing fires.
seedUser(db, { id: "u245-under", role: "creator", email: "under245@test.io", name: "Under Cat", creator: finishedCreator("undercat245") });
seedReferrals(db, "undercat245", 38, 13);
seedUser(db, { id: "u245-biz", role: "business", email: "biz245@test.io", name: "Biz Cat", business: { businessName: "Suite Cafe 245", category: "Cafe" } });
fs.writeFileSync(dbFile, JSON.stringify(db));

let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
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
    if (setCookie) for (const part2 of setCookie.split(/,(?=[^;]+=)/)) {
      const m = part2.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, data, text };
  };
}
const readDb = () => JSON.parse(fs.readFileSync(dbFile, "utf8"));
const values = (obj) => Object.values(obj);
const platformMessagesTo = (obj, userId) => values(obj).filter((v) => v && v.platform === true && v.toId === userId && typeof v.body === "string");
const notesFor = (obj, userId, kind) => values(obj).filter((v) => v && v.kind === kind && JSON.stringify(v).includes(userId));
const eventsOf = (obj, type, engine) => values(obj).filter((v) => v && v.type === type && (!engine || (v.data && v.data.engine === engine)));

startServer();
try {
  await waitUp();

  part("B: band creator (250)");
  const band = makeClient();
  const bandLogin = await band("POST", "/api/auth/login", { email: "band245@test.io", password: PW });
  check("band creator logs in", bandLogin.status === 200, `status ${bandLogin.status}`);
  check("band payload: 250 points, no check", !!bandLogin.data.user && bandLogin.data.user.momentum.points === 250 && bandLogin.data.user.momentum.blueCheck === false,
    bandLogin.data.user ? `points=${bandLogin.data.user.momentum && bandLogin.data.user.momentum.points}` : "no user");
  await band("GET", "/api/auth/me");
  await band("GET", "/api/auth/me");
  {
    const now = readDb();
    const msgs = platformMessagesTo(now, "u245-band");
    check("band creator got exactly ONE platform message after login + two payload builds", msgs.length === 1, `got ${msgs.length}`);
    const body = msgs.length ? msgs[0].body : "";
    check("band message names the real numbers", /250 Momentum points, 50 away from the 300/.test(body), body.slice(0, 160));
    check("band message names invites as the fastest way, with the rates", /fastest way there: \+3 when they join/.test(body) && /\+10 when they are approved/.test(body), body.slice(0, 200));
    check("band message names a real next step from the creator's own record", /One step is ready right now: .+, worth \+\d+\./.test(body), body.slice(0, 260));
    check("band message has no em dash", !body.includes("—"), "");
    check("band stamp is on the record", !!(now["user:u245-band"].creator || {}).blueCheckBand50At, "");
    check("band firing logged once, in-app only (no email)",
      eventsOf(now, "platform_message_sent", "blue-check-band50-245").length === 1
      && eventsOf(now, "platform_message_email_suppressed", "blue-check-band50-245").length === 1, "");
    check("band creator got NO earned note", notesFor(now, "u245-band", "blue_check_earned").length === 0, "");
  }

  part("B: crossing creator (300)");
  const cross = makeClient();
  const crossLogin = await cross("POST", "/api/auth/login", { email: "cross245@test.io", password: PW });
  check("crossing creator logs in", crossLogin.status === 200, `status ${crossLogin.status}`);
  check("crossing payload: 300 points, check earned", !!crossLogin.data.user && crossLogin.data.user.momentum.points === 300 && crossLogin.data.user.momentum.blueCheck === true,
    crossLogin.data.user ? `points=${crossLogin.data.user.momentum && crossLogin.data.user.momentum.points} blueCheck=${crossLogin.data.user.momentum && crossLogin.data.user.momentum.blueCheck}` : "no user");
  await cross("GET", "/api/auth/me");
  await cross("GET", "/api/auth/me");
  {
    const now = readDb();
    const msgs = platformMessagesTo(now, "u245-cross");
    check("crossing creator got exactly ONE platform message", msgs.length === 1, `got ${msgs.length}`);
    const body = msgs.length ? msgs[0].body : "";
    check("congratulation says the check is earned and where it shows", /You earned the blue check/.test(body) && /shows next to your name on your profile/.test(body) && /never bought/.test(body), body.slice(0, 200));
    check("congratulation has no em dash", !body.includes("—"), "");
    const notes = values(now).filter((v) => v && v.kind === "blue_check_earned");
    check("exactly ONE blue_check_earned notification exists", notes.length === 1, `got ${notes.length}`);
    check("the notification carries EN + ES text", notes.length === 1 && /blue check/i.test(notes[0].textEn || "") && /insignia azul/i.test(notes[0].textEs || ""), notes.length ? String(notes[0].textEn) : "");
    check("crossing stamp is on the record", !!(now["user:u245-cross"].creator || {}).blueCheckEarnedAt, "");
    check("crossing creator never got the band message", eventsOf(now, "platform_message_sent", "blue-check-band50-245").filter((e) => e.data && e.data.toId === "u245-cross").length === 0, "");
    check("no email left the building for the crossing", eventsOf(now, "platform_message_email_suppressed", "blue-check-earned-245").length === 1, "");
  }

  part("B: already-earned + below-band creators");
  const over = makeClient();
  await over("POST", "/api/auth/login", { email: "over245@test.io", password: PW });
  await over("GET", "/api/auth/me");
  const under = makeClient();
  const underLogin = await under("POST", "/api/auth/login", { email: "under245@test.io", password: PW });
  await under("GET", "/api/auth/me");
  {
    const now = readDb();
    check("already-earned creator (stamp on record) got NO new message", platformMessagesTo(now, "u245-over").length === 0, `got ${platformMessagesTo(now, "u245-over").length}`);
    check("below-band creator (249) got NO message and NO stamp",
      platformMessagesTo(now, "u245-under").length === 0 && !(now["user:u245-under"].creator || {}).blueCheckBand50At, "");
    check("below-band payload: 249 points, no check", !!underLogin.data.user && underLogin.data.user.momentum.points === 249 && underLogin.data.user.momentum.blueCheck === false,
      underLogin.data.user ? `points=${underLogin.data.user.momentum && underLogin.data.user.momentum.points}` : "no user");
  }

  part("B: Discover cards carry the derived check");
  const biz = makeClient();
  const bizLogin = await biz("POST", "/api/auth/login", { email: "biz245@test.io", password: PW });
  check("business logs in", bizLogin.status === 200, `status ${bizLogin.status}`);
  const disc = await biz("GET", "/api/discover?market=Nashville");
  check("discover responds", disc.status === 200, `status ${disc.status}`);
  const cards = [];
  (function walk(x) { if (!x || typeof x !== "object") return; if (x.userId && x.name) cards.push(x); for (const v of Object.values(x)) walk(v); })(disc.data);
  const crossCard = cards.find((c) => c.userId === "u245-cross");
  const bandCard = cards.find((c) => c.userId === "u245-band");
  check("crossing creator is on the roster with blueCheck true", !!crossCard && crossCard.blueCheck === true, crossCard ? `blueCheck=${crossCard.blueCheck}` : "card missing");
  check("band creator is on the roster with blueCheck false", !!bandCard && bandCard.blueCheck === false, bandCard ? `blueCheck=${bandCard.blueCheck}` : "card missing");

  part("B: book-me page carries the check at public tiers");
  const anon = makeClient();
  const bookAnon = await anon("GET", "/api/c/crosscat245");
  check("book-me responds to an anonymous visitor", bookAnon.status === 200, `status ${bookAnon.status}`);
  check("book-me (anonymous, tier 0): the 300-point creator's blueCheck is true",
    !!bookAnon.data && !!bookAnon.data.profile && bookAnon.data.profile.blueCheck === true,
    bookAnon.data && bookAnon.data.profile ? `blueCheck=${bookAnon.data.profile.blueCheck}` : "no profile");
  const bookBiz = await biz("GET", "/api/c/crosscat245");
  check("book-me (business viewer): blueCheck is true",
    !!bookBiz.data && !!bookBiz.data.profile && bookBiz.data.profile.blueCheck === true,
    bookBiz.data && bookBiz.data.profile ? `blueCheck=${bookBiz.data.profile.blueCheck}` : "no profile");
  const bookBand = await anon("GET", "/api/c/bandcat245");
  check("book-me (anonymous): the 250-point creator's blueCheck is false",
    !!bookBand.data && !!bookBand.data.profile && bookBand.data.profile.blueCheck === false,
    bookBand.data && bookBand.data.profile ? `blueCheck=${bookBand.data.profile.blueCheck}` : "no profile");
} finally {
  await stopServer();
}

console.log(`\nverify-build245: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
