#!/usr/bin/env node
// Build -125 verification (Jeff, 2026-11-04, approved the
// navigation design round: "Approved"): the navigation model.
//   B. bars/rails carry ONLY the daily stops, in the design's
//      order and one-word labels — Creator: Home · Offers ·
//      Visits · Messages · Wallet; Business: Home · Creators ·
//      Campaigns · Visits · Wallet; Partner: Overview ·
//      Businesses · Wallet · Reports; Admin phone bar: Review
//      · Creators · Markets · Wallet.
//   E. the Everything panel: one button top-right beside chat
//      and help (every role, both widths), opening a grouped
//      PANEL (not a page) with the design's groupings; every
//      section that existed before the build is still
//      reachable — bar, panel, or in-view sub-tabs.
//   W. Money → Wallet everywhere user-facing, with the Wallet
//      views carrying Cash · Comps · History (creator), Plan ·
//      Bookings · Receipts (business), Fund · Returns
//      (partner), and Admin's money view labeled Wallet —
//      comps/store value never summed into cash.
//   P. the creator "Profile" tab is the real profile only;
//      the "More"-titled list view is gone entirely.
//   S. Sig knows the new map (Wallet names + deep links).
// Proves:
//   S. source pins for all five moves + the inherited pins
//      that must not move (Momentum naming, payment gates).
//   T. reachability: every pre-build route/section per role
//      still has a dispatch branch, and every buried section
//      has a named home in the Everything groups.
//   H. server: boots; bootstrap 45 markets; a creator claim
//      lands; Admin markets lists 45 rows; the served shell
//      carries the -125 stamp.
// The rendered proof (bars, panel open, Wallet sub-tabs,
// every panel row clicked through) lives in
// scripts/qa-build125.py + ~/workspace/research_notes/
// signl-build125-qa/.
//
// Run: node scripts/verify-build125.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9063;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-build125-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-build125-${Date.now()}.json`);

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
const sigdata = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");
const stamp = (buildJs.match(/BUILD_ID\s*=\s*"([^"]+)"/) || [])[1] || "";
check("stamp is 2026.11.05-131 and identical in build.js + index.html", stamp === "2026.11.05-131" && indexHtml.includes(stamp), String(stamp));
check("index.html cache-busts app.js + theme-v3 with the rolled stamp",
  indexHtml.includes(`/app.js?v=${stamp}`) && indexHtml.includes(`/theme-v3.css?v=${stamp}`));

// B — daily-stop bars
part("B: daily stops only");
check("primary tab sets are the design's daily stops per role",
  appJs.includes('business: ["Home", "Discover", "My Offers", "Visits & Posts", "Plan"]') &&
  appJs.includes('creator: ["Dashboard", "Offers", "My Visits", "Messages", "Earnings"]') &&
  appJs.includes('partner: ["Home", "Businesses", "Earnings", "Performance"]') &&
  appJs.includes('pilot: ["Overview", "Businesses", "Results", "Report"]') &&
  appJs.includes('recruiter: ["Queue", "Outreach", "Results", "Sig", "Help"]'));
check("creator Profile is NOT a bar stop any more; Messages is",
  !appJs.includes('creator: ["Dashboard", "Offers", "My Visits", "Earnings", "Profile"]'));
check("bar display labels are the design's one-word forms (Wallet for Earnings + Plan)",
  appJs.includes('const NAV_LABEL_125 = { Dashboard: "Home", "My Visits": "Visits", "Visits & Posts": "Visits", Earnings: "Wallet", Plan: "Wallet", Discover: "Creators", "My Offers": "Campaigns", Performance: "Reports", Businesses: "Business" }'));
check("the bar renders primaries first (+ Sig pin, scope exit, Everything) — Build -130 Part 6 supersedes the -125 rail model: every other destination now rides the desktop rail as a secondary under a More group label (phones still hide secondaries and keep the panel)",
  appJs.includes("const ordered = prim.map((t) => byTab[t]).filter(Boolean);") &&
  !appJs.includes('list.push({ icon: "more", label: "More", tab: "More"') &&
  appJs.includes("const secondary = items.filter") &&
  appJs.includes('<div class="tab-grouplabel">More</div>'));
check("admin phone bar primaries are Review · Creators · Markets · Stats (Creators is its own tab and Admin has no Wallet — Build -130 Part 9)",
  appJs.includes('const ADMIN_RAIL_PRIMARY_125 = ["Applications", "Creators", "Markets", "Stats"];') &&
  !appJs.includes('rail-label-short') &&
  appJs.includes('add("a", "users", "Creators", "return go(\'dashboard\',\'Creators\')"'));
check("admin rail no longer renders a More button",
  !appJs.includes('rail-item rail-primary rail-more'));

