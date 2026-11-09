// verify-build156.mjs — Build -156: The Neighbor Number.
//   HOOK: a claim landing with a checked record (followers +
//     numeric local %) leads with the creator's own counted
//     neighbors, her local % in plain words, her founding rank
//     with the honest checked denominator, and an inversion ONLY
//     where a real checked creator has more followers but fewer
//     neighbors. No numeric rate on file -> the generic line,
//     never an inferred number.
//   MATH: the canon local-follower model — follower-weighted
//     over rated platforms only; the hero count extrapolates the
//     confirmed rate across unrated platforms and is labelled
//     "total potential neighbors" when any part is extrapolated.
//   CLAIM: the founding rank locks at claim (never moves); the
//     live rank keeps updating as the checked set grows. Stack
//     adds post-claim, card generations/shares and hook views /
//     conversions land in the captures feed.
//   SHOW MODE: area framing only where stored bench facts match
//     the business's own city/neighborhood; otherwise the bench
//     is exactly Build -155's. Payments stay OFF (checkout 503).
// Run: node scripts/verify-build156.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build156-${Date.now()}.json`);
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
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
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
    bio: "Fixture creator.", ...AGREE,
  });
  if (r.status !== 201) throw new Error("creator register failed: " + JSON.stringify(r.data));
  return { client: c, email, id: r.data.user.id, handle };
}
async function approve(id) {
  const r = await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  if (r.status !== 200) throw new Error("approve failed: " + JSON.stringify(r.data));
}
async function eventsOf(type) {
  return (await store.list("event:")).map((r) => r.value).filter((e) => e && e.type === type);
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const bizJs = fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("stamp 2026.11.09-156 on both asset URLs", (indexHtml.match(/2026\.11\.09-156/g) || []).length === 2, `count=${(indexHtml.match(/2026\.11\.09-156/g) || []).length}`);
  check("router carries the claim-hook route + checked set + claim-complete", routerJs.includes('"claim-hook"') && routerJs.includes("checkedNeighborSet") && routerJs.includes("claim-complete") && routerJs.includes("neighbor_stack_added"), "");
  check("client carries the hook screen, spot CTA, live stack panel and card", appJs.includes("renderClaimHook") && appJs.includes("Claim my #") && appJs.includes("neighborStackAdd") && appJs.includes("neighborCardSave") && appJs.includes("Want to climb?"), "");
  check("founding vs live labels are distinct in the client", appJs.includes("Founding rank") && appJs.includes("Live rank today"), "");
  check("bizdev show bench carries honest area framing only", bizJs.includes("areaFraming") && !/within 2 miles|under 2 miles/i.test(bizJs), "");
}

// --- Cast: Nashville checked set -------------------------------
// Big Famous: 90,000 followers, 10% local -> 9,000 neighbors.
// Local Hero: 10,000 followers, 80% local -> 8,000 neighbors.
// Tara Target (prospect, checked): 12,000 followers, 85% local
//   -> 10,200 neighbors: fewer followers than Big, MORE neighbors.
console.log("== Cast ==");
const BIG = await registerCreator("Big Famous", "bigfamous", "Nashville", { followers: 90000, pct: 10 });
const HERO = await registerCreator("Local Hero", "localhero", "Nashville", { followers: 10000, pct: 80 });
await store.set("prospect:fixture-target", {
  id: "fixture-target", marketName: "Nashville", marketId: "nashville", recruiterId: "seat:nashville",
  name: "Tara Target", handle: "targetcreator", instagramHandle: "targetcreator", tiktokHandle: "",
  email: "", category: "Food & Drink", followers: 12000, localPct: 85, followersPlatform: "instagram",
  city: "Nashville", source: "fixture", status: "to_contact", sends: [], linkedUserId: null,
});
await store.set("prospect:fixture-narrative", {
  id: "fixture-narrative", marketName: "Nashville", marketId: "nashville", recruiterId: "seat:nashville",
  name: "Nina Narrative", handle: "narrativeonly", instagramHandle: "narrativeonly", tiktokHandle: "",
  email: "", category: "Lifestyle", followers: 5000, localPct: null, followersPlatform: "instagram",
  city: "Nashville", source: "fixture", status: "to_contact", sends: [], linkedUserId: null,
});

