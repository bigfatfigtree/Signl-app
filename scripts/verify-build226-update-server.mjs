#!/usr/bin/env node
// Build -226 UPDATE PASS server verification: favorites both
// ways (business saves creators, creator saves businesses and
// offers), saved state on the me / feed / profile payloads, the
// business photo gallery mirroring the creator gallery, the
// match explainer object (one engine, briefed and default
// briefs), the channels payload carrying per-platform local
// counts inputs, and the reviewer fix for the business stats
// date range (the `to` day is inclusive end-of-day).
//
// Run: node scripts/verify-build226-update-server.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8997;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-226u-"));
const dbFile = path.join(tmp, "db.json");
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
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
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const part of setCookie.split(/,(?=[^;]+=)/)) {
      const m = part.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* binary or html */ }
    return { status: res.status, data, text };
  }
  api.raw = async function raw(method, p) {
    const headers = {};
    const cookie = cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers });
    return { status: res.status, text: await res.text(), contentType: res.headers.get("content-type") || "" };
  };
  return api;
}
const uniq = () => Math.random().toString(36).slice(2, 9);
let n = 0;
function creatorPayload(overrides = {}) {
  n += 1;
  return {
    role: "creator", name: `Creator226U ${n}`, email: `c226u-${n}-${uniq()}@fixtures.dev`, password: "<redacted>",
    market: "Hampton Roads", city: "Norfolk", handle: `c226u_${n}_${uniq()}`, categories: ["Food & Drink"],
    compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 3000, avgViews: 900,
    localAudiencePct: 62, bio: "", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
    ...overrides,
  };
}
async function registerCreator(overrides = {}) {
  const c = makeClient();
  const payload = creatorPayload(overrides);
  const r = await c("POST", "/api/auth/register", payload);
  return { client: c, payload, res: r, user: r.data && r.data.user, email: payload.email };
}
async function registerBusiness(admin, businessName) {
  const c = makeClient();
  const email = `biz226u-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", email, password: "<redacted>", market: "Hampton Roads", city: "Norfolk",
    businessName, category: "Restaurant", planId: "self-service", agreedTerms: true, agreedPostCompliance: true,
  });
  if (r.status === 201) {
    await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
    await admin("POST", "/api/admin/businesses/activate", { userId: r.data.user.id });
  }
  return { client: c, res: r, user: r.data && r.data.user, email };
}
async function adminClient() {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error("admin login failed: " + r.status);
  return c;
}
async function approve(admin, userId) { await admin("POST", "/api/admin/review", { userId, decision: "approve" }); }
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPG_B64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const WEBP_B64 = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
const pngUrl = `data:image/png;base64,${PNG_B64}`;
const jpgUrl = `data:image/jpeg;base64,${JPG_B64}`;
const webpUrl = `data:image/webp;base64,${WEBP_B64}`;

try {
  startServer();
  await waitUp();
  const admin = await adminClient();
  const biz = await registerBusiness(admin, "Update Kitchen");
  const bizC = biz.client;
  check("business registered + activated", biz.res.status === 201);
  const biz2 = await registerBusiness(admin, "Second Update Kitchen");
  const biz2C = biz2.client;

  const cA = await registerCreator({});
  await approve(admin, cA.user.id);
  const patchA = await cA.client("PATCH", "/api/me/profile", {
    audienceStack: { instagram: 3000, tiktok: 5000 },
    platformLocalPct: { instagram: 62, tiktok: 80 },
    paidRate: 200,
  });
  check("creator A profile carries the two-platform stack", patchA.status === 200, JSON.stringify(patchA.data).slice(0, 200));
  const cB = await registerCreator({});
  await approve(admin, cB.user.id);
  await stopServer();
  editDb((db) => {
    for (const reg of [cA, cB]) {
      const u = db[`user:${reg.user.id}`];
      if (u && u.creator) u.creator.maxVisitsPerWeek = 7;
    }
    const ua = db[`user:${cA.user.id}`];
    if (ua && ua.creator) ua.creator.publicPage = true;
  });
  startServer(); await waitUp();

  part("channels payload: followers + localPct per platform");
  const disc0 = await bizC("GET", "/api/discover?market=Hampton%20Roads");
  const cardA0 = (disc0.data.creators || []).find((c) => c.userId === cA.user.id);
  check("channels carry followers + localPct per platform (local counts are derivable)", !!cardA0 && Array.isArray(cardA0.channels)
    && cardA0.channels.some((ch) => ch.platform === "instagram" && ch.followers === 3000 && ch.localPct === 62)
    && cardA0.channels.some((ch) => ch.platform === "tiktok" && ch.followers === 5000 && ch.localPct === 80),
    JSON.stringify(cardA0 && cardA0.channels).slice(0, 250));

  part("business gallery: add, cover, remove, serve");
  const up0 = await bizC("POST", "/api/me/photo", { dataUrl: pngUrl });
  check("legacy no-slot upload still writes the cover (photoCount 1)", up0.status === 200 && up0.data.photoCount === 1 && Array.isArray(up0.data.photos) && up0.data.photos.length === 1, `${up0.status} ${JSON.stringify(up0.data).slice(0, 150)}`);
  const up1 = await bizC("POST", "/api/me/photo", { dataUrl: jpgUrl, slot: 1 });
  check("slot 1 appends", up1.status === 200 && up1.data.photoCount === 2, `${up1.status} ${JSON.stringify(up1.data).slice(0, 150)}`);
  const up2 = await bizC("POST", "/api/me/photo", { dataUrl: webpUrl, slot: 2 });
  check("slot 2 appends: 3 photos, first is the cover URL, slots in order", up2.status === 200 && up2.data.photoCount === 3
    && up2.data.photos[0] === `/api/users/${biz.user.id}/photo`
    && up2.data.photos[1] === `/api/users/${biz.user.id}/photo/1`
    && up2.data.photos[2] === `/api/users/${biz.user.id}/photo/2`, JSON.stringify(up2.data).slice(0, 200));
  const meBiz = await bizC("GET", "/api/auth/me");
  check("the business record payload (publicUser) carries photos in the same shape", !!meBiz.data.user.business && Array.isArray(meBiz.data.user.business.photos) && meBiz.data.user.business.photos.length === 3, JSON.stringify(meBiz.data.user.business && meBiz.data.user.business.photos));
  const serve0 = await cA.client.raw("GET", `/api/users/${biz.user.id}/photo`);
  const serve1 = await cA.client.raw("GET", `/api/users/${biz.user.id}/photo/1`);
  const serve2 = await cA.client.raw("GET", `/api/users/${biz.user.id}/photo/2`);
  check("gallery serves to a signed-in user in order (png, jpeg, webp)", serve0.status === 200 && serve0.contentType.includes("image/png") && serve1.contentType.includes("image/jpeg") && serve2.contentType.includes("image/webp"), `${serve0.contentType} ${serve1.contentType} ${serve2.contentType}`);
  const serveAnon = await makeClient().raw("GET", `/api/users/${biz.user.id}/photo/1`);
  check("business gallery stays signed-in only (anonymous 401)", serveAnon.status === 401, `${serveAnon.status}`);
  const cover = await bizC("POST", "/api/me/photo/cover", { slot: 2 });
  check("make-cover rotates slot 2 to the cover", cover.status === 200 && cover.data.photoCount === 3, `${cover.status}`);
  const serveCover = await cA.client.raw("GET", `/api/users/${biz.user.id}/photo`);
  const serveAfter1 = await cA.client.raw("GET", `/api/users/${biz.user.id}/photo/1`);
  check("after make-cover the cover serves webp and slot 1 serves the old cover png", serveCover.contentType.includes("image/webp") && serveAfter1.contentType.includes("image/png"), `${serveCover.contentType} ${serveAfter1.contentType}`);
  const rem = await bizC("DELETE", "/api/me/photo/0");
  check("remove slot 0 shifts the rest down (photoCount 2)", rem.status === 200 && rem.data.photoCount === 2 && rem.data.photos.length === 2, `${rem.status} ${JSON.stringify(rem.data).slice(0, 150)}`);
  const serveR0 = await cA.client.raw("GET", `/api/users/${biz.user.id}/photo`);
  const serveR1 = await cA.client.raw("GET", `/api/users/${biz.user.id}/photo/1`);
  const serveR2 = await cA.client.raw("GET", `/api/users/${biz.user.id}/photo/2`);
  check("after remove, cover is png, slot 1 is jpeg, slot 2 is gone (404)", serveR0.contentType.includes("image/png") && serveR1.contentType.includes("image/jpeg") && serveR2.status === 404, `${serveR0.contentType} ${serveR1.contentType} ${serveR2.status}`);
  const creatorPhoto = await cA.client("POST", "/api/me/photo", { dataUrl: pngUrl });
  check("the creator gallery path is untouched by the business branch", creatorPhoto.status === 200 && creatorPhoto.data.photoCount >= 1, `${creatorPhoto.status}`);

  part("business profile payload: photos + fit + saved state");
  const bp0 = await cA.client("GET", `/api/businesses/${biz.user.id}`);
  check("business profile serves photos in order (2 after the remove)", bp0.status === 200 && !!bp0.data.business && Array.isArray(bp0.data.business.photos) && bp0.data.business.photos.length === 2 && bp0.data.business.photoUrl === bp0.data.business.photos[0], `${bp0.status} ${JSON.stringify(bp0.data).slice(0, 200)}`);
  check("business profile carries fit for a creator viewer (score 0 to 100)", !!bp0.data.business.fit && typeof bp0.data.business.fit.score === "number" && bp0.data.business.fit.score >= 0 && bp0.data.business.fit.score <= 100 && Array.isArray(bp0.data.business.fit.reasons), JSON.stringify(bp0.data.business.fit));
  check("business profile starts unsaved for this creator", bp0.data.business.viewerSaved === false, JSON.stringify(bp0.data.business.viewerSaved));

  part("favorites: business saves a creator (legacy + kind shapes)");
  const favLegacy = await bizC("POST", "/api/favorites", { creatorId: cA.user.id });
  check("legacy POST { creatorId } toggles on and answers isFavorite", favLegacy.status === 200 && favLegacy.data.isFavorite === true, `${favLegacy.status} ${JSON.stringify(favLegacy.data).slice(0, 150)}`);
  const meBiz2 = await bizC("GET", "/api/auth/me");
  check("savedIds ride /auth/me for the business", !!meBiz2.data.user.savedIds && meBiz2.data.user.savedIds.creators.includes(cA.user.id), JSON.stringify(meBiz2.data.user.savedIds));
  const disc1 = await bizC("GET", "/api/discover?market=Hampton%20Roads");
  const cardA1 = (disc1.data.creators || []).find((c) => c.userId === cA.user.id);
  check("the discovery card shows viewerSaved + isFavorite for the saved creator", !!cardA1 && cardA1.viewerSaved === true && cardA1.isFavorite === true, JSON.stringify(cardA1 && { v: cardA1.viewerSaved, f: cardA1.isFavorite }));
  const favListB = await bizC("GET", "/api/favorites");
  check("GET /favorites answers the legacy favorites cards plus savedIds", favListB.status === 200 && (favListB.data.favorites || []).some((c) => c.userId === cA.user.id) && favListB.data.savedIds.creators.includes(cA.user.id), JSON.stringify(favListB.data.savedIds));
  const favOff = await bizC("POST", "/api/favorites", { kind: "creator", id: cA.user.id });
  check("POST { kind: creator, id } toggles off", favOff.status === 200 && favOff.data.saved === false && favOff.data.isFavorite === false, JSON.stringify(favOff.data).slice(0, 150));
  const favOn = await bizC("POST", "/api/favorites", { kind: "creator", id: cA.user.id, saved: true });
  check("POST with saved: true sets without toggling", favOn.status === 200 && favOn.data.saved === true, JSON.stringify(favOn.data).slice(0, 150));
  const favRemove = await bizC("POST", "/api/favorites/remove", { kind: "creator", id: cA.user.id });
  check("POST /favorites/remove unsaves explicitly", favRemove.status === 200 && favRemove.data.saved === false, JSON.stringify(favRemove.data).slice(0, 150));
  const favListB2 = await bizC("GET", "/api/favorites");
  check("the unsaved creator is gone from the list and savedIds", !(favListB2.data.favorites || []).some((c) => c.userId === cA.user.id) && !favListB2.data.savedIds.creators.includes(cA.user.id), JSON.stringify(favListB2.data.savedIds));
  await bizC("POST", "/api/favorites", { creatorId: cA.user.id });

  part("favorites: creator saves a business and an offer");
  const openOff = await bizC("POST", "/api/offers", { spots: 1, title: "Saved call 226U", whatComped: "Meal for two, on us", dollarCap: 100 });
  check("open offer created", openOff.status === 201 && !!openOff.data.offer, `${openOff.status} ${JSON.stringify(openOff.data).slice(0, 150)}`);
  const offerId = openOff.data.offer.id;
  // The board fences offers from markets that are not live
  // (Build -162) and holds fresh open offers in the 24 hour
  // Charter window when the market IS live, so the fixture
  // flags the market live and ages the offer past the window.
  await stopServer();
  editDb((db) => {
    db["config:markets"] = { flags: { "Hampton Roads": true } };
    const off = db[`offer:${offerId}`];
    if (off) {
      const past = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
      off.createdAt = past;
      if (off.publishedAt) off.publishedAt = past;
    }
  });
  startServer(); await waitUp();
  const saveBiz = await cA.client("POST", "/api/favorites", { kind: "business", id: biz.user.id });
  check("creator saves the business", saveBiz.status === 200 && saveBiz.data.saved === true && saveBiz.data.savedIds.businesses.includes(biz.user.id), `${saveBiz.status} ${JSON.stringify(saveBiz.data).slice(0, 200)}`);
  const board0 = await cA.client("GET", "/api/open-offers");
  const boardCard0 = (board0.data.offers || []).find((o) => o.id === offerId);
  check("the offer board card starts unsaved, with the business saved and the gallery riding", !!boardCard0 && boardCard0.viewerSaved === false && boardCard0.businessViewerSaved === true && Array.isArray(boardCard0.businessPhotos) && boardCard0.businessPhotos.length === 2, JSON.stringify(boardCard0 && { v: boardCard0.viewerSaved, b: boardCard0.businessViewerSaved, p: boardCard0.businessPhotos }));
  const saveOffer = await cA.client("POST", "/api/favorites", { kind: "offer", id: offerId });
  check("creator saves the offer", saveOffer.status === 200 && saveOffer.data.saved === true && saveOffer.data.savedIds.offers.includes(offerId), `${saveOffer.status} ${JSON.stringify(saveOffer.data).slice(0, 200)}`);
  const board1 = await cA.client("GET", "/api/open-offers");
  const boardCard1 = (board1.data.offers || []).find((o) => o.id === offerId);
  check("the offer board card now shows viewerSaved", !!boardCard1 && boardCard1.viewerSaved === true, JSON.stringify(boardCard1 && boardCard1.viewerSaved));
  const favListC = await cA.client("GET", "/api/favorites");
  check("GET /favorites for the creator carries the business card with photos", favListC.status === 200 && (favListC.data.businesses || []).some((b) => b.businessId === biz.user.id && Array.isArray(b.photos) && b.photos.length === 2 && b.viewerSaved === true), JSON.stringify(favListC.data.businesses).slice(0, 250));
  check("GET /favorites for the creator carries the offer card with terms", (favListC.data.offers || []).some((o) => o.id === offerId && o.viewerSaved === true && !!o.terms), JSON.stringify(favListC.data.offers).slice(0, 250));
  const meC = await cA.client("GET", "/api/auth/me");
  check("savedIds ride /auth/me for the creator (business + offer)", !!meC.data.user.savedIds && meC.data.user.savedIds.businesses.includes(biz.user.id) && meC.data.user.savedIds.offers.includes(offerId), JSON.stringify(meC.data.user.savedIds));
  const bp1 = await cA.client("GET", `/api/businesses/${biz.user.id}`);
  check("the business profile shows the business and its offer as saved", bp1.status === 200 && bp1.data.business.viewerSaved === true && (bp1.data.business.openOffers || []).some((o) => o.id === offerId && o.viewerSaved === true), JSON.stringify(bp1.data.business && bp1.data.business.openOffers).slice(0, 200));
  const unsaveOffer = await cA.client("DELETE", "/api/favorites", { kind: "offer", id: offerId });
  check("DELETE /favorites unsaves the offer", unsaveOffer.status === 200 && unsaveOffer.data.saved === false, `${unsaveOffer.status} ${JSON.stringify(unsaveOffer.data).slice(0, 150)}`);
  const favListC2 = await cA.client("GET", "/api/favorites");
  check("the unsaved offer is gone, the business stays saved", !(favListC2.data.offers || []).some((o) => o.id === offerId) && (favListC2.data.businesses || []).some((b) => b.businessId === biz.user.id), JSON.stringify(favListC2.data.savedIds));

  part("favorites: role guards");
  const guard1 = await cA.client("POST", "/api/favorites", { kind: "creator", id: cB.user.id });
  check("a creator cannot save a creator (403)", guard1.status === 403, `${guard1.status}`);
  const guard2 = await bizC("POST", "/api/favorites", { kind: "business", id: biz2.user.id });
  check("a business cannot save a business (403)", guard2.status === 403, `${guard2.status}`);
  const guard3 = await bizC("POST", "/api/favorites", { kind: "offer", id: offerId });
  check("a business cannot save an offer (403)", guard3.status === 403, `${guard3.status}`);
  const guard4 = await cA.client("POST", "/api/favorites", { kind: "offer", id: "no-such-offer" });
  check("saving a missing offer is a 404", guard4.status === 404, `${guard4.status}`);

  part("match: default brief on cards, briefed score unchanged, profile payloads");
  const discM = await bizC("GET", "/api/discover?market=Hampton%20Roads");
  const cardM = (discM.data.creators || []).find((c) => c.userId === cA.user.id);
  check("no brief: the card carries match with defaultBrief and no ranking fields", !!cardM && !!cardM.match && cardM.match.defaultBrief === true && cardM.matchScore == null && cardM.matchReasons == null, JSON.stringify(cardM && cardM.match).slice(0, 200));
  check("match score is 0 to 100 with reason lines", !!cardM && typeof cardM.match.score === "number" && cardM.match.score >= 0 && cardM.match.score <= 100 && Array.isArray(cardM.match.reasons) && cardM.match.reasons.length > 0, JSON.stringify(cardM && cardM.match).slice(0, 250));
  check("match inputs are the five explainer inputs in sheet order", !!cardM && Array.isArray(cardM.match.inputs) && cardM.match.inputs.map((i) => i.key).join(",") === "local,category,budget,reliability,momentum", JSON.stringify(cardM && cardM.match.inputs));
  check("the local input value is the creator share in this market (62)", !!cardM && cardM.match.inputs[0].value === 62, JSON.stringify(cardM && cardM.match.inputs[0]));
  const discBrief = await bizC("GET", "/api/discover?market=Hampton%20Roads&sort=match&budget=300&category=Food%20%26%20Drink");
  const cardBrief = (discBrief.data.creators || []).find((c) => c.userId === cA.user.id);
  check("briefed: matchScore is set and match.score equals it (one engine)", !!cardBrief && typeof cardBrief.matchScore === "number" && !!cardBrief.match && cardBrief.match.score === cardBrief.matchScore && !cardBrief.match.defaultBrief, JSON.stringify(cardBrief && { s: cardBrief.matchScore, m: cardBrief.match && cardBrief.match.score }));
  check("briefed: matchReasons ride the card and mirror match.reasons", !!cardBrief && Array.isArray(cardBrief.matchReasons) && cardBrief.matchReasons.length > 0 && JSON.stringify(cardBrief.matchReasons) === JSON.stringify(cardBrief.match.reasons), JSON.stringify(cardBrief && cardBrief.matchReasons));
  const pubBiz = await bizC("GET", `/api/c/${cA.payload.handle}`);
  check("the public profile for a business viewer carries the match object", pubBiz.status === 200 && !!pubBiz.data.profile && !!pubBiz.data.profile.match && typeof pubBiz.data.profile.match.score === "number" && Array.isArray(pubBiz.data.profile.match.inputs) && pubBiz.data.profile.match.inputs.length === 5, `${pubBiz.status} ${JSON.stringify(pubBiz.data).slice(0, 250)}`);
  check("the business viewer sees the saved state on the profile", !!pubBiz.data.profile && pubBiz.data.profile.viewerSaved === true, JSON.stringify(pubBiz.data.profile && pubBiz.data.profile.viewerSaved));
  check("the profile match score equals the discovery default-brief score (same inputs, same engine)", !!pubBiz.data.profile && !!cardM && pubBiz.data.profile.match.score === cardM.match.score, `${pubBiz.data.profile && pubBiz.data.profile.match && pubBiz.data.profile.match.score} vs ${cardM && cardM.match.score}`);
  const pubAnon = await makeClient()("GET", `/api/c/${cA.payload.handle}`);
  check("the public profile for a logged-out viewer carries no match (no brief exists)", pubAnon.status === 200 && !!pubAnon.data.profile && pubAnon.data.profile.match === null && pubAnon.data.profile.viewerSaved === false, `${pubAnon.status} ${JSON.stringify(pubAnon.data).slice(0, 200)}`);

  part("reviewer fix: business stats range includes the full to day");
  const offS = await biz2C("POST", "/api/offers", { spots: 1, creatorId: cB.user.id, title: "Range visit 226U", whatComped: "Meal for one, on us", dollarCap: 50 });
  check("range fixture offer created", offS.status === 201, `${offS.status}`);
  const accS = await cB.client("POST", `/api/offers/${offS.data.offer.id}/accept`, {});
  check("range fixture visit accepted", accS.status === 201, `${accS.status}`);
  const confS = await biz2C("POST", `/api/bookings/${accS.data.booking.id}/confirm`, {});
  check("range fixture visit redeemed today", confS.status === 200 && !!confS.data.booking.redeemedAt, `${confS.status}`);
  await biz2C("POST", `/api/bookings/${accS.data.booking.id}/code-uses`, { amount: 40 });
  await biz2C("POST", `/api/bookings/${accS.data.booking.id}/code-uses`, { amount: 40 });
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const statsAll = await biz2C("GET", "/api/business/stats");
  check("unranged stats count today's visit (2 customers, $80)", statsAll.status === 200 && statsAll.data.totals.countedCustomers >= 2 && statsAll.data.totals.registerSpendCents >= 8000, JSON.stringify(statsAll.data.totals).slice(0, 200));
  const statsRanged = await biz2C("GET", `/api/business/stats?from=${monthAgo}&to=${today}`);
  check("ranged stats (from 30 days ago to today) count the visit that happened ON the to day", statsRanged.status === 200 && statsRanged.data.totals.bookings >= 1 && statsRanged.data.totals.countedCustomers >= 2 && statsRanged.data.totals.registerSpendCents >= 8000, JSON.stringify(statsRanged.data.totals).slice(0, 200));
  const statsToday = await biz2C("GET", `/api/business/stats?from=${today}&to=${today}`);
  check("a same-day range (from = to = today) still counts today's visit", statsToday.status === 200 && statsToday.data.totals.bookings >= 1 && statsToday.data.totals.countedCustomers >= 2, JSON.stringify(statsToday.data.totals).slice(0, 200));
  const statsFuture = await biz2C("GET", `/api/business/stats?from=${tomorrow}&to=${tomorrow}`);
  check("a future range stays empty (the fix did not widen the range)", statsFuture.status === 200 && statsFuture.data.totals.bookings === 0, JSON.stringify(statsFuture.data.totals).slice(0, 150));
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nBuild -226 update pass server verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
