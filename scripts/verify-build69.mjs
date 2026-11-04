// Build -69 verification: SIG INTELLIGENCE (Jeff, 2026-11-01:
// "sig is really dumb... he needs to be super intelligent and
// answer alot... this is a driving function of this site").
//
// The seed is a small platform with fully known counts:
//   creators (testers excluded): 8 total = 4 approved (3 with
//   finished profiles), 3 pending, 1 rejected; a 9th approved
//   creator is flagged tester and must never be counted.
//   businesses: 2 total = 1 approved (Growth, founding list),
//   1 pending. Partners: 1 active.
//
// Phase A boots with NO AI provider configured: every factual
// question must still be answered from the live fact sheet
// (source "data", number first, correct value), because that
// is the exact production failure Jeff hit. Canon questions
// must NOT be claimed by the data layer (source "unavailable",
// the client bank's job). Phase B boots with a stub AI
// provider: data questions still win deterministically, canon
// questions reach the model, and the model's system prompt
// must carry the live fact sheet.
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = 8931;
const STUB_PORT = 8932;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";
const DB = path.join(os.tmpdir(), `signl-verify-build69-${Date.now()}.json`);
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}
function client() {
  const jar = new Map();
  return async (method, p, body) => {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
function bootServer(extraEnv) {
  const s = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  s.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return s;
}
async function ask(c, q, history) {
  const r = await c("POST", "/api/sig/ask", { q, history: history || [] });
  return r;
}
function batteryRunner(label) {
  return async (c, cases) => {
    for (const [q, needles] of cases) {
      const r = await ask(c, q);
      const text = (r.data && r.data.text) || "";
      const missing = needles.filter((n) => !text.includes(n));
      check(`[${label}] "${q}" -> data answer with ${JSON.stringify(needles)}`,
        r.status === 200 && r.data.source === "data" && missing.length === 0,
        `source=${r.data && r.data.source} missing=${JSON.stringify(missing)} text=${text.slice(0, 220)}`);
    }
  };
}

// ---------- seed helpers ----------
async function quickClaim(handle, market) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: `${handle}@fixtures.dev`, password: "<MASKED_SECRET_002>", market, handle, ...AGREE });
  if (reg.status !== 201) throw new Error(`quick claim ${handle} failed: ${JSON.stringify(reg.data)}`);
  return { client: c, id: reg.data.user.id };
}
async function fullSignup(handle, market, city, followerCount) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", { role: "creator", name: `Full ${handle}`, email: `${handle}@fixtures.dev`, password: "<MASKED_SECRET_002>", market, city, handle, followerCount, localAudiencePct: 61, categories: ["Food & Drink"], ...AGREE });
  if (reg.status !== 201) throw new Error(`full signup ${handle} failed: ${JSON.stringify(reg.data)}`);
  return { client: c, id: reg.data.user.id };
}
async function bizSignup(handle, businessName, market, planId) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", { role: "business", name: "Biz Owner", businessName, email: `${handle}@fixtures.dev`, password: "<MASKED_SECRET_003>", market, city: market, category: "Restaurant", planId, agreedTerms: true });
  if (reg.status !== 201) throw new Error(`business ${handle} failed: ${JSON.stringify(reg.data)}`);
  return { client: c, id: reg.data.user.id };
}

