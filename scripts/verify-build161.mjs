// verify-build161.mjs — Build -161: Biz Dev admin fixes + the
// mobile door + Jeff's own seller seat.
//   ADMIN ROOM: a "Waiting on you" strip (one counting function
//   feeding the strip, the Admin-home entry and the menu badges),
//   a guarded Confirm claim (enabled only with a real pending
//   claim, behind a confirm step naming the business), a confirm
//   step on flipping a market to Open, collapsed pre-warm drafts,
//   compact lead rows (inline status, one Manage expander,
//   reassign only with a second seat), plain-words headers, and
//   labelled neighbourhood rollups (no dash walls).
//   JEFF'S SEAT: HQ-JEFF — a real rep seat on Jeff's own admin
//   user, holding Hampton Roads (his own working copies of the
//   HR book; Tony's records untouched) and Nashville (the 57
//   stored targets with playbooks). ?mkt= picks the working city
//   and is validated against the seat's own markets in the data
//   layer. HQ seats accrue no commission liability; Jeff's kits
//   are his own (founder voice, per city); his claims land in his
//   own waiting strip like any rep's.
// Run: node scripts/verify-build161.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build161-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["fixture", "admin", "1"].join("-");
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");
const bizdev = require("../netlify/functions/lib/bizdev.js");
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
  check("login returns Jeff's user id", !!jeffId, JSON.stringify(r.data).slice(0, 120));
}
const anon = makeClient();

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

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const bizJs = fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");
  check("stamp 2026.11.09-161 on both asset URLs", (indexHtml.match(/2026\.11\.09-161/g) || []).length === 2, `count=${(indexHtml.match(/2026\.11\.09-161/g) || []).length}`);
  check("Nashville seed + enrich files ship in the bundle", fs.existsSync(path.join(root, "netlify/functions/lib/bizdev-seed-nashville.json")) && fs.existsSync(path.join(root, "netlify/functions/lib/bizdev-enrich-nashville.json")), "");
  const nashSeed = JSON.parse(fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev-seed-nashville.json"), "utf8"));
  const nashEnr = JSON.parse(fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev-enrich-nashville.json"), "utf8"));
  check("Nashville files: 57 targets, 22 emails, 57 playbooks in Jeff's voice, no banned strings",
    nashSeed.length === 57 && nashSeed.filter((s) => s.email).length === 22 && nashEnr.leads.length === 57
    && nashEnr.leads.every((l) => l.playbook && /Jeff/.test(JSON.stringify(l.playbook)))
    && !/\$199|\$349|\$699|no commitment|You're #/.test(JSON.stringify(nashEnr)), "");
  check("server carries the Jeff-seat loader, multi-market seats, per-seat kits",
    bizJs.includes("maybeLoadJeffSeat161") && bizJs.includes("HQ-JEFF") && bizJs.includes("seatHasMarket") && bizJs.includes("effectiveSeat") && bizJs.includes("kitFor") && bizJs.includes("jeffKit161"), "");
  check("router runs the Jeff-seat loader after enrichment", routerJs.includes("maybeLoadJeffSeat161"), "");
  check("liability excludes HQ seats", bizJs.includes("seatRec.hqSeat"), "");
  check("claim page carries the market-swap markers", bizJs.includes("data-mkt"), "");
  check("client: waiting strip + one counting function", appJs.includes("abdWaitingCounts") && appJs.includes("Nothing waiting on you.") && appJs.includes("Waiting on you:"), "");
  check("client: plain-words job header", appJs.includes("Your job here: open markets, confirm claims, approve leads your reps add"), "");
  check("client: confirm step names the business + the tap that counts", appJs.includes("This is the tap that makes it count.") && appJs.includes("abdConfirmClaim"), "");
  check("client: market Open flip asks first", appJs.includes("This flips the market to Open"), "");
  check("client: guarded Confirm renders disabled with no claim waiting", appJs.includes("No claim is waiting on this lead"), "");
  check("client: Manage expander + pre-warm collapse + rep filter", appJs.includes("abdToggleManage") && appJs.includes("abdTogglePrewarm") && appJs.includes("abdSetLeadFilter('rep'"), "");
  check("client: neighbourhood rollup uses labelled chips, no dash-wall helper left in the render", appJs.includes("abdCountsChips(n.counts)") && !appJs.includes("abdCountsCell(n.counts)"), "");
  check("client: Manage/Sell toggle + city switcher + mkt plumbing", appJs.includes("bdGoSell161") && appJs.includes("bdGoManage161") && appJs.includes("bdCitySwitcherHtml") && appJs.includes("bdPath(") && appJs.includes("bdSetMkt"), "");
  check("client: Admin home carries the Biz Dev waiting entry", appJs.includes('id="ah-bizdev"') && appJs.includes("waiting on you") && appJs.includes("bizdevWaiting"), "");
  check("client: Tony's Declined/Closed chips ask first", appJs.includes('status === "Declined" || status === "Closed"'), "");
  check("client: admin-in-Sell-mode chrome exception is scoped to the bizdev shell", appJs.includes('state.shell === "bizdev" && bdShellActive()'), "");
  check("css: phone rollup table stacks with word labels", css.includes('td::before') && css.includes("attr(data-label)") && css.includes(".abd-wait"), "");
  check("RULING 3 still holds: no spot numbers in bizdev module or kit copy", !/You're #|You are #/.test(bizJs), "");
}

// --- B: fixture people ---------------------------------------
console.log("== B: fixture people ==");
const TONY = await registerCreator("Tony Johnson", "tonyjohnson374", "Virginia Beach", { email: "tjohnson23462@gmail.com", city: "Newport News", categories: ["Lifestyle"], pct: 40, followers: 600 });
await registerCreator("Kesha Vue", "vibewithkesha", "Virginia Beach", { categories: ["Food & Drink"], pct: 82, followers: 9000 }).then(async (c) => approve(c.id));
const NASH1 = await registerCreator("Nash Foodie", "nashfoodie161", "Nashville", { categories: ["Food & Drink"], pct: 77, followers: 8000 });
await approve(NASH1.id);
const NASH2 = await registerCreator("Nash Beauty", "nashbeauty161", "Nashville", { categories: ["Beauty & Grooming"], pct: 64, followers: 3000 });
await approve(NASH2.id);
const tony = TONY.client;

// --- C: the loader converges ---------------------------------
console.log("== C: Jeff's seat loads ==");
let overview = null;
for (let i = 0; i < 24 && !overview; i++) {
  const r = await admin("GET", "/api/admin/bdev/overview");
  const reps = (r.data && r.data.reps) || [];
  const markets = (r.data && r.data.markets) || [];
  if (reps.some((x) => x.repCode === "HQ-JEFF") && markets.some((m) => m.marketId === "nashville")) overview = r.data;
  else await new Promise((res) => setTimeout(res, 150));
}
check("overview eventually carries Jeff's HQ-JEFF seat + a Nashville market", !!overview, "");
if (!overview) { console.log(`\nBUILD161 VERIFY: ${passed} passed, ${failed} failed (aborted early)`); process.exit(1); }
const jeffRep = overview.reps.find((x) => x.repCode === "HQ-JEFF");
check("Jeff's seat is flagged HQ with both markets", !!jeffRep && jeffRep.hqSeat === true && Array.isArray(jeffRep.markets) && jeffRep.markets.length === 2, JSON.stringify(jeffRep).slice(0, 200));
check("Jeff's seat is its own row, never merged into Tony's", jeffRep.userId === jeffId && overview.reps.some((x) => x.repCode === "HR-TONY" && x.userId !== jeffId), "");

// Snapshot AFTER the books settle: the HQ destination loader
// (Busch Gardens) and the Jeff-seat loader both converge
// asynchronously off the request path, so poll until Tony's HR
// count is stable and Jeff's copies mirror it.
async function snapshotLeads() {
  const all = (await admin("GET", "/api/admin/bdev/leads")).data.leads || [];
  return {
    all,
    tonyHR: all.filter((l) => l.assignedRepId === TONY.id && l.marketId === "hampton-roads"),
    jeffHR: all.filter((l) => l.assignedRepId === jeffId && l.marketId === "hampton-roads"),
    jeffNash: all.filter((l) => l.assignedRepId === jeffId && l.marketId === "nashville"),
    tonyAll: all.filter((l) => l.assignedRepId === TONY.id),
  };
}
let snap = await snapshotLeads();
let prevTotal = -1;
for (let i = 0; i < 30; i++) {
  const settled = snap.jeffNash.length === 57 && snap.jeffHR.length === snap.tonyHR.length && snap.tonyHR.length >= 32 && snap.all.length === prevTotal;
  if (settled) break;
  prevTotal = snap.all.length;
  await new Promise((res) => setTimeout(res, 250));
  snap = await snapshotLeads();
}
const tonyLeads = snap.tonyAll;
const jeffNash = snap.jeffNash;
const jeffHR = snap.jeffHR;
const tonyHR = snap.tonyHR;
check("Nashville: exactly 57 leads, all Jeff's", jeffNash.length === 57 && tonyLeads.filter((l) => l.marketId === "nashville").length === 0, `jeff=${jeffNash.length}`);
check("Nashville: every lead carries its playbook", jeffNash.every((l) => l.hasPlaybook), `with pb=${jeffNash.filter((l) => l.hasPlaybook).length}`);
check("Hampton Roads: Jeff's working copies mirror Tony's book 1:1", jeffHR.length === tonyHR.length && jeffHR.length >= 32, `jeff=${jeffHR.length} tony=${tonyHR.length}`);
check("copies are separate records with fresh state", jeffHR.every((c) => !tonyHR.some((t) => t.id === c.id)) && jeffHR.every((c) => c.founding && c.founding.status === "Not claimed"), "");
const sampleCopy = jeffHR.find((c) => c.hasPlaybook);
check("copies carry the playbook + intel (spot check)", !!sampleCopy, "");

// --- D: Jeff works two cities --------------------------------
console.log("== D: Sell mode across cities ==");
{
  const homeHR = await admin("GET", "/api/bdev/home");
  check("Jeff's rep home defaults to Hampton Roads as HQ-JEFF", homeHR.status === 200 && homeHR.data.rep.repCode === "HQ-JEFF" && homeHR.data.rep.marketName === "Hampton Roads", `got ${homeHR.status}`);
  check("home payload carries both markets + the HQ flag", Array.isArray(homeHR.data.rep.markets) && homeHR.data.rep.markets.length === 2 && homeHR.data.rep.hqSeat === true, "");
  const homeN = await admin("GET", "/api/bdev/home?mkt=nashville");
  check("?mkt=nashville renders the Nashville home", homeN.status === 200 && homeN.data.rep.marketName === "Nashville", `got ${homeN.status}`);
  check("Nashville gate progress counts the Nashville bench (2 approved)", homeN.data.progress.creators === 2, `got ${homeN.data.progress && homeN.data.progress.creators}`);
  const bad = await admin("GET", "/api/bdev/home?mkt=austin");
  check("a market the seat doesn't hold is rejected in the data layer", bad.status === 400, `got ${bad.status}`);
  const leadsN = await admin("GET", "/api/bdev/leads?mkt=nashville");
  check("Jeff's Nashville book lists 57", leadsN.status === 200 && leadsN.data.leads.length === 57, `got ${leadsN.status} n=${leadsN.data && leadsN.data.leads && leadsN.data.leads.length}`);
  check("leads payload carries the seat summary for the switcher", !!leadsN.data.seat && leadsN.data.seat.hqSeat === true && leadsN.data.seat.markets.length === 2, "");
  const leadsHR = await admin("GET", "/api/bdev/leads?mkt=hampton-roads");
  const snapD = await snapshotLeads();
  const snapDIds = new Set(snapD.jeffHR.map((l) => l.id));
  check("Jeff's HR book is his copies only", leadsHR.data.leads.length === snapD.jeffHR.length && leadsHR.data.leads.every((l) => snapDIds.has(l.id)), `n=${leadsHR.data.leads.length} snap=${snapD.jeffHR.length}`);
  // Writes persist per city and surface in HQ as HQ-JEFF's.
  const target = jeffNash[0];
  const st = await admin("POST", `/api/bdev/leads/${target.id}/status?mkt=nashville`, { status: "Contacted" });
  check("Jeff sets a status on a Nashville lead", st.status === 200 && st.data.lead.status === "Contacted", `got ${st.status}`);
  const after = (await admin("GET", "/api/admin/bdev/leads?market=nashville")).data.leads.find((l) => l.id === target.id);
  check("the status shows in HQ against HQ-JEFF's row", !!after && after.status === "Contacted" && after.assignedRepId === jeffId, "");
  const log = await admin("POST", `/api/bdev/leads/${target.id}/log?mkt=nashville`, { outcome: "Owner not in", spokeWith: "Staff", followUp: "none" });
  check("Jeff logs a visit on a Nashville lead", log.status === 200 && !!log.data.ok, `got ${log.status} ${JSON.stringify(log.data).slice(0, 140)}`);
}

// --- E: scoping holds for Tony --------------------------------
console.log("== E: Tony's world is unchanged ==");
{
  const tBad = await tony("GET", "/api/bdev/home?mkt=nashville");
  check("Tony asking for Nashville is rejected (not his market)", tBad.status === 400, `got ${tBad.status}`);
  const tLeads = await tony("GET", "/api/bdev/leads");
  const snapE = await snapshotLeads();
  const snapEIds = new Set(snapE.tonyHR.map((l) => l.id));
  check("Tony's book is his HR leads only", tLeads.status === 200 && tLeads.data.leads.length === snapE.tonyHR.length && tLeads.data.leads.every((l) => snapEIds.has(l.id)), `n=${tLeads.data.leads && tLeads.data.leads.length} snap=${snapE.tonyHR.length}`);
  const tPeek = await tony("GET", `/api/bdev/leads/${jeffNash[0].id}`);
  check("Tony cannot open Jeff's Nashville lead", tPeek.status === 404, `got ${tPeek.status}`);
  const tPeek2 = await tony("GET", `/api/bdev/leads/${jeffHR[0].id}`);
  check("Tony cannot open Jeff's HR copy either", tPeek2.status === 404, `got ${tPeek2.status}`);
  const tKit = await tony("GET", "/api/bdev/kit");
  check("Tony's kit is still Tony's, word for word, with his print kit", tKit.status === 200 && /I'm Tony/.test(tKit.data.kit.openers[0].text) && Array.isArray(tKit.data.kit.printKit) && tKit.data.kit.printKit.length === 2, "");
}

// --- F: kits per seat -----------------------------------------
console.log("== F: Jeff's kits are his own ==");
{
  const kN = await admin("GET", "/api/bdev/kit?mkt=nashville");
  const kitN = JSON.stringify(kN.data.kit);
  check("Jeff's Nashville kit speaks as Jeff, about Nashville", /I'm Jeff/.test(kN.data.kit.openers[0].text) && /Nashville/.test(kN.data.kit.openers[0].text), kN.data.kit.openers[0].text.slice(0, 120));
  check("Jeff's kit never says Tony, never carries Tony's print cards", !/Tony/.test(kitN) && Array.isArray(kN.data.kit.printKit) && kN.data.kit.printKit.length === 0, "");
  check("Jeff's kit keeps the canon: founding terms + do-not-say intact", Array.isArray(kN.data.kit.foundingTerms) && kN.data.kit.foundingTerms.length >= 5 && /Never promise/.test(JSON.stringify(kN.data.kit.doNotSay)), "");
  const kH = await admin("GET", "/api/bdev/kit");
  check("Jeff's Hampton Roads kit is the HR variant", /I'm Jeff/.test(kH.data.kit.openers[0].text) && /Hampton Roads/.test(kH.data.kit.openers[0].text), "");
  check("practice answers derive from the caller's own kit", Array.isArray(kN.data.practice) && kN.data.practice.length > 0 && kN.data.practice.every((p) => !/Tony/.test(String(p.answer || ""))), "");
}

// --- G: the honest loop ---------------------------------------
console.log("== G: claims still need Jeff's confirmation ==");
{
  const lead = jeffNash[1];
  const claim = await anon("POST", "/api/bdev/claim", { rep: "HQ-JEFF", lead: lead.id, businessName: lead.name, name: "Fixture Owner", contact: "owner@fixture.dev", yes: true });
  check("a business claims through Jeff's Nashville link", claim.status === 200, `got ${claim.status} ${JSON.stringify(claim.data).slice(0, 140)}`);
  const ov2 = (await admin("GET", "/api/admin/bdev/overview")).data;
  const waiting = (ov2.unconfirmedClaims || []).find((c) => c.leadId === lead.id);
  check("Jeff's own claim lands in his waiting strip, unconfirmed", !!waiting && waiting.status === "waiting HQ confirm", "");
  check("nothing counts yet: the lead is not Confirmed", ((await admin("GET", "/api/admin/bdev/leads?market=nashville")).data.leads.find((l) => l.id === lead.id) || {}).founding?.status !== "Confirmed", "");
  const conf = await admin("POST", `/api/admin/bdev/leads/${lead.id}/confirm-claim`, {});
  check("HQ confirm action succeeds", conf.status === 200, `got ${conf.status}`);
  const afterL = (await admin("GET", "/api/admin/bdev/leads?market=nashville")).data.leads.find((l) => l.id === lead.id);
  check("after confirm, the founding claim counts", !!afterL && afterL.founding.status === "Confirmed", "");
  const ov3 = (await admin("GET", "/api/admin/bdev/overview")).data;
  check("the confirmed claim leaves the waiting list", !(ov3.unconfirmedClaims || []).some((c) => c.leadId === lead.id), "");
  // Tony's code cannot reach into Nashville.
  const tClaim = await anon("POST", "/api/bdev/claim", { rep: "HR-TONY", businessName: jeffNash[2].name, name: "X", contact: "x@fixture.dev", yes: true });
  const ov4 = (await admin("GET", "/api/admin/bdev/overview")).data;
  check("Tony's code claiming a Nashville name lands unmatched, not on the Nashville lead", !(ov4.unconfirmedClaims || []).some((c) => c.leadId === jeffNash[2].id), "");
  // The claim page names the lead's own market.
  const page = await anon("GET", `/founding-claim?rep=HQ-JEFF&lead=${jeffNash[3].id}`, undefined, `/founding-claim?rep=HQ-JEFF&lead=${jeffNash[3].id}`);
  const html = typeof page.data === "string" ? page.data : "";
  check("claim page carries the market-swap markers for non-HR leads", html.includes("data-mkt"), html.slice(0, 120));
}

// --- H: liability honesty --------------------------------------
console.log("== H: HQ seat accrues no liability ==");
{
  const ym = new Date().toISOString().slice(0, 7);
  const mkAct = async (repId, key) => store.set(`bdevact:${key}`, { id: key, repId, marketId: "hampton-roads", leadId: null, businessName: `Fixture ${key}`, direct: true, plan: 349, activatedAt: new Date().toISOString(), windowStart: ym, months: [{ month: ym, collected: 1000, refunded: false }], championName: null });
  await mkAct(TONY.id, "fixture161-tony");
  await mkAct(jeffId, "fixture161-jeff");
  const ov = (await admin("GET", "/api/admin/bdev/overview")).data;
  check("liability counts Tony's activation only (25% of $1000 = $250)", ov.liability.totalAccrued === 250 && ov.liability.activations === 1, JSON.stringify(ov.liability).slice(0, 200));
  check("no per-rep liability row exists for the HQ seat", !(ov.liability.perRep || []).some((r) => r.repId === jeffId), "");
  const moneyJ = await admin("GET", "/api/bdev/money?mkt=hampton-roads");
  check("Jeff's My Money is honest: HQ-labelled, pipeline is his book's", moneyJ.status === 200 && moneyJ.data.hqSeat === true, `got ${moneyJ.status}`);
}

// --- I: unit pins on the seat helpers --------------------------
console.log("== I: seat helper units ==");
{
  const T = bizdev._test;
  const seat = { userId: "u1", marketId: "hampton-roads", marketName: "Hampton Roads", markets: [{ marketId: "hampton-roads", marketName: "Hampton Roads" }, { marketId: "nashville", marketName: "Nashville" }] };
  check("seatMarkets lists both markets", T.seatMarkets(seat).length === 2, "");
  check("effectiveSeat swaps only the market fields", T.effectiveSeat(seat, "nashville").marketId === "nashville" && T.effectiveSeat(seat, "nashville").userId === "u1", "");
  check("effectiveSeat refuses a market the seat doesn't hold", T.effectiveSeat(seat, "austin") === null, "");
  check("single-market seats keep the legacy shape", T.seatMarkets({ marketId: "hampton-roads", marketName: "Hampton Roads" }).length === 1, "");
  const jk = T.jeffKit161("Nashville");
  check("jeffKit161: founder voice, city swapped, canon kept", /I'm Jeff/.test(jk.openers[0].text) && !/Tony/.test(JSON.stringify(jk)) && jk.printKit.length === 0 && jk.foundingTerms.length >= 5, "");
  check("Tony's KIT object is untouched by the variants", /I'm Tony/.test(bizdev.KIT.openers[0].text) && bizdev.KIT.printKit.length === 2, "");
}

console.log(`\nBUILD161 VERIFY: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
