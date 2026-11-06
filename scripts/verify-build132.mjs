#!/usr/bin/env node
// Build -132 (journey-map P0) verification:
//   A. source pins (stamp, founding-only price resolution,
//      Sig never nudges a creator's price down, fanout wired,
//      Square unified-code skip).
//   B. Offer Card state machine over HTTP: propose -> counter
//      -> counter cap 409 -> accept writes the booking with
//      the agreed terms; floors enforced on counters; the
//      standing-terms rules are INVISIBLE to the business
//      (auto-accept / auto-decline fire without leaking the
//      thresholds); midpoint shows once both sides named a
//      number.
//   C. Audience-code unification: a booking-attached audience
//      offer rides the booking's OWN creator code (no second
//      AUD code), and redeeming it counts exactly once into
//      the one event stream.
//   D. Coupon spend lifecycle: distinct SPEND code, partial
//      spends sum, over-spend refused, expiry close-out fires
//      in the sweep.
//   E. Price hardening against a fake Stripe: with no
//      founding prices configured, plan checkout 503s and a
//      directly supplied legacy price id is a 400; with the
//      founding env set, the session is priced at the
//      founding id.
//   F. Alert silence: a creator whose match alerts do not
//      match an open offer hears NOTHING (no note at all);
//      a matching creator gets the match alert; a creator
//      with no prefs gets the standard offer note.
// Run: node scripts/verify-build132.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = 8955;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b132.dev";
const ADMIN_PASSWORD = "b132-admin-pass";
const DB = path.join(os.tmpdir(), `signl-verify-b132-${Date.now()}.json`);
fs.writeFileSync(DB, "{}");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}
function part(t) { console.log(`\n== ${t}`); }
function client(base) {
  const jar = new Map();
  return async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  };
}
async function waitUp(base) {
  for (let i = 0; i < 80; i++) { try { const r = await fetch(base + "/api/bootstrap"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
}
function boot(port, db, extraEnv) {
  const s = spawn("node", ["scripts/dev-server.mjs", String(port)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: `http://127.0.0.1:${port}`, SIGNL_MAIL_STUB: "1", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  s.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return s;
}
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const uq = Math.random().toString(36).slice(2, 7);

const server = boot(PORT, DB, { SIGNL_TEST_ALLOW_BUSINESS: "1" });
try {
  part("A. source pins");
  const routerSrc = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
  const sigSrc = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/sigdata.js"), "utf8");
  const squareSrc = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/square.js"), "utf8");
  const buildSrc = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
  const indexSrc = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  check("stamp is -132 on both sides", /2026\.11\.06-137/.test(buildSrc) && /2026\.11\.06-137/.test(indexSrc));
  const spfStart = routerSrc.indexOf("function stripePriceForPlan");
  const spf = routerSrc.slice(spfStart, routerSrc.indexOf("\n}\n", spfStart));
  check("price resolution is founding-only (no legacy fallthrough in stripePriceForPlan)", spf.includes("FOUNDING_STRIPE_PRICES") && !/STRIPE_PLAN_PRICES/.test(spf), spf.slice(0, 200));
  check("checkout refuses honestly when a plan has no founding price", routerSrc.includes("Founding pricing is not configured for that plan yet"));
  check("Sig carries the never-nudge-down guard for creator rates", /never suggest they lower/.test(sigSrc));
  check("no price-down nudge copy anywhere in the Sig/router surface", !/lower your (rate|price)|reduce your (rate|price)|drop your price/i.test(sigSrc) && !/lower your (rate|price)/i.test(routerSrc));
  check("open-offer fanout is wired at create", routerSrc.includes("fanoutOpenOffer(offer)") || routerSrc.includes("fanoutOpenOffer(created)") || /fanoutOpenOffer\(/.test(routerSrc));
  check("Square skips unified audience codes (the booking entry carries the real discount)", /unified/.test(squareSrc) && /desiredCodes/.test(squareSrc));
  check("deal records live under their own vdeal: prefix (partner deal: untouched)", routerSrc.includes('"vdeal:"') || routerSrc.includes("`vdeal:${"));
  check("the sweep closes expired deals and coupons", routerSrc.includes("dealsExpired") && routerSrc.includes("couponsClosed"));
  check("Results headline is counted-only on the client", appSrc.includes("counted only") && appSrc.includes("Halo estimated"));

  part("fixtures");
  check("server boots", await waitUp(BASE));
  const admin = client(BASE);
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const approve = (id) => admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  async function regCreator(handle, extra = {}) {
    const c = client(BASE);
    const r = await c("POST", "/api/auth/register", { role: "creator", name: `Cr ${handle}`, email: `${handle}@fixtures.dev`, password: "<MASKED_SECRET_001>", market: "Hampton Roads", city: "Norfolk", handle, categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 4000, avgViews: 1200, localAudiencePct: 66, ...AGREE, ...extra });
    if (r.data && r.data.user) {
      await approve(r.data.user.id);
      // The listed rate is a profile field (two-step claim):
      // register does not take it, PATCH /me/profile does.
      await c("PATCH", "/api/me/profile", { paidRate: 120 });
    }
    return { client: c, user: r.data && r.data.user, reg: r };
  }
  async function regBusiness(name, email) {
    const c = client(BASE);
    const r = await c("POST", "/api/auth/register", { role: "business", name: "Owner", email, password: "<MASKED_SECRET_001>", market: "Hampton Roads", city: "Norfolk", businessName: name, category: "Restaurant", planId: "self-service", agreedTerms: true });
    if (r.data && r.data.user) {
      await approve(r.data.user.id);
      // Deals and bookings run for ACTIVATED businesses; a
      // founding business is refused them product-wide.
      await admin("POST", "/api/admin/businesses/activate", { userId: r.data.user.id });
    }
    return { client: c, user: r.data && r.data.user };
  }
  const B = await regBusiness(`Deal Diner ${uq}`, `dealdiner${uq}@fixtures.dev`);
  const C = await regCreator(`dealcr${uq}`);
  const D2 = await regCreator(`standing${uq}`);
  check("fixtures registered + approved", !!(B.user && C.user && D2.user), JSON.stringify({ b: B.user && B.user.id, c: C.user && C.user.id, d: D2.user && D2.user.id }));

  part("B. Offer Card state machine");
  const deal1 = await B.client("POST", "/api/deals", { creatorId: C.user.id, kind: "paid", cashRate: 90, hours: 48 });
  check("business proposes a paid deal under the creator's listed rate", deal1.status === 201 && deal1.data.deal && deal1.data.deal.status === "pending", `${deal1.status} ${JSON.stringify(deal1.data).slice(0, 220)}`);
  const dealId = deal1.data.deal.id;
  const cView = await C.client("GET", `/api/deals/${dealId}`);
  const cv = (cView.data && cView.data.deal) || {};
  check("creator's Deal Card shows the plain gap line against their listed rate", /Proposed \$90/.test(cv.gap && cv.gap.line || "") && /listed rate is \$120/.test(cv.gap && cv.gap.line || "") && /\$30 under/.test(cv.gap && cv.gap.line || ""), JSON.stringify(cv.gap || {}));
  check("no midpoint yet: only one side has proposed", cv.midpoint === null, JSON.stringify({ midpoint: cv.midpoint }));
  check("it is the creator's turn with one counter available", cv.canAct === true && cv.countersLeft && cv.countersLeft.creator === 1, JSON.stringify({ canAct: cv.canAct, countersLeft: cv.countersLeft }));
  check("the licence line is padlocked at 90 days", /90 days/.test(cv.licenceLine || "") && /not part of the negotiation/i.test(cv.licenceLine || ""), cv.licenceLine);
  const lowCounter = await C.client("POST", `/api/deals/${dealId}/respond`, { action: "counter", terms: { cashRate: 30 } });
  check("a counter below the paid floor is refused (floors validate on every counter)", lowCounter.status === 400, `${lowCounter.status} ${JSON.stringify(lowCounter.data).slice(0, 160)}`);
  const cCounter = await C.client("POST", `/api/deals/${dealId}/respond`, { action: "counter", terms: { cashRate: 110 } });
  check("creator counters at 110", cCounter.status === 200 && cCounter.data.deal.status === "pending" && cCounter.data.deal.turn === "business", `${cCounter.status} ${JSON.stringify(cCounter.data).slice(0, 200)}`);
  const midView = await B.client("GET", `/api/deals/${dealId}`);
  check("midpoint appears once BOTH sides named a number (90 vs 110 -> 100), shown to both sides", ((midView.data || {}).deal || {}).midpoint === 100, JSON.stringify({ midpoint: ((midView.data || {}).deal || {}).midpoint }));
  const cCounter2 = await C.client("POST", `/api/deals/${dealId}/respond`, { action: "counter", terms: { cashRate: 108 } });
  check("the same side cannot counter twice in a row", cCounter2.status === 409, String(cCounter2.status));
  const bCounter = await B.client("POST", `/api/deals/${dealId}/respond`, { action: "counter", terms: { cashRate: 100 } });
  check("business counters at 100 (its one counter)", bCounter.status === 200 && bCounter.data.deal.turn === "creator", `${bCounter.status}`);
  const cCounter3 = await C.client("POST", `/api/deals/${dealId}/respond`, { action: "counter", terms: { cashRate: 105 } });
  check("a second counter from the creator is refused: one counter per side, two rounds max", cCounter3.status === 409 && /counter/i.test((cCounter3.data && cCounter3.data.error) || ""), `${cCounter3.status} ${JSON.stringify(cCounter3.data).slice(0, 160)}`);
  const bViewDeal = await B.client("GET", `/api/deals/${dealId}`);
  const cViewDeal2 = await C.client("GET", `/api/deals/${dealId}`);
  check("midpoint follows the live numbers for BOTH sides (110 vs 100 -> 105)", ((bViewDeal.data || {}).deal || {}).midpoint === 105 && ((cViewDeal2.data || {}).deal || {}).midpoint === 105, JSON.stringify({ b: (bViewDeal.data || {}).deal && bViewDeal.data.deal.midpoint, c: (cViewDeal2.data || {}).deal && cViewDeal2.data.deal.midpoint }));
  const accept = await C.client("POST", `/api/deals/${dealId}/respond`, { action: "accept" });
  const acc = accept.data || {};
  const accBkId = acc.booking && acc.booking.id;
  check("acceptance accepts at the current proposal (100) and returns the booking", accept.status === 200 && acc.deal && acc.deal.status === "accepted" && !!accBkId, `${accept.status} ${JSON.stringify(acc).slice(0, 220)}`);
  const bBookings = await B.client("GET", "/api/bookings");
  const bk = (bBookings.data.bookings || []).find((x) => x.id === accBkId) || {};
  check("acceptance WROTE the record: the booking carries the deal id and the agreed terms", bk.dealId === dealId && bk.agreedTerms && bk.agreedTerms.cashRate === 100, JSON.stringify({ dealId: bk.dealId, agreedTerms: bk.agreedTerms }));
  check("the paid lane on the booking runs off the agreed terms (3% total, creator keeps 97%)", !!bk.paidLane && bk.paidLane.creatorNet === 97 && bk.paidLane.businessTotal === 103, JSON.stringify(bk.paidLane || {}));

  part("B2. standing terms: invisible auto-accept / auto-decline");
  const putTerms = await D2.client("PUT", "/api/me/negotiation", { autoAcceptMin: 80 });
  check("creator saves standing terms", putTerms.status === 200 && putTerms.data.negotiation && putTerms.data.negotiation.autoAcceptMin === 80, `${putTerms.status} ${JSON.stringify(putTerms.data).slice(0, 200)}`);
  const dealAuto = await B.client("POST", "/api/deals", { creatorId: D2.user.id, kind: "paid", cashRate: 85, hours: 24 });
  check("a deal at/above the auto-accept line books itself", dealAuto.status === 201 && dealAuto.data.deal.status === "accepted" && !!(dealAuto.data.booking && dealAuto.data.booking.id), `${dealAuto.status} ${JSON.stringify(dealAuto.data).slice(0, 220)}`);
  check("the business NEVER sees the threshold (auto-accept is invisible)", !/autoAcceptMin|autoDeclineBelow|autoAcceptTopUpMin/.test(JSON.stringify(dealAuto.data)), JSON.stringify(dealAuto.data).slice(0, 220));
  await D2.client("PUT", "/api/me/negotiation", { autoAcceptMin: null, autoDeclineBelow: 100 });
  const dealAutoD = await B.client("POST", "/api/deals", { creatorId: D2.user.id, kind: "paid", cashRate: 85, hours: 24 });
  check("a deal under the auto-decline line is declined by the rule", dealAutoD.status === 201 && dealAutoD.data.deal.status === "declined", `${dealAutoD.status} ${JSON.stringify(dealAutoD.data).slice(0, 240)}`);
  check("the BUSINESS just sees a plain rate decline (the rule and the floor stay invisible)", /rate does not work/.test(dealAutoD.data.deal.declineLine || "") && !/standing terms|autoDeclineBelow/.test(JSON.stringify(dealAutoD.data)), JSON.stringify(dealAutoD.data.deal).slice(0, 240));
  const d2View = await D2.client("GET", `/api/deals/${dealAutoD.data.deal.id}`);
  check("the CREATOR sees it was their standing terms, and that the business never sees the floor", /standing terms/.test(((d2View.data || {}).deal || {}).declineLine || "") && /never see your floor/.test(((d2View.data || {}).deal || {}).declineLine || ""), JSON.stringify(((d2View.data || {}).deal || {}).declineLine || ""));
  const d2Terms = await D2.client("GET", "/api/me/negotiation");
  check("the creator DOES see their own rules (they are theirs)", d2Terms.data.negotiation && d2Terms.data.negotiation.autoDeclineBelow === 100, JSON.stringify(d2Terms.data).slice(0, 200));

  part("C. audience-code unification");
  const C3 = await regCreator(`unicr${uq}`);
  const compDeal = await B.client("POST", "/api/deals", { creatorId: C3.user.id, kind: "comp", title: "Comp night", whatComped: "Dinner for two", dollarCap: 60, hours: 48 });
  check("comp deal proposed", compDeal.status === 201, `${compDeal.status} ${JSON.stringify(compDeal.data).slice(0, 180)}`);
  const compAccept = await C3.client("POST", `/api/deals/${compDeal.data.deal.id}/respond`, { action: "accept" });
  const compBkId = ((compAccept.data || {}).booking || {}).id;
  check("comp deal accepted into a booking", compAccept.status === 200 && !!compBkId, `${compAccept.status} ${JSON.stringify(compAccept.data).slice(0, 180)}`);
  const bkList = await B.client("GET", "/api/bookings");
  const cbk = (bkList.data.bookings || []).find((x) => x.id === compBkId) || {};
  check("the booking carries ONE creator code", !!cbk.creatorCode && /^.+-[A-Z0-9]{4}$/.test(cbk.creatorCode), cbk.creatorCode);
  check("the audience offer attached by default at confirmation, on that same code", !!(cbk.audienceOffer && cbk.audienceOffer.attachedAt), JSON.stringify(cbk.audienceOffer || {}));
  check("the code state travels with the booking for both sides", !!(cbk.audienceCode && cbk.audienceCode.code === cbk.creatorCode), JSON.stringify(cbk.audienceCode || {}));
  const K = await regCreator(`keeper${uq}`);
  const redeem = await B.client("POST", "/api/me/audience-codes/redeem", { code: cbk.creatorCode, amount: 42 });
  check("the unified code redeems through the audience endpoint", redeem.status === 201 && !!redeem.data.redemptionEvent, `${redeem.status} ${JSON.stringify(redeem.data).slice(0, 200)}`);
  const evs = await B.client("GET", `/api/bookings/${compBkId}/events`);
  const audEvents = ((evs.data || {}).events || []).filter((e) => e.kind === "audience");
  check("exactly ONE stream entry for the redemption (no double count)", audEvents.length === 1 && audEvents[0].source === "audience_code", JSON.stringify(audEvents).slice(0, 220));
  const bkAfter = await B.client("GET", "/api/bookings");
  const cbk2 = (bkAfter.data.bookings || []).find((x) => x.id === compBkId) || {};
  check("the booking's counted tally moved by exactly one", (cbk2.audienceCode && cbk2.audienceCode.counted) === 1, JSON.stringify(cbk2.audienceCode || {}));

  part("D. coupon spend lifecycle");
  const C4 = await regCreator(`cpncr${uq}`);
  const cpnDeal = await B.client("POST", "/api/deals", { creatorId: C4.user.id, kind: "coupon", title: "Store credit night", coupon: { type: "store_credit", amount: 200, appliesTo: "Anything on the menu" }, hours: 48 });
  check("coupon deal proposed (dignity floor respected at $200)", cpnDeal.status === 201, `${cpnDeal.status} ${JSON.stringify(cpnDeal.data).slice(0, 200)}`);
  const cpnAccept = await C4.client("POST", `/api/deals/${cpnDeal.data.deal.id}/respond`, { action: "accept" });
  const cpnBkId = ((cpnAccept.data || {}).booking || {}).id;
  const bkL2 = await B.client("GET", "/api/bookings");
  const kbk = (bkL2.data.bookings || []).find((x) => x.id === cpnBkId) || {};
  check("the coupon booking carries a DISTINCT spend code (not the visit code)", !!(kbk.couponSpend && /^SPEND-/.test(kbk.couponSpend.code)) && kbk.couponSpend.code !== kbk.code, JSON.stringify(kbk.couponSpend || {}));
  const spendCode = kbk.couponSpend.code;
  const over = await B.client("POST", `/api/bookings/${cpnBkId}/coupon-spend`, { code: spendCode, amount: 250 });
  check("a spend above the remaining value is refused", over.status === 400, `${over.status} ${JSON.stringify(over.data).slice(0, 160)}`);
  const sp1 = await B.client("POST", `/api/bookings/${cpnBkId}/coupon-spend`, { code: spendCode, amount: 80 });
  check("partial spend records and the balance moves", sp1.status === 201 && sp1.data.couponSpend.spent === 80 && sp1.data.couponSpend.remaining === 120 && sp1.data.couponSpend.status === "partly_spent", `${sp1.status} ${JSON.stringify(sp1.data).slice(0, 220)}`);
  const sp2 = await B.client("POST", `/api/bookings/${cpnBkId}/coupon-spend`, { code: spendCode.toLowerCase(), amount: 120 });
  check("the rest spends (code is case-insensitive) and the coupon closes as spent", sp2.status === 201 && sp2.data.couponSpend.spent === 200 && sp2.data.couponSpend.status === "spent", `${sp2.status} ${JSON.stringify(sp2.data).slice(0, 200)}`);
  const sp3 = await B.client("POST", `/api/bookings/${cpnBkId}/coupon-spend`, { code: spendCode, amount: 1 });
  check("nothing more can be spent on a spent coupon", sp3.status === 400, String(sp3.status));
  const C5 = await regCreator(`exp${uq}`);
  const expDeal = await B.client("POST", "/api/deals", { creatorId: C5.user.id, kind: "coupon", title: "Expiring credit", coupon: { type: "store_credit", amount: 100, appliesTo: "Dinner", expiresAt: "2020-01-01T00:00:00.000Z" }, hours: 48 });
  const expAccept = await C5.client("POST", `/api/deals/${expDeal.data.deal.id}/respond`, { action: "accept" });
  const expBkId = ((expAccept.data || {}).booking || {}).id;
  check("an already-expired coupon still books (the visit happened; the spend half is what closes)", expAccept.status === 200 && !!expBkId, `${expAccept.status} ${JSON.stringify(expAccept.data).slice(0, 180)}`);
  const sweep = await admin("POST", "/api/admin/offers/sweep", {});
  check("the sweep reports closing expired coupons", sweep.status === 200 && (((sweep.data || {}).sweep || {}).couponsClosed >= 1), JSON.stringify(sweep.data).slice(0, 220));
  const bkL3 = await B.client("GET", "/api/bookings");
  const ebk = (bkL3.data.bookings || []).find((x) => x.id === expBkId) || {};
  check("after the sweep the expired coupon reads expired with its close-out stamped", !!ebk.couponSpend && ebk.couponSpend.status === "expired" && !!ebk.couponSpend.closedAt, JSON.stringify(ebk.couponSpend || {}));

  part("F. alert silence (Indeed pattern)");
  const E = await regCreator(`picky${uq}`);
  await E.client("PUT", "/api/me/alert-prefs", { categories: ["Spa & Beauty"], minCompValue: 500 });
  const G = await regCreator(`matchy${uq}`);
  await G.client("PUT", "/api/me/alert-prefs", { categories: ["Restaurant"] });
  const F = await regCreator(`plain${uq}`);
  const openOffer = await B.client("POST", "/api/offers", { title: `Open comp ${uq}`, whatComped: "Dinner for two", dollarCap: 60, spots: 2, category: "Restaurant" });
  check("open offer posts (and fans out)", openOffer.status === 201 && openOffer.data.offer.status === "open", `${openOffer.status} ${JSON.stringify(openOffer.data).slice(0, 200)}`);
  const notesE = await E.client("GET", "/api/notifications");
  const eMatch = ((notesE.data || {}).notifications || []).filter((n) => n.kind === "match_alert" || n.kind === "offer_received");
  check("SILENCE: a creator whose alerts do not match gets no alert at all", eMatch.length === 0, JSON.stringify(eMatch).slice(0, 200));
  const notesG = await G.client("GET", "/api/notifications");
  const gMatch = ((notesG.data || {}).notifications || []).filter((n) => n.kind === "match_alert");
  check("a matching creator gets the match alert", gMatch.length >= 1, JSON.stringify(gMatch).slice(0, 200));
  const notesF = await F.client("GET", "/api/notifications");
  const fNotes = ((notesF.data || {}).notifications || []).filter((n) => n.kind === "offer_received");
  check("a creator with no prefs set gets the standard new-offer note", fNotes.length >= 1, JSON.stringify(fNotes).slice(0, 200));

  part("E. price hardening (fake Stripe)");
  const stripeRequests = [];
  const fakeStripe = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      stripeRequests.push({ url: req.url, body });
      if (req.url.startsWith("/v1/checkout/sessions")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ id: "cs_test_132", url: "https://checkout.stripe.test/pay/cs_test_132" })); }
      if (req.url.startsWith("/v1/coupons/")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ id: "FOUNDING100", valid: true })); }
      res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}");
    });
  });
  const STRIPE_PORT = 8971;
  await new Promise((r) => fakeStripe.listen(STRIPE_PORT, "127.0.0.1", r));
  const LEGACY_SELF = "price_1USRLTJ5DCULBlmAES4a3fNV";
  const FOUNDING_GROWTH = "price_founding_growth_132";
  // Boot 2: Stripe configured, NO founding prices anywhere.
  const DB2 = path.join(os.tmpdir(), `signl-verify-b132-e2-${Date.now()}.json`);
  fs.writeFileSync(DB2, "{}");
  const server2 = boot(8956, DB2, { SIGNL_TEST_ALLOW_BUSINESS: "1", STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_132", STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}` });
  try {
    check("hardening boot up", await waitUp("http://127.0.0.1:8956"));
    const admin2 = client("http://127.0.0.1:8956");
    await admin2("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const biz2 = client("http://127.0.0.1:8956");
    const reg2 = await biz2("POST", "/api/auth/register", { role: "business", name: "Owner", email: `hard${uq}@fixtures.dev`, password: "<MASKED_SECRET_001>", market: "Hampton Roads", city: "Norfolk", businessName: "Hardening House", category: "Restaurant", planId: "growth", agreedTerms: true });
    const biz2Id = reg2.data.user.id;
    await admin2("POST", "/api/admin/review", { userId: biz2Id, decision: "approve" });
    await admin2("POST", "/api/admin/businesses/activate", { userId: biz2Id });
    const coNoFounding = await biz2("POST", "/api/billing/checkout", { planId: "growth" });
    check("no founding price configured -> plan checkout is a 503, never a legacy price", coNoFounding.status === 503 && /Founding pricing is not configured/.test((coNoFounding.data || {}).error || ""), `${coNoFounding.status} ${JSON.stringify(coNoFounding.data).slice(0, 200)}`);
    const coLegacy = await biz2("POST", "/api/billing/checkout", { priceId: LEGACY_SELF });
    check("a directly supplied LEGACY price id is refused (400): the legacy map cannot price a checkout", coLegacy.status === 400, `${coLegacy.status} ${JSON.stringify(coLegacy.data).slice(0, 200)}`);
    check("no Stripe session was created by either refused checkout", stripeRequests.filter((r) => r.url.startsWith("/v1/checkout/sessions")).length === 0);
  } finally { server2.kill("SIGTERM"); }
  // Boot 3: the founding growth price configured by env.
  const DB3 = path.join(os.tmpdir(), `signl-verify-b132-e3-${Date.now()}.json`);
  fs.writeFileSync(DB3, "{}");
  const server3 = boot(8957, DB3, { SIGNL_TEST_ALLOW_BUSINESS: "1", STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_132", STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}`, STRIPE_PRICE_FOUNDING_GROWTH: FOUNDING_GROWTH });
  try {
    check("founding boot up", await waitUp("http://127.0.0.1:8957"));
    const admin3 = client("http://127.0.0.1:8957");
    await admin3("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const biz3 = client("http://127.0.0.1:8957");
    const reg3 = await biz3("POST", "/api/auth/register", { role: "business", name: "Owner", email: `hard3${uq}@fixtures.dev`, password: "<MASKED_SECRET_001>", market: "Hampton Roads", city: "Norfolk", businessName: "Founding House", category: "Restaurant", planId: "growth", agreedTerms: true });
    const biz3Id = reg3.data.user.id;
    await admin3("POST", "/api/admin/review", { userId: biz3Id, decision: "approve" });
    await admin3("POST", "/api/admin/businesses/activate", { userId: biz3Id });
    const coF = await biz3("POST", "/api/billing/checkout", { planId: "growth" });
    check("with the founding price configured, checkout opens", coF.status === 200 && !!coF.data.url, `${coF.status} ${JSON.stringify(coF.data).slice(0, 200)}`);
    const sentF = stripeRequests.find((r) => r.url.startsWith("/v1/checkout/sessions"));
    const formF = new URLSearchParams(sentF ? sentF.body : "");
    check("the session is priced at the FOUNDING id, nothing else", formF.get("line_items[0][price]") === FOUNDING_GROWTH, sentF ? sentF.body.slice(0, 240) : "none");
  } finally { server3.kill("SIGTERM"); fakeStripe.close(); }

  console.log(failed === 0 ? `\nverify-build132: ALL PASS (${passed})` : `\nverify-build132: ${failed} FAILURE(S), ${passed} passed`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  server.kill("SIGTERM");
}
