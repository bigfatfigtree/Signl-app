#!/usr/bin/env node
// verify-build192.mjs — Build -192: PL-37, Preview As Creator
// lands in the wrong shell (Jeff's ruling 2026-11-17, superseding
// his 2026-11-10 no-fix).
//   - The old target pick (earliest approved tester) could land
//     on a record holding a Biz Dev seat; the seat makes the Sell
//     shell its default, so the preview opened a rep shell.
//   - The target is now a DEDICATED creator-only record: no Biz
//     Dev seat (stamp or seat record), no linked second side, not
//     a demo-showcase prop. Resolution lives in one place
//     (previewTargets126 + config:previewTargets): designated
//     record first, then a previewDedicated record, then the
//     earliest qualifying tester. Seated/linked testers are
//     disqualified everywhere, including the direct view door.
//   - Admin can create or designate the dedicated record from the
//     Admin home surface (POST /admin/preview-targets/creator).
//   - The dedicated record is a tester: it cannot leak into
//     platform totals, market counts, discovery, or Maggie's
//     numbers for real users.
// Run: node scripts/verify-build192.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = path.join(os.tmpdir(), `signl-verify-build192-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = ["verify192", "admin", "pw"].join("-");
const PW = ["verify192", "user", "pw"].join("-");
process.env.ADMIN_PASSWORD = ADMIN_PW;
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const auth = require("../netlify/functions/lib/auth.js");
const { handler } = require("../netlify/functions/api.js");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log("  ok  " + name); }
  else { failed += 1; failures.push(name + (extra ? " :: " + extra : "")); console.log("  FAIL  " + name + (extra ? " :: " + extra : "")); }
}
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({ httpMethod: method, path: url.pathname, headers, queryStringParameters: Object.fromEntries(url.searchParams.entries()), body: body === undefined ? null : JSON.stringify(body), isBase64Encoded: false });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let parsed = null;
    try { parsed = JSON.parse(res.body || "null"); } catch (e) { /* raw */ }
    return { status: res.statusCode, data: parsed, raw: res.body || "" };
  };
}
const seg = (src, a, b) => { const i = src.indexOf(a); if (i < 0) return ""; const j = b ? src.indexOf(b, i + a.length) : -1; return src.slice(i, j > i ? j : undefined); };

// ---------------- source pins ----------------
console.log("== source pins ==");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
check("stamp: BUILD_ID is 2026.11.17-192", buildJs.includes('exports.BUILD_ID = "2026.11.17-192"'));
check("stamp: shell carries 2026.11.17-192 x5", (indexHtml.match(/2026\.11\.17-192/g) || []).length === 5);
check("target: resolution lives in one place (previewTargets126 + the 192 qualifier)", routerJs.includes("function previewTargets126(users)") && routerJs.includes("function previewCreatorOnly192"));
check("target: the designated record is one stored config record", routerJs.includes('PREVIEW_TARGETS_KEY_192 = "config:previewTargets"'));
check("target: a seat disqualifies (stamp and seat record)", seg(routerJs, "function previewCreatorOnly192", "function previewTargets126").includes("bizdevSeat") && routerJs.includes("previewSeatedIds192"));
check("target: a linked side disqualifies", seg(routerJs, "function previewCreatorOnly192", "function previewTargets126").includes("linkedAccountId"));
check("target: no scattered literals (the create path is the one builder)", (routerJs.match(/previewDedicated: true/g) || []).length === 1 && (routerJs.match(/preview-creator@magpielocal\.com/g) || []).length === 1);
check("view door: the same creator-only rule is enforced on direct view", seg(routerJs, 'seg[1] === "creators" && seg.length === 4 && seg[3] === "view"', 'seg[1] === "partners" && seg.length === 4').includes("bdevrep:"));
check("client: Admin home carries the setup action and the honest no-target note", appJs.includes("adminCreatePreviewCreator192") && appJs.includes("Set up creator preview") && appJs.includes("dedicated test creator with no Biz Dev seat"));

