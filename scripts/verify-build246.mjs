// verify-build246.mjs — Build -246: the mass-approval latency
// fix (Jeff, 2026-11-21: "Fix it").
//
// What broke on -243 in production: applyReviewDecision243
// committed each decision and then AWAITED the whole downstream
// fan-out on the request path — the -239 duplicate guard's
// whole-log event walk, the ~1,300-record recruiter prospect
// scan, a full user list for the founding-band rank, and a live
// SMTP send — per record, sequentially, inside one bulk request
// the admin client abandons at 20 seconds. Jeff's first mass
// approval approved one record per click, popped an error, and
// two creators got the approval email twice when a re-tap
// outran the guard's scan.
//
// The -243 suite could not see any of this: its store answered
// instantly and its mail send was a stub. This suite is the
// -243 lesson applied — it seeds a store at PRODUCTION SCALE
// (5,200 events, 1,300 prospects, 200 users) and wraps every
// store method with latency representative of Netlify Blobs
// (40ms per call, listKeys 40ms per 1,000 keys, getMany 40ms
// per 12 keys), then proves:
//   A. Source pins — the fan-out lives in one drain, the
//      decision core queues instead of sending, the background
//      function runs the drain, the bulk summary event is
//      best-effort, the client chunks with a longer deadline
//      and an honest timeout note, the Review table carries
//      the ct199 treatment and data-labels.
//   B. A bulk approve of 5 production-shaped records (4
//      creators, 1 business) returns far inside the old 20s
//      client deadline, with ZERO prospect scans and ZERO
//      emails sent on the request path — and 5 fan-out jobs
//      queued. Stack capture on every event:/user:/prospect:
//      read in the window proves none of them passes through
//      the decision path or the guard walk (stray reads trace
//      to fire-and-forget per-request preamble jobs, never to
//      the review code). A second bulk (B2) re-measures.
//   C. The drain then delivers exactly 5 approval emails (one
//      per record, subjects intact), flips the recruiter
//      prospects of the two LINKED creators, and skips the
//      prospect scan for the unlinked one.
//   D. An identical re-submit sends ZERO additional emails;
//      a re-approval seconds after the first (before any
//      drain) also sends zero extra.
//   E. A record whose queue write is lost still gets its
//      email: the drain's reconciliation re-queues it.
//   F. A failing send retries across drains, parks as failed
//      after 5 attempts, and a re-approval after the address
//      is fixed delivers exactly one email.
// Run: node scripts/verify-build246.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build246-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.SIGNL_MAIL_STUB = "1";
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["verify", "admin", "pass"].join("-");
process.env.APP_URL = "https://app.magpielocal.com";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";

// --- Seed the event log at production scale BEFORE boot -----
// 5,200 filler events spread over the last 21 days, in the
// store's own key shape (event:{ISO timestamp}:{seq}).
const seedDb = {};
{
  const now = Date.now();
  const span = 21 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < 5200; i += 1) {
    const iso = new Date(now - Math.floor((i * span) / 5200)).toISOString();
    const key = `event:${iso}:${String(900000 - i).padStart(6, "0")}`;
    seedDb[key] = { id: key, type: "session_started", createdAt: iso, actorId: null, actorRole: null, subjectId: null, market: null, data: {} };
  }
}
fs.writeFileSync(DB_PATH, JSON.stringify(seedDb));

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");
const { runApprovalFanout246 } = require("../netlify/functions/lib/router.js");
const root = process.cwd();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const count = (src, needle) => src.split(needle).length - 1;

