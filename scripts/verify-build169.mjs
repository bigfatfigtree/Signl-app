// verify-build169.mjs — Build -169: the two live misses from
// the 14:44 verification in Jeff's real admin.
//   MISS 1 — Jeff's own thread STILL badges "Needs reply"
//     after -164 (predicate) and -165 (marker). The -165 rule
//     keys on the primary admin's exact name and marks NOBODY
//     when two creator records carry it. Production carries
//     that shape: Jeff has multiple records (the joinsignl
//     admin; a personal account holding a seller seat), so a
//     second "Jeff Rimmer" creator record trips the fail-safe
//     forever. Fix: maybeMarkStaff169 ranks same-name
//     candidates on stable evidence — email match, then owning
//     a platform thread the team wrote in (the self-test
//     thread), then owning any thread, then earliest created;
//     an exact tie on every key still marks neither. Every run
//     writes a diagnostic (config:staffDiag169) surfaced as
//     the `staff` block on GET /api/verify/counts. Fixtures
//     encode the failure cases FIRST: duplicate same-name
//     records (one with a thread, one without), a name-variant
//     profile, a single candidate, and a true tie.
//   MISS 2 — Biz Dev book hygiene. Live: THREE active seats
//     (HR-TONY correct; HQ-JEFF Jeff's real seat; HR-JEFF a
//     legacy extra on his personal account) and Jeff's HQ
//     Hampton Roads book holds duplicate copies of the same
//     businesses (126 records; Busch Gardens TWICE) because
//     the -161 copies step keyed idempotency on masterId
//     alone and every copy chain spawned its own copy. Fix:
//     (a) the -161 copies step also skips a source whose
//     business identity (name + city) is already in Jeff's
//     book; (b) maybeCleanup169 migrates the HR-JEFF book
//     into HQ-JEFF, retires the seat (record preserved), and
//     dedupes within Jeff's books by business identity,
//     merging playbooks/notes/claims onto the keeper. Tony's
//     book must remain byte-identical.
// Run: node scripts/verify-build169.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build169-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com"; // Jeff's real login (confirmed 2026-11-09)
process.env.ADMIN_PASSWORD = "fixture-admin-169";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_VERIFY_TOKEN = "fixture-verify-token-169";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const bizdev = require("../netlify/functions/lib/bizdev.js");
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
  return async function api(method, p, body, opts) {
    const headers = { "Content-Type": "application/json", ...((opts && opts.headers) || {}) };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: (opts && opts.rawPath) || url.pathname,
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

const admin = makeClient();
const anon = makeClient();
const VT = { headers: { "x-signl-verify-token": "fixture-verify-token-169" } };
const PEER = "signl-team";
const threadIdFor = (id) => [String(id), PEER].sort().join("__");
async function seedMessage(id, fromId, toId, body, createdAt) {
  await store.set(`message:${id}`, { id, threadId: threadIdFor(fromId === PEER ? toId : fromId), fromId, toId, body, platform: true, createdAt });
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const bizJs = fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev.js"), "utf8");
  check("server: the -169 staff loader + diagnostic exist and ride verify/counts",
    routerJs.includes("maybeMarkStaff169") && routerJs.includes('"config:staffDiag169"') && routerJs.includes("staff: staff169"), "");
  check("server: the ranking keys on thread evidence (the self-test thread)",
    routerJs.includes("hasOutbound") && routerJs.includes("self-test thread"), "");
  check("server: the cleanup loader + flag exist", bizJs.includes("maybeCleanup169") && bizJs.includes('"config:bdevCleanup169"'), "");
  check("server: the -161 copies step has the business-identity guard",
    bizJs.includes("mineIdentity") && bizJs.includes("identityOf169"), "");
  check("server: health carries per-seat books + Jeff's BGW count",
    bizJs.includes("bgwInJeffBook") && bizJs.includes("books"), "");
}

// --- B: Miss 1 — duplicate same-name records (prod shape) -----
console.log("== B: Miss 1 — the duplicate-name shape ==");
let JEFF_ID = null;
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin (jeff@joinsignl.com) login succeeds", r.status === 200, `got ${r.status}`);
  JEFF_ID = r.data && r.data.user && r.data.user.id;
}
// A second admin record (the magpielocal bootstrap twin shape).
await store.set("user:169-twin-admin", { id: "169-twin-admin", role: "admin", email: "jeff@magpielocal.com", name: "Jeff Rimmer", status: "approved", createdAt: "2026-10-01T00:00:00.000Z" });
await store.set("email:jeff@magpielocal.com", { userId: "169-twin-admin" });

