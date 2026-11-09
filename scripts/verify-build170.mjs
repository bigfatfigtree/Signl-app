// verify-build170.mjs — Build -170: app-wide performance (admin
// first), the Biz Dev Sell header fix's data half, and the Biz
// Dev CRM cleanup (find / rolodex / add lead / add order).
//   PERF — the read-path memos: store.versionFor tracks writes
//     per record prefix; repeat reads of the Biz Dev overview,
//     the rep home and the Messages list collapse from whole-
//     store scans to a handful of record fetches; the admin
//     lead payload drops hqResearch (888KB -> ~450KB at
//     production scale) while keeping the hasPlaybook flag;
//     and a write still invalidates instantly (no stale reads).
//   CRM — GET /bdev/leads finds by category + status (facets
//     ride along); the rolodex (GET /bdev/contacts) reads the
//     lead records' own contact fields (dmName / dmRoleLabel /
//     email / phone1 / phone2 / secondContact) scoped to the
//     caller's book, plus contacts the seller adds by hand
//     (bdevcontact: records, editable only by their owner);
//     POST /bdev/leads takes contact name / email / phone /
//     city / notes onto the lead record; POST /bdev/orders
//     records a seller's own orders (display only — founding
//     plan prices 199/349/699, anything else stored as no
//     plan); HQ reads every book via /admin/bdev/contacts and
//     /admin/bdev/orders. Existing leads are never touched.
// Run: node scripts/verify-build170.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build170-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = ["verify170", "admin", "pw"].join("-");
const TONY_PW = ["verify170", "tony", "pw"].join("-");
process.env.ADMIN_PASSWORD = ADMIN_PW;
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_VERIFY_TOKEN = "<MASKED_SECRET_001>";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const auth = require("../netlify/functions/lib/auth.js");

// ---- store fetch counting (records returned, the number that
// maps to Netlify Blobs round trips in production) ----
let fetchCount = 0;
for (const name of ["list", "getMany", "listKeys"]) {
  const orig = store[name];
  store[name] = async (...a) => { const out = await orig(...a); fetchCount += Array.isArray(out) ? out.length : 0; return out; };
}
const origGet = store.get;
store.get = async (...a) => { const out = await origGet(...a); fetchCount += out ? 1 : 0; return out; };

const { handler } = require("../netlify/functions/api.js");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log("  ok  " + name); }
  else { failed += 1; failures.push(name + (extra ? " :: " + extra : "")); console.log("  FAIL  " + name + (extra ? " :: " + extra : "")); }
}

function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    fetchCount = 0;
    const res = await handler({ httpMethod: method, path: url.pathname, headers, queryStringParameters: Object.fromEntries(url.searchParams.entries()), body: body === undefined ? null : JSON.stringify(body), isBase64Encoded: false });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let parsed = null;
    try { parsed = JSON.parse(res.body || "null"); } catch (e) { /* raw */ }
    return { status: res.statusCode, body: parsed, raw: res.body || "", fetches: fetchCount };
  };
}

// ---------------- fixture ----------------
const ADMIN = "v170-admin", TONY = "v170-tony";
async function user(id, role, name, email, pw) {
  const { salt, hash } = auth.hashPassword(pw);
  await store.set(`user:${id}`, { id, role, name, email, passwordSalt: salt, passwordHash: hash, status: "approved", createdAt: "2026-10-18T00:00:00.000Z" });
  await store.set(`email:${email}`, { userId: id });
}
await user(ADMIN, "admin", "Jeff Rimmer", "jeff@joinsignl.com", ADMIN_PW);
await user(TONY, "creator", "Tony Johnson", "tony@langstondigital.com", TONY_PW);
const seatRec = (userId, repCode, extra = {}) => ({ userId, repCode, region: "Hampton Roads", marketId: "hampton-roads", marketName: "Hampton Roads", markets: ["hampton-roads"], active: true, seatState: "probation", assignedAt: "2026-11-01T00:00:00.000Z", ...extra });
await store.set(`bdevrep:${TONY}`, seatRec(TONY, "HR-TONY"));
await store.set(`bdevrep:${ADMIN}`, seatRec(ADMIN, "HQ-JEFF", { hqSeat: true, markets: ["hampton-roads", "nashville"], seatState: "active" }));
// Loader gates closed so no loader mutates the fixture mid-run.
for (const k of ["bdevSeed155", "bdevEnrich157", "bdevLoadDest20261109", "bdevJeffSeat161"]) await store.set(`config:${k}`, { done: true, at: "2026-11-09T00:00:00.000Z" });

