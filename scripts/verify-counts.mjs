#!/usr/bin/env node
// verify-counts — the permanent count guard (Jeff, 2026-11-05).
//
// Independently recounts ground truth from the raw user records
// and compares it, stat by stat, against what the surfaces
// actually compute and display:
//
//   * platform totals      GET /api/admin/platform-totals
//       creatorsSignedUp · totalFollowers · localFollowers ·
//       avgLocalPct (+ avgLocalCount)
//   * per-market stats     GET /api/admin/markets (all markets)
//       creatorsApproved · creatorsPending · creatorsListed ·
//       combinedFollowers · localFollowers · avgLocalPct
//   * creator-facing numbers (sample): the public Local List's
//       per-market share for a creator, and the business-facing
//       creator card's stacked total + share
//   * business discovery   GET /api/discover (fixture mode) /
//       GET /api/admin/preview/discover (fixture mode, admin
//       preview) — live mode covers the totals/markets parity
//       through the checker endpoint (see RUN below)
//
// Every mismatch prints "FAIL <stat> expected=<truth> actual=
// <surface>" and the run exits non-zero. PASS lines print too,
// so a green run is auditable stat by stat.
//
// THE DEFINITIONS (the recount is written from these words, not
// from the router's code — that independence is the point):
//   * Market matching is CANONICAL: a record stored as
//     "Hampton Roads" or "Tampa, Florida" belongs to Virginia
//     Beach / Tampa (Build -130 Part 5). No stored record is
//     ever rewritten; matching forgives, storage doesn't move.
//   * Stacked total = the sum of the creator's per-platform
//     audience numbers (each floored, capped at 100,000,000);
//     with no stack stored, the headline followerCount is the
//     total.
//   * Signed up = creators with status approved or pending,
//     tester-flagged records excluded. Followers sums each
//     such creator's stacked total ONCE.
//   * A creator is LISTED in their home market always, and in
//     another market when their reported share for it is >= 5%.
//   * % local TO a market = the stated share for that market:
//     localAudiencePct at home, the audienceMarkets entry
//     elsewhere. Unstated = excluded from averages and local
//     sums, never counted as zero.
//   * Avg % local (platform) = straight mean of home shares
//     over creators who stated one, rounded; null when none.
//   * Local followers = sum over the population of
//     round(stacked total x share / 100), per creator.
//   * Per-market listed/combined = APPROVED non-tester
//     creators listed in the market; combined sums their full
//     stacked totals. Per-market local stats run over the
//     signed-up population (approved + pending, no testers).
//   * Discovery roster for a market = approved, non-tester,
//     profile-complete creators listed in that market.
//
// RUN — fixture mode (default; self-contained, no network):
//   node scripts/verify-counts.mjs        (or: npm run verify-counts)
// RUN — live mode (the daily check; Build -131 checker key):
//   GET /api/verify/counts on the live app returns the platform
//   totals + per-market stats TWICE: computed by the surfaces'
//   own builders, and by an independent in-endpoint recount
//   written from the definitions above. Live mode asserts the
//   two agree, stat by stat, and that the key stays read-only
//   (no token -> 401, wrong token -> 401, token refused on a
//   mutation route and on an unrelated admin route). This
//   replaced the original design (direct Blobs read + a real
//   admin login) because neither credential exists outside the
//   Netlify env — the 2026-11-05 daily run could not compare
//   live numbers at all. The record-level samples (Local List
//   shares, discovery rosters) stay fixture-mode-only: the key
//   deliberately cannot read records. Token resolution:
//   SIGNL_VERIFY_TOKEN env, else ~/.config/signl-verify-token
//   (a mode-600 file). Server side: the SAME value must be set
//   as the SIGNL_VERIFY_TOKEN env var on the Netlify site —
//   until it is, the endpoint fails closed and live mode exits
//   2/1 with the refusal recorded, never a silent pass.
//   Optional VERIFY_COUNTS_BASE (default https://app.joinsignl.com)
//   node scripts/verify-counts.mjs --live
// Exit codes: 0 = every stat matches · 1 = a mismatch ·
// 2 = setup missing (live mode without a token).

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const require = createRequire(import.meta.url);
const { MARKETS, normalizeMarketName } = require("../netlify/functions/lib/markets.js");

