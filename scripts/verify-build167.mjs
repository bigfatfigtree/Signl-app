// verify-build167.mjs — Build -167: Biz Dev data missing in
// production — diagnosis + fix.
//   THE BUG (production, verified live 2026-11-09 13:33-13:35
//   ET): Admin Biz Dev shows "No seats yet" and zero leads even
//   though Builds -155/-157/-161 shipped Tony's seat + 32 HR
//   leads, the destination load (Busch Gardens) and Jeff's
//   seller seat. Root cause: the -155 seed resolved Tony's
//   account ONLY through an email index for
//   tjohnson23462@gmail.com — the address Jeff named for the
//   seat — but Tony's real production account (@tonyjohnson374)
//   was created under tony@langstondigital.com and no account
//   ever existed under the gmail address. The seed "waited"
//   forever; enrich/dest/Jeff-seat all hard-gate on the seed
//   flag, so nothing ever loaded, and every bail was silent.
//   THE FIX: loaders resolve people by STABLE facts (ordered
//   real identifiers: designated email -> account email of
//   record -> handle for Tony; jeff@joinsignl.com -> ADMIN_EMAIL
//   -> jeff@magpielocal.com for Jeff, so the seat binds to the
//   login he actually uses, never a bootstrap twin); loaders
//   chain (Jeff's settles seed+enrich+dest first) and share
//   single-flight runs; every loader records its state in
//   config:bdevLoaderStatus, surfaced on the HQ overview and
//   GET /api/verify/counts (bdev block); playbook email bodies
//   render their {claimUrl} token into the lead's real
//   founding-claim link at payload time (stored playbook keeps
//   the token).
//   THIS FIXTURE IS THE PROD SHAPE ON PURPOSE: Tony registers
//   under tony@langstondigital.com (NO gmail account exists),
//   and a second admin record sits under jeff@magpielocal.com
//   (the ensureAdmin default) — Jeff's seat must still land on
//   the jeff@joinsignl.com login.
// Run: node scripts/verify-build167.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build167-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["fixture", "admin", "1"].join("-");
process.env.APP_URL = "https://app.magpielocal.com";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_VERIFY_TOKEN = "fixture-verify-token-167";
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

const PW = "fixture-password-1";
const uniq = () => Math.random().toString(36).slice(2, 9);
const admin = makeClient();
const anon = makeClient();

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const bizJs = fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("seed resolves Tony by stable facts (gmail -> langstondigital -> handle)", bizJs.includes("TONY_EMAILS") && bizJs.includes("tony@langstondigital.com") && bizJs.includes("TONY_HANDLE"), "");
  check("Jeff resolution binds jeff@joinsignl.com first", bizJs.indexOf('"jeff@joinsignl.com"') > -1 && bizJs.indexOf('"jeff@joinsignl.com"') < bizJs.indexOf('"jeff@magpielocal.com"'), "");
  check("loader status record + health surface exist", bizJs.includes("config:bdevLoaderStatus") && bizJs.includes("bdevHealth") && routerJs.includes("bdev167"), "");
  check("playbook render substitutes the claim token", bizJs.includes("renderPlaybookLinks") && bizJs.includes("CLAIM_TOKEN_RE"), "");
  check("no loader keys on the old single gmail index anymore", !bizJs.includes('store().get("email:tjohnson23462@gmail.com")'), "");
}

