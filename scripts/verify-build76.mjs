#!/usr/bin/env node
// Build -76 verification (Jeff, 2026-11-02): the license clarity
// pass. Jeff's ruling: the license must be "spelled out clearly
// for both sides and they understand." Copy only: no mechanics,
// prices, days, or server rules changed.
//
// Proves:
//   - source: every fixed surface carries the plain-words license
//     copy (what it allows, 90 days, when it starts, the end date
//     where a license exists, never longer), including the
//     licWindowLine helper that surfaces the stored windowEndsAt
//     on library rows, the corrected "Yours to use" start rules,
//     the Plan-bullet expansion, the creator fee/rate notes, the
//     approve-moment start + end date in both confirm dialogs and
//     the post-detail notice, and the Sig canon completions;
//   - canon unchanged: LICENSE_WINDOW_DAYS is still 90, plan
//     prices still 199/349/699, the 97% creator keep still reads
//     in the license copy, and the build35-pinned profile line is
//     untouched;
//   - live: bootstrap ships the new Growth bullets; a granted
//     license's windowEndsAt is ~90 days from the grant and rides
//     the business-home contentLibrary (type "licensed"); a paid
//     booking's library license is type "standard" with its end
//     ~90 days from the post date; a pending request ships
//     windowEndsAt null (the UI words it "starts the day you
//     approve").
//
// Run: node scripts/verify-build76.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8996;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "test-admin-password-76";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const count = (s, sub) => s.split(sub).length - 1;

// ---------- source pins ----------
part("source: plan bullets");
const marketsJs = fs.readFileSync(path.join(root, "netlify/functions/lib/markets.js"), "utf8");
check("Growth bullet says what the license allows", marketsJs.includes("Paid bookings include the 90-day license: repost the post, run it as an ad"));
check("Growth bullet says the library shows end dates", marketsJs.includes("Every license tracked in one library, with its end date"));
check("old unexplained bullets are gone", !marketsJs.includes("\"Paid bookings include the 90-day license\",") && !marketsJs.includes("\"Every license tracked in one library\","));
check("canon: founding prices unchanged", marketsJs.includes("priceMonthly: 199") && marketsJs.includes("priceMonthly: 349") && marketsJs.includes("priceMonthly: 699"));

part("source: business surfaces");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
check("booking sheet + preview twin spell the license", count(appJs, "Includes the standard license: repost + ad use for 90 days from the post date, never longer. The exact end date shows in Posts &amp; licenses once the post is live.") === 2, String(count(appJs, "never longer. The exact end date shows")));
check("business visit detail matches the creator's sentence", appJs.includes("This booking includes the standard license: repost and ad use for 90 days from the post date, never longer."));
check("licWindowLine surfaces the stored end date on rows", appJs.includes("function licWindowLine(lic)") && appJs.includes("Repost + ad use: ${fmtDay(start)} to ${fmtDay(lic.windowEndsAt)}") && appJs.includes("Repost + ad use ended ${fmtDay(lic.windowEndsAt)}"));
check("licWindowLine is wired into both library row builders", count(appJs, "${licWindowLine(r.license)}") === 2);
check("Yours to use intro states both start rules", appJs.includes("from the post date on a paid booking, from the day the creator said yes on a licensed post"));
check("the wrong post-date-only window line is gone", !appJs.includes("The window runs 90 days from the post date."));
check("Posts & licenses banner points at the end dates", appJs.includes("Every license below shows its end date, and no license ever runs longer than 90 days."));
check("feed cards carry the end date", count(appJs, "ends ${fmtDay(r.license.windowEndsAt)}") === 2);
check("license request confirm points at the end date", appJs.includes("The end date shows on the post from the day they approve."));

part("source: creator surfaces");
check("paid-rate note grants the license in plain words", count(appJs, "A paid booking includes the standard license: the business can repost your post and run it as an ad for 90 days from the post date, never longer, and never edited.") === 2);
check("fee line covers repost, not just ads", appJs.includes("repost my post and run it as an ad for 90 days:") && appJs.includes("a business can ask to repost your post and run it as an ad for 90 days, only with your approval."));
check("fee note states the start day and never longer", appJs.includes("The 90 days start the day you approve a request, and the license ends when the 90 days end, never longer."));
check("Earnings row: pending starts on approval, granted shows its end", appJs.includes("starts the day you approve") && appJs.includes("runs through ${fmtDay(l.windowEndsAt)}"));
check("approve confirms carry start + end + never longer (both dialogs + the Build -95 Sig in-thread approve)", count(appJs, "The 90 days start today, the day you approve, and end ${fmtDayFull(new Date(Date.now() + 90 * 86400000).toISOString())}. Never longer.") === 3, String(count(appJs, "The 90 days start today")));
check("post-detail notice carries the end date", appJs.includes("If you approve, the 90 days start today and end ${fmtDayFull(new Date(Date.now() + 90 * 86400000).toISOString())}."));
check("build35-pinned profile line untouched", appJs.includes("Run my post as an ad for 90 days:"));

part("source: Sig");
const sigaiJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");
check("Sig canon: licensed window starts at approval", sigaiJs.includes("starting the day the creator approves it, never longer"));
check("Sig canon: paid window starts at the post date", sigaiJs.includes("90 days from the post date to repost and run the post as an ad, never longer"));
const sigdataJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
check("Sig data answer points at the end date", sigdataJs.includes("its end date sits on the post in Posts & licenses"));
check("in-app Sig: business reuse answer completed", appJs.includes("90 days from the post date to repost and run ads, never longer. A comped post can be licensed at the creator's listed fee for 90 days from the day the creator approves"));
check("in-app Sig: creator licensing answer completed", appJs.includes("starting the day you approve it and never longer. You keep 97% of the fee"));

