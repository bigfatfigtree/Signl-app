// Decision Reports as Admin Suggestions (Build -146; spec
// 2026-11-08 §3 Phase 1 reports + §5 mature Suggestions model)
// plus the folded -145 remainder (Discover-grid brief threading
// through the Book path: startOffer -> deal -> materialized
// offer).
//
// Boots the fixture server with the Maggie AI flag OFF and
// proves, reading the local store file back:
//   - persisted suggestion:{id} records with the full lifecycle
//     (shown on surfacing, dismissed binds to the receipt
//     fingerprint, resurface when the numbers move, acted via
//     the door, expired when the candidate vanishes), the ~10
//     open cap with refill, and the lifecycle events;
//   - every Phase 1 kind from fixtures with real numbers: M1
//     recruiting targets (composite; the plain gap/search cards
//     for the same cell are superseded), M3 gate watch in all
//     three states (approaching / blocked on balance / cleared)
//     with Raleigh-and-Charlotte-style per-market separation,
//     P1 offered-budget distribution, P2 budget-vs-rate gap
//     (inputs only), E1 cooling creators (named stall), E2
//     quiet businesses (starving offer + dormant business),
//     C3 Maggie's curriculum clusters, and the v1 kinds riding
//     the same records;
//   - grid brief threading at the API level: POST /deals with a
//     brief stores sourceBrief on the deal (label dropped), the
//     offer materialized on acceptance carries it, and a
//     brief-less deal stores NO sourceBrief — never inferred.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = fs.mkdtempSync("/tmp/signl-decision-") + "/db.json";
const SEED_PW = "verify-decision-pass";
const SEED_SALT = "verifydecisionsalt";
const SEED_HASH = crypto.scryptSync(SEED_PW, SEED_SALT, 64).toString("hex");
const TODAY = new Date().toISOString().slice(0, 10);
const NOW_ISO = new Date().toISOString();
const daysAgoIso = (d) => new Date(Date.now() - d * 86400000).toISOString();

