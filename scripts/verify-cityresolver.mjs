// Verification of the typed-city resolver (Jeff, 2026-10-23).
// Pins:
//   - the pure resolver in markets.js: normalization (trim, case,
//     state/country suffix stripping), matching against every
//     market's city list and canonical name, and the three-way
//     outcome (unique / ambiguous / none), with a state suffix or
//     hint breaking a tie only when exactly one candidate market
//     sits in that state;
//   - intake wiring: quick claim, full signup, and business
//     registration on the not-listed path file a resolvable typed
//     city under its metro at signup (typed city kept as the home
//     city, resolution stamped), store candidates on a tie, and
//     leave a nowhere town exactly as before;
//   - the follow-on flows: POST /me/market retyping a resolvable
//     city, the one-tap candidate pick, and a profile-save city
//     correction all file the record;
//   - admin: an unlisted record carries the resolver's suggestion
//     in GET /admin/applications, and POST /admin/users/file-market
//     files it on the admin's tap only (non-admin refused, a
//     market the city does not resolve to refused, re-filing an
//     already-filed record refused). Existing records are never
//     moved without that tap: the legacy records here are seeded
//     straight into the local store the way production records
//     predating the resolver look.
// Note on the ambiguity fixture: College Park sits in exactly
// two markets' lists (Washington DC + Atlanta). DOCTRINE UPDATE
// (Build -52): Dallas now carries its real metro list, Arlington
// included, so the Arlington tie is pinned on the REAL roster
// below (the pre--52 version of this suite pinned it against a
// synthetic set because Dallas's list was just "Dallas"). The
// -52 footprint lists put many genuine town names in two or more
// metros (Columbia, Bellevue, Aurora, Lakewood, Smyrna); those
// ties are pinned in verify-build52, not here.
// Run: node scripts/verify-cityresolver.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MARKETS, resolveTypedCity, normalizeMarketName } = require("../netlify/functions/lib/markets.js");

