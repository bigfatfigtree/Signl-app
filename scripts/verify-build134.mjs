// Build -134 verification: the shopping surfaces (Jeff,
// 2026-11-06). The Shelf (business Find creators) as Discover's
// default view, the creator page's local-% hero block + buy
// box, the Mirror (new creator tab: Find Offers), setup live
// previews on both setup flows, Sig card wiring, and the
// /open-offers payload the Mirror reads (business track record,
// distance band, business city) — plus the standing empty-
// section rule pins and the payment-gates-shut pin.
// Run: node scripts/verify-build134.mjs
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8999;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b134.dev";
const ADMIN_PW = "verify-build134-pass";
const PW = "fixture-pass-134";
const now0 = Date.now();
const iso = (t) => new Date(t).toISOString();

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; failures.push(name); console.error(`FAIL ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// ---------- S: source pins ----------
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const profileMetaJs = fs.readFileSync(path.join(root, "netlify/functions/lib/profile-meta.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const themeCss = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");

check("stamp is 2026.11.06-138 and identical in build.js + index.html", buildJs.includes('BUILD_ID = "2026.11.06-138"') && indexHtml.includes("2026.11.06-138"));

// Nav: the Find Offers tab is first-class for creators.
check("nav: Find Offers is a creator primary tab (phone bar)", appJs.includes('creator: ["Dashboard", "Find Offers", "Sig", "Earnings", "Offers"]'));
check("nav: Find Offers carries the one-word bar label", appJs.includes('"Find Offers": "Find"'));
check("nav: Find Offers is a labelled rail destination in tabItemsFor", appJs.includes('label: "Find offers", tab: "Find Offers"'));
check("nav: both creator tab whitelists admit Find Offers", appJs.includes('const LIVE_CREATOR_TABS = ["Dashboard", "Profile", "Offers", "Find Offers"') && appJs.includes('"Help", "Offers", "Find Offers", "My Visits"'));
check("nav: both creator shells dispatch Find Offers to its loader", (appJs.match(/loadFindOffers\(\)/g) || []).length >= 3 && appJs.includes('id="cr-findoffers"'));

// The Shelf.
check("shelf: the tile component exists with the local hero + spelled-out count (highlighted chip under the % block, Build -136)", appJs.includes("function shelfTileHtml(c, opts)") && appJs.includes("of their followers live in") && appJs.includes('class="shelf-localcount"') && appJs.includes("local followers</div>"));
check("shelf: Discover defaults to the Shelf view", appJs.includes('state.discoverMode || "shelf"') && appJs.includes("setDiscoverMode('shelf')"));
check("shelf: booking-kind + rate filters are wired", appJs.includes("function discoverBookModeSet(mode)") && appJs.includes("function discoverRateSet(v)") && appJs.includes("function shelfClientFilter(list)"));
check("shelf: live result count renders", appJs.includes('id="discover-count"') && appJs.includes("function setDiscoverCount(n)"));
check("shelf: default sort reads Best local fit over the local-first ranking", appJs.includes('<option value="local" selected>Best local fit (most local first)</option>'));
check("shelf: compare tray needs two saved and marks the top match (bold box + tag, no pill)", appJs.includes("function shelfTrayHtml()") && appJs.includes("saved.length < 2") && appJs.includes("top-match") && appJs.includes("Top match") && !appJs.includes("Strongest local fit"));
check("shelf: the first tile under the local sort wears the top-match box", appJs.includes("topMatch: i === 0 && localSort") && appJs.includes("shelf-tile${topMatch ? \" top-match\" : \"\"}"));
check("shelf: Book rides the existing direct-offer flow, Save rides favorites", appJs.includes("onclick=\"startOffer('${c.userId}')\">Book</button>") && appJs.includes("function shelfToggleFav(userId)"));

// Creator page.
check("pdp: the hero block carries Jeff's neighbors line", appJs.includes("function pdpLocalHeroHtml(c)") && appJs.includes("neighbors</strong> who could actually walk through your door"));
check("pdp: hero sits in the detail render where the old local block stood", appJs.includes("${pdpLocalHeroHtml(c)}"));
check("pdp: What you get states the standard (1 post + 1 story, 48 hours, counted)", appJs.includes("function whatYouGetHtml(c)") && appJs.includes("Posted within 48 hours") && appJs.includes("Counted, not guessed."));
check("pdp: Momentum is explained in place, in plain words", appJs.includes("function momentumExplainerHtml(c)") && appJs.includes("is a reliability score"));
check("pdp: audience specs + similar rail render only with data", appJs.includes("function audienceSpecsHtml(c)") && appJs.includes("if (!rows.length) return \"\";") && appJs.includes("function similarCreatorsHtml(c)") && appJs.includes("if (!ranked.length) return \"\";"));
check("pdp: buy box offers Paid at rate / Comped $0 + a day picker into the Offer Card flow", appJs.includes("function buyBoxHtml(c)") && appJs.includes("Comped visit — ${sym}0") && appJs.includes("function pdpSendOffer(userId)") && appJs.includes("function pdpPickDay(btn)"));
check("pdp: the picked day rides the deal note, and the proposal card shows notes", appJs.includes('id="ds-notefield"') && appJs.includes("body.note = dsNote.value.trim()") && appJs.includes("${t.note ? `<div class=\"lrow\"><span>Note</span>"));

