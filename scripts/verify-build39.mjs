#!/usr/bin/env node
// BUILD 2026.10.30-39 verification (ROAS Score v2):
//   - Comp-cost capture at close-out: confirmed entries only,
//     zero needs the explicit confirmation, creators refused,
//     paid visits refused, uncompleted visits refused, and the
//     entry stops being editable once the tally month closes.
//   - Score v2: register-events-only numerator (media value
//     rides its own line and cannot move the score), reported
//     tallies are tagged facts that never enter the number
//     (a tally-only month stays Forming), all-in denominator
//     (plan at the amount actually charged with the founding
//     credit itemized, comp costs, paid rate + fee share,
//     discount cost on the full pre-discount check), cohort
//     basis with Forming / Still counting / Final states, and
//     per-visit + per-creator scores labeled before the plan.
//   - Proof Card: counts + window-closed came-back rate only;
//     no score anywhere in the payload; the single-business
//     forming gate withholds public aggregates; a business
//     with sharing off leaves no line.
//   - Event corrections: logged on the event, totals recompute,
//     closed months refuse.
//   - Proof Controls: comp-cost defaults store, the Came-Back
//     Pass switch stops issuance, capture-gap diagnostic fires.
// Run: node scripts/verify-build39.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8947;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = ["build39", "admin", "pass"].join("-");
const DB = path.join(os.tmpdir(), `signl-verify-build39-${Date.now()}.json`);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  async function call(method, p, body, headers) {
    const h = { ...(headers || {}) };
    if (body && typeof body === "object") h["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers: h, body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, data, headers: res.headers };
  }
  return call;
}

