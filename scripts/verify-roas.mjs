// SIGNL verify: the SIGNL ROAS Score (Jeff, 2026-10-19).
//
// Jeff's model: every booking carries a per-creator audience
// code (HANDLE-suffix). A code DISCOUNT is the business's
// opt-in, never a default: the business record carries
// discountEnabled (default false) + discountPct (its own choice,
// 5..50); a booking is stamped with the business's percentage
// when codes are on and 0 when they are off, and the code is
// issued either way as the counting handle. ROAS_MODEL only
// carries suggestedDiscountPct, shown when a business enables
// codes and never stamped from. The business reports register
// redemptions against the booking (count + basket total, no POS
// integration). Value = register spend
// tracked through the code + media value at the published model
// rates (ROAS_MODEL: $22 CPM, $0.10 a like, $0.50 a comment,
// $1.00 a share) from the creator's post-performance report.
// Cost = comp at the business's own cost + the discounts the
// code gave away; the all-in variant adds the plan allocation
// (plan price / visit allowance). Scores divide summed values
// by summed costs, never average scores. Zero cost yields a
// null score, never NaN or Infinity. The label everywhere:
// "SIGNL ROAS Score, our own model"; register value is a floor
// (code-less customers are not counted); media value is modeled.
//
// This suite proves: the exact worked example end to end
// (12,400 views / 986 likes / 74 comments / 41 shares ->
// media 449.40; $486 baskets at 20% -> discount 97.20; comp cost
// 15 -> score 8.34; all-in with the Growth allocation 29.95 ->
// 6.58); creator codes stamped at creation on comp AND paid
// bookings and never on public profiles; the reporting
// endpoint's auth and validation; comments/shares accepted by
// the performance report; aggregation summing before dividing
// (preview: 6.29, not the 6.25 average); edge cases; and the
// preview redemption report writing nothing at all.
//
// Uses scripts/dev-server.mjs with a throwaway local DB file
// and SIGNL_TEST_ALLOW_BUSINESS=1. Production is never touched.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "test-admin-password-123";

