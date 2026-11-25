// verify-build257.mjs — Build -257: Tony's book rebuilt
// (Jeff's orders, 2026-11-25): Nashville off Tony, Hampton
// Roads built out from the 82-business HQ list, Richmond +
// Miami starter books, and the approved founding email
// scripts stamped into every playbook in his book.
// The fixture seeds the post-ladder production shape
// directly (Tony's seat with HR + Nashville markets and a
// live PIN hash, Jeff's HQ seat, shared Nashville leads,
// two Hampton Roads leads already in the store) with every
// earlier loader flag done, then runs maybeTonyBook257 and
// asserts the whole order landed — and that a re-run is a
// no-op. Script 3 (interested reply) is asserted ABSENT
// from the kit path: the Seller Kit is a code constant with
// no per-rep loader surface, so the loader records it as
// the one leftover instead of forcing it.
// Run: node scripts/verify-build257.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build257-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.APP_URL = "http://localhost";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const bizdev = require("../netlify/functions/lib/bizdev.js");
const root = path.join(process.cwd());

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const TONY = "u-tony-257";
const JEFF = "u-jeff-257";
const now = "2026-11-25T23:00:00.000Z";
const hrPack = JSON.parse(fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev-tony-hr-257.json"), "utf8"));
const richPack = JSON.parse(fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev-tony-richmond-257.json"), "utf8"));
const miamiPack = JSON.parse(fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev-tony-miami-257.json"), "utf8"));

function leadRec(over) {
  return {
    id: over.id, marketId: over.marketId, marketName: over.marketName, locationId: over.id + "-loc", masterId: over.id,
    assignedRepId: over.assignedRepId, source: "HQ-loaded", championName: null,
    name: over.name, shortName: null, category: over.category || "Restaurants & Dining", subType: over.subType || "",
    neighborhood: "", city: over.city, address: null, website: null, websiteNote: null,
    dmName: over.dmName || null, dmRole: null, dmRoleLabel: null, secondContact: null, usuallyHere: null,
    phone1: null, phone1Verify: false, phone1Note: null, phone2: null, phone2Verify: false, phone2Note: null,
    email: over.email || null, emailNote: null, emailEvidence: null, instagram: null, instagramNote: null,
    hqTier: "B", flags: { doNotContact: false, jeffHandles: false, chain: false },
    stage: "Not visited yet", stageHistory: [{ stage: "Not visited yet", at: now, by: "fixture" }],
    founding: { status: "Not claimed", claimedAt: null, claimedVia: null, confirmedAt: null, planInterest: null },
    attribution: { repCode: over.repCode, firstTouchAt: null, source: "HQ-loaded" },
    nextAction: { type: "Visit", date: null, what: "First visit" },
    lastTouch: null, pendingApproval: false, hqDecision: null,
    sharedBook: !!over.sharedBook, ...(over.sharedBook ? { sharedGroup: "hq" } : {}),
    playbook: over.playbook || null,
    createdAt: now, updatedAt: now,
  };
}

async function seed() {
  await store.set(`user:${TONY}`, { id: TONY, email: "tony@langstondigital.com", name: "Tony Johnson", role: "creator", creator: { handle: "tonyjohnson374" }, bizdevSeat: { active: true, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-TONY", markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }] } });
  await store.set(`user:${JEFF}`, { id: JEFF, email: "jeff@joinsignl.com", name: "Jeff Rimmer", role: "admin", bizdevSeat: { active: true, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HQ-JEFF", markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }], hqSeat: true } });
  await store.set(`email:tony@langstondigital.com`, { userId: TONY });
  await store.set(`bdevrep:${TONY}`, { userId: TONY, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-TONY", active: true, seatState: "probation", assignedAt: "2026-11-02T00:00:00.000Z", pinHash: "PINHASH-257", pinSalt: "PINSALT-257", vestedAt: null, warningMonth: null, atRisk: null, sharedBook: true, markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }] });
  await store.set(`bdevrep:${JEFF}`, { userId: JEFF, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HQ-JEFF", active: true, seatState: "active", assignedAt: "2026-11-02T00:00:00.000Z", pinHash: null, pinSalt: null, vestedAt: null, warningMonth: null, atRisk: null, hqSeat: true, sharedBook: true, markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }] });
  for (const k of ["config:bdevSeed155", "config:bdevEnrich157", "config:bdevLoadDest20261109", "config:bdevJeffSeat161", "config:bdevCleanup169", "config:bdevCleanupTony170", "config:bdevTonyNashville20261112", "config:bdevSharedBooks20261112"]) {
    await store.set(k, { done: true, at: now });
  }
  // Nashville: 3 of Tony's + 1 of Jeff's, all shared.
  for (let i = 1; i <= 3; i++) {
    await store.set(`bdevlead:nash-tony-${i}`, leadRec({ id: `nash-tony-${i}`, marketId: "nashville", marketName: "Nashville", city: "Nashville", name: `Nashville Tony Spot ${i}`, assignedRepId: TONY, repCode: "HR-TONY", sharedBook: true, email: `nash${i}@example.com` }));
  }
  await store.set("bdevlead:nash-jeff-1", leadRec({ id: "nash-jeff-1", marketId: "nashville", marketName: "Nashville", city: "Nashville", name: "Nashville Jeff Spot", assignedRepId: JEFF, repCode: "HQ-JEFF", sharedBook: true, email: "nashj@example.com" }));
  // Hampton Roads: two pack businesses already in the store.
  const p0 = hrPack.leads[0];
  const p1 = hrPack.leads[1];
  await store.set("bdevlead:hr-existing-0", leadRec({
    id: "hr-existing-0", marketId: "hampton-roads", marketName: "Hampton Roads", city: p0.city, name: p0.name,
    category: p0.category, subType: p0.subType, assignedRepId: TONY, repCode: "HR-TONY", sharedBook: true, email: p0.email,
    dmName: "Rodney Einhorn",
    playbook: { beforeYouGo: "Fixture before-you-go section.", opener: "Fixture opener.", introEmail: { subject: "OLD SUBJECT", body: "Old body." }, followupEmail: { subject: "OLD FOLLOW", body: "Old follow." } },
  }));
  await store.set("bdevlead:hr-existing-1", leadRec({
    id: "hr-existing-1", marketId: "hampton-roads", marketName: "Hampton Roads", city: p1.city, name: p1.name,
    category: p1.category, subType: p1.subType, assignedRepId: JEFF, repCode: "HQ-JEFF", sharedBook: true, email: p1.email,
  }));
}

console.log("== A: source pins ==");
{
  const bizJs = fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  check("loader + flag exist", bizJs.includes("maybeTonyBook257") && bizJs.includes('"config:bdevTonyBook257"'), "");
  check("preamble fires it un-awaited", routerJs.includes("bizdev.maybeTonyBook257()"), "");
  check("build stamp -257 in build.js + index.html", buildJs.includes("2026.11.25-257") && indexHtml.includes("2026.11.25-257"), "");
  check("packs on disk: HR 82, Richmond >= 20, Miami >= 20", hrPack.leads.length === 82 && richPack.leads.length >= 20 && miamiPack.leads.length >= 20, `hr=${hrPack.leads.length} rich=${richPack.leads.length} miami=${miamiPack.leads.length}`);
  check("every pack lead carries a published email", [...hrPack.leads, ...richPack.leads, ...miamiPack.leads].every((l) => l.email && l.email.includes("@")), "");
}

console.log("== B: the loader run ==");
await seed();
bizdev.init({ allUsers: async () => [await store.get(`user:${TONY}`), await store.get(`user:${JEFF}`)] });
const ran = await bizdev.maybeTonyBook257();
check("loader returns true", ran === true, `got ${ran}`);
const flag = await store.get("config:bdevTonyBook257");
check("flag done", !!(flag && flag.done), JSON.stringify(flag).slice(0, 200));

console.log("== C: the seat ==");
{
  const seat = await store.get(`bdevrep:${TONY}`);
  const ids = (seat.markets || []).map((m) => m.marketId);
  check("markets = hampton-roads + richmond + miami, nashville gone", JSON.stringify(ids) === JSON.stringify(["hampton-roads", "richmond", "miami"]), ids.join(","));
  check("PIN hash + salt preserved byte-for-byte", seat.pinHash === "PINHASH-257" && seat.pinSalt === "PINSALT-257", "");
  check("seat still active, shared, probation", seat.active === true && seat.sharedBook === true && seat.seatState === "probation", "");
  const user = await store.get(`user:${TONY}`);
  check("user stamp carries the new markets", (user.bizdevSeat.markets || []).some((m) => m.marketId === "miami") && !(user.bizdevSeat.markets || []).some((m) => m.marketId === "nashville"), "");
}

console.log("== D: Nashville ==");
{
  const rows = (await store.list("bdevlead:")).map((r) => r.value).filter((l) => l && l.marketId === "nashville");
  check("all 4 Nashville leads still exist (no deletion)", rows.length === 4, `got ${rows.length}`);
  check("none assigned to Tony", rows.every((l) => l.assignedRepId !== TONY), "");
  check("the 3 moved leads carry Jeff + the 257 trail", rows.filter((l) => l.migratedFrom257).length === 3 && rows.filter((l) => l.migratedFrom257).every((l) => l.assignedRepId === JEFF && l.attribution.repCode === "HQ-JEFF"), "");
  check("flag: tonyNashvilleAfter 0, jeffNashvilleAfter 4", flag.tonyNashvilleAfter === 0 && flag.jeffNashvilleAfter === 4, `tony=${flag.tonyNashvilleAfter} jeff=${flag.jeffNashvilleAfter}`);
}

console.log("== E: the books ==");
{
  const health = await bizdev.bdevHealth();
  const tonyBook = (health.books || {})["HR-TONY"] || {};
  const jeffBook = (health.books || {})["HQ-JEFF"] || {};
  check("Tony HR = 82 (the full reconciled list)", tonyBook["hampton-roads"] === 82, `got ${tonyBook["hampton-roads"]}`);
  check("Tony Richmond = pack size", tonyBook["richmond"] === richPack.leads.length, `got ${tonyBook["richmond"]} want ${richPack.leads.length}`);
  check("Tony Miami = pack size", tonyBook["miami"] === miamiPack.leads.length, `got ${tonyBook["miami"]} want ${miamiPack.leads.length}`);
  check("Tony Nashville absent from his book", !("nashville" in tonyBook), JSON.stringify(tonyBook));
  check("Jeff Nashville = 4, Jeff HR = 82 (shared door intact)", jeffBook["nashville"] === 4 && jeffBook["hampton-roads"] === 82, JSON.stringify(jeffBook));
  check("flag counts: HR added 80 / skipped 2", flag.hrAdded === 80 && flag.hrSkippedExisting === 2, `added=${flag.hrAdded} skipped=${flag.hrSkippedExisting}`);
}

console.log("== F: the scripts ==");
{
  const all = (await store.list("bdevlead:")).map((r) => r.value).filter(Boolean);
  const book = all.filter((l) => l.marketId !== "nashville");
  check("every non-Nashville lead in the store carries both scripts", book.every((l) => l.playbook && l.playbook.introEmail && l.playbook.followupEmail), `book=${book.length}`);
  check("Nashville leads were NOT stamped", all.filter((l) => l.marketId === "nashville").every((l) => !l.scripts257), "");
  const hr0 = await store.get("bdevlead:hr-existing-0");
  check("existing playbook sections preserved, emails replaced", hr0.playbook.beforeYouGo === "Fixture before-you-go section." && hr0.playbook.opener === "Fixture opener." && hr0.playbook.introEmail.subject !== "OLD SUBJECT", "");
  check("verified first name greeting (dmName Rodney Einhorn)", hr0.playbook.introEmail.body.startsWith("Hi Rodney,"), hr0.playbook.introEmail.body.slice(0, 40));
  const rendered = bizdev._test.repLeadPayload(hr0, { full: true, viewerRepCode: "HR-TONY" });
  check("rendered HR sample: subject + city + no em dash", rendered.playbook.introEmail.subject === "Hampton Roads' first local influencer platform is about to launch" && rendered.playbook.introEmail.body.includes("Hampton Roads is one of our first launch markets") && !rendered.playbook.introEmail.body.includes("—"), rendered.playbook.introEmail.subject);
  const rich = all.find((l) => l.marketId === "richmond");
  const richR = bizdev._test.repLeadPayload(rich, { full: true, viewerRepCode: "HR-TONY" });
  check("rendered Richmond sample: subject + team greeting + industry link", richR.playbook.introEmail.subject === "Richmond's first local influencer platform is about to launch" && richR.playbook.introEmail.body.startsWith(`Hi ${rich.shortName || rich.name} team,`) && /magpielocal\.com\/for-[a-z-]+/.test(richR.playbook.introEmail.body), richR.playbook.introEmail.subject);
  check("follow-up subject is Re: + intro subject, city swapped", richR.playbook.followupEmail.subject === `Re: ${richR.playbook.introEmail.subject}` && richR.playbook.followupEmail.body.includes("Founding spots in Richmond are open"), "");
  const mia = all.find((l) => l.marketId === "miami");
  const miaR = bizdev._test.repLeadPayload(mia, { full: true, viewerRepCode: "HR-TONY" });
  check("rendered Miami sample: subject + no Hampton Roads leakage", miaR.playbook.introEmail.subject === "Miami's first local influencer platform is about to launch" && !miaR.playbook.introEmail.body.includes("Hampton Roads"), miaR.playbook.introEmail.subject);
  check("loader proof samples all ok", (flag.samples || []).length === 3 && flag.samples.every((s) => s.ok), JSON.stringify(flag.samples).slice(0, 300));
  check("Script 3 recorded as the leftover, not forced", flag.script3InKit === false && /Seller Kit/.test(flag.script3Note || ""), "");
}

console.log("== G: re-run is a no-op ==");
{
  const before = (await store.list("bdevlead:")).length;
  const again = await bizdev.maybeTonyBook257();
  const after = (await store.list("bdevlead:")).length;
  check("second run returns true, lead count unchanged", again === true && before === after, `before=${before} after=${after}`);
}

console.log(`\nverify-build257: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
