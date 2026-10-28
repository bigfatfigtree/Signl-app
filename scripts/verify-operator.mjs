// SIGNL verify: Sig Operator server layers (Jeff, 2026-10-28).
//
// Brief Builder + Asset Packet + Performance Clarity, server side:
//   - brief normalization: caps (hook 140, list items 80 x3,
//     timing 140, callToAction 120), trim/drop/dedupe, goal enum,
//     and the deliverable SERVER-FORCED per kind (input can never
//     override it);
//   - brief seeding: an empty hook / mustMention / timing falls
//     back to the offer's experience / includes / visitWindow, so
//     a composer brief with a blank brief section and a legacy
//     offer with no brief derive the identical brief, byte for
//     byte, on both create paths and on PATCH replacement;
//   - legacy derivation via briefForOffer (goal null, hook from
//     experience, mustMention from includes, timing from window);
//   - asset packet: HTTPS-only URLs (http logo AND http link both
//     refused, 400), the 6-link cap refused, handle stored without
//     @, hashtags stored as tokens without #, link labels derived
//     from the hostname, and assetPacketView null when empty;
//   - offer wiring: brief + assetPacketAttached stored on every
//     create (paid defaults attached, comp defaults not, explicit
//     flag wins), PATCH replacement, creator-facing reads carrying
//     businessAssetPacket only when attached, booking snapshots
//     (brief always, packet when attached), and POST
//     /bookings/paid deriving its brief from the paidBrief text;
//   - performance readout math on seeded records: per-offer and
//     overall aggregates, the day 7/14/30 snapshot series (incl. a
//     day-14 snapshot case), license counts, the deterministic
//     repeat pick landing on the seeded best item, creator
//     recorded paid net (no estimates), and the founding
//     business's honest empty readout.
//
// Uses scripts/dev-server.mjs with a throwaway local DB file and
// SIGNL_TEST_ALLOW_BUSINESS=1, like the other suites. Production
// is never touched.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require2 = createRequire(import.meta.url);
const R = require2("../netlify/functions/lib/router.js");

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8953;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "test-admin-password-123";
const DAY = 24 * 3600 * 1000;

let passed = 0;
const failures = [];
function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`PASS  ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label} ${detail}`); }
}
const uniq = () => Math.random().toString(36).slice(2, 9);

const COMP_DELIVERABLE = "1 post + 1 story that shares the post. Post within 48 hours; one week is the hard deadline.";
const PAID_DELIVERABLE = "Deliverables are set in the booking terms. Post within 48 hours and keep the post live at least 30 days.";

function makeClient() {
  const jar = new Map();
  const api = async function (method, p, body) {
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
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data, text };
  };
  return api;
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up");
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-operator-"));
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
function editDb(fn) {
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  fn(db);
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
}

