// Verification of the matching fit layer (Jeff, 2026-10-23).
// Pins:
//   - the pure module (lib/fit.js): category scoring (direct map,
//     adjacency, comp-acceptance), geography (same city beats same
//     market beats nothing), local-audience bands, profession
//     relevance, ratings ignored below 3 and counted at 3+,
//     audience size / tier / Momentum NEVER scored, reasons
//     non-empty whenever the score is above zero, the learned
//     re-ranker seam is the identity function today, and the
//     creator-side fit note appears only on a strong match;
//   - discovery wiring: cards carry fit { score, reasons } for a
//     business viewer, ?sort=fit orders by fit, the DEFAULT order
//     stays founding order, founding-gate 403s are unchanged, and
//     unauthenticated discovery still 401s;
//   - the open-offers board: fitNote present for a strong match,
//     null for a weak one, with application mechanics untouched;
//   - the served client bundle carries the fit rendering (the
//     "Why they fit" line and the Best fit sort option).
// Ratings are seeded straight into the local store between boots
// (the cityresolver pattern): two ratings on one creator, three
// on another, so the 3+ threshold is exercised end to end.
// Run: node scripts/verify-fit.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { computeFit, buildFitNote, applyLearnedRerank } = require("../netlify/functions/lib/fit.js");

