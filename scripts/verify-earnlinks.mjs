#!/usr/bin/env node
// Earn-row deep links (Jeff, 2026-10-27): the Momentum / profile
// checklist rows link to the exact surface that completes them,
// but only when the action can be completed right now.
//   - source contract: the client resolves every row through
//     earnActionFor; the actionable ids map to the Profile fields,
//     the Offers deck, My Visits, and the Grow-your-roster panel;
//     the outcome ids (ontime, streak, aduse) never map; the two
//     state-dependent rows (reviews, performance) gate on the
//     server-sent dueBookingId; the CSS gives linked rows the
//     filled mint circle + chevron treatment.
//   - payload state machine: the reviews row carries
//     dueBookingId only while a completed visit is unreviewed,
//     and the performance row only while a post's numbers were
//     asked for and not yet reported; completing the action
//     clears the field.
// DOM click-through is covered by scripts/verify-earnlinks-dom.py.
//
// Run: node scripts/verify-earnlinks.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8989;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = ["Pass", "word1!"].join("");
const DAY = 24 * 3600 * 1000;

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-earnlinks-"));
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
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}
const itemOf = (user, id) => ((user.momentum || {}).checklist || []).find((i) => i.id === id) || {};

try {
  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const themeCss = fs.readFileSync(path.join(root, "public", "theme-v2.css"), "utf8");
  const stylesCss = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify", "functions", "lib", "router.js"), "utf8");
  const fnSlice = (name, next) => {
    const a = appJs.indexOf(`function ${name}(`);
    if (a < 0) return "";
    const b = next ? appJs.indexOf(`function ${next}(`, a + 10) : -1;
    return appJs.slice(a, b > a ? b : a + 6000);
  };

  part("source: earn-link resolver + renderers");
  const resolver = fnSlice("earnActionFor", "earnRowWrap");
  check("earnActionFor resolver exists", resolver.length > 0);
  check("both earn-row renderers wrap rows through earnRowWrap",
    fnSlice("momentumHtml", "fmtNum").includes("earnRowWrap(item, u") && fnSlice("profileCompletionHtml", "momentumHtml").includes("earnRowWrap(item, u"));
  check("profile fields map: bio, neighborhood, local %, photo gallery",
    resolver.includes('"p-bio"') && resolver.includes('"p-neighborhood"') && resolver.includes('"p-localpct"') && resolver.includes('"p-gallery"'));
  check("stack + best-work map to first-empty field sets",
    resolver.includes("EARN_STACK_IDS") && resolver.includes("EARN_WORK_IDS") && appJs.includes('"p-followers"') && appJs.includes('"p-work-0"'));
  check("first offer maps to the Offers deck; invites map to the roster panel on Momentum",
    resolver.includes('case "firstoffer"') && resolver.includes('"Offers"') && resolver.includes('case "referrals"') && resolver.includes('"grow-roster"'));
  check("state-dependent rows gate on dueBookingId and route to My Visits",
    resolver.includes("dueBookingId") && fnSlice("earnGo", "profileCompletionHtml").includes('"My Visits"') && fnSlice("earnGo", "profileCompletionHtml").includes("state.visitFocus"));
  check("outcome rows never resolve to an action (ontime, streak, aduse)",
    !resolver.includes('case "ontime"') && !resolver.includes('case "streak"') && !resolver.includes('case "aduse"'));
  check("done rows resolve to no action (checkmarks stay plain)",
    resolver.includes("if (item.done) return null"));
  check("first offer is not linked before the market is live (founding clamp)",
    resolver.includes("founding") && resolver.includes("marketLive"));
  check("roster panel carries the grow-roster anchor",
    fnSlice("growRosterHtml", "profileCompletionHtml").includes('id="grow-roster"') || appJs.includes('id="grow-roster"'));

  part("source: affordance css");
  check("linked rows are real buttons, reset to the row layout",
    themeCss.includes("button.earn-row") && themeCss.includes("cursor: pointer"));
  check("linked + sits in a filled mint circle; chevron trails",
    themeCss.includes(".earn-row.earn-link .earn-state") && themeCss.includes("background: var(--mint)") && themeCss.includes(".earn-chev"));

  part("source: icon rule + signed-out sign-in (Jeff, 2026-10-27)");
  check("the leading icon is resolved in one place: earnStateHtml, used by earnRowWrap",
    appJs.includes("function earnStateHtml(") && fnSlice("earnRowWrap", "earnFindEl").includes("earnStateHtml(item, u)"));
  check("three states: done check, actionable +, otherwise the empty earn-slot",
    appJs.includes("earn-state earn-slot") && appJs.includes('aria-hidden="true"'));
  check("renderers no longer bake a state glyph into the row body",
    !fnSlice("momentumHtml", "fmtNum").includes("earn-state") && !fnSlice("profileCompletionHtml", "momentumHtml").includes("earn-state"));
  check("slot css keeps the width and renders nothing",
    themeCss.includes(".earn-state.earn-slot") && themeCss.includes("border-color: transparent"));
  check("signed-out header: Sign in anchor carries nav-signin; anon class tracks auth state",
    appJs.includes('class="nav-signin"') && appJs.includes('classList.toggle("anon", !state.user)') && appJs.includes('class="nav-biz"'));
  check("redeem (staff pre-session) header carries a Sign in door too",
    fnSlice("renderNav", "bnIcon").includes("Staff redemption") && fnSlice("renderNav", "bnIcon").includes('go(\'signin\')'));
  check("mobile css: the anon topnav displays and only the founding links hide",
    stylesCss.includes("#topnav.anon { display: flex; }") && stylesCss.includes("#topnav.anon a.nav-cta"));

  part("source: server due-state computation");
  check("router computes the review-due and performance-due visits",
    routerJs.includes("reviewDueBooking") && routerJs.includes("perfDuePost") && routerJs.includes("dueBookingId: reviewDueBooking.id") && routerJs.includes("dueBookingId: perfDuePost.bookingId"));
  check("performance due means asked-for and not yet reported",
    routerJs.includes("p.performanceRequestedAt && !p.reportedAt"));

  part("payload: fixtures");
  startServer();
  await waitUp();
  const admin = makeClient();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200);

  const creator = makeClient();
  const reg = await creator("POST", "/api/auth/register", {
    role: "creator", name: "Earn Links Creator", email: "earnlinks@fixtures.dev", password: "password123",
    market: "Hampton Roads", city: "Virginia Beach", handle: "earnlinks757", tierBand: "Locals",
    followerCount: 8400, avgViews: 6200, localAudiencePct: 62, categories: ["Food & Drink"],
    bio: "Verification account created by scripts/verify-earnlinks.mjs",
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("creator registers", reg.status === 201, JSON.stringify(reg.data).slice(0, 200));
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });

  const biz = makeClient();
  const breg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Earn Links Owner", businessName: "Earn Links Table", email: "earnbiz@fixtures.dev",
    password: "password123", market: "Hampton Roads", city: "Norfolk", category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  check("business registers", breg.status === 201, JSON.stringify(breg.data).slice(0, 200));
  await admin("POST", "/api/admin/review", { userId: breg.data.user.id, decision: "approve" });
  const act = await admin("POST", "/api/admin/businesses/activate", { userId: breg.data.user.id });
  check("business activates", act.status === 200);

  const me = async () => (await creator("GET", "/api/auth/me")).data.user;

  part("payload: fresh creator — nothing due");
  const u0 = await me();
  check("reviews row: not done, no dueBookingId before any visit",
    itemOf(u0, "reviews").done === false && !("dueBookingId" in itemOf(u0, "reviews")), JSON.stringify(itemOf(u0, "reviews")));
  check("performance row: not done, no dueBookingId before any post",
    itemOf(u0, "performance").done === false && !("dueBookingId" in itemOf(u0, "performance")), JSON.stringify(itemOf(u0, "performance")));

  part("payload: a completed visit makes the review due");
  const offer = await biz("POST", "/api/offers", { title: "Earn links dinner", whatComped: "Dinner for two", dollarCap: 75, spots: 1, visitWindow: "Any night", creatorId: reg.data.user.id });
  check("direct offer created", offer.status === 201, JSON.stringify(offer.data).slice(0, 200));
  const accept = await creator("POST", `/api/offers/${offer.data.offer.id}/accept`, { visitDate: "2026-10-22" });
  check("creator accepts", accept.status === 201, JSON.stringify(accept.data).slice(0, 200));
  const booking = accept.data.booking;
  const redeem = await biz("POST", "/api/counter/redeem", { code: booking.code });
  check("counter redeems the visit", redeem.status === 200, JSON.stringify(redeem.data).slice(0, 200));
  const post = await creator("POST", "/api/posts", { bookingId: booking.id, url: "https://www.instagram.com/p/earnlinks1/", includesDisclosure: true });
  check("creator submits the post (booking completes)", post.status === 201, JSON.stringify(post.data).slice(0, 200));

  const u1 = await me();
  check("reviews row now carries dueBookingId for the completed, unreviewed visit",
    itemOf(u1, "reviews").dueBookingId === booking.id, JSON.stringify(itemOf(u1, "reviews")));
  check("performance row still has no dueBookingId (the ask has not fired)",
    !("dueBookingId" in itemOf(u1, "performance")), JSON.stringify(itemOf(u1, "performance")));

  part("payload: the day-7 ask makes the report due");
  await stopServer();
  editDb((db) => {
    for (const [key, val] of Object.entries(db)) {
      if (key.startsWith("post:") && val.bookingId === booking.id) {
        val.submittedAt = new Date(Date.now() - 8 * DAY).toISOString();
        delete val.performanceRequestedAt;
      }
    }
  });
  startServer();
  await waitUp();
  const admin2 = makeClient();
  await admin2("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const sweep = await admin2("POST", "/api/admin/compliance/sweep", {});
  check("compliance sweep ran", sweep.status === 200, JSON.stringify(sweep.data).slice(0, 200));
  const creator2 = makeClient();
  await creator2("POST", "/api/auth/login", { email: "earnlinks@fixtures.dev", password: "password123" });
  const me2 = async () => (await creator2("GET", "/api/auth/me")).data.user;
  const u2 = await me2();
  check("performance row now carries dueBookingId for the asked, unreported post",
    itemOf(u2, "performance").dueBookingId === booking.id, JSON.stringify(itemOf(u2, "performance")));
  check("reviews row still due alongside it",
    itemOf(u2, "reviews").dueBookingId === booking.id, JSON.stringify(itemOf(u2, "reviews")));

  part("payload: completing each action clears its due state");
  const review = await creator2("POST", `/api/bookings/${booking.id}/review-business`, { stars: 5, text: "Comp honored exactly as listed." });
  check("creator leaves the business review", review.status === 201 || review.status === 200, JSON.stringify(review.data).slice(0, 200));
  const u3 = await me2();
  check("reviews row: done, dueBookingId cleared",
    itemOf(u3, "reviews").done === true && !("dueBookingId" in itemOf(u3, "reviews")), JSON.stringify(itemOf(u3, "reviews")));
  check("performance row: still due (independent state)",
    itemOf(u3, "performance").dueBookingId === booking.id, JSON.stringify(itemOf(u3, "performance")));
  const perf = await creator2("POST", `/api/bookings/${booking.id}/performance`, { views: 1200, likes: 48, comments: 6, shares: 2 });
  check("creator reports the post numbers", perf.status === 201 || perf.status === 200, JSON.stringify(perf.data).slice(0, 200));
  const u4 = await me2();
  check("performance row: done, dueBookingId cleared",
    itemOf(u4, "performance").done === true && !("dueBookingId" in itemOf(u4, "performance")), JSON.stringify(itemOf(u4, "performance")));

  console.log(`\nverify-earnlinks: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
} catch (err) {
  console.error("verify-earnlinks crashed:", err);
  process.exitCode = 1;
} finally {
  await stopServer();
}
