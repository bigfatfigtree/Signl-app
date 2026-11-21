#!/usr/bin/env node
// Build -230 verification (Jeff's fix-all order, 2026-11-21):
//   1. Push send path: notifyUser events fan out to FCM (mocked
//      endpoint in-process), dead tokens are pruned, and the gate
//      is the FIREBASE_SERVICE_ACCOUNT_JSON env var only.
//   2. Dispute path: report a problem from a booking, the case in
//      Admin with booking context, the compliance sweep holding
//      every consequence from that booking while the case is
//      open, and resolution notifying both sides.
//   3-9. Static pins: site proof labeled as example, payment copy
//      matching the code, the signup post-compliance checkbox and
//      server gate, the caption line without an em dash, the
//      composer titled "Create an offer", the Inter shell + the
//      Home / Find / Maggie / Stats / Menu bar, plain sort labels,
//      and local-followers wording.
//
// Run: node scripts/verify-build230.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8998;
const STUB = 8997;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "AdminPass123!";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// ---------- mocked FCM ----------
const fcmCalls = [];
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    if (req.url === "/token") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "stub-access-token", expires_in: 3600 }));
      return;
    }
    if (req.url === "/send") {
      fcmCalls.push({ auth: req.headers.authorization || "", body: JSON.parse(body || "{}") });
      if (body.includes("dead-token-230")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: 404, status: "UNREGISTERED", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "projects/magpielocal/messages/stub1" }));
      return;
    }
    res.writeHead(404); res.end("{}");
  });
});
await new Promise((r) => stub.listen(STUB, "127.0.0.1", r));

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA_JSON = JSON.stringify({
  type: "service_account",
  project_id: "magpielocal",
  client_email: "push-test@magpielocal.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
});

// ---------- server harness ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-230-"));
const dbFile = path.join(tmp, "db.json");
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: {
      ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1",
      APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD,
      FIREBASE_SERVICE_ACCOUNT_JSON: SA_JSON,
      FCM_ENDPOINT: `http://127.0.0.1:${STUB}/send`,
      FCM_TOKEN_URL: `http://127.0.0.1:${STUB}/token`,
    },
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
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up");
}
function makeClient() {
  const jar = new Map();
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const part of setCookie.split(/,(?=[^;]+=)/)) {
      const m = part.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, data, text };
  }
  return api;
}
const uniq = () => Math.random().toString(36).slice(2, 9);
async function waitFor(pred, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return pred();
}

part("static pins (items 3-9)");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const pushJs = fs.readFileSync(path.join(root, "netlify/functions/lib/push.js"), "utf8");
const theme3 = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");
const siteDir = path.join(root, "..", "signl-site");
const siteIndex = fs.readFileSync(path.join(siteDir, "index.html"), "utf8");
const siteBiz = fs.readFileSync(path.join(siteDir, "businesses.html"), "utf8");
const siteCreators = fs.readFileSync(path.join(siteDir, "creators.html"), "utf8");
check("push: lib exists, gated on FIREBASE_SERVICE_ACCOUNT_JSON, FCM v1 for magpielocal",
  pushJs.includes("FIREBASE_SERVICE_ACCOUNT_JSON") && pushJs.includes("fcm.googleapis.com/v1/projects/") && pushJs.includes("magpielocal"));
check("push: notifyUser fans out fire-and-forget (never awaited)",
  routerJs.includes("pushLib.dispatchPush(userId, rec)") && !routerJs.includes("await pushLib.dispatchPush"));
check("push: dead-token pruning wired", pushJs.includes("UNREGISTERED") && pushJs.includes("store.del(`pushdevice:"));
check("caption: no em dash in the disclosure line, all three lanes",
  appJs.includes("#ad, comped by") && appJs.includes("#ad, paid partnership with") && appJs.includes("#ad, paid with a coupon by") && !appJs.includes("#ad —"));
check("composer: the page title is Create an offer", appJs.includes('wsHead("Create an offer"'));
check("signup: post-agreement checkbox on both creator forms, ES twins",
  appJs.includes('id="jc-agree-compliance"') && appJs.includes('id="c85-agree-post"') && appJs.includes("Acepto el acuerdo de publicación"));
check("signup: server refuses a creator without the agreement",
  routerJs.includes("b.agreedPostCompliance !== true") && routerJs.includes("postComplianceAcceptedAt"));
check("bar: creator stops are Home / Find / Maggie( Sig ) / Numbers(Stats) / Menu",
  appJs.includes('creator: ["Dashboard", "Find Offers", "Sig", "Numbers", "__menu137"]'));
check("bar: business stops are Home / Find / Maggie( Sig ) / Analytics(Stats) / Menu",
  appJs.includes('business: ["Home", "Discover", "Sig", "Analytics", "__menu137"]'));
