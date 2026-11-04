#!/usr/bin/env node
// Build -122 verification (Jeff, 2026-11-04, from his phone
// screenshots of the live app): three header fixes on top of
// Build -121, nothing else moves.
//   1. SIGN IN BLACK: the signed-out top bar's "Sign in"
//      rendered in the old dark-header sage (#C6CFC6) on the
//      Paper bar and looked disabled. theme-v3 now paints it
//      solid Ink at weight 800, and the rest of the top-nav
//      row takes Ink-2 so no header action reads as faded.
//   2. IDENTITY LEFT: the identity row (avatar + name) is
//      pinned left in every shell — the slim top bar
//      (.tb2-in), the rail top row (.tr-in), the rail user
//      card — with chat/help staying right; and the Admin
//      section bar's phone padding matches the 12px content
//      gutters exactly (the last off-symmetry offset).
//   3. PHOTO IN THE CIRCLE: the identity circle shows the
//      user's uploaded photo when one exists. The old code
//      read creator.photoUrl off the session user — a field
//      the payload never sets — so the initial always won.
//      selfAvatarUrl122 derives the real sources (creator
//      hasPhoto -> the photo route; business asset-packet
//      logo; partner brand logo) and avaHtml122 layers the
//      photo over the initial, self-removing on load error
//      so the initial is the fallback, never a break.
// Proves:
//   S. source pins for the three fixes + the inherited
//      -119/-120/-121 pins that must not move (design tokens,
//      Momentum naming, tab sets, full width, payment gates).
//   H. server: boots; bootstrap 45 markets; a creator claim
//      lands; Admin markets lists 45 rows; the served shell
//      carries the -122 stamp.
// The rendered proof (black Sign in, left identity, photo vs
// initial avatars, gutter symmetry) lives in
// scripts/qa-build122.py + ~/workspace/research_notes/
// signl-build122-qa/.
//
// Run: node scripts/verify-build122.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9061;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-build122-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-build122-${Date.now()}.json`);

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
check("stamp is 2026.11.04-126 and identical in build.js + index.html", stamp === "2026.11.04-126" && indexHtml.includes(stamp), String(stamp));
check("index.html cache-busts theme-v3 + app.js with the rolled stamp",
  indexHtml.includes(`/theme-v3.css?v=${stamp}`) && indexHtml.includes(`/app.js?v=${stamp}`));

// 1 — Sign in black
part("1: sign-in black");
check("Sign in is solid Ink at action weight in the v3 layer",
  css.includes("#topnav a.nav-signin { color: var(--ink); font-weight: 800; }"));
check("the rest of the top-nav row takes Ink-2 (no faded header actions left)",
  css.includes("#topnav a, #topnav button.linklike { color: var(--ink2); }") &&
  css.includes("#topnav a:hover, #topnav button.linklike:hover { color: var(--ink); }"));
check("both signed-out header variants still render the nav-signin door",
  count(appJs, 'class="nav-signin"') >= 2);

// 2 — identity left + Admin symmetry
part("2: identity left");
check("the slim top bar identity is pinned left, full width, no auto-centering",
  css.includes("#topbar2 .tb2-in { justify-content: flex-start; max-width: none; margin-left: 0; margin-right: 0; }"));
check("the rail top row and the rail user card are pinned left too",
  css.includes(".tr-in { justify-content: flex-start; }") && css.includes(".tab-user { justify-content: flex-start; }"));
check("actions still ride right (tb2-actions margin-left auto is untouched in theme-v2)",
  fs.readFileSync(path.join(root, "public/theme-v2.css"), "utf8").includes(".tb2-actions { margin-left: auto;"));
check("Admin symmetry: the section bar's phone padding matches the 12px content gutters",
  css.includes("body.admin-on #admin-secbar { padding-left: 12px; padding-right: 12px; }"));
check("Admin symmetry on desktop: the rail top row is padded to the content's 24px gutters",
  css.includes("body.rail-on #toprow { padding-left: 24px; padding-right: 24px; }"));

// 3 — photo in the circle
part("3: photo avatar");
check("the avatar source derives from real data (creator hasPhoto -> photo route)",
  appJs.includes("function selfAvatarUrl122(u)") &&
  appJs.includes("u.creator.hasPhoto && u.id") && appJs.includes("/api/users/${u.id}/photo"));