// --- B: the personal hook --------------------------------------
console.log("== B: personal hook ==");
{
  const r = await anon("GET", "/api/claim-hook?handle=targetcreator&market=Nashville");
  const h = r.data.hook || {};
  check("known checked handle gets the personal variant", r.status === 200 && h.variant === "personal", JSON.stringify(r.data).slice(0, 200));
  check("neighbor math: 12,000 x 85% = 10,200", h.neighborCount === 10200, `got ${h.neighborCount}`);
  check("local % rides along (85)", h.localPct === 85, `got ${h.localPct}`);
  check("local % in plain words (9 out of 10)", h.localWords === "9 out of 10 of your followers live here", h.localWords);
  check("rank is by neighbors, not followers: #1", h.rank === 1, `got ${h.rank}`);
  check("denominator is the truthful checked count (3)", h.checkedCount === 3, `got ${h.checkedCount}`);
  check("rank line states its scope", h.rankLine === "#1 of the 3 Nashville creators we've checked so far", h.rankLine);
  check("inversion names the real bigger-follower / fewer-neighbor account", !!h.inversion && h.inversion.handle === "bigfamous" && h.inversion.followers === 90000 && h.inversion.neighborCount === 9000, JSON.stringify(h.inversion || {}));
  check("no extrapolation on a single-rate record", h.extrapolated === false, "");
  const hero = await anon("GET", "/api/claim-hook?handle=localhero&market=Nashville");
  check("hero ranks #3 by neighbors despite 10k followers", hero.data.hook.rank === 3 && hero.data.hook.neighborCount === 8000, JSON.stringify(hero.data.hook || {}));
  check("no inversion for the hero (nobody bigger has fewer neighbors... except Big: 90k followers, 9,000 neighbors is MORE)", hero.data.hook.inversion === null, JSON.stringify(hero.data.hook.inversion));
}

// --- C: generic where the number is not computed ---------------
console.log("== C: generic variant ==");
{
  const narr = await anon("GET", "/api/claim-hook?handle=narrativeonly&market=Nashville");
  check("a narrative-only prospect (no numeric local %) gets the generic line", narr.data.hook.variant === "generic" && narr.data.hook.genericLine === "On Magpie, 800 followers who live here beats 90,000 followers who don't.", JSON.stringify(narr.data.hook || {}));
  check("generic carries no invented number, rank or inversion", narr.data.hook.neighborCount === undefined && narr.data.hook.rank === undefined && narr.data.hook.inversion === undefined, "");
  const unknown = await anon("GET", "/api/claim-hook?handle=neverheardofher&market=Nashville");
  check("unknown handle gets the generic variant", unknown.data.hook.variant === "generic", "");
  const views = await eventsOf("claim_hook_view");
  check("hook views are captured, split by variant", views.some((e) => e.data && e.data.variant === "personal") && views.some((e) => e.data && e.data.variant === "generic"), `got ${views.length}`);
}

// --- D: extrapolation labelling ---------------------------------
console.log("== D: extrapolation ==");
{
  const AX = await registerCreator("Austin Extra", "austinextra", "Austin", { followers: 1000, pct: 50 });
  const u = await store.get(`user:${AX.id}`);
  u.creator.audienceStack = { instagram: 1000, tiktok: 1000 };
  u.creator.platformLocalPct = { instagram: 50 };
  u.creator.totalAudience = 2000;
  await store.set(`user:${AX.id}`, u);
  const r = await anon("GET", "/api/claim-hook?handle=austinextra&market=Austin");
  const h = r.data.hook || {};
  check("hero count extrapolates the confirmed 50% across the unrated platform (2,000 x 50% = 1,000)", h.neighborCount === 1000, `got ${h.neighborCount}`);
  check("any extrapolated part flags the count as potential", h.extrapolated === true, "");
  check("a one-creator checked set reads #1 of 1", h.rank === 1 && h.checkedCount === 1, JSON.stringify(h));
}

// --- E: claim locks the founding rank; the live rank moves -----
console.log("== E: claim + founding lock + live rank ==");
let tara;
{
  const c = makeClient();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "tara@fixtures.dev", password: PW,
    market: "Nashville", handle: "targetcreator", ...AGREE,
  });
  check("quick claim registers", reg.status === 201, JSON.stringify(reg.data).slice(0, 200));
  const patch = await c("PATCH", "/api/me/profile", { city: "Nashville", categories: ["Food & Drink"], localAudiencePct: 85, audienceStack: { instagram: 12000 } });
  check("the claim facts land", patch.status === 200, JSON.stringify(patch.data).slice(0, 200));
  const done = await c("POST", "/api/neighbor/claim-complete", { variant: "personal" });
  const nb = done.data.neighbor || {};
  tara = { client: c, id: reg.data.user.id };
  check("claim-complete returns her number (10,200)", nb.neighborCount === 10200, `got ${nb.neighborCount}`);
  check("founding rank locks at #1 of 3", !!nb.founding && nb.founding.rank === 1 && nb.founding.checkedCount === 3, JSON.stringify(nb.founding || {}));
  check("live rank starts at the same place", nb.liveRank === 1 && nb.liveCheckedCount === 3, JSON.stringify(nb));
  const conv = await eventsOf("claim_hook_converted");
  check("the conversion is captured once, personal variant", conv.filter((e) => e.subjectId === tara.id).length === 1 && conv[0].data.variant === "personal", `got ${conv.length}`);
  const done2 = await c("POST", "/api/neighbor/claim-complete", { variant: "personal" });
  check("a second claim-complete never re-locks or double-logs", done2.data.neighbor.founding.rank === 1 && (await eventsOf("claim_hook_converted")).filter((e) => e.subjectId === tara.id).length === 1, "");
  // A bigger neighbor arrives: the live rank must move, the founding rank must not.
  await registerCreator("New Neighbor", "newneighbor", "Nashville", { followers: 20000, pct: 90 });
  const me = await c("GET", "/api/neighbor/me");
  const mv = me.data.neighbor || {};
  check("live rank moves as the checked set grows (#2 of 4)", mv.liveRank === 2 && mv.liveCheckedCount === 4, JSON.stringify(mv));
  check("founding rank stays locked (#1 of 3)", !!mv.founding && mv.founding.rank === 1 && mv.founding.checkedCount === 3, JSON.stringify(mv.founding || {}));
}

