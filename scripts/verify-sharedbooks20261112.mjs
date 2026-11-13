// verify-sharedbooks20261112.mjs — HQ load 2026-11-12 (Jeff's
// order 22:46 ET): SHARED BIZ DEV BOOKS for Nashville + Hampton
// Roads. Jeff and Tony work ONE record set per business;
// claiming is a badge, never a hide.
//   THE GAP (production shape): the two markets exist twice —
//   Jeff's Nashville 57 (Build -161) beside Tony's Nashville 57
//   (tonight's load), Jeff's Hampton Roads working copies beside
//   Tony's originals. A note, status, stage, or work claim on
//   one copy is invisible on the other.
//   THE BUILD: maybeUnifySharedBooks20261112 (flag-guarded,
//   single-flight, chained after the whole loader ladder)
//   folds each business's two records into ONE keeper per the
//   merge rules in bizdev.js (both sides' notes survive with
//   attribution, furthest-along working state wins, founding
//   from the more advanced side, flags union, hqOrder/tier
//   preserved, Nashville keeps Tony's voiced playbook), flags
//   both seats + every unified record sharedBook, re-points
//   logs/claims/escalations/activations/prewarm/photos onto
//   the keeper, and deletes the loser. Every read/write path
//   scopes through leadInSeatBook, so both men read and write
//   the same records; claim links render with the VIEWER's rep
//   code. The -161 loader gains a guard so its per-seat copy
//   steps can never resurrect the duplicates.
//   THE MERGE-LOGIC FIXTURES (divergent pairs, both-directions
//   claims on paper, isolation of other seats/markets) live in
//   scripts/verify-sharedbooks-merge-fixture.mjs.
// Run: node scripts/verify-sharedbooks20261112.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-sharedbooks-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["fixture", "admin", "password", "sb"].join("-");
process.env.APP_URL = "https://app.magpielocal.com";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_VERIFY_TOKEN = ["fixture", "verify", "token", "sharedbooks"].join("-");
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const bizdev = require("../netlify/functions/lib/bizdev.js");
const { handler } = require("../netlify/functions/api.js");
const root = process.cwd();

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

const PW = "fixture-password-1";
const uniq = () => Math.random().toString(36).slice(2, 9);
const admin = makeClient();
const anon = makeClient();

const ACTIVATION_ORDER = [
  "Cafe Roze", "Garage Sale Vintage", "Dozen Bakery", "Rolf and Daughters", "Baby Chan Bakery & Cafe",
  "Lockeland Table", "Limo Peruvian Eatery", "Bad Idea", "Surefire Coffee Co.", "Kisser",
  "Bad Luck Burger Club", "White's Mercantile", "O.liv Body Bar", "Holiday Salon & Bathhouse", "Grimey's New & Preloved Music",
  "Pelato", "Brightside Bakeshop", "Sho Pizza Bar", "Big Al's Deli & Breakfast", "Daddy's Hot Chicken",
  "Joyce's BBQ & Hot Chicken", "answer.", "Park Cafe", "Crema Coffee Roasters", "Dabble Studio (Dabble Tours and Events)",
  "Mas Tacos Por Favor", "Folk", "Noko", "Temporary Golf Store", "Bar Cala Cala",
  "Henrietta Red", "City House", "Two Ten Jack", "Peninsula", "GAON",
  "Mama Bread", "Fatbelly Pretzel", "Soy Cubano", "Asulon Collective", "The Green Ray",
  "Earl Espresso", "Spa Haus Nashville", "SALON ICON Nashville", "The Artistry, An Aesthetics House", "Sage Head Spa",
  "615 Local Goods Shoppe", "Mellow + Ivy", "Galeria Paloma", "Every Direction Vintage", "Brother Gee",
  "Alexander Interiors", "Drug Store Coffee", "Vinyl Vault (inside Mel's Drive-In)", "Forza Pilates", "Native Pilates",
  "Grow Yoga & Movement", "Hot Ticket Lounge",
];
const HOLDS = ["Forza Pilates", "Native Pilates", "Grow Yoga & Movement", "Hot Ticket Lounge"];

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const bizJs = fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("migration exists, flag-guarded, exported", bizJs.includes("config:bdevSharedBooks20261112") && bizJs.includes("maybeUnifySharedBooks20261112") && bizJs.includes("mergeSharedPairInto"), "");
  check("router preamble invokes it best-effort", routerJs.includes("bizdev.maybeUnifySharedBooks20261112()"), "");
  check("the -161 copy steps are guarded by the shared-books flag (no resurrection)", bizJs.includes("sharedBooksAreDone()") && bizJs.indexOf("sharedBooksAreDone()") < bizJs.indexOf("Hampton Roads working copies (idempotent on masterId)"), "");
  check("work-claim + work-release endpoints exist", bizJs.includes('"work-claim"') && bizJs.includes('"work-release"'), "");
  check("claim links render per-viewer (viewerRepCode)", bizJs.includes("viewerRepCode"), "");
  check("client renders the work-claim badge + claim/release actions", appJs.includes("bdWorkClaimBadge") && appJs.includes("bdWorkClaim") && appJs.includes("bdWorkRelease"), "");
  const migBody = bizJs.slice(bizJs.indexOf("maybeUnifySharedBooks20261112 = singleFlight"), bizJs.indexOf("The daily sweep (POST"));
  check("migration reads via bounded lists, not a serial per-key scan (LOADER RULE)", migBody.includes('store().list("bdevlead:")') === false && migBody.includes("allLeads({ fresh: true })") && (migBody.split("store().get(").length - 1) <= 3, `gets=${migBody.split("store().get(").length - 1}`);
}

