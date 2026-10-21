// Staff redemption mode (Jeff, 2026-10-20 late): the register
// gets its own scoped session so staff can redeem creator visits
// without the owner's login. This suite walks the whole surface
// against the real server:
//   - owner sets a staff PIN (format enforced); the PIN material
//     never rides a payload (GET /me/staff shows only set/not-set)
//   - the register link's staff code resolves the business name
//     publicly; a wrong PIN is refused, 5 wrong PINs lock entry
//     for 15 minutes, and even the right PIN is refused while locked
//   - a staff token is NOT a user session: owner routes answer it
//     401, and the token used as a sign-in cookie resolves nobody
//   - staff lookup is scoped: own business's visit essentials
//     only; a foreign business's code is refused with no data; an
//     unknown code is a plain 404
//   - staff redeem burns the code through the same redemption the
//     owner Counter uses: clock starts, booking stamped via staff,
//     owner notice fires, code_redeemed event carries via=staff
//   - ratings stay owner-only (a staff token cannot rate)
//   - PIN rotation kills the old PIN at once; sign out all staff
//     devices kills live sessions
//   - a founding (not activated) business cannot open staff mode
//   - code lookups are rate limited per staff session
//   - the owner Counter path is unchanged by the shared helper
//     (redeemedVia owner)
// Run: node scripts/verify-staff.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require2 = createRequire(import.meta.url);

const PORT = 8936;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-staff-${Date.now()}.json`);

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

// Raw calls with hand-set cookies: staff work is all about which
// cookie means what, so these tests drive the headers directly.
async function raw(method, p, { body, cookie } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
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

async function loginRaw(email, password) {
  const r = await raw("POST", "/api/auth/login", { body: { email, password } });
  if (r.status !== 200) throw new Error(`raw login failed for ${email}: ${JSON.stringify(r.data)}`);
  const v = cookieValue(r.setCookies, "signl_session");
  if (!v) throw new Error(`no session cookie for ${email}`);
  return `signl_session=${v}`;
}

async function staffEnter(businessCode, pin) {
  const r = await raw("POST", "/api/staff/enter", { body: { businessCode, pin } });
  const token = cookieValue(r.setCookies, "signl_staff");
  return { ...r, staffCookie: token ? `signl_staff=${token}` : null, token };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + "/api/bootstrap");
      if (res.ok) return true;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: {
    ...process.env,
    SIGNL_LOCAL: "1",
    SIGNL_LOCAL_DB: DB,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    APP_URL: BASE,
    SIGNL_TEST_ALLOW_BUSINESS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

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
    bio: "Verification account created by scripts/verify-staff.mjs",
    agreedHonestPosts: true,
    agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} registration failed: ${JSON.stringify(reg.data)}`);
  const approve = await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  if (approve.status !== 200) throw new Error(`creator ${handle} approval failed`);
  return { client: c, id: reg.data.user.id, handle, name };
}

async function makeBusiness(businessName, email, activate) {
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
  if (activate) {
    const act = await admin("POST", "/api/admin/businesses/activate", { userId: id });
    if (act.status !== 200) throw new Error(`business ${businessName} activation failed`);
  }
  return { client: b, id, businessName, email };
}

async function makeBooking(biz, creator, title) {
  const offer = await biz.client("POST", "/api/offers", {
    title,
    whatComped: "Dinner for two",
    dollarCap: 75,
    spots: 1,
    visitWindow: "Any night",
    creatorId: creator.id,
  });
  if (offer.status !== 201) throw new Error(`offer failed: ${JSON.stringify(offer.data)}`);
  const accept = await creator.client("POST", `/api/offers/${offer.data.offer.id}/accept`, { visitDate: "2026-10-22" });
  if (accept.status !== 201) throw new Error(`accept failed: ${JSON.stringify(accept.data)}`);
  return accept.data.booking;
}

