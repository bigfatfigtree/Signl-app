#!/usr/bin/env node
// Build -67 verification (Jeff, 2026-11-01): Admin "View account"
// for a real business (read-only, server-enforced), the admin
// "Send sign-in link" mechanism + Jeff's separate business login,
// the "Your first month" founding card data, and the fenced
// Nashville demo creator showcase.
//
// Proves, against throwaway local stores:
//   Phase 1 (fresh store):
//     - a Chelsea-shaped founding business carries her real plan,
//       founding credit, and her business-specific highlight on
//       her own payload, and NO other business carries it;
//     - view-as: entry swaps the session to the business's real
//       record, /auth/me is decorated, reads render her data,
//       EVERY mutating probe refuses 403 with the read-only copy,
//       the entry and exit are audit-logged, exit restores the
//       admin session, and logout inside a view exits the view;
//     - send-sign-in-link: the admin action emails a working
//       reset link to the account's own address (TEST_MODE token),
//       the new password signs the business in, the old one dies,
//       and the action is audit-logged and admin-only;
//     - demo showcase: default not loaded; Load creates the 12
//       flagged records idempotently and stamps the allowlist;
//       the allowlisted (activated) business sees demos ranked
//       and filtered by the same rules as real creators; every
//       other viewer sees none anywhere (discovery, profile,
//       sitemap, Local List); a direct offer to a demo is refused;
//       counts do not move; Remove purges the batch completely.
//   Phase 2 (pre-seeded store): a demo record holding a session
//     still cannot apply to or accept an offer, and a business
//     cannot select its application or book it paid.
//   Source checks: banner shell + copy, entry-point buttons,
//   the first-month card, and the -67 stamp.
//
// Run: node scripts/verify-build67.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8995;
const PORT2 = 8996;
const BASE = `http://127.0.0.1:${PORT}`;
const BASE2 = `http://127.0.0.1:${PORT2}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "signl-admin-test-67";
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const READ_ONLY_BIT = "viewing this account read-only";
const HIGHLIGHT_BIT = "tour-and-shop reel in this store, unprompted, and it pulled about 1,800 likes";
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build67-"));
const DB = path.join(tmp, "db.json");
const DB2 = path.join(tmp, "db2.json");

console.log("== Phase 1: view-as, sign-in link, first-month data, demo fence ==");
const server = startServer(DB, PORT);
await waitUp(BASE);
const admin = new Client(BASE);
{
  const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", r.status === 200 && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
}
async function eventsOf(type, client = admin) {
  const r = await client.req("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=500`);
  return (r.data && r.data.events) || [];
}
async function registerBusiness(email, businessName, market, planId, category = "Retail") {
  const c = new Client(BASE);
  const r = await c.req("POST", "/api/auth/register", {
    role: "business", name: "Owner", businessName, email, password: "fixture-password-67",
    market, category, planId, neighborhood: "East Nashville", about: "Fixture business.", agreedTerms: true,
  });
  return { c, r };
}

// --- the cast ---
const chelsea = await registerBusiness("chelsea@fixtures.dev", "Chelsea Friday Furniture", "Nashville", "self-service");
check("Chelsea-shaped business registers (pending)", chelsea.r.status === 201 && chelsea.r.data.user.status === "pending", `status=${chelsea.r.status}`);
const chelseaId = chelsea.r.data.user.id;
const maple = await registerBusiness("maple@fixtures.dev", "Maple Street Coffee", "Nashville", "growth", "Coffee & Bakery");
const mapleId = maple.r.data.user.id;
const jeffBiz = await registerBusiness("jeff+business@fixtures.dev", "Jeff Test Kitchen", "Nashville", "self-service", "Restaurant");
const jeffBizId = jeffBiz.r.data.user.id;
for (const [label, id] of [["Chelsea", chelseaId], ["Maple", mapleId], ["Jeff business", jeffBizId]]) {
  const r = await admin.req("POST", "/api/admin/review", { userId: id, decision: "approve" });
  check(`admin approves ${label}`, r.status === 200 && r.data.user.status === "approved", `status=${r.status}`);
}

