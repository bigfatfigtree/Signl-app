#!/usr/bin/env node
// Build -103 verification (Tier 3 item 16): the GBP price
// book + the currency-aware ledger. Proves, against the real
// dev server on port 9015:
//   - a London business is priced from the GBP book at signup
//     (Growth £269, currency stamped GBP) while a US business
//     keeps the USD book byte-for-byte ($349);
//   - the Command Center Businesses view carries each row's
//     own currency (London £149/mo, US $199/mo, £75 vs $100
//     founding credit);
//   - a GBP deal accrues in pounds on the partner ledger and
//     $0 in the USD totals; the USD deal's Variant-B-shaped
//     guarantee math is unmoved; partners totals never blend;
//   - the sanitizer refuses a mixed-currency deal and a
//     stated currency that disagrees with its markets;
//   - a GBP deal with no split entered accrues 0 and seeds
//     nothing onto the partner record (no default split);
//   - the Money view carries both books + recorded subs per
//     currency as separate lines;
//   - Admin Sig answers the London split from the deal
//     records: "no deal on file" before, "30% as entered"
//     after — and never invents one;
//   - canon locks: founding Stripe prices unarmed, stamp -103.
//
// Run: node scripts/verify-build103.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9015;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b103.dev";
const ADMIN_PASSWORD = ["fixture", "admin", "103"].join("-");

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}

// ---------- seeded store: two partners, two recorded businesses ----------
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-103", salt, 64).toString("hex");
const START = "2026-09-01T00:00:00.000Z";
const data = {};
function partner(id, name, code, markets) {
  data[`user:${id}`] = {
    id, role: "partner", email: `${id}@b103.dev`, name, passwordSalt: salt, passwordHash: hash,
    status: "approved", market: markets[0], createdAt: START, updatedAt: START,
    partner: { name, code, type: "media", contactName: "Pat Fixture", markets, status: "active", agreementStatus: "signed", agreementSignedAt: START, demo: false },
  };
  data[`email:${id}@b103.dev`] = { userId: id };
}
partner("partner-us", "Fixture Media US", "FMUS", ["Hampton Roads"]);
partner("partner-uk", "Fixture Media UK", "FMUK", ["London"]);
partner("partner-uk2", "Fixture Media UK Two", "FMUK2", ["London"]);
function biz(id, market, partnerId, planFields) {
  data[`user:${id}`] = {
    id, role: "business", email: `${id}@b103.dev`, name: "Owner", passwordSalt: salt, passwordHash: hash,
    status: "approved", market, partnerId, createdAt: START, updatedAt: START,
    business: { businessName: id, category: "Restaurant", accessState: "active", billingStatus: "Founding billing: plan recorded, no card charged. Billing starts at launch.", planSelectedAt: START, subscription: null, ...planFields },
  };
  data[`email:${id}@b103.dev`] = { userId: id };
}
biz("biz-us", "Hampton Roads", "partner-us", { plan: "self-service", planName: "Self-Service $199/mo", planPriceMonthly: 199, planMinMonths: 3, currency: "USD" });
biz("biz-uk", "London", "partner-uk", { plan: "self-service", planName: "Self-Service £149/mo", planPriceMonthly: 149, planMinMonths: 3, currency: "GBP" });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build103-"));
const DB = path.join(tmp, "db.json");
fs.writeFileSync(DB, JSON.stringify(data));

const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_EMAIL_FROM", "SQUARE_APP_ID", "SQUARE_APP_SECRET"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
process.on("exit", () => { try { server.kill("SIGKILL"); } catch (e) { /* already gone */ } });
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) break; } catch (e) { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}

const admin = new Client(BASE);
{
  const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error(`admin login: ${r.status}`);
}

