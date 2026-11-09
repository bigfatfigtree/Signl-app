// verify-build154.mjs — Build -154: The Lineup + Regulars
// Receipts + the morning-after note + Have them back.
//   LINEUP: GET /api/lineup gives a business its top-5 matched
//     creators (local reach ranking, honest combined neighbors,
//     extrapolated flags), never more, never for creators, null
//     where fewer than two qualify. Book-all = five SEPARATE
//     direct offers through the existing POST /offers, each
//     carrying a SERVER-recomputed lineup snapshot; a bogus
//     client claim is dropped silently and the plain
//     single-creator path is byte-unchanged (not forced).
//   RECEIPTS: the neighbor special rides an offer into the
//     booking's audience offer; counted audience redemptions
//     feed the creator's Regulars count (stats + public proof,
//     with the forming gate holding below 5 at one business);
//     a booking with no special keeps the standing default.
//   MORNING-AFTER: the notify sweep fires exactly one Maggie
//     note per posted visit, on the next ET day, with the
//     counted number — or the honest counting-has-started line
//     at zero — to BOTH sides; a re-run never repeats it.
//   HAVE THEM BACK: the discover card carries the pronoun-right
//     label only for a business with a completed, posted visit
//     with that creator; the Book again draft endpoint answers
//     for exactly that pair.
//   MAGGIE: lineup proposal + who-brought-me-the-most from the
//     business's OWN data only; a creator hears their own
//     Regulars count; honest empties everywhere. Payments stay
//     OFF (checkout 503, no Stripe env in test).
// Run: node scripts/verify-build154.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build154-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["signl", "test", "admin"].join("-");
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
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body),
      isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { /* not json */ }
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

async function registerCreator(name, handle, market, { pct, followers }) {
  const c = makeClient();
  const email = `${handle.replace(/[^a-z0-9]/gi, "")}-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: PW, market, city: market, handle,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: followers, avgViews: 1500, localAudiencePct: pct,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (r.status !== 201) throw new Error("creator register failed: " + JSON.stringify(r.data));
  return { client: c, email, id: r.data.user.id, handle };
}
async function registerBusiness(name, businessName, market) {
  const c = makeClient();
  const email = `${businessName.replace(/[^a-z0-9]/gi, "").toLowerCase()}-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", { role: "business", name, email, password: PW, market, city: market, businessName, category: "Restaurant", planId: "growth", agreedTerms: true });
  if (r.status !== 201) throw new Error("business register failed: " + JSON.stringify(r.data));
  return { client: c, email, id: r.data.user.id };
}
async function approve(id) {
  const r = await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  if (r.status !== 200) throw new Error("approve failed: " + JSON.stringify(r.data));
}
async function activate(id) {
  const r = await admin("POST", "/api/admin/businesses/activate", { userId: id });
  if (r.status !== 200) throw new Error("activate failed: " + JSON.stringify(r.data));
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const sigJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("stamp is 2026.11.08-154 on all three asset URLs", (indexHtml.match(/2026\.11\.08-154/g) || []).length === 3, `count=${(indexHtml.match(/2026\.11\.08-154/g) || []).length}`);
  check("router carries the lineup route + snapshot + sweep", routerJs.includes('seg[0] === "lineup"') && routerJs.includes("lineupSnapshotFor") && routerJs.includes("runMorningAfterSweep") && routerJs.includes("morningAfterNoteAt"), "");
  check("router carries Regulars counting + haveBack", routerJs.includes("creatorRegularsCount") && routerJs.includes("customersByCreatorFor") && routerJs.includes("haveBackFor") && routerJs.includes("haveBackLabel"), "");
  check("sigdata carries the lineup + customers + regulars facts and answers", sigJs.includes("customersByCreator") && sigJs.includes("regularsBroughtIn") && sigJs.includes("brought me the most"), "");
  check("app carries the Lineup card, book-all, special field, share card, have-back", appJs.includes("lineupBookAll") && appJs.includes("o2-special") && appJs.includes("lineupShareCard") && appJs.includes("haveThemBack") && appJs.includes("regularsPanel"), "");
}

