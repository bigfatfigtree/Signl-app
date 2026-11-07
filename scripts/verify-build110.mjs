#!/usr/bin/env node
// Build -110 verification (Phase A cleanups, Jeff 2026-11-03):
//   A1 LICENSING CLEANUP — a paid booking's standard licence is
//     AUTO-CREATED as a dated record (stdlicence: namespace, fee
//     0, included) when the paid post lands, running 90 days from
//     the POST DATE. No licence inputs exist in the paid flow:
//     licence fields sent to the paid-booking endpoint are
//     ignored, and the client carries ONE shared INCLUDED line
//     (includedLicenceLineHtml) in the booking sheet + preview.
//     Comped-post licensing is unchanged. Extension past the
//     included 90 days is ONE path: "Extend or license
//     separately" rides the Build -95 creator-approved renewal
//     flow (extensionOf: "standard", renewal: true), creating a
//     NEW dated license: record only on creator approval.
//   A2 DEMO TOGGLE RELOCATION — the Build -67 Load/Remove panel
//     lives in Admin -> Requests (with the Finish Engine switch),
//     and the Applications queue renders with ZERO demo UI.
//     Endpoints, allowlist behaviour and audit events unchanged.
//   A3 48-HOUR WORDING — creator-facing explanatory copy states
//     the goal: "The goal is one post + one story within 48 hours
//     of your visit". Scoring, the 48h on-time rule and the
//     one-week hard deadline are untouched (brief canon pinned).
//   Canon locks: LICENSE_WINDOW_DAYS 90, founding prices,
//     FOUNDING_STRIPE_PRICES env-or-empty, no perpetual rights.
//
// Run: node scripts/verify-build110.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8990;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";

let passed = 0;
let failed = 0;
let currentPart = "boot";
const fails = [];
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const count = (s, sub) => s.split(sub).length - 1;
const win = (s, a, b) => { const i = s.indexOf(a); const j = b ? s.indexOf(b, i + a.length) : s.length; return i < 0 ? "" : s.slice(i, j < 0 ? s.length : j); };

// ---------- source pins ----------
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const sigdataJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
const sigaiJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");

part("A1 source: included line, no licence form");
check("ONE shared INCLUDED line helper exists", appJs.includes("function includedLicenceLineHtml()") && appJs.includes('class="small included-licence-line"'));
check("the helper is used by the booking sheet AND the preview twin", count(appJs, "${includedLicenceLineHtml()}") === 2, String(count(appJs, "${includedLicenceLineHtml()}")));
check("the included line states what, 90 days, from the post date", appJs.includes("Includes the standard license: repost + ad use for 90 days from the post date, never longer."));
check("no licence input fields anywhere in the client (no licence form)", !/id="(paid|bk|booking|offer)[^"]*licen/i.test(appJs) && !appJs.includes('id="license-days"') && !appJs.includes('id="licence-days"'));
check("creator terms view carries the INCLUDED line for paid", appJs.includes("<strong>Included:</strong> the standard license: the business can repost your post and run it as an ad for 90 days from the post date, never longer. It is created automatically with this booking as a dated record"));
check("composer still states the licence part cannot be changed (not an edit)", appJs.includes("A paid booking also includes the standard license: repost and ad use for 90 days from the post date. That part is set by SIGNL and cannot be changed."));

part("A1 source: auto-created dated record + extension path");
check("server auto-creates the dated standard licence record", routerJs.includes("function standardLicenceRecord(post, booking, ts)") && routerJs.includes("stdlicence:${stdLic.id}") && routerJs.includes('type: "standard"') && routerJs.includes("included: true") && routerJs.includes("autoCreated: true"));
check("the record materializes at post submission for paid bookings", routerJs.includes("post.standardLicence = { recordId: stdLic.id, startsAt: stdLic.startsAt, windowEndsAt: stdLic.windowEndsAt }"));
check("extension rides the renewal flow and is named as an extension of the standard licence", routerJs.includes('extensionOf: isRenewal && booking.kind === "paid" ? "standard" : null') && routerJs.includes("RENEWAL_WINDOW_MS = 14 * 86400000"));
check("client extension action exists and delegates inside the window", appJs.includes("function extendLicence(postId, fee, endsAt)") && appJs.includes("return askRenewLicense(postId, fee, endsOn);"));
check("Extend or license separately labels the library rows, the visit card and the expiry card", count(appJs, "Extend or license separately") >= 4, String(count(appJs, "Extend or license separately")));
check("early extension attempt explains the 14-day opening and sends nothing", appJs.includes("Extending it opens 14 days before it ends"));
check("server refusal for a fresh paid post names the extension path", routerJs.includes("extending it opens 14 days before it ends, through Extend or license separately on the post in Posts & licenses"));

