// verify-build165.mjs — Build -165: the two live misses from
// -164, diagnosed from production's actual data shapes.
//   MISS A — Jeff's own creator thread still flagged
//     needs-reply in prod. Diagnosis (from code): the admin
//     record is the ensureAdmin account (ADMIN_EMAIL, name
//     "Jeff Rimmer", NO creator profile); Jeff's creator
//     account is a separate ordinary signup — role "creator",
//     no tester flag, a DIFFERENT email, a different id — and
//     the user schema has no shared auth identity, so -164's
//     live predicate (id / email / tester) can never match
//     it. Fix: an explicit isStaff marker stamped once by the
//     idempotent loader maybeMarkStaff165 (email match, else
//     the ONLY creator profile carrying the primary admin's
//     exact name; ambiguity marks nobody). The fixtures below
//     use the PROD shape — a creator record with no admin
//     role and a non-matching email — not -164's same-email
//     assumption.
//   MISS B — the category entry's count moved 20 -> 19 under
//     the -164 repair. Truth, from the store arithmetic: the
//     -163 and -164 cluster predicates differ ONLY in the
//     broadcastId arm, and -163's entry was stamped 09:10 —
//     the broadcast twin's time — proving the twin sat in its
//     cluster. 19 verified thread sends (campaign log) + 1
//     broadcast twin = -163's 20. The truthful count is 19
//     thread messages; the -165 pass re-runs the recompute on
//     the already-repaired record under a new gate
//     (backfill:msgcampaigns-165, stamp repaired165) and the
//     count rule is asserted on BOTH cases distinctly:
//     broadcast twin (category fixture: never counts) vs true
//     thread duplicate (second-city fixture: counts).
// Run: node scripts/verify-build165.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build165-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@magpielocal.com"; // the prod ensureAdmin default
process.env.ADMIN_PASSWORD = "fixture-admin-165";
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
let jeffAdminId = null;
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin (Jeff) login succeeds", r.status === 200, `got ${r.status}`);
  jeffAdminId = r.data && r.data.user && r.data.user.id;
  const adminRec = await store.get(`user:${jeffAdminId}`);
  check("diagnosis fixture: the admin record is a bare ensureAdmin account (role admin, no creator profile)",
    !!adminRec && adminRec.role === "admin" && !adminRec.creator, JSON.stringify(adminRec).slice(0, 200));
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
  const id = `fixture165-${uniq()}-${uniq()}`;
  const m = { id, threadId: threadIdFor(fromId === PEER ? toId : fromId), fromId, toId, body, platform, createdAt };
  if (broadcastId) m.broadcastId = broadcastId;
  await store.set(`message:${id}`, m);
  return id;
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("server: the staff loader + isStaff predicate arm exist",
    routerJs.includes("maybeMarkStaff165") && routerJs.includes("peer.isStaff === true") && routerJs.includes('"config:staffMarks165"'), "");
  check("server: the campaign recompute re-runs under the -165 gate and stamps repaired165",
    routerJs.includes('"backfill:msgcampaigns-165"') && routerJs.includes("repaired165: true") && routerJs.includes("if (m.broadcastId) continue;"), "");
}

// --- B: fixtures in the PROD shapes ---------------------------
console.log("== B: fixtures ==");
const CAT_BODY = "Hi, quick one from Maggie. Most creators here aren't just one thing. If your page isn't only about one thing, add the rest — ten seconds in your Profile, under \"What you create in.\" Every category you add is another kind of business that can send you offers.";
const CITY_BODY = "One more from Maggie — this one's about your second city. If a real chunk of your followers lives somewhere else, you can be listed there too, not just at home. Two steps in your Profile, under \"Your audience in other markets\": add the city, then flip that city's switch on.";

// Category recipients (prod case) + second-city recipients
// (true-duplicate case) + one genuine waiting creator.
const catA = await registerCreator("Cat A", "cata165", "Nashville"); await approve(catA.id);
const catB = await registerCreator("Cat B", "catb165", "Nashville"); await approve(catB.id);
const catC = await registerCreator("Cat C", "catc165", "Austin"); await approve(catC.id);
const cityD = await registerCreator("City D", "cityd165", "Denver"); await approve(cityD.id);
const cityE = await registerCreator("City E", "citye165", "Denver"); await approve(cityE.id);
const cityF = await registerCreator("City F", "cityf165", "Denver"); await approve(cityF.id);
const waiting = await registerCreator("Wendy Waiting", "wendy165", "Nashville"); await approve(waiting.id);

// Jeff's OWN creator account, in the shape production
// actually has: a separate creator-role record, name shared
// with the admin account, an email that does NOT match the
// admin email, NO tester flag, NO admin role.
const jeffCreatorId = `fixture165-jeff-creator-${uniq()}`;
await store.set(`user:${jeffCreatorId}`, {
  id: jeffCreatorId, role: "creator", name: "Jeff Rimmer", email: `jeff-personal-${uniq()}@fixtures.dev`,
  market: "Virginia Beach", status: "approved", creator: { handle: "brojaysimpson" },
  createdAt: "2026-10-18T00:00:00.000Z",
});