// Public profile hero (client + SSR mirror tell the same story).
check("public profile: client render carries the neighbors line", appJs.includes("cc-neighbors") && appJs.includes("neighbors who could actually walk through your door."));
check("public profile: SSR mirror carries the same neighbors line", profileMetaJs.includes("cc-neighbors") && profileMetaJs.includes("neighbors who could actually walk through your door."));

// The Mirror.
check("mirror: card states the offer like a price and the ask in one line", appJs.includes("function mirrorOfferCardHtml(o, opts)") && appJs.includes("function mirrorPriceLine(o)") && appJs.includes("function mirrorAskLine(o)") && appJs.includes("within 48 hours of the visit"));
check("mirror: track-record strip renders only when a record exists", appJs.includes("${trackCells ? `<div class=\"mirror-track\">")); // Build -138: the strip renders from earned cells (trackCells) — same rule, no empty strip
check("mirror: filters cover kind, category, distance, sort", appJs.includes("state.foKind") && appJs.includes("state.foCategory") && appJs.includes("state.foDistance") && appJs.includes("state.foSort"));
check("mirror: Grab rides applyToOffer; piles ride the shared offers deck", appJs.includes("function findOffersGrab(id)") && appJs.includes("await applyToOffer(id)") && appJs.includes("pileLater(\"offers\", id)") && appJs.includes("pileHide(\"offers\", id)"));

// Setup live previews.
check("preview: creator setup carries the ONE peek switch (Build -136 replaces the -134/-135 preview box + sub-toggles)", appJs.includes('id="profile-peek-sw"') && appJs.includes("<strong>See how businesses view you</strong>") && appJs.includes('id="profile-peek"') && appJs.includes('id="profile-edit-wrap"') && !appJs.includes('id="profile-preview-host"') && !appJs.includes(">Top of your page</button>") && appJs.includes('oninput="creatorPreviewRefresh()"'));
check("preview: creator preview builds its card from the live form and renders the real components", appJs.includes("function creatorPreviewCard()") && appJs.includes("shelfTileHtml(card, { preview: true })"));
check("preview: business setup carries the ONE peek switch (Build -136)", appJs.includes('id="offer-peek-sw"') && appJs.includes("<strong>See how creators view you</strong>") && appJs.includes('id="offer-peek"') && !appJs.includes('id="offer-preview-host"') && !appJs.includes("offerPreviewSetView") && appJs.includes("mirrorOfferCardHtml(offerPreviewOffer(), { preview: true })"));
check("preview: the composer refreshes its preview from the draft sync", appJs.includes("function offerPreviewRefresh()") && appJs.includes("offerPreviewRefresh();"));
check("preview: no new required setup fields were added (Required tags: 11 at -133, still 11)", (appJs.match(/req-tag">Required/g) || []).length === 11, String((appJs.match(/req-tag">Required/g) || []).length));

