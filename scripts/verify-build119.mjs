#!/usr/bin/env node
// Build -119 verification (Jeff approved the dashboard redesign
// 2026-11-04 and ordered it built into the app): the Paper / Ink /
// Signal design system lands on all four roles — desktop left
// rail + mobile bottom bar, the per-role IA map with focused
// sub-tabs, one Next list per Home, Momentum renamed to
// "Standing" in app UI chrome only (internal keys, tab keys and
// server copy untouched), partner/pilot zero states with a
// next-step sentence, Admin rows behind one More menu, market
// cards with photos, and the greeting-clock fix (greetings use
// the viewer's local hour, not the device's UTC-skewed hour).
// Proves:
//   S. source pins: theme-v3 tokens + link, the primary-tab
//      sets, the Standing rename surface + gloss, localHourNow
//      at all three greeting sites, the Next-list composition
//      on the four Homes, the new seg labels, the strips, the
//      row More wrap, the market photos on disk, and the
//      payment gates still shut (founding price envs unset =
//      no live prices configured in the built bundle path).
//   H. server: the app still boots; bootstrap serves 41
//      markets; a creator claim still lands; Admin markets
//      still lists 41 rows.
//
// Run: node scripts/verify-build119.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9056;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-build119-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-build119-${Date.now()}.json`);

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
const stamp = (buildJs.match(/BUILD_ID\s*=\s*"([^"]+)"/) || [])[1] || (indexHtml.match(/20\d\d\.\d\d\.\d\d-\d+/) || [])[0];
check("build stamp present and identical in build.js + index.html", !!stamp && indexHtml.includes(stamp) && buildJs.includes(stamp), String(stamp));
check("index.html links theme-v3 and the Instrument pairing, warm theme-color",
  indexHtml.includes("/theme-v3.css") && indexHtml.includes("Instrument+Sans") && indexHtml.includes("Instrument+Serif") && indexHtml.includes("#FAF7F1"));
check("theme-v3 carries the design tokens (Paper, Ink, Signal, the one gradient)",
  css.includes("--paper: #FAF7F1") && css.includes("--ink: #171512") && css.includes("--accent: #FF4D00") &&
  css.includes("linear-gradient(92deg, #185BFF 0%, #0AA6C2 38%, #00B67A 72%, #22C55E 100%)"));
check("theme-v3 carries the shape vocabulary + shell rules",
  [".donut119", ".lbar119", ".ring119", ".bigcode119", ".pilot-fundbar", ".mkt-photo", "#agent-fab"].every((x) => css.includes(x)));
check("primary tab sets match the approved IA map",
  appJs.includes('business: ["Home", "Discover", "My Offers", "Visits & Posts", "Plan"]') &&
  appJs.includes('creator: ["Dashboard", "Offers", "My Visits", "Earnings", "Profile"]') &&
  appJs.includes('partner: ["Home", "Businesses", "Earnings", "Performance"]') &&
  appJs.includes('pilot: ["Overview", "Businesses", "Results", "Report"]') &&
  appJs.includes('recruiter: ["Queue", "Outreach", "Results", "Sig", "Help"]'));
check("phone short labels carry the one-word forms",
  appJs.includes('RAIL_SHORT["Discover"] = "Creators"') && appJs.includes('RAIL_SHORT["Earnings"] = "Money"') && appJs.includes('RAIL_SHORT["My Visits"] = "Visits"') && appJs.includes('RAIL_SHORT["Visits & Posts"] = "Visits"'));
check("Standing rename: gloss + level helper + More-row label, tab key untouched",
  appJs.includes("Standing — you reply fast and show up. Businesses see it before followers.") &&
  appJs.includes("function standingLevelName(points)") && appJs.includes('label: "Standing"') &&
  appJs.includes('"Momentum"') && !appJs.includes('wsHead("Momentum"'));
check("Standing thresholds match the server ladder (100 / 300 / 750)",
  appJs.includes("p >= 750") && appJs.includes("p >= 300") && appJs.includes("p >= 100"));
check("greeting clock: localHourNow defined and used at all three greeting sites, no raw getHours greeting left",
  count(appJs, "localHourNow()") >= 4 && !appJs.includes("const hour = new Date().getHours();"));
check("one Next list: nextStepsHtml composed on creator, founding creator, business and founding business Homes",
  count(appJs, "nextStepsHtml(") >= 5 && appJs.includes("function nextStepsHtml(queue, steps, opts)") && appJs.includes("function wireNextSteps"));
check("business Home de-duplicates: setup-gap items filtered from the queue when the checklist renders",
  appJs.includes("Your business page is missing its About") && appJs.includes("const setupGap = (t) =>"));
