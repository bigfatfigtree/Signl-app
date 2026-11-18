#!/usr/bin/env node
// Build -212 fixture suite: Admin Home's numbers are
// PRECOMPUTED. Home used to fire six aggregate endpoints
// (applications, markets, partners, platform totals, approval
// queue, Biz Dev overview) that each computed on the request
// path behind a 30-second in-process memo — effectively always
// cold on Netlify's ephemeral instances, so a cold Home load
// was six cold computes on six cold instances (live walk after
// Build -210: ~13s to settle; calibrated probe:
// ~/workspace/xmedium-qa/home212/probe212.mjs). The compute
// now runs only in the admin-home-refresh background function
// (5-minute schedule, trigger endpoint, throttled nudge) and
// stores one record at config:adminHomeSummary;
// GET /admin/home-summary serves the admin's slice of it and
// never computes, answering { preparing: true } before the
// first refresh lands.
//
// This suite asserts the ARCHITECTURE (static: no compute on
// the read path; the client no longer fires the six endpoints
// from Home) and the BEHAVIOR (live fixture: preparing ->
// refresh -> summary, and the summary's numbers EQUAL the
// live endpoints' numbers — one counting source, no drift).
// Production-scale timing lives in the -212 perf probe.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const routerJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");
const bizdevJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/bizdev.js"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

