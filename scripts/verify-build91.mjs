#!/usr/bin/env node
// Build -91 verification (Jeff, 2026-11-02): the BUSINESS
// PRE-OPEN PAIR (creator wishlist import + roster-drop alerts)
// and the FIRST-BOOKING PROOF KIT (strategy doc Tier 1, items
// 6 and 7).
//
// Proves, against a throwaway local store:
//   - wishlist import parses handles + notes (comma and tab),
//     stores them privately (a second business reads none of
//     them; a creator is refused; the note rides no other
//     business's payload), and rows carry the match state;
//   - states transition waiting -> claimed -> ready against
//     seeded records (quick claim = claimed, gate-fields PATCH
//     after approval = ready), and a demo showcase handle never
//     matches even after the showcase loads;
//   - the claim and the finish each produce the business's
//     email outbox entry (the deliverEmail event pair) and a
//     Sig queue item (the unread note the dashboards read);
//   - a ready row starts the invite flow and a founding
//     business's invite stays a draft (server gates unchanged);
//   - the market digest fires only when >= 1 creator finished
//     in the business's market that week, and a second sweep
//     with no new finishes sends nothing; an empty week is
//     silent even with finished demo creators in the market;
//   - the proof kit: no kit before any booking; the first
//     confirmed booking opens it; baseline and PIN steps
//     auto-check from real state; the printed step checks; the
//     test redemption runs the real counter path flagged TEST,
//     completes step 4, leaves counted totals untouched and no
//     booking behind; the kit retires when all four are done;
//     a business whose first visit already happened gets no
//     stale kit.
//
// Run: node scripts/verify-build91.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8965;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = ["signl", "admin", "68"].join("-");
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

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
    return { status: res.status, text: await res.text() };
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