// Registration fired finish-moment messages; sweep them so
// the seeded history below is the whole story.
{
  const rows = await store.list("message:");
  for (const r of rows) if (r.value && r.value.platform) await store.del(r.key);
}

// The 2026-11-09 sends, fixture scale.
// CATEGORY = the prod case: one thread copy per recipient,
// plus karsen's 09:10 BROADCAST TWIN in catA's thread.
await seedMessage({ fromId: PEER, toId: catA.id, body: CAT_BODY, createdAt: "2026-11-09T14:10:00.000Z", broadcastId: "bcast-twin-165" });
await seedMessage({ fromId: PEER, toId: catA.id, body: CAT_BODY, createdAt: "2026-11-09T14:17:00.000Z" });
await seedMessage({ fromId: PEER, toId: catB.id, body: CAT_BODY, createdAt: "2026-11-09T14:19:00.000Z" });
await seedMessage({ fromId: PEER, toId: catC.id, body: CAT_BODY, createdAt: "2026-11-09T14:23:00.000Z" });
await store.set("broadcast:bcast-twin-165", {
  id: "bcast-twin-165", title: "Hi, quick one from Maggie", body: CAT_BODY,
  audienceLabel: "One person picked by name: cata165 (@cata165)",
  recipientIds: [catA.id], senderName: "Jeff Rimmer", createdAt: "2026-11-09T14:10:00.000Z", folderId: null,
});
// SECOND-CITY = the true-duplicate case: cityD holds TWO
// thread copies of the same send.
await seedMessage({ fromId: PEER, toId: cityD.id, body: CITY_BODY, createdAt: "2026-11-09T15:03:00.000Z" });
await seedMessage({ fromId: PEER, toId: cityD.id, body: CITY_BODY, createdAt: "2026-11-09T15:04:00.000Z" });
await seedMessage({ fromId: PEER, toId: cityE.id, body: CITY_BODY, createdAt: "2026-11-09T15:05:00.000Z" });
await seedMessage({ fromId: PEER, toId: cityF.id, body: CITY_BODY, createdAt: "2026-11-09T15:06:00.000Z" });

// Jeff's own thread, verbatim shape from prod: the rebrand
// message, then HIS word last (Nov 7).
await seedMessage({ fromId: PEER, toId: jeffCreatorId, body: "Quick news, the good kind: SIGNL is now Magpie.", createdAt: "2026-11-07T19:51:00.000Z" });
await seedMessage({ fromId: jeffCreatorId, toId: PEER, body: "awesome - thats exciting", createdAt: "2026-11-07T19:55:00.000Z" });
// The genuine waiting creator: her word is last.
await seedMessage({ fromId: PEER, toId: waiting.id, body: "Hi Wendy, one more from Maggie.", createdAt: "2026-11-09T15:40:00.000Z" });
await seedMessage({ fromId: waiting.id, toId: PEER, body: "Thanks! Do comped visits include a plus one?", createdAt: "2026-11-09T16:10:00.000Z" });

// Production's stored state BEFORE -165: the -164 gate has
// already fired, and both entries sit in their
// already-repaired shape (repaired164 stamped) — with stored
// numbers that must NOT be trusted (the category entry
// carries the twin's time + twin-included count; the
// second-city count is wrong outright). The -165 pass must
// recompute both from the messages.
await store.set("backfill:msgcampaigns-164", { done: true, at: "2026-11-09T17:44:00.000Z" });
await store.set("pmcampaign:backfill-2026-11-09-categories", {
  id: "backfill-2026-11-09-categories", kind: "segment",
  title: "Category message — every creator deserves every category",
  body: CAT_BODY, createdAt: "2026-11-09T14:10:00.000Z", lastAt: "2026-11-09T14:23:00.000Z",
  sentById: null, sentByName: "Jeff Rimmer", market: null,
  audienceLabel: "Approved creators listed under 1-5 categories (all markets)",
  recipientIds: [catA.id, catB.id, catC.id], messageCount: 4,
  emailSent: null, emailFailed: null, templateId: null, reconstructed: true,
  source: "Rebuilt from the stored thread messages themselves; this send predates campaign records.",
  repaired164: true,
});
await store.set("pmcampaign:backfill-2026-11-09-second-city", {
  id: "backfill-2026-11-09-second-city", kind: "segment",
  title: "Second-city message — be listed where your followers live",
  body: CITY_BODY, createdAt: "2026-11-09T15:03:00.000Z", lastAt: "2026-11-09T15:06:00.000Z",
  sentById: null, sentByName: "Jeff Rimmer", market: null,
  audienceLabel: "Approved creators with no second city declared",
  recipientIds: [cityD.id, cityE.id, cityF.id], messageCount: 99,
  emailSent: null, emailFailed: null, templateId: null, reconstructed: true,
  source: "Rebuilt from the stored thread messages themselves; this send predates campaign records.",
  repaired164: true,
});

