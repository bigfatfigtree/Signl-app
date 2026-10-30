// Square Connect (Build -44): the register plug-in from the POS
// automation blueprint (goal files, 2026-10-30). A business
// connects its Square register once, from Proof Controls, through
// Square's own OAuth screen. From then on SIGNL reads back the
// orders its creators' codes touched and writes the SAME counted
// register events (redevent: records) the typed tally writes, so
// Score v2 counts register-fed and till-typed months off one
// model. Square events carry source: "square" and their true
// register timestamps; the Receipt labels them from that tag.
//
// HONESTY LOCKS (blueprint §2, binding):
//   - Nothing is backfilled: orders from before the connect are
//     never read into the count.
//   - Only orders carrying a provisioned SIGNL code (creator
//     code, audience code, or a Came-Back Pass code) ever become
//     events. Non-code orders are never read into any number;
//     the business's total Square sales are never stored, shown,
//     or used as a denominator anywhere.
//   - Loyalty matching stores NO identity: the match key is an
//     HMAC of the Square loyalty account id, kept in sqloy:
//     records that no API response ever returns. What persists
//     is the match event and its total, exactly like a pass
//     redemption. A came-back still requires a validated first
//     event WITH an amount, inside the same 30-day window.
//   - Comp cost is never read from Square. It stays the
//     business's own confirmed number (blueprint §2.4).
//   - Where Square is connected it is the source of truth for
//     the orders it reports: a typed event that duplicates a
//     Square-reported order is voided into the correction trail
//     automatically, and a Square order later refunded or voided
//     takes its event out of the count the same way.
//   - Disconnect deletes the stored tokens immediately and stops
//     all reads; events already recorded stay recorded.
//
// TOKENS: OAuth tokens live ONLY in sqconn: records, encrypted
// at rest (AES-256-GCM; key derived from SIGNL_TOKEN_ENC_KEY
// when set, else from the Square app secret itself: either way
// the store never holds a usable plaintext token). Tokens never
// appear on any client payload; publicSquareState is the only
// shape that leaves the server.
//
// CONFIG (env): SQUARE_APP_ID / SQUARE_APP_SECRET enable the
// flow; SQUARE_ENV=sandbox selects the sandbox hosts (default
// production); SQUARE_REDIRECT_URI overrides the callback
// (default {APP_URL}/api/me/square/callback). With the app
// credentials absent the connect surface renders the approved
// concierge wording instead of a dead button (the same honest
// "being enabled" pattern as platform-connect's YouTube gate).
//
// TEST SEAMS (unset in production): SQUARE_AUTH_URL and
// SQUARE_API_BASE_URL override the Square endpoints so the
// verify suite can run the whole flow against a local stub.

const crypto = require("crypto");
const store = require("./store");
const { logEvent } = require("./events");
const platformConnect = require("./platform-connect");

const SQUARE_VERSION = "2025-01-23";
const RETURN_WINDOW_DAYS = 30;
const RECHECK_DAYS = 45;
const SYNC_OVERLAP_MS = 48 * 60 * 60 * 1000;
// The minimum the counting runs on, each with its plain-words
// reason for the connect screen (blueprint §2.2). ITEMS_READ /
// ITEMS_WRITE are what §2.3's provisioning runs on: a creator
// code can only become a discount on the register if SIGNL may
// put it there. Nothing else is requested: no catalog edits
// beyond the code discounts, no customer list, no write access
// to orders or payments.
const SQUARE_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "ORDERS_READ",
  "PAYMENTS_READ",
  "LOYALTY_READ",
  "ITEMS_READ",
  "ITEMS_WRITE",
];

// ---------- config ----------

function squareEnv() {
  return process.env.SQUARE_ENV === "sandbox" ? "sandbox" : "production";
}
function squareConfigured() {
  return !!(process.env.SQUARE_APP_ID && process.env.SQUARE_APP_SECRET);
}
function squareApiBase() {
  const fallback = squareEnv() === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
  return (process.env.SQUARE_API_BASE_URL || fallback).replace(/\/+$/, "");
}
function squareAuthUrl() {
  return process.env.SQUARE_AUTH_URL || `${squareApiBase()}/oauth2/authorize`;
}
function squareRedirectUri() {
  if (process.env.SQUARE_REDIRECT_URI) return process.env.SQUARE_REDIRECT_URI;
  return `${platformConnect.appBaseUrl()}/api/me/square/callback`;
}

// ---------- token encryption at rest ----------