// --- F: stack adds + card captures ------------------------------
console.log("== F: stack + card captures ==");
{
  const before = (await eventsOf("neighbor_stack_added")).length;
  const patch = await tara.client("PATCH", "/api/me/profile", { audienceStack: { instagram: 12000, tiktok: 5000 } });
  check("post-claim stack add saves", patch.status === 200, "");
  const adds = await eventsOf("neighbor_stack_added");
  check("the stack add is captured with its platform", adds.length === before + 1 && adds[adds.length - 1].data.platform === "tiktok", `got ${adds.length - before}`);
  const me = await tara.client("GET", "/api/neighbor/me");
  check("her number recounts after the stack (17,000 x 85% = 14,450)", me.data.neighbor.neighborCount === 14450, `got ${me.data.neighbor.neighborCount}`);
  const gen = await tara.client("POST", "/api/neighbor/card-event", { action: "generated" });
  const shr = await tara.client("POST", "/api/neighbor/card-event", { action: "shared" });
  check("card generation + share are captured", gen.status === 200 && shr.status === 200 && (await eventsOf("neighbor_card_generated")).length >= 1 && (await eventsOf("neighbor_card_shared")).length >= 1, "");
}

// --- G: Show Mode area framing (honest subset) ------------------
console.log("== G: show mode area framing ==");
{
  const TONY = await registerCreator("Tony Johnson", "tonyjohnson374", "Virginia Beach", { email: "tjohnson23462@gmail.com", city: "Newport News", categories: ["Lifestyle"], pct: 40, followers: 600 });
  await approve(TONY.id);
  const tu = await store.get(`user:${TONY.id}`);
  tu.tester = true;
  await store.set(`user:${TONY.id}`, tu);
  const KESHA = await registerCreator("Kesha Vue", "vibewithkesha", "Virginia Beach", { categories: ["Food & Drink"], pct: 82, followers: 9000 });
  await approve(KESHA.id);
  await anon("GET", "/api/bootstrap");
  const login = await TONY.client("POST", "/api/auth/login", { email: "tjohnson23462@gmail.com", password: PW });
  check("tony logs in", login.status === 200, `got ${login.status}`);
  const leads = await TONY.client("GET", "/api/bdev/leads");
  const terrapin = leads.data.leads.find((l) => l.name === "Terrapin Restaurant");
  const still = leads.data.leads.find((l) => (l.shortName || "") === "Still");
  const showT = await TONY.client("GET", `/api/bdev/leads/${terrapin.id}/show`);
  const keshaCard = (showT.data.bench || []).find((c) => c.handle === "vibewithkesha");
  check("a bench creator based in the business's own city is labelled as such", !!keshaCard && keshaCard.areaLine === "Based in Virginia Beach", JSON.stringify(keshaCard || {}));
  check("area framing combines the in-area neighbors (9,000 x 82% = 7,380)", !!showT.data.areaFraming && showT.data.areaFraming.label === "Virginia Beach" && showT.data.areaFraming.combinedNeighbors === 7380, JSON.stringify(showT.data.areaFraming || {}));
  const showS = await TONY.client("GET", `/api/bdev/leads/${still.id}/show`);
  check("no stored area match -> no framing, bench exactly as -155", showS.data.areaFraming === null && (showS.data.bench || []).every((c) => !c.areaLine), JSON.stringify(showS.data.areaFraming));
  check("no proximity claim is made anywhere in the show payload", !/within 2 miles|under 2 miles|miles away/i.test(JSON.stringify(showT.data)), "");
}

// --- H: payments stay OFF ---------------------------------------
console.log("== H: payments off ==");
{
  const biz = makeClient();
  const reg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Fixture Owner", email: `biz-${uniq()}@fixtures.dev`, password: PW, market: "Nashville",
    businessName: "Fixture Foods", category: "Restaurant", planId: "growth", city: "Nashville", agreedTerms: true,
  });
  const checkout = await biz("POST", "/api/billing/checkout", { planId: "growth" });
  check("payments stay OFF: checkout refuses (503)", checkout.status === 503, `got ${checkout.status} (register ${reg.status})`);
}

console.log(`\nBuild -156 verify: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