// --- C: Miss A — staff marking in the prod shape --------------
console.log("== C: staff-owned self-thread (prod shape) ==");
{
  const before = await store.get(`user:${jeffCreatorId}`);
  check("precondition: Jeff's creator record starts unmarked, non-matching email, no tester flag",
    !!before && before.isStaff !== true && before.tester !== true && before.role === "creator"
    && String(before.email).toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase(),
    JSON.stringify(before).slice(0, 200));
  const overview = (await admin("GET", "/api/admin/platform-messages")).data;
  const threadOf = (id) => (overview.threads || []).find((t) => t.peerId === id);
  const own = threadOf(jeffCreatorId);
  check("self-thread: Jeff's own creator thread stays listed but never flags needs-reply",
    !!own && own.staffOwned === true && own.needsReply === false, JSON.stringify(own).slice(0, 240));
  const after = await store.get(`user:${jeffCreatorId}`);
  check("loader: the record itself now carries isStaff, keyed on the unique-name evidence",
    !!after && after.isStaff === true && !!after.staffMarked165 && /only creator profile/.test(after.staffMarked165.why || ""),
    JSON.stringify(after && after.staffMarked165));
  const stamp = await store.get("config:staffMarks165");
  check("loader: done-stamp written so the marking runs exactly once",
    !!stamp && stamp.done === true && stamp.marked >= 1, JSON.stringify(stamp));
  const wendy = threadOf(waiting.id);
  check("genuine thread: a real creator's unanswered reply still flags needs-reply",
    !!wendy && wendy.needsReply === true && wendy.staffOwned === false, JSON.stringify(wendy).slice(0, 200));
  const flagged = (overview.threads || []).filter((t) => t.needsReply).map((t) => t.peerId);
  check("waiting line math: exactly ONE conversation waits (the genuine creator) — the self-thread is out",
    flagged.length === 1 && flagged[0] === waiting.id, flagged.join(","));
}

// --- D: Miss B — the recompute on already-repaired records ----
console.log("== D: campaign counts (twin vs true duplicate) ==");
{
  const campaigns = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
  const cat = campaigns.find((c) => c.id === "backfill-2026-11-09-categories");
  check("prod case (broadcast twin): category entry reads 3 people · 3 messages — the twin never counts",
    !!cat && cat.recipientCount === 3 && cat.messageCount === 3, JSON.stringify(cat).slice(0, 220));
  check("prod case: the entry's time is the earliest THREAD send (14:17Z), not the twin's 14:10Z",
    !!cat && cat.createdAt === "2026-11-09T14:17:00.000Z", cat ? cat.createdAt : "missing");
  const city = campaigns.find((c) => c.id === "backfill-2026-11-09-second-city");
  check("true-duplicate case: second-city entry reads 3 people · 4 messages — a real second thread copy counts",
    !!city && city.recipientCount === 3 && city.messageCount === 4 && city.createdAt === "2026-11-09T15:03:00.000Z",
    JSON.stringify(city).slice(0, 220));
  const twin = campaigns.find((c) => c.id === "bcast-twin-165");
  check("the twin still receipts under its own broadcast entry (1 person · 1 message)",
    !!twin && twin.kind === "broadcast" && twin.recipientCount === 1 && twin.messageCount === 1, JSON.stringify(twin).slice(0, 200));
  const storedCat = await store.get("pmcampaign:backfill-2026-11-09-categories");
  check("already-repaired record: the -165 pass re-ran on it — repaired165 stamped, repaired164 carried, numbers recomputed",
    !!storedCat && storedCat.repaired165 === true && storedCat.repaired164 === true && storedCat.messageCount === 3 && storedCat.createdAt === "2026-11-09T14:17:00.000Z",
    JSON.stringify(storedCat).slice(0, 260));
  const gate165 = await store.get("backfill:msgcampaigns-165");
  check("the -165 gate stamp is written (the -164 gate alone no longer blocks the recompute)",
    !!gate165 && gate165.done === true, JSON.stringify(gate165));
  let msgLists = 0;
  const origList = store.list.bind(store);
  store.list = async (prefix, ...rest) => { if (String(prefix).startsWith("message:")) msgLists += 1; return origList(prefix, ...rest); };
  const again = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
  store.list = origList;
  const cat2 = again.find((c) => c.id === "backfill-2026-11-09-categories");
  check("idempotent + scan-free: a warm read rescans nothing and the numbers hold",
    msgLists === 0 && !!cat2 && cat2.recipientCount === 3 && cat2.messageCount === 3 && again.length === campaigns.length,
    `message lists=${msgLists}`);
}

// --- E: the ambiguity guard (separate process/store) ----------
console.log("== E: name-rival guard ==");
{
  const rivalScript = path.join(root, "scripts/fixture165-rival.mjs");
  const out = execFileSync(process.execPath, [rivalScript], { encoding: "utf8", env: { ...process.env } });
  const line = out.trim().split("\n").filter((l) => l.startsWith("RIVAL165 ")).pop();
  const res = line ? JSON.parse(line.slice("RIVAL165 ".length)) : null;
  check("guard: when TWO creator profiles carry the admin's name, the loader marks NEITHER (never guesses)",
    !!res && res.r1.isStaff !== true && res.r2.isStaff !== true && res.r1.needsReply === true && res.r2.needsReply === true,
    JSON.stringify(res));
}

console.log(`\nverify-build165: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
