#!/usr/bin/env node
// Compliance + stacking + momentum verification (Jeff, 2026-10-19).
//
// The suites before this one prove the marketplace plumbing. This
// one proves, against a throwaway local DB:
//   - audience stacking: totals, tier derivation from the total,
//     legacy fallback, deliberate tier picks, discovery filters on
//     the total;
//   - the Standard Visit rights by visit type (comp vs paid,
//     rights model adopted 2026-10-21) as the creator sees them
//     before accepting: identical on every plan;
//   - the post-compliance engine with time travel: seed redemption
//     timestamps in the past (edit the JSON DB while the server is
//     down, the local store caches the file per process), run the
//     sweep, and assert reminders, pause at day 8, ban at day 9,
//     late proof inside cure = delivered late (not banned), paused
//     creators blocked from offers, banned creators out of
//     discovery and off their public page, admin reinstatement;
//   - ad use: a comp visit's post refuses declaration on every plan
//     (403); a paid visit's post declares cleanly (+25 Momentum and
//     an ad_use_declared event), a second declaration is 409, a paid
//     post past its 6-month window refuses (403), and preview ad use
//     writes nothing and awards nothing;
//   - post-performance capture: one email at day 7 post-proof,
//     +5 Momentum once, numbers visible to the business, aggregate
//     contentViews in the track record;
//   - Momentum determinism: exact totals for scripted creators,
//     the floor at 0, and the ledger summing to the total.
//
// Run: node scripts/verify-compliance.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8923;
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-compliance-"));
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

const uniq = () => Math.random().toString(36).slice(2, 9);
let n = 0;
function creatorPayload(overrides = {}) {
  n += 1;
  return {
    role: "creator",
    name: `Case Creator ${n}`,
    email: `case${n}-${uniq()}@fixtures.dev`,
    password: "password123",
    market: "Hampton Roads",
    city: "Norfolk",
    handle: `case${n}${uniq()}`,
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
  const c = makeClient();
  const payload = creatorPayload(overrides);
  const r = await c("POST", "/api/auth/register", payload);
  return { client: c, payload, res: r, user: r.data && r.data.user };
}

async function registerBusiness(admin, planId, businessName) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/register", {
    role: "business",
    name: "Biz Owner",
    email: `biz-${uniq()}@fixtures.dev`,
    password: "password123",
    market: "Hampton Roads",
    city: "Norfolk",
    businessName,
    category: "Restaurant",
    planId,
    agreedTerms: true,
  });
  if (r.status === 201) {
    await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
    await admin("POST", "/api/admin/businesses/activate", { userId: r.data.user.id });
  }
  return { client: c, res: r, user: r.data && r.data.user };
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
async function momentumOf(client) {
  const me = await client("GET", "/api/auth/me");
  return me.data.user.momentum;
}
async function trackOf(businessClient, userId) {
  const d = await businessClient("GET", "/api/discover?market=Hampton%20Roads");
  const card = (d.data.creators || []).find((c) => c.userId === userId);
  return card ? card.trackRecord : null;
}
function ledgerSum(m) { return (m.ledger || []).reduce((s, e) => s + e.points, 0); }

// ---- time travel: edit the JSON DB while the server is down ----
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}
function shiftRedemption(db, creatorId, daysAgo) {
  const iso = (ms) => new Date(ms).toISOString();
  const redeemedMs = Date.now() - daysAgo * 24 * 3600 * 1000;
  for (const [key, val] of Object.entries(db)) {
    if (key.startsWith("booking:") && val.creatorId === creatorId && val.redeemedAt) {
      val.redeemedAt = iso(redeemedMs);
      val.postDeadline = iso(redeemedMs + 48 * 3600 * 1000);
      val.compliance = {};
    }
  }
}
function shiftPostSubmitted(db, creatorId, daysAgo) {
  for (const [key, val] of Object.entries(db)) {
    if (key.startsWith("post:") && val.creatorId === creatorId && val.submittedAt) {
      val.submittedAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();
    }
  }
}

const DAY = 24 * 3600 * 1000;

