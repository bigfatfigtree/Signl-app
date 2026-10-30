// Build -53: Admin Applications tab + visual market stats
// (Jeff, 2026-10-30). Two changes, both proven here:
//
// 1. APPLICATIONS GETS ITS OWN TAB. The old Applications
//    destination mixed the review queue with platform messages,
//    the Finish Engine panel and the founding roster counts, and
//    its rail label read "Requests". Now the rail carries TEN
//    admin destinations (Jeff's explicit order; supersedes his
//    2026-10-28 "nine, no more, no fewer"): "Applications" is
//    ONLY the queue (pending + decided, resolver suggestion +
//    file-market rows, the -52 refile sweep), and "Requests"
//    keeps everything else that lived there. These checks pin
//    the rail labels + destinations + order at source level and
//    the split line itself: the queue loader renders no message
//    or finish panel and no roster strip; the Requests loader
//    renders all three and builds the compose target map; the
//    queue's Message button crosses to Requests when the compose
//    panel is not on screen.
//
// 2. STATS LEADS WITH A SIGN-UP BOARD. GET /admin/stats now
//    carries a signupBoard aggregate computed from the stored
//    user records on every read (nothing stored, nothing that
//    can drift): totals (signed up / creators / businesses +
//    awaiting-review counts), per-market rows (role splits —
//    signed up, awaiting review, approved, profile finished for
//    creators), an Unlisted section grouping typed cities for
//    creators AND businesses, and the list of markets with zero
//    sign-ups. Testers are excluded. The fixture below seeds a
//    multi-market store incl. an unlisted typed city, a legacy
//    "Hampton Roads" record (server alias → Virginia Beach), a
//    rejected record and a tester; expected counts are recomputed
//    from the raw fixture records and cross-checked field by
//    field against the endpoint.
//    HARD GUARDRAIL: the board is Jeff's private ops data. A
//    non-admin creator gets 403 on the endpoint, anonymous is
//    refused, and neither the public bootstrap nor a creator
//    payload carries the board or any per-market count field.
//    Navigation contract (source level): a board row tap sets
//    adminAppFilter and goes to the Applications tab, and the
//    queue filters pending + decided through adminAppInFilter.
//
// Run: node scripts/verify-build53.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build53-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify-admin-pass-123";
process.env.APP_URL = "http://localhost";

const require = createRequire(import.meta.url);
const auth = require("../netlify/functions/lib/auth.js");
const { BUILD_ID } = require("../netlify/functions/lib/build.js");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// ---------- fixture records ----------
// One password for the seeded creator who logs in below.
const PW = "verify-creator-pass-123";
const { salt, hash } = auth.hashPassword(PW);
const creatorRec = (id, over) => ({
  id, role: "creator", email: `${id}@fixtures.dev`, name: `Creator ${id}`,
  passwordSalt: salt, passwordHash: hash,
  city: "Nashville", state: "TN", country: "United States",
  creator: { handle: id, followerCount: 1200, categories: ["Food"], localAudiencePct: 62 },
  ...over,
});
const businessRec = (id, over) => ({
  id, role: "business", email: `${id}@fixtures.dev`, name: `Biz ${id}`, businessName: `Biz ${id}`,
  passwordSalt: salt, passwordHash: hash,
  city: "Nashville", state: "TN", country: "United States",
  ...over,
});
const incomplete = { creator: { handle: "x", followerCount: 900, categories: ["Food"] } }; // no localAudiencePct → profile unfinished
const FIXTURES = [
  // Nashville: creators pending / approved-complete / approved-incomplete / rejected; businesses pending / approved
  creatorRec("nash-c-pending", { status: "pending", market: "Nashville" }),
  creatorRec("nash-c-complete", { status: "approved", market: "Nashville" }),
  creatorRec("nash-c-incomplete", { status: "approved", market: "Nashville", ...incomplete }),
  creatorRec("nash-c-rejected", { status: "rejected", market: "Nashville" }),
  businessRec("nash-b-pending", { status: "pending", market: "Nashville" }),
  businessRec("nash-b-approved", { status: "approved", market: "Nashville" }),
  // Virginia Beach: creators approved-complete / pending; one business approved
  creatorRec("vb-c-complete", { status: "approved", market: "Virginia Beach", city: "Virginia Beach", state: "VA" }),
  creatorRec("vb-c-pending", { status: "pending", market: "Virginia Beach", city: "Virginia Beach", state: "VA" }),
  businessRec("vb-b-approved", { status: "approved", market: "Virginia Beach", city: "Virginia Beach", state: "VA" }),
  // Legacy alias: stored before the 2026-10-23 rename — the board
  // must file it under Virginia Beach like the server resolver does.
  creatorRec("vb-c-legacy", { status: "approved", market: "Hampton Roads", city: "Norfolk", state: "VA", ...incomplete }),
  // Unlisted: typed cities outside every market (the Clarksville shape)
  creatorRec("unl-clark-pending", { status: "pending", market: "Not listed yet", city: "Clarksville", state: "TN" }),
  creatorRec("unl-clark-approved", { status: "approved", market: "Not listed yet", city: "Clarksville", state: "TN", ...incomplete }),
  businessRec("unl-clark-biz", { status: "approved", market: "Not listed yet", city: "Clarksville", state: "TN" }),
  creatorRec("unl-tulsa-pending", { status: "pending", market: "Not listed yet", city: "Tulsa", state: "OK" }),
  // Tester: pending in Nashville, must vanish from every board count
  creatorRec("nash-c-tester", { status: "pending", market: "Nashville", tester: true }),
];
const seed = {};
for (const u of FIXTURES) { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; }
fs.writeFileSync(DB_PATH, JSON.stringify(seed));

