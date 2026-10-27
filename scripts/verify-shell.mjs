#!/usr/bin/env node
// Overhaul Stage 1 verification (Jeff, 2026-10-27).
//
// Pins the new app shell + rebuilt homes:
//   (a) source: the rail (desktop) renders the same destinations
//       as the bottom bar per role and hides in preview/staff;
//       the floating agent button + Ready-for-you queue exist as
//       structure only (homes register real queues; no agent
//       logic ships in this stage);
//   (b) source: creator homes lead with a Local reach KPI, show
//       Momentum exactly once, and carry Activity | Analytics
//       segments with a filter-chipped feed;
//   (c) source: the business home (and its preview twin, same
//       builders) uses Overview | Activity | Offers | Analytics,
//       template cards in SIGNL's terms, a 7/30-day funnel
//       toggle, and a content library split carrying the rights
//       lines (native share only / 90-day windows);
//   (d) api: the preview dashboard (which shares the real
//       business-home analytics computation) returns the new
//       fields computed from real records: localReachDelivered
//       from creator audience x local %, windowed funnels,
//       contentLibrary rows with license state, costPerVisit
//       from the plan.
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

  part("source: shell (rail + agent-ready structure)");
  check("index.html carries the rail + agent button mounts", indexHtml.includes('id="rail"') && indexHtml.includes('id="agent-fab"'));
  check("rail renderer exists and mirrors the bottom bar's go() targets", appJs.includes("function renderRail()") && appJs.includes("function railItems()") && appJs.includes("return go('dashboard','Applications')") && appJs.includes("return go('dashboard','My Visits')"));
  check("rail stays off for signed-out, staff and preview", appJs.includes('if (!state.user || state.view === "staff" || state.preview) return null;'));
  check("rail re-renders with the bottom bar so badges stay in sync", appJs.includes("renderRail();"));
  check("rail CSS: fixed left rail at >=1100px, bottom bar hidden there", themeCss.includes("body.rail-on #rail") && themeCss.includes("body.rail-on #bottomnav { display: none !important; }") && themeCss.includes("@media (min-width: 1100px)"));
  check("agent-ready structure: queue registration, card, sheet, floating button", appJs.includes("function setAgentFab(") && appJs.includes("function readyCardHtml(") && appJs.includes("function openAgentSheet(") && appJs.includes("function renderAgentFab()"));
  check("every navigation clears the queue before the next home registers its own", appJs.includes("state.agentQueue = null;"));
  check("no agent logic ships in this stage (no chat/composer hooks)", !appJs.includes("agentChat") && !appJs.includes("askAgent"));

  part("source: creator homes");
  check("homes share the segment grammar (homeSegsHtml + dashSeg)", appJs.includes("function homeSegsHtml(") && appJs.includes('["activity", "Activity"], ["analytics", "Analytics"]'));
  check("creator KPI strips lead with Local reach", (appJs.match(/Local reach/g) || []).length >= 4 && appJs.includes("of your audience is local"));
  check("live creator home: feed chips cover invites/visits/posts/momentum", appJs.includes("feedChip(this,'invites')") && appJs.includes("feedChip(this,'visits')") && appJs.includes("feedChip(this,'posts')") && appJs.includes("feedChip(this,'momentum')"));
  check("creator analytics: funnel stages + day 7/14/30 series from snapshots", appJs.includes('"Invited", "Offers open + invites taken"') && appJs.includes("Post performance, day 7 / 14 / 30") && appJs.includes("b.post.snapshots"));
  check("on-time panel states the 48 hour standard and the one-week hard deadline", appJs.includes("inside the 48 hour standard") && appJs.includes("the hard deadline is one week"));
  check("founding home carries the honest pre-launch funnel empty state", appJs.includes("we do not chart zeroes"));
  check("creator homes register a Ready-for-you queue", (appJs.match(/setAgentFab\(queue\)/g) || []).length >= 3);

  part("source: business home + preview twin");
  check("segments are Overview | Activity | Offers | Analytics in the shared builder", appJs.includes('["overview", "Overview"], ["activity", "Activity", needsCount || 0], ["offers", "Offers"], ["analytics", "Analytics"]'));
  check("preview twin uses the same segment keys", appJs.includes('data-seg="activity"') && appJs.includes("home.activity") && appJs.includes("home.offers") && appJs.includes("home.analytics"));
  check("KPI band leads with Local reach delivered", appJs.includes("Local reach delivered") && appJs.includes("h.localReachDelivered"));
  check("rollover state rides in the visits KPI", appJs.includes("rolled in from last month"));
  check("offer template cards in SIGNL's terms with Start actions", appJs.includes('"Comped visit"') && appJs.includes('"Paid booking"') && appJs.includes('"Open call"') && appJs.includes("function startOfferTemplate("));
  check("template Start never overwrites an in-progress draft", appJs.includes('if (offerDraftIsEmpty()) state.offerDraft.kind = kind === "paid" ? "paid" : "comp";'));
  check("funnel carries the 7/30-day segmented toggle", appJs.includes("function bizFunnelHtml(") && appJs.includes('data-fnbtn="7"') && appJs.includes('data-fnbtn="30"') && appJs.includes("h.funnel7 && h.funnel30"));
  check("content library split carries the rights lines", appJs.includes("Seeing a post here is not the right to reuse it") && appJs.includes("Creator posts") && appJs.includes("Yours to use") && appJs.includes("Native share only"));
  check("license pill renders the 90-day window state per post", appJs.includes("function licPillHtml(") && appJs.includes("Standard license") && appJs.includes("d left"));
  check("cost per post is plan math, labeled as the plan rate", appJs.includes("per visit in your allowance") && appJs.includes("h.costPerVisit"));

  part("api: preview dashboard computes the new analytics from real records");
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
  await stopServer();
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err);
  try { await stopServer(); } catch (e) { /* already down */ }
}

console.log(`\nverify-shell: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
