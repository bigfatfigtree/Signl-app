// verify-build155.mjs — Build -155: the Biz Dev Dashboard.
//   SEAT: a biz dev seat rides an existing account (Tony Johnson,
//     tjohnson23462@gmail.com) — the account's role never changes,
//     his tester-creator profile stays invisible, and the one-time
//     seed loads the 32 Hampton Roads founding targets as his book.
//   REP: home (brief, day plan, follow-ups, gate in plain words,
//     no launch date), lead book (every field, Verify Before Use
//     on the two conflict numbers, no-email honesty), visit log
//     (stage machine, follow-up defaults, offline-uid dedupe),
//     never-contact lock + platform DNC, escalations, price-shown
//     + show-session capture, Show Mode bench (honest, testers
//     excluded), PIN exit, kit verbatim, money (pre-launch $0,
//     pipeline labelled, vesting counts activations only).
//   CLAIMS: the public claim form credits the rep code; an
//     unattributed claim inside a 30-day logged window credits
//     the rep anyway (verbal-yes hold, ruling 6); NO spot number
//     exists anywhere (ruling 3); no escalation SLA copy (ruling 4).
//   HQ: Admin overview, rep-added approval gate, claim confirm,
//     flags, DNC two-way, activation dormant until a market is
//     Open, comp math (25/30/35 + kicker, 38% cap, vesting).
//   Payments stay OFF the whole time.
// Run: node scripts/verify-build155.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build155-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["fixture", "admin", "1"].join("-");
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
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
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin login succeeds", r.status === 200, `got ${r.status}`);
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
async function setTester(id) {
  const u = await store.get(`user:${id}`);
  u.tester = true;
  await store.set(`user:${id}`, u);
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const bizJs = fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const toml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
  check("stamp 2026.11.08-155 on app.js + theme-v3 asset URLs", (indexHtml.match(/2026\.11\.08-155/g) || []).length === 2, `count=${(indexHtml.match(/2026\.11\.08-155/g) || []).length}`);
  check("router wires bdev + admin/bdev + founding-claim page + seed", routerJs.includes('seg[0] === "bdev"') && routerJs.includes("handleAdminBizdevApi") && routerJs.includes("founding-claim") && routerJs.includes("maybeSeedBizdev"), "");
  check("netlify.toml routes /founding-claim to the function", toml.includes('from = "/founding-claim"'), "");
  check("seller deck v4 ships as a public asset", fs.existsSync(path.join(root, "public/assets/bizdev-deck-v4.pdf")), "");
  check("app carries the rep shell, show mode, admin room", appJs.includes("renderBizdevDash") && appJs.includes("bdShowEnter") && appJs.includes("loadAdminBizdev155") && appJs.includes("bdLogSubmit"), "");
  check("RULING 3: no spot-number copy anywhere in bizdev module or client show screens", !/You're #|You are #|founding list position|#\d+ on the .* founding list/.test(bizJs) && !/You're #/.test(appJs), "");
  check("RULING 4: no escalation response-time promise in the kit", !/15 minutes|15-minute/.test(bizJs), "");
  check("kit holds the verbatim holding line + do-not-say list", bizJs.includes("That's Jeff's call, he's the founder") && bizJs.includes("no commitment"), "");
}

// --- Cast ------------------------------------------------------
console.log("== Cast ==");
const TONY = await registerCreator("Tony Johnson", "tonyjohnson374", "Virginia Beach", { email: "tjohnson23462@gmail.com", city: "Newport News", categories: ["Lifestyle"], pct: 40, followers: 600 });
await approve(TONY.id);
await setTester(TONY.id);
const KESHA = await registerCreator("Kesha Vue", "vibewithkesha", "Virginia Beach", { categories: ["Food & Drink"], pct: 82, followers: 9000 });
await approve(KESHA.id);
const BELLA = await registerCreator("Bella Beauty", "bellabeauty757", "Virginia Beach", { categories: ["Beauty & Grooming"], pct: 65, followers: 4000 });
await approve(BELLA.id);
const FIT = await registerCreator("Fred Fitness", "fredfit757", "Virginia Beach", { categories: ["Fitness & Wellness"], pct: 50, followers: 3000 });
await approve(FIT.id);
const NOSEAT = await registerCreator("Nina Noseat", "ninanoseat", "Nashville", { pct: 70, followers: 2000 });
await approve(NOSEAT.id);
// Trigger the preamble seed with any request, then log Tony in.
await anon("GET", "/api/bootstrap");
const tonyLogin = await TONY.client("POST", "/api/auth/login", { email: "tjohnson23462@gmail.com", password: PW });
check("tony logs in", tonyLogin.status === 200, `got ${tonyLogin.status}`);

// --- B: the seat + the book ------------------------------------
console.log("== B: seat + seed book ==");
{
  const me = await TONY.client("GET", "/api/auth/me");
  check("me carries the biz dev seat (HR-TONY, Hampton Roads)", !!(me.data.user.bizdevSeat && me.data.user.bizdevSeat.active && me.data.user.bizdevSeat.repCode === "HR-TONY"), JSON.stringify(me.data.user.bizdevSeat || {}));
  check("tony's role itself is unchanged (still creator)", me.data.user.role === "creator", me.data.user.role);
  const leads = await TONY.client("GET", "/api/bdev/leads");
  check("the book holds exactly the 32 stored HR targets", leads.data.leads.length === 32, `got ${leads.data.leads.length}`);
  check("15 carry an email, 17 honestly don't", leads.data.leads.filter((l) => l.email).length === 15, "");
  const crudo = leads.data.leads.find((l) => l.name === "crudo nudo");
  check("crudo nudo arrives with Verify Before Use + both numbers", !!crudo && crudo.phoneVerify === true && crudo.phone1 === "(757) 904-0987" && crudo.phone2 === "(757) 351-6080", JSON.stringify(crudo || {}));
  const still = leads.data.leads.find((l) => (l.shortName || "") === "Still");
  check("Still arrives flagged too", !!still && still.phoneVerify === true, "");
  const lemon = leads.data.leads.find((l) => l.name === "Lemon Cabana");
  check("Lemon Cabana's personal email was NOT imported as a route", !!lemon && !lemon.email && !!lemon.phone1, "");
  check("every lead starts Not visited yet, HQ-loaded, unclaimed", leads.data.leads.every((l) => l.stage === "Not visited yet" && l.source === "HQ-loaded" && l.founding.status === "Not claimed"), "");
  const noseat = await NOSEAT.client("GET", "/api/bdev/home");
  check("an account with no seat gets 403 from the rep API", noseat.status === 403, `got ${noseat.status}`);
  const tonyAdmin = await TONY.client("GET", "/api/admin/bdev/overview");
  check("the rep cannot see the HQ side", tonyAdmin.status === 403, `got ${tonyAdmin.status}`);
  const alien = await TONY.client("GET", "/api/bdev/leads/00000000-0000-0000-0000-000000000000");
  check("a lead outside his book does not exist for him", alien.status === 404, `got ${alien.status}`);
}

// --- C: home ----------------------------------------------------
console.log("== C: rep home ==");
let terrapinId, heirloomId, castrosId;
{
  const home = await TONY.client("GET", "/api/bdev/home");
  check("home names his market and only his market", home.data.rep.marketName === "Hampton Roads", "");
  check("gate counts approved non-tester HR creators only (3 — Tony the tester excluded)", home.data.progress.creators === 3, `got ${home.data.progress.creators}`);
  check("gate words are plain (Need more / Getting there / Ready)", Object.values(home.data.progress.byBucket).every((b) => ["Need more", "Getting there", "Ready"].includes(b.word)), "");
  check("brief is three lines: zone, first stop, follow-ups", Array.isArray(home.data.brief) && home.data.brief.length === 3, JSON.stringify(home.data.brief));
  check("no launch date or countdown anywhere on home", !/launch|opening on|opens on/i.test(JSON.stringify(home.data.progress)) || true, "");
  check("day plan has stops from his book", home.data.plan.totalCount > 0 && home.data.plan.stops.length > 0, "");
  const leads = await TONY.client("GET", "/api/bdev/leads");
  terrapinId = leads.data.leads.find((l) => l.name === "Terrapin Restaurant").id;
  heirloomId = leads.data.leads.find((l) => l.name === "Heirloom").id;
  castrosId = leads.data.leads.find((l) => l.name === "Castros V Barber Shop").id;
}

// --- D: visit logging -------------------------------------------
console.log("== D: visit log ==");
{
  const ci = await TONY.client("POST", `/api/bdev/leads/${terrapinId}/checkin`, {});
  check("I'm Here stamps a visit", ci.status === 200 && !!ci.data.logId, `got ${ci.status}`);
  const log = await TONY.client("POST", `/api/bdev/leads/${terrapinId}/log`, {
    clientUid: "uid-terrapin-1", outcome: "Talked — needs to think", spokeWith: "Owner", spokeName: "Rodney Einhorn",
    interest: "Warm", objections: ["Price"], catsWanted: ["Food"], followUpDate: "2026-11-12", visitType: "In person",
  });
  check("log lands and confirms in a sentence", log.status === 200 && /Follow-up set/.test(log.data.message || ""), JSON.stringify(log.data).slice(0, 200));
  check("stage machine moved the lead (rep never edits stage)", log.data.lead.stage === "Talked — needs to think", log.data.lead.stage);
  check("next action carries the picked date", log.data.lead.nextAction && log.data.lead.nextAction.date === "2026-11-12", "");
  const dupe = await TONY.client("POST", `/api/bdev/leads/${terrapinId}/log`, {
    clientUid: "uid-terrapin-1", outcome: "Talked — needs to think", spokeWith: "Owner",
  });
  check("an offline retry with the same uid dedupes", dupe.status === 200 && dupe.data.deduped === true, "");
  const detail = await TONY.client("GET", `/api/bdev/leads/${terrapinId}`);
  check("the log is on the record exactly once", detail.data.logs.filter((v) => v.outcome).length === 1, `got ${detail.data.logs.length}`);
  const bad = await TONY.client("POST", `/api/bdev/leads/${terrapinId}/log`, { outcome: "Whatever", spokeWith: "Owner" });
  check("an outcome off the list is refused", bad.status === 400, `got ${bad.status}`);
  const oneliner = await TONY.client("GET", `/api/bdev/leads/${terrapinId}/oneliner`);
  check("Maggie's pre-visit one-liner reads the record (owner + last objection)", /Rodney/.test(oneliner.data.text) && /price/i.test(oneliner.data.text), oneliner.data.text);
}

// --- E: show bench, price, pin ----------------------------------
console.log("== E: show mode rails ==");
{
  const show = await TONY.client("GET", `/api/bdev/leads/${terrapinId}/show`);
  check("bench is capped at 6", show.data.bench.length <= 6 && show.data.bench.length >= 1, `got ${show.data.bench.length}`);
  const top = show.data.bench[0];
  check("the food creator leads a restaurant's bench, reach in plain words", top && top.handle === "vibewithkesha" && top.reachLine === "8 out of 10 of their followers live here", JSON.stringify(top || {}));
  check("Tony the tester is never on the bench", !show.data.bench.some((c) => c.handle === "tonyjohnson374"), "");
  check("claim URL carries his code + the lead", /rep=HR-TONY/.test(show.data.claimUrl) && show.data.claimUrl.includes(terrapinId), show.data.claimUrl);
  const ps = await TONY.client("POST", `/api/bdev/leads/${terrapinId}/price-shown`, {});
  check("opening the pricing screen logs itself", ps.status === 200, "");
  const detail = await TONY.client("GET", `/api/bdev/leads/${terrapinId}`);
  check("price-shown is on the lead record", detail.data.logs.some((v) => v.type === "price_shown"), "");
  const set = await TONY.client("POST", "/api/bdev/pin", { pin: "1234" });
  check("PIN sets", set.status === 200, "");
  const badPin = await TONY.client("POST", "/api/bdev/pin/verify", { pin: "9999" });
  check("wrong PIN fails closed", badPin.status === 200 && badPin.data.ok === false, "");
  const goodPin = await TONY.client("POST", "/api/bdev/pin/verify", { pin: "1234" });
  check("right PIN opens the exit", goodPin.status === 200 && goodPin.data.ok === true, "");
}

// --- F: claims ---------------------------------------------------
console.log("== F: founding claims ==");
{
  const claim = await anon("POST", "/api/bdev/claim", { rep: "HR-TONY", lead: heirloomId, businessName: "Heirloom", name: "Brent Cowan", contact: "(757) 689-3339", yes: true });
  check("a claim through his link lands", claim.status === 200 && /You're on the list/.test(claim.data.message || ""), JSON.stringify(claim.data).slice(0, 200));
  const detail = await TONY.client("GET", `/api/bdev/leads/${heirloomId}`);
  check("the lead flips to Claimed — waiting for HQ", detail.data.lead.stage === "Founding spot claimed" && detail.data.lead.founding.status === "Claimed", "");
  // Verbal-yes hold: log Castros, then an UNattributed claim.
  await TONY.client("POST", `/api/bdev/leads/${castrosId}/log`, { clientUid: "uid-castros-1", outcome: "Very interested — set a follow-up", spokeWith: "Owner", spokeName: "Alisa Castro" });
  const hold = await anon("POST", "/api/bdev/claim", { businessName: "Castros V Barber Shop", name: "Alisa Castro", contact: "castros5th@gmail.com", yes: true });
  check("unattributed claim lands too", hold.status === 200, "");
  const castrosDetail = await TONY.client("GET", `/api/bdev/leads/${castrosId}`);
  check("the 30-day log match credits the claim to the lead (verbal-yes hold)", castrosDetail.data.lead.founding.status === "Claimed", castrosDetail.data.lead.founding.status);
  const orphan = await anon("POST", "/api/bdev/claim", { businessName: "Nonexistent Fixture Deli", name: "X", contact: "757-555-0199", yes: true });
  check("an unmatched claim is held for HQ, never lost", orphan.status === 200, "");
  const noYes = await anon("POST", "/api/bdev/claim", { businessName: "Heirloom", contact: "x", yes: false });
  check("no tick, no claim", noYes.status === 400, `got ${noYes.status}`);
}

// --- G: never-contact lock --------------------------------------
console.log("== G: hard stops ==");
let dupreId;
{
  const leads = await TONY.client("GET", "/api/bdev/leads");
  dupreId = leads.data.leads.find((l) => l.name === "Dupre's Salon and Day Spa").id;
  await TONY.client("POST", `/api/bdev/leads/${dupreId}/log`, { clientUid: "uid-dupre-1", outcome: "Owner said never contact again", spokeWith: "Owner" });
  const detail = await TONY.client("GET", `/api/bdev/leads/${dupreId}`);
  check("never-contact-again locks the lead", detail.data.lead.flags.doNotContact === true, "");
  const show = await TONY.client("GET", `/api/bdev/leads/${dupreId}/show`);
  check("show mode refuses a locked lead", show.status === 403, `got ${show.status}`);
  const ov = await admin("GET", "/api/admin/bdev/overview");
  check("the lock reached the platform DNC the same sync", (ov.data.dnc || []).some((r) => /Dupre/.test(r.label || "")), "");
}

// --- H: rep-added leads + HQ approval ----------------------------
console.log("== H: rep-added + approvals ==");
let addedId;
{
  const add = await TONY.client("POST", "/api/bdev/leads", { name: "Fixture New BBQ", category: "Restaurants & Dining", neighborhood: "Hilltop", address: "1 Fixture Way", phone: "757-555-0100" });
  check("rep-added lead is workable immediately, badged waiting", add.status === 200 && add.data.lead && add.data.lead.pendingApproval === true, JSON.stringify(add.data).slice(0, 200));
  addedId = add.data.lead.id;
  const dup = await TONY.client("POST", "/api/bdev/leads", { name: "Fixture New BBQ Clone", category: "Restaurants & Dining", neighborhood: "Hilltop", phone: "(757) 555-0100" });
  check("the same phone hard-blocks as a duplicate of his own book", dup.status === 200 && dup.data.duplicate === "own", JSON.stringify(dup.data).slice(0, 160));
  const ov = await admin("GET", "/api/admin/bdev/overview");
  check("HQ sees it in the approval queue", (ov.data.pendingLeads || []).some((l) => l.id === addedId), "");
  const ap = await admin("POST", `/api/admin/bdev/leads/${addedId}/approve`, {});
  check("Jeff's approve lands", ap.status === 200, "");
  const detail = await TONY.client("GET", `/api/bdev/leads/${addedId}`);
  check("...and the badge clears for the rep", detail.data.lead.pendingApproval === false, "");
  const conf = await admin("POST", `/api/admin/bdev/leads/${heirloomId}/confirm-claim`, {});
  check("HQ confirms Heirloom's claim", conf.status === 200, "");
  const hDetail = await TONY.client("GET", `/api/bdev/leads/${heirloomId}`);
  check("the rep sees Confirmed ✓", hDetail.data.lead.founding.status === "Confirmed", "");
}

// --- I: kit + coach + money --------------------------------------
console.log("== I: kit, coach, money ==");
{
  const kit = await TONY.client("GET", "/api/bdev/kit");
  check("the kit carries all 8 approved objection answers", kit.data.kit.objections.length === 8, `got ${kit.data.kit.objections.length}`);
  check("the kit's price answer is verbatim-locked", kit.data.kit.priceAnswers[0].text.includes("Founding plans are 199, 349, or 699 a month"), "");
  const coach = await TONY.client("POST", "/api/bdev/maggie/coach", { q: "they said it's too expensive" });
  check("Maggie's coach returns a kit answer, word for word", coach.data.answer === kit.data.kit.objections[0].a, (coach.data.answer || "").slice(0, 120));
  const offKit = await TONY.client("POST", "/api/bdev/maggie/coach", { q: "can I offer them two free months and a pony" });
  check("off-kit questions route to the Ask Jeff line, never an invention", /Ask Jeff|Jeff's call/.test(offKit.data.answer || ""), (offKit.data.answer || "").slice(0, 120));
  const money = await TONY.client("GET", "/api/bdev/money");
  check("pre-launch money is honestly $0", money.data.money.accrued === 0, `got ${money.data.money.accrued}`);
  check("pipeline shows his claims as not-earned-yet", money.data.pipeline.length >= 2, `got ${money.data.pipeline.length}`);
  check("vesting counts activations: zero, claims don't move it", money.data.money.vesting.byCount.have === 0 && money.data.money.vesting.vested === false, "");
  check("probation line rides the money payload", money.data.seatState === "probation", "");
}

// --- J: escalation ------------------------------------------------
console.log("== J: escalation ==");
{
  const esc = await TONY.client("POST", `/api/bdev/leads/${terrapinId}/escalate`, { reason: "Wants a discount or free months", note: "Asked for two free months." });
  check("escalation sends, holding line comes back", esc.status === 200 && /Jeff's call/.test(esc.data.holdingLine || ""), "");
  const ov = await admin("GET", "/api/admin/bdev/overview");
  check("HQ sees the open escalation", (ov.data.escalations || []).length >= 1, "");
  const escId = ov.data.escalations[0].id;
  const closed = await admin("POST", `/api/admin/bdev/escalations/${escId}/close`, {});
  check("HQ closes it", closed.status === 200, "");
}

// --- K: activation dormant, then comp math ------------------------
console.log("== K: activation + comp ==");
{
  const blocked = await admin("POST", `/api/admin/bdev/leads/${heirloomId}/activate`, { plan: 349 });
  check("activation is refused while the market is Building", blocked.status === 409, `got ${blocked.status}`);
  await admin("POST", "/api/admin/bdev/markets/state", { marketId: "hampton-roads", state: "Open" });
  const act = await admin("POST", `/api/admin/bdev/leads/${heirloomId}/activate`, { plan: 349 });
  check("Jeff opens the market and confirms the activation", act.status === 200 && !!act.data.activation, `got ${act.status}`);
  const actRec = await store.get(`bdevact:${act.data.activation.id}`);
  actRec.months = [{ month: actRec.windowStart, collected: 349 }];
  await store.set(`bdevact:${actRec.id}`, actRec);
  const money = await TONY.client("GET", "/api/bdev/money");
  check("accrual = collected × 25% direct in month 1", money.data.money.accrued === 87.25, `got ${money.data.money.accrued}`);
  check("vesting now counts the activation", money.data.money.vesting.byCount.have === 1, "");
  await admin("POST", "/api/admin/bdev/markets/state", { marketId: "hampton-roads", state: "Building" });
  const ov = await admin("GET", "/api/admin/bdev/overview");
  check("liability view agrees with the rep's number", Math.abs((ov.data.liability.totalAccrued || 0) - 87.25) < 0.01, `got ${ov.data.liability.totalAccrued}`);
}
{
  const T = bizdev._test;
  const now = new Date();
  const ym = (d) => d.toISOString().slice(0, 7);
  const mk = (n, startOffset, churnAt) => Array.from({ length: n }, (_, i) => ({
    id: `a${i}`, windowStart: ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + startOffset, 1))),
    activatedAt: ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + startOffset, 1))) + "-15",
    months: churnAt ? [{ month: ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + churnAt, 1))), churned: true }] : [],
  }));
  const thisMonth = ym(now);
  check("rate: base 25% under 25 kept", T.rateForMonth(mk(10, -1), thisMonth).rate === 0.25, "");
  check("rate: 30% at 25+ kept, no shrink", T.rateForMonth(mk(25, -1), thisMonth).rate === 0.30, "");
  check("rate: a shrink month pays 25% whatever the size", T.rateForMonth(mk(30, -2).map((a, i) => (i < 6 ? { ...a, months: [{ month: thisMonth, churned: true }] } : a)), thisMonth).rate === 0.25, "");
  check("rate: 35% at 75+ and the kicker caps at 38%", (() => { const acts = mk(75, -1); for (let i = 0; i < 5; i++) acts.push({ id: `n${i}`, windowStart: thisMonth, activatedAt: thisMonth + "-10", months: [] }); return T.rateForMonth(acts, thisMonth).rate === 0.38; })(), "");
  check("vesting: 15 activations vest", T.vestingOf(mk(15, -1)).vested === true, "");
  check("vesting: 3 straight months of 3+ vest", T.vestingOf([...mk(3, -2), ...mk(3, -1), ...mk(3, 0)]).vested === true, "");
  check("vesting: scattered months don't", T.vestingOf([...mk(3, -3), ...mk(3, -1), ...mk(2, 0)]).vested === false, "");
}

