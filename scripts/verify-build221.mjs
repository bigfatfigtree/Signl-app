// Build -221 verification: PROFILE-COMPLETION NUDGE.
// Three pieces:
//   1. Admin Review flag: completionGaps221 rides both the admin
//      queue payload and the creator's own payload; the client
//      flag helper names a missing follower count and/or local %.
//   2. Creator-side urgent prompt: the home prompt renders from
//      the same gaps (client helper + copy pinned here) and clears
//      itself once the profile is finished (proven end to end by
//      PATCHing the fixture profile complete and re-reading gaps).
//   3. Launch nudge: activating a market sends ONE in-app-only
//      Maggie message to each approved, unfinished creator in
//      that market, claimed before the send so a re-activation
//      can never double-send, and the email ping is suppressed
//      on the record with reason "in_app_only".
//
// Production safety: this suite only ever runs against a temp
// fixture DB (SIGNL_LOCAL_DB in the OS temp dir, created fresh
// for this run and deleted at the end). It never touches a
// production record; the "Chelsea-shaped" fixture below is a
// local record built through the real -220 add-a-side flow and
// then zeroed in the temp DB file to simulate the legacy shape.
//
// Run: node scripts/verify-build221.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const router = require("../netlify/functions/lib/router.js");

const PORT = 8961;
const STUB_PORT = 8962;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-221-pass";
const DB = path.join(os.tmpdir(), `signl-verify-build221-${Date.now()}.json`);
const PLATFORM_PEER_ID = "signl-team"; // PLATFORM_PEER_ID in router.js

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}
function note(msg) { console.log(`  NOTE  ${msg}`); }
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x));
const ALL_GAPS = ["followers", "localPct", "categories", "city"];

// ---------------- source pins ----------------
console.log("== source pins ==");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const idxHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const themeV3 = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");
check("build stamp is 2026.11.20-221 (lib + shell)", buildJs.includes("2026.11.20-221") && (idxHtml.match(/2026\.11\.20-221/g) || []).length >= 5);
check("server: completionGaps221 defined", routerJs.includes("function completionGaps221(user)"));
check("server: gaps attached in withFounding", routerJs.includes("pub.completionGaps = completionGaps221(user)"));
check("server: gaps attached in admin applications attach", routerJs.includes("pub.completionGaps = completionGaps221(u)"));
check("client: completionFlag221Html present", appJs.includes("function completionFlag221Html(u)"));
check("client: completionPrompt221Html present", appJs.includes("function completionPrompt221Html(u)"));
check("client: flag label texts present", appJs.includes("Needs follower count") && appJs.includes("Needs local %") && appJs.includes("Needs follower count and local %"));
check("client: prompt copy present (strong line + button)", appJs.includes("Your profile is not finished.") && appJs.includes("Businesses cannot find or book you until it is. Still missing:") && appJs.includes("Finish my profile"));
check("client: prompt inserted at the top of creator home", appJs.includes("${completionPrompt221Html(u)}"));
check("client: flag rendered in the Review list row and the deck card", (appJs.match(/completionFlag221Html\(u\)/g) || []).length >= 3);
check("css: .flag221 and .prompt221 treatments exist", themeV3.includes(".flag221") && themeV3.includes(".prompt221") && themeV3.includes(".prompt221-urgent"));
check("server: runLaunchNudges221 + launchnudge claim key + inAppOnly present", routerJs.includes("async function runLaunchNudges221") && routerJs.includes("launchnudge:") && routerJs.includes("inAppOnly"));
check("server: launchNudgeBody221 present, no em dash in its copy", routerJs.includes("function launchNudgeBody221") && !router.launchNudgeBody221({ name: "Fixture Fixture", email: "f@fixtures.dev" }, "Nashville", ALL_GAPS).includes("\u2014"));
check("server: toggle handler calls runLaunchNudges221", routerJs.includes("await runLaunchNudges221(user, market.name)"));
check("server: in-app-only suppression logs reason in_app_only", routerJs.includes('reason: "in_app_only"') && routerJs.includes('emailResult = { sent: false, suppressed: true, reason: "in_app_only" }'));

