// Maggie Rebuild v1 verification (Jeff, 2026-11-07).
//
// The conversation battery Jeff's spec demands, run three ways:
//  1. UNIT: the conversational layer (lib/sigconvo.js) against
//     fabricated fact sheets per role — greetings, thanks,
//     small talk, identity, capabilities, farewells, acks, and
//     the negatives (real fact questions must NOT be claimed).
//  2. HTTP: the live /api/sig/ask stack with NO AI provider
//     configured (the deterministic stack alone must carry a
//     conversation): admin (Jeff's lane, incl. his exact
//     failing probe "hey"), creator, business; live-data
//     questions with specific answers; a multi-turn market
//     follow-up; cross-role privacy probes; a genuine unknown
//     (must never produce the retired deflection).
//  3. JOIN: on this branch the match engine is absent, so a
//     briefed discover call must degrade gracefully (200, no
//     match fields) — the client join keys off payload
//     presence, and presence is the other branch's contract
//     (matchScore + match { score, parts, reasons } +
//     matchBrief on GET /api/discover).
// Run: node scripts/verify-maggie.mjs
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { sigConverse, isConversational } = require("./netlify/functions/lib/sigconvo.js");
const PORT = 8947;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = fs.mkdtempSync("/tmp/signl-maggie-") + "/db.json";
// Seeded before boot: an ACTIVE business (the discover roster
// is gated to activated businesses) and one approved Austin
// creator (so the market follow-up has a non-zero scoped
// answer). The API-registered users below stay pending, which
// is what the admin waiting assertions count.
const SEED_PW = "verify-maggie-pass";
const SEED_SALT = "verifymaggiesalt";
const SEED_HASH = crypto.scryptSync(SEED_PW, SEED_SALT, 64).toString("hex");
{
  const seed = {};
  seed["user:bizactive"] = { id: "bizactive", role: "business", email: "active@fixtures.dev", name: "Active Owner", passwordHash: SEED_HASH, passwordSalt: SEED_SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", tester: false, businessOnboarded: true, business: { businessName: "Active Kitchen", legalName: "Active Kitchen LLC", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Seeded active business." } };
  seed["email:active@fixtures.dev"] = { userId: "bizactive" };
  seed["user:craustin"] = { id: "craustin", role: "creator", email: "austin@fixtures.dev", name: "Austin Eats", passwordHash: SEED_HASH, passwordSalt: SEED_SALT, status: "approved", market: "Austin", city: "Austin", createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", tester: false, creator: { handle: "austineats", platform: "Instagram", handleNormalized: "austineats", city: "Austin", state: "TX", neighborhood: "Downtown", categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", audienceStack: { instagram: 8000 }, totalAudience: 8000, followerCount: 8000, localAudiencePct: 85, paidRate: 150, compOpen: true, couponOpen: true, profileComplete: true, publicPage: true, bio: "Austin food, daily." } };
  seed["email:austin@fixtures.dev"] = { userId: "craustin" };
  fs.writeFileSync(DB, JSON.stringify(seed));
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok -", name);
  else { failures++; console.log("  FAIL -", name, extra || ""); }
}
const noBag = (t) => typeof t === "string" && !/not in my bag/i.test(t) && !/—/.test(t);

// ---------- 1. Unit: the conversational layer ----------
console.log("== unit: sigconvo ==");
const adminF = { waiting: { total: 2, creators: 2, businesses: 0 }, creators: { claimsToday: 1 } };
const creatorNewF = { profileComplete: false, missingLabels: ["home city", "audience"], momentumPoints: 0 };
const creatorDoneF = { profileComplete: true, missingLabels: [], momentumPoints: 145 };
const bizF = { applicantsWaiting: 3, rosterInMarket: 12, market: "Nashville" };
const partnerF = { totals: { creatorsAttributed: 7 } };

