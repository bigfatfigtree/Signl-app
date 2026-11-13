// verify-tonynashville20261112.mjs — HQ load 2026-11-12:
// Tony's Nashville book (Jeff's order 2026-11-12: "add to
// Tony's biz dev Nashville — so he can access that and start
// calling and emailing on it tomorrow").
//   THE GAP (production shape): the 57 Nashville activation
//   targets exist ONLY in Jeff's book (Build -161 loaded them
//   for HQ-JEFF); Tony's seat holds Hampton Roads alone, so
//   Nashville does not exist for his login.
//   THE LOAD (maybeLoadTonyNashville20261112, in the seed /
//   dest claimed-flag pattern): Nashville joins Tony's seat
//   markets; the 57 load into his book from the same stored
//   seed + enrichment Jeff's copies came from — tiering
//   (hqTier) and list order (hqOrder 1-57) preserved; the
//   Jeff-voiced playbooks are mechanically re-voiced to Tony
//   and validated (any pack still naming Jeff outside the
//   protected "Jeff's go" HQ phrase is dropped, never handed
//   over); the 4 category holds (Forza Pilates, Native
//   Pilates, Grow Yoga & Movement — fitness; Hot Ticket
//   Lounge — nightlife) load flagged flags.categoryHold with
//   the hold as the lead's next-action text.
//   THIS FIXTURE IS THE PROD SHAPE ON PURPOSE (mirrors
//   verify-build167): Tony under tony@langstondigital.com,
//   a bootstrap-twin admin under jeff@magpielocal.com.
// Run: node scripts/verify-tonynashville20261112.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-tonynash-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["fixture", "admin", "password", "tn"].join("-");
process.env.APP_URL = "https://app.magpielocal.com";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_VERIFY_TOKEN = ["fixture", "verify", "token", "tonynash"].join("-");
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
  check("loader exists, flag-guarded, exported", bizJs.includes("config:bdevTonyNashville20261112") && bizJs.includes("maybeLoadTonyNashville20261112") && bizJs.includes("revoicePlaybookForTony"), "");
  check("router preamble invokes it best-effort", routerJs.includes("bizdev.maybeLoadTonyNashville20261112()"), "");
  const loaderBody = bizJs.slice(bizJs.indexOf("maybeLoadTonyNashville20261112 = singleFlight"), bizJs.indexOf("The daily sweep (POST"));
  check("loader reads via bounded lists, not a serial per-key scan (LOADER RULE)", loaderBody.includes('leadsOfMarket("nashville")') && loaderBody.includes('store().list("bdevrep:")') && (loaderBody.split("store().get(").length - 1) <= 2, `gets=${loaderBody.split("store().get(").length - 1}`);
}

// --- B: the prod-shaped cast ---------------------------------
console.log("== B: cast (prod shape) ==");
const TWIN_ID = "tn-twin-admin";
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

// Ordinary traffic fires the preamble ladder (seed -> enrich ->
// dest -> Jeff seat -> cleanups -> Tony Nashville).
for (let i = 0; i < 3; i++) { await anon("GET", "/api/bdev/claim-info?lead=bgw-williamsburg-dest"); }
await bizdev.maybeLoadTonyNashville20261112();

// --- C: the load itself --------------------------------------
console.log("== C: Tony's Nashville book ==");
const allLeads = (await store.list("bdevlead:")).map((r) => r.value);
const tonyAll = allLeads.filter((l) => l.assignedRepId === TONY.id);
const tonyHR = tonyAll.filter((l) => l.marketId === "hampton-roads");
const tonyNash = tonyAll.filter((l) => l.marketId === "nashville");
const jeffAll = allLeads.filter((l) => l.assignedRepId === JEFF_ID);
const jeffNash = jeffAll.filter((l) => l.marketId === "nashville");
const jeffHR = jeffAll.filter((l) => l.marketId === "hampton-roads");