const { handler } = require("../netlify/functions/api.js");

function evt(method, p, { cookie, query, body } = {}) {
  return { httpMethod: method, path: p, headers: cookie ? { cookie } : {}, queryStringParameters: query || {}, body: body ? JSON.stringify(body) : null, isBase64Encoded: false };
}
const parse = (res) => { try { return JSON.parse(res.body); } catch (e) { return null; } };
const cookieOf = (res) => (((res.headers || {})["Set-Cookie"] || (res.headers || {})["set-cookie"] || "").split(";")[0]);

console.log("verify-build53: Applications tab split + Stats sign-up board");

// ---------- expected board, recomputed from the raw fixtures ----------
const ALIAS = { "Hampton Roads": "Virginia Beach" };
const exp = { totals: { users: 0, creators: 0, businesses: 0, awaitingCreators: 0, awaitingBusinesses: 0 }, markets: {}, unlisted: {} };
for (const u of FIXTURES) {
  if (u.tester) continue;
  exp.totals.users += 1;
  if (u.role === "creator") { exp.totals.creators += 1; if (u.status === "pending") exp.totals.awaitingCreators += 1; }
  else { exp.totals.businesses += 1; if (u.status === "pending") exp.totals.awaitingBusinesses += 1; }
  if (u.market === "Not listed yet") {
    const place = `${u.city}, ${u.country}`;
    const r = exp.unlisted[place] || (exp.unlisted[place] = { creators: 0, businesses: 0, awaitingReview: 0, total: 0 });
    if (u.role === "creator") r.creators += 1; else r.businesses += 1;
    if (u.status === "pending") r.awaitingReview += 1;
    r.total += 1;
    continue;
  }
  const m = ALIAS[u.market] || u.market;
  const r = exp.markets[m] || (exp.markets[m] = { creators: { signedUp: 0, awaitingReview: 0, approved: 0, profileFinished: 0 }, businesses: { signedUp: 0, awaitingReview: 0, approved: 0, profileFinished: 0 }, total: 0 });
  const c = u.role === "creator" ? r.creators : r.businesses;
  c.signedUp += 1;
  if (u.status === "pending") c.awaitingReview += 1;
  if (u.status === "approved") {
    c.approved += 1;
    // profile finished, from the fixture shape (profileCompleteOf):
    // approved creator with city + audience + category + local %
    if (u.role === "creator" && u.city && u.creator && u.creator.followerCount > 0 && (u.creator.categories || []).length > 0 && u.creator.localAudiencePct != null) c.profileFinished += 1;
  }
  r.total += 1;
}