function creatorSeed(id, email, name, handle, market, opts = {}) {
  const cats = opts.categories || ["Food & Drink"];
  return {
    id, role: "creator", email, name, passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: opts.status || "approved", market, city: opts.city || market, state: opts.state || "TN",
    createdAt: opts.createdAt || "2026-09-02T00:00:00.000Z", updatedAt: opts.updatedAt || "2026-09-02T00:00:00.000Z", tester: false,
    creator: { handle, platform: "Instagram", handleNormalized: handle, city: opts.city || market, state: opts.state || "TN", categories: cats, compCategories: ["Restaurant meals"], tierBand: "Locals", audienceStack: { instagram: opts.total || 9000 }, totalAudience: opts.total || 9000, followerCount: opts.total || 9000, localAudiencePct: opts.localPct == null ? 75 : opts.localPct, paidRate: opts.rate == null ? 150 : opts.rate, compOpen: true, couponOpen: true, profileComplete: true, publicPage: true, bio: `${name}, daily.` },
  };
}
function bizSeed(id, email, name, bizName, market, opts = {}) {
  return {
    id, role: "business", email, name, passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: opts.status || "approved", market, city: market, createdAt: opts.createdAt || "2026-09-01T00:00:00.000Z", updatedAt: opts.updatedAt || "2026-09-01T00:00:00.000Z", tester: false, businessOnboarded: true,
    business: { businessName: bizName, legalName: `${bizName} LLC`, category: opts.category || "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Seeded business." },
  };
}
{
  const seed = {};
  seed["config:markets"] = { flags: { Nashville: true, Austin: true, Chicago: true, Denver: true, Seattle: true, Dallas: true } };
  // Production state: the one-time recruiter-kit sweep already
  // ran long ago, so it never re-fires (and never stamps the
  // seeded creators' records) inside the fixture.
  seed["config:recruiterKitEmailV1Sent"] = { version: 1, claimedAt: "2026-10-20T00:00:00.000Z", completedAt: "2026-10-20T00:00:00.000Z", recipients: [] };
  const put = (u) => { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; };
  put(bizSeed("bizactive", "active@fixtures.dev", "Active Owner", "Active Kitchen", "Nashville"));
  put(bizSeed("bizdormant", "dormant@fixtures.dev", "Dormant Owner", "Dormant Donuts", "Nashville", { createdAt: daysAgoIso(20), updatedAt: daysAgoIso(20) }));
  // Nashville roster: two Food & Drink (fresh), two Fitness
  // (fresh, rate 400 -> the P2 benchmark), one stale Food
  // creator (the E1 stall), one pending (the v1 waiting card).
  put(creatorSeed("crnash1", "nash1@fixtures.dev", "Nash Food One", "nashfoodone", "Nashville", { localPct: 88, total: 12000, rate: 150, createdAt: daysAgoIso(30), updatedAt: NOW_ISO }));
  put(creatorSeed("crnash2", "nash2@fixtures.dev", "Nash Eats Two", "nashfoodtwo", "Nashville", { localPct: 70, total: 9000, rate: 300, createdAt: daysAgoIso(30), updatedAt: NOW_ISO }));
  put(creatorSeed("crfit1", "fit1@fixtures.dev", "Nash Fit One", "nashfitone", "Nashville", { categories: ["Fitness & Wellness"], rate: 400, createdAt: daysAgoIso(30), updatedAt: NOW_ISO }));
  put(creatorSeed("crfit2", "fit2@fixtures.dev", "Nash Fit Two", "nashfittwo", "Nashville", { categories: ["Fitness & Wellness"], rate: 400, createdAt: daysAgoIso(30), updatedAt: NOW_ISO }));
  put(creatorSeed("crquiet", "quiet@fixtures.dev", "Quiet Quinn", "quietquinn", "Nashville", { rate: 250, createdAt: daysAgoIso(40), updatedAt: daysAgoIso(40) }));
  put(creatorSeed("crpending1", "pend1@fixtures.dev", "Pending One", "pendingone", "Nashville", { status: "pending", createdAt: daysAgoIso(2), updatedAt: daysAgoIso(2) }));
  // Gate fixtures: Austin approaching (47 bookable, thinnest
  // Lifestyle 8), Chicago blocked on balance (52 bookable,
  // Fitness & Wellness 0), Denver cleared (55, every launch
  // category at the floor of 10).
  const gateSeeds = [
    ["Austin", "atx", [["Food & Drink", 12], ["Fitness & Wellness", 10], ["Beauty & Grooming", 9], ["Lifestyle", 8], ["Nightlife", 8]]],
    ["Chicago", "chi", [["Food & Drink", 20], ["Beauty & Grooming", 12], ["Lifestyle", 10], ["Nightlife", 10]]],
    ["Denver", "den", [["Food & Drink", 15], ["Fitness & Wellness", 10], ["Beauty & Grooming", 10], ["Lifestyle", 10], ["Nightlife", 10]]],
  ];
  for (const [market, prefix, dist] of gateSeeds) {
    let n = 0;
    for (const [cat, count] of dist) {
      for (let i = 0; i < count; i++) {
        n += 1;
        const id = `cr${prefix}${n}`;
        put(creatorSeed(id, `${id}@fixtures.dev`, `${market} Creator ${n}`, `${prefix}creator${n}`, market, { categories: [cat], createdAt: daysAgoIso(10), updatedAt: NOW_ISO }));
      }
    }
  }
  const offer = (id, market, category, kind, extra) => { seed[`offer:${id}`] = { id, businessId: "bizactive", businessName: "Active Kitchen", market, category, kind, title: id, status: "open", createdAt: NOW_ISO, updatedAt: NOW_ISO, ...(extra || {}) }; };
  // P1: four paid Restaurant offers in Nashville ($100-$400).
  offer("offp1a", "Nashville", "Restaurant", "paid", { cashRate: 100 });
  offer("offp1b", "Nashville", "Restaurant", "paid", { cashRate: 200, title: "Starving Tacos", createdAt: daysAgoIso(6), updatedAt: daysAgoIso(6) });
  offer("offp1c", "Nashville", "Restaurant", "paid", { cashRate: 300 });
  offer("offp1d", "Nashville", "Restaurant", "paid", { cashRate: 400 });
  // P2 + M1 demand: three paid Fitness Studio offers at $150
  // against a $400 median listed fitness rate.
  offer("offp2a", "Nashville", "Fitness Studio", "paid", { cashRate: 150 });
  offer("offp2b", "Nashville", "Fitness Studio", "paid", { cashRate: 150 });
  offer("offp2c", "Nashville", "Fitness Studio", "paid", { cashRate: 150 });
  // M1 composite cell (Seattle): one open offer, no creators.
  offer("offsea", "Seattle", "Restaurant", "paid", { cashRate: 200, createdAt: daysAgoIso(2), updatedAt: daysAgoIso(2) });
  // Plain v1 gap cell (Dallas): demand, no supply, no searches.
  offer("offdal", "Dallas", "Restaurant", "paid", { cashRate: 200, createdAt: daysAgoIso(2), updatedAt: daysAgoIso(2) });
  seed["cityrequest:req1"] = { city: "Franklin", region: "TN", handle: "franklinfoodie", createdAt: "2026-11-01T00:00:00.000Z" };
  // C3 corpus: four creator asks about pricing that Maggie
  // could not really answer (2 unavailable + 2 fallback), and
  // two business asks about licensing (below the cluster bar).
  const ask = (n, role, actor, q, source) => {
    seed[`event:${TODAY}:seedask${n}`] = { id: `seedask${n}`, ts: NOW_ISO, type: "sig_ask", actorId: actor, actorRole: role, subjectId: actor, market: "Nashville", data: { q, source, cards: false, link: false, action: false } };
  };
  ask(1, "creator", "crnash1", "how much should I charge for a post?", "unavailable");
  ask(2, "creator", "crnash2", "what do businesses pay around here?", "unavailable");
  ask(3, "creator", "crfit1", "is my rate too low for this market?", "convo");
  ask(4, "creator", "crfit2", "what does a campaign cost a business?", "convo");
  ask(5, "business", "bizactive", "how does the license work?", "unavailable");
  ask(6, "business", "bizactive", "can they repost my content?", "convo");
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
    return { status: res.status, data };
  };
}
async function waitUp(base) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base + "/api/bootstrap"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

