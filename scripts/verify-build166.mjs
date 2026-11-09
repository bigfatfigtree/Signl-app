// verify-build166.mjs — Build -166: the Messages home gets
// Jeff's toggle (his order, 2026-11-09: "I need a toggle at
// the top where I can see messages that are being sent out
// individually and messages I can broadcast to segments —
// this is too complicated and too much to scroll").
//   1. Two views, one toggle, at the top of Admin → Messages:
//      "Conversations" and "Send to many" — house view-toggle
//      pattern, the choice remembered on the device.
//   2. Never stacked: the loader renders ONE view's panels;
//      the other view's DOM is not on the page (rendered
//      behavior proven in the Playwright QA; here the source
//      branch shape is pinned).
//   3. Copy diet: the -163/-164 explainer paragraphs are GONE
//      from the client; each view keeps at most one short line
//      under its heading.
//   4. Crossings still land right: a campaign recipient chip
//      switches to Conversations with that thread open; a
//      record Message button (Applications) lands in
//      Conversations; a broadcast-composer pick lands in
//      Send to many.
//   5. The jobs themselves are untouched: threads +
//      needs-reply, the segment send (fenced, confirm names
//      the market), campaign receipts recorded at send time,
//      the broadcast room's data — all still work end to end.
// Run: node scripts/verify-build166.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build166-${Date.now()}.json`);
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
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin (Jeff) login succeeds", r.status === 200, `got ${r.status}`);
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
async function seedMessage({ fromId, toId, body, createdAt }) {
  const id = `fixture166-${uniq()}-${uniq()}`;
  await store.set(`message:${id}`, { id, threadId: threadIdFor(fromId === PEER ? toId : fromId), fromId, toId, body, platform: true, createdAt });
  return id;
}

// --- A: source pins — the toggle + the two views --------------
console.log("== A: toggle + views (source) ==");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
{
  const homeSrc = appJs.slice(appJs.indexOf("async function loadAdminMessages152()"), appJs.indexOf("async function bc153LoadAll()"));
  check("toggle: both views offered at the top, house view-toggle pattern, Jeff's words",
    homeSrc.includes('class="view-toggle"') && homeSrc.includes("adminMsgShowView166('conversations')") && homeSrc.includes("adminMsgShowView166('many')")
    && homeSrc.includes(">Conversations</button>") && homeSrc.includes(">Send to many</button>"), homeSrc.slice(0, 240));
  check("never stacked: the loader branches on ONE view — campaigns + broadcast room render only in the Send-to-many branch",
    homeSrc.includes('if (view === "many")') && homeSrc.indexOf('id="admin-campaigns-panel"') > homeSrc.indexOf('if (view === "many")')
    && homeSrc.indexOf('id="bc153-room"') > homeSrc.indexOf('if (view === "many")')
    && homeSrc.indexOf('id="admin-msg-panel"') > homeSrc.indexOf('if (view === "many")'), "");
  check("default view is Conversations; the choice persists on the device",
    appJs.includes('localStorage.getItem("magpie-admin-msg-view")') && appJs.includes('localStorage.setItem("magpie-admin-msg-view", adminMsg.view)')
    && appJs.includes('adminMsg.view = adminMsgSavedView166()'), "");
  check("landing straight on Send to many still feeds the segment tool (markets + templates loaded)",
    appJs.includes("adminMsgEnsureComposeData166") && homeSrc.includes("await adminMsgEnsureComposeData166();"), "");
  check("a stashed broadcast-composer pick lands on Send to many, where the composer lives",
    homeSrc.includes('if (adminBc153.pendingPickId) adminMsgSetView166("many");'), "");
}

// --- B: copy diet ----------------------------------------------
console.log("== B: copy diet ==");
{
  const gone = [
    "Every conversation and every message sent to many people lives on this one screen",
    "People reply right in their thread in the app, and their replies land in Conversations below",
    "Every conversation with a creator, a business or a partner, newest first — all in this one place",
    "stays marked until you answer it; opening it does not clear the mark",
    "each one also emails them a short notification",
    "Every message sent to more than one person, recorded once: when it went, the exact words, who sent it, and exactly who got it",
    "Tap a name to open that person's conversation above",
    "A broadcast writes ONE new message into many people's inboxes at once — different from replying in a conversation above",
    "Loading the record of messages sent to many people...",
    "live in Conversations at the top of this screen",
    "in Conversations at the top of this screen, where you answer it",
    "To write to one person, open their conversation above and reply there",
  ];
  for (const s of gone) check(`gone: "${s.slice(0, 52)}..."`, !appJs.includes(s), "");
  check("kept: one short line under Conversations", appJs.includes("Every conversation, newest first."), "");
  check("kept: one short line under Sent to many",
    appJs.includes("Every message sent to more than one person — when, the exact words, and who got it. Tap a name to open their conversation."), "");
  check("kept: one short line under Broadcast room", appJs.includes("One message into many people's inboxes at once."), "");
  check("kept: the segment fence still says what it is (a send to many, not a reply)",
    appJs.includes("Send to a market segment") && appJs.includes("send to MANY people at once") && appJs.includes("It is not a reply in a conversation."), "");
}

