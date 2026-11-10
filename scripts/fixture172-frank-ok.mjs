// fixture172-frank-ok.mjs — companion to verify-build172:
// the count-correction loader when there is nothing to fix.
// The @chicagofoodking record already reads 20,000 on
// Instagram: the loader logs "already_ok", writes its
// diagnostic, and changes NOTHING on the record (no stack
// edit, no event).
// Prints one "OK172 {json}" line for the parent script.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build172-ok-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "<MASKED_SECRET_004>";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_VERIFY_TOKEN = "fixture-verify-token-172";
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

const FRANK = "frank-ok-172";
await store.set(`user:${FRANK}`, {
  id: FRANK, role: "creator", email: "thechicagofoodking@gmail.com", name: "Frank Anthony",
  passwordSalt: "seed", passwordHash: "seed",
  status: "pending", tester: false, market: "Chicago", city: "Chicago", state: null, country: "United States",
  createdAt: "2026-11-07T12:00:00.000Z", updatedAt: "2026-11-07T12:00:00.000Z",
  reviewedAt: null, reviewedBy: null,
  termsVersion: "2026-10-19", termsAcceptedAt: "2026-11-07T12:00:00.000Z", marketingEmailConsent: false, marketingConsentAt: null,
  signupPath: "full", signupSource: null, referredBy: null,
  creator: {
    handle: "chicagofoodking", primaryPlatform: "instagram", instagramUrl: "https://www.instagram.com/chicagofoodking/",
    followerCount: 20000, audienceStack: { instagram: 20000 }, totalAudience: 20000, avgViews: 0,
    categories: ["Food & Drink"], compCategories: [], openToPaidCampaigns: false, compOpen: true, paidRate: 200,
    bio: "Loader fixture creator, already fine.", bestWork: [], maxVisitsPerWeek: 3, neighborhood: "",
    localAudiencePct: 55, localAudienceSource: "Self-reported",
    profileComplete: false, profileCompletedAt: null, publicPage: true,
  },
  business: null,
});

const admin = makeClient();
const anon = makeClient();
const VT = { headers: { "x-signl-verify-token": "fixture-verify-token-172" } };
const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
const after = await store.get(`user:${FRANK}`);
const vc = await anon("GET", "/api/verify/counts", null, VT);
const ev = await admin("GET", "/api/admin/events?type=audience_count_corrected&limit=500");
console.log("OK172 " + JSON.stringify({
  loginStatus: login.status,
  after: after ? { stack: after.creator.audienceStack, followerCount: after.creator.followerCount, totalAudience: after.creator.totalAudience, updatedAt: after.updatedAt } : null,
  minfix: vc.data ? vc.data.minfix : null,
  correctionEvents: ((ev.data && ev.data.events) || []).filter((e) => e.subjectId === FRANK).length,
}));
