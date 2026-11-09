// fixture169-variant.mjs — companion to verify-build169: the
// name-variant case. The admin's own creator profile carries
// the name in a sloppy variant — lowercase, doubled internal
// spaces ("jeff  rimmer") — that the -165 normalizer (trim +
// lowercase only) can never match. The -165 stamp is
// pre-spent, so only the -169 pass, whose normalizer also
// collapses internal whitespace, can find and mark it. The
// profile owns the self-test thread (the team wrote in, his
// word is last), so it must end badgeless.
// Prints one "VARIANT169 {json}" line for the parent script.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build169-variant-${Date.now()}.json`);
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
if (login.status !== 200) { console.log("VARIANT169 " + JSON.stringify({ error: "admin login failed: " + login.status })); process.exit(0); }

await store.set("config:staffMarks165", { done: true, at: "2026-11-09T18:00:00.000Z", marked: 0 });

const PEER = "signl-team";
const ID = "variant-jeff-169";
const threadIdFor = (id) => [String(id), PEER].sort().join("__");
await store.set(`user:${ID}`, {
  id: ID, role: "creator", name: "jeff  rimmer", email: "jeff-personal@fixtures.dev", market: "Hampton Roads",
  status: "approved", creator: { handle: "brojaysimpson" }, createdAt: "2026-10-18T00:00:00.000Z",
});
await store.set(`message:variant-1`, { id: "variant-1", threadId: threadIdFor(ID), fromId: PEER, toId: ID, body: "Quick news, the good kind: SIGNL is now Magpie.", platform: true, createdAt: "2026-11-07T19:51:00.000Z" });
await store.set(`message:variant-2`, { id: "variant-2", threadId: threadIdFor(ID), fromId: ID, toId: PEER, body: "awesome - thats exciting", platform: true, createdAt: "2026-11-07T19:55:00.000Z" });

const overview = (await admin("GET", "/api/admin/platform-messages")).data;
const t = (overview.threads || []).find((x) => x.peerId === ID);
const rec = await store.get(`user:${ID}`);
console.log("VARIANT169 " + JSON.stringify({
  isStaff: rec ? rec.isStaff : null,
  marked169: !!(rec && rec.staffMarked169),
  listed: !!t, staffOwned: t ? t.staffOwned : null, needsReply: t ? t.needsReply : null,
}));