// --- Cast ------------------------------------------------------
// Nashville Restaurant business + six Food & Drink creators with
// a local-% / audience spread, plus C7 whose per-platform stack
// makes part of her neighbor count extrapolated.
const BIZ = await registerBusiness("Tessa Owner", "Fixture Taqueria", "Nashville");
const BIZ2 = await registerBusiness("Chad Owner", "Fixture Chicago Eats", "Chicago");
const BIZ3 = await registerBusiness("Ned Owner", "Fixture Nashville Second", "Nashville");
const C1 = await registerCreator("Lena Local", "lena.local", "Nashville", { pct: 92, followers: 10000 });
const C2 = await registerCreator("Marco Mids", "marco.mids", "Nashville", { pct: 85, followers: 8000 });
const C3 = await registerCreator("Priya Pots", "priya.pots", "Nashville", { pct: 78, followers: 6000 });
const C4 = await registerCreator("Deshawn Eats", "deshawn.eats", "Nashville", { pct: 70, followers: 5000 });
const C5 = await registerCreator("Gwen Grill", "gwen.grill", "Nashville", { pct: 63, followers: 4000 });
const C6 = await registerCreator("Omar Small", "omar.small", "Nashville", { pct: 58, followers: 2500 });
const C7 = await registerCreator("Stacked Sue", "stacked.sue", "Nashville", { pct: 80, followers: 15000 });
for (const u of [BIZ, BIZ2, BIZ3, C1, C2, C3, C4, C5, C6, C7]) await approve(u.id);
for (const b of [BIZ, BIZ2, BIZ3]) await activate(b.id);
for (const c of [C1, C2, C3, C4, C5, C6, C7]) await c.client("PATCH", "/api/me/profile", { paidRate: 150 });
await C1.client("PATCH", "/api/me/profile", { publicPage: true });
{
  // C7's stack: Instagram rated 80% local, TikTok unrated -> the
  // TikTok share of her neighbor count is extrapolated potential.
  const rec = await store.get(`user:${C7.id}`);
  rec.creator = {
    ...(rec.creator || {}),
    audienceStack: { instagram: 10000, tiktok: 5000 },
    platformFollowers: { instagram: 10000, tiktok: 5000 },
    totalAudience: 15000,
    platformLocalPct: { instagram: 80 },
    localAudiencePct: 80,
  };
  await store.set(`user:${C7.id}`, rec);
}

// --- B: the Lineup API ----------------------------------------
console.log("== B: Lineup API ==");
let lineup = null;
{
  const r = await BIZ.client("GET", "/api/lineup");
  check("business gets a lineup", r.status === 200 && !!r.data.lineup, JSON.stringify(r.data).slice(0, 200));
  lineup = r.data.lineup;
  const members = lineup.creators || [];
  check("exactly five members", members.length === 5, `n=${members.length}`);
  const scores = members.map((m) => m.matchScore);
  check("members ranked by match score, descending, all at the qualifying floor", scores.every((s, i) => s >= 55 && (i === 0 || scores[i - 1] >= s)), JSON.stringify(scores));
  const ids = members.map((m) => m.userId);
  check("the 92%-local creator is in the five", ids.includes(C1.id), JSON.stringify(ids));
  check("the stacked creator is in the five", ids.includes(C7.id), JSON.stringify(ids));
  check("the weakest creator is not in the five", !ids.includes(C6.id), JSON.stringify(ids));
  const sue = members.find((m) => m.userId === C7.id);
  check("stacked creator: 12,000 neighbors, extrapolated (TikTok unrated)", !!sue && sue.neighborCount === 12000 && sue.neighborExtrapolated === true, JSON.stringify(sue));
  const sum = members.reduce((a, m) => a + (m.neighborCount || 0), 0);
  check("combined neighbors is exactly the sum of the members'", lineup.combinedNeighbors === sum, `combined=${lineup.combinedNeighbors} sum=${sum}`);
  check("the combined count is flagged extrapolated when any member is", lineup.anyExtrapolated === true, JSON.stringify(lineup.anyExtrapolated));
  const cr = await C1.client("GET", "/api/lineup");
  check("creators cannot read a lineup (403)", cr.status === 403, `got ${cr.status}`);
  const empty = await BIZ2.client("GET", "/api/lineup");
  check("a market with fewer than two qualifying creators gets silence (null)", empty.status === 200 && empty.data.lineup === null, JSON.stringify(empty.data).slice(0, 160));
  const disc = await BIZ.client("GET", "/api/discover");
  check("discover still answers with its usual shape", disc.status === 200 && Array.isArray(disc.data.creators) && disc.data.creators.length >= 6, `n=${disc.data.creators && disc.data.creators.length}`);
}

