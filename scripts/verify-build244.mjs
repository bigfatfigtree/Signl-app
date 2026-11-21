// verify-build244.mjs — Build -244: Admin Stats Overview
// (Jeff, 2026-11-21: "build that stats screen that puts it all
// in one place").
//
//   - The Stats tab gains a default first view, Overview: one
//     screen with creators (overall + per market against the
//     50-approved launch line), growth, businesses, activity,
//     creator-reported engagement, revenue, and a downloads
//     panel.
//   - The numbers come from ONE stored record
//     (config:adminStatsSummary) built by the same background
//     refresh as the Admin Home summary (-212 pattern):
//     GET /admin/stats-overview serves the record and never
//     computes; the request path does zero prefix scans.
//   - Every figure is produced by the same helper its home
//     surface uses (platformTotals126, adminMarketRows,
//     approvalQueue138, buildSignupSourceWindows, the -226 agg
//     helpers, ccPrep + ccMoneyAgg): no second math.
//
// Proven here:
//   A. Source pins — the compute, the endpoint, the gate case,
//      the background wiring, the client view, the stamp.
//   B. Behavioral — against a seeded store: the endpoint
//      answers { preparing: true } before the first compute;
//      the real background handler builds the record; the
//      endpoint then serves figures that match the seed
//      exactly, including two spot-checks (Nashville approved,
//      total creators) recomputed from a direct read of the
//      store file, bypassing every helper.
// Run: node scripts/verify-build244.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build244-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.SIGNL_MAIL_STUB = "1";
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "build-244-admin-password";
process.env.APP_URL = "http://127.0.0.1:9";
process.env.SIGNL_SWEEP_TOKEN = "build244-suite-token";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");
const bgHandler = require("../netlify/functions/admin-home-refresh-background.js").handler;
const root = process.cwd();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const count = (src, needle) => src.split(needle).length - 1;

