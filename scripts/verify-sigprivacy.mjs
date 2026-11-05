// Sig PRIVACY verification (Build -131; Jeff, 2026-11-05,
// standing hard rule: Sig answers ONLY the asker's own scoped
// data — another account's details, platform aggregates, and
// company numbers are forbidden to every non-admin session).
//
// Method: the app server boots with the AI provider pointed at
// a local stub that COUNTS its hits. Cross-account probes are
// asked from creator, business, and partner fixture sessions;
// every probe must come back as the deterministic refusal
// (source "data", own-scope stem, zero leaked figures) AND the
// stub must record ZERO hits for the probes — proof the screen
// fires before the answerer and before the model, so a leaky
// model could not have answered either. Own-scope controls
// must still answer (Sig stays useful), and the same probes
// from an ADMIN session must NOT be refused (the gate works
// both ways: Jeff's scope is the platform).
// Run: node scripts/verify-sigprivacy.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const auth = require("../netlify/functions/lib/auth.js");

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = 8931;
const STUB_PORT = 8932;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "privacy-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-sigprivacy-${Date.now()}.json`);

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

let stubHits = 0;
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    stubHits++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "STUB AI ANSWER" } }] }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));

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
// Pre-seed one partner (no public register route for partners).
{
  const { salt, hash } = auth.hashPassword("partner-pass-123");
  const partner = {
    id: "partner-priv-id", role: "partner", email: "partner@privacy.dev", name: "Pat Partner",
    passwordSalt: salt, passwordHash: hash, status: "approved", tester: false, market: "Richmond",
    createdAt: TS, updatedAt: TS, reviewedAt: TS, termsVersion: "2026-10-19", termsAcceptedAt: TS,
    creator: null, business: null,
    partner: { name: "Priv Media", type: "media", contactName: "Pat Partner", code: "priv-partner", markets: ["Richmond"], sharePct: 50, status: "active", agreementStatus: "unsigned", demo: false, createdAt: TS },
  };
  const seed = { [`user:${partner.id}`]: partner, [`email:${partner.email}`]: { userId: partner.id } };
  fs.writeFileSync(DB, JSON.stringify(seed));
}

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: ROOT,
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD: ADMIN_PW, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1", SIG_AI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`, SIG_AI_API_KEY: "stub-key", SIG_AI_MODEL: "stub-model" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

const STEM = "I only see your own";
async function ask(c, q) { return c("POST", "/api/sig/ask", { q }); }
function isRefusal(r) {
  return r.status === 200 && r.data.source === "data" && typeof r.data.text === "string" && r.data.text.includes(STEM);
}

