#!/usr/bin/env node
// Overhaul V2 verification (Jeff, 2026-10-27): the Grin-template
// recomposition. Stage 1's composition was rejected; this suite
// pins the V2 contract instead:
//   (a) shell: a slim icon rail is the navigation at EVERY width
//       (no bottom nav element, no 236px desktop rail), a quiet
//       top row rides in the content column, and the floating
//       agent button + Sig ready-for-you structure stay;
//   (b) scaffold: one-word workspace titles (wsHead), underlined
//       tabs (wsTabs), white KPI cards, and an honest delta pill
//       that renders nothing when the prior window is zero;
//   (c) mirror: business Requests (approvals queue), Content
//       (tracking status + rights), Analytics (series charts,
//       prior-window funnels, leaderboard) and creator homes all
//       render from the same real payloads;
//   (d) api: the preview dashboard (sharing the real business-
//       home analytics computation) returns the V2 fields:
//       prior-window funnels, the 30-day series, the local-reach
//       leaderboard and the posts-tracked count, all computed
//       from the records' own timestamps.
//
// Run: node scripts/verify-shell.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8997;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<redacted>";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-shell-"));
const dbFile = path.join(tmp, "db.json");
let server = null;

function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
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
    if (setCookie) for (const part of setCookie.split(/,(?=[^;]+=)/)) {
      const m = part.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html error page */ }
    return { status: res.status, data, text };
  };
}
async function adminClient() {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error("admin login failed: " + r.status);
  return c;
}
const uniq = () => Math.random().toString(36).slice(2, 9);
let n = 0;
async function registerCreator(admin, followerCount, localAudiencePct) {
  n += 1;
  const c = makeClient();
  const r = await c("POST", "/api/auth/register", {
    role: "creator",
    name: `Shell Creator ${n}`,
    email: `shell${n}-${uniq()}@fixtures.dev`,
    password: "<redacted>",
    market: "Hampton Roads",
    city: "Norfolk",
    handle: `shell${n}${uniq()}`,
    categories: ["Food & Drink"],
    compCategories: ["Restaurant meals"],
    tierBand: "Locals",
    followerCount,
    avgViews: 900,
    localAudiencePct,
    bio: "",
    agreedHonestPosts: true,
    agreedFtcDisclosure: true,
    agreedPostCompliance: true,
    agreedTerms: true,
  });
  if (r.status === 201) await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
  return { client: c, res: r, user: r.data && r.data.user };
}