// C1: Jeff's real creator profile — exact name, a personal
// email that matches NO admin, and the self-test thread (the
// team wrote in; his word is last, Nov 7, verbatim from prod).
const C1 = "169-jeff-creator";
await store.set(`user:${C1}`, {
  id: C1, role: "creator", name: "Jeff Rimmer", email: "jeffrimmer.personal@gmail.com", market: "Hampton Roads",
  status: "approved", creator: { handle: "brojaysimpson" }, createdAt: "2026-10-18T00:00:00.000Z",
});
await seedMessage("169-m1", PEER, C1, "Quick news, the good kind: SIGNL is now Magpie.", "2026-11-07T19:51:00.000Z");
await seedMessage("169-m2", C1, PEER, "awesome - thats exciting", "2026-11-07T19:55:00.000Z");
// C2: the second "Jeff Rimmer" — the personal account that
// holds the legacy seller seat. Same exact name, NO thread.
const C2 = "169-jeff-personal";
await store.set(`user:${C2}`, {
  id: C2, role: "creator", name: "Jeff Rimmer", email: "will@fixtures.dev", market: "Hampton Roads",
  status: "approved", creator: { handle: "jeffpersonal" }, createdAt: "2026-11-05T00:00:00.000Z",
});
// Wendy: a genuine creator whose reply must keep flagging.
const WENDY = "169-wendy";
await store.set(`user:${WENDY}`, {
  id: WENDY, role: "creator", name: "Wendy Waiting", email: "wendy@fixtures.dev", market: "Nashville",
  status: "approved", creator: { handle: "wendy169" }, createdAt: "2026-10-20T00:00:00.000Z",
});
await seedMessage("169-m3", PEER, WENDY, "Hi Wendy, one more from Maggie.", "2026-11-09T15:40:00.000Z");
await seedMessage("169-m4", WENDY, PEER, "Thanks! Do comped visits include a plus one?", "2026-11-09T16:10:00.000Z");

{
  const overview = (await admin("GET", "/api/admin/platform-messages")).data;
  const threadOf = (id) => (overview.threads || []).find((t) => t.peerId === id);
  const own = threadOf(C1);
  check("self-thread: listed, staff-owned, badgeless (needsReply false)",
    !!own && own.staffOwned === true && own.needsReply === false, JSON.stringify(own).slice(0, 240));
  const flagged = (overview.threads || []).filter((t) => t.needsReply).map((t) => t.peerId);
  check("waiting line math: exactly ONE conversation waits (the genuine creator)",
    flagged.length === 1 && flagged[0] === WENDY, flagged.join(","));
  const c1 = await store.get(`user:${C1}`);
  check("the thread-owning record is the one marked — by -169, not -165",
    !!c1 && c1.isStaff === true && !!c1.staffMarked169 && !c1.staffMarked165, JSON.stringify(c1 && { m165: c1.staffMarked165, m169: c1.staffMarked169 }).slice(0, 240));
  const stamp165 = await store.get("config:staffMarks165");
  check("evidence: the -165 pass ran first and marked NOBODY (its fail-safe tripped on the duplicate)",
    !!stamp165 && stamp165.done === true && stamp165.marked === 0, JSON.stringify(stamp165));
  const c2 = await store.get(`user:${C2}`);
  check("the threadless duplicate is NOT marked", !!c2 && c2.isStaff !== true, "");
  const vc = await anon("GET", "/api/verify/counts", null, VT);
  const staff = vc.data && vc.data.staff;
  check("verify/counts carries the staff diagnostic", vc.status === 200 && !!staff, `got ${vc.status}`);
  check("diagnostic: two candidates found, C1 marked for the self-test thread, C2 outranked",
    !!staff && staff.markedId === C1 && staff.ambiguous === false
    && (staff.candidates || []).length === 2
    && (staff.candidates.find((c) => c.id === C1) || {}).decision === "marked"
    && /self-test thread/.test((staff.candidates.find((c) => c.id === C1) || {}).why || "")
    && /outranked/.test((staff.candidates.find((c) => c.id === C2) || {}).why || ""),
    JSON.stringify(staff).slice(0, 400));
  check("diagnostic: shape only — email DOMAIN recorded, never the address",
    !!staff && (staff.candidates.find((c) => c.id === C1) || {}).emailDomain === "gmail.com"
    && !JSON.stringify(staff).includes("jeffrimmer.personal"), JSON.stringify(staff).slice(0, 300));
}

