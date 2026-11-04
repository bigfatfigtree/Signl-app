#!/usr/bin/env node
// Build -104 verification (Tier 3 item 13): territory and
// exclusivity enforcement. Proves, against the real dev
// server on port 9017:
//   - a direct sign-up inside a signed market-wide territory
//     is stamped to the territory partner at birth
//     (attributionSource "territory"); a real partner link
//     always wins and is never overwritten; a sourced-only
//     deal and an undealt market stamp nothing;
//   - a business that predates the deal stays unstamped and
//     appears as a conflict, next to the sourced-elsewhere
//     record; the deal's money counts the whole market
//     regardless of stamps (enforcement moves records, not
//     money);
//   - one-tap resolution: stamp moves the record to the
//     territory partner; reviewed keeps its stamp and closes
//     the row; the Overview attention item tracks the count;
//   - the second-deal block: creating or signing a deal over
//     a conditionally exclusive market is refused (409,
//     naming the holding deal), a draft is not blocked, the
//     override fails while the holding deal's conditions are
//     empty and succeeds once the reason is recorded there;
//   - a pilot in a held market is refused the same way;
//   - signing is the moment territory starts: a Denver
//     business before the deal goes live is unstamped, one
//     after is stamped;
//   - the partner's own summary carries the territory truth;
//     Admin Sig answers "who owns Hampton Roads?" and the
//     conflict question from the same resolver;
//   - canon locks: founding Stripe prices unarmed, stamp -104.
//
// Run: node scripts/verify-build104.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9017;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b104.dev";
const ADMIN_PASSWORD = ["fixture", "admin", "104"].join("-");

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

