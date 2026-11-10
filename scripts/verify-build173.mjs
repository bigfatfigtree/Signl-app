// verify-build173.mjs — Build -173: the claim-link market
// fix (client parser + no-default claim draft) and the
// one-time re-file of the cohort the broken links mis-filed.
//   THE BUG: parseClaimParams kept a claim link's market
//     only on an EXACT bootstrap name/id match. Outreach
//     links for Raleigh ("Raleigh/The Triangle", 48 people)
//     and Dallas-Fort Worth ("Dallas-Fort Worth", 40) matched
//     nothing and were silently dropped; claimDraftInit then
//     defaulted the draft to "Virginia Beach", so those
//     creators were greeted as Virginia Beach on the invite
//     screen and FILED under Virginia Beach at registration.
//   THE BUILD: the parser normalizes a market string to a
//     punctuation-free lowercase key and resolves it against
//     every market's name/id keys plus an alias map
//     (Raleigh/The Triangle, The Triangle, Dallas-Fort Worth,
//     DFW, Fort Worth, Hampton Roads). A string that resolves
//     to nothing is carried as marketUnrecognized and the
//     claim takes the unlisted-city path; a link with no
//     market starts with NO pre-pick (the facts screen asks,
//     Continue refuses an empty pick). The hard-coded
//     "Virginia Beach" draft default is gone from the claim
//     flow and the full join form. Server half:
//     maybeFixMarkets173 re-files a listed-handle record
//     whose stored market is Virginia Beach to the market its
//     invite named — never a handle off the list, never a
//     record with a post-registration market change (those
//     are reported as deliberate moves), never a guess on a
//     duplicated handle. Diag at config:diag173 rides
//     /api/verify/counts as `marketfix`.
//   REGRESSION SHAPE: the parser cases below FAIL on the
//     pre-fix code (the old Raleigh/DFW strings parse to no
//     market at all; an unknown market parses to nothing,
//     not even a flag) and pass on the fix.
// Run: node scripts/verify-build173.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build173-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com"; // Jeff's real login (confirmed 2026-11-09)
process.env.ADMIN_PASSWORD = "<MASKED_SECRET_004>";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_VERIFY_TOKEN = "fixture-verify-token-173";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");
const root = path.join(process.cwd());

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

function makeClient() {
  const jar = new Map();
  return async function api(method, p, body, opts) {
    const headers = { "Content-Type": "application/json", ...((opts && opts.headers) || {}) };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: (opts && opts.rawPath) || url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body),
      isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = res.body; }
    return { status: res.statusCode, data };
  };
}
const anon = makeClient();

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("client: the normalizing resolver + alias map exist",
    appJs.includes("resolveClaimMarket173") && appJs.includes("CLAIM_MARKET_ALIASES_173")
    && appJs.includes("raleighthetriangle") && appJs.includes("dallasfortworth") && appJs.includes("hamptonroads"), "");
  check("client: unrecognized markets are carried, not dropped",
    appJs.includes("out.marketUnrecognized = marketRaw") && appJs.includes("claim.marketUnrecognized"), "");
  check("client: the claim draft's Virginia Beach default is GONE",
    !appJs.includes('market: pf.market || "Virginia Beach"'), "");
  check("client: renderClaimFacts' Virginia Beach pre-pick is GONE",
    !appJs.includes('const pfMarket = d.market || "Virginia Beach"'), "");
  check("client: the full join form's Virginia Beach pre-pick is GONE",
    !appJs.includes('const pfMarket = pf.market || "Virginia Beach"'), "");
  check("client: an unrecognized market opens the draft on the unlisted path",
    appJs.includes('pf.market || (pf.marketUnrecognized ? unlistedLabel() : "")'), "");
  check("client: marketOptions marks the unlisted option selected when seeded (no first-option fallback)",
    appJs.includes('selected === unlistedLabel() ? "selected" : ""'), "");
  check("client: Continue refuses an unpicked market on both doors",
    appJs.includes("Pick your market — the one where most of your followers live"), "");
  check("server: the re-file loader + flag + diag exist and ride verify/counts",
    routerJs.includes("maybeFixMarkets173") && routerJs.includes('"config:marketFix173"')
    && routerJs.includes('"config:diag173"') && routerJs.includes("marketfix: marketfix173"), "");
  check("server: the loader list carries the cohort (Holly → Raleigh, Stephanie → Dallas, 88 entries)",
    routerJs.includes('"maketodayahollyday": "Raleigh"') && routerJs.includes('"stephaniecamillee": "Dallas"')
    && routerJs.includes('"ashtyngillespy": "Raleigh"'), "");
  check("server: the loader never overrides a post-registration market change",
    routerJs.includes("u.marketChangedAt || changedIds.has(String(u.id))") && routerJs.includes('"deliberate_move"'), "");
  // LOADER RULE (AGENTS.md, 2026-11-09 — the -173 outage):
  // no serial per-key loop over a store prefix in the request
  // path, ever. The first -173 loader walked event: with one
  // awaited store.get per key; on Netlify Blobs that blocked
  // every API request for minutes and took production down.
  check("server: the loader NEVER serial-scans a store prefix (the outage regression pin)",
    !routerJs.includes('const evKeys = await store.listKeys("event:")')
    && !/for \(const k of evKeys\) \{\s*const ev = await store\.get\(k\)/.test(routerJs), "");
}

