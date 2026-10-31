// Build -57: Admin Command Center — Owed, Reconciliation &
// alerts, Close & Export (spec
// signl-admin-command-center-spec-2026-10-30.md §3.7/§3.8/§3.9,
// §6.3/§6.4). Proven here:
//
// 1. OWED MATH. Creator holds carry their named blocker from
//    the record's own state (post not live, no card on file,
//    charge failed, payout setup unfinished, license awaiting a
//    decision) and their age; releasable-now splits from
//    blocked; partner owed is the -56 engine's accrued less the
//    recorded payouts; businesses owe on paper (past due,
//    recorded-never-charged); the liabilities are service, not
//    cash (rollover visits at plan value, founding credits,
//    menu value promised at cap).
//
// 2. RECONCILIATION. A planted split mismatch, an unmatched
//    charge, an orphan register count, an unlisted signup (with
//    its resolution), a paused Square connection, register
//    voids, a flagged count, a missing comp cost entry, a
//    partner-stamped business outside the deal's markets, a
//    deal calling a founding market live, and a subscription
//    snapshot disagreeing with its latest charge each appear as
//    a sentence + count + named records.
//
// 3. CLOSE. A month soft-closes, then hard-closes; its frozen
//    headline never moves again — a Stripe refund and a Square
//    register correction that land afterwards change the LIVE
//    numbers and surface as adjustments in the current month,
//    traced to their records. Closed months refuse re-close,
//    and hard close seals the month's accrual records against
//    the -56 snapshot action.
//
// 4. EXPORTS. Each ledger CSV carries its header and its rows
//    under the same filters; the accountant pack is one zip
//    holding every CSV plus the FROZEN close snapshot.
//
// 5. GUARDRAIL. All of it is Admin-only.
//
// Run: node scripts/verify-build57.mjs
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build57-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify-admin-pass";
process.env.APP_URL = "http://localhost";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_57";

