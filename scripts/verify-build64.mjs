#!/usr/bin/env node
// Build -64 verification: the audit-fix build.
//
// Proves, against a throwaway local DB plus source checks:
//   - a finished public profile arrives with its core body in
//     the served HTML (photo banner, chips, local reach, one
//     merged Work grid, rate card, sticky logged-out CTA), the
//     app bundle is deferred on that page, and insider copy is
//     gone from the public render;
//   - a claim-tier stub stays noindex, gets no server body, and
//     does not defer the bundle;
//   - the offers board has the founding empty state and the
//     deck error path uses boardError, not alert();
//   - the creator profile form leads with the four-field
//     "Your basics" card, dynamic multi-market rows, and a
//     sticky save bar;
//   - business signup keeps essentials first and moves the
//     first-month setup to the founding status page;
//   - the CSS accent lock and Build -64 stamp are in place.
//
// Run: node scripts/verify-build64.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8991;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "test-admin-password-123";
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
const { buildProfilePageHtml, profileBodyHtml, profileWorkItems } = require("../netlify/functions/lib/profile-meta.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build64-"));
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
  part("unit: server profile body");
  const payload = {
    name: "Build Sixtyfour",
    handle: "build64owner",
    primaryPlatformLabel: "Instagram",
    photoUrl: "/api/users/u64/photo",
    city: "Nashville",
    tierBand: "Locals",
    charter: false,
    localAudiencePct: 64,
    localAudienceSource: "Self-reported",
    categories: ["Food & Drink"],
    listedMarkets: [{ market: "Austin", pct: 20, home: false }],
    audienceBreakdown: { segments: [{ market: "Nashville", pct: 64 }, { market: "Austin", pct: 20 }], elsewherePct: 16 },
    proof: { visitsCompleted: 2, onTimePosts: 2 },
    rateCard: [{ label: "Paid post", detail: "One post", price: 200 }],
    portfolioSample: { url: "https://www.instagram.com/reel/SHARED1/", embedUrl: "https://www.instagram.com/reel/SHARED1/embed" },
    featuredPosts: [{ url: "https://www.instagram.com/reel/SHARED1", embedUrl: "https://www.instagram.com/reel/SHARED1/embed" }],
    pastWork: [{ url: "https://www.tiktok.com/@build64/video/123", label: "Watch: TikTok video", platform: "TikTok" }],
    pageTheme: "ink",
  };
  const items = profileWorkItems(payload);
  check("work merge dedupes a post featured and sampled", items.length === 2, JSON.stringify(items));
  const body = profileBodyHtml({ ...payload, photoUrl: "https://app.joinsignl.com/api/users/u64/photo" }, "Nashville");
  check("body is photo-first with a banner image", body.includes('class="bookme-banner"') && body.includes("https://app.joinsignl.com/api/users/u64/photo"));
  check("body carries one merged Work grid", body.includes('<div class="work-grid">') && (body.match(/work-cell/g) || []).length >= 2 && !body.includes("Featured posts") && !body.includes("Past work"));
  check("body carries local reach, breakdown, rate card, sticky CTA", body.includes("64%") && body.includes("Where their audience lives") && body.includes("Rate card") && body.includes("$200") && body.includes('class="bookme-sticky"'));
  check("body proof is plain words only", body.includes("Verified on SIGNL") && body.includes("2 visits completed") && body.includes("2 on time"));
  check("body has no insider copy", !/Sees new offers|First \d+ founding|customers counted|came-backs/i.test(body));
  const shell = '<!DOCTYPE html><html><head><title>SIGNL</title><meta name="description" content="generic"><meta name="robots" content="noindex"></head><body><main id="app">Loading SIGNL...</main><script src="/app.js?v=test"></script></body></html>';
  const served = buildProfilePageHtml(shell, { name: payload.name, handle: payload.handle, place: "Nashville", tierBand: "Locals", localAudiencePct: 64, photoUrl: payload.photoUrl, origin: "https://app.joinsignl.com", body: payload });
  check("served page replaces the loading shell with the profile body", served.includes('class="public-profile bookme') && served.includes("Build Sixtyfour") && !served.includes('<main id="app">Loading SIGNL...</main>'));
  check("served page defers app.js", served.includes('<script defer src="/app.js?v=test">'));

  part("source: offers, profile form, business signup, css, stamp");
  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const theme = fs.readFileSync(path.join(root, "public", "theme-v2.css"), "utf8");
  check("offers empty state states the founding facts", appJs.includes("You are on the founding roster for") && appJs.includes("Offers land here the moment the market opens") && appJs.includes("we email you the moment the first business posts"));
  const deckSeg = segment(appJs, "function renderOpenBoard()", "function offersEndHtml");
  check("offers deck errors are inline, never alert()", deckSeg.includes('boardError("open-list", err.message)') && !deckSeg.includes("alert("));
  const endSeg = segment(appJs, "function offersEndHtml", "// ---------- creator-side preview");
  check("zero-offer deck end returns the founding state", endSeg.includes("if (!all.length || !total) return foundingOffersEmptyHtml();"));
  const formSeg = segment(appJs, "function creatorProfileHtml(u)", "function myRatingHtml(card)");
  check("profile form leads with the required basics card", formSeg.includes('id="profile-basics"') && formSeg.indexOf('id="profile-basics"') < formSeg.indexOf('"About you"') && (formSeg.match(/req-badge/g) || []).length >= 4);
  check("gate fields appear once, inside the basics pattern", (appJs.match(/id="p-localpct"/g) || []).length === 1 && (appJs.match(/id="p-stack-total"/g) || []).length === 1);
  check("multi-market rows are dynamic, optional-first, capped by the add button", formSeg.includes('id="p-am-rows"') && formSeg.includes("Optional. If a real share") && formSeg.includes('onclick="return amAddRow()"') && !formSeg.includes("p-am-market-0") && appJs.includes("function filterAmOptions(input)"));
  check("sticky save bar wraps the profile save controls", formSeg.includes('<div class="save-bar"><div id="save-warn"></div>'));
  const gateSeg = segment(appJs, "function gateCardHtml(u)", "// ---------- Overhaul V2");
  check("checklist finish action lands on the basics card", gateSeg.includes('onclick="return goFinishProfile()"') && appJs.includes('document.getElementById("profile-basics")'));
  const bizSeg = segment(appJs, "function renderForBusinesses()", "// Business-wave prefill");
  check("business signup frame sits directly under the H2", bizSeg.indexOf("Free to join. No card taken.") > bizSeg.indexOf("<h2>For Businesses") && bizSeg.indexOf("Free to join. No card taken.") < bizSeg.indexOf('<div class="plan-cards">'));
  check("business signup no longer asks first-month or baseline questions", !bizSeg.includes('id="jb-moment"') && !bizSeg.includes('id="jb-baseline-day"') && !bizSeg.includes('id="jb-baseline-count"'));
  check("Sig draft card sits below the business fields", bizSeg.indexOf('${igAssistCardHtml("jb", "business")}') > bizSeg.indexOf('id="jb-about"'));
  check("apply by conversation is a secondary text link", bizSeg.includes('<a class="tlink" href="#" id="jb-convo-start"') && !bizSeg.includes('id="jb-convo-card"'));
  const statusSeg = segment(appJs, "function renderBusinessFoundingStatus()", "// ---------- founding business preview");
  // Build -68 (2026-11-01): the "Set up your first month" panel
  // DIED. The moment now lives in the campaign composer as one
  // optional chip row; the usual-day baseline lives in Results
  // Proof Controls. The status page is pending-review only.
  check("the first-month setup panel is gone for good (Build -68)", !appJs.includes("Set up your first month") && statusSeg.includes("Application in review") && appJs.includes("What is your first month built around?") && appJs.includes("One of your usual open days"));
  check("css carries the Build -64 profile and form classes", theme.includes(".work-grid") && theme.includes(".bookme-sticky") && theme.includes(".save-bar") && theme.includes(".req-badge") && theme.includes(".p-am-row"));
  check("css accent lock resolves v3 and admin tokens to azure", theme.includes("body.v3-on { --mint-deep: #006AFC; }") && theme.includes("body.v3-on { --blue: #006AFC; }") && theme.includes("--mint-deep: #006AFC; --blue: #006AFC;"));
  check("claim lane bullets match", theme.includes(".ldot.off { background: var(--black); border: 0; width: 14px; height: 14px;"));
  const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  // Build -68 re-aim (2026-11-02): the asset cache-bust clause used
  // to count the PREVIOUS build's stamp in index.html; at -68 every
  // asset reference (styles.css, theme-v2.css, app.js) was bumped to
  // the -68 stamp itself, so the count now pins -68 (4 occurrences,
  // 0 of -67). Shipping old-stamp asset URLs under a new build would
  // serve stale files, which is the bug this clause exists to catch.
  check("build stamp is 2026.11.02-85 everywhere", buildJs.includes('exports.BUILD_ID = "2026.11.02-85"') && indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.02-85"') && (indexHtml.match(/2026\.11\.02-85/g) || []).length >= 4);

  part("http: finished profile + claim stub");
  startServer();
  await waitUp();
  const admin = makeClient();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const creator = makeClient();
  const reg = await creator("POST", "/api/auth/register", {
    role: "creator", name: "Build Sixtyfour", email: "build64@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Nashville", city: "Nashville", handle: "build64owner",
    followerCount: 6400, localAudiencePct: 64, categories: ["Food & Drink"], ...AGREE,
  });
  check("complete creator registers", (reg.status === 200 || reg.status === 201) && !!reg.data.user, JSON.stringify(reg.data).slice(0, 200));
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  const patch = await creator("PATCH", "/api/me/profile", { publicPage: true, paidRate: 200, bestWork: ["https://www.instagram.com/reel/BUILD64/"] });
  check("creator profile patch succeeds", patch.status === 200, JSON.stringify(patch.data).slice(0, 200));
  const pngBase = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const up = await creator("POST", "/api/me/photo", { dataUrl: "data:image/png;base64," + pngBase });
  check("creator photo uploads", up.status === 200 && up.data.photoCount === 1, JSON.stringify(up.data).slice(0, 200));
  const page = await makeClient()("GET", "/c/build64owner");
  check("finished page answers 200 with its body in the HTML", page.status === 200 && page.text.includes('class="public-profile bookme') && page.text.includes("Build Sixtyfour"), page.text.slice(0, 300));
  check("finished page banner uses the real photo route", page.text.includes(`class="bookme-banner" src="https://127.0.0.1:${PORT}/api/users/${reg.data.user.id}/photo"`), page.text.slice(page.text.indexOf("bookme-banner") - 80, page.text.indexOf("bookme-banner") + 180));
  check("finished page carries Work, rate card, and sticky CTA", page.text.includes('<div class="work-grid">') && page.text.includes("Rate card") && page.text.includes('class="bookme-sticky"'));
  check("finished page defers app.js and keeps indexability", page.text.includes('<script defer src="/app.js') && page.text.includes('<meta name="robots" content="index, follow">'));
  check("finished page has no insider copy", !/Sees new offers|First \d+ founding|customers counted/i.test(page.text));

  const stub = makeClient();
  const regStub = await stub("POST", "/api/auth/register", {
    role: "creator", name: "Build Stub", email: "build64stub@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Nashville", city: "Nashville", handle: "build64stub", quickClaim: true, ...AGREE,
  });
  await admin("POST", "/api/admin/review", { userId: regStub.data.user.id, decision: "approve" });
  const stubPage = await makeClient()("GET", "/c/build64stub");
  check("claim stub stays noindex with no server profile body", stubPage.status === 200 && stubPage.text.includes('<meta name="robots" content="noindex">') && !stubPage.text.includes('class="public-profile bookme'));
  check("claim stub does not defer app.js", !stubPage.text.includes("<script defer src=\"/app.js"));
} finally {
  await stopServer();
}

console.log(`\nverify-build64: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
