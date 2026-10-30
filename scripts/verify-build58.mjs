// Build -58: Role Stats Views — businesses, partners and
// creators get the Command Center's view of their own scope
// (Jeff's order 2026-10-30, on the approved Money overview
// sample): one stats view inside each role's existing surface,
// Week / Month / Year / All time toggle, fed by GET /me/stats.
// Proven here:
//
// 1. BUCKETING. Register events and charges planted at exact
//    period boundaries (month start in, 1ms before out; year
//    start in, 1ms before out; trailing-7-day edges an hour
//    inside and an hour outside) land in exactly the periods
//    the calendar says — expectations are computed from the
//    fixture timestamps, never from the server's answer.
//
// 2. RECONCILIATION. The business role figures reconcile with
//    the Admin Command Center for the same scope + period:
//    role month counted + the second business's role month
//    counted == Admin Overview counted for this_month (and
//    all-time); role finished deals sum to the Overview's;
//    the business Month counted firsts/returns equal the
//    Receipt's trackedSpend / cameBack.returnSpend for the
//    same business and month. The partner's accrued / paid /
//    owed equal BOTH the Admin Partners row and the partner
//    summary's earnings (three surfaces, one engine).
//
// 3. GREATER-OF. The partner period rows carry both
//    candidates (percentage side, guarantee side) with the
//    governing side flagged — the guarantee governs every
//    fixture month.
//
// 4. PRIVACY. A business naming another business's id gets a
//    403; its payload carries no partner figures and none of
//    the other business's amounts. A creator naming a partner
//    id gets a 403. A partner's payload names only its own
//    attributed scope. Admin and anonymous callers are refused.
//
// 5. EMPTY STATES. Fresh business / creator / partner scopes
//    answer hasData:false with no invented figures; a partner
//    with sign-ups but no deal reads basis "no_deal" with a
//    real zero accrual.
//
// Run: node scripts/verify-build58.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build58-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify-admin-pass-58";
process.env.APP_URL = "http://localhost";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_verify_58";

const require = createRequire(import.meta.url);
const auth = require("../netlify/functions/lib/auth.js");
const { BUILD_ID } = require("../netlify/functions/lib/build.js");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const eq = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

