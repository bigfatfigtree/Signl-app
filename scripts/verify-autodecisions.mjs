// SIGNL claim auto-decisions verification (Jeff standing
// authority, 2026-10-22). The rules are INTERNAL ONLY: nothing
// about them may appear in public copy, creator emails or any
// non-admin payload.
//
// Phase 1 (fresh store): decisions at sign-up time.
//   - Rule A approve: handle + email match the evidenced outreach
//     records (campaign batch snapshot).
//   - Rule B approve: a personal claim link was verifiably sent to
//     the handle + market (DM claim sprint snapshot).
//   - A matched claim that arrives WITH a referral stays manual.
//   - An unmatched claim stays manual (and can still be approved
//     by hand afterwards, unchanged behavior).
//   - example.com auto-rejects; known-test email/handle
//     auto-rejects; auto-approve fires the approval side effects
//     exactly once; auto-reject fires none of them; the markers
//     never leak into the claimant's own payload.
//
// Phase 2 (pre-seeded store, the production shapes): the one-time
// cleanup pass decides the pending records that predate the
// rules, including a pending @mr.5starzay whose personal claim
// link went out in the DM sprint (Rule B), the five legacy test
// records, and a read-only confirmation of the designated tester.
//
// Run: node scripts/verify-autodecisions.mjs

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";

const PORT = 8953;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(tmpdir(), `signl-autodecisions-${Date.now()}.json`);
const DB2 = path.join(tmpdir(), `signl-autodecisions2-${Date.now()}.json`);
let passed = 0, failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.log(`  FAIL - ${name} ${extra}`); }
}