// ---------------- fixtures ----------------
console.log("== fixtures ==");
async function user(id, role, name, email, extra = {}) {
  const { salt, hash } = auth.hashPassword(PW);
  const rec = { id, role, name, email, passwordSalt: salt, passwordHash: hash, status: "approved", createdAt: "2026-11-10T00:00:00.000Z", ...extra };
  await store.set(`user:${id}`, rec);
  await store.set(`email:${email}`, { userId: id });
  return rec;
}
await user("v192-admin", "admin", "Jeff Rimmer", "jeff@joinsignl.com");
{ const h = auth.hashPassword(ADMIN_PW); const a = await store.get("user:v192-admin"); a.passwordSalt = h.salt; a.passwordHash = h.hash; await store.set("user:v192-admin", a); }
function creatorExtra(complete) {
  return { market: "Nashville", city: "Nashville", creator: { handle: "x", categories: ["Food & Drink"], localAudiencePct: 55, audienceStack: { instagram: 6000 }, followerCount: 6000, totalAudience: 6000, hasPhoto: false, bio: "", bestWork: [], publicPage: true, profileComplete: complete } };
}
// The Tony shape: the EARLIEST approved tester, holding an
// active Biz Dev seat (stamp on the record + a seat record).
{ const t = await user("v192-tony", "creator", "Tony Seat", "tony192@fixtures.dev", { ...creatorExtra(true), tester: true, createdAt: "2026-01-01T00:00:00.000Z", bizdevSeat: { active: true, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-TONY" } }); t.creator.handle = "tonyseat"; await store.set("user:v192-tony", t); }
await store.set("bdevrep:v192-tony", { userId: "v192-tony", repCode: "HR-TONY", marketId: "hampton-roads", marketName: "Hampton Roads", active: true });
// A linked tester: creator side with a linked business side.
{ const l = await user("v192-linked", "creator", "Linked Tester", "linked192@fixtures.dev", { ...creatorExtra(true), tester: true, createdAt: "2026-02-01T00:00:00.000Z", linkedAccountId: "v192-tony" }); l.creator.handle = "linkedtester"; await store.set("user:v192-linked", l); }
// One real creator (the only platform member in this fixture).
{ const r = await user("v192-real", "creator", "Real Creator", "real192@fixtures.dev", creatorExtra(true)); r.creator.handle = "realcreator"; await store.set("user:v192-real", r); }
// The demo partner (the other preview role, unchanged).
await user("v192-pdemo", "partner", "Demo Media Group", "pdemo192@fixtures.dev", { market: "Nashville", partner: { name: "Demo Media Group", orgName: "Demo Media Group", demo: true, status: "active" } });

const admin = makeClient(); await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: ADMIN_PW });

// ---------------- resolution: seated/linked never resolve ----------------
console.log("== resolution ==");
{
  const t = await admin("GET", "/api/admin/preview-targets");
  check("no qualifying record: the creator target is null, never the seated tester", t.status === 200 && t.data.creator === null, JSON.stringify(t.data).slice(0, 240));
  check("the partner target is unchanged (the demo partner)", !!t.data.partner && t.data.partner.id === "v192-pdemo", JSON.stringify(t.data.partner || {}));
  const viewTony = await admin("POST", "/api/admin/creators/v192-tony/view", {});
  check("the direct view door refuses the seated tester (403, plain reason)", viewTony.status === 403 && /another role/.test(viewTony.data.error || ""), `${viewTony.status} ${JSON.stringify(viewTony.data).slice(0, 200)}`);
  const viewLinked = await admin("POST", "/api/admin/creators/v192-linked/view", {});
  check("the direct view door refuses the linked tester", viewLinked.status === 403, String(viewLinked.status));
  const desTony = await admin("POST", "/api/admin/preview-targets/creator", { userId: "v192-tony" });
  check("designating the seated tester is refused with the rule stated", desTony.status === 400 && /no Biz Dev seat/.test(desTony.data.error || ""), JSON.stringify(desTony.data).slice(0, 200));
}

// ---------------- create the dedicated record ----------------
console.log("== create + view ==");
let dedicatedId = null;
{
  const c = await admin("POST", "/api/admin/preview-targets/creator", { create: true });
  check("Admin creates the dedicated preview creator in one call", c.status === 201 && !!c.data.creator && c.data.designated === true, `${c.status} ${JSON.stringify(c.data).slice(0, 200)}`);
  dedicatedId = c.data.creator && c.data.creator.id;
  const rec = dedicatedId ? await store.get(`user:${dedicatedId}`) : null;
  check("the dedicated record is creator-only: tester + dedicated flags, no seat, no link, no other side", !!rec && rec.role === "creator" && rec.tester === true && rec.previewDedicated === true && !rec.bizdevSeat && !rec.linkedAccountId && !rec.business && !rec.partner, JSON.stringify(rec || {}).slice(0, 240));
  const seatRec = dedicatedId ? await store.get(`bdevrep:${dedicatedId}`) : { x: 1 };
  check("the dedicated record has no Biz Dev seat record", seatRec === null);
  const t = await admin("GET", "/api/admin/preview-targets");
  check("targets now resolve to the dedicated record", !!t.data.creator && t.data.creator.id === dedicatedId && t.data.creator.dedicated === true, JSON.stringify(t.data).slice(0, 240));
  const view = await admin("POST", `/api/admin/creators/${dedicatedId}/view`, {});
  check("the creator preview opens on the dedicated record", view.status === 200 && view.data.ok === true, `${view.status} ${JSON.stringify(view.data).slice(0, 160)}`);
  const me = await admin("GET", "/api/auth/me");
  check("inside the view: the session is the dedicated creator, read-only, with no seat and no linked side", !!me.data.user && me.data.user.id === dedicatedId && me.data.user.viewAs && me.data.user.viewAs.readOnly === true && !me.data.user.bizdevSeat && !me.data.user.linkedSide, JSON.stringify(me.data.user || {}).slice(0, 300));
  const exit = await admin("POST", "/api/auth/exit-view", {});
  check("exit view hands the admin session back", exit.status === 200 && exit.data.user && exit.data.user.role === "admin");
  const again = await admin("POST", "/api/admin/preview-targets/creator", { create: true });
  check("creating again reuses the same dedicated record (no duplicates)", again.status === 200 && again.data.creator.id === dedicatedId && again.data.alreadyExisted === true, JSON.stringify(again.data).slice(0, 200));
}

// ---------------- designate a qualifying tester ----------------
console.log("== designate ==");
{
  { const a = await user("v192-alt", "creator", "Alt Tester", "alt192@fixtures.dev", { ...creatorExtra(true), tester: true, createdAt: "2026-03-01T00:00:00.000Z" }); a.creator.handle = "alttester"; await store.set("user:v192-alt", a); }
  const d = await admin("POST", "/api/admin/preview-targets/creator", { userId: "v192-alt" });
  check("Admin can designate another qualifying creator-only tester", d.status === 200 && d.data.creator.id === "v192-alt", JSON.stringify(d.data).slice(0, 160));
  const t = await admin("GET", "/api/admin/preview-targets");
  check("the designation wins resolution", !!t.data.creator && t.data.creator.id === "v192-alt", JSON.stringify(t.data).slice(0, 200));
  const back = await admin("POST", "/api/admin/preview-targets/creator", { create: true });
  check("the setup action re-designates the dedicated record", back.status === 200 && back.data.creator.id === dedicatedId, JSON.stringify(back.data).slice(0, 160));
}

// ---------------- leak checks ----------------
console.log("== leak checks ==");
{
  const totals = await admin("GET", "/api/admin/platform-totals");
  check("platform totals count only the one real creator (testers, seated or dedicated, never count)", totals.status === 200 && totals.data.creatorsSignedUp === 1, JSON.stringify(totals.data).slice(0, 240));
  const mk = await admin("GET", "/api/admin/markets");
  const nash = (mk.data.markets || []).find((m) => m.name === "Nashville");
  check("Admin Markets Nashville approved count is the real creator only", !!nash && nash.creatorsApproved === 1, JSON.stringify(nash || {}).slice(0, 240));
  const ask = await admin("POST", "/api/sig/ask", { q: "How many creators have signed up on the platform and how many followers do they have in total?", history: [] });
  check("Maggie's platform answer counts the real creator only (6,000 followers, not the testers' stacks)", ask.status === 200 && /1 creator/.test(ask.data.text || "") && (ask.data.text || "").includes("6,000"), String(ask.data.text || "").slice(0, 240));
}

// ---------------- other roles unchanged ----------------
console.log("== other preview roles ==");
{
  const pv = await admin("POST", "/api/admin/partners/v192-pdemo/view", {});
  check("the partner preview still opens on the demo partner", pv.status === 200 && pv.data.ok === true, `${pv.status}`);
  const me = await admin("GET", "/api/auth/me");
  check("inside the partner view: session is the demo partner", !!me.data.user && me.data.user.id === "v192-pdemo" && !!me.data.user.viewAs, JSON.stringify(me.data.user && me.data.user.viewAs));
  const exit = await admin("POST", "/api/auth/exit-view", {});
  check("exit view returns to admin", exit.status === 200 && exit.data.user.role === "admin");
}

console.log(`\nBUILD192 VERIFY: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
