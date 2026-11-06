#!/usr/bin/env node
// Build -118 verification (Jeff, 2026-11-03: "make Canada
// England New Zealand translate to their currency"): every
// market in England, Canada and New Zealand prices in its own
// currency — the machinery Build -89 built for London (currency
// override on the market entry + a founding price book per
// currency) now covers all three countries.
// Proves:
//   S. source pins: the stamp; the overrides in markets.js
//      (Manchester GBP, Toronto + Montreal CAD, the NZ trio
//      NZD); the NZD_PLANS / CAD_PLANS books; the four-book
//      PLAN_BOOK; founding Stripe prices still unarmed.
//   U. unit: currencyForMarket resolves GBP / CAD / NZD with
//      the pinned floors (London AND Manchester £40, Canada
//      CA$70, NZ NZ$90) and Nashville stays USD $50; the roster
//      did not move (45 markets / 13 countries; Canada is the
//      two markets already on it — Toronto and Montreal — no
//      market was added by a currency build); the converted
//      books are pinned to the exact table: at USD/NZD 1.78
//      (NZD/USD spot 0.5626, 2026-11-03) NZ$349 / NZ$619 /
//      NZ$1,239 with a NZ$175 credit and first months NZ$174 /
//      NZ$444 / NZ$1,064; at USD/CAD 1.40 (spot 1.397) CA$279 /
//      CA$489 / CA$979 with a CA$140 credit and first months
//      CA$139 / CA$349 / CA$839; the GBP and USD books are
//      byte-identical to before; first month = price - credit
//      in both new books; plan ids align across all four books.
//   H. server: claims land in Manchester / Auckland / Toronto
//      and the signed-in creator's rate-range reads its own
//      floor + currency (£40 GBP, NZ$90 NZD, CA$70 CAD);
//      business signups price from their own books (Manchester
//      Growth £269 stamped GBP, Auckland Self-Service NZ$349
//      stamped NZD, Toronto Growth CA$489 stamped CAD,
//      Nashville Growth $349 USD as the control); the Admin
//      Money view carries all four plan books on separate
//      lines; the Admin markets list is still 45 rows.
//
// Run: node scripts/verify-build118.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const require = createRequire(import.meta.url);
const { MARKETS, currencyForMarket, paidFloorForMarket, planBookFor, planInBook, PLANS, GBP_PLANS, NZD_PLANS, CAD_PLANS, PLAN_BOOK } = require("../netlify/functions/lib/markets.js");

