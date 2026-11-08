// Build -150 proof suite — three claims, all against a
// PRODUCTION-SHAPED store (the real 1,346 -147 import items
// poured through the real import endpoint, on top of a
// realistic ~13.4k-event log):
//
// 1. ROOT-CAUSE REGRESSION: the -149 Data load re-read the
//    whole event log ~13 times per request (~19,000 individual
//    store fetches measured by scripts/qa-count-data150.mjs),
//    which is what Netlify's function limit killed on Jeff's
//    phone. Here every section request is fetch-counted with a
//    patched store and must land far under budget. (On the
//    pre--150 code this suite fails outright: ?section is
//    ignored, the full payload comes back, and the fetch count
//    blows every budget.)
// 2. SECTION CONTRACT: each of the six sub-tab sections
//    returns its own slice and NOT the other sections' heavy
//    fields; an unknown section is a plain 400; the legacy
//    no-section payload still serves in full; unauthenticated
//    section reads are refused.
// 3. REJECT GUARD WIRING: the client routes all three review
//    surface reject paths (list, deck, Find-a-user card)
//    through the adminConfirmReject confirmation, and the
//    market refile sweep through showConfirmSheet. (The
//    behavioral proof — nothing written until confirmed — is
//    the rendered QA: scripts/qa-data150.py.)
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (cond, label, extra = "") => { if (cond) { passed += 1; console.log("  PASS", label); } else { failed += 1; console.log("  FAIL", label, extra); } };