// ---------- unit checks: branches the HTTP harness cannot reach ----------
// The dev harness runs with SIGNL_TEST_ALLOW_BUSINESS=1, which
// makes every market read live, so Sig's founding-market wording
// is exercised here directly against the answerer with a
// fabricated (but shape-true) fact sheet.
import { createRequire } from "node:module";
const sigdata = createRequire(import.meta.url)("../netlify/functions/lib/sigdata.js");
{
  const foundingCreator = {
    role: "creator", handle: "unitcreator", market: "Nashville", marketLive: false, status: "approved",
    momentumPoints: 145, level: { name: "Regular", nextName: "Standout", nextAt: 300 },
    recentLedger: [{ label: "Post delivered on time", points: 20 }, { label: "Review written", points: 10 }],
    referrals: { signups: 2, approved: 1 }, tier: "Locals", audienceTotal: 4200, localPct: 61,
    listedMarkets: [{ market: "Nashville", pct: 61, home: true }], profileComplete: true, missingLabels: [],
    offersOpen: 0, directInvites: 2, applicationsPending: 1, visitsBooked: 1, visitsUpcoming: 1,
    postsOwed: [{ title: "Taco night", businessName: "Unit Tacos", overdue: true }], visitsRedeemed: 1,
    postsLive: 3, onTimePct: 100, paidBookings: 2, paidRecordedNet: 194, licenseRequestsPending: 1,
    paidRate: 100, licenseFee: 75,
  };
  const offersA = sigdata.answerFacts("creator", foundingCreator, "how many offers are waiting for me", []);
  check("[unit] founding-market creator hears founding honesty on offers", !!offersA && offersA.includes("not open yet") && offersA.includes("2 direct invites"), String(offersA));
  const whyA = sigdata.answerFacts("creator", foundingCreator, "why did my momentum go up", []);
  check("[unit] why-momentum reads the ledger, newest first", !!whyA && whyA.includes("+20 for post delivered on time") && whyA.includes("145 in total"), String(whyA));
  const owedA = sigdata.answerFacts("creator", foundingCreator, "what do i owe", []);
  check("[unit] posts owed names the visit and flags overdue", !!owedA && owedA.includes("Taco night") && owedA.includes("overdue now"), String(owedA));
  const earnA = sigdata.answerFacts("creator", foundingCreator, "how much have i earned", []);
  check("[unit] earnings are recorded-only and labeled", !!earnA && earnA.includes("Recorded: $194 net across 2 paid bookings") && earnA.includes("1 license request"), String(earnA));
  const canonA = sigdata.answerFacts("creator", foundingCreator, "how does momentum work", []);
  check("[unit] canon question is not claimed by the answerer", canonA === null, String(canonA));
}

