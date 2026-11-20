#!/usr/bin/env node
// Build -215 fixture suite: the claim-form upgrade.
// - the claim's facts (count stack, primary count, local %,
//   city, categories) ride POST /auth/register and are on the
//   stored record at FIRST WRITE — verified by reading the
//   local store file directly, with no PATCH call anywhere;
// - register refuses a quick claim with no primary count or
//   no local % (400, the full form's wording);
// - POST /api/count-lookup: TikTok live lookup (a known handle
//   returns a real count, a bogus handle returns not_found),
//   Instagram returns manual, a repeat call is served from the
//   store cache, and the route carries the magpielocal.com
//   CORS headers + preflight;
// - unit level: handle/platform normalization, the TikTok
//   rehydration parser's uniqueId trust check, and the YouTube
//   key gate (no key = manual, key + stubbed API = exact count).
// Run: node scripts/verify-build215.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const countLookup = require("../netlify/functions/lib/count-lookup.js");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}
function note(msg) { console.log(`  NOTE  ${msg}`); }

console.log("== stamps ==");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
check("BUILD_ID is 2026.11.20-215", buildJs.includes('exports.BUILD_ID = "2026.11.20-215"'));
check("shell stamp matches (5 assets)", (indexHtml.match(/2026\.11\.20-215/g) || []).length >= 5);

console.log("== static: server wiring ==");
const routerJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");
check("router requires count-lookup", routerJs.includes('require("./count-lookup")'));
check("count-lookup route beside ig-prefill, always-200 contract", routerJs.includes('seg[0] === "count-lookup"') && routerJs.includes("countLookup.lookupCount(b.platform, b.handle)"));
check("count-lookup rate limit is 10/hour in-memory", routerJs.includes("countLookupHits") && routerJs.includes("hits.length >= 10"));
check("CORS helper allows magpielocal.com and is used only by this route", (routerJs.match(/countLookupCors\(event\)/g) || []).length >= 2 && routerJs.includes('"Access-Control-Allow-Origin": allow'));
check("quick-claim register validates count + local % with the full form's wording", routerJs.includes('if (!stack[claimPlatform]) return err(400, "Your follower count is required")') && routerJs.includes("Your self-reported local audience percentage is required. It is always labeled Self-reported on your profile."));
check("quick-claim builder writes the facts (no more hardcoded zeros)", routerJs.includes("followerCount: quickFacts.followerCount") && routerJs.includes("totalAudience: quickFacts.totalAudience") && routerJs.includes('localAudienceSource: "Self-reported"') && !routerJs.includes("followerCount: 0,\n      audienceStack: {},"));

console.log("== unit: count-lookup normalization + parsers ==");
check("handle: bare", countLookup.normalizeHandle("some.user") === "some.user");
check("handle: @ stripped", countLookup.normalizeHandle("@Some.User") === "Some.User");
check("handle: TikTok URL", countLookup.normalizeHandle("https://www.tiktok.com/@some.user/") === "some.user");
check("handle: X URL", countLookup.normalizeHandle("https://x.com/someuser") === "someuser");
check("handle: junk rejected", countLookup.normalizeHandle("not a handle!") === null);
check("platform: aliases", countLookup.normalizePlatform("Twitter") === "x" && countLookup.normalizePlatform("tiktok") === "tiktok" && countLookup.normalizePlatform("myspace") === null);

const ttPage = (uid, count) => `<html><head></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.user-detail": { statusCode: 0, userInfo: { user: { uniqueId: uid }, statsV2: { followerCount: String(count) } } } } })}</script></body></html>`;
const parsed = countLookup.parseTikTokProfile(ttPage("fixtureuser", 12345), "fixtureuser");
check("TikTok parser: verified uniqueId yields the exact count", parsed.count === 12345, JSON.stringify(parsed));
const mismatch = countLookup.parseTikTokProfile(ttPage("someoneelse", 999), "fixtureuser");
check("TikTok parser: uniqueId mismatch is never trusted", mismatch.count === undefined && mismatch.reason === "not_found", JSON.stringify(mismatch));
check("TikTok parser: no rehydration JSON reads blocked, not a count", countLookup.parseTikTokProfile("<html><body>challenge</body></html>", "fixtureuser").reason === "blocked");