// ---------- seed a production-shaped store ----------
const dir = fs.mkdtempSync("/tmp/signl-verify150-");
const DB = path.join(dir, "db.json");
const PW = "verify-outside-pass", SALT = "verifyoutsidesalt";
const HASH = crypto.scryptSync(PW, SALT, 64).toString("hex");
function creatorSeed(id, email, name, handle, market, createdAt) {
  return {
    id, role: "creator", email, name, passwordHash: HASH, passwordSalt: SALT,
    status: "approved", market, city: market, state: "TN", createdAt, updatedAt: createdAt, tester: false,
    creator: { handle, platform: "Instagram", handleNormalized: handle.toLowerCase(), city: market, state: "TN", categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", audienceStack: { instagram: 9000 }, totalAudience: 9000, followerCount: 9000, localAudiencePct: 75, paidRate: 150, compOpen: true, couponOpen: true, profileComplete: true, publicPage: true, bio: `${name}, daily.` },
  };
}
const db = {};
db["config:markets"] = { flags: { Nashville: true, Austin: true } };
db["user:admin1"] = { id: "admin1", role: "admin", email: "jeff@joinsignl.com", name: "Jeff Rimmer", status: "approved", createdAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-18T00:00:00.000Z" };
db["email:jeff@joinsignl.com"] = { userId: "admin1" };
db["session:verify-token"] = { userId: "admin1", createdAt: "2026-11-08T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" };
db["user:cradriana"] = creatorSeed("cradriana", "teamadriana@thesociablesociety.com", "Adriana Mejia", "adrianamejiamakeup", "Nashville", "2026-11-06T00:00:00.000Z");
db["email:teamadriana@thesociablesociety.com"] = { userId: "cradriana" };
db["user:crzara"] = creatorSeed("crzara", "zara-creator@fixtures.dev", "Zara M", "zara_mcdermott", "London", "2026-11-07T00:00:00.000Z");
db["email:zara-creator@fixtures.dev"] = { userId: "crzara" };
// A realistic pre-existing log: 12,000 everyday events across
// Oct 18 - Nov 6 (none of them the capture kinds — those began
// Nov 7, exactly like production).
const histTypes = ["user_signed_in", "recruiter_kit_email_sent", "recruiter_kit_email_queued", "post_performance_requested", "post_performance_email_sent", "roster_drop", "notification_sent", "offer_viewed", "profile_backfill_completed", "auto_decision_cleanup_completed"];
for (let day = 0; day < 20; day++) {
  const d = new Date(Date.UTC(2026, 9, 18 + day)).toISOString().slice(0, 10);
  for (let i = 0; i < 600; i++) {
    const id = crypto.randomUUID();
    db[`event:${d}:${id}`] = { id, ts: `${d}T12:00:00.000Z`, type: histTypes[(day + i) % histTypes.length], actorId: "seed", actorRole: "system", subjectId: null, market: null, data: {} };
  }
}
// Nov 7 capture-kind events (the funnel's top + health counts).
const nov7 = [
  { type: "sig_ask", data: { role: "creator", outcome: "answered" } },
  { type: "sig_ask", data: { role: "creator", outcome: "answered" } },
  { type: "sig_ask", data: { role: "business", outcome: "fallback" } },
  { type: "discover_search", market: "Nashville", data: { zeroResults: true, filters: { market: "Nashville", category: "Food & Drink" } } },
  { type: "discover_search", market: "Nashville", data: { zeroResults: false, filters: { market: "Nashville", category: "Food & Drink" } } },
  { type: "match_impression", data: { shown: [{ creatorId: "cradriana" }, { creatorId: "crzara" }], market: "Nashville", category: "Food & Drink" } },
  { type: "campaign_prompt_shown", data: { trigger: "new_business", family: "comp_first" } },
  { type: "creator_step_offered", data: { step: "market" } },
];
for (const e of nov7) {
  const id = crypto.randomUUID();
  db[`event:2026-11-07:${id}`] = { id, ts: "2026-11-07T15:00:00.000Z", actorId: "seed", actorRole: "system", subjectId: null, market: null, ...e };
}
fs.writeFileSync(DB, JSON.stringify(db));

// ---------- boot the real handler with a counting store ----------
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify-admin-pass-123";
process.env.SIGNL_SWEEP_TOKEN = "proof-sweep-token";
for (const k of ["SIG_AI_BASE_URL", "SIG_AI_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MAGGIE_AI_ENABLED", "MAGGIE_AI_MODEL"]) process.env[k] = "";
const store = require("../netlify/functions/lib/store.js");
const counts = { get: 0, getManyKeys: 0, listValues: 0 };
const origGet = store.get.bind(store), origGetMany = store.getMany.bind(store), origList = store.list.bind(store);
store.get = async (k) => { counts.get += 1; return origGet(k); };
store.getMany = async (ks) => { counts.getManyKeys += ks.length; return origGetMany(ks); };
store.list = async (p) => { const rows = await origList(p); counts.listValues += rows.length; return rows; };
const fetches = () => counts.get + counts.getManyKeys + counts.listValues;
const resetCounts = () => { counts.get = 0; counts.getManyKeys = 0; counts.listValues = 0; };
const { handler } = require("../netlify/functions/api.js");

async function call(method, p, { cookie = true, token = false, body = null } = {}) {
  const [pathname, qs] = p.split("?");
  const queryStringParameters = {};
  if (qs) for (const pair of qs.split("&")) { const i = pair.indexOf("="); queryStringParameters[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1)); }
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = "signl_session=verify-token";
  if (token) headers["x-signl-sweep-token"] = "proof-sweep-token";
  const out = await handler({ httpMethod: method, path: pathname, headers, queryStringParameters, body: body ? JSON.stringify(body) : null, isBase64Encoded: false });
  let data = null;
  try { data = JSON.parse(out.body); } catch { /* downloads etc. */ }
  return { status: out.statusCode, data };
}

// ---------- pour the real import through the real endpoint ----------
console.log("verify-data150: production-shaped seed (12,000 history events + Nov 7 captures)");
const itemsFile = JSON.parse(fs.readFileSync(path.join(os.homedir(), "workspace/signl-campaign-run/outside-import-items-2026-11-08.json"), "utf8"));
const items = itemsFile.items || itemsFile;
ok(Array.isArray(items) && items.length === 1346, `real import file holds 1,346 items (got ${items.length})`);
const totals = {};
for (let i = 0; i < items.length; i += 100) {
  const r = await call("POST", "/api/admin/imports/outside", { cookie: false, token: true, body: { items: items.slice(i, i + 100) } });
  if (r.status !== 200) { ok(false, `import batch at ${i} status 200`, `got ${r.status}`); break; }
  for (const [k, v] of Object.entries(r.data.counts || {})) { totals[k] = totals[k] || { written: 0 }; totals[k].written += v.written || 0; }
}
ok(totals.send && totals.send.written === 800, `import wrote 800 sends (got ${totals.send && totals.send.written})`);
ok(totals.prospect && totals.prospect.written === 481, `import wrote 481 prospects (got ${totals.prospect && totals.prospect.written})`);
ok(totals.bounce && totals.bounce.written === 60, `import wrote 60 bounces (got ${totals.bounce && totals.bounce.written})`);
const join = await call("POST", "/api/admin/imports/outside", { cookie: false, token: true, body: { items: [], join: true } });
ok(join.status === 200 && join.data.join && join.data.join.joined === 2, `conversion join matched the 2 seeded creators (got ${join.data && join.data.join && join.data.join.joined})`);
// Cold start: before any sweep warms the rollups, a section
// read still answers correctly (it pays the one-time per-day
// rollup build inline). Correctness is asserted here; the
// fetch budgets below are asserted on the warmed store, which
// is the production steady state (the daily sweep warms).
resetCounts();
const cold = await call("GET", "/api/admin/stats/data?section=overview&days=30");
ok(cold.status === 200 && cold.data && cold.data.totals && cold.data.totals.creators.approved === 2, `cold overview still answers correctly (one-time rollup build: ${fetches()} fetches)`);
// force: the request preamble's opportunistic sweep already
// froze today's snapshot during the import calls above (as it
// does in production); force re-runs the full sweep path —
// training freeze + authoritative capture-since backfill +
// rollup warm — exactly as the verify suites drive it.
const sweep = await call("POST", "/api/admin/snapshot/sweep", { cookie: false, token: true, body: { force: true } });
ok(sweep.status === 200, `snapshot sweep answered 200 (got ${sweep.status})`);
const todaySnap = await origGet(`snapshot:${new Date().toISOString().slice(0, 10)}`);
ok(!!(todaySnap && todaySnap.training), "today's snapshot carries the frozen training summary");

// ---------- section contract + fetch budgets ----------
console.log("verify-data150: section payloads, fetch-counted (sweep-warmed store)");
const BUDGETS = { overview: 2000, supply: 2000, funnel: 2000, outside: 4000, snapshots: 300, export: 300 };
const sectionResults = {};
for (const s of ["overview", "supply", "funnel", "outside", "snapshots", "export"]) {
  resetCounts();
  const r = await call("GET", `/api/admin/stats/data?section=${s}&days=30`);
  sectionResults[s] = { ...r, fetches: fetches() };
  ok(r.status === 200, `${s}: 200 (got ${r.status})`);
  ok(r.data && r.data.section === s, `${s}: payload names its section`);
  ok(sectionResults[s].fetches <= BUDGETS[s], `${s}: ${sectionResults[s].fetches} store fetches within budget ${BUDGETS[s]} (the -149 full load needed ~19,000 on this shape)`);
}
const ov = sectionResults.overview.data || {};
ok(ov.totals && ov.totals.creators && ov.totals.creators.approved === 2, "overview: headline totals present (2 approved creators)");
const sigCap = (ov.health && ov.health.captures || []).find((c) => c.type === "sig_ask");
ok(!!sigCap && sigCap.inRange === 3, `overview: capture health counts sig_ask in range = 3 (got ${sigCap && sigCap.inRange})`);
ok(!!sigCap && sigCap.since === "2026-11-07", `overview: sig_ask capture-since reads 2026-11-07 from the map (got ${sigCap && sigCap.since})`);
ok(!("matrix" in ov) && !("outside" in ov) && !("snapshots" in ov), "overview: carries no other section's payload");
const sup = sectionResults.supply.data || {};
ok(!!sup.matrix && sup.matrix.Nashville && sup.matrix.Nashville["Food & Drink"] && sup.matrix.Nashville["Food & Drink"].supply === 1, "supply: matrix counts the seeded Nashville food creator");
ok(!("health" in sup) && !("outside" in sup) && !("funnel" in sup), "supply: carries no other section's payload");
const fn = sectionResults.funnel.data || {};
const stage = (k) => { const s = (fn.funnel && fn.funnel.stages || []).find((x) => x.key === k); return s ? s.n : null; };
ok(stage("searches") === 2 && stage("briefs") === 1 && stage("shown") === 2, `funnel: rollup stages searches=2 briefs=1 shown=2 (got ${stage("searches")}/${stage("briefs")}/${stage("shown")})`);
ok(((fn.funnel && fn.funnel.zeroResultGaps) || []).some((g) => g.market === "Nashville" && g.category === "Food & Drink" && g.count === 1), "funnel: zero-result gap survives the rollup (Nashville · Food & Drink ×1)");
ok(!!fn.prompting && fn.prompting.campaign && fn.prompting.campaign.shown === 1, "funnel: prompting campaign counts read from rollups (shown=1)");
ok(!!fn.prompting && fn.prompting.coaching && fn.prompting.coaching.offered === 1, "funnel: coaching offered count reads from rollups (=1)");
ok(!!fn.reliability && typeof fn.reliability.paused === "number", "funnel: reliability rides along");
ok(!("matrix" in fn) && !("outside" in fn), "funnel: carries no other section's payload");
const ox = (sectionResults.outside.data || {}).outside || {};
const earliestSend = items.filter((i) => i.kind === "send" && i.sentAt).map((i) => String(i.sentAt).slice(0, 10)).sort()[0];
ok(ox.sends && ox.sends.total === 800, `outside: 800 sends counted (got ${ox.sends && ox.sends.total})`);
ok(ox.sends && ox.sends.since === earliestSend, `outside: sends-since = the import's earliest send day ${earliestSend} (got ${ox.sends && ox.sends.since})`);
ok(ox.prospects && ox.prospects.total === 1283 && ox.prospects.joined === 2, `outside: 1,283 prospects, 2 joined (got ${ox.prospects && ox.prospects.total}/${ox.prospects && ox.prospects.joined})`);
ok(ox.forms && ox.forms.imported === 1, "outside: the 1 real form import counted (GleekOps)");
const sn = sectionResults.snapshots.data || {};
ok(Array.isArray(sn.snapshots) && sn.snapshots.length >= 1, "snapshots: trend rows present");
const ex = sectionResults.export.data || {};
ok(!!ex.training && ex.training.impressions === 1 && ex.training.rows === 2, `export: training summary from the snapshot (impressions=1, rows=2; got ${ex.training && ex.training.impressions}/${ex.training && ex.training.rows})`);
ok(!("totals" in ex) && !("matrix" in ex), "export: carries no other section's payload");

// ---------- isolation + legacy + auth ----------
const bad = await call("GET", "/api/admin/stats/data?section=bogus&days=30");
ok(bad.status === 400, `unknown section is a plain 400, not a 500 (got ${bad.status})`);
const unauth = await call("GET", "/api/admin/stats/data?section=overview&days=30", { cookie: false });
ok(unauth.status === 401 || unauth.status === 403, `unauthenticated section read refused (got ${unauth.status})`);
resetCounts();
const legacy = await call("GET", "/api/admin/stats/data?days=30");
const legacyKeys = ["totals", "matrix", "benchmarks", "reliability", "backlog", "funnel", "health", "snapshots", "outside", "prompting", "training"];
ok(legacy.status === 200 && legacyKeys.every((k) => legacy.data && k in legacy.data), "legacy: no-section payload still serves every dataset");
ok(legacy.data && legacy.data.outside && legacy.data.outside.sends.total === 800, "legacy: outside numbers agree with the section (800 sends)");

// ---------- reject guard wiring (client) ----------
console.log("verify-data150: reject guard wiring");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
ok(appJs.includes("async function adminConfirmReject("), "client: adminConfirmReject exists");
ok(appJs.includes('showConfirmSheet(`Reject ${who}?`, body, "Reject application", { danger: true })'), "client: the guard is a danger-styled confirm sheet naming the applicant");
for (const fnName of ["confirmRejectApp", "adminCardConfirmReject", "adminDeckDecide"]) {
  const i = appJs.indexOf(`async function ${fnName}(`);
  const bodySlice = i > -1 ? appJs.slice(i, i + 1400) : "";
  ok(bodySlice.includes("await adminConfirmReject("), `client: ${fnName} passes through the guard before writing`);
  const guardAt = bodySlice.indexOf("await adminConfirmReject(");
  const writeAt = bodySlice.indexOf('api("POST", "/admin/review"');
  ok(guardAt > -1 && writeAt > guardAt, `client: in ${fnName} the guard runs before the /admin/review write`);
}
const refileAt = appJs.indexOf("async function runRefileSweep(");
ok(refileAt > -1 && appJs.slice(refileAt, refileAt + 900).includes("showConfirmSheet("), "client: the one-tap market refile sweep is confirm-guarded too");
ok(appJs.includes('api("GET", `/admin/stats/data?section=${section}&days=30`)'), "client: the Data view fetches section-scoped payloads");
ok((appJs.match(/astSetDataSection\('/g) || []).length >= 1 && appJs.includes('"Supply & demand"') && appJs.includes('"Outside the app"'), "client: six plain-word sub-tabs wired");

console.log(`\nverify-data150: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
