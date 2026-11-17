#!/usr/bin/env node
// verify-build191.mjs — Build -191: PL-17, the national publish
// staging gate (Jeff's ruling 2026-11-17 07:14 ET).
//   - Stored Admin setting (config:nationalPublishGate), default
//     ON; Admin can release and re-arm it with no code change.
//   - Effective gate = stored ON AND no market live (raw
//     config:markets flags, the existing marketLive record).
//   - Gate on: a fully-gated national publish lands in
//     "awaiting_release", invisible in every creator feed and
//     ineligible for hand-raises (the status fence), present in
//     the Admin release queue; the brand sees its true state.
//   - Admin release -> open, visible to approved+finished
//     creators only. Send back -> draft with a brand-visible note.
//   - Gate off (Admin toggle OR any market live): publish goes
//     straight to open. Re-arming never pulls an open campaign back.
//   - Market-business offers are unaffected in every gate state.
// Run: node scripts/verify-build191.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = path.join(os.tmpdir(), `signl-verify-build191-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = ["verify191", "admin", "pw"].join("-");
const PW = ["verify191", "user", "pw"].join("-");
process.env.ADMIN_PASSWORD = ADMIN_PW;
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const auth = require("../netlify/functions/lib/auth.js");
const national = require("../netlify/functions/lib/national.js");
const { handler } = require("../netlify/functions/api.js");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log("  ok  " + name); }
  else { failed += 1; failures.push(name + (extra ? " :: " + extra : "")); console.log("  FAIL  " + name + (extra ? " :: " + extra : "")); }
}
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({ httpMethod: method, path: url.pathname, headers, queryStringParameters: Object.fromEntries(url.searchParams.entries()), body: body === undefined ? null : JSON.stringify(body), isBase64Encoded: false });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let parsed = null;
    try { parsed = JSON.parse(res.body || "null"); } catch (e) { /* raw */ }
    return { status: res.statusCode, data: parsed, raw: res.body || "" };
  };
}
const seg = (src, a, b) => { const i = src.indexOf(a); if (i < 0) return ""; const j = b ? src.indexOf(b, i + a.length) : -1; return src.slice(i, j > i ? j : undefined); };

// ---------------- source pins ----------------
console.log("== source pins ==");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const natJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/national.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const themeCss = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");
check("stamp: BUILD_ID is 2026.11.17-191", buildJs.includes('exports.BUILD_ID = "2026.11.17-191"'));
check("stamp: shell carries 2026.11.17-191 x5", (indexHtml.match(/2026\.11\.17-191/g) || []).length === 5);
check("gate: stored record key is config:nationalPublishGate", natJs.includes('NATIONAL_PUBLISH_GATE_KEY = "config:nationalPublishGate"'));
check("gate: no code constant decides the hold (state reads the store)", natJs.includes("getNationalPublishGateRecord") && natJs.includes("await store.get(NATIONAL_PUBLISH_GATE_KEY)"));
check("gate: effective rule is stored ON AND no market live", natJs.includes("const effectiveOn = storedOn && !anyLive"));
check("gate: awaiting status is the distinct awaiting_release", natJs.includes('AWAITING_RELEASE_STATUS = "awaiting_release"'));
check("gate: the feed fence excludes it by status alone", seg(natJs, "function campaignVisibleToCreator", "function campaignHiddenReason").includes('campaign.status !== "open"'));
check("brand: the awaiting state line is the plain-words line", natJs.includes("With Magpie for review. Your campaign is not visible to creators yet.") && appJs.includes("Your campaign is not visible to creators yet."));
check("admin UI: the hold panel is plainly labeled", appJs.includes("National publishing hold") && appJs.includes("Waiting for release") && appJs.includes("adminNatRelease191") && appJs.includes("adminNatSendBack191"));
check("admin UI: released-by-launch is surfaced truthfully", appJs.includes("Released by launch. A market is live"));
check("admin UI: re-arm never pulls back copy is present", appJs.includes("never pulls back a campaign that is already open"));
check("css: queue + held state are designed surfaces", themeCss.includes(".nat-queue-row191") && themeCss.includes(".nat-held191") && themeCss.includes(".nat-queue-empty191"));
check("no em dashes in the new user-facing gate copy", !seg(natJs, "AWAITING_RELEASE_LINE", "async function anyMarketLiveByFlag").includes("—") && !seg(appJs, "function adminNatGateHtml191", "function natSubmittedLabel191").includes("—"));