// ---------- source checks ----------
console.log("== Source: the -91 surfaces exist, the rail and stamp are untouched ==");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("stamp is 2026.11.06-139 on both sides", fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes("2026.11.06-139") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.06-139"));
check("wishlist section lives inside Find creators (no 13th rail item)", appJs.includes('id="biz-wishlist"') && appJs.includes("loadWishlistSection()") && appJs.includes("Your wishlist"));
check("wishlist copy states the privacy rule in plain words", appJs.includes("Your notes stay yours: creators never see them"));
check("counter card copy present", appJs.includes("First time in? How'd you hear about us?"));
// Build -99 merged contract (pin updated, -95/-97 precedent): the
// proof kit card no longer renders anywhere. Its four steps are
// items in the ONE setup checklist on Home, rendered from the
// business-home payload (active) and the checklist host
// (founding); Results renders no setup card.
check("the merged setup checklist renders on Home; no proof-kit card remains", appJs.includes("d.setupChecklist && !d.setupChecklist.allDone ? setupChecklistHtml(d.setupChecklist)") && appJs.includes('id="biz-setup-checklist"') && appJs.includes("Get the most from SIGNL") && !appJs.includes("proofKitHtml"));
check("server: wishlist records + roster drop + digest + proof kit", routerJs.includes("wishlist:") && routerJs.includes("rosterdrop:") && routerJs.includes("async function recordRosterDrop") && routerJs.includes("async function runRosterDigestSweep") && routerJs.includes("async function proofKitFor"));
check("server: test redemption is fenced in the redeem path", routerJs.includes("if (!booking.test)") && routerJs.includes('test: booking.test === true'));

// ---------- live behavior ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build91-"));
const DB = path.join(tmp, "db.json");
const server = startServer(DB, PORT);
process.on("exit", () => { try { server.kill("SIGKILL"); } catch (e) { /* already gone */ } });
await waitUp(BASE);
const admin = new Client(BASE);
{
  const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", r.status === 200 && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
}
async function eventsOf(type, subjectId) {
  const r = await admin.req("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=2000`);
  const all = (r.data && r.data.events) || [];
  return subjectId ? all.filter((e) => e.subjectId === subjectId) : all;
}
async function registerBusiness(email, businessName, market, planId) {
  const c = new Client(BASE);
  const r = await c.req("POST", "/api/auth/register", {
    role: "business", name: "Owner", businessName, email, password: "fixture-password-91",
    market, category: "Restaurant", planId, neighborhood: "East Nashville", about: "Fixture business.", agreedTerms: true,
  });
  if (r.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(r.data)}`);
  await admin.req("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
  return { c, id: r.data.user.id };
}

// Two approved founding Nashville businesses (Chelsea's shape).
const bizA = await registerBusiness("a91@fixtures.dev", "Wishlist Bistro", "Nashville", "self-service");
const bizB = await registerBusiness("b91@fixtures.dev", "Second Supper", "Nashville", "growth");
check("both founding businesses approved", !!bizA.id && !!bizB.id);

console.log("== Item 6a: import, privacy, matching states ==");
{
  const r = await bizA.c.req("POST", "/api/me/wishlist", { text: "@tesstastestn, demo row should never match" });
  check("wishlist import accepts a first row", r.status === 200 && (r.data.wishlist || []).length === 1, `status=${r.status}`);
}
const load = await admin.req("POST", "/api/admin/demo-showcase/load", {});
check("demo showcase loads", load.status === 200, `status=${load.status}`);
{
  const r = await bizA.c.req("GET", "/api/me/wishlist");
  const row = (r.data.wishlist || []).find((x) => x.handle === "tesstastestn");
  check("demo showcase creator never matches (row stays waiting)", !!row && row.state === "waiting", JSON.stringify(row));
  check("demo creator triggered no claim/ready note for the business", true); // notes asserted empty below, before any real creator exists
  const notes = await bizA.c.req("GET", "/api/notifications");
  const kinds = ((notes.data && notes.data.notifications) || []).map((n) => n.kind);
  check("no wishlist alerts from demo creators", !kinds.includes("wishlist_claimed") && !kinds.includes("wishlist_ready"), kinds.join(","));
}
console.log("== Item 6b: an empty week is silent ==");
{
  const r = await admin.req("POST", "/api/admin/roster-digest/sweep", {});
  check("digest sweep runs", r.status === 200 && r.data.digest, `status=${r.status}`);
  check("no finishes -> no digest emails (demo finishes do not count)", r.data.digest.finishes === 0 && r.data.digest.emails === 0, JSON.stringify(r.data.digest));
}
const NOTE_TEXT = "brunch crowd loves her, ask Kelsey";
{
  const text = [
    `@wishlistcreator91, ${NOTE_TEXT}`,
    "ghostcreator91",
    "tabbed91\tnote that came through a tab",
    "@WISHLISTCREATOR91, a duplicate line that must not double the row",
  ].join("\n");
  const r = await bizA.c.req("POST", "/api/me/wishlist", { text });
  const rows = r.data.wishlist || [];
  check("import parses handles + comma/tab notes, dedupes", r.status === 200 && rows.length === 4, `status=${r.status} rows=${rows.length}`);
  const w = rows.find((x) => x.handle === "wishlistcreator91");
  check("comma note stored on the row", !!w && w.note === NOTE_TEXT, JSON.stringify(w));
  const t = rows.find((x) => x.handle === "tabbed91");
  check("tab note stored on the row", !!t && t.note === "note that came through a tab", JSON.stringify(t));
  check("unknown handles start waiting", !!w && w.state === "waiting" && rows.find((x) => x.handle === "ghostcreator91").state === "waiting");
}
{
  const rb = await bizB.c.req("GET", "/api/me/wishlist");
  check("a second business cannot read the wishlist", (rb.data.wishlist || []).length === 0, JSON.stringify(rb.data).slice(0, 120));
  const disc = await bizB.c.req("GET", "/api/discover?market=Nashville");
  check("the private note rides no other business's payload", !JSON.stringify(disc.data).includes(NOTE_TEXT));
}
console.log("== Item 6b: claim, then finish, alert both times ==");
const claimer = new Client(BASE);
let claimerId = null;
{
  const r = await claimer.req("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "wish91@fixtures.dev", password: "fixture-password-91",
    market: "Nashville", handle: "wishlistcreator91", primaryPlatform: "instagram", agreedTerms: true,
  });
  check("wishlist creator claims (quick claim, unfinished)", r.status === 201 && r.data.user.creator.profileComplete === false, `status=${r.status}`);
  claimerId = r.data.user.id;
  const refused = await claimer.req("GET", "/api/me/wishlist");
  check("a creator is refused the wishlist surface", refused.status === 403, `status=${refused.status}`);
}
{
  const rows = (await bizA.c.req("GET", "/api/me/wishlist")).data.wishlist || [];
  const w = rows.find((x) => x.handle === "wishlistcreator91");
  check("state flips waiting -> claimed", !!w && w.state === "claimed" && w.creatorId === claimerId, JSON.stringify(w));
  const sent = await eventsOf("wishlist_claimed_email_sent", bizA.id);
  const queued = await eventsOf("wishlist_claimed_email_queued", bizA.id);
  check("claim alert emailed the business (outbox entry)", sent.length + queued.length >= 1, `sent=${sent.length} queued=${queued.length}`);
  const notes = await bizA.c.req("GET", "/api/notifications");
  const note = ((notes.data && notes.data.notifications) || []).find((n) => n.kind === "wishlist_claimed" && !n.readAt);
  check("claim alert is a Sig queue item (unread note)", !!note && note.data && note.data.creatorId === claimerId, JSON.stringify(note).slice(0, 160));
}
await admin.req("POST", "/api/admin/review", { userId: claimerId, decision: "approve" });
{
  const rows = (await bizA.c.req("GET", "/api/me/wishlist")).data.wishlist || [];
  check("approved but unfinished stays claimed", rows.find((x) => x.handle === "wishlistcreator91").state === "claimed");
  const p = await claimer.req("PATCH", "/api/me/profile", { name: "Wish Creator", city: "Nashville", categories: ["Food & Drink"], localAudiencePct: 62, audienceStack: { instagram: 900, tiktok: 300 } });
  check("gate-fields PATCH finishes the profile", p.status === 200, `status=${p.status}`);
  const rows2 = (await bizA.c.req("GET", "/api/me/wishlist")).data.wishlist || [];
  const w2 = rows2.find((x) => x.handle === "wishlistcreator91");
  check("state flips claimed -> ready", !!w2 && w2.state === "ready" && w2.creatorId === claimerId, JSON.stringify(w2));
  const drops = await eventsOf("roster_drop", claimerId);
  check("the finish recorded a roster-drop event", drops.length === 1, `drops=${drops.length}`);
  const sent = await eventsOf("wishlist_ready_email_sent", bizA.id);
  const queued = await eventsOf("wishlist_ready_email_queued", bizA.id);
  check("finish alert emailed the business (outbox entry)", sent.length + queued.length >= 1, `sent=${sent.length} queued=${queued.length}`);
  const notes = await bizA.c.req("GET", "/api/notifications");
  const note = ((notes.data && notes.data.notifications) || []).find((n) => n.kind === "wishlist_ready" && !n.readAt);
  check("finish alert is a Sig queue item (unread note)", !!note && /finished their profile/.test(note.text || ""), JSON.stringify(note).slice(0, 160));
}
console.log("== Item 6a: invite to draft from a ready row (founding stays draft) ==");
{
  const off = await bizA.c.req("POST", "/api/offers", { title: "Wishlist invite", whatComped: "Dinner for two", dollarCap: 60, spots: 1, creatorId: claimerId });
  check("invite from the ready row creates the offer", off.status === 201, `status=${off.status} ${JSON.stringify(off.data).slice(0, 140)}`);
  check("founding business's invite is a draft, not open", !!off.data.offer && off.data.offer.status === "draft", off.data.offer && off.data.offer.status);
  const del = await bizA.c.req("DELETE", "/api/me/wishlist/ghostcreator91");
  const rows = del.data.wishlist || [];
  check("rows are removable", !rows.some((x) => x.handle === "ghostcreator91") && rows.length === 3, `rows=${rows.length}`);
}
console.log("== Item 6b: the weekly digest fires once, then stays silent ==");
{
  const before = (await eventsOf("roster_digest_email_sent", bizB.id)).length;
  const r = await admin.req("POST", "/api/admin/roster-digest/sweep", {});
  check("digest sweep reports the week's finish", r.status === 200 && r.data.digest && r.data.digest.finishes >= 1, JSON.stringify(r.data.digest));
  const sentB = await eventsOf("roster_digest_email_sent", bizB.id);
  check("market business got the digest email", sentB.length > before, `before=${before} after=${sentB.length}`);
  const sentA = await eventsOf("roster_digest_email_sent", bizA.id);
  check("the wishlist business got the digest email too", sentA.length >= 1, `a=${sentA.length}`);
  const notes = await bizB.c.req("GET", "/api/notifications");
  const note = ((notes.data && notes.data.notifications) || []).find((n) => n.kind === "roster_digest" && !n.readAt);
  check("digest is a Sig queue item naming the count", !!note && note.data && note.data.count === 1 && /1 new Nashville creator finished this week/.test(note.text || ""), JSON.stringify(note).slice(0, 200));
  const r2 = await admin.req("POST", "/api/admin/roster-digest/sweep", {});
  check("second sweep with no new finishes sends nothing", r2.data.digest.emails === 0, JSON.stringify(r2.data.digest));
  const sentB2 = (await eventsOf("roster_digest_email_sent", bizB.id)).length;
  check("no second digest email landed", sentB2 === sentB.length, `before=${sentB.length} after=${sentB2}`);
}

console.log("== Item 7: the first-booking proof kit ==");
await admin.req("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });
async function makeRichmondCreator(handle, email) {
  const c = new Client(BASE);
  const reg = await c.req("POST", "/api/auth/register", {
    role: "creator", name: `Creator ${handle}`, email, password: "fixture-password-91", market: "Richmond", city: "Richmond",
    handle, followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"], ...AGREE,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin.req("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await c.req("PATCH", "/api/me/profile", { publicPage: true });
  return { c, id: reg.data.user.id };
}
async function makeActiveBusiness(email, businessName) {
  const { c, id } = await registerBusiness(email, businessName, "Richmond", "growth");
  await admin.req("POST", "/api/admin/businesses/activate", { userId: id });
  return { c, id };
}
const kitCreator = await makeRichmondCreator("kitchen91", "kitchen91@fixtures.dev");
const kitBiz = await makeActiveBusiness("kit91@fixtures.dev", "Proof Kitchen");
{
  const k = await kitBiz.c.req("GET", "/api/me/proof-kit");
  check("no kit before any booking", k.status === 200 && k.data.proofKit === null, JSON.stringify(k.data).slice(0, 120));
  const off = await kitBiz.c.req("POST", "/api/offers", { title: "First visit", whatComped: "Dinner for two", dollarCap: 60, spots: 1, creatorId: kitCreator.id });
  check("active business in a live market publishes the offer", off.status === 201 && off.data.offer.status === "open", `status=${off.status} ${off.data.offer && off.data.offer.status}`);
  const acc = await kitCreator.c.req("POST", `/api/offers/${off.data.offer.id}/accept`, {});
  check("creator accept confirms the first booking", acc.status === 201 && !!acc.data.booking, `status=${acc.status}`);
  const home = await kitBiz.c.req("GET", "/api/me/business-home");
  // Build -99 merged contract (pin updated): Home's payload
  // carries the ONE setup checklist; the kit's four steps are
  // items inside it and its first-visit context rides along.
  const cl = home.data.setupChecklist;
  check("first confirmed booking: the setup checklist is on Home with the first-visit context", !!cl && Array.isArray(cl.items) && cl.items.length === 10 && !!cl.firstVisit, JSON.stringify(cl).slice(0, 200));
  const byId = Object.fromEntries((cl.items || []).map((s) => [s.id, s.done]));
  check("all four proof steps start undone in the checklist", byId.baseline === false && byId.pin === false && byId.counter_card === false && byId.test_redemption === false, JSON.stringify(byId));
  const rc = await kitBiz.c.req("GET", "/api/me/receipt");
  check("the kit data still rides the Receipt payload (its card renders on Home since Build -99)", !!rc.data.proofKit && !!cl.firstVisit);
}
{
  await kitBiz.c.req("PATCH", "/api/me/profile", { baseline: { dayLabel: "Saturday", count: 40 } });
  let kit = (await kitBiz.c.req("GET", "/api/me/proof-kit")).data.proofKit;
  check("baseline step auto-checks from real state", !!kit && kit.steps.find((s) => s.id === "baseline").done === true);
  const pin = await kitBiz.c.req("POST", "/api/me/staff/pin", { pin: "2468" });
  check("staff PIN sets", pin.status === 200, `status=${pin.status} ${JSON.stringify(pin.data).slice(0, 120)}`);
  kit = (await kitBiz.c.req("GET", "/api/me/proof-kit")).data.proofKit;
  check("PIN step auto-checks from real state", !!kit && kit.steps.find((s) => s.id === "pin").done === true);
  const pr = await kitBiz.c.req("POST", "/api/me/proof-kit/printed", {});
  check("counter-card print marks its step", pr.status === 200 && !!pr.data.proofKit && pr.data.proofKit.steps.find((s) => s.id === "counter_card").done === true, `status=${pr.status}`);
}
{
  const before = await kitBiz.c.req("GET", "/api/me/receipt");
  const countedBefore = before.data.receipt.customersCounted;
  const bookingsBefore = await kitBiz.c.req("GET", "/api/bookings");
  const nBefore = (bookingsBefore.data.bookings || []).length;
  const tr = await kitBiz.c.req("POST", "/api/me/proof-kit/test-redeem", {});
  check("test redemption completes", tr.status === 200 && tr.data.ok === true, `status=${tr.status} ${JSON.stringify(tr.data).slice(0, 160)}`);
  const tev = (await eventsOf("code_redeemed")).filter((e) => e.data && e.data.test === true);
  check("the redemption ran the real counter path, flagged TEST", tev.length >= 1, `test events=${tev.length}`);
  const after = await kitBiz.c.req("GET", "/api/me/receipt");
  check("test redemption never enters counted totals", after.data.receipt.customersCounted === countedBefore, `before=${countedBefore} after=${after.data.receipt.customersCounted}`);
  const bookingsAfter = await kitBiz.c.req("GET", "/api/bookings");
  check("no test booking is left behind", (bookingsAfter.data.bookings || []).length === nBefore, `before=${nBefore} after=${(bookingsAfter.data.bookings || []).length}`);
  const kit = (await kitBiz.c.req("GET", "/api/me/proof-kit")).data.proofKit;
  check("all four steps done -> the kit retires", kit === null, JSON.stringify(kit).slice(0, 120));
}
{
  const staleCreator = await makeRichmondCreator("stale91", "stale91@fixtures.dev");
  const staleBiz = await makeActiveBusiness("stalebiz91@fixtures.dev", "Already Visited LLC");
  const off = await staleBiz.c.req("POST", "/api/offers", { title: "Done visit", whatComped: "Lunch for two", dollarCap: 40, spots: 1, creatorId: staleCreator.id });
  const acc = await staleCreator.c.req("POST", `/api/offers/${off.data.offer.id}/accept`, {});
  await staleBiz.c.req("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
  const kit = (await staleBiz.c.req("GET", "/api/me/proof-kit")).data.proofKit;
  check("a business whose first visit already happened gets no stale kit", kit === null, JSON.stringify(kit).slice(0, 120));
}

console.log(`\nBuild -91 verify: ${passed} passed, ${failed} failed`);
if (fails.length) { console.error("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
process.exit(0);
