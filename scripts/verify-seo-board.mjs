// Build -216: the Admin "SEO / AI search" board.
// Runs the REAL api handler in-process against a seeded local
// store and proves:
//   - GET /api/admin/seo-board answers 200 for a signed-in admin
//     with the generated board (24 search pages in 3 groups:
//     Learn articles 6, City pages 16, Comparisons 2; totals,
//     next-in-queue, and the tracking facts all present)
//   - every listed page carries a title, a live magpielocal.com
//     Learn URL, an establishable date, and a target phrase, and
//     each group is newest-first
//   - anonymous reads are refused (401/403)
//   - a signed-in NON-admin (creator) is refused (403)
//   - the board's inventory (Build -217) covers every sitemap
//     URL exactly once across Main/City/Learn/Other, each row
//     with a title and a magpielocal.com URL, dates null or
//     YYYY-MM-DD, total read live from the site repo's sitemap
//   - the data file is NOT under public/ (never publicly served)
//   - source pins: the rail carries the "SEO / AI search" room,
//     renderAdmin dispatches it, and both permission maps
//     (client + server) gate it on learn.view / stats.view
// Run: node scripts/verify-seo-board.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-seo-board-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "seo-board-verify-pass";
process.env.APP_URL = "http://localhost";
fs.writeFileSync(DB_PATH, JSON.stringify({}));

const require = createRequire(import.meta.url);
const { handler } = require("../netlify/functions/api.js");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
function evt(method, p, { cookie, body } = {}) {
  return { httpMethod: method, path: p, headers: cookie ? { cookie } : {}, queryStringParameters: {}, body: body ? JSON.stringify(body) : null, isBase64Encoded: false };
}
const parse = (res) => { try { return JSON.parse(res.body); } catch (e) { return null; } };
const cookieOf = (res) => {
  const sc = (res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"])) || "";
  const first = Array.isArray(sc) ? sc[0] : sc;
  return first ? first.split(";")[0] : "";
};

console.log("verify-seo-board: Admin SEO / AI search board is real, complete, and admin-only");

// ---- source pins ----
const appJs = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const permsJs = fs.readFileSync(new URL("../netlify/functions/lib/permissions.js", import.meta.url), "utf8");
const routerJs = fs.readFileSync(new URL("../netlify/functions/lib/router.js", import.meta.url), "utf8");
check("rail carries the SEO / AI search room", appJs.includes(`add("b", "search", "SEO / AI search", "return go('dashboard','SEO / AI search')"`));
check("renderAdmin dispatches the room", appJs.includes(`if (tab === "SEO / AI search") loadAdminSeoBoard216();`));
check("client permission map gates the room", appJs.includes(`"SEO / AI search": ["learn.view", "stats.view"]`));
check("server permission map gates the room", permsJs.includes(`"SEO / AI search": ["learn.view", "stats.view"]`));
check("router gate covers seo-board", routerJs.includes(`case "seo-board":`));
check("board data file is NOT under public/", !fs.existsSync(new URL("../public/data/seo-board.json", import.meta.url)) && !fs.existsSync(new URL("../public/seo-board.json", import.meta.url)));

// ---- admin login + board payload ----
const login = await handler(evt("POST", "/api/auth/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } }));
check("admin login succeeds", login.statusCode === 200, `got ${login.statusCode}`);
const adminCookie = cookieOf(login);
check("login issued a session cookie", adminCookie.includes("="));

const res = await handler(evt("GET", "/api/admin/seo-board", { cookie: adminCookie }));
const board = parse(res);
check("board answers 200 for admin", res.statusCode === 200 && !!board, `got ${res.statusCode}`);
check("totals: 24 pages built for search", !!board && board.totals && board.totals.searchPages === 24, board && JSON.stringify(board.totals));
check("totals: 414 total site pages (sitemap)", !!board && board.totals && board.totals.sitePages === 414, board && JSON.stringify(board.totals));
check("totals: last updated 2026-11-19", !!board && board.totals && board.totals.lastUpdated === "2026-11-19", board && JSON.stringify(board.totals));
check("next in queue is the spas tranche", !!board && /Spas and med spas/.test(board.nextUp || ""), board && board.nextUp);
const groups = Object.fromEntries(((board && board.groups) || []).map((g) => [g.name, g.pages || []]));
check("groups: Learn articles 6, City pages 16, Comparisons 2",
  (groups["Learn articles"] || []).length === 6 && (groups["City pages"] || []).length === 16 && (groups["Comparisons"] || []).length === 2,
  JSON.stringify(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]))));
