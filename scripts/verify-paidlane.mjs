#!/usr/bin/env node
// Paid lane + reviews/budget verification (Jeff, 2026-10-19).
//
// Proves, against a throwaway local DB:
//   - creator paid settings: compOpen (default true) and paidRate
//     (optional, $50 floor) on the record, editable via PATCH, with
//     the verbatim explainer copy shipped in the client;
//   - discovery paid=1 reads the REAL paidRate (not the old
//     paid-campaigns flag); cards and public /c/ profiles show the
//     rate, the "Paid bookings" marker, and the comp-open state;
//   - paid bookings: fee math (rate + 3% business side, creator
//     keeps 97%, 6% total), escrow held at booking with the
//     recorded/no-card-charged label, released by the compliance
//     sweep after proof + the 48 hour hold, refunded on a no-show
//     (window expiry) and on a creator ban;
//   - the Momentum correction: a creator's in-app review of a
//     business after a completed visit earns +10 at ANY star
//     rating, and reviews a creator RECEIVES mint nothing;
//   - business review-page links: host-validated, set by admin and
//     by the business itself, shown to creators in the offer and
//     visit flows only, never on public surfaces;
//   - the Managed talent budget in the Business Preview dashboard
//     (second simulated business; Salt & Ember stays Growth) and
//     preview paid bookings as zero-write simulations.
//
// Run: node scripts/verify-paidlane.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8926;
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-paidlane-"));
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
  const api = async function (method, p, body) {
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
    try { data = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data, text };
  };
  api.raw = async function (p) {
    const res = await fetch(BASE + p);
    return { status: res.status, text: await res.text() };
  };
  return api;
}

const uniq = () => Math.random().toString(36).slice(2, 9);
let n = 0;
function creatorPayload(overrides = {}) {
  n += 1;
  return {
    role: "creator",
    name: `Paid Creator ${n}`,
    email: `paid${n}-${uniq()}@example.com`,
    password: "password123",
    market: "Hampton Roads",
    city: "Norfolk",
    handle: `paid${n}${uniq()}`,
    categories: ["Food & Drink"],
    compCategories: ["Restaurant meals"],
    tierBand: "Locals",
    followerCount: 3000,
    avgViews: 900,
    localAudiencePct: 62,
    bio: "",
    agreedHonestPosts: true,
    agreedFtcDisclosure: true,
    agreedPostCompliance: true,
    agreedTerms: true,
    ...overrides,
  };
}

async function registerCreator(overrides = {}) {
  const client = makeClient();
  const payload = creatorPayload(overrides);
  const r = await client("POST", "/api/auth/register", payload);
  return { client, payload, res: r, user: r.data && r.data.user, email: payload.email, password: payload.password };
}
async function registerBusiness(planId, businessName) {
  const client = makeClient();
  const email = `biz-${uniq()}@example.com`;
  const r = await client("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", email, password: "password123",
    market: "Hampton Roads", city: "Norfolk", businessName, category: "Restaurant", planId, agreedTerms: true,
  });
  return { client, res: r, user: r.data && r.data.user, email, password: "password123" };
}
async function login(email, password) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email, password });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return c;
}
const adminClient = () => login(ADMIN_EMAIL, ADMIN_PASSWORD);
async function approve(admin, userId) {
  const r = await admin("POST", "/api/admin/review", { userId, decision: "approve" });
  if (r.status !== 200) throw new Error("approve failed: " + JSON.stringify(r.data));
}
async function countEvents(admin, type) {
  const r = await admin("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=2000`);
  return (r.data.events || []).length;
}
async function momentumOf(client) {
  const me = await client("GET", "/api/auth/me");
  return me.data.user.momentum;
}
async function myBookings(client) {
  const r = await client("GET", "/api/bookings");
  return r.data.bookings || [];
}

function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}

