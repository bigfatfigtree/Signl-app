// verify-build152.mjs — Build -152: the Admin Messages room.
//
// Jeff ordered (2026-11-08) a room where HE sends in-app
// messages himself — to segments and to individuals — without
// going through Brenda. This suite runs the REAL api handler
// in-process against a seeded local store and proves:
//   - the audience resolver: role x market x tier compose, a
//     creator counts in every market where they are LISTED
//     (home + audience-share markets), pending accounts never
//     count, and the live preview count equals the send count
//   - a segment send and an individual send each land ONE titled
//     message in the recipient's own Magpie-team thread, write
//     one broadcast record, and log one broadcast_sent event
//     carrying the audience descriptor, the count and the sender
//   - a creator reply AND a business reply in the team thread
//     are accepted (businesses were refused before -152) and
//     stamped with the broadcast they answer
//   - the room's history counts replies per broadcast, the
//     detail view groups them per recipient, and an admin can
//     reply back inside the thread
//   - the messages.send flag gates every route: a teammate
//     without it gets 403, a teammate with it gets through,
//     anonymous gets 403
//   - validation refuses empty titles/bodies, dead audiences
//     and unmessageable named people, in plain words
// Run: node scripts/verify-build152.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build152-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["qa", "admin", "pw"].join("-");
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { hashPassword } = require("../netlify/functions/lib/auth.js");
const { handler } = require("../netlify/functions/api.js");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body),
      isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { /* not json */ }
    return { status: res.statusCode, data };
  };
}

const PW = "fixture-password-1";
const uniq = () => Math.random().toString(36).slice(2, 9);
const admin = makeClient();
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin login succeeds", r.status === 200, `got ${r.status}: ${JSON.stringify(r.data)}`);
}

async function registerCreator(name, handle, market, tierBand, extra = {}) {
  const c = makeClient();
  const email = `${handle.replace(/[^a-z0-9]/gi, "")}-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: PW, market, city: market, handle,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand,
    followerCount: tierBand === "Headliners" ? 22000 : 4200, avgViews: 1500, localAudiencePct: 68,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true, ...extra,
  });
  if (r.status !== 201) throw new Error("creator register failed: " + JSON.stringify(r.data));
  return { client: c, email, id: r.data.user.id };
}
async function registerBusiness(name, businessName, market) {
  const c = makeClient();
  const email = `${businessName.replace(/[^a-z0-9]/gi, "").toLowerCase()}-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", { role: "business", name, email, password: PW, market, city: market, businessName, category: "Restaurant", planId: "growth", agreedTerms: true });
  if (r.status !== 201) throw new Error("business register failed: " + JSON.stringify(r.data));
  return { client: c, email, id: r.data.user.id };
}
async function approve(id) {
  const r = await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  if (r.status !== 200) throw new Error("approve failed: " + JSON.stringify(r.data));
}
async function patchUser(id, patch) {
  const u = await store.get(`user:${id}`);
  await store.set(`user:${id}`, { ...u, ...patch });
}

// --- Cast ---------------------------------------------------
// A: Nashville creator, Locals, ALSO listed in Chicago (25%
//    audience share there — above the 5% listing floor).
// B: Nashville creator, Headliners.
// C: Chicago creator, Locals.
// P: Nashville creator, left pending — never countable.
// D: Nashville business.  E: Chicago business.
const A = await registerCreator("Ana Anchor", "ana.anchor", "Nashville", "Locals");
const B = await registerCreator("Hank Headline", "hank.headline", "Nashville", "Headliners");
const C = await registerCreator("Chiara Chi", "chiara.chi", "Chicago", "Locals");
const P = await registerCreator("Penny Pending", "penny.pending", "Nashville", "Locals");
const D = await registerBusiness("Dan Diner", "Fixture Diner", "Nashville");
const E = await registerBusiness("Elena Eats", "Fixture Eatery", "Chicago");
for (const u of [A, B, C, D, E]) await approve(u.id);
// D is ACTIVATED (not merely approved): since Build -68 a
// founding-list business is refused the whole messages section
// until activation, so the reply path needs an active business.
{
  const r = await admin("POST", "/api/admin/businesses/activate", { userId: D.id });
  if (r.status !== 200) throw new Error("activate failed: " + JSON.stringify(r.data));
}
{
  const a = await store.get(`user:${A.id}`);
  a.creator = { ...(a.creator || {}), audienceMarkets: [{ market: "Chicago", pct: 25 }] };
  await store.set(`user:${A.id}`, a);
}
async function loginAs(email) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email, password: PW });
  if (r.status !== 200) throw new Error("login failed for " + email + ": " + JSON.stringify(r.data));
  return c;
}
const clientA = await loginAs(A.email);
const clientD = await loginAs(D.email);

