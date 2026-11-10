// verify-build175.mjs — Build -175: "Total local" — the
// absolute local-audience count leads every business-facing
// creator surface, Find gains a "Most people here" sort and a
// minimum "people here" filter, and Maggie answers a reach
// question ranked by the count.
//   THE PROBLEM (Jeff, 2026-11-09): a creator with 1.2M
//     followers at 20% local has 240,000 local people; ranked
//     and shown by local % alone she is buried under a 90%-
//     local creator with 4,500 local people, and businesses
//     miss her. The canon count already exists (follower-
//     weighted local % over rated platforms, extrapolated
//     across the rest, labelled "potential" when estimated);
//     this build is DISPLAY, SEARCH and SORT over it — no new
//     math, no new data reads, default ranking untouched.
//   THE BUILD: (1) shelf tile, deck card, list card, Sig card
//     and the profile hero lead with the count in plain words
//     ("240,000 people here", "20% local", "potential people
//     here" while extrapolated); (2) a server sort "people" in
//     discoverCards (count desc, % tiebreak, founding last)
//     behind the Find option "Most people here" in the live
//     Find AND the admin preview twin; (3) a client-side
//     minimum-people floor in both Finds over the count the
//     cards already carry, with an honest filters empty state;
//     (4) Maggie's find_creators takes sort "people" and
//     returns rankedBy + localPeople per card.
//   REGRESSION SHAPE: the people order below FAILS on the
//     pre-build code (no "people" branch — the endpoint falls
//     back to founding order, dense creator first), and the
//     client model/renderer checks fail on the old %-led
//     markup. The default-order checks pin that NOTHING else
//     moved: no sort param still returns founding order.
// Run: node scripts/verify-build175.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build175-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com"; // Jeff's real login (confirmed 2026-11-09)
process.env.ADMIN_PASSWORD = "verify-" + "admin-" + "pw";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_VERIFY_TOKEN = "verify-" + "token-" + "175";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const auth = require("../netlify/functions/lib/auth.js");
const { handler } = require("../netlify/functions/api.js");
const { localRateModel } = require("../netlify/functions/lib/audience-markets.js");
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