console.log("== unit: count-lookup platform behavior (stubbed fetch) ==");
const noFetch = async () => { throw new Error("fetch must not be called"); };
for (const p of ["instagram", "facebook", "x", "linkedin", "snapchat"]) {
  const r = await countLookup.lookupCount(p, "anyhandle", { fetchImpl: noFetch, skipCache: true });
  check(`${p} returns manual immediately (no fetch attempted)`, r.count === null && r.reason === "manual", JSON.stringify(r));
}
const ytNoKey = await countLookup.lookupCount("youtube", "somechannel", { fetchImpl: noFetch, skipCache: true, apiKey: "" });
check("YouTube without an API key returns manual (no scraping)", ytNoKey.count === null && ytNoKey.reason === "manual", JSON.stringify(ytNoKey));
const ytStub = async (url) => {
  check("YouTube lookup uses channels.list forHandle", /channels\?part=statistics&forHandle=%40somechannel/.test(url), url);
  return { status: 200, json: async () => ({ items: [{ statistics: { subscriberCount: "777000", hiddenSubscriberCount: false } }] }) };
};
const ytFound = await countLookup.lookupCount("youtube", "somechannel", { fetchImpl: ytStub, skipCache: true, apiKey: "stub-key" });
check("YouTube with a key returns the exact subscriber count", ytFound.count === 777000 && ytFound.reason === "found", JSON.stringify(ytFound));
const ytHidden = await countLookup.lookupCount("youtube", "hiddenchannel", { fetchImpl: async () => ({ status: 200, json: async () => ({ items: [{ statistics: { hiddenSubscriberCount: true } }] }) }), skipCache: true, apiKey: "stub-key" });
check("YouTube hidden subscriber count reads not_found", ytHidden.count === null && ytHidden.reason === "not_found", JSON.stringify(ytHidden));
const ttStub = async () => ({ status: 200, text: async () => ttPage("stubuser", 4242) });
const ttFound = await countLookup.lookupCount("tiktok", "stubuser", { fetchImpl: ttStub, skipCache: true });
check("TikTok stubbed page returns the count", ttFound.count === 4242 && ttFound.reason === "found", JSON.stringify(ttFound));

// ---------- live fixture server ----------
console.log("== live: register facts + lookup endpoint ==");
const PORT = 8935;
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `signl-verify-build215-${Date.now()}.json`);
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-215";
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: ROOT,
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
async function call(method, p, body, headers = {}) {
  const h = { ...headers };
  if (body) h["Content-Type"] = "application/json";
  const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { status: res.status, headers: res.headers, data };
}