check("bar: Stats label names both Stats tabs", appJs.includes('Numbers: "Stats"') && appJs.includes('Analytics: "Stats"'));
check("font: the shell override sets Inter and reserves semibold",
  theme3.includes("font-family: Inter, system-ui") && theme3.includes("font-weight: 600 !important"));
check("sort: plain labels, no Most people here option anywhere",
  appJs.includes('<option value="people">Most local followers</option>') && !appJs.includes(">Most people here</option>"));
check("wording: local followers in the lineup panel, similar shelf, and Maggie's lineup answer",
  appJs.includes("local followers · ") && fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8").includes("potential local followers"));
check("pay copy (app): canonical timing on the deal panel, wallet, and Maggie payout answer",
  (appJs.match(/live and verified, within 48 hours, once/g) || []).length >= 3 && !appJs.includes("releases it when your post is live"));
check("site proof: the real-app claim is gone and examples are labeled",
  !siteIndex.includes("This is the real app") && siteIndex.includes("An example of the app")
  && siteBiz.includes("an example of how reporting looks in the app") && siteCreators.includes("an example of how your track record looks in the app")
  && siteBiz.includes("<strong>Example:</strong>") && siteCreators.includes("<strong>Example:</strong>"));
check("site proof: no invented counted-visit results remain on the three pages",
  !siteBiz.includes("186 counted visits") && !siteCreators.includes("186 counted visits") && !siteBiz.includes("94 counted visits"));
check("pay copy (site): no moment-of-post payment promise remains on the three pages",
  !/moment (your|the|her) post is live/i.test(siteIndex + siteBiz + siteCreators)
  && siteCreators.includes("live and verified, within 48 hours, once your payout details are set up"));

part("live: signup compliance gate");
startServer();
await waitUp();
const admin = makeClient();
{ const r = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }); check("admin login", r.status === 200); }
const noAgree = makeClient();
const rNo = await noAgree("POST", "/api/auth/register", {
  role: "creator", name: "No Agree", email: `no230-${uniq()}@fixtures.dev`, password: "LongEnough1!",
  market: "Hampton Roads", city: "Norfolk", handle: `no230_${uniq()}`, categories: ["Food & Drink"],
  followerCount: 3000, localAudiencePct: 60, agreedTerms: true,
});
check("creator registration without the post agreement is refused (400)", rNo.status === 400 && /post agreement/i.test(rNo.data.error || ""), JSON.stringify(rNo.data).slice(0, 200));
const creator = makeClient();
const rYes = await creator("POST", "/api/auth/register", {
  role: "creator", name: "Casey Creator", email: `c230-${uniq()}@fixtures.dev`, password: "LongEnough1!",
  market: "Hampton Roads", city: "Norfolk", handle: `c230_${uniq()}`, categories: ["Food & Drink"],
  followerCount: 3000, localAudiencePct: 60, agreedTerms: true, agreedPostCompliance: true,
});
check("creator registration with the agreement succeeds (201)", rYes.status === 201, JSON.stringify(rYes.data).slice(0, 200));
const creatorId = rYes.data.user.id;
check("the agreement is stamped on the record", !!rYes.data.user.postComplianceAcceptedAt || (() => { const db = JSON.parse(fs.readFileSync(dbFile, "utf8")); return !!db[`user:${creatorId}`].postComplianceAcceptedAt; })());
await admin("POST", "/api/admin/review", { userId: creatorId, decision: "approve" });
const biz = makeClient();
const rBiz = await biz("POST", "/api/auth/register", {
  role: "business", name: "Biz Owner", email: `b230-${uniq()}@fixtures.dev`, password: "LongEnough1!",
  market: "Hampton Roads", city: "Norfolk", businessName: "Fixall Kitchen", category: "Restaurant", planId: "self-service", agreedTerms: true,
});
check("business registration does not need the creator agreement (201)", rBiz.status === 201, JSON.stringify(rBiz.data).slice(0, 200));
await admin("POST", "/api/admin/review", { userId: rBiz.data.user.id, decision: "approve" });
await admin("POST", "/api/admin/businesses/activate", { userId: rBiz.data.user.id });

part("live: push send path (mocked FCM)");
const regTok = await creator("POST", "/api/me/push/devices", { token: "livetoken-230-abcdefghij", platform: "android" });
check("device token registers", regTok.status === 200 && regTok.data.registered === true, JSON.stringify(regTok.data).slice(0, 150));
await creator("POST", "/api/me/push/devices", { token: "dead-token-230-abcdefghij", platform: "ios" });
const off = await biz("POST", "/api/offers", { spots: 1, creatorId, title: "Fixall tasting", whatComped: "Dinner for two", dollarCap: 60 });
check("direct offer created (fires offer_received)", off.status === 201, JSON.stringify(off.data).slice(0, 200));
const gotPush = await waitFor(() => fcmCalls.some((c) => JSON.stringify(c.body).includes("livetoken-230")));
check("FCM received a send for the registered token", gotPush, `calls=${fcmCalls.length}`);
const firstCall = fcmCalls.find((c) => JSON.stringify(c.body).includes("livetoken-230"));
check("the send carries the notification text and the Bearer token from the JWT grant",
  !!firstCall && /Fixall tasting/.test(firstCall.body.message.notification.body) && firstCall.auth === "Bearer stub-access-token",
  firstCall ? JSON.stringify(firstCall.body).slice(0, 250) : "no call");
