#!/usr/bin/env node
// Wave 1 server verification (UX redesign, 2026-10-24): the mobile
// overhaul's data layer, proved against a throwaway local DB:
//   - COMP_GUIDANCE typicals (locked guidance) in the module and
//     in the bootstrap offerGuidance the composer reads;
//   - performance snapshots: a second report appends (no 409),
//     unprovided numbers carry forward, the flat fields mirror the
//     latest snapshot, reportedAt never moves (Momentum +5 once),
//     the summary payload carries growth math;
//   - refresh asks: the day-7 ask gains an in-app note; the day-14
//     ask fires once for a stale reported post (marker + event);
//   - the metrics sync seam: route answers the enabled:false
//     summary under sweep-token auth, refuses anonymous callers;
//   - average ticket: save, clear, invalid, and visibility on
//     /api/auth/me (publicUser passes the business object through);
//   - code-use logging: owner path (counts, defaults, validation,
//     creator 403, foreign business 404), staff path (ccode index,
//     own business only, wrong business 404, no session 401);
//   - ROAS estimates: estimate vs tracked, a tally replaces the
//     estimate for its booking, registerSource values, the shared
//     avgTicket rule in registerEstimate;
//   - notification badges by kind, total = all unread, messages 0
//     until a message actually arrives (Wave 2: the message-send
//     route now writes a "message_received" note for the other
//     participant, one live signal per thread, and badges count
//     it; the offer dedupe 409 is pinned in the same part);
//   - AB1 copy: compliance reminder emails state plain
//     consequences, with no pause/ban timings and no em dashes.
//
// Run: node scripts/verify-metrics.mjs

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require2 = createRequire(import.meta.url);
const R = require2("../netlify/functions/lib/router.js");

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8947;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "metrics-" + "admin-" + "pw";
const SWEEP_TOKEN = "metrics-test-" + "sweep-" + "token";
const DAY = 24 * 3600 * 1000;

let passed = 0;
let failed = 0;
const failures = [];
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; failures.push(name); console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-metrics-"));
const dbFile = path.join(tmp, "db.json");
let server = null;

function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD, SIGNL_SWEEP_TOKEN: SWEEP_TOKEN },
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
  const api = async function (method, p, body, headers = {}) {
    const h = { "Content-Type": "application/json", ...headers };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (v) jar.set(k, v); else jar.delete(k);
      }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html error page */ }
    return { status: res.status, data, text };
  };
  api.jar = jar;
  return api;
}

async function rawWithHeaders(method, p, { body, headers = {} } = {}) {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not json */ }
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, data, text, setCookies };
}
function cookieValue(setCookies, name) {
  for (const sc of setCookies || []) {
    const pair = sc.split(";")[0];
    const i = pair.indexOf("=");
    if (i > -1 && pair.slice(0, i).trim() === name) return pair.slice(i + 1).trim();
  }
  return null;
}

const uniq = () => Math.random().toString(36).slice(2, 9);
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}
function eventData(e) {
  if (!e) return {};
  if (typeof e.data === "string") { try { return JSON.parse(e.data); } catch (err) { return {}; } }
  return e.data || {};
}