// --- C: Miss 1 — child fixtures (tie / single / variant) ------
console.log("== C: Miss 1 — child fixtures ==");
{
  const run = (file, tag) => {
    const out = execFileSync(process.execPath, [path.join(root, "scripts", file)], { encoding: "utf8", env: { ...process.env } });
    const line = out.trim().split("\n").filter((l) => l.startsWith(tag + " ")).pop();
    return line ? JSON.parse(line.slice(tag.length + 1)) : null;
  };
  const amb = run("fixture169-ambiguous.mjs", "AMB169");
  check("tie guard: two identical candidates (same evidence, same createdAt) — NEITHER is marked",
    !!amb && amb.r1.isStaff !== true && amb.r2.isStaff !== true && amb.r1.needsReply === true && amb.r2.needsReply === true,
    JSON.stringify(amb));
  check("tie guard: the diagnostic SAYS ambiguous and names no winner",
    !!amb && !!amb.diag && amb.diag.ambiguous === true && amb.diag.markedId === null && amb.diag.candidates === 2
    && amb.diag.whys.every((w) => /indistinguishable/.test(w || "")), JSON.stringify(amb && amb.diag));
  const single = run("fixture169-single.mjs", "SINGLE169");
  check("single candidate: a lone same-name profile is marked even with NO thread",
    !!single && single.isStaff === true && single.marked169 === true && single.hasThread === false && /only creator profile/.test(single.why || ""),
    JSON.stringify(single));
  const variant = run("fixture169-variant.mjs", "VARIANT169");
  check("name variant: 'jeff  rimmer' (case + doubled spaces) is found, marked, badgeless",
    !!variant && variant.isStaff === true && variant.marked169 === true && variant.listed === true && variant.needsReply === false,
    JSON.stringify(variant));
}

// --- D: Miss 2 — the three-seat mess, seeded as stored records -
console.log("== D: Miss 2 — seat + book hygiene ==");
const TONY = "169-tony";
const WILL = C2; // the personal account holds the legacy seat, as in prod
await store.set(`user:${TONY}`, {
  id: TONY, role: "creator", name: "Tony Johnson", email: "tony@langstondigital.com", market: "Hampton Roads",
  status: "approved", tester: true, creator: { handle: "tonyjohnson374" }, createdAt: "2026-10-15T00:00:00.000Z",
  bizdevSeat: { active: true, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-TONY" },
});
await store.set("email:tony@langstondigital.com", { userId: TONY });
{
  const will = await store.get(`user:${WILL}`);
  will.bizdevSeat = { active: true, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-JEFF" };
  await store.set(`user:${WILL}`, will);
}
const seatRec = (userId, repCode, seatState, extra) => ({
  userId, marketId: "hampton-roads", marketName: "Hampton Roads", repCode,
  active: true, seatState, assignedAt: "2026-11-08T00:00:00.000Z", pinHash: null, pinSalt: null,
  vestedAt: null, warningMonth: null, atRisk: null, ...(extra || {}),
});
await store.set(`bdevrep:${TONY}`, seatRec(TONY, "HR-TONY", "probation"));
await store.set(`bdevrep:${JEFF_ID}`, {
  ...seatRec(JEFF_ID, "HQ-JEFF", "active", { hqSeat: true }),
  markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }],
});
await store.set(`bdevrep:${WILL}`, seatRec(WILL, "HR-JEFF", "probation"));

