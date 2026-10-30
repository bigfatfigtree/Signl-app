// Build -54: Admin Command Center foundation + Overview + Markets
// (spec signl-admin-command-center-spec-2026-10-30.md §9, phase
// -54). Proven here:
//
// 1. AGGREGATES. GET /admin/command/overview and
//    /admin/command/markets compute every figure from the source
//    records (users, bookings, posts, licenses, register events)
//    on the seeded fixture store, cross-checked field by field:
//    user splits, comps booked-now / completed / counted (the
//    §4.4 lifecycle — a +1 companion never counts, a voided first
//    register event never counts), finished deals printed by
//    kind and summed (§4.5), counted register dollars kept in
//    their own honesty class, money-owed answering its forming
//    state (null) and dollars-flowing live since -55, the needs-attention
//    strip with real counts, tester/demo exclusion by default
//    and inclusion on request, market scoping, period windows,
//    the per-market launch gate, live flags, attached partners
//    and unlisted typed cities resolving into a market.
//
// 2. ATTRIBUTION (§2.2). Registration through a partner link
//    stamps partnerId next to the untouched signupSource; the
//    backfill stamps legacy records (unknown codes reported,
//    never guessed) and logs one summary event; the manual
//    repair action sets and clears the stamp with a required
//    reason, event-logged with the actor; signupSource never
//    changes under any of it.
//
// 3. SUBJECT EVENT READ (§6.7). GET /admin/command/events/:id
//    returns exactly the events where the record is subject or
//    actor, marked which, and reports the scan honestly.
//
// 4. HARD GUARDRAIL (§6.8). Counts and money are Admin-only:
//    creator, business and anonymous callers get 403/401 on
//    every new endpoint, and no non-admin payload (bootstrap,
//    /me, register response) carries partnerId or any command
//    field — publicUser strips the stamp; only Admin serializers
//    re-add it.
//
// Run: node scripts/verify-build54.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build54-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify-admin-pass-123";
process.env.APP_URL = "http://localhost";

