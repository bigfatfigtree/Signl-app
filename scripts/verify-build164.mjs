// verify-build164.mjs — Build -164: Messages home wart cleanup
// (Jeff approved the punch list from the -163 live pass).
//   1. The rebuilt Category entry's time is the earliest THREAD
//      message in its window — a broadcast copy of the same
//      text (stamped with its broadcastId) never joins a
//      segment cluster; an entry stored wrong by the -163 pass
//      is REPAIRED in place on next load.
//   2. Staff-owned threads (the admin's own account, testers)
//      never flag needs-reply and never count in the waiting
//      line; the threads themselves stay listed.
//   3. The rebuilt note on screen is plain words — no file
//      paths, no build numbers (asserted on the client source
//      and on the API payload).
//   4. Every Sent-to-many entry carries people AND messages
//      counts (broadcasts included), one shape for all.
//   5. The broadcast room's Inbox says it counts replies to
//      broadcasts only.
//   6. One sender label everywhere: the admin account's name,
//      on rebuilt, at-send-time and broadcast entries alike.
//   7. A warm campaigns read never scans the message store
//      (the -163 pass listed every message on every read).
// Run: node scripts/verify-build164.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build164-${Date.now()}.json`);
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
async function seedMessage({ fromId, toId, body, createdAt, platform = true, broadcastId = null }) {
  const id = `fixture164-${uniq()}-${uniq()}`;
  const m = { id, threadId: threadIdFor(fromId === PEER ? toId : fromId), fromId, toId, body, platform, createdAt };
  if (broadcastId) m.broadcastId = broadcastId;
  await store.set(`message:${id}`, m);
  return id;
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const campSrc = appJs.slice(appJs.indexOf("function adminCampPanelHtml163()"), appJs.indexOf("// ---------- admin: Messages room"));
  check("counts: every entry renders people AND messages, one shape (no M>N condition left)",
    campSrc.includes("c.messageCount != null ? c.messageCount : c.recipientCount") && !campSrc.includes("c.messageCount !== c.recipientCount"), campSrc.slice(0, 200));
  check("note: the rebuilt note on screen is the plain-words sentence, no stored source, no file paths",
    campSrc.includes("Rebuilt from the messages in the threads themselves — this send predates campaign records.")
    && !campSrc.includes("c.source") && !campSrc.includes("signl-campaign-run"), campSrc.slice(0, 200));
  check("broadcast room: the Inbox names broadcasts + says other replies live in Conversations",
    appJs.includes("Inbox — replies to your broadcasts") && appJs.includes("counts replies to broadcasts only")
    && appJs.includes("No replies to a broadcast yet.") && !appJs.includes("Inbox — replies to your messages"), "");
  // Pin updated at Build -165 (2026-11-09): the repair gate
  // legitimately moved — the -164 done-stamp already fired in
  // production, so the recompute re-runs once under the new
  // gate backfill:msgcampaigns-165 and stamps records
  // repaired165 (a prior repaired164 stamp is carried through,
  // never re-claimed). The broadcast-exclusion arm is unchanged.
  check("server: backfill excludes broadcast-stamped copies + repairs under a done-stamp",
    routerJs.includes("if (m.broadcastId) continue;") && routerJs.includes('"backfill:msgcampaigns-165"') && routerJs.includes("repaired165: true"), "");
  // Pin updated at Build -165 (2026-11-09): the staff predicate
  // was renamed staffPeer165 when it gained the explicit
  // isStaff marker arm (see maybeMarkStaff165) — Jeff's real
  // creator account shares no email/id with the admin record,
  // so the -164 live arms alone could not exempt it.
  check("server: staff-owned peers are exempt from needs-reply",
    routerJs.includes("staffPeer165") && routerJs.includes("needsReply: !staffOwned && !!lastMessage && lastMessage.fromId === peerId"), "");
}