function leadRec(id, assignedRepId, marketId, name, city, extra) {
  return {
    id, marketId, marketName: marketId === "nashville" ? "Nashville" : "Hampton Roads", locationId: `loc-${id}`,
    assignedRepId, source: "HQ-loaded", championName: null, masterId: id,
    name, shortName: null, category: "Food", subType: "", neighborhood: "", city,
    address: null, website: null, dmName: null, dmRole: null, dmRoleLabel: null, secondContact: null, usuallyHere: null,
    phone1: null, phone1Verify: false, phone1Note: null, phone2: null, phone2Verify: false, phone2Note: null,
    email: null, instagram: null, hqTier: "B",
    flags: { doNotContact: false, jeffHandles: false, chain: false },
    stage: "Not visited yet", stageHistory: [{ stage: "Not visited yet", at: "2026-11-08T00:00:00.000Z", by: "HQ seed" }],
    founding: { status: "Not claimed", claimedAt: null, claimedVia: null, confirmedAt: null, planInterest: null },
    attribution: { repCode: "HQ-loaded", firstTouchAt: null, source: "HQ-loaded" },
    nextAction: { type: "Visit", date: null, what: "First visit" }, lastTouch: null,
    pendingApproval: false, hqDecision: null, playbook: null, hqResearch: null,
    createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z",
    ...(extra || {}),
  };
}
const PB = (body) => ({ introEmail: { subject: "Intro", body }, followupEmail: { subject: "Follow-up", body } });
// Tony's book — the correct one. Three leads, all originals.
await store.set("bdevlead:bgw-williamsburg-dest", leadRec("bgw-williamsburg-dest", TONY, "hampton-roads", "Busch Gardens Williamsburg", "Williamsburg", { playbook: PB("Tony's own BGW playbook"), email: "bgwpr@buschgardens.com", deskLead: true }));
await store.set("bdevlead:t-terra", leadRec("t-terra", TONY, "hampton-roads", "Terrapin Restaurant", "Virginia Beach", { playbook: PB("Terrapin playbook") }));
await store.set("bdevlead:t-sushi", leadRec("t-sushi", TONY, "hampton-roads", "Sushi Place", "Norfolk", {}));
// The legacy HR-JEFF book — copies of Tony's two, plus one
// business only this book holds.
await store.set("bdevlead:w-bgw", leadRec("w-bgw", WILL, "hampton-roads", "Busch Gardens Williamsburg", "Williamsburg", { masterId: "bgw-williamsburg-dest" }));
await store.set("bdevlead:w-terra", leadRec("w-terra", WILL, "hampton-roads", "Terrapin Restaurant", "Virginia Beach", { masterId: "t-terra" }));
await store.set("bdevlead:w-diner", leadRec("w-diner", WILL, "hampton-roads", "Legacy Only Diner", "Norfolk", { playbook: PB("Diner playbook"), dmName: "Dee Owner" }));
// Jeff's HQ book — BGW TWICE (two copy chains), the rest once.
await store.set("bdevlead:j-bgw-a", leadRec("j-bgw-a", JEFF_ID, "hampton-roads", "Busch Gardens Williamsburg", "Williamsburg", { masterId: "bgw-williamsburg-dest", createdAt: "2026-11-08T01:00:00.000Z" }));
await store.set("bdevlead:j-bgw-b", leadRec("j-bgw-b", JEFF_ID, "hampton-roads", "Busch Gardens Williamsburg", "Williamsburg", { masterId: "w-bgw", createdAt: "2026-11-08T02:00:00.000Z", playbook: { introEmail: { subject: "Intro", body: "RICH BGW playbook" }, followupEmail: { subject: "Follow-up", body: "RICH BGW playbook" }, visitScript: { opener: "Ask for the group-sales desk." }, dmOpener: { body: "Saw the new coaster launch." }, notes: "Desk lead verified twice." } }));
await store.set("bdevlead:j-terra", leadRec("j-terra", JEFF_ID, "hampton-roads", "Terrapin Restaurant", "Virginia Beach", { masterId: "t-terra", playbook: PB("Terrapin playbook") }));
await store.set("bdevlead:j-sushi", leadRec("j-sushi", JEFF_ID, "hampton-roads", "Sushi Place", "Norfolk", { masterId: "t-sushi" }));
// Jeff's Nashville book — one duplicate pair of Jeff's own.
await store.set("bdevlead:j-nash-a", leadRec("j-nash-a", JEFF_ID, "nashville", "Fixture Dupe Diner", "Nashville", { createdAt: "2026-11-08T01:00:00.000Z" }));
await store.set("bdevlead:j-nash-b", leadRec("j-nash-b", JEFF_ID, "nashville", "Fixture Dupe Diner", "Nashville", { playbook: PB("Nashville dupe playbook"), createdAt: "2026-11-08T02:00:00.000Z" }));
// Keep the pack loaders out of this section: their work is
// already reflected in the seeded records above.
await store.set("config:bdevSeed155", { done: true, at: "2026-11-09T00:00:00.000Z", leadsCreated: 32 });
await store.set("config:bdevEnrich157", { done: true, at: "2026-11-09T00:00:00.000Z" });
await store.set("config:bdevLoadDest20261109", { done: true, at: "2026-11-09T00:00:00.000Z", leadsCreated: 1 });

