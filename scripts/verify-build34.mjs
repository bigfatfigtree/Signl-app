#!/usr/bin/env node
// BUILD 2026.10.29-34 verification (The Receipt, ROI stack):
//   M1: a code-use carrying a check total becomes a time-stamped
//       redemption EVENT (one customer at a time); the receipt
//       sums events, with the reported tally as the labeled
//       fallback for bookings that never used events.
//   M2: a validated first redemption with a real amount issues
//       a Came-Back Pass (BACK- code, 30 days); redeeming it
//       with a return amount records the return against the
//       original visit; single use; unknown codes 404; the
//       return RATE stays hidden below 5 counted first visits;
//       Admin sees rates against the market median.
//   M3: mentions count apart and never enter register money.
//   M4: the baseline from founding setup (register or PATCH)
//       feeds the receipt; visit-night counts line up against it.
//   M5: Google numbers store under the month and ride the receipt
//       under their own label.
//   M6: the receipt assembles floors only: at-least spend,
//       customers, came-backs, who-brought-them, cost + ROAS.
//   M7: the proof card mints from the same events; per-business
//       lines are category + city until the business opts in to
//       be named; the public book-me payload carries aggregates.
// Run: node scripts/verify-build34.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8944;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = ["build34", "admin", "pass"].join("-");
const DB = path.join(os.tmpdir(), `signl-verify-build34-${Date.now()}.json`);
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
async function makeBusiness(admin, { name, businessName, email, extra = {} }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "business", name, businessName, email, password: "business-pass-123", market: "Richmond", city: "Richmond",
    category: "Restaurant", planId: "growth", agreedTerms: true, ...extra,
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

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const anon = client();
  await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });

  const rita = await makeCreator(admin, { name: "Receipt Rita", email: "rita@fixtures.dev", handle: "receiptrita" });
  const kitchen = await makeBusiness(admin, { name: "Kim Owner", businessName: "Receipt Kitchen", email: "kim@fixtures.dev", extra: { baselineDay: "Tuesday", baselineCount: 40 } });

  // ---------- M4: baseline lands from the application ----------
  check("baseline: the founding application stores the usual-night number",
    kitchen.user.business.baseline && kitchen.user.business.baseline.dayLabel === "Tuesday" && kitchen.user.business.baseline.count === 40,
    JSON.stringify(kitchen.user.business.baseline || null));

  // ---------- M6 pre-data: honest empty receipt ----------
  const pre = await kitchen.client("GET", "/api/me/receipt");
  check("receipt: pre-data renders plan + baseline and zero counted money",
    pre.status === 200 && pre.data.receipt.trackedSpend === 0 && pre.data.receipt.customersCounted === 0 && (pre.data.receipt.ledger || []).length === 0 && pre.data.receipt.cost.planPrice === 349 && pre.data.receipt.baseline.usual === 40,
    JSON.stringify(pre.data.receipt || {}).slice(0, 300));

  const booking = await makeBooking(kitchen, rita, "Receipt Night");

  // ---------- M1: event capture ----------
  const legacy = await kitchen.client("POST", `/api/bookings/${booking.id}/code-uses`, { count: 1 });
  check("M1: a code use without a total stays the legacy counter (no event, no pass)",
    legacy.status === 200 && !legacy.data.redemptionEvent && !legacy.data.issuedPass, JSON.stringify(legacy.data).slice(0, 200));
  const batch = await kitchen.client("POST", `/api/bookings/${booking.id}/code-uses`, { count: 3, amount: 30 });
  check("M1: a total with a batch count is refused (one customer at a time)", batch.status === 400, JSON.stringify(batch.data).slice(0, 160));
  const ev1 = await kitchen.client("POST", `/api/bookings/${booking.id}/code-uses`, { count: 1, amount: 62.5 });
  check("M1+M2: a first redemption with a total creates the event and issues a BACK- pass",
    ev1.status === 201 && ev1.data.redemptionEvent && ev1.data.redemptionEvent.kind === "first" && ev1.data.redemptionEvent.amount === 62.5 && ev1.data.issuedPass && /^BACK-/.test(ev1.data.issuedPass.code),
    JSON.stringify(ev1.data).slice(0, 300));
  const passCode = ev1.data.issuedPass.code;
  const daysOut = (Date.parse(ev1.data.issuedPass.expiresAt) - Date.now()) / 86400000;
  check("M2: the pass window is 30 days", daysOut > 29 && daysOut <= 30.1, String(daysOut));
  const evZero = await kitchen.client("POST", `/api/bookings/${booking.id}/code-uses`, { count: 1, amount: 0 });
  check("M2: a zero-total redemption counts the customer but issues no pass (no register amount)",
    evZero.status === 201 && evZero.data.issuedPass === null, JSON.stringify(evZero.data).slice(0, 200));
  const ev2 = await kitchen.client("POST", `/api/bookings/${booking.id}/code-uses`, { count: 1, amount: 40 });
  check("M1: a second event lands with its own pass", ev2.status === 201 && !!ev2.data.issuedPass, JSON.stringify(ev2.data).slice(0, 160));

  // ---------- M2: redemption ----------
  const noAmount = await kitchen.client("POST", "/api/me/passes/redeem", { code: passCode, amount: 0 });
  check("M2: a return without a register amount never counts", noAmount.status === 400, JSON.stringify(noAmount.data).slice(0, 120));
  const unknown = await kitchen.client("POST", "/api/me/passes/redeem", { code: "BACK-ZZZZZZ", amount: 20 });
  check("M2: an unknown pass code reads 404", unknown.status === 404, JSON.stringify(unknown.data).slice(0, 120));
  const ret = await kitchen.client("POST", "/api/me/passes/redeem", { code: passCode, amount: 55 });
  check("M2: redeeming the pass records the return against the original visit",
    ret.status === 200 && ret.data.pass.status === "redeemed" && ret.data.redemptionEvent.kind === "return" && ret.data.redemptionEvent.bookingId === booking.id && ret.data.redemptionEvent.creatorId === rita.id,
    JSON.stringify(ret.data).slice(0, 300));
  const again = await kitchen.client("POST", "/api/me/passes/redeem", { code: passCode, amount: 55 });
  check("M2: a pass is single use", again.status === 400, JSON.stringify(again.data).slice(0, 120));
  const creatorRedeem = await rita.client("POST", "/api/me/passes/redeem", { code: ev2.data.issuedPass.code, amount: 10 });
  check("M2: creators cannot redeem passes", creatorRedeem.status === 403, JSON.stringify(creatorRedeem.data).slice(0, 120));

  // ---------- M3: mentions ----------
  const m1 = await kitchen.client("POST", "/api/me/mentions", { bookingId: booking.id });
  const m2 = await kitchen.client("POST", "/api/me/mentions", { bookingId: booking.id });
  check("M3: mentions count per booking, apart from money",
    m1.status === 201 && m1.data.bookingMentions === 1 && m2.data.bookingMentions === 2, JSON.stringify(m2.data).slice(0, 160));
  const mCreator = await rita.client("POST", "/api/me/mentions", { bookingId: booking.id });
  check("M3: creators cannot count mentions", mCreator.status === 403, JSON.stringify(mCreator.data).slice(0, 120));

  // ---------- M4: night count ----------
  const night = await kitchen.client("POST", `/api/bookings/${booking.id}/night-count`, { count: 52 });
  check("M4: the visit-night count saves on the booking",
    night.status === 200 && night.data.booking.nightCount.count === 52, JSON.stringify(night.data.booking && night.data.booking.nightCount));

  // ---------- M5: Google numbers ----------
  const gPatch = await kitchen.client("PATCH", "/api/me/profile", { googleStats: { searches: 900, directions: 120, calls: 30, reviews: 4 } });
  check("M5: Google numbers save on the business record",
    gPatch.status === 200 && Object.values(gPatch.data.user.business.googleStats || {})[0].searches === 900,
    JSON.stringify(gPatch.data.user.business.googleStats || null));

  // ---------- M6: the receipt ----------
  const r1 = await kitchen.client("GET", "/api/me/receipt");
  const rc = r1.data.receipt;
  check("M6: tracked spend is the sum of first-redemption events (62.50 + 0 + 40)",
    rc.trackedSpend === 102.5 && rc.customersCounted === 3, JSON.stringify({ spend: rc.trackedSpend, customers: rc.customersCounted }));
  check("M6: came-backs ride their own block; the rate stays hidden below the base of 5",
    rc.cameBack.returns === 1 && rc.cameBack.returnSpend === 55 && rc.cameBack.firstVisits === 3 && rc.cameBack.rate === null,
    JSON.stringify(rc.cameBack));
  const row = (rc.ledger || [])[0] || {};
  check("M6: the ledger row carries customers, spend, returns, mentions, and the night count",
    row.customers === 3 && row.spend === 102.5 && row.returns === 1 && row.mentions === 2 && row.nightCount === 52 && row.source === "events",
    JSON.stringify(row));
  check("M6: the baseline line compares visit nights against the usual night",
    rc.baseline.usual === 40 && rc.baseline.visitAvg === 52 && rc.baseline.visitNights === 1, JSON.stringify(rc.baseline));
  check("M6: who-brought-them and top creators name the creator",
    (rc.whoBrought || [])[0].creatorHandle === "receiptrita" && (rc.topCreators || [])[0].creatorHandle === "receiptrita",
    JSON.stringify(rc.whoBrought).slice(0, 200));
  check("M5: the receipt carries the Google strip for the current month",
    rc.google.current && rc.google.current.searches === 900 && rc.google.current.directions === 120, JSON.stringify(rc.google));
  check("M6: mentions total rides the receipt on its own line",
    rc.mentions.month === 2 && rc.mentions.total === 2, JSON.stringify(rc.mentions));

  // Two more firsts: the base reaches 5 and the rate prints.
  await kitchen.client("POST", `/api/bookings/${booking.id}/code-uses`, { count: 1, amount: 10 });
  await kitchen.client("POST", `/api/bookings/${booking.id}/code-uses`, { count: 1, amount: 10 });
  const r2 = await kitchen.client("GET", "/api/me/receipt");
  check("M2: at 5 counted first visits the return rate prints (1 of 5)",
    r2.data.receipt.cameBack.firstVisits === 5 && r2.data.receipt.cameBack.rate === 0.2, JSON.stringify(r2.data.receipt.cameBack));

  // ---------- Admin distribution ----------
  // Build -46: GET /api/admin/return-rates was deleted as a dead
  // endpoint (no UI consumer; came-back data reaches the product
  // through the Receipt and performance payloads, asserted above).
  // The pin now proves it is gone, not that it answers.
  const rates = await admin("GET", "/api/admin/return-rates");
  check("M2 guard: the dead return-rates endpoint is gone (404)",
    rates.status === 404, `status=${rates.status}`);

  // ---------- M7: proof ----------
  const proof = await rita.client("GET", "/api/me/proof-card");
  const pf = proof.data.proof;
  check("M7: the proof card mints from the same counted events",
    pf.customersCounted === 5 && pf.cameBacks === 1 && pf.trackedSpend === 122.5 && pf.mentions === 2 && pf.verified === true,
    JSON.stringify(pf).slice(0, 300));
  check("M7: the per-business line is anonymized (category + city) by default and carries no spend",
    (pf.lines || []).length === 1 && pf.lines[0].label === "Restaurant in Richmond" && pf.lines[0].named === false && !("spend" in pf.lines[0]),
    JSON.stringify(pf.lines));
  await kitchen.client("PATCH", "/api/me/profile", { proofNameOptIn: true });
  const proof2 = await rita.client("GET", "/api/me/proof-card");
  check("M7: the business's opt-in names it on the proof card",
    (proof2.data.proof.lines || [])[0].label === "Receipt Kitchen" && proof2.data.proof.lines[0].named === true,
    JSON.stringify(proof2.data.proof.lines));
  const pubPage = await anon("GET", "/api/c/receiptrita");
  check("M7: the public book-me payload carries the aggregate proof, no business named",
    pubPage.status === 200 && pubPage.data.profile.proof.customersCounted === 5 && pubPage.data.profile.proof.trackedSpend === 122.5 && !JSON.stringify(pubPage.data.profile.proof).includes("Receipt Kitchen"),
    JSON.stringify(pubPage.data.profile && pubPage.data.profile.proof));

  // ---------- Tally fallback (second pair) ----------
  const tally = await makeCreator(admin, { name: "Tally Tara", email: "tara@fixtures.dev", handle: "tallytara" });
  const diner = await makeBusiness(admin, { name: "Dan Owner", businessName: "Tally Diner", email: "dan@fixtures.dev" });
  const booking2 = await makeBooking(diner, tally, "Tally Night");
  const tallyRep = await diner.client("POST", `/api/bookings/${booking2.id}/code-redemptions`, { count: 4, basketTotal: 200 });
  check("setup: the legacy tally still reports", tallyRep.status === 200, JSON.stringify(tallyRep.data).slice(0, 160));
  const r3 = await diner.client("GET", "/api/me/receipt");
  const row3 = (r3.data.receipt.ledger || [])[0] || {};
  check("M1: a booking with no events reads its reported tally, labeled as the tally",
    r3.data.receipt.trackedSpend === 200 && r3.data.receipt.customersCounted === 4 && row3.source === "tally",
    JSON.stringify(r3.data.receipt).slice(0, 300));
  const proofTally = await tally.client("GET", "/api/me/proof-card");
  check("M7: tally bookings mint proof too (the fallback is one system)",
    proofTally.data.proof.customersCounted === 4 && proofTally.data.proof.trackedSpend === 200, JSON.stringify(proofTally.data.proof).slice(0, 200));

  // ---------- source contracts ----------
  const appSrc = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const srcChecks = [
    ["client: the receipt screen ships with the at-least sentence + counted-how line", appSrc.includes("What SIGNL brought you") && appSrc.includes("Counted how:")],
    ["client: the counter shows the issued come-back pass on the spot", appSrc.includes("Come-back pass for this customer:")],
    ["client: mentions are labeled a told-us count that never mixes into money", appSrc.includes("never mixes into register money") || appSrc.includes("never mix into register money")],
    ["client: the Google strip is labeled Google's numbers, not ours", appSrc.includes("Google's numbers, not ours")],
    ["client: the proof card carries the Verified seal + the receipt closing line", appSrc.includes("Verified on SIGNL") && appSrc.includes("Book me on SIGNL and this is the receipt you'll get.")],
    ["client: the Book button prefills from top performers", appSrc.includes("Book next month's creators") && appSrc.includes("receiptBookTop")],
    ["client: no caused/generated claim language in the receipt renderer", (() => { const body = appSrc.slice(appSrc.indexOf("function receiptHtml"), appSrc.indexOf("function proofSectionHtml")); return !/caused|generated|drove/.test(body) && body.includes("line says came back"); })()],
  ];
  for (const [name, ok] of srcChecks) check(name, ok);

  console.log(`\nverify-build34: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
} catch (e) {
  console.error("verify-build34 crashed:", e);
  process.exitCode = 1;
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
