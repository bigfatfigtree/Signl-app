#!/usr/bin/env node
// Founding business first-60-seconds preview verification
// (Jeff, 2026-10-29): a business that has signed up but is NOT
// activated gets exactly one read, GET /api/me/roster-preview.
// BUILD -30 re-ruled the payload (Jeff, 2026-10-29): NO roster
// counts and NO creator cards (totals and thin-market framing
// are anti-marketing while rosters are small); the payload
// carries category presence only, the canonical categories with
// at least one finished creator in the business's own market.
// This suite pins:
//   - pending AND approved founding businesses can read it
//     (their Founding Status page is the same screen);
//   - categories are presence only: no totals, no shown count,
//     no creator list rides the payload, and an empty market
//     answers an empty category list;
//   - the founding gate still refuses Discover and the rest;
//   - creators and anonymous callers cannot read it, and an
//     ACTIVATED business no longer can (it has the real roster);
//   - the client ships the preview sections with locked copy,
//     no count or thin-market strings, and no em dashes in the
//     new code. (Roster ranking by local reach is pinned on the
//     creator side in Part B and by Discover's own suites.)
// Run: node scripts/verify-first60.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8931;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-first60-${Date.now()}.json`);

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

async function makeBusiness({ businessName, email, market, city, category, planId }) {
  const b = client();
  const reg = await b("POST", "/api/auth/register", {
    role: "business", name: "Owner " + businessName, businessName, email,
    password: "business-pass-123", market, city, category, planId,
    neighborhood: "", about: "", agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
  return { client: b, id: reg.data.user.id };
}

try {
  startServer();
  check("dev server boots in production shape", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // ---------- roster: three Richmond creators, scrambled local reach ----------
  const cLow = await makeCreator(admin, { name: "Preview Pam", email: "pam@fixtures.dev", handle: "previewpam", followers: 8000, localPct: 40 });
  const cHigh = await makeCreator(admin, { name: "Preview Quinn", email: "quinn@fixtures.dev", handle: "previewquinn", followers: 900, localPct: 90 });
  const cMid = await makeCreator(admin, { name: "Preview Rob", email: "rob@fixtures.dev", handle: "previewrob", followers: 6000, localPct: 70 });

  // ---------- pending founding business reads the preview ----------
  const biz = await makeBusiness({ businessName: "Preview Kitchen", email: "kitchen@fixtures.dev", market: "Richmond", city: "Richmond", category: "Restaurant", planId: "growth" });
  const pendingPreview = await biz.client("GET", "/api/me/roster-preview");
  check("pending founding business can read the roster preview (200)", pendingPreview.status === 200, JSON.stringify(pendingPreview.data).slice(0, 200));
  check("preview is labeled a preview for its own market", pendingPreview.data.preview === true && pendingPreview.data.market === "Richmond", JSON.stringify(pendingPreview.data).slice(0, 160));
  check("preview carries category presence for the market (Food & Drink from the finished roster)",
    Array.isArray(pendingPreview.data.categories) && pendingPreview.data.categories.includes("Food & Drink"),
    JSON.stringify(pendingPreview.data).slice(0, 200));
  check("preview carries NO counts and NO creator list (no totals, no shown, no creators key)",
    !("totalInMarket" in pendingPreview.data) && !("shown" in pendingPreview.data) && !("creators" in pendingPreview.data) && !JSON.stringify(pendingPreview.data).includes("totalInMarket"),
    JSON.stringify(pendingPreview.data).slice(0, 200));

  // ---------- the founding gate is untouched ----------
  const gate = await biz.client("GET", "/api/discover");
  check("founding business still cannot open Discover (403, founding answer)", gate.status === 403 && /founding list/.test(gate.data.error || ""), JSON.stringify(gate.data).slice(0, 160));

  // ---------- approved founding business still reads it ----------
  await admin("POST", "/api/admin/review", { userId: biz.id, decision: "approve" });
  const approvedPreview = await biz.client("GET", "/api/me/roster-preview");
  check("approved (still founding) business can read the preview (200, same categories)", approvedPreview.status === 200 && Array.isArray(approvedPreview.data.categories) && approvedPreview.data.categories.includes("Food & Drink"), JSON.stringify(approvedPreview.data).slice(0, 160));

  // ---------- other roles cannot ----------
  const creatorRead = await cHigh.client("GET", "/api/me/roster-preview");
  check("a creator cannot read the business preview (403)", creatorRead.status === 403, String(creatorRead.status));
  const anon = client();
  const anonRead = await anon("GET", "/api/me/roster-preview");
  check("an anonymous caller cannot read the preview (401 or 403)", anonRead.status === 401 || anonRead.status === 403, String(anonRead.status));

  // ---------- empty market answers an honest zero ----------
  const emptyBiz = await makeBusiness({ businessName: "Nashville Empty", email: "empty@fixtures.dev", market: "Nashville", city: "Nashville", category: "Retail", planId: "self-service" });
  const emptyPreview = await emptyBiz.client("GET", "/api/me/roster-preview");
  check("a market with no finished profiles answers an empty category list and no counts (200)",
    emptyPreview.status === 200 && Array.isArray(emptyPreview.data.categories) && emptyPreview.data.categories.length === 0 && !("creators" in emptyPreview.data) && !("totalInMarket" in emptyPreview.data),
    JSON.stringify(emptyPreview.data).slice(0, 200));

  // ---------- activation closes the preview ----------
  await admin("POST", "/api/admin/businesses/activate", { userId: biz.id });
  const activePreview = await biz.client("GET", "/api/me/roster-preview");
  check("an ACTIVATED business no longer reads the preview (403, pointed at Find creators)", activePreview.status === 403 && /active/.test(activePreview.data.error || ""), JSON.stringify(activePreview.data).slice(0, 160));
  const activeDiscover = await biz.client("GET", "/api/discover");
  check("the activated business reads the real roster through Discover instead (200)", activeDiscover.status === 200 && (activeDiscover.data.creators || []).length === 3, String(activeDiscover.status));

  // ---------- client ships the preview ----------
  const appJs = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public", "app.js"), "utf8");
  const sliceStart = appJs.indexOf("function renderBusinessFoundingStatus");
  const sliceEnd = appJs.indexOf("function renderPending()", sliceStart);
  const slice = sliceStart > -1 && sliceEnd > sliceStart ? appJs.slice(sliceStart, sliceEnd) : "";
  check("client loads the preview into the founding status page", slice.includes("loadFoundingBusinessPreview") && slice.includes("/me/roster-preview"), "");
  check("client ships the first-offer reveal, the benefit lines, and the pricing strip",
    slice.includes("Your first offer is already drafted") && slice.includes("Ranked by local reach") && slice.includes("The Visit Guarantee") && slice.includes("Results on day 7, 14, and 30") && slice.includes("Locked founding rates"),
    "");
  check("client labels the offer draft an unsaved preview", slice.includes("Nothing is saved, nothing is sent"), "");
  check("client ships category presence, the labeled local-reach example, and the founding scarcity line",
    slice.includes("foundingCategoriesHtml") && slice.includes("Categories recruiting now") && slice.includes("Example: a 2,000-follower creator whose audience is 90% local outranks a 50,000-follower account at 12% local") && slice.includes("Founding businesses get first access to the roster"), "");
  check("client founding page carries no roster totals, no thin-market copy, no stand-ins line (BUILD -30)",
    !slice.includes("totalInMarket") && !slice.includes("will never be padded with stand-ins") && !slice.includes("roster is being built now") && !slice.includes("Showing the top"), "");
  check("no em dashes anywhere in the new founding preview code", !slice.includes("—"), "");
  check("build stamp is the new build on both sides",
    fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "netlify", "functions", "lib", "build.js"), "utf8").includes("2026.10.29-36")
    && fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public", "index.html"), "utf8").includes("2026.10.29-36"), "");

  // ================================================================
  // Part B: creator excitement layer (Jeff, 2026-10-29).
  // GET /me/founding carries buzz: the creator's rank in their
  // market BY LOCAL REACH plus the market's unlock progress,
  // computed from the same three Richmond fixtures Part A seeded.
  // ================================================================
  const qFounding = await cHigh.client("GET", "/api/me/founding");
  check("creator founding payload carries the buzz object", qFounding.status === 200 && !!(qFounding.data && qFounding.data.buzz), JSON.stringify(qFounding.data).slice(0, 200));
  const qRank = qFounding.data && qFounding.data.buzz ? qFounding.data.buzz.localRank : null;
  check("local rank is by local reach: 90% ranks #1 of 3", !!qRank && qRank.rank === 1 && qRank.field === 3 && qRank.localAudiencePct === 90, JSON.stringify(qRank));
  const rFounding = await cMid.client("GET", "/api/me/founding");
  const rRank = rFounding.data && rFounding.data.buzz ? rFounding.data.buzz.localRank : null;
  check("70% local ranks #2: follower count (6,000 vs 900) does not move the rank", !!rRank && rRank.rank === 2 && rRank.localAudiencePct === 70, JSON.stringify(rRank));
  const pFounding = await cLow.client("GET", "/api/me/founding");
  const pRank = pFounding.data && pFounding.data.buzz ? pFounding.data.buzz.localRank : null;
  check("40% local (8,000 followers) ranks #3: reach beats audience size", !!pRank && pRank.rank === 3, JSON.stringify(pRank));
  const qUnlock = qFounding.data && qFounding.data.buzz ? qFounding.data.buzz.unlock : null;
  check("unlock meter carries real counts against the launch bar", !!qUnlock && qUnlock.approved === 3 && qUnlock.complete === 3 && qUnlock.launchBar === 25 && qUnlock.marketLive === false, JSON.stringify(qUnlock));
  const bizFounding = await biz.client("GET", "/api/me/founding");
  check("businesses cannot read the creator founding payload (403)", bizFounding.status === 403, String(bizFounding.status));

  // Client pins for the creator layer.
  const buzzFrom = appJs.indexOf("creator excitement layer");
  const buzzTo = appJs.indexOf("The founding Status tab", buzzFrom);
  const buzzSlice = buzzFrom > -1 && buzzTo > buzzFrom ? appJs.slice(buzzFrom, buzzTo) : "";
  check("client ships the excitement layer (stat card, unlock meter, momentum payoff)",
    buzzSlice.includes("creatorStatCardHtml") && buzzSlice.includes("Share my stat card") && buzzSlice.includes("City unlock meter") && buzzSlice.includes("Momentum moves you up") && buzzSlice.includes("stack order the business picks from"),
    `slice ${buzzSlice.length} chars`);
  check("founding home renders the excitement layer from data.buzz", appJs.includes("${creatorBuzzHtml(u, card, f, data.buzz)}"), "");
  check("excitement layer code carries no em dashes", buzzSlice.length > 0 && !buzzSlice.includes("—"), "");
  check("no surface claims Momentum shows creators paid campaigns first (the creator feed is newest-first)", !appJs.includes("see paid campaigns first") && !appJs.includes("paid campaigns first"), "");
  check("rate moment states pay-at-rate, keep 97%, held until post live at the rate field",
    appJs.includes("Businesses pay your listed rate of") && appJs.includes("SIGNL holds the payment until your post is live"), "");
  const routerSrc = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "netlify", "functions", "lib", "router.js"), "utf8");
  const buzzFnFrom = routerSrc.indexOf("async function creatorBuzz");
  const buzzFn = buzzFnFrom > -1 ? routerSrc.slice(buzzFnFrom, buzzFnFrom + 2600) : "";
  check("server buzz computation is present and carries no em dashes", buzzFn.length > 0 && !buzzFn.includes("—"), `slice ${buzzFn.length} chars`);
} catch (e) {
  failed += 1;
  failures.push("suite crashed: " + e.message);
  console.error(e);
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
  console.log(`\nverify-first60: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log("failures:\n - " + failures.join("\n - "));
  process.exit(failed ? 1 : 0);
}
