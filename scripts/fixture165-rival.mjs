// fixture165-rival.mjs — companion to verify-build165:
// the staff loader's ambiguity guard, run in a SEPARATE
// process + store so its one-shot done-stamp starts unset.
// Two creator profiles carry the admin account's exact name
// ("Jeff Rimmer"); neither email matches the admin email.
// The loader must mark NEITHER — it never guesses whose
// profile is the admin's own — so both threads keep flagging
// needs-reply like any genuine creator's.
// Prints one "RIVAL165 {json}" line for the parent script.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build165-rival-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@magpielocal.com";
process.env.ADMIN_PASSWORD = "fixture-admin-165";
process.env.APP_URL = "http://localhost";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");

function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: url.pathname,
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
const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
if (login.status !== 200) { console.log("RIVAL165 " + JSON.stringify({ error: "admin login failed: " + login.status })); process.exit(0); }

const PEER = "signl-team";
const threadIdFor = (id) => [String(id), PEER].sort().join("__");
async function seedCreator(id, email) {
  await store.set(`user:${id}`, {
    id, role: "creator", name: "Jeff Rimmer", email, market: "Virginia Beach",
    status: "approved", creator: { handle: id }, createdAt: "2026-10-18T00:00:00.000Z",
  });
  await store.set(`message:rival-${id}-1`, { id: `rival-${id}-1`, threadId: threadIdFor(id), fromId: PEER, toId: id, body: "Quick news, the good kind: SIGNL is now Magpie.", platform: true, createdAt: "2026-11-07T19:51:00.000Z" });
  await store.set(`message:rival-${id}-2`, { id: `rival-${id}-2`, threadId: threadIdFor(id), fromId: id, toId: PEER, body: "awesome - thats exciting", platform: true, createdAt: "2026-11-07T19:55:00.000Z" });
}
await seedCreator("rival-one-165", "rival-one@fixtures.dev");
await seedCreator("rival-two-165", "rival-two@fixtures.dev");

const overview = (await admin("GET", "/api/admin/platform-messages")).data;
const threadOf = (id) => (overview.threads || []).find((t) => t.peerId === id);
const out = {};
for (const id of ["rival-one-165", "rival-two-165"]) {
  const rec = await store.get(`user:${id}`);
  const t = threadOf(id);
  out[id === "rival-one-165" ? "r1" : "r2"] = { isStaff: rec ? rec.isStaff : null, needsReply: t ? t.needsReply : null, listed: !!t };
}
console.log("RIVAL165 " + JSON.stringify(out));
