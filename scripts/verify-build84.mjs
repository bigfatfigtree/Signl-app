// Build -84 verification: coupon-paid posts + editable deal terms.
//
// Jeff (2026-11-02, from the Chelsea call): a business can pay
// for a post with a COUPON (money off, percent off, store
// credit). The creator accepts the coupon as their payment; it
// is never assumed. A coupon deal is POST ONLY by default (no
// story, no extras). And EVERY deal kind gets editable terms in
// the offer flow, pre-filled with SIGNL's recommended standard:
// comped = 1 post + 1 story within 48h; paid = 1 post + 1 story
// within 48h (the 90-day license on a paid booking is NOT
// editable, it is a term of paid bookings); coupon = 1 post, no
// story, within 48h. Coupon posts carry native-share-only
// rights, exactly like comped posts; ad use only through the
// separate licensing flow. In creator Earnings a coupon counts
// as store value, never cash. Founding draft gates hold.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8994;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin84@fixtures.dev";
const ADMIN_PASSWORD = "admin-password-84";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b84-"));
const dbFile = path.join(tmp, "db.json");

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; console.log(`  FAIL - ${name}${detail ? " :: " + String(detail).slice(0, 260) : ""}`); }
}
function makeClient() {
  let cookie = "";
  return async (method, p, body) => {
    const res = await fetch(BASE + p, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data, text };
  };
}
const admin = makeClient();
let uniqN = 0;
const uniq = () => `${Date.now().toString(36)}${(uniqN++).toString(36)}`;

