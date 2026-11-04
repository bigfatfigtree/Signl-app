#!/usr/bin/env node
// Build -112 verification (Phase C, Jeff 2026-11-03): the
// creator standards ladder completed + paid-visit posting terms.
//
// Proves, against a throwaway local DB:
//   S. source pins: the ONE posting-terms control (composer,
//      paid sheet, campaign guide, Sig), the comped-only
//      disclaimer placements, the ladder helpers, the Sig
//      read-back wiring, the stamp.
//   A. the on-time record already feeds ranking: an on-time
//      poster's reliability / on-time % / Momentum beat a late
//      poster's on the discovery cards businesses rank by.
//   B. the late streak: three comped late posts IN A ROW pause
//      new offers for 14 days (accept refused); an on-time post
//      resets the run.
//   C. PAID SEPARATION: a paid visit posted after the comped
//      48 hours but inside its agreed terms is fully on-terms
//      (on-time, no late record, no streak, no strike); a comped
//      visit in the same window counts late. Terms validation
//      speaks plain words. Terms show on the offer BEFORE
//      accepting and in both sides' visit views; the paid clock
//      runs off the agreed by-date.
//   D. SILENT no-show strikes: no post + no word = a strike
//      (a message to the business waives it); two strikes =
//      removal, distinct from a pause; Admin sees the count and
//      the plain reason; reinstatement leaves one strike
//      (probation).
//   E. CONSUMED-COMP: day-7 pause fires first; a post inside
//      the month resolves delivered EXTREMELY late and unpauses;
//      no post at one month = no longer active (source
//      consumed_comp), idempotent across sweeps, Admin can
//      reinstate.
//   F. Sig reads the agreed posting terms back to BOTH sides
//      from the booking record (sigdata, in process).
//
// Run: node scripts/verify-build112.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8998;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";
const PW = "fixture-password-1";
const DAY = 24 * 3600 * 1000;

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// ---------- S: source pins ----------
part("S: source pins");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const sigdataJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
check("stamp is 2026.11.04-125", indexHtml.includes("2026.11.04-125"));
check("ONE shared posting-terms control exists (segmented chips, three options)", appJs.includes("postingTermsControlHtml") && appJs.includes("<strong>Standard</strong> · post within 7 days of the visit") && appJs.includes("Post by a specific date") && appJs.includes("<strong>Special terms</strong> · a date window, with a short note"));
check("control helper line: creator sees the exact terms before accepting", appJs.includes("The creator sees these exact terms on the offer before accepting"));
check("paid sheet uses the control (prefix paid-sheet)", appJs.includes('postingTermsControlHtml("paid-sheet"'));
check("composer uses the control (prefix o2)", appJs.includes('postingTermsControlHtml("o2"'));
check("campaign guide asks the terms as one chip step", appJs.includes('field: "postingterms", value: "standard"') && appJs.includes("Standard: within 7 days of the visit"));
check("Sig operator asks the terms for paid offers", appJs.includes("sigB1AskPostingTerms") && appJs.includes('payload.postingTerms = d.postingTerms || { type: "standard" }'));
check("creator offer card: accepting accepts the terms, in one line", appJs.includes("Accepting this booking accepts its posting terms:"));
check("disclaimer in the visit brief block (comped lane)", appJs.includes("The 48-hour goal and these standards apply to comped visits; paid visits follow the posting terms agreed on the booking."));
check("disclaimer in the Standard Visit summary (client mirror)", appJs.includes("The 48-hour goal and these standards apply to comped visits; paid visits follow the posting terms agreed on the booking."));
check("server: consumed-comp source + reason", routerJs.includes('comped ? "consumed_comp" : "paid_terms"') && routerJs.includes("comp consumed, no post after one month"));
check("server: silent removal source + reason", routerJs.includes('source: "silent_strikes"') && routerJs.includes("two silent no-shows"));
check("server: late streak constants + pause", routerJs.includes("LATE_STREAK_LIMIT = 3") && routerJs.includes("LATE_STREAK_PAUSE_DAYS = 14"));
check("server: reminder emails carry the comped-only scope line", routerJs.includes("These standards are for comped visits. Paid visits follow the posting terms agreed on the booking."));
check("server: Standard Visit summary carries the scope sentence", routerJs.includes("paid visits follow the posting terms agreed on the booking"));
check("server: paid clock runs off the agreed terms (postingDeadlineFor at redemption)", routerJs.includes("postingDeadlineFor(booking)"));
check("Sig facts carry paidPostingTerms for both roles", (sigdataJs.match(/paidPostingTerms/g) || []).length >= 4 && sigdataJs.includes("Agreed posting terms on their paid bookings"));