console.log("== stamp ==");
check("BUILD_ID is 2026.11.18-212", buildJs.includes('exports.BUILD_ID = "2026.11.18-212"'));
check("shell stamp matches", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-212"') && (indexHtml.match(/2026\.11\.18-212/g) || []).length >= 5);

console.log("== architecture (static): the compute is off the read path ==");
const getStart = routerJs.indexOf('seg[1] === "home-summary"');
const getSlice = getStart >= 0 ? routerJs.slice(getStart, getStart + 2400) : "";
check("GET /admin/home-summary handler found", getSlice.length > 500, `len=${getSlice.length}`);
check("GET serves the stored summary (loadAdminHomeSummary)", getSlice.includes("loadAdminHomeSummary()") && getSlice.includes("rec.byUser"));
check("GET answers the honest preparing state when nothing is stored", getSlice.includes("preparing: true"));
check("GET returns the asOf stamp", getSlice.includes("asOf: rec.computedAt"));
check("GET never computes: no endpoint builds on the read path",
  !getSlice.includes("adminMarketRows(") && !getSlice.includes("platformTotals126(") && !getSlice.includes("approvalQueue138(") && !getSlice.includes("allUsers(") && !getSlice.includes("refreshAdminHomeSummary212("));
check("refresh compute exists and stores config:adminHomeSummary",
  routerJs.includes("async function refreshAdminHomeSummary212(") && routerJs.includes('store.set(ADMIN_HOME_SUMMARY_KEY') && routerJs.includes('"config:adminHomeSummary"'));
check("compute reuses the canonical helpers (one counting source)",
  routerJs.includes("platformTotals126(scoped)") && routerJs.includes("await adminMarketRows()") && routerJs.includes("await approvalQueue138(admin)") && routerJs.includes("bizdev.waitingCounts212()"));
const epStart = routerJs.indexOf('seg[1] === "home-refresh"');
const epSlice = epStart >= 0 ? routerJs.slice(epStart, epStart + 1500) : "";
check("refresh endpoint exists with sweep-token-or-admin auth",
  epSlice.includes("x-signl-sweep-token") && epSlice.includes('user.role !== "admin"'));
check("refresh endpoint TRIGGERS the background function and never computes inline",
  epSlice.includes("fireAdminHomeRefresh212") && !epSlice.includes("refreshAdminHomeSummary212("));
const nudgeStart = routerJs.indexOf("function maybeRefreshAdminHome212(");
const nudgeSlice = nudgeStart >= 0 ? routerJs.slice(nudgeStart, nudgeStart + 700) : "";
check("nudge fires the background function, never computes in-process",
  nudgeSlice.includes("await fireAdminHomeRefresh212(false)") && !nudgeSlice.includes("refreshAdminHomeSummary212"));
check("the compute is called ONLY by the background runner",
  (routerJs.match(/await refreshAdminHomeSummary212\(\)/g) || []).length === 1 && routerJs.includes("const out = await refreshAdminHomeSummary212();"));
const bgPath = path.join(ROOT, "netlify/functions/admin-home-refresh-background.js");
const bg = fs.existsSync(bgPath) ? fs.readFileSync(bgPath, "utf8") : "";
check("background refresh function exists (the -background budget), token-guarded, runs the exported runner",
  bg.includes("runAdminHomeRefresh212") && bg.includes("SIGNL_SWEEP_TOKEN") && bg.includes("exports.handler"));
check("router exports the background runner", routerJs.includes("runAdminHomeRefresh212"));
const schedPath = path.join(ROOT, "netlify/functions/admin-home-refresh.mjs");
const sched = fs.existsSync(schedPath) ? fs.readFileSync(schedPath, "utf8") : "";
check("scheduled refresh function exists (*/5) and fires the background function",
  sched.includes('schedule: "*/5 * * * *"') && sched.includes("/.netlify/functions/admin-home-refresh-background") && sched.includes("x-signl-sweep-token"));
check("bizdev waitingCounts212 exists and reads only the three small prefixes",
  bizdevJs.includes("async function waitingCounts212()") && bizdevJs.includes('listPrefix170("bdevclaim:")') && bizdevJs.includes('listPrefix170("bdevesc:")'));

console.log("== client (static): Home reads the summary, prints as-of ==");
const homeStart = appJs.indexOf("async function loadAdminHome137()");
const homeEnd = appJs.indexOf("function renderAdmin()", homeStart);
const homeSlice = homeStart >= 0 && homeEnd > homeStart ? appJs.slice(homeStart, homeEnd) : "";
check("loadAdminHome137 found", homeSlice.length > 1000, `len=${homeSlice.length}`);
check("Home loads the summary", homeSlice.includes("loadAdminHomeSummary212()"));
check("Home no longer fires the six heavy endpoints",
  !homeSlice.includes('"/admin/applications"') && !homeSlice.includes('"/admin/markets"') && !homeSlice.includes('"/admin/partners"') && !homeSlice.includes('"/admin/platform-totals"') && !homeSlice.includes('"/admin/approval-queue"') && !homeSlice.includes('"/admin/bdev/overview"'));
check("Home renders the honest preparing state", homeSlice.includes("summary.preparing") && homeSlice.includes("Preparing your numbers"));
check("Home prints the as-of stamp under the highlights", homeSlice.includes("asOfLine212(summary.asOf)"));
const sigStart = appJs.indexOf("async function loadAdminSig(");
const sigSlice = sigStart >= 0 ? appJs.slice(sigStart, sigStart + 1600) : "";
check("the dashboard attention list reads the summary too", sigSlice.includes("loadAdminHomeSummary212()") && !sigSlice.includes('"/admin/applications"'));
check("admin mutations ping the refresh (freshness after Jeff's taps)", appJs.includes("pingAdminHomeRefresh212()") && appJs.includes('"/admin/home-refresh"'));
check("withheld slices adapt to null, never an empty list (review defect D1b: an empty partners list reads as the false fact 'No partners yet')",
  appJs.includes("partnersData: s && s.partnerRows ? { partners: s.partnerRows } : null") && appJs.includes("marketsData: s && s.markets ? { markets: s.markets } : null"));

// ---------- live fixture server ----------
const DB = fs.mkdtempSync("/tmp/signl-build212-") + "/db.json";
const PW = "verify-build212-pass";
const SALT = "verifybuild212salt";
const HASH = crypto.scryptSync(PW, SALT, 64).toString("hex");
const nowMs = Date.now();
const iso = (ms) => new Date(ms).toISOString();
{
  const seed = {};
  const admin = { id: "admin212", role: "admin", email: "admin@fixtures.dev", name: "Fixture Admin", passwordHash: HASH, passwordSalt: SALT, status: "approved", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: iso(nowMs) };
  seed[`user:${admin.id}`] = admin; seed[`email:${admin.email}`] = { userId: admin.id };
  for (let i = 0; i < 2; i++) {
    const u = { id: `pend212-${i}`, role: "creator", email: `pend${i}@fixtures.dev`, name: `Pending ${i}`, passwordHash: HASH, passwordSalt: SALT, status: "pending", market: "Nashville", city: "Nashville", createdAt: iso(nowMs - 3 * 86400000), updatedAt: iso(nowMs), tester: false, creator: { handle: `pend${i}`, categories: ["Music"], audienceStack: { instagram: 900 }, totalAudience: 900, localAudiencePct: 30, profileComplete: true } };
    seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id };
  }
  const approved = { id: "appr212", role: "creator", email: "appr@fixtures.dev", name: "Approved Fixture", passwordHash: HASH, passwordSalt: SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(nowMs - 40 * 86400000), updatedAt: iso(nowMs), tester: false, creator: { handle: "apprfx", categories: ["Music"], audienceStack: { instagram: 5000 }, totalAudience: 5000, localAudiencePct: 40, profileComplete: true } };
  seed[`user:${approved.id}`] = approved; seed[`email:${approved.email}`] = { userId: approved.id };
  const vbCreator = { id: "vb212", role: "creator", email: "vb@fixtures.dev", name: "VB Creator", passwordHash: HASH, passwordSalt: SALT, status: "approved", market: "Virginia Beach", city: "Virginia Beach", createdAt: iso(nowMs - 20 * 86400000), updatedAt: iso(nowMs), tester: false, creator: { handle: "vbfx", categories: ["Food"], audienceStack: { instagram: 7000 }, totalAudience: 7000, localAudiencePct: 50, profileComplete: true } };
  seed[`user:${vbCreator.id}`] = vbCreator; seed[`email:${vbCreator.email}`] = { userId: vbCreator.id };
  const scopedAdmin = { id: "admin212s", role: "admin", email: "scoped@fixtures.dev", name: "Scoped Admin", passwordHash: HASH, passwordSalt: SALT, status: "approved", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: iso(nowMs), adminPerms: { super: false, flags: { approvals: true }, markets: ["Nashville"], statScopes: [] } };
  seed[`user:${scopedAdmin.id}`] = scopedAdmin; seed[`email:${scopedAdmin.email}`] = { userId: scopedAdmin.id };
  const pendBiz = { id: "pbiz212", role: "business", email: "pbiz@fixtures.dev", name: "Pending Biz", passwordHash: HASH, passwordSalt: SALT, status: "pending", market: "Nashville", city: "Nashville", createdAt: iso(nowMs - 2 * 86400000), updatedAt: iso(nowMs), tester: false, business: { businessName: "Pending Biz LLC", category: "Food & Drink" } };
  seed[`user:${pendBiz.id}`] = pendBiz; seed[`email:${pendBiz.email}`] = { userId: pendBiz.id };
  const apprBiz = { id: "abiz212", role: "business", email: "abiz@fixtures.dev", name: "Approved Biz", passwordHash: HASH, passwordSalt: SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(nowMs - 30 * 86400000), updatedAt: iso(nowMs), tester: false, business: { businessName: "Approved Biz LLC", category: "Food & Drink" } };
  seed[`user:${apprBiz.id}`] = apprBiz; seed[`email:${apprBiz.email}`] = { userId: apprBiz.id };
  const partner = { id: "part212", role: "partner", email: "partner@fixtures.dev", name: "Demo Media", passwordHash: HASH, passwordSalt: SALT, status: "approved", createdAt: iso(nowMs - 30 * 86400000), updatedAt: iso(nowMs), partner: { name: "Demo Media", code: "DEMO212", demo: true, status: "active", markets: ["Nashville"] } };
  seed[`user:${partner.id}`] = partner; seed[`email:${partner.email}`] = { userId: partner.id };
  seed["bdevlead:lead212"] = { id: "lead212", name: "Lead Biz", city: "Nashville", marketId: "nashville", marketName: "Nashville", stage: "Claimed", status: "Claimed", pendingApproval: true, founding: { status: "Confirmed" }, createdAt: iso(nowMs - 5 * 86400000), updatedAt: iso(nowMs - 86400000) };
  seed["bdevclaim:cl1"] = { id: "cl1", leadId: "lead212", status: "waiting HQ confirm", businessName: "Lead Biz", createdAt: iso(nowMs - 86400000) };
  seed["bdevclaim:cl2"] = { id: "cl2", leadId: null, status: "waiting HQ confirm", businessName: "Unmatched Biz", createdAt: iso(nowMs - 86400000) };
  seed["bdevesc:es1"] = { id: "es1", status: "open", createdAt: iso(nowMs - 86400000) };
  seed["mkcampaign:mk1"] = { id: "mk1", status: "in_review", authorId: "someoneelse", segment: { market: "Nashville" }, createdAt: iso(nowMs - 86400000) };
  seed["socialdraft:sd1"] = { id: "sd1", status: "draft", authorId: "someoneelse", createdAt: iso(nowMs - 86400000) };
  seed["teaminvite:ti1"] = { id: "ti1", usedAt: null, expiresAt: iso(nowMs + 86400000), createdAt: iso(nowMs - 86400000) };
  seed["config:markets"] = { flags: {} };
  const today = iso(nowMs).slice(0, 10);
  seed[`snapshot:${today}`] = { date: today, capturedAt: iso(nowMs), totals: {} };
  seed["config:snapshotSweep"] = { lastDate: today, lastRunAt: iso(nowMs) };
  fs.writeFileSync(DB, JSON.stringify(seed));
}