const convoCases = [
  // [role, facts, q, history, mustInclude, label]
  ["admin", adminF, "hey", [], ["Maggie", "2 applications waiting"], "admin 'hey' greets with the live waiting count"],
  ["admin", adminF, "hello", [], ["Maggie"], "admin 'hello'"],
  ["admin", adminF, "good morning", [], ["Good morning"], "admin mirrors the morning greeting"],
  ["admin", adminF, "thanks", [], ["Any time"], "admin thanks"],
  ["admin", adminF, "who are you?", [], ["Maggie", "approvals waiting"], "admin identity stays in the admin lane"],
  ["admin", adminF, "what can you do", [], ["approvals waiting", "read-only"], "admin capabilities name the admin lane"],
  ["admin", adminF, "how are you", [], ["All good"], "admin small talk"],
  ["admin", adminF, "bye", [], ["right here"], "admin farewell"],
  ["creator", creatorNewF, "hey", [], ["Maggie", "2 steps left"], "creator greeting carries the true profile state"],
  ["creator", creatorDoneF, "hi maggie", [], ["145 Momentum points"], "creator greeting carries real Momentum"],
  ["creator", creatorDoneF, "thank you", [], ["Any time"], "creator thanks"],
  ["creator", creatorDoneF, "who are you", [], ["Maggie", "Momentum"], "creator identity stays in the creator lane"],
  ["creator", creatorDoneF, "what can you do?", [], ["offers"], "creator capabilities"],
  ["creator", creatorDoneF, "are you a bot", [], ["AI guide"], "honest AI answer when asked straight"],
  ["creator", creatorDoneF, "hola", [], ["Hola"], "spanish greeting"],
  ["creator", creatorDoneF, "gracias", [], ["Any time"], "spanish thanks"],
  ["business", bizF, "hey", [], ["3 applicants waiting"], "business greeting carries the waiting applicants"],
  ["business", bizF, "help", [], ["finding creators"], "business bare 'help' gets the lane's capabilities"],
  ["business", bizF, "who are you", [], ["Maggie"], "business identity"],
  ["partner", partnerF, "hey", [], ["7 creators in through your links"], "partner greeting carries their own funnel"],
  ["partner", partnerF, "what can you do", [], ["funnel"], "partner capabilities"],
  ["pilot_partner", null, "hey", [], ["Maggie", "pilot"], "pilot greeting with no fact sheet still converses"],
  ["creator", null, "hey", [], ["Maggie"], "no fact sheet: greeting still works, no numbers invented"],
];
for (const [role, facts, q, history, wants, label] of convoCases) {
  const out = sigConverse(role, facts, q, history, { firstName: role === "admin" ? "Jeff" : "Sam" });
  check(label, !!out && wants.every((w) => out.text.includes(w)) && noBag(out.text), out ? out.text : "null");
}
// Repeat greeting in one session gets the short form.
{
  const out = sigConverse("admin", adminF, "hey", [{ who: "user", text: "hey" }, { who: "sig", text: "Hey, Jeff." }], { firstName: "Jeff" });
  check("second greeting in a session is the short form", !!out && out.text.startsWith("Hey again"), out && out.text);
}
// Negatives: real questions and gibberish are NOT claimed.
const negatives = ["How many creators in Nashville?", "hey, how many creators in Nashville?", "how do I make money", "what does it cost", "who is pending approval", "find me food creators", "asdf qwer zxcv", "how does momentum work", "delete my account", "what is the weather tomorrow"];
for (const q of negatives) {
  check(`not claimed: "${q}"`, sigConverse("admin", adminF, q, [], {}) === null && !isConversational(q) || sigConverse("creator", creatorDoneF, q, [], {}) === null);
}

// ---------- HTTP helpers ----------
function client() {
  const jar = new Map();
  return async (method, p, body) => {
    const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  };
}
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/api/bootstrap"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

