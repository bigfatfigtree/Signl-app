// verify-build162.mjs — Build -162: the sample-offer leak fix.
//
// THE BUG: the demo-partner seed (POST /api/admin/partners/demo ->
// ensureDemoPartner) writes a "Sample Cafe" business and an OPEN
// offer ("Sample visit: try the new seasonal menu", sample:true,
// no address, no dollarCap, no kind) into Virginia Beach. The
// creator offer surfaces fenced only the later testOnly stamp, so
// a real founding creator saw the prop in Find offers and Maggie
// announced "1 offer waiting" for it.
//
// THE FIX (one shared predicate, offerFencedForCreators): sample
// records, tester-owned businesses' offers, and offers in markets
// that have not launched never reach a creator — board, /offers
// feed, Sig counts, apply, accept. The testOnly door for tester
// creators is preserved exactly.
//
// PHASE 1 (this process, SIGNL_TEST_ALLOW_BUSINESS=1 like every
// suite): seed the demo partner through the REAL admin route —
// the exact production mechanism — then prove a real Virginia
// Beach creator cannot see, count, or apply to the Sample Cafe
// offer, and that the record itself is NOT deleted (read-layer
// fence; the walkthrough furniture stays in the store).
// PHASE 2 (child process, TEST_MODE OFF, market flags from the
// store): prove the founding-market gate itself — a real offer
// from a real business in a not-launched market is hidden, a real
// offer in the one launched market (Nashville) still shows, and
// the testOnly door still opens for a tester creator in the
// founding market while the sample record stays hidden from her
// too (the Preview-as-Creator honesty property).
// Run: node scripts/verify-build162.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const PHASE2 = process.argv.includes("--phase2");
const DB_PATH = path.join(os.tmpdir(), `signl-verify-build162${PHASE2 ? "-p2" : ""}-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "fixture-admin-pw";
process.env.APP_URL = "http://localhost";
if (PHASE2) delete process.env.SIGNL_TEST_ALLOW_BUSINESS;
else process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const auth = require("../netlify/functions/lib/auth.js");
const { handler } = require("../netlify/functions/api.js");

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
const ts = new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

async function seedUser({ role, email, name, market, tester = false, business = null, creator = null }) {
  const { salt, hash } = auth.hashPassword(PW);
  const u = {
    id: crypto.randomUUID(), role, email, name, status: "approved", tester: !!tester,
    market, city: market, country: "United States",
    passwordSalt: salt, passwordHash: hash,
    createdAt: ts, updatedAt: ts, reviewedAt: ts,
    termsVersion: "2026-10-19", termsAcceptedAt: ts,
    creator, business, partner: null,
  };
  await store.set(`user:${u.id}`, u);
  await store.set(`email:${email}`, { userId: u.id });
  return u;
}
function creatorProfile(handle) {
  return {
    handle, followerCount: 5200, totalAudience: 5200,
    audienceStack: { instagram: 5200 }, tierBand: "Locals",
    categories: ["Food & Drink"], localAudiencePct: 60,
    localAudienceSource: "Self-reported", profileComplete: true, hasPhoto: false,
  };
}
async function seedOffer(o) {
  await store.set(`offer:${o.id}`, o);
  return o;
}
async function login(email) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email, password: PW });
  return { c, r };
}

if (!PHASE2) {
  console.log("Phase 1 — the real demo-partner seed, fenced (TEST_MODE on):");
  const admin = makeClient();
  const lr = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin login succeeds", lr.status === 200, `got ${lr.status}`);

  // The exact production mechanism that put Sample Cafe in front
  // of real creators this morning.
  const seeded = await admin("POST", "/api/admin/partners/demo", {});
  check("demo partner seed route runs (created)", seeded.status === 200 && seeded.data && seeded.data.created === true, `got ${seeded.status} ${JSON.stringify(seeded.data).slice(0, 160)}`);
  const offerRows = (await store.list("offer:")).map((r) => r.value).filter(Boolean);
  const sampleOffer = offerRows.find((o) => o.sample && o.status === "open");
  check("the seed wrote the Sample Cafe offer (sample:true, open, Virginia Beach)",
    !!sampleOffer && sampleOffer.market === "Virginia Beach", JSON.stringify(offerRows.map((o) => ({ t: o.title, s: o.sample, m: o.market }))).slice(0, 200));
  const sampleBiz = sampleOffer ? await store.get(`user:${sampleOffer.businessId}`) : null;
  check("the seeded business is Sample Cafe, tester-flagged, with no address on file",
    !!sampleBiz && sampleBiz.business && sampleBiz.business.businessName === "Sample Cafe" && sampleBiz.tester === true && !sampleBiz.business.neighborhood && !sampleBiz.business.address,
    JSON.stringify(sampleBiz && sampleBiz.business).slice(0, 200));

  // A real founding creator in Virginia Beach (life_aslo's seat).
  const vb = await seedUser({ role: "creator", email: "vbcreator162@fixtures.dev", name: "VB Fixture Creator", market: "Virginia Beach", creator: creatorProfile("vbfixture162") });
  const { c: vbApi, r: vbLogin } = await login(vb.email);
  check("VB creator login succeeds", vbLogin.status === 200, `got ${vbLogin.status}`);

  const board = await vbApi("GET", "/api/open-offers");
  check("Find offers board answers 200", board.status === 200, `got ${board.status}`);
  check("board shows ZERO offers to the founding-market creator", Array.isArray(board.data.offers) && board.data.offers.length === 0, JSON.stringify(board.data).slice(0, 240));
  check("Sample Cafe is not on the board", !(JSON.stringify(board.data).includes("Sample Cafe")));

  const feed = await vbApi("GET", "/api/offers");
  check("creator /offers feed shows ZERO offers", feed.status === 200 && Array.isArray(feed.data.offers) && feed.data.offers.length === 0, `got ${feed.status} ${JSON.stringify(feed.data).slice(0, 200)}`);

  const apply = await vbApi("POST", `/api/offers/${sampleOffer.id}/apply`, {});
  check("applying to the Sample Cafe offer is refused 404", apply.status === 404, `got ${apply.status} ${JSON.stringify(apply.data).slice(0, 160)}`);

  const sig = await vbApi("GET", "/api/sig/home");
  const chips = (sig.data && sig.data.chips) || [];
  check("Maggie's home chips carry NO 'offer waiting' for the sample prop", sig.status === 200 && !chips.some((ch) => /offer/i.test(ch) && /waiting/i.test(ch)), `chips=${JSON.stringify(chips)}`);

  const stillThere = await store.get(`offer:${sampleOffer.id}`);
  check("the sample record itself is untouched in the store (read-layer fence, no deletion)", !!stillThere && stillThere.sample === true && stillThere.status === "open");

  console.log(`\nPhase 1: ${passed} passed, ${failed} failed`);
  if (failed) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }

  console.log("\nPhase 2 — child process, TEST_MODE off, market flags from the store:");
  const childEnv = { ...process.env };
  delete childEnv.SIGNL_TEST_ALLOW_BUSINESS;
  try {
    execFileSync(process.execPath, [new URL(import.meta.url).pathname, "--phase2"], { stdio: "inherit", env: childEnv });
  } catch (e) {
    console.log("  FAIL  phase 2 child process exited non-zero");
    process.exit(1);
  }
  console.log("\nBUILD162 VERIFY: phase 1 + phase 2 all green");
} else {
  console.log("Phase 2 — founding-market gate with real flags (TEST_MODE off):");
  // Only Nashville is launched.
  await store.set("config:markets", { flags: { Nashville: true }, updatedAt: ts });

  const vbBiz = await seedUser({ role: "business", email: "vbbiz162@fixtures.dev", name: "VB Real Biz", market: "Virginia Beach", business: { businessName: "Harbor Lights Kitchen", category: "Restaurants", plan: "growth", accessState: "active" } });
  const nashBiz = await seedUser({ role: "business", email: "nashbiz162@fixtures.dev", name: "Nash Real Biz", market: "Nashville", business: { businessName: "Gulch Coffee Co", category: "Coffee & Bakery", plan: "growth", accessState: "active" } });
  const testerBiz = await seedUser({ role: "business", email: "testbiz162@fixtures.dev", name: "Test Biz", market: "Virginia Beach", tester: true, business: { businessName: "Salt Line Test Kitchen", category: "Restaurants", plan: "growth", accessState: "active" } });
  const sampleBiz = await seedUser({ role: "business", email: "samplecafe162@fixtures.dev", name: "Sample Cafe Owner", market: "Virginia Beach", tester: true, business: { businessName: "Sample Cafe", category: "Coffee & Bakery", plan: "growth", accessState: "active" } });

  const baseOffer = { lane: "open", kind: "comp", creatorId: null, creatorHandle: null, covers: 2, cashRate: null, targetTiers: null, whatComped: "A meal for two", includes: "Two entrees", experience: "", dollarCap: 120, visitWindow: "", windowMode: "7days", spots: 2, status: "open", createdAt: daysAgo(3), updatedAt: daysAgo(3), publishedAt: daysAgo(3) };
  const vbRealOffer = await seedOffer({ ...baseOffer, id: crypto.randomUUID(), businessId: vbBiz.id, businessName: vbBiz.business.businessName, market: "Virginia Beach", category: "Restaurants", title: "Real VB dinner invite (market not launched)" });
  const nashOffer = await seedOffer({ ...baseOffer, id: crypto.randomUUID(), businessId: nashBiz.id, businessName: nashBiz.business.businessName, market: "Nashville", category: "Coffee & Bakery", title: "Real Nashville coffee invite (market launched)" });
  const testOffer = await seedOffer({ ...baseOffer, id: crypto.randomUUID(), businessId: testerBiz.id, businessName: testerBiz.business.businessName, market: "Virginia Beach", category: "Restaurants", title: "Test kitchen dinner (testOnly)", testOnly: true });
  const sampleOffer = await seedOffer({ id: crypto.randomUUID(), businessId: sampleBiz.id, market: "Virginia Beach", title: "Sample visit: try the new seasonal menu", status: "open", spots: 3, sample: true, createdAt: ts, updatedAt: ts });

  const vbCreator = await seedUser({ role: "creator", email: "vbcreator162p2@fixtures.dev", name: "VB Creator P2", market: "Virginia Beach", creator: creatorProfile("vbfixture162p2") });
  const vbTester = await seedUser({ role: "creator", email: "vbtester162p2@fixtures.dev", name: "VB Tester P2", market: "Virginia Beach", tester: true, creator: creatorProfile("vbtester162p2") });
  const nashCreator = await seedUser({ role: "creator", email: "nashcreator162p2@fixtures.dev", name: "Nash Creator P2", market: "Nashville", creator: creatorProfile("nashfixture162p2") });

  const vbLogin = await login(vbCreator.email);
  check("VB creator login succeeds (phase 2)", vbLogin.r.status === 200, `got ${vbLogin.r.status}`);
  const board = await vbLogin.c("GET", "/api/open-offers");
  check("founding-market board is EMPTY: real offer, sample and testOnly all fenced", board.status === 200 && Array.isArray(board.data.offers) && board.data.offers.length === 0, JSON.stringify(board.data).slice(0, 260));
  const feed = await vbLogin.c("GET", "/api/offers");
  check("founding-market /offers feed is EMPTY", feed.status === 200 && Array.isArray(feed.data.offers) && feed.data.offers.length === 0, JSON.stringify(feed.data).slice(0, 200));
  const applySample = await vbLogin.c("POST", `/api/offers/${sampleOffer.id}/apply`, {});
  check("apply to the sample-shaped offer is refused in a founding market (market gate or fence)", [403, 404].includes(applySample.status), `got ${applySample.status} ${JSON.stringify(applySample.data).slice(0, 160)}`);
  const applyTest = await vbLogin.c("POST", `/api/offers/${testOffer.id}/apply`, {});
  check("apply to a testOnly offer is refused for a real creator (market gate or fence)", [403, 404].includes(applyTest.status), `got ${applyTest.status} ${JSON.stringify(applyTest.data).slice(0, 160)}`);
  const appRows = (await store.list("application:")).map((r) => r.value).filter(Boolean);
  check("no application record exists against the sample or testOnly offers", !appRows.some((a) => a.offerId === sampleOffer.id || a.offerId === testOffer.id), JSON.stringify(appRows.map((a) => a.offerId)).slice(0, 160));
  const sig = await vbLogin.c("GET", "/api/sig/home");
  const chips = (sig.data && sig.data.chips) || [];
  check("Maggie announces no waiting offer in the founding market", sig.status === 200 && !chips.some((ch) => /offer/i.test(ch) && /waiting/i.test(ch)), `chips=${JSON.stringify(chips)}`);

  const testerLogin = await login(vbTester.email);
  const testerBoard = await testerLogin.c("GET", "/api/open-offers");
  const testerTitles = (testerBoard.data.offers || []).map((o) => o.title);
  check("tester creator still sees the testOnly door in the founding market", testerBoard.status === 200 && testerTitles.includes("Test kitchen dinner (testOnly)"), JSON.stringify(testerTitles).slice(0, 200));
  check("tester creator does NOT see Sample Cafe (preview honesty)", !testerTitles.some((t) => /Sample/.test(t)), JSON.stringify(testerTitles).slice(0, 200));
  check("tester creator does NOT see the real VB offer (market gate applies to testers too)", !testerTitles.includes("Real VB dinner invite (market not launched)"), JSON.stringify(testerTitles).slice(0, 200));

  const nashLogin = await login(nashCreator.email);
  const nashBoard = await nashLogin.c("GET", "/api/open-offers");
  const nashTitles = (nashBoard.data.offers || []).map((o) => o.title);
  check("live-market creator SEES the real Nashville offer (positive control)", nashBoard.status === 200 && nashTitles.includes("Real Nashville coffee invite (market launched)"), JSON.stringify(nashTitles).slice(0, 240));
  const nashFeed = await nashLogin.c("GET", "/api/offers");
  check("live-market /offers feed carries the real offer", nashFeed.status === 200 && (nashFeed.data.offers || []).some((o) => o.id === nashOffer.id), JSON.stringify(nashFeed.data).slice(0, 200));

  console.log(`\nPhase 2: ${passed} passed, ${failed} failed`);
  if (failed) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
}
