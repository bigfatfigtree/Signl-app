#!/usr/bin/env node
// Build -109 verification (Tier 3 item 20 + 19b stub + 19c
// materials). Proves, against the real dev server on 9039 with
// a stub Stripe (STRIPE_API_BASE) and a stub Clover
// (CLOVER_API_BASE) on 9041:
//   - payout country derivation end to end: a London creator's
//     Express account is created with country GB, a US
//     creator's with US; a Dubai creator (UAE is not self-serve
//     for Express onboarding per Stripe's own docs) gets the
//     plain concierge answer and NO account is created;
//   - immutability: a creator WITH an account on file never
//     triggers a second account creation (refresh path only),
//     whatever market they are in;
//   - the UK explainer variant: Sig answers a London creator
//     with sort code / Faster Payments / sole-trader words and
//     NO 1099-K, and a US creator with the 1099-K answer and no
//     sort codes; client source carries both variants behind
//     the market-country switch;
//   - UK privacy: the section's wording is IDENTICAL in the
//     site page and the app's Help text (normalized compare);
//     the ICO line renders only when SIGNL_ICO_NUMBER is set
//     (bootstrap carries null here, and no placeholder exists
//     in either file);
//   - the Clover stub: Admin-entered token stored encrypted
//     (round trip through the module's own test seam; the
//     stored record never contains the plain token), sync maps
//     code-carrying orders to counted-proof redevent rows,
//     re-sync is idempotent, paused reads nothing, and the
//     public state never carries the token;
//   - canon locks: stamp -109, founding prices unarmed.
//
// Run: node scripts/verify-build109.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const require2 = createRequire(path.join(root, "netlify/functions/lib/x.js"));
const PORT = 9039;
const STUB = 9041;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b109.dev";
const ADMIN_PASSWORD = ["fixture", "admin", "109"].join("-");

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

