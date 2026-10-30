// Build 2026.10.30-59 verification: the market footprint fix.
// Jeff flagged a live approval email (2026-10-30): a Clarksville
// creator was filed "Not listed yet" and told Clarksville is not
// an open market, when Clarksville, TN is Nashville area. Root
// cause: the markets added after the founding seven carried a
// namesake-only city list, so the (sound) typed-city resolver had
// almost nothing to match. Jeff's ruling: at sign-up, people go
// in the correct market regardless of the city they typed - if
// the city sits in a market's area, they ARE that market.
// Pins:
//   - every market now carries a genuine metro city list (the
//     only short list is Dubai, a city-emirate whose metro is the
//     Dubai-Sharjah-Ajman corridor), and Nashville's list carries
//     every town Jeff named;
//   - the resolver outcomes on the real lists: Clarksville (bare
//     and with a TN hint) files unique to Nashville; Clarksville
//     with a VA hint does NOT (the Build -52 veto: an explicit
//     state/country contradicting the one surviving market means
//     a same-named town elsewhere, outcome none); Franklin, TN
//     files to Nashville; the genuine two-metro town names stay
//     ambiguous bare and resolve on their state/country hints;
//   - intake: quick claim, full signup, and business registration
//     on the not-listed path file Nashville-metro towns under
//     Nashville at sign-up, the veto keeps a Clarksville, VA
//     claim unlisted, and a bare Columbia claim stores its two
//     candidates instead of filing;
//   - the refile sweep (Jeff's amendment: "auto-file everyone"):
//     one admin action files EVERY unlisted record (creators and
//     businesses) whose typed city resolves to exactly one
//     market, stamps marketResolvedFrom "refile_sweep", logs one
//     market_filed event per record with via "refile_sweep", and
//     answers with the run summary (scanned, filed per market,
//     skipped ambiguous, skipped none). A second run files
//     nothing (idempotent). Non-admins are refused.
// Run: node scripts/verify-build52.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MARKETS, resolveTypedCity } = require("../netlify/functions/lib/markets.js");

