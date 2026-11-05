#!/usr/bin/env node
// Build -99 verification (Tier 2 item 12): ONE business setup
// checklist on Home ("Get the most from SIGNL"), merging the
// Build -74 start-here cards, the launch checklist, and the
// Build -91 proof kit into a single surface, and moving the
// Square register connect's primary home into its checklist
// item (Results keeps register status, the counted data, and
// the connected/paused management; Proof Controls points to
// the checklist and hosts no Connect Square button).
//
// Proves, against a seeded throwaway store plus a local
// Square stub (the Build -44 test seams), served by the real
// dev server on port 8969:
//   - the checklist derives from real records: a fresh
//     business starts with all nine items undone, and each
//     item flips done only when its real state is written
//     through the real endpoint (baseline, staff PIN,
//     counter-card print, test redemption, business page,
//     standing hours, wishlist, campaign draft, Square OAuth);
//   - the test redemption runs from the checklist BEFORE any
//     booking exists (its Build -99 gate), flagged TEST,
//     leaving no booking and no counted totals behind;
//   - when all nine are done, allDone retires the surface on
//     the endpoint and the business-home payload alike;
//   - the Square flow is untouched: start 302s to Square,
//     callback connects, locations/sync/disconnect behave as
//     before, a paused connection reads paused, and
//     disconnect flips the checklist item back to undone;
//   - Sig knows the checklist: "what's left to set up" is
//     answered from the same records with a biz-home walk,
//     the connect question walks to Home before connecting
//     and to Results (management) after, and the home chips
//     fire only while their state is true (silence when all
//     done); a creator gets no business checklist answer;
//   - source: the merged surface renders once on both Homes,
//     no start-here / proof-kit card remains, Proof Controls
//     points to Home and hosts no Connect Square button, the
//     founding Stripe prices stay unarmed, stamp is -99.
//
// Run: node scripts/verify-build99.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8969;
const STUB_PORT = 8968;
const BASE = `http://127.0.0.1:${PORT}`;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const ADMIN_EMAIL = "admin@b99.dev";
const ADMIN_PASSWORD = "b99-admin-pass-123";

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
  async raw(method, p) {
    const headers = {};
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(this.base + p, { method, headers, redirect: "manual" });
    return { status: res.status, location: res.headers.get("location") || "", text: await res.text() };
  }
}

// ---------- the Square stub (Build -44 pattern, trimmed) ----------
const stubState = { catalog: new Map(), catalogSeq: 0 };
function stubJson(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }
const stub = http.createServer((req, res) => {
  const url = new URL(req.url, STUB);
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    let b = {};
    try { b = JSON.parse(body || "{}"); } catch (e) { /* empty */ }
    if (url.pathname === "/oauth2/authorize") {
      const state = url.searchParams.get("state") || "";
      res.writeHead(302, { Location: `${BASE}/api/me/square/callback?code=good-code&state=${encodeURIComponent(state)}` });
      return res.end("");
    }
    if (url.pathname === "/oauth2/token") {
      if (b.grant_type === "authorization_code" && b.code === "good-code") return stubJson(res, 200, { access_token: "sq-access-1", refresh_token: "sq-refresh-1", expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), merchant_id: "MERCH-1" });
      if (b.grant_type === "refresh_token" && b.refresh_token === "sq-refresh-1") return stubJson(res, 200, { access_token: "sq-access-2", expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), merchant_id: "MERCH-1" });
      return stubJson(res, 401, { errors: [{ code: "UNAUTHORIZED" }] });
    }
    if (url.pathname === "/oauth2/revoke") return stubJson(res, 200, {});
    if (req.method === "GET" && url.pathname === "/v2/merchants/MERCH-1") return stubJson(res, 200, { merchant: { id: "MERCH-1", business_name: "Stub Table LLC" } });
    if (req.method === "GET" && url.pathname === "/v2/locations") return stubJson(res, 200, { locations: [{ id: "LOC-1", name: "Downtown", status: "ACTIVE" }, { id: "LOC-2", name: "Uptown", status: "ACTIVE" }] });
    if (req.method === "POST" && url.pathname === "/v2/catalog/object") {
      stubState.catalogSeq += 1;
      const obj = { ...b.object, id: `DISC-${stubState.catalogSeq}`, version: 1 };
      stubState.catalog.set(obj.id, obj);
      return stubJson(res, 200, { catalog_object: obj });
    }
    if (url.pathname.startsWith("/v2/catalog/object/")) {
      const id = decodeURIComponent(url.pathname.split("/")[3]);
      if (req.method === "GET") { const obj = stubState.catalog.get(id); return obj ? stubJson(res, 200, { catalog_object: obj }) : stubJson(res, 404, { errors: [{ code: "NOT_FOUND" }] }); }
      if (req.method === "DELETE") { stubState.catalog.delete(id); return stubJson(res, 200, {}); }
    }
    if (req.method === "POST" && url.pathname === "/v2/orders/search") return stubJson(res, 200, { orders: [] });
    if (req.method === "POST" && url.pathname === "/v2/loyalty/events/search") return stubJson(res, 200, { events: [] });
    return stubJson(res, 404, { errors: [{ code: "NOT_FOUND", detail: url.pathname }] });
  });
});