part("source: canon + style");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("canon: the license window is still one 90-day constant", routerJs.includes("const LICENSE_WINDOW_DAYS = 90") && !routerJs.includes("LICENSE_WINDOW_DAYS = 180") && !routerJs.includes("LICENSE_WINDOW_DAYS = 365"));
check("canon: 97% keep still reads in the grant copy", appJs.includes("(97% of your fee)") && sigaiJs.includes("keeps 97% of the fee"));
const newLines = [
  "Paid bookings include the 90-day license: repost the post, run it as an ad",
  "Includes the standard license: repost + ad use for 90 days from the post date, never longer. The exact end date shows in Posts &amp; licenses once the post is live.",
  "Every license below shows its end date, and no license ever runs longer than 90 days.",
  "The 90 days start the day you approve a request, and the license ends when the 90 days end, never longer.",
];
check("no em dashes in the new license copy", newLines.every((l) => !l.includes("—") && !l.includes("–")));

// ---------- live flow ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b76-"));
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
    name: `Clarity Creator ${n}`,
    email: `b76c${n}-${uniq()}@fixtures.dev`,
    password: "fixture-pass-123",
    market: "Hampton Roads",
    city: "Norfolk",
    handle: `b76c${n}${uniq()}`,
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
    email: `b76biz-${uniq()}@fixtures.dev`,
    password: "fixture-pass-123",
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
  const post = await creatorReg.client("POST", "/api/posts", { bookingId: acc.data.booking.id, url: `https://www.instagram.com/p/b76-${postN}/`, disclosedComp: true });
  if (post.status !== 201) throw new Error("post failed: " + JSON.stringify(post.data));
  return { offer: off.data.offer, booking: acc.data.booking, post: post.data.post };
}

try {
  startServer();
  await waitUp();
  const admin = await adminClient();

  part("live: bootstrap plan bullets");
  const boot = await makeClient()("GET", "/api/bootstrap");
  const growth = (boot.data.plans || []).find((p) => p.id === "growth");
  check("bootstrap ships the spelled-out Growth license bullet", !!growth && growth.features.includes("Paid bookings include the 90-day license: repost the post, run it as an ad"), JSON.stringify(growth && growth.features));
  check("bootstrap ships the library end-date bullet", !!growth && growth.features.includes("Every license tracked in one library, with its end date"));

  part("live: licensed window rides the library");
  const bizReg = await registerBusiness(admin, "growth", "Clarity Test Kitchen");
  const bizC = bizReg.client;
  const feeC = await registerCreator({});
  await admin("POST", "/api/admin/review", { userId: feeC.user.id, decision: "approve" });
  const setFee = await feeC.client("PATCH", "/api/me/profile", { licensingFee: 80 });
  check("creator lists an $80 licensing fee", setFee.status === 200 && setFee.data.user.creator.licensingFee === 80);
  const v1 = await deliveredPost(admin, bizC, feeC, { title: "Comp dinner", whatComped: "Meal for two, on us", dollarCap: 100 });
  const req = await bizC("POST", `/api/posts/${v1.post.id}/license-request`, {});
  check("request is pending with no window yet (UI words the start)", req.status === 201 && req.data.licenseRequest.status === "pending" && req.data.licenseRequest.windowEndsAt === null && req.data.licenseRequest.licenseDays === 90, JSON.stringify(req.data).slice(0, 200));
  const t0 = Date.now();
  const approve = await feeC.client("POST", `/api/license-requests/${req.data.licenseRequest.id}/respond`, { decision: "approve" });
  const endsMs = approve.data && approve.data.licenseRequest ? Date.parse(approve.data.licenseRequest.windowEndsAt) : 0;
  check("grant stamps the end ~90 days from the approval", approve.status === 200 && endsMs > t0 + 89 * DAY && endsMs < t0 + 91 * DAY, JSON.stringify(approve.data).slice(0, 200));
  const home1 = await bizC("GET", "/api/me/business-home");
  const row1 = (home1.data.home.contentLibrary || []).find((r) => r.bookingId === v1.booking.id);
  check("library row carries the licensed window end for the row line", !!row1 && row1.license.type === "licensed" && row1.license.windowEndsAt === approve.data.licenseRequest.windowEndsAt && row1.license.daysLeft >= 89 && row1.license.daysLeft <= 90, JSON.stringify(row1 && row1.license));

  part("live: standard window rides the library");
  const paidC = await registerCreator({});
  const v2 = await deliveredPost(admin, bizC, paidC, { title: "Paid dinner", whatComped: "Tasting menu for two", kind: "paid", cashRate: 250 });
  const home2 = await bizC("GET", "/api/me/business-home");
  const row2 = (home2.data.home.contentLibrary || []).find((r) => r.bookingId === v2.booking.id);
  const stdEnd = row2 && row2.license ? Date.parse(row2.license.windowEndsAt) : 0;
  const postMs = row2 ? Date.parse(row2.postedAt) : 0;
  check("paid booking's library license is standard, ending ~90 days after the post", !!row2 && row2.license.type === "standard" && Math.abs(stdEnd - (postMs + 90 * DAY)) < 2 * DAY, JSON.stringify(row2 && row2.license));
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nBuild -76 (license clarity) verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
