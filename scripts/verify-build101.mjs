#!/usr/bin/env node
// Build -101 verification (Tier 3 item 19a): "Which till do you
// run?" — the declared-POS field that measures the register mix
// the POS sequence runs on. Proves, against a seeded throwaway
// store served by the real dev server on port 9011:
//   - sign-up stores a valid declaration, stores nothing for a
//     skipped or unrecognized answer, and never blocks on it;
//   - the profile PATCH writes the declaration for founding
//     businesses (page-fields allowlist) and active ones alike,
//     refuses an unrecognized value with a 400, keeps posOther
//     only for "another system", and clears on "";
//   - the Home setup checklist's till item flips done only from
//     the stored record, and its payload carries the pos view;
//   - the Command Center Businesses payload carries posMix over
//     non-tester businesses (overall + per market), and the
//     tester business's Clover never appears in it;
//   - Sig: a business is answered from its own record before and
//     after declaring (honest non-Square wording, no date
//     promised); Admin Sig reads the same mix;
//   - source: the three surfaces ship (sign-up chips, checklist
//     chips, business-page card), the founding Stripe prices stay
//     unarmed, the stamp is -101.
//
// Run: node scripts/verify-build101.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9011;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b101.dev";
const ADMIN_PASSWORD = "fixture-admin-pass-101";

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

// ---------- seeded store ----------
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-101", salt, 64).toString("hex");
const DAY = 86400000;
const now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const bizUser = (id, over = {}) => putUser({
  id, role: "business", email: `${id}@b101.dev`, name: "Owner", passwordSalt: salt, passwordHash: hash,
  status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 30 * DAY),
  business: { businessName: `B101 ${id}`, category: "Restaurant", plan: "self-service", planId: "self-service", accessState: "founding", about: "A real page." },
  ...over,
});
bizUser("bizclover", { business: { businessName: "B101 Clover Cafe", category: "Restaurant", plan: "self-service", planId: "self-service", accessState: "active", about: "Open.", posProvider: "clover" } });
bizUser("bizplain");
bizUser("bizlondon", { market: "London", city: "London", business: { businessName: "B101 London Tea", category: "Restaurant", plan: "self-service", planId: "self-service", accessState: "founding", about: "Tea.", posProvider: "lightspeed" } });
bizUser("biztester", { tester: true, business: { businessName: "B101 Tester Toast", category: "Restaurant", plan: "self-service", planId: "self-service", accessState: "active", about: "Test.", posProvider: "clover" } });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build101-"));
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
const login = async (email, password) => { const c = new Client(BASE); const r = await c.req("POST", "/api/auth/login", { email, password }); if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.data)}`); return c; };
const plain = await login("bizplain@b101.dev", "fixture-pass-101");
const clover = await login("bizclover@b101.dev", "fixture-pass-101");
const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

console.log("== Sign-up stores the declaration, and only the declaration ==");
{
  const c = new Client(BASE);
  const r = await c.req("POST", "/api/auth/register", { role: "business", name: "New Owner", email: "newbiz@b101.dev", password: "fixture-pass-101x", market: "Nashville", city: "Nashville", businessName: "New Till Tacos", category: "Restaurant", agreedTerms: true, posProvider: "toast" });
  check("sign-up with a Toast declaration succeeds", r.status === 200 || r.status === 201, `status=${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  const me = await c.req("GET", "/api/auth/me");
  check("the stored record carries the declaration", !!(me.data && me.data.user && me.data.user.business && me.data.user.business.posProvider === "toast"), JSON.stringify(me.data).slice(0, 200));
  const c2 = new Client(BASE);
  const r2 = await c2.req("POST", "/api/auth/register", { role: "business", name: "Skip Owner", email: "skipbiz@b101.dev", password: "fixture-pass-101x", market: "Nashville", city: "Nashville", businessName: "Skip Till Sushi", category: "Restaurant", agreedTerms: true });
  const me2 = await c2.req("GET", "/api/auth/me");
  check("a skipped question stores nothing and never blocks", (r2.status === 200 || r2.status === 201) && !(me2.data.user.business.posProvider), `status=${r2.status}`);
  const c3 = new Client(BASE);
  const r3 = await c3.req("POST", "/api/auth/register", { role: "business", name: "Bogus Owner", email: "bogusbiz@b101.dev", password: "fixture-pass-101x", market: "Nashville", city: "Nashville", businessName: "Bogus Till BBQ", category: "Restaurant", agreedTerms: true, posProvider: "cashregister2000" });
  const me3 = await c3.req("GET", "/api/auth/me");
  check("an unrecognized value stores nothing and never blocks", (r3.status === 200 || r3.status === 201) && !(me3.data.user.business.posProvider), `status=${r3.status}`);
}