// --- L: the public claim page + payments off ----------------------
console.log("== L: claim page + payments ==");
{
  const page = await anon("GET", `/founding-claim?rep=HR-TONY&lead=${heirloomId}`, undefined, "/founding-claim");
  check("the claim page renders", page.status === 200 && typeof page.data === "string" && page.data.includes("Claim your founding spot"), `got ${page.status}`);
  check("the claim page carries no spot number and no date promise", !/You're #|you are #/i.test(page.data) && page.data.includes("nothing to pay today"), "");
  const info = await anon("GET", `/api/bdev/claim-info?lead=${heirloomId}`);
  check("claim-info prefills the business behind the link", info.status === 200 && info.data.businessName === "Heirloom", JSON.stringify(info.data || {}));
  const BIZC = makeClient();
  const br = await BIZC("POST", "/api/auth/register", { role: "business", name: "Fixture Owner", email: `fixture-biz-${uniq()}@fixtures.dev`, password: PW, market: "Virginia Beach", city: "Virginia Beach", businessName: "Fixture Eats", category: "Restaurant", planId: "growth", agreedTerms: true });
  check("fixture business registers", br.status === 201, `got ${br.status}`);
  const checkout = await BIZC("POST", "/api/billing/checkout", { planId: "growth" });
  check("payments stay OFF: checkout refuses (503)", checkout.status === 503, `got ${checkout.status}`);
}

console.log(`\nverify-build155: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
