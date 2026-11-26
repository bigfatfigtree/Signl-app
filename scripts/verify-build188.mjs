#!/usr/bin/env node
// verify-build188.mjs — Build -188: the full-platform audit
// fold-in, Wave 1. Pins per punch-list item:
//   PL-01 launch canon = 50 APPROVED (router bar, bizdev GATE,
//         Admin Markets order, creator unlock payload, BD gate)
//   PL-12 foundingRank stripped from non-admin payloads (band only)
//   PL-13 Maggie's local-% prompts split: headline vs breakdown
//   PL-14 full-form signups get publicPage on, like quick claims;
//         the "Profile live" chip reads the real switch
//   PL-15 side switch clears the cached sigHome notice stack
//   PL-18 Applications summary driven from the launch-market set
//   PL-20 contacts carry kinds + a summary that reconciles
//   PL-21 category-held leads leave the route, land in onHold
//   PL-05 desync seat: server 403s; client collapses (source pins)
//   PL-06 rep kit follows the selected market; PL-07 no ?mkt =
//         home market (the lastMarketId fallback is gone);
//         PL-19 My Money slots follow d.marketName (source pins)
//   PL-24 signup reorder (source pins); PL-03/04 (source pins for
//         the CSS fixes; geometry asserted in rendered QA)
//   PL-59 login survives a failed sign-in stamp write
//   P3 cluster source pins (PL-29a/42/48/63/78/80)
// Run: node scripts/verify-build188.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = path.join(os.tmpdir(), `signl-verify-build188-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = ["verify188", "admin", "pw"].join("-");
const PW = ["verify188", "user", "pw"].join("-");
process.env.ADMIN_PASSWORD = ADMIN_PW;
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_VERIFY_TOKEN = ["verify188","token"].join("-");
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const auth = require("../netlify/functions/lib/auth.js");
const bizdev = require("../netlify/functions/lib/bizdev.js");
const { handler } = require("../netlify/functions/api.js");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log("  ok  " + name); }
  else { failed += 1; failures.push(name + (extra ? " :: " + extra : "")); console.log("  FAIL  " + name + (extra ? " :: " + extra : "")); }
}
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({ httpMethod: method, path: url.pathname, headers, queryStringParameters: Object.fromEntries(url.searchParams.entries()), body: body === undefined ? null : JSON.stringify(body), isBase64Encoded: false });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let parsed = null;
    try { parsed = JSON.parse(res.body || "null"); } catch (e) { /* raw */ }
    return { status: res.statusCode, data: parsed, raw: res.body || "" };
  };
}
const seg = (src, a, b) => { const i = src.indexOf(a); if (i < 0) return ""; const j = b ? src.indexOf(b, i + a.length) : -1; return src.slice(i, j > i ? j : undefined); };

