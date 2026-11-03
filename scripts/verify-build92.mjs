#!/usr/bin/env node
// Build -92 verification: server-rendered public creator profile body.
//
// The /c/<handle> page must arrive complete in the served HTML
// (raw fetch, no JS): name, photo, market, local % first, total
// followers, audience breakdown, best work, the public rate card
// (paid rate + licensing fee), the engagement strip when the
// Build -83 predicate is met (>=3 posts with reported metrics),
// and the booking CTA. The client then hydrates OVER that body
// (never blanks it behind a loading line) and its re-render
// carries the same engagement strip. Thin claim stubs stay
// noindex with no rendered rate/audience data, unknown handles
// keep their API 404, JSON-LD stays present and consistent, and
// user-supplied strings are HTML-escaped in the served body.
//
// Run: node scripts/verify-build92.mjs   (port 8967)

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8967;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const require = createRequire(import.meta.url);
const { buildProfilePageHtml, profileBodyHtml } = require("../netlify/functions/lib/profile-meta.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build92-"));
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
const fmtFollowers = (n) => {
  const v = Math.floor(Number(n) || 0);
  if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(v);
};
let uniqN = 0;
const uniq = () => `${Date.now().toString(36)}${(uniqN++).toString(36)}`;

try {
  // ---------- unit: hostile fixture escaping + JSON-LD ----------
  part("unit: hostile fixture is escaped");
  const hostile = {
    name: 'Evil <img src=x onerror=alert(1)>',
    handle: "evil92",
    firstName: "Evil",
    primaryPlatformLabel: "Instagram",
    photoUrl: null,
    city: "Nashville",
    tierBand: "Locals",
    charter: false,
    localAudiencePct: 55,
    localAudienceSource: "Self-reported",
    totalAudience: 2000,
    bio: 'bio <script>alert(1)</script> "quoted"',
    pitchLine: "<b>not bold</b>",
    categories: ["Food & Drink"],
    listedMarkets: [],
    audienceBreakdown: { segments: [{ market: "Nashville", pct: 55 }], elsewherePct: 45 },
    rateCard: [
      { label: "Paid booking", detail: "x", price: 250 },
      { label: "License a post for ads", detail: "y", price: 120 },
    ],
    pastWork: [{ url: "https://example.com/work", label: 'Watch <script>alert(2)</script>', platform: "Web" }],
    pageTheme: "ink",
  };
  const hostileBody = profileBodyHtml(hostile, "Nashville");
  check("bio script tag renders escaped, never raw", !hostileBody.includes("<script>alert(1)</script>") && hostileBody.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  check("name markup renders escaped", !hostileBody.includes("<img src=x onerror") && hostileBody.includes("&lt;img src=x onerror=alert(1)&gt;"));
  check("pitch line and work label render escaped", !hostileBody.includes("<b>not bold</b>") && hostileBody.includes("&lt;b&gt;not bold&lt;/b&gt;") && !hostileBody.includes("<script>alert(2)</script>"));
  check("body is stamped as server-rendered for hydration", hostileBody.includes('data-server-rendered="1"'));
  const shell = '<!DOCTYPE html><html><head><title>SIGNL</title><meta name="description" content="generic"><meta name="robots" content="noindex"></head><body><main id="app">Loading SIGNL...</main><script src="/app.js?v=test"></script></body></html>';
  const hostileServed = buildProfilePageHtml(shell, { name: hostile.name, handle: hostile.handle, place: "Nashville", tierBand: "Locals", localAudiencePct: 55, photoUrl: null, paidRate: 250, categories: hostile.categories, origin: "https://app.joinsignl.com", body: hostile });
  check("served hostile page carries no raw script injection", !hostileServed.includes("<script>alert(1)</script>") && !hostileServed.includes("<script>alert(2)</script>"));
  const ldMatch = hostileServed.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let ld = null;
  try { ld = ldMatch && JSON.parse(ldMatch[1]); } catch (e) { ld = null; }
  check("JSON-LD present, parseable, and consistent (Person + paid offer)", !!ld && ld["@type"] === "ProfilePage" && ld.mainEntity && ld.mainEntity.name === hostile.name && ld.mainEntity.makesOffer && ld.mainEntity.makesOffer.price === 250 && ld.mainEntity.makesOffer.priceCurrency === "USD", ldMatch ? ldMatch[1].slice(0, 200) : "no ld");

  // ---------- source: hydration + parity ----------
  part("source: client hydrates over the server body");
  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const renderStart = appJs.indexOf("async function renderPublicProfile");
  const renderSeg = appJs.slice(renderStart, appJs.indexOf("function renderClaimedProfile", renderStart));
  check("client detects the server-rendered body and skips the loading blank", renderSeg.includes('data-server-rendered') && renderSeg.includes("if (!serverRendered)"), renderSeg.slice(0, 260));
  check("client keeps the server body when the payload fetch fails", renderSeg.includes("if (serverRendered) return;"));
  check("client re-render carries the engagement strip (parity with server)", renderSeg.includes("Post engagement") && renderSeg.includes("postsWithMetrics >= 3"));

  // ---------- http fixtures ----------
  part("http: finished Nashville profile (US control)");
  startServer();
  await waitUp();
  const admin = makeClient();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  async function registerCreator(email, name, handle, market, city, extra = {}) {
    const client = makeClient();
    const reg = await client("POST", "/api/auth/register", {
      role: "creator", name, email, password: "<MASKED_SECRET_002>",
      market, city, handle, followerCount: 6400, localAudiencePct: 64,
      categories: ["Food & Drink"], ...AGREE, ...extra,
    });
    if (!((reg.status === 200 || reg.status === 201) && reg.data.user)) throw new Error(`register ${handle} failed: ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
    await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
    return { client, user: reg.data.user };
  }

  const nash = await registerCreator("b92nash@fixtures.dev", "Harbor Lights", "b92nash", "Nashville", "Nashville");
  const patch = await nash.client("PATCH", "/api/me/profile", { publicPage: true, paidRate: 250, licensingFee: 120, bio: "Nashville food and live music, posted honestly.", bestWork: ["https://www.tiktok.com/@b92nash/video/777"] });
  check("profile patch sets paid rate + licensing fee", patch.status === 200, JSON.stringify(patch.data).slice(0, 200));
  const pngBase = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const up1 = await nash.client("POST", "/api/me/photo", { dataUrl: "data:image/png;base64," + pngBase });
  const up2 = await nash.client("POST", "/api/me/photo", { dataUrl: "data:image/png;base64," + pngBase, slot: 1 });
  check("two photos upload (cover + gallery)", up1.status === 200 && up2.status === 200 && (up2.data.photoCount || 0) >= 2, JSON.stringify(up2.data).slice(0, 160));

  const apiView = await makeClient()("GET", "/api/c/b92nash");
  const prof = apiView.data && apiView.data.profile;
  check("public API payload carries the facts the body must render", apiView.status === 200 && !!prof && prof.totalAudience > 0 && Array.isArray(prof.rateCard) && prof.rateCard.some((r) => r.price === 250) && prof.rateCard.some((r) => r.price === 120), JSON.stringify(prof && { total: prof.totalAudience, rateCard: prof.rateCard }).slice(0, 240));

  const page = await makeClient()("GET", "/c/b92nash");
  const html = page.text;
  check("served page (raw, no JS) is the rendered profile, not the loading shell", page.status === 200 && html.includes('data-server-rendered="1"') && html.includes('class="public-profile bookme') && !html.includes('<main id="app">\n  <div class="loading">Loading SIGNL...</div>'), html.slice(0, 200));
  check("served body contains the name (title + first-name line) and handle", html.includes("Harbor Lights (@b92nash) on SIGNL | Nashville") && html.includes(">Harbor<") && html.includes("@b92nash"));
  check("served body contains the photo and the gallery row", html.includes('class="bookme-banner"') && html.includes("/api/users/" + nash.user.id + "/photo") && html.includes('class="gal-row"'));
  check("local % is first and bold in the header stats, total followers beside it", html.includes('bm-stat bm-stat-local') && html.indexOf('bm-stat bm-stat-local') < html.indexOf('bm-stat bm-stat-fol') && html.includes(">64%<") && html.includes(fmtFollowers(prof.totalAudience)), html.slice(html.indexOf("bookme-stats") - 40, html.indexOf("bookme-stats") + 320));
  check("served body contains market/city and the audience breakdown, self-reported", html.includes("Nashville") && html.includes("Where their audience lives") && html.includes("Self-reported by the creator"));
  check("served body contains best work with the video-embed treatment", html.includes('class="work-grid"') && html.includes("<iframe"));
  check("served body contains the rate card amounts (paid $250 + licensing $120)", html.includes("Rate card") && html.includes("$250") && html.includes("$120"));
  check("served body contains the CTA (sticky Book on SIGNL with href)", html.includes('class="bookme-sticky"') && /<a class="btn bs-btn" href="\/"[^>]*>Book on SIGNL<\/a>/.test(html));
  check("served page keeps indexability, canonical, and deferred app.js", html.includes('<meta name="robots" content="index, follow">') && html.includes('<link rel="canonical" href="https://127.0.0.1:' + PORT + '/c/b92nash">') && html.includes('<script defer src="/app.js'));
  const pageLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let pageLd = null;
  try { pageLd = pageLdMatch && JSON.parse(pageLdMatch[1]); } catch (e) { pageLd = null; }
  check("served JSON-LD is present and consistent with the body (name, USD offer at the listed rate)", !!pageLd && pageLd.mainEntity.name === "Harbor Lights" && pageLd.mainEntity.makesOffer.price === 250 && pageLd.mainEntity.makesOffer.priceCurrency === "USD");
  check("US control content unchanged: no engagement strip without metric posts, no invented numbers", !html.includes("Post engagement") && !html.includes("Return score"));

  part("http: unknown handle + claim stub");
  const unknownApi = await makeClient()("GET", "/api/c/b92nopeunknown");
  check("unknown handle: profile API 404s", unknownApi.status === 404, String(unknownApi.status));
  const unknownPage = await makeClient()("GET", "/c/b92nopeunknown");
  check("unknown handle: page stays the plain noindex shell with no rendered body (existing contract)", unknownPage.status === 200 && unknownPage.text.includes('<meta name="robots" content="noindex">') && !unknownPage.text.includes('data-server-rendered'));

  const stub = makeClient();
  const regStub = await stub("POST", "/api/auth/register", {
    role: "creator", name: "Stub NinetyTwo", email: "b92stub@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Nashville", city: "Nashville", handle: "b92stub", quickClaim: true, ...AGREE,
  });
  await admin("POST", "/api/admin/review", { userId: regStub.data.user.id, decision: "approve" });
  const stubPage = await makeClient()("GET", "/c/b92stub");
  check("unfinished stub stays noindex with no server-rendered body", stubPage.status === 200 && stubPage.text.includes('<meta name="robots" content="noindex">') && !stubPage.text.includes('data-server-rendered') && !stubPage.text.includes('class="public-profile bookme'));
  check("unfinished stub leaks no rendered rate or audience data", !stubPage.text.includes("Rate card") && !stubPage.text.includes("Where their audience lives") && !stubPage.text.includes("Post engagement") && !stubPage.text.includes("application/ld+json"));

  part("http: engagement strip gate (Build -83 predicate)");
  async function registerBusiness(businessName) {
    const client = makeClient();
    const r = await client("POST", "/api/auth/register", {
      role: "business", name: "Biz Owner", email: `biz-${uniq()}@fixtures.dev`, password: "<MASKED_SECRET_002>",
      market: "Hampton Roads", city: "Norfolk", businessName, category: "Restaurant", planId: "growth", agreedTerms: true,
    });
    if (!((r.status === 200 || r.status === 201) && r.data.user)) throw new Error(`business register failed: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
    await admin("POST", "/api/admin/businesses/activate", { userId: r.data.user.id });
    return { client, user: r.data.user };
  }
  async function compVisitWithPost(business, creator, title) {
    const off = await business.client("POST", "/api/offers", { title, whatComped: "Dinner for two", dollarCap: 60, spots: 1, includesAlcohol: false, creatorId: creator.user.id });
    if (off.status !== 201) throw new Error(`offer failed: ${off.status} ${JSON.stringify(off.data).slice(0, 160)}`);
    const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
    if (acc.status !== 201) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.data).slice(0, 160)}`);
    const booking = acc.data.booking;
    const conf = await business.client("POST", `/api/bookings/${booking.id}/confirm`, {});
    if (conf.status !== 200) throw new Error(`confirm failed: ${conf.status}`);
    const post = await creator.client("POST", "/api/posts", { bookingId: booking.id, url: `https://www.instagram.com/p/B92${uniq()}/`, includesDisclosure: true });
    if (post.status !== 201) throw new Error(`post failed: ${post.status} ${JSON.stringify(post.data).slice(0, 160)}`);
    return booking;
  }
  const biz = await registerBusiness("NinetyTwo Table");
  const trio = await registerCreator("b92trio@fixtures.dev", "Trio NinetyTwo", "b92trio", "Hampton Roads", "Norfolk");
  await trio.client("PATCH", "/api/me/profile", { publicPage: true });
  const bk1 = await compVisitWithPost(biz, trio, "Trio visit 1");
  const perf1 = await trio.client("POST", `/api/bookings/${bk1.id}/performance`, { views: 1000, likes: 50, shares: 10, saves: 5 });
  check("fixture: first performance report lands", perf1.status === 200, String(perf1.status));
  const onePage = await makeClient()("GET", "/c/b92trio");
  check("below the predicate (1 metric post): served page has NO engagement strip", onePage.status === 200 && onePage.text.includes('data-server-rendered="1"') && !onePage.text.includes("Post engagement"));
  for (let i = 2; i <= 3; i++) {
    const b = await compVisitWithPost(biz, trio, `Trio visit ${i}`);
    const r = await trio.client("POST", `/api/bookings/${b.id}/performance`, { views: 1000, likes: 50, shares: 10, saves: 5 });
    if (r.status !== 200) throw new Error(`trio perf ${i} failed: ${r.status}`);
  }
  const trioPage = await makeClient()("GET", "/c/b92trio");
  check("at the predicate (3 metric posts): served page renders the engagement strip server-side", trioPage.status === 200 && trioPage.text.includes("Post engagement") && trioPage.text.includes("From 3 SIGNL posts with reported numbers") && trioPage.text.includes("3,000 views"), trioPage.text.slice(trioPage.text.indexOf("Post engagement") - 80, trioPage.text.indexOf("Post engagement") + 200));
} finally {
  await stopServer();
}

console.log(`\nverify-build92: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
