#!/usr/bin/env node
// Build -66 verification: the profile header pass (Jeff,
// 2026-11-01). The creator profile's top bar carries (1) quick
// links to the creator's socials and (2) a stats cluster with
// the name and photo: the local number FIRST and BOLD, total
// followers second.
//
// Proves, against unit fixtures plus a throwaway local DB:
//   - the book-me payload carries socialLinks + totalAudience
//     at tier 0 (header facts), while the audience stack and
//     followerCount stay gated, and the creator's showSocials
//     toggle still empties the links everywhere;
//   - the server-rendered body draws the pills and the stats
//     in the header, local before followers, compact total;
//   - a profile with no handles renders no pills, a profile
//     with no total renders the local stat alone;
//   - the client render mirrors the server (same helpers, the
//     browsed-market swap from listedMarkets), the CSS carries
//     the header classes with the phone wrap, and the claim
//     stub stays exactly as limited as Build -61 made it.
//
// Run: node scripts/verify-build66.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8997;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_002>";
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
function segment(text, startNeedle, endNeedle) {
  const a = text.indexOf(startNeedle);
  const b = a < 0 ? -1 : text.indexOf(endNeedle, a + startNeedle.length);
  return a < 0 || b < 0 ? "" : text.slice(a, b);
}

const require = createRequire(import.meta.url);
const { profileBodyHtml, fmtFollowers, profileHeaderSocialsHtml, profileHeaderStatsHtml } = require("../netlify/functions/lib/profile-meta.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build66-"));
const dbFile = path.join(tmp, "db.json");
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  server = null;
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up");
}
function makeClient() {
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
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html page */ }
    return { status: res.status, data, text };
  };
}