try {
  startServer();
  await waitUp();
  const admin = await adminClient();

  // ---------- Part A: signup compliance gate + stacking ----------
  part("A: signup + stacking");
  const noAgree = makeClient();
  const badPayload = creatorPayload();
  delete badPayload.agreedPostCompliance;
  const noAgreeRes = await noAgree("POST", "/api/auth/register", badPayload);
  check("registration without the post-compliance agreement is refused", noAgreeRes.status === 400, `${noAgreeRes.status} ${JSON.stringify(noAgreeRes.data)}`);

  const stacked = await registerCreator({ tierBand: "Headliners", followerCount: 900, audienceStack: { instagram: 900, tiktok: 800 } });
  check("stacked registration accepted", stacked.res.status === 201, JSON.stringify(stacked.res.data));
  check("totalAudience is the stack sum (900 + 800 = 1700)", stacked.user.creator.totalAudience === 1700, JSON.stringify(stacked.user.creator));
  check("sign-up band is automatic: claiming Headliners with a 1700 total lands in Neighbors", stacked.user.creator.tierBand === "Neighbors" && stacked.user.creator.computedTier === "Neighbors", JSON.stringify({ tierBand: stacked.user.creator.tierBand, computedTier: stacked.user.creator.computedTier }));
  check("stored stack keeps both platforms", stacked.user.creator.audienceStack.instagram === 900 && stacked.user.creator.audienceStack.tiktok === 800);

  const claimSmall = await registerCreator({ tierBand: "Headliners", followerCount: 900 });
  check("sign-up claiming Headliners with 900 total lands in Neighbors (client tierBand ignored)", claimSmall.user.creator.tierBand === "Neighbors" && claimSmall.user.creator.totalAudience === 900, JSON.stringify(claimSmall.user.creator));
  const stackBig = await registerCreator({ followerCount: 900, audienceStack: { instagram: 900, tiktok: 20000 } });
  check("sign-up stack counts rule the band: 900 IG + 20k TikTok lands in Headliners automatically", stackBig.user.creator.tierBand === "Headliners" && stackBig.user.creator.totalAudience === 20900, JSON.stringify(stackBig.user.creator));

  const legacy = await registerCreator({ followerCount: 3000 });
  check("legacy profile (no stack): followerCount becomes the Instagram count", legacy.user.creator.totalAudience === 3000 && legacy.user.creator.tierBand === "Locals", JSON.stringify(legacy.user.creator));

  // PATCH: counts changes re-derive the tier; a band sent with a save is ignored.
  const patch1 = await stacked.client("PATCH", "/api/me/profile", { audienceStack: { instagram: 900, tiktok: 800, youtube: 20000 } });
  check("adding YouTube 20k re-derives the tier from the new total (21700 = Headliners)", patch1.data.user.creator.tierBand === "Headliners" && patch1.data.user.creator.totalAudience === 21700, JSON.stringify(patch1.data.user.creator));
  const patch2 = await legacy.client("PATCH", "/api/me/profile", { tierBand: "Headliners", audienceStack: { instagram: 3000 } });
  check("a band sent with a save is ignored: 3000 total stays Locals (fully automatic)", patch2.data.user.creator.tierBand === "Locals", patch2.data.user.creator.tierBand);
  const patch3 = await legacy.client("PATCH", "/api/me/profile", { audienceStack: { instagram: 100 } });
  check("a counts-only save re-derives from the new total (100 total = the floor band, Neighbors)", patch3.data.user.creator.totalAudience === 100 && patch3.data.user.creator.tierBand === "Neighbors", JSON.stringify({ total: patch3.data.user.creator.totalAudience, tier: patch3.data.user.creator.tierBand }));
  await legacy.client("PATCH", "/api/me/profile", { audienceStack: { instagram: 3000 } }); // restore for discovery checks

  // ---------- Part B: approvals + discovery on totals ----------
  part("B: discovery on totals");
  for (const u of [stacked.user, legacy.user]) {
    const a = await admin("POST", "/api/admin/review", { userId: u.id, decision: "approve" });
    check(`approved ${u.creator.handle}`, a.status === 200);
  }
  const bizReg = await registerBusiness(admin, "growth", "Compliance Test Kitchen");
  const bizC = bizReg.client;
  const biz = bizReg.res;
  check("TEST_MODE growth business registered + approved", biz.status === 201 && biz.data.user.business.plan === "growth", JSON.stringify(biz.data));
  const minDisc = await bizC("GET", "/api/discover?followersMin=20000");
  const minIds = (minDisc.data.creators || []).map((c) => c.userId);
  check("followersMin reads the stacked total (21.7k creator in, 3k creator out)", minIds.includes(stacked.user.id) && !minIds.includes(legacy.user.id), JSON.stringify(minIds));
  const card = (minDisc.data.creators || []).find((c) => c.userId === stacked.user.id);
  check("discovery card carries totalAudience + the stack breakdown", card && card.totalAudience === 21700 && Array.isArray(card.audienceStack) && card.audienceStack.length === 3, JSON.stringify(card && card.audienceStack));
  check("discovery card carries the Standard Visit summary", !!(card && card.visitIncludes && card.visitIncludes.includes("48 hours")), JSON.stringify(card && card.visitIncludes));

  // ---------- Part C: rights on the creator's offer ----------
  // Rights model (adopted 2026-10-21): rights follow the VISIT,
  // never the plan. A comp offer carries comp rights from every
  // business; a paid offer carries paid rights from every business.
  part("C: rights by visit type");
  const selfReg = await registerBusiness(admin, "self-service", "Self Service Diner");
  const selfBizC = selfReg.client;
  const selfBiz = selfReg.res;
  check("self-service business registered + approved", selfBiz.status === 201, JSON.stringify(selfBiz.data));
  const offG = await bizC("POST", "/api/offers", { title: "Growth dinner", whatComped: "Meal for two, on us", dollarCap: 100, spots: 1, visitWindow: "This week", creatorId: stacked.user.id });
  const offS = await selfBizC("POST", "/api/offers", { title: "Self dinner", whatComped: "Meal for one, on us", dollarCap: 50, spots: 1, visitWindow: "This week", creatorId: stacked.user.id });
  check("both comp offers created", offG.status === 201 && offS.status === 201, `${offG.status}/${offS.status}`);
  const offP = await bizC("POST", "/api/offers", { title: "Paid dinner", whatComped: "Tasting menu for two", kind: "paid", cashRate: 250, spots: 1, visitWindow: "This week", creatorId: stacked.user.id });
  check("paid offer created", offP.status === 201, `${offP.status} ${JSON.stringify(offP.data)}`);
  const myOffers = await stacked.client("GET", "/api/offers");
  const og = (myOffers.data.offers || []).find((o) => o.id === offG.data.offer.id);
  const os = (myOffers.data.offers || []).find((o) => o.id === offS.data.offer.id);
  const op = (myOffers.data.offers || []).find((o) => o.id === (offP.data.offer && offP.data.offer.id));
  check("growth business, comp offer: comp rights (native share only, no ad use)", !!og && og.businessPlan === "growth" && og.visitRights && og.visitRights.basis === "comp" && og.visitRights.adUse === false && og.visitRights.cannot.some((x) => /ad/i.test(x)), JSON.stringify(og && og.visitRights));
  check("self-service business, comp offer: the same comp rights (plan never changes rights)", !!os && os.businessPlan === "self-service" && os.visitRights && os.visitRights.basis === "comp" && os.visitRights.adUse === false && os.visitRights.cannot.some((x) => /ad/i.test(x)), JSON.stringify(os && os.visitRights));
  check("paid offer: paid rights (repost + ad use for 6 months from the post date)", !!op && op.visitRights && op.visitRights.basis === "paid" && op.visitRights.adUse === true && op.visitRights.can.some((x) => /6 months/i.test(x)), JSON.stringify(op && op.visitRights));

  // ---------- Part D: momentum determinism (profile + streak) ----------
  part("D: momentum determinism");
  const full = await registerCreator({ bio: "Norfolk food writer covering the 757 dining scene, one honest plate at a time, every week.", localAudiencePct: 62 });
  await admin("POST", "/api/admin/review", { userId: full.user.id, decision: "approve" });
  await full.client("PATCH", "/api/me/profile", {
    neighborhood: "Ghent",
    maxVisitsPerWeek: 7,
    bestWork: ["https://www.instagram.com/p/aaa111/", "https://www.tiktok.com/@case/video/123", "https://www.youtube.com/watch?v=abc123"],
    audienceStack: { instagram: 3000, tiktok: 1200, facebook: 800 },
  });
  const photoRes = await full.client("POST", "/api/me/photo", { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" });
  check("photo upload accepted", photoRes.status === 200, `${photoRes.status} ${JSON.stringify(photoRes.data)}`);
  let mFull = await momentumOf(full.client);
  check("full profile momentum = photo 10 + bio 5 + neighborhood 5 + local% 5 + stack 10 + best work 15 = 50", mFull.points === 50, JSON.stringify(mFull.ledger));
  check("ledger sums to the total", ledgerSum(mFull) === mFull.points, `${ledgerSum(mFull)} vs ${mFull.points}`);
  check("checklist marks completed items done", mFull.checklist.every((i) => ["photo", "bio", "neighborhood", "local", "stack", "bestwork"].includes(i.id) ? i.done : true), JSON.stringify(mFull.checklist));

  // Five on-time posts in a row: 5 x (accept flow) with the first
  // accept worth +10, each on-time post +20, streak bonus +25.
  for (let i = 0; i < 5; i++) {
    const off = await bizC("POST", "/api/offers", { title: `Streak visit ${i + 1}`, whatComped: "Meal for two, on us", dollarCap: 100, spots: 1, creatorId: full.user.id });
    const acc = await full.client("POST", `/api/offers/${off.data.offer.id}/accept`, { visitDate: "2026-10-20" });
    const bk = await bizC("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
    const post = await full.client("POST", "/api/posts", { bookingId: acc.data.booking.id, url: `https://www.instagram.com/p/streak${i}/`, disclosedComp: true });
    if (post.status !== 201) throw new Error("streak post failed: " + JSON.stringify(post.data));
  }
  mFull = await momentumOf(full.client);
  check("after 5 on-time posts: 50 + first accept 10 + 5x20 + streak 25 = 185", mFull.points === 185, JSON.stringify(mFull.ledger));
  check("streak ledger entry exists", mFull.ledger.some((e) => e.kind === "streak_bonus" && e.points === 25), JSON.stringify(mFull.ledger.map((e) => e.kind)));

  // No-show-only creator floors at 0.
  const noshow = await registerCreator({});
  await admin("POST", "/api/admin/review", { userId: noshow.user.id, decision: "approve" });
  const offN = await bizC("POST", "/api/offers", { title: "No-show visit", whatComped: "Meal for one, on us", dollarCap: 50, spots: 1, creatorId: noshow.user.id });
  const past = new Date(Date.now() - DAY).toISOString().slice(0, 10);
  const accN = await noshow.client("POST", `/api/offers/${offN.data.offer.id}/accept`, { visitDate: past });
  check("no-show visit accepted with a past date", accN.status === 201, JSON.stringify(accN.data));
  const mNo = await momentumOf(noshow.client);
  check("no-show creator: +10 first accept, -25 no-show, floored at 0", mNo.points === 0 && mNo.floorApplied === true && mNo.ledger.some((e) => e.kind === "no_show" && e.points === -25), JSON.stringify(mNo));

  // ---------- Part E: compliance scenarios ----------
  part("E: compliance timeline");
  async function visitFor(creatorReg, title) {
    await admin("POST", "/api/admin/review", { userId: creatorReg.user.id, decision: "approve" });
    const off = await bizC("POST", "/api/offers", { title, whatComped: "Meal for two, on us", dollarCap: 100, spots: 1, creatorId: creatorReg.user.id });
    const acc = await creatorReg.client("POST", `/api/offers/${off.data.offer.id}/accept`, { visitDate: "2026-10-21" });
    const conf = await bizC("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
    if (conf.status !== 200) throw new Error("confirm failed: " + JSON.stringify(conf.data));
    return { offerId: off.data.offer.id, bookingId: acc.data.booking.id };
  }

  // On-time creator: redeem + post now.
  const ontime = await registerCreator({});
  const vOn = await visitFor(ontime, "On-time visit");
  const badHost = await ontime.client("POST", "/api/posts", { bookingId: vOn.bookingId, url: "https://www.tiktok.com/@case/video/999", disclosedComp: true });
  check("proof URL must be Instagram (TikTok link refused)", badHost.status === 400, `${badHost.status}`);
  const postOn = await ontime.client("POST", "/api/posts", { bookingId: vOn.bookingId, url: "https://www.instagram.com/p/ontime1/", disclosedComp: true });
  check("on-time proof accepted", postOn.status === 201 && postOn.data.post.onTime === true, JSON.stringify(postOn.data));
  let mOn = await momentumOf(ontime.client);
  check("on-time creator momentum: local% 5 + first accept 10 + on-time post 20 = 35", mOn.points === 35, JSON.stringify(mOn.ledger));

  // Late-in-cure, paused-then-post, and banned creators: redeem now,
  // then time travel below.
  const late = await registerCreator({});
  const vLate = await visitFor(late, "Late visit");
  const pausedC = await registerCreator({});
  const vPaused = await visitFor(pausedC, "Paused visit");
  const offPaused2 = await bizC("POST", "/api/offers", { title: "Paused second offer", whatComped: "Meal for one, on us", dollarCap: 50, spots: 1, creatorId: pausedC.user.id });
  const bannedC = await registerCreator({});
  const vBanned = await visitFor(bannedC, "Banned visit");

  await stopServer();
  editDb((db) => {
    shiftRedemption(db, late.user.id, 6.5);     // past 48h + day-5 + day-6 reminders, inside the week
    shiftRedemption(db, pausedC.user.id, 8.5);  // day 8.5: past the hard stop, inside the ban fuse
    shiftRedemption(db, bannedC.user.id, 14.5); // day 14.5: fuse burned down, ban lands
  });
  startServer();
  await waitUp();
  const admin2 = await adminClient();
  const sweep1 = await admin2("POST", "/api/admin/compliance/sweep", {});
  check("sweep ran", sweep1.status === 200, JSON.stringify(sweep1.data));

  // Late: reminders 1, 2, and 3 fired (48h, day 5, day 6), not paused.
  const lateMe = await late.client("GET", "/api/auth/me");
  check("day-6.5 creator is not paused or banned", !lateMe.data.user.standing || lateMe.data.user.standing.state === "good", JSON.stringify(lateMe.data.user.standing));
  const lateProof = await late.client("POST", "/api/posts", { bookingId: vLate.bookingId, url: "https://www.instagram.com/p/late1/", disclosedComp: true });
  check("late proof inside cure accepted and marked late", lateProof.status === 201 && lateProof.data.post.onTime === false, JSON.stringify(lateProof.data));
  const lateBookings = await late.client("GET", "/api/bookings");
  const lateBk = (lateBookings.data.bookings || []).find((b) => b.id === vLate.bookingId);
  check("booking compliance reads posted_late", !!lateBk && lateBk.compliance && lateBk.compliance.status === "posted_late", JSON.stringify(lateBk && lateBk.compliance));
  const mLate = await momentumOf(late.client);
  check("late creator momentum: local% 5 + accept 10 + late 5 - late penalty 10 = 10", mLate.points === 10 && ledgerSum(mLate) === 10, JSON.stringify(mLate.ledger));
  const lateTrack = await trackOf(bizC, late.user.id);
  check("track record counts the late post delivered but 0% on time", !!lateTrack && lateTrack.postsDelivered === 1 && lateTrack.onTimePct === 0, JSON.stringify(lateTrack));

  // Paused: standing, discovery grey state, blocked accept, proof unpauses.
  const pausedMe = await pausedC.client("GET", "/api/auth/me");
  check("day-8.5 creator is PAUSED (past the day-7 hard stop)", !!pausedMe.data.user.standing && pausedMe.data.user.standing.state === "paused", JSON.stringify(pausedMe.data.user.standing));
  const discPaused = await bizC("GET", "/api/discover?market=Hampton%20Roads");
  const pausedCard = (discPaused.data.creators || []).find((c) => c.userId === pausedC.user.id);
  check("paused creator still in discovery but flagged paused (greyed)", !!pausedCard && pausedCard.standing === "paused", JSON.stringify(pausedCard && pausedCard.standing));
  const blockedAccept = await pausedC.client("POST", `/api/offers/${offPaused2.data.offer.id}/accept`, { visitDate: "2026-10-22" });
  check("paused creator cannot accept offers", blockedAccept.status === 403, `${blockedAccept.status} ${JSON.stringify(blockedAccept.data)}`);
  const pausedProof = await pausedC.client("POST", "/api/posts", { bookingId: vPaused.bookingId, url: "https://www.instagram.com/p/paused1/", disclosedComp: true });
  check("proof while paused accepted", pausedProof.status === 201, JSON.stringify(pausedProof.data));
  const unpausedMe = await pausedC.client("GET", "/api/auth/me");
  check("proof while paused auto-unpauses", !unpausedMe.data.user.standing || unpausedMe.data.user.standing.state === "good", JSON.stringify(unpausedMe.data.user.standing));
  const mPaused = await momentumOf(pausedC.client);
  check("fuse-window proof pays +0 with the -10 penalty (local% 5 + accept 10 - 10 = 5) and the missed mark stays", mPaused.points === 5 && mPaused.ledger.some((e) => e.kind === "post_late_fuse" && e.points === 0) && mPaused.ledger.some((e) => e.kind === "post_late_penalty" && e.points === -10), JSON.stringify(mPaused.ledger));
  const afterAccept = await pausedC.client("POST", `/api/offers/${offPaused2.data.offer.id}/accept`, { visitDate: "2026-10-22" });
  check("unpaused creator can accept again", afterAccept.status === 201, `${afterAccept.status}`);

  // Banned: standing, out of discovery, public page 404, -50 in ledger.
  const bannedMe = await bannedC.client("GET", "/api/auth/me");
  check("day-14.5 creator is BANNED", !!bannedMe.data.user.standing && bannedMe.data.user.standing.state === "banned", JSON.stringify(bannedMe.data.user.standing));
  const discBanned = await bizC("GET", "/api/discover?market=Hampton%20Roads");
  check("banned creator is out of discovery entirely", !(discBanned.data.creators || []).some((c) => c.userId === bannedC.user.id));
  const pubBanned = await fetch(`${BASE}/api/c/${encodeURIComponent(bannedC.payload.handle)}`);
  check("banned creator's public profile 404s like a non-approved one", pubBanned.status === 404, `${pubBanned.status}`);
  const mBanned = await momentumOf(bannedC.client);
  check("banned creator ledger carries the -50 redeemed-never-posted penalty", mBanned.ledger.some((e) => e.kind === "never_posted" && e.points === -50), JSON.stringify(mBanned.ledger));
  check("events: reminders (incl. day-6 final warning), visit_late, missed deadline, pause, ban all logged", (await countEvents(admin2, "post_reminder_1")) >= 3 && (await countEvents(admin2, "post_reminder_3")) >= 1 && (await countEvents(admin2, "visit_late")) >= 3 && (await countEvents(admin2, "visit_deadline_missed")) >= 1 && (await countEvents(admin2, "account_paused")) >= 1 && (await countEvents(admin2, "account_banned")) >= 1 && (await countEvents(admin2, "account_unpaused")) >= 1 && (await countEvents(admin2, "proof_late_accepted")) >= 2,
    `r1=${await countEvents(admin2, "post_reminder_1")} r3=${await countEvents(admin2, "post_reminder_3")} late=${await countEvents(admin2, "visit_late")} missed=${await countEvents(admin2, "visit_deadline_missed")} paused=${await countEvents(admin2, "account_paused")} banned=${await countEvents(admin2, "account_banned")}`);

  // Reinstatement.
  const re = await admin2("POST", "/api/admin/compliance/reinstate", { userId: bannedC.user.id });
  check("admin reinstate works", re.status === 200 && re.data.user.standing.state === "good", JSON.stringify(re.data));
  check("reinstate logged", (await countEvents(admin2, "account_reinstated")) >= 1);
  const discBack = await bizC("GET", "/api/discover?market=Hampton%20Roads");
  check("reinstated creator is back in discovery", (discBack.data.creators || []).some((c) => c.userId === bannedC.user.id));
  const mBannedAfter = await momentumOf(bannedC.client);
  check("the -50 survives reinstatement (record, not a reset)", mBannedAfter.ledger.some((e) => e.kind === "never_posted" && e.points === -50), JSON.stringify(mBannedAfter.ledger));

  // ---------- Part F: ad use ----------
  // Rights model (adopted 2026-10-21): ad use attaches to the VISIT,
  // never the plan. postOn is the on-time creator's delivered post
  // from a COMP visit with the Growth business: even a Growth
  // business cannot declare ad use on it.
  part("F: ad use");
  const adUseComp = await bizC("POST", `/api/posts/${postOn.data.post.id}/ad-use`, {});
  check("comp-visit post refuses ad use even for a Growth business (403, paid visits only)", adUseComp.status === 403 && /paid visits only/i.test(JSON.stringify(adUseComp.data)), `${adUseComp.status} ${JSON.stringify(adUseComp.data)}`);
  check("the refused declaration logged no event", (await countEvents(admin2, "ad_use_declared")) === 0);
  // The paid lane: a fresh creator takes a paid offer from the same
  // Growth business, posts, and the business declares cleanly.
  const paidC = await registerCreator({});
  await admin("POST", "/api/admin/review", { userId: paidC.user.id, decision: "approve" });
  const offPaid = await bizC("POST", "/api/offers", { title: "Paid visit", whatComped: "Tasting menu for two", kind: "paid", cashRate: 250, spots: 1, creatorId: paidC.user.id });
  const accPaid = await paidC.client("POST", `/api/offers/${offPaid.data.offer.id}/accept`, { visitDate: "2026-10-21" });
  check("paid offer accepted into a paid booking", accPaid.status === 201 && !!accPaid.data.booking && accPaid.data.booking.kind === "paid", JSON.stringify(accPaid.data));
  await bizC("POST", `/api/bookings/${accPaid.data.booking.id}/confirm`, {});
  const postPaid = await paidC.client("POST", "/api/posts", { bookingId: accPaid.data.booking.id, url: "https://www.instagram.com/p/paidvisit1/", disclosedComp: true });
  check("paid visit posted", postPaid.status === 201, JSON.stringify(postPaid.data));
  const mPaidBefore = await momentumOf(paidC.client);
  const adUse = await bizC("POST", `/api/posts/${postPaid.data.post.id}/ad-use`, {});
  check("business declares ad use on a paid visit's post (window end stamped)", adUse.status === 200 && !!adUse.data.post.adUseDeclaredAt && !!adUse.data.post.adUseWindowEndsAt, JSON.stringify(adUse.data));
  check("ad_use_declared event logged", (await countEvents(admin2, "ad_use_declared")) === 1);
  const mPaidAfter = await momentumOf(paidC.client);
  check("creator gains +25 for the ad use", mPaidAfter.points === mPaidBefore.points + 25 && mPaidAfter.ledger.some((e) => e.kind === "ad_use" && e.points === 25), JSON.stringify(mPaidAfter.ledger));
  const adUse2 = await bizC("POST", `/api/posts/${postPaid.data.post.id}/ad-use`, {});
  check("second declaration on the same post refused", adUse2.status === 409, `${adUse2.status}`);
  // Ownership vs the comp gate, on a post the SELF-SERVICE business
  // owns (a comp visit): its own declaration hits the comp gate
  // (403); the growth business (not the owner) gets a 404.
  const offSelf = await selfBizC("POST", "/api/offers", { title: "Self-service visit", whatComped: "Meal for one, on us", dollarCap: 50, spots: 1, creatorId: ontime.user.id });
  const accSelf = await ontime.client("POST", `/api/offers/${offSelf.data.offer.id}/accept`, { visitDate: "2026-10-21" });
  await selfBizC("POST", `/api/bookings/${accSelf.data.booking.id}/confirm`, {});
  const postSelf = await ontime.client("POST", "/api/posts", { bookingId: accSelf.data.booking.id, url: "https://www.instagram.com/p/selfsvc1/", disclosedComp: true });
  check("self-service visit posted", postSelf.status === 201, JSON.stringify(postSelf.data));
  const adUseSelf = await selfBizC("POST", `/api/posts/${postSelf.data.post.id}/ad-use`, {});
  check("self-service business cannot declare ad use on its own comp post (comp gate, 403)", adUseSelf.status === 403 && /paid visits only/i.test(JSON.stringify(adUseSelf.data)), `${adUseSelf.status} ${JSON.stringify(adUseSelf.data)}`);
  const adUseNotOwner = await bizC("POST", `/api/posts/${postSelf.data.post.id}/ad-use`, {});
  check("a business that does not own the post gets 404", adUseNotOwner.status === 404, `${adUseNotOwner.status}`);
  const eventsBefore = await admin2("GET", "/api/admin/events?limit=2000");
  const eventCountBefore = (eventsBefore.data.events || []).length;
  const mPaidPointsBefore = (await momentumOf(paidC.client)).points;
  const pvAd = await admin2("POST", "/api/admin/preview/ad-use", { creatorId: paidC.user.id, visitKind: "paid" });
  check("preview ad use (paid visit) returns a flagged simulation", pvAd.status === 201 && pvAd.data.preview === true, JSON.stringify(pvAd.data));
  const eventsAfter = await admin2("GET", "/api/admin/events?limit=2000");
  check("preview ad use wrote no events", (eventsAfter.data.events || []).length === eventCountBefore);
  check("preview ad use awarded no points", (await momentumOf(paidC.client)).points === mPaidPointsBefore);
  const pvAdComp = await admin2("POST", "/api/admin/preview/ad-use", { creatorId: paidC.user.id, visitKind: "comp" });
  check("preview ad use on a comp visit refused (no ad right on comp visits)", pvAdComp.status === 400, `${pvAdComp.status}`);
  // The 6-month window: a paid post aged past it refuses. A second
  // paid chain, then the post is aged 200 days in the DB.
  const agedC = await registerCreator({});
  await admin("POST", "/api/admin/review", { userId: agedC.user.id, decision: "approve" });
  const offAged = await bizC("POST", "/api/offers", { title: "Paid visit, aged post", whatComped: "Tasting menu for two", kind: "paid", cashRate: 250, spots: 1, creatorId: agedC.user.id });
  const accAged = await agedC.client("POST", `/api/offers/${offAged.data.offer.id}/accept`, { visitDate: "2026-10-21" });
  await bizC("POST", `/api/bookings/${accAged.data.booking.id}/confirm`, {});
  const postAged = await agedC.client("POST", "/api/posts", { bookingId: accAged.data.booking.id, url: "https://www.instagram.com/p/paidaged1/", disclosedComp: true });
  check("second paid visit posted", postAged.status === 201, JSON.stringify(postAged.data));
  await stopServer();
  editDb((db) => shiftPostSubmitted(db, agedC.user.id, 200)); // proof is now 200 days old: outside the 6-month window
  startServer();
  await waitUp();
  const adminF = await adminClient();
  const bizCF = makeClient();
  await bizCF("POST", "/api/auth/login", { email: biz.data.user.email, password: "password123" });
  const adUseAged = await bizCF("POST", `/api/posts/${postAged.data.post.id}/ad-use`, {});
  check("paid post past its 6-month window refuses ad use (403)", adUseAged.status === 403 && /6-month/i.test(JSON.stringify(adUseAged.data)), `${adUseAged.status} ${JSON.stringify(adUseAged.data)}`);
  check("the aged refusal logged no second event", (await countEvents(adminF, "ad_use_declared")) === 1);

  // ---------- Part G: post-performance capture ----------
  part("G: performance capture");
  await stopServer();
  editDb((db) => shiftPostSubmitted(db, ontime.user.id, 8)); // proof is now 8 days old
  startServer();
  await waitUp();
  const admin3 = await adminClient();
  const ontimeC2 = makeClient();
  await ontimeC2("POST", "/api/auth/login", { email: ontime.payload.email, password: ontime.payload.password });
  const bizC2 = makeClient();
  await bizC2("POST", "/api/auth/login", { email: biz.data.user.email, password: "password123" });
  const sweep2 = await admin3("POST", "/api/admin/compliance/sweep", {});
  check("second sweep ran", sweep2.status === 200 && sweep2.data.sweep.performance >= 1, JSON.stringify(sweep2.data));
  const perfCount1 = await countEvents(admin3, "post_performance_requested");
  check("performance request event logged for the aged post", perfCount1 >= 1, `count=${perfCount1}`);
  const sweep3 = await admin3("POST", "/api/admin/compliance/sweep", {});
  check("performance email fires once per post (another sweep sends none)", (await countEvents(admin3, "post_performance_requested")) === perfCount1, `count=${await countEvents(admin3, "post_performance_requested")} vs ${perfCount1}`);
  const bizBookings = await bizC2("GET", "/api/bookings");
  const onBk = (bizBookings.data.bookings || []).find((b) => b.id === vOn.bookingId);
  check("business visit view shows the post awaiting numbers (no views yet)", !!onBk && !!onBk.post && onBk.post.views === undefined, JSON.stringify(onBk && onBk.post));
  const mOnBeforeReport = (await momentumOf(ontimeC2)).points;
  const rep = await ontimeC2("POST", `/api/bookings/${vOn.bookingId}/performance`, { views: 4200, likes: 310 });
  check("creator reports views + likes", rep.status === 200 && rep.data.post.views === 4200 && rep.data.post.likes === 310 && !!rep.data.post.reportedAt, JSON.stringify(rep.data));
  const mOn2 = await momentumOf(ontimeC2);
  check("+5 performance points land exactly once", mOn2.points === mOnBeforeReport + 5 && mOn2.ledger.filter((e) => e.kind === "performance_report").length === 1, `${mOnBeforeReport} -> ${mOn2.points} :: ${JSON.stringify(mOn2.ledger)}`);
  const rep2 = await ontimeC2("POST", `/api/bookings/${vOn.bookingId}/performance`, { views: 9999 });
  check("a second report is refused (points cannot double)", rep2.status === 409, `${rep2.status}`);
  const bizBookings2 = await bizC2("GET", "/api/bookings");
  const onBk2 = (bizBookings2.data.bookings || []).find((b) => b.id === vOn.bookingId);
  check("business visit view now shows the reported numbers", !!onBk2 && onBk2.post.views === 4200 && onBk2.post.likes === 310, JSON.stringify(onBk2 && onBk2.post));
  const track = await trackOf(bizC2, ontime.user.id);
  check("track record aggregates contentViews from reported posts", !!track && track.contentViews === 4200, JSON.stringify(track));
  const lateTrackRecord = await trackOf(bizC2, late.user.id);
  check("a creator with delivered but unreported posts has NO contentViews field (never zero-filled)", !!lateTrackRecord && !("contentViews" in lateTrackRecord), JSON.stringify(lateTrackRecord));

  // ---------- Part I: round-2 operations (windows, staff notice, honor, cap) ----------
  part("I: windows + staff notice + honor + cap");
  const bizNow = bizC2; // growth business, logged in after the last reboot

  // Window shapes on accept.
  const winC = await registerCreator({});
  await admin3("POST", "/api/admin/review", { userId: winC.user.id, decision: "approve" });
  const offW1 = await bizNow("POST", "/api/offers", { title: "Window 7d", whatComped: "Meal for one, on us", dollarCap: 50, spots: 1, creatorId: winC.user.id });
  const accW1 = await winC.client("POST", `/api/offers/${offW1.data.offer.id}/accept`, {});
  const spanMs = Date.parse(accW1.data.booking.redeemBy) - Date.parse(accW1.data.booking.createdAt);
  check("default window: redeemBy is 7 days after accepting", accW1.status === 201 && spanMs > 6.9 * DAY && spanMs < 7.1 * DAY, JSON.stringify(accW1.data.booking));
  const offW2 = await bizNow("POST", "/api/offers", { title: "Window week", whatComped: "Meal for one, on us", dollarCap: 50, spots: 1, windowMode: "thisweek", creatorId: winC.user.id });
  const accW2 = await winC.client("POST", `/api/offers/${offW2.data.offer.id}/accept`, {});
  const rb2 = new Date(accW2.data.booking.redeemBy);
  check("this-week window: redeemBy lands on a Sunday end of day, within 7 days", rb2.getUTCDay() === 0 && rb2.getTime() - Date.now() < 7 * DAY + 3600000, accW2.data.booking.redeemBy);

  // Staff notice on counter redemption and on check-in.
  const staffBefore = await countEvents(admin3, "staff_notice_sent");
  const redeemRes = await bizNow("POST", "/api/counter/redeem", { code: accW1.data.booking.code });
  check("counter redemption works", redeemRes.status === 200 && !!redeemRes.data.booking.redeemedAt, JSON.stringify(redeemRes.data));
  check("staff notice fired on redemption (event logged)", (await countEvents(admin3, "staff_notice_sent")) === staffBefore + 1, `before=${staffBefore} after=${await countEvents(admin3, "staff_notice_sent")}`);
  check("staff notice went to the mailer (stub records the attempt)", (await countEvents(admin3, "staff_notice_email_not_sent")) + (await countEvents(admin3, "staff_notice_email_sent")) >= 1);
  const staffC = await registerCreator({});
  await admin3("POST", "/api/admin/review", { userId: staffC.user.id, decision: "approve" });
  const offSt = await bizNow("POST", "/api/offers", { title: "Check-in visit", whatComped: "Meal for one, on us", dollarCap: 50, spots: 1, creatorId: staffC.user.id });
  const accSt = await staffC.client("POST", `/api/offers/${offSt.data.offer.id}/accept`, {});
  const chk = await staffC.client("POST", `/api/bookings/${accSt.data.booking.id}/checkin`, {});
  check("check-in works", chk.status === 200 && !!chk.data.booking.checkinAt, JSON.stringify(chk.data));
  check("staff notice fired on check-in too", (await countEvents(admin3, "staff_notice_sent")) === staffBefore + 2);

  // Honor reports: filed live, then time travel proves the clock is void.
  const honorC = await registerCreator({});
  await admin3("POST", "/api/admin/review", { userId: honorC.user.id, decision: "approve" });
  const offH = await bizNow("POST", "/api/offers", { title: "Honor visit", whatComped: "Meal for two, on us", dollarCap: 100, spots: 1, creatorId: honorC.user.id });
  const accH = await honorC.client("POST", `/api/offers/${offH.data.offer.id}/accept`, {});
  await bizNow("POST", `/api/bookings/${accH.data.booking.id}/confirm`, {});
  const noReason = await honorC.client("POST", `/api/bookings/${accH.data.booking.id}/honor-report`, { reason: "  " });
  check("honor report needs a reason", noReason.status === 400, `${noReason.status}`);
  const repH = await honorC.client("POST", `/api/bookings/${accH.data.booking.id}/honor-report`, { reason: "They refused the comp at the register" });
  check("honor report filed", repH.status === 200 && !!repH.data.booking.honorReportedAt, JSON.stringify(repH.data));
  const repH2 = await honorC.client("POST", `/api/bookings/${accH.data.booking.id}/honor-report`, { reason: "again" });
  check("a visit can only be reported once", repH2.status === 409, `${repH2.status}`);
  check("business_honor_report event logged", (await countEvents(admin3, "business_honor_report")) === 1);
  const honor2 = await registerCreator({});
  await admin3("POST", "/api/admin/review", { userId: honor2.user.id, decision: "approve" });
  const offH2 = await bizNow("POST", "/api/offers", { title: "Honor visit 2", whatComped: "Meal for two, on us", dollarCap: 100, spots: 1, creatorId: honor2.user.id });
  const accH2 = await honor2.client("POST", `/api/offers/${offH2.data.offer.id}/accept`, {});
  await bizNow("POST", `/api/bookings/${accH2.data.booking.id}/confirm`, {});
  await honor2.client("POST", `/api/bookings/${accH2.data.booking.id}/honor-report`, { reason: "Manager said the comp was not real" });
  const compView = await admin3("GET", "/api/admin/compliance");
  const bizRow = (compView.data.businesses || []).find((x) => x.businessId === biz.data.user.id);
  check("admin compliance aggregates honor reports per business", !!bizRow && bizRow.reports === 2, JSON.stringify(compView.data.businesses));
  check("two reports raise the admin warning flag", !!bizRow && bizRow.warning === true);

  // Expiry: a fresh accept whose window we push into the past.
  const expC = await registerCreator({});
  await admin3("POST", "/api/admin/review", { userId: expC.user.id, decision: "approve" });
  const offX = await bizNow("POST", "/api/offers", { title: "Expiring visit", whatComped: "Meal for one, on us", dollarCap: 50, spots: 1, creatorId: expC.user.id });
  const accX = await expC.client("POST", `/api/offers/${offX.data.offer.id}/accept`, {});

  await stopServer();
  editDb((db) => {
    shiftRedemption(db, honorC.user.id, 15); // would be banned by now without the honor report
    for (const [key, val] of Object.entries(db)) {
      if (key.startsWith("booking:") && val.creatorId === expC.user.id) {
        val.redeemBy = new Date(Date.now() - 3600000).toISOString();
      }
    }
  });
  startServer();
  await waitUp();
  const admin4 = await adminClient();
  const expC2 = makeClient();
  await expC2("POST", "/api/auth/login", { email: expC.payload.email, password: expC.payload.password });
  const honorC2 = makeClient();
  await honorC2("POST", "/api/auth/login", { email: honorC.payload.email, password: honorC.payload.password });
  const sweep4 = await admin4("POST", "/api/admin/compliance/sweep", {});
  check("sweep expired the unused window", sweep4.status === 200 && sweep4.data.sweep.expired >= 1, JSON.stringify(sweep4.data));
  const expBookings = await expC2("GET", "/api/bookings");
  const expBk = (expBookings.data.bookings || []).find((b) => b.id === accX.data.booking.id);
  check("expired booking reads status expired + compliance expired", !!expBk && expBk.status === "expired" && expBk.compliance && expBk.compliance.status === "expired", JSON.stringify(expBk && expBk.compliance));
  check("offer_expired event logged", (await countEvents(admin4, "offer_expired")) >= 1);
  const mExp = await momentumOf(expC2);
  check("window expiry counts as a no-show: local% 5 + accept 10, -25 no-show, floored at 0", mExp.points === 0 && mExp.floorApplied === true && mExp.ledger.some((e) => e.kind === "no_show" && e.points === -25), JSON.stringify(mExp.ledger));
  const honorMe = await honorC2("GET", "/api/auth/me");
  check("honor-reported creator is NOT banned after day 15 (clock voided)", !honorMe.data.user.standing || honorMe.data.user.standing.state === "good", JSON.stringify(honorMe.data.user.standing));
  const mHonor = await momentumOf(honorC2);
  check("honor-reported visit costs the creator nothing (local% 5 + first accept 10, no penalties)", mHonor.points === 15 && !mHonor.ledger.some((e) => e.points < 0), JSON.stringify(mHonor.ledger));
  const honorBookings = await honorC2("GET", "/api/bookings");
  const honorBk = (honorBookings.data.bookings || []).find((b) => b.id === accH.data.booking.id);
  check("honor-reported booking reads honor_reported", !!honorBk && honorBk.compliance && honorBk.compliance.status === "honor_reported", JSON.stringify(honorBk && honorBk.compliance));

  // Weekly cap: at cap, offers still arrive, accepting is blocked.
  const capC = await registerCreator({});
  await admin4("POST", "/api/admin/review", { userId: capC.user.id, decision: "approve" });
  await capC.client("PATCH", "/api/me/profile", { maxVisitsPerWeek: 1 });
  const bizC3 = makeClient();
  await bizC3("POST", "/api/auth/login", { email: biz.data.user.email, password: "password123" });
  const offK1 = await bizC3("POST", "/api/offers", { title: "Cap visit 1", whatComped: "Meal for one, on us", dollarCap: 50, spots: 1, creatorId: capC.user.id });
  const offK2 = await bizC3("POST", "/api/offers", { title: "Cap visit 2", whatComped: "Meal for one, on us", dollarCap: 50, spots: 1, creatorId: capC.user.id });
  const accK1 = await capC.client("POST", `/api/offers/${offK1.data.offer.id}/accept`, {});
  check("first accept under a cap of 1 works", accK1.status === 201, JSON.stringify(accK1.data));
  const accK2 = await capC.client("POST", `/api/offers/${offK2.data.offer.id}/accept`, {});
  check("accepting at cap is blocked with a plain explanation", accK2.status === 403 && /max of 1 visit/.test(accK2.data.error || ""), `${accK2.status} ${JSON.stringify(accK2.data)}`);
  const kOffers = await capC.client("GET", "/api/offers");
  check("offers still arrive at cap (the second offer is still listed)", (kOffers.data.offers || []).some((o) => o.id === offK2.data.offer.id));
  const discK = await bizC3("GET", "/api/discover?market=Hampton%20Roads");
  const kCard = (discK.data.creators || []).find((c) => c.userId === capC.user.id);
  check("discovery flags the capped creator as booked up (visible, not greyed)", !!kCard && kCard.bookedUp === true && kCard.standing === "good", JSON.stringify(kCard && { bookedUp: kCard.bookedUp, standing: kCard.standing }));

  // Preview isolation for round 2: windowed preview offers write nothing.
  const evBefore = (await admin4("GET", "/api/admin/events?limit=2000")).data.events.length;
  const pvWin = await admin4("POST", "/api/admin/preview/offers", { title: "Preview window", whatComped: "Meal for two", dollarCap: 90, spots: 1, windowMode: "thisweek", creatorId: capC.user.id, market: "Hampton Roads" });
  check("preview offer carries the window mode and stays a simulation", pvWin.status === 201 && pvWin.data.preview === true && pvWin.data.offer.windowMode === "thisweek", JSON.stringify(pvWin.data));
  const evAfter = (await admin4("GET", "/api/admin/events?limit=2000")).data.events.length;
  check("preview round-2 actions wrote no events", evAfter === evBefore, `${evBefore} -> ${evAfter}`);

  // ---------- Part H: client copy guards ----------
  part("H: client copy");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("signup carries the post-compliance agreement checkbox", appJs.includes("jc-agree-compliance") && appJs.includes("agreedPostCompliance"));
  check("My Visits proof block is headed Post your proof", appJs.includes("Post your proof"));
  check("momentum block explains points decide order", appJs.includes("Points decide the order businesses see you in"));
  check("compliance tab wired in the client", appJs.includes("loadCompliance") && appJs.includes("/admin/compliance"));
  check("ad use action wired in the client", appJs.includes("declareAdUse") && appJs.includes("/ad-use"));
  check("performance form wired in the client", appJs.includes("submitPostPerformance") && appJs.includes("/performance"));
  check("no stale two-plan pricing in the client", !appJs.includes("$799"), "found $799");
  check("window mode wired in the client", appJs.includes("o-windowmode") && appJs.includes("windowMode") && appJs.includes("Use by"));
  check("honor report wired in the client", appJs.includes("submitHonorReport") && appJs.includes("/honor-report"));
  check("weekly cap setting wired in the client", appJs.includes("p-maxvisits") && appJs.includes("maxVisitsPerWeek"));
  check("booked-up state renders in the client", appJs.includes("Booked up this week"));
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nCompliance verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
