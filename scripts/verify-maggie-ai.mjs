// Maggie Real-AI verification (Jeff, 2026-11-07).
//
// The Jeff-style live battery for the LLM-backed Maggie
// (lib/maggie-ai.js), run against the built server on fixture
// data with a REAL provider:
//   - Truth pass: the same fixture DB booted with the AI flag
//     OFF captures the deterministic answers for the count
//     questions. The AI answers must state the same numbers.
//   - AI pass: greetings, the exact question that failed
//     Jeff's live test ("What else can you help with"),
//     capability questions per lane, small talk, a multi-turn
//     market follow-up, a business brief whose cards must
//     carry engine matchScores, an out-of-scope ask, the
//     privacy screen still firing before the model, and the
//     proactive flow (greeting offers the waiting queue; a
//     "yes" actually pulls it up).
// Assertions are semantic (no retired deflection anywhere,
// real per-lane capabilities, fixture-true numbers), never
// exact wording: the model phrases, the records decide.
//
// Needs a provider key in the environment:
//   GEMINI_API_KEY=<key> node scripts/verify-maggie-ai.mjs
// Exits 2 (skipped, not failed) when no key is present.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { maggieAiConfig } = require("./netlify/functions/lib/maggie-ai.js");

if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY && !process.env.SIG_AI_API_KEY && !process.env.OPENAI_API_KEY) {
  console.log("verify-maggie-ai: SKIPPED (no provider key in env: set GEMINI_API_KEY)");
  process.exit(2);
}

const DB = fs.mkdtempSync("/tmp/signl-maggie-ai-") + "/db.json";
const SEED_PW = "verify-maggie-pass";
const SEED_SALT = "verifymaggiesalt";
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
  seed["user:bizactive"] = { id: "bizactive", role: "business", email: "active@fixtures.dev", name: "Active Owner", passwordHash: SEED_HASH, passwordSalt: SEED_SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", tester: false, businessOnboarded: true, business: { businessName: "Active Kitchen", legalName: "Active Kitchen LLC", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Seeded active business." } };
  seed["email:active@fixtures.dev"] = { userId: "bizactive" };
  seed["user:craustin"] = creatorSeed("craustin", "austin@fixtures.dev", "Austin Eats", "austineats", "Austin", 85, 8000, 150);
  seed["user:crnash1"] = creatorSeed("crnash1", "nash1@fixtures.dev", "Nash Food One", "nashfoodone", "Nashville", 88, 12000, 150);
  seed["user:crnash2"] = creatorSeed("crnash2", "nash2@fixtures.dev", "Nash Eats Two", "nasheatstwo", "Nashville", 70, 9000, 300);
  seed["email:austin@fixtures.dev"] = { userId: "craustin" };
  seed["email:nash1@fixtures.dev"] = { userId: "crnash1" };
  seed["email:nash2@fixtures.dev"] = { userId: "crnash2" };
  fs.writeFileSync(DB, JSON.stringify(seed));
}
// Fixture truth: Nashville creator records = crnash1 + crnash2
// + the API-registered pending creator = 3. Austin = 1.
// Waiting on a decision = 1 (the registered creator).

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok -", name);
  else { failures++; console.log("  FAIL -", name, extra || ""); }
}
const noDeflect = (t) => typeof t === "string" && t.length > 2 && !/don'?t know that one yet|not in my bag|tell you straight/i.test(t);

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
function boot(port, aiOn) {
  const base = `http://127.0.0.1:${port}`;
  const server = spawn("node", ["scripts/dev-server.mjs", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL: "jeff@joinsignl.com", ADMIN_PASSWORD: "verify-admin-pass-123", APP_URL: base, SIGNL_TEST_ALLOW_BUSINESS: "1",
      SIG_AI_BASE_URL: "", SIG_AI_API_KEY: "", OPENAI_API_KEY: "", OPENAI_BASE_URL: "", OPENROUTER_API_KEY: "",
      MAGGIE_AI_ENABLED: aiOn ? "1" : "", MAGGIE_AI_MODEL: process.env.MAGGIE_AI_MODEL || "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return { server, base };
}

// ---------- 0. Config gates ----------
console.log("== unit: maggie-ai config ==");
check("flag off -> no config", maggieAiConfig({ GEMINI_API_KEY: "x" }) === null);
check("flag on, no key -> no config", maggieAiConfig({ MAGGIE_AI_ENABLED: "1" }) === null);
{ const c = maggieAiConfig({ MAGGIE_AI_ENABLED: "1", GEMINI_API_KEY: "x" }); check("flag on + Gemini key -> gemini/gemini-3.8-flash", !!c && c.provider === "gemini" && c.model === "gemini-3.8-flash", JSON.stringify(c)); }
{ const c = maggieAiConfig({ MAGGIE_AI_ENABLED: "true", OPENAI_API_KEY: "x" }); check("flag on + OpenAI key -> openai fallback provider", !!c && c.provider === "openai", JSON.stringify(c)); }

// ---------- 1. Truth pass (AI off) ----------
console.log("== truth pass: deterministic counts on the same fixtures ==");
let truthNash = null, truthAustin = null;
{
  const { server, base } = boot(8952, false);
  try {
    check("truth server boots", await waitUp(base));
    const creator = client();
    const rc = await creator("POST", "/api/auth/register", { role: "creator", name: "Maggie Creator", email: "maggie@fixtures.dev", password: "creator-pass-123", market: "Nashville", city: "Nashville", handle: "maggieeats", tierBand: "Neighbors", followerCount: 900, localAudiencePct: 80, categories: ["Food & Drink"], agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true }, base);
    check("creator registered (the 1 waiting application)", rc.status === 201 || rc.status === 200, JSON.stringify(rc.data).slice(0, 160));
    const admin = client();
    const ra = await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "verify-admin-pass-123" }, base);
    check("admin signed in (truth)", ra.status === 200);
    const ask = async (c, q, history) => c("POST", "/api/sig/ask", { q, ...(history ? { history } : {}) }, base);
    let r = await ask(admin, "How many creators are in Nashville?");
    truthNash = r.data.text || "";
    check("TRUTH Nashville count is 3", /3 creators?/.test(truthNash), truthNash);
    const hist = [{ who: "user", text: "How many creators are in Nashville?" }, { who: "sig", text: truthNash }];
    r = await ask(admin, "And in Austin?", hist);
    truthAustin = r.data.text || "";
    check("TRUTH Austin count is 1", /Austin/.test(truthAustin) && /1 creator/.test(truthAustin), truthAustin);
  } finally { server.kill("SIGTERM"); }
}