// ---------- 2 + 3. HTTP battery (no AI provider: deterministic stack) ----------
console.log("== http: conversation battery, AI unconfigured ==");
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: ROOT,
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL: "jeff@joinsignl.com", ADMIN_PASSWORD: "verify-admin-pass-123", APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1", SIG_AI_BASE_URL: "", SIG_AI_API_KEY: "", OPENAI_API_KEY: "", OPENAI_BASE_URL: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
try {
  check("server boots", await waitUp());

  const creator = client();
  const rc = await creator("POST", "/api/auth/register", { role: "creator", name: "Maggie Creator", email: "maggie@fixtures.dev", password: "creator-pass-123", market: "Nashville", city: "Nashville", handle: "maggieeats", tierBand: "Neighbors", followerCount: 900, localAudiencePct: 80, categories: ["Food & Drink"], agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true });
  check("creator registered", rc.status === 201 || rc.status === 200, JSON.stringify(rc.data).slice(0, 160));
  const business = client();
  const rb = await business("POST", "/api/auth/register", { role: "business", name: "Maggie Owner", businessName: "Maggie Cafe", email: "maggiebiz@fixtures.dev", password: "business-pass-123", market: "Nashville", city: "Nashville", category: "Coffee & Bakery", planId: "self-service", agreedTerms: true });
  check("business registered", rb.status === 201 || rb.status === 200, JSON.stringify(rb.data).slice(0, 160));
  const admin = client();
  const ra = await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "verify-admin-pass-123" });
  check("admin signed in", ra.status === 200, JSON.stringify(ra.data).slice(0, 160));

  const ask = async (c, q, history) => c("POST", "/api/sig/ask", { q, ...(history ? { history } : {}) });

  // Jeff's exact failing probe, in his lane.
  let r = await ask(admin, "hey");
  check("ADMIN 'hey' is answered by the conversation layer (source data)", r.status === 200 && r.data.source === "data" && noBag(r.data.text), JSON.stringify(r.data).slice(0, 200));
  check("ADMIN 'hey' greets Jeff and states the real waiting count (2 applications)", /Jeff/.test(r.data.text || "") && /2 applications waiting/.test(r.data.text || ""), r.data.text);
  r = await ask(admin, "thanks");
  check("ADMIN 'thanks' converses", r.data.source === "data" && /Any time/.test(r.data.text || "") && noBag(r.data.text), JSON.stringify(r.data).slice(0, 160));
  r = await ask(admin, "who are you?");
  check("ADMIN identity stays in the admin lane", r.data.source === "data" && /Maggie/.test(r.data.text || "") && /approvals waiting/.test(r.data.text || ""), r.data.text);
  r = await ask(admin, "who's pending approval?");
  check("ADMIN pending list names the real records", r.data.source === "data" && /Maggie Creator|maggieeats/.test(r.data.text || "") && noBag(r.data.text), r.data.text);
  r = await ask(admin, "How many creators are in Nashville?");
  check("ADMIN Nashville creator count is the real count (1)", r.data.source === "data" && /1 creator/.test(r.data.text || ""), r.data.text);
  const hist = [{ who: "user", text: "How many creators are in Nashville?" }, { who: "sig", text: r.data.text || "" }];
  r = await ask(admin, "And in Austin?", hist);
  check("ADMIN multi-turn follow-up 'And in Austin?' answers scoped (the seeded 1)", r.data.source === "data" && /Austin/.test(r.data.text || "") && /1 creator/.test(r.data.text || ""), r.data.text);
  r = await ask(admin, "what is the weather tomorrow");
  check("ADMIN genuine unknown never hits the retired deflection", noBag(r.data.text || "") && r.status === 200, JSON.stringify(r.data).slice(0, 160));

  // Creator lane.
  r = await ask(creator, "hey");
  check("CREATOR 'hey' converses with her real state", r.data.source === "data" && /Maggie/.test(r.data.text || "") && noBag(r.data.text), r.data.text);
  r = await ask(creator, "how are you");
  check("CREATOR small talk converses", r.data.source === "data" && /All good/.test(r.data.text || ""), r.data.text);
  r = await ask(creator, "what can you do");
  check("CREATOR capabilities stay in the creator lane", r.data.source === "data" && /Momentum/.test(r.data.text || "") && !/applicants/.test(r.data.text || ""), r.data.text);
  r = await ask(creator, "how many followers does Maggie Cafe have?");
  check("CREATOR asking for a business's data is refused by the privacy screen", r.data.source === "data" && /I only see your own account/.test(r.data.text || ""), r.data.text);
  r = await ask(creator, "what is Jeff's email address?");
  check("CREATOR asking for the founder's contact data is refused", r.data.source === "data" && /only see your own/.test(r.data.text || ""), r.data.text);
  r = await ask(creator, "what is the weather tomorrow");
  check("CREATOR genuine unknown never hits the retired deflection", noBag(r.data.text || "") && r.status === 200, JSON.stringify(r.data).slice(0, 160));

  // Business lane.
  r = await ask(business, "hey");
  check("BUSINESS 'hey' converses", r.data.source === "data" && /Maggie/.test(r.data.text || "") && noBag(r.data.text), r.data.text);
  r = await ask(business, "what can you do");
  check("BUSINESS capabilities stay in the business lane", r.data.source === "data" && /finding creators/.test(r.data.text || "") && !/Momentum/.test(r.data.text || ""), r.data.text);
  r = await ask(business, "how many followers does @maggieeats have?");
  check("BUSINESS asking for a creator's account data is refused or scoped", r.status === 200 && noBag(r.data.text || "") && (/only see your own/.test(r.data.text || "") || /Find creators/.test(r.data.text || "")), r.data.text);

  // The join degrades gracefully without the engine (asked as
  // the seeded ACTIVE business: the roster gate is real).
  const activeBiz = client();
  const rl = await activeBiz("POST", "/api/auth/login", { email: "active@fixtures.dev", password: SEED_PW });
  check("seeded active business signed in", rl.status === 200, JSON.stringify(rl.data).slice(0, 160));
  const disc = await activeBiz("GET", "/api/discover?market=Austin&sort=match&category=Food%20%26%20Drink&budget=200");
  check("JOIN: briefed discover without the engine answers 200 and carries no match fields", disc.status === 200 && Array.isArray(disc.data.creators) && disc.data.creators.length >= 1 && disc.data.creators.every((c) => c.match === undefined), JSON.stringify(disc.data).slice(0, 200));
} finally {
  server.kill("SIGTERM");
}
console.log(failures === 0 ? "verify-maggie: ALL PASS" : `verify-maggie: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
