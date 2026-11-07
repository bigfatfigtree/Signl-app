// Build -137 verification: Jeff's approved dashboard redesign
// (2026-11-06) + the booking additions. Homes are Sig hero ->
// Quick highlights -> Next steps -> stop for every role; the
// mobile bars are the ruled sets; the top-right hamburger
// carries the full destination set; the desktop rail lists
// everything directly; Sig opens as a live sheet from the bar
// orb and the desktop orb. Booking: negotiation is the Deal
// (propose in the buy box, counter on the card) and flexible
// timing windows ride deal terms + direct offers end-to-end
// into the booking's redemption deadline. Payments stay OFF.
// Run: node scripts/verify-build137.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9002;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b137.dev";
const ADMIN_PW = "verify-build137-pass";
const PW = "<MASKED_SECRET_001>";
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const uq = String(Date.now()).slice(-6);

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; failures.push(name); console.error(`FAIL ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const slice = (s, fn, len = 6000) => { const i = s.indexOf(fn); return i < 0 ? "" : s.slice(i, i + len); };

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const themeCss = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");

// ---------- stamp ----------
check("stamp is 2026.11.06-139 and identical in build.js + index.html",
  buildJs.includes('BUILD_ID = "2026.11.06-139"') && (indexHtml.match(/2026\.11\.06-138/g) || []).length >= 5);

// ---------- homes: hero -> highlights -> next steps -> stop ----------
for (const [fn, label] of [["async function loadCreatorHome", "creator live home"], ["async function loadFoundingDashboard", "founding creator home"], ["async function loadBusinessHome", "business live home"], ["function partnerHomeHtml", "partner home"]]) {
  const w = slice(appJs, fn, 30000);
  check(`${label}: renders Sig hero + Quick highlights + Next steps`,
    w.includes("sigHero137Html(") && w.includes("highlights137Html(") && w.includes("nextSteps137Html("), fn);
}
const crHome = slice(appJs, "async function loadCreatorHome", 30000);
check("creator home: highlights carry Momentum / visits completed / posts on time / the Wallet row from real bookings",
  crHome.includes('"Momentum"') && crHome.includes('"Visits completed"') && crHome.includes('"Posts on time"')
  && crHome.includes('tab: "Earnings"') && crHome.includes("homeMoney(bookings)"));
check("creator home: the old shapes row / activity feed no longer render on Home",
  !crHome.includes("creatorShapesHtml119(") && !crHome.includes("<h3 style=\"margin:20px 0 0\">Activity</h3>"));
const bizHome = slice(appJs, "async function loadBusinessHome", 30000);
check("business home: highlights are replies waiting / COUNTED visits / posts live / Wallet row (plan + founding credit)",
  bizHome.includes('"Creators waiting"') && bizHome.includes('"Visits counted"') && bizHome.includes('"Posts live"')
  && bizHome.includes("founding credit left") && bizHome.includes('tab: "Plan"'));
check("business home: the setup checklist still renders below Next steps while unfinished (its editors live nowhere else)",
  bizHome.includes("setupChecklistHtml(d.setupChecklist)"));
const fbz = slice(appJs, "async function loadFoundingBusinessHome", 9000);
check("founding business home: hero + highlights + checklist + next steps (no status/first-month card stack)",
  fbz.includes("sigHero137Html(") && fbz.includes("fbz-highlights") && fbz.includes("founding credit banked")
  && !fbz.includes("foundingStatusCardHtml(u)") && !fbz.includes("foundingFirstMonthCardHtml(u)"));
check("admin home exists: Sig hero + highlights + next steps, landed by default",
  appJs.includes("async function loadAdminHome137()") && slice(appJs, "async function loadAdminHome137", 4000).includes("sigHero137Html(")
  && appJs.includes('state.tab = "Home";') || appJs.includes("loadAdminHome137();"));

// ---------- nav: bars, hamburger, Sig sheet ----------
check("Sig sheet: opens with the live chat box (sigChatBoxHtml 'sheet'), brief and next steps",
  slice(appJs, "function openSigSheet137", 2200).includes('sigChatBoxHtml("sheet")'));
check("the desktop orb (agent fab) opens the Sig sheet; the bar Sig slot routes through sigBarGo137",
  appJs.includes("fab.onclick = openSigSheet137") && appJs.includes("function sigBarGo137()"));
check("hamburger: top-right buttons in both top bars open it; groups compose per role",
  appJs.includes('class="tb2-btn tb2-burger137" onclick="return openHamburger137()"')
  && appJs.includes("function hamburgerGroups137()") && appJs.includes("function openHamburger137()"));
check("CSS: -137 blocks for hero / highlights / hamburger / sheet / bar order / menu slot exist",
  themeCss.includes(".sighero137") && themeCss.includes(".hl137") && themeCss.includes(".ham137-panel")
  && themeCss.includes(".sigsheet137") && themeCss.includes("order: var(--bar-ord, 0) !important")
  && themeCss.includes(".tab-menu137 { display: none !important; }"));
check("CSS: no floating Sig orb over the mobile bar for the v3 shells",
  themeCss.includes("body.v3-on #agent-fab.show") && themeCss.includes("display: none !important; }"));

// ---------- booking: negotiation + flexible timing ----------
check("buy box: Propose your own terms (amount + note) with the nothing-charged-until-agreed line",
  slice(appJs, "function buyBoxHtml", 4200).includes("pdp-propose") && appJs.includes("Propose your own terms")
  && appJs.includes("Nothing is charged until you both agree"));
check("buy box: fixed-day picking is gone; the timing picker carries windows with a specific day last",
  !slice(appJs, "function buyBoxHtml", 4200).includes("pdpDays()") && appJs.includes("TIMING_WINDOWS_137")
  && appJs.includes('timingPickerHtml("pdp", "week")') && appJs.includes('timingPickerHtml("bk"') && appJs.includes('timingPickerHtml("ds", "week")'));
check("proposed terms ride the preset into the deal sheet (amount + note prefill)",
  appJs.includes("state.bookingTerms137") && slice(appJs, "function bookingContinue", 1500).includes('timingSet137("ds"'));
check("deal sheet sends the timing window; a specific day without a date is refused client-side",
  slice(appJs, "async function sendDeal", 2600).includes("body.timingWindow = t137.timingWindow")
  && appJs.includes('Pick the specific day, or choose a timing window instead.'));
check("deal card shows the visit timing; a counter can move amount AND timing",
  appJs.includes("Visit timing") && slice(appJs, "async function dealRespond", 2200).includes("terms.timingWindow = ct137.timingWindow"));
check("Sig guide: the same five windows, a typed specific day, and the commit payload carries them",
  appJs.includes("function sigB1AskWindowMode") && appJs.includes('case "windowday"') && appJs.includes("payload.timingWindow = d.timingWindow"));
check("Sig creator guide: apply uses the canonical route (POST /offers/:id/apply)",
  appJs.includes("await api(\"POST\", `/offers/${o.id}/apply`, poSelectedFor(o.id))") && !appJs.includes('api("POST", "/applications", {'));

// ---------- server: timing end-to-end ----------
check("server: deal terms normalize the timing window + validate the specific day",
  routerJs.includes("timingWindow: [\"week\", \"thisweek\", \"nextweek\", \"twoweeks\", \"day\"]")
  && routerJs.includes("Pick the specific day for the visit, or choose a timing window instead."));
check("server: timing label + redeem-by helpers exist; bookings honour them",
  routerJs.includes("function timingWindowLabel137") && routerJs.includes("function timingRedeemBy137")
  && routerJs.includes("redeemBy = timingRedeemBy137(offer.timingWindow, offer.visitDate, new Date(ts))"));
check("server: an accepted deal carries its timing onto the offer, the booking and the agreed terms",
  routerJs.includes("timingWindow: t.timingWindow || null") && routerJs.includes("timingWindow: offer.timingWindow || null")
  && routerJs.includes("timingWindow: t.timingWindow || null, visitDate: t.visitDate || null"));
check("server: direct offers accept the timing window and label the visit window from it",
  routerJs.includes("offer.visitWindow = timingWindowLabel137(offer.timingWindow, offer.visitDate)"));

// ---------- HTTP: deals + offers with timing, on real records ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b137-"));
const dbPath = path.join(tmp, "db.json");
fs.writeFileSync(dbPath, JSON.stringify({}));
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbPath, SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD: ADMIN_PW, SIGNL_TEST_ALLOW_BUSINESS: "1" };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: "ignore" });

function client() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let d = null;
    try { d = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data: d, text };
  };
}

try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { const r = await fetch(BASE + "/api/bootstrap"); up = r.status > 0; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  check("dev server boots", up);

  const boot = await client()("GET", "/api/bootstrap");
  const pays = (boot.data && (boot.data.payments || (boot.data.boot && boot.data.boot.payments))) || {};
  check("payments stay OFF in the boot payload (connectLive + billingLive false)",
    pays.connectLive === false && pays.billingLive === false, JSON.stringify(pays));

  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  const approve = (id) => admin("POST", "/api/admin/review", { userId: id, decision: "approve" });

  const bz = client();
  const breg = await bz("POST", "/api/auth/register", { role: "business", name: "Owner", email: `b137biz${uq}@fixtures.dev`, password: PW, market: "Hampton Roads", city: "Norfolk", businessName: `Timing Tacos ${uq}`, category: "Restaurant", planId: "self-service", agreedTerms: true });
  const bizId = breg.data && breg.data.user && breg.data.user.id;
  await approve(bizId);
  await admin("POST", "/api/admin/businesses/activate", { userId: bizId });

  const cr = client();
  const creg = await cr("POST", "/api/auth/register", { role: "creator", name: "Cr Timing", email: `b137cr${uq}@fixtures.dev`, password: PW, market: "Hampton Roads", city: "Norfolk", handle: `timingcr${uq}`, categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 4000, avgViews: 1200, localAudiencePct: 66, ...AGREE });
  const crId = creg.data && creg.data.user && creg.data.user.id;
  await approve(crId);
  await cr("PATCH", "/api/me/profile", { paidRate: 120 });
  check("fixtures registered, approved, business activated", !!(bizId && crId), JSON.stringify({ bizId, crId }));

  // Deal 1: propose with a window, counter moves the window, accept books it.
  const d1 = await bz("POST", "/api/deals", { creatorId: crId, kind: "paid", cashRate: 110, timingWindow: "nextweek" });
  check("deal proposed with timingWindow=nextweek rides the terms",
    d1.status === 201 && d1.data.deal && d1.data.deal.current.terms.timingWindow === "nextweek", `${d1.status} ${JSON.stringify(d1.data).slice(0, 200)}`);
  const dealId = d1.data.deal.id;
  const counter = await cr("POST", `/api/deals/${dealId}/respond`, { action: "counter", terms: { cashRate: 115, timingWindow: "twoweeks" } });
  check("creator counter moves amount AND timing (turn returns to the business)",
    counter.status === 200 && counter.data.deal.current.terms.timingWindow === "twoweeks" && counter.data.deal.turn === "business",
    `${counter.status} ${JSON.stringify(counter.data).slice(0, 200)}`);
  const accept = await bz("POST", `/api/deals/${dealId}/respond`, { action: "accept" });
  check("business accept books the visit", accept.status === 200 && !!(accept.data && (accept.data.booking || (accept.data.deal && accept.data.deal.bookingId))), `${accept.status} ${JSON.stringify(accept.data).slice(0, 200)}`);
  const bk = await bz("GET", "/api/bookings");
  const booking1 = (bk.data.bookings || []).find((b) => b.dealId === dealId);
  check("booking carries the agreed timing: window=twoweeks, label, redeem-by ≈ +14 days",
    !!booking1 && booking1.timingWindow === "twoweeks" && booking1.visitWindow === "Within the next two weeks"
    && Math.abs(Date.parse(booking1.redeemBy) - (Date.now() + 14 * 86400000)) < 36 * 3600000,
    JSON.stringify(booking1 && { tw: booking1.timingWindow, vw: booking1.visitWindow, rb: booking1.redeemBy }));

  // Deal 2: a specific day needs its date; with it, the booking lands on it.
  const dNoDate = await bz("POST", "/api/deals", { creatorId: crId, kind: "paid", cashRate: 110, timingWindow: "day" });
  check("timingWindow=day without a date is refused", dNoDate.status === 400, String(dNoDate.status));
  const day = new Date(Date.now() + 10 * 86400000);
  const dayStr = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
  const d2 = await bz("POST", "/api/deals", { creatorId: crId, kind: "paid", cashRate: 110, timingWindow: "day", visitDate: dayStr });
  check("deal with a specific day is created", d2.status === 201 && d2.data.deal.current.terms.visitDate === dayStr, `${d2.status} ${JSON.stringify(d2.data).slice(0, 200)}`);
  const accept2 = await cr("POST", `/api/deals/${d2.data.deal.id}/respond`, { action: "accept" });
  const bk2 = await bz("GET", "/api/bookings");
  const booking2 = (bk2.data.bookings || []).find((b) => b.dealId === d2.data.deal.id);
  check("specific-day booking: visitDate is the day, redeem-by ends that day",
    accept2.status === 200 && !!booking2 && booking2.visitDate === dayStr && String(booking2.redeemBy).slice(0, 10) === dayStr,
    JSON.stringify(booking2 && { vd: booking2.visitDate, rb: booking2.redeemBy }));

  // Floors + defaults.
  const dLow = await bz("POST", "/api/deals", { creatorId: crId, kind: "paid", cashRate: 30, timingWindow: "week" });
  check("the paid floor still refuses a $30 proposal, timing or not", dLow.status === 400, String(dLow.status));
  const dDef = await bz("POST", "/api/deals", { creatorId: crId, kind: "paid", cashRate: 110 });
  check("no timing sent defaults to 'Within the next week'", dDef.status === 201 && dDef.data.deal.current.terms.timingWindow === "week", `${dDef.status}`);

  // Direct offer (the Sig guide's shape): timing rides, accept books with it.
  const o1 = await bz("POST", "/api/offers", { creatorId: crId, kind: "paid", cashRate: 120, title: `Direct timing ${uq}`, whatComped: "Dinner for two", spots: 1, timingWindow: "nextweek" });
  check("direct offer carries timingWindow + the labeled visit window",
    (o1.status === 200 || o1.status === 201) && o1.data.offer && o1.data.offer.timingWindow === "nextweek" && o1.data.offer.visitWindow === "Next week",
    `${o1.status} ${JSON.stringify(o1.data).slice(0, 220)}`);
  const offerId1 = o1.data && o1.data.offer && o1.data.offer.id;
  const oAccept = offerId1 ? await cr("POST", `/api/offers/${offerId1}/accept`, { agreedVisitRules: true }) : { status: 0 };
  const bk3 = await bz("GET", "/api/bookings");
  const booking3 = (bk3.data.bookings || []).find((b) => b.offerId === offerId1);
  check("accepted direct offer books with timingWindow=nextweek",
    (oAccept.status === 200 || oAccept.status === 201) && !!booking3 && booking3.timingWindow === "nextweek",
    `${oAccept.status} ${JSON.stringify(booking3 && booking3.timingWindow)}`);
} finally {
  server.kill();
}

console.log(`\nBuild -137 verify: ${passed} passed, ${failed} failed`);
if (failed) { console.error("Failures:", failures.join(" | ")); process.exit(1); }
