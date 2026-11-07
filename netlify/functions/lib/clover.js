// Clover register connection (Build -109, Tier 3 item 19b):
// DESIGN + STUB, built because the sequence says so, not
// because the trigger has fired.
//
// TRIGGER STATE: the item-19a field has been live since Build
// -101, and the number of real businesses that have declared
// Clover is ZERO today (the field itself only just shipped;
// the mix was unmeasured before it). The strategy trigger for
// the full build is 10 to 20 businesses declaring Clover. So
// what exists here is the pilot shape the prep specified:
//   - ONE business at a time, connected by ADMIN entering that
//     business's Clover API token (merchant token pilot; the
//     Clover App Market OAuth app is the follow-on, NOT built);
//   - the token stored AES-256-GCM encrypted, the same scheme
//     and key discipline as Square's (lib/square.js), and never
//     returned on any payload;
//   - orders + discounts read from the Clover API shape
//     (GET /v3/merchants/{id}/orders), Magpie visit-code
//     discounts becoming counted-proof rows through the SAME
//     redevent: seam Square writes (Receipt counted class);
//   - sync idempotence: each counted row's id is derived from
//     the Clover order id + code, so re-syncs overwrite, never
//     duplicate;
//   - paused doctrine, mirroring Square's: a paused connection
//     reads nothing and says so.
// What the full build adds when the trigger fires: booking
// matching for the counted rows (creator attribution, Came-Back
// passes, refund reconciliation), the App Market OAuth flow,
// and webhooks. None of that is faked here: rows land as
// register counts awaiting match, labeled via "clover".
//
// TEST SEAM: CLOVER_API_BASE overrides the API host so the
// verify suite can run the sync against a local stub. The
// encryption key is SIGNL_TOKEN_ENC_KEY (shared with Square's
// scheme); without key material the module refuses to store a
// token at all, exactly like Square.

const crypto = require("crypto");
const store = require("./store");

function nowIso() { return new Date().toISOString(); }

function cloverApiBase() {
  return (process.env.CLOVER_API_BASE || "https://api.clover.com").replace(/\/+$/, "");
}

// ---------- token encryption at rest (Square's scheme) ----------

