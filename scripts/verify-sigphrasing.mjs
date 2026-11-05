// Sig PHRASING regression suite (Build -131, Part C: "super
// intelligent and agile"). Real natural-language questions —
// typos, fragments, casual phrasing included — asked over HTTP
// from creator, business, partner, and admin fixture sessions
// with NO AI provider configured, so every answer must come
// from the deterministic layer grounded in the asker's own
// records: the audience grounding fix (Part B), the honest
// capability answers, the business owe answer, and the clarify
// path for vague fragments (one short question, tappable
// options, each option itself a grounded question). Canon
// questions must still fall through to the AI/bank path
// (source "unavailable" here), never swallowed by clarify.
// Run: node scripts/verify-sigphrasing.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const auth = require("../netlify/functions/lib/auth.js");

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = 8933;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "phrasing-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-sigphrasing-${Date.now()}.json`);

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

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

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const TS = "2026-11-05T12:00:00.000Z";
{
  const { salt, hash } = auth.hashPassword("partner-pass-123");
  const partner = {
    id: "partner-phrase-id", role: "partner", email: "partner@phrasing.dev", name: "Pat Partner",
    passwordSalt: salt, passwordHash: hash, status: "approved", tester: false, market: "Richmond",
    createdAt: TS, updatedAt: TS, reviewedAt: TS, termsVersion: "2026-10-19", termsAcceptedAt: TS,
    creator: null, business: null,
    partner: { name: "Phrase Media", type: "media", contactName: "Pat Partner", code: "phrase-partner", markets: ["Richmond"], sharePct: 50, status: "active", agreementStatus: "unsigned", demo: false, createdAt: TS },
  };
  fs.writeFileSync(DB, JSON.stringify({ [`user:${partner.id}`]: partner, [`email:${partner.email}`]: { userId: partner.id } }));
}

