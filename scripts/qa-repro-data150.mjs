// Build -150 reproduction: seed a fixture store, pour the REAL
// -147 production import items (1,346) through the real import
// endpoint, run the conversion join + snapshot sweep, then load
// the Admin Data payload and report what happens.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = fs.mkdtempSync("/tmp/signl-repro150-") + "/db.json";
const SEED_PW = "verify-outside-pass";
const SEED_SALT = "verifyoutsidesalt";
const SEED_HASH = crypto.scryptSync(SEED_PW, SEED_SALT, 64).toString("hex");
const SWEEP = "proof-sweep-token";

function creatorSeed(id, email, name, handle, market, createdAt) {
  return {
    id, role: "creator", email, name, passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: "approved", market, city: market, state: "TN", createdAt, updatedAt: createdAt, tester: false,
    creator: { handle, platform: "Instagram", handleNormalized: handle.toLowerCase(), city: market, state: "TN", categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", audienceStack: { instagram: 9000 }, totalAudience: 9000, followerCount: 9000, localAudiencePct: 75, paidRate: 150, compOpen: true, couponOpen: true, profileComplete: true, publicPage: true, bio: `${name}, daily.` },
  };
}
{
  const seed = {};
  seed["config:markets"] = { flags: { Nashville: true, Austin: true } };
  // Join matches (real handles/emails from the production send map):
  seed["user:cradriana"] = creatorSeed("cradriana", "teamadriana@thesociablesociety.com", "Adriana Mejia", "adrianamejiamakeup", "Nashville", "2026-11-06T00:00:00.000Z");
  seed["email:teamadriana@thesociablesociety.com"] = { userId: "cradriana" };
  seed["user:crzara"] = creatorSeed("crzara", "zara-creator@fixtures.dev", "Zara M", "zara_mcdermott", "London", "2026-11-07T00:00:00.000Z");
  seed["email:zara-creator@fixtures.dev"] = { userId: "crzara" };
  fs.writeFileSync(DB, JSON.stringify(seed));
}

function client() {
  const jar = new Map();
  return async (method, p, body, hdrs, timeoutMs = 300000) => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "), ...(hdrs || {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
    return { status: res.status, data };
  };
}
async function waitUp() {
  for (let i = 0; i < 80; i++) { try { const r = await fetch(base + "/api/bootstrap"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

const PORT = 8971;
const base = `http://127.0.0.1:${PORT}`;
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: ROOT,
  env: {
    ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL: "jeff@joinsignl.com", ADMIN_PASSWORD: "verify-admin-pass-123", APP_URL: base, SIGNL_TEST_ALLOW_BUSINESS: "1",
    SIGNL_SWEEP_TOKEN: SWEEP,
    SIG_AI_BASE_URL: "", SIG_AI_API_KEY: "", OPENAI_API_KEY: "", OPENAI_BASE_URL: "", OPENROUTER_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "",
    MAGGIE_AI_ENABLED: "", MAGGIE_AI_MODEL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stderr.on("data", (d) => { serverLog += d.toString(); });
server.stdout.on("data", (d) => { serverLog += d.toString(); });

try {
  console.log("boot:", await waitUp());
  const api = client();
  const login = await api("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "verify-admin-pass-123" });
  console.log("admin login:", login.status);

  const itemsFile = JSON.parse(fs.readFileSync(path.join(os.homedir(), "workspace/signl-campaign-run/outside-import-items-2026-11-08.json"), "utf8"));
  const items = itemsFile.items;
  console.log("import items:", items.length);
  const t0 = Date.now();
  const totals = {};
  for (let i = 0; i < items.length; i += 100) {
    const batch = items.slice(i, i + 100);
    const r = await api("POST", "/api/admin/imports/outside", { items: batch }, { "x-signl-sweep-token": SWEEP });
    if (r.status !== 200) { console.log("IMPORT BATCH FAILED at", i, r.status, JSON.stringify(r.data).slice(0, 300)); break; }
    for (const [k, c] of Object.entries(r.data.counts || {})) { totals[k] = totals[k] || { written: 0, skipped: 0 }; totals[k].written += c.written || 0; totals[k].skipped += c.skipped || 0; }
    process.stdout.write(`  batch ${i / 100 + 1} ok (${Date.now() - t0}ms)\n`);
  }
  console.log("import totals:", JSON.stringify(totals), "elapsed", Date.now() - t0, "ms");

  const join = await api("POST", "/api/admin/imports/outside", { items: [], join: true }, { "x-signl-sweep-token": SWEEP });
  console.log("join:", join.status, JSON.stringify(join.data && join.data.join).slice(0, 300));

  const snap = await api("POST", "/api/admin/snapshot/sweep", {}, { "x-signl-sweep-token": SWEEP });
  console.log("snapshot sweep:", snap.status, JSON.stringify(snap.data).slice(0, 200));

  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  const keyCount = {};
  for (const k of Object.keys(db)) { const p = k.split(":")[0]; keyCount[p] = (keyCount[p] || 0) + 1; }
  console.log("store keys by prefix:", JSON.stringify(keyCount));
  console.log("event keys total:", Object.keys(db).filter((k) => k.startsWith("event:")).length);
  console.log("snapshot keys:", Object.keys(db).filter((k) => k.startsWith("snapshot:")));

  serverLog = "";
  const t1 = Date.now();
  const data = await api("GET", "/api/admin/stats/data");
  console.log("GET /api/admin/stats/data ->", data.status, "in", Date.now() - t1, "ms");
  if (data.status !== 200) console.log("body:", JSON.stringify(data.data).slice(0, 300));
  else console.log("payload keys:", Object.keys(data.data).join(", "), "| outside.sends.total:", data.data.outside && data.data.outside.sends && data.data.outside.sends.total, "| training:", JSON.stringify(data.data.training).slice(0, 200));
  await new Promise((r) => setTimeout(r, 500));
  const errAt = serverLog.indexOf("Magpie API error");
  if (errAt >= 0) console.log("\n=== SERVER ERROR ===\n", serverLog.slice(errAt, errAt + 3000));
  else if (serverLog.trim()) console.log("\n=== SERVER LOG (tail) ===\n", serverLog.slice(-1500));
} finally {
  server.kill("SIGKILL");
}