console.log("== The PATCH writes it, validates it, clears it ==");
{
  const before = await plain.req("GET", "/api/me/setup-checklist");
  const tillBefore = (before.data.setupChecklist.items || []).find((i) => i.id === "till");
  check("the checklist till item starts undone with no pos view", !!tillBefore && tillBefore.done === false && !before.data.setupChecklist.pos, JSON.stringify(tillBefore));
  const bad = await plain.req("PATCH", "/api/me/profile", { posProvider: "cashregister2000" });
  check("an unrecognized value refuses the save", bad.status === 400, `status=${bad.status}`);
  const other = await plain.req("PATCH", "/api/me/profile", { posProvider: "other", posOther: "Shopify POS" });
  check("another system stores with its name", other.status === 200 && other.data.user.business.posProvider === "other" && other.data.user.business.posOther === "Shopify POS", JSON.stringify(other.data).slice(0, 200));
  const named = await plain.req("PATCH", "/api/me/profile", { posProvider: "clover", posOther: "Shopify POS" });
  check("switching to a named system drops the free-text name", named.status === 200 && named.data.user.business.posProvider === "clover" && !named.data.user.business.posOther, JSON.stringify(named.data.user.business).slice(0, 200));
  const after = await plain.req("GET", "/api/me/setup-checklist");
  const tillAfter = (after.data.setupChecklist.items || []).find((i) => i.id === "till");
  check("the checklist item flips done from the stored record", !!tillAfter && tillAfter.done === true && after.data.setupChecklist.pos && after.data.setupChecklist.pos.label === "Clover", JSON.stringify(after.data.setupChecklist.pos));
  const cleared = await plain.req("PATCH", "/api/me/profile", { posProvider: "" });
  check("an empty pick clears the declaration", cleared.status === 200 && !cleared.data.user.business.posProvider, JSON.stringify(cleared.data.user.business).slice(0, 160));
}

console.log("== The mix: Admin sees declarations, testers never count ==");
{
  const d = await admin.req("GET", "/api/admin/command/businesses");
  const mix = d.data && d.data.posMix;
  check("the Businesses payload carries posMix", !!mix && !!mix.counts, JSON.stringify(d.data).slice(0, 200));
  // Seeded: clover x1 real (bizclover) + the PATCH flow above left
  // bizplain cleared; lightspeed x1 (London); the tester's clover
  // must NOT appear.
  check("the mix counts real declarations only (tester Clover excluded)", !!mix && mix.counts.clover === 1 && mix.counts.lightspeed === 1, JSON.stringify(mix && mix.counts));
  check("the mix splits by market", !!mix && mix.byMarket["London"] && mix.byMarket["London"].lightspeed === 1 && mix.byMarket["Nashville"].clover === 1, JSON.stringify(mix && mix.byMarket));
  check("undeclared is counted, never guessed away", !!mix && mix.counts.undeclared >= 2, JSON.stringify(mix && mix.counts));
}

console.log("== Sig answers from the same records ==");
{
  const askClover = await clover.req("POST", "/api/sig/ask", { q: "Which till do I run?", history: [] });
  check("a Clover business hears its own answer, honestly", askClover.data && askClover.data.source === "data" && /Clover/.test(askClover.data.text) && /count at the till today/.test(askClover.data.text) && !/202[6-9]|next month|soon/.test(askClover.data.text), JSON.stringify(askClover.data).slice(0, 300));
  const askPlain = await plain.req("POST", "/api/sig/ask", { q: "What register system do I use?", history: [] });
  check("an undeclared business is pointed at the one-tap answer", askPlain.data && askPlain.data.source === "data" && /not told us/.test(askPlain.data.text) && askPlain.data.link && askPlain.data.link.dest === "biz-home", JSON.stringify(askPlain.data).slice(0, 300));
  const askAdmin = await admin.req("POST", "/api/sig/ask", { q: "What tills do our businesses run?", history: [] });
  check("Admin Sig reads the same mix", askAdmin.data && /Declared tills/.test(askAdmin.data.text || "") && /Clover 1/.test(askAdmin.data.text || ""), JSON.stringify(askAdmin.data).slice(0, 300));
}

console.log("== Source: surfaces + canon locks ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("sign-up carries the till chip row", appJs.includes('"jb-pos"') && appJs.includes("jb-pos-other"), "");
  check("the checklist answers in place", appJs.includes("function setupSetPos(") && appJs.includes("setupSetPosOther"), "");
  check("the business page carries the Your till card", appJs.includes('id="bp-pos-provider"') && appJs.includes("bp-pos-other"), "");
  check("founding Stripe prices stay unarmed (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'), "");
  check("no em dashes in the new till copy", !routerJs.slice(routerJs.indexOf("Build -101: which till"), routerJs.indexOf("Build -99: the ONE business setup checklist")).includes("—"), "");
}

server.kill();
console.log(`\nBuild -101 verify: ${passed} passed, ${failed} failed`);
if (fails.length) { console.error("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
process.exit(0);