// ---------- static contract ----------
console.log("verify-build58: Role Stats Views (Business / Partner / Creator)");
check("build stamp is 2026.10.30-59", BUILD_ID === "2026.10.30-59", BUILD_ID);
check("index.html carries the -58 stamp", fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").includes("2026.10.30-59"));
const routerSrc = fs.readFileSync(new URL("../netlify/functions/lib/router.js", import.meta.url), "utf8");
const appSrc = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
check("router carries the /me/stats route and the three role aggregators",
  routerSrc.includes('seg[1] === "stats"') && routerSrc.includes("function ccBizStats") && routerSrc.includes("function ccPartnerStats") && routerSrc.includes("function ccCreatorStats"));
check("ccPeriodOf speaks week and year for the role toggle", routerSrc.includes('raw === "week"') && routerSrc.includes('raw === "year"'));
check("app renders the three cards in the existing surfaces",
  appSrc.includes('id="biz-stats"') && appSrc.includes('id="pt-stats"') && appSrc.includes('id="cr-stats"')
  && appSrc.includes("loadBizStats") && appSrc.includes("loadPartnerStats") && appSrc.includes("loadCreatorStats")
  && appSrc.includes("Your markets") && appSrc.includes("Money, offers & deals"));

// ---------- fixtures ----------
const PW = "verify-user-pass-123";
const { salt, hash } = auth.hashPassword(PW);
const NOW_MS = Date.now();
const NOW = new Date(NOW_MS).toISOString();
const daysAgo = (n) => new Date(NOW_MS - n * 86400000).toISOString();
const monthKey = (offset) => { const d = new Date(Date.UTC(new Date(NOW_MS).getUTCFullYear(), new Date(NOW_MS).getUTCMonth() - offset, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const M0 = monthKey(0), M1 = monthKey(1), M2 = monthKey(2);
const midOf = (mk) => `${mk}-15T12:00:00.000Z`;
const firstOf = (mk) => `${mk}-01T00:00:00.000Z`;
const prevYearDec = `${new Date(NOW_MS).getUTCFullYear() - 1}-12-15T12:00:00.000Z`;
const yearStart = `${new Date(NOW_MS).getUTCFullYear()}-01-01T00:00:00.000Z`;

const userRec = (id, over) => ({
  id, email: `${id}@fixtures.dev`, name: `User ${id}`,
  passwordSalt: salt, passwordHash: hash,
  status: "approved", city: "Virginia Beach", state: "VA", country: "United States",
  createdAt: midOf(M2), updatedAt: midOf(M2), tester: false,
  ...over,
});
const seed = {};
const addUser = (u) => { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; };

addUser(userRec("partner-max", { role: "partner", email: "max@fixtures.dev", name: "Max Fixture Media", partner: { name: "Max Fixture Media", type: "media", contactName: "Max", code: "maxfix", markets: ["Virginia Beach"], sharePct: 25, status: "active", agreementStatus: "signed", demo: false } }));
addUser(userRec("partner-other", { role: "partner", email: "other@fixtures.dev", name: "Other Media", partner: { name: "Other Media", type: "media", contactName: "Otto", code: "otherfix", markets: ["Nashville"], sharePct: 40, status: "active", agreementStatus: "unsigned", demo: false } }));
addUser(userRec("partner-fresh", { role: "partner", email: "freshp@fixtures.dev", name: "Fresh Media", partner: { name: "Fresh Media", type: "media", contactName: "Fran", code: "freshfix", markets: ["Denver"], sharePct: 20, status: "active", agreementStatus: "unsigned", demo: false } }));
addUser(userRec("biz-alpha", { role: "business", email: "alpha@fixtures.dev", market: "Virginia Beach", partnerId: "partner-max", signupSource: "partner-maxfix", business: { businessName: "Alpha Grill", category: "Restaurant", plan: "growth", planName: "Growth", planPriceMonthly: 349, planMinMonths: 3, planSelectedAt: midOf(M1), subscription: { id: "sub_a", customerId: "cus_a", status: "active", plan: "growth", planPriceMonthly: 349, createdAt: midOf(M2) } } }));
addUser(userRec("biz-beta", { role: "business", email: "beta@fixtures.dev", market: "Virginia Beach", business: { businessName: "Beta Tacos", category: "Restaurant", plan: "self-service", planName: "Self-Service", planPriceMonthly: 199, planMinMonths: 3, planSelectedAt: NOW, subscription: { id: "sub_b", customerId: "cus_b", status: "active", plan: "self-service", planPriceMonthly: 199, createdAt: NOW } } }));
addUser(userRec("biz-nash", { role: "business", email: "nash@fixtures.dev", market: "Nashville", city: "Nashville", state: "TN", partnerId: "partner-other", business: { businessName: "Nash Noodles", category: "Restaurant", plan: "self-service", planName: "Self-Service", planPriceMonthly: 199, planSelectedAt: midOf(M1) } }));
addUser(userRec("biz-fresh", { role: "business", email: "freshb@fixtures.dev", market: "Virginia Beach", business: { businessName: "Fresh Bakery", category: "Bakery" } }));
addUser(userRec("creator-one", { role: "creator", email: "cone@fixtures.dev", market: "Virginia Beach", partnerId: "partner-max", signupSource: "partner-maxfix", creator: { handle: "creatorone", followerCount: 2000, categories: ["Food"], localAudiencePct: 70 } }));
addUser(userRec("creator-fresh", { role: "creator", email: "freshc@fixtures.dev", market: "Virginia Beach", creator: { handle: "freshcreator", followerCount: 500, categories: ["Food"], localAudiencePct: 40 } }));

const lane = (rate, over) => ({ rate, businessTotal: Math.round(rate * 103) / 100, creatorNet: Math.round(rate * 97) / 100, platformFee: Math.round(rate * 6) / 100, escrowState: "held", bookedAt: NOW, proofAt: null, releasedAt: null, ...(over || {}) });
const bookingRec = (id, over) => ({ id, businessId: "biz-alpha", creatorId: "creator-one", market: "Virginia Beach", title: `Visit ${id}`, createdAt: NOW, updatedAt: NOW, ...over });
const FIXTURE_BOOKINGS = [
  bookingRec("bk-comp-now-cost", { kind: "comp", status: "completed", compCostEntry: { amount: 45, confirmedZero: false, at: NOW, by: "biz-alpha" } }),
  bookingRec("bk-comp-now-nocost", { kind: "comp", status: "completed" }),
  bookingRec("bk-comp-m1", { kind: "comp", status: "completed", createdAt: midOf(M1), updatedAt: midOf(M1), compCostEntry: { amount: 30, confirmedZero: false, at: midOf(M1), by: "biz-alpha" } }),
  bookingRec("bk-comp-plusone", { kind: "comp", status: "completed", collabRole: "plusone" }),
  bookingRec("bk-paid-rel-now", { kind: "paid", status: "completed", paidLane: lane(200, { escrowState: "released", releasedAt: NOW }) }),
  bookingRec("bk-paid-rel-m1", { kind: "paid", status: "completed", createdAt: midOf(M1), updatedAt: midOf(M1), paidLane: lane(100, { escrowState: "released", releasedAt: midOf(M1), bookedAt: midOf(M1) }) }),
  bookingRec("bk-paid-held-nopost", { kind: "paid", status: "completed", createdAt: daysAgo(5), updatedAt: daysAgo(5), paidLane: lane(150, { bookedAt: daysAgo(5) }) }),
  bookingRec("bk-paid-held-hold", { kind: "paid", status: "completed", createdAt: daysAgo(1), paidLane: lane(80, { bookedAt: daysAgo(1) }) }),
  bookingRec("bk-beta-comp", { kind: "comp", status: "completed", businessId: "biz-beta" }),
];
for (const b of FIXTURE_BOOKINGS) seed[`booking:${b.id}`] = b;
seed["post:post-comp-now"] = { id: "post-comp-now", bookingId: "bk-comp-now-cost", businessId: "biz-alpha", creatorId: "creator-one", submittedAt: NOW, createdAt: NOW };
seed["post:post-comp-nocost"] = { id: "post-comp-nocost", bookingId: "bk-comp-now-nocost", businessId: "biz-alpha", creatorId: "creator-one", submittedAt: NOW, createdAt: NOW };
seed["post:post-comp-m1"] = { id: "post-comp-m1", bookingId: "bk-comp-m1", businessId: "biz-alpha", creatorId: "creator-one", submittedAt: midOf(M1), createdAt: midOf(M1) };
seed["post:post-plusone"] = { id: "post-plusone", bookingId: "bk-comp-plusone", businessId: "biz-alpha", creatorId: "creator-one", submittedAt: NOW, createdAt: NOW };
seed["post:post-held-hold"] = { id: "post-held-hold", bookingId: "bk-paid-held-hold", businessId: "biz-alpha", creatorId: "creator-one", submittedAt: NOW, createdAt: NOW };
seed["post:post-beta"] = { id: "post-beta", bookingId: "bk-beta-comp", businessId: "biz-beta", creatorId: "creator-one", submittedAt: NOW, createdAt: NOW };

seed["license:lic-granted"] = { id: "lic-granted", businessId: "biz-alpha", creatorId: "creator-one", bookingId: "bk-comp-now-cost", postId: "post-comp-now", status: "granted", escrowState: "released", grantedAt: NOW, respondedAt: NOW, createdAt: NOW, updatedAt: NOW, fee: 100, businessTotal: 103, creatorNet: 97, platformFee: 6 };
seed["license:lic-pending"] = { id: "lic-pending", businessId: "biz-alpha", creatorId: "creator-one", bookingId: "bk-comp-now-cost", postId: "post-comp-now", status: "pending", escrowState: "held", createdAt: daysAgo(2), updatedAt: daysAgo(2), fee: 150, businessTotal: 154.5, creatorNet: 145.5, platformFee: 9 };

const chargeRec = (id, over) => ({ id, provider: "stripe", stripeEventIds: [`evt_${id}`], createdAt: NOW, kind: "subscription", businessId: null, creatorId: null, bookingId: null, licenseId: null, stripeCustomerId: null, stripeSubscriptionId: null, stripeInvoiceId: id, stripePaymentIntentId: null, planId: null, gross: 0, creditApplied: 0, net: 0, refundedAmount: 0, status: "succeeded", currency: "usd", chargedAt: NOW, description: "", updatedAt: NOW, ...(over || {}) });
const FIXTURE_CHARGES = [
  chargeRec("ch-sub-m0", { businessId: "biz-alpha", stripeCustomerId: "cus_a", planId: "growth", gross: 349, creditApplied: 0, net: 349, chargedAt: NOW }),
  chargeRec("ch-sub-m1", { businessId: "biz-alpha", stripeCustomerId: "cus_a", planId: "growth", gross: 349, creditApplied: 100, net: 249, chargedAt: midOf(M1), createdAt: midOf(M1) }),
  chargeRec("ch-sub-m2", { businessId: "biz-alpha", stripeCustomerId: "cus_a", planId: "growth", gross: 349, creditApplied: 0, net: 349, chargedAt: midOf(M2), createdAt: midOf(M2) }),
  chargeRec("ch-paid-now", { kind: "paid", businessId: "biz-alpha", creatorId: "creator-one", bookingId: "bk-paid-rel-now", stripeInvoiceId: null, stripePaymentIntentId: "ch-paid-now", gross: 206, net: 206, chargedAt: NOW }),
  chargeRec("ch-paid-m1", { kind: "paid", businessId: "biz-alpha", creatorId: "creator-one", bookingId: "bk-paid-rel-m1", stripeInvoiceId: null, stripePaymentIntentId: "ch-paid-m1", gross: 103, net: 103, refundedAmount: 50, chargedAt: midOf(M1), createdAt: midOf(M1) }),
  chargeRec("ch-lic-now", { kind: "license", businessId: "biz-alpha", creatorId: "creator-one", bookingId: "bk-comp-now-cost", stripeInvoiceId: null, stripePaymentIntentId: "ch-lic-now", gross: 103, net: 103, chargedAt: NOW }),
  chargeRec("ch-beta-sub", { businessId: "biz-beta", stripeCustomerId: "cus_b", planId: "self-service", gross: 199, creditApplied: 100, net: 99, chargedAt: NOW }),
];
for (const c of FIXTURE_CHARGES) seed[`charge:stripe:${c.id}`] = c;

// Register events: the bucketing fixtures. Expectations are
// computed from these timestamps below — the suite never
// hardcodes which period an event belongs to.
const ALPHA_EVENTS = [
  { id: "e1", kind: "first", amount: 120, at: daysAgo(2) },
  { id: "e2", kind: "first", amount: 22, at: firstOf(M0) },
  { id: "e3", kind: "return", amount: 33, at: new Date(Date.parse(firstOf(M0)) - 1).toISOString() },
  { id: "e4", kind: "first", amount: 44, at: prevYearDec },
  { id: "e5", kind: "first", amount: 5, at: new Date(NOW_MS - 7 * 86400000 + 3600000).toISOString() },
  { id: "e6", kind: "return", amount: 7, at: new Date(NOW_MS - 7 * 86400000 - 3600000).toISOString() },
  { id: "e8", kind: "first", amount: 11, at: yearStart },
  { id: "e9", kind: "return", amount: 13, at: new Date(Date.parse(yearStart) - 1).toISOString() },
];
for (const e of ALPHA_EVENTS) seed[`redevent:${e.id}`] = { ...e, bookingId: "bk-comp-now-cost", businessId: "biz-alpha", creatorId: "creator-one" };
seed["redevent:e-void"] = { id: "e-void", bookingId: "bk-comp-now-cost", businessId: "biz-alpha", creatorId: "creator-one", kind: "first", amount: 999, at: NOW, voided: true };
seed["redevent:e-beta"] = { id: "e-beta", bookingId: "bk-beta-comp", businessId: "biz-beta", creatorId: "creator-one", kind: "first", amount: 777, at: NOW };

seed["offer:of-alpha-open"] = { id: "of-alpha-open", businessId: "biz-alpha", status: "open", title: "Alpha open offer", market: "Virginia Beach", createdAt: NOW };
seed["offer:of-alpha-closed"] = { id: "of-alpha-closed", businessId: "biz-alpha", status: "closed", title: "Alpha closed offer", market: "Virginia Beach", createdAt: midOf(M1) };
seed["offer:of-beta-open"] = { id: "of-beta-open", businessId: "biz-beta", status: "open", title: "Beta open offer", market: "Virginia Beach", createdAt: NOW };

seed["config:markets"] = { flags: {} };
seed["config:complianceSweep"] = { lastRunAt: NOW };
seed["config:offerSweep"] = { lastRunAt: NOW };
fs.writeFileSync(DB_PATH, JSON.stringify(seed));

// ---------- harness ----------
const { handler } = require("../netlify/functions/api.js");
function evt(method, p, { cookie, query, body, headers } = {}) {
  return { httpMethod: method, path: p, headers: { ...(cookie ? { cookie } : {}), ...(headers || {}) }, queryStringParameters: query || {}, body: body === undefined ? null : (typeof body === "string" ? body : JSON.stringify(body)), isBase64Encoded: false };
}
const parse = (res) => { try { return JSON.parse(res.body); } catch (e) { return null; } };
const cookieOf = (res) => (((res.headers || {})["Set-Cookie"] || (res.headers || {})["set-cookie"] || "").split(";")[0]);
const login = async (email) => cookieOf(await handler(evt("POST", "/api/auth/login", { body: { email, password: PW } })));
const get = async (cookie, p, query) => parse(await handler(evt("GET", p, { cookie, query })));
const stats = async (cookie, period) => get(cookie, "/api/me/stats", period ? { period } : {});

const adminLogin = await handler(evt("POST", "/api/auth/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } }));
check("admin login succeeds", adminLogin.statusCode === 200, `got ${adminLogin.statusCode}`);
const admin = cookieOf(adminLogin);
const alpha = await login("alpha@fixtures.dev");
const beta = await login("beta@fixtures.dev");
const bizFresh = await login("freshb@fixtures.dev");
const creator = await login("cone@fixtures.dev");
const creatorFresh = await login("freshc@fixtures.dev");
const pmax = await login("max@fixtures.dev");
const pother = await login("other@fixtures.dev");
const pfresh = await login("freshp@fixtures.dev");
check("all fixture logins succeed", !!(alpha && beta && bizFresh && creator && creatorFresh && pmax && pother && pfresh));

// ---------- the partner deal + a real payout ----------
const dealRes = parse(await handler(evt("POST", "/api/admin/partners/partner-max/deals", { cookie: admin, body: {
  label: "VB pilot (fixture)", status: "signed",
  terms: {
    partnerPct: 25, attributionScope: "sourced_only",
    guarantee: { beneficiary: "partner", pilotFloor: 1000, bands: [{ fromMonth: 1, toMonth: null, floorMonthly: 300, pctToBeneficiary: 25 }] },
    markets: [{ market: "Virginia Beach", status: "live", liveAt: firstOf(M2), activationFee: 15000, activationStatus: "paid" }],
  },
} })));
check("partner-max deal created through the Admin editor path", !!(dealRes && dealRes.deal && dealRes.deal.id), dealRes && JSON.stringify(dealRes).slice(0, 200));
const payoutRes = await handler(evt("POST", "/api/admin/command/partners/payouts", { cookie: admin, body: { partnerId: "partner-max", amount: 200, period: M1, method: "ACH", reference: "ach-58" } }));
const payoutBody = parse(payoutRes);
check("a $200 partner payout records (201, paidTotal reads back)", payoutRes.statusCode === 201 && !!payoutBody && eq(payoutBody.paidTotal, 200), `got ${payoutRes.statusCode}`);

// ---------- business bucketing (expectations from timestamps) ----------
const inWeek = (iso) => { const t = Date.parse(iso); return t >= NOW_MS - 7 * 86400000 && t <= NOW_MS + 60000; };
const inMonth = (iso) => String(iso).slice(0, 7) === M0;
const inYear = (iso) => String(iso).slice(0, 4) === String(new Date(NOW_MS).getUTCFullYear());
const expectCounted = (pred) => {
  const rows = ALPHA_EVENTS.filter((e) => pred(e.at));
  return {
    total: rows.reduce((s, e) => s + e.amount, 0),
    firsts: rows.filter((e) => e.kind === "first").reduce((s, e) => s + e.amount, 0),
    returns: rows.filter((e) => e.kind === "return").reduce((s, e) => s + e.amount, 0),
  };
};
const bizBy = {};
for (const p of ["week", "month", "year", "all"]) bizBy[p] = await stats(alpha, p);
check("business stats answer for every period", ["week", "month", "year", "all"].every((p) => bizBy[p] && bizBy[p].role === "business" && bizBy[p].stats));
for (const [p, pred] of [["week", inWeek], ["month", inMonth], ["year", inYear], ["all", () => true]]) {
  const exp = expectCounted(pred);
  const got = bizBy[p] && bizBy[p].stats && bizBy[p].stats.counted;
  check(`business counted buckets correctly for ${p} (total ${exp.total}, firsts ${exp.firsts}, returns ${exp.returns})`,
    !!got && eq(got.total, exp.total) && eq(got.firsts, exp.firsts) && eq(got.returns, exp.returns),
    got && JSON.stringify(got));
}
check("the voided $999 event is in no period", eq(bizBy.all.stats.counted.total, expectCounted(() => true).total));
check("month period echoes the calendar month range", bizBy.month.period.from === `${M0}-01T00:00:00.000Z` && bizBy.month.period.key === "month", bizBy.month.period && JSON.stringify(bizBy.month.period));
check("all-time period starts at the account's own start", bizBy.all.period.from === midOf(M2), bizBy.all.period && bizBy.all.period.from);
const bogus = parse(await handler(evt("GET", "/api/me/stats", { cookie: alpha, query: { period: "decade" } })));
check("an unknown period falls back to all time, labeled", !!bogus && bogus.period.key === "all");

// ---------- business content ----------
const bm = bizBy.month.stats, ba = bizBy.all.stats;
check("business month: deals finished split by kind", bm.deals.compVisits === 2 && bm.deals.paidBookings === 1 && bm.deals.licenses === 1 && bm.deals.total === 4, JSON.stringify(bm.deals));
check("business all-time: deals finished split by kind", ba.deals.compVisits === 3 && ba.deals.paidBookings === 2 && ba.deals.licenses === 1 && ba.deals.total === 6, JSON.stringify(ba.deals));
check("the +1 companion booking counts nowhere", ba.compsCompleted === 3 && ba.deals.compVisits === 3);
check("business month: comps posted + counted subset", bm.compsCompleted === 2 && bm.compsCounted === 1, `${bm.compsCompleted}/${bm.compsCounted}`);
check("business month: comp costs carry coverage, cap never priced", bm.compCosts.total === 45 && bm.compCosts.entered === 1 && bm.compCosts.completed === 2 && bm.compCosts.missing === 1, JSON.stringify(bm.compCosts));
check("business all-time: comp costs", ba.compCosts.total === 75 && ba.compCosts.entered === 2 && ba.compCosts.missing === 1, JSON.stringify(ba.compCosts));
check("business month: recorded paid + license flowed", eq(bm.recorded.rows.paidBookings.flowed, 206) && eq(bm.recorded.rows.paidBookings.creatorsEarned, 194) && eq(bm.recorded.rows.licenses.flowed, 103) && eq(bm.recorded.totals.flowed, 309), JSON.stringify(bm.recorded));
check("business month: plan selected last month stays out of this month's recorded flow but its rate still reads", eq(bm.recorded.rows.subscriptions.flowed, 0) && bm.recorded.rows.subscriptions.monthlyRate === 349);
check("business all-time: recorded subscriptions count the selection once", eq(ba.recorded.rows.subscriptions.flowed, 349) && eq(ba.recorded.totals.flowed, 761), JSON.stringify(ba.recorded.totals));
check("business month: charged at actually-charged (founding credit out)", eq(bm.charged.rows.subscriptions.gross, 349) && eq(bm.charged.rows.subscriptions.net, 349) && eq(bm.charged.rows.paidBookings.net, 206) && eq(bm.charged.rows.licenses.net, 103) && eq(bm.charged.netTotal, 658), JSON.stringify(bm.charged));
check("business all-time: charged nets the M1 credit and the refunded paid charge", eq(ba.charged.rows.subscriptions.net, 947) && eq(ba.charged.rows.subscriptions.creditApplied, 100) && eq(ba.charged.rows.paidBookings.net, 259) && eq(ba.charged.netTotal, 1309), JSON.stringify(ba.charged));
check("business escrow stock: held paid bookings + pending licenses", bm.escrow.paidHeld.count === 2 && eq(bm.escrow.paidHeld.businessTotal, 236.9) && bm.escrow.licensesPending.count === 1 && eq(bm.escrow.licensesPending.businessTotal, 154.5), JSON.stringify(bm.escrow));
check("business offers live counts only its own open offers", bm.offersLive === 1 && ba.offersLive === 1);
check("business payload carries NO partner figures at all", !JSON.stringify(bizBy.all).includes("partnerShare") && !JSON.stringify(bizBy.all).includes("partnerId"));

// ---------- business reconciliation vs Admin + Receipt ----------
const ovMonth = await get(admin, "/api/admin/command/overview", { period: "this_month" });
const ovAll = await get(admin, "/api/admin/command/overview", { period: "all" });
const betaMonth = await stats(beta, "month");
const betaAll = await stats(beta, "all");
check("reconciliation: role counted (alpha + beta) == Admin Overview counted, this month",
  !!ovMonth && eq(bm.counted.total + betaMonth.stats.counted.total, ovMonth.tiles.countedRegister),
  `${bm.counted.total}+${betaMonth.stats.counted.total} vs ${ovMonth && ovMonth.tiles.countedRegister}`);
check("reconciliation: role counted (alpha + beta) == Admin Overview counted, all time",
  !!ovAll && eq(ba.counted.total + betaAll.stats.counted.total, ovAll.tiles.countedRegister),
  `${ba.counted.total}+${betaAll.stats.counted.total} vs ${ovAll && ovAll.tiles.countedRegister}`);
check("reconciliation: role finished deals sum to the Overview's, this month",
  !!ovMonth && bm.deals.total + betaMonth.stats.deals.total === ovMonth.tiles.finishedDeals.total,
  `${bm.deals.total}+${betaMonth.stats.deals.total} vs ${ovMonth && ovMonth.tiles.finishedDeals.total}`);
check("reconciliation: role finished deals sum to the Overview's, all time",
  !!ovAll && ba.deals.total + betaAll.stats.deals.total === ovAll.tiles.finishedDeals.total,
  `${ba.deals.total}+${betaAll.stats.deals.total} vs ${ovAll && ovAll.tiles.finishedDeals.total}`);
const receipt = await get(alpha, "/api/me/receipt");
const expMonth = expectCounted(inMonth);
check("reconciliation: business Month counted firsts == the Receipt's trackedSpend",
  !!receipt && !!receipt.receipt && eq(bm.counted.firsts, receipt.receipt.trackedSpend),
  `stats ${bm.counted.firsts} vs receipt ${receipt && receipt.receipt && receipt.receipt.trackedSpend} (expected ${expMonth.firsts})`);
check("reconciliation: business Month counted returns == the Receipt's come-back spend",
  !!receipt && !!receipt.receipt && eq(bm.counted.returns, receipt.receipt.cameBack.returnSpend),
  `stats ${bm.counted.returns} vs receipt ${receipt && receipt.receipt && receipt.receipt.cameBack.returnSpend}`);

// ---------- partner ----------
const pm = {}, pa2 = {};
for (const p of ["week", "month", "year", "all"]) { const r = await stats(pmax, p); if (p === "month") Object.assign(pm, r); else pa2[p] = r; }
const pmStats = pm.stats, paStats = pa2.all.stats;
check("partner month: engine row is the current month (share math settles monthly)", pmStats.periodAgg.months === 1 && eq(pmStats.periodAgg.gross, 349) && eq(pmStats.periodAgg.partnerShare, 300), JSON.stringify(pmStats.periodAgg));
check("partner month: greater-of prints both candidates, guarantee governs", eq(pmStats.periodAgg.pctCandidate, 87.25) && eq(pmStats.periodAgg.floorCandidate, 300) && pmStats.periodAgg.guaranteeMonths === 1 && pmStats.currentMonth && pmStats.currentMonth.governedBy === "guarantee", JSON.stringify(pmStats.periodAgg));
check("partner week: money rows are the current month's row, not an empty week", pa2.week.stats.periodAgg.months === 1 && eq(pa2.week.stats.periodAgg.partnerShare, 300), JSON.stringify(pa2.week.stats.periodAgg));
check("partner all-time: three engine months accrue at the governing guarantee", paStats.periodAgg.months === 3 && eq(paStats.accrued, 900) && eq(paStats.grossAll, 1047), JSON.stringify({ accrued: paStats.accrued, grossAll: paStats.grossAll }));
check("partner all-time: accrued less the recorded payout is owed", eq(paStats.paid, 200) && eq(paStats.owed, 700), `${paStats.paid}/${paStats.owed}`);
check("partner scope: only its own attributed businesses and creators", paStats.businessesSigned === 1 && paStats.creatorsAttributed === 1 && paStats.markets.length === 1 && paStats.markets[0].market === "Virginia Beach");
check("partner payload names no other partner's scope", !JSON.stringify(pa2.all).includes("biz-nash") && !JSON.stringify(pa2.all).includes("partner-other") && !JSON.stringify(pa2.all).includes("Nash Noodles"));
check("partner deal card carries terms state, activation and the pilot floor", paStats.dealCards.length === 1 && paStats.dealCards[0].termsState === "entered" && paStats.dealCards[0].markets[0].activationFee === 15000 && paStats.dealCards[0].pilotFloor && paStats.dealCards[0].pilotFloor.met === true, JSON.stringify(paStats.dealCards).slice(0, 250));
const adminPartners = await get(admin, "/api/admin/command/partners", { period: "this_month", partner: "partner-max" });
const adminRow = adminPartners && adminPartners.partners && adminPartners.partners[0];
check("reconciliation: partner role accrued/paid/owed == the Admin Partners row",
  !!adminRow && eq(paStats.accrued, adminRow.accrued) && eq(paStats.paid, adminRow.paid) && eq(paStats.owed, adminRow.owed),
  adminRow && JSON.stringify({ role: [paStats.accrued, paStats.paid, paStats.owed], admin: [adminRow.accrued, adminRow.paid, adminRow.owed] }));
check("reconciliation: partner role month share == the Admin row's period share",
  !!adminRow && eq(pmStats.periodAgg.partnerShare, adminRow.period.partnerShare) && eq(pmStats.periodAgg.gross, adminRow.period.gross),
  adminRow && JSON.stringify(adminRow.period));
const summary = await get(pmax, "/api/partner/summary");
check("reconciliation: partner role accrued/paid/owed == the partner summary's earnings (same engine)",
  !!summary && !!summary.earnings && eq(paStats.accrued, summary.earnings.accruedTotal) && eq(paStats.paid, summary.earnings.paidTotal) && eq(paStats.owed, summary.earnings.owedTotal),
  summary && summary.earnings && JSON.stringify(summary.earnings));

// ---------- creator ----------
const cm = (await stats(creator, "month")).stats;
const ca = (await stats(creator, "all")).stats;
check("creator month: released money by state", eq(cm.money.released.total, 291) && eq(cm.money.paidOut, 291) && eq(cm.money.releasedNotPaid, 0), JSON.stringify(cm.money));
check("creator all-time: released money", eq(ca.money.released.total, 388) && eq(ca.money.paidOut, 388), JSON.stringify(ca.money));
check("creator held stock: every item with its named reason",
  eq(cm.money.held.total, 368.6) && cm.money.held.items.length === 3
  && cm.money.held.items.some((r) => r.blocker && r.blocker.includes("Waiting for the post"))
  && cm.money.held.items.some((r) => r.blocker && r.blocker.includes("48-hour hold") && r.releasesAt)
  && cm.money.held.items.some((r) => r.blocker && r.blocker.includes("approve this license")),
  JSON.stringify(cm.money.held).slice(0, 300));
check("creator month: deals finished across both businesses", cm.deals.compVisits === 3 && cm.deals.paidBookings === 1 && cm.deals.licenses === 1 && cm.deals.total === 5, JSON.stringify(cm.deals));
check("creator all-time: deals finished", ca.deals.compVisits === 4 && ca.deals.paidBookings === 2 && ca.deals.licenses === 1 && ca.deals.total === 7, JSON.stringify(ca.deals));
check("creator month: comps done and visits completed", cm.compsCompleted === 3 && cm.visitsCompleted >= 6, `${cm.compsCompleted}/${cm.visitsCompleted}`);
check("creator offers received/accepted are real counts from their bookings", cm.offersReceived >= 5 && cm.offersAccepted >= 4 && cm.offersAccepted <= cm.offersReceived + 2, `${cm.offersReceived}/${cm.offersAccepted}`);
const points = await get(creator, "/api/me/points");
check("creator points in stats == /me/points (same refresh, why lines intact client-side)",
  !!points && ca.points.total === points.total && !!ca.points.level && typeof ca.points.level.name === "string",
  JSON.stringify({ stats: ca.points && ca.points.total, points: points && points.total }));

// ---------- privacy ----------
const crossBiz = await handler(evt("GET", "/api/me/stats", { cookie: alpha, query: { businessId: "biz-beta" } }));
check("privacy: a business naming another business's id gets a 403", crossBiz.statusCode === 403, `got ${crossBiz.statusCode}`);
const ownBiz = await handler(evt("GET", "/api/me/stats", { cookie: alpha, query: { businessId: "biz-alpha", period: "month" } }));
check("privacy: naming your OWN id is not an error", ownBiz.statusCode === 200, `got ${ownBiz.statusCode}`);
const crossPartner = await handler(evt("GET", "/api/me/stats", { cookie: creator, query: { partnerId: "partner-max" } }));
check("privacy: a creator naming a partner id gets a 403", crossPartner.statusCode === 403, `got ${crossPartner.statusCode}`);
const crossCreator = await handler(evt("GET", "/api/me/stats", { cookie: pmax, query: { creatorId: "creator-one" } }));
check("privacy: a partner naming a creator id gets a 403", crossCreator.statusCode === 403, `got ${crossCreator.statusCode}`);
const adminStats = await handler(evt("GET", "/api/me/stats", { cookie: admin }));
check("privacy: Admin gets no role stats (the Command Center is Admin's view)", adminStats.statusCode === 403, `got ${adminStats.statusCode}`);
const anonStats = await handler(evt("GET", "/api/me/stats", {}));
check("privacy: anonymous gets refused", anonStats.statusCode === 401 || anonStats.statusCode === 403, `got ${anonStats.statusCode}`);
check("privacy: beta's payload holds none of alpha's amounts or bookings", !JSON.stringify(betaAll).includes("bk-comp-now-cost") && eq(betaAll.stats.counted.total, 777) && eq(betaAll.stats.charged.netTotal, 99));
check("privacy: alpha's payload holds none of beta's counted money", !JSON.stringify(bizBy.all).includes("777"));

// ---------- empty states ----------
const freshBizStats = (await stats(bizFresh, "all")).stats;
check("empty: a fresh business answers hasData:false, no invented figures", freshBizStats.hasData === false && eq(freshBizStats.counted.total, 0) && eq(freshBizStats.charged.netTotal, 0) && freshBizStats.deals.total === 0);
const freshCreatorStats = (await stats(creatorFresh, "all")).stats;
check("empty: a fresh creator answers hasData:false with points still reading", freshCreatorStats.hasData === false && freshCreatorStats.money.held.items.length === 0 && !!freshCreatorStats.points.level);
const freshPartnerStats = (await stats(pfresh, "all")).stats;
check("empty: a fresh partner answers hasData:false, no deal, zero accrual", freshPartnerStats.hasData === false && freshPartnerStats.basis === "no_deal" && eq(freshPartnerStats.accrued, 0));
const otherStats = (await stats(pother, "all")).stats;
check("empty-ish: a partner with sign-ups but no deal accrues nothing and says so", otherStats.hasData === true && otherStats.businessesSigned === 1 && otherStats.basis === "no_deal" && eq(otherStats.accrued, 0) && otherStats.termsState === "not_entered", JSON.stringify({ b: otherStats.businessesSigned, basis: otherStats.basis, accrued: otherStats.accrued }));

console.log(`\nverify-build58: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
