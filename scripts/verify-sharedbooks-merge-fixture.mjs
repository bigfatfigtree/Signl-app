// verify-sharedbooks-merge-fixture.mjs — the merge-logic
// attack fixtures for the shared-books unification (HQ load
// 2026-11-12). Where verify-sharedbooks20261112 proves the
// standard ladder converges to one shared record set, THIS
// suite hand-builds the divergent states production can
// actually hold and drives maybeUnifySharedBooks20261112 at
// them directly:
//   A  Jeff ahead on stage/status/notes + Jeff holds a work
//      claim; Tony behind but carrying hqOrder, his own notes
//      and a visit log -> one record, Jeff's working state,
//      BOTH notes attributed, Jeff's claim, Tony's hqOrder,
//      Tony's voiced playbook, Tony's log re-pointed.
//   B  Tony ahead (the reverse direction) + a category hold
//      on Tony's copy only -> Tony's working state wins, the
//      hold unions onto the shared record.
//   C  Founding claimed on Jeff's copy vs a LATER warm touch
//      on Tony's -> the founding claim never un-happens.
//   D  Hampton Roads: Jeff's copy is the worked one, Tony's
//      is the master Jeff's copy points at -> the MASTER is
//      the keeper record, Jeff's stage/notes merge onto it.
//   E  A single (Tony-only) business -> flagged shared,
//      otherwise untouched.
//   F  Both copies carry a work claim -> the earlier wins.
//   G  Isolation: another seat's lead in Hampton Roads with
//      the SAME business identity, and Jeff's lead in another
//      market -> both byte-unchanged, never flagged.
//   H  Re-run -> no-op: every record byte-identical.
// Upstream loader flags are pre-set done so the migration's
// chain is a no-op and the fixtures stay exactly as built.
// Run: node scripts/verify-sharedbooks-merge-fixture.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-sbmerge-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const bizdev = require("../netlify/functions/lib/bizdev.js");
bizdev.init({
  allUsers: async () => (await store.list("user:")).map((r) => r.value),
  logCapture: () => null,
  marketCreators: async () => ({ count: 0, byBucket: {}, bench: [] }),
});

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const JEFF = "fx-jeff", TONY = "fx-tony", RITA = "fx-rita";
const T0 = "2026-11-01T09:00:00.000Z";

