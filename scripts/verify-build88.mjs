// Build -88 verification: London typed-area list widening + the
// area picker in quick claim and the full join form.
//   - London's typed city list is the full neighbourhood +
//     surrounding-towns set (~90-130 entries): every race
//     district and component, the Tier 2/3 areas, the other
//     inner areas, and the surrounding towns already listed.
//     Typed entries file to market london via resolveTypedCity.
//   - The pinned resolver outcomes do not move: bare "London"
//     stays the Columbus/London tie, "London, OH" -> Columbus,
//     the UK hint picks London, Croydon files to London.
//   - Claim + full join with market=London store the picked
//     area on the creator record (creator.area, mirrored to
//     creator.neighborhood — the field Admin prints as "Area:");
//     the creator's home city stays London. Admin shows the
//     area (applications payload + the London market board's
//     areas). A Nashville control claim is unchanged.
// Run: node scripts/verify-build88.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { MARKETS, resolveTypedCity } = require(path.join(root, "netlify", "functions", "lib", "markets.js"));
const PORT = 8962;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b88.dev";
const ADMIN_PASSWORD = "b88-admin-pass";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 220) : ""}`); }
}

console.log("== Static: the widened London typed-area list ==");
const london = MARKETS.find((m) => m.id === "london");
check("London list is comprehensive (90-140 entries)", !!london && london.cities.length >= 90 && london.cities.length <= 140, london && String(london.cities.length));
check("London list has no duplicates", !!london && new Set(london.cities).size === london.cities.length);
const MUST = ["Shoreditch", "Spitalfields", "Borough", "Bankside", "Brixton", "Dalston", "Hackney Central", "Stoke Newington", "Angel", "Islington",
  "Peckham", "Camden Town", "Tooting", "Greenwich", "Clapham", "Soho", "Covent Garden", "Notting Hill", "Fitzrovia", "Marylebone", "Walthamstow",
  "Hackney", "Whitechapel", "Bethnal Green", "Hoxton", "Clerkenwell", "Bloomsbury", "Westminster", "Kensington", "Chelsea", "Hammersmith", "Fulham",
  "Battersea", "Wandsworth", "Putney", "Wimbledon", "Richmond upon Thames", "Hampstead", "Highgate", "Kilburn", "Willesden", "Acton", "Chiswick",
  "Dulwich", "Herne Hill", "Streatham", "Balham", "Lewisham", "Deptford", "Stratford", "Isle of Dogs", "Tottenham", "Haringey", "Ealing", "Barnes",
  "Croydon", "Wembley", "Watford", "Slough", "Kingston upon Thames"];
{
  const missing = MUST.filter((a) => !london.cities.includes(a));
  check("London list carries every named race/Tier/inner/surrounding area", missing.length === 0, missing.join(","));
}
check("roster is 41 markets (38 when -88 shipped; +3 NZ markets in Build -117 — areas inside a market are never new markets)", MARKETS.length === 41, String(MARKETS.length));

console.log("== Resolver: typed areas file to London; the pins do not move ==");
for (const area of ["Hackney", "Brixton", "Peckham", "Soho", "Shoreditch", "Dalston", "Borough", "Angel", "Stoke Newington", "Camden Town"]) {
  const r = resolveTypedCity(area, {});
  check(`resolver: typed "${area}" files unique to London`, r.status === "unique" && r.market === "London", JSON.stringify(r));
}
{
  const bare = resolveTypedCity("London", {});
  check("pin: bare 'London' stays the Columbus/London tie", bare.status === "ambiguous" && bare.markets.includes("Columbus") && bare.markets.includes("London"), JSON.stringify(bare));
  const oh = resolveTypedCity("London, OH", {});
  check("pin: 'London, OH' -> Columbus", oh.status === "unique" && oh.market === "Columbus", JSON.stringify(oh));
  const uk = resolveTypedCity("London", { country: "United Kingdom" });
  check("pin: 'London' + United Kingdom -> London market", uk.status === "unique" && uk.market === "London", JSON.stringify(uk));
  const croy = resolveTypedCity("Croydon", {});
  check("pin: Croydon files to London", croy.status === "unique" && croy.market === "London", JSON.stringify(croy));
  const camBare = resolveTypedCity("Camden", {});
  check("pin: bare 'Camden' stays Philadelphia's (Camden NJ predates London's list; London's area is 'Camden Town')", camBare.status === "unique" && camBare.market === "Philadelphia", JSON.stringify(camBare));
  const camUk = resolveTypedCity("Camden", { country: "United Kingdom" });
  check("resolver: 'Camden' + United Kingdom -> none (never misfiling a UK-hinted Camden into a US market)", camUk.status === "none", JSON.stringify(camUk));
  const camTown = resolveTypedCity("Camden Town", {});
  check("resolver: 'Camden Town' files unique to London", camTown.status === "unique" && camTown.market === "London", JSON.stringify(camTown));
}

console.log("== Static: the area picker surfaces ==");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
check("claim facts screen carries the London area picker (c85-area + searchable c85-area-search)", appJs.includes('id="c85-area"') && appJs.includes('id="c85-area-search"') && appJs.includes('id="c85-area-wrap"'));
check("full join form carries the London area picker (jc-area + jc-area-wrap)", appJs.includes('id="jc-area"') && appJs.includes('id="jc-area-wrap"'));
check("picker is fed by the typed list (areaOptions reads the market's cities)", appJs.includes("function areaOptions") && appJs.includes("m.cities"));
check("pickers toggle on the picked market being London only", appJs.includes('m.value === "London"') && appJs.includes("areaOptions(\"London\""));
check("claim sends the picked area (register + facts PATCH)", appJs.includes("area: d.area || undefined") && appJs.includes("patch.area = d.area"));
check("join sends the picked area", appJs.includes('area: marketVal === "London"'));

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b88-"));
const DB = path.join(tmp, "db.json");
const server = startServer(DB, PORT);
await waitUp(BASE);
const admin = new Client(BASE);
{
  const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", r.status === 200 && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
}
{
  const boot = await (await fetch(`${BASE}/api/bootstrap`)).json();
  const m = (boot.markets || []).find((x) => x.id === "london");
  check("bootstrap: London ships the widened typed list to the picker (Hackney + Brixton + Peckham in cities)", !!m && m.cities.includes("Hackney") && m.cities.includes("Brixton") && m.cities.includes("Peckham") && m.cities.length >= 90, m && String(m.cities.length));
}

console.log("== Live: a London claim stores the picked area; home city stays London ==");
const claim = new Client(BASE);
const claimReg = await claim.req("POST", "/api/auth/register", {
  role: "creator", quickClaim: true, email: "hackney@b88.dev", password: "b88-pass-1234", market: "London",
  handle: "b88hackney", primaryPlatform: "instagram", agreedTerms: true, area: "Hackney",
});
check("claim registers (201)", claimReg.status === 201, `status=${claimReg.status}`);
{
  const rec = storedUser(DB, claimReg.data.user.id);
  check("claim record: area stored (creator.area + creator.neighborhood both 'Hackney')", !!rec && rec.creator.area === "Hackney" && rec.creator.neighborhood === "Hackney", JSON.stringify(rec && { a: rec.creator.area, n: rec.creator.neighborhood }));
  const p = await claim.req("PATCH", "/api/me/profile", { name: "Hackney Creator", city: "London", categories: ["Food & Drink"], localAudiencePct: 65, audienceStack: { instagram: 6000 } });
  check("claim facts PATCH accepted (city London)", p.status === 200, `status=${p.status}`);
  const rec2 = storedUser(DB, claimReg.data.user.id);
  check("after facts: home city is London, market London, area still Hackney", !!rec2 && rec2.city === "London" && rec2.market === "London" && rec2.creator.area === "Hackney", JSON.stringify(rec2 && { city: rec2.city, market: rec2.market, area: rec2.creator.area }));
  check("register response payload carries the area", claimReg.data.user.creator && (claimReg.data.user.creator.area === "Hackney" || claimReg.data.user.creator.neighborhood === "Hackney"), JSON.stringify(claimReg.data.user.creator && { a: claimReg.data.user.creator.area, n: claimReg.data.user.creator.neighborhood }));
}

console.log("== Live: a London full join stores the picked area ==");
const join = new Client(BASE);
const joinReg = await join.req("POST", "/api/auth/register", {
  role: "creator", email: "brixton@b88.dev", password: "b88-pass-1234", name: "Brixton Creator", market: "London",
  city: "London", area: "Brixton", neighborhood: "Brixton", handle: "b88brixton", primaryPlatform: "instagram",
  followerCount: 8000, categories: ["Music"], localAudiencePct: 70, agreedTerms: true,
});
check("full join registers (201)", joinReg.status === 201, `status=${joinReg.status} ${JSON.stringify(joinReg.data).slice(0, 160)}`);
{
  const rec = storedUser(DB, joinReg.data.user.id);
  check("join record: city London, area Brixton (area + neighborhood)", !!rec && rec.city === "London" && rec.creator.area === "Brixton" && rec.creator.neighborhood === "Brixton", JSON.stringify(rec && { city: rec.city, a: rec.creator.area, n: rec.creator.neighborhood }));
}

console.log("== Live: Admin shows the area ==");
{
  const apps = await admin.req("GET", "/api/admin/applications");
  const row = (apps.data.pending || []).find((x) => x.id === claimReg.data.user.id) || (apps.data.decided || []).find((x) => x.id === claimReg.data.user.id);
  check("Admin applications payload carries the claim creator's area", !!row && row.creator && (row.creator.area === "Hackney" || row.creator.neighborhood === "Hackney"), JSON.stringify(row && row.creator && { a: row.creator.area, n: row.creator.neighborhood }));
  const board = await admin.req("GET", "/api/admin/markets");
  const lrow = (board.data.markets || []).find((m) => m.name === "London");
  check("Admin London board carries area counts (Hackney 1, Brixton 1)", !!lrow && Array.isArray(lrow.areas) && lrow.areas.some((a) => a.area === "Hackney" && a.creators === 1) && lrow.areas.some((a) => a.area === "Brixton" && a.creators === 1), JSON.stringify(lrow && lrow.areas));
}

console.log("== Live: Nashville control claim is unchanged ==");
const nash = new Client(BASE);
const nashReg = await nash.req("POST", "/api/auth/register", {
  role: "creator", quickClaim: true, email: "nash@b88.dev", password: "b88-pass-1234", market: "Nashville",
  handle: "b88nash", primaryPlatform: "instagram", agreedTerms: true,
});
check("Nashville claim registers (201)", nashReg.status === 201, `status=${nashReg.status}`);
{
  const p = await nash.req("PATCH", "/api/me/profile", { name: "Nash Creator", city: "Nashville", categories: ["Lifestyle"], localAudiencePct: 60, audienceStack: { instagram: 9000 } });
  check("Nashville facts PATCH accepted", p.status === 200, `status=${p.status}`);
  const rec = storedUser(DB, nashReg.data.user.id);
  check("Nashville record unchanged: city Nashville, no area set", !!rec && rec.city === "Nashville" && rec.market === "Nashville" && !rec.creator.area && !rec.creator.neighborhood, JSON.stringify(rec && { city: rec.city, a: rec.creator.area, n: rec.creator.neighborhood }));
}
server.kill("SIGTERM");

console.log(`\nverify-build88: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("failures:", failures.join(" | ")); process.exit(1); }
