// Build -178 verification: Magpie NATIONAL BUSINESS ACCOUNTS.
// Two layers:
//   1. Pure unit checks on lib/national.js — the feed fence
//      conditions (spec §4.1), publish gates (§5.2), sentinel
//      helpers (§7), website validation, deadline auto-close (§13).
//   2. API end-to-end against the dev server in production shape:
//      admin creates a national account -> approve -> activate ->
//      verify -> the brand publishes -> creators in a listed
//      market AND an unlisted city see it and raise hands ->
//      picks, completion close-out, fulfillment, discovery,
//      shortlist, reports, conversion rules, moderation, and the
//      market-integrity checks (no "National" row in admin market
//      counts, local-list empty for the sentinel, checkout refused).
// Run: node scripts/verify-build178.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const national = require("../netlify/functions/lib/national.js");

const PORT = 8931;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "build178-admin-pass";
const DB = path.join(os.tmpdir(), `signl-verify-build178-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

// ---------------- unit checks (pure) ----------------
console.log("== unit: scope + sentinel helpers ==");
check("absent scope reads market", national.businessScopeOf({ role: "business", business: {} }) === "market");
check("scope national reads national", national.businessScopeOf({ role: "business", business: { scope: "national" } }) === "national");
check("isNationalBusiness true", national.isNationalBusiness({ role: "business", business: { scope: "national" } }) === true);
check("isNationalBusiness false for creator", national.isNationalBusiness({ role: "creator", business: { scope: "national" } }) === false);
check("sentinel market detected", national.isNationalSentinelMarket("National") === true && national.isNationalSentinelMarket("Nashville") === false);
check("countsTowardMarket excludes sentinel", national.countsTowardMarket({ market: "National" }) === false && national.countsTowardMarket({ market: "Nashville" }) === true);
check("focus markets drop the sentinel + unknowns", JSON.stringify(national.cleanFocusMarkets(["Nashville", "National", "Atlantis", "Miami"])) === JSON.stringify(["Nashville", "Miami"]), JSON.stringify(national.cleanFocusMarkets(["Nashville", "National", "Miami"])));
check("website validation accepts a real host", national.validateWebsiteUrl("https://tropicaloasis.example.com/shop").ok === true);
check("website validation refuses junk", national.validateWebsiteUrl("not a website").ok === false && national.validateWebsiteUrl("").ok === false);
check("deadline auto-close on read", national.campaignStatusOnRead({ status: "open", raiseByAt: "2020-01-01T00:00:00.000Z" }, Date.parse("2020-01-02T00:00:00.000Z")) === "closed");
check("open before deadline stays open", national.campaignStatusOnRead({ status: "open", raiseByAt: "2999-01-01T00:00:00.000Z" }) === "open");

console.log("== unit: the feed fence (spec 4.1) ==");
const depsStub = { profileCompleteOf: (u) => !!u._complete, isTester: (u) => !!u.tester };
const brandOk = { role: "business", status: "approved", business: { scope: "national", verifiedAt: "2026-11-16T00:00:00.000Z" } };
const creatorOk = { role: "creator", status: "approved", _complete: true };
const campOk = { status: "open", businessId: "b1" };
check("fence: approved + finished + verified brand = visible", national.campaignVisibleToCreator(campOk, brandOk, creatorOk, depsStub) === true);
check("fence: unverified brand = hidden", national.campaignVisibleToCreator(campOk, { ...brandOk, business: { scope: "national", verifiedAt: null } }, creatorOk, depsStub) === false);
check("fence: unfinished profile = hidden", national.campaignVisibleToCreator(campOk, brandOk, { ...creatorOk, _complete: false }, depsStub) === false);
check("fence: pending creator = hidden", national.campaignVisibleToCreator(campOk, brandOk, { ...creatorOk, status: "pending" }, depsStub) === false);
check("fence: sample campaign = hidden for everyone", national.campaignVisibleToCreator({ ...campOk, sample: true }, brandOk, creatorOk, depsStub) === false);
check("fence: testOnly reaches testers only", national.campaignVisibleToCreator({ ...campOk, testOnly: true }, brandOk, { ...creatorOk, tester: true }, depsStub) === true && national.campaignVisibleToCreator({ ...campOk, testOnly: true }, brandOk, creatorOk, depsStub) === false);
check("fence: tester creator fenced from real campaigns", national.campaignVisibleToCreator(campOk, brandOk, { ...creatorOk, tester: true }, depsStub) === false);
check("fence: tester-owned brand fenced", national.campaignVisibleToCreator(campOk, { ...brandOk, tester: true }, creatorOk, depsStub) === false);
check("fence: draft campaign hidden", national.campaignVisibleToCreator({ ...campOk, status: "draft" }, brandOk, creatorOk, depsStub) === false);
check("fence: market business brand cannot run a national campaign", national.campaignVisibleToCreator(campOk, { role: "business", status: "approved", business: { scope: "market", verifiedAt: "x" } }, creatorOk, depsStub) === false);

console.log("== unit: publish gates + record shape ==");
const bizFull = { role: "business", status: "approved", business: { scope: "national", accessState: "active", verifiedAt: "2026-11-16T00:00:00.000Z", logoUrl: "https://x.example.com/logo.png", website: "https://x.example.com" } };
const campFull = { title: "Try our vitamins, free", whatYouGet: "3 products of your choice, free", whatWeAsk: "Post 1 video and tag us", picksCount: 2, raiseByAt: "2999-01-01T00:00:00.000Z" };
check("publish gates pass a complete setup", national.publishGateErrors(campFull, bizFull).length === 0, JSON.stringify(national.publishGateErrors(campFull, bizFull)));
check("publish gate names the missing logo", national.publishGateErrors(campFull, { ...bizFull, business: { ...bizFull.business, logoUrl: "" } }).some((e) => /logo/i.test(e)));
check("publish gate names the missing website", national.publishGateErrors(campFull, { ...bizFull, business: { ...bizFull.business, website: "" } }).some((e) => /website/i.test(e)));
check("publish gate blocks unverified", national.publishGateErrors(campFull, { ...bizFull, business: { ...bizFull.business, verifiedAt: null } }).some((e) => /verified/i.test(e)));
check("publish gate blocks founding (not activated)", national.publishGateErrors(campFull, { ...bizFull, business: { ...bizFull.business, accessState: "founding" } }).length > 0);
check("publish gate blocks a past deadline", national.publishGateErrors({ ...campFull, raiseByAt: "2020-01-01T00:00:00.000Z" }, bizFull).some((e) => /deadline|future/i.test(e)));
check("publish gate blocks vague whatYouGet", national.publishGateErrors({ ...campFull, whatYouGet: "stuff" }, bizFull).length > 0);
const built = national.buildNationalBusinessUser({ email: "brand@fixtures.dev", businessName: "Fixture Brand Co", brandName: "Fixture Brand", website: "https://fixturebrand.example.com", about: "We make things.", focusMarkets: ["Nashville", "National"] }, { nowIso: () => "2026-11-16T00:00:00.000Z", termsVersion: "t1", managedTalentBudgetDefault: 500 });
check("built record: sentinel market + scope national", built.market === "National" && built.business.scope === "national");
check("built record: plan is null, no plan name/price", built.business.plan === null && built.business.planName === null && built.business.planPriceMonthly === null);
check("built record: pending + founding, brand fields set", built.status === "pending" && built.business.accessState === "founding" && built.business.brandName === "Fixture Brand" && built.business.website.includes("fixturebrand.example.com"));
check("built record: focus markets exclude the sentinel", JSON.stringify(built.business.focusMarkets) === JSON.stringify(["Nashville"]));
check("built record: verifiedAt null at birth", built.business.verifiedAt === null);

// ---------------- API end-to-end ----------------
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
    return { status: res.status, data };
  }
  return call;
}
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
function readDb() { return JSON.parse(fs.readFileSync(DB, "utf8")); }
function setPassword(userId, password) {
  const db = readDb();
  const rec = db[`user:${userId}`];
  const salt = crypto.randomBytes(16).toString("hex");
  rec.passwordSalt = salt;
  rec.passwordHash = crypto.scryptSync(password, salt, 64).toString("hex");
  fs.writeFileSync(DB, JSON.stringify(db, null, 1));
}

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  console.log("== api: admin creates the national account ==");
  const create = await admin("POST", "/api/admin/national/accounts", {
    email: "oasis@fixtures.dev", businessName: "Fixture Nutrition Inc", brandName: "Fixture Oasis",
    website: "https://fixtureoasis.example.com", about: "Liquid vitamins and collagen, shipped nationwide.",
    focusMarkets: ["Nashville", "Miami"], currency: "USD", country: "United States",
  });
  check("admin create national account -> 201", create.status === 201, JSON.stringify(create.data).slice(0, 200));
  const natId = create.data.account && create.data.account.id;
  check("account view: scope national, market sentinel, plan null", create.data.account.scope === "national" && create.data.account.market === "National" && create.data.account.plan === null);
  const dupe = await admin("POST", "/api/admin/national/accounts", { email: "oasis@fixtures.dev", businessName: "Fixture Nutrition Inc", website: "https://fixtureoasis.example.com" });
  check("one email = one account: duplicate create -> 409", dupe.status === 409, String(dupe.status));

  // Approve + activate through the EXISTING business pipeline.
  const appr = await admin("POST", "/api/admin/review", { userId: natId, decision: "approve" });
  check("existing review pipeline approves the national account", appr.status === 200 && appr.data.user.status === "approved" && appr.data.user.business.scope === "national", JSON.stringify(appr.data).slice(0, 160));
  const act = await admin("POST", "/api/admin/businesses/activate", { userId: natId });
  check("existing activation opens the national account", act.status === 200 && act.data.user.business.accessState === "active", JSON.stringify(act.data).slice(0, 160));

  console.log("== api: verification gate ==");
  const badVerify = await admin("POST", `/api/admin/national/accounts/${natId}/verify`, { checklist: { websiteResolves: true } });
  check("verify refuses an incomplete checklist", badVerify.status === 400, String(badVerify.status));
  const verify = await admin("POST", `/api/admin/national/accounts/${natId}/verify`, { checklist: { websiteResolves: true, nameMatches: true, storeExists: true } });
  check("verify stamps verifiedAt/verifiedBy", verify.status === 200 && !!verify.data.account.verified && !!verify.data.account.verifiedAt, JSON.stringify(verify.data).slice(0, 160));

  // Give the account a password and sign in as the brand.
  await stopServer();
  setPassword(natId, "oasis-pass-1234");
  startServer();
  check("server restarts", await waitUp());
  const brand = client();
  const brandLogin = await brand("POST", "/api/auth/login", { email: "oasis@fixtures.dev", password: "oasis-pass-1234" });
  check("national brand signs in", brandLogin.status === 200, JSON.stringify(brandLogin.data).slice(0, 120));
  const brandMe = await brand("GET", "/api/auth/me");
  check("/auth/me: plan null and nothing renders a price", brandMe.data.user.business.plan === null && brandMe.data.user.business.planName === null && brandMe.data.user.business.planPriceMonthly === null);
  const natMe = await brand("GET", "/api/national/me");
  check("/national/me: national summary, plan null", natMe.status === 200 && natMe.data.account.scope === "national" && natMe.data.account.plan === null && natMe.data.account.verified === true, JSON.stringify(natMe.data).slice(0, 200));

  console.log("== api: campaign composer + publish gates ==");
  const draft = await brand("POST", "/api/national/campaigns", { title: "Try our liquid vitamins, free", whatYouGet: "3 Fixture Oasis products of your choice, free", whatWeAsk: "Post 1 video and 1 story about your honest experience, and tag the brand.", picksCount: 2, raiseByAt: "2999-01-01T00:00:00.000Z", details: "We ship within a week of your pick. Post within a week of delivery.", categories: ["Health & Wellness"] });
  check("draft saves freely", draft.status === 201 && draft.data.campaign.status === "draft", JSON.stringify(draft.data).slice(0, 160));
  const campId = draft.data.campaign.id;
  const pubNoLogo = await brand("POST", `/api/national/campaigns/${campId}/publish`, {});
  check("publish refuses without a logo, naming it", pubNoLogo.status === 400 && /logo/i.test(pubNoLogo.data.error || ""), JSON.stringify(pubNoLogo.data));
  const profSave = await brand("PATCH", "/api/me/profile", { logoUrl: "https://fixtureoasis.example.com/logo.png", brandAbout: "Liquid vitamins and collagen that ship across the country." });
  check("brand profile editor saves logo + brandAbout", profSave.status === 200, JSON.stringify(profSave.data).slice(0, 160));
  const pub = await brand("POST", `/api/national/campaigns/${campId}/publish`, {});
  check("publish opens the campaign once gates pass", pub.status === 200 && pub.data.campaign.status === "open", JSON.stringify(pub.data).slice(0, 160));

  console.log("== api: creators (listed market + unlisted city) ==");
  async function makeCreator(email, handle, marketOpts) {
    const c = client();
    const reg = await c("POST", "/api/auth/register", {
      role: "creator", name: handle, email, password: "creator-pass-123",
      handle, followerCount: 6000, localAudiencePct: 60, categories: ["Health & Wellness"],
      agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
      ...marketOpts,
    });
    if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
    await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
    return { client: c, id: reg.data.user.id };
  }
  const cNash = await makeCreator("nash@fixtures.dev", "nashcreator", { market: "Nashville", city: "Nashville" });
  const cUnlisted = await makeCreator("tulsa@fixtures.dev", "tulsacreator", { market: "Not listed yet", customCity: "Tulsa", customCountry: "United States", customState: "OK", city: "Tulsa" });
  const feedNash = await cNash.client("GET", "/api/national/feed");
  check("Nashville creator sees the national campaign (no market is live)", feedNash.status === 200 && feedNash.data.campaigns.some((c) => c.id === campId), JSON.stringify(feedNash.data).slice(0, 200));
  const feedCard = (feedNash.data.campaigns || []).find((c) => c.id === campId) || {};
  check("card: brand + verified marker + plain words, NO hand count", feedCard.brandName === "Fixture Oasis" && feedCard.verified === true && feedCard.nationalTag === "National brand" && !("handCount" in feedCard) && !("raisedCount" in feedCard));
  const feedTulsa = await cUnlisted.client("GET", "/api/national/feed");
  check("unlisted-city creator sees it too (market is not a visibility condition)", feedTulsa.data.campaigns.some((c) => c.id === campId));
  const page = await cNash.client("GET", `/api/national/campaigns/${campId}`);
  check("campaign page carries the tracking honesty block", page.status === 200 && /discount code/.test(page.data.campaign.trackingNote) && /does not follow your followers/.test(page.data.campaign.trackingNote), JSON.stringify(page.data).slice(0, 200));
  const brandProfile = await cNash.client("GET", `/api/national/brands/${natId}`);
  check("brand profile: verified line + website host + national line", brandProfile.status === 200 && brandProfile.data.brand.verified === true && brandProfile.data.brand.verifiedLine === "Verified by Magpie" && brandProfile.data.brand.websiteHost === "fixtureoasis.example.com" && /national brand/i.test(brandProfile.data.brand.nationalLine || ""), JSON.stringify(brandProfile.data).slice(0, 240));

  console.log("== api: hands, picks, close-out ==");
  const raise1 = await cNash.client("POST", `/api/national/campaigns/${campId}/raise`, {});
  check("raise a hand", raise1.status === 200 && raise1.data.hand.status === "raised", JSON.stringify(raise1.data));
  await cNash.client("POST", `/api/national/campaigns/${campId}/raise`, {});
  const raise2 = await cUnlisted.client("POST", `/api/national/campaigns/${campId}/raise`, {});
  check("second creator raises", raise2.status === 200 && raise2.data.hand.status === "raised");
  const raisers = await brand("GET", `/api/national/campaigns/${campId}/raisers`);
  check("double-tap cannot double-raise (2 records, not 3)", raisers.status === 200 && raisers.data.raisers.length === 2, JSON.stringify(raisers.data.raisers && raisers.data.raisers.length));
  const nashRaiser = (raisers.data.raisers || []).find((r) => r.creatorId === cNash.id);
  check("raiser card carries per-market local numbers", !!nashRaiser && (nashRaiser.creator.markets || []).some((m) => m.market === "Nashville" && m.localPct === 60 && m.localCount === 3600), JSON.stringify(nashRaiser && nashRaiser.creator));
  const pick = await brand("POST", `/api/national/campaigns/${campId}/pick`, { creatorId: cNash.id });
  check("brand picks a raiser", pick.status === 200 && pick.data.picksMade === 1, JSON.stringify(pick.data));
  const complete = await brand("POST", `/api/national/campaigns/${campId}/complete-picks`, {});
  check("finishing picks completes the campaign", complete.status === 200 && complete.data.campaign.status === "completed" && complete.data.notPicked === 1, JSON.stringify(complete.data).slice(0, 160));
  const tulsaPage = await cUnlisted.client("GET", `/api/national/campaigns/${campId}`);
  check("not-picked creator reads the plain close-out line", tulsaPage.status === 200 && tulsaPage.data.campaign.myHand.status === "not_picked" && /first in line/.test(tulsaPage.data.campaign.myHand.line), JSON.stringify(tulsaPage.data.campaign && tulsaPage.data.campaign.myHand));

  console.log("== api: fulfillment ==");
  const ship = await cNash.client("POST", `/api/national/campaigns/${campId}/fulfillment`, { productPicks: ["Collagen"], shippingName: "Nash Creator", shippingAddress: "1 Fixture Way, Nashville, TN", phone: "555-0100" });
  check("picked creator submits gift details", ship.status === 200 && ship.data.fulfillment.status === "pending", JSON.stringify(ship.data));
  const raisers2 = await brand("GET", `/api/national/campaigns/${campId}/raisers`);
  const nashRow = (raisers2.data.raisers || []).find((r) => r.creatorId === cNash.id);
  check("business sees the fulfillment state on the raiser row", !!nashRow && !!nashRow.fulfillment && nashRow.fulfillment.status === "pending");
  const shipped = await brand("PATCH", `/api/national/campaigns/${campId}/fulfillment/${cNash.id}`, { status: "shipped", trackingNumber: "1Z-FIXTURE" });
  check("business advances fulfillment with tracking", shipped.status === 200 && shipped.data.fulfillment.status === "shipped" && shipped.data.fulfillment.trackingNumber === "1Z-FIXTURE", JSON.stringify(shipped.data).slice(0, 160));
  const results = await admin("POST", `/api/admin/national/campaigns/${campId}/results`, { creatorId: cNash.id, ordersAttributed: 12, revenueAttributed: 340.5, resultNote: "From the brand's store report." });
  check("admin enters store-reported results", results.status === 200 && results.data.fulfillment.ordersAttributed === 12, JSON.stringify(results.data).slice(0, 160));

  console.log("== api: discovery + shortlist + reports ==");
  const disco = await brand("GET", "/api/national/discover");
  check("national discovery spans markets (Nashville + unlisted creators)", disco.status === 200 && disco.data.creators.some((c) => c.creatorId === cNash.id) && disco.data.creators.some((c) => c.creatorId === cUnlisted.id), JSON.stringify(disco.data).slice(0, 200));
  const discoNash = await brand("GET", "/api/national/discover?market=Nashville");
  check("single-market discovery filters + ranks by that market", discoNash.status === 200 && discoNash.data.creators.length === 1 && discoNash.data.creators[0].creatorId === cNash.id, JSON.stringify(discoNash.data).slice(0, 200));
  const sl = await brand("POST", "/api/national/shortlist", { creatorId: cNash.id, on: true });
  const slList = await brand("GET", "/api/national/shortlist");
  check("shortlist saves + lists, creator-side invisible by construction", sl.status === 200 && slList.data.creators.some((c) => c.creatorId === cNash.id));
  const reports = await brand("GET", "/api/national/reports");
  const repCamp = (reports.data.campaigns || []).find((c) => c.id === campId) || {};
  check("reports: per-campaign hands/picks + labeled store-reported results", repCamp.hands === 2 && repCamp.picks === 1 && repCamp.attributed.orders === 12 && /brand's store/.test(repCamp.attributed.source) && /not live-synced/.test(reports.data.resultsLabel), JSON.stringify(reports.data).slice(0, 240));
  check("reports: both per-market breakdowns ride, labeled", Array.isArray(reports.data.byHomeMarket) && Array.isArray(reports.data.byListedMarket) && /calls home/.test(reports.data.homeMarketLabel));

  console.log("== api: market integrity ==");
  const localList = await cNash.client("GET", "/api/public/local-list?market=National");
  check("public local list: sentinel returns no creators", localList.status === 200 && (localList.data.categories || []).length === 0, JSON.stringify(localList.data).slice(0, 120));
  const ccMarkets = await admin("GET", "/api/admin/command/markets");
  const marketRows = (ccMarkets.data && ccMarkets.data.markets) || [];
  check("admin market counts: no National row exists", !marketRows.some((r) => r.market === "National"), JSON.stringify(marketRows.map((r) => r.market)).slice(0, 200));
  const nashRowCc = marketRows.find((r) => r.market === "Nashville");
  check("admin market counts: Nashville business count excludes the national account", !!nashRowCc && nashRowCc.signups.businesses.signedUp === 0, JSON.stringify(nashRowCc && nashRowCc.signups));
  const rollupRes = await admin("GET", "/api/admin/national");
  check("admin national roll-up counts the lane separately", rollupRes.status === 200 && rollupRes.data.rollup.accounts === 1 && rollupRes.data.rollup.picks === 1, JSON.stringify(rollupRes.data.rollup));
  const checkout = await brand("POST", "/api/billing/checkout", { planId: "growth" });
  check("national account cannot reach a checkout session", checkout.status !== 200 && !checkout.data.url, `${checkout.status} ${JSON.stringify(checkout.data).slice(0, 120)}`);

  console.log("== api: website change clears verification ==");
  const webChange = await brand("PATCH", "/api/me/profile", { website: "https://different-fixture.example.com" });
  check("website save succeeds", webChange.status === 200, JSON.stringify(webChange.data).slice(0, 120));
  const meAfter = await brand("GET", "/api/national/me");
  check("verification cleared after website change", meAfter.data.account.verified === false, JSON.stringify(meAfter.data.account));
  const draft2 = await brand("POST", "/api/national/campaigns", { title: "Second campaign", whatYouGet: "2 products of your choice, free", whatWeAsk: "Post 1 video and tag us", picksCount: 1, raiseByAt: "2999-01-01T00:00:00.000Z" });
  const pubUnverified = await brand("POST", `/api/national/campaigns/${draft2.data.campaign.id}/publish`, {});
  check("publish refuses while unverified again", pubUnverified.status === 400 && /verified/i.test(pubUnverified.data.error || ""), JSON.stringify(pubUnverified.data));

  console.log("== api: conversion rules ==");
  const mktBiz = client();
  const mktReg = await mktBiz("POST", "/api/auth/register", { role: "business", name: "Local Owner", businessName: "Local Fixture Shop", email: "localshop@fixtures.dev", password: "business-pass-123", market: "Richmond", city: "Richmond", category: "Restaurant", planId: "self-service", agreedTerms: true });
  check("market business registers (regression)", mktReg.status === 201 && mktReg.data.user.business.plan === "self-service", JSON.stringify(mktReg.data).slice(0, 140));
  const conv = await admin("POST", `/api/admin/national/accounts/${mktReg.data.user.id}/convert`, {});
  check("convert a no-offer market business -> national, plan cleared", conv.status === 200 && conv.data.account.scope === "national" && conv.data.account.market === "National" && conv.data.account.plan === null, JSON.stringify(conv.data).slice(0, 200));
  // A business WITH an offer draft cannot convert.
  const mktBiz2 = client();
  const mktReg2 = await mktBiz2("POST", "/api/auth/register", { role: "business", name: "Offer Owner", businessName: "Offer Fixture Shop", email: "offershop@fixtures.dev", password: "business-pass-123", market: "Richmond", city: "Richmond", category: "Restaurant", planId: "self-service", agreedTerms: true });
  await admin("POST", "/api/admin/review", { userId: mktReg2.data.user.id, decision: "approve" });
  const offerDraft = await mktBiz2("POST", "/api/offers", { title: "Free lunch", whatComped: "A full lunch for two people", dollarCap: 40, spots: 2 });
  check("market business still drafts offers (regression)", offerDraft.status === 201 || offerDraft.status === 200, `${offerDraft.status} ${JSON.stringify(offerDraft.data).slice(0, 140)}`);
  const convRefused = await admin("POST", `/api/admin/national/accounts/${mktReg2.data.user.id}/convert`, {});
  check("convert refuses a business with offers, with the reason", convRefused.status === 409 && /offer/i.test(convRefused.data.error || ""), JSON.stringify(convRefused.data));

  console.log("== api: moderation close ==");
  const modClose = await admin("POST", `/api/admin/national/campaigns/${draft2.data.campaign.id}/close`, { note: "Fixture moderation check." });
  check("admin can close a national campaign with a note", modClose.status === 200 && modClose.data.campaign.status === "closed", JSON.stringify(modClose.data).slice(0, 160));

  await stopServer();
} catch (e) {
  console.error("verify-build178 error:", e);
  failed += 1;
  await stopServer().catch(() => {});
}
console.log(`\nverify-build178: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("failures:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
