// Verification of the 2026-10-26 perfection pass (app surfaces +
// site-to-app seams). Boots the dev server on a throwaway DB and
// checks:
//   F2  a booked direct offer cannot be declined (409, booking and
//       offer stay consistent), and re-accepting your own booking
//       answers "You already booked this offer" (not the spots-full
//       message a full 1-spot offer used to produce first)
//   F7  source pins: the business landing needs a business signal
//       (name / category / business-wave src); market alone is the
//       creator city-page pattern and must not route to join-business
//   F1  source pins: dashboard opportunities + the direct list are
//       state-aware (Booked / Applied / Apply), homeApplyOffer exists
//   F3  source pin: the home market line is founding-honest and
//       data-driven, never the stale "39 markets" hardcode
//   F4  source pin: the overview attention call passes pinItem
//   F5  source pin: Results ROAS renders only with a real tally
//   F6  source pin: a done essential never wears the Needed badge
//   F8  source pin: the preview paid-booking result is a sheet,
//       not a native alert
// Run: node scripts/verify-proudpass.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8946;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const DB = path.join(os.tmpdir(), `signl-verify-proudpass-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  };
}

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(import.meta.dirname, ".."),
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD: "<MASKED_SECRET_003>", APP_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + "/api/bootstrap"); if (r.ok) break; } catch (e) { /* booting */ }
    await new Promise((r) => setTimeout(r, 250));
    if (i === 59) throw new Error("server did not come up");
  }

  console.log("== F2: decline-after-accept is refused, state stays consistent ==");
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: "<MASKED_SECRET_003>" });
  await admin("POST", "/api/admin/markets/toggle", { market: "Virginia Beach", live: true });

  const biz = client();
  const regBiz = await biz("POST", "/api/auth/register", {
    role: "business", name: "Pass Biz", businessName: "Pass Biz", contactName: "Pat",
    email: "passbiz@fixtures.dev", password: "<MASKED_SECRET_004>", market: "Virginia Beach",
    businessCity: "Virginia Beach", category: "Restaurant", neighborhood: "Oceanfront",
    agreedTerms: true, plan: "growth",
  });
  check("business registers", regBiz.status === 201, JSON.stringify(regBiz.data).slice(0, 120));
  await admin("POST", "/api/admin/review", { userId: regBiz.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: regBiz.data.user.id });

  const cre = client();
  const regCre = await cre("POST", "/api/auth/register", {
    role: "creator", name: "Pass Creator", handle: "passcreator", email: "passcreator@fixtures.dev",
    password: "<MASKED_SECRET_001>", market: "Virginia Beach", city: "Virginia Beach",
    primaryPlatform: "instagram", followerCount: 5000, categories: ["Food & Drink"],
    localAudiencePct: 60, agreedHonestPosts: true, agreedFtcDisclosure: true,
    agreedPostCompliance: true, agreedTerms: true,
  });
  check("creator registers", regCre.status === 201, JSON.stringify(regCre.data).slice(0, 120));
  const creApprove = await admin("POST", "/api/admin/review", { userId: regCre.data.user.id, decision: "approve" });
  check("creator approved", creApprove.status === 200);

  const offerRes = await biz("POST", "/api/offers", {
    lane: "direct", creatorId: regCre.data.user.id, title: "Pass dinner", whatComped: "Dinner for two",
    includes: "Dinner for two", dollarCap: 75, spots: 1, visitWindow: "Any evening",
  });
  check("direct offer created", offerRes.status === 201, JSON.stringify(offerRes.data).slice(0, 120));
  const offerId = offerRes.data.offer.id;

  const accept = await cre("POST", `/api/offers/${offerId}/accept`, {});
  check("creator accepts", accept.status === 201, JSON.stringify(accept.data).slice(0, 120));

  const decline = await cre("POST", `/api/offers/${offerId}/decline`, {});
  check("decline after accept is refused (409)", decline.status === 409, `got ${decline.status}: ${JSON.stringify(decline.data).slice(0, 120)}`);
  check("decline refusal teaches the next step", /My Visits/.test(decline.data.error || ""), decline.data.error);

  const offersAfter = await biz("GET", "/api/offers");
  const offerAfter = (offersAfter.data.offers || []).find((o) => o.id === offerId);
  check("offer is NOT marked declined", !!offerAfter && offerAfter.status === "open", offerAfter && offerAfter.status);
  const bookingsAfter = await cre("GET", "/api/bookings");
  check("booking survives the decline attempt", (bookingsAfter.data.bookings || []).some((b) => b.offerId === offerId && b.status !== "cancelled"), JSON.stringify(bookingsAfter.data).slice(0, 120));

  const reaccept = await cre("POST", `/api/offers/${offerId}/accept`, {});
  check("re-accept answers already-booked", reaccept.status === 409 && /already booked/.test(reaccept.data.error || ""), `got ${reaccept.status}: ${JSON.stringify(reaccept.data).slice(0, 120)}`);

  console.log("== F1/F3/F4/F5/F6/F7/F8: client source pins ==");
  const appJs = fs.readFileSync(path.join(import.meta.dirname, "..", "public", "app.js"), "utf8");
  check("F7 biz landing requires a business signal", appJs.includes('bizParams.businessName || bizParams.category || (srcParam || "").trim().toLowerCase() === "business-wave"'));
  check("F7 market alone no longer routes to join-business", !appJs.includes("bizParams.businessName || bizParams.market || bizParams.category"));
  check("F1 dashboard opportunities take bookings + applications", appJs.includes("function homeOpportunitiesHtml(offers, u, bookings, applications)"));
  check("F1 dashboard renders Booked state", appJs.includes('<span class="badge ok">Booked</span>'));
  check("F1 dashboard renders Applied state", appJs.includes("Waiting on the business"));
  check("F1 homeApplyOffer posts the apply", appJs.includes("async function homeApplyOffer(offerId)") && appJs.includes("`/offers/${offerId}/apply`"));
  check("F1 direct list computes booked offers", appJs.includes("const booked = bookedOfferIds.has(o.id)"));
  check("F3 home line is founding-honest + data-driven", appJs.includes("Founding sign-ups open in all ${") && !appJs.includes("Open now in all 39 markets"));
  check("F3 no stale 39-market copy remains", !appJs.includes("39 markets"));
  check("F4 overview attention passes pinItem", appJs.includes("pinItem: d.staffPinSet === false"));
  check("F5 ROAS waits for a real tally", appJs.includes("c.redemptions && c.redemptions.count > 0"));
  check("F6 Needed badge hides on done essentials", appJs.includes("item.required && !item.done"));
  check("F8 preview paid booking renders a sheet", appJs.includes('el.setAttribute("aria-label", "Preview paid booking")'));
  check("F8 preview paid booking no longer alerts the breakdown", !appJs.includes("alert(`PREVIEW paid booking (simulation)"));

  console.log(`\nverify-proudpass: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("failures:", failures.join(" | ")); process.exitCode = 1; }
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