try {
  part("unit: header helpers");
  check("compact totals: 850 stays, 3K, 34K, 1.5K, 1.2M, 2M",
    fmtFollowers(850) === "850" && fmtFollowers(3000) === "3K" && fmtFollowers(34000) === "34K" && fmtFollowers(1500) === "1.5K" && fmtFollowers(1200000) === "1.2M" && fmtFollowers(2000000) === "2M",
    [850, 3000, 34000, 1500, 1200000, 2000000].map(fmtFollowers).join(","));
  const soc = profileHeaderSocialsHtml({ socialLinks: [
    { platform: "instagram", label: "Instagram", url: "https://instagram.com/rich66" },
    { platform: "tiktok", label: "TikTok", url: "https://www.tiktok.com/@rich66" },
    { platform: "youtube", label: "YouTube", url: "https://www.youtube.com/@RichTV" },
    { platform: "ghost", label: "Ghost", url: "" },
  ] });
  check("social pills render one per stored handle, in order, new tab",
    soc.includes('class="bookme-socials-row"') && soc.includes('href="https://instagram.com/rich66"') && soc.includes('href="https://www.tiktok.com/@rich66"') && soc.includes('href="https://www.youtube.com/@RichTV"') && soc.indexOf("Instagram") < soc.indexOf("TikTok") && soc.indexOf("TikTok") < soc.indexOf("YouTube") && (soc.match(/target="_blank"/g) || []).length === 3 && !soc.includes("Ghost"),
    soc.slice(0, 300));
  check("no handles on the record means no pills at all",
    profileHeaderSocialsHtml({ socialLinks: [] }) === "" && profileHeaderSocialsHtml({}) === "" && profileHeaderSocialsHtml({ socialLinks: null }) === "");
  const stats = profileHeaderStatsHtml({ localAudiencePct: 64, totalAudience: 34000 });
  check("stats cluster: local first and bold, followers second, compact total",
    stats.includes('class="bookme-stats"') && stats.includes("bm-stat-local") && stats.indexOf("64%") > -1 && stats.indexOf("64%") < stats.indexOf("34K") && stats.includes(">local<") && stats.includes(">followers<"),
    stats.slice(0, 300));
  check("no total on record: the local stat stands alone, never a zero",
    profileHeaderStatsHtml({ localAudiencePct: 64 }) === profileHeaderStatsHtml({ localAudiencePct: 64, totalAudience: 0 })
      && profileHeaderStatsHtml({ localAudiencePct: 64 }).includes("64%") && !profileHeaderStatsHtml({ localAudiencePct: 64 }).includes("followers"));
  check("no local share: the followers stat stands alone; neither fact: no cluster",
    profileHeaderStatsHtml({ totalAudience: 5000 }).includes("5K") && !profileHeaderStatsHtml({ totalAudience: 5000 }).includes("bm-stat-local")
      && profileHeaderStatsHtml({}) === "" && profileHeaderStatsHtml({ localAudiencePct: null, totalAudience: 0 }) === "");

  part("unit: server body header");
  const richBody = profileBodyHtml({
    name: "Rich Sixtysix", handle: "rich66", primaryPlatformLabel: "Instagram",
    photoUrl: "/api/users/u66/photo", city: "Nashville", tierBand: "Headliners", charter: false,
    localAudiencePct: 64, localAudienceSource: "Self-reported", totalAudience: 34000,
    socialLinks: [
      { platform: "instagram", label: "Instagram", url: "https://instagram.com/rich66" },
      { platform: "tiktok", label: "TikTok", url: "https://www.tiktok.com/@rich66" },
    ],
    categories: ["Food & Drink"], listedMarkets: [{ market: "Austin", pct: 20, home: false }],
    audienceBreakdown: { segments: [{ market: "Nashville", pct: 64 }, { market: "Austin", pct: 20 }], elsewherePct: 16 },
    rateCard: [{ label: "Paid post", detail: "One post", price: 200 }], pageTheme: "ink",
  }, "Nashville");
  const head66 = segment(richBody, "bookme-cover-id", "cc-chips");
  check("body header carries the pills and the stats cluster inside the top bar",
    head66.includes('class="bookme-socials-row"') && head66.includes('href="https://instagram.com/rich66"') && head66.includes('href="https://www.tiktok.com/@rich66"') && head66.includes('class="bookme-stats"') && head66.indexOf("64%") < head66.indexOf("34K"),
    head66.slice(0, 400));
  const bareBody = profileBodyHtml({
    name: "Bare Sixtysix", handle: "bare66", primaryPlatformLabel: "Instagram",
    photoUrl: null, city: "Nashville", tierBand: "Locals", charter: false,
    localAudiencePct: 41, localAudienceSource: "Self-reported",
    categories: [], listedMarkets: [], rateCard: [], pageTheme: "ink",
  }, "Nashville");
  check("no-handle profile renders clean: no pills, the local stat stands alone (no total on record), designed cover intact",
    !bareBody.includes("bm-soc") && bareBody.includes("bookme-stats") && bareBody.includes("41%") && !bareBody.includes(">followers<") && bareBody.includes("bookme-cover no-photo"),
    bareBody.slice(0, 300));

  part("source: client mirror + css + stamp");
  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const theme = fs.readFileSync(path.join(root, "public", "theme-v2.css"), "utf8");
  const renderSeg = segment(appJs, "async function renderPublicProfile", "function renderClaimedProfile");
  check("client profile render calls the header helpers",
    renderSeg.includes("profileHeaderSocialsHtml(p)") && renderSeg.includes("profileHeaderStatsHtml(p)"), renderSeg.slice(0, 200));
  const statsSeg = segment(appJs, "function profileHeaderStatsHtml", "async function renderPublicProfile");
  // Build -68 re-aim (2026-11-02): market resolution moved out of
  // the stats helper into profileViewMarket(p), which reads
  // p.listedMarkets and matches the business's market / ?market=
  // against it (home fallback). The stats helper consumes that
  // result and, new in -68, puts the follower count under the
  // local share via followersForPct. Behavior (the browsed
  // market's share leads the header) is unchanged and extended.
  const viewSeg = segment(appJs, "function profileViewMarket", "function followersForPct");
  check("client stats helper swaps in the browsed market's share from listedMarkets (Build -68: via profileViewMarket)",
    viewSeg.includes("listedMarkets") && viewSeg.includes('"market"') && statsSeg.includes("totalAudienceOf(p)") && statsSeg.includes("followersForPct"), statsSeg.slice(0, 200));
  check("client carries the compact formatter and the messaging-only locked line",
    appJs.includes("function fmtFollowers") && appJs.includes('BOOKME_LOCKED_LINE = "Paying businesses can message this creator right here on SIGNL."'));
  check("css carries the header classes and the phone wrap",
    theme.includes(".bookme-stats") && theme.includes(".bm-soc") && theme.includes(".bookme-id-row") && theme.includes(".bm-stat-local .bm-num") && /@media \(max-width: 560px\) \{\s*\.bookme-id-row \{ flex-wrap: wrap; \}/.test(theme));
  check("build stamp is 2026.11.02-77 everywhere",
    fs.readFileSync(path.join(root, "netlify", "functions", "lib", "build.js"), "utf8").includes('exports.BUILD_ID = "2026.11.02-77"')
      && fs.readFileSync(path.join(root, "public", "index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.02-77"'));

  part("http: rich, plain, hidden, stub");
  startServer();
  await waitUp();
  const admin = makeClient();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const anon = makeClient();

  const rich = makeClient();
  const regRich = await rich("POST", "/api/auth/register", {
    role: "creator", name: "Rich Sixtysix", email: "rich66@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Nashville", city: "Nashville", handle: "rich66",
    followerCount: 20000, localAudiencePct: 64, categories: ["Food & Drink"], ...AGREE,
  });
  check("rich creator registers", (regRich.status === 200 || regRich.status === 201) && !!regRich.data.user, JSON.stringify(regRich.data).slice(0, 200));
  await admin("POST", "/api/admin/review", { userId: regRich.data.user.id, decision: "approve" });
  const patchRich = await rich("PATCH", "/api/me/profile", {
    publicPage: true, paidRate: 200,
    audienceStack: { instagram: 20000, tiktok: 14000 },
    tiktokHandle: "rich66", youtubeChannel: "RichSixtysixTV",
    facebookUrl: "https://www.facebook.com/rich66page", xHandle: "rich66x",
    audienceMarkets: [{ market: "Austin", pct: 20 }],
  });
  check("rich creator profile patch succeeds", patchRich.status === 200, JSON.stringify(patchRich.data).slice(0, 200));

  const pubRich = await anon("GET", "/api/c/rich66");
  const pr = pubRich.data.profile || {};
  check("tier 0 payload carries the header facts: social links for every stored platform",
    pubRich.status === 200 && pr.viewerTier === 0 && Array.isArray(pr.socialLinks)
      && JSON.stringify(pr.socialLinks.map((s) => s.platform)) === JSON.stringify(["instagram", "tiktok", "youtube", "facebook", "x"])
      && pr.socialLinks.some((s) => s.url === "https://instagram.com/rich66")
      && pr.socialLinks.some((s) => s.url === "https://www.tiktok.com/@rich66")
      && pr.socialLinks.some((s) => s.url === "https://www.youtube.com/@RichSixtysixTV")
      && pr.socialLinks.some((s) => s.url === "https://www.facebook.com/rich66page")
      && pr.socialLinks.some((s) => s.url === "https://x.com/rich66x"),
    JSON.stringify(pr.socialLinks));
  check("tier 0 payload total matches the stacked audience (20,000 + 14,000); stack and followerCount stay gated",
    pr.totalAudience === 34000 && !("audienceStack" in pr) && !("followerCount" in pr),
    `total=${pr.totalAudience} keys=${JSON.stringify(Object.keys(pr))}`);

  const pageRich = await anon("GET", "/c/rich66");
  const headSeg = segment(pageRich.text, "bookme-cover-id", "cc-chips");
  check("served page header: pills for all five platforms, stats local-first with the compact total",
    pageRich.status === 200 && headSeg.includes('class="bookme-socials-row"')
      && headSeg.includes('href="https://instagram.com/rich66"') && headSeg.includes('href="https://www.tiktok.com/@rich66"')
      && headSeg.includes('href="https://www.youtube.com/@RichSixtysixTV"') && headSeg.includes('href="https://www.facebook.com/rich66page"') && headSeg.includes('href="https://x.com/rich66x"')
      && headSeg.includes('class="bookme-stats"') && headSeg.indexOf("64%") > -1 && headSeg.indexOf("64%") < headSeg.indexOf("34K") && headSeg.includes(">followers<"),
    headSeg.slice(0, 400));

  const plain = makeClient();
  const regPlain = await plain("POST", "/api/auth/register", {
    role: "creator", name: "Plain Sixtysix", email: "plain66@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Nashville", city: "Nashville", handle: "plain66",
    followerCount: 900, localAudiencePct: 50, categories: ["Lifestyle"], ...AGREE,
  });
  await admin("POST", "/api/admin/review", { userId: regPlain.data.user.id, decision: "approve" });
  await plain("PATCH", "/api/me/profile", { publicPage: true });
  const pagePlain = await anon("GET", "/c/plain66");
  const plainHead = segment(pagePlain.text, "bookme-cover-id", "cc-chips");
  check("single-platform profile: only the Instagram pill, total under 1K stays exact, no-photo cover intact",
    pagePlain.status === 200 && plainHead.includes('href="https://instagram.com/plain66"') && !plainHead.includes("tiktok.com") && !plainHead.includes("youtube.com")
      && plainHead.includes(">900<") && plainHead.includes("50%") && pagePlain.text.includes("bookme-cover no-photo"),
    plainHead.slice(0, 400));

  const hid = makeClient();
  const regHid = await hid("POST", "/api/auth/register", {
    role: "creator", name: "Hidden Sixtysix", email: "hidden66@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Nashville", city: "Nashville", handle: "hidden66",
    followerCount: 5000, localAudiencePct: 70, categories: ["Lifestyle"], ...AGREE,
  });
  await admin("POST", "/api/admin/review", { userId: regHid.data.user.id, decision: "approve" });
  await hid("PATCH", "/api/me/profile", { publicPage: true, showSocials: false, tiktokHandle: "hidden66" });
  const pubHid = await anon("GET", "/api/c/hidden66");
  const pageHid = await anon("GET", "/c/hidden66");
  check("creator-hidden socials stay hidden at every tier, header included",
    pubHid.status === 200 && Array.isArray(pubHid.data.profile.socialLinks) && pubHid.data.profile.socialLinks.length === 0
      && pubHid.data.profile.socialsHiddenByCreator === true && !pageHid.text.includes("bm-soc") && pageHid.text.includes(">5K<"),
    JSON.stringify(pubHid.data.profile && pubHid.data.profile.socialLinks));

  const stub = makeClient();
  const regStub = await stub("POST", "/api/auth/register", {
    role: "creator", name: "Stub Sixtysix", email: "stub66@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Nashville", city: "Nashville", handle: "stub66", quickClaim: true, ...AGREE,
  });
  await admin("POST", "/api/admin/review", { userId: regStub.data.user.id, decision: "approve" });
  const stubPage = await anon("GET", "/c/stub66");
  check("claim stub keeps its limits: noindex, no server profile body, no header facts",
    stubPage.status === 200 && stubPage.text.includes('<meta name="robots" content="noindex">') && !stubPage.text.includes('class="public-profile bookme') && !stubPage.text.includes("bookme-stats") && !stubPage.text.includes("bm-soc"),
    stubPage.text.slice(0, 200));
} finally {
  await stopServer();
}

console.log(`\nverify-build66: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
