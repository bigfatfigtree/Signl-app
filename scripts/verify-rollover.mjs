#!/usr/bin/env node
// Plan allowance + rollover verification (Jeff, 2026-10-26).
//
// The founding plans carry a monthly comp-visit allowance with
// ONE month of rollover: unused visits roll into the next month
// and expire at the end of that month. The server-side counter
// (planAllowanceFor) counts comp-kind bookings by calendar month
// (paid bookings never consume the allowance), consumes the base
// first, and computes the carry as last month's unused base. This
// suite proves, with seeded bookings across month boundaries
// (edit the JSON DB while the server is down):
//   (a) 2 unused in month 1 -> month 2 allowance = plan + 2;
//   (b) rolled visits unused again -> gone in month 3 (the carry
//       into month 3 is computed from month 2's BASE usage only);
//   (c) the allowance never exceeds plan + one month of carry,
//       however much unused history sits behind it;
//   (d) paid bookings never consume the allowance;
//   (e) a fresh business starts at exactly the plan base, and the
//       plan payload carries the founding credit honestly;
//   (f) preview parity: the simulated dashboard's bookings are
//       all current-month, so its allowance is exactly its base
//       with zero carried.
//
// Run: node scripts/verify-rollover.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8991;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-rollover-"));
const dbFile = path.join(tmp, "db.json");
let server = null;

function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
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
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const part of setCookie.split(/,(?=[^;]+=)/)) {
      const m = part.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html error page */ }
    return { status: res.status, data, text };
  };
}

const uniq = () => Math.random().toString(36).slice(2, 9);

async function adminClient() {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error("admin login failed: " + r.status);
  return c;
}

async function registerBusiness(admin, planId, businessName) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/register", {
    role: "business",
    name: "Biz Owner",
    email: `biz-${uniq()}@fixtures.dev`,
    password: "<redacted>",
    market: "Hampton Roads",
    city: "Norfolk",
    businessName,
    category: "Restaurant",
    planId,
    agreedTerms: true,
  });
  if (r.status === 201) {
    await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
    await admin("POST", "/api/admin/businesses/activate", { userId: r.data.user.id });
  }
  return { client: c, res: r, user: r.data && r.data.user };
}

async function registerCreator(admin) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/register", {
    role: "creator",
    name: "Rollover Creator",
    email: `roll-${uniq()}@fixtures.dev`,
    password: "<redacted>",
    market: "Hampton Roads",
    city: "Norfolk",
    handle: `roll${uniq()}`,
    categories: ["Food & Drink"],
    compCategories: ["Restaurant meals"],
    tierBand: "Locals",
    followerCount: 3000,
    avgViews: 900,
    localAudiencePct: 62,
    bio: "",
    agreedHonestPosts: true,
    agreedFtcDisclosure: true,
    agreedPostCompliance: true,
    agreedTerms: true,
  });
  if (r.status === 201) await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
  return { client: c, user: r.data && r.data.user };
}

// ---- seeded bookings across month boundaries ----
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}
function monthIso(monthsAgo) {
  const n = new Date();
  if (monthsAgo === 0) return n.toISOString();
  return new Date(n.getFullYear(), n.getMonth() - monthsAgo, 15, 12, 0, 0).toISOString();
}
let seedN = 0;
function seedBookings(db, businessId, creatorId, specs) {
  for (const key of Object.keys(db)) {
    if (key.startsWith("booking:") && db[key].businessId === businessId) delete db[key];
  }
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i++) {
      seedN += 1;
      const id = `seed-booking-${seedN}`;
      db[`booking:${id}`] = {
        id,
        businessId,
        creatorId,
        creatorHandle: "rollcreator",
        businessName: "Rollover Kitchen",
        market: "hampton-roads",
        title: "Seeded visit",
        kind: spec.kind || "comp",
        status: "booked",
        createdAt: monthIso(spec.monthsAgo),
        dollarCap: 100,
        covers: 2,
      };
    }
  }
}
async function homeAfterSeeds(bizClient, businessId, creatorId, specs) {
  await stopServer();
  editDb((db) => seedBookings(db, businessId, creatorId, specs));
  startServer();
  await waitUp();
  const home = await bizClient("GET", "/api/me/business-home");
  if (home.status !== 200) throw new Error("business home failed after seeding: " + home.status + " " + JSON.stringify(home.data).slice(0, 200));
  return home.data.home;
}