check("business packet logo + partner brand logo are the other supported sources",
  appJs.includes("u.business.assetPacket") && appJs.includes("pk.logoUrl") && appJs.includes("u.partner.brand.logoUrl"));
check("the photo layers over the initial and removes itself on load error",
  appJs.includes("function avaHtml122(txtCls, imgCls, url, initial)") &&
  appJs.includes('class="ava122w"') && appJs.includes('onerror="this.remove()"') &&
  css.includes(".ava122w > img.ava122i { position: absolute; inset: 0;"));
check("all three identity spots render through the helper (top bar, rail card, top row)",
  count(appJs, "avaHtml122(") >= 4 && count(appJs, "selfAvatarUrl122(u)") >= 3);
check("the never-set session field read is gone from the header paths",
  !appJs.includes('u.role === "creator" && u.creator ? u.creator.photoUrl : null'));
check("the Admin top row carries an identity photo branch now (it had none)",
  appJs.includes('avaHtml122("tr-ava", "tr-ava", photo, initial)'));

// Inherited pins (-119/-120/-121 must not move)
part("S2: inherited pins");
check("design tokens intact (Paper, Ink, Signal, the one gradient)",
  css.includes("--paper: #FAF7F1") && css.includes("--ink: #171512") && css.includes("--accent: #FF4D00") &&
  css.includes("linear-gradient(92deg, #185BFF 0%, #0AA6C2 38%, #00B67A 72%, #22C55E 100%)"));
check("Momentum naming intact: gloss present, no Standing rename crept back",
  appJs.includes("Momentum — you reply fast and show up. Businesses see it before followers.") &&
  appJs.includes('wsHead("Momentum"') && !appJs.includes("Standing points") && !appJs.includes("Your Standing") &&
  !appJs.includes("How does Standing work") && !appJs.includes('wsHead("Standing"'));
check("full width survived (work shells keep max-width: none)",
  css.includes("body.v3-on main, body.v3-slim main, body.admin-on main, body.preview-on main { max-width: none; }"));
check("the Admin section bar still syncs from railItems (one source of destinations)",
  appJs.includes("function syncAdminSecbar121()") && appJs.includes('bar.id = "admin-secbar"'));
const ADMIN_TABS = ["Applications", "Requests", "Markets", "Recruiters", "Outreach", "Partners", "Event Log", "Compliance", "Campaign", "Stats", "Sig"];
for (const t of ADMIN_TABS) {
  check(`admin section reachable: rail destination + renderAdmin dispatch for "${t}"`,
    appJs.includes(`"${t}", "return go('dashboard','${t}')"`) && appJs.includes(`if (tab === "${t}")`));
}
check("primary tab sets still match the approved IA map",
  appJs.includes('business: ["Home", "Discover", "My Offers", "Visits & Posts", "Plan"]') &&
  appJs.includes('creator: ["Dashboard", "Offers", "My Visits", "Messages", "Earnings"]') &&
  appJs.includes('partner: ["Home", "Businesses", "Earnings", "Performance"]') &&
  appJs.includes('pilot: ["Overview", "Businesses", "Results", "Report"]') &&
  appJs.includes('recruiter: ["Queue", "Outreach", "Results", "Sig", "Help"]'));
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
  check("bootstrap serves 45 markets", (boot.data.markets || []).length === 45, String((boot.data.markets || []).length));
  const claim = await client()("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "b122@fixtures.dev", password: "claim-" + "pass-1234", market: "Nashville", handle: "b122claim", ...AGREE });
  check("a creator claim still lands (201)", claim.status === 201 && !!claim.data.user, String(claim.status));
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");
  const marketsRes = await admin("GET", "/api/admin/markets");
  check("admin markets list is still 45 rows", (marketsRes.data.markets || []).length === 45, String((marketsRes.data.markets || []).length));
  const pageRes = await fetch(BASE + "/");
  const pageText = await pageRes.text();
  check("the served shell carries theme-v3 + the -122 stamp", pageRes.status === 200 && pageText.includes("/theme-v3.css") && pageText.includes(stamp), String(pageRes.status));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-build122: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
