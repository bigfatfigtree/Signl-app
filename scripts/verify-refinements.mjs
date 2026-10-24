// Refinement bundle (Jeff, 2026-10-20 late): the five rules Jeff
// approved together, walked against the real server:
//   ITEM 1 covers: default 1 on comp offers, explicit 2 honored,
//     stamped on the booking, visible in the staff lookup view;
//     legacy records (no covers field) read as 1
//   ITEM 2 paid brief: stored on paid offers and direct paid
//     bookings, refused on comp offers, capped at 500 chars, the
//     creator sees it before accepting, events log hasBrief
//   ITEM 3 strikes: an expired redemption window counts a strike;
//     3 strikes pause the account (strike source, so a proof can
//     never lift it) with in-app + event evidence; honor-voided
//     bookings never strike; admin reinstatement resets the count
//     to probation (2 of 3) and one more expiry re-pauses
//   ITEM 4 free line: the exact line is in the campaign, claim,
//     approval, and signup emails and in the served client; no
//     "no fees" overclaim strings anywhere in the shipped code
//   ITEM 5 guarantee: the Visit Guarantee line is a single shared
//     constant with the exact published wording
//   ITEM 6 preview staff demo: the dashboard payload carries the
//     demo (staff code, known demo PIN, one redeemable sample
//     code), preview calls write NOTHING (no staff records, no
//     events, stats identical), and the real staff endpoints have
//     never heard of the demo code or PIN
// Run: node scripts/verify-refinements.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require2 = createRequire(import.meta.url);
const R = require2("../netlify/functions/lib/router.js");

const PORT = 8941;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-refinements-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`);
  }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (v) jar.set(k, v); else jar.delete(k);
      }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data, text };
  };
}

async function raw(method, p, { body, cookie } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, headers: res.headers, data, text, setCookies };
}

function cookieValue(setCookies, name) {
  for (const sc of setCookies || []) {
    const pair = sc.split(";")[0];
    const i = pair.indexOf("=");
    if (i > -1 && pair.slice(0, i).trim() === name) return pair.slice(i + 1).trim();
  }
  return null;
}

let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    env: {
      ...process.env,
      SIGNL_LOCAL: "1",
      SIGNL_LOCAL_DB: DB,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      APP_URL: BASE,
      SIGNL_TEST_ALLOW_BUSINESS: "1",
      SIGNL_MAIL_STUB: "1",
    },
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
function readDb() {
  return JSON.parse(fs.readFileSync(DB, "utf8"));
}

const admin = client();

async function makeCreator(handle, email, name) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator",
    name,
    email,
    password: "creator-pass-123",
    market: "Hampton Roads",
    city: "Virginia Beach",
    handle,
    tierBand: "Locals",
    followerCount: 8400,
    avgViews: 6200,
    localAudiencePct: 62,
    categories: ["Food & Drink"],
    bio: "Verification account created by scripts/verify-refinements.mjs",
    agreedHonestPosts: true,
    agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} registration failed: ${JSON.stringify(reg.data)}`);
  const approve = await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  if (approve.status !== 200) throw new Error(`creator ${handle} approval failed`);
  return { client: c, id: reg.data.user.id, handle, name };
}