// --- Meta + people search ------------------------------------
const meta = await admin("GET", "/api/admin/broadcasts/meta");
check("meta: markets include Nashville and Chicago", meta.status === 200 && meta.data.markets.includes("Nashville") && meta.data.markets.includes("Chicago"), JSON.stringify(meta.data).slice(0, 200));
check("meta: tiers are the three bands", meta.status === 200 && JSON.stringify(meta.data.tiers) === JSON.stringify(["Neighbors", "Locals", "Headliners"]), JSON.stringify(meta.data.tiers));

const search = await admin("GET", "/api/admin/broadcasts/people?q=" + encodeURIComponent("ana.anchor"));
check("people search finds a creator by handle", search.status === 200 && search.data.people.some((p) => p.id === A.id && p.label.includes("@ana.anchor")), JSON.stringify(search.data).slice(0, 200));
const searchBiz = await admin("GET", "/api/admin/broadcasts/people?q=" + encodeURIComponent("Fixture Diner"));
check("people search finds a business by name", searchBiz.status === 200 && searchBiz.data.people.some((p) => p.id === D.id), JSON.stringify(searchBiz.data).slice(0, 200));
const searchShort = await admin("GET", "/api/admin/broadcasts/people?q=a");
check("people search needs two characters", searchShort.status === 200 && searchShort.data.people.length === 0);

// --- Preview: the resolver, combination by combination -------
async function preview(spec) {
  const r = await admin("POST", "/api/admin/broadcasts/preview", { spec });
  if (r.status !== 200) throw new Error("preview failed: " + JSON.stringify(r.data));
  return r.data;
}
check("preview: everyone = 5 (pending never counts)", (await preview({ mode: "all" })).count === 5);
check("preview: creators = 3", (await preview({ mode: "creators" })).count === 3);
check("preview: businesses = 2", (await preview({ mode: "businesses" })).count === 2);
check("preview: creators in Nashville = 2", (await preview({ mode: "creators", markets: ["Nashville"] })).count === 2);
check("preview: creators in Chicago = 2 (Ana counts where she is listed)", (await preview({ mode: "creators", markets: ["Chicago"] })).count === 2);
check("preview: Locals creators = 2", (await preview({ mode: "creators", tiers: ["Locals"] })).count === 2);
check("preview: Nashville + Locals = 1", (await preview({ mode: "creators", markets: ["Nashville"], tiers: ["Locals"] })).count === 1);
check("preview: everyone in Chicago = 3 (listed creator + home creator + business)", (await preview({ mode: "all", markets: ["Chicago"] })).count === 3);
const pvPeople = await preview({ mode: "people", userIds: [D.id] });
check("preview: one picked person = 1, labelled as picked", pvPeople.count === 1 && pvPeople.audienceLabel.includes("picked by name"), pvPeople.audienceLabel);
const pvAll = await preview({ mode: "all" });
check("preview: everyone label says what it is", pvAll.audienceLabel.includes("Everyone"), pvAll.audienceLabel);

// --- Segment send ---------------------------------------------
const segSend = await admin("POST", "/api/admin/broadcasts", { title: "Nashville news", body: "Big week here.", spec: { mode: "creators", markets: ["Nashville"], tiers: ["Locals"] } });
check("segment send returns 201 with the confirmed count", segSend.status === 201 && segSend.data.broadcast.recipientCount === 1, JSON.stringify(segSend.data).slice(0, 200));
const segBroadcast = segSend.data.broadcast;
{
  const rec = await store.get(`broadcast:${segBroadcast.id}`);
  check("broadcast record stored with spec, sender and label", !!rec && rec.senderId && rec.audienceLabel.includes("Nashville") && rec.recipientIds.includes(A.id), JSON.stringify(rec).slice(0, 200));
  const msgs = (await store.list("message:")).map((r) => r.value).filter((m) => m && m.broadcastId === segBroadcast.id);
  check("segment send delivered exactly one message", msgs.length === 1, `got ${msgs.length}`);
  const m = msgs[0] || {};
  check("delivered message sits in Ana's team thread, titled, from the team", m.toId === A.id && m.fromId === "signl-team" && m.title === "Nashville news" && m.body === "Big week here." && m.threadId === [A.id, "signl-team"].sort().join("__"), JSON.stringify(m).slice(0, 200));
  const evs = (await store.list("event:")).map((r) => r.value).filter((e) => e && e.type === "broadcast_sent" && e.subjectId === segBroadcast.id);
  check("one broadcast_sent event: sender, audience, count", evs.length === 1 && evs[0].actorRole === "admin" && !!evs[0].actorId && evs[0].data.recipientCount === 1 && evs[0].data.audienceLabel.includes("Nashville"), JSON.stringify(evs).slice(0, 200));
  const notes = (await store.list(`note:${A.id}:`)).map((r) => r.value).filter((n) => n && n.kind === "message_received" && !n.readAt);
  check("recipient got the unread knock", notes.length >= 1);
}