function lead(id, repId, marketId, marketName, s) {
  return {
    id, name: s.name, shortName: null, category: s.category, subType: "", neighborhood: s.neighborhood || "", city: s.city || "",
    address: null, website: null,
    dmName: s.dmName || null, dmRole: null, dmRoleLabel: s.dmRoleLabel || null, secondContact: s.secondContact || null, usuallyHere: null,
    phone1: s.phone1 || null, phone1Verify: false, phone1Note: null, phone2: null, phone2Verify: false, phone2Note: null,
    email: s.email || null, emailNote: null, emailEvidence: null, instagram: null, instagramNote: null,
    marketId, marketName, assignedRepId: repId, masterId: id, source: "seed155",
    stage: s.stage || "Not visited yet", status: s.status || undefined, stageHistory: [], statusHistory: [],
    hqTier: "B", flags: { doNotContact: false, jeffHandles: false, chain: false },
    founding: { status: "Not claimed", claimedAt: null, claimedVia: null, confirmedAt: null, planInterest: null },
    attribution: { repCode: "", firstTouchAt: null, source: "seed155" },
    nextAction: { type: "Visit", date: null, what: "First visit" }, lastTouch: null,
    pendingApproval: false, hqDecision: null, isNewForRep: false,
    playbook: s.playbook ? { opener: "Hi." } : null,
    hqResearch: s.hqResearch ? { summary: "Long research notes. ".repeat(30), sources: ["fixture"] } : null,
    createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z",
  };
}
const FIXTURE_LEADS = [
  lead("v170-l1", TONY, "hampton-roads", "Hampton Roads", { name: "Maria's Tacos", category: "Restaurants & Dining", neighborhood: "Ocean View", city: "Norfolk", dmName: "Maria Santos", dmRoleLabel: "Owner", email: "maria@mariastacos.example", phone1: "(757) 555-0119", playbook: true, hqResearch: true }),
  lead("v170-l2", TONY, "hampton-roads", "Hampton Roads", { name: "Quiet Corner Cafe", category: "Restaurants & Dining", neighborhood: "Ghent", city: "Norfolk" }),
  lead("v170-l3", TONY, "hampton-roads", "Hampton Roads", { name: "Neon Nights Bar", category: "Bars & Nightlife", neighborhood: "Downtown", city: "Norfolk", status: "Contacted", stage: "Visited — owner not in", dmName: "Dee Neon", email: "dee@neonnights.example" }),
  lead("v170-l4", ADMIN, "nashville", "Nashville", { name: "Nashville Hot Chicken Co", category: "Restaurants & Dining", neighborhood: "East Nashville", city: "Nashville", dmName: "Nashville Nate", dmRoleLabel: "Owner & chef", email: "nate@nhc.example", phone1: "(615) 555-0142" }),
  lead("v170-l5", ADMIN, "hampton-roads", "Hampton Roads", { name: "Jeff's HR Diner", category: "Restaurants & Dining", neighborhood: "Oceanfront", city: "Virginia Beach", dmName: "Dana Diner", phone1: "(757) 555-0177" }),
  lead("v170-l6", ADMIN, "nashville", "Nashville", { name: "Silent Books", category: "Retail & Boutiques", neighborhood: "12 South", city: "Nashville" }),
];
for (const l of FIXTURE_LEADS) await store.set(`bdevlead:${l.id}`, l);
// A few platform threads so the Messages list has something to scan.
for (let i = 0; i < 10; i++) {
  const peer = `v170-peer-${i}`;
  await user(peer, "creator", `Peer ${i}`, `peer${i}@example.com`, "verify170-user-pw");
  await store.set(`message:pm-${i}-a`, { id: `pm-${i}-a`, platform: true, fromId: peer, toId: "signl-team", body: "hi", createdAt: "2026-11-08T10:00:00.000Z" });
  await store.set(`message:pm-${i}-b`, { id: `pm-${i}-b`, platform: true, fromId: "signl-team", toId: peer, body: "hello back", createdAt: "2026-11-08T11:00:00.000Z" });
}
for (let i = 0; i < 150; i++) await store.set(`event:ev-${i}`, { id: `ev-${i}`, type: "profile_view", createdAt: "2026-11-09T00:00:00.000Z" });