const LIVE = process.argv.includes("--live") || process.env.VERIFY_COUNTS_LIVE === "1";

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
function stat(name, expected, actual) {
  const ok = expected === actual || (expected === null && actual === null);
  if (ok) { passed++; console.log(`PASS ${name} expected=${expected} actual=${actual}`); }
  else { failed++; failures.push(name); console.log(`FAIL ${name} expected=${expected} actual=${actual}`); }
}
function skip(name, why) { skipped++; console.log(`SKIP ${name} (${why})`); }
function note(msg) { console.log(`  .. ${msg}`); }

// ---------- independent truth (from the definitions above) ----------
const CAP = 100000000;
function canon(name) {
  if (typeof name !== "string" || !name.trim()) return null;
  const hit = MARKETS.find((m) => m.name === normalizeMarketName(name) || m.id === name.trim());
  return hit ? hit.name : null;
}
function truthStackedTotal(c) {
  const cc = c || {};
  let sum = 0;
  const stack = cc.audienceStack && typeof cc.audienceStack === "object" ? cc.audienceStack : {};
  for (const v of Object.values(stack)) {
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n > 0) sum += Math.min(CAP, n);
  }
  if (sum === 0 && (cc.followerCount || 0) > 0) sum = Math.min(CAP, Math.floor(Number(cc.followerCount)) || 0);
  return sum;
}
function truthExtras(user) {
  const home = canon(user.market);
  const byMarket = new Map();
  const raw = user.creator && Array.isArray(user.creator.audienceMarkets) ? user.creator.audienceMarkets : [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const m = canon(e.market);
    if (!m || m === home) continue;
    const pct = Number(e.pct);
    if (!Number.isFinite(pct) || pct <= 0) continue;
    const clamped = Math.max(0, Math.min(100, pct));
    if (!byMarket.has(m) || clamped > byMarket.get(m)) byMarket.set(m, clamped);
  }
  return byMarket;
}
function truthShare(user, marketName) {
  if (!user || !user.creator) return null;
  const home = canon(user.market);
  if (!home) return null;
  if (marketName === home) {
    const pct = user.creator.localAudiencePct;
    return pct === null || pct === undefined || !Number.isFinite(Number(pct)) ? null : Number(pct);
  }
  const hit = truthExtras(user).get(marketName);
  return hit === undefined ? null : hit;
}
function truthListings(user) {
  // [{ market, pct|null }] — home first (always listed), then
  // extra markets whose stated share clears the 5% floor.
  if (!user || user.role !== "creator" || !user.creator) return [];
  const home = canon(user.market);
  if (!home) return [];
  const out = [{ market: home, pct: truthShare(user, home) }];
  for (const [m, pct] of truthExtras(user)) if (pct >= 5) out.push({ market: m, pct });
  return out;
}
const isTesterT = (u) => !!(u && u.tester);
function truthPlatform(users) {
  let signedUp = 0, totalFollowers = 0, localFollowers = 0, pctSum = 0, pctCount = 0;
  for (const u of users) {
    if (!u || u.role !== "creator" || isTesterT(u)) continue;
    if (u.status !== "approved" && u.status !== "pending") continue;
    signedUp += 1;
    const total = truthStackedTotal(u.creator);
    totalFollowers += total;
    const homePct = truthShare(u, canon(u.market));
    if (typeof homePct === "number") {
      pctSum += homePct; pctCount += 1;
      localFollowers += Math.round((total * homePct) / 100);
    }
  }
  return { creatorsSignedUp: signedUp, totalFollowers, localFollowers, avgLocalPct: pctCount ? Math.round(pctSum / pctCount) : null, avgLocalCount: pctCount };
}
function truthMarket(users, market) {
  const name = market.name;
  let approved = 0, pending = 0, listed = 0, combined = 0, localFollowers = 0, pctSum = 0, pctCount = 0;
  for (const u of users) {
    if (!u || u.role !== "creator") continue;
    if (canon(u.market) === name) {
      if (u.status === "approved" && !isTesterT(u)) approved += 1;
      if (u.status === "pending") pending += 1;
    }
    const total = truthStackedTotal(u.creator);
    for (const e of truthListings(u)) {
      if (e.market !== name) continue;
      if (u.status === "approved" && !isTesterT(u)) { listed += 1; combined += total; }
      if ((u.status === "approved" || u.status === "pending") && !isTesterT(u) && typeof e.pct === "number") {
        pctSum += e.pct; pctCount += 1;
        localFollowers += Math.round((total * e.pct) / 100);
      }
    }
  }
  return { creatorsApproved: approved, creatorsPending: pending, creatorsListed: listed, combinedFollowers: combined, localFollowers, avgLocalPct: pctCount ? Math.round(pctSum / pctCount) : null, avgLocalCount: pctCount };
}
function truthRosterIds(users, marketName, completeOf) {
  const ids = [];
  for (const u of users) {
    if (!u || u.role !== "creator" || u.status !== "approved" || isTesterT(u)) continue;
    if (!completeOf(u)) continue;
    if (truthListings(u).some((e) => e.market === marketName)) ids.push(u.id);
  }
  return ids.sort();
}

