// fixture172-frank.mjs — companion to verify-build172: the
// Build -172 count-correction loader, stack shape. Frank
// Anthony's record as production carries it: handle
// chicagofoodking, a stored Instagram count of 80, another
// platform key in the stack (150) that must survive untouched,
// total 230 — under the minimum, on hold. After the loader:
// instagram 15327 (the verified count), tiktok still 150,
// total 15477, followerCount mirror 15327, status UNCHANGED
// (Jeff approves him himself). A second trigger changes
// nothing (claimed-flag no-op). A bystander creator with the
// same low count but a different handle is never touched.
// The diagnostic rides /api/verify/counts as `minfix`.
// Prints one "FRANK172 {json}" line for the parent script.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build172-frank-${Date.now()}.json`);
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

function seedCreator(id, { name, email, handle, stack, followerCount, total }) {
  return {
    id, role: "creator", email, name, passwordSalt: "seed", passwordHash: "seed",
    status: "pending", tester: false, market: "Chicago", city: "Chicago", state: null, country: "United States",
    createdAt: "2026-11-07T12:00:00.000Z", updatedAt: "2026-11-07T12:00:00.000Z",
    reviewedAt: null, reviewedBy: null,
    termsVersion: "2026-10-19", termsAcceptedAt: "2026-11-07T12:00:00.000Z", marketingEmailConsent: false, marketingConsentAt: null,
    signupPath: "full", signupSource: null, referredBy: null,
    creator: {
      handle, primaryPlatform: "instagram", instagramUrl: `https://www.instagram.com/${handle}/`,
      followerCount, audienceStack: stack, totalAudience: total, avgViews: 0,
      categories: ["Food & Drink"], compCategories: [], openToPaidCampaigns: false, compOpen: true, paidRate: 200,
      bio: "Loader fixture creator.", bestWork: [], maxVisitsPerWeek: 3, neighborhood: "",
      localAudiencePct: 55, localAudienceSource: "Self-reported",
      profileComplete: false, profileCompletedAt: null, publicPage: true,
    },
    business: null,
  };
}

const FRANK = "frank-172";
const BYSTANDER = "bystander-172";
await store.set(`user:${FRANK}`, seedCreator(FRANK, {
  name: "Frank Anthony", email: "thechicagofoodking@gmail.com", handle: "chicagofoodking",
  stack: { instagram: 80, tiktok: 150 }, followerCount: 80, total: 230,
}));
await store.set(`user:${BYSTANDER}`, seedCreator(BYSTANDER, {
  name: "Other Creator", email: "other@fixtures.dev", handle: "someoneelsechicago",
  stack: { instagram: 80 }, followerCount: 80, total: 80,
}));

const admin = makeClient();
const anon = makeClient();
const VT = { headers: { "x-signl-verify-token": "fixture-verify-token-172" } };
const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
const after1 = await store.get(`user:${FRANK}`);
const aud1 = after1 ? { stack: after1.creator.audienceStack, followerCount: after1.creator.followerCount, totalAudience: after1.creator.totalAudience, status: after1.status, updatedAt: after1.updatedAt } : null;
// Second trigger: the claimed flag makes the loader a no-op.
await admin("GET", "/api/admin/applications");
const after2 = await store.get(`user:${FRANK}`);
const aud2 = after2 ? { stack: after2.creator.audienceStack, followerCount: after2.creator.followerCount, totalAudience: after2.creator.totalAudience, status: after2.status, updatedAt: after2.updatedAt } : null;
const bys = await store.get(`user:${BYSTANDER}`);
const vc = await anon("GET", "/api/verify/counts", null, VT);
const ev = await admin("GET", "/api/admin/events?type=audience_count_corrected&limit=500");
console.log("FRANK172 " + JSON.stringify({
  loginStatus: login.status,
  after1: aud1,
  after2: aud2,
  bystander: bys ? { stack: bys.creator.audienceStack, followerCount: bys.creator.followerCount } : null,
  flag: await store.get("config:minFix172"),
  minfix: vc.data ? vc.data.minfix : null,
  correctionEvents: ((ev.data && ev.data.events) || []).filter((e) => e.subjectId === FRANK).length,
}));
