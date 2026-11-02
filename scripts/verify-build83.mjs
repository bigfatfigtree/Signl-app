// Build -83 verification: Intent & Return.
//
// Jeff (2026-11-02, from the Chelsea call): shares and saves
// are INTENT. Capture gains saves beside views/likes/shares
// (all recorded class, absent = "not reported", never
// zero-filled); the creator sees their exact numbers; the
// business sees the same numbers plus the funnel (Local reach
// recorded -> Intent recorded -> Visits counted -> Register
// revenue counted, classes labeled, honest empty states); and
// a 0-100 Return score built from intent rate (70%) and like
// rate (30%) against fixed caps, with a bounded counted lift.
// The score never touches Discover ranking. Thin data (no
// reported views) scores nothing. Demo profiles carry no
// engagement at all; the public strip needs 3+ reported posts;
// the sample story's funnel stays SAMPLE-consistent.
//
// Fixture math (hand-computed): views 10000, likes 800,
// shares 300, saves 200 -> intent 500, intentRate 50/1k (cap
// 50 -> component 100), likeRate 80/1k (cap 100 -> component
// 80), base = 0.7*100 + 0.3*80 = 94; 3 counted customers ->
// lift 3; score 97.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8993;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin83@fixtures.dev";
const ADMIN_PASSWORD = "admin-password-83";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b83-"));
const dbFile = path.join(tmp, "db.json");

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; console.log(`  FAIL - ${name}${detail ? " :: " + String(detail).slice(0, 260) : ""}`); }
}
function makeClient() {
  let cookie = "";
  return async (method, p, body) => {
    const res = await fetch(BASE + p, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data, text };
  };
}
const anon = makeClient();
const admin = makeClient();
let uniqN = 0;
const uniq = () => `${Date.now().toString(36)}${(uniqN++).toString(36)}`;