// --- A: source pins -------------------------------------------
console.log("== A: source pins ==");
// Build -245 ship note (2026-11-21): the stamp moved on the same day; the pin is
// both homes agree and >= 244, the house relaxation for same-day follow-on builds.
check("build stamp is >= 2026.11.21-244 and agrees in both homes",
  (() => { const a = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").match(/BUILD_ID = "2026\.11\.21-(\d+)"/); const b = fs.readFileSync(path.join(root, "public/index.html"), "utf8").match(/window\.__SIGNL_BUILD__ = "2026\.11\.21-(\d+)"/); return !!a && !!b && a[1] === b[1] && Number(a[1]) >= 244; })(), "");

const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("the compute exists (refreshAdminStatsSummary244) and stores one record",
  routerSrc.includes("async function refreshAdminStatsSummary244()")
  && routerSrc.includes('const ADMIN_STATS_SUMMARY_KEY = "config:adminStatsSummary";')
  && routerSrc.includes("await store.set(ADMIN_STATS_SUMMARY_KEY, rec);"), "");
check("the compute reads its figures from the home surfaces' own helpers",
  routerSrc.includes("const totals = platformTotals126(all);")
  && routerSrc.includes("const marketRows = await adminMarketRows();")
  && routerSrc.includes("queue = await approvalQueue138(superAdmin);")
  && routerSrc.includes("const srcWindows = await buildSignupSourceWindows();")
  && routerSrc.includes("addToAgg226(agg, postReportFor226(")
  && routerSrc.includes("const money = ccMoneyAgg(P);"), "");
check("the exported background entry exists with the stampede guard",
  routerSrc.includes("async function runAdminStatsSummary244(opts)")
  && routerSrc.includes("runAdminStatsSummary244, runLearnSync202"), "");
check("the endpoint serves the stored record only",
  routerSrc.includes('if (seg[1] === "stats-overview" && seg.length === 2 && method === "GET")')
  && routerSrc.includes("const rec = await loadAdminStatsSummary244();")
  && routerSrc.includes("return json(200, { preparing: true, asOf: null });"), "");
check("the gate rides the Stats view permission",
  routerSrc.includes('case "stats-overview": return need("stats.view");'), "");
check("the endpoint shape-guards the stored record (a malformed record counts as absent)",
  routerSrc.includes("const recOk = !!rec && typeof rec === \"object\" && !!rec.creators")
  && routerSrc.includes("Number.isFinite(Date.parse(rec.computedAt || \"\"))"), "");
check("no serial per-key get loop in the new compute block",
  (() => { const block = routerSrc.slice(routerSrc.indexOf("Build -244: the Admin Stats Overview summary"), routerSrc.indexOf("async function adminHomeFallback213")); return !/for\s*\([^)]*\)\s*\{[^}]*await store\.get\(/.test(block) && !block.includes("listKeys("); })(), "");

const bgSrc = fs.readFileSync(path.join(root, "netlify/functions/admin-home-refresh-background.js"), "utf8");
check("the background refresh runs the stats compute alongside the home summary",
  bgSrc.includes("runAdminStatsSummary244")
  && bgSrc.includes("statsOut = await runAdminStatsSummary244({ force });"), "");

const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
check("client: Overview is the default Stats view with its own tab and container",
  appSrc.includes('let astView = "overview";')
  && appSrc.includes('{ label: "Overview", on: astView === "overview"')
  && appSrc.includes('id="astview-overview"')
  && appSrc.includes('if (astView === "overview") loadAdminOverview244();'), "");
check("client: the renderer covers all seven sections",
  appSrc.includes("function adminOverviewHtml244(d)")
  && appSrc.includes("of 50")
  && appSrc.includes("Where claims came from, last 30 days")
  && appSrc.includes("Engagement, creator-reported")
  && appSrc.includes("No market is live for money yet")
  && appSrc.includes("App downloads and devices live in App Store Connect"), "");
check("client: the honest preparing state exists",
  appSrc.includes("Your numbers are being prepared."), "");
check("client: the preparing state re-checks on a timer, as its copy promises",
  appSrc.includes("astOverviewRetries244 < 10")
  && appSrc.includes('if (astView === "overview" && document.getElementById("ast-overview")) loadAdminOverview244();'), "");
check("client: no em dashes in the new Overview copy (the Stats screen's null placeholder glyph aside)",
  (() => { const block = appSrc.slice(appSrc.indexOf("Admin Stats: Overview (Build -244)"), appSrc.indexOf("async function loadStats()")); return !block.split('"—"').join("").includes("—"); })(), "");

// --- B: behavioral ---------------------------------------------
console.log("== B: behavioral (seeded store, real background compute, served record) ==");
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method, path: url.pathname, headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body), isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = res.body; }
    return { status: res.statusCode, data };
  };
}

