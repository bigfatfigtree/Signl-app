// fixture173-marketfix-none.mjs — companion to
// verify-build173: the re-file loader on a store where NONE
// of the 88 listed handles holds an account (the shape
// production may well be in if the whole cohort bounced off
// the broken claim screen). The pass must report listed 88,
// accountsFound 0, noAccount 88, moved 0 — and change nothing.
// Prints one "MARKETFIXNONE173 {json}" line for the parent.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build173-marketfix-none-${Date.now()}.json`);
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

// One unrelated Virginia Beach creator: not on the list.
await store.set("user:fix173-none-e", {
  id: "fix173-none-e", role: "creator", email: "none@fixtures.dev", name: "Unrelated VB", passwordSalt: "seed", passwordHash: "seed",
  status: "pending", tester: false, market: "Virginia Beach", city: "Virginia Beach", state: null, country: "United States",
  createdAt: "2026-11-08T20:00:00.000Z", updatedAt: "2026-11-08T20:00:00.000Z",
  creator: { handle: "unrelatedvb", primaryPlatform: "instagram", followerCount: 900, audienceStack: { instagram: 900 }, totalAudience: 900, categories: ["Food & Drink"], profileComplete: false },
  business: null,
});

const admin = makeClient();
const anon = makeClient();
const VT = { headers: { "x-signl-verify-token": "fixture-verify-token-173" } };
await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
await admin("GET", "/api/admin/applications");
const vc = await anon("GET", "/api/verify/counts", null, VT);
const mf = vc.data ? vc.data.marketfix : null;
const e = await store.get("user:fix173-none-e");
console.log("MARKETFIXNONE173 " + JSON.stringify({
  marketfix: mf ? { listed: mf.listed, accountsFound: mf.accountsFound, moved: mf.moved, noAccount: mf.noAccount, records: (mf.records || []).length } : null,
  flag: await store.get("config:marketFix173"),
  bystander: e ? { market: e.market, updatedAt: e.updatedAt } : null,
}));