async function registerCreator(handle, name) {
  const client = makeClient();
  const r = await client("POST", "/api/auth/register", {
    role: "creator", name: name || `Creator ${handle}`, email: `${handle}@fixtures.dev`, password: "password123",
    market: "Hampton Roads", city: "Norfolk", handle,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: 5000, avgViews: 900, localAudiencePct: 62, bio: "",
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (r.status !== 201 || !r.data.user) throw new Error(`creator register failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { client, user: r.data.user };
}
async function registerBusiness(businessName, planId, market) {
  const client = makeClient();
  const r = await client("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", email: `biz-${uniq()}@fixtures.dev`, password: "password123",
    market: market || "Hampton Roads", city: market === "Nashville" ? "Nashville" : "Norfolk", businessName, category: "Restaurant", planId: planId || "growth", agreedTerms: true,
  });
  if (r.status !== 201 || !r.data.user) throw new Error(`business register failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { client, user: r.data.user };
}
async function approve(userId) {
  const r = await admin("POST", "/api/admin/review", { userId, decision: "approve" });
  if (r.status !== 200) throw new Error(`approve failed: ${r.status} ${JSON.stringify(r.data)}`);
}
async function compVisitWithPost(business, creator, title) {
  const off = await business.client("POST", "/api/offers", { title, whatComped: "Dinner for two", dollarCap: 60, spots: 1, includesAlcohol: false, creatorId: creator.user.id });
  if (off.status !== 201) throw new Error(`offer failed: ${off.status} ${JSON.stringify(off.data)}`);
  const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
  if (acc.status !== 201) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.data)}`);
  const booking = acc.data.booking;
  const conf = await business.client("POST", `/api/bookings/${booking.id}/confirm`, {});
  if (conf.status !== 200) throw new Error(`confirm failed: ${conf.status} ${JSON.stringify(conf.data)}`);
  const post = await creator.client("POST", "/api/posts", { bookingId: booking.id, url: `https://www.instagram.com/p/B83${uniq()}/`, includesDisclosure: true });
  if (post.status !== 201) throw new Error(`post failed: ${post.status} ${JSON.stringify(post.data)}`);
  return booking;
}

async function main() {
  const loginRes = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginRes.status !== 200) throw new Error(`admin login failed: ${loginRes.status}`);

  // ---------- main fixture: one post, full numbers, counted ----------
  const biz = await registerBusiness("Intent Kitchen");
  const chef = await registerCreator("intentchef");
  await approve(chef.user.id);
  await chef.client("PATCH", "/api/me/profile", { publicPage: true });
  await approve(biz.user.id);
  await admin("POST", "/api/admin/businesses/activate", { userId: biz.user.id });

  const bk = await compVisitWithPost(biz, chef, "Intent tasting");
  const perf = await chef.client("POST", `/api/bookings/${bk.id}/performance`, { views: 10000, likes: 800, comments: 10, shares: 300, saves: 200 });
  check("capture: the performance report accepts and stores saves beside views, likes, shares",
    perf.status === 200 && perf.data.post.saves === 200 && perf.data.post.shares === 300 && perf.data.post.views === 10000,
    `${perf.status} ${JSON.stringify(perf.data.post || perf.data).slice(0, 180)}`);
  check("capture: the performance summary carries saves (recorded class)",
    perf.data.post.performance && perf.data.post.performance.saves === 200 && perf.data.post.performance.reported === true,
    JSON.stringify(perf.data.post.performance || null));
  const badSaves = await chef.client("POST", `/api/bookings/${bk.id}/performance`, { saves: -1 });
  const fracSaves = await chef.client("POST", `/api/bookings/${bk.id}/performance`, { saves: 2.5 });
  check("capture: negative or fractional saves are refused", badSaves.status === 400 && fracSaves.status === 400, `${badSaves.status}/${fracSaves.status}`);

  const tally = await biz.client("POST", `/api/bookings/${bk.id}/code-redemptions`, { count: 3, basketTotal: 162, compCostActual: 20 });
  check("fixture: the register tally lands (3 counted customers, $162)", tally.status === 200, `${tally.status} ${JSON.stringify(tally.data).slice(0, 140)}`);

  // ---------- the readout: intent, funnel, score ----------
  const ro = await biz.client("GET", "/api/me/performance-readout");
  const o = ro.data.overall || {};
  check("readout: intent sums are the recorded figures exactly (500 = 300 shares + 200 saves)",
    o.intent && o.intent.views === 10000 && o.intent.shares === 300 && o.intent.saves === 200 && o.intent.intent === 500 && o.intent.reportedPosts === 1,
    JSON.stringify(o.intent || null));
  const steps = Object.fromEntries(((o.funnel || {}).steps || []).map((s) => [s.key, s]));
  check("funnel: reach 10,000 recorded, intent 500 recorded, visits 3 counted, revenue $162 counted, classes on their faces",
    steps.reach && steps.reach.value === 10000 && steps.reach.cls === "recorded" && steps.reach.reported === true &&
    steps.intent && steps.intent.value === 500 && steps.intent.cls === "recorded" &&
    steps.visits && steps.visits.value === 3 && steps.visits.cls === "counted" &&
    steps.revenue && steps.revenue.value === 162 && steps.revenue.cls === "counted",
    JSON.stringify(steps));
  check("funnel: conversions only where both steps have data (5% intent rate, 0.6% to counted, $54 a visit)",
    o.funnel && o.funnel.conversions.intentPerReachPct === 5 && o.funnel.conversions.visitsPerIntentPct === 0.6 && o.funnel.conversions.revenuePerVisit === 54,
    JSON.stringify((o.funnel || {}).conversions || null));
  check("return score: 97 (base 94 = 70% intent at cap + 30% like rate 80, plus counted lift 3)",
    o.returnScore && o.returnScore.score === 97 && o.returnScore.base === 94 && o.returnScore.countedLift === 3 && o.returnScore.intentRatePer1k === 50,
    JSON.stringify(o.returnScore || null));
  const row = (ro.data.offers || [])[0] || {};
  check("return score: the campaign row carries the same score and intent",
    row.returnScore && row.returnScore.score === 97 && row.intent && row.intent.intent === 500,
    JSON.stringify({ rs: row.returnScore, intent: row.intent }));

  // ---------- per-post payloads ----------
  const bizBookings = await biz.client("GET", "/api/bookings");
  const bb = (bizBookings.data.bookings || []).find((b) => b.id === bk.id) || {};
  check("per post (business view): intent 500, saves in the summary, Return score 97 rides the post",
    bb.post && bb.post.intent === 500 && bb.post.performance && bb.post.performance.saves === 200 && bb.post.returnScore && bb.post.returnScore.score === 97,
    JSON.stringify(bb.post || null).slice(0, 220));
  const crReadout = await chef.client("GET", "/api/me/performance-readout");
  const crow = ((crReadout.data || {}).posts || [])[0] || {};
  check("creator side: the post row shows the exact views, shares, saves and intent",
    crow.views === 10000 && crow.shares === 300 && crow.saves === 200 && crow.intent === 500 && crow.intentRatePer1k === 50,
    JSON.stringify(crow).slice(0, 220));
  check("creator side: the creator's own overall intent matches",
    crReadout.data.overall && crReadout.data.overall.intent && crReadout.data.overall.intent.intent === 500,
    JSON.stringify((crReadout.data.overall || {}).intent || null));

  // ---------- profile engagement + public gate ----------
  // The business-facing track record rides the Discover card
  // payload (the book-me payload reserves it for owner/admin).
  async function discoverCard(client, handle, market) {
    const d = await client("GET", `/api/discover?market=${encodeURIComponent(market || "Hampton Roads")}`);
    const list = d.data.creators || d.data.cards || [];
    return list.find((c) => c.handle === handle || (c.profile && c.profile.handle === handle)) || null;
  }
  const chefCard = await discoverCard(biz.client, "intentchef");
  const tr = (chefCard || {}).trackRecord || {};
  check("profile (business view): engagement strip data with totals, averages and the post count",
    tr.engagement && tr.engagement.postsWithMetrics === 1 && tr.engagement.totals.intent === 500 && tr.engagement.totals.saves === 200 && tr.engagement.averages.shares === 300,
    JSON.stringify(tr.engagement || null));
  check("profile (business view): the creator-level Return score is 97",
    tr.returnScore && tr.returnScore.score === 97, JSON.stringify(tr.returnScore || null));
  const pubView = await anon("GET", "/api/c/intentchef");
  check("public gate: with only 1 reported post the public payload carries NO engagement",
    pubView.status === 200 && pubView.data.profile && pubView.data.profile.engagement === null,
    `${pubView.status} ${JSON.stringify(pubView.data.profile && pubView.data.profile.engagement)}`);
  const cpage1 = await fetch(`${BASE}/api/cpage/intentchef`);
  const cpage1Html = await cpage1.text();
  check("public gate: the served /c/ page shows no engagement strip below 3 reported posts",
    !cpage1Html.includes("Post engagement"), cpage1Html.slice(0, 120));

  // ---------- trio creator: the strip goes public at 3 ----------
  const biz2 = await registerBusiness("Trio Table");
  await approve(biz2.user.id);
  await admin("POST", "/api/admin/businesses/activate", { userId: biz2.user.id });
  const trio = await registerCreator("intenttrio");
  await approve(trio.user.id);
  await trio.client("PATCH", "/api/me/profile", { publicPage: true });
  for (let i = 0; i < 3; i++) {
    const b = await compVisitWithPost(biz2, trio, `Trio visit ${i + 1}`);
    const r = await trio.client("POST", `/api/bookings/${b.id}/performance`, { views: 1000, likes: 50, shares: 10, saves: 5 });
    if (r.status !== 200) throw new Error(`trio perf ${i} failed: ${r.status}`);
  }
  const pubTrio = await anon("GET", "/api/c/intenttrio");
  check("public gate: at 3 reported posts the engagement rides the public payload (totals across the 3)",
    pubTrio.data.profile && pubTrio.data.profile.engagement && pubTrio.data.profile.engagement.postsWithMetrics === 3 && pubTrio.data.profile.engagement.totals.views === 3000 && pubTrio.data.profile.engagement.totals.intent === 45,
    JSON.stringify(pubTrio.data.profile && pubTrio.data.profile.engagement));
  const cpage3 = await fetch(`${BASE}/api/cpage/intenttrio`);
  const cpage3Html = await cpage3.text();
  check("public strip: the served /c/ page renders the engagement strip, recorded, from 3 posts",
    cpage3Html.includes("Post engagement") && cpage3Html.includes("From 3 SIGNL posts") && cpage3Html.includes("Recorded"),
    cpage3Html.slice(0, 120));

  // ---------- thin data: reported nothing -> no score, honest funnel ----------
  const biz3 = await registerBusiness("Thin Table");
  await approve(biz3.user.id);
  await admin("POST", "/api/admin/businesses/activate", { userId: biz3.user.id });
  const thin = await registerCreator("intentthin");
  await approve(thin.user.id);
  await thin.client("PATCH", "/api/me/profile", { publicPage: true });
  await compVisitWithPost(biz3, thin, "Thin visit");
  const roThin = await biz3.client("GET", "/api/me/performance-readout");
  const ot = roThin.data.overall || {};
  const thinSteps = Object.fromEntries(((ot.funnel || {}).steps || []).map((s) => [s.key, s]));
  check("thin data: no reported views means NO return score (null), never a fabricated number",
    ot.returnScore === null, JSON.stringify(ot.returnScore));
  check("thin data: funnel steps report their honest state (reach and intent not reported, nothing counted)",
    thinSteps.reach && thinSteps.reach.reported === false && thinSteps.intent && thinSteps.intent.reported === false && thinSteps.visits && thinSteps.visits.reported === false,
    JSON.stringify(thinSteps));
  const thinCard = await discoverCard(biz3.client, "intentthin");
  check("thin data: a creator with no reported posts has NO engagement strip data at all",
    !!thinCard && thinCard.trackRecord && thinCard.trackRecord.engagement === undefined && thinCard.trackRecord.returnScore === undefined,
    JSON.stringify((thinCard || {}).trackRecord || null).slice(0, 200));

  // a post reported WITHOUT shares or saves: intent reads absent, not zero-filled fiction
  const bkPartial = await compVisitWithPost(biz3, thin, "Partial visit");
  const perfPartial = await thin.client("POST", `/api/bookings/${bkPartial.id}/performance`, { views: 500 });
  check("capture: a report of views only leaves saves absent (null), a real reported figure beside it",
    perfPartial.status === 200 && perfPartial.data.post.performance.saves === null && perfPartial.data.post.performance.views === 500 && perfPartial.data.post.saves === null,
    `${perfPartial.status} ${JSON.stringify(perfPartial.data.post || perfPartial.data).slice(0, 180)}`);
  const roPartial = await biz3.client("GET", "/api/me/performance-readout");
  check("thin data: views-only reporting yields intent 0 recorded on 1 reported post, and a score from views and likes alone (0 here, honestly)",
    roPartial.data.overall.intent.reportedPosts === 1 && roPartial.data.overall.intent.intent === 0 && roPartial.data.overall.returnScore && roPartial.data.overall.returnScore.score === 0,
    JSON.stringify({ intent: roPartial.data.overall.intent, rs: roPartial.data.overall.returnScore }));

  // ---------- Sig speaks intent ----------
  const sigBiz = await biz.client("POST", "/api/sig/ask", { q: "how am I doing" });
  check("sig (business): the numbers answer includes the recorded intent",
    sigBiz.status === 200 && /500 saves and shares/.test(sigBiz.data.text || ""), (sigBiz.data.text || "").slice(0, 200));
  const sigCr = await chef.client("POST", "/api/sig/ask", { q: "how am I doing" });
  check("sig (creator): the numbers answer includes their own recorded intent",
    sigCr.status === 200 && /500 saves and shares/.test(sigCr.data.text || ""), (sigCr.data.text || "").slice(0, 200));

  // ---------- the sample story funnel ----------
  const chelsea = await registerBusiness("Chelsea Friday Furniture", "self-service", "Nashville");
  await approve(chelsea.user.id);
  const sample = await chelsea.client("GET", "/api/me/sample-results");
  const st = (sample.data.sample || {}).totals || {};
  const intentSum = ((sample.data.sample || {}).creators || []).reduce((s, c) => s + (c.postShares || 0) + (c.postSaves || 0), 0);
  const sSteps = Object.fromEntries(((st.funnel || {}).steps || []).map((s) => [s.key, s]));
  check("sample: the funnel is consistent with the story (intent = the creators' shares + saves, revenue = counted x $54, reach = local reach)",
    sample.data.sample && st.intent === intentSum && intentSum > 0 && st.registerRevenue === st.customersCounted * 54 &&
    sSteps.reach && sSteps.reach.value === st.localReach && sSteps.revenue && sSteps.revenue.value === st.registerRevenue && sSteps.visits && sSteps.visits.value === st.customersCounted,
    JSON.stringify({ totals: st, intentSum }).slice(0, 260));

  // ---------- demo profiles carry no engagement ----------
  const load = await admin("POST", "/api/admin/demo-showcase/load", {});
  check("fixture: the demo showcase loads", load.status === 200 && load.data.result && load.data.result.created === 12, `${load.status} ${JSON.stringify(load.data).slice(0, 140)}`);
  const demoCard = await discoverCard(chelsea.client, "tesstastestn", "Nashville");
  check("demo guard: a demo creator's track record carries NO engagement and NO return score",
    !!demoCard && demoCard.trackRecord && demoCard.trackRecord.engagement === undefined && demoCard.trackRecord.returnScore === undefined,
    JSON.stringify((demoCard || {}).trackRecord || null).slice(0, 200));

  // ---------- app shell carries the build's copy ----------
  const shell = await (await fetch(`${BASE}/`)).text();
  check("shell: the build stamp is current", shell.includes("2026.11.02-84"), shell.slice(0, 120));
  const appJs = await (await fetch(`${BASE}/app.js`)).text();
  check("client: intent copy and the funnel ship in the bundle",
    appJs.includes("Saves and shares mean people planning to come") && appJs.includes("How reach funnels to return") && appJs.includes("Return score") && appJs.includes("perf-saves-"),
    "");
}

let server;
try {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  const deadline = Date.now() + 30000;
  for (;;) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error("server did not come up");
    await new Promise((r) => setTimeout(r, 250));
  }
  await main();
} catch (e) {
  failed++;
  console.log(`  FAIL - suite error: ${e.message}`);
} finally {
  if (server) server.kill("SIGTERM");
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nverify-build83: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