// ---------- fixtures ----------
// Nashville roster, founding order dense -> big -> extra:
//   dense: 5,000 followers at 90% local = 4,500 people here
//     (the creator who used to bury everyone).
//   big: 1,200,000 at 20% = 240,000 people here (Jeff's case).
//   extra: 400,000 Instagram at its own 25% rate + 200,000
//     TikTok with no rate = 150,000 people here, the TikTok
//     half an estimate at the headline rate ("potential").
const PW = "fixture-pass-175";
function seedCreator(id, { name, email, handle, stack, platformLocalPct, localAudiencePct, createdAt }) {
  const { salt, hash } = auth.hashPassword(PW);
  const total = Object.values(stack).reduce((s, n) => s + n, 0);
  return {
    id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash,
    status: "approved", tester: false, market: "Nashville", city: "Nashville", state: null, country: "United States",
    createdAt, updatedAt: createdAt,
    reviewedAt: createdAt, reviewedBy: "seed",
    termsVersion: "2026-10-19", termsAcceptedAt: createdAt, marketingEmailConsent: false, marketingConsentAt: null,
    signupPath: "full", signupSource: null, referredBy: null,
    creator: {
      handle, primaryPlatform: "instagram", instagramUrl: `https://www.instagram.com/${handle}/`,
      followerCount: stack.instagram || 0, audienceStack: stack, totalAudience: total, avgViews: 0,
      platformLocalPct, localAudiencePct, localAudienceSource: "Self-reported",
      categories: ["Food & Drink"], compCategories: [], openToPaidCampaigns: false, compOpen: true, paidRate: 200,
      bio: "Build -175 fixture creator, long enough to count as a written bio for the profile.",
      bestWork: [], maxVisitsPerWeek: 3, neighborhood: "",
      profileComplete: true, profileCompletedAt: createdAt, publicPage: true,
    },
    business: null,
  };
}
const DENSE = "175-dense";
const BIG = "175-big";
const EXTRA = "175-extra";
const BIZ = "175-biz";
await store.set(`user:${DENSE}`, seedCreator(DENSE, { name: "Dense Dana", email: "dense@fixtures.dev", handle: "densedana", stack: { instagram: 5000 }, platformLocalPct: {}, localAudiencePct: 90, createdAt: "2026-10-01T00:00:00.000Z" }));
await store.set(`user:${BIG}`, seedCreator(BIG, { name: "Big Bella", email: "big@fixtures.dev", handle: "bigbella", stack: { instagram: 1200000 }, platformLocalPct: {}, localAudiencePct: 20, createdAt: "2026-10-02T00:00:00.000Z" }));
await store.set(`user:${EXTRA}`, seedCreator(EXTRA, { name: "Extra Erin", email: "extra@fixtures.dev", handle: "extraerin", stack: { instagram: 400000, tiktok: 200000 }, platformLocalPct: { instagram: 25 }, localAudiencePct: 25, createdAt: "2026-10-03T00:00:00.000Z" }));
{
  const { salt, hash } = auth.hashPassword(PW);
  await store.set(`user:${BIZ}`, {
    id: BIZ, role: "business", email: "biz175@fixtures.dev", name: "Biz Owner", passwordSalt: salt, passwordHash: hash,
    status: "approved", tester: false, market: "Nashville", city: "Nashville",
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    business: { businessName: "Fixture Biz 175", category: "Food" }, creator: null, partner: null,
  });
  await store.set("email:biz175@fixtures.dev", { userId: BIZ });
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const aiJs = fs.readFileSync(path.join(root, "netlify/functions/lib/maggie-ai.js"), "utf8");
  const theme3 = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  check("stamp is 2026.11.09-176 in index.html", indexHtml.includes("2026.11.09-176") && !indexHtml.includes("2026.11.09-175"));
  check("server: the card count helper + people sort exist",
    routerJs.includes("function cardLocalPeople(card)") && routerJs.includes('query.sort === "people"'));
  check("server: the people sort reads the canon model (localRateModel), never the match score",
    routerJs.includes("const m = localRateModel(p);") && routerJs.includes("cardLocalPeople(a)") && routerJs.includes("cardLocalPeople(b)"));
  check("server: Maggie's find_creators takes sort people and returns rankedBy + localPeople",
    routerJs.includes('byPeople ? "people"') && routerJs.includes("localPeople: cardLocalPeople(c)") && routerJs.includes('rankedBy: byPeople ? "people"'));
  check("server: Maggie's voice opens a reach answer with the count",
    aiJs.includes('sort "people"') && aiJs.includes("Ranked by how many people they reach in"));
  check("client: the shared two-number helper exists with the honesty wording",
    appJs.includes("function peopleHereBits(c)") && appJs.includes('"potential people here"') && appJs.includes('"people here"'));
  check("client: the shelf tile leads with the count (shelf-count + % local beside)",
    appJs.includes('class="shelf-count"') && appJs.includes('class="shelf-pctside"') && appJs.includes("${bits.pct}% local"));
  check("client: the deck card leads with the count",
    appJs.includes("${bits.words} · ${bits.pct}% local"));
  check("client: the list card carries the count line",
    appJs.includes('class="cc-localcount"') && appJs.includes('"potential people"'));
  check("client: the profile hero renders the count big",
    appJs.includes('class="pdp-hero-countnum"') && theme3.includes(".pdp-hero-countnum"));
  check("client: Sig card leads with the count", appJs.includes("people ? `${fmtFull(people.count)}"));
  check("sort: 'Most people here' rides BOTH live selects and the preview twin, default untouched",
    (appJs.match(/<option value="people">Most people here<\/option>/g) || []).length === 3
    && appJs.includes('<option value="local" selected>Best local fit (most local first)</option>'));
  check("filter: the people-here floor rides the live rail (Any / 1,000+ / 10,000+ / 50,000+ / 100,000+)",
    appJs.includes("How many people they reach here") && appJs.includes('name="disc-minpeople"')
    && appJs.includes('"100000", "100,000+ people here"') && appJs.includes("function discMinPeopleSet(v)"));
  check("filter: the floor applies in runDiscover over the card-carried count, honest empty state",
    appJs.includes("state.discoverMinPeople") && appJs.includes("peopleFilteredEmpty")
    && appJs.includes('Nobody in this market reaches that many local people yet'));
  check("filter: the preview twin carries the floor + its honest empty state",
    appJs.includes('id="pvf-minpeople"') && appJs.includes("state.preview.peopleFilteredEmpty"));
  check("deck: the deck ranking follows the people sort, canon % order otherwise",
    appJs.includes("byPeople175") && appJs.includes('sortSel175.value === "people"'));
  check("clears: Clear all + the empty-state clear both reset the floor",
    appJs.includes("state.discoverMinPeople = 0;") && appJs.includes('input[name="disc-minpeople"]'));
  // LOADER RULE guard (the -173 lesson): this build adds no
  // store reads at all — no loader, no list, no get in its diff.
  check("server: no new store reads ride this build's sort (no store.get/list in the people branch)",
    !/query\.sort === "people"[\s\S]{0,900}?store\.(get|list|set)/.test(routerJs));
}

