// Build -55: Admin Command Center — Money + Businesses, and the
// Stripe charge capture (spec
// signl-admin-command-center-spec-2026-10-30.md §3.1/§3.3/§4).
// Proven here:
//
// 1. CHARGE CAPTURE. Signed webhook events write the charge
//    ledger: an invoice payment records gross / founding credit /
//    net under the invoice id; a checkout completion for the same
//    invoice converges on the SAME record (never a second
//    charge); replaying the same event id changes nothing; a
//    paid-booking PaymentIntent records under its own id with the
//    booking's metadata; a refund marks the parent and lands as
//    its own negative row. A charge whose business cannot be
//    resolved is still recorded (businessId null) and surfaces
//    in reconciliation — never dropped, never guessed.
//
// 2. CLASS SEPARATION (§4.1). The Money payload carries exactly
//    the four classes, each with its own totals, computed from
//    disjoint sources: altering the Halo inputs (a reported post)
//    moves only the Modeled block; the Recorded / Charged /
//    Counted totals are pinned to their fixtures. There is no
//    cross-class total anywhere in the payload.
//
// 3. AGREEMENT MATH (§3.3/§4.7). The Businesses ledger computes
//    plan, founding credit state (from captured discounts),
//    3-month minimum end, billing honesty state (charged vs
//    recorded-only vs no plan) and the rollover balance through
//    planAllowanceFor — including the one-month carry and its
//    expiry — from the records, on fixtures.
//
// 4. GUARDRAIL (§6.8). Money and charge data are Admin-only:
//    creator / business / anonymous callers get 403/401, and no
//    non-admin payload carries charge-ledger fields.
//
// Run: node scripts/verify-build55.mjs
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build55-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify-admin-pass-123";
process.env.APP_URL = "http://localhost";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_55";

const require = createRequire(import.meta.url);
const auth = require("../netlify/functions/lib/auth.js");
const { BUILD_ID } = require("../netlify/functions/lib/build.js");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// ---------- fixtures ----------
const PW = "verify-user-pass-123";
const { salt, hash } = auth.hashPassword(PW);
const NOW_MS = Date.now();
const NOW = new Date(NOW_MS).toISOString();
const daysAgo = (n) => new Date(NOW_MS - n * 86400000).toISOString();
const prevMonthMid = (() => { const d = new Date(NOW_MS); return new Date(d.getFullYear(), d.getMonth() - 1, 15).toISOString(); })();
const GROWTH_PRICE = "price_1USRLcJ5DCULBlmAajXPmJjr";
const SELF_PRICE = "price_1USRLTJ5DCULBlmAES4a3fNV";
const SEL_GROWTH = daysAgo(40);
const SEL_RECORDED = daysAgo(10);