console.log("== unit: gap list + nudge body ==");
check("unit: one gap reads alone", router.gapListText221(["followers"]) === "your follower count", router.gapListText221(["followers"]));
check("unit: two gaps join with ' and '", router.gapListText221(["followers", "city"]) === "your follower count and your home city", router.gapListText221(["followers", "city"]));
check("unit: four gaps join comma + ', and '", router.gapListText221(ALL_GAPS) === "your follower count, your local audience percentage, the share of your followers who live in your city, your content categories, and your home city", router.gapListText221(ALL_GAPS));
const EXPECTED_NUDGE = "Hi Fixture, Maggie here from the Magpie team. Nashville is launching, and once your profile is finished, businesses there will be able to comp you an experience or pay you at your own rate. Right now businesses cannot find or book you because your profile is missing your follower count, your local audience percentage, the share of your followers who live in your city, your content categories, and your home city. Open the Profile tab and finish the basics at the top, and you will be ready.";
check("unit: launchNudgeBody221 exact copy for Fixture / Nashville / all gaps", router.launchNudgeBody221({ name: "Fixture Fixture", email: "f@fixtures.dev" }, "Nashville", ALL_GAPS) === EXPECTED_NUDGE, router.launchNudgeBody221({ name: "Fixture Fixture", email: "f@fixtures.dev" }, "Nashville", ALL_GAPS));
check("unit: completionGaps221 on a zeroed record is all four", sameSet(router.completionGaps221({ role: "creator", city: "", createdAt: new Date().toISOString(), creator: { handle: "x", followerCount: 0, totalAudience: 0, audienceStack: {}, localAudiencePct: null, categories: [] } }), ALL_GAPS));
check("unit: completionGaps221 on a non-creator is []", sameSet(router.completionGaps221({ role: "business", business: {} }), []));

// ---------------- AI stub (never expected to be called) ----------------
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "STUB AI ANSWER" } }] }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));

