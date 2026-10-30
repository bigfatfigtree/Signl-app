#!/usr/bin/env node
// Stripe Connect payout plumbing verification (Jeff, 2026-10-26).
//
// Proves, against throwaway local DBs and a local fake-Stripe
// server (STRIPE_API_BASE), the full ready-but-OFF rail:
//   - gate off (no keys): payout setup 503s, card setup 503s,
//     bootstrap reports connectLive false, and a paid booking
//     behaves byte-for-byte like today (recorded, no card
//     charged, no funds object);
//   - creator onboarding: POST /me/payouts/start creates ONE
//     Express account and returns the hosted link; the state
//     surfaces in plain words ("your bank account", "your ID
//     number", never raw Stripe codes) and account ids never
//     reach a client payload; setup is resumable (no second
//     account); completion flips state to ready via the refresh
//     read AND via the account.updated webhook;
//   - business card on file: no Stripe account, ever: Checkout
//     setup mode opens a session, the signed webhook saves the
//     card view (brand + last4 only) onto the record;
//   - hold + release to the cent on the canon $100 example:
//     business charged $103.00 (10300), creator transfer $97.00
//     (9700), platform keeps $6. Release rides the existing
//     escrow moment (proof + 48h hold, inside the sweep):
//     capture once, transfer once, blocked while the creator's
//     payout setup is unfinished (money stays held, creator is
//     prompted), released once setup completes;
//   - refund path: a visit that never lands refunds in full by
//     cancelling the held authorization (never captured, no
//     transfer); a declined charge rolls the booking back
//     entirely;
//   - the paid-offer card gate and the offer-accept funds state
//     (needs_card when the business's card vanished mid-flow);
//   - client source pins for every shipped state/caption,
//     including the Admin Campaigns copy fix (no "40 sends per
//     day" anywhere; the true ceiling + warm-up figures render).
//
// Run: node scripts/verify-connect.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = ["signl", "admin", "test"].join("-");
const WEBHOOK_SECRET = ["whsec", "connect", "test"].join("_");

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 400) : ""}`); }
}

// ---------------- fake Stripe ----------------
// A tiny stateful stand-in for the slice of the Stripe API the
// Connect module uses. Records every call (method, path, parsed
// form) so the test can assert amounts to the cent.
const fake = {
  accounts: new Map(),
  pis: new Map(),
  calls: [],
  acctSeq: 0,
  cusSeq: 0,
  piSeq: 0,
  trSeq: 0,
  failNextPi: false,
};
function fakeAccount(id) {
  return {
    id,
    object: "account",
    type: "express",
    charges_enabled: false,
    payouts_enabled: false,
    requirements: { currently_due: ["external_account", "individual.id_number"] },
  };
}
const fakeServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    const form = Object.fromEntries(new URLSearchParams(body));
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    const url = new URL(req.url, "http://fake");
    const p = url.pathname;
    fake.calls.push({ method: req.method, path: p, form });
    let m;
    if (req.method === "POST" && (m = p.match(/^\/__complete\/(.+)$/))) {
      const acct = fake.accounts.get(m[1]);
      if (acct) { acct.charges_enabled = true; acct.payouts_enabled = true; acct.requirements.currently_due = []; }
      return send(200, acct || {});
    }
    if (req.method === "POST" && p === "/__fail_next_pi") { fake.failNextPi = true; return send(200, { ok: true }); }
    if (req.method === "POST" && p === "/v1/accounts") {
      const id = `acct_test_${++fake.acctSeq}`;
      const acct = fakeAccount(id);
      fake.accounts.set(id, acct);
      return send(200, acct);
    }
    if (req.method === "GET" && (m = p.match(/^\/v1\/accounts\/(.+)$/))) {
      return send(200, fake.accounts.get(m[1]) || { error: { message: "no such account" } });
    }
    if (req.method === "POST" && p === "/v1/account_links") {
      return send(200, { url: `https://connect.stripe.test/onboard/${form.account}`, expires_at: 1893456000 });
    }
    if (req.method === "POST" && p === "/v1/customers") {
      return send(200, { id: `cus_test_${++fake.cusSeq}` });
    }
    if (req.method === "POST" && p === "/v1/checkout/sessions") {
      return send(200, { id: "cs_setup_1", url: "https://checkout.stripe.test/setup", setup_intent: "seti_1", customer: form.customer || null, mode: "setup" });
    }
    if (req.method === "GET" && p === "/v1/setup_intents/seti_1") {
      return send(200, { id: "seti_1", payment_method: "pm_1" });
    }
    if (req.method === "GET" && p === "/v1/payment_methods/pm_1") {
      return send(200, { id: "pm_1", type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } });
    }
    if (req.method === "POST" && p === "/v1/payment_intents") {
      if (fake.failNextPi) { fake.failNextPi = false; return send(402, { error: { message: "Your card was declined." } }); }
      const id = `pi_test_${++fake.piSeq}`;
      const pi = { id, status: "requires_capture", amount: Number(form.amount), capture_method: form.capture_method || null };
      fake.pis.set(id, pi);
      return send(200, pi);
    }
    if ((m = p.match(/^\/v1\/payment_intents\/(.+)\/(capture|cancel)$/)) && req.method === "POST") {
      const pi = fake.pis.get(m[1]);
      if (pi) pi.status = m[2] === "capture" ? "succeeded" : "canceled";
      return send(200, pi || {});
    }
    if (req.method === "GET" && (m = p.match(/^\/v1\/payment_intents\/(.+)$/))) {
      return send(200, fake.pis.get(m[1]) || { error: { message: "no such payment_intent" } });
    }
    if (req.method === "POST" && p === "/v1/transfers") {
      return send(200, { id: `tr_test_${++fake.trSeq}` });
    }
    if (req.method === "POST" && p === "/v1/refunds") {
      return send(200, { id: "re_test_1", status: "succeeded" });
    }
    return send(404, { error: { message: `fake stripe: unhandled ${req.method} ${p}` } });
  });
});
await new Promise((r) => fakeServer.listen(0, "127.0.0.1", r));
const FAKE_BASE = `http://127.0.0.1:${fakeServer.address().port}`;
const fakeCalls = (method, pathRe) => fake.calls.filter((c) => c.method === method && pathRe.test(c.path));

