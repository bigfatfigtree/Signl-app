// verify-build163.mjs — Build -163: ONE Admin Messages home.
// Jeff's ruling (2026-11-09): all correspondence and messaging
// lives together in Admin → Messages. This suite proves:
//   A. Source pins — the home hosts Conversations + Sent to
//      many + the broadcast room; Requests only points into it;
//      the segment tool sits fenced inside Sent to many; the
//      broadcast composer is labelled as a broadcast.
//   B. The thread overview is generic (creators, businesses),
//      sorted by latest activity, every row carrying a time, an
//      unread count that clears on open, and a needs-reply flag
//      that clears ONLY when the team replies.
//   C. Replies work in any person's thread (userId path), while
//      the creatorId spelling keeps its creator-only guard.
//   D. A market-segment send writes ONE campaign record at send
//      time with the exact copy and the proven recipients.
//   E. The two 2026-11-09 mass sends are backfilled from the
//      stored messages themselves: distinct recipients counted
//      from the store (a duplicate counts once as a recipient,
//      twice as a message), copy = the earliest stored copy,
//      flagged reconstructed; the backfill is idempotent.
//   F. Completeness reconciliation: the overview's per-thread
//      message counts sum to exactly the platform messages in
//      the store — the home reads the store, never the Event
//      Log.
// Run: node scripts/verify-build163.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build163-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = " local-only-password-not-a-secret";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");
const root = path.join(process.cwd());

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

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
let jeffId = null;
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin (Jeff) login succeeds", r.status === 200, `got ${r.status}`);
  jeffId = r.data && r.data.user && r.data.user.id;
  check("login returns Jeff's user id", !!jeffId, JSON.stringify(r.data).slice(0, 120));
}