// ---------------- source pins ----------------
console.log("== source pins ==");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");
const bizJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/bizdev.js"), "utf8");
const sigJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/sigdata.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const themeCss = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");
// PL-03: the pill ships as a chip, lifts clear of interactive
// elements, and content gets bottom clearance where it floats.
check("PL-03 pill collapses to the avatar chip by default", appJs.includes("state.fabMini !== false") && themeCss.includes("#agent-fab.fab-mini"));
check("PL-03 overlap guard lifts the chip clear", appJs.includes("function fabAvoid188()"));
check("PL-03 bottom clearance where the pill floats", themeCss.includes("body.fab-on188 #app { padding-bottom: 92px; }"));
// PL-04: the Lineup panel lands below the sticky bar.
check("PL-04 lineup slot carries scroll clearance under the bar", themeCss.includes("#lineup-slot, #fo-lineup-slot { scroll-margin-top: 84px; }"));
// PL-03 residual (fix pass): the guard probes the chip's FULL
// box against real glyph rects + interactive rects and searches
// both directions for the nearest clear spot; the old 5-point /
// center-only sampling is gone, and the bottom clearance now
// applies at phone widths too, not only >=901px.
check("PL-03 residual: guard builds blockers from text glyph rects (TreeWalker + getClientRects)", (() => { const s = seg(appJs, "function fabAvoid188()", "function renderAgentFab"); return s.includes("createTreeWalker") && s.includes("getClientRects"); })());
check("PL-03 residual: guard searches down as well as up for a clear spot", (() => { const s = seg(appJs, "function fabAvoid188()", "function renderAgentFab"); return s.includes("maxDown") && s.includes("base - d"); })());
check("PL-03 residual: bottom clearance is not desktop-only any more", !themeCss.includes("@media (min-width: 901px) {\n  body.fab-on188 #app"));
// PL-01 residual (fix pass): Maggie's launch definition is the
// canon everywhere she states it: launch = 50 APPROVED; finished
// profiles are reported alongside, never the bar.
check("PL-01 residual: admin Maggie bank defines launch as 50 approved", appJs.includes("The launch number is 50 approved creators: a market opens at 50 approved."));
check("PL-01 residual: old admin-bank launch definition is gone", !appJs.includes("The launch number is approved creators with a finished profile"));
check("PL-01 residual: creator offers answer counts approvals toward opening", appJs.includes("a market opens at 50 approved creators: approvals are the count that moves a city toward opening") && !appJs.includes("finished founding profiles are literally one of the counts that moves a city toward opening"));
check("PL-01 residual: sigdata counts answer names approved as the launch number", sigJs.includes("Approved creators are the launch number: a market opens at 50 approved."));
check("PL-01 residual: sigdata no longer calls finished profiles the launch number", !sigJs.includes("Finished profiles are the launch number"));
// PL-01 residual (fix pass): the retired 50-60 gate range is
// gone from Admin's suggestion machinery in router.js: the
// SUGGESTION_WATCHING line, the gate comment, and the gate
// receipts (which now print the single canon figure).
check("PL-01 residual: SUGGESTION_WATCHING uses the 50 approved launch bar", routerJs.includes("Every market's run at its launch bar of 50 approved creators, category balance included"));
check("PL-01 residual: no 50-60 gate language survives in router.js", !routerJs.includes("50-60") && !routerJs.includes("50–60"));
check("PL-01 residual: gate receipts print the single figure, never the range", routerJs.includes("gate: `${GATE_LOW}`") && !routerJs.includes("${GATE_LOW}-${GATE_LOW + 10}"));
check("stamp: BUILD_ID is 2026.11.17-188", buildJs.includes('exports.BUILD_ID = "2026.11.17-188"'));
check("stamp: shell carries 2026.11.17-188 x4", (indexHtml.match(/2026\.11\.17-188/g) || []).length === 4);
check("PL-01: FOUNDING_LAUNCH_BAR is 50", /const FOUNDING_LAUNCH_BAR = 50;/.test(routerJs));
check("PL-01: bizdev GATE is 50/50", /const GATE = \{ low: 50, high: 50 \}/.test(bizJs));
check("PL-01: unlock meter gates its percentage on approved", appJs.includes("un.approved >= 10 || un.complete >= 10") && appJs.includes("un.approved >= un.launchBar"));
check("PL-12: rankApplications emits foundingBand, never foundingRank", (() => { const s = seg(routerJs, "async function rankApplications", "const RELEASE_REASON_TEXT"); return s.includes("foundingBand: foundingBand(") && !/foundingRank:/.test(s); })());
check("PL-15: switchSide180 clears state.sigHome", seg(appJs, "async function switchSide180", "function sigHomeOpen188").includes("state.sigHome = null"));
check("PL-05: no-seat panel + seat-gone hook exist", appJs.includes("bdNoSeatPanelHtml") && appJs.includes("bdSeatGone") && appJs.includes("Your Biz Dev seat isn't active"));
check("PL-06: kitFor follows the seat's market for reps", bizJs.includes("repKit188(seat.marketName)"));
check("PL-07: lastMarketId fallback removed", !bizJs.includes("remembered = effectiveSeat(seat, seat.lastMarketId)"));
check("PL-07: client no longer seeds bd.mkt from localStorage", !appJs.includes('localStorage.getItem("bd161:mkt")'));
check("PL-19: My Money vesting + rate slots use d.marketName", appJs.includes("Vesting — your ${esc(d.marketName") && appJs.includes("Once ${esc(d.marketName"));
check("PL-20: rolodex entries carry kinds", bizJs.includes('kind: l.dmName ? "person" : "business"') && bizJs.includes("secondContacts"));
check("PL-21: dayPlan excludes categoryHold and returns onHold", seg(bizJs, "async function dayPlan", "// ---------------- visit logging").includes("categoryHold") && seg(bizJs, "async function dayPlan", "// ---------------- visit logging").includes("onHold"));
check("PL-18: summary derives from LAUNCH_MARKET_ORDER188, Nashville first", routerJs.includes('const LAUNCH_MARKET_ORDER188 = ["Nashville", "Virginia Beach"'));
check("PL-13: headline prompt and breakdown prompt are separate wordings", sigJs.includes("Add your local audience %: the share of your followers") && sigJs.includes("What is missing is the breakdown"));
check("PL-14: chip reads the public-page switch", sigJs.includes('f.publicPage ? "Profile live" : "Profile finished: your public page is off"'));
check("PL-23: founding Find Offers uses launch framing", appJs.includes("Offers land here the day your market opens"));
check("PL-24: plan cards render after the scope question, before terms", (() => { const s = seg(appJs, "function renderForBusinesses()", "function applyBizPrefill"); const a = s.indexOf('"jb-scope"'); const b = s.indexOf('id="jb-plans"'); const c = s.indexOf('id="jb-terms"'); return a > 0 && b > a && c > b; })());
check("PL-01: Admin Markets client pins Nashville then Virginia Beach", appJs.includes('const pin188 = (m) => (m.name === "Nashville" ? 0 : m.name === "Virginia Beach" ? 1 : 2)'));
check("PL-24: scope note no longer points at plans above", !appJs.includes("ignore the plans above"));
check("PL-29a: editor button says Maggie", appJs.includes('T("Draft it with Maggie"') && !appJs.includes("Draft it with Sig"));
check("PL-42: no 'setup call' wording survives", !/setup call/i.test(appJs) && !/setup call/i.test(sigJs));
check("PL-48 (-247 re-pin): POINTS_WHY_LONG renders at zero sites (retired from the Momentum panel by Jeff's visual-first cut)", (appJs.match(/\$\{POINTS_WHY_LONG\}/g) || []).length === 0);
check("PL-59: stampLastSignIn is guarded", seg(routerJs, "async function stampLastSignIn", "async function handleRegister").includes("try {"));
check("PL-63: partner Help button says Open Sig", seg(appJs, "function partnerHelpHtml", "function partnerOffersHtml").includes("Open Sig"));
check("PL-78: HR intro repair pair present", bizJs.includes('"I run Magpie, and I\'m building its founding creator list"'));
check("PL-80: no user-facing '(Phase C)' label", !appJs.includes('Compliance (Phase C)') && appJs.includes("the paid-visit posting-terms rules"));