try {
  const up = await waitForServer();
  check("dev server boots", up);
  if (!up) throw new Error("server did not start");

  // (a) register WITH facts, primary platform TikTok, listed
  // city + categories included: read the STORED record back
  // from the local store file. No PATCH is ever sent.
  const reg = await call("POST", "/api/auth/register", {
    role: "creator", quickClaim: true,
    email: "firstwrite@fixtures.dev", password: "claim-pass-1234",
    market: "Hampton Roads", city: "Norfolk",
    handle: "firstwrite757", primaryPlatform: "tiktok",
    audienceStack: { tiktok: 2500, instagram: 500 },
    followerCount: 2500, localAudiencePct: 40,
    categories: ["Food & Drink"],
    ...AGREE,
  });
  check("register with facts returns 201", reg.status === 201, JSON.stringify(reg.data));
  const uid = reg.data.user && reg.data.user.id;
  const dbRaw = JSON.parse(fs.readFileSync(DB, "utf8"));
  const stored = dbRaw[`user:${uid}`];
  check("stored record exists in the store", !!stored);
  const sc = (stored && stored.creator) || {};
  check("(a) stored record carries the stack on first write", sc.audienceStack && sc.audienceStack.tiktok === 2500 && sc.audienceStack.instagram === 500, JSON.stringify(sc.audienceStack));
  check("(a) stored totalAudience = stacked total (3000), followerCount = Instagram count (500)", sc.totalAudience === 3000 && sc.followerCount === 500, JSON.stringify({ total: sc.totalAudience, fc: sc.followerCount }));
  check("(a) stored local % = 40, Self-reported, with a date stamp", sc.localAudiencePct === 40 && sc.localAudienceSource === "Self-reported" && /^\d{4}-\d{2}-\d{2}$/.test(sc.localAudienceAsOf || ""), JSON.stringify({ pct: sc.localAudiencePct, src: sc.localAudienceSource, asOf: sc.localAudienceAsOf }));
  check("(a) stored city + categories landed; tier reads the stacked total", stored.city === "Norfolk" && JSON.stringify(sc.categories) === JSON.stringify(["Food & Drink"]) && sc.tierBand === "Locals", JSON.stringify({ city: stored.city, cats: sc.categories, tier: sc.tierBand }));
  check("(a) a claim carrying every gate field is profileComplete on first write", sc.profileComplete === true, JSON.stringify(sc.profileComplete));

  // (b) the two refusals
  const missCount = await call("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "mc@fixtures.dev", password: "claim-pass-1234", market: "Hampton Roads", handle: "misscount", localAudiencePct: 40, ...AGREE });
  check("(b) register missing the primary count -> 400 Your follower count is required", missCount.status === 400 && missCount.data.error === "Your follower count is required", JSON.stringify(missCount.data));
  const missLocal = await call("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "ml@fixtures.dev", password: "claim-pass-1234", market: "Hampton Roads", handle: "misslocal", audienceStack: { instagram: 900 }, ...AGREE });
  check("(b) register missing the local % -> 400 with the full form's wording", missLocal.status === 400 && /self-reported local audience percentage is required/.test(missLocal.data.error || ""), JSON.stringify(missLocal.data));

  // (c) the lookup endpoint
  const ig = await call("POST", "/api/count-lookup", { platform: "instagram", handle: "anyhandle" });
  check("(c) instagram -> 200 manual", ig.status === 200 && ig.data.count === null && ig.data.reason === "manual" && ig.data.platform === "instagram", JSON.stringify(ig.data));
  const ttLive = await call("POST", "/api/count-lookup", { platform: "tiktok", handle: "tiktok" });
  note(`live TikTok lookup for @tiktok returned: ${JSON.stringify(ttLive.data)}`);
  check("(c) TikTok lookup for a known handle returns a real count (network permitting)", ttLive.status === 200 && (ttLive.data.reason === "found" ? (typeof ttLive.data.count === "number" && ttLive.data.count > 1000000) : ["blocked", "error"].includes(ttLive.data.reason)), JSON.stringify(ttLive.data));
  const ttBogus = await call("POST", "/api/count-lookup", { platform: "tiktok", handle: "zzzqqqnosuchuser987654" });
  note(`live TikTok lookup for a bogus handle returned: ${JSON.stringify(ttBogus.data)}`);
  check("(c) bogus TikTok handle -> not_found (or a soft network reason)", ttBogus.status === 200 && (ttBogus.data.reason === "not_found" || ["blocked", "error"].includes(ttBogus.data.reason)) && ttBogus.data.count === null, JSON.stringify(ttBogus.data));
  const ttAgain = await call("POST", "/api/count-lookup", { platform: "tiktok", handle: "tiktok" });
  check("(c) second identical lookup is served from the store cache", ttAgain.status === 200 && ttAgain.data.cached === true && ttAgain.data.count === ttLive.data.count && ttAgain.data.reason === ttLive.data.reason, JSON.stringify(ttAgain.data));
  const dbAfter = JSON.parse(fs.readFileSync(DB, "utf8"));
  check("(c) the cache record lives in the store under lookup:tiktok:tiktok with a cachedAt stamp", !!dbAfter["lookup:tiktok:tiktok"] && typeof dbAfter["lookup:tiktok:tiktok"].cachedAt === "number", JSON.stringify(dbAfter["lookup:tiktok:tiktok"]));

  // CORS: preflight + response header, this route only
  const pre = await call("OPTIONS", "/api/count-lookup", null, { Origin: "https://magpielocal.com", "Access-Control-Request-Method": "POST" });
  check("CORS preflight answers 204 with the magpielocal.com origin", pre.status === 204 && pre.headers.get("access-control-allow-origin") === "https://magpielocal.com", `${pre.status} ${pre.headers.get("access-control-allow-origin")}`);
  check("CORS header rides the POST response", ig.headers.get("access-control-allow-origin") === "https://magpielocal.com", ig.headers.get("access-control-allow-origin"));
  const boot = await call("GET", "/api/bootstrap");
  check("no CORS header leaks onto other routes", boot.headers.get("access-control-allow-origin") === null, String(boot.headers.get("access-control-allow-origin")));
} finally {
  server.kill("SIGTERM");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nBuild -215 verification: ${pass} passed, ${fail} failed`);
if (failures.length) console.log("Failures: " + failures.join(" | "));
process.exit(fail ? 1 : 0);