try {
  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const themeCss = fs.readFileSync(path.join(root, "public", "theme-v2.css"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify", "functions", "lib", "router.js"), "utf8");

  part("source: shell (icon rail at every width)");
  check("index.html mounts rail + top row + agent button, and NO bottom nav", indexHtml.includes('id="rail"') && indexHtml.includes('id="toprow"') && indexHtml.includes('id="agent-fab"') && !indexHtml.includes('id="bottomnav"'));
  check("rail is a slim 68px icon rail at all widths (no 236px desktop rail)", themeCss.includes("body.rail-on #rail") && themeCss.includes("width: 68px") && !themeCss.includes("width: 236px"));
  check("rail hides the app topbar slab and any bottom bar when on", themeCss.includes("body.rail-on .topbar { display: none; }") && themeCss.includes("body.rail-on #bottomnav { display: none !important; }"));
  check("rail renderer + top row exist; rail pins the account avatar at the bottom", appJs.includes("function renderRail()") && appJs.includes("function renderTopRow()") && appJs.includes("rail-avatar") && appJs.includes("Need help?"));
  check("rail stays off for signed-out, staff and preview", appJs.includes('if (!state.user || state.view === "staff" || state.preview) return null;'));
  check("business rail reaches the new workspace screens", appJs.includes("return go('dashboard','Requests')") && appJs.includes("return go('dashboard','Analytics')") && appJs.includes("return go('dashboard','Content')") && appJs.includes("return go('dashboard','Profile')"));
  check("renderBottomNav is now only the rail coordinator (no bar is built)", appJs.includes('document.body.classList.remove("bn-on", "has-bn")') && !appJs.includes('class="bn-item'));
  check("floating agent button is a white circle (not a black slab)", themeCss.includes("#agent-fab") && themeCss.includes("border: 2px solid var(--mint)"));
  check("agent-ready structure: queue registration, Sig card, sheet, floating button", appJs.includes("function setAgentFab(") && appJs.includes("function readyCardHtml(") && appJs.includes("function openAgentSheet(") && appJs.includes("function renderAgentFab()"));
  check("Sig card mirrors the agent pattern (count line + white pill actions)", appJs.includes("sig-card") && appJs.includes("sig-pill") && appJs.includes("ready for you`"));
  check("every navigation clears the queue before the next home registers its own", appJs.includes("state.agentQueue = null;"));
  check("goals card is labeled structure only (Sig does not act on goals yet)", appJs.includes("Sig does not act on goals yet"));

  part("source: workspace scaffold");
  check("scaffold builders exist (wsHead, wsTabs, kpiCard, deltaPill, segSw, feedListHtml, funnel2Html, charts)", ["function wsHead(", "function wsTabs(", "function kpiCard(", "function deltaPill(", "function segSw(", "function feedListHtml(", "function funnel2Html(", "function lineChartSvg(", "function barsChartSvg("].every((x) => appJs.includes(x)));
  check("workspace screens carry one-word titles", ["Home", "Requests", "Discover", "Offers", "Content", "Analytics", "Conversations", "Profile", "Visits", "Plan", "Counter", "Favorites", "Status"].every((t) => appJs.includes(`wsHead("${t}"`)));
  check("delta pill is honest: it renders nothing when the prior window is zero", appJs.includes('if (!p) return "";'));
  check("white hairline card grammar in CSS (kpi cards, sig card, feed list, offer cards)", [".kpi-card", ".sig-card", ".feed-list", ".offer-card", ".ws-tab.on::after"].every((x) => themeCss.includes(x)));

  part("source: creator homes");
  check("creator homes lead with a Local reach hero card", appJs.includes("Your local reach") && (appJs.match(/kpiCard\("Momentum"/g) || []).length === 2);
  check("creator feed is date-grouped with the chip taxonomy", appJs.includes("function crFeedHtml()") && appJs.includes('["invites", "Invites"]') && appJs.includes('["momentum", "Momentum"]') && appJs.includes("function feedListHtml("));
  check("creator funnel stages keep their plain captions", appJs.includes('"Invited", "Offers open + invites taken"') && appJs.includes("funnel2Html(funnelStages.map"));
  check("on-time card states the 48 hour standard and the one-week hard deadline", appJs.includes("inside the 48 hour standard") && appJs.includes("the hard deadline is one week"));
  check("post performance keeps the day 7/14/30 series and the no-zeroes honesty", appJs.includes("Post performance, day 7 / 14 / 30") && appJs.includes("b.post.snapshots") && appJs.includes("do not chart zeroes"));
  check("creator homes register a Ready-for-you queue", (appJs.match(/setAgentFab\(queue\)/g) || []).length >= 3);

  part("source: business mirror screens");
  check("business home: KPI grid leads with Local reach delivered + rollover line", appJs.includes("h.localReachDelivered") && appJs.includes("rolled in from last month") && appJs.includes("function bizFeedEvents("));
  check("home feed taxonomy mirrors Grin's chips (applications/messages/posts/visits/payments/licenses)", appJs.includes("BIZ_FEED_KINDS") && appJs.includes('"Applications"') && appJs.includes('"Payments"') && appJs.includes('"Licenses"'));
  check("Requests: approvals queue with counts, match reason, bulk select, real 2-day window", appJs.includes("function renderRequestsTab()") && appJs.includes("Matched because:") && appJs.includes("function reqBulk(") && appJs.includes("decision within 2 business days"));
  check("Requests kebab mirrors Grin (View profile / Ask Sig / Request info / Later / Release)", appJs.includes("View creator profile") && appJs.includes("Ask Sig") && appJs.includes("Request info") && appJs.includes("Move back to waiting"));
  check("Offers: Current/Archived tabs + template cards with Start in SIGNL's terms", appJs.includes("function renderOfferTabs()") && appJs.includes("function offerIsArchived(") && appJs.includes('"Comped visit"') && appJs.includes('"Paid booking"') && appJs.includes("function startOfferTemplate("));
  check("template Start never overwrites an in-progress draft", appJs.includes('if (offerDraftIsEmpty()) state.offerDraft.kind = kind === "paid" ? "paid" : "comp";'));
  check("Content: tracking status card + rights line + Creator posts / Yours to use", appJs.includes("Post tracking is on") && appJs.includes("h.postsTracked30") && appJs.includes("Seeing a post here is not the right to reuse it") && appJs.includes("Creator posts") && appJs.includes("Yours to use"));
  check("Analytics: series charts, funnel with plain stages, leaderboard, no fake email-open stage", appJs.includes("Invites &amp; decisions") && appJs.includes("Local reach over time") && appJs.includes("Creators by local reach delivered") && appJs.includes("There is no email-open stage"));
  check("Analytics funnel stages are SIGNL's real events (invited/accepted/visit/post)", appJs.includes('"Creators claimed their visit code"') && appJs.includes('"Codes redeemed at your register"'));
  check("Profile: Grin pattern card with Live badge, reviews from real bookings", appJs.includes("function renderBizProfileTab()") && appJs.includes('livePill("Live")') && appJs.includes("x.businessReview") && appJs.includes("creator reviews"));
  check("license pill still renders the 90-day window state per post", appJs.includes("function licPillHtml(") && appJs.includes("Standard license") && appJs.includes("d left"));
  check("server computes the mirror fields (prior funnels, series, leaderboard, posts tracked)", routerJs.includes("funnelPrev30") && routerJs.includes("series30") && routerJs.includes("leaderboard") && routerJs.includes("postsTracked30") && routerJs.includes('bump(a.decidedAt, "decisions")'));

  part("api: preview dashboard computes the analytics from real records");
  startServer();
  await waitUp();
  const admin = await adminClient();
  const c1 = await registerCreator(admin, 5000, 62);
  const c2 = await registerCreator(admin, 8000, 62);
  check("two roster creators approved", c1.res.status === 201 && c2.res.status === 201, JSON.stringify(c1.res.data).slice(0, 150));
  const pv = await admin("GET", "/api/admin/preview/dashboard");
  check("preview dashboard responds", pv.status === 200 && !!(pv.data && pv.data.dashboard && pv.data.dashboard.home), String(pv.status));
  const h = (pv.data && pv.data.dashboard && pv.data.dashboard.home) || {};
  check("localReachDelivered sums creator local audience over delivered posts (5000x62% + 8000x62% = 8060)", h.localReachDelivered === 8060, String(h.localReachDelivered));
  check("funnel30 counts the simulated records' own timestamps (5 invited, 5 claimed, 4 visited, 2 posted)", h.funnel30 && h.funnel30.invited === 5 && h.funnel30.claimed === 5 && h.funnel30.visited === 4 && h.funnel30.posted === 2, JSON.stringify(h.funnel30));
  check("funnel7 exists and never exceeds funnel30", h.funnel7 && h.funnel7.invited <= h.funnel30.invited && h.funnel7.posted <= h.funnel30.posted, JSON.stringify(h.funnel7));
  check("contentLibrary carries both delivered posts", Array.isArray(h.contentLibrary) && h.contentLibrary.length === 2, JSON.stringify(h.contentLibrary && h.contentLibrary.length));
  check("comped preview posts carry native-share license state", (h.contentLibrary || []).every((r) => r.license && r.license.type === "native"), JSON.stringify((h.contentLibrary || []).map((r) => r.license)));
  check("library rows carry views, on-time and post URL", (h.contentLibrary || []).every((r) => typeof r.views === "number" && typeof r.onTime === "boolean" && !!r.postUrl));
  check("costPerVisit is the Growth plan allocation ($349 / 10 = $34.90)", h.costPerVisit === 34.9, String(h.costPerVisit));
  check("prior-window funnels exist: prev30 is zero (all preview records are under 31 days old), prev7 never exceeds funnel30", h.funnelPrev30 && h.funnelPrev30.invited === 0 && h.funnelPrev30.posted === 0 && h.funnelPrev7 && h.funnelPrev7.invited <= h.funnel30.invited && h.funnelPrev7.posted <= h.funnel30.posted, JSON.stringify(h.funnelPrev7));
  check("series30 covers 30 days and sums to the funnel (5 invited, 2 posts)", Array.isArray(h.series30) && h.series30.length === 30 && h.series30.reduce((a, r) => a + (r.invited || 0), 0) === 5 && h.series30.reduce((a, r) => a + (r.posts || 0), 0) === 2, JSON.stringify((h.series30 || []).length));
  check("leaderboard ranks both creators and sums to localReachDelivered", Array.isArray(h.leaderboard) && h.leaderboard.length === 2 && h.leaderboard.reduce((a, r) => a + (r.localReach || 0), 0) === 8060 && h.leaderboard[0].localReach >= h.leaderboard[1].localReach, JSON.stringify(h.leaderboard));
  check("postsTracked30 counts both delivered posts", h.postsTracked30 === 2, String(h.postsTracked30));
  await stopServer();
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err);
  try { await stopServer(); } catch (e) { /* already down */ }
}

console.log(`\nverify-shell: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
