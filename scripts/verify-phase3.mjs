// Phase 3 Readiness (Build -149; data program step 5 of 5):
// training-pairs export + offline ranker harness + suggestion
// outcome matching.
//
// Boots the fixture server (AI off) and proves:
//   - the training_pairs export joins impressions -> picks ->
//     deliveries correctly: campaign picks via applications /
//     selections / bookings, Find briefs via the sourceBrief
//     join, delivery labels on_time / late / no_show, dedupe
//     of a doubled shown row, byte-identical re-export;
//   - the Data payload carries the honest volume summary;
//   - suggestion outcome matching: acted records for waiting /
//     recruit / gate / cooling / quiet / curriculum stamp
//     achieved when the downstream fact lands inside 7 days,
//     an acted record whose window already closed stamps
//     window_expired, a manual kind (pricing) is never
//     stamped, terminal stamps log suggestion_outcome, and a
//     second sweep is a no-op;
//   - the eval harness as a subprocess: NOT ENOUGH DATA with
//     exact counts on a tiny set and on the real-shaped export
//     above; full train + verdict on the synthetic fixture.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = fs.mkdtempSync(path.join(os.tmpdir(), "signl-phase3-")) + "/db.json";
const SEED_PW = "verify-phase3-pass";
const SEED_SALT = "verifyphase3salt";
const SEED_HASH = crypto.scryptSync(SEED_PW, SEED_SALT, 64).toString("hex");
const NOW = Date.now();
const NOW_ISO = new Date(NOW).toISOString();
const daysAgoIso = (d) => new Date(NOW - d * 86400000).toISOString();
const hoursFromNowIso = (h) => new Date(NOW + h * 3600000).toISOString();
const dayKey = (iso) => iso.slice(0, 10);

