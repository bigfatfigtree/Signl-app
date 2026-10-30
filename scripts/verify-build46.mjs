#!/usr/bin/env node
// Build -46 verification (dev-audit fixes, 2026-10-30).
//
// Proves, against a throwaway local DB and a FAKE Stripe HTTP
// server (no real Stripe calls, ever; mail runs on the stub):
//   1. Checkout wiring — the Plan screen source calls
//      POST /billing/checkout and falls back to the record-only
//      POST /me/plan ONLY on the endpoint's 503; with no Stripe
//      env the endpoint 503s honestly and /me/plan persists the
//      selection at the canonical founding terms with a
//      "no card charged" status; with Stripe configured, a
//      founding business is refused (403) and an activated one
//      gets a real Checkout URL. Bootstrap reports billingLive
//      false/true in step. Nothing fabricates a payment.
//   2. Email loud + email-health — a failed send (mail stub
//      "stubfail" address) lands as a *_email_not_sent event
//      carrying the sender profile + reason; forgot-password
//      stays neutral (200 ok, ghost and real alike) but reports
//      emailDown while the transport is unconfigured;
//      GET /api/admin/email-health is admin-only and reports
//      per-sender configured status + recent outcomes with
//      recipient DOMAINS only.
//   3. Dead endpoints — GET /api/admin/return-rates and the
//      auto-decisions GET/run pair answer 404 (the engines
//      behind them are covered by their own suites).
//
// Run: node scripts/verify-build46.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8991;
const STRIPE_PORT = 8992;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_003>";
const WEBHOOK_SECRET = "<MASKED_SECRET_004>";

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
    stripeRequests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString("utf8") });
    if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "cs_test_46", url: "https://checkout.stripe.test/pay/cs_test_46" }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "fake stripe: not implemented" } }));
    }
  });
});
await new Promise((r) => fakeStripe.listen(STRIPE_PORT, "127.0.0.1", r));

// ---------- app server ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build46-"));
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
  return async function (method, p, body, headers = {}) {
    const h = { "Content-Type": "application/json", ...headers };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
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
}

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");