// --- A: source pins -------------------------------------------
console.log("== A: source pins ==");
check("build stamp is 2026.11.21-246 and agrees in both homes",
  (() => { const a = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").match(/BUILD_ID = "2026\.11\.21-(\d+)"/); const b = fs.readFileSync(path.join(root, "public/index.html"), "utf8").match(/window\.__SIGNL_BUILD__ = "2026\.11\.21-(\d+)"/); return !!a && !!b && a[1] === b[1] && Number(a[1]) === 246; })(), "");

const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("the deferred fan-out exists: queue, drain, reconcile",
  routerSrc.includes("async function queueApprovalFanout246(target, actor)")
  && routerSrc.includes("async function runApprovalFanout246()")
  && routerSrc.includes("async function reconcileApprovalFanout246()"), "");
check("the drain is exported for the background function",
  routerSrc.includes("runApprovalFanout246,"), "");
const decisionCore = routerSrc.slice(routerSrc.indexOf("async function applyReviewDecision243(b)"), routerSrc.indexOf('type: "applications_bulk_approved"'));
check("the decision core sends NO approval email inline anymore",
  !decisionCore.includes('deliverEmail("approval"'), "");
check("the decision core queues the fan-out for BOTH roles",
  count(decisionCore, "await queueApprovalFanout246(target, user)") === 2, `${count(decisionCore, "await queueApprovalFanout246(target, user)")}`);
check("the decision core holds NO fan-out calls at all (no ranks, no prospect flip, no roster drop)",
  !decisionCore.includes("allUsers(") && !decisionCore.includes("creatorRanks(")
  && !decisionCore.includes("onCreatorApproved") && !decisionCore.includes("recordRosterDrop"), "");
check("the duplicate guard is checked at send time inside the drain",
  routerSrc.slice(routerSrc.indexOf("async function runApprovalFanout246()"), routerSrc.indexOf("async function runApprovalFanout246()") + 9000).includes("await approvalEmailAlreadySent239(target.id)"), "");
check("the bulk summary event is best-effort (guarded)",
  routerSrc.includes("Magpie bulk approval summary event failed:"), "");
const bgSrc = fs.readFileSync(path.join(root, "netlify/functions/admin-home-refresh-background.js"), "utf8");
check("the background function runs the drain in its own guarded block",
  bgSrc.includes("runApprovalFanout246") && bgSrc.includes("Magpie approval fan-out drain:"), "");
const recruitersSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/recruiters.js"), "utf8");
check("recruiters exposes the credit set for the linkage gate",
  recruitersSrc.includes("async function creditUserIds()"), "");

const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
check("client: api() accepts a per-call deadline",
  appSrc.includes("async function api(method, path, body, opts)")
  && appSrc.includes("const deadlineMs = (opts && opts.deadlineMs) || (isGet ? 12000 : 20000);"), "");
check("client: the bulk approve chunks by 10 with a 60s deadline and progress",
  appSrc.includes("for (let at = 0; at < ids.length; at += 10)")
  && appSrc.includes('api("POST", "/admin/review/bulk", { userIds: chunkIds }, { deadlineMs: 60000 })')
  && appSrc.includes("Approving ${Math.min(at + 10, ids.length)} of ${ids.length}..."), "");
check("client: a bulk timeout reads as partial progress, never total failure",
  appSrc.includes("The connection timed out partway through.")
  && appSrc.includes("Some approvals may have gone through"), "");
check("client: the Review table carries ct199 and data-labels",
  appSrc.includes('<div class="table-wrap ct199 panel"><table class="apps-table apps-table-243">')
  && appSrc.includes('<td data-label="Name / handle">')
  && appSrc.includes('<td data-label="Followers">')
  && appSrc.includes('<td data-label="Claimed">'), "");

// --- Harness (the -243 in-process client) ----------------------
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method, path: url.pathname, headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body), isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = res.body; }
    return { status: res.statusCode, data };
  };
}
async function allEvents() {
  const rows = await store.list("event:");
  return rows.map((r) => r.value).filter(Boolean);
}
const approvalMailsFor = async (userId) => (await allEvents()).filter((e) => e.subjectId === userId && e.type === "approval_email_sent");
const jobFor = (userId) => store.get(`approvalfanout:${userId}`);

const admin = makeClient();
const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
check("admin signs in", login.status === 200, `${login.status}`);