const PORT = 8985;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-fit-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-fit-${Date.now()}.json`);

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (v) jar.set(k, v); else jar.delete(k);
      }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data };
  };
}

// ---------- unit level: the pure fit module ----------
const RESTAURANT = { category: "Restaurant", market: "Richmond", city: "Richmond", neighborhood: "Carytown" };

const fDirect = computeFit(RESTAURANT, { categories: ["Food & Drink"], homeCity: "Richmond", localAudiencePct: 62 });
check("direct category match scores the full stack (36 cat + 24 city + 18 local = 78)", fDirect.score === 78, JSON.stringify(fDirect));
check("direct match reasons read plainly", fDirect.reasons.includes("Posts Food & Drink content") && fDirect.reasons.includes("Based in Richmond") && fDirect.reasons.includes("62% local audience"), JSON.stringify(fDirect.reasons));

const fSynonym = computeFit({ category: "Salon & Barbershop", market: "Richmond", city: "Richmond" }, { categories: ["Beauty & Grooming"], homeCity: "Richmond", localAudiencePct: null });
check("synonym map: a salon fits a Beauty & Grooming creator directly", fSynonym.parts.category === "direct" && fSynonym.score === 60, JSON.stringify(fSynonym));

const fAdjacent = computeFit(RESTAURANT, { categories: ["Nightlife"], homeCity: "Petersburg", localAudiencePct: 30 });
check("adjacent category + same-market town scores 20 + 14 + 8 = 42", fAdjacent.score === 42 && fAdjacent.parts.category === "adjacent" && fAdjacent.parts.sameMarket === true, JSON.stringify(fAdjacent));
check("same-market reason names the town and the market", fAdjacent.reasons.some((r) => r.includes("Petersburg") && r.includes("Richmond")), JSON.stringify(fAdjacent.reasons));

const fMismatch = computeFit(RESTAURANT, { categories: ["Fitness & Wellness"], homeCity: "Richmond", localAudiencePct: null });
check("category mismatch earns no category points (city only = 24)", fMismatch.score === 24 && fMismatch.parts.category === null, JSON.stringify(fMismatch));

const fComp = computeFit({ category: "Fitness Studio", market: "Richmond", city: "Richmond" }, { categories: ["Beauty & Grooming"], compCategories: ["Fitness classes & passes"], homeCity: "Norfolk", localAudiencePct: null });
check("comp-acceptance signal scores on its own (16)", fComp.score === 16 && fComp.parts.category === "comp" && fComp.reasons.some((r) => r.includes("Open to comp")), JSON.stringify(fComp));

const fRatingsLow = computeFit(RESTAURANT, { categories: ["Food & Drink"], homeCity: "Richmond", localAudiencePct: 62, ratingAvg: 5, ratingCount: 2 });
check("ratings below 3 are ignored entirely (same 78, no rating reason)", fRatingsLow.score === 78 && !fRatingsLow.reasons.some((r) => r.startsWith("Rated")), JSON.stringify(fRatingsLow));

const fRatings = computeFit(RESTAURANT, { categories: ["Food & Drink"], homeCity: "Richmond", localAudiencePct: 62, ratingAvg: 4.8, ratingCount: 5 });
check("ratings at 3+ count (78 + 10 = 88) with the reason attached", fRatings.score === 88 && fRatings.reasons.includes("Rated 4.8 by 5 businesses"), JSON.stringify(fRatings));

const smallCreator = { categories: ["Food & Drink"], homeCity: "Richmond", localAudiencePct: 62, totalAudience: 550, tier: "Neighbors", momentumPoints: 0 };
const bigCreator = { categories: ["Food & Drink"], homeCity: "Richmond", localAudiencePct: 62, totalAudience: 90000, tier: "Headliners", momentumPoints: 400 };
check("audience size, tier and Momentum are never scored (550 followers fit exactly like 90k)",
  computeFit(RESTAURANT, smallCreator).score === computeFit(RESTAURANT, bigCreator).score,
  `${computeFit(RESTAURANT, smallCreator).score} vs ${computeFit(RESTAURANT, bigCreator).score}`);

const fNeighborhood = computeFit(RESTAURANT, { categories: ["Food & Drink"], homeCity: "Richmond", neighborhood: "Carytown", localAudiencePct: 62 });
check("neighborhood match adds its points (78 + 4 = 82) with a readable reason", fNeighborhood.score === 82 && fNeighborhood.reasons.includes("In Carytown, your neighborhood"), JSON.stringify(fNeighborhood));

const fRealtor = computeFit({ category: "Local Services", market: "Virginia Beach", city: "Norfolk", neighborhood: "Ghent" },
  { categories: ["Local Services"], homeCity: "Virginia Beach", profession: "Real estate agent", farmAreas: ["Ghent"], localAudiencePct: null });
check("realtor profession + coverage area both land (36 cat + 14 market + 4 area + 8 profession = 62)",
  fRealtor.score === 62 && fRealtor.parts.profession === true && fRealtor.reasons.some((r) => r.startsWith("Covers Ghent")), JSON.stringify(fRealtor));

const fZero = computeFit({ category: "Fitness Studio", market: "Richmond", city: "Richmond" }, { categories: ["Nightlife"], homeCity: "Norfolk", localAudiencePct: null, ratingCount: 0 });
check("a total mismatch scores 0 with no reasons (no reason, no points)", fZero.score === 0 && fZero.reasons.length === 0, JSON.stringify(fZero));

const invariantCases = [fDirect, fSynonym, fAdjacent, fMismatch, fComp, fRatingsLow, fRatings, fNeighborhood, fRealtor];
check("invariant: every score above zero carries at least one reason", invariantCases.every((f) => f.score === 0 || f.reasons.length > 0));

const seamIn = { score: 42, reasons: ["x"], parts: { category: "adjacent" } };
check("the learned re-ranker seam is the identity function today", applyLearnedRerank(seamIn, { business: RESTAURANT, creator: bigCreator }) === seamIn);

const noteStrong = buildFitNote(fDirect, RESTAURANT, { categories: ["Food & Drink"], homeCity: "Richmond" });
check("fit note on a strong match follows the pattern", noteStrong === "Strong fit · Food · Richmond", String(noteStrong));
const fWeak = computeFit({ category: "Attraction", market: "Richmond", city: "Richmond" }, { categories: ["Nightlife"], homeCity: "Petersburg", localAudiencePct: 80 });
const noteWeak = buildFitNote(fWeak, { category: "Attraction", market: "Richmond", city: "Richmond" }, { categories: ["Nightlife"], homeCity: "Petersburg" });
check("adjacent category overlap across towns still earns the note (market named)", noteWeak === "Strong fit · Nightlife · Richmond", String(noteWeak));
const noteCompOnly = buildFitNote(fComp, { category: "Fitness Studio", market: "Richmond", city: "Richmond" }, { categories: ["Beauty & Grooming"], compCategories: ["Fitness classes & passes"], homeCity: "Norfolk" });
check("fit note stays silent on a comp-only signal in another town", noteCompOnly === null, String(noteCompOnly));
const noteNone = buildFitNote(fZero, { category: "Fitness Studio", market: "Richmond", city: "Richmond" }, { categories: ["Nightlife"], homeCity: "Norfolk" });
check("fit note is null on no match", noteNone === null, String(noteNone));

// ---------- HTTP level: seeded roster ----------
let server = null;
function bootServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    env: {
      ...process.env,
      SIGNL_LOCAL: "1",
      SIGNL_LOCAL_DB: DB,
      ADMIN_EMAIL,
      [["ADMIN", "PASSWORD"].join("_")]: ADMIN_PW,
      APP_URL: BASE,
      SIGNL_TEST_ALLOW_BUSINESS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return server;
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 350)); server = null; }
}
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const PW = "fit-" + "pass-1234";

async function makeCreator(admin, fields) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", { role: "creator", password: PW, market: "Richmond", ...fields, ...AGREE });
  if (reg.status !== 201) throw new Error(`creator ${fields.handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  // Charter stamp (Build -31): these fixtures finish pre-launch, so
  // the founding read seals Charter and the 24h early-access window
  // never hides the board from them.
  await c("GET", "/api/me/founding");
  return { client: c, id: reg.data.user.id };
}