// E — the Everything panel
part("E: Everything panel");
check("panel machinery exists (groups, open, close) and renders a panel, not a page",
  appJs.includes("function everythingGroups125()") && appJs.includes("function openEverything125()") &&
  appJs.includes("function closeEverything125()") && appJs.includes('class="ev125-panel"') &&
  appJs.includes('el.id = "everything-panel125"'));
check("the button rides the top bar beside chat + help, the desktop rail, and the admin top row",
  appJs.includes('class="tb2-btn tb2-ev125"') && appJs.includes('class="tab-item tab-ev125"') && appJs.includes('class="tr-ev125"'));
check("panel CSS: sheet on phones, top-right card on desktop",
  css.includes(".ev125-overlay") && css.includes(".ev125-panel") && css.includes("border-radius: 22px 22px 0 0") &&
  css.includes("width: 400px") && css.includes(".ev125-group h5"));
check("creator groups are the design's: Grow / You / Help",
  appJs.includes('{ title: "Grow", rows: [') && appJs.includes('{ title: "You", rows: [') && appJs.includes('{ title: "Help", rows: ['));
check("business groups are the design's: Your place / Grow / Account",
  appJs.includes('{ title: "Your place", rows: [') && appJs.includes('{ title: "Account", rows: ['));
check("partner groups are the design's: Your market / Terms / Account",
  appJs.includes('{ title: "Your market", rows: [') && appJs.includes('{ title: "Terms", rows: [') &&
  appJs.includes("ptEarnGo125('fund')") && appJs.includes("ptEarnGo125('returns')"));
check("admin groups are the design's: Review & people / Watch / System (Creators row present, Wallet row removed — Build -130 Part 9)",
  appJs.includes('{ title: "Review & people", rows: [') && appJs.includes('{ title: "Watch", rows: [') && appJs.includes('{ title: "System", rows: [') &&
  appJs.includes("function adminCreatorsGo125()") && !appJs.includes("function adminWalletGo125()"));
check("the creator Momentum panel row carries the level word as its status",
  appJs.includes('"Momentum", "", "Momentum", { status: lvl }'));

// W — Money → Wallet
part("W: Wallet rename");
check("no creator/business Money nav label remains (the Admin books strip's Money tab is the one allowed exception — Build -130 Part 9)",
  appJs.includes('{ label: "Money", on: ccTab === "money"') && !appJs.includes('RAIL_SHORT["Earnings"] = "Money"') &&
  !appJs.includes('rail-label-short">Money<') && !appJs.includes('return "Open Money"') &&
  !appJs.includes('"Open Earnings"') && !appJs.includes('under Earnings') && !appJs.includes('"See my earnings"') &&
  !sigdata.includes('"Open Earnings"') && !sigdata.includes('under Earnings') && !sigdata.includes('"See Earnings"'));
check("creator Wallet head + Cash · Comps · History sub-tabs",
  appJs.includes('wsHead("Wallet", { sub: "Cash, comps and history — kept separate, the way a wallet is."') &&
  appJs.includes('{ label: "Cash", on: wseg === "cash", onclick: "return walletSetSeg125(\'cash\')" }') &&
  appJs.includes('{ label: "Comps", on: wseg === "comps", onclick: "return walletSetSeg125(\'comps\')" }') &&
  appJs.includes('{ label: "History", on: wseg === "history", onclick: "return walletSetSeg125(\'history\')" }') &&
  appJs.includes("function walletSetSeg125(v)"));
check("Cash/Comps separation is structural: comps computed apart, history tags kinds, totals never added",
  appJs.includes('const compBookings = bookings.filter((b) => !b.paidLane && b.kind !== "coupon"') &&
  appJs.includes('kind: "Comp"') && appJs.includes('kind: "Cash"') &&
  appJs.includes("Two different piles — they are never added together.") &&
  appJs.includes("it never counts as cash earned"));
check("business Wallet head + Plan · Bookings · Receipts sub-tabs on the Plan screen",
  appJs.includes('wsHead("Wallet", { sub: "Your plan, what paid visits cost, and your receipts — one place."') &&
  appJs.includes("function bizWalletTabs125(active)") && appJs.includes("function bizWalletSetSeg125(v)") &&
  appJs.includes("function loadBizWalletBookings125()") && appJs.includes('id="biz-wallet-bookings"'));
check("partner Wallet: head + strip read Wallet, Fund/Returns kept",
  appJs.includes('wsHead("Wallet", { sub: "Your share of subscription revenue in your markets."') &&
  appJs.includes('item("Earnings", "Wallet", "Earnings")') &&
  appJs.includes('{ label: "Fund", on: state.partnerEarnSeg !== "returns"') && appJs.includes('{ label: "Returns", on: state.partnerEarnSeg === "returns"'));