// --- B: the canon model, server side --------------------------
console.log("== B: localRateModel expected values ==");
{
  const erin = { audienceStack: { instagram: 400000, tiktok: 200000 }, platformLocalPct: { instagram: 25 }, localAudiencePct: 25 };
  const m = localRateModel(erin);
  check("model: Erin's count is 150,000 (own rate + headline rate)", m.neighborCount === 150000, String(m.neighborCount));
  check("model: Erin's TikTok is the extrapolated platform", JSON.stringify(m.extrapolatedPlatforms) === '["tiktok"]' && m.allReal === false, JSON.stringify(m.extrapolatedPlatforms));
  const bella = { audienceStack: { instagram: 1200000 }, platformLocalPct: {}, localAudiencePct: 20 };
  check("model: Bella has no rate anywhere (legacy % rules)", localRateModel(bella).neighborCount === null);
}

// --- C: discover order through the real endpoint --------------
console.log("== C: /discover order ==");
const biz = makeClient();
{
  const login = await biz("POST", "/api/auth/login", { email: "biz175@fixtures.dev", password: PW });
  check("business login works", login.status === 200, String(login.status));
  const ids = (r) => ((r.data && r.data.creators) || []).map((c) => c.userId);
  const dflt = await biz("GET", "/api/discover?market=Nashville");
  check("default order is founding order (dense, big, extra) — UNCHANGED",
    JSON.stringify(ids(dflt)) === JSON.stringify([DENSE, BIG, EXTRA]), JSON.stringify(ids(dflt)));
  const people = await biz("GET", "/api/discover?market=Nashville&sort=people");
  check("people order is count-first: big (240,000) > extra (150,000) > dense (4,500)",
    JSON.stringify(ids(people)) === JSON.stringify([BIG, EXTRA, DENSE]), JSON.stringify(ids(people)));
  const score = await biz("GET", "/api/discover?market=Nashville&sort=score");
  check("the impact-score sort still answers (existing sorts untouched)",
    score.status === 200 && ids(score).length === 3, String(score.status));
  const cards = Object.fromEntries(((people.data && people.data.creators) || []).map((c) => [c.userId, c]));
  check("cards carry everything the count renders from (totalAudience + audienceStack + profile rates)",
    cards[BIG].totalAudience === 1200000 && Array.isArray(cards[EXTRA].audienceStack)
    && cards[EXTRA].audienceStack.some((e) => e.platform === "tiktok" && e.localPct === null)
    && cards[EXTRA].profile.platformLocalPct.instagram === 25);
}

