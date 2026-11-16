// Build -176 perf harness: the claim submit path, timed against
// a production-SHAPED local store with simulated Blobs latency.
//
// Why simulated latency: locally the store is one JSON file in
// memory, so raw timings would read ~0 and prove nothing. The
// production store (Netlify Blobs) pays one HTTPS round trip
// per record fetch, fetched at concurrency 12 (store.js
// fetchValues). This harness preloads a Module._load shim into
// the dev server that charges the store's methods accordingly:
//   get/set/del : PER_GET_MS each
//   list        : 10ms key page + ceil(rows/12) * PER_GET_MS
//   getMany     : ceil(keys/12) * PER_GET_MS
//   listKeys    : 10ms
// PER_GET_MS defaults to 35 (same-region Blobs round trip).
// SMTP is stubbed (SIGNL_MAIL_STUB=1), so the confirmation
// email's real SMTP cost (~1-3s in production) is EXCLUDED
// from both runs — it is a constant this build does not touch.
//
// Walk (one fresh creator, Amsterdam — Jeff's test-claim shape):
//   1. POST /auth/register (quickClaim)
//   2. PATCH /me/profile (the four facts)
//   3. POST /neighbor/claim-complete
//   4. GET /auth/me (dashboard boot payload)
// Prints per-step ms + store op counts, and totals.
// Run: node scripts/qa-build176-perf.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9176;
const BASE = `http://127.0.0.1:${PORT}`;
const PER_GET_MS = Number(process.env.PERF_GET_MS || 35);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-176-perf-"));
const DB = path.join(tmp, "db.json");
const COUNT_FILE = path.join(tmp, "counts.json");
const SHIM = path.join(tmp, "shim.cjs");

// ---------- seed: production-shaped ----------
const salt = crypto.randomBytes(16).toString("hex");
const hash = (pw) => crypto.scryptSync(pw, salt, 64).toString("hex");
const now = new Date().toISOString();
const data = {};
const CATS = ["Food & Drink", "Nightlife", "Beauty & Grooming", "Fitness & Wellness", "Health & Wellness", "Retail & Shopping", "Attractions & Events", "Local Services", "Lifestyle", "Sports", "Music", "Other"];
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "admin1", role: "admin", email: "admin@qa.dev", name: "QA Admin", passwordSalt: salt, passwordHash: hash("qa-admin-pass"), status: "approved", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: now });
let seq = 0;
const creator = (market, n, followers, pct, status = "approved") => {
  seq += 1;
  putUser({ id: `cr${seq}`, role: "creator", email: `c${seq}@qa.dev`, name: `Creator ${seq}`, passwordSalt: salt, passwordHash: hash("qa-creator-pass"), status, market, city: market, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: now, tester: false,
    creator: { handle: `creator${seq}`, primaryPlatform: "instagram", categories: CATS.slice(0, 6), compCategories: [], audienceStack: { instagram: followers }, followerCount: followers, totalAudience: followers, localAudiencePct: pct, profileComplete: true, hasPhoto: false, paidRate: 150, bio: "seeded" } });
};
for (let i = 0; i < 150; i++) creator("Nashville", 150, 1000 + i * 137, 20 + (i % 60));
for (let i = 0; i < 19; i++) creator("Amsterdam", 20, 2000 + i * 900, 5 + (i % 30));
creator("Amsterdam", 21, 500000, 8); // the big checked neighbour in Jeff's screenshot market
for (let i = 0; i < 150; i++) creator(["Virginia Beach", "Austin", "Richmond", "Raleigh"][i % 4], 170, 800 + i * 211, 15 + (i % 70));
for (let i = 0; i < 40; i++) creator("Nashville", 340, 500 + i * 31, 25, "pending");
for (let i = 0; i < 60; i++) { seq += 1; putUser({ id: `bz${seq}`, role: "business", email: `b${seq}@qa.dev`, name: `Biz ${seq}`, passwordSalt: salt, passwordHash: hash("qa-biz-pass"), status: "approved", market: "Nashville", city: "Nashville", createdAt: "2026-10-05T00:00:00.000Z", updatedAt: now, tester: false, business: { businessName: `Biz ${seq}`, category: "Food & Drink", plan: "self-service", hasPhoto: false } }); }
for (let i = 0; i < 1200; i++) {
  data[`prospect:p${i}`] = { id: `p${i}`, handle: `prospect${i}`, marketName: i % 3 ? "Nashville" : "Amsterdam", status: "to_contact", followers: 1000 + i * 17, followersPlatform: "instagram", localPct: i % 4 ? 10 + (i % 50) : null, createdAt: now, updatedAt: now };
}
for (let i = 0; i < 300; i++) data[`outprospect:o${i}`] = { id: `o${i}`, handle: `outside${i}`, markets: ["Nashville"], followers: 900 + i * 23, followersPlatform: "instagram", localPct: 12 + (i % 40) };
for (let i = 0; i < 1600; i++) data[`campaign-recipient:camp1:rcpt${i}@qa.dev`] = { handle: `rcpt${i}`, email: `rcpt${i}@qa.dev`, market: "Nashville", status: "sent" };
for (let i = 0; i < 5; i++) data[`deal:d${i}`] = { id: `d${i}`, partnerId: `partner${i}`, market: "Nashville", scope: "sourced", status: "live" };
data["config:markets"] = { flags: { Nashville: true } };
fs.writeFileSync(DB, JSON.stringify(data));
const seedCounts = {};
for (const k of Object.keys(data)) { const p = k.split(":")[0]; seedCounts[p] = (seedCounts[p] || 0) + 1; }
console.log("seeded store:", JSON.stringify(seedCounts));

