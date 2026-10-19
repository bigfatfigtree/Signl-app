// Launch-shape verification (Jeff's 2026-10-18 launch decision).
// This suite runs WITHOUT the test override, exactly like production:
//   - creator founding sign-up is the only public account type
//   - business registration is refused (founding list on joinsignl.com)
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
  check("bootstrap: creator sign-up open, business sign-up closed", boot.data.launch && boot.data.launch.creatorSignupOpen === true && boot.data.launch.businessSignupOpen === false, JSON.stringify(boot.data.launch));
  check("bootstrap: every market starts not live", boot.data.launch && Object.values(boot.data.launch.marketLive).every((v) => v === false));
  check("bootstrap: launch window is 30 to 90 days", boot.data.launch && boot.data.launch.launchWindow === "30 to 90 days");
  check("creator categories are the launch set", Array.isArray(boot.data.creatorCategories) && boot.data.creatorCategories.includes("Beauty & Grooming") && boot.data.creatorCategories.includes("Food & Drink") && !boot.data.creatorCategories.includes("Lifestyle"));
  check("comp categories published", Array.isArray(boot.data.compCategories) && boot.data.compCategories.includes("Restaurant meals"));
  check("health and wellness is a creator category and a comp category", boot.data.creatorCategories.includes("Health & Wellness") && boot.data.compCategories.includes("Health & wellness services"), JSON.stringify([boot.data.creatorCategories, boot.data.compCategories]));
  check("bootstrap names the Creators-tier paid campaigns option", boot.data.paidCampaignsComp === "Paid cash campaigns");
  check("bootstrap reports email transport off locally (queued, never faked)", boot.data.email && boot.data.email.enabled === false);

  // --- registration validation (profile builder enforces its fields) ---
  const basePayload = {
    role: "creator", name: "Launch Creator", email: "launch-a@example.com", password: "creator-pass-123",
    market: "Hampton Roads", city: "Norfolk", handle: "launcheats", followerCount: 8400,
    localAudiencePct: 62, categories: ["Food & Drink"], agreedHonestPosts: true, agreedFtcDisclosure: true, agreedTerms: true,
  };
  const noPct = await client()("POST", "/api/auth/register", { ...basePayload, email: "x1@example.com", localAudiencePct: undefined });
  check("registration without local audience % is refused (400)", noPct.status === 400, String(noPct.status));
  const noAgree = await client()("POST", "/api/auth/register", { ...basePayload, email: "x2@example.com", agreedFtcDisclosure: false });
  check("registration without the FTC agreement is refused (400)", noAgree.status === 400, String(noAgree.status));
  const noTerms = await client()("POST", "/api/auth/register", { ...basePayload, email: "x5@example.com", agreedTerms: false });
  check("registration without the Terms + email consent is refused (400)", noTerms.status === 400, String(noTerms.status));
  const badCity = await client()("POST", "/api/auth/register", { ...basePayload, email: "x3@example.com", city: "Richmond" });
  check("home city outside the chosen market is refused (400)", badCity.status === 400, String(badCity.status));
  const noCats = await client()("POST", "/api/auth/register", { ...basePayload, email: "x4@example.com", categories: [] });
  check("registration with no content category is refused (400)", noCats.status === 400, String(noCats.status));

  // --- business registration is closed at launch ---
  const bizAttempt = await client()("POST", "/api/auth/register", {
    role: "business", name: "Hopeful Owner", businessName: "Hopeful Table", email: "hopeful@example.com",
    password: "business-pass-123", market: "Hampton Roads", city: "Norfolk", category: "Restaurant", planId: "managed",
  });
  check("business registration is refused (403)", bizAttempt.status === 403, String(bizAttempt.status));
  check("refusal points at the founding business list and founding pricing", /joinsignl\.com\/businesses\.html/.test(bizAttempt.data.error || "") && /\$299/.test(bizAttempt.data.error || ""), bizAttempt.data.error);

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
  check("public profile leaks no email, password material, or internal fields", !pubRaw.text.includes("launch-a@example.com") && !pubRaw.text.includes("passwordHash") && !pubRaw.text.includes("passwordSalt") && !pubRaw.text.includes("reviewedBy") && !pubRaw.text.includes("referredBy") && !pubRaw.text.includes("agreedTerms"), pubRaw.text.slice(0, 200));
  const pub = (JSON.parse(pubRaw.text) || {}).profile || {};
  check("public profile carries the public-safe fields", pub.name === "Launch Creator" && pub.handle === "launcheats" && pub.market === "Hampton Roads" && pub.city === "Norfolk" && pub.neighborhood === "Ghent" && pub.tierBand === "Locals" && pub.followerCount === 8400, JSON.stringify(pub));
  check("public profile shows local audience % with its source label", pub.localAudiencePct === 62 && pub.localAudienceSource === "Self-reported", JSON.stringify([pub.localAudiencePct, pub.localAudienceSource]));
  check("public profile carries categories and comp categories", Array.isArray(pub.categories) && pub.categories.includes("Food & Drink") && Array.isArray(pub.compCategories) && pub.compCategories.includes("Restaurant meals"), JSON.stringify([pub.categories, pub.compCategories]));
  check("public profile carries Local Impact Score and Momentum points", typeof pub.localImpactScore === "number" && pub.momentumPoints === 0, JSON.stringify([pub.localImpactScore, pub.momentumPoints]));
  check("public profile shows the founding standing band, never an exact position", pub.foundingBand === 100 && pub.foundingPriority === undefined && pub.priorityPosition === undefined, JSON.stringify(pub.foundingBand));
  const pubCase = await anon("GET", "/api/c/LaunchEats");
  check("public profile handle lookup is case-insensitive", pubCase.status === 200 && !!pubCase.data.profile && pubCase.data.profile.handle === "launcheats", String(pubCase.status));
  const pubUnknown = await anon("GET", "/api/c/nosuchcreator");
  check("public profile for an unknown handle is 404", pubUnknown.status === 404, String(pubUnknown.status));
  const pubDirty = await anon("GET", "/api/c/%3Cscript%3E");
  check("public profile sanitizes markup in the handle and 404s", pubDirty.status === 404, String(pubDirty.status));
  const creatorP = client();
  const regP = await creatorP("POST", "/api/auth/register", { ...basePayload, name: "Pending Creator", email: "launch-p@example.com", handle: "pendingplates" });
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
  check("public profile with photo + best work + track record still leaks no email or internal fields", !pubRichRaw.text.includes("launch-a@example.com") && !pubRichRaw.text.includes("passwordHash") && !pubRichRaw.text.includes("passwordSalt") && !pubRichRaw.text.includes("reviewedBy") && !pubRichRaw.text.includes("referredBy") && !pubRichRaw.text.includes("agreedTerms"), pubRichRaw.text.slice(0, 160));
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
  const regB = await creatorB("POST", "/api/auth/register", { ...basePayload, name: "Second Creator", email: "launch-b@example.com", handle: "secondeats", city: "Virginia Beach" });
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
  const bizAfter = await client()("POST", "/api/auth/register", {
    role: "business", name: "Late Owner", businessName: "Late Table", email: "late@example.com",
    password: "business-pass-123", market: "Hampton Roads", city: "Norfolk", category: "Restaurant", planId: "managed",
  });
  check("business registration stays closed even in a live market (403): role gate is separate", bizAfter.status === 403, String(bizAfter.status));

  // --- paid cash campaigns: a Creators-tier option only ---
  const creatorC = client();
  const regC = await creatorC("POST", "/api/auth/register", {
    ...basePayload, name: "Big Creator", email: "launch-c@example.com", handle: "bigcreator",
    followerCount: 42000, tierBand: "Creators", compCategories: ["Restaurant meals", "Paid cash campaigns"],
  });
  check("Creators-tier registration with paid campaigns selected returns 201", regC.status === 201, JSON.stringify(regC.data));
  check("paid campaigns stored for the Creators-tier creator", regC.data.user.creator.openToPaidCampaigns === true && regC.data.user.creator.compCategories.includes("Paid cash campaigns"), JSON.stringify(regC.data.user.creator.compCategories));
  const creatorD = client();
  const regD = await creatorD("POST", "/api/auth/register", {
    ...basePayload, name: "Local Creator", email: "launch-d@example.com", handle: "localcreator",
    followerCount: 8400, tierBand: "Locals", compCategories: ["Restaurant meals", "Paid cash campaigns"],
  });
  check("Locals-tier attempt at paid campaigns is stripped server-side", regD.status === 201 && regD.data.user.creator.openToPaidCampaigns === false && !regD.data.user.creator.compCategories.includes("Paid cash campaigns"), JSON.stringify(regD.data.user.creator.compCategories));
  const patchPaidOff = await creatorC("PATCH", "/api/me/profile", { compCategories: ["Restaurant meals"] });
  check("profile update can drop the paid campaigns option", patchPaidOff.status === 200 && patchPaidOff.data.user.creator.openToPaidCampaigns === false, JSON.stringify(patchPaidOff.data));
  const patchTierDrop = await creatorC("PATCH", "/api/me/profile", { tierBand: "Locals", compCategories: ["Restaurant meals", "Paid cash campaigns"] });
  check("dropping out of the Creators tier removes the paid option", patchTierDrop.status === 200 && patchTierDrop.data.user.creator.openToPaidCampaigns === false && !patchTierDrop.data.user.creator.compCategories.includes("Paid cash campaigns"), JSON.stringify(patchTierDrop.data));
  const approveC = await admin("POST", "/api/admin/review", { userId: regC.data.user.id, decision: "approve" });
  check("admin approves the Creators-tier creator", approveC.status === 200 && approveC.data.user.status === "approved");

  // --- Dubai is a core market: picked, never typed in ---
  const dubaiCreator = client();
  const regDubai = await dubaiCreator("POST", "/api/auth/register", { ...basePayload, name: "Dubai Creator", email: "launch-dubai@example.com", handle: "dubaieats", market: "Dubai", city: "Dubai" });
  check("Dubai is selectable as a core market at sign-up (201)", regDubai.status === 201, JSON.stringify(regDubai.data));
  check("Dubai sign-up stores the market and its country, founding-only", regDubai.data.user.market === "Dubai" && regDubai.data.user.country === "United Arab Emirates" && regDubai.data.user.founding.marketLive === false && regDubai.data.user.founding.unlisted === false, JSON.stringify([regDubai.data.user.market, regDubai.data.user.country, regDubai.data.user.founding]));
  const londonAttempt = await client()("POST", "/api/auth/register", { ...basePayload, email: "x7@example.com", handle: "londonwrong", market: "London", city: "Dubai" });
  check("a city outside the picked market is still refused (London market, Dubai city, 400)", londonAttempt.status === 400, String(londonAttempt.status));
  const regSingapore = await client()("POST", "/api/auth/register", { ...basePayload, name: "Singapore Creator", email: "launch-sg@example.com", handle: "singaporeeats", market: "Singapore", city: "Singapore" });
  check("Singapore (Bella list) is selectable as a core market at sign-up", regSingapore.status === 201 && regSingapore.data.user.market === "Singapore" && regSingapore.data.user.country === "Singapore" && regSingapore.data.user.founding.marketLive === false, JSON.stringify(regSingapore.data.user && [regSingapore.data.user.market, regSingapore.data.user.country]));

  // --- city not listed: anyone can sign up, counted per city ---
  check("bootstrap names the unlisted pseudo-market", boot.data.unlistedMarket === "Not listed yet");
  const noCountry = await client()("POST", "/api/auth/register", { ...basePayload, email: "x6@example.com", market: "Not listed yet", customCity: "Tulsa", customState: "OK" });
  check("unlisted sign-up without a country is refused (400)", noCountry.status === 400, String(noCountry.status));
  const creatorE = client();
  const regE = await creatorE("POST", "/api/auth/register", { ...basePayload, name: "Tulsa Creator", email: "launch-e@example.com", handle: "tulsaeats", market: "Not listed yet", customCity: "Tulsa", customCountry: "United States", customState: "ok" });
  check("unlisted creator (Tulsa, United States) registers with a full profile", regE.status === 201, JSON.stringify(regE.data));
  check("unlisted sign-up stores typed city + country, state optional and normalized", regE.data.user.market === "Not listed yet" && regE.data.user.city === "Tulsa" && regE.data.user.country === "United States" && regE.data.user.state === "OK", JSON.stringify([regE.data.user.market, regE.data.user.city, regE.data.user.country, regE.data.user.state]));
  check("unlisted founder gets the per-city first-100 band", regE.data.user.founding && regE.data.user.founding.queueBand === 100 && regE.data.user.founding.unlisted === true && regE.data.user.founding.marketLive === false, JSON.stringify(regE.data.user.founding));
  const regG = await client()("POST", "/api/auth/register", { ...basePayload, name: "Tulsa Two", email: "launch-g@example.com", handle: "tulsatwo", market: "Not listed yet", customCity: "Tulsa", customCountry: "United States" });
  check("second Tulsa sign-up registers (same city pool, no state needed)", regG.status === 201, JSON.stringify(regG.data));
  const regF = await client()("POST", "/api/auth/register", { ...basePayload, name: "Toronto Creator", email: "launch-f@example.com", handle: "torontoeats", market: "Not listed yet", customCity: "Toronto", customCountry: "Canada" });
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
  check("client gates the paid campaigns option to the Creators tier", appJs.text.includes("jc-paid-wrap") && appJs.text.includes("PAID_COMP"));
  check("client collects the Terms + email consent at sign-up", appJs.text.includes("jc-agree-terms"));
  check("client never renders an exact queue number to creators (admin keeps exact numbers)", !appJs.text.includes("in the ${esc(u.market)} founding queue") && !appJs.text.includes("Founding priority #${f.priorityPosition}") && !appJs.text.includes("#${f.queuePosition}"));

  // --- Momentum: referral points computed from stored sign-ups only ---
  const recruiter = client();
  const regR = await recruiter("POST", "/api/auth/register", { ...basePayload, name: "Recruiter One", email: "launch-r@example.com", handle: "recruiterone" });
  check("recruiter creator registers", regR.status === 201, JSON.stringify(regR.data));
  check("a fresh creator starts at zero Momentum", !!regR.data.user.momentum && regR.data.user.momentum.signups === 0 && regR.data.user.momentum.approved === 0 && regR.data.user.momentum.points === 0, JSON.stringify(regR.data.user.momentum));
  const recruit1 = await client()("POST", "/api/auth/register", { ...basePayload, name: "Recruit One", email: "launch-r1@example.com", handle: "recruitone", referredBy: "recruiterone" });
  const recruit2 = await client()("POST", "/api/auth/register", { ...basePayload, name: "Recruit Two", email: "launch-r2@example.com", handle: "recruittwo", referredBy: "recruiterone" });
  check("two creators sign up through the recruiter's invite link", recruit1.status === 201 && recruit2.status === 201, JSON.stringify([recruit1.status, recruit2.status]));
  const meBefore = await recruiter("GET", "/api/auth/me");
  check("Momentum before approvals: 2 sign-ups credited = 6 points", !!meBefore.data.user.momentum && meBefore.data.user.momentum.signups === 2 && meBefore.data.user.momentum.approved === 0 && meBefore.data.user.momentum.points === 6, JSON.stringify(meBefore.data.user.momentum));
  await admin("POST", "/api/admin/review", { userId: recruit1.data.user.id, decision: "approve" });
  const meAfter = await recruiter("GET", "/api/auth/me");
  check("Momentum math: 2 sign-ups + 1 approved = 16 points", !!meAfter.data.user.momentum && meAfter.data.user.momentum.signups === 2 && meAfter.data.user.momentum.approved === 1 && meAfter.data.user.momentum.points === 16, JSON.stringify(meAfter.data.user.momentum));
  const board = await admin("GET", "/api/admin/leaderboard");
  const boardRow = (board.data.leaderboard || []).find((r) => r.handle === "recruiterone");
  check("admin leaderboard ranks the recruiter first with 16 points", !!boardRow && boardRow.market === "Hampton Roads" && boardRow.signups === 2 && boardRow.approved === 1 && boardRow.points === 16 && board.data.leaderboard[0].handle === "recruiterone", JSON.stringify(board.data.leaderboard));
  const appsNow = await admin("GET", "/api/admin/applications");
  const pendingR = (appsNow.data.pending || []).find((u) => u.id === regR.data.user.id);
  check("admin applications payload carries the recruiter's Momentum", !!pendingR && !!pendingR.momentum && pendingR.momentum.points === 16, JSON.stringify(pendingR && pendingR.momentum));
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
