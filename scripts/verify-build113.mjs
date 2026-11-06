#!/usr/bin/env node
// Build -113 verification (Phase A addendum A4, Jeff 2026-11-03):
// Admin creator account parity + two Phase C QA micro-fixes.
//
// Proves, against a throwaway local DB:
//   S. source pins: the creator-row account actions, the account
//      view + Correct email UI (plain words), the new endpoint +
//      audit type server-side, the stamp; M1 pins (no paid
//      deliverable line states the comped 48 hours anywhere it
//      sits next to agreed posting terms); M2 pin (the Admin
//      Compliance per-visit badge follows the creator's standing).
//   A. THE DRIVING CASE end to end: a creator whose stored email
//      has a typo'd domain (…@gmail.co) gets it corrected by an
//      admin; then the sign-in link goes to the NEW address, the
//      old email index is gone (login + forgot-password by the
//      old address fail, by the new address resolve; the old
//      address can register fresh), the audit event carries
//      old/new, and the account record shows only the new address.
//   B. guards: non-admin refused (403), bad format refused (400),
//      an address owned by another account refused (409, plain
//      words), same-address is a no-op with no audit event, and
//      the correction works for a BUSINESS account too (any role).
//   C. M1 live: a paid offer's brief deliverable line references
//      the agreed terms and never the 48 hours; its posting
//      terms line is present alongside.
//   D. M2 data: a creator removed by two silent no-shows still
//      has a visit in the visit-level "paused" window while their
//      standing reads banned — the exact pair the badge fix maps
//      to "creator removed" (badge text itself is pinned in S and
//      walked rendered in qa-build113.py).
//
// Run: node scripts/verify-build113.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9051;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "admin-" + "password-113";
const PW = "fixture-password-1";
const DAY = 24 * 3600 * 1000;

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// ---------- S: source pins ----------
part("S: source pins");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
check("stamp is 2026.11.06-134", indexHtml.includes("2026.11.06-134") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.06-134"));
check("server: correct-email endpoint exists beside send-signin-link", routerJs.includes('seg[3] === "correct-email"') && routerJs.includes('seg[3] === "send-signin-link"'));
check("server: correction audit-logged as admin_corrected_account_email with old/new", routerJs.includes('type: "admin_corrected_account_email"') && routerJs.includes("oldEmail") && routerJs.includes("newEmail"));
check("server: taken address refused 409 in plain words", routerJs.includes("That email already belongs to another account."));
check("server: bad format refused in plain words", routerJs.includes("That does not look like a valid email address."));
check("server: the uniqueness index moves (old deleted, new set)", routerJs.includes("store.del(`email:${oldEmail}`)") && routerJs.includes("store.set(`email:${newEmail}`, { userId: target.id })"));
check("client: creator rows get View account (account view) next to the business rows' view-as", appJs.includes('u.role === "creator" ? `<br><button class="btn small-btn" style="margin-top:6px" onclick="adminViewAccount(\'${u.id}\')">View account</button>'));
check("client: creator rows get Send sign-in link on the SAME shared handler as business rows", appJs.includes('onclick="adminSendSigninLink(\'${u.id}\')">Send sign-in link</button>'));
check("client: account view exists and shows only the address on file", appJs.includes("async function adminViewAccount(userId)") && appJs.includes("Approval mail, SIGNL messages and sign-in all use this address."));
check("client: Correct email label + plain helper line", appJs.includes(">Correct email</button>") && appJs.includes("Fix a typo or a changed address. Mail and sign-in use the new address."));
check("client: the save wires the new endpoint", appJs.includes("/correct-email`, { email }"));
check("M1: deal rows — a paid Post row carries NO window (terms row only)", appJs.includes('`${deliverablePhraseClient(o)} &middot; live 30 days`') && !appJs.includes("o.kind === \"paid\" ? `${deliverablePhraseClient(o)} &middot; within ${windowPhraseClient(dv84.windowHours)} &middot; live 30 days`"));
check("M1: brief deliverable (server) references the agreed terms, never 48 hours", routerJs.includes('paid: "Deliverables are set in the booking terms. Post on the agreed posting terms and keep the post live at least 30 days."') && !routerJs.includes("Post within 48 hours and keep the post live"));
check("M1: Sig brief summary (paid) references the agreed terms", appJs.includes("set in the booking terms; post on the agreed posting terms, live at least 30 days") && !appJs.includes("set in the booking terms; post within 48 hours"));
check("M2: compliance badge follows the standing (removed beats paused)", appJs.includes('r.status === "paused" && r.creatorStanding === "banned"') && appJs.includes("Past the hard stop, creator removed"));

// ---------- live harness ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build113-"));
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
async function reboot() { await stopServer(); startServer(); await waitUp(); }
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
    try { data = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data, text };
  };
}
const uniq = () => Math.random().toString(36).slice(2, 9);
let n = 0;
async function registerCreator(overrides = {}) {
  n += 1;
  const payload = {
    role: "creator", name: `A4 Creator ${n}`, email: `a4c${n}-${uniq()}@fixtures.dev`, password: PW,
    market: "Nashville", city: "Nashville", handle: `a4c${n}${uniq()}`,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: 3000, avgViews: 900, localAudiencePct: 62, bio: "",
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
    ...overrides,
  };
  const c = makeClient();
  const r = await c("POST", "/api/auth/register", payload);
  if (r.status !== 201) throw new Error("creator register failed: " + JSON.stringify(r.data));
  return { email: payload.email, id: r.data.user.id, client: c };
}
async function registerBusiness(admin, email, name) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", email, password: PW, market: "Nashville", city: "Nashville",
    businessName: name, category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  if (r.status !== 201) throw new Error("business register failed: " + JSON.stringify(r.data));
  await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: r.data.user.id });
  return { email, id: r.data.user.id, client: c };
}
async function login(email, password = PW) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email, password });
  return { client: c, status: r.status, data: r.data };
}
async function adminClient() {
  const { client, status } = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (status !== 200) throw new Error("admin login failed");
  return client;
}
async function eventsOf(admin, type) {
  const r = await admin("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=500`);
  return (r.data && r.data.events) || [];
}
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db));
}
function travel(bookingId, daysAgo) {
  editDb((db) => {
    for (const val of Object.values(db)) {
      if (val && val.id === bookingId && val.redeemedAt !== undefined) {
        const redeemedMs = Date.now() - daysAgo * DAY;
        val.redeemedAt = new Date(redeemedMs).toISOString();
        val.postDeadline = new Date(redeemedMs + 48 * 3600 * 1000).toISOString();
        val.compliance = {};
      }
    }
  });
}