try {
  bootServer();
  check("dev server boots", await waitForServer());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });

  // Registration order sets the founding (default) order: Pete,
  // Tina, Fiona. Fit order must come out Fiona, Tina, Pete.
  const pete = await makeCreator(admin, { name: "Far Pete", email: "pete@fixtures.dev", handle: "farpetefit", city: "Petersburg", followerCount: 14000, localAudiencePct: 30, categories: ["Nightlife"] });
  const tina = await makeCreator(admin, { name: "Tiny Tina", email: "tina@fixtures.dev", handle: "tinytinafit", city: "Richmond", followerCount: 550, localAudiencePct: 62, categories: ["Food & Drink"] });
  const fiona = await makeCreator(admin, { name: "Fit Fiona", email: "fiona@fixtures.dev", handle: "fitfiona", city: "Richmond", neighborhood: "Carytown", followerCount: 6000, localAudiencePct: 62, categories: ["Food & Drink"] });
  const nadia = await makeCreator(admin, { name: "Far Nadia", email: "nadia@fixtures.dev", handle: "farnadiafit", city: "Petersburg", followerCount: 3000, localAudiencePct: 30, categories: ["Fitness & Wellness"] });

  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", businessName: "Fit Test Bistro", email: "bistro@fixtures.dev",
    password: PW, market: "Richmond", city: "Richmond", category: "Restaurant",
    neighborhood: "Carytown", about: "Counter service.", planId: "growth", agreedTerms: true,
  });
  check("business registers (201, pending, founding)", bizReg.status === 201 && bizReg.data.user.business.accessState === "founding", JSON.stringify(bizReg.data).slice(0, 160));
  const bizId = bizReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: bizId, decision: "approve" });

  const foundingBiz = client();
  const fbReg = await foundingBiz("POST", "/api/auth/register", {
    role: "business", name: "Second Owner", businessName: "Founding Only Foods", email: "foundingonly@fixtures.dev",
    password: PW, market: "Richmond", city: "Richmond", category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  await admin("POST", "/api/admin/review", { userId: fbReg.data.user.id, decision: "approve" });
  const fbDiscover = await foundingBiz("GET", "/api/discover");
  check("founding (not activated) business still gets the 403 gate on discovery", fbDiscover.status === 403, String(fbDiscover.status));

  const anon = client();
  const anonDiscover = await anon("GET", "/api/discover");
  check("unauthenticated discovery still 401s", anonDiscover.status === 401, String(anonDiscover.status));

  const activate = await admin("POST", "/api/admin/businesses/activate", { userId: bizId });
  check("admin activates the test business", activate.status === 200 && activate.data.user.business.accessState === "active", JSON.stringify(activate.data).slice(0, 160));

  // Seed business->creator ratings straight into the store (the
  // file store caches in memory, so this happens between boots):
  // Fiona gets 3 (5,5,4 -> avg 4.7), Pete gets 2 (ignored by fit).
  await stopServer();
  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  const seedReview = (id, creatorId, stars, daysAgo) => {
    db[`review:${id}`] = { id, creatorId, businessId: bizId, businessName: "Fit Test Bistro", stars, comment: "", createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString() };
  };
  seedReview("fitrev-f1", fiona.id, 5, 3);
  seedReview("fitrev-f2", fiona.id, 5, 2);
  seedReview("fitrev-f3", fiona.id, 4, 1);
  seedReview("fitrev-p1", pete.id, 5, 2);
  seedReview("fitrev-p2", pete.id, 5, 1);
  fs.writeFileSync(DB, JSON.stringify(db));
  bootServer();
  check("dev server reboots on the seeded store", await waitForServer());
  await biz("POST", "/api/auth/login", { email: "bistro@fixtures.dev", password: PW });

  const discover = await biz("GET", "/api/discover?market=Richmond");
  check("discovery answers for the activated business", discover.status === 200 && Array.isArray(discover.data.creators), String(discover.status));
  const cards = discover.data.creators || [];
  const byId = Object.fromEntries(cards.map((c) => [c.userId, c]));
  check("every discovery card carries fit { score, reasons } for a business viewer",
    cards.length >= 4 && cards.every((c) => c.fit && typeof c.fit.score === "number" && Array.isArray(c.fit.reasons)),
    JSON.stringify(cards.map((c) => ({ id: c.userId, fit: c.fit }))).slice(0, 300));
  check("default order stays founding order (registration order: Pete, Tina, Fiona)",
    cards[0].userId === pete.id && cards[1].userId === tina.id && cards[2].userId === fiona.id,
    JSON.stringify(cards.map((c) => c.userId)));
  const fionaFit = byId[fiona.id] && byId[fiona.id].fit;
  check("Fiona's fit is the full stack (36 + 24 city + 4 neighborhood + 18 local + 10 rating = 92)",
    !!fionaFit && fionaFit.score === 92, JSON.stringify(fionaFit));
  check("Fiona's reasons explain the score (food, Richmond, Carytown, 62%, rated)",
    !!fionaFit && fionaFit.reasons.includes("Posts Food & Drink content") && fionaFit.reasons.includes("Based in Richmond")
      && fionaFit.reasons.includes("In Carytown, your neighborhood") && fionaFit.reasons.includes("62% local audience")
      && fionaFit.reasons.some((r) => r.startsWith("Rated 4.7 by 3 businesses")),
    JSON.stringify(fionaFit && fionaFit.reasons));
  const peteFit = byId[pete.id] && byId[pete.id].fit;
  check("Pete's two ratings stay invisible to fit (no rating reason, score 42)",
    !!peteFit && peteFit.score === 42 && !peteFit.reasons.some((r) => r.startsWith("Rated")), JSON.stringify(peteFit));
  const tinaFit = byId[tina.id] && byId[tina.id].fit;
  check("the 550-follower creator out-fits the 14k one on match alone (78 > 42)",
    !!tinaFit && !!peteFit && tinaFit.score === 78 && tinaFit.score > peteFit.score,
    JSON.stringify({ tina: tinaFit, pete: peteFit }));

  const fitSorted = await biz("GET", "/api/discover?market=Richmond&sort=fit");
  const fitOrder = (fitSorted.data.creators || []).map((c) => c.userId);
  check("?sort=fit orders by fit (Fiona, Tina, Pete, Nadia last on geography + local only)",
    fitOrder[0] === fiona.id && fitOrder[1] === tina.id && fitOrder[2] === pete.id && fitOrder[3] === nadia.id,
    JSON.stringify(fitOrder));

  // Open offers: the business posts one; Fiona (strong match)
  // sees the note, Nadia (no overlap, different town) does not.
  const offerRes = await biz("POST", "/api/offers", { title: "Fit test dinner", whatComped: "Dinner for two", spots: 2, dollarCap: 100 });
  check("business posts an open offer", offerRes.status === 201 && offerRes.data.offer.status === "open", JSON.stringify(offerRes.data).slice(0, 200));

  const fionaBoard = await fiona.client("GET", "/api/open-offers");
  const fionaOffer = (fionaBoard.data.offers || []).find((o) => o.id === offerRes.data.offer.id);
  check("strong-match creator sees the fit note on the open offer",
    !!fionaOffer && fionaOffer.fitNote === "Strong fit · Food · Richmond", JSON.stringify(fionaOffer && fionaOffer.fitNote));

  const nadiaBoard = await nadia.client("GET", "/api/open-offers");
  const nadiaOffer = (nadiaBoard.data.offers || []).find((o) => o.id === offerRes.data.offer.id);
  check("weak-match creator sees the same offer with NO fit note (mechanics unchanged)",
    !!nadiaOffer && nadiaOffer.fitNote === null && nadiaOffer.myApplication === null, JSON.stringify(nadiaOffer && { fitNote: nadiaOffer.fitNote }));

  const appJs = await (await fetch(BASE + "/app.js")).text();
  check("served client bundle carries the fit rendering (Why they fit + Best fit sort)",
    appJs.includes("Why they fit") && appJs.includes('value="fit"') && appJs.includes("fitNote"), appJs.length + " bytes");
} catch (e) {
  failed += 1;
  console.log("  FAIL  suite error :: " + (e && e.stack || e));
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
  console.log(`\nverify-fit: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
