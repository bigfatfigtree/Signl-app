#!/usr/bin/env node
// verify-verifykey — the read-only checker key (Build -131 add,
// Jeff 2026-11-05). The daily data-accuracy job compares LIVE
// platform numbers through GET /api/verify/counts, gated by a
// dedicated token (server env SIGNL_VERIFY_TOKEN, presented as
// the x-signl-verify-token header). This script proves the
// key's whole contract against fixture servers:
//
//   * no token -> 401 · wrong token -> 401 · the endpoint is
//     GET-only (POST with the token -> 404)
//   * the token env UNSET on the server fails closed (401 even
//     with a token presented)
//   * with the token: 200, aggregates only, and the surface
//     computation agrees with the endpoint's independent
//     recount — checked field by field against hand-computed
//     fixture truth (tester record excluded everywhere)
//   * the response leaks nothing record-level (no ids, emails,
//     handles or names in the payload)
//   * THE TOKEN OPENS NOTHING ELSE: presented to a mutation
//     route (POST /api/admin/review), an unrelated admin route
//     (GET /api/admin/applications) and a session-only admin
//     aggregate (GET /api/admin/platform-totals), it is refused
//     everywhere.
//
// RUN: node scripts/verify-verifykey.mjs
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const TOKEN = "vk-fixture-token-0123456789abcdef";
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; failures.push(name); console.log("  FAIL  " + name + (extra !== undefined ? " :: " + JSON.stringify(extra).slice(0, 200) : "")); }
}

// ---------- fixtures (hand-computed truth in the comments) ----------
// ada: approved, Richmond home, stack 3,000 + 1,000 = 4,000,
//   50% home share, +20% Nashville listing.
// bea: pending, Richmond home, stack 1,000, 100% home share.
// tess: approved TESTER, Richmond, 999,999 — excluded everywhere.
// Totals (signed-up = ada + bea): signedUp 2 · followers 5,000 ·
// local 2,000 + 1,000 = 3,000 · avg % (50 + 100) / 2 = 75 (n=2).
// Richmond: approved 1 · pending 1 · listed 1 · combined 4,000 ·
// local 3,000 · avg 75 (n=2).
// Nashville: listed 1 · combined 4,000 · local 800 · avg 20 (n=1).
const salt = "vkfixturesalt";
const hash = crypto.scryptSync("fixture-pass-vk", salt, 64).toString("hex");
function rec(id, email, handle, over = {}) {
  return {
    id, role: "creator", email, name: "VK " + handle, passwordSalt: salt, passwordHash: hash,
    status: "pending", market: "Richmond", city: "Richmond",
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    creator: { handle, primaryPlatform: "instagram", categories: ["Food & Drink"], tierBand: "Locals", profileComplete: true, ...(over.creator || {}) },
    ...(over.top || {}),
  };
}
const users = [
  rec("vk-ada", "ada@fixtures.dev", "vkada", { top: { status: "approved" }, creator: { followerCount: 3000, audienceStack: { instagram: 3000, tiktok: 1000 }, localAudiencePct: 50, audienceMarkets: [{ market: "Nashville", pct: 20 }] } }),
  rec("vk-bea", "bea@fixtures.dev", "vkbea", { creator: { followerCount: 1000, audienceStack: { instagram: 1000 }, localAudiencePct: 100 } }),
  rec("vk-tess", "tess@fixtures.dev", "vktess", { top: { status: "approved", tester: true }, creator: { followerCount: 999999, audienceStack: { instagram: 999999 }, localAudiencePct: 99 } }),
];