function encKey() {
  const raw = process.env.SIGNL_TOKEN_ENC_KEY || "";
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
  if (!stored.startsWith("enc:v1:")) return null; // clover tokens are never stored in the clear
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

function cloverConfigured() {
  return !!encKey();
}

// ---------- connection records ----------

function connKey(businessId) {
  return `posconn:${businessId}:clover`;
}

async function getCloverConnection(businessId) {
  return (await store.get(connKey(businessId))) || null;
}

async function setCloverToken(businessId, fields) {
  const merchantId = String((fields && fields.merchantId) || "").trim();
  const token = String((fields && fields.token) || "").trim();
  if (!merchantId) return { error: "The Clover merchant ID is required" };
  if (!token) return { error: "The Clover API token is required" };
  const tokenEnc = encryptSecret(token);
  if (!tokenEnc) return { error: "Token storage is not configured on the server (SIGNL_TOKEN_ENC_KEY is missing), so the token was not stored" };
  const existing = await getCloverConnection(businessId);
  const conn = {
    businessId,
    platform: "clover",
    merchantId,
    tokenEnc,
    status: "connected",
    createdAt: (existing && existing.createdAt) || nowIso(),
    updatedAt: nowIso(),
    lastSyncAt: (existing && existing.lastSyncAt) || null,
    lastSyncStatus: (existing && existing.lastSyncStatus) || null,
  };
  await store.set(connKey(businessId), conn);
  return { conn };
}

async function setCloverPaused(businessId, paused) {
  const conn = await getCloverConnection(businessId);
  if (!conn) return null;
  conn.status = paused ? "paused" : "connected";
  conn.updatedAt = nowIso();
  await store.set(connKey(businessId), conn);
  return conn;
}

async function deleteCloverConnection(businessId) {
  const conn = await getCloverConnection(businessId);
  if (!conn) return false;
  await store.del(connKey(businessId));
  return true;
}

// The only shape a client payload ever sees: no token, ever.
function publicCloverState(conn) {
  if (!conn) return { connected: false, status: "not_connected", merchantId: null, lastSyncAt: null, lastSyncStatus: null };
  return {
    connected: true,
    status: conn.status || "connected",
    merchantId: conn.merchantId || null,
    lastSyncAt: conn.lastSyncAt || null,
    lastSyncStatus: conn.lastSyncStatus || null,
  };
}

// ---------- Clover API read ----------

async function fetchCloverOrders(conn, sinceMs) {
  const token = decryptSecret(conn.tokenEnc);
  if (!token) throw new Error("The stored Clover token could not be read");
  const filter = encodeURIComponent(`createdTime>=${Math.max(0, Math.floor(sinceMs || 0))}`);
  const url = `${cloverApiBase()}/v3/merchants/${encodeURIComponent(conn.merchantId)}/orders?filter=${filter}&expand=discounts&limit=200`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Clover orders request failed (HTTP ${res.status})`);
  const data = await res.json().catch(() => null);
  const elements = data && Array.isArray(data.elements) ? data.elements : [];
  return elements;
}

// A Clover order becomes a counted-proof candidate when it is
// paid/closed and carries a discount whose name looks like a
// Magpie visit code (the codes businesses hand customers; the
// typed path counts the same codes at any till). Amounts in
// Clover are cents.
function countedRowsForOrder(businessId, order) {
  if (!order || !order.id) return [];
  const state = String(order.state || "").toLowerCase();
  if (state && state !== "paid" && state !== "closed" && state !== "complete") return [];
  const discounts = Array.isArray(order.discounts) ? order.discounts : [];
  const rows = [];
  for (const d of discounts) {
    const name = String((d && d.name) || "").trim();
    if (!name || !/^[A-Za-z0-9-]{4,24}$/.test(name)) continue;
    const amount = typeof order.total === "number" ? Math.round(order.total) / 100 : 0;
    rows.push({
      id: `clover-${order.id}-${name.toLowerCase()}`,
      bookingId: null, // booking matching is the full build's step (see header)
      businessId,
      creatorId: null,
      kind: "register",
      channel: "register",
      amount,
      code: name,
      cloverOrderId: order.id,
      at: order.createdTime ? new Date(Number(order.createdTime)).toISOString() : nowIso(),
      by: null,
      via: "clover",
      flagged: amount > 1000,
    });
  }
  return rows;
}

async function syncCloverBusiness(businessId, opts = {}) {
  const conn = await getCloverConnection(businessId);
  if (!conn) return { status: "not_connected", ordersSeen: 0, rowsWritten: 0 };
  if (conn.status === "paused") {
    return { status: "paused", ordersSeen: 0, rowsWritten: 0 };
  }
  const sinceMs = conn.lastSyncAt ? Date.parse(conn.lastSyncAt) - 5 * 60 * 1000 : Date.parse(conn.createdAt || "") || 0;
  let orders;
  try {
    orders = await fetchCloverOrders(conn, sinceMs);
  } catch (e) {
    conn.lastSyncStatus = "error";
    conn.updatedAt = nowIso();
    await store.set(connKey(businessId), conn);
    return { status: "error", error: String((e && e.message) || e), ordersSeen: 0, rowsWritten: 0 };
  }
  let rowsWritten = 0;
  for (const order of orders) {
    for (const row of countedRowsForOrder(businessId, order)) {
      await store.set(`redevent:${row.id}`, row);
      rowsWritten += 1;
    }
  }
  conn.lastSyncAt = opts.now || nowIso();
  conn.lastSyncStatus = "ok";
  conn.updatedAt = nowIso();
  await store.set(connKey(businessId), conn);
  return { status: "ok", ordersSeen: orders.length, rowsWritten };
}

module.exports = {
  cloverConfigured,
  getCloverConnection,
  setCloverToken,
  setCloverPaused,
  deleteCloverConnection,
  publicCloverState,
  fetchCloverOrders,
  countedRowsForOrder,
  syncCloverBusiness,
  // test seams for the verify suite
  _test: { encryptSecret, decryptSecret },
};
