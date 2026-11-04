#!/usr/bin/env node
// Build -116 verification (Jeff, 2026-11-03): Admin review DECK
// for Applications, Find-a-user search, Markets as groupable /
// sortable cards, and per-market creators + combined followers
// computed live (multi-market listing counts a creator in
// every market they are listed in).
//
// Proves, against a throwaway local DB seeded with fixtures:
//   S. source pins: deck + toggle + card component + search UI
//      in the client; search endpoint, audience attach and
//      reach totals in the router; Sig marketReach facts, the
//      facts line and the reach answer branch; the stamp.
//   A. the applications payload carries the deck's audience
//      block (stacked total + per-platform breakdown) and the
//      pending queue in createdAt order (the deck's order).
//   B. market totals on the pristine fixture set: a
//      multi-market creator counts in BOTH markets with her
//      full stacked total; a tester counts nowhere.
//   C. Find a user: name / @handle / email partial matches,
//      market filter following the listing rules, short query
//      refused politely, unknown market refused, non-admin
//      refused.
//   D. decisions through the EXISTING review endpoint: the
//      under-500 refusal (422, still pending, underMinimum
//      stamped), the grandfathered approval at the same total,
//      a normal approval, a rejection with a fixed reason.
//   E. totals move live after those decisions, and the tester
//      toggle moves them too (no stored counters).
//   F. Admin Sig answers "which market has the most combined
//      followers / most creators" from the same facts.
//
// Run: node scripts/verify-build116.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const require = createRequire(import.meta.url);
const PORT = 9052;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = ["verify", "admin", "pass", "116"].join("-");
const PW = "fixture-password-1";
const DAY = 24 * 3600 * 1000;
const now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();

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
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const sigdataJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
const themeCss = fs.readFileSync(path.join(root, "public/theme-v2.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
check("stamp is 2026.11.03-119", indexHtml.includes("2026.11.03-119") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.03-119"));
check("client: deck renders the first pending application as the card", appJs.includes("function adminDeckHtml(pend)") && appJs.includes("const u = pend[0];"));
check("client: Deck/List toggle with the deck as the default while a queue exists", appJs.includes('onclick="adminAppSetView(\'deck\')"') && appJs.includes('adminAppView = pend.length ? "deck" : "list"'));
check("client: deck decisions post to the existing review endpoint", appJs.includes('await api("POST", "/admin/review", { userId, decision, ...(reason ? { reason } : {}) })'));
check("client: deck done state is a clean Queue clear with session counts", appJs.includes("Queue clear") && appJs.includes("adminDeckSession"));
check("client: card shows the stacked total big, labelled as reported", appJs.includes("admin-card-total-num") && appJs.includes("total followers, all platforms stacked (as reported by the creator)"));
check("client: card warns under the 500 minimum before the tap", appJs.includes("Under the 500 minimum:") && appJs.includes("ADMIN_MIN_RULE_SINCE"));
check("client: card action row carries the servicing set incl. Make tester", appJs.includes("Send sign-in link") && appJs.includes('"Remove tester" : "Make tester"') && appJs.includes("toggleCardAttribution"));
check("client: Find a user panel + search call", appJs.includes("Find a user") && appJs.includes("/admin/users/search?q="));
check("client: search no-match state keeps the search editable", appJs.includes("No user matches that."));
check("client: markets render as cards with sort + group controls", appJs.includes("function adminMarketCardHtml(m)") && appJs.includes("Most combined followers") && appJs.includes("By country") && appJs.includes("By status"));
check("client: combined followers labelled honestly on the card", appJs.includes("combined followers (as reported by creators), across"));
check("client: every market action survives on the card", appJs.includes("toggleMarket(") && appJs.includes("activateMarketBusinesses(") && appJs.includes("toggleBench("));
check("client: Admin Sig attention list reads the same combined totals", appJs.includes("carries the most combined reach"));
check("css: deck + market card styles exist", themeCss.includes(".admin-deck-btn") && themeCss.includes(".mkt-grid") && themeCss.includes(".admin-card-total-num"));
check("server: applications attach carries the audience view", routerJs.includes("pub.creator.audience = audienceView(u.creator);"));
check("server: markets totals computed live from listed markets x stacked totals", routerJs.includes("reachByMarket") && routerJs.includes("combinedFollowers: (reachByMarket[m.name] || {}).followers || 0") && routerJs.includes("creatorsListed: (reachByMarket[m.name] || {}).creators || 0"));
check("server: user search endpoint is admin-area, short query returns no rows", routerJs.includes('seg[1] === "users" && seg[2] === "search"') && routerJs.includes("needsQuery: true"));
check("server: search market filter follows the listing rules", routerJs.includes("isListedInMarket(u, marketWanted)"));
check("server: Sig facts get the same listing + audience helpers", routerJs.includes("listedMarketsFor, audienceTotalOf,"));
check("sigdata: marketReach facts + facts line + reach answer", sigdataJs.includes("marketReach") && sigdataJs.includes("Combined followers by market") && sigdataJs.includes("leads both ways"));
check("no undo is faked anywhere in the deck", !appJs.includes("adminDeckUndo") && !routerJs.includes("un-review"));

// ---------- fixtures ----------
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(PW, salt, 64).toString("hex");
function creatorRec(id, name, email, handle, over = {}) {
  return {
    id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash,
    status: "pending", market: "Nashville", city: "Nashville",
    createdAt: iso(now0 - 10 * DAY), updatedAt: iso(now0 - 10 * DAY),
    creator: {
      handle, primaryPlatform: "instagram", followerCount: 1000, totalAudience: 1000,
      audienceStack: { instagram: 1000 }, categories: ["Food & Drink"], localAudiencePct: 60,
      tierBand: "Neighbors", profileComplete: true, hasPhoto: false, bio: "",
      ...(over.creator || {}),
    },
    ...(over.top || {}),
  };
}
const fixtures = [
  creatorRec("b116-mandy", "Mandy Multi", "mandy@fixtures.dev", "multimandy", {
    top: { status: "approved", reviewedAt: iso(now0 - 39 * DAY), createdAt: iso(now0 - 40 * DAY) },
    creator: { followerCount: 15000, totalAudience: 15000, audienceStack: { instagram: 10000, tiktok: 5000 }, audienceMarkets: [{ market: "Richmond", pct: 20 }], localAudiencePct: 55, tierBand: "Locals", hasPhoto: true },
  }),
  creatorRec("b116-rita", "Rita Richmond", "rita@fixtures.dev", "ritarichmond", {
    top: { status: "approved", market: "Richmond", city: "Richmond", reviewedAt: iso(now0 - 29 * DAY), createdAt: iso(now0 - 30 * DAY) },
    creator: { followerCount: 2000, totalAudience: 2000, audienceStack: { instagram: 2000 }, localAudiencePct: 70 },
  }),
  creatorRec("b116-tess", "Tess Tester", "tess@fixtures.dev", "tesstester", {
    top: { status: "approved", tester: true, reviewedAt: iso(now0 - 19 * DAY), createdAt: iso(now0 - 20 * DAY) },
    creator: { followerCount: 999999, totalAudience: 999999, audienceStack: { instagram: 999999 } },
  }),
  creatorRec("b116-gary", "Gary Grandfathered", "gary@fixtures.dev", "garyeats", {
    top: { createdAt: "2026-10-20T12:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z" },
    creator: { followerCount: 300, totalAudience: 300, audienceStack: { instagram: 300 } },
  }),
  creatorRec("b116-pete", "Pete Pending", "pete@fixtures.dev", "petepending", {
    top: { createdAt: iso(now0 - 3 * DAY), updatedAt: iso(now0 - 3 * DAY) },
    creator: { followerCount: 216000, totalAudience: 216000, audienceStack: { instagram: 216000 }, tierBand: "Headliners" },
  }),
  creatorRec("b116-pam", "Pam Pending", "pam@fixtures.dev", "pampending", {
    top: { market: "Richmond", city: "Richmond", createdAt: iso(now0 - 12 * 3600 * 1000), updatedAt: iso(now0 - 12 * 3600 * 1000) },
    creator: { followerCount: 300, totalAudience: 300, audienceStack: { tiktok: 300 }, primaryPlatform: "tiktok" },
  }),
  creatorRec("b116-rob", "Rob Rejected", "rob@fixtures.dev", "robrejected", {
    top: { status: "rejected", market: "Richmond", city: "Richmond", createdAt: iso(now0 - 25 * DAY), reviewedAt: iso(now0 - 24 * DAY), rejectionReason: "Content not a fit" },
    creator: { followerCount: 5000, totalAudience: 5000, audienceStack: { instagram: 5000 } },
  }),
  {
    id: "b116-bistro", role: "business", email: "owner@pendingbistro.dev", name: "Bistro Owner",
    passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville",
    createdAt: iso(now0 - 6 * 3600 * 1000), updatedAt: iso(now0 - 6 * 3600 * 1000),
    business: { businessName: "Pending Bistro", category: "Restaurant", planId: "growth", plan: "growth" },
  },
];

// ---------- live harness ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build116-"));
const dbFile = path.join(tmp, "db.json");
{
  const data = {};
  for (const u of fixtures) { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; }
  fs.writeFileSync(dbFile, JSON.stringify(data));
}
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
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
    if (setCookie) for (const piece of setCookie.split(/,(?=[^;]+=)/)) {
      const m = piece.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data, text };
  };
}
async function login(email, password = PW) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email, password });
  return { client: c, status: r.status, data: r.data };
}
const marketRow = (data, name) => (data.markets || []).find((m) => m.name === name);