const flag = await store.get("config:bdevTonyNashville20261112");
check("loader flag done with the full counts", !!(flag && flag.done && flag.leadsCreated === 57 && flag.skippedExisting === 0 && flag.holdsFlagged === 4), JSON.stringify(flag).slice(0, 240));
check("Tony's Hampton Roads book unchanged (32 seed + Busch Gardens)", tonyHR.length === 33, `got ${tonyHR.length}`);
check("Tony's Nashville book = 57", tonyNash.length === 57, `got ${tonyNash.length}`);
check("no duplicate business identities in Tony's Nashville book", new Set(tonyNash.map((l) => `${l.name.toLowerCase()}||${(l.city || "").toLowerCase()}`)).size === 57, "");
check("Jeff's books untouched (HR 33 copies, Nashville 57)", jeffHR.length === 33 && jeffNash.length === 57, `jeffHR=${jeffHR.length} jeffNash=${jeffNash.length}`);
check("total leads = 180 (66 HR + 114 Nashville)", allLeads.length === 180, `got ${allLeads.length}`);

const byOrder = [...tonyNash].sort((a, b) => (a.hqOrder || 0) - (b.hqOrder || 0));
check("hqOrder runs 1-57 with no gaps", byOrder.every((l, i) => l.hqOrder === i + 1), byOrder.map((l) => l.hqOrder).slice(0, 8).join(","));
check("read back in hqOrder, the names match the activation list exactly", byOrder.map((l) => l.name).join("|") === ACTIVATION_ORDER.join("|"), byOrder.slice(0, 3).map((l) => l.name).join(", "));
check("the first 15 in order are the activation first 15", byOrder.slice(0, 15).map((l) => l.name).join("|") === ACTIVATION_ORDER.slice(0, 15).join("|"), "");
check("tiering preserved (30 Tier A, 27 Tier B)", tonyNash.filter((l) => l.hqTier === "A").length === 30 && tonyNash.filter((l) => l.hqTier === "B").length === 27, `A=${tonyNash.filter((l) => l.hqTier === "A").length} B=${tonyNash.filter((l) => l.hqTier === "B").length}`);

const holdLeads = tonyNash.filter((l) => l.flags && l.flags.categoryHold);
check("exactly the 4 category holds are flagged", holdLeads.map((l) => l.name).sort().join("|") === [...HOLDS].sort().join("|"), holdLeads.map((l) => l.name).join(", "));
check("each hold carries the hold as its next-action text", holdLeads.every((l) => l.nextAction && String(l.nextAction.what || "").startsWith("CATEGORY HOLD")), "");
check("holds are NOT disguised as do-not-contact", holdLeads.every((l) => !(l.flags && l.flags.doNotContact)), "");

check("all 57 carry playbooks", tonyNash.filter((l) => l.playbook).length === 57, `got ${tonyNash.filter((l) => l.playbook).length} (flag: attached=${flag && flag.playbooksAttached} dropped=${flag && flag.playbooksDropped})`);
const jeffLeak = tonyNash.filter((l) => JSON.stringify(l.playbook || {}).split("Jeff's go").join("").includes("Jeff"));
check("no Tony playbook names Jeff outside the protected HQ phrase", jeffLeak.length === 0, jeffLeak.map((l) => l.name).join(", "));
check("every Tony playbook is in Tony's voice", tonyNash.every((l) => JSON.stringify(l.playbook || {}).includes("Tony")), "");
const cafe = tonyNash.find((l) => l.name === "Cafe Roze");
check("Cafe Roze intro email signs as Tony Johnson, Magpie — Nashville", ((cafe.playbook.introEmail || {}).body || "").includes("Tony Johnson\nMagpie — Nashville"), ((cafe.playbook.introEmail || {}).body || "").slice(-80));
const jeffCafe = jeffNash.find((l) => l.name === "Cafe Roze");
check("Jeff's own Cafe Roze playbook still speaks as Jeff (his book untouched)", ((jeffCafe.playbook.introEmail || {}).body || "").includes("Jeff Rimmer"), "");

const seat = await store.get(`bdevrep:${TONY.id}`);
check("Tony's seat now holds both markets (home stays Hampton Roads)", !!(seat && seat.marketId === "hampton-roads" && Array.isArray(seat.markets) && seat.markets.map((m) => m.marketId).join(",") === "hampton-roads,nashville"), JSON.stringify(seat && seat.markets));
const tonyUser = await store.get(`user:${TONY.id}`);
check("Tony's user seat stamp carries both markets", !!(tonyUser.bizdevSeat && Array.isArray(tonyUser.bizdevSeat.markets) && tonyUser.bizdevSeat.markets.length === 2), JSON.stringify(tonyUser.bizdevSeat || null));