async function claimCreator(handle, followers, email) {
  const c = makeClient();
  const reg = await c("POST", "/api/auth/register", { role: "creator", quickClaim: true, handle, market: "Nashville", email: email || `${handle}@fixtures.dev`, password: [handle, "pass", "123"].join("-"), agreedTerms: true, agreedPostCompliance: true, followerCount: followers, localAudiencePct: 40 });
  return { client: c, reg, id: reg.data && reg.data.user && reg.data.user.id };
}

// Fixtures: A (recruiterId linkage), B (credit linkage),
// C (a claimed prospect but NO linkage — the skip case),
// D (plain), F (seconds-apart), G (stranded), H (failing send).
const fxA = await claimCreator("lat246a", 2400);
const fxB = await claimCreator("lat246b", 2400);
const fxC = await claimCreator("lat246c", 2400);
const fxD = await claimCreator("lat246d", 2400);
const fxF = await claimCreator("lat246f", 2400);
const fxG = await claimCreator("lat246g", 2400);
const fxH = await claimCreator("lat246h", 2400, "stubfail246h@fixtures.dev");
for (const [label, f] of [["A", fxA], ["B", fxB], ["C", fxC], ["D", fxD], ["F", fxF], ["G", fxG], ["H", fxH]]) {
  check(`fixture creator ${label} claims a spot`, f.reg.status === 201 && !!f.id, `${f.reg.status}`);
}
const bizClient = makeClient();
const bizReg = await bizClient("POST", "/api/auth/register", { role: "business", name: "Bea Owner", email: "bea246@fixtures.dev", password: ["bea246", "pass", "123"].join("-"), businessName: "Bea's Books 246", category: "Retail", market: "Nashville", city: "Nashville", agreedTerms: true });
const bizId = bizReg.data && bizReg.data.user && bizReg.data.user.id;
check("fixture business registers", bizReg.status === 201 && !!bizId, `${bizReg.status}`);

// Scale: 200 approved users + 1,300 prospects, seeded straight
// into the store (no latency yet).
{
  const template = await store.get(`user:${fxD.id}`);
  for (let i = 0; i < 200; i += 1) {
    const id = `usr_seed246_${String(i).padStart(3, "0")}`;
    await store.set(`user:${id}`, { ...template, id, email: `seed246_${i}@fixtures.dev`, name: `Seed Creator ${i}`, status: "approved", createdAt: new Date(Date.now() - (i + 2) * 86400000).toISOString(), creator: { ...(template.creator || {}), handle: `seed246_${i}` } });
  }
  for (let i = 0; i < 1300; i += 1) {
    const id = `prosp_seed246_${String(i).padStart(4, "0")}`;
    await store.set(`prospect:${id}`, { id, name: `Seed Prospect ${i}`, status: "claimed", linkedUserId: null, market: "Nashville" });
  }
  // Linkage: A carries a stamped recruiterId + a claimed
  // prospect; B carries a credit record + a claimed prospect;
  // C carries ONLY a claimed prospect (no linkage the gate
  // accepts), so the drain must skip its prospect scan.
  const recA = await store.get(`user:${fxA.id}`);
  recA.recruiterId = "rec_seed246";
  await store.set(`user:${fxA.id}`, recA);
  await store.set("prospect:prosp_link246a", { id: "prosp_link246a", name: "Link A", status: "claimed", linkedUserId: fxA.id, market: "Nashville" });
  await store.set("prospect:prosp_link246b", { id: "prosp_link246b", name: "Link B", status: "claimed", linkedUserId: fxB.id, market: "Nashville" });
  await store.set("rcredit:seed246b", { id: "seed246b", userId: fxB.id, recruiterId: "rec_seed246", prospectId: "prosp_link246b" });
  await store.set("prospect:prosp_link246c", { id: "prosp_link246c", name: "Link C", status: "claimed", linkedUserId: fxC.id, market: "Nashville" });
  check("production scale seeded: 5,200 events, 1,300 prospects, 200 users",
    (await store.listKeys("event:")).length >= 5200
    && (await store.listKeys("prospect:")).length >= 1300
    && (await store.listKeys("user:")).length >= 200, "");
}