// ---------------- dev server harness (same shape as -220) ----------------
function client() {
  const jar = new Map();
  return async (method, p, body) => {
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
  };
}
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1", SIG_AI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`, SIG_AI_API_KEY: "stub-key", SIG_AI_MODEL: "stub-model" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 500)); server = null; }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
function readDb() { return JSON.parse(fs.readFileSync(DB, "utf8")); }
function writeDb(db) { fs.writeFileSync(DB, JSON.stringify(db)); }
function zeroRecord(db, userId) {
  const rec = db[`user:${userId}`];
  if (!rec || !rec.creator) throw new Error(`zeroRecord: no creator record for ${userId}`);
  rec.creator.followerCount = 0;
  rec.creator.totalAudience = 0;
  rec.creator.audienceStack = {};
  rec.creator.localAudiencePct = null;
  rec.creator.categories = [];
  rec.creator.profileComplete = false;
  rec.city = "";
  return rec;
}
function platformMessagesTo(db, userId) {
  return Object.values(db).filter((v) => v && v.toId === userId && v.fromId === PLATFORM_PEER_ID && typeof v.threadId === "string" && typeof v.body === "string");
}
function eventsOf(db, type) {
  return Object.values(db).filter((v) => v && v.type === type);
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const CHELSEA_EMAIL = "chelsea221@fixtures.dev";
const CHELSEA_PW = "chelsea-pass-221";
let fixtureCreatorId = null;
let completeCreatorId = null;
let austinCreatorId = null;

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200, JSON.stringify(adminLogin.data).slice(0, 120));

  console.log("== Chelsea-shaped fixture: business + add-a-side creator (the -220 flow) ==");
  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Fixture Chelsea", email: CHELSEA_EMAIL, password: CHELSEA_PW,
    businessName: "Fixture Friday Furniture 221", category: "Retail", market: "Nashville", city: "Nashville", agreedTerms: true,
  });
  check("business registers (pending)", bizReg.status === 201 && bizReg.data.user.role === "business", JSON.stringify(bizReg.data).slice(0, 200));
  const bizId = bizReg.data.user.id;
  const bizAppr = await admin("POST", "/api/admin/review", { userId: bizId, decision: "approve" });
  check("business approved", bizAppr.status === 200 && bizAppr.data.user.status === "approved", JSON.stringify(bizAppr.data).slice(0, 160));
  const side = await biz("POST", "/api/auth/add-side", { role: "creator", quickClaim: true, handle: "fixturefriday221", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true, followerCount: 12345, localAudiencePct: 65 });
  check("creator side created WITH facts (-220 form)", (side.status === 200 || side.status === 201) && side.data.user.role === "creator", JSON.stringify(side.data).slice(0, 200));
  fixtureCreatorId = side.data.user.id;
  const sideAppr = await admin("POST", "/api/admin/review", { userId: fixtureCreatorId, decision: "approve" });
  check("creator side approved", sideAppr.status === 200 && sideAppr.data.user.status === "approved", JSON.stringify(sideAppr.data).slice(0, 160));

  console.log("== control creators: complete Nashville + complete Austin (zeroed later) ==");
  const completeClient = client();
  const completeReg = await completeClient("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "complete221@fixtures.dev", password: "complete-pass-221",
    market: "Nashville", city: "Nashville", handle: "complete221", primaryPlatform: "instagram",
    audienceStack: { instagram: 4200 }, followerCount: 4200, localAudiencePct: 65, categories: ["Food & Drink"], ...AGREE,
  });
  check("complete Nashville creator registers", completeReg.status === 201 && completeReg.data.user.role === "creator", JSON.stringify(completeReg.data).slice(0, 200));
  completeCreatorId = completeReg.data.user.id;
  check("complete creator's register payload already carries completionGaps []", sameSet(completeReg.data.user.completionGaps, []), JSON.stringify(completeReg.data.user.completionGaps));
  const completeAppr = await admin("POST", "/api/admin/review", { userId: completeCreatorId, decision: "approve" });
  check("complete Nashville creator approved", completeAppr.status === 200, JSON.stringify(completeAppr.data).slice(0, 160));

  const austinClient = client();
  const austinReg = await austinClient("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "austin221@fixtures.dev", password: "austin-pass-221",
    market: "Austin", city: "Austin", handle: "austin221", primaryPlatform: "instagram",
    audienceStack: { instagram: 4200 }, followerCount: 4200, localAudiencePct: 50, categories: ["Food & Drink"], ...AGREE,
  });
  check("Austin creator registers", austinReg.status === 201 && austinReg.data.user.role === "creator", JSON.stringify(austinReg.data).slice(0, 200));
  austinCreatorId = austinReg.data.user.id;
  const austinAppr = await admin("POST", "/api/admin/review", { userId: austinCreatorId, decision: "approve" });
  check("Austin creator approved", austinAppr.status === 200, JSON.stringify(austinAppr.data).slice(0, 160));

  console.log("== zero the fixture + Austin records in the temp DB (legacy shape), restart ==");
  await stopServer();
  const dbEdit = readDb();
  zeroRecord(dbEdit, fixtureCreatorId);
  zeroRecord(dbEdit, austinCreatorId);
  writeDb(dbEdit);
  const zc = readDb()[`user:${fixtureCreatorId}`];
  check("temp DB fixture is legacy-shaped (0 / null / [] / no city)", zc.creator.followerCount === 0 && zc.creator.totalAudience === 0 && zc.creator.localAudiencePct === null && zc.creator.categories.length === 0 && zc.city === "");
  startServer();
  check("dev server reboots after the DB edit", await waitUp());
  const admin2Login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in again", admin2Login.status === 200);

  console.log("== flag + gaps payloads ==");
  const apps = await admin("GET", "/api/admin/applications");
  check("admin applications load", apps.status === 200, JSON.stringify(apps.data).slice(0, 160));
  const allPayloads = [...(apps.data.pending || []), ...(apps.data.decided || [])];
  const fixturePayload = allPayloads.find((u) => u.id === fixtureCreatorId);
  check("fixture creator in the admin payload carries all four gaps", !!fixturePayload && sameSet(fixturePayload.completionGaps, ALL_GAPS), JSON.stringify(fixturePayload && fixturePayload.completionGaps));
  const completePayload = allPayloads.find((u) => u.id === completeCreatorId);
  check("complete creator in the admin payload carries completionGaps []", !!completePayload && sameSet(completePayload.completionGaps, []), JSON.stringify(completePayload && completePayload.completionGaps));
  const austinPayload = allPayloads.find((u) => u.id === austinCreatorId);
  check("zeroed Austin creator in the admin payload carries all four gaps", !!austinPayload && sameSet(austinPayload.completionGaps, ALL_GAPS), JSON.stringify(austinPayload && austinPayload.completionGaps));

  // The -220 flow leaves the biz client's session on the creator side.
  let meFixture = await biz("GET", "/api/auth/me");
  if (!(meFixture.status === 200 && meFixture.data.user.id === fixtureCreatorId)) {
    const fresh = client();
    await fresh("POST", "/api/auth/login", { email: CHELSEA_EMAIL, password: CHELSEA_PW });
    const sw = await fresh("POST", "/api/auth/switch-side", {});
    if (sw.status === 200) { meFixture = { status: 200, data: { user: sw.data.user } }; biz.__fixture = fresh; }
  }
  const fixtureClient = biz.__fixture || biz;
  check("fixture creator session resolves to the creator side", meFixture.status === 200 && meFixture.data.user.id === fixtureCreatorId && meFixture.data.user.role === "creator", JSON.stringify(meFixture.data).slice(0, 200));
  check("fixture creator /auth/me carries all four gaps", sameSet(meFixture.data.user.completionGaps, ALL_GAPS), JSON.stringify(meFixture.data.user.completionGaps));
  const meComplete = await completeClient("GET", "/api/auth/me");
  check("complete creator /auth/me carries completionGaps []", meComplete.status === 200 && sameSet(meComplete.data.user.completionGaps, []), JSON.stringify(meComplete.data).slice(0, 200));

  console.log("== launch nudge: Nashville activation ==");
  const toggle1 = await admin("POST", "/api/admin/markets/toggle", { market: "Nashville", live: true });
  check("Nashville activation answers 200", toggle1.status === 200, JSON.stringify(toggle1.data).slice(0, 240));
  check("activation reports eligible 1, sent 1", !!toggle1.data.launchNudges && toggle1.data.launchNudges.eligible === 1 && toggle1.data.launchNudges.sent === 1, JSON.stringify(toggle1.data.launchNudges));
  const dbNudge = readDb();
  const fixtureMsgs = platformMessagesTo(dbNudge, fixtureCreatorId);
  check("exactly ONE platform message to the fixture creator", fixtureMsgs.length === 1, String(fixtureMsgs.length));
  check("ZERO platform messages to the complete Nashville creator", platformMessagesTo(dbNudge, completeCreatorId).length === 0);
  check("ZERO platform messages to the Austin incomplete creator", platformMessagesTo(dbNudge, austinCreatorId).length === 0);
  const nudgeBody = fixtureMsgs.length ? fixtureMsgs[0].body : "";
  note(`nudge body: ${nudgeBody}`);
  check("nudge body names the launch, the comp-or-rate canon, and every missing field", nudgeBody.includes("Nashville is launching") && nudgeBody.includes("comp you an experience or pay you at your own rate") && nudgeBody.includes("your follower count") && nudgeBody.includes("your content categories") && nudgeBody.includes("your home city") && nudgeBody.includes("Open the Profile tab and finish the basics at the top"), nudgeBody.slice(0, 240));
  check("nudge body has no em dash", !nudgeBody.includes("\u2014"));
  const claim = dbNudge[`launchnudge:Nashville:${fixtureCreatorId}`];
  check("launchnudge claim record exists, status sent, with the messageId", !!claim && claim.status === "sent" && !!claim.messageId && fixtureMsgs.length === 1 && claim.messageId === fixtureMsgs[0].id, JSON.stringify(claim));
  const suppressed = eventsOf(dbNudge, "platform_message_email_suppressed").filter((e) => e.subjectId === fixtureCreatorId && e.data && e.data.reason === "in_app_only");
  check("email ping suppressed on the record with reason in_app_only", suppressed.length >= 1, String(suppressed.length));
  const emailEvents = [...eventsOf(dbNudge, "platform_message_email_queued"), ...eventsOf(dbNudge, "platform_message_email_sent")].filter((e) => e.subjectId === fixtureCreatorId);
  check("no platform_message email was queued or sent for the fixture", emailEvents.length === 0, String(emailEvents.length));
  check("fanout event logged once", eventsOf(dbNudge, "launch_nudge_fanout").length === 1, String(eventsOf(dbNudge, "launch_nudge_fanout").length));

  console.log("== idempotency: deactivate, reactivate ==");
  const toggleOff = await admin("POST", "/api/admin/markets/toggle", { market: "Nashville", live: false });
  check("deactivation answers 200 and runs no nudge", toggleOff.status === 200 && toggleOff.data.live === false && toggleOff.data.launchNudges === undefined, JSON.stringify(toggleOff.data).slice(0, 200));
  const toggle2 = await admin("POST", "/api/admin/markets/toggle", { market: "Nashville", live: true });
  check("second activation reports sent 0, alreadySent 1", !!toggle2.data.launchNudges && toggle2.data.launchNudges.sent === 0 && toggle2.data.launchNudges.alreadySent === 1 && toggle2.data.launchNudges.eligible === 1, JSON.stringify(toggle2.data.launchNudges));
  check("DB still holds exactly ONE nudge message to the fixture creator", platformMessagesTo(readDb(), fixtureCreatorId).length === 1);

  console.log("== prompt clears: finishing the profile empties the gaps ==");
  const patch = await fixtureClient("PATCH", "/api/me/profile", { audienceStack: { instagram: 4200 }, localAudiencePct: 65, categories: ["Food & Drink"], city: "Nashville" });
  check("fixture PATCH /me/profile succeeds", patch.status === 200, JSON.stringify(patch.data).slice(0, 240));
  const meAfter = await fixtureClient("GET", "/api/auth/me");
  check("after finishing, /auth/me completionGaps is [] (prompt clears itself)", meAfter.status === 200 && sameSet(meAfter.data.user.completionGaps, []), JSON.stringify(meAfter.data && meAfter.data.user && meAfter.data.user.completionGaps));
} finally {
  await stopServer();
  stub.close();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`\nverify-build221: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
