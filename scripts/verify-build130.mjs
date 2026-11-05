#!/usr/bin/env node
// Build -130 verification (Jeff, 2026-11-05, "thats crucial"):
//   PART 1 — Sig's mark is THE ORB everywhere (assets + refs;
//   the deep asset pins live in verify-build124 + verify-sig —
//   here: the cross-repo-style grep invariants for the app).
//   PART 2 — Admin % local stats: the Admin home totals strip
//   gains "Avg % local" (straight average of each signed-up
//   creator's share TO THEIR HOME MARKET; unstated excluded,
//   never zero) and each Markets card gains its own "Avg %
//   local" over the creators LISTED in that market (home
//   creators at their home share; other-market listers at
//   their audienceMarkets share for that market).
//   PART 3 — Local follower counts: per market, the sum over
//   listed creators of (stacked followers x % local to that
//   market / 100), rounded per creator; on the strip, the
//   same sum on the home-market basis, each creator once.
// The share read is audienceShareInMarket — the exact number
// the public profile shows (Build -108: Instagram's verified
// data labels that share, it never rewrites it, so the Meta
// feed refines these stats through the same field).
//
// Fixture math (all expected values computed by hand):
//   mandy  approved Nashville 15,000 stacked, home 55%,
//          audienceMarkets Richmond 20%
//   rita   approved Richmond  2,000 stacked, home 70%
//   pete   pending  Nashville 10,000 stacked, home 40%
//   nova   approved Nashville 5,000 stacked, NO % stated
//   tess   approved TESTER    Nashville 999,999, 99% (excluded)
//   rob    rejected Richmond  7,000 stacked, 90% (excluded)
// Platform: signedUp 4 · followers 32,000 ·
//   avg % local = (55+70+40)/3 = 55 (nova excluded, not zero)
//   local followers = 8,250 + 1,400 + 4,000 = 13,650
//     (mandy counted ONCE at her home 55%, never at Richmond)
// Nashville: avg = (55+40)/2 = 47.5 -> 48 · local = 12,250
// Richmond:  avg = (20+70)/2 = 45 · local = 3,000 + 1,400 = 4,400
//     (mandy contributes at Richmond's 20%, not her home 55%)
// Austin (nobody): avg null · local 0
//
// Run: node scripts/verify-build130.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8970;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-build130-" + "pass-123";
const PW = "fixture-pass-130";
const DAY = 86400000;
const now0 = Date.now();
const iso = (t) => new Date(t).toISOString();

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
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
check("stamp is 2026.11.05-132 and identical in build.js + index.html", buildJs.includes('BUILD_ID = "2026.11.05-132"') && indexHtml.includes("2026.11.05-132"));
check("orb: SIG_ART names the orb folder, zero retired-face references in the client", appJs.includes('const SIG_ART = "/assets/sig-orb";') && !appJs.includes("/assets/sig-a") && !appJs.includes("head-idle") && !appJs.includes("still-celebrate"));
check("orb assets ship in the bundle", fs.existsSync(path.join(root, "public/assets/sig-orb/orb.webp")) && fs.existsSync(path.join(root, "public/assets/sig-orb/orb.mp4")) && !fs.existsSync(path.join(root, "public/assets/sig-a")));
check("server: platform totals compute avg % local + local followers off audienceShareInMarket", routerJs.includes("avgLocalPct") && routerJs.includes("localFollowers") && routerJs.includes("audienceShareInMarket(u, u.market)"));
check("server: markets payload carries the per-market local numbers", routerJs.includes("localByMarket") && routerJs.includes("avgLocalCount"));
{
  const i1 = appJs.indexOf("Creators signed up"), i2 = appJs.indexOf("Total followers"), i3 = appJs.indexOf("Local followers"), i4 = appJs.indexOf("Avg % local");
  check("strip order: Signed up · Followers · Local followers · Avg % local", i1 > -1 && i2 > i1 && i3 > i2 && i4 > i3, [i1, i2, i3, i4].join(","));
}
check("strip sublabel says what % local means, in plain words", appJs.includes("Average share of a creator's audience that lives in their market"));
check("market card carries local followers + avg % local", appJs.includes("local followers: the part of that audience that lives in") && appJs.includes("avg % local"));