// --- Individual send to a business -----------------------------
const indSend = await admin("POST", "/api/admin/broadcasts", { title: "For the Diner", body: "Just for you.", spec: { mode: "people", userIds: [D.id] } });
check("individual send returns 201, one recipient", indSend.status === 201 && indSend.data.broadcast.recipientCount === 1, JSON.stringify(indSend.data).slice(0, 200));
const indBroadcast = indSend.data.broadcast;
{
  const msgs = (await store.list("message:")).map((r) => r.value).filter((m) => m && m.broadcastId === indBroadcast.id);
  check("business received the titled message in its team thread", msgs.length === 1 && msgs[0].toId === D.id && msgs[0].title === "For the Diner", JSON.stringify(msgs).slice(0, 200));
}

// The inbox read the recipient actually sees — checked BEFORE
// any reply, while the broadcast is still the latest message.
const inboxA = await clientA("GET", "/api/messages");
{
  const t = (inboxA.data.threads || []).find((x) => x.otherId === "signl-team");
  check("creator inbox lists the Magpie thread, titled preview, unread", !!t && t.platform === true && t.otherName === "Magpie" && t.lastMessage.title === "Nashville news" && t.unread === true, JSON.stringify(t).slice(0, 200));
}

// --- Replies: creator and business, both stamped ---------------
const replyA = await clientA("POST", "/api/messages", { toUserId: "signl-team", body: "Count me in!" });
check("creator can reply in the team thread", replyA.status === 201, `got ${replyA.status}: ${JSON.stringify(replyA.data)}`);
check("creator reply is stamped with the segment broadcast", replyA.data.message.broadcastId === segBroadcast.id, JSON.stringify(replyA.data.message).slice(0, 200));
const replyD = await clientD("POST", "/api/messages", { toUserId: "signl-team", body: "Thanks — see you there." });
check("business can reply in the team thread (refused before -152)", replyD.status === 201, `got ${replyD.status}: ${JSON.stringify(replyD.data)}`);
check("business reply is stamped with the individual broadcast", replyD.data.message.broadcastId === indBroadcast.id, JSON.stringify(replyD.data.message).slice(0, 200));

// --- History + detail + admin reply-back ------------------------
const hist = await admin("GET", "/api/admin/broadcasts");
check("history lists both sends", hist.status === 200 && hist.data.broadcasts.length === 2, JSON.stringify(hist.data).slice(0, 200));
{
  const segRow = hist.data.broadcasts.find((b) => b.id === segBroadcast.id);
  const indRow = hist.data.broadcasts.find((b) => b.id === indBroadcast.id);
  check("history counts one reply under each", !!segRow && segRow.replyCount === 1 && !!indRow && indRow.replyCount === 1, JSON.stringify(hist.data.broadcasts).slice(0, 300));
}
const detail = await admin("GET", `/api/admin/broadcasts/${segBroadcast.id}`);
check("detail groups the thread per recipient", detail.status === 200 && detail.data.threads.length === 1 && detail.data.threads[0].user.id === A.id, JSON.stringify(detail.data).slice(0, 200));
check("detail thread carries the message and the reply", detail.status === 200 && detail.data.threads[0].messages.length === 2 && detail.data.threads[0].messages.some((m) => m.body === "Count me in!"), JSON.stringify(detail.data.threads).slice(0, 300));
const back = await admin("POST", `/api/admin/broadcasts/${segBroadcast.id}/reply`, { userId: A.id, body: "Glad to hear it." });
check("admin can reply back inside the thread", back.status === 201 && back.data.message.broadcastId === segBroadcast.id && back.data.message.fromId === "signl-team", JSON.stringify(back.data).slice(0, 200));
{
  const thread = await clientA("GET", "/api/messages?with=" + encodeURIComponent("signl-team"));
  // The thread also holds the Finish Engine's older welcome
  // message; the broadcast conversation is the stamped subset.
  const bodies = (thread.data.messages || []).filter((m) => m.broadcastId === segBroadcast.id).map((m) => m.body);
  check("creator sees the whole broadcast conversation in order", JSON.stringify(bodies) === JSON.stringify(["Big week here.", "Count me in!", "Glad to hear it."]), JSON.stringify(bodies));
  const titled = (thread.data.messages || []).find((m) => m.broadcastId === segBroadcast.id);
  check("the broadcast message carries its title into the conversation read", !!titled && titled.title === "Nashville news");
  const hist2 = await admin("GET", "/api/admin/broadcasts");
  const segRow = hist2.data.broadcasts.find((b) => b.id === segBroadcast.id);
  check("admin's own reply never counts as a reply", segRow.replyCount === 1, `replyCount=${segRow.replyCount}`);
}

