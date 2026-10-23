// Stripe subscription wiring (Jeff, 2026-10-23; feature audit
// rec #2). Zero-dependency, matching the app's email transport
// style: the Stripe REST API over https with form encoding, and
// webhook signatures verified by hand (HMAC-SHA256 over
// "<timestamp>.<raw body>", constant-time compare).
//
// Configuration is env-only: STRIPE_SECRET_KEY +
// STRIPE_WEBHOOK_SECRET. With either absent the billing surface
// no-ops safely (checkout and webhook answer 503 "billing not
// configured") and the concierge flow is completely unaffected.
// STRIPE_API_BASE exists so the verify suites can point the client
// at a fake Stripe HTTP server; production never sets it.
// NO Connect / paid-lane payouts here: subscriptions only
// (phase 2 owns the paid lane).

const crypto = require("crypto");

function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || "";
}
function stripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET || "";
}
function billingConfigured() {
  return !!stripeSecretKey();
}
function webhookConfigured() {
  return !!stripeWebhookSecret();
}
function stripeApiBase() {
  return (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "");
}

// Stripe's form encoding: nested objects as key[sub]=value,
// arrays as key[i]=value, booleans/numbers stringified.
function encodeForm(params, prefix, out) {
  const acc = out || [];
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === "object") encodeForm(item, `${name}[${i}]`, acc);
        else acc.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === "object") {
      encodeForm(value, name, acc);
    } else {
      acc.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return acc;
}

async function stripeApi(method, path, params) {
  const body = params ? encodeForm(params).join("&") : undefined;
  const res = await fetch(`${stripeApiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeSecretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  if (!res.ok) {
    const message = (data && data.error && data.error.message) || `Stripe request failed (${res.status})`;
    const failure = new Error(message);
    failure.status = res.status;
    throw failure;
  }
  return data;
}

// Verify a Stripe webhook signature against the RAW request body
// and return the parsed event. Throws on any mismatch, a missing
// header part, a stale timestamp, or unparseable JSON: callers
// answer 400 and Stripe retries, which is the safe failure mode.
function verifyWebhookEvent(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  const parts = {};
  for (const piece of String(signatureHeader || "").split(",")) {
    const idx = piece.indexOf("=");
    if (idx > 0) parts[piece.slice(0, idx).trim()] = piece.slice(idx + 1).trim();
  }
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new Error("Missing Stripe signature parts");
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const givenBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== givenBuf.length || !crypto.timingSafeEqual(expectedBuf, givenBuf)) {
    throw new Error("Stripe signature mismatch");
  }
  const ts = parseInt(timestamp, 10);
  if (!Number.isNaN(ts) && Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSeconds) {
    throw new Error("Stripe signature timestamp outside tolerance");
  }
  return JSON.parse(rawBody);
}

module.exports = { billingConfigured, webhookConfigured, stripeWebhookSecret, stripeApi, verifyWebhookEvent };