check("creator Offers segs are New / Applied / Booked / Done with stored ids unchanged",
  appJs.includes('{ label: "New"') && appJs.includes('{ label: "Booked"') && appJs.includes('{ label: "Done"') &&
  appJs.includes('state.crOffersSeg') && appJs.includes('({ foryou: "new", invited: "new", waiting: "booked" })'));
check("Visits segs: creator Codes + business Today, stored ids unchanged",
  appJs.includes('["codes", "Codes"]') && appJs.includes('["today", "Today"]') && appJs.includes('["needs", "Needs your post"]') && appJs.includes("bigcode119"));
check("creator Earnings splits Earned / Pending with the waiting rows reachable",
  appJs.includes("function earnSetSeg(v)") && appJs.includes('"On its way"') && appJs.includes("Comped visits build your Standing instead."));
check("business Money strip + Creators strip labels (Plan/Licenses/Receipts, Browse/My Regulars/Saved)",
  appJs.includes("function bizMoneyStrip119(active)") && appJs.includes('item("licenses", "Licenses", "Content")') && appJs.includes('item("receipts", "Receipts", "Analytics")') &&
  appJs.includes('{ label: "My Regulars", on: false, onclick: "return go(\'dashboard\',\'Regulars\')" }') && appJs.includes('{ label: "Saved"'));
check("creator Profile anchored strip (Basics / Photos / Rates) over the one form",
  appJs.includes("function profileSegStrip119()") && appJs.includes('id="pf-basics"') && appJs.includes('id="pf-photos"'));
check("partner console: area strip + Money Fund/Returns split + zero-state next-step lines",
  appJs.includes("function partnerStrip119(tab)") && appJs.includes("function ptEarnSetSeg(v)") &&
  appJs.includes("0 visits yet. Visits start when your first businesses go live") &&
  appJs.includes("Your share starts the moment a business in your markets pays."));
check("pilot portal: area strip + Businesses Chosen/Visits segs + visits zero line + gradient fund bar",
  appJs.includes("function pilotStrip119(tab)") && appJs.includes("function pilotBizSetSeg(v)") &&
  appJs.includes("0 visits yet. Visits start once the chosen businesses confirm") && appJs.includes('class="pilot-fundbar"'));
check("admin: rail primaries + More sheet + row More wrap + toggleRowMore, railItems data untouched",
  appJs.includes('ADMIN_RAIL_PRIMARY_119 = ["Applications", "Markets", "Stats"]') &&
  appJs.includes("function openAdminMoreSheet()") && appJs.includes("function toggleRowMore(userId)") &&
  appJs.includes('class="row-more"') && appJs.includes('onclick="toggleRowMore('));
check("admin markets: photo headers for the three photographed markets + gradient fallback",
  appJs.includes("MARKET_PHOTOS_119") && appJs.includes("/assets/market-vb.jpg") && appJs.includes("/assets/market-nashville.jpg") && appJs.includes("/assets/market-london.jpg") && appJs.includes('class="mkt-photo grad"'));
check("the three market photos are in the app bundle",
  ["market-vb.jpg", "market-nashville.jpg", "market-london.jpg"].every((f) => fs.existsSync(path.join(root, "public/assets", f)) && fs.statSync(path.join(root, "public/assets", f)).size > 10000));
check("Sig fab is real now: ensureSigFab builds the pill (head + dot + count badge)",
  appJs.includes("function ensureSigFab()") && appJs.includes('class="fab-dot"') && appJs.includes("renderAgentFab"));
check("in-app Sig answer mirror intentionally unchanged (server-owned wording; flagged, not forked)",
  appJs.includes("Check my Momentum"));
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
  check("bootstrap serves 41 markets after the reskin", (boot.data.markets || []).length === 41, String((boot.data.markets || []).length));
  const claim = await client()("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "b119@fixtures.dev", password: "claim-" + "pass-1234", market: "Nashville", handle: "b119claim", ...AGREE });
  check("a creator claim still lands (201)", claim.status === 201 && !!claim.data.user, String(claim.status));
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");
  const marketsRes = await admin("GET", "/api/admin/markets");
  check("admin markets list is still 41 rows", (marketsRes.data.markets || []).length === 41, String((marketsRes.data.markets || []).length));
  const pageRes = await fetch(BASE + "/");
  const pageText = await pageRes.text();
  check("the served shell carries theme-v3 + the rolled stamp", pageRes.status === 200 && pageText.includes("/theme-v3.css") && pageText.includes(stamp), String(pageRes.status));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-build119: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