// Sig wiring.
check("sig: creator cards carry the spelled-out local follower line", appJs.includes("sig-ccard-sub") && appJs.includes("of their followers live in"));
check("sig: offer cards carry place + the ask line", appJs.includes("o.businessNeighborhood, o.distanceBand") && appJs.includes("esc(mirrorAskLine(o))"));
check("sig: business flow lands on Find creators (the Shelf)", appJs.includes('ST("See them in Find creators"'));
check("sig: open-offer cards land on Find Offers; direct invites keep the Offers tab", appJs.includes('go("dashboard", "Find Offers")') && appJs.includes('state.crOffersSeg = "invited"; go("dashboard", "Offers")'));

// Server payload + gates.
check("server: businessTrackRecordFor computes from redeemed bookings + delivered posts only", routerJs.includes("function businessTrackRecordFor(businessId, bookings, posts)") && routerJs.includes("b.redeemedAt && !b.honorReportedAt"));
check("server: /open-offers carries businessCity, distanceBand, businessTrackRecord", routerJs.includes("businessCity: biz ? (biz.city || \"\") : \"\"") && routerJs.includes("distanceBand: biz ? proximityBandFor(biz, user) : null") && routerJs.includes("businessTrackRecord: biz ?"));
check("gates: founding prices stay env-armed only (no price ids hard-coded in the client)", !/price_[A-Za-z0-9]{8,}/.test(appJs) && routerJs.includes("FOUNDING_STRIPE_PRICES"));
check("css: the shopping surfaces are styled", themeCss.includes(".shelf-tile") && themeCss.includes(".pdp-hero") && themeCss.includes(".mirror-card") && themeCss.includes(".pdp-buy") && themeCss.includes(".preview-panel") && themeCss.includes(".shelf-tile.top-match") && themeCss.includes(".top-match-tag"));

// ---------- H: HTTP behavior ----------
const salt = "b134fixturesalt";
const hash = crypto.scryptSync(PW, salt, 64).toString("hex");
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "cr1", role: "creator", email: "cr1@b134.dev", name: "Casey Creator", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Norfolk", createdAt: iso(now0), updatedAt: iso(now0),
  creator: { handle: "caseycreates", primaryPlatform: "instagram", followerCount: 10000, totalAudience: 10000, audienceStack: { instagram: 10000 }, categories: ["Food & Drink"], localAudiencePct: 72, tierBand: "Neighbors", profileComplete: true, publicPage: true, hasPhoto: false, bio: "", zip: "23517" } });
putUser({ id: "biz1", role: "business", email: "biz1@b134.dev", name: "Tess Track", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Norfolk", createdAt: iso(now0), updatedAt: iso(now0),
  business: { businessName: "Track Record Tacos", category: "Restaurant", plan: "self-service", planId: "self-service", about: "Tacos with a record.", neighborhood: "Ghent", zip: "23517" } });
putUser({ id: "biz2", role: "business", email: "biz2@b134.dev", name: "Fred Fresh", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Norfolk", createdAt: iso(now0), updatedAt: iso(now0),
  business: { businessName: "Fresh Face Fitness", category: "Fitness", plan: "self-service", planId: "self-service", about: "Brand new studio.", neighborhood: "Ghent", zip: "23517" } });