// --- cast -----------------------------------------------------
await store.set(`user:${JEFF}`, { id: JEFF, role: "admin", email: "jeff@joinsignl.com", name: "Jeff Rimmer", bizdevSeat: { active: true, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HQ-JEFF", hqSeat: true, markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }] } });
await store.set(`user:${TONY}`, { id: TONY, role: "creator", email: "tony@langstondigital.com", name: "Tony Johnson", bizdevSeat: { active: true, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-TONY", markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }] } });
await store.set(`user:${RITA}`, { id: RITA, role: "creator", email: "rita@fixtures.dev", name: "Rita Rep", bizdevSeat: { active: true, marketId: "austin", marketName: "Austin", repCode: "ATX-RITA" } });
await store.set(`bdevrep:${JEFF}`, { userId: JEFF, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HQ-JEFF", active: true, seatState: "active", hqSeat: true, assignedAt: T0, markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }] });
await store.set(`bdevrep:${TONY}`, { userId: TONY, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-TONY", active: true, seatState: "probation", assignedAt: T0, markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }] });
await store.set(`bdevrep:${RITA}`, { userId: RITA, marketId: "austin", marketName: "Austin", repCode: "ATX-RITA", active: true, seatState: "probation", assignedAt: T0 });
for (const f of ["config:bdevSeed155", "config:bdevEnrich157", "config:bdevLoadDest20261109", "config:bdevJeffSeat161", "config:bdevCleanup169", "config:bdevCleanupTony170", "config:bdevTonyNashville20261112"]) {
  await store.set(f, { done: true, at: T0 });
}

function mkLead(over) {
  const base = {
    marketName: over.marketId === "nashville" ? "Nashville" : "Hampton Roads",
    locationId: `${over.id}-loc`, source: "HQ-loaded", championName: null,
    category: "Restaurants & Dining", subType: "", neighborhood: "East Nashville", city: over.marketId === "nashville" ? "Nashville" : "Norfolk",
    address: null, website: null, dmName: null, dmRole: null, dmRoleLabel: null, secondContact: null, usuallyHere: null,
    phone1: null, phone1Verify: false, phone1Note: null, phone2: null, phone2Verify: false, phone2Note: null,
    email: null, instagram: null, hqTier: "B",
    flags: { doNotContact: false, jeffHandles: false, chain: false },
    stage: "Not visited yet", stageHistory: [{ stage: "Not visited yet", at: T0, by: "HQ-loaded" }],
    founding: { status: "Not claimed", claimedAt: null, claimedVia: null, confirmedAt: null, planInterest: null },
    nextAction: { type: "Visit", date: null, what: "First visit" }, lastTouch: null,
    pendingApproval: false, hqDecision: null, isNewForRep: false, hasStorefrontPhoto: false,
    createdAt: T0, updatedAt: T0,
  };
  const lead = { ...base, ...over };
  if (!lead.masterId) lead.masterId = lead.id;
  if (!lead.attribution) lead.attribution = { repCode: lead.assignedRepId === JEFF ? "HQ-JEFF" : "HR-TONY", firstTouchAt: null, source: "HQ-loaded" };
  return lead;
}
async function put(lead) { await store.set(`bdevlead:${lead.id}`, lead); return lead; }

// --- A: Jeff ahead, Jeff claimed; Tony has order/notes/log ---
await put(mkLead({ id: "fx-a-jeff", marketId: "nashville", assignedRepId: JEFF, name: "Divergent Dumplings",
  stage: "Talked — wants a follow-up", status: "Follow up",
  stageHistory: [{ stage: "Not visited yet", at: T0, by: "HQ-loaded" }, { stage: "Talked — wants a follow-up", at: "2026-11-10T10:00:00.000Z", by: "Visit log" }],
  statusHistory: [{ status: "Follow up", at: "2026-11-10T10:00:00.000Z", by: "Jeff Rimmer" }],
  repNotes: "Owner Maria is in Tuesdays.", hqTier: "A",
  workClaim: { byUserId: JEFF, byName: "Jeff Rimmer", byRepCode: "HQ-JEFF", at: "2026-11-10T09:00:00.000Z" },
  nextAction: { type: "Visit", date: "2026-11-14", what: "Bring the one-pager" },
  lastTouch: { at: "2026-11-10T10:00:00.000Z", type: "In person", outcome: "Very interested — set a follow-up" },
  playbook: { introEmail: { body: "Hi, I'm Jeff — I run Magpie" } },
  updatedAt: "2026-11-10T10:00:00.000Z" }));
await put(mkLead({ id: "fx-a-tony", marketId: "nashville", assignedRepId: TONY, name: "Divergent Dumplings",
  stage: "Visited — owner not in",
  stageHistory: [{ stage: "Not visited yet", at: T0, by: "HQ load (Tony Nashville)" }, { stage: "Visited — owner not in", at: "2026-11-09T10:00:00.000Z", by: "Visit log" }],
  repNotes: "Gate code is 4417.", hqOrder: 9,
  lastTouch: { at: "2026-11-09T10:00:00.000Z", type: "In person", outcome: "Owner not in" },
  playbook: { introEmail: { body: "Hi, I'm Tony — I'm with Magpie" } },
  createdAt: "2026-11-02T09:00:00.000Z", updatedAt: "2026-11-09T10:00:00.000Z" }));
await store.set("bdevlog:fx-a-log", { id: "fx-a-log", leadId: "fx-a-tony", repId: TONY, marketId: "nashville", type: "visit", visitAt: "2026-11-09T10:00:00.000Z", createdAt: "2026-11-09T10:00:00.000Z", open: false, outcome: "Owner not in" });

// --- B: Tony ahead + Tony's copy carries a category hold ------
await put(mkLead({ id: "fx-b-jeff", marketId: "nashville", assignedRepId: JEFF, name: "Reverse Tacos",
  repNotes: "Jeff scouted the block.", createdAt: T0, updatedAt: "2026-11-05T10:00:00.000Z" }));
await put(mkLead({ id: "fx-b-tony", marketId: "nashville", assignedRepId: TONY, name: "Reverse Tacos",
  stage: "Talked — needs to think", status: "Meeting set",
  stageHistory: [{ stage: "Not visited yet", at: T0, by: "HQ load (Tony Nashville)" }, { stage: "Talked — needs to think", at: "2026-11-11T10:00:00.000Z", by: "Visit log" }],
  statusHistory: [{ status: "Meeting set", at: "2026-11-11T10:00:00.000Z", by: "Tony Johnson" }],
  flags: { doNotContact: false, jeffHandles: false, chain: false, categoryHold: true },
  lastTouch: { at: "2026-11-11T10:00:00.000Z", type: "In person", outcome: "Talked — needs to think" },
  createdAt: "2026-11-02T09:00:00.000Z", updatedAt: "2026-11-11T10:00:00.000Z" }));

// --- C: founding claimed (Jeff) vs later warm touch (Tony) ----
await put(mkLead({ id: "fx-c-jeff", marketId: "nashville", assignedRepId: JEFF, name: "Founding Claim BBQ",
  stage: "Founding spot claimed",
  stageHistory: [{ stage: "Not visited yet", at: T0, by: "HQ-loaded" }, { stage: "Founding spot claimed", at: "2026-11-08T10:00:00.000Z", by: "Founding claim form" }],
  founding: { status: "Claimed", claimedAt: "2026-11-08T10:00:00.000Z", claimedVia: "Claim form (rep link)", confirmedAt: null, planInterest: 349 },
  nextAction: null, updatedAt: "2026-11-08T10:00:00.000Z" }));
await put(mkLead({ id: "fx-c-tony", marketId: "nashville", assignedRepId: TONY, name: "Founding Claim BBQ",
  stage: "Talked — wants a follow-up",
  stageHistory: [{ stage: "Not visited yet", at: T0, by: "HQ load (Tony Nashville)" }, { stage: "Talked — wants a follow-up", at: "2026-11-11T10:00:00.000Z", by: "Visit log" }],
  lastTouch: { at: "2026-11-11T10:00:00.000Z", type: "In person", outcome: "Very interested — set a follow-up" },
  createdAt: "2026-11-02T09:00:00.000Z", updatedAt: "2026-11-11T10:00:00.000Z" }));

// --- D: HR — Tony's is the master; Jeff's copy is the worked one
await put(mkLead({ id: "fx-d-tony", marketId: "hampton-roads", assignedRepId: TONY, name: "Harbor Subs",
  neighborhood: "Ocean View", city: "Norfolk", dmName: "Pat",
  repNotes: "Tony: parking round back.",
  playbook: { introEmail: { body: "Hi from Magpie {claimUrl}" }, followupEmail: { body: "Following up" } },
  updatedAt: "2026-11-03T10:00:00.000Z" }));
await put(mkLead({ id: "fx-d-jeff", marketId: "hampton-roads", assignedRepId: JEFF, name: "Harbor Subs",
  neighborhood: "Ocean View", city: "Norfolk", masterId: "fx-d-tony",
  stage: "Talked — needs to think",
  stageHistory: [{ stage: "Not visited yet", at: T0, by: "HQ — Jeff's book" }, { stage: "Talked — needs to think", at: "2026-11-10T12:00:00.000Z", by: "Visit log" }],
  repNotes: "Jeff met the son, who runs weekends.",
  playbook: { introEmail: { body: "Hi from Magpie {claimUrl}" }, followupEmail: { body: "Following up" } },
  lastTouch: { at: "2026-11-10T12:00:00.000Z", type: "In person", outcome: "Talked — needs to think" },
  createdAt: "2026-11-04T09:00:00.000Z", updatedAt: "2026-11-10T12:00:00.000Z" }));

// --- E: a Tony-only single ------------------------------------
await put(mkLead({ id: "fx-e-tony", marketId: "hampton-roads", assignedRepId: TONY, name: "Solo Sail Loft",
  neighborhood: "Ocean View", city: "Norfolk", repNotes: "Just Tony's.", updatedAt: "2026-11-03T10:00:00.000Z" }));
// Deep snapshot through the store — the local store hands back
// live references, so the fixture object itself would be
// mutated by the migration and the comparison would lie.
const soloBefore = JSON.parse(JSON.stringify(await store.get("bdevlead:fx-e-tony")));

// --- F: both copies carry a work claim -------------------------
await put(mkLead({ id: "fx-f-jeff", marketId: "nashville", assignedRepId: JEFF, name: "Claim Fork",
  workClaim: { byUserId: JEFF, byName: "Jeff Rimmer", byRepCode: "HQ-JEFF", at: "2026-11-09T09:00:00.000Z" }, updatedAt: "2026-11-09T09:00:00.000Z" }));
await put(mkLead({ id: "fx-f-tony", marketId: "nashville", assignedRepId: TONY, name: "Claim Fork",
  workClaim: { byUserId: TONY, byName: "Tony Johnson", byRepCode: "HR-TONY", at: "2026-11-11T09:00:00.000Z" },
  createdAt: "2026-11-02T09:00:00.000Z", updatedAt: "2026-11-11T09:00:00.000Z" }));

// --- G: isolation ----------------------------------------------
const ritaBefore = await put(mkLead({ id: "fx-g-rita", marketId: "hampton-roads", assignedRepId: RITA, name: "Harbor Subs",
  neighborhood: "Ocean View", city: "Norfolk", repNotes: "Rita's own record — same business name, different seat." }));
const austinBefore = await put(mkLead({ id: "fx-g-austin", marketId: "austin", assignedRepId: JEFF, name: "Austin Solo",
  marketName: "Austin", city: "Austin", neighborhood: "Downtown", repNotes: "Jeff's Austin lead — other market." }));
const ritaJson = JSON.stringify(await store.get("bdevlead:fx-g-rita"));
const austinJson = JSON.stringify(await store.get("bdevlead:fx-g-austin"));

// --- run the migration -----------------------------------------
const ran = await bizdev.maybeUnifySharedBooks20261112();
check("migration runs and reports done", ran === true, `got ${ran}`);
const flag = await store.get("config:bdevSharedBooks20261112");
check("flag done with the fixture inventory (Nashville 4+4 -> 4, HR 1+2 -> 2)", !!(flag && flag.done
  && flag.markets.nashville.jeffBefore === 4 && flag.markets.nashville.tonyBefore === 4 && flag.markets.nashville.mergedPairs === 4 && flag.markets.nashville.after === 4
  && flag.markets["hampton-roads"].jeffBefore === 1 && flag.markets["hampton-roads"].tonyBefore === 2 && flag.markets["hampton-roads"].mergedPairs === 1 && flag.markets["hampton-roads"].singlesFlagged === 1 && flag.markets["hampton-roads"].after === 2),
  JSON.stringify(flag && flag.markets));

const leads = (await store.list("bdevlead:")).map((r) => r.value);
const byName = (name, market) => leads.filter((l) => l.name === name && (!market || l.marketId === market));
const one = (name, market) => byName(name, market)[0];

// A
{
  const rows = byName("Divergent Dumplings");
  check("A: one record survives", rows.length === 1, `got ${rows.length}`);
  const m = rows[0];
  check("A: Jeff's furthest-along stage + status win", m.stage === "Talked — wants a follow-up" && m.status === "Follow up", `stage=${m.stage} status=${m.status}`);
  check("A: BOTH notes survive, attributed by author", String(m.repNotes).includes("Owner Maria is in Tuesdays.") && String(m.repNotes).includes("Gate code is 4417.") && String(m.repNotes).includes("Jeff Rimmer's notes") && String(m.repNotes).includes("Tony Johnson's notes"), String(m.repNotes).slice(0, 200));
  check("A: Jeff's work claim survives the merge", !!(m.workClaim && m.workClaim.byUserId === JEFF && m.workClaim.byRepCode === "HQ-JEFF"), JSON.stringify(m.workClaim));
  check("A: Tony's hqOrder survives", m.hqOrder === 9, `got ${m.hqOrder}`);
  check("A: the surviving playbook is Tony's voice", ((m.playbook || {}).introEmail || {}).body === "Hi, I'm Tony — I'm with Magpie", JSON.stringify(m.playbook).slice(0, 120));
  check("A: Jeff's dated next action survives", !!(m.nextAction && m.nextAction.date === "2026-11-14"), JSON.stringify(m.nextAction));
  check("A: Tony's visit log was re-pointed onto the survivor", (await store.get("bdevlog:fx-a-log")).leadId === m.id, `log->${(await store.get("bdevlog:fx-a-log")).leadId} keeper=${m.id}`);
  check("A: histories merged from both sides", (m.stageHistory || []).length === 4 && (m.stageHistory || []).some((h) => h.stage === "Visited — owner not in") && (m.stageHistory || []).some((h) => h.stage === "Talked — wants a follow-up") && (m.statusHistory || []).some((h) => h.by === "Jeff Rimmer"), `stageHist=${(m.stageHistory || []).length}`);
  check("A: tier A wins, shared flags set, merge audited", m.hqTier === "A" && m.sharedBook === true && Array.isArray(m.sharedMerges) && m.sharedMerges.length === 1, "");
}
// B
{
  const m = one("Reverse Tacos");
  check("B: one record survives", byName("Reverse Tacos").length === 1, "");
  check("B: Tony's furthest-along stage + status win (reverse direction)", !!m && m.stage === "Talked — needs to think" && m.status === "Meeting set", m && `stage=${m.stage} status=${m.status}`);
  check("B: Jeff's lone note survives whole", !!m && m.repNotes === "Jeff scouted the block.", m && String(m.repNotes));
  check("B: Tony's category hold unions onto the shared record", !!m && !!(m.flags && m.flags.categoryHold), m && JSON.stringify(m.flags));
}
// C
{
  const m = one("Founding Claim BBQ");
  check("C: one record survives", byName("Founding Claim BBQ").length === 1, "");
  check("C: the founding claim never un-happens (stage + founding from Jeff's side)", !!m && m.stage === "Founding spot claimed" && m.founding.status === "Claimed" && m.founding.planInterest === 349, m && `stage=${m.stage} founding=${JSON.stringify(m.founding)}`);
}
// D
{
  const mine = byName("Harbor Subs", "hampton-roads").filter((l) => l.assignedRepId === JEFF || l.assignedRepId === TONY);
  const m = mine[0];
  check("D: the two men's copies fold to one record (Rita's separate copy aside)", mine.length === 1, `got ${mine.length}`);
  check("D: the keeper IS Tony's master record", !!m && m.id === "fx-d-tony", m && m.id);
  check("D: Jeff's worked stage lands on Tony's master", !!m && m.stage === "Talked — needs to think", m && m.stage);
  check("D: both men's notes survive on the master", !!m && String(m.repNotes).includes("parking round back") && String(m.repNotes).includes("Jeff met the son"), m && String(m.repNotes).slice(0, 160));
}
// E
{
  const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const m = await store.get("bdevlead:fx-e-tony");
  const before = { ...soloBefore }; delete before.updatedAt;
  const after = { ...m }; delete after.updatedAt; delete after.sharedBook; delete after.sharedGroup;
  check("E: the single is flagged shared and otherwise untouched", !!m && m.sharedBook === true && JSON.stringify(canon(after)) === JSON.stringify(canon(before)), "");
}
// F
{
  const m = one("Claim Fork");
  check("F: one record survives", byName("Claim Fork").length === 1, "");
  check("F: when both copies were claimed, the EARLIER claim wins", !!m && m.workClaim && m.workClaim.byUserId === JEFF && m.workClaim.at === "2026-11-09T09:00:00.000Z", m && JSON.stringify(m.workClaim));
}
// G
{
  check("G: Rita's same-identity HR lead is byte-unchanged and unshared", JSON.stringify(await store.get("bdevlead:fx-g-rita")) === ritaJson && !(await store.get("bdevlead:fx-g-rita")).sharedBook, "");
  check("G: Jeff's Austin lead is byte-unchanged and unshared", JSON.stringify(await store.get("bdevlead:fx-g-austin")) === austinJson && !(await store.get("bdevlead:fx-g-austin")).sharedBook, "");
  const jeffSeat = await store.get(`bdevrep:${JEFF}`);
  const tonySeat = await store.get(`bdevrep:${TONY}`);
  const ritaSeat = await store.get(`bdevrep:${RITA}`);
  check("G: Jeff + Tony seats joined the shared book; Rita's did not", jeffSeat.sharedBook === true && tonySeat.sharedBook === true && !ritaSeat.sharedBook, "");
  const shared = one("Divergent Dumplings");
  check("G: leadInSeatBook opens for both men on a shared record, and for nobody else", bizdev._test.leadInSeatBook(shared, jeffSeat) === true && bizdev._test.leadInSeatBook(shared, tonySeat) === true && bizdev._test.leadInSeatBook(shared, ritaSeat) === false, "");
  check("G: Rita's lead is in NOBODY else's book", bizdev._test.leadInSeatBook(await store.get("bdevlead:fx-g-rita"), tonySeat) === false && bizdev._test.leadInSeatBook(await store.get("bdevlead:fx-g-rita"), jeffSeat) === false, "");
}
// H
{
  const snapBefore = JSON.stringify((await store.list("bdevlead:")).map((r) => [r.key, r.value]).sort());
  const again = await bizdev.maybeUnifySharedBooks20261112();
  const snapAfter = JSON.stringify((await store.list("bdevlead:")).map((r) => [r.key, r.value]).sort());
  check("H: re-run is a byte-identical no-op", again === true && snapAfter === snapBefore, "");
}

console.log(`\nverify-sharedbooks-merge-fixture: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
