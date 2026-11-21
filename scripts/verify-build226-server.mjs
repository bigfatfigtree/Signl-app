#!/usr/bin/env node
// Build -226 server verification: the offer-journey plumbing
// bundle (terms, platform rule, post file pipe, license states,
// counted reporting, stats roll-up, review chips, post nudges,
// the metrics pipe behind its flag, interim reporting Momentum,
// the cancel / move-a-visit layer, post-confirmation closure,
// stall watching, the review promise backstop, Spanish parity).
//
// Run: node scripts/verify-build226-server.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8996;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-226-"));
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
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const part of setCookie.split(/,(?=[^;]+=)/)) {
      const m = part.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* binary or html */ }
    return { status: res.status, data, text };
  }
  api.raw = async function raw(method, p) {
    const headers = {};
    const cookie = cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers });
    return { status: res.status, text: await res.text(), contentType: res.headers.get("content-type") || "" };
  };
  return api;
}
const uniq = () => Math.random().toString(36).slice(2, 9);
let n = 0;
function creatorPayload(overrides = {}) {
  n += 1;
  return {
    role: "creator", name: `Creator226 ${n}`, email: `c226-${n}-${uniq()}@fixtures.dev`, password: "<redacted>",
    market: "Hampton Roads", city: "Norfolk", handle: `c226_${n}_${uniq()}`, categories: ["Food & Drink"],
    compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 3000, avgViews: 900,
    localAudiencePct: 62, bio: "", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
    ...overrides,
  };
}
async function registerCreator(overrides = {}) {
  const c = makeClient();
  const payload = creatorPayload(overrides);
  const r = await c("POST", "/api/auth/register", payload);
  return { client: c, payload, res: r, user: r.data && r.data.user, email: payload.email };
}
async function registerBusiness(admin, businessName) {
  const c = makeClient();
  const email = `biz226-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", email, password: "<redacted>", market: "Hampton Roads", city: "Norfolk",
    businessName, category: "Restaurant", planId: "self-service", agreedTerms: true,
  });
  if (r.status === 201) {
    await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
    await admin("POST", "/api/admin/businesses/activate", { userId: r.data.user.id });
  }
  return { client: c, res: r, user: r.data && r.data.user, email };
}
async function adminClient() {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error("admin login failed: " + r.status);
  return c;
}
async function approve(admin, userId) { await admin("POST", "/api/admin/review", { userId, decision: "approve" }); }
async function countEvents(admin, type) {
  const r = await admin("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=2000`);
  return (r.data.events || []).length;
}
async function notesOf(client, kind, bookingId) {
  const r = await client("GET", "/api/notifications");
  return (r.data.notifications || []).filter((x) => x.kind === kind && (!bookingId || (x.data && x.data.bookingId === bookingId)));
}
async function momentumOf(client) {
  const me = await client("GET", "/api/auth/me");
  return me.data.user.momentum;
}
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}
function readDb() { return JSON.parse(fs.readFileSync(dbFile, "utf8")); }
const DAY = 24 * 3600 * 1000;
const FILE_TEXT = "post-file-bytes-226";
const FILE_B64 = Buffer.from(FILE_TEXT, "utf8").toString("base64");

async function directVisit(bizC, creatorReg, offerBody) {
  const off = await bizC("POST", "/api/offers", { spots: 1, creatorId: creatorReg.user.id, ...offerBody });
  if (off.status !== 201) throw new Error("offer failed: " + JSON.stringify(off.data));
  const acc = await creatorReg.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
  if (acc.status !== 201) throw new Error("accept failed: " + JSON.stringify(acc.data));
  return { offer: off.data.offer, booking: acc.data.booking };
}