// biz1 hosted cr1 twice (both redeemed); two posts, one on time.
data["booking:bk1"] = { id: "bk1", businessId: "biz1", businessName: "Track Record Tacos", creatorId: "cr1", offerId: null, market: "Hampton Roads", redeemedAt: iso(now0 - 9 * 86400000), createdAt: iso(now0 - 10 * 86400000) };
data["booking:bk2"] = { id: "bk2", businessId: "biz1", businessName: "Track Record Tacos", creatorId: "cr1", offerId: null, market: "Hampton Roads", redeemedAt: iso(now0 - 4 * 86400000), createdAt: iso(now0 - 5 * 86400000) };
data["post:po1"] = { id: "po1", bookingId: "bk1", creatorId: "cr1", businessId: "biz1", onTime: true, submittedAt: iso(now0 - 8 * 86400000) };
data["post:po2"] = { id: "po2", bookingId: "bk2", creatorId: "cr1", businessId: "biz1", onTime: false, submittedAt: iso(now0 - 2 * 86400000) };
data["offer:of1"] = { id: "of1", businessId: "biz1", businessName: "Track Record Tacos", market: "Hampton Roads", category: "Restaurant", lane: "open", status: "open", kind: "comp", title: "Taco tasting for two", whatComped: "A taco tasting for two", dollarCap: 120, covers: 2, spots: 3, createdAt: iso(now0 - 3 * 86400000), publishedAt: iso(now0 - 3 * 86400000), deliverables: { posts: 1, story: true, windowHours: 48 } };
data["offer:of2"] = { id: "of2", businessId: "biz2", businessName: "Fresh Face Fitness", market: "Hampton Roads", category: "Fitness", lane: "open", status: "open", kind: "paid", title: "Launch week class post", cashRate: 150, spots: 2, createdAt: iso(now0 - 2 * 86400000), publishedAt: iso(now0 - 2 * 86400000), deliverables: { posts: 1, story: true, windowHours: 48 } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b134-"));
const dbPath = path.join(tmp, "db.json");
fs.writeFileSync(dbPath, JSON.stringify(data));
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbPath, SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD: ADMIN_PW, SIGNL_TEST_ALLOW_BUSINESS: "1" };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: "ignore" });

function client() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const piece of setCookie.split(/,(?=[^;]+=)/)) {
      const m = piece.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let d = null;
    try { d = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data: d, text };
  };
}

try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { const r = await fetch(BASE + "/api/bootstrap"); up = r.status > 0; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  check("dev server boots", up);

  const cr = client();
  const login = await cr("POST", "/api/auth/login", { email: "cr1@b134.dev", password: PW });
  check("creator logs in", login.status === 200, String(login.status));
  const board = await cr("GET", "/api/open-offers");
  check("open-offers answers 200 with both offers", board.status === 200 && (board.data.offers || []).length === 2, JSON.stringify(board.data).slice(0, 200));
  const o1 = (board.data.offers || []).find((o) => o.id === "of1");
  const o2 = (board.data.offers || []).find((o) => o.id === "of2");
  check("mirror payload: the hosted business carries its track record", !!o1 && !!o1.businessTrackRecord && o1.businessTrackRecord.visitsHosted === 2, JSON.stringify(o1 && o1.businessTrackRecord));
  check("mirror payload: creators who came back counts repeat visitors", !!o1 && o1.businessTrackRecord.creatorsReturned === 1);
  check("mirror payload: on-time % comes from the delivered posts", !!o1 && o1.businessTrackRecord.onTimePct === 50);
  check("mirror payload: same-ZIP business reads Same neighborhood", !!o1 && o1.distanceBand === "Same neighborhood", o1 && o1.distanceBand);
  check("mirror payload: business city rides along", !!o1 && o1.businessCity === "Norfolk");
  check("mirror payload: a business with no hosted visits carries NO track record (empty-section rule)", !!o2 && o2.businessTrackRecord === null, JSON.stringify(o2 && o2.businessTrackRecord));

  const bz = client();
  const blogin = await bz("POST", "/api/auth/login", { email: "biz1@b134.dev", password: PW });
  check("business logs in", blogin.status === 200, String(blogin.status));
  const disc = await bz("GET", "/api/discover?market=" + encodeURIComponent("Hampton Roads"));
  const card = (disc.data.creators || []).find((c) => c.userId === "cr1");
  check("shelf data source: discover returns the roster creator with local % + audience", !!card && card.profile.localAudiencePct === 72 && (card.totalAudience || 0) === 10000, JSON.stringify(card).slice(0, 200));
} finally {
  server.kill();
}

console.log(`\nBuild -134 verify: ${passed} passed, ${failed} failed`);
if (failed) { console.error("Failures:", failures.join(" | ")); process.exit(1); }