// --- C: crossings ----------------------------------------------
console.log("== C: crossings (source) ==");
{
  const chipSrc = appJs.slice(appJs.indexOf("function adminCampOpenThread163("), appJs.indexOf("function adminCampPanelHtml163()"));
  check("recipient chip: sets the thread, then switches to the Conversations view",
    chipSrc.includes("adminMsg.openCreatorId = peerId") && chipSrc.includes('adminMsgShowView166("conversations")'), chipSrc.slice(0, 200));
  const composeSrc = appJs.slice(appJs.indexOf("function adminMsgComposeTo("), appJs.indexOf("function adminMsgClearTarget()"));
  check("record Message button: lands in the Conversations view with the thread open",
    composeSrc.includes('adminMsgSetView166("conversations")') && composeSrc.includes('go("dashboard", "Messages")'), composeSrc.slice(0, 200));
  const reqSrc = appJs.slice(appJs.indexOf("async function loadAdminRequests()"), appJs.indexOf("// Admin profile view"));
  check("Requests still only points into Messages (no thread panel of its own)",
    !reqSrc.includes('id="admin-msg-panel"') && reqSrc.includes("All conversations moved to Messages"), "");
  check("broadcast room preserved: folders + Write a broadcast",
    appJs.includes("Write a broadcast") && appJs.includes("Broadcast room") && appJs.includes("Inbox — replies to your broadcasts"), "");
}

// --- D: the jobs still work (API) -------------------------------
console.log("== D: jobs end to end ==");
const nash1 = await registerCreator("View One", "viewone166", "Nashville"); await approve(nash1.id);
const nash2 = await registerCreator("View Two", "viewtwo166", "Nashville"); await approve(nash2.id);
{
  const rows = await store.list("message:");
  for (const r of rows) if (r.value && r.value.platform) await store.del(r.key);
}
await seedMessage({ fromId: PEER, toId: nash1.id, body: "Welcome to Magpie — your founding spot is held.", createdAt: "2026-11-09T15:00:00.000Z" });
await seedMessage({ fromId: nash1.id, toId: PEER, body: "Thanks! One question — when do offers start?", createdAt: "2026-11-09T15:30:00.000Z" });
{
  const overview = (await admin("GET", "/api/admin/platform-messages")).data;
  const t = (overview.threads || []).find((x) => x.peerId === nash1.id);
  check("conversations: the thread lists with its time and flags needs-reply",
    !!t && t.needsReply === true && !!t.lastAt, JSON.stringify(t).slice(0, 200));
  const detail = (await admin("GET", "/api/admin/platform-messages?creatorId=" + encodeURIComponent(nash1.id))).data;
  check("conversations: opening the thread returns both sides of it",
    detail && Array.isArray(detail.messages) && detail.messages.length === 2, JSON.stringify(detail).slice(0, 160));
  const reply = await admin("POST", "/api/admin/platform-messages", { creatorId: nash1.id, body: "Fixture reply from the team." });
  const after = (await admin("GET", "/api/admin/platform-messages")).data;
  const t2 = (after.threads || []).find((x) => x.peerId === nash1.id);
  check("conversations: a reply in the thread clears the flag",
    reply.status === 201 && !!t2 && t2.needsReply === false, `${reply.status}`);
}
{
  const segBody = "Segment fixture 166: Nashville, your founding spot is held.";
  const seg = await admin("POST", "/api/admin/platform-messages", { market: "Nashville", body: segBody });
  check("send to many: the segment send reaches both finished Nashville creators", seg.status === 201 && seg.data.sent === 2, `${seg.status}`);
  const campaigns = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
  const entry = campaigns.find((c) => c.body === segBody);
  check("send to many: the receipt is recorded at send time (2 people · 2 messages, recipients listed)",
    !!entry && entry.recipientCount === 2 && entry.messageCount === 2 && (entry.recipients || []).length === 2, JSON.stringify(entry).slice(0, 200));
  const bc = await admin("GET", "/api/admin/broadcasts");
  check("send to many: the broadcast room's data still loads", bc.status === 200 && Array.isArray(bc.data.broadcasts), `${bc.status}`);
}

console.log(`\nverify-build166: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
