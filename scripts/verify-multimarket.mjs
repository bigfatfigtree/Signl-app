// End-to-end verification of the multi-market push (Jeff,
// 2026-11-01): per-market audience shares, listing + ranking in
// every strong market, the richer public profile (rate card as
// listed offerings, past work, audience visual data), and the
// SEO layer (indexable finished profiles with structured data,
// the live app sitemap, claim-tier stubs still noindex and
// unlisted).
//
// Walks one creator seeded strong in TWO markets (Nashville
// home 60%, Austin 20% reported) plus a below-floor third
// (Richmond 3%): she is listed and ranked in Nashville and
// Austin only, an Austin business finds her by her Austin
// share, an Austin open offer reaches her board and takes her
// application (snapshotted and stack-ranked at her Austin
// share), a direct Austin offer accepts, and a Nashville-only
// creator is refused the same offer with the plain-words
// reason. Her finished page carries the markets, the rate
// card, the breakdown, the JSON-LD offer, and a sitemap entry;
// a claimed-but-unfinished stub stays noindex and out of the
// sitemap.
// Run: node scripts/verify-multimarket.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const am = require("../netlify/functions/lib/audience-markets.js");
const { buildProfilePageHtml } = require("../netlify/functions/lib/profile-meta.js");

const PORT = 8947;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pw-63";
const DB = path.join(os.tmpdir(), `signl-verify-multimarket-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`);
  }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
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

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + "/api/bootstrap");
      if (res.ok) return true;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

// ---------- unit: the audience-markets lib ----------
const fakeUser = (over) => ({
  role: "creator",
  market: "Nashville",
  creator: { localAudiencePct: 60, audienceMarkets: [{ market: "Austin", pct: 20 }, { market: "Richmond", pct: 3 }] },
  ...(over || {}),
});
check("lib: home share reads localAudiencePct", am.audienceShareInMarket(fakeUser(), "Nashville") === 60);
check("lib: extra-market share reads audienceMarkets", am.audienceShareInMarket(fakeUser(), "Austin") === 20);
check("lib: unreported market reads null, never invented", am.audienceShareInMarket(fakeUser(), "Denver") === null);
check("lib: listed = home + shares at/above the floor", JSON.stringify(am.listedMarketsFor(fakeUser()).map((e) => e.market)) === JSON.stringify(["Nashville", "Austin"]), JSON.stringify(am.listedMarketsFor(fakeUser())));
check("lib: below-floor share does not list", am.isListedInMarket(fakeUser(), "Richmond") === false && am.isListedInMarket(fakeUser(), "Austin") === true);
check("lib: breakdown segments + remainder are arithmetic only", (() => { const b = am.audienceBreakdownFor(fakeUser()); return b && b.segments.length === 2 && b.elsewherePct === 20; })(), JSON.stringify(am.audienceBreakdownFor(fakeUser())));
check("lib: normalize drops home, unknown, dupes (max wins), clamps, sorts",
  JSON.stringify(am.normalizeAudienceMarkets([
    { market: "Nashville", pct: 50 },
    { market: "Atlantis", pct: 40 },
    { market: "Austin", pct: 15 },
    { market: "Austin", pct: 20 },
    { market: "Denver", pct: 140 },
    { market: "Richmond", pct: -2 },
    { market: "Chicago", pct: "x" },
  ], "Nashville")) === JSON.stringify([{ market: "Denver", pct: 100 }, { market: "Austin", pct: 20 }]),
  JSON.stringify(am.normalizeAudienceMarkets([{ market: "Austin", pct: 15 }, { market: "Austin", pct: 20 }], "Nashville")));
check("lib: unlisted creator lists nowhere", am.isListedInMarket({ role: "creator", market: "Not listed yet", creator: { localAudiencePct: null, audienceMarkets: [{ market: "Austin", pct: 40 }] } }, "Austin") === false);