const userRec = (id, over) => ({
  id, email: `${id}@fixtures.dev`, name: `User ${id}`,
  passwordSalt: salt, passwordHash: hash,
  status: "approved", city: "Nashville", state: "TN", country: "United States",
  createdAt: NOW, updatedAt: NOW, tester: false,
  ...over,
});
const FIXTURE_USERS = [
  userRec("partner-max", { role: "partner", email: "max@fixtures.dev", name: "Max Media", partner: { name: "Max Media", type: "media", contactName: "Sean", code: "maxmedia", markets: ["Nashville"], sharePct: 25, status: "active", agreementStatus: "unsigned", demo: false } }),
  userRec("c-1", { role: "creator", market: "Nashville", creator: { handle: "c1", followerCount: 1500, categories: ["Food"], localAudiencePct: 61 } }),
  userRec("b-growth", { role: "business", market: "Nashville", partnerId: "partner-max", business: { businessName: "Growth Grill", category: "Restaurant", plan: "growth", planName: "Growth $349/mo", planPriceMonthly: 349, planMinMonths: 3, planSelectedAt: SEL_GROWTH, accessState: "active", subscription: { id: "sub_g1", customerId: "cus_g1", status: "active", plan: "growth", planPriceMonthly: 349 } } }),
  userRec("b-recorded", { role: "business", market: "Nashville", business: { businessName: "Recorded Tacos", category: "Restaurant", plan: "self-service", planName: "Self-Service $199/mo", planPriceMonthly: 199, planMinMonths: 3, planSelectedAt: SEL_RECORDED } }),
  userRec("b-noplan", { role: "business", market: "Nashville", business: { businessName: "No Plan Noodles", category: "Restaurant" } }),
];
const bookingRec = (id, over) => ({ id, businessId: "b-growth", creatorId: "c-1", market: "Nashville", title: `Visit ${id}`, createdAt: NOW, updatedAt: NOW, ...over });
const FIXTURE_BOOKINGS = [
  bookingRec("bk-comp-done", { kind: "comp", status: "completed" }),
  bookingRec("bk-comp-prev", { kind: "comp", status: "booked", createdAt: prevMonthMid, updatedAt: prevMonthMid }),
  bookingRec("bk-comp-cur", { kind: "comp", status: "booked" }),
  bookingRec("bk-paid-rel", { kind: "paid", status: "completed", paidLane: { rate: 200, businessTotal: 206, creatorNet: 194, platformFee: 12, escrowState: "released", releasedAt: NOW } }),
  bookingRec("bk-paid-held", { kind: "paid", status: "completed", paidLane: { rate: 100, businessTotal: 103, creatorNet: 97, platformFee: 6, escrowState: "held" } }),
];
const seed = {};
for (const u of FIXTURE_USERS) { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; }
for (const b of FIXTURE_BOOKINGS) seed[`booking:${b.id}`] = b;
seed["post:post-1"] = { id: "post-1", bookingId: "bk-comp-done", businessId: "b-growth", creatorId: "c-1", submittedAt: daysAgo(40), createdAt: daysAgo(40), views: 10000, likes: 100, comments: 10, shares: 5, reportedAt: NOW };
seed["license:lic-1"] = { id: "lic-1", businessId: "b-growth", creatorId: "c-1", bookingId: "bk-comp-done", postId: "post-1", status: "granted", grantedAt: NOW, respondedAt: NOW, createdAt: NOW, fee: 150, businessTotal: 154.5, creatorNet: 145.5, platformFee: 9 };
seed["redevent:re-1"] = { id: "re-1", bookingId: "bk-comp-done", businessId: "b-growth", creatorId: "c-1", kind: "first", amount: 120.5, at: NOW };
seed["redevent:re-2"] = { id: "re-2", bookingId: "bk-comp-done", businessId: "b-growth", creatorId: "c-1", kind: "return", amount: 40, at: NOW };
fs.writeFileSync(DB_PATH, JSON.stringify(seed));

const { handler } = require("../netlify/functions/api.js");
function evt(method, p, { cookie, query, body, headers } = {}) {
  return { httpMethod: method, path: p, headers: { ...(cookie ? { cookie } : {}), ...(headers || {}) }, queryStringParameters: query || {}, body: body === undefined ? null : (typeof body === "string" ? body : JSON.stringify(body)), isBase64Encoded: false };
}
const parse = (res) => { try { return JSON.parse(res.body); } catch (e) { return null; } };
const cookieOf = (res) => (((res.headers || {})["Set-Cookie"] || (res.headers || {})["set-cookie"] || "").split(";")[0]);
const dbRead = () => JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
const sign = (raw) => {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
};
const webhook = async (obj) => {
  const raw = JSON.stringify(obj);
  return handler(evt("POST", "/api/stripe/webhook", { body: raw, headers: { "stripe-signature": sign(raw) } }));
};

