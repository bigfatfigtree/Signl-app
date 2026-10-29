#!/usr/bin/env node
// BUILD 2026.10.29-31 verification (Jeff, 2026-10-29):
//   1) Proximity: ZIP-centroid distance BANDS on the founding
//      roster preview + Discover cards. Bands only: no counts
//      per band, no creator ZIP anywhere in a payload, and the
//      near-you opt-out removes banding only.
//   2) First Month Plan: client source carries five category
//      slots on a Week 1..4 grid with the preview label and the
//      Visit Guarantee line.
//   3) Founding scarcity copy on the app founding page + site.
//   4) Book-me page tiers (Amendments 1+2): Tier 0 showcase
//      only (no rate, no counts, no social links), Tier 1
//      business rate + book, Tier 2 paid/active adds social
//      links + in-platform message with the non-circumvention
//      system line; non-opted-in creator 404s.
//   5) Charter 24h early access: Charter sees a fresh open
//      offer now, non-Charter does not, and does after the
//      window (aged offer seeded by backdating the store).
//   6) The Local List endpoint + site pages: opt-ins only, no
//      count patterns anywhere.
//   7) Non-circumvention lockstep: terms clause, both signup
//      checkboxes, in-product reminder lines.
// Run: node scripts/verify-build31.mjs
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8941;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-31";
const WEBHOOK_SECRET = "whsec_build31_fixture";
const DB = path.join(os.tmpdir(), `signl-verify-build31-${Date.now()}.json`);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const SITE = path.join(ROOT, "..", "signl-site");
const THREAD_LINE = "This conversation started on SIGNL, so bookings from it run through SIGNL, where the Visit Guarantee and payment protection apply.";
const BOOKING_LINE = "This booking started on SIGNL, so it runs through SIGNL, where the Visit Guarantee and payment protection apply.";
const CHARTER_LINE = "You see new paid offers 24 hours before everyone else.";
const SCARCITY_LINE = "The founding business class is limited in every market. Founding businesses get first access when their market activates.";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  async function call(method, p, body, headers) {
    const h = { ...(headers || {}) };
    if (body && typeof body === "object") h["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers: h, body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, data, headers: res.headers };
  }
  call.raw = async (method, p, rawBody, headers) => {
    const res = await fetch(BASE + p, { method, headers: headers || {}, body: rawBody });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, data, headers: res.headers };
  };
  return call;
}

let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "", STRIPE_SECRET_KEY: "sk_test_fake_build31", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function makeCreator(admin, { name, email, handle, followers, localPct, categories }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle, followerCount: followers, localAudiencePct: localPct, categories,
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  return { client: c, id: reg.data.user.id, handle };
}