function encKey() {
  const raw = process.env.SIGNL_TOKEN_ENC_KEY || process.env.SQUARE_APP_SECRET || "";
  if (!raw) return null;
  return crypto.createHash("sha256").update(`signl-token-enc:${raw}`).digest();
}
function encryptSecret(plain) {
  if (!plain || typeof plain !== "string") return null;
  const key = encKey();
  if (!key) return null; // no key material: refuse to store a token at all
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}
function decryptSecret(stored) {
  if (!stored || typeof stored !== "string") return null;
  if (!stored.startsWith("enc:v1:")) return stored; // pre-encryption record (none should exist)
  const key = encKey();
  if (!key) return null;
  const parts = stored.split(":");
  if (parts.length !== 5) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[2], "base64"));
    decipher.setAuthTag(Buffer.from(parts[3], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[4], "base64")), decipher.final()]).toString("utf8");
  } catch (e) {
    return null;
  }
}

// Loyalty match keys: a one-way HMAC of the loyalty account id.
// The account id itself is used inside one sync pass and never
// written anywhere; surfaces only ever see the match event.
function loyaltyKey(businessId, loyaltyAccountId) {
  const key = encKey() || crypto.createHash("sha256").update("signl-loyalty").digest();
  const mac = crypto.createHmac("sha256", key).update(String(loyaltyAccountId)).digest("hex");
  return `sqloy:${businessId}:${mac}`;
}

// ---------- connection records ----------

function connKey(businessId) {
  return `sqconn:${businessId}`;
}
async function getSquareConnection(businessId) {
  return (await store.get(connKey(businessId))) || null;
}
async function saveSquareConnection(conn) {
  conn.updatedAt = new Date().toISOString();
  await store.set(connKey(conn.businessId), conn);
  return conn;
}
async function deleteSquareConnection(businessId) {
  await store.del(connKey(businessId));
  // Loyalty match keys are useless without the feed and are the
  // only identity-adjacent data we hold: they go with the tokens.
  const rows = await store.list(`sqloy:${businessId}:`);
  for (const r of rows) await store.del(r.key);
}
async function listSquareConnections() {
  const rows = await store.list("sqconn:");
  return rows.map((r) => r.value).filter(Boolean);
}

function connAccessToken(conn) {
  return decryptSecret(conn.accessTokenEnc);
}

// ---------- Square HTTP ----------

class SquarePausedError extends Error {
  constructor(message) {
    super(message || "Square stopped sharing checks");
    this.squarePaused = true;
  }
}