check("admin money view reads Money in the Stats books (the Admin Wallet label is abolished — Build -130 Part 9D)",
  appJs.includes('{ label: "Money", on: ccTab === "money", onclick: "return ccSetTab(\'money\')" }') &&
  !appJs.includes('{ label: "Wallet", on: ccTab === "money"'));
check("the old cross-screen money strip is gone (Content and Results stand alone)",
  !appJs.includes("bizMoneyStrip119("));

// P — Profile is the real profile (+ the -123 Connected accounts hub, landed on top); More is gone
part("P: Profile + More abolition");
check("the More screen, the appended More lists and the business More sheet are deleted",
  !appJs.includes("function renderMoreScreen()") && !appJs.includes("function moreLinksHtml119()") &&
  !appJs.includes("function openMoreSheet()") && !appJs.includes('wsHead("More"'));
check("no role's tab inventory routes a More tab",
  !appJs.includes('"Earnings", "More"') && !appJs.includes('"Profile", "More"') && !appJs.includes('"Account", "More"') && !appJs.includes('"Plan", "Messages", "Profile", "More"'));
check("creator Profile (live + founding) is head + segments + the profile form + the -123 Connected accounts hub (Momentum/Grow/More appends stay deleted; pin re-aimed at the landing, 2026-11-04)",
  count(appJs, 'profileSegStrip119() + creatorProfileHtml(u) + connectedAccountsHtml(u);') === 2 &&
  !appJs.includes("creatorProfileHtml(u) + momentumHtml(u)") && !appJs.includes("creatorProfileHtml(u) + moreLinksHtml119()"));
check("identity row lands per role (partner → Account, pilot → Overview), never a blind Profile — RE-AIMED by Build -126: the identity opens the identity MENU on every shell (openIdentityMenu126 on the top bar + rail foot); the one-destination helper is deleted",
  !appJs.includes("function identityDest125()") &&
  appJs.includes("onclick=\"return openIdentityMenu126()\"") &&
  appJs.includes("function identityMenuRows126()"));

// S — Sig knows the map
part("S: Sig map");
check("Sig deep links carry the Wallet names to the same screens",
  appJs.includes('case "cr-wallet": return go("dashboard", "Earnings");') &&
  appJs.includes('case "biz-wallet": return go("dashboard", "Plan");') &&
  appJs.includes('case "partner-wallet": return go("dashboard", "Earnings");') &&
  appJs.includes('case "admin-wallet": ccTab = "money"; return go("dashboard", "Stats");') &&
  appJs.includes('case "admin-creators": return go("dashboard", "Creators");'));
check("Sig's creator flow is titled for the Wallet",
  appJs.includes('flow("See my wallet"') && sigdata.includes('"Open Wallet", "cr-earnings"') && sigdata.includes('"See your Wallet", "partner-earnings"'));

// Inherited pins
part("S2: inherited pins");
check("Momentum naming intact (Build -120), Sig orb art intact (Build -130; -124's portrait retired), photo avatars intact (Build -122)",
  appJs.includes("Momentum — you reply fast and show up. Businesses see it before followers.") &&
  appJs.includes('const SIG_ART = "/assets/sig-orb";') && appJs.includes("function selfAvatarUrl122(u)") && appJs.includes("function avaHtml122("));
check("payment gates stay shut: founding Stripe prices still resolve only from unset env",
  fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8").includes('process.env.STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') &&
  !process.env.STRIPE_PRICE_FOUNDING_SELF_SERVICE && !process.env.STRIPE_PRICE_FOUNDING_GROWTH && !process.env.STRIPE_PRICE_FOUNDING_MANAGED);