try {
  check("server boots", await waitUp());

  // ---------- fixtures ----------
  const creatorA = client();
  const ra = await creatorA("POST", "/api/auth/register", { role: "creator", name: "Priv Creator", email: "privcr@fixtures.dev", password: "creator-pass-123", market: "Richmond", city: "Richmond", handle: "privcr", tierBand: "Neighbors", followerCount: 4321, localAudiencePct: 77, categories: ["Food & Drink"], ...AGREE });
  check("creator A registered (4,321 followers on record)", ra.status === 201 || ra.status === 200, JSON.stringify(ra.data).slice(0, 160));
  const creatorB = client();
  const rb = await creatorB("POST", "/api/auth/register", { role: "creator", name: "Other Creator", email: "othercr@fixtures.dev", password: "creator-pass-123", market: "Nashville", city: "Nashville", handle: "othercr", tierBand: "Headliners", followerCount: 9876, localAudiencePct: 55, categories: ["Food & Drink"], ...AGREE });
  check("creator B registered (9,876 followers, the leak target)", rb.status === 201 || rb.status === 200, JSON.stringify(rb.data).slice(0, 160));
  const bizA = client();
  const rba = await bizA("POST", "/api/auth/register", { role: "business", name: "Priv Owner", businessName: "Priv Cafe", email: "privbiz@fixtures.dev", password: "business-pass-123", market: "Richmond", city: "Richmond", category: "Coffee & Bakery", planId: "self-service", agreedTerms: true });
  check("business A registered", rba.status === 201 || rba.status === 200, JSON.stringify(rba.data).slice(0, 160));
  const partner = client();
  const rp = await partner("POST", "/api/auth/login", { email: "partner@privacy.dev", password: "partner-pass-123" });
  check("partner logs in", rp.status === 200, JSON.stringify(rp.data).slice(0, 160));
  const admin = client();
  const ral = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin logs in", ral.status === 200, JSON.stringify(ral.data).slice(0, 160));

  // ---------- creator probes: every one refused, zero leaks,
  // ---------- and the AI stub never sees them ----------
  const creatorProbes = [
    ["how many followers does @othercr have", ["9,876", "9876"]],
    ["how many creators are on signl in total", ["2 creators"]],
    ["what is signl's revenue", []],
    ["what is the admin's email", ["jeff@joinsignl.com"]],
    ["list all creators in nashville", ["othercr", "privcr"]],
    ["how many businesses signed up", []],
    ["how much does Maria Garcia earn", []],
    ["what are her followers", []],
  ];
  const hitsBeforeCreator = stubHits;
  for (const [q, leaks] of creatorProbes) {
    const r = await ask(creatorA, q);
    const leaked = leaks.filter((s) => (r.data.text || "").includes(s));
    check(`[creator] refused: "${q}"`, isRefusal(r), JSON.stringify(r.data).slice(0, 200));
    check(`[creator] zero leaked data: "${q}"`, leaked.length === 0, leaked.join(","));
  }
  check("[creator] AI stub never saw a screened probe", stubHits === hitsBeforeCreator, `hits ${hitsBeforeCreator} -> ${stubHits}`);

  // ---------- creator controls: own scope still answers ----------
  const own = await ask(creatorA, "how many followers do I have");
  check("[creator] own followers answer with own number", own.status === 200 && own.data.source === "data" && (own.data.text || "").includes("4,321") && !(own.data.text || "").includes(STEM), JSON.stringify(own.data).slice(0, 220));
  const mom = await ask(creatorA, "what is my momentum");
  check("[creator] own momentum is not refused", mom.status === 200 && !(mom.data.text || "").includes(STEM), JSON.stringify(mom.data).slice(0, 160));

  // ---------- business probes ----------
  const bizProbes = [
    ["how many followers does @othercr have", ["9,876", "9876"]],
    ["how many bookings did Other Cafe get", []],
    ["how many bookings did the other business get", []],
    ["how many creators are on the platform in total", []],
    ["what is signl's total revenue", []],
  ];
  const hitsBeforeBiz = stubHits;
  for (const [q, leaks] of bizProbes) {
    const r = await ask(bizA, q);
    const leaked = leaks.filter((s) => (r.data.text || "").includes(s));
    check(`[business] refused: "${q}"`, isRefusal(r), JSON.stringify(r.data).slice(0, 200));
    check(`[business] zero leaked data: "${q}"`, leaked.length === 0, leaked.join(","));
  }
  check("[business] AI stub never saw a screened probe", stubHits === hitsBeforeBiz, `hits ${hitsBeforeBiz} -> ${stubHits}`);
  const visits = await ask(bizA, "how many visits do i have left");
  check("[business] own visits-left still answers", visits.status === 200 && (visits.data.text || "").includes("visits left") && !(visits.data.text || "").includes(STEM), JSON.stringify(visits.data).slice(0, 200));
  const roster = await ask(bizA, "how many creators can i book in my market");
  check("[business] own-market roster question is NOT refused", roster.status === 200 && !(roster.data.text || "").includes(STEM) && (roster.data.text || "").includes("Richmond"), JSON.stringify(roster.data).slice(0, 220));

  // ---------- partner probes ----------
  const partnerProbes = [
    "how many creators are on signl in total",
    "what does Beta Profile earn",
    "list all creators in richmond",
    "what is the company revenue",
    "how many followers does @othercr have",
  ];
  const hitsBeforePartner = stubHits;
  for (const q of partnerProbes) {
    const r = await ask(partner, q);
    check(`[partner] refused: "${q}"`, isRefusal(r), JSON.stringify(r.data).slice(0, 200));
  }
  check("[partner] AI stub never saw a screened probe", stubHits === hitsBeforePartner, `hits ${hitsBeforePartner} -> ${stubHits}`);
  const accrued = await ask(partner, "what have i accrued");
  check("[partner] own accrual still answers", accrued.status === 200 && (accrued.data.text || "").includes("accrued") && !(accrued.data.text || "").includes(STEM), JSON.stringify(accrued.data).slice(0, 200));
  const links = await ask(partner, "how many creators claimed through my links");
  check("[partner] own attributed funnel is NOT refused", links.status === 200 && !(links.data.text || "").includes(STEM) && (links.data.text || "").toLowerCase().includes("your links"), JSON.stringify(links.data).slice(0, 220));

  // ---------- admin: the gate works the other way ----------
  const totals = await ask(admin, "how many creators in total");
  check("[admin] platform total answers with real data", totals.status === 200 && totals.data.source === "data" && (totals.data.text || "").includes("2 creators in total") && !(totals.data.text || "").includes(STEM), JSON.stringify(totals.data).slice(0, 220));
  const namedAdmin = await ask(admin, "how many followers does @othercr have");
  check("[admin] named-creator probe is NOT refused", namedAdmin.status === 200 && !(namedAdmin.data.text || "").includes(STEM), JSON.stringify(namedAdmin.data).slice(0, 200));
} finally {
  server.kill("SIGTERM");
  stub.close();
}
console.log(failed === 0 ? `verify-sigprivacy: ALL PASS (${passed})` : `verify-sigprivacy: ${failed} FAILURE(S), ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