// --- Validation --------------------------------------------------
const noTitle = await admin("POST", "/api/admin/broadcasts", { title: " ", body: "x", spec: { mode: "all" } });
check("empty title refused", noTitle.status === 400, `got ${noTitle.status}`);
const noBody = await admin("POST", "/api/admin/broadcasts", { title: "x", body: " ", spec: { mode: "all" } });
check("empty body refused", noBody.status === 400, `got ${noBody.status}`);
const deadSpec = await admin("POST", "/api/admin/broadcasts/preview", { spec: { mode: "sideways" } });
check("unknown audience refused", deadSpec.status === 400, `got ${deadSpec.status}`);
const nobody = await admin("POST", "/api/admin/broadcasts", { title: "x", body: "y", spec: { mode: "creators", markets: ["Miami"] } });
check("an audience of nobody refuses the send", nobody.status === 400 && /Nobody matches/.test(nobody.data.error || ""), JSON.stringify(nobody.data).slice(0, 200));
const pickPending = await admin("POST", "/api/admin/broadcasts", { title: "x", body: "y", spec: { mode: "people", userIds: [P.id] } });
check("picking a not-yet-active person refuses in plain words", pickPending.status === 400 && /active account/.test(pickPending.data.error || ""), JSON.stringify(pickPending.data).slice(0, 200));
const badReply = await admin("POST", `/api/admin/broadcasts/${segBroadcast.id}/reply`, { userId: B.id, body: "wrong thread" });
check("replying to a non-recipient refuses", badReply.status === 400, `got ${badReply.status}`);

// --- The flag gate ------------------------------------------------
async function makeTeammate(email, flags) {
  const id = (await import("node:crypto")).randomUUID();
  const { salt, hash } = hashPassword(PW);
  await store.set(`user:${id}`, {
    id, role: "admin", email, name: "Teammate Fixture", passwordSalt: salt, passwordHash: hash,
    status: "approved", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    adminPerms: { super: false, flags, markets: null, statScopes: [], template: null, grantedBy: "verify-build152", grantedAt: new Date().toISOString() },
  });
  await store.set(`email:${email}`, { userId: id });
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email, password: PW });
  if (r.status !== 200) throw new Error("teammate login failed: " + JSON.stringify(r.data));
  return c;
}
const noFlag = await makeTeammate(`noflag-${uniq()}@fixtures.dev`, { "creators.view": true });
const deniedRead = await noFlag("GET", "/api/admin/broadcasts");
check("teammate without messages.send: history refused 403", deniedRead.status === 403, `got ${deniedRead.status}`);
const deniedSend = await noFlag("POST", "/api/admin/broadcasts", { title: "x", body: "y", spec: { mode: "all" } });
check("teammate without messages.send: send refused 403", deniedSend.status === 403, `got ${deniedSend.status}`);
const withFlag = await makeTeammate(`withflag-${uniq()}@fixtures.dev`, { "messages.send": true });
const allowedRead = await withFlag("GET", "/api/admin/broadcasts");
check("teammate with messages.send: history opens", allowedRead.status === 200 && Array.isArray(allowedRead.data.broadcasts), `got ${allowedRead.status}`);
const anon = makeClient();
const anonRead = await anon("GET", "/api/admin/broadcasts");
check("anonymous read refused", anonRead.status === 401 || anonRead.status === 403, `got ${anonRead.status}`);

// --- Source guards: the room is wired into the shell --------------
const appSrc = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
check("rail carries Messages right after Requests", appSrc.includes('add("a", "requests", "Requests"') && appSrc.indexOf('"Messages", "return go(\'dashboard\',\'Messages\')"') > appSrc.indexOf('add("a", "requests", "Requests"'));
check("renderAdmin dispatches the Messages tab", appSrc.includes('if (tab === "Messages") loadAdminMessages152();'));
check("client perm map knows the room", appSrc.includes('"Messages": ["messages.send"]'));
check("room loader exists with compose + history + detail", appSrc.includes("async function loadAdminMessages152()") && appSrc.includes("bc152OpenBroadcast") && appSrc.includes("bc152SendThreadReply"));
check("recipient conversation renders a message title", appSrc.includes('m.title ? `<div class="msg-title">'));
const permSrc = fs.readFileSync(new URL("../netlify/functions/lib/permissions.js", import.meta.url), "utf8");
check("server flag + label + room mapping exist", permSrc.includes('"messages.send"') && permSrc.includes("Messages: send in-app messages") && permSrc.includes('"Messages": ["messages.send"]'));

console.log(`\nverify-build152: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
