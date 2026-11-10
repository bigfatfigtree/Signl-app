// verify-build174.mjs — Build -174: emergency hotfix for the
// Build -173 outage (2026-11-09, ~22:26 ET). RESTORATION ONLY.
//   THE BUG: maybeFixMarkets173 sat in route()'s awaited
//     preamble fan-out and read the whole event log with a
//     SERIAL `await store.get(k)` per key. Locally those gets
//     are memory reads, so every fixture passed; on Netlify
//     Blobs each get is an HTTPS round trip, thousands of
//     events meant every /api/* request blew the function
//     timeout (bootstrap / auth-me / verify-counts all 504),
//     and because the loader's done flag is written only at
//     the END of the scan, every fresh instance restarted it —
//     a permanent outage. Same class as INCIDENT-2026-10-25.
//   THE FIX (scope-cut by Jeff, "get backup fast"): the pass
//     is simply NOT INVOKED anymore — its fan-out entry is
//     gone and nothing on the request path calls it. The
//     function, its list, its diag (config:diag173) and its
//     claimed flag (config:marketFix173) stay in the file for
//     the follow-up build, which will run the re-file OFF the
//     request path (getMany slices + persisted progress — the
//     design was built and fixture-proven during this hotfix,
//     then deferred, not discarded). Until that build, the
//     pass's behavior checks in verify-build173 section D are
//     expected to fail: the pass does not run. Sections A–C of
//     that suite (the claim parser fix -173 actually shipped
//     for) stay green and keep guarding the client fix.
//   THIS SUITE guards the restoration and the class:
//     A: static pins — the loader is absent from route()'s
//        awaited fan-out, nothing anywhere awaits it, and no
//        serial per-key store.get loop over a store prefix
//        exists anywhere in router.js OUTSIDE the staged,
//        uninvoked loader body (the one place the follow-up
//        build must replace before it may run again).
//     B: functional — with an artificial 3ms latency injected
//        into every store.get of an event: key (the shape of
//        Blobs per-get cost), a store carrying 6,000 events
//        must answer /api/bootstrap fast, and the pass must
//        have left NO trace: no claimed flag, no diag, the
//        mis-filed record exactly where it was. On the -173
//        code the awaited serial scan alone costs ~18s of
//        request time and moves the record — both fail here.
// Run: node scripts/verify-build174.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build174-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com"; // Jeff's real login (confirmed 2026-11-09)
process.env.ADMIN_PASSWORD = "<MASKED_SECRET_004>";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_VERIFY_TOKEN = "fixture-verify-token-174";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const root = path.join(process.cwd());
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");

// --- A: static pins -------------------------------------------
console.log("== A: the pass can never block or run on the request path again ==");
{
  const routeStart = routerJs.indexOf("async function route(event)");
  const fanoutStart = routerJs.indexOf("await Promise.all([", routeStart);
  const fanoutEnd = routerJs.indexOf("\n  ]);", fanoutStart);
  check("route() fan-out located", routeStart > 0 && fanoutStart > routeStart && fanoutEnd > fanoutStart, "");
  const fanout = routerJs.slice(fanoutStart, fanoutEnd);
  check("the market re-file loader is NOT invoked in route()'s awaited fan-out",
    !fanout.includes("maybeFixMarkets173()"), "");
  check("the neighboring loaders' fan-out semantics are untouched (ensureAdmin + the -172 fix still awaited)",
    fanout.includes("auth.ensureAdmin") && fanout.includes("maybeFixMin172"), "");
  check("nothing anywhere awaits the pass (no awaited invocation in the file)",
    !routerJs.includes("await maybeFixMarkets173"), "");
  check("the pass + its list + diag + claimed flag remain staged for the follow-up build",
    routerJs.includes("async function maybeFixMarkets173") && routerJs.includes('"config:marketFix173"')
    && routerJs.includes('"config:diag173"') && routerJs.includes('"maketodayahollyday": "Raleigh"'), "");
  // The general class: a for..of loop whose body reaches for a
  // per-key store.get of the loop variable. Scan every loop
  // header in router.js EXCLUDING the staged loader body (the
  // one uninvoked span the follow-up build replaces before
  // the pass may run again) and inspect the 500 chars after
  // each header.
  const fnStart = routerJs.indexOf("async function maybeFixMarkets173");
  const fnEnd = routerJs.indexOf("// ---------- admin broadcasts", fnStart);
  const scanned = routerJs.slice(0, fnStart) + routerJs.slice(fnEnd > fnStart ? fnEnd : fnStart);
  const serialLoops = [];
  const loopRe = /for\s*\(\s*(?:const|let|var)\s+(\w+)\s+of\s+[^)\n]*\)\s*\{/g;
  let m;
  while ((m = loopRe.exec(scanned)) !== null) {
    const body = scanned.slice(m.index, m.index + 500);
    if (body.includes(`await store.get(${m[1]})`)) {
      serialLoops.push(scanned.slice(0, m.index).split("\n").length);
    }
  }
  check("no serial per-key store.get loop anywhere in router.js outside the staged loader body",
    serialLoops.length === 0, `found at lines ${serialLoops.join(", ")}`);
}