function creatorSeed(id, email, name, handle, market, opts = {}) {
  const cats = opts.categories || ["Food & Drink"];
  return {
    id, role: "creator", email, name, passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: opts.status || "approved", market, city: opts.city || market, state: opts.state || "TN",
    createdAt: opts.createdAt || "2026-09-02T00:00:00.000Z", updatedAt: opts.updatedAt || "2026-09-02T00:00:00.000Z", tester: false,
    creator: { handle, platform: "Instagram", handleNormalized: handle, city: opts.city || market, state: opts.state || "TN", categories: cats, compCategories: ["Restaurant meals"], tierBand: "Locals", audienceStack: { instagram: 9000 }, totalAudience: 9000, followerCount: 9000, localAudiencePct: 75, paidRate: 150, compOpen: true, couponOpen: true, profileComplete: true, publicPage: true, bio: `${name}, daily.` },
  };
}
function bizSeed(id, email, name, bizName, market, opts = {}) {
  return {
    id, role: "business", email, name, passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: "approved", market, city: market, createdAt: opts.createdAt || "2026-09-01T00:00:00.000Z", updatedAt: opts.updatedAt || "2026-09-01T00:00:00.000Z", tester: false, businessOnboarded: true,
    business: { businessName: bizName, legalName: `${bizName} LLC`, category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Seeded business." },
  };
}
function parts(over = {}) {
  return { localPct: 80, category: 100, categorySignal: "direct", categoryLabel: "Food & Drink", budget: 100, budgetSignal: "fits", reliability: 70, reliabilityBasis: "neutral", deliveries: 0, onTimePct: null, momentum: 40, trackBonus: 0, trackReach: 0, trackPosts: 0, trackRedemptions: 0, ...over };
}
function sugSeed(id, kind, type, family, receipt, extra = {}) {
  return {
    id, key: id, type, family, kind, headline: `Seeded ${id}`, receipts: [], receipt,
    action: { label: "Open", route: "stats-data", params: {} }, market: extra.market || null, category: extra.category || null,
    subjectId: extra.subjectId || null, score: 50, fingerprint: "seedprint", status: extra.status || "open",
    createdAt: NOW_ISO, updatedAt: NOW_ISO, expiresAt: daysAgoIso(-14), shownAt: null,
    actedAt: extra.actedAt || null, dismissedAt: null, dismissedFingerprint: null,
    outcome: extra.outcome !== undefined ? extra.outcome : null, timesSurfaced: 1,
  };
}

{
  const seed = {};
  seed["config:markets"] = { flags: { Nashville: true, Austin: true } };
  seed["config:recruiterKitEmailV1Sent"] = { version: 1, claimedAt: "2026-10-20T00:00:00.000Z", completedAt: "2026-10-20T00:00:00.000Z", recipients: [] };
  const put = (u) => { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; };
  put(bizSeed("bizmain", "main@fixtures.dev", "Main Owner", "Main Kitchen", "Nashville"));
  put(bizSeed("bizquiet", "quietbiz@fixtures.dev", "Quiet Owner", "Quiet Tacos", "Nashville", { createdAt: daysAgoIso(20), updatedAt: daysAgoIso(20) }));
  for (const [id, handle] of [["crA", "cralpha"], ["crB", "crbravo"], ["crC", "crcharlie"], ["crD", "crdelta"], ["crE", "crecho"], ["crF", "crfoxtrot"], ["crG", "crgolf"]]) {
    put(creatorSeed(id, `${id.toLowerCase()}@fixtures.dev`, `Creator ${id.slice(2)}`, handle, "Nashville", { createdAt: daysAgoIso(30), updatedAt: NOW_ISO }));
  }
  put(creatorSeed("crMusic", "music@fixtures.dev", "Music One", "nashmusicone", "Nashville", { categories: ["Music"], createdAt: daysAgoIso(30), updatedAt: NOW_ISO }));
  put(creatorSeed("crAct", "act@fixtures.dev", "Act Ivy", "activy", "Nashville", { createdAt: daysAgoIso(40), updatedAt: daysAgoIso(40) }));
  put(creatorSeed("crNever", "never@fixtures.dev", "Never Ned", "neverned", "Nashville", { createdAt: daysAgoIso(40), updatedAt: daysAgoIso(40) }));
  for (const n of [1, 2, 3]) put(creatorSeed(`atx${n}`, `atx${n}@fixtures.dev`, `Austin Creator ${n}`, `atxcreator${n}`, "Austin", { categories: [["Food & Drink"], ["Fitness & Wellness"], ["Lifestyle"]][n - 1], createdAt: daysAgoIso(10), updatedAt: NOW_ISO }));
  put(creatorSeed("pendAustin", "pendaustin@fixtures.dev", "Pending Austin", "pendaustin", "Austin", { status: "pending", createdAt: daysAgoIso(1), updatedAt: daysAgoIso(1) }));
  put(creatorSeed("pendNash", "pendnash@fixtures.dev", "Pending Nash", "pendnashmusic", "Nashville", { status: "pending", categories: ["Music"], createdAt: daysAgoIso(1), updatedAt: daysAgoIso(1) }));

  // Offers: two campaigns, one direct offer composed from a
  // Find brief (sourceBrief), one starving offer for the quiet
  // test.
  seed["offer:camp1"] = { id: "camp1", businessId: "bizmain", businessName: "Main Kitchen", market: "Nashville", category: "Restaurant", kind: "paid", cashRate: 200, title: "Campaign One", status: "open", createdAt: daysAgoIso(3), updatedAt: daysAgoIso(3) };
  seed["offer:camp2"] = { id: "camp2", businessId: "bizmain", businessName: "Main Kitchen", market: "Nashville", category: "Restaurant", kind: "paid", cashRate: 200, title: "Campaign Two", status: "open", createdAt: daysAgoIso(3), updatedAt: daysAgoIso(3) };
  seed["offer:off2"] = { id: "off2", businessId: "bizmain", businessName: "Main Kitchen", market: "Nashville", category: "Restaurant", kind: "paid", cashRate: 150, title: "Direct from Find", status: "open", lane: "direct", creatorId: "crE", sourceBrief: { source: "filters", market: "Nashville", category: "Food & Drink", kind: "paid", budget: 150 }, createdAt: daysAgoIso(1), updatedAt: daysAgoIso(1) };
  seed["offer:offq"] = { id: "offq", businessId: "bizmain", businessName: "Main Kitchen", market: "Nashville", category: "Restaurant", kind: "paid", cashRate: 100, title: "Starving Supper", status: "open", createdAt: daysAgoIso(6), updatedAt: daysAgoIso(6) };

  seed["application:appB"] = { id: "appB", offerId: "camp1", creatorId: "crB", businessId: "bizmain", status: "applied", createdAt: NOW_ISO };
  seed["application:appD"] = { id: "appD", offerId: "camp1", creatorId: "crD", businessId: "bizmain", status: "selected", createdAt: NOW_ISO, decidedAt: NOW_ISO };
  seed["application:appG"] = { id: "appG", offerId: "camp1", creatorId: "crG", businessId: "bizmain", status: "selected", createdAt: NOW_ISO, decidedAt: NOW_ISO };

  seed["booking:bkA"] = { id: "bkA", offerId: "camp1", businessId: "bizmain", creatorId: "crA", market: "Nashville", status: "completed", createdAt: daysAgoIso(2), redeemedAt: daysAgoIso(2) };
  seed["booking:bkD"] = { id: "bkD", offerId: "camp1", businessId: "bizmain", creatorId: "crD", market: "Nashville", status: "completed", createdAt: daysAgoIso(2), redeemedAt: daysAgoIso(2) };
  seed["booking:bkF"] = { id: "bkF", offerId: "off2", businessId: "bizmain", creatorId: "crF", market: "Nashville", status: "expired", createdAt: daysAgoIso(1), redeemedAt: null };
  seed["post:pA"] = { id: "pA", bookingId: "bkA", creatorId: "crA", url: "https://instagram.com/p/a", submittedAt: daysAgoIso(1), onTime: true };
  seed["post:pD"] = { id: "pD", bookingId: "bkD", creatorId: "crD", url: "https://instagram.com/p/d", submittedAt: daysAgoIso(1), onTime: false };

  const imp = (id, ts, actorId, subjectId, brief, shown) => {
    seed[`event:${dayKey(ts)}:${id}`] = { id, ts, type: "match_impression", actorId, actorRole: "business", subjectId, market: brief.market, data: { via: subjectId ? "matches" : "discover", brief, shown } };
  };
  imp("imp1", NOW_ISO, "bizmain", "camp1",
    { source: "campaign", campaignId: "camp1", market: "Nashville", category: "Restaurant", kind: "paid", budget: 200 },
    [{ creatorId: "crA", score: 88, parts: parts() }, { creatorId: "crB", score: 72, parts: parts({ localPct: 66 }) }, { creatorId: "crC", score: 65, parts: parts({ localPct: 40 }) }]);
  imp("imp2", hoursFromNowIso(0.01), "bizmain", "camp1",
    { source: "campaign", campaignId: "camp1", market: "Nashville", category: "Restaurant", kind: "paid", budget: 200 },
    [{ creatorId: "crA", score: 88, parts: parts() }, { creatorId: "crA", score: 88, parts: parts() }, { creatorId: "crD", score: 77, parts: parts({ reliability: 92, reliabilityBasis: "real", deliveries: 6, onTimePct: 83 }) }, { creatorId: "crG", score: 70, parts: parts() }]);
  imp("imp3", daysAgoIso(2), "bizmain", null,
    { source: "filters", campaignId: null, market: "Nashville", category: "Food & Drink", kind: "paid", budget: 150 },
    [{ creatorId: "crE", score: 81, parts: parts() }, { creatorId: "crF", score: 69, parts: parts() }]);
  imp("imp4", hoursFromNowIso(0.02), "bizmain", "camp2",
    { source: "campaign", campaignId: "camp2", market: "Nashville", category: "Restaurant", kind: "paid", budget: 200 },
    [{ creatorId: "crA", score: 90, parts: parts() }]);

  // Curriculum evidence: six creator pricing asks landing just
  // after "now" (inside any window opened during this run) —
  // five answered by the data layer, one unanswered, against a
  // receipt whose unanswered share was 80%.
  const askQs = ["how much should I charge for a post?", "what is a fair rate here?", "pricing for a sponsored post?", "how much do businesses pay?", "is my rate too low?", "what does a campaign cost?"];
  askQs.forEach((q, i) => {
    const ts = hoursFromNowIso(0.5);
    seed[`event:${dayKey(ts)}:seedask${i}`] = { id: `seedask${i}`, ts, type: "sig_ask", actorId: "crA", actorRole: "creator", subjectId: "crA", market: "Nashville", data: { q, source: i === 0 ? "unavailable" : "data", cards: false, link: false, action: false } };
  });

  // Suggestion records: six open (acted during the run), one
  // manual kind, one already acted 8 days ago (window closed).
  seed["suggestion:waiting:creators"] = sugSeed("waiting:creators", "waiting", "ops.waiting", "ops", { count: 2, oldestDays: 1 });
  seed["suggestion:recruit:Nashville:Music"] = sugSeed("recruit:Nashville:Music", "recruit", "marketing.recruit_target", "marketing", { market: "Nashville", category: "Music", supply: 1, openOffers: 1, zeroSearches: 3, typedCityRequests: 0, recruitTarget: 3 }, { market: "Nashville", category: "Music" });
  seed["suggestion:gate:Austin"] = sugSeed("gate:Austin", "gate", "marketing.gate_watch", "marketing", { market: "Austin", creators: 3, gate: "50-60", thinnest: "Lifestyle", thinnestCount: 1 }, { market: "Austin" });
  seed["suggestion:cooling:crAct"] = sugSeed("cooling:crAct", "cooling", "engaging.creator_cooling", "engaging", { creator: "activy", market: "Nashville", daysQuiet: 40, signedUpDays: 40, applications: 0, profileComplete: "yes" }, { market: "Nashville", subjectId: "crAct" });
  seed["suggestion:quiet:offer:offq"] = sugSeed("quiet:offer:offq", "quiet", "engaging.business_quiet", "engaging", { business: "Main Kitchen", market: "Nashville", daysLive: 6, applications: 0 }, { market: "Nashville", subjectId: "offq" });
  seed["suggestion:curriculum:creator:pricing"] = sugSeed("curriculum:creator:pricing", "curriculum", "maggie.curriculum", "maggie", { role: "creator", topic: "pricing and money", asks: 10, unanswered: 6, fallback: 2 });
  seed["suggestion:pricing:Nashville:Restaurant"] = sugSeed("pricing:Nashville:Restaurant", "pricing", "pricing.budget_distribution", "pricing", { market: "Nashville", category: "Restaurant", offers: 4, median: 200, p25: 100, p75: 300, compSharePct: 10 }, { market: "Nashville" });
  seed["suggestion:cooling:crNever"] = sugSeed("cooling:crNever", "cooling", "engaging.creator_cooling", "engaging", { creator: "neverned", market: "Nashville", daysQuiet: 40, signedUpDays: 40, applications: 0, profileComplete: "yes" }, { market: "Nashville", subjectId: "crNever", status: "acted", actedAt: daysAgoIso(8), outcome: { actedAt: daysAgoIso(8), via: "door", route: "stats-creators" } });

  fs.writeFileSync(DB, JSON.stringify(seed));
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok -", name);
  else { failures++; console.log("  FAIL -", name, extra || ""); }
}
function readDb() { return JSON.parse(fs.readFileSync(DB, "utf8")); }
function readEvents(type) {
  const db = readDb();
  return Object.entries(db).filter(([k, v]) => k.startsWith("event:") && v && v.type === type).map(([, v]) => v);
}
function sugRecord(id) { return readDb()[`suggestion:${id}`] || null; }
function client() {
  const jar = new Map();
  return async (method, p, body, base) => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data, text };
  };
}
async function waitUp(base) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base + "/api/bootstrap"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