// ---------- tiny cookie-jar client (same shape as the suite) ----------
function makeClient(base) {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const piece of setCookie.split(/,(?=[^;]+=)/)) {
      const m = piece.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data, text };
  };
}

// ---------- shared surface comparisons ----------
async function compareAdminSurfaces(admin, users, label) {
  const totalsR = await admin("GET", "/api/admin/platform-totals");
  if (totalsR.status !== 200) { stat(`${label} platform-totals reachable`, 200, totalsR.status); return; }
  const tp = truthPlatform(users);
  const t = totalsR.data || {};
  stat(`${label} platform.creatorsSignedUp`, tp.creatorsSignedUp, t.creatorsSignedUp);
  stat(`${label} platform.totalFollowers`, tp.totalFollowers, t.totalFollowers);
  stat(`${label} platform.localFollowers`, tp.localFollowers, t.localFollowers);
  stat(`${label} platform.avgLocalPct`, tp.avgLocalPct, t.avgLocalPct);
  stat(`${label} platform.avgLocalCount`, tp.avgLocalCount, t.avgLocalCount);

  const mkR = await admin("GET", "/api/admin/markets");
  if (mkR.status !== 200) { stat(`${label} markets reachable`, 200, mkR.status); return; }
  const rows = new Map((mkR.data.markets || []).map((m) => [m.name, m]));
  for (const m of MARKETS) {
    const tm = truthMarket(users, m);
    const row = rows.get(m.name);
    if (!row) { stat(`${label} market[${m.name}] present`, true, false); continue; }
    stat(`${label} market[${m.name}].creatorsApproved`, tm.creatorsApproved, row.creatorsApproved);
    stat(`${label} market[${m.name}].creatorsPending`, tm.creatorsPending, row.creatorsPending);
    stat(`${label} market[${m.name}].creatorsListed`, tm.creatorsListed, row.creatorsListed);
    stat(`${label} market[${m.name}].combinedFollowers`, tm.combinedFollowers, row.combinedFollowers);
    stat(`${label} market[${m.name}].localFollowers`, tm.localFollowers, row.localFollowers);
    stat(`${label} market[${m.name}].avgLocalPct`, tm.avgLocalPct, row.avgLocalPct);
  }
}

async function compareLocalListShares(anon, users, label, sample) {
  // Creator-facing: the public Local List shows each listed
  // creator's share IN THAT MARKET. Sample multi-market
  // creators and check the share shown for a NON-home market.
  for (const u of sample) {
    for (const e of truthListings(u)) {
      if (e.market === canon(u.market)) continue;
      const r = await anon("GET", `/api/public/local-list?market=${encodeURIComponent(e.market)}`);
      if (r.status !== 200) { stat(`${label} local-list[${e.market}] reachable`, 200, r.status); continue; }
      let found = null;
      for (const cat of (r.data && r.data.categories) || []) for (const c of cat.creators || []) if (c.handle === u.creator.handle) found = c;
      if (!found) { stat(`${label} local-list[${e.market}] lists @${u.creator.handle}`, true, false); continue; }
      stat(`${label} local-list[${e.market}] @${u.creator.handle} share`, e.pct, found.localAudiencePct);
    }
  }
}