// ---------------- app server harness ----------------
let server = null;
let BASE = null;
let dbFile = null;
function startServer(port, extraEnv) {
  BASE = `http://127.0.0.1:${port}`;
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD };
  delete env.STRIPE_SECRET_KEY; delete env.STRIPE_WEBHOOK_SECRET; delete env.STRIPE_API_BASE;
  Object.assign(env, extraEnv || {});
  server = spawn("node", ["scripts/dev-server.mjs", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
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
  const api = async function (method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const partC of setCookie.split(/,(?=[^;]+=)/)) {
      const mm = partC.trim().match(/^([^=]+)=([^;]*)/);
      if (mm) { if (mm[2]) jar.set(mm[1], mm[2]); else jar.delete(mm[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data, text };
  };
  return api;
}
const uniq = () => Math.random().toString(36).slice(2, 9);
let n = 0;
async function registerCreator() {
  n += 1;
  const client = makeClient();
  const payload = {
    role: "creator", name: `Connect Creator ${n}`, email: `conn${n}-${uniq()}@fixtures.dev`, password: "password123",
    market: "Hampton Roads", city: "Norfolk", handle: `conn${n}${uniq()}`, categories: ["Food & Drink"],
    compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 3000, avgViews: 900,
    localAudiencePct: 62, bio: "", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  };
  const r = await client("POST", "/api/auth/register", payload);
  return { client, payload, res: r, user: r.data && r.data.user, email: payload.email, password: "password123" };
}
async function registerBusiness(planId, businessName) {
  const client = makeClient();
  const email = `biz-${uniq()}@fixtures.dev`;
  const r = await client("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", email, password: "password123",
    market: "Hampton Roads", city: "Norfolk", businessName, category: "Restaurant", planId, agreedTerms: true,
  });
  return { client, res: r, user: r.data && r.data.user, email, password: "password123" };
}
async function login(email, password) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email, password });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return c;
}
const adminClient = () => login(ADMIN_EMAIL, ADMIN_PASSWORD);
async function approve(admin, userId) {
  const r = await admin("POST", "/api/admin/review", { userId, decision: "approve" });
  if (r.status !== 200) throw new Error("approve failed: " + JSON.stringify(r.data));
}
async function countEvents(admin, type) {
  const r = await admin("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=2000`);
  return (r.data.events || []).length;
}
async function myBookings(client) {
  const r = await client("GET", "/api/bookings");
  return r.data.bookings || [];
}
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}
function signPayload(raw, secret, tsSec) {
  const ts = tsSec || Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  return `t=${ts},v1=${sig}`;
}
async function postWebhook(evt, secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify(evt);
  const res = await fetch(`${BASE}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signPayload(raw, secret) },
    body: raw,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: res.status, data, text };
}
const STRIPE_ENV = { STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_API_BASE: FAKE_BASE };

try {
  // ============ Phase 0: no keys — the gate-off world ============
  part("0: gate off (no Stripe keys)");
  {
    const tmp0 = fs.mkdtempSync(path.join(os.tmpdir(), "signl-connect-off-"));
    dbFile = path.join(tmp0, "db.json");
    startServer(8941, {});
    await waitUp();
    const admin0 = await adminClient();
    const anon0 = makeClient();
    const boot0 = await anon0("GET", "/api/bootstrap");
    check("bootstrap reports payments.connectLive false with no keys", boot0.data.payments && boot0.data.payments.connectLive === false, JSON.stringify(boot0.data.payments));
    const C = await registerCreator();
    await approve(admin0, C.user.id);
    await C.client("PATCH", "/api/me/profile", { paidRate: 100 });
    const G = await registerBusiness("growth", "Gate Off Grill");
    await approve(admin0, G.user.id);
    await admin0("POST", "/api/admin/businesses/activate", { userId: G.user.id });
    const start0 = await C.client("POST", "/api/me/payouts/start", {});
    check("payout setup start 503s with a plain message when unconfigured", start0.status === 503 && /not live yet/.test(start0.data.error || ""), `${start0.status} ${JSON.stringify(start0.data)}`);
    const payouts0 = await C.client("GET", "/api/me/payouts");
    check("payout state reads not_started with paymentsLive false", payouts0.status === 200 && payouts0.data.payouts.status === "not_started" && payouts0.data.payouts.ready === false && payouts0.data.paymentsLive === false, JSON.stringify(payouts0.data));
    const card0 = await G.client("POST", "/api/billing/card", {});
    check("card setup 503s concierge when unconfigured", card0.status === 503 && /concierge/.test(card0.data.error || ""), `${card0.status}`);
    const pb0 = await G.client("POST", "/api/bookings/paid", { creatorId: C.user.id });
    check("gate-off paid booking created exactly as today", pb0.status === 201 && pb0.data.booking.paidLane.escrowState === "held", `${pb0.status} ${JSON.stringify(pb0.data).slice(0, 200)}`);
    check("gate-off booking carries NO funds object", !pb0.data.booking.paidLane.funds, JSON.stringify(pb0.data.booking.paidLane));
    check("gate-off booking keeps the recorded / no card charged note", /no card charged/.test(pb0.data.booking.paidLane.paymentNote || ""), pb0.data.booking.paidLane.paymentNote);
    check("gate-off booking math is still exact ($100 -> $103 / $97 / $6)", pb0.data.booking.paidLane.businessTotal === 103 && pb0.data.booking.paidLane.creatorNet === 97 && pb0.data.booking.paidLane.platformFee === 6, JSON.stringify(pb0.data.booking.paidLane));
    check("no Stripe call was made with the rail off", fake.calls.length === 0, `${fake.calls.length}`);
    await stopServer();
  }

  // ============ Phase 1: fake Stripe — the full rail ============
  part("1: onboarding + card on file");
  const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), "signl-connect-on-"));
  dbFile = path.join(tmp1, "db.json");
  startServer(8942, STRIPE_ENV);
  await waitUp();
  let admin = await adminClient();
  const anon = makeClient();
  const boot1 = await anon("GET", "/api/bootstrap");
  check("bootstrap reports payments.connectLive true with keys set", boot1.data.payments && boot1.data.payments.connectLive === true, JSON.stringify(boot1.data.payments));

  const C1 = await registerCreator();
  await approve(admin, C1.user.id);
  await C1.client("PATCH", "/api/me/profile", { paidRate: 100 });
  const G1 = await registerBusiness("growth", "Connect Kitchen");
  await approve(admin, G1.user.id);
  await admin("POST", "/api/admin/businesses/activate", { userId: G1.user.id });

  const before1 = await C1.client("GET", "/api/me/payouts");
  check("creator payouts start as not_started", before1.data.payouts.status === "not_started" && before1.data.payouts.ready === false && before1.data.paymentsLive === true, JSON.stringify(before1.data));
  const start1 = await C1.client("POST", "/api/me/payouts/start", {});
  check("payout setup start returns Stripe's hosted link", start1.status === 200 && /^https:\/\/connect\.stripe\.test\/onboard\//.test(start1.data.url || ""), `${start1.status} ${JSON.stringify(start1.data).slice(0, 200)}`);
  const acctCreates = fakeCalls("POST", /^\/v1\/accounts$/);
  check("exactly one Express account was created", acctCreates.length === 1, `${acctCreates.length}`);
  check("the connected account asks for the transfers capability", /transfers/.test(JSON.stringify(acctCreates[0] && acctCreates[0].form)), JSON.stringify(acctCreates[0] && acctCreates[0].form));
  check("state after start: pending, plain-words missing list", start1.data.payouts.status === "pending" && start1.data.payouts.ready === false
    && start1.data.payouts.missing.includes("your bank account") && start1.data.payouts.missing.includes("your ID number"), JSON.stringify(start1.data.payouts));
  check("no raw Stripe requirement codes reach the client", !JSON.stringify(start1.data).includes("external_account") && !JSON.stringify(start1.data).includes("individual.id_number"), "");
  const meC1 = await C1.client("GET", "/api/auth/me");
  check("client payload carries the plain payout state", meC1.data.user.creator.payouts.status === "pending" && meC1.data.user.creator.payouts.ready === false, JSON.stringify(meC1.data.user.creator.payouts));
  check("the Stripe account id never reaches a client payload", !JSON.stringify(meC1.data).includes("acct_test_"), "");
  const start2 = await C1.client("POST", "/api/me/payouts/start", {});
  check("setup is resumable: a second start reuses the account (still one create)", start2.status === 200 && fakeCalls("POST", /^\/v1\/accounts$/).length === 1, `${start2.status}`);

  // Business cannot book paid or post a paid offer without a card.
  const noCard = await G1.client("POST", "/api/bookings/paid", { creatorId: C1.user.id });
  check("paid booking without a card on file is refused with the fix in the message", noCard.status === 400 && /Add a card before booking paid visits/.test(noCard.data.error || ""), `${noCard.status} ${JSON.stringify(noCard.data)}`);
  const noCardOffer = await G1.client("POST", "/api/offers", { kind: "paid", title: "Paid tasting", whatComped: "Tasting menu", cashRate: 100, spots: 1 });
  check("paid offer without a card on file is refused the same way", noCardOffer.status === 400 && /Add a card before posting a paid offer/.test(noCardOffer.data.error || ""), `${noCardOffer.status} ${JSON.stringify(noCardOffer.data)}`);

  // Card on file: session opens, the signed webhook saves the card.
  const cardStart = await G1.client("POST", "/api/billing/card", {});
  check("card setup opens a Checkout session", cardStart.status === 200 && /checkout\.stripe\.test/.test(cardStart.data.url || ""), `${cardStart.status} ${JSON.stringify(cardStart.data)}`);
  const sessionCalls = fakeCalls("POST", /^\/v1\/checkout\/sessions$/);
  check("the session is setup mode against a platform customer (no business Stripe account)", sessionCalls.length === 1 && sessionCalls[0].form.mode === "setup" && sessionCalls[0].form.customer === "cus_test_1", JSON.stringify(sessionCalls[0] && sessionCalls[0].form));
  const badSig = await postWebhook({ id: "evt_bad", type: "checkout.session.completed", data: { object: { id: "cs_setup_1", mode: "setup", setup_intent: "seti_1", customer: "cus_test_1", client_reference_id: G1.user.id } } }, "whsec_wrong");
  check("a badly signed webhook is still refused", badSig.status === 400, `${badSig.status}`);
  const cardHook = await postWebhook({ id: "evt_card", type: "checkout.session.completed", data: { object: { id: "cs_setup_1", mode: "setup", setup_intent: "seti_1", customer: "cus_test_1", client_reference_id: G1.user.id, metadata: { signlUserId: G1.user.id, purpose: "card_on_file" } } } });
  check("setup-mode webhook accepted", cardHook.status === 200 && cardHook.data.received === true, `${cardHook.status} ${cardHook.text}`);
  const meG1 = await G1.client("GET", "/api/auth/me");
  const cardView = meG1.data.user.business.billing && meG1.data.user.business.billing.card;
  check("card on file shows brand + last4", !!cardView && cardView.brand === "visa" && cardView.last4 === "4242", JSON.stringify(cardView));
  check("no payment method or customer id reaches the client payload", !JSON.stringify(meG1.data).includes("pm_1") && !JSON.stringify(meG1.data).includes("cus_test_"), "");
  check("billing_card_saved event logged", (await countEvents(admin, "billing_card_saved")) === 1, "");

  // Complete creator 1's onboarding out of band; the refresh read
  // picks the ready state up from Stripe.
  const acct1 = [...fake.accounts.keys()][0];
  await fetch(`${FAKE_BASE}/__complete/${acct1}`, { method: "POST" });
  const afterComplete = await C1.client("GET", "/api/me/payouts");
  check("after Stripe completes verification the state reads ready", afterComplete.data.payouts.status === "ready" && afterComplete.data.payouts.ready === true && afterComplete.data.payouts.missing.length === 0, JSON.stringify(afterComplete.data.payouts));

  // ---------- hold + release, to the cent ----------
  part("2: hold + release ($100 canon)");
  const pb = await G1.client("POST", "/api/bookings/paid", { creatorId: C1.user.id });
  check("paid booking created with a card on file", pb.status === 201, `${pb.status} ${JSON.stringify(pb.data).slice(0, 200)}`);
  const lane = pb.data.booking.paidLane || {};
  check("math to the cent: rate 100, business 103, creator 97, platform 6", lane.rate === 100 && lane.businessTotal === 103 && lane.creatorNet === 97 && lane.platformFee === 6, JSON.stringify(lane));
  check("funds are HELD at booking", !!lane.funds && lane.funds.state === "held" && !!lane.funds.paymentIntentId, JSON.stringify(lane.funds));
  check("the held note replaces the recorded note (a card WAS charged)", lane.paymentNote === "SIGNL is holding this payment until the post is live.", lane.paymentNote);
  const piCreates = fakeCalls("POST", /^\/v1\/payment_intents$/);
  check("one authorization was created", piCreates.length === 1, `${piCreates.length}`);
  const piForm = piCreates[0] && piCreates[0].form;
  check("authorization: 10300 cents, manual capture, off-session, on the saved card", !!piForm && piForm.amount === "10300" && piForm.capture_method === "manual" && piForm.off_session === "true" && piForm.customer === "cus_test_1" && piForm.payment_method === "pm_1", JSON.stringify(piForm));
  check("paid_funds_held event logged", (await countEvents(admin, "paid_funds_held")) === 1, "");
  const notesC1 = await C1.client("GET", "/api/notifications");
  check("a payout-ready creator is NOT prompted to set up payouts", !(notesC1.data.notifications || []).some((x) => x.kind === "payout_setup_needed"), "");
  const pbId = pb.data.booking.id;
  await G1.client("POST", `/api/bookings/${pbId}/confirm`, {});
  await C1.client("POST", "/api/posts", { bookingId: pbId, url: "https://www.instagram.com/p/connect1/", includesDisclosure: true });
  const sweepEarly = await admin("POST", "/api/admin/compliance/sweep", {});
  check("sweep inside the 48h hold releases nothing", sweepEarly.status === 200 && (sweepEarly.data.sweep.escrowReleased || 0) === 0, JSON.stringify(sweepEarly.data.sweep));
  check("no capture and no transfer before release", fakeCalls("POST", /\/capture$/).length === 0 && fakeCalls("POST", /^\/v1\/transfers$/).length === 0, "");

  await stopServer();
  editDb((db) => {
    for (const [key, val] of Object.entries(db)) {
      if (key.startsWith("post:") && val.bookingId === pbId) val.submittedAt = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
    }
  });
  startServer(8942, STRIPE_ENV);
  await waitUp();
  admin = await adminClient();
  const G1b = await login(G1.email, G1.password);
  const sweepRel = await admin("POST", "/api/admin/compliance/sweep", {});
  check("sweep after proof + 48h releases the escrow", sweepRel.status === 200 && sweepRel.data.sweep.escrowReleased >= 1, JSON.stringify(sweepRel.data.sweep));
  const relView = (await myBookings(G1b)).find((b) => b.id === pbId);
  check("funds released with a transfer id recorded", !!relView && relView.paidLane.funds.state === "released" && !!relView.paidLane.funds.transferId, JSON.stringify(relView && relView.paidLane.funds));
  const captures = fakeCalls("POST", /\/capture$/);
  check("the held charge was captured exactly once", captures.length === 1 && captures[0].path === `/v1/payment_intents/${lane.funds.paymentIntentId}/capture`, JSON.stringify(captures.map((c) => c.path)));
  const transfers = fakeCalls("POST", /^\/v1\/transfers$/);
  check("exactly one transfer: 9700 cents to the creator's account", transfers.length === 1 && transfers[0].form.amount === "9700" && transfers[0].form.destination === acct1 && transfers[0].form.transfer_group === `booking_${pbId}`, JSON.stringify(transfers.map((t) => t.form)));
  check("paid_funds_released event logged", (await countEvents(admin, "paid_funds_released")) === 1, "");

  // ---------- blocked release: creator payouts not ready ----------
  part("3: release blocked until payout setup completes");
  const C2 = await registerCreator();
  await approve(admin, C2.user.id);
  await C2.client("PATCH", "/api/me/profile", { paidRate: 100 });
  const pb2 = await G1b("POST", "/api/bookings/paid", { creatorId: C2.user.id });
  check("second paid booking held at booking", pb2.status === 201 && pb2.data.booking.paidLane.funds.state === "held", `${pb2.status} ${JSON.stringify(pb2.data).slice(0, 200)}`);
  const pb2Id = pb2.data.booking.id;
  const notesC2 = await C2.client("GET", "/api/notifications");
  check("a creator booked without payout setup is prompted once, in plain words", (notesC2.data.notifications || []).filter((x) => x.kind === "payout_setup_needed").length >= 1, JSON.stringify((notesC2.data.notifications || []).map((x) => x.kind)));
  const startC2 = await C2.client("POST", "/api/me/payouts/start", {});
  check("second creator's setup starts (pending, plain missing list)", startC2.status === 200 && startC2.data.payouts.status === "pending" && startC2.data.payouts.missing.includes("your bank account"), JSON.stringify(startC2.data.payouts));
  const acct2 = [...fake.accounts.keys()][1];
  await G1b("POST", `/api/bookings/${pb2Id}/confirm`, {});
  await C2.client("POST", "/api/posts", { bookingId: pb2Id, url: "https://www.instagram.com/p/connect2/", includesDisclosure: true });

  await stopServer();
  editDb((db) => {
    for (const [key, val] of Object.entries(db)) {
      if (key.startsWith("post:") && val.bookingId === pb2Id) val.submittedAt = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
    }
  });
  startServer(8942, STRIPE_ENV);
  await waitUp();
  admin = await adminClient();
  const G1c = await login(G1.email, G1.password);
  const C2b = await login(C2.email, C2.password);
  await admin("POST", "/api/admin/compliance/sweep", {});
  const blockedView = (await myBookings(G1c)).find((b) => b.id === pb2Id);
  check("release BLOCKED while payouts are not ready: escrow still held", !!blockedView && blockedView.paidLane.escrowState === "held", JSON.stringify(blockedView && blockedView.paidLane));
  check("funds carry the payouts_not_ready block reason", !!blockedView && blockedView.paidLane.funds.blockedReason === "payouts_not_ready", JSON.stringify(blockedView && blockedView.paidLane.funds));
  check("still no second transfer", fakeCalls("POST", /^\/v1\/transfers$/).length === 1, "");
  check("paid_release_blocked event logged", (await countEvents(admin, "paid_release_blocked")) === 1, "");

  // Creator 2 finishes at Stripe; the account.updated webhook
  // flips the stored state, and the next sweep releases.
  await fetch(`${FAKE_BASE}/__complete/${acct2}`, { method: "POST" });
  const acctObj = fake.accounts.get(acct2);
  const upd = await postWebhook({ id: "evt_acct", type: "account.updated", data: { object: acctObj } });
  check("account.updated webhook accepted", upd.status === 200 && upd.data.received === true, `${upd.status}`);
  const meC2 = await C2b("GET", "/api/auth/me");
  check("webhook flipped the creator's state to ready", meC2.data.user.creator.payouts.status === "ready" && meC2.data.user.creator.payouts.ready === true, JSON.stringify(meC2.data.user.creator.payouts));
  check("payout_account_updated event logged", (await countEvents(admin, "payout_account_updated")) === 1, "");
  await admin("POST", "/api/admin/compliance/sweep", {});
  const rel2 = (await myBookings(G1c)).find((b) => b.id === pb2Id);
  check("after setup completes the release lands", !!rel2 && rel2.paidLane.escrowState === "released" && rel2.paidLane.funds.state === "released", JSON.stringify(rel2 && rel2.paidLane.funds));
  const transfers2 = fakeCalls("POST", /^\/v1\/transfers$/);
  check("second transfer: 9700 to the second creator's account", transfers2.length === 2 && transfers2[1].form.amount === "9700" && transfers2[1].form.destination === acct2, JSON.stringify(transfers2.map((t) => t.form)));

  // ---------- refund path: the visit never lands ----------
  part("4: refund when the week lapses");
  const pb3 = await G1c("POST", "/api/bookings/paid", { creatorId: C1.user.id });
  check("third paid booking held", pb3.status === 201 && pb3.data.booking.paidLane.funds.state === "held", `${pb3.status}`);
  const pb3Id = pb3.data.booking.id;
  const pi3 = pb3.data.booking.paidLane.funds.paymentIntentId;
  await stopServer();
  editDb((db) => {
    for (const [key, val] of Object.entries(db)) {
      if (key.startsWith("booking:") && val.id === pb3Id) val.redeemBy = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    }
  });
  startServer(8942, STRIPE_ENV);
  await waitUp();
  admin = await adminClient();
  const G1d = await login(G1.email, G1.password);
  await admin("POST", "/api/admin/compliance/sweep", {});
  const refView = (await myBookings(G1d)).find((b) => b.id === pb3Id);
  check("lapsed booking: escrow refunded and funds marked refunded", !!refView && refView.paidLane.escrowState === "refunded" && refView.paidLane.funds.state === "refunded", JSON.stringify(refView && refView.paidLane));
  const cancels = fakeCalls("POST", /\/cancel$/);
  check("the held authorization was cancelled (full refund, never captured)", cancels.length === 1 && cancels[0].path === `/v1/payment_intents/${pi3}/cancel`, JSON.stringify(cancels.map((c) => c.path)));
  check("no transfer ever happened for the refunded booking", fakeCalls("POST", /^\/v1\/transfers$/).length === 2, "");
  check("paid_funds_refunded event logged", (await countEvents(admin, "paid_funds_refunded")) === 1, "");

  // ---------- declined charge rolls the booking back ----------
  part("5: charge failure rollback");
  const bookingsBefore = (await myBookings(G1d)).length;
  await fetch(`${FAKE_BASE}/__fail_next_pi`, { method: "POST" });
  const declined = await G1d("POST", "/api/bookings/paid", { creatorId: C1.user.id });
  check("a declined card fails the booking plainly (502)", declined.status === 502 && /could not be charged/.test(declined.data.error || ""), `${declined.status} ${JSON.stringify(declined.data)}`);
  check("no booking survives a declined charge", (await myBookings(G1d)).length === bookingsBefore, "");
  check("paid_funds_charge_failed event logged", (await countEvents(admin, "paid_funds_charge_failed")) === 1, "");

  // ---------- offer-accept funds: needs_card state ----------
  part("6: offer-accept funds states");
  const offPaid = await G1d("POST", "/api/offers", { kind: "paid", title: "Paid tasting night", whatComped: "Tasting menu", cashRate: 100, spots: 1, creatorId: C1.user.id });
  check("paid offer posts once a card is on file", offPaid.status === 201, `${offPaid.status} ${JSON.stringify(offPaid.data).slice(0, 200)}`);
  // The card vanishes from the record between posting and
  // selection (expired card removed at Stripe): the booking must
  // still land, with the gap recorded as a funds state.
  await stopServer();
  editDb((db) => {
    const key = `user:${G1.user.id}`;
    if (db[key] && db[key].business && db[key].business.billing) db[key].business.billing.card = null;
  });
  startServer(8942, STRIPE_ENV);
  await waitUp();
  admin = await adminClient();
  const C1b = await login(C1.email, C1.password);
  const acc = await C1b("POST", `/api/offers/${offPaid.data.offer.id}/accept`, {});
  check("offer accept still books the visit", acc.status === 201 && !!acc.data.booking, `${acc.status} ${JSON.stringify(acc.data).slice(0, 200)}`);
  check("funds state records the missing card instead of failing silently", !!acc.data.booking.paidLane.funds && acc.data.booking.paidLane.funds.state === "needs_card", JSON.stringify(acc.data.booking.paidLane.funds));
  check("paid_funds_needs_card event logged", (await countEvents(admin, "paid_funds_needs_card")) === 1, "");

  // ---------- client source pins ----------
  part("7: client copy pins");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("creator payout step ships its three states", appJs.includes("Set up payouts") && appJs.includes("Finish payout setup") && appJs.includes("Payouts ready"), "");
  check("first-payout verification line ships", appJs.includes("Your first payout can take longer while Stripe verifies you."), "");
  check("gate-off payout caption ships (setup opens when the paid lane goes live)", appJs.includes("setup opens when the paid lane goes live"), "");
  check("business card surfaces ship", appJs.includes("Card on file") && appJs.includes("Add a card") && appJs.includes("Add a card to book"), "");
  check("booking funds status lines ship for both sides", appJs.includes("Held · releases when your post is live") && appJs.includes("Released · on its way to your bank") && appJs.includes("Paid · held until the post is live") && appJs.includes("Paid · released to the creator") && appJs.includes("Paid · refunded in full"), "");
  check("return-landing handling ships", appJs.includes('params.get("payouts")') && appJs.includes('params.get("card")'), "");
  // Build -51 (fresh-eyes A-18): the concierge line now names
  // Jeff as SIGNL's founder in the same breath, so a stranger
  // reading the Plan screen knows who "Jeff" is.
  check("concierge copy still ships for the gate-off world", appJs.includes("Payment stays concierge: when billing starts, Jeff, SIGNL's founder, sends the payment step by hand."), "");
  check("Admin Campaigns no longer claims 40 sends per day", !appJs.includes("40 sends per day"), "");
  check("Admin Campaigns renders the true ceiling + warm-up figures from the server config", appJs.includes("One daily ceiling covers everything:") && appJs.includes("warm-up cap of") && appJs.includes("teamMailDailyCap"), "");
  const connectSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/connect.js"), "utf8");
  check("connect module keeps every Stripe call behind the env-gated client", connectSrc.includes("stripeApi") && connectSrc.includes("billingConfigured") && connectSrc.includes("payoutStateFromAccount"), "");
  // Behavioral pins: run the shipped renderers themselves with
  // stubbed globals, so a state that renders empty (or a gate
  // keyed on a field the payload never carries) fails loudly.
  {
    const grab = (re) => { const mm = appJs.match(re); return mm ? mm[0] : ""; };
    const escStub = (s) => String(s == null ? "" : s);
    const mkStep = (live) => new Function("esc", "state",
      `${grab(/function laneRateOf\(c\) \{[\s\S]*?\n\}/)}\n${grab(/function paymentsLive\(\) \{[\s\S]*?\n\}/)}\n${grab(/function payoutsStepHtml\(c\) \{[\s\S]*?\n\}/)}\nreturn payoutsStepHtml;`)(escStub, { boot: { payments: { connectLive: live } } });
    const stepOff = mkStep(false);
    const stepOn = mkStep(true);
    check("renderer: no rate listed, no payout step (joining/comp never see it)", stepOff({ paidRate: null }) === "" && stepOn({ paidRate: null, payouts: { status: "ready", ready: true, missing: [] } }) === "", "");
    check("renderer: rail off shows the opens-later caption", stepOff({ paidRate: 100, payouts: { status: "not_started", ready: false, missing: [] } }).includes("setup opens when the paid lane goes live"), "");
    check("renderer: live + not started shows Set up payouts + the first-payout line", stepOn({ paidRate: 100, payouts: { status: "not_started", ready: false, missing: [] } }).includes("Set up payouts") && stepOn({ paidRate: 100, payouts: { status: "not_started", ready: false, missing: [] } }).includes("Your first payout can take longer while Stripe verifies you."), "");
    check("renderer: live + pending shows Finish payout setup with the plain missing list", stepOn({ paidRate: 100, payouts: { status: "pending", ready: false, missing: ["your bank account", "your ID number"] } }).includes("Finish payout setup") && stepOn({ paidRate: 100, payouts: { status: "pending", ready: false, missing: ["your bank account", "your ID number"] } }).includes("Stripe still needs: your bank account, your ID number."), "");
    check("renderer: live + ready shows the Payouts ready badge", stepOn({ paidRate: 100, payouts: { status: "ready", ready: true, missing: [] } }).includes("Payouts ready"), "");
    const fundsFn = new Function(`${grab(/function fundsStatusHtml\(lane, role\) \{[\s\S]*?\n\}/)}\nreturn fundsStatusHtml;`)();
    check("renderer: funds lines render per side and state, empty without funds", fundsFn({ funds: { state: "held" } }, "creator").includes("Held · releases when your post is live")
      && fundsFn({ funds: { state: "released" } }, "creator").includes("Released · on its way to your bank")
      && fundsFn({ funds: { state: "held" } }, "business").includes("Paid · held until the post is live")
      && fundsFn({ funds: { state: "held", blockedReason: "payouts_not_ready" } }, "creator").includes("finish payout setup")
      && fundsFn({}, "creator") === "" && fundsFn({ funds: null }, "business") === "", "");
    const cardFn = new Function("esc", "state", `${grab(/function cardOnFileView\(\) \{[\s\S]*?\n\}/)}\n${grab(/function brandName\(brand\) \{[\s\S]*?\n\}/)}\n${grab(/function cardOnFileSectionHtml\(\) \{[\s\S]*?\n\}/)}\nreturn cardOnFileSectionHtml;`);
    const withCard = cardFn(escStub, { user: { business: { billing: { card: { brand: "visa", last4: "4242" } } } } })();
    const noCard = cardFn(escStub, { user: { business: { billing: { card: null } } } })();
    check("renderer: card section shows Visa + last4 with a card, Add a card without", withCard.includes("Card on file") && withCard.includes("Visa") && withCard.includes("4242") && noCard.includes("Add a card"), `${withCard} | ${noCard}`);
  }
  await stopServer();
} catch (e) {
  failed++;
  console.error("ERROR:", e);
} finally {
  await stopServer();
  fakeServer.close();
}

console.log(`\nverify-connect: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
