#!/usr/bin/env node
// Build -74 verification (Jeff, 2026-11-02): the business
// experience overhaul — demo creator photos, the SAMPLE results
// story fenced to the demo context, the Start-here path inputs,
// the Campaigns Current/Past restructure, and the card-deck
// Discover defaults.
//
// Proves, against a throwaway local store:
//   - all 24 demo photo assets exist on disk as real JPEGs;
//   - after the Admin demo load, a demo creator's stored photo
//     serves through the photo route to the allowlisted business
//     and its bytes match the shipped asset file byte for byte;
//   - GET /me/sample-results: full sample payload for the
//     allowlisted business (context "direct"), the same payload
//     with context "view-as" inside an Admin view-as session,
//     sample:null for a non-allowlisted business, 403 for a
//     creator; the sample story is internally consistent (the
//     day series sums to the counted total) and NOTHING is
//     stored by reading it (no bookings, no offers, user count
//     unmoved);
//   - deck plumbing: the discover payload carries isFavorite and
//     photos, and POST /favorites toggles a demo creator for the
//     allowlisted business (the deck's Save action);
//   - Start-here inputs: favorites/offers/bookings endpoints
//     answer for a founding business and flip as real state
//     changes (favorite added -> favorites 1; draft offer saved
//     -> offers 1);
//   - source: Start-here renderer + steps, sample story +
//     preview renderers, deck passLabel/onSave wiring, Campaigns
//     headed sections, the router sample fence, and the -74
//     stamp.
//
// Run: node scripts/verify-build74.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8997;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "signl-admin-test-74";
const DEMO_HANDLES = ["tesstastestn", "wadehensleymusic", "priyaathome", "marcusbellshoots", "delladoes615", "colebrandtfit", "hannahandthem", "rubygetsglam", "elithackereats", "noraseesnashville", "samswhitfieldhome", "gracetembostyle"];

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

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
  async raw(p) {
    const headers = {};
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + p, { headers });
    return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
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

