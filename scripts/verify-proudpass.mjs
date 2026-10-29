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

let server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
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
  // Charter stamp (Build -31): this suite flipped the market live
  // before the creator existed, so flip it back off for the
  // founding read that seals Charter, then restore it. The window
  // must not hide the open offers makeRedeemedBooking applies to.
  await admin("POST", "/api/admin/markets/toggle", { market: "Virginia Beach", live: false });
  await cre("GET", "/api/me/founding");
  await admin("POST", "/api/admin/markets/toggle", { market: "Virginia Beach", live: true });

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
  // Founding price hierarchy (Jeff, 2026-10-26): the standard
  // rate is the hero figure on every plan card; the founding
  // first-month price sits directly under it as the mint badge;
  // the duplicate small-print first-month line is gone, and the
  // surviving small line carries only the minimum + rate-held.
  check("plan cards lead with the standard rate as the hero figure", appJs.includes('<div class="price">$${fmtPrice(p.priceMonthly)}<span class="small muted">/mo</span></div>'));
  check("the founding badge sits directly under the hero price on all three plan-card renders", (appJs.match(/founding-badge-row/g) || []).length === 3 && appJs.includes('class="founding-badge">FOUNDING: FIRST MONTH $${fmtPrice(p.firstMonthPriceMonthly)}'));
  check("no plan card restates the first-month price in small print", !appJs.includes("with the $100 founding credit.</p>") && !appJs.includes('<p class="small">First month'));
  check("the surviving small line keeps only the minimum + founding-rate-held meaning", appJs.includes('-month minimum. Founding rate, locked while your plan stays active.'));
  const stylesCss = fs.readFileSync(path.join(import.meta.dirname, "..", "public", "styles.css"), "utf8");
  check("the founding badge is styled bold mint", stylesCss.includes(".founding-badge {") && stylesCss.includes("background: #A9E8C9") && stylesCss.includes("font-weight: 800"));
  check("F7 biz landing requires a business signal", appJs.includes('bizParams.businessName || bizParams.category || (srcParam || "").trim().toLowerCase() === "business-wave"'));
  check("F7 market alone no longer routes to join-business", !appJs.includes("bizParams.businessName || bizParams.market || bizParams.category"));
  check("F1 dashboard opportunities take bookings + applications", appJs.includes("function homeOpportunitiesHtml(offers, u, bookings, applications)"));
  check("F1 dashboard renders Booked state", appJs.includes('<span class="badge ok">Booked</span>'));
  check("F1 dashboard renders Applied state", appJs.includes("Waiting on the business"));
  check("F1 homeApplyOffer posts the apply", appJs.includes("async function homeApplyOffer(offerId)") && appJs.includes("`/offers/${offerId}/apply`"));
  check("F1 direct list computes booked offers", appJs.includes("const booked = bookedOfferIds.has(o.id)"));
  check("F3 home line is founding-honest + data-driven", appJs.includes("Founding sign-ups open in all ${") && !appJs.includes("Open now in all 39 markets"));
  check("F3 no stale 39-market copy remains", !appJs.includes("39 markets"));
  // V3 (2026-10-27): the business Home overview is the Sig queue
  // now; the unset-PIN task is queued there from staffPinSet
  // (and noticed on Visits). bizDashAttentionHtml keeps its
  // pinItem option for the preview surface.
  check("F4 overview attention passes pinItem", appJs.includes("const pin = !!o.pinItem;") && appJs.includes("staffPinSet === false"));
  check("F5 ROAS waits for a real tally", appJs.includes("c.redemptions && c.redemptions.count > 0"));
  check("F6 Needed badge hides on done essentials", appJs.includes("item.required && !item.done"));
  check("F8 preview paid booking renders a sheet", appJs.includes('el.setAttribute("aria-label", "Preview paid booking")'));
  check("F8 preview paid booking no longer alerts the breakdown", !appJs.includes("alert(`PREVIEW paid booking (simulation)"));

  console.log("== P1: admin Markets labels (Jeff's phone screenshots) ==");
  const themeCss = fs.readFileSync(path.join(import.meta.dirname, "..", "public", "theme-v2.css"), "utf8");
  const routerJs = fs.readFileSync(path.join(import.meta.dirname, "..", "netlify", "functions", "lib", "router.js"), "utf8");
  check("P1 stacked tables carry a data-label mechanism", themeCss.includes(".table-wrap td[data-label]::before") && themeCss.includes("content: attr(data-label)"));
  check("P1 Markets roster pairs every count with its label", appJs.includes("approved creators") && appJs.includes("complete") && appJs.includes("approved businesses") && appJs.includes("on the founding list"));
  check("P1 Markets action states its consequence", appJs.includes("Opens publishing and bookings here. Founding businesses still activate separately."));
  check("P1 Markets action is card-sized", appJs.includes('class="btn small-btn ${m.live ? "danger" : ""}"'));
  check("P1 roster-counts view pairs counts with labels", appJs.includes("approved + complete") && appJs.includes("<strong>${m.pending}</strong> pending"));
  check("P1 no bare founding-list fragment remains", !appJs.includes("Founding list:"));
  check("P1 stats rows label their numbers", appJs.includes('data-label="Approved creators"') && appJs.includes('data-label="Bookings"') && appJs.includes('data-label="Creator sign-ups"'));
  check("P1 server ships the complete count for markets", routerJs.includes("creatorsApprovedComplete"));

  console.log("== P2: Later piles persist, hide excludes, bad input refused ==");
  const ds0 = await cre("GET", "/api/deck-state");
  check("P2 deck-state starts empty", ds0.status === 200 && Array.isArray(ds0.data.decks.offers.later) && ds0.data.decks.offers.later.length === 0, JSON.stringify(ds0.data).slice(0, 120));
  const park = await cre("POST", "/api/deck-state", { deck: "offers", action: "later", itemId: offerId });
  check("P2 later parks the item", park.status === 200 && park.data.decks.offers.later.includes(offerId) && park.data.decks.offers.usedLater === true, JSON.stringify(park.data).slice(0, 140));
  const creFresh = client();
  await creFresh("POST", "/api/auth/login", { email: "passcreator@fixtures.dev", password: "<MASKED_SECRET_001>" });
  const dsFresh = await creFresh("GET", "/api/deck-state");
  check("P2 later persists across sessions", (dsFresh.data.decks.offers.later || []).includes(offerId), JSON.stringify(dsFresh.data).slice(0, 140));
  const hide = await cre("POST", "/api/deck-state", { deck: "offers", action: "hide", itemId: offerId });
  check("P2 hide moves the item out of later into hidden", hide.status === 200 && hide.data.decks.offers.hidden.includes(offerId) && !hide.data.decks.offers.later.includes(offerId));
  const unhide = await cre("POST", "/api/deck-state", { deck: "offers", action: "unhide", itemId: offerId });
  check("P2 unhide restores the item", unhide.status === 200 && !unhide.data.decks.offers.hidden.includes(offerId));
  const badDeck = await cre("POST", "/api/deck-state", { deck: "bogus", action: "later", itemId: "x" });
  check("P2 unknown deck is refused (400)", badDeck.status === 400, `got ${badDeck.status}`);
  const bizPark = await biz("POST", "/api/deck-state", { deck: "discover", action: "later", itemId: regCre.data.user.id });
  check("P2 business parks a creator in discover", bizPark.status === 200 && bizPark.data.decks.discover.later.includes(regCre.data.user.id));
  check("P2 client ships the Later system", appJs.includes("function startDeck(") && appJs.includes("Second look") && appJs.includes("Swipe left to park in Later. Nothing is a no until you say so.") && appJs.includes("function openLaterPile(") && appJs.includes("Review Later ("));
  check("P2 session-only Show passed is gone everywhere", !appJs.includes("Show passed") && !appJs.includes("passedIds"));

  console.log("== P3: the 48 hour reframe (standard at 48h, failure at the week) ==");
  check("P3 business promise carries the asterisk line", appJs.includes("Posts delivered in 48 hours*") && appJs.includes("*Creators have up to a week; 48 hours is the standard they are held to."));
  check("P3 creator grace caption ships in the deal block", appJs.includes("Up to a week at the outside. 48 hours is the standard and earns the Momentum."));
  check("P3 in-week lateness reads Post late, not failure", appJs.includes('>Post late</span>') && !appJs.includes("Post overdue"));
  check("P3 standard visit summary states the grace", routerJs.includes("48 hours is the standard creators are held to; a post inside one week still counts, as a late delivery."));
  check("P3 replacement gate names the week", routerJs.includes("Replacements open when a full week passes with no post."));
  check("P3 preview problem booking no longer offers an early replacement", routerJs.includes("b.replacementAvailable = false;"));

  async function makeRedeemedBooking(title) {
    const off = await biz("POST", "/api/offers", { title, whatComped: "Tasting menu", dollarCap: 50, spots: 1, visitWindow: "Any day" });
    const oid = off.data.offer.id;
    const applied = await cre("POST", `/api/offers/${oid}/apply`, {});
    const sel = await biz("POST", `/api/offers/${oid}/select`, { applicationId: applied.data.application.id });
    const bk = sel.data.booking;
    const redeem = await biz("POST", "/api/counter/redeem", { code: bk.code });
    return { oid, bk, redeem };
  }
  const A = await makeRedeemedBooking("Reframe tasting A");
  check("P3 booking A redeemed, clock running", A.redeem.status === 200 && !!A.redeem.data.booking.redeemedAt, JSON.stringify(A.redeem.data).slice(0, 140));
  const B = await makeRedeemedBooking("Reframe tasting B");
  check("P3 booking B redeemed", B.redeem.status === 200, JSON.stringify(B.redeem.data).slice(0, 120));

  const DAY = 24 * 3600 * 1000;
  async function restartWithShift(bookingId, daysAgo) {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 600));
    const db = JSON.parse(fs.readFileSync(DB, "utf8"));
    const key = `booking:${bookingId}`;
    const rec = db[key];
    rec.redeemedAt = new Date(Date.now() - daysAgo * DAY).toISOString();
    rec.postDeadline = new Date(Date.now() - daysAgo * DAY + 48 * 3600 * 1000).toISOString();
    rec.compliance = {};
    db[key] = rec;
    fs.writeFileSync(DB, JSON.stringify(db, null, 1));
    server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
      cwd: path.join(import.meta.dirname, ".."),
      env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD: "<MASKED_SECRET_003>", APP_URL: BASE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(BASE + "/api/bootstrap"); if (r.ok) return; } catch (e) { /* booting */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("server did not come back up");
  }

  await restartWithShift(A.bk.id, 3);
  const earlyReplacement = await biz("POST", `/api/bookings/${A.bk.id}/replacement`, {});
  check("P3 replacement inside the week is refused (409)", earlyReplacement.status === 409 && /full week/.test(earlyReplacement.data.error || ""), `got ${earlyReplacement.status}: ${JSON.stringify(earlyReplacement.data).slice(0, 140)}`);
  const latePost = await cre("POST", "/api/posts", { bookingId: A.bk.id, url: "https://www.instagram.com/p/LATEWEEK/", includesDisclosure: true });
  check("P3 a post at 72 hours is accepted", latePost.status === 201 || latePost.status === 200, `got ${latePost.status}: ${JSON.stringify(latePost.data).slice(0, 140)}`);
  const creBookings = await cre("GET", "/api/bookings");
  const bkA = (creBookings.data.bookings || []).find((b) => b.id === A.bk.id);
  check("P3 the late post counts as delivered (submitted_late)", !!bkA && bkA.postState === "submitted_late", bkA && bkA.postState);

  await restartWithShift(B.bk.id, 8);
  const weekReplacement = await biz("POST", `/api/bookings/${B.bk.id}/replacement`, {});
  check("P3 replacement opens after the week passes", weekReplacement.status === 200 && !!weekReplacement.data.booking.replacementRequestedAt, `got ${weekReplacement.status}: ${JSON.stringify(weekReplacement.data).slice(0, 140)}`);

  console.log(`\nverify-proudpass: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("failures:", failures.join(" | ")); process.exitCode = 1; }
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
