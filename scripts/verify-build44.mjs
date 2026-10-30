#!/usr/bin/env node
// Build 2026.10.30-44 verification: Square Connect, the register
// plug-in (POS blueprint §2). The whole flow runs against a
// local Square stub (test seams SQUARE_AUTH_URL /
// SQUARE_API_BASE_URL, the platform-connect pattern): OAuth
// exchange, encrypted token storage, catalog provisioning of
// creator/audience/pass codes as discounts, order read-back
// into the SAME redevent store Score v2 counts, came-back by
// pass and by loyalty match (identity never stored), typed /
// register dedupe, refund reconciliation, the paused state,
// disconnect, and the honest unconfigured state on a second
// server with no Square env at all.
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8974;
const PORT2 = 8975;
const STUB_PORT = 8976;
const BASE = `http://127.0.0.1:${PORT}`;
const BASE2 = `http://127.0.0.1:${PORT2}`;
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const ADMIN_EMAIL = "build44-admin@signl.local";
const ADMIN_PASSWORD = "build44-admin-pass";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client(base = BASE) {
  const jar = new Map();
  async function call(method, p, body, headers) {
    const h = { ...(headers || {}) };
    if (body && typeof body === "object") h["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.Cookie = cookie;
    const res = await fetch(base + p, { method, headers: h, body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined, redirect: "manual" });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, data, headers: res.headers };
  }
  call.cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  return call;
}

// ---------------- the Square stub ----------------
const stubState = {
  catalog: new Map(), // id -> object
  catalogSeq: 0,
  orders: [],
  payments: new Map(), // id -> payment
  loyaltyByOrder: new Map(), // orderId -> loyalty_account_id
  revoke: false, // token endpoint rejects refreshes
  acceptTokens: new Set(["sq-access-1", "sq-access-2"]),
};
function stubJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
const stub = http.createServer((req, res) => {
  const url = new URL(req.url, STUB);
  const parts = url.pathname.split("/").filter(Boolean);
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    let b = {};
    try { b = JSON.parse(body || "{}"); } catch (e) { /* empty */ }
    const auth = req.headers.authorization || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (url.pathname === "/oauth2/authorize") {
      const state = url.searchParams.get("state") || "";
      res.writeHead(302, { Location: `${BASE}/api/me/square/callback?code=good-code&state=${encodeURIComponent(state)}` });
      return res.end("");
    }
    if (url.pathname === "/oauth2/token") {
      if (b.grant_type === "authorization_code" && b.code === "good-code") {
        return stubJson(res, 200, { access_token: "sq-access-1", refresh_token: "sq-refresh-1", expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), merchant_id: "MERCH-1" });
      }
      if (b.grant_type === "refresh_token" && !stubState.revoke && b.refresh_token === "sq-refresh-1") {
        return stubJson(res, 200, { access_token: "sq-access-2", expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), merchant_id: "MERCH-1" });
      }
      return stubJson(res, 401, { errors: [{ category: "AUTHENTICATION_ERROR", code: "UNAUTHORIZED" }] });
    }
    if (url.pathname === "/oauth2/revoke") return stubJson(res, 200, {});
    if (!stubState.acceptTokens.has(bearer)) {
      return stubJson(res, 401, { errors: [{ category: "AUTHENTICATION_ERROR", code: "UNAUTHORIZED" }] });
    }
    if (req.method === "GET" && url.pathname === "/v2/merchants/MERCH-1") {
      return stubJson(res, 200, { merchant: { id: "MERCH-1", business_name: "Stub Kitchen LLC" } });
    }
    if (req.method === "GET" && url.pathname === "/v2/locations") {
      return stubJson(res, 200, { locations: [{ id: "LOC-1", name: "Downtown", status: "ACTIVE" }, { id: "LOC-2", name: "Uptown", status: "ACTIVE" }] });
    }
    if (req.method === "POST" && url.pathname === "/v2/catalog/object") {
      stubState.catalogSeq += 1;
      const id = `DISC-${stubState.catalogSeq}`;
      const obj = { ...b.object, id, version: 1 };
      stubState.catalog.set(id, obj);
      return stubJson(res, 200, { catalog_object: obj });
    }
    if (url.pathname.startsWith("/v2/catalog/object/")) {
      const id = decodeURIComponent(parts[3]);
      if (req.method === "GET") {
        const obj = stubState.catalog.get(id);
        return obj ? stubJson(res, 200, { catalog_object: obj }) : stubJson(res, 404, { errors: [{ code: "NOT_FOUND" }] });
      }
      if (req.method === "DELETE") { stubState.catalog.delete(id); return stubJson(res, 200, {}); }
    }
    if (req.method === "POST" && url.pathname === "/v2/orders/search") {
      const locs = b.location_ids || [];
      const range = b.query && b.query.filter && b.query.filter.date_time_filter && b.query.filter.date_time_filter.created_at || {};
      const orders = stubState.orders.filter((o) =>
        locs.includes(o.location_id) && o.state === "COMPLETED" &&
        (!range.start_at || o.created_at >= range.start_at) && (!range.end_at || o.created_at < range.end_at));
      return stubJson(res, 200, { orders });
    }
    if (req.method === "POST" && url.pathname === "/v2/orders/batch-retrieve") {
      const ids = new Set(b.order_ids || []);
      return stubJson(res, 200, { orders: stubState.orders.filter((o) => ids.has(o.id)) });
    }
    if (req.method === "GET" && url.pathname.startsWith("/v2/payments/")) {
      const p = stubState.payments.get(decodeURIComponent(parts[2]));
      return p ? stubJson(res, 200, { payment: p }) : stubJson(res, 404, { errors: [{ code: "NOT_FOUND" }] });
    }
    if (req.method === "POST" && url.pathname === "/v2/loyalty/events/search") {
      const oid = b.query && b.query.filter && b.query.filter.order_filter && b.query.filter.order_filter.order_id;
      const acct = oid ? stubState.loyaltyByOrder.get(oid) : null;
      return stubJson(res, 200, { events: acct ? [{ id: `lev-${oid}`, type: "ACCUMULATE_POINTS", loyalty_account_id: acct, order_id: oid }] : [] });
    }
    return stubJson(res, 404, { errors: [{ code: "NOT_FOUND", detail: url.pathname }] });
  });
});

