#!/usr/bin/env node
// Stripe subscription wiring verification (Jeff, 2026-10-23).
//
// Proves, against a throwaway local DB and a FAKE Stripe HTTP
// server (STRIPE_API_BASE override; no real Stripe calls, ever):
//   - without STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET the
//     checkout and webhook endpoints no-op with 503 and the
//     concierge flow is untouched;
//   - checkout refuses a founding (not yet activated) business
//     with 403: billing never bypasses the founding gate;
//   - an activated business gets a Checkout Session for one of
//     the three live price IDs, with the business id in
//     client_reference_id, session metadata, and subscription
//     metadata; unknown price/plan is a 400; creators and
//     anonymous callers are refused;
//   - webhook signature verification: a correctly signed event
//     is accepted and persisted on the business record
//     (subscription id, customer, status, plan, period end),
//     a bad signature is a 400 and changes nothing;
//   - state transitions: subscription.created activates,
//     invoice.payment_failed marks past_due,
//     subscription.deleted marks canceled;
//   - billing never touches accessState, and the admin surface
//     ships the subscription display.
//
// Run: node scripts/verify-billing.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8975;
const STRIPE_PORT = 8976;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "test-admin-password-123";
const WEBHOOK_SECRET = "whsec_test_secret";
const GROWTH_PRICE = "price_1USRLcJ5DCULBlmAajXPmJjr";
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// ---------- fake Stripe ----------
const stripeRequests = [];
const fakeStripe = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    stripeRequests.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || "" });
    if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.test/pay/cs_test_123" }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not implemented in fake stripe" } }));
    }
  });
});
await new Promise((r) => fakeStripe.listen(STRIPE_PORT, "127.0.0.1", r));

// ---------- app server lifecycle ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-billing-"));
const dbFile = path.join(tmp, "db.json");
let server = null;
function startServer(extraEnv) {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  server = null;
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up");
}

function makeClient() {
  const jar = new Map();
  const api = async function (method, p, body, headers = {}) {
    const h = { "Content-Type": "application/json", ...headers };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const piece of setCookie.split(/,(?=[^;]+=)/)) {
      const m = piece.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, data, text };
  };
  return api;
}

function signPayload(raw, secret) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${raw}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

