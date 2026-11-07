// Build -136 verification: Jeff's card rulings (2026-11-06).
// The accepts-comps switch on creator cards (real compOpen
// functionality, highlighted ON vs muted OFF, at the price line
// on the Shelf tile, the creator page buy box, and — through the
// shared components — the setup live preview), the local follower
// count as a highlighted chip directly under the % block (tile +
// compare tray), the setup lane switch in Jeff's plain words,
// and the comp filter gated on the one compOpen field (no second
// source of truth in compCategories).
// Run: node scripts/verify-build136.mjs
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9001;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b136.dev";
const ADMIN_PW = "verify-build136-pass";
const PW = "fixture-pass-136";
const now0 = Date.now();
const iso = (t) => new Date(t).toISOString();

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; failures.push(name); console.error(`FAIL ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const slice = (s, fn, len = 4500) => { const i = s.indexOf(fn); return i < 0 ? "" : s.slice(i, i + len); };

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const themeCss = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");

// ---------- stamp ----------
check("stamp is 2026.11.06-139 and identical in build.js + index.html",
  buildJs.includes('BUILD_ID = "2026.11.06-139"') && indexHtml.includes("2026.11.06-139"));

// ---------- the switch component ----------
const toggle = slice(appJs, "function acceptanceHtml", 2400);
check("card switch: one component renders BOTH acceptances as switches (comps + coupons, ON highlighted, OFF muted)",
  toggle.includes("function acceptanceHtml(c)") && toggle.includes("p.compOpen !== false") && toggle.includes("p.couponOpen !== false")
  && toggle.includes('"Accepts comps"') && toggle.includes('"Accepts coupons"') && toggle.includes(">Paid only<") && toggle.includes("comp-sw"));
const tile = slice(appJs, "function shelfTileHtml", 4200);
check("tile: the acceptance switches ride the price line (price row carries price + switches together)",
  tile.includes('class="shelf-price-row"') && tile.includes("${acceptanceHtml(c)}"));
check("tile: the local count is a highlighted chip under the % block, not caption text",
  tile.includes('class="shelf-localcount"') && tile.includes("local followers</div>") && !tile.includes("<br><strong>about"));
const tray = slice(appJs, "function shelfTrayHtml", 2800);
check("tray: the local count carries the same highlighted chip treatment",
  tray.includes('class="shelf-tray-count"') && tray.includes("local followers</div>"));
check("tray: a dedicated acceptance row carries both switches",
  tray.includes('class="shelf-tray-acc"') && tray.includes("${acceptanceHtml(c)}"));
const buy = slice(appJs, "function buyBoxHtml", 2600);
check("creator page: the buy box header carries the switches next to the booking lanes",
  buy.includes("${acceptanceHtml(c)}"));

// ---------- setup: the one switch, in Jeff's words ----------
check("setup: the lane switch is labelled in plain words (I accept comped visits)",
  appJs.includes('for="lane-comp">I accept comped visits</label>') && !appJs.includes('for="lane-comp">Comp visits</label>'));
check("setup: the switch explainer says what a comp is (meal, service, or experience instead of cash)",
  appJs.includes("on. Businesses can offer you a comped meal, service, or experience instead of cash.")
  && !appJs.includes("Businesses can comp you for honest posts."));
check("setup: the toggle stays out of the required set (Required tags still 11, save never blocks on it)",
  (appJs.match(/req-tag">Required/g) || []).length === 11
  && appJs.includes("compOpen/paidRate are deliberately NOT sent here"));
const previewCard = slice(appJs, "function creatorPreviewCard", 3600);
check("preview: the setup preview reads the SAME setup switches (lane-comp + lane-coupon) for its card state",
  previewCard.includes('document.getElementById("lane-comp")') && previewCard.includes("compOpen: compEl ? !!compEl.checked")
  && previewCard.includes('document.getElementById("lane-coupon")') && previewCard.includes("couponOpen:"));

// ---------- Scope #5: coupons are a standing acceptance too ----------
check("setup: the coupon switch sits beside the comp switch, in plain words, same save path",
  appJs.includes('for="lane-coupon">I accept coupons / store credit</label>')
  && appJs.includes("laneSave({ couponOpen: !!input.checked })") && appJs.includes("function laneCouponLine"));
check("server: couponOpen is one field — profile PATCH, card payloads, alert filter and the apply gate all read it",
  routerJs.includes("if (b.couponOpen !== undefined)") && routerJs.includes("couponOpen: c.couponOpen !== false")
  && routerJs.includes('kindOf(offer) === "coupon" && user.creator && user.creator.couponOpen === false')
  && routerJs.includes('kind === "coupon" && c.creator && c.creator.couponOpen === false'));
check("css: the acceptance row + tray acceptance are styled",
  themeCss.includes(".acc-row") && themeCss.includes(".shelf-tray-acc"));

// ---------- one source of truth ----------
const compFilter = slice(routerJs, "if (query.compCategory)", 900);
check("server: the comp-category filter gates on compOpen (a comp-off creator never matches)",
  compFilter.includes("u.creator.compOpen !== false") && compFilter.includes("compCategories"));
check("client: the Shelf's Comped-visits mode filter reads the same field",
  appJs.includes('if (mode === "comp" && p.compOpen === false) return false;'));
check("css: the switch + count treatments are styled (mint ON state, highlighted chips)",
  themeCss.includes(".comp-sw.on") && themeCss.includes(".comp-sw.on .comp-sw-track")
  && themeCss.includes(".shelf-localcount") && themeCss.includes(".shelf-tray-count"));

// ---------- Scope addendum: the Offers cleanup (Jeff, 2026-11-06) ----------
// The creator Offers view held a second, old-style open-offer
// deck under the invites; Find offers (the Mirror) is the one
// place open offers live. The view is renamed "My offers" —
// the LABEL changes everywhere a creator reads it; the tab id
// stays "Offers" because the business shell already owns the
// tab id "My Offers" (shared label maps key off tab ids).
const offersView = slice(appJs, "async function loadCreatorOffers", 6800);
check("offers view: captured the real loader (segments host present)", offersView.includes('id="cr-offers-segs"'));
check("offers view: the legacy open-offer deck is GONE (no board mount anywhere, no board load in the view)",
  !offersView.includes('id="open-board"') && !offersView.includes("loadOpenBoard()") && !appJs.includes('<div id="open-board">'));
check("offers view: the pipeline segments stay (New / Deals / Applied / Booked / Done)",
  offersView.includes('{ label: "New"') && offersView.includes('{ label: "Deals"') && offersView.includes('{ label: "Applied"') && offersView.includes('{ label: "Booked"') && offersView.includes('{ label: "Done"'));
const pointer = slice(appJs, "function openOffersPointerHtml", 800);
check("offers view: ONE pointer card where the deck sat, in plain words, linking to Find offers",
  offersView.includes("${openOffersPointerHtml()}") && pointer.includes("Looking for offers open to every creator in your market?")
  && pointer.includes("go('dashboard','Find Offers')"));
check("rename: the view title is My offers in both the gate and the main render (old title gone)",
  (appJs.match(/wsHead\("My offers", \{ sub: "Invites sent to you/g) || []).length === 2 && !appJs.includes('wsHead("Offers"'));
check("rename: rail + legacy bottom bar read My offers (tab id deliberately unchanged)",
  appJs.includes('label: "My offers", tab: "Offers"') && !appJs.includes('label: "Offers", tab: "Offers"')
  && appJs.includes('add("a", "offers", "My offers", "return go(\'dashboard\',\'Offers\')"'));
check("rename: the Mirror's applied button names the view by its new name",
  appJs.includes("See it in My offers") && !appJs.includes("See it in Offers"));
const homePanel = slice(appJs, "function homeOpportunitiesHtml", 8200);
check("home: open offers are a signpost, not cards (cards = invites + applied + booked only)",
  homePanel.includes("const mine = ranked.filter(") && homePanel.includes("mine.slice(0, 3)")
  && homePanel.includes("go('dashboard','Find Offers')") && homePanel.includes("See all in My offers"));
check("sig: open-offer answers and prompts land on Find offers, never the pipeline view",
  appJs.includes('flow("See offers near you", ["offer", "offers near", "see offers"], () => go("dashboard", "Find Offers"))')
  && appJs.includes('"See offers", () => go("dashboard", "Find Offers")'));
check("find offers: the Mirror stays the one open-offer surface (loader + mount intact)",
  appJs.includes("async function loadFindOffers") && appJs.includes('id="cr-findoffers"'));

// ---------- Scope #2: the one peek switch + full jump-nav ----------
check("creator setup: ONE switch at the top — 'See how businesses view you' — the old preview box + sub-toggles are gone",
  appJs.includes('id="profile-peek-sw"') && appJs.includes("See how businesses view you")
  && !appJs.includes('id="profile-preview-panel"') && !appJs.includes("creatorPreviewSetView") && !appJs.includes("Top of your page"));
check("business setup: the same one switch — 'See how creators view you' — old preview treatment gone",
  appJs.includes('id="offer-peek-sw"') && appJs.includes("See how creators view you") && !appJs.includes("offerPreviewSetView"));
check("peek: the shelf tile renders at full shelf width in the peek (one column, not a third of the 3-col shelf grid)",
  themeCss.includes(".peek-shelf { max-width: 340px; grid-template-columns: 1fr; }"));
check("creator setup: the jump-nav covers every form section, in form order, with a scroll spy",
  appJs.includes("PROFILE_SEGS_136") && appJs.includes('"pf-audience"') && appJs.includes('"pf-links"') && appJs.includes('"pf-create"')
  && appJs.includes('"pf-bio"') && appJs.includes("function profileSegSpyInit"));

// ---------- Scope #3: Find creators filter groups ----------
const discView = slice(appJs, "async function loadDiscover", 12000); // Build -138: the rebuilt rail + chip row runs longer than the -136 slice
// Build -138 (Jeff's website-parity rebuild): the rail groups are
// Category / Must-haves / How you want to book / Their rate /
// Their audience lives here — the -136 Where and What-kind-of-
// creator groups were folded into the search row and the
// Category group when the surface was rebuilt to the website
// layout. This pin follows the current canon.
check("discover: the -138 rail groups (Category / Must-haves / How you want to book / Their rate / Their audience lives here)",
  discView.includes(">Category<") && discView.includes("Must-haves") && discView.includes("How you want to book") && discView.includes("Their rate") && discView.includes("Their audience lives here"));
check("discover: booking type is a segmented control; category lives in the rail as checkbox rows — the phone category chip row is GONE (Jeff, 2026-11-06: categories sit inside the Filters sheet, never as buttons under the search)",
  discView.includes('class="bookseg"') && discView.includes('data-bookmode="comp"') && discView.includes('data-bookmode="paid"')
  && discView.includes("data-dcat-box") && !appJs.includes("shop-chiprow") && appJs.includes("function discoverBookModeSet"));
check("discover: must-haves are real switches, not pill toggles",
  discView.includes('id="dchip-spanish"') && discView.includes('id="dchip-musician"') && discView.includes('class="sw" id="dchip-spanish"'));

// ---------- Scope #4: business campaign overhaul ----------
const sigaiJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");
const sigdataJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
check("rename: 'Set up a campaign' is gone everywhere — app, Sig knowledge, Sig answers read 'Start a campaign'",
  !appJs.includes("Set up a campaign") && !sigaiJs.includes("Set up a campaign") && !sigdataJs.includes("Set up a campaign")
  && appJs.includes('wsHead("Start a campaign"') && sigdataJs.includes("Start a campaign"));
check("nav: business phone bar carries the Build -137 ruled set (Home · Find · Sig · Wallet · Start a campaign) — destination set unchanged",
  appJs.includes('business: ["Home", "Discover", "Sig", "Plan", "Campaign Setup"]')
  && appJs.includes('RAIL_SHORT["Campaign Setup"] = "Start"'));
const setupView = slice(appJs, "async function loadCampaignSetup", 9000);
check("layout: Sig guide first, Templates directly under it, the manual form below",
  setupView.indexOf("campaignGuideHtml()") > -1 && setupView.indexOf("campaignGuideHtml()") < setupView.indexOf("bizTemplatesHtml()")
  && setupView.indexOf("bizTemplatesHtml()") < setupView.indexOf('id="offer-composer"'));
check("guide: the sentence parses categories, Spanish, musicians — and spots gender words only for the honesty line",
  appJs.includes("catsHit") && appJs.includes("out.spanish = true") && appJs.includes("out.musician = true") && appJs.includes("out.trait = true")
  && appJs.includes("creators don't list their gender"));
check("guide: the save carries the real fields — requiresSpanish from the sentence, the composed includes line, the coupon cap",
  appJs.includes("requiresSpanish: d.spanish === true") && appJs.includes("includes: d.includes || \"\"") && appJs.includes("cap: d.ccap != null ? Number(d.ccap) : null"));
check("guide: every kind is asked the 'what the creator gets' line (the server requires it for comp + paid; the card leads with it)",
  appJs.includes("What does the creator get on the visit?") && appJs.includes('if (!d.comped) {'));
check("guide: a typed answer at a chip step re-asks the question with its choices (no dead end)",
  appJs.includes("tap one of the choices for this one:") && !appJs.includes("Tap one of the choices above to answer this one."));
check("guide: starters sit under Sig on the setup view and on the business home, and the walk to matched creators exists",
  (appJs.match(/Find me 15 creators who would take a comped meal/g) || []).length >= 2
  && appJs.includes("function bizGuideStartersHtml") && appJs.includes("function campaignGuideGoMatches") && appJs.includes("See the creators who match"));
check("booking: startOffer opens the dedicated booking flow — never the campaign form",
  slice(appJs, "function startOffer(creatorId)", 300).includes("openBookingFlow(creatorId)")
  && appJs.includes("function openBookingFlow") && appJs.includes("function bookingContinue"));
check("imagery: business photo upload + serving exist, the offer payload carries the lead image, the Mirror leads with it",
  routerJs.includes("business_photo_uploaded") && routerJs.includes("businessImageUrl:") && routerJs.includes('target.role === "business"')
  && slice(appJs, "function mirrorOfferCardHtml", 2600).includes("mirror-cover") && appJs.includes("Offers with a photo get picked first"));

// ---------- Scope #6: compose the ask + payment ----------
check("compose: the extras guidance line is identical in the composer, the booking sheet and Sig's question",
  (appJs.match(/Spell out what's included — specific offers get grabbed first/g) || []).length >= 3
  && (appJs.match(/specific offers get grabbed first/g) || []).length >= 3);
check("compose: the deal sheet carries the extras field into the deal terms, and the deal card shows it",
  appJs.includes('id="ds-includes"') && appJs.includes("body.includes = dsInc.value.trim()")
  && routerJs.includes("includes: String((input && input.includes)") && appJs.includes("${esc(t.includes)}"));
check("compose: the guide asks what's included (skippable) and enforces the percent-coupon cap",
  appJs.includes('cg.step = "includes"') && appJs.includes('cg.step = "couponcap"'));

// ---------- Scopes #7/#8: the shop layout + All-first groups ----------
check("shop layout: both surfaces render the rail layout (disc-rail + fo-rail) with the sheet CSS",
  discView.includes('id="disc-rail"') && appJs.includes('id="fo-rail"') && appJs.includes('class="shop-layout"')
  && themeCss.includes(".shop-layout") && themeCss.includes(".shop-rail.open") && themeCss.includes(".shop-mbar"));
check("find offers rail: the concept groups — The offer (All first, real counts) / Category / Distance from you / Good to know",
  appJs.includes(">The offer<") && appJs.includes("Distance from you") && appJs.includes("Good to know")
  && appJs.includes("kindCount") && appJs.includes("All categories") && appJs.includes("Anywhere in market")); // Build -138: the concept's Anywhere option reads "Anywhere in market" (the -136 wording was "Any distance")
check("all-first: every shopping group leads with its All option (All categories ×2 surfaces, All creators, Either, All tiers, All universities)",
  (appJs.match(/All categories/g) || []).length >= 2 && discView.includes("All creators") && discView.includes(">Either<")
  && discView.includes("All tiers") && discView.includes("All universities") && appJs.includes("function foClearAll") && appJs.includes("function discClearAll"));

// ---------- HTTP: the filter, end to end ----------
const salt = "b136fixturesalt";
const hash = crypto.scryptSync(PW, salt, 64).toString("hex");
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "biz1", role: "business", email: "biz1@b136.dev", name: "Tess Track", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Norfolk", createdAt: iso(now0), updatedAt: iso(now0),
  business: { businessName: "Track Record Tacos", category: "Restaurant", plan: "self-service", planId: "self-service", about: "Tacos with a record.", neighborhood: "Ghent", zip: "23517" } });
putUser({ id: "crOn", role: "creator", email: "on@b136.dev", name: "Ona Open", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Norfolk", createdAt: iso(now0), updatedAt: iso(now0),
  creator: { handle: "onaopen", primaryPlatform: "instagram", followerCount: 10000, totalAudience: 10000, audienceStack: { instagram: 10000 }, categories: ["Food & Drink"], compCategories: ["Restaurant meals"], localAudiencePct: 86, tierBand: "Locals", profileComplete: true, publicPage: true, hasPhoto: false, bio: "", zip: "23510", compOpen: true, couponOpen: false, paidRate: 150 } });
putUser({ id: "crOff", role: "creator", email: "off@b136.dev", name: "Paige Paidonly", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Norfolk", createdAt: iso(now0), updatedAt: iso(now0),
  creator: { handle: "paigepaid", primaryPlatform: "instagram", followerCount: 5000, totalAudience: 5000, audienceStack: { instagram: 5000 }, categories: ["Beauty & Grooming"], compCategories: ["Restaurant meals"], localAudiencePct: 78, tierBand: "Neighbors", profileComplete: true, publicPage: true, hasPhoto: false, bio: "", zip: "23517", compOpen: false, paidRate: 200 } });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b136-"));
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

  const bz = client();
  const blogin = await bz("POST", "/api/auth/login", { email: "biz1@b136.dev", password: PW });
  check("business logs in", blogin.status === 200, String(blogin.status));

  const all = await bz("GET", "/api/discover?market=" + encodeURIComponent("Hampton Roads"));
  const ids = (all.data.creators || []).map((c) => c.userId);
  check("browse: both creators appear without a comp filter (paid-only stays browsable)",
    ids.includes("crOn") && ids.includes("crOff"), ids.join(","));
  const offCard = (all.data.creators || []).find((c) => c.userId === "crOff");
  const onCard = (all.data.creators || []).find((c) => c.userId === "crOn");
  check("cards: compOpen rides the discover payload normalized (off stays false, on true)",
    !!offCard && offCard.profile.compOpen === false && !!onCard && onCard.profile.compOpen === true,
    JSON.stringify({ off: offCard && offCard.profile.compOpen, on: onCard && onCard.profile.compOpen }));
  check("cards: couponOpen rides the payload normalized (explicit false stays false, unset defaults true)",
    !!offCard && offCard.profile.couponOpen === true && !!onCard && onCard.profile.couponOpen === false,
    JSON.stringify({ off: offCard && offCard.profile.couponOpen, on: onCard && onCard.profile.couponOpen }));

  const cr = client();
  const clogin = await cr("POST", "/api/auth/login", { email: "on@b136.dev", password: PW });
  check("creator logs in", clogin.status === 200, String(clogin.status));
  const flip = await cr("PATCH", "/api/me/profile", { couponOpen: true });
  const afterFlip = await bz("GET", "/api/discover?market=" + encodeURIComponent("Hampton Roads"));
  const flippedCard = (afterFlip.data.creators || []).find((c) => c.userId === "crOn");
  check("coupon toggle: flipping it in setup changes the card businesses see (PATCH round-trip)",
    flip.status === 200 && !!flippedCard && flippedCard.profile.couponOpen === true,
    JSON.stringify({ flip: flip.status, now: flippedCard && flippedCard.profile.couponOpen }));

  const filtered = await bz("GET", "/api/discover?market=" + encodeURIComponent("Hampton Roads") + "&compCategory=" + encodeURIComponent("Restaurant meals"));
  const fids = (filtered.data.creators || []).map((c) => c.userId);
  check("filter: 'Would accept as a comped visit' returns the comp-open creator",
    fids.includes("crOn"), fids.join(","));
  check("filter: the paid-only creator does NOT match, despite her stored comp category",
    !fids.includes("crOff"), fids.join(","));
} finally {
  server.kill();
}

console.log(`\nBuild -136 verify: ${passed} passed, ${failed} failed`);
if (failed) { console.error("Failures:", failures.join(" | ")); process.exit(1); }