const PORT = 9312;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_MAIL_STUB: "1", APP_URL: BASE, SIGNL_SWEEP_TOKEN: "suite-sweep-token-212" };
for (const k of ["SIG_AI_API_KEY", "SIG_AI_BASE_URL", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MAGGIE_AI_ENABLED", "NETLIFY_BLOBS_SITE_ID", "NETLIFY_BLOBS_TOKEN"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: ROOT, env, stdio: "ignore" });
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  const jar = new Map();
  return async (method, p, body, headers = {}) => {
    const h = { ...headers };
    if (body) h["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) { const pair = c.split(";")[0]; const i = pair.indexOf("="); if (i > -1) jar.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, json };
  };
}

try {
  for (let i = 0; i < 120; i++) { try { const r = await fetch(BASE + "/api/boot"); if (r.status < 500) break; } catch (e) {} await sleepMs(250); }
  console.log("== behavior (live fixture) ==");
  const anon = client();
  const noAuth = await anon("GET", "/api/admin/home-summary");
  check("GET without a session is refused", noAuth.status === 401 || noAuth.status === 403, `${noAuth.status}`);
  const api = client();
  const la = await api("POST", "/api/auth/login", { email: "admin@fixtures.dev", password: PW });
  check("admin sign-in", la.status === 200, `${la.status}`);

  const g1 = await api("GET", "/api/admin/home-summary");
  check("no-summary GET answers 200 flagged preparing (never zeroed numbers)", g1.status === 200 && g1.json && g1.json.preparing === true && !("totals" in g1.json), `${g1.status} ${JSON.stringify(g1.json).slice(0, 120)}`);

  const noTok = await anon("POST", "/api/admin/home-refresh", {});
  check("refresh without session or token is 403", noTok.status === 403, `${noTok.status}`);
  const badTok = await anon("POST", "/api/admin/home-refresh", {}, { "x-signl-sweep-token": "wrong" });
  check("refresh with a wrong token is 403", badTok.status === 403, `${badTok.status}`);
  const bgNoTok = await anon("POST", "/.netlify/functions/admin-home-refresh-background", {});
  check("background function refuses a tokenless call", bgNoTok.status === 403, `${bgNoTok.status}`);

  const rf = await api("POST", "/api/admin/home-refresh", {});
  check("admin refresh trigger accepted (started, not computed inline)", rf.status === 200 && rf.json && rf.json.ok === true && rf.json.started === true, `${rf.status} ${JSON.stringify(rf.json).slice(0, 160)}`);
  // The preparing GET above also nudged a refresh; poll briefly
  // for whichever run lands the record (the runner dedupes).
  let dbAfter = JSON.parse(fs.readFileSync(DB, "utf8"));
  for (let i = 0; i < 40 && !(dbAfter["config:adminHomeSummary"] && dbAfter["config:adminHomeSummary"].byUser); i++) { await sleepMs(250); dbAfter = JSON.parse(fs.readFileSync(DB, "utf8")); }
  const rec = dbAfter["config:adminHomeSummary"];
  check("refresh stored the summary at config:adminHomeSummary", !!(rec && rec.byUser && rec.byUser.admin212 && rec.computedAt));
  check("the compute ran in the background function (runner stamp written)", !!(dbAfter["config:adminHomeSummaryRefresh"] && dbAfter["config:adminHomeSummaryRefresh"].ok === true));

  const g2 = await api("GET", "/api/admin/home-summary");
  check("stored-summary GET is not flagged preparing and carries asOf", g2.status === 200 && g2.json && g2.json.preparing === false && g2.json.asOf === rec.computedAt, `${g2.status}`);
  check("totals: 4 creators signed up (2 pending + 1 approved Nashville + 1 approved Virginia Beach), 13,800 followers", g2.json.totals && g2.json.totals.creatorsSignedUp === 4 && g2.json.totals.totalFollowers === 13800, JSON.stringify(g2.json.totals || {}).slice(0, 160));
  check("pending rows: 3 waiting (2 creators + 1 business)", Array.isArray(g2.json.pending) && g2.json.pending.length === 3, `${g2.json.pending && g2.json.pending.length}`);
  check("queue counts: 3 applications, 1 marketing draft, 1 social draft, 1 team invite",
    g2.json.queue && g2.json.queue.applications === 3 && g2.json.queue.marketingDrafts === 1 && g2.json.queue.socialDrafts === 1 && g2.json.queue.teamInvites === 1, JSON.stringify(g2.json.queue || {}));
  check("bizdev waiting: 1 claim to confirm, 1 lead to approve, 1 unmatched, 1 escalation, total 4",
    g2.json.bizdevWaiting && g2.json.bizdevWaiting.claims === 1 && g2.json.bizdevWaiting.leads === 1 && g2.json.bizdevWaiting.unmatched === 1 && g2.json.bizdevWaiting.escalations === 1 && g2.json.bizdevWaiting.total === 4, JSON.stringify(g2.json.bizdevWaiting || {}));
  check("partner rows carry the demo flag + status", Array.isArray(g2.json.partnerRows) && g2.json.partnerRows.length === 1 && g2.json.partnerRows[0].demo === true && g2.json.partnerRows[0].status === "active", JSON.stringify(g2.json.partnerRows || {}));

  console.log("== cross-checks: the summary EQUALS the live endpoints ==");
  const liveTotals = await api("GET", "/api/admin/platform-totals");
  check("totals equal GET /admin/platform-totals", liveTotals.json && liveTotals.json.creatorsSignedUp === g2.json.totals.creatorsSignedUp && liveTotals.json.totalFollowers === g2.json.totals.totalFollowers && liveTotals.json.localFollowers === g2.json.totals.localFollowers);
  const liveQueue = await api("GET", "/api/admin/approval-queue");
  check("queue equals GET /admin/approval-queue", liveQueue.json && liveQueue.json.applications === g2.json.queue.applications && liveQueue.json.marketingDrafts === g2.json.queue.marketingDrafts && liveQueue.json.socialDrafts === g2.json.queue.socialDrafts && liveQueue.json.teamInvites === g2.json.queue.teamInvites, JSON.stringify(liveQueue.json || {}));
  const liveMarkets = await api("GET", "/api/admin/markets");
  const liveNash = liveMarkets.json && (liveMarkets.json.markets || []).find((m) => m.name === "Nashville");
  const sumNash = (g2.json.markets || []).find((m) => m.name === "Nashville");
  check("Nashville market fields equal GET /admin/markets", !!(liveNash && sumNash) && liveNash.businessesFounding === sumNash.businessesFounding && liveNash.combinedFollowers === sumNash.combinedFollowers && liveNash.creatorsListed === sumNash.creatorsListed,
    `live=${JSON.stringify(liveNash && { f: liveNash.businessesFounding, cf: liveNash.combinedFollowers, cl: liveNash.creatorsListed })} sum=${JSON.stringify(sumNash && { f: sumNash.businessesFounding, cf: sumNash.combinedFollowers, cl: sumNash.creatorsListed })}`);
  const liveOv = await api("GET", "/api/admin/bdev/overview");
  const ovCounts = liveOv.json ? {
    claims: (liveOv.json.unconfirmedClaims || []).filter((c) => c.leadId).length,
    leads: (liveOv.json.pendingLeads || []).length,
    unmatched: (liveOv.json.disputes || []).length,
    escalations: (liveOv.json.escalations || []).length,
  } : null;
  check("bizdev waiting equals abdWaitingCounts(GET /admin/bdev/overview)", !!ovCounts && ovCounts.claims === g2.json.bizdevWaiting.claims && ovCounts.leads === g2.json.bizdevWaiting.leads && ovCounts.unmatched === g2.json.bizdevWaiting.unmatched && ovCounts.escalations === g2.json.bizdevWaiting.escalations,
    `live=${JSON.stringify(ovCounts)} sum=${JSON.stringify(g2.json.bizdevWaiting)}`);

  console.log("== scoped teammate (review defect D1: the gate must not deny Home) ==");
  check("the permission gate passes home-summary through (handler scopes the payload)", routerJs.includes('case "home-summary": return null'));
  const tm = client();
  const lt = await tm("POST", "/api/auth/login", { email: "scoped@fixtures.dev", password: PW });
  check("scoped teammate sign-in", lt.status === 200, `${lt.status}`);
  const gs = await tm("GET", "/api/admin/home-summary");
  check("scoped teammate GET is 200, not gate-denied (D1)", gs.status === 200 && gs.json && gs.json.preparing === false, `${gs.status} ${JSON.stringify(gs.json || {}).slice(0, 120)}`);
  check("teammate totals are Nashville-scoped: 3 creators, 6,800 followers (the Virginia Beach creator is NOT in them)",
    gs.json && gs.json.totals && gs.json.totals.creatorsSignedUp === 3 && gs.json.totals.totalFollowers === 6800, JSON.stringify((gs.json || {}).totals || {}));
  check("teammate pending rows are Nashville-only (3)", gs.json && Array.isArray(gs.json.pending) && gs.json.pending.length === 3 && gs.json.pending.every((r) => r.market === "Nashville"), JSON.stringify((gs.json || {}).pending || []));
  check("teammate payload withholds the markets slice (no markets.view flag)", gs.json && !("markets" in gs.json));
  check("teammate payload withholds the partner slice (no partners.view flag)", gs.json && !("partnerRows" in gs.json));
  check("teammate still gets the Biz Dev waiting counts (that endpoint answers any admin)", gs.json && gs.json.bizdevWaiting && gs.json.bizdevWaiting.total === 4, JSON.stringify((gs.json || {}).bizdevWaiting || {}));
  const tmTotals = await tm("GET", "/api/admin/platform-totals");
  check("teammate summary totals equal the teammate's own platform-totals", tmTotals.json && gs.json && tmTotals.json.creatorsSignedUp === gs.json.totals.creatorsSignedUp && tmTotals.json.totalFollowers === gs.json.totals.totalFollowers);

  const tok = await anon("POST", "/api/admin/home-refresh", {}, { "x-signl-sweep-token": "suite-sweep-token-212" });
  check("refresh with the sweep token (no session) completes", tok.status === 200 && tok.json && tok.json.ok === true, `${tok.status}`);
} catch (e) {
  check(`suite error: ${e && e.message}`, false);
} finally {
  server.kill("SIGKILL");
  console.log(`\nverify-build212: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
