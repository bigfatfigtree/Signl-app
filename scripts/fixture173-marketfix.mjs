// fixture173-marketfix.mjs — companion to verify-build173:
// the Build -173 mis-filed-market re-file loader. Seeds the
// cohort shapes the production pass will meet:
//   A maketodayahollyday — listed (Raleigh), filed Virginia
//     Beach by the broken claim, no later move → MOVES to
//     Raleigh; status + city untouched.
//   B stephaniecamillee — listed (Dallas), filed Virginia
//     Beach, approved → MOVES to Dallas; status untouched.
//   C ashtyngillespy — listed (Raleigh), filed Virginia
//     Beach, but carries marketChangedAt (she used
//     POST /me/market after registering) → REPORTED as a
//     deliberate move, never moved.
//   D 919eats — listed (Raleigh), already filed Raleigh →
//     already_right, untouched.
//   E someoneelsevb — NOT on the list, filed Virginia Beach
//     → never read for a change; record identical after.
//   F nc.foodbaby ×2 — listed (Raleigh), two records on one
//     handle → ambiguous; neither moves.
//   G lixas_family — listed (Raleigh), filed Virginia Beach,
//     no record stamp, but a market_changed EVENT names her
//     → deliberate move via the event trail, never moved.
// Prints one "MARKETFIX173 {json}" line for the parent script.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build173-marketfix-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "<MASKED_SECRET_004>";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_VERIFY_TOKEN = "fixture-verify-token-173";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");

function makeClient() {
  const jar = new Map();
  return async function api(method, p, body, opts) {
    const headers = { "Content-Type": "application/json", ...((opts && opts.headers) || {}) };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: (opts && opts.rawPath) || url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body),
      isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = res.body; }
    return { status: res.statusCode, data };
  };
}

function seedCreator(id, { handle, market, status = "pending", extra = {} }) {
  return {
    id, role: "creator", email: `${id}@fixtures.dev`, name: handle, passwordSalt: "seed", passwordHash: "seed",
    status, tester: false, market, city: "Virginia Beach", state: null, country: "United States",
    createdAt: "2026-11-08T20:00:00.000Z", updatedAt: "2026-11-08T20:00:00.000Z",
    reviewedAt: null, reviewedBy: null,
    termsVersion: "2026-10-19", termsAcceptedAt: "2026-11-08T20:00:00.000Z", marketingEmailConsent: false, marketingConsentAt: null,
    signupPath: "quick_claim", signupSource: "email", referredBy: null,
    ...extra,
    creator: {
      handle, primaryPlatform: "instagram", instagramUrl: `https://www.instagram.com/${handle}/`,
      followerCount: 1200, audienceStack: { instagram: 1200 }, totalAudience: 1200, avgViews: 0,
      categories: ["Food & Drink"], compCategories: [], openToPaidCampaigns: false, compOpen: true, paidRate: 200,
      bio: "Build -173 loader fixture creator.", bestWork: [], maxVisitsPerWeek: 3, neighborhood: "",
      localAudiencePct: 55, localAudienceSource: "Self-reported",
      profileComplete: false, profileCompletedAt: null, publicPage: true,
    },
    business: null,
  };
}

await store.set("user:fix173-a", seedCreator("fix173-a", { handle: "maketodayahollyday", market: "Virginia Beach" }));
await store.set("user:fix173-b", seedCreator("fix173-b", { handle: "stephaniecamillee", market: "Virginia Beach", status: "approved" }));
await store.set("user:fix173-c", seedCreator("fix173-c", { handle: "ashtyngillespy", market: "Virginia Beach", extra: { marketChangedAt: "2026-11-09T15:50:00.000Z" } }));
await store.set("user:fix173-d", seedCreator("fix173-d", { handle: "919eats", market: "Raleigh" }));
await store.set("user:fix173-e", seedCreator("fix173-e", { handle: "someoneelsevb", market: "Virginia Beach" }));
await store.set("user:fix173-f1", seedCreator("fix173-f1", { handle: "nc.foodbaby", market: "Virginia Beach" }));
await store.set("user:fix173-f2", seedCreator("fix173-f2", { handle: "nc.foodbaby", market: "Virginia Beach" }));
await store.set("user:fix173-g", seedCreator("fix173-g", { handle: "lixas_family", market: "Virginia Beach" }));
// G's deliberate move exists only as an event (the shape
// events.js writes): POST /me/market logged it after she
// registered; the record carries no marketChangedAt stamp.
await store.set("event:2026-11-09:seed173g", {
  id: "seed173g", ts: "2026-11-09T14:00:00.000Z", type: "market_changed",
  actorId: "fix173-g", actorRole: "creator", subjectId: "fix173-g", market: "Virginia Beach",
  data: { from: "Raleigh", to: "Virginia Beach", via: "profile" },
});

const admin = makeClient();
const anon = makeClient();
const VT = { headers: { "x-signl-verify-token": "fixture-verify-token-173" } };
const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
await admin("GET", "/api/admin/applications");
const snap = async (id) => {
  const u = await store.get(`user:${id}`);
  return u ? { market: u.market, status: u.status, city: u.city, updatedAt: u.updatedAt } : null;
};
const after1 = {
  a: await snap("fix173-a"), b: await snap("fix173-b"), c: await snap("fix173-c"),
  d: await snap("fix173-d"), e: await snap("fix173-e"),
  f1: await snap("fix173-f1"), f2: await snap("fix173-f2"), g: await snap("fix173-g"),
};
// Second trigger: the claimed flag makes the loader a no-op.
await admin("GET", "/api/admin/applications");
const a2 = await snap("fix173-a");
const vc = await anon("GET", "/api/verify/counts", null, VT);
const mf = vc.data ? vc.data.marketfix : null;
const ev = await admin("GET", "/api/admin/events?type=market_refiled_173&limit=500");
const refileEvents = ((ev.data && ev.data.events) || []);
console.log("MARKETFIX173 " + JSON.stringify({
  loginStatus: login.status,
  after1,
  aUpdatedAtAfter2: a2 ? a2.updatedAt : null,
  flag: await store.get("config:marketFix173"),
  marketfix: mf ? {
    listed: mf.listed, accountsFound: mf.accountsFound, moved: mf.moved, movedTo: mf.movedTo,
    alreadyRight: mf.alreadyRight, deliberateMove: mf.deliberateMove, ambiguous: mf.ambiguous, noAccount: mf.noAccount,
    actions: Object.fromEntries((mf.records || []).map((r) => [r.handle, r.action])),
  } : null,
  refileCount: refileEvents.length,
  refileSubjects: refileEvents.map((e) => e.subjectId).sort(),
}));