const require = createRequire(import.meta.url);
const auth = require("../netlify/functions/lib/auth.js");
const { BUILD_ID } = require("../netlify/functions/lib/build.js");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// ---------- fixture records ----------
const PW = "verify-user-pass-123";
const { salt, hash } = auth.hashPassword(PW);
const NOW = new Date().toISOString();
const DAY = NOW.slice(0, 10);
const completeCreator = { handle: "x", followerCount: 1500, categories: ["Food"], localAudiencePct: 61 };
const bareCreator = { handle: "x", followerCount: 900, categories: ["Food"] }; // no local % → profile unfinished
const userRec = (id, over) => ({
  id, email: `${id}@fixtures.dev`, name: `User ${id}`,
  passwordSalt: salt, passwordHash: hash,
  status: "approved", city: "Nashville", state: "TN", country: "United States",
  createdAt: NOW, updatedAt: NOW, tester: false,
  ...over,
});
const FIXTURE_USERS = [
  // Partners: one real (unsigned agreement), one demo (excluded by default everywhere)
  userRec("partner-max", { role: "partner", email: "max@fixtures.dev", name: "Max Media", partner: { name: "Max Media", type: "media", contactName: "Sean", code: "maxmedia", markets: ["Nashville"], sharePct: 25, status: "active", agreementStatus: "unsigned", demo: false } }),
  userRec("partner-demo", { role: "partner", email: "demo@fixtures.dev", name: "Demo Partner", partner: { name: "Demo Partner", type: "media", code: "demo", markets: ["Nashville"], sharePct: 60, status: "active", agreementStatus: "unsigned", demo: true } }),
  // Creators
  userRec("c-stamped", { role: "creator", market: "Nashville", signupSource: "partner-maxmedia", partnerId: "partner-max", creator: { ...bareCreator, handle: "stamped" } }),
  userRec("c-legacy", { role: "creator", market: "Nashville", signupSource: "partner-maxmedia", creator: { ...bareCreator, handle: "legacy" } }),
  userRec("c-unknown", { role: "creator", market: "Nashville", status: "pending", signupSource: "partner-ghost", creator: { ...bareCreator, handle: "unknown" } }),
  userRec("c-direct", { role: "creator", market: "Nashville", creator: { ...completeCreator, handle: "direct" } }),
  userRec("c-tester", { role: "creator", market: "Nashville", status: "pending", tester: true, creator: { ...bareCreator, handle: "tester" } }),
  userRec("unl-clark", { role: "creator", market: "Not listed yet", status: "pending", city: "Clarksville", creator: { ...bareCreator, handle: "clark" } }),
  // Businesses
  userRec("b-active", { role: "business", market: "Nashville", signupSource: "partner-maxmedia", partnerId: "partner-max", business: { businessName: "Active Eats", category: "Restaurant", planName: "Growth", planPriceMonthly: 349, accessState: "active" } }),
  userRec("b-founding", { role: "business", market: "Virginia Beach", city: "Virginia Beach", state: "VA", business: { businessName: "Founding Cafe", category: "Coffee", planName: "Self-Service", planPriceMonthly: 199 } }),
];
const bookingRec = (id, over) => ({ id, businessId: "b-active", creatorId: "c-direct", market: "Nashville", title: `Visit ${id}`, createdAt: NOW, updatedAt: NOW, ...over });
const FIXTURE_BOOKINGS = [
  bookingRec("bk-booked", { kind: "comp", status: "booked", creatorId: "c-stamped" }),
  bookingRec("bk-done-counted", { kind: "comp", status: "completed" }),
  bookingRec("bk-done-plain", { kind: "comp", status: "completed", creatorId: "c-stamped" }),
  bookingRec("bk-plusone", { kind: "comp", status: "completed", collabRole: "plusone" }),
  bookingRec("bk-paid-released", { kind: "paid", status: "completed", paidLane: { rate: 200, businessTotal: 206, creatorNet: 194, platformFee: 12, escrowState: "released", releasedAt: NOW } }),
  bookingRec("bk-paid-held", { kind: "paid", status: "completed", paidLane: { rate: 200, businessTotal: 206, creatorNet: 194, platformFee: 12, escrowState: "held" } }),
];
const seed = {};
for (const u of FIXTURE_USERS) { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; }
for (const b of FIXTURE_BOOKINGS) seed[`booking:${b.id}`] = b;
seed["post:post-1"] = { id: "post-1", bookingId: "bk-done-counted", creatorId: "c-direct", submittedAt: NOW, createdAt: NOW };
seed["license:lic-1"] = { id: "lic-1", businessId: "b-active", creatorId: "c-direct", bookingId: "bk-done-counted", postId: "post-1", status: "granted", grantedAt: NOW, respondedAt: NOW, createdAt: NOW, fee: 150 };
seed["redevent:re-1"] = { id: "re-1", bookingId: "bk-done-counted", businessId: "b-active", creatorId: "c-direct", kind: "first", amount: 120.5, at: NOW };
seed["redevent:re-2"] = { id: "re-2", bookingId: "bk-done-counted", businessId: "b-active", creatorId: "c-direct", kind: "return", amount: 40, at: NOW };
seed["redevent:re-3"] = { id: "re-3", bookingId: "bk-done-plain", businessId: "b-active", creatorId: "c-stamped", kind: "first", amount: 999, at: NOW, voided: true };
seed["config:markets"] = { flags: { Nashville: true } };
seed[`event:${DAY}:ev-subj`] = { id: "ev-subj", ts: NOW, type: "profile_updated", actorId: "admin-x", actorRole: "admin", subjectId: "c-direct", market: "Nashville", data: {} };
seed[`event:${DAY}:ev-actor`] = { id: "ev-actor", ts: NOW, type: "post_submitted", actorId: "c-direct", actorRole: "creator", subjectId: "bk-done-counted", market: "Nashville", data: {} };
seed[`event:${DAY}:ev-other`] = { id: "ev-other", ts: NOW, type: "profile_updated", actorId: "admin-x", actorRole: "admin", subjectId: "c-stamped", market: "Nashville", data: {} };
fs.writeFileSync(DB_PATH, JSON.stringify(seed));