// --- C: book-all through the existing offer flow ---------------
console.log("== C: book-all + neighbor special ==");
const SPECIAL = "Show this post, get a free queso";
const memberIds = lineup.creators.map((m) => m.userId);
const lineupOffers = {};
{
  for (const m of lineup.creators) {
    const r = await BIZ.client("POST", "/api/offers", {
      title: "Lineup tasting night", whatComped: "Dinner for two", dollarCap: 75, spots: 1,
      creatorId: m.userId, lineup: { creatorIds: memberIds }, neighborSpecial: SPECIAL,
    });
    check(`book-all offer to ${m.handle} creates as a normal direct offer`, r.status === 201 && r.data.offer.lane === "direct", JSON.stringify(r.data).slice(0, 200));
    check(`offer to ${m.handle} carries the server-recomputed snapshot`, !!r.data.offer.lineup && r.data.offer.lineup.members.length === 5 && r.data.offer.lineup.combinedNeighbors === lineup.combinedNeighbors, JSON.stringify(r.data.offer.lineup || {}).slice(0, 200));
    check(`offer to ${m.handle} stores the neighbor special`, r.data.offer.neighborSpecial === SPECIAL, JSON.stringify(r.data.offer.neighborSpecial));
    lineupOffers[m.userId] = r.data.offer;
  }
  const plain = await BIZ.client("POST", "/api/offers", { title: "Solo night", whatComped: "Dinner for two", dollarCap: 75, spots: 1, creatorId: C6.id });
  check("a plain single-creator offer carries NO lineup and NO special (not forced)", plain.status === 201 && plain.data.offer.lineup === undefined && plain.data.offer.neighborSpecial === undefined, JSON.stringify(plain.data.offer).slice(0, 200));
  lineupOffers.plainC6 = plain.data.offer;
  const bogus = await BIZ.client("POST", "/api/offers", { title: "Bogus claim", whatComped: "Dinner", dollarCap: 50, spots: 1, creatorId: C6.id, lineup: { creatorIds: ["nope-1", "nope-2"] } });
  check("a bogus lineup claim still books the creator, snapshot silently absent", bogus.status === 201 && bogus.data.offer.lineup === undefined, JSON.stringify(bogus.data).slice(0, 200));
  const mine = await C1.client("GET", "/api/offers");
  const lo = (mine.data.offers || []).find((o) => o.id === lineupOffers[C1.id].id);
  check("the creator sees their lineup offer with business + combined count + special", !!lo && !!lo.lineup && lo.lineup.businessName === "Fixture Taqueria" && lo.lineup.combinedNeighbors === lineup.combinedNeighbors && lo.neighborSpecial === SPECIAL, JSON.stringify(lo || {}).slice(0, 240));
}

