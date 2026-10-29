// Referral-program tie-in verification (Jeff, 2026-10-25):
// a business saves its OWN referral link/code/note (from its
// POS or booking stack) on its profile; the fields round-trip
// through PATCH /me/profile; creators see the program on the
// business's opportunities (open board + offers list) and on
// their booked visits; a business without one shows NOTHING
// (null, no empty card); the business's own offers view shows
// it as active; invalid links are refused; and a corrupted
// stored record can never 500 a creator read path (the
// INCIDENT-2026-10-25 fail-safe rule). Production shape like
// verify-business.mjs: no test override, the market goes live
// through the real admin flag, and the corruption phase edits
// the JSON DB while the server is down.
// Run: node scripts/verify-referral.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8941;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-referral-${Date.now()}.json`);

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

const REF_URL = "https://book.stackhouse.example/refer?ref=SIGNL";
const REF_CODE = "STACK10";
const REF_NOTE = "Followers get 15% off a first visit; you earn $10 per booking";

try {
  startServer();
  check("dev server boots in production shape", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // ---------- fixtures: one creator, two businesses ----------
  const creator = client();
  const cReg = await creator("POST", "/api/auth/register", {
    role: "creator", name: "Ref Rachel", email: "rachel@fixtures.dev", password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle: "refrachel", followerCount: 6000, localAudiencePct: 70, categories: ["Food & Drink"],
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("creator registers (201)", cReg.status === 201, JSON.stringify(cReg.data).slice(0, 160));
  await admin("POST", "/api/admin/review", { userId: cReg.data.user.id, decision: "approve" });
  // Charter stamp (Build -31): the founding creator finished
  // pre-launch; the founding read seals Charter so the referral
  // offer is visible to them inside its first 24 hours.
  await creator("GET", "/api/me/founding");

  async function makeBusiness(email, businessName) {
    const c = client();
    const reg = await c("POST", "/api/auth/register", {
      role: "business", name: "Owner", businessName, email, password: "business-pass-123",
      market: "Richmond", city: "Richmond", category: "Restaurant", planId: "growth", agreedTerms: true,
    });
    if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
    await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
    await admin("POST", "/api/admin/businesses/activate", { userId: reg.data.user.id });
    return { client: c, id: reg.data.user.id };
  }
  const biz1 = await makeBusiness("stackhouse@fixtures.dev", "Stackhouse");
  const biz2 = await makeBusiness("plainplates@fixtures.dev", "Plain Plates");
  await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });

  // ---------- defaults: a fresh business carries empty fields ----------
  const me0 = await biz1.client("GET", "/api/auth/me");
  check("fresh business record carries the referral fields, all empty", me0.data.user.business.referralUrl === "" && me0.data.user.business.referralCode === "" && me0.data.user.business.referralNote === "", JSON.stringify(me0.data.user.business).slice(0, 200));

  // ---------- validation: bad links are refused ----------
  const badUrl = await biz1.client("PATCH", "/api/me/profile", { referralUrl: "not a url" });
  check("a non-URL referral link is refused (400, explained)", badUrl.status === 400 && /not a valid URL/.test(badUrl.data.error || ""), JSON.stringify(badUrl.data));
  const jsUrl = await biz1.client("PATCH", "/api/me/profile", { referralUrl: "javascript:alert(1)" });
  check("a javascript: referral link is refused (400)", jsUrl.status === 400, JSON.stringify(jsUrl.data));
  const ftpUrl = await biz1.client("PATCH", "/api/me/profile", { referralUrl: "ftp://files.example/x" });
  check("a non-http(s) referral link is refused (400)", ftpUrl.status === 400, JSON.stringify(ftpUrl.data));

  // ---------- write + round-trip ----------
  const setRes = await biz1.client("PATCH", "/api/me/profile", { referralUrl: REF_URL, referralCode: REF_CODE, referralNote: REF_NOTE });
  check("PATCH saves the referral program (200, fields on the response)", setRes.status === 200 && setRes.data.user.business.referralUrl === REF_URL && setRes.data.user.business.referralCode === REF_CODE && setRes.data.user.business.referralNote === REF_NOTE, JSON.stringify(setRes.data).slice(0, 240));
  const me1 = await biz1.client("GET", "/api/auth/me");
  check("the fields round-trip through a fresh read", me1.data.user.business.referralUrl === REF_URL && me1.data.user.business.referralCode === REF_CODE && me1.data.user.business.referralNote === REF_NOTE, "");
  const partial = await biz1.client("PATCH", "/api/me/profile", { referralNote: "Updated note line" });
  check("a partial save keeps the other fields", partial.status === 200 && partial.data.user.business.referralUrl === REF_URL && partial.data.user.business.referralCode === REF_CODE && partial.data.user.business.referralNote === "Updated note line", JSON.stringify(partial.data.user && partial.data.user.business).slice(0, 240));
  await biz1.client("PATCH", "/api/me/profile", { referralNote: REF_NOTE });

  // ---------- creator surfaces: opportunities ----------
  const o1 = await biz1.client("POST", "/api/offers", { title: "Referral tasting", whatComped: "Dinner for two", dollarCap: 90, spots: 1 });
  check("business 1 posts an open offer", o1.status === 201 && o1.data.offer.status === "open", JSON.stringify(o1.data).slice(0, 200));
  const o1Id = o1.data.offer.id;
  const o2 = await biz2.client("POST", "/api/offers", { title: "Plain dinner", whatComped: "Dinner for two", dollarCap: 90, spots: 1 });
  const o2Id = o2.data.offer.id;

  const board = await creator("GET", "/api/open-offers");
  const boardRow1 = (board.data.offers || []).find((o) => o.id === o1Id);
  const boardRow2 = (board.data.offers || []).find((o) => o.id === o2Id);
  check("open board: the offer carries the referral program for creators", !!boardRow1 && !!boardRow1.businessReferralProgram && boardRow1.businessReferralProgram.url === REF_URL && boardRow1.businessReferralProgram.code === REF_CODE && boardRow1.businessReferralProgram.note === REF_NOTE, JSON.stringify(boardRow1 && boardRow1.businessReferralProgram));
  check("open board: a business without a program shows null (no empty card)", !!boardRow2 && boardRow2.businessReferralProgram === null, JSON.stringify(boardRow2 && boardRow2.businessReferralProgram));

  const offersCreator = await creator("GET", "/api/offers");
  const listRow1 = (offersCreator.data.offers || []).find((o) => o.id === o1Id);
  check("offers list: the referral program rides there too", !!listRow1 && !!listRow1.businessReferralProgram && listRow1.businessReferralProgram.url === REF_URL, JSON.stringify(listRow1 && listRow1.businessReferralProgram));

  // ---------- the business's own view: active ----------
  const offersBiz = await biz1.client("GET", "/api/offers");
  const ownRow = (offersBiz.data.offers || []).find((o) => o.id === o1Id);
  check("the business's own offers show its program as active", !!ownRow && !!ownRow.businessReferralProgram && ownRow.businessReferralProgram.url === REF_URL, JSON.stringify(ownRow && ownRow.businessReferralProgram));
  const offersBiz2 = await biz2.client("GET", "/api/offers");
  const ownRow2 = (offersBiz2.data.offers || []).find((o) => o.id === o2Id);
  check("a business without a program gets no active block on its own offers", !!ownRow2 && !ownRow2.businessReferralProgram, JSON.stringify(ownRow2 && ownRow2.businessReferralProgram));

  // ---------- creator surface: the booked visit ----------
  const app1 = await creator("POST", `/api/offers/${o1Id}/apply`, {});
  check("creator applies to the referral offer", app1.status === 201, JSON.stringify(app1.data).slice(0, 160));
  const sel = await biz1.client("POST", `/api/offers/${o1Id}/select`, { applicationId: app1.data.application.id });
  check("selection books the visit", sel.status === 201 && !!sel.data.booking, JSON.stringify(sel.data).slice(0, 200));
  const bookingId = sel.data.booking.id;
  check("the booking payload from select carries the program", !!sel.data.booking.businessReferralProgram && sel.data.booking.businessReferralProgram.url === REF_URL, JSON.stringify(sel.data.booking.businessReferralProgram));
  const bkList = await creator("GET", "/api/bookings");
  const bkRow = (bkList.data.bookings || []).find((b) => b.id === bookingId);
  check("booked visit (list): the program is on the visit payload", !!bkRow && !!bkRow.businessReferralProgram && bkRow.businessReferralProgram.code === REF_CODE && bkRow.businessReferralProgram.note === REF_NOTE, JSON.stringify(bkRow && bkRow.businessReferralProgram));
  const bkOne = await creator("GET", `/api/bookings/${bookingId}`);
  check("booked visit (detail): the program is on the visit payload", bkOne.status === 200 && !!bkOne.data.booking.businessReferralProgram && bkOne.data.booking.businessReferralProgram.url === REF_URL, JSON.stringify(bkOne.data.booking && bkOne.data.booking.businessReferralProgram));

  // ---------- clearing: link + code gone means no program ----------
  const clear = await biz1.client("PATCH", "/api/me/profile", { referralUrl: "", referralCode: "" });
  check("clearing link and code saves (200)", clear.status === 200 && clear.data.user.business.referralUrl === "" && clear.data.user.business.referralCode === "", JSON.stringify(clear.data.user && clear.data.user.business).slice(0, 200));
  const boardAfterClear = await creator("GET", "/api/open-offers");
  const clearedRow = (boardAfterClear.data.offers || []).find((o) => o.id === o2Id);
  check("board read still answers after the clear", boardAfterClear.status === 200 && !!clearedRow, String(boardAfterClear.status));
  const bkAfterClear = await creator("GET", `/api/bookings/${bookingId}`);
  check("a note alone is not a program: the visit card goes quiet", bkAfterClear.status === 200 && bkAfterClear.data.booking.businessReferralProgram === null, JSON.stringify(bkAfterClear.data.booking && bkAfterClear.data.booking.businessReferralProgram));

  // ---------- auth behavior unchanged ----------
  const anon = client();
  const anonOffers = await anon("GET", "/api/offers");
  const anonBookings = await anon("GET", "/api/bookings");
  const anonBoard = await anon("GET", "/api/open-offers");
  check("anonymous reads stay 401 (offers, bookings, board)", anonOffers.status === 401 && anonBookings.status === 401 && anonBoard.status === 401, `${anonOffers.status}/${anonBookings.status}/${anonBoard.status}`);

  // ---------- fail-safe: a corrupted record can never 500 a read ----------
  await stopServer();
  editDb((db) => {
    for (const [key, val] of Object.entries(db)) {
      if (key === `user:${biz1.id}` && val.business) {
        val.business.referralUrl = 42;
        val.business.referralCode = { bad: true };
        val.business.referralNote = ["not", "a", "string"];
      }
    }
  });
  startServer();
  check("server restarts with a corrupted referral record", await waitUp());
  const creator2 = client();
  await creator2("POST", "/api/auth/login", { email: "rachel@fixtures.dev", password: "creator-pass-123" });
  const boardCorrupt = await creator2("GET", "/api/open-offers");
  check("corrupt record: the board still answers 200", boardCorrupt.status === 200, String(boardCorrupt.status));
  const bkCorrupt = await creator2("GET", "/api/bookings");
  check("corrupt record: the visits list still answers 200", bkCorrupt.status === 200, String(bkCorrupt.status));
  const biz1b = client();
  await biz1b("POST", "/api/auth/login", { email: "stackhouse@fixtures.dev", password: "business-pass-123" });
  const heal = await biz1b("PATCH", "/api/me/profile", { referralUrl: REF_URL, referralCode: REF_CODE, referralNote: REF_NOTE });
  check("a fresh save heals the corrupted fields", heal.status === 200 && heal.data.user.business.referralUrl === REF_URL && heal.data.user.business.referralCode === REF_CODE, JSON.stringify(heal.data.user && heal.data.user.business).slice(0, 200));
  const boardHealed = await creator2("GET", "/api/open-offers");
  const healedRow = (boardHealed.data.offers || []).find((o) => o.id === o2Id);
  check("reads stay healthy after the heal", boardHealed.status === 200 && !!healedRow, String(boardHealed.status));

  // ---------- client ships the new surfaces ----------
  const appJsRes = await fetch(BASE + "/app.js");
  const appJs = await appJsRes.text();
  check("client ships the creator referral card on offers and visits", appJs.includes("referralProgramBlockHtml") && appJs.includes("This business runs its own referral program") && appJs.includes("businessReferralProgram"), "");
  check("client ships the business settings panel and the active line on its own offers", appJs.includes("Your referral program") && appJs.includes("saveMyReferralProgram") && appJs.includes("Referral program active"), "");
  check("client copy is honest: rewards are the business's program, SIGNL does not guarantee them", appJs.includes("SIGNL does not run or guarantee their program") && appJs.includes("SIGNL never touches referral money"), "");

  console.log(`\nReferral tie-in verification: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log("Failures:", failures.join(" | "));
  await stopServer();
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error("SUITE ERROR", e);
  await stopServer();
  process.exit(1);
}