// --- D: the client model + renderers, behaviorally ------------
console.log("== D: client model + cards (vm) ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const grab = (startMarker, endMarker) => {
    const s = appJs.indexOf(startMarker);
    const e = appJs.indexOf(endMarker, s);
    if (s < 0 || e < 0) throw new Error(`slice not found: ${startMarker}`);
    return appJs.slice(s, e);
  };
  const parts = [
    grab("function esc(s)", "// GET cache"),
    grab("const PLATFORM_LABELS_ALL", "const COUNT_PLATFORM_KEYS_CLIENT"),
    grab("function clientPlatformLinks(c)", "function stackList(source)"),
    grab("function stackList(source)", "// ---------- primary platform"),
    grab("function fmtNum(n)", "function fmtMoney(n)"),
    grab("function fmtPrice(n)", "// ---------- audience stacking"),
    grab("function totalAudienceOf(source)", "function stackChipsHtml(source)"),
    grab("function marketDisplayName(name)", "// Market naming rule"),
    grab("function currencySymbolForMarket(name)", "function paidFloorForMarketClient(name)"),
    grab("function fmtFull(n)", "async function shelfToggleFav"),
    grab("function shelfPriceLine(c)", "// Build -136 (Jeff's card ruling)"),
    grab("function similarCreatorsHtml(c)", "// Build -140 (Item F)"),
    grab("function shelfTileHtml(c, opts)", "async function shelfToggleFav"),
    grab("function pdpLocalHeroHtml(c)", "function whatYouGetHtml(c)"),
    grab("function lbarHtml119(pct)", "function ringHtml119(done, total)"),
    grab("function creatorCard(c, viewer, opts)", "// ---------- creator ----------"),
    grab("function discoverStackCard(c)", "function discoverEndHtml"),
    grab("function sigCreatorCardHtml(c, ti, ci)", "function sigOfferCardHtml"),
  ];
  const sandbox = {
    console, state: { boot: { markets: [{ name: "Nashville", label: "Nashville, Tennessee" }] }, user: null, discover: [], sigOpData: null },
    ST: (en) => en,
    avatarHtml: () => "",
    campusBadgeHtml: () => "",
    badgesHtml: () => "",
    scoreBadge: () => "",
    paidLaneBadgesHtml: () => "",
    socialLinksHtml: () => "",
    bestWorkHtml: () => "",
    starsHtml: () => "",
    sigAvatarHtml: () => "",
  };
  vm.createContext(sandbox);
  vm.runInContext('const LOCAL_BASIS_LINE = "basis";\n' + parts.join("\n") + "\n;globalThis.__x = { peopleHereBits, cardLocalCount, shelfTileHtml, discoverStackCard, pdpLocalHeroHtml, creatorCard, sigCreatorCardHtml, similarCreatorsHtml };", sandbox);
  const X = sandbox.__x;
  const card = (over) => ({
    userId: "x", name: "Test Person", market: "Nashville", city: "Nashville", neighborhood: "",
    marketContext: null, trackRecord: { isNew: true }, photos: [], photoUrl: null,
    profile: { handle: "testperson", categories: ["Food & Drink"], compOpen: true, couponOpen: true, paidRate: null, localAudienceSource: "Self-reported" },
    ...over,
  });
  const bigLow = card({ userId: "u-big", name: "Big Bella", totalAudience: 1200000, audienceStack: [{ platform: "instagram", label: "Instagram", count: 1200000, localPct: null }], profile: { handle: "bigbella", categories: ["Food & Drink"], compOpen: true, couponOpen: true, paidRate: 900, localAudiencePct: 20, platformLocalPct: {}, localAudienceSource: "Self-reported" } });
  const dense = card({ userId: "u-dense", name: "Dense Dana", totalAudience: 5000, audienceStack: [{ platform: "instagram", label: "Instagram", count: 5000, localPct: null }], profile: { handle: "densedana", categories: ["Food & Drink"], compOpen: true, couponOpen: true, paidRate: 150, localAudiencePct: 90, platformLocalPct: {}, localAudienceSource: "Self-reported" } });
  const extra = card({ userId: "u-extra", name: "Extra Erin", totalAudience: 600000, audienceStack: [{ platform: "instagram", label: "Instagram", count: 400000, localPct: 25 }, { platform: "tiktok", label: "TikTok", count: 200000, localPct: null }], profile: { handle: "extraerin", categories: ["Food & Drink"], compOpen: true, couponOpen: true, paidRate: 400, localAudiencePct: 25, platformLocalPct: { instagram: 25 }, localAudienceSource: "Self-reported" } });

  const bB = X.peopleHereBits(bigLow);
  check("model: Jeff's case — 1.2M at 20% is 240,000 people here, not an estimate",
    bB && bB.count === 240000 && bB.pct === 20 && bB.extrapolated === false && bB.words === "people here", JSON.stringify(bB));
  const bE = X.peopleHereBits(extra);
  check("model: the extrapolated case — 150,000 and the words say potential",
    bE && bE.count === 150000 && bE.extrapolated === true && bE.words === "potential people here", JSON.stringify(bE));
  const byPct = [bigLow, dense].slice().sort((a, b2) => (b2.profile.localAudiencePct || 0) - (a.profile.localAudiencePct || 0));
  const byPeople = [dense, bigLow].slice().sort((a, b2) => (X.cardLocalCount(b2) || -1) - (X.cardLocalCount(a) || -1));
  check("ranking: % order puts dense first; count order puts big first (the burial, fixed)",
    byPct[0].name === "Dense Dana" && byPeople[0].name === "Big Bella");

  const tile = X.shelfTileHtml(bigLow, {});
  check("tile: the big count renders with its words and the % beside it",
    tile.includes('class="shelf-count">240,000<') && tile.includes("20% local") && tile.includes("people here in Nashville"), tile.slice(0, 0));
  const tileE = X.shelfTileHtml(extra, {});
  check("tile: the extrapolated tile says potential people here",
    tileE.includes("150,000") && tileE.includes("potential people here"), "");
  const tileD = X.shelfTileHtml(dense, {});
  check("tile: the dense tile shows 4,500 people here at 90% local",
    tileD.includes('class="shelf-count">4,500<') && tileD.includes("90% local"), "");

  const deck = X.discoverStackCard(bigLow);
  check("deck card: the count leads with the % beside it",
    deck.includes("240,000") && deck.includes("people here · 20% local"), "");
  const deckE = X.discoverStackCard(extra);
  check("deck card: the extrapolated deck card says potential",
    deckE.includes("150,000") && deckE.includes("potential people here · 25% local"), "");

  const hero = X.pdpLocalHeroHtml(bigLow);
  check("profile hero: the count renders big inside the neighbors sentence",
    hero.includes('class="pdp-hero-countnum">240,000<') && hero.includes("neighbors</strong>"), "");
  const heroE = X.pdpLocalHeroHtml(extra);
  check("profile hero: the extrapolated hero keeps the potential label",
    heroE.includes("150,000") && heroE.includes("potential neighbors"), "");

  const list = X.creatorCard(bigLow, { role: "business" }, {});
  check("list card: the count line renders in the local block",
    list.includes('class="cc-localcount">about 240,000 people here<'), "");
  sandbox.state.discover = [bigLow, dense, extra];
  const sim = X.similarCreatorsHtml(bigLow);
  check("profile similar rail: each card carries its count (4,500 / 150,000 people here)",
    sim.includes("4,500 people here · 90% local") && sim.includes("150,000 people here · 25% local"), sim);

  sandbox.state.discover = [bigLow, dense, extra];
  const sig = X.sigCreatorCardHtml(bigLow, 0, 0);
  check("Sig card: the count leads, the % explains it underneath",
    sig.includes("240,000") && sig.includes("people here") && sig.includes("20% of their followers live in Nashville"), "");
  const sigE = X.sigCreatorCardHtml(extra, 0, 0);
  check("Sig card: the extrapolated Sig card says potential",
    sigE.includes("150,000") && sigE.includes("potential people here"), "");
}

console.log(`\nBUILD-175 SUITE: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
