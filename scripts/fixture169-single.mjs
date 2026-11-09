// fixture169-single.mjs — companion to verify-build169: the
// -169 staff rule's single-candidate arm, isolated. Exactly
// ONE creator profile carries the admin's name and it owns NO
// thread at all. The -165 stamp is pre-spent (marked 0 — the
// production state after -165 ran and marked nobody), so only
// the -169 pass can mark it: a lone same-name profile is the
// admin's own, thread or no thread.
// Prints one "SINGLE169 {json}" line for the parent script.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build169-single-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "fixture-admin-169";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_VERIFY_TOKEN = "fixture-verify-token-169";
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

const admin = makeClient();
const anon = makeClient();
const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
if (login.status !== 200) { console.log("SINGLE169 " + JSON.stringify({ error: "admin login failed: " + login.status })); process.exit(0); }

// Production's spent -165 stamp: it ran, it marked nobody.
await store.set("config:staffMarks165", { done: true, at: "2026-11-09T18:00:00.000Z", marked: 0 });

const ID = "single-jeff-169";
await store.set(`user:${ID}`, {
  id: ID, role: "creator", name: "Jeff Rimmer", email: "jeff-personal@fixtures.dev", market: "Hampton Roads",
  status: "approved", creator: { handle: "brojaysimpson" }, createdAt: "2026-10-18T00:00:00.000Z",
});

await admin("GET", "/api/admin/platform-messages");
const rec = await store.get(`user:${ID}`);
const vc = await anon("GET", "/api/verify/counts", null, { headers: { "x-signl-verify-token": "fixture-verify-token-169" } });
const cand = vc.data && vc.data.staff ? (vc.data.staff.candidates || []).find((c) => c.id === ID) : null;
console.log("SINGLE169 " + JSON.stringify({
  isStaff: rec ? rec.isStaff : null,
  marked169: !!(rec && rec.staffMarked169),
  why: rec && rec.staffMarked169 ? rec.staffMarked169.why : null,
  diagMarkedId: vc.data && vc.data.staff ? vc.data.staff.markedId : null,
  diagWhy: cand ? cand.why : null,
  hasThread: cand ? cand.hasThread : null,
}));
