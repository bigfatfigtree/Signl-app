// Admin Events + Campaign tabs hang fix (2026-10-25, follow-up to
// INCIDENT-2026-10-25): in production both tabs sat on "Loading..."
// forever. Root cause: the reads behind them were unbounded and
// serial — listEvents fetched EVERY event record's value before
// applying its limit, the campaign read re-scanned every recipient
// of every campaign per card, and store.list fetched Blobs values
// one awaited round trip per key, so cost grew with data volume
// until the function timed out. This suite runs the REAL api
// handler in-process against a seeded local store and proves:
//   - GET /admin/events returns the newest events first, bounded
//     by the limit and by the 1,000-record fetch cap, and the
//     underlying store is never asked for more than the cap
//   - GET /admin/campaign returns correct counts, a correct
//     sent-today total, and the per-lane split (creators@
//     signlteam.com vs hello@joinsignl.com) from the seeded sends
//   - with the store's list reads failing (auth still working),
//     both endpoints answer 200 with a degraded, empty payload
//     instead of hanging or 500ing — the Hardening A pattern
//   - anonymous reads are still refused
// Build -53 doctrine note (2026-10-30): this suite never pinned
// rail labels — it covers the Events + Campaign endpoints only.
// The Admin rail itself changed in Build -53 by Jeff's explicit
// order: TEN destinations now (Applications split out of the old
// queue destination as its own tab; Requests keeps its label and
// the panels that shared the queue), superseding the 2026-10-28
// "nine, no more, no fewer" set. Rail labels, destinations and
// order are pinned by scripts/verify-build53.mjs. Nothing in
// this suite's endpoint scope changed, so its checks — and its
// long-standing result — stand as they were.
// Run: node scripts/verify-admintabs.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-admintabs-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify-admin-pass-123";
process.env.APP_URL = "http://localhost";

// ---- Seed the local DB file before the store module loads it ----
// 1,500 events over five days (300/day), ts ascending; the very
// newest carries a marker type so ordering is assertable.
const seed = {};
const days = ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
let seq = 0;
for (const day of days) {
  for (let i = 0; i < 300; i++) {
    seq += 1;
    const hh = String(Math.floor(i / 60)).padStart(2, "0");
    const mm = String(i % 60).padStart(2, "0");
    const ts = `${day}T${hh}:${mm}:00.000Z`;
    const id = `seed-${String(seq).padStart(5, "0")}`;
    seed[`event:${day}:${id}`] = { id, ts, type: "seed_event", actorId: null, actorRole: "system", subjectId: null, market: null, data: { seq } };
  }
}
seed["event:2026-10-25:seed-newest"] = { id: "seed-newest", ts: "2026-10-25T23:59:59.000Z", type: "zz_newest_marker", actorId: null, actorRole: "admin", subjectId: null, market: null, data: {} };

// Campaign recipients: sends stamped "today" (process now) and one
// stamped 36h ago that must NOT count toward today.
const nowIso = new Date().toISOString();
const oldIso = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
const FOUNDING = "founding-creators-2026-10";
const HELLO = "founding-creators-hello-2026-10";
function recipient(campaignId, email, extra) {
  seed[`campaign-recipient:${campaignId}:${email}`] = {
    email, name: "Seed Creator", handle: "seedcreator", market: "Richmond", opener: "seed",
    status: "queued", importedAt: nowIso, ...extra,
  };
}
recipient(FOUNDING, "lane-creators-1@fixtures.dev", { status: "sent", sentAt: nowIso, sentFrom: "creators", messageRef: "m1" });
recipient(FOUNDING, "lane-creators-2@fixtures.dev", { status: "sent", sentAt: nowIso, sentFrom: "creators", messageRef: "m2" });
recipient(FOUNDING, "lane-default-1@fixtures.dev", { status: "sent", sentAt: nowIso, messageRef: "m3" }); // no stamp = default lane
recipient(FOUNDING, "old-send@fixtures.dev", { status: "sent", sentAt: oldIso, sentFrom: "creators", messageRef: "m0" });
recipient(FOUNDING, "queued-1@fixtures.dev", {});
recipient(FOUNDING, "queued-2@fixtures.dev", {});
recipient(FOUNDING, "bounced-1@fixtures.dev", { status: "bounced" });
recipient(FOUNDING, "skipped-1@fixtures.dev", { status: "skipped" });
recipient(HELLO, "hello-sent-1@fixtures.dev", { status: "sent", sentAt: nowIso, sentFrom: "default", messageRef: "m4" });
recipient(HELLO, "hello-sent-2@fixtures.dev", { status: "sent", sentAt: nowIso, messageRef: "m5" });
recipient(HELLO, "hello-queued-1@fixtures.dev", {});
fs.writeFileSync(DB_PATH, JSON.stringify(seed));

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

