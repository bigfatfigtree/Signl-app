#!/usr/bin/env node
// Build -213 fixture suite: the Admin Home COLD load.
//
// -212 precomputed the summary off the read path, but its
// cold answer was a bare { preparing: true } — and Brenda's
// signed-in acceptance walk (2026-11-18) sat on "Preparing
// your numbers…" for ~40-70s, because the background compute
// takes about a minute at real production scale (deploy
// published 14:22:27 ET, walk reload 14:23:01 ET, first
// summary computedAt 14:23). -213 mirrors the -211 pattern:
// the cold GET serves an immediate fallback built from the
// records on file — the SAME helpers and scoping the stored
// summary uses, over one bounded users pass plus the queue's
// small prefix lists, never the event-log builds — flagged
// preparing + fallback, with the shared slices ABSENT (never
// zeroed). The client paints those numbers at once, fires
// the refresh endpoint itself, and re-checks every 5s until
// the stored summary lands and takes over.
//
// This suite asserts the new contract: the fallback's
// numbers EQUAL the live endpoints' numbers (one counting
// source), the fallback is scoped per admin, the shared
// slices never leak or fake, and the stored summary still
// takes over once the background compute lands.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const routerJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

console.log("== stamp ==");
check("BUILD_ID is 2026.11.18-213", buildJs.includes('exports.BUILD_ID = "2026.11.18-213"'));
check("shell stamp matches", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-213"') && (indexHtml.match(/2026\.11\.18-213/g) || []).length >= 5);

console.log("== server (static): the fallback is bounded and same-source ==");
const fbStart = routerJs.indexOf("async function adminHomeFallback213(");
const fbSlice = fbStart >= 0 ? routerJs.slice(fbStart, fbStart + 1600) : "";
check("adminHomeFallback213 exists", fbSlice.length > 400, `len=${fbSlice.length}`);
check("fallback reuses the canonical helpers (one counting source)",
  fbSlice.includes("platformTotals126(scoped)") && fbSlice.includes("await approvalQueue138(adminUser)") && fbSlice.includes("await bizdev.waitingCounts212()"));
check("fallback scopes exactly like the stored summary (super vs in-market-scope)",
  fbSlice.includes("perms138.isSuper(adminUser)") && fbSlice.includes("perms138.inMarketScope(adminUser, u.market)"));
check("fallback never runs the heavy builds (no market rows, no refresh compute, no event-log reads)",
  !fbSlice.includes("adminMarketRows(") && !fbSlice.includes("refreshAdminHomeSummary212(") && !fbSlice.includes("eventsInRange(") && !fbSlice.includes('store.list("event'));
check("fallback is flagged preparing + fallback with a read-time asOf",
  fbSlice.includes("preparing: true") && fbSlice.includes("fallback: true") && fbSlice.includes("asOf: nowIso()"));
const getStart = routerJs.indexOf('seg[1] === "home-summary"');
const getSlice = getStart >= 0 ? routerJs.slice(getStart, getStart + 2400) : "";
check("GET serves the fallback when no slice is stored", getSlice.includes("adminHomeFallback213(user)"));
check("GET keeps the bare preparing answer as the fallback's own failure path", getSlice.includes("preparing: true"));
check("GET still serves the stored summary first when a slice exists", getSlice.includes("rec.byUser") && getSlice.includes("preparing: false"));

console.log("== client (static): fallback paints at once, flagged, and upgrades itself ==");
const homeStart = appJs.indexOf("async function loadAdminHome137()");
const homeEnd = appJs.indexOf("function renderAdmin()", homeStart);
const homeSlice = homeStart >= 0 && homeEnd > homeStart ? appJs.slice(homeStart, homeEnd) : "";
check("Home paints the fallback numbers (paintSummary on the preparing path)", homeSlice.includes("summary.fallback && summary.totals") && homeSlice.includes("paintSummary(summary)"));
check("Home flags the fallback as the latest numbers on file", homeSlice.includes("These are the latest numbers on file"));
check("Home fires the refresh itself while preparing (the guaranteed trigger)", homeSlice.includes("pingAdminHomeRefresh212()"));
check("Home re-checks every 5s while preparing (was a 20s full reload in -212)", homeSlice.includes("attempt < 12 ? 5000 : 20000"));
check("Home keeps the bare preparing state for a fallback-less answer", homeSlice.includes("Preparing your numbers"));
const totStart = appJs.indexOf("async function loadAdminTotals126()");
const totSlice = totStart >= 0 ? appJs.slice(totStart, totStart + 2600) : "";
check("totals strip paints the fallback totals instead of sitting empty", totSlice.includes("s.preparing && !s.fallback") && totSlice.includes("Latest numbers on file"));
const sigStart = appJs.indexOf("async function loadAdminSig(");
const sigSlice = sigStart >= 0 ? appJs.slice(sigStart, sigStart + 3400) : "";
check("attention list paints from the fallback and says it is provisional", sigSlice.includes("isFallback213") && sigSlice.includes("still preparing the full Admin numbers"));
check("attention list does NOT paint the summary chips from a fallback (no fabricated market/partner zeroes)", sigSlice.includes("!isFallback213") && sigSlice.includes("adminSummaryHtml121"));

// ---------- live fixture server (seed mirrors verify-build212) ----------
const DB = fs.mkdtempSync("/tmp/signl-build213-") + "/db.json";
const PW = "verify-build213-pass";
const SALT = "verifybuild213salt";
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

const PORT = 9313;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_MAIL_STUB: "1", APP_URL: BASE, SIGNL_SWEEP_TOKEN: "suite-sweep-token-213" };
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
  console.log("== behavior: the cold GET ==");
  const anon = client();
  const noAuth = await anon("GET", "/api/admin/home-summary");
  check("GET without a session is refused", noAuth.status === 401 || noAuth.status === 403, `${noAuth.status}`);
  const api = client();
  const la = await api("POST", "/api/auth/login", { email: "admin@fixtures.dev", password: PW });
  check("admin sign-in", la.status === 200, `${la.status}`);

  // The FIRST home-summary GET of the suite: no summary record
  // exists yet, so this is the cold path Brenda's walk hit.
  const t0 = Date.now();
  const g1 = await api("GET", "/api/admin/home-summary");
  const g1Ms = Date.now() - t0;
  console.log(`  info  cold fallback GET took ${g1Ms}ms at fixture scale`);
  check("cold GET answers 200 (never an error, never a bare preparing)", g1.status === 200, `${g1.status}`);
  check("cold GET is flagged preparing + fallback", g1.json && g1.json.preparing === true && g1.json.fallback === true, JSON.stringify(g1.json || {}).slice(0, 160));
  check("cold GET totals are the truth: 4 creators signed up, 13,800 followers, 6,040 local, avg 38% local",
    g1.json && g1.json.totals && g1.json.totals.creatorsSignedUp === 4 && g1.json.totals.totalFollowers === 13800 && g1.json.totals.localFollowers === 6040 && g1.json.totals.avgLocalPct === 38, JSON.stringify((g1.json || {}).totals || {}));
  check("cold GET pending rows: 3 waiting (2 creators + 1 business)", g1.json && Array.isArray(g1.json.pending) && g1.json.pending.length === 3, `${g1.json && g1.json.pending && g1.json.pending.length}`);
  check("cold GET queue counts: 3 applications, 1 marketing draft, 1 social draft, 1 team invite",
    g1.json && g1.json.queue && g1.json.queue.applications === 3 && g1.json.queue.marketingDrafts === 1 && g1.json.queue.socialDrafts === 1 && g1.json.queue.teamInvites === 1, JSON.stringify((g1.json || {}).queue || {}));
  check("cold GET bizdev waiting total is 4", g1.json && g1.json.bizdevWaiting && g1.json.bizdevWaiting.total === 4, JSON.stringify((g1.json || {}).bizdevWaiting || {}));
  check("cold GET carries NO shared slices (markets/partnerRows absent — not zeroed, not leaked)", g1.json && !("markets" in g1.json) && !("partnerRows" in g1.json));
  check("cold GET asOf is the read moment (within 2 minutes of now)", g1.json && g1.json.asOf && Math.abs(Date.parse(g1.json.asOf) - Date.now()) < 120000, `${g1.json && g1.json.asOf}`);
  check("cold GET is fast at fixture scale (<10s; the production bound is the bounded read set, ~500 records)", g1Ms < 10000, `${g1Ms}ms`);

  console.log("== cross-checks: the fallback EQUALS the live endpoints ==");
  const liveTotals = await api("GET", "/api/admin/platform-totals");
  check("fallback totals equal GET /admin/platform-totals", liveTotals.json && g1.json && liveTotals.json.creatorsSignedUp === g1.json.totals.creatorsSignedUp && liveTotals.json.totalFollowers === g1.json.totals.totalFollowers && liveTotals.json.localFollowers === g1.json.totals.localFollowers && liveTotals.json.avgLocalPct === g1.json.totals.avgLocalPct,
    `live=${JSON.stringify(liveTotals.json || {})} fb=${JSON.stringify((g1.json || {}).totals || {})}`);
  const liveQueue = await api("GET", "/api/admin/approval-queue");
  check("fallback queue equals GET /admin/approval-queue", liveQueue.json && g1.json && liveQueue.json.applications === g1.json.queue.applications && liveQueue.json.marketingDrafts === g1.json.queue.marketingDrafts && liveQueue.json.socialDrafts === g1.json.queue.socialDrafts && liveQueue.json.teamInvites === g1.json.queue.teamInvites,
    `live=${JSON.stringify(liveQueue.json || {})} fb=${JSON.stringify((g1.json || {}).queue || {})}`);

  console.log("== scoped teammate: the fallback never leaks out of scope ==");
  const tm = client();
  const lt = await tm("POST", "/api/auth/login", { email: "scoped@fixtures.dev", password: PW });
  check("scoped teammate sign-in", lt.status === 200, `${lt.status}`);
  const gs = await tm("GET", "/api/admin/home-summary");
  check("teammate GET is 200 with Nashville-only totals (3 creators, 6,800 followers) on whichever path served it",
    gs.status === 200 && gs.json && gs.json.totals && gs.json.totals.creatorsSignedUp === 3 && gs.json.totals.totalFollowers === 6800, `${gs.status} ${JSON.stringify((gs.json || {}).totals || {})}`);
  check("teammate pending rows are Nashville-only (3)", gs.json && Array.isArray(gs.json.pending) && gs.json.pending.length === 3 && gs.json.pending.every((r) => r.market === "Nashville"), JSON.stringify((gs.json || {}).pending || []));
  check("teammate payload never carries the shared slices without their flags", gs.json && !("markets" in gs.json) && !("partnerRows" in gs.json));

  console.log("== takeover: the stored summary lands and the GET serves it ==");
  // The cold GETs above nudged the background refresh; poll
  // for the record it lands (no explicit trigger POSTed yet).
  let dbAfter = JSON.parse(fs.readFileSync(DB, "utf8"));
  for (let i = 0; i < 60 && !(dbAfter["config:adminHomeSummary"] && dbAfter["config:adminHomeSummary"].byUser); i++) { await sleepMs(250); dbAfter = JSON.parse(fs.readFileSync(DB, "utf8")); }
  const rec = dbAfter["config:adminHomeSummary"];
  check("the nudged background compute landed the summary (no explicit trigger was needed)", !!(rec && rec.byUser && rec.byUser.admin212 && rec.computedAt));
  const g2 = await api("GET", "/api/admin/home-summary");
  check("stored-summary GET is not flagged preparing and is not a fallback", g2.status === 200 && g2.json && g2.json.preparing === false && !g2.json.fallback, `${g2.status}`);
  check("stored-summary GET carries asOf = the record's computedAt", g2.json && rec && g2.json.asOf === rec.computedAt, `${g2.json && g2.json.asOf} vs ${rec && rec.computedAt}`);
  check("stored-summary totals still equal the fallback's truth (4 creators, 13,800 followers)", g2.json && g2.json.totals && g2.json.totals.creatorsSignedUp === 4 && g2.json.totals.totalFollowers === 13800, JSON.stringify((g2.json || {}).totals || {}));
  check("stored-summary GET carries the shared slices for the super admin", g2.json && Array.isArray(g2.json.markets) && Array.isArray(g2.json.partnerRows));
} catch (e) {
  check(`suite error: ${e && e.message}`, false);
} finally {
  server.kill("SIGKILL");
  console.log(`\nverify-build213: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