async function makeBusiness(businessName, email) {
  const b = client();
  const reg = await b("POST", "/api/auth/register", {
    role: "business",
    name: `${businessName} Owner`,
    businessName,
    email,
    password: "business-pass-123",
    market: "Hampton Roads",
    city: "Norfolk",
    category: "Restaurant",
    planId: "growth",
    agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} registration failed: ${JSON.stringify(reg.data)}`);
  const id = reg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  const act = await admin("POST", "/api/admin/businesses/activate", { userId: id });
  if (act.status !== 200) throw new Error(`business ${businessName} activation failed`);
  return { client: b, id, businessName, email };
}

async function eventsOf(type) {
  const ev = await admin("GET", "/api/admin/events?limit=2000");
  return (ev.data.events || []).filter((e) => e.type === type);
}

async function expireBookingAndSweep(bookingId) {
  await stopServer();
  editDb((db) => {
    const key = `booking:${bookingId}`;
    if (!db[key]) throw new Error(`booking ${bookingId} not in db`);
    db[key].redeemBy = new Date(Date.now() - 3600 * 1000).toISOString();
  });
  startServer();
  if (!(await waitUp())) throw new Error("server did not come back up");
  const sweep = await admin("POST", "/api/admin/compliance/sweep", {});
  if (sweep.status !== 200) throw new Error(`sweep failed: ${JSON.stringify(sweep.data)}`);
  return sweep.data.sweep;
}

try {
  startServer();
  check("dev server boots", await waitUp());
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // ---------------- unit level: helpers + copy ----------------
  check("coversOf defaults legacy records to 1", R.coversOf({}) === 1 && R.coversOf({ covers: 3 }) === 1 && R.coversOf({ covers: "x" }) === 1);
  check("coversOf honors an explicit 2", R.coversOf({ covers: 2 }) === 2);
  check("coversText speaks both ways", R.coversText({ covers: 2 }) === "Comp covers 2 people" && R.coversText({}) === "Comp covers you");
  check("the free line is the exact approved wording", R.CREATOR_FREE_LINE === "SIGNL is free for creators. Always. Businesses pay the platform. You never pay to join, to list, or to get booked.", R.CREATOR_FREE_LINE);
  check("the Visit Guarantee line is the exact published wording", R.VISIT_GUARANTEE_LINE === "Visit Guarantee: if a booked creator does not show up or does not post, that visit does not count against your monthly visits. It is replaced.", R.VISIT_GUARANTEE_LINE);
  check("the brief guidance is the exact boundary copy", R.PAID_BRIEF_GUIDANCE === "Key points only: what to feature, names, dates. Creators post honestly in their own words. No scripts, no required praise, no post pre-approval.", R.PAID_BRIEF_GUIDANCE);
  check("strike status line is the plain-language wording (AB1: no counter, no threshold)", R.strikeStatusLine({ noShowStrikes: 1 }) === "Visit strikes: 1. Letting a booked visit window expire unused counts as a strike, and strikes can pause your account for review." && R.strikeStatusLine({}) === null, R.strikeStatusLine({ noShowStrikes: 1 }));
  check("strike limit and probation constants", R.STRIKE_LIMIT === 3 && R.STRIKE_PROBATION_COUNT === 2);

  const sampleUser = { name: "Casey Refine", email: "casey@fixtures.dev", market: "Hampton Roads", city: "Norfolk", creator: { handle: "caseyrefine", tierBand: "Locals", categories: ["Food & Drink"], localAudiencePct: 55, audienceStack: { instagram: 3000 }, followerCount: 3000, totalAudience: 3000, bestWork: [], bio: "", hasPhoto: false, neighborhood: "" } };
  const claimMail = R.claimConfirmationEmail(sampleUser, 100);
  check("claim confirmation email carries the free line", claimMail.text.includes(R.CREATOR_FREE_LINE));
  const approvalMail = R.approvalEmail(sampleUser, 100);
  check("approval email carries the free line", approvalMail.text.includes(R.CREATOR_FREE_LINE));
  const signupMail = R.signupConfirmationEmail(sampleUser, 100);
  check("signup confirmation email carries the free line", signupMail.text.includes(R.CREATOR_FREE_LINE));
  const campMail = R.campaignEmail({ name: "Casey Refine", handle: "caseyrefine", market: "Hampton Roads", opener: "your Oceanfront food posts" });
  check("campaign email carries the free line", campMail.text.includes(R.CREATOR_FREE_LINE), campMail.text);
  check("campaign email no longer carries the old fee-adjacent line", !campMail.text.includes("only fee anywhere") && !campMail.text.includes("joining plus comped visits"));
  const strikeMail = R.strikePauseEmail({ ...sampleUser, noShowStrikes: 3 });
  check("strike pause email states the count and the probation term (AB1: no threshold math)", strikeMail.text.includes("Visit strikes: 3.") && strikeMail.text.includes("restarts on probation") && strikeMail.text.includes("another expired window can pause it again") && !strikeMail.text.includes("of 3"), strikeMail.text);
  check("no email builder output carries an em dash", [claimMail, approvalMail, signupMail, campMail, strikeMail].every((m) => !m.text.includes("—") && !m.text.includes("–") && !m.subject.includes("—")));

  // Overclaim audit over the shipped sources themselves.
  const routerSrc = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "netlify/functions/lib/router.js"), "utf8");
  const appSrc = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public/app.js"), "utf8");
  check("no 'no fees' overclaim strings in the shipped app or server code", !/no fees/i.test(routerSrc) && !/no fees/i.test(appSrc));
  check("served client carries the free line, the guarantee, and the brief guidance", appSrc.includes(R.CREATOR_FREE_LINE) && appSrc.includes(R.VISIT_GUARANTEE_LINE) && appSrc.includes(R.PAID_BRIEF_GUIDANCE));

  // ---------------- fixtures ----------------
  const cStrike = await makeCreator("strikecreator", "strike@fixtures.dev", "Strike Creator");
  const cHonor = await makeCreator("honorcreator", "honor@fixtures.dev", "Honor Creator");
  const biz = await makeBusiness("Refinement Bistro", "bistro@fixtures.dev");

  // ---------------- ITEM 1: covers ----------------
  const oDefault = await biz.client("POST", "/api/offers", { title: "Default covers dinner", whatComped: "Dinner for the creator", dollarCap: 80, spots: 1, creatorId: cStrike.id });
  check("comp offer without covers defaults to 1", oDefault.status === 201 && oDefault.data.offer.covers === 1, JSON.stringify(oDefault.data).slice(0, 200));
  const oTwo = await biz.client("POST", "/api/offers", { title: "Dinner for two on us", whatComped: "Two entrees and two drinks", dollarCap: 110, spots: 1, covers: 2, creatorId: cStrike.id });
  check("comp offer with covers 2 stores 2", oTwo.status === 201 && oTwo.data.offer.covers === 2, JSON.stringify(oTwo.data).slice(0, 200));
  const cOffers = await cStrike.client("GET", "/api/offers");
  const seenTwo = (cOffers.data.offers || []).find((o) => o.id === oTwo.data.offer.id);
  check("creator's offer checklist payload carries covers 2", !!seenTwo && seenTwo.covers === 2, JSON.stringify(seenTwo || null));
  const accTwo = await cStrike.client("POST", `/api/offers/${oTwo.data.offer.id}/accept`, {});
  check("accepting the covers-2 offer stamps covers 2 on the booking", accTwo.status === 201 && accTwo.data.booking.covers === 2, JSON.stringify(accTwo.data).slice(0, 240));
  const patchCovers = await biz.client("PATCH", `/api/offers/${oDefault.data.offer.id}`, { covers: 2 });
  check("PATCH can change covers on a comp offer", patchCovers.status === 200 && patchCovers.data.offer.covers === 2, JSON.stringify(patchCovers.data).slice(0, 200));

  // Staff view shows covers (real staff flow against the booking).
  const pinSet = await biz.client("POST", "/api/me/staff/pin", { pin: "1357" });
  check("owner sets a staff PIN for the covers check", pinSet.status === 200, JSON.stringify(pinSet.data));
  const staffInfo = await biz.client("GET", "/api/me/staff");
  const staffCode = staffInfo.data.staffCode;
  const entered = await raw("POST", "/api/staff/enter", { body: { businessCode: staffCode, pin: "1357" } });
  const staffCookie = cookieValue(entered.setCookies, "signl_staff");
  check("staff session opens for the covers check", entered.status === 200 && !!staffCookie, JSON.stringify(entered.data));
  const lookup = await raw("POST", "/api/staff/lookup", { body: { code: accTwo.data.booking.code }, cookie: `signl_staff=${staffCookie}` });
  check("staff lookup view carries covers 2 for the visit", lookup.status === 200 && lookup.data.booking && lookup.data.booking.covers === 2, JSON.stringify(lookup.data).slice(0, 240));

  // ---------------- ITEM 2: paid brief ----------------
  const briefText = "Feature the new patio, use our full name, the tasting runs through November.";
  const oPaid = await biz.client("POST", "/api/offers", { title: "Paid patio feature", whatComped: "The Standard Visit package", kind: "paid", cashRate: 200, spots: 1, paidBrief: briefText, creatorId: cStrike.id });
  check("paid offer stores the brief", oPaid.status === 201 && oPaid.data.offer.paidBrief === briefText, JSON.stringify(oPaid.data).slice(0, 240));
  const oCompBrief = await biz.client("POST", "/api/offers", { title: "Comp with a brief", whatComped: "Dinner", dollarCap: 60, spots: 1, paidBrief: "Say the soup is great", creatorId: cStrike.id });
  check("a brief on a comp offer is refused server-side", oCompBrief.status === 400 && /paid visit feature/.test(oCompBrief.data.error || ""), JSON.stringify(oCompBrief.data));
  const longBrief = "x".repeat(600);
  const oLong = await biz.client("POST", "/api/offers", { title: "Paid long brief", whatComped: "The Standard Visit package", kind: "paid", cashRate: 200, spots: 1, paidBrief: longBrief, creatorId: cHonor.id });
  check("the brief is capped at 500 characters", oLong.status === 201 && oLong.data.offer.paidBrief.length === 500, String(oLong.data.offer && oLong.data.offer.paidBrief && oLong.data.offer.paidBrief.length));
  const cOffers2 = await cStrike.client("GET", "/api/offers");
  const seenPaid = (cOffers2.data.offers || []).find((o) => o.id === oPaid.data.offer.id);
  check("creator sees the brief on the paid offer before accepting", !!seenPaid && seenPaid.paidBrief === briefText);
  const accPaid = await cStrike.client("POST", `/api/offers/${oPaid.data.offer.id}/accept`, {});
  check("the booking from a paid offer carries the brief", accPaid.status === 201 && accPaid.data.booking.paidBrief === briefText, JSON.stringify(accPaid.data).slice(0, 240));
  const createdEvents = await eventsOf("offer_created");
  check("offer_created event logs brief presence", createdEvents.some((e) => e.subjectId === oPaid.data.offer.id && e.data && e.data.hasBrief === true) && createdEvents.some((e) => e.subjectId === oTwo.data.offer.id && e.data && e.data.hasBrief === false && e.data.covers === 2));

  // Direct paid booking with a brief (creator lists a rate first).
  const rateSet = await cHonor.client("PATCH", "/api/me/profile", { paidRate: 250 });
  check("creator lists a paid rate for the direct booking check", rateSet.status === 200, JSON.stringify(rateSet.data).slice(0, 160));
  const directPaid = await biz.client("POST", "/api/bookings/paid", { creatorId: cHonor.id, paidBrief: "Lead with the raw bar; soft opening is Friday." });
  check("direct paid booking stores the brief", directPaid.status === 201 && directPaid.data.booking.paidBrief === "Lead with the raw bar; soft opening is Friday.", JSON.stringify(directPaid.data).slice(0, 240));
  const paidEvents = await eventsOf("paid_booking_created");
  check("paid_booking_created event logs brief presence", paidEvents.some((e) => e.subjectId === directPaid.data.booking.id && e.data && e.data.hasBrief === true));

  // ---------------- ITEM 3: strikes ----------------
  // Strike 1: the covers-2 booking expires unused.
  const sweep1 = await expireBookingAndSweep(accTwo.data.booking.id);
  check("sweep expires the unused window and counts a strike", sweep1.expired >= 1 && sweep1.strikes >= 1, JSON.stringify(sweep1));
  let meStrike = await cStrike.client("GET", "/api/auth/me");
  check("creator record shows 1 strike", meStrike.data.user.noShowStrikes === 1, JSON.stringify(meStrike.data.user.noShowStrikes));
  check("creator_strike event logged", (await eventsOf("creator_strike")).some((e) => e.subjectId === cStrike.id && e.data && e.data.strikes === 1));

  // Honor-void exclusion: cHonor books, reports the business did
  // not honor, window passes, sweep must not expire or strike.
  const oHonor = await biz.client("POST", "/api/offers", { title: "Honor path dinner", whatComped: "Dinner for two", dollarCap: 90, spots: 1, covers: 2, creatorId: cHonor.id });
  const accHonor = await cHonor.client("POST", `/api/offers/${oHonor.data.offer.id}/accept`, {});
  check("honor-path booking created", accHonor.status === 201, JSON.stringify(accHonor.data).slice(0, 160));
  const honorRep = await cHonor.client("POST", `/api/bookings/${accHonor.data.booking.id}/honor-report`, { reason: "Kitchen said they never agreed to the comp" });
  check("honor report files", honorRep.status === 200, JSON.stringify(honorRep.data).slice(0, 160));
  await expireBookingAndSweep(accHonor.data.booking.id);
  const meHonor = await cHonor.client("GET", "/api/auth/me");
  check("honor-voided booking never strikes", (meHonor.data.user.noShowStrikes || 0) === 0, JSON.stringify(meHonor.data.user.noShowStrikes));
  const honorBk = (await cHonor.client("GET", "/api/bookings")).data.bookings.find((b) => b.id === accHonor.data.booking.id);
  check("honor-voided booking is not expired by the sweep", !!honorBk && honorBk.status !== "expired", honorBk && honorBk.status);

  // Strikes 2 and 3 on cStrike, then the pause.
  for (const n of [2, 3]) {
    const o = await biz.client("POST", "/api/offers", { title: `Strike window ${n}`, whatComped: "Dinner", dollarCap: 70, spots: 1, creatorId: cStrike.id });
    const acc = await cStrike.client("POST", `/api/offers/${o.data.offer.id}/accept`, {});
    if (acc.status !== 201) throw new Error(`strike fixture ${n} accept failed: ${JSON.stringify(acc.data)}`);
    await expireBookingAndSweep(acc.data.booking.id);
  }
  meStrike = await cStrike.client("GET", "/api/auth/me");
  check("three expired windows count three strikes", meStrike.data.user.noShowStrikes === 3, JSON.stringify(meStrike.data.user.noShowStrikes));
  check("the third strike pauses the account with the strike source", meStrike.data.user.standing && meStrike.data.user.standing.state === "paused" && meStrike.data.user.standing.source === "strikes", JSON.stringify(meStrike.data.user.standing));
  check("account_paused_strikes event logged", (await eventsOf("account_paused_strikes")).some((e) => e.subjectId === cStrike.id));
  const notifs = await cStrike.client("GET", "/api/notifications");
  check("the creator is notified in-app about the strike pause", (notifs.data.notifications || []).some((n) => n.kind === "account_paused_strikes"), JSON.stringify(notifs.data).slice(0, 240));
  const oWhilePaused = await biz.client("POST", "/api/offers", { title: "While paused", whatComped: "Dinner", dollarCap: 70, spots: 1, creatorId: cStrike.id });
  check("business cannot send an offer to a strike-paused creator (strike wording)", oWhilePaused.status === 400 && /paused pending a SIGNL review/.test(oWhilePaused.data.error || ""), JSON.stringify(oWhilePaused.data));
  const oForPaused = await biz.client("POST", "/api/offers", { title: "Open while paused", whatComped: "Dinner", dollarCap: 70, spots: 1 });
  const accWhilePaused = await cStrike.client("POST", `/api/offers/${oForPaused.data.offer.id}/accept`, {});
  check("strike-paused creator cannot accept (strike wording, no post-link promise)", accWhilePaused.status === 403 && /paused pending a SIGNL review/.test(accWhilePaused.data.error || ""), JSON.stringify(accWhilePaused.data));

  // Reinstatement: probation at 2 of 3, one more expiry re-pauses.
  const reinst = await admin("POST", "/api/admin/compliance/reinstate", { userId: cStrike.id, note: "Explained the absences; one more chance." });
  check("admin reinstates the strike-paused creator", reinst.status === 200 && reinst.data.user.standing.state === "good", JSON.stringify(reinst.data).slice(0, 200));
  meStrike = await cStrike.client("GET", "/api/auth/me");
  check("reinstatement resets strikes to probation (2 of 3)", meStrike.data.user.noShowStrikes === 2, JSON.stringify(meStrike.data.user.noShowStrikes));
  const oProb = await biz.client("POST", "/api/offers", { title: "Probation window", whatComped: "Dinner", dollarCap: 70, spots: 1, creatorId: cStrike.id });
  const accProb = await cStrike.client("POST", `/api/offers/${oProb.data.offer.id}/accept`, {});
  check("reinstated creator can accept again", accProb.status === 201, JSON.stringify(accProb.data).slice(0, 160));
  await expireBookingAndSweep(accProb.data.booking.id);
  meStrike = await cStrike.client("GET", "/api/auth/me");
  check("one more expiry on probation re-pauses the account", meStrike.data.user.noShowStrikes === 3 && meStrike.data.user.standing && meStrike.data.user.standing.state === "paused" && meStrike.data.user.standing.source === "strikes", JSON.stringify({ s: meStrike.data.user.noShowStrikes, st: meStrike.data.user.standing }));

  // ---------------- ITEM 6: preview staff demo ----------------
  const evBefore = await admin("GET", "/api/admin/events?limit=2000");
  const statsBefore = await admin("GET", "/api/admin/stats");
  const pv = await admin("GET", "/api/admin/preview/dashboard");
  check("preview dashboard answers with a staff demo", pv.status === 200 && !!pv.data.dashboard.staffDemo, JSON.stringify(pv.data).slice(0, 200));
  const demo = pv.data.dashboard.staffDemo;
  check("demo carries the fixed staff code and known demo PIN", demo.staffCode === "EMBER6" && demo.demoPin === "2468" && demo.registerPath === "/redeem/EMBER6", JSON.stringify(demo));
  const bookedPv = (pv.data.dashboard.bookings || []).find((b) => b.state === "booked");
  check("demo redeem code is the sample booked visit's code", !!bookedPv && demo.redeemCode === bookedPv.code && !!demo.redeemVisit && demo.redeemVisit.covers === 2, JSON.stringify(demo).slice(0, 240));
  check("server demo constants match the payload", R.PREVIEW_STAFF_DEMO.staffCode === demo.staffCode && R.PREVIEW_STAFF_DEMO.pin === demo.demoPin);
  // More preview traffic, including a simulated offer send.
  await admin("GET", "/api/admin/preview/dashboard");
  const pvOffer = await admin("POST", "/api/admin/preview/offers", { title: "Demo night", whatComped: "Dinner for two", dollarCap: 90, spots: 1, covers: 2 });
  check("preview offer simulation honors covers", pvOffer.status === 201 && pvOffer.data.offer.covers === 2, JSON.stringify(pvOffer.data).slice(0, 200));
  const evAfter = await admin("GET", "/api/admin/events?limit=2000");
  const statsAfter = await admin("GET", "/api/admin/stats");
  check("preview writes nothing (events + stats identical)", (evAfter.data.events || []).length === (evBefore.data.events || []).length && JSON.stringify(statsAfter.data) === JSON.stringify(statsBefore.data));
  const dbNow = readDb();
  const staffKeys = Object.keys(dbNow).filter((k) => k.startsWith("staffpin:") || k.startsWith("staffcfg:") || k.startsWith("staffsession:") || k.startsWith("bizcode:"));
  check("no real staff records exist for the demo (only the fixture business's own)", staffKeys.every((k) => !k.includes("EMBER6")) && !JSON.stringify(dbNow).includes("2468"), staffKeys.join(","));
  const demoResolve = await raw("GET", "/api/staff/business?code=EMBER6");
  check("the real staff endpoints do not resolve the demo code", demoResolve.status === 404, String(demoResolve.status));
  const demoEnter = await raw("POST", "/api/staff/enter", { body: { businessCode: "EMBER6", pin: "2468" } });
  check("the real staff entry refuses the demo PIN and code", demoEnter.status !== 200 && !cookieValue(demoEnter.setCookies, "signl_staff"), String(demoEnter.status));

  console.log(`\nRefinement verification: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
  await stopServer();
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error("SUITE ERROR:", err);
  await stopServer();
  process.exit(1);
}
