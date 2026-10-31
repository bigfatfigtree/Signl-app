// Build 2026.10.31-61 verification: Miami restored as a full
// market. Jeff removed Miami in the 2026-10-23 roster reset and
// reversed that call on 2026-10-30 ("add miami and all
// surrounding locations of metro area"). Build -52's suite pinned
// Miami -> none on the 37-market roster; this build flips that
// doctrine: Miami is back with its full tri-county metro
// footprint, and the roster is 38 markets in the same 8 countries.
// Pins:
//   - the Miami market exists (id miami, label "Miami, Florida",
//     country United States, MARKET_STATES ["FL"]) carrying
//     exactly the 48 mandated places: 22 Miami-Dade, 16 Broward,
//     10 Palm Beach;
//   - no steal: none of Miami's 48 names appears in any other
//     market's list, and the cross-market tie set is still
//     exactly the 26 documented two/three-metro names -52 left;
//   - the resolver: Miami-metro typed cities (Miami, Miami
//     Beach, Fort Lauderdale, Boca Raton, Hialeah, West Palm
//     Beach, Coral Gables, Doral) resolve unique to Miami, with
//     FL hints and bare; a contradicting state/country hint on
//     Miami reads none under the -52 veto rules; Florida's other
//     markets (Orlando, Tampa, the Spring Hill tie) are unmoved;
//   - intake: a quick claim typing "Fort Lauderdale, FL" files
//     under Miami at sign-up with the typed city kept, a bare
//     Boca Raton claim files too, and a Miami claim carrying a
//     TX state stays Not listed yet (veto at intake);
//   - founding config parity: Miami is NOT live (bootstrap,
//     claim payload and the admin markets list all agree), the
//     same unlaunched state Nashville and Virginia Beach ship
//     in - it files and counts, it does not launch itself.
// Run: node scripts/verify-build59.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MARKETS, MARKET_STATES, resolveTypedCity } = require("../netlify/functions/lib/markets.js");