// --- Production latency wrapper --------------------------------
// Netlify Blobs, modeled: 40ms per point call; listKeys and
// list cost 40ms per 1,000 keys; getMany costs 40ms per 12
// keys (its internal fetch concurrency). Counters record every
// prefix read so the suite can prove what the request path
// did NOT do.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const orig = { get: store.get, set: store.set, del: store.del, list: store.list, listKeys: store.listKeys, getMany: store.getMany };
let counters = null;
function resetCounters() { counters = { get: 0, set: 0, del: 0, listKeys: [], list: [], getMany: 0, stacks: [], keyStacks: [] }; }
store.get = async (k) => { if (counters) counters.get += 1; await sleep(40); return orig.get(k); };
store.set = async (k, v) => { if (counters) counters.set += 1; await sleep(40); return orig.set(k, v); };
store.del = async (k) => { if (counters) counters.del += 1; await sleep(40); return orig.del(k); };
store.listKeys = async (p) => { if (counters) { counters.listKeys.push(p); if (typeof p === "string" && p.startsWith("event:")) counters.keyStacks.push({ prefix: p, stack: new Error("trace").stack || "" }); } const out = await orig.listKeys(p); await sleep(40 * Math.max(1, Math.ceil(out.length / 1000))); return out; };
store.list = async (p) => { if (counters) { counters.list.push(p); if (p === "user:" || p === "prospect:") counters.stacks.push({ prefix: p, stack: new Error("trace").stack || "" }); } const out = await orig.list(p); await sleep(40 * Math.max(1, Math.ceil(out.length / 1000))); return out; };
store.getMany = async (keys) => { if (counters) counters.getMany += 1; await sleep(40 * Math.max(1, Math.ceil((keys || []).length / 12))); return orig.getMany(keys); };
function unwrapStore() { Object.assign(store, orig); }

// Warm-up: one ordinary admin read so per-request preamble
// jobs and memos settle before the measured call.
await admin("GET", "/api/admin/applications");

// --- B: the bulk call under production latency -----------------
console.log("== B: bulk approve of 5 under production latency ==");
const five = [fxA.id, fxB.id, fxC.id, fxD.id, bizId];
resetCounters();
const t0 = Date.now();
const bulk = await admin("POST", "/api/admin/review/bulk", { userIds: five });
const bulkMs = Date.now() - t0;
check("bulk approve of 5 returns 200 with approved=5", bulk.status === 200 && bulk.data.approved === 5 && bulk.data.total === 5, `${bulk.status} ${JSON.stringify(bulk.data).slice(0, 200)}`);
check(`bulk approve returns far inside the old 20s client deadline (took ${bulkMs}ms)`, bulkMs < 20000, `${bulkMs}ms`);
check("no event-log read in the window came from the decision path or the guard walk (stacks)",
  // Fire-and-forget preamble jobs can read today's event keys
  // inside any request window (proven by stack capture: they
  // trace to sweeps, never to the review code); what must
  // never happen on this path is listEventsForSubject, the
  // whole-log walk behind the -239 guard.
  counters.keyStacks.every((s) => !s.stack.includes("applyReviewDecision243") && !s.stack.includes("listEventsForSubject")), JSON.stringify(counters.keyStacks.map((s) => s.prefix)));
check("the request path ran NO prospect scan",
  !counters.list.some((p) => p === "prospect:"), JSON.stringify(counters.list));
check("no user: or prospect: list in the window passed through the decision path (stacks)",
  counters.stacks.every((s) => !s.stack.includes("applyReviewDecision243")), JSON.stringify(counters.stacks.map((s) => s.prefix)));