const require = createRequire(import.meta.url);
const auth = require("../netlify/functions/lib/auth.js");
const store = require("../netlify/functions/lib/store.js");
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
const monthKey = (offset) => { const d = new Date(Date.UTC(new Date(NOW_MS).getUTCFullYear(), new Date(NOW_MS).getUTCMonth() - offset, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const M0 = monthKey(0), M1 = monthKey(1), M2 = monthKey(2);
const midOf = (mk) => `${mk}-15T12:00:00.000Z`;
const firstOf = (mk) => `${mk}-01T00:00:00.000Z`;

const userRec = (id, over) => ({
  id, email: `${id}@fixtures.dev`, name: `User ${id}`,
  passwordSalt: salt, passwordHash: hash,
  status: "approved", city: "Nashville", state: "TN", country: "United States",
  createdAt: midOf(M2), updatedAt: midOf(M2), tester: false,
  ...over,
});
const seed = {};
const addUser = (u) => { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; };

addUser(userRec("partner-nash", { role: "partner", email: "nash@fixtures.dev", name: "Nashville Media", partner: { name: "Nashville Media", type: "media", contactName: "Ned", code: "nashmedia", markets: ["Nashville"], sharePct: 60, status: "active", agreementStatus: "unsigned", demo: false } }));
addUser(userRec("partner-solo", { role: "partner", email: "solo@fixtures.dev", name: "Solo Media", partner: { name: "Solo Media", type: "media", contactName: "Sam", code: "solomedia", markets: ["Nashville"], sharePct: 40, status: "active", agreementStatus: "unsigned", demo: false } }));
addUser(userRec("c-held", { role: "creator", market: "Nashville", creator: { handle: "heldcreator", followerCount: 1500, categories: ["Food"], localAudiencePct: 61 } }));
addUser(userRec("c-two", { role: "creator", market: "Nashville", creator: { handle: "secondcreator", followerCount: 900, categories: ["Food"], localAudiencePct: 55 } }));
addUser(userRec("unl-clark", { role: "creator", market: "Not listed yet", status: "pending", city: "Clarksville", creator: { handle: "clark", followerCount: 800, categories: ["Food"] } }));
addUser(userRec("b-charged", { role: "business", market: "Virginia Beach", city: "Virginia Beach", state: "VA", business: { businessName: "Charged Grill", category: "Restaurant", plan: "growth", planName: "Growth $349/mo", planPriceMonthly: 349, planMinMonths: 3, planSelectedAt: midOf(M1), accessState: "active", subscription: { id: "sub_c1", customerId: "cus_c1", status: "active", plan: "growth", planPriceMonthly: 349 } } }));
addUser(userRec("b-recorded", { role: "business", market: "Nashville", partnerId: "partner-nash", business: { businessName: "Recorded Tacos", category: "Restaurant", plan: "self-service", planName: "Self-Service $199/mo", planPriceMonthly: 199, planMinMonths: 3, planSelectedAt: midOf(M1) } }));
addUser(userRec("b-pastdue", { role: "business", market: "Nashville", partnerId: "partner-nash", business: { businessName: "Past Due Pizza", category: "Restaurant", plan: "growth", planName: "Growth $349/mo", planPriceMonthly: 349, planMinMonths: 3, planSelectedAt: midOf(M1), accessState: "active", subscription: { id: "sub_pd", customerId: "cus_pd", status: "past_due", plan: "growth", planPriceMonthly: 349 } } }));
addUser(userRec("b-comp", { role: "business", market: "Nashville", business: { businessName: "Comp Kitchen", category: "Restaurant" } }));
addUser(userRec("b-rich", { role: "business", market: "Richmond", city: "Richmond", state: "VA", partnerId: "partner-nash", business: { businessName: "Richmond Stamped", category: "Restaurant" } }));
addUser(userRec("b-mismatch", { role: "business", market: "Nashville", business: { businessName: "Mismatch Deli", category: "Restaurant", subscription: { id: "sub_mm", customerId: "cus_mm", status: "active" } } }));
addUser(userRec("b-nomarket", { role: "business", market: "", city: "", state: "", business: { businessName: "Nowhere BBQ", category: "Restaurant" } }));

const bookingRec = (id, over) => ({ id, businessId: "b-charged", creatorId: "c-held", market: "Virginia Beach", title: `Visit ${id}`, createdAt: NOW, updatedAt: NOW, ...over });
const lane = (rate, over) => ({ rate, businessTotal: Math.round(rate * 103) / 100, creatorNet: Math.round(rate * 97) / 100, platformFee: Math.round(rate * 6) / 100, escrowState: "held", bookedAt: NOW, proofAt: null, releasedAt: null, ...(over || {}) });
const FIXTURE_BOOKINGS = [
  // Held paid bookings — one per blocker.
  bookingRec("bk-held-ready", { kind: "paid", status: "completed", paidLane: lane(200, { bookedAt: daysAgo(3) }) }),
  bookingRec("bk-held-nopost", { kind: "paid", status: "completed", paidLane: lane(100, { bookedAt: daysAgo(5) }) }),
  bookingRec("bk-held-card", { kind: "paid", status: "completed", paidLane: lane(150, { bookedAt: daysAgo(2), funds: { state: "needs_card", paymentIntentId: null, transferId: null, blockedReason: null, heldAt: null, releasedAt: null, refundedAt: null } }) }),
  bookingRec("bk-held-payouts", { kind: "paid", status: "completed", paidLane: lane(300, { bookedAt: daysAgo(4), funds: { state: "held", paymentIntentId: "pi_hp", transferId: null, blockedReason: "payouts_not_ready", heldAt: daysAgo(1), releasedAt: null, refundedAt: null } }) }),
  bookingRec("bk-held-failed", { kind: "paid", status: "completed", paidLane: lane(50, { bookedAt: daysAgo(6), funds: { state: "charge_failed", paymentIntentId: null, transferId: null, blockedReason: null, heldAt: null, releasedAt: null, refundedAt: null } }) }),
  // Released paid bookings — one this month, one (split-broken) last month.
  bookingRec("bk-released-paid", { kind: "paid", status: "completed", paidLane: lane(200, { escrowState: "released", releasedAt: NOW }) }),
  bookingRec("bk-split-bad", { kind: "paid", status: "completed", createdAt: midOf(M1), updatedAt: midOf(M1), paidLane: { rate: 196, businessTotal: 200, creatorNet: 190, platformFee: 5, escrowState: "released", bookedAt: midOf(M1), releasedAt: midOf(M1) } }),
  // Rollover substrate for Charged Grill (growth, base 10):
  // one comp last month, two this month.
  bookingRec("bk-cc-prev", { kind: "comp", status: "booked", createdAt: midOf(M1), updatedAt: midOf(M1) }),
  bookingRec("bk-cc-cur", { kind: "comp", status: "booked" }),
  bookingRec("bk-cc-done", { kind: "comp", status: "completed", compCostEntry: { amount: 35, confirmedZero: false, at: NOW, by: "b-charged" } }),
  // Comp Kitchen's comps.
  bookingRec("bk-comp-cost", { kind: "comp", status: "completed", businessId: "b-comp", creatorId: "c-two", market: "Nashville", createdAt: midOf(M1), updatedAt: midOf(M1), compCostEntry: { amount: 42, confirmedZero: false, at: midOf(M1), by: "b-comp" } }),
  bookingRec("bk-comp-nocost", { kind: "comp", status: "completed", businessId: "b-comp", creatorId: "c-two", market: "Nashville", createdAt: midOf(M1), updatedAt: midOf(M1) }),
  bookingRec("bk-comp-booked", { kind: "comp", status: "booked", businessId: "b-comp", creatorId: "c-two", market: "Nashville", dollarCap: 75 }),
  bookingRec("bk-comp-redeemed", { kind: "comp", status: "redeemed", businessId: "b-comp", creatorId: "c-two", market: "Nashville", dollarCap: 60, redeemedAt: NOW }),
  // A counted register event whose booking sits in no market.
  bookingRec("bk-nomarket", { kind: "comp", status: "cancelled", businessId: "b-nomarket", creatorId: "c-two", market: "" }),
];
for (const b of FIXTURE_BOOKINGS) seed[`booking:${b.id}`] = b;
seed["post:post-ready"] = { id: "post-ready", bookingId: "bk-held-ready", businessId: "b-charged", creatorId: "c-held", submittedAt: daysAgo(3), createdAt: daysAgo(3) };
seed["post:post-comp"] = { id: "post-comp", bookingId: "bk-comp-cost", businessId: "b-comp", creatorId: "c-two", submittedAt: midOf(M1), createdAt: midOf(M1) };

const licRec = (id, over) => ({ id, businessId: "b-charged", creatorId: "c-two", bookingId: "bk-comp-cost", postId: "post-comp", createdAt: NOW, updatedAt: NOW, ...over });
seed["license:lic-held"] = licRec("lic-held", { status: "pending", escrowState: "held", createdAt: daysAgo(2), fee: 150, businessTotal: 154.5, creatorNet: 145.5, platformFee: 9 });
seed["license:lic-granted"] = licRec("lic-granted", { status: "granted", escrowState: "released", grantedAt: NOW, respondedAt: NOW, fee: 100, businessTotal: 103, creatorNet: 97, platformFee: 6 });
seed["license:lic-split-bad"] = licRec("lic-split-bad", { status: "granted", escrowState: "released", grantedAt: midOf(M1), respondedAt: midOf(M1), createdAt: midOf(M1), fee: 97, businessTotal: 100, creatorNet: 90, platformFee: 5 });

const chargeRec = (id, over) => ({ id, provider: "stripe", stripeEventIds: [`evt_${id}`], createdAt: NOW, kind: "subscription", businessId: null, creatorId: null, bookingId: null, licenseId: null, stripeCustomerId: null, stripeSubscriptionId: null, stripeInvoiceId: id, stripePaymentIntentId: null, planId: null, gross: 0, creditApplied: 0, net: 0, status: "succeeded", currency: "usd", chargedAt: NOW, description: "Subscription", updatedAt: NOW, ...(over || {}) });
seed["charge:stripe:in_m1"] = chargeRec("in_m1", { businessId: "b-charged", stripeCustomerId: "cus_c1", stripeSubscriptionId: "sub_c1", stripePaymentIntentId: "pi_m1", planId: "growth", gross: 349, creditApplied: 100, net: 249, chargedAt: midOf(M1), createdAt: midOf(M1) });
seed["charge:stripe:in_m0"] = chargeRec("in_m0", { businessId: "b-charged", stripeCustomerId: "cus_c1", stripeSubscriptionId: "sub_c1", stripePaymentIntentId: "pi_m0", planId: "growth", gross: 349, creditApplied: 0, net: 349 });
seed["charge:stripe:in_ghost"] = chargeRec("in_ghost", { stripeCustomerId: "cus_ghost", planId: "self-service", gross: 99, net: 99 });
seed["charge:stripe:in_mm_fail"] = chargeRec("in_mm_fail", { businessId: "b-mismatch", stripeCustomerId: "cus_mm", stripeSubscriptionId: "sub_mm", planId: "self-service", gross: 199, net: 199, status: "failed" });
seed["charge:stripe:pi_paid_rel"] = chargeRec("pi_paid_rel", { kind: "paid", businessId: "b-charged", creatorId: "c-held", bookingId: "bk-released-paid", stripeInvoiceId: null, stripePaymentIntentId: "pi_paid_rel", gross: 206, net: 206 });

seed["redevent:re-1"] = { id: "re-1", bookingId: "bk-comp-cost", businessId: "b-comp", creatorId: "c-two", kind: "first", amount: 120.5, at: midOf(M1) };
seed["redevent:re-flag"] = { id: "re-flag", bookingId: "bk-comp-nocost", businessId: "b-comp", creatorId: "c-two", kind: "first", amount: 1240, at: NOW, flagged: true };
seed["redevent:re-orphan"] = { id: "re-orphan", bookingId: "bk-missing", businessId: "b-comp", creatorId: "c-two", kind: "first", amount: 55, at: NOW };
seed["redevent:re-nomarket"] = { id: "re-nomarket", bookingId: "bk-nomarket", businessId: "b-nomarket", creatorId: "c-two", kind: "first", amount: 40, at: NOW };
seed["sqconn:b-comp"] = { businessId: "b-comp", status: "paused", pausedAt: daysAgo(2), pausedReason: "Square stopped sharing checks", lastSyncAt: daysAgo(2), lastSyncSummary: { state: "ok", ordersSeen: 9, firsts: 3, audience: 0, returns: 1, loyaltyReturns: 0, passesIssued: 0, typedVoided: 2, registerVoided: 1, lateEvents: 0, at: daysAgo(2) } };
seed["config:markets"] = { flags: {} };
// The compliance sweep runs opportunistically on ordinary
// requests and would release the ready hold mid-test (its job,
// in production). Its throttle records are seeded fresh — the
// sweep "just ran" — so the owed states below are read exactly
// as the records hold them.
seed["config:complianceSweep"] = { lastRunAt: NOW };
seed["config:offerSweep"] = { lastRunAt: NOW };
fs.writeFileSync(DB_PATH, JSON.stringify(seed));

const { handler } = require("../netlify/functions/api.js");
function evt(method, p, { cookie, query, body, headers } = {}) {
  return { httpMethod: method, path: p, headers: { ...(cookie ? { cookie } : {}), ...(headers || {}) }, queryStringParameters: query || {}, body: body === undefined ? null : (typeof body === "string" ? body : JSON.stringify(body)), isBase64Encoded: false };
}
const parse = (res) => { try { return JSON.parse(res.body); } catch (e) { return null; } };
const cookieOf = (res) => (((res.headers || {})["Set-Cookie"] || (res.headers || {})["set-cookie"] || "").split(";")[0]);
const sign = (raw) => {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
};

console.log("verify-build57: Owed + Reconciliation + Close & Export");
check("build stamp is 2026.10.31-61", BUILD_ID === "2026.10.31-61", BUILD_ID);
check("index.html carries the -57 stamp", fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").includes("2026.10.31-61"));

const login = await handler(evt("POST", "/api/auth/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } }));
check("admin login succeeds", login.statusCode === 200, `got ${login.statusCode}`);
const admin = cookieOf(login);

// ---------- the deal the partner math runs on ----------
const dealRes = await handler(evt("POST", "/api/admin/partners/partner-nash/deals", { cookie: admin, body: { label: "Nashville program", status: "signed", terms: { partnerPct: 60, attributionScope: "market_wide", markets: [{ market: "Nashville", status: "live", liveAt: firstOf(M1), activationFee: null, activationStatus: "unbilled" }] } } }));
const deal = parse(dealRes);
check("the plain-percentage deal is created (v1)", dealRes.statusCode === 201 || dealRes.statusCode === 200, `got ${dealRes.statusCode}: ${dealRes.body.slice(0, 160)}`);
const dealId = deal && deal.deal && deal.deal.id;

// ---------- owed ----------
const owed0 = parse(await handler(evt("GET", "/api/admin/command/owed", { cookie: admin })));
check("owed answers 200 for admin", !!owed0 && !!owed0.creators, "no payload");
const heldById = Object.fromEntries(((owed0 && owed0.creators.held) || []).map((r) => [r.id, r]));
check("creator holds total $921.50 across 6 holds (5 paid + 1 license)", !!owed0 && owed0.creators.heldTotal === 921.5 && owed0.creators.heldCount === 6, owed0 && JSON.stringify(owed0.creators.heldTotal));
check("releasable now is $194; the other $727.50 is waiting or blocked, each with its named blocker",
  !!owed0 && owed0.creators.releasableNow === 194 && owed0.creators.blockedTotal === 727.5
  && heldById["bk-held-ready"].state === "ready"
  && heldById["bk-held-nopost"].code === "post_not_live" && /post/i.test(heldById["bk-held-nopost"].blocker)
  && heldById["bk-held-card"].code === "needs_card" && /no card/i.test(heldById["bk-held-card"].blocker)
  && heldById["bk-held-payouts"].code === "payouts_not_ready" && /payout setup/i.test(heldById["bk-held-payouts"].blocker)
  && heldById["bk-held-failed"].code === "charge_failed"
  && heldById["lic-held"].code === "license_decision",
  JSON.stringify(Object.fromEntries(Object.entries(heldById).map(([k, v]) => [k, v.code]))));
check("holds carry their age (the no-post hold is 5 days old)", heldById["bk-held-nopost"].ageDays === 5 && heldById["bk-held-failed"].ageDays === 6, JSON.stringify({ a: heldById["bk-held-nopost"].ageDays, b: heldById["bk-held-failed"].ageDays }));
check("released in period: $571 across 4 releases (2 paid + 2 licenses, incl. the split-broken ones, printed as written)",
  !!owed0 && owed0.creators.releasedTotal === 571 && owed0.creators.releasedCount === 4, owed0 && JSON.stringify(owed0.creators.releasedTotal));
check("partner owed before any payout: accrued $657.60 (60% of $548/mo recorded for two months), paid 0, owed the whole",
  !!owed0 && owed0.partners.accrued === 657.6 && owed0.partners.paid === 0 && owed0.partners.owed === 657.6, owed0 && JSON.stringify(owed0.partners));
const nashRow = owed0 && owed0.partners.rows.find((r) => r.id === "partner-nash");
check("the partner row notes the governing deal version (v1)", !!nashRow && nashRow.deals.length === 1 && nashRow.deals[0].currentVersion === 1, nashRow && JSON.stringify(nashRow.deals));
check("businesses owe on paper: 1 past due at $349/mo, 1 recorded-never-charged at $199/mo",
  !!owed0 && owed0.businesses.pastDue.count === 1 && owed0.businesses.pastDue.monthly === 349
  && owed0.businesses.recordedNeverCharged.count === 1 && owed0.businesses.recordedNeverCharged.monthly === 199,
  owed0 && JSON.stringify(owed0.businesses));
check("liabilities are service, not cash: 32 rollover visits worth $1,141.30 at plan value, 9 of them carried and lapsing at month end",
  !!owed0 && owed0.liabilities.rollover.visits === 32 && owed0.liabilities.rollover.planValue === 1141.3 && owed0.liabilities.rollover.carriedVisits === 9
  && typeof owed0.liabilities.rollover.carriedExpiresAt === "string" && owed0.liabilities.rollover.carriedExpiresAt.slice(8, 10) === "01",
  owed0 && JSON.stringify(owed0.liabilities.rollover));
check("founding credits outstanding: $200 across 2 businesses; menu value promised: $135 across 4 booked-not-redeemed comps",
  !!owed0 && owed0.liabilities.foundingCredits.count === 2 && owed0.liabilities.foundingCredits.total === 200
  && owed0.liabilities.compPromised.count === 4 && owed0.liabilities.compPromised.menuValue === 135,
  owed0 && JSON.stringify(owed0.liabilities));
check("owed totals keep the directions apart: out $1,579.10 (921.50 creators + 657.60 partners), businesses' $548/mo never netted in",
  !!owed0 && owed0.totals.owedOut === 1579.1 && owed0.totals.toCreators === 921.5 && owed0.totals.toPartners === 657.6 && owed0.totals.byBusinessesMonthly === undefined && owed0.totals.pastDueMonthly === 349 && owed0.totals.recordedMonthly === 199,
  owed0 && JSON.stringify(owed0.totals));

// a payout moves partner owed identically everywhere
const payout = parse(await handler(evt("POST", "/api/admin/command/partners/payouts", { cookie: admin, body: { partnerId: "partner-nash", dealId, amount: 200, period: M1, method: "ACH", reference: "ach-57" } })));
check("the $200 payout records", !!payout && payout.paidTotal === 200, payout && JSON.stringify(payout));
const owed1 = parse(await handler(evt("GET", "/api/admin/command/owed", { cookie: admin })));
check("after the payout: partner owed $457.60, owed out $1,379.10", !!owed1 && owed1.partners.owed === 457.6 && owed1.totals.owedOut === 1379.1, owed1 && JSON.stringify(owed1.totals));
const ov = parse(await handler(evt("GET", "/api/admin/command/overview", { cookie: admin })));
check("the overview money-owed tile is the same ledger: out 1379.10, creators 921.50, partners 457.60, businesses 548/mo apart",
  !!ov && !!ov.tiles.moneyOwed && ov.tiles.moneyOwed.owedOut === 1379.1 && ov.tiles.moneyOwed.toCreators === 921.5 && ov.tiles.moneyOwed.toPartners === 457.6 && ov.tiles.moneyOwed.byBusinessesMonthly === 548,
  ov && JSON.stringify(ov.tiles.moneyOwed));

// ---------- reconciliation ----------
const recon = parse(await handler(evt("GET", "/api/admin/command/reconciliation", { cookie: admin })));
const kinds = Object.fromEntries(((recon && recon.alerts) || []).map((a) => [a.kind, a.count]));
check("reconciliation answers with the planted disagreements, each a sentence + count + named records",
  !!recon && kinds.charges_unmatched === 1 && kinds.recorded_never_charged === 1 && kinds.split_mismatch === 2
  && kinds.money_event_no_record === 1 && kinds.unlisted_records === 1 && kinds.comps_missing_cost === 1
  && kinds.square_paused === 1 && kinds.square_voids === 3 && kinds.flagged_redevents === 1
  && kinds.partner_market_no_deal === 1 && kinds.deal_market_not_live === 1 && kinds.counted_no_market === 1
  && kinds.subscription_state_mismatch === 1,
  JSON.stringify(kinds));
check("the alert total is the sum of its kinds (16)", !!recon && recon.summary.alertCount === 16 && recon.summary.alertKinds === 13, recon && JSON.stringify(recon.summary));
const splitAlert = recon && recon.alerts.find((a) => a.kind === "split_mismatch");
check("the split alert names both offenders (the booking and the license)", !!splitAlert && splitAlert.items.some((i) => i.id === "bk-split-bad") && splitAlert.items.some((i) => i.id === "lic-split-bad"), splitAlert && JSON.stringify(splitAlert.items));
const unlAlert = recon && recon.alerts.find((a) => a.kind === "unlisted_records");
check("the unlisted alert names Clarksville and its resolution (the sweep can file it under Nashville)",
  !!unlAlert && unlAlert.items.some((i) => /Clarksville/.test(i.label) && /Nashville/.test(i.detail)), unlAlert && JSON.stringify(unlAlert.items));
const costAlert = recon && recon.alerts.find((a) => a.kind === "comps_missing_cost");
check("the cost alert prints its coverage (confirmed on 2 of 3) instead of filling the gap with the cap",
  !!costAlert && /confirmed on 2 of 3/.test(costAlert.text) && costAlert.items.some((i) => i.id === "bk-comp-nocost"), costAlert && costAlert.text);
const reconMonth = parse(await handler(evt("GET", "/api/admin/command/reconciliation", { cookie: admin, query: { period: "this_month" } })));
const monthKinds = Object.fromEntries(((reconMonth && reconMonth.alerts) || []).map((a) => [a.kind, a.count]));
check("this month, the active-but-uncharged check wakes up: Past Due Pizza has a plan and no charge this month", monthKinds.businesses_no_charge === 1, JSON.stringify(monthKinds));

// ---------- close ----------
const accrue1 = parse(await handler(evt("POST", "/api/admin/command/partners/accrue", { cookie: admin })));
check("accrual snapshots write for both deal months", !!accrue1 && accrue1.accruals.written === 2, accrue1 && JSON.stringify(accrue1.accruals));
const close0 = parse(await handler(evt("GET", "/api/admin/command/close", { cookie: admin })));
check("close lists the current month open with live figures (charged net $654: 349 + 99 ghost + 206 paid)",
  !!close0 && close0.selected.period === M0 && close0.selected.state === "open" && close0.selected.headlineIsLive === true && close0.selected.headline.chargedNet === 654,
  close0 && JSON.stringify(close0.selected.headline));
const m1Row = close0 && close0.months.find((m) => m.period === M1);
check("last month is listed, still open, nothing frozen", !!m1Row && m1Row.state === "open" && m1Row.headline === null, m1Row && JSON.stringify(m1Row));
const soft = parse(await handler(evt("POST", "/api/admin/command/close/soft", { cookie: admin, body: { period: M1 } })));
check("soft close freezes the preliminary headline (charged net $249 — the one real charge that month)",
  !!soft && soft.state === "soft_closed" && soft.headline.chargedNet === 249 && soft.headline.countedRegister === 120.5 && soft.headline.recordedFlowed === 1197,
  soft && JSON.stringify(soft.headline));
check("the frozen headline carries the month whole: 10 people as of month end, 4 finished deals, $328.80 accrued to the partner, $921.50 owed to creators, $457.60 to the partner",
  !!soft && soft.headline.usersTotal === 10 && soft.headline.finishedDeals.total === 4 && soft.headline.partnersAccrued === 328.8 && soft.headline.owedToCreators === 921.5 && soft.headline.owedToPartners === 457.6,
  soft && JSON.stringify(soft.headline));
const hard = parse(await handler(evt("POST", "/api/admin/command/close/hard", { cookie: admin, body: { period: M1 } })));
check("hard close seals the month and closes its accrual record", !!hard && hard.state === "closed" && hard.accrualsClosed === 1, hard && JSON.stringify(hard));
const accrue2 = parse(await handler(evt("POST", "/api/admin/command/partners/accrue", { cookie: admin })));
check("the accrual snapshot can never rewrite the closed month again (skipped as closed; the open month refreshes)",
  !!accrue2 && accrue2.accruals.skippedClosed === 1 && accrue2.accruals.refreshed === 1 && accrue2.accruals.written === 0, accrue2 && JSON.stringify(accrue2.accruals));
const reclose = await handler(evt("POST", "/api/admin/command/close/soft", { cookie: admin, body: { period: M1 } }));
check("a closed month refuses a second close (409) — its numbers stand", reclose.statusCode === 409, `got ${reclose.statusCode}`);

// ---------- post-close changes land as adjustments, never rewrites ----------
// (a) A Stripe refund on the closed month's charge, through the
// real signed webhook.
const refundEvt = { id: "evt_rf_57", type: "charge.refunded", data: { object: { id: "ch_stripe_m1", amount: 34900, amount_refunded: 10000, refunded: false, payment_intent: "pi_m1", invoice: "in_m1", currency: "usd", refunds: { data: [{ id: "re_adj_1", amount: 10000, created: Math.floor(NOW_MS / 1000) }] } } } };
const rawRefund = JSON.stringify(refundEvt);
const wh = await handler(evt("POST", "/api/stripe/webhook", { body: rawRefund, headers: { "stripe-signature": sign(rawRefund) } }));
check("the refund webhook is accepted", wh.statusCode === 200, `got ${wh.statusCode}`);
const moneyLast = parse(await handler(evt("GET", "/api/admin/command/money", { cookie: admin, query: { period: "last_month" } })));
check("the LIVE books move: last month's charged net is $149 now (the refund is real)",
  !!moneyLast && moneyLast.charged.netTotal === 149, moneyLast && JSON.stringify(moneyLast.charged.netTotal));
const closeM1 = parse(await handler(evt("GET", "/api/admin/command/close", { cookie: admin, query: { month: M1 } })));
check("but the frozen month does not: its headline still reads $249, state closed, not live",
  !!closeM1 && closeM1.selected.state === "closed" && closeM1.selected.headlineIsLive === false && closeM1.selected.headline.chargedNet === 249,
  closeM1 && JSON.stringify(closeM1.selected.headline));
// (b) A Square register correction against the closed month's
// count, written exactly as the Square sync writes it.
const re1 = await store.get("redevent:re-1");
re1.amount = 100;
re1.corrections = [{ at: NOW, by: "square", oldAmount: 120.5, newAmount: 100, voided: false, wasVoided: false }];
await store.set("redevent:re-1", re1);
const closeM0 = parse(await handler(evt("GET", "/api/admin/command/close", { cookie: admin, query: { month: M0 } })));
const adj = (closeM0 && closeM0.selected.adjustments) || [];
check("both changes stand as adjustments in the current month, traced to their records (−$100 refund, −$20.50 register correction, both for the closed month)",
  adj.length === 2
  && adj.some((a) => a.kind === "late_refund" && a.amount === -100 && a.period === M1 && a.parentId === "in_m1")
  && adj.some((a) => a.kind === "register_correction" && a.amount === -20.5 && a.period === M1 && a.eventId === "re-1" && /Square/.test(a.detail)),
  JSON.stringify(adj));
// the quoted-figures note rides the close record without touching numbers
check("the closed month itself shows no adjustments — its own pre-close records (the $42 cost entry) were part of its books, not changes to them",
  !!closeM1 && Array.isArray(closeM1.selected.adjustments) && closeM1.selected.adjustments.length === 0,
  closeM1 && JSON.stringify(closeM1.selected.adjustments));
const note = parse(await handler(evt("POST", "/api/admin/command/close/note", { cookie: admin, body: { period: M1, note: "Quoted the October roster count to a partner on the 28th." } })));
check("the quoted-figures note saves on the closed month", !!note && note.state === "closed" && /roster count/.test(note.quotedNote), note && JSON.stringify(note));
const closeM1b = parse(await handler(evt("GET", "/api/admin/command/close", { cookie: admin, query: { month: M1 } })));
check("the note is on the record and the frozen headline is still $249", !!closeM1b && /roster count/.test(closeM1b.selected.quotedNote) && closeM1b.selected.headline.chargedNet === 249);

// ---------- exports ----------
const csvGet = async (ledger, query) => handler(evt("GET", `/api/admin/command/export/${ledger}`, { cookie: admin, query: query || {} }));
const partnersCsv = await csvGet("partners");
check("partners CSV downloads as CSV with its header", partnersCsv.statusCode === 200 && String(partnersCsv.headers["Content-Type"]).includes("text/csv") && partnersCsv.body.startsWith("partner,code,terms_state"), partnersCsv.body.slice(0, 80));
check("partners CSV carries the partner's true figures (accrued 657.6, paid 200, owed 457.6) and the no-terms partner honestly",
  partnersCsv.body.includes("Nashville Media") && partnersCsv.body.includes("657.6") && partnersCsv.body.includes("457.6") && partnersCsv.body.includes("Solo Media") && partnersCsv.body.includes("not_entered"));
const bizCsv = await csvGet("businesses");
check("businesses CSV carries the agreement rows (Recorded Tacos recorded; Past Due Pizza past-due)",
  bizCsv.body.includes("Recorded Tacos") && bizCsv.body.includes("recorded") && bizCsv.body.includes("Past Due Pizza") && bizCsv.body.includes("past-due"));
const creatorsCsv = await csvGet("creators");
check("creators CSV carries per-creator money (heldcreator: $776 held, $384 released; secondcreator: $145.50 held, $187 released)",
  creatorsCsv.body.includes("heldcreator") && creatorsCsv.body.includes("776") && creatorsCsv.body.includes("384") && creatorsCsv.body.includes("secondcreator") && creatorsCsv.body.includes("145.5") && creatorsCsv.body.includes("187"));
const moneyCsv = await csvGet("money");
check("money CSV keeps the classes apart and prints the failed split check instead of hiding it",
  moneyCsv.body.includes("Recorded,Subscriptions") && moneyCsv.body.includes("Counted,Register counts") && moneyCsv.body.includes("Modeled,Halo estimate") && moneyCsv.body.includes("SPLIT CHECK FAILED"));
const owedCsv = await csvGet("owed");
check("owed CSV names the blockers and labels the promises as promises",
  owedCsv.body.includes("creator_held") && owedCsv.body.includes("no card on file") && owedCsv.body.includes("partner_owed") && owedCsv.body.includes("457.6") && owedCsv.body.includes("menu value promised"));
const pack = await csvGet("pack", { month: M1 });
check("the accountant pack downloads as a zip", pack.statusCode === 200 && String(pack.headers["Content-Type"]).includes("application/zip") && pack.isBase64Encoded === true, `got ${pack.statusCode}`);
const zipBuf = Buffer.from(pack.body, "base64");
const unzipStore = (buf) => {
  const files = {}; let off = 0;
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(off + 26); const extraLen = buf.readUInt16LE(off + 28); const size = buf.readUInt32LE(off + 18);
    const name = buf.slice(off + 30, off + 30 + nameLen).toString("utf8");
    files[name] = buf.slice(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + size).toString("utf8");
    off += 30 + nameLen + extraLen + size;
  }
  return files;
};
const packFiles = unzipStore(zipBuf);
check("the pack holds all five ledger CSVs plus the close snapshot",
  ["partners.csv", "businesses.csv", "creators.csv", "money.csv", "owed.csv", "close-snapshot.json"].every((f) => typeof packFiles[f] === "string" && packFiles[f].length > 0),
  Object.keys(packFiles).join(","));
const snap = packFiles["close-snapshot.json"] ? JSON.parse(packFiles["close-snapshot.json"]) : null;
check("the pack's snapshot is the FROZEN close (state closed, charged net still $249 after the refund, partner month $328.80)",
  !!snap && snap.state === "closed" && snap.headline.chargedNet === 249 && snap.partners.some((p) => p.id === "partner-nash" && p.period.partnerShare === 328.8),
  snap && JSON.stringify({ s: snap.state, c: snap.headline && snap.headline.chargedNet }));

// ---------- guardrail ----------
const creatorLogin = await handler(evt("POST", "/api/auth/login", { body: { email: "c-held@fixtures.dev", password: PW } }));
const creatorCookie = cookieOf(creatorLogin);
const bizLogin = await handler(evt("POST", "/api/auth/login", { body: { email: "b-charged@fixtures.dev", password: PW } }));
const bizCookie = cookieOf(bizLogin);
for (const [label, cookie] of [["creator", creatorCookie], ["business", bizCookie]]) {
  for (const p of ["/api/admin/command/owed", "/api/admin/command/reconciliation", "/api/admin/command/close", "/api/admin/command/export/partners", "/api/admin/command/export/pack"]) {
    const r = await handler(evt("GET", p, { cookie }));
    check(`${label} gets 403 on GET ${p}`, r.statusCode === 403, `got ${r.statusCode}`);
  }
  const rc = await handler(evt("POST", "/api/admin/command/close/hard", { cookie, body: { period: M0 } }));
  check(`${label} gets 403 on POST close/hard`, rc.statusCode === 403, `got ${rc.statusCode}`);
}
const anon = await handler(evt("GET", "/api/admin/command/owed"));
check("anonymous GET command/owed is refused (401/403)", anon.statusCode === 401 || anon.statusCode === 403, `got ${anon.statusCode}`);

// ---------- client + server source ----------
const appSrc = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const routerSrc = fs.readFileSync(new URL("../netlify/functions/lib/router.js", import.meta.url), "utf8");
check("client: the Owed and Close subtabs render their real views (owed ledger, reconciliation, close, exports)",
  appSrc.includes("ccOwedHtml") && appSrc.includes("ccCloseHtml") && appSrc.includes("ccReconHtml")
  && appSrc.includes("/admin/command/owed") && appSrc.includes("/admin/command/reconciliation") && appSrc.includes("/admin/command/close")
  && appSrc.includes("ccExport('pack')") && appSrc.includes("Promises, not cash") && appSrc.includes("Adjustments landed"));
check("client: the overview money-owed tile renders the ledger totals when they exist",
  appSrc.includes("t.moneyOwed") && appSrc.includes("owedOut"));
check("server: the -57 routes sit inside the admin gate",
  routerSrc.indexOf('seg[2] === "owed"') > routerSrc.indexOf('if (seg[0] === "admin")')
  && routerSrc.indexOf('seg[2] === "reconciliation"') > routerSrc.indexOf('if (seg[0] === "admin")')
  && routerSrc.indexOf('seg[2] === "export"') > routerSrc.indexOf('if (seg[0] === "admin")')
  && routerSrc.includes("periodclose:") && routerSrc.includes("ccZipStore"));

console.log(`\nverify-build57: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