class Client {
  constructor() { this.cookies = new Map(); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
function startServer(db, port) {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, ADMIN_EMAIL: "jeff@joinsignl.com", ADMIN_PASSWORD: "<MASKED_SECRET_001>", APP_URL: `http://127.0.0.1:${port}`, SIGNL_TEST_ALLOW_BUSINESS: "1" };
  return spawn("node", ["scripts/dev-server.mjs", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
}
async function waitUp(label) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${label} server did not come up on ${BASE}`);
}
async function waitUpOn(port) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not come up on ${port}`);
}

console.log("== Phase 1: decisions at sign-up time ==");
let server = startServer(DB, PORT);
let serverErr = "";
server.stderr.on("data", (d) => { serverErr += d; });
try { await waitUp("phase 1"); } catch (e) { console.log(serverErr); throw e; }
const admin = new Client();
{
  const r = await admin.req("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "<MASKED_SECRET_001>" });
  check("admin login", r.status === 200 && r.data && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
}
async function quickClaim(email, handle, market, extra = {}) {
  const c = new Client();
  const r = await c.req("POST", "/api/auth/register", { role: "creator", quickClaim: true, email, password: "<MASKED_SECRET_002>", market, handle, ...AGREE, ...extra });
  return { c, r };
}
async function eventsOf(type) {
  const r = await admin.req("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=500`);
  return (r.data && r.data.events) || [];
}

// (a) Rule A approve: xoxoerinsmith + xoxoerinsmith@gmail.com are
// an evidenced campaign batch pair (Richmond).
const ruleA = await quickClaim("xoxoerinsmith@gmail.com", "xoxoerinsmith", "Richmond");
check("rule A: claim registers", ruleA.r.status === 201, `status=${ruleA.r.status}`);
check("rule A: approved at sign-up", ruleA.r.data.user.status === "approved", `status=${ruleA.r.data.user && ruleA.r.data.user.status}`);
check("rule A: no internal markers in the claimant payload", !("approvedBy" in ruleA.r.data.user) && !("decisionReason" in ruleA.r.data.user));
const ruleAId = ruleA.r.data.user.id;
{
  const approved = (await eventsOf("application_approved")).filter((e) => e.subjectId === ruleAId);
  check("rule A: exactly one application_approved event", approved.length === 1, `n=${approved.length}`);
  check("rule A: event carries the rule marker", approved.length === 1 && approved[0].data && approved[0].data.rule === "auto_rule_a" && approved[0].data.approvedBy === "auto_rule_a");
  const queued = (await eventsOf("approval_email_queued")).filter((e) => e.subjectId === ruleAId);
  check("rule A: approval email queued exactly once (standard template path)", queued.length === 1 && queued[0].data.subject === "You are approved: welcome to the SIGNL founding roster", `n=${queued.length} subject=${queued[0] && queued[0].data.subject}`);
  const confirm = (await eventsOf("signup_confirmation_email_queued")).filter((e) => e.subjectId === ruleAId);
  check("rule A: no sign-up confirmation email (approval email replaces it)", confirm.length === 0, `n=${confirm.length}`);
}

// (b) Rule B approve: mr.5starzay's personal claim link went out
// in the DM sprint for Hampton Roads; his email is NOT an
// evidenced pair, so only Rule B can catch him.
const ruleB = await quickClaim("zay@fixtures.dev", "mr.5starzay", "Hampton Roads");
check("rule B: claim registers", ruleB.r.status === 201, `status=${ruleB.r.status}`);
check("rule B: approved at sign-up", ruleB.r.data.user.status === "approved", `status=${ruleB.r.data.user && ruleB.r.data.user.status}`);
check("rule B: no internal markers in the claimant payload", !("approvedBy" in ruleB.r.data.user) && !("decisionReason" in ruleB.r.data.user));
const ruleBId = ruleB.r.data.user.id;
{
  const approved = (await eventsOf("application_approved")).filter((e) => e.subjectId === ruleBId);
  check("rule B: exactly one application_approved event", approved.length === 1, `n=${approved.length}`);
  check("rule B: event carries auto_rule_b", approved.length === 1 && approved[0].data.rule === "auto_rule_b" && approved[0].data.approvedBy === "auto_rule_b");
  const queued = (await eventsOf("approval_email_queued")).filter((e) => e.subjectId === ruleBId);
  check("rule B: approval email queued exactly once", queued.length === 1, `n=${queued.length}`);
}

// (c) Referred but matched: thewestendmom is an evidenced pair
// (Richmond) AND has a sprint link, but the claim carries a
// referral, so it must stay manual, no exceptions.
const referred = await quickClaim("megan@thewestendmom.com", "thewestendmom", "Richmond", { referredBy: "somesponsor" });
check("referred-matched: claim registers", referred.r.status === 201, `status=${referred.r.status}`);
check("referred-matched: stays pending for a person", referred.r.data.user.status === "pending", `status=${referred.r.data.user && referred.r.data.user.status}`);
{
  const approved = (await eventsOf("application_approved")).filter((e) => e.subjectId === referred.r.data.user.id);
  const confirm = (await eventsOf("signup_confirmation_email_queued")).filter((e) => e.subjectId === referred.r.data.user.id);
  check("referred-matched: no approval fired", approved.length === 0, `n=${approved.length}`);
  check("referred-matched: normal sign-up confirmation still queued", confirm.length === 1, `n=${confirm.length}`);
}

// (d) Unmatched claim: no evidence anywhere, stays manual.
const unmatched = await quickClaim("brandnew757@fixtures.dev", "brandnew757", "Hampton Roads");
check("unmatched: stays pending for a person", unmatched.r.status === 201 && unmatched.r.data.user.status === "pending", `status=${unmatched.r.status}/${unmatched.r.data.user && unmatched.r.data.user.status}`);

// (e) example.com auto-reject.
const exDomain = await quickClaim("newbie757@example.com", "newbie757", "Hampton Roads");
check("example.com: claim registers", exDomain.r.status === 201, `status=${exDomain.r.status}`);
check("example.com: rejected at sign-up", exDomain.r.data.user.status === "rejected", `status=${exDomain.r.data.user && exDomain.r.data.user.status}`);
{
  const id = exDomain.r.data.user.id;
  const rej = (await eventsOf("application_rejected")).filter((e) => e.subjectId === id);
  check("example.com: exactly one rejection event, rule auto_test", rej.length === 1 && rej[0].data.rule === "auto_test", `n=${rej.length}`);
  check("example.com: no approval event", (await eventsOf("application_approved")).filter((e) => e.subjectId === id).length === 0);
  check("example.com: no approval email", (await eventsOf("approval_email_queued")).filter((e) => e.subjectId === id).length === 0);
  check("example.com: no sign-up confirmation email", (await eventsOf("signup_confirmation_email_queued")).filter((e) => e.subjectId === id).length === 0);
}

// (f) Known-test email auto-reject (real handle, real-sounding
// domain: only the exact test address matches).
const testEmail = await quickClaim("testclaim@example.com", "realperson757", "Hampton Roads");
check("known-test email: rejected at sign-up", testEmail.r.status === 201 && testEmail.r.data.user.status === "rejected", `status=${testEmail.r.data.user && testEmail.r.data.user.status}`);

// (g) Known-test handle auto-reject.
const testHandle = await quickClaim("casey@fixtures.dev", "tiertest", "Dubai", { name: "Casey Rivers" });
check("known-test handle: rejected at sign-up", testHandle.r.status === 201 && testHandle.r.data.user.status === "rejected", `status=${testHandle.r.data.user && testHandle.r.data.user.status}`);

// Admin view: pending shows manual items only; decided rows carry
// the markers (admin payload only); the strip counts them.
{
  const r = await admin.req("GET", "/api/admin/applications");
  check("admin applications loads", r.status === 200, `status=${r.status}`);
  const pendingIds = (r.data.pending || []).map((u) => u.id);
  check("pending queue: referred claim waits for a person", pendingIds.includes(referred.r.data.user.id));
  check("pending queue: unmatched claim waits for a person", pendingIds.includes(unmatched.r.data.user.id));
  check("pending queue: auto-decided claims are not actionable pending items", !pendingIds.includes(ruleAId) && !pendingIds.includes(ruleBId) && !pendingIds.includes(exDomain.r.data.user.id));
  const decided = Object.fromEntries((r.data.decided || []).map((u) => [u.id, u]));
  check("admin decided row: rule A marker visible to admin", decided[ruleAId] && decided[ruleAId].approvedBy === "auto_rule_a", `approvedBy=${decided[ruleAId] && decided[ruleAId].approvedBy}`);
  check("admin decided row: rule B marker visible to admin", decided[ruleBId] && decided[ruleBId].approvedBy === "auto_rule_b");
  check("admin decided row: auto_test reason visible to admin", decided[exDomain.r.data.user.id] && decided[exDomain.r.data.user.id].decisionReason === "auto_test");
  const auto = r.data.summary && r.data.summary.auto;
  check("strip auto counts: 2 approved, 3 rejected, all today", !!auto && auto.approved === 2 && auto.rejected === 3 && auto.approvedToday === 2 && auto.rejectedToday === 3, `auto=${JSON.stringify(auto)}`);
}

// Exactly-once: re-running the pass over decided records must not
// re-fire anything, and manual review still works afterwards.
{
  const r = await admin.req("POST", "/api/admin/auto-decisions/run", {});
  check("cleanup re-run endpoint responds", r.status === 200 && r.data && r.data.audit, `status=${r.status}`);
  check("cleanup re-run decides nothing new", r.data.audit.decidedCount === 0, `decided=${r.data.audit && r.data.audit.decidedCount}`);
  const approved = (await eventsOf("application_approved")).filter((e) => e.subjectId === ruleAId);
  const queued = (await eventsOf("approval_email_queued")).filter((e) => e.subjectId === ruleAId);
  check("side effects stay exactly once after a re-run", approved.length === 1 && queued.length === 1, `approved=${approved.length} queued=${queued.length}`);
  const manual = await admin.req("POST", "/api/admin/review", { userId: unmatched.r.data.user.id, decision: "approve" });
  check("manual approval of an unmatched claim still works", manual.status === 200 && manual.data.user && manual.data.user.status === "approved", `status=${manual.status} userStatus=${manual.data && manual.data.user && manual.data.user.status}`);
  const referredRow = await admin.req("GET", "/api/admin/applications");
  check("referred claim still pending after all passes", (referredRow.data.pending || []).some((u) => u.id === referred.r.data.user.id));
}
server.kill();

console.log("== Phase 2: one-time cleanup over pre-existing records ==");
// Seed the store the way production records actually look: quick
// claims that predate the rules, still pending, plus the named
// legacy test records and the designated tester.
function seedCreator(id, { name, email, market, handle, status = "pending", tester = false, createdAt }) {
  return {
    id, role: "creator", email, name, passwordSalt: "seed", passwordHash: "seed",
    status, tester, market, city: "", state: null, country: "", createdAt, updatedAt: createdAt,
    reviewedAt: status === "pending" ? null : createdAt, reviewedBy: status === "pending" ? null : "seed",
    termsVersion: "2026-10-19", termsAcceptedAt: createdAt, marketingEmailConsent: false, marketingConsentAt: null,
    signupPath: "quick_claim", signupSource: null, referredBy: null,
    creator: {
      handle, instagramUrl: `https://www.instagram.com/${handle}/`, tiktokHandle: null, tiktokUrl: null,
      youtubeHandle: null, youtubeUrl: null, otherHandle: null, otherUrl: null,
      followerCount: 0, audienceStack: {}, totalAudience: 0, avgViews: 0,
      tierBand: "Neighbors", suggestedTier: "Neighbors", computedTier: "Neighbors",
      categories: [], compCategories: [], openToPaidCampaigns: false, compOpen: true, paidRate: null,
      bio: "", bestWork: [], maxVisitsPerWeek: 3, neighborhood: "", localAudiencePct: null,
      cityTop1: null, cityTop2: null, cityTop3: null, contactHandle: null,
      profileComplete: false, profileCompletedAt: null,
      handles: { instagram: handle, tiktok: "", youtube: "", other: "" }, audience: { instagram: 0, tiktok: 0, youtube: 0, other: 0 },
    },
    business: null,
  };
}
const seeds = [
  seedCreator("seed-zay", { name: "mr.5starzay", email: "mr5starzay@fixtures.dev", market: "Hampton Roads", handle: "mr.5starzay", createdAt: "2026-10-20T17:02:00.000Z" }),
  seedCreator("seed-emailtest", { name: "Email Test", email: "emailtest@fixtures.dev", market: "Dubai", handle: "emailtest1", createdAt: "2026-10-15T10:00:00.000Z" }),
  seedCreator("seed-emailtest2", { name: "Email Test 2", email: "emailtest2@fixtures.dev", market: "Dubai", handle: "emailtest2", createdAt: "2026-10-15T10:05:00.000Z" }),
  seedCreator("seed-casey", { name: "Casey Rivers", email: "casey@fixtures.dev", market: "Hampton Roads", handle: "tiertest", createdAt: "2026-10-15T11:00:00.000Z" }),
  seedCreator("seed-jamie", { name: "Jamie Fox", email: "jamie@fixtures.dev", market: "Hampton Roads", handle: "localtest", createdAt: "2026-10-15T11:05:00.000Z" }),
  seedCreator("seed-signltest", { name: "signltestclaim", email: "testclaim@example.com", market: "Hampton Roads", handle: "signltestclaim", createdAt: "2026-10-15T11:10:00.000Z" }),
  seedCreator("seed-tony", { name: "Tony Johnson", email: "tony@langstondigital.com", market: "Hampton Roads", handle: "tonyjohnson374", status: "approved", tester: true, createdAt: "2026-10-16T12:00:00.000Z" }),
  seedCreator("seed-waiting", { name: "waiting757", email: "waiting757@fixtures.dev", market: "Hampton Roads", handle: "waiting757", createdAt: "2026-10-19T09:00:00.000Z" }),
];
{
  const data = {};
  for (const u of seeds) data[`user:${u.id}`] = u;
  fs.writeFileSync(DB2, JSON.stringify(data));
}
const PORT2 = 8954;
const BASE2 = `http://127.0.0.1:${PORT2}`;
let server2 = startServer(DB2, PORT2);
let server2Err = "";
server2.stderr.on("data", (d) => { server2Err += d; });
try { await waitUpOn(PORT2); } catch (e) { console.log(server2Err); throw e; }
// A couple of plain requests: the pass fires opportunistically.
await fetch(`${BASE2}/api/bootstrap`);
await fetch(`${BASE2}/api/bootstrap`);
const dbAfter = JSON.parse(fs.readFileSync(DB2, "utf8"));
const rec = (id) => dbAfter[`user:${id}`];
{
  const zay = rec("seed-zay");
  check("cleanup: pending @mr.5starzay auto-approved under Rule B", zay.status === "approved" && zay.approvedBy === "auto_rule_b" && zay.reviewedBy === "system", `status=${zay.status} approvedBy=${zay.approvedBy}`);
  const evts = Object.values(dbAfter).filter((v) => v && typeof v === "object" && v.type);
  check("cleanup: Zay approval event logged once, rule B", evts.filter((e) => e.type === "application_approved" && e.subjectId === "seed-zay").length === 1 && evts.find((e) => e.type === "application_approved" && e.subjectId === "seed-zay").data.approvedBy === "auto_rule_b");
  check("cleanup: Zay approval email queued once", evts.filter((e) => e.type === "approval_email_queued" && e.subjectId === "seed-zay").length === 1);
  const named = [
    ["seed-emailtest", "Email Test"], ["seed-emailtest2", "Email Test 2"], ["seed-casey", "Casey Rivers (@tiertest)"],
    ["seed-jamie", "Jamie Fox (@localtest)"], ["seed-signltest", "@signltestclaim (testclaim@example.com)"],
  ];
  for (const [id, label] of named) {
    const u = rec(id);
    check(`cleanup: ${label} rejected as test with the audit note`, u.status === "rejected" && u.decisionReason === "auto_test" && u.decisionNote === "cleanup 2026-10-22, Jeff standing authority", `status=${u.status} reason=${u.decisionReason}`);
    check(`cleanup: ${label} got no approval email`, evts.filter((e) => e.type === "approval_email_queued" && e.subjectId === id).length === 0);
  }
  const tony = rec("seed-tony");
  check("cleanup: designated tester untouched (approved, tester flag on, no decision markers)", tony.status === "approved" && tony.tester === true && !tony.decisionReason && !tony.approvedBy);
  const waiting = rec("seed-waiting");
  check("cleanup: unmatched pending record stays pending", waiting.status === "pending" && !waiting.approvedBy && !waiting.decisionReason);
  const cfg = dbAfter["config:autoDecisionCleanupV1"];
  check("cleanup: audit stored and marked done", !!cfg && cfg.done === true && !!cfg.audit);
  if (cfg && cfg.audit) {
    check("cleanup: audit decided exactly 6 (1 approved, 5 rejected)", cfg.audit.decidedCount === 6 && cfg.audit.approvedCount === 1 && cfg.audit.rejectedCount === 5, `decided=${cfg.audit.decidedCount} approved=${cfg.audit.approvedCount} rejected=${cfg.audit.rejectedCount}`);
    check("cleanup: all five named records found in the audit", cfg.audit.namedRecords.every((n) => n.found === true) && cfg.audit.namedRecords.length === 5, JSON.stringify(cfg.audit.namedRecords.map((n) => [n.label, n.found])));
    check("cleanup: audit confirms the tester, unchanged", cfg.audit.tonyJohnson.found === true && cfg.audit.tonyJohnson.tester === true && cfg.audit.tonyJohnson.changed === false);
  }
}
server2.kill();

console.log("== Admin UI copy (internal surface only) ==");
{
  const appJs = fs.readFileSync("public/app.js", "utf8");
  check("app.js: roster strip gained the auto-decided line", appJs.includes("Auto-decided under the standing rules"));
  check("app.js: referred claims still labelled in the queue", appJs.includes("Via referral: @${esc(u.referredBy)}"));
}
console.log(`\nAUTO-DECISIONS SUITE: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", fails.join(" | ")); process.exit(1); }