// --- B: the prod-shaped cast ---------------------------------
console.log("== B: cast (prod shape) ==");
const TWIN_ID = "sb-twin-admin";
await store.set(`user:${TWIN_ID}`, { id: TWIN_ID, role: "admin", email: "jeff@magpielocal.com", name: "Jeff Rimmer", status: "approved", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
await store.set("email:jeff@magpielocal.com", { userId: TWIN_ID });
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin (jeff@joinsignl.com) login succeeds", r.status === 200, `got ${r.status}`);
}
const JEFF_ID = (await store.get("email:jeff@joinsignl.com")).userId;

async function registerCreator(name, handle, market, opts) {
  const o = opts || {};
  const c = makeClient();
  const email = o.email || `${handle.replace(/[^a-z0-9]/gi, "")}-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: PW, market, city: o.city || market, handle,
    categories: o.categories || ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: o.followers || 5000, avgViews: 1500, localAudiencePct: o.pct == null ? 70 : o.pct,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (r.status !== 201) throw new Error("creator register failed: " + JSON.stringify(r.data));
  return { client: c, email, id: r.data.user.id, handle };
}
async function approve(id) {
  const r = await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  if (r.status !== 200) throw new Error("approve failed: " + JSON.stringify(r.data));
}
async function setTester(id) {
  const u = await store.get(`user:${id}`);
  u.tester = true;
  await store.set(`user:${id}`, u);
}

const TONY = await registerCreator("Tony Johnson", "tonyjohnson374", "Virginia Beach", { email: "tony@langstondigital.com", city: "Newport News", categories: ["Lifestyle"], pct: 40, followers: 600 });
await approve(TONY.id);
await setTester(TONY.id);

// An other-market lead in Jeff's hands — the migration must
// never read it for update and never write it.
const RALEIGH_LEAD = {
  id: "sb-raleigh-jeff", marketId: "raleigh", marketName: "Raleigh", locationId: "sb-raleigh-loc", masterId: "sb-raleigh-jeff",
  assignedRepId: JEFF_ID, source: "HQ-loaded", name: "Raleigh Solo Deli", category: "Restaurants & Dining",
  neighborhood: "Downtown", city: "Raleigh", stage: "Not visited yet",
  stageHistory: [{ stage: "Not visited yet", at: "2026-11-01T00:00:00.000Z", by: "HQ-loaded" }],
  founding: { status: "Not claimed", claimedAt: null, claimedVia: null, confirmedAt: null, planInterest: null },
  attribution: { repCode: "HQ-JEFF", firstTouchAt: null, source: "HQ-loaded" },
  flags: { doNotContact: false, jeffHandles: false, chain: false },
  createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
};
await store.set(`bdevlead:${RALEIGH_LEAD.id}`, RALEIGH_LEAD);
const raleighBefore = JSON.stringify(await store.get(`bdevlead:${RALEIGH_LEAD.id}`));

// Ordinary traffic fires the whole ladder (seed -> enrich ->
// dest -> Jeff seat -> cleanups -> Tony Nashville -> shared
// books); the direct call makes the wait deterministic.
for (let i = 0; i < 3; i++) { await anon("GET", "/api/bdev/claim-info?lead=bgw-williamsburg-dest"); }
await bizdev.maybeUnifySharedBooks20261112();

// --- C: the unification --------------------------------------
console.log("== C: one record set per business ==");
const allLeads = (await store.list("bdevlead:")).map((r) => r.value);
const nash = allLeads.filter((l) => l.marketId === "nashville");
const hr = allLeads.filter((l) => l.marketId === "hampton-roads");
const flag = await store.get("config:bdevSharedBooks20261112");
check("migration flag done", !!(flag && flag.done), JSON.stringify(flag).slice(0, 200));
check("inventory recorded: Nashville 57 Jeff + 57 Tony -> 57 (57 pairs merged)", !!(flag && flag.markets && flag.markets.nashville.jeffBefore === 57 && flag.markets.nashville.tonyBefore === 57 && flag.markets.nashville.mergedPairs === 57 && flag.markets.nashville.after === 57), JSON.stringify(flag && flag.markets && flag.markets.nashville));
check("inventory recorded: Hampton Roads 33 Jeff + 33 Tony -> 33 (33 pairs merged)", !!(flag && flag.markets && flag.markets["hampton-roads"].jeffBefore === 33 && flag.markets["hampton-roads"].tonyBefore === 33 && flag.markets["hampton-roads"].mergedPairs === 33 && flag.markets["hampton-roads"].after === 33), JSON.stringify(flag && flag.markets && flag.markets["hampton-roads"]));
check("Nashville = 57 records total (one per business)", nash.length === 57, `got ${nash.length}`);
check("Hampton Roads = 33 records total (one per business)", hr.length === 33, `got ${hr.length}`);
check("total leads = 91 (90 shared + the planted Raleigh lead)", allLeads.length === 91, `got ${allLeads.length}`);
check("every Nashville + HR record is flagged sharedBook", [...nash, ...hr].every((l) => l.sharedBook === true && l.sharedGroup === "hq"), "");
check("no duplicate business identities in either market", new Set(nash.map((l) => `${l.name.toLowerCase()}||${(l.city || "").toLowerCase()}`)).size === 57 && new Set(hr.map((l) => `${l.name.toLowerCase()}||${(l.city || "").toLowerCase()}`)).size === 33, "");
check("the Raleigh lead is byte-unchanged and NOT shared", JSON.stringify(await store.get(`bdevlead:${RALEIGH_LEAD.id}`)) === raleighBefore, "");

const byOrder = [...nash].sort((a, b) => (a.hqOrder || 0) - (b.hqOrder || 0));
check("hqOrder survived the merge (1-57, activation order intact)", byOrder.every((l, i) => l.hqOrder === i + 1) && byOrder.map((l) => l.name).join("|") === ACTIVATION_ORDER.join("|"), byOrder.slice(0, 3).map((l) => l.name).join(", "));
check("tiering survived (30 A / 27 B)", nash.filter((l) => l.hqTier === "A").length === 30 && nash.filter((l) => l.hqTier === "B").length === 27, "");
check("the 4 category holds survived, flagged on the shared records", nash.filter((l) => l.flags && l.flags.categoryHold).map((l) => l.name).sort().join("|") === [...HOLDS].sort().join("|"), nash.filter((l) => l.flags && l.flags.categoryHold).map((l) => l.name).join(", "));
check("every merged pair carries its audit trail (sharedMerges)", [...nash, ...hr].every((l) => Array.isArray(l.sharedMerges) && l.sharedMerges.length === 1), "");

check("all 57 Nashville records carry playbooks", nash.filter((l) => l.playbook).length === 57, `got ${nash.filter((l) => l.playbook).length}`);
const jeffLeak = nash.filter((l) => JSON.stringify(l.playbook || {}).split("Jeff's go").join("").includes("Jeff"));
check("Nashville playbooks are Tony's voice on the shared records (no Jeff leak)", jeffLeak.length === 0 && nash.every((l) => JSON.stringify(l.playbook || {}).includes("Tony")), jeffLeak.map((l) => l.name).join(", "));
const bgw = hr.filter((l) => l.name === "Busch Gardens Williamsburg");
check("Busch Gardens is ONE record now, and it is Tony's original (the master his copies pointed at)", bgw.length === 1 && bgw[0].id === "bgw-williamsburg-dest", JSON.stringify(bgw.map((l) => l.id)));

const jeffSeat = await store.get(`bdevrep:${JEFF_ID}`);
const tonySeat = await store.get(`bdevrep:${TONY.id}`);
check("both seats are marked sharedBook", !!(jeffSeat && jeffSeat.sharedBook === true && tonySeat && tonySeat.sharedBook === true), "");
check("both user seat stamps carry sharedBook", !!((await store.get(`user:${JEFF_ID}`)).bizdevSeat.sharedBook && (await store.get(`user:${TONY.id}`)).bizdevSeat.sharedBook), "");
check("the twin admin still has NO seat (nothing leaked sideways)", (await store.get(`bdevrep:${TWIN_ID}`)) === null, "");

{
  const vc = await anon("GET", "/api/verify/counts", null, { headers: { "x-signl-verify-token": "fixture-verify-token-sharedbooks" } });
  const b = vc.data && vc.data.bdev;
  check("verify/counts: both books show BOTH markets at the shared counts", !!(b && b.books["HR-TONY"] && b.books["HR-TONY"]["hampton-roads"] === 33 && b.books["HR-TONY"]["nashville"] === 57 && b.books["HQ-JEFF"] && b.books["HQ-JEFF"]["hampton-roads"] === 33 && b.books["HQ-JEFF"]["nashville"] === 57), JSON.stringify(b && b.books).slice(0, 240));
  check("verify/counts: market totals are the unified counts (33 / 57)", !!(b && b.leadsByMarket["hampton-roads"] === 33 && b.leadsByMarket["nashville"] === 57), JSON.stringify(b && b.leadsByMarket));
  check("verify/counts: Busch Gardens sits in Jeff's (shared) book exactly once", !!(b && b.bgwInJeffBook === 1), `got ${b && b.bgwInJeffBook}`);
  check("verify/counts: loader status shows sharedBooks20261112 done", !!(b && b.loaderStatus.sharedBooks20261112 && b.loaderStatus.sharedBooks20261112.state === "done"), JSON.stringify(b && b.loaderStatus.sharedBooks20261112).slice(0, 160));
}

// --- D: shared reads, shared writes, the claim ---------------
console.log("== D: both men, same records ==");
const tonyLogin = await TONY.client("POST", "/api/auth/login", { email: "tony@langstondigital.com", password: PW });
check("Tony logs in on his real account", tonyLogin.status === 200, `got ${tonyLogin.status}`);
let tonyNashIds = [], jeffNashIds = [];
{
  const t = await TONY.client("GET", "/api/bdev/leads?mkt=nashville");
  const j = await admin("GET", "/api/bdev/leads?mkt=nashville");
  tonyNashIds = (t.data.leads || []).map((l) => l.id).sort();
  jeffNashIds = (j.data.leads || []).map((l) => l.id).sort();
  check("Tony's Nashville list = 57 through the rep API", t.status === 200 && t.data.leads.length === 57, `got ${t.status}/${t.data.leads && t.data.leads.length}`);
  check("Jeff's Nashville list is the SAME 57 record ids", JSON.stringify(tonyNashIds) === JSON.stringify(jeffNashIds) && jeffNashIds.length === 57, `jeff=${jeffNashIds.length}`);
  // NB: ?mkt= is explicit here — the -161 seat preference
  // remembers Nashville from the calls above, by design.
  const th = await TONY.client("GET", "/api/bdev/leads?mkt=hampton-roads");
  const jh = await admin("GET", "/api/bdev/leads?mkt=hampton-roads");
  check("Hampton Roads lists are the same 33 ids for both men", th.data.leads.length === 33 && jh.data.leads.length === 33 && JSON.stringify(th.data.leads.map((l) => l.id).sort()) === JSON.stringify(jh.data.leads.map((l) => l.id).sort()), `tony=${th.data.leads && th.data.leads.length} jeff=${jh.data.leads && jh.data.leads.length}`);
  check("list payloads badge the shared book", (t.data.leads || []).every((l) => l.sharedBook === true && "workClaim" in l), "");
}
const cafeId = (nash.find((l) => l.name === "Cafe Roze") || {}).id;
{
  const t = await TONY.client("GET", `/api/bdev/leads/${cafeId}?mkt=nashville`);
  const j = await admin("GET", `/api/bdev/leads/${cafeId}?mkt=nashville`);
  const tIntro = ((t.data.lead.playbook || {}).introEmail || {}).body || "";
  const jIntro = ((j.data.lead.playbook || {}).introEmail || {}).body || "";
  check("the SAME record renders Tony's claim link for Tony", tIntro.includes(`https://app.magpielocal.com/founding-claim?rep=HR-TONY&lead=${cafeId}`), tIntro.slice(-140));
  check("the SAME record renders Jeff's claim link for Jeff", jIntro.includes(`https://app.magpielocal.com/founding-claim?rep=HQ-JEFF&lead=${cafeId}`), jIntro.slice(-140));
  check("the stored record itself was not mutated by either read", (await store.get(`bdevlead:${cafeId}`)).attribution.repCode === (nash.find((l) => l.id === cafeId) || {}).attribution.repCode, "");
}
{
  // Shared write 1: Tony sets a status; Jeff reads it back.
  const target = nash.find((l) => l.name === "Dozen Bakery");
  const w = await TONY.client("POST", `/api/bdev/leads/${target.id}/status?mkt=nashville`, { status: "Follow up" });
  check("Tony sets a status on a shared Nashville lead", w.status === 200, `got ${w.status}`);
  const r = await admin("GET", `/api/bdev/leads/${target.id}?mkt=nashville`);
  check("Jeff reads Tony's status on the same record, credited to Tony Johnson", r.data.lead.status === "Follow up" && (r.data.lead.statusHistory || []).some((h) => h.status === "Follow up" && h.by === "Tony Johnson"), JSON.stringify(r.data.lead.statusHistory).slice(0, 200));
}
{
  // Shared write 2: Jeff logs a visit in Hampton Roads; Tony
  // reads the stage move and the log line.
  const target = hr.find((l) => l.name === "Terrapin Restaurant") || hr[0];
  const w = await admin("POST", `/api/bdev/leads/${target.id}/log?mkt=hampton-roads`, { outcome: "Talked — needs to think", spokeWith: "Owner", spokeName: "Sam" });
  check("Jeff logs a visit on a shared HR lead", w.status === 200, `got ${w.status} ${JSON.stringify(w.data).slice(0, 120)}`);
  const r = await TONY.client("GET", `/api/bdev/leads/${target.id}?mkt=hampton-roads`);
  check("Tony reads Jeff's stage move on the same record", r.data.lead.stage === "Talked — needs to think", `stage=${r.data.lead && r.data.lead.stage}`);
  check("Tony sees Jeff's log line in the record's history", (r.data.logs || []).some((v) => v.outcome === "Talked — needs to think" && v.repId === JEFF_ID), JSON.stringify(r.data.logs).slice(0, 200));
}
{
  // The work claim, both directions — badge, never hide.
  const target = nash.find((l) => l.name === "Pelato");
  const c1 = await admin("POST", `/api/bdev/leads/${target.id}/work-claim?mkt=nashville`, {});
  check("Jeff claims Pelato", c1.status === 200 && c1.data.lead.workClaim && c1.data.lead.workClaim.byRepCode === "HQ-JEFF", `got ${c1.status} ${JSON.stringify(c1.data).slice(0, 160)}`);
  const seen = await TONY.client("GET", `/api/bdev/leads/${target.id}?mkt=nashville`);
  check("Tony sees Jeff's claim badge on the shared record", !!(seen.data.lead.workClaim && seen.data.lead.workClaim.byRepCode === "HQ-JEFF" && seen.data.lead.workClaim.byName === "Jeff Rimmer"), JSON.stringify(seen.data.lead.workClaim));
  const c2 = await TONY.client("POST", `/api/bdev/leads/${target.id}/work-claim?mkt=nashville`, {});
  check("Tony cannot claim what Jeff already claimed (409, badge intact)", c2.status === 409 && (await store.get(`bdevlead:${target.id}`)).workClaim.byRepCode === "HQ-JEFF", `got ${c2.status}`);
  const rel = await TONY.client("POST", `/api/bdev/leads/${target.id}/work-release?mkt=nashville`, {});
  check("Tony cannot release Jeff's claim (403)", rel.status === 403, `got ${rel.status}`);
  const stillThere = await TONY.client("GET", "/api/bdev/leads?mkt=nashville");
  check("a claimed business is NOT hidden from the other man", (stillThere.data.leads || []).some((l) => l.id === target.id), "");
  const sw = await TONY.client("POST", `/api/bdev/leads/${target.id}/status?mkt=nashville`, { status: "Contacted" });
  check("the non-claimer can still WORK a claimed business (status write lands)", sw.status === 200, `got ${sw.status}`);
  const r1 = await admin("POST", `/api/bdev/leads/${target.id}/work-release?mkt=nashville`, {});
  check("Jeff releases his own claim", r1.status === 200 && r1.data.lead.workClaim === null, `got ${r1.status}`);
  const c3 = await TONY.client("POST", `/api/bdev/leads/${target.id}/work-claim?mkt=nashville`, {});
  check("Tony claims it once it is free", c3.status === 200 && c3.data.lead.workClaim && c3.data.lead.workClaim.byRepCode === "HR-TONY", `got ${c3.status}`);
  const seen2 = await admin("GET", `/api/bdev/leads/${target.id}?mkt=nashville`);
  check("Jeff sees Tony's claim badge (the other direction)", !!(seen2.data.lead.workClaim && seen2.data.lead.workClaim.byRepCode === "HR-TONY"), JSON.stringify(seen2.data.lead.workClaim));
  const r2 = await TONY.client("POST", `/api/bdev/leads/${target.id}/work-release?mkt=nashville`, {});
  check("Tony releases, leaving the record unclaimed", r2.status === 200 && (await store.get(`bdevlead:${target.id}`)).workClaim === null, `got ${r2.status}`);
}
{
  // A lead added by hand joins the shared book at birth.
  const add = await TONY.client("POST", "/api/bdev/leads?mkt=nashville", { name: "Shared Books Test Deli", category: "Restaurants & Dining", neighborhood: "East Nashville", city: "Nashville" });
  check("Tony adds a Nashville lead by hand", add.status === 200 && !!(add.data.lead && add.data.lead.id), `got ${add.status} ${JSON.stringify(add.data).slice(0, 160)}`);
  const stored = add.data.lead && await store.get(`bdevlead:${add.data.lead.id}`);
  check("the hand-added lead is born shared", !!(stored && stored.sharedBook === true && stored.sharedGroup === "hq"), "");
  const jeffList = await admin("GET", "/api/bdev/leads?mkt=nashville");
  check("Jeff's Nashville list includes Tony's new lead (58)", (jeffList.data.leads || []).some((l) => l.id === (add.data.lead || {}).id) && jeffList.data.leads.length === 58, `got ${jeffList.data.leads && jeffList.data.leads.length}`);
}

// --- E: fresh-process re-run is a no-op -----------------------
console.log("== E: loaders re-run in a fresh process — nothing moves, nothing resurrects ==");
{
  const idsBefore = (await store.list("bdevlead:")).map((r) => r.value.id).sort().join(",");
  const child = path.join(os.tmpdir(), `signl-verify-sharedbooks-child-${Date.now()}.mjs`);
  fs.writeFileSync(child, `
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const store = require(${JSON.stringify(path.join(root, "netlify/functions/lib/store.js"))});
const bizdev = require(${JSON.stringify(path.join(root, "netlify/functions/lib/bizdev.js"))});
bizdev.init({ allUsers: async () => (await store.list("user:")).map((r) => r.value), logCapture: () => null, marketCreators: async () => ({ count: 0, byBucket: {}, bench: [] }) });
await bizdev.maybeSeedBizdev();
await bizdev.maybeLoadJeffSeat161();
await bizdev.maybeCleanup169();
await bizdev.maybeCleanupTony170();
await bizdev.maybeLoadTonyNashville20261112();
await bizdev.maybeUnifySharedBooks20261112();
await bizdev.maybeUnifySharedBooks20261112();
const leads = (await store.list("bdevlead:")).map((r) => r.value);
const flag2 = await store.get("config:bdevSharedBooks20261112");
console.log(JSON.stringify({ total: leads.length, ids: leads.map((l) => l.id).sort().join(","), nashPairs: flag2 && flag2.markets && flag2.markets.nashville.mergedPairs, hrPairs: flag2 && flag2.markets && flag2.markets["hampton-roads"].mergedPairs }));
`);
  const out = execFileSync(process.execPath, [child], { env: { ...process.env }, encoding: "utf8" });
  const snap = JSON.parse(out.trim().split("\n").pop());
  check("re-run: the lead set is identical (no duplicates, no resurrected copies)", snap.ids === idsBefore && snap.total === 92, `total=${snap.total}`);
  check("re-run: the done flag makes the migration a no-op (merge counts frozen)", snap.nashPairs === 57 && snap.hrPairs === 33, JSON.stringify(snap).slice(0, 160));
  fs.unlinkSync(child);
}

console.log(`\nverify-sharedbooks20261112: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