// The BEFORE state, read straight from the store (no API
// call has touched the seeded records yet, so no preamble
// loader has run on them).
{
  const pre = (await store.list("bdevlead:")).map((r) => r.value);
  const preJeffHr = pre.filter((l) => l.assignedRepId === JEFF_ID && l.marketId === "hampton-roads");
  check("before: the mess is real — Jeff's HR book holds BGW twice, three seats are active",
    preJeffHr.filter((l) => l.name === "Busch Gardens Williamsburg").length === 2
    && (await store.list("bdevrep:")).map((r) => r.value).filter((s) => s && s.active).length === 3,
    `jeffHr=${preJeffHr.length} bgw=${preJeffHr.filter((l) => l.name === "Busch Gardens Williamsburg").length}`);
}

// Settle: ordinary traffic runs the preamble loaders (the
// -161 copies step adds Jeff's copy of the Legacy Only Diner;
// the Nashville pack loads its 57 targets into Jeff's book).
await anon("GET", "/api/bootstrap");
await anon("GET", "/api/bootstrap");

const snapTonyLeads = {};
for (const id of ["bgw-williamsburg-dest", "t-terra", "t-sushi"]) snapTonyLeads[id] = JSON.stringify(await store.get(`bdevlead:${id}`));
const snapTonySeat = JSON.stringify(await store.get(`bdevrep:${TONY}`));

// Fire the cleanup the way production will (direct call; the
// preamble entry is the same function).
await bizdev.maybeCleanup169();

{
  const willSeat = await store.get(`bdevrep:${WILL}`);
  check("HR-JEFF seat retired: record preserved, active=false, retirement noted",
    !!willSeat && willSeat.active === false && !!willSeat.retiredBy169, JSON.stringify(willSeat).slice(0, 200));
  const willUser = await store.get(`user:${WILL}`);
  check("the legacy account's seat stamp is cleared", !!willUser && !!willUser.bizdevSeat && willUser.bizdevSeat.active === false, JSON.stringify(willUser && willUser.bizdevSeat));
  const leads = (await store.list("bdevlead:")).map((r) => r.value);
  check("no lead remains in the legacy book", leads.filter((l) => l.assignedRepId === WILL).length === 0, "");
  const jeffHr = leads.filter((l) => l.assignedRepId === JEFF_ID && l.marketId === "hampton-roads");
  check("Jeff's HR book = the deduped union (4 businesses)", jeffHr.length === 4, `got ${jeffHr.length}: ${jeffHr.map((l) => l.name).join(" | ")}`);
  const bgws = jeffHr.filter((l) => l.name === "Busch Gardens Williamsburg");
  check("Busch Gardens appears EXACTLY ONCE in Jeff's book", bgws.length === 1, `got ${bgws.length}`);
  check("the surviving BGW record carries the RICH playbook (merged, not lost)",
    bgws.length === 1 && !!bgws[0].playbook && bgws[0].playbook.introEmail.body === "RICH BGW playbook",
    bgws.length ? JSON.stringify(bgws[0].playbook).slice(0, 120) : "none");
  check("the merge is recorded on the keeper (both losers named)",
    bgws.length === 1 && (bgws[0].mergedFrom169 || []).length === 2, JSON.stringify(bgws.length && bgws[0].mergedFrom169));
  const diner = jeffHr.find((l) => l.name === "Legacy Only Diner");
  check("the legacy-only business survived the migration (one record, its playbook intact)",
    !!diner && !!diner.playbook && diner.playbook.introEmail.body === "Diner playbook", diner ? "present" : "MISSING");
  const jeffNash = leads.filter((l) => l.assignedRepId === JEFF_ID && l.marketId === "nashville");
  const dupe = jeffNash.filter((l) => l.name === "Fixture Dupe Diner");
  check("Jeff's Nashville book deduped too (57 pack + 1 surviving dupe = 58; the dupe keeps its playbook)",
    jeffNash.length === 58 && dupe.length === 1 && !!dupe[0].playbook, `nash=${jeffNash.length} dupe=${dupe.length}`);
  let tonySame = true;
  for (const id of Object.keys(snapTonyLeads)) { if (JSON.stringify(await store.get(`bdevlead:${id}`)) !== snapTonyLeads[id]) tonySame = false; }
  check("Tony's book is byte-identical (his leads untouched)", tonySame, "");
  check("Tony's seat record is byte-identical", JSON.stringify(await store.get(`bdevrep:${TONY}`)) === snapTonySeat, "");
  const flag = await store.get("config:bdevCleanup169");
  check("cleanup flag records the counts (migrated 3, dupes removed 5, Jeff HR after 4, BGW 1)",
    !!flag && flag.done === true && flag.migrated === 3 && flag.dupesRemoved === 5 && flag.jeffHrAfter === 4 && flag.bgwInJeffBook === 1,
    JSON.stringify(flag));
  const ov = await admin("GET", "/api/admin/bdev/overview");
  check("overview Reps now lists exactly two seats (HQ-JEFF + HR-TONY)",
    ov.status === 200 && (ov.data.reps || []).length === 2 && ov.data.reps.map((s) => s.repCode).sort().join(",") === "HQ-JEFF,HR-TONY",
    JSON.stringify(ov.data.reps || []).slice(0, 200));
  check("overview loader status shows cleanup169 done",
    !!(ov.data.loaderStatus && ov.data.loaderStatus.cleanup169 && ov.data.loaderStatus.cleanup169.state === "done"),
    JSON.stringify(ov.data.loaderStatus || {}).slice(0, 300));
  const vc = await anon("GET", "/api/verify/counts", null, VT);
  check("verify/counts health: 2 seats, Jeff's HR book 4, BGW in Jeff's book 1",
    !!vc.data.bdev && vc.data.bdev.seats === 2 && vc.data.bdev.seatCodes.join(",") === "HQ-JEFF,HR-TONY"
    && vc.data.bdev.books["HQ-JEFF"]["hampton-roads"] === 4 && vc.data.bdev.books["HR-TONY"]["hampton-roads"] === 3
    && vc.data.bdev.bgwInJeffBook === 1, JSON.stringify(vc.data.bdev).slice(0, 300));
  // No resurrection: more traffic re-runs the -161 copies
  // step; the identity guard + migration must hold the line.
  await anon("GET", "/api/bootstrap");
  await anon("GET", "/api/bootstrap");
  const after = (await store.list("bdevlead:")).map((r) => r.value);
  const afterHr = after.filter((l) => l.assignedRepId === JEFF_ID && l.marketId === "hampton-roads");
  check("no resurrection after more traffic (HR book still 4, BGW still 1)",
    afterHr.length === 4 && afterHr.filter((l) => l.name === "Busch Gardens Williamsburg").length === 1,
    `hr=${afterHr.length}`);
}