// ---------- seeded store ----------
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-99", salt, 64).toString("hex");
const DAY = 86400000;
const now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const bizUser = (id, over = {}) => putUser({
  id, role: "business", email: `${id}@b99.dev`, name: "Owner", passwordSalt: salt, passwordHash: hash,
  status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 30 * DAY),
  business: { businessName: `B99 ${id}`, category: "Restaurant", plan: "self-service", planId: "self-service", accessState: "founding" },
  ...over,
});
// bizfresh is ACTIVE (baseline is a results setting: a founding
// business's profile PATCH refuses it by design, Build -80). Its
// market is not live, so its first campaign still saves as a
// draft, exactly the founding draft gate.
bizUser("bizfresh", { business: { businessName: "B99 bizfresh", category: "Restaurant", plan: "self-service", planId: "self-service", accessState: "active" } });
bizUser("bizdone", { business: { businessName: "B99 Done Deli", category: "Restaurant", plan: "growth", planId: "growth", accessState: "founding", about: "A finished page.", baseline: { dayLabel: "Saturday", count: 40 }, standingAvailability: { days: ["Saturday"], hours: "10 to 10", appointments: "" }, assetPacket: { logoUrl: "https://example.com/logo.png", links: [], talkingPoints: "", handle: "", hashtags: [] }, posProvider: "square" } });
bizUser("bizpaused");
putUser({ id: "cr99", role: "creator", email: "cr99@b99.dev", name: "Casey cr99", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 30 * DAY), creator: { handle: "cr99", followerCount: 3000, totalAudience: 3000, audienceStack: { instagram: 3000 }, categories: ["Food & Drink"], localAudiencePct: 70, tierBand: "Locals", profileComplete: true } });
data["staffpin:bizdone"] = { pin: "2468", setAt: iso(now0 - 2 * DAY) };
data["proofkit:bizdone"] = { counterCardPrintedAt: iso(now0 - 2 * DAY), testRedeemedAt: iso(now0 - 2 * DAY) };
data["favorite:bizdone:cr99"] = { creatorId: "cr99", createdAt: iso(now0 - 2 * DAY) };
data["offer:off-done"] = { id: "off-done", businessId: "bizdone", businessName: "B99 Done Deli", market: "Nashville", category: "Restaurant", title: "Done draft", status: "draft", lane: "open", createdAt: iso(now0 - 2 * DAY), updatedAt: iso(now0 - 2 * DAY) };
data["sqconn:bizdone"] = { businessId: "bizdone", status: "connected", env: "sandbox", businessName: "Done Deli", connectedAt: iso(now0 - 2 * DAY), locations: [{ id: "LOC-1", name: "Downtown" }], selectedLocationIds: ["LOC-1"], catalog: {}, accessTokenEnc: "x", refreshTokenEnc: "x", merchantId: "MERCH-1" };
data["sqconn:bizpaused"] = { businessId: "bizpaused", status: "paused", env: "sandbox", businessName: "Paused Place", connectedAt: iso(now0 - 9 * DAY), pausedAt: iso(now0 - 1 * DAY), locations: [{ id: "LOC-1", name: "Downtown" }], selectedLocationIds: ["LOC-1"], catalog: {}, accessTokenEnc: "x", refreshTokenEnc: "x", merchantId: "MERCH-1" };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build99-"));
const DB = path.join(tmp, "db.json");
fs.writeFileSync(DB, JSON.stringify(data));