try {
  // ---------- unit: brief normalization ----------
  const capped = R.normalizeBriefInput({
    goal: "fill_an_event",
    hook: "h".repeat(200),
    mustMention: ["  Alpha  ", "Alpha", "", "B".repeat(100), "Gamma", "Delta"],
    doNotSay: ["nope", "nope", "also no"],
    deliverable: "SEND WHATEVER YOU WANT",
    timing: "t".repeat(200),
    callToAction: "c".repeat(200),
  }, "comp");
  check("brief caps: hook truncates to 140, timing to 140, callToAction to 120",
    capped.hook.length === 140 && capped.timing.length === 140 && capped.callToAction.length === 120,
    JSON.stringify({ hook: capped.hook.length, timing: capped.timing.length, cta: capped.callToAction.length }));
  check("brief lists: trimmed, empties dropped, deduped, items capped at 80, max 3",
    JSON.stringify(capped.mustMention) === JSON.stringify(["Alpha", "B".repeat(80), "Gamma"]) && JSON.stringify(capped.doNotSay) === JSON.stringify(["nope", "also no"]),
    JSON.stringify(capped.mustMention));
  check("brief deliverable is server-forced for comp, never taken from input",
    capped.deliverable === COMP_DELIVERABLE && capped.goal === "fill_an_event", capped.deliverable);
  const paidBriefNorm = R.normalizeBriefInput({ goal: "bogus_goal", deliverable: "x" }, "paid");
  check("brief deliverable is server-forced for paid; an unknown goal reads null",
    paidBriefNorm.deliverable === PAID_DELIVERABLE && paidBriefNorm.goal === null, JSON.stringify(paidBriefNorm));

  // ---------- unit: brief seeding (the composer clarification) ----------
  const seed = { hook: "Sunset tasting on the patio", mustMention: ["Two entrees and two drinks"], timing: "Before 11am" };
  const blankBrief = R.normalizeBriefInput({ hook: "", mustMention: [], timing: "", goal: null, doNotSay: [], callToAction: "" }, "comp", seed);
  const absentBrief = R.normalizeBriefInput(null, "comp", seed);
  check("brief seeding: empty hook/mustMention/timing fall back to the seed",
    blankBrief.hook === seed.hook && JSON.stringify(blankBrief.mustMention) === JSON.stringify(seed.mustMention) && blankBrief.timing === seed.timing,
    JSON.stringify(blankBrief));
  check("brief seeding: a blank brief section and an absent brief derive byte-identical briefs",
    JSON.stringify(blankBrief) === JSON.stringify(absentBrief), `${JSON.stringify(blankBrief)} vs ${JSON.stringify(absentBrief)}`);
  const filledBrief = R.normalizeBriefInput({ hook: "Real hook", mustMention: ["Real point"], timing: "Real timing" }, "comp", seed);
  check("brief seeding: filled fields win over the seed",
    filledBrief.hook === "Real hook" && filledBrief.mustMention[0] === "Real point" && filledBrief.timing === "Real timing", JSON.stringify(filledBrief));

  // ---------- unit: legacy derivation ----------
  const legacyOffer = { kind: "comp", experience: "Sunset tasting on the patio", includes: "Two entrees and two drinks", visitWindow: "Before 11am" };
  const derived = R.briefForOffer(legacyOffer);
  check("legacy brief derivation: goal null, hook from experience, mustMention from includes, timing from visitWindow, empty callToAction",
    derived.goal === null && derived.hook === "Sunset tasting on the patio" && JSON.stringify(derived.mustMention) === JSON.stringify(["Two entrees and two drinks"]) && derived.timing === "Before 11am" && derived.callToAction === "" && derived.deliverable === COMP_DELIVERABLE,
    JSON.stringify(derived));
  const storedBlank = R.briefForOffer({ ...legacyOffer, brief: { hook: "", mustMention: [], timing: "" } });
  check("legacy derivation: a stored blank brief derives the identical brief as no brief at all",
    JSON.stringify(storedBlank) === JSON.stringify(derived), JSON.stringify(storedBlank));

  // ---------- unit: asset packet validation + view ----------
  const httpLogo = R.validateAssetPacket({ logoUrl: "http://example.com/logo.png" }, null);
  check("asset packet: an http logo URL is refused with a clear HTTPS error",
    httpLogo.ok === false && /HTTPS/.test(httpLogo.error || ""), JSON.stringify(httpLogo));
  const httpLink = R.validateAssetPacket({ links: [{ label: "Menu", url: "http://example.com/menu" }] }, null);
  check("asset packet: an http link URL is refused with a clear HTTPS error",
    httpLink.ok === false && /HTTPS/.test(httpLink.error || ""), JSON.stringify(httpLink));
  const junkLink = R.validateAssetPacket({ links: [{ label: "Menu", url: "not a url" }] }, null);
  check("asset packet: a non-URL link is refused", junkLink.ok === false, JSON.stringify(junkLink));
  const sevenLinks = R.validateAssetPacket({ links: Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, url: `https://example.com/${i}` })) }, null);
  check("asset packet: 7 links are refused (the cap is 6)", sevenLinks.ok === false && /6/.test(sevenLinks.error || ""), JSON.stringify(sevenLinks));
  const goodPacket = R.validateAssetPacket({
    logoUrl: "https://cdn.example.com/logo.png",
    links: [{ label: "Menu", url: "https://example.com/menu" }, { url: "https://www.example.com/reservations" }],
    talkingPoints: "Family owned since 1998.",
    handle: "@operatorkitchen",
    hashtags: "#brunch, #localfood 757eats",
  }, null);
  check("asset packet: a valid packet normalizes (handle without @, hashtags as tokens without #, label derived from hostname)",
    goodPacket.ok === true && goodPacket.packet.handle === "operatorkitchen" &&
    JSON.stringify(goodPacket.packet.hashtags) === JSON.stringify(["brunch", "localfood", "757eats"]) &&
    goodPacket.packet.links[1].label === "example.com" && goodPacket.packet.logoUrl === "https://cdn.example.com/logo.png",
    JSON.stringify(goodPacket));
  const hashArray = R.validateAssetPacket({ hashtags: ["#one", "two", "#one", "three", "four", "five", "six", "seven"] }, null);
  check("asset packet: hashtags accept an array, dedupe, and cap at 6 tokens",
    hashArray.ok === true && JSON.stringify(hashArray.packet.hashtags) === JSON.stringify(["one", "two", "three", "four", "five", "six"]), JSON.stringify(hashArray.packet && hashArray.packet.hashtags));
  check("asset packet view: null when empty (no record, empty packet, business with no packet)",
    R.assetPacketView(null) === null && R.assetPacketView({}) === null && R.assetPacketView({ assetPacket: {} }) === null && R.assetPacketView({ business: {} }) === null, "");
  check("asset packet view: a stored http logo is dropped defensively and the packet reads empty, never throws",
    R.assetPacketView({ assetPacket: { logoUrl: "http://bad.example/x.png", links: "junk", hashtags: 42 } }) === null, "");
  check("asset packet view: reads through a user record, a business record, or the packet itself",
    (R.assetPacketView({ business: { assetPacket: { handle: "viabiz" } } }) || {}).handle === "viabiz" &&
    (R.assetPacketView({ assetPacket: { handle: "direct" } }) || {}).handle === "direct" &&
    (R.assetPacketView({ handle: "rawpacket" }) || {}).handle === "rawpacket", "");

  // ---------- unit: post series ----------
  const base = Date.parse("2026-10-01T12:00:00.000Z");
  const seriesPost = {
    submittedAt: new Date(base).toISOString(),
    reportedAt: new Date(base).toISOString(),
    views: 1000, likes: 100,
    snapshots: [
      { at: new Date(base).toISOString(), views: 600, likes: 60 },
      { at: new Date(base + 10 * DAY).toISOString(), views: 1000, likes: 100 },
    ],
  };
  const s = R.postSeries(seriesPost);
  check("postSeries: day7 takes the last snapshot at or before day 7, day14 the day-10 snapshot, day30 carries it",
    s.day7 === 600 && s.day14 === 1000 && s.day30 === 1000, JSON.stringify(s));
  const sNone = R.postSeries({ submittedAt: new Date(base).toISOString(), views: 10 });
  check("postSeries: no snapshots reads all null, never zero-filled",
    sNone.day7 === null && sNone.day14 === null && sNone.day30 === null, JSON.stringify(sNone));
  // postBase is the performance firstAt (the first snapshot's
  // time): here a views-less snapshot at day 0 sets the base, and
  // the first snapshot WITH views lands at day 20, so it can only
  // qualify for the day-30 mark.
  const sLate = R.postSeries({ submittedAt: new Date(base).toISOString(), reportedAt: new Date(base).toISOString(), snapshots: [{ at: new Date(base).toISOString(), views: null, likes: 3 }, { at: new Date(base + 20 * DAY).toISOString(), views: 42 }] });
  check("postSeries: a first views snapshot at day 20 (base = first snapshot at day 0) qualifies only for day 30",
    sLate.day7 === null && sLate.day14 === null && sLate.day30 === 42, JSON.stringify(sLate));

  // ---------- unit: Sig canon ----------
  const sigaiText = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");
  check("Sig canon: Sig can do the doing with confirmation, and the old cannot-act bullet is gone",
    sigaiText.includes("You can also do the doing, right in this chat") && sigaiText.includes("You never act without that confirmation") && !sigaiText.includes("You cannot take actions, book, pay, or change anything"), "");

  // ---------- HTTP fixtures ----------
  startServer();
  await waitUp();
  const admin = makeClient();
  const loginRes = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginRes.status !== 200) throw new Error(`admin login failed: ${loginRes.status}`);

  async function registerCreator(handle) {
    const client = makeClient();
    const r = await client("POST", "/api/auth/register", {
      role: "creator", name: `Operator Creator ${handle}`, email: `${handle}@fixtures.dev`, password: "password123",
      market: "Hampton Roads", city: "Norfolk", handle,
      categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
      followerCount: 5000, avgViews: 900, localAudiencePct: 62, bio: "",
      agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
    });
    if (r.status !== 201 || !r.data.user) throw new Error(`creator register failed: ${r.status} ${JSON.stringify(r.data)}`);
    return { client, user: r.data.user, email: `${handle}@fixtures.dev` };
  }
  async function registerBusiness(planId, businessName) {
    const client = makeClient();
    const email = `biz-${uniq()}@fixtures.dev`;
    const r = await client("POST", "/api/auth/register", {
      role: "business", name: "Biz Owner", email, password: "password123",
      market: "Hampton Roads", city: "Norfolk", businessName, category: "Restaurant", planId, agreedTerms: true,
    });
    if (r.status !== 201 || !r.data.user) throw new Error(`business register failed: ${r.status} ${JSON.stringify(r.data)}`);
    return { client, user: r.data.user, email };
  }
  async function approve(userId) {
    const r = await admin("POST", "/api/admin/review", { userId, decision: "approve" });
    if (r.status !== 200) throw new Error(`approve failed: ${r.status} ${JSON.stringify(r.data)}`);
  }
  async function activate(userId) {
    const r = await admin("POST", "/api/admin/businesses/activate", { userId });
    if (r.status !== 200) throw new Error(`activate failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  const u = uniq();
  const biz = await registerBusiness("growth", "Operator Kitchen");
  const foundingBiz = await registerBusiness("self-service", "Founding Kitchen");
  const c1 = await registerCreator(`opmain${u}`);
  const c2 = await registerCreator(`opsecond${u}`);
  await approve(c1.user.id); await approve(c2.user.id);
  await approve(biz.user.id); await approve(foundingBiz.user.id);
  await activate(biz.user.id);
  // foundingBiz is approved but deliberately NOT activated.

  // ---------- founding business readout ----------
  const foundingReadout = await foundingBiz.client("GET", "/api/me/performance-readout");
  check("founding business readout: HTTP 200, empty + founding, the funnel line, no zero grid",
    foundingReadout.status === 200 && foundingReadout.data.role === "business" && foundingReadout.data.empty === true && foundingReadout.data.founding === true &&
    foundingReadout.data.recommendation && foundingReadout.data.recommendation.type === "next" && foundingReadout.data.recommendation.text === "Your funnel fills in once your campaigns are live." && foundingReadout.data.recommendation.action === "create_offer" &&
    foundingReadout.data.overall === undefined && foundingReadout.data.offers === undefined,
    `${foundingReadout.status} ${JSON.stringify(foundingReadout.data).slice(0, 240)}`);

  // ---------- asset packet over HTTP ----------
  const httpLogoRes = await biz.client("PATCH", "/api/me/profile", { assetPacket: { logoUrl: "http://example.com/logo.png" } });
  check("PATCH /me/profile: an http logo URL is refused 400", httpLogoRes.status === 400 && /HTTPS/.test(httpLogoRes.data.error || ""), `${httpLogoRes.status} ${JSON.stringify(httpLogoRes.data)}`);
  const httpLinkRes = await biz.client("PATCH", "/api/me/profile", { assetPacket: { links: [{ label: "Menu", url: "http://example.com/menu" }] } });
  check("PATCH /me/profile: an http link URL is refused 400", httpLinkRes.status === 400 && /HTTPS/.test(httpLinkRes.data.error || ""), `${httpLinkRes.status} ${JSON.stringify(httpLinkRes.data)}`);
  const sevenRes = await biz.client("PATCH", "/api/me/profile", { assetPacket: { links: Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, url: `https://example.com/${i}` })) } });
  check("PATCH /me/profile: 7 links are refused 400", sevenRes.status === 400, String(sevenRes.status));
  const meAfterRefusals = await biz.client("GET", "/api/auth/me");
  check("refused packet writes stored nothing",
    !(meAfterRefusals.data.user.business.assetPacket && (meAfterRefusals.data.user.business.assetPacket.logoUrl || (meAfterRefusals.data.user.business.assetPacket.links || []).length)),
    JSON.stringify(meAfterRefusals.data.user.business.assetPacket || null));
  const packetPayload = {
    logoUrl: "https://cdn.example.com/logo.png",
    links: [{ label: "Menu", url: "https://example.com/menu" }, { url: "https://www.example.com/reservations" }],
    talkingPoints: "Family owned since 1998.",
    handle: "@operatorkitchen",
    hashtags: "#brunch, #localfood 757eats",
  };
  const packetRes = await biz.client("PATCH", "/api/me/profile", { assetPacket: packetPayload });
  const storedPacket = packetRes.data.user && packetRes.data.user.business ? packetRes.data.user.business.assetPacket : null;
  check("PATCH /me/profile: a valid packet stores normalized on the business record",
    packetRes.status === 200 && !!storedPacket && storedPacket.logoUrl === packetPayload.logoUrl && storedPacket.handle === "operatorkitchen" &&
    JSON.stringify(storedPacket.hashtags) === JSON.stringify(["brunch", "localfood", "757eats"]) && storedPacket.links[1].label === "example.com" && storedPacket.talkingPoints === "Family owned since 1998.",
    `${packetRes.status} ${JSON.stringify(storedPacket)}`);

  // ---------- offers: brief storage + seeding + packet flag ----------
  const briefOfferRes = await biz.client("POST", "/api/offers", {
    title: "Briefed tasting", whatComped: "Dinner for two", dollarCap: 60, spots: 1, creatorId: c1.user.id,
    experience: "Chef counter seats", includes: "Two entrees and drinks",
    brief: { goal: "fill_an_event", hook: "h".repeat(200), mustMention: ["Alpha", "Alpha", "", "Beta", "Gamma", "Delta"], doNotSay: ["nope"], timing: "Weekend", callToAction: "Book now", deliverable: "HACKED" },
  });
  check("POST /offers stores the normalized brief (caps applied, deliverable forced, input deliverable ignored)",
    briefOfferRes.status === 201 && briefOfferRes.data.offer.brief.hook.length === 140 &&
    JSON.stringify(briefOfferRes.data.offer.brief.mustMention) === JSON.stringify(["Alpha", "Beta", "Gamma"]) &&
    briefOfferRes.data.offer.brief.deliverable === COMP_DELIVERABLE && briefOfferRes.data.offer.brief.goal === "fill_an_event",
    `${briefOfferRes.status} ${JSON.stringify(briefOfferRes.data.offer && briefOfferRes.data.offer.brief)}`);
  check("POST /offers: a comp offer defaults assetPacketAttached to false",
    briefOfferRes.data.offer.assetPacketAttached === false, JSON.stringify(briefOfferRes.data.offer.assetPacketAttached));

  const blankOfferRes = await biz.client("POST", "/api/offers", {
    title: "Blank brief tasting", whatComped: "Dinner for two", dollarCap: 60, spots: 1, creatorId: c1.user.id,
    experience: "Sunset tasting on the patio", includes: "Two entrees and two drinks", visitWindow: "Before 11am",
    brief: { hook: "", mustMention: [], timing: "" },
  });
  check("POST /offers: a blank brief section derives from the offer's own fields",
    blankOfferRes.status === 201 && blankOfferRes.data.offer.brief.hook === "Sunset tasting on the patio" &&
    JSON.stringify(blankOfferRes.data.offer.brief.mustMention) === JSON.stringify(["Two entrees and two drinks"]) &&
    blankOfferRes.data.offer.brief.timing === "Before 11am" && blankOfferRes.data.offer.brief.goal === null,
    `${blankOfferRes.status} ${JSON.stringify(blankOfferRes.data.offer && blankOfferRes.data.offer.brief)}`);
  const noBriefOfferRes = await biz.client("POST", "/api/offers", {
    title: "No brief tasting", whatComped: "Dinner for two", dollarCap: 60, spots: 1, creatorId: c2.user.id,
    experience: "Sunset tasting on the patio", includes: "Two entrees and two drinks", visitWindow: "Before 11am",
  });
  check("POST /offers: no brief at all derives the byte-identical brief",
    noBriefOfferRes.status === 201 && JSON.stringify(noBriefOfferRes.data.offer.brief) === JSON.stringify(blankOfferRes.data.offer.brief),
    JSON.stringify(noBriefOfferRes.data.offer && noBriefOfferRes.data.offer.brief));

  const attachedCompRes = await biz.client("POST", "/api/offers", {
    title: "Attached comp tasting", whatComped: "Dinner for two", dollarCap: 60, spots: 1, creatorId: c2.user.id, assetPacketAttached: true,
  });
  check("POST /offers: an explicit assetPacketAttached=true overrides the comp default",
    attachedCompRes.status === 201 && attachedCompRes.data.offer.assetPacketAttached === true, `${attachedCompRes.status}`);
  const plainCompRes = await biz.client("POST", "/api/offers", {
    title: "Plain comp tasting", whatComped: "Dinner for two", dollarCap: 60, spots: 1, creatorId: c2.user.id,
  });
  const paidOfferRes = await biz.client("POST", "/api/offers", {
    title: "Paid operator visit", whatComped: "The Standard Visit, paid", kind: "paid", cashRate: 200, spots: 1, creatorId: c1.user.id,
  });
  check("POST /offers: a paid offer defaults assetPacketAttached to true and forces the paid deliverable",
    paidOfferRes.status === 201 && paidOfferRes.data.offer.assetPacketAttached === true && paidOfferRes.data.offer.brief.deliverable === PAID_DELIVERABLE,
    `${paidOfferRes.status} ${JSON.stringify(paidOfferRes.data.offer && paidOfferRes.data.offer.brief)}`);

  // ---------- offers: PATCH brief + flag ----------
  const patchBriefRes = await biz.client("PATCH", `/api/offers/${blankOfferRes.data.offer.id}`, { brief: { hook: "", mustMention: [], timing: "", callToAction: "Reserve a table" } });
  check("PATCH /offers: a brief replacement seeds empty fields from the stored offer's fields",
    patchBriefRes.status === 200 && patchBriefRes.data.offer.brief.hook === "Sunset tasting on the patio" &&
    JSON.stringify(patchBriefRes.data.offer.brief.mustMention) === JSON.stringify(["Two entrees and two drinks"]) &&
    patchBriefRes.data.offer.brief.timing === "Before 11am" && patchBriefRes.data.offer.brief.callToAction === "Reserve a table",
    `${patchBriefRes.status} ${JSON.stringify(patchBriefRes.data.offer && patchBriefRes.data.offer.brief)}`);
  const patchPaidBriefOnComp = await biz.client("PATCH", `/api/offers/${blankOfferRes.data.offer.id}`, { paidBrief: "script please" });
  check("PATCH /offers: paidBrief is still refused on a comp offer (the brief object is a different field)",
    patchPaidBriefOnComp.status === 400, String(patchPaidBriefOnComp.status));
  const patchFlagRes = await biz.client("PATCH", `/api/offers/${paidOfferRes.data.offer.id}`, { assetPacketAttached: false });
  check("PATCH /offers: assetPacketAttached can be flipped off a paid offer",
    patchFlagRes.status === 200 && patchFlagRes.data.offer.assetPacketAttached === false, `${patchFlagRes.status}`);
  await biz.client("PATCH", `/api/offers/${paidOfferRes.data.offer.id}`, { assetPacketAttached: true });

  // ---------- offers: creator-facing reads ----------
  const bizOffers = await biz.client("GET", "/api/offers");
  check("GET /offers (business): every offer reads with a brief and the business's own packet attached",
    bizOffers.status === 200 && (bizOffers.data.offers || []).length >= 5 && (bizOffers.data.offers || []).every((o) => o.brief && typeof o.brief.deliverable === "string") &&
    (bizOffers.data.offers || []).every((o) => o.businessAssetPacket && o.businessAssetPacket.logoUrl === packetPayload.logoUrl),
    `${bizOffers.status} ${JSON.stringify((bizOffers.data.offers || []).map((o) => !!o.businessAssetPacket))}`);
  const c1Offers = await c1.client("GET", "/api/offers");
  const c1PaidRow = (c1Offers.data.offers || []).find((o) => o.id === paidOfferRes.data.offer.id);
  const c1CompRow = (c1Offers.data.offers || []).find((o) => o.id === briefOfferRes.data.offer.id);
  check("GET /offers (creator): the packet rides only on attached offers (paid default yes, comp default no)",
    !!c1PaidRow && !!c1CompRow && c1PaidRow.businessAssetPacket && c1PaidRow.businessAssetPacket.handle === "operatorkitchen" && c1CompRow.businessAssetPacket === null && !!c1CompRow.brief,
    JSON.stringify({ paid: c1PaidRow && c1PaidRow.businessAssetPacket, comp: c1CompRow && c1CompRow.businessAssetPacket }));
  const c2Offers = await c2.client("GET", "/api/offers");
  const c2AttachedRow = (c2Offers.data.offers || []).find((o) => o.id === attachedCompRes.data.offer.id);
  check("GET /offers (creator): an explicitly attached comp offer carries the packet",
    !!c2AttachedRow && !!c2AttachedRow.businessAssetPacket && c2AttachedRow.businessAssetPacket.logoUrl === packetPayload.logoUrl, JSON.stringify(c2AttachedRow && c2AttachedRow.businessAssetPacket));

  const openAttachedRes = await biz.client("POST", "/api/offers", {
    title: "Open attached tasting", whatComped: "Dinner for two", dollarCap: 60, spots: 1, assetPacketAttached: true,
    experience: "Open patio night", includes: "Two entrees", visitWindow: "Evenings",
  });
  const openPlainRes = await biz.client("POST", "/api/offers", {
    title: "Open plain tasting", whatComped: "Dinner for two", dollarCap: 60, spots: 1,
    experience: "Open counter night", includes: "Two entrees", visitWindow: "Evenings",
  });
  const board = await c1.client("GET", "/api/open-offers");
  const boardAttached = (board.data.offers || []).find((o) => o.id === openAttachedRes.data.offer.id);
  const boardPlain = (board.data.offers || []).find((o) => o.id === openPlainRes.data.offer.id);
  check("GET /open-offers: brief on every board offer; packet only when attached",
    !!boardAttached && !!boardPlain && !!boardAttached.brief && boardAttached.brief.hook === "Open patio night" &&
    !!boardAttached.businessAssetPacket && boardPlain.businessAssetPacket === null && !!boardPlain.brief,
    JSON.stringify({ a: boardAttached && boardAttached.businessAssetPacket, p: boardPlain && boardPlain.businessAssetPacket }));

  // ---------- booking snapshots ----------
  const accAttached = await c2.client("POST", `/api/offers/${attachedCompRes.data.offer.id}/accept`, {});
  check("booking snapshot: an attached offer's booking carries the brief and the packet as they stood at booking time",
    accAttached.status === 201 && !!accAttached.data.booking.brief && accAttached.data.booking.brief.deliverable === COMP_DELIVERABLE &&
    !!accAttached.data.booking.assetPacket && accAttached.data.booking.assetPacket.logoUrl === packetPayload.logoUrl,
    `${accAttached.status} ${JSON.stringify(accAttached.data.booking && accAttached.data.booking.assetPacket)}`);
  const accPlain = await c2.client("POST", `/api/offers/${plainCompRes.data.offer.id}/accept`, {});
  check("booking snapshot: an unattached offer's booking carries the brief and a null packet",
    accPlain.status === 201 && !!accPlain.data.booking.brief && accPlain.data.booking.assetPacket === null,
    `${accPlain.status} ${JSON.stringify(accPlain.data.booking && accPlain.data.booking.assetPacket)}`);

  // ---------- direct paid booking ----------
  const rateSet = await c1.client("PATCH", "/api/me/profile", { paidRate: 250 });
  if (rateSet.status !== 200) throw new Error(`paidRate set failed: ${rateSet.status} ${JSON.stringify(rateSet.data)}`);
  const paidBookingRes = await biz.client("POST", "/api/bookings/paid", { creatorId: c1.user.id, paidBrief: "Feature the new patio menu" });
  check("POST /bookings/paid: brief derives from the paidBrief text (hook), paidBrief itself unchanged, packet snapshotted",
    paidBookingRes.status === 201 && paidBookingRes.data.booking.paidBrief === "Feature the new patio menu" &&
    paidBookingRes.data.booking.brief && paidBookingRes.data.booking.brief.hook === "Feature the new patio menu" &&
    paidBookingRes.data.booking.brief.deliverable === PAID_DELIVERABLE &&
    !!paidBookingRes.data.booking.assetPacket && paidBookingRes.data.booking.assetPacket.logoUrl === packetPayload.logoUrl,
    `${paidBookingRes.status} ${JSON.stringify(paidBookingRes.data.booking && paidBookingRes.data.booking.brief)}`);

  // ---------- readout: seeded records on a fresh business ----------
  const bizR = await registerBusiness("growth", "Readout Kitchen");
  const cR1 = await registerCreator(`readbest${u}`);
  const cR2 = await registerCreator(`readsecond${u}`);
  await approve(bizR.user.id); await approve(cR1.user.id); await approve(cR2.user.id);
  await activate(bizR.user.id);
  await cR1.client("PATCH", "/api/me/profile", { paidRate: 250, licensingFee: 100 });

  async function deliveredVisit(business, creator, title, dollarCap) {
    const off = await business("POST", "/api/offers", { title, whatComped: "Dinner for two", dollarCap, spots: 1, creatorId: creator.user.id });
    if (off.status !== 201) throw new Error(`readout offer failed: ${off.status} ${JSON.stringify(off.data)}`);
    const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
    if (acc.status !== 201) throw new Error(`readout accept failed: ${acc.status} ${JSON.stringify(acc.data)}`);
    const conf = await business("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
    if (conf.status !== 200) throw new Error(`readout confirm failed: ${conf.status} ${JSON.stringify(conf.data)}`);
    const post = await creator.client("POST", "/api/posts", { bookingId: acc.data.booking.id, url: "https://www.instagram.com/p/OPERATOR1/", includesDisclosure: true });
    if (post.status !== 201) throw new Error(`readout post failed: ${post.status} ${JSON.stringify(post.data)}`);
    return { offer: off.data.offer, booking: acc.data.booking, post: post.data.post };
  }
  const best = await deliveredVisit(bizR.client, cR1, "Readout best visit", 50);
  const second = await deliveredVisit(bizR.client, cR2, "Readout second visit", 40);
  const perfBest = await cR1.client("POST", `/api/bookings/${best.booking.id}/performance`, { views: 1000, likes: 100 });
  const perfSecond = await cR2.client("POST", `/api/bookings/${second.booking.id}/performance`, { views: 200, likes: 10 });
  if (perfBest.status !== 200 || perfSecond.status !== 200) throw new Error("readout performance reports failed");
  const tallyBest = await bizR.client("POST", `/api/bookings/${best.booking.id}/code-redemptions`, { count: 9, basketTotal: 486, compCostActual: 15 });
  const tallySecond = await bizR.client("POST", `/api/bookings/${second.booking.id}/code-redemptions`, { count: 2, basketTotal: 80 });
  if (tallyBest.status !== 200 || tallySecond.status !== 200) throw new Error("readout tallies failed");
  const paidR = await bizR.client("POST", "/api/bookings/paid", { creatorId: cR1.user.id });
  if (paidR.status !== 201) throw new Error(`readout paid booking failed: ${paidR.status} ${JSON.stringify(paidR.data)}`);
  const licenseRes = await bizR.client("POST", `/api/posts/${best.post.id}/license-request`, {});
  check("readout fixture: a license request on the best post is pending",
    licenseRes.status === 201 && licenseRes.data.licenseRequest.status === "pending", `${licenseRes.status} ${JSON.stringify(licenseRes.data).slice(0, 160)}`);

  // Time travel: the best post's snapshots become day 0 (600
  // views) and day 10 (1000 views) relative to a base 20 days
  // ago, so the readout's day-14 mark has a real case to prove.
  await stopServer();
  const snapBase = Date.now() - 20 * DAY;
  editDb((db) => {
    for (const [key, val] of Object.entries(db)) {
      if (key.startsWith("post:") && val.bookingId === best.booking.id) {
        val.snapshots = [
          { at: new Date(snapBase).toISOString(), views: 600, likes: 60, comments: 0, shares: 0, source: "creator_report" },
          { at: new Date(snapBase + 10 * DAY).toISOString(), views: 1000, likes: 100, comments: 0, shares: 0, source: "creator_report" },
        ];
        val.reportedAt = new Date(snapBase).toISOString();
        val.lastSnapshotAt = new Date(snapBase + 10 * DAY).toISOString();
      }
    }
  });
  startServer();
  await waitUp();
  const bizR2 = makeClient();
  await bizR2("POST", "/api/auth/login", { email: bizR.email, password: "password123" });
  const cR1b = makeClient();
  await cR1b("POST", "/api/auth/login", { email: cR1.email, password: "password123" });

  const readout = await bizR2("GET", "/api/me/performance-readout");
  const bestRow = readout.data && readout.data.offers ? readout.data.offers.find((o) => o.offerId === best.offer.id) : null;
  check("readout (business): the best offer's row carries the seeded math (1 booked, 1 redeemed, 1 post, 1000 views, 9/$486, register 486, ROAS 34.53)",
    readout.status === 200 && !!bestRow && bestRow.visitsBooked === 1 && bestRow.visitsRedeemed === 1 && bestRow.postsLive === 1 &&
    bestRow.views === 1000 && bestRow.likes === 100 && bestRow.redemptions.count === 9 && bestRow.redemptions.basketTotal === 486 &&
    bestRow.registerValue === 486 && bestRow.roasScore === 34.53,
    `${readout.status} ${JSON.stringify(bestRow)}`);
  check("readout (business): the best offer's series proves the day-14 snapshot case (600 / 1000 / 1000)",
    !!bestRow && bestRow.series.day7 === 600 && bestRow.series.day14 === 1000 && bestRow.series.day30 === 1000, JSON.stringify(bestRow && bestRow.series));
  check("readout (business): the best offer's license counts show the pending request",
    !!bestRow && bestRow.licenseRequests.pending === 1 && bestRow.licenseRequests.granted === 0 && bestRow.licenseRequests.declined === 0, JSON.stringify(bestRow && bestRow.licenseRequests));
  const ov = readout.data ? readout.data.overall : null;
  check("readout (business): overall aggregates across all bookings incl. the offerId-null paid booking (3 booked, 2 redeemed, 2 posts, 11/$566, register 566)",
    !!ov && ov.visitsBooked === 3 && ov.visitsRedeemed === 2 && ov.postsLive === 2 && ov.redemptions.count === 11 && ov.redemptions.basketTotal === 566 && ov.registerValue === 566,
    JSON.stringify(ov));
  check("readout (business): overall series sums across offers (800 / 1200 / 1200) and plan visits ride planAllowanceFor (Growth: 2 used of 10)",
    !!ov && ov.series.day7 === 800 && ov.series.day14 === 1200 && ov.series.day30 === 1200 && ov.visitsUsed === 2 && ov.visitsAllowance === 10 && ov.offersLive === 2,
    JSON.stringify(ov));
  const rec = readout.data ? readout.data.recommendation : null;
  check("readout (business): the repeat pick is the seeded best item, with the winning metric named in the reason",
    !!rec && rec.type === "repeat" && rec.bookingId === best.booking.id && rec.offerId === best.offer.id &&
    rec.creatorHandle === (cR1.user.creator ? cR1.user.creator.handle : rec.creatorHandle) && /9 code redemptions/.test(rec.reason || "") && readout.data.empty === false,
    JSON.stringify(rec));

  const cReadout = await cR1b("GET", "/api/me/performance-readout");
  const co = cReadout.data ? cReadout.data.overall : null;
  check("readout (creator): overall counts (2 booked, 1 redeemed, 1 post, 100% on time, 1 paid booking, $242.50 recorded net, 1 license pending)",
    cReadout.status === 200 && !!co && co.visitsBooked === 2 && co.visitsRedeemed === 1 && co.postsLive === 1 && co.onTimePct === 100 &&
    co.paidBookings === 1 && co.paidRecordedNet === 242.5 && co.licenseRequestsPending === 1,
    `${cReadout.status} ${JSON.stringify(co)}`);
  const cPostRow = cReadout.data && cReadout.data.posts ? cReadout.data.posts.find((p) => p.bookingId === best.booking.id) : null;
  check("readout (creator): the per-post row carries the business, the numbers, and the same series",
    !!cPostRow && cPostRow.title === "Readout best visit" && cPostRow.businessName === "Readout Kitchen" && cPostRow.views === 1000 &&
    cPostRow.series.day7 === 600 && cPostRow.series.day14 === 1000 && cReadout.data.recommendation.action === "track",
    JSON.stringify(cPostRow));
  check("readout (creator): no earnings estimate language anywhere in the payload",
    !/estimat|projected|expected earn/i.test(JSON.stringify(cReadout.data).replace(/estimatedRegisterValue/g, "")), "");

  // A creator whose profile is unfinished gets finish-profile as
  // the next action, and onTimePct stays null with no posts.
  const cX = await registerCreator(`opnew${u}`);
  await approve(cX.user.id);
  await cX.client("PATCH", "/api/me/profile", { localAudiencePct: null });
  const cXReadout = await cX.client("GET", "/api/me/performance-readout");
  check("readout (creator): an unfinished profile reads empty with onTimePct null and finish_profile as the next action",
    cXReadout.status === 200 && cXReadout.data.empty === true && cXReadout.data.overall.onTimePct === null &&
    cXReadout.data.recommendation.action === "finish_profile" && cXReadout.data.recommendation.type === "next",
    `${cXReadout.status} ${JSON.stringify(cXReadout.data).slice(0, 240)}`);

  console.log(`\nOperator verification: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log("Failures:", failures); process.exitCode = 1; }
} catch (e) {
  console.error("verify-operator crashed:", e);
  process.exitCode = 1;
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}
