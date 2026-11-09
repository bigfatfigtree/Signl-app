// verify-build153.mjs — Build -153: the Admin Messages room,
// reworked the way Jeff ordered it (2026-11-08):
//   - the audience picker is a SEARCH PORTAL (search + role /
//     market / tier / status filters over a live people list),
//     not buttons: this suite proves the portal search and the
//     send resolver are the same math, filter combination by
//     filter combination
//   - PARTNERS are a first-class audience: pickable by filter
//     and by name, they receive broadcasts in their Magpie-team
//     thread, they can read and reply there (the launch gate
//     opens the team thread to them, nothing else), and a
//     partner segment exists end to end
//   - 1:1 sends are a distinct path: picking exactly one person
//     (creator, business, partner) sends a private thread to
//     them alone — the label names them, one message exists,
//     and another seeded user provably does not see it
//   - DRAFTS: save, list, reopen, edit, send (a sent draft is
//     spent), delete; drafts belong to the admin who wrote them
//   - FOLDERS: create, the default names are protected, file a
//     sent broadcast and a reply conversation, counts track,
//     rename, delete unfiles without deleting anything
//   - the Inbox (reply conversations) rides the history read
//   - the messages.send flag gates every new route too
// Run: node scripts/verify-build153.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build153-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["signl", "test", "admin"].join("-");
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const routerSrcEarly = fs.readFileSync(new URL("../netlify/functions/lib/router.js", import.meta.url), "utf8");
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

