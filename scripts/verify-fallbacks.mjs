// Secondary verification: the bad-day fallbacks from the redemption
// spec (signl-redemption-system.md). Creator checks in ("I am here"),
// the business confirms the visit in the dashboard without the code,
// and the 48 hour clock still starts from that confirmation.
// Also covers open (untargeted) offers and the overdue -> replacement
// path is exercised only for its guard (not overdue yet -> 409).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8918;
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `signl-verify2-${Date.now()}.json`);
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}
function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = sc.split(";")[0]; const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  };
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + "/api/bootstrap"); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL: "jeff@joinsignl.com", ADMIN_PASSWORD: "verify-admin-pass-123", APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  check("server boots", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "verify-admin-pass-123" });

  const creator = client();
  const rc = await creator("POST", "/api/auth/register", { role: "creator", name: "Fallback Creator", email: "fc@example.com", password: "creator-pass-123", market: "Richmond", city: "Richmond", handle: "fallbackeats", tierBand: "Neighbors", followerCount: 900, localAudiencePct: 80, categories: ["Food & Drink"], agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true });
  await admin("POST", "/api/admin/review", { userId: rc.data.user.id, decision: "approve" });

  const business = client();
  const rb = await business("POST", "/api/auth/register", { role: "business", name: "Fallback Owner", businessName: "Fallback Cafe", email: "fbiz@example.com", password: "business-pass-123", market: "Richmond", city: "Richmond", category: "Coffee & Bakery", planId: "self-service", agreedTerms: true });
  await admin("POST", "/api/admin/review", { userId: rb.data.user.id, decision: "approve" });
  check("self-service plan recorded at $299", rb.data.user.business.planPriceMonthly === 299);

  const offer = await business("POST", "/api/offers", { title: "Coffee flight on us", whatComped: "One coffee flight", dollarCap: 25, spots: 2, visitWindow: "Weekdays" });
  check("open offer created", offer.status === 201);
  // Open offers run on applications now (offer flow v2): the
  // creator applies with one tap and the business selects, which
  // creates the booking the fallback checks below exercise.
  const applied = await creator("POST", `/api/offers/${offer.data.offer.id}/apply`, {});
  check("creator applies to the open offer", applied.status === 201, JSON.stringify(applied.data));
  const accept = await business("POST", `/api/offers/${offer.data.offer.id}/select`, { applicationId: applied.data.application.id });
  check("business selects and a booking is created", accept.status === 201, JSON.stringify(accept.data));
  const bookingId = accept.data.booking.id;

  const doubleBook = await creator("POST", `/api/offers/${offer.data.offer.id}/apply`, {});
  check("same creator cannot apply twice (409)", doubleBook.status === 409, String(doubleBook.status));

  const checkin = await creator("POST", `/api/bookings/${bookingId}/checkin`, {});
  check("creator checks in (I am here)", checkin.status === 200 && !!checkin.data.booking.checkinAt, JSON.stringify(checkin.data));

  const prematurePost = await creator("POST", "/api/posts", { bookingId, url: "https://www.instagram.com/p/EARLY/", includesDisclosure: true });
  check("post before redemption is refused (409)", prematurePost.status === 409, String(prematurePost.status));

  const confirm = await business("POST", `/api/bookings/${bookingId}/confirm`, {});
  check("business confirms the visit without the code", confirm.status === 200 && confirm.data.booking.redeemMethod === "business_confirm", JSON.stringify(confirm.data));
  check("clock starts at confirmation", !!confirm.data.booking.redeemedAt && !!confirm.data.booking.postDeadline);

  const counterAfter = await business("POST", "/api/counter/redeem", { code: accept.data.booking.code });
  check("counter redeem after confirm is refused (already redeemed)", counterAfter.status === 409);

  const replacementEarly = await business("POST", `/api/bookings/${bookingId}/replacement`, {});
  check("replacement before overdue is refused (409)", replacementEarly.status === 409);

  const declineFlow = await business("POST", "/api/offers", { title: "Targeted test", whatComped: "A tasting", dollarCap: 40, spots: 1, creatorId: rc.data.user.id });
  const decline = await creator("POST", `/api/offers/${declineFlow.data.offer.id}/decline`, {});
  check("invited creator can decline a targeted offer", decline.status === 200 && decline.data.offer.status === "declined");

  const events = await admin("GET", "/api/admin/events?limit=500");
  const types = (events.data.events || []).map((e) => e.type);
  check("fallback events logged (checkin + business confirm)", types.includes("creator_checked_in") && types.includes("visit_confirmed_by_business") && types.includes("code_redeemed"));
  check("offer_declined logged", types.includes("offer_declined"));
} finally {
  server.kill("SIGTERM");
  try { fs.unlinkSync(DB); } catch {}
}
console.log(`\nFallback verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