// ---------------- unit: the gate state machine ----------------
console.log("== unit: gate state ==");
{
  const s0 = await national.nationalPublishGateState({});
  check("unit: absent record defaults to holding (pre-launch)", s0.storedOn === true && s0.effectiveOn === true && s0.isDefault === true, JSON.stringify(s0));
  check("unit: fence excludes awaiting_release for a perfect trio", national.campaignVisibleToCreator(
    { status: "awaiting_release" },
    { role: "business", status: "approved", business: { scope: "national", verifiedAt: "2026-11-17T00:00:00.000Z" } },
    { role: "creator", status: "approved" },
    { profileCompleteOf: () => true, isTester: () => false }) === false);
  await national.setNationalPublishGate(false, "unit", () => "2026-11-17T12:00:00.000Z");
  const rec = await store.get("config:nationalPublishGate");
  check("unit: flipping the stored record flips the gate with no code change", rec.hold === false && rec.state === "off");
  const s1 = await national.nationalPublishGateState({});
  check("unit: stored off reads off", s1.storedOn === false && s1.effectiveOn === false, JSON.stringify(s1));
  await national.setNationalPublishGate(true, "unit", () => "2026-11-17T12:01:00.000Z");
  const s2 = await national.nationalPublishGateState({ anyMarketLiveByFlag: async () => true });
  check("unit: stored on + a live market = released by launch", s2.storedOn === true && s2.anyMarketLive === true && s2.effectiveOn === false && s2.releasedByLaunch === true, JSON.stringify(s2));
  await store.del("config:nationalPublishGate");
}

// ---------------- fixtures ----------------
console.log("== fixtures ==");
async function user(id, role, name, email, extra = {}) {
  const { salt, hash } = auth.hashPassword(PW);
  const rec = { id, role, name, email, passwordSalt: salt, passwordHash: hash, status: "approved", createdAt: "2026-11-10T00:00:00.000Z", ...extra };
  await store.set(`user:${id}`, rec);
  await store.set(`email:${email}`, { userId: id });
  return rec;
}
await user("v191-admin", "admin", "Jeff Rimmer", "jeff@joinsignl.com");
{ const h = auth.hashPassword(ADMIN_PW); const a = await store.get("user:v191-admin"); a.passwordSalt = h.salt; a.passwordHash = h.hash; await store.set("user:v191-admin", a); }
await user("v191-brand", "business", "Brand Owner", "brand191@fixtures.dev", {
  market: "National", city: "",
  business: { scope: "national", businessName: "Fixture Brand Co", brandName: "Fixture Brand", category: "Other", website: "https://fixturebrand.example.com", logoUrl: "https://fixturebrand.example.com/logo.png", brandAbout: "We make fixture things.", about: "We make fixture things.", accessState: "active", verifiedAt: "2026-11-16T00:00:00.000Z", verifiedBy: "v191-admin", focusMarkets: [], plan: null },
});
function creatorRec(id, status, complete) {
  return {
    id, role: "creator", name: `Creator ${id}`, email: `${id}@fixtures.dev`, status,
    market: "Nashville", city: "Nashville", createdAt: "2026-11-10T00:00:00.000Z", reviewedAt: "2026-11-11T00:00:00.000Z",
    creator: { handle: `h_${id}`, categories: ["Food & Drink"], localAudiencePct: 55, audienceStack: { instagram: 5000 }, followerCount: 5000, totalAudience: 5000, hasPhoto: false, bio: "", bestWork: [], publicPage: true, profileComplete: complete },
  };
}
{ const fin = creatorRec("v191-fin", "approved", true); const { salt, hash } = auth.hashPassword(PW); fin.passwordSalt = salt; fin.passwordHash = hash; await store.set("user:v191-fin", fin); await store.set("email:v191-fin@fixtures.dev", { userId: "v191-fin" }); }
{ const un = creatorRec("v191-unfin", "approved", false); delete un.creator.bio; un.creator.categories = []; un.creator.localAudiencePct = null; const { salt, hash } = auth.hashPassword(PW); un.passwordSalt = salt; un.passwordHash = hash; await store.set("user:v191-unfin", un); await store.set("email:v191-unfin@fixtures.dev", { userId: "v191-unfin" }); }
{ const pen = creatorRec("v191-pend", "pending", true); const { salt, hash } = auth.hashPassword(PW); pen.passwordSalt = salt; pen.passwordHash = hash; await store.set("user:v191-pend", pen); await store.set("email:v191-pend@fixtures.dev", { userId: "v191-pend" }); }