const now = Date.now();
const isoDaysAgo = (n) => new Date(now - n * 86400000).toISOString();
const today = new Date(now).toISOString().slice(0, 10);
function creator(id, market, status, opts = {}) {
  return {
    id, role: "creator", status, email: `${id}@fixtures.dev`, name: id,
    city: market, market, createdAt: opts.createdAt || isoDaysAgo(0),
    ...(opts.utmSource ? { utmSource: opts.utmSource } : {}),
    ...(opts.signupSource ? { signupSource: opts.signupSource } : {}),
    creator: {
      handle: `@${id.replace(/-/g, "")}`,
      categories: opts.complete ? ["Food & Drink"] : [],
      localAudiencePct: 70,
      audienceStack: { instagram: opts.followers || 1200 },
      hasPhoto: true, neighborhood: "Fixture Heights", publicPage: true,
      bio: "Fixture creator bio, long enough to count as written.",
    },
  };
}
await store.set("user:u-nash-a", creator("u-nash-a", "Nashville", "approved", { complete: true }));
await store.set("user:u-nash-b", creator("u-nash-b", "Nashville", "approved", { complete: true, followers: 900 }));
await store.set("user:u-nash-c", creator("u-nash-c", "Nashville", "approved", { complete: false, createdAt: isoDaysAgo(5) }));
await store.set("user:u-nash-d", creator("u-nash-d", "Nashville", "pending", { complete: true }));
await store.set("user:u-mia-a", creator("u-mia-a", "Miami", "approved", { complete: true, utmSource: "pinterest" }));
await store.set("user:u-mia-b", creator("u-mia-b", "Miami", "approved", { complete: true, signupSource: "email" }));
await store.set("user:u-biz-nash", { id: "u-biz-nash", role: "business", status: "approved", email: "biznash@fixtures.dev", name: "Fixture Cafe", city: "Nashville", market: "Nashville", createdAt: isoDaysAgo(2), business: { name: "Fixture Cafe" } });
await store.set("user:u-biz-mia", { id: "u-biz-mia", role: "business", status: "pending", email: "bizmia@fixtures.dev", name: "Fixture Salon", city: "Miami", market: "Miami", createdAt: isoDaysAgo(1), business: { name: "Fixture Salon" } });
await store.set(`event:${today}:fx-appr-1`, { type: "application_approved", ts: isoDaysAgo(0), actorRole: "admin", subjectId: "u-nash-a", data: {} });
await store.set(`event:${today}:fx-appr-2`, { type: "application_approved", ts: isoDaysAgo(0), actorRole: "admin", subjectId: "u-mia-a", data: {} });
await store.set("booking:b1", { id: "b1", creatorId: "u-nash-a", businessId: "u-biz-nash", status: "completed", compCostEntry: { amount: 85 }, createdAt: isoDaysAgo(3) });
await store.set("post:p1", { id: "p1", bookingId: "b1", creatorId: "u-nash-a", businessId: "u-biz-nash", url: "https://example.com/p1", views: 1000, likes: 50, comments: 5, shares: 2, saves: 3, createdAt: isoDaysAgo(2) });
await store.set("redevent:re1", { id: "re1", bookingId: "b1", businessId: "u-biz-nash", kind: "first", amount: 50, at: isoDaysAgo(2) });
await store.set("redevent:re2", { id: "re2", bookingId: "b1", businessId: "u-biz-nash", kind: "first", amount: 35, at: isoDaysAgo(2) });
await store.set("offer:o1", { id: "o1", businessId: "u-biz-nash", createdAt: isoDaysAgo(4) });
await store.set("offer:o2", { id: "o2", businessId: "u-biz-nash", createdAt: isoDaysAgo(1) });
await store.set("application:ap1", { id: "ap1", bookingId: "b1", creatorId: "u-nash-b", createdAt: isoDaysAgo(3) });
await store.set("application:ap2", { id: "ap2", bookingId: "b1", creatorId: "u-mia-a", createdAt: isoDaysAgo(2) });
await store.set("application:ap3", { id: "ap3", bookingId: "b1", creatorId: "u-mia-b", createdAt: isoDaysAgo(1) });

const admin = makeClient();
const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
check("admin signs in", login.status === 200, `${login.status}`);

const anon = makeClient();
const anonRes = await anon("GET", "/api/admin/stats-overview");
check("a signed-out read is refused", anonRes.status === 401 || anonRes.status === 403, `${anonRes.status}`);

const before = await admin("GET", "/api/admin/stats-overview");
check("before the first compute the endpoint answers preparing, not zeroes",
  before.status === 200 && before.data && before.data.preparing === true, JSON.stringify(before.data).slice(0, 200));

const bg = await bgHandler({ headers: { "x-signl-sweep-token": process.env.SIGNL_SWEEP_TOKEN }, body: JSON.stringify({ force: true }) }, {});
check("the background refresh runs and builds the stats record",
  bg.statusCode === 200 && JSON.parse(bg.body).statsRefresh && !!JSON.parse(bg.body).statsRefresh.computedAt, String(bg.statusCode));

const after = await admin("GET", "/api/admin/stats-overview");
const d = after.data || {};
check("after the compute the endpoint serves the record with an as-of time",
  after.status === 200 && d.preparing === false && !!d.asOf, JSON.stringify(d).slice(0, 200));
check("creators: signed up / approved / pending / finished match the seed",
  d.creators && d.creators.signedUp === 6 && d.creators.approved === 5 && d.creators.pending === 1 && d.creators.finished === 4,
  JSON.stringify(d.creators));