// --- B: the parser, behaviorally ------------------------------
console.log("== B: parseClaimParams resolves what outreach actually sent ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const start = appJs.indexOf("const CLAIM_MARKET_ALIASES_173");
  const end = appJs.indexOf("// Business-wave prefill");
  check("parser source located for extraction", start > 0 && end > start, `start=${start} end=${end}`);
  const TEST_MARKETS = [
    { id: "hampton-roads", name: "Virginia Beach", label: "Virginia Beach (Hampton Roads)", country: "United States", cities: ["Virginia Beach", "Norfolk"] },
    { id: "raleigh", name: "Raleigh", label: "Raleigh, North Carolina", country: "United States", cities: ["Raleigh", "Durham"] },
    { id: "dallas", name: "Dallas", label: "Dallas, Texas", country: "United States", cities: ["Dallas", "Fort Worth"] },
    { id: "houston", name: "Houston", label: "Houston, Texas", country: "United States", cities: ["Houston"] },
    { id: "nashville", name: "Nashville", label: "Nashville, Tennessee", country: "United States", cities: ["Nashville"] },
    { id: "los-angeles", name: "Los Angeles", label: "Los Angeles, California", country: "United States", cities: ["Los Angeles"] },
    { id: "washington-dc", name: "Washington DC", label: "Washington, DC", country: "United States", cities: ["Washington"] },
    { id: "london", name: "London", label: "London", country: "United Kingdom", cities: ["London"] },
  ];
  const sandbox = { console, URLSearchParams, state: { boot: { markets: TEST_MARKETS, tiers: [], unlistedMarket: "Not listed yet" } } };
  vm.createContext(sandbox);
  const prelude = `
    const PRIMARY_PLATFORMS_CLIENT = [{ id: "instagram" }];
    function sanitizeClaimHandle(v) { return String(v || "").trim().replace(/^@/, "").replace(/[^A-Za-z0-9._]/g, "").slice(0, 30); }
    function unlistedLabel() { return (state.boot && state.boot.unlistedMarket) || "Not listed yet"; }
  `;
  vm.runInContext(prelude + appJs.slice(start, end) + "\n;globalThis.__parse = parseClaimParams;", sandbox);
  const parse = sandbox.__parse;
  const run = (qs) => parse(new URLSearchParams(qs));
  const cases = [
    ["the exact Raleigh link we sent (Raleigh/The Triangle)", "handle=maketodayahollyday&market=Raleigh%2FThe%20Triangle&src=email", "Raleigh"],
    ["canonical Raleigh", "handle=x&market=Raleigh", "Raleigh"],
    ["Raleigh by id, lowercase", "handle=x&market=raleigh", "Raleigh"],
    ["The Triangle alone", "handle=x&market=The%20Triangle", "Raleigh"],
    ["the exact DFW link we sent (Dallas-Fort Worth)", "handle=stephaniecamillee&market=Dallas-Fort%20Worth&src=email", "Dallas"],
    ["Dallas with an en dash", "handle=x&market=Dallas%E2%80%93Fort%20Worth", "Dallas"],
    ["DFW", "handle=x&market=DFW", "Dallas"],
    ["Fort Worth alone", "handle=x&market=Fort%20Worth", "Dallas"],
    ["canonical Dallas", "handle=x&market=Dallas", "Dallas"],
    ["Hampton Roads alias (unchanged)", "handle=jsheaphoto22&market=Hampton%20Roads", "Virginia Beach"],
    ["Virginia Beach canonical (unchanged)", "handle=x&market=Virginia%20Beach", "Virginia Beach"],
    ["Houston canonical (unchanged)", "handle=x&market=Houston", "Houston"],
    ["Los Angeles by hyphenated id (unchanged)", "handle=x&market=los-angeles", "Los Angeles"],
    ["the unlisted label itself (unchanged)", "handle=x&market=Not%20listed%20yet", "Not listed yet"],
  ];
  for (const [name, qs, want] of cases) {
    const out = run(qs);
    check(`parser: ${name} → ${want}`, out.market === want && !out.marketUnrecognized, JSON.stringify(out));
  }
  const charlottesville = run("handle=amandaauthentically&market=Charlottesville&src=email");
  check("parser: an unlisted city (Charlottesville) is carried as unrecognized — never a market, never Virginia Beach",
    !charlottesville.market && charlottesville.marketUnrecognized === "Charlottesville", JSON.stringify(charlottesville));
  const tulsa = run("handle=x&market=Tulsa");
  check("parser: an unknown market (Tulsa) is carried as unrecognized",
    !tulsa.market && tulsa.marketUnrecognized === "Tulsa", JSON.stringify(tulsa));
  const none = run("handle=x&src=email");
  check("parser: no market param → no market, no flag (the draft starts empty)",
    !none.market && !none.marketUnrecognized, JSON.stringify(none));
}