try {
  startServer();
  await waitUp();
  let admin = await adminClient();
  const anon = makeClient();

  // ---------- Part A: creator paid settings ----------
  part("A: creator paid settings");
  const P = await registerCreator({});
  await approve(admin, P.user.id);
  const meA = await P.client("GET", "/api/auth/me");
  check("new creator defaults: compOpen true, paidRate null", meA.data.user.creator.compOpen === true && meA.data.user.creator.paidRate === null, JSON.stringify(meA.data.user.creator));
  const floor = await P.client("PATCH", "/api/me/profile", { paidRate: 30 });
  check("paid rate below the $50 floor is refused", floor.status === 400 && /at least \$50/.test(floor.data.error || ""), `${floor.status} ${JSON.stringify(floor.data)}`);
  const setRate = await P.client("PATCH", "/api/me/profile", { paidRate: 250 });
  check("paid rate $250 saves", setRate.status === 200 && setRate.data.user.creator.paidRate === 250, JSON.stringify(setRate.data.user && setRate.data.user.creator));
  const setComp = await P.client("PATCH", "/api/me/profile", { compOpen: false });
  check("compOpen can be turned off (paid-only)", setComp.status === 200 && setComp.data.user.creator.compOpen === false, "");
  const clearRate = await P.client("PATCH", "/api/me/profile", { paidRate: null });
  check("paid rate clears back to null (no paid bookings)", clearRate.status === 200 && clearRate.data.user.creator.paidRate === null, "");
  await P.client("PATCH", "/api/me/profile", { paidRate: 250 });

  const appJs = await anon.raw("/app.js");
  check("client ships the verbatim comp explainer copy", appJs.text.includes("Accept comp visits. Businesses comp you the experience and you post honestly within 48 hours. Creators who accept comps get more offers and more free experiences, and every completed visit earns Momentum points. Momentum lifts you in business search and builds the track record that gets you trusted and booked, including first access to paid bookings."), "");
  check("client ships the verbatim paid rate copy", appJs.text.includes("Set a paid rate (optional). Businesses can book you at your listed rate for a paid visit, and you keep 97% of it. Paid-only is fine too, but paid-only creators receive fewer offers."), "");
  check("client ships the review pages block and the paid badges", appJs.text.includes("Their review pages") && appJs.text.includes("Paid bookings:") && appJs.text.includes("Book paid visit"), "");

  // ---------- Part B: discovery + public profile ----------
  part("B: discovery + public profile");
  const Q = await registerCreator({}); // never lists a rate
  await approve(admin, Q.user.id);
  const G = await registerBusiness("growth", "Salt & Ember Kitchen");
  await approve(admin, G.user.id);
  const discPaid = await G.client("GET", "/api/discover?market=Hampton%20Roads&paid=1");
  const paidIds = (discPaid.data.creators || []).map((c) => c.userId);
  check("paid=1 discovery includes the rate-listed creator", paidIds.includes(P.user.id), JSON.stringify(paidIds));
  check("paid=1 discovery excludes a creator with no rate", !paidIds.includes(Q.user.id), "");
  const pCard = (discPaid.data.creators || []).find((c) => c.userId === P.user.id);
  check("discovery card carries paidRate + compOpen", !!pCard && pCard.profile.paidRate === 250 && pCard.profile.compOpen === false, JSON.stringify(pCard && pCard.profile));
  const pub = await anon("GET", `/api/c/${P.payload.handle}`);
  check("public profile shows the paid rate and paid-only state", pub.status === 200 && pub.data.profile.paidRate === 250 && pub.data.profile.compOpen === false, `${pub.status} ${JSON.stringify(pub.data.profile && { paidRate: pub.data.profile.paidRate, compOpen: pub.data.profile.compOpen })}`);

  // ---------- Part C: paid booking + escrow release ----------
  part("C: paid booking + escrow");
  const paidByCreator = await P.client("POST", "/api/bookings/paid", { creatorId: Q.user.id });
  check("creators cannot create paid bookings (403)", paidByCreator.status === 403, `${paidByCreator.status}`);
  const paidNoRate = await G.client("POST", "/api/bookings/paid", { creatorId: Q.user.id });
  check("paid booking to a creator with no rate is refused", paidNoRate.status === 400, `${paidNoRate.status}`);
  const pb = await G.client("POST", "/api/bookings/paid", { creatorId: P.user.id });
  check("paid booking created", pb.status === 201 && pb.data.booking.kind === "paid" && !!pb.data.booking.code, `${pb.status} ${JSON.stringify(pb.data).slice(0, 200)}`);
  const lane = pb.data.booking.paidLane || {};
  check("fee math: $250 rate -> business $257.50, creator $242.50, fee $15", lane.rate === 250 && lane.businessTotal === 257.5 && lane.creatorNet === 242.5 && lane.platformFee === 15, JSON.stringify(lane));
  check("escrow held at booking, labeled recorded/no card charged", lane.escrowState === "held" && /no card charged/.test(lane.paymentNote || ""), JSON.stringify(lane));
  check("paid_booking_created event logged", (await countEvents(admin, "paid_booking_created")) === 1, "");
  const pbId = pb.data.booking.id;
  const conf = await G.client("POST", `/api/bookings/${pbId}/confirm`, {});
  check("business confirms the paid visit (clock starts)", conf.status === 200 && !!conf.data.booking.redeemedAt, `${conf.status}`);
  const proof = await P.client("POST", "/api/posts", { bookingId: pbId, url: "https://www.instagram.com/p/paidlane1/", includesDisclosure: true });
  check("paid visit proof accepted", proof.status === 201, `${proof.status}`);
  const heldView = (await myBookings(G.client)).find((b) => b.id === pbId);
  check("escrow still held right after proof (48h hold), proof time recorded", !!heldView && heldView.paidLane.escrowState === "held" && !!heldView.paidLane.proofAt, JSON.stringify(heldView && heldView.paidLane));

  // Time travel: proof is 49 hours old, then the sweep releases.
  await stopServer();
  editDb((db) => {
    for (const [key, val] of Object.entries(db)) {
      if (key.startsWith("post:") && val.bookingId === pbId) val.submittedAt = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
    }
  });
  startServer();
  await waitUp();
  admin = await adminClient();
  const G2 = await login(G.email, G.password);
  const sweepC = await admin("POST", "/api/admin/compliance/sweep", {});
  check("sweep ran and released at least one escrow", sweepC.status === 200 && sweepC.data.sweep.escrowReleased >= 1, JSON.stringify(sweepC.data));
  const relView = (await myBookings(G2)).find((b) => b.id === pbId);
  check("escrow released after proof + 48h hold", !!relView && relView.paidLane.escrowState === "released" && !!relView.paidLane.releasedAt, JSON.stringify(relView && relView.paidLane));
  check("paid_escrow_released event logged once", (await countEvents(admin, "paid_escrow_released")) === 1, "");

  // ---------- Part D: escrow refunds ----------
  part("D: escrow refunds");
  const R2 = await registerCreator({});
  await approve(admin, R2.user.id);
  await R2.client("PATCH", "/api/me/profile", { paidRate: 200 });
  const pb2 = await G2("POST", "/api/bookings/paid", { creatorId: R2.user.id });
  check("second paid booking created (no-show path)", pb2.status === 201, `${pb2.status}`);
  const pb2Id = pb2.data.booking.id;
  const R3 = await registerCreator({});
  await approve(admin, R3.user.id);
  await R3.client("PATCH", "/api/me/profile", { paidRate: 150 });
  const pb3 = await G2("POST", "/api/bookings/paid", { creatorId: R3.user.id });
  const pb3Id = pb3.data.booking.id;
  const conf3 = await G2("POST", `/api/bookings/${pb3Id}/confirm`, {});
  check("third paid booking redeemed (ban path)", conf3.status === 200, `${conf3.status}`);

  await stopServer();
  editDb((db) => {
    const now = Date.now();
    for (const [key, val] of Object.entries(db)) {
      if (key.startsWith("booking:") && val.id === pb2Id) {
        val.redeemBy = new Date(now - 24 * 3600 * 1000).toISOString();
      }
      if (key.startsWith("booking:") && val.id === pb3Id && val.redeemedAt) {
        const redeemedMs = now - 15 * 24 * 3600 * 1000;
        val.redeemedAt = new Date(redeemedMs).toISOString();
        val.postDeadline = new Date(redeemedMs + 48 * 3600 * 1000).toISOString();
        val.compliance = {};
      }
    }
  });
  startServer();
  await waitUp();
  admin = await adminClient();
  const G3 = await login(G.email, G.password);
  const sweepD = await admin("POST", "/api/admin/compliance/sweep", {});
  check("refund sweep ran", sweepD.status === 200 && sweepD.data.sweep.escrowRefunded >= 2, JSON.stringify(sweepD.data));
  const gBookings = await myBookings(G3);
  const v2 = gBookings.find((b) => b.id === pb2Id);
  check("no-show paid booking expired and refunded", !!v2 && v2.status === "expired" && v2.paidLane.escrowState === "refunded" && v2.paidLane.refundReason === "no_show", JSON.stringify(v2 && v2.paidLane));
  const v3 = gBookings.find((b) => b.id === pb3Id);
  check("banned creator's paid booking refunded", !!v3 && v3.paidLane.escrowState === "refunded" && v3.paidLane.refundReason === "creator_banned", JSON.stringify(v3 && v3.paidLane));
  const pubR3 = await anon("GET", `/api/c/${R3.payload.handle}`);
  check("banned creator's public profile is gone (404)", pubR3.status === 404, `${pubR3.status}`);
  check("paid_escrow_refunded events logged for both", (await countEvents(admin, "paid_escrow_refunded")) === 2, "");

  // ---------- Part E: Momentum review correction ----------
  part("E: review momentum correction");
  const M = await registerCreator({});
  await approve(admin, M.user.id);
  const off = await G3("POST", "/api/offers", { title: "Review visit", whatComped: "Meal for two, on us", dollarCap: 100, spots: 1, creatorId: M.user.id });
  const acc = await M.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
  const mBookingId = acc.data.booking.id;
  const earlyReview = await M.client("POST", `/api/bookings/${mBookingId}/review-business`, { stars: 5, text: "Too soon" });
  check("review before completion is refused (409)", earlyReview.status === 409, `${earlyReview.status}`);
  await G3("POST", `/api/bookings/${mBookingId}/confirm`, {});
  await M.client("POST", "/api/posts", { bookingId: mBookingId, url: "https://www.instagram.com/p/reviewvisit1/", includesDisclosure: true });
  const mBefore = await momentumOf(M.client);
  check("momentum before review: local 5 + first accept 10 + on-time 20 = 35", mBefore.points === 35, JSON.stringify(mBefore.ledger));
  const rev = await M.client("POST", `/api/bookings/${mBookingId}/review-business`, { stars: 2, text: "Food was great, kitchen was slow to seat us." });
  check("creator can review the business after a completed visit", rev.status === 201 && rev.data.review.stars === 2, `${rev.status} ${JSON.stringify(rev.data)}`);
  const mAfter = await momentumOf(M.client);
  check("a 2-star honest review earns +10 (any star rating)", mAfter.points === 45 && mAfter.ledger.some((e) => e.kind === "review_given" && e.points === 10), JSON.stringify(mAfter.ledger));
  check("no review_high entries anywhere in the ledger", !mAfter.ledger.some((e) => e.kind === "review_high"), "");
  const checklistItem = (mAfter.checklist || []).find((x) => x.id === "reviews");
  check("checklist teaches any-star-rating reviews", !!checklistItem && /any star rating/.test(checklistItem.label) && checklistItem.done === true, JSON.stringify(checklistItem));
  const dup = await M.client("POST", `/api/bookings/${mBookingId}/review-business`, { stars: 4, text: "Again" });
  check("second review of the same visit refused (409)", dup.status === 409, `${dup.status}`);
  const bizStars = await G3("POST", `/api/bookings/${mBookingId}/review`, { stars: 5, comment: "Wonderful creator." });
  check("business can still review the creator (received reviews exist)", bizStars.status === 201, `${bizStars.status}`);
  const mFinal = await momentumOf(M.client);
  check("a received 5-star review mints NO points (total unchanged)", mFinal.points === 45, JSON.stringify(mFinal.ledger));
  const bizAttempt = await G3("POST", `/api/bookings/${mBookingId}/review-business`, { stars: 5, text: "Wrong side" });
  check("businesses cannot use the creator review route (403)", bizAttempt.status === 403, `${bizAttempt.status}`);
  check("creator_reviewed_business event logged once", (await countEvents(admin, "creator_reviewed_business")) === 1, "");

  // ---------- Part F: business review-page links ----------
  part("F: review-page links");
  const badLinks = await admin("POST", "/api/admin/review-links", { userId: G.user.id, links: { yelp: "https://example.com/not-yelp" } });
  check("admin rejects a Yelp link that does not point at Yelp", badLinks.status === 400, `${badLinks.status}`);
  const goodLinks = await admin("POST", "/api/admin/review-links", { userId: G.user.id, links: { google: "https://g.page/r/salty-ember", yelp: "https://www.yelp.com/biz/salt-and-ember" } });
  check("admin sets host-valid review links", goodLinks.status === 200 && goodLinks.data.business.reviewLinksView.length === 2, `${goodLinks.status} ${JSON.stringify(goodLinks.data)}`);
  const G4 = await login(G.email, G.password);
  const ownLinks = await G4("PATCH", "/api/me/profile", { reviewLinks: { google: "https://g.page/r/salty-ember", yelp: "https://www.yelp.com/biz/salt-and-ember", tripadvisor: "https://www.tripadvisor.com/Restaurant_Review-g60763-d1234567", facebook: "https://www.facebook.com/saltandember" } });
  check("business can set its own review links", ownLinks.status === 200 && ownLinks.data.user.business.reviewLinks.facebook.includes("facebook.com"), `${ownLinks.status}`);
  const mBookingsView = await myBookings(M.client);
  const mVisit = mBookingsView.find((b) => b.id === mBookingId);
  const visitLinkKeys = (mVisit && mVisit.businessReviewLinks || []).map((l) => l.key);
  check("creator's visit card payload carries Their review pages", ["google", "yelp", "tripadvisor", "facebook"].every((k) => visitLinkKeys.includes(k)), JSON.stringify(mVisit && mVisit.businessReviewLinks));
  const off2 = await G4("POST", "/api/offers", { title: "Links visit", whatComped: "Meal for one, on us", dollarCap: 60, spots: 1, creatorId: M.user.id });
  const mOffers = await M.client("GET", "/api/offers");
  const offerView = (mOffers.data.offers || []).find((o) => o.id === off2.data.offer.id);
  check("creator's offer payload carries the review pages too", !!offerView && Array.isArray(offerView.businessReviewLinks) && offerView.businessReviewLinks.length === 4, JSON.stringify(offerView && offerView.businessReviewLinks));
  const pubM = await anon("GET", `/api/c/${M.payload.handle}`);
  check("public profile never carries the business's review links", pubM.status === 200 && !pubM.text.includes("yelp.com") && !pubM.text.includes("tripadvisor.com"), `${pubM.status}`);

  // ---------- Part G: Managed budget + preview paid booking ----------
  part("G: preview budget + paid booking");
  const statsBefore = await admin("GET", "/api/admin/stats");
  const eventsBefore = await admin("GET", "/api/admin/events?limit=2000");
  const dash = await admin("GET", "/api/admin/preview/dashboard");
  const d = dash.data.dashboard || {};
  check("preview dashboard still shows Salt & Ember on Growth", d.business && d.business.name === "Salt & Ember Kitchen" && d.plan && d.plan.id === "growth", JSON.stringify(d.business));
  const mv = d.managedView || {};
  check("managed view exists with the $500 default budget", !!mv.budget && mv.budget.monthlyTalentBudget === 500 && mv.plan && mv.plan.id === "managed", JSON.stringify(mv.budget));
  const mvSpent = (mv.budget.paidBookings || []).reduce((s, x) => s + x.businessTotal, 0);
  check("managed spent = the sum of its paid bookings' business totals", Math.abs(mv.budget.spentThisMonth - Math.round(mvSpent * 100) / 100) < 0.001 && mv.budget.paidBookings.length === 2, JSON.stringify(mv.budget));
  check("managed remaining = budget - spent", Math.abs(mv.budget.remaining - (500 - mv.budget.spentThisMonth)) < 0.001, JSON.stringify(mv.budget));
  check("managed paid bookings are flagged simulated with held + released escrow shown", mv.budget.paidBookings.every((x) => x.preview === true) && mv.budget.paidBookings.some((x) => x.escrowState === "held") && mv.budget.paidBookings.some((x) => x.escrowState === "released"), JSON.stringify(mv.budget.paidBookings));
  const pBookingsBefore = (await myBookings(P.client)).length;
  const pvPaid = await admin("POST", "/api/admin/preview/paid-booking", { creatorId: P.user.id });
  check("preview paid booking simulates with the real fee math", pvPaid.status === 201 && pvPaid.data.preview === true && pvPaid.data.booking.businessTotal === 257.5 && pvPaid.data.booking.creatorNet === 242.5 && pvPaid.data.booking.platformFee === 15, `${pvPaid.status} ${JSON.stringify(pvPaid.data)}`);
  const pvNoRate = await admin("POST", "/api/admin/preview/paid-booking", { creatorId: Q.user.id });
  check("preview paid booking refuses a creator with no rate", pvNoRate.status === 400, `${pvNoRate.status}`);
  check("preview paid booking wrote no real booking", (await myBookings(P.client)).length === pBookingsBefore, "");
  const statsAfter = await admin("GET", "/api/admin/stats");
  const eventsAfter = await admin("GET", "/api/admin/events?limit=2000");
  check("dashboard + preview paid booking wrote nothing (stats identical)", JSON.stringify(statsAfter.data) === JSON.stringify(statsBefore.data), "");
  check("dashboard + preview paid booking logged nothing (events identical)", (eventsAfter.data.events || []).length === (eventsBefore.data.events || []).length, `${(eventsBefore.data.events || []).length} -> ${(eventsAfter.data.events || []).length}`);

  await stopServer();
} catch (e) {
  failed++;
  console.error("ERROR", e);
  try { await stopServer(); } catch (e2) { /* ignore */ }
}

console.log(`\nPaid lane verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
