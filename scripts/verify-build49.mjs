// Build -49 verification: the POINTS-WHY PASS (Jeff's standing
// order, 2026-10-30: "Always explain why points matter.
// Everywhere we can."; fresh-eyes audit A-08 found the same gap:
// mechanics without meaning, "what points buy is only ever
// implied"). The app printed point numbers in many places
// without saying what points DO. This build defines ONE
// canonical why, built only from mechanics verified in the
// code, and pairs it with the number on every surface:
//
//   - total points are 0.20 x min(100, total) of the applicant
//     stack score a business picks from (rankApplications);
//     local % 0.35, Local Impact 0.25, reliability 0.20;
//   - roster cards carry the total and businesses can sort the
//     roster by Momentum (?sort=momentum);
//   - levels run over the total (Starter 0, Regular 100,
//     Standout 300, Cornerstone 750) and each level's hours
//     (0/12/18/24) open new offers early in a live market.
//
// Points are not money and never promise a booking; the learned
// fit score does NOT use points today and the creator offer
// feed is newest-first, so no copy may claim either.
//
// This suite asserts: (1) the canonical lines exist verbatim
// and are defined once; (2) every inventoried surface renders
// the why next to its number; (3) the mechanics the wording
// rests on are still in the code; (4) a guard: the new copy
// promises no benefit absent from the verified mechanics.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8917;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = `/tmp/signl-verify-build49-${Date.now()}.json`;
const ADMIN_EMAIL = "admin@verify.local";
const ADMIN_PW = "build49-fixture-admin-pass";

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; failures.push(name + (detail ? " — " + detail : "")); console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const appJs = read("public/app.js");
const sigaiJs = read("netlify/functions/lib/sigai.js");
const routerJs = read("netlify/functions/lib/router.js");

function slice(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) return "";
  const b = endMarker ? src.indexOf(endMarker, a + startMarker.length) : -1;
  return src.slice(a, b < 0 ? undefined : b);
}
const count = (src, needle) => src.split(needle).length - 1;

const WHY_LONG = "Points are priority. They move you up the list businesses choose from when you apply, they ride on your roster card where businesses can sort by them, and they raise your level: Regular, Standout and Cornerstone see new offers 12, 18 and 24 hours early once your market is live. Points are not money, and they never promise a booking.";
const WHY_SHORT = "Points are priority: they move you up the list businesses choose from, and they raise your level.";
const WHY_POP = "Points move you up the list businesses choose from and raise your level; higher levels see new offers earlier.";
const WHY_SHORT_ES = "Los puntos son prioridad: te suben en la lista de la que eligen los negocios, y suben tu nivel.";

// ---------- 1. canon: defined once, verbatim ----------
check("canon: WHY_LONG is defined verbatim, once",
  count(appJs, `const POINTS_WHY_LONG = "${WHY_LONG}";`) === 1);
check("canon: WHY_SHORT is defined verbatim, once",
  count(appJs, `const POINTS_WHY_SHORT = "${WHY_SHORT}";`) === 1);
check("canon: WHY_POP is defined verbatim, once",
  count(appJs, `const POINTS_WHY_POP = "${WHY_POP}";`) === 1);

// ---------- 2. surface coverage ----------
check("surface: Momentum panel (momentumHtml) pairs the total with WHY_LONG and keeps the pinned sources line",
  slice(appJs, "function momentumHtml(u)", "function fmtNum").includes("${POINTS_WHY_LONG}")
  && appJs.includes("Earned for on-time posts, a complete profile, reviews and invites."));
check("surface: Momentum tab KPI card carries WHY_LONG under the giant number",
  slice(appJs, "function renderMomentumTab()", "// Creator Earnings").includes("${POINTS_WHY_LONG}"));
check("surface: Points and Your Line panel carries WHY_LONG under the level rows",
  slice(appJs, "async function loadPointsCard()", "function proofSectionHtml").includes("${POINTS_WHY_LONG}"));
check("surface: the Points panel actually loads (Build -49 fix: loadPointsCard called \"/api/me/points\" through the api() helper, which prefixes /api itself, so the card 404'd into its fallback text on every render since Build -36; no earlier suite rendered the card live)",
  appJs.includes('api("GET", "/me/points")') && !appJs.includes('api("GET", "/api/me/points")'));
check("surface: Golden Ticket panel pairs its +100/+25/+10/+3 table with WHY_SHORT and keeps the nothing-for-a-click line",
  (() => { const s = slice(appJs, "async function loadGoldenTickets()", "async function gtIssue"); return s.includes("${POINTS_WHY_SHORT}") && s.includes("Nothing is paid for a click or a share.") && s.includes("+100 points") && s.includes("+25 points") && s.includes("+10 points") && s.includes("+3 points"); })());
check("surface: founding Home Momentum KPI sub is WHY_SHORT",
  appJs.includes(`kpiCard("Momentum", fmtNum(momPts), { sub: POINTS_WHY_SHORT })`));
check("surface: Numbers tab Momentum KPI sub is WHY_SHORT",
  appJs.includes(`kpiCard("Momentum", fmtNum(m.points || 0), { sub: POINTS_WHY_SHORT })`));
check("surface: Momentum trend chart sub carries WHY_SHORT",
  appJs.includes("Your points, day by day, last 30 days. ${POINTS_WHY_SHORT}"));
check("surface: live Home Momentum card (above the Activity feed of earn lines) carries WHY_SHORT",
  slice(appJs, "const momentumCard", "// Activity").includes("${POINTS_WHY_SHORT}"));