class Client {
  constructor() { this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}

// ---------- stubs: Stripe + Clover on one server ----------
const stripeCalls = [];
const stub = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${STUB}`);
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    if (u.pathname === "/v1/accounts" && req.method === "POST") {
      const params = new URLSearchParams(body);
      stripeCalls.push({ path: "/v1/accounts", country: params.get("country"), email: params.get("email") });
      return send(200, { id: `acct_stub_${stripeCalls.length}`, country: params.get("country"), payouts_enabled: false, charges_enabled: false, requirements: { currently_due: ["individual.id_number"] } });
    }
    if (/^\/v1\/accounts\/acct_/.test(u.pathname) && req.method === "GET") {
      stripeCalls.push({ path: u.pathname, country: null });
      return send(200, { id: u.pathname.split("/").pop(), payouts_enabled: true, charges_enabled: true, requirements: { currently_due: [] } });
    }
    if (u.pathname === "/v1/account_links") {
      return send(200, { url: "https://stub-stripe.invalid/onboard" });
    }
    if (/^\/v3\/merchants\/[^/]+\/orders$/.test(u.pathname)) {
      if ((req.headers.authorization || "") !== "Bearer clover-token-109") return send(401, { message: "bad token" });
      return send(200, { elements: [
        { id: "ord-1", state: "paid", total: 4200, createdTime: Date.parse("2026-11-01T12:00:00.000Z"), discounts: [{ name: "SIGNL-ADA-7" }] },
        { id: "ord-2", state: "paid", total: 1800, createdTime: Date.parse("2026-11-01T13:00:00.000Z"), discounts: [] },
        { id: "ord-3", state: "open", total: 9900, createdTime: Date.parse("2026-11-01T14:00:00.000Z"), discounts: [{ name: "SIGNL-BOB-2" }] },
      ] });
    }
    return send(404, { error: "stub 404 " + u.pathname });
  });
});
await new Promise((r) => stub.listen(STUB, "127.0.0.1", r));

// ---------- seeds ----------
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-109", salt, 64).toString("hex");
const SEP = "2026-09-01T00:00:00.000Z";
const data = {};
function mkCreator(id, market, cextra = {}) {
  data[`user:${id}`] = { id, role: "creator", email: `${id}@b109.dev`, name: id, passwordSalt: salt, passwordHash: hash, status: "approved", market, city: market === "London" ? "Shoreditch" : market === "Dubai" ? "JLT" : "Nashville", createdAt: SEP, updatedAt: SEP, creator: { handle: id.replace(/-/g, ""), categories: ["Food & Drink"], localAudiencePct: 60, audienceStack: { instagram: 2000 }, totalAudience: 2000, followerCount: 2000, tierBand: "Locals", paidRate: 120, payouts: { status: "not_started", ready: false, missing: [] }, ...cextra } };
  data[`email:${id}@b109.dev`] = { userId: id };
}
mkCreator("cr-london", "London");
mkCreator("cr-us", "Nashville");
mkCreator("cr-dubai", "Dubai");
mkCreator("cr-existing", "London", { payouts: { status: "pending", ready: false, missing: [], accountId: "acct_existing_1" } });
data["user:biz-clover"] = { id: "biz-clover", role: "business", email: "biz-clover@b109.dev", name: "Clover Cafe", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", createdAt: SEP, updatedAt: SEP, business: { businessName: "Clover Cafe", category: "Restaurant", accessState: "active", posProvider: "clover" } };
data["email:biz-clover@b109.dev"] = { userId: "biz-clover" };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build109-"));
const DB = path.join(tmp, "db.json");
fs.writeFileSync(DB, JSON.stringify(data));
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD, STRIPE_SECRET_KEY: "sk_test_stub_109", STRIPE_API_BASE: `http://127.0.0.1:${STUB}`, SIGNL_TOKEN_ENC_KEY: "fixture-enc-key-109", CLOVER_API_BASE: `http://127.0.0.1:${STUB}` };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_EMAIL_FROM", "SQUARE_APP_ID", "SQUARE_APP_SECRET", "SIGNL_ICO_NUMBER"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
process.on("exit", () => { try { server.kill("SIGKILL"); } catch (e) { /* already gone */ } });
for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/api/bootstrap"); if (r.ok) break; } catch (e) { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }

const admin = new Client();
{ const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }); if (r.status !== 200) throw new Error(`admin login: ${r.status}`); }
async function loginAs(email) {
  const c = new Client();
  const r = await c.req("POST", "/api/auth/login", { email, password: "fixture-pass-109" });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  return c;
}
const dbNow = () => JSON.parse(fs.readFileSync(DB, "utf8"));
const ask = async (client, q) => { const r = await client.req("POST", "/api/sig/ask", { q }); return r.data || {}; };

// ---------- payout country derivation ----------
console.log("Payout countries");
const london = await loginAs("cr-london@b109.dev");
const startLondon = await london.req("POST", "/api/me/payouts/start");
check("the London creator's setup starts", startLondon.status === 200 && !!(startLondon.data && startLondon.data.url), `status ${startLondon.status} ${JSON.stringify(startLondon.data || {}).slice(0, 140)}`);
check("Stripe was asked for a GB account for London", stripeCalls.some((c) => c.path === "/v1/accounts" && c.country === "GB"), JSON.stringify(stripeCalls));
const londonRec = dbNow()["user:cr-london"];
check("the GB account id is stored on the creator", !!(londonRec.creator.payouts && londonRec.creator.payouts.accountId), JSON.stringify(londonRec.creator.payouts || {}));
const us = await loginAs("cr-us@b109.dev");
await us.req("POST", "/api/me/payouts/start");
check("Stripe was asked for a US account for the US creator", stripeCalls.some((c) => c.path === "/v1/accounts" && c.country === "US"), JSON.stringify(stripeCalls));
const before = stripeCalls.filter((c) => c.path === "/v1/accounts").length;
const dubai = await loginAs("cr-dubai@b109.dev");
const startDubai = await dubai.req("POST", "/api/me/payouts/start");
check("the Dubai creator gets the plain concierge answer (UAE is not self-serve)", startDubai.status === 503 && /handled with help from the SIGNL team/.test(startDubai.data.error || ""), `status ${startDubai.status} ${JSON.stringify(startDubai.data || {}).slice(0, 160)}`);
check("NO account was created for Dubai", stripeCalls.filter((c) => c.path === "/v1/accounts").length === before, `${stripeCalls.filter((c) => c.path === "/v1/accounts").length} vs ${before}`);
const existing = await loginAs("cr-existing@b109.dev");
const startExisting = await existing.req("POST", "/api/me/payouts/start");
check("an existing account is refreshed, never recreated", startExisting.status === 200 && stripeCalls.filter((c) => c.path === "/v1/accounts").length === before && stripeCalls.some((c) => c.path === "/v1/accounts/acct_existing_1"), JSON.stringify(stripeCalls.slice(-2)));
const connect = require2("./connect.js");
check("payoutCountryFor unit truth: London GB, Nashville US, Dubai null", connect.payoutCountryFor({ market: "London" }) === "GB" && connect.payoutCountryFor({ market: "Nashville" }) === "US" && connect.payoutCountryFor({ market: "Dubai" }) === null, "");

