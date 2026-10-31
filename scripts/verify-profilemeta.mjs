#!/usr/bin/env node
// /c/ profile indexability verification (Jeff's ruling, 2026-10-23).
//
// Proves, against a throwaway local DB:
//   - an APPROVED + profile-complete creator's /c/<handle> page is
//     served with a real <title>, meta description, Open Graph /
//     Twitter tags, and robots "index, follow" baked into the HTML
//     (the dev server mirrors the production netlify.toml /c/*
//     rewrite into the api function's cpage route);
//   - an approved but INCOMPLETE creator gets the plain shell
//     (generic title, noindex, no OG tags), exactly as before, and
//     the profile API keeps its 404 for them;
//   - an unknown handle gets the plain shell too, API 404;
//   - deeper paths (/c/<handle>/proof) keep the plain shell so
//     the SPA renders them unchanged;
//   - robots.txt explicitly allows /c/;
//   - the pure meta builder handles photos (absolute og:image)
//     and escapes hostile names.
//
// Run: node scripts/verify-profilemeta.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8973;
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-profilemeta-"));
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

const require = createRequire(import.meta.url);
const { buildProfilePageHtml } = require("../netlify/functions/lib/profile-meta.js");

try {
  part("unit: meta builder");
  const shell = '<!DOCTYPE html><html><head><title>SIGNL - Local Creator Marketing Platform</title>\n<meta name="description" content="generic">\n<meta name="robots" content="noindex">\n</head><body></body></html>';
  const withPhoto = buildProfilePageHtml(shell, { name: "Casey Rivers", handle: "caseyrivers", place: "Richmond", tierBand: "Locals", photoUrl: "/api/users/u1/photo", origin: "https://app.joinsignl.com" });
  check("photo profile gets absolute og:image", withPhoto.includes('<meta property="og:image" content="https://app.joinsignl.com/api/users/u1/photo">'));
  check("photo profile gets summary_large_image card", withPhoto.includes('<meta name="twitter:card" content="summary_large_image">'));
  check("title mirrors the client share shell", withPhoto.includes("<title>Casey Rivers (@caseyrivers) on SIGNL | Richmond</title>"));
  const hostile = buildProfilePageHtml(shell, { name: 'A "B" <C>', handle: "ab", place: "", tierBand: null, photoUrl: null, origin: "https://app.joinsignl.com" });
  check("hostile name is escaped in title", !hostile.includes('<title>A "B" <C>') && hostile.includes("&quot;B&quot;"));
  check("no photo means no og:image", !hostile.includes("og:image"));

  // SEO/AEO completion (2026-10-25 audit): canonical + JSON-LD +
  // the local reach % in the description, all from public facts.
  const withPct = buildProfilePageHtml(shell, { name: "Casey Rivers", handle: "caseyrivers", place: "Richmond", tierBand: "Locals", localAudiencePct: 62, photoUrl: "/api/users/u1/photo", origin: "https://app.joinsignl.com" });
  check("description carries the local reach %", withPct.includes("62% of their audience is local."));
  check("no local % reported means no local sentence", !withPhoto.includes("of their audience is local."));
  check("page carries a self-referencing canonical", withPct.includes('<link rel="canonical" href="https://app.joinsignl.com/c/caseyrivers">'));
  const ldMatch = withPct.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let ldOk = false;
  try { const ld = JSON.parse(ldMatch[1]); ldOk = ld["@type"] === "ProfilePage" && ld.url === "https://app.joinsignl.com/c/caseyrivers" && ld.mainEntity && ld.mainEntity["@type"] === "Person" && ld.mainEntity.name === "Casey Rivers" && ld.mainEntity.alternateName === "@caseyrivers" && ld.mainEntity.image === "https://app.joinsignl.com/api/users/u1/photo" && ld.mainEntity.homeLocation.name === "Richmond"; } catch (e) { ldOk = false; }
  check("JSON-LD ProfilePage + Person parses with the public facts", ldOk);
  const hostileLd = hostile.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let hostileLdOk = false;
  try { hostileLdOk = !!hostileLd && !hostileLd[1].includes("</script") && JSON.parse(hostileLd[1]).mainEntity.name === 'A "B" <C>'; } catch (e) { hostileLdOk = false; }
  check("hostile name cannot break out of the JSON-LD script", hostileLdOk);

  part("http: fixtures");
  startServer();
  await waitUp();
  const admin = makeClient();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const complete = makeClient();
  const regComplete = await complete("POST", "/api/auth/register", {
    role: "creator", name: "Meta Owner", email: "metaowner@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", city: "Norfolk", handle: "metaowner",
    followerCount: 5100, localAudiencePct: 70, categories: ["Food & Drink"], ...AGREE,
  });
  check("complete creator registers", (regComplete.status === 200 || regComplete.status === 201) && !!regComplete.data.user, JSON.stringify(regComplete.data).slice(0, 200));
  await admin("POST", "/api/admin/review", { userId: regComplete.data.user.id, decision: "approve" });
  await complete("PATCH", "/api/me/profile", { publicPage: true });
  const incomplete = makeClient();
  const regIncomplete = await incomplete("POST", "/api/auth/register", {
    role: "creator", name: "Meta Incomplete", email: "metaincomplete@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", city: "Norfolk", handle: "metaincomplete",
    quickClaim: true, ...AGREE,
  });
  check("incomplete creator quick-claims (profile not complete)", (regIncomplete.status === 200 || regIncomplete.status === 201) && regIncomplete.data.user.creator.profileComplete === false, JSON.stringify(regIncomplete.data).slice(0, 250));
  await admin("POST", "/api/admin/review", { userId: regIncomplete.data.user.id, decision: "approve" });

  part("http: approved + complete page");
  const page = await makeClient()("GET", "/c/metaowner");
  check("page answers 200", page.status === 200);
  check("page title is the creator title", page.text.includes("<title>Meta Owner (@metaowner) on SIGNL | Virginia Beach</title>"), page.text.slice(0, 400));
  check("page robots is index, follow", page.text.includes('<meta name="robots" content="index, follow">'));
  check("page carries no noindex", !page.text.includes('content="noindex"'));
  check("page carries og:title + og:type profile", page.text.includes('<meta property="og:title"') && page.text.includes('<meta property="og:type" content="profile">'));
  check("page description names the founding pitch", page.text.includes("Meta Owner is a founding creator on SIGNL in Virginia Beach"));
  check("page description carries the local reach % (70 registered)", page.text.includes("70% of their audience is local."));
  check("page carries its own canonical + JSON-LD ProfilePage", page.text.includes(`<link rel="canonical" href="https://127.0.0.1:${PORT}/c/metaowner">`) && page.text.includes('application/ld+json') && page.text.includes('"ProfilePage"') && page.text.includes('"@metaowner"'));
  check("page still ships the SPA shell for humans", page.text.includes('<script src="/app.js"></script>'));
  const apiPub = await makeClient()("GET", "/api/c/metaowner");
  check("profile API agrees (200)", apiPub.status === 200 && apiPub.data.profile.handle === "metaowner");

  part("http: photo gallery (P2.1)");
  const uid = regComplete.data.user.id;
  const pngBase = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const pngOf = (tag) => Buffer.concat([Buffer.from(pngBase, "base64"), Buffer.from(tag)]);
  const up = (buf, slot) => complete("POST", "/api/me/photo", { dataUrl: "data:image/png;base64," + buf.toString("base64"), ...(slot === undefined ? {} : { slot }) });
  const loginRes = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "metaowner@fixtures.dev", password: "<MASKED_SECRET_002>" }) });
  const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
  const rawPhoto = async (p) => { const r = await fetch(BASE + p, { headers: { Cookie: cookie } }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; };
  const upLegacy = await up(pngOf("A"));
  check("legacy single upload still works and counts as photo 1", upLegacy.status === 200 && upLegacy.data.photoCount === 1, JSON.stringify(upLegacy.data).slice(0, 200));
  const up1 = await up(pngOf("B"), 1);
  const up2 = await up(pngOf("C"), 2);
  check("slots 1 and 2 extend the gallery to 3", up1.status === 200 && up1.data.photoCount === 2 && up2.status === 200 && up2.data.photoCount === 3, `${up1.status}/${up2.status}`);
  const pubG = await makeClient()("GET", "/api/c/metaowner");
  check("public payload carries the ordered photos array (cover first)", Array.isArray(pubG.data.profile.photos) && pubG.data.profile.photos.length === 3 && pubG.data.profile.photos[0].endsWith("/photo") && pubG.data.profile.photos[1].endsWith("/photo/1") && pubG.data.profile.photos[2].endsWith("/photo/2"), JSON.stringify(pubG.data.profile.photos));
  const g1 = await rawPhoto(`/api/users/${uid}/photo/1`);
  const g2 = await rawPhoto(`/api/users/${uid}/photo/2`);
  const g3 = await rawPhoto(`/api/users/${uid}/photo/3`);
  check("slot bytes serve in order; beyond the count 404s", g1.status === 200 && g1.buf.equals(pngOf("B")) && g2.status === 200 && g2.buf.equals(pngOf("C")) && g3.status === 404, `${g1.status}/${g2.status}/${g3.status}`);
  const cover2 = await complete("POST", "/api/me/photo/cover", { slot: 2 });
  const gCover = await rawPhoto(`/api/users/${uid}/photo`);
  const gSlot1 = await rawPhoto(`/api/users/${uid}/photo/1`);
  check("make-cover rotates the bytes: slot 2 becomes the cover", cover2.status === 200 && gCover.buf.equals(pngOf("C")) && gSlot1.buf.equals(pngOf("A")), `${cover2.status}`);
  const del1 = await complete("DELETE", "/api/me/photo/1");
  const gAfterDel = await rawPhoto(`/api/users/${uid}/photo/1`);
  check("remove shifts later photos down", del1.status === 200 && del1.data.photoCount === 2 && gAfterDel.buf.equals(pngOf("B")), `${del1.status} ${JSON.stringify(del1.data).slice(0, 120)}`);
  const skip = await up(pngOf("X"), 5);
  check("adding out of order is refused", skip.status === 400, String(skip.status));
  await up(pngOf("D"), 2); await up(pngOf("E"), 3); await up(pngOf("F"), 4);
  const up6 = await up(pngOf("G"), 5);
  const overCap = await up(pngOf("H"), 6);
  check("gallery caps at 6 photos", up6.status === 200 && up6.data.photoCount === 6 && overCap.status === 400, `${up6.status}/${overCap.status}`);
  const pubFull = await makeClient()("GET", "/api/c/metaowner");
  check("public payload shows all 6 photos", pubFull.data.profile.photos.length === 6, JSON.stringify(pubFull.data.profile.photos).slice(0, 200));
  const appJsText = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  check("client ships the gallery editor + profile gallery row", appJsText.includes("p-gallery") && appJsText.includes("galleryMakeCover") && appJsText.includes("Make cover") && appJsText.includes("Add photo") && appJsText.includes("galleryRowHtml"), "");

  part("http: incomplete claim page (Build -61) + unknown keep old behavior");
  const incPage = await makeClient()("GET", "/c/metaincomplete");
  check("incomplete claim page carries its own claim meta (title + OG so the bio link unfurls as the creator)", incPage.status === 200 && incPage.text.includes("<title>Meta Incomplete (@metaincomplete) on SIGNL | Virginia Beach</title>") && incPage.text.includes('<meta property="og:title"') && incPage.text.includes("Their booking page is live"), incPage.text.slice(0, 300));
  check("incomplete claim page stays noindex and carries no JSON-LD (indexing starts at the finished profile)", incPage.text.includes('<meta name="robots" content="noindex">') && !incPage.text.includes('content="index, follow"') && !incPage.text.includes("application/ld+json"), incPage.text.slice(0, 300));
  const incApi = await makeClient()("GET", "/api/c/metaincomplete");
  check("incomplete profile API serves the claim-tier payload (Build -61)", incApi.status === 200 && incApi.data.profile && incApi.data.profile.pageState === "claimed" && incApi.data.profile.handle === "metaincomplete", JSON.stringify(incApi.data).slice(0, 200));
  const unknownPage = await makeClient()("GET", "/c/neverexisted");
  check("unknown page is the plain shell", unknownPage.status === 200 && unknownPage.text.includes('<meta name="robots" content="noindex">') && !unknownPage.text.includes("og:title"));
  const unknownApi = await makeClient()("GET", "/api/c/neverexisted");
  check("unknown profile API keeps 404", unknownApi.status === 404);
  const proofPage = await makeClient()("GET", "/c/metaowner/proof");
  check("proof path keeps the plain shell (SPA renders it)", proofPage.status === 200 && proofPage.text.includes('<meta name="robots" content="noindex">') && !proofPage.text.includes("og:title"));

  part("http: robots.txt");
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  check("robots.txt explicitly allows /c/", robots.includes("Allow: /c/") && robots.includes("Disallow: /api/"), robots);
} finally {
  await stopServer();
}

console.log(`\nverify-profilemeta: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