// --- E: fresh-process idempotency ------------------------------
console.log("== E: loaders re-run in a fresh process — nothing moves ==");
{
  const child = path.join(os.tmpdir(), `signl-verify-build169-child-${Date.now()}.mjs`);
  fs.writeFileSync(child, `
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const store = require(${JSON.stringify(path.join(root, "netlify/functions/lib/store.js"))});
const bizdev = require(${JSON.stringify(path.join(root, "netlify/functions/lib/bizdev.js"))});
bizdev.init({ allUsers: async () => (await store.list("user:")).map((r) => r.value), logCapture: () => null, marketCreators: async () => ({ count: 0, byBucket: {}, bench: [] }) });
await bizdev.maybeSeedBizdev();
await bizdev.maybeEnrich157();
await bizdev.maybeLoadDest20261109();
await bizdev.maybeLoadJeffSeat161();
await bizdev.maybeCleanup169();
await bizdev.maybeLoadJeffSeat161();
await bizdev.maybeCleanup169();
const seats = (await store.list("bdevrep:")).map((r) => r.value);
const leads = (await store.list("bdevlead:")).map((r) => r.value);
const jeff = (await store.get("email:jeff@joinsignl.com")).userId;
const jeffHr = leads.filter((l) => l.assignedRepId === jeff && l.marketId === "hampton-roads");
console.log(JSON.stringify({ activeSeats: seats.filter((s) => s && s.active).map((s) => s.repCode).sort(), totalSeats: seats.length, leads: leads.length, jeffHr: jeffHr.length, bgw: jeffHr.filter((l) => l.name === "Busch Gardens Williamsburg").length }));
`);
  const out = execFileSync(process.execPath, [child], { env: { ...process.env }, encoding: "utf8" });
  const snap = JSON.parse(out.trim().split("\n").pop());
  const totalNow = (await store.list("bdevlead:")).length;
  check("re-run: still 2 active seats (3 records — the retired one preserved), lead total unchanged",
    snap.activeSeats.join(",") === "HQ-JEFF,HR-TONY" && snap.totalSeats === 3 && snap.leads === totalNow,
    JSON.stringify(snap) + ` totalNow=${totalNow}`);
  check("re-run: Jeff's HR book still 4 with BGW exactly once", snap.jeffHr === 4 && snap.bgw === 1, JSON.stringify(snap));
  fs.unlinkSync(child);
}

console.log(`\nverify-build169: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