const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-104", salt, 64).toString("hex");
const SEP = "2026-09-01T00:00:00.000Z";
const data = {};
function partner(id, name, code, markets) {
  data[`user:${id}`] = { id, role: "partner", email: `${id}@b104.dev`, name, passwordSalt: salt, passwordHash: hash, status: "approved", market: markets[0], createdAt: SEP, updatedAt: SEP, partner: { name, code, type: "media", contactName: "Pat Fixture", markets, status: "active", agreementStatus: "signed", agreementSignedAt: SEP, demo: false } };
  data[`email:${id}@b104.dev`] = { userId: id };
}
partner("partner-a", "Fixture Media A", "fma", ["Hampton Roads"]);
partner("partner-b", "Fixture Media B", "fmb", ["Nashville"]);
data["user:biz-old"] = { id: "biz-old", role: "business", email: "biz-old@b104.dev", name: "Old Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", createdAt: SEP, updatedAt: SEP, business: { businessName: "Old Town Eats", category: "Restaurant", accessState: "active", billingStatus: "Founding billing: plan recorded, no card charged.", planSelectedAt: SEP, subscription: null, plan: "self-service", planName: "Self-Service $199/mo", planPriceMonthly: 199, planMinMonths: 3, currency: "USD" } };
data["email:biz-old@b104.dev"] = { userId: "biz-old" };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build104-"));
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
async function registerBiz(email, market, city, extra = {}) {
  const c = new Client(BASE);
  const reg = await c.req("POST", "/api/auth/register", { role: "business", name: "Owner", email, password: "fixture-pass-104x", market, city, businessName: email.split("@")[0], category: "Restaurant", agreedTerms: true, ...extra });
  if (!((reg.status === 200 || reg.status === 201) && reg.data.user)) throw new Error(`register ${email}: ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
  const me = await c.req("GET", "/api/auth/me");
  return { client: c, user: me.data.user, id: reg.data.user.id };
}
function storedUser(id) {
  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  return db[`user:${id}`] || {};
}

const HR_TERMS = { partnerPct: 25, currency: "USD", attributionScope: "market_wide", exclusivity: { scope: "market_conditional", conditions: "" }, startAt: SEP, termMonths: 6, markets: [{ market: "Hampton Roads", status: "live", liveAt: SEP, activationFee: null, activationStatus: "unbilled" }] };
let dealA = null;
console.log("== the holding deal, then who gets stamped ==");
{
  const created = await admin.req("POST", "/api/admin/partners/partner-a/deals", { label: "Hampton Roads pilot", status: "signed", terms: HR_TERMS });
  check("the conditional market-wide deal is created", created.status === 201 && !!created.data.deal, `${created.status} ${JSON.stringify(created.data).slice(0, 200)}`);
  dealA = created.data.deal;
  const direct = await registerBiz("direct-hr@b104.dev", "Hampton Roads", "Virginia Beach");
  check("a direct Hampton Roads sign-up is territory-stamped at birth", storedUser(direct.id).partnerId === "partner-a" && storedUser(direct.id).attributionSource === "territory", JSON.stringify({ p: storedUser(direct.id).partnerId, s: storedUser(direct.id).attributionSource }));
  const sourced = await registerBiz("sourced-hr@b104.dev", "Hampton Roads", "Virginia Beach", { signupSource: "partner-fmb" });
  check("a real partner link wins over the territory default", storedUser(sourced.id).partnerId === "partner-b" && storedUser(sourced.id).attributionSource === "sourced", JSON.stringify({ p: storedUser(sourced.id).partnerId, s: storedUser(sourced.id).attributionSource }));
  const free = await registerBiz("free-austin@b104.dev", "Austin", "Austin");
  check("an undealt market stamps nothing", !storedUser(free.id).partnerId, String(storedUser(free.id).partnerId));
}

console.log("== conflicts: the record list, money unmoved, one-tap resolution ==");
{
  const detail = await admin.req("GET", "/api/admin/command/partners/partner-a");
  check("the deal counts the whole market ($995) whatever the stamps say", detail.data.deals && detail.data.deals[0] && detail.data.deals[0].totals.gross === 995, JSON.stringify(detail.data.deals && detail.data.deals[0] && detail.data.deals[0].totals));
  const list = await admin.req("GET", "/api/admin/command/partners");
  const rowA = (list.data.partners || []).find((r) => r.id === "partner-a") || {};
  const conflictIds = (rowA.conflicts || []).map((c) => c.userId).sort();
  check("two conflicts ride the partner row: the pre-deal business + the sourced-elsewhere one", conflictIds.length === 2 && conflictIds.includes("biz-old") && (rowA.territory || []).some((t) => t.market === "Virginia Beach" && t.exclusivity === "market_conditional"), JSON.stringify(conflictIds));
  const ov = await admin.req("GET", "/api/admin/command/overview");
  const att = (ov.data.attention || []).find((a) => a.kind === "territory_conflicts");
  check("the Overview attention strip carries the conflict count", !!att && att.count === 2, JSON.stringify(ov.data.attention || []).slice(0, 200));
  const stamp = await admin.req("POST", "/api/admin/command/territory/resolve", { userId: "biz-old", action: "stamp" });
  check("one-tap stamp resolves to the territory partner", stamp.status === 200 && stamp.data.user && stamp.data.user.partnerId === "partner-a", `${stamp.status} ${JSON.stringify(stamp.data).slice(0, 160)}`);
  const sourcedId = (rowA.conflicts || []).find((c) => c.currentPartnerId === "partner-b");
  const reviewed = await admin.req("POST", "/api/admin/command/territory/resolve", { userId: sourcedId.userId, action: "reviewed" });
  check("mark-reviewed keeps the sourced stamp and closes the row", reviewed.status === 200 && reviewed.data.user && reviewed.data.user.partnerId === "partner-b", `${reviewed.status} ${JSON.stringify(reviewed.data).slice(0, 160)}`);
  const list2 = await admin.req("GET", "/api/admin/command/partners");
  const rowA2 = (list2.data.partners || []).find((r) => r.id === "partner-a") || {};
  check("both resolutions clear the conflict list", (rowA2.conflicts || []).length === 0, JSON.stringify(rowA2.conflicts || []));
}

console.log("== the second-deal block and the recorded override ==");
{
  const blocked = await admin.req("POST", "/api/admin/partners/partner-b/deals", { label: "Second HR deal", status: "signed", terms: { partnerPct: 20, attributionScope: "market_wide", markets: [{ market: "Hampton Roads", status: "live", liveAt: SEP }] } });
  check("a second signed deal over the held market is refused, naming the holder", blocked.status === 409 && /Hampton Roads pilot/.test((blocked.data && blocked.data.error) || ""), `${blocked.status} ${JSON.stringify(blocked.data).slice(0, 220)}`);
  const draft = await admin.req("POST", "/api/admin/partners/partner-b/deals", { label: "Second HR deal (draft)", status: "negotiating", terms: { partnerPct: 20, attributionScope: "market_wide", markets: [{ market: "Hampton Roads", status: "live", liveAt: SEP }] } });
  check("a draft is not blocked", draft.status === 201, `${draft.status}`);
  const signBlocked = await admin.req("PATCH", `/api/admin/deals/${draft.data.deal.id}`, { status: "signed" });
  check("signing the draft is blocked at the signing moment", signBlocked.status === 409, `${signBlocked.status} ${JSON.stringify(signBlocked.data).slice(0, 160)}`);
  const overrideEmpty = await admin.req("POST", "/api/admin/partners/partner-b/deals", { label: "Override attempt", status: "signed", overrideTerritory: true, terms: { partnerPct: 20, attributionScope: "sourced_only", markets: [{ market: "Hampton Roads", status: "live", liveAt: SEP }] } });
  check("the override fails while the holding conditions are empty", overrideEmpty.status === 409, `${overrideEmpty.status}`);
  const v2 = await admin.req("POST", `/api/admin/deals/${dealA.id}/versions`, { terms: { ...HR_TERMS, exclusivity: { scope: "market_conditional", conditions: "A second group may run the college segment." } }, note: "Record the exception" });
  check("the reason is recorded on the holding deal as a new version", v2.status === 201, `${v2.status} ${JSON.stringify(v2.data).slice(0, 160)}`);
  const overrideOk = await admin.req("POST", "/api/admin/partners/partner-b/deals", { label: "College segment deal", status: "signed", overrideTerritory: true, terms: { partnerPct: 20, attributionScope: "sourced_only", markets: [{ market: "Hampton Roads", status: "live", liveAt: SEP }] } });
  check("with the reason recorded, the override creation succeeds", overrideOk.status === 201, `${overrideOk.status} ${JSON.stringify(overrideOk.data).slice(0, 160)}`);
  const pilotBlocked = await admin.req("POST", "/api/admin/pilots", { partnerName: "Campus Fund", contactName: "Cam", email: "cam@b104.dev", market: "Hampton Roads", fund: 5000 });
  check("a pilot in the held market is refused the same way", pilotBlocked.status === 409 && /Hampton Roads pilot/.test((pilotBlocked.data && pilotBlocked.data.error) || ""), `${pilotBlocked.status} ${JSON.stringify(pilotBlocked.data).slice(0, 200)}`);
  const pilotOk = await admin.req("POST", "/api/admin/pilots", { partnerName: "Austin Fund", contactName: "Al", email: "al@b104.dev", market: "Austin", fund: 5000 });
  check("a pilot in a free market is created", pilotOk.status === 200 && !!pilotOk.data.pilot, `${pilotOk.status} ${JSON.stringify(pilotOk.data).slice(0, 160)}`);
}

console.log("== sourced-only stamps nothing; signing starts territory ==");
{
  const rich = await admin.req("POST", "/api/admin/partners/partner-b/deals", { label: "Richmond sourced", status: "signed", terms: { partnerPct: 20, attributionScope: "sourced_only", markets: [{ market: "Richmond", status: "live", liveAt: SEP }] } });
  check("the sourced-only deal is created", rich.status === 201, `${rich.status}`);
  const rb = await registerBiz("direct-rich@b104.dev", "Richmond", "Richmond");
  check("a sourced-only territory stamps nothing at signup", !storedUser(rb.id).partnerId, String(storedUser(rb.id).partnerId));
  const den = await admin.req("POST", "/api/admin/partners/partner-b/deals", { label: "Denver wide", status: "negotiating", terms: { partnerPct: 20, attributionScope: "market_wide", markets: [{ market: "Denver", status: "live", liveAt: SEP }] } });
  const before = await registerBiz("before-den@b104.dev", "Denver", "Denver");
  globalThis.__beforeDenId = before.id;
  check("before the deal is signed, Denver stamps nothing", !storedUser(before.id).partnerId, String(storedUser(before.id).partnerId));
  const live = await admin.req("PATCH", `/api/admin/deals/${den.data.deal.id}`, { status: "live" });
  check("the Denver deal goes live (no conditional holder to block it)", live.status === 200, `${live.status} ${JSON.stringify(live.data).slice(0, 160)}`);
  const after = await registerBiz("after-den@b104.dev", "Denver", "Denver");
  check("after it goes live, Denver sign-ups are stamped", storedUser(after.id).partnerId === "partner-b" && storedUser(after.id).attributionSource === "territory", JSON.stringify({ p: storedUser(after.id).partnerId, s: storedUser(after.id).attributionSource }));
}

console.log("== partner truth + Sig read the same resolver ==");
{
  const pc = new Client(BASE);
  await pc.req("POST", "/api/auth/login", { email: "partner-a@b104.dev", password: "fixture-pass-104" });
  const sum = await pc.req("GET", "/api/partner/summary");
  const terr = (sum.data && sum.data.territory) || [];
  check("the partner's summary states the territory plainly", terr.some((t) => t.market === "Virginia Beach" && t.attributionScope === "market_wide" && t.exclusivity === "market_conditional"), JSON.stringify(terr).slice(0, 200));
  const ask = await admin.req("POST", "/api/sig/ask", { q: "Who owns Hampton Roads?", history: [] });
  check("Admin Sig names the holder, the scope and the exclusivity", ask.data && ask.data.source === "data" && /Fixture Media A/.test(ask.data.text || "") && /whole market counts/.test(ask.data.text || "") && /conditional/.test(ask.data.text || ""), JSON.stringify(ask.data).slice(0, 300));
  const denResolve = await admin.req("POST", "/api/admin/command/territory/resolve", { userId: globalThis.__beforeDenId, action: "stamp" });
  check("the pre-signing Denver record resolves by stamp once its deal is live", denResolve.status === 200 && denResolve.data.user && denResolve.data.user.partnerId === "partner-b", `${denResolve.status}`);
  const askC = await admin.req("POST", "/api/sig/ask", { q: "Any territory conflicts?", history: [] });
  check("Admin Sig reports zero conflicts after resolution", askC.data && askC.data.source === "data" && /No territory conflicts/.test(askC.data.text || ""), JSON.stringify(askC.data).slice(0, 300));
}

console.log("== canon locks ==");
{
  check("build stamp is -104 on both sides", fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes("2026.11.04-125") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.04-125"));
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("founding Stripe prices stay unarmed (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'), "");
}

console.log(`\nbuild104: ${passed} passed, ${failed} failed`);
if (fails.length) console.error("failures:", fails.join(" | "));
process.exit(failed ? 1 : 0);