try {
  part("static wiring");
  check("Plan screen calls POST /billing/checkout", appJs.includes('api("POST", "/billing/checkout"'));
  check("checkout fallback records via POST /me/plan only on 503", appJs.includes('api("POST", "/me/plan"') && appJs.includes("err.status !== 503"));
  check("client reads the billingLive bootstrap flag", appJs.includes("billingLive") && routerJs.includes("billingLive: stripe.billingConfigured()"));
  check("not-live plan copy says billing is not live and no card is charged", appJs.includes("Billing is not live yet, so saving only records your selection"));
  check("forgot screen handles the transport-down answer honestly", appJs.includes("data.emailDown") && appJs.includes("Email is down on our side"));
  check("router has the email-health route", routerJs.includes('seg[1] === "email-health"'));
  check("router no longer routes return-rates", !routerJs.includes('seg[1] === "return-rates"'));
  check("router no longer routes auto-decisions endpoints", !/seg\[1\] === "auto-decisions"/.test(routerJs));

  part("phase 1: billing not configured — honest record-only path");
  startServer({});
  await waitUp();
  const boot0 = await makeClient()("GET", "/api/bootstrap");
  check("bootstrap reports billingLive false with no Stripe env", boot0.data.payments && boot0.data.payments.billingLive === false, JSON.stringify(boot0.data.payments));

  const biz = makeClient();
  const reg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Build46 Owner", businessName: "Build46 Bistro", email: "build46biz@fixtures.dev",
    password: "<MASKED_SECRET_005>", planId: "self-service", market: "Nashville", city: "Nashville", agreedTerms: true,
  });
  check("business registers (founding)", (reg.status === 200 || reg.status === 201) && reg.data.user.business.accessState === "founding", JSON.stringify(reg.data).slice(0, 250));
  const bizId = reg.data.user.id;

  const co = await biz("POST", "/api/billing/checkout", { planId: "growth" });
  check("checkout with no Stripe env is a 503, not a fake success", co.status === 503 && /not configured/i.test((co.data && co.data.error) || ""), JSON.stringify(co.data));
  check("no Stripe call happened in record mode", stripeRequests.length === 0);

  const saved = await biz("POST", "/api/me/plan", { planId: "growth" });
  check("record-only save persists the selection", saved.status === 200 && saved.data.user.business.plan === "growth", JSON.stringify(saved.data).slice(0, 250));
  check("recorded plan carries the canonical founding terms", saved.data.user.business.planName === "Growth $349/mo" && saved.data.user.business.planPriceMonthly === 349, JSON.stringify(saved.data.user.business).slice(0, 250));
  check("recorded billing status says no card was charged", /no card charged/.test(saved.data.user.business.billingStatus || ""), saved.data.user.business.billingStatus);

  part("phase 1: email failure is recorded per sender + email-health");
  const failUser = makeClient();
  const freg = await failUser("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "stubfail-reset@fixtures.dev", password: "<MASKED_SECRET_006>",
    market: "Hampton Roads", handle: "stubfail46", primaryPlatform: "instagram",
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("stubfail creator registers despite the failed confirmation send", freg.status === 200 || freg.status === 201, `status=${freg.status}`);

  const ghost = await makeClient()("POST", "/api/auth/forgot", { email: "ghost46@fixtures.dev" });
  check("forgot for an unknown email stays neutral 200 ok", ghost.status === 200 && ghost.data && ghost.data.ok === true, JSON.stringify(ghost.data));
  check("forgot for an unknown email returns no token", !ghost.data.devResetToken);
  check("forgot reports emailDown while the transport is unconfigured", ghost.data.emailDown === true, JSON.stringify(ghost.data));

  const forgot = await makeClient()("POST", "/api/auth/forgot", { email: "stubfail-reset@fixtures.dev" });
  check("forgot for the real account is the same neutral 200", forgot.status === 200 && forgot.data && forgot.data.ok === true, JSON.stringify(forgot.data));
  check("forgot for the real account also reports emailDown (no leak)", forgot.data.emailDown === true, JSON.stringify(forgot.data));

  const bizHealth = await biz("GET", "/api/admin/email-health");
  check("email-health refuses a non-admin (403)", bizHealth.status === 403, `status=${bizHealth.status}`);
  const anonHealth = await makeClient()("GET", "/api/admin/email-health");
  check("email-health refuses anonymous (401 at the sign-in wall)", anonHealth.status === 401, `status=${anonHealth.status}`);

  const admin = makeClient();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const health = await admin("GET", "/api/admin/email-health");
  check("email-health answers for admin", health.status === 200 && health.data && health.data.senders, JSON.stringify(health.data).slice(0, 250));
  check("email-health names the transport unconfigured", health.data.transport && health.data.transport.configured === false, JSON.stringify(health.data.transport));
  const dflt = health.data.senders.default || {};
  check("default sender: configured false in this env", dflt.configured === false, JSON.stringify(dflt));
  check("default sender: last outcome is the failed send, reason stub_failure", dflt.lastOutcome === "not_sent" && dflt.lastReason === "stub_failure" && dflt.recentFailed >= 1, JSON.stringify(dflt));
  check("email-health lastFailure is the password reset, domain only", health.data.lastFailure && health.data.lastFailure.kind === "password_reset" && health.data.lastFailure.domain === "fixtures.dev", JSON.stringify(health.data.lastFailure));
  check("email-health outcomes never carry a full address", (health.data.outcomes || []).every((o) => !("to" in o) && o.domain === "fixtures.dev"), JSON.stringify(health.data.outcomes).slice(0, 300));
  const prOutcome = (health.data.outcomes || []).find((o) => o.kind === "password_reset");
  check("the failed reset is in the outcomes with its profile + reason", !!prOutcome && prOutcome.profile === "default" && prOutcome.reason === "stub_failure", JSON.stringify(prOutcome));

  const evts = await admin("GET", "/api/admin/events?limit=500");
  const notSent = (evts.data.events || []).filter((e) => e.type === "password_reset_email_not_sent");
  check("the failed reset send is a *_email_not_sent event with profile + reason", notSent.length >= 1 && notSent[0].data.profile === "default" && notSent[0].data.reason === "stub_failure", JSON.stringify(notSent[0] || {}).slice(0, 250));

  part("phase 1: dead endpoints answer 404");
  const rr = await admin("GET", "/api/admin/return-rates");
  check("GET /api/admin/return-rates is gone (404)", rr.status === 404, `status=${rr.status}`);
  const adGet = await admin("GET", "/api/admin/auto-decisions");
  check("GET /api/admin/auto-decisions is gone (404)", adGet.status === 404, `status=${adGet.status}`);
  const adRun = await admin("POST", "/api/admin/auto-decisions/run", {});
  check("POST /api/admin/auto-decisions/run is gone (404)", adRun.status === 404, `status=${adRun.status}`);
  await stopServer();

  part("phase 2: billing configured — gate holds, then checkout returns a URL");
  startServer({ STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}` });
  await waitUp();
  const boot1 = await makeClient()("GET", "/api/bootstrap");
  check("bootstrap reports billingLive true with Stripe env", boot1.data.payments && boot1.data.payments.billingLive === true, JSON.stringify(boot1.data.payments));

  const biz2 = makeClient();
  await biz2("POST", "/api/auth/login", { email: "build46biz@fixtures.dev", password: "<MASKED_SECRET_005>" });
  const coFounding = await biz2("POST", "/api/billing/checkout", { planId: "growth" });
  check("founding business checkout is refused honestly (403), no URL", coFounding.status === 403 && !(coFounding.data && coFounding.data.url), JSON.stringify(coFounding.data));
  check("no Stripe call was made for the founding business", stripeRequests.length === 0);

  const admin2 = makeClient();
  await admin2("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await admin2("POST", "/api/admin/review", { userId: bizId, decision: "approve" });
  const act = await admin2("POST", "/api/admin/businesses/activate", { userId: bizId });
  check("admin activation flips the business active", act.status === 200 && act.data.user.business.accessState === "active", JSON.stringify(act.data).slice(0, 250));

  const coLive = await biz2("POST", "/api/billing/checkout", { planId: "growth" });
  check("activated business gets the Stripe checkout URL", coLive.status === 200 && coLive.data.url === "https://checkout.stripe.test/pay/cs_test_46", JSON.stringify(coLive.data));
  const sentReq = stripeRequests.find((r) => r.url === "/v1/checkout/sessions");
  check("the checkout session request reached Stripe for the growth price", !!sentReq && /price_/.test(sentReq.body || ""), sentReq ? sentReq.body.slice(0, 200) : "none");
  await stopServer();
} catch (e) {
  failed++;
  console.error("FAIL [harness] " + (e && e.stack || e));
} finally {
  await stopServer();
  fakeStripe.close();
}

console.log(`\nverify-build46: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