// Note on the user: lists a bulk window can show: route()'s
// preamble fires throttled maybe* jobs (never awaited) on
// EVERY request, and Biz Dev's findAccountStable lists user:
// through allUsers — proven by stack capture during a bulk
// call (bizdev.js -> allUsers; the decision core never
// appears). The stack assertion below pins exactly that: no
// user: or prospect: list in the window may pass through
// applyReviewDecision243.
check("NO approval email was sent on the request path", (await approvalMailsFor(fxA.id)).length === 0
  && (await approvalMailsFor(bizId)).length === 0, "");
let jobsPending = 0;
for (const id of five) { const j = await jobFor(id); if (j && j.state === "pending") jobsPending += 1; }
check("5 fan-out jobs are queued, one per record", jobsPending === 5, `${jobsPending}`);

// --- C: the drain delivers, exactly once each ------------------
console.log("== C: the drain delivers ==");
resetCounters();
const drain1 = await runApprovalFanout246();
check("the drain ran the 5 queued jobs", drain1.due === 5 && drain1.sent === 5, JSON.stringify(drain1));
check("the expensive guard walk DID happen, here off the request path",
  counters.listKeys.some((p) => p === "event:"), JSON.stringify(counters.listKeys.slice(0, 5)));
let mailsOk = true;
for (const f of [fxA, fxB, fxC, fxD]) {
  const mails = await approvalMailsFor(f.id);
  if (mails.length !== 1 || !mails[0].data || mails[0].data.subject !== "You are approved. Welcome to Magpie.") mailsOk = false;
}
check("each creator got exactly one approval email, subject intact", mailsOk, "");
const bizMails = await approvalMailsFor(bizId);
check("the business got exactly one approval email of its own", bizMails.length === 1 && !!bizMails[0].data && bizMails[0].data.subject === "You are in. Welcome to Magpie.", JSON.stringify(bizMails.map((m) => m.data && m.data.subject)));
let jobsDone = 0;
for (const id of five) { const j = await jobFor(id); if (j && j.state === "done") jobsDone += 1; }
check("all 5 jobs are done after the drain", jobsDone === 5, `${jobsDone}`);
const prospA = await store.get("prospect:prosp_link246a");
const prospB = await store.get("prospect:prosp_link246b");
const prospC = await store.get("prospect:prosp_link246c");
check("recruiter prospects flipped for the two LINKED creators (recruiterId and credit)",
  !!prospA && prospA.status === "approved" && !!prospB && prospB.status === "approved", `${prospA && prospA.status} / ${prospB && prospB.status}`);
check("the UNLINKED creator's prospect was NOT flipped (the scan was skipped)",
  !!prospC && prospC.status === "claimed", prospC && prospC.status);

// --- B2: a second bulk, preamble settled — the strict profile --
console.log("== B2: second bulk approve of 5, strict counter profile ==");
const fxI = await claimCreator("lat246i", 2400);
const fxJ = await claimCreator("lat246j", 2400);
const fxK = await claimCreator("lat246k", 2400);
const fxL = await claimCreator("lat246l", 2400);
const biz2Client = makeClient();
const biz2Reg = await biz2Client("POST", "/api/auth/register", { role: "business", name: "Bea Owner", email: "bea246b@fixtures.dev", password: ["bea246b", "pass", "123"].join("-"), businessName: "Bea's Books 246 B", category: "Retail", market: "Nashville", city: "Nashville", agreedTerms: true });
const biz2Id = biz2Reg.data && biz2Reg.data.user && biz2Reg.data.user.id;
check("second-batch fixtures register", !!(fxI.id && fxJ.id && fxK.id && fxL.id && biz2Id), "");
const five2 = [fxI.id, fxJ.id, fxK.id, fxL.id, biz2Id];
resetCounters();
const t2 = Date.now();
const bulk2nd = await admin("POST", "/api/admin/review/bulk", { userIds: five2 });
const bulk2Ms = Date.now() - t2;
check("second bulk approve of 5 returns 200 with approved=5", bulk2nd.status === 200 && bulk2nd.data.approved === 5, `${bulk2nd.status}`);
check(`second bulk also returns far inside the deadline (took ${bulk2Ms}ms)`, bulk2Ms < 20000, `${bulk2Ms}ms`);
check("second bulk: no guard walk, NO prospect scan, and no list through the decision path",
  counters.keyStacks.every((s) => !s.stack.includes("applyReviewDecision243") && !s.stack.includes("listEventsForSubject"))
  && !counters.list.some((p) => p === "prospect:")
  && counters.stacks.every((s) => !s.stack.includes("applyReviewDecision243")), JSON.stringify({ listKeys: counters.listKeys, list: counters.list }));