// ================= PHASE A: no AI provider =================
let server = bootServer({});
try {
  check("phase A: server boots (no AI configured)", await waitUp());
  const anon = client();
  const denied = await anon("POST", "/api/sig/ask", { q: "how many creators do i have" });
  check("signed-out ask is refused (401)", denied.status === 401, String(denied.status));

  const admin = client();
  const al = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", al.status === 200, String(al.status));
  const decide = async (id, decision) => { const r = await admin("POST", "/api/admin/review", { userId: id, decision }); if (r.status !== 200) throw new Error(`review ${id} ${decision}: ${JSON.stringify(r.data)}`); };

  // creators
  await quickClaim("s69vbp1", "Virginia Beach");
  await quickClaim("s69vbp2", "Virginia Beach");
  const vbInc = await quickClaim("s69vbinc", "Virginia Beach"); await decide(vbInc.id, "approve");
  const vbFull = await fullSignup("s69vbfull", "Virginia Beach", "Norfolk", 4200); await decide(vbFull.id, "approve");
  const ricFull = await fullSignup("s69ricfull", "Richmond", "Richmond", 4200); await decide(ricFull.id, "approve");
  const nash1 = await fullSignup("s69nash1", "Nashville", "Nashville", 16000); await decide(nash1.id, "approve");
  await quickClaim("s69nashp", "Nashville");
  const dc = await fullSignup("s69dc", "Washington DC", "Washington DC", 3000); await decide(dc.id, "approve");
  const testerRes = await admin("POST", "/api/admin/tester", { userId: dc.id, tester: true });
  check("tester flag set (excluded from every Sig count)", testerRes.status === 200, JSON.stringify(testerRes.data).slice(0, 120));
  const rej = await quickClaim("s69rej", "Raleigh"); await decide(rej.id, "reject");
  // businesses
  const cafe = await bizSignup("s69cafe", "S69 Cafe", "Virginia Beach", "growth"); await decide(cafe.id, "approve");
  await bizSignup("s69taco", "S69 Tacos", "Nashville", "self-service");
  // partner
  const partner = await admin("POST", "/api/admin/partners", { name: "S69 Media", type: "media", contactName: "Pat Fixture", email: "s69partner@fixtures.dev", sharePct: 50, markets: ["Nashville"] });
  check("partner created", partner.status === 200 || partner.status === 201, JSON.stringify(partner.data).slice(0, 160));

  const run = batteryRunner("admin");
  console.log("== ADMIN battery (25) ==");
  await run(admin, [
    ["how many total creators do i have", ["8 creators in total", "4 approved", "3 pending", "1 rejected", "3 of the approved have finished profiles", "1 tester record not counted"]],
    ["how many creators do we have", ["8 creators in total"]],
    ["how many approved creators are there", ["4 approved creators", "3 of them have finished profiles"]],
    ["how many creator applications are pending", ["3 creator applications pending"]],
    ["who is waiting on a decision", ["4 applications waiting on a decision", "Oldest first"]],
    ["what needs my attention", ["needs you", "4 applications waiting on a decision", "founding list"]],
    ["give me the creators by market", ["Creators by market", "Virginia Beach: 4 creators (2 approved, 1 finished)", "Nashville: 2 creators (1 approved, 1 finished)"]],
    ["break down creators by tier", ["Approved creators by tier", "Locals 2", "Headliners 1"]],
    ["how many businesses do we have", ["2 businesses in total", "1 approved", "1 pending"]],
    ["how many businesses are on the growth plan", ["1 approved business on the Growth plan"]],
    ["how many businesses are on the founding list", ["1 approved business on the founding list", "waiting for activation"]],
    ["how many partners do we have", ["1 partner in total: 1 active, 0 paused"]],
    ["who are our partners", ["S69 Media", "Nashville"]],
    ["which markets are live", ["No markets are live yet"]],
    ["how many applications are waiting", ["4 applications waiting on a decision", "3 creators and 1 business"]],
    ["how many offers are open", ["0 offers open right now"]],
    ["how many posts are overdue", ["0 posts overdue right now"]],
    ["how many signups today", ["8 creator sign-ups today"]],
    ["who signed up most recently", ["Raleigh", "rejected"]],
    ["how many creators have finished profiles", ["3 creators have finished profiles, out of 4 approved"]],
    ["how many locals do we have", ["Locals: 2 approved creators"]],
    ["how many headliners do we have", ["Headliners: 1 approved creator"]],
    ["how many businesses in nashville", ["0 approved businesses in Nashville", "1 on file"]],
    // Re-aimed by Build -126: the platform-numbers answer now
    // leads with the Admin home strip's two numbers (creators
    // signed up = approved + pending; total followers as
    // reported by creators) instead of the raw record count.
    ["give me the platform numbers", ["Platform totals", "7 creators signed up (4 approved, 3 pending, 24,400 total followers as reported by creators; 3 finished profiles)", "2 businesses (0 active)"]],
    ["how many creators are rejected", ["1 creator rejected, out of 8 in total"]],
  ]);
  // fragment follow-up: market re-scope of the previous question
  const fu = await ask(admin, "and in Richmond?", [{ who: "user", text: "how many creators do i have" }, { who: "sig", text: "8 creators in total." }]);
  check("[admin] follow-up 'and in Richmond?' re-scopes the count", fu.data.source === "data" && (fu.data.text || "").includes("1 creator in Richmond") && (fu.data.text || "").includes("1 approved"), JSON.stringify(fu.data).slice(0, 220));
  // canon / out-of-scope must NOT be claimed by the data layer
  for (const q of ["how do approvals work", "what is the weather today", "how do partners work"]) {
    const r = await ask(admin, q);
    check(`[admin] "${q}" is not a data question (falls through)`, r.status === 200 && r.data.source === "unavailable", `source=${r.data && r.data.source}`);
  }

  console.log("== BUSINESS battery (15) ==");
  const runBiz = batteryRunner("business");
  await runBiz(cafe.client, [
    ["how many visits do i have left", ["10 visits left this month", "used 0 of 10", "Growth"]],
    ["what plan am i on", ["You are on Growth", "$349 a month", "10 creator visits a month"]],
    ["what about my founding credit", ["$100 off your first month", "$249", "nothing is charged"]],
    ["how many applicants are waiting on me", ["No applicants are waiting on you right now"]],
    ["how many offers do i have live", ["0 offers live", "0 in draft", "opening day"]],
    ["how are my results", ["Nothing counted yet", "no visits have run"]],
    ["how many creators are in my market", ["1 creator with finished profiles", "Virginia Beach", "Booking opens when your market activates"]],
    ["show me my numbers", ["Your numbers:", "10 of 10 visits left this month on Growth"]],
    ["how many visits have i booked", ["0 visits booked so far"]],
    ["how many licenses do i have", ["Your licenses: 0 granted"]],
    ["do i have any draft offers", ["0 in draft"]],
    ["who can i book in my market", ["finished profiles on the roster"]],
    ["what is my plan price", ["You are on Growth", "$349"]],
    ["how many visits have i used this month", ["0 visits booked so far"]],
    ["how many applicants do i have waiting", ["No applicants are waiting"]],
  ]);
  for (const q of ["what does signl cost", "when does my market open"]) {
    const r = await ask(cafe.client, q);
    check(`[business] "${q}" stays canon (not claimed by data layer)`, r.status === 200 && r.data.source === "unavailable", `source=${r.data && r.data.source}`);
  }

  console.log("== CREATOR battery (15+) ==");
  const me = await vbFull.client("GET", "/api/auth/me");
  const myPoints = me.data && me.data.user && me.data.user.momentum ? me.data.user.momentum.points : null;
  check("creator /auth/me carries live Momentum points for cross-check", typeof myPoints === "number", JSON.stringify(me.data && me.data.user && me.data.user.momentum).slice(0, 120));
  const runCr = batteryRunner("creator");
  await runCr(vbFull.client, [
    ["how many momentum points do i have", [`${myPoints} Momentum points`, "level"]],
    ["what tier am i", ["You are Locals", "4,200 total followers"]],
    ["what is my local reach", ["61% of your audience is local to Virginia Beach"]],
    ["which markets am i listed in", ["listed in 1 market", "Virginia Beach (61% local)"]],
    ["how many offers are waiting for me", ["No open offers in your markets right now", "Offers deck"]],
    ["are any of my applications pending", ["No applications of yours are waiting"]],
    ["what do i owe", ["0 posts owed", "hard deadline"]],
    ["how much have i earned", ["Recorded: $0 net across 0 paid bookings", "outside the app"]],
    ["is my profile finished", ["Your profile is finished", "businesses can see you"]],
    ["how many people signed up through my link", ["0 creators joined through your invite link"]],
    ["what is my rate", ["No paid rate on your profile yet", "$50 floor"]],
    ["show me my numbers", ["Your numbers:", "Momentum points"]],
    ["what level am i", ["You are", "points"]],
    ["how many visits do i have booked", ["visits booked and coming up", "0 posts owed"]],
    ["how many applications have i got waiting", ["answer within 2 business days"]],
  ]);
  const why = await ask(vbFull.client, "why did my momentum go up");
  check("[creator] 'why did my momentum go up' answers from the ledger", why.data.source === "data" && ((why.data.text || "").includes("most recent points") || (why.data.text || "").includes("No points on your ledger yet")), JSON.stringify(why.data).slice(0, 200));
  const inc = await ask(vbInc.client, "is my profile finished");
  check("[creator] incomplete profile names what is missing", inc.data.source === "data" && (inc.data.text || "").includes("not finished yet") && (inc.data.text || "").includes("businesses cannot see you"), JSON.stringify(inc.data).slice(0, 240));
  for (const q of ["how does momentum work", "how do i make money"]) {
    const r = await ask(vbFull.client, q);
    check(`[creator] "${q}" stays canon (not claimed by data layer)`, r.status === 200 && r.data.source === "unavailable", `source=${r.data && r.data.source}`);
  }
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
}

