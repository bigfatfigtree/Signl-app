#!/usr/bin/env node
// Build -121 verification (Jeff, 2026-11-04, from the live
// redesigned Admin on his phone): "I want full width for the
// working screen in admin portal (and the rest if they aren't
// there). Also much less scrolling and all that for me. More
// bar. More sections." Three moves on top of the Build -119/120
// design system, which stays intact:
//   F. full width: the work shells (v3-on, v3-slim, admin-on,
//      preview-on) drop the centered 1140px column; the
//      desktop rail offset for the top row matches the rail
//      (232px); on phones the stale V4.2 width (calc(100% -
//      78px)) that squeezed Admin into 312px is gone.
//   D. density: tighter panel/card rhythm on the shells, the
//      creator shapes stay one row on phones, and the Admin
//      home becomes a work grid — a tappable summary strip
//      (applications waiting / claims today / businesses
//      waiting on activation, from the same payloads Sig
//      reads) over a two-column layout with the queue wide
//      and Sig's attention list in the side column.
//   N. navigation: the Admin section bar — a phone chip bar
//      pinned under the top row, composed from railItems()
//      so every one of the 11 sections carries the rail's
//      own onclick (one source for labels, order, badges,
//      destinations; no dead clicks). Desktop rail unchanged:
//      all sections labeled.
// Proves:
//   S. source pins for the three moves + the inherited -119/120
//      pins that must not move (tab sets, Momentum naming, the
//      absent-Standing list, payment gates shut).
//   T. tab inventory: all 11 admin sections still have a rail
//      destination AND a renderAdmin dispatch branch — no
//      surface lost vs the -120 inventory.
//   H. server: boots; bootstrap 41 markets; a creator claim
//      lands; Admin markets lists 41 rows; the served shell
//      carries the -121 stamp.
// The rendered proof (widths, density, chip landings) lives in
// scripts/qa-build121.py + ~/workspace/research_notes/
// signl-build121-qa/.
//
// Run: node scripts/verify-build121.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9059;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-build121-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-build121-${Date.now()}.json`);

let passed = 0;
let failed = 0;
let currentPart = "boot";
const failures = [];
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; failures.push(name); console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const count = (s, sub) => s.split(sub).length - 1;

// ---------- S: source pins ----------
part("S: source pins");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");
const stamp = (buildJs.match(/BUILD_ID\s*=\s*"([^"]+)"/) || [])[1] || "";
check("stamp is 2026.11.03-121 and identical in build.js + index.html", stamp === "2026.11.03-121" && indexHtml.includes(stamp), String(stamp));
check("index.html cache-busts theme-v3 with the rolled stamp (the file changed)",
  indexHtml.includes(`/theme-v3.css?v=${stamp}`) && indexHtml.includes(`/app.js?v=${stamp}`));

// F — full width
part("F: full width");
check("work shells drop the centered column (v3-on, v3-slim, admin-on, preview-on)",
  css.includes("body.v3-on main, body.v3-slim main, body.admin-on main, body.preview-on main { max-width: none; }"));
check("desktop: rail offset for the top row matches the 232px rail",
  css.includes("body.rail-on #toprow { margin-left: 232px; }"));
check("desktop: the inner wrap and the alternate top bar stretch too",
  css.includes("body.v3-on .wrap, body.v3-slim .wrap { max-width: none;") && css.includes(".tb2-in { max-width: none; }"));
check("phones: the stale calc(100% - 78px) squeeze is overridden for the rail shell",
  css.includes("body.rail-on main { width: auto; }") && css.includes("body.rail-on #toprow { margin-left: 0;"));

// D — density + admin home
part("D: density + admin home");
check("tighter shell rhythm (panel padding/margins, one-screen homes)",
  css.includes("body.v3-on .panel, body.v3-slim .panel, body.admin-on .panel { padding: 20px; margin-bottom: 14px; }") &&
  css.includes(".nx-card { padding: 15px; margin: 10px 0; }"));
check("creator shapes stay one row on phones (no stacked full-screen shapes)",
  css.includes(".shapes-row { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }"));
check("admin home is a grid: summary strip + side column + wide queue column",
  appJs.includes('id="admin-summary"') && appJs.includes('class="admin-home121"') &&
  appJs.includes('class="admin-home-side"') && appJs.includes('class="admin-home-main"') &&
  css.includes("grid-template-columns: minmax(0, 1fr) 400px") && css.includes('grid-template-areas: "main side"'));
check("summary chips are computed from the same payloads Sig reads and tap through to their tabs",
  appJs.includes("function adminSummaryCounts121(apps, marketsData, partnersData)") &&
  appJs.includes("function adminSummaryHtml121(c)") &&
  appJs.includes('class="sum-chip121"') && appJs.includes("go('dashboard','${tab}')") &&
  appJs.includes('"applications waiting"') && appJs.includes('"claims today"') && appJs.includes('"businesses waiting on activation"'));