try {
  // ---------- unit level: guidance, roas math, summary, AB1 copy ----------
  part("unit: guidance + roas + summary + AB1");
  check("COMP_GUIDANCE typicals are the locked guidance (floors unchanged)",
    R.COMP_GUIDANCE.Neighbors.typicalLow === 25 && R.COMP_GUIDANCE.Neighbors.typicalHigh === 75 && R.COMP_GUIDANCE.Neighbors.floor === 25 &&
    R.COMP_GUIDANCE.Locals.typicalLow === 75 && R.COMP_GUIDANCE.Locals.typicalHigh === 250 && R.COMP_GUIDANCE.Locals.floor === 50 &&
    R.COMP_GUIDANCE.Headliners.typicalLow === 250 && R.COMP_GUIDANCE.Headliners.typicalHigh === 750 && R.COMP_GUIDANCE.Headliners.floor === 100,
    JSON.stringify(R.COMP_GUIDANCE));

  const est = R.roasFor([{ codeUseCount: 7, avgTicket: 40, dollarCap: 50 }]);
  check("roasFor: code uses x average ticket is an estimate, apart from tracked register value",
    est.estimatedRegisterValue === 280 && est.registerValue === 0 && est.registerSource === "estimated" &&
    est.registerEstimate.uses === 7 && est.registerEstimate.avgTicket === 40 && est.registerEstimate.value === 280 && est.value === 280,
    JSON.stringify(est));
  const tracked = R.roasFor([{ redemptions: { count: 3, basketTotal: 120, discountPct: 0 }, codeUseCount: 7, avgTicket: 40, dollarCap: 50 }]);
  check("roasFor: an actual tally replaces the estimate for that booking",
    tracked.registerValue === 120 && tracked.estimatedRegisterValue === 0 && tracked.registerSource === "tracked" && tracked.value === 120,
    JSON.stringify(tracked));
  const mixed = R.roasFor([
    { redemptions: { count: 1, basketTotal: 60, discountPct: 0 }, dollarCap: 10 },
    { codeUseCount: 2, avgTicket: 40, dollarCap: 10 },
  ]);
  check("roasFor: tracked + estimated reads registerSource mixed", mixed.registerSource === "mixed" && mixed.registerValue === 60 && mixed.estimatedRegisterValue === 80 && mixed.value === 140, JSON.stringify(mixed));
  const none = R.roasFor([{ dollarCap: 10 }]);
  check("roasFor: no tally and no uses reads registerSource none with a zero estimate",
    none.registerSource === "none" && none.estimatedRegisterValue === 0 && none.registerEstimate.avgTicket === null && none.registerEstimate.uses === 0, JSON.stringify(none));
  const twoTickets = R.roasFor([{ codeUseCount: 1, avgTicket: 40, dollarCap: 10 }, { codeUseCount: 1, avgTicket: 55, dollarCap: 10 }]);
  check("roasFor: registerEstimate.avgTicket is null when estimated bookings disagree on the ticket",
    twoTickets.registerEstimate.avgTicket === null && twoTickets.estimatedRegisterValue === 95, JSON.stringify(twoTickets.registerEstimate));
  const noTicket = R.roasFor([{ codeUseCount: 5, avgTicket: null, dollarCap: 10 }]);
  check("roasFor: uses without an average ticket produce no estimate (preview/fixture safe)",
    noTicket.estimatedRegisterValue === 0 && noTicket.registerSource === "none", JSON.stringify(noTicket));

  const sum = R.performanceSummary({
    reportedAt: "2026-10-01T00:00:00.000Z", lastSnapshotAt: "2026-10-08T00:00:00.000Z",
    views: 150, likes: 12, comments: 3, shares: 1,
    snapshots: [
      { at: "2026-10-01T00:00:00.000Z", views: 100, likes: 9, comments: 2, shares: 1, source: "creator_report" },
      { at: "2026-10-08T00:00:00.000Z", views: 150, likes: 12, comments: 3, shares: 1, source: "creator_report" },
    ],
  });
  check("performanceSummary: latest mirrored, growth pct from first to latest, count and source",
    sum.reported === true && sum.views === 150 && sum.snapshots === 2 && sum.viewsGrowthPct === 50 && sum.firstAt === "2026-10-01T00:00:00.000Z" && sum.updatedAt === "2026-10-08T00:00:00.000Z" && sum.source === "creator_report",
    JSON.stringify(sum));
  const sumOne = R.performanceSummary({ reportedAt: "2026-10-01T00:00:00.000Z", views: 10, snapshots: [{ at: "2026-10-01T00:00:00.000Z", views: 10, likes: null, comments: null, shares: null, source: "creator_report" }] });
  check("performanceSummary: growth is null with fewer than 2 snapshots", sumOne.viewsGrowthPct === null && sumOne.snapshots === 1, JSON.stringify(sumOne));
  const sumZero = R.performanceSummary({ reportedAt: "2026-10-01T00:00:00.000Z", views: 5, snapshots: [{ at: "2026-10-01T00:00:00.000Z", views: 0, likes: 0, comments: 0, shares: 0, source: "creator_report" }, { at: "2026-10-02T00:00:00.000Z", views: 5, likes: 0, comments: 0, shares: 0, source: "creator_report" }] });
  check("performanceSummary: growth is null when the first views are 0", sumZero.viewsGrowthPct === null, JSON.stringify(sumZero));

  const fakeCreator = { name: "Casey Metrics", email: "casey@fixtures.dev" };
  const fakeBooking = { businessName: "Metrics Kitchen", postDeadline: new Date(Date.now() + DAY).toISOString(), redeemedAt: new Date().toISOString() };
  for (const stage of [1, 2, 3]) {
    const mail = R.complianceReminderEmail(fakeCreator, fakeBooking, stage);
    check(`AB1: reminder stage ${stage} drops pause/ban dates and the strike threshold`,
      !/hard stop/i.test(mail.text) && !/one week|two weeks/i.test(mail.text) && !/pauses tomorrow/i.test(mail.text) &&
      !mail.text.includes("—") && !mail.subject.includes("—") && mail.text.includes("repeated misses can pause your account"),
      `${mail.subject} :: ${mail.text.slice(0, 200)}`);
  }
  const updMail = R.postPerformanceUpdateEmail(fakeCreator, fakeBooking);
  check("refresh ask email: house pattern, growth framing, no em dash, no compliance specifics",
    updMail.subject === "Your post is still growing: update its numbers" && updMail.text.includes("still collecting views") &&
    updMail.text.includes("the business sees these numbers on their results") && !updMail.text.includes("—") && !/strike|pause|ban/i.test(updMail.text),
    updMail.text.slice(0, 200));

  // ---------- HTTP fixtures ----------
  part("fixtures");
  startServer();
  await waitUp();
  const anon = makeClient();
  const admin = makeClient();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin", `${adminLogin.status}`);
  const boot = await anon("GET", "/api/bootstrap");
  const cg = (boot.data.offerGuidance || {}).compGuidance || {};
  check("bootstrap offerGuidance carries the locked typicals",
    cg.Locals && cg.Locals.typicalLow === 75 && cg.Locals.typicalHigh === 250 && cg.Headliners && cg.Headliners.typicalLow === 250 && cg.Headliners.typicalHigh === 750 && cg.Neighbors && cg.Neighbors.typicalLow === 25 && cg.Neighbors.typicalHigh === 75,
    JSON.stringify(cg));

  async function approve(userId) {
    const r = await admin("POST", "/api/admin/review", { userId, decision: "approve" });
    if (r.status !== 200) throw new Error(`approve failed: ${r.status} ${JSON.stringify(r.data)}`);
  }
  async function registerCreator(handle) {
    const client = makeClient();
    const r = await client("POST", "/api/auth/register", {
      role: "creator", name: `Metrics Creator ${handle}`, email: `${handle}@fixtures.dev`, password: "password123",
      market: "Hampton Roads", city: "Norfolk", handle,
      categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
      followerCount: 5000, avgViews: 900, localAudiencePct: 62, bio: "",
      agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
    });
    if (r.status !== 201 || !r.data.user) throw new Error(`creator register failed: ${r.status} ${JSON.stringify(r.data)}`);
    return { client, user: r.data.user, email: `${handle}@fixtures.dev` };
  }
  async function registerBusiness(businessName) {
    const client = makeClient();
    const email = `biz-${uniq()}@fixtures.dev`;
    const r = await client("POST", "/api/auth/register", {
      role: "business", name: "Biz Owner", email, password: "password123",
      market: "Hampton Roads", city: "Norfolk", businessName, category: "Restaurant", planId: "growth", agreedTerms: true,
    });
    if (r.status !== 201 || !r.data.user) throw new Error(`business register failed: ${r.status} ${JSON.stringify(r.data)}`);
    return { client, user: r.data.user, email };
  }
  async function compBooking(business, creator, title) {
    const off = await business("POST", "/api/offers", { title, whatComped: "Dinner for two", dollarCap: 50, spots: 1, creatorId: creator.user.id });
    if (off.status !== 201) throw new Error(`offer failed: ${off.status} ${JSON.stringify(off.data)}`);
    const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
    if (acc.status !== 201) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.data)}`);
    return acc.data.booking;
  }
  async function completeVisit(booking, business, creator) {
    const conf = await business("POST", `/api/bookings/${booking.id}/confirm`, {});
    if (conf.status !== 200) throw new Error(`confirm failed: ${conf.status} ${JSON.stringify(conf.data)}`);
    const post = await creator("POST", "/api/posts", { bookingId: booking.id, url: "https://www.instagram.com/p/METRICS1/", includesDisclosure: true });
    if (post.status !== 201) throw new Error(`post failed: ${post.status} ${JSON.stringify(post.data)}`);
    return post.data.post;
  }
  async function getBooking(client, id) {
    const r = await client("GET", "/api/bookings");
    const b = (r.data.bookings || []).find((x) => x.id === id);
    if (!b) throw new Error(`booking ${id} not visible`);
    return b;
  }
  async function countEvents(type) {
    const r = await admin("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=2000`);
    return r.data.events || [];
  }

  const u = uniq();
  const biz = await registerBusiness("Metrics Kitchen");
  const biz2 = await registerBusiness("Metrics Other Table");
  const c1 = await registerCreator(`metricscooks${u}`);
  await approve(c1.user.id); await approve(biz.user.id); await approve(biz2.user.id);
  await admin("POST", "/api/admin/businesses/activate", { userId: biz.user.id });
  await admin("POST", "/api/admin/businesses/activate", { userId: biz2.user.id });
  check("fixtures ready: 1 creator, 2 activated businesses", true);

  // ---------- average ticket ----------
  part("average ticket");
  const badTicket1 = await biz.client("PATCH", "/api/me/profile", { averageTicket: -5 });
  const badTicket2 = await biz.client("PATCH", "/api/me/profile", { averageTicket: "abc" });
  const badTicket3 = await biz.client("PATCH", "/api/me/profile", { averageTicket: 100001 });
  check("invalid average tickets are refused (negative, non-numeric, over the cap)",
    badTicket1.status === 400 && badTicket2.status === 400 && badTicket3.status === 400,
    `${badTicket1.status}/${badTicket2.status}/${badTicket3.status}`);
  const setTicket = await biz.client("PATCH", "/api/me/profile", { averageTicket: 40 });
  check("average ticket saves on the business record the owner sees",
    setTicket.status === 200 && setTicket.data.user.business.averageTicket === 40,
    `${setTicket.status} ${JSON.stringify(setTicket.data.user ? setTicket.data.user.business : setTicket.data).slice(0, 160)}`);
  const meTicket = await biz.client("GET", "/api/auth/me");
  check("average ticket reaches the session payload (business object passes through whole)",
    meTicket.data.user.business.averageTicket === 40, JSON.stringify(meTicket.data.user.business || {}).slice(0, 160));
  const clearTicket = await biz.client("PATCH", "/api/me/profile", { averageTicket: null });
  check("null clears the average ticket",
    clearTicket.status === 200 && clearTicket.data.user.business.averageTicket === undefined,
    `${clearTicket.status} ${JSON.stringify(clearTicket.data.user ? clearTicket.data.user.business : {}).slice(0, 160)}`);
  const setTicket2 = await biz.client("PATCH", "/api/me/profile", { averageTicket: 40 });
  check("average ticket re-set to $40 for the ROAS flow", setTicket2.status === 200 && setTicket2.data.user.business.averageTicket === 40);

  // ---------- performance snapshots ----------
  part("performance snapshots");
  const bk1 = await compBooking(biz.client, c1, "Metrics tasting one");
  await completeVisit(bk1, biz.client, c1.client);
  const rep1 = await c1.client("POST", `/api/bookings/${bk1.id}/performance`, { views: 1000, likes: 100 });
  check("first report opens the time series (snapshot 1, reportedAt set, summary attached)",
    rep1.status === 200 && Array.isArray(rep1.data.post.snapshots) && rep1.data.post.snapshots.length === 1 &&
    rep1.data.post.snapshots[0].source === "creator_report" && !!rep1.data.post.reportedAt &&
    rep1.data.post.performance && rep1.data.post.performance.reported === true && rep1.data.post.performance.snapshots === 1 && rep1.data.post.performance.viewsGrowthPct === null,
    `${rep1.status} ${JSON.stringify(rep1.data.post || rep1.data).slice(0, 240)}`);
  const mBefore = await c1.client("GET", "/api/auth/me");
  const rep2 = await c1.client("POST", `/api/bookings/${bk1.id}/performance`, { views: 1500 });
  check("second report appends a snapshot (no 409), mirrors latest, carries unprovided numbers forward",
    rep2.status === 200 && rep2.data.post.snapshots.length === 2 && rep2.data.post.views === 1500 && rep2.data.post.likes === 100 &&
    rep2.data.post.snapshots[1].likes === 100 && rep2.data.post.performance.viewsGrowthPct === 50 && rep2.data.post.performance.updatedAt === rep2.data.post.lastSnapshotAt,
    `${rep2.status} ${JSON.stringify(rep2.data.post || rep2.data).slice(0, 240)}`);
  check("reportedAt is unchanged by the second report (Momentum +5 can only land once)",
    rep2.data.post.reportedAt === rep1.data.post.reportedAt, `${rep1.data.post.reportedAt} -> ${rep2.data.post.reportedAt}`);
  const mAfter = await c1.client("GET", "/api/auth/me");
  const perfLedger = (mAfter.data.user.momentum.ledger || []).filter((e) => e.kind === "performance_report");
  check("Momentum performance points land exactly once across both reports",
    perfLedger.length === 1 && mAfter.data.user.momentum.points === mBefore.data.user.momentum.points,
    `${mBefore.data.user.momentum.points} -> ${mAfter.data.user.momentum.points} ledger=${perfLedger.length}`);
  const badPerf = await c1.client("POST", `/api/bookings/${bk1.id}/performance`, { views: -3 });
  const emptyPerf = await c1.client("POST", `/api/bookings/${bk1.id}/performance`, {});
  check("performance validation is unchanged (whole numbers, at least one required)",
    badPerf.status === 400 && emptyPerf.status === 400, `${badPerf.status}/${emptyPerf.status}`);
  const bizNotesAfterPerf = await biz.client("GET", "/api/notifications");
  const perfNotes = (bizNotesAfterPerf.data.notifications || []).filter((n) => n.data && n.data.bookingId === bk1.id);
  check("business got the milestone on the first report and the quiet in-app update on the second",
    perfNotes.filter((n) => n.kind === "performance_reported").length === 1 && perfNotes.filter((n) => n.kind === "performance_updated").length === 1,
    JSON.stringify(perfNotes.map((n) => n.kind)));

  // ---------- code-use logging: owner ----------
  part("code-uses owner");
  const asCreator = await c1.client("POST", `/api/bookings/${bk1.id}/code-uses`, { count: 1 });
  check("a creator cannot log code uses (403)", asCreator.status === 403, String(asCreator.status));
  const log3 = await biz.client("POST", `/api/bookings/${bk1.id}/code-uses`, { count: 3 });
  check("owner logs 3 uses in one call: one record, running count 3",
    log3.status === 200 && log3.data.booking.codeUseCount === 3, `${log3.status} ${JSON.stringify(log3.data.booking || log3.data).slice(0, 160)}`);
  const logDefault = await biz.client("POST", `/api/bookings/${bk1.id}/code-uses`, {});
  check("count defaults to 1", logDefault.status === 200 && logDefault.data.booking.codeUseCount === 4, `${logDefault.status}`);
  const logBad1 = await biz.client("POST", `/api/bookings/${bk1.id}/code-uses`, { count: 0 });
  const logBad2 = await biz.client("POST", `/api/bookings/${bk1.id}/code-uses`, { count: 501 });
  const logBad3 = await biz.client("POST", `/api/bookings/${bk1.id}/code-uses`, { count: 2.5 });
  check("invalid counts are refused (0, over 500, fractional)",
    logBad1.status === 400 && logBad2.status === 400 && logBad3.status === 400, `${logBad1.status}/${logBad2.status}/${logBad3.status}`);
  const bk1Est = await getBooking(biz.client, bk1.id);
  check("booking ROAS shows the estimate: 4 uses x $40 ticket, labeled estimated",
    bk1Est.roas.estimatedRegisterValue === 160 && bk1Est.roas.registerValue === 0 && bk1Est.roas.registerSource === "estimated" &&
    bk1Est.roas.registerEstimate.uses === 4 && bk1Est.roas.registerEstimate.avgTicket === 40 && bk1Est.roas.registerEstimate.value === 160,
    JSON.stringify(bk1Est.roas));
  const home = await biz.client("GET", "/api/me/business-home");
  // Home aggregate: value is the $160 estimate alone (the home
  // aggregate has never attached post media), cost is the $50 comp
  // basis, so the score is 160 / 50 = 3.2 where it used to be 0.
  check("business home aggregate carries the estimate too (score 3.2 from the estimate)",
    home.status === 200 && home.data.home && home.data.home.roasScore === 3.2, JSON.stringify(home.data.home || {}).slice(0, 200));

  // ---------- code-use logging: staff ----------
  part("code-uses staff");
  const bk2 = await compBooking(biz2.client, c1, "Metrics tasting two");
  await completeVisit(bk2, biz2.client, c1.client);
  const repBk2 = await c1.client("POST", `/api/bookings/${bk2.id}/performance`, { views: 500, likes: 40 });
  check("second booking's post reported (day-14 fixture)", repBk2.status === 200 && repBk2.data.post.views === 500, `${repBk2.status}`);

  const ownerLogin = await rawWithHeaders("POST", "/api/auth/login", { body: { email: biz.email, password: "password123" } });
  const ownerCookie = `signl_session=${cookieValue(ownerLogin.setCookies, "signl_session")}`;
  const setPin = await rawWithHeaders("POST", "/api/me/staff/pin", { body: { pin: "2468" }, headers: { Cookie: ownerCookie } });
  const staffSettings = await rawWithHeaders("GET", "/api/me/staff", { headers: { Cookie: ownerCookie } });
  check("owner sets the staff PIN and reads the staff code", setPin.status === 200 && typeof staffSettings.data.staffCode === "string", JSON.stringify(staffSettings.data).slice(0, 160));
  const entered = await rawWithHeaders("POST", "/api/staff/enter", { body: { businessCode: staffSettings.data.staffCode, pin: "2468" } });
  const staffCookie = `signl_staff=${cookieValue(entered.setCookies, "signl_staff")}`;
  check("staff session opens", entered.status === 200 && !!cookieValue(entered.setCookies, "signl_staff"), `${entered.status}`);
  const noSess = await rawWithHeaders("POST", "/api/staff/code-use", { body: { creatorCode: bk1.creatorCode } });
  check("staff code-use without a staff session: 401", noSess.status === 401, String(noSess.status));
  const foreignUse = await rawWithHeaders("POST", "/api/staff/code-use", { body: { creatorCode: bk2.creatorCode }, headers: { Cookie: staffCookie } });
  check("staff code-use with another business's creator code: 404, nothing logged",
    foreignUse.status === 404, `${foreignUse.status} ${JSON.stringify(foreignUse.data).slice(0, 160)}`);
  const ownUse = await rawWithHeaders("POST", "/api/staff/code-use", { body: { creatorCode: bk1.creatorCode.toLowerCase() }, headers: { Cookie: staffCookie } });
  check("staff logs one use by creator code (case-insensitive), returns creator and running count",
    ownUse.status === 200 && ownUse.data.creatorName === bk1.creatorName && ownUse.data.codeUseCount === 5,
    `${ownUse.status} ${JSON.stringify(ownUse.data).slice(0, 200)}`);
  const codeUseEvents = await countEvents("code_use_logged");
  check("code_use_logged events cover owner (2 calls) and staff (1 call), none for the 404",
    codeUseEvents.filter((e) => e.subjectId === bk1.id).length === 3 && codeUseEvents.filter((e) => e.subjectId === bk1.id && eventData(e).via === "staff").length === 1,
    `total=${codeUseEvents.length} bk1=${codeUseEvents.filter((e) => e.subjectId === bk1.id).length}`);

  // ---------- tally replaces the estimate ----------
  part("estimate to actual");
  const tally = await biz.client("POST", `/api/bookings/${bk1.id}/code-redemptions`, { count: 2, basketTotal: 90 });
  check("once a tally exists, the estimate for that booking is gone (tracked only)",
    tally.status === 200 && tally.data.booking.roas.registerValue === 90 && tally.data.booking.roas.estimatedRegisterValue === 0 && tally.data.booking.roas.registerSource === "tracked",
    `${tally.status} ${JSON.stringify(tally.data.booking ? tally.data.booking.roas : tally.data)}`);

  // ---------- badges ----------
  part("badges");
  const bizNotes = await biz.client("GET", "/api/notifications");
  check("business badges: visits count milestone kinds, total is all unread, messages 0",
    bizNotes.data.badges && bizNotes.data.badges.visits >= 2 && bizNotes.data.badges.total === bizNotes.data.unreadCount && bizNotes.data.badges.messages === 0,
    JSON.stringify(bizNotes.data.badges));
  await c1.client("POST", "/api/notifications/read");
  const cNotes0 = await c1.client("GET", "/api/notifications");
  check("after mark-read the creator's badges are all zero",
    cNotes0.data.badges.offers === 0 && cNotes0.data.badges.visits === 0 && cNotes0.data.badges.messages === 0 && cNotes0.data.badges.total === 0,
    JSON.stringify(cNotes0.data.badges));
  const offBadge = await biz.client("POST", "/api/offers", { title: "Badge check offer", whatComped: "Dinner for two", dollarCap: 50, spots: 1, creatorId: c1.user.id });
  check("badge fixture offer created", offBadge.status === 201, `${offBadge.status}`);
  const cNotes1 = await c1.client("GET", "/api/notifications");
  check("a new direct offer lands in the creator's offers badge only",
    cNotes1.data.badges.offers === 1 && cNotes1.data.badges.visits === 0 && cNotes1.data.badges.messages === 0 && cNotes1.data.badges.total === 1,
    JSON.stringify(cNotes1.data.badges));

  // ---------- wave 2: message badges + offer dedupe ----------
  part("wave2 badges + dedupe");
  const msg1 = await biz.client("POST", "/api/messages", { toUserId: c1.user.id, body: "Hi from the metrics fixture" });
  const msg2 = await biz.client("POST", "/api/messages", { toUserId: c1.user.id, body: "Second message, same thread" });
  const cNotesMsg = await c1.client("GET", "/api/notifications");
  check("message sent: recipient's messages badge is 1 (two messages in one thread still signal once)",
    msg1.status === 201 && msg2.status === 201 && cNotesMsg.data.badges && cNotesMsg.data.badges.messages === 1,
    `${msg1.status}/${msg2.status} ${JSON.stringify(cNotesMsg.data.badges)}`);
  const bizNotesMsg = await biz.client("GET", "/api/notifications");
  check("message sent: the sender's own messages badge stays 0",
    bizNotesMsg.data.badges && bizNotesMsg.data.badges.messages === 0, JSON.stringify(bizNotesMsg.data.badges));
  const dupBody = { title: "Dedupe tasting night", whatComped: "Dinner for two", includes: "Two entrees and two drinks", dollarCap: 60, spots: 2, covers: 2, applyWindowDays: 3, windowDays: 7 };
  const dup1 = await biz.client("POST", "/api/offers", dupBody);
  const dup2 = await biz.client("POST", "/api/offers", { ...dupBody, title: "  Dedupe   tasting night " });
  check("offer dedupe: an identical open offer returns 409 with the existing offer id (title normalized)",
    dup1.status === 201 && dup2.status === 409 && dup2.data.error === "This offer is already open" && dup2.data.existingOfferId === dup1.data.offer.id,
    `${dup1.status}/${dup2.status} ${JSON.stringify(dup2.data).slice(0, 200)}`);
  const dup3 = await biz.client("POST", "/api/offers", { ...dupBody, title: "Dedupe tasting night two" });
  check("offer dedupe: a different title is a different offer (201)",
    dup3.status === 201 && dup3.data.offer.id !== dup1.data.offer.id, `${dup3.status}`);
  const closeDup = await biz.client("POST", `/api/offers/${dup3.data.offer.id}/close`, {});
  const dup4 = await biz.client("POST", "/api/offers", { ...dupBody, title: "Dedupe tasting night two" });
  check("offer dedupe: a closed twin does not block a fresh identical offer (201)",
    closeDup.status === 200 && dup4.status === 201, `${closeDup.status}/${dup4.status} ${JSON.stringify(dup4.data).slice(0, 160)}`);
  const c2 = await registerCreator(`metricspeer${u}`);
  await approve(c2.user.id);
  const directDupBody = { title: "Direct dedupe tasting", whatComped: "Dinner for two", includes: "Two entrees and two drinks", dollarCap: 60, spots: 1, covers: 2, creatorId: c1.user.id };
  const directDup1 = await biz.client("POST", "/api/offers", directDupBody);
  const directDupSame = await biz.client("POST", "/api/offers", directDupBody);
  check("offer dedupe: an identical direct offer to the SAME creator still returns 409",
    directDup1.status === 201 && directDupSame.status === 409 && directDupSame.data.existingOfferId === directDup1.data.offer.id,
    `${directDup1.status}/${directDupSame.status} ${JSON.stringify(directDupSame.data).slice(0, 200)}`);
  const directDupOther = await biz.client("POST", "/api/offers", { ...directDupBody, creatorId: c2.user.id });
  check("offer dedupe: an identical direct offer to a DIFFERENT creator is a different offer (201, not 409)",
    directDupOther.status === 201 && directDupOther.data.offer && directDupOther.data.offer.id !== directDup1.data.offer.id && directDupOther.data.offer.creatorId === c2.user.id,
    `${directDupOther.status} ${JSON.stringify(directDupOther.data).slice(0, 200)}`);

  // ---------- metrics sync seam ----------
  part("metrics sync seam");
  const syncAnon = await rawWithHeaders("POST", "/api/admin/metrics/sync", { body: {} });
  check("metrics sync refuses anonymous callers (403)", syncAnon.status === 403, String(syncAnon.status));
  const syncToken = await rawWithHeaders("POST", "/api/admin/metrics/sync", { body: {}, headers: { "x-signl-sweep-token": SWEEP_TOKEN } });
  check("metrics sync under sweep-token auth returns the flag-off summary",
    syncToken.status === 200 && syncToken.data.enabled === false && syncToken.data.reason === "METRICS_AUTOSYNC is off",
    `${syncToken.status} ${JSON.stringify(syncToken.data)}`);
  const syncAdmin = await admin("POST", "/api/admin/metrics/sync", {});
  check("metrics sync under an admin session returns the same summary",
    syncAdmin.status === 200 && syncAdmin.data.enabled === false, `${syncAdmin.status} ${JSON.stringify(syncAdmin.data)}`);

  // ---------- wave2 served-bundle pins ----------
  part("wave2 bundle pins");
  const appJsW2 = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  check("bundle: the bottom bar renders tab badges from state.badges (refreshBadges hook)",
    appJsW2.includes("function refreshBadges()") && appJsW2.includes("state.badges = data.badges") && appJsW2.includes("bn-badge"),
    "");
  check("bundle: composer coaching reads Offer checklist, and Offer strength is gone from the client",
    appJsW2.includes("Offer checklist:") && appJsW2.includes("Offer checklist ${o.strength.score}") && !appJsW2.includes("Offer strength"),
    "");
  check("bundle: signup copy carries no ladder specifics (no hard stop, no reminder schedule, no pause/close timing)",
    !appJsW2.includes("reminders land at 48 hours, day 5, and day 6") && !appJsW2.includes("pauses my account at one week and closes it at two") &&
    appJsW2.includes("A late post inside the catch-up window still counts") && appJsW2.includes("repeated misses can pause my account"),
    "");
  check("bundle: the paid booking sheet replaced the native confirm/prompt chain",
    appJsW2.includes("function closePaidSheet") && appJsW2.includes("No card is charged in the app yet") && !appJsW2.includes("const briefInput = prompt("),
    "");

  // ---------- refresh asks (time travel + sweep) ----------
  part("refresh asks");
  await stopServer();
  editDb((db) => {
    for (const [key, val] of Object.entries(db)) {
      if (!key.startsWith("post:")) continue;
      if (val.bookingId === bk1.id) {
        // 8 days old: the day-7 ask is due; performanceRequestedAt unset.
        val.submittedAt = new Date(Date.now() - 8 * DAY).toISOString();
        delete val.performanceRequestedAt;
      }
      if (val.bookingId === bk2.id) {
        // 15 days old, reported 15 days ago: latest snapshot is
        // stale (>5 days), so the day-14 refresh ask is due.
        const then = new Date(Date.now() - 15 * DAY).toISOString();
        val.submittedAt = then;
        val.reportedAt = then;
        val.lastSnapshotAt = then;
        if (Array.isArray(val.snapshots)) for (const s of val.snapshots) s.at = then;
        delete val.performanceRequestedAt;
        delete val.performanceUpdate14At;
        delete val.performanceUpdate30At;
      }
    }
  });
  startServer();
  await waitUp();
  const admin2 = makeClient();
  await admin2("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const c1b = makeClient();
  await c1b("POST", "/api/auth/login", { email: c1.email, password: "password123" });
  const sweep = await admin2("POST", "/api/admin/compliance/sweep", {});
  check("sweep ran (the asks themselves are asserted from events and notes below; an opportunistic pass may have fired them first)",
    sweep.status === 200, JSON.stringify(sweep.data).slice(0, 200));
  const updEvents1 = (await (async () => { const r = await admin2("GET", "/api/admin/events?type=post_performance_update_requested&limit=2000"); return r.data.events || []; })());
  check("day-14 refresh ask fired once for the stale reported post (milestone 14)",
    updEvents1.filter((e) => eventData(e).bookingId === bk2.id && eventData(e).milestone === 14).length === 1,
    JSON.stringify(updEvents1.map((e) => eventData(e))));
  const cNotes2 = await c1b("GET", "/api/notifications");
  const askNotes = (cNotes2.data.notifications || []);
  check("day-7 ask now rides with an in-app performance_ask note",
    askNotes.some((n) => n.kind === "performance_ask" && n.data && n.data.bookingId === bk1.id),
    JSON.stringify(askNotes.map((n) => n.kind)));
  check("day-14 ask rides with an in-app performance_update_ask note",
    askNotes.some((n) => n.kind === "performance_update_ask" && n.data && n.data.bookingId === bk2.id),
    JSON.stringify(askNotes.map((n) => n.kind)));
  const sweep2 = await admin2("POST", "/api/admin/compliance/sweep", {});
  const updEvents2 = (await (async () => { const r = await admin2("GET", "/api/admin/events?type=post_performance_update_requested&limit=2000"); return r.data.events || []; })());
  check("a second sweep sends no second day-14 ask (marker holds)",
    sweep2.status === 200 && updEvents2.length === updEvents1.length, `${updEvents1.length} -> ${updEvents2.length}`);

  console.log(`\nMetrics verification: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log("Failures:", failures);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error("verify-metrics crashed:", e);
  process.exitCode = 1;
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}