let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function makeCreator(admin, { name, email, handle }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle, followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"],
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await c("PATCH", "/api/me/profile", { publicPage: true });
  return { client: c, id: reg.data.user.id, handle, user: reg.data.user };
}
async function makeBusiness(admin, { name, businessName, email, planId = "growth", extra = {} }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "business", name, businessName, email, password: "business-pass-123", market: "Richmond", city: "Richmond",
    category: "Restaurant", planId, agreedTerms: true, ...extra,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: reg.data.user.id });
  return { client: c, id: reg.data.user.id, user: reg.data.user };
}
async function makeBooking(biz, creator, title) {
  const off = await biz.client("POST", "/api/offers", { title, whatComped: "Dinner for two", dollarCap: 60, spots: 1, includesAlcohol: false, creatorId: creator.id });
  if (off.status !== 201) throw new Error(`offer failed: ${JSON.stringify(off.data)}`);
  const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
  if (acc.status !== 201) throw new Error(`accept failed: ${JSON.stringify(acc.data)}`);
  await biz.client("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
  return acc.data.booking;
}
async function completeVisit(creator, booking, slug) {
  const post = await creator.client("POST", "/api/posts", { bookingId: booking.id, url: `https://www.instagram.com/p/${slug}/`, includesDisclosure: true });
  if (post.status !== 201) throw new Error(`post failed: ${JSON.stringify(post.data)}`);
  return post.data.post;
}
async function logFirst(biz, bookingId, amount) {
  const r = await biz.client("POST", `/api/bookings/${bookingId}/code-uses`, { count: 1, amount });
  if (r.status !== 201) throw new Error(`code-use failed: ${JSON.stringify(r.data)}`);
  return r.data;
}

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const anon = client();
  await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });

  const amy = await makeCreator(admin, { name: "Score Amy", email: "amy@fixtures.dev", handle: "scoreamy" });
  const ben = await makeCreator(admin, { name: "Score Ben", email: "ben@fixtures.dev", handle: "scoreben" });
  const kitchen = await makeBusiness(admin, { name: "Kai Owner", businessName: "Score Kitchen", email: "kai@fixtures.dev" });

  // ---------- comp-cost capture: the guards ----------
  const openBooking = await makeBooking(kitchen, amy, "Not Yet Posted");
  const tooEarly = await kitchen.client("POST", `/api/bookings/${openBooking.id}/comp-cost`, { amount: 20 });
  check("comp cost: an uncompleted visit refuses the capture (it lands at close-out)", tooEarly.status === 400, JSON.stringify(tooEarly.data).slice(0, 160));

  // Visit 1 (Amy): the business's 10% code discount is on when
  // the booking is made, so the booking carries the stamp; the
  // setting comes off again before visits 2 and 3 are booked.
  await kitchen.client("PATCH", "/api/me/profile", { discountEnabled: true, discountPct: 10 });
  const bk1 = await makeBooking(kitchen, amy, "Score Night One");
  await kitchen.client("PATCH", "/api/me/profile", { discountEnabled: false });
  const post1 = await completeVisit(amy, bk1, "V39ONE");
  const byCreator = await amy.client("POST", `/api/bookings/${bk1.id}/comp-cost`, { amount: 30 });
  check("comp cost: creators never state a business's cost", byCreator.status === 403, JSON.stringify(byCreator.data).slice(0, 120));
  const zeroNoConfirm = await kitchen.client("POST", `/api/bookings/${bk1.id}/comp-cost`, { amount: 0 });
  check("comp cost: a bare zero is missing, not free (needs the confirmation)", zeroNoConfirm.status === 400, JSON.stringify(zeroNoConfirm.data).slice(0, 120));

  // Events on visit 1: 4 firsts at $90, one came back at $45.
  const f1 = await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  const ret1 = await kitchen.client("POST", "/api/me/passes/redeem", { code: f1.issuedPass.code, amount: 45 });
  check("setup: the came-back lands on visit 1", ret1.status === 200, JSON.stringify(ret1.data).slice(0, 160));
  await amy.client("POST", `/api/bookings/${bk1.id}/performance`, { views: 10000, likes: 100, comments: 10, shares: 5 });

  // Forming: no comp cost yet (and thin counts) -> no score.
  const rForm = await kitchen.client("GET", "/api/me/receipt");
  const form = rForm.data.receipt.scoreV2.current;
  check("forming: no score prints before the minimums and the cost",
    form.state === "forming" && form.score === null && form.formingReasons.some((x) => x.kind === "comp_cost"),
    JSON.stringify(form.formingReasons));

  const cc1 = await kitchen.client("POST", `/api/bookings/${bk1.id}/comp-cost`, { amount: 30 });
  check("comp cost: the close-out capture stores the confirmed entry",
    cc1.status === 200 && cc1.data.compCostEntry && cc1.data.compCostEntry.amount === 30 && cc1.data.compCostEntry.confirmedZero === false,
    JSON.stringify(cc1.data).slice(0, 200));

  // Visit 2 (Amy) and visit 3 (Ben, confirmed zero).
  const bk2 = await makeBooking(kitchen, amy, "Score Night Two");
  await completeVisit(amy, bk2, "V39TWO");
  await logFirst(kitchen, bk2.id, 50);
  await logFirst(kitchen, bk2.id, 50);
  await logFirst(kitchen, bk2.id, 50);
  await kitchen.client("POST", `/api/bookings/${bk2.id}/comp-cost`, { amount: 25 });
  const bk3 = await makeBooking(kitchen, ben, "Score Night Three");
  await completeVisit(ben, bk3, "V39THREE");
  await logFirst(kitchen, bk3.id, 20);
  await logFirst(kitchen, bk3.id, 20);
  await logFirst(kitchen, bk3.id, 20);
  const cc3 = await kitchen.client("POST", `/api/bookings/${bk3.id}/comp-cost`, { confirmedZero: true });
  check("comp cost: the confirmed-zero state stores as a real zero",
    cc3.status === 200 && cc3.data.compCostEntry.amount === 0 && cc3.data.compCostEntry.confirmedZero === true,
    JSON.stringify(cc3.data).slice(0, 200));

  // ---------- Score v2: the full cohort ----------
  const r1 = await kitchen.client("GET", "/api/me/receipt");
  const rc = r1.data.receipt;
  const cur = rc.scoreV2.current;
  check("v2: the cohort counts register events only (615 back, 10 customers, 11 events)",
    cur.countedBack === 615 && cur.countedCustomers === 10 && cur.countedEvents === 11,
    JSON.stringify({ back: cur.countedBack, customers: cur.countedCustomers, events: cur.countedEvents }));
  check("v2: media value rides its own line (240 modeled) and cannot move the score",
    cur.media.value === 240 && cur.score === 1.8 && cur.media.withPostsValued === 2.5,
    JSON.stringify({ media: cur.media.value, score: cur.score, wpv: cur.media.withPostsValued }));
  check("v2: the denominator is all-in (plan 249 after the itemized 100 credit, direct 95, total 344)",
    cur.cost.plan === 249 && cur.cost.planCredit === 100 && cur.cost.compCosts === 55 && cur.cost.discountCosts === 40 && cur.cost.directCosts === 95 && cur.cost.total === 344,
    JSON.stringify(cur.cost));
  check("v2: discount cost is figured on the full pre-discount check (360 rung at 10% costs 40)",
    cur.cost.discountCosts === 40, JSON.stringify(cur.cost));
  check("v2: the cohort is still counting while came-back windows run, and prints its sentence",
    cur.state === "counting" && /For every \$1 you put in, at least \$1\.80 came back/.test(cur.sentence || ""),
    JSON.stringify({ state: cur.state, sentence: cur.sentence }));
  check("v2: came-backs ride the cohort block (1 return, 45 back, rate waits for closed windows)",
    cur.cameBack.returns === 1 && cur.cameBack.returnSpend === 45 && cur.cameBack.closedFirsts === 1 && cur.cameBack.stillInWindow === 9 && cur.cameBack.rate === null,
    JSON.stringify(cur.cameBack));
  const v1row = cur.visits.find((v) => v.bookingId === bk1.id);
  const v3row = cur.visits.find((v) => v.bookingId === bk3.id);
  check("v2: per-visit scores use direct costs only (visit 1 at 5.8x, before the plan)",
    v1row && v1row.score === 5.8 && /before your plan/.test(v1row.methodLine) && v3row && v3row.score === null && v3row.costState === "confirmed_zero" && v3row.state === "no_cost",
    JSON.stringify({ v1: v1row && v1row.score, v3: v3row && v3row.state, v3cost: v3row && v3row.costState }));
  const amyRow = cur.creators.find((w) => w.creatorId === amy.id);
  check("v2: per-creator score aggregates the same way for everyone (Amy 555 over 95 = 5.8x)",
    amyRow && amyRow.score === 5.8 && amyRow.customers === 7 && amyRow.cameBacks === 1,
    JSON.stringify(amyRow));
  check("v2: the legacy calendar line still sums the month's first visits (trackedSpend 570; returns ride the came-back line) and the version line prints",
    rc.trackedSpend === 570 && /Score v2/.test(cur.versionLine) && cur.calendarCounted === 570,
    JSON.stringify({ ts: rc.trackedSpend, cal: cur.calendarCounted }));

  // ---------- Proof Controls: defaults + the pass switch ----
  const ctl = await kitchen.client("PATCH", "/api/me/profile", { compCostDefaults: { default: 30, byCategory: { "Food & Drink": 45 } } });
  check("controls: comp-cost defaults store (global plus per-category)",
    ctl.status === 200 && ctl.data.user.business.compCostDefaults.default === 30 && ctl.data.user.business.compCostDefaults.byCategory["Food & Drink"] === 45,
    JSON.stringify(ctl.data.user && ctl.data.user.business.compCostDefaults));

  // ---------- Event corrections recompute the number --------
  const evList = await kitchen.client("GET", `/api/bookings/${bk2.id}/events`);
  const evs = evList.data.events || [];
  check("events: the owner reads the booking's register trail", evList.status === 200 && evs.length === 3 && evs.every((e) => e.correctable), JSON.stringify(evList.data).slice(0, 200));
  const target = evs[0];
  const fix = await kitchen.client("POST", `/api/me/redeem-events/${target.id}/correct`, { amount: 5 });
  check("corrections: a mistyped total is correctable inside the window, logged on the event",
    fix.status === 200 && fix.data.redemptionEvent.amount === 5 && (fix.data.redemptionEvent.corrections || []).length === 1 && fix.data.redemptionEvent.corrections[0].oldAmount === 50,
    JSON.stringify(fix.data).slice(0, 240));
  const creatorFix = await amy.client("POST", `/api/me/redeem-events/${evs[1].id}/correct`, { amount: 5 });
  check("corrections: creators cannot correct a business's register", creatorFix.status === 403, JSON.stringify(creatorFix.data).slice(0, 120));
  const voided = await kitchen.client("POST", `/api/me/redeem-events/${evs[1].id}/correct`, { void: true });
  check("corrections: voiding keeps the record and drops the money", voided.status === 200 && voided.data.redemptionEvent.voided === true, JSON.stringify(voided.data).slice(0, 160));
  const r2 = await kitchen.client("GET", "/api/me/receipt");
  check("corrections: totals recompute from the trail (615 -> 520, score 1.8 -> 1.5)",
    r2.data.receipt.scoreV2.current.countedBack === 520 && r2.data.receipt.scoreV2.current.score === 1.5 && r2.data.receipt.scoreV2.current.countedEvents === 10,
    JSON.stringify({ back: r2.data.receipt.scoreV2.current.countedBack, score: r2.data.receipt.scoreV2.current.score }));

  // ---------- Capture gap + pass switch (separate business) --
  const gwen = await makeCreator(admin, { name: "Gap Gwen", email: "gwen@fixtures.dev", handle: "gapgwen" });
  const grill = await makeBusiness(admin, { name: "Gus Owner", businessName: "Gap Grill", email: "gus@fixtures.dev" });
  const bkG = await makeBooking(grill, gwen, "Gap Night");
  await completeVisit(gwen, bkG, "V39GAP");
  await gwen.client("POST", `/api/bookings/${bkG.id}/performance`, { views: 12000, likes: 300, comments: 20, shares: 9 });
  await logFirst(grill, bkG.id, 15);
  await logFirst(grill, bkG.id, 15);
  const home = await grill.client("GET", "/api/me/business-home");
  check("capture gap: wide reported reach with thin counting names the state, with real counts",
    home.data.home.captureGap && home.data.home.captureGap.state === "thin" && home.data.home.captureGap.reach === 12000 && home.data.home.captureGap.countedFirsts === 2,
    JSON.stringify(home.data.home && home.data.home.captureGap));
  await grill.client("PATCH", "/api/me/profile", { comeBackPassEnabled: false });
  const noPass = await grill.client("POST", `/api/bookings/${bkG.id}/code-uses`, { count: 1, amount: 15 });
  check("controls: the Came-Back Pass switch is real (off means no pass is issued)",
    noPass.status === 201 && noPass.data.issuedPass === null, JSON.stringify(noPass.data).slice(0, 200));
  await grill.client("PATCH", "/api/me/profile", { comeBackPassEnabled: true });
  const withPass = await grill.client("POST", `/api/bookings/${bkG.id}/code-uses`, { count: 1, amount: 15 });
  check("controls: the switch back on restores issuance", withPass.status === 201 && !!withPass.data.issuedPass, JSON.stringify(withPass.data).slice(0, 160));

  // ---------- Tally-only month: facts, never the number -----
  const tara = await makeCreator(admin, { name: "Tally Tara", email: "tara39@fixtures.dev", handle: "tallytara39" });
  const diner = await makeBusiness(admin, { name: "Dan Owner", businessName: "Tally Diner 39", email: "dan39@fixtures.dev" });
  const bkT = await makeBooking(diner, tara, "Tally Night 39");
  await completeVisit(tara, bkT, "V39TALLY");
  await diner.client("POST", `/api/bookings/${bkT.id}/code-redemptions`, { count: 4, basketTotal: 200 });
  const rT = await diner.client("GET", "/api/me/receipt");
  const curT = rT.data.receipt.scoreV2.current;
  check("tally: a tally-only month stays Forming, the tally rides as a tagged fact, the score stays null",
    curT.state === "forming" && curT.score === null && curT.formingReasons.some((x) => x.kind === "tally_only") && curT.tallyFacts && curT.tallyFacts.spend === 200 && curT.tallyFacts.customers === 4 && rT.data.receipt.trackedSpend === 200,
    JSON.stringify({ reasons: curT.formingReasons, tally: curT.tallyFacts }));

  // ---------- Proof gates (single-business pair) -------------
  const sue = await makeCreator(admin, { name: "Proof Sue", email: "sue@fixtures.dev", handle: "proofsue" });
  const shop = await makeBusiness(admin, { name: "Sal Owner", businessName: "Proof Shop", email: "sal@fixtures.dev", planId: "self-service" });
  const bkS = await makeBooking(shop, sue, "Proof Night");
  await completeVisit(sue, bkS, "V39PROOF");
  await logFirst(shop, bkS.id, 10);
  await logFirst(shop, bkS.id, 10);
  await logFirst(shop, bkS.id, 10);
  const proofS = await sue.client("GET", "/api/me/proof-card");
  const pfS = proofS.data.proof;
  check("proof: the card carries counts and no score, ever",
    pfS.customersCounted === 3 && !("score" in pfS) && !("roas" in pfS) && !("roasScore" in pfS) && pfS.cameBackRate === null,
    JSON.stringify(pfS).slice(0, 300));
  check("proof: below the base at a single business, the lines sit in forming",
    pfS.countsForming === true && pfS.singleBusiness === true && (pfS.lines || []).length === 1,
    JSON.stringify({ forming: pfS.countsForming, lines: (pfS.lines || []).length }));
  const pubS = await anon("GET", `/api/c/${sue.handle}`);
  check("proof: the public page withholds the aggregates while forming (the aggregate IS the business's line)",
    pubS.data.profile.proof.customersCounted === null && pubS.data.profile.proof.trackedSpend === null && pubS.data.profile.proof.countsForming === true,
    JSON.stringify(pubS.data.profile && pubS.data.profile.proof).slice(0, 240));
  await shop.client("PATCH", "/api/me/profile", { proofSharing: false });
  const proofS2 = await sue.client("GET", "/api/me/proof-card");
  check("controls: sharing off removes the business's line from the card (the creator's own totals stand)",
    (proofS2.data.proof.lines || []).length === 0 && proofS2.data.proof.customersCounted === 3,
    JSON.stringify(proofS2.data.proof.lines));
  const pubS2 = await anon("GET", `/api/c/${sue.handle}`);
  check("controls: sharing off takes the business out of the public aggregates",
    pubS2.data.profile.proof.customersCounted === 0 && pubS2.data.profile.proof.trackedSpend === 0,
    JSON.stringify(pubS2.data.profile && pubS2.data.profile.proof).slice(0, 200));

  // ---------- Time travel: maturity, closed windows ---------
  await stopServer();
  // 75 days back: the cohort lands two months ago, so its
  // came-back windows AND its tally month (open 30 days past
  // month end) are both fully closed.
  const SHIFT = 75 * 86400000;
  const shiftIso = (iso) => (iso ? new Date(Date.parse(iso) - SHIFT).toISOString() : iso);
  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  for (const [key, rec] of Object.entries(db)) {
    if (!rec || typeof rec !== "object") continue;
    if ((key.startsWith("booking:") || key.startsWith("post:") || key.startsWith("redevent:") || key.startsWith("pass:")) && rec.businessId === kitchen.id) {
      for (const f of ["updatedAt", "createdAt", "submittedAt", "reportedAt", "at", "issuedAt", "expiresAt", "redeemedAt"]) if (rec[f]) rec[f] = shiftIso(rec[f]);
    }
    if (key === `user:${kitchen.id}` && rec.business) rec.business.activatedAt = shiftIso(rec.business.activatedAt);
  }
  fs.writeFileSync(DB, JSON.stringify(db));
  startServer();
  check("dev server restarts on the shifted record", await waitUp());
  const shiftedMonth = new Date(Date.now() - SHIFT).toISOString().slice(0, 7);
  const rOld = await kitchen.client("GET", "/api/me/receipt");
  const oldCohort = (rOld.data.receipt.scoreV2.cohorts || []).find((c) => c.month === shiftedMonth);
  check("maturity: last month's cohort is final once its windows close (score 1.5 stands)",
    !!oldCohort && oldCohort.state === "final" && oldCohort.score === 1.5,
    JSON.stringify(rOld.data.receipt.scoreV2.cohorts));
  const proofAmy = await amy.client("GET", "/api/me/proof-card");
  check("proof: with windows closed, the came-back rate prints on closed firsts only (1 of 7)",
    proofAmy.data.proof.cameBackRate === 0.14 && proofAmy.data.proof.cameBackClosedFirsts === 7 && proofAmy.data.proof.cameBackStillInWindow === 0,
    JSON.stringify({ rate: proofAmy.data.proof.cameBackRate, closed: proofAmy.data.proof.cameBackClosedFirsts }));
  const evOld = await kitchen.client("GET", `/api/bookings/${bk2.id}/events`);
  const oldEv = (evOld.data.events || [])[0];
  const lateFix = await kitchen.client("POST", `/api/me/redeem-events/${oldEv.id}/correct`, { amount: 9 });
  check("corrections: a closed month's books refuse edits", lateFix.status === 400, JSON.stringify(lateFix.data).slice(0, 140));
  const lateCost = await kitchen.client("POST", `/api/bookings/${bk1.id}/comp-cost`, { amount: 31 });
  check("comp cost: a closed month's cost stands", lateCost.status === 400, JSON.stringify(lateCost.data).slice(0, 140));

  // ---------- source contracts ----------
  const appSrc = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const srcChecks = [
    ["client: the score prints with its sentence", appSrc.includes("SIGNL ROAS Score:") && appSrc.includes("counted dollar by dollar")],
    ["client: the forming state names what is missing", appSrc.includes("Your score starts when there is enough counted to mean something")],
    ["client: the counter script card ships in the close-out packet and the founding setup", (appSrc.match(/First time in\? How'd you hear about us\?/g) || []).length >= 2],
    ["client: proof controls ship wired (defaults, discount, pass, sharing)", appSrc.includes("receiptSaveControls") && appSrc.includes("compCostDefaults") && appSrc.includes("comeBackPassEnabled") && appSrc.includes("proofSharing")],
    ["client: no copy claims a competitor cannot copy anything", !/can(not|'t) copy/i.test(appSrc)],
    ["client: no caused or generated claim language in the score block", (() => { const body = appSrc.slice(appSrc.indexOf("function scoreV2Html"), appSrc.indexOf("function receiptHtml")); return !/caused|generated/.test(body); })()],
  ];
  for (const [name, ok] of srcChecks) check(name, ok);

  console.log(`\nverify-build39: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
} catch (e) {
  console.error("verify-build39 crashed:", e);
  process.exitCode = 1;
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
