// fixture169-ambiguous.mjs — companion to verify-build169:
// the -169 staff rule's ambiguity guard, in a SEPARATE
// process + store so both one-shot stamps start unset.
// Two creator profiles carry the admin's exact name; BOTH own
// a platform thread the team has written in; BOTH were created
// at the same moment. Every ranking key ties, so the loader
// must mark NEITHER (it never guesses) — and the diagnostic
// must say the word: ambiguous.
// Prints one "AMB169 {json}" line for the parent script.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build169-amb-${Date.now()}.json`);
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
if (login.status !== 200) { console.log("AMB169 " + JSON.stringify({ error: "admin login failed: " + login.status })); process.exit(0); }

const PEER = "signl-team";
const threadIdFor = (id) => [String(id), PEER].sort().join("__");
async function seedCreator(id, email) {
  await store.set(`user:${id}`, {
    id, role: "creator", name: "Jeff Rimmer", email, market: "Hampton Roads",
    status: "approved", creator: { handle: id }, createdAt: "2026-10-18T00:00:00.000Z",
  });
  await store.set(`message:amb-${id}-1`, { id: `amb-${id}-1`, threadId: threadIdFor(id), fromId: PEER, toId: id, body: "Quick news, the good kind: SIGNL is now Magpie.", platform: true, createdAt: "2026-11-07T19:51:00.000Z" });
  await store.set(`message:amb-${id}-2`, { id: `amb-${id}-2`, threadId: threadIdFor(id), fromId: id, toId: PEER, body: "awesome - thats exciting", platform: true, createdAt: "2026-11-07T19:55:00.000Z" });
}
await seedCreator("amb-one-169", "amb-one@fixtures.dev");
await seedCreator("amb-two-169", "amb-two@fixtures.dev");

const overview = (await admin("GET", "/api/admin/platform-messages")).data;
const threadOf = (id) => (overview.threads || []).find((t) => t.peerId === id);
const out = {};
for (const id of ["amb-one-169", "amb-two-169"]) {
  const rec = await store.get(`user:${id}`);
  const t = threadOf(id);
  out[id === "amb-one-169" ? "r1" : "r2"] = { isStaff: rec ? rec.isStaff : null, needsReply: t ? t.needsReply : null, listed: !!t };
}
const vc = await anon("GET", "/api/verify/counts", null, { headers: { "x-signl-verify-token": "fixture-verify-token-169" } });
out.diag = vc.data && vc.data.staff ? {
  ambiguous: vc.data.staff.ambiguous, markedId: vc.data.staff.markedId,
  candidates: (vc.data.staff.candidates || []).length,
  whys: (vc.data.staff.candidates || []).map((c) => c.why),
} : null;
console.log("AMB169 " + JSON.stringify(out));
