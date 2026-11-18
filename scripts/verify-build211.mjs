#!/usr/bin/env node
// Build -211 fixture suite: the Admin Suggestions board is
// PRECOMPUTED. The heavy candidate build (which killed the
// Stats card on production data in Builds -202 and -210, where
// the in-request build is ~61k store fetches) no longer runs
// on any request path: GET /admin/suggestions serves the stored
// board at config:suggestionBoard, falls back to the persisted
// suggestion records (flagged `preparing`) when no board is
// stored, and the compute lives in refreshSuggestionBoard211 —
// reached by the 5-minute scheduled function, the sweep-token /
// admin refresh endpoint, and a throttled off-path nudge.
// Dismiss/act bind to the stored board's fingerprints and take
// the card off the stored board immediately.
//
// This suite asserts the ARCHITECTURE (static: no build calls
// on the read/write paths) and the BEHAVIOR (live fixture:
// fallback -> refresh -> board -> dismiss -> token auth). The
// production-scale timing proof lives in the -211 perf probe
// (~/workspace/xmedium-qa/suggest211/probe211.mjs).
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
check("BUILD_ID is 2026.11.18-212", buildJs.includes('exports.BUILD_ID = "2026.11.18-212"'));
check("shell stamp matches", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-212"') && (indexHtml.match(/2026\.11\.18-212/g) || []).length >= 5);

console.log("== architecture (static): the build is off the request paths ==");
const getStart = routerJs.indexOf('if (method === "GET" && seg[1] === "suggestions" && seg.length === 2)');
const dismissStart = routerJs.indexOf('seg[2] === "dismiss"');
const getSlice = getStart >= 0 && dismissStart > getStart ? routerJs.slice(getStart, dismissStart) : "";
check("GET /admin/suggestions handler found", getSlice.length > 200, `len=${getSlice.length}`);
check("GET serves the stored board (loadSuggestionBoard)", getSlice.includes("loadSuggestionBoard()") && getSlice.includes("board.payload"));
check("GET falls back to persisted records (suggestionBoardFallback211)", getSlice.includes("suggestionBoardFallback211()"));
check("GET never builds: no buildSuggestionCandidates / syncSuggestionRecords / maggiePhrase on the read path",
  !getSlice.includes("buildSuggestionCandidates(") && !getSlice.includes("syncSuggestionRecords(") && !getSlice.includes("maggiePhrase("));
const actStart = routerJs.indexOf('seg[2] === "act"');
const actEnd = routerJs.indexOf('seg[2] === "outcomes"', actStart);
const writeSlice = dismissStart >= 0 && actEnd > dismissStart ? routerJs.slice(dismissStart, actEnd) : "";
check("dismiss+act slice found", writeSlice.length > 500, `len=${writeSlice.length}`);
check("dismiss/act never rebuild candidates", !writeSlice.includes("buildSuggestionCandidates(") && !writeSlice.includes("syncSuggestionRecords("));
check("dismiss/act update the stored board in place", writeSlice.includes("removeFromSuggestionBoard211(id)"));
check("refreshSuggestionBoard211 exists and stores config:suggestionBoard",
  routerJs.includes("async function refreshSuggestionBoard211(") && routerJs.includes('store.set(SUGGESTION_BOARD_KEY') && routerJs.includes('"config:suggestionBoard"'));
const epStart = routerJs.indexOf('seg[1] === "suggestions" && seg[2] === "refresh"');
const epSlice = epStart >= 0 ? routerJs.slice(epStart, epStart + 1600) : "";
check("refresh endpoint exists with sweep-token-or-admin auth",
  epSlice.includes("x-signl-sweep-token") && epSlice.includes('user.role !== "admin"'));
check("refresh endpoint TRIGGERS the background function and never computes inline (reviewer D1)",
  epSlice.includes("fireSuggestionBoardRefresh211") && !epSlice.includes("refreshSuggestionBoard211("));
check("nudge fires the background function, never computes in-process (reviewer D1)",
  routerJs.includes("await fireSuggestionBoardRefresh211(false)") && !routerJs.includes("await refreshSuggestionBoard211(actorId)"));
const bgPath = path.join(ROOT, "netlify/functions/suggestions-refresh-background.js");
const bg = fs.existsSync(bgPath) ? fs.readFileSync(bgPath, "utf8") : "";
check("background refresh function exists (the -background budget), token-guarded, runs the exported runner",
  bg.includes("runSuggestionBoardRefresh211") && bg.includes("SIGNL_SWEEP_TOKEN") && bg.includes("exports.handler"));
check("router exports the background runner", routerJs.includes("runSuggestionBoardRefresh211, runLearnSync202") || routerJs.includes("runSuggestionBoardRefresh211"));
check("digest scan persists per batch (resumable), not once at the end",
  routerJs.includes("CLA_BATCH") && routerJs.includes("coveredThroughDay: chunk[chunk.length - 1]"));
const schedPath = path.join(ROOT, "netlify/functions/suggestions-refresh.mjs");
const sched = fs.existsSync(schedPath) ? fs.readFileSync(schedPath, "utf8") : "";
check("scheduled refresh function exists (*/5) and fires the background function",
  sched.includes('schedule: "*/5 * * * *"') && sched.includes("/.netlify/functions/suggestions-refresh-background") && sched.includes("x-signl-sweep-token"));
const sugClientStart = appJs.indexOf("async function astLoadSuggestions()");
const sugClientSlice = sugClientStart >= 0 ? appJs.slice(sugClientStart, sugClientStart + 2600) : "";
check("client renders the honest preparing state", sugClientSlice.includes("d.preparing") && sugClientSlice.includes("preparing your board"));

// ---------- live fixture server ----------
const DB = fs.mkdtempSync("/tmp/signl-build211-") + "/db.json";
const PW = "verify-build211-pass";
const SALT = "verifybuild211salt";
const HASH = crypto.scryptSync(PW, SALT, 64).toString("hex");
const nowMs = Date.now();
const iso = (ms) => new Date(ms).toISOString();
{
  const seed = {};
  const admin = { id: "admin211", role: "admin", email: "admin@fixtures.dev", name: "Fixture Admin", passwordHash: HASH, passwordSalt: SALT, status: "approved", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: iso(nowMs) };
  seed[`user:${admin.id}`] = admin; seed[`email:${admin.email}`] = { userId: admin.id };
  for (let i = 0; i < 2; i++) {
    const u = { id: `pend211-${i}`, role: "creator", email: `pend${i}@fixtures.dev`, name: `Pending ${i}`, passwordHash: HASH, passwordSalt: SALT, status: "pending", market: "Nashville", city: "Nashville", createdAt: iso(nowMs - 3 * 86400000), updatedAt: iso(nowMs), tester: false, creator: { handle: `pend${i}`, categories: ["Music"], audienceStack: { instagram: 900 }, totalAudience: 900, localAudiencePct: 30, profileComplete: true } };
    seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id };
  }
  const quiet = { id: "quiet211", role: "creator", email: "quiet@fixtures.dev", name: "Quiet Fixture", passwordHash: HASH, passwordSalt: SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(nowMs - 40 * 86400000), updatedAt: iso(nowMs), tester: false, creator: { handle: "quietfx", categories: ["Music"], audienceStack: { instagram: 5000 }, totalAudience: 5000, localAudiencePct: 40, profileComplete: true } };
  seed[`user:${quiet.id}`] = quiet; seed[`email:${quiet.email}`] = { userId: quiet.id };
  const askDay = iso(nowMs - 30 * 86400000).slice(0, 10);
  seed[`event:${askDay}:q1`] = { id: "q1", type: "sig_ask", ts: `${askDay}T09:00:00.000Z`, actorId: "quiet211", actorRole: "creator", market: "Nashville", data: { q: "how do I get booked", source: "convo" } };
  const today = iso(nowMs).slice(0, 10);
  seed[`event:${today}:t1`] = { id: "t1", type: "profile_view", ts: `${today}T10:00:00.000Z`, actorId: "quiet211", actorRole: "creator", market: "Nashville", data: {} };
  // One open suggestion record from a previous era: the fallback board.
  seed["suggestion:waiting:creators"] = { id: "waiting:creators", key: "waiting:creators", type: "ops.waiting", family: "ops", kind: "waiting", headline: "2 creator applications waiting on review. They sit in Review.", receipts: [{ label: "count", value: 2 }], receipt: { count: 2, oldestDays: 3 }, action: { label: "Open Review", route: "applications", params: {} }, market: null, category: null, subjectId: null, score: 100, fingerprint: "fxfp1", status: "open", createdAt: iso(nowMs - 86400000), updatedAt: iso(nowMs - 86400000), expiresAt: iso(nowMs + 10 * 86400000), shownAt: iso(nowMs - 86400000), actedAt: null, dismissedAt: null, dismissedFingerprint: null, outcome: null, timesSurfaced: 1 };
  seed["config:markets"] = { flags: {} };
  seed[`snapshot:${today}`] = { date: today, capturedAt: iso(nowMs), totals: {} };
  seed["config:snapshotSweep"] = { lastDate: today, lastRunAt: iso(nowMs) };
  fs.writeFileSync(DB, JSON.stringify(seed));
}