try {
  startServer();
  await waitUp();
  const admin = await adminClient();
  const bizReg = await registerBusiness(admin, "self-service", "Rollover Kitchen");
  check("self-service business registered + activated", bizReg.res.status === 201 && !!bizReg.user, JSON.stringify(bizReg.res.data).slice(0, 200));
  const creator = await registerCreator(admin);
  check("creator registered + approved", !!creator.user);
  const biz = bizReg.client;
  const bizId = bizReg.user.id;
  const creatorId = creator.user.id;

  part("D: fresh business + plan payload");
  const fresh = await biz("GET", "/api/me/business-home");
  check("fresh business: allowance is exactly the plan base (5)", fresh.data.home.visitsAllowance === 5 && fresh.data.home.visitsBase === 5 && fresh.data.home.visitsCarried === 0 && fresh.data.home.visitsRemaining === 5 && fresh.data.home.carriedExpiresAt === null, JSON.stringify(fresh.data.home));
  check("plan payload carries the founding structure ($199, $100 credit, first month $99, 5 visits)", fresh.data.plan.priceMonthly === 199 && fresh.data.plan.foundingCredit === 100 && fresh.data.plan.firstMonthPriceMonthly === 99 && fresh.data.plan.visitsPerMonth === 5 && fresh.data.plan.minMonths === 3, JSON.stringify(fresh.data.plan));

  part("A: 2 unused in month 1 -> month 2 = plan + 2 (paid never counts)");
  const homeA = await homeAfterSeeds(biz, bizId, creatorId, [
    { monthsAgo: 1, count: 3, kind: "comp" },
    { monthsAgo: 0, count: 1, kind: "comp" },
    { monthsAgo: 0, count: 4, kind: "paid" },
  ]);
  check("(a) carried = 2, allowance = 7", homeA.visitsCarried === 2 && homeA.visitsAllowance === 7 && homeA.visitsBase === 5, JSON.stringify(homeA));
  check("(a)+(d) used counts comp bookings only (1 of 7, 4 paid ignored), 6 remaining", homeA.visitsUsed === 1 && homeA.visitsRemaining === 6, JSON.stringify(homeA));
  const nextMonth = new Date(); nextMonth.setDate(1); nextMonth.setMonth(nextMonth.getMonth() + 1); nextMonth.setHours(0, 0, 0, 0);
  check("(a) carried visits expire at the end of this month", homeA.carriedExpiresAt === nextMonth.toISOString(), `${homeA.carriedExpiresAt} vs ${nextMonth.toISOString()}`);
  check("(a) plan pace uses the rolled allowance (1 of 7 = 14%)", homeA.planPacePct === 14, String(homeA.planPacePct));

  part("B: rolled visits unused again -> gone in month 3");
  const homeB = await homeAfterSeeds(biz, bizId, creatorId, [
    { monthsAgo: 2, count: 3, kind: "comp" },
    { monthsAgo: 1, count: 5, kind: "comp" },
  ]);
  check("(b) month 2 used its full base, so nothing carries into month 3 (allowance back to 5)", homeB.visitsCarried === 0 && homeB.visitsAllowance === 5 && homeB.visitsUsed === 0 && homeB.visitsRemaining === 5 && homeB.carriedExpiresAt === null, JSON.stringify(homeB));

  part("C: carry capped at one month");
  const homeC = await homeAfterSeeds(biz, bizId, creatorId, [
    { monthsAgo: 3, count: 4, kind: "comp" },
    { monthsAgo: 2, count: 1, kind: "comp" },
  ]);
  check("(c) an idle last month carries exactly one month of base: allowance 10, never more", homeC.visitsCarried === 5 && homeC.visitsAllowance === 10 && homeC.visitsRemaining === 10, JSON.stringify(homeC));

  part("F: preview parity");
  const admin2 = await adminClient();
  const dash = await admin2("GET", "/api/admin/preview/dashboard");
  const pvHome = (dash.data.dashboard || {}).home || {};
  check("(f) preview home: base 10 (Growth), carried 0, allowance = base", pvHome.visitsBase === 10 && pvHome.visitsCarried === 0 && pvHome.visitsAllowance === 10, JSON.stringify(pvHome));
  const pvPlan = (dash.data.dashboard || {}).plan || {};
  check("(f) preview plan payload carries the founding structure ($349, first month $249)", pvPlan.priceMonthly === 349 && pvPlan.foundingCredit === 100 && pvPlan.firstMonthPriceMonthly === 249, JSON.stringify(pvPlan));
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nRollover verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