// --- D: accept -> the special rides into the booking -----------
console.log("== D: booking inherits the special ==");
let booking1 = null;
{
  const acc = await C1.client("POST", `/api/offers/${lineupOffers[C1.id].id}/accept`, {});
  check("creator accepts the lineup offer", acc.status === 201 && !!acc.data.booking, JSON.stringify(acc.data).slice(0, 200));
  booking1 = acc.data.booking;
  await BIZ.client("POST", `/api/bookings/${booking1.id}/confirm`, {});
  check("the booking's audience offer IS the neighbor special", !!booking1.audienceOffer && booking1.audienceOffer.title === "Neighbor special" && booking1.audienceOffer.perk === SPECIAL && booking1.audienceOffer.source === "offer", JSON.stringify(booking1.audienceOffer || {}));
  const acc6 = await C6.client("POST", `/api/offers/${lineupOffers.plainC6.id}/accept`, {});
  check("the plain offer accepts too", acc6.status === 201 && !!acc6.data.booking, JSON.stringify(acc6.data).slice(0, 160));
  const b6 = acc6.data.booking;
  check("a booking with no special keeps the standing default offer", !!b6.audienceOffer && b6.audienceOffer.source === "booking_default" && b6.audienceOffer.title !== "Neighbor special", JSON.stringify(b6.audienceOffer || {}));
}

// --- E: counted redemptions -> Regulars -------------------------
console.log("== E: Regulars receipts ==");
{
  for (let i = 0; i < 2; i++) {
    const r = await BIZ.client("POST", "/api/me/audience-codes/redeem", { code: booking1.creatorCode, amount: 25 });
    check(`audience redemption ${i + 1} counts`, r.status === 201, JSON.stringify(r.data).slice(0, 160));
  }
  const stats = await C1.client("GET", "/api/me/stats");
  check("the creator's Regulars count is the counted 2", !!stats.data.stats.regulars && stats.data.stats.regulars.total === 2 && stats.data.stats.regulars.customers === 2, JSON.stringify(stats.data.stats.regulars || {}));
  const pub = await anon("GET", `/api/c/${C1.handle}`);
  const pubProof = pub.data && pub.data.profile && pub.data.profile.proof;
  check("public proof holds the count back while it is forming (<5 at one business)", pub.status === 200 && !!pubProof && pubProof.customersCounted === null, JSON.stringify(pubProof || {}).slice(0, 200));
  for (let i = 0; i < 3; i++) await BIZ.client("POST", "/api/me/audience-codes/redeem", { code: booking1.creatorCode, amount: 25 });
  const stats2 = await C1.client("GET", "/api/me/stats");
  check("five counted redemptions read as five Regulars", !!stats2.data.stats.regulars && stats2.data.stats.regulars.total === 5, JSON.stringify(stats2.data.stats.regulars || {}));
  const pub2 = await anon("GET", `/api/c/${C1.handle}`);
  const pubProof2 = pub2.data && pub2.data.profile && pub2.data.profile.proof;
  check("at five, the public page shows the counted Regulars", !!pubProof2 && pubProof2.customersCounted === 5 && pubProof2.cameBacks === 0, JSON.stringify(pubProof2 || {}).slice(0, 200));
  const fresh = await C6.client("GET", "/api/me/stats");
  check("a creator with no counted redemptions reads an honest zero", !!fresh.data.stats.regulars && fresh.data.stats.regulars.total === 0, JSON.stringify(fresh.data.stats.regulars || {}));
}