try {
  startServer();
  await waitUp();
  const admin = await adminClient();

  // ---------- A: the driving case ----------
  part("A: driving case (typo'd domain)");
  const tag = uniq();
  const TYPO = `amy${tag}@gmail.co`;       // the typo on file: domain missing its final letter
  const FIXED = `amy${tag}@gmail.com`;     // the address she actually reads
  // NB: TYPO is a string prefix of FIXED, so "no trace of the old
  // address" checks below match it as a complete quoted JSON
  // string (`"…"`) — a bare substring search would always hit.
  const amy = await registerCreator({ email: TYPO, name: "Amy Dawson" });
  await admin("POST", "/api/admin/review", { userId: amy.id, decision: "approve" });
  const apps0 = await admin("GET", "/api/admin/applications");
  const rowAmy0 = [...(apps0.data.pending || []), ...(apps0.data.decided || [])].find((u) => u.id === amy.id);
  check("the account on file carries the typo'd address", !!rowAmy0 && rowAmy0.email === TYPO, JSON.stringify(rowAmy0 && rowAmy0.email));

  const biz = await registerBusiness(admin, `a4biz-${uniq()}@fixtures.dev`, "A4 Kitchen");

  // guards first (Part B interleaved where state is cleanest)
  part("B: guards");
  const asAmy = await login(TYPO);
  const refused = await asAmy.client("POST", `/api/admin/users/${amy.id}/correct-email`, { email: FIXED });
  check("a non-admin is refused (403, Admin only)", refused.status === 403 && /Admin only/.test((refused.data || {}).error || ""), `${refused.status} ${JSON.stringify(refused.data).slice(0, 120)}`);
  const badFmt = await admin("POST", `/api/admin/users/${amy.id}/correct-email`, { email: "not-an-email" });
  check("a bad address is refused in plain words (400)", badFmt.status === 400 && (badFmt.data || {}).error === "That does not look like a valid email address.", `${badFmt.status} ${JSON.stringify(badFmt.data).slice(0, 120)}`);
  const taken = await admin("POST", `/api/admin/users/${amy.id}/correct-email`, { email: biz.email });
  check("another account's address is refused (409, plain words)", taken.status === 409 && (taken.data || {}).error === "That email already belongs to another account.", `${taken.status} ${JSON.stringify(taken.data).slice(0, 120)}`);
  const missing = await admin("POST", "/api/admin/users/nope-not-real/correct-email", { email: FIXED });
  check("an unknown account 404s", missing.status === 404, `${missing.status}`);

  part("A: driving case (typo'd domain)");
  const fix = await admin("POST", `/api/admin/users/${amy.id}/correct-email`, { email: FIXED });
  check("the correction succeeds and answers with the new address", fix.status === 200 && fix.data.ok === true && fix.data.email === FIXED && fix.data.role === "creator", `${fix.status} ${JSON.stringify(fix.data).slice(0, 160)}`);

  const evs = await eventsOf(admin, "admin_corrected_account_email");
  const evAmy = evs.filter((e) => e.subjectId === amy.id);
  check("the audit event carries old and new (old lives in the log only)", evAmy.length === 1 && evAmy[0].data && evAmy[0].data.oldEmail === TYPO && evAmy[0].data.newEmail === FIXED, JSON.stringify(evAmy).slice(0, 240));

  const apps1 = await admin("GET", "/api/admin/applications");
  const rowAmy1 = [...(apps1.data.pending || []), ...(apps1.data.decided || [])].find((u) => u.id === amy.id);
  check("the account view record shows ONLY the new address", !!rowAmy1 && rowAmy1.email === FIXED && !JSON.stringify(rowAmy1).includes(`"${TYPO}"`), JSON.stringify(rowAmy1 && rowAmy1.email));

  const loginOld = await login(TYPO);
  check("sign-in lookup by the OLD address fails", loginOld.status === 401, `${loginOld.status}`);
  const loginNew = await login(FIXED);
  check("sign-in lookup by the NEW address resolves", loginNew.status === 200 && loginNew.data.user.email === FIXED, `${loginNew.status}`);
  const meAmy = await loginNew.client("GET", "/api/auth/me");
  check("her own record carries the new address and no trace of the old", meAmy.data.user.email === FIXED && !JSON.stringify(meAmy.data.user).includes(`"${TYPO}"`), "");

  const anon = makeClient();
  const forgotOld = await anon("POST", "/api/auth/forgot", { email: TYPO });
  check("forgot-password by the OLD address issues nothing", !(forgotOld.data && forgotOld.data.devResetToken), JSON.stringify(forgotOld.data).slice(0, 120));
  const forgotNew = await anon("POST", "/api/auth/forgot", { email: FIXED });
  check("forgot-password by the NEW address resolves the account", !!(forgotNew.data && forgotNew.data.devResetToken), JSON.stringify(forgotNew.data).slice(0, 120));

  const link = await admin("POST", `/api/admin/users/${amy.id}/send-signin-link`, {});
  check("the sign-in link now goes to the NEW address", link.status === 200 && link.data.email === FIXED && link.data.emailSent === true && !!link.data.devResetToken, `${link.status} ${JSON.stringify(link.data).slice(0, 160)}`);
  const reset = await makeClient()("POST", "/api/auth/reset", { token: link.data.devResetToken, password: "amy-new-password-113" });
  check("the link sent to the new address completes a reset", reset.status === 200, `${reset.status} ${JSON.stringify(reset.data).slice(0, 120)}`);
  const relogin = await login(FIXED, "amy-new-password-113");
  check("she signs in at the new address with the reset password", relogin.status === 200, `${relogin.status}`);

  part("B: guards");
  const noop = await admin("POST", `/api/admin/users/${amy.id}/correct-email`, { email: FIXED });
  check("correcting to the address already on file is a no-op", noop.status === 200 && noop.data.unchanged === true, `${noop.status} ${JSON.stringify(noop.data).slice(0, 120)}`);
  const evs2 = await eventsOf(admin, "admin_corrected_account_email");
  check("the no-op writes no second audit event", evs2.filter((e) => e.subjectId === amy.id).length === 1, `n=${evs2.filter((e) => e.subjectId === amy.id).length}`);

  const fresh = await registerCreator({ email: TYPO });
  check("the freed OLD address can register as a new account (index really moved)", !!fresh.id && fresh.id !== amy.id, "");
  const clash = await admin("POST", `/api/admin/users/${amy.id}/correct-email`, { email: TYPO });
  check("and now the old address is taken again (409)", clash.status === 409, `${clash.status}`);

  const NEWBIZ = `a4biz-new-${uniq()}@fixtures.dev`;
  const fixBiz = await admin("POST", `/api/admin/users/${biz.id}/correct-email`, { email: NEWBIZ });
  check("any role: a BUSINESS email corrects the same way", fixBiz.status === 200 && fixBiz.data.email === NEWBIZ && fixBiz.data.role === "business", `${fixBiz.status} ${JSON.stringify(fixBiz.data).slice(0, 140)}`);
  const bizLogin = await login(NEWBIZ);
  check("the business signs in at its new address", bizLogin.status === 200, `${bizLogin.status}`);

  // ---------- C: M1 live ----------
  part("C: M1 live (paid brief deliverable)");
  const cr = await registerCreator(); await admin("POST", "/api/admin/review", { userId: cr.id, decision: "approve" });
  const off = await bizLogin.client("POST", "/api/offers", { title: "Paid tasting", whatComped: "Tasting menu", kind: "paid", cashRate: 200, spots: 1, creatorId: cr.id, postingTerms: { type: "standard" } });
  check("paid offer created", off.status === 201, `${off.status} ${JSON.stringify(off.data).slice(0, 160)}`);
  const dl = (off.data.offer && off.data.offer.brief && off.data.offer.brief.deliverable) || "";
  check("the paid brief's deliverable line references the agreed terms", dl === "Deliverables are set in the booking terms. Post on the agreed posting terms and keep the post live at least 30 days.", dl);
  check("and never states the comped 48 hours", !/48 hours/.test(dl), dl);
  check("the agreed posting-terms line rides the same offer", /post within 7 days/.test(off.data.offer.postingTermsLine || ""), String(off.data.offer.postingTermsLine));

  // ---------- D: M2 data ----------
  part("D: M2 data (removed creator, visit still in the paused window)");
  const silent = await registerCreator(); await admin("POST", "/api/admin/review", { userId: silent.id, decision: "approve" });
  async function compedVisit(creatorClient, bizClient, title) {
    const o = await bizClient("POST", "/api/offers", { title, whatComped: "Meal for two, on us", dollarCap: 100, spots: 1, creatorId: silent.id });
    if (o.status !== 201) throw new Error("offer failed " + JSON.stringify(o.data));
    const acc = await creatorClient("POST", `/api/offers/${o.data.offer.id}/accept`, { visitDate: "2026-11-10" });
    if (acc.status !== 201) throw new Error("accept failed " + JSON.stringify(acc.data));
    const conf = await bizClient("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
    if (conf.status !== 200) throw new Error("confirm failed " + JSON.stringify(conf.data));
    return acc.data.booking.id;
  }
  const sv1 = await compedVisit(silent.client, bizLogin.client, "Silent visit 1");
  const sv2 = await compedVisit(silent.client, bizLogin.client, "Silent visit 2");
  travel(sv1, 8); travel(sv2, 8);
  await reboot();
  const admin2 = await adminClient();
  const bizC2 = (await login(NEWBIZ)).client;
  const sweep = await admin2("POST", "/api/admin/compliance/sweep", {});
  check("the sweep removes the two-strike silent creator", sweep.status === 200 && (sweep.data.sweep.silentRemoved || 0) >= 1, JSON.stringify(sweep.data && sweep.data.sweep).slice(0, 200));
  const rows = await admin2("GET", "/api/admin/compliance");
  const rowS = (rows.data.visits || []).find((r) => r.bookingId === sv1);
  check("the visit still sits in the visit-level paused window", !!rowS && rowS.status === "paused", JSON.stringify(rowS && rowS.status));
  check("while the creator's standing reads banned (removed) — the badge must follow the standing", !!rowS && rowS.creatorStanding === "banned" && rowS.creatorStandingSource === "silent_strikes", JSON.stringify(rowS && { s: rowS.creatorStanding, src: rowS.creatorStandingSource }));

  await stopServer();
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
  try { await stopServer(); } catch (e) { /* ignore */ }
}

console.log(`\nverify-build113: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