check("surface: Grow your roster keeps its pinned line and appends WHY_SHORT",
  slice(appJs, "function growRosterHtml(u)", "// Earn-row deep links").includes("Roster builders get seen first. ${POINTS_WHY_SHORT}"));
check("surface: public profile stat cell explains the number for the business reader; the old sources parenthetical is gone",
  appJs.includes("Momentum points · part of the order businesses see") && !appJs.includes("Momentum points (reliability and referrals)"));
check("surface: Admin Your Line lookup intro carries WHY_SHORT for the team",
  appJs.includes("Points land only when an invite finishes signing up. ${POINTS_WHY_SHORT}"));
check("surface: Sig operator lines carry WHY_SHORT inline in English (const + 3 Sig lines = 4 occurrences)",
  count(appJs, WHY_SHORT) === 4, `found ${count(appJs, WHY_SHORT)}`);
check("surface: Sig operator lines carry the why inline in Spanish (3 Sig lines)",
  count(appJs, WHY_SHORT_ES) === 3, `found ${count(appJs, WHY_SHORT_ES)}`);
check("surface: Sig Q&A canon now states the level effect with the verified thresholds and hours",
  sigaiJs.includes("Points also set the level: Starter, then Regular at 100 points, Standout at 300, Cornerstone at 750")
  && sigaiJs.includes("Regular sees new offers 12 hours early, Standout 18 hours early, and Cornerstone 24 hours early"));
check("aligned surfaces kept verbatim: the founding payoff card and the Deal Card rules already carried the why",
  appJs.includes("Momentum moves you up") && appJs.includes("part of the stack order the business picks from")
  && appJs.includes("Points order the creator list businesses see."));

// ---------- 3. mechanics the wording rests on ----------
check("mechanics: level thresholds and early-access hours in code match the copy (0/0h, 100/12h, 300/18h, 750/24h)",
  routerJs.includes('{ level: 1, name: "Starter", at: 0, earlyAccessHours: 0 }')
  && routerJs.includes('{ level: 2, name: "Regular", at: 100, earlyAccessHours: 12 }')
  && routerJs.includes('{ level: 3, name: "Standout", at: 300, earlyAccessHours: 18 }')
  && routerJs.includes('{ level: 4, name: "Cornerstone", at: 750, earlyAccessHours: 24 }'));
check("mechanics: total points carry the 0.20 stack weight in rankApplications",
  routerJs.includes("0.2 * Math.min(100, totalPts)"));
check("mechanics: invite finish points are still 100 / 25 / 10",
  routerJs.includes("const INVITE_FINISH_POINTS = [100, 25, 10];"));
check("mechanics: businesses can still sort the roster by Momentum",
  routerJs.includes('query.sort === "momentum"'));

// ---------- 4. guard: no unpromised benefit in the new copy ----------
const BANNED = ["guarantee", "first in line", "top of the list", "more bookings", "get booked", "unlock badges", "your order in business search", "order your offers"];
check("guard: the canonical lines promise no benefit absent from the verified mechanics",
  BANNED.every((b) => !WHY_LONG.includes(b) && !WHY_SHORT.includes(b) && !WHY_POP.includes(b)),
  BANNED.filter((b) => WHY_LONG.includes(b) || WHY_SHORT.includes(b) || WHY_POP.includes(b)).join(", "));
check("guard: the long line keeps the honesty tails (not money, never a promised booking)",
  WHY_LONG.includes("Points are not money") && WHY_LONG.includes("never promise a booking"));
check("guard: no new copy claims points order the creator's own offer feed",
  !appJs.includes("points order your offers") && !appJs.includes("Points order your offers"));

// ---------- live: the panel's numbers still come from the payload ----------
function client() {
  const jar = new Map();
  async function call(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (jar.size) headers.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, data, headers: res.headers };
  }
  return call;
}

let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ["ADMIN_" + "PASSWORD"]: ADMIN_PW, APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  startServer();
  check("live: dev server boots", await waitUp());
  const boot = await fetch(BASE + "/api/bootstrap");
  check("live: bootstrap carries the -49 build stamp", boot.headers.get("x-signl-build") === "2026.10.30-59", String(boot.headers.get("x-signl-build")));

  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, ["pass" + "word"]: ADMIN_PW });
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name: "Why Wendy", email: "wendy49@fixtures.dev", password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle: "whywen49", followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"],
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("live: fixture creator registers", reg.status === 201, JSON.stringify(reg.data).slice(0, 160));
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  const pts = await c("GET", "/api/me/points");
  const ways = Object.fromEntries(((pts.data && pts.data.waysToEarn) || []).map((w) => [w.label, w.points]));
  check("live: /me/points still prices every award the panels print (100 / 25 / 10 / 10)",
    pts.status === 200 && ways["A creator you invite finishes signing up"] === 100
    && ways["Their invites finish signing up"] === 25 && ways["One more step out"] === 10
    && ways["An invite gets approved"] === 10, JSON.stringify(pts.data).slice(0, 200));
  check("live: a new creator's level is Starter with no early access (the level lines' floor state)",
    pts.data && pts.data.level && pts.data.level.name === "Starter" && pts.data.level.earlyAccessHours === 0
    && pts.data.level.nextAt === 100 && pts.data.level.nextName === "Regular", JSON.stringify(pts.data && pts.data.level));
} catch (e) {
  check("live block completed without exception", false, String(e && e.message || e));
} finally {
  await stopServer();
}

console.log(`\nverify-build49: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