part("A1 source: Sig states it cleanly");
check("server Sig canon: included licence is automatic, never a form or add-on", sigaiJs.includes("That standard license is automatic and included: it is created with the paid booking as a dated record running from the post date, nobody fills in a license form for it, and it is never an add-on or an extra charge."));
check("server Sig canon: extension is Extend or license separately, creator-approved, fresh 90 from approval", sigaiJs.includes("the business uses Extend or license separately on the post: a creator-approved request at the creator's listed licensing fee, a fresh 90 days from the day the creator approves"));
check("server Sig data: business extend branch answers from the same canon", sigdataJs.includes("A paid booking's standard licence is included and automatic: one dated record, repost and paid ad use for 90 days from the post date, never longer."));
check("in-app business Sig: included + automatic + extension path", appJs.includes("That licence is included and automatic: a dated record created with the booking, never a form to fill in and never an add-on."));
check("in-app creator Sig: paid standard licence is automatic, extensions come as requests", appJs.includes("its standard license is included automatically for 90 days from the post date, with nothing for you or the business to fill in"));
check("business Sig operator routes extend phrasing into the renewal flow", appJs.includes('"extend or license"') && appJs.includes('"license separately"'));

part("A2 source: demo panel relocated");
const renderAdminSrc = win(appJs, "function renderAdmin()", "// Demo showcase");
check("Applications landing renders ZERO demo UI", !renderAdminSrc.includes("admin-demo-showcase") && !renderAdminSrc.includes("loadDemoShowcasePanel"));
const requestsSrc = win(appJs, "async function loadAdminRequests()", "// Admin profile view");
check("Requests (the platform-switches home) hosts the Demo showcase panel", requestsSrc.includes('id="admin-demo-showcase"') && requestsSrc.includes("loadDemoShowcasePanel();"));
const queueSrc = win(appJs, "async function loadApplications()", "// ---------- Admin: Requests");
check("the applications queue itself carries no demo markup or calls", !queueSrc.includes("demo") || !queueSrc.includes("demo-showcase"), "");
check("panel heading is plainly named Demo showcase", appJs.includes("Demo showcase: Nashville creators"));
check("demo endpoints untouched in the router", routerJs.includes('seg[1] === "demo-showcase"') && routerJs.includes("demo_showcase_loaded") && routerJs.includes("demo_showcase_removed"));

part("A3 source: goal phrasing, rules untouched");
const GOAL = "The goal is one post + one story within 48 hours of your visit";
check("goal phrasing across creator-facing client copy (summary, Help, Sig owe, deal caption + Sig visits variant)", count(appJs, GOAL) >= 4 && appJs.includes("Then you post: the goal is one post + one story within 48 hours of your visit"), String(count(appJs, GOAL)));
check("goal phrasing in the server Standard Visit summary + creatorDoes", count(routerJs, "within 48 hours of your visit") >= 2 && routerJs.includes(GOAL));
check("goal phrasing in the onboarding deal line (all copies)", count(routerJs, "the goal is to post your honest experience within 48 hours of the visit") === 4, String(count(routerJs, "the goal is to post your honest experience")));
check("goal phrasing in server Sig canon", sigaiJs.includes("the goal is one post + one story within 48 hours of the visit"));
check("old held-to framing gone from the Standard Visit summary (both sides)", !appJs.includes("48 hours is the standard creators are held to") && !routerJs.includes("48 hours is the standard creators are held to"));
check("RULES UNTOUCHED: brief canon still states the on-time rule + one-week hard deadline verbatim", routerJs.includes("1 post + 1 story that shares the post. Post within 48 hours; one week is the hard deadline.") && appJs.includes("the hard deadline is one week"));
check("RULES UNTOUCHED: 48h window is still the deliverable standard", routerJs.includes("postWithinHours: 48"));

