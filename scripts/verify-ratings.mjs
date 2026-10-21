// Business-to-creator RATINGS (Jeff, 2026-10-20 late): creators
// carry Momentum points AND a star rating from businesses. This
// suite walks the full rating lifecycle against the real server:
//   - a rating opens only once the post proof is in (booking
//     completed); before proof it is refused
//   - only the business that owns the booking can rate it, once,
//     and it cannot be edited after (a second POST is refused)
//   - the comment is capped at 280 characters server-side
//   - ratingAvg / ratingCount aggregate server-side from the
//     rating records and ride the discovery card, the creator's
//     own founding card, and the applicant stack
//   - an unrated creator reads ratingAvg null, ratingCount 0
//     (never 0.0 stars) on every surface
//   - the public /c/ profile shows NO rating data below 3 ratings
//     and the full rating at 3
//   - ratings mint no Momentum points for anyone
//   - the mirror flow (creator reviews the business, +10 Momentum)
//     is untouched
// Run: node scripts/verify-ratings.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8935;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-ratings-${Date.now()}.json`);

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

const admin = client();

async function makeCreator(handle, email, name) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator",
    name,
    email,
    password: "creator-pass-123",
    market: "Hampton Roads",
    city: "Virginia Beach",
    handle,
    tierBand: "Locals",
    followerCount: 8400,
    avgViews: 6200,
    localAudiencePct: 62,
    categories: ["Food & Drink"],
    bio: "Verification account created by scripts/verify-ratings.mjs",
    agreedHonestPosts: true,
    agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} registration failed: ${JSON.stringify(reg.data)}`);
  const approve = await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  if (approve.status !== 200) throw new Error(`creator ${handle} approval failed`);
  return { client: c, id: reg.data.user.id, handle };
}

async function makeBusiness(businessName, email) {
  const b = client();
  const reg = await b("POST", "/api/auth/register", {
    role: "business",
    name: `${businessName} Owner`,
    businessName,
    email,
    password: "business-pass-123",
    market: "Hampton Roads",
    city: "Norfolk",
    category: "Restaurant",
    planId: "growth",
    agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} registration failed: ${JSON.stringify(reg.data)}`);
  const id = reg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  const act = await admin("POST", "/api/admin/businesses/activate", { userId: id });
  if (act.status !== 200) throw new Error(`business ${businessName} activation failed`);
  return { client: b, id, businessName };
}

// Offer -> accept -> redeem. Returns the booking BEFORE the post
// proof lands, so the suite can prove ratings stay shut until
// proof exists.
async function visitRedeemed(biz, creator, title) {
  const offer = await biz.client("POST", "/api/offers", {
    title,
    whatComped: "Dinner for two",
    dollarCap: 75,
    spots: 1,
    visitWindow: "Any night",
    creatorId: creator.id,
  });
  if (offer.status !== 201) throw new Error(`offer failed: ${JSON.stringify(offer.data)}`);
  const accept = await creator.client("POST", `/api/offers/${offer.data.offer.id}/accept`, { visitDate: "2026-10-22" });
  if (accept.status !== 201) throw new Error(`accept failed: ${JSON.stringify(accept.data)}`);
  const booking = accept.data.booking;
  const redeem = await biz.client("POST", "/api/counter/redeem", { code: booking.code });
  if (redeem.status !== 200) throw new Error(`redeem failed: ${JSON.stringify(redeem.data)}`);
  return booking;
}

async function submitPost(creator, bookingId, slug) {
  const post = await creator.client("POST", "/api/posts", {
    bookingId,
    url: `https://www.instagram.com/p/${slug}/`,
    includesDisclosure: true,
  });
  if (post.status !== 201) throw new Error(`post failed: ${JSON.stringify(post.data)}`);
  return post.data.post;
}