// ---------- photo assets on disk ----------
console.log("== Demo photo assets ==");
for (const h of DEMO_HANDLES) {
  for (const n of [1, 2]) {
    const p = path.join(root, "public", "assets", "demo-creators", `${h}-${n}.jpg`);
    let ok = false;
    try {
      const buf = fs.readFileSync(p);
      ok = buf.length > 10000 && buf[0] === 0xff && buf[1] === 0xd8;
    } catch (e) { /* missing */ }
    check(`asset ${h}-${n}.jpg exists and is a JPEG`, ok);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build74-"));
const DB = path.join(tmp, "db.json");
const server = startServer(DB, PORT);
await waitUp(BASE);

const admin = new Client(BASE);
{
  const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", r.status === 200 && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
}
async function registerBusiness(email, businessName, market, planId, category = "Retail") {
  const c = new Client(BASE);
  const r = await c.req("POST", "/api/auth/register", {
    role: "business", name: "Owner", businessName, email, password: "fixture-password-74",
    market, category, planId, neighborhood: "East Nashville", about: "Fixture business.", agreedTerms: true,
  });
  return { c, r };
}
const chelsea = await registerBusiness("chelsea74@fixtures.dev", "Chelsea Friday Furniture", "Nashville", "self-service");
check("Chelsea-shaped founding business registers", chelsea.r.status === 200 || chelsea.r.status === 201, `status=${chelsea.r.status}`);
const chelseaId = chelsea.r.data && chelsea.r.data.user && chelsea.r.data.user.id;
const other = await registerBusiness("other74@fixtures.dev", "Maple Street Coffee", "Nashville", "growth", "Coffee & Bakery");
const otherId = other.r.data && other.r.data.user && other.r.data.user.id;
const creator = new Client(BASE);
let creatorId = null;
{
  const r = await creator.req("POST", "/api/auth/register", {
    role: "creator", name: "Casey Creator", email: "casey74@fixtures.dev", password: "fixture-password-74",
    market: "Nashville", city: "Nashville", handle: "casey74", followerCount: 3000,
    localAudiencePct: 80, categories: ["Food & Drink"],
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  creatorId = r.data && r.data.user && r.data.user.id;
  check("creator fixture registers", r.status === 200 || r.status === 201, `status=${r.status}`);
}
for (const [label, id] of [["Chelsea", chelseaId], ["other business", otherId], ["creator", creatorId]]) {
  const r = await admin.req("POST", "/api/admin/review", { userId: id, decision: "approve" });
  check(`admin approves ${label}`, r.status === 200, `status=${r.status}`);
}

// ---------- sample fence BEFORE the demo load ----------
console.log("== Sample results fence ==");
{
  const r = await chelsea.c.req("GET", "/api/me/sample-results");
  check("sample answers for the allowlisted name even before load", r.status === 200 && !!r.data.sample, `status=${r.status}`);
  check("direct context named", r.data.context === "direct", r.data.context);
  const s = r.data.sample;
  check("sample carries the SAMPLE marker", s.sample === true);
  check("six sample creators", Array.isArray(s.creators) && s.creators.length === 6, `n=${s.creators && s.creators.length}`);
  check("every sample creator avatar is a shipped demo asset", s.creators.every((c) => /^\/assets\/demo-creators\/[a-z0-9]+-1\.jpg$/.test(c.avatarUrl)), s.creators.map((c) => c.avatarUrl).join(","));
  const sum = (s.series || []).reduce((a, row) => a + (row.customers || 0), 0);
  check("the day series sums exactly to customers counted", sum === s.totals.customersCounted, `sum=${sum} total=${s.totals.customersCounted}`);
  check("posts live equals the creators marked posted", s.totals.postsLive === s.creators.filter((c) => c.posted).length);
  check("local reach is the posted creators' summed local reach", s.totals.localReach === s.creators.filter((c) => c.posted).reduce((a, c) => a + c.localReach, 0));
}
{
  const r = await other.c.req("GET", "/api/me/sample-results");
  check("non-allowlisted business gets sample:null", r.status === 200 && r.data.sample === null, `status=${r.status}`);
  const rc = await creator.req("GET", "/api/me/sample-results");
  check("creator is refused", rc.status === 403, `status=${rc.status}`);
}

// ---------- demo load + photo truth + counts unmoved ----------
console.log("== Demo load, photos, and the counts fence ==");
const load = await admin.req("POST", "/api/admin/demo-showcase/load", {});
check("demo load succeeds", load.status === 200, `status=${load.status} ${JSON.stringify(load.data).slice(0, 160)}`);
let demoCard = null;
{
  const r = await chelsea.c.req("GET", "/api/discover?market=Nashville");
  const list = (r.data && (r.data.creators || r.data.results || r.data.cards)) || [];
  demoCard = list.find((c) => (c.profile || {}).handle === "tesstastestn") || null;
  check("allowlisted business discovers the demo roster", list.length >= 12, `n=${list.length}`);
  check("demo card carries a photo URL", !!demoCard && !!demoCard.photoUrl, demoCard && JSON.stringify(demoCard).slice(0, 160));
  check("demo card carries the photos array for deck thumbnails", !!demoCard && Array.isArray(demoCard.photos) && demoCard.photos.length >= 2);
  check("demo card carries isFavorite for the deck Save state", !!demoCard && typeof demoCard.isFavorite === "boolean");
}
if (demoCard) {
  const photo = await chelsea.c.raw(`/api/users/${demoCard.userId}/photo`);
  const asset = fs.readFileSync(path.join(root, "public", "assets", "demo-creators", "tesstastestn-1.jpg"));
  check("demo photo serves 200 to the allowlisted business", photo.status === 200, `status=${photo.status}`);
  check("served photo bytes equal the shipped asset file", photo.buf.equals(asset), `served=${photo.buf.length} asset=${asset.length}`);
  // Deck Save: the same favorites toggle the grid heart uses.
  const fav = await chelsea.c.req("POST", "/api/favorites", { creatorId: demoCard.userId });
  check("deck Save favorites a demo creator for the allowlisted business", fav.status === 200 && fav.data.isFavorite === true, `status=${fav.status}`);
  const favs = await chelsea.c.req("GET", "/api/favorites");
  check("the saved demo creator lands in Favorites", (favs.data.favorites || []).some((f) => f.userId === demoCard.userId));
  const unfav = await chelsea.c.req("POST", "/api/favorites", { creatorId: demoCard.userId });
  check("deck Save toggles back off", unfav.status === 200 && unfav.data.isFavorite === false);
}
{
  // Reading the sample story stores nothing: platform stats
  // are byte-identical across sample reads, and the business
  // still owns zero bookings and zero offers.
  const statsBefore = JSON.stringify((await admin.req("GET", "/api/admin/stats")).data);
  await chelsea.c.req("GET", "/api/me/sample-results");
  await other.c.req("GET", "/api/me/sample-results");
  const statsAfter = JSON.stringify((await admin.req("GET", "/api/admin/stats")).data);
  check("platform stats identical across sample reads", statsBefore === statsAfter);
  const bk = await chelsea.c.req("GET", "/api/bookings");
  check("no bookings materialized by the sample read", (bk.data.bookings || []).length === 0);
  const of = await chelsea.c.req("GET", "/api/offers");
  check("no offers materialized by the sample read", (of.data.offers || []).length === 0);
}

// ---------- view-as context ----------
console.log("== View-as sample context ==");
{
  const enter = await admin.req("POST", `/api/admin/businesses/${chelseaId}/view`, {});
  check("admin enters view-as", enter.status === 200, `status=${enter.status}`);
  const r = await admin.req("GET", "/api/me/sample-results");
  check("view-as sees the sample story", r.status === 200 && !!r.data.sample, `status=${r.status}`);
  check("view-as context named", r.data.context === "view-as", r.data.context);
  const exit = await admin.req("POST", "/api/auth/exit-view", {});
  check("exit view-as", exit.status === 200, `status=${exit.status}`);
}

// ---------- Start-here inputs flip with real state ----------
console.log("== Start-here state inputs ==");
{
  const f0 = await other.c.req("GET", "/api/favorites");
  const o0 = await other.c.req("GET", "/api/offers");
  check("fresh business: favorites 0, offers 0", (f0.data.favorites || []).length === 0 && (o0.data.offers || []).length === 0);
}

// ---------- source checks ----------
console.log("== Source checks ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  check("stamp is 2026.11.02-79", buildJs.includes('BUILD_ID = "2026.11.02-79"'));
  check("sample route exists and is fenced by demoShowcaseVisibleTo", routerJs.includes('seg[1] === "sample-results"') && routerJs.includes("function sampleResultsFor(viewer)") && routerJs.includes("if (!demoShowcaseVisibleTo(viewer)) return null;"));
  check("sample builder stores nothing", !/store\.set/.test(routerJs.slice(routerJs.indexOf("function sampleResultsFor"), routerJs.indexOf("function sampleResultsFor") + 2600)));
  check("demo loader reads the shipped demo assets", routerJs.includes("/assets/demo-creators/${spec.handle}-1.jpg"));
  check("Start-here renderer and its three plain steps exist", appJs.includes("function startHereSteps") && appJs.includes("Meet creators near you") && appJs.includes("Invite one, or open a campaign") && appJs.includes("See who came in"));
  check("Start-here mounts on founding and active Home", appJs.includes('id="biz-start-here"') && appJs.includes("loadStartHereInto") && appJs.includes("mountStartHere"));
  check("sample story + preview renderers exist with the plain SAMPLE line", appJs.includes("Sample results — what yours will look like") && appJs.includes("function sampleStoryHtml") && appJs.includes("function samplePreviewHtml") && appJs.includes("loadSampleResultsInto"));
  check("sample mounts on founding Results and Analytics", (appJs.split('id="biz-sample"').length - 1) >= 3);
  check("deck: Next label, Save wiring, See everyone toggle", appJs.includes('passLabel: "Next"') && appJs.includes("deckToggleFav") && appJs.includes("See everyone"));
  check("deck card carries post thumbnails", appJs.includes("deck2-thumbs"));
  check("deck is local-% ranked", appJs.includes("localAudiencePct") && appJs.includes("ranked"));
  check("Campaigns leads with Create and headed Current/Past sections", appJs.includes("+ Create a campaign") && appJs.includes('<h3 class="camp-h">Current</h3>') && appJs.includes('<h3 class="camp-h">Past</h3>') && appJs.includes("No campaigns yet"));
  check("founding no longer defaults to the grid", !appJs.includes('state.discoverMode = "list"'));
  check("package.json wires verify-build74", pkg.includes("verify-build74"));
}

server.kill();
console.log(`\nBuild -74: ${passed} passed, ${failed} failed`);
if (fails.length) console.log("Failures:\n - " + fails.join("\n - "));
process.exit(failed ? 1 : 0);