// ---------- fixture mode ----------
const PORT = 8971;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "counts@signl.test";
const ADMIN_PW = "verify-counts-admin-pass";
const PW = "fixture-pass-counts";
const DAY = 86400000;
const now0 = Date.now();
const iso = (t) => new Date(t).toISOString();

async function runFixture() {
  const salt = "countfixturesalt";
  const hash = crypto.scryptSync(PW, salt, 64).toString("hex");
  function creatorRec(id, name, email, handle, over = {}) {
    return {
      id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash,
      status: "pending", market: "Nashville", city: "Nashville",
      createdAt: iso(now0 - 10 * DAY), updatedAt: iso(now0 - 10 * DAY),
      creator: {
        handle, primaryPlatform: "instagram", followerCount: 1000, totalAudience: 1000,
        audienceStack: { instagram: 1000 }, categories: ["Food & Drink"], localAudiencePct: 60,
        tierBand: "Neighbors", profileComplete: true, publicPage: true, hasPhoto: false, bio: "",
        ...(over.creator || {}),
      },
      ...(over.top || {}),
    };
  }
  const users = [
    creatorRec("vc-ana", "Ana Anchor", "ana@counts.dev", "anacounts", {
      top: { status: "approved", reviewedAt: iso(now0 - 9 * DAY) },
      creator: { followerCount: 15000, totalAudience: 15000, audienceStack: { instagram: 12000, tiktok: 3000 }, audienceMarkets: [{ market: "Richmond", pct: 20 }], localAudiencePct: 55, tierBand: "Locals", hasPhoto: true },
    }),
    creatorRec("vc-ben", "Ben Basic", "ben@counts.dev", "bencounts", {
      top: { status: "approved", reviewedAt: iso(now0 - 8 * DAY) },
      creator: { followerCount: 4000, totalAudience: 4000, audienceStack: {}, localAudiencePct: 40 },
    }),
    creatorRec("vc-cid", "Cid Silent", "cid@counts.dev", "cidcounts", {
      creator: { followerCount: 10000, totalAudience: 10000, audienceStack: { instagram: 10000 }, localAudiencePct: null },
    }),
    creatorRec("vc-dee", "Dee Richmond", "dee@counts.dev", "deecounts", {
      top: { status: "approved", market: "Richmond", city: "Richmond", reviewedAt: iso(now0 - 7 * DAY) },
      creator: { followerCount: 2000, totalAudience: 2000, audienceStack: { instagram: 2000 }, localAudiencePct: 70 },
    }),
    creatorRec("vc-eli", "Eli Elsewhere", "eli@counts.dev", "elicounts", {
      top: { status: "approved", market: "Richmond", city: "Richmond", reviewedAt: iso(now0 - 6 * DAY) },
      creator: { followerCount: 1000, totalAudience: 1000, audienceStack: { instagram: 800, tiktok: 200 }, audienceMarkets: [{ market: "Nashville", pct: 12 }], localAudiencePct: 30 },
    }),
    creatorRec("vc-fay", "Fay Refused", "fay@counts.dev", "faycounts", {
      top: { status: "rejected", reviewedAt: iso(now0 - 5 * DAY) },
      creator: { followerCount: 9999, totalAudience: 9999, audienceStack: { instagram: 9999 }, localAudiencePct: 90 },
    }),
    creatorRec("vc-gus", "Gus Tester", "gus@counts.dev", "guscounts", {
      top: { status: "approved", tester: true, reviewedAt: iso(now0 - 4 * DAY) },
      creator: { followerCount: 500000, totalAudience: 500000, audienceStack: { instagram: 500000 }, localAudiencePct: 99 },
    }),
    creatorRec("vc-vic", "Vic Variant", "vic@counts.dev", "viccounts", {
      top: { status: "approved", market: "Hampton Roads", city: "Virginia Beach", reviewedAt: iso(now0 - 3 * DAY) },
      creator: { followerCount: 3000, totalAudience: 3000, audienceStack: { instagram: 3000 }, localAudiencePct: 65 },
    }),
    creatorRec("vc-jam", "Jam Labelform", "jam@counts.dev", "jamcounts", {
      top: { status: "approved", market: "Tampa, Florida", city: "Tampa", reviewedAt: iso(now0 - 2 * DAY) },
      creator: { followerCount: 23700, totalAudience: 23700, audienceStack: { instagram: 23700 }, localAudiencePct: 40 },
    }),
    {
      id: "vc-biz", role: "business", email: "biz@counts.dev", name: "Biz Owner",
      passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville",
      createdAt: iso(now0 - 20 * DAY), updatedAt: iso(now0 - 20 * DAY),
      business: { businessName: "Counts Cafe", category: "Restaurant", planId: "growth", plan: "growth" },
    },
  ];

  // Anchor the truth functions themselves against hand math, so
  // the guard can never drift in lockstep with a bug:
  // signedUp 7 · followers 58,700 · stated home shares
  // 55+40+70+30+65+40 = 300 over 6 -> avg 50 · local followers
  // 8,250+1,600+1,400+300+1,950+9,480 = 22,980.
  const tp = truthPlatform(users);
  stat("truth-anchor platform.creatorsSignedUp", 7, tp.creatorsSignedUp);
  stat("truth-anchor platform.totalFollowers", 58700, tp.totalFollowers);
  stat("truth-anchor platform.avgLocalPct", 50, tp.avgLocalPct);
  stat("truth-anchor platform.localFollowers", 22980, tp.localFollowers);
  const tNash = truthMarket(users, { name: "Nashville" });
  stat("truth-anchor Nashville avg (55+40+12)/3 -> 36", 36, tNash.avgLocalPct);
  stat("truth-anchor Nashville localFollowers 8,250+1,600+120", 9970, tNash.localFollowers);
  const tRich = truthMarket(users, { name: "Richmond" });
  stat("truth-anchor Richmond avg (70+30+20)/3 -> 40", 40, tRich.avgLocalPct);
  stat("truth-anchor Richmond localFollowers 1,400+300+3,000", 4700, tRich.localFollowers);
  const tVb = truthMarket(users, { name: "Virginia Beach" });
  stat("truth-anchor Virginia Beach approved (canonical match)", 1, tVb.creatorsApproved);
  const tTampa = truthMarket(users, { name: "Tampa" });
  stat("truth-anchor Tampa approved (canonical match)", 1, tTampa.creatorsApproved);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-counts-"));
  const dbFile = path.join(tmp, "db.json");
  {
    const data = {};
    for (const u of users) { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; }
    fs.writeFileSync(dbFile, JSON.stringify(data));
  }
  const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD: ADMIN_PW },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try { const r = await fetch(`${BASE}/api/bootstrap`); up = r.ok; } catch (e) { /* not up */ }
      if (!up) await new Promise((r) => setTimeout(r, 250));
    }
    if (!up) throw new Error("dev server did not come up");

    const admin = makeClient(BASE);
    const login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
    stat("fixture admin login", 200, login.status);
    await compareAdminSurfaces(admin, users, "fixture");

    const anon = makeClient(BASE);
    await compareLocalListShares(anon, users, "fixture", [users[0], users[4]]);

    // Business-facing discovery: a fresh Nashville business sees
    // exactly the Nashville roster; asking for Richmond returns
    // exactly Richmond's roster (multi-market listing included).
    const biz = makeClient(BASE);
    const bizLogin = await biz("POST", "/api/auth/login", { email: "biz@counts.dev", password: PW });
    stat("fixture business login", 200, bizLogin.status);
    const completeOf = (u) => !!(u.creator && u.creator.profileComplete === true);
    for (const mname of ["Nashville", "Richmond"]) {
      const r = await biz("GET", `/api/discover?market=${encodeURIComponent(mname)}`);
      if (r.status !== 200) { stat(`fixture discover[${mname}] reachable`, 200, r.status); continue; }
      const gotIds = ((r.data && r.data.creators) || []).map((c) => c.userId || c.id).sort();
      const wantIds = truthRosterIds(users, mname, completeOf);
      stat(`fixture discover[${mname}] roster size`, wantIds.length, gotIds.length);
      stat(`fixture discover[${mname}] roster ids match truth`, JSON.stringify(wantIds), JSON.stringify(gotIds));
    }
    // The business-facing card for the multi-market creator, in
    // Richmond context, carries Richmond's share (20), not home.
    const rich = await biz("GET", "/api/discover?market=Richmond");
    const anaCard = ((rich.data && rich.data.creators) || []).find((c) => (c.userId || c.id) === "vc-ana");
    if (!anaCard) stat("fixture discover[Richmond] carries the multi-market creator", true, false);
    else {
      // Card shape (publicCreator): the in-market share rides
      // profile.localAudiencePct; the stacked total rides the
      // card's own totalAudience.
      stat("fixture card @anacounts share in Richmond", 20, anaCard.profile ? anaCard.profile.localAudiencePct : undefined);
      stat("fixture card @anacounts stacked total", 15000, anaCard.totalAudience);
    }
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ---------- live mode (Build -131 checker key) ----------
async function runLive() {
  const base = process.env.VERIFY_COUNTS_BASE || "https://app.joinsignl.com";
  let token = process.env.SIGNL_VERIFY_TOKEN || "";
  if (!token) {
    try { token = fs.readFileSync(path.join(os.homedir(), ".config", "signl-verify-token"), "utf8").trim(); } catch (e) { /* no token file */ }
  }
  if (!token) {
    console.log("SETUP no checker token: set SIGNL_VERIFY_TOKEN or place the token in ~/.config/signl-verify-token (mode 600).");
    process.exit(2);
  }
  const get = async (headers) => {
    const r = await fetch(base + "/api/verify/counts", { headers });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const anon = await get({});
  stat("live verify endpoint refuses without the token (401)", 401, anon.status);
  const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
  const wrong = await get({ "x-signl-verify-token": flipped });
  stat("live verify endpoint refuses a wrong token (401)", 401, wrong.status);
  const ok = await get({ "x-signl-verify-token": token });
  stat("live verify endpoint answers with the token", 200, ok.status);
  if (ok.status !== 200) {
    note("the endpoint is not answering with the checker token — if the code is deployed, the SIGNL_VERIFY_TOKEN env var on the Netlify site is the one missing step (it must match the local token).");
    return;
  }
  const d = ok.data || {};
  const rec = d.recount || {};
  stat("live endpoint agrees with itself (agree flag)", true, d.agree === true);
  for (const f of ["creatorsSignedUp", "totalFollowers", "localFollowers", "avgLocalPct", "avgLocalCount"]) {
    stat(`live totals.${f} [recount vs surface]`, (rec.totals || {})[f], (d.totals || {})[f]);
  }
  stat("live markets count", MARKETS.length, (d.markets || []).length);
  for (const m of MARKETS) {
    const s = (d.markets || []).find((x) => x.name === m.name);
    const r = (rec.markets || []).find((x) => x.name === m.name);
    if (!s || !r) { stat(`live markets[${m.name}] present on both sides`, true, false); continue; }
    for (const f of ["creatorsApproved", "creatorsPending", "creatorsListed", "combinedFollowers", "localFollowers", "avgLocalPct", "avgLocalCount"]) {
      stat(`live markets[${m.name}].${f} [recount vs surface]`, r[f], s[f]);
    }
  }
  // The key stays read-only: refused everywhere else.
  const mut = await fetch(base + "/api/admin/review", { method: "POST", headers: { "Content-Type": "application/json", "x-signl-verify-token": token }, body: "{}" });
  stat("live token cannot mutate (POST /api/admin/review refused)", true, mut.status === 401 || mut.status === 403);
  const adm = await fetch(base + "/api/admin/applications", { headers: { "x-signl-verify-token": token } });
  stat("live token opens no other admin route (GET /api/admin/applications refused)", true, adm.status === 401 || adm.status === 403);
  note(`live numbers from ${base}: ${(d.totals || {}).creatorsSignedUp} creators signed up · ${(d.totals || {}).totalFollowers} followers · avg local ${(d.totals || {}).avgLocalPct}% across ${(d.markets || []).length} markets`);
}

try {
  if (LIVE) await runLive(); else await runFixture();
} catch (e) {
  failed++;
  failures.push("harness: " + e.message);
  console.error("HARNESS ERROR", e);
}
console.log(`\nverify-counts: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
