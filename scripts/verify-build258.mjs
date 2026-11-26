// verify-build258.mjs — Build -258: the -257 completion
// pass. The fixture replicates the -257 loader's PRODUCTION
// end state (2026-11-25 19:01 ET, read off its loader
// status): the seat edit landed (Nashville off, Richmond +
// Miami on, PIN intact), Nashville was door-only for Tony
// (every stored Nashville record sits with Jeff; nothing
// was assigned to Tony, nothing deleted), the Hampton
// Roads scripts were stamped — but all three data packs
// read as missing, because the -257 loader required them
// through a variable and Netlify's bundler cannot trace a
// variable require into the function bundle (the local
// fixture runs unbundled, so -257's own fixture could not
// see it). -258 loads the packs from module-level literal
// requires and finishes the book. This fixture seeds that
// partial world and asserts the completion converges it:
// Hampton Roads completes to the 82-business list (plus a
// non-pack business that was already there and must
// survive), Richmond + Miami load in full, every lead in
// Tony's book carries both scripts, Nashville stays 0 for
// Tony and untouched for Jeff, and a re-run is a no-op.
// Run: node scripts/verify-build258.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build258-${Date.now()}.json`);
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

const TONY = "u-tony-258";
const JEFF = "u-jeff-258";
const now = "2026-11-25T23:30:00.000Z";
const hrPack = JSON.parse(fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev-tony-hr-257.json"), "utf8"));
const richPack = JSON.parse(fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev-tony-richmond-257.json"), "utf8"));
const miamiPack = JSON.parse(fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev-tony-miami-257.json"), "utf8"));

function leadRec(over) {
  return {
    id: over.id, marketId: over.marketId, marketName: over.marketName, locationId: over.id + "-loc", masterId: over.id,
    assignedRepId: over.assignedRepId, source: "HQ-loaded", championName: null,
    name: over.name, shortName: null, category: over.category || "Restaurants & Dining", subType: over.subType || "",
    neighborhood: "", city: over.city, address: null, website: null, websiteNote: null,
    dmName: null, dmRole: null, dmRoleLabel: null, secondContact: null, usuallyHere: null,
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
    ...(over.scripts257 ? { scripts257: over.scripts257 } : {}),
    createdAt: now, updatedAt: now,
  };
}

async function seed() {
  const tonyMarkets = [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "richmond", marketName: "Richmond" }, { marketId: "miami", marketName: "Miami" }];
  await store.set(`user:${TONY}`, { id: TONY, email: "tony@langstondigital.com", name: "Tony Johnson", role: "creator", creator: { handle: "tonyjohnson374" }, bizdevSeat: { active: true, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-TONY", markets: tonyMarkets } });
  await store.set(`user:${JEFF}`, { id: JEFF, email: "jeff@joinsignl.com", name: "Jeff Rimmer", role: "admin", bizdevSeat: { active: true, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HQ-JEFF", markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }], hqSeat: true } });
  await store.set(`bdevrep:${TONY}`, { userId: TONY, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-TONY", active: true, seatState: "probation", assignedAt: "2026-11-02T00:00:00.000Z", pinHash: "PINHASH-258", pinSalt: "PINSALT-258", vestedAt: null, warningMonth: null, atRisk: null, sharedBook: true, markets: tonyMarkets });
  await store.set(`bdevrep:${JEFF}`, { userId: JEFF, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HQ-JEFF", active: true, seatState: "active", assignedAt: "2026-11-02T00:00:00.000Z", pinHash: null, pinSalt: null, vestedAt: null, warningMonth: null, atRisk: null, hqSeat: true, sharedBook: true, markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }] });
  for (const k of ["config:bdevSeed155", "config:bdevEnrich157", "config:bdevLoadDest20261109", "config:bdevJeffSeat161", "config:bdevCleanup169", "config:bdevCleanupTony170", "config:bdevTonyNashville20261112", "config:bdevSharedBooks20261112"]) {
    await store.set(k, { done: true, at: now });
  }
  // The -257 flag as production recorded it: done, with the
  // pack errors that are the whole reason -258 exists.
  await store.set("config:bdevTonyBook257", { done: true, at: now, hrError: "pack missing or unreadable: ./bizdev-tony-hr-257.json", richmondError: "pack missing or unreadable: ./bizdev-tony-richmond-257.json", miamiError: "pack missing or unreadable: ./bizdev-tony-miami-257.json", scriptsStamped: 3, tonyBookByMarket: { "hampton-roads": 3 } });
  // Nashville: Jeff's records only (Tony's access was the
  // shared door, now closed by the seat edit).
  for (let i = 1; i <= 2; i++) {
    await store.set(`bdevlead:nash-jeff-${i}`, leadRec({ id: `nash-jeff-${i}`, marketId: "nashville", marketName: "Nashville", city: "Nashville", name: `Nashville Jeff Spot ${i}`, assignedRepId: JEFF, repCode: "HQ-JEFF", sharedBook: true, email: `nash${i}@example.com` }));
  }
  // Hampton Roads as -257 left it: two pack businesses (one
  // already script-stamped by -257) + one non-pack business.
  const p0 = hrPack.leads[0];
  const p1 = hrPack.leads[1];
  await store.set("bdevlead:hr-pre-0", leadRec({
    id: "hr-pre-0", marketId: "hampton-roads", marketName: "Hampton Roads", city: p0.city, name: p0.name,
    category: p0.category, subType: p0.subType, assignedRepId: TONY, repCode: "HR-TONY", sharedBook: true, email: p0.email,
    scripts257: { at: now, source: "Build -257 approved scripts (Jeff, 2026-11-25)" },
    playbook: { introEmail: { subject: "Hampton Roads' first local influencer platform is about to launch", body: "stamped by -257" }, followupEmail: { subject: "Re: Hampton Roads' first local influencer platform is about to launch", body: "stamped by -257" } },
  }));
  await store.set("bdevlead:hr-pre-1", leadRec({
    id: "hr-pre-1", marketId: "hampton-roads", marketName: "Hampton Roads", city: p1.city, name: p1.name,
    category: p1.category, subType: p1.subType, assignedRepId: TONY, repCode: "HR-TONY", sharedBook: true, email: p1.email,
  }));
  await store.set("bdevlead:hr-nonpack", leadRec({
    id: "hr-nonpack", marketId: "hampton-roads", marketName: "Hampton Roads", city: "Norfolk", name: "Fixture Non Pack Diner",
    assignedRepId: TONY, repCode: "HR-TONY", sharedBook: true, email: "nonpack@example.com",
  }));
}

console.log("== A: source pins ==");
{
  const bizJs = fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
  check("completion loader + flag exist", bizJs.includes("maybeTonyBook258") && bizJs.includes('"config:bdevTonyBook258"'), "");
  check("packs are required with LITERAL paths at module level (the bundler-traced pattern)", bizJs.includes('require("./bizdev-tony-hr-257.json")') && bizJs.includes('require("./bizdev-tony-richmond-257.json")') && bizJs.includes('require("./bizdev-tony-miami-257.json")'), "");
  check("no variable require of a pack survives", !/require\(packFile\)/.test(bizJs), "");
  check("preamble fires the completion pass un-awaited", routerJs.includes("bizdev.maybeTonyBook258()"), "");
  check("build stamp -258", buildJs.includes("2026.11.25-258"), "");
}

console.log("== B: the completion run, on production's partial state ==");
await seed();
bizdev.init({ allUsers: async () => [await store.get(`user:${TONY}`), await store.get(`user:${JEFF}`)] });
const ran = await bizdev.maybeTonyBook258();
check("loader returns true", ran === true, `got ${ran}`);
const flag = await store.get("config:bdevTonyBook258");
check("flag done, no pack errors", !!(flag && flag.done) && !flag.hrError && !flag.richmondError && !flag.miamiError, JSON.stringify(flag).slice(0, 240));
check("counts: HR added 80 (82-pack minus the 2 present), Richmond 31, Miami 32", flag.hrAdded === 80 && flag.richmondAdded === richPack.leads.length && flag.miamiAdded === miamiPack.leads.length, `hr=${flag.hrAdded} rich=${flag.richmondAdded} miami=${flag.miamiAdded}`);

console.log("== C: the finished book ==");
{
  const health = await bizdev.bdevHealth();
  const tonyBook = (health.books || {})["HR-TONY"] || {};
  const jeffBook = (health.books || {})["HQ-JEFF"] || {};
  check("Tony HR = 83 (82 pack + the non-pack survivor)", tonyBook["hampton-roads"] === 83, `got ${tonyBook["hampton-roads"]}`);
  check("Tony Richmond = 31, Miami = 32", tonyBook["richmond"] === richPack.leads.length && tonyBook["miami"] === miamiPack.leads.length, JSON.stringify(tonyBook));
  check("Tony Nashville still absent", !("nashville" in tonyBook), JSON.stringify(tonyBook));
  check("Jeff Nashville untouched at 2", jeffBook["nashville"] === 2, JSON.stringify(jeffBook));
  const nonpack = await store.get("bdevlead:hr-nonpack");
  check("the non-pack business survived and got stamped", !!nonpack && !!(nonpack.playbook && nonpack.playbook.introEmail), "");
  const seat = await store.get(`bdevrep:${TONY}`);
  check("seat unchanged: markets + PIN preserved", JSON.stringify((seat.markets || []).map((m) => m.marketId)) === JSON.stringify(["hampton-roads", "richmond", "miami"]) && seat.pinHash === "PINHASH-258" && seat.pinSalt === "PINSALT-258", "");
  const all = (await store.list("bdevlead:")).map((r) => r.value).filter(Boolean);
  const book = all.filter((l) => l.marketId !== "nashville");
  check("every lead in Tony's markets carries both scripts", book.every((l) => l.playbook && l.playbook.introEmail && l.playbook.followupEmail), `book=${book.length}`);
  check("Nashville leads untouched by the stamp", all.filter((l) => l.marketId === "nashville").every((l) => !l.scripts258 && !l.playbook), "");
  check("loader proof samples all ok", (flag.samples || []).length === 3 && flag.samples.every((s) => s.ok), JSON.stringify(flag.samples).slice(0, 300));
  const rich = all.find((l) => l.marketId === "richmond");
  const richR = bizdev._test.repLeadPayload(rich, { full: true, viewerRepCode: "HR-TONY" });
  check("rendered Richmond lead: subject + city line", richR.playbook.introEmail.subject === "Richmond's first local influencer platform is about to launch" && richR.playbook.introEmail.body.includes("Richmond is one of our first launch markets"), richR.playbook.introEmail.subject);
}

console.log("== D: re-run is a no-op ==");
{
  const before = (await store.list("bdevlead:")).length;
  const again = await bizdev.maybeTonyBook258();
  const after = (await store.list("bdevlead:")).length;
  check("second run returns true, lead count unchanged", again === true && before === after, `before=${before} after=${after}`);
}

console.log(`\nverify-build258: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