const admin = makeClient();
const tony = makeClient();
const lr = await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: ADMIN_PW });
check("admin login 200", lr.status === 200, String(lr.status));
const tr = await tony("POST", "/api/auth/login", { email: "tony@langstondigital.com", password: TONY_PW });
check("tony login 200", tr.status === 200, String(tr.status));

// The -161 Jeff-seat loader converges Jeff's book on first
// requests (copies of Tony's HR leads + the stored Nashville
// targets — the production state). Let it land, then count
// relative to the converged book.
const conv = await admin("GET", "/api/admin/bdev/leads");
const BASE_LEADS = conv.body.leads.length;
check("seat loader converged Jeff's book (copies + Nashville targets)", BASE_LEADS > FIXTURE_LEADS.length, String(BASE_LEADS));

// ---------------- PERF ----------------
console.log("— perf —");
const vUser0 = store.versionFor(["user"]);
const vLead0 = store.versionFor(["bdevlead"]);
await store.set("user:v170-scratch", { id: "v170-scratch" });
check("versionFor moves for the written prefix", store.versionFor(["user"]) !== vUser0);
check("versionFor holds for an untouched prefix", store.versionFor(["bdevlead"]) === vLead0);

const ov1 = await admin("GET", "/api/admin/bdev/overview");
const ov2 = await admin("GET", "/api/admin/bdev/overview");
check("admin bdev overview 200 twice", ov1.status === 200 && ov2.status === 200, `${ov1.status}/${ov2.status}`);
check("overview repeat read collapses (fetches)", ov2.fetches < Math.max(6, ov1.fetches / 4), `cold ${ov1.fetches} -> warm ${ov2.fetches}`);

const al = await admin("GET", "/api/admin/bdev/leads");
check("admin bdev leads 200 with the converged book", al.status === 200 && al.body.leads && al.body.leads.length === BASE_LEADS, `${al.status}/${al.body.leads && al.body.leads.length}`);
check("admin lead payload keeps the -157 contract (hqResearch rides along)", al.raw.includes("hqResearch") && al.raw.includes("Long research notes"), "payload lost the research bodies -157 locks in");
check("admin lead payload keeps the hasPlaybook flag", al.body.leads.every((l) => typeof l.hasPlaybook === "boolean"));
check("admin lead payload keeps contact fields", (() => { const m = al.body.leads.find((l) => l.id === "v170-l1"); return m && m.dmName === "Maria Santos" && m.email === "maria@mariastacos.example" && m.phone1 === "(757) 555-0119"; })());

const home1 = await tony("GET", "/api/bdev/home");
const home2 = await tony("GET", "/api/bdev/home");
check("rep home 200 twice", home1.status === 200 && home2.status === 200, `${home1.status}/${home2.status}`);
check("rep home repeat read collapses (fetches)", home2.fetches <= 8, `cold ${home1.fetches} -> warm ${home2.fetches}`);

const pm1 = await admin("GET", "/api/admin/platform-messages");
const pm2 = await admin("GET", "/api/admin/platform-messages");
check("platform-messages 200 twice, same threads", pm1.status === 200 && pm2.status === 200 && pm1.body.threads.length === pm2.body.threads.length && pm1.body.threads.length === 10, `${pm1.status}/${pm1.body.threads && pm1.body.threads.length}`);
check("platform-messages repeat read collapses (fetches)", pm2.fetches <= 6, `cold ${pm1.fetches} -> warm ${pm2.fetches}`);

const sg1 = await admin("GET", "/api/admin/suggestions");
const sg2 = await admin("GET", "/api/admin/suggestions");
check("suggestions 200 twice", sg1.status === 200 && sg2.status === 200, `${sg1.status}/${sg2.status}`);