// ---------- S2: market photos (Part 4 + Jeff's standing rule) ----------
part("S2: market photos");
check("photo mechanism: id-based path + gradient layered underneath as the fallback", appJs.includes("function marketPhoto130(m)") && appJs.includes("/assets/market-photos/") && appJs.includes("'),var(--grad)"));
{
  const { MARKETS } = createRequire(import.meta.url)("../netlify/functions/lib/markets.js");
  const missing = [];
  for (const mk of MARKETS) {
    const p = path.join(root, "public/assets/market-photos", mk.id + ".jpg");
    let ok = false;
    try { const b = fs.readFileSync(p); ok = b.length > 10000 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; } catch { ok = false; }
    if (!ok) missing.push(mk.id);
  }
  check("STANDING RULE: every market in lib/markets.js has a real city photo at public/assets/market-photos/<id>.jpg — adding a market means adding its photo in the same change, or this build fails", missing.length === 0, missing.join(","));
  check("photo sources + licences recorded in credits.json", fs.existsSync(path.join(root, "public/assets/market-photos/credits.json")));
}

// ---------- S3: desktop nav (Part 6), Sig chat boxes (Part 7), mobile top bar (Part 8) ----------
part("S3: nav + Sig boxes + top bar");
const themeCss = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");
check("Part 6: the rail composes every destination — non-primary tabs ride as secondaries under a More label", appJs.includes("const secondary = items.filter") && appJs.includes('<div class="tab-grouplabel">More</div>') && appJs.includes('...secondary.map((it) => btnHtml(it, "tab-secondary"))'));
check("Part 6: desktop hides the Everything triggers (panel itself stays for phones)", themeCss.includes(".tab-ev125, .tr-ev125 { display: none !important; }") && appJs.includes("function openEverything125()"));
check("Part 6: the desktop rail scrolls as far as it needs", themeCss.includes("body.v3-on #tabbar .tab-main { overflow-y: auto;"));
check("Part 7: the working chat box exists (orb + type-in + sigAsk wiring)", appJs.includes("function sigChatBoxHtml(key, opts)") && appJs.includes("async function sigBoxSend(ev, key)") && appJs.includes("await sigAsk(text)") && appJs.includes("sigbox-input-"));
check("Part 7: every role home opens with the Sig home-top (chat box + reminders)", (appJs.match(/sigHomeTopHtml\(\)\}/g) || []).length >= 6 && appJs.includes("function sigHomeTopHtml()") && appJs.includes("async function loadSigTopNudges()"));
check("Part 7: the old Sig doors are working boxes now (card + foot + sheet)", appJs.includes('return sigChatBoxHtml("card", { still: true });') && appJs.includes('return sigChatBoxHtml("foot", { still: true });') && appJs.includes('sigChatBoxHtml("sheet", { still: true'));
check("Part 7: no passive Sig avatar heads the Next list anymore", !appJs.includes('nx-head">${SIG_AVATAR_HTML}'));
check("Part 8: mobile top bars carry the hamburger, help beside the name", appJs.includes('tb2-help130') && appJs.includes('${bnIcon("menu")}') && themeCss.includes(".tr-right { display: contents; }"));