// --- B: fixture people ----------------------------------------
console.log("== B: fixtures ==");
const CAT_BODY = "Hi, quick one from Maggie. Most creators here aren't just one thing. If your page isn't only about one thing, add the rest — ten seconds in your Profile, under \"What you create in.\" Every category you add is another kind of business that can send you offers.";
const CITY_BODY = "One more from Maggie — this one's about your second city. If a real chunk of your followers lives somewhere else, you can be listed there too, not just at home. Two steps in your Profile, under \"Your audience in other markets\": add the city, then flip that city's switch on.";
const cat1 = await registerCreator("Cat One", "catone164", "Nashville"); await approve(cat1.id);
const cat2 = await registerCreator("Cat Two", "cattwo164", "Nashville"); await approve(cat2.id);
const cat3 = await registerCreator("Cat Three", "catthree164", "Austin"); await approve(cat3.id);
const city1 = await registerCreator("City One", "cityone164", "Denver"); await approve(city1.id);
const city2 = await registerCreator("City Two", "citytwo164", "Denver"); await approve(city2.id);
const bizC = makeClient();
const bizReg = await bizC("POST", "/api/auth/register", {
  role: "business", name: "Biz Owner", businessName: "Threadless Kitchen", email: `biz-${uniq()}@fixtures.dev`, password: "business-pass-123",
  market: "Nashville", city: "Nashville", category: "Restaurant", planId: "growth", neighborhood: "East Nashville", agreedTerms: true,
});
if (bizReg.status !== 201) throw new Error("business register failed: " + JSON.stringify(bizReg.data));
const bizId = bizReg.data.user.id;
await approve(bizId);

// Jeff's OWN creator account (same email as the admin account)
// and a tester account — both staff-owned for the home.
const ownId = `fixture164-own-${uniq()}`;
await store.set(`user:${ownId}`, { id: ownId, role: "creator", name: "Jeff Rimmer", email: process.env.ADMIN_EMAIL, market: "Denver", status: "approved", creator: { handle: "ownacct164" }, createdAt: "2026-11-01T00:00:00.000Z" });
const testerId = `fixture164-tester-${uniq()}`;
await store.set(`user:${testerId}`, { id: testerId, role: "creator", name: "Tony Tester", email: `tester-${uniq()}@fixtures.dev`, market: "Denver", status: "approved", tester: true, creator: { handle: "tester164" }, createdAt: "2026-11-01T00:00:00.000Z" });

// Registration fired finish-moment messages; sweep them so the
// seeded history below is the whole story.
{
  const rows = await store.list("message:");
  for (const r of rows) if (r.value && r.value.platform) await store.del(r.key);
}

// The 2026-11-09 sends: category copy to 3 creators (one
// twice), second-city copy to 3 — plus the 09:10 BROADCAST twin
// of the category copy in cat1's thread (broadcastId-stamped).
await seedMessage({ fromId: PEER, toId: cat1.id, body: CAT_BODY, createdAt: "2026-11-09T14:10:00.000Z", broadcastId: "bcast-twin-164" });
await seedMessage({ fromId: PEER, toId: cat1.id, body: CAT_BODY, createdAt: "2026-11-09T14:17:00.000Z" });
await seedMessage({ fromId: PEER, toId: cat1.id, body: CAT_BODY, createdAt: "2026-11-09T14:18:00.000Z" });
await seedMessage({ fromId: PEER, toId: cat2.id, body: CAT_BODY, createdAt: "2026-11-09T14:19:00.000Z" });
await seedMessage({ fromId: PEER, toId: cat3.id, body: CAT_BODY, createdAt: "2026-11-09T14:20:00.000Z" });
await seedMessage({ fromId: PEER, toId: city1.id, body: CITY_BODY, createdAt: "2026-11-09T15:03:00.000Z" });
await seedMessage({ fromId: PEER, toId: city2.id, body: CITY_BODY, createdAt: "2026-11-09T15:04:00.000Z" });
await seedMessage({ fromId: PEER, toId: cat1.id, body: CITY_BODY, createdAt: "2026-11-09T15:05:00.000Z" });
// The broadcast record for the twin (its own Sent-to-many entry).
await store.set("broadcast:bcast-twin-164", {
  id: "bcast-twin-164", title: "Hi, quick one from Maggie", body: CAT_BODY,
  audienceLabel: "One person picked by name: catone164 (@catone164)",
  recipientIds: [cat1.id], senderName: "Jeff Rimmer", createdAt: "2026-11-09T14:10:00.000Z", folderId: null,
});
// Threads that end on the peer's word: a normal creator (flags),
// a business (flags), Jeff's own account (must NOT flag), the
// tester account (must NOT flag).
await seedMessage({ fromId: cat2.id, toId: PEER, body: "One more question — do comped visits include a plus one?", createdAt: "2026-11-09T15:31:00.000Z" });
await seedMessage({ fromId: PEER, toId: bizId, body: "Welcome aboard — your founding spot is held.", createdAt: "2026-11-09T15:50:00.000Z" });
await seedMessage({ fromId: bizId, toId: PEER, body: "Thanks! When do we go live?", createdAt: "2026-11-09T16:00:00.000Z" });
await seedMessage({ fromId: PEER, toId: ownId, body: "Quick news, the good kind: SIGNL is now Magpie.", createdAt: "2026-11-07T19:51:00.000Z" });
await seedMessage({ fromId: ownId, toId: PEER, body: "awesome - thats exciting", createdAt: "2026-11-07T19:55:00.000Z" });
await seedMessage({ fromId: testerId, toId: PEER, body: "Tester note: preview looks right on my side.", createdAt: "2026-11-09T16:05:00.000Z" });