let rowsOk = true;
let orderOk = true;
for (const pages of Object.values(groups)) {
  for (const p of pages) {
    if (!p.title || !/^https:\/\/magpielocal\.com\/learn\/.+\.html$/.test(p.url || "") || !/^\d{4}-\d{2}-\d{2}$/.test(p.date || "") || !p.target) rowsOk = false;
  }
  for (let i = 1; i < pages.length; i++) if (pages[i - 1].date < pages[i].date) orderOk = false;
}
check("every row has title, live URL, date, and target phrase", rowsOk);
check("each group is newest-first", orderOk);
check("tracking strip: check date + recorded facts", !!board && board.tracking && board.tracking.checkDate === "2026-11-18" && Array.isArray(board.tracking.facts) && board.tracking.facts.length >= 4 && board.tracking.facts.some((f) => f.includes("1 click / 60 impressions")),
  board && JSON.stringify(board.tracking).slice(0, 200));

// ---- inventory (Build -217): every sitemap page, grouped ----
// The expected total is read LIVE from the site repo's
// sitemap.xml, never hardcoded, so this check tracks the site
// as it grows.
const sitemapText = fs.readFileSync(new URL("../../signl-site/sitemap.xml", import.meta.url), "utf8");
const sitemapCount = (sitemapText.match(/<loc>/g) || []).length;
const inv = board && board.inventory;
check("inventory present, total equals the live sitemap count", !!inv && inv.total === sitemapCount && sitemapCount > 0,
  `inventory ${inv && inv.total} vs sitemap ${sitemapCount}`);
check("inventory total equals totals.sitePages", !!inv && !!board.totals && inv.total === board.totals.sitePages,
  inv && board && JSON.stringify({ inv: inv.total, sitePages: board.totals.sitePages }));
const invGroups = (inv && inv.groups) || [];
const invSum = invGroups.reduce((n, g) => n + ((g.pages || []).length), 0);
check("inventory groups are Main/City/Learn/Other and counts sum to total",
  JSON.stringify(invGroups.map((g) => g.name)) === JSON.stringify(["Main pages", "City pages", "Learn articles", "Other"]) && invSum === (inv && inv.total),
  JSON.stringify(invGroups.map((g) => [g.name, (g.pages || []).length])));
let invRowsOk = true;
let invDatesOk = true;
let invDup = false;
const invSeen = new Set();
for (const g of invGroups) {
  for (const p of g.pages || []) {
    if (!p.title || !/^https:\/\/magpielocal\.com/.test(p.url || "")) invRowsOk = false;
    if (!(p.date === null || /^\d{4}-\d{2}-\d{2}$/.test(p.date || ""))) invDatesOk = false;
    if (invSeen.has(p.url)) invDup = true;
    invSeen.add(p.url);
  }
}
check("every inventory row has a title and a magpielocal.com URL", invRowsOk);
check("inventory dates are null or YYYY-MM-DD", invDatesOk);
check("inventory lists each sitemap URL exactly once", !invDup && invSeen.size === sitemapCount,
  `unique ${invSeen.size} vs sitemap ${sitemapCount}, dup ${invDup}`);
check("renderer carries the Every page on the site section", appJs.includes("Every page on the site") && appJs.includes("d.inventory"));

// ---- refusals ----
const anon = await handler(evt("GET", "/api/admin/seo-board"));
check("anonymous read is refused (401/403)", anon.statusCode === 401 || anon.statusCode === 403, `got ${anon.statusCode}`);

const reg = await handler(evt("POST", "/api/auth/register", { body: { email: "seo-fixture-creator@example.com", password: "seo-board-verify-pass", name: "Seo Fixture", role: "creator", market: "Nashville", city: "Nashville", handle: "seofixture", followerCount: 4200, localAudiencePct: 61, categories: ["Food & Drink"], agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true } }));
let creatorCookie = cookieOf(reg);
if (!creatorCookie) {
  const li = await handler(evt("POST", "/api/auth/login", { body: { email: "seo-fixture-creator@example.com", password: "seo-board-verify-pass" } }));
  creatorCookie = cookieOf(li);
}
check("fixture creator session obtained", !!creatorCookie, `register ${reg.statusCode}`);
const asCreator = await handler(evt("GET", "/api/admin/seo-board", { cookie: creatorCookie }));
check("non-admin (creator) read is refused (403)", asCreator.statusCode === 403, `got ${asCreator.statusCode}: ${String(asCreator.body).slice(0, 120)}`);

console.log(`\nverify-seo-board: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