const pruned = await waitFor(async () => false, 10); // settle window handled below
await new Promise((r) => setTimeout(r, 1200));
const devs = await creator("GET", "/api/me/push/devices");
check("the dead token was pruned, the live token remains",
  devs.data.devices.length === 1 && devs.data.devices[0].tokenTail === "cdefghij".slice(-6) || (devs.data.devices.length === 1 && devs.data.devices[0].platform === "android"),
  JSON.stringify(devs.data).slice(0, 200));

part("live: dispute path");
const acc = await creator("POST", `/api/offers/${off.data.offer.id}/accept`, { agreedVisitRules: true });
check("creator accepts, booking exists", acc.status === 201 && !!acc.data.booking, JSON.stringify(acc.data).slice(0, 200));
const bookingId = acc.data.booking.id;
const badReport = await creator("POST", `/api/bookings/${bookingId}/report-problem`, { reason: "visit_problem", note: "" });
check("a report without a note is refused", badReport.status === 400, JSON.stringify(badReport.data).slice(0, 150));
const rep1 = await creator("POST", `/api/bookings/${bookingId}/report-problem`, { reason: "visit_problem", note: "The kitchen was closed when I arrived." });
check("creator reports a problem (201, case open)", rep1.status === 201 && rep1.data.case.status === "open", JSON.stringify(rep1.data).slice(0, 250));
check("the case carries the booking context", rep1.data.case.context && rep1.data.case.context.title === "Fixall tasting" && rep1.data.case.bookingId === bookingId);
const rep2 = await creator("POST", `/api/bookings/${bookingId}/report-problem`, { reason: "other", note: "Second report" });
check("a second report rides the same open case", rep2.status === 200 && rep2.data.alreadyOpen === true && rep2.data.case.id === rep1.data.case.id);
const bizNotes = await biz("GET", "/api/notifications");
check("the other side was notified in-app", (bizNotes.data.notifications || []).some((x) => x.kind === "dispute_opened" && x.data && x.data.bookingId === bookingId));
const adminCases = await admin("GET", "/api/admin/cases");
check("Admin sees the case", adminCases.status === 200 && (adminCases.data.cases || []).some((c) => c.id === rep1.data.case.id), JSON.stringify(adminCases.data).slice(0, 200));

// Time-travel the booking into compliance danger, restart, sweep.
await stopServer();
{
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  const bk = db[`booking:${bookingId}`];
  const now = Date.now();
  bk.redeemedAt = new Date(now - 10 * 86400000).toISOString();
  bk.postDeadline = new Date(now - 8 * 86400000).toISOString();
  bk.status = "redeemed";
  bk.compliance = {};
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}
startServer();
await waitUp();
const creator2 = makeClient();
await creator2("POST", "/api/auth/login", { email: rYes.data.user.email, password: "LongEnough1!" });
const admin2 = makeClient();
await admin2("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
const sweep = await admin2("POST", "/api/admin/compliance/sweep", {});
check("the sweep reports the dispute hold", sweep.status === 200 && ((sweep.data.sweep || {}).disputeHeld || 0) >= 1, JSON.stringify(sweep.data).slice(0, 250));
const meAfter = await creator2("GET", "/api/auth/me");
const standing = meAfter.data.user.standing && meAfter.data.user.standing.state;
check("no pause or ban landed while the case is open", !standing || standing === "good", `standing=${standing}`);
const resolved = await admin2("POST", `/api/admin/cases/${rep1.data.case.id}/resolve`, { note: "We spoke with the kitchen. The visit is rebooked, no fault either side." });
check("Admin resolves with an outcome note", resolved.status === 200 && resolved.data.case.status === "resolved", JSON.stringify(resolved.data).slice(0, 200));
const creatorNotes = await creator2("GET", "/api/notifications");
check("the creator is notified of the resolution", (creatorNotes.data.notifications || []).some((x) => x.kind === "dispute_resolved" && x.data && x.data.caseId === rep1.data.case.id));
const biz2 = makeClient();
await biz2("POST", "/api/auth/login", { email: rBiz.data.user.email, password: "LongEnough1!" });
const bizNotes2 = await biz2("GET", "/api/notifications");
check("the business is notified of the resolution", (bizNotes2.data.notifications || []).some((x) => x.kind === "dispute_resolved" && x.data && x.data.caseId === rep1.data.case.id));

await stopServer();
stub.close();
console.log(`\nverify-build230: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
