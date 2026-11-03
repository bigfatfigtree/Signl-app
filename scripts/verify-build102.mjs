#!/usr/bin/env node
// Build -102 verification (Tier 3 item 18): public market x
// category roster pages under ONE equal rule. Proves, against
// the real dev server on port 9013 with creators registered,
// approved, and finished through the real endpoints:
//   - a market page 404s below 5 finished public profiles and
//     flips to 200 the moment the fifth lands (Austin edge);
//   - the Nashville page ranks cards by local share IN
//     Nashville, including a multi-market creator whose card
//     carries her Nashville share (40), not her home number (75);
//   - a category cell qualifies independently of the market
//     total (Food & Drink 200, Music 404 at 2 members);
//   - unknown market / unknown category 404 with the friendly
//     page; a tester-flagged finished creator never appears;
//   - the sitemap lists exactly the qualifying roster URLs and
//     roster membership equals sitemap membership (one shared
//     finished-public predicate);
//   - the page carries valid JSON-LD (WebPage, BreadcrumbList,
//     ItemList) and no counts beyond the creators shown;
//   - the qualifying creator's own payload + Sig say they are
//     on the public roster, with the page as the walk;
//   - canon locks: founding Stripe prices unarmed, stamp -102.
//
// Run: node scripts/verify-build102.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9013;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b102.dev";
const ADMIN_PASSWORD = "fixture-admin-pass-102";

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
  async page(p) {
    const headers = {};
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(this.base + p, { headers });
    return { status: res.status, text: await res.text() };
  }
}

// ---------- seeded store: one tester creator who must never appear ----------
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-102", salt, 64).toString("hex");
const DAY = 86400000;
const now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
data["user:tester102"] = {
  id: "tester102", role: "creator", email: "tester102@b102.dev", name: "Tester Tess", passwordSalt: salt, passwordHash: hash,
  status: "approved", market: "Nashville", city: "Nashville", tester: true, createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 30 * DAY),
  creator: { handle: "testertess102", followerCount: 9000, totalAudience: 9000, audienceStack: { instagram: 9000 }, categories: ["Food & Drink"], localAudiencePct: 99, tierBand: "Locals", profileComplete: true, publicPage: true },
};
data["email:tester102@b102.dev"] = { userId: "tester102" };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build102-"));
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