// --- C: registration files the parsed market ------------------
console.log("== C: POST /auth/register files what the claim carries ==");
{
  const reg = async (tag, body) => {
    const r = await anon("POST", "/api/auth/register", { role: "creator", quickClaim: true, password: "<redacted>", agreedTerms: true, ...body });
    const rec = r.data && r.data.user ? await store.get(`user:${r.data.user.id}`) : null;
    return { r, rec };
  };
  const ral = await reg("ral", { email: "fix173-ral@fixtures.dev", market: "Raleigh", handle: "fixture173ral" });
  check("register: a Raleigh claim files under Raleigh (201)", ral.r.status === 201 && !!ral.rec && ral.rec.market === "Raleigh", `status=${ral.r.status} market=${ral.rec && ral.rec.market}`);
  const dal = await reg("dal", { email: "fix173-dal@fixtures.dev", market: "Dallas", handle: "fixture173dal" });
  check("register: a Dallas claim files under Dallas (201)", dal.r.status === 201 && !!dal.rec && dal.rec.market === "Dallas", `status=${dal.r.status} market=${dal.rec && dal.rec.market}`);
  const unl = await reg("unl", { email: "fix173-unl@fixtures.dev", market: "Not listed yet", handle: "fixture173unl", customCity: "Tulsa", customCountry: "United States" });
  check("register: the unlisted path files as Not listed yet with the typed city (201)",
    unl.r.status === 201 && !!unl.rec && unl.rec.market === "Not listed yet" && unl.rec.city === "Tulsa", `status=${unl.r.status} market=${unl.rec && unl.rec.market} city=${unl.rec && unl.rec.city}`);
  const bogus = await anon("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "fix173-bogus@fixtures.dev", password: "<redacted>", agreedTerms: true, market: "Bogusville", handle: "fixture173bogus" });
  check("register: an unknown market is refused outright (400) — the server never defaults either",
    bogus.status === 400, `got ${bogus.status}`);
}

// --- D: the re-file loader (child fixtures) -------------------
console.log("== D: maybeFixMarkets173 (child fixtures) ==");
{
  const run = (file, tag) => {
    const out = execFileSync(process.execPath, [path.join(root, "scripts", file)], { encoding: "utf8", env: { ...process.env } });
    const line = out.trim().split("\n").filter((l) => l.startsWith(tag + " ")).pop();
    return line ? JSON.parse(line.slice(tag.length + 1)) : null;
  };
  const f = run("fixture173-marketfix.mjs", "MARKETFIX173");
  check("loader: Holly's broken-claim record re-files Virginia Beach → Raleigh; status + city untouched",
    !!f && !!f.after1.a && f.after1.a.market === "Raleigh" && f.after1.a.status === "pending" && f.after1.a.city === "Virginia Beach",
    JSON.stringify(f && f.after1.a));
  check("loader: Stephanie's record re-files Virginia Beach → Dallas; her approval stands",
    !!f && !!f.after1.b && f.after1.b.market === "Dallas" && f.after1.b.status === "approved", JSON.stringify(f && f.after1.b));
  check("loader: a record with marketChangedAt is NOT moved (deliberate later choice)",
    !!f && !!f.after1.c && f.after1.c.market === "Virginia Beach", JSON.stringify(f && f.after1.c));
  check("loader: a second stamped record (lixas_family shape) is NOT moved either",
    !!f && !!f.after1.g && f.after1.g.market === "Virginia Beach", JSON.stringify(f && f.after1.g));
  // Untouched is proven on the fields the loader owns —
  // market and status — plus absence from the diag and the
  // event log: a sibling one-time pass (the profile backfill)
  // may legitimately bump updatedAt on the same first request
  // (the fixture172-frank-ok note), so updatedAt is not the
  // probe.
  check("loader: an already-right Raleigh record keeps its market + status",
    !!f && !!f.after1.d && f.after1.d.market === "Raleigh" && f.after1.d.status === "pending", JSON.stringify(f && f.after1.d));
  check("loader: a handle NOT on the list keeps Virginia Beach and never enters the diag",
    !!f && !!f.after1.e && f.after1.e.market === "Virginia Beach" && !!f.marketfix && !!f.marketfix.actions && !("someoneelsevb" in f.marketfix.actions),
    JSON.stringify(f && f.after1.e));
  check("loader: a duplicated handle is ambiguous — neither record moves",
    !!f && !!f.after1.f1 && f.after1.f1.market === "Virginia Beach" && !!f.after1.f2 && f.after1.f2.market === "Virginia Beach", "");
  check("loader: second run is a no-op (moved record identical after another trigger)",
    !!f && !!f.after1.a && f.aUpdatedAtAfter2 === f.after1.a.updatedAt, "");
  check("loader: diag on verify/counts tells the whole story (88 listed, 7 records found on 6 handles, 2 moved 1+1, 1 already right, 2 deliberate, 1 ambiguous, 82 no account)",
    !!f && !!f.marketfix && f.marketfix.listed === 88 && f.marketfix.accountsFound === 7 && f.marketfix.moved === 2
    && f.marketfix.movedTo && f.marketfix.movedTo.Raleigh === 1 && f.marketfix.movedTo.Dallas === 1
    && f.marketfix.alreadyRight === 1 && f.marketfix.deliberateMove === 2 && f.marketfix.ambiguous === 1 && f.marketfix.noAccount === 82,
    JSON.stringify(f && f.marketfix));
  check("loader: diag per-handle actions read moved / deliberate_move / already_right / ambiguous",
    !!f && !!f.marketfix && f.marketfix.actions
    && f.marketfix.actions.maketodayahollyday === "moved" && f.marketfix.actions.stephaniecamillee === "moved"
    && f.marketfix.actions.ashtyngillespy === "deliberate_move" && f.marketfix.actions.lixas_family === "deliberate_move"
    && f.marketfix.actions["919eats"] === "already_right" && f.marketfix.actions["nc.foodbaby"] === "ambiguous",
    JSON.stringify(f && f.marketfix && f.marketfix.actions));
  check("loader: claimed flag written; exactly 2 re-file events, for the 2 moved records",
    !!f && !!f.flag && f.flag.done === true && f.flag.moved === 2 && f.refileCount === 2
    && JSON.stringify(f.refileSubjects) === JSON.stringify(["fix173-a", "fix173-b"]),
    JSON.stringify(f && { flag: f.flag, n: f.refileCount, s: f.refileSubjects }));

  const n = run("fixture173-marketfix-none.mjs", "MARKETFIXNONE173");
  check("loader (none listed): diag says 88 listed, 0 found, 88 no account, 0 moved, no per-handle records",
    !!n && !!n.marketfix && n.marketfix.listed === 88 && n.marketfix.accountsFound === 0 && n.marketfix.noAccount === 88 && n.marketfix.moved === 0 && n.marketfix.records === 0,
    JSON.stringify(n && n.marketfix));
  check("loader (none listed): the unrelated Virginia Beach record is untouched",
    !!n && !!n.bystander && n.bystander.market === "Virginia Beach" && n.bystander.updatedAt === "2026-11-08T20:00:00.000Z", JSON.stringify(n && n.bystander));
}

console.log(`\nBUILD-173 SUITE: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