// ---------- F: Sig read-back (in process) ----------
part("F: Sig read-back");
const sigdata = createRequire(import.meta.url)("../netlify/functions/lib/sigdata.js");
const termsLineSample = "Posting terms: post by Fri, Nov 20, 2026.";
const ansText = (r) => (typeof r === "string" ? r : (r && r.text) || "");
const bizAns = sigdata.answerFactsRaw("business", { role: "business", paidPostingTerms: [{ creatorName: "Pat Paid", line: termsLineSample, status: "booked" }] }, "what are the posting terms on my paid booking with Pat", []);
check("business Sig reads the agreed terms back from the record", ansText(bizAns).includes("post by Fri, Nov 20, 2026") && ansText(bizAns).includes("Pat Paid"), JSON.stringify(bizAns).slice(0, 200));
const crAns = sigdata.answerFactsRaw("creator", { role: "creator", paidPostingTerms: [{ businessName: "Terms Bistro", line: termsLineSample, status: "booked" }] }, "what are the posting terms on my paid booking", []);
check("creator Sig reads the agreed terms back from the record", ansText(crAns).includes("post by Fri, Nov 20, 2026") && ansText(crAns).includes("Terms Bistro"), JSON.stringify(crAns).slice(0, 200));
const noneAns = sigdata.answerFactsRaw("business", { role: "business", paidPostingTerms: [] }, "what are the posting terms on my paid booking", []);
check("with no paid bookings Sig says so plainly (nothing invented)", /No paid bookings yet/.test(ansText(noneAns)), JSON.stringify(noneAns).slice(0, 200));

// ---------- live harness ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build112-"));
const dbFile = path.join(tmp, "db.json");
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
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
    try { data = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data, text };
  };
}
const uniq = () => Math.random().toString(36).slice(2, 9);
let n = 0;
async function registerCreator(overrides = {}) {
  n += 1;
  const payload = {
    role: "creator", name: `PhaseC Creator ${n}`, email: `phasec${n}-${uniq()}@fixtures.dev`, password: PW,
    market: "Hampton Roads", city: "Norfolk", handle: `phasec${n}${uniq()}`,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: 3000, avgViews: 900, localAudiencePct: 62, bio: "",
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
    ...overrides,
  };
  const c = makeClient();
  const r = await c("POST", "/api/auth/register", payload);
  if (r.status !== 201) throw new Error("creator register failed: " + JSON.stringify(r.data));
  return { email: payload.email, id: r.data.user.id, handle: payload.handle, client: c };
}
async function login(email) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email, password: PW });
  if (r.status !== 200) throw new Error("login failed for " + email + ": " + r.status);
  return c;
}
async function adminClient() {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error("admin login failed");
  return c;
}
async function registerBusiness(admin, name) {
  const email = `bizc-${uniq()}@fixtures.dev`;
  const c = makeClient();
  const r = await c("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", email, password: PW, market: "Hampton Roads", city: "Norfolk",
    businessName: name, category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  if (r.status !== 201) throw new Error("business register failed: " + JSON.stringify(r.data));
  await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: r.data.user.id });
  return { email, id: r.data.user.id, client: c };
}
async function approve(admin, creatorId) { await admin("POST", "/api/admin/review", { userId: creatorId, decision: "approve" }); }
async function me(client) { const r = await client("GET", "/api/auth/me"); return r.data.user; }
async function myBooking(client, bookingId) {
  const r = await client("GET", "/api/bookings");
  return (r.data.bookings || []).find((b) => b.id === bookingId) || null;
}
// A comped visit, accepted + confirmed (confirming starts the
// clock: redeemedAt is set).
async function compedVisit(bizClient, creator, title) {
  const off = await bizClient("POST", "/api/offers", { title, whatComped: "Meal for two, on us", dollarCap: 100, spots: 1, creatorId: creator.id });
  if (off.status !== 201) throw new Error("offer failed: " + JSON.stringify(off.data));
  const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, { visitDate: "2026-11-10" });
  if (acc.status !== 201) throw new Error("accept failed: " + JSON.stringify(acc.data));
  const conf = await bizClient("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
  if (conf.status !== 200) throw new Error("confirm failed: " + JSON.stringify(conf.data));
  return acc.data.booking.id;
}
async function postProof(creatorClient, bookingId, tag) {
  return creatorClient("POST", "/api/posts", { bookingId, url: `https://www.instagram.com/p/${tag}/`, disclosedComp: true, includesDisclosure: true });
}
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}
// Time travel ONE booking: redemption `daysAgo` in the past;
// postDeadline either an explicit ISO or redeemed + hours.
function travel(bookingId, daysAgo, deadlineIso) {
  editDb((db) => {
    for (const val of Object.values(db)) {
      if (val && val.id === bookingId && val.redeemedAt !== undefined) {
        const redeemedMs = Date.now() - daysAgo * DAY;
        val.redeemedAt = new Date(redeemedMs).toISOString();
        val.postDeadline = deadlineIso || new Date(redeemedMs + 48 * 3600 * 1000).toISOString();
        val.compliance = {};
      }
    }
  });
}
async function reboot() { await stopServer(); startServer(); await waitUp(); }
const dateOnly = (ms) => new Date(ms).toISOString().slice(0, 10);