// ---------- unit: the served head ----------
const SHELL = "<!DOCTYPE html><html><head><title>SIGNL</title><meta name=\"description\" content=\"generic\"><meta name=\"robots\" content=\"noindex\"></head><body></body></html>";
const metaHtml = buildProfilePageHtml(SHELL, {
  name: "Mia Multi",
  handle: "miamulti",
  place: "Nashville",
  tierBand: "Locals",
  localAudiencePct: 60,
  photoUrl: null,
  categories: ["Food & Drink"],
  listedMarkets: [{ market: "Nashville", pct: 60, home: true }, { market: "Austin", pct: 20, home: false }],
  paidRate: 200,
  origin: "https://app.joinsignl.com",
});
check("meta: finished page flips robots to index, follow", metaHtml.includes("index, follow"));
check("meta: description names the other ranked market", metaHtml.includes("Also ranked in Austin (20% of their audience)"));
const ldMatch = metaHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
let ld = null;
try { ld = ldMatch ? JSON.parse(ldMatch[1]) : null; } catch (e) { ld = null; }
check("meta: JSON-LD parses and carries the offer at the listed rate",
  !!ld && ld["@type"] === "ProfilePage" && ld.mainEntity.makesOffer && ld.mainEntity.makesOffer.price === 200 && ld.mainEntity.makesOffer.priceCurrency === "USD",
  ldMatch ? ldMatch[1].slice(0, 200) : "no ld block");
check("meta: JSON-LD areaServed covers every ranked market",
  !!ld && JSON.stringify((ld.mainEntity.makesOffer.itemOffered.areaServed || []).map((a) => a.name).sort()) === JSON.stringify(["Austin", "Nashville"]));
check("meta: JSON-LD knowsAbout carries the categories",
  !!ld && JSON.stringify(ld.mainEntity.knowsAbout) === JSON.stringify(["Food & Drink"]));
