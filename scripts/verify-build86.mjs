// Build -86 verification: London as a full push market
// (Jeff, 2026-11-02: "Let's do London. Let's go hard with it
// just as much"). Creator-side market enablement only. London
// has been a typed market in lib/markets.js since 2026-10-18;
// this build makes it a first-class push market like Nashville
// and Austin:
//   - the claim welcome carries a real London street photo
//     (city-london.jpg, sourced from Pexels the way the -85
//     city set was sourced from the site photo library);
//   - the claim flow and the full join form carry a London
//     market note (UK rules count a gifted or paid post as an
//     ad), mirroring the Dubai Advertiser Permit note pattern
//     from Build -70: shown only for the picked market, never
//     blocking, no gating, no stored permit state;
//   - everything else already keys off the typed market list,
//     and this suite proves it end to end for London: a claim
//     link with market=London resolves in bootstrap (the client
//     matches by name or id), a London creator registers
//     through the exact claim sequence, completes the Build
//     -65 gate, is approved, ranks in London (queue positions
//     are registration order within the market), appears on
//     the Admin market board under London, lists multi-market
//     (a London home creator listing Nashville; a Nashville
//     home creator listing London), and the typed-city
//     resolver files Croydon to London on the UK hint while a
//     bare "London" stays the pinned Columbus/London tie.
//   - a US claim (Nashville) runs the identical sequence with
//     identical outcomes: existing behavior is unchanged.
// Run: node scripts/verify-build86.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { MARKETS, resolveTypedCity } = require(path.join(root, "netlify", "functions", "lib", "markets.js"));
const PORT = 8951;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b86.dev";
const ADMIN_PASSWORD = "b86-admin-pass";
const MIN_LINE = "SIGNL starts at 500 total followers across your platforms.";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 220) : ""}`); }
}

// ---------- static: the market def + the client surface ----------
console.log("== Static: London the typed market + the claim surface ==");
{
  const london = MARKETS.find((m) => m.id === "london");
  check("markets.js: London entry is id london, name London, country United Kingdom", !!london && london.name === "London" && london.country === "United Kingdom", JSON.stringify(london && { id: london.id, country: london.country }));
  check("markets.js: London carries its metro city list (London + Croydon at least)", !!london && london.cities.includes("London") && london.cities.includes("Croydon") && london.cities.length >= 15, london && String(london.cities.length));
  check("markets.js: the roster is still 38 markets (London was already counted)", MARKETS.length === 38, String(MARKETS.length));
}
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
check("claim photos: london is in CLAIM_CITY_PHOTOS", /CLAIM_CITY_PHOTOS = \[[^\]]*"london"/.test(appJs));
check("claim photos: city-london.jpg exists on disk", fs.existsSync(path.join(root, "public", "assets", "claim", "city-london.jpg")));
check("claim photos: the Nashville set is untouched (city-nashville.jpg + welcome.jpg still there)", fs.existsSync(path.join(root, "public", "assets", "claim", "city-nashville.jpg")) && fs.existsSync(path.join(root, "public", "assets", "claim", "welcome.jpg")));
check("London note: present in the claim facts screen (c85-london-note, ASA wording)", appJs.includes('id="c85-london-note"') && appJs.includes("count a gifted or paid post as an ad"));
check("London note: present in the full join form (jc-london-note)", appJs.includes('id="jc-london-note"'));
check("London note: toggles key on the picked market being London (claim + join)", appJs.includes('londonNote.style.display = m.value === "London"') && (appJs.match(/londonNote\.style\.display = m\.value === "London"/g) || []).length === 2);
check("Dubai note: unchanged alongside (both ids + toggles intact)", appJs.includes('id="c85-dubai-note"') && appJs.includes('id="jc-dubai-note"') && appJs.includes('dubaiNote.style.display = m.value === "Dubai"'));
check("no London gating: no permit state, no block keyed on London in the router", !fs.readFileSync(path.join(root, "netlify", "functions", "lib", "router.js"), "utf8").includes("londonPermit"));
check("stamp is 2026.11.02-98 on both sides", fs.readFileSync(path.join(root, "netlify", "functions", "lib", "build.js"), "utf8").includes('BUILD_ID = "2026.11.02-98"') && fs.readFileSync(path.join(root, "public", "index.html"), "utf8").includes("2026.11.02-98"));

// ---------- resolver: typed cities around London ----------
console.log("== Resolver: London typed-city outcomes (pinned ties untouched) ==");
{
  const croydon = resolveTypedCity("Croydon", { country: "United Kingdom" });
  check("resolver: Croydon + United Kingdom files unique to London", croydon.status === "unique" && croydon.market === "London", JSON.stringify(croydon));
  const croydonBare = resolveTypedCity("Croydon", {});
  check("resolver: bare Croydon files unique to London (only London claims it)", croydonBare.status === "unique" && croydonBare.market === "London", JSON.stringify(croydonBare));
  const londonBare = resolveTypedCity("London", {});
  check("resolver: bare 'London' stays the pinned tie (Columbus + London), never auto-filed", londonBare.status === "ambiguous" && londonBare.markets.includes("Columbus") && londonBare.markets.includes("London"), JSON.stringify(londonBare));
  const londonUk = resolveTypedCity("London", { country: "United Kingdom" });
  check("resolver: 'London' + United Kingdom picks the London market", londonUk.status === "unique" && londonUk.market === "London", JSON.stringify(londonUk));
  const londonOh = resolveTypedCity("London, OH", {});
  check("resolver: 'London, OH' still picks Columbus (US behavior unchanged)", londonOh.status === "unique" && londonOh.market === "Columbus", JSON.stringify(londonOh));
}

// ---------- live: the exact claim sequence, London + Nashville ----------
class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}
function startServer(db, port) {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL, ADMIN_PASSWORD };
  const s = spawn("node", ["scripts/dev-server.mjs", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  s.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return s;
}
async function waitUp(base) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not come up on ${base}`);
}
function storedUser(dbFile, id) {
  const data = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  return data[`user:${id}`] || null;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b86-"));
const DB = path.join(tmp, "db.json");

console.log("== Live: bootstrap resolves London for claim links ==");
const server = startServer(DB, PORT);
await waitUp(BASE);
const admin = new Client(BASE);
{
  const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", r.status === 200 && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
}
{
  const boot = await (await fetch(`${BASE}/api/bootstrap`)).json();
  const m = (boot.markets || []).find((x) => x.id === "london" || x.name === "London");
  check("bootstrap: London is listed (the claim client matches market=London by name or id)", !!m && m.id === "london" && m.name === "London" && m.country === "United Kingdom", JSON.stringify(m && { id: m.id, country: m.country }));
  check("bootstrap: London ships its city list to the claim city select", !!m && m.cities.includes("Croydon") && m.cities.includes("London"));
  // TEST_MODE reads every market live in bootstrap (the test-only
  // override), so the founding-state proof is the stored flag
  // record itself: no live flag exists for London, which is what
  // production reads - London starts NOT live, founding roster
  // forming, like every unlaunched market.
  const cfg = (JSON.parse(fs.readFileSync(DB, "utf8")) || {})["config:markets"];
  check("flags: no live flag is stored for London (it starts NOT live, founding framing)", !cfg || !cfg.flags || !cfg.flags["London"], JSON.stringify(cfg && cfg.flags));
  check("bootstrap: still 38 markets total", (boot.markets || []).length === 38, String((boot.markets || []).length));
}

async function claimRegister(email, handle, market, extra = {}) {
  const c = new Client(BASE);
  const r = await c.req("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email, password: "b86-pass-1234", market,
    handle, primaryPlatform: "instagram", agreedTerms: true, ...extra,
  });
  return { c, r };
}