// The -163 artifact: the category entry as the OLD backfill
// stored it — stamped with the broadcast's 09:10, a wrong
// message count, the one-off sender spelling, path jargon in
// the source, and no repair stamp.
await store.set("pmcampaign:backfill-2026-11-09-categories", {
  id: "backfill-2026-11-09-categories", kind: "segment",
  title: "Category message — every creator deserves every category",
  body: CAT_BODY, createdAt: "2026-11-09T14:10:00.000Z", lastAt: "2026-11-09T14:20:00.000Z",
  sentById: null, sentByName: "Jeff's admin session", market: null,
  audienceLabel: "Approved creators listed under 1-5 categories (all markets)",
  recipientIds: [cat1.id, cat2.id, cat3.id], messageCount: 99,
  emailSent: null, emailFailed: null, templateId: null, reconstructed: true,
  source: "Rebuilt from the stored thread messages themselves (Build -163 backfill); the sends are logged in signl-campaign-run/category-message-log-2026-11-09.json and second-city-message-log-2026-11-09.json.",
});

// --- C: threads / needs-reply ---------------------------------
console.log("== C: needs-reply ==");
{
  const overview = (await admin("GET", "/api/admin/platform-messages")).data;
  const threadOf = (id) => (overview.threads || []).find((t) => t.peerId === id);
  const own = threadOf(ownId);
  check("self-thread: Jeff's own account stays listed but never flags needs-reply",
    !!own && own.staffOwned === true && own.needsReply === false, JSON.stringify(own).slice(0, 200));
  const tester = threadOf(testerId);
  check("self-thread: a tester account never flags needs-reply",
    !!tester && tester.staffOwned === true && tester.needsReply === false, JSON.stringify(tester).slice(0, 200));
  const flagged = (overview.threads || []).filter((t) => t.needsReply).map((t) => t.peerId).sort();
  check("waiting line math: only the real creator + business threads wait on a reply",
    flagged.join(",") === [bizId, cat2.id].sort().join(","), flagged.join(","));
}