async function discoveryCard(biz, creatorId) {
  const disc = await biz.client("GET", "/api/discover?market=Hampton%20Roads");
  return (disc.data.creators || []).find((c) => c.userId === creatorId) || {};
}

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  const rated = await makeCreator("ratedeats757", "rated@example.com", "Rated Creator");
  const unrated = await makeCreator("unratedeats757", "unrated@example.com", "Unrated Creator");
  const biz1 = await makeBusiness("Ratings Table One", "biz1@example.com");
  const biz2 = await makeBusiness("Ratings Table Two", "biz2@example.com");
  const biz3 = await makeBusiness("Ratings Table Three", "biz3@example.com");
  check("fixtures ready: 2 creators, 3 businesses approved and active", true);

  // --- unrated creator: null, never zero, on every surface ---
  const cardU0 = await discoveryCard(biz1, unrated.id);
  check("unrated creator: discovery ratingAvg is null and ratingCount 0 (never 0.0)", cardU0.ratingAvg === null && cardU0.ratingCount === 0, JSON.stringify([cardU0.ratingAvg, cardU0.ratingCount]));
  const foundingU = await unrated.client("GET", "/api/me/founding");
  check("unrated creator: own founding card ratingAvg null, ratingCount 0", foundingU.data.card && foundingU.data.card.ratingAvg === null && foundingU.data.card.ratingCount === 0, JSON.stringify(foundingU.data.card && [foundingU.data.card.ratingAvg, foundingU.data.card.ratingCount]));
  const pubU = await client()("GET", "/api/c/unratedeats757");
  check("unrated creator: public profile carries no rating", pubU.data.profile && pubU.data.profile.ratingAvg === null && pubU.data.profile.ratingCount === 0 && (pubU.data.profile.reviews || []).length === 0, JSON.stringify(pubU.data.profile && pubU.data.profile.ratingAvg));

  // --- visit 1: rating stays shut until the post proof is in ---
  const booking1 = await visitRedeemed(biz1, rated, "Ratings dinner one");
  const tooEarly = await biz1.client("POST", `/api/bookings/${booking1.id}/review`, { stars: 5, comment: "Too soon" });
  check("rating before post proof is refused (409)", tooEarly.status === 409, String(tooEarly.status));
  await submitPost(rated, booking1.id, "RATINGPOST1");

  const notOwner = await biz2.client("POST", `/api/bookings/${booking1.id}/review`, { stars: 1, comment: "Not my visit" });
  check("a business that does not own the booking cannot rate it (404)", notOwner.status === 404, String(notOwner.status));
  const creatorAttempt = await rated.client("POST", `/api/bookings/${booking1.id}/review`, { stars: 5 });
  check("creators cannot rate their own visit (403)", creatorAttempt.status === 403, String(creatorAttempt.status));
  const badStars = await biz1.client("POST", `/api/bookings/${booking1.id}/review`, { stars: 6 });
  check("stars outside 1-5 are refused (400)", badStars.status === 400, String(badStars.status));

  const rate1 = await biz1.client("POST", `/api/bookings/${booking1.id}/review`, { stars: 5, comment: "Posted on time and the reel brought real reservations." });
  check("owning business rates the completed visit (201, attributed)", rate1.status === 201 && rate1.data.review.stars === 5 && rate1.data.review.businessName === "Ratings Table One" && /reservations/.test(rate1.data.review.comment), JSON.stringify(rate1.data));
  const dup = await biz1.client("POST", `/api/bookings/${booking1.id}/review`, { stars: 4, comment: "Changed my mind" });
  check("a second rating on the same booking is refused: not editable (409)", dup.status === 409, String(dup.status));

  // The booking payload carries the rating the business left, so
  // the visit card shows it instead of the form.
  const biz1Bookings = await biz1.client("GET", "/api/bookings");
  const bk1View = (biz1Bookings.data.bookings || []).find((b) => b.id === booking1.id) || {};
  check("business booking payload carries creatorReview (stars + comment)", !!bk1View.creatorReview && bk1View.creatorReview.stars === 5 && /reservations/.test(bk1View.creatorReview.comment || ""), JSON.stringify(bk1View.creatorReview));

  // --- aggregate at 1 rating: businesses see it, the public does not ---
  const cardR1 = await discoveryCard(biz1, rated.id);
  check("discovery card: ratingAvg 5, ratingCount 1 after the first rating", cardR1.ratingAvg === 5 && cardR1.ratingCount === 1, JSON.stringify([cardR1.ratingAvg, cardR1.ratingCount]));
  const pubR1 = await client()("GET", "/api/c/ratedeats757");
  const pf1 = pubR1.data.profile || {};
  check("public profile at 1 rating: no rating data at all (threshold is 3)", pf1.ratingAvg === null && pf1.ratingCount === 0 && (pf1.reviews || []).length === 0 && !!pf1.reviewSummary && pf1.reviewSummary.count === 0 && pf1.reviewSummary.average === null, JSON.stringify([pf1.ratingAvg, pf1.ratingCount, pf1.reviewSummary]));
  const foundingR = await rated.client("GET", "/api/me/founding");
  check("creator's own founding card: ratingAvg 5, ratingCount 1", foundingR.data.card && foundingR.data.card.ratingAvg === 5 && foundingR.data.card.ratingCount === 1, JSON.stringify(foundingR.data.card && [foundingR.data.card.ratingAvg, foundingR.data.card.ratingCount]));

  // --- visits 2 and 3 complete; Momentum measured before ratings 2-3 ---
  const booking2 = await visitRedeemed(biz2, rated, "Ratings dinner two");
  await submitPost(rated, booking2.id, "RATINGPOST2");
  const booking3 = await visitRedeemed(biz3, rated, "Ratings dinner three");
  await submitPost(rated, booking3.id, "RATINGPOST3");
  const cardBefore = await discoveryCard(biz1, rated.id);
  const momentumBefore = cardBefore.momentum && cardBefore.momentum.points;

  const longComment = "x".repeat(300);
  const rate2 = await biz2.client("POST", `/api/bookings/${booking2.id}/review`, { stars: 4, comment: longComment });
  check("comment is capped at 280 characters server-side", rate2.status === 201 && rate2.data.review.comment.length === 280, JSON.stringify(rate2.data.review && rate2.data.review.comment.length));
  const rate3 = await biz3.client("POST", `/api/bookings/${booking3.id}/review`, { stars: 4 });
  check("a rating with no comment is fine (comment optional)", rate3.status === 201 && rate3.data.review.stars === 4 && rate3.data.review.comment === "", JSON.stringify(rate3.data.review));

  // --- aggregate math at 3 ratings: (5 + 4 + 4) / 3 = 4.3 ---
  const cardR3 = await discoveryCard(biz1, rated.id);
  check("discovery card: ratingAvg 4.3 (1 decimal), ratingCount 3", cardR3.ratingAvg === 4.3 && cardR3.ratingCount === 3, JSON.stringify([cardR3.ratingAvg, cardR3.ratingCount]));
  check("discovery reviewSummary agrees with the rating fields", !!cardR3.reviewSummary && cardR3.reviewSummary.count === 3 && cardR3.reviewSummary.average === 4.3, JSON.stringify(cardR3.reviewSummary));
  const pubR3 = await client()("GET", "/api/c/ratedeats757");
  const pf3 = pubR3.data.profile || {};
  check("public profile at 3 ratings: rating shows (avg 4.3, count 3, 3 reviews listed)", pf3.ratingAvg === 4.3 && pf3.ratingCount === 3 && (pf3.reviews || []).length === 3 && !!pf3.reviewSummary && pf3.reviewSummary.average === 4.3, JSON.stringify([pf3.ratingAvg, pf3.ratingCount, (pf3.reviews || []).length]));

  // --- ratings mint no Momentum for anyone ---
  const cardAfter = await discoveryCard(biz1, rated.id);
  check("ratings 2 and 3 moved no Momentum points", typeof momentumBefore === "number" && cardAfter.momentum && cardAfter.momentum.points === momentumBefore, JSON.stringify([momentumBefore, cardAfter.momentum && cardAfter.momentum.points]));

  // --- applicant stack carries the rating next to Momentum ---
  const openOffer = await biz1.client("POST", "/api/offers", {
    title: "Ratings open call",
    whatComped: "Dinner for two at the counter",
    experience: "Chef's counter",
    dollarCap: 120,
    spots: 1,
    targetTiers: ["Locals", "Headliners"],
    applyWindowDays: 3,
    windowDays: 7,
  });
  check("open offer publishes for the stack test", openOffer.status === 201 && openOffer.data.offer.lane === "open", JSON.stringify(openOffer.data).slice(0, 200));
  const openId = openOffer.data.offer.id;
  const applyR = await rated.client("POST", `/api/offers/${openId}/apply`, {});
  const applyU = await unrated.client("POST", `/api/offers/${openId}/apply`, {});
  check("both creators apply to the open offer", applyR.status === 201 && applyU.status === 201, JSON.stringify([applyR.status, applyU.status]));
  const stack = await biz1.client("GET", `/api/offers/${openId}/applications`);
  const appR = (stack.data.applications || []).find((a) => a.creatorId === rated.id) || {};
  const appU = (stack.data.applications || []).find((a) => a.creatorId === unrated.id) || {};
  check("applicant stack: rated applicant carries ratingAvg 4.3 / ratingCount 3", !!appR.creator && appR.creator.ratingAvg === 4.3 && appR.creator.ratingCount === 3, JSON.stringify(appR.creator && [appR.creator.ratingAvg, appR.creator.ratingCount]));
  check("applicant stack: unrated applicant carries ratingAvg null / ratingCount 0", !!appU.creator && appU.creator.ratingAvg === null && appU.creator.ratingCount === 0, JSON.stringify(appU.creator && [appU.creator.ratingAvg, appU.creator.ratingCount]));

  // --- preview: ratings display on the shared roster, zero writes ---
  const pv = await admin("GET", "/api/admin/preview/discover?market=Hampton%20Roads");
  const pvCard = (pv.data.creators || []).find((c) => c.userId === rated.id) || {};
  check("admin preview discovery card carries the rating fields too", pvCard.ratingAvg === 4.3 && pvCard.ratingCount === 3, JSON.stringify([pvCard.ratingAvg, pvCard.ratingCount]));

  // --- mirror flow untouched: creator reviews the business ---
  const mirror = await rated.client("POST", `/api/bookings/${booking1.id}/review-business`, { stars: 5, text: "Great host, comp honored exactly as listed." });
  check("mirror flow intact: creator reviews the business (+10 Momentum lane)", mirror.status === 201 && mirror.data.review.stars === 5, JSON.stringify(mirror.data));

  // --- client wiring: the capture form, the stack, the own-rating line ---
  const anon = client();
  const appJs = await anon("GET", "/app.js");
  const appJsText = String((appJs.data && appJs.data.raw) || "");
  check("client ships the business rating form on the visit card", appJsText.includes("Rate this creator") && appJsText.includes("submitCreatorReview") && appJsText.includes("crev-stars-"), "");
  check("client ships the creator's own rating line (rated + neutral states)", appJsText.includes("Your rating:") && appJsText.includes("Businesses rate you after visits. Your rating appears here after your first rated visit."), "");
  check("client ships the applicant-stack rating", appJsText.includes("ratingBit") && appJsText.includes("ratingCount"), "");
} catch (e) {
  failed += 1;
  failures.push("suite error: " + e.message);
  console.log("  FAIL  suite error :: " + e.message);
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`\nverify-ratings: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("FAILURES:\n - " + failures.join("\n - "));
  process.exit(1);
}