// ---------- fixtures ----------
const salt = "b130fixturesalt";
const hash = crypto.scryptSync(PW, salt, 64).toString("hex");
function creatorRec(id, name, email, handle, over = {}) {
  return {
    id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash,
    status: "pending", market: "Nashville", city: "Nashville",
    createdAt: iso(now0 - 10 * DAY), updatedAt: iso(now0 - 10 * DAY),
    creator: {
      handle, primaryPlatform: "instagram", followerCount: 1000, totalAudience: 1000,
      audienceStack: { instagram: 1000 }, categories: ["Food & Drink"], localAudiencePct: 60,
      tierBand: "Neighbors", profileComplete: true, hasPhoto: false, bio: "",
      ...(over.creator || {}),
    },
    ...(over.top || {}),
  };
}
const fixtures = [
  creatorRec("b130-mandy", "Mandy Multi", "mandy130@fixtures.dev", "multimandy130", {
    top: { status: "approved", reviewedAt: iso(now0 - 39 * DAY), createdAt: iso(now0 - 40 * DAY) },
    creator: { followerCount: 15000, totalAudience: 15000, audienceStack: { instagram: 10000, tiktok: 5000 }, audienceMarkets: [{ market: "Richmond", pct: 20 }], localAudiencePct: 55, tierBand: "Locals", hasPhoto: true },
  }),
  creatorRec("b130-rita", "Rita Richmond", "rita130@fixtures.dev", "ritarichmond130", {
    top: { status: "approved", market: "Richmond", city: "Richmond", reviewedAt: iso(now0 - 29 * DAY), createdAt: iso(now0 - 30 * DAY) },
    creator: { followerCount: 2000, totalAudience: 2000, audienceStack: { instagram: 2000 }, localAudiencePct: 70 },
  }),
  creatorRec("b130-pete", "Pete Pending", "pete130@fixtures.dev", "petepending130", {
    top: { createdAt: iso(now0 - 3 * DAY), updatedAt: iso(now0 - 3 * DAY) },
    creator: { followerCount: 10000, totalAudience: 10000, audienceStack: { instagram: 10000 }, localAudiencePct: 40 },
  }),
  creatorRec("b130-nova", "Nova Nopct", "nova130@fixtures.dev", "novanopct130", {
    top: { status: "approved", reviewedAt: iso(now0 - 9 * DAY), createdAt: iso(now0 - 10 * DAY) },
    creator: { followerCount: 5000, totalAudience: 5000, audienceStack: { instagram: 5000 }, localAudiencePct: null },
  }),
  creatorRec("b130-tess", "Tess Tester", "tess130@fixtures.dev", "tesstester130", {
    top: { status: "approved", tester: true, reviewedAt: iso(now0 - 19 * DAY), createdAt: iso(now0 - 20 * DAY) },
    creator: { followerCount: 999999, totalAudience: 999999, audienceStack: { instagram: 999999 }, localAudiencePct: 99 },
  }),
  creatorRec("b130-rob", "Rob Rejected", "rob130@fixtures.dev", "robrejected130", {
    top: { status: "rejected", market: "Richmond", city: "Richmond", reviewedAt: iso(now0 - 24 * DAY), createdAt: iso(now0 - 25 * DAY) },
    creator: { followerCount: 7000, totalAudience: 7000, audienceStack: { instagram: 7000 }, localAudiencePct: 90 },
  }),
];

// ---------- live harness ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build130-"));
const dbFile = path.join(tmp, "db.json");
{
  const data = {};
  for (const u of fixtures) { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; }
  fs.writeFileSync(dbFile, JSON.stringify(data));
}
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD: ADMIN_PW },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  server = null;
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up");
}
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const piece of setCookie.split(/,(?=[^;]+=)/)) {
      const m = piece.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data, text };
  };
}

try {
  part("H: live stats");
  startServer();
  await waitUp();
  const admin = makeClient();
  const login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", login.status === 200 && login.data.user && login.data.user.role === "admin", String(login.status));

  const totals = await admin("GET", "/api/admin/platform-totals");
  const t = totals.data || {};
  check("platform: 4 signed up (approved + pending; tester + rejected excluded)", t.creatorsSignedUp === 4, JSON.stringify(t));
  check("platform: 32,000 total followers (each creator once)", t.totalFollowers === 32000, String(t.totalFollowers));
  check("platform: avg % local = 55 — (55+70+40)/3, the unstated share excluded, never zero", t.avgLocalPct === 55 && t.avgLocalCount === 3, JSON.stringify({ avg: t.avgLocalPct, n: t.avgLocalCount }));
  check("platform: local followers = 13,650 — the multi-market creator counted ONCE at her home 55%", t.localFollowers === 13650, String(t.localFollowers));

  const mk = await admin("GET", "/api/admin/markets");
  const row = (name) => (mk.data.markets || []).find((m) => m.name === name);
  const nash = row("Nashville"), rich = row("Richmond"), aus = row("Austin");
  check("markets read ok", mk.status === 200 && !!nash && !!rich, String(mk.status));
  check("Nashville: avg % local = 48 — (55+40)/2 over stated shares only", nash && nash.avgLocalPct === 48 && nash.avgLocalCount === 2, JSON.stringify(nash && { avg: nash.avgLocalPct, n: nash.avgLocalCount }));
  check("Nashville: local followers = 12,250 (8,250 + 4,000)", nash && nash.localFollowers === 12250, String(nash && nash.localFollowers));
  check("Richmond: avg % local = 45 — the multi-market creator at Richmond's 20%, the home creator at 70%", rich && rich.avgLocalPct === 45 && rich.avgLocalCount === 2, JSON.stringify(rich && { avg: rich.avgLocalPct, n: rich.avgLocalCount }));
  check("Richmond: local followers = 4,400 — she contributes 3,000 here (20%), not her home share", rich && rich.localFollowers === 4400, String(rich && rich.localFollowers));
  check("Austin (nobody listed): avg % local is null, local followers 0 — no invented number", aus && aus.avgLocalPct === null && aus.localFollowers === 0 && aus.avgLocalCount === 0, JSON.stringify(aus && { avg: aus.avgLocalPct, lf: aus.localFollowers }));
} finally {
  await stopServer();
}


