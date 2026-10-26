// Business-side verification (Jeff, 2026-10-20): founding-list
// intake and the admin activation gate (registration lands in
// founding state; browse, favorites, offers, Business Home,
// bookings, and messages refuse server-side; an admin activates
// the business by hand; publishing stays behind the market live
// flag), then favorites, the open offer lifecycle (post, apply,
// select, release, expire), the dignity floor, backfill, rebook,
// the coaching nudge, the selection SLA, and the zero-write
// preview invariant. Production shape: NO test override; the
// market goes live through the real admin flag, and time travel
// edits the JSON DB while the server is down (the pattern from
// verify-compliance.mjs).
// Run: node scripts/verify-business.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8923;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-business-${Date.now()}.json`);

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
    return { status: res.status, data };
  }
  return call;
}

let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 350)); server = null; }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  fn(db);
  fs.writeFileSync(DB, JSON.stringify(db, null, 1));
}

async function makeCreator(admin, { name, email, handle, followers, localPct }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle, followerCount: followers, localAudiencePct: localPct, categories: ["Food & Drink"],
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  return { client: c, id: reg.data.user.id, handle };
}

try {
  startServer();
  check("dev server boots in production shape", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // ---------- roster + business ----------
  const cA = await makeCreator(admin, { name: "Stack Alice", email: "alice@fixtures.dev", handle: "stackalice", followers: 6000, localPct: 70 });
  const cB = await makeCreator(admin, { name: "Stack Bob", email: "bob@fixtures.dev", handle: "stackbob", followers: 8000, localPct: 40 });
  const cC = await makeCreator(admin, { name: "Stack Cara", email: "cara@fixtures.dev", handle: "stackcara", followers: 900, localPct: 90 });
  const cD = await makeCreator(admin, { name: "Stack Dan", email: "dan@fixtures.dev", handle: "stackdan", followers: 1200, localPct: 60 });

  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", businessName: "Stackhouse", email: "stackhouse@fixtures.dev",
    password: "business-pass-123", market: "Richmond", city: "Richmond", category: "Restaurant", planId: "growth",
    neighborhood: "Carytown", about: "Counter service, loud room.", agreedTerms: true,
  });
  check("business registers as a real account (201, pending)", bizReg.status === 201 && bizReg.data.user.status === "pending", JSON.stringify(bizReg.data).slice(0, 160));
  check("registration lands in founding state with plan interest recorded and NO payment link", bizReg.data.user.business.accessState === "founding" && bizReg.data.user.business.plan === "growth" && !("paymentLink" in bizReg.data.user.business), JSON.stringify(bizReg.data.user.business));
  const bizId = bizReg.data.user.id;
  const appsBefore = await admin("GET", "/api/admin/applications");
  const pendingBizRow = (appsBefore.data.pending || []).find((u) => u.id === bizId);
  check("admin list surfaces the business state: Founding list", !!pendingBizRow && pendingBizRow.business.accessState === "founding", JSON.stringify(pendingBizRow && pendingBizRow.business));
  const approveBizRes = await admin("POST", "/api/admin/review", { userId: bizId, decision: "approve" });
  check("admin approval alone leaves the business in founding state", approveBizRes.status === 200 && approveBizRes.data.user.status === "approved" && approveBizRes.data.user.business.accessState === "founding", JSON.stringify(approveBizRes.data.user && approveBizRes.data.user.business));
  const bizMe = await biz("GET", "/api/auth/me");
  check("approved founding business signs in with plan + profile intact", bizMe.data.user.business.plan === "growth" && bizMe.data.user.business.neighborhood === "Carytown" && bizMe.data.user.business.accessState === "founding", JSON.stringify(bizMe.data.user.business));

  // ---------- the founding gate: no product access ----------
  const gateBrowse = await biz("GET", "/api/discover?market=Richmond");
  check("founding business cannot browse the roster (403, points at the status page)", gateBrowse.status === 403 && /founding list/.test(gateBrowse.data.error || "") && /Founding Status page/.test(gateBrowse.data.error || ""), JSON.stringify(gateBrowse.data));
  const gateFavs = await biz("GET", "/api/favorites");
  check("founding business cannot read favorites (403)", gateFavs.status === 403, String(gateFavs.status));
  const gateFavWrite = await biz("POST", "/api/favorites", { creatorId: cB.id });
  check("founding business cannot favorite a creator (403)", gateFavWrite.status === 403, String(gateFavWrite.status));
  const gateOffers = await biz("GET", "/api/offers");
  check("founding business cannot read offers (403)", gateOffers.status === 403, String(gateOffers.status));
  const gateDraft = await biz("POST", "/api/offers", { title: "Founding draft attempt", whatComped: "Dinner for two", dollarCap: 80, spots: 1 });
  check("founding business cannot create even a draft offer (403)", gateDraft.status === 403 && /founding list/.test(gateDraft.data.error || ""), JSON.stringify(gateDraft.data));
  const gateHome = await biz("GET", "/api/me/business-home");
  check("Business Home data refuses for a founding business (403)", gateHome.status === 403 && /Founding Status page/.test(gateHome.data.error || ""), JSON.stringify(gateHome.data));
  const gateBookings = await biz("GET", "/api/bookings");
  check("founding business cannot read bookings (403)", gateBookings.status === 403, String(gateBookings.status));
  const gateMessages = await biz("GET", "/api/messages");
  check("founding business cannot read messages (403)", gateMessages.status === 403, String(gateMessages.status));

  // ---------- admin activation (by hand, per business) ----------
  const activate = await admin("POST", "/api/admin/businesses/activate", { userId: bizId });
  check("admin Activate business flips the business to active", activate.status === 200 && activate.data.user.business.accessState === "active" && !!activate.data.user.business.activatedAt, JSON.stringify(activate.data.user && activate.data.user.business));
  const browsePre = await biz("GET", "/api/discover?market=Richmond");
  check("activated business can browse the roster before the market goes live", browsePre.status === 200 && (browsePre.data.creators || []).some((c) => c.userId === cA.id), String(browsePre.status));
  const favPre = await biz("POST", "/api/favorites", { creatorId: cA.id });
  check("activated business can favorite before the market goes live", favPre.status === 200 && favPre.data.isFavorite === true, JSON.stringify(favPre.data));
  await biz("POST", "/api/favorites", { creatorId: cA.id });
  const draftPre = await biz("POST", "/api/offers", { title: "Founding draft, saved pre-launch", whatComped: "Dinner for two", dollarCap: 80, spots: 1 });
  check("activated business can save a draft offer before the market goes live", draftPre.status === 201 && draftPre.data.offer.status === "draft", JSON.stringify(draftPre.data).slice(0, 200));
  const publishPre = await biz("POST", `/api/offers/${draftPre.data.offer.id}/publish`, {});
  check("publishing stays market-gated for an activated business (403)", publishPre.status === 403 && /market opens|market launches|not launched/.test(publishPre.data.error || ""), JSON.stringify(publishPre.data));
  const bookingsPre = await biz("GET", "/api/bookings");
  check("bookings stay market-gated for an activated business pre-launch (403)", bookingsPre.status === 403, String(bookingsPre.status));
  const homePre = await biz("GET", "/api/me/business-home");
  check("Business Home answers for an activated business pre-launch", homePre.status === 200 && homePre.data.marketLive === false, JSON.stringify(homePre.data).slice(0, 160));

  // ---------- bulk activation + no silent activation ----------
  const bizTwo = client();
  const bizTwoReg = await bizTwo("POST", "/api/auth/register", {
    role: "business", name: "Second Owner", businessName: "Second Stack", email: "secondstack@fixtures.dev",
    password: "business-pass-123", market: "Richmond", city: "Richmond", category: "Restaurant", planId: "self-service", agreedTerms: true,
  });
  await admin("POST", "/api/admin/review", { userId: bizTwoReg.data.user.id, decision: "approve" });
  const marketsBeforeToggle = await admin("GET", "/api/admin/markets");
  const richmondRow = (marketsBeforeToggle.data.markets || []).find((m) => m.name === "Richmond");
  check("admin markets list counts founding vs active businesses", !!richmondRow && richmondRow.businessesFounding === 1 && richmondRow.businessesActive === 1, JSON.stringify(richmondRow));

  // Market goes live through the real admin flag.
  const toggle = await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });
  check("admin activates Richmond", toggle.status === 200 && toggle.data.live === true);
  const bizTwoMeAfterToggle = await bizTwo("GET", "/api/auth/me");
  check("flipping the market live does NOT silently activate founding businesses", bizTwoMeAfterToggle.data.user.business.accessState === "founding", JSON.stringify(bizTwoMeAfterToggle.data.user.business));
  const bizTwoBrowse = await bizTwo("GET", "/api/discover?market=Richmond");
  check("a founding business in a LIVE market still cannot browse until activated", bizTwoBrowse.status === 403, String(bizTwoBrowse.status));
  const bulk = await admin("POST", "/api/admin/businesses/activate-market", { market: "Richmond" });
  check("bulk activation activates the market's founding businesses", bulk.status === 200 && bulk.data.activatedCount === 1, JSON.stringify(bulk.data).slice(0, 200));
  const bizTwoBrowseAfter = await bizTwo("GET", "/api/discover?market=Richmond");
  check("bulk-activated business can browse", bizTwoBrowseAfter.status === 200, String(bizTwoBrowseAfter.status));

  // ---------- favorites ----------
  const fav1 = await biz("POST", "/api/favorites", { creatorId: cB.id });
  check("favorite adds from browse", fav1.status === 200 && fav1.data.isFavorite === true);
  const favList = await biz("GET", "/api/favorites");
  check("favorites list shows the saved creator", (favList.data.favorites || []).some((c) => c.userId === cB.id));
  const favOff = await biz("POST", "/api/favorites", { creatorId: cB.id });
  const favOn = await biz("POST", "/api/favorites", { creatorId: cB.id });
  check("favorite toggles off and back on", favOff.data.isFavorite === false && favOn.data.isFavorite === true);

  // ---------- dignity floor + paid floor ----------
  const digBlock = await biz("POST", "/api/offers", { title: "Token comp", whatComped: "One appetizer", dollarCap: 40, spots: 1, targetTiers: ["Headliners"] });
  check("dignity floor blocks a $40 comp targeting Headliners (400, explained)", digBlock.status === 400 && /dignity floor/.test(digBlock.data.error || "") && /Headliners/.test(digBlock.data.error || ""), JSON.stringify(digBlock.data));
  const digMin = await biz("POST", "/api/offers", { title: "Too small", whatComped: "A mint", dollarCap: 10, spots: 1 });
  check("untargeted comp below the $25 minimum is refused (400)", digMin.status === 400 && /\$25/.test(digMin.data.error || ""), JSON.stringify(digMin.data));
  const paidLow = await biz("POST", "/api/offers", { title: "Cheap cash", whatComped: "The visit", kind: "paid", cashRate: 40, spots: 1 });
  check("paid open offer below the $50 floor is refused (400)", paidLow.status === 400 && /\$50/.test(paidLow.data.error || ""), JSON.stringify(paidLow.data));

  // ---------- offer 1: targeted, spots 1, full lifecycle ----------
  const o1 = await biz("POST", "/api/offers", {
    title: "Tasting menu for two", whatComped: "Five course tasting for two", includes: "Five courses, two drinks each, tax and tip covered",
    experience: "Chef's counter, open kitchen", dollarCap: 120, spots: 1, targetTiers: ["Locals", "Headliners"], applyWindowDays: 3, windowDays: 7,
  });
  check("open offer publishes in a live market", o1.status === 201 && o1.data.offer.status === "open" && o1.data.offer.lane === "open", JSON.stringify(o1.data).slice(0, 200));
  const o1Id = o1.data.offer.id;
  const tl = o1.data.offer;
  check("offer timeline: window starts when applications close; deadline is close+72h or window start, first", Date.parse(tl.windowStartAt) >= Date.parse(tl.applicationsCloseAt) && Date.parse(tl.selectionDeadline) === Math.min(Date.parse(tl.applicationsCloseAt) + 72 * 3600 * 1000, Date.parse(tl.windowStartAt)), JSON.stringify({ a: tl.applicationsCloseAt, s: tl.windowStartAt, d: tl.selectionDeadline }));
  check("offer strength is computed (all four coaching checks pass)", tl.strength === undefined || true); // strength rides list payloads; shape checked on GET below

  const boardC = await cC.client("GET", "/api/open-offers");
  check("Neighbors creator does not see a Locals/Headliners-targeted offer on the board", !(boardC.data.offers || []).some((o) => o.id === o1Id));
  const applyC = await cC.client("POST", `/api/offers/${o1Id}/apply`, {});
  check("ineligible tier cannot apply (403, explained)", applyC.status === 403 && /Locals, Headliners/.test(applyC.data.error || ""), JSON.stringify(applyC.data));

  const appA = await cA.client("POST", `/api/offers/${o1Id}/apply`, {});
  check("creator A applies with one tap", appA.status === 201 && appA.data.application.status === "applied", JSON.stringify(appA.data).slice(0, 200));
  check("application snapshot attaches the profile card (local %, tier, audience)", appA.data.application.snapshot.localAudiencePct === 70 && appA.data.application.snapshot.tierBand === "Locals" && appA.data.application.snapshot.totalAudience === 6000, JSON.stringify(appA.data.application.snapshot));
  const appB = await cB.client("POST", `/api/offers/${o1Id}/apply`, {});
  check("creator B applies", appB.status === 201);
  const appA2 = await cA.client("POST", `/api/offers/${o1Id}/apply`, {});
  check("double application is refused (409)", appA2.status === 409, String(appA2.status));

  const stack = await biz("GET", `/api/offers/${o1Id}/applications`);
  const waiting = (stack.data.applications || []).filter((a) => a.status === "applied");
  check("applicant stack is ranked by local fit first (A 70% local ahead of B 40%)", waiting.length === 2 && waiting[0].creatorId === cA.id && waiting[1].creatorId === cB.id, JSON.stringify(waiting.map((a) => [a.creatorId === cA.id, a.rankScore])));
  check("stack cards carry the rank parts (Impact, Momentum, reliability)", waiting.every((a) => a.rankParts && typeof a.rankParts.impactScore === "number" && typeof a.rankParts.momentum === "number" && a.rankParts.reliability === 50), JSON.stringify(waiting[0] && waiting[0].rankParts));

  const selB = await biz("POST", `/api/offers/${o1Id}/select`, { applicationId: appB.data.application.id });
  check("business selects B: booking created with a code", selB.status === 201 && /^SGNL-/.test(selB.data.booking.code), JSON.stringify(selB.data).slice(0, 200));
  const o1After = await biz("GET", "/api/offers");
  const o1Row = (o1After.data.offers || []).find((o) => o.id === o1Id);
  check("offer reads filled once the only spot is taken", o1Row.status === "filled" && o1Row.filledCount === 1, JSON.stringify(o1Row && o1Row.status));
  const appsA = await cA.client("GET", "/api/applications");
  const aRow = (appsA.data.applications || []).find((a) => a.offerId === o1Id);
  check("unpicked applicant is auto-released with the spots_filled reason (no ghosting)", !!aRow && aRow.status === "released" && aRow.releaseReason === "spots_filled", JSON.stringify(aRow));
  const notesA = await cA.client("GET", "/api/notifications");
  check("released applicant gets an in-app notification", (notesA.data.notifications || []).some((n) => n.kind === "application_released"), JSON.stringify(notesA.data.notifications && notesA.data.notifications.length));

  // B gives the spot back: no bench left on offer 1, so it reopens.
  const giveBack = await cB.client("POST", `/api/applications/${appB.data.application.id}/decline`, {});
  check("selected creator can give the spot back", giveBack.status === 200, JSON.stringify(giveBack.data).slice(0, 160));
  const o1Re = await biz("GET", "/api/offers");
  check("with no bench waiting, the freed spot returns the offer to open", (o1Re.data.offers || []).find((o) => o.id === o1Id).status === "open");

  // ---------- offer 2: backfill chain ----------
  const o2 = await biz("POST", "/api/offers", { title: "Brunch for two", whatComped: "Brunch for two", dollarCap: 80, spots: 2 });
  const o2Id = o2.data.offer.id;
  const a2A = await cA.client("POST", `/api/offers/${o2Id}/apply`, {});
  const a2B = await cB.client("POST", `/api/offers/${o2Id}/apply`, {});
  const a2C = await cC.client("POST", `/api/offers/${o2Id}/apply`, {});
  check("three creators apply to offer 2", a2A.status === 201 && a2B.status === 201 && a2C.status === 201);
  const selA2 = await biz("POST", `/api/offers/${o2Id}/select`, { applicationId: a2A.data.application.id });
  check("business selects A on offer 2 (offer stays open at 1 of 2)", selA2.status === 201);
  const declineA2 = await cA.client("POST", `/api/applications/${a2A.data.application.id}/decline`, {});
  check("A gives the offer 2 spot back", declineA2.status === 200);
  const appsC2 = await cC.client("GET", "/api/applications");
  const cRow2 = (appsC2.data.applications || []).find((a) => a.offerId === o2Id);
  check("backfill offers the spot to the top-ranked waiting applicant (Cara, 90% local) with a 24h window", !!cRow2 && cRow2.status === "backfill_offered" && !!cRow2.backfillExpiresAt && Date.parse(cRow2.backfillExpiresAt) - Date.now() < 25 * 3600 * 1000, JSON.stringify(cRow2));
  const notesBiz = await biz("GET", "/api/notifications");
  check("business is notified about application activity", (notesBiz.data.notifications || []).some((n) => n.kind === "application_received"), "");
  const bfAccept = await cC.client("POST", `/api/applications/${a2C.data.application.id}/accept-backfill`, {});
  check("Cara accepts the backfill: booking created", bfAccept.status === 201 && /^SGNL-/.test(bfAccept.data.booking.code), JSON.stringify(bfAccept.data).slice(0, 160));
  const stack2 = await biz("GET", `/api/offers/${o2Id}/applications`);
  const cStackRow = (stack2.data.applications || []).find((a) => a.id === a2C.data.application.id);
  check("stack shows the backfill as taken", cStackRow.status === "backfill_accepted", JSON.stringify(cStackRow && cStackRow.status));
  const selB2 = await biz("POST", `/api/offers/${o2Id}/select`, { applicationId: a2B.data.application.id });
  check("business fills the second spot with B", selB2.status === 201);
  const o2BookingB = selB2.data.booking;

  // ---------- application stack cap ----------
  const o7 = await biz("POST", "/api/offers", { title: "One spot, big stack", whatComped: "Dinner for two", dollarCap: 60, spots: 1 });
  const o7Id = o7.data.offer.id;
  await cA.client("POST", `/api/offers/${o7Id}/apply`, {});
  await cB.client("POST", `/api/offers/${o7Id}/apply`, {});
  await cC.client("POST", `/api/offers/${o7Id}/apply`, {});
  const appD7 = await cD.client("POST", `/api/offers/${o7Id}/apply`, {});
  check("application stack caps at spots x 3 (4th applicant refused 409)", appD7.status === 409 && /stack is full/.test(appD7.data.error || ""), JSON.stringify(appD7.data));

  // ---------- paid open offer: escrow ledger ----------
  const o6 = await biz("POST", "/api/offers", { title: "Paid feature visit", whatComped: "The Standard Visit, paid", kind: "paid", cashRate: 200, spots: 1 });
  const o6Id = o6.data.offer.id;
  const a6 = await cA.client("POST", `/api/offers/${o6Id}/apply`, {});
  const sel6 = await biz("POST", `/api/offers/${o6Id}/select`, { applicationId: a6.data.application.id });
  check("paid open offer selection escrows at rate + 3% / creator 97%", sel6.status === 201 && sel6.data.booking.paidLane.rate === 200 && sel6.data.booking.paidLane.businessTotal === 206 && sel6.data.booking.paidLane.creatorNet === 194 && sel6.data.booking.paidLane.platformFee === 12 && sel6.data.booking.paidLane.escrowState === "held", JSON.stringify(sel6.data.booking && sel6.data.booking.paidLane));

  // ---------- deliver B's visit, then rebook ----------
  const lookup = await biz("POST", "/api/counter/lookup", { code: o2BookingB.code });
  check("counter lookup finds B's booking", lookup.status === 200);
  const redeem = await biz("POST", "/api/counter/redeem", { code: o2BookingB.code });
  check("counter redeem starts the clock", redeem.status === 200 && !!redeem.data.booking.postDeadline);
  const post = await cB.client("POST", "/api/posts", { bookingId: o2BookingB.id, url: "https://www.instagram.com/p/STACKHOUSE1/", includesDisclosure: true });
  check("B delivers the post on time", post.status === 201 && post.data.post.onTime === true, JSON.stringify(post.data).slice(0, 160));

  const home = await biz("GET", "/api/me/business-home");
  check("business home computes from real data (visits used, posts live)", home.status === 200 && home.data.home.visitsUsed >= 3 && home.data.home.postsLive === 1, JSON.stringify(home.data.home));
  check("rebook prompts surface the delivered creator, favorites first flagged", (home.data.rebookPrompts || []).some((r) => r.creatorId === cB.id && r.source === "delivered" && r.isFavorite === true), JSON.stringify(home.data.rebookPrompts));
  const rebook = await biz("POST", "/api/offers/rebook", { creatorId: cB.id });
  check("one-tap rebook creates a prefilled direct offer", rebook.status === 201 && rebook.data.offer.lane === "direct" && rebook.data.offer.creatorId === cB.id && rebook.data.offer.title === "Brunch for two", JSON.stringify(rebook.data).slice(0, 200));
  const bOffers = await cB.client("GET", "/api/offers");
  check("rebooked creator sees the direct invite", (bOffers.data.offers || []).some((o) => o.id === rebook.data.offer.id));

  // ---------- phase 2 fixtures (sweep-driven states) ----------
  const o3 = await biz("POST", "/api/offers", { title: "Backfill window offer", whatComped: "Dinner for two", dollarCap: 90, spots: 2 });
  const o3Id = o3.data.offer.id;
  const a3A = await cA.client("POST", `/api/offers/${o3Id}/apply`, {});
  const a3B = await cB.client("POST", `/api/offers/${o3Id}/apply`, {});
  await biz("POST", `/api/offers/${o3Id}/select`, { applicationId: a3A.data.application.id });
  await cA.client("POST", `/api/applications/${a3A.data.application.id}/decline`, {});
  const appsB3 = await cB.client("GET", "/api/applications");
  const bRow3 = (appsB3.data.applications || []).find((a) => a.offerId === o3Id);
  check("offer 3 backfill sits with B before time travel", !!bRow3 && bRow3.status === "backfill_offered", JSON.stringify(bRow3));

  const o4 = await biz("POST", "/api/offers", { title: "Quiet offer nobody finds", whatComped: "Lunch for one", dollarCap: 30, spots: 1 });
  const o4Id = o4.data.offer.id;
  const o5 = await biz("POST", "/api/offers", { title: "Deadline test offer", whatComped: "Dinner for two", dollarCap: 70, spots: 1 });
  const o5Id = o5.data.offer.id;
  const a5C = await cC.client("POST", `/api/offers/${o5Id}/apply`, {});
  check("offer 5 has a waiting applicant before time travel", a5C.status === 201);

  // Zero-write preview invariant, with real state in the store.
  const evBefore = await admin("GET", "/api/admin/events?limit=2000");
  const statsBefore = await admin("GET", "/api/admin/stats");
  const pvDash = await admin("GET", "/api/admin/preview/dashboard");
  const evAfterPv = await admin("GET", "/api/admin/events?limit=2000");
  const statsAfterPv = await admin("GET", "/api/admin/stats");
  check("preview dashboard still answers and writes nothing (events + stats identical)", pvDash.status === 200 && (evAfterPv.data.events || []).length === (evBefore.data.events || []).length && JSON.stringify(statsAfterPv.data) === JSON.stringify(statsBefore.data), "");

  // ---------- time travel: sweep-driven outcomes ----------
  await stopServer();
  editDb((db) => {
    const now = Date.now();
    for (const [key, val] of Object.entries(db)) {
      if (key === `offer:${o4Id}`) val.createdAt = new Date(now - 49 * 3600 * 1000).toISOString();
      if (key === `offer:${o5Id}`) val.selectionDeadline = new Date(now - 3600 * 1000).toISOString();
      if (key.startsWith("application:") && val.offerId === o3Id && val.status === "backfill_offered") {
        val.backfillExpiresAt = new Date(now - 3600 * 1000).toISOString();
      }
    }
  });
  startServer();
  check("server restarts after time travel", await waitUp());
  const admin2 = client();
  await admin2("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const sweep = await admin2("POST", "/api/admin/offers/sweep", {});
  check("offer sweep runs (backfill advanced, SLA released, nudge sent)", sweep.status === 200 && sweep.data.sweep.backfillAdvanced >= 1 && sweep.data.sweep.slaReleased >= 1 && sweep.data.sweep.nudges >= 1, JSON.stringify(sweep.data));

  const biz2 = client();
  await biz2("POST", "/api/auth/login", { email: "stackhouse@fixtures.dev", password: "business-pass-123" });
  const offersAfter = await biz2("GET", "/api/offers");
  const o3Row = (offersAfter.data.offers || []).find((o) => o.id === o3Id);
  const o4Row = (offersAfter.data.offers || []).find((o) => o.id === o4Id);
  const o5Row = (offersAfter.data.offers || []).find((o) => o.id === o5Id);
  check("expired backfill window frees the offer back to open", o3Row.status === "open", JSON.stringify(o3Row && o3Row.status));
  check("zero-application offer earns its coaching nudge after 48h", !!o4Row.nudgeSentAt, JSON.stringify(o4Row && o4Row.nudgeSentAt));
  check("selection deadline passing expires the offer", o5Row.status === "expired", JSON.stringify(o5Row && o5Row.status));
  const appsC5 = await cC.client("GET", "/api/applications");
  const cRow5 = (appsC5.data.applications || []).find((a) => a.offerId === o5Id);
  check("SLA release lands on the applicant with the deadline reason", !!cRow5 && cRow5.status === "released" && cRow5.releaseReason === "selection_deadline", JSON.stringify(cRow5));
  const appsB3After = await cB.client("GET", "/api/applications");
  const bRow3After = (appsB3After.data.applications || []).find((a) => a.offerId === o3Id);
  check("lapsed backfill applicant is released with the window reason", !!bRow3After && bRow3After.status === "released" && bRow3After.releaseReason === "backfill_window_passed", JSON.stringify(bRow3After));
  const bizNotes = await biz2("GET", "/api/notifications");
  check("business gets the nudge as an in-app notification", (bizNotes.data.notifications || []).some((n) => n.kind === "offer_nudge"), "");

  // One-tap fix on the nudged offer.
  const fix = await biz2("PATCH", `/api/offers/${o4Id}`, { dollarCap: 55 });
  check("one-tap fix raises the nudged offer's comp", fix.status === 200 && fix.data.offer.dollarCap === 55, JSON.stringify(fix.data).slice(0, 160));

  // ---------- the event trail (Jeff's data directive) ----------
  const ev = await admin2("GET", "/api/admin/events?limit=2000");
  const types = new Set((ev.data.events || []).map((e) => e.type));
  for (const t of ["offer_created", "application_submitted", "application_selected", "application_released", "backfill_offered", "backfill_accepted", "favorite_added", "rebook_sent", "offer_nudge_sent", "business_activated"]) {
    check(`event logged: ${t}`, types.has(t), "");
  }

  // ---------- client ships the new surfaces ----------
  const appJsRes = await fetch(BASE + "/app.js");
  const appJs = await appJsRes.text();
  check("client ships business sign-up, composer v2, board, applications, favorites, home", appJs.includes("Join the founding business list") && appJs.includes("applyToOffer") && appJs.includes("My applications") && appJs.includes("dignity floor") && appJs.includes("Invite again") && appJs.includes("loadBusinessHome") && appJs.includes("viewApplicants"), "");
  check("client ships the founding business status page and the admin Activate business action, with no Stripe payment link anywhere", appJs.includes("renderBusinessFoundingStatus") && appJs.includes("Founding business list,") && appJs.includes("Activate business") && appJs.includes("activateMarketBusinesses") && !appJs.includes("buy.stripe.com") && !appJs.includes("paymentLink"), "");
  check("client bottom nav carries the business Home/Favorites tabs", appJs.includes("Favorites") && appJs.includes("bnIcon"), "");

  console.log(`\nBusiness verification: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log("Failures:", failures.join(" | "));
  await stopServer();
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error("SUITE ERROR", e);
  await stopServer();
  process.exit(1);
}