try {
  startServer();
  await waitUp();
  let admin = await adminClient();
  const biz = await registerBusiness(admin, "Phase C Kitchen");
  let bizC = biz.client;

  // ---------- A: the on-time record feeds ranking ----------
  part("A: on-time record -> ranking");
  // Open offers are market-gated: the pair registers in the
  // business's own market, whatever the server resolves it to.
  const bizMe = await bizC("GET", "/api/auth/me");
  const bizMarket = bizMe.data.user.market;
  const onT = await registerCreator({ market: bizMarket }); await approve(admin, onT.id);
  const late1 = await registerCreator({ market: bizMarket }); await approve(admin, late1.id);
  const vOn = await compedVisit(bizC, onT, "On-time visit");
  const pOn = await postProof(onT.client, vOn, "phasec-ontime");
  check("on-time post accepted", pOn.status === 201, JSON.stringify(pOn.data).slice(0, 200));
  const vLate = await compedVisit(bizC, late1, "Late visit");
  travel(vLate, 3); // redeemed 3 days ago, deadline was +48h
  await reboot();
  admin = await adminClient(); bizC = await login(biz.email);
  late1.client = await login(late1.email); onT.client = await login(onT.email);
  const pLate = await postProof(late1.client, vLate, "phasec-late");
  check("late post (day 3, inside the week) accepted as delivered", pLate.status === 201, JSON.stringify(pLate.data).slice(0, 200));
  const bkLate = await myBooking(late1.client, vLate);
  check("late post is recorded late, not on time", !!bkLate && bkLate.compliance && bkLate.compliance.status === "posted_late", JSON.stringify(bkLate && bkLate.compliance));
  const disc = await bizC("GET", `/api/discover?market=${encodeURIComponent(bizMarket)}`);
  const cards = disc.data.creators || [];
  const cardOn = cards.find((c) => c.userId === onT.id);
  const cardLate = cards.find((c) => c.userId === late1.id);
  check("track record: on-time poster shows onTimePct 100", !!cardOn && cardOn.trackRecord && cardOn.trackRecord.onTimePct === 100, JSON.stringify(cardOn && cardOn.trackRecord));
  check("track record: late poster shows onTimePct 0 (the record is hit)", !!cardLate && cardLate.trackRecord && cardLate.trackRecord.onTimePct === 0, JSON.stringify(cardLate && cardLate.trackRecord));
  // The ranking input itself: both apply to one open offer and
  // the business's ranked application list scores the on-time
  // poster higher (reliability + Momentum terms in rankScore).
  // Open offers are only applicable in a live market: flip it
  // through the real admin flag, like the business suite does.
  // Non-charter creators then wait out the 24-hour early-access
  // window, so the offer is aged two days in the DB (the pair
  // are deliberately NOT charter: the ranking proof must not
  // ride on a perk).
  await admin("POST", "/api/admin/markets/toggle", { market: bizMarket, live: true });
  const rankOffer = await bizC("POST", "/api/offers", { title: "Ranked offer", whatComped: "Meal for two, on us", dollarCap: 100, spots: 1 });
  editDb((db) => {
    for (const val of Object.values(db)) {
      if (val && val.id === rankOffer.data.offer.id) {
        const old = new Date(Date.now() - 2 * DAY).toISOString();
        val.createdAt = old; val.publishedAt = old;
      }
    }
  });
  await reboot();
  admin = await adminClient(); bizC = await login(biz.email);
  onT.client = await login(onT.email); late1.client = await login(late1.email);
  const applyOn = await onT.client("POST", `/api/offers/${rankOffer.data.offer.id}/apply`, {});
  const applyLate = await late1.client("POST", `/api/offers/${rankOffer.data.offer.id}/apply`, {});
  check("both creators can apply to the open offer", applyOn.status === 201 && applyLate.status === 201, `${applyOn.status}/${applyLate.status} ${JSON.stringify(applyOn.data).slice(0, 120)}`);
  const apps = await bizC("GET", `/api/offers/${rankOffer.data.offer.id}/applications`);
  const rowCreatorId = (a) => a.creatorId || (a.creator && a.creator.userId) || null;
  const appOn = (apps.data.applications || []).find((a) => rowCreatorId(a) === onT.id);
  const appLate = (apps.data.applications || []).find((a) => rowCreatorId(a) === late1.id);
  check("ranked applications: the on-time record scores higher than the late record", !!appOn && !!appLate && typeof appOn.rankScore === "number" && appOn.rankScore > appLate.rankScore, JSON.stringify({ on: appOn && appOn.rankScore, late: appLate && appLate.rankScore }));
  check("ranked application exposes the reliability term (100 vs 50)", !!appOn && !!appLate && appOn.rankParts && appOn.rankParts.reliability === 100 && appLate.rankParts.reliability === 50, JSON.stringify({ on: appOn && appOn.rankParts, late: appLate && appLate.rankParts }));
  check("discovery card carries the comped-only scope sentence (Standard Visit summary)", !!cardOn && /paid visits follow the posting terms agreed on the booking/.test(cardOn.visitIncludes || ""), String(cardOn && cardOn.visitIncludes).slice(0, 200));
  const mOn = await me(onT.client); const mLate = await me(late1.client);
  check("Momentum: on-time post +20 beats late post +5 in the ledger", (mOn.momentum.ledger || []).some((e) => e.kind === "post_on_time" && e.points === 20) && (mLate.momentum.ledger || []).some((e) => e.kind === "post_late" && e.points === 5), JSON.stringify({ on: mOn.momentum.points, late: mLate.momentum.points }));
  check("ranking input: the on-time poster out-points the late poster", mOn.momentum.points > mLate.momentum.points, `${mOn.momentum.points} vs ${mLate.momentum.points}`);

  // ---------- B: late streak ----------
  part("B: late streak");
  const streak = await registerCreator(); await approve(admin, streak.id);
  await streak.client("PATCH", "/api/me/profile", { maxVisitsPerWeek: 10 });
  const sBookings = [];
  for (let i = 0; i < 4; i++) sBookings.push(await compedVisit(bizC, streak, `Streak visit ${i + 1}`));
  for (let i = 0; i < 3; i++) {
    travel(sBookings[i], 3);
    await reboot();
    admin = await adminClient(); bizC = await login(biz.email); streak.client = await login(streak.email);
    const pr = await postProof(streak.client, sBookings[i], `phasec-streak${i}`);
    if (pr.status !== 201) throw new Error("streak post failed: " + JSON.stringify(pr.data));
    const u = await me(streak.client);
    if (i < 2) check(`late post ${i + 1} of the run: streak count ${i + 1}, no pause yet`, u.lateStreakCount === i + 1 && !u.lateStreakPauseUntil, JSON.stringify({ c: u.lateStreakCount, p: u.lateStreakPauseUntil }));
  }
  const uStreak = await me(streak.client);
  check("three late posts IN A ROW: streak count 3", uStreak.lateStreakCount === 3, String(uStreak.lateStreakCount));
  check("...and new offers pause for 14 days", !!uStreak.lateStreakPauseUntil && Date.parse(uStreak.lateStreakPauseUntil) > Date.now() + 13 * DAY, String(uStreak.lateStreakPauseUntil));
  const offBlocked = await bizC("POST", "/api/offers", { title: "Blocked offer", whatComped: "Meal", dollarCap: 50, spots: 1 });
  const accBlocked = await streak.client("POST", `/api/offers/${offBlocked.data.offer.id}/accept`, {});
  check("accepting a new offer during the pause is refused (403)", accBlocked.status === 403 && /late posts in a row/.test((accBlocked.data && accBlocked.data.error) || ""), `${accBlocked.status} ${JSON.stringify(accBlocked.data)}`);
  const prReset = await postProof(streak.client, sBookings[3], "phasec-streak-reset");
  check("an already-booked visit can still be posted during the pause", prReset.status === 201, JSON.stringify(prReset.data).slice(0, 200));
  const uReset = await me(streak.client);
  check("the on-time post resets the run (count 0, pause lifted)", uReset.lateStreakCount === 0 && !uReset.lateStreakPauseUntil, JSON.stringify({ c: uReset.lateStreakCount, p: uReset.lateStreakPauseUntil }));

  // ---------- C: paid separation + terms ----------
  part("C: paid terms + separation");
  const paidC = await registerCreator(); await approve(admin, paidC.id);
  await paidC.client("PATCH", "/api/me/profile", { paidRate: 200 });
  // Terms validation, plain words.
  const badPast = await bizC("POST", "/api/bookings/paid", { creatorId: paidC.id, postingTerms: { type: "bydate", byDate: dateOnly(Date.now() - DAY) } });
  check("by-date in the past refused in plain words", badPast.status === 400 && /in the past/.test((badPast.data && badPast.data.error) || ""), `${badPast.status} ${JSON.stringify(badPast.data)}`);
  const badWindow = await bizC("POST", "/api/bookings/paid", { creatorId: paidC.id, postingTerms: { type: "window", notBefore: dateOnly(Date.now() + 9 * DAY), byDate: dateOnly(Date.now() + 2 * DAY), note: "x" } });
  check("window with due-by before its first day refused in plain words", badWindow.status === 400 && /cannot be before/.test((badWindow.data && badWindow.data.error) || ""), `${badWindow.status} ${JSON.stringify(badWindow.data)}`);
  // Direct paid booking with a by-date 5 days out.
  const byDate = dateOnly(Date.now() + 5 * DAY);
  const pb = await bizC("POST", "/api/bookings/paid", { creatorId: paidC.id, postingTerms: { type: "bydate", byDate } });
  check("paid booking created with by-date terms", pb.status === 201, `${pb.status} ${JSON.stringify(pb.data).slice(0, 200)}`);
  const pbId = pb.data.booking.id;
  check("booking carries the rendered terms line", /Posting terms: post by /.test(pb.data.booking.postingTermsLine || ""), String(pb.data.booking.postingTermsLine));
  const pbCreatorView = await myBooking(paidC.client, pbId);
  check("creator's visit view shows the exact terms before the visit", !!pbCreatorView && pbCreatorView.postingTermsLine === pb.data.booking.postingTermsLine, JSON.stringify(pbCreatorView && pbCreatorView.postingTermsLine));
  const confPb = await bizC("POST", `/api/bookings/${pbId}/confirm`, {});
  check("paid visit confirmed (clock starts)", confPb.status === 200 && !!confPb.data.booking.redeemedAt, `${confPb.status}`);
  check("the paid clock runs off the agreed by-date, not 48 hours", String(confPb.data.booking.postDeadline).slice(0, 10) === byDate, String(confPb.data.booking.postDeadline));
  // Same-window separation: redeem 3 days ago (past the comped
  // 48h, inside the by-date) and post now.
  travel(pbId, 3, new Date(Date.parse(byDate + "T23:59:59.999Z")).toISOString());
  await reboot();
  admin = await adminClient(); bizC = await login(biz.email); paidC.client = await login(paidC.email);
  const pPaid = await postProof(paidC.client, pbId, "phasec-paid");
  check("paid post inside its agreed date accepted", pPaid.status === 201, JSON.stringify(pPaid.data).slice(0, 200));
  const bkPaid = await myBooking(paidC.client, pbId);
  check("SEPARATION: paid post at day 3 is ON TIME (posted_on_time), where the comped control counted late", !!bkPaid && bkPaid.compliance && bkPaid.compliance.status === "posted_on_time", JSON.stringify(bkPaid && bkPaid.compliance));
  const uPaid = await me(paidC.client);
  check("SEPARATION: no late-streak count, no silent strikes from a paid visit", (uPaid.lateStreakCount || 0) === 0 && (uPaid.silentStrikes || 0) === 0, JSON.stringify({ s: uPaid.lateStreakCount, ss: uPaid.silentStrikes }));
  check("paid on-terms post earns the on-time Momentum entry", (uPaid.momentum.ledger || []).some((e) => e.kind === "post_on_time"), JSON.stringify(uPaid.momentum.ledger.map((e) => e.kind)));
  // Paid hard-stop separation: a paid booking past its terms
  // never accrues a silent strike and never consumed-comp bans.
  const paidC2 = await registerCreator(); await approve(admin, paidC2.id);
  await paidC2.client("PATCH", "/api/me/profile", { paidRate: 200 });
  const pb2 = await bizC("POST", "/api/bookings/paid", { creatorId: paidC2.id });
  const pb2Id = pb2.data.booking.id;
  await bizC("POST", `/api/bookings/${pb2Id}/confirm`, {});
  travel(pb2Id, 10, new Date(Date.now() - 3 * DAY).toISOString());
  await reboot();
  admin = await adminClient(); bizC = await login(biz.email); paidC2.client = await login(paidC2.email);
  const sweepPaid = await admin("POST", "/api/admin/compliance/sweep", {});
  check("sweep over the past-terms paid booking ran", sweepPaid.status === 200, JSON.stringify(sweepPaid.data).slice(0, 200));
  const uPaid2 = await me(paidC2.client);
  check("SEPARATION: past-terms paid booking accrues NO silent strike", (uPaid2.silentStrikes || 0) === 0, String(uPaid2.silentStrikes));
  check("SEPARATION: past-terms paid booking does NOT consumed-comp ban the creator", !(uPaid2.standing && uPaid2.standing.state === "banned"), JSON.stringify(uPaid2.standing));
  // Terms on the OFFER, before accepting (window shape).
  const offW = await bizC("POST", "/api/offers", { title: "Launch dinner (paid)", whatComped: "Tasting menu for two", kind: "paid", cashRate: 250, spots: 1, creatorId: paidC.id, postingTerms: { type: "window", notBefore: dateOnly(Date.now() + 2 * DAY), byDate: dateOnly(Date.now() + 9 * DAY), note: "Launch week." } });
  check("paid offer with special terms created", offW.status === 201, `${offW.status} ${JSON.stringify(offW.data).slice(0, 200)}`);
  const offersForPaid = await paidC.client("GET", "/api/offers");
  const ow = (offersForPaid.data.offers || []).find((o) => o.id === offW.data.offer.id);
  check("creator sees the EXACT special terms on the offer BEFORE accepting", !!ow && /post between/.test(ow.postingTermsLine || "") && /Launch week\./.test(ow.postingTermsLine || ""), JSON.stringify(ow && ow.postingTermsLine));
  const accW = await paidC.client("POST", `/api/offers/${offW.data.offer.id}/accept`, { visitDate: "2026-11-12" });
  check("accepting the offer accepts the terms (booking snapshots them)", accW.status === 201 && !!accW.data.booking.postingTermsLine && /Launch week\./.test(accW.data.booking.postingTermsLine), `${accW.status} ${JSON.stringify(accW.data).slice(0, 200)}`);
  const bkW = await myBooking(bizC, accW.data.booking.id);
  check("business visit view shows the same agreed terms", !!bkW && bkW.postingTermsLine === accW.data.booking.postingTermsLine, JSON.stringify(bkW && bkW.postingTermsLine));

  // ---------- D: silent no-show strikes ----------
  part("D: silent strikes");
  const silent = await registerCreator(); await approve(admin, silent.id);
  const sv1 = await compedVisit(bizC, silent, "Silent visit 1");
  const sv2 = await compedVisit(bizC, silent, "Silent visit 2");
  const talker = await registerCreator(); await approve(admin, talker.id);
  const tv1 = await compedVisit(bizC, talker, "Talker visit");
  // All DB edits land back-to-back with the reboot: any write
  // while the server is up would flush its cached store over
  // the travelled file (the local store caches per process).
  travel(sv1, 8); travel(sv2, 8); travel(tv1, 8);
  await reboot();
  admin = await adminClient(); bizC = await login(biz.email);
  silent.client = await login(silent.email); talker.client = await login(talker.email);
  const msg = await talker.client("POST", "/api/messages", { toUserId: biz.id, body: "Running behind, posting this weekend — sorry for the delay." });
  check("the talker messages the business (the existing channel)", msg.status === 201 || msg.status === 200, `${msg.status} ${JSON.stringify(msg.data).slice(0, 150)}`);
  const sweepD = await admin("POST", "/api/admin/compliance/sweep", {});
  check("sweep counted silent strikes and removed at two", sweepD.status === 200 && (sweepD.data.sweep.silentStrikes || 0) >= 2 && (sweepD.data.sweep.silentRemoved || 0) >= 1, JSON.stringify(sweepD.data.sweep));
  const uSilent = await me(silent.client);
  check("two silent no-shows: strike count 2", uSilent.silentStrikes === 2, String(uSilent.silentStrikes));
  check("two strikes = REMOVED (banned, source silent_strikes), not a pause", !!uSilent.standing && uSilent.standing.state === "banned" && uSilent.standing.source === "silent_strikes" && /two silent no-shows/.test(uSilent.standing.reason || ""), JSON.stringify(uSilent.standing));
  const discAfter = await bizC("GET", "/api/discover?market=Hampton%20Roads");
  check("removed creator is out of discovery", !(discAfter.data.creators || []).some((c) => c.userId === silent.id));
  const uTalker = await me(talker.client);
  check("COMMUNICATION WAIVES THE STRIKE: the talker has no silent strike", (uTalker.silentStrikes || 0) === 0, String(uTalker.silentStrikes));
  const rowsD = await admin("GET", "/api/admin/compliance");
  const rowSilent = (rowsD.data.visits || []).find((r) => r.bookingId === sv1);
  const rowTalker = (rowsD.data.visits || []).find((r) => r.bookingId === tv1);
  check("Admin sees the strike outcome on the visit (counted)", !!rowSilent && rowSilent.silentStrike === "counted", JSON.stringify(rowSilent && rowSilent.silentStrike));
  check("Admin sees the waiver on the talker's visit (waived_communicated)", !!rowTalker && rowTalker.silentStrike === "waived_communicated", JSON.stringify(rowTalker && rowTalker.silentStrike));
  check("Admin sees the count + plain removal reason on the creator", !!rowSilent && rowSilent.creatorSilentStrikes === 2 && /two silent no-shows/.test(rowSilent.creatorStandingReason || ""), JSON.stringify(rowSilent && { s: rowSilent.creatorSilentStrikes, r: rowSilent.creatorStandingReason }));
  const reSilent = await admin("POST", "/api/admin/compliance/reinstate", { userId: silent.id });
  check("Admin can reinstate a removed creator", reSilent.status === 200, `${reSilent.status} ${JSON.stringify(reSilent.data).slice(0, 150)}`);
  silent.client = await login(silent.email);
  const uSilent2 = await me(silent.client);
  check("reinstatement from a silent removal = probation at one strike", uSilent2.silentStrikes === 1 && !(uSilent2.standing && uSilent2.standing.state === "banned"), JSON.stringify({ s: uSilent2.silentStrikes, st: uSilent2.standing }));

  // ---------- E: consumed-comp ----------
  part("E: consumed-comp");
  const eater = await registerCreator(); await approve(admin, eater.id);
  const ev1 = await compedVisit(bizC, eater, "Consumed, posted in the month");
  travel(ev1, 8);
  await reboot();
  admin = await adminClient(); bizC = await login(biz.email); eater.client = await login(eater.email);
  await admin("POST", "/api/admin/compliance/sweep", {});
  const uEaterPaused = await me(eater.client);
  check("day-7 pause fires first (before the month is out)", !!uEaterPaused.standing && uEaterPaused.standing.state === "paused", JSON.stringify(uEaterPaused.standing));
  travel(ev1, 20);
  await reboot();
  admin = await adminClient(); bizC = await login(biz.email); eater.client = await login(eater.email);
  const pEater = await postProof(eater.client, ev1, "phasec-extremelylate");
  check("a post inside the month still lands (delivered)", pEater.status === 201, JSON.stringify(pEater.data).slice(0, 200));
  const bkEater = await myBooking(eater.client, ev1);
  check("...and the record says EXTREMELY late", !!bkEater && bkEater.compliance && bkEater.compliance.status === "posted_late" && bkEater.compliance.extremelyLate === true, JSON.stringify(bkEater && bkEater.compliance));
  const uEaterAfter = await me(eater.client);
  check("the extremely-late post resolves the pause (not removed)", !(uEaterAfter.standing && uEaterAfter.standing.state !== "good"), JSON.stringify(uEaterAfter.standing));
  const ghost = await registerCreator(); await approve(admin, ghost.id);
  const gv1 = await compedVisit(bizC, ghost, "Consumed, never posted");
  travel(gv1, 30.5);
  await reboot();
  admin = await adminClient(); bizC = await login(biz.email); ghost.client = await login(ghost.email);
  const sweepE1 = await admin("POST", "/api/admin/compliance/sweep", {});
  const uGhost = await me(ghost.client);
  check("no post one month after consuming the comp: no longer active", !!uGhost.standing && uGhost.standing.state === "banned" && uGhost.standing.source === "consumed_comp", JSON.stringify(uGhost.standing));
  check("the plain reason names the rule", /comp consumed, no post after one month/.test((uGhost.standing || {}).reason || "") && /no longer active/.test((uGhost.standing || {}).reason || ""), String((uGhost.standing || {}).reason));
  check("the sweep reports the inactivation once", (sweepE1.data.sweep.inactivated || 0) === 1, JSON.stringify(sweepE1.data.sweep));
  const sweepE2 = await admin("POST", "/api/admin/compliance/sweep", {});
  check("idempotent: a second sweep inactivates nobody new", (sweepE2.data.sweep.inactivated || 0) === 0, JSON.stringify(sweepE2.data.sweep));
  const rowsE = await admin("GET", "/api/admin/compliance");
  const rowGhost = (rowsE.data.visits || []).find((r) => r.bookingId === gv1);
  check("Admin sees the consumed-comp reason plainly", !!rowGhost && rowGhost.creatorStandingSource === "consumed_comp" && /no longer active/.test(rowGhost.creatorStandingReason || ""), JSON.stringify(rowGhost && rowGhost.creatorStandingReason));
  const reGhost = await admin("POST", "/api/admin/compliance/reinstate", { userId: ghost.id });
  check("Admin reinstatement path exists for the consumed-comp state", reGhost.status === 200, `${reGhost.status}`);

  await stopServer();
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
  try { await stopServer(); } catch (e) { /* ignore */ }
}

console.log(`\nverify-build112: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