async function registerCreator(name, handle, market, tierBand) {
  const c = makeClient();
  const email = `${handle.replace(/[^a-z0-9]/gi, "")}-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: PW, market, city: market, handle,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand,
    followerCount: tierBand === "Headliners" ? 22000 : 4200, avgViews: 1500, localAudiencePct: 68,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
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
async function loginAs(email) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email, password: PW });
  if (r.status !== 200) throw new Error("login failed for " + email + ": " + JSON.stringify(r.data));
  return c;
}

// --- Cast -----------------------------------------------------
// A: Nashville creator, Locals, ALSO listed in Chicago.
// B: Nashville creator, Headliners.
// C: Chicago creator, Locals.
// D: Nashville business, ACTIVATED.  E: Chicago business.
// PT: partner "Tierney Media", contact Pat Tierney, Nashville.
const A = await registerCreator("Ana Anchor", "ana.anchor", "Nashville", "Locals");
const B = await registerCreator("Hank Headline", "hank.headline", "Nashville", "Headliners");
const C = await registerCreator("Chiara Chi", "chiara.chi", "Chicago", "Locals");
const D = await registerBusiness("Dan Diner", "Fixture Diner", "Nashville");
const E = await registerBusiness("Elena Eats", "Fixture Eatery", "Chicago");
for (const u of [A, B, C, D, E]) await approve(u.id);
{
  const r = await admin("POST", "/api/admin/businesses/activate", { userId: D.id });
  if (r.status !== 200) throw new Error("activate failed: " + JSON.stringify(r.data));
  const a = await store.get(`user:${A.id}`);
  a.creator = { ...(a.creator || {}), audienceMarkets: [{ market: "Chicago", pct: 25 }] };
  await store.set(`user:${A.id}`, a);
}
const PT_EMAIL = `tierney-${uniq()}@fixtures.dev`;
const PT_ID = "partner-153-id";
{
  const { salt, hash } = hashPassword(PW);
  const now = new Date().toISOString();
  const partner = { name: "Tierney Media", type: "media", contactName: "Pat Tierney", code: "tierney-media", markets: ["Nashville"], sharePct: 50, status: "active", agreementStatus: "unsigned", demo: false, createdAt: now };
  await store.set(`user:${PT_ID}`, {
    id: PT_ID, role: "partner", email: PT_EMAIL, name: "Pat Tierney", passwordSalt: salt, passwordHash: hash,
    status: "approved", tester: false, market: "Nashville", createdAt: now, updatedAt: now,
    reviewedAt: now, termsVersion: "2026-10-19", termsAcceptedAt: now, creator: null, business: null, partner,
  });
  await store.set(`email:${PT_EMAIL}`, { userId: PT_ID });
}
const PT = { id: PT_ID, email: PT_EMAIL };
const clientB = await loginAs(B.email);
const clientPT = await loginAs(PT.email);

// --- The portal search: same math as the resolver -------------
async function search(qs) {
  const r = await admin("GET", "/api/admin/broadcasts/search?" + qs);
  if (r.status !== 200) throw new Error("search failed: " + JSON.stringify(r.data));
  return r.data;
}
async function preview(spec) {
  const r = await admin("POST", "/api/admin/broadcasts/preview", { spec });
  if (r.status !== 200) throw new Error("preview failed: " + JSON.stringify(r.data));
  return r.data;
}
const TOTAL = 6; // A, B, C, D, E, PT — the pending-free, approved pool
check("search: no filters finds everyone messageable (incl. the partner)", (await search("")).total === TOTAL, JSON.stringify(await search("")).slice(0, 200));
check("search: creators only = 3", (await search("roles=creator")).total === 3);
check("search: businesses only = 2", (await search("roles=business")).total === 2);
check("search: partners only = 1, and it is Tierney Media", (await search("roles=partner")).total === 1 && (await search("roles=partner")).people[0].partnerName === "Tierney Media");
check("search: creators in Chicago = 2 (Ana counts where she is listed)", (await search("roles=creator&markets=Chicago")).total === 2);
check("search: Locals creators = 2", (await search("roles=creator&tiers=Locals")).total === 2);
check("search: Nashville + Locals = 1", (await search("roles=creator&markets=Nashville&tiers=Locals")).total === 1);
check("search: by handle finds Ana alone", (await search("q=" + encodeURIComponent("ana.anchor"))).total === 1);
check("search: by partner name finds the partner", (await search("q=" + encodeURIComponent("Tierney"))).total === 1);
check("search: by business name finds the diner", (await search("q=" + encodeURIComponent("Fixture Diner"))).total === 1);
check("search: joined in the last 30 days = everyone (all fixtures are new)", (await search("status=new")).total === TOTAL);
check("search: activated = 5 (the un-activated Chicago business drops out)", (await search("status=activated")).total === 5);
check("search: ?ids= resolves the partner directly, with a partner view", (await search("ids=" + PT.id)).people[0].label.includes("Tierney Media"));
check("preview == search: creators in Chicago", (await preview({ mode: "search", roles: ["creator"], markets: ["Chicago"], selectAll: true })).count === (await search("roles=creator&markets=Chicago")).total);
check("preview == search: everyone matching", (await preview({ mode: "search", roles: ["creator", "business", "partner"], selectAll: true })).count === TOTAL);
check("preview == search: partners", (await preview({ mode: "search", roles: ["partner"], selectAll: true })).count === 1);
const pvPartner = await preview({ mode: "partners" });
check("preview: the partners segment counts the partner", pvPartner.count === 1 && pvPartner.audienceLabel.includes("partner"), pvPartner.audienceLabel);
check("preview: a one-person audience comes back solo, named for the confirm", !!pvPartner.solo && pvPartner.solo.id === PT.id, JSON.stringify(pvPartner).slice(0, 200));
check("preview: everyone now includes partners in the label", (await preview({ mode: "all" })).audienceLabel.includes("partners"));

// --- Partner segment send, receipt and reply -------------------
const ptSend = await admin("POST", "/api/admin/broadcasts", { title: "Partner briefing", body: "Nashville numbers inside.", spec: { mode: "partners" } });
check("partner segment send returns 201, one recipient", ptSend.status === 201 && ptSend.data.broadcast.recipientCount === 1, JSON.stringify(ptSend.data).slice(0, 200));
const ptBroadcast = ptSend.data.broadcast;
{
  const msgs = (await store.list("message:")).map((r) => r.value).filter((m) => m && m.broadcastId === ptBroadcast.id);
  check("partner received exactly one message, in their own team thread, titled", msgs.length === 1 && msgs[0].toId === PT.id && msgs[0].fromId === "signl-team" && msgs[0].title === "Partner briefing" && msgs[0].threadId === [PT.id, "signl-team"].sort().join("__"), JSON.stringify(msgs).slice(0, 200));
}
const ptInbox = await clientPT("GET", "/api/messages");
{
  const t = (ptInbox.data.threads || []).find((x) => x.otherId === "signl-team");
  check("partner inbox lists the Magpie thread, titled, unread", ptInbox.status === 200 && !!t && t.platform === true && t.lastMessage.title === "Partner briefing" && t.unread === true, `status ${ptInbox.status}: ` + JSON.stringify(ptInbox.data).slice(0, 200));
}
const ptThread = await clientPT("GET", "/api/messages?with=signl-team");
check("partner can open the team thread", ptThread.status === 200 && (ptThread.data.messages || []).some((m) => m.title === "Partner briefing"), JSON.stringify(ptThread.data).slice(0, 200));
// The launch gate itself is inert in TEST_MODE (isMarketLive
// returns true locally), so the P2P wall cannot be exercised
// here; what CAN be proven is the exemption's shape: it opens
// for the platform peer only, never for a person.
check("partner gate exemption is scoped to the team thread only", /partnerPlatformMsgOk = String\(gateBody\.toUserId \|\| ""\) === PLATFORM_PEER_ID/.test(routerSrcEarly) && /partnerPlatformMsgOk = !query\.with \|\| query\.with === PLATFORM_PEER_ID/.test(routerSrcEarly));
const ptReply = await clientPT("POST", "/api/messages", { toUserId: "signl-team", body: "Got it — numbers look right." });
check("partner reply in the team thread accepted", ptReply.status === 201, `got ${ptReply.status}: ${JSON.stringify(ptReply.data)}`);
{
  const detail = await admin("GET", `/api/admin/broadcasts/${ptBroadcast.id}`);
  const thread = (detail.data.threads || []).find((t) => t.user.id === PT.id);
  check("admin detail shows the partner's reply under their thread", !!thread && thread.messages.some((m) => m.fromId === PT.id && m.body.includes("numbers look right")) && thread.messages.some((m) => m.fromId === "signl-team" && m.title === "Partner briefing"), JSON.stringify(detail.data).slice(0, 300));
  const hist = await admin("GET", "/api/admin/broadcasts");
  const convo = (hist.data.inbox || []).find((c) => c.broadcastId === ptBroadcast.id && c.userId === PT.id);
  check("history carries the Inbox: the partner conversation, labelled, one reply", !!convo && convo.replyCount === 1 && convo.label.includes("Tierney"), JSON.stringify(hist.data.inbox).slice(0, 300));
}

// --- 1:1 sends: a private thread per person, per role ---------
async function soloSend(target, title) {
  const r = await admin("POST", "/api/admin/broadcasts", { title, body: "Just between us.", spec: { mode: "search", roles: ["creator", "business", "partner"], userIds: [target.id], selectAll: false } });
  if (r.status !== 201) throw new Error("solo send failed: " + JSON.stringify(r.data));
  return r.data.broadcast;
}
async function threadTitlesFor(client, broadcastId) {
  const all = (await store.list("message:")).map((r) => r.value).filter((m) => m && m.broadcastId === broadcastId);
  return all;
}
const soloA = await soloSend(A, "For Ana only");
check("1:1 creator: the label names the person", soloA.audienceLabel.startsWith("One person picked by name:") && soloA.audienceLabel.includes("Ana Anchor"), soloA.audienceLabel);
{
  const msgs = await threadTitlesFor(null, soloA.id);
  check("1:1 creator: exactly one message exists, to Ana", msgs.length === 1 && msgs[0].toId === A.id, `got ${msgs.length}`);
  const bThread = await clientB("GET", "/api/messages?with=signl-team");
  check("1:1 creator: another creator's team thread does NOT contain it", !(bThread.data.messages || []).some((m) => m.broadcastId === soloA.id), JSON.stringify(bThread.data).slice(0, 200));
}
const soloD = await soloSend(D, "For the Diner only");
check("1:1 business: the label names the business", soloD.audienceLabel.includes("Fixture Diner"), soloD.audienceLabel);
{
  const msgs = await threadTitlesFor(null, soloD.id);
  check("1:1 business: exactly one message exists, to the diner", msgs.length === 1 && msgs[0].toId === D.id, `got ${msgs.length}`);
}
const soloPT = await soloSend(PT, "For Pat only");
check("1:1 partner: the label names the partner", soloPT.audienceLabel.includes("Tierney Media"), soloPT.audienceLabel);
{
  const msgs = await threadTitlesFor(null, soloPT.id);
  check("1:1 partner: exactly one message exists, to the partner", msgs.length === 1 && msgs[0].toId === PT.id, `got ${msgs.length}`);
  const bThread = await clientB("GET", "/api/messages?with=signl-team");
  check("1:1 partner: another user's team thread does NOT contain it", !(bThread.data.messages || []).some((m) => m.broadcastId === soloPT.id));
}

// --- Drafts ------------------------------------------------------
const draftSave = await admin("POST", "/api/admin/broadcasts/drafts", { title: "Launch draft", body: "Half written.", spec: { mode: "search", roles: ["creator"], markets: ["Nashville"], userIds: [B.id], selectAll: false }, audienceLabel: "Creators in Nashville, plus 1 picked by name" });
check("draft saves", draftSave.status === 201 && !!draftSave.data.draft.id, JSON.stringify(draftSave.data).slice(0, 200));
const draftId = draftSave.data.draft.id;
const draftList = await admin("GET", "/api/admin/broadcasts/drafts");
check("draft lists with its audience label", (draftList.data.drafts || []).some((d) => d.id === draftId && d.audienceLabel.includes("Nashville")), JSON.stringify(draftList.data).slice(0, 200));
const draftEdit = await admin("POST", "/api/admin/broadcasts/drafts", { id: draftId, title: "Launch draft, finished", body: "Fully written now.", spec: { mode: "search", roles: ["creator"], markets: ["Nashville"], userIds: [B.id], selectAll: false }, audienceLabel: "Creators in Nashville, plus 1 picked by name" });
check("draft reopens and edits in place", draftEdit.status === 200 && draftEdit.data.draft.title === "Launch draft, finished" && draftEdit.data.draft.spec.userIds[0] === B.id, JSON.stringify(draftEdit.data).slice(0, 200));
const draftSend = await admin("POST", "/api/admin/broadcasts", { title: "Launch draft, finished", body: "Fully written now.", spec: { mode: "search", roles: ["creator"], markets: ["Nashville"], userIds: [B.id], selectAll: false }, draftId });
check("sending the draft works (picks-only audience: just Hank, the person the draft named)", draftSend.status === 201 && draftSend.data.broadcast.recipientCount === 1, JSON.stringify(draftSend.data).slice(0, 200));
check("preview: select-all-matching PLUS a pick unions (Nashville creators + Chiara picked = 3)", (await preview({ mode: "search", roles: ["creator"], markets: ["Nashville"], userIds: [C.id], selectAll: true })).count === 3);
const draftGone = await admin("GET", `/api/admin/broadcasts/drafts/${draftId}`);
check("a sent draft is spent — it leaves Drafts", draftGone.status === 404, `got ${draftGone.status}`);
const draftTwo = await admin("POST", "/api/admin/broadcasts/drafts", { title: "Throwaway", body: "x", spec: { mode: "search", roles: ["partner"], selectAll: true } });
const draftTwoDel = await admin("DELETE", `/api/admin/broadcasts/drafts/${draftTwo.data.draft.id}`);
const draftTwoGone = await admin("GET", `/api/admin/broadcasts/drafts/${draftTwo.data.draft.id}`);
check("draft delete works", draftTwoDel.status === 200 && draftTwoGone.status === 404);

// --- Folders ------------------------------------------------------
const folderMake = await admin("POST", "/api/admin/broadcasts/folders", { name: "Launch" });
check("custom folder creates", folderMake.status === 201 && folderMake.data.folder.name === "Launch", JSON.stringify(folderMake.data).slice(0, 200));
const folderId = folderMake.data.folder.id;
const protectedName = await admin("POST", "/api/admin/broadcasts/folders", { name: "Sent" });
check("a default folder name is protected", protectedName.status === 400, `got ${protectedName.status}`);
const fileSend = await admin("POST", `/api/admin/broadcasts/${ptBroadcast.id}/file`, { folderId });
check("a sent broadcast files into the folder", fileSend.status === 200 && fileSend.data.broadcast.folderId === folderId, JSON.stringify(fileSend.data).slice(0, 200));
const fileThread = await admin("POST", `/api/admin/broadcasts/${ptBroadcast.id}/file-thread`, { userId: PT.id, folderId });
check("a reply conversation files into the folder", fileThread.status === 200 && fileThread.data.threadFolders[PT.id] === folderId, JSON.stringify(fileThread.data).slice(0, 200));
{
  const hist = await admin("GET", "/api/admin/broadcasts");
  const f = (hist.data.folders || []).find((x) => x.id === folderId);
  check("folder counts the send AND the conversation (2)", !!f && f.count === 2, JSON.stringify(hist.data.folders).slice(0, 200));
  const convo = (hist.data.inbox || []).find((c) => c.broadcastId === ptBroadcast.id && c.userId === PT.id);
  check("the filed conversation carries the folder id", !!convo && convo.folderId === folderId);
  const row = (hist.data.broadcasts || []).find((b) => b.id === ptBroadcast.id);
  check("the filed broadcast carries the folder id", !!row && row.folderId === folderId);
}
const badFile = await admin("POST", `/api/admin/broadcasts/${ptBroadcast.id}/file`, { folderId: "no-such-folder" });
check("filing into a folder that is not yours/on file refuses", badFile.status === 404, `got ${badFile.status}`);
const folderRename = await admin("PATCH", `/api/admin/broadcasts/folders/${folderId}`, { name: "Launch 2026" });
check("folder renames", folderRename.status === 200 && folderRename.data.folder.name === "Launch 2026", JSON.stringify(folderRename.data).slice(0, 200));
const folderDel = await admin("DELETE", `/api/admin/broadcasts/folders/${folderId}`);
check("folder deletes", folderDel.status === 200);
{
  const hist = await admin("GET", "/api/admin/broadcasts");
  const row = (hist.data.broadcasts || []).find((b) => b.id === ptBroadcast.id);
  const convo = (hist.data.inbox || []).find((c) => c.broadcastId === ptBroadcast.id && c.userId === PT.id);
  check("deleting the folder unfiles — nothing is deleted", !!row && row.folderId === null && !!convo && convo.folderId === null && !(hist.data.folders || []).some((f) => f.id === folderId));
}

// --- The flag gate, on the new routes -----------------------------
async function makeTeammate(email, flags) {
  const id = (await import("node:crypto")).randomUUID();
  const { salt, hash } = hashPassword(PW);
  await store.set(`user:${id}`, {
    id, role: "admin", email, name: "Teammate Fixture", passwordSalt: salt, passwordHash: hash,
    status: "approved", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    adminPerms: { super: false, flags, markets: null, statScopes: [], template: null, grantedBy: "verify-build153", grantedAt: new Date().toISOString() },
  });
  await store.set(`email:${email}`, { userId: id });
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email, password: PW });
  if (r.status !== 200) throw new Error("teammate login failed: " + JSON.stringify(r.data));
  return c;
}
const noFlag = await makeTeammate(`noflag153-${uniq()}@fixtures.dev`, { "creators.view": true });
check("teammate without messages.send: portal search refused 403", (await noFlag("GET", "/api/admin/broadcasts/search")).status === 403);
check("teammate without messages.send: folders refused 403", (await noFlag("GET", "/api/admin/broadcasts/folders")).status === 403);
check("teammate without messages.send: drafts refused 403", (await noFlag("POST", "/api/admin/broadcasts/drafts", { title: "x" })).status === 403);
const withFlag = await makeTeammate(`withflag153-${uniq()}@fixtures.dev`, { "messages.send": true });
const flagDrafts = await withFlag("GET", "/api/admin/broadcasts/drafts");
check("teammate with the flag: drafts open — and hold only their own (none)", flagDrafts.status === 200 && (flagDrafts.data.drafts || []).length === 0, JSON.stringify(flagDrafts.data).slice(0, 200));

// --- Source guards: the portal is wired into the shell ------------
const appSrc = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
check("composer is the search portal (search box + filter rail + results)", appSrc.includes("bc153-portal") && appSrc.includes("Search by name, @handle, or business") && appSrc.includes("Select all"));
check("selection is always visible, with a named 1:1 note", appSrc.includes("Who's getting it") && appSrc.includes("one-to-one message"));
check("confirm names the person on a solo send", appSrc.includes("Send this to ${esc(solo.label)}?"));
check("partner shell carries a Messages tab wired to the thread list", appSrc.includes('"Messages", "Performance"') && appSrc.includes('if (tab === "Messages") loadThreads();'));
check("Message buttons exist on admin records", appSrc.includes("adminMessagePerson153"));
check("client reply-back uses the -152 reply route (id/reply, userId in body)", appSrc.includes('"/reply", { userId, body }') && !appSrc.includes("/threads/\" + encodeURIComponent(userId) + \"/reply"));
const routerSrc = fs.readFileSync(new URL("../netlify/functions/lib/router.js", import.meta.url), "utf8");
check("server: partner team-thread gate exemption exists", routerSrc.includes("partnerPlatformMsgOk"));
check("server: portal search + drafts + folders routes exist", routerSrc.includes('seg[2] === "search"') && routerSrc.includes('seg[2] === "drafts"') && routerSrc.includes('seg[2] === "folders"'));
check("server: the 1:1 label names the person", routerSrc.includes("One person picked by name: "));

console.log(`\nverify-build153: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