const metaNoRate = buildProfilePageHtml(SHELL, {
  name: "No Rate", handle: "norate", place: "Nashville", tierBand: "Locals", localAudiencePct: 40, photoUrl: null,
  categories: [], listedMarkets: [{ market: "Nashville", pct: 40, home: true }], paidRate: null, origin: "https://app.joinsignl.com",
});
check("meta: no listed rate means no offer node is invented", !metaNoRate.includes("makesOffer"));

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: {
    ...process.env,
    SIGNL_LOCAL: "1",
    SIGNL_LOCAL_DB: DB,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    APP_URL: BASE,
    SIGNL_TEST_ALLOW_BUSINESS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  // ---------- the two-market creator ----------
  const mia = client();
  const miaReg = await mia("POST", "/api/auth/register", {
    role: "creator",
    name: "Mia Multi",
    email: "mia@fixtures.dev",
    password: "mia-pass-1234",
    market: "Nashville",
    city: "Nashville",
    handle: "miamulti",
    followerCount: 9000,
    localAudiencePct: 60,
    categories: ["Food & Drink"],
    ...AGREE,
  });
  check("two-market creator registers complete (201)", miaReg.status === 201 && miaReg.data.user.creator.profileComplete === true, JSON.stringify(miaReg.data).slice(0, 200));
  const miaId = miaReg.data.user.id;
  const approveMia = await admin("POST", "/api/admin/review", { userId: miaId, decision: "approve" });
  check("admin approves the two-market creator", approveMia.status === 200 && approveMia.data.user.status === "approved");

  const miaPatch = await mia("PATCH", "/api/me/profile", {
    paidRate: 200,
    licensingFee: 75,
    publicPage: true,
    bestWork: ["https://www.instagram.com/reel/ABC123xyz/"],
    audienceMarkets: [
      { market: "Austin", pct: 20 },
      { market: "Richmond", pct: 3 },
      { market: "Nashville", pct: 50 },
      { market: "Atlantis", pct: 40 },
      { market: "Austin", pct: 15 },
    ],
  });
  check("profile PATCH stores the cleaned shares only (home + unknown dropped, dupe maxed)",
    miaPatch.status === 200 && JSON.stringify(miaPatch.data.user.creator.audienceMarkets) === JSON.stringify([{ market: "Austin", pct: 20 }, { market: "Richmond", pct: 3 }]),
    JSON.stringify(miaPatch.data.user && miaPatch.data.user.creator && miaPatch.data.user.creator.audienceMarkets));

  const founding = await mia("GET", "/api/me/founding");
  const miaCard = founding.data.card || {};
  check("dashboard card lists Nashville (home, 60) and Austin (20), not below-floor Richmond",
    JSON.stringify((miaCard.listedMarkets || []).map((e) => [e.market, e.pct, e.home])) === JSON.stringify([["Nashville", 60, true], ["Austin", 20, false]]),
    JSON.stringify(miaCard.listedMarkets));

  // ---------- the home-only creator ----------
  const ned = client();
  const nedReg = await ned("POST", "/api/auth/register", {
    role: "creator",
    name: "Ned Nashonly",
    email: "ned@fixtures.dev",
    password: "ned-pass-1234",
    market: "Nashville",
    city: "Nashville",
    handle: "nednashonly",
    followerCount: 6000,
    localAudiencePct: 45,
    categories: ["Food & Drink"],
    ...AGREE,
  });
  const nedId = nedReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: nedId, decision: "approve" });
  const nedFounding = await ned("GET", "/api/me/founding");
  check("home-only creator's dashboard card lists home only",
    JSON.stringify(((nedFounding.data.card || {}).listedMarkets || []).map((e) => e.market)) === JSON.stringify(["Nashville"]),
    JSON.stringify((nedFounding.data.card || {}).listedMarkets));

  // ---------- the Austin business ----------
  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business",
    name: "Austin Owner",
    businessName: "Multi Market Tacos",
    email: "atxbiz@fixtures.dev",
    password: "business-pass-123",
    market: "Austin",
    city: "Austin",
    category: "Restaurant",
    planId: "growth",
    agreedTerms: true,
  });
  const bizId = bizReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: bizId, decision: "approve" });
  const activateBiz = await admin("POST", "/api/admin/businesses/activate", { userId: bizId });
  check("Austin business approved + activated", activateBiz.status === 200 && activateBiz.data.user.business.accessState === "active");

  // ---------- discovery follows the listing ----------
  const discAustin = await biz("GET", "/api/discover?market=Austin");
  const miaAustinCard = (discAustin.data.creators || []).find((c) => c.userId === miaId);
  check("Austin discovery finds the Nashville-based creator", !!miaAustinCard, JSON.stringify((discAustin.data.creators || []).map((c) => c.userId)));
  check("her Austin card reads her AUSTIN share and names the market context",
    !!miaAustinCard && miaAustinCard.profile.localAudiencePct === 20 && miaAustinCard.marketContext && miaAustinCard.marketContext.market === "Austin" && miaAustinCard.marketContext.homeMarket === "Nashville" && typeof miaAustinCard.localImpactScore === "number",
    JSON.stringify(miaAustinCard && { pct: miaAustinCard.profile.localAudiencePct, ctx: miaAustinCard.marketContext, score: miaAustinCard.localImpactScore }));
  const discAustinMin = await biz("GET", "/api/discover?market=Austin&minLocalPct=25");
  check("minLocalPct reads the in-market share (25 shuts her out)", !(discAustinMin.data.creators || []).some((c) => c.userId === miaId));
  const discAustinMin15 = await biz("GET", "/api/discover?market=Austin&minLocalPct=15");
  check("minLocalPct reads the in-market share (15 lets her in)", (discAustinMin15.data.creators || []).some((c) => c.userId === miaId));
  const discRichmond = await biz("GET", "/api/discover?market=Richmond");
  check("Richmond discovery does NOT find her (3% is below the listing floor)", !(discRichmond.data.creators || []).some((c) => c.userId === miaId));
  const discNash = await biz("GET", "/api/discover?market=Nashville");
  const miaNashCard = (discNash.data.creators || []).find((c) => c.userId === miaId);
  check("Nashville discovery reads her home share, no market context",
    !!miaNashCard && miaNashCard.profile.localAudiencePct === 60 && miaNashCard.marketContext === null,
    JSON.stringify(miaNashCard && { pct: miaNashCard.profile.localAudiencePct, ctx: miaNashCard.marketContext }));

  // ---------- the Local List follows the listing ----------
  const llAustin = await client()("GET", "/api/public/local-list?market=Austin");
  const llAustinEntries = ((llAustin.data && llAustin.data.categories) || []).flatMap((c) => c.creators || []);
  const llMia = llAustinEntries.find((e) => e.handle === "miamulti");
  check("Local List for Austin carries her, ranked by her Austin share, home market named",
    !!llMia && llMia.localAudiencePct === 20 && llMia.homeMarket === "Nashville", JSON.stringify(llMia));
  const llRichmond = await client()("GET", "/api/public/local-list?market=Richmond");
  const llRichmondEntries = ((llRichmond.data && llRichmond.data.categories) || []).flatMap((c) => c.creators || []);
  check("Local List for Richmond does not carry her", !llRichmondEntries.some((e) => e.handle === "miamulti"));

  // ---------- offers follow the listing ----------
  const openOffer = await biz("POST", "/api/offers", { title: "Austin tasting night", whatComped: "Tasting menu for two", dollarCap: 100, spots: 2, visitWindow: "Any evening this week" });
  check("Austin business posts an open offer", openOffer.status === 201 && openOffer.data.offer.status === "open", JSON.stringify(openOffer.data).slice(0, 200));
  const offerId = openOffer.data.offer.id;

  const miaBoard = await mia("GET", "/api/open-offers");
  check("the Austin offer reaches her board (she is listed in Austin)", (miaBoard.data.offers || []).some((o) => o.id === offerId), JSON.stringify((miaBoard.data.offers || []).map((o) => o.id)));
  const nedBoard = await ned("GET", "/api/open-offers");
  check("the Austin offer does NOT reach the Nashville-only creator's board", !(nedBoard.data.offers || []).some((o) => o.id === offerId));
  const nedApply = await ned("POST", `/api/offers/${offerId}/apply`, {});
  check("the Nashville-only creator's application is refused with the listing reason (403)",
    nedApply.status === 403 && /not listed in/.test(nedApply.data.error || ""), JSON.stringify(nedApply.data));
  const miaApply = await mia("POST", `/api/offers/${offerId}/apply`, {});
  check("her application lands (201) snapshotted at her AUSTIN share",
    miaApply.status === 201 && miaApply.data.application.snapshot.localAudiencePct === 20, JSON.stringify(miaApply.data).slice(0, 250));
  const stack = await biz("GET", `/api/offers/${offerId}/applications`);
  const miaStackEntry = (stack.data.applications || []).find((a) => a.creatorId === miaId);
  check("the business stack ranks her on the in-market share and names both markets",
    !!miaStackEntry && miaStackEntry.creator.localAudiencePct === 20 && miaStackEntry.creator.shareMarket === "Austin" && miaStackEntry.creator.homeMarket === "Nashville" && miaStackEntry.rankParts.localPct === 20,
    JSON.stringify(miaStackEntry && miaStackEntry.creator));

  const directOffer = await biz("POST", "/api/offers", { title: "Direct: launch night", whatComped: "Dinner for two", dollarCap: 80, spots: 1, creatorId: miaId });
  check("Austin business sends her a direct offer", directOffer.status === 201, JSON.stringify(directOffer.data).slice(0, 200));
  const accept = await mia("POST", `/api/offers/${directOffer.data.offer.id}/accept`, { agreedVisitRules: true });
  check("she accepts the direct offer from her second market (booking created)",
    accept.status === 201 && !!accept.data.booking && !!accept.data.booking.code, `${accept.status} ${JSON.stringify(accept.data).slice(0, 200)}`);

  // ---------- the finished public profile ----------
  const anon = client();
  const pub = await anon("GET", "/api/c/miamulti");
  const pp = pub.data.profile || {};
  check("public page resolves for anyone (tier 0)", pub.status === 200 && pp.handle === "miamulti", `${pub.status}`);
  check("public payload lists both markets with their shares",
    JSON.stringify((pp.listedMarkets || []).map((e) => [e.market, e.pct])) === JSON.stringify([["Nashville", 60], ["Austin", 20]]),
    JSON.stringify(pp.listedMarkets));
  check("public payload carries the audience breakdown (60 + 20 + 20 everywhere else)",
    !!pp.audienceBreakdown && pp.audienceBreakdown.segments.length === 2 && pp.audienceBreakdown.elsewherePct === 20,
    JSON.stringify(pp.audienceBreakdown));
  check("public payload carries the rate card as listed offerings at tier 0",
    Array.isArray(pp.rateCard) && pp.rateCard.some((r) => r.kind === "comp") && pp.rateCard.some((r) => r.kind === "paid" && r.price === 200) && pp.rateCard.some((r) => r.kind === "license" && r.price === 75) && pp.paidRate === 200 && pp.licensingFee === 75,
    JSON.stringify(pp.rateCard));
  check("public payload carries her past-work links",
    Array.isArray(pp.pastWork) && pp.pastWork.length === 1 && pp.pastWork[0].url.includes("instagram.com/reel/ABC123xyz"),
    JSON.stringify(pp.pastWork));
  check("public payload still hides follower counts and the stack at tier 0",
    pp.followerCount === undefined && pp.totalAudience === undefined && pp.audienceStack === undefined && pp.socialLinks === undefined,
    JSON.stringify(Object.keys(pp)));

  const pageRes = await fetch(BASE + "/c/miamulti");
  const pageHtml = await pageRes.text();
  check("served page is indexable (index, follow baked in)", pageHtml.includes("index, follow"));
  check("served page names the second market in its meta description", pageHtml.includes("Also ranked in Austin"));
  const pageLdMatch = pageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let pageLd = null;
  try { pageLd = pageLdMatch ? JSON.parse(pageLdMatch[1]) : null; } catch (e) { pageLd = null; }
  check("served page JSON-LD carries the ranked markets and the listed rate",
    !!pageLd && pageLd.mainEntity.makesOffer.price === 200 && (pageLd.mainEntity.makesOffer.itemOffered.areaServed || []).some((a) => a.name === "Austin"),
    pageLdMatch ? pageLdMatch[1].slice(0, 200) : "no ld block in served page");

  // ---------- the claim-tier stub stays dark to search ----------
  const stub = client();
  const stubReg = await stub("POST", "/api/auth/register", {
    role: "creator",
    quickClaim: true,
    email: "stub@fixtures.dev",
    password: "stub-pass-1234",
    market: "Nashville",
    handle: "stubbyc",
    ...AGREE,
  });
  const stubId = stubReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: stubId, decision: "approve" });
  const stubPageRes = await fetch(BASE + "/c/stubbyc");
  const stubHtml = await stubPageRes.text();
  check("claim-tier stub page stays noindex even after approval", !stubHtml.includes("index, follow") && stubHtml.includes("noindex"));

  // ---------- the sitemap ----------
  const smRes = await fetch(BASE + "/sitemap.xml");
  const smText = await smRes.text();
  check("sitemap answers XML", smRes.status === 200 && (smRes.headers.get("content-type") || "").includes("xml") && smText.includes("<urlset"), `${smRes.status} ${smRes.headers.get("content-type")}`);
  check("sitemap lists the finished public profile", smText.includes("/c/miamulti"), smText.slice(0, 300));
  check("sitemap never lists the claim-tier stub", !smText.includes("/c/stubbyc"));

  // ---------- write-path discipline ----------
  const clampPatch = await mia("PATCH", "/api/me/profile", { audienceMarkets: [{ market: "Denver", pct: 140 }] });
  check("a share over 100 clamps to 100 at write",
    clampPatch.status === 200 && JSON.stringify(clampPatch.data.user.creator.audienceMarkets) === JSON.stringify([{ market: "Denver", pct: 100 }]),
    JSON.stringify(clampPatch.data.user && clampPatch.data.user.creator && clampPatch.data.user.creator.audienceMarkets));

  console.log(`\nMulti-market verification: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("FAILURES:");
    for (const f of failures) console.log(" - " + f);
  }
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
process.exit(failed ? 1 : 0);