const nash = (d.markets || [])[0] || {};
check("markets: Nashville sorts first with its seed counts",
  nash.name === "Nashville" && nash.creatorsApproved === 3 && nash.creatorsApprovedComplete === 2 && nash.creatorsPending === 1 && nash.businessesApproved === 1,
  JSON.stringify(nash));
check("businesses: signed up / approved match the seed",
  d.businesses && d.businesses.signedUp === 2 && d.businesses.approved === 1, JSON.stringify(d.businesses));
check("growth: claims and approvals over 30 days match the seed",
  d.growth && d.growth.claims30 === 6 && d.growth.approvals30 === 2
  && (d.growth.claimsByDay || []).length === 30
  && (d.growth.claimsByDay || []).find((r) => r.date === today && r.claims === 5 && r.approvals === 2),
  JSON.stringify(d.growth && { claims30: d.growth.claims30, approvals30: d.growth.approvals30 }));
check("growth: the review queue holds the two pending records",
  d.growth && d.growth.queue && d.growth.queue.applications >= 2, JSON.stringify(d.growth && d.growth.queue));
check("growth: claims by source bucket the recorded tags only",
  (() => { const rows = (d.growth && d.growth.claimsBySource) || []; const by = Object.fromEntries(rows.map((r) => [r.key, r.creators])); return by.pinterest === 1 && by.email === 1 && by.direct === 4 && rows.reduce((s, r) => s + r.creators, 0) === 6; })(),
  JSON.stringify(d.growth && d.growth.claimsBySource));
check("activity: the booking roll-up carries the business definitions",
  d.activity && d.activity.visits === 1 && d.activity.countedCustomers === 2 && d.activity.registerSpend === 85 && d.activity.visitCost === 85 && d.activity.roi === 1 && d.activity.offersCreated === 2 && d.activity.applications === 3 && d.activity.postsDelivered === 1,
  JSON.stringify(d.activity));
check("engagement: the creator-reported sums match the seeded post",
  d.engagement && d.engagement.views === 1000 && d.engagement.likes === 50 && d.engagement.total === 1060 && d.engagement.reportedPosts === 1,
  JSON.stringify(d.engagement));
check("revenue: nothing collected on an empty ledger, no invented numbers",
  d.revenue && d.revenue.collected === 0, JSON.stringify(d.revenue));
check("downloads: the panel links the live store page",
  d.downloads && String(d.downloads.appStoreUrl || "").includes("apps.apple.com/app/magpie-local/id6837488886"), JSON.stringify(d.downloads));

// Spot-checks from a direct read of the store file, bypassing
// every helper the compute used.
const rawDb = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
const rawUsers = Object.entries(rawDb).filter(([k]) => k.startsWith("user:")).map(([, v]) => v);
const rawNashApproved = rawUsers.filter((u) => u.role === "creator" && u.status === "approved" && u.market === "Nashville").length;
const rawTotalCreators = rawUsers.filter((u) => u.role === "creator" && (u.status === "approved" || u.status === "pending")).length;
check("spot-check: Nashville approved matches a direct store read",
  rawNashApproved === 3 && nash.creatorsApproved === rawNashApproved, `raw=${rawNashApproved} served=${nash.creatorsApproved}`);
check("spot-check: total creators matches a direct store read",
  rawTotalCreators === 6 && d.creators.signedUp === rawTotalCreators, `raw=${rawTotalCreators} served=${d.creators && d.creators.signedUp}`);

// A malformed stored record (corruption, a manual write) must
// read as absent: the preparing state, never zeroed cards.
await store.set("config:adminStatsSummary", { bogus: true });
const malformed = await admin("GET", "/api/admin/stats-overview");
check("a malformed stored record answers preparing, not zeroed numbers",
  malformed.status === 200 && malformed.data && malformed.data.preparing === true && !("creators" in malformed.data),
  JSON.stringify(malformed.data).slice(0, 200));

console.log(`\nverify-build244: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