// --- D: backfill repair + entry shape ---------------------------
console.log("== D: campaigns ==");
let campaigns = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
{
  const cat = campaigns.find((c) => c.id === "backfill-2026-11-09-categories");
  check("repair: the category entry's time is the earliest THREAD send (14:17Z), not the broadcast's 09:10 ET",
    !!cat && cat.createdAt === "2026-11-09T14:17:00.000Z", cat ? cat.createdAt : "missing");
  check("repair: counts recomputed from thread messages only — 3 people, 4 messages (the broadcast twin excluded)",
    !!cat && cat.recipientCount === 3 && cat.messageCount === 4, JSON.stringify(cat).slice(0, 200));
}
{
  const stored = await store.get("pmcampaign:backfill-2026-11-09-categories");
  // Check updated at Build -165 (2026-11-09): the repair pass
  // now runs under the -165 gate and stamps repaired165 (the
  // -164 stamp is only carried through when a prior pass set
  // it; this fixture seeds the pre-repair -163 shape, which
  // carries neither). The repair itself — time + counts
  // recomputed in place — is unchanged.
  check("repair: the stored record itself was fixed + stamped, source carries no paths or build numbers",
    !!stored && stored.createdAt === "2026-11-09T14:17:00.000Z" && stored.messageCount === 4 && stored.repaired165 === true
    && !String(stored.source || "").includes("/") && !String(stored.source || "").includes("Build -"),
    JSON.stringify(stored).slice(0, 240));
  const cat = campaigns.find((c) => c.id === "backfill-2026-11-09-categories");
  check("sender: the rebuilt entry carries the admin account's name, not the one-off session spelling",
    !!cat && cat.sentByName === "Jeff Rimmer", cat ? cat.sentByName : "missing");
  check("payload: the campaigns response carries no file paths in any source field",
    campaigns.every((c) => !String(c.source || "").includes("signl-campaign-run")), "");
  const city = campaigns.find((c) => c.id === "backfill-2026-11-09-second-city");
  check("backfill: second-city entry rebuilt — 3 people, 3 messages, thread time",
    !!city && city.recipientCount === 3 && city.messageCount === 3 && city.createdAt === "2026-11-09T15:03:00.000Z", JSON.stringify(city).slice(0, 200));
  const twin = campaigns.find((c) => c.id === "bcast-twin-164");
  check("counts: the broadcast entry carries a message count too (1 person, 1 message)",
    !!twin && twin.kind === "broadcast" && twin.recipientCount === 1 && twin.messageCount === 1, JSON.stringify(twin).slice(0, 200));
  check("counts: EVERY entry in the list has people + messages numbers",
    campaigns.length >= 3 && campaigns.every((c) => typeof c.recipientCount === "number" && typeof c.messageCount === "number"), JSON.stringify(campaigns.map((c) => [c.id, c.recipientCount, c.messageCount])));
}
{
  const segBody = "Segment fixture 164: Nashville, your founding spot is held.";
  const seg = await admin("POST", "/api/admin/platform-messages", { market: "Nashville", body: segBody });
  check("segment send: both finished Nashville creators got it", seg.status === 201 && seg.data.sent === 2, `${seg.status}`);
  campaigns = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
  const entry = campaigns.find((c) => c.body === segBody);
  const labels = [...new Set(campaigns.map((c) => c.sentByName))];
  check("sender: ONE label across rebuilt, at-send-time and broadcast entries",
    labels.length === 1 && labels[0] === "Jeff Rimmer", labels.join(" | "));
  check("segment entry: people + messages both recorded", !!entry && entry.recipientCount === 2 && entry.messageCount === 2, JSON.stringify(entry).slice(0, 160));
}

// --- E: warm reads stay scan-free -------------------------------
console.log("== E: performance shape ==");
{
  let msgLists = 0;
  const origList = store.list.bind(store);
  store.list = async (prefix, ...rest) => { if (String(prefix).startsWith("message:")) msgLists += 1; return origList(prefix, ...rest); };
  const warm = await admin("GET", "/api/admin/message-campaigns");
  store.list = origList;
  check("warm read: the campaigns read never scans the message store once entries are built",
    warm.status === 200 && msgLists === 0, `message lists=${msgLists}`);
  const again = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
  check("warm read: entries are stable across reads (repair ran once, nothing duplicated)",
    again.length === campaigns.length && again.filter((c) => c.id === "backfill-2026-11-09-categories").length === 1, `${campaigns.length} -> ${again.length}`);
}

console.log(`\nverify-build164: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
