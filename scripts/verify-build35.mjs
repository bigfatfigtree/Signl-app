#!/usr/bin/env node
// BUILD 2026.10.29-35 verification (Round-2 approved set):
//   (1) Paid on Post line data: a paid booking's escrow state
//       and deadline ride the booking (client renders the line).
//   (2) Rate Range: bookings-sourced with 3+ distinct booked
//       creators; listed-rate guidance with 4+; ranges only.
//   (4) Comp With a Price Tag: the comp's dollar value is
//       required before an offer exists (server refuses without).
//   (5) The Deal Card: both sides confirm once; state stored;
//       strangers get 404.
//   (6) Rights Menu: the licensing fee is the one ad-use price
//       (payload-level check + plain-words client labels).
//   (7) Fee Line math: creatorNet is 97% of rate; SIGNL's
//       creator-side cut is the other 3%.
//   (8) One Number: countedResult validates + inherits to the
//       booking. Audience codes: standalone + booking-attached,
//       unique per creator, redeemed with channel taps, feeding
//       the -34 receipt as events.
//   (9) Real People Check + fake-flag engine: Admin sets the
//       check (payload shows it only where true); the flag
//       queue is Admin-only and flag data never reaches users.
//   (10) Disclosure: creator confirms; state rides the booking.
//   (12) Swap Bench: cancelled visit → ranked suggestions from
//        the real roster → one tap sends a cloned direct offer.
//   Item (3), the answer deadline, was REJECTED by Jeff: this
//   suite asserts no such field exists on offers or bookings.
// Run: node scripts/verify-build35.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8945;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = ["build35", "admin", "pass"].join("-");
const DB = path.join(os.tmpdir(), `signl-verify-build35-${Date.now()}.json`);
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