try {
  startServer();
  await waitUp();
  const admin = await adminClient();
  const biz = await registerBusiness(admin, "Journey Kitchen");
  const bizC = biz.client;
  check("business registered + activated", biz.res.status === 201);
  const biz2 = await registerBusiness(admin, "Second Kitchen");
  const biz2C = biz2.client;

  // Creator A: Instagram is primary (3,000 followers), but TikTok
  // carries the largest LOCAL audience (5,000 x 80% = 4,000 local
  // vs Instagram 3,000 x 62% = 1,860).
  const cA = await registerCreator({});
  await approve(admin, cA.user.id);
  const patchA = await cA.client("PATCH", "/api/me/profile", {
    audienceStack: { instagram: 3000, tiktok: 5000 },
    platformLocalPct: { instagram: 62, tiktok: 80 },
    licensingFee: 80, paidRate: 200,
  });
  check("creator A profile carries the two-platform stack", patchA.status === 200, JSON.stringify(patchA.data).slice(0, 200));
  const cB = await registerCreator({});
  await approve(admin, cB.user.id);
  await cB.client("PATCH", "/api/me/profile", { paidRate: 150 });
  const cC = await registerCreator({});
  await approve(admin, cC.user.id);
  await stopServer();
  editDb((db) => {
    for (const reg of [cA, cB, cC]) {
      const u = db[`user:${reg.user.id}`];
      if (u && u.creator) u.creator.maxVisitsPerWeek = 7;
    }
  });
  startServer(); await waitUp();

  part("terms + platform: no platform specified");
  const j1 = await directVisit(bizC, cA, { title: "Comp dinner 226", whatComped: "Meal for two, on us", dollarCap: 100 });
  check("offer payload terms resolve platform to largest local (tiktok)", !!j1.offer.terms && j1.offer.terms.platform.name === "tiktok" && j1.offer.terms.platform.source === "largest_local", JSON.stringify(j1.offer.terms));
  check("offer terms: share_only license priced at the listed fee, visit cost from the deal", !!j1.offer.terms && j1.offer.terms.license.state === "share_only" && j1.offer.terms.license.priceCents === 8000 && j1.offer.terms.visitCostCents === 10000, JSON.stringify(j1.offer.terms && j1.offer.terms.license));
  check("offer terms carry deliverables text, post window, keep-up days", !!j1.offer.terms && typeof j1.offer.terms.deliverablesText === "string" && j1.offer.terms.deliverablesText.length > 0 && j1.offer.terms.postWindowHours > 0 && j1.offer.terms.keepUpDays === 30, JSON.stringify(j1.offer.terms).slice(0, 200));
  const bk1View = (await bizC("GET", "/api/bookings")).data.bookings.find((b) => b.id === j1.booking.id);
  check("booking payload terms match the offer terms", !!bk1View && !!bk1View.terms && bk1View.terms.platform.name === "tiktok" && bk1View.terms.license.state === "share_only", JSON.stringify(bk1View && bk1View.terms));
  const redeem1 = await bizC("POST", "/api/counter/redeem", { code: j1.booking.code });
  check("redeem by counter scan works", redeem1.status === 200 && !!redeem1.data.booking, `${redeem1.status} ${JSON.stringify(redeem1.data).slice(0, 150)}`);
  const bk1After = (await bizC("GET", "/api/bookings")).data.bookings.find((b) => b.id === j1.booking.id);
  check("terms postDeadlineAt derives after redemption", !!bk1After.terms.postDeadlineAt, JSON.stringify(bk1After.terms));
  const post1 = await cA.client("POST", "/api/posts", {
    bookingId: j1.booking.id, url: "https://www.tiktok.com/@c226/video/226001", disclosedComp: true,
    postFile: { name: "post1.mp4", type: "video/mp4", dataBase64: FILE_B64 },
  });
  check("post with link + file at link-paste time lands (201)", post1.status === 201, `${post1.status} ${JSON.stringify(post1.data).slice(0, 200)}`);
  check("post record carries the file metadata", !!post1.data.post.postFile && post1.data.post.postFile.name === "post1.mp4" && !!post1.data.post.postFile.storageRef, JSON.stringify(post1.data.post.postFile));
  const bk1Posted = (await bizC("GET", "/api/bookings")).data.bookings.find((b) => b.id === j1.booking.id);
  check("comped terms flip to the license ask once a post exists", !!bk1Posted.terms && bk1Posted.terms.license.state === "ask" && bk1Posted.terms.license.priceCents === 8000, JSON.stringify(bk1Posted.terms && bk1Posted.terms.license));
  check("keepUpUntil derives from the post date", !!bk1Posted.terms.keepUpUntil, JSON.stringify(bk1Posted.terms));

  part("file pipe: license gate");
  const dlEarly = await bizC.raw("GET", `/api/bookings/${j1.booking.id}/post-file`);
  check("download before license agreement is a plain 403", dlEarly.status === 403, `${dlEarly.status}`);
  const licReq = await bizC("POST", `/api/posts/${post1.data.post.id}/license-request`, {});
  check("license request created", licReq.status === 201, `${licReq.status}`);
  const licOk = await cA.client("POST", `/api/license-requests/${licReq.data.licenseRequest.id}/respond`, { decision: "approve" });
  check("creator approves the license", licOk.status === 200 && licOk.data.licenseRequest.status === "granted", JSON.stringify(licOk.data).slice(0, 150));
  const bk1Lic = (await bizC("GET", "/api/bookings")).data.bookings.find((b) => b.id === j1.booking.id);
  check("terms flip to agreed with an end date (the ask disappears)", !!bk1Lic.terms && bk1Lic.terms.license.state === "agreed" && !!bk1Lic.terms.license.endsAt, JSON.stringify(bk1Lic.terms && bk1Lic.terms.license));
  const dlOk = await bizC.raw("GET", `/api/bookings/${j1.booking.id}/post-file`);
  check("download serves the exact file bytes after agreement", dlOk.status === 200 && dlOk.text === FILE_TEXT, `${dlOk.status} ${dlOk.text.slice(0, 60)}`);
  const dlOther = await biz2C.raw("GET", `/api/bookings/${j1.booking.id}/post-file`);
  check("another business cannot download it (404)", dlOther.status === 404, `${dlOther.status}`);

  part("terms + platform: business specified");
  const j2 = await directVisit(bizC, cA, { title: "IG dinner 226", whatComped: "Meal for two, on us", dollarCap: 60, platformRequired: "instagram" });
  check("offer terms platform is the business-named one", !!j2.offer.terms && j2.offer.terms.platform.name === "instagram" && j2.offer.terms.platform.source === "business", JSON.stringify(j2.offer.terms && j2.offer.terms.platform));
  const conf2 = await bizC("POST", `/api/bookings/${j2.booking.id}/confirm`, {});
  check("redeem by business confirm works", conf2.status === 200 && !!conf2.data.booking.redeemedAt, `${conf2.status}`);
  const switchTry = await cA.client("POST", "/api/posts", { bookingId: j2.booking.id, url: "https://www.tiktok.com/@c226/video/226002", disclosedComp: true });
  check("a platform switch is rejected when the business specified (400)", switchTry.status === 400, `${switchTry.status} ${JSON.stringify(switchTry.data).slice(0, 150)}`);
  const post2 = await cA.client("POST", "/api/posts", { bookingId: j2.booking.id, url: "https://www.instagram.com/p/j226two/", disclosedComp: true });
  check("posting on the named platform works", post2.status === 201, `${post2.status} ${JSON.stringify(post2.data).slice(0, 150)}`);

  part("paid booking: license included, download from the start");
  const pb = await bizC("POST", "/api/bookings/paid", { creatorId: cA.user.id });
  check("paid booking created", pb.status === 201, `${pb.status} ${JSON.stringify(pb.data).slice(0, 150)}`);
  const pbId = pb.data.booking.id;
  await bizC("POST", `/api/bookings/${pbId}/confirm`, {});
  const postP = await cA.client("POST", "/api/posts", { bookingId: pbId, url: "https://www.instagram.com/p/j226paid/", disclosedComp: true });
  check("paid post lands", postP.status === 201, `${postP.status}`);
  const attach = await cA.client("POST", "/api/posts/file", { bookingId: pbId, file: { name: "paid.mp4", type: "video/mp4", dataBase64: FILE_B64 } });
  check("file attaches after the fact through POST /posts/file", attach.status === 200 && !!attach.data.postFile, `${attach.status} ${JSON.stringify(attach.data).slice(0, 150)}`);
  const pbView = (await bizC("GET", "/api/bookings")).data.bookings.find((b) => b.id === pbId);
  check("paid terms: license included, ends about 90 days after the post", !!pbView.terms && pbView.terms.license.state === "included" && pbView.terms.license.priceCents === null && !!pbView.terms.license.endsAt && Math.abs(Date.parse(pbView.terms.license.endsAt) - (Date.now() + 90 * DAY)) < 2 * DAY, JSON.stringify(pbView.terms && pbView.terms.license));
  const dlPaid = await bizC.raw("GET", `/api/bookings/${pbId}/post-file`);
  check("paid download works from the start", dlPaid.status === 200 && dlPaid.text === FILE_TEXT, `${dlPaid.status}`);

  part("reporting: counted only, ROI math");
  await bizC("POST", `/api/bookings/${j1.booking.id}/code-uses`, { amount: 40 });
  await bizC("POST", `/api/bookings/${j1.booking.id}/code-uses`, { amount: 40 });
  const rep = await bizC("GET", `/api/business/post-report?bookingId=${j1.booking.id}`);
  check("post report counts register events only (2 customers, $80)", rep.status === 200 && rep.data.report.countedCustomers === 2 && rep.data.report.registerSpendCents === 8000, JSON.stringify(rep.data).slice(0, 250));
  check("post report ROI = register spend / visit cost (80 / 100 = 0.8)", rep.data.report.roi === 0.8 && rep.data.report.visitCostCents === 10000, JSON.stringify(rep.data.report).slice(0, 200));
  check("counted-by-day series carries the day", Array.isArray(rep.data.report.countedByDay) && rep.data.report.countedByDay.length === 1 && rep.data.report.countedByDay[0].customers === 2 && rep.data.report.countedByDay[0].registerSpendCents === 8000, JSON.stringify(rep.data.report.countedByDay));
  check("report carries terms + no modeled estimate fields in counted figures", !!rep.data.report.terms && rep.data.report.countedSource === "events", JSON.stringify(rep.data.report).slice(0, 150));
  const stats = await bizC("GET", "/api/business/stats");
  check("stats totals include the counted visit", stats.status === 200 && stats.data.totals.countedCustomers >= 2 && stats.data.totals.registerSpendCents >= 8000 && stats.data.counted >= 2 && stats.data.registerBack >= 80, JSON.stringify(stats.data).slice(0, 250));
  const campRow = (stats.data.campaigns || []).find((r) => r.offerId === j1.offer.id);
  check("per-campaign row matches the post report shape", !!campRow && campRow.countedCustomers === 2 && campRow.registerSpendCents === 8000 && campRow.roi === 0.8, JSON.stringify(campRow));
  const creatorRow = (stats.data.creators || []).find((r) => r.creatorId === cA.user.id);
  check("per-creator row aggregates the creator's visits", !!creatorRow && creatorRow.countedCustomers >= 2, JSON.stringify(creatorRow));
  const statsFuture = await bizC("GET", `/api/business/stats?from=${new Date(Date.now() + 7 * DAY).toISOString()}`);
  check("stats honor the from date (future range is empty)", statsFuture.status === 200 && statsFuture.data.totals.bookings === 0, JSON.stringify(statsFuture.data.totals));

  part("reviews with chips");
  const rev = await bizC("POST", `/api/bookings/${j1.booking.id}/review`, { stars: 5, note: "Great visit", chips: ["On time", "Great photos"] });
  check("business review stores chips", rev.status === 201 && !!rev.data.review && Array.isArray(rev.data.review.chips) && rev.data.review.chips.includes("On time"), `${rev.status} ${JSON.stringify(rev.data).slice(0, 200)}`);
  const revDup = await bizC("POST", `/api/bookings/${j1.booking.id}/review`, { stars: 4, chips: ["Again"] });
  check("one review per side per booking (409 on repeat)", revDup.status === 409, `${revDup.status}`);
  const revB = await cA.client("POST", `/api/bookings/${j1.booking.id}/review-business`, { stars: 5, note: "Lovely team", chips: ["Easy to work with"] });
  check("creator review of the business stores chips", revB.status === 201 && !!revB.data.review && (revB.data.review.chips || []).includes("Easy to work with"), `${revB.status} ${JSON.stringify(revB.data).slice(0, 200)}`);
  const bk1Rev = (await bizC("GET", "/api/bookings")).data.bookings.find((b) => b.id === j1.booking.id);
  check("booking payload mirrors carry the chips", !!bk1Rev.creatorReview && (bk1Rev.creatorReview.chips || []).includes("Great photos") && !!bk1Rev.businessReview && (bk1Rev.businessReview.chips || []).includes("Easy to work with"), JSON.stringify({ br: bk1Rev.businessReview, cr: bk1Rev.creatorReview }).slice(0, 250));

  part("post nudge day2 / day5");
  const j4 = await directVisit(bizC, cB, { title: "Nudge lunch 226", whatComped: "Meal for one, on us", dollarCap: 40 });
  await bizC("POST", `/api/bookings/${j4.booking.id}/confirm`, {});
  await stopServer();
  editDb((db) => {
    const bk = db[`booking:${j4.booking.id}`];
    bk.redeemedAt = new Date(Date.now() - 3 * DAY).toISOString();
    bk.postDeadline = new Date(Date.now() + 4 * DAY).toISOString();
  });
  startServer(); await waitUp();
  const meB1 = await cB.client("GET", "/api/auth/me");
  check("day-2 nudge shows on the creator home payload", !!meB1.data.user.postNudge && meB1.data.user.postNudge.bookingId === j4.booking.id && meB1.data.user.postNudge.stage === "day2", JSON.stringify(meB1.data.user.postNudge));
  await stopServer();
  editDb((db) => {
    const bk = db[`booking:${j4.booking.id}`];
    bk.redeemedAt = new Date(Date.now() - 6 * DAY).toISOString();
  });
  startServer(); await waitUp();
  const meB2 = await cB.client("GET", "/api/auth/me");
  check("day-5 nudge stage at six days", !!meB2.data.user.postNudge && meB2.data.user.postNudge.stage === "day5", JSON.stringify(meB2.data.user.postNudge));
  const post4 = await cB.client("POST", "/api/posts", { bookingId: j4.booking.id, url: "https://www.instagram.com/p/j226nudge/", disclosedComp: true });
  check("the nudged creator can still post", post4.status === 201, `${post4.status}`);
  const meB3 = await cB.client("GET", "/api/auth/me");
  check("no nudge once the post link is in", !meB3.data.user.postNudge, JSON.stringify(meB3.data.user.postNudge));

  part("item 12: reporting Momentum windows");
  const mBefore = await momentumOf(cA.client);
  await stopServer();
  editDb((db) => {
    const postRec = db[`post:${post1.data.post.id}`];
    postRec.submittedAt = new Date(Date.now() - 8 * DAY).toISOString();
  });
  startServer(); await waitUp();
  const perf1 = await cA.client("POST", `/api/bookings/${j1.booking.id}/performance`, { views: 1000, likes: 50, comments: 5, shares: 3, saves: 2 });
  check("day-7 report awards the +10 window bonus", perf1.status === 200 && !!perf1.data.momentumAward && perf1.data.momentumAward.points === 10 && perf1.data.momentumAward.window === "day7", `${perf1.status} ${JSON.stringify(perf1.data).slice(0, 200)}`);
  const perf2 = await cA.client("POST", `/api/bookings/${j1.booking.id}/performance`, { views: 1200, likes: 60, comments: 6, shares: 4, saves: 3 });
  check("a second report inside the same window awards 0", perf2.status === 200 && !!perf2.data.momentumAward && perf2.data.momentumAward.points === 0, JSON.stringify(perf2.data).slice(0, 150));
  const mAfter = await momentumOf(cA.client);
  check("Momentum total moved by the base +5 and the one +10 only", mAfter.points === mBefore.points + 15, `${mBefore.points} -> ${mAfter.points}`);
  check("reported metrics carry the creator source label", !!perf2.data.post.performance && perf2.data.post.performance.metricSources && perf2.data.post.performance.metricSources.views === "creator", JSON.stringify(perf2.data.post.performance).slice(0, 200));

  part("item 11: metrics pipe, flag off + mocked flag on");
  process.env.SIGNL_LOCAL = "1";
  process.env.SIGNL_LOCAL_DB = dbFile;
  delete process.env.METRICS_AUTOSYNC;
  const require226 = createRequire(path.join(root, "scripts", "verify-build226-server.mjs"));
  const metricsSync = require226("../netlify/functions/lib/metrics-sync.js");
  const offRun = await metricsSync.runMetricsSync({});
  check("flag OFF: the sync reports itself off, exactly as before", offRun.enabled === false && offRun.reason === "METRICS_AUTOSYNC is off", JSON.stringify(offRun));
  const stub = await metricsSync.metaProvider.fetchPostMetrics({ id: "p1", url: "https://www.instagram.com/p/x/" }, {});
  check("the Meta provider stub still answers unavailable (the App Review boundary)", stub.status === "unavailable", JSON.stringify(stub));
  process.env.METRICS_AUTOSYNC = "1";
  const fakePost = { id: "fake1", bookingId: "b1", creatorId: "c1", url: "https://www.instagram.com/p/fake/", platform: "instagram", views: 100, likes: 10, metricSources: { views: "creator", likes: "creator" }, snapshots: [] };
  const savedPosts = [];
  const onRun = await metricsSync.runMetricsSync({
    posts: [fakePost],
    savePost: async (p) => { savedPosts.push(p); },
    provider: { fetchPostMetrics: async () => ({ status: "ok", metrics: { views: 555 } }) },
  });
  check("flag ON with a mocked provider syncs the post", onRun.enabled === true && onRun.synced === 1, JSON.stringify(onRun));
  check("a pulled value replaces the reported one and its label flips to platform", fakePost.views === 555 && fakePost.metricSources.views === "platform", JSON.stringify(fakePost));
  check("an untouched metric keeps its creator label (no silent blending)", fakePost.likes === 10 && fakePost.metricSources.likes === "creator", JSON.stringify(fakePost.metricSources));
  delete process.env.METRICS_AUTOSYNC;

  part("mention-code line: token intact, no em dash");
  const router226 = require226("../netlify/functions/lib/router.js");
  const codeLine226 = router226.audienceCodeLine({ creatorCode: "TEST226", businessName: "Journey Kitchen", discountPct: 15 });
  check("generated audience code line contains the token and no em dash", codeLine226.includes("TEST226") && !codeLine226.includes("—"), codeLine226);

  part("profile data: all-channels payload + Top 3 showcase");
  const showUrls = [
    "https://www.instagram.com/p/showcase1a/",
    "https://www.tiktok.com/@c226/video/777001",
    "https://www.youtube.com/watch?v=abc123XYZ_0",
  ];
  const showSave = await cA.client("PUT", "/api/me/showcase", { urls: showUrls });
  check("showcase saves 3 picks in her order, with platforms + embed descriptors", showSave.status === 200 && Array.isArray(showSave.data.showcase) && showSave.data.showcase.length === 3 && showSave.data.showcase[0].url === showUrls[0] && showSave.data.showcase[1].platform === "tiktok" && !!showSave.data.showcase[0].embed && !!showSave.data.showcase[2].embed, `${showSave.status} ${JSON.stringify(showSave.data).slice(0, 250)}`);
  const show4 = await cA.client("PUT", "/api/me/showcase", { urls: [...showUrls, "https://www.instagram.com/p/showcase4d/"] });
  check("a 4th pick is rejected server-side (400)", show4.status === 400, `${show4.status}`);
  const showStill = await cA.client("GET", "/api/me/showcase");
  check("the rejected save changed nothing", showStill.status === 200 && showStill.data.showcase.length === 3 && showStill.data.showcase[2].url === showUrls[2], JSON.stringify(showStill.data).slice(0, 150));
  const showBad = await cA.client("PUT", "/api/me/showcase", { urls: ["https://example.com/not-a-post"] });
  check("a non-platform link is rejected (400)", showBad.status === 400, `${showBad.status}`);
  const showB = await cB.client("GET", "/api/me/showcase");
  check("another creator's showcase is untouched (own record only)", showB.status === 200 && showB.data.showcase.length === 0, JSON.stringify(showB.data).slice(0, 100));
  const disc = await bizC("GET", "/api/discover?market=Hampton%20Roads");
  const cardA = (disc.data.creators || []).find((c) => c.userId === cA.user.id);
  check("the discovery card carries every channel with per-platform local %", !!cardA && Array.isArray(cardA.channels) && cardA.channels.some((ch) => ch.platform === "tiktok" && ch.followers === 5000 && ch.localPct === 80) && cardA.channels.some((ch) => ch.platform === "instagram" && ch.followers === 3000 && ch.localPct === 62), JSON.stringify(cardA && cardA.channels).slice(0, 250));
  check("the card carries the showcase in order", !!cardA && Array.isArray(cardA.showcase) && cardA.showcase.length === 3 && cardA.showcase[0].url === showUrls[0] && cardA.showcase[1].url === showUrls[1], JSON.stringify(cardA && cardA.showcase).slice(0, 150));
  await stopServer();
  editDb((db) => {
    const u = db[`user:${cA.user.id}`];
    if (u && u.creator) { u.creator.publicPage = true; u.creator.hasPhoto = true; }
  });
  startServer(); await waitUp();
  const pubPage = await makeClient()("GET", `/api/c/${cA.payload.handle}`);
  check("the public /c payload carries channels + showcase in order", pubPage.status === 200 && !!pubPage.data.profile && Array.isArray(pubPage.data.profile.channels) && pubPage.data.profile.channels.some((ch) => ch.platform === "tiktok" && ch.localPct === 80) && Array.isArray(pubPage.data.profile.showcase) && pubPage.data.profile.showcase.length === 3 && pubPage.data.profile.showcase[2].url === showUrls[2], `${pubPage.status} ${JSON.stringify(pubPage.data).slice(0, 250)}`);

  part("item 13a: business cancel frees the slot + opens the Swap Bench");
  const j5 = await directVisit(bizC, cB, { title: "Cancel me 226", whatComped: "Meal for one, on us", dollarCap: 30 });
  const bcancel = await bizC("POST", `/api/bookings/${j5.booking.id}/cancel`, { reason: "Kitchen closed that week" });
  check("business cancel lands in cancelled_by_business", bcancel.status === 200 && bcancel.data.booking.status === "cancelled_by_business", `${bcancel.status} ${JSON.stringify(bcancel.data).slice(0, 200)}`);
  const swap = await bizC("GET", `/api/bookings/${j5.booking.id}/swap`);
  check("the Swap Bench opens for the business-cancelled visit", swap.status === 200 && Array.isArray(swap.data.suggestions), `${swap.status} ${JSON.stringify(swap.data).slice(0, 150)}`);
  check("the creator is told exactly once", (await notesOf(cB.client, "visit_cancelled_by_business", j5.booking.id)).length === 1);
  const dbAfterCancel = readDb();
  check("lane + reason recorded on the booking", dbAfterCancel[`booking:${j5.booking.id}`].cancelLane === "direct" && dbAfterCancel[`booking:${j5.booking.id}`].visitLostReason === "business_cancelled", JSON.stringify(dbAfterCancel[`booking:${j5.booking.id}`]).slice(0, 200));

  part("item 13b: creator cancel on a non-application lane (direct paid)");
  const pbB = await bizC("POST", "/api/bookings/paid", { creatorId: cB.user.id });
  check("direct paid booking for creator B created", pbB.status === 201, `${pbB.status} ${JSON.stringify(pbB.data).slice(0, 150)}`);
  const ccancel = await cB.client("POST", `/api/bookings/${pbB.data.booking.id}/cancel`, { reason: "Family emergency" });
  check("creator cancel works on the direct paid lane", ccancel.status === 200 && ccancel.data.booking.status === "cancelled", `${ccancel.status} ${JSON.stringify(ccancel.data).slice(0, 200)}`);
  const dbPaid = readDb();
  check("held escrow refunds exactly as the application lane does", dbPaid[`booking:${pbB.data.booking.id}`].paidLane.escrowState === "refunded", JSON.stringify(dbPaid[`booking:${pbB.data.booking.id}`].paidLane));
  check("lane + reason recorded (direct_paid)", dbPaid[`booking:${pbB.data.booking.id}`].cancelLane === "direct_paid" && dbPaid[`booking:${pbB.data.booking.id}`].cancelReason === "Family emergency");
  check("the business is told the creator gave the spot back", (await notesOf(bizC, "creator_declined", pbB.data.booking.id)).length === 1);

  part("item 13c: reschedule propose / accept / decline / withdraw");
  const j7 = await directVisit(bizC, cB, { title: "Move me 226", whatComped: "Meal for one, on us", dollarCap: 30 });
  const before7 = (await bizC("GET", "/api/bookings")).data.bookings.find((b) => b.id === j7.booking.id);
  const newTime = new Date(Date.now() + 3 * DAY).toISOString();
  const prop = await bizC("POST", `/api/bookings/${j7.booking.id}/reschedule`, { newVisitAt: newTime });
  check("business proposes a move", prop.status === 200 && !!prop.data.proposal && prop.data.proposal.status === "open", `${prop.status} ${JSON.stringify(prop.data).slice(0, 150)}`);
  const prop2 = await cB.client("POST", `/api/bookings/${j7.booking.id}/reschedule`, { newVisitAt: new Date(Date.now() + 4 * DAY).toISOString() });
  check("a second open proposal is refused (409)", prop2.status === 409, `${prop2.status}`);
  const accMove = await cB.client("POST", `/api/bookings/${j7.booking.id}/reschedule/respond`, { accept: true });
  check("creator accepts: the visit time and redeemBy move", accMove.status === 200 && accMove.data.booking.redeemBy !== before7.redeemBy && Date.parse(accMove.data.booking.redeemBy) >= Date.parse(newTime), `${accMove.status} ${JSON.stringify({ before: before7.redeemBy, after: accMove.data.booking && accMove.data.booking.redeemBy })}`);
  check("the creator hears the visit moved, exactly once", (await notesOf(cB.client, "visit_moved", j7.booking.id)).length === 1);
  const prop3 = await cB.client("POST", `/api/bookings/${j7.booking.id}/reschedule`, { newVisitAt: new Date(Date.now() + 5 * DAY).toISOString() });
  const midView = (await bizC("GET", "/api/bookings")).data.bookings.find((b) => b.id === j7.booking.id);
  const decMove = await bizC("POST", `/api/bookings/${j7.booking.id}/reschedule/respond`, { accept: false });
  const afterDec = (await bizC("GET", "/api/bookings")).data.bookings.find((b) => b.id === j7.booking.id);
  check("decline changes nothing but the proposal", prop3.status === 200 && decMove.status === 200 && afterDec.redeemBy === midView.redeemBy && afterDec.rescheduleProposal.status === "declined", JSON.stringify({ mid: midView.redeemBy, after: afterDec.redeemBy }));
  const prop4 = await bizC("POST", `/api/bookings/${j7.booking.id}/reschedule`, { newVisitAt: new Date(Date.now() + 6 * DAY).toISOString() });
  const wd = await bizC("POST", `/api/bookings/${j7.booking.id}/reschedule/withdraw`, {});
  check("the proposing side can withdraw", prop4.status === 200 && wd.status === 200 && wd.data.proposal.status === "withdrawn", `${wd.status}`);

  part("item 13d + 13e: fair strike + business failure notifications");
  const jX = await directVisit(bizC, cC, { title: "Messaged expiry 226", whatComped: "Meal for one, on us", dollarCap: 25 });
  const jY = await directVisit(biz2C, cC, { title: "Silent expiry 226", whatComped: "Meal for one, on us", dollarCap: 25 });
  const msg = await cC.client("POST", "/api/messages", { toUserId: biz.user.id, body: "I cannot make the visit this week, can we move it?" });
  check("creator messages the business before the window runs out", msg.status === 201 || msg.status === 200, `${msg.status} ${JSON.stringify(msg.data).slice(0, 120)}`);
  await stopServer();
  editDb((db) => {
    for (const id of [jX.booking.id, jY.booking.id]) {
      const bk = db[`booking:${id}`];
      bk.createdAt = new Date(Date.now() - 3 * DAY).toISOString();
      bk.redeemBy = new Date(Date.now() - 3600 * 1000).toISOString();
    }
    for (const [key, val] of Object.entries(db)) {
      if (key.startsWith("message:") && val.fromId === cC.user.id) val.createdAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    }
  });
  startServer(); await waitUp();
  const sweep1 = await admin("POST", "/api/admin/compliance/sweep", {});
  check("compliance sweep runs", sweep1.status === 200, `${sweep1.status}`);
  const dbStrike = readDb();
  check("expired WITH a prior message: NO strike lands", !dbStrike[`user:${cC.user.id}`].noShowStrikes || dbStrike[`user:${cC.user.id}`].noShowStrikes === 1, JSON.stringify(dbStrike[`user:${cC.user.id}`].noShowStrikes));
  check("the protected booking is stamped waived", !!dbStrike[`booking:${jX.booking.id}`].compliance && dbStrike[`booking:${jX.booking.id}`].compliance.noShowStrikeWaived === "creator_messaged_business", JSON.stringify(dbStrike[`booking:${jX.booking.id}`].compliance));
  check("the silent booking counted the strike", !!dbStrike[`booking:${jY.booking.id}`].compliance && dbStrike[`booking:${jY.booking.id}`].compliance.strikeCounted === 1, JSON.stringify(dbStrike[`booking:${jY.booking.id}`].compliance));
  check("both branches are logged for audit", (await countEvents(admin, "no_show_strike_waived")) === 1 && (await countEvents(admin, "creator_strike")) === 1);
  check("each business hears its own expiry exactly once", (await notesOf(bizC, "visit_expired", jX.booking.id)).length === 1 && (await notesOf(biz2C, "visit_expired", jY.booking.id)).length === 1);

  part("item 13e: post goes late notifies the business once");
  const j8 = await directVisit(biz2C, cB, { title: "Late post 226", whatComped: "Meal for one, on us", dollarCap: 20 });
  await biz2C("POST", `/api/bookings/${j8.booking.id}/confirm`, {});
  await stopServer();
  editDb((db) => {
    const bk = db[`booking:${j8.booking.id}`];
    bk.postDeadline = new Date(Date.now() - 3600 * 1000).toISOString();
  });
  startServer(); await waitUp();
  await admin("POST", "/api/admin/compliance/sweep", {});
  await admin("POST", "/api/admin/compliance/sweep", {});
  check("post_late fires exactly once across two sweeps", (await notesOf(biz2C, "post_late", j8.booking.id)).length === 1);

  part("item 13e: offer window ends unfilled notifies the business once");
  const openOff = await biz2C("POST", "/api/offers", { spots: 1, lane: "open", title: "Open call 226", whatComped: "Meal for one, on us", dollarCap: 30 });
  check("open offer created", openOff.status === 201, `${openOff.status} ${JSON.stringify(openOff.data).slice(0, 150)}`);
  await stopServer();
  editDb((db) => {
    const off = db[`offer:${openOff.data.offer.id}`];
    if (off) off.windowEndAt = new Date(Date.now() - 3600 * 1000).toISOString();
  });
  startServer(); await waitUp();
  await admin("POST", "/api/admin/offers/sweep", {});
  await admin("POST", "/api/admin/offers/sweep", {});
  const unfilled = (await biz2C("GET", "/api/notifications")).data.notifications.filter((x) => x.kind === "offer_window_unfilled" && x.data && x.data.offerId === openOff.data.offer.id);
  check("offer_window_unfilled fires exactly once", unfilled.length === 1, JSON.stringify(unfilled).slice(0, 150));

  part("item 14a: unconfirmed proof auto-closes at 48h + rotted link flags");
  const j9 = await directVisit(biz2C, cB, { title: "Auto close 226", whatComped: "Meal for one, on us", dollarCap: 20 });
  await biz2C("POST", `/api/bookings/${j9.booking.id}/confirm`, {});
  const post9 = await cB.client("POST", "/api/posts", { bookingId: j9.booking.id, url: "https://www.instagram.com/p/j226auto/", disclosedComp: true });
  check("proof submitted for the auto-close fixture", post9.status === 201, `${post9.status}`);
  check("the business got the confirmation ask at submission", (await notesOf(biz2C, "post_confirmation_needed", j9.booking.id)).length === 1);
  const fu1 = await admin("POST", "/api/admin/post-followup/sweep", { now: new Date(Date.now() + 49 * 3600 * 1000).toISOString(), mockGoneUrls: ["https://www.instagram.com/p/j226auto/"] });
  check("follow-up sweep auto-confirms the unconfirmed proof", fu1.status === 200 && fu1.data.followup.autoConfirmed >= 1, JSON.stringify(fu1.data).slice(0, 200));
  const postsBiz2 = await biz2C("GET", "/api/posts");
  const post9View = (postsBiz2.data.posts || []).find((p) => p.id === post9.data.post.id);
  check("the post reads auto-confirmed, never un-verified", !!post9View && !!post9View.verifiedAt && post9View.verifiedBy === "auto_window", JSON.stringify(post9View).slice(0, 200));
  const bk9 = (await biz2C("GET", "/api/bookings")).data.bookings.find((b) => b.id === j9.booking.id);
  check("the booking shows completion + the rotted-link follow-up flag", !!bk9 && bk9.status === "completed" && !!bk9.followUpFlag && bk9.followUpFlag.kind === "post_link_gone", JSON.stringify(bk9 && bk9.followUpFlag));
  check("the creator hears the loop closed, exactly once", (await notesOf(cB.client, "post_auto_confirmed", j9.booking.id)).length === 1);
  await admin("POST", "/api/admin/post-followup/sweep", { now: new Date(Date.now() + 50 * 3600 * 1000).toISOString() });
  check("a second sweep does not re-notify", (await notesOf(cB.client, "post_auto_confirmed", j9.booking.id)).length === 1);

  part("item 14b: stall watching counts + links");
  const anon = makeClient();
  const started = await anon("POST", "/api/signup-started", { email: "stall226@fixtures.dev", flow: "creator", lastStep: "profile" });
  check("the early capture stores a started record", started.status === 200 && started.data.started.status === "started", `${started.status} ${JSON.stringify(started.data)}`);
  const starts1 = await admin("GET", "/api/admin/signup-starts");
  const stallRow1 = (starts1.data.starts || []).find((s) => s.email === "stall226@fixtures.dev");
  check("Admin counts the started signup", !!stallRow1 && stallRow1.status === "started" && starts1.data.counts.creator.started >= 1, JSON.stringify(starts1.data.counts));
  const cStall = await registerCreator({ email: "stall226@fixtures.dev" });
  check("the real signup lands", cStall.res.status === 201, `${cStall.res.status}`);
  const starts2 = await admin("GET", "/api/admin/signup-starts");
  const stallRow2 = (starts2.data.starts || []).find((s) => s.email === "stall226@fixtures.dev");
  check("the started record links on completion (finished, userId set)", !!stallRow2 && stallRow2.status === "finished" && stallRow2.userId === cStall.user.id, JSON.stringify(stallRow2));

  part("item 14c + 14d: review promise backstop, Spanish twin");
  const cD = await registerCreator({});
  const cE = await registerCreator({ lang: "es" });
  await stopServer();
  editDb((db) => {
    for (const id of [cD.user.id, cE.user.id]) {
      db[`user:${id}`].createdAt = new Date(Date.now() - 7 * DAY).toISOString();
    }
  });
  startServer(); await waitUp();
  await admin("POST", "/api/admin/post-followup/sweep", {});
  await admin("POST", "/api/admin/post-followup/sweep", {});
  const queue = await admin("GET", "/api/admin/applications");
  const rowD = [...(queue.data.pending || []), ...(queue.data.decided || [])].find((u) => u.id === cD.user.id);
  check("the aged application flags in the Admin queue", !!rowD && rowD.reviewOverdue === true, JSON.stringify(rowD).slice(0, 200));
  const dbNotesD = Object.values(readDb()).filter((x) => x && x.kind === "review_still_on_it" && x.userId === cD.user.id);
  check("the applicant gets exactly one still-on-it note", dbNotesD.length === 1, JSON.stringify(dbNotesD).slice(0, 150));
  const meD = await cD.client("GET", "/api/auth/me");
  check("the applicant sees the plain status line in app", !!meD.data.user.reviewStatusLine && meD.data.user.reviewOverdue === true, JSON.stringify(meD.data.user).slice(0, 200));
  const notesE = Object.values(readDb()).filter((x) => x && x.kind === "review_still_on_it" && x.userId === cE.user.id);
  check("the Spanish-preferring applicant gets the Spanish twin", notesE.length === 1 && notesE[0].text === notesE[0].textEs && /Seguimos/.test(notesE[0].text), JSON.stringify(notesE).slice(0, 250));
  await approve(admin, cD.user.id);
  const queue2 = await admin("GET", "/api/admin/applications");
  const rowD2 = [...(queue2.data.pending || []), ...(queue2.data.decided || [])].find((u) => u.id === cD.user.id);
  check("the flag clears when the application is decided", !!rowD2 && !rowD2.reviewOverdue, JSON.stringify(rowD2).slice(0, 150));
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nBuild -226 server verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