async function makeBusiness(admin, { businessName, email, category, planId, approve = false }) {
  const b = client();
  const reg = await b("POST", "/api/auth/register", {
    role: "business", name: "Owner " + businessName, businessName, email,
    password: "business-pass-123", market: "Richmond", city: "Richmond", category, planId,
    neighborhood: "Downtown", about: "", agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
  if (approve) await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  return { client: b, id: reg.data.user.id };
}

function signWebhook(raw) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${raw}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const anon = client();

  // ---------- fixtures: Richmond creators across the bands ----------
  // Business anchor: ZIP 23219, neighborhood "Downtown".
  //   23219 same ZIP -> Same neighborhood | 23220 = 1.53mi -> Under 2
  //   23221 = 3.13mi -> Under 5 | 23060 = 9.85mi -> no band
  //   23060 + neighborhood "Downtown" -> Same neighborhood (name)
  //   23219 + proximityOptOut -> no band
  const nina = await makeCreator(admin, { name: "Near Nina", email: "nina@fixtures.dev", handle: "nearnina", followers: 3000, localPct: 88, categories: ["Food & Drink"] });
  await nina.client("PATCH", "/api/me/profile", { zip: "23219", neighborhood: "Downtown", paidRate: 150, publicPage: true, featuredPosts: ["https://www.instagram.com/p/ABC123xyz/"] });
  const tom = await makeCreator(admin, { name: "Two Mile Tom", email: "tom@fixtures.dev", handle: "twotom", followers: 2400, localPct: 70, categories: ["Food & Drink"] });
  await tom.client("PATCH", "/api/me/profile", { zip: "23220", publicPage: true });
  const fay = await makeCreator(admin, { name: "Five Fay", email: "fay@fixtures.dev", handle: "fivefay", followers: 1800, localPct: 65, categories: ["Fitness & Wellness"] });
  await fay.client("PATCH", "/api/me/profile", { zip: "23221", publicPage: true });
  const fred = await makeCreator(admin, { name: "Far Fred", email: "fred@fixtures.dev", handle: "farfred", followers: 5200, localPct: 60, categories: ["Food & Drink"] });
  await fred.client("PATCH", "/api/me/profile", { zip: "23060", publicPage: true });
  const ned = await makeCreator(admin, { name: "Name Ned", email: "ned@fixtures.dev", handle: "namened", followers: 900, localPct: 74, categories: ["Food & Drink"] });
  await ned.client("PATCH", "/api/me/profile", { zip: "23060", neighborhood: "Downtown", publicPage: true });
  const ola = await makeCreator(admin, { name: "Out Ola", email: "ola@fixtures.dev", handle: "outola", followers: 2600, localPct: 91, categories: ["Food & Drink"] });
  await ola.client("PATCH", "/api/me/profile", { zip: "23219", proximityOptOut: true, publicPage: true });
  const hana = await makeCreator(admin, { name: "Hidden Hana", email: "hana@fixtures.dev", handle: "hiddenhana", followers: 4100, localPct: 99, categories: ["Food & Drink"] });
  await hana.client("PATCH", "/api/me/profile", { zip: "23219" });

  // Charter stamps land pre-launch (the /me/founding read stamps them).
  for (const c of [nina, tom, fay, fred, ned, ola, hana]) await c.client("GET", "/api/me/founding");

  // ZIP validation: a malformed ZIP is refused, a street address is refused.
  const badZip = await nina.client("PATCH", "/api/me/profile", { zip: "123 Main St" });
  check("proximity: a street address is refused as a ZIP (ZIP only, never an address)", badZip.status === 400, JSON.stringify(badZip.data).slice(0, 160));
  const shortZip = await nina.client("PATCH", "/api/me/profile", { zip: "2321" });
  check("proximity: a 4 digit ZIP is refused", shortZip.status === 400, JSON.stringify(shortZip.data).slice(0, 160));

  // ---------- proximity on the founding roster preview ----------
  const biz = await makeBusiness(admin, { businessName: "Bowl Bistro", email: "bowl@fixtures.dev", category: "Restaurant", planId: "growth" });
  const before = await biz.client("GET", "/api/me/roster-preview");
  check("proximity: founding business preview answers before a ZIP is on file (hasZip false; name-matched Same neighborhood may band, distance bands cannot)",
    before.status === 200 && before.data.proximity && before.data.proximity.hasZip === false && (before.data.proximity.bands || []).every((b) => b.band === "Same neighborhood"),
    JSON.stringify(before.data).slice(0, 240));
  const zipSave = await biz.client("PATCH", "/api/me/profile", { zip: "23219" });
  check("proximity: the business ZIP saves through the profile PATCH", zipSave.status === 200 && zipSave.data.user.business.zip === "23219", JSON.stringify(zipSave.data).slice(0, 200));
  const preview = await biz.client("GET", "/api/me/roster-preview");
  const bands = (preview.data.proximity && preview.data.proximity.bands) || [];
  check("proximity: bands render in order (Same neighborhood, Under 2 miles, Under 5 miles)",
    JSON.stringify(bands.map((b) => b.band)) === JSON.stringify(["Same neighborhood", "Under 2 miles", "Under 5 miles"]),
    JSON.stringify(bands).slice(0, 300));
  check("proximity: band categories are presence only (Same neighborhood covers Food & Drink; Under 5 miles covers Fitness & Wellness)",
    bands.length === 3 && bands[0].categories.includes("Food & Drink") && JSON.stringify(bands[2].categories) === JSON.stringify(["Fitness & Wellness"]),
    JSON.stringify(bands).slice(0, 300));
  check("proximity: no band object carries any count field (keys are exactly band + categories)",
    bands.every((b) => JSON.stringify(Object.keys(b).sort()) === JSON.stringify(["band", "categories"])),
    JSON.stringify(bands).slice(0, 300));

  // ---------- book-me page tiers (pre-launch) ----------
  const pubAnon = await anon("GET", "/api/c/nearnina");
  const pa = pubAnon.data.profile || {};
  check("book-me tier 0: the opted-in page resolves for the public", pubAnon.status === 200, JSON.stringify(pubAnon.data).slice(0, 200));
  check("book-me tier 0: showcase carries handle, Charter seal, local %, categories, featured posts, theme",
    pa.handle === "nearnina" && pa.charter === true && pa.localAudiencePct === 88 && (pa.categories || []).includes("Food & Drink") && (pa.featuredPosts || []).length === 1 && typeof pa.pageTheme === "string",
    JSON.stringify(pa).slice(0, 300));
  check("book-me tier 0: NO rate, NO follower counts, NO audience stack, NO social links, NO profile URLs",
    !("paidRate" in pa) && !("followerCount" in pa) && !("totalAudience" in pa) && !("audienceStack" in pa) && !("socialLinks" in pa) && !("primaryProfileUrl" in pa) && !("instagramUrl" in pa),
    JSON.stringify(Object.keys(pa)));
  const pubHidden = await anon("GET", "/api/c/hiddenhana");
  check("book-me: a complete, approved creator who did not opt in gets no page (404, same as unknown)",
    pubHidden.status === 404, JSON.stringify(pubHidden.data).slice(0, 120));
  const pubBiz = await biz.client("GET", "/api/c/nearnina");
  const pb = pubBiz.data.profile || {};
  check("book-me tier 1: a signed-in founding business sees the listed rate and can book, but no socials and no message",
    pubBiz.status === 200 && pb.viewerTier === 1 && pb.paidRate === 150 && pb.canBook === true && !("socialLinks" in pb) && !pb.canMessage,
    JSON.stringify(pb).slice(0, 300));
  const pubOwner = await nina.client("GET", "/api/c/nearnina");
  check("book-me: the owner sees their own page flagged as owner (no booking CTA on their own page)",
    pubOwner.status === 200 && pubOwner.data.profile.viewerIsOwner === true && pubOwner.data.profile.canBook === false,
    JSON.stringify(pubOwner.data).slice(0, 200));
  const pubCreator = await tom.client("GET", "/api/c/nearnina");
  check("book-me: a signed-in creator viewing someone else's page gets the showcase tier (no rate, no CTA)",
    pubCreator.status === 200 && pubCreator.data.profile.viewerTier === 0 && !("paidRate" in pubCreator.data.profile),
    JSON.stringify(pubCreator.data).slice(0, 200));

  // ---------- the Local List endpoint ----------
  const ll = await anon.raw("GET", "/api/public/local-list?market=Richmond", null, { Origin: "https://joinsignl.com" });
  const llBody = JSON.stringify(ll.data);
  check("local list: endpoint answers 200 with the joinsignl.com CORS origin",
    ll.status === 200 && ll.headers.get("access-control-allow-origin") === "https://joinsignl.com",
    `${ll.status} ${ll.headers.get("access-control-allow-origin")}`);
  const llCats = (ll.data && ll.data.categories) || [];
  const llFood = llCats.find((c) => c.name === "Food & Drink") || { creators: [] };
  const llHandles = llFood.creators.map((c) => c.handle);
  check("local list: opt-in creators are listed grouped by category (incl. the proximity opt-out: that toggle is about banding, not the list)",
    llHandles.includes("nearnina") && llHandles.includes("twotom") && llHandles.includes("outola") && llHandles.includes("namened"),
    JSON.stringify(llHandles));
  check("local list: a creator who did not opt in is NOT listed",
    !llHandles.includes("hiddenhana"), JSON.stringify(llHandles));
  check("local list: entries carry handle, local %, categories, Charter flag, and NO follower counts anywhere in the payload",
    llFood.creators.every((c) => typeof c.handle === "string" && "localAudiencePct" in c && Array.isArray(c.categories) && typeof c.charter === "boolean") && !llBody.includes("followerCount") && !llBody.includes('"count"') && !llBody.includes('"total"'),
    llBody.slice(0, 300));
  const ninaEntry = llFood.creators.find((c) => c.handle === "nearnina") || {};
  check("local list: the Charter flag rides the entry", ninaEntry.charter === true, JSON.stringify(ninaEntry));

  // ---------- activation + live market: Discover bands, early access, tier 2 ----------
  await admin("POST", "/api/admin/review", { userId: biz.id, decision: "approve" });
  const act = await admin("POST", "/api/admin/businesses/activate", { userId: biz.id });
  check("setup: admin activates the business", act.status === 200 && act.data.user.business.accessState === "active", JSON.stringify(act.data).slice(0, 200));
  const toggle = await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });
  check("setup: Richmond flips live", toggle.status === 200 && toggle.data.live === true, JSON.stringify(toggle.data).slice(0, 120));

  const preWebhook = await biz.client("GET", "/api/c/nearnina");
  check("book-me tier 1 again: an ACTIVE business without a paid subscription is still tier 1 (activation alone does not unlock socials)",
    preWebhook.data.profile.viewerTier === 1 && !("socialLinks" in preWebhook.data.profile),
    JSON.stringify(preWebhook.data.profile).slice(0, 200));

  const disc = await biz.client("GET", "/api/discover");
  const cards = (disc.data && disc.data.creators) || [];
  const bandOf = (id) => { const c = cards.find((x) => x.userId === id); return c ? c.distanceBand : "MISSING"; };
  check("proximity: Discover bands are right per creator (same ZIP, 1.5mi, 3.1mi, far, name match, opt-out)",
    bandOf(nina.id) === "Same neighborhood" && bandOf(tom.id) === "Under 2 miles" && bandOf(fay.id) === "Under 5 miles" && bandOf(fred.id) === null && bandOf(ned.id) === "Same neighborhood" && bandOf(ola.id) === null,
    JSON.stringify(cards.map((c) => [c.profile && c.profile.handle, c.distanceBand])));
  const ninaCard = cards.find((x) => x.userId === nina.id) || { profile: {} };
  check("proximity: no creator ZIP rides any Discover card (the band is a label, never a location)",
    !("zip" in (ninaCard.profile || {})) && !JSON.stringify(disc.data).includes('"zip"'),
    JSON.stringify(ninaCard.profile).slice(0, 200));

  // Early access: a fresh open offer.
  const offerRes = await biz.client("POST", "/api/offers", { title: "Fresh Tacos Night", whatComped: "Dinner for two on us", includes: "Dinner for two", spots: 2, dollarCap: 100, covers: 2 });
  check("early access setup: the business publishes an open offer in the live market", offerRes.status === 201 && offerRes.data.offer.status === "open", JSON.stringify(offerRes.data).slice(0, 200));
  const freshId = offerRes.data.offer.id;
  const ninaOffers = await nina.client("GET", "/api/offers");
  check("early access: the Charter creator sees the fresh offer in /offers immediately",
    (ninaOffers.data.offers || []).some((o) => o.id === freshId), JSON.stringify(ninaOffers.data).slice(0, 200));
  const ninaBoard = await nina.client("GET", "/api/open-offers");
  check("early access: the Charter creator sees the fresh offer on the board immediately",
    (ninaBoard.data.offers || []).some((o) => o.id === freshId), "");

  const lara = await makeCreator(admin, { name: "Late Lara", email: "lara31@fixtures.dev", handle: "latelara31", followers: 3200, localPct: 77, categories: ["Food & Drink"] });
  const laraFounding = await lara.client("GET", "/api/me/founding");
  check("early access setup: a creator who finishes after launch holds no Charter seal",
    laraFounding.status === 200 && laraFounding.data.buzz && laraFounding.data.buzz.charter === null,
    JSON.stringify(laraFounding.data && laraFounding.data.buzz).slice(0, 200));
  const laraOffers = await lara.client("GET", "/api/offers");
  check("early access: the non-Charter creator does NOT see the fresh offer in /offers",
    !(laraOffers.data.offers || []).some((o) => o.id === freshId), "");
  const laraBoard = await lara.client("GET", "/api/open-offers");
  check("early access: the non-Charter creator does NOT see the fresh offer on the board",
    !(laraBoard.data.offers || []).some((o) => o.id === freshId), "");
  const laraApply = await lara.client("POST", `/api/offers/${freshId}/apply`, {});
  check("early access: applying inside the window answers like the offer is not there (404)",
    laraApply.status === 404, JSON.stringify(laraApply.data).slice(0, 160));

  // Tier 2: paid subscription lands by signed webhook.
  const evt = { id: "evt_build31", type: "customer.subscription.created", data: { object: { id: "sub_build31", customer: "cus_build31", status: "active", current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, metadata: { businessId: biz.id }, items: { data: [{ price: { id: "price_1USRLcJ5DCULBlmAajXPmJjr" } }] } } } };
  const raw = JSON.stringify(evt);
  const wh = await anon.raw("POST", "/api/stripe/webhook", raw, { "Content-Type": "application/json", "stripe-signature": signWebhook(raw) });
  check("tier 2 setup: the signed subscription webhook lands (200)", wh.status === 200, JSON.stringify(wh.data).slice(0, 160));
  const pubPaid = await biz.client("GET", "/api/c/nearnina");
  const pp = pubPaid.data.profile || {};
  check("book-me tier 2: a paid, active business sees social channel links and can message",
    pp.viewerTier === 2 && Array.isArray(pp.socialLinks) && pp.socialLinks.some((s) => s.platform === "instagram" && s.url === "https://instagram.com/nearnina") && pp.canMessage === true,
    JSON.stringify(pp).slice(0, 300));
  const msgAnon = await anon.raw("POST", "/api/c/nearnina/message", JSON.stringify({ body: "hi" }), { "Content-Type": "application/json" });
  check("book-me messaging: logged out cannot message (401)", msgAnon.status === 401, String(msgAnon.status));
  const biz2 = await makeBusiness(admin, { businessName: "Tier One Tacos", email: "t1@fixtures.dev", category: "Restaurant", planId: "self-service" });
  const msgTier1 = await biz2.client("POST", "/api/c/nearnina/message", { body: "hello" });
  check("book-me messaging: a founding (unpaid) business cannot message from the page (403)", msgTier1.status === 403, JSON.stringify(msgTier1.data).slice(0, 160));
  const msg = await biz.client("POST", "/api/c/nearnina/message", { body: "Hello Nina, we would love to host you at Bowl Bistro." });
  check("book-me messaging: the paid business starts the thread (201)", msg.status === 201 && !!(msg.data.message && msg.data.message.id), JSON.stringify(msg.data).slice(0, 200));
  const convo = await nina.client("GET", `/api/messages?with=${biz.id}`);
  const msgs = (convo.data && convo.data.messages) || [];
  check("book-me messaging: the thread opens with the system non-circumvention line, then the business's message",
    msgs.length >= 2 && msgs[0].system === true && msgs[0].body === THREAD_LINE && msgs[1].body === "Hello Nina, we would love to host you at Bowl Bistro.",
    JSON.stringify(msgs).slice(0, 300));
  const threads = await nina.client("GET", "/api/messages");
  check("book-me messaging: the thread lists under the business, and no phantom system thread exists",
    (threads.data.threads || []).some((t) => t.otherId === biz.id) && !(threads.data.threads || []).some((t) => t.otherId === "system"),
    JSON.stringify(threads.data).slice(0, 200));
  await nina.client("PATCH", "/api/me/profile", { showSocials: false });
  const pubHidden2 = await biz.client("GET", "/api/c/nearnina");
  check("book-me tier 2: the creator's socials toggle OFF hides the channel links even from a paid business",
    pubHidden2.data.profile.viewerTier === 2 && Array.isArray(pubHidden2.data.profile.socialLinks) && pubHidden2.data.profile.socialLinks.length === 0 && pubHidden2.data.profile.socialsHiddenByCreator === true,
    JSON.stringify(pubHidden2.data.profile).slice(0, 240));

  // ---------- aged offer: the window passes ----------
  await stopServer();
  const dbJson = JSON.parse(fs.readFileSync(DB, "utf8"));
  const offerKey = Object.keys(dbJson).find((k) => k.startsWith("offer:") && dbJson[k] && dbJson[k].id === freshId);
  check("early access setup: the fresh offer is in the store to age", !!offerKey, Object.keys(dbJson).filter((k) => k.startsWith("offer:")).join(","));
  const aged = { ...dbJson[offerKey], id: "aged-offer-build31", title: "Aged Brunch Offer", createdAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), publishedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), updatedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() };
  dbJson["offer:aged-offer-build31"] = aged;
  fs.writeFileSync(DB, JSON.stringify(dbJson));
  startServer();
  check("dev server reboots on the aged store", await waitUp());
  const admin2 = client();
  await admin2("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const lara2 = client();
  await lara2("POST", "/api/auth/login", { email: "lara31@fixtures.dev", password: "creator-pass-123" });
  const laraBoard2 = await lara2("GET", "/api/open-offers");
  check("early access: after 24 hours the non-Charter creator sees the offer on the board",
    (laraBoard2.data.offers || []).some((o) => o.id === "aged-offer-build31"),
    JSON.stringify((laraBoard2.data.offers || []).map((o) => o.id)));
  const laraApply2 = await lara2("POST", "/api/offers/aged-offer-build31/apply", {});
  check("early access: after 24 hours the non-Charter creator can apply (201)",
    laraApply2.status === 201, JSON.stringify(laraApply2.data).slice(0, 200));
  await stopServer();

  // ---------- source pins: client, Sig canon, server ----------
  const appJs = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(ROOT, "netlify", "functions", "lib", "router.js"), "utf8");
  const sigaiJs = fs.readFileSync(path.join(ROOT, "netlify", "functions", "lib", "sigai.js"), "utf8");
  const bpStart = appJs.indexOf("async function renderPublicProfile");
  const bpEnd = appJs.indexOf("async function renderPublicProof", bpStart);
  const bpSlice = bpStart > -1 && bpEnd > bpStart ? appJs.slice(bpStart, bpEnd) : "";
  check("book-me source: the page render exists and carries NO mailto, NO tel, NO handle link-out helper",
    bpSlice.length > 1000 && !bpSlice.includes("mailto:") && !bpSlice.includes("tel:") && !bpSlice.includes("ccHandleHtml"),
    `slice ${bpSlice.length}`);
  check("book-me source: the sign-in gate line ships in the render; the guarantee and stays-on-SIGNL lines ship as the page's constants and are used by it",
    bpSlice.includes("Businesses: sign in to see rates and book.") && bpSlice.includes("BOOKME_GUARANTEE_LINE") && bpSlice.includes("BOOKME_STAYS_LINE") && appJs.includes("Bookings through SIGNL carry the Visit Guarantee and payment protection") && appJs.includes('BOOKME_STAYS_LINE = "Bookings that start on SIGNL stay on SIGNL."'),
    "");
  check("book-me source: the locked unlock panel line ships verbatim",
    appJs.includes("Paying businesses see this creator's social channels and can message them here."), "");
  check("book-me source: the opt-in disclosure ships on the creator's own settings panel",
    appJs.includes("Businesses with a paid SIGNL account can see your social channels and message you here."), "");
  check("charter sell: the 24h perk line ships on the Charter card AND the Status tab (at least two placements)",
    (appJs.split(CHARTER_LINE).length - 1) >= 2, `count ${appJs.split(CHARTER_LINE).length - 1}`);
  check("charter sell: Sig's server canon states the 24h perk and the stays-on-SIGNL rule",
    sigaiJs.includes("see new open offers 24 hours before everyone else") && sigaiJs.includes("Bookings that start on SIGNL stay on SIGNL"), "");
  check("scarcity: the founding scarcity sentence ships on the app founding page",
    appJs.includes(SCARCITY_LINE), "");
  const fmStart = appJs.indexOf("function foundingFirstMonthHtml");
  const fmEnd = appJs.indexOf("function foundingBenefitsHtml", fmStart);
  const fmSlice = fmStart > -1 && fmEnd > fmStart ? appJs.slice(fmStart, fmEnd) : "";
  check("first month plan: five slots, Week 1..4 labels, the preview label, and the Visit Guarantee line all ship",
    (fmSlice.match(/\{ week:/g) || []).length === 5 && fmSlice.includes('"Week 1"') && fmSlice.includes('"Week 4"') && fmSlice.includes("Your first month, planned. Nothing is saved, nothing is booked.") && fmSlice.includes("Visit Guarantee"),
    `slice ${fmSlice.length}`);
  check("proximity client: the Near your door section and the band grouping ship",
    appJs.includes("foundingNearYouHtml") && appJs.includes("discoverListHtml") && appJs.includes("Under 2 miles") && appJs.includes("Same neighborhood"), "");
  check("reminders: the booking-started line ships in the composer AND the creator accept step",
    (appJs.split(BOOKING_LINE).length - 1) >= 1 && appJs.includes("${BOOKING_STARTED_LINE}") && (appJs.match(/BOOKING_STARTED_LINE/g) || []).length >= 3,
    `refs ${(appJs.match(/BOOKING_STARTED_LINE/g) || []).length}`);
  check("lockstep: the signup phrase ships in all three acceptance checkboxes (quick claim, creator join, business join)",
    (appJs.split("keeping bookings that start on SIGNL on SIGNL").length - 1) >= 3,
    `count ${appJs.split("keeping bookings that start on SIGNL on SIGNL").length - 1}`);
  check("forbidden phrase: the false Momentum line stays absent from client, server, and Sig canon",
    !/see paid campaigns first/i.test(appJs) && !/see paid campaigns first/i.test(routerJs) && !/see paid campaigns first/i.test(sigaiJs), "");
  check("no em dashes in the new copy constants (charter, scarcity, book-me, booking lines)",
    ![CHARTER_LINE, SCARCITY_LINE, BOOKING_LINE, THREAD_LINE].some((s) => s.includes("—")), "");

  // ---------- source pins: the site ----------
  const readSite = (f) => { try { return fs.readFileSync(path.join(SITE, f), "utf8"); } catch (e) { return ""; } };
  const terms = readSite("terms.html");
  const clauseAt = terms.indexOf("Bookings that start on SIGNL stay on SIGNL");
  const clauseEnd = terms.indexOf("<h3>", clauseAt + 10);
  const clause = clauseAt > -1 ? terms.slice(clauseAt, clauseEnd > -1 ? clauseEnd : clauseAt + 1200) : "";
  check("terms: the non-circumvention clause ships with the 12 month window and the off-platform fee rule, in plain words",
    clause.includes("12 months") && clause.includes("neither side may arrange the same work off the platform to avoid SIGNL's fees") && clause.includes("businesses and creators equally"),
    clause.slice(0, 200));
  check("terms: the clause carries no em dash", clause.length > 100 && !clause.includes("—"), "");
  check("site scarcity: the sentence ships on businesses.html and pricing.html",
    readSite("businesses.html").includes(SCARCITY_LINE) && readSite("pricing.html").includes(SCARCITY_LINE), "");
  check("site charter sell: creators.html carries the 24h perk in body copy",
    readSite("creators.html").includes("see new paid offers 24 hours before everyone else"), "");
  const countPattern = /\b\d+\s+(creators|founding creators|spots|members)\b/i;
  for (const f of ["local-list.html", "local-list-virginia-beach.html", "local-list-nashville.html", "local-list-miami.html", "local-list-denver.html"]) {
    const html = readSite(f);
    check(`local list page ${f}: exists, no count patterns, no em dashes`,
      html.length > 2000 && !countPattern.test(html) && !html.includes("—"), `len ${html.length}`);
  }
  for (const f of ["local-list-virginia-beach.html", "local-list-nashville.html", "local-list-miami.html", "local-list-denver.html"]) {
    const html = readSite(f);
    check(`local list page ${f}: business tie-in, creator tie-in, and the live endpoint wiring ship`,
      html.includes("Want these creators posting for your business?") && html.includes("Join the founding class") && html.includes("api/public/local-list") && html.includes('data-market="'),
      "");
  }
  check("local list index links all four market lists",
    ["local-list-virginia-beach.html", "local-list-nashville.html", "local-list-miami.html", "local-list-denver.html"].every((f) => readSite("local-list.html").includes(f)), "");
} catch (e) {
  failed += 1;
  failures.push("suite crashed: " + (e && e.message));
  console.error(e);
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`\nverify-build31: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
