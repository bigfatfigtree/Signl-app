// End-to-end verification of the SIGNL primary-platform picker
// (Jeff, 2026-10-22). Signup used to open with an Instagram handle,
// period. Now both the quick claim and the full form open with
// "Where is your main audience?", the handle is collected for the
// picked platform, Snapchat joins the audience stack (count-only),
// and every surface links the creator's PRIMARY profile. Legacy
// records (no primaryPlatform) must read as Instagram everywhere,
// byte for byte. Spawns the dev server on a throwaway database.
// Run: node scripts/verify-platforms.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizePrimaryPlatform, primaryPlatformOf, primaryProfileOf,
  normalizeAudienceStack, audienceStackOf, audienceTotalOf,
} = require("../netlify/functions/lib/router.js");

const PORT = 8957;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-platforms-${Date.now()}.json`);

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

  // ---------- unit level: platform helpers ----------
  check("normalizePrimaryPlatform keeps a valid slug", normalizePrimaryPlatform("TikTok") === "tiktok");
  check("normalizePrimaryPlatform: Snapchat is NOT a primary platform (count-only)", normalizePrimaryPlatform("snapchat") === "instagram");
  check("normalizePrimaryPlatform: absent/garbage reads as instagram", normalizePrimaryPlatform(undefined) === "instagram" && normalizePrimaryPlatform("myspace") === "instagram");
  check("primaryPlatformOf: legacy record without the field reads instagram", primaryPlatformOf({ handle: "old757", instagramUrl: "https://instagram.com/old757" }) === "instagram");
  const legacyProfile = primaryProfileOf({ handle: "old757", instagramUrl: "https://instagram.com/old757", followerCount: 3000 });
  check("primaryProfileOf: legacy record resolves to its stored instagramUrl, unchanged", legacyProfile.platform === "instagram" && legacyProfile.url === "https://instagram.com/old757" && legacyProfile.label === "Instagram", JSON.stringify(legacyProfile));
  const ytProfile = primaryProfileOf({ handle: "tube757", primaryPlatform: "youtube" });
  check("primaryProfileOf: youtube primary builds youtube.com/@handle", ytProfile.url === "https://www.youtube.com/@tube757", ytProfile.url);
  const xProfile = primaryProfileOf({ handle: "x757", primaryPlatform: "x" });
  check("primaryProfileOf: x primary builds x.com/handle", xProfile.url === "https://x.com/x757", xProfile.url);
  const snapStack = normalizeAudienceStack({ snapchat: 5000, instagram: 100 });
  check("normalizeAudienceStack accepts a snapchat count", snapStack.snapchat === 5000 && snapStack.instagram === 100, JSON.stringify(snapStack));
  check("snapchat count sums into the stacked total", audienceTotalOf({ audienceStack: { snapchat: 16000 } }) === 16000);
  check("audienceStackOf: legacy fallback still treats followerCount as the Instagram count", audienceStackOf({ followerCount: 4200 }).instagram === 4200);

  // ---------- bootstrap carries snapchat in the stack list ----------
  const boot = await client()("GET", "/api/bootstrap");
  check("bootstrap audiencePlatforms include snapchat (count-only)", (boot.data.audiencePlatforms || []).some((p) => p.id === "snapchat"));

  // ---------- quick claim with a TikTok primary ----------
  const tt = client();
  const ttClaim = await tt("POST", "/api/auth/register", {
    role: "creator",
    quickClaim: true,
    email: "ttclaim@fixtures.dev",
    password: "claim-pass-1234",
    market: "Hampton Roads",
    handle: "ttclaim757",
    primaryPlatform: "tiktok",
    ...AGREE,
  });
  check("tiktok quick claim returns 201", ttClaim.status === 201, JSON.stringify(ttClaim.data));
  const ttc = (ttClaim.data.user || {}).creator || {};
  check("tiktok claim stores primaryPlatform + the tiktok profile URL", ttc.primaryPlatform === "tiktok" && ttc.primaryProfileUrl === "https://www.tiktok.com/@ttclaim757", JSON.stringify(ttc));
  check("tiktok claim does NOT fabricate an instagramUrl", !ttc.instagramUrl, JSON.stringify(ttc.instagramUrl));
  check("tiktok claim backfills the tiktok social link from the primary handle", ttc.tiktokHandle === "ttclaim757" && ttc.tiktokUrl === "https://www.tiktok.com/@ttclaim757");
  const ttId = ttClaim.data.user.id;

  // ---------- quick claim defaults: no platform = Instagram ----------
  const ig = client();
  const igClaim = await ig("POST", "/api/auth/register", {
    role: "creator",
    quickClaim: true,
    email: "igclaim@fixtures.dev",
    password: "claim-pass-1234",
    market: "Hampton Roads",
    handle: "igclaim757",
    ...AGREE,
  });
  const igc = (igClaim.data.user || {}).creator || {};
  check("platform-less claim defaults to instagram with the legacy URL shape", igClaim.status === 201 && igc.primaryPlatform === "instagram" && igc.instagramUrl === "https://instagram.com/igclaim757" && igc.primaryProfileUrl === "https://instagram.com/igclaim757", JSON.stringify(igc));

  // ---------- bogus platform value falls back to Instagram ----------
  const bogus = await client()("POST", "/api/auth/register", {
    role: "creator",
    quickClaim: true,
    email: "bogus@fixtures.dev",
    password: "claim-pass-1234",
    market: "Hampton Roads",
    handle: "bogus757",
    primaryPlatform: "snapchat",
    ...AGREE,
  });
  check("a snapchat 'primary' is refused as a primary and reads as instagram", bogus.status === 201 && bogus.data.user.creator.primaryPlatform === "instagram", JSON.stringify(bogus.data.user && bogus.data.user.creator));

  // ---------- full signup: YouTube primary, ZERO Instagram ----------
  const yt = client();
  const ytReg = await yt("POST", "/api/auth/register", {
    role: "creator",
    name: "Tube Creator",
    email: "ytfull@fixtures.dev",
    password: "full-pass-1234",
    market: "Hampton Roads",
    city: "Norfolk",
    handle: "tube757",
    primaryPlatform: "youtube",
    followerCount: 0,
    audienceStack: { youtube: 20000 },
    localAudiencePct: 40,
    categories: ["Food & Drink"],
    ...AGREE,
  });
  check("youtube-primary full signup with 0 Instagram followers passes (201)", ytReg.status === 201, JSON.stringify(ytReg.data));
  const ytc = (ytReg.data.user || {}).creator || {};
  check("youtube signup tiers from the stack (Headliners at 20k YouTube)", ytc.totalAudience === 20000 && ytc.tierBand === "Headliners", JSON.stringify({ total: ytc.totalAudience, tier: ytc.tierBand }));
  check("youtube signup stores primary + URL, no fabricated instagramUrl, stored followerCount stays the IG count (0)", ytc.primaryPlatform === "youtube" && ytc.primaryProfileUrl === "https://www.youtube.com/@tube757" && !ytc.instagramUrl && ytc.followerCount === 0, JSON.stringify(ytc));

  // ---------- full signup: TikTok primary count seeds the stack ----------
  const ttFull = await client()("POST", "/api/auth/register", {
    role: "creator",
    name: "Tok Creator",
    email: "ttfull@fixtures.dev",
    password: "full-pass-1234",
    market: "Hampton Roads",
    city: "Norfolk",
    handle: "tok757",
    primaryPlatform: "tiktok",
    followerCount: 3000,
    localAudiencePct: 55,
    categories: ["Food & Drink"],
    ...AGREE,
  });
  const tfc = (ttFull.data.user || {}).creator || {};
  check("tiktok primary count seeds stack.tiktok and tiers from it (Locals at 3k)", ttFull.status === 201 && tfc.audienceStack && tfc.audienceStack.tiktok === 3000 && tfc.totalAudience === 3000 && tfc.tierBand === "Locals" && tfc.tiktokUrl === "https://www.tiktok.com/@tok757", JSON.stringify(tfc));

  // ---------- full signup: Snapchat stacks and tiers ----------
  const snap = await client()("POST", "/api/auth/register", {
    role: "creator",
    name: "Snap Creator",
    email: "snapfull@fixtures.dev",
    password: "full-pass-1234",
    market: "Hampton Roads",
    city: "Norfolk",
    handle: "snap757",
    followerCount: 1000,
    audienceStack: { instagram: 1000, snapchat: 14500 },
    localAudiencePct: 50,
    categories: ["Food & Drink"],
    ...AGREE,
  });
  const snc = (snap.data.user || {}).creator || {};
  check("snapchat count stacks at signup (1k IG + 14.5k snap = 15.5k, Headliners)", snap.status === 201 && snc.audienceStack && snc.audienceStack.snapchat === 14500 && snc.totalAudience === 15500 && snc.tierBand === "Headliners", JSON.stringify({ stack: snc.audienceStack, total: snc.totalAudience, tier: snc.tierBand }));

  // ---------- admin sees the primary platform beside the handle ----------
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const apps = await admin("GET", "/api/admin/applications");
  const ttRow = (apps.data.pending || []).find((u) => u.id === ttId);
  check("admin queue payload carries the tiktok primary + label (admin only)", !!ttRow && ttRow.creator.primaryPlatform === "tiktok" && ttRow.creator.primaryPlatformLabel === "TikTok", JSON.stringify(ttRow && ttRow.creator));

  // ---------- public /c/: legacy IG creator renders exactly as before ----------
  const legacy = client();
  const legacyReg = await legacy("POST", "/api/auth/register", {
    role: "creator",
    name: "Legacy Creator",
    email: "legacy@fixtures.dev",
    password: "full-pass-1234",
    market: "Hampton Roads",
    city: "Virginia Beach",
    handle: "legacy757",
    followerCount: 8400,
    localAudiencePct: 62,
    categories: ["Food & Drink"],
    ...AGREE,
  });
  const legacyId = legacyReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: legacyId, decision: "approve" });
  const anon = client();
  const legacyPub = await anon("GET", "/api/c/legacy757");
  check("legacy /c/ payload: instagram primary, primaryProfileUrl === instagramUrl (unchanged)", legacyPub.status === 200 && legacyPub.data.profile.primaryPlatform === "instagram" && legacyPub.data.profile.primaryProfileUrl === "https://instagram.com/legacy757" && legacyPub.data.profile.instagramUrl === "https://instagram.com/legacy757", JSON.stringify(legacyPub.data.profile));

  // ---------- public /c/: TikTok-primary creator links TikTok ----------
  await admin("POST", "/api/admin/review", { userId: ttId, decision: "approve" });
  const ttFinish = await tt("PATCH", "/api/me/profile", {
    name: "Tee Tok",
    city: "Norfolk",
    categories: ["Food & Drink"],
    audienceStack: { tiktok: 2500 },
    localAudiencePct: 55,
  });
  check("tiktok claimer completes the profile through the normal gate", ttFinish.status === 200 && ttFinish.data.user.creator.profileComplete === true, JSON.stringify(ttFinish.data.user && ttFinish.data.user.creator));
  const ttPub = await anon("GET", "/api/c/ttclaim757");
  check("tiktok /c/ payload links the tiktok profile and carries NO instagramUrl", ttPub.status === 200 && ttPub.data.profile.primaryPlatform === "tiktok" && ttPub.data.profile.primaryPlatformLabel === "TikTok" && ttPub.data.profile.primaryProfileUrl === "https://www.tiktok.com/@ttclaim757" && !ttPub.data.profile.instagramUrl, JSON.stringify(ttPub.data.profile));
  check("tiktok /c/ audience stack shows the tiktok count", (ttPub.data.profile.audienceStack || []).some((p) => p.platform === "tiktok" && p.count === 2500), JSON.stringify(ttPub.data.profile.audienceStack));

  // ---------- profile edit: switch primary platform both ways ----------
  const toX = await legacy("PATCH", "/api/me/profile", { primaryPlatform: "x" });
  const xc = (toX.data.user || {}).creator || {};
  check("switching primary to X rebuilds the primary URL and clears instagramUrl", toX.status === 200 && xc.primaryPlatform === "x" && xc.primaryProfileUrl === "https://x.com/legacy757" && !xc.instagramUrl, JSON.stringify(xc));
  const backIg = await legacy("PATCH", "/api/me/profile", { primaryPlatform: "instagram" });
  const bc = (backIg.data.user || {}).creator || {};
  check("switching back to Instagram restores the legacy instagramUrl + primary URL", backIg.status === 200 && bc.primaryPlatform === "instagram" && bc.instagramUrl === "https://instagram.com/legacy757" && bc.primaryProfileUrl === "https://instagram.com/legacy757", JSON.stringify(bc));

  // ---------- profile edit: Snapchat count joins the stack ----------
  const snapPatch = await legacy("PATCH", "/api/me/profile", { audienceStack: { instagram: 1000, snapchat: 20000 } });
  const spc = (snapPatch.data.user || {}).creator || {};
  check("profile save: snapchat count stacks and re-tiers (21k total, Headliners)", snapPatch.status === 200 && spc.audienceStack && spc.audienceStack.snapchat === 20000 && spc.totalAudience === 21000 && spc.tierBand === "Headliners", JSON.stringify({ stack: spc.audienceStack, total: spc.totalAudience, tier: spc.tierBand }));

  // ---------- client ships the picker everywhere it belongs ----------
  const appJsRes = await fetch(BASE + "/app.js");
  const appJs = await appJsRes.text();
  check("client ships the picker on quick claim, full signup, and profile edit", appJs.includes('id="qc-platform"') && appJs.includes('id="jc-platform"') && appJs.includes('id="p-platform"') && appJs.includes("Where is your main audience?"), "");
  check("client reads the &platform= claim-link param", appJs.includes('params.get("platform")') && appJs.includes("pf.platform"), "");
  check("client submits primaryPlatform on claim, signup, and profile save", appJs.includes("primaryPlatform: document.getElementById(\"qc-platform\").value") && appJs.includes("primaryPlatform,") && appJs.includes("primaryPlatform: document.getElementById(\"p-platform\").value"), "");
  check("client ships snapchat stack fields on signup + profile (count-only, no handle field)", appJs.includes('id="jc-stack-snapchat"') && appJs.includes('"p-stack-snapchat"') && appJs.includes("Snapchat followers") && !appJs.includes("snapchatHandle"), "");
  check("client labels the admin queue row with the primary platform", appJs.includes("primaryLabelClient(u.creator.primaryPlatform"), "");
  check("client handle links use the primary profile URL with IG markup unchanged", appJs.includes("ccHandleHtml") && appJs.includes("primaryProfileUrl || p.instagramUrl"), "");
} finally {
  server.kill("SIGTERM");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nPlatform picker verification: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("Failures: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