async function registerCreator(name, handle, market) {
  const c = makeClient();
  const email = `${handle.replace(/[^a-z0-9]/gi, "")}-${uniq()}@fixtures.dev`;
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
const PEER = "signl-team";
const threadIdFor = (id) => [String(id), PEER].sort().join("__");
async function seedMessage({ fromId, toId, body, createdAt, platform = true }) {
  const id = `fixture163-${uniq()}-${uniq()}`;
  await store.set(`message:${id}`, { id, threadId: threadIdFor(fromId === PEER ? toId : fromId), fromId, toId, body, platform, createdAt });
  return id;
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const homeSrc = appJs.slice(appJs.indexOf("async function loadAdminMessages152()"), appJs.indexOf("async function bc153LoadAll()"));
  check("home: Messages hosts Conversations + Sent to many + broadcast room",
    homeSrc.includes('id="admin-msg-panel"') && homeSrc.includes('id="admin-campaigns-panel"') && homeSrc.includes('id="bc153-room"')
    && homeSrc.includes("renderAdminMessages()") && homeSrc.includes("renderAdminCampaigns163()"), homeSrc.slice(0, 200));
  const reqSrc = appJs.slice(appJs.indexOf("async function loadAdminRequests()"), appJs.indexOf("// Admin profile view"));
  check("home: Requests no longer hosts the thread panel — it points into Messages",
    !reqSrc.includes('id="admin-msg-panel"') && reqSrc.includes("All conversations moved to Messages") && reqSrc.includes("go('dashboard','Messages')"), reqSrc.slice(0, 200));
  const campSrc = appJs.slice(appJs.indexOf("function adminCampPanelHtml163()"), appJs.indexOf("// ---------- admin: Messages room"));
  check("sent-to-many: the segment tool is fenced + labelled inside the panel",
    campSrc.includes("Send to a market segment") && campSrc.includes("send to MANY people at once") && campSrc.includes('id="admin-msg-market"') && campSrc.includes('id="admin-msg-template"') && campSrc.includes("adminMsgSendCompose"), campSrc.slice(0, 200));
  check("sent-to-many: entries expand to the full copy + recipient thread links",
    campSrc.includes("Full message and who got it") && campSrc.includes("adminCampOpenThread163"), "");
  const panelSrc = appJs.slice(appJs.indexOf("function adminMsgPanelHtml()"), appJs.indexOf("let adminMsgRendering"));
  check("conversations: rows carry a time and a persistent Needs reply badge",
    panelSrc.includes("fmtDate(t.lastAt)") && panelSrc.includes("Needs reply") && panelSrc.includes("waiting on your reply"), panelSrc.slice(0, 200));
  check("broadcast: the composer button is labelled as a broadcast",
    appJs.includes("Write a broadcast") && appJs.includes("Broadcast room"), "");
  check("server: campaign record written at segment send time + campaigns route + backfill specs",
    routerJs.includes("pmcampaign:${campaignId}") && routerJs.includes('"message-campaigns"') && routerJs.includes("MSG_CAMPAIGN_BACKFILLS_163") && routerJs.includes("maybeBackfillMsgCampaigns163"), "");
  check("server: needsReply derives from the last message being theirs",
    routerJs.includes("needsReply: !!lastMessage && lastMessage.fromId === peerId"), "");
}

// --- B: fixture people + seeded threads -----------------------
console.log("== B: threads ==");
const CAT_BODY = "Hi, quick one from Maggie. Most creators here aren't just one thing. If your page isn't only about one thing, add the rest — ten seconds in your Profile, under \"What you create in.\" Every category you add is another kind of business that can send you offers.";
const CITY_BODY = "One more from Maggie — this one's about your second city. If a real chunk of your followers lives somewhere else, you can be listed there too, not just at home. Two steps in your Profile, under \"Your audience in other markets\": add the city, then flip that city's switch on.";
const cat1 = await registerCreator("Cat One", "catone163", "Nashville"); await approve(cat1.id);
const cat2 = await registerCreator("Cat Two", "cattwo163", "Nashville"); await approve(cat2.id);
const cat3 = await registerCreator("Cat Three", "catthree163", "Austin"); await approve(cat3.id);
const city1 = await registerCreator("City One", "cityone163", "Denver"); await approve(city1.id);
const city2 = await registerCreator("City Two", "citytwo163", "Denver"); await approve(city2.id);

// Registration fires Finish Engine finish-moment messages into
// fresh creators' threads; this suite seeds its own history, so
// clear every platform message the fixtures produced first.
{
  const rows = await store.list("message:");
  for (const r of rows) if (r.value && r.value.platform) await store.del(r.key);
}

// The 2026-11-09 backfill fixtures: category copy to 3 distinct
// creators (one of them twice), second-city copy to 3.
await seedMessage({ fromId: PEER, toId: cat1.id, body: CAT_BODY, createdAt: "2026-11-09T14:17:00.000Z" });
await seedMessage({ fromId: PEER, toId: cat1.id, body: CAT_BODY, createdAt: "2026-11-09T14:18:00.000Z" });
await seedMessage({ fromId: PEER, toId: cat2.id, body: CAT_BODY, createdAt: "2026-11-09T14:19:00.000Z" });
await seedMessage({ fromId: PEER, toId: cat3.id, body: CAT_BODY, createdAt: "2026-11-09T14:20:00.000Z" });
await seedMessage({ fromId: PEER, toId: city1.id, body: CITY_BODY, createdAt: "2026-11-09T15:03:00.000Z" });
await seedMessage({ fromId: PEER, toId: city2.id, body: CITY_BODY, createdAt: "2026-11-09T15:04:00.000Z" });
await seedMessage({ fromId: PEER, toId: cat1.id, body: CITY_BODY, createdAt: "2026-11-09T15:05:00.000Z" });

// A business with a thread: team wrote, the business replied last.
const bizC = makeClient();
const bizReg = await bizC("POST", "/api/auth/register", {
  role: "business", name: "Biz Owner", businessName: "Threadless Kitchen", email: `biz-${uniq()}@fixtures.dev`, password: "business-pass-123",
  market: "Nashville", city: "Nashville", category: "Restaurant", planId: "growth", neighborhood: "East Nashville", agreedTerms: true,
});
if (bizReg.status !== 201) throw new Error("business register failed: " + JSON.stringify(bizReg.data));
const bizId = bizReg.data.user.id;
await approve(bizId);
await seedMessage({ fromId: PEER, toId: bizId, body: "Welcome aboard — your founding spot is held.", createdAt: "2026-11-09T15:50:00.000Z" });
await seedMessage({ fromId: bizId, toId: PEER, body: "Thanks! When do we go live?", createdAt: "2026-11-09T16:00:00.000Z" });

// A creator whose last word is theirs (needs reply), with two
// unopened replies; another whose thread ends with the team.
await seedMessage({ fromId: cat2.id, toId: PEER, body: "Loved the second-city note.", createdAt: "2026-11-09T15:30:00.000Z" });
await seedMessage({ fromId: cat2.id, toId: PEER, body: "One more question — do comped visits include a plus one?", createdAt: "2026-11-09T15:31:00.000Z" });

let overview = (await admin("GET", "/api/admin/platform-messages")).data;
const threadOf = (ov, id) => (ov.threads || []).find((t) => t.peerId === id);
{
  const biz = threadOf(overview, bizId);
  check("overview: the business thread is listed, generic peer fields present",
    !!biz && biz.peerRole === "business" && biz.peerOrg === "Threadless Kitchen" && biz.peerName === "Biz Owner", JSON.stringify(biz).slice(0, 200));
  check("overview: business thread shows needsReply + 1 unread + its time",
    !!biz && biz.needsReply === true && biz.unreadReplies === 1 && biz.lastAt === "2026-11-09T16:00:00.000Z", JSON.stringify(biz).slice(0, 200));
  const c2 = threadOf(overview, cat2.id);
  check("overview: creator thread with two unopened replies — unread 2, needsReply true",
    !!c2 && c2.unreadReplies === 2 && c2.needsReply === true, JSON.stringify(c2).slice(0, 200));
  const c1 = threadOf(overview, cat1.id);
  check("overview: a thread ending with the team's message does not need a reply",
    !!c1 && c1.needsReply === false, JSON.stringify(c1).slice(0, 200));
  const ats = (overview.threads || []).map((t) => t.lastAt || "");
  check("overview: threads sorted by latest activity first",
    ats.every((v, i) => i === 0 || ats[i - 1] >= v) && overview.threads[0].peerId === bizId, ats.join(","));
  check("overview: every row carries a lastAt time", (overview.threads || []).every((t) => !!t.lastAt), "");
}

// Opening a thread clears unread but NOT needs-reply.
{
  const detail = await admin("GET", `/api/admin/platform-messages?userId=${cat2.id}`);
  check("detail: userId opens a creator thread with full history",
    detail.status === 200 && detail.data.user.id === cat2.id && detail.data.messages.some((m) => m.body.includes("plus one")), `${detail.status}`);
  check("detail: creator spelling still returned for older callers",
    !!detail.data.creator && detail.data.creator.id === cat2.id, "");
  overview = (await admin("GET", "/api/admin/platform-messages")).data;
  const c2 = threadOf(overview, cat2.id);
  check("open clears unread, needs-reply persists until we answer",
    !!c2 && c2.unreadReplies === 0 && c2.needsReply === true, JSON.stringify(c2).slice(0, 200));
}

// --- C: replies ------------------------------------------------
console.log("== C: replies ==");
{
  const r = await admin("POST", "/api/admin/platform-messages", { creatorId: cat2.id, body: "Yes — a plus one is welcome on comped visits." });
  check("reply: creator thread reply sends (creatorId path)", r.status === 201 && r.data.sent === 1, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  overview = (await admin("GET", "/api/admin/platform-messages")).data;
  const c2 = threadOf(overview, cat2.id);
  check("reply: needsReply clears once the team answers", !!c2 && c2.needsReply === false, JSON.stringify(c2).slice(0, 160));

  const rb = await admin("POST", "/api/admin/platform-messages", { userId: bizId, body: "Soon — we open in Nashville first, and you are on the founding list." });
  check("reply: business thread reply sends (userId path)", rb.status === 201 && rb.data.sent === 1, `${rb.status} ${JSON.stringify(rb.data).slice(0, 120)}`);
  const bizDetail = await admin("GET", `/api/admin/platform-messages?userId=${bizId}`);
  const bizBodies = (bizDetail.data.messages || []).map((m) => m.body);
  check("reply: the business thread holds the whole conversation",
    bizDetail.status === 200 && bizDetail.data.user.role === "business"
    && bizBodies.includes("Welcome aboard — your founding spot is held.")
    && bizBodies.includes("Thanks! When do we go live?")
    && bizBodies[bizBodies.length - 1] === "Soon — we open in Nashville first, and you are on the founding list.",
    `${bizDetail.status} ${JSON.stringify(bizBodies).slice(0, 200)}`);
  const guard = await admin("POST", "/api/admin/platform-messages", { creatorId: bizId, body: "hi" });
  check("guard: creatorId still refuses a business target (404)", guard.status === 404, `${guard.status}`);
  const guardAdmin = await admin("POST", "/api/admin/platform-messages", { userId: jeffId, body: "hi" });
  check("guard: userId refuses an admin target (404)", guardAdmin.status === 404, `${guardAdmin.status}`);
}

// --- D + E: campaigns ------------------------------------------
console.log("== D/E: campaigns ==");
let campaigns = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
{
  const cat = campaigns.find((c) => c.id === "backfill-2026-11-09-categories");
  check("backfill: category send rebuilt — 3 proven recipients, 4 stored messages, reconstructed flag",
    !!cat && cat.recipientCount === 3 && cat.messageCount === 4 && cat.reconstructed === true, JSON.stringify(cat).slice(0, 240));
  check("backfill: category copy is the earliest stored copy, verbatim",
    !!cat && cat.body === CAT_BODY && cat.createdAt === "2026-11-09T14:17:00.000Z", cat ? cat.createdAt : "missing");
  check("backfill: recipients resolve to people who can open their thread",
    !!cat && cat.recipients.length === 3 && cat.recipients.every((p) => p.id && p.name), JSON.stringify(cat && cat.recipients).slice(0, 200));
  const city = campaigns.find((c) => c.id === "backfill-2026-11-09-second-city");
  check("backfill: second-city send rebuilt — 3 proven recipients, 3 messages",
    !!city && city.recipientCount === 3 && city.messageCount === 3 && city.reconstructed === true, JSON.stringify(city).slice(0, 200));
}
{
  const segBody = "Segment fixture: Nashville, your founding spot is held — reply here with any question.";
  const seg = await admin("POST", "/api/admin/platform-messages", { market: "Nashville", body: segBody });
  check("segment send: both finished Nashville creators got it", seg.status === 201 && seg.data.sent === 2 && seg.data.scope === "segment", `${seg.status} ${JSON.stringify(seg.data).slice(0, 160)}`);
  campaigns = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
  const entry = campaigns.find((c) => c.body === segBody);
  check("segment send: ONE campaign entry with the exact copy + proven recipients, not reconstructed",
    !!entry && entry.kind === "segment" && entry.recipientCount === 2 && entry.reconstructed === false
    && entry.recipients.map((p) => p.id).sort().join(",") === [cat1.id, cat2.id].sort().join(","),
    JSON.stringify(entry).slice(0, 240));
  check("segment send: the entry names its sender", !!entry && typeof entry.sentByName === "string" && entry.sentByName.length > 0, entry ? entry.sentByName : "missing");
  const before = campaigns.length;
  const again = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
  check("backfill: idempotent — a second read adds no duplicate entries",
    again.length === before && again.filter((c) => c.id === "backfill-2026-11-09-categories").length === 1, `${before} -> ${again.length}`);
}

// --- F: reconciliation ------------------------------------------
console.log("== F: reconciliation ==");
{
  overview = (await admin("GET", "/api/admin/platform-messages")).data;
  const rows = await store.list("message:");
  const platformMsgs = rows.map((r) => r.value).filter((m) => m && m.platform);
  const sumThreads = (overview.threads || []).reduce((n, t) => n + (t.messageCount || 0), 0);
  check("reconciliation: thread message counts sum to the platform messages in the store",
    sumThreads === platformMsgs.length, `threads=${sumThreads} store=${platformMsgs.length}`);
  const peers = new Set(platformMsgs.map((m) => (m.fromId === PEER ? m.toId : m.fromId)));
  check("reconciliation: one thread per person with platform messages",
    (overview.threads || []).length === peers.size, `threads=${(overview.threads || []).length} peers=${peers.size}`);
}

console.log(`\nverify-build163: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