const admin = makeClient(); await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: ADMIN_PW });
const brand = makeClient(); await brand("POST", "/api/auth/login", { email: "brand191@fixtures.dev", password: PW });
const fin = makeClient(); await fin("POST", "/api/auth/login", { email: "v191-fin@fixtures.dev", password: PW });
const unfin = makeClient(); await unfin("POST", "/api/auth/login", { email: "v191-unfin@fixtures.dev", password: PW });

async function draftCampaign(title) {
  const d = await brand("POST", "/api/national/campaigns", { title, whatYouGet: "3 products of your choice, free", whatWeAsk: "Post 1 video and tag the brand", picksCount: 2, raiseByAt: "2999-01-01T00:00:00.000Z" });
  return d.data.campaign;
}
async function feedHas(client, id) {
  const f = await client("GET", "/api/national/feed");
  return (f.data.campaigns || []).some((c) => c.id === id);
}

// A market business, registered through the real flows, used to
// prove market offers ignore the national gate in every state.
const mkt = makeClient();
const mktReg = await mkt("POST", "/api/auth/register", { role: "business", name: "Market Owner", businessName: "Market Fixture Shop", email: "market191@fixtures.dev", password: "business-pass-191", market: "Nashville", city: "Nashville", category: "Restaurant", planId: "self-service", agreedTerms: true });
check("fixture: market business registers", mktReg.status === 201, JSON.stringify(mktReg.data).slice(0, 200));
if (mktReg.data && mktReg.data.user) {
  await admin("POST", "/api/admin/review", { userId: mktReg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: mktReg.data.user.id });
}
async function marketOffer(title) {
  const o = await mkt("POST", "/api/offers", { title, whatComped: "Dinner for two people", dollarCap: 80, spots: 1 });
  return o;
}

// ---------------- gate ON: hold, queue, release ----------------
console.log("== gate ON ==");
await store.del("config:markets");
await store.del("config:nationalPublishGate");
{
  const c1 = await draftCampaign("Held campaign one");
  const pub = await brand("POST", `/api/national/campaigns/${c1.id}/publish`, {});
  check("gate ON: a fully-gated publish lands in awaiting_release, not open", pub.status === 200 && pub.data.campaign.status === "awaiting_release", JSON.stringify(pub.data).slice(0, 240));
  check("gate ON: the publish response carries the effective gate", !!pub.data.gate && pub.data.gate.effectiveOn === true, JSON.stringify(pub.data.gate || {}));
  check("gate ON: the brand view states the true state in plain words", pub.data.campaign.brandStateLine === "With Magpie for review. Your campaign is not visible to creators yet.", pub.data.campaign.brandStateLine || "");
  check("gate ON: submitted time is stamped", !!pub.data.campaign.submittedAt);
  check("gate ON: invisible in the finished creator feed", !(await feedHas(fin, c1.id)));
  check("gate ON: invisible in the unfinished creator feed", !(await feedHas(unfin, c1.id)));
  const raise = await fin("POST", `/api/national/campaigns/${c1.id}/raise`, {});
  check("gate ON: a hand-raise on a held campaign is refused", raise.status === 403 || raise.status === 404, String(raise.status));
  const page = await fin("GET", `/api/national/campaigns/${c1.id}`);
  check("gate ON: the creator campaign page 404s for a held campaign", page.status === 404, String(page.status));
  const adm = await admin("GET", "/api/admin/national");
  check("gate ON: Admin sees the effective gate holding", adm.data.gate && adm.data.gate.effectiveOn === true && adm.data.gate.storedOn === true, JSON.stringify(adm.data.gate || {}));
  const q = (adm.data.releaseQueue || []).find((c) => c.id === c1.id);
  check("gate ON: the held campaign is in the Admin release queue with brand, title, what-you-get and submitted time", !!q && q.brandName === "Fixture Brand" && q.title === "Held campaign one" && /3 products/.test(q.whatYouGet || "") && !!q.submittedAt, JSON.stringify(q || {}).slice(0, 240));
  const mo = await marketOffer("Market offer while gate on");
  check("gate ON: a market business offer is unaffected (publishes open in a live-flag test world)", (mo.status === 201 || mo.status === 200) && !!mo.data.offer, `${mo.status} ${JSON.stringify(mo.data).slice(0, 200)}`);

  const rel = await admin("POST", `/api/admin/national/campaigns/${c1.id}/release`, {});
  check("release: Admin release opens the campaign", rel.status === 200 && rel.data.campaign.status === "open" && !!rel.data.campaign.releasedAt, JSON.stringify(rel.data).slice(0, 200));
  check("release: visible to the approved and finished creator", await feedHas(fin, c1.id));
  check("release: still invisible to the approved but unfinished creator", !(await feedHas(unfin, c1.id)));
  const raise2 = await fin("POST", `/api/national/campaigns/${c1.id}/raise`, {});
  check("release: the finished creator can now raise a hand", raise2.status === 200 && raise2.data.hand.status === "raised", JSON.stringify(raise2.data).slice(0, 160));
  var releasedId = c1.id;
}