// ================= PHASE B: stub AI provider =================
let lastRequest = null;
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    lastRequest = JSON.parse(body || "{}");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Approvals run through the Review queue: pending applications get a decision, and every applicant is owed an answer within 2 business days." } }] }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
server = bootServer({ SIG_AI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`, SIG_AI_API_KEY: "stub-key", SIG_AI_MODEL: "stub-model" });
try {
  check("phase B: server boots (stub AI configured)", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const dq = await ask(admin, "how many total creators do i have");
  check("[phase B] data question still wins over the model", dq.data.source === "data" && (dq.data.text || "").includes("8 creators in total"), JSON.stringify(dq.data).slice(0, 160));
  const cq = await ask(admin, "how do approvals work");
  check("[phase B] canon question reaches the model", cq.status === 200 && cq.data.source === "ai", JSON.stringify(cq.data).slice(0, 160));
  const sys = lastRequest && lastRequest.messages && lastRequest.messages[0] ? lastRequest.messages[0].content : "";
  check("[phase B] model grounding carries the live fact sheet (totals)", sys.includes("8 creators in total: 4 approved, 3 pending, 1 rejected"), sys.slice(0, 300));
  check("[phase B] model grounding carries the by-market sheet", sys.includes("Virginia Beach 4/2/1") && sys.includes("Nashville 2/1/1"), sys.slice(0, 400));
  check("[phase B] model grounding carries the read-only admin rule", sys.includes("read-only"), "");
  const cr = client();
  const login = await cr("POST", "/api/auth/login", { email: "s69vbfull@fixtures.dev", password: "<MASKED_SECRET_002>" });
  check("[phase B] creator login", login.status === 200, String(login.status));
  const mq = await ask(cr, "how do i make money");
  check("[phase B] creator canon question reaches the model", mq.status === 200 && mq.data.source === "ai", JSON.stringify(mq.data).slice(0, 160));
  const csys = lastRequest && lastRequest.messages && lastRequest.messages[0] ? lastRequest.messages[0].content : "";
  check("[phase B] creator grounding carries his own live facts", csys.includes("Their tier is Locals") && csys.includes("4,200 total followers"), csys.slice(-500));
} finally {
  server.kill("SIGTERM");
  stub.close();
}
console.log(`\nverify-build69: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