let bizId = null;
try {
  part("phase 1: no stripe env, safe no-op");
  startServer({});
  await waitUp();
  const biz = makeClient();
  const reg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Billing Biz Owner", businessName: "Billing Test Bistro", email: "billingbiz@fixtures.dev",
    password: "<MASKED_SECRET_002>", market: "Virginia Beach", city: "Virginia Beach", category: "Restaurant",
    planId: "growth", agreedTerms: true,
  });
  check("business registers (founding)", (reg.status === 200 || reg.status === 201) && reg.data.user.business.accessState === "founding", JSON.stringify(reg.data).slice(0, 250));
  bizId = reg.data.user.id;
  const coNoEnv = await biz("POST", "/api/billing/checkout", { planId: "growth" });
  check("checkout without env keys is a 503 no-op", coNoEnv.status === 503, JSON.stringify(coNoEnv.data));
  const whNoEnv = await makeClient()("POST", "/api/stripe/webhook", "{}", { "stripe-signature": "t=1,v1=abc" });
  check("webhook without env keys is a 503 no-op", whNoEnv.status === 503, JSON.stringify(whNoEnv.data));
  await stopServer();

  part("phase 2: stripe configured, founding gate holds");
  startServer({ STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}` });
  await waitUp();
  const biz2 = makeClient();
  await biz2("POST", "/api/auth/login", { email: "billingbiz@fixtures.dev", password: "<MASKED_SECRET_002>" });
  const coFounding = await biz2("POST", "/api/billing/checkout", { planId: "growth" });
  check("founding business checkout is refused (403)", coFounding.status === 403, JSON.stringify(coFounding.data));
  check("no Stripe call was made for the founding business", stripeRequests.length === 0);
  const anon = await makeClient()("POST", "/api/billing/checkout", { planId: "growth" });
  check("anonymous checkout is refused (401)", anon.status === 401);

  const admin = makeClient();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await admin("POST", "/api/admin/review", { userId: bizId, decision: "approve" });
  const act = await admin("POST", "/api/admin/businesses/activate", { userId: bizId });
  check("admin activation flips the business active", act.status === 200 && act.data.user.business.accessState === "active", JSON.stringify(act.data).slice(0, 250));

  part("phase 2: checkout happy path + validation");
  const co = await biz2("POST", "/api/billing/checkout", { planId: "growth" });
  check("activated business gets a checkout url", co.status === 200 && co.data.url === "https://checkout.stripe.test/pay/cs_test_123", JSON.stringify(co.data));
  const sent = stripeRequests.find((r) => r.url === "/v1/checkout/sessions");
  const form = new URLSearchParams(sent.body);
  check("stripe call is authenticated with the secret key", sent.auth === "Bearer sk_test_fake");
  check("mode is subscription", form.get("mode") === "subscription");
  check("client_reference_id carries the business id", form.get("client_reference_id") === bizId);
  check("session metadata carries the business id", form.get("metadata[businessId]") === bizId);
  check("subscription metadata carries the business id", form.get("subscription_data[metadata][businessId]") === bizId);
  check("line item is the Growth live price", form.get("line_items[0][price]") === GROWTH_PRICE);
  const coBad = await biz2("POST", "/api/billing/checkout", { priceId: "price_not_a_real_one" });
  check("unknown price id is a 400", coBad.status === 400, JSON.stringify(coBad.data));
  const creator = makeClient();
  await creator("POST", "/api/auth/register", {
    role: "creator", name: "Billing Creator", email: "billingcreator@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", city: "Norfolk", handle: "billingcreator",
    followerCount: 1200, localAudiencePct: 50, categories: ["Food & Drink"], ...AGREE,
  });
  const coCreator = await creator("POST", "/api/billing/checkout", { planId: "growth" });
  check("creator checkout is refused (403)", coCreator.status === 403, JSON.stringify(coCreator.data));

  part("phase 2: webhook signature + state transitions");
  const created = JSON.stringify({ id: "evt_1", type: "customer.subscription.created", data: { object: { id: "sub_123", customer: "cus_123", status: "active", current_period_end: 1795000000, metadata: { businessId: bizId, priceId: GROWTH_PRICE }, items: { data: [{ price: { id: GROWTH_PRICE } }] } } } });
  const whBad = await makeClient()("POST", "/api/stripe/webhook", created, { "stripe-signature": "t=1,v1=deadbeef" });
  check("bad signature is a 400", whBad.status === 400, JSON.stringify(whBad.data));
  const meBefore = await biz2("GET", "/api/auth/me");
  check("bad signature changed nothing", !meBefore.data.user.business.subscription);
  const whOk = await makeClient()("POST", "/api/stripe/webhook", created, { "stripe-signature": signPayload(created, WEBHOOK_SECRET) });
  check("good signature is accepted", whOk.status === 200 && whOk.data.received === true, JSON.stringify(whOk.data));
  const meAfter = await biz2("GET", "/api/auth/me");
  const sub = meAfter.data.user.business.subscription || {};
  check("subscription persisted: id + customer", sub.id === "sub_123" && sub.customerId === "cus_123", JSON.stringify(sub));
  check("subscription persisted: status active", sub.status === "active", JSON.stringify(sub));
  check("subscription persisted: plan from price", sub.plan === "growth" && sub.planName === "Growth" && sub.planPriceMonthly === 599, JSON.stringify(sub));
  check("subscription persisted: period end ISO", sub.currentPeriodEnd === new Date(1795000000 * 1000).toISOString(), JSON.stringify(sub));
  check("billing never touched accessState", meAfter.data.user.business.accessState === "active");

  const failedInvoice = JSON.stringify({ id: "evt_2", type: "invoice.payment_failed", data: { object: { customer: "cus_123", subscription: "sub_123" } } });
  const whFail = await makeClient()("POST", "/api/stripe/webhook", failedInvoice, { "stripe-signature": signPayload(failedInvoice, WEBHOOK_SECRET) });
  check("payment_failed accepted", whFail.status === 200);
  const meFail = await biz2("GET", "/api/auth/me");
  check("payment_failed marks the subscription past_due", meFail.data.user.business.subscription.status === "past_due" && !!meFail.data.user.business.subscription.lastPaymentFailedAt, JSON.stringify(meFail.data.user.business.subscription));

  const deleted = JSON.stringify({ id: "evt_3", type: "customer.subscription.deleted", data: { object: { id: "sub_123", customer: "cus_123", status: "canceled", metadata: { businessId: bizId }, items: { data: [{ price: { id: GROWTH_PRICE } }] } } } });
  const whDel = await makeClient()("POST", "/api/stripe/webhook", deleted, { "stripe-signature": signPayload(deleted, WEBHOOK_SECRET) });
  check("subscription.deleted accepted", whDel.status === 200);
  const meDel = await biz2("GET", "/api/auth/me");
  check("deleted marks the subscription canceled", meDel.data.user.business.subscription.status === "canceled" && !!meDel.data.user.business.subscription.canceledAt, JSON.stringify(meDel.data.user.business.subscription));

  part("phase 2: admin display ships");
  const appJs = await (await fetch(`${BASE}/app.js`)).text();
  check("admin business detail renders subscription status", appJs.includes("Subscription: ${esc(u.business.subscription.status"), "");
} finally {
  await stopServer();
  fakeStripe.close();
}

console.log(`\nverify-billing: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