// ---------- T: reachability ----------
// Every route that existed before -125 still dispatches, and
// every formerly buried section has a named home: the bar,
// the Everything panel, or an in-view sub-tab.
part("T: reachability");
const CREATOR_TABS = ["Dashboard", "Profile", "Offers", "My Visits", "Messages", "Earnings", "Momentum", "Numbers", "Settings", "Help", "Sig", "Bench"];
for (const t of CREATOR_TABS) {
  check(`creator route still dispatches: "${t}"`, appJs.includes(`tab === "${t}"`) || appJs.includes(`"${t}" === tab`));
}
check("creator founding Status route still dispatches", appJs.includes('tab === "Status"'));
const BUSINESS_TABS = ["Home", "Discover", "Favorites", "Campaign Setup", "My Offers", "Counter", "Visits & Posts", "Regulars", "Content", "Analytics", "Plan", "Messages", "Profile", "Settings", "Help", "Sig"];
for (const t of BUSINESS_TABS) {
  check(`business route still dispatches: "${t}"`, appJs.includes(`tab === "${t}"`));
}
check("business Requests still lands on the Offers applicants segment", appJs.includes('if (tab === "Requests") { state.offersSeg = "applicants"; tab = "My Offers"; }'));
const PARTNER_TABS = ["Home", "Markets", "Creators", "Businesses", "Performance", "Earnings", "Links", "Account", "Help", "Sig", "Team"];
for (const t of PARTNER_TABS) {
  check(`partner route still dispatches: "${t}"`, appJs.includes(`tab === "${t}"`));
}
const PILOT_TABS = ["Businesses", "Results", "Report", "Sig", "Team", "Help"];
for (const t of PILOT_TABS) {
  check(`pilot route still dispatches: "${t}"`, appJs.includes(`tab === "${t}"`));
}
check("pilot route still dispatches: \"Overview\" (the fallthrough home)",
  appJs.includes('const PILOT_TABS = ["Overview", "Businesses", "Results", "Report", "Sig", "Team", "Help"]') && appJs.includes("loadPilotOverview(el);"));
const ADMIN_TABS = ["Applications", "Requests", "Markets", "Recruiters", "Outreach", "Partners", "Event Log", "Compliance", "Campaign", "Stats", "Sig"];
for (const t of ADMIN_TABS) {
  check(`admin section reachable: rail destination + renderAdmin dispatch for "${t}"`,
    appJs.includes(`"${t}", "return go('dashboard','${t}')"`) && appJs.includes(`if (tab === "${t}")`));
}
// The old creator Profile/More list, row by row, with its new home:
part("T2: the old buried lists, accounted for");
const CREATOR_PANEL = [["Your numbers", "Numbers"], ["Momentum", "Momentum"], ["Bench", "Bench"], ["My profile", "Profile"], ["Founding status", "Status"], ["Settings", "Settings"], ["Help centre", "Help"]];
for (const [label, tab] of CREATOR_PANEL) {
  check(`creator panel row: "${label}" → ${tab}`, appJs.includes(`"${label}"`) && appJs.includes(`"${tab}"`));
}
check("creator Visits + Wallet + Messages are bar stops now (were rows in the buried list)",
  appJs.includes('creator: ["Dashboard", "Offers", "My Visits", "Messages", "Earnings"]'));
const BIZ_PANEL = [["Business profile", "Profile"], ["Team & register PIN", "Settings"], ["Set up a campaign", "Campaign Setup"], ["Saved creators", "Favorites"], ["My Regulars", "Regulars"], ["License library", "Content"], ["Results", "Analytics"], ["Plan & billing", "Plan"], ["Messages", "Messages"], ["Settings", "Settings"], ["Help", "Help"]];
for (const [label, tab] of BIZ_PANEL) {
  check(`business panel row: "${label}" → ${tab}`, appJs.includes(`R("`) && appJs.includes(`"${label}"`) && appJs.includes(`"${tab}"`));
}
const PT_PANEL = [["Creators", "Creators"], ["Market roster", "Markets"], ["Outreach", "Links"], ["Account", "Account"], ["Help", "Help"]];
for (const [label, tab] of PT_PANEL) {
  check(`partner panel row: "${label}" → ${tab}`, appJs.includes(`"${label}"`) && appJs.includes(`"${tab}"`));
}
check("partner Fund terms + Payout schedule deep-link the Wallet segments",
  appJs.includes('"Fund terms"') && appJs.includes('"Payout schedule"'));
check("admin panel carries every section incl. the Creators shortcut and previews (no Wallet shortcut — Build -130 Part 9D)",
  appJs.includes('"Preview as business"') && appJs.includes('adminCreatorsGo125()') && !appJs.includes('adminWalletGo125()'));

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
  check("bootstrap serves 45 markets", (boot.data.markets || []).length === 45, String((boot.data.markets || []).length));
  const claim = await client()("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "b125@fixtures.dev", password: "claim-" + "pass-1234", market: "Nashville", handle: "b125claim", ...AGREE });
  check("a creator claim still lands (201)", claim.status === 201 && !!claim.data.user, String(claim.status));
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");
  const marketsRes = await admin("GET", "/api/admin/markets");
  check("admin markets list is still 45 rows", (marketsRes.data.markets || []).length === 45, String((marketsRes.data.markets || []).length));
  const pageRes = await fetch(BASE + "/");
  const pageText = await pageRes.text();
  check("the served shell carries theme-v3 + the -125 stamp", pageRes.status === 200 && pageText.includes("/theme-v3.css") && pageText.includes(stamp), String(pageRes.status));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-build125: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