function startServer(db, port) {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL, ADMIN_PASSWORD, SQUARE_APP_ID: "sq-stub-app-id", SQUARE_APP_SECRET: "sq-stub-app-secret", SQUARE_ENV: "sandbox", SQUARE_AUTH_URL: `${STUB}/oauth2/authorize`, SQUARE_API_BASE_URL: STUB };
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_EMAIL_FROM"]) delete env[k];
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

await new Promise((r) => stub.listen(STUB_PORT, r));
const server = startServer(DB, PORT);
process.on("exit", () => { try { server.kill("SIGKILL"); } catch (e) { /* already gone */ } try { stub.close(); } catch (e) { /* already gone */ } });
await waitUp(BASE);
const login = async (id) => { const c = new Client(BASE); const r = await c.req("POST", "/api/auth/login", { email: `${id}@b99.dev`, password: "fixture-pass-99" }); if (r.status !== 200) throw new Error(`login ${id}: ${r.status} ${JSON.stringify(r.data)}`); return c; };
const fresh = await login("bizfresh");
const done = await login("bizdone");
const paused = await login("bizpaused");
const creator = await login("cr99");
const itemsOf = async (c) => { const r = await c.req("GET", "/api/me/setup-checklist"); return r.data.setupChecklist; };
const doneOf = (cl, id) => { const it = (cl.items || []).find((i) => i.id === id); return it ? it.done : undefined; };

console.log("== The checklist derives from real records ==");
{
  const cl = await itemsOf(fresh);
  check("fresh business gets the ten-item checklist", !!cl && cl.items.length === 10 && cl.total === 10 && cl.doneCount === 0 && cl.allDone === false, JSON.stringify(cl).slice(0, 200));
  check("all ten items start undone", ["square", "till", "baseline", "pin", "counter_card", "test_redemption", "page", "hours", "creators", "campaign"].every((id) => doneOf(cl, id) === false), JSON.stringify((cl.items || []).map((i) => [i.id, i.done])));
  check("the register item carries Square's real state (configured by the stub env, not connected)", !!cl.register && cl.register.configured === true && cl.register.state === "not_connected", JSON.stringify(cl.register));
  const cr = await creator.req("GET", "/api/me/setup-checklist");
  check("a creator is refused the checklist surface", cr.status === 403, `status=${cr.status}`);
}
{
  const cl = await itemsOf(done);
  check("the seeded all-done business reads allDone (the surface retires)", !!cl && cl.allDone === true && cl.doneCount === 10, JSON.stringify(cl).slice(0, 160));
  const home = await done.req("GET", "/api/me/business-home");
  check("the business-home payload carries the same retired state", !!home.data.setupChecklist && home.data.setupChecklist.allDone === true);
}
{
  const cl = await itemsOf(paused);
  check("a paused register reads paused and its item stays undone", !!cl && cl.register.state === "paused" && doneOf(cl, "square") === false, JSON.stringify(cl.register));
  const reg = await paused.req("GET", "/api/me/square");
  check("GET /me/square still reports the paused state", reg.status === 200 && reg.data.register.state === "paused", JSON.stringify(reg.data).slice(0, 160));
}

