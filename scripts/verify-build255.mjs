#!/usr/bin/env node
// verify-build255.mjs — Build -255: free first campaign for
// every business (Jeff, 2026-11-23) + handle gating for
// business viewers.
//   Piece 1: every business signup carries one free first
//   campaign credit (all markets). Designating an offer
//   reserves it; a paid booking off that offer runs at
//   rate / rate / 0 (business pays the rate exactly, creator
//   keeps all of it, Magpie takes nothing); the credit
//   completes only at check-in (redemption / business
//   confirm); a pre-check-in cancel hands it back. Headline
//   copy: "Your first campaign is free." — the phrase
//   "platform free" appears nowhere.
//   Piece 2: business-facing creator cards (Discover, Saved,
//   applicant stack) hide @handles and outbound social links
//   until a booking between the pair is accepted; stats,
//   counts and in-app content stay visible.
// Run: node scripts/verify-build255.mjs
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const app = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const router = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 260) : ""}`); }
}
function part(t) { console.log(`\n== ${t}`); }

part("A. Source pins + wording");
check("headline copy is 'Your first campaign is free.' on the signup path",
  app.includes("Your first campaign is free.") && app.includes("You still pay or comp your creator as normal, we just take nothing."));
check("the phrase 'platform free' appears NOWHERE in app.js or router.js",
  !/platform free/i.test(app) && !/platform free/i.test(router));
check("signup terms carry the plain non-circumvention line (form + conversation)",
  (app.match(/booking a creator I met on Magpie off the platform breaks this agreement/g) || []).length >= 2);
check("server: freeFirstMath zeroes the fee and pays the creator in full",
  router.includes("function freeFirstMath(rate)") && router.includes("return { rate: r, businessTotal: r, creatorNet: r, platformFee: 0 };"));
check("server: registration stamps the credit available (market + national branches)",
  (router.match(/freeFirstCampaign: \{ state: "available", grantedAt: ts/g) || []).length >= 1
  && router.includes("user.business.freeFirstCampaign = { state: \"available\", grantedAt: ts"));
check("server: credit completes only via the redemption helper, called from both redeem doors",
  router.includes("async function completeFreeFirstCampaign(booking)")
  && (router.match(/await completeFreeFirstCampaign\(booking\);/g) || []).length === 2);
check("server: cancel before check-in releases the credit",
  router.includes("free_first_campaign_released") && router.includes("booking_cancelled_before_checkin"));
check("server: handle gate fails closed for business viewers and scrubs links",
  router.includes("function gateCreatorForBusiness(card, revealed)") && router.includes("p.primaryProfileUrl = null;") && router.includes("card.handlesRevealed = true;"));
check("server: applicant stack gates the handle until selection",
  router.includes("handlesRevealed: revealedIdsFor(app.businessId).has(c.id)"));
check("client: composer toggle + payload flag + gated-profile note",
  app.includes("function ffcAvailableClient()") && app.includes("payload.freeFirstCampaign = true")
  && app.includes("Social handles unlock when a booking with"));

part("B. Behavioral over HTTP");
const PORT = 9255;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = "qa-pass-255x";
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(PW, salt, 64).toString("hex");
const NOW = "2026-11-20T00:00:00.000Z";
const data = {};
function putUser(u) { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; }
function biz(id, email, name, extra) {
  putUser({ id, role: "business", email, name: "Owner " + name, passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: NOW, updatedAt: NOW,
    business: { businessName: name, category: "Restaurant", plan: "growth", accessState: "active", neighborhood: "12 South", hasPhoto: true, photoCount: 1, ...(extra || {}) } });
}
function creator(id, email, handle, extra) {
  putUser({ id, role: "creator", email, name: "Creator " + handle, passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: NOW, updatedAt: NOW,
    creator: { handle, primaryPlatform: "instagram", instagramUrl: `https://instagram.com/${handle}`, tiktokHandle: handle + "tt", tiktokUrl: `https://www.tiktok.com/@${handle}tt`,
      followerCount: 10400, totalAudience: 21500, audienceStack: { instagram: 10400, tiktok: 7300, threads: 3800 }, platformLocalPct: { instagram: 82, tiktok: 79, threads: 77 }, localAudiencePct: 82,
      categories: ["Food & Drink"], hasPhoto: true, photoCount: 1, bio: "Nashville food, weekly.", paidRate: 125, licensingFee: 150, compOpen: true, couponOpen: true,
      neighborhood: "12 South", profileComplete: true, tierBand: "Locals", publicPage: true, charter: true,
      showcase: [{ url: "https://www.instagram.com/p/C8kQ2mPxT4a/", platform: "instagram", addedAt: NOW }],
      bestWork: ["https://www.instagram.com/reel/C9rT7wKdN2s/"], ...(extra || {}) } });
}
biz("q255-bizA", "a@b255qa.dev", "Alpha Eats");
biz("q255-bizC", "c@b255qa.dev", "Gamma Goods");
biz("q255-bizD", "d@b255qa.dev", "Delta Diner");
creator("q255-crA", "cra@b255qa.dev", "qa255alpha");
creator("q255-crB", "crb@b255qa.dev", "qa255beta");
data["config:markets"] = { flags: { Nashville: true, Austin: true } };
const DB = path.join(os.tmpdir(), `signl-verify-b255-${Date.now()}.json`);
fs.writeFileSync(DB, JSON.stringify(data));
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL: "admin@b255.dev", ADMIN_PASSWORD: "qa-admin-pass-255" };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "FIREBASE_SERVICE_ACCOUNT_JSON", "STRIPE_SECRET_KEY", "STRIPE_CONNECT_CLIENT_ID"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: ROOT, env, stdio: "ignore" });
async function req(method, p, body, cookie) {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const setCookie = (r.headers.get("set-cookie") || "").split(";")[0];
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  return { status: r.status, j, setCookie };
}
async function login(email) { const r = await req("POST", "/api/auth/login", { email, password: PW }); return r; }
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(BASE + "/api/bootstrap"); up = r.status > 0; } catch (e) { await new Promise((r) => setTimeout(r, 250)); } }
  check("dev server boots", up);
  const bizA = await login("a@b255qa.dev"); const bizC = await login("c@b255qa.dev"); const bizD = await login("d@b255qa.dev");
  const crA = await login("cra@b255qa.dev"); const crB = await login("crb@b255qa.dev");
  check("seeded users sign in", [bizA, bizC, bizD, crA, crB].every((r) => r.status === 200), [bizA, bizC, bizD, crA, crB].map((r) => r.status).join("/"));
  const A = bizA.setCookie, C = bizC.setCookie, D = bizD.setCookie, RA = crA.setCookie, RB = crB.setCookie;

  part("B1. Registration stamps the credit (any market)");
  const reg = await req("POST", "/api/auth/register", { role: "business", email: "new@b255qa.dev", password: "qa-new-pass-255", name: "New Owner", businessName: "New In Austin", market: "Austin", city: "Austin", category: "Retail", planId: "self-service", agreedTerms: true });
  check("Austin business registers", reg.status === 200 || reg.status === 201, `${reg.status} ${JSON.stringify(reg.j).slice(0, 160)}`);
  const regCk = reg.setCookie;
  const meReg = regCk ? await req("GET", "/api/auth/me", null, regCk) : { j: null };
  const regCredit = meReg.j && meReg.j.user && meReg.j.user.business ? meReg.j.user.business.freeFirstCampaign : null;
  check("new signup carries the credit, state available", !!regCredit && regCredit.state === "available", JSON.stringify(regCredit));

  part("B2. Designation reserves the credit; one at a time");
  const offerA = await req("POST", "/api/offers", { title: "Alpha free-test paid visit", whatComped: "Dinner", kind: "paid", cashRate: 100, spots: 1, freeFirstCampaign: true }, A);
  check("designated paid offer created", (offerA.status === 201 || offerA.status === 200) && offerA.j && offerA.j.offer && offerA.j.offer.freeFirstCampaign === true, `${offerA.status} ${JSON.stringify(offerA.j).slice(0, 200)}`);
  const meA1 = await req("GET", "/api/auth/me", null, A);
  const creditA1 = meA1.j.user.business.freeFirstCampaign;
  check("credit reserved against the offer", !!creditA1 && creditA1.state === "reserved" && creditA1.offerId === offerA.j.offer.id, JSON.stringify(creditA1));
  const offerA2 = await req("POST", "/api/offers", { title: "Alpha second designation attempt", whatComped: "Lunch", kind: "paid", cashRate: 120, spots: 1, freeFirstCampaign: true }, A);
  check("second simultaneous designation refused", offerA2.status === 400, `${offerA2.status}`);

  part("B3. Handle gating before any booking");
  const disc1 = await req("GET", "/api/discover?market=Nashville", null, A);
  const card1 = ((disc1.j && disc1.j.creators) || []).find((c) => c.userId === "q255-crA");
  check("discover returns the creator card", !!card1, JSON.stringify(disc1.j).slice(0, 200));
  if (card1) {
    const p = card1.profile || {};
    check("gated: handlesRevealed false", card1.handlesRevealed === false);
    check("gated: profile handle + profile URLs hidden", p.handle == null && p.primaryProfileUrl == null && p.instagramUrl == null && p.tiktokUrl == null && p.tiktokHandle == null, JSON.stringify({ h: p.handle, u: p.primaryProfileUrl, i: p.instagramUrl }));
    check("gated: channels carry counts but no handle/url", Array.isArray(card1.channels) && card1.channels.length > 0 && card1.channels.every((ch) => ch.handle == null && ch.url == null && (ch.followers == null || ch.followers > 0)), JSON.stringify(card1.channels).slice(0, 200));
    check("gated: audience stack carries no url/handle", Array.isArray(card1.audienceStack) && card1.audienceStack.every((e) => !e.url && !e.handle), JSON.stringify(card1.audienceStack).slice(0, 200));
    check("visible: local %, rate, total audience, content all still show", p.localAudiencePct === 82 && p.paidRate === 125 && card1.totalAudience === 21500 && Array.isArray(card1.showcase) && card1.showcase.length === 1 && Array.isArray(card1.bestWork) && card1.bestWork.length === 1, JSON.stringify({ lp: p.localAudiencePct, pr: p.paidRate, ta: card1.totalAudience, sc: (card1.showcase || []).length, bw: (card1.bestWork || []).length }));
  }

  part("B4. Apply -> applicant stack gated -> select -> free math");
  const appA = await req("POST", `/api/offers/${offerA.j.offer.id}/apply`, {}, RA);
  check("creator applies to the designated offer", appA.status === 200 || appA.status === 201, `${appA.status} ${JSON.stringify(appA.j).slice(0, 160)}`);
  const stack = await req("GET", `/api/offers/${offerA.j.offer.id}/applications`, null, A);
  const applicant = ((stack.j && stack.j.applications) || []).find((a) => a.creatorId === "q255-crA" || (a.creator && a.creator.userId === "q255-crA"));
  check("applicant stack hides the handle before selection", !!applicant && applicant.creator && applicant.creator.handle == null && applicant.creator.handlesRevealed === false, JSON.stringify(applicant && applicant.creator || null).slice(0, 200));
  const applicationId = applicant && (applicant.id || applicant.applicationId);
  const sel = await req("POST", `/api/offers/${offerA.j.offer.id}/select`, { applicationId }, A);
  check("business selects the applicant", sel.status === 200 || sel.status === 201, `${sel.status} ${JSON.stringify(sel.j).slice(0, 200)}`);
  const bookingA = sel.j && (sel.j.booking || sel.j);
  check("booking carries the free flag", !!bookingA && bookingA.freeFirstCampaign === true, JSON.stringify(bookingA).slice(0, 200));
  check("free math: business pays the rate exactly, creator keeps it all, platform takes nothing",
    !!bookingA && bookingA.paidLane && bookingA.paidLane.businessTotal === 100 && bookingA.paidLane.creatorNet === 100 && bookingA.paidLane.platformFee === 0, JSON.stringify(bookingA && bookingA.paidLane));
  const meA2 = await req("GET", "/api/auth/me", null, A);
  check("credit still reserved (not completed) after booking", meA2.j.user.business.freeFirstCampaign.state === "reserved" && meA2.j.user.business.freeFirstCampaign.bookingId === bookingA.id, JSON.stringify(meA2.j.user.business.freeFirstCampaign));

  part("B5. Reveal on accepted booking");
  const disc2 = await req("GET", "/api/discover?market=Nashville", null, A);
  const card2 = ((disc2.j && disc2.j.creators) || []).find((c) => c.userId === "q255-crA");
  check("revealed: discover card now shows the handle + profile URL", !!card2 && card2.handlesRevealed === true && card2.profile && card2.profile.handle === "qa255alpha" && /instagram\.com\/qa255alpha/.test(card2.profile.primaryProfileUrl || ""), JSON.stringify(card2 && card2.profile && { h: card2.profile.handle, u: card2.profile.primaryProfileUrl }));
  const discOther = await req("GET", "/api/discover?market=Nashville", null, C);
  const cardOther = ((discOther.j && discOther.j.creators) || []).find((c) => c.userId === "q255-crA");
  check("another business (no booking with her) still sees her gated", !!cardOther && cardOther.handlesRevealed === false && cardOther.profile.handle == null);

  part("B6. Check-in completes the credit");
  const conf = await req("POST", `/api/bookings/${bookingA.id}/confirm`, {}, A);
  check("business confirms the visit (check-in)", conf.status === 200, `${conf.status} ${JSON.stringify(conf.j).slice(0, 160)}`);
  const meA3 = await req("GET", "/api/auth/me", null, A);
  check("credit completed at check-in", meA3.j.user.business.freeFirstCampaign.state === "completed" && !!meA3.j.user.business.freeFirstCampaign.completedAt, JSON.stringify(meA3.j.user.business.freeFirstCampaign));
  const offerA3 = await req("POST", "/api/offers", { title: "Alpha tries to designate again", whatComped: "Brunch", kind: "paid", cashRate: 90, spots: 1, freeFirstCampaign: true }, A);
  check("designation after completion refused", offerA3.status === 400, `${offerA3.status}`);

  part("B7. Normal paid math untouched without the credit");
  const offerC = await req("POST", "/api/offers", { title: "Gamma normal paid visit", whatComped: "Dinner", kind: "paid", cashRate: 100, spots: 1 }, C);
  const appC = await req("POST", `/api/offers/${offerC.j.offer.id}/apply`, {}, RA);
  const stackC = await req("GET", `/api/offers/${offerC.j.offer.id}/applications`, null, C);
  const applicantC = ((stackC.j && stackC.j.applications) || [])[0];
  const selC = await req("POST", `/api/offers/${offerC.j.offer.id}/select`, { applicationId: applicantC && (applicantC.id || applicantC.applicationId) }, C);
  const bookingC = selC.j && (selC.j.booking || selC.j);
  check("normal math: 103 / 97 / 6 on a $100 rate", !!bookingC && bookingC.paidLane && bookingC.paidLane.businessTotal === 103 && bookingC.paidLane.creatorNet === 97 && bookingC.paidLane.platformFee === 6, JSON.stringify(bookingC && bookingC.paidLane));

  part("B8. Cancel before check-in hands the credit back");
  const offerD = await req("POST", "/api/offers", { title: "Delta free-test comp visit", whatComped: "Dinner for two", kind: "comp", dollarCap: 85, covers: 2, spots: 1, freeFirstCampaign: true }, D);
  check("comp offer can carry the designation", (offerD.status === 201 || offerD.status === 200) && offerD.j.offer.freeFirstCampaign === true, `${offerD.status} ${JSON.stringify(offerD.j).slice(0, 160)}`);
  const appD = await req("POST", `/api/offers/${offerD.j.offer.id}/apply`, {}, RB);
  const stackD = await req("GET", `/api/offers/${offerD.j.offer.id}/applications`, null, D);
  const applicantD = ((stackD.j && stackD.j.applications) || [])[0];
  const selD = await req("POST", `/api/offers/${offerD.j.offer.id}/select`, { applicationId: applicantD && (applicantD.id || applicantD.applicationId) }, D);
  const bookingD = selD.j && (selD.j.booking || selD.j);
  check("comp booking carries the free flag", !!bookingD && bookingD.freeFirstCampaign === true, JSON.stringify(bookingD).slice(0, 160));
  const cancelD = await req("POST", `/api/bookings/${bookingD.id}/cancel`, { reason: "plans changed" }, D);
  check("business cancels before check-in", cancelD.status === 200, `${cancelD.status}`);
  const meD = await req("GET", "/api/auth/me", null, D);
  check("credit returned to available after cancel", meD.j.user.business.freeFirstCampaign.state === "available" && !meD.j.user.business.freeFirstCampaign.bookingId, JSON.stringify(meD.j.user.business.freeFirstCampaign));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
console.log(`\nverify-build255: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