// ---------- endpoint: admin read + aggregate math ----------
const login = await handler(evt("POST", "/api/auth/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } }));
check("admin login succeeds", login.statusCode === 200, `got ${login.statusCode}`);
const adminCookie = cookieOf(login);

const statsRes = await handler(evt("GET", "/api/admin/stats", { cookie: adminCookie }));
const stats = parse(statsRes);
check("GET /admin/stats answers 200 for admin", statsRes.statusCode === 200, `got ${statsRes.statusCode}`);
const board = stats && stats.signupBoard;
check("payload carries the signupBoard aggregate", !!board && !!board.totals && Array.isArray(board.markets) && Array.isArray(board.unlisted), JSON.stringify(stats).slice(0, 200));
check("totals match the fixture (testers out): 14 users, 10 creators, 4 businesses",
  !!board && board.totals.users === exp.totals.users && board.totals.creators === exp.totals.creators && board.totals.businesses === exp.totals.businesses,
  board && JSON.stringify(board.totals) + " expected " + JSON.stringify(exp.totals));
check("awaiting-review totals match: 4 creators, 1 business",
  !!board && board.totals.awaitingCreators === exp.totals.awaitingCreators && board.totals.awaitingBusinesses === exp.totals.awaitingBusinesses,
  board && JSON.stringify(board.totals));
check("markets sort biggest first (Nashville 6, then Virginia Beach 4)",
  !!board && board.markets.length === 2 && board.markets[0].market === "Nashville" && board.markets[0].total === 6 && board.markets[1].market === "Virginia Beach" && board.markets[1].total === 4,
  board && JSON.stringify(board.markets.map((m) => [m.market, m.total])));
const nash = board && board.markets.find((m) => m.market === "Nashville");
check("Nashville splits: creators 4/1/2/1 (signed/awaiting/approved/finished), businesses 2/1/1",
  !!nash && nash.creators.signedUp === 4 && nash.creators.awaitingReview === 1 && nash.creators.approved === 2 && nash.creators.profileFinished === 1
  && nash.businesses.signedUp === 2 && nash.businesses.awaitingReview === 1 && nash.businesses.approved === 1,
  nash && JSON.stringify(nash));
const vb = board && board.markets.find((m) => m.market === "Virginia Beach");
check("Virginia Beach counts the legacy Hampton Roads record (creators 3 signed up, 1 profile finished)",
  !!vb && vb.creators.signedUp === 3 && vb.creators.approved === 2 && vb.creators.profileFinished === 1 && vb.businesses.signedUp === 1,
  vb && JSON.stringify(vb));
check("every market row deep-matches the recomputed fixture counts",
  !!board && board.markets.every((m) => JSON.stringify({ c: m.creators, b: m.businesses, t: m.total }) === JSON.stringify({ c: exp.markets[m.market].creators, b: exp.markets[m.market].businesses, t: exp.markets[m.market].total })),
  board && JSON.stringify(board.markets));
const clark = board && board.unlisted.find((r) => r.city === "Clarksville");
check("unlisted Clarksville row: 3 total (2 creators, 1 business, 1 awaiting review)",
  !!clark && clark.total === 3 && clark.creators === 2 && clark.businesses === 1 && clark.awaitingReview === 1 && clark.place === "Clarksville, United States",
  clark && JSON.stringify(clark));
const tulsa = board && board.unlisted.find((r) => r.city === "Tulsa");
check("unlisted Tulsa row: 1 pending creator", !!tulsa && tulsa.total === 1 && tulsa.creators === 1 && tulsa.awaitingReview === 1, tulsa && JSON.stringify(tulsa));
check("unlisted sorts biggest first (Clarksville before Tulsa)",
  !!board && board.unlisted.length === 2 && board.unlisted[0].city === "Clarksville" && board.unlisted[1].city === "Tulsa");
check("markets with no sign-ups are listed as empty (Richmond among them) and never as rows",
  !!board && Array.isArray(board.emptyMarkets) && board.emptyMarkets.includes("Richmond") && !board.markets.some((m) => m.market === "Richmond"),
  board && JSON.stringify(board.emptyMarkets));
check("the tester record appears in no board total", !!board && board.totals.users === 14, board && `users=${board.totals.users}`);

// ---------- guardrail: the board is admin-only ----------
// The fixture itself, as raw records, must be consistent with the totals we just checked.
// FIXTURES has creators nash-c-pending, nash-c-complete, nash-c-incomplete, nash-c-rejected,
// vb-c-complete, vb-c-pending, vb-c-legacy, unl-clark-pending, unl-clark-approved,
// unl-tulsa-pending, nash-c-tester(tester) => 10 counted + 1 tester = 11 creator fixtures
// businesses: nash-b-pending, nash-b-approved, vb-b-approved, unl-clark-biz => 4
check("fixture sanity: 11 creators (1 tester) + 4 businesses", FIXTURES.filter((u) => u.role === "creator").length === 11 && FIXTURES.filter((u) => u.role === "business").length === 4);

const creatorLogin = await handler(evt("POST", "/api/auth/login", { body: { email: "nash-c-complete@fixtures.dev", password: PW } }));
check("seeded creator logs in", creatorLogin.statusCode === 200, `got ${creatorLogin.statusCode}: ${creatorLogin.body}`);
const creatorCookie = cookieOf(creatorLogin);
const forbidden = await handler(evt("GET", "/api/admin/stats", { cookie: creatorCookie }));
check("non-admin creator gets 403 on GET /admin/stats", forbidden.statusCode === 403, `got ${forbidden.statusCode}`);
const anon = await handler(evt("GET", "/api/admin/stats"));
check("anonymous GET /admin/stats is refused (401/403)", anon.statusCode === 401 || anon.statusCode === 403, `got ${anon.statusCode}`);

const boot = parse(await handler(evt("GET", "/api/bootstrap")));
check("public bootstrap carries no signupBoard and no per-market sign-up counts",
  !!boot && !("signupBoard" in boot) && !JSON.stringify(boot).includes("signupBoard") && !JSON.stringify(boot).includes("profileFinished"),
  boot && Object.keys(boot).join(","));
const me = await handler(evt("GET", "/api/auth/me", { cookie: creatorCookie }));
check("creator /me payload carries no signupBoard",
  me.statusCode === 200 && !String(me.body).includes("signupBoard") && !String(me.body).includes("profileFinished"),
  `got ${me.statusCode}`);

// ---------- source: rail, split, board, navigation ----------
const appSrc = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const win = (startMarker, endMarker) => {
  const a = appSrc.indexOf(startMarker);
  const b = endMarker ? appSrc.indexOf(endMarker, a + startMarker.length) : appSrc.length;
  return a >= 0 && b > a ? appSrc.slice(a, b) : "";
};

check("build stamp is 2026.10.30-53", BUILD_ID === "2026.10.30-53", BUILD_ID);
check("index.html carries the -53 stamp", fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").includes("2026.10.30-53"));

const rail = win('if (u.role === "admin") {', "return items;");
check("rail: admin block found", rail.length > 0);
const railLabels = [...rail.matchAll(/add\("[abc]", "[a-z]+", "([^"]+)"/g)].map((m) => m[1]);
check("rail: first two admin destinations are Applications, then Requests",
  railLabels[0] === "Applications" && railLabels[1] === "Requests", railLabels.join(" | "));
check("rail: Applications goes to the Applications tab, Requests to the Requests tab",
  rail.includes(`add("a", "inbox", "Applications", "return go('dashboard','Applications')"`) && rail.includes(`add("a", "requests", "Requests", "return go('dashboard','Requests')"`));
const allLabels = railLabels;
check("rail: TEN admin destinations in Jeff's order (Applications, Requests, Markets, Recruiters, Partners, Event Log, Compliance, Campaign, Stats, Sig)",
  JSON.stringify(allLabels) === JSON.stringify(["Applications", "Requests", "Markets", "Recruiters", "Partners", "Event Log", "Compliance", "Campaign", "Stats", "Sig"]),
  allLabels.join(" | "));

const renderAdminSrc = win("function renderAdmin() {", "function adminSigItems(");
check("renderAdmin dispatches Requests to loadAdminRequests and Applications to loadApplications",
  renderAdminSrc.includes('if (tab === "Requests") loadAdminRequests();') && renderAdminSrc.includes('if (tab === "Applications") loadApplications();'));

const queueSrc = win("async function loadApplications()", "// ---------- Admin: Requests");
check("Applications tab is queue-only: refile sweep panel + Pending/Decided, no message panel, no finish panel, no roster strip",
  queueSrc.includes('id="admin-refile-panel"') && queueSrc.includes("Pending (") && queueSrc.includes("Decided (")
  && !queueSrc.includes("admin-msg-panel") && !queueSrc.includes("admin-finish-panel") && !queueSrc.includes("Founding roster counts"),
  queueSrc.slice(0, 200));
check("queue rows keep the resolver suggestion + file-market tap",
  queueSrc.includes("marketSuggestion") && queueSrc.includes("fileUnderMarket(") && queueSrc.includes("File under "));
const requestsSrc = win("async function loadAdminRequests()", "// Admin profile view");
check("Requests keeps the platform-message panel, the Finish Engine panel and the founding roster counts",
  requestsSrc.includes('id="admin-msg-panel"') && requestsSrc.includes('id="admin-finish-panel"') && requestsSrc.includes("Founding roster counts") && requestsSrc.includes("renderAdminMessages()") && requestsSrc.includes("renderAdminFinishEngine()"));
check("Requests builds the compose target map (state.adminMsgUsers)", requestsSrc.includes("state.adminMsgUsers"));
const composeSrc = win("function adminMsgComposeTo(", "async function adminMsgOpenThread(");
check("queue Message button crosses to Requests when the compose panel is off-screen",
  composeSrc.includes('!document.getElementById("admin-msg-panel")') && composeSrc.includes('go("dashboard", "Requests")') && composeSrc.includes("adminMsg.scrollToCompose = true"));

check("queue applies the board filter to pending + decided",
  queueSrc.includes(".filter(adminAppInFilter)") && queueSrc.includes("adminAppClearFilter"));
const navSrc = win("function adminBoardGoMarket(", "function adminSignupBoardHtml(");
check("board market tap sets the market filter and opens Applications",
  navSrc.includes('adminAppFilter = { kind: "market"') && navSrc.includes('go("dashboard", "Applications")'));
check("board unlisted tap sets the city filter and opens Applications",
  navSrc.includes('adminAppFilter = { kind: "unlisted"') && navSrc.includes("r.place"));
const filterSrc = win("function adminAppInFilter(", "function adminAppClearFilter(");
check("filter matches market rows by canonical market and unlisted rows by typed place",
  filterSrc.includes('f.kind === "market"') && filterSrc.includes("adminCanonMarket(u.market) === f.market") && filterSrc.includes("unlistedPlace(u) === f.place"));

const statsSrc = win("async function loadStats()", "async function adminLineLookup()");
check("Stats renders the sign-up board first, above the existing tiles",
  statsSrc.indexOf("adminSignupBoardHtml(s.signupBoard)") >= 0 && statsSrc.indexOf("adminSignupBoardHtml(s.signupBoard)") < statsSrc.indexOf('class="stat-row"'));
check("everything Stats already carried stays below the board (Your Line lookup, market table, Square connections)",
  statsSrc.includes("Your Line lookup") && statsSrc.includes("s.perMarket") && statsSrc.includes("Register connections (Square)"));
const boardSrc = win("function adminSignupBoardHtml(", "async function loadStats()");
check("board renders totals strip, two-segment bars and plain-word splits",
  boardSrc.includes("Signed up") && boardSrc.includes("awaiting review") && boardSrc.includes("profile finished") && boardSrc.includes("sb-creators") && boardSrc.includes("sb-biz") && boardSrc.includes("Not in a market yet"));

// ---------- server source: aggregate lives only in the admin handler ----------
const routerSrc = fs.readFileSync(new URL("../netlify/functions/lib/router.js", import.meta.url), "utf8");
check("signupBoard exists exactly twice in the server: computed once inside the admin stats handler, returned once in its payload",
  (routerSrc.match(/signupBoard/g) || []).length === 2 && routerSrc.indexOf("const signupBoard") > routerSrc.indexOf('seg[1] === "stats"'),
  `occurrences=${(routerSrc.match(/signupBoard/g) || []).length}`);

console.log(`\nverify-build53: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