function evt(method, p, { cookie, query, body } = {}) {
  return {
    httpMethod: method,
    path: p,
    headers: cookie ? { cookie } : {},
    queryStringParameters: query || {},
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  };
}
const parse = (res) => { try { return JSON.parse(res.body); } catch (e) { return null; } };

console.log("verify-admintabs: Admin Events + Campaign reads are bounded and fail safe");

// Spy on getMany: the events read must never ask the store for
// more values than the fetch cap, no matter how big the log gets.
let maxGetManyKeys = 0;
const realGetMany = store.getMany;
store.getMany = async (keys) => { maxGetManyKeys = Math.max(maxGetManyKeys, keys.length); return realGetMany(keys); };

// Log in as the bootstrapped admin.
const login = await handler(evt("POST", "/api/auth/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } }));
check("admin login succeeds", login.statusCode === 200, `got ${login.statusCode}: ${login.body}`);
const setCookie = (login.headers && (login.headers["Set-Cookie"] || login.headers["set-cookie"])) || "";
const cookie = setCookie.split(";")[0];
check("login issued a session cookie", cookie.includes("="), setCookie.slice(0, 80));

// ---- Events: bounded, newest first ----
const evDefault = parse(await handler(evt("GET", "/api/admin/events", { cookie })));
check("events: default read returns 200-shaped payload", !!evDefault && Array.isArray(evDefault.events), JSON.stringify(evDefault).slice(0, 200));
check("events: default limit returns 500 events", evDefault && evDefault.events.length === 500 && evDefault.total === 500, evDefault && `len=${evDefault.events.length}`);
check("events: newest event first (marker on top)", evDefault && evDefault.events[0] && evDefault.events[0].type === "zz_newest_marker", evDefault && evDefault.events[0] && evDefault.events[0].type);
check("events: strictly newest-first order", evDefault && evDefault.events.every((e, i, a) => i === 0 || a[i - 1].ts >= e.ts));
check("events: store was never asked for more than the 1,000-record cap", maxGetManyKeys > 0 && maxGetManyKeys <= 1000, `max=${maxGetManyKeys}`);

const evCapped = parse(await handler(evt("GET", "/api/admin/events", { cookie, query: { limit: "5000" } })));
check("events: an oversized limit is capped at 1,000 fetched records", evCapped && evCapped.events.length === 1000, evCapped && `len=${evCapped.events.length}`);

const evTyped = parse(await handler(evt("GET", "/api/admin/events", { cookie, query: { limit: "300", type: "zz_newest_marker" } })));
check("events: type filter returns the matching event", evTyped && evTyped.total === 1 && evTyped.events[0].type === "zz_newest_marker", JSON.stringify(evTyped).slice(0, 200));

const evAnon = await handler(evt("GET", "/api/admin/events"));
check("events: anonymous read is refused (401/403)", evAnon.statusCode === 401 || evAnon.statusCode === 403, `got ${evAnon.statusCode}`);

// ---- Campaign: counts + per-lane sent today ----
const camp = parse(await handler(evt("GET", "/api/admin/campaign", { cookie, query: { campaignId: FOUNDING } })));
check("campaign: founding payload returns", !!camp && camp.campaign && camp.campaign.id === FOUNDING, JSON.stringify(camp).slice(0, 200));
check("campaign: counts are exact (4 sent incl. yesterday, 2 queued, 1 bounced, 1 skipped, 8 total)",
  !!camp && camp.counts.sent === 4 && camp.counts.queued === 2 && camp.counts.bounced === 1 && camp.counts.skipped === 1 && camp.counts.total === 8,
  camp && JSON.stringify(camp.counts));
check("campaign: sent today counts only today's sends (5 across campaigns)",
  !!camp && camp.campaign.sentToday === 5, camp && `sentToday=${camp.campaign && camp.campaign.sentToday}`);
check("campaign: per-lane split is creators@ lane 2, hello@ lane 3",
  !!camp && camp.campaign.sentTodayByLane && camp.campaign.sentTodayByLane.creators === 2 && camp.campaign.sentTodayByLane.default === 3,
  camp && JSON.stringify(camp.campaign.sentTodayByLane));
check("campaign: recent sends are newest-first and lane-stamped",
  !!camp && Array.isArray(camp.recentSends) && camp.recentSends.length === 4 && camp.recentSends.some((s) => s.fromMailbox === "creators") && camp.recentSends.some((s) => s.fromMailbox === "default"),
  camp && JSON.stringify(camp.recentSends).slice(0, 200));

const campHello = parse(await handler(evt("GET", "/api/admin/campaign", { cookie, query: { campaignId: HELLO } })));
check("campaign: hello@ lane card shows its own queue (2 sent, 1 queued)",
  !!campHello && campHello.counts.sent === 2 && campHello.counts.queued === 1 && campHello.counts.total === 3,
  campHello && JSON.stringify(campHello.counts));
check("campaign: hello@ lane card reports the same global per-lane split",
  !!campHello && campHello.campaign.sentTodayByLane && campHello.campaign.sentTodayByLane.creators === 2 && campHello.campaign.sentTodayByLane.default === 3,
  campHello && JSON.stringify(campHello.campaign.sentTodayByLane));

const campAnon = await handler(evt("GET", "/api/admin/campaign", { query: { campaignId: FOUNDING } }));
check("campaign: anonymous read is refused (401/403)", campAnon.statusCode === 401 || campAnon.statusCode === 403, `got ${campAnon.statusCode}`);

// ---- Store list reads failing: degrade, never hang/500 ----
console.log("(the guard errors logged below are the expected degradation path)");
const boom = async () => { throw new Error("simulated store list failure (verify-admintabs)"); };
store.list = boom;
store.listKeys = boom;
store.getMany = boom;

const evDown = await handler(evt("GET", "/api/admin/events", { cookie }));
const evDownData = parse(evDown);
check("events: list failure degrades to 200 + empty + degraded flag",
  evDown.statusCode === 200 && !!evDownData && evDownData.degraded === true && Array.isArray(evDownData.events) && evDownData.events.length === 0 && evDownData.total === 0,
  `got ${evDown.statusCode}: ${evDown.body}`);

const campDown = await handler(evt("GET", "/api/admin/campaign", { cookie, query: { campaignId: FOUNDING } }));
const campDownData = parse(campDown);
check("campaign: list failure degrades to 200 + zeroed + degraded flag",
  campDown.statusCode === 200 && !!campDownData && campDownData.degraded === true && campDownData.counts.total === 0 && campDownData.campaign.id === FOUNDING && Array.isArray(campDownData.recentSends) && campDownData.recentSends.length === 0,
  `got ${campDown.statusCode}: ${campDown.body}`);

console.log(`\nverify-admintabs: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log("failures:", failures.join(" | "));
  process.exit(1);
}