const { handler } = require("../netlify/functions/api.js");
function evt(method, p, { cookie, query, body } = {}) {
  return { httpMethod: method, path: p, headers: cookie ? { cookie } : {}, queryStringParameters: query || {}, body: body ? JSON.stringify(body) : null, isBase64Encoded: false };
}
const parse = (res) => { try { return JSON.parse(res.body); } catch (e) { return null; } };
const cookieOf = (res) => (((res.headers || {})["Set-Cookie"] || (res.headers || {})["set-cookie"] || "").split(";")[0]);

console.log("verify-build54: Command Center foundation + Overview + Markets");

check("build stamp is 2026.10.30-56", BUILD_ID === "2026.10.30-56", BUILD_ID);
check("index.html carries the -54 stamp", fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8").includes("2026.10.30-56"));

const login = await handler(evt("POST", "/api/auth/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } }));
check("admin login succeeds", login.statusCode === 200, `got ${login.statusCode}`);
const adminCookie = cookieOf(login);

// ---------- overview aggregates ----------
const ovRes = await handler(evt("GET", "/api/admin/command/overview", { cookie: adminCookie }));
const ov = parse(ovRes);
check("GET /admin/command/overview answers 200 for admin", ovRes.statusCode === 200, `got ${ovRes.statusCode}: ${ovRes.body.slice(0, 200)}`);
const t = (ov && ov.tiles) || {};
check("users total 7 (5 creators + 2 businesses; tester and partners out)", t.usersTotal === 7, JSON.stringify(t));
check("splits: 5 creators, 2 businesses, 1 partner (demo partner excluded)", t.creators === 5 && t.businesses === 2 && t.partners === 1, JSON.stringify(t));
check("awaiting review 2 (unknown-code creator + unlisted Clarksville)", t.awaitingReview === 2, JSON.stringify(t.awaitingReview));
check("comps booked now 1 (the open comp booking)", t.compsBookedNow === 1, JSON.stringify(t.compsBookedNow));
check("comps completed 2 (the +1 companion never counts)", t.compsCompleted === 2, JSON.stringify(t.compsCompleted));
check("comps counted 1 (voided first register event never counts)", t.compsCounted === 1, JSON.stringify(t.compsCounted));
check("finished deals print by kind and sum: 2 comp + 1 paid (released only) + 1 license = 4",
  !!t.finishedDeals && t.finishedDeals.compVisits === 2 && t.finishedDeals.paidBookings === 1 && t.finishedDeals.licenses === 1 && t.finishedDeals.total === 4,
  JSON.stringify(t.finishedDeals));
check("counted register dollars 160.50 (first 120.50 + return 40; the voided 999 excluded)", t.countedRegister === 160.5, JSON.stringify(t.countedRegister));
check("dollars flowing landed with -55 (Recorded $754 = $548 of plan selections on record + the $206 released booking, Charged $0 — no charges exist); money owed still answers its forming state (null)",
  !!t.dollarsFlowing && t.dollarsFlowing.recorded === 754 && t.dollarsFlowing.charged === 0 && t.moneyOwed === null, JSON.stringify({ d: t.dollarsFlowing, m: t.moneyOwed }));
const att = Object.fromEntries(((ov && ov.attention) || []).map((a) => [a.kind, a.count]));
check("attention strip: awaiting 2, unstamped 1, unknown code 1, unlisted 1, unsigned partners 1, unconnected registers 1",
  att.awaiting_review === 2 && att.unstamped_attribution === 1 && att.unknown_partner_code === 1 && att.unlisted_records === 1 && att.unsigned_partners === 1 && att.unconnected_registers === 1,
  JSON.stringify(att));
check("alerts tile is the attention sum (7)", t.alerts === 7, JSON.stringify(t.alerts));
check("filters echo names the default exclusion", !!ov && ov.filters && ov.filters.testersIncluded === false && /excluded/.test(ov.filters.excludedByDefault || ""));

// testers included on request
const ovT = parse(await handler(evt("GET", "/api/admin/command/overview", { cookie: adminCookie, query: { testers: "1" } })));
check("testers=1 includes the tester: users 8, awaiting 3", !!ovT && ovT.tiles.usersTotal === 8 && ovT.tiles.awaitingReview === 3, ovT && JSON.stringify(ovT.tiles));
// market scoping
const ovN = parse(await handler(evt("GET", "/api/admin/command/overview", { cookie: adminCookie, query: { market: "Nashville" } })));
check("market=Nashville scopes the tiles: users 5, comps completed 2, counted $160.50", !!ovN && ovN.tiles.usersTotal === 5 && ovN.tiles.compsCompleted === 2 && ovN.tiles.countedRegister === 160.5, ovN && JSON.stringify(ovN.tiles));
const ovV = parse(await handler(evt("GET", "/api/admin/command/overview", { cookie: adminCookie, query: { market: "Virginia Beach" } })));
check("market=Virginia Beach: users 1, no activity yet", !!ovV && ovV.tiles.usersTotal === 1 && ovV.tiles.compsCompleted === 0 && ovV.tiles.countedRegister === 0, ovV && JSON.stringify(ovV.tiles));
// period windows (fixture activity is stamped now)
const ovM = parse(await handler(evt("GET", "/api/admin/command/overview", { cookie: adminCookie, query: { period: "this_month" } })));
check("period=this_month keeps today's activity: comps completed 2, deals 4", !!ovM && ovM.tiles.compsCompleted === 2 && ovM.tiles.finishedDeals.total === 4, ovM && JSON.stringify(ovM.tiles));
const ovL = parse(await handler(evt("GET", "/api/admin/command/overview", { cookie: adminCookie, query: { period: "last_month" } })));
check("period=last_month zeroes the flows but not the stocks", !!ovL && ovL.tiles.compsCompleted === 0 && ovL.tiles.finishedDeals.total === 0 && ovL.tiles.countedRegister === 0 && ovL.tiles.usersTotal === 7, ovL && JSON.stringify(ovL.tiles));

// ---------- markets aggregates ----------
const mkRes = await handler(evt("GET", "/api/admin/command/markets", { cookie: adminCookie }));
const mk = parse(mkRes);
check("GET /admin/command/markets answers 200 for admin", mkRes.statusCode === 200, `got ${mkRes.statusCode}`);
const nash = mk && mk.markets.find((m) => m.market === "Nashville");
check("Nashville is live by flag; Virginia Beach is founding", !!nash && nash.live === true && mk.markets.find((m) => m.market === "Virginia Beach").live === false);
check("Nashville sign-ups: creators 4 signed / 1 awaiting / 3 approved / 1 finished; businesses 1 / 0 / 1 / 1 active",
  !!nash && nash.signups.creators.signedUp === 4 && nash.signups.creators.awaitingReview === 1 && nash.signups.creators.approved === 3 && nash.signups.creators.finished === 1
  && nash.signups.businesses.signedUp === 1 && nash.signups.businesses.approved === 1 && nash.signups.businesses.active === 1,
  nash && JSON.stringify(nash.signups));
check("launch gate reads the finished count against the 25–30 bar, unmet at 1",
  !!nash && nash.launchGate.finished === 1 && nash.launchGate.low === 25 && nash.launchGate.high === 30 && nash.launchGate.met === false, nash && JSON.stringify(nash.launchGate));
check("Nashville activity: businesses active 1, comps completed 2, counted 1, deals 4, register $160.50, SIGNL take forming (null)",
  !!nash && nash.businessesActive === 1 && nash.compsCompleted === 2 && nash.compsCounted === 1 && nash.finishedDeals.total === 4 && nash.countedRegister === 160.5 && nash.signlTake === null,
  nash && JSON.stringify({ ba: nash.businessesActive, cc: nash.compsCompleted, fd: nash.finishedDeals, cr: nash.countedRegister }));
check("Nashville carries its attached partner (Max Media)", !!nash && nash.partners.length === 1 && nash.partners[0].name === "Max Media" && nash.partners[0].code === "maxmedia", nash && JSON.stringify(nash.partners));
check("Clarksville's unlisted records claim Nashville (resolves unique, listed on the market row)",
  !!nash && nash.unlistedClaiming.length === 1 && nash.unlistedClaiming[0].city === "Clarksville" && nash.unlistedClaiming[0].total === 1, nash && JSON.stringify(nash.unlistedClaiming));
const unl = mk && mk.unlisted.find((r) => r.city === "Clarksville");
check("unlisted Clarksville row: 1 pending creator, resolvesTo Nashville", !!unl && unl.total === 1 && unl.creators === 1 && unl.awaitingReview === 1 && unl.resolvesTo === "Nashville" && unl.resolveStatus === "unique", unl && JSON.stringify(unl));
const vb = mk && mk.markets.find((m) => m.market === "Virginia Beach");
check("Virginia Beach: 1 founding business, none active, gate at 0", !!vb && vb.signups.businesses.signedUp === 1 && vb.businessesActive === 0 && vb.launchGate.finished === 0, vb && JSON.stringify(vb));

// ---------- subject-scoped event read ----------
const evRes = await handler(evt("GET", "/api/admin/command/events/c-direct", { cookie: adminCookie }));
const evd = parse(evRes);
check("subject read answers with the record's own trail only: subject event + actor event, not the unrelated one",
  evRes.statusCode === 200 && !!evd
  && evd.events.some((e) => e.id === "ev-subj" && e.matchedOn === "subject")
  && evd.events.some((e) => e.id === "ev-actor" && e.matchedOn === "actor")
  && !evd.events.some((e) => e.id === "ev-other")
  && evd.events.every((e) => e.subjectId === "c-direct" || e.actorId === "c-direct"),
  evd && JSON.stringify(evd.events.map((e) => [e.id, e.matchedOn])));
check("subject read reports its scan honestly (scanned >= 3, not truncated)", !!evd && evd.scanned >= 3 && evd.truncated === false, evd && JSON.stringify({ scanned: evd.scanned, truncated: evd.truncated }));

// ---------- attribution: registration stamps the foreign key ----------
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const reg = await handler(evt("POST", "/api/auth/register", { body: { role: "creator", name: "Reg Stamped", email: "regstamped@fixtures.dev", password: PW, market: "Nashville", city: "Nashville", handle: "regstamped", followerCount: 2200, localAudiencePct: 48, categories: ["Food & Drink"], signupSource: "partner-maxmedia", ...AGREE } }));
const regBody = parse(reg);
check("registration through a partner link succeeds", reg.statusCode === 201, `got ${reg.statusCode}: ${reg.body.slice(0, 200)}`);
check("the register response itself carries no partnerId (stripped from client payloads)", !!regBody && !JSON.stringify(regBody).includes("partnerId"));
const appsAfterReg = parse(await handler(evt("GET", "/api/admin/applications", { cookie: adminCookie })));
const regRow = appsAfterReg && [...(appsAfterReg.pending || []), ...(appsAfterReg.decided || [])].find((u) => u.email === "regstamped@fixtures.dev");
check("the new record is stamped with the partner's id in the Admin queue, source string intact",
  !!regRow && regRow.partnerId === "partner-max" && regRow.partnerName === "Max Media" && regRow.signupSource === "partner-maxmedia",
  regRow && JSON.stringify({ p: regRow.partnerId, s: regRow.signupSource }));

// ---------- attribution: backfill ----------
const bf = parse(await handler(evt("POST", "/api/admin/command/backfill-attribution", { cookie: adminCookie, body: {} })));
check("backfill stamps the one legacy record and reports the unknown code instead of guessing",
  !!bf && bf.backfill.stamped === 1 && bf.backfill.unknownCode === 1, bf && JSON.stringify(bf.backfill));
const appsAfterBf = parse(await handler(evt("GET", "/api/admin/applications", { cookie: adminCookie })));
const allRows = appsAfterBf ? [...(appsAfterBf.pending || []), ...(appsAfterBf.decided || [])] : [];
const legacyRow = allRows.find((u) => u.id === "c-legacy");
check("the legacy record now carries partnerId; its signupSource is unchanged",
  !!legacyRow && legacyRow.partnerId === "partner-max" && legacyRow.signupSource === "partner-maxmedia", legacyRow && JSON.stringify({ p: legacyRow.partnerId, s: legacyRow.signupSource }));
const unknownRow = allRows.find((u) => u.id === "c-unknown");
check("the unknown-code record stays unstamped", !!unknownRow && !unknownRow.partnerId, unknownRow && JSON.stringify(unknownRow.partnerId));
const bfEvents = parse(await handler(evt("GET", "/api/admin/events", { cookie: adminCookie, query: { type: "partner_attribution_backfill" } })));
check("one summary event logs the backfill run", !!bfEvents && (bfEvents.events || []).some((e) => e.data && e.data.stamped === 1), bfEvents && JSON.stringify((bfEvents.events || []).length));
const bf2 = parse(await handler(evt("POST", "/api/admin/command/backfill-attribution", { cookie: adminCookie, body: {} })));
check("backfill is idempotent (second run stamps 0)", !!bf2 && bf2.backfill.stamped === 0, bf2 && JSON.stringify(bf2.backfill));

// ---------- attribution: manual repair ----------
const noReason = await handler(evt("POST", "/api/admin/users/attribute-partner", { cookie: adminCookie, body: { userId: "c-direct", partnerId: "partner-max" } }));
check("repair without a reason is refused (never silent)", noReason.statusCode === 400, `got ${noReason.statusCode}`);
const setRes = parse(await handler(evt("POST", "/api/admin/users/attribute-partner", { cookie: adminCookie, body: { userId: "c-direct", partnerId: "partner-max", reason: "Came through Max's link; confirmed by email" } })));
check("repair sets the stamp and names the partner", !!setRes && setRes.user && setRes.user.partnerId === "partner-max" && setRes.user.partnerName === "Max Media", setRes && JSON.stringify(setRes));
const setEvents = parse(await handler(evt("GET", "/api/admin/events", { cookie: adminCookie, query: { type: "partner_attribution_set" } })));
check("the repair is event-logged with actor and reason",
  !!setEvents && (setEvents.events || []).some((e) => e.subjectId === "c-direct" && e.data && e.data.reason === "Came through Max's link; confirmed by email" && e.data.to === "partner-max"),
  setEvents && JSON.stringify((setEvents.events || []).map((e) => e.data)));
const clearRes = parse(await handler(evt("POST", "/api/admin/users/attribute-partner", { cookie: adminCookie, body: { userId: "c-direct", partnerId: null, reason: "Direct sign-up after all" } })));
check("repair can clear the stamp back to direct", !!clearRes && clearRes.user && clearRes.user.partnerId === null, clearRes && JSON.stringify(clearRes));
const appsFinal = parse(await handler(evt("GET", "/api/admin/applications", { cookie: adminCookie })));
const directRow = appsFinal && [...(appsFinal.pending || []), ...(appsFinal.decided || [])].find((u) => u.id === "c-direct");
check("after clearing, the queue row shows no stamp and the record never had a source string to lose", !!directRow && !directRow.partnerId && !directRow.signupSource);

// ---------- guardrail: admin-only ----------
const creatorLogin = await handler(evt("POST", "/api/auth/login", { body: { email: "c-direct@fixtures.dev", password: PW } }));
check("seeded creator logs in", creatorLogin.statusCode === 200, `got ${creatorLogin.statusCode}`);
const creatorCookie = cookieOf(creatorLogin);
const bizLogin = await handler(evt("POST", "/api/auth/login", { body: { email: "b-active@fixtures.dev", password: PW } }));
const bizCookie = cookieOf(bizLogin);
for (const [label, cookie] of [["creator", creatorCookie], ["business", bizCookie]]) {
  for (const p of ["/api/admin/command/overview", "/api/admin/command/markets", "/api/admin/command/events/c-direct"]) {
    const r = await handler(evt("GET", p, { cookie }));
    check(`${label} gets 403 on GET ${p}`, r.statusCode === 403, `got ${r.statusCode}`);
  }
  const rb = await handler(evt("POST", "/api/admin/command/backfill-attribution", { cookie, body: {} }));
  check(`${label} gets 403 on POST backfill-attribution`, rb.statusCode === 403, `got ${rb.statusCode}`);
  const ra = await handler(evt("POST", "/api/admin/users/attribute-partner", { cookie, body: { userId: "c-direct", partnerId: null, reason: "x" } }));
  check(`${label} gets 403 on POST attribute-partner`, ra.statusCode === 403, `got ${ra.statusCode}`);
}
const anon = await handler(evt("GET", "/api/admin/command/overview"));
check("anonymous GET command/overview is refused (401/403)", anon.statusCode === 401 || anon.statusCode === 403, `got ${anon.statusCode}`);
const boot = parse(await handler(evt("GET", "/api/bootstrap")));
check("public bootstrap carries no partnerId and no command aggregates",
  !!boot && !JSON.stringify(boot).includes("partnerId") && !JSON.stringify(boot).includes("finishedDeals") && !JSON.stringify(boot).includes("countedRegister"),
  boot && Object.keys(boot).join(","));
const me = await handler(evt("GET", "/api/auth/me", { cookie: creatorCookie }));
check("creator /me carries no partnerId", me.statusCode === 200 && !String(me.body).includes("partnerId"), `got ${me.statusCode}`);
const meBiz = await handler(evt("GET", "/api/auth/me", { cookie: bizCookie }));
check("business /me carries no partnerId even though the record is stamped", meBiz.statusCode === 200 && !String(meBiz.body).includes("partnerId"), `got ${meBiz.statusCode}`);

// ---------- client source: shell, views, repair control ----------
const appSrc = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const routerSrc = fs.readFileSync(new URL("../netlify/functions/lib/router.js", import.meta.url), "utf8");
const win = (startMarker, endMarker) => {
  const a = appSrc.indexOf(startMarker);
  const b = endMarker ? appSrc.indexOf(endMarker, a + startMarker.length) : appSrc.length;
  return a >= 0 && b > a ? appSrc.slice(a, b) : "";
};
const shell = win("async function loadStats()", "async function adminLineLookup()");
check("Stats renders the Command Center shell: title, filters, honesty legend, exclusion note",
  shell.includes("Command Center") && shell.includes("ccSetPeriod") && shell.includes("ccSetMarket") && shell.includes("ccSetTesters")
  && shell.includes("Counted") && shell.includes("Recorded") && shell.includes("Charged") && shell.includes("Modeled")
  && shell.includes("excluded from every count"), shell.slice(0, 160));
check("subtab bar carries Jeff's eight: Overview · Money · Partners · Businesses · Creators · Markets · Owed · Close",
  ["Overview", "Money", "Partners", "Businesses", "Creators", "Markets", "Owed", "Close"].every((l) => shell.includes(`ccSetTab('${l.toLowerCase()}')`)));
check("Overview renders tiles, attention strip, waiting-for-launch state and the board",
  shell.includes("ccOverviewHtml") && shell.includes("Needs attention") && shell.includes("Waiting for launch") && shell.includes("Finished deals") && shell.includes("Register dollars"));
check("money and businesses render their real views since -55; the later-phase views still render forming states, never invented totals",
  shell.includes("ccFormingHtml") && shell.includes("Forming") && shell.includes("ccMoneyHtml") && shell.includes("ccBusinessesHtml") && shell.includes("/admin/command/money") && shell.includes("/admin/command/businesses"));
check("Markets view renders the gate bar, live state, counted dollars and the unlisted resolution lines",
  shell.includes("ccMarketsHtml") && shell.includes("the launch gate") && shell.includes("Founding — not launched") && shell.includes("counted at registers") && shell.includes("Not in a market yet"));
check("the queue row carries the attribution repair control with partner select and required reason",
  appSrc.includes("toggleAttributionEditor") && appSrc.includes("saveAttribution") && appSrc.includes("attr-partner-") && appSrc.includes("attr-reason-") && appSrc.includes("Partner attribution"));
check("server: the command routes sit inside the admin gate (after the 403 check)",
  routerSrc.indexOf('seg[1] === "command"') > routerSrc.indexOf('if (seg[0] === "admin")')
  && routerSrc.includes('seg[2] === "overview"') && routerSrc.includes('seg[2] === "markets"') && routerSrc.includes('seg[2] === "backfill-attribution"'));
check("server: publicUser strips the stamp; registration stamps it from the partner source",
  routerSrc.includes("delete rest.partnerId;") && routerSrc.includes("user.partnerId = partnerUser.id"));
check("server: accounting reads source records, and the subject read is exported from the events lib",
  routerSrc.includes("allRedemptionEvents()") && routerSrc.includes("listEventsForSubject(subjectId")
  && fs.readFileSync(new URL("../netlify/functions/lib/events.js", import.meta.url), "utf8").includes("listEventsForSubject"));

console.log(`\nverify-build54: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