async function registerCreator(email, name, handle, market, city, extra = {}) {
  const client = new Client(BASE);
  const reg = await client.req("POST", "/api/auth/register", {
    role: "creator", name, email, password: "fixture-pass-102x",
    market, city, handle, followerCount: 6400, localAudiencePct: 64,
    categories: ["Food & Drink"], agreedTerms: true, ...extra,
  });
  if (!((reg.status === 200 || reg.status === 201) && reg.data.user)) throw new Error(`register ${handle} failed: ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
  await admin.req("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  const patch = await client.req("PATCH", "/api/me/profile", { publicPage: true, ...(extra.profilePatch || {}) });
  if (patch.status !== 200) throw new Error(`patch ${handle} failed: ${patch.status} ${JSON.stringify(patch.data).slice(0, 200)}`);
  return { client, user: reg.data.user };
}

const anon = new Client(BASE);

console.log("== Nashville: six finished public profiles, ranked by Nashville share ==");
const nashPcts = [90, 80, 70, 60, 50];
const nashClients = [];
for (let i = 0; i < 5; i++) {
  const cats = i < 2 ? ["Food & Drink", "Music"] : ["Food & Drink"];
  nashClients.push(await registerCreator(`rnash${i + 1}@b102.dev`, `Nash Creator ${i + 1}`, `rnash${i + 1}`, "Nashville", "Nashville", {
    localAudiencePct: nashPcts[i], categories: cats,
    profilePatch: i === 0 ? { paidRate: 200 } : {},
  }));
}
// Multi-market: home Richmond (75% home share), 40% of her
// audience in Nashville, where she is also listed.
const rich = await registerCreator("rrich@b102.dev", "Richmond Rae", "rrich102", "Richmond", "Richmond", { localAudiencePct: 75 });
{
  const p = await rich.client.req("PATCH", "/api/me/profile", { audienceMarkets: [{ market: "Nashville", pct: 40 }] });
  check("multi-market share saves through the real PATCH", p.status === 200, `status=${p.status} ${JSON.stringify(p.data).slice(0, 160)}`);
}
{
  const page = await anon.page("/roster/nashville");
  check("the Nashville roster renders at 6 finished public profiles", page.status === 200, `status=${page.status}`);
  check("H1 is plain words", page.text.includes("<h1>Nashville creators</h1>"), page.text.slice(0, 200));
  const order = ["rnash1", "rnash2", "rnash3", "rnash4", "rnash5", "rrich102"].map((h) => page.text.indexOf(`@${h}`));
  check("cards rank by local share in Nashville, strongest first", order.every((v, i) => v > -1 && (i === 0 || order[i - 1] < v)), JSON.stringify(order));
  check("the multi-market card carries her Nashville share (40), not her home number (75)", page.text.includes("40% local") && page.text.includes("in Nashville"), "");
  check("the paid rate shows only where the creator listed one", page.text.includes("Paid bookings from $200"), "");
  check("the tester creator never appears", !page.text.includes("testertess102"), "");
  check("no counts beyond the creators shown", !/\b[0-9]+ (founding )?creators (have|are|signed)/.test(page.text), "");
  const ldMatch = page.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let ld = null; try { ld = ldMatch && JSON.parse(ldMatch[1]); } catch (e) { ld = null; }
  const graph = ld && ld["@graph"] || [];
  const itemList = graph.find((g) => g["@type"] === "ItemList");
  check("JSON-LD parses with WebPage + BreadcrumbList + ItemList of 6", !!ld && graph.some((g) => g["@type"] === "WebPage") && graph.some((g) => g["@type"] === "BreadcrumbList") && !!itemList && itemList.itemListElement.length === 6, ldMatch ? ldMatch[1].slice(0, 200) : "no ld");
}

console.log("== Category cells qualify on their own count ==");
{
  const food = await anon.page("/roster/nashville/food-and-drink");
  check("the Food & Drink cell renders (6 members)", food.status === 200 && food.text.includes("<h1>Food &amp; Drink creators in Nashville</h1>") || (food.status === 200 && food.text.includes("Food & Drink creators in Nashville")), `status=${food.status}`);
  const music = await anon.page("/roster/nashville/music");
  check("the Music cell 404s at 2 members (never a thin page)", music.status === 404 && music.text.includes("not public yet"), `status=${music.status}`);
  const bogus = await anon.page("/roster/nashville/bogus-category");
  check("an unknown category 404s", bogus.status === 404, `status=${bogus.status}`);
  const nowhere = await anon.page("/roster/atlantis");
  check("an unknown market 404s", nowhere.status === 404 && nowhere.text.includes("not public yet"), `status=${nowhere.status}`);
}

console.log("== The threshold edge: Austin flips at exactly 5 ==");
{
  for (let i = 0; i < 4; i++) await registerCreator(`raust${i + 1}@b102.dev`, `Austin Creator ${i + 1}`, `raust${i + 1}`, "Austin", "Austin", {});
  const before = await anon.page("/roster/austin");
  check("4 finished profiles: the page 404s", before.status === 404 && before.text.includes("not public yet"), `status=${before.status}`);
  await registerCreator("raust5@b102.dev", "Austin Creator 5", "raust5", "Austin", "Austin", {});
  const after = await anon.page("/roster/austin");
  check("the fifth finished profile flips the page live", after.status === 200 && after.text.includes("<h1>Austin creators</h1>"), `status=${after.status}`);
}

console.log("== Sitemap parity: one predicate, one threshold ==");
{
  const sm = await anon.page("/sitemap.xml");
  check("the sitemap lists the qualifying roster pages", sm.text.includes("/roster/nashville") && sm.text.includes("/roster/nashville/food-and-drink") && sm.text.includes("/roster/austin"), "");
  check("the sitemap never lists a sub-threshold roster", !sm.text.includes("/roster/nashville/music"), "");
  const profileUrls = [...sm.text.matchAll(/\/c\/([a-z0-9_]+)/g)].map((m) => m[1]);
  check("sitemap profile membership is the finished-public set (11 creators, tester excluded)", profileUrls.length === 11 && !profileUrls.includes("testertess102"), JSON.stringify(profileUrls));
}

console.log("== The creator's own state + Sig agree with the page ==");
{
  const me = await nashClients[0].client.req("GET", "/api/auth/me");
  const pr = me.data && me.data.user && me.data.user.publicRoster;
  check("the qualifying creator's payload names the roster", Array.isArray(pr) && pr.length === 1 && pr[0].market === "Nashville" && pr[0].url === "/roster/nashville", JSON.stringify(pr));
  const ask = await nashClients[0].client.req("POST", "/api/sig/ask", { q: "Am I on the public roster page?", history: [] });
  check("Sig answers yes, from the same predicate, with the page as the walk", ask.data && ask.data.source === "data" && /public roster for Nashville/.test(ask.data.text) && ask.data.link && ask.data.link.dest === "/roster/nashville", JSON.stringify(ask.data).slice(0, 300));
}

console.log("== Source: rewrite + canon locks ==");
{
  const toml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("netlify.toml rewrites /roster/* to the api function", toml.includes('from = "/roster/*"') && toml.includes("rosterpage"), "");
  check("founding Stripe prices stay unarmed (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'), "");
}

server.kill();
console.log(`\nBuild -102 verify: ${passed} passed, ${failed} failed`);
if (fails.length) { console.error("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
process.exit(0);