// --- B: functional — fast answers, zero loader side effects ---
console.log("== B: 6,000 events + injected per-get latency: bootstrap answers, the pass leaves no trace ==");
{
  // Seed the store file directly (one write, not 6,000 sets).
  const seedCreator = (id, handle, market, extra = {}) => ({
    id, role: "creator", email: `${id}@fixtures.dev`, name: handle, passwordSalt: "seed", passwordHash: "seed",
    status: "pending", tester: false, market, city: "Virginia Beach", state: null, country: "United States",
    createdAt: "2026-11-08T20:00:00.000Z", updatedAt: "2026-11-08T20:00:00.000Z",
    reviewedAt: null, reviewedBy: null,
    termsVersion: "2026-10-19", termsAcceptedAt: "2026-11-08T20:00:00.000Z", marketingEmailConsent: false, marketingConsentAt: null,
    signupPath: "quick_claim", signupSource: "email", referredBy: null,
    ...extra,
    creator: {
      handle, primaryPlatform: "instagram", instagramUrl: `https://www.instagram.com/${handle}/`,
      followerCount: 1200, audienceStack: { instagram: 1200 }, totalAudience: 1200, avgViews: 0,
      categories: ["Food & Drink"], compCategories: [], openToPaidCampaigns: false, compOpen: true, paidRate: 200,
      bio: "Build -174 guard fixture creator.", bestWork: [], maxVisitsPerWeek: 3, neighborhood: "",
      localAudiencePct: 55, localAudienceSource: "Self-reported",
      profileComplete: false, profileCompletedAt: null, publicPage: true,
    },
    business: null,
  });
  const db = {};
  db["user:fix174-a"] = seedCreator("fix174-a", "maketodayahollyday", "Virginia Beach");
  db["user:fix174-g"] = seedCreator("fix174-g", "lixas_family", "Virginia Beach");
  db["event:2026-11-09:seed174g"] = {
    id: "seed174g", ts: "2026-11-09T14:00:00.000Z", type: "market_changed",
    actorId: "fix174-g", actorRole: "creator", subjectId: "fix174-g", market: "Virginia Beach",
    data: { from: "Raleigh", to: "Virginia Beach", via: "profile" },
  };
  for (let i = 0; i < 6000; i += 1) {
    db[`event:2026-11-09:noise${String(i).padStart(5, "0")}`] = { type: "page_view" };
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db));

  const require = createRequire(import.meta.url);
  const store = require("../netlify/functions/lib/store.js");
  const { handler } = require("../netlify/functions/api.js");

  // Inject Blobs-shaped latency into every event: read. The
  // -173 serial scan would pay it 6,000 times INSIDE the
  // request (~18s); the restored code never reads the event
  // log on this path at all.
  const origGet = store.get.bind(store);
  store.get = async (key) => {
    if (String(key).startsWith("event:")) await new Promise((r) => setTimeout(r, 3));
    return origGet(key);
  };

  const call = async (method, p) => {
    const url = new URL(p, "http://localhost");
    const t0 = Date.now();
    const res = await handler({
      httpMethod: method, path: url.pathname, headers: {},
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: null, isBase64Encoded: false,
    });
    return { status: res.statusCode, ms: Date.now() - t0 };
  };

  const boot = await call("GET", "/api/bootstrap");
  check("GET /api/bootstrap → 200", boot.status === 200, `got ${boot.status}`);
  check("bootstrap answered WITHOUT the event scan (< 8000ms; the -173 shape costs ~18000ms here)",
    boot.ms < 8000, `${boot.ms}ms`);

  // A second request + a beat of wall-clock: even a floating
  // (unawaited) invocation would have landed its flag by now.
  await call("GET", "/api/bootstrap");
  await new Promise((r) => setTimeout(r, 300));
  const flag = await store.get("config:marketFix173");
  const diag = await store.get("config:diag173");
  const a = await store.get("user:fix174-a");
  const g = await store.get("user:fix174-g");
  check("the pass did NOT run: no claimed flag, no diag written", !flag && !diag, "");
  // (updatedAt is not probed: a sibling one-time pass — the
  // profile backfill — may legitimately bump it on a first
  // request; the fixture172/-173 suites carry the same note.
  // Market + absent flag/diag is the loader's own footprint.)
  check("the mis-filed record still sits in Virginia Beach (the re-file is deferred, not half-done)",
    !!a && a.market === "Virginia Beach", a && a.market);
  check("the deliberate-move record is likewise untouched",
    !!g && g.market === "Virginia Beach", g && g.market);

  const me = await call("GET", "/api/auth/me");
  check("steady state: GET /api/auth/me → fast 401, no hang (< 2000ms)",
    me.status === 401 && me.ms < 2000, `status=${me.status} ${me.ms}ms`);

  store.get = origGet;
}

console.log(`\nBUILD-174 SUITE: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
