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
  check("bootstrap lists 11 markets", boot.data.markets && boot.data.markets.length === 11);
  check("bootstrap: creator sign-up open, business sign-up closed", boot.data.launch && boot.data.launch.creatorSignupOpen === true && boot.data.launch.businessSignupOpen === false, JSON.stringify(boot.data.launch));
  check("bootstrap: every market starts not live", boot.data.launch && Object.values(boot.data.launch.marketLive).every((v) => v === false));
  check("bootstrap: launch window is 60 to 90 days", boot.data.launch && boot.data.launch.launchWindow === "60 to 90 days");
  check("creator categories are the launch set", Array.isArray(boot.data.creatorCategories) && boot.data.creatorCategories.includes("Beauty & Grooming") && boot.data.creatorCategories.includes("Food & Drink") && !boot.data.creatorCategories.includes("Lifestyle"));
  check("comp categories published", Array.isArray(boot.data.compCategories) && boot.data.compCategories.includes("Restaurant meals"));
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
  check("launch window on the founding page is 60 to 90 days", f.launchWindow === "60 to 90 days");
  check("founding card carries the computed Local Impact Score", typeof card.localImpactScore === "number", String(card.localImpactScore));
  check("founding card shows the photo URL", typeof card.photoUrl === "string" && card.photoUrl.endsWith("/photo"), String(card.photoUrl));
  check("founding card displays all six socials", card.profile.instagramUrl === "https://instagram.com/launcheats" && card.profile.tiktokUrl === "https://www.tiktok.com/@launcheats" && card.profile.youtubeChannel === "Launch Eats TV" && card.profile.facebookUrl === "https://www.facebook.com/launcheatspage" && card.profile.xUrl === "https://x.com/launcheats" && card.profile.linkedinUrl === "https://www.linkedin.com/in/launcheats");
  check("founding card carries the first-100 band, not an exact priority number", card.foundingBand === 100 && card.foundingPriority === undefined, String(card.foundingBand));

  // the client actually renders those links (display wiring in app.js)
  const appJs = await anon.raw("/app.js");
  check("client renders Facebook, X, and LinkedIn links on profiles", appJs.text.includes("Facebook") && appJs.text.includes("LinkedIn") && appJs.text.includes('>X</a>'));

  // --- marketplace stays closed in a not-live market ---
  const gatedOffers = await creatorA("GET", "/api/offers");
  check("offers are gated before market launch (403)", gatedOffers.status === 403, String(gatedOffers.status));
  const gatedDiscover = await creatorA("GET", "/api/discover?market=Hampton%20Roads");
  check("discovery is gated before market launch (403)", gatedDiscover.status === 403, String(gatedDiscover.status));
  check("gate message names the launch window", /60 to 90 days/.test((gatedOffers.data && gatedOffers.data.error) || ""), gatedOffers.data && gatedOffers.data.error);

  // --- second founding creator: priority follows sign-up order ---
  const creatorB = client();
  const regB = await creatorB("POST", "/api/auth/register", { ...basePayload, name: "Second Creator", email: "launch-b@example.com", handle: "secondeats", city: "Virginia Beach" });
  check("second creator registers", regB.status === 201, JSON.stringify(regB.data));
  await admin("POST", "/api/admin/review", { userId: regB.data.user.id, decision: "approve" });
  const foundingB = await creatorB("GET", "/api/me/founding");
  check("second approved creator also lands in the first-100 band (exact order stays internal)", foundingB.data.founding && foundingB.data.founding.priorityBand === 100 && foundingB.data.founding.priorityPosition === undefined, JSON.stringify(foundingB.data.founding));
  const foundingA2 = await creatorA("GET", "/api/me/founding");
  check("first creator keeps the first-100 band and never sees market signup counts", foundingA2.data.founding.priorityBand === 100 && foundingA2.data.founding.foundingCreatorsInMarket === undefined && foundingA2.data.founding.creatorsInMarket === undefined);

  // another creator cannot view creator A's photo (businesses/admin/self only)
  const crossPhoto = await creatorB.raw(`/api/users/${creatorAId}/photo`);
  check("a different creator cannot fetch the photo (403)", crossPhoto.status === 403, String(crossPhoto.status));

  // --- admin market controls, then activation opens the gate ---
  const markets = await admin("GET", "/api/admin/markets");
  const hr = (markets.data.markets || []).find((m) => m.name === "Hampton Roads");
  check("admin markets list: 11 markets, Hampton Roads founding-only with 2 approved creators", (markets.data.markets || []).length === 11 && !!hr && hr.live === false && hr.creatorsApproved === 2, JSON.stringify(hr));
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

  // --- city not listed: anyone can sign up, counted per city ---
  check("bootstrap names the unlisted pseudo-market", boot.data.unlistedMarket === "Not listed yet");
  const noState = await client()("POST", "/api/auth/register", { ...basePayload, email: "x6@example.com", market: "Not listed yet", customCity: "Austin" });
  check("unlisted sign-up without a state is refused (400)", noState.status === 400, String(noState.status));
  const creatorE = client();
  const regE = await creatorE("POST", "/api/auth/register", { ...basePayload, name: "Austin Creator", email: "launch-e@example.com", handle: "austineats", market: "Not listed yet", customCity: "Austin", customState: "tx" });
  check("unlisted creator (Austin, TX) registers with a full profile", regE.status === 201, JSON.stringify(regE.data));
  check("unlisted sign-up stores typed city + normalized state", regE.data.user.market === "Not listed yet" && regE.data.user.city === "Austin" && regE.data.user.state === "TX", JSON.stringify([regE.data.user.market, regE.data.user.city, regE.data.user.state]));
  check("unlisted founder gets the per-city first-100 band", regE.data.user.founding && regE.data.user.founding.queueBand === 100 && regE.data.user.founding.unlisted === true && regE.data.user.founding.marketLive === false, JSON.stringify(regE.data.user.founding));
  const regG = await client()("POST", "/api/auth/register", { ...basePayload, name: "Austin Two", email: "launch-g@example.com", handle: "austintwo", market: "Not listed yet", customCity: "Austin", customState: "TX" });
  check("second Austin sign-up registers (same city pool)", regG.status === 201, JSON.stringify(regG.data));
  const regF = await client()("POST", "/api/auth/register", { ...basePayload, name: "Dallas Creator", email: "launch-f@example.com", handle: "dallaseats", market: "Not listed yet", customCity: "Dallas", customState: "TX" });
  check("Dallas sign-up registers in its own city pool", regF.status === 201 && regF.data.user.founding.queueBand === 100, JSON.stringify(regF.data.user && regF.data.user.founding));
  const patchE = await creatorE("PATCH", "/api/me/profile", { city: "Round Rock", state: "TX" });
  check("unlisted creator can correct their typed city", patchE.status === 200 && patchE.data.user.city === "Round Rock", JSON.stringify(patchE.data.user && patchE.data.user.city));
  await creatorE("PATCH", "/api/me/profile", { city: "Austin" });
  const approveE = await admin("POST", "/api/admin/review", { userId: regE.data.user.id, decision: "approve" });
  check("admin approves the unlisted creator", approveE.status === 200 && approveE.data.user.status === "approved");
  const foundingE = await creatorE("GET", "/api/me/founding");
  check("unlisted founding status: city shown, market not live, banded standing", foundingE.status === 200 && foundingE.data.founding.unlisted === true && foundingE.data.founding.city === "Austin" && foundingE.data.founding.marketLive === false && foundingE.data.founding.priorityBand === 100, JSON.stringify(foundingE.data.founding));
  const statsNow = await admin("GET", "/api/admin/stats");
  const austinRow = (statsNow.data.unlistedByCity || []).find((r) => r.place === "Austin, TX");
  const dallasRow = (statsNow.data.unlistedByCity || []).find((r) => r.place === "Dallas, TX");
  check("admin stats count unlisted sign-ups per city (Austin 2, Dallas 1)", !!austinRow && austinRow.creators === 2 && !!dallasRow && dallasRow.creators === 1, JSON.stringify(statsNow.data.unlistedByCity));

  // client wiring for the new UI: bottom nav, paid option, terms consent
  check("client ships the mobile bottom nav", appJs.text.includes("bottomnav") && appJs.text.includes("renderBottomNav"));
  check("client gates the paid campaigns option to the Creators tier", appJs.text.includes("jc-paid-wrap") && appJs.text.includes("PAID_COMP"));
  check("client collects the Terms + email consent at sign-up", appJs.text.includes("jc-agree-terms"));
  check("client never renders an exact queue number to creators (admin keeps exact numbers)", !appJs.text.includes("in the ${esc(u.market)} founding queue") && !appJs.text.includes("Founding priority #${f.priorityPosition}") && !appJs.text.includes("#${f.queuePosition}"));

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
  check("application_submitted records the unlisted city demand (city, state, unlisted flag)", !!appSubE && appSubE.data.unlisted === true && appSubE.data.city === "Austin" && appSubE.data.state === "TX", JSON.stringify(appSubE && appSubE.data));
  check("client offers the not-listed path in sign-up", appJs.text.includes("jc-custom-wrap") && appJs.text.includes("My city is not listed yet") && appJs.text.includes("unlistedByCity"));
  check("event: with no SMTP transport, emails are recorded not_sent (never faked as sent)", byType("signup_confirmation_email_sent").length === 0 && byType("approval_email_not_sent").some((e) => e.data && e.data.reason === "transport_not_configured"), JSON.stringify(byType("approval_email_not_sent").map((e) => e.data && e.data.reason)));
  const pcEvC = byType("profile_completed").find((e) => e.subjectId === regC.data.user.id);
  check("profile_completed records the paid campaigns opt-in and terms version", !!pcEvC && pcEvC.data.openToPaidCampaigns === true && pcEvC.data.termsVersion === boot.data.termsVersion && pcEvC.data.marketingEmailConsent === true, JSON.stringify(pcEvC && pcEvC.data));
} finally {
  server.kill("SIGTERM");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nLaunch verification: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("Failures: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