// ---------------- app servers ----------------
const dir = mkdtempSync(join(tmpdir(), "signl-build44-"));
const DB = join(dir, "db.json");
const DB2 = join(dir, "db2.json");
const servers = [];
function startServer(port, db, extraEnv) {
  const s = spawn("node", ["scripts/dev-server.mjs", String(port)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: `http://127.0.0.1:${port}`, ...(extraEnv || {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  s.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  servers.push(s);
  return s;
}
async function waitUp(base) {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(base + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function makeCreator(admin, { name, email, handle }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle, followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"],
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await c("PATCH", "/api/me/profile", { publicPage: true });
  return { client: c, id: reg.data.user.id, handle, user: reg.data.user };
}
async function makeBusiness(admin, base, { name, businessName, email, planId = "growth" }) {
  const c = client(base);
  const reg = await c("POST", "/api/auth/register", {
    role: "business", name, businessName, email, password: "business-pass-123", market: "Richmond", city: "Richmond",
    category: "Restaurant", planId, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: reg.data.user.id });
  return { client: c, id: reg.data.user.id, user: reg.data.user };
}
async function makeBooking(biz, creator, title) {
  const off = await biz.client("POST", "/api/offers", { title, whatComped: "Dinner for two", dollarCap: 60, spots: 1, includesAlcohol: false, creatorId: creator.id });
  if (off.status !== 201) throw new Error(`offer failed: ${JSON.stringify(off.data)}`);
  const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
  if (acc.status !== 201) throw new Error(`accept failed: ${JSON.stringify(acc.data)}`);
  await biz.client("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
  return acc.data.booking;
}
async function completeVisit(creator, booking, slug) {
  const post = await creator.client("POST", "/api/posts", { bookingId: booking.id, url: `https://www.instagram.com/p/${slug}/`, includesDisclosure: true });
  if (post.status !== 201) throw new Error(`post failed: ${JSON.stringify(post.data)}`);
  return post.data.post;
}
async function bookingEvents(biz, bookingId) {
  const r = await biz.client("GET", `/api/bookings/${bookingId}/events`);
  if (r.status !== 200) throw new Error(`events failed: ${JSON.stringify(r.data)}`);
  return r.data.events;
}
function order({ id, at, cents, discounts = [], loc = "LOC-1", type = null, paymentId = null }) {
  return {
    id, location_id: loc, state: "COMPLETED", created_at: at,
    total_money: { amount: cents, currency: "USD" },
    discounts,
    fulfillments: type ? [{ type }] : [],
    tenders: paymentId ? [{ id: paymentId, payment_id: paymentId, type: "CARD" }] : [],
    source: { name: "Square POS" },
  };
}

try {
  await new Promise((r) => stub.listen(STUB_PORT, r));
  startServer(PORT, DB, {
    SQUARE_APP_ID: "sq-stub-app-id",
    SQUARE_APP_SECRET: "sq-stub-app-secret",
    SQUARE_ENV: "sandbox",
    SQUARE_AUTH_URL: `${STUB}/oauth2/authorize`,
    SQUARE_API_BASE_URL: STUB,
  });
  check("dev server boots (Square stub env)", await waitUp(BASE));
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });

  const boot = await client()("GET", "/api/bootstrap");
  check("bootstrap flags Square as configured, sandbox labeled", boot.data.platformConnect && boot.data.platformConnect.square && boot.data.platformConnect.square.oauthConfigured === true && boot.data.platformConnect.square.env === "sandbox", JSON.stringify(boot.data.platformConnect));
  check("bootstrap carries the -44 build stamp", boot.headers.get("x-signl-build") === "2026.10.30-51", boot.headers.get("x-signl-build"));

  const amy = await makeCreator(admin, { name: "Square Amy", email: "sqamy@fixtures.dev", handle: "sqamy" });
  const kitchen = await makeBusiness(admin, BASE, { name: "Kai Owner", businessName: "Square Kitchen", email: "sqkai@fixtures.dev" });
  // The welcome offer is ON at 10% before the booking exists, so
  // the booking stamps 10% and its Square discount is a real 10%.
  await kitchen.client("PATCH", "/api/me/profile", { discountEnabled: true, discountPct: 10 });
  const booking = await makeBooking(kitchen, amy, "Square Supper");
  check("booking carries a creator code and the 10% stamp", !!booking.creatorCode && booking.discountPct === 10, JSON.stringify({ code: booking.creatorCode, pct: booking.discountPct }));
  await completeVisit(amy, booking, "sqsupper");

  // ---- unconnected state ----
  const st0 = await kitchen.client("GET", "/api/me/square");
  check("before connect: configured, not connected", st0.data.register.configured === true && st0.data.register.connected === false && st0.data.register.state === "not_connected", JSON.stringify(st0.data.register));
  const rec0 = await kitchen.client("GET", "/api/me/receipt");
  check("receipt carries the not-connected register state", rec0.data.receipt.register && rec0.data.receipt.register.state === "not_connected");

  // A register order from BEFORE the connect must never be read.
  stubState.orders.push(order({ id: "ORD-OLD", at: new Date(Date.now() - 86400000).toISOString(), cents: 9900, discounts: [{ uid: "dx", name: booking.creatorCode, applied_money: { amount: 1100 } }] }));

  // ---- OAuth round trip ----
  const start = await kitchen.client("GET", "/api/me/square/start");
  const authUrl = start.headers.get("location") || "";
  check("start redirects to Square's authorize screen with the counting scopes", start.status === 302 && authUrl.startsWith(`${STUB}/oauth2/authorize`) && authUrl.includes("ORDERS_READ") && authUrl.includes("LOYALTY_READ") && authUrl.includes("ITEMS_WRITE") && authUrl.includes("state="), authUrl);
  const authRes = await fetch(authUrl, { redirect: "manual" });
  const callbackUrl = authRes.headers.get("location") || "";
  check("stub authorize returns to the SIGNL callback", callbackUrl.startsWith(`${BASE}/api/me/square/callback`) && callbackUrl.includes("code=good-code"), callbackUrl);
  const cbRes = await fetch(callbackUrl, { headers: { Cookie: kitchen.client.cookieHeader() }, redirect: "manual" });
  check("callback lands back in the app as connected", cbRes.status === 302 && (cbRes.headers.get("location") || "").includes("sq=connected"), cbRes.headers.get("location"));

  const st1 = await kitchen.client("GET", "/api/me/square");
  check("after connect: connected, merchant named, both locations selected", st1.data.register.connected === true && st1.data.register.businessName === "Stub Kitchen LLC" && st1.data.register.locations.length === 2 && st1.data.register.locations.every((l) => l.selected), JSON.stringify(st1.data.register));
  check("connection is labeled sandbox", st1.data.register.env === "sandbox");
  const codeDiscount = [...stubState.catalog.values()].find((o) => o.discount_data && o.discount_data.name === booking.creatorCode);
  check("creator code provisioned as a real 10% Square discount", !!codeDiscount && codeDiscount.discount_data.discount_type === "FIXED_PERCENTAGE" && codeDiscount.discount_data.percentage === "10", JSON.stringify([...stubState.catalog.values()]));
  const codeDiscountId = codeDiscount && codeDiscount.id;

  // Tokens at rest are ciphertext, never the stub's plaintext.
  const rawDb = readFileSync(DB, "utf8");
  check("stored tokens are encrypted at rest (no plaintext token in the store)", !rawDb.includes("sq-access-1") && !rawDb.includes("sq-refresh-1") && rawDb.includes("enc:v1:"), "");
  check("no register events exist yet: nothing backfilled from before the connect", (await bookingEvents(kitchen, booking.id)).length === 0);

  // ---- first read-back: a code order becomes a counted event ----
  const nowIsoS = () => new Date().toISOString();
  stubState.orders.push(order({ id: "ORD-1", at: nowIsoS(), cents: 6000, loc: "LOC-1", type: "PICKUP", paymentId: "PAY-1", discounts: [{ uid: "d1", catalog_object_id: codeDiscountId, name: booking.creatorCode, applied_money: { amount: 667, currency: "USD" } }] }));
  stubState.payments.set("PAY-1", { id: "PAY-1", status: "COMPLETED", amount_money: { amount: 6000 }, refunded_money: { amount: 0 } });
  stubState.loyaltyByOrder.set("ORD-1", "LOY-ACCOUNT-1");
  const sync1 = await kitchen.client("POST", "/api/me/square/sync", {});
  check("sync runs clean", sync1.status === 200 && sync1.data.ok === true, JSON.stringify(sync1.data).slice(0, 200));
  let evs = await bookingEvents(kitchen, booking.id);
  const sqFirst = evs.find((e) => e.squareOrderId === "ORD-1");
  check("code order became a first-visit register event with the rung total", !!sqFirst && sqFirst.kind === "first" && sqFirst.amount === 60 && sqFirst.source === "square" && sqFirst.channel === "pickup", JSON.stringify(evs).slice(0, 300));
  check("the loyalty identity itself is nowhere in the store", !readFileSync(DB, "utf8").includes("LOY-ACCOUNT-1"), "");
  const rec1 = await kitchen.client("GET", "/api/me/receipt");
  check("receipt register state shows the read-back (lastSyncAt + firsts)", rec1.data.receipt.register.state === "connected" && !!rec1.data.receipt.register.lastSyncAt && rec1.data.receipt.register.lastSyncSummary.firsts === 1, JSON.stringify(rec1.data.receipt.register.lastSyncSummary));
  await kitchen.client("POST", "/api/me/square/sync", {});
  evs = await bookingEvents(kitchen, booking.id);
  check("a second sync writes no duplicate", evs.filter((e) => e.squareOrderId === "ORD-1").length === 1 && evs.length === 1, JSON.stringify(evs.length));

  // ---- the issued pass gets provisioned, then rung ----
  const passDiscount = [...stubState.catalog.values()].find((o) => o.discount_data && /^BACK-/.test(o.discount_data.name || ""));
  check("the came-back pass from the square first was provisioned as a counting discount", !!passDiscount && passDiscount.discount_data.discount_type === "VARIABLE_PERCENTAGE" && passDiscount.discount_data.percentage === "0", JSON.stringify([...stubState.catalog.values()].map((o) => o.discount_data)));
  stubState.orders.push(order({ id: "ORD-2", at: nowIsoS(), cents: 3000, loc: "LOC-1", discounts: [{ uid: "d2", name: passDiscount.discount_data.name, applied_money: { amount: 0 } }] }));
  await kitchen.client("POST", "/api/me/square/sync", {});
  evs = await bookingEvents(kitchen, booking.id);
  const passReturn = evs.find((e) => e.squareOrderId === "ORD-2");
  check("pass rung at Square became a came-back event on the original visit", !!passReturn && passReturn.kind === "return" && passReturn.amount === 30 && !!passReturn.passId, JSON.stringify(evs).slice(0, 300));

  // ---- loyalty came-back: no code, same register customer ----
  stubState.orders.push(order({ id: "ORD-3", at: nowIsoS(), cents: 4500, loc: "LOC-1" }));
  stubState.loyaltyByOrder.set("ORD-3", "LOY-ACCOUNT-1");
  await kitchen.client("POST", "/api/me/square/sync", {});
  evs = await bookingEvents(kitchen, booking.id);
  const loyReturn = evs.find((e) => e.squareOrderId === "ORD-3");
  check("loyalty match produced a came-back event with no identity attached", !!loyReturn && loyReturn.kind === "return" && loyReturn.amount === 45 && loyReturn.matchVia === "loyalty" && !JSON.stringify(loyReturn).includes("LOY-ACCOUNT-1"), JSON.stringify(loyReturn));
  stubState.orders.push(order({ id: "ORD-4", at: nowIsoS(), cents: 2000, loc: "LOC-1" }));
  stubState.loyaltyByOrder.set("ORD-4", "LOY-ACCOUNT-1");
  await kitchen.client("POST", "/api/me/square/sync", {});
  evs = await bookingEvents(kitchen, booking.id);
  check("the loyalty match is spent: a third visit does not double-count the return", !evs.some((e) => e.squareOrderId === "ORD-4"), JSON.stringify(evs.map((e) => e.squareOrderId)));

  // ---- the register wins over a typed duplicate ----
  const typed = await kitchen.client("POST", `/api/bookings/${booking.id}/code-uses`, { count: 1, amount: 25 });
  check("typed tally still works beside the connection", typed.status === 201 && !!typed.data.redemptionEvent, JSON.stringify(typed.data).slice(0, 160));
  stubState.orders.push(order({ id: "ORD-5", at: nowIsoS(), cents: 2500, loc: "LOC-1", discounts: [{ uid: "d5", catalog_object_id: codeDiscountId, name: booking.creatorCode, applied_money: { amount: 278 } }] }));
  await kitchen.client("POST", "/api/me/square/sync", {});
  evs = await bookingEvents(kitchen, booking.id);
  const typedEv = evs.find((e) => e.id === typed.data.redemptionEvent.id);
  const sqDupe = evs.find((e) => e.squareOrderId === "ORD-5");
  check("same check typed and rung: the typed copy is voided into the trail, the register copy stands", !!sqDupe && !sqDupe.voided && !!typedEv && typedEv.voided === true && (typedEv.corrections || []).some((c) => c.by === "square"), JSON.stringify({ typedEv, sqDupe }).slice(0, 300));

  // ---- refunds come out of the count ----
  stubState.payments.set("PAY-1", { id: "PAY-1", status: "COMPLETED", amount_money: { amount: 6000 }, refunded_money: { amount: 6000 } });
  await kitchen.client("POST", "/api/me/square/sync", {});
  evs = await bookingEvents(kitchen, booking.id);
  const refunded = evs.find((e) => e.squareOrderId === "ORD-1");
  check("a fully refunded check leaves the count, with the reason in the trail", !!refunded && refunded.voided === true && (refunded.corrections || []).some((c) => /refunded/i.test(c.note || "")), JSON.stringify(refunded && refunded.corrections));

  // ---- location selection is honored ----
  const locSet = await kitchen.client("POST", "/api/me/square/locations", { locationIds: ["LOC-2"] });
  check("locations can be narrowed to one register", locSet.status === 200 && locSet.data.register.locations.filter((l) => l.selected).length === 1, JSON.stringify(locSet.data.register && locSet.data.register.locations));
  stubState.orders.push(order({ id: "ORD-6", at: nowIsoS(), cents: 5100, loc: "LOC-1", discounts: [{ uid: "d6", catalog_object_id: codeDiscountId, name: booking.creatorCode, applied_money: { amount: 567 } }] }));
  await kitchen.client("POST", "/api/me/square/sync", {});
  evs = await bookingEvents(kitchen, booking.id);
  check("orders at an unselected location are not read", !evs.some((e) => e.squareOrderId === "ORD-6"));
  await kitchen.client("POST", "/api/me/square/locations", { locationIds: ["LOC-1", "LOC-2"] });

  // ---- the sweep route syncs without a session ----
  const sweepAnon = await client()("POST", "/api/admin/square/sync", {});
  check("the sweep route refuses anonymous callers", sweepAnon.status === 403, String(sweepAnon.status));
  const sweepAdmin = await admin("POST", "/api/admin/square/sync", {});
  check("an admin session can run the read-back sweep", sweepAdmin.status === 200 && sweepAdmin.data.ok === true && sweepAdmin.data.sweep.connections === 1, JSON.stringify(sweepAdmin.data).slice(0, 200));
  const admSq = await admin("GET", "/api/admin/square");
  check("admin sees the connection with its sandbox label and no tokens", admSq.status === 200 && admSq.data.square.env === "sandbox" && admSq.data.square.connections.length === 1 && !JSON.stringify(admSq.data).includes("sq-access"), JSON.stringify(admSq.data).slice(0, 200));

  // ---- a dead grant pauses, plainly; a live one heals ----
  stubState.acceptTokens = new Set();
  stubState.revoke = true;
  const pausedSync = await kitchen.client("POST", "/api/me/square/sync", {});
  const stP = await kitchen.client("GET", "/api/me/square");
  check("a revoked grant flips the connection to paused with a date", pausedSync.data.ok === false && stP.data.register.state === "paused" && !!stP.data.register.pausedAt, JSON.stringify(stP.data.register));
  stubState.acceptTokens = new Set(["sq-access-1", "sq-access-2"]);
  stubState.revoke = false;
  const healed = await kitchen.client("POST", "/api/me/square/sync", {});
  const stH = await kitchen.client("GET", "/api/me/square");
  check("the next good read heals the paused state", healed.data.ok === true && stH.data.register.state === "connected", JSON.stringify(stH.data.register));

  // ---- disconnect deletes the connection ----
  const disc = await kitchen.client("POST", "/api/me/square/disconnect", {});
  const stD = await kitchen.client("GET", "/api/me/square");
  check("disconnect returns the panel to not-connected", disc.status === 200 && stD.data.register.connected === false && stD.data.register.state === "not_connected", JSON.stringify(stD.data.register));
  const admSq2 = await admin("GET", "/api/admin/square");
  check("admin sees no connection after disconnect, and the counted events remain", admSq2.data.square.connections.length === 0 && (await bookingEvents(kitchen, booking.id)).filter((e) => !e.voided).length >= 3);

  // ---- second server: no Square env, the honest state ----
  startServer(PORT2, DB2, { SQUARE_APP_ID: "", SQUARE_APP_SECRET: "", SQUARE_API_BASE_URL: "", SQUARE_AUTH_URL: "" });
  check("second server boots without Square env", await waitUp(BASE2));
  const admin2 = client(BASE2);
  await admin2("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await admin2("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });
  const boot2 = await client(BASE2)("GET", "/api/bootstrap");
  check("unconfigured bootstrap: Square flagged off", boot2.data.platformConnect.square.oauthConfigured === false, JSON.stringify(boot2.data.platformConnect.square));
  const biz2 = await makeBusiness(admin2, BASE2, { name: "Una Owner", businessName: "Unconfigured Cafe", email: "una@fixtures.dev" });
  const stU = await biz2.client("GET", "/api/me/square");
  check("unconfigured: the status says so instead of pretending", stU.data.register.configured === false && stU.data.register.connected === false, JSON.stringify(stU.data.register));
  const startU = await biz2.client("GET", "/api/me/square/start");
  check("unconfigured: start bounces to the concierge state, never a dead OAuth link", startU.status === 302 && (startU.headers.get("location") || "").includes("sq=unavailable"), startU.headers.get("location"));

  console.log(`\nverify-build44: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log("failures:", failures.join(" | "));
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error("verify-build44 crashed:", e);
  process.exitCode = 1;
} finally {
  for (const s of servers) { try { s.kill("SIGTERM"); } catch (e) { /* gone */ } }
  stub.close();
}