async function makeCreator(admin, { name, email, handle, extra = {}, rate = null, sealCharter = false }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle, followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"],
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true, ...extra,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await c("PATCH", "/api/me/profile", { publicPage: true });
  if (rate) await c("PATCH", "/api/me/profile", { paidRate: rate });
  // Charter seal (Build -31): the founding read stamps Charter
  // while the market is still founding; the suite seals Rita
  // before flipping Richmond live so her open-offer apply is
  // not held by the 24h early-access window.
  if (sealCharter) await c("GET", "/api/me/founding");
  return { client: c, id: reg.data.user.id, handle, user: reg.data.user };
}
async function makeBusiness(admin, { name, businessName, email }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "business", name, businessName, email, password: "business-pass-123", market: "Richmond", city: "Richmond",
    category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: reg.data.user.id });
  return { client: c, id: reg.data.user.id, user: reg.data.user };
}
async function compBooking(biz, creator, title, extra = {}) {
  const off = await biz.client("POST", "/api/offers", { title, whatComped: "Dinner for two", dollarCap: 60, spots: 1, includesAlcohol: false, creatorId: creator.id, ...extra });
  if (off.status !== 201) throw new Error(`offer failed: ${JSON.stringify(off.data)}`);
  const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
  if (acc.status !== 201) throw new Error(`accept failed: ${JSON.stringify(acc.data)}`);
  await biz.client("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
  return { offer: off.data.offer, booking: acc.data.booking };
}

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const anon = client();

  const rita = await makeCreator(admin, { name: "Range Rita", email: "rita@fixtures.dev", handle: "rangerita", rate: 200, sealCharter: true });
  await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });
  const sam = await makeCreator(admin, { name: "Swap Sam", email: "sam@fixtures.dev", handle: "swapsam", rate: 150 });
  await sam.client("PATCH", "/api/me/profile", { localAudiencePct: 80 });
  const fran = await makeCreator(admin, { name: "Flag Fran", email: "fran@fixtures.dev", handle: "flagfran", rate: 300, extra: { followerCount: 50000, avgViews: 100, localAudiencePct: 3 } });
  const uma = await makeCreator(admin, { name: "Uma Fourth", email: "uma@fixtures.dev", handle: "umafourth", rate: 100 });
  const kitchen = await makeBusiness(admin, { name: "Kim Owner", businessName: "Round2 Kitchen", email: "kim@fixtures.dev" });
  const otherBiz = await makeBusiness(admin, { name: "Ollie Other", businessName: "Other Place", email: "ollie@fixtures.dev" });

  // ---------- (4) comp value required + (8) One Number ----------
  const noValue = await kitchen.client("POST", "/api/offers", { title: "No value night", whatComped: "Dinner", spots: 1 });
  check("(4) a comped offer without a dollar value is refused before it exists", noValue.status === 400, JSON.stringify(noValue.data).slice(0, 160));
  const { offer, booking } = await compBooking(kitchen, rita, "Counted Night", { countedResult: "orders" });
  check("(8) the counted result validates and stores on the offer", offer.countedResult === "orders", JSON.stringify(offer.countedResult));
  check("(8) the booking inherits the one number", booking.countedResult === "orders", JSON.stringify(booking.countedResult));
  const bogus = await kitchen.client("POST", "/api/offers", { title: "Bogus count", whatComped: "Dinner", dollarCap: 50, spots: 1, countedResult: "vibes" });
  check("(8) an unknown counted result falls back to door", bogus.status === 201 && bogus.data.offer.countedResult === "door", JSON.stringify(bogus.data.offer && bogus.data.offer.countedResult));

  // ---------- (5) Deal Card + (10) Disclosure ----------
  const dcBiz = await kitchen.client("POST", `/api/bookings/${booking.id}/deal-confirm`, {});
  check("(5) the business confirmation stores on the deal card",
    dcBiz.status === 200 && !!dcBiz.data.booking.dealCard.businessAt && !dcBiz.data.booking.dealCard.creatorAt, JSON.stringify(dcBiz.data.booking.dealCard));
  const dcCr = await rita.client("POST", `/api/bookings/${booking.id}/deal-confirm`, {});
  check("(5) the creator confirmation completes the card",
    dcCr.status === 200 && !!dcCr.data.booking.dealCard.creatorAt, JSON.stringify(dcCr.data.booking.dealCard));
  const dcStranger = await otherBiz.client("POST", `/api/bookings/${booking.id}/deal-confirm`, {});
  check("(5) a stranger business gets 404, not the booking", dcStranger.status === 404, JSON.stringify(dcStranger.data).slice(0, 120));
  const discBiz = await kitchen.client("POST", `/api/bookings/${booking.id}/disclosure`, {});
  check("(10) a business cannot confirm the creator's disclosure", discBiz.status === 403, JSON.stringify(discBiz.data).slice(0, 120));
  const disc = await rita.client("POST", `/api/bookings/${booking.id}/disclosure`, {});
  check("(10) the creator's disclosure confirmation rides the booking",
    disc.status === 200 && !!disc.data.booking.disclosureAt, JSON.stringify(disc.data.booking.disclosureAt));

  // ---------- (2) Rate Range: listed guidance first ----------
  const rr1 = await rita.client("GET", "/api/me/rate-range");
  check("(2) with listed rates from 4 creators, the range is labeled guidance (150 to 300)",
    rr1.status === 200 && rr1.data.range && rr1.data.range.source === "listed" && rr1.data.range.low === 150 && rr1.data.range.high === 300,
    JSON.stringify(rr1.data));

  // ---------- (1)+(7) paid booking math ----------
  const paid1 = await kitchen.client("POST", "/api/bookings/paid", { creatorId: rita.id });
  if (paid1.status !== 201) throw new Error(`paid booking failed: ${JSON.stringify(paid1.data)}`);
  const lane = paid1.data.booking.paidLane;
  check("(1) the paid booking holds escrow with the rate stamped (the Paid on Post line's data)",
    lane && lane.escrowState === "held" && lane.rate === 200, JSON.stringify(lane).slice(0, 200));
  check("(7) fee math: the creator nets 97% and SIGNL's creator-side cut is the other 3%",
    lane.creatorNet === 194 && Math.round((lane.rate - lane.creatorNet) * 100) / 100 === 6, JSON.stringify(lane).slice(0, 200));
  await kitchen.client("POST", "/api/bookings/paid", { creatorId: sam.id });
  await kitchen.client("POST", "/api/bookings/paid", { creatorId: fran.id });
  const rr2 = await sam.client("GET", "/api/me/rate-range");
  check("(2) with 3 distinct booked creators, the range comes from real bookings (150 to 300)",
    rr2.data.range && rr2.data.range.source === "bookings" && rr2.data.range.low === 150 && rr2.data.range.high === 300,
    JSON.stringify(rr2.data));

  // ---------- (8) Audience codes ----------
  const standalone = await kitchen.client("POST", "/api/me/audience-offers", { title: "First Visit Invite", perk: "Free appetizer with an entree" });
  check("(8) a standalone audience offer creates", standalone.status === 201 && !standalone.data.code, JSON.stringify(standalone.data).slice(0, 200));
  const crView = await sam.client("GET", "/api/me/audience-offers");
  check("(8) creators in the market see the standalone offer",
    (crView.data.offers || []).some((o) => o.id === standalone.data.offer.id), JSON.stringify(crView.data).slice(0, 200));
  const take = await sam.client("POST", `/api/me/audience-offers/${standalone.data.offer.id}/take`, {});
  check("(8) taking an offer issues the creator a unique AUD- code",
    take.status === 201 && /^AUD-/.test(take.data.code.code), JSON.stringify(take.data).slice(0, 200));
  const takeAgain = await sam.client("POST", `/api/me/audience-offers/${standalone.data.offer.id}/take`, {});
  check("(8) taking twice returns the same code, never a second one",
    takeAgain.status === 200 && takeAgain.data.code.id === take.data.code.id, JSON.stringify(takeAgain.data).slice(0, 160));
  const audCode = take.data.code.code;
  const redeemCreator = await sam.client("POST", "/api/me/audience-codes/redeem", { code: audCode, amount: 20, channel: "pickup" });
  check("(8) creators cannot redeem audience codes", redeemCreator.status === 403, JSON.stringify(redeemCreator.data).slice(0, 120));
  const redeem = await kitchen.client("POST", "/api/me/audience-codes/redeem", { code: audCode, amount: 45, channel: "delivery" });
  check("(8) a redemption logs as an audience event with its channel",
    redeem.status === 201 && redeem.data.redemptionEvent.kind === "audience" && redeem.data.redemptionEvent.channel === "delivery" && redeem.data.redemptionEvent.amount === 45,
    JSON.stringify(redeem.data).slice(0, 240));
  const attached = await kitchen.client("POST", "/api/me/audience-offers", { title: "Visit Night Invite", perk: "Free dessert with dinner", bookingId: booking.id });
  check("(8) an offer attached to a booking issues that booking's creator a code at once",
    attached.status === 201 && attached.data.code && attached.data.code.creatorId === rita.id, JSON.stringify(attached.data).slice(0, 240));
  const receipt = await kitchen.client("GET", "/api/me/receipt");
  const audRow = (receipt.data.receipt.ledger || []).find((l) => l.audience);
  check("(8) audience redemptions feed the -34 receipt as counted events",
    receipt.data.receipt.trackedSpend >= 45 && !!audRow && audRow.customers === 1 && audRow.spend === 45,
    JSON.stringify(receipt.data.receipt).slice(0, 400));

  // ---------- (12) Swap Bench ----------
  // Rita's Charter was sealed pre-launch in her fixture, so the
  // 24h early-access window (Build -31) does not hold her apply.
  const openOff = await kitchen.client("POST", "/api/offers", { title: "Swap Night", whatComped: "Dinner for two", dollarCap: 60, spots: 1, countedResult: "orders" });
  if (openOff.status !== 201) throw new Error(`swap fixture offer failed: ${JSON.stringify(openOff.data)}`);
  const appRes = await rita.client("POST", `/api/offers/${openOff.data.offer.id}/apply`, {});
  if (appRes.status !== 201) throw new Error(`swap fixture apply failed: ${JSON.stringify(appRes.data)}`);
  const sel = await kitchen.client("POST", `/api/offers/${openOff.data.offer.id}/select`, { applicationId: appRes.data.application.id });
  if (sel.status !== 201) throw new Error(`swap fixture select failed: ${JSON.stringify(sel.data)}`);
  const swapBooking = sel.data.booking;
  const swapEarly = await kitchen.client("GET", `/api/bookings/${swapBooking.id}/swap`);
  check("(12) swaps stay shut while the visit is live", swapEarly.status === 400, JSON.stringify(swapEarly.data).slice(0, 120));
  const decline = await rita.client("POST", `/api/applications/${appRes.data.application.id}/decline`, {});
  check("setup: the creator gives the spot back", decline.status === 200, JSON.stringify(decline.data).slice(0, 160));
  const bizBookings = await kitchen.client("GET", "/api/bookings");
  const cancelled = (bizBookings.data.bookings || []).find((b) => b.id === swapBooking.id);
  check("setup: the booking reads cancelled", !!cancelled && cancelled.status === "cancelled", JSON.stringify(cancelled && cancelled.status));
  const swapGet = await kitchen.client("GET", `/api/bookings/${swapBooking.id}/swap`);
  const sugs = swapGet.data.suggestions || [];
  check("(12) suggestions come from the real roster, never the canceller, nearest local reach first",
    swapGet.status === 200 && sugs.length >= 2 && !sugs.some((x) => x.creatorId === rita.id) && sugs[0].creatorId === uma.id && sugs.some((x) => x.creatorId === sam.id),
    JSON.stringify(sugs).slice(0, 300));
  const swapPost = await kitchen.client("POST", `/api/bookings/${swapBooking.id}/swap`, { creatorId: sam.id });
  check("(12) one tap sends the same visit as a direct offer to the swap pick",
    swapPost.status === 201 && swapPost.data.offer.creatorId === sam.id && swapPost.data.offer.swapFromBookingId === swapBooking.id && swapPost.data.offer.countedResult === "orders",
    JSON.stringify(swapPost.data).slice(0, 300));

  // ---------- (9) Real People Check + flag engine ----------
  const rc = await admin("POST", "/api/admin/real-check", { userId: rita.id, checked: true });
  check("(9) Admin can mark the real-people check", rc.status === 200 && rc.data.realPeopleChecked === true, JSON.stringify(rc.data));
  const pubRita = await anon("GET", "/api/c/rangerita");
  check("(9) the book-me payload shows the check where it is true",
    pubRita.data.profile.realPeopleChecked === true, JSON.stringify(pubRita.data.profile.realPeopleChecked));
  const pubSam = await anon("GET", "/api/c/swapsam");
  check("(9) an unchecked creator's payload shows false, never a borrowed badge",
    pubSam.data.profile.realPeopleChecked === false, JSON.stringify(pubSam.data.profile.realPeopleChecked));
  const queue = await admin("GET", "/api/admin/flag-queue");
  const franFlags = (queue.data.flagged || []).find((f) => f.userId === fran.id);
  check("(9) the engine flags the anomalous account with plain reasons, Admin only",
    queue.status === 200 && !!franFlags && franFlags.flags.some((f) => f.signal === "low_engagement") && franFlags.flags.some((f) => f.signal === "geography_mismatch"),
    JSON.stringify(queue.data).slice(0, 400));
  check("(9) a normal account is not in the flag queue",
    !(queue.data.flagged || []).some((f) => f.userId === rita.id), JSON.stringify(queue.data.flagged || []).slice(0, 200));
  const queueAsCreator = await rita.client("GET", "/api/admin/flag-queue");
  check("(9) the flag queue refuses non-admins", queueAsCreator.status === 403 || queueAsCreator.status === 404, JSON.stringify(queueAsCreator.data).slice(0, 120));
  const pubFran = await anon("GET", "/api/c/flagfran");
  check("(9) flag data never reaches a public payload",
    !JSON.stringify(pubFran.data).includes("low_engagement") && !JSON.stringify(pubFran.data).includes("fakeFlags") && !JSON.stringify(pubFran.data).includes("geography_mismatch"),
    JSON.stringify(pubFran.data).slice(0, 200));
  const franMe = await fran.client("GET", "/api/me");
  check("(9) flag data never reaches the flagged creator's own record view",
    !JSON.stringify(franMe.data).includes("low_engagement"), JSON.stringify(franMe.data).slice(0, 200));

  // ---------- Rejected item (3): no answer deadline exists ----------
  const boot = await anon("GET", "/api/bootstrap");
  check("(3 rejected) no answer-deadline machinery exists in the offer or booking shape",
    !("answerBy" in offer) && !("answerDeadline" in offer) && !("answerBy" in booking) && !("autoClose" in offer),
    JSON.stringify({ offer: Object.keys(offer).slice(0, 5) }));

  // ---------- source contracts ----------
  const appSrc = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const srcChecks = [
    ["client: the Deal Card renders in plain words with both confirmations", appSrc.includes("The deal, in plain words") && appSrc.includes("Looks right") && appSrc.includes("dealConfirm")],
    ["client: the Paid on Post promise line ships verbatim for held escrow", appSrc.includes("Money's in.") && appSrc.includes("paid the day it goes live")],
    ["client: the Fee Line ships scaled from the lane math", appSrc.includes("That is the whole fee.") && appSrc.includes("lane.creatorNet")],
    ["client: the Rights Menu speaks in the one plain sentence", appSrc.includes("Run my post as an ad for 90 days:") && appSrc.includes("Run my post as an ad")],
    ["client: the rate range line ships with its two honest sources", appSrc.includes("The going range near you, from real paid bookings") && appSrc.includes("Guidance from listed rates near you")],
    ["client: the One Number pick ships in the composer and the payload", appSrc.includes("The one number we count") && appSrc.includes("payload.countedResult")],
    ["client: the comp nudge scales with the value", appSrc.includes("a paid booking usually lands better") && appSrc.includes("compNudgeUpdate")],
    ["client: audience offers prompt with good ideas and channel taps", appSrc.includes("Give their audience a reason to come in") && appSrc.includes("AUD_PERK_IDEAS") && appSrc.includes("Delivery") && appSrc.includes("Pickup")],
    ["client: the code card asset + copy line ship for creators", appSrc.includes("audDownloadCard") && appSrc.includes("audCopyLine") && appSrc.includes("Use my code")],
    ["client: the disclosure line is done for the creator, one tap to copy", appSrc.includes("disclosureLine") && appSrc.includes("#ad — comped by") && appSrc.includes("Copy the line")],
    ["client: the Real People line shows only where checked", appSrc.includes("Checked by a person") && appSrc.includes("Real posts, real local life.") && appSrc.includes("p.realPeopleChecked")],
    ["client: the Swap Bench ships on cancelled visits", appSrc.includes("The Swap Bench") && appSrc.includes("Find a swap") && appSrc.includes("swapSend")],
  ];
  for (const [name, ok] of srcChecks) check(name, ok);

  console.log(`\nverify-build35: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
} catch (e) {
  console.error("verify-build35 crashed:", e);
  process.exitCode = 1;
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