const PORT = 8983;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-build52-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-build52-${Date.now()}.json`);

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

function bootServer() {
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
  return server;
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const PW = "claim-" + "pass-1234";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

// ---------- unit level: stamp, lists, resolver ----------
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
check("stamp: BUILD_ID is 2026.10.30-59 on server and shell", buildJs.includes('BUILD_ID = "2026.10.30-59"') && indexHtml.includes("2026.10.30-59"));

check("the roster is 38 markets (37 when -52 shipped; Miami restored in Build -59)", MARKETS.length === 38, String(MARKETS.length));
const short = MARKETS.filter((m) => m.cities.length < 10).map((m) => m.name);
check("every market carries a real metro list; the only short list is Dubai (city-emirate, 3)", short.length === 1 && short[0] === "Dubai", JSON.stringify(short));
const nash = MARKETS.find((m) => m.id === "nashville");
const JEFF_TOWNS = ["Clarksville", "Franklin", "Murfreesboro", "Hendersonville", "Smyrna", "Brentwood", "Gallatin", "Mt. Juliet", "Lebanon", "Spring Hill", "Columbia", "Dickson", "Goodlettsville"];
check("Nashville's list carries every town Jeff named", !!nash && JEFF_TOWNS.every((c) => nash.cities.includes(c)), JSON.stringify(nash && nash.cities));

const U = (raw, hints) => resolveTypedCity(raw, hints);
const isU = (r, market) => r.status === "unique" && r.market === market;
check("Clarksville with a TN hint resolves unique to Nashville", isU(U("Clarksville", { state: "TN" }), "Nashville"), JSON.stringify(U("Clarksville", { state: "TN" })));
check("bare Clarksville resolves unique to Nashville", isU(U("Clarksville"), "Nashville"), JSON.stringify(U("Clarksville")));
check("Clarksville, TN resolves unique to Nashville", isU(U("Clarksville, TN"), "Nashville"), JSON.stringify(U("Clarksville, TN")));
check("Clarksville with a VA hint does NOT resolve to Nashville (veto: none)", U("Clarksville", { state: "VA" }).status === "none", JSON.stringify(U("Clarksville", { state: "VA" })));
check("Clarksville, VA does NOT resolve to Nashville (veto: none)", U("Clarksville, VA").status === "none", JSON.stringify(U("Clarksville, VA")));
check("Franklin, TN resolves unique to Nashville", isU(U("Franklin", { state: "TN" }), "Nashville"), JSON.stringify(U("Franklin", { state: "TN" })));

// Genuine two-metro names: bare stays a tie with exactly these
// markets; a state/country hint picks the right one.
const TIES = [
  ["Columbia", ["Baltimore", "Nashville"]],
  ["Smyrna", ["Atlanta", "Nashville"]],
  ["Spring Hill", ["Nashville", "Tampa"]],
  ["Bellevue", ["Cincinnati", "Seattle"]],
  ["Covington", ["Cincinnati", "New Orleans"]],
  ["Aurora", ["Chicago", "Denver", "Toronto"]],
  ["Lakewood", ["Denver", "Los Angeles", "Seattle"]],
  ["Pasadena", ["Baltimore", "Houston", "Los Angeles"]],
  ["Glendale", ["Los Angeles", "Phoenix"]],
  ["San Marcos", ["Austin", "San Diego"]],
  ["Elgin", ["Austin", "Chicago"]],
  ["Taylor", ["Austin", "Detroit"]],
  ["Plymouth", ["Detroit", "Minneapolis"]],
  ["Roseville", ["Detroit", "Minneapolis"]],
  ["Marysville", ["Columbus", "Seattle"]],
  ["Westminster", ["Baltimore", "Denver"]],
  ["Chester", ["Philadelphia", "Richmond"]],
  ["West Chester", ["Cincinnati", "Philadelphia"]],
  ["Lebanon", ["Cincinnati", "Nashville"]],
  ["Springfield", ["Nashville", "Washington DC"]],
  ["London", ["Columbus", "London"]],
  ["Georgetown", ["Austin", "Toronto"]],
  ["Denton", ["Dallas", "Manchester"]],
  ["Kirkland", ["Montreal", "Seattle"]],
];
for (const [town, markets] of TIES) {
  const r = U(town);
  check(`bare ${town} stays a tie (${markets.join(" / ")})`,
    r.status === "ambiguous" && r.markets.length === markets.length && markets.every((m) => r.markets.includes(m)),
    JSON.stringify(r));
}
check("Columbia + TN hint picks Nashville", isU(U("Columbia", { state: "TN" }), "Nashville"));
check("Columbia + MD hint picks Baltimore", isU(U("Columbia", { state: "MD" }), "Baltimore"));
check("Smyrna, TN picks Nashville", isU(U("Smyrna, TN"), "Nashville"));
check("Bellevue, WA picks Seattle", isU(U("Bellevue, WA"), "Seattle"));
check("Bellevue, KY picks Cincinnati", isU(U("Bellevue, KY"), "Cincinnati"));
check("Aurora, CO picks Denver", isU(U("Aurora, CO"), "Denver"));
check("Lakewood, CA picks Los Angeles", isU(U("Lakewood, CA"), "Los Angeles"));
check("London + United Kingdom picks London", isU(U("London", { country: "United Kingdom" }), "London"));
check("London, OH picks Columbus", isU(U("London, OH"), "Columbus"));
check("Denton + United States picks Dallas", isU(U("Denton", { country: "United States" }), "Dallas"));
check("Covington, LA picks New Orleans", isU(U("Covington, LA"), "New Orleans"));
check("Pasadena, MD picks Baltimore (the founding list's own Pasadena)", isU(U("Pasadena, MD"), "Baltimore"));
check("Pasadena, TX picks Houston", isU(U("Pasadena, TX"), "Houston"));

// The veto guards only the auto-file (unique) case: a tie keeps
// its candidates even when the stated state fits neither, and a
// country contradiction on a unique match also reads none.
check("College Park, TX keeps its tie (no veto on ambiguous pools)", U("College Park, TX").status === "ambiguous", JSON.stringify(U("College Park, TX")));
check("Paris with a United States hint reads none (country veto)", U("Paris", { country: "United States" }).status === "none", JSON.stringify(U("Paris", { country: "United States" })));
check("Portsmouth with a Canada hint reads none (country veto)", U("Portsmouth", { country: "Canada" }).status === "none", JSON.stringify(U("Portsmouth", { country: "Canada" })));

// Spot resolutions across the new lists, one or more per region.
const SPOTS = [
  ["Hendersonville", null, "Nashville"], ["Mt. Juliet", null, "Nashville"], ["Murfreesboro", null, "Nashville"],
  ["Fort Worth", null, "Dallas"], ["Round Rock", null, "Austin"], ["Sugar Land", null, "Houston"], ["Boerne", null, "San Antonio"],
  ["Tacoma", null, "Seattle"], ["Long Beach", null, "Los Angeles"], ["Chula Vista", null, "San Diego"],
  ["St. Paul", null, "Minneapolis"], ["Boulder", null, "Denver"], ["Scottsdale", null, "Phoenix"],
  ["Metairie", null, "New Orleans"], ["Kissimmee", null, "Orlando"], ["Dearborn", null, "Detroit"],
  ["Mississauga", null, "Toronto"], ["Laval", null, "Montreal"], ["Croydon", null, "London"], ["Salford", null, "Manchester"],
  ["Amadora", null, "Lisbon"], ["Sabadell", null, "Barcelona"], ["Versailles", null, "Paris"], ["Sharjah", null, "Dubai"],
  ["Bayamón", null, "San Juan"], ["Henderson", null, "Las Vegas"], ["Gary, IN", null, "Chicago"], ["Cherry Hill, NJ", null, "Philadelphia"],
];
for (const [town, hints, market] of SPOTS) {
  check(`${town} resolves unique to ${market}`, isU(U(town, hints || undefined), market), JSON.stringify(U(town, hints || undefined)));
}
check("Miami resolves unique to Miami (restored as a full market in Build -59; this pin asserted none through -58)", isU(U("Miami"), "Miami"), JSON.stringify(U("Miami")));
check("Tulsa still resolves none", U("Tulsa").status === "none");

// ---------- server level, phase 1: intake ----------
let server = bootServer();
let clarksvilleClaimId = null;
try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");
  const boot = await client()("GET", "/api/bootstrap");
  const UNLISTED_NAME = boot.data.unlistedMarket;
  check("bootstrap carries the -52 build stamp", boot.headers.get("x-signl-build") === "2026.10.30-59", String(boot.headers.get("x-signl-build")));
  const nashBoot = (boot.data.markets || []).find((m) => m.name === "Nashville");
  check("bootstrap ships Nashville's full footprint list (Clarksville included)", !!nashBoot && nashBoot.cities.includes("Clarksville") && nashBoot.cities.length >= 20, JSON.stringify(nashBoot && nashBoot.cities.length));

  const claim = async (email, handle, customCity, extra) => {
    const c = client();
    const r = await c("POST", "/api/auth/register", { role: "creator", quickClaim: true, email, password: PW, market: UNLISTED_NAME, customCity, customCountry: "United States", handle, ...AGREE, ...(extra || {}) });
    return { c, r };
  };

  const clark = await claim("clarksville@fixtures.dev", "clarksvilledrone", "Clarksville", { customState: "TN" });
  clarksvilleClaimId = clark.r.data.user && clark.r.data.user.id;
  check("quick claim typing Clarksville (TN) files under Nashville at sign-up, typed city kept",
    clark.r.status === 201 && !!clark.r.data.user && clark.r.data.user.market === "Nashville" && clark.r.data.user.city === "Clarksville"
      && clark.r.data.user.marketResolvedFrom === "typed_city" && clark.r.data.user.founding && clark.r.data.user.founding.unlisted === false,
    JSON.stringify(clark.r.data.user && [clark.r.data.user.market, clark.r.data.user.city, clark.r.data.user.marketResolvedFrom]));

  const frank = await claim("franklin@fixtures.dev", "franklinclaim", "Franklin");
  check("quick claim typing bare Franklin files under Nashville at sign-up",
    frank.r.status === 201 && !!frank.r.data.user && frank.r.data.user.market === "Nashville" && frank.r.data.user.city === "Franklin",
    JSON.stringify(frank.r.data.user && [frank.r.data.user.market, frank.r.data.user.city]));

  const full = client();
  const fullReg = await full("POST", "/api/auth/register", {
    role: "creator", name: "Full Hendersonville", email: "fullhendersonville@fixtures.dev", password: PW,
    market: UNLISTED_NAME, customCity: "Hendersonville", customCountry: "United States", handle: "fullhendersonville",
    followerCount: 3200, localAudiencePct: 55, categories: ["Food & Drink"], ...AGREE,
  });
  check("full signup typing Hendersonville files under Nashville at sign-up",
    fullReg.status === 201 && !!fullReg.data.user && fullReg.data.user.market === "Nashville" && fullReg.data.user.city === "Hendersonville" && fullReg.data.user.marketResolvedFrom === "typed_city",
    JSON.stringify(fullReg.data.user && [fullReg.data.user.market, fullReg.data.user.city]));

  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", businessName: "Murfreesboro Eats", email: "murfreesborobiz@fixtures.dev", password: PW,
    market: UNLISTED_NAME, customCity: "Murfreesboro", customCountry: "United States", category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  check("business registration typing Murfreesboro files under Nashville at sign-up",
    bizReg.status === 201 && !!bizReg.data.user && bizReg.data.user.market === "Nashville" && bizReg.data.user.city === "Murfreesboro" && bizReg.data.user.marketResolvedFrom === "typed_city",
    JSON.stringify(bizReg.data.user && [bizReg.data.user.market, bizReg.data.user.city]));

  const clarkVa = await claim("clarksvilleva@fixtures.dev", "clarksvilleva", "Clarksville", { customState: "VA" });
  check("quick claim typing Clarksville with state VA stays Not listed yet (veto at intake)",
    clarkVa.r.status === 201 && !!clarkVa.r.data.user && clarkVa.r.data.user.market === UNLISTED_NAME && !clarkVa.r.data.user.marketResolvedFrom && !clarkVa.r.data.user.marketCandidates,
    JSON.stringify(clarkVa.r.data.user && [clarkVa.r.data.user.market, clarkVa.r.data.user.marketResolvedFrom]));

  const col = await claim("columbia@fixtures.dev", "columbiaclaim", "Columbia");
  check("quick claim typing bare Columbia stays unlisted with both candidates stored",
    col.r.status === 201 && !!col.r.data.user && col.r.data.user.market === UNLISTED_NAME
      && Array.isArray(col.r.data.user.marketCandidates) && col.r.data.user.marketCandidates.length === 2
      && col.r.data.user.marketCandidates.includes("Nashville") && col.r.data.user.marketCandidates.includes("Baltimore"),
    JSON.stringify(col.r.data.user && [col.r.data.user.market, col.r.data.user.marketCandidates]));

  const tulsaBiz = client();
  const tulsaBizReg = await tulsaBiz("POST", "/api/auth/register", {
    role: "business", name: "Tulsa Biz Owner", businessName: "Tulsa Tacos", email: "tulsabiz@fixtures.dev", password: PW,
    market: UNLISTED_NAME, customCity: "Tulsa", customCountry: "United States", category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  check("business registration typing Tulsa stays Not listed yet (base record for the legacy clones)",
    tulsaBizReg.status === 201 && !!tulsaBizReg.data.user && tulsaBizReg.data.user.market === UNLISTED_NAME,
    JSON.stringify(tulsaBizReg.data.user && tulsaBizReg.data.user.market));
} finally {
  server.kill();
}

// ---------- seeding: legacy records as production holds them ----------
// Records filed before the footprint lists shipped sit unlisted
// with a typed city that NOW resolves. Clone real records into
// that shape, straight in the store (the cityresolver pattern).
await new Promise((r) => setTimeout(r, 300));
const db = JSON.parse(fs.readFileSync(DB, "utf8"));
const byEmail = (email) => Object.entries(db).find(([k, v]) => k.startsWith("user:") && v && v.email === email);
const clarkEntry = byEmail("clarksville@fixtures.dev");
const tulsaBizEntry = byEmail("tulsabiz@fixtures.dev");
check("seed source records exist (filed Clarksville claim + unlisted Tulsa business)", !!clarkEntry && !!tulsaBizEntry);
const seedAs = (entry, id, email, city, state) => {
  const rec = JSON.parse(JSON.stringify(entry[1]));
  rec.id = id;
  rec.email = email;
  rec.city = city;
  rec.state = state;
  rec.country = "United States";
  rec.market = "Not listed yet";
  delete rec.marketResolvedFrom;
  delete rec.marketResolvedCity;
  delete rec.marketCandidates;
  delete rec.marketFiledBy;
  delete rec.marketFiledAt;
  db[`user:${id}`] = rec;
  db[`email:${email}`] = { userId: id };
  return rec;
};
seedAs(clarkEntry, "user-legacy-springhill-0052", "legacyspringhill@fixtures.dev", "Spring Hill", "TN");
seedAs(tulsaBizEntry, "user-legacy-franklinbiz-0052", "legacyfranklinbiz@fixtures.dev", "Franklin", "TN");
seedAs(clarkEntry, "user-legacy-tulsa-0052", "legacytulsa@fixtures.dev", "Tulsa", "OK");
fs.writeFileSync(DB, JSON.stringify(db));

// ---------- server level, phase 2: the refile sweep ----------
server = bootServer();
try {
  const up = await waitForServer();
  check("dev server reboots on the seeded store", up);
  if (!up) throw new Error("server did not restart");

  const stranger = client();
  await stranger("POST", "/api/auth/login", { email: "clarksville@fixtures.dev", password: PW });
  const refused = await stranger("POST", "/api/admin/users/refile-sweep", {});
  check("the refile sweep refuses non-admin (403)", refused.status === 403, String(refused.status));

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  const run1 = await admin("POST", "/api/admin/users/refile-sweep", {});
  const s1 = run1.data.sweep || {};
  check("sweep run 1: scans the 6 unlisted records (Columbia tie, Clarksville VA, Spring Hill, Franklin business, Tulsa creator, Tulsa business)",
    run1.status === 200 && s1.scanned === 6, JSON.stringify(s1));
  check("sweep run 1: files exactly the 2 unique resolvers, both to Nashville",
    s1.filed === 2 && s1.perMarket && s1.perMarket.Nashville === 2 && Object.keys(s1.perMarket).length === 1, JSON.stringify(s1.perMarket));
  check("sweep run 1: skips 1 ambiguous (Columbia) and 3 none (Clarksville VA veto, Tulsa creator, Tulsa business)",
    s1.skippedAmbiguous === 1 && s1.skippedNone === 3, JSON.stringify(s1));
  const recs = s1.records || [];
  check("sweep run 1: the filed set is the Spring Hill creator and the Franklin business",
    recs.length === 2
      && recs.some((r) => r.userId === "user-legacy-springhill-0052" && r.role === "creator" && r.market === "Nashville" && r.city === "Spring Hill")
      && recs.some((r) => r.userId === "user-legacy-franklinbiz-0052" && r.role === "business" && r.market === "Nashville" && r.city === "Franklin"),
    JSON.stringify(recs));

  const apps = await admin("GET", "/api/admin/applications");
  const allRows = [...(apps.data.pending || []), ...(apps.data.decided || [])];
  const shRow = allRows.find((u) => u.id === "user-legacy-springhill-0052");
  check("after the sweep the Spring Hill record shows Nashville, typed city kept, stamped refile_sweep",
    !!shRow && shRow.market === "Nashville" && shRow.city === "Spring Hill" && shRow.marketResolvedFrom === "refile_sweep" && !shRow.marketSuggestion,
    JSON.stringify(shRow && [shRow.market, shRow.city, shRow.marketResolvedFrom]));
  const fbRow = allRows.find((u) => u.id === "user-legacy-franklinbiz-0052");
  check("after the sweep the Franklin business shows Nashville, stamped refile_sweep",
    !!fbRow && fbRow.market === "Nashville" && fbRow.city === "Franklin" && fbRow.marketResolvedFrom === "refile_sweep",
    JSON.stringify(fbRow && [fbRow.market, fbRow.city, fbRow.marketResolvedFrom]));
  const colRow = allRows.find((u) => u.email === "columbia@fixtures.dev");
  check("the ambiguous Columbia record is untouched by the sweep (still unlisted, tie suggestion intact)",
    !!colRow && colRow.market === "Not listed yet" && !!colRow.marketSuggestion && colRow.marketSuggestion.status === "ambiguous",
    JSON.stringify(colRow && [colRow.market, colRow.marketSuggestion && colRow.marketSuggestion.status]));
  const clarkRow = allRows.find((u) => u.id === clarksvilleClaimId);
  check("the intake-filed Clarksville claim is untouched (Nashville, typed_city stamp kept)",
    !!clarkRow && clarkRow.market === "Nashville" && clarkRow.marketResolvedFrom === "typed_city",
    JSON.stringify(clarkRow && [clarkRow.market, clarkRow.marketResolvedFrom]));

  const ev = await admin("GET", "/api/admin/events?type=market_filed");
  const sweepEvents = (ev.data.events || []).filter((e) => e.data && e.data.via === "refile_sweep");
  check("exactly 2 market_filed events carry via refile_sweep, one per filed record",
    sweepEvents.length === 2
      && sweepEvents.some((e) => e.subjectId === "user-legacy-springhill-0052" && e.market === "Nashville" && e.data.typedCity === "Spring Hill" && e.data.from === "Not listed yet")
      && sweepEvents.some((e) => e.subjectId === "user-legacy-franklinbiz-0052" && e.market === "Nashville" && e.data.typedCity === "Franklin"),
    JSON.stringify(sweepEvents.map((e) => [e.subjectId, e.data && e.data.via])));

  const run2 = await admin("POST", "/api/admin/users/refile-sweep", {});
  const s2 = run2.data.sweep || {};
  check("sweep run 2 is idempotent: files 0, scans only the 4 records still unlisted, same skips",
    run2.status === 200 && s2.filed === 0 && s2.scanned === 4 && s2.skippedAmbiguous === 1 && s2.skippedNone === 3 && Object.keys(s2.perMarket || {}).length === 0,
    JSON.stringify(s2));
  const ev2 = await admin("GET", "/api/admin/events?type=market_filed");
  const sweepEvents2 = (ev2.data.events || []).filter((e) => e.data && e.data.via === "refile_sweep");
  check("run 2 logged no new market_filed events (still exactly 2)", sweepEvents2.length === 2, String(sweepEvents2.length));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-build52: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
