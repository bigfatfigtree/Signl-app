#!/usr/bin/env node
// QA seed for Build -31 visual checks: boots the dev server on
// QA_PORT with a temp store, creates the band/tier fixtures,
// and leaves the server running until killed. Prints the URLs.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.env.QA_PORT || "8951";
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "qa-admin-pass-31";
const DB = path.join(os.tmpdir(), `signl-qa-build31.json`);
try { fs.unlinkSync(DB); } catch (e) {}
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

function client() {
  const jar = new Map();
  return async (method, p, body) => {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const text = await res.text();
    try { return { status: res.status, data: JSON.parse(text) }; } catch (e) { return { status: res.status, data: { raw: text } }; }
  };
}

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: ROOT,
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
process.on("SIGTERM", () => server.kill("SIGTERM"));

for (let i = 0; i < 60; i++) {
  try { const r = await fetch(BASE + "/api/bootstrap"); if (r.ok) break; } catch (e) {}
  await new Promise((r) => setTimeout(r, 250));
}
const admin = client();
await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

async function makeCreator({ name, email, handle, followers, localPct, categories, patch }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle, followerCount: followers, localAudiencePct: localPct, categories,
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  if (patch) await c("PATCH", "/api/me/profile", patch);
  await c("GET", "/api/me/founding");
  return { client: c, id: reg.data.user.id };
}

const nina = await makeCreator({ name: "Nina Flores", email: "nina@fixtures.dev", handle: "nearnina", followers: 3000, localPct: 88, categories: ["Food & Drink"], patch: { zip: "23219", neighborhood: "Downtown", paidRate: 150, publicPage: true, pageTheme: "mint", bio: "Richmond food first. I post the meals I would drive across town for, and the rooms I keep going back to.", featuredPosts: ["https://www.instagram.com/p/ABC123xyz/"] } });
await makeCreator({ name: "Tom Okafor", email: "tom@fixtures.dev", handle: "twotom", followers: 2400, localPct: 70, categories: ["Food & Drink"], patch: { zip: "23220", publicPage: true } });
await makeCreator({ name: "Fay Lindqvist", email: "fay@fixtures.dev", handle: "fivefay", followers: 1800, localPct: 65, categories: ["Fitness & Wellness"], patch: { zip: "23221", publicPage: true } });
await makeCreator({ name: "Fred Amara", email: "fred@fixtures.dev", handle: "farfred", followers: 5200, localPct: 60, categories: ["Food & Drink"], patch: { zip: "23060", publicPage: true } });

const biz = client();
const reg = await biz("POST", "/api/auth/register", {
  role: "business", name: "Owner Bowl Bistro", businessName: "Bowl Bistro", email: "bowl@fixtures.dev",
  password: "business-pass-123", market: "Richmond", city: "Richmond", category: "Restaurant", planId: "growth",
  neighborhood: "Downtown", about: "", agreedTerms: true,
});
await biz("PATCH", "/api/me/profile", { zip: "23219" });

console.log(JSON.stringify({ base: BASE, bookMe: `${BASE}/c/nearnina`, bizEmail: "bowl@fixtures.dev", bizPassword: "business-pass-123", creatorEmail: "nina@fixtures.dev", creatorPassword: "creator-pass-123", db: DB }));
setInterval(() => {}, 60000);
