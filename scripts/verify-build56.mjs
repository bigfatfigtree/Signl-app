// Build -56: Admin Command Center — partner deals, the
// versioned Deal editor, the greater-of engine, the Partners
// views, and partner Earnings re-based on the same math (spec
// signl-admin-command-center-spec-2026-10-30.md §2.3/§2.5/§3.2/§5).
// Proven here:
//
// 1. GREATER-OF MATH on the reference deal shape (Jeff's ruling
//    2026-10-30: the presented-deck schedule governs — $15k
//    activation; greater of $5k/mo or 25% in months 1–3; greater
//    of $10k/mo or 25% in months 4–6; $60k pilot floor; the
//    guarantee protects SIGNL's take, the partner keeps the
//    residual). Six charged months at the sample pack's business
//    ramp (22/38/51/60/70/70 at the $246.50 blended rate) must
//    reproduce the worked table exactly, both candidates printed,
//    the guarantee governing every month, the pilot floor met at
//    exactly $60,000 ($15k activation + $45k of monthly takes),
//    and the steady state at 70 businesses annualizing to $87,060
//    to the partner (the spec's ≈$87,090 is the rounded headline;
//    the exact gross at 70 × $246.50 × 12 is $207,060). Crossover
//    — the business count where the percentage passes the $10k
//    floor — is 163.
// 2. VERSIONING IS APPEND-ONLY. Editing terms appends version 2;
//    version 1's snapshot is byte-intact afterwards; past months
//    still compute under version 1 (row.termsVersion proves it)
//    while the current month computes under version 2; the
//    deal_terms_changed event carries the changed fields and the
//    prior values. The old sharePct PATCH overwrite now REFUSES
//    (409) for a partner with a deal, and still works — with the
//    prior value preserved on the event — for a partner without.
// 3. NO-TERMS STATE. A partner with no deal renders "not
//    entered", accrues nothing in the engine, and their own
//    Earnings stay on the share-only basis. Nothing anywhere
//    invents a schedule for them. An activation fee nobody set
//    stays null ("to be set"), never 0.
// 4. ONE MATH, THREE SURFACES. The Admin Partners detail, the
//    Money view's partner column and the partner's own Earnings
//    all read the engine's cumulative figure; a recorded payout
//    moves paidTotal and owed identically on Admin and partner
//    surfaces. A plain-percentage deal (no guarantee) accrues on
//    the Recorded class exactly.
// 5. GUARDRAIL. The deal/command payloads are Admin-only.
//
// Run: node scripts/verify-build56.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build56-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify-admin-pass";
process.env.APP_URL = "http://localhost";

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
const monthKey = (offset) => { const d = new Date(Date.UTC(new Date(NOW_MS).getUTCFullYear(), new Date(NOW_MS).getUTCMonth() - offset, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const M0 = monthKey(0), M1 = monthKey(1), M2 = monthKey(2), M3 = monthKey(3), M4 = monthKey(4), M5 = monthKey(5);
const midOf = (mk) => `${mk}-15T12:00:00.000Z`;
const firstOf = (mk) => `${mk}-01T00:00:00.000Z`;

const userRec = (id, over) => ({
  id, email: `${id}@fixtures.dev`, name: `User ${id}`,
  passwordSalt: salt, passwordHash: hash,
  status: "approved", city: "Virginia Beach", state: "VA", country: "United States",
  createdAt: NOW, updatedAt: NOW, tester: false,
  ...over,
});
const seed = {};
const addUser = (u) => { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; };

addUser(userRec("partner-max", { role: "partner", email: "max@fixtures.dev", name: "Max Media", partner: { name: "Max Media", type: "media", contactName: "Sean", code: "maxmedia", markets: ["Virginia Beach"], sharePct: 25, status: "active", agreementStatus: "unsigned", demo: false } }));
addUser(userRec("partner-gan", { role: "partner", email: "gan@fixtures.dev", name: "Gannett", partner: { name: "Gannett", type: "media", contactName: "Rebecca", code: "gannett", markets: ["Richmond"], sharePct: 60, status: "active", agreementStatus: "unsigned", demo: false } }));
addUser(userRec("partner-solo", { role: "partner", email: "solo@fixtures.dev", name: "Solo Media", partner: { name: "Solo Media", type: "media", contactName: "Sam", code: "solomedia", markets: ["Nashville"], sharePct: 40, status: "active", agreementStatus: "unsigned", demo: false } }));
addUser(userRec("c-1", { role: "creator", market: "Virginia Beach", creator: { handle: "c1", followerCount: 1500, categories: ["Food"], localAudiencePct: 61 } }));

// The sample pack's ramp: 22 / 38 / 51 / 60 / 70 / 70 businesses
// charged $246.50 in deal months 1..6 (M5..M0).
const RAMP = { [M5]: 22, [M4]: 38, [M3]: 51, [M2]: 60, [M1]: 70, [M0]: 70 };
for (let i = 1; i <= 70; i += 1) {
  const id = `vb-${i}`;
  addUser(userRec(id, { role: "business", market: "Virginia Beach", partnerId: "partner-max", business: { businessName: `VB Biz ${i}`, category: "Restaurant" } }));
  for (const [mk, count] of Object.entries(RAMP)) {
    if (i > count) continue;
    const cid = `in_${id}_${mk}`;
    seed[`charge:stripe:${cid}`] = { id: cid, provider: "stripe", stripeEventIds: [`evt_${cid}`], createdAt: midOf(mk), kind: "subscription", businessId: id, creatorId: null, bookingId: null, licenseId: null, stripeCustomerId: `cus_${id}`, stripeSubscriptionId: `sub_${id}`, stripeInvoiceId: cid, stripePaymentIntentId: `pi_${cid}`, planId: "growth", gross: 246.5, creditApplied: 0, net: 246.5, status: "succeeded", currency: "usd", chargedAt: midOf(mk), description: "Subscription", updatedAt: midOf(mk) };
  }
}
// Richmond: two recorded-only businesses (plan on file, no
// charges) for the plain-percentage deal.
for (const id of ["rich-1", "rich-2"]) {
  addUser(userRec(id, { role: "business", market: "Richmond", partnerId: "partner-gan", business: { businessName: `${id} Eats`, category: "Restaurant", plan: "growth", planName: "Growth $349/mo", planPriceMonthly: 349, planMinMonths: 3, planSelectedAt: midOf(M1), accessState: "active" } }));
}
fs.writeFileSync(DB_PATH, JSON.stringify(seed));

const { handler } = require("../netlify/functions/api.js");
function evt(method, p, { cookie, query, body } = {}) {
  return { httpMethod: method, path: p, headers: { ...(cookie ? { cookie } : {}) }, queryStringParameters: query || {}, body: body === undefined ? null : (typeof body === "string" ? body : JSON.stringify(body)), isBase64Encoded: false };
}
const parse = (res) => { try { return JSON.parse(res.body); } catch (e) { return null; } };
const cookieOf = (res) => (((res.headers || {})["Set-Cookie"] || (res.headers || {})["set-cookie"] || "").split(";")[0]);
const dbRead = () => JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
const eventsOf = (type) => Object.values(dbRead()).filter((r) => r && r.type === type);

console.log("verify-build56: partner deals + greater-of engine + Earnings re-base");
check("build stamp is 2026.10.31-61", BUILD_ID === "2026.10.31-61", BUILD_ID);
check("index.html carries the -56 stamp", fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").includes("2026.10.31-61"));

const login = await handler(evt("POST", "/api/auth/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } }));
check("admin login succeeds", login.statusCode === 200, `got ${login.statusCode}`);
const admin = cookieOf(login);
const partnerLogin = async (email) => cookieOf(await handler(evt("POST", "/api/auth/login", { body: { email, password: PW } })));

// ---------- the reference deal, entered as data ----------
const VARIANT_B = {
  partnerPct: 75, attributionScope: "market_wide", termMonths: 6, startAt: firstOf(M5), renewal: "",
  exclusivity: { scope: "market_conditional", conditions: "SIGNL signs no competing Hampton Roads radio group during the pilot while targets hold" },
  promoCommitments: "", salesTargets: "",
  guarantee: { beneficiary: "signl", pilotFloor: 60000, bands: [
    { fromMonth: 1, toMonth: 3, floorMonthly: 5000, pctToBeneficiary: 25 },
    { fromMonth: 4, toMonth: 6, floorMonthly: 10000, pctToBeneficiary: 25 },
  ] },
  markets: [{ market: "Virginia Beach", status: "live", liveAt: firstOf(M5), activationFee: 15000, activationStatus: "paid" }],
};
const created = parse(await handler(evt("POST", "/api/admin/partners/partner-max/deals", { cookie: admin, body: { label: "Hampton Roads pilot", status: "live", governingDocument: "", terms: VARIANT_B } })));
check("the deal is created with version 1 and the terms exactly as entered", created && created.deal && created.deal.currentVersion === 1 && created.deal.versions.length === 1 && created.deal.versions[0].terms.guarantee.bands[1].floorMonthly === 10000, created && JSON.stringify(created).slice(0, 200));
const dealId = created && created.deal && created.deal.id;

// ---------- greater-of math ----------
const detail = parse(await handler(evt("GET", `/api/admin/command/partners/partner-max`, { cookie: admin })));
const bd = detail && detail.deals && detail.deals[0];
const rows = bd && bd.markets && bd.markets[0] && bd.markets[0].months;
check("the breakdown carries six months", !!rows && rows.length === 6, rows && rows.length);
const byMonth = Object.fromEntries((rows || []).map((r) => [r.month, r]));
const expect = {
  [M5]: { gross: 5423, pctAmount: 1355.75, governing: 5000, signl: 5000, partner: 423, biz: 22 },
  [M4]: { gross: 9367, pctAmount: 2341.75, governing: 5000, signl: 5000, partner: 4367, biz: 38 },
  [M3]: { gross: 12571.5, pctAmount: 3142.88, governing: 5000, signl: 5000, partner: 7571.5, biz: 51 },
  [M2]: { gross: 14790, pctAmount: 3697.5, governing: 10000, signl: 10000, partner: 4790, biz: 60 },
  [M1]: { gross: 17255, pctAmount: 4313.75, governing: 10000, signl: 10000, partner: 7255, biz: 70 },
  [M0]: { gross: 17255, pctAmount: 4313.75, governing: 10000, signl: 10000, partner: 7255, biz: 70 },
};
let tableOk = !!rows;
for (const [mk, e] of Object.entries(expect)) {
  const r = byMonth[mk];
  if (!r || r.gross !== e.gross || !r.band || r.band.pctAmount !== e.pctAmount || r.governing !== e.governing || r.signlShare !== e.signl || r.partnerShare !== e.partner || r.businesses !== e.biz || r.governedBy !== "guarantee") { tableOk = false; console.log(`    month ${mk}:`, JSON.stringify(r)); }
}
check("greater-of reproduces the worked table exactly (both candidates printed, guarantee governing, residual to the partner)", tableOk);
check("cumulative accrual: partner $31,661.50, SIGNL $45,000, gross $76,661.50 (the two shares sum to the gross)", !!bd && bd.totals.partnerShare === 31661.5 && bd.totals.signlShare === 45000 && bd.totals.gross === 76661.5, bd && JSON.stringify(bd.totals));
check("steady state at 70 businesses annualizes to $87,060 to the partner (spec headline ≈$87,090 within rounding)", !!byMonth[M1] && byMonth[M1].partnerShare * 12 === 87060 && Math.abs(byMonth[M1].partnerShare * 12 - 87090) <= 30);
check("crossover is 163 businesses (where 25% of the blended rate passes the $10k floor)", !!bd && bd.crossoverBusinesses === 163, bd && bd.crossoverBusinesses);
check("pilot floor: $60,000 met exactly — $15,000 activation + $45,000 of monthly takes, shortfall 0", !!bd && !!bd.pilotFloor && bd.pilotFloor.counted === 60000 && bd.pilotFloor.activationCounted === 15000 && bd.pilotFloor.receiptsCounted === 45000 && bd.pilotFloor.met === true && bd.pilotFloor.shortfall === 0, bd && JSON.stringify(bd.pilotFloor));
check("current month reads month 6 with the guarantee governing", !!bd && !!bd.currentMonth && bd.currentMonth.month === M0 && bd.currentMonth.monthIndex === 6 && bd.currentMonth.governedBy === "guarantee" && bd.guaranteeState === "Guarantee is governing", bd && JSON.stringify(bd.currentMonth));
check("the run-rate panel is Modeled data at the deal's split (330 businesses, $2,958, one market)", !!bd && !!bd.runRate && bd.runRate.ramp.fill100.gross === 330 * 2958 && bd.runRate.ramp.fill100.partner === Math.round(330 * 2958 * 0.75), bd && JSON.stringify(bd.runRate));

// ---------- versioning: append-only, past months keep their math ----------
const v2Terms = JSON.parse(JSON.stringify(VARIANT_B));
v2Terms.guarantee.bands = v2Terms.guarantee.bands.map((b) => ({ ...b, pctToBeneficiary: 30 }));
const v2 = parse(await handler(evt("POST", `/api/admin/deals/${dealId}/versions`, { cookie: admin, body: { terms: v2Terms, note: "Percentage renegotiated" } })));
check("editing terms appends version 2 and reports the changed field", !!v2 && v2.version && v2.version.n === 2 && (v2.version.changedFields || []).includes("guarantee"), v2 && JSON.stringify(v2.version));
const dealsNow = parse(await handler(evt("GET", "/api/admin/partners/partner-max/deals", { cookie: admin })));
const dealNow = dealsNow && dealsNow.deals && dealsNow.deals[0];
check("history is never mutated: version 1 still carries 25%, version 2 carries 30%", !!dealNow && dealNow.versions.length === 2 && dealNow.versions[0].terms.guarantee.bands[0].pctToBeneficiary === 25 && dealNow.versions[1].terms.guarantee.bands[0].pctToBeneficiary === 30);
check("the deal_terms_changed event carries the diff and the prior values", eventsOf("deal_terms_changed").length === 1 && eventsOf("deal_terms_changed")[0].data.changedFields.includes("guarantee") && eventsOf("deal_terms_changed")[0].data.priorValues.guarantee.bands[0].pctToBeneficiary === 25);
const detail2 = parse(await handler(evt("GET", `/api/admin/command/partners/partner-max`, { cookie: admin })));
const rows2 = detail2 && detail2.deals && detail2.deals[0] && detail2.deals[0].markets[0].months;
const byMonth2 = Object.fromEntries((rows2 || []).map((r) => [r.month, r]));
check("past months still compute under version 1 (25%: $4,313.75 candidate, termsVersion 1)", !!byMonth2[M1] && byMonth2[M1].band.pctAmount === 4313.75 && byMonth2[M1].termsVersion === 1, byMonth2[M1] && JSON.stringify(byMonth2[M1].band));
check("the current month computes under version 2 (30%: $5,176.50 candidate, termsVersion 2; the floor still governs)", !!byMonth2[M0] && byMonth2[M0].band.pctAmount === 5176.5 && byMonth2[M0].termsVersion === 2 && byMonth2[M0].signlShare === 10000, byMonth2[M0] && JSON.stringify(byMonth2[M0].band));
const patch409 = await handler(evt("PATCH", "/api/admin/partners/partner-max", { cookie: admin, body: { sharePct: 50 } }));
check("the sharePct overwrite REFUSES (409) for a partner with a deal — the share lives in the versioned terms now", patch409.statusCode === 409, `got ${patch409.statusCode}`);
const patchOk = parse(await handler(evt("PATCH", "/api/admin/partners/partner-solo", { cookie: admin, body: { sharePct: 45 } })));
check("a deal-less partner's share still edits, and the prior value is preserved on the event", !!patchOk && patchOk.partner.sharePct === 45 && eventsOf("partner_updated").some((e) => e.data.sharePct && e.data.sharePct.from === 40 && e.data.sharePct.to === 45));

// ---------- agreement status ----------
const agree = parse(await handler(evt("PATCH", "/api/admin/partners/partner-max", { cookie: admin, body: { agreementStatus: "signed" } })));
check("agreement status is settable with a signed date, on its own event", !!agree && agree.partner.agreementStatus === "signed" && !!agree.partner.agreementSignedAt && eventsOf("partner_agreement_updated").length === 1);

// ---------- the plain-percentage deal on the Recorded class ----------
const ganTerms = { partnerPct: 60, attributionScope: "market_wide", markets: [{ market: "Richmond", status: "live", liveAt: firstOf(M1), activationFee: null, activationStatus: "unbilled" }] };
const ganCreatedRes = await handler(evt("POST", "/api/admin/partners/partner-gan/deals", { cookie: admin, body: { label: "Gannett promotions program", status: "signed", terms: ganTerms } }));
const ganCreated = parse(ganCreatedRes);
check("the standard deal is created", !!ganCreated && !!ganCreated.deal, ganCreated && JSON.stringify(ganCreated).slice(0, 160));
const ganDetail = parse(await handler(evt("GET", `/api/admin/command/partners/partner-gan`, { cookie: admin })));
const ganBd = ganDetail && ganDetail.deals && ganDetail.deals[0];
const ganRows = ganBd && ganBd.markets && ganBd.markets[0] && ganBd.markets[0].months;
check("recorded months accrue the plain 60%: two months of $698 gross → $418.80/mo, $837.60 total, no band, no pilot floor", !!ganRows && ganRows.length === 2 && ganRows.every((r) => r.gross === 698 && r.partnerShare === 418.8 && r.governedBy === "percentage" && r.band === null) && ganBd.totals.partnerShare === 837.6 && ganBd.pilotFloor === null, ganRows && JSON.stringify(ganRows));
check("an activation fee nobody set stays null — 'to be set', never 0", !!ganBd && ganBd.markets[0].activationFee === null && !!ganDetail && ganDetail.deals[0].terms.markets[0].activationFee === null);

// ---------- no-terms state ----------
const list = parse(await handler(evt("GET", "/api/admin/command/partners", { cookie: admin })));
const soloRow = list && list.partners.find((r) => r.id === "partner-solo");
check("the no-deal partner lists as terms not entered, with nothing accrued and no schedule assumed", !!soloRow && soloRow.termsState === "not_entered" && soloRow.accrued === 0 && soloRow.deals.length === 0, soloRow && JSON.stringify(soloRow));
const soloDetail = parse(await handler(evt("GET", "/api/admin/command/partners/partner-solo", { cookie: admin })));
check("the no-deal partner detail answers termsState not_entered", !!soloDetail && soloDetail.termsState === "not_entered" && soloDetail.totals.accrued === 0);

// ---------- payouts + one math on every surface ----------
const payout = parse(await handler(evt("POST", "/api/admin/command/partners/payouts", { cookie: admin, body: { partnerId: "partner-max", dealId, amount: 5000, period: M3, method: "ACH", reference: "ach-1" } })));
check("a payout records against the partner", !!payout && payout.paidTotal === 5000, payout && JSON.stringify(payout));
const detail3 = parse(await handler(evt("GET", `/api/admin/command/partners/partner-max`, { cookie: admin })));
check("Admin sees accrued $31,661.50, paid $5,000, owed $26,661.50", !!detail3 && detail3.totals.accrued === 31661.5 && detail3.totals.paid === 5000 && detail3.totals.owed === 26661.5, detail3 && JSON.stringify(detail3.totals));
const maxCookie = await partnerLogin("max@fixtures.dev");
const maxSummary = parse(await handler(evt("GET", "/api/partner/summary", { cookie: maxCookie })));
check("the partner's own Earnings read the SAME engine figures (basis deal, identical accrued / paid / owed)", !!maxSummary && !!maxSummary.earnings && maxSummary.earnings.basis === "deal" && maxSummary.earnings.accruedTotal === 31661.5 && maxSummary.earnings.paidTotal === 5000 && maxSummary.earnings.owedTotal === 26661.5, maxSummary && JSON.stringify(maxSummary.earnings));
check("the partner's current-month accrual matches the engine's current month ($7,255 on $17,255)", !!maxSummary && maxSummary.earnings.accruedMonthly === 7255 && maxSummary.earnings.monthlyRevenue === 17255, maxSummary && JSON.stringify(maxSummary.earnings));
const soloCookie = await partnerLogin("solo@fixtures.dev");
const soloSummary = parse(await handler(evt("GET", "/api/partner/summary", { cookie: soloCookie })));
check("the deal-less partner's Earnings stay on the share-only basis with paidTotal a real 0", !!soloSummary && !!soloSummary.earnings && soloSummary.earnings.basis === "share_only" && soloSummary.earnings.paidTotal === 0, soloSummary && JSON.stringify(soloSummary.earnings));
const money = parse(await handler(evt("GET", "/api/admin/command/money", { cookie: admin })));
check("the Money view's partner column is the engine's period accrual ($31,661.50 + $837.60 = $32,499.10), no longer null", !!money && money.recorded.rows.subscriptions.partnersEarned === 32499.1 && money.recorded.totals.partnersEarned === 32499.1, money && JSON.stringify(money.recorded.rows.subscriptions));

// ---------- accrual snapshots ----------
const accrue1 = parse(await handler(evt("POST", "/api/admin/command/partners/accrue", { cookie: admin })));
const accrualKeys = Object.keys(dbRead()).filter((k) => k.startsWith("accrual:"));
check("the accrue snapshot writes one record per partner-market-month (6 + 2 = 8)", !!accrue1 && accrue1.accruals.written === 8 && accrualKeys.length === 8, accrue1 && JSON.stringify(accrue1.accruals) + " keys=" + accrualKeys.length);
const accRec = dbRead()[`accrual:partner-max:${M0}:Virginia Beach`];
check("the current-month accrual record carries the engine's split and the charged basis", !!accRec && accRec.partnerShare === 7255 && accRec.signlShare === 10000 && accRec.countedBasis === "charged" && accRec.state === "accruing", accRec && JSON.stringify(accRec));
const accrue2 = parse(await handler(evt("POST", "/api/admin/command/partners/accrue", { cookie: admin })));
check("re-snapshotting refreshes accruing records and writes no duplicates", !!accrue2 && accrue2.accruals.written === 0 && accrue2.accruals.refreshed === 8 && Object.keys(dbRead()).filter((k) => k.startsWith("accrual:")).length === 8, accrue2 && JSON.stringify(accrue2.accruals));

// ---------- guardrails ----------
const creatorCookie = cookieOf(await handler(evt("POST", "/api/auth/login", { body: { email: "c-1@fixtures.dev", password: PW } })));
const asCreator = await handler(evt("GET", "/api/admin/command/partners", { cookie: creatorCookie }));
check("command partners is Admin-only (creator gets 403)", asCreator.statusCode === 403, `got ${asCreator.statusCode}`);
const asAnon = await handler(evt("GET", "/api/admin/command/partners/partner-max", {}));
check("command partner detail rejects anonymous callers", asAnon.statusCode === 401 || asAnon.statusCode === 403, `got ${asAnon.statusCode}`);
const dealAsCreator = await handler(evt("POST", "/api/admin/partners/partner-solo/deals", { cookie: creatorCookie, body: { terms: {} } }));
check("deal creation is Admin-only", dealAsCreator.statusCode === 403, `got ${dealAsCreator.statusCode}`);

console.log(`\nverify-build56: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
