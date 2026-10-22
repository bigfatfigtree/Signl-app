// Launch-shape verification (Jeff's 2026-10-18 launch decision,
// with the 2026-10-20 correction restoring founding-list mode
// for businesses).
// This suite runs WITHOUT the test override, exactly like production:
//   - creator founding sign-up is open in all markets
//   - business registration is founding-list intake (same form,
//     plan recorded honestly, reviewed like any application); a
//     founding business gets NO product access until an admin
//     activates it by hand, and even then publishing and
//     bookings stay behind the market live flag
//   - registration is the full profile builder (all fields enforced)
//   - approved creators land on a founding status page, and the
//     marketplace stays closed until an admin activates the market
//   - the creator roster is never visible to the public
//   - founding priority is sign-up order
// Run: node scripts/verify-launch.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8919;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-launch-${Date.now()}.json`);
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data };
  }
  call.raw = async function raw(p) {
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + p, { headers: cookie ? { Cookie: cookie } : {} });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, contentType: res.headers.get("content-type") || "", bytes: buf.length, text: buf.toString("utf8") };
  };
  return call;
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
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
    // Deliberately NO SIGNL_TEST_ALLOW_BUSINESS: this is production shape.
    SIGNL_TEST_ALLOW_BUSINESS: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  check("dev server boots in production launch shape", await waitForServer());

  const anon = client();
  const boot = await anon("GET", "/api/bootstrap");
  check("bootstrap lists 39 markets (11 founding metros + 28 universal core markets)", boot.data.markets && boot.data.markets.length === 39, JSON.stringify(boot.data.markets && boot.data.markets.length));
  const NEW_MARKETS = ["Nashville", "Austin", "Dallas", "Chicago", "Los Angeles", "San Diego", "Seattle", "Tampa", "Miami", "Phoenix", "Denver", "Minneapolis", "London", "Manchester", "Dubai", "Abu Dhabi", "Riyadh", "Doha", "Astana", "Bishkek", "Sydney", "Melbourne", "Perth", "Auckland", "Singapore", "Hong Kong", "Beijing", "Shanghai"];
  check("all 28 new core markets are in bootstrap", NEW_MARKETS.every((n) => (boot.data.markets || []).some((m) => m.name === n)), JSON.stringify((boot.data.markets || []).map((m) => m.name)));
  check("bootstrap exposes a country on every market (grouped picker data)", (boot.data.markets || []).length === 39 && boot.data.markets.every((m) => !!m.country), JSON.stringify((boot.data.markets || []).map((m) => [m.name, m.country])));
  const EXPECTED_COUNTRIES = { "Abu Dhabi": "United Arab Emirates", "Riyadh": "Saudi Arabia", "Doha": "Qatar", "Astana": "Kazakhstan", "Bishkek": "Kyrgyzstan", "Sydney": "Australia", "Melbourne": "Australia", "Perth": "Australia", "Auckland": "New Zealand", "Singapore": "Singapore", "Hong Kong": "Hong Kong", "Beijing": "China", "Shanghai": "China" };
  check("Bella's 13 focus markets carry the right countries", Object.entries(EXPECTED_COUNTRIES).every(([n, c]) => (boot.data.markets || []).some((m) => m.name === n && m.country === c)), JSON.stringify(EXPECTED_COUNTRIES));
  check("bootstrap spans exactly 12 countries and territories", new Set((boot.data.markets || []).map((m) => m.country)).size === 12, JSON.stringify([...new Set((boot.data.markets || []).map((m) => m.country))]));
  check("Dubai is a core market in the United Arab Emirates", (boot.data.markets || []).some((m) => m.name === "Dubai" && m.country === "United Arab Emirates" && m.cities.includes("Dubai")));
  check("London and Manchester are United Kingdom markets", ["London", "Manchester"].every((n) => (boot.data.markets || []).some((m) => m.name === n && m.country === "United Kingdom")));
  check("the 12 new US cities carry the United States country", NEW_MARKETS.slice(0, 12).every((n) => (boot.data.markets || []).some((m) => m.name === n && m.country === "United States")));
  check("every new market starts not live", NEW_MARKETS.every((n) => boot.data.launch && boot.data.launch.marketLive[n] === false), JSON.stringify(boot.data.launch && boot.data.launch.marketLive));
  check("bootstrap: creator sign-up open, business sign-up open (real accounts, Jeff 2026-10-20)", boot.data.launch && boot.data.launch.creatorSignupOpen === true && boot.data.launch.businessSignupOpen === true, JSON.stringify(boot.data.launch));
  check("bootstrap publishes the offer guidance (tier floors, paid floor, SLA, templates)", !!boot.data.offerGuidance && boot.data.offerGuidance.compGuidance.Headliners.floor === 100 && boot.data.offerGuidance.compGuidance.Neighbors.floor === 25 && boot.data.offerGuidance.paidFloor === 50 && boot.data.offerGuidance.selectionSlaHours === 72 && (boot.data.offerGuidance.templates || []).length === 4, JSON.stringify(boot.data.offerGuidance));
  check("bootstrap: every market starts not live", boot.data.launch && Object.values(boot.data.launch.marketLive).every((v) => v === false));
  check("bootstrap: launch window is 30 to 90 days", boot.data.launch && boot.data.launch.launchWindow === "30 to 90 days");
  check("creator categories are the launch set", Array.isArray(boot.data.creatorCategories) && boot.data.creatorCategories.includes("Beauty & Grooming") && boot.data.creatorCategories.includes("Food & Drink") && !boot.data.creatorCategories.includes("Lifestyle"));
  check("comp categories published", Array.isArray(boot.data.compCategories) && boot.data.compCategories.includes("Restaurant meals"));
  check("health and wellness is a creator category and a comp category", boot.data.creatorCategories.includes("Health & Wellness") && boot.data.compCategories.includes("Health & wellness services"), JSON.stringify([boot.data.creatorCategories, boot.data.compCategories]));
  check("bootstrap names the Headliners-tier paid campaigns option", boot.data.paidCampaignsComp === "Paid cash campaigns");
  check("bootstrap reports email transport off locally (queued, never faked)", boot.data.email && boot.data.email.enabled === false);

  // --- registration validation (profile builder enforces its fields) ---
  const basePayload = {
    role: "creator", name: "Launch Creator", email: "launch-a@fixtures.dev", password: "creator-pass-123",
    market: "Hampton Roads", city: "Norfolk", handle: "launcheats", followerCount: 8400,
    localAudiencePct: 62, categories: ["Food & Drink"], agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  };
  const noPct = await client()("POST", "/api/auth/register", { ...basePayload, email: "x1@fixtures.dev", localAudiencePct: undefined });
  check("registration without local audience % is refused (400)", noPct.status === 400, String(noPct.status));
  const noAgree = await client()("POST", "/api/auth/register", { ...basePayload, email: "x2@fixtures.dev", agreedFtcDisclosure: false });
  check("registration without the FTC agreement is refused (400)", noAgree.status === 400, String(noAgree.status));
  const noTerms = await client()("POST", "/api/auth/register", { ...basePayload, email: "x5@fixtures.dev", agreedTerms: false });
  check("registration without the Terms + email consent is refused (400)", noTerms.status === 400, String(noTerms.status));
  const badCity = await client()("POST", "/api/auth/register", { ...basePayload, email: "x3@fixtures.dev", city: "Richmond" });
  check("home city outside the chosen market is refused (400)", badCity.status === 400, String(badCity.status));
  const noCats = await client()("POST", "/api/auth/register", { ...basePayload, email: "x4@fixtures.dev", categories: [] });
  check("registration with no content category is refused (400)", noCats.status === 400, String(noCats.status));

  // --- business registration is a real account flow now ---
  const hopefulBiz = client();
  const bizAttempt = await hopefulBiz("POST", "/api/auth/register", {
    role: "business", name: "Hopeful Owner", businessName: "Hopeful Table", email: "hopeful@fixtures.dev",
    password: "business-pass-123", market: "Hampton Roads", city: "Norfolk", category: "Restaurant", planId: "managed",
    neighborhood: "Ghent", about: "Neighborhood spot, chef counter.", agreedTerms: true,
  });
  check("business registration succeeds (201) as a pending founding account", bizAttempt.status === 201 && bizAttempt.data.user && bizAttempt.data.user.status === "pending", JSON.stringify(bizAttempt.data).slice(0, 200));
  const hopefulBizId = bizAttempt.data.user && bizAttempt.data.user.id;
  check("business plan recorded honestly (Managed $999, founding billing, no charge)", bizAttempt.data.user.business.plan === "managed" && bizAttempt.data.user.business.planPriceMonthly === 999 && /no card charged/.test(bizAttempt.data.user.business.billingStatus), JSON.stringify(bizAttempt.data.user.business));
  check("business record is founding-state with profile fields and NO payment link (payment stays concierge)", bizAttempt.data.user.business.accessState === "founding" && !("paymentLink" in bizAttempt.data.user.business) && bizAttempt.data.user.business.neighborhood === "Ghent" && /chef counter/.test(bizAttempt.data.user.business.about), JSON.stringify(bizAttempt.data.user.business));
  const bizNoTerms = await client()("POST", "/api/auth/register", {
    role: "business", name: "No Terms", businessName: "No Terms Table", email: "noterms@fixtures.dev",
    password: "business-pass-123", market: "Hampton Roads", city: "Norfolk", category: "Restaurant", planId: "growth",
  });
  check("business registration without the Terms agreement is refused (400)", bizNoTerms.status === 400, String(bizNoTerms.status));
  const bizUnlisted = await client()("POST", "/api/auth/register", {
    role: "business", name: "Unlisted Owner", businessName: "Unlisted Table", email: "unlisted-biz@fixtures.dev",
    password: "business-pass-123", market: "Not listed yet", customCity: "Nowhere", customCountry: "United States", category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  // UX audit fix (2026-10-22): an unlisted-market business no
  // longer dead-ends at registration. It joins the founding list
  // for its typed city, exactly like a creator, and stays gated.
  check("business registration in an unlisted market joins the founding list (201), pending", bizUnlisted.status === 201 && bizUnlisted.data.user && bizUnlisted.data.user.status === "pending", JSON.stringify(bizUnlisted.data).slice(0, 200));
  check("unlisted business record keeps its typed city and stays founding-gated", !!bizUnlisted.data.user && bizUnlisted.data.user.city === "Nowhere" && bizUnlisted.data.user.business.accessState === "founding", JSON.stringify(bizUnlisted.data.user || {}).slice(0, 200));
  const bizUnlistedWrite = await client()("POST", "/api/auth/login", { email: "unlisted-biz@fixtures.dev", password: "business-pass-123" });
  check("the unlisted business can sign back in to its founding status", bizUnlistedWrite.status === 200, String(bizUnlistedWrite.status));
  const bizPendingWrite = await hopefulBiz("POST", "/api/favorites", { creatorId: "nobody" });
  check("a business still in review cannot write marketplace state (403)", bizPendingWrite.status === 403, String(bizPendingWrite.status));

  // --- full-profile creator: ALL SIX social fields filled ---
  const creatorA = client();
  const regA = await creatorA("POST", "/api/auth/register", {
    ...basePayload,
    tiktokHandle: "launcheats",
    youtubeChannel: "Launch Eats TV",
    facebookUrl: "launcheatspage",
    xHandle: "https://x.com/launcheats",
    linkedinUrl: "launcheats",
    tierBand: "Locals",
    avgViews: 5000,
    neighborhood: "Ghent",
    topAudienceCities: ["Norfolk", "Virginia Beach"],
    compCategories: ["Restaurant meals", "Drinks & nightlife"],
    bio: "Launch-shape verification creator with every social field filled.",
  });
  check("full-profile creator registration returns 201", regA.status === 201, JSON.stringify(regA.data));
  check("creator starts pending", regA.data.user && regA.data.user.status === "pending");
  const pc = regA.data.user.creator;
  const creatorAId = regA.data.user.id;
  check("Instagram link built from handle", pc.instagramUrl === "https://instagram.com/launcheats", pc.instagramUrl);
  check("TikTok link built from handle", pc.tiktokUrl === "https://www.tiktok.com/@launcheats", pc.tiktokUrl);
  check("YouTube channel stored", pc.youtubeChannel === "Launch Eats TV");
  check("Facebook bare page name canonicalized to a URL", pc.facebookUrl === "https://www.facebook.com/launcheatspage", pc.facebookUrl);
  check("X URL parsed to handle + canonical x.com URL", pc.xHandle === "launcheats" && pc.xUrl === "https://x.com/launcheats", JSON.stringify([pc.xHandle, pc.xUrl]));
  check("LinkedIn bare slug canonicalized to /in/ URL", pc.linkedinUrl === "https://www.linkedin.com/in/launcheats", pc.linkedinUrl);
  check("tier suggestion computed from followers (8400 -> Locals)", pc.suggestedTier === "Locals" && pc.computedTier === "Locals");
  check("local audience stored as Self-reported", pc.localAudiencePct === 62 && pc.localAudienceSource === "Self-reported");
  check("neighborhood stored at sign-up (optional free text)", pc.neighborhood === "Ghent", JSON.stringify(pc.neighborhood));
  check("rule acknowledgments stored with timestamp", pc.agreedHonestPosts === true && pc.agreedFtcDisclosure === true && !!pc.agreedAt);
  check("terms + marketing consent stored with version and timestamp", pc.agreedTerms === true && pc.termsVersion === boot.data.termsVersion && pc.marketingEmailConsent === true && !!pc.marketingConsentAt, JSON.stringify([pc.agreedTerms, pc.termsVersion, pc.marketingEmailConsent]));
  check("registration response shows the first-100 band, never the exact queue number", regA.data.user.founding && regA.data.user.founding.queueBand === 100 && regA.data.user.founding.queuePosition === undefined && regA.data.user.founding.creatorsInMarket === undefined && regA.data.user.founding.marketLive === false, JSON.stringify(regA.data.user.founding));

  // --- photo upload while pending, privacy of the photo route ---
  const photoUp = await creatorA("POST", "/api/me/photo", { dataUrl: TINY_PNG });
  check("profile photo upload accepted", photoUp.status === 200 && photoUp.data.ok === true, JSON.stringify(photoUp.data));
  const ownPhoto = await creatorA.raw(`/api/users/${creatorAId}/photo`);
  check("owner can fetch their photo as an image", ownPhoto.status === 200 && ownPhoto.contentType.includes("image/png") && ownPhoto.bytes > 50, `${ownPhoto.status} ${ownPhoto.contentType} ${ownPhoto.bytes}b`);
  const anonPhoto = await client().raw(`/api/users/${creatorAId}/photo`);
  check("anonymous photo fetch refused (401)", anonPhoto.status === 401, String(anonPhoto.status));

  // --- the roster is invisible to the public ---
  const anonDiscover = await anon("GET", "/api/discover?market=Hampton%20Roads");
  check("anonymous discovery refused (401): no public roster", anonDiscover.status === 401, String(anonDiscover.status));
  const anonFounding = await anon("GET", "/api/me/founding");
  check("anonymous founding endpoint refused (401)", anonFounding.status === 401);

  // --- admin approves; founding page takes over ---
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");
  const apps = await admin("GET", "/api/admin/applications");
  const pendingA = (apps.data.pending || []).find((u) => u.id === creatorAId);
  check("admin queue shows creator A with queue position 1", !!pendingA && pendingA.queuePosition === 1, JSON.stringify(pendingA && pendingA.queuePosition));
  const approveA = await admin("POST", "/api/admin/review", { userId: creatorAId, decision: "approve" });
  check("admin approves creator A", approveA.status === 200 && approveA.data.user.status === "approved");

  // --- the founding business, approved, in a NOT-live market ---
  // Approval alone opens nothing: the founding gate refuses
  // browse, favorites, offers, and Business Home server-side
  // until an admin activates the business by hand. After
  // activation, browse, favorites, and DRAFT offers are real
  // pre-launch; publishing and bookings stay market-gated.
  const approveBiz = await admin("POST", "/api/admin/review", { userId: hopefulBizId, decision: "approve" });
  check("admin approves the founding business (approval is not activation)", approveBiz.status === 200 && approveBiz.data.user.status === "approved" && approveBiz.data.user.business.accessState === "founding");
  const bizHomeGate = await hopefulBiz("GET", "/api/me/business-home");
  check("Business Home refuses for a founding business (403, points at the status page)", bizHomeGate.status === 403 && /Founding Status page/.test(bizHomeGate.data.error || ""), JSON.stringify(bizHomeGate.data));
  const bizBrowseGate = await hopefulBiz("GET", "/api/discover?market=Hampton%20Roads");
  check("browse refuses for a founding business (403): the roster is not visible pre-activation", bizBrowseGate.status === 403 && /founding list/.test(bizBrowseGate.data.error || ""), JSON.stringify(bizBrowseGate.data));
  const bizFavGate = await hopefulBiz("POST", "/api/favorites", { creatorId: creatorAId });
  check("favorites refuse for a founding business (403)", bizFavGate.status === 403, String(bizFavGate.status));
  const bizDraftGate = await hopefulBiz("POST", "/api/offers", { title: "Launch week dinner for two", whatComped: "Two entrees and two drinks", dollarCap: 100, spots: 2, visitWindow: "Evenings" });
  check("offers refuse for a founding business, drafts included (403)", bizDraftGate.status === 403, String(bizDraftGate.status));
  const activateBiz = await admin("POST", "/api/admin/businesses/activate", { userId: hopefulBizId });
  check("admin Activate business flips the founding business to active", activateBiz.status === 200 && activateBiz.data.user.business.accessState === "active", JSON.stringify(activateBiz.data.user && activateBiz.data.user.business));
  const bizHomePre = await hopefulBiz("GET", "/api/me/business-home");
  check("business home answers pre-launch with marketLive false", bizHomePre.status === 200 && bizHomePre.data.marketLive === false && bizHomePre.data.home && typeof bizHomePre.data.home.visitsUsed === "number", JSON.stringify(bizHomePre.data).slice(0, 200));
  const bizBrowsePre = await hopefulBiz("GET", "/api/discover?market=Hampton%20Roads");
  check("activated business can browse the roster pre-launch (200)", bizBrowsePre.status === 200 && (bizBrowsePre.data.creators || []).some((c) => c.userId === creatorAId), String(bizBrowsePre.status));
  const bizFavPre = await hopefulBiz("POST", "/api/favorites", { creatorId: creatorAId });
  check("activated business can favorite a creator pre-launch", bizFavPre.status === 200 && bizFavPre.data.isFavorite === true, JSON.stringify(bizFavPre.data));
  const bizFavsPre = await hopefulBiz("GET", "/api/favorites");
  check("favorites persist for the business", bizFavsPre.status === 200 && (bizFavsPre.data.favorites || []).some((c) => c.userId === creatorAId));
  const bizDraft = await hopefulBiz("POST", "/api/offers", { title: "Launch week dinner for two", whatComped: "Two entrees and two drinks", dollarCap: 100, spots: 2, visitWindow: "Evenings" });
  check("business offer in a not-live market saves as a DRAFT (201)", bizDraft.status === 201 && bizDraft.data.offer.status === "draft" && bizDraft.data.offer.lane === "open", JSON.stringify(bizDraft.data).slice(0, 200));
  const bizPublishPre = await hopefulBiz("POST", `/api/offers/${bizDraft.data.offer.id}/publish`, {});
  check("publishing stays gated until the market opens (403 with the launch message)", bizPublishPre.status === 403 && /Offers go live when your market opens/.test(bizPublishPre.data.error || ""), JSON.stringify(bizPublishPre.data));
  const bizBookingsPre = await hopefulBiz("GET", "/api/bookings");
  check("bookings stay gated for the business pre-launch (403)", bizBookingsPre.status === 403, String(bizBookingsPre.status));

  const founding = await creatorA("GET", "/api/me/founding");
  check("founding endpoint answers for the approved creator", founding.status === 200, JSON.stringify(founding.data));
  const f = founding.data.founding || {};
  const card = founding.data.card || {};
  check("founding status names the market and city", f.market === "Hampton Roads" && f.city === "Norfolk", JSON.stringify(f));
  check("founding status: market not live yet", f.marketLive === false);
  check("founding status shows the first-100 band, never the exact position or market counts", f.priorityBand === 100 && f.priorityPosition === undefined && f.foundingCreatorsInMarket === undefined, JSON.stringify(f));
  check("launch window on the founding page is 30 to 90 days", f.launchWindow === "30 to 90 days");
  check("founding card carries the computed Local Impact Score", typeof card.localImpactScore === "number", String(card.localImpactScore));
  check("founding card shows the photo URL", typeof card.photoUrl === "string" && card.photoUrl.endsWith("/photo"), String(card.photoUrl));
  check("founding card displays all six socials", card.profile.instagramUrl === "https://instagram.com/launcheats" && card.profile.tiktokUrl === "https://www.tiktok.com/@launcheats" && card.profile.youtubeChannel === "Launch Eats TV" && card.profile.facebookUrl === "https://www.facebook.com/launcheatspage" && card.profile.xUrl === "https://x.com/launcheats" && card.profile.linkedinUrl === "https://www.linkedin.com/in/launcheats");
  check("founding card exposes the neighborhood (card + profile)", card.neighborhood === "Ghent" && card.profile.neighborhood === "Ghent", JSON.stringify([card.neighborhood, card.profile && card.profile.neighborhood]));

  // --- public creator profile: /c/<handle>, approved only, whitelist only ---
  const pubRaw = await anon.raw("/api/c/launcheats");
  check("public profile answers for an approved creator, no sign-in", pubRaw.status === 200, String(pubRaw.status));
  check("public profile leaks no email, password material, or internal fields", !pubRaw.text.includes("launch-a@fixtures.dev") && !pubRaw.text.includes("passwordHash") && !pubRaw.text.includes("passwordSalt") && !pubRaw.text.includes("reviewedBy") && !pubRaw.text.includes("referredBy") && !pubRaw.text.includes("agreedTerms"), pubRaw.text.slice(0, 200));
  const pub = (JSON.parse(pubRaw.text) || {}).profile || {};
  check("public profile carries the public-safe fields", pub.name === "Launch Creator" && pub.handle === "launcheats" && pub.market === "Hampton Roads" && pub.city === "Norfolk" && pub.neighborhood === "Ghent" && pub.tierBand === "Locals" && pub.followerCount === 8400, JSON.stringify(pub));
  check("public profile shows local audience % with its source label", pub.localAudiencePct === 62 && pub.localAudienceSource === "Self-reported", JSON.stringify([pub.localAudiencePct, pub.localAudienceSource]));
  check("public profile carries categories and comp categories", Array.isArray(pub.categories) && pub.categories.includes("Food & Drink") && Array.isArray(pub.compCategories) && pub.compCategories.includes("Restaurant meals"), JSON.stringify([pub.categories, pub.compCategories]));
  // Momentum (expanded 2026-10-19): creator A already earns from
  // their own profile: photo +10, bio (66 chars) +5, neighborhood +5,
  // local audience % +5 = 25, before any referral or visit exists.
  check("public profile carries Local Impact Score and Momentum points (25 from profile completion)", typeof pub.localImpactScore === "number" && pub.momentumPoints === 25, JSON.stringify([pub.localImpactScore, pub.momentumPoints]));
  check("public profile shows the founding standing band, never an exact position", pub.foundingBand === 100 && pub.foundingPriority === undefined && pub.priorityPosition === undefined, JSON.stringify(pub.foundingBand));
  const pubCase = await anon("GET", "/api/c/LaunchEats");
  check("public profile handle lookup is case-insensitive", pubCase.status === 200 && !!pubCase.data.profile && pubCase.data.profile.handle === "launcheats", String(pubCase.status));
  const pubUnknown = await anon("GET", "/api/c/nosuchcreator");
  check("public profile for an unknown handle is 404", pubUnknown.status === 404, String(pubUnknown.status));
  const pubDirty = await anon("GET", "/api/c/%3Cscript%3E");
  check("public profile sanitizes markup in the handle and 404s", pubDirty.status === 404, String(pubDirty.status));
  const creatorP = client();
  const regP = await creatorP("POST", "/api/auth/register", { ...basePayload, name: "Pending Creator", email: "launch-p@fixtures.dev", handle: "pendingplates" });
  check("pending creator registers for the public-profile gate checks", regP.status === 201, JSON.stringify(regP.data));
  const pubPending = await anon("GET", "/api/c/pendingplates");
  check("public profile for a PENDING creator is 404", pubPending.status === 404, String(pubPending.status));
  await admin("POST", "/api/admin/review", { userId: regP.data.user.id, decision: "reject" });
  const pubRejected = await anon("GET", "/api/c/pendingplates");
  check("public profile for a REJECTED creator is 404", pubRejected.status === 404, String(pubRejected.status));
  const pubPage = await anon.raw("/c/launcheats");
  check("the /c/<handle> page serves the app shell to logged-out visitors", pubPage.status === 200 && pubPage.text.includes("/app.js"), String(pubPage.status));
  const appJsPub = await anon.raw("/app.js");
  check("client ships the public profile view, the /c/ route handling, and the dashboard profile link", appJsPub.text.includes("renderPublicProfile") && appJsPub.text.includes("public-profile") && appJsPub.text.includes("app.joinsignl.com/c/") && appJsPub.text.includes("Your public profile") && appJsPub.text.includes("copyPublicProfile"), "");

  // --- richer profiles: photo, best work, track record, reviews ---
  const bwSet = await creatorA("PATCH", "/api/me/profile", { bestWork: ["https://www.instagram.com/reel/ABC123/", "https://www.tiktok.com/@launcheats/video/123", "https://www.youtube.com/watch?v=xyz"] });
  check("creator adds 3 best work links (Instagram, TikTok, YouTube)", bwSet.status === 200 && (bwSet.data.user.creator.bestWork || []).length === 3, JSON.stringify(bwSet.data.user && bwSet.data.user.creator && bwSet.data.user.creator.bestWork));
  const bwBadHost = await creatorA("PATCH", "/api/me/profile", { bestWork: ["https://vimeo.com/123"] });
  check("best work rejects a non-Instagram/TikTok/YouTube host (400)", bwBadHost.status === 400, String(bwBadHost.status));
  const bwTooMany = await creatorA("PATCH", "/api/me/profile", { bestWork: ["https://www.instagram.com/p/1/", "https://www.instagram.com/p/2/", "https://www.instagram.com/p/3/", "https://www.instagram.com/p/4/"] });
  check("best work caps at 3 links (400)", bwTooMany.status === 400, String(bwTooMany.status));
  const bwBadProto = await creatorA("PATCH", "/api/me/profile", { bestWork: ["javascript:alert(1)"] });
  check("best work rejects non-http(s) URLs (400)", bwBadProto.status === 400, String(bwBadProto.status));
  const pubRich = await anon("GET", "/api/c/launcheats");
  const pr = pubRich.data.profile || {};
  check("public profile now carries the creator photo URL", pr.photoUrl === `/api/users/${creatorAId}/photo`, String(pr.photoUrl));
  check("public profile renders best work as labeled outbound cards", Array.isArray(pr.bestWork) && pr.bestWork.length === 3 && pr.bestWork[0].platform === "Instagram" && pr.bestWork[0].label === "Watch: Instagram reel" && pr.bestWork[1].platform === "TikTok" && pr.bestWork[2].platform === "YouTube", JSON.stringify(pr.bestWork));
  check("public profile track record is the honest zero state before any visit", !!pr.trackRecord && pr.trackRecord.isNew === true && pr.trackRecord.visitsCompleted === 0 && pr.trackRecord.postsDelivered === 0 && pr.trackRecord.onTimePct === null && (pr.trackRecord.businessesWorkedWith || []).length === 0, JSON.stringify(pr.trackRecord));
  check("public profile has no reviews before any exist (never seeded)", !!pr.reviewSummary && pr.reviewSummary.count === 0 && pr.reviewSummary.average === null && Array.isArray(pr.reviews) && pr.reviews.length === 0, JSON.stringify(pr.reviewSummary));
  const pubRichRaw = await anon.raw("/api/c/launcheats");
  check("public profile with photo + best work + track record still leaks no email or internal fields", !pubRichRaw.text.includes("launch-a@fixtures.dev") && !pubRichRaw.text.includes("passwordHash") && !pubRichRaw.text.includes("passwordSalt") && !pubRichRaw.text.includes("reviewedBy") && !pubRichRaw.text.includes("referredBy") && !pubRichRaw.text.includes("agreedTerms"), pubRichRaw.text.slice(0, 160));
  const pubPhotoAnon = await client().raw(pr.photoUrl || "/api/users/none/photo");
  check("an approved creator's photo serves to the public (it is on their profile page)", pubPhotoAnon.status === 200 && pubPhotoAnon.contentType.includes("image/png"), `${pubPhotoAnon.status} ${pubPhotoAnon.contentType}`);
  check("client ships best work editing and the showcase renderers (track record zero state, reviews)", appJsPub.text.includes("p-work-") && appJsPub.text.includes("New to SIGNL: no visits yet") && appJsPub.text.includes("creatorShowcaseHtml") && appJsPub.text.includes("Business reviews") && appJsPub.text.includes("Watch:"), "");

  // --- neighborhood round-trips through profile edit + admin list ---
  const nbPatch = await creatorA("PATCH", "/api/me/profile", { neighborhood: "Oceanfront" });
  check("profile edit updates the neighborhood", nbPatch.status === 200 && nbPatch.data.user.creator.neighborhood === "Oceanfront", JSON.stringify(nbPatch.data.user && nbPatch.data.user.creator && nbPatch.data.user.creator.neighborhood));
  const meAfterNb = await creatorA("GET", "/api/auth/me");
  check("neighborhood persists on the creator's own payload", meAfterNb.data.user.creator.neighborhood === "Oceanfront");
  const appsAfterNb = await admin("GET", "/api/admin/applications");
  const decidedA = (appsAfterNb.data.decided || []).find((u) => u.id === creatorAId);
  check("admin applications list carries the neighborhood", !!decidedA && decidedA.creator.neighborhood === "Oceanfront", JSON.stringify(decidedA && decidedA.creator && decidedA.creator.neighborhood));
  const nbClear = await creatorA("PATCH", "/api/me/profile", { neighborhood: "" });
  check("neighborhood can be cleared back to empty (stays optional)", nbClear.status === 200 && nbClear.data.user.creator.neighborhood === "", JSON.stringify(nbClear.data.user && nbClear.data.user.creator && nbClear.data.user.creator.neighborhood));
  check("founding card carries the first-100 band, not an exact priority number", card.foundingBand === 100 && card.foundingPriority === undefined, String(card.foundingBand));

  // the client actually renders those links (display wiring in app.js)
  const appJs = await anon.raw("/app.js");
  check("client renders Facebook, X, and LinkedIn links on profiles", appJs.text.includes("Facebook") && appJs.text.includes("LinkedIn") && appJs.text.includes('>X</a>'));

  // --- marketplace stays closed in a not-live market ---
  const gatedOffers = await creatorA("GET", "/api/offers");
  check("offers are gated before market launch (403)", gatedOffers.status === 403, String(gatedOffers.status));
  const gatedDiscover = await creatorA("GET", "/api/discover?market=Hampton%20Roads");
  check("discovery is gated before market launch (403)", gatedDiscover.status === 403, String(gatedDiscover.status));
  check("gate message names the launch window", /30 to 90 days/.test((gatedOffers.data && gatedOffers.data.error) || ""), gatedOffers.data && gatedOffers.data.error);

  // --- second founding creator: priority follows sign-up order ---
  const creatorB = client();
  const regB = await creatorB("POST", "/api/auth/register", { ...basePayload, name: "Second Creator", email: "launch-b@fixtures.dev", handle: "secondeats", city: "Virginia Beach" });
  check("second creator registers", regB.status === 201, JSON.stringify(regB.data));
  check("sign-up without a neighborhood still works; the field defaults to empty", regB.data.user.creator.neighborhood === "", JSON.stringify(regB.data.user.creator.neighborhood));
  await admin("POST", "/api/admin/review", { userId: regB.data.user.id, decision: "approve" });
  const foundingB = await creatorB("GET", "/api/me/founding");
  check("second approved creator also lands in the first-100 band (exact order stays internal)", foundingB.data.founding && foundingB.data.founding.priorityBand === 100 && foundingB.data.founding.priorityPosition === undefined, JSON.stringify(foundingB.data.founding));
  const foundingA2 = await creatorA("GET", "/api/me/founding");
  check("first creator keeps the first-100 band and never sees market signup counts", foundingA2.data.founding.priorityBand === 100 && foundingA2.data.founding.foundingCreatorsInMarket === undefined && foundingA2.data.founding.creatorsInMarket === undefined);

  // An APPROVED creator's photo is part of their public profile page
  // (Jeff, 2026-10-19: the photo ships on /c/<handle>), so another
  // signed-in creator can fetch it. The locked-down side still holds
  // before approval: the anonymous fetch of this same photo while
  // creator A was pending was refused with 401 above.
  const crossPhoto = await creatorB.raw(`/api/users/${creatorAId}/photo`);
  check("an approved creator's photo is fetchable by another creator (it is on their public profile)", crossPhoto.status === 200 && crossPhoto.contentType.includes("image/png"), String(crossPhoto.status));

  // --- admin market controls, then activation opens the gate ---
  const markets = await admin("GET", "/api/admin/markets");
  const hr = (markets.data.markets || []).find((m) => m.name === "Hampton Roads");
  check("admin markets list: 39 markets, Hampton Roads founding-only with 2 approved creators", (markets.data.markets || []).length === 39 && !!hr && hr.live === false && hr.creatorsApproved === 2, JSON.stringify(hr));
  const dubaiRow = (markets.data.markets || []).find((m) => m.name === "Dubai");
  check("admin markets list: Dubai present, United Arab Emirates, not live", !!dubaiRow && dubaiRow.country === "United Arab Emirates" && dubaiRow.live === false, JSON.stringify(dubaiRow));
  const toggle = await admin("POST", "/api/admin/markets/toggle", { market: "Hampton Roads", live: true });
  check("admin activates Hampton Roads", toggle.status === 200 && toggle.data.live === true, JSON.stringify(toggle.data));
  const openOffers = await creatorA("GET", "/api/offers");
  check("offers open once the market is live (200)", openOffers.status === 200, String(openOffers.status));
  const disc = await creatorA("GET", "/api/discover?market=Hampton%20Roads");
  check("discovery default sort is founding priority (earliest sign-up first), displayed as bands", (disc.data.creators || []).length === 2 && disc.data.creators[0].userId === creatorAId && disc.data.creators[0].foundingBand === 100 && disc.data.creators[1].foundingBand === 100 && disc.data.creators[0].foundingPriority === undefined, JSON.stringify((disc.data.creators || []).map((c) => [c.userId === creatorAId, c.foundingBand])));
  const discScore = await creatorA("GET", "/api/discover?market=Hampton%20Roads&sort=score");
  check("discovery score sort still available (?sort=score)", discScore.status === 200 && (discScore.data.creators || []).length === 2);
  const lateBiz = client();
  const bizAfter = await lateBiz("POST", "/api/auth/register", {
    role: "business", name: "Late Owner", businessName: "Late Table", email: "late@fixtures.dev",
    password: "business-pass-123", market: "Hampton Roads", city: "Norfolk", category: "Restaurant", planId: "managed", agreedTerms: true,
  });
  check("business registration works the same in a live market (201): founding intake, the live flag does not change sign-up", bizAfter.status === 201 && bizAfter.data.user.status === "pending" && bizAfter.data.user.business.accessState === "founding", String(bizAfter.status));
  await admin("POST", "/api/admin/review", { userId: bizAfter.data.user.id, decision: "approve" });
  const lateBrowse = await lateBiz("GET", "/api/discover?market=Hampton%20Roads");
  check("a live market does NOT silently activate a founding business: browse still refuses (403) until an admin activates it", lateBrowse.status === 403 && /founding list/.test(lateBrowse.data.error || ""), JSON.stringify(lateBrowse.data));

  // --- admin Business Preview: same discovery, simulated offers ---
  // This is the server-side proof of the preview path (the suite signs
  // in as the env admin, exactly as Jeff does in the browser): the
  // preview endpoints answer with the real roster and filters, and a
  // simulated offer leaves no trace a creator, a count, or the event
  // log can see.
  const pvDisc = await admin("GET", "/api/admin/preview/discover?market=Hampton%20Roads");
  check("preview discovery answers for the admin with the real roster", pvDisc.status === 200 && pvDisc.data.preview === true && (pvDisc.data.creators || []).some((c) => c.userId === creatorAId), String(pvDisc.status));
  const pvCard = (pvDisc.data.creators || []).find((c) => c.userId === creatorAId) || {};
  check("preview card carries the rich profile (best work, track record, review summary)", Array.isArray(pvCard.bestWork) && pvCard.bestWork.length === 3 && !!pvCard.trackRecord && pvCard.trackRecord.isNew === true && !!pvCard.reviewSummary && pvCard.reviewSummary.count === 0, JSON.stringify([pvCard.bestWork && pvCard.bestWork.length, pvCard.trackRecord]));
  const pvFilterMiss = await admin("GET", "/api/admin/preview/discover?market=Hampton%20Roads&minLocalPct=70");
  check("preview discovery honors the min local % filter (62 < 70 excluded)", !(pvFilterMiss.data.creators || []).some((c) => c.userId === creatorAId));
  const pvFilterHit = await admin("GET", "/api/admin/preview/discover?market=Hampton%20Roads&minLocalPct=50&sort=momentum");
  check("preview discovery honors filters + momentum sort together", pvFilterHit.status === 200 && (pvFilterHit.data.creators || []).some((c) => c.userId === creatorAId));
  const pvDubai = await admin("GET", "/api/admin/preview/discover?market=Dubai");
  check("preview discovery works in a market that is not live yet", pvDubai.status === 200 && pvDubai.data.preview === true, String(pvDubai.status));
  const pvCreator = await admin("GET", `/api/admin/preview/creator/${creatorAId}`);
  check("preview full profile answers with momentum + showcase", pvCreator.status === 200 && !!pvCreator.data.creator && pvCreator.data.creator.userId === creatorAId && typeof pvCreator.data.creator.momentum.points === "number" && Array.isArray(pvCreator.data.creator.bestWork), String(pvCreator.status));
  const pvForbidden = await creatorA("GET", "/api/admin/preview/discover?market=Hampton%20Roads");
  check("preview is admin-only (a creator gets 403)", pvForbidden.status === 403, String(pvForbidden.status));
  const statsBeforePv = await admin("GET", "/api/admin/stats");
  const evBeforePv = await admin("GET", "/api/admin/events?limit=2000");
  const pvOffer = await admin("POST", "/api/admin/preview/offers", { creatorId: creatorAId, title: "Preview only dinner", whatComped: "Two entrees (simulation)", dollarCap: 60, spots: 1, visitWindow: "Weeknights" });
  check("preview offer composer validates and confirms as a simulation", pvOffer.status === 201 && pvOffer.data.preview === true && !!pvOffer.data.offer && pvOffer.data.offer.preview === true && pvOffer.data.offer.creatorHandle === "launcheats", JSON.stringify(pvOffer.data));
  const creatorOffersAfterPv = await creatorA("GET", "/api/offers");
  check("preview offer is invisible to the creator (their offer list stays empty)", creatorOffersAfterPv.status === 200 && (creatorOffersAfterPv.data.offers || []).length === 0 && !(creatorOffersAfterPv.data.offers || []).some((o) => o.title === "Preview only dinner"), JSON.stringify(creatorOffersAfterPv.data.offers));
  const statsAfterPv = await admin("GET", "/api/admin/stats");
  check("preview offer moved no counts (admin stats offers identical before/after)", statsAfterPv.data.offers === statsBeforePv.data.offers, JSON.stringify([statsBeforePv.data.offers, statsAfterPv.data.offers]));
  const evAfterPv = await admin("GET", "/api/admin/events?limit=2000");
  check("preview offer wrote no events (offer_created count identical before/after)", (evAfterPv.data.events || []).filter((e) => e.type === "offer_created").length === (evBeforePv.data.events || []).filter((e) => e.type === "offer_created").length, "");
  check("client ships the business preview mode (banner, steps, simulated composer)", appJs.text.includes("Preview as business") && appJs.text.includes("PREVIEW") && appJs.text.includes("renderPreview") && appJs.text.includes("previewSendOffer") && appJs.text.includes("/admin/preview/offers") && appJs.text.includes("exitPreview"), "");

  // --- admin Business Preview dashboard: the full visit lifecycle
  // over the real roster, with the preview invariant held: the route
  // renders only for the admin, and answering it writes no events,
  // moves no counts, and leaves no booking anywhere a real surface
  // can see.
  const creatorBId = regB.data.user.id;
  const evBeforeDash = await admin("GET", "/api/admin/events?limit=2000");
  const statsBeforeDash = await admin("GET", "/api/admin/stats");
  const dashRes = await admin("GET", "/api/admin/preview/dashboard");
  const dash = dashRes.data.dashboard || {};
  const dBookings = dash.bookings || [];
  check("preview dashboard answers for the admin as a flagged simulation on the Growth plan", dashRes.status === 200 && dashRes.data.preview === true && dash.preview === true && !!dash.plan && dash.plan.id === "growth" && dash.plan.visitsPerMonth === 20, `${dashRes.status} ${JSON.stringify(dash.plan || null)}`);
  check("preview dashboard covers the full lifecycle (booked, clock running, on time, late, overdue)", ["booked", "post_due", "posted_on_time", "posted_late", "overdue"].every((st) => dBookings.some((b) => b.state === st)), JSON.stringify(dBookings.map((b) => b.state)));
  check("preview dashboard bookings are all flagged simulated with preview ids", dBookings.length === 5 && dBookings.every((b) => b.preview === true && b.id.startsWith("preview-dash-") && b.businessId === "__preview__"), JSON.stringify(dBookings.map((b) => b.id)));
  check("preview dashboard features only the real approved roster", dBookings.length > 0 && dBookings.every((b) => [creatorAId, creatorBId].includes(b.creatorId)) && dBookings.some((b) => b.creatorId === creatorAId), JSON.stringify(dBookings.map((b) => b.creatorHandle)));
  const codeRe = /^SGNL-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
  check("every dashboard code matches the SGNL-XXXXXX format", dBookings.length > 0 && dBookings.every((b) => codeRe.test(b.code)), JSON.stringify(dBookings.map((b) => b.code)));
  check("dashboard codes are unique within the response", new Set(dBookings.map((b) => b.code)).size === dBookings.length, "");
  const bookedBk = dBookings.find((b) => b.state === "booked") || {};
  check("the booked dashboard booking carries a rendered QR (the counter credential)", typeof bookedBk.qrSvg === "string" && bookedBk.qrSvg.includes("<svg") && !!bookedBk.redeemBy && Date.parse(bookedBk.redeemBy) > Date.now(), String(bookedBk.qrSvg || "").slice(0, 60));
  check("every dashboard booking carries the Standard Visit checklist", dBookings.every((b) => Array.isArray(b.checklist) && b.checklist.length === 6 && b.checklist.some((it) => it.key === "post")), "");
  const overdueBk = dBookings.find((b) => b.state === "overdue") || {};
  check("the problem booking surfaces its alerts and the hard stop", Array.isArray(overdueBk.alerts) && overdueBk.alerts.length >= 2 && !!overdueBk.pauseAt && Date.parse(overdueBk.pauseAt) > Date.now() && overdueBk.replacementAvailable === true, JSON.stringify(overdueBk.alerts || null));
  const dSum = dash.summary || {};
  const deliveredPosts = dBookings.filter((b) => b.post);
  check("dashboard summary is consistent with its own bookings (tracking + returns)", dSum.modeled === true && dSum.visitsUsed === dBookings.length && dSum.visitsAllowance === 20 && dSum.postsDelivered === deliveredPosts.length && dSum.totalViews === deliveredPosts.reduce((s, b) => s + (b.post.views || 0), 0) && dSum.totalLikes === deliveredPosts.reduce((s, b) => s + (b.post.likes || 0), 0) && dSum.compValueGiven === dBookings.reduce((s, b) => s + (b.redeemedAt ? b.compCostModeled || 0 : 0), 0), JSON.stringify(dSum));
  // SIGNL ROAS (2026-10-19): the returns story is the score now.
  // The two delivered bookings carry fixed simulated tallies
  // (9 redemptions / $486 and 6 / $318) and fixed reported numbers,
  // so the aggregate is exact: media 449.40 + 292.30 = 741.70,
  // register 804, value 1545.70, costs 85 comp + 160.80 discounts,
  // score 6.29, all-in with $29.95 x 2 of plan allocation 5.06.
  const dRoas = dSum.roas || {};
  check("dashboard summary carries the SIGNL ROAS block, labeled as our own model", dRoas.label === "SIGNL ROAS Score, our own model" && dRoas.redemptions && dRoas.redemptions.count === 15 && dRoas.redemptions.basketTotal === 804 && dRoas.registerValue === 804 && dRoas.mediaValue === 741.7 && dRoas.value === 1545.7 && dRoas.compCost === 85 && dRoas.discountCost === 160.8 && dRoas.planAllocation === 59.9 && dRoas.score === 6.29 && dRoas.allInScore === 5.06, JSON.stringify(dRoas));
  check("dashboard ROAS carries the floor + modeled framing, never revenue language", /floor/.test(dRoas.registerBasis || "") && /[Mm]odeled/.test(dRoas.mediaBasis || "") && !/revenue (generated|we generated)/i.test(JSON.stringify(dSum)), "");
  check("the old CPM-only media line is gone from the summary", dSum.mediaValueReceived === undefined && dSum.returnMultiple === undefined, JSON.stringify(Object.keys(dSum)));
  check("delivered dashboard bookings carry creator codes, tallies, and their own scores", deliveredPosts.every((b) => typeof b.creatorCode === "string" && b.creatorCode.length > 3 && b.redemptions && typeof b.redemptions.count === "number" && b.roas && typeof b.roas.score === "number"), JSON.stringify(deliveredPosts.map((b) => ({ code: b.creatorCode, roas: b.roas && b.roas.score }))));
  check("dashboard carries the visit-based rights recap and the Standard Visit", !!dash.rights && dash.rights.comp && dash.rights.comp.adUse === false && dash.rights.paid && dash.rights.paid.adUse === true && Array.isArray(dash.rights.paid.can) && !!dash.standardVisit && Array.isArray(dash.standardVisit.deliverables), "");
  const evAfterDash = await admin("GET", "/api/admin/events?limit=2000");
  check("preview dashboard wrote no events", (evAfterDash.data.events || []).length === (evBeforeDash.data.events || []).length, `${(evBeforeDash.data.events || []).length} -> ${(evAfterDash.data.events || []).length}`);
  const statsAfterDash = await admin("GET", "/api/admin/stats");
  check("preview dashboard moved no counts (admin stats identical)", JSON.stringify(statsAfterDash.data) === JSON.stringify(statsBeforeDash.data), "");
  const adminBookings = await admin("GET", "/api/bookings");
  check("simulated bookings never appear in the real bookings list", !(adminBookings.data.bookings || []).some((b) => String(b.id).startsWith("preview-dash-") || dBookings.some((db) => db.code === b.code)), JSON.stringify((adminBookings.data.bookings || []).map((b) => b.id)));
  const creatorABookings = await creatorA("GET", "/api/bookings");
  check("a featured creator's real bookings stay empty after the dashboard", creatorABookings.status === 200 && (creatorABookings.data.bookings || []).length === 0, JSON.stringify(creatorABookings.data.bookings || null));
  const dashForbidden = await creatorA("GET", "/api/admin/preview/dashboard");
  check("preview dashboard is admin-only (a creator gets 403)", dashForbidden.status === 403, String(dashForbidden.status));
  const dashAnon = await client()("GET", "/api/admin/preview/dashboard");
  check("preview dashboard refuses signed-out callers (401)", dashAnon.status === 401, String(dashAnon.status));
  check("client ships the preview dashboard (nav, countdown, staff panel, returns)", appJs.text.includes("previewToDashboard") && appJs.text.includes("/admin/preview/dashboard") && appJs.text.includes("previewDashboardHtml") && appJs.text.includes("What staff see at the counter") && appJs.text.includes("enterPreviewDashboard"), "");

  // --- tester designation: approved, but never on the roster ---
  // A tester account (Tony Johnson is the first) exercises the app
  // as a creator while staying invisible to businesses: discovery
  // excludes them, /c/<handle> 404s, their photo is not public, and
  // roster / approved counts skip them. Their own creator side
  // keeps working normally: testing is the point.
  const testerC = client();
  const regT = await testerC("POST", "/api/auth/register", { ...basePayload, name: "Tony Tester", email: "launch-t@fixtures.dev", handle: "tonytester", city: "Norfolk" });
  check("tester candidate registers", regT.status === 201, JSON.stringify(regT.data));
  const testerId = regT.data.user.id;
  check("new accounts start with the tester flag off", regT.data.user.tester === false, JSON.stringify(regT.data.user.tester));
  const tPhotoUp = await testerC("POST", "/api/me/photo", { dataUrl: TINY_PNG });
  check("tester candidate uploads a photo", tPhotoUp.status === 200, JSON.stringify(tPhotoUp.data));
  await admin("POST", "/api/admin/review", { userId: testerId, decision: "approve" });
  const statsWithT = await admin("GET", "/api/admin/stats");
  check("before the flag: stats count 3 approved creators in Hampton Roads, 0 testers", statsWithT.data.perMarket["Hampton Roads"].creators === 3 && statsWithT.data.users.testers === 0, JSON.stringify([statsWithT.data.perMarket["Hampton Roads"], statsWithT.data.users]));
  check("before the flag: the tester's public profile resolves", (await anon("GET", "/api/c/tonytester")).status === 200);
  const discWithT = await creatorA("GET", "/api/discover?market=Hampton%20Roads");
  check("before the flag: discovery shows all 3 approved creators", (discWithT.data.creators || []).length === 3, JSON.stringify((discWithT.data.creators || []).length));
  check("the toggle refuses a non-admin (403)", (await creatorA("POST", "/api/admin/tester", { userId: testerId, tester: true })).status === 403);
  check("the toggle refuses the signed-out (401)", (await client()("POST", "/api/admin/tester", { userId: testerId, tester: true })).status === 401);
  check("the toggle refuses an unknown user (404)", (await admin("POST", "/api/admin/tester", { userId: "no-such-user", tester: true })).status === 404);
  check("the toggle refuses a non-boolean flag (400)", (await admin("POST", "/api/admin/tester", { userId: testerId, tester: "yes" })).status === 400);
  const flipT = await admin("POST", "/api/admin/tester", { userId: testerId, tester: true });
  check("admin moves the creator to Tester (account stays approved)", flipT.status === 200 && flipT.data.user.tester === true && flipT.data.user.status === "approved", JSON.stringify(flipT.data));
  const appsT = await admin("GET", "/api/admin/applications");
  const decidedT = (appsT.data.decided || []).find((u) => u.id === testerId);
  check("admin applications list carries the tester flag (drives the Tester badge)", !!decidedT && decidedT.tester === true, JSON.stringify(decidedT && decidedT.tester));
  check("tester's public profile 404s exactly like a pending creator's", (await anon("GET", "/api/c/tonytester")).status === 404);
  const discNoT = await creatorA("GET", "/api/discover?market=Hampton%20Roads");
  check("discovery excludes the tester (back to the 2 real creators)", (discNoT.data.creators || []).length === 2 && !(discNoT.data.creators || []).some((c) => c.userId === testerId), JSON.stringify((discNoT.data.creators || []).map((c) => c.name)));
  const pvDiscNoT = await admin("GET", "/api/admin/preview/discover?market=Hampton%20Roads");
  check("business preview discovery excludes the tester too (same discovery query)", !(pvDiscNoT.data.creators || []).some((c) => c.userId === testerId));
  const anonTPhoto = await client().raw(`/api/users/${testerId}/photo`);
  check("the tester's photo is not public while flagged (401 anonymous)", anonTPhoto.status === 401, String(anonTPhoto.status));
  const ownTPhoto = await testerC.raw(`/api/users/${testerId}/photo`);
  check("the tester can still fetch their own photo (200)", ownTPhoto.status === 200 && ownTPhoto.contentType.includes("image/png"), String(ownTPhoto.status));
  const statsNoT = await admin("GET", "/api/admin/stats");
  check("stats exclude the tester from roster counts and report testers separately", statsNoT.data.perMarket["Hampton Roads"].creators === 2 && statsNoT.data.users.approved === statsWithT.data.users.approved - 1 && statsNoT.data.users.testers === 1, JSON.stringify([statsNoT.data.perMarket["Hampton Roads"], statsNoT.data.users]));
  const marketsNoT = await admin("GET", "/api/admin/markets");
  const hrNoT = (marketsNoT.data.markets || []).find((m) => m.name === "Hampton Roads");
  check("admin markets: Hampton Roads approved creators back to 2 with a tester flagged", !!hrNoT && hrNoT.creatorsApproved === 2, JSON.stringify(hrNoT));
  const meT = await testerC("GET", "/api/auth/me");
  check("the tester still signs in and sees their own account (flag visible to them)", meT.status === 200 && meT.data.user.tester === true && meT.data.user.status === "approved", JSON.stringify(meT.data.user && [meT.data.user.tester, meT.data.user.status]));
  const foundingT = await testerC("GET", "/api/me/founding");
  check("the tester's founding page still works", foundingT.status === 200 && !!foundingT.data.founding, JSON.stringify(foundingT.data));
  const patchT = await testerC("PATCH", "/api/me/profile", { neighborhood: "Ocean View" });
  check("the tester can still edit their profile", patchT.status === 200 && patchT.data.user.creator.neighborhood === "Ocean View", JSON.stringify(patchT.data.user && patchT.data.user.creator && patchT.data.user.creator.neighborhood));
  const unflipT = await admin("POST", "/api/admin/tester", { userId: testerId, tester: false });
  check("admin moves the creator back to the roster", unflipT.status === 200 && unflipT.data.user.tester === false, JSON.stringify(unflipT.data));
  check("back on the roster: the public profile resolves again", (await anon("GET", "/api/c/tonytester")).status === 200);
  const discBackT = await creatorA("GET", "/api/discover?market=Hampton%20Roads");
  check("back on the roster: discovery shows them again", (discBackT.data.creators || []).length === 3, JSON.stringify((discBackT.data.creators || []).length));
  check("client ships the tester toggle (Move to Tester / Move to roster, Tester badge) in the admin applications list", appJs.text.includes("Move to Tester") && appJs.text.includes("Move to roster") && appJs.text.includes("setTester") && appJs.text.includes("/admin/tester") && appJs.text.includes(">Tester</span>"), "");
  check("client stats tab shows the separate testers count", appJs.text.includes("Testers (excluded from roster counts)"), "");
  await admin("POST", "/api/admin/tester", { userId: testerId, tester: true });

  // --- paid cash campaigns: a Headliners-tier option only ---
  const creatorC = client();
  const regC = await creatorC("POST", "/api/auth/register", {
    ...basePayload, name: "Big Creator", email: "launch-c@fixtures.dev", handle: "bigcreator",
    followerCount: 42000, tierBand: "Headliners", compCategories: ["Restaurant meals", "Paid cash campaigns"],
  });
  check("Headliners-tier registration with paid campaigns selected returns 201", regC.status === 201, JSON.stringify(regC.data));
  check("paid campaigns stored for the Headliners-tier creator", regC.data.user.creator.openToPaidCampaigns === true && regC.data.user.creator.compCategories.includes("Paid cash campaigns"), JSON.stringify(regC.data.user.creator.compCategories));
  const creatorD = client();
  const regD = await creatorD("POST", "/api/auth/register", {
    ...basePayload, name: "Local Creator", email: "launch-d@fixtures.dev", handle: "localcreator",
    followerCount: 8400, tierBand: "Locals", compCategories: ["Restaurant meals", "Paid cash campaigns"],
  });
  check("Locals-tier attempt at paid campaigns is stripped server-side", regD.status === 201 && regD.data.user.creator.openToPaidCampaigns === false && !regD.data.user.creator.compCategories.includes("Paid cash campaigns"), JSON.stringify(regD.data.user.creator.compCategories));
  const patchPaidOff = await creatorC("PATCH", "/api/me/profile", { compCategories: ["Restaurant meals"] });
  check("profile update can drop the paid campaigns option", patchPaidOff.status === 200 && patchPaidOff.data.user.creator.openToPaidCampaigns === false, JSON.stringify(patchPaidOff.data));
  const patchTierDrop = await creatorC("PATCH", "/api/me/profile", { followerCount: 8400, audienceStack: { instagram: 8400 }, compCategories: ["Restaurant meals", "Paid cash campaigns"] });
  check("dropping out of the Headliners tier (counts fall, band re-derives to Locals) removes the paid option", patchTierDrop.status === 200 && patchTierDrop.data.user.creator.tierBand === "Locals" && patchTierDrop.data.user.creator.openToPaidCampaigns === false && !patchTierDrop.data.user.creator.compCategories.includes("Paid cash campaigns"), JSON.stringify(patchTierDrop.data));
  const approveC = await admin("POST", "/api/admin/review", { userId: regC.data.user.id, decision: "approve" });
  check("admin approves the Headliners-tier creator", approveC.status === 200 && approveC.data.user.status === "approved");

  // --- Dubai is a core market: picked, never typed in ---
  const dubaiCreator = client();
  const regDubai = await dubaiCreator("POST", "/api/auth/register", { ...basePayload, name: "Dubai Creator", email: "launch-dubai@fixtures.dev", handle: "dubaieats", market: "Dubai", city: "Dubai" });
  check("Dubai is selectable as a core market at sign-up (201)", regDubai.status === 201, JSON.stringify(regDubai.data));
  check("Dubai sign-up stores the market and its country, founding-only", regDubai.data.user.market === "Dubai" && regDubai.data.user.country === "United Arab Emirates" && regDubai.data.user.founding.marketLive === false && regDubai.data.user.founding.unlisted === false, JSON.stringify([regDubai.data.user.market, regDubai.data.user.country, regDubai.data.user.founding]));
  const londonAttempt = await client()("POST", "/api/auth/register", { ...basePayload, email: "x7@fixtures.dev", handle: "londonwrong", market: "London", city: "Dubai" });
  check("a city outside the picked market is still refused (London market, Dubai city, 400)", londonAttempt.status === 400, String(londonAttempt.status));
  const regSingapore = await client()("POST", "/api/auth/register", { ...basePayload, name: "Singapore Creator", email: "launch-sg@fixtures.dev", handle: "singaporeeats", market: "Singapore", city: "Singapore" });
  check("Singapore (Bella list) is selectable as a core market at sign-up", regSingapore.status === 201 && regSingapore.data.user.market === "Singapore" && regSingapore.data.user.country === "Singapore" && regSingapore.data.user.founding.marketLive === false, JSON.stringify(regSingapore.data.user && [regSingapore.data.user.market, regSingapore.data.user.country]));

  // --- city not listed: anyone can sign up, counted per city ---
  check("bootstrap names the unlisted pseudo-market", boot.data.unlistedMarket === "Not listed yet");
  const noCountry = await client()("POST", "/api/auth/register", { ...basePayload, email: "x6@fixtures.dev", market: "Not listed yet", customCity: "Tulsa", customState: "OK" });
  check("unlisted sign-up without a country is refused (400)", noCountry.status === 400, String(noCountry.status));
  const creatorE = client();
  const regE = await creatorE("POST", "/api/auth/register", { ...basePayload, name: "Tulsa Creator", email: "launch-e@fixtures.dev", handle: "tulsaeats", market: "Not listed yet", customCity: "Tulsa", customCountry: "United States", customState: "ok" });
  check("unlisted creator (Tulsa, United States) registers with a full profile", regE.status === 201, JSON.stringify(regE.data));
  check("unlisted sign-up stores typed city + country, state optional and normalized", regE.data.user.market === "Not listed yet" && regE.data.user.city === "Tulsa" && regE.data.user.country === "United States" && regE.data.user.state === "OK", JSON.stringify([regE.data.user.market, regE.data.user.city, regE.data.user.country, regE.data.user.state]));
  check("unlisted founder gets the per-city first-100 band", regE.data.user.founding && regE.data.user.founding.queueBand === 100 && regE.data.user.founding.unlisted === true && regE.data.user.founding.marketLive === false, JSON.stringify(regE.data.user.founding));
  const regG = await client()("POST", "/api/auth/register", { ...basePayload, name: "Tulsa Two", email: "launch-g@fixtures.dev", handle: "tulsatwo", market: "Not listed yet", customCity: "Tulsa", customCountry: "United States" });
  check("second Tulsa sign-up registers (same city pool, no state needed)", regG.status === 201, JSON.stringify(regG.data));
  const regF = await client()("POST", "/api/auth/register", { ...basePayload, name: "Toronto Creator", email: "launch-f@fixtures.dev", handle: "torontoeats", market: "Not listed yet", customCity: "Toronto", customCountry: "Canada" });
  check("Toronto sign-up registers in its own city + country pool", regF.status === 201 && regF.data.user.founding.queueBand === 100 && regF.data.user.country === "Canada", JSON.stringify(regF.data.user && regF.data.user.founding));
  const patchE = await creatorE("PATCH", "/api/me/profile", { city: "Broken Arrow", country: "United States", state: "OK" });
  check("unlisted creator can correct their typed city and country", patchE.status === 200 && patchE.data.user.city === "Broken Arrow" && patchE.data.user.country === "United States", JSON.stringify(patchE.data.user && [patchE.data.user.city, patchE.data.user.country]));
  await creatorE("PATCH", "/api/me/profile", { city: "Tulsa" });
  const approveE = await admin("POST", "/api/admin/review", { userId: regE.data.user.id, decision: "approve" });
  check("admin approves the unlisted creator", approveE.status === 200 && approveE.data.user.status === "approved");
  const foundingE = await creatorE("GET", "/api/me/founding");
  check("unlisted founding status: city + country shown, market not live, banded standing", foundingE.status === 200 && foundingE.data.founding.unlisted === true && foundingE.data.founding.city === "Tulsa" && foundingE.data.founding.country === "United States" && foundingE.data.founding.marketLive === false && foundingE.data.founding.priorityBand === 100, JSON.stringify(foundingE.data.founding));
  const statsNow = await admin("GET", "/api/admin/stats");
  const tulsaRow = (statsNow.data.unlistedByCity || []).find((r) => r.place === "Tulsa, United States");
  const torontoRow = (statsNow.data.unlistedByCity || []).find((r) => r.place === "Toronto, Canada");
  check("admin stats count unlisted sign-ups per city + country (Tulsa 2, Toronto 1)", !!tulsaRow && tulsaRow.creators === 2 && tulsaRow.country === "United States" && !!torontoRow && torontoRow.creators === 1 && torontoRow.country === "Canada", JSON.stringify(statsNow.data.unlistedByCity));

  // client wiring for the new UI: bottom nav, paid option, terms consent
  check("client ships the mobile bottom nav", appJs.text.includes("bottomnav") && appJs.text.includes("renderBottomNav"));
  check("client gates the paid campaigns option to the Headliners tier", appJs.text.includes("jc-paid-wrap") && appJs.text.includes("PAID_COMP"));
  check("client collects the Terms + email consent at sign-up", appJs.text.includes("jc-agree-terms"));
  check("client never renders an exact queue number to creators (admin keeps exact numbers)", !appJs.text.includes("in the ${esc(u.market)} founding queue") && !appJs.text.includes("Founding priority #${f.priorityPosition}") && !appJs.text.includes("#${f.queuePosition}"));

  // --- Momentum: referral points computed from stored sign-ups only ---
  const recruiter = client();
  const regR = await recruiter("POST", "/api/auth/register", { ...basePayload, name: "Recruiter One", email: "launch-r@fixtures.dev", handle: "recruiterone" });
  check("recruiter creator registers", regR.status === 201, JSON.stringify(regR.data));
  // Fresh-creator Momentum under the expanded rules: no referrals
  // yet, but registration itself reports a local audience % (+5).
  // Bio, photo, neighborhood, and stack are all empty in basePayload.
  check("a fresh creator starts with referral Momentum at zero (5 pts = local % reported at sign-up)", !!regR.data.user.momentum && regR.data.user.momentum.signups === 0 && regR.data.user.momentum.approved === 0 && regR.data.user.momentum.points === 5, JSON.stringify(regR.data.user.momentum));
  const recruit1 = await client()("POST", "/api/auth/register", { ...basePayload, name: "Recruit One", email: "launch-r1@fixtures.dev", handle: "recruitone", referredBy: "recruiterone" });
  const recruit2 = await client()("POST", "/api/auth/register", { ...basePayload, name: "Recruit Two", email: "launch-r2@fixtures.dev", handle: "recruittwo", referredBy: "recruiterone" });
  check("two creators sign up through the recruiter's invite link", recruit1.status === 201 && recruit2.status === 201, JSON.stringify([recruit1.status, recruit2.status]));
  const meBefore = await recruiter("GET", "/api/auth/me");
  check("Momentum before approvals: 2 sign-ups credited = 6 referral points (11 total with the +5 local %)", !!meBefore.data.user.momentum && meBefore.data.user.momentum.signups === 2 && meBefore.data.user.momentum.approved === 0 && meBefore.data.user.momentum.points === 11, JSON.stringify(meBefore.data.user.momentum));
  await admin("POST", "/api/admin/review", { userId: recruit1.data.user.id, decision: "approve" });
  const meAfter = await recruiter("GET", "/api/auth/me");
  check("Momentum math: 2 sign-ups + 1 approved = 16 referral points (21 total)", !!meAfter.data.user.momentum && meAfter.data.user.momentum.signups === 2 && meAfter.data.user.momentum.approved === 1 && meAfter.data.user.momentum.points === 21, JSON.stringify(meAfter.data.user.momentum));
  check("Momentum detail carries the ledger and the ways-to-earn checklist", Array.isArray(meAfter.data.user.momentum.ledger) && meAfter.data.user.momentum.ledger.reduce((s, e) => s + e.points, 0) === 21 && Array.isArray(meAfter.data.user.momentum.checklist) && meAfter.data.user.momentum.checklist.some((i) => i.id === "photo" && i.done === false), JSON.stringify(meAfter.data.user.momentum.checklist && meAfter.data.user.momentum.checklist.length));
  const board = await admin("GET", "/api/admin/leaderboard");
  const boardRow = (board.data.leaderboard || []).find((r) => r.handle === "recruiterone");
  check("admin leaderboard ranks the recruiter first with 21 points", !!boardRow && boardRow.market === "Hampton Roads" && boardRow.signups === 2 && boardRow.approved === 1 && boardRow.points === 21 && board.data.leaderboard[0].handle === "recruiterone", JSON.stringify(board.data.leaderboard));
  const appsNow = await admin("GET", "/api/admin/applications");
  const pendingR = (appsNow.data.pending || []).find((u) => u.id === regR.data.user.id);
  check("admin applications payload carries the recruiter's Momentum", !!pendingR && !!pendingR.momentum && pendingR.momentum.points === 21, JSON.stringify(pendingR && pendingR.momentum));
  // Email copy is server-side only (bodies are never stored), so assert
  // the shipped strings in the router source, the same way the suite
  // asserts client copy in app.js.
  const routerSrc = fs.readFileSync(new URL("../netlify/functions/lib/router.js", import.meta.url), "utf8");
  check("sign-up and approval emails state the recruiting benefits (points + visibility)", routerSrc.includes("+3 when a creator joins through your link") && routerSrc.includes("+10 when they are approved") && routerSrc.includes("roster standing is part of the order they see"));
  check("recruiter kit email is wired: subject, hosted badge, one-time flag", routerSrc.includes("Your Founding Creator badge is ready") && routerSrc.includes("https://joinsignl.com/assets/badges/signl-founding-creator-badge-square.png") && routerSrc.includes("recruiterKitEmailV1Sent"));

  // --- dataset: the new steps are all events ---
  const events = await admin("GET", "/api/admin/events?limit=500");
  const byType = (t) => (events.data.events || []).filter((e) => e.type === t);
  check("event: profile_completed logged", byType("profile_completed").length >= 2, String(byType("profile_completed").length));
  const pcEvent = byType("profile_completed").find((e) => e.subjectId === creatorAId);
  check("profile_completed carries the social links", !!pcEvent && pcEvent.data.facebookUrl === "https://www.facebook.com/launcheatspage" && pcEvent.data.xUrl === "https://x.com/launcheats" && pcEvent.data.linkedinUrl === "https://www.linkedin.com/in/launcheats", JSON.stringify(pcEvent && pcEvent.data));
  check("event: profile_photo_uploaded logged", byType("profile_photo_uploaded").length >= 1);
  check("event: founding_status_viewed logged", byType("founding_status_viewed").length >= 1);
  check("event: market_activated logged for Hampton Roads", byType("market_activated").some((e) => e.market === "Hampton Roads"));
  check("event: sign-up confirmation email queued for every creator registration", byType("signup_confirmation_email_queued").length >= 4, String(byType("signup_confirmation_email_queued").length));
  check("event: approval email queued on each creator approval", byType("approval_email_queued").length >= 3, String(byType("approval_email_queued").length));
  const appSubE = byType("application_submitted").find((e) => e.subjectId === regE.data.user.id);
  check("application_submitted records the unlisted city demand (city, country, state, unlisted flag)", !!appSubE && appSubE.data.unlisted === true && appSubE.data.city === "Tulsa" && appSubE.data.country === "United States" && appSubE.data.state === "OK", JSON.stringify(appSubE && appSubE.data));
  check("client offers the not-listed path in sign-up", appJs.text.includes("jc-custom-wrap") && appJs.text.includes("My city is not listed yet") && appJs.text.includes("unlistedByCity"));
  check("client groups the market picker by country with a search filter", appJs.text.includes("optgroup") && appJs.text.includes("jc-market-search") && appJs.text.includes("filterMarketOptions"), "");
  check("client collects city + country on the not-listed path", appJs.text.includes("jc-country-text") && appJs.text.includes("customCountry") && appJs.text.includes("p-country-text"), "");
  check("event: with no SMTP transport, emails are recorded not_sent (never faked as sent)", byType("signup_confirmation_email_sent").length === 0 && byType("approval_email_not_sent").some((e) => e.data && e.data.reason === "transport_not_configured"), JSON.stringify(byType("approval_email_not_sent").map((e) => e.data && e.data.reason)));
  check("event: recruiter kit trigger ran exactly once, at the first request, when no approved creators existed yet", byType("recruiter_kit_email_run").length === 1 && byType("recruiter_kit_email_run")[0].data.recipients === 0, JSON.stringify(byType("recruiter_kit_email_run").map((e) => e.data)));
  check("client shows roster counts, Momentum points, and the visibility line in Grow your roster", appJs.text.includes("Momentum points") && appJs.text.includes("Creators who build a roster get seen first when businesses start choosing in your market. Points: +3 when a creator joins through your link, +10 when they are approved.") && appJs.text.includes("/admin/leaderboard"));
  const pcEvC = byType("profile_completed").find((e) => e.subjectId === regC.data.user.id);
  check("profile_completed records the paid campaigns opt-in and terms version", !!pcEvC && pcEvC.data.openToPaidCampaigns === true && pcEvC.data.termsVersion === boot.data.termsVersion && pcEvC.data.marketingEmailConsent === true, JSON.stringify(pcEvC && pcEvC.data));
} finally {
  server.kill("SIGTERM");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nLaunch verification: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("Failures: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