const PORT = 9055;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-build118-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-build118-${Date.now()}.json`);

let passed = 0;
let failed = 0;
let currentPart = "boot";
const failures = [];
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; failures.push(name); console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// ---------- S: source pins ----------
part("S: source pins");
const marketsJs = fs.readFileSync(path.join(root, "netlify/functions/lib/markets.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("stamp is 2026.11.06-138 on both sides", indexHtml.includes("2026.11.06-138") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.06-138"));
check("markets.js carries the Manchester GBP override", /id: "manchester",[\s\S]{0,600}?currency: "GBP"/.test(marketsJs));
check("markets.js carries the Toronto + Montreal CAD overrides", /id: "toronto",[\s\S]{0,600}?currency: "CAD"/.test(marketsJs) && /id: "montreal",[\s\S]{0,600}?currency: "CAD"/.test(marketsJs));
check("markets.js carries the NZ trio NZD overrides", ["auckland", "wellington", "christchurch"].every((id) => new RegExp(`id: "${id}",[\\s\\S]{0,900}?currency: "NZD"`).test(marketsJs)));
check("markets.js defines NZD_PLANS and CAD_PLANS in a four-book PLAN_BOOK", marketsJs.includes("const NZD_PLANS") && marketsJs.includes("const CAD_PLANS") && marketsJs.includes("PLAN_BOOK = { USD: PLANS, GBP: GBP_PLANS, NZD: NZD_PLANS, CAD: CAD_PLANS }"));
check("founding Stripe prices stay unarmed (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'));

// ---------- U: unit ----------
part("U: currency resolution + books");
const cur = (n) => currencyForMarket(n);
check("England is GBP end to end: London AND Manchester resolve GBP / £ / floor 40",
  ["London", "Manchester"].every((n) => { const c = cur(n); return c.code === "GBP" && c.symbol === "£" && c.paidFloor === 40; }) && paidFloorForMarket("Manchester") === 40);
check("Canada resolves CAD / $ / floor 70 in both markets on the roster",
  ["Toronto", "Montreal"].every((n) => { const c = cur(n); return c.code === "CAD" && c.symbol === "$" && c.paidFloor === 70; }) && paidFloorForMarket("Toronto") === 70);
check("New Zealand resolves NZD / $ / floor 90 in all three markets",
  ["Auckland", "Wellington", "Christchurch"].every((n) => { const c = cur(n); return c.code === "NZD" && c.symbol === "$" && c.paidFloor === 90; }) && paidFloorForMarket("Auckland") === 90);
check("the USD control is unmoved: Nashville USD / $ / floor 50", (() => { const c = cur("Nashville"); return c.code === "USD" && c.symbol === "$" && c.paidFloor === 50; })());
check("roster did not move: 45 markets, 13 countries, Canada is exactly Toronto + Montreal (pre-existing)",
  MARKETS.length === 45 && new Set(MARKETS.map((m) => m.country)).size === 13 &&
  JSON.stringify(MARKETS.filter((m) => m.country === "Canada").map((m) => m.name).sort()) === JSON.stringify(["Montreal", "Toronto"]),
  JSON.stringify(MARKETS.filter((m) => m.country === "Canada").map((m) => m.name)));
check("no UK market resolves to USD anywhere in the roster",
  MARKETS.filter((m) => m.country === "United Kingdom").every((m) => cur(m.name).code === "GBP"));
const bookShape = (book) => book.map((p) => [p.id, p.priceMonthly, p.foundingCredit, p.firstMonthPriceMonthly, p.minMonths, p.visitsPerMonth]);
check("NZD book is the pinned table (USD/NZD 1.78): 349/619/1239, credit 175, firsts 174/444/1064",
  JSON.stringify(bookShape(NZD_PLANS)) === JSON.stringify([["self-service", 349, 175, 174, 3, 5], ["growth", 619, 175, 444, 3, 10], ["managed", 1239, 175, 1064, 3, 20]]),
  JSON.stringify(bookShape(NZD_PLANS)));
check("CAD book is the pinned table (USD/CAD 1.40): 279/489/979, credit 140, firsts 139/349/839",
  JSON.stringify(bookShape(CAD_PLANS)) === JSON.stringify([["self-service", 279, 140, 139, 3, 5], ["growth", 489, 140, 349, 3, 10], ["managed", 979, 140, 839, 3, 20]]),
  JSON.stringify(bookShape(CAD_PLANS)));
check("GBP book is untouched: 149/269/549, credit 75, firsts 74/194/474",
  JSON.stringify(bookShape(GBP_PLANS)) === JSON.stringify([["self-service", 149, 75, 74, 3, 5], ["growth", 269, 75, 194, 3, 10], ["managed", 549, 75, 474, 3, 20]]));
check("USD book is untouched: 199/349/699, credit 100, firsts 99/249/599",
  JSON.stringify(bookShape(PLANS)) === JSON.stringify([["self-service", 199, 100, 99, 3, 5], ["growth", 349, 100, 249, 3, 10], ["managed", 699, 100, 599, 3, 20]]));
check("first month = price - founding credit in both new books",
  [...NZD_PLANS, ...CAD_PLANS].every((p) => p.firstMonthPriceMonthly === p.priceMonthly - p.foundingCredit));
check("PLAN_BOOK holds exactly the four books and plan ids align across all of them",
  JSON.stringify(Object.keys(PLAN_BOOK).sort()) === JSON.stringify(["CAD", "GBP", "NZD", "USD"]) &&
  ["USD", "GBP", "NZD", "CAD"].every((c) => ["self-service", "growth", "managed"].every((id) => !!planInBook(id, c))) &&
  planBookFor("NZD") === NZD_PLANS && planBookFor("CAD") === CAD_PLANS && planBookFor("GBP") === GBP_PLANS && planBookFor("USD") === PLANS);

// ---------- H: server ----------
part("H: server");
function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data };
  };
}
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: root,
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, [["ADMIN", "PASSWORD"].join("_")]: ADMIN_PW, APP_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const boot = await client()("GET", "/api/bootstrap");
  check("bootstrap still serves 45 markets", (boot.data.markets || []).length === 45, String((boot.data.markets || []).length));

  // Admin first: rate-range reads need APPROVED creators (the
  // Build -89 pattern — approve through the review endpoint).
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  // Creator claims, one per currency, then the rate-range read
  // the creator's own screens run on.
  const claimAndRange = async (tag, market, want) => {
    const c = client();
    const reg = await c("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: `${tag}@fixtures.dev`, password: "claim-" + "pass-1234", market, handle: tag, ...AGREE });
    if (reg.status === 201 && reg.data.user) await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
    const rr = await c("GET", "/api/me/rate-range");
    const d = rr.data || {};
    return { reg, ok: reg.status === 201 && d.floor === want.floor && d.currency === want.code && d.currencySymbol === want.symbol, got: d };
  };
  const mcr = await claimAndRange("mcr118", "Manchester", { floor: 40, code: "GBP", symbol: "£" });
  check("Manchester creator: claim lands, rate-range reads £40 / GBP", mcr.ok, JSON.stringify(mcr.got));
  const akl = await claimAndRange("akl118", "Auckland", { floor: 90, code: "NZD", symbol: "$" });
  check("Auckland creator: claim lands, rate-range reads NZ$90 floor / NZD", akl.ok, JSON.stringify(akl.got));
  const tor = await claimAndRange("tor118", "Toronto", { floor: 70, code: "CAD", symbol: "$" });
  check("Toronto creator: claim lands, rate-range reads CA$70 floor / CAD", tor.ok, JSON.stringify(tor.got));

  // Business signups price from their own currency book.
  const bizSignup = async (tag, market, planId) => {
    const c = client();
    const reg = await c("POST", "/api/auth/register", { role: "business", name: `${tag} Owner`, email: `${tag}@b118.dev`, password: "fixture-pass-118x", market, businessName: `${tag} Cafe`, category: "Restaurant", agreedTerms: true, planId });
    const me = await c("GET", "/api/auth/me");
    return { reg, b: (me.data.user && me.data.user.business) || {} };
  };
  const mcrBiz = await bizSignup("mcrbiz", "Manchester", "growth");
  check("Manchester business: Growth priced from the GBP book (£269, stamped GBP)",
    mcrBiz.b.planPriceMonthly === 269 && mcrBiz.b.currency === "GBP" && /£269/.test(mcrBiz.b.planName || ""), JSON.stringify(mcrBiz.b).slice(0, 220));
  const aklBiz = await bizSignup("aklbiz", "Auckland", "self-service");
  check("Auckland business: Self-Service priced from the NZD book (NZ$349, stamped NZD)",
    aklBiz.b.planPriceMonthly === 349 && aklBiz.b.currency === "NZD", JSON.stringify(aklBiz.b).slice(0, 220));
  const torBiz = await bizSignup("torbiz", "Toronto", "growth");
  check("Toronto business: Growth priced from the CAD book (CA$489, stamped CAD)",
    torBiz.b.planPriceMonthly === 489 && torBiz.b.currency === "CAD", JSON.stringify(torBiz.b).slice(0, 220));
  const nashBiz = await bizSignup("nashbiz", "Nashville", "growth");
  check("control: Nashville business stays on the USD book ($349, stamped USD)",
    nashBiz.b.planPriceMonthly === 349 && nashBiz.b.currency === "USD" && /\$349/.test(nashBiz.b.planName || ""), JSON.stringify(nashBiz.b).slice(0, 220));

  const money = await admin("GET", "/api/admin/command/money");
  const books = (money.data && money.data.planBooks) || {};
  check("Admin Money view carries all four plan books",
    ["USD", "GBP", "NZD", "CAD"].every((c) => Array.isArray(books[c]) && books[c].length === 3), JSON.stringify(Object.keys(books)));
  check("Admin NZD book: NZ$349 with NZ$175 credit and NZ$174 first month",
    !!books.NZD && books.NZD[0].priceMonthly === 349 && books.NZD[0].foundingCredit === 175 && books.NZD[0].firstMonthPriceMonthly === 174, JSON.stringify(books.NZD && books.NZD[0]));
  check("Admin CAD book: Growth CA$489 with CA$140 credit and CA$349 first month",
    !!books.CAD && books.CAD[1].priceMonthly === 489 && books.CAD[1].foundingCredit === 140 && books.CAD[1].firstMonthPriceMonthly === 349, JSON.stringify(books.CAD && books.CAD[1]));
  check("Admin GBP + USD books unchanged (£149 Self-Service, $349 Growth)",
    !!books.GBP && books.GBP[0].priceMonthly === 149 && !!books.USD && books.USD[1].priceMonthly === 349);
  const marketsRes = await admin("GET", "/api/admin/markets");
  const rows = marketsRes.data.markets || [];
  check("admin markets list is still 45 rows (no market added by a currency build)", rows.length === 45, String(rows.length));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-build118: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
