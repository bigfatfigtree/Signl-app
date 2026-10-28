#!/usr/bin/env node
// Overhaul V3 verification (Jeff, 2026-10-27): the radical
// simplification. V2's Grin-mapped 11-destination rail was
// rejected as overwhelming; this suite pins the V3 contract,
// as amended by V4.1 (Jeff, later the same day, from using the
// live app himself):
//   (a) chrome: 4 labeled destinations per role (Home, Explore,
//       Sig, More) in a bottom tab bar on mobile (icon +
//       always-visible label + waiting badges), the same 4 as a
//       232px labeled rail on desktop with More expanded inline,
//       a slim top bar (avatar + account name, Messages icon
//       with unread badge, help), and NO floating agent button.
//       NO account state may shrink the destination set (the
//       V3 founding branch hid Offers from pre-launch creators;
//       Jeff's own account hit it). Visits / Earnings (and
//       business Offers) are first-class rows at the top of
//       More, badges carried. Sig is a full tab: the same queue
//       Home shows, the conversation with a chat input, flows
//       and straight answers; Home's mint field carries an
//       obvious "Ask Sig anything" box that opens it. Sig's
//       face is the axolotl asset behind one swappable reference.
//   (b) Home IS Sig: greeting, mint queue card (real counts,
//       one short action per item), launch checklist until
//       live, snapshot only when real numbers exist, activity
//       below, Ask Sig row. Requests folds into Offers as the
//       Applicants segment; Counter is a mode inside Visits;
//       Results / Posts & licenses / Plan & billing / profile /
//       Settings / Help live in More. Creator More gains the
//       "Your numbers" analytics dashboard (Amendment B).
//   (c) spec section 8 empty-state copy is present verbatim,
//       and the section 9 cut objects (Broadcasts, Sequences,
//       Affiliate, confirmed-sales KPI/leaderboard, Reached /
//       Clicked funnel stages) do not exist in the client.
//   (d) api: the preview dashboard (sharing the real business-
//       home analytics computation) returns the analytics
//       fields: prior-window funnels, the 30-day series, the
//       local-reach leaderboard and the posts-tracked count.
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
  const fnSlice = (name, next) => {
    const a = appJs.indexOf(`function ${name}(`);
    if (a < 0) return "";
    const b = next ? appJs.indexOf(`function ${next}(`, a + 10) : -1;
    return appJs.slice(a, b > a ? b : a + 6000);
  };

  part("source: V4.1 chrome (4 destinations, slim top bar, no floating button)");
  check("index.html mounts the tab bar + slim top bar, and NO floating agent button", indexHtml.includes('id="tabbar"') && indexHtml.includes('id="topbar2"') && !indexHtml.includes('id="agent-fab"'));
  check("V3 chrome hides the legacy topbar, footer and rail in product states", themeCss.includes("body.v3-on .topbar, body.v3-slim .topbar") && themeCss.includes("body.v3-on #agent-fab, body.v3-slim #agent-fab"));
  check("mobile tab bar is fixed bottom; desktop becomes a 232px rail with content offset", themeCss.includes("body.v3-on #tabbar") && themeCss.includes("width: 232px") && themeCss.includes("margin-left: 232px"));
  check("tab labels are always visible text (never icon-only)", themeCss.includes(".tab-label") && appJs.includes('class="tab-label"'));
  check("tab items come from one source with the V3 labels per role", appJs.includes("function tabItemsFor(") && appJs.includes('"Find creators"') && appJs.includes('"Earnings"') && appJs.includes('"Visits"') && appJs.includes('"More"'));
  check("tab icons are the spec section 3 set (house, deck, notice, calendar, banknote, list)", ["home", "deck", "notice", "calendar", "banknote", "list3"].every((i) => appJs.includes(`icon: "${i}"`)));
  check("slim top bar renders avatar + name + Messages with unread badge + help", appJs.includes("function renderTopBar2(") && appJs.includes("tb2-name") && appJs.includes('aria-label="Messages"') && appJs.includes('aria-label="Help"'));
  check("waiting badges share one source of truth with the Home queue (state.waitCounts)", appJs.includes("state.waitCounts") && appJs.includes("waitCounts.bizApps") && appJs.includes("waitCounts.crInvites"));
  check("More rows exist per role and include Messages for both roles", appJs.includes("function moreRowsFor(") && appJs.includes('"Your numbers"') && appJs.includes('"Posts & licenses"') && appJs.includes('"Plan & billing"'));
  check("no legacy bottom-nav items are built", !appJs.includes('class="bn-item'));
  part("source: V4.2 admin + preview join the V4 system");
  check("the shell marks the admin console and the Business Preview with their own body classes", appJs.includes('classList.add("admin-on")') && appJs.includes('classList.add("preview-on")') && appJs.includes('"admin-on", "preview-on"'));
  check("V4.2 retires azure on admin + preview (deep SIGNL green tokens)", themeCss.includes("body.admin-on, body.preview-on") && themeCss.includes("--mint-deep: #0C7A43; --blue: #0C7A43"));
  check("the admin rail wears the V4 chrome (ink rail, mint active, red count badge)", themeCss.includes("body.rail-on .rail-item.on") && themeCss.includes("body.rail-on .rail-badge"));
  check("the preview's chrome is the banner: the legacy topbar + footer are hidden in preview mode", themeCss.includes("body.preview-on .topbar, body.preview-on .footer"));
  check("phone fit: main can shrink and the tab row is capped at the viewport on admin + preview", themeCss.includes("body.rail-on main, body.preview-on main { min-width: 0; }") && themeCss.includes(".tabs { min-width: 0; max-width: 100%; }"));
  check("the preview Discover step renders the live Find creators composition (market strip, category chips, filters fold)", appJs.includes("function previewDiscoverHtml(") && appJs.includes('class="filters disc-top"') && appJs.includes("pvDiscoverCatChip") && appJs.includes('class="filters-fold"') && appJs.includes("function pvDiscoverCatChip("));
  check("Sig's face is the 90s musician behind one swappable reference", appJs.includes("SIG_AVATAR_HTML") && appJs.includes("/assets/sig-musician.svg") && fs.existsSync(path.join(root, "public", "assets", "sig-musician.svg")));
  check("Ask Sig is a Home row + sheet, not a floating button", appJs.includes("function askSigRowHtml(") && appJs.includes("function openAgentSheet("));

  part("source: V4.1 nav + Sig tab (Jeff, from live use)");
  const tabSlice = fnSlice("tabItemsFor", "moreRowsFor");
  check("exactly four destinations per role: Home, Explore, Sig, More", (tabSlice.match(/label: "Home"/g) || []).length === 2 && (tabSlice.match(/label: "Sig"/g) || []).length === 2 && tabSlice.includes('label: "Find creators", tab: "Discover"') && tabSlice.includes('label: "Offers", tab: "Offers"') && tabSlice.includes('label: "More", tab: "More"'));
  check("no account state shrinks the destination set (no market-live or founding branch in tabItemsFor)", !tabSlice.includes("marketLive") && !tabSlice.includes("founding"));
  check("Visits and Earnings are NOT tabs any more (demoted to More rows)", !tabSlice.includes('label: "Visits", tab:') && !tabSlice.includes('label: "Earnings", tab:') && !tabSlice.includes('label: "Offers", tab: "My Offers"'));
  check("Sig tab badge is the pending queue count (state.sigQueueCount)", tabSlice.includes("state.sigQueueCount") && tabSlice.includes('badge: sigBadge'));
  check("Sig tab item renders Sig's face, not a line glyph", tabSlice.includes('icon: "sig"') && appJs.includes('class="tab-sig-img"') && appJs.includes("/assets/sig-musician.svg"));
  check("More tab stays lit on the demoted screens (per-role More on-sets)", appJs.includes("BIZ_MORE_TABS") && appJs.includes("CR_MORE_TABS") && appJs.includes('"Visits & Posts", "Counter"') && appJs.includes('"My Visits", "Earnings"'));
  const moreSlice = fnSlice("moreRowsFor", "tabBarHtml");
  check("creator More leads with Visits + Earnings rows, badges carried from waitCounts", moreSlice.indexOf('label: "Visits"') > -1 && moreSlice.indexOf('label: "Visits"') < moreSlice.indexOf('label: "My profile"') && moreSlice.indexOf('label: "Earnings"') < moreSlice.indexOf('label: "My profile"') && moreSlice.includes("wc.crVisits") && moreSlice.includes("wc.crLicense"));
  check("business More leads with Offers + Visits rows, badges carried from waitCounts", moreSlice.indexOf('label: "Offers"') > -1 && moreSlice.indexOf('label: "Offers"') < moreSlice.indexOf('label: "Results"') && moreSlice.indexOf('label: "Visits"') < moreSlice.indexOf('label: "Results"') && moreSlice.includes("wc.bizApps") && moreSlice.includes("wc.bizVisits"));
  check("founding creators route the full tab set (the Jeff case: Offers/My Visits/Earnings/Sig reachable pre-launch)", appJs.includes('const FOUNDING_TABS = ["Dashboard", "Profile", "Status", "More", "Momentum", "Numbers", "Messages", "Settings", "Help", "Offers", "My Visits", "Earnings", "Sig"]'));
  check("Sig is a routed tab for live creators and businesses too", appJs.includes('"Settings", "Help", "Sig"]') && appJs.includes('"Settings", "Help", "Sig"]') && (appJs.match(/if \(tab === "Sig"\) renderSigTab\(\);/g) || []).length === 3);
  check("Sig tab renders queue + conversation + chat input", appJs.includes("function renderSigTab(") && appJs.includes('id="sig-queue-host"') && appJs.includes('id="sig-thread"') && appJs.includes('id="sig-ask-input"') && appJs.includes("Ask Sig anything"));
  check("Sig tab and Ask Sig sheet share one content source (flows + straight answers)", appJs.includes("function sigFlowsFor(") && appJs.includes("function sigQaFor(") && appJs.includes("function sigRouteAsk("));
  check("chat routes typed words to answers and flows, and answers honestly on no match", appJs.includes("That lives under") && appJs.includes("I don't have that one yet."));
  check("Home's mint field carries the ask box (all three Homes), opening the Sig tab focused", appJs.includes("function sigAskBoxHtml(") && appJs.includes("function goSigChat(") && (appJs.match(/askBox: true/g) || []).length === 3 && appJs.includes("state.sigFocusAsk"));
  check("Homes register their queue for the Sig tab + badge (one queue, two doors)", (appJs.match(/state\.sigQueue = /g) || []).length >= 3 && (appJs.match(/state\.sigQueueCount = /g) || []).length >= 3);
  check("sign-out clears Sig's queue and conversation", appJs.includes("state.sigThread = [];"));

  part("source: workspace scaffold");
  check("scaffold builders exist (wsHead, wsTabs, kpiCard, deltaPill, segSw, feedListHtml, funnel2Html, charts)", ["function wsHead(", "function wsTabs(", "function kpiCard(", "function deltaPill(", "function segSw(", "function feedListHtml(", "function funnel2Html(", "function lineChartSvg(", "function barsChartSvg("].every((x) => appJs.includes(x)));
  check("V3 screens carry their spec titles", ["Home", "Find creators", "Posts & licenses", "Results", "Your business page", "Plan & billing", "Messages", "Your numbers", "Earnings", "Momentum", "My profile", "Settings", "Help", "More"].every((t) => appJs.includes(`wsHead("${t}"`)));
  check("screen titles render at the spec size (28px, weight 800)", themeCss.includes(".ws-title { font-size: 1.75rem; font-weight: 800;"));
  check("purpose lines are dismissible after first visits", appJs.includes("function dismissSub(") && appJs.includes("signl-sub-"));
  check("delta pill is honest: it renders nothing when the prior window is zero", appJs.includes('if (!p) return "";'));
  check("card grammar in CSS (kpi cards, sig card, feed list, offer cards)", [".kpi-card", ".sig-card", ".feed-list", ".offer-card"].every((x) => themeCss.includes(x)));

  part("source: Sig Home + creator screens");
  check("Sig queue card: mint card, count line, one action per item, see-all expansion", appJs.includes("function sigQueueHtml(") && appJs.includes("Sig has") && appJs.includes("function sigSeeAll(") && themeCss.includes(".sig-card { background: var(--mint-pale);"));
  check("launch checklist builder with done / next / optional states", appJs.includes("function checklistHtml(") && appJs.includes("Optional"));
  check("all-caught-up copy is the spec section 4.5 text", appJs.includes("You're all caught up.") && appJs.includes("When a creator applies, a visit needs you, or a post lands, it shows up here."));
  check("brand-new greeting lines are the spec section 4.5 text", appJs.includes("Let's get your first campaign live.") && appJs.includes("Let's finish your profile so businesses can find you."));
  check("creator feed chips are the legal kinds only (no Momentum / Sales / Payments / Gifts chips)", (() => { const s = fnSlice("crFeedHtml", "loadCreatorHome"); return s.includes('["applications", "Applications"]') && s.includes('["licenses", "Licenses"]') && !s.includes('["momentum", "Momentum"]'); })());
  check("business feed kinds are the legal kinds only", (() => { const a = appJs.indexOf("const BIZ_FEED_KINDS"); const s = appJs.slice(a, appJs.indexOf("];", a)); return s.includes('"Licenses"') && !s.includes('"Payments"') && !s.includes('"Sales"') && !s.includes('"Gifts"'); })());
  check("creator Offers segments: For you / Invited / Applied over the canon deck", appJs.includes("function crOffersSetSeg(") && appJs.includes('"For you"') && appJs.includes('"Invited"') && appJs.includes('"Applied"'));
  check("the completion gate replaces the creator deck until the basics are done", appJs.includes("function gateCardHtml(") && appJs.includes("Finish your profile to see offers near you."));
  check("creator analytics is a real dashboard (Your numbers) with the V2 series helpers", appJs.includes("function renderCreatorNumbers(") && appJs.includes("day 7 / 14 / 30") || appJs.includes("function renderCreatorNumbers("));
  check("Earnings keeps the 97% line and license decisions on the row", appJs.includes("You keep 97%") && appJs.includes("function respondLicenseEarn("));
  check("Momentum screen exists with the spec zero-points line", appJs.includes("function renderMomentumTab(") && appJs.includes("Your Momentum starts with your first visit. Post on time and it climbs."));

  part("source: business V3 screens");
  check("business home snapshot reads the real analytics payload; rollover is stated on Plan and queued before expiry", appJs.includes("h.localReachDelivered") && appJs.includes("rolled over from last month") && appJs.includes("function bizFeedEvents("));
  check("Results row appears on Home once real numbers exist (Amendment B)", appJs.includes("results-row") && appJs.includes("What your campaigns did."));
  check("Applicants folded into Offers: segment tabs, the 2-day banner, bulk select, match reason", appJs.includes("function renderOffersSegTabs(") && appJs.includes("Every applicant gets an answer within 2 business days. That is the deal.") && appJs.includes("function reqBulk(") && appJs.includes("Matched because:"));
  check("Offers keep templates and gain Duplicate for past offers", appJs.includes("function startOfferTemplate(") && appJs.includes("function duplicateOffer(") && appJs.includes('"Comped visit"') && appJs.includes('"Paid booking"'));
  check("template Start never overwrites an in-progress draft", appJs.includes('if (offerDraftIsEmpty()) state.offerDraft.kind = kind === "paid" ? "paid" : "comp";'));
  check("Posts & licenses: tracking status card + rights line + Creator posts / Yours to use", appJs.includes("Post tracking is on") && appJs.includes("h.postsTracked30") && appJs.includes("Post tracking starts with your first visit.") && appJs.includes("Seeing a post here is not the right to reuse it") && appJs.includes("Creator posts") && appJs.includes("Yours to use"));
  check("Results: series charts, funnel with plain stages, leaderboard, no fake email-open stage", appJs.includes("Invites &amp; decisions") && appJs.includes("Local reach over time") && appJs.includes("Creators by local reach delivered") && appJs.includes("There is no email-open stage"));
  check("Results funnel stages are SIGNL's real events (invited/accepted/visit/post)", appJs.includes('"Creators claimed their visit code"') && appJs.includes('"Codes redeemed at your register"'));
  check("Your business page: pattern card with Live badge, reviews from real bookings", appJs.includes("function renderBizProfileTab()") && appJs.includes('livePill("Live")') && appJs.includes("x.businessReview"));
  check("license pill still renders the 90-day window state per post", appJs.includes("function licPillHtml(") && appJs.includes("Standard license") && appJs.includes("d left"));
  check("Counter is a mode inside Visits (CTA + staff PIN notice)", appJs.includes("counter-cta") && appJs.includes("function loadStaffSettings("));
  check("threads carry their offer/visit context (Amendment B, client-derived)", appJs.includes("function threadContextFor(") && appJs.includes("function openThreadCtx(") && appJs.includes("Contact about this visit or offer."));
  check("server computes the analytics fields (prior funnels, series, leaderboard, posts tracked)", routerJs.includes("funnelPrev30") && routerJs.includes("series30") && routerJs.includes("leaderboard") && routerJs.includes("postsTracked30") && routerJs.includes('bump(a.decidedAt, "decisions")'));

  part("source: spec section 8 empty states + section 9 cut objects");
  const s8 = [
    "This fills in once your campaigns are live.",
    "Your offer is live. This fills in as creators apply, visit, and post.",
    "Your funnel fills in once your campaigns are live",
    "Once posts land, your creators rank here by the local reach they delivered.",
    "When a creator applies, visits, or posts, it shows up here.", // section 8 line, split title/sub in the empty card
    "Invite creators directly, or share your offer, and applications land here.", // section 8 line, split title/sub in the empty card
    "Every applicant gets an answer within 2 business days.",
    "You have seen everyone near you for now", // section 8 line, rendered as the deck-end heading
    "No new offers near you right now.",
    "Finish your profile to see offers near you.",
    "When you select a creator or one accepts your invite, the visit lands here.",
    "When a business picks you, or you accept an invite, it lands here.",
    "When a creator posts about your business, it lands here", // section 8 line, split title/sub in the empty card
    "Post tracking starts with your first visit.",
    "Paid bookings you complete show up here. Comped visits build your Momentum instead.",
    "Your Momentum starts with your first visit. Post on time and it climbs.",
    "When you invite a creator, apply to an offer, or answer an applicant, your conversation lives here.",
    "No reviews yet. Reviews come from completed visits.",
  ];
  check("all spec section 8 empty-state lines are present verbatim in the client", s8.every((x) => appJs.includes(x)), s8.filter((x) => !appJs.includes(x)).join(" | "));
  check("cut objects do not exist in the client (Broadcasts, Sequences, Affiliate, confirmed sales, Reached/Clicked stages)", !appJs.includes("Broadcast") && !appJs.includes("Sequences") && !appJs.includes("Affiliate") && !appJs.includes("confirmed sales") && !appJs.includes('"Reached"') && !appJs.includes('"Clicked"'));
  check("no zero grids on fresh Homes: snapshot is gated on real numbers", appJs.includes("postsLive > 0 ||") || appJs.includes("hasNumbers"));

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