console.log("== Each item flips only when its real state exists ==");
{
  let r = await fresh.req("PATCH", "/api/me/profile", { baseline: { dayLabel: "Saturday", count: 40 } });
  check("baseline writes through the real profile endpoint", r.status === 200, `status=${r.status}`);
  check("baseline item flips done", doneOf(await itemsOf(fresh), "baseline") === true);
  r = await fresh.req("POST", "/api/me/staff/pin", { pin: "2468" });
  check("staff PIN sets through the real endpoint", r.status === 200, `status=${r.status}`);
  check("PIN item flips done", doneOf(await itemsOf(fresh), "pin") === true);
  r = await fresh.req("POST", "/api/me/proof-kit/printed", {});
  check("counter-card print marks through the real endpoint", r.status === 200, `status=${r.status}`);
  check("counter card item flips done", doneOf(await itemsOf(fresh), "counter_card") === true);
}
{
  const before = await fresh.req("GET", "/api/bookings");
  const rcBefore = await fresh.req("GET", "/api/me/receipt");
  const tr = await fresh.req("POST", "/api/me/proof-kit/test-redeem", {});
  check("test redemption runs from the checklist BEFORE any booking exists (Build -99 gate)", tr.status === 200 && tr.data.ok === true, `status=${tr.status} ${JSON.stringify(tr.data).slice(0, 160)}`);
  check("test redemption item flips done", doneOf(await itemsOf(fresh), "test_redemption") === true);
  const after = await fresh.req("GET", "/api/bookings");
  const rcAfter = await fresh.req("GET", "/api/me/receipt");
  check("no test booking is left behind", (after.data.bookings || []).length === (before.data.bookings || []).length);
  check("counted totals are untouched by the test", rcAfter.data.receipt.customersCounted === rcBefore.data.receipt.customersCounted, `before=${rcBefore.data.receipt.customersCounted} after=${rcAfter.data.receipt.customersCounted}`);
}
{
  let r = await fresh.req("PATCH", "/api/me/profile", { about: "A real place with a real story." });
  check("about alone does not finish the page item (no logo yet)", doneOf(await itemsOf(fresh), "page") === false);
  r = await fresh.req("PATCH", "/api/me/profile", { assetPacket: { logoUrl: "https://example.com/fresh-logo.png" } });
  check("page item flips done only with name, category, about, and logo all real", r.status === 200 && doneOf(await itemsOf(fresh), "page") === true, `status=${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  r = await fresh.req("PATCH", "/api/me/profile", { standingAvailability: { days: ["Friday", "Saturday"], hours: "5 to 11", appointments: "" } });
  check("hours item flips done when standing availability is set", r.status === 200 && doneOf(await itemsOf(fresh), "hours") === true, `status=${r.status}`);
  r = await fresh.req("POST", "/api/me/wishlist", { text: "@someone99, brunch crowd" });
  check("creators item flips done when the wishlist gains a row", r.status === 200 && doneOf(await itemsOf(fresh), "creators") === true, `status=${r.status}`);
  r = await fresh.req("PATCH", "/api/me/profile", { posProvider: "square" });
  check("till item flips done when the till is declared (Build -101)", r.status === 200 && doneOf(await itemsOf(fresh), "till") === true, `status=${r.status}`);
  r = await fresh.req("POST", "/api/offers", { title: "First draft", whatComped: "Dinner for two", dollarCap: 60, spots: 1, creatorId: "cr99" });
  check("the first campaign creates through the real offers endpoint", r.status === 201 && !!r.data.offer, `status=${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  check("campaign item flips done", doneOf(await itemsOf(fresh), "campaign") === true);
  const fd = await done.req("POST", "/api/offers", { title: "Founding draft", whatComped: "Lunch for two", dollarCap: 40, spots: 1, creatorId: "cr99" });
  check("a founding business's campaign still saves as a draft and sends nothing (gates unchanged)", fd.status === 201 && fd.data.offer && fd.data.offer.status === "draft", `status=${fd.status} ${JSON.stringify(fd.data).slice(0, 160)}`);
}

console.log("== Sig knows the checklist (business only) ==");
{
  const chips = async (c) => { const h = await c.req("GET", "/api/sig/home"); return (h.data && h.data.chips) || []; };
  const ask = async (c, q) => c.req("POST", "/api/sig/ask", { q, history: [] });
  const left = await ask(fresh, "What's left to set up?");
  check("Sig answers what's left from real state: only the register remains, with the biz-home walk",
    left.status === 200 && left.data.source === "data" && /9 of 10/.test(left.data.text) && /Connect your Square register/.test(left.data.text) && left.data.link && left.data.link.dest === "biz-home",
    JSON.stringify(left.data).slice(0, 300));
  const conn = await ask(fresh, "How do I connect my Square register?");
  check("Sig walks the connect question to the checklist on Home",
    conn.status === 200 && conn.data.source === "data" && /setup checklist on Home/.test(conn.data.text) && conn.data.link && conn.data.link.dest === "biz-home",
    JSON.stringify(conn.data).slice(0, 300));
  const fc = await chips(fresh);
  check("chips: the register chip and the steps-left chip fire while true",
    fc.includes("Connect your Square register") && fc.some((c) => /setup steps? left to set up/.test(c)), JSON.stringify(fc));
  const dc = await chips(done);
  check("chips: an all-done business gets NEITHER checklist chip (silence when nothing is true)",
    !dc.includes("Connect your Square register") && !dc.some((c) => /left to set up/.test(c)), JSON.stringify(dc));
  const crAsk = await ask(creator, "What's left to set up?");
  check("a creator gets no business checklist answer", !(crAsk.data && crAsk.data.link && crAsk.data.link.dest === "biz-home") && !/Still to do: Connect your Square register/.test((crAsk.data || {}).text || ""), JSON.stringify(crAsk.data).slice(0, 200));
}

console.log("== The Square flow is untouched; the checklist item is its home ==");
{
  const start = await fresh.raw("GET", "/api/me/square/start");
  check("start still 302s to Square's authorize URL", start.status === 302 && start.location.startsWith(`${STUB}/oauth2/authorize`), `status=${start.status} loc=${start.location.slice(0, 120)}`);
  const stateParam = new URL(start.location).searchParams.get("state");
  const cb = await fresh.raw("GET", `/api/me/square/callback?code=good-code&state=${encodeURIComponent(stateParam)}`);
  check("callback still lands on /?sq=connected", cb.status === 302 && cb.location.includes("?sq=connected"), `status=${cb.status} loc=${cb.location}`);
  const reg = await fresh.req("GET", "/api/me/square");
  check("the register reads connected after the callback", reg.status === 200 && reg.data.register.connected === true && reg.data.register.state === "connected", JSON.stringify(reg.data).slice(0, 200));
  const posPatch = await fresh.req("PATCH", "/api/me/profile", { posProvider: "square" });
  check("the till question answers through the real profile PATCH", posPatch.status === 200 && posPatch.data.user.business.posProvider === "square", `status=${posPatch.status}`);
  const cl = await itemsOf(fresh);
  check("the checklist is fully done once the register connects (the surface retires)", !!cl && cl.allDone === true && cl.doneCount === 10, JSON.stringify(cl).slice(0, 160));
  const home = await fresh.req("GET", "/api/me/business-home");
  check("the business-home payload retires too", !!home.data.setupChecklist && home.data.setupChecklist.allDone === true);
  const ask2 = await fresh.req("POST", "/api/sig/ask", { q: "What's left to set up?", history: [] });
  check("Sig now answers nothing left, from the same records", ask2.data.source === "data" && /Nothing is left to set up/.test(ask2.data.text), JSON.stringify(ask2.data).slice(0, 200));
  const ask3 = await fresh.req("POST", "/api/sig/ask", { q: "How do I connect my Square register?", history: [] });
  check("Sig's connect answer now points at Results management", ask3.data.source === "data" && /is connected/.test(ask3.data.text) && ask3.data.link && ask3.data.link.dest === "biz-results", JSON.stringify(ask3.data).slice(0, 240));
  const loc = await fresh.req("POST", "/api/me/square/locations", { locationIds: ["LOC-1"] });
  check("locations save still works on the connected register", loc.status === 200 && loc.data.ok === true, `status=${loc.status}`);
  const sync = await fresh.req("POST", "/api/me/square/sync", {});
  check("sync still runs on the connected register", sync.status === 200, `status=${sync.status} ${JSON.stringify(sync.data).slice(0, 140)}`);
  const dis = await fresh.req("POST", "/api/me/square/disconnect", {});
  check("disconnect still works", dis.status === 200 && dis.data.register.connected === false, `status=${dis.status}`);
  check("disconnect flips the checklist register item back to undone", doneOf(await itemsOf(fresh), "square") === false);
  const loc2 = await fresh.req("POST", "/api/me/square/locations", { locationIds: ["LOC-1"] });
  check("locations without a connection still 404s", loc2.status === 404, `status=${loc2.status}`);
}

// ---------- source checks ----------
console.log("== Source: one surface, the moved connect, canon locks ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const sigdataJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
  check("stamp is 2026.11.05-133 on both sides", fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes("2026.11.05-133") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.05-133"));
  check("server: the checklist builder + endpoint + home payload + Sig facts feed",
    routerJs.includes("async function setupChecklistFor") && routerJs.includes('seg[1] === "setup-checklist"')
    && routerJs.includes("setupChecklist: await setupChecklistFor(user)"));
  check("the merged surface renders once on active Home and once on founding Home",
    appJs.includes("d.setupChecklist ? setupChecklistHtml(d.setupChecklist)") && appJs.includes('id="biz-setup-checklist"')
    && (appJs.match(/id="setup-checklist"/g) || []).length === 1);
  check("no leftover start-here or proof-kit cards anywhere in the client",
    !appJs.includes("startHereHtml") && !appJs.includes("proofKitHtml") && !appJs.includes('id="proof-kit"') && !appJs.includes('id="biz-start-here"'));
  const sqSlice = appJs.slice(appJs.indexOf("function squareControlsHtml"), appJs.indexOf("async function squareSaveLocations"));
  check("Proof Controls points to the checklist and hosts no Connect Square button",
    sqSlice.includes("Open the setup checklist on Home") && sqSlice.includes("Register not connected")
    && !sqSlice.includes('href="/api/me/square/start">Connect Square')
    && sqSlice.includes('href="/api/me/square/start">Reconnect Square'));
  const clSlice = appJs.slice(appJs.indexOf("function setupChecklistHtml"), appJs.indexOf("function setupGoRegister"));
  check("the checklist item hosts the real Connect Square link, plainly labeled",
    clSlice.includes('href="/api/me/square/start">Connect Square</a>') && routerJs.includes("Connect your register so visits count themselves"));
  check("Results renders no setup card anymore (the receipt loader carries no kit insert)",
    !appJs.slice(appJs.indexOf("async function loadReceipt"), appJs.indexOf("function receiptSetTab")).includes("proofKit"));
  check("Sig: the checklist answers, the biz-home walk, and both chips ship",
    sigdataJs.includes("whats left to set up") && sigdataJs.includes('"biz-home"')
    && sigdataJs.includes('chips.push("Connect your Square register")') && sigdataJs.includes("left to set up")
    && appJs.includes('case "biz-home": return go("dashboard", "Home")'));
  check("canon locks untouched: founding Stripe prices stay env-or-empty (no market live for money)",
    routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'));
  check("no em dashes in the new checklist copy",
    ["Connect your register so visits count themselves", "Get the most from SIGNL", "Your register isn't connected yet. Connect it and code visits count themselves."].every((l) => !l.includes("—") && !l.includes("–")));
}

server.kill();
try { stub.close(); } catch (e) { /* already gone */ }
console.log(`\nBuild -99 verify: ${passed} passed, ${failed} failed`);
if (fails.length) { console.error("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
process.exit(0);
