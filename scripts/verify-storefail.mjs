// Store-failure resilience (INCIDENT-2026-10-25): when the data
// store itself throws — as Netlify Blobs did when its manual token
// expired, taking every /api/* route to 500 — the request path must
// degrade instead of dying:
//   - ensureAdmin is guarded like every other preamble job, so a
//     failed admin bootstrap no longer 500s the whole API
//   - the public bootstrap still returns 200 with its static config,
//     with market live flags degraded to the founding state
//   - a cookie-bearing request whose session read fails is treated
//     as signed out, not crashed
//   - admin routes fail safe at 401 (the anonymous answer), not 500
// This suite runs the REAL api handler in-process with every store
// method replaced by a throwing stub — the shape the HTTP suites
// (local file store) structurally cannot reproduce.
// Run: node scripts/verify-storefail.mjs
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = path.join(os.tmpdir(), `signl-verify-storefail-${Date.now()}.json`);
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify-admin-pass-123";
process.env.APP_URL = "http://localhost";

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
// Simulate the production failure: every store operation throws,
// exactly what the app saw when the Blobs token lapsed.
const boom = async () => { throw new Error("simulated store failure (verify-storefail)"); };
store.get = boom;
store.set = boom;
store.del = boom;
store.list = boom;

const { handler } = require("../netlify/functions/api.js");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function evt(method, p, headers = {}) {
  return { httpMethod: method, path: p, headers, queryStringParameters: {}, body: null, isBase64Encoded: false };
}

console.log("verify-storefail: API resilience while the data store is down");
console.log("(the guard errors logged below are the expected degradation path)");

const boot = await handler(evt("GET", "/api/bootstrap"));
check("bootstrap returns 200 while the store is down", boot.statusCode === 200, `got ${boot.statusCode}: ${boot.body}`);
let bootData = null;
try { bootData = JSON.parse(boot.body); } catch (e) { /* asserted below */ }
check(
  "bootstrap still serves its static config (markets, plans, standard visit)",
  !!(bootData && Array.isArray(bootData.markets) && Array.isArray(bootData.plans) && bootData.standardVisit),
);
check(
  "bootstrap degrades market live flags to an object instead of crashing",
  !!(bootData && bootData.launch && typeof bootData.launch.marketLive === "object" && bootData.launch.marketLive !== null),
);

const bootCookie = await handler(evt("GET", "/api/bootstrap", { cookie: "signl_session=deadbeefdeadbeef" }));
check(
  "bootstrap returns 200 for a cookie-bearing request while the store is down",
  bootCookie.statusCode === 200,
  `got ${bootCookie.statusCode}: ${bootCookie.body}`,
);

const admin = await handler(evt("GET", "/api/admin/campaign"));
check(
  "admin routes fail safe (401, not 500) while the store is down",
  admin.statusCode === 401,
  `got ${admin.statusCode}: ${admin.body}`,
);

console.log(`\nverify-storefail: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log("failures:", failures.join(" | "));
  process.exit(1);
}