console.log("verify-build55: Command Center Money + Businesses + charge capture");
check("build stamp is 2026.10.30-58", BUILD_ID === "2026.10.30-58", BUILD_ID);
check("index.html carries the -55 stamp", fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").includes("2026.10.30-58"));

const login = await handler(evt("POST", "/api/auth/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } }));
check("admin login succeeds", login.statusCode === 200, `got ${login.statusCode}`);
const adminCookie = cookieOf(login);

// ---------- money before any charge: recorded only, never dressed as charged ----------
const money0 = parse(await handler(evt("GET", "/api/admin/command/money", { cookie: adminCookie })));
check("money answers 200 for admin before any charge exists", !!money0, "no payload");
check("before capture: charged is a true zero (no charges exist), recorded counts the selections and splits",
  !!money0 && money0.charged.netTotal === 0 && money0.charged.rows.subscriptions.count === 0
  && money0.recorded.rows.subscriptions.count === 2 && money0.recorded.rows.subscriptions.flowed === 548,
  money0 && JSON.stringify({ c: money0.charged.netTotal, s: money0.recorded.rows.subscriptions }));
check("counted reads the register fixtures: $160.50 total ($120.50 first + $40 return)",
  !!money0 && money0.counted.total === 160.5 && money0.counted.firsts === 120.5 && money0.counted.returns === 40 && money0.counted.visitsCounted === 1,
  money0 && JSON.stringify(money0.counted));
check("reconciliation before capture: 2 recorded plans, none charged",
  !!money0 && money0.reconciliation.recordedUnchargedCount === 2 && money0.reconciliation.chargedUnmatchedCount === 0,
  money0 && JSON.stringify(money0.reconciliation));

// ---------- charge capture: invoice, convergence, idempotency ----------
const invoiceEvt = { id: "evt_inv_1", type: "invoice.payment_succeeded", data: { object: { id: "in_1", customer: "cus_g1", subscription: "sub_g1", amount_paid: 24900, currency: "usd", payment_intent: "pi_sub_1", period_start: 1761000000, period_end: 1763600000, created: 1761000000, status_transitions: { paid_at: 1761000000 }, lines: { data: [{ price: { id: GROWTH_PRICE } }] }, total_discount_amounts: [{ amount: 10000 }], metadata: {} } } };
const wh1 = await webhook(invoiceEvt);
check("signed invoice webhook is accepted", wh1.statusCode === 200, `got ${wh1.statusCode}`);
let db = dbRead();
const ch1 = db["charge:stripe:in_1"];
check("the invoice charge is captured under the invoice id: gross 349 = net 249 + $100 founding credit, plan growth, business resolved from the subscription",
  !!ch1 && ch1.kind === "subscription" && ch1.gross === 349 && ch1.net === 249 && ch1.creditApplied === 100 && ch1.planId === "growth" && ch1.businessId === "b-growth" && ch1.status === "succeeded",
  ch1 && JSON.stringify(ch1));
check("the capturing event id is on the record's trail", !!ch1 && ch1.stripeEventIds.includes("evt_inv_1"), ch1 && JSON.stringify(ch1.stripeEventIds));

const sessionEvt = { id: "evt_cs_1", type: "checkout.session.completed", data: { object: { id: "cs_1", mode: "subscription", payment_status: "paid", invoice: "in_1", subscription: "sub_g1", customer: "cus_g1", amount_total: 24900, amount_subtotal: 34900, currency: "usd", created: 1761000000, client_reference_id: "b-growth", metadata: { priceId: GROWTH_PRICE, businessId: "b-growth" } } } };
await webhook(sessionEvt);
db = dbRead();
const chargeKeys1 = Object.keys(db).filter((k) => k.startsWith("charge:"));
check("the checkout completion converges on the same invoice record (still exactly one subscription charge)",
  chargeKeys1.length === 1 && !!db["charge:stripe:in_1"] && db["charge:stripe:in_1"].stripeEventIds.includes("evt_cs_1") && db["charge:stripe:in_1"].net === 249,
  chargeKeys1.join(","));
await webhook(invoiceEvt);
db = dbRead();
check("replaying the same webhook event is idempotent: one record, one event-id entry, same amounts",
  Object.keys(db).filter((k) => k.startsWith("charge:")).length === 1
  && db["charge:stripe:in_1"].stripeEventIds.filter((x) => x === "evt_inv_1").length === 1
  && db["charge:stripe:in_1"].net === 249 && db["charge:stripe:in_1"].creditApplied === 100,
  JSON.stringify(db["charge:stripe:in_1"] && db["charge:stripe:in_1"].stripeEventIds));

// ---------- charge capture: paid booking + refund ----------
const piEvt = { id: "evt_pi_1", type: "payment_intent.succeeded", data: { object: { id: "pi_paid_1", amount: 20600, currency: "usd", customer: "cus_g1", created: 1761000000, metadata: { bookingId: "bk-paid-rel", businessId: "b-growth", creatorId: "c-1" } } } };
await webhook(piEvt);
db = dbRead();
const chPi = db["charge:stripe:pi_paid_1"];
check("the paid-booking intent is captured under its own id, kind paid, net $206, booking metadata carried",
  !!chPi && chPi.kind === "paid" && chPi.net === 206 && chPi.bookingId === "bk-paid-rel" && chPi.creatorId === "c-1" && chPi.status === "succeeded",
  chPi && JSON.stringify(chPi));
const refundEvt = { id: "evt_rf_1", type: "charge.refunded", data: { object: { id: "ch_1", amount: 20600, amount_refunded: 20600, refunded: true, payment_intent: "pi_paid_1", invoice: null, currency: "usd", refunds: { data: [{ id: "re_rf_1", amount: 20600, created: 1761000100 }] } } } };
await webhook(refundEvt);
db = dbRead();
check("the refund marks the parent charge refunded with the refunded total",
  !!db["charge:stripe:pi_paid_1"] && db["charge:stripe:pi_paid_1"].status === "refunded" && db["charge:stripe:pi_paid_1"].refundedAmount === 206,
  db["charge:stripe:pi_paid_1"] && JSON.stringify(db["charge:stripe:pi_paid_1"]));
check("the refund itself lands as its own negative row, business inherited from the parent",
  !!db["charge:stripe:re_rf_1"] && db["charge:stripe:re_rf_1"].kind === "refund" && db["charge:stripe:re_rf_1"].net === -206 && db["charge:stripe:re_rf_1"].businessId === "b-growth",
  db["charge:stripe:re_rf_1"] && JSON.stringify(db["charge:stripe:re_rf_1"]));
await webhook(piEvt);
db = dbRead();
check("a replayed success cannot un-refund the charge (status precedence holds)",
  db["charge:stripe:pi_paid_1"].status === "refunded" && db["charge:stripe:pi_paid_1"].stripeEventIds.filter((x) => x === "evt_pi_1").length === 1);

// ---------- the money view after capture ----------
const money = parse(await handler(evt("GET", "/api/admin/command/money", { cookie: adminCookie })));
check("money payload carries exactly the four classes plus filters and reconciliation — no cross-class total exists",
  !!money && Object.keys(money).sort().join(",") === "charged,counted,filters,modeled,reconciliation,recorded",
  money && Object.keys(money).join(","));
check("recorded paid bookings: flowed 206, SIGNL kept 12, creators 194, released only (the held one is escrow, not flowed)",
  !!money && money.recorded.rows.paidBookings.flowed === 206 && money.recorded.rows.paidBookings.signlKept === 12 && money.recorded.rows.paidBookings.creatorsEarned === 194 && money.recorded.rows.paidBookings.count === 1,
  money && JSON.stringify(money.recorded.rows.paidBookings));
check("recorded licenses: flowed 154.50, kept 9, creators 145.50",
  !!money && money.recorded.rows.licenses.flowed === 154.5 && money.recorded.rows.licenses.signlKept === 9 && money.recorded.rows.licenses.creatorsEarned === 145.5,
  money && JSON.stringify(money.recorded.rows.licenses));
// Doctrine update (Build -56): the accruals this check waited
// for HAVE landed with the deal records — the subscriptions
// partner column now answers the greater-of engine's computed
// figure. This fixture carries a partner but NO deal record, so
// the computed figure is an honest 0 with partnerDealCount 0
// (the pre--56 contract answered null = not yet computed).
check("recorded totals: flowed 908.50 (548 plans + 206 paid + 154.50 licenses), splits hold, partners computed by the -56 engine on subscriptions (0 here: no deal on file)",
  !!money && money.recorded.totals.flowed === 908.5 && money.recorded.splitsHold === true && money.recorded.rows.subscriptions.partnersEarned === 0 && money.recorded.rows.subscriptions.partnerDealCount === 0 && money.recorded.rows.paidBookings.partnersEarned === 0,
  money && JSON.stringify(money.recorded.totals));
check("escrow sub-block: the held booking's $103 is recorded-not-flowed, counted apart",
  !!money && money.recorded.escrow.paidHeld.count === 1 && money.recorded.escrow.paidHeld.businessTotal === 103,
  money && JSON.stringify(money.recorded.escrow));
check("charged subscriptions: gross 349, credit 100, net 249, one charge",
  !!money && money.charged.rows.subscriptions.gross === 349 && money.charged.rows.subscriptions.creditApplied === 100 && money.charged.rows.subscriptions.net === 249 && money.charged.rows.subscriptions.count === 1,
  money && JSON.stringify(money.charged.rows.subscriptions));
check("charged paid bookings net to 0 after the full refund; refunds print as their own negative row; net charged is 249",
  !!money && money.charged.rows.paidBookings.net === 0 && money.charged.rows.paidBookings.count === 1 && money.charged.rows.refunds.net === -206 && money.charged.netTotal === 249,
  money && JSON.stringify({ p: money.charged.rows.paidBookings, r: money.charged.rows.refunds, n: money.charged.netTotal }));
check("counted is untouched by the charges: still $160.50 from register events only",
  !!money && money.counted.total === 160.5, money && JSON.stringify(money.counted));
check("modeled is quarantined and real: 1 post measured, visits modeled beyond the counted first, priced off the register average check, confidence early",
  !!money && money.modeled.postsMeasured === 1 && money.modeled.estVisits > 0 && money.modeled.countedFirsts === 1 && money.modeled.estValue > 0 && money.modeled.valueBasis === "register" && money.modeled.confidence === "early",
  money && JSON.stringify(money.modeled));
check("modeled never enters a total: recorded 908.50 + charged 249 + counted 160.50 stand exactly as their fixtures, with the modeled post in place",
  !!money && money.recorded.totals.flowed === 908.5 && money.charged.netTotal === 249 && money.counted.total === 160.5);
check("reconciliation after capture: b-recorded still recorded-not-charged (1), no unmatched charges, no missing credit",
  !!money && money.reconciliation.recordedUnchargedCount === 1 && money.reconciliation.chargedUnmatchedCount === 0 && money.reconciliation.creditNotApplied.length === 0,
  money && JSON.stringify(money.reconciliation));

// ---------- an unresolvable charge is kept, and reconciled ----------
const ghostEvt = { id: "evt_inv_ghost", type: "invoice.payment_succeeded", data: { object: { id: "in_ghost", customer: "cus_ghost", subscription: "sub_ghost", amount_paid: 9900, currency: "usd", created: 1761000000, lines: { data: [{ price: { id: SELF_PRICE } }] }, total_discount_amounts: [], metadata: {} } } };
await webhook(ghostEvt);
db = dbRead();
check("a charge whose business cannot be resolved is still recorded, with no business assigned — never dropped, never guessed",
  !!db["charge:stripe:in_ghost"] && !db["charge:stripe:in_ghost"].businessId && db["charge:stripe:in_ghost"].net === 99 && db["charge:stripe:in_ghost"].planId === "self-service",
  db["charge:stripe:in_ghost"] && JSON.stringify(db["charge:stripe:in_ghost"]));
const money2 = parse(await handler(evt("GET", "/api/admin/command/money", { cookie: adminCookie })));
check("reconciliation surfaces the unmatched charge; charged net rises by exactly its $99",
  !!money2 && money2.reconciliation.chargedUnmatchedCount === 1 && money2.reconciliation.chargedUnmatched[0].id === "in_ghost" && money2.charged.netTotal === 348,
  money2 && JSON.stringify({ u: money2.reconciliation.chargedUnmatchedCount, n: money2.charged.netTotal }));

// ---------- businesses: the agreement ledger ----------
const bizRes = await handler(evt("GET", "/api/admin/command/businesses", { cookie: adminCookie }));
const biz = parse(bizRes);
check("GET /admin/command/businesses answers 200 for admin", bizRes.statusCode === 200, `got ${bizRes.statusCode}`);
const rows = (biz && biz.businesses) || [];
const g = rows.find((r) => r.id === "b-growth");
const r2 = rows.find((r) => r.id === "b-recorded");
const n2 = rows.find((r) => r.id === "b-noplan");
check("ledger totals: 3 businesses, 2 with plans, 1 charged, 1 recorded only",
  !!biz && biz.totals.count === 3 && biz.totals.withPlan === 2 && biz.totals.charged === 1 && biz.totals.recordedOnly === 1, biz && JSON.stringify(biz.totals));
check("Growth Grill: plan Growth at $349 with the founding rate lock, partner Max Media named",
  !!g && g.plan.name === "Growth" && g.plan.monthly === 349 && g.plan.foundingRate === true && g.partner && g.partner.name === "Max Media",
  g && JSON.stringify({ p: g.plan, pt: g.partner }));
check("Growth Grill credit: the captured $100 discount reads used in full, $0 left",
  !!g && g.credit.total === 100 && g.credit.used === 100 && g.credit.remaining === 0 && g.credit.applied === true, g && JSON.stringify(g.credit));
const expectEnd = (() => { const d = new Date(SEL_GROWTH); d.setMonth(d.getMonth() + 3); return d.toISOString(); })();
check("Growth Grill minimum: 3 months from selection, ends on the computed date",
  !!g && g.minimum.months === 3 && g.minimum.end === expectEnd && g.minimum.monthsLeft >= 1, g && JSON.stringify(g.minimum));
check("Growth Grill billing state is charged (a real charge backs the plan), one subscription charge on the ledger",
  !!g && g.billing.state === "charged" && g.billing.chargesCount === 1 && g.billing.subscriptionStatus === "active", g && JSON.stringify(g.billing));
check("Growth Grill rollover: base 10, 9 carried from last month's single comp, 2 used this month, 17 available, carry lapses on the first of next month",
  !!g && g.rollover.base === 10 && g.rollover.carriedIn === 9 && g.rollover.used === 2 && g.rollover.available === 17 && typeof g.rollover.carriedExpiresAt === "string" && g.rollover.carriedExpiresAt.slice(8, 10) === "01",
  g && JSON.stringify(g.rollover));
check("Growth Grill lifetime: 1 comp completed, 1 paid released, $160.50 counted, $21 to SIGNL (12 booking + 9 license)",
  !!g && g.lifetime.compsCompleted === 1 && g.lifetime.paidReleased === 1 && g.lifetime.counted === 160.5 && g.lifetime.signlRevenue === 21,
  g && JSON.stringify(g.lifetime));
check("Recorded Tacos: recorded-only billing state, credit untouched at $100 left, minimum on record",
  !!r2 && r2.billing.state === "recorded" && r2.credit.used === 0 && r2.credit.remaining === 100 && r2.credit.applied === false && r2.minimum.months === 3 && r2.partner === null,
  r2 && JSON.stringify({ b: r2.billing, c: r2.credit }));
check("No Plan Noodles: no agreement, billing state no-plan, no credit or minimum invented",
  !!n2 && n2.plan === null && n2.billing.state === "no-plan" && n2.credit === null && n2.minimum === null, n2 && JSON.stringify(n2.billing));
check("the recorded-only business sorts ahead of the charged one (needs a look first)",
  rows.findIndex((x) => x.id === "b-recorded") < rows.findIndex((x) => x.id === "b-growth"), rows.map((x) => x.id).join(","));

// ---------- overview tile reads the same aggregate ----------
const ov = parse(await handler(evt("GET", "/api/admin/command/overview", { cookie: adminCookie })));
// Doctrine update (Build -57): the money-owed tile reads the
// owed ledger now. On these fixtures the held paid booking's
// $97 creatorNet is what SIGNL owes out (no partner deals), and
// Recorded Tacos' $199/mo is what businesses owe on paper.
check("overview dollars-flowing tile: Recorded 908.50 with Charged 348 as its own figure (never summed); money owed reads the -57 ledger",
  !!ov && ov.tiles.dollarsFlowing && ov.tiles.dollarsFlowing.recorded === 908.5 && ov.tiles.dollarsFlowing.charged === 348
  && !!ov.tiles.moneyOwed && ov.tiles.moneyOwed.owedOut === 97 && ov.tiles.moneyOwed.toCreators === 97 && ov.tiles.moneyOwed.recordedMonthly === 199,
  ov && JSON.stringify(ov.tiles.dollarsFlowing));

// ---------- guardrail ----------
const creatorLogin = await handler(evt("POST", "/api/auth/login", { body: { email: "c-1@fixtures.dev", password: PW } }));
const creatorCookie = cookieOf(creatorLogin);
const bizLogin = await handler(evt("POST", "/api/auth/login", { body: { email: "b-growth@fixtures.dev", password: PW } }));
const bizCookie = cookieOf(bizLogin);
for (const [label, cookie] of [["creator", creatorCookie], ["business", bizCookie]]) {
  for (const p of ["/api/admin/command/money", "/api/admin/command/businesses"]) {
    const r = await handler(evt("GET", p, { cookie }));
    check(`${label} gets 403 on GET ${p}`, r.statusCode === 403, `got ${r.statusCode}`);
  }
}
const anon = await handler(evt("GET", "/api/admin/command/money"));
check("anonymous GET command/money is refused (401/403)", anon.statusCode === 401 || anon.statusCode === 403, `got ${anon.statusCode}`);
const boot = await handler(evt("GET", "/api/bootstrap"));
check("public bootstrap carries no charge-ledger data", boot.statusCode === 200 && !String(boot.body).includes("stripeEventIds") && !String(boot.body).includes("charge:stripe") && !String(boot.body).includes("creditApplied"));
const meBiz = await handler(evt("GET", "/api/auth/me", { cookie: bizCookie }));
check("the business's own /me carries no ledger internals", meBiz.statusCode === 200 && !String(meBiz.body).includes("stripeEventIds") && !String(meBiz.body).includes("creditApplied"), `got ${meBiz.statusCode}`);

// ---------- client source ----------
const appSrc = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const routerSrc = fs.readFileSync(new URL("../netlify/functions/lib/router.js", import.meta.url), "utf8");
check("client: Money and Businesses subtabs fetch their aggregates and render class panels + the agreement table",
  appSrc.includes("ccMoneyHtml") && appSrc.includes("ccBusinessesHtml") && appSrc.includes("/admin/command/money") && appSrc.includes("/admin/command/businesses")
  && appSrc.includes("cc-modeled-panel") && appSrc.includes("Founding rate, locked") && appSrc.includes("Recorded only"));
check("client: the overview tile prints Recorded and Charged side by side, never summed",
  appSrc.includes("dollarsFlowing") && appSrc.includes("charged on cards so far") && appSrc.includes("never added together"));
check("server: capture runs inside the webhook before the snapshot branches, keyed on Stripe object ids, idempotent on event ids",
  routerSrc.includes("captureStripeCharge(evt, obj)") && routerSrc.includes("charge:stripe:") && routerSrc.includes("stripeEventIds")
  && routerSrc.indexOf("captureStripeCharge(evt, obj)") < routerSrc.indexOf('evt.type === "checkout.session.completed" && obj.mode === "setup"'));
check("server: the money and businesses routes sit inside the admin gate",
  routerSrc.indexOf('seg[2] === "money"') > routerSrc.indexOf('if (seg[0] === "admin")') && routerSrc.indexOf('seg[2] === "businesses"') > routerSrc.indexOf('if (seg[0] === "admin")'));

console.log(`\nverify-build55: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