// ---------------- send back ----------------
console.log("== send back ==");
{
  const c2 = await draftCampaign("Held campaign two");
  await brand("POST", `/api/national/campaigns/${c2.id}/publish`, {});
  const back = await admin("POST", `/api/admin/national/campaigns/${c2.id}/send-back`, { reason: "Please name the exact product in the headline." });
  check("send back: returns the campaign to draft", back.status === 200 && back.data.campaign.status === "draft", JSON.stringify(back.data).slice(0, 200));
  check("send back: the brand sees the reason on its own view", /sent this campaign back to draft/.test(back.data.campaign.brandStateLine || "") && /exact product/.test(back.data.campaign.brandStateLine || ""), back.data.campaign.brandStateLine || "");
  const adm = await admin("GET", "/api/admin/national");
  check("send back: the campaign leaves the release queue", !(adm.data.releaseQueue || []).some((c) => c.id === c2.id));
  check("send back: invisible in the finished creator feed", !(await feedHas(fin, c2.id)));
}

// ---------------- gate OFF via Admin toggle ----------------
console.log("== gate OFF via Admin toggle ==");
{
  const t = await admin("POST", "/api/admin/national/publish-gate", { hold: false });
  check("toggle: Admin releases the stored hold", t.status === 200 && t.data.gate.storedOn === false && t.data.gate.effectiveOn === false, JSON.stringify(t.data).slice(0, 200));
  const rec = await store.get("config:nationalPublishGate");
  check("toggle: the flip is a stored record, not a code change", !!rec && rec.hold === false && rec.state === "off" && !!rec.updatedBy);
  const c3 = await draftCampaign("Straight through campaign");
  const pub = await brand("POST", `/api/national/campaigns/${c3.id}/publish`, {});
  check("gate OFF: publish goes straight to open", pub.status === 200 && pub.data.campaign.status === "open", JSON.stringify(pub.data).slice(0, 200));
  check("gate OFF: visible to the finished creator at once", await feedHas(fin, c3.id));
  const mo = await marketOffer("Market offer while gate off");
  check("gate OFF: a market business offer is still unaffected", (mo.status === 201 || mo.status === 200) && !!mo.data.offer, `${mo.status}`);
}

// ---------------- re-arm does not pull back ----------------
console.log("== re-arm ==");
{
  const t = await admin("POST", "/api/admin/national/publish-gate", { hold: true });
  check("re-arm: the stored hold is on again", t.data.gate.storedOn === true && t.data.gate.effectiveOn === true);
  check("re-arm: the already-released campaign stays visible", await feedHas(fin, releasedId));
  const rec = await store.get(`ncampaign:${releasedId}`);
  check("re-arm: the already-open campaign record is untouched", rec.status === "open", rec.status);
}

// ---------------- gate OFF via a live market ----------------
console.log("== gate OFF via a live market ==");
{
  await store.set("config:markets", { flags: { Nashville: true }, updatedAt: "2026-11-17T12:30:00.000Z" });
  const adm = await admin("GET", "/api/admin/national");
  check("live market: Admin reads released-by-launch while the stored flag still says on", adm.data.gate.storedOn === true && adm.data.gate.anyMarketLive === true && adm.data.gate.effectiveOn === false && adm.data.gate.releasedByLaunch === true, JSON.stringify(adm.data.gate || {}));
  const c4 = await draftCampaign("Launch released campaign");
  const pub = await brand("POST", `/api/national/campaigns/${c4.id}/publish`, {});
  check("live market: publish goes straight to open with the stored hold still on", pub.status === 200 && pub.data.campaign.status === "open", JSON.stringify(pub.data).slice(0, 200));
  check("live market: visible to the finished creator", await feedHas(fin, c4.id));
  const mo = await marketOffer("Market offer while a market is live");
  check("live market: a market business offer is still unaffected", (mo.status === 201 || mo.status === 200) && !!mo.data.offer, `${mo.status}`);
  await store.del("config:markets");
  const adm2 = await admin("GET", "/api/admin/national");
  check("live flag removed: the stored hold holds again", adm2.data.gate.effectiveOn === true, JSON.stringify(adm2.data.gate || {}));
}

console.log(`\nBUILD191 VERIFY: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
