#!/usr/bin/env node
// Build -126 verification (Jeff, 2026-11-04, from his live
// screenshots of the shipped -125 build):
//   1. Platform totals at the top of Admin home: TOTAL
//      CREATORS SIGNED UP + TOTAL FOLLOWERS, from the one
//      server definition (platformTotals126: approved +
//      pending creators, testers excluded; each signed-up
//      creator's full stacked total, counted once). Sig's
//      admin grounding states the same two numbers.
//   2. The top-left identity is a MENU on every shell
//      (Profile / Settings / Sign out, role-appropriate);
//      Admin gains a real "Your account" view (identity,
//      email, role, working change-password, Sign out);
//      pilots/recruiters gain the same view; sign out ends
//      the session for real.
//   3. Top-bar controls are icons, not words: no spelled-out
//      "Everything" button and no "Need help?" text link in
//      the admin top row (the word Everything stays as the
//      panel's title and the buttons' aria/title).
//   4. Previews are simple top tabs in Admin (Business ·
//      Creator · Partner) over the real mechanisms: Business
//      = the preview simulation; Creator = read-only view-as
//      of the approved TEST creator only; Partner = read-only
//      view-as of the seeded DEMO partner only.
//   5. Text never runs off-screen: the CSS pins for the
//      no-sideways shell fix + Command Center stacking live
//      here; the mechanical 390px audit across roles lives in
//      scripts/qa-build126.py.
// Proves:
//   S. source pins for all five moves + inherited pins.
//   H. server: totals math on seeded records; preview-target
//      resolution skips demo-showcase props; view guards
//      refuse a real creator and a real partner (403); the
//      test-creator + demo-partner views open read-only and
//      exit back to admin; the Build -67 business view is
//      unchanged; Sig answers the totals + sign-out questions
//      from the same source; logout ends the session; the
//      served shell carries the -126 stamp.
//
// Run: node scripts/verify-build126.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9064;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-build126-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-build126-${Date.now()}.json`);

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
const sigdata = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const authJs = fs.readFileSync(path.join(root, "netlify/functions/lib/auth.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");
const stamp = (buildJs.match(/BUILD_ID\s*=\s*"([^"]+)"/) || [])[1] || "";
check("stamp is 2026.11.05-130 and identical in build.js + index.html", stamp === "2026.11.05-130" && indexHtml.includes(stamp), String(stamp));
check("index.html cache-busts app.js + theme-v3 with the rolled stamp",
  indexHtml.includes(`/app.js?v=${stamp}`) && indexHtml.includes(`/theme-v3.css?v=${stamp}`));

// 1 — totals
part("1: platform totals");
check("the one totals definition lives server-side (platformTotals126) behind an admin endpoint",
  routerJs.includes("function platformTotals126(users)") &&
  routerJs.includes('seg[1] === "platform-totals"') &&
  routerJs.includes('u.status !== "approved" && u.status !== "pending"'));
check("Sig's admin facts are fed the SAME platformTotals126 result (no second source)",
  routerJs.includes("platformTotals: platformTotals126(users)") &&
  sigdata.includes("signedUp: d.platformTotals ? d.platformTotals.creatorsSignedUp") &&
  sigdata.includes("totalFollowers: d.platformTotals ? d.platformTotals.totalFollowers"));
check("the strip sits at the top of Admin home with the two plain labels",
  appJs.includes('id="admin-totals126"') && appJs.includes("function loadAdminTotals126()") &&
  appJs.includes("Creators signed up") && appJs.includes("Total followers") &&
  appJs.includes("as reported by creators"));
check("Sig's admin answers state the strip's numbers and where sign out lives",
  sigdata.includes("creators signed up on the platform (approved plus pending") &&
  sigdata.includes("Tap your name and photo at the top left of Admin") &&
  sigdata.includes("the strip at the top of Admin home"));

// 2 — identity menu
part("2: identity menu + sign out");
check("the identity menu machinery exists (rows, open, close) with a menu on every shell's identity",
  appJs.includes("function identityMenuRows126()") && appJs.includes("function openIdentityMenu126()") &&
  appJs.includes("function closeIdentityMenu126()") && appJs.includes('el.id = "identity-menu126"'));
check("every shell's identity opens the menu: top bar, desktop rail foot, admin top row, admin rail avatar",
  appJs.includes('class="tb2-id" onclick="return openIdentityMenu126()"') &&
  appJs.includes('class="tab-user tab-user-btn"') && appJs.includes('aria-label="Your account menu" onclick="return openIdentityMenu126()"') &&
  appJs.includes('class="tr-id" onclick="return openIdentityMenu126()"') &&
  appJs.includes('class="rail-avatar"') && appJs.includes('aria-label="Your account menu" onclick="return openIdentityMenu126()"'));
check("menu rows per role land on real views (creator Profile/Settings, business Profile/Settings, partner Account, admin/pilot/recruiter Your account) and every menu ends in Sign out",
  appJs.includes('dest("profile", "My profile"') && appJs.includes('dest("building", "Business profile"') &&
  appJs.includes('dest("profile", "Account", "Your partner profile and agreement", "Account")') &&
  appJs.includes('dest("profile", "Your account", "Your settings: sign-in, email and password", "Account")') &&
  appJs.includes('label: "Sign out", sub: "Ends this session on this device", act: "signOut()"'));
check("Admin has a real Your account view: shared account panel (email + change password) + Sign out",
  appJs.includes("function renderAdminAccount126()") && appJs.includes('if (tab === "Account") renderAdminAccount126();') &&
  appJs.includes("function accountViewHtml126(roleLabel)") && appJs.includes("${accountHtml(u)}") &&
  appJs.includes('<button class="btn danger" onclick="signOut()">Sign out</button>'));
check("pilot + recruiter shells dispatch the same Your account view from the menu (not a bar tab)",
  appJs.includes('if (!RECRUITER_TABS.includes(tab) && tab !== "Account") tab = "Queue";') &&
  appJs.includes('if (!PILOT_TABS.includes(tab) && tab !== "Account") tab = "Overview";') &&
  appJs.includes('if (tab === "Account") { el.innerHTML = accountViewHtml126("Recruiter"); return; }') &&
  appJs.includes('accountViewHtml126("Impact Portal")'));
check("existing sign-out paths survive: rail Sign out buttons still call signOut()",
  appJs.includes('class="tab-item tab-signout" onclick="signOut()"') &&
  appJs.includes('title="Sign out" aria-label="Sign out" onclick="signOut()"'));

// 3 — icons at the top
part("3: icons, not words");
check("the admin top row's Everything is an icon button (aria + title carry the word; no spelled-out button text)",
  appJs.includes('class="tr-ev125" onclick="return openEverything125()" aria-label="Everything — all sections" title="Everything">${bnIcon("menu")}</button>') &&
  !appJs.includes('${bnIcon("more")}<span>Everything</span>'));
check("the admin top row's help is an icon button, not a spelled-out link",
  appJs.includes('class="tr-help126" href="mailto:hello@joinsignl.com" aria-label="Need help?" title="Need help?">${bnIcon("help")}</a>') &&
  !appJs.includes('<a href="mailto:hello@joinsignl.com">Need help?</a>'));
check("the word Everything still titles the panel itself, and the top bar's Everything stays icon-only",
  appJs.includes('<div class="ev125-head"><strong>Everything</strong>') &&
  appJs.includes('class="tb2-btn tb2-ev125" onclick="return openEverything125()" aria-label="Everything — all sections" title="Everything">${bnIcon("menu")}</button>'));
check("icon buttons keep generous tap targets (40px) in CSS",
  css.includes(".tr-ev125 { width: 40px; height: 40px;") && css.includes(".pv-tab126 {") && css.includes("min-height: 40px"));

// 4 — preview tabs
part("4: preview tabs");
check("Admin home carries the simple preview tab row (Business · Creator · Partner) near the top",
  appJs.includes('class="pv-tabs126"') && appJs.includes('<button type="button" class="pv-tab126" onclick="enterPreview()">Business</button>') &&
  appJs.includes('onclick="return adminPreviewAs126(\'creator\')">Creator</button>') &&
  appJs.includes('onclick="return adminPreviewAs126(\'partner\')">Partner</button>') &&
  appJs.includes("function adminPreviewAs126(kind)"));
check("the big mid-page Business Preview card is gone",
  !appJs.includes('class="panel preview-cta"') && !appJs.includes("<strong>Business Preview</strong>"));
check("creator/partner views ride the generalised view-as machinery, guarded to test/demo accounts only",
  authJs.includes("targetUser") && authJs.includes("targetId: target.id") &&
  routerJs.includes('seg[1] === "creators" && seg.length === 4 && seg[3] === "view"') &&
  routerJs.includes('seg[1] === "partners" && seg.length === 4 && seg[3] === "view"') &&
  routerJs.includes("Creator preview only opens the approved test creator account") &&
  routerJs.includes("Partner preview only opens the seeded demo partner") &&
  routerJs.includes('seg[1] === "preview-targets"') && routerJs.includes("function previewTargets126(users)"));
check("the view banner names the viewed account for any role (label falls back behind businessName)",
  appJs.includes('esc(va.businessName || va.label || "this account")') &&
  routerJs.includes("label: viewAs.label || viewAs.businessName || null"));

// 5 — no sideways text (CSS pins; the mechanical audit is qa-build126.py)
part("5: no-sideways shell");
check("the shell can no longer be dragged wide: main + tab bodies get min-width 0, a 100vw cap, and a pinned phone width",
  css.includes("body > main { min-width: 0; max-width: 100vw; }") &&
  css.includes("body.rail-on main, body.admin-on main, body.v3-on main, body.v3-slim main, body.preview-on main { width: 100%; }") &&
  css.includes("#tab-body, #cc-body, .admin-home-main, .admin-home-side { min-width: 0; }"));
check("Command Center stacks at phone width: filters full-width, legend wraps, tiles constrain",
  css.includes(".cc-filter-row { flex-direction: column; align-items: stretch; gap: 10px; }") &&
  css.includes(".cc-flabel select { width: 100%; max-width: 100%; }") &&
  css.includes(".cc-legend { flex-wrap: wrap; row-gap: 6px; }") &&
  css.includes(".cc-tiles { grid-template-columns: minmax(0, 1fr); }"));
check("totals strip + preview tabs + identity menu CSS present",
  css.includes(".totals126 {") && css.includes(".idm126-panel {") && css.includes(".tr-id {"));

// Inherited pins
part("S2: inherited pins");
check("Momentum naming intact, Sig orb art intact (Build -130), photo avatars intact",
  appJs.includes("Momentum — you reply fast and show up. Businesses see it before followers.") &&
  appJs.includes('const SIG_ART = "/assets/sig-orb";') && appJs.includes("function selfAvatarUrl122(u)"));
check("payment gates stay shut: founding Stripe prices still resolve only from unset env",
  routerJs.includes('process.env.STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') &&
  !process.env.STRIPE_PRICE_FOUNDING_SELF_SERVICE && !process.env.STRIPE_PRICE_FOUNDING_GROWTH && !process.env.STRIPE_PRICE_FOUNDING_MANAGED);

// ---------- H: server ----------
part("H: server");
// Seed records the totals + preview tests read. Followers:
//   c-app  approved  stack 10000 + 5000 = 15000  -> counts
//   c-pen  pending   followerCount 2000          -> counts
//   c-rej  rejected  99999                       -> excluded
//   c-test approved  tester 777777               -> excluded (tester), IS the creator preview target
//   c-show approved  tester + demoShowcase, created EARLIER than c-test -> must be skipped as a target
// Totals must therefore be exactly { creatorsSignedUp: 2, totalFollowers: 17000 }.
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("seed-pass-1234", salt, 64).toString("hex");
const seed = {};
const putUser = (u) => { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "c-app", role: "creator", email: "capp@b126.dev", name: "Approved Cara", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z", creator: { handle: "cara", audienceStack: { instagram: 10000, tiktok: 5000 }, profileComplete: true } });
putUser({ id: "c-pen", role: "creator", email: "cpen@b126.dev", name: "Pending Pete", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z", creator: { handle: "pete", followerCount: 2000 } });
putUser({ id: "c-rej", role: "creator", email: "crej@b126.dev", name: "Rejected Rob", passwordSalt: salt, passwordHash: hash, status: "rejected", market: "Nashville", createdAt: "2026-03-02T00:00:00.000Z", updatedAt: "2026-03-02T00:00:00.000Z", creator: { handle: "rob", followerCount: 99999 } });
putUser({ id: "c-show", role: "creator", email: "cshow@b126.dev", name: "Showcase Sue", passwordSalt: salt, passwordHash: hash, status: "approved", tester: true, demoShowcase: "nashville-2026-11", market: "Nashville", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", creator: { handle: "sue", followerCount: 555555 } });
putUser({ id: "c-test", role: "creator", email: "ctest@b126.dev", name: "Test Tina", passwordSalt: salt, passwordHash: hash, status: "approved", tester: true, market: "Nashville", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", creator: { handle: "tina", followerCount: 777777, profileComplete: true } });
putUser({ id: "p-demo", role: "partner", email: "pdemo@b126.dev", name: "Demo Dana", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Virginia Beach", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z", partner: { orgName: "Demo Media Group", demo: true } });
putUser({ id: "p-real", role: "partner", email: "preal@b126.dev", name: "Real Ralph", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", createdAt: "2026-02-02T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z", partner: { orgName: "Real Media Co" } });
putUser({ id: "b-biz", role: "business", email: "bbiz@b126.dev", name: "Biz Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", createdAt: "2026-02-03T00:00:00.000Z", updatedAt: "2026-02-03T00:00:00.000Z", business: { businessName: "BizCo Tacos" } });
fs.writeFileSync(DB, JSON.stringify(seed));

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

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  part("H1: totals math");
  const totals = await admin("GET", "/api/admin/platform-totals");
  check("platform totals: 2 signed up (approved + pending; rejected + testers excluded)",
    totals.status === 200 && totals.data.creatorsSignedUp === 2, JSON.stringify(totals.data));
  check("platform totals: 17,000 followers (each signed-up creator's stacked total, once)",
    totals.status === 200 && totals.data.totalFollowers === 17000, JSON.stringify(totals.data));
  const notAdmin = await client()("GET", "/api/admin/platform-totals");
  check("platform totals refuses signed-out callers", notAdmin.status === 401 || notAdmin.status === 403, String(notAdmin.status));

  part("H2: Sig states the same numbers + sign out");
  const askTotals = await admin("POST", "/api/sig/ask", { q: "How many creators have signed up on the platform and how many followers do they have in total?", history: [] });
  check("Sig answers the platform totals from the same source (2 signed up, 17,000 followers)",
    askTotals.status === 200 && /2 creators signed up/.test(askTotals.data.text || "") && (askTotals.data.text || "").includes("17,000"),
    String(askTotals.data.text || "").slice(0, 200));
  const askOut = await admin("POST", "/api/sig/ask", { q: "Where is sign out?", history: [] });
  check("Sig answers where sign out lives (top-left identity menu)",
    askOut.status === 200 && /top left/.test(askOut.data.text || "") && /[Ss]ign out/.test(askOut.data.text || ""),
    String(askOut.data.text || "").slice(0, 200));

  part("H3: preview targets + view guards");
  const targets = await admin("GET", "/api/admin/preview-targets");
  check("preview targets resolve server-side: test creator (showcase prop skipped) + demo partner",
    targets.status === 200 && targets.data.creator && targets.data.creator.id === "c-test" &&
    targets.data.partner && targets.data.partner.id === "p-demo", JSON.stringify(targets.data));
  const realCreatorView = await admin("POST", "/api/admin/creators/c-app/view", {});
  check("viewing a REAL creator's account is refused (403)", realCreatorView.status === 403, String(realCreatorView.status));
  const showcaseView = await admin("POST", "/api/admin/creators/c-show/view", {});
  check("viewing a demo-showcase prop is refused (403)", showcaseView.status === 403, String(showcaseView.status));
  const realPartnerView = await admin("POST", "/api/admin/partners/p-real/view", {});
  check("viewing a REAL partner's account is refused (403)", realPartnerView.status === 403, String(realPartnerView.status));

  part("H4: the views open read-only and exit back to admin");
  const creatorView = await admin("POST", "/api/admin/creators/c-test/view", {});
  check("the test creator view opens (200)", creatorView.status === 200 && creatorView.data.ok === true, String(creatorView.status));
  const meCreator = await admin("GET", "/api/auth/me");
  check("inside the view: session is the test creator, banner data carries the label, read-only",
    meCreator.data.user && meCreator.data.user.id === "c-test" &&
    meCreator.data.user.viewAs && meCreator.data.user.viewAs.readOnly === true &&
    meCreator.data.user.viewAs.label === "Test Tina", JSON.stringify(meCreator.data.user && meCreator.data.user.viewAs));
  const writeInView = await admin("POST", "/api/auth/change-password", { currentPassword: "seed-pass-1234", newPassword: "blocked-pass-1234" });
  check("a write inside the view is refused by the read-only gate (403)", writeInView.status === 403, String(writeInView.status));
  const exitCreator = await admin("POST", "/api/auth/exit-view", {});
  check("exit view hands the admin session back", exitCreator.status === 200 && exitCreator.data.user && exitCreator.data.user.role === "admin");
  const partnerView = await admin("POST", "/api/admin/partners/p-demo/view", {});
  check("the demo partner view opens (200)", partnerView.status === 200 && partnerView.data.ok === true, String(partnerView.status));
  const mePartner = await admin("GET", "/api/auth/me");
  check("inside the partner view: session is the demo partner, label is the org name",
    mePartner.data.user && mePartner.data.user.id === "p-demo" &&
    mePartner.data.user.viewAs && mePartner.data.user.viewAs.label === "Demo Media Group", JSON.stringify(mePartner.data.user && mePartner.data.user.viewAs));
  const exitPartner = await admin("POST", "/api/auth/exit-view", {});
  check("exit partner view hands the admin session back", exitPartner.status === 200 && exitPartner.data.user && exitPartner.data.user.role === "admin");
  const bizView = await admin("POST", "/api/admin/businesses/b-biz/view", {});
  const meBiz = await admin("GET", "/api/auth/me");
  check("Build -67 business view unchanged: businessName still rides the view marker",
    bizView.status === 200 && meBiz.data.user && meBiz.data.user.viewAs && meBiz.data.user.viewAs.businessName === "BizCo Tacos",
    JSON.stringify(meBiz.data.user && meBiz.data.user.viewAs));
  await admin("POST", "/api/auth/exit-view", {});

  part("H5: sign out ends the session");
  const fresh = client();
  const fl = await fresh("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  const meBefore = await fresh("GET", "/api/auth/me");
  check("signed in: /auth/me returns the admin", fl.status === 200 && meBefore.data.user && meBefore.data.user.role === "admin");
  const logout = await fresh("POST", "/api/auth/logout", {});
  const meAfter = await fresh("GET", "/api/auth/me");
  check("after logout: /auth/me no longer returns a user (session is over)",
    logout.status === 200 && !(meAfter.data && meAfter.data.user), `${logout.status}/${meAfter.status}`);

  const pageRes = await fetch(BASE + "/");
  const pageText = await pageRes.text();
  check("the served shell carries theme-v3 + the -126 stamp", pageRes.status === 200 && pageText.includes("/theme-v3.css") && pageText.includes(stamp), String(pageRes.status));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-build126: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