// ---------- UK explainer via Sig ----------
console.log("UK explainer");
const lonAsk = await ask(london, "What will payout setup ask me?");
check("London Sig: sort code + Faster Payments + sole trader, and NO 1099-K", lonAsk.source === "data" && /sort code/.test(lonAsk.text || "") && /Faster Payments/.test(lonAsk.text || "") && /sole trader/.test(lonAsk.text || "") && !/1099/.test(lonAsk.text || ""), JSON.stringify(lonAsk).slice(0, 300));
const usAsk = await ask(us, "What will payout setup ask me?");
check("US Sig: the 1099-K answer, and no sort codes", usAsk.source === "data" && /1099-K/.test(usAsk.text || "") && !/sort code/.test(usAsk.text || ""), JSON.stringify(usAsk).slice(0, 200));

// ---------- UK privacy parity + ICO slot ----------
console.log("UK privacy");
const sitePrivacy = fs.readFileSync(path.join(root, "..", "signl-site", "privacy.html"), "utf8");
const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const norm = (s) => s.replace(/<[^>]+>/g, " ").replace(/&middot;/g, " ").replace(/\s+/g, " ").trim();
const siteUk = sitePrivacy.slice(sitePrivacy.indexOf('id="uk"'), sitePrivacy.indexOf("Connected creator accounts"));
const shared = "SIGNL runs in the UK through our UK launch partner. When you join SIGNL in a UK market, your information is used under UK data protection law (UK GDPR) on these bases: to run your account and your bookings (contract); to keep the service safe and working (legitimate interests); to meet legal duties (legal obligation); and, for marketing emails, only with your consent, which you can withdraw at any time.";
check("the site page carries the UK section with the shared lawful-bases paragraph", norm(siteUk).includes(norm(shared)), norm(siteUk).slice(0, 200));
check("the app's Help text carries the IDENTICAL paragraph (single wording, two surfaces)", norm(appSrc).includes(norm(shared)), "");
check("the partner-data paragraph matches too (records for the accounts it brought, no other markets)", norm(siteUk).includes("Our UK launch partner sees the records for the businesses and creators it brought to SIGNL in its markets") && norm(appSrc).includes("Our UK launch partner sees the records for the businesses and creators it brought to SIGNL in its markets"), "");
check("neither surface asserts controller/processor labels (unsettled, for counsel)", !/data controller|data processor|joint controller/.test(norm(siteUk)) && !appSrc.includes("joint controller"), "");
const boot = await (await fetch(BASE + "/api/bootstrap")).json();
check("the ICO config slot is empty here and no placeholder number exists anywhere", boot.privacy && boot.privacy.icoNumber === null && !/registration number [A-Z0-9]/.test(sitePrivacy) && !/registration number [A-Z0-9]/.test(appSrc), JSON.stringify(boot.privacy || {}));

