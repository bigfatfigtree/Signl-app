#!/usr/bin/env node
// Comped-post licensing verification (Jeff, 2026-10-26).
//
// Rights model: a comped visit is native share ONLY on every
// plan. A business can license a delivered comped post for the
// standard 90-day license at the creator's listed licensing fee:
// the creator approves or declines each request, money runs
// through the paid-lane math (fee + 3% from the business, 97% to
// the creator, held until the decision), and an approved license
// is what unlocks ad use on that post, for 90 days from the
// grant. Paid visits already include the license, so a license
// request on a paid post is refused. This suite proves the whole
// flow end to end, plus the preview twin writing nothing.
//
// Run: node scripts/verify-licensing.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8993;
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-licensing-"));
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
    name: `License Creator ${n}`,
    email: `lic${n}-${uniq()}@fixtures.dev`,
    password: "<redacted>",
    market: "Hampton Roads",
    city: "Norfolk",
    handle: `lic${n}${uniq()}`,
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
    password: "<redacted>",
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
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}

const DAY = 24 * 3600 * 1000;
let postN = 0;
async function deliveredPost(admin, bizC, creatorReg, offerBody) {
  await admin("POST", "/api/admin/review", { userId: creatorReg.user.id, decision: "approve" });
  const off = await bizC("POST", "/api/offers", { spots: 1, creatorId: creatorReg.user.id, ...offerBody });
  if (off.status !== 201) throw new Error("offer failed: " + JSON.stringify(off.data));
  const acc = await creatorReg.client("POST", `/api/offers/${off.data.offer.id}/accept`, { visitDate: "2026-10-21" });
  if (acc.status !== 201) throw new Error("accept failed: " + JSON.stringify(acc.data));
  const conf = await bizC("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
  if (conf.status !== 200) throw new Error("confirm failed: " + JSON.stringify(conf.data));
  postN += 1;
  const post = await creatorReg.client("POST", "/api/posts", { bookingId: acc.data.booking.id, url: `https://www.instagram.com/p/license${postN}/`, disclosedComp: true });
  if (post.status !== 201) throw new Error("post failed: " + JSON.stringify(post.data));
  return { offer: off.data.offer, booking: acc.data.booking, post: post.data.post };
}

try {
  startServer();
  await waitUp();
  const admin = await adminClient();
  const bizReg = await registerBusiness(admin, "self-service", "Licensing Test Kitchen");
  const bizC = bizReg.client;
  check("self-service business registered + activated (licensing is on every plan)", bizReg.res.status === 201, JSON.stringify(bizReg.res.data).slice(0, 200));

  part("fee field");
  const feeC = await registerCreator({});
  await admin("POST", "/api/admin/review", { userId: feeC.user.id, decision: "approve" });
  const setFee = await feeC.client("PATCH", "/api/me/profile", { licensingFee: 80 });
  check("creator sets a licensing fee ($80)", setFee.status === 200 && setFee.data.user.creator.licensingFee === 80, JSON.stringify(setFee.data).slice(0, 200));
  const badFee = await feeC.client("PATCH", "/api/me/profile", { licensingFee: 0 });
  check("a $0 licensing fee is refused (at least $1, or blank for none)", badFee.status === 400, `${badFee.status}`);
  const stillFee = await feeC.client("GET", "/api/auth/me");
  check("the refused save did not clear the listed fee", stillFee.data.user.creator.licensingFee === 80, JSON.stringify(stillFee.data.user.creator));
  const disc = await bizC("GET", "/api/discover?market=Hampton%20Roads");
  const card = (disc.data.creators || []).find((c) => c.userId === feeC.user.id);
  check("discovery card carries the licensing fee", !!card && !!card.profile && card.profile.licensingFee === 80, JSON.stringify(card && card.profile && card.profile.licensingFee));

  part("request -> decline -> re-request -> approve -> ad use");
  const v1 = await deliveredPost(admin, bizC, feeC, { title: "Comp dinner", whatComped: "Meal for two, on us", dollarCap: 100 });
  const bizBookings = await bizC("GET", "/api/bookings");
  const bk1 = (bizBookings.data.bookings || []).find((b) => b.id === v1.booking.id);
  check("the business's visit card prices the license from the creator's fee", !!bk1 && !!bk1.post && bk1.creatorLicensingFee === 80, JSON.stringify(bk1 && bk1.creatorLicensingFee));
  const adUseEarly = await bizC("POST", `/api/posts/${v1.post.id}/ad-use`, {});
  check("ad use on the comped post refuses before any license (403)", adUseEarly.status === 403, `${adUseEarly.status} ${JSON.stringify(adUseEarly.data)}`);
  const req1 = await bizC("POST", `/api/posts/${v1.post.id}/license-request`, {});
  check("license request created at the listed fee, paid-lane math (80 -> pay 82.40, creator keeps 77.60)", req1.status === 201 && req1.data.licenseRequest.fee === 80 && req1.data.licenseRequest.businessTotal === 82.4 && req1.data.licenseRequest.creatorNet === 77.6 && req1.data.licenseRequest.licenseDays === 90 && req1.data.licenseRequest.status === "pending" && req1.data.licenseRequest.escrowState === "held", `${req1.status} ${JSON.stringify(req1.data)}`);
  const reqDup = await bizC("POST", `/api/posts/${v1.post.id}/license-request`, {});
  check("a second request while one is waiting is refused (409)", reqDup.status === 409, `${reqDup.status}`);
  const creatorList = await feeC.client("GET", "/api/license-requests");
  check("the creator sees the pending request with the post link", creatorList.status === 200 && creatorList.data.licenseRequests.length === 1 && creatorList.data.licenseRequests[0].status === "pending" && !!creatorList.data.licenseRequests[0].postUrl, JSON.stringify(creatorList.data).slice(0, 200));
  const decline = await feeC.client("POST", `/api/license-requests/${req1.data.licenseRequest.id}/respond`, { decision: "decline" });
  check("creator declines: request declined, held money refunded", decline.status === 200 && decline.data.licenseRequest.status === "declined" && decline.data.licenseRequest.escrowState === "refunded", JSON.stringify(decline.data).slice(0, 200));
  const adUseDeclined = await bizC("POST", `/api/posts/${v1.post.id}/ad-use`, {});
  check("ad use still refuses after a decline (403)", adUseDeclined.status === 403, `${adUseDeclined.status}`);
  const req2 = await bizC("POST", `/api/posts/${v1.post.id}/license-request`, {});
  check("a fresh request after a decline is allowed", req2.status === 201, `${req2.status} ${JSON.stringify(req2.data)}`);
  const mBefore = await momentumOf(feeC.client);
  const approve = await feeC.client("POST", `/api/license-requests/${req2.data.licenseRequest.id}/respond`, { decision: "approve" });
  const endsMs = approve.data && approve.data.licenseRequest ? Date.parse(approve.data.licenseRequest.windowEndsAt) : 0;
  check("creator approves: granted, escrow released, 90-day window from the grant", approve.status === 200 && approve.data.licenseRequest.status === "granted" && approve.data.licenseRequest.escrowState === "released" && endsMs > Date.now() + 89 * DAY && endsMs < Date.now() + 91 * DAY, JSON.stringify(approve.data).slice(0, 250));
  check("the post itself now carries the granted license", !!approve.data.post && !!approve.data.post.license && approve.data.post.license.status === "granted", JSON.stringify(approve.data.post && approve.data.post.license));
  const adUseLicensed = await bizC("POST", `/api/posts/${v1.post.id}/ad-use`, {});
  check("ad use declares on the licensed comped post", adUseLicensed.status === 200 && !!adUseLicensed.data.post.adUseDeclaredAt, `${adUseLicensed.status} ${JSON.stringify(adUseLicensed.data)}`);
  const licEvents = await admin("GET", "/api/admin/events?type=ad_use_declared&limit=2000");
  check("the declaration is logged with the license basis", (licEvents.data.events || []).some((e) => e.data && e.data.basis === "license" && e.data.visitKind === "comp"), JSON.stringify((licEvents.data.events || []).map((e) => e.data)).slice(0, 200));
  const mAfter = await momentumOf(feeC.client);
  check("the creator earns +25 Momentum for the licensed ad use", mAfter.points === mBefore.points + 25, `${mBefore.points} -> ${mAfter.points}`);
  const adUseAgain = await bizC("POST", `/api/posts/${v1.post.id}/ad-use`, {});
  check("a second declaration on the same post is refused (409)", adUseAgain.status === 409, `${adUseAgain.status}`);

  part("gates: no fee, paid post");
  const noFeeC = await registerCreator({});
  const v2 = await deliveredPost(admin, bizC, noFeeC, { title: "Comp lunch", whatComped: "Meal for one, on us", dollarCap: 50 });
  const reqNoFee = await bizC("POST", `/api/posts/${v2.post.id}/license-request`, {});
  check("a creator with no listed fee cannot be sent a license request (400)", reqNoFee.status === 400 && /licensing fee/i.test(JSON.stringify(reqNoFee.data)), `${reqNoFee.status} ${JSON.stringify(reqNoFee.data)}`);
  const paidC = await registerCreator({});
  const v3 = await deliveredPost(admin, bizC, paidC, { title: "Paid dinner", whatComped: "Tasting menu for two", kind: "paid", cashRate: 250 });
  check("paid visit delivered as a paid booking", v3.booking.kind === "paid", JSON.stringify(v3.booking).slice(0, 150));
  const reqPaid = await bizC("POST", `/api/posts/${v3.post.id}/license-request`, {});
  check("a license request on a paid post is refused: the standard license is already included (400)", reqPaid.status === 400 && /already includes/i.test(JSON.stringify(reqPaid.data)), `${reqPaid.status} ${JSON.stringify(reqPaid.data)}`);

  part("window expiry (time travel)");
  const v4 = await deliveredPost(admin, bizC, feeC, { title: "Comp brunch", whatComped: "Brunch for two, on us", dollarCap: 80 });
  const req4 = await bizC("POST", `/api/posts/${v4.post.id}/license-request`, {});
  const approve4 = await feeC.client("POST", `/api/license-requests/${req4.data.licenseRequest.id}/respond`, { decision: "approve" });
  check("second license granted for the expiry pin", approve4.status === 200 && approve4.data.licenseRequest.status === "granted", JSON.stringify(approve4.data).slice(0, 150));
  await stopServer();
  editDb((db) => {
    const past = new Date(Date.now() - DAY).toISOString();
    const postRec = db[`post:${v4.post.id}`];
    if (postRec && postRec.license) postRec.license.windowEndsAt = past;
    const licRec = db[`license:${req4.data.licenseRequest.id}`];
    if (licRec) licRec.windowEndsAt = past;
  });
  startServer();
  await waitUp();
  const bizC2 = bizC; // same jar; the session lives in the DB file
  const adUseExpired = await bizC2("POST", `/api/posts/${v4.post.id}/ad-use`, {});
  check("ad use refuses once the 90-day license window has closed (403)", adUseExpired.status === 403 && /90-day license/i.test(JSON.stringify(adUseExpired.data)), `${adUseExpired.status} ${JSON.stringify(adUseExpired.data)}`);

  part("preview parity");
  const admin2 = await adminClient();
  const reqEventsBefore = await countEvents(admin2, "license_requested");
  const bizListBefore = await bizC("GET", "/api/license-requests");
  const pv = await admin2("POST", "/api/admin/preview/license-request", { creatorId: feeC.user.id });
  check("preview license request returns a flagged simulation with the real math (80 -> 82.40 / 77.60)", pv.status === 201 && pv.data.preview === true && pv.data.licenseRequest.fee === 80 && pv.data.licenseRequest.businessTotal === 82.4 && pv.data.licenseRequest.creatorNet === 77.6 && pv.data.licenseRequest.licenseDays === 90, `${pv.status} ${JSON.stringify(pv.data)}`);
  check("preview wrote no license_requested event", (await countEvents(admin2, "license_requested")) === reqEventsBefore);
  const bizListAfter = await bizC("GET", "/api/license-requests");
  check("preview saved no request", (bizListAfter.data.licenseRequests || []).length === (bizListBefore.data.licenseRequests || []).length, `${(bizListBefore.data.licenseRequests || []).length} -> ${(bizListAfter.data.licenseRequests || []).length}`);
  const noFeePv = await admin2("POST", "/api/admin/preview/license-request", { creatorId: noFeeC.user.id });
  check("preview refuses a creator with no listed fee (400)", noFeePv.status === 400, `${noFeePv.status}`);

  part("client wiring");
  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  check("visit card wires the license actions", appJs.includes("License for ads") && appJs.includes("requestLicense(") && appJs.includes("respondLicense(") && appJs.includes("Approve license"));
  check("creator profile wires the licensing fee field", appJs.includes("licensingFee") && appJs.includes("lane-fee"));
  check("the Growth nudge rides paid + license moments", appJs.includes("Growth is built for paid work and reuse"));
  const routerJs = fs.readFileSync(path.join(root, "netlify", "functions", "lib", "router.js"), "utf8");
  check("the license window is one 90-day constant", routerJs.includes("const LICENSE_WINDOW_DAYS = 90") && !routerJs.includes("AD_USE_WINDOW_MONTHS"));
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nLicensing verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