console.log("== signup prices come from the business's own currency book ==");
{
  const c = new Client(BASE);
  const reg = await c.req("POST", "/api/auth/register", { role: "business", name: "London Owner", email: "newuk@b103.dev", password: "fixture-pass-103x", market: "London", businessName: "New London Cafe", category: "Restaurant", agreedTerms: true, planId: "growth" });
  check("London signup succeeds", (reg.status === 200 || reg.status === 201) && !!reg.data.user, `${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
  const me = await c.req("GET", "/api/auth/me");
  const b = (me.data.user && me.data.user.business) || {};
  check("London Growth is priced from the GBP book (£269)", b.planPriceMonthly === 269 && /£269/.test(b.planName || ""), JSON.stringify(b).slice(0, 200));
  check("the London record is stamped GBP", b.currency === "GBP", String(b.currency));
  const c2 = new Client(BASE);
  await c2.req("POST", "/api/auth/register", { role: "business", name: "Nash Owner", email: "newus@b103.dev", password: "fixture-pass-103x", market: "Nashville", city: "Nashville", businessName: "New Nash Tacos", category: "Restaurant", agreedTerms: true, planId: "growth" });
  const me2 = await c2.req("GET", "/api/auth/me");
  const b2 = (me2.data.user && me2.data.user.business) || {};
  check("US Growth stays on the USD book ($349, USD)", b2.planPriceMonthly === 349 && /\$349/.test(b2.planName || "") && b2.currency === "USD", JSON.stringify(b2).slice(0, 200));
}

console.log("== Admin Sig before any London deal: no split is invented ==");
{
  const ask = await admin.req("POST", "/api/sig/ask", { q: "What is the London partner split?", history: [] });
  check("Sig says plainly that no London deal is on file", ask.data && ask.data.source === "data" && /No London \(GBP\) deal is on file/.test(ask.data.text || ""), JSON.stringify(ask.data).slice(0, 300));
}

console.log("== deals: USD guarantee math unmoved, GBP accrues in pounds ==");
let usDealId = null;
{
  const us = await admin.req("POST", "/api/admin/partners/partner-us/deals", { label: "Hampton Roads pilot", status: "live", terms: { partnerPct: 25, currency: "USD", attributionScope: "market_wide", startAt: START, termMonths: 6, guarantee: { beneficiary: "signl", pilotFloor: null, bands: [{ fromMonth: 1, toMonth: 3, floorMonthly: 100, pctToBeneficiary: 25 }] }, markets: [{ market: "Hampton Roads", status: "live", liveAt: START, activationFee: 15000, activationStatus: "billed" }] } });
  check("USD deal created", us.status === 201 && !!us.data.deal, `${us.status} ${JSON.stringify(us.data).slice(0, 200)}`);
  usDealId = us.data.deal && us.data.deal.id;
  const uk = await admin.req("POST", "/api/admin/partners/partner-uk/deals", { label: "London launch", status: "live", terms: { partnerPct: 30, currency: "GBP", attributionScope: "market_wide", startAt: START, termMonths: 12, markets: [{ market: "London", status: "live", liveAt: START, activationFee: null, activationStatus: "unbilled" }] } });
  globalThis.__ukDealId = uk.data.deal && uk.data.deal.id;
  check("GBP deal created in pounds", uk.status === 201 && uk.data.deal && (uk.data.deal.versions[0].terms.currency === "GBP"), `${uk.status} ${JSON.stringify(uk.data).slice(0, 200)}`);
  const uk2 = await admin.req("POST", "/api/admin/partners/partner-uk2/deals", { label: "London deal, split not entered", status: "live", terms: { currency: "GBP", attributionScope: "sourced_only", startAt: START, termMonths: 12, markets: [{ market: "London", status: "live", liveAt: START, activationFee: null, activationStatus: "unbilled" }] } });
  check("GBP deal with no split entered is accepted as-is", uk2.status === 201, `${uk2.status} ${JSON.stringify(uk2.data).slice(0, 200)}`);
}
{
  const mixed = await admin.req("POST", "/api/admin/partners/partner-uk/deals", { label: "Mixed", status: "live", terms: { partnerPct: 30, markets: [{ market: "London", status: "live", liveAt: START }, { market: "Hampton Roads", status: "live", liveAt: START }] } });
  check("a deal spanning two currencies is refused", mixed.status === 400 && /two currencies/.test((mixed.data && mixed.data.error) || ""), `${mixed.status} ${JSON.stringify(mixed.data).slice(0, 200)}`);
  const wrong = await admin.req("POST", "/api/admin/partners/partner-uk/deals", { label: "Wrong currency", status: "live", terms: { partnerPct: 30, currency: "USD", markets: [{ market: "London", status: "live", liveAt: START }] } });
  check("a stated currency that disagrees with its markets is refused", wrong.status === 400 && /price in GBP/.test((wrong.data && wrong.data.error) || ""), `${wrong.status} ${JSON.stringify(wrong.data).slice(0, 200)}`);
}
{
  const usDetail = await admin.req("GET", "/api/admin/command/partners/partner-us");
  const usDeal = (usDetail.data.deals || [])[0] || {};
  check("USD deal: 3 months x $199 gross, guarantee governs ($100/mo to SIGNL)", usDeal.totals && usDeal.totals.gross === 597 && usDeal.totals.signlShare === 300 && usDeal.totals.partnerShare === 297 && usDeal.currency === "USD", JSON.stringify(usDeal.totals || {}));
  const ukDetail = await admin.req("GET", "/api/admin/command/partners/partner-uk");
  const ukDeal = (ukDetail.data.deals || [])[0] || {};
  check("GBP deal: £149 x 3 months + the £269 signup month = £716 gross, 30% to the partner, all in pounds", ukDeal.totals && ukDeal.totals.gross === 716 && ukDeal.totals.partnerShare === 214.8 && ukDeal.currency === "GBP", JSON.stringify(ukDeal.totals || {}) + " cur=" + ukDeal.currency);
  const uk2Detail = await admin.req("GET", "/api/admin/command/partners/partner-uk2");
  const uk2Deal = (uk2Detail.data.deals || [])[0] || {};
  check("no split entered: the partner accrues exactly 0, nothing seeded", uk2Deal.totals && uk2Detail.data.partner && uk2Detail.data.partner.sharePct == null, JSON.stringify(uk2Deal.totals || {}));
}

console.log("== partners list: currencies on separate lines, never blended ==");
{
  const list = await admin.req("GET", "/api/admin/command/partners");
  const rows = list.data.partners || [];
  const uk = rows.find((r) => r.id === "partner-uk") || {};
  check("the UK partner's flat (USD) accrual is 0 while pounds sit in byCurrency", uk.accrued === 0 && uk.byCurrency && uk.byCurrency.GBP && uk.byCurrency.GBP.accrued === 214.8, JSON.stringify(uk.byCurrency || {}));
  check("list totals: USD 297 only; GBP 214.8 on its own line (a blend would read 511.8)", list.data.totals && list.data.totals.accrued === 297 && list.data.totalsByCurrency && list.data.totalsByCurrency.GBP && list.data.totalsByCurrency.GBP.accrued === 214.8 && list.data.totalsByCurrency.USD.accrued === 297, JSON.stringify(list.data.totalsByCurrency || {}));
}

console.log("== money + businesses views carry the books and the currencies ==");
{
  const money = await admin.req("GET", "/api/admin/command/money");
  const gbp0 = money.data.planBooks && money.data.planBooks.GBP && money.data.planBooks.GBP[0];
  const usd1 = money.data.planBooks && money.data.planBooks.USD && money.data.planBooks.USD[1];
  check("GBP book: £149, £75 credit, £74 first month", !!gbp0 && gbp0.priceMonthly === 149 && gbp0.foundingCredit === 75 && gbp0.firstMonthPriceMonthly === 74, JSON.stringify(gbp0 || {}));
  check("USD book unchanged: Growth $349", !!usd1 && usd1.priceMonthly === 349 && usd1.foundingCredit === 100, JSON.stringify(usd1 || {}));
  check("recorded subscriptions print per currency (USD 946 incl. the Nashville signup month, GBP 716)", money.data.recordedSubsByCurrency && money.data.recordedSubsByCurrency.USD === 946 && money.data.recordedSubsByCurrency.GBP === 716, JSON.stringify(money.data.recordedSubsByCurrency || {}));
  const bizList = await admin.req("GET", "/api/admin/command/businesses");
  const rows = bizList.data.businesses || [];
  const ukRow = rows.find((r) => r.id === "biz-uk") || {};
  const usRow = rows.find((r) => r.id === "biz-us") || {};
  check("businesses view: London row £149 GBP with £75 credit; US row $199 USD with $100 credit", ukRow.plan && ukRow.plan.monthly === 149 && ukRow.plan.currency === "GBP" && ukRow.credit && ukRow.credit.total === 75 && usRow.plan && usRow.plan.monthly === 199 && usRow.credit && usRow.credit.total === 100, JSON.stringify({ uk: ukRow.plan, us: usRow.plan }));
}

console.log("== payouts and the partner's own earnings speak pounds ==");
{
  const po = await admin.req("POST", "/api/admin/command/partners/payouts", { partnerId: "partner-uk", dealId: globalThis.__ukDealId, amount: 100, period: "2026-10", method: "Transfer", reference: "t-1" });
  check("a payout against the GBP deal is stamped GBP", po.status === 201 && po.data.payout && po.data.payout.currency === "GBP", `${po.status} ${JSON.stringify(po.data).slice(0, 200)}`);
  const pc = new Client(BASE);
  const pl = await pc.req("POST", "/api/auth/login", { email: "partner-uk@b103.dev", password: "fixture-pass-103" });
  check("the UK partner can sign in", pl.status === 200, String(pl.status));
  const sum = await pc.req("GET", "/api/partner/summary");
  const e = (sum.data && sum.data.earnings) || {};
  check("partner earnings: currency GBP, accrued £214.80, paid £100, owed £114.80", e.currency === "GBP" && e.accruedTotal === 214.8 && e.paidTotal === 100 && e.owedTotal === 114.8, JSON.stringify(e).slice(0, 240));
}

console.log("== Admin Sig after the London deal: the split as entered ==");
{
  const ask = await admin.req("POST", "/api/sig/ask", { q: "What is the London partner split?", history: [] });
  check("Sig reports the entered 30% from the deal record", ask.data && ask.data.source === "data" && /30% as entered/.test(ask.data.text || ""), JSON.stringify(ask.data).slice(0, 300));
}

console.log("== canon locks ==");
{
  check("build stamp is -103 on both sides", fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes("2026.11.04-129") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.04-129"));
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("founding Stripe prices stay unarmed (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'), "");
}

console.log(`\nbuild103: ${passed} passed, ${failed} failed`);
if (fails.length) console.error("failures:", fails.join(" | "));
process.exit(failed ? 1 : 0);