// ---------- Clover stub ----------
console.log("Clover stub");
const cloverLib = require2("./clover.js");
process.env.SIGNL_TOKEN_ENC_KEY = "fixture-enc-key-109";
const roundTrip = cloverLib._test.decryptSecret(cloverLib._test.encryptSecret("clover-token-109"));
check("token encryption round-trips through the module's own seam", roundTrip === "clover-token-109", "");
const setRes = await admin.req("POST", "/api/admin/businesses/biz-clover/clover", { merchantId: "MCH-109", token: "clover-token-109" });
check("Admin sets the merchant token; the response carries state only", setRes.status === 200 && setRes.data.clover.connected === true && !JSON.stringify(setRes.data).includes("clover-token-109"), `status ${setRes.status} ${JSON.stringify(setRes.data || {}).slice(0, 160)}`);
const connStored = dbNow()["posconn:biz-clover:clover"];
check("the stored record is encrypted (no plain token at rest)", !!connStored && typeof connStored.tokenEnc === "string" && connStored.tokenEnc.startsWith("enc:v1:") && !JSON.stringify(connStored).includes("clover-token-109"), JSON.stringify(connStored || {}).slice(0, 120));
const sync1 = await admin.req("POST", "/api/admin/businesses/biz-clover/clover-sync");
check("sync reads the stub orders and writes the code-carrying one as a counted row", sync1.status === 200 && sync1.data.status === "ok" && sync1.data.ordersSeen === 3 && sync1.data.rowsWritten === 1, `status ${sync1.status} ${JSON.stringify(sync1.data || {}).slice(0, 180)}`);
const evRows = Object.entries(dbNow()).filter(([k]) => k.startsWith("redevent:"));
check("the counted row sits on the redevent seam, via clover, amount from cents", evRows.length === 1 && evRows[0][1].via === "clover" && evRows[0][1].amount === 42 && evRows[0][1].code === "SIGNL-ADA-7", JSON.stringify(evRows).slice(0, 200));
const sync2 = await admin.req("POST", "/api/admin/businesses/biz-clover/clover-sync");
const evRows2 = Object.entries(dbNow()).filter(([k]) => k.startsWith("redevent:"));
check("re-sync is idempotent (same derived id, still exactly one row)", sync2.status === 200 && evRows2.length === 1, `${evRows2.length} rows`);
const pause = await admin.req("POST", "/api/admin/businesses/biz-clover/clover-pause", { paused: true });
const sync3 = await admin.req("POST", "/api/admin/businesses/biz-clover/clover-sync");
check("a paused connection reads nothing and says so", pause.status === 200 && sync3.status === 200 && sync3.data.status === "paused" && sync3.data.ordersSeen === 0, JSON.stringify(sync3.data || {}));
const getState = await admin.req("GET", "/api/admin/businesses/biz-clover/clover");
check("the public state never carries the token", getState.status === 200 && getState.data.clover.merchantId === "MCH-109" && !JSON.stringify(getState.data).includes("clover-token"), JSON.stringify(getState.data || {}));
const bizSelfSet = await (await loginAs("biz-clover@b109.dev")).req("POST", "/api/admin/businesses/biz-clover/clover", { merchantId: "X", token: "Y" });
check("the token routes are Admin-only", bizSelfSet.status === 403 || bizSelfSet.status === 404, `status ${bizSelfSet.status}`);

// ---------- canon locks ----------
console.log("Canon locks");
check("build stamp is -109 on both sides", fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes("2026.11.05-131") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.05-131"));
const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("founding Stripe prices stay unarmed (no market live for money)", /STRIPE_PRICE_FOUNDING_SELF_SERVICE \|\| ""/.test(routerSrc) && /STRIPE_PRICE_FOUNDING_GROWTH \|\| ""/.test(routerSrc) && /STRIPE_PRICE_FOUNDING_MANAGED \|\| ""/.test(routerSrc));
check("client carries the UK explainer variant + privacy text behind the market switch", appSrc.includes("payoutExplainerUkHtml") && appSrc.includes("isUkUser") && appSrc.includes("ukPrivacyText"));
stub.close();
console.log(`\nbuild109: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("FAILING: " + fails.join("; ")); process.exit(1); }