let passed = 0;
const failures = [];
function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`PASS  ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label} ${detail}`); }
}
const uniq = () => Math.random().toString(36).slice(2, 9);

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
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data, text };
  };
  return api;
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up");
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-roas-"));
const dbFile = path.join(tmp, "db.json");
let server = null;
try {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  await waitUp();

  const anon = makeClient();
  const admin = makeClient();
  const loginRes = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginRes.status !== 200) throw new Error(`admin login failed: ${loginRes.status}`);

  const boot = await anon("GET", "/api/bootstrap");
  check("bootstrap publishes the ROAS model rates and label", boot.data.roasModel && boot.data.roasModel.cpm === 22 && boot.data.roasModel.like === 0.1 && boot.data.roasModel.comment === 0.5 && boot.data.roasModel.share === 1 && boot.data.roasModel.suggestedDiscountPct === 20 && boot.data.roasModel.defaultDiscountPct === undefined && /SIGNL ROAS Score/.test(boot.data.roasModel.label || ""), JSON.stringify(boot.data.roasModel || null));

  async function registerCreator(handle) {
    const client = makeClient();
    const r = await client("POST", "/api/auth/register", {
      role: "creator", name: `ROAS Creator ${handle}`, email: `${handle}@example.com`, password: "password123",
      market: "Hampton Roads", city: "Norfolk", handle,
      categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
      followerCount: 5000, avgViews: 900, localAudiencePct: 62, bio: "",
      agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
    });
    if (r.status !== 201 || !r.data.user) throw new Error(`creator register failed: ${r.status} ${JSON.stringify(r.data)}`);
    return { client, user: r.data.user };
  }
  async function registerBusiness(planId, businessName) {
    const client = makeClient();
    const r = await client("POST", "/api/auth/register", {
      role: "business", name: "Biz Owner", email: `biz-${uniq()}@example.com`, password: "password123",
      market: "Hampton Roads", city: "Norfolk", businessName, category: "Restaurant", planId, agreedTerms: true,
    });
    if (r.status !== 201 || !r.data.user) throw new Error(`business register failed: ${r.status} ${JSON.stringify(r.data)}`);
    return { client, user: r.data.user };
  }
  async function approve(userId) {
    const r = await admin("POST", "/api/admin/review", { userId, decision: "approve" });
    if (r.status !== 200) throw new Error(`approve failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  const u = uniq();
  const biz = await registerBusiness("growth", "ROAS Kitchen");
  const biz2 = await registerBusiness("self-service", "Other Table");
  const c1 = await registerCreator(`roascooks${u}`);
  const c2 = await registerCreator(`roastable${u}`);
  await approve(c1.user.id); await approve(c2.user.id);
  await approve(biz.user.id); await approve(biz2.user.id);

  async function compBooking(business, creator, dollarCap, title) {
    const off = await business("POST", "/api/offers", { title, whatComped: "Dinner for two", dollarCap, spots: 1, includesAlcohol: false, creatorId: creator.user.id });
    if (off.status !== 201) throw new Error(`offer failed: ${off.status} ${JSON.stringify(off.data)}`);
    const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
    if (acc.status !== 201) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.data)}`);
    return acc.data.booking;
  }
  async function completeVisit(booking, business, creator) {
    const conf = await business("POST", `/api/bookings/${booking.id}/confirm`, {});
    if (conf.status !== 200) throw new Error(`confirm failed: ${conf.status} ${JSON.stringify(conf.data)}`);
    const post = await creator("POST", "/api/posts", { bookingId: booking.id, url: "https://www.instagram.com/p/ROAS1/", includesDisclosure: true });
    if (post.status !== 201) throw new Error(`post failed: ${post.status} ${JSON.stringify(post.data)}`);
  }
  async function getBooking(client, id) {
    const r = await client("GET", "/api/bookings");
    const b = (r.data.bookings || []).find((x) => x.id === id);
    if (!b) throw new Error(`booking ${id} not visible`);
    return b;
  }

  // ---------- A: codes are stamped at creation; discounts are opt-in ----------
  // A business that never touched the setting has code discounts
  // OFF: its bookings stamp 0, and the code is still issued,
  // because the code is the counting handle either way.
  const bk0 = await compBooking(biz.client, c1, 50, "ROAS tasting zero");
  check("a comp booking carries a creator code derived from the creator's handle", typeof bk0.creatorCode === "string" && bk0.creatorCode.startsWith("ROASCOOKS") && /^[A-Z0-9]{1,12}-[A-Z0-9]{4}$/.test(bk0.creatorCode), String(bk0.creatorCode));
  check("a codes-off business's booking is stamped 0 percent (discounts are opt-in, never a default)", bk0.discountPct === 0 && bk0.redemptions === null, JSON.stringify({ discountPct: bk0.discountPct, redemptions: bk0.redemptions }));
  check("the comp's cost basis starts at the comp's stated value (the business's own cost convention)", bk0.compCostActual === 50, String(bk0.compCostActual));
  check("a fresh booking's ROAS is all zeros with a defined score, never NaN", bk0.roas && bk0.roas.value === 0 && bk0.roas.mediaValue === 0 && bk0.roas.registerValue === 0 && bk0.roas.score === 0 && bk0.roas.allInScore === 0 && bk0.roas.redemptions.count === 0, JSON.stringify(bk0.roas));
  const bk0b = await compBooking(biz.client, c2, 40, "ROAS tasting zero b");
  check("creator codes are unique per booking", !!bk0b.creatorCode && bk0b.creatorCode !== bk0.creatorCode, `${bk0.creatorCode} vs ${bk0b.creatorCode}`);

  // Paid bookings carry codes too (and the all-in business cost).
  const rateSet = await c1.client("PATCH", "/api/me/profile", { paidRate: 250 });
  if (rateSet.status !== 200) throw new Error(`paidRate set failed: ${rateSet.status} ${JSON.stringify(rateSet.data)}`);
  const paidOff = await biz.client("POST", "/api/bookings/paid", { creatorId: c1.user.id });
  check("a paid booking for a codes-off business stamps 0 percent too", paidOff.status === 201 && typeof paidOff.data.booking.creatorCode === "string" && paidOff.data.booking.discountPct === 0 && paidOff.data.booking.compCostActual === 257.5, `${paidOff.status} ${JSON.stringify(paidOff.data.booking || paidOff.data).slice(0, 200)}`);

  // ---------- A2: the discount setting itself (admin endpoint) ----------
  const asCreatorAdmin = await c1.client("POST", "/api/admin/discount-setting", { userId: biz.user.id, enabled: true, pct: 20 });
  check("the discount-setting endpoint is admin-only (403 for a creator)", asCreatorAdmin.status === 403, String(asCreatorAdmin.status));
  const onCreator = await admin("POST", "/api/admin/discount-setting", { userId: c1.user.id, enabled: true, pct: 20 });
  check("the discount setting refuses a non-business account (404)", onCreator.status === 404, String(onCreator.status));
  const onGhost = await admin("POST", "/api/admin/discount-setting", { userId: "no-such-user", enabled: true, pct: 20 });
  check("the discount setting refuses an unknown account (404)", onGhost.status === 404, String(onGhost.status));
  const pctLow = await admin("POST", "/api/admin/discount-setting", { userId: biz.user.id, enabled: true, pct: 3 });
  const pctHigh = await admin("POST", "/api/admin/discount-setting", { userId: biz.user.id, enabled: true, pct: 51 });
  const pctJunk = await admin("POST", "/api/admin/discount-setting", { userId: biz.user.id, enabled: true, pct: "lots" });
  check("discount percentages outside 5..50 (or not numbers) are refused", pctLow.status === 400 && pctHigh.status === 400 && pctJunk.status === 400, `${pctLow.status}/${pctHigh.status}/${pctJunk.status}`);
  const turnedOn = await admin("POST", "/api/admin/discount-setting", { userId: biz.user.id, enabled: true, pct: 20 });
  check("an admin can turn a business's code discounts on at its chosen percentage", turnedOn.status === 200 && turnedOn.data.business.discount.enabled === true && turnedOn.data.business.discount.pct === 20 && turnedOn.data.business.discount.effectivePct === 20, `${turnedOn.status} ${JSON.stringify(turnedOn.data.business || turnedOn.data).slice(0, 160)}`);
  const bizMe = await biz.client("GET", "/api/auth/me");
  check("the setting lands on the business record the owner sees", bizMe.data.user.business.discountEnabled === true && bizMe.data.user.business.discountPct === 20, JSON.stringify(bizMe.data.user.business || {}).slice(0, 160));
  const evs0 = await admin("GET", "/api/admin/events?limit=2000");
  check("the admin write is on the event log", (evs0.data.events || []).filter((e) => e.type === "business_discount_setting_updated" && e.subjectId === biz.user.id).length === 1, "");

  // With codes on at the business's chosen 20, new bookings
  // stamp that percentage, comp and paid alike.
  const bk1 = await compBooking(biz.client, c1, 50, "ROAS tasting one");
  check("a codes-on business's booking is stamped its own percentage (20) with no tally yet", bk1.discountPct === 20 && bk1.redemptions === null, JSON.stringify({ discountPct: bk1.discountPct, redemptions: bk1.redemptions }));
  const rateSet2 = await c2.client("PATCH", "/api/me/profile", { paidRate: 250 });
  if (rateSet2.status !== 200) throw new Error(`paidRate set failed: ${rateSet2.status} ${JSON.stringify(rateSet2.data)}`);
  const paidOn = await biz.client("POST", "/api/bookings/paid", { creatorId: c2.user.id });
  check("a paid booking for a codes-on business stamps its percentage too", paidOn.status === 201 && typeof paidOn.data.booking.creatorCode === "string" && paidOn.data.booking.discountPct === 20 && paidOn.data.booking.compCostActual === 257.5, `${paidOn.status} ${JSON.stringify(paidOn.data.booking || paidOn.data).slice(0, 200)}`);

  // ---------- B: the worked example, end to end ----------
  await completeVisit(bk1, biz.client, c1.client);
  const perf = await c1.client("POST", `/api/bookings/${bk1.id}/performance`, { views: 12400, likes: 986, comments: 74, shares: 41 });
  check("the performance report now accepts comments and shares", perf.status === 200 && perf.data.post.comments === 74 && perf.data.post.shares === 41, `${perf.status} ${JSON.stringify(perf.data.post || perf.data).slice(0, 160)}`);
  const perfAgain = await c1.client("POST", `/api/bookings/${bk1.id}/performance`, { views: 1 });
  check("a second performance report is still refused (one report per post)", perfAgain.status === 409, String(perfAgain.status));
  const bk1Pre = await getBooking(biz.client, bk1.id);
  check("media value prices the full report at the model rates (449.40 before any register tally)", bk1Pre.roas && bk1Pre.roas.mediaValue === 449.4 && bk1Pre.roas.registerValue === 0 && bk1Pre.roas.value === 449.4, JSON.stringify(bk1Pre.roas));
  const rep = await biz.client("POST", `/api/bookings/${bk1.id}/code-redemptions`, { count: 9, basketTotal: 486, compCostActual: 15 });
  const r1 = (rep.data.booking || {}).roas || {};
  check("WORKED EXAMPLE: 9 redemptions, $486 baskets, comp cost 15 -> score 8.34, all-in 6.58", rep.status === 200 && r1.registerValue === 486 && r1.mediaValue === 449.4 && r1.value === 935.4 && r1.compCost === 15 && r1.discountCost === 97.2 && r1.planAllocation === 29.95 && r1.score === 8.34 && r1.allInScore === 6.58 && r1.redemptions.count === 9 && r1.redemptions.basketTotal === 486, `${rep.status} ${JSON.stringify(r1)}`);
  check("the tally lands on the booking with its discount snapshot", rep.data.booking.redemptions && rep.data.booking.redemptions.count === 9 && rep.data.booking.redemptions.basketTotal === 486 && rep.data.booking.redemptions.discountPct === 20 && rep.data.booking.compCostActual === 15, JSON.stringify(rep.data.booking.redemptions || null));
  const evs1 = await admin("GET", "/api/admin/events?limit=2000");
  check("the redemption report is on the event log", (evs1.data.events || []).filter((e) => e.type === "code_redemptions_reported" && e.subjectId === bk1.id).length === 1, "");

  // ---------- C: auth + validation on the reporting endpoint ----------
  const asCreator = await c1.client("POST", `/api/bookings/${bk1.id}/code-redemptions`, { count: 1, basketTotal: 10 });
  check("a creator cannot report redemptions (403 with the roles explained)", asCreator.status === 403, String(asCreator.status));
  const asOtherBiz = await biz2.client("POST", `/api/bookings/${bk1.id}/code-redemptions`, { count: 1, basketTotal: 10 });
  check("another business cannot report against this booking (404, no existence leak)", asOtherBiz.status === 404, String(asOtherBiz.status));
  const negCount = await biz.client("POST", `/api/bookings/${bk1.id}/code-redemptions`, { count: -1, basketTotal: 10 });
  const fracCount = await biz.client("POST", `/api/bookings/${bk1.id}/code-redemptions`, { count: 2.5, basketTotal: 10 });
  const negBasket = await biz.client("POST", `/api/bookings/${bk1.id}/code-redemptions`, { count: 1, basketTotal: -5 });
  const badPct = await biz.client("POST", `/api/bookings/${bk1.id}/code-redemptions`, { count: 1, basketTotal: 10, discountPct: 150 });
  check("invalid tallies are refused (negative, fractional, negative basket, discount over 100)", negCount.status === 400 && fracCount.status === 400 && negBasket.status === 400 && badPct.status === 400, `${negCount.status}/${fracCount.status}/${negBasket.status}/${badPct.status}`);
  const adminRep = await admin("POST", `/api/bookings/${bk1.id}/code-redemptions`, { count: 10, basketTotal: 500 });
  const r1b = (adminRep.data.booking || {}).roas || {};
  check("an admin can report, and a report REPLACES the tally (10/$500, not 19/$986)", adminRep.status === 200 && adminRep.data.booking.redemptions.count === 10 && adminRep.data.booking.redemptions.basketTotal === 500 && r1b.discountCost === 100 && r1b.score === 8.26, `${adminRep.status} ${JSON.stringify(r1b)}`);

  // ---------- D: the creator sees the code; the public never does ----------
  const c1View = await getBooking(c1.client, bk1.id);
  check("the creator's own booking view carries their code and the score", c1View.creatorCode === bk1.creatorCode && c1View.roas && c1View.roas.score === 8.26, JSON.stringify({ code: c1View.creatorCode, score: c1View.roas && c1View.roas.score }));
  const pub = await anon("GET", `/api/c/roascooks${u}`);
  check("the public profile never exposes the creator code", pub.status === 200 && !pub.text.includes(bk1.creatorCode) && !pub.text.includes("creatorCode") && !pub.text.includes("ROAS Score"), `${pub.status} len=${pub.text.length}`);

  // ---------- E: edge cases ----------
  const bk2 = await compBooking(biz.client, c2, 40, "ROAS tasting two");
  check("the second creator's booking stamps the business's percentage as well", bk2.discountPct === 20, String(bk2.discountPct));
  await completeVisit(bk2, biz.client, c2.client);
  const bk2View = await getBooking(biz.client, bk2.id);
  check("a delivered post with no performance report yet prices media at zero", !!bk2View.post && bk2View.roas && bk2View.roas.mediaValue === 0 && bk2View.roas.value === 0, JSON.stringify(bk2View.roas));
  const commentsOnly = await c2.client("POST", `/api/bookings/${bk2.id}/performance`, { comments: 10 });
  check("a report of only comments is accepted (any one of the four numbers counts)", commentsOnly.status === 200 && commentsOnly.data.post.comments === 10, `${commentsOnly.status} ${JSON.stringify(commentsOnly.data).slice(0, 120)}`);
  const bk2After = await getBooking(biz.client, bk2.id);
  check("comments price at fifty cents in the model (10 comments -> 5.00 media)", bk2After.roas && bk2After.roas.mediaValue === 5, JSON.stringify(bk2After.roas));
  const zeroed = await admin("POST", `/api/bookings/${bk2.id}/code-redemptions`, { count: 0, basketTotal: 0, compCostActual: 0 });
  const rz = (zeroed.data.booking || {}).roas || {};
  check("zero cost returns a null score, never NaN or Infinity", zeroed.status === 200 && rz.score === null && rz.compCost === 0 && rz.discountCost === 0 && !/NaN|Infinity/.test(JSON.stringify(rz)), JSON.stringify(rz));
  check("with the plan allocation known the all-in still resolves on the allocation alone (5.00 media / 29.95 = 0.17)", rz.allInScore === 0.17 && rz.planKnown === true && rz.value === 5, JSON.stringify(rz));

  // ---------- E2: codes-off math: the tally still counts at 0 percent ----------
  // bk0 was stamped before the business opted in, so it stays a
  // counting code: redemptions tally, register value counts, the
  // discount cost is zero, and the score computes from the sums.
  await completeVisit(bk0, biz.client, c1.client);
  const perf0 = await c1.client("POST", `/api/bookings/${bk0.id}/performance`, { views: 1000 });
  check("codes-off booking: a performance report still prices the media side (1000 views -> 22.00)", perf0.status === 200 && perf0.data.post.views === 1000, `${perf0.status} ${JSON.stringify(perf0.data).slice(0, 120)}`);
  const rep0 = await biz.client("POST", `/api/bookings/${bk0.id}/code-redemptions`, { count: 4, basketTotal: 200, compCostActual: 25 });
  const r0 = (rep0.data.booking || {}).roas || {};
  check("codes-off booking: tally counts, discount cost is 0, score computes from sums (222 / 25 = 8.88, all-in 4.04), never NaN", rep0.status === 200 && rep0.data.booking.redemptions.discountPct === 0 && r0.registerValue === 200 && r0.mediaValue === 22 && r0.value === 222 && r0.compCost === 25 && r0.discountCost === 0 && r0.score === 8.88 && r0.allInScore === 4.04 && !/NaN|Infinity/.test(JSON.stringify(r0)), `${rep0.status} ${JSON.stringify(r0)}`);

  // ---------- H: the business's own surface: the Plan tab (PATCH /me/profile) ----------
  const c3 = await registerCreator(`roasplan${u}`);
  await approve(c3.user.id);
  const patchLow = await biz2.client("PATCH", "/api/me/profile", { discountPct: 4 });
  const patchHigh = await biz2.client("PATCH", "/api/me/profile", { discountPct: 51 });
  const patchJunk = await biz2.client("PATCH", "/api/me/profile", { discountEnabled: "yes" });
  check("Plan tab writes validate too (percent inside 5..50, on/off a real boolean)", patchLow.status === 400 && patchHigh.status === 400 && patchJunk.status === 400, `${patchLow.status}/${patchHigh.status}/${patchJunk.status}`);
  const patchOn = await biz2.client("PATCH", "/api/me/profile", { discountEnabled: true, discountPct: 25 });
  check("a business can turn its own code discounts on at its own percentage (25)", patchOn.status === 200 && patchOn.data.user.business.discountEnabled === true && patchOn.data.user.business.discountPct === 25, `${patchOn.status} ${JSON.stringify(patchOn.data.user ? patchOn.data.user.business : patchOn.data).slice(0, 160)}`);
  const bkB2 = await compBooking(biz2.client, c3, 30, "ROAS plan-tab tasting");
  check("bookings stamp the Plan-tab percentage (25)", bkB2.discountPct === 25, String(bkB2.discountPct));
  const patchOff = await biz2.client("PATCH", "/api/me/profile", { discountEnabled: false });
  const bkB2b = await compBooking(biz2.client, c3, 30, "ROAS plan-tab tasting two");
  check("turning codes back off stamps 0 again (the percentage is remembered, not applied)", patchOff.status === 200 && patchOff.data.user.business.discountPct === 25 && bkB2b.discountPct === 0, `${patchOff.status} ${bkB2b.discountPct}`);

  // ---------- F: preview simulation ----------
  const statsBefore = await admin("GET", "/api/admin/stats");
  const evBefore = await admin("GET", "/api/admin/events?limit=2000");
  const dash = await admin("GET", "/api/admin/preview/dashboard");
  const dBookings = (dash.data.dashboard || {}).bookings || [];
  const onTime = dBookings.find((b) => b.id === "preview-dash-3") || {};
  const late = dBookings.find((b) => b.id === "preview-dash-4") || {};
  const agg = ((dash.data.dashboard || {}).summary || {}).roas || {};
  check("preview: the two delivered bookings carry the fixed simulated tallies (9/$486 and 6/$318)", onTime.redemptions && onTime.redemptions.count === 9 && onTime.redemptions.basketTotal === 486 && late.redemptions && late.redemptions.count === 6 && late.redemptions.basketTotal === 318, JSON.stringify({ a: onTime.redemptions, b: late.redemptions }));
  check("preview: per-booking scores are 6.49 and 6.01 with all-ins 5.37 and 4.64", onTime.roas && onTime.roas.score === 6.49 && onTime.roas.allInScore === 5.37 && late.roas && late.roas.score === 6.01 && late.roas.allInScore === 4.64, JSON.stringify({ a: onTime.roas && onTime.roas.score, b: late.roas && late.roas.score }));
  check("preview: aggregation SUMS before dividing (6.29, not the 6.25 average of the two scores)", agg.score === 6.29 && agg.score !== 6.25 && agg.allInScore === 5.06 && agg.value === 1545.7 && agg.registerValue === 804 && agg.mediaValue === 741.7, JSON.stringify(agg));
  check("preview: Salt & Ember is presented as codes ON at its chosen 20 percent; Harbor Table (Managed) as codes OFF", dash.data.dashboard.business.discountCodes && dash.data.dashboard.business.discountCodes.enabled === true && dash.data.dashboard.business.discountCodes.pct === 20 && dash.data.dashboard.managedView.discountCodes && dash.data.dashboard.managedView.discountCodes.enabled === false, JSON.stringify({ se: dash.data.dashboard.business.discountCodes, ht: dash.data.dashboard.managedView && dash.data.dashboard.managedView.discountCodes }));
  check("preview: the delivered bookings carry Salt & Ember's opted-in 20 percent stamp", onTime.discountPct === 20 && late.discountPct === 20 && onTime.redemptions.discountPct === 20, JSON.stringify({ a: onTime.discountPct, b: late.discountPct }));
  const simRep = await admin("POST", "/api/admin/preview/code-redemptions", { bookingId: "preview-dash-3", count: 12, basketTotal: 600 });
  check("preview: a simulated tally recomputes the booking and the dashboard (6.28 / 6.18)", simRep.status === 200 && simRep.data.preview === true && simRep.data.booking.roas.score === 6.28 && simRep.data.roas.score === 6.18 && /[Ss]imulation/.test(simRep.data.note || ""), `${simRep.status} ${JSON.stringify(simRep.data.booking && simRep.data.booking.roas)}`);
  const simBad = await admin("POST", "/api/admin/preview/code-redemptions", { bookingId: "preview-dash-1", count: 1, basketTotal: 10 });
  check("preview: tallies only report against a delivered simulated visit (400 on a merely booked one)", simBad.status === 400, String(simBad.status));
  const simForbidden = await c1.client("POST", "/api/admin/preview/code-redemptions", { bookingId: "preview-dash-3", count: 1, basketTotal: 10 });
  check("preview: the simulated tally endpoint is admin-only", simForbidden.status === 403, String(simForbidden.status));
  const statsAfter = await admin("GET", "/api/admin/stats");
  const evAfter = await admin("GET", "/api/admin/events?limit=2000");
  check("preview: redemption reporting wrote nothing (stats identical)", JSON.stringify(statsAfter.data) === JSON.stringify(statsBefore.data), "");
  check("preview: redemption reporting logged nothing (events identical)", (evAfter.data.events || []).length === (evBefore.data.events || []).length, `${(evBefore.data.events || []).length} -> ${(evAfter.data.events || []).length}`);
  const dashAgain = await admin("GET", "/api/admin/preview/dashboard");
  const onTimeAgain = (((dashAgain.data.dashboard || {}).bookings || []).find((b) => b.id === "preview-dash-3") || {});
  check("preview: the dashboard still shows the original simulated tally afterwards (9/$486)", onTimeAgain.redemptions && onTimeAgain.redemptions.count === 9 && onTimeAgain.redemptions.basketTotal === 486, JSON.stringify(onTimeAgain.redemptions || null));

  // ---------- F2: the Business Home object (concept merge, 2026-10-20) ----------
  // The home layer reads the same simulation: headline metrics,
  // attention, pipeline stage reach, plan pace, working content
  // ranked by register tallies, next visits by nearest deadline.
  const home = (dashAgain.data.dashboard || {}).home || {};
  check("preview home: headline metrics ride the same simulation (5 of 20 visits, 15 left, 2 posts live, ROAS 6.29)", home.visitsUsed === 5 && home.visitsAllowance === 20 && home.visitsRemaining === 15 && home.postsLive === 2 && home.roasScore === 6.29, JSON.stringify(home));
  check("preview home: pipeline counts bookings that reached each stage (5 invited, 5 claimed, 5 visit set, 4 redeemed, 2 live)", !!home.pipeline && home.pipeline.invited === 5 && home.pipeline.claimed === 5 && home.pipeline.visitSet === 5 && home.pipeline.clockRunning === 4 && home.pipeline.live === 2, JSON.stringify(home.pipeline));
  check("preview home: plan pace is 25 percent of the Growth allowance", home.planPacePct === 25, String(home.planPacePct));
  check("preview home: attention leads with the overdue post, then the running clock", Array.isArray(home.attention) && home.attention.length === 2 && home.attention[0].kind === "overdue" && home.attention[1].kind === "clock", JSON.stringify(home.attention));
  check("preview home: content that is working ranks by register tallies (9 uses before 6)", Array.isArray(home.topContent) && home.topContent.length === 2 && home.topContent[0].bookingId === "preview-dash-3" && home.topContent[0].redemptions.count === 9 && home.topContent[1].redemptions.count === 6, JSON.stringify((home.topContent || []).map((c) => c.bookingId)));
  check("preview home: next visits sort by nearest deadline (post clock, hard stop, redeem window)", Array.isArray(home.nextVisits) && home.nextVisits.length === 3 && home.nextVisits[0].bookingId === "preview-dash-2" && home.nextVisits[1].bookingId === "preview-dash-5" && home.nextVisits[2].bookingId === "preview-dash-1", JSON.stringify((home.nextVisits || []).map((n) => n.bookingId)));

  // ---------- G: the client carries the surfaces ----------
  const appJs = await anon("GET", "/app.js");
  check("client ships the creator audience-code framing", appJs.text.includes("Your audience code at") && appJs.text.includes("every use is tracked"), "");
  check("client branches the visit-card copy on the stamp: a discount is promised only when the business opted in", appJs.text.includes("your audience gets") && appJs.text.includes("has not turned on a code discount") && appJs.text.includes("counting code only"), "");
  check("client ships the discount settings surfaces (Plan tab + admin endpoint)", appJs.text.includes("Audience code discount") && appJs.text.includes("saveMyDiscount") && appJs.text.includes("/admin/discount-setting"), "");
  check("client labels the preview businesses' code choices in words (on at Salt & Ember, off at Harbor Table)", appJs.text.includes("Audience-code discounts: on.") && appJs.text.includes("Audience-code discounts: off."), "");
  check("client ships the ROAS label and the business tally form", appJs.text.includes("SIGNL ROAS Score") && appJs.text.includes("submitCodeRedemptions") && appJs.text.includes("/code-redemptions") && appJs.text.includes("pvReportRedemptions"), "");
  check("client never says revenue was generated", !/revenue (generated|we generated)/i.test(appJs.text), "");
  check("client ships the business preview home (metrics, attention, pipeline, plan pace, working content, next visits)", appJs.text.includes("pvHomeHtml") && appJs.text.includes("Business home") && appJs.text.includes("Visit pipeline") && appJs.text.includes("Plan pace") && appJs.text.includes("need your attention"), "");
  check("client ships the creator home (active visit, opportunities, local signal, money piles)", appJs.text.includes("loadCreatorHome") && appJs.text.includes("homeActiveVisitHtml") && appJs.text.includes("Opportunities picked for you") && appJs.text.includes("Your local signal") && appJs.text.includes("Cash and comps, kept separate"), "");
  check("client ships the founding tabs (Dashboard, Profile, Status) behind the pre-launch gate", appJs.text.includes("FOUNDING_TABS") && appJs.text.includes("loadFoundingDashboard") && appJs.text.includes("loadFoundingStatus") && appJs.text.includes("See your full status"), "");
  check("client labels the creator tab Dashboard in tabs and bottom nav (no Home dashboard tab)", appJs.text.includes("LIVE_CREATOR_TABS") && appJs.text.includes("go('dashboard','Dashboard')") && !appJs.text.includes("go('dashboard','Home')"), "");
  check("bottom nav ships inline SVG icons, not entity glyphs (no emoji-style sign-out arrow)", appJs.text.includes("bnIcon") && appJs.text.includes("bn-icon") && appJs.text.includes('item("signout", "Sign out"') && appJs.text.includes('item("home", "Dashboard"') && !appJs.text.includes("&#8617;") && !appJs.text.includes("&#8962;"), "");
  const themeCss = await anon("GET", "/theme-v2.css");
  const baseCss = await anon("GET", "/styles.css");
  check("bottom nav bar is solid with a fixed safe-area height (no translucent glass)", !themeCss.text.includes("rgba(255,255,255,.94)") && baseCss.text.includes("height: calc(58px + env(safe-area-inset-bottom))") && baseCss.text.includes(".bn-icon svg") && baseCss.text.includes("white-space: nowrap"), "");
  check("client never promises instant paid money (no instant payout, transfer, or cash-out framing)", !/instant (payout|transfer|cash)/i.test(appJs.text) && !appJs.text.includes("Transfer $") && !/cash out/i.test(appJs.text), "");

  console.log(`\nROAS verification: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log("Failures:", failures); process.exitCode = 1; }
} finally {
  if (server) server.kill("SIGTERM");
  fs.rmSync(tmp, { recursive: true, force: true });
}