const PORT = 8985;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-build59-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-build59-${Date.now()}.json`);

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
      // Deliberately NO SIGNL_TEST_ALLOW_BUSINESS (the verify-
      // launch pattern): the override makes every market READ
      // live, and this suite's whole point is Miami's real
      // production default - NOT live, like Nashville/VB.
      SIGNL_TEST_ALLOW_BUSINESS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return server;
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const PW = "claim-" + "pass-1234";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

// ---------- unit level: stamp, roster, the Miami market ----------
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
check("stamp: BUILD_ID is 2026.10.31-61 on server and shell", buildJs.includes('BUILD_ID = "2026.10.31-61"') && indexHtml.includes("2026.10.31-61"));

check("the roster is 38 markets (37 through -58 + Miami)", MARKETS.length === 38, String(MARKETS.length));
const countries = [...new Set(MARKETS.map((m) => m.country))];
check("the country set is unchanged (8 countries)", countries.length === 8, JSON.stringify(countries));

const MIAMI_CITIES = [
  // Miami-Dade (22)
  "Miami", "Miami Beach", "Hialeah", "Miami Gardens", "Doral", "Coral Gables", "Kendall", "Homestead",
  "Florida City", "North Miami", "North Miami Beach", "Aventura", "Sunny Isles Beach", "Miami Lakes",
  "Hialeah Gardens", "Sweetwater", "Cutler Bay", "Pinecrest", "Palmetto Bay", "Miami Springs",
  "Opa-locka", "Key Biscayne",
  // Broward (16)
  "Fort Lauderdale", "Hollywood", "Pembroke Pines", "Miramar", "Coral Springs", "Pompano Beach",
  "Davie", "Plantation", "Sunrise", "Weston", "Coconut Creek", "Margate", "Lauderhill", "Tamarac",
  "Deerfield Beach", "Cooper City",
  // Palm Beach (10)
  "West Palm Beach", "Boca Raton", "Delray Beach", "Boynton Beach", "Lake Worth Beach",
  "Palm Beach Gardens", "Jupiter", "Wellington", "Riviera Beach", "Greenacres",
];
const miami = MARKETS.find((m) => m.id === "miami");
check("the Miami market exists with its identity (name Miami, label 'Miami, Florida', United States)",
  !!miami && miami.name === "Miami" && miami.label === "Miami, Florida" && miami.country === "United States",
  JSON.stringify(miami && [miami.id, miami.name, miami.label, miami.country]));
check("Miami carries exactly the 48 tri-county places (22 Miami-Dade, 16 Broward, 10 Palm Beach)",
  !!miami && miami.cities.length === 48 && MIAMI_CITIES.every((c) => miami.cities.includes(c)) && miami.cities.every((c) => MIAMI_CITIES.includes(c)),
  JSON.stringify(miami && miami.cities));
check("MARKET_STATES files Miami in FL only", JSON.stringify(MARKET_STATES.miami) === JSON.stringify(["FL"]), JSON.stringify(MARKET_STATES.miami));

// No steal: every name on Miami's list is claimed by Miami alone,
// and the full cross-market tie set is exactly what -52 left.
const norm = (s) => String(s || "").toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();
const claimants = new Map();
for (const m of MARKETS) {
  for (const n of [m.name, ...(m.cities || [])]) {
    const k = norm(n);
    if (!claimants.has(k)) claimants.set(k, new Set());
    claimants.get(k).add(m.id);
  }
}
const miamiShared = MIAMI_CITIES.filter((c) => { const s = claimants.get(norm(c)); return !s || s.size !== 1 || !s.has("miami"); });
check("no steal: every Miami name is claimed by the Miami market alone", miamiShared.length === 0, JSON.stringify(miamiShared));
const TIE_KEYS = ["arlington", "aurora", "bellevue", "chester", "college park", "columbia", "covington", "denton", "elgin", "georgetown", "glendale", "kirkland", "lakewood", "lebanon", "london", "marysville", "pasadena", "plymouth", "roseville", "san marcos", "smyrna", "spring hill", "springfield", "taylor", "west chester", "westminster"];
const multiKeys = [...claimants.entries()].filter(([, s]) => s.size > 1).map(([k]) => k).sort();
check("the documented tie set is unchanged (26 names, none of them Miami's)",
  JSON.stringify(multiKeys) === JSON.stringify([...TIE_KEYS].sort()), JSON.stringify(multiKeys));

// ---------- unit level: the resolver on Miami ----------
const U = (raw, hints) => resolveTypedCity(raw, hints);
const isU = (r, market) => r.status === "unique" && r.market === market;
for (const town of ["Miami", "Miami Beach", "Fort Lauderdale", "Boca Raton", "Hialeah", "West Palm Beach", "Coral Gables", "Doral", "Hollywood", "Jupiter"]) {
  check(`${town} resolves unique to Miami`, isU(U(town), "Miami"), JSON.stringify(U(town)));
}
check("Fort Lauderdale, FL resolves unique to Miami", isU(U("Fort Lauderdale, FL"), "Miami"), JSON.stringify(U("Fort Lauderdale, FL")));
check("Miami, Florida resolves unique to Miami (full state name)", isU(U("Miami, Florida"), "Miami"), JSON.stringify(U("Miami, Florida")));
check("Miami with a FL hint resolves unique to Miami", isU(U("Miami", { state: "FL" }), "Miami"));
check("Miami with a TX hint reads none (the -52 veto on the restored market)", U("Miami", { state: "TX" }).status === "none", JSON.stringify(U("Miami", { state: "TX" })));
check("Miami, TX reads none (veto)", U("Miami, TX").status === "none", JSON.stringify(U("Miami, TX")));
check("Miami with a Canada hint reads none (country veto)", U("Miami", { country: "Canada" }).status === "none", JSON.stringify(U("Miami", { country: "Canada" })));
check("Orlando still resolves unique to Orlando (Florida neighbors unmoved)", isU(U("Orlando"), "Orlando"));
check("Tampa still resolves unique to Tampa", isU(U("Tampa"), "Tampa"));
check("bare Spring Hill still ties Nashville / Tampa", U("Spring Hill").status === "ambiguous" && U("Spring Hill").markets.includes("Nashville") && U("Spring Hill").markets.includes("Tampa"), JSON.stringify(U("Spring Hill")));
check("Spring Hill, FL picks Tampa, not Miami", isU(U("Spring Hill, FL"), "Tampa"), JSON.stringify(U("Spring Hill, FL")));

// ---------- server level: bootstrap, intake, admin parity ----------
const server = bootServer();
try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");
  const boot = await client()("GET", "/api/bootstrap");
  const UNLISTED_NAME = boot.data.unlistedMarket;
  check("bootstrap carries the -59 build stamp", boot.headers.get("x-signl-build") === "2026.10.31-61", String(boot.headers.get("x-signl-build")));
  check("bootstrap serves 38 markets", Array.isArray(boot.data.markets) && boot.data.markets.length === 38, JSON.stringify(boot.data.markets && boot.data.markets.length));
  const miamiBoot = (boot.data.markets || []).find((m) => m.name === "Miami");
  check("bootstrap ships Miami's full footprint list (48 places incl. Fort Lauderdale and Boca Raton)",
    !!miamiBoot && miamiBoot.cities.length === 48 && miamiBoot.cities.includes("Fort Lauderdale") && miamiBoot.cities.includes("Boca Raton") && miamiBoot.country === "United States",
    JSON.stringify(miamiBoot && miamiBoot.cities.length));

  const claim = async (email, handle, customCity, extra) => {
    const c = client();
    const r = await c("POST", "/api/auth/register", { role: "creator", quickClaim: true, email, password: PW, market: UNLISTED_NAME, customCity, customCountry: "United States", handle, ...AGREE, ...(extra || {}) });
    return { c, r };
  };

  const ftl = await claim("fortlauderdale@fixtures.dev", "ftlcreator", "Fort Lauderdale", { customState: "FL" });
  check("quick claim typing Fort Lauderdale (FL) files under Miami at sign-up, typed city kept",
    ftl.r.status === 201 && !!ftl.r.data.user && ftl.r.data.user.market === "Miami" && ftl.r.data.user.city === "Fort Lauderdale"
      && ftl.r.data.user.marketResolvedFrom === "typed_city",
    JSON.stringify(ftl.r.data.user && [ftl.r.data.user.market, ftl.r.data.user.city, ftl.r.data.user.marketResolvedFrom]));
  check("the Fort Lauderdale claim's founding state is filed and NOT live (Miami unlaunched, like Nashville/VB)",
    !!ftl.r.data.user && !!ftl.r.data.user.founding && ftl.r.data.user.founding.unlisted === false && ftl.r.data.user.founding.marketLive === false,
    JSON.stringify(ftl.r.data.user && ftl.r.data.user.founding));

  const boca = await claim("bocaraton@fixtures.dev", "bocacreator", "Boca Raton");
  check("quick claim typing bare Boca Raton files under Miami at sign-up",
    boca.r.status === 201 && !!boca.r.data.user && boca.r.data.user.market === "Miami" && boca.r.data.user.city === "Boca Raton",
    JSON.stringify(boca.r.data.user && [boca.r.data.user.market, boca.r.data.user.city]));

  const miamiTx = await claim("miamitx@fixtures.dev", "miamitxclaim", "Miami", { customState: "TX" });
  check("quick claim typing Miami with state TX stays Not listed yet (veto at intake)",
    miamiTx.r.status === 201 && !!miamiTx.r.data.user && miamiTx.r.data.user.market === UNLISTED_NAME && !miamiTx.r.data.user.marketResolvedFrom,
    JSON.stringify(miamiTx.r.data.user && [miamiTx.r.data.user.market, miamiTx.r.data.user.marketResolvedFrom]));

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");
  const marketsRes = await admin("GET", "/api/admin/markets");
  const rows = marketsRes.data.markets || [];
  const miamiRow = rows.find((m) => m.name === "Miami");
  const nashRow = rows.find((m) => m.name === "Nashville");
  check("admin markets list: 38 markets; Miami present, United States, NOT live - the same unlaunched config as Nashville",
    rows.length === 38 && !!miamiRow && miamiRow.country === "United States" && miamiRow.live === false && !!nashRow && nashRow.live === false,
    JSON.stringify(miamiRow));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-build59: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
