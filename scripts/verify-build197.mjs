// End-to-end verification of Build -197: sign-ups by source in
// Admin Stats (Step 1) + first-touch UTM / referrer capture at
// registration (Step 2).
//
// Step 2: the four registration payloads send utmSource,
// utmMedium, utmCampaign and referrerHost; the server sanitizes
// them like the signup source and stores them on the record.
// Step 1: GET /admin/stats/data?section=sources aggregates
// allUsers() into 30-day / 90-day / all-time windows, channel =
// UTM source, else ?src= signup source, else "Direct /
// untagged", split creator vs business, testers excluded, plus
// a by-referrer-host breakdown.
//
// The suite seeds a temp local DB with pre-197-shaped records
// (no UTM fields at all, one with no createdAt, one tester, one
// admin) to prove old records aggregate as untagged and never
// crash the pass, then registers fresh accounts through the API
// against the same DB. Nothing touches production data.
// Run: node scripts/verify-build197.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8949;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "<MASKED_SECRET_003>";
const DB = path.join(os.tmpdir(), `signl-verify-build197-${Date.now()}.json`);

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
    return { status: res.status, headers: res.headers, data };
  };
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

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const DAY = 86400000;
const isoDaysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

// ---------- seed pre-197 records straight into the local DB ----------
function seedUser(id, over) {
  return {
    id, role: "creator", email: `${id}@fixtures.dev`, name: id,
    passwordSalt: "seed", passwordHash: "seed", status: "approved", tester: false,
    market: "Nashville", city: "Nashville", country: "United States",
    createdAt: isoDaysAgo(1), updatedAt: isoDaysAgo(1),
    termsVersion: 1, termsAcceptedAt: isoDaysAgo(1),
    creator: null, business: null, ...over,
  };
}
const seed = {};
seed["user:seed-watch-old"] = seedUser("seed-watch-old", { signupSource: "watchlist", createdAt: isoDaysAgo(100), updatedAt: isoDaysAgo(100) });
seed["user:seed-linkedin"] = seedUser("seed-linkedin", { signupSource: "linkedin", createdAt: isoDaysAgo(45), updatedAt: isoDaysAgo(45) });
seed["user:seed-plain-biz"] = seedUser("seed-plain-biz", { role: "business", createdAt: isoDaysAgo(10), updatedAt: isoDaysAgo(10), business: { businessName: "Seed Biz", accessState: "founding" } });
const nodate = seedUser("seed-nodate", { signupSource: "moms" });
delete nodate.createdAt;
seed["user:seed-nodate"] = nodate;
seed["user:seed-tester"] = seedUser("seed-tester", { signupSource: "watchlist", tester: true, status: "approved" });
seed["user:seed-admin"] = seedUser("seed-admin", { role: "admin", signupSource: "watchlist" });
fs.writeFileSync(DB, JSON.stringify(seed));

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

const rowOf = (win, source) => ((win && win.rows) || []).find((r) => r.source === source);
const refOf = (win, host) => ((win && win.referrerRows) || []).find((r) => r.host === host);