// ---------------- fixtures ----------------
console.log("== fixtures ==");
async function user(id, role, name, email, extra = {}) {
  const { salt, hash } = auth.hashPassword(PW);
  const rec = { id, role, name, email, passwordSalt: salt, passwordHash: hash, status: "approved", createdAt: "2026-11-10T00:00:00.000Z", ...extra };
  await store.set(`user:${id}`, rec);
  return rec;
}
const ADMIN = "v188-admin", TONY = "v188-tony", DESYNC = "v188-desync";
await user(ADMIN, "admin", "Jeff Rimmer", "jeff@joinsignl.com");
{ const h = auth.hashPassword(ADMIN_PW); const a = await store.get(`user:${ADMIN}`); a.passwordSalt = h.salt; a.passwordHash = h.hash; await store.set(`user:${ADMIN}`, a); }
await store.set("email:jeff@joinsignl.com", { userId: ADMIN });
const tonyRec = await user(TONY, "creator", "Tony Johnson", "tony188@fixtures.dev", { bizdevSeat: { active: true, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-TONY" } });
await store.set("email:tony188@fixtures.dev", { userId: TONY });
await user(DESYNC, "creator", "Desync Rep", "desync188@fixtures.dev", { bizdevSeat: { active: true, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-GONE" } });
await store.set("email:desync188@fixtures.dev", { userId: DESYNC });
const seatRec = (userId, repCode, extra = {}) => ({ userId, repCode, region: "Hampton Roads", marketId: "hampton-roads", marketName: "Hampton Roads", markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }], active: true, seatState: "probation", assignedAt: "2026-11-01T00:00:00.000Z", sharedBook: true, ...extra });
await store.set(`bdevrep:${TONY}`, seatRec(TONY, "HR-TONY", { lastMarketId: "nashville" }));
await store.set(`bdevrep:${ADMIN}`, seatRec(ADMIN, "HQ-JEFF", { hqSeat: true, seatState: "active" }));
// Loader gates pinned done for this fixture's world —
// including bdevTonyBook257 / bdevTonyBook258 (Builds
// -257/-258): those loaders post-date this world (they
// take Nashville off Tony's seat and load three market
// packs into his book), so they are pinned done here and
// proven in their own fixtures (verify-build257.mjs /
// verify-build258.mjs) instead.
for (const k of ["bdevSeed155", "bdevEnrich157", "bdevLoadDest20261109", "bdevJeffSeat161", "bdevSharedBooks20261112", "bdevTonyNashville20261112", "bdevCleanup169", "bdevCleanupTony170", "bdevTonyBook257", "bdevTonyBook258"]) await store.set(`config:${k}`, { done: true, at: "2026-11-09T00:00:00.000Z" });

function creatorRec(id, market, complete, extra = {}) {
  return {
    id, role: "creator", name: `Creator ${id}`, email: `${id}@fixtures.dev`, status: "approved",
    market, city: market === "Nashville" ? "Nashville" : "Virginia Beach",
    createdAt: "2026-11-10T00:00:00.000Z", reviewedAt: "2026-11-11T00:00:00.000Z",
    creator: {
      handle: `h_${id}`, categories: ["Food & Drink"], localAudiencePct: complete ? 55 : null,
      audienceStack: { instagram: 6000 }, followerCount: 6000, totalAudience: 6000,
      hasPhoto: false, bio: "", bestWork: [], publicPage: true, profileComplete: !!complete,
      ...(extra.creator || {}),
    },
    ...(extra.user || {}),
  };
}
// Nashville: 37 approved, 27 complete (the audit's fixture shape)
for (let i = 1; i <= 37; i++) await store.set(`user:v188-nash-${i}`, creatorRec(`v188-nash-${i}`, "Nashville", i <= 27));
for (let i = 1; i <= 3; i++) await store.set(`user:v188-hr-${i}`, creatorRec(`v188-hr-${i}`, "Virginia Beach", true));
// PL-13 shapes: headline set / breakdown missing, and neither set
await store.set("user:v188-geo-a", creatorRec("v188-geo-a", "Nashville", true, { creator: { localAudiencePct: 62, audienceStack: { instagram: 6000, tiktok: 2000 } } }));
{ const { salt, hash } = auth.hashPassword(PW); const a = await store.get("user:v188-geo-a"); a.passwordSalt = salt; a.passwordHash = hash; await store.set("user:v188-geo-a", a); await store.set("email:geo-a188@fixtures.dev", { userId: "v188-geo-a" }); const aa = await store.get("user:v188-geo-a"); aa.email = "geo-a188@fixtures.dev"; await store.set("user:v188-geo-a", aa); }
await store.set("user:v188-geo-b", creatorRec("v188-geo-b", "Nashville", false, { creator: { localAudiencePct: null } }));
{ const { salt, hash } = auth.hashPassword(PW); const b = await store.get("user:v188-geo-b"); b.passwordSalt = salt; b.passwordHash = hash; b.email = "geo-b188@fixtures.dev"; await store.set("user:v188-geo-b", b); await store.set("email:geo-b188@fixtures.dev", { userId: "v188-geo-b" }); }
// PL-15 dual pair (linked records, one email)
const DUAL_C = "v188-dual-c", DUAL_B = "v188-dual-b";
{ const { salt, hash } = auth.hashPassword(PW);
  await store.set(`user:${DUAL_C}`, { id: DUAL_C, role: "creator", name: "Dual Dana", email: "dual188@fixtures.dev", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", linkedAccountId: DUAL_B, createdAt: "2026-11-10T00:00:00.000Z", creator: { handle: "dualdana", categories: ["Food & Drink"], localAudiencePct: 48, audienceStack: { instagram: 5000 }, followerCount: 5000, totalAudience: 5000, hasPhoto: false, bio: "", bestWork: [], publicPage: true, profileComplete: true } });
  await store.set(`user:${DUAL_B}`, { id: DUAL_B, role: "business", name: "Dual Dana", email: "dual188@fixtures.dev", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", linkedAccountId: DUAL_C, createdAt: "2026-11-10T00:00:00.000Z", business: { businessName: "Dana's Dual Tacos", category: "Restaurant", planId: "self-service" } });
  await store.set("email:dual188@fixtures.dev", { userId: DUAL_C });
}
// business + offer + application for PL-12
const BIZ = "v188-biz";
{ const { salt, hash } = auth.hashPassword(PW);
  await store.set(`user:${BIZ}`, { id: BIZ, role: "business", name: "Biz Owner", email: "biz188@fixtures.dev", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: "2026-11-10T00:00:00.000Z", business: { businessName: "Fixture Tacos", category: "Restaurant", planId: "self-service" } });
  await store.set("email:biz188@fixtures.dev", { userId: BIZ });
}
await store.set("offer:v188-offer-1", { id: "v188-offer-1", businessId: BIZ, market: "Nashville", title: "Fixture visit", status: "open", kind: "comp", category: "Restaurant", createdAt: "2026-11-12T00:00:00.000Z" });
await store.set("application:v188-app-1", { id: "v188-app-1", offerId: "v188-offer-1", creatorId: "v188-nash-1", status: "pending", createdAt: "2026-11-12T01:00:00.000Z" });
// bizdev leads for Tony's HR book
function lead(id, s) {
  return {
    id, name: s.name, shortName: null, category: "Restaurants & Dining", subType: "", neighborhood: s.neighborhood || "Ocean View", city: s.city || "Norfolk",
    address: null, website: null, dmName: s.dmName || null, dmRole: null, dmRoleLabel: s.dmRoleLabel || null, secondContact: s.secondContact || null, usuallyHere: null,
    phone1: s.phone1 || null, phone1Verify: false, phone1Note: null, phone2: null, phone2Verify: false, phone2Note: null,
    email: s.email || null, emailNote: null, emailEvidence: null, instagram: null, instagramNote: null,
    marketId: s.marketId || "hampton-roads", marketName: s.marketName || "Hampton Roads", assignedRepId: s.repId, masterId: id, source: "seed188",
    stage: s.stage || "Not visited yet", stageHistory: [], statusHistory: [], hqTier: "B",
    flags: { doNotContact: false, jeffHandles: false, chain: false, ...(s.flags || {}) },
    founding: { status: "Not claimed", claimedAt: null, claimedVia: null, confirmedAt: null, planInterest: null },
    attribution: { repCode: s.repCode || "HR-TONY", firstTouchAt: null, source: "seed188" },
    nextAction: s.nextAction || { type: "Visit", date: null, what: "First visit" }, lastTouch: null,
    pendingApproval: false, hqDecision: null, isNewForRep: false,
    sharedBook: !!s.sharedBook,
    playbook: s.playbook || null, createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z",
  };
}
await store.set("bdevlead:v188-l-dm", lead("v188-l-dm", { name: "Maria's Tacos", repId: TONY, dmName: "Maria Santos", dmRoleLabel: "Owner", email: "maria@fixtures.dev", phone1: "(757) 555-0119", secondContact: { name: "Luis Santos", roleLabel: "Manager", email: "luis@fixtures.dev" } }));
await store.set("bdevlead:v188-l-bizonly", lead("v188-l-bizonly", { name: "Quiet Corner Cafe", repId: TONY, email: "hello@quietcorner.fixtures" }));
await store.set("bdevlead:v188-l-inbox", lead("v188-l-inbox", { name: "Busch Gardens", repId: TONY, dmName: "Pat Parks", email: "pat@fixtures.dev", secondContact: { name: "Press-release media contact inbox", roleLabel: "Media", email: "press@fixtures.dev" } }));
await store.set("bdevlead:v188-l-held", lead("v188-l-held", { name: "Held Sushi", repId: TONY, dmName: "Hana Held", flags: { categoryHold: true }, nextAction: { type: "Visit", date: "2026-11-01", what: "CATEGORY HOLD — do not approach yet" } }));
await store.set("bdevlead:v188-l-open", lead("v188-l-open", { name: "Open Table Diner", repId: TONY, dmName: "Ollie Open" }));
await store.set("bdevlead:v188-l-shared", lead("v188-l-shared", { name: "Terrapin Station", repId: ADMIN, sharedBook: true, repCode: "HQ-JEFF", dmName: "Terry Terrapin", playbook: { opener: "Hi, claim here: {{claimUrl}}" } }));

const admin = makeClient(); await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: ADMIN_PW });
const tony = makeClient(); await tony("POST", "/api/auth/login", { email: "tony188@fixtures.dev", password: PW });
const biz = makeClient(); await biz("POST", "/api/auth/login", { email: "biz188@fixtures.dev", password: PW });

// ---------------- PL-01 ----------------
console.log("== PL-01 launch canon ==");
{
  const mk = await admin("GET", "/api/admin/markets");
  const nash = (mk.data.markets || []).find((m) => m.name === "Nashville");
  // Fixture math: 37 seeded + geo-a + geo-b + the dual creator = 40
  // approved Nashville creators; 27 seeded complete + geo-a + dual = 29.
  check("Admin Markets: Nashville 40 approved / 29 complete (37+3 seeded shape)", !!nash && nash.creatorsApproved === 40 && nash.creatorsApprovedComplete === 29, JSON.stringify(nash || {}).slice(0, 200));
  const meC = makeClient();
  await meC("POST", "/api/auth/login", { email: "geo-a188@fixtures.dev", password: PW });
  const fd = await meC("GET", "/api/me/founding");
  const un = fd.data.buzz && fd.data.buzz.unlock;
  check("creator unlock payload: launchBar 50, approved counted in market", !!un && un.launchBar === 50 && un.approved === 40, JSON.stringify(un || {}));
  const home = await admin("GET", "/api/bdev/home?mkt=nashville");
  check("BD gate (Jeff, Nashville): creators counted vs gateLow 50", home.status === 200 && home.data.progress.gateLow === 50 && home.data.progress.launchTarget === 50, JSON.stringify(home.data && home.data.progress || {}).slice(0, 200));
}

// ---------------- PL-12 ----------------
console.log("== PL-12 rank strip ==");
{
  const r = await biz("GET", "/api/offers/v188-offer-1/applications");
  const a = r.data.applications && r.data.applications[0];
  check("business applications payload has NO foundingRank anywhere", r.status === 200 && !!a && !("foundingRank" in a) && !(a.creator && "foundingRank" in a.creator), JSON.stringify(a || {}).slice(0, 200));
  check("business applications payload carries the founding band (first 100)", !!a && !!a.creator && a.creator.foundingBand === 100, JSON.stringify(a || {}).slice(0, 300));
  const apps = await admin("GET", "/api/admin/applications");
  const all = [...(apps.data.pending || []), ...(apps.data.decided || [])];
  check("admin applications payload KEEPS the exact rank (foundingPriority)", all.some((x) => typeof x.foundingPriority === "number"), `n=${all.length}`);
}

// ---------------- PL-18 ----------------
console.log("== PL-18 summary markets ==");
{
  const apps = await admin("GET", "/api/admin/applications");
  const ms = apps.data.summary && apps.data.summary.markets;
  check("summary strip leads with Nashville", !!ms && ms[0].market === "Nashville", JSON.stringify((ms || []).map((m) => m.market)));
  const mk = await admin("GET", "/api/admin/markets");
  const nashRow = (mk.data.markets || []).find((m) => m.name === "Nashville");
  const nashSum = ms && ms.find((m) => m.market === "Nashville");
  check("summary Nashville counts match Admin Markets exactly", !!nashSum && !!nashRow && nashSum.approved === nashRow.creatorsApproved && nashSum.approvedComplete === nashRow.creatorsApprovedComplete, `sum=${JSON.stringify(nashSum)} row=${JSON.stringify(nashRow)}`);
}

// ---------------- PL-13 / PL-14 ----------------
console.log("== PL-13 + PL-14 ==");
{
  const cA = makeClient(); await cA("POST", "/api/auth/login", { email: "geo-a188@fixtures.dev", password: PW });
  const hA = await cA("GET", "/api/sig/home");
  const chipsA = (hA.data.chips || []).join(" | ");
  check("headline set + breakdown missing: asks for the BREAKDOWN", /breakdown/.test(chipsA), chipsA);
  check("headline set: never told to add the headline or 'your Instagram local %'", !chipsA.includes("Add your local audience %") && !chipsA.includes("your Instagram local %"), chipsA);
  const cB = makeClient(); await cB("POST", "/api/auth/login", { email: "geo-b188@fixtures.dev", password: PW });
  const hB = await cB("GET", "/api/sig/home");
  const chipsB = (hB.data.chips || []).join(" | ");
  check("no headline: asked for the headline local %", chipsB.includes("Add your local audience %"), chipsB);
  check("geo-a (public page on, complete) reads Profile live", chipsA.includes("Profile live"), chipsA);
  const anon = makeClient();
  const reg = await anon("POST", "/api/auth/register", { role: "creator", name: "Full Form 188", email: "full188@fixtures.dev", password: "fixture-pass-188", market: "Nashville", city: "Nashville", handle: "full188fixture", primaryPlatform: "instagram", followerCount: 6000, audienceStack: { instagram: 6000 }, localAudiencePct: 60, categories: ["Food & Drink"], agreedTerms: true });
  const users = await store.list("user:");
  const fullRec = users.map((r) => r.value).find((u) => u.email === "full188@fixtures.dev");
  check("full-form signup switches the public page ON (same rule as quick claim)", reg.status < 300 && !!fullRec && fullRec.creator.publicPage === true, JSON.stringify(fullRec && fullRec.creator && { publicPage: fullRec.creator.publicPage }));
}

// ---------------- PL-15 ----------------
console.log("== PL-15 side switch ==");
{
  const dual = makeClient();
  const li = await dual("POST", "/api/auth/login", { email: "dual188@fixtures.dev", password: PW });
  check("dual login lands on the creator side", li.status === 200 && li.data.user.role === "creator", JSON.stringify(li.data.user || {}).slice(0, 120));
  const hC = await dual("GET", "/api/sig/home");
  check("creator side home state is creator-scoped", hC.data.role === "creator", JSON.stringify(hC.data).slice(0, 160));
  const sw = await dual("POST", "/api/auth/switch-side", {});
  check("switch-side moves to the business record", sw.status === 200 && sw.data.user.role === "business", `status=${sw.status}`);
  const hB = await dual("GET", "/api/sig/home");
  const chipsB = (hB.data.chips || []).join(" | ");
  check("business side home state is business-scoped, no creator chips", hB.data.role === "business" && !chipsB.includes("local audience %") && !chipsB.includes("Profile live"), chipsB);
  const sw2 = await dual("POST", "/api/auth/switch-side", {});
  const hC2 = await dual("GET", "/api/sig/home");
  check("switching back restores creator-scoped home state", sw2.status === 200 && hC2.data.role === "creator", JSON.stringify(hC2.data).slice(0, 120));
}

// ---------------- PL-05 server truth ----------------
console.log("== PL-05 desync ==");
{
  const d = makeClient(); await d("POST", "/api/auth/login", { email: "desync188@fixtures.dev", password: PW });
  const r = await d("GET", "/api/bdev/home");
  check("desync account: /bdev/home answers the no-seat error the client keys on", r.status === 403 && /No biz dev seat/.test(r.data.error || ""), `status=${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
}

// ---------------- PL-06 / PL-07 / PL-20 / PL-21 ----------------
console.log("== bizdev family ==");
{
  const home = await tony("GET", "/api/bdev/home");
  check("PL-07: bare home request lands on the HOME market despite lastMarketId=nashville", home.status === 200 && home.data.rep.marketName === "Hampton Roads", JSON.stringify(home.data.rep || {}));
  const kitN = await tony("GET", "/api/bdev/kit?mkt=nashville");
  const kitNStr = JSON.stringify(kitN.data.kit || {});
  check("PL-06: Tony's Nashville kit says Nashville, never Hampton Roads", kitN.status === 200 && kitNStr.includes("Nashville") && !kitNStr.includes("Hampton Roads"), kitNStr.slice(0, 160));
  check("PL-06: Tony's Nashville kit keeps his voice and no print kit", /I'm Tony/.test(kitN.data.kit.openers[0].text) && kitN.data.kit.printKit.length === 0, "");
  const kitH = await tony("GET", "/api/bdev/kit");
  check("PL-06: Tony's home kit is the Hampton Roads original with print kit", kitH.status === 200 && kitH.data.kit.printKit.length === 2 && /Hampton Roads/.test(kitH.data.kit.openers[0].text), "");
  const kitJ = await admin("GET", "/api/bdev/kit?mkt=nashville");
  check("PL-06 control: Jeff's Nashville kit still speaks as Jeff", /I'm Jeff/.test(kitJ.data.kit.openers[0].text), "");
  const shared = await tony("GET", "/api/bdev/leads/v188-l-shared");
  const sharedStr = JSON.stringify(shared.data.lead || {});
  check("PL-07: shared HR lead opens for Tony with HIS claim code (his seat's code, not Jeff's)", shared.status === 200 && sharedStr.includes("rep=HR-TONY") && !sharedStr.includes("rep=HQ-JEFF"), `status=${shared.status} ${sharedStr.slice(0, 200)}`);
  const contacts = await tony("GET", "/api/bdev/contacts");
  const s = contacts.data.summary || {};
  check("PL-20: summary reconciles (6 businesses · 5 people + 1 second · 2 business contacts)", s.businesses === 6 && s.people === 5 && s.secondContacts === 1 && s.businessContacts === 2 && s.total === 8, JSON.stringify(s));
  const inbox = (contacts.data.contacts || []).find((c) => c.leadId === "v188-l-inbox" && c.id.startsWith("lead2:"));
  check("PL-20: the inbox 'second contact' is remodeled as a business contact", !!inbox && inbox.kind === "business" && inbox.name === "", JSON.stringify(inbox || {}));
  const stops = (home.data.plan.stops || []).map((x) => x.id);
  const hold = (home.data.plan.onHold || []).map((x) => x.id);
  check("PL-21: held lead is NOT a route stop", !stops.includes("v188-l-held"), stops.join(","));
  check("PL-21: held lead listed in onHold; route count = workable stops", hold.includes("v188-l-held") && home.data.plan.totalCount === stops.length, `total=${home.data.plan.totalCount} stops=${stops.length}`);
  check("PL-21: held lead is not a due follow-up either", !(home.data.followUps || []).some((x) => x.id === "v188-l-held"), "");
}

// ---------------- PL-78 ----------------
console.log("== PL-78 voice repair ==");
{
  const pb = { introEmail: "I'm Tony Johnson — I live here in Hampton Roads, and I'm helping Magpie build its founding creator list for our area." };
  const forJeff = bizdev._test.revoicePlaybookForViewer(JSON.parse(JSON.stringify(pb)), "HQ-JEFF", "Hampton Roads");
  check("Jeff's view of the HR intro reads as a whole sentence", forJeff.introEmail.includes("I run Magpie, and I'm building its founding creator list"), forJeff.introEmail);
  const forTony = bizdev._test.revoicePlaybookForViewer(JSON.parse(JSON.stringify(pb)), "HR-TONY", "Hampton Roads");
  check("Tony's view keeps his own words", forTony.introEmail.includes("I'm helping Magpie build its founding creator list"), forTony.introEmail);
}

// ---------------- PL-59 ----------------
console.log("== PL-59 login stamp failure ==");
{
  const u = makeClient();
  await u("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "stamp188@fixtures.dev", password: "fixture-pass-188", handle: "stamp188fixture", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true });
  const origSet = store.set;
  store.set = async (k, v) => { if (String(k).startsWith("user:")) throw new Error("forced stamp failure (verify188)"); return origSet(k, v); };
  let login;
  try { login = await u("POST", "/api/auth/login", { email: "stamp188@fixtures.dev", password: "fixture-pass-188" }); }
  finally { store.set = origSet; }
  check("login succeeds even when the sign-in stamp write fails", login.status === 200 && !!login.data.user, `status=${login.status} ${JSON.stringify(login.data).slice(0, 160)}`);
}

console.log(`\nBUILD188 VERIFY: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
