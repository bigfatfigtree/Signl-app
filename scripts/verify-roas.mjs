// SIGNL verify: the SIGNL ROAS Score (Jeff, 2026-10-19).
//
// Jeff's model: every booking carries a per-creator audience
// code (HANDLE-suffix, discountPct default 20). The business
// reports register redemptions against the booking (count +
// basket total, no POS integration). Value = register spend
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
  check("bootstrap publishes the ROAS model rates and label", boot.data.roasModel && boot.data.roasModel.cpm === 22 && boot.data.roasModel.like === 0.1 && boot.data.roasModel.comment === 0.5 && boot.data.roasModel.share === 1 && boot.data.roasModel.defaultDiscountPct === 20 && /SIGNL ROAS Score/.test(boot.data.roasModel.label || ""), JSON.stringify(boot.data.roasModel || null));

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

  // ---------- A: creator codes are stamped at creation ----------
  const bk1 = await compBooking(biz.client, c1, 50, "ROAS tasting one");
  check("a comp booking carries a creator code derived from the creator's handle", typeof bk1.creatorCode === "string" && bk1.creatorCode.startsWith("ROASCOOKS") && /^[A-Z0-9]{1,12}-[A-Z0-9]{4}$/.test(bk1.creatorCode), String(bk1.creatorCode));
  check("the booking defaults the audience-code discount to 20 percent with no tally yet", bk1.discountPct === 20 && bk1.redemptions === null, JSON.stringify({ discountPct: bk1.discountPct, redemptions: bk1.redemptions }));
  check("the comp's cost basis starts at the comp's stated value (the business's own cost convention)", bk1.compCostActual === 50, String(bk1.compCostActual));
  check("a fresh booking's ROAS is all zeros with a defined score, never NaN", bk1.roas && bk1.roas.value === 0 && bk1.roas.mediaValue === 0 && bk1.roas.registerValue === 0 && bk1.roas.score === 0 && bk1.roas.allInScore === 0 && bk1.roas.redemptions.count === 0, JSON.stringify(bk1.roas));
  const bk2 = await compBooking(biz.client, c2, 40, "ROAS tasting two");
  check("creator codes are unique per booking", !!bk2.creatorCode && bk2.creatorCode !== bk1.creatorCode, `${bk1.creatorCode} vs ${bk2.creatorCode}`);

  // Paid bookings carry codes too (and the all-in business cost).
  const rateSet = await c1.client("PATCH", "/api/me/profile", { paidRate: 250 });
  if (rateSet.status !== 200) throw new Error(`paidRate set failed: ${rateSet.status} ${JSON.stringify(rateSet.data)}`);
  const paid = await biz.client("POST", "/api/bookings/paid", { creatorId: c1.user.id });
  check("a paid booking also carries a creator code and the 20 percent default", paid.status === 201 && typeof paid.data.booking.creatorCode === "string" && paid.data.booking.discountPct === 20 && paid.data.booking.compCostActual === 257.5, `${paid.status} ${JSON.stringify(paid.data.booking || paid.data).slice(0, 200)}`);

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

  // ---------- G: the client carries the surfaces ----------
  const appJs = await anon("GET", "/app.js");
  check("client ships the creator audience-code framing", appJs.text.includes("Your audience code at") && appJs.text.includes("every use is tracked"), "");
  check("client ships the ROAS label and the business tally form", appJs.text.includes("SIGNL ROAS Score") && appJs.text.includes("submitCodeRedemptions") && appJs.text.includes("/code-redemptions") && appJs.text.includes("pvReportRedemptions"), "");
  check("client never says revenue was generated", !/revenue (generated|we generated)/i.test(appJs.text), "");

  console.log(`\nROAS verification: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log("Failures:", failures); process.exitCode = 1; }
} finally {
  if (server) server.kill("SIGTERM");
  fs.rmSync(tmp, { recursive: true, force: true });
}