// ---------- latency + counting shim ----------
fs.writeFileSync(SHIM, `
const Module = require("module");
const fs = require("fs");
const path = require("path");
const PER_GET = ${PER_GET_MS};
const CONC = 12;
const counts = { get: 0, set: 0, del: 0, list: 0, listKeys: 0, getMany: 0, listRows: 0, getManyKeys: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const origLoad = Module._load;
let wrapped = null;
Module._load = function (request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { /* not resolvable */ }
  const isStore = !!resolved && resolved.endsWith(path.join("lib", "store.js"));
  if (isStore && wrapped) return wrapped;
  const out = origLoad.apply(this, arguments);
  if (isStore && out && !out.__perfWrapped) {
    const w = Object.create(out);
    w.get = async (k) => { counts.get++; await sleep(PER_GET); return out.get(k); };
    w.set = async (k, v) => { counts.set++; await sleep(PER_GET); return out.set(k, v); };
    w.del = async (k) => { counts.del++; await sleep(PER_GET); return out.del(k); };
    w.listKeys = async (p) => { counts.listKeys++; await sleep(10); return out.listKeys(p); };
    w.getMany = async (keys) => { counts.getMany++; counts.getManyKeys += keys.length; await sleep(Math.ceil(keys.length / CONC) * PER_GET); return out.getMany(keys); };
    w.list = async (p) => { counts.list++; const rows = await out.list(p); counts.listRows += rows.length; await sleep(10 + Math.ceil(rows.length / CONC) * PER_GET); return rows; };
    w.__perfWrapped = true;
    wrapped = w;
    return w;
  }
  return out;
};
setInterval(() => { try { fs.writeFileSync(${JSON.stringify(COUNT_FILE)}, JSON.stringify(counts)); } catch (e) {} }, 200);
`);

// ---------- server ----------
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL: "admin@qa.dev", ADMIN_PASSWORD: "<redacted>", NODE_OPTIONS: `--require ${SHIM}` };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "SIG_AI_API_KEY", "SIG_AI_BASE_URL", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MAGGIE_AI_ENABLED"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: ROOT, env, stdio: "ignore" });

const jar = new Map();
const api = (p) => "/api" + p;
async function call(method, p, body) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of sc) { const pair = c.split(";")[0]; const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* keep null */ }
  return { status: res.status, json };
}
const readCounts = () => { try { return JSON.parse(fs.readFileSync(COUNT_FILE, "utf8")); } catch (e) { return { get: 0, set: 0, del: 0, list: 0, listKeys: 0, getMany: 0, listRows: 0, getManyKeys: 0 }; } };
const diffCounts = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, (b[k] || 0) - (a[k] || 0)]));

try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + "/api/boot"); if (r.status < 500) break; } catch (e) { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }
  const steps = [];
  const run = async (name, fn) => {
    const c0 = readCounts(); const t0 = Date.now();
    const out = await fn();
    const ms = Date.now() - t0; const dc = diffCounts(c0, readCounts());
    steps.push({ name, ms, status: out.status, ops: dc });
    console.log(`${name}: ${ms} ms (HTTP ${out.status}) ops=${JSON.stringify(dc)}`);
    return out;
  };
  const reg = await run("1 POST /auth/register (quickClaim, Amsterdam)", () => call("POST", api("/auth/register"), { role: "creator", quickClaim: true, email: "perfclaim176@qa.dev", password: "<redacted>", market: "Amsterdam", handle: "perfclaim176", primaryPlatform: "instagram", agreedTerms: true }));
  if (reg.status !== 201) { console.log("register failed:", JSON.stringify(reg.json).slice(0, 300)); process.exitCode = 1; throw new Error("register failed"); }
  await run("2 PATCH /me/profile (four facts)", () => call("PATCH", api("/me/profile"), { categories: CATS, localAudiencePct: 8, audienceStack: { instagram: 540000 }, city: "Amsterdam" }));
  const cc = await run("3 POST /neighbor/claim-complete", () => call("POST", api("/neighbor/claim-complete"), { variant: "generic" }));
  console.log("   claim-complete neighbor:", JSON.stringify(cc.json && cc.json.neighbor));
  await run("4 GET /auth/me (dashboard boot)", () => call("GET", api("/auth/me")));
  const total = steps.reduce((s, x) => s + x.ms, 0);
  const submitTotal = steps.slice(0, 3).reduce((s, x) => s + x.ms, 0);
  console.log(`\nTOTAL submit (steps 1-3): ${submitTotal} ms | submit + dashboard boot: ${total} ms | modeled at ${PER_GET_MS} ms/get, concurrency 12, SMTP excluded`);
} finally {
  server.kill();
}
