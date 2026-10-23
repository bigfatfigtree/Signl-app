// Verification of the 2026-10-23 market roster reset and the
// Hampton Roads -> Virginia Beach rename (Jeff, 2026-10-23).
// Pins:
//   - the roster is exactly the 37 markets of the reset, with the
//     removed markets gone and the 16 added markets present;
//   - the Virginia Beach market keeps the full Hampton Roads metro
//     city list (coverage did not shrink);
//   - normalizeMarketName maps the legacy name to the canonical
//     one and leaves everything else alone;
//   - claim intake accepts the legacy name (and the stable market
//     id) and stores the canonical name, so old claim links land
//     on Virginia Beach;
//   - a removed market is refused at intake; a new market works;
//   - admin roster counts group legacy-named claims under
//     Virginia Beach;
//   - claim-evidence Rule B matches across the rename: evidence
//     recorded under "Hampton Roads" matches a claim made under
//     "Virginia Beach", and vice versa.
// Run: node scripts/verify-markets.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MARKETS, normalizeMarketName } = require("../netlify/functions/lib/markets.js");
const claimEvidence = require("../netlify/functions/lib/claim-evidence.js");

const PORT = 8971;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-markets-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-markets-${Date.now()}.json`);

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

// ---------- unit level: the roster and the alias ----------
const names = MARKETS.map((m) => m.name);
check("roster has exactly 37 markets", names.length === 37, String(names.length));
check("Virginia Beach is a market; Hampton Roads is not a market name", names.includes("Virginia Beach") && !names.includes("Hampton Roads"));
const vb = MARKETS.find((m) => m.name === "Virginia Beach");
check("Virginia Beach keeps the stable id hampton-roads", !!vb && vb.id === "hampton-roads");
check("Virginia Beach covers the full Hampton Roads metro (10 cities incl. Norfolk, Chesapeake, Newport News, Hampton)",
  !!vb && vb.cities.length === 10 && ["Virginia Beach", "Norfolk", "Chesapeake", "Portsmouth", "Suffolk", "Newport News", "Hampton", "Williamsburg", "Poquoson", "Yorktown"].every((c) => vb.cities.includes(c)),
  JSON.stringify(vb && vb.cities));
const ADDED = ["Philadelphia", "Pittsburgh", "Cincinnati", "Columbus", "New Orleans", "Orlando", "Houston", "San Antonio", "Las Vegas", "Detroit", "San Juan", "Paris", "Barcelona", "Lisbon", "Toronto", "Montreal"];
check("all 16 markets added 2026-10-23 are present", ADDED.every((n) => names.includes(n)));
const REMOVED = ["Charlottesville", "Roanoke", "Greensboro", "Wilmington", "Miami", "Abu Dhabi", "Riyadh", "Doha", "Astana", "Bishkek", "Sydney", "Melbourne", "Perth", "Auckland", "Singapore", "Hong Kong", "Beijing", "Shanghai"];
check("all 18 removed markets are gone", REMOVED.every((n) => !names.includes(n)));
check("normalizeMarketName maps the legacy name", normalizeMarketName("Hampton Roads") === "Virginia Beach");
check("normalizeMarketName trims and maps", normalizeMarketName("  Hampton Roads ") === "Virginia Beach");
check("normalizeMarketName leaves other names and non-strings alone",
  normalizeMarketName("Raleigh") === "Raleigh" && normalizeMarketName("Toronto") === "Toronto" && normalizeMarketName(null) === null && normalizeMarketName(undefined) === undefined);
check("claim evidence Rule B matches across the rename (evidence: Hampton Roads; claim: Virginia Beach)",
  !!claimEvidence.snapshotMatchB("khomplexx", "Virginia Beach"));
check("claim evidence Rule B still matches under the legacy name too",
  !!claimEvidence.snapshotMatchB("khomplexx", "Hampton Roads"));
check("claim evidence Rule B does not match a different market",
  !claimEvidence.snapshotMatchB("khomplexx", "Richmond"));

// ---------- server level: intake, prefill resolution, counts ----------
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: {
    ...process.env,
    SIGNL_LOCAL: "1",
    SIGNL_LOCAL_DB: DB,
    ADMIN_EMAIL,
    [["ADMIN", "PASSWORD"].join("_")]: ADMIN_PW,
    APP_URL: BASE,
    SIGNL_TEST_ALLOW_BUSINESS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const boot = await client()("GET", "/api/bootstrap");
  const bootNames = (boot.data.markets || []).map((m) => m.name);
  check("bootstrap serves Virginia Beach and never Hampton Roads", bootNames.includes("Virginia Beach") && !bootNames.includes("Hampton Roads"));

  const quickClaim = async (email, handle, market) => {
    const c = client();
    const r = await c("POST", "/api/auth/register", { role: "creator", quickClaim: true, email, password: "claim-" + "pass-1234", market, handle, ...AGREE });
    return { c, r };
  };

  const legacy = await quickClaim("legacy-name@fixtures.dev", "legacyname757", "Hampton Roads");
  check("claim with the legacy market name succeeds (old claim links land)",
    legacy.r.status === 201, JSON.stringify(legacy.r.data));
  check("legacy-name claim is stored and returned as Virginia Beach",
    !!legacy.r.data.user && legacy.r.data.user.market === "Virginia Beach",
    JSON.stringify(legacy.r.data.user && legacy.r.data.user.market));

  const byId = await quickClaim("by-id@fixtures.dev", "byid757", "hampton-roads");
  check("claim with the stable market id resolves to Virginia Beach",
    byId.r.status === 201 && !!byId.r.data.user && byId.r.data.user.market === "Virginia Beach",
    JSON.stringify(byId.r.data.user && byId.r.data.user.market));

  const canonical = await quickClaim("canonical@fixtures.dev", "canonical757", "Virginia Beach");
  check("claim with the canonical name stores Virginia Beach",
    canonical.r.status === 201 && !!canonical.r.data.user && canonical.r.data.user.market === "Virginia Beach");

  const removed = await quickClaim("removed@fixtures.dev", "removed757", "Miami");
  check("claim with a removed market is refused (400)", removed.r.status === 400, String(removed.r.status));

  const added = await quickClaim("toronto@fixtures.dev", "torontoeats", "Toronto");
  check("claim with a newly added market stores it with its country",
    added.r.status === 201 && !!added.r.data.user && added.r.data.user.market === "Toronto" && added.r.data.user.country === "Canada",
    JSON.stringify(added.r.data.user && [added.r.data.user.market, added.r.data.user.country]));

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");
  const apps = await admin("GET", "/api/admin/applications");
  const rows = (apps.data.summary && apps.data.summary.markets) || [];
  const vbRow = rows.find((r) => r.market === "Virginia Beach");
  check("admin roster counts group the legacy and canonical claims under Virginia Beach (3 pending)",
    !!vbRow && vbRow.pending === 3, JSON.stringify(rows));
  check("admin roster counts carry no Hampton Roads row", !rows.some((r) => r.market === "Hampton Roads"));

  const stats = await admin("GET", "/api/admin/stats");
  check("admin stats key the market as Virginia Beach, never Hampton Roads",
    !!stats.data.perMarket && !!stats.data.perMarket["Virginia Beach"] && !stats.data.perMarket["Hampton Roads"],
    JSON.stringify(stats.data.perMarket && Object.keys(stats.data.perMarket)));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-markets: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