// --- B: the prod-shaped cast ---------------------------------
console.log("== B: cast (prod shape) ==");
// The bootstrap twin: an admin record under the ensureAdmin
// DEFAULT address. It must never receive Jeff's seat.
const TWIN_ID = "167-twin-admin";
await store.set(`user:${TWIN_ID}`, { id: TWIN_ID, role: "admin", email: "jeff@magpielocal.com", name: "Jeff Rimmer", status: "approved", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
await store.set("email:jeff@magpielocal.com", { userId: TWIN_ID });

{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin (jeff@joinsignl.com) login succeeds", r.status === 200, `got ${r.status}`);
}
const JEFF_ID = (await store.get("email:jeff@joinsignl.com")).userId;
check("admin account resolved under jeff@joinsignl.com", !!JEFF_ID && JEFF_ID !== TWIN_ID, `jeff=${JEFF_ID}`);

// Pre-state (before Tony's account exists): nothing can load —
// this is the production symptom, reproduced.
{
  const ci = await anon("GET", "/api/bdev/claim-info?lead=bgw-williamsburg-dest");
  check("pre-load: BGW claim-info is null (mirrors the live symptom)", ci.status === 200 && ci.data.businessName === null, JSON.stringify(ci.data).slice(0, 120));
  const seats = await store.list("bdevrep:");
  check("pre-load: no seats in the store", seats.length === 0, `got ${seats.length}`);
  const st = await store.get("config:bdevLoaderStatus");
  check("pre-load: the seed's waiting state is RECORDED (visible, not silent)", !!(st && st.seed155 && st.seed155.state === "waiting"), JSON.stringify(st).slice(0, 200));
}

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

// Tony Johnson — PROD SHAPE: his account lives under
// tony@langstondigital.com. There is deliberately NO account
// under tjohnson23462@gmail.com in this fixture.
const TONY = await registerCreator("Tony Johnson", "tonyjohnson374", "Virginia Beach", { email: "tony@langstondigital.com", city: "Newport News", categories: ["Lifestyle"], pct: 40, followers: 600 });
await approve(TONY.id);
await setTester(TONY.id);
check("fixture has NO gmail account for Tony (the prod gap)", (await store.get("email:tjohnson23462@gmail.com")) === null, "");

// --- C: the loaders fire on ordinary traffic ------------------
console.log("== C: loaders converge on ordinary requests ==");
await anon("GET", "/api/bootstrap");
await anon("GET", "/api/bootstrap");

const seedFlag = await store.get("config:bdevSeed155");
check("seed flag done", !!(seedFlag && seedFlag.done), JSON.stringify(seedFlag).slice(0, 200));
check("seed resolved Tony via his real account email", seedFlag && seedFlag.resolvedVia === "email:tony@langstondigital.com", `via=${seedFlag && seedFlag.resolvedVia}`);

const tonySeat = await store.get(`bdevrep:${TONY.id}`);
check("HR-TONY seat sits on Tony's real account", !!(tonySeat && tonySeat.active && tonySeat.repCode === "HR-TONY"), JSON.stringify(tonySeat).slice(0, 160));
const tonyUser = await store.get(`user:${TONY.id}`);
check("Tony's user record carries the seat stamp (his shell flips)", !!(tonyUser.bizdevSeat && tonyUser.bizdevSeat.active && tonyUser.bizdevSeat.repCode === "HR-TONY"), JSON.stringify(tonyUser.bizdevSeat || null));

const allLeads = (await store.list("bdevlead:")).map((r) => r.value);
const tonyBook = allLeads.filter((l) => l.assignedRepId === TONY.id);
const jeffBook = allLeads.filter((l) => l.assignedRepId === JEFF_ID);
const jeffHR = jeffBook.filter((l) => l.marketId === "hampton-roads");
const jeffNash = jeffBook.filter((l) => l.marketId === "nashville");
// HQ load 2026-11-12 (Jeff's order): Tony gained a Nashville
// book of his own (57, via maybeLoadTonyNashville20261112), so
// his HR pins scope to the HR market and the Nashville market
// totals doubled. Full assertions live in
// scripts/verify-tonynashville20261112.mjs.
const tonyHR = tonyBook.filter((l) => l.marketId === "hampton-roads");
check("Tony's HR book = 32 seed + Busch Gardens", tonyHR.length === 33, `got ${tonyHR.length}`);
const bgw = tonyBook.find((l) => l.id === "bgw-williamsburg-dest");
check("Busch Gardens Williamsburg is in Tony's book", !!(bgw && bgw.name === "Busch Gardens Williamsburg" && bgw.playbook), bgw ? bgw.name : "missing");
check("all 32 seeded leads carry enriched playbooks", tonyHR.filter((l) => l.id !== "bgw-williamsburg-dest" && l.playbook).length === 32, `got ${tonyHR.filter((l) => l.playbook).length} with playbooks`);
check("Jeff's HR copies = 33 (incl. the BGW copy)", jeffHR.length === 33 && jeffHR.some((l) => l.masterId === "bgw-williamsburg-dest"), `got ${jeffHR.length}`);
check("Jeff's Nashville book = 57 targets", jeffNash.length === 57, `got ${jeffNash.length}`);
check("every Nashville lead carries its playbook", jeffNash.filter((l) => l.playbook).length === 57, `got ${jeffNash.filter((l) => l.playbook).length}`);
check("total lead records = 180 (123 + Tony's 57 Nashville, HQ load 2026-11-12)", allLeads.length === 180, `got ${allLeads.length}`);

const jeffSeat = await store.get(`bdevrep:${JEFF_ID}`);
check("HQ-JEFF seat sits on Jeff's joinsignl admin", !!(jeffSeat && jeffSeat.active && jeffSeat.repCode === "HQ-JEFF" && jeffSeat.hqSeat === true), JSON.stringify(jeffSeat).slice(0, 160));
check("Jeff's seat holds both markets", Array.isArray(jeffSeat && jeffSeat.markets) && jeffSeat.markets.map((m) => m.marketId).join(",") === "hampton-roads,nashville", JSON.stringify(jeffSeat && jeffSeat.markets));
check("the magpielocal twin admin got NO seat", (await store.get(`bdevrep:${TWIN_ID}`)) === null, "");
const jeffUser = await store.get(`user:${JEFF_ID}`);
check("Jeff's user record carries the HQ-JEFF stamp (toggle appears)", !!(jeffUser.bizdevSeat && jeffUser.bizdevSeat.active && jeffUser.bizdevSeat.repCode === "HQ-JEFF" && jeffUser.bizdevSeat.hqSeat === true), JSON.stringify(jeffUser.bizdevSeat || null));

// --- D: the same reads the UI makes ---------------------------
console.log("== D: UI read paths ==");
{
  const ci = await anon("GET", "/api/bdev/claim-info?lead=bgw-williamsburg-dest");
  check("claim-info now names Busch Gardens Williamsburg", ci.status === 200 && ci.data.businessName === "Busch Gardens Williamsburg", JSON.stringify(ci.data).slice(0, 120));
}
const tonyLogin = await TONY.client("POST", "/api/auth/login", { email: "tony@langstondigital.com", password: PW });
check("Tony logs in on his real account", tonyLogin.status === 200, `got ${tonyLogin.status}`);
check("Tony's login payload shows his active seat", !!(tonyLogin.data.user && tonyLogin.data.user.bizdevSeat && tonyLogin.data.user.bizdevSeat.repCode === "HR-TONY"), JSON.stringify(tonyLogin.data.user && tonyLogin.data.user.bizdevSeat));
{
  const r = await TONY.client("GET", "/api/bdev/leads");
  check("Tony's rep book lists 33 leads", r.status === 200 && r.data.leads.length === 33, `got ${r.status}/${r.data.leads && r.data.leads.length}`);
  const terrapin = r.data.leads.find((l) => l.name === "Terrapin Restaurant");
  check("Terrapin is in Tony's list", !!terrapin, "");
  const d = await TONY.client("GET", `/api/bdev/leads/${terrapin.id}`);
  const pb = d.data.lead && d.data.lead.playbook;
  check("lead detail carries the playbook", !!(pb && pb.introEmail && pb.followupEmail), "");
  const intro = (pb && pb.introEmail && pb.introEmail.body) || "";
  const follow = (pb && pb.followupEmail && pb.followupEmail.body) || "";
  check("intro email renders the lead's real claim link", intro.includes(`https://app.magpielocal.com/founding-claim?rep=HR-TONY&lead=${terrapin.id}`), intro.slice(-160));
  check("follow-up email renders the same link (single-brace token)", follow.includes(`https://app.magpielocal.com/founding-claim?rep=HR-TONY&lead=${terrapin.id}`), follow.slice(-160));
  check("no {claimUrl} token survives anywhere in the payload", !JSON.stringify(d.data).includes("{claimUrl}"), "");
  const stored = await store.get(`bdevlead:${terrapin.id}`);
  check("the STORED playbook still holds the token (render-only substitution)", JSON.stringify(stored.playbook).includes("{claimUrl}"), "");
}
{
  const ov = await admin("GET", "/api/admin/bdev/overview");
  check("overview lists both seats", ov.status === 200 && ov.data.reps.length === 2 && ov.data.reps.map((s) => s.repCode).sort().join(",") === "HQ-JEFF,HR-TONY", JSON.stringify(ov.data.reps || []).slice(0, 200));
  const hr = (ov.data.markets || []).find((m) => m.marketId === "hampton-roads");
  const na = (ov.data.markets || []).find((m) => m.marketId === "nashville");
  check("overview counts: Hampton Roads 66 loaded, Nashville 114 (both books, HQ load 2026-11-12)", !!(hr && hr.loaded === 66 && na && na.loaded === 114), `hr=${hr && hr.loaded} na=${na && na.loaded}`);
  const ls = ov.data.loaderStatus || {};
  check("overview surfaces all four loaders done", ["seed155", "enrich157", "destLoad20261109", "jeffSeat161"].every((k) => ls[k] && ls[k].state === "done"), JSON.stringify(ls).slice(0, 300));
  check("Jeff loader recorded its binding (jeff@joinsignl.com)", ls.jeffSeat161 && ls.jeffSeat161.resolvedVia === "email:jeff@joinsignl.com", `via=${ls.jeffSeat161 && ls.jeffSeat161.resolvedVia}`);
}
{
  const vc = await anon("GET", "/api/verify/counts", null, { headers: { "x-signl-verify-token": "fixture-verify-token-167" } });
  check("verify/counts carries the bdev health block", vc.status === 200 && !!vc.data.bdev, `got ${vc.status}`);
  check("health: 2 seats, BGW present", vc.data.bdev && vc.data.bdev.seats === 2 && vc.data.bdev.bgwPresent === true, JSON.stringify(vc.data.bdev).slice(0, 200));
  check("health: lead counts by market", vc.data.bdev && vc.data.bdev.leadsByMarket["hampton-roads"] === 66 && vc.data.bdev.leadsByMarket["nashville"] === 114, JSON.stringify(vc.data.bdev && vc.data.bdev.leadsByMarket));
  check("health: loader states all done", vc.data.bdev && ["seed155", "enrich157", "destLoad20261109", "jeffSeat161"].every((k) => vc.data.bdev.loaderStatus[k] && vc.data.bdev.loaderStatus[k].state === "done"), "");
}
{
  // Jeff's own Sell view of Nashville, through the rep API his
  // client uses — the playbook there must carry HIS rep code.
  const r = await admin("GET", "/api/bdev/leads?mkt=nashville");
  check("Jeff's Nashville book lists 57 through the rep API", r.status === 200 && r.data.leads.length === 57, `got ${r.status}/${r.data.leads && r.data.leads.length}`);
  const first = r.data.leads[0];
  const d = await admin("GET", `/api/bdev/leads/${first.id}?mkt=nashville`);
  const body = (d.data.lead && d.data.lead.playbook && d.data.lead.playbook.introEmail && d.data.lead.playbook.introEmail.body) || "";
  check("Jeff's copy renders the HQ-JEFF claim link", body.includes(`https://app.magpielocal.com/founding-claim?rep=HQ-JEFF&lead=${first.id}`), body.slice(-160));
}

// --- E: idempotency across a fresh process --------------------
console.log("== E: loaders re-run in a fresh process — counts must not move ==");
{
  const child = path.join(os.tmpdir(), `signl-verify-build167-child-${Date.now()}.mjs`);
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
await bizdev.maybeSeedBizdev();
await bizdev.maybeLoadJeffSeat161();
const seats = (await store.list("bdevrep:")).map((r) => r.value).filter((v) => v && v.active);
const leads = (await store.list("bdevlead:")).map((r) => r.value);
const byAssignee = {};
for (const l of leads) byAssignee[l.assignedRepId] = (byAssignee[l.assignedRepId] || 0) + 1;
console.log(JSON.stringify({ seats: seats.length, codes: seats.map((s) => s.repCode).sort(), leads: leads.length, byAssignee, bgwCopies: leads.filter((l) => l.masterId === "bgw-williamsburg-dest").length, bgw: leads.filter((l) => l.id === "bgw-williamsburg-dest").length }));
`);
  const out = execFileSync(process.execPath, [child], { env: { ...process.env }, encoding: "utf8" });
  const snap = JSON.parse(out.trim().split("\n").pop());
  check("re-run: still 2 seats with the same codes", snap.seats === 2 && snap.codes.join(",") === "HQ-JEFF,HR-TONY", JSON.stringify(snap));
  check("re-run: still 180 leads, no duplicates", snap.leads === 180, `got ${snap.leads}`);
  check("re-run: exactly one BGW original + one Jeff copy", snap.bgw === 1 && snap.bgwCopies === 2, JSON.stringify(snap));
  check("re-run: per-book counts unchanged (Tony 90 incl. his Nashville book, Jeff 90)", snap.byAssignee[TONY.id] === 90 && snap.byAssignee[JEFF_ID] === 90, JSON.stringify(snap.byAssignee));
  fs.unlinkSync(child);
}

console.log(`\nverify-build167: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