// --- F: morning-after note + Have them back ---------------------
console.log("== F: morning-after + have them back ==");
{
  // The unified code means the first audience redemption in
  // section E already redeemed this visit (the post below can
  // only land on a redeemed booking); assert that state plainly.
  const bkRec = await store.get(`booking:${booking1.id}`);
  check("the visit stands redeemed (the unified code redeemed it)", !!bkRec.redeemedAt, JSON.stringify(bkRec.redeemedAt));
  const post = await C1.client("POST", "/api/posts", { bookingId: booking1.id, url: "https://www.instagram.com/p/fixturepost1/", includesDisclosure: true });
  check("the creator's post lands", post.status === 201 || post.status === 200, JSON.stringify(post.data).slice(0, 200));

  const sweepToday = await admin("POST", "/api/admin/notify/sweep", { now: new Date().toISOString() });
  check("same-day sweep does NOT fire the morning-after note", sweepToday.status === 200 && sweepToday.data.morningAfterSweep && sweepToday.data.morningAfterSweep.fired === 0, JSON.stringify(sweepToday.data.morningAfterSweep || {}));
  const tomorrow = new Date(Date.now() + 26 * 3600 * 1000).toISOString();
  const sweepNext = await admin("POST", "/api/admin/notify/sweep", { now: tomorrow });
  check("next-day sweep fires exactly one morning-after note", sweepNext.status === 200 && sweepNext.data.morningAfterSweep && sweepNext.data.morningAfterSweep.fired === 1, JSON.stringify(sweepNext.data.morningAfterSweep || {}));

  const bizThread = await BIZ.client("GET", "/api/messages?with=signl-team");
  const bizBodies = (bizThread.data.messages || []).map((m) => m.body || "");
  check("the business's note carries the counted truth", bizBodies.some((b) => b.includes("posted last night") && b.includes("5 neighbors have come in so far")), JSON.stringify(bizBodies).slice(0, 300));
  const crThread = await C1.client("GET", "/api/messages?with=signl-team");
  const crBodies = (crThread.data.messages || []).map((m) => m.body || "");
  check("the creator's mirror note carries the same counted truth", crBodies.some((b) => b.includes("Your post for Fixture Taqueria") && b.includes("5 neighbors have come in so far")), JSON.stringify(crBodies).slice(0, 300));

  const sweepAgain = await admin("POST", "/api/admin/notify/sweep", { now: new Date(Date.now() + 50 * 3600 * 1000).toISOString() });
  check("a re-run never repeats the note", sweepAgain.data.morningAfterSweep && sweepAgain.data.morningAfterSweep.fired === 0 && sweepAgain.data.morningAfterSweep.alreadyStamped >= 1, JSON.stringify(sweepAgain.data.morningAfterSweep || {}));
  const bizThread2 = await BIZ.client("GET", "/api/messages?with=signl-team");
  check("the business thread still holds exactly one morning-after note", (bizThread2.data.messages || []).filter((m) => (m.body || "").includes("posted last night")).length === 1, `n=${(bizThread2.data.messages || []).length}`);

  // Zero-count variant: C2 completes a visit + post with NO
  // audience redemptions; the note still goes, honestly worded.
  const off2 = await BIZ.client("POST", "/api/offers", { title: "Quiet night", whatComped: "Dinner for two", dollarCap: 60, spots: 1, creatorId: C2.id });
  const acc2 = await C2.client("POST", `/api/offers/${off2.data.offer.id}/accept`, {});
  await BIZ.client("POST", `/api/bookings/${acc2.data.booking.id}/confirm`, {});
  await BIZ.client("POST", "/api/counter/redeem", { code: acc2.data.booking.code });
  const post2 = await C2.client("POST", "/api/posts", { bookingId: acc2.data.booking.id, url: "https://www.instagram.com/p/fixturepost2/", includesDisclosure: true });
  check("the second creator's post lands", post2.status === 201 || post2.status === 200, JSON.stringify(post2.data).slice(0, 160));
  const sweepZero = await admin("POST", "/api/admin/notify/sweep", { now: new Date(Date.now() + 74 * 3600 * 1000).toISOString() });
  check("the zero-count morning-after still fires", sweepZero.data.morningAfterSweep && sweepZero.data.morningAfterSweep.fired === 1, JSON.stringify(sweepZero.data.morningAfterSweep || {}));
  const bizThread3 = await BIZ.client("GET", "/api/messages?with=signl-team");
  const bodies3 = (bizThread3.data.messages || []).map((m) => m.body || "");
  check("at zero the business hears counting has started, never an invented number", bodies3.some((b) => b.includes("Marco Mids posted last night") && b.includes("counting has started")), JSON.stringify(bodies3).slice(0, 400));
  const cr2Thread = await C2.client("GET", "/api/messages?with=signl-team");
  const cr2Bodies = (cr2Thread.data.messages || []).map((m) => m.body || "");
  check("at zero the creator hears counting has started", cr2Bodies.some((b) => b.includes("Counting has started")), JSON.stringify(cr2Bodies).slice(0, 300));

  // Have them back: only the business with the posted visit.
  const disc = await BIZ.client("GET", "/api/discover");
  const card1 = (disc.data.creators || []).find((c) => c.userId === C1.id);
  check("the booked creator's card carries Have them back (no pronouns on file)", !!card1 && !!card1.haveBack && card1.haveBack.label === "Have them back", JSON.stringify(card1 && card1.haveBack));
  await C1.client("PATCH", "/api/me/profile", { pronouns: "she/her" });
  const disc2 = await BIZ.client("GET", "/api/discover");
  const card1b = (disc2.data.creators || []).find((c) => c.userId === C1.id);
  check("with she/her on file the label is Have her back", !!card1b && !!card1b.haveBack && card1b.haveBack.label === "Have her back", JSON.stringify(card1b && card1b.haveBack));
  const disc3 = await BIZ3.client("GET", "/api/discover");
  const cardOther = (disc3.data.creators || []).find((c) => c.userId === C1.id);
  check("a business that never booked her sees NO have-back", !!cardOther && cardOther.haveBack === null, JSON.stringify(cardOther && cardOther.haveBack));
  const again = await BIZ.client("POST", `/api/me/regulars/${C1.id}/book-again`, {});
  check("book-again creates an editable DRAFT with the last visit's terms", again.status === 201 && !!again.data.offer && again.data.offer.status === "draft" && again.data.offer.creatorId === C1.id, JSON.stringify(again.data).slice(0, 200));
  const againStranger = await BIZ3.client("POST", `/api/me/regulars/${C1.id}/book-again`, {});
  check("book-again refuses a business with no posted visit (404)", againStranger.status === 404, `got ${againStranger.status}`);
}