async function boot(port, withToken) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-vk-"));
  const dbFile = path.join(tmp, "db.json");
  const data = {};
  for (const u of users) { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; }
  fs.writeFileSync(dbFile, JSON.stringify(data));
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL: "vk@signl.test", ADMIN_PASSWORD: "verify-vk-admin-pass" };
  if (withToken) env.SIGNL_VERIFY_TOKEN = TOKEN; else delete env.SIGNL_VERIFY_TOKEN;
  const server = spawn("node", ["scripts/dev-server.mjs", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { const r = await fetch(base + "/api/bootstrap"); if (r.ok) up = true; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!up) throw new Error("fixture server did not come up on " + port);
  return { server, base };
}
async function req(base, method, p, headers = {}, body) {
  const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch (e) { /* non-json */ }
  return { status: r.status, data, text };
}

// ---------- boot A: token configured ----------
{
  const { server, base } = await boot(8947, true);
  try {
    const noTok = await req(base, "GET", "/api/verify/counts");
    check("no token -> 401", noTok.status === 401, noTok.status);
    const flipped = TOKEN.slice(0, -1) + (TOKEN.endsWith("0") ? "1" : "0");
    const wrong = await req(base, "GET", "/api/verify/counts", { "x-signl-verify-token": flipped });
    check("wrong token -> 401", wrong.status === 401, wrong.status);
    const post = await req(base, "POST", "/api/verify/counts", { "x-signl-verify-token": TOKEN }, {});
    check("POST with the token -> 404 (GET-only)", post.status === 404, post.status);
    const ok = await req(base, "GET", "/api/verify/counts", { "x-signl-verify-token": TOKEN });
    check("correct token -> 200", ok.status === 200, ok.status);
    const d = ok.data || {};
    check("endpoint reports surface == recount (agree)", d.agree === true, d.agree);
    const t = d.totals || {};
    check("totals.creatorsSignedUp = 2 (tester + rejected excluded)", t.creatorsSignedUp === 2, t);
    check("totals.totalFollowers = 5,000", t.totalFollowers === 5000, t);
    check("totals.localFollowers = 3,000", t.localFollowers === 3000, t);
    check("totals.avgLocalPct = 75", t.avgLocalPct === 75, t);
    check("all 45 markets present", Array.isArray(d.markets) && d.markets.length === 45, (d.markets || []).length);
    const rich = (d.markets || []).find((m) => m.name === "Richmond") || {};
    check("Richmond row = approved 1 · pending 1 · listed 1 · combined 4,000 · local 3,000 · avg 75",
      rich.creatorsApproved === 1 && rich.creatorsPending === 1 && rich.creatorsListed === 1 && rich.combinedFollowers === 4000 && rich.localFollowers === 3000 && rich.avgLocalPct === 75, rich);
    const nash = (d.markets || []).find((m) => m.name === "Nashville") || {};
    check("Nashville row = listed 1 · combined 4,000 · local 800 · avg 20",
      nash.creatorsListed === 1 && nash.combinedFollowers === 4000 && nash.localFollowers === 800 && nash.avgLocalPct === 20, nash);
    check("recount side independently lands on the same truth", !!(d.recount && d.recount.totals && d.recount.totals.creatorsSignedUp === 2 && d.recount.totals.totalFollowers === 5000 && d.recount.totals.localFollowers === 3000), (d.recount || {}).totals);
    check("payload leaks no record-level data", !/fixtures\.dev|vk-ada|vkada|VK vk/.test(ok.text), ok.text.slice(0, 120));
    const mut = await req(base, "POST", "/api/admin/review", { "x-signl-verify-token": TOKEN }, { userId: "vk-bea", decision: "approve" });
    check("token cannot mutate (POST /api/admin/review refused)", mut.status === 401 || mut.status === 403, mut.status);
    const apps = await req(base, "GET", "/api/admin/applications", { "x-signl-verify-token": TOKEN });
    check("token opens no unrelated admin route (GET /api/admin/applications refused)", apps.status === 401 || apps.status === 403, apps.status);
    const pt = await req(base, "GET", "/api/admin/platform-totals", { "x-signl-verify-token": TOKEN });
    check("token does not unlock session-only admin aggregates (platform-totals refused)", pt.status === 401 || pt.status === 403, pt.status);
    const after = await req(base, "GET", "/api/verify/counts", { "x-signl-verify-token": TOKEN });
    const richAfter = ((after.data || {}).markets || []).find((m) => m.name === "Richmond") || {};
    check("the refused mutation changed nothing (Richmond approved still 1, bea not approved)", richAfter.creatorsApproved === 1 && richAfter.creatorsPending === 1, richAfter);
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ---------- boot B: token env unset -> fail closed ----------
{
  const { server, base } = await boot(8948, false);
  try {
    const r = await req(base, "GET", "/api/verify/counts", { "x-signl-verify-token": TOKEN });
    check("server without SIGNL_VERIFY_TOKEN refuses even a presented token (fail closed)", r.status === 401, r.status);
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 400));
  }
}

console.log(`\nverify-verifykey: ${failed ? failed + " FAILURE(S) — " + failures.join("; ") : "ALL PASS"} (${passed} passed)`);
process.exit(failed ? 1 : 0);