// ---------- 2. AI pass ----------
console.log("== ai pass: the Jeff battery, model live ==");
{
  const { server, base } = boot(8951, true);
  try {
    check("ai server boots", await waitUp(base));
    const admin = client();
    const ra = await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "verify-admin-pass-123" }, base);
    check("admin signed in", ra.status === 200);
    const creator = client();
    const rl = await creator("POST", "/api/auth/login", { email: "maggie@fixtures.dev", password: "creator-pass-123" }, base);
    check("creator signed in", rl.status === 200, JSON.stringify(rl.data).slice(0, 120));
    const biz = client();
    const rb = await biz("POST", "/api/auth/login", { email: "active@fixtures.dev", password: SEED_PW }, base);
    check("active business signed in", rb.status === 200);
    const ask = async (c, q, history) => { await new Promise((r) => setTimeout(r, 750)); return c("POST", "/api/sig/ask", { q, ...(history ? { history } : {}) }, base); };

    // Proactive greeting + the yes that must pull the queue up.
    let r = await ask(admin, "hey");
    check("ADMIN 'hey' answered by the model (source ai)", r.status === 200 && r.data.source === "ai", JSON.stringify(r.data).slice(0, 200));
    check("ADMIN 'hey' carries the true bright spot (1 waiting) and no deflection", noDeflect(r.data.text) && /1 (creator )?applications?\b/.test(r.data.text || ""), r.data.text);
    const greetHist = [{ who: "user", text: "hey" }, { who: "sig", text: r.data.text || "" }];
    console.log("  ADMIN greeting:", (r.data.text || "").slice(0, 220));
    r = await ask(admin, "yes", greetHist);
    check("ADMIN 'yes' actually pulls up the waiting creator by name", noDeflect(r.data.text) && /Maggie Creator|maggieeats/.test(r.data.text || ""), r.data.text);
    console.log("  ADMIN yes:", (r.data.text || "").slice(0, 220));

    // Jeff's exact failing question, both lanes.
    r = await ask(admin, "What else can you help with");
    const adminCaps = r.data.text || "";
    check("ADMIN 'What else can you help with' answered by the model, no deflection", r.data.source === "ai" && noDeflect(adminCaps), JSON.stringify(r.data).slice(0, 200));
    check("ADMIN capabilities name the admin lane (approvals/markets/partners)", /approv|waiting|market|partner/i.test(adminCaps), adminCaps);
    console.log("  ADMIN capabilities:", adminCaps.slice(0, 400));
    r = await ask(creator, "what can you do?");
    const creatorCaps = r.data.text || "";
    check("CREATOR 'what can you do?' answered by the model, no deflection", r.data.source === "ai" && noDeflect(creatorCaps), JSON.stringify(r.data).slice(0, 200));
    check("CREATOR capabilities name the creator lane (Momentum/offers/profile)", /momentum|offers|profile/i.test(creatorCaps), creatorCaps);
    check("capability answers differ per lane and stay in lane", adminCaps !== creatorCaps && !/your Momentum/i.test(adminCaps) && !/waiting on an approval decision/i.test(creatorCaps), "");
    console.log("  CREATOR capabilities:", creatorCaps.slice(0, 400));

    // Small talk.
    r = await ask(creator, "thanks");
    check("CREATOR 'thanks' converses, no deflection", noDeflect(r.data.text), JSON.stringify(r.data).slice(0, 160));
    r = await ask(creator, "how's your day");
    check("CREATOR 'how's your day' converses, no deflection", noDeflect(r.data.text), JSON.stringify(r.data).slice(0, 160));

    // Numbers equal the fixture truth; follow-ups keep context.
    r = await ask(admin, "how many creators in Nashville?");
    check("ADMIN Nashville count from the model equals the truth (3)", r.data.source === "ai" && /\b3\b/.test(r.data.text || ""), r.data.text);
    const nashHist = [{ who: "user", text: "how many creators in Nashville?" }, { who: "sig", text: r.data.text || "" }];
    r = await ask(admin, "and in Austin?", nashHist);
    check("ADMIN follow-up 'and in Austin?' keeps context and equals the truth (1)", r.data.source === "ai" && /Austin/i.test(r.data.text || "") && /\b1\b/.test(r.data.text || ""), r.data.text);

    // The business brief: cards must carry engine matchScores.
    r = await ask(biz, "find me food creators in Nashville under $200");
    const cards = r.data.cards || [];
    check("BUSINESS brief answered by the model with cards attached", r.data.source === "ai" && Array.isArray(cards) && cards.length >= 1, JSON.stringify(r.data).slice(0, 240));
    check("BUSINESS brief cards all carry a numeric matchScore and match.reasons", cards.length >= 1 && cards.every((c) => typeof c.matchScore === "number" && c.match && Array.isArray(c.match.reasons)), JSON.stringify(cards).slice(0, 240));
    check("BUSINESS brief resolved as a $200 brief (matchBrief)", !!r.data.matchBrief && Number(r.data.matchBrief.budget) === 200, JSON.stringify(r.data.matchBrief));
    check("BUSINESS brief top card is the in-budget local leader (nashfoodone)", cards.length >= 1 && ((cards[0].profile || {}).handle === "nashfoodone" || cards[0].name === "Nash Food One"), JSON.stringify(cards[0] || {}).slice(0, 200));
    console.log("  BUSINESS brief text:", (r.data.text || "").slice(0, 260));

    // Out of scope: honest, conversational, never the deflection.
    r = await ask(creator, "what is the weather tomorrow?");
    check("CREATOR out-of-scope ask handled without the deflection", noDeflect(r.data.text), r.data.text);

    // The privacy screen still fires before the model.
    r = await ask(creator, "how many followers does @austineats have?");
    check("CREATOR cross-account ask refused by the privacy screen (source data)", r.data.source === "data" && /only see your own/.test(r.data.text || ""), JSON.stringify(r.data).slice(0, 200));
  } finally { server.kill("SIGTERM"); }
}

console.log(failures === 0 ? "verify-maggie-ai: ALL PASS" : `verify-maggie-ai: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