await runApprovalFanout246();
let mails2Ok = true;
for (const id of five2) if ((await approvalMailsFor(id)).length !== 1) mails2Ok = false;
check("the second batch also lands exactly one approval email per record after the drain", mails2Ok, "");

// --- D: re-submits send nothing more ---------------------------
console.log("== D: duplicate safety ==");
const bulkAgain = await admin("POST", "/api/admin/review/bulk", { userIds: five });
await runApprovalFanout246();
let stillFive = 0;
for (const id of five) stillFive += (await approvalMailsFor(id)).length;
check("an identical re-submit approves again but sends ZERO additional emails (both roles)",
  bulkAgain.status === 200 && stillFive === 5, `${bulkAgain.status} total=${stillFive}`);
// Seconds-apart: two single approvals back to back, no drain
// in between — Jeff's double-tap shape from 2026-11-21.
const f1 = await admin("POST", "/api/admin/review", { userId: fxF.id, decision: "approve" });
const f2 = await admin("POST", "/api/admin/review", { userId: fxF.id, decision: "approve" });
await runApprovalFanout246();
check("a re-approval seconds after the first sends exactly ONE email, not two",
  f1.status === 200 && f2.status === 200 && (await approvalMailsFor(fxF.id)).length === 1, `${f1.status}/${f2.status} mails=${(await approvalMailsFor(fxF.id)).length}`);

// --- E: a lost queue write is reconciled -----------------------
console.log("== E: reconciliation ==");
const g1 = await admin("POST", "/api/admin/review", { userId: fxG.id, decision: "approve" });
check("the stranded fixture approved and queued", g1.status === 200 && !!(await jobFor(fxG.id)), `${g1.status}`);
await store.del(`approvalfanout:${fxG.id}`); // the queue write is lost
await store.del("config:approvalFanoutReconcile246"); // the next reconcile window
await runApprovalFanout246();
check("the drain's reconciliation re-queued the lost job and delivered exactly one email",
  (await approvalMailsFor(fxG.id)).length === 1, `mails=${(await approvalMailsFor(fxG.id)).length}`);

// --- F: failing sends retry, park, and recover -----------------
console.log("== F: send failure handling ==");
await admin("POST", "/api/admin/review", { userId: fxH.id, decision: "approve" });
await runApprovalFanout246();
let jobH = await jobFor(fxH.id);
check("a failing send leaves the job pending for retry, with no email sent",
  !!jobH && jobH.state === "pending" && jobH.attempts === 1 && (await approvalMailsFor(fxH.id)).length === 0, JSON.stringify(jobH));
for (let i = 0; i < 4; i += 1) await runApprovalFanout246();
jobH = await jobFor(fxH.id);
check("after 5 attempts the job parks as failed (never dropped, never sent)",
  !!jobH && jobH.state === "failed" && jobH.attempts === 5 && (await approvalMailsFor(fxH.id)).length === 0, JSON.stringify(jobH));
const recH = await store.get(`user:${fxH.id}`);
recH.email = "lat246h-fixed@fixtures.dev";
await store.set(`user:${fxH.id}`, recH);
await admin("POST", "/api/admin/review", { userId: fxH.id, decision: "approve" });
await runApprovalFanout246();
check("a re-approval after the address is fixed delivers exactly one email",
  (await approvalMailsFor(fxH.id)).length === 1, `mails=${(await approvalMailsFor(fxH.id)).length}`);

unwrapStore();
console.log(`\nverify-build246: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