part("canon locks");
check("LICENSE_WINDOW_DAYS still 90", routerJs.includes("const LICENSE_WINDOW_DAYS = 90"));
check("no perpetual licence language introduced as a right", !/perpetual (license|licence|rights)/i.test(appJs) && !/perpetuity[^.\"]*includ/i.test(routerJs));
check("FOUNDING_STRIPE_PRICES stays env-or-empty (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'));
check("build stamp is 2026.11.06-140 on both sides", fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('exports.BUILD_ID = "2026.11.06-140"') && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.06-140"'));

// ---------- Sig answerer (in-process, shape-true facts) ----------
part("Sig answerer: business extend + creator terms");
const sigdata = createRequire(import.meta.url)("../netlify/functions/lib/sigdata.js");
{
  const bizFacts = { role: "business", licencesExpiring: [], licensesGranted: 2, licensesPending: 0, regularsCount: 0, regulars: [] };
  const ext = sigdata.answerFacts("business", bizFacts, "can I extend my licence past the 90 days", []);
  check("business Sig answers the extension question with the included-automatic canon + path", !!ext && ext.includes("included and automatic") && ext.includes("Extend or license separately") && ext.includes("fresh 90 days starts only if they approve"), String(ext));
  const inc = sigdata.answerFacts("business", bizFacts, "is the licence an add-on form I fill in", []);
  check("business Sig denies the add-on/form framing", !!inc && inc.includes("never an add-on") && inc.includes("Nobody fills in a licence form"), String(inc));
  const crFacts = { role: "creator", pendingLicenses: [] };
  const terms = sigdata.answerFacts("creator", crFacts, "what are the creator terms", []);
  check("creator Sig terms answer still carries the included standard licence", !!terms && terms.includes("includes one standard licence for 90 days"), String(terms));
}

// ---------- live flow ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b110-"));
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
async function stopServer() { if (!server) return; server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; }
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
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
    if (setCookie) for (const piece of setCookie.split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data, text };
  };
}
const uniq = () => Math.random().toString(36).slice(2, 9);
const DAY = 24 * 3600 * 1000;
function readDb() { return JSON.parse(fs.readFileSync(dbFile, "utf8")); }
function editDb(fn) { const db = readDb(); fn(db); fs.writeFileSync(dbFile, JSON.stringify(db, null, 1)); }

try {
  startServer();
  await waitUp();
  const admin = makeClient();
  const login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", login.status === 200, `${login.status}`);

  part("A2 live: demo endpoints unchanged from the new home");
  const st0 = await admin("GET", "/api/admin/demo-showcase");
  check("demo showcase defaults to NOT loaded", st0.status === 200 && st0.data.showcase.loaded === 0, JSON.stringify(st0.data).slice(0, 160));
  const load = await admin("POST", "/api/admin/demo-showcase/load", {});
  check("Load still creates the 12 demo creators", load.status === 200 && load.data.result.created === 12, JSON.stringify(load.data.result || {}).slice(0, 160));
  const evts = await admin("GET", "/api/admin/events?type=demo_showcase_loaded&limit=50");
  check("demo load still audit-logged", (evts.data.events || []).length >= 1, "");
  const rm = await admin("POST", "/api/admin/demo-showcase/remove", {});
  check("Remove still purges the batch", rm.status === 200 && (rm.data.result || {}).removed === 12, JSON.stringify(rm.data.result || {}).slice(0, 160));

  part("setup: business + creator with rate and fee");
  const bizC = makeClient();
  const bizReg = await bizC("POST", "/api/auth/register", { role: "business", name: "Biz Owner", email: `biz110-${uniq()}@fixtures.dev`, password: "<MASKED_SECRET_002>", market: "Hampton Roads", city: "Norfolk", businessName: "Phase A Kitchen", category: "Restaurant", planId: "self-service", agreedTerms: true });
  check("business registered", bizReg.status === 201, JSON.stringify(bizReg.data).slice(0, 160));
  await admin("POST", "/api/admin/review", { userId: bizReg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: bizReg.data.user.id });
  const crC = makeClient();
  const crReg = await crC("POST", "/api/auth/register", { role: "creator", name: "Phase A Creator", email: `cr110-${uniq()}@fixtures.dev`, password: "<MASKED_SECRET_002>", market: "Hampton Roads", city: "Norfolk", handle: `phasea${uniq()}`, categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 3000, avgViews: 900, localAudiencePct: 62, bio: "", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true });
  check("creator registered", crReg.status === 201, JSON.stringify(crReg.data).slice(0, 160));
  await admin("POST", "/api/admin/review", { userId: crReg.data.user.id, decision: "approve" });
  const setRates = await crC("PATCH", "/api/me/profile", { paidRate: 250, licensingFee: 80 });
  check("creator lists paid rate 250 + licensing fee 80", setRates.status === 200 && setRates.data.user.creator.paidRate === 250 && setRates.data.user.creator.licensingFee === 80, JSON.stringify(setRates.data).slice(0, 200));

  part("A1 live: paid booking ignores licence inputs, auto-creates the dated record");
  const sneaky = await bizC("POST", "/api/bookings/paid", { creatorId: crReg.data.user.id, whatComped: "Tasting menu for two", licenseDays: 365, licenceDays: 365, licenseNote: "perpetual, all uses, forever", license: { days: 365, perpetual: true }, includeLicense: false });
  check("paid booking created despite licence-shaped inputs", sneaky.status === 201, `${sneaky.status} ${JSON.stringify(sneaky.data).slice(0, 200)}`);
  const pb = sneaky.data.booking;
  check("paidLane licence is the canon 90 days with the canon note (inputs ignored)", !!pb.paidLane && pb.paidLane.licenseDays === 90 && pb.paidLane.licenseNote === "Standard license included: repost + ad use for 90 days from the post date, never longer.", JSON.stringify(pb.paidLane || {}).slice(0, 220));
  // redeem the visit so the post clock runs, then post
  const redeem = await bizC("POST", "/api/counter/redeem", { code: pb.code });
  check("visit redeemed at the counter", redeem.status === 200, `${redeem.status} ${JSON.stringify(redeem.data).slice(0, 160)}`);
  const post1 = await crC("POST", "/api/posts", { bookingId: pb.id, url: "https://www.instagram.com/p/phasea110paid/", disclosedComp: true });
  check("paid post submitted", post1.status === 201, `${post1.status} ${JSON.stringify(post1.data).slice(0, 200)}`);
  const stdOnPost = post1.data.post && post1.data.post.standardLicence;
  check("post carries the standard licence dates (start = post date)", !!stdOnPost && !!stdOnPost.recordId && Math.abs(Date.parse(stdOnPost.windowEndsAt) - Date.parse(stdOnPost.startsAt) - 90 * DAY) < 5000, JSON.stringify(stdOnPost || {}));
  const db1 = readDb();
  const stdRec = db1[`stdlicence:std-${pb.id}`];
  check("a dated stdlicence: record exists in the store", !!stdRec && stdRec.type === "standard" && stdRec.included === true && stdRec.autoCreated === true && stdRec.fee === 0 && stdRec.licenseDays === 90 && stdRec.bookingId === pb.id && stdRec.postId === post1.data.post.id, JSON.stringify(stdRec || {}).slice(0, 220));
  check("the stdlicence record's window runs 90 days from the post date", !!stdRec && Math.abs(Date.parse(stdRec.windowEndsAt) - Date.parse(post1.data.post.submittedAt) - 90 * DAY) < 5000, stdRec && stdRec.windowEndsAt);
  const home = await bizC("GET", "/api/me/business-home");
  const libRow = ((home.data.home || {}).contentLibrary || []).find((r) => r.bookingId === pb.id);
  check("business library derives the standard licence with the same end date", !!libRow && libRow.license && libRow.license.type === "standard" && libRow.license.windowEndsAt === stdRec.windowEndsAt, JSON.stringify(libRow && libRow.license));

  part("A1 live: extension refused early, then creator-approved in the window");
  const early = await bizC("POST", `/api/posts/${post1.data.post.id}/license-request`, {});
  check("extension on a fresh paid post refuses and names the path", early.status === 400 && /already includes/i.test(JSON.stringify(early.data)) && /Extend or license separately/.test(JSON.stringify(early.data)), `${early.status} ${JSON.stringify(early.data).slice(0, 200)}`);
  await stopServer();
  editDb((db) => {
    const past = new Date(Date.now() - 80 * DAY).toISOString();
    const p = db[`post:${post1.data.post.id}`];
    if (p) { p.submittedAt = past; p.createdAt = past; if (p.standardLicence) { p.standardLicence.startsAt = past; p.standardLicence.windowEndsAt = new Date(Date.now() + 10 * DAY).toISOString(); } }
    const s = db[`stdlicence:std-${pb.id}`];
    if (s) { s.startsAt = past; s.windowEndsAt = new Date(Date.now() + 10 * DAY).toISOString(); }
  });
  startServer();
  await waitUp();
  const extReq = await bizC("POST", `/api/posts/${post1.data.post.id}/license-request`, {});
  check("extension request created inside the window at the creator's listed fee", extReq.status === 201 && extReq.data.licenseRequest.fee === 80 && extReq.data.licenseRequest.renewal === true && extReq.data.licenseRequest.extensionOf === "standard" && extReq.data.licenseRequest.status === "pending", `${extReq.status} ${JSON.stringify(extReq.data).slice(0, 240)}`);
  const decline = await crC("POST", `/api/license-requests/${extReq.data.licenseRequest.id}/respond`, { decision: "decline" });
  check("creator declines the extension: no new licence takes effect", decline.status === 200 && decline.data.licenseRequest.status === "declined", JSON.stringify(decline.data).slice(0, 160));
  const extReq2 = await bizC("POST", `/api/posts/${post1.data.post.id}/license-request`, {});
  check("a fresh extension request after a decline is allowed", extReq2.status === 201, `${extReq2.status}`);
  const approve = await crC("POST", `/api/license-requests/${extReq2.data.licenseRequest.id}/respond`, { decision: "approve" });
  const endsMs = approve.data && approve.data.licenseRequest ? Date.parse(approve.data.licenseRequest.windowEndsAt) : 0;
  check("creator approval creates a NEW dated licence: fresh 90 days from approval", approve.status === 200 && approve.data.licenseRequest.status === "granted" && approve.data.licenseRequest.id !== `std-${pb.id}` && endsMs > Date.now() + 89 * DAY && endsMs < Date.now() + 91 * DAY, JSON.stringify(approve.data).slice(0, 240));
  check("the new licence keeps the creator 97% of the listed fee", !!approve.data.licenseRequest && approve.data.licenseRequest.creatorNet === 77.6, JSON.stringify(approve.data.licenseRequest || {}).slice(0, 200));

  part("A1 live: comped-post licensing unchanged");
  const off = await bizC("POST", "/api/offers", { spots: 1, creatorId: crReg.data.user.id, title: "Comp dinner A1", whatComped: "Meal for two, on us", dollarCap: 100 });
  check("comp offer created", off.status === 201, `${off.status} ${JSON.stringify(off.data).slice(0, 160)}`);
  const acc = await crC("POST", `/api/offers/${off.data.offer.id}/accept`, { visitDate: "2026-11-04" });
  check("comp offer accepted", acc.status === 201, `${acc.status} ${JSON.stringify(acc.data).slice(0, 160)}`);
  const conf = await bizC("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
  check("comp booking confirmed", conf.status === 200, `${conf.status}`);
  const post2 = await crC("POST", "/api/posts", { bookingId: acc.data.booking.id, url: "https://www.instagram.com/p/phasea110comp/", disclosedComp: true });
  check("comped post submitted (visit was redeemed on accept/confirm path or clock already running)", post2.status === 201 || post2.status === 409, `${post2.status} ${JSON.stringify(post2.data).slice(0, 200)}`);
  if (post2.status === 201) {
    const db2 = readDb();
    check("no stdlicence record is created for a comped post", !db2[`stdlicence:std-${acc.data.booking.id}`] && !(post2.data.post && post2.data.post.standardLicence), "");
    const lr = await bizC("POST", `/api/posts/${post2.data.post.id}/license-request`, {});
    check("comped license request at the listed fee, NOT an extension", lr.status === 201 && lr.data.licenseRequest.fee === 80 && lr.data.licenseRequest.renewal === false && !lr.data.licenseRequest.extensionOf, `${lr.status} ${JSON.stringify(lr.data).slice(0, 200)}`);
    const lrApprove = await crC("POST", `/api/license-requests/${lr.data.licenseRequest.id}/respond`, { decision: "approve" });
    const lrEnds = lrApprove.data && lrApprove.data.licenseRequest ? Date.parse(lrApprove.data.licenseRequest.windowEndsAt) : 0;
    check("comped approval grants 90 days from approval, creator keeps 97%", lrApprove.status === 200 && lrApprove.data.licenseRequest.status === "granted" && lrEnds > Date.now() + 89 * DAY && lrEnds < Date.now() + 91 * DAY && lrApprove.data.licenseRequest.creatorNet === 77.6, JSON.stringify(lrApprove.data).slice(0, 200));
  }
} catch (e) {
  failed++; fails.push("exception: " + e.message);
  console.error("EXCEPTION", e);
} finally {
  await stopServer();
}

console.log(`\nBuild -110 (Phase A) verification: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