// One real, finished Nashville creator for the discovery mix.
const realCreator = new Client(BASE);
{
  const r = await realCreator.req("POST", "/api/auth/register", {
    role: "creator", name: "Real Nashville", email: "realnash@fixtures.dev", password: "fixture-password-67",
    market: "Nashville", city: "Nashville", handle: "realnashcreator", followerCount: 3000,
    localAudiencePct: 80, categories: ["Food & Drink"], ...AGREE,
  });
  check("real Nashville creator registers", r.status === 201, `status=${r.status}`);
  const ap = await admin.req("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
  check("real Nashville creator approved", ap.status === 200, `status=${ap.status}`);
  const pp = await realCreator.req("PATCH", "/api/me/profile", { publicPage: true });
  check("real creator's public page is on (sitemap premise)", pp.status === 200, `status=${pp.status}`);
}

// --- Deliverable 3 data: her record, her highlight, nobody else's ---
{
  const me = await chelsea.c.req("GET", "/api/auth/me");
  const bz = me.data.user.business || {};
  check("Chelsea payload: Self-Service plan on record", bz.plan === "self-service" && bz.planPriceMonthly === 199 && bz.planMinMonths === 3, JSON.stringify(bz).slice(0, 200));
  check("Chelsea payload: founding state held", bz.accessState === "founding", bz.accessState);
  const cc = await admin.req("GET", "/api/admin/command/businesses");
  const ccRow = (cc.data.businesses || []).find((r) => r.id === chelseaId);
  check("Command Center: her $100 founding credit computed, unused", !!(ccRow && ccRow.credit && ccRow.credit.total === 100 && ccRow.credit.used === 0 && ccRow.credit.applied === false), JSON.stringify(ccRow && ccRow.credit));
  check("Command Center: recorded-only billing, 5 visits available", !!(ccRow && ccRow.billing && ccRow.billing.state === "recorded" && ccRow.rollover && ccRow.rollover.available === 5), JSON.stringify(ccRow && { billing: ccRow.billing, rollover: ccRow.rollover }).slice(0, 200));
  check("Chelsea payload carries HER highlight line", typeof bz.highlight === "string" && bz.highlight.includes(HIGHLIGHT_BIT), String(bz.highlight || "").slice(0, 120));
  const mapleMe = await maple.c.req("GET", "/api/auth/me");
  check("no highlight on any other business", !(mapleMe.data.user.business || {}).highlight, "highlight leaked");
  const boot = await chelsea.c.req("GET", "/api/bootstrap");
  const ss = (boot.data.plans || []).find((p) => p.id === "self-service");
  check("plan catalog: Self-Service is 5 visits a month", !!ss && ss.visitsPerMonth === 5, JSON.stringify(ss));
}

// --- Deliverable 1: view-as ---
{
  const before = await eventsOf("admin_viewed_business_account");
  const enter = await admin.req("POST", `/api/admin/businesses/${chelseaId}/view`, {});
  check("admin enters view of Chelsea's account", enter.status === 200 && enter.data.business && enter.data.business.name === "Chelsea Friday Furniture", `status=${enter.status} ${JSON.stringify(enter.data).slice(0, 120)}`);
  const meView = await admin.req("GET", "/api/auth/me");
  check("view session IS Chelsea's real record", meView.data.user.role === "business" && meView.data.user.id === chelseaId, JSON.stringify(meView.data.user).slice(0, 160));
  check("view payload decorated for the banner", !!(meView.data.user.viewAs && meView.data.user.viewAs.readOnly === true && meView.data.user.viewAs.businessName === "Chelsea Friday Furniture"), JSON.stringify(meView.data.user.viewAs));
  check("view shows her real plan + highlight", meView.data.user.business.plan === "self-service" && meView.data.user.business.planPriceMonthly === 199 && String(meView.data.user.business.highlight || "").includes(HIGHLIGHT_BIT), "");
  const rp = await admin.req("GET", "/api/me/roster-preview");
  check("view reads compute on her record (roster preview 200)", rp.status === 200, `status=${rp.status}`);
  const probes = [
    ["PATCH", "/api/me/profile", { moment: "grand-opening" }],
    ["POST", "/api/deck-state", { deck: "discover", action: "hide", itemId: "x" }],
    ["POST", "/api/favorites", { creatorId: "x" }],
    ["POST", "/api/offers", { title: "Nope", kind: "comp", dollarCap: 50, spots: 1 }],
    ["POST", "/api/messages", { toUserId: "x", body: "hi" }],
    ["POST", "/api/auth/change-password", { currentPassword: "a", newPassword: "b" }],
    ["POST", `/api/admin/businesses/${chelseaId}/view`, {}],
    ["POST", "/api/admin/review", { userId: chelseaId, decision: "approve" }],
    ["DELETE", "/api/offers/whatever", null],
  ];
  for (const [m, p, b] of probes) {
    const r = await admin.req(m, p, b || {});
    check(`view refuses ${m} ${p.split("?")[0]}`, r.status === 403 && String((r.data || {}).error || "").includes(READ_ONLY_BIT), `status=${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);
  }
  const exit = await admin.req("POST", "/api/auth/exit-view", {});
  check("exit view returns the admin", exit.status === 200 && exit.data.user && exit.data.user.role === "admin", `status=${exit.status}`);
  const after = await eventsOf("admin_viewed_business_account");
  check("view entry audit-logged", after.length === before.length + 1 && after.some((e) => e.subjectId === chelseaId), `before=${before.length} after=${after.length}`);
  const meAdmin = await admin.req("GET", "/api/auth/me");
  check("admin session restored after exit", meAdmin.data.user.role === "admin" && !meAdmin.data.user.viewAs, meAdmin.data.user.role);
  const exits = await eventsOf("admin_exited_business_view");
  check("view exit audit-logged", exits.some((e) => e.subjectId === chelseaId), `n=${exits.length}`);
  // Logout inside a view exits the view (never signs the admin out).
  await admin.req("POST", `/api/admin/businesses/${chelseaId}/view`, {});
  const lo = await admin.req("POST", "/api/auth/logout", {});
  check("logout inside a view restores the admin", lo.status === 200 && lo.data.user && lo.data.user.role === "admin", `status=${lo.status} ${JSON.stringify(lo.data).slice(0, 120)}`);
  const meAfter = await admin.req("GET", "/api/auth/me");
  check("admin still signed in after view logout", meAfter.status === 200 && meAfter.data.user.role === "admin", `status=${meAfter.status}`);
  const badView = await admin.req("POST", `/api/admin/businesses/${jeffBizId}/view`, {});
  check("view entry works for another business too", badView.status === 200, `status=${badView.status}`);
  await admin.req("POST", "/api/auth/exit-view", {});
  const notBiz = await admin.req("POST", "/api/admin/businesses/nope-nope/view", {});
  check("view of a missing business 404s", notBiz.status === 404, `status=${notBiz.status}`);
  const asBiz = await chelsea.c.req("POST", `/api/admin/businesses/${chelseaId}/view`, {});
  check("non-admin cannot enter a view", asBiz.status === 403, `status=${asBiz.status}`);
}

// --- Deliverable 2: send sign-in link + Jeff's separate business login ---
{
  const denied = await maple.c.req("POST", `/api/admin/users/${jeffBizId}/send-signin-link`, {});
  check("send-sign-in-link is admin-only", denied.status === 403, `status=${denied.status}`);
  const send = await admin.req("POST", `/api/admin/users/${jeffBizId}/send-signin-link`, {});
  check("admin sends the sign-in link to the account's own email", send.status === 200 && send.data.email === "jeff+business@fixtures.dev", `status=${send.status} ${JSON.stringify(send.data).slice(0, 160)}`);
  check("TEST_MODE carries the token for the proof", typeof send.data.devResetToken === "string" && send.data.devResetToken.length > 20, "");
  const reset = await new Client(BASE).req("POST", "/api/auth/reset", { token: send.data.devResetToken, password: "jeffs-new-business-67" });
  check("the link sets a new password", reset.status === 200, `status=${reset.status}`);
  const login = await new Client(BASE).req("POST", "/api/auth/login", { email: "jeff+business@fixtures.dev", password: "jeffs-new-business-67" });
  check("Jeff's business login works, separate from Admin", login.status === 200 && login.data.user.role === "business" && login.data.user.business.businessName === "Jeff Test Kitchen", `status=${login.status}`);
  const oldLogin = await new Client(BASE).req("POST", "/api/auth/login", { email: "jeff+business@fixtures.dev", password: "fixture-password-67" });
  check("the replaced password no longer works", oldLogin.status === 401, `status=${oldLogin.status}`);
  const evts = await eventsOf("admin_sent_signin_link");
  check("sign-in link action audit-logged", evts.some((e) => e.subjectId === jeffBizId), `n=${evts.length}`);
  // The public Forgot flow rides the same issuance (shared helper).
  const forgot = await new Client(BASE).req("POST", "/api/auth/forgot", { email: "chelsea@fixtures.dev" });
  check("forgot flow still issues a token (shared machinery)", forgot.status === 200 && typeof forgot.data.devResetToken === "string", `status=${forgot.status}`);
  const fr = await new Client(BASE).req("POST", "/api/auth/reset", { token: forgot.data.devResetToken, password: "chelsea-new-pass-67" });
  check("forgot-issued token resets too", fr.status === 200, `status=${fr.status}`);
  // A reset revokes the account's sessions (by design), so her
  // fixture client signs back in with the new password.
  const reLogin = await chelsea.c.req("POST", "/api/auth/login", { email: "chelsea@fixtures.dev", password: "chelsea-new-pass-67" });
  check("Chelsea signs back in with the reset password", reLogin.status === 200 && reLogin.data.user.role === "business", `status=${reLogin.status}`);
}

// --- Deliverable 4: the demo showcase fence ---
async function rosterCounts() {
  const r = await admin.req("GET", "/api/admin/applications");
  const s = (r.data && r.data.summary) || {};
  return s;
}
{
  const st0 = await admin.req("GET", "/api/admin/demo-showcase");
  check("demo showcase defaults to NOT loaded", st0.status === 200 && st0.data.showcase.loaded === 0, `loaded=${st0.data.showcase && st0.data.showcase.loaded}`);
  // Activate Chelsea + Maple so both can browse discovery (market
  // still closed; TEST bypass governs live reads only).
  for (const [label, id] of [["Chelsea", chelseaId], ["Maple", mapleId]]) {
    const act = await admin.req("POST", "/api/admin/businesses/activate", { userId: id });
    check(`admin activates ${label} for the browse tests`, act.status === 200 && act.data.user.business.accessState === "active", `status=${act.status}`);
  }
  const countsBefore = await rosterCounts();
  const load = await admin.req("POST", "/api/admin/demo-showcase/load", {});
  check("Load creates the 12 demo creators", load.status === 200 && load.data.result.created === 12, JSON.stringify(load.data.result || {}).slice(0, 200));
  check("Load stamps Chelsea's account as the allowlisted viewer", (load.data.result.allowlisted || []).includes("Chelsea Friday Furniture"), JSON.stringify(load.data.result.allowlisted));
  const load2 = await admin.req("POST", "/api/admin/demo-showcase/load", {});
  check("Load is idempotent (no duplicates)", load2.data.result.created === 0 && load2.data.result.existing === 12 && load2.data.showcase.loaded === 12, JSON.stringify(load2.data.result || {}).slice(0, 160));
  const countsAfter = await rosterCounts();
  check("roster counts unchanged with demos loaded", JSON.stringify(countsBefore) === JSON.stringify(countsAfter), `before=${JSON.stringify(countsBefore)} after=${JSON.stringify(countsAfter)}`);

  const chDisc = await chelsea.c.req("GET", "/api/discover?market=Nashville");
  const chHandles = (chDisc.data.creators || []).map((c) => (c.profile && c.profile.handle) || c.handle || "");
  check("allowlisted business discovery includes ALL 12 demos", DEMO_HANDLES.every((h) => chHandles.includes(h)), chHandles.join(","));
  check("allowlisted discovery also includes the real creator", chHandles.includes("realnashcreator"), chHandles.join(","));
  const strict = await chelsea.c.req("GET", "/api/discover?market=Nashville&minLocalPct=90");
  const strictHandles = (strict.data.creators || []).map((c) => (c.profile && c.profile.handle) || c.handle || "");
  check("demos filter by the same local-% rules (90+ keeps 91/93/95 demos, drops the 80% real creator)", strictHandles.includes("marcusbellshoots") && strictHandles.includes("hannahandthem") && strictHandles.includes("elithackereats") && !strictHandles.includes("realnashcreator") && !strictHandles.includes("tesstastestn"), strictHandles.join(","));
  const mpDisc = await maple.c.req("GET", "/api/discover?market=Nashville");
  const mpHandles = (mpDisc.data.creators || []).map((c) => (c.profile && c.profile.handle) || c.handle || "");
  check("non-allowlisted business sees NO demos", !DEMO_HANDLES.some((h) => mpHandles.includes(h)) && mpHandles.includes("realnashcreator"), mpHandles.join(","));

  const profCh = await chelsea.c.req("GET", "/api/c/tesstastestn");
  check("allowlisted business opens a demo profile", profCh.status === 200 && profCh.data.profile && profCh.data.profile.handle === "tesstastestn", `status=${profCh.status}`);
  const profMp = await maple.c.req("GET", "/api/c/tesstastestn");
  check("non-allowlisted business gets 404 on a demo profile", profMp.status === 404, `status=${profMp.status}`);
  const profAnon = await new Client(BASE).req("GET", "/api/c/tesstastestn");
  check("logged-out demo profile 404s", profAnon.status === 404, `status=${profAnon.status}`);
  const profCreator = await realCreator.req("GET", "/api/c/tesstastestn");
  check("creator viewer gets 404 on a demo profile", profCreator.status === 404, `status=${profCreator.status}`);

  const sitemap = await new Client(BASE).raw("/api/sitemap.xml");
  check("sitemap excludes demos, includes the real creator", !DEMO_HANDLES.some((h) => sitemap.text.includes(h)) && sitemap.text.includes("realnashcreator"), "");
  const ll = await new Client(BASE).req("GET", "/api/public/local-list?market=Nashville");
  const llJson = JSON.stringify(ll.data || {});
  check("Local List excludes demos", !DEMO_HANDLES.some((h) => llJson.includes(h)), llJson.slice(0, 200));

  const demoCard = (chDisc.data.creators || []).find((c) => ((c.profile && c.profile.handle) || c.handle) === "tesstastestn");
  check("discovery hands the demo card to the allowlisted business", !!demoCard && !!demoCard.userId, "");
  const directOffer = await chelsea.c.req("POST", "/api/offers", { title: "Demo walk", kind: "comp", dollarCap: 60, spots: 1, creatorId: demoCard.userId, whatComped: "A meal for two" });
  check("a direct offer to a demo creator is refused server-side", directOffer.status === 400 && /not an approved creator/.test(directOffer.data.error || ""), `status=${directOffer.status} ${JSON.stringify(directOffer.data).slice(0, 140)}`);
  const msgDemo = await chelsea.c.req("POST", "/api/messages", { toUserId: demoCard.userId, body: "hello" });
  check("messaging a demo creator 404s", msgDemo.status === 404, `status=${msgDemo.status}`);
  const favDemo = await chelsea.c.req("POST", "/api/favorites", { creatorId: demoCard.userId });
  check("allowlisted business may favorite a demo (part of browsing)", favDemo.status === 200, `status=${favDemo.status}`);
  const favMp = await maple.c.req("POST", "/api/favorites", { creatorId: demoCard.userId });
  check("non-allowlisted business cannot favorite a demo", favMp.status === 404, `status=${favMp.status}`);
  if (demoCard.photoUrl) {
    const photoCh = await chelsea.c.raw(`/api/users/${demoCard.userId}/photo`);
    check("allowlisted business can load the demo photo", photoCh.status === 200, `status=${photoCh.status}`);
    const photoAnon = await new Client(BASE).raw(`/api/users/${demoCard.userId}/photo`);
    check("demo photo is never public", photoAnon.status === 401 || photoAnon.status === 403, `status=${photoAnon.status}`);
  } else {
    console.log("  note - demo photos did not fetch in this environment; photo-fence checks skipped");
  }
  // View-as sees the same fenced discovery.
  await admin.req("POST", `/api/admin/businesses/${chelseaId}/view`, {});
  const viewDisc = await admin.req("GET", "/api/discover?market=Nashville");
  const viewHandles = (viewDisc.data.creators || []).map((c) => (c.profile && c.profile.handle) || c.handle || "");
  check("view-as of Chelsea sees the demos in discovery", DEMO_HANDLES.every((h) => viewHandles.includes(h)), viewHandles.join(","));
  await admin.req("POST", "/api/auth/exit-view", {});

  const loadEvts = await eventsOf("demo_showcase_loaded");
  check("demo load audit-logged", loadEvts.length >= 1, `n=${loadEvts.length}`);
  const rm = await admin.req("POST", "/api/admin/demo-showcase/remove", {});
  check("Remove purges the whole batch", rm.status === 200 && rm.data.result.removed === 12 && rm.data.result.remaining === 0 && rm.data.showcase.loaded === 0, JSON.stringify(rm.data.result || {}));
  const chAfter = await chelsea.c.req("GET", "/api/discover?market=Nashville");
  const chAfterHandles = (chAfter.data.creators || []).map((c) => (c.profile && c.profile.handle) || c.handle || "");
  check("after purge, allowlisted discovery has no demos and keeps the real creator", !DEMO_HANDLES.some((h) => chAfterHandles.includes(h)) && chAfterHandles.includes("realnashcreator"), chAfterHandles.join(","));
  const favsAfter = await chelsea.c.req("GET", "/api/favorites");
  check("after purge, favorites pointing at demos are gone", !(favsAfter.data.favorites || []).some((f) => DEMO_HANDLES.includes((f.profile && f.profile.handle) || f.handle)), JSON.stringify(favsAfter.data).slice(0, 160));
  const countsFinal = await rosterCounts();
  check("roster counts unchanged after purge", JSON.stringify(countsBefore) === JSON.stringify(countsFinal), "");
  const rmEvts = await eventsOf("demo_showcase_removed");
  check("demo remove audit-logged", rmEvts.length >= 1, `n=${rmEvts.length}`);
}
server.kill();

// --- Phase 2: a demo holding a session still cannot act ---
console.log("== Phase 2: demo actor refusals (seeded store) ==");
{
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync("demo-known-pass-67", salt, 64).toString("hex");
  const ts = "2026-11-01T12:00:00.000Z";
  const data = {};
  data["user:seed-biz"] = {
    id: "seed-biz", role: "business", email: "seedbiz@fixtures.dev", name: "Seed Owner",
    passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville",
    createdAt: ts, updatedAt: ts, termsVersion: "2026-10-19", termsAcceptedAt: ts,
    business: { businessName: "Seed Bistro", category: "Restaurant", plan: "growth", planName: "Growth $349/mo", planPriceMonthly: 349, planMinMonths: 3, accessState: "active", activatedAt: ts },
  };
  data["email:seedbiz@fixtures.dev"] = { userId: "seed-biz" };
  data["user:seed-demo"] = {
    id: "seed-demo", role: "creator", email: "demo-tesstastestn@showcase.signl.invalid", name: "Tess Marlowe",
    passwordSalt: salt, passwordHash: hash, status: "approved", tester: true, demoShowcase: "nashville-2026-11",
    market: "Nashville", city: "Nashville", createdAt: ts, updatedAt: ts, termsVersion: "2026-10-19", termsAcceptedAt: ts,
    creator: {
      handle: "tesstastestn", primaryPlatform: "instagram", followerCount: 4800,
      audienceStack: { instagram: 4800, tiktok: 1400 }, totalAudience: 6200, tierBand: "Locals",
      categories: ["Food & Drink"], compCategories: [], compOpen: true, paidRate: 175, licensingFee: 120,
      bio: "Seeded demo record.", bestWork: [], neighborhood: "East Nashville", localAudiencePct: 88,
      publicPage: true, hasPhoto: false,
    },
  };
  data["email:demo-tesstastestn@showcase.signl.invalid"] = { userId: "seed-demo" };
  data["offer:seed-offer"] = {
    id: "seed-offer", businessId: "seed-biz", market: "Nashville", title: "Seed open offer", kind: "comp",
    lane: "open", status: "open", dollarCap: 100, spots: 2, createdAt: ts,
  };
  data["offer:seed-direct"] = {
    id: "seed-direct", businessId: "seed-biz", creatorId: "seed-demo", market: "Nashville", title: "Seed direct offer", kind: "comp",
    lane: "direct", status: "open", dollarCap: 100, spots: 1, createdAt: ts,
  };
  data["application:seed-app"] = {
    id: "seed-app", offerId: "seed-offer", creatorId: "seed-demo", businessId: "seed-biz", status: "applied", createdAt: ts, updatedAt: ts,
  };
  fs.writeFileSync(DB2, JSON.stringify(data));
}
const server2 = startServer(DB2, PORT2);
await waitUp(BASE2);
const admin2 = new Client(BASE2);
await admin2.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
const demoClient = new Client(BASE2);
{
  const login = await demoClient.req("POST", "/api/auth/login", { email: "demo-tesstastestn@showcase.signl.invalid", password: "demo-known-pass-67" });
  check("seeded demo can hold a session (the refusal must be the fence, not the login)", login.status === 200, `status=${login.status}`);
  const apply = await demoClient.req("POST", "/api/offers/seed-offer/apply", {});
  check("demo creator applying to a real offer is refused", apply.status === 403 && /cannot apply/.test(apply.data.error || ""), `status=${apply.status} ${JSON.stringify(apply.data).slice(0, 140)}`);
  const accept = await demoClient.req("POST", "/api/offers/seed-direct/accept", {});
  check("demo creator accepting a direct offer is refused", accept.status === 403 && /cannot accept/.test(accept.data.error || ""), `status=${accept.status} ${JSON.stringify(accept.data).slice(0, 140)}`);
  const bizClient = new Client(BASE2);
  await bizClient.req("POST", "/api/auth/login", { email: "seedbiz@fixtures.dev", password: "demo-known-pass-67" });
  const select = await bizClient.req("POST", "/api/offers/seed-offer/select", { applicationId: "seed-app" });
  check("business selecting a demo's application is refused", (select.status === 400 || select.status === 403) && /no longer on the roster/.test(select.data.error || ""), `status=${select.status} ${JSON.stringify(select.data).slice(0, 140)}`);
  const paid = await bizClient.req("POST", "/api/bookings/paid", { creatorId: "seed-demo", cashRate: 200 });
  check("paid booking a demo creator is refused", paid.status === 400 && /not on the roster/.test(paid.data.error || ""), `status=${paid.status} ${JSON.stringify(paid.data).slice(0, 140)}`);
}
server2.kill();

// --- Source checks ---
console.log("== Source checks ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("shell carries the view-as banner element", indexHtml.includes('id="viewas-banner"'), "");
  check("banner carries the exact read-only copy", appJs.includes("Read only") && appJs.includes("Nothing you do here changes their account") && appJs.includes("Exit view"), "");
  check("banner styles exist and differ from preview", styles.includes("#viewas-banner") && styles.includes(".viewas-tag"), "");
  check("View account buttons wired (Command Center + Applications)", (appJs.match(/adminViewBusiness\('/g) || []).length >= 2, "");
  check("Send sign-in link buttons wired", (appJs.match(/adminSendSigninLink\('/g) || []).length >= 2, "");
  check("first-month card renders the plan visit count", appJs.includes('id="fbz-first-month"') && appJs.includes("creator visits a month") && appJs.includes("state.boot.plans"), "");
  // Build -68 re-aim (2026-11-02): the "Set up your first month"
  // panel (id="fbz-setup") DIED in -68; the first-month card's CTA
  // now navigates to Campaigns ("Draft your first campaign" ->
  // go('dashboard','My Offers')) and the setup element must never
  // come back. This check pins the new behavior, absence included.
  check("first-month CTA navigates to Campaigns; the setup panel is gone (Build -68)", appJs.includes("Draft your first campaign") && appJs.includes("go('dashboard','My Offers')") && !appJs.includes('id="fbz-setup"') && !appJs.includes("getElementById('fbz-setup')"), "");
  check("highlight renders only from the business payload", appJs.includes("bz.highlight") && routerJs.includes(HIGHLIGHT_BIT) && routerJs.includes('"chelsea friday furniture"'), "");
  check("new founding copy is plain and dash-free", appJs.includes("You pick the moment your first month is built around") && !routerJs.includes("unprompted, and it pulled about 1,800 likes.\u2014") && appJs.includes("Nothing you do here changes their account"), "");
  check("demo showcase panel wired in Admin", appJs.includes("adminDemoShowcaseLoad") && appJs.includes("adminDemoShowcaseRemove") && appJs.includes('id="admin-demo-showcase"'), "");
  check("server refuses writes on view sessions", routerJs.includes("VIEW_AS_READ_ONLY_MESSAGE") && routerJs.includes("viewAs") && routerJs.includes("exit-view"), "");
  check("demo fence is a dedicated flag + batch", routerJs.includes('DEMO_SHOWCASE_BATCH = "nashville-2026-11"') && routerJs.includes("demoShowcaseVisibleTo"), "");
  check("demo roster is 12 fictional creators", (routerJs.match(/handle: "/g) || []).length >= 12 && routerJs.includes('handle: "tesstastestn"') && routerJs.includes('handle: "gracetembostyle"'), "");
  check("build stamp is -67 everywhere",
    fs.readFileSync(path.join(root, "netlify", "functions", "lib", "build.js"), "utf8").includes('exports.BUILD_ID = "2026.11.02-103"')
      && indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.02-103"'));
}

console.log(`\nBuild -67 verify: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