const PORT = 8963;
const base = `http://127.0.0.1:${PORT}`;
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: ROOT,
  env: {
    ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL: "jeff@joinsignl.com", ADMIN_PASSWORD: "verify-admin-pass-123", APP_URL: base, SIGNL_TEST_ALLOW_BUSINESS: "1",
    SIG_AI_BASE_URL: "", SIG_AI_API_KEY: "", OPENAI_API_KEY: "", OPENAI_BASE_URL: "", OPENROUTER_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "",
    MAGGIE_AI_ENABLED: "", MAGGIE_AI_MODEL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  check("fixture server boots (AI off)", await waitUp(base));
  const admin = client();
  const ra = await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "verify-admin-pass-123" }, base);
  check("admin signed in", ra.status === 200);
  const anon = client();
  const rAnonExp = await anon("GET", "/api/admin/stats/data/export?dataset=training_pairs&format=json", undefined, base);
  check("training export refuses the signed-out (401)", rAnonExp.status === 401, String(rAnonExp.status));
  const rAnonSweep = await anon("POST", "/api/admin/suggestions/outcomes/sweep", {}, base);
  check("outcome sweep refuses the signed-out (403)", rAnonSweep.status === 403 || rAnonSweep.status === 401, String(rAnonSweep.status));

  // ---------- training pairs: the join ----------
  console.log("== training pairs: impression -> pick -> delivery ==");
  const exp1 = await admin("GET", "/api/admin/stats/data/export?dataset=training_pairs&format=json", undefined, base);
  check("training_pairs export answers 200", exp1.status === 200, String(exp1.status));
  const rows = Array.isArray(exp1.data) ? exp1.data : [];
  check("9 rows (3 + 3 deduped + 2 + 1)", rows.length === 9, `saw ${rows.length}`);
  const row = (imp, cr) => rows.find((r) => r.impressionId === imp && r.creatorId === cr);
  const rA1 = row("imp1", "crA"), rB1 = row("imp1", "crB"), rC1 = row("imp1", "crC");
  check("campaign pick via booking: picked, stage booked, delivery on_time", !!rA1 && rA1.picked === 1 && rA1.pickStage === "booked" && rA1.delivery === "on_time" && rA1.offerId === "camp1" && rA1.joinVia === "campaign", JSON.stringify(rA1));
  check("campaign pick via application: picked, stage applied, no delivery yet", !!rB1 && rB1.picked === 1 && rB1.pickStage === "applied" && rB1.delivery === null, JSON.stringify(rB1));
  check("shown but not picked: picked 0, no stage, no delivery", !!rC1 && rC1.picked === 0 && rC1.pickStage === null && rC1.delivery === null, JSON.stringify(rC1));
  check("feature vector rides the row (formula parts, verbatim shape)", !!rA1 && rA1.features.localPct === 80 && rA1.features.category === 100 && rA1.features.reliabilityBasis === "neutral" && rA1.score === 88 && rA1.rank === 1 && rA1.shownCount === 3, JSON.stringify(rA1 && rA1.features));
  check("doubled shown row deduped (imp2 has 3 rows, not 4)", rows.filter((r) => r.impressionId === "imp2").length === 3, String(rows.filter((r) => r.impressionId === "imp2").length));
  const rD2 = row("imp2", "crD"), rG2 = row("imp2", "crG");
  check("selected + booked + late post: stage booked, delivery late", !!rD2 && rD2.picked === 1 && rD2.pickStage === "booked" && rD2.delivery === "late", JSON.stringify(rD2));
  check("selected, no booking: stage selected, delivery null", !!rG2 && rG2.picked === 1 && rG2.pickStage === "selected" && rG2.delivery === null, JSON.stringify(rG2));
  const rE3 = row("imp3", "crE"), rF3 = row("imp3", "crF");
  check("Find brief joins via sourceBrief: direct target picked, joinVia source_brief", !!rE3 && rE3.picked === 1 && rE3.pickStage === "direct" && rE3.joinVia === "source_brief" && rE3.offerId === "off2", JSON.stringify(rE3));
  check("sourceBrief offer's booking, window expired unused: delivery no_show", !!rF3 && rF3.picked === 1 && rF3.delivery === "no_show", JSON.stringify(rF3));
  const rA4 = row("imp4", "crA");
  check("campaign with no picks: row exists, picked 0", !!rA4 && rA4.picked === 0 && rA4.campaignId === "camp2", JSON.stringify(rA4));

  const exp2 = await admin("GET", "/api/admin/stats/data/export?dataset=training_pairs&format=json", undefined, base);
  check("re-export is byte-identical (deterministic, deduped)", JSON.stringify(exp2.data) === JSON.stringify(exp1.data));
  const expL = await admin("GET", "/api/admin/stats/data/export?dataset=training_pairs&format=jsonl", undefined, base);
  const jsonlLines = (expL.text || "").trim().split("\n").filter(Boolean);
  check("JSONL format: one parseable row per line", expL.status === 200 && jsonlLines.length === 9 && jsonlLines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), `${expL.status} / ${jsonlLines.length} lines`);

  const dv = await admin("GET", "/api/admin/stats/data?days=30", undefined, base);
  const tr = dv.data && dv.data.training;
  check("Data payload carries the training volume summary", !!tr && tr.rows === 9 && tr.impressions === 4 && tr.pickedRows === 7 && tr.labeledBriefs === 3 && tr.onTimeRows === 2 && tr.lateRows === 1 && tr.noShowRows === 1, JSON.stringify(tr));

  // ---------- suggestion outcomes ----------
  console.log("== suggestion outcome matching ==");
  const actIds = ["waiting:creators", "recruit:Nashville:Music", "gate:Austin", "cooling:crAct", "quiet:offer:offq", "curriculum:creator:pricing", "pricing:Nashville:Restaurant"];
  for (const id of actIds) {
    const r = await admin("POST", "/api/admin/suggestions/act", { id }, base);
    check(`act recorded for ${id}`, r.status === 200 && !!(sugRecord(id) || {}).outcome, `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
  }
  // The downstream facts land inside the window:
  const rv1 = await admin("POST", "/api/admin/review", { userId: "pendNash", decision: "approve" }, base);
  check("pending Nashville Music creator approved", rv1.status === 200, `${rv1.status} ${JSON.stringify(rv1.data).slice(0, 120)}`);
  const rv2 = await admin("POST", "/api/admin/review", { userId: "pendAustin", decision: "approve" }, base);
  check("pending Austin creator approved", rv2.status === 200, `${rv2.status} ${JSON.stringify(rv2.data).slice(0, 120)}`);
  const crActClient = client();
  const rl = await crActClient("POST", "/api/auth/login", { email: "act@fixtures.dev", password: SEED_PW }, base);
  check("cooling creator signed in", rl.status === 200, String(rl.status));
  const ask = await crActClient("POST", "/api/sig/ask", { q: "hello, what can you do?" }, base);
  check("cooling creator acts (asks Maggie)", ask.status === 200, `${ask.status} ${JSON.stringify(ask.data).slice(0, 120)}`);
  check("the ask was captured as the creator's own action", readEvents("sig_ask").some((e) => e.actorId === "crAct"), "");
  const crCClient = client();
  await crCClient("POST", "/api/auth/login", { email: "crc@fixtures.dev", password: SEED_PW }, base);
  const applied = await crCClient("POST", "/api/offers/offq/apply", {}, base);
  check("a creator applies to the starving offer", applied.status === 200 || applied.status === 201, `${applied.status} ${JSON.stringify(applied.data).slice(0, 120)}`);

  // The record seeded already-acted with a closed window was
  // stamped by the OPPORTUNISTIC preamble pass (it fires on the
  // first request after boot) — proof the ride-along path works
  // before the explicit sweep below ever runs.
  check("opportunistic pass already stamped the closed-window record", ((sugRecord("cooling:crNever") || {}).outcome || {}).status === "window_expired", JSON.stringify((sugRecord("cooling:crNever") || {}).outcome));

  const sweep1 = await admin("POST", "/api/admin/suggestions/outcomes/sweep", {}, base);
  const sw = (sweep1.data && sweep1.data.sweep) || {};
  check("explicit sweep checked the 6 just-acted evaluable records (manual kind skipped, expired one already terminal)", sweep1.status === 200 && sw.checked === 6, JSON.stringify(sw));
  check("explicit sweep: 6 achieved, 0 expired, 0 still waiting", sw.achieved === 6 && sw.expired === 0 && sw.notYet === 0, JSON.stringify(sw));
  const statusOf = (id) => (sugRecord(id) && sugRecord(id).outcome && sugRecord(id).outcome.status) || null;
  check("waiting achieved (queue drained 2 -> 0)", statusOf("waiting:creators") === "achieved", statusOf("waiting:creators") || "none");
  check("recruit achieved (Music supply 1 -> 2)", statusOf("recruit:Nashville:Music") === "achieved", statusOf("recruit:Nashville:Music") || "none");
  check("gate achieved (Austin bookable 3 -> 4)", statusOf("gate:Austin") === "achieved", statusOf("gate:Austin") || "none");
  check("cooling achieved (the named creator acted)", statusOf("cooling:crAct") === "achieved", statusOf("cooling:crAct") || "none");
  check("quiet achieved (the starving offer drew an application)", statusOf("quiet:offer:offq") === "achieved", statusOf("quiet:offer:offq") || "none");
  check("curriculum achieved (unanswered share fell below the receipt's)", statusOf("curriculum:creator:pricing") === "achieved", statusOf("curriculum:creator:pricing") || "none");
  check("window_expired stamped on the record whose 7 days already closed", statusOf("cooling:crNever") === "window_expired", statusOf("cooling:crNever") || "none");
  const pricingOutcome = (sugRecord("pricing:Nashville:Restaurant") || {}).outcome || {};
  check("manual kind (pricing) acted but NEVER stamped by the sweep", !!pricingOutcome.actedAt && !pricingOutcome.status, JSON.stringify(pricingOutcome));
  const outcomeEvents = readEvents("suggestion_outcome");
  check("suggestion_outcome events logged for the 7 terminal stamps", outcomeEvents.length === 7 && outcomeEvents.filter((e) => e.data && e.data.outcome === "achieved").length === 6 && outcomeEvents.filter((e) => e.data && e.data.outcome === "window_expired").length === 1, `saw ${outcomeEvents.length}`);
  const sweep2 = await admin("POST", "/api/admin/suggestions/outcomes/sweep", {}, base);
  const sw2 = (sweep2.data && sweep2.data.sweep) || {};
  check("second sweep is a no-op (terminal stamps hold)", sw2.checked === 0 && readEvents("suggestion_outcome").length === 7, JSON.stringify(sw2));

  // ---------- the harness, as a subprocess ----------
  console.log("== eval-ranker harness ==");
  const runHarness = (file) => spawnSync("node", ["scripts/eval-ranker.mjs", "--file", file], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  const tiny = path.join(os.tmpdir(), "phase3-tiny.jsonl");
  fs.writeFileSync(tiny, [
    { impressionId: "x1", creatorId: "a", ts: NOW_ISO, rank: 1, picked: 0, features: parts() },
    { impressionId: "x1", creatorId: "b", ts: NOW_ISO, rank: 2, picked: 1, features: parts({ localPct: 90 }) },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");
  const hTiny = runHarness(tiny);
  check("harness path (a): NOT ENOUGH DATA with exact counts on a tiny set", hTiny.status === 0 && hTiny.stdout.includes("NOT ENOUGH DATA") && hTiny.stdout.includes("1 picked outcomes across 1 briefs"), (hTiny.stdout || "").slice(-300));
  const realShaped = path.join(os.tmpdir(), "phase3-export.jsonl");
  fs.writeFileSync(realShaped, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const hReal = runHarness(realShaped);
  check("harness path (a) on the real-shaped export: 7 picks / 3 briefs, still honestly not enough", hReal.status === 0 && hReal.stdout.includes("NOT ENOUGH DATA") && hReal.stdout.includes("7 picked outcomes across 3 briefs"), (hReal.stdout || "").slice(-300));
  const hSynth = runHarness(path.join(ROOT, "scripts", "fixtures", "synthetic-training-pairs.jsonl"));
  check("harness path (b): trains and scores both models on the synthetic fixture", hSynth.status === 0 && hSynth.stdout.includes("hand formula") && hSynth.stdout.includes("learned (LR)") && hSynth.stdout.includes("VERDICT"), (hSynth.stdout || "").slice(-400));
  check("harness path (b): learned beats formula where the signal is real (synthetic DGP)", hSynth.stdout.includes("LEARNED BEATS FORMULA"), (hSynth.stdout || "").slice(-400));
  check("harness flags the synthetic file as synthetic", hSynth.stdout.includes("SYNTHETIC"), "");

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exitCode = failures ? 1 : 0;
} finally {
  server.kill("SIGTERM");
}
