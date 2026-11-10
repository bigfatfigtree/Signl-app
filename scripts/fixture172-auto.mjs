// fixture172-auto.mjs — companion to verify-build172: the
// auto-decision path (Build -172, battery item d). Two pending
// creators, both evidence-matched Rule A pairs from the claim
// harvest (the same pairs verify-min500 proves with), both at
// a known total of 300:
//   OVR — carries a minimumOverride (the stored state after an
//     admin sets one on an auto-held record). The one-time
//     auto-decision cleanup re-runs decisions on pending
//     records; the overridden record must be APPROVED by it,
//     never re-held.
//   CTL — no override. The cleanup must keep it held: still
//     pending, underMinimum intact, no approval.
// Prints one "AUTO172 {json}" line for the parent script.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build172-auto-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "<MASKED_SECRET_004>";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
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

function seedCreator(id, { email, handle, market, city, extra = {} }) {
  return {
    id, role: "creator", email, name: "Auto Fixture", passwordSalt: "seed", passwordHash: "seed",
    status: "pending", tester: false, market, city, state: null, country: "United States",
    createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z",
    reviewedAt: null, reviewedBy: null,
    termsVersion: "2026-10-19", termsAcceptedAt: "2026-11-08T00:00:00.000Z", marketingEmailConsent: false, marketingConsentAt: null,
    signupPath: "full", signupSource: null, referredBy: null,
    creator: {
      handle, primaryPlatform: "instagram", instagramUrl: `https://www.instagram.com/${handle}/`,
      followerCount: 300, audienceStack: { instagram: 300 }, totalAudience: 300, avgViews: 0,
      categories: ["Food & Drink"], compCategories: [], openToPaidCampaigns: false, compOpen: true, paidRate: 200,
      bio: "Auto-decision fixture creator.", bestWork: [], maxVisitsPerWeek: 3, neighborhood: "",
      localAudiencePct: 55, localAudienceSource: "Self-reported",
      profileComplete: false, profileCompletedAt: null, publicPage: true,
    },
    business: null,
    underMinimum: { total: 300, since: "2026-11-08T00:05:00.000Z", rule: "manual_review" },
    ...extra,
  };
}

const OVR = "auto-ovr-172";
const CTL = "auto-ctl-172";
await store.set(`user:${OVR}`, seedCreator(OVR, {
  email: "xoxoerinsmith@gmail.com", handle: "xoxoerinsmith", market: "Richmond", city: "Richmond",
  extra: { minimumOverride: { by: "fixture-admin", at: "2026-11-09T00:00:00.000Z", reason: "Stored count is wrong; verified audience is larger." } },
}));
await store.set(`user:${CTL}`, seedCreator(CTL, {
  email: "919eats@gmail.com", handle: "919eats", market: "Raleigh", city: "Raleigh",
}));

const admin = makeClient();
const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
// Any routed request runs the one-time cleanup first; read the
// applications queue too so the pass has fully landed.
await admin("GET", "/api/admin/applications");

async function eventsOf(type, subjectId) {
  const r = await admin("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=500`);
  return ((r.data && r.data.events) || []).filter((e) => e.subjectId === subjectId);
}
const ovr = await store.get(`user:${OVR}`);
const ctl = await store.get(`user:${CTL}`);
console.log("AUTO172 " + JSON.stringify({
  loginStatus: login.status,
  ovr: ovr ? { status: ovr.status, approvedBy: ovr.approvedBy || null, hasUnderMinimum: !!ovr.underMinimum, hasOverride: !!ovr.minimumOverride } : null,
  ctl: ctl ? { status: ctl.status, hasUnderMinimum: !!ctl.underMinimum, underTotal: ctl.underMinimum ? ctl.underMinimum.total : null } : null,
  ovrApprovedEvents: (await eventsOf("application_approved", OVR)).length,
  ovrHeldEvents: (await eventsOf("application_held_under_minimum", OVR)).length,
  ctlApprovedEvents: (await eventsOf("application_approved", CTL)).length,
  ctlHeldEvents: (await eventsOf("application_held_under_minimum", CTL)).length,
}));