// ---------------- CRM: find ----------------
console.log("— crm: find —");
const allTony = await tony("GET", "/api/bdev/leads");
check("tony book = his 3 leads only", allTony.status === 200 && allTony.body.leads.length === 3 && allTony.body.leads.every((l) => ["v170-l1", "v170-l2", "v170-l3"].includes(l.id)), JSON.stringify(allTony.body.leads && allTony.body.leads.map((l) => l.id)));
check("facets carry categories + statuses", allTony.body.facets && allTony.body.facets.categories.includes("Bars & Nightlife") && JSON.stringify(allTony.body.facets.statuses) === JSON.stringify(["Not contacted", "Contacted", "Meeting set", "Follow up", "Declined", "Closed"]));
const byCat = await tony("GET", "/api/bdev/leads?category=" + encodeURIComponent("Bars & Nightlife"));
check("category filter narrows to the bar", byCat.body.leads.length === 1 && byCat.body.leads[0].id === "v170-l3");
const byStatus = await tony("GET", "/api/bdev/leads?status=Contacted");
check("status filter narrows to Contacted", byStatus.body.leads.length === 1 && byStatus.body.leads[0].id === "v170-l3");
const combined = await tony("GET", "/api/bdev/leads?category=" + encodeURIComponent("Restaurants & Dining") + "&status=Contacted");
check("combined category+status can empty the list", combined.body.leads.length === 0);
const byQ = await tony("GET", "/api/bdev/leads?q=Maria");
check("search finds by contact name too", byQ.body.leads.length === 1 && byQ.body.leads[0].id === "v170-l1");

// ---------------- CRM: rolodex ----------------
console.log("— crm: rolodex —");
const rc1 = await tony("GET", "/api/bdev/contacts");
const rcNames = (rc1.body.contacts || []).map((c) => c.name);
check("rolodex reads lead contacts (Maria + Dee)", rc1.status === 200 && rcNames.includes("Maria Santos") && rcNames.includes("Dee Neon"), rcNames.join(","));
check("rolodex is scoped to the caller's book", !rcNames.includes("Nashville Nate") && !rcNames.includes("Dana Diner"));
const maria = rc1.body.contacts.find((c) => c.name === "Maria Santos");
check("rolodex entry carries business/role/email/phone/city", !!maria && maria.business === "Maria's Tacos" && maria.role === "Owner" && maria.email === "maria@mariastacos.example" && maria.phone === "(757) 555-0119" && maria.city === "Norfolk");
const rcAdd = await tony("POST", "/api/bdev/contacts", { name: "Pat Printer", business: "Print Shop", role: "Owner", email: "pat@print.example", phone: "(757) 555-0101", city: "Norfolk", notes: "Met at the cafe." });
check("seller adds a contact (201)", rcAdd.status === 201 && rcAdd.body.contact && rcAdd.body.contact.id, String(rcAdd.status));
const newContactId = rcAdd.body.contact.id;
const rc2 = await tony("GET", "/api/bdev/contacts");
check("added contact appears in the rolodex", (rc2.body.contacts || []).some((c) => c.id === newContactId && c.notes === "Met at the cafe."));
const rcEdit = await tony("POST", `/api/bdev/contacts/${newContactId}`, { phone: "(757) 555-0199" });
check("seller edits their own contact", rcEdit.status === 200 && rcEdit.body.contact.phone === "(757) 555-0199", String(rcEdit.status));
const jeffContact = await admin("POST", "/api/bdev/contacts", { name: "Jeff Only Person", business: "HQ Biz", email: "hq@example.com" });
check("jeff (as seller) adds a contact", jeffContact.status === 201, String(jeffContact.status));
const crossEdit = await tony("POST", `/api/bdev/contacts/${jeffContact.body.contact.id}`, { phone: "x" });
check("a seller cannot edit another book's contact (404)", crossEdit.status === 404, String(crossEdit.status));
const rcAdmin = await admin("GET", "/api/admin/bdev/contacts");
check("HQ rolodex sees every book, owners named", rcAdmin.status === 200 && rcAdmin.body.contacts.some((c) => c.name === "Nashville Nate") && rcAdmin.body.contacts.some((c) => c.name === "Pat Printer" && c.ownerName === "Tony Johnson"), String(rcAdmin.status));