try {
  startServer();
  await waitUp();
  const { client: admin, status: adminStatus } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  check("admin login", adminStatus === 200, String(adminStatus));

  // ---------- A: applications payload ----------
  part("A: applications payload");
  const apps = await admin("GET", "/api/admin/applications");
  check("applications read ok", apps.status === 200, String(apps.status));
  const pendIds = (apps.data.pending || []).map((u) => u.id);
  check("pending queue in createdAt order (the deck's order)", JSON.stringify(pendIds) === JSON.stringify(["b116-gary", "b116-pete", "b116-pam", "b116-bistro"]), pendIds.join(","));
  const pete = (apps.data.pending || []).find((u) => u.id === "b116-pete");
  check("deck audience block: stacked total rides along", pete && pete.creator.audience && pete.creator.audience.total === 216000, JSON.stringify(pete && pete.creator.audience));
  const pam = (apps.data.pending || []).find((u) => u.id === "b116-pam");
  check("deck audience block: per-platform breakdown", pam && pam.creator.audience && pam.creator.audience.total === 300 && pam.creator.audience.platforms.length === 1 && pam.creator.audience.platforms[0].platform === "tiktok" && pam.creator.audience.platforms[0].count === 300, JSON.stringify(pam && pam.creator.audience));

  // ---------- B: pristine market totals ----------
  part("B: market totals (pristine)");
  const mk1 = await admin("GET", "/api/admin/markets");
  check("markets read ok", mk1.status === 200, String(mk1.status));
  const nash1 = marketRow(mk1.data, "Nashville");
  const rich1 = marketRow(mk1.data, "Richmond");
  check("Nashville: only the one real approved creator listed (tester excluded)", nash1 && nash1.creatorsListed === 1, JSON.stringify(nash1 && { l: nash1.creatorsListed, f: nash1.combinedFollowers }));
  check("Nashville: combined followers = her full stacked total", nash1 && nash1.combinedFollowers === 15000, String(nash1 && nash1.combinedFollowers));
  check("Richmond: the multi-market creator counts here too, plus the home creator", rich1 && rich1.creatorsListed === 2, JSON.stringify(rich1 && { l: rich1.creatorsListed, f: rich1.combinedFollowers }));
  check("Richmond: combined followers = 15,000 (listed) + 2,000 (home) = 17,000", rich1 && rich1.combinedFollowers === 17000, String(rich1 && rich1.combinedFollowers));
  check("home-market counts untouched by the new fields", nash1 && nash1.creatorsApproved === 1 && rich1 && rich1.creatorsApproved === 1, JSON.stringify({ n: nash1 && nash1.creatorsApproved, r: rich1 && rich1.creatorsApproved }));

  // ---------- C: Find a user ----------
  part("C: user search");
  const sName = await admin("GET", "/api/admin/users/search?q=mandy");
  check("search by name finds the approved creator (not just pending)", sName.status === 200 && (sName.data.users || []).some((u) => u.id === "b116-mandy" && u.status === "approved"), JSON.stringify(sName.data).slice(0, 200));
  const sHandle = await admin("GET", "/api/admin/users/search?q=%40multimandy");
  check("search by @handle", (sHandle.data.users || []).some((u) => u.id === "b116-mandy"));
  const sEmail = await admin("GET", "/api/admin/users/search?q=rita%40fixtures");
  check("search by partial email", (sEmail.data.users || []).some((u) => u.id === "b116-rita"));
  const sRejected = await admin("GET", "/api/admin/users/search?q=rob");
  check("search finds a rejected record too", (sRejected.data.users || []).some((u) => u.id === "b116-rob" && u.status === "rejected"));
  const sBiz = await admin("GET", "/api/admin/users/search?q=bistro");
  check("search finds a business by business name", (sBiz.data.users || []).some((u) => u.id === "b116-bistro"));
  const sMarketHit = await admin("GET", "/api/admin/users/search?q=mandy&market=Richmond");
  check("market filter follows the listing rules (she is listed in Richmond)", (sMarketHit.data.users || []).some((u) => u.id === "b116-mandy"));
  const sMarketMiss = await admin("GET", "/api/admin/users/search?q=mandy&market=London");
  check("market filter excludes markets she is not listed in", (sMarketMiss.data.users || []).length === 0, JSON.stringify(sMarketMiss.data).slice(0, 120));
  const sShort = await admin("GET", "/api/admin/users/search?q=a");
  check("one-letter query returns no rows (never a user dump)", sShort.status === 200 && sShort.data.needsQuery === true && (sShort.data.users || []).length === 0, JSON.stringify(sShort.data).slice(0, 120));
  const sNone = await admin("GET", "/api/admin/users/search?q=zzzzqq");
  check("no match answers empty, not an error", sNone.status === 200 && (sNone.data.users || []).length === 0 && sNone.data.total === 0);
  const sBadMarket = await admin("GET", "/api/admin/users/search?q=mandy&market=Bogus");
  check("unknown market refused in plain words", sBadMarket.status === 400, String(sBadMarket.status));
  const { client: ritaClient, status: ritaStatus } = await login("rita@fixtures.dev");
  check("fixture creator login", ritaStatus === 200, String(ritaStatus));
  const sDenied = await ritaClient("GET", "/api/admin/users/search?q=mandy");
  check("non-admin search refused", sDenied.status === 403 || sDenied.status === 401, String(sDenied.status));
  const mandyHit = (sName.data.users || []).find((u) => u.id === "b116-mandy");
  check("search payload carries the card's audience block", mandyHit && mandyHit.creator.audience && mandyHit.creator.audience.total === 15000);

  // ---------- F (facts first, while the set is pristine) ----------
  part("F: Admin Sig reach facts");
  const sigdata = require(path.join(root, "netlify/functions/lib/sigdata.js"));
  const router = require(path.join(root, "netlify/functions/lib/router.js"));
  const { listedMarketsFor } = require(path.join(root, "netlify/functions/lib/audience-markets.js"));
  const facts = sigdata.buildAdminFacts({
    users: fixtures, offers: [], bookings: [], posts: [], partners: [], marketFlags: {}, dealFacts: null, territoryConflicts: [], londonRace: null, teamByPartner: {},
    marketNames: ["Nashville", "Richmond"],
    isTester: (u) => u.tester === true,
    profileCompleteOf: router.profileCompleteOf,
    businessAccessState: (u) => (u.business && u.business.accessState === "active" ? "active" : "founding"),
    planNameOf: () => "Growth",
    listedMarketsFor, audienceTotalOf: router.audienceTotalOf,
    now: now0,
  });
  const reach = facts.creators.marketReach || [];
  const richReach = reach.find((m) => m.market === "Richmond");
  const nashReach = reach.find((m) => m.market === "Nashville");
  check("facts: Richmond reach = 2 listed creators, 17,000 combined", richReach && richReach.creators === 2 && richReach.combinedFollowers === 17000, JSON.stringify(richReach));
  check("facts: Nashville reach = 1 listed creator, 15,000 combined (tester out)", nashReach && nashReach.creators === 1 && nashReach.combinedFollowers === 15000, JSON.stringify(nashReach));
  const lines = sigdata.factsLines("admin", facts).join("\n");
  check("facts lines carry the combined-followers line for the AI path", lines.includes("Combined followers by market") && lines.includes("Richmond: 17,000 combined followers across 2 listed creators"), lines.slice(0, 200));
  const ansReach = sigdata.answerFacts("admin", facts, "which market has the most combined followers", []);
  check("Sig answers the reach question from the same numbers", typeof ansReach === "string" && ansReach.includes("Richmond") && ansReach.includes("17,000") && ansReach.includes("(as reported by creators)"), String(ansReach).slice(0, 200));
  const ansCreators = sigdata.answerFacts("admin", facts, "which market has the most creators", []);
  check("Sig answers the most-creators question from listed counts", typeof ansCreators === "string" && ansCreators.includes("Richmond") && ansCreators.includes("2 listed creators"), String(ansCreators).slice(0, 200));

  // ---------- D: decisions through the existing endpoint ----------
  part("D: review decisions");
  const pamApprove = await admin("POST", "/api/admin/review", { userId: "b116-pam", decision: "approve" });
  check("under-500 approval refused by the existing rule (422)", pamApprove.status === 422, String(pamApprove.status));
  check("the refusal names the 500 minimum in plain words", !!(pamApprove.data && pamApprove.data.error && pamApprove.data.error.includes("500")), JSON.stringify(pamApprove.data).slice(0, 200));
  const appsAfterPam = await admin("GET", "/api/admin/applications");
  check("the refused application stays pending", (appsAfterPam.data.pending || []).some((u) => u.id === "b116-pam"));
  const dbAfterPam = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  check("the refusal stamps underMinimum on the record", dbAfterPam["user:b116-pam"] && !!dbAfterPam["user:b116-pam"].underMinimum && dbAfterPam["user:b116-pam"].underMinimum.total === 300);
  const garyApprove = await admin("POST", "/api/admin/review", { userId: "b116-gary", decision: "approve" });
  check("grandfathered record approves at the same 300 total", garyApprove.status === 200, String(garyApprove.status) + " " + JSON.stringify(garyApprove.data).slice(0, 150));
  const peteApprove = await admin("POST", "/api/admin/review", { userId: "b116-pete", decision: "approve" });
  check("ordinary approval works", peteApprove.status === 200, String(peteApprove.status));
  const bistroReject = await admin("POST", "/api/admin/review", { userId: "b116-bistro", decision: "reject", reason: "Content not a fit" });
  check("business rejection works", bistroReject.status === 200, String(bistroReject.status));
  const pamReject = await admin("POST", "/api/admin/review", { userId: "b116-pam", decision: "reject", reason: "Content not a fit" });
  check("creator rejection with a fixed reason works", pamReject.status === 200, String(pamReject.status));
  const appsAfter = await admin("GET", "/api/admin/applications");
  const pamDec = (appsAfter.data.decided || []).find((u) => u.id === "b116-pam");
  check("the rejection reason is stored on the decided record", pamDec && pamDec.rejectionReason === "Content not a fit", JSON.stringify(pamDec && pamDec.rejectionReason));
  const bistroDec = (appsAfter.data.decided || []).find((u) => u.id === "b116-bistro");
  check("the business lands in decided as rejected", bistroDec && bistroDec.status === "rejected", JSON.stringify(bistroDec && bistroDec.status));

  // ---------- E: totals move live ----------
  part("E: live totals after decisions");
  const mk2 = await admin("GET", "/api/admin/markets");
  const nash2 = marketRow(mk2.data, "Nashville");
  check("Nashville after two approvals: 3 listed, 231,300 combined", nash2 && nash2.creatorsListed === 3 && nash2.combinedFollowers === 231300, JSON.stringify(nash2 && { l: nash2.creatorsListed, f: nash2.combinedFollowers }));
  const tessOff = await admin("POST", "/api/admin/tester", { userId: "b116-tess", tester: false });
  check("tester toggle endpoint answers", tessOff.status === 200, String(tessOff.status));
  const mk3 = await admin("GET", "/api/admin/markets");
  const nash3 = marketRow(mk3.data, "Nashville");
  check("un-testing the 999,999-follower tester moves the total immediately", nash3 && nash3.creatorsListed === 4 && nash3.combinedFollowers === 1231299, JSON.stringify(nash3 && { l: nash3.creatorsListed, f: nash3.combinedFollowers }));
  const tessOn = await admin("POST", "/api/admin/tester", { userId: "b116-tess", tester: true });
  const mk4 = await admin("GET", "/api/admin/markets");
  const nash4 = marketRow(mk4.data, "Nashville");
  check("re-testing removes her again", tessOn.status === 200 && nash4 && nash4.creatorsListed === 3 && nash4.combinedFollowers === 231300, JSON.stringify(nash4 && { l: nash4.creatorsListed, f: nash4.combinedFollowers }));
} catch (e) {
  failed++;
  failures.push("harness: " + e.message);
  console.error("HARNESS ERROR", e);
} finally {
  await stopServer();
}

console.log(`\nverify-build116: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
