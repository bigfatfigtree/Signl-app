// End-to-end verification of the SIGNL public app through the REAL
// sign-up path (no seeded accounts). Spawns the dev server with a
// throwaway local database, then walks the full flow:
//   creator registers -> admin approves -> business registers (plan
//   chosen) -> admin approves -> discover -> favorite -> offer ->
//   accept -> SGNL code issued -> counter lookup -> redeem (48h clock)
//   -> post submitted on time -> business verifies post -> messages
//   both ways -> admin event log contains every step.
// Run: node scripts/verify-flow.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8917;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`);
  }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (v) jar.set(k, v); else jar.delete(k);
      }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data };
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + "/api/bootstrap");
      if (res.ok) return true;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: {
    ...process.env,
    SIGNL_LOCAL: "1",
    SIGNL_LOCAL_DB: DB,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    APP_URL: BASE,
    // Test-only override: production closes business registration and
    // keeps every market not-live until an admin activates it. The
    // suites flip this on to exercise the gated business flows.
    SIGNL_TEST_ALLOW_BUSINESS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const anon = client();
  const boot = await anon("GET", "/api/bootstrap");
  check("bootstrap lists 11 markets", boot.data.markets && boot.data.markets.length === 11, JSON.stringify(boot.data.markets && boot.data.markets.length));
  check("bootstrap plans are $299 and $799", boot.data.plans[0].priceMonthly === 299 && boot.data.plans[1].priceMonthly === 799);

  // --- creator registers through the real sign-up path ---
  const creator = client();
  const reg = await creator("POST", "/api/auth/register", {
    role: "creator",
    name: "Verify Creator",
    email: "vcreator@example.com",
    password: "creator-pass-123",
    market: "Hampton Roads",
    city: "Virginia Beach",
    handle: "verifyeats757",
    tierBand: "Locals",
    followerCount: 8400,
    avgViews: 6200,
    localAudiencePct: 62,
    categories: ["Food & Drink", "Nightlife"],
    bio: "Verification account created by scripts/verify-flow.mjs",
    agreedHonestPosts: true,
    agreedFtcDisclosure: true,
  });
  check("creator registration returns 201", reg.status === 201, JSON.stringify(reg.data));
  check("creator starts as pending", reg.data.user && reg.data.user.status === "pending");
  const creatorId = reg.data.user.id;

  const dup = await client()("POST", "/api/auth/register", {
    role: "creator", name: "Dupe", email: "vcreator@example.com", password: "creator-pass-123", market: "Hampton Roads", handle: "dupe",
  });
  check("duplicate email rejected with 409", dup.status === 409, String(dup.status));

  const blockedDiscover = await creator("GET", "/api/discover?market=Hampton%20Roads");
  check("pending creator cannot use the app yet (403)", blockedDiscover.status === 403, String(blockedDiscover.status));

  // --- admin approves the creator ---
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in (env-bootstrapped account)", adminLogin.status === 200 && adminLogin.data.user.role === "admin", JSON.stringify(adminLogin.data));
  const badLogin = await client()("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: "wrong-password" });
  check("wrong password rejected with 401", badLogin.status === 401);

  const apps = await admin("GET", "/api/admin/applications");
  const pendingCreator = (apps.data.pending || []).find((u) => u.id === creatorId);
  check("admin sees the pending creator application", !!pendingCreator);
  const approve1 = await admin("POST", "/api/admin/review", { userId: creatorId, decision: "approve" });
  check("admin approves creator", approve1.status === 200 && approve1.data.user.status === "approved");

  // --- business registers, chooses the Managed plan ---
  const business = client();
  const regB = await business("POST", "/api/auth/register", {
    role: "business",
    name: "Verify Owner",
    businessName: "Verify Table",
    email: "vbiz@example.com",
    password: "business-pass-123",
    market: "Hampton Roads",
    city: "Norfolk",
    category: "Restaurant",
    planId: "managed",
  });
  check("business registration returns 201", regB.status === 201, JSON.stringify(regB.data));
  check("business plan recorded as Managed $799", regB.data.user.business && regB.data.user.business.plan === "managed" && regB.data.user.business.planPriceMonthly === 799);
  check("founding billing is honest (no card charged)", /no card charged/i.test(regB.data.user.business.billingStatus), regB.data.user.business.billingStatus);
  const businessId = regB.data.user.id;

  const apps2 = await admin("GET", "/api/admin/applications");
  check("admin sees the pending business application", (apps2.data.pending || []).some((u) => u.id === businessId));
  const approve2 = await admin("POST", "/api/admin/review", { userId: businessId, decision: "approve" });
  check("admin approves business", approve2.status === 200 && approve2.data.user.status === "approved");

  // --- discovery, favorite, offer ---
  const disc = await business("GET", "/api/discover?market=Hampton%20Roads");
  const found = (disc.data.creators || []).find((c) => c.userId === creatorId);
  check("business discovers the approved creator in market", !!found, JSON.stringify(disc.data.creators && disc.data.creators.length));
  check("creator local audience shows Self-reported", found && found.profile.localAudienceSource === "Self-reported");
  check("Local Impact Score computed from stored inputs", found && typeof found.localImpactScore === "number", found && String(found.localImpactScore));

  const fav = await business("POST", "/api/favorites", { creatorId });
  check("favorite toggles on", fav.status === 200 && fav.data.isFavorite === true);

  const offer = await business("POST", "/api/offers", {
    title: "Dinner for two on us",
    whatComped: "Two entrees and two drinks for the creator and a guest",
    dollarCap: 75,
    spots: 1,
    visitWindow: "Any Tuesday to Thursday",
    creatorId,
  });
  check("business creates a targeted offer", offer.status === 201, JSON.stringify(offer.data));
  const offerId = offer.data.offer.id;

  // --- creator accepts, code issued ---
  const creatorOffers = await creator("GET", "/api/offers");
  check("creator sees the targeted offer", (creatorOffers.data.offers || []).some((o) => o.id === offerId));
  const accept = await creator("POST", `/api/offers/${offerId}/accept`, { visitDate: "2026-10-22" });
  check("creator accepts and a booking is created", accept.status === 201, JSON.stringify(accept.data));
  const booking = accept.data.booking;
  check("booking code matches SGNL-XXXXXX", /^SGNL-[A-Z0-9]{6}$/.test(booking.code), booking.code);
  const bookingId = booking.id;

  const qr = await creator("GET", `/api/bookings/${bookingId}/qr`);
  check("QR endpoint returns an SVG for the booking code", qr.status === 200 && String(qr.data.raw || "").includes("<svg"), `status=${qr.status}`);

  // --- counter: lookup, redeem, double-redeem blocked ---
  const badLookup = await business("POST", "/api/counter/lookup", { code: "SGNL-ZZZZZZ" });
  check("unknown code rejected at the counter", badLookup.status === 404);
  const lookup = await business("POST", "/api/counter/lookup", { code: booking.code });
  check("counter lookup finds the booking", lookup.status === 200 && lookup.data.booking.id === bookingId);
  const redeem = await business("POST", "/api/counter/redeem", { code: booking.code });
  check("counter redeem burns the code", redeem.status === 200 && !!redeem.data.booking.redeemedAt, JSON.stringify(redeem.data));
  const deadlineMs = Date.parse(redeem.data.booking.postDeadline) - Date.parse(redeem.data.booking.redeemedAt);
  check("48 hour clock starts at redemption", Math.abs(deadlineMs - 48 * 3600000) < 5000, String(deadlineMs));
  const redeem2 = await business("POST", "/api/counter/redeem", { code: booking.code });
  check("second redeem of the same code is refused (409)", redeem2.status === 409, String(redeem2.status));

  // --- post submission inside the window ---
  const post = await creator("POST", "/api/posts", {
    bookingId,
    url: "https://www.instagram.com/p/VERIFYPOST/",
    includesDisclosure: true,
  });
  check("creator submits the post", post.status === 201, JSON.stringify(post.data));
  check("post tracked as on time", post.data.post && post.data.post.onTime === true);
  const postId = post.data.post.id;
  const verify = await business("POST", `/api/posts/${postId}/verify`, {});
  check("business verifies the post is live", verify.status === 200 && !!verify.data.post.verifiedAt);

  // --- messages both ways ---
  const m1 = await creator("POST", "/api/messages", { toUserId: businessId, body: "Thanks for having us in. Post is live." });
  check("creator messages the business", m1.status === 201);
  const m2 = await business("POST", "/api/messages", { toUserId: creatorId, body: "Saw it, looks great. Come back any time." });
  check("business replies", m2.status === 201);
  const thread = await business("GET", `/api/messages?with=${creatorId}`);
  check("thread contains both messages", (thread.data.messages || []).length === 2, JSON.stringify(thread.data.messages && thread.data.messages.length));

  // --- profile data keeps flowing into the dataset ---
  const upd = await creator("PATCH", "/api/me/profile", { localAudiencePct: 70 });
  check("creator updates local audience to 70", upd.status === 200 && upd.data.user.creator.localAudiencePct === 70);

  // --- admin event log: every step is in the dataset ---
  const events = await admin("GET", "/api/admin/events?limit=500");
  const types = (events.data.events || []).map((e) => e.type);
  const count = (t) => types.filter((x) => x === t).length;
  const required = [
    "application_submitted", "application_approved", "plan_selected",
    "favorite_added", "offer_created", "offer_accepted", "booking_code_issued",
    "code_redeemed", "post_submitted", "post_verified", "message_sent",
    "profile_updated", "local_audience_updated", "user_signed_in",
  ];
  for (const t of required) check(`event log contains ${t}`, count(t) >= 1, `count=${count(t)}`);
  check("two applications submitted", count("application_submitted") >= 2);
  check("two approvals recorded", count("application_approved") >= 2);
  check("two messages logged", count("message_sent") >= 2);
  const redeemEvent = (events.data.events || []).find((e) => e.type === "code_redeemed");
  check("redeem event carries market and deadline", !!redeemEvent && redeemEvent.market === "Hampton Roads" && !!redeemEvent.data.postDeadline);

  // --- admin stats roll up by market ---
  const stats = await admin("GET", "/api/admin/stats");
  const hr = stats.data.perMarket && stats.data.perMarket["Hampton Roads"];
  check("stats: Hampton Roads has 1 creator, 1 business, 1 post", !!hr && hr.creators === 1 && hr.businesses === 1 && hr.posts === 1, JSON.stringify(hr));
  check("stats: posts on-time rate is 100%", stats.data.posts && stats.data.posts.onTimeRate === 100);
} finally {
  server.kill("SIGTERM");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nVerification: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("Failures: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