const PORT = 8979;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-cityresolver-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-cityresolver-${Date.now()}.json`);

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

// ---------- unit level: the pure resolver ----------
const rPorts = resolveTypedCity("Portsmouth");
check("Portsmouth resolves unique to Virginia Beach", rPorts.status === "unique" && rPorts.market === "Virginia Beach" && rPorts.city === "Portsmouth", JSON.stringify(rPorts));
const rSuffix = resolveTypedCity("Portsmouth, United States");
check("country suffix is stripped (Portsmouth, United States -> Virginia Beach)", rSuffix.status === "unique" && rSuffix.market === "Virginia Beach", JSON.stringify(rSuffix));
const rCase = resolveTypedCity("  portsmouth, va ");
check("matching is case-insensitive and trims (portsmouth, va -> Virginia Beach)", rCase.status === "unique" && rCase.market === "Virginia Beach", JSON.stringify(rCase));
const rMid = resolveTypedCity("Midlothian");
check("a Richmond suburb resolves (Midlothian -> Richmond)", rMid.status === "unique" && rMid.market === "Richmond", JSON.stringify(rMid));
const rCp = resolveTypedCity("College Park");
check("College Park is ambiguous on the real roster (Washington DC + Atlanta)",
  rCp.status === "ambiguous" && rCp.markets.length === 2 && rCp.markets.includes("Washington DC") && rCp.markets.includes("Atlanta"), JSON.stringify(rCp));
const rCpGa = resolveTypedCity("College Park, GA");
check("a state suffix breaks the tie (College Park, GA -> Atlanta)", rCpGa.status === "unique" && rCpGa.market === "Atlanta", JSON.stringify(rCpGa));
const rCpMd = resolveTypedCity("College Park, Maryland");
check("a full state name breaks the tie (College Park, Maryland -> Washington DC)", rCpMd.status === "unique" && rCpMd.market === "Washington DC", JSON.stringify(rCpMd));
const rCpHint = resolveTypedCity("College Park", { state: "MD" });
check("a state hint breaks the tie (College Park + MD -> Washington DC)", rCpHint.status === "unique" && rCpHint.market === "Washington DC", JSON.stringify(rCpHint));
const rNone = resolveTypedCity("Tulsa");
check("a town in no market's list resolves none (Tulsa)", rNone.status === "none", JSON.stringify(rNone));
const rAlias = resolveTypedCity("Hampton Roads");
check("the legacy market name reuses the alias machinery (Hampton Roads -> Virginia Beach)", rAlias.status === "unique" && rAlias.market === "Virginia Beach", JSON.stringify(rAlias));
// Naming rule (Jeff, 2026-10-23): listed label reads
// "Virginia Beach (Hampton Roads)" while the canonical name in
// data stays "Virginia Beach", and a submitted label value must
// normalize back to the canonical market, never a phantom one.
const hrMarket = MARKETS.find((m) => m.id === "hampton-roads");
check("the listed label for the Virginia Beach market is 'Virginia Beach (Hampton Roads)'", !!hrMarket && hrMarket.label === "Virginia Beach (Hampton Roads)" && hrMarket.name === "Virginia Beach", hrMarket && hrMarket.label);
check("normalizeMarketName keeps the canonical name ('Virginia Beach' -> 'Virginia Beach')", normalizeMarketName("Virginia Beach") === "Virginia Beach");
check("normalizeMarketName resolves the listed label ('Virginia Beach (Hampton Roads)' -> 'Virginia Beach')", normalizeMarketName("Virginia Beach (Hampton Roads)") === "Virginia Beach");
check("normalizeMarketName still resolves the legacy alias ('Hampton Roads' -> 'Virginia Beach')", normalizeMarketName("Hampton Roads") === "Virginia Beach");
const rWash = resolveTypedCity("Washington, DC");
check("city + state recombine (Washington, DC -> Washington DC)", rWash.status === "unique" && rWash.market === "Washington DC", JSON.stringify(rWash));
// Build -52 doctrine: Arlington is now a genuine two-metro town
// on the real roster (Arlington VA in Washington DC's list,
// Arlington TX in Dallas's), so the tie and both state-broken
// resolutions pin against the real lists, no synthetic set.
const rArl = resolveTypedCity("Arlington");
check("on the real roster Arlington is ambiguous (Washington DC + Dallas)",
  rArl.status === "ambiguous" && rArl.markets.length === 2 && rArl.markets.includes("Washington DC") && rArl.markets.includes("Dallas"), JSON.stringify(rArl));
const rArlTx = resolveTypedCity("Arlington, TX");
check("Arlington, TX resolves to Dallas", rArlTx.status === "unique" && rArlTx.market === "Dallas", JSON.stringify(rArlTx));
const rArlVa = resolveTypedCity("Arlington, Virginia");
check("Arlington, Virginia resolves to Washington DC", rArlVa.status === "unique" && rArlVa.market === "Washington DC", JSON.stringify(rArlVa));

// ---------- server level, phase 1: intake wiring ----------
let server = bootServer();
try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");
  const boot = await client()("GET", "/api/bootstrap");
  const UNLISTED_NAME = boot.data.unlistedMarket;
  check("bootstrap names the unlisted pseudo-market", UNLISTED_NAME === "Not listed yet", String(UNLISTED_NAME));

  const claimUnlisted = async (email, handle, customCity, extra) => {
    const c = client();
    const r = await c("POST", "/api/auth/register", { role: "creator", quickClaim: true, email, password: PW, market: UNLISTED_NAME, customCity, customCountry: "United States", handle, ...AGREE, ...(extra || {}) });
    return { c, r };
  };

  const ports = await claimUnlisted("portsmouth@fixtures.dev", "portsmouthclaim", "Portsmouth");
  check("quick claim with a resolvable typed city returns 201", ports.r.status === 201, JSON.stringify(ports.r.data).slice(0, 200));
  check("intake files Portsmouth under Virginia Beach, typed city kept as home city",
    !!ports.r.data.user && ports.r.data.user.market === "Virginia Beach" && ports.r.data.user.city === "Portsmouth",
    JSON.stringify(ports.r.data.user && [ports.r.data.user.market, ports.r.data.user.city]));
  check("intake stamps the resolution (marketResolvedFrom typed_city, resolved city named)",
    !!ports.r.data.user && ports.r.data.user.marketResolvedFrom === "typed_city" && ports.r.data.user.marketResolvedCity === "Portsmouth" && !ports.r.data.user.marketCandidates,
    JSON.stringify(ports.r.data.user && [ports.r.data.user.marketResolvedFrom, ports.r.data.user.marketResolvedCity]));
  check("a filed claim is no longer unlisted in its founding payload",
    !!ports.r.data.user && !!ports.r.data.user.founding && ports.r.data.user.founding.unlisted === false,
    JSON.stringify(ports.r.data.user && ports.r.data.user.founding));

  const portsSuffix = await claimUnlisted("portsmouth-suffix@fixtures.dev", "portsmouthsuffix", "Portsmouth, United States");
  check("a typed city carrying its country suffix still files (Portsmouth, United States -> Virginia Beach), verbatim city kept",
    portsSuffix.r.status === 201 && !!portsSuffix.r.data.user && portsSuffix.r.data.user.market === "Virginia Beach" && portsSuffix.r.data.user.city === "Portsmouth, United States",
    JSON.stringify(portsSuffix.r.data.user && [portsSuffix.r.data.user.market, portsSuffix.r.data.user.city]));

  const cp = await claimUnlisted("collegepark@fixtures.dev", "collegeparkclaim", "College Park");
  check("an ambiguous typed city stays Not listed yet with both candidates stored, no resolution stamp",
    cp.r.status === 201 && !!cp.r.data.user && cp.r.data.user.market === UNLISTED_NAME
      && Array.isArray(cp.r.data.user.marketCandidates) && cp.r.data.user.marketCandidates.length === 2
      && cp.r.data.user.marketCandidates.includes("Washington DC") && cp.r.data.user.marketCandidates.includes("Atlanta")
      && !cp.r.data.user.marketResolvedFrom,
    JSON.stringify(cp.r.data.user && [cp.r.data.user.market, cp.r.data.user.marketCandidates]));
  const pick = await cp.c("POST", "/api/me/market", { market: "Atlanta" });
  check("the one-tap candidate pick files the record (Atlanta), typed city kept, candidates cleared",
    pick.status === 200 && !!pick.data.user && pick.data.user.market === "Atlanta" && pick.data.user.city === "College Park"
      && pick.data.user.marketResolvedFrom === "typed_city" && pick.data.user.marketResolvedCity === "College Park" && !pick.data.user.marketCandidates,
    JSON.stringify(pick.data.user && [pick.data.user.market, pick.data.user.city, pick.data.user.marketResolvedFrom]));

  const tulsa = await claimUnlisted("tulsaseed@fixtures.dev", "tulsaseed", "Tulsa");
  check("a nowhere town is unchanged: Not listed yet, no stamp, no candidates",
    tulsa.r.status === 201 && !!tulsa.r.data.user && tulsa.r.data.user.market === UNLISTED_NAME && tulsa.r.data.user.city === "Tulsa"
      && !tulsa.r.data.user.marketResolvedFrom && !tulsa.r.data.user.marketCandidates,
    JSON.stringify(tulsa.r.data.user && [tulsa.r.data.user.market, tulsa.r.data.user.city]));

  const tulsaMove = await claimUnlisted("tulsamove@fixtures.dev", "tulsamove", "Tulsa");
  const moved = await tulsaMove.c("POST", "/api/me/market", { market: UNLISTED_NAME, customCity: "Norfolk", customCountry: "United States" });
  check("retyping a resolvable city in the pending market fix files it (Norfolk -> Virginia Beach)",
    moved.status === 200 && !!moved.data.user && moved.data.user.market === "Virginia Beach" && moved.data.user.city === "Norfolk" && moved.data.user.marketResolvedFrom === "typed_city",
    JSON.stringify(moved.data.user && [moved.data.user.market, moved.data.user.city]));

  const tulsaProfile = await claimUnlisted("tulsaprofile@fixtures.dev", "tulsaprofile", "Tulsa");
  const profFix = await tulsaProfile.c("PATCH", "/api/me/profile", { city: "Suffolk" });
  check("correcting the city on a profile save files it too (Suffolk -> Virginia Beach)",
    profFix.status === 200 && !!profFix.data.user && profFix.data.user.market === "Virginia Beach" && profFix.data.user.city === "Suffolk" && profFix.data.user.marketResolvedFrom === "typed_city",
    JSON.stringify(profFix.data.user && [profFix.data.user.market, profFix.data.user.city]));

  const full = client();
  const fullReg = await full("POST", "/api/auth/register", {
    role: "creator", name: "Full Portsmouth", email: "fullportsmouth@fixtures.dev", password: PW,
    market: UNLISTED_NAME, customCity: "Portsmouth", customCountry: "United States", handle: "fullportsmouth",
    followerCount: 3200, localAudiencePct: 55, categories: ["Food & Drink"], ...AGREE,
  });
  check("full signup on the unlisted path files under the metro as well (Portsmouth -> Virginia Beach)",
    fullReg.status === 201 && !!fullReg.data.user && fullReg.data.user.market === "Virginia Beach" && fullReg.data.user.city === "Portsmouth" && fullReg.data.user.marketResolvedFrom === "typed_city",
    JSON.stringify(fullReg.data && fullReg.data.user && [fullReg.data.user.market, fullReg.data.user.city]).slice(0, 200));

  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", businessName: "Portsmouth Eats", email: "portsmouthbiz@fixtures.dev", password: PW,
    market: UNLISTED_NAME, customCity: "Portsmouth", customCountry: "United States", category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  check("business registration on the unlisted path files under the metro too (Portsmouth -> Virginia Beach)",
    bizReg.status === 201 && !!bizReg.data.user && bizReg.data.user.market === "Virginia Beach" && bizReg.data.user.city === "Portsmouth" && bizReg.data.user.marketResolvedFrom === "typed_city",
    JSON.stringify(bizReg.data && bizReg.data.user && [bizReg.data.user.market, bizReg.data.user.city]).slice(0, 200));
} finally {
  server.kill();
}

// ---------- seeding: legacy records as production holds them ----------
// Records created before the resolver shipped sit unlisted with a
// resolvable typed city (the mccandybee shape). Clone the real
// Tulsa record twice into that shape, straight in the store.
await new Promise((r) => setTimeout(r, 300));
const db = JSON.parse(fs.readFileSync(DB, "utf8"));
const seedEntry = Object.entries(db).find(([k, v]) => k.startsWith("user:") && v && v.email === "tulsaseed@fixtures.dev");
check("seed record for the legacy clones exists", !!seedEntry);
const seed = seedEntry[1];
const legacy = (id, email, name, handle, city) => {
  const rec = JSON.parse(JSON.stringify(seed));
  rec.id = id;
  rec.email = email;
  rec.name = name;
  rec.city = city;
  rec.country = "United States";
  rec.state = null;
  rec.market = "Not listed yet";
  if (rec.creator) rec.creator.handle = handle;
  delete rec.marketResolvedFrom;
  delete rec.marketResolvedCity;
  delete rec.marketCandidates;
  db[`user:${id}`] = rec;
  db[`email:${email}`] = { userId: id };
};
legacy("user-legacy-portsmouth-0001", "legacyportsmouth@fixtures.dev", "Legacy Portsmouth", "legacyportsmouth", "Portsmouth, United States");
legacy("user-legacy-collegepark-0002", "legacycollegepark@fixtures.dev", "Legacy College Park", "legacycollegepark", "College Park");
fs.writeFileSync(DB, JSON.stringify(db));

// ---------- server level, phase 2: admin suggestion + filing ----------
server = bootServer();
try {
  const up = await waitForServer();
  check("dev server reboots on the seeded store", up);
  if (!up) throw new Error("server did not restart");

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  const apps = await admin("GET", "/api/admin/applications");
  const allRows = [...(apps.data.pending || []), ...(apps.data.decided || [])];
  const lp = allRows.find((u) => u.id === "user-legacy-portsmouth-0001");
  check("the legacy Portsmouth record carries the unique suggestion inline",
    !!lp && !!lp.marketSuggestion && lp.marketSuggestion.status === "unique" && lp.marketSuggestion.market === "Virginia Beach" && lp.marketSuggestion.city === "Portsmouth",
    JSON.stringify(lp && lp.marketSuggestion));
  const lc = allRows.find((u) => u.id === "user-legacy-collegepark-0002");
  check("the legacy College Park record carries the ambiguous suggestion with both candidates",
    !!lc && !!lc.marketSuggestion && lc.marketSuggestion.status === "ambiguous" && lc.marketSuggestion.markets.includes("Washington DC") && lc.marketSuggestion.markets.includes("Atlanta"),
    JSON.stringify(lc && lc.marketSuggestion));
  const tulsaRow = allRows.find((u) => u.email === "tulsaseed@fixtures.dev");
  check("a nowhere-town record carries no suggestion", !!tulsaRow && !tulsaRow.marketSuggestion, JSON.stringify(tulsaRow && tulsaRow.marketSuggestion));

  const stranger = client();
  await stranger("POST", "/api/auth/login", { email: "tulsaseed@fixtures.dev", password: PW });
  const refused = await stranger("POST", "/api/admin/users/file-market", { userId: "user-legacy-portsmouth-0001", market: "Virginia Beach" });
  check("the file-market endpoint refuses non-admin (403)", refused.status === 403, String(refused.status));

  const wrong = await admin("POST", "/api/admin/users/file-market", { userId: "user-legacy-portsmouth-0001", market: "Richmond" });
  check("filing under a market the city does not resolve to is refused (400)", wrong.status === 400, String(wrong.status));

  const filed = await admin("POST", "/api/admin/users/file-market", { userId: "user-legacy-portsmouth-0001", market: "Virginia Beach" });
  check("the admin tap files the record (market set, typed city kept verbatim, stamped admin_suggestion)",
    filed.status === 200 && !!filed.data.user && filed.data.user.market === "Virginia Beach" && filed.data.user.city === "Portsmouth, United States"
      && filed.data.user.marketResolvedFrom === "admin_suggestion" && !!filed.data.user.marketFiledAt,
    JSON.stringify(filed.data.user && [filed.data.user.market, filed.data.user.city, filed.data.user.marketResolvedFrom]));

  const filedCp = await admin("POST", "/api/admin/users/file-market", { userId: "user-legacy-collegepark-0002", market: "Atlanta" });
  check("an ambiguous record files under a picked candidate (Atlanta), typed city kept",
    filedCp.status === 200 && !!filedCp.data.user && filedCp.data.user.market === "Atlanta" && filedCp.data.user.city === "College Park" && filedCp.data.user.marketResolvedFrom === "admin_suggestion",
    JSON.stringify(filedCp.data.user && [filedCp.data.user.market, filedCp.data.user.city]));

  const again = await admin("POST", "/api/admin/users/file-market", { userId: "user-legacy-portsmouth-0001", market: "Virginia Beach" });
  check("re-filing an already-filed record is refused (400)", again.status === 400, String(again.status));

  const appsAfter = await admin("GET", "/api/admin/applications");
  const lpAfter = [...(appsAfter.data.pending || []), ...(appsAfter.data.decided || [])].find((u) => u.id === "user-legacy-portsmouth-0001");
  check("after filing, the record shows its metro and no suggestion",
    !!lpAfter && lpAfter.market === "Virginia Beach" && !lpAfter.marketSuggestion,
    JSON.stringify(lpAfter && [lpAfter.market, lpAfter.marketSuggestion]));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-cityresolver: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