try {
  check("dev server comes up on the seeded DB", await waitForServer());

  // ---------- Step 2: a UTM-tagged claim stores everything ----------
  const claimer = client();
  const claim = await claimer("POST", "/api/auth/register", {
    role: "creator", quickClaim: true,
    email: "attrmeta@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", handle: "attrmeta",
    signupSource: "watchlist",
    utmSource: "Meta Ads!!", utmMedium: "CPC", utmCampaign: "Launch 2026",
    referrerHost: "https://ChatGPT.com/some/path",
    ...AGREE,
  });
  check("UTM claim returns 201", claim.status === 201, JSON.stringify(claim.data).slice(0, 200));
  const cu = claim.data.user || {};
  check("utmSource sanitized to a slug", cu.utmSource === "metaads", JSON.stringify(cu.utmSource));
  check("utmMedium sanitized to a slug", cu.utmMedium === "cpc", JSON.stringify(cu.utmMedium));
  check("utmCampaign sanitized, spaces stripped", cu.utmCampaign === "launch2026", JSON.stringify(cu.utmCampaign));
  check("referrerHost reduced to the bare host", cu.referrerHost === "chatgpt.com", JSON.stringify(cu.referrerHost));
  check("signupSource still stored alongside", cu.signupSource === "watchlist", JSON.stringify(cu.signupSource));

  // ---------- Step 2: a business join stores its channel ----------
  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Attr Owner", businessName: "Attr Bakery", email: "attrbiz@fixtures.dev",
    password: "<MASKED_SECRET_002>", market: "Richmond", city: "Richmond", category: "Bakery", planId: "growth",
    neighborhood: "Carytown", about: "Bread.", agreedTerms: true,
    utmSource: "google", referrerHost: "google.com",
  });
  check("business join returns 201", bizReg.status === 201, JSON.stringify(bizReg.data).slice(0, 200));
  check("business record stores utmSource", !!bizReg.data.user && bizReg.data.user.utmSource === "google", JSON.stringify(bizReg.data.user && bizReg.data.user.utmSource));
  check("business record stores referrerHost", !!bizReg.data.user && bizReg.data.user.referrerHost === "google.com", JSON.stringify(bizReg.data.user && bizReg.data.user.referrerHost));

  // ---------- Step 2: junk UTM falls back to the signup source ----------
  const junk = client();
  const junkReg = await junk("POST", "/api/auth/register", {
    role: "creator", quickClaim: true,
    email: "attrjunk@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Raleigh", handle: "attrjunk",
    signupSource: "learn", utmSource: "!! $$ %%",
    ...AGREE,
  });
  check("junk utmSource stores nothing", junkReg.status === 201 && !!junkReg.data.user && junkReg.data.user.utmSource === undefined, JSON.stringify(junkReg.data.user && junkReg.data.user.utmSource));

  // ---------- Step 2: campaign cap + a dotless referrer host ----------
  const cap = client();
  const capReg = await cap("POST", "/api/auth/register", {
    role: "creator", quickClaim: true,
    email: "attrcap@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Raleigh", handle: "attrcap",
    utmSource: "tiktok", utmCampaign: "x".repeat(80), referrerHost: "localhost",
    ...AGREE,
  });
  check("overlong utmCampaign capped at 60 chars", capReg.status === 201 && !!capReg.data.user && capReg.data.user.utmCampaign === "x".repeat(60), JSON.stringify(capReg.data.user && (capReg.data.user.utmCampaign || "").length));
  check("dotless referrer host stores nothing", !!capReg.data.user && capReg.data.user.referrerHost === undefined, JSON.stringify(capReg.data.user && capReg.data.user.referrerHost));

  // ---------- Step 2: no attribution at all ----------
  const plain = client();
  const plainReg = await plain("POST", "/api/auth/register", {
    role: "creator", quickClaim: true,
    email: "attrplain@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", handle: "attrplain",
    ...AGREE,
  });
  check("no attribution: record carries none of the new fields", plainReg.status === 201 && !!plainReg.data.user
    && plainReg.data.user.utmSource === undefined && plainReg.data.user.utmMedium === undefined
    && plainReg.data.user.utmCampaign === undefined && plainReg.data.user.referrerHost === undefined,
    JSON.stringify(plainReg.data.user && Object.keys(plainReg.data.user)));

  // ---------- Step 1: the sources section ----------
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login 200", adminLogin.status === 200, String(adminLogin.status));
  const sec = await admin("GET", "/api/admin/stats/data?section=sources&days=30");
  check("sources section returns 200", sec.status === 200, String(sec.status));
  const W = (sec.data && sec.data.windows) || {};
  check("payload carries all three windows", !!W.d30 && !!W.d90 && !!W.all, JSON.stringify(Object.keys(W)));

  const all = W.all || { rows: [], referrerRows: [], totals: {} };
  check("all-time: UTM source wins over the signup source (metaads = 1 creator)", (rowOf(all, "metaads") || {}).creators === 1, JSON.stringify(rowOf(all, "metaads")));
  check("all-time: the UTM claim did not also count under watchlist", (rowOf(all, "watchlist") || {}).total === 1, JSON.stringify(rowOf(all, "watchlist")));
  check("all-time: legacy linkedin record counted", (rowOf(all, "linkedin") || {}).creators === 1, JSON.stringify(rowOf(all, "linkedin")));
  check("all-time: junk UTM fell back to signup source (learn = 1)", (rowOf(all, "learn") || {}).creators === 1, JSON.stringify(rowOf(all, "learn")));
  check("all-time: record with no createdAt counts (moms = 1)", (rowOf(all, "moms") || {}).creators === 1, JSON.stringify(rowOf(all, "moms")));
  check("all-time: business channel split (google = 1 business)", (rowOf(all, "google") || {}).businesses === 1, JSON.stringify(rowOf(all, "google")));
  check("all-time: Direct / untagged holds the plain claim + the untagged business", (rowOf(all, "Direct / untagged") || {}).creators === 1 && (rowOf(all, "Direct / untagged") || {}).businesses === 1, JSON.stringify(rowOf(all, "Direct / untagged")));
  check("all-time: Direct / untagged sorts last", all.rows.length > 0 && all.rows[all.rows.length - 1].source === "Direct / untagged", JSON.stringify(all.rows.map((r) => r.source)));
  check("all-time totals: 7 creators, 2 businesses, 9 total", all.totals.creators === 7 && all.totals.businesses === 2 && all.totals.total === 9, JSON.stringify(all.totals));
  check("all-time: row sums equal the totals", all.rows.reduce((s, r) => s + r.total, 0) === all.totals.total && all.rows.reduce((s, r) => s + r.creators, 0) === all.totals.creators, JSON.stringify(all.rows));
  check("all-time: referrer rows carry chatgpt.com (1) and google.com (1 business)", (refOf(all, "chatgpt.com") || {}).total === 1 && (refOf(all, "google.com") || {}).businesses === 1, JSON.stringify(all.referrerRows));
  check("all-time: the dotless host never became a referrer row", !refOf(all, "localhost"), JSON.stringify(all.referrerRows));

  const d90 = W.d90 || { rows: [], totals: {} };
  check("90-day: the 100-day-old record drops out (no watchlist row)", !rowOf(d90, "watchlist"), JSON.stringify(d90.rows.map((r) => r.source)));
  check("90-day: the 45-day-old linkedin record stays", (rowOf(d90, "linkedin") || {}).creators === 1, JSON.stringify(rowOf(d90, "linkedin")));
  check("90-day: the no-createdAt record drops out (no moms row)", !rowOf(d90, "moms"), JSON.stringify(d90.rows.map((r) => r.source)));
  check("90-day totals: 5 creators, 2 businesses", d90.totals.creators === 5 && d90.totals.businesses === 2, JSON.stringify(d90.totals));

  const d30 = W.d30 || { rows: [], totals: {} };
  check("30-day: the 45-day-old linkedin record drops out", !rowOf(d30, "linkedin"), JSON.stringify(d30.rows.map((r) => r.source)));
  check("30-day: today's channels all present", (rowOf(d30, "metaads") || {}).creators === 1 && (rowOf(d30, "google") || {}).businesses === 1 && (rowOf(d30, "tiktok") || {}).creators === 1, JSON.stringify(d30.rows));
  check("30-day totals: 4 creators, 2 businesses", d30.totals.creators === 4 && d30.totals.businesses === 2, JSON.stringify(d30.totals));

  // ---------- Step 1: gates hold ----------
  const asCreator = await claimer("GET", "/api/admin/stats/data?section=sources&days=30");
  check("a signed-in creator cannot read the sources section", asCreator.status !== 200 && !(asCreator.data && asCreator.data.windows), String(asCreator.status));
  const anon = client();
  const asAnon = await anon("GET", "/api/admin/stats/data?section=sources&days=30");
  check("an anonymous visitor cannot read the sources section", asAnon.status !== 200 && !(asAnon.data && asAnon.data.windows), String(asAnon.status));
  const bogus = await admin("GET", "/api/admin/stats/data?section=bogus&days=30");
  check("an unknown section still answers a plain 400", bogus.status === 400, String(bogus.status));
  const overview = await admin("GET", "/api/admin/stats/data?section=overview&days=30");
  check("the existing overview section still loads", overview.status === 200 && !!overview.data.totals, String(overview.status));

  // ---------- static wiring ----------
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify", "functions", "lib", "router.js"), "utf8");
  check("client reads utm_source / utm_medium / utm_campaign on landing", appJs.includes('params.get("utm_source")') && appJs.includes('params.get("utm_medium")') && appJs.includes('params.get("utm_campaign")'));
  check("client reads document.referrer for the first-touch host", appJs.includes("document.referrer") && appJs.includes("new URL(document.referrer).hostname"));
  check("first touch is guarded: an existing signl_attr is never overwritten", appJs.includes('if (!localStorage.getItem("signl_attr"))') && appJs.includes('localStorage.setItem("signl_attr"'));
  check("all four signup payloads send utmSource", (appJs.match(/utmSource: storedAttribution\(\)\.utmSource \|\| undefined/g) || []).length === 4);
  check("all four signup payloads send referrerHost", (appJs.match(/referrerHost: storedAttribution\(\)\.referrerHost \|\| undefined/g) || []).length === 4);
  check("all four signup payloads still send signupSource", (appJs.match(/signupSource: storedSrc\(\) \|\| undefined/g) || []).length === 4);
  check("the Website view hosts the sources table", appJs.includes('id="signup-sources197"') && appJs.includes("loadSignupSources197") && appJs.includes("section=sources"));
  const srcBlock = appJs.slice(appJs.indexOf("// Sign-ups by source (Build -197)"), appJs.indexOf("function renderAdminSig"));
  check("the sources table copy carries no em dashes", srcBlock.length > 0 && !srcBlock.includes("—"));
  check("server registers the sources section", routerJs.includes('"sources"') && routerJs.includes("buildSignupSourceWindows"));
  check("server stores the four fields on the record", routerJs.includes("user.utmSource = utmSource") && routerJs.includes("user.referrerHost = referrerHost"));
} finally {
  server.kill("SIGKILL");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nverify-build197: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