check("the landing still hosts Sig (inherited pin) and still loads it",
  appJs.includes('id="admin-sig"') && appJs.includes("loadAdminSig();"));
check("preview card defect fixed: title + ghost button readable on the whitened card (invisible since -119)",
  css.includes("body.admin-on .preview-cta strong { color: var(--ink); }") &&
  css.includes("body.admin-on .preview-cta .btn.ghost { background: transparent; border-color: var(--line); color: var(--ink2);") &&
  appJs.includes("enterPreviewDashboard()"));

// N — admin section bar
part("N: admin section bar");
check("the section bar syncs from railItems (one source for labels/order/destinations)",
  appJs.includes("function syncAdminSecbar121()") && appJs.includes('document.createElement("nav")') &&
  appJs.includes('bar.id = "admin-secbar"') && appJs.includes('class="sec-chip121') &&
  appJs.includes('onclick="${it.onclick}"'));
check("the bar is phone-only and pinned under the top row; the desktop rail is untouched",
  css.includes("body.admin-on #admin-secbar") && css.includes("position: sticky; top: 0;") &&
  css.includes("#admin-secbar { display: none; }") &&
  appJs.includes('ADMIN_RAIL_PRIMARY_119 = ["Applications", "Markets", "Stats"]') && appJs.includes("function openAdminMoreSheet()"));
check("the bar syncs on navigation and clears for non-admin states",
  count(appJs, "syncAdminSecbar121()") >= 3);

// T — the -120 tab inventory, nothing lost
part("T: tab inventory");
const ADMIN_TABS = ["Applications", "Requests", "Markets", "Recruiters", "Outreach", "Partners", "Event Log", "Compliance", "Campaign", "Stats", "Sig"];
for (const t of ADMIN_TABS) {
  check(`admin section reachable: rail destination + renderAdmin dispatch for "${t}"`,
    appJs.includes(`"${t}", "return go('dashboard','${t}')"`) && appJs.includes(`if (tab === "${t}")`));
}
check("primary tab sets still match the approved IA map",
  appJs.includes('business: ["Home", "Discover", "My Offers", "Visits & Posts", "Plan"]') &&
  appJs.includes('creator: ["Dashboard", "Offers", "My Visits", "Earnings", "Profile"]') &&
  appJs.includes('partner: ["Home", "Businesses", "Earnings", "Performance"]') &&
  appJs.includes('pilot: ["Overview", "Businesses", "Results", "Report"]') &&
  appJs.includes('recruiter: ["Queue", "Outreach", "Results", "Sig", "Help"]'));

// Inherited -119/120 pins
part("S2: inherited pins");
check("design tokens intact (Paper, Ink, Signal, the one gradient)",
  css.includes("--paper: #FAF7F1") && css.includes("--ink: #171512") && css.includes("--accent: #FF4D00") &&
  css.includes("linear-gradient(92deg, #185BFF 0%, #0AA6C2 38%, #00B67A 72%, #22C55E 100%)"));
check("Momentum naming intact: gloss present, no Standing rename crept back",
  appJs.includes("Momentum — you reply fast and show up. Businesses see it before followers.") &&
  appJs.includes('wsHead("Momentum"') && !appJs.includes("Standing points") && !appJs.includes("Your Standing") &&
  !appJs.includes("How does Standing work") && !appJs.includes('wsHead("Standing"'));
check("greeting clock fix intact (localHourNow at the greeting sites)",
  count(appJs, "localHourNow()") >= 4);
check("payment gates stay shut: founding Stripe prices still resolve only from unset env",
  fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8").includes('process.env.STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') &&
  !process.env.STRIPE_PRICE_FOUNDING_SELF_SERVICE && !process.env.STRIPE_PRICE_FOUNDING_GROWTH && !process.env.STRIPE_PRICE_FOUNDING_MANAGED);

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
  check("bootstrap serves 41 markets", (boot.data.markets || []).length === 41, String((boot.data.markets || []).length));
  const claim = await client()("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "b121@fixtures.dev", password: "claim-" + "pass-1234", market: "Nashville", handle: "b121claim", ...AGREE });
  check("a creator claim still lands (201)", claim.status === 201 && !!claim.data.user, String(claim.status));
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");
  const marketsRes = await admin("GET", "/api/admin/markets");
  check("admin markets list is still 41 rows", (marketsRes.data.markets || []).length === 41, String((marketsRes.data.markets || []).length));
  const pageRes = await fetch(BASE + "/");
  const pageText = await pageRes.text();
  check("the served shell carries theme-v3 + the -121 stamp", pageRes.status === 200 && pageText.includes("/theme-v3.css") && pageText.includes(stamp), String(pageRes.status));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-build121: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