const PORT = 8958;
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
  const biz = client();
  const rb = await biz("POST", "/api/auth/login", { email: "active@fixtures.dev", password: SEED_PW }, base);
  check("business signed in", rb.status === 200, JSON.stringify(rb.data).slice(0, 160));
  const anon = client();
  const rAnon = await anon("GET", "/api/admin/suggestions", undefined, base);
  check("suggestions refuse the signed-out (401)", rAnon.status === 401, String(rAnon.status));

  // Demand on tape: fruitless searches for the two composite
  // cells (Seattle genuinely empty; Nashville fitness emptied
  // by an impossible follower floor).
  for (let i = 0; i < 3; i++) await biz("GET", "/api/discover?market=Seattle&category=" + encodeURIComponent("Food & Drink"), undefined, base);
  for (let i = 0; i < 3; i++) await biz("GET", "/api/discover?market=Nashville&category=" + encodeURIComponent("Fitness & Wellness") + "&followersMin=500000", undefined, base);
  const zs = readEvents("discover_search").filter((e) => e.data && e.data.zeroResults);
  check("six zero-result searches captured", zs.length === 6, `saw ${zs.length}`);

  // ---------- Board 1: every kind computes, cap holds ----------
  console.log("== board 1: candidates, records, cap ==");
  const g1 = await admin("GET", "/api/admin/suggestions", undefined, base);
  check("suggestions answer 200 with an as-of stamp, template text (AI off)", g1.status === 200 && !!g1.data.generatedAt && g1.data.phrased === false, JSON.stringify(g1.data).slice(0, 160));
  const board1 = g1.data.suggestions || [];
  const ids1 = board1.map((s) => s.id);
  check("the board caps at 10 open", board1.length === 10, `saw ${board1.length}: ${ids1.join(" | ")}`);
  check("v1 waiting kind rides the records", ids1.includes("waiting:creators"), ids1.join(" | "));
  const gateAustin = board1.find((s) => s.id === "gate:Austin");
  check("M3 approaching: Austin gate card on the board", !!gateAustin, ids1.join(" | "));
  check("M3 math: 47 of 50, 3 needed, Lifestyle thinnest at 8", !!gateAustin && gateAustin.receipt.creators === 47 && gateAustin.receipt.needed === 3 && gateAustin.receipt.thinnest === "Lifestyle" && gateAustin.receipt.thinnestCount === 8, JSON.stringify(gateAustin && gateAustin.receipt));
  check("M3 door: the gate card routes to the market's roster", !!gateAustin && !!gateAustin.action && gateAustin.action.route === "stats-creators" && gateAustin.action.params.market === "Austin", JSON.stringify(gateAustin && gateAustin.action));
  const gateChicago = board1.find((s) => s.id === "gate:Chicago");
  check("M3 blocked: Chicago has the numbers, Fitness & Wellness thin at 0, 10 needed", !!gateChicago && gateChicago.receipt.creators === 52 && gateChicago.receipt.thinnest === "Fitness & Wellness" && gateChicago.receipt.needed === 10, JSON.stringify(gateChicago && gateChicago.receipt));
  const gateDenver = board1.find((s) => s.id === "gate:Denver");
  check("M3 cleared: Denver clears its gate (55, balanced)", !!gateDenver && gateDenver.receipt.creators === 55 && /clears its business gate/.test(gateDenver.text), JSON.stringify(gateDenver && gateDenver.receipt));
  check("M3 separation: no Nashville gate card (5 bookable, nowhere near)", !ids1.some((i) => i === "gate:Nashville"), ids1.join(" | "));
  const recNash = board1.find((s) => s.id === "recruit:Nashville:Fitness & Wellness");
  check("M1 composite: Nashville fitness recruit target on the board", !!recNash, ids1.join(" | "));
  check("M1 receipts: supply 2, 3 open offers, 3 zero searches, target 3, 1 typed-city request for the market", !!recNash && recNash.receipt.supply === 2 && recNash.receipt.openOffers === 3 && recNash.receipt.zeroSearches === 3 && recNash.receipt.recruitTarget === 3 && recNash.receipt.typedCityRequests === 1, JSON.stringify(recNash && recNash.receipt));
  check("M1 composite supersedes the plain funnel card for its cell", !ids1.some((i) => i.startsWith("search:")), ids1.join(" | "));
  const recSea = board1.find((s) => s.id === "recruit:Seattle:Food & Drink");
  check("M1 composite: Seattle recruit target present, plain Seattle gap superseded", !!recSea && !ids1.includes("gap:Seattle:Food & Drink"), ids1.join(" | "));
  check("plain v1 gap still fires where no composite exists (Dallas)", ids1.includes("gap:Dallas:Food & Drink"), ids1.join(" | "));
  const cool = board1.find((s) => s.id === "cooling:crquiet");
  check("E1: the stale creator is named with the stall", !!cool && cool.receipt.daysQuiet >= 39 && cool.receipt.daysQuiet <= 41 && cool.receipt.applications === 0 && /gone quiet/.test(cool.text), JSON.stringify(cool && cool.receipt));
  check("E1: fresh creators are not flagged", !ids1.includes("cooling:crfit1") && !ids1.includes("cooling:crnash2"), ids1.join(" | "));
  check("E2: the starving offer and the dormant business both surface", ids1.some((i) => i.startsWith("quiet:offer:")) && ids1.includes("quiet:biz:bizdormant"), ids1.join(" | "));
  const recKeys = Object.keys(readDb()).filter((k) => k.startsWith("suggestion:"));
  check("a persisted record exists for every candidate (14), incl. the ones the cap holds back", recKeys.length === 14, `saw ${recKeys.length}: ${recKeys.join(" | ")}`);
  const recPricing = sugRecord("pricing:Nashville:Restaurant");
  check("P1 record: median offered $250 across the 4 Restaurant offers (p25 100, p75 300)", !!recPricing && recPricing.receipt.median === 250 && recPricing.receipt.offers === 4 && recPricing.receipt.p25 === 100 && recPricing.receipt.p75 === 300, JSON.stringify(recPricing && recPricing.receipt));
  const recGap = sugRecord("pricinggap:Nashville:Fitness & Wellness");
  check("P2 record: median offer $150 vs median listed rate $400", !!recGap && recGap.receipt.medianOffer === 150 && recGap.receipt.medianCreatorRate === 400, JSON.stringify(recGap && recGap.receipt));
  const recCurr = sugRecord("curriculum:creator:pricing");
  check("C3 record: creator pricing cluster, 4 asks, 2 unanswered, 2 fallback", !!recCurr && recCurr.receipt.asks === 4 && recCurr.receipt.unanswered === 2 && recCurr.receipt.fallback === 2, JSON.stringify(recCurr && recCurr.receipt));
  check("C3: the two-ask licensing cluster stays under the bar", !sugRecord("curriculum:business:licensing"), "");
  const recGate = sugRecord("gate:Austin");
  check("records carry the spec shape: receipts array, action door, lifecycle stamps", !!recGate && Array.isArray(recGate.receipts) && recGate.receipts.some((r) => r.label === "creators" && r.value === 47) && recGate.status === "open" && !!recGate.shownAt && !!recGate.createdAt && !!recGate.expiresAt && recGate.timesSurfaced === 1, JSON.stringify(recGate).slice(0, 300));
  check("suggestion_shown logged once per candidate", readEvents("suggestion_shown").length === 14, `saw ${readEvents("suggestion_shown").length}`);

  // ---------- Expiry: the stall resolves, the record closes ----------
  console.log("== lifecycle: expiry ==");
  const creator = client();
  const rcq = await creator("POST", "/api/auth/login", { email: "quiet@fixtures.dev", password: SEED_PW }, base);
  check("stale creator signed in", rcq.status === 200);
  const patch = await creator("PATCH", "/api/me/profile", { bio: "Back at it." }, base);
  check("the creator touches their profile (activity resumes)", patch.status === 200, JSON.stringify(patch.data).slice(0, 120));
  const g2 = await admin("GET", "/api/admin/suggestions", undefined, base);
  const ids2 = (g2.data.suggestions || []).map((s) => s.id);
  check("the cooling card leaves the board", !ids2.includes("cooling:crquiet"), ids2.join(" | "));
  check("its record is expired, not deleted", (sugRecord("cooling:crquiet") || {}).status === "expired", JSON.stringify(sugRecord("cooling:crquiet")).slice(0, 160));
  check("the board refills from the held candidates (P2 surfaces)", ids2.includes("pricinggap:Nashville:Fitness & Wellness"), ids2.join(" | "));

  // ---------- Dismiss binds to the numbers; moving them resurfaces ----------
  console.log("== lifecycle: dismiss -> suppress -> resurface ==");
  const dis = await admin("POST", "/api/admin/suggestions/dismiss", { id: "recruit:Nashville:Fitness & Wellness" }, base);
  check("dismiss answers ok", dis.status === 200 && dis.data.ok === true, JSON.stringify(dis.data).slice(0, 120));
  const g3 = await admin("GET", "/api/admin/suggestions", undefined, base);
  check("dismissed recruit card stays off the board", !(g3.data.suggestions || []).some((s) => s.id === "recruit:Nashville:Fitness & Wellness"), "");
  const disRec = sugRecord("recruit:Nashville:Fitness & Wellness");
  check("the dismissal is on the record, bound to the receipt fingerprint", !!disRec && disRec.status === "dismissed" && !!disRec.dismissedAt && disRec.dismissedFingerprint === disRec.fingerprint, JSON.stringify(disRec).slice(0, 200));
  check("suggestion_dismissed logged", readEvents("suggestion_dismissed").length === 1, `saw ${readEvents("suggestion_dismissed").length}`);
  await biz("GET", "/api/discover?market=Nashville&category=" + encodeURIComponent("Fitness & Wellness") + "&followersMin=500000", undefined, base);
  const g4 = await admin("GET", "/api/admin/suggestions", undefined, base);
  const recBack = (g4.data.suggestions || []).find((s) => s.id === "recruit:Nashville:Fitness & Wellness");
  check("a fourth fruitless search moves the numbers and the card resurfaces (zeroSearches 4)", !!recBack && recBack.receipt.zeroSearches === 4, JSON.stringify(recBack && recBack.receipt));
  check("the resurface is a fresh showing (timesSurfaced 2, shown event marked resurfaced)", (sugRecord("recruit:Nashville:Fitness & Wellness") || {}).timesSurfaced === 2 && readEvents("suggestion_shown").some((e) => e.data && e.data.key === "recruit:Nashville:Fitness & Wellness" && e.data.resurfaced === true), "");

  // ---------- Act: the door records the taking ----------
  console.log("== lifecycle: acted ==");
  const act = await admin("POST", "/api/admin/suggestions/act", { id: "gate:Austin" }, base);
  check("act answers ok", act.status === 200 && act.data.ok === true, JSON.stringify(act.data).slice(0, 120));
  const actRec = sugRecord("gate:Austin");
  check("the record is acted, with the outcome stamp (via the door, its route)", !!actRec && actRec.status === "acted" && !!actRec.actedAt && !!actRec.outcome && actRec.outcome.via === "door" && actRec.outcome.route === "stats-creators", JSON.stringify(actRec && actRec.outcome));
  check("suggestion_acted logged", readEvents("suggestion_acted").length === 1, `saw ${readEvents("suggestion_acted").length}`);
  const g5 = await admin("GET", "/api/admin/suggestions", undefined, base);
  check("an acted card stays off the board while its numbers stand", !(g5.data.suggestions || []).some((s) => s.id === "gate:Austin"), "");

  // ---------- Refill: the held kinds render once room frees ----------
  console.log("== board refill: pricing + curriculum render ==");
  for (const id of ["waiting:creators", "gate:Denver", "gate:Chicago", "recruit:Seattle:Food & Drink", "recruit:Nashville:Fitness & Wellness", "gap:Dallas:Food & Drink", "quiet:biz:bizdormant", "pricinggap:Nashville:Fitness & Wellness"]) {
    await admin("POST", "/api/admin/suggestions/dismiss", { id }, base);
  }
  const offerQuietId = Object.keys(readDb()).find((k) => k.startsWith("suggestion:quiet:offer:"));
  if (offerQuietId) await admin("POST", "/api/admin/suggestions/dismiss", { id: offerQuietId.slice("suggestion:".length) }, base);
  const g6 = await admin("GET", "/api/admin/suggestions", undefined, base);
  const board6 = g6.data.suggestions || [];
  const ids6 = board6.map((s) => s.id);
  const p1Card = board6.find((s) => s.id === "pricing:Nashville:Restaurant");
  check("P1 renders: median $250, middle half $100-$300 on the card", !!p1Card && p1Card.receipt.median === 250 && /median \$250/.test(p1Card.text) && /nothing changes on its own/.test(p1Card.text), JSON.stringify(p1Card).slice(0, 240));
  const c3Card = board6.find((s) => s.id === "curriculum:creator:pricing");
  check("C3 renders: the pricing cluster with its counts on the card", !!c3Card && c3Card.receipt.asks === 4 && /pricing and money/.test(c3Card.text), JSON.stringify(c3Card).slice(0, 240));
  check("the refilled board is exactly the three held kinds", ids6.length === 3 && ids6.includes("pricing:Nashville:Restaurant") && ids6.includes("pricing:Nashville:Fitness Studio") && ids6.includes("curriculum:creator:pricing"), ids6.join(" | "));

  // ---------- Folded remainder: grid brief threading ----------
  console.log("== brief threading: deals ==");
  const deal1 = await biz("POST", "/api/deals", { creatorId: "crnash2", kind: "comp", title: "Briefed dinner", dollarCap: 75, whatComped: "Dinner for two", sourceBrief: { source: "filters", market: "Nashville", category: "Food & Drink", kind: "comp", budget: 200, label: "display only, must drop" } }, base);
  check("briefed deal created", deal1.status === 201, JSON.stringify(deal1.data).slice(0, 200));
  const dealId1 = deal1.data && deal1.data.deal && deal1.data.deal.id;
  const vdeal1 = dealId1 ? readDb()[`vdeal:${dealId1}`] : null;
  check("the deal record persists sourceBrief, normalized (label dropped)", !!vdeal1 && !!vdeal1.sourceBrief && vdeal1.sourceBrief.category === "Food & Drink" && vdeal1.sourceBrief.budget === 200 && !("label" in vdeal1.sourceBrief), JSON.stringify(vdeal1 && vdeal1.sourceBrief));
  const creator2 = client();
  const rc2 = await creator2("POST", "/api/auth/login", { email: "nash2@fixtures.dev", password: SEED_PW }, base);
  check("the picked creator signed in", rc2.status === 200);
  const accept = await creator2("POST", `/api/deals/${dealId1}/respond`, { action: "accept" }, base);
  check("the creator accepts the deal", accept.status === 200, JSON.stringify(accept.data).slice(0, 200));
  const vdeal1b = readDb()[`vdeal:${dealId1}`];
  const matOffer = vdeal1b && vdeal1b.offerId ? readDb()[`offer:${vdeal1b.offerId}`] : null;
  check("the materialized offer carries sourceBrief (the pick joins its impression)", !!matOffer && !!matOffer.sourceBrief && matOffer.sourceBrief.budget === 200 && matOffer.sourceBrief.category === "Food & Drink", JSON.stringify(matOffer && matOffer.sourceBrief));
  const deal2 = await biz("POST", "/api/deals", { creatorId: "crnash1", kind: "comp", title: "Plain dinner", dollarCap: 50, whatComped: "Dinner for two" }, base);
  check("brief-less deal created", deal2.status === 201, JSON.stringify(deal2.data).slice(0, 160));
  const dealId2 = deal2.data && deal2.data.deal && deal2.data.deal.id;
  const vdeal2 = dealId2 ? readDb()[`vdeal:${dealId2}`] : null;
  check("the brief-less deal has NO sourceBrief field (never inferred)", !!vdeal2 && !("sourceBrief" in vdeal2), JSON.stringify(vdeal2 && Object.keys(vdeal2)));
} finally {
  server.kill("SIGTERM");
}

console.log(failures === 0 ? "verify-decision-reports: ALL PASS" : `verify-decision-reports: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