async function squareFetch(path, { method = "GET", body = null, token = null, rawBase = null } = {}) {
  const res = await fetch(`${rawBase || squareApiBase()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === null ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const first = data && Array.isArray(data.errors) && data.errors[0] ? data.errors[0] : null;
    const e = new Error(`Square request failed (HTTP ${res.status}${first && first.code ? ` ${first.code}` : ""})`);
    e.status = res.status;
    e.squareErrors = data && data.errors ? data.errors : null;
    throw e;
  }
  return data;
}

// Token exchange / refresh. Square answers with JSON and a
// fresh refresh token only when it issues one; keep the stored
// refresh token when the response carries none.
async function postTokenRequest(fields) {
  const res = await fetch(`${squareApiBase()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.access_token) {
    const e = new Error(`Square token request failed (HTTP ${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

async function exchangeSquareCode(code) {
  return postTokenRequest({
    client_id: process.env.SQUARE_APP_ID || "",
    client_secret: process.env.SQUARE_APP_SECRET || "",
    code,
    grant_type: "authorization_code",
  });
}

async function refreshSquareTokens(conn) {
  const refreshToken = decryptSecret(conn.refreshTokenEnc);
  if (!refreshToken) throw new SquarePausedError("No refresh token stored for this Square connection");
  let data;
  try {
    data = await postTokenRequest({
      client_id: process.env.SQUARE_APP_ID || "",
      client_secret: process.env.SQUARE_APP_SECRET || "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  } catch (e) {
    throw new SquarePausedError("Square stopped sharing checks");
  }
  conn.accessTokenEnc = encryptSecret(data.access_token);
  if (data.refresh_token) conn.refreshTokenEnc = encryptSecret(data.refresh_token);
  conn.tokenExpiresAt = Date.parse(data.expires_at || "") || Date.now() + 30 * 86400000;
  await saveSquareConnection(conn);
  return conn;
}

// One API call with the connection's token, refreshing once
// when the stored token is near expiry or Square rejects it.
// A rejected refresh pauses the connection (blueprint §2.5):
// the panel flips to its plain paused sentence and typed
// capture carries the count until the owner reconnects.
async function apiCall(conn, path, opts = {}) {
  let token = connAccessToken(conn);
  if (!token || (conn.tokenExpiresAt && Date.now() > conn.tokenExpiresAt - 60000)) {
    await refreshSquareTokens(conn);
    token = connAccessToken(conn);
  }
  try {
    return await squareFetch(path, { ...opts, token });
  } catch (e) {
    if (e.status !== 401 && e.status !== 403) throw e;
    await refreshSquareTokens(conn); // throws SquarePausedError when the grant is gone
    return squareFetch(path, { ...opts, token: connAccessToken(conn) });
  }
}

async function markPaused(conn, reason) {
  conn.status = "paused";
  conn.pausedAt = new Date().toISOString();
  conn.pausedReason = reason || "Square stopped sharing checks";
  await saveSquareConnection(conn);
  return conn;
}

// ---------- OAuth ----------

function buildSquareAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.SQUARE_APP_ID || "",
    scope: SQUARE_SCOPES.join(" "),
    session: "false",
    state,
  });
  return `${squareAuthUrl()}?${params.toString()}`;
}

// ---------- connect / disconnect ----------

async function fetchMerchant(conn) {
  const data = await apiCall(conn, `/v2/merchants/${encodeURIComponent(conn.merchantId)}`);
  return (data && data.merchant) || null;
}
async function fetchLocations(conn) {
  const data = await apiCall(conn, "/v2/locations");
  const list = data && Array.isArray(data.locations) ? data.locations : [];
  return list
    .filter((l) => l && l.id && l.status !== "INACTIVE")
    .map((l) => ({ id: l.id, name: l.name || l.id }));
}

// The full connect: exchange the code, learn which business and
// locations this is, save the connection with encrypted tokens,
// provision the code discounts, and run the first read-back.
// The first read-back starts AT the connect moment: nothing
// from before it is ever read (blueprint §2.1, no silent
// backfill).
async function connectSquare(businessId, code) {
  const tokens = await exchangeSquareCode(code);
  const now = new Date().toISOString();
  const existing = await getSquareConnection(businessId);
  const conn = {
    businessId,
    merchantId: tokens.merchant_id || (existing && existing.merchantId) || null,
    env: squareEnv(),
    accessTokenEnc: encryptSecret(tokens.access_token),
    refreshTokenEnc: encryptSecret(tokens.refresh_token) || (existing && existing.refreshTokenEnc) || null,
    tokenExpiresAt: Date.parse(tokens.expires_at || "") || Date.now() + 30 * 86400000,
    businessName: (existing && existing.businessName) || null,
    locations: (existing && existing.locations) || [],
    selectedLocationIds: (existing && existing.selectedLocationIds) || [],
    status: "connected",
    pausedAt: null,
    pausedReason: null,
    connectedAt: (existing && existing.connectedAt) || now,
    lastSyncAt: (existing && existing.lastSyncAt) || null,
    lastSyncSummary: (existing && existing.lastSyncSummary) || null,
    catalog: (existing && existing.catalog) || {},
  };
  if (!conn.accessTokenEnc) throw new Error("Square connected, but SIGNL could not store the token safely, so nothing was saved.");
  await saveSquareConnection(conn);
  const merchant = await fetchMerchant(conn).catch(() => null);
  if (merchant && merchant.business_name) conn.businessName = merchant.business_name;
  const locations = await fetchLocations(conn).catch(() => []);
  if (locations.length) {
    conn.locations = locations;
    if (!conn.selectedLocationIds.length) conn.selectedLocationIds = locations.map((l) => l.id);
    else conn.selectedLocationIds = conn.selectedLocationIds.filter((id) => locations.some((l) => l.id === id));
    if (!conn.selectedLocationIds.length) conn.selectedLocationIds = locations.map((l) => l.id);
  }
  await saveSquareConnection(conn);
  await provisionCatalog(conn).catch((e) => console.error("SIGNL Square provisioning after connect failed:", e));
  const sync = await syncSquareBusiness(businessId).catch((e) => ({ state: "error", error: String((e && e.message) || e) }));
  return { conn: await getSquareConnection(businessId), sync };
}

// Disconnect (blueprint §2.5): revoke at Square best-effort,
// then delete the stored tokens immediately and stop all reads.
// Events already recorded remain the business's receipt history.
async function disconnectSquare(businessId) {
  const conn = await getSquareConnection(businessId);
  if (!conn) return { wasConnected: false };
  const token = connAccessToken(conn);
  if (token && squareConfigured()) {
    try {
      await fetch(`${squareApiBase()}/oauth2/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Client ${process.env.SQUARE_APP_SECRET}` },
        body: JSON.stringify({ client_id: process.env.SQUARE_APP_ID, access_token: token }),
      });
    } catch (e) { /* revocation is best-effort; local deletion is the guarantee */ }
  }
  await deleteSquareConnection(businessId);
  return { wasConnected: true };
}

// ---------- catalog provisioning ----------
// Each active SIGNL code becomes one discount on the business's
// own Square catalog, named exactly the code (that is the word
// the customer says at the till). A code whose booking carries
// a real percentage becomes that percentage discount; a code
// with no percentage (the welcome offer is Off, an audience
// perk, a Came-Back Pass) becomes a VARIABLE_PERCENTAGE
// discount resting at 0: the discount object on the order is
// what counting reads, and its applied money is 0, so the rung
// total is the customer's full check either way. Provisioning
// is idempotent: the connection record carries the map, and a
// code whose object already exists is verified, not recreated.

function discountObjectFor(code, pct) {
  const hasPct = typeof pct === "number" && Number.isFinite(pct) && pct > 0 && pct < 100;
  return {
    type: "DISCOUNT",
    id: "#signl-code",
    discount_data: hasPct
      ? { name: code, discount_type: "FIXED_PERCENTAGE", percentage: String(pct), modify_tax_basis: "MODIFY_TAX_BASIS" }
      : { name: code, discount_type: "VARIABLE_PERCENTAGE", percentage: "0", modify_tax_basis: "MODIFY_TAX_BASIS" },
  };
}

async function upsertDiscount(conn, code, pct) {
  const data = await apiCall(conn, "/v2/catalog/object", {
    method: "POST",
    body: { idempotency_key: crypto.randomUUID(), object: discountObjectFor(code, pct) },
  });
  const obj = data && data.catalog_object;
  if (!obj || !obj.id) throw new Error("Square did not return a catalog object for a code discount");
  return obj.id;
}

async function desiredCodes(businessId) {
  const [bookings, acodes, passes] = await Promise.all([
    store.list("booking:"),
    store.list("acode:"),
    store.list("pass:"),
  ]);
  const out = [];
  for (const r of bookings) {
    const b = r.value;
    if (!b || b.businessId !== businessId || b.status === "cancelled" || !b.creatorCode) continue;
    out.push({
      mapKey: `booking:${b.id}`,
      kind: "creator",
      code: String(b.creatorCode),
      pct: typeof b.discountPct === "number" ? b.discountPct : 0,
      bookingId: b.id,
      creatorId: b.creatorId || null,
    });
  }
  for (const r of acodes) {
    const c = r.value;
    if (!c || c.businessId !== businessId || c.status !== "active" || !c.code) continue;
    out.push({
      mapKey: `acode:${c.id}`,
      kind: "audience",
      code: String(c.code),
      pct: 0,
      bookingId: c.bookingId || null,
      creatorId: c.creatorId || null,
      audienceCodeId: c.id,
    });
  }
  const now = Date.now();
  for (const r of passes) {
    const p = r.value;
    if (!p || p.businessId !== businessId || p.status !== "issued" || !p.code) continue;
    if ((Date.parse(p.expiresAt || "") || 0) < now) continue;
    out.push({
      mapKey: `pass:${p.id}`,
      kind: "pass",
      code: String(p.code),
      pct: 0,
      bookingId: p.firstBookingId || null,
      creatorId: p.creatorId || null,
      passId: p.id,
    });
  }
  return out;
}

async function provisionCatalog(conn, { verifyExisting = false } = {}) {
  const desired = await desiredCodes(conn.businessId);
  conn.catalog = conn.catalog && typeof conn.catalog === "object" ? conn.catalog : {};
  let created = 0;
  let verified = 0;
  for (const d of desired) {
    const cur = conn.catalog[d.mapKey];
    if (cur && cur.code === d.code && cur.pct === d.pct && cur.catalogObjectId) {
      if (verifyExisting) {
        try {
          await apiCall(conn, `/v2/catalog/object/${encodeURIComponent(cur.catalogObjectId)}`);
          verified += 1;
          continue;
        } catch (e) { /* the object is gone at Square: fall through and recreate it */ }
      } else {
        verified += 1;
        continue;
      }
    }
    const catalogObjectId = await upsertDiscount(conn, d.code, d.pct);
    if (cur && cur.catalogObjectId && cur.catalogObjectId !== catalogObjectId) {
      // The code's percentage changed (or the object vanished):
      // retire the stale object best-effort so staff are not
      // offered two buttons with the same name.
      try { await apiCall(conn, `/v2/catalog/object/${encodeURIComponent(cur.catalogObjectId)}`, { method: "DELETE" }); } catch (e) { /* best-effort */ }
    }
    conn.catalog[d.mapKey] = {
      catalogObjectId,
      kind: d.kind,
      code: d.code,
      pct: d.pct,
      bookingId: d.bookingId || null,
      creatorId: d.creatorId || null,
      audienceCodeId: d.audienceCodeId || null,
      passId: d.passId || null,
    };
    created += 1;
  }
  await saveSquareConnection(conn);
  return { created, verified, total: desired.length };
}

// ---------- read-back: orders become counted events ----------

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function nowIso() {
  return new Date().toISOString();
}
function channelForOrder(order) {
  const f = Array.isArray(order.fulfillments) && order.fulfillments[0] ? order.fulfillments[0] : null;
  if (f && f.type === "DELIVERY") return "delivery";
  if (f && f.type === "PICKUP") return "pickup";
  if (f && f.type === "SHIPMENT") return "delivery";
  return "in_store";
}

// The discounts actually applied on an order: order-level
// discount entries (each present because it was applied), which
// also cover line-item applications through their uids.
function appliedDiscounts(order) {
  const out = [];
  const seen = new Set();
  for (const d of Array.isArray(order.discounts) ? order.discounts : []) {
    if (!d) continue;
    const key = d.catalog_object_id || d.name || d.uid;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

async function loyaltyAccountForOrder(conn, orderId) {
  try {
    const data = await apiCall(conn, "/v2/loyalty/events/search", {
      method: "POST",
      body: { query: { filter: { order_filter: { order_id: orderId } } }, limit: 10 },
    });
    const events = data && Array.isArray(data.events) ? data.events : [];
    const hit = events.find((e) => e && e.loyalty_account_id);
    return hit ? hit.loyalty_account_id : null;
  } catch (e) {
    return null; // no loyalty program (or no grant): the pass path still counts returns
  }
}

// Mirror of the pass record the typed register flow issues
// (router's issueComeBackPass): same shape, same 30-day window,
// so a Square-counted first visit hands the customer the same
// pass a typed one does.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
async function issuePassForSquareFirst(booking, firstEvent) {
  const existing = (await store.list("pass:")).map((r) => r.value).filter(Boolean);
  let code = "";
  for (let tries = 0; tries < 8 && !code; tries++) {
    const candidate = "BACK-" + Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join("");
    if (!existing.some((x) => x.code === candidate)) code = candidate;
  }
  if (!code) return null;
  const pass = {
    id: crypto.randomUUID(), code,
    businessId: booking.businessId, creatorId: booking.creatorId,
    firstBookingId: booking.id, firstEventId: firstEvent.id,
    issuedAt: firstEvent.at,
    expiresAt: new Date(Date.parse(firstEvent.at) + RETURN_WINDOW_DAYS * 86400000).toISOString(),
    status: "issued", redeemedAt: null, returnEventId: null,
  };
  await store.set(`pass:${pass.id}`, pass);
  return pass;
}

async function voidEventFromRegister(ev, note) {
  ev.voided = true;
  ev.corrections = Array.isArray(ev.corrections) ? ev.corrections : [];
  ev.corrections.push({ at: nowIso(), by: "square", oldAmount: ev.amount, newAmount: null, voided: true, wasVoided: false, note });
  await store.set(`redevent:${ev.id}`, ev);
  await logEvent({ type: "redemption_corrected", actorId: null, actorRole: "system", subjectId: ev.bookingId, data: { eventId: ev.id, businessId: ev.businessId, creatorId: ev.creatorId, voided: true, via: "square", note } });
}

async function searchOrders(conn, locationIds, startAt, endAt) {
  const orders = [];
  let cursor = null;
  for (let page = 0; page < 12; page++) {
    const body = {
      location_ids: locationIds,
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: startAt, end_at: endAt } },
          state_filter: { states: ["COMPLETED"] },
        },
        sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
      },
      limit: 200,
    };
    if (cursor) body.cursor = cursor;
    const data = await apiCall(conn, "/v2/orders/search", { method: "POST", body });
    for (const o of Array.isArray(data && data.orders) ? data.orders : []) orders.push(o);
    cursor = data && data.cursor ? data.cursor : null;
    if (!cursor) break;
  }
  return orders;
}

async function orderFullyRefunded(conn, order) {
  for (const t of Array.isArray(order.tenders) ? order.tenders : []) {
    const paymentId = t && (t.payment_id || t.id);
    if (!paymentId) continue;
    try {
      const data = await apiCall(conn, `/v2/payments/${encodeURIComponent(paymentId)}`);
      const p = data && data.payment;
      if (p && p.amount_money && p.refunded_money && p.amount_money.amount > 0 && p.refunded_money.amount >= p.amount_money.amount) return true;
    } catch (e) { /* a payment we cannot read leaves the event standing */ }
  }
  return false;
}

async function syncSquareBusiness(businessId, opts = {}) {
  const conn = await getSquareConnection(businessId);
  if (!conn) return { state: "not_connected" };
  const summary = { state: "ok", ordersSeen: 0, firsts: 0, audience: 0, returns: 0, loyaltyReturns: 0, passesIssued: 0, typedVoided: 0, registerVoided: 0, lateEvents: 0 };
  try {
    if (conn.status === "paused") {
      // A sync attempt is also the recovery probe: if the grant
      // is back, the calls below simply work and the state heals.
      conn.status = "connected";
    }
    await provisionCatalog(conn);
    const locationIds = (conn.selectedLocationIds && conn.selectedLocationIds.length ? conn.selectedLocationIds : (conn.locations || []).map((l) => l.id)).filter(Boolean);
    if (!locationIds.length) throw new Error("Square is connected but no register location is selected");

    const [eventsAll, passesAll, bookingsAll] = await Promise.all([
      store.list("redevent:"),
      store.list("pass:"),
      store.list("booking:"),
    ]);
    const events = eventsAll.map((r) => r.value).filter((e) => e && e.businessId === businessId);
    const eventsByOrderId = new Map();
    for (const e of events) if (e.squareOrderId) eventsByOrderId.set(`${e.squareOrderId}:${e.kind}`, e);
    const passesById = new Map(passesAll.map((r) => [r.value && r.value.id, r.value]).filter(([k, v]) => k && v && v.businessId === businessId));
    const bookingsById = new Map(bookingsAll.map((r) => [r.value && r.value.id, r.value]).filter(([k, v]) => k && v && v.businessId === businessId));
    const byCatalogId = new Map();
    const byName = new Map();
    for (const entry of Object.values(conn.catalog || {})) {
      if (entry.catalogObjectId) byCatalogId.set(entry.catalogObjectId, entry);
      if (entry.code) byName.set(entry.code, entry);
    }
    const bizUser = await store.get(`user:${businessId}`);
    const passOn = !(bizUser && bizUser.business && bizUser.business.comeBackPassEnabled === false);

    const connectedMs = Date.parse(conn.connectedAt || "") || 0;
    const lastMs = conn.lastSyncAt ? Date.parse(conn.lastSyncAt) - SYNC_OVERLAP_MS : connectedMs;
    const startMs = Math.max(connectedMs, lastMs || connectedMs);
    const endMs = opts.now ? Date.parse(opts.now) : Date.now();
    const orders = await searchOrders(conn, locationIds, new Date(startMs).toISOString(), new Date(endMs).toISOString());
    summary.ordersSeen = orders.length;

    const writeEvent = async (ev) => {
      await store.set(`redevent:${ev.id}`, ev);
      events.push(ev);
      eventsByOrderId.set(`${ev.squareOrderId}:${ev.kind}`, ev);
      return ev;
    };

    for (const order of orders) {
      if (!order || !order.id || order.state !== "COMPLETED") continue;
      const orderAt = order.created_at || nowIso();
      const amount = round2(((order.total_money && order.total_money.amount) || 0) / 100);
      const channel = channelForOrder(order);
      const matches = [];
      for (const d of appliedDiscounts(order)) {
        const entry = (d.catalog_object_id && byCatalogId.get(d.catalog_object_id)) || (d.name && byName.get(d.name)) || null;
        if (entry) matches.push(entry);
      }
      const passMatch = matches.find((m) => m.kind === "pass");
      const codeMatch = matches.find((m) => m.kind === "creator" || m.kind === "audience");

      if (passMatch) {
        // Came-back path (a): the pass itself was rung.
        if (eventsByOrderId.has(`${order.id}:return`)) continue;
        const pass = passMatch.passId ? passesById.get(passMatch.passId) : null;
        if (!pass || pass.status !== "issued") continue;
        if ((Date.parse(pass.expiresAt || "") || 0) < Date.parse(orderAt)) continue;
        const booking = bookingsById.get(pass.firstBookingId);
        if (!booking) continue;
        const ev = await writeEvent({ id: crypto.randomUUID(), bookingId: booking.id, businessId, creatorId: booking.creatorId, kind: "return", channel, amount, passId: pass.id, audienceCodeId: null, at: orderAt, by: null, via: "square", source: "square", squareOrderId: order.id, squareLocationId: order.location_id || null, flagged: amount > 1000 });
        pass.status = "redeemed";
        pass.redeemedAt = orderAt;
        pass.returnEventId = ev.id;
        await store.set(`pass:${pass.id}`, pass);
        await logEvent({ type: "comeback_redeemed", actorId: null, actorRole: "system", subjectId: booking.id, market: booking.market || null, data: { creatorId: booking.creatorId, businessId, amount, passId: pass.id, via: "square" } });
        summary.returns += 1;
        continue;
      }

      if (codeMatch) {
        const kind = codeMatch.kind === "audience" ? "audience" : "first";
        if (eventsByOrderId.has(`${order.id}:${kind}`)) continue;
        const bookingId = codeMatch.bookingId || null;
        // The register wins over a conscientious duplicate:
        // a typed event for the same visit, same amount, same
        // day is voided into the correction trail (blueprint
        // §2.4), never double-counted.
        if (bookingId) {
          for (const t of events) {
            if (t.voided || t.source === "square" || t.bookingId !== bookingId || t.kind !== kind) continue;
            if (kind === "audience" && t.audienceCodeId !== (codeMatch.audienceCodeId || null)) continue;
            if (round2(t.amount) !== amount) continue;
            if (String(t.at || "").slice(0, 10) !== String(orderAt).slice(0, 10)) continue;
            await voidEventFromRegister(t, "Your register reported this same check, so the typed copy came out of the count.");
            summary.typedVoided += 1;
          }
        }
        const ev = await writeEvent({ id: crypto.randomUUID(), bookingId, businessId, creatorId: codeMatch.creatorId || null, kind, channel, amount, passId: null, audienceCodeId: codeMatch.audienceCodeId || null, at: orderAt, by: null, via: "square", source: "square", squareOrderId: order.id, squareLocationId: order.location_id || null, flagged: amount > 1000 });
        if (kind === "first") summary.firsts += 1; else summary.audience += 1;
        if (conn.lastSyncAt && Date.parse(orderAt) < Date.parse(conn.lastSyncAt)) summary.lateEvents += 1;
        const booking = bookingId ? bookingsById.get(bookingId) : null;
        if (kind === "first" && amount > 0 && booking) {
          if (passOn) {
            const pass = await issuePassForSquareFirst(booking, ev);
            if (pass) { passesById.set(pass.id, pass); summary.passesIssued += 1; }
          }
          // Came-back path (b) setup: remember this register
          // customer by one-way key only, against this visit.
          const acct = await loyaltyAccountForOrder(conn, order.id);
          if (acct) {
            const rec = {
              businessId, firstEventId: ev.id, bookingId: booking.id, creatorId: booking.creatorId,
              firstAt: orderAt,
              expiresAt: new Date(Date.parse(orderAt) + RETURN_WINDOW_DAYS * 86400000).toISOString(),
              status: "open", consumedAt: null, returnEventId: null, createdAt: nowIso(),
            };
            await store.set(`${loyaltyKey(businessId, acct)}:${ev.id}`, rec);
          }
        }
        continue;
      }

      // Came-back path (b): no code on this order, but the
      // register's loyalty identity matches a counted first
      // visit inside its 30 days. Only the match and the total
      // are stored; the identity never leaves this pass.
      if (amount <= 0) continue;
      if (eventsByOrderId.has(`${order.id}:return`)) continue;
      const acct = await loyaltyAccountForOrder(conn, order.id);
      if (!acct) continue;
      const rows = await store.list(`${loyaltyKey(businessId, acct)}:`);
      const open = rows.map((r) => ({ key: r.key, rec: r.value }))
        .filter(({ rec }) => rec && rec.status === "open" && Date.parse(rec.expiresAt || "") >= Date.parse(orderAt) && Date.parse(rec.firstAt || "") < Date.parse(orderAt))
        .sort((a, b) => (a.rec.firstAt < b.rec.firstAt ? -1 : 1));
      if (!open.length) continue;
      const { key, rec } = open[0];
      const firstEv = await store.get(`redevent:${rec.firstEventId}`);
      if (!firstEv || firstEv.voided || !(Number(firstEv.amount) > 0)) continue;
      const ev = await writeEvent({ id: crypto.randomUUID(), bookingId: rec.bookingId, businessId, creatorId: rec.creatorId, kind: "return", channel, amount, passId: null, audienceCodeId: null, matchVia: "loyalty", at: orderAt, by: null, via: "square", source: "square", squareOrderId: order.id, squareLocationId: order.location_id || null, flagged: amount > 1000 });
      rec.status = "consumed";
      rec.consumedAt = orderAt;
      rec.returnEventId = ev.id;
      await store.set(key, rec);
      await logEvent({ type: "comeback_redeemed", actorId: null, actorRole: "system", subjectId: rec.bookingId, data: { creatorId: rec.creatorId, businessId, amount, via: "square_loyalty" } });
      summary.returns += 1;
      summary.loyaltyReturns += 1;
    }

    // Refund / void reconciliation: orders already counted get
    // re-read, so a check refunded after it counted leaves the
    // count (blueprint §2.2: refunds and voids come out).
    const cutoff = Date.now() - RECHECK_DAYS * 86400000;
    const mine = events.filter((e) => e.source === "square" && !e.voided && e.squareOrderId && (Date.parse(e.at || "") || 0) >= cutoff).slice(0, 200);
    const byLocation = new Map();
    for (const e of mine) {
      const loc = e.squareLocationId || locationIds[0];
      if (!byLocation.has(loc)) byLocation.set(loc, []);
      byLocation.get(loc).push(e);
    }
    for (const [loc, evs] of byLocation) {
      let fresh = [];
      try {
        const data = await apiCall(conn, "/v2/orders/batch-retrieve", { method: "POST", body: { location_id: loc, order_ids: evs.map((e) => e.squareOrderId) } });
        fresh = Array.isArray(data && data.orders) ? data.orders : [];
      } catch (e) { continue; }
      const freshById = new Map(fresh.map((o) => [o.id, o]));
      for (const e of evs) {
        const o = freshById.get(e.squareOrderId);
        if (!o) continue;
        if (o.state === "CANCELED") {
          await voidEventFromRegister(e, "Square reported this check voided, so it came out of the count.");
          summary.registerVoided += 1;
        } else if (await orderFullyRefunded(conn, o)) {
          await voidEventFromRegister(e, "Square reported this check refunded, so it came out of the count.");
          summary.registerVoided += 1;
        }
      }
    }

    conn.status = "connected";
    conn.pausedAt = null;
    conn.pausedReason = null;
    conn.lastSyncAt = nowIso();
    conn.lastSyncSummary = { ...summary, at: conn.lastSyncAt };
    await saveSquareConnection(conn);
    return { state: "ok", summary };
  } catch (e) {
    if (e instanceof SquarePausedError || (conn && conn.status === "paused")) {
      await markPaused(conn, (e && e.message) || undefined);
      return { state: "paused", pausedAt: conn.pausedAt };
    }
    console.error(`SIGNL Square sync failed for ${businessId}:`, e);
    return { state: "error", error: String((e && e.message) || e) };
  }
}

async function syncAllSquare() {
  const conns = await listSquareConnections();
  const results = [];
  for (const conn of conns) {
    try {
      results.push({ businessId: conn.businessId, ...(await syncSquareBusiness(conn.businessId)) });
    } catch (e) {
      results.push({ businessId: conn.businessId, state: "error", error: String((e && e.message) || e) });
    }
  }
  return { connections: conns.length, results };
}

// ---------- public state (NO tokens, ever) ----------

async function publicSquareState(businessId) {
  const base = { configured: squareConfigured(), env: squareEnv(), connected: false, state: "not_connected" };
  const conn = businessId ? await getSquareConnection(businessId) : null;
  if (!conn) return base;
  return {
    configured: true,
    env: conn.env || squareEnv(),
    connected: conn.status === "connected",
    state: conn.status === "paused" ? "paused" : "connected",
    businessName: conn.businessName || null,
    connectedAt: conn.connectedAt || null,
    connectedDate: conn.connectedAt ? String(conn.connectedAt).slice(0, 10) : null,
    pausedAt: conn.pausedAt || null,
    pausedDate: conn.pausedAt ? String(conn.pausedAt).slice(0, 10) : null,
    lastSyncAt: conn.lastSyncAt || null,
    lastSyncSummary: conn.lastSyncSummary || null,
    locations: (conn.locations || []).map((l) => ({ id: l.id, name: l.name, selected: (conn.selectedLocationIds || []).includes(l.id) })),
    codesProvisioned: Object.keys(conn.catalog || {}).length,
  };
}

async function adminSquareState() {
  const conns = await listSquareConnections();
  return {
    configured: squareConfigured(),
    env: squareEnv(),
    connections: conns.map((c) => ({
      businessId: c.businessId,
      businessName: c.businessName || null,
      merchantId: c.merchantId || null,
      env: c.env || null,
      status: c.status || "connected",
      connectedAt: c.connectedAt || null,
      lastSyncAt: c.lastSyncAt || null,
      locations: (c.locations || []).map((l) => l.name),
    })),
  };
}

module.exports = {
  SQUARE_SCOPES,
  squareEnv,
  squareConfigured,
  squareRedirectUri,
  buildSquareAuthUrl,
  exchangeSquareCode,
  connectSquare,
  disconnectSquare,
  getSquareConnection,
  deleteSquareConnection,
  provisionCatalog,
  syncSquareBusiness,
  syncAllSquare,
  publicSquareState,
  adminSquareState,
  // test seams for the verify suite
  _test: { encryptSecret, decryptSecret, loyaltyKey, discountObjectFor, channelForOrder, appliedDiscounts },
};