function eventData(e) {
  if (!e) return {};
  if (typeof e.data === "string") { try { return JSON.parse(e.data); } catch (err) { return {}; } }
  return e.data || {};
}

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  const creator = await makeCreator("staffeats757", "staffcreator@example.com", "Staff Creator");
  const bizA = await makeBusiness("Staff Table One", "staffbiz1@example.com", true);
  const bizB = await makeBusiness("Staff Table Two", "staffbiz2@example.com", true);
  const bizC = await makeBusiness("Staff Founding", "staffbiz3@example.com", false);
  check("fixtures ready: 1 creator, 2 active businesses, 1 founding business", true);

  const ownerA = await loginRaw("staffbiz1@example.com", "business-pass-123");

  // --- owner staff settings ---
  const settings0 = await raw("GET", "/api/me/staff", { cookie: ownerA });
  check("owner reads staff settings: no PIN set yet", settings0.status === 200 && settings0.data.staffPinSet === false, JSON.stringify(settings0.data));
  const codeA = settings0.data.staffCode;
  check("staff code minted (6 chars) and register link carries it", typeof codeA === "string" && codeA.length === 6 && String(settings0.data.staffLink || "").endsWith(`/redeem/${codeA}`), JSON.stringify(settings0.data));
  check("settings payload carries no PIN material", !("staffPinHash" in settings0.data) && !("staffPinSalt" in settings0.data) && !("salt" in settings0.data) && !("hash" in settings0.data));

  const badPin1 = await raw("POST", "/api/me/staff/pin", { cookie: ownerA, body: { pin: "12" } });
  check("PIN under 4 digits refused (400)", badPin1.status === 400, String(badPin1.status));
  const badPin2 = await raw("POST", "/api/me/staff/pin", { cookie: ownerA, body: { pin: "12ab56" } });
  check("PIN with letters refused (400)", badPin2.status === 400, String(badPin2.status));
  const setPin = await raw("POST", "/api/me/staff/pin", { cookie: ownerA, body: { pin: "2468" } });
  check("owner sets the staff PIN (200)", setPin.status === 200 && setPin.data.staffPinSet === true, JSON.stringify(setPin.data));
  const settings1 = await raw("GET", "/api/me/staff", { cookie: ownerA });
  check("settings now report the PIN set, still without material", settings1.data.staffPinSet === true && settings1.data.staffPinSetAt && !("staffPinHash" in settings1.data));

  const qr = await raw("GET", "/api/me/staff/register-card-qr", { cookie: ownerA });
  const qrGen = require2("qrcode-generator");
  const expectedQr = qrGen(0, "M");
  expectedQr.addData(`${BASE}/redeem/${codeA}`);
  expectedQr.make();
  const expectedSvg = expectedQr.createSvgTag({ cellSize: 6, margin: 8, scalable: true });
  check("register card QR serves the SVG encoding this business's staff link", qr.status === 200 && String(qr.headers.get("content-type") || "").includes("image/svg+xml") && qr.text === expectedSvg, `${qr.status} ${qr.headers.get("content-type")} len=${qr.text.length} expected=${expectedSvg.length}`);
  const qrAnon = await raw("GET", "/api/me/staff/register-card-qr", {});
  check("register card QR refuses anonymous callers (401)", qrAnon.status === 401, String(qrAnon.status));

  // --- the register link identifies the business publicly ---
  const named = await raw("GET", `/api/staff/business?code=${codeA}`, {});
  check("staff code resolves the business name for the PIN screen", named.status === 200 && named.data.businessName === "Staff Table One", JSON.stringify(named.data));
  const unnamed = await raw("GET", "/api/staff/business?code=ZZZZZZ", {});
  check("unknown staff code is a plain 404", unnamed.status === 404, String(unnamed.status));

  // --- staff entry ---
  const wrongPin = await staffEnter(codeA, "0000");
  check("wrong PIN refused (401), no staff cookie issued", wrongPin.status === 401 && !wrongPin.staffCookie, String(wrongPin.status));
  const entered = await staffEnter(codeA, "2468");
  check("correct PIN opens a staff session (200 + staff cookie)", entered.status === 200 && !!entered.staffCookie && entered.data.businessName === "Staff Table One", JSON.stringify(entered.data));
  const staffA = entered.staffCookie;
  const sess = await raw("GET", "/api/staff/session", { cookie: staffA });
  check("staff session reads active with the business name", sess.status === 200 && sess.data.active === true && sess.data.businessName === "Staff Table One", JSON.stringify(sess.data));

  // Owner signed in taps through: no business code needed.
  const ownerEnter = await bizA.client("POST", "/api/staff/enter", { pin: "2468" });
  check("owner signed in enters staff mode with the PIN alone", ownerEnter.status === 200 && ownerEnter.data.businessName === "Staff Table One", JSON.stringify(ownerEnter.data));

  // --- a staff token is not a user session ---
  const scopeBookings = await raw("GET", "/api/bookings", { cookie: staffA });
  check("staff token on GET /bookings: 401 (not a user session)", scopeBookings.status === 401, String(scopeBookings.status));
  const scopeDiscover = await raw("GET", "/api/discover", { cookie: staffA });
  check("staff token on GET /discover: 401", scopeDiscover.status === 401, String(scopeDiscover.status));
  const scopeSettings = await raw("GET", "/api/me/staff", { cookie: staffA });
  check("staff token on owner staff settings: 401", scopeSettings.status === 401, String(scopeSettings.status));
  const scopeQr = await raw("GET", "/api/me/staff/register-card-qr", { cookie: staffA });
  check("staff token on the register card QR: 401", scopeQr.status === 401, String(scopeQr.status));
  const asSession = await raw("GET", "/api/auth/me", { cookie: `signl_session=${entered.token}` });
  check("staff token presented as a sign-in cookie resolves nobody (401)", asSession.status === 401, String(asSession.status));
  const noSess = await raw("POST", "/api/staff/lookup", { body: { code: "SGNL-000000" } });
  check("staff lookup without a staff session: 401", noSess.status === 401, String(noSess.status));

  // --- bookings and the scoped lookup ---
  const bookingA = await makeBooking(bizA, creator, "Staff mode dinner");
  const bookingB = await makeBooking(bizB, creator, "Other business dinner");

  const foreign = await raw("POST", "/api/staff/lookup", { cookie: staffA, body: { code: bookingB.code } });
  check("foreign business code refused (403) with no booking data", foreign.status === 403 && !foreign.data.booking, JSON.stringify(foreign.data));
  const unknown = await raw("POST", "/api/staff/lookup", { cookie: staffA, body: { code: "SGNL-000000" } });
  check("unknown code is a plain 404", unknown.status === 404 && !unknown.data.booking, String(unknown.status));
  const look = await raw("POST", "/api/staff/lookup", { cookie: staffA, body: { code: bookingA.code } });
  const view = look.data.booking || {};
  check("own code lookup returns the visit essentials", look.status === 200 && view.creatorName === "Staff Creator" && view.whatComped === "Dinner for two" && view.dollarCap === 75 && view.redeemedAt === null, JSON.stringify(view));
  check("staff view is scoped: no audience code, no business id, no money internals", !("creatorCode" in view) && !("businessId" in view) && !("compCostActual" in view) && !("paidLane" in view) && !("creatorId" in view), Object.keys(view).join(","));

  // --- staff redeem: the same redemption the owner runs ---
  const redeem = await raw("POST", "/api/staff/redeem", { cookie: staffA, body: { code: bookingA.code } });
  const rview = redeem.data.booking || {};
  check("staff redeem succeeds (200) with the clock started", redeem.status === 200 && !!rview.redeemedAt && !!rview.postDeadline, JSON.stringify(redeem.data));
  check("post deadline is 48 hours after redemption", Math.abs(Date.parse(rview.postDeadline) - Date.parse(rview.redeemedAt) - 48 * 3600 * 1000) < 60000, `${rview.redeemedAt} -> ${rview.postDeadline}`);

  const bizABookings = await bizA.client("GET", "/api/bookings");
  const bkA = (bizABookings.data.bookings || []).find((b) => b.id === bookingA.id) || {};
  check("owner sees the redemption: burned, stamped via staff, notice marker set", bkA.codeStatus === "burned" && bkA.redeemedVia === "staff" && !!bkA.redeemedAt && !!(bkA.staffNotice && bkA.staffNotice.redeemNoticeAt), JSON.stringify({ codeStatus: bkA.codeStatus, redeemedVia: bkA.redeemedVia, staffNotice: bkA.staffNotice }));

  const ev = await admin("GET", "/api/admin/events?limit=2000");
  const events = ev.data.events || [];
  const redeemEv = events.find((e) => e.type === "code_redeemed" && e.subjectId === bookingA.id);
  check("code_redeemed event carries via=staff", !!redeemEv && eventData(redeemEv).via === "staff" && eventData(redeemEv).method === "counter_code", JSON.stringify(redeemEv && redeemEv.data));
  const noticeEv = events.find((e) => e.type === "staff_notice_sent" && e.subjectId === bookingA.id && eventData(e).trigger === "redeem");
  check("owner staff notice fired for the staff redemption", !!noticeEv);
  const sessEv = events.find((e) => e.type === "staff_session_started" && e.subjectId === bizA.id);
  check("staff session start is on the event log", !!sessEv);

  const redeemAgain = await raw("POST", "/api/staff/redeem", { cookie: staffA, body: { code: bookingA.code } });
  check("redeeming a burned code again: 409", redeemAgain.status === 409, String(redeemAgain.status));
  const lookAgain = await raw("POST", "/api/staff/lookup", { cookie: staffA, body: { code: bookingA.code } });
  check("lookup after redemption shows it redeemed", lookAgain.status === 200 && !!lookAgain.data.booking.redeemedAt, JSON.stringify(lookAgain.data.booking));

  // Ratings stay owner-only: a staff token cannot rate the visit.
  await creator.client("POST", "/api/posts", { bookingId: bookingA.id, url: "https://www.instagram.com/p/STAFFPOST1/", includesDisclosure: true });
  const staffRate = await raw("POST", `/api/bookings/${bookingA.id}/review`, { cookie: staffA, body: { stars: 5 } });
  check("staff token cannot rate a creator (401: ratings are owner-only)", staffRate.status === 401, String(staffRate.status));

  // The owner Counter path runs the same helper, stamped owner.
  const ownerRedeem = await bizB.client("POST", "/api/counter/redeem", { code: bookingB.code });
  check("owner Counter redeem still works after the shared-helper refactor", ownerRedeem.status === 200 && !!ownerRedeem.data.booking.redeemedAt, JSON.stringify(ownerRedeem.data));
  const bizBBookings = await bizB.client("GET", "/api/bookings");
  const bkB = (bizBBookings.data.bookings || []).find((b) => b.id === bookingB.id) || {};
  check("owner redemption is stamped via owner", bkB.redeemedVia === "owner" && bkB.codeStatus === "burned", JSON.stringify({ redeemedVia: bkB.redeemedVia, codeStatus: bkB.codeStatus }));

  // --- PIN rotation: the old PIN dies at once ---
  const rotate = await raw("POST", "/api/me/staff/pin", { cookie: ownerA, body: { pin: "1357" } });
  check("owner rotates the PIN (200)", rotate.status === 200, String(rotate.status));
  const oldPin = await staffEnter(codeA, "2468");
  check("old PIN refused after rotation (401)", oldPin.status === 401 && !oldPin.staffCookie, String(oldPin.status));
  const newPin = await staffEnter(codeA, "1357");
  check("new PIN opens a staff session", newPin.status === 200 && !!newPin.staffCookie, String(newPin.status));
  const staffA2 = newPin.staffCookie;

  // --- sign out all staff devices ---
  const outAll = await raw("POST", "/api/me/staff/signout-all", { cookie: ownerA, body: {} });
  check("sign out all staff devices runs (200, sessions killed)", outAll.status === 200 && outAll.data.killed >= 1, JSON.stringify(outAll.data));
  const sessDead = await raw("GET", "/api/staff/session", { cookie: staffA2 });
  check("the rotated session is dead after sign-out-all", sessDead.status === 200 && sessDead.data.active === false, JSON.stringify(sessDead.data));
  const sessDead1 = await raw("GET", "/api/staff/session", { cookie: staffA });
  check("the first session is dead after sign-out-all too", sessDead1.status === 200 && sessDead1.data.active === false, JSON.stringify(sessDead1.data));
  const lookupDead = await raw("POST", "/api/staff/lookup", { cookie: staffA2, body: { code: bookingA.code } });
  check("a killed session cannot look up codes (401)", lookupDead.status === 401, String(lookupDead.status));

  // --- founding gate: staff mode needs an activated business ---
  const ownerC = await loginRaw("staffbiz3@example.com", "business-pass-123");
  const setPinC = await raw("POST", "/api/me/staff/pin", { cookie: ownerC, body: { pin: "4321" } });
  const settingsC = await raw("GET", "/api/me/staff", { cookie: ownerC });
  check("founding owner can set a PIN and read settings pre-activation", setPinC.status === 200 && settingsC.data.staffPinSet === true, JSON.stringify(settingsC.data));
  const enterC = await staffEnter(settingsC.data.staffCode, "4321");
  check("founding business cannot open staff mode (403 founding gate)", enterC.status === 403 && !enterC.staffCookie, `${enterC.status} ${JSON.stringify(enterC.data)}`);

  // --- PIN lockout: 5 wrong tries lock entry for 15 minutes ---
  const ownerB = await loginRaw("staffbiz2@example.com", "business-pass-123");
  await raw("POST", "/api/me/staff/pin", { cookie: ownerB, body: { pin: "9999" } });
  const settingsB = await raw("GET", "/api/me/staff", { cookie: ownerB });
  const codeB = settingsB.data.staffCode;
  const tries = [];
  for (let i = 0; i < 5; i++) tries.push((await staffEnter(codeB, "1111")).status);
  check("wrong PINs refused 401, the fifth locks (429)", tries.slice(0, 4).every((s) => s === 401) && tries[4] === 429, tries.join(","));
  const lockedRight = await staffEnter(codeB, "9999");
  check("even the correct PIN is refused while locked (429)", lockedRight.status === 429 && !lockedRight.staffCookie, String(lockedRight.status));

  // --- code lookup rate limit (fresh session, bogus codes) ---
  const fresh = await staffEnter(codeA, "1357");
  check("fresh staff session for the rate limit pass", fresh.status === 200 && !!fresh.staffCookie, String(fresh.status));
  const codes = [];
  for (let i = 0; i < 31; i++) {
    const r = await raw("POST", "/api/staff/lookup", { cookie: fresh.staffCookie, body: { code: "SGNL-000000" } });
    codes.push(r.status);
  }
  check("lookups run to the limit then 429", codes.slice(0, 30).every((s) => s === 404) && codes[30] === 429, codes.slice(-4).join(","));

  console.log(`\nverify-staff: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error("verify-staff crashed:", e);
  process.exitCode = 1;
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* temp db cleanup is best-effort */ }
}