// --- D: the reads Tony's Sell view makes ----------------------
console.log("== D: UI read paths ==");
const tonyLogin = await TONY.client("POST", "/api/auth/login", { email: "tony@langstondigital.com", password: PW });
check("Tony logs in on his real account", tonyLogin.status === 200, `got ${tonyLogin.status}`);
{
  const r = await TONY.client("GET", "/api/bdev/leads");
  check("Tony's default book (Hampton Roads) still lists 33", r.status === 200 && r.data.leads.length === 33, `got ${r.status}/${r.data.leads && r.data.leads.length}`);
  const seatMarkets = (r.data.seat && r.data.seat.markets) || [];
  check("the leads payload offers both cities on his seat", seatMarkets.map((m) => m.marketId).join(",") === "hampton-roads,nashville", JSON.stringify(seatMarkets));
}
{
  const r = await TONY.client("GET", "/api/bdev/leads?mkt=nashville");
  check("Tony's Nashville book lists 57 through the rep API", r.status === 200 && r.data.leads.length === 57, `got ${r.status}/${r.data.leads && r.data.leads.length}`);
  const first = r.data.leads.find((l) => l.name === "Cafe Roze");
  const d = await TONY.client("GET", `/api/bdev/leads/${first.id}?mkt=nashville`);
  const pb = d.data.lead && d.data.lead.playbook;
  const intro = (pb && pb.introEmail && pb.introEmail.body) || "";
  check("Nashville lead detail carries the playbook", !!(pb && pb.introEmail && pb.followupEmail), "");
  check("intro email renders Tony's HR-TONY claim link", intro.includes(`https://app.magpielocal.com/founding-claim?rep=HR-TONY&lead=${first.id}`), intro.slice(-160));
  check("no {claimUrl} token survives in the payload", !JSON.stringify(d.data).includes("{claimUrl}"), "");
  const q = await TONY.client("GET", "/api/bdev/queue?mkt=nashville");
  check("Tony's Nashville queue builds", q.status === 200 && Array.isArray(q.data.queue) && q.data.queue.length > 0, `got ${q.status}/${q.data.queue && q.data.queue.length}`);
}
{
  const vc = await anon("GET", "/api/verify/counts", null, { headers: { "x-signl-verify-token": "fixture-verify-token-tonynash" } });
  const b = vc.data && vc.data.bdev;
  check("verify/counts: per-book counts show Tony with both books", !!(b && b.books["HR-TONY"] && b.books["HR-TONY"]["hampton-roads"] === 33 && b.books["HR-TONY"]["nashville"] === 57), JSON.stringify(b && b.books).slice(0, 200));
  check("verify/counts: loader status shows tonyNashville20261112 done", !!(b && b.loaderStatus.tonyNashville20261112 && b.loaderStatus.tonyNashville20261112.state === "done"), JSON.stringify(b && b.loaderStatus.tonyNashville20261112).slice(0, 160));
}

// --- E: idempotency across a fresh process --------------------
console.log("== E: loaders re-run in a fresh process — counts must not move ==");
{
  const child = path.join(os.tmpdir(), `signl-verify-tonynash-child-${Date.now()}.mjs`);
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
await bizdev.maybeLoadTonyNashville20261112();
const leads = (await store.list("bdevlead:")).map((r) => r.value);
const flag2 = await store.get("config:bdevTonyNashville20261112");
console.log(JSON.stringify({ total: leads.length, flagCreated: flag2 && flag2.leadsCreated }));
`);
  const out = execFileSync(process.execPath, [child], { env: { ...process.env }, encoding: "utf8" });
  const snap = JSON.parse(out.trim().split("\n").pop());
  check("re-run: still 180 leads, no duplicates created", snap.total === 180, JSON.stringify(snap));
  check("re-run: the done flag makes the loader a no-op (created stays 57)", snap.flagCreated === 57, JSON.stringify(snap));
  fs.unlinkSync(child);
}

console.log(`\nverify-tonynashville20261112: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
