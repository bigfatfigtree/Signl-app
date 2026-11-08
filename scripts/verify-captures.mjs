// Data captures verification (Data Audit 2026-11-07, Maggie
// build part 2 — Jeff: "Fold them into the Maggie build").
//
// Boots the fixture server with the Maggie AI flag OFF and fires
// each of the four capture types, then reads the event log back
// from the local store file and asserts payload shape:
//   1. match_impression — briefed Discover AND campaign matches:
//      brief fields + ranked creator ids with numeric scores and
//      score parts; one surface read = exactly one impression.
//   2. discover_search — filters + result count, and the
//      zero-result flag on an empty search.
//   3. sig_ask — source "data" for a fact answer, source
//      "screen" for a privacy-screen refusal.
//   4. deck_later / deck_unlater / deck_hide / deck_unhide —
//      fired beside the deckstate write.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = fs.mkdtempSync("/tmp/signl-captures-") + "/db.json";
const SEED_PW = "verify-captures-pass";
const SEED_SALT = "verifycapturessalt";
const SEED_HASH = crypto.scryptSync(SEED_PW, SEED_SALT, 64).toString("hex");
function creatorSeed(id, email, name, handle, market, localPct, total, rate) {
  return {
    id, role: "creator", email, name, passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: "approved", market, city: market, createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", tester: false,
    creator: { handle, platform: "Instagram", handleNormalized: handle, city: market, state: "TN", neighborhood: "Downtown", categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", audienceStack: { instagram: total }, totalAudience: total, followerCount: total, localAudiencePct: localPct, paidRate: rate, compOpen: true, couponOpen: true, profileComplete: true, publicPage: true, bio: `${name}, daily.` },
  };
}
{
  const seed = {};
  seed["config:markets"] = { flags: { Nashville: true, Austin: true } };
  seed["user:bizactive"] = { id: "bizactive", role: "business", email: "active@fixtures.dev", name: "Active Owner", passwordHash: SEED_HASH, passwordSalt: SEED_SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", tester: false, businessOnboarded: true, business: { businessName: "Active Kitchen", legalName: "Active Kitchen LLC", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Seeded active business." } };
  seed["email:active@fixtures.dev"] = { userId: "bizactive" };
  seed["user:craustin"] = creatorSeed("craustin", "austin@fixtures.dev", "Austin Eats", "austineats", "Austin", 85, 8000, 150);
  seed["user:crnash1"] = creatorSeed("crnash1", "nash1@fixtures.dev", "Nash Food One", "nashfoodone", "Nashville", 88, 12000, 150);
  seed["user:crnash2"] = creatorSeed("crnash2", "nash2@fixtures.dev", "Nash Eats Two", "nasheatstwo", "Nashville", 70, 9000, 300);
  seed["email:austin@fixtures.dev"] = { userId: "craustin" };
  seed["email:nash1@fixtures.dev"] = { userId: "crnash1" };
  seed["email:nash2@fixtures.dev"] = { userId: "crnash2" };
  seed["offer:offer1"] = { id: "offer1", businessId: "bizactive", market: "Nashville", category: "Restaurant", kind: "paid", cashRate: 200, title: "Taco Tuesday launch", status: "open", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
  fs.writeFileSync(DB, JSON.stringify(seed));
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok -", name);
  else { failures++; console.log("  FAIL -", name, extra || ""); }
}
function readEvents(type) {
  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  return Object.entries(db)
    .filter(([k, v]) => k.startsWith("event:") && v && v.type === type)
    .map(([, v]) => v)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
}
function client() {
  const jar = new Map();
  return async (method, p, body, base) => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  };
}
async function waitUp(base) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base + "/api/bootstrap"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