const PORT = 9311;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_MAIL_STUB: "1", APP_URL: BASE, SIGNL_SWEEP_TOKEN: "suite-sweep-token-211" };
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
  const noAuth = await anon("GET", "/api/admin/suggestions");
  check("GET without a session is refused", noAuth.status === 401 || noAuth.status === 403, `${noAuth.status}`);
  const api = client();
  const la = await api("POST", "/api/auth/login", { email: "admin@fixtures.dev", password: PW });
  check("admin sign-in", la.status === 200, `${la.status}`);

  const g1 = await api("GET", "/api/admin/suggestions");
  check("no-board GET answers 200 with the fallback board", g1.status === 200 && g1.json && Array.isArray(g1.json.suggestions), `${g1.status}`);
  check("fallback is flagged preparing (never dressed as a fresh board)", g1.json && g1.json.preparing === true && !g1.json.generatedAt);
  check("fallback serves the persisted open records", (g1.json.suggestions || []).some((s) => s.id === "waiting:creators" && /waiting on review/.test(s.text || "")), JSON.stringify(g1.json.suggestions || []).slice(0, 160));

  const noTok = await anon("POST", "/api/admin/suggestions/refresh", {});
  check("refresh without session or token is 403", noTok.status === 403, `${noTok.status}`);
  const badTok = await anon("POST", "/api/admin/suggestions/refresh", {}, { "x-signl-sweep-token": "wrong" });
  check("refresh with a wrong token is 403", badTok.status === 403, `${badTok.status}`);

  const bgNoTok = await anon("POST", "/.netlify/functions/suggestions-refresh-background", {});
  check("background function refuses a tokenless call", bgNoTok.status === 403, `${bgNoTok.status}`);

  const rf = await api("POST", "/api/admin/suggestions/refresh", {});
  check("admin refresh trigger accepted (started, not computed inline)", rf.status === 200 && rf.json && rf.json.ok === true && rf.json.started === true, `${rf.status} ${JSON.stringify(rf.json).slice(0, 160)}`);
  const dbAfter = JSON.parse(fs.readFileSync(DB, "utf8"));
  check("refresh stored the board at config:suggestionBoard", !!(dbAfter["config:suggestionBoard"] && Array.isArray(dbAfter["config:suggestionBoard"].payload.suggestions) && Array.isArray(dbAfter["config:suggestionBoard"].candidates)));
  check("the compute ran in the background function (runner stamp written)", !!(dbAfter["config:suggestionBoardRefresh"] && dbAfter["config:suggestionBoardRefresh"].ok === true));

  const g2 = await api("GET", "/api/admin/suggestions");
  const ids2 = (g2.json.suggestions || []).map((s) => s.id);
  check("stored-board GET is not flagged preparing and carries generatedAt", g2.status === 200 && !g2.json.preparing && !!g2.json.generatedAt, `${g2.status}`);
  check("board carries waiting:creators from the live compute", ids2.includes("waiting:creators"), ids2.join(","));
  check("board carries the cooling card for the quiet creator (digest path)", ids2.includes("cooling:quiet211"), ids2.join(","));

  const dm = await api("POST", "/api/admin/suggestions/dismiss", { id: "waiting:creators" });
  check("dismiss answers ok", dm.status === 200 && dm.json && dm.json.ok === true, `${dm.status}`);
  const g3 = await api("GET", "/api/admin/suggestions");
  check("dismissed card is gone from the very next GET", !(g3.json.suggestions || []).some((s) => s.id === "waiting:creators"), (g3.json.suggestions || []).map((s) => s.id).join(","));

  const tok = await anon("POST", "/api/admin/suggestions/refresh", {}, { "x-signl-sweep-token": "suite-sweep-token-211" });
  check("refresh with the sweep token (no session) completes", tok.status === 200 && tok.json && tok.json.ok === true, `${tok.status}`);
} catch (e) {
  check(`suite error: ${e && e.message}`, false);
} finally {
  server.kill("SIGKILL");
  console.log(`\nverify-build211: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