// ---------------- CRM: add lead ----------------
console.log("— crm: add lead —");
const addLead = await tony("POST", "/api/bdev/leads", { name: "Field Find Tacos", category: "Restaurants & Dining", city: "Virginia Beach", neighborhood: "Oceanfront", contactName: "Luisa Field", contactRole: "Owner", email: "hola@fieldfind.example", phone: "(757) 555-0123", notes: "Walked in Tuesday." });
check("add lead succeeds", addLead.status === 200 && addLead.body.lead && addLead.body.lead.id, String(addLead.status) + " " + JSON.stringify(addLead.body).slice(0, 120));
const addedLeadId = addLead.body.lead.id;
const detail = await tony("GET", `/api/bdev/leads/${addedLeadId}`);
check("added lead carries contact name/email/phone/city/notes", detail.body.lead.dmName === "Luisa Field" && detail.body.lead.email === "hola@fieldfind.example" && detail.body.lead.phone1 === "(757) 555-0123" && detail.body.lead.city === "Virginia Beach", JSON.stringify(detail.body.lead).slice(0, 200));
const storedLead = await store.get(`bdevlead:${addedLeadId}`);
check("added lead lands as Not contacted in the seller's book", storedLead && storedLead.assignedRepId === TONY && storedLead.stage === "Not visited yet" && storedLead.repNotes === "Walked in Tuesday.");
const afterAdd = await tony("GET", "/api/bdev/leads");
check("added lead shows in the seller's list at once (no stale memo)", afterAdd.body.leads.some((l) => l.id === addedLeadId));

// ---------------- CRM: orders ----------------
console.log("— crm: orders —");
const ord1 = await tony("POST", "/api/bdev/orders", { businessName: "Maria's Tacos", plan: 349, date: "2026-11-09", notes: "Said yes at the counter." });
check("seller records an order (201)", ord1.status === 201 && ord1.body.order.plan === 349, String(ord1.status));
const ord2 = await tony("POST", "/api/bdev/orders", { businessName: "Mystery Biz", plan: 299, date: "2026-11-09" });
check("a non-founding price is never stored as a plan", ord2.status === 201 && ord2.body.order.plan === null, JSON.stringify(ord2.body.order || {}));
const ordList = await tony("GET", "/api/bdev/orders");
check("orders list shows the seller's orders", ordList.body.orders.length === 2 && ordList.body.orders.some((o) => o.businessName === "Maria's Tacos"));
const ordAdmin = await admin("GET", "/api/admin/bdev/orders");
check("HQ sees seller orders, owner named", ordAdmin.status === 200 && ordAdmin.body.orders.length === 2 && ordAdmin.body.orders.every((o) => o.ownerName === "Tony Johnson"));
const ordBad = await tony("POST", "/api/bdev/orders", { businessName: "" });
check("an order needs a business name (400)", ordBad.status === 400, String(ordBad.status));

// ---------------- preservation ----------------
console.log("— preservation —");
const alEnd = await admin("GET", "/api/admin/bdev/leads");
check("converged book preserved + the one added", alEnd.body.leads.length === BASE_LEADS + 1, String(alEnd.body.leads.length));
const l1 = await store.get("bdevlead:v170-l1");
check("an original lead record is byte-stable in its contact fields", l1.dmName === "Maria Santos" && l1.email === "maria@mariastacos.example" && l1.phone1 === "(757) 555-0119" && !!l1.playbook && !!l1.hqResearch);