// ---- S4: Part 9 — Admin Stats + Wallet removal + Creators tab ----
console.log("S4 Part 9: Admin Stats, Wallet removal, Creators tab");
const win130 = (a, b) => { const i = appJs.indexOf(a); if (i < 0) return ""; const j = b ? appJs.indexOf(b, i + a.length) : appJs.length; return j > i ? appJs.slice(i, j) : ""; };
const statsWin = win130("function astRender()", "async function ccShowTab()");
check("S4: Stats page is charts-first in the -119 design language (stat-band, sparkline, funnel2)",
  statsWin.includes('wsHead("Stats"') && statsWin.includes("stat-band") && statsWin.includes("sparkSvg119(") && statsWin.includes("funnel2Html("), "");
check("S4: Stats filters exist and shape the charts (astSetFilter range/market/status)",
  statsWin.includes("astSetFilter('range'") && statsWin.includes("astSetFilter('market'") && statsWin.includes("astSetFilter('status'") && appJs.includes("function astRender()"), "");
check("S4: revenue honesty — collected from the charge ledger, pipeline labelled recorded-not-yet-billed, payments-off stated",
  appJs.includes("Recorded, not yet billed") && appJs.includes("Payments are turned off right now") && appJs.includes("money.charged"), "");
check("S4: the books keep their five real views (Money · Partners · Businesses · Owed · Close)",
  ["money", "partners", "businesses", "owed", "close"].every((t) => statsWin.includes(`ccSetTab('${t}')`)) && appJs.includes("function ccMoneyHtml(") && appJs.includes("function ccCloseHtml("), "");
check("S4: Command Center shell + forming placeholder are gone (no dead-end Admin destination)",
  !appJs.includes("ccFormingHtml") && !appJs.includes("Command Center</h2>") && !appJs.includes("ccOverviewHtml") && !appJs.includes("ccMarketsHtml"), "");
check("S4: Admin Wallet removed everywhere (no function, no panel row, no short label)",
  !appJs.includes("adminWalletGo125") && !appJs.includes("rail-label-short")
  && !win130('if (u.role === "admin") {\n    return [', 'if (u.role === "creator")').includes('"Wallet"'), "");
check("S4: Creators is a real Admin tab (rail item + dispatch + loader)",
  appJs.includes('add("a", "users", "Creators", "return go(\'dashboard\',\'Creators\')"')
  && appJs.includes('if (tab === "Creators") loadAdminCreators130();')
  && appJs.includes("async function loadAdminCreators130()"), "");
check("S4: Stats/Creators code only calls helpers that exist (fmtNum, astFull defined; no phantom formatters)",
  appJs.includes("function astFull(") && appJs.includes("function fmtNum(") && !appJs.includes("fmtCount("), "");
check("S4: nav parity guard exists and is chained",
  fs.existsSync(new URL("./verify-navparity.mjs", import.meta.url))
  && JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts.verify.includes("verify-navparity"), "");

console.log(`verify-build130: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