// --- G: Maggie + payments stay off ------------------------------
console.log("== G: Maggie + payments ==");
{
  const askBiz = await BIZ.client("POST", "/api/sig/ask", { q: "Who brought me the most customers?", history: [] });
  check("Maggie answers who brought the most from the business's own counted data", askBiz.data && askBiz.data.source === "data" && /Lena/.test(askBiz.data.text || "") && /5/.test(askBiz.data.text || ""), JSON.stringify(askBiz.data).slice(0, 300));
  const askStranger = await BIZ3.client("POST", "/api/sig/ask", { q: "Who brought me the most customers?", history: [] });
  check("a business with no counted customers hears exactly that (privacy wall holds)", askStranger.data && /no counted customers/i.test(askStranger.data.text || ""), JSON.stringify(askStranger.data).slice(0, 300));
  const askLineup = await BIZ.client("POST", "/api/sig/ask", { q: "Who should I book?", history: [] });
  check("Maggie proposes the Lineup with named creators and the Find link", askLineup.data && /Lineup/.test(askLineup.data.text || "") && /Lena/.test(askLineup.data.text || "") && askLineup.data.link && askLineup.data.link.dest === "biz-discover", JSON.stringify(askLineup.data).slice(0, 400));
  const askCr = await C1.client("POST", "/api/sig/ask", { q: "How many regulars have I brought in?", history: [] });
  check("Maggie tells the creator their own Regulars count", askCr.data && /5/.test(askCr.data.text || "") && /Regulars/.test(askCr.data.text || ""), JSON.stringify(askCr.data).slice(0, 300));
  const askFresh = await C6.client("POST", "/api/sig/ask", { q: "How many regulars have I brought in?", history: [] });
  check("a creator with none hears an honest zero, never an invented number", askFresh.data && /None counted yet/.test(askFresh.data.text || "") && /Regulars count starts/.test(askFresh.data.text || ""), JSON.stringify(askFresh.data).slice(0, 300));
  const checkout = await BIZ.client("POST", "/api/billing/checkout", { planId: "growth" });
  check("payments stay OFF: checkout refuses (503)", checkout.status === 503, `got ${checkout.status}: ${JSON.stringify(checkout.data).slice(0, 160)}`);
}

console.log(`\nverify-build154: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