// No AI provider in this environment on purpose: the spawn env
// explicitly strips every AI key the parent shell might carry.
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD: ADMIN_PW, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1" };
for (const k of ["SIG_AI_API_KEY", "SIG_AI_BASE_URL", "SIG_AI_MODEL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENROUTER_API_KEY", "OPENROUTER_BASE_URL"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

async function ask(c, q) { return c("POST", "/api/sig/ask", { q }); }

try {
  check("server boots (no AI configured)", await waitUp());

  // Creator A: audience stack 3,000 + 1,321 + 250 = 4,571, 64% local.
  const crA = client();
  const rA = await crA("POST", "/api/auth/register", { role: "creator", name: "Phrase Creator", email: "phrase@fixtures.dev", password: "creator-pass-123", market: "Richmond", city: "Richmond", handle: "phrasecr", tierBand: "Locals", followerCount: 4571, audienceStack: { instagram: 3000, tiktok: 1321, youtube: 250 }, localAudiencePct: 64, categories: ["Food & Drink"], ...AGREE });
  check("creator A registered with audience stack", rA.status === 201 || rA.status === 200, JSON.stringify(rA.data).slice(0, 160));
  // Creator B: no audience data at all.
  const crB = client();
  const rB = await crB("POST", "/api/auth/register", { role: "creator", quickClaim: true, handle: "barecr", market: "Richmond", email: "bare@fixtures.dev", password: "creator-pass-123", ...AGREE });
  check("creator B registered with no audience data", rB.status === 201 || rB.status === 200, JSON.stringify(rB.data).slice(0, 160));

  const biz = client();
  const rBiz = await biz("POST", "/api/auth/register", { role: "business", name: "Phrase Owner", businessName: "Phrase Cafe", email: "phrasebiz@fixtures.dev", password: "business-pass-123", market: "Richmond", city: "Richmond", category: "Coffee & Bakery", planId: "self-service", agreedTerms: true });
  check("business registered", rBiz.status === 201 || rBiz.status === 200, JSON.stringify(rBiz.data).slice(0, 160));
  const partner = client();
  const rP = await partner("POST", "/api/auth/login", { email: "partner@phrasing.dev", password: "partner-pass-123" });
  check("partner logs in", rP.status === 200, JSON.stringify(rP.data).slice(0, 120));
  const admin = client();
  const rAd = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin logs in", rAd.status === 200, JSON.stringify(rAd.data).slice(0, 120));

  // ---------- Part B: the audience grounding fix ----------
  const a1 = await ask(crA, "How many followers do I have?");
  check("[creator] 'How many followers do I have?' -> own stacked total + split + profile link", a1.data.source === "data" && (a1.data.text || "").includes("4,571") && (a1.data.text || "").includes("Instagram") && (a1.data.text || "").includes("TikTok") && a1.data.link && a1.data.link.dest === "cr-profile", JSON.stringify(a1.data).slice(0, 260));
  const a2 = await ask(crA, "how big is my audience");
  check("[creator] 'how big is my audience' -> 4,571", (a2.data.text || "").includes("4,571"), JSON.stringify(a2.data).slice(0, 200));
  const a3 = await ask(crA, "how many followers i got");
  check("[creator] casual 'how many followers i got' -> 4,571", (a3.data.text || "").includes("4,571"), JSON.stringify(a3.data).slice(0, 200));
  const a4 = await ask(crA, "how many folowers do i have");
  check("[creator] typo 'folowers' -> 4,571", (a4.data.text || "").includes("4,571"), JSON.stringify(a4.data).slice(0, 200));
  const a5 = await ask(crA, "what's my local %");
  check("[creator] 'what's my local %' -> 64%", (a5.data.text || "").includes("64%"), JSON.stringify(a5.data).slice(0, 200));
  const a6 = await ask(crA, "any offers yet??");
  check("[creator] 'any offers yet??' -> grounded offers answer", a6.data.source === "data" && ((a6.data.text || "").includes("not open yet") || (a6.data.text || "").includes("No open offers")), JSON.stringify(a6.data).slice(0, 200));
  const a7 = await ask(crA, "what do i owe");
  check("[creator] 'what do i owe' -> posts-owed answer", (a7.data.text || "").includes("owed"), JSON.stringify(a7.data).slice(0, 200));
  const a8 = await ask(crA, "who viewed me");
  check("[creator] 'who viewed me' -> honest no-tracking answer + Numbers link", (a8.data.text || "").includes("does not track") && a8.data.link && a8.data.link.dest === "cr-numbers", JSON.stringify(a8.data).slice(0, 220));
  const b1 = await ask(crB, "how many followers do i have");
  check("[creator, no data] followers ask -> plain no-data answer + action", (b1.data.text || "").includes("No audience counts are on your record yet") && b1.data.link && b1.data.link.dest === "cr-profile", JSON.stringify(b1.data).slice(0, 220));

  // ---------- Part C: clarify, never a dead end ----------
  const c1 = await ask(crA, "numbers?");
  check("[creator] fragment 'numbers?' -> clarify with 3 tappable options", c1.data.source === "data" && (c1.data.text || "").includes("which one") && Array.isArray(c1.data.suggest) && c1.data.suggest.length === 3, JSON.stringify(c1.data).slice(0, 220));
  const c2 = await ask(crA, "help");
  check("[creator] bare 'help' -> clarify, not a dead end", c2.data.source === "data" && Array.isArray(c2.data.suggest) && c2.data.suggest.length === 3 && !(c2.data.text || "").includes("don't have that one"), JSON.stringify(c2.data).slice(0, 220));
  const c3 = await ask(crA, "how does licensing work");
  check("[creator] canon question still falls through (not clarify, not refused)", c3.data.source === "unavailable", JSON.stringify(c3.data).slice(0, 160));
  const c4 = await ask(biz, "stuff");
  check("[business] fragment 'stuff' -> clarify with business options", c4.data.source === "data" && Array.isArray(c4.data.suggest) && c4.data.suggest.includes("How many visits do I have left?"), JSON.stringify(c4.data).slice(0, 220));
  const c5 = await ask(partner, "hmm");
  check("[partner] fragment 'hmm' -> clarify with partner options", c5.data.source === "data" && Array.isArray(c5.data.suggest) && c5.data.suggest[0] === "What have I accrued?", JSON.stringify(c5.data).slice(0, 220));

  // ---------- business + partner grounding ----------
  const d1 = await ask(biz, "what do i owe");
  check("[business] 'what do i owe' -> founding nothing-owed answer", (d1.data.text || "").includes("owe nothing"), JSON.stringify(d1.data).slice(0, 220));
  const d2 = await ask(biz, "how many visits do i have left");
  check("[business] visits left answers", (d2.data.text || "").includes("visits left"), JSON.stringify(d2.data).slice(0, 200));
  const d3 = await ask(biz, "who viewed my page");
  check("[business] 'who viewed my page' -> honest no-tracking answer", (d3.data.text || "").includes("does not track"), JSON.stringify(d3.data).slice(0, 200));
  const d4 = await ask(partner, "what have i accrued");
  check("[partner] accrual answers, not refused", (d4.data.text || "").includes("accrued") && !(d4.data.text || "").includes("I only see your own"), JSON.stringify(d4.data).slice(0, 200));
  const d5 = await ask(partner, "how many creators came through my links");
  check("[partner] attributed funnel answers", (d5.data.text || "").toLowerCase().includes("your links") && !(d5.data.text || "").includes("I only see your own"), JSON.stringify(d5.data).slice(0, 220));

  // ---------- admin grounding ----------
  const e1 = await ask(admin, "how many creators do we have");
  check("[admin] 'how many creators do we have' -> real total", (e1.data.text || "").includes("2 creators in total"), JSON.stringify(e1.data).slice(0, 200));
  const e2 = await ask(admin, "how many followers do we have");
  check("[admin] 'how many followers do we have' -> platform follower total", (e2.data.text || "").includes("4,571"), JSON.stringify(e2.data).slice(0, 220));
} finally {
  server.kill("SIGTERM");
}
console.log(failed === 0 ? `verify-sigphrasing: ALL PASS (${passed})` : `verify-sigphrasing: ${failed} FAILURE(S), ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
