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

  // --- registration validation (profile builder enforces its fields) ---
  const basePayload = {
    role: "creator", name: "Launch Creator", email: "launch-a@example.com", password: "creator-pass-123",
    market: "Hampton Roads", city: "Norfolk", handle: "launcheats", followerCount: 8400,
    localAudiencePct: 62, categories: ["Food & Drink"], agreedHonestPosts: true, agreedFtcDisclosure: true,
  };
  const noPct = await client()("POST", "/api/auth/register", { ...basePayload, email: "x1@example.com", localAudiencePct: undefined });
  check("registration without local audience % is refused (400)", noPct.status === 400, String(noPct.status));
  const noAgree = await client()("POST", "/api/auth/register", { ...basePayload, email: "x2@example.com", agreedFtcDisclosure: false });
  check("registration without the FTC agreement is refused (400)", noAgree.status === 400, String(noAgree.status));
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
  check("registration response carries founding queue position 1", regA.data.user.founding && regA.data.user.founding.queuePosition === 1 && regA.data.user.founding.marketLive === false, JSON.stringify(regA.data.user.founding));

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
  check("founding priority position is 1", f.priorityPosition === 1, String(f.priorityPosition));
  check("launch window on the founding page is 60 to 90 days", f.launchWindow === "60 to 90 days");
  check("founding card carries the computed Local Impact Score", typeof card.localImpactScore === "number", String(card.localImpactScore));
  check("founding card shows the photo URL", typeof card.photoUrl === "string" && card.photoUrl.endsWith("/photo"), String(card.photoUrl));
  check("founding card displays all six socials", card.profile.instagramUrl === "https://instagram.com/launcheats" && card.profile.tiktokUrl === "https://www.tiktok.com/@launcheats" && card.profile.youtubeChannel === "Launch Eats TV" && card.profile.facebookUrl === "https://www.facebook.com/launcheatspage" && card.profile.xUrl === "https://x.com/launcheats" && card.profile.linkedinUrl === "https://www.linkedin.com/in/launcheats");
  check("founding card carries foundingPriority 1", card.foundingPriority === 1);

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
  check("second approved creator holds founding priority 2", foundingB.data.founding && foundingB.data.founding.priorityPosition === 2, JSON.stringify(foundingB.data.founding));
  const foundingA2 = await creatorA("GET", "/api/me/founding");
  check("first creator keeps priority 1 and sees 2 founding creators in market", foundingA2.data.founding.priorityPosition === 1 && foundingA2.data.founding.foundingCreatorsInMarket === 2);

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
  check("discovery default sort is founding priority (earliest sign-up first)", (disc.data.creators || []).length === 2 && disc.data.creators[0].userId === creatorAId && disc.data.creators[0].foundingPriority === 1 && disc.data.creators[1].foundingPriority === 2, JSON.stringify((disc.data.creators || []).map((c) => [c.userId === creatorAId, c.foundingPriority])));
  const discScore = await creatorA("GET", "/api/discover?market=Hampton%20Roads&sort=score");
  check("discovery score sort still available (?sort=score)", discScore.status === 200 && (discScore.data.creators || []).length === 2);
  const bizAfter = await client()("POST", "/api/auth/register", {
    role: "business", name: "Late Owner", businessName: "Late Table", email: "late@example.com",
    password: "business-pass-123", market: "Hampton Roads", city: "Norfolk", category: "Restaurant", planId: "managed",
  });
  check("business registration stays closed even in a live market (403): role gate is separate", bizAfter.status === 403, String(bizAfter.status));

  // --- dataset: the new steps are all events ---
  const events = await admin("GET", "/api/admin/events?limit=500");
  const byType = (t) => (events.data.events || []).filter((e) => e.type === t);
  check("event: profile_completed logged", byType("profile_completed").length >= 2, String(byType("profile_completed").length));
  const pcEvent = byType("profile_completed").find((e) => e.subjectId === creatorAId);
  check("profile_completed carries the social links", !!pcEvent && pcEvent.data.facebookUrl === "https://www.facebook.com/launcheatspage" && pcEvent.data.xUrl === "https://x.com/launcheats" && pcEvent.data.linkedinUrl === "https://www.linkedin.com/in/launcheats", JSON.stringify(pcEvent && pcEvent.data));
  check("event: profile_photo_uploaded logged", byType("profile_photo_uploaded").length >= 1);
  check("event: founding_status_viewed logged", byType("founding_status_viewed").length >= 1);
  check("event: market_activated logged for Hampton Roads", byType("market_activated").some((e) => e.market === "Hampton Roads"));
} finally {
  server.kill("SIGTERM");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nLaunch verification: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("Failures: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