const PORT = 8953;
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
  const biz = client();
  const rb = await biz("POST", "/api/auth/login", { email: "active@fixtures.dev", password: SEED_PW }, base);
  check("business signed in", rb.status === 200, JSON.stringify(rb.data).slice(0, 160));
  const admin = client();
  const ra = await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "verify-admin-pass-123" }, base);
  check("admin signed in", ra.status === 200);
  const creator = client();
  const rc = await creator("POST", "/api/auth/login", { email: "nash1@fixtures.dev", password: SEED_PW }, base);
  check("creator signed in", rc.status === 200);

  // ---------- 1 + 2. Briefed discover: match_impression + discover_search ----------
  console.log("== captures 1+2: briefed discover ==");
  const disc = await biz("GET", "/api/discover?market=Nashville&sort=match&budget=200&category=" + encodeURIComponent("Food & Drink"), undefined, base);
  check("briefed discover answers 200 with a resolved brief", disc.status === 200 && !!disc.data.matchBrief, JSON.stringify(disc.data).slice(0, 200));
  check("briefed discover cards carry matchScore", Array.isArray(disc.data.creators) && disc.data.creators.length >= 2 && disc.data.creators.every((c) => typeof c.matchScore === "number"), JSON.stringify(disc.data.creators || []).slice(0, 200));

  const impressions = readEvents("match_impression").filter((e) => e.data && e.data.via === "discover");
  check("exactly one discover match_impression logged", impressions.length === 1, `saw ${impressions.length}`);
  const imp = impressions[0] || { data: {} };
  check("impression brief carries market/category/kind/budget/source", imp.data.brief && imp.data.brief.market === "Nashville" && imp.data.brief.category === "Food & Drink" && imp.data.brief.kind === "paid" && Number(imp.data.brief.budget) === 200 && imp.data.brief.source === "filters", JSON.stringify(imp.data.brief));
  check("impression actor is the viewing business", imp.actorId === "bizactive" && imp.actorRole === "business", JSON.stringify({ a: imp.actorId, r: imp.actorRole }));
  const shown = Array.isArray(imp.data.shown) ? imp.data.shown : [];
  check("impression shown lists the ranked creators", shown.length >= 2 && shown.every((s) => typeof s.creatorId === "string" && s.creatorId), JSON.stringify(shown).slice(0, 200));
  check("impression shown scores are numeric with parts objects", shown.length >= 2 && shown.every((s) => typeof s.score === "number" && s.parts && typeof s.parts === "object" && typeof s.parts.localPct === "number"), JSON.stringify(shown).slice(0, 300));
  // ML-ready (Jeff, 2026-11-08): the FULL feature vector rides per
  // ranked creator, not just the total — the exact components a
  // learned ranker later trains on.
  const FEATURES = ["localPct", "category", "budget", "reliability", "momentum", "trackBonus"];
  check("impression shown carries the full ML feature vector per creator", shown.length >= 2 && shown.every((s) => s.parts && FEATURES.every((f) => typeof s.parts[f] === "number")), JSON.stringify(shown.length ? shown[0].parts : null));
  check("impression shown order matches the response order", shown.map((s) => s.creatorId).join(",") === (disc.data.creators || []).map((c) => c.userId).join(","), `${shown.map((s) => s.creatorId)} vs ${(disc.data.creators || []).map((c) => c.userId)}`);

  const searches = readEvents("discover_search");
  check("one discover_search logged for the briefed search", searches.length === 1, `saw ${searches.length}`);
  const s0 = searches[0] || { data: {} };
  check("discover_search carries the filters as sent", s0.data.filters && s0.data.filters.market === "Nashville" && s0.data.filters.sort === "match" && s0.data.filters.budget === "200", JSON.stringify(s0.data.filters));
  check("discover_search resultCount matches the response, zeroResults false", s0.data.resultCount === (disc.data.creators || []).length && s0.data.zeroResults === false, JSON.stringify(s0.data));

  // ---------- 2b. Zero-result search ----------
  console.log("== capture 2: zero-result search ==");
  const zero = await biz("GET", "/api/discover?market=Nashville&category=" + encodeURIComponent("Underwater Basket Weaving"), undefined, base);
  check("zero-result search answers 200 with no creators", zero.status === 200 && Array.isArray(zero.data.creators) && zero.data.creators.length === 0, JSON.stringify(zero.data).slice(0, 160));
  const searches2 = readEvents("discover_search");
  const sz = searches2[searches2.length - 1] || { data: {} };
  check("zero-result discover_search carries zeroResults true and resultCount 0", searches2.length === 2 && sz.data.zeroResults === true && sz.data.resultCount === 0, JSON.stringify(sz.data));

  // ---------- 1b. Campaign matches impression ----------
  console.log("== capture 1: campaign matches ==");
  const m = await biz("GET", "/api/offers/offer1/matches", undefined, base);
  check("campaign matches answers 200 with matches", m.status === 200 && Array.isArray(m.data.matches) && m.data.matches.length >= 2, JSON.stringify(m.data).slice(0, 200));
  check("campaign matches carry numeric matchScore", (m.data.matches || []).every((c) => typeof c.matchScore === "number"), JSON.stringify(m.data.matches || []).slice(0, 200));
  const campImps = readEvents("match_impression").filter((e) => e.data && e.data.via === "campaign_matches");
  check("exactly one campaign_matches impression (no double log from discoverCards)", campImps.length === 1, `saw ${campImps.length}`);
  const ci = campImps[0] || { data: {} };
  check("campaign impression brief is the offer (source campaign, campaignId, budget)", ci.data.brief && ci.data.brief.source === "campaign" && ci.data.brief.campaignId === "offer1" && Number(ci.data.brief.budget) === 200 && ci.subjectId === "offer1", JSON.stringify(ci.data.brief));
  const cShown = Array.isArray(ci.data.shown) ? ci.data.shown : [];
  check("campaign impression shown ids match the response matches in order", cShown.map((s) => s.creatorId).join(",") === (m.data.matches || []).map((c) => c.userId).join(","), `${cShown.map((s) => s.creatorId)} vs ${(m.data.matches || []).map((c) => c.userId)}`);
  check("campaign impression scores numeric, ranked best first", cShown.length >= 2 && cShown.every((s) => typeof s.score === "number") && cShown.every((s, i) => i === 0 || cShown[i - 1].score >= s.score), JSON.stringify(cShown).slice(0, 200));
  check("campaign impression shown carries the full ML feature vector per creator", cShown.length >= 2 && cShown.every((s) => s.parts && FEATURES.every((f) => typeof s.parts[f] === "number")), JSON.stringify(cShown.length ? cShown[0].parts : null));

  // ---------- 3. sig_ask: data answer + screened refusal ----------
  console.log("== capture 3: sig_ask sources ==");
  const askData = await admin("POST", "/api/sig/ask", { q: "How many creators are in Nashville?" }, base);
  check("admin count ask answered from data", askData.status === 200 && askData.data.source === "data" && /creators?/.test(askData.data.text || ""), JSON.stringify(askData.data).slice(0, 200));
  const askScreen = await creator("POST", "/api/sig/ask", { q: "how many followers does @austineats have?" }, base);
  check("cross-account ask refused (payload source data)", askScreen.status === 200 && askScreen.data.source === "data" && /only see your own/.test(askScreen.data.text || ""), JSON.stringify(askScreen.data).slice(0, 200));
  const asks = readEvents("sig_ask");
  const dataAsk = asks.find((e) => e.data && e.data.source === "data" && /How many creators/.test(e.data.q || ""));
  check("sig_ask logged the data answer with source data, role and question text", !!dataAsk && dataAsk.actorRole === "admin" && dataAsk.data.cards === false, JSON.stringify(dataAsk || {}).slice(0, 240));
  const screenAsk = asks.find((e) => e.data && e.data.source === "screen");
  check("sig_ask logged the screened refusal with source screen", !!screenAsk && screenAsk.actorRole === "creator" && /austineats/.test(screenAsk.data.q || ""), JSON.stringify(screenAsk || {}).slice(0, 240));

  // ---------- 4. Deck events ----------
  console.log("== capture 4: deck events ==");
  for (const action of ["later", "unlater", "hide", "unhide"]) {
    const r = await biz("POST", "/api/deck-state", { deck: "discover", action, itemId: "crnash1" }, base);
    check(`deck-state ${action} answers 200`, r.status === 200, JSON.stringify(r.data).slice(0, 120));
  }
  for (const type of ["deck_later", "deck_unlater", "deck_hide", "deck_unhide"]) {
    const evs = readEvents(type).filter((e) => e.subjectId === "crnash1");
    check(`${type} logged once, subject = the card, deck named`, evs.length === 1 && evs[0].actorId === "bizactive" && evs[0].data.deck === "discover" && evs[0].data.itemId === "crnash1", `saw ${evs.length}: ${JSON.stringify(evs).slice(0, 200)}`);
  }

  // ---------- 5. Outcome linkage: sourceBrief on created offers ----------
  console.log("== linkage: sourceBrief persistence ==");
  const created = await biz("POST", "/api/offers", { title: "Briefed direct invite", whatComped: "Dinner for two", kind: "paid", cashRate: 200, spots: 1, creatorId: "crnash2", sourceBrief: { source: "filters", market: "Nashville", category: "Food & Drink", kind: "paid", budget: 200 } }, base);
  check("offer created from a briefed context (201)", created.status === 201 && created.data.offer && created.data.offer.id, JSON.stringify(created.data).slice(0, 200));
  const readOffer = (id) => JSON.parse(fs.readFileSync(DB, "utf8"))[`offer:${id}`];
  const o1 = created.data.offer ? readOffer(created.data.offer.id) : null;
  check("offer record persists sourceBrief (market/category/kind/budget/source)", !!o1 && !!o1.sourceBrief && o1.sourceBrief.source === "filters" && o1.sourceBrief.market === "Nashville" && o1.sourceBrief.category === "Food & Drink" && o1.sourceBrief.kind === "paid" && Number(o1.sourceBrief.budget) === 200, JSON.stringify(o1 && o1.sourceBrief));
  const plain = await biz("POST", "/api/offers", { title: "Unbriefed direct invite", whatComped: "Dinner for two", kind: "paid", cashRate: 200, spots: 1, creatorId: "crnash1" }, base);
  check("offer created without a brief (201)", plain.status === 201 && plain.data.offer && plain.data.offer.id, JSON.stringify(plain.data).slice(0, 200));
  const o2 = plain.data.offer ? readOffer(plain.data.offer.id) : null;
  check("offer without a brief stores no sourceBrief (nothing inferred)", !!o2 && !("sourceBrief" in o2), JSON.stringify(o2 && Object.keys(o2)));

  // ---------- Read-back summary (the proof output) ----------
  console.log("== read-back samples ==");
  for (const t of ["match_impression", "discover_search", "sig_ask", "deck_later"]) {
    const rows = readEvents(t);
    if (rows.length) console.log(`  ${t}:`, JSON.stringify(rows[rows.length - 1]).slice(0, 420));
  }
} finally {
  server.kill("SIGTERM");
}

console.log(failures === 0 ? "verify-captures: ALL PASS" : `verify-captures: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