async function registerCreator(handle) {
  const client = makeClient();
  const r = await client("POST", "/api/auth/register", {
    role: "creator", name: `Creator ${handle}`, email: `${handle}@fixtures.dev`, password: "password123",
    market: "Hampton Roads", city: "Norfolk", handle,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: 5000, avgViews: 900, localAudiencePct: 62, bio: "",
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (r.status !== 201 || !r.data.user) throw new Error(`creator register failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { client, user: r.data.user };
}
async function registerBusiness(businessName, planId, market) {
  const client = makeClient();
  const r = await client("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", email: `biz-${uniq()}@fixtures.dev`, password: "password123",
    market: market || "Hampton Roads", city: market === "Nashville" ? "Nashville" : "Norfolk", businessName, category: "Restaurant", planId: planId || "growth", agreedTerms: true,
  });
  if (r.status !== 201 || !r.data.user) throw new Error(`business register failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { client, user: r.data.user };
}
async function approve(userId) {
  const r = await admin("POST", "/api/admin/review", { userId, decision: "approve" });
  if (r.status !== 200) throw new Error(`approve failed: ${r.status} ${JSON.stringify(r.data)}`);
}
async function activateBusiness(biz) {
  await approve(biz.user.id);
  const r = await admin("POST", "/api/admin/businesses/activate", { userId: biz.user.id });
  if (r.status !== 200) throw new Error(`activate failed: ${r.status} ${JSON.stringify(r.data)}`);
}
async function acceptAndConfirm(business, creator, offerId) {
  const acc = await creator.client("POST", `/api/offers/${offerId}/accept`, {});
  if (acc.status !== 201) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.data)}`);
  const conf = await business.client("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
  if (conf.status !== 200) throw new Error(`confirm failed: ${conf.status} ${JSON.stringify(conf.data)}`);
  return acc.data.booking;
}

async function main() {
  const loginRes = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginRes.status !== 200) throw new Error(`admin login failed: ${loginRes.status}`);

  const biz = await registerBusiness("Coupon Kitchen");
  await activateBusiness(biz);
  const chef = await registerCreator("couponchef");
  await approve(chef.user.id);

  // ---------- coupon create: defaults are the coupon standard ----------
  const cpn = await biz.client("POST", "/api/offers", {
    kind: "coupon", title: "Coupon tasting night", spots: 1, creatorId: chef.user.id,
    coupon: { type: "store_credit", amount: 200, appliesTo: "Anything in the store" },
  });
  check("coupon create: a store-credit coupon offer is created", cpn.status === 201 && cpn.data.offer && cpn.data.offer.kind === "coupon",
    `${cpn.status} ${JSON.stringify(cpn.data).slice(0, 200)}`);
  const co = cpn.data.offer || {};
  check("coupon create: the coupon is stored (type, amount, what it is good for)",
    co.coupon && co.coupon.type === "store_credit" && co.coupon.amount === 200 && co.coupon.appliesTo === "Anything in the store",
    JSON.stringify(co.coupon || null));
  check("coupon create: the value line reads in plain words and stands in for the comp line",
    co.whatComped === "$200 store credit at Coupon Kitchen, good for Anything in the store" && co.dollarCap === 200,
    JSON.stringify({ whatComped: co.whatComped, dollarCap: co.dollarCap }));
  check("coupon defaults: 1 post, NO story, post within 48 hours (the coupon standard)",
    co.deliverables && co.deliverables.posts === 1 && co.deliverables.story === false && co.deliverables.windowHours === 48,
    JSON.stringify(co.deliverables || null));
  check("coupon defaults: the brief deliverable line is the coupon standard, composed server-side",
    co.brief && co.brief.deliverable === "1 post. Post within 48 hours; one week is the hard deadline.",
    JSON.stringify((co.brief || {}).deliverable));

  // ---------- invalid coupons are refused ----------
  const noApplies = await biz.client("POST", "/api/offers", { kind: "coupon", title: "No good-for", spots: 1, coupon: { type: "amount_off", amount: 50 } });
  const noWorth = await biz.client("POST", "/api/offers", { kind: "coupon", title: "No worth", spots: 1, coupon: { type: "percent_off", appliesTo: "Dinner" } });
  check("coupon validation: a coupon without what it is good for, or without a worth, is refused",
    noApplies.status === 400 && noWorth.status === 400, `${noApplies.status}/${noWorth.status}`);

  // ---------- percent off: Build -132 (Jeff's ruling 4) — a
  // ---------- percent coupon REQUIRES a dollar cap so it
  // ---------- carries a real dollar worth on every card ----
  const pctNoCap = await biz.client("POST", "/api/offers", {
    kind: "coupon", title: "Percent night", spots: 1,
    coupon: { type: "percent_off", percent: 25, appliesTo: "Dinner for two" },
  });
  check("coupon create: percent off without a cap is REFUSED (Build -132 ruling: % coupons require a cap)",
    pctNoCap.status === 400 && /dollar cap/i.test((pctNoCap.data && pctNoCap.data.error) || ""),
    `${pctNoCap.status} ${JSON.stringify(pctNoCap.data).slice(0, 200)}`);
  const pct = await biz.client("POST", "/api/offers", {
    kind: "coupon", title: "Percent night", spots: 1,
    coupon: { type: "percent_off", percent: 25, cap: 60, appliesTo: "Dinner for two" },
  });
  check("coupon create: percent off WITH a cap is valid and shows its dollar worth",
    pct.status === 201 && pct.data.offer.coupon && pct.data.offer.coupon.cap === 60 && /up to \$60/.test(pct.data.offer.whatComped || ""),
    `${pct.status} ${JSON.stringify(pct.data.offer || pct.data).slice(0, 240)}`);

  // ---------- the creator's offer payload carries the coupon terms (Sig renders from this) ----------
  const crOffers = await chef.client("GET", "/api/offers");
  const crCpn = (crOffers.data.offers || []).find((o) => o.id === co.id) || {};
  check("creator payload: the coupon offer shows the coupon, its plain-words summary and the deliverables",
    crCpn.coupon && crCpn.coupon.amount === 200 && /store credit/.test(crCpn.couponSummary || "") && crCpn.deliverables && crCpn.deliverables.story === false,
    JSON.stringify({ coupon: crCpn.coupon, couponSummary: crCpn.couponSummary, deliverables: crCpn.deliverables }).slice(0, 220));

  // ---------- coupon accept round-trip ----------
  const cbk = await acceptAndConfirm(biz, chef, co.id);
  check("coupon accept: the booking is a coupon booking with the coupon snapshot and NO cash lane",
    cbk.kind === "coupon" && cbk.coupon && cbk.coupon.amount === 200 && !cbk.paidLane,
    JSON.stringify({ kind: cbk.kind, coupon: cbk.coupon, paidLane: cbk.paidLane || null }).slice(0, 220));
  check("coupon accept: the booking snapshots the coupon-standard deliverables",
    cbk.deliverables && cbk.deliverables.posts === 1 && cbk.deliverables.story === false && cbk.deliverables.windowHours === 48,
    JSON.stringify(cbk.deliverables || null));
  const post = await chef.client("POST", "/api/posts", { bookingId: cbk.id, url: `https://www.instagram.com/p/B84${uniq()}/`, includesDisclosure: true });
  check("coupon post: the creator can post on a coupon booking", post.status === 201, `${post.status} ${JSON.stringify(post.data).slice(0, 160)}`);
  const home = await biz.client("GET", "/api/me/business-home");
  const libRow = (((home.data || {}).home || {}).contentLibrary || []).find((r) => r.bookingId === cbk.id) || {};
  check("coupon post: the business library labels it a coupon post with NATIVE SHARE ONLY rights",
    libRow.kind === "coupon" && libRow.license && libRow.license.type === "native" && !libRow.license.windowEndsAt,
    JSON.stringify(libRow).slice(0, 240));
  const crBookings = await chef.client("GET", "/api/bookings");
  const crBk = (crBookings.data.bookings || []).find((b) => b.id === cbk.id) || {};
  check("creator side: the booking carries kind coupon and the coupon itself (Earnings shows it as store value)",
    crBk.kind === "coupon" && crBk.coupon && crBk.coupon.amount === 200,
    JSON.stringify({ kind: crBk.kind, coupon: crBk.coupon || null }).slice(0, 200));

  // ---------- comp defaults stay canon, byte for byte ----------
  const comp = await biz.client("POST", "/api/offers", { title: "Comp standard", whatComped: "Dinner for two", dollarCap: 60, spots: 1, creatorId: chef.user.id });
  check("comp defaults: 1 post + 1 story within 48 hours, and the legacy brief line is byte-identical",
    comp.status === 201 && comp.data.offer.deliverables.posts === 1 && comp.data.offer.deliverables.story === true && comp.data.offer.deliverables.windowHours === 48 &&
    comp.data.offer.brief.deliverable === "1 post + 1 story that shares the post. Post within 48 hours; one week is the hard deadline.",
    `${comp.status} ${JSON.stringify((comp.data.offer || {}).brief || {}).slice(0, 200)}`);

  // ---------- edited deliverables round-trip (comp, 2 posts, no story, 72h) ----------
  const edited = await biz.client("POST", "/api/offers", {
    title: "Edited comp", whatComped: "Brunch for two", dollarCap: 45, spots: 1, creatorId: chef.user.id,
    deliverables: { posts: 2, story: false, windowHours: 72 },
  });
  check("edited deliverables: the offer stores the business's terms, not the standard",
    edited.status === 201 && edited.data.offer.deliverables.posts === 2 && edited.data.offer.deliverables.story === false && edited.data.offer.deliverables.windowHours === 72,
    `${edited.status} ${JSON.stringify((edited.data.offer || {}).deliverables || null)}`);
  check("edited deliverables: the brief line is composed from the edited terms",
    edited.data.offer.brief.deliverable === "2 posts. Post within 3 days; one week is the hard deadline.",
    JSON.stringify((edited.data.offer.brief || {}).deliverable));
  const ebk = await acceptAndConfirm(biz, chef, edited.data.offer.id);
  check("edited deliverables: the booking snapshots the edited terms",
    ebk.deliverables && ebk.deliverables.posts === 2 && ebk.deliverables.story === false && ebk.deliverables.windowHours === 72,
    JSON.stringify(ebk.deliverables || null));
  const bizBookings = await biz.client("GET", "/api/bookings");
  const ebkFull = (bizBookings.data.bookings || []).find((b) => b.id === ebk.id) || {};
  const windowMs = Date.parse(ebkFull.postDeadline) - Date.parse(ebkFull.redeemedAt);
  check("edited deliverables: the post clock runs on the EDITED window (72h), not the 48h standard",
    ebkFull.postDeadline && ebkFull.redeemedAt && windowMs > 71.9 * 3600e3 && windowMs < 72.1 * 3600e3,
    JSON.stringify({ postDeadline: ebkFull.postDeadline, redeemedAt: ebkFull.redeemedAt, hours: windowMs / 3600e3 }));

  // ---------- paid: deliverables editable, the 90-day license is NOT ----------
  const paid = await biz.client("POST", "/api/offers", {
    kind: "paid", title: "Paid edited", spots: 1, creatorId: chef.user.id, cashRate: 150, whatComped: "Dinner for two",
    deliverables: { posts: 2, story: false, windowHours: 24 },
  });
  check("paid create: deliverables are editable on a paid offer too",
    paid.status === 201 && paid.data.offer.deliverables.posts === 2 && paid.data.offer.deliverables.windowHours === 24,
    `${paid.status} ${JSON.stringify((paid.data.offer || {}).deliverables || null)}`);
  check("paid create: the paid brief line stays the paid canon (terms set in the booking)",
    paid.data.offer.brief.deliverable === "Deliverables are set in the booking terms. Post on the agreed posting terms and keep the post live at least 30 days.",
    JSON.stringify((paid.data.offer.brief || {}).deliverable));
  const pbk = await acceptAndConfirm(biz, chef, paid.data.offer.id);
  check("paid license: the booking still carries the standard 90-day license even with edited deliverables (not removable)",
    pbk.paidLane && pbk.paidLane.licenseDays === 90,
    JSON.stringify(pbk.paidLane || null).slice(0, 200));
  const ppost = await chef.client("POST", "/api/posts", { bookingId: pbk.id, url: `https://www.instagram.com/p/B84${uniq()}/`, includesDisclosure: true });
  const home2 = await biz.client("GET", "/api/me/business-home");
  const paidRow = (((home2.data || {}).home || {}).contentLibrary || []).find((r) => r.bookingId === pbk.id) || {};
  check("paid post: the library license is the paid standard license, ad use window ending 90 days out",
    ppost.status === 201 && paidRow.license && paidRow.license.type === "standard" && paidRow.license.daysLeft >= 89 && paidRow.license.daysLeft <= 90,
    JSON.stringify(paidRow.license || null).slice(0, 200));

  // ---------- PATCH can edit a coupon and the deliverables ----------
  const patch = await biz.client("PATCH", `/api/offers/${pct.data.offer.id}`, {
    coupon: { type: "percent_off", percent: 30, cap: 40, appliesTo: "Dinner for two" },
    deliverables: { posts: 1, story: true, windowHours: 48 },
  });
  check("coupon edit: PATCH updates the coupon (cap lands, summary repriced) and the deliverables",
    patch.status === 200 && patch.data.offer.coupon.percent === 30 && patch.data.offer.coupon.cap === 40 && patch.data.offer.dollarCap === 40 &&
    patch.data.offer.whatComped === "30% off (up to $40 off) at Coupon Kitchen, good for Dinner for two" && patch.data.offer.deliverables.story === true,
    `${patch.status} ${JSON.stringify(patch.data.offer || patch.data).slice(0, 240)}`);

  // ---------- founding: coupon offers are drafts, publish refused ----------
  const fbiz = await registerBusiness("Founding Coupon Co", "self-service", "Nashville");
  await approve(fbiz.user.id);
  const fcpn = await fbiz.client("POST", "/api/offers", {
    kind: "coupon", title: "Founding coupon draft", spots: 2,
    coupon: { type: "amount_off", amount: 25, appliesTo: "Any purchase" },
  });
  check("founding: a coupon offer from a founding business is created as a DRAFT",
    fcpn.status === 201 && fcpn.data.offer.status === "draft",
    `${fcpn.status} ${JSON.stringify(fcpn.data.offer || fcpn.data).slice(0, 180)}`);
  const fpub = await fbiz.client("POST", `/api/offers/${fcpn.data.offer.id}/publish`, {});
  check("founding: publishing the coupon draft is refused until activation",
    fpub.status === 403, `${fpub.status} ${JSON.stringify(fpub.data).slice(0, 140)}`);
  const crSeesDraft = (crOffers.data.offers || []).some((o) => o.id === fcpn.data.offer.id);
  check("founding: the draft coupon offer is invisible to creators", !crSeesDraft, "");

  // ---------- the client bundle carries the flows ----------
  const shell = await (await fetch(`${BASE}/`)).text();
  check("shell: the build stamp is current", shell.includes("2026.11.05-132"), shell.slice(0, 120));
  const appJs = await (await fetch(`${BASE}/app.js`)).text();
  check("client: the composer carries the deliverables editor with the Recommended badge and all three kinds",
    appJs.includes("deliverablesEditorHtml") && appJs.includes("Recommended") && appJs.includes('value="coupon"') && appJs.includes("the coupon is the payment for the post. No cash changes hands."),
    "");
  check("client: the acceptance summary and Sig carry the coupon terms in plain words, never as cash",
    appJs.includes("The coupon is your payment for this post. No cash changes hands.") &&
    appJs.includes("sigB1AskCouponType") && appJs.includes("sigB1AskDeliverables") &&
    appJs.includes("couponSummaryClient(o.coupon, o.businessName)"),
    "");
  check("client: Earnings labels coupon value as store value, never cash earned",
    appJs.includes("Coupon deals") && appJs.includes("store value") && appJs.includes("never counts as cash earned"),
    "");
}

let server;
try {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  const deadline = Date.now() + 30000;
  for (;;) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error("server did not come up");
    await new Promise((r) => setTimeout(r, 250));
  }
  await main();
} catch (e) {
  failed++;
  console.log(`  FAIL - suite error: ${e.message}`);
} finally {
  if (server) server.kill("SIGTERM");
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nverify-build84: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