// ---------------- Tony book dedupe (-170 amendment) ----------------
console.log("— crm: tony dedupe —");
const bizdev = require("../netlify/functions/lib/bizdev.js");
const tonyLeadsNow = async () => (await store.list("bdevlead:")).map((r) => r.value).filter((l) => l && l.assignedRepId === TONY);
const jeffFixtureBefore = {};
for (const id of ["v170-l4", "v170-l5", "v170-l6"]) jeffFixtureBefore[id] = JSON.stringify(await store.get(`bdevlead:${id}`));
const tonyCountBefore = (await tonyLeadsNow()).length;
// Group A: the bare copy carries the status + history + a log;
// the richer copy carries the playbook + contact info.
const dupA1 = lead("v170-dup-a1", TONY, "hampton-roads", "Hampton Roads", { name: "QA Duplicate Taqueria", category: "Restaurants & Dining", neighborhood: "Ocean View", city: "Norfolk", status: "Contacted" });
dupA1.statusHistory = [{ status: "Contacted", at: "2026-11-05T10:00:00.000Z", by: TONY }];
const dupA2 = lead("v170-dup-a2", TONY, "hampton-roads", "Hampton Roads", { name: "QA Duplicate Taqueria", category: "Restaurants & Dining", neighborhood: "Ocean View", city: "Norfolk", email: "dup@taqueria.example", phone1: "(757) 555-0131", playbook: true });
// Group B: the bare copy is the one Jeff's book points at via
// masterId, so it must survive and inherit the playbook.
const dupB1 = lead("v170-dup-b1", TONY, "hampton-roads", "Hampton Roads", { name: "QA Duplicate Barbers", category: "Beauty & Grooming", neighborhood: "Oceanfront", city: "Virginia Beach", playbook: true });
const dupB2 = lead("v170-dup-b2", TONY, "hampton-roads", "Hampton Roads", { name: "QA Duplicate Barbers", category: "Beauty & Grooming", neighborhood: "Oceanfront", city: "Virginia Beach" });
const refCopy = lead("v170-ref-copy", ADMIN, "hampton-roads", "Hampton Roads", { name: "QA Duplicate Barbers — HQ copy", category: "Beauty & Grooming", city: "Virginia Beach" });
refCopy.masterId = "v170-dup-b2";
for (const l of [dupA1, dupA2, dupB1, dupB2, refCopy]) await store.set(`bdevlead:${l.id}`, l);
await store.set("bdevlog:v170-log-dup", { id: "v170-log-dup", leadId: "v170-dup-a1", repId: TONY, marketId: "hampton-roads", createdAt: "2026-11-05T10:00:00.000Z" });
await store.set("bdevclaim:v170-claim-dup", { id: "v170-claim-dup", leadId: "v170-dup-a1", repId: TONY, status: "waiting HQ confirm", createdAt: "2026-11-05T10:00:00.000Z" });
await store.del("config:bdevCleanupTony170");
await bizdev.maybeCleanupTony170();
const tonyAfterDedupe = await tonyLeadsNow();
check("tony dedupe removes exactly the 2 duplicate records", tonyAfterDedupe.length === tonyCountBefore + 2, `${tonyCountBefore} -> ${tonyAfterDedupe.length}`);
const survA = await store.get("bdevlead:v170-dup-a2");
check("group A: the richer record survives", !!survA && !(await store.get("bdevlead:v170-dup-a1")));
check("group A: the loser's status + history are preserved on the keeper", !!survA && survA.status === "Contacted" && (survA.statusHistory || []).length === 1 && survA.mergedFrom170 && survA.mergedFrom170.some((m) => m.id === "v170-dup-a1"));
check("group A: logs + claims re-pointed to the keeper", (await store.get("bdevlog:v170-log-dup")).leadId === "v170-dup-a2" && (await store.get("bdevclaim:v170-claim-dup")).leadId === "v170-dup-a2");
const survB = await store.get("bdevlead:v170-dup-b2");
check("group B: the masterId-referenced record survives and inherits the playbook", !!survB && !!survB.playbook && !(await store.get("bdevlead:v170-dup-b1")));
let jeffUntouched = true;
for (const id of ["v170-l4", "v170-l5", "v170-l6"]) if (JSON.stringify(await store.get(`bdevlead:${id}`)) !== jeffFixtureBefore[id]) jeffUntouched = false;
check("jeff's fixture leads are byte-identical after tony's dedupe", jeffUntouched);
const tonyFlag = await store.get("config:bdevCleanupTony170");
check("cleanup flag records the counts", !!tonyFlag && tonyFlag.done === true && tonyFlag.dupesRemoved === 2 && tonyFlag.tonyAfter === tonyCountBefore + 2, JSON.stringify(tonyFlag));
const ovD = await admin("GET", "/api/admin/bdev/overview");
check("loader status surface shows cleanupTony170 done", ovD.status === 200 && ovD.body.loaderStatus && ovD.body.loaderStatus.cleanupTony170 && ovD.body.loaderStatus.cleanupTony170.state === "done", String(ovD.status) + " " + JSON.stringify(ovD.body.loaderStatus || {}).slice(0, 200));
const hashTony = async () => JSON.stringify((await tonyLeadsNow()).map((l) => [l.id, l.updatedAt, (l.mergedFrom170 || []).length]).sort());
const hashBefore = await hashTony();
await bizdev.maybeCleanupTony170();
check("re-running the cleanup is a no-op", (await hashTony()) === hashBefore);

console.log(`\nverify-build170: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