console.log("== Live: a London claim, gate to approval ==");
const lon = await claimRegister("amara@b86.dev", "b86amara", "London", { signupSource: "email" });
check("L1: London claim registers (201, pending)", lon.r.status === 201 && lon.r.data.user.status === "pending", `status=${lon.r.status}`);
check("L1: record carries market London", lon.r.data.user.market === "London", lon.r.data.user.market);
{
  const rec = storedUser(DB, lon.r.data.user.id);
  check("L1: stored country is the market's (United Kingdom, never a US default)", !!rec && rec.country === "United Kingdom", rec && rec.country);
  check("L1: attribution survived (signupSource email, signupPath quick_claim)", !!rec && rec.signupSource === "email" && rec.creator.signupPath === "quick_claim", JSON.stringify(rec && { s: rec.signupSource, p: rec.creator.signupPath }));
}
{
  const p = await lon.c.req("PATCH", "/api/me/profile", { name: "Amara Osei", city: "Croydon", categories: ["Food & Drink"], localAudiencePct: 70, audienceStack: { instagram: 5000, tiktok: 1200 } });
  check("L1: facts PATCH accepted (city from London's own list)", p.status === 200, `status=${p.status}`);
  const me = await lon.c.req("GET", "/api/auth/me");
  const u = me.data.user;
  check("L1: profile complete under the Build -65 gate (500 minimum identical)", u.profileCompletion && u.profileCompletion.complete === true && u.creator.totalAudience === 6200, JSON.stringify(u.profileCompletion && u.profileCompletion.missing));
  const apps1 = await admin.req("GET", "/api/admin/applications");
  const row1 = (apps1.data.pending || []).find((x) => x.id === lon.r.data.user.id);
  check("L1: pending London creator holds queue position 1 in London (admin queue)", !!row1 && row1.queuePosition === 1, JSON.stringify(row1 && row1.queuePosition));
}
// A second London creator queues behind the first while both
// are pending (the queue is the market's pending order).
const lon2 = await claimRegister("theo@b86.dev", "b86theo", "London", { signupSource: "dm" });
await lon2.c.req("PATCH", "/api/me/profile", { city: "London", categories: ["Music"], localAudiencePct: 55, audienceStack: { instagram: 2400 } });
{
  const apps2 = await admin.req("GET", "/api/admin/applications");
  const row2 = (apps2.data.pending || []).find((x) => x.id === lon2.r.data.user.id);
  check("L2: second London creator holds queue position 2 (registration order within the market)", !!row2 && row2.queuePosition === 2, JSON.stringify(row2 && row2.queuePosition));
  const ap = await admin.req("POST", "/api/admin/review", { userId: lon.r.data.user.id, decision: "approve" });
  check("L1: approval lands (200, approved)", ap.status === 200 && ap.data.user.status === "approved", `status=${ap.status}`);
}
// Admin market board carries London with its own counts.
{
  const board = await admin.req("GET", "/api/admin/markets");
  const row = (board.data.markets || []).find((m) => m.name === "London");
  check("board: Admin market board includes London with its own counts", !!row && row.creatorsApproved === 1 && row.creatorsPending === 1 && row.live === true, JSON.stringify(row));
  check("board: London's label + country ride along (London, United Kingdom)", !!row && row.label === "London, United Kingdom" && row.country === "United Kingdom", JSON.stringify(row && { label: row.label, country: row.country }));
}
// Multi-market both directions.
{
  const p = await lon.c.req("PATCH", "/api/me/profile", { audienceMarkets: [{ market: "Nashville", pct: 12 }] });
  check("MM1: London home creator can report a Nashville share", p.status === 200, `status=${p.status}`);
  const pub = await (await fetch(`${BASE}/api/c/b86amara`)).json();
  const listed = (pub.profile && pub.profile.listedMarkets) || pub.listedMarkets || [];
  check("MM1: public profile lists London (home) + Nashville (12%)", listed.some((e) => e.market === "London" && e.home) && listed.some((e) => e.market === "Nashville" && e.pct === 12), JSON.stringify(listed));
}
const nash = await claimRegister("nina@b86.dev", "b86nina", "Nashville", { signupSource: "email" });
await nash.c.req("PATCH", "/api/me/profile", { name: "Nina Ray", city: "Nashville", categories: ["Lifestyle"], localAudiencePct: 60, audienceStack: { instagram: 9000 }, audienceMarkets: [{ market: "London", pct: 20 }] });
{
  const ap = await admin.req("POST", "/api/admin/review", { userId: nash.r.data.user.id, decision: "approve" });
  check("MM2: Nashville control claim approves", ap.status === 200 && ap.data.user.status === "approved", `status=${ap.status}`);
  const pub = await (await fetch(`${BASE}/api/c/b86nina`)).json();
  const listed = (pub.profile && pub.profile.listedMarkets) || pub.listedMarkets || [];
  check("MM2: Nashville creator's public profile carries the London multi-market chip (20%)", listed.some((e) => e.market === "London" && e.pct === 20) && listed.some((e) => e.market === "Nashville" && e.home), JSON.stringify(listed));
}
console.log("== Live: the US claim sequence is unchanged ==");
{
  const rec = storedUser(DB, nash.r.data.user.id);
  check("US: Nashville record unchanged in shape (country United States, attribution email, quick_claim)", !!rec && rec.country === "United States" && rec.signupSource === "email" && rec.creator.signupPath === "quick_claim", JSON.stringify(rec && { c: rec.country, s: rec.signupSource }));
  const me = await nash.c.req("GET", "/api/auth/me");
  check("US: Nashville facts complete under the same gate", me.data.user.profileCompletion && me.data.user.profileCompletion.complete === true && me.data.user.creator.totalAudience === 9000);
  const board = await admin.req("GET", "/api/admin/markets");
  const row = (board.data.markets || []).find((m) => m.name === "Nashville");
  check("US: Nashville board row counts only its own creators", !!row && row.creatorsApproved === 1 && row.creatorsPending === 0, JSON.stringify(row));
}
server.kill("SIGTERM");

console.log(`\nverify-build86: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("failures:", failures.join(" | ")); process.exit(1); }
