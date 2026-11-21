// verify-build234.mjs — Build -234: the market-segment send
// finishes inside a normal request budget, and its receipt
// is written reliably.
// The 2026-11-21 group-invite run delivered into every
// thread, yet (a) every segment send ended on the admin
// client with "We could not reach Magpie" after its deadline
// and never showed the sent/email counts, and (b) the "Sent
// to many" history has NO receipt for the last 11 markets of
// the run (Toronto through Nashville — the larger segments).
// Root cause, read off the pre-fix handler: the fan-out ran
// strictly serially, and each recipient's send paid, one at
// a time, its own store round trips, a suppression check
// that listed the ENTIRE append-only event-log keyspace
// (listEventsForSubject opens with store.listKeys("event:"))
// plus chunked fetches, and a fresh SMTP session — while the
// pmcampaign receipt and the HTTP response were produced
// only AFTER the whole loop. Any segment whose serial total
// outran the function died mid-loop: thread messages already
// written stayed written, but the receipt and the counts
// never happened.
// The fix, proven here:
//   A. Source pins — receipt written before the fan-out and
//      finalized on the same record after; the suppression
//      lookup is hoisted (recentLifecycleByUser234) and the
//      fan-out runs through a bounded pool (mapPool234);
//      sendPlatformMessage honors a handed-in lifecycleRecent
//      and keeps the original walk for everyone else; the
//      single-recipient path keeps the serial loop.
//   B. Segment fixture — SEVEN finished creators in one market
//      (plus a pending creator, an incomplete-profile
//      creator, and a finished creator in another market):
//      the POST returns 201 with the four counts; every
//      recipient's thread holds exactly one copy; exactly
//      one pmcampaign receipt exists, written TWICE (first
//      with the full recipient list and zero counts, then
//      finalized with the real counts — same id, same
//      createdAt); the email outcomes split sent / failed /
//      suppressed exactly as planted (a stubfail address
//      fails, a creator with a lifecycle email inside the
//      4-hour window is suppressed by the HOISTED lookup, a
//      creator whose lifecycle email is 5 hours old is not);
//      and during the whole POST the store never sees a bare
//      listKeys("event:") — the per-recipient full-log scan
//      is gone from the segment path.
//   C. Single-send fixture — a { creatorId } send still
//      takes the original per-recipient walk (a bare
//      listKeys("event:") DOES happen), sends, and writes no
//      campaign receipt.
// Run: node scripts/verify-build234.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build234-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "build234-admin-fixture-password";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
// Deterministic mail: every address sends except "stubfail".
process.env.SIGNL_MAIL_STUB = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");
const root = process.cwd();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
{
  const hStart = routerSrc.indexOf('if (method === "POST" && seg[1] === "platform-messages" && seg.length === 2)');
  const hEnd = routerSrc.indexOf('if (method === "GET" && seg[1] === "broadcasts" && seg[2] === "meta"', hStart);
  const handlerSrc = routerSrc.slice(hStart, hEnd);
  check("handler located in router.js", hStart >= 0 && hEnd > hStart, `${hStart}..${hEnd}`);
  const firstReceiptWrite = handlerSrc.indexOf("await store.set(`pmcampaign:${campaignId}`, campaignReceipt)");
  const poolCall = handlerSrc.indexOf("await mapPool234(recipients, SEGMENT_SEND_CONCURRENCY234");
  const finalizeWrite = handlerSrc.indexOf("await store.set(`pmcampaign:${campaignId}`, campaignReceipt)", firstReceiptWrite + 1);
  check("receipt is written BEFORE the fan-out pool runs", firstReceiptWrite >= 0 && poolCall > firstReceiptWrite, `receipt@${firstReceiptWrite} pool@${poolCall}`);
  check("the same receipt record is finalized after the fan-out", finalizeWrite > poolCall, `finalize@${finalizeWrite}`);
  check("the suppression lookup is hoisted for the segment", handlerSrc.includes("await recentLifecycleByUser234(recipients.map((u) => u.id), PLATFORM_PING_SUPPRESS_WINDOW_MS)"), "");
  check("the segment hands each send its hoisted answer", handlerSrc.includes("lifecycleRecent: lifecycleByUser.get(creator.id) || null"), "");
  check("one creator's failure is counted, not fatal", handlerSrc.includes("Magpie segment send failed for creator") && handlerSrc.includes("emailFailed += 1"), "");
  check("the single-recipient path keeps the original serial loop", handlerSrc.includes("for (const creator of recipients)") && handlerSrc.includes("await sendPlatformMessage(user, creator, body, { scope, segmentMarket, templateId })"), "");
  check("the response still returns the four counts", handlerSrc.includes("return json(201, { sent: recipients.length, recipients: recipients.map((u) => u.id), emailSent, emailFailed, emailSuppressed, scope, market: segmentMarket })"), "");
  const spmStart = routerSrc.indexOf("async function sendPlatformMessage(");
  const spmEnd = routerSrc.indexOf("// ---------- message campaigns", spmStart);
  const spmSrc = routerSrc.slice(spmStart, spmEnd > spmStart ? spmEnd : spmStart + 8000);
  check("sendPlatformMessage honors a handed-in lifecycleRecent", spmSrc.includes('"lifecycleRecent" in meta') && spmSrc.includes("meta.lifecycleRecent"), "");
  check("sendPlatformMessage keeps the original walk as the default", spmSrc.includes("await recentLifecycleEmail(creator.id, PLATFORM_PING_SUPPRESS_WINDOW_MS)"), "");
  check("the batch lookup reads only today/yesterday event prefixes", routerSrc.includes("async function recentLifecycleByUser234(") && routerSrc.includes("`event:${new Date(Date.now() - back * dayMs).toISOString().slice(0, 10)}:`"), "");
  check("the pool is bounded (worker pattern, fixed concurrency)", routerSrc.includes("async function mapPool234(") && routerSrc.includes("const SEGMENT_SEND_CONCURRENCY234 = 8"), "");
  check("build stamp is 2026.11.21-234 in both homes",
    fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('BUILD_ID = "2026.11.21-234"')
    && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.21-234"'), "");
}

// --- fixture client (same shape as verify-build232) ----------
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body, rawPath) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: rawPath || url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body),
      isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = res.body; }
    return { status: res.statusCode, data };
  };
}
const PW = "fixture-password-1";
const uniq = () => Math.random().toString(36).slice(2, 9);
const admin = makeClient();
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin login succeeds", r.status === 200, `got ${r.status}`);
}
async function registerCreator(name, handle, market, emailOverride) {
  const c = makeClient();
  const email = emailOverride || `${handle.replace(/[^a-z0-9]/gi, "")}-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: PW, market, city: market, handle,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: 5000, avgViews: 1500, localAudiencePct: 70,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (r.status !== 201) throw new Error("creator register failed: " + JSON.stringify(r.data));
  return { client: c, email, id: r.data.user.id, handle };
}
async function approve(id) {
  const r = await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  if (r.status !== 200) throw new Error("approve failed: " + JSON.stringify(r.data));
}

// --- B: segment fixture ---------------------------------------
console.log("== B: segment fixture (seven finished creators, one market) ==");
const segBody = "Fixture invite 234: the brand new Magpie Creators group is open — https://www.facebook.com/groups/1820148515703356";
const finished = [];
for (let i = 1; i <= 4; i += 1) {
  const c = await registerCreator(`Auck Plain ${i}`, `auckplain234_${i}`, "Auckland");
  await approve(c.id);
  finished.push(c);
}
const oldEvent = await registerCreator("Auck Old", "auckold234", "Auckland"); await approve(oldEvent.id); finished.push(oldEvent);
const supp = await registerCreator("Auck Supp", "aucksupp234", "Auckland"); await approve(supp.id); finished.push(supp);
const stubfail = await registerCreator("Auck Fail", "auckfail234", "Auckland", `stubfail-${uniq()}@fixtures.dev`); await approve(stubfail.id); finished.push(stubfail);
// Distractors: pending (never approved), incomplete profile
// (handle blanked after approval), another market entirely.
const pending = await registerCreator("Auck Pending", "auckpending234", "Auckland");
const incomplete = await registerCreator("Auck Incomplete", "auckincomplete234", "Auckland"); await approve(incomplete.id);
{
  const rec = await store.get(`user:${incomplete.id}`);
  rec.creator.handle = "";
  await store.set(`user:${incomplete.id}`, rec);
}
const nash = await registerCreator("Nash Other", "nashother234", "Nashville"); await approve(nash.id);

// Scrub every event the setup produced (approvals under the
// mail stub DO log approval_email_sent, which would suppress
// everyone), then plant exactly the lifecycle history the
// send must read: one in-window send for supp, one 5-hour-old
// send for oldEvent.
for (const r of await store.list("event:")) await store.del(r.key);
async function plantEvent(userId, type, tsDate) {
  const ts = tsDate.toISOString();
  const id = `fixture234-${userId}-${type}`;
  await store.set(`event:${ts.slice(0, 10)}:${id}`, { id, ts, type, actorId: userId, actorRole: "creator", subjectId: userId, market: "Auckland", data: {} });
}
await plantEvent(supp.id, "approval_email_sent", new Date());
await plantEvent(oldEvent.id, "signin_link_email_sent", new Date(Date.now() - 5 * 60 * 60 * 1000));

// Instrument the store: record every pmcampaign write and
// every listKeys prefix during the segment POST.
const pmWrites = [];
const listKeysPrefixes = [];
const origSet = store.set.bind(store);
const origListKeys = store.listKeys.bind(store);
store.set = async (k, v) => { if (String(k).startsWith("pmcampaign:")) pmWrites.push({ key: k, value: JSON.parse(JSON.stringify(v)) }); return origSet(k, v); };
store.listKeys = async (p) => { listKeysPrefixes.push(String(p)); return origListKeys(p); };
let seg;
try {
  seg = await admin("POST", "/api/admin/platform-messages", { market: "Auckland", body: segBody, templateId: "blank" });
} finally {
  store.set = origSet;
  store.listKeys = origListKeys;
}
{
  check("segment POST: 201, sent = the seven finished Auckland creators",
    seg.status === 201 && seg.data.sent === 7 && seg.data.scope === "segment" && seg.data.market === "Auckland",
    `${seg.status} ${JSON.stringify(seg.data).slice(0, 240)}`);
  check("segment POST: counts split as planted (5 sent / 1 failed / 1 suppressed)",
    seg.data.emailSent === 5 && seg.data.emailFailed === 1 && seg.data.emailSuppressed === 1,
    JSON.stringify(seg.data).slice(0, 240));
  check("the per-recipient full-log scan never ran (no bare listKeys(\"event:\"))",
    !listKeysPrefixes.includes("event:"), JSON.stringify(listKeysPrefixes.filter((p) => p.startsWith("event"))));
  check("the hoisted lookup read the day-prefixed event keys instead",
    listKeysPrefixes.some((p) => /^event:\d{4}-\d{2}-\d{2}:$/.test(p)), JSON.stringify(listKeysPrefixes.filter((p) => p.startsWith("event"))));
  check("receipt written exactly twice: up front, then finalized",
    pmWrites.length === 2 && pmWrites[0].key === pmWrites[1].key, `${pmWrites.length} writes`);
  check("the up-front write carries the full recipient list with zero counts",
    pmWrites.length === 2 && pmWrites[0].value.messageCount === 7
    && [...pmWrites[0].value.recipientIds].sort().join(",") === finished.map((c) => c.id).sort().join(",")
    && pmWrites[0].value.emailSent === 0 && pmWrites[0].value.emailFailed === 0 && pmWrites[0].value.emailSuppressed === 0,
    JSON.stringify(pmWrites[0] && pmWrites[0].value).slice(0, 240));
  check("the finalized write keeps id + createdAt and lands the real counts",
    pmWrites.length === 2 && pmWrites[1].value.id === pmWrites[0].value.id && pmWrites[1].value.createdAt === pmWrites[0].value.createdAt
    && pmWrites[1].value.emailSent === 5 && pmWrites[1].value.emailFailed === 1 && pmWrites[1].value.emailSuppressed === 1,
    JSON.stringify(pmWrites[1] && pmWrites[1].value).slice(0, 240));
  const rows = await store.list("pmcampaign:");
  const receipt = rows.map((r) => r.value).find((v) => v && v.body === segBody);
  check("exactly one pmcampaign receipt for the send, with the -163 fields intact",
    rows.filter((r) => r.value && r.value.body === segBody).length === 1 && !!receipt
    && receipt.kind === "segment" && receipt.market === "Auckland" && receipt.messageCount === 7
    && receipt.reconstructed === false && receipt.templateId === "blank" && !!receipt.sentByName,
    JSON.stringify(receipt).slice(0, 240));
  const campaigns = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
  const entry = campaigns.find((c) => c.body === segBody);
  check("the \"Sent to many\" book shows the send with all seven recipients",
    !!entry && entry.recipientCount === 7, JSON.stringify(entry).slice(0, 240));
  let threadsOk = true;
  for (const c of finished) {
    const t = await admin("GET", `/api/admin/platform-messages?creatorId=${c.id}`);
    const copies = (t.data.messages || []).filter((m) => m.body === segBody).length;
    if (copies !== 1) threadsOk = false;
  }
  check("each finished creator's thread holds exactly ONE copy", threadsOk, "");
  for (const [label, c] of [["pending", pending], ["incomplete-profile", incomplete], ["other-market", nash]]) {
    const t = await admin("GET", `/api/admin/platform-messages?creatorId=${c.id}`);
    check(`the ${label} creator got nothing`, !(t.data.messages || []).some((m) => m.body === segBody), "");
  }
  const segEvents = (await store.list("event:")).map((r) => r.value).filter((e) => e && e.type === "platform_message_segment");
  check("the platform_message_segment event carries the final counts",
    segEvents.length === 1 && segEvents[0].data.recipients === 7 && segEvents[0].data.emailSent === 5 && segEvents[0].data.emailFailed === 1 && segEvents[0].data.emailSuppressed === 1,
    JSON.stringify(segEvents).slice(0, 240));
  const suppEvents = (await store.list("event:")).map((r) => r.value).filter((e) => e && e.type === "platform_message_email_suppressed" && e.subjectId === supp.id);
  check("the suppressed creator's hold is logged with the lifecycle reason",
    suppEvents.length === 1 && suppEvents[0].data.reason === "recent_lifecycle_email" && suppEvents[0].data.lifecycleKind === "approval",
    JSON.stringify(suppEvents).slice(0, 240));
}

// --- C: single-send fixture ------------------------------------
console.log("== C: single-send fixture (original walk, no receipt) ==");
{
  const singleBody = "Fixture single 234: a one-to-one thread reply.";
  const prefixesDuring = [];
  store.listKeys = async (p) => { prefixesDuring.push(String(p)); return origListKeys(p); };
  let single;
  try {
    single = await admin("POST", "/api/admin/platform-messages", { creatorId: oldEvent.id, body: singleBody });
  } finally {
    store.listKeys = origListKeys;
  }
  check("single POST: 201, one sent, email sent (5-hour-old lifecycle mail does not suppress)",
    single.status === 201 && single.data.sent === 1 && single.data.emailSent === 1 && single.data.emailSuppressed === 0 && single.data.scope === "single",
    `${single.status} ${JSON.stringify(single.data).slice(0, 240)}`);
  check("the single path still runs the original per-recipient event walk",
    prefixesDuring.includes("event:"), JSON.stringify(prefixesDuring.filter((p) => p.startsWith("event"))));
  const rows = await store.list("pmcampaign:");
  check("a single send writes NO campaign receipt",
    !rows.some((r) => r.value && r.value.body === singleBody), `${rows.length} pmcampaign rows`);
  const t = await admin("GET", `/api/admin/platform-messages?creatorId=${oldEvent.id}`);
  check("the single message is in the creator's thread alongside the segment copy",
    (t.data.messages || []).some((m) => m.body === singleBody) && (t.data.messages || []).some((m) => m.body === segBody), "");
}

console.log(`\nverify-build234: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
