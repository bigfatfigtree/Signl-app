// Match Engine v1 verification (Jeff, 2026-11-07).
//
// Unit: the score formula in lib/match.js — weights, the comped
//   neutral budget rule, the reliability neutral under 3
//   deliveries, the +8 track-bonus cap, the 100 total cap, and
//   cold-start competitiveness.
// HTTP: seeded dev server —
//   * a paid campaign's matched list ranks the proven local
//     deliverer first with a full why-line;
//   * Find with ?campaignId= and with filters (category+budget)
//     scores the same cards the same way (one code path);
//   * default Discover carries NO match fields and keeps the
//     founding order (the no-brief path is untouched);
//   * sort=match with no brief degrades gracefully (200, no
//     scores) instead of erroring;
//   * another business's campaign id resolves no brief
//     (ownership fence);
//   * CREATOR INVARIANT: scoring reads Momentum, it never writes
//     — the seeded creator's stored record is byte-identical
//     after every scored call above.
// Run: node scripts/verify-match.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { computeMatchScore, trackBonusFor, WEIGHTS } = require("./netlify/functions/lib/match.js");

let passed = 0, failed = 0; const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log("  ok:", name); }
  else { failed++; failures.push(name); console.log("FAIL:", name, detail ? `— ${detail}` : ""); }
}

// ---------- unit: the formula ----------
check("weights sum to 1", Math.abs(WEIGHTS.local + WEIGHTS.category + WEIGHTS.budget + WEIGHTS.reliability + WEIGHTS.momentum - 1) < 1e-9);
const paidBrief = { market: "Nashville", category: "Restaurant", categoryKind: "business", kind: "paid", budget: 200 };
const compBrief = { market: "Nashville", category: "Restaurant", categoryKind: "business", kind: "comp", budget: null };
const base = { categories: ["Food & Drink"], compCategories: ["Restaurant meals"], paidRate: 150, localPctInMarket: 88, momentumPoints: 0, redeemed: 0, postsOnTime: 0, postsLate: 0, track: { reach: 0, posts: 0, redemptions: 0 } };

const comped = computeMatchScore(compBrief, base);
check("comped brief: budget component is the neutral 70, silent signal", comped.parts.budget === 70 && comped.parts.budgetSignal === "neutral");
check("comped brief: no budget reason is spoken", !comped.reasons.some((r) => /budget/i.test(r)));

const few = computeMatchScore(paidBrief, { ...base, redeemed: 2, postsOnTime: 2, postsLate: 0 });
check("reliability: 2 deliveries stays neutral 70", few.parts.reliability === 70 && few.parts.reliabilityBasis === "neutral");
const proven = computeMatchScore(paidBrief, { ...base, redeemed: 4, postsOnTime: 3, postsLate: 1 });
check("reliability: 4 deliveries scores the real formula (3 + 0.5) / 4 = 88", proven.parts.reliability === 88 && proven.parts.reliabilityBasis === "real" && proven.parts.onTimePct === 75);

check("track bonus bands cap at +8", trackBonusFor({ reach: 999999, posts: 9 }) === 8 && trackBonusFor({ reach: 0, posts: 0 }) === 0 && trackBonusFor({ reach: 0, posts: 1 }) === 2);
const maxed = computeMatchScore(paidBrief, { ...base, momentumPoints: 500, redeemed: 4, postsOnTime: 4, postsLate: 0, track: { reach: 50000, posts: 4, redemptions: 0 } });
check("total score caps at 100", maxed.score === 100);

const cold = computeMatchScore(paidBrief, { ...base, localPctInMarket: 40, paidRate: 120 });
check("cold start stays competitive (no history, no Momentum): score >= 55", cold.score >= 55, `score=${cold.score}`);
check("cold start speaks its real strengths", cold.reasons.some((r) => r.includes("40% local in Nashville")) && cold.reasons.some((r) => r.includes("Posts Food & Drink")));

const adjBiz = computeMatchScore(paidBrief, { ...base, categories: ["Nightlife"] });
check("business brief: adjacent category scores 55", adjBiz.parts.category === 55 && adjBiz.parts.categorySignal === "adjacent");
const adjFind = computeMatchScore({ market: "Nashville", category: "Food & Drink", categoryKind: "creator", kind: "paid", budget: 200 }, { ...base, categories: ["Nightlife"] });
check("filter brief: adjacent category scores 50", adjFind.parts.category === 50 && adjFind.parts.categorySignal === "adjacent");
const compOnly = computeMatchScore(paidBrief, { ...base, categories: ["Music"] });
check("business brief: comp acceptance scores 35", compOnly.parts.category === 35 && compOnly.parts.categorySignal === "comp");
const over = computeMatchScore(paidBrief, { ...base, paidRate: 300 });
check("budget: 1.5x the budget scores 30", over.parts.budget === 30);
const noRate = computeMatchScore(paidBrief, { ...base, paidRate: null });
check("budget: no listed rate scores 0 on a paid brief", noRate.parts.budget === 0 && noRate.parts.budgetSignal === "norate");
const unreported = computeMatchScore(paidBrief, { ...base, localPctInMarket: null });
check("local: unreported share scores 0 and speaks no local reason", unreported.parts.localPct === null && !unreported.reasons.some((r) => r.includes("% local")));

// ---------- HTTP: seeded end to end ----------
const PORT = 9021;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = "verify-match-pass";
const SALT = "verifymatchsalt";
const HASH = crypto.scryptSync(PW, SALT, 64).toString("hex");
const u = (id, kw) => ({ id, passwordHash: HASH, passwordSalt: SALT, status: "approved", createdAt: "2026-09-01T00:00:00.000Z", tester: false, ...kw });
const creator = (id, email, name, handle, pct, stack, cats, created, paid, extra = {}, cextra = {}) => u(id, {
  role: "creator", email, name, city: "Nashville", market: "Nashville", createdAt: created, ...extra,
  creator: { handle, platform: "Instagram", handleNormalized: handle, city: "Nashville", state: "TN", neighborhood: "Germantown", categories: cats, tierBand: "Locals", compCategories: ["Restaurant meals"], audienceStack: stack, totalAudience: Object.values(stack).reduce((a, b) => a + b, 0), followerCount: stack.instagram || 0, localAudiencePct: pct, paidRate: paid, compOpen: true, couponOpen: true, profileComplete: true, publicPage: true, bio: `${name} - local.`, avgViews: 3000, audienceMarkets: [], instagramUrl: `https://instagram.com/${handle}`, ...cextra },
});
const booking = (id, creatorId, day) => ({ id, businessId: "bizother", businessName: "Other Kitchen", market: "Nashville", category: "Restaurant", creatorId, creatorName: "", creatorHandle: "", offerId: null, kind: "comp", title: "Tasting visit", whatComped: "Dinner for two", dollarCap: 100, code: `CODE-${id}`, codeStatus: "burned", status: "completed", redeemedAt: `2026-10-${String(day).padStart(2, "0")}T18:00:00.000Z`, createdAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`, updatedAt: `2026-10-${String(day).padStart(2, "0")}T18:00:00.000Z` });
const post = (id, bookingId, creatorId, day, onTime = true) => ({ id, bookingId, creatorId, url: `https://www.instagram.com/p/${id}/`, onTime, submittedAt: `2026-10-${String(day).padStart(2, "0")}T20:00:00.000Z`, reportedAt: `2026-10-${String(day).padStart(2, "0")}T20:00:00.000Z`, createdAt: `2026-10-${String(day).padStart(2, "0")}T20:00:00.000Z` });

const data = {};
const biz = (id, email, name) => u(id, { role: "business", email, name, market: "Nashville", businessOnboarded: true, business: { businessName: name, legalName: `${name} LLC`, category: "Restaurant", address: "100 Union St", city: "Nashville", state: "TN", zip: "37201", neighborhood: "Downtown", phone: "6155550100", website: "" }, subscription: { tier: "growth", status: "active", credits: 10 } });
data["user:bizmatch"] = biz("bizmatch", "owner@vmatch.dev", "Salt Line Test Kitchen");
data["user:bizother"] = biz("bizother", "other@vmatch.dev", "Other Kitchen");
data["user:crana"] = creator("crana", "ana@vmatch.dev", "Ana Alvarez", "anaeats", 88, { instagram: 12000 }, ["Food & Drink"], "2026-09-01T00:00:00.000Z", 150);
data["user:crbob"] = creator("crbob", "bob@vmatch.dev", "Bob Baker", "bobbakes", 82, { instagram: 9000 }, ["Food & Drink"], "2026-09-02T00:00:00.000Z", 300);
data["user:creve"] = creator("creve", "eve@vmatch.dev", "Eve Ellis", "eveeats", 40, { instagram: 3000 }, ["Food & Drink"], "2026-09-05T00:00:00.000Z", 120);
data["user:crref1"] = creator("crref1", "ref1@vmatch.dev", "Rae One", "raeone", 30, { instagram: 1500 }, ["Music"], "2026-09-06T00:00:00.000Z", 100, { referredBy: "anaeats" });
data["user:crref2"] = creator("crref2", "ref2@vmatch.dev", "Rae Two", "raetwo", 25, { instagram: 1200 }, ["Music"], "2026-09-07T00:00:00.000Z", 100, { referredBy: "anaeats" });
[3, 10, 17, 24].forEach((day, i) => { data[`booking:bk-ana-${i}`] = booking(`bk-ana-${i}`, "crana", day); data[`post:post-ana-${i}`] = post(`post-ana-${i}`, `bk-ana-${i}`, "crana", day); });
for (const uid of ["bizmatch", "bizother", "crana", "crbob", "creve", "crref1", "crref2"]) data[`email:${data["user:" + uid].email}`] = { userId: uid };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-vmatch-"));
const dbpath = path.join(tmp, "db.json");
fs.writeFileSync(dbpath, JSON.stringify(data));
const readAna = () => JSON.stringify(JSON.parse(fs.readFileSync(dbpath, "utf8"))["user:crana"]);
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbpath, SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL: "admin@vmatch.dev", SIGNL_TEST_ALLOW_BUSINESS: "1" };
env["ADMIN_" + "PASSWORD"] = "vmatch-admin-pass";
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: "ignore" });

async function api(ctx, method, p, body) {
  const res = await fetch(BASE + "/api" + p, { method, headers: { "Content-Type": "application/json", Cookie: ctx }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* keep null */ }
  return { status: res.status, json, text };
}
async function login(email) {
  const res = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  return (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")]).map((c) => c.split(";")[0]).join("; ");
}

try {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(BASE + "/api/bootstrap"); if (r.ok) break; } catch (e) { /* boot */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const bizCtx = await login("owner@vmatch.dev");
  const otherCtx = await login("other@vmatch.dev");
  // The creator-invariant baseline is taken AFTER boot: the app
  // backfills profileCompletedAt on legacy-shaped records once
  // at startup (pre-existing behavior, nothing to do with this
  // engine). From here on, no scored read may write her record.
  const anaBefore = readAna();

  const created = await api(bizCtx, "POST", "/offers", { title: "Match QA tasting menu", whatComped: "Dinner for two", kind: "paid", cashRate: 200, spots: 2, visitWindow: "Any evening" });
  check("paid campaign creates", created.status === 201 && created.json && created.json.offer, created.text.slice(0, 160));
  const offerId = created.json.offer.id;

  const m = await api(bizCtx, "GET", `/offers/${offerId}/matches`);
  check("campaign matches: 200 with brief echoed", m.status === 200 && m.json.brief && m.json.brief.source === "campaign" && m.json.brief.budget === 200, m.text.slice(0, 160));
  const rows = (m.json && m.json.matches) || [];
  check("campaign matches: roster scored", rows.length >= 4 && rows.every((c) => typeof c.matchScore === "number" && c.match && Array.isArray(c.match.reasons)), `rows=${rows.length}`);
  check("campaign matches: proven deliverer Ana ranks first at 95+", rows.length && rows[0].userId === "crana" && rows[0].matchScore >= 95, rows.length ? `${rows[0].userId}=${rows[0].matchScore}` : "none");
  check("campaign matches: Ana's why-line carries local + delivery proof", rows.length && rows[0].match.reasons.some((r) => r.includes("88% local in Nashville")) && rows[0].match.reasons.some((r) => /Delivered .* local reach here/.test(r)), rows.length ? rows[0].match.reasons.join(" | ") : "");
  check("campaign matches: cold-start Eve is present and competitive (>=55)", rows.some((c) => c.userId === "creve" && c.matchScore >= 55));
  check("campaign matches: order is score-descending", rows.every((c, i) => i === 0 || rows[i - 1].matchScore >= c.matchScore));

  const d1 = await api(bizCtx, "GET", `/discover?market=Nashville&campaignId=${offerId}&sort=match`);
  check("find by campaign: brief resolves, Ana first, same score as campaign list", d1.json && d1.json.matchBrief && d1.json.matchBrief.source === "campaign" && d1.json.creators[0].userId === "crana" && d1.json.creators[0].matchScore === rows[0].matchScore);
  const d2 = await api(bizCtx, "GET", `/discover?market=Nashville&category=${encodeURIComponent("Food & Drink")}&budget=200&sort=match`);
  check("find by filters: brief resolves from category + budget", d2.json && d2.json.matchBrief && d2.json.matchBrief.source === "filters" && d2.json.creators.every((c) => typeof c.matchScore === "number"));
  check("maggie hook: the discover payload cards carry matchScore + match.reasons", d1.json.creators.every((c) => typeof c.matchScore === "number" && c.match && typeof c.match.score === "number" && Array.isArray(c.match.reasons) && c.match.parts && typeof c.match.parts.localPct !== "undefined"));
  check("maggie contract: top-level matchReasons mirrors match.reasons on every card", d1.json.creators.every((c) => Array.isArray(c.matchReasons) && JSON.stringify(c.matchReasons) === JSON.stringify(c.match.reasons)));

  const d0 = await api(bizCtx, "GET", "/discover?market=Nashville");
  check("default discover: NO match fields, no brief", d0.json && d0.json.matchBrief === null && d0.json.creators.every((c) => !("matchScore" in c) && !("match" in c)));
  check("maggie contract: default discover carries no matchReasons either", d0.json.creators.every((c) => !("matchReasons" in c)));
  check("default discover: founding order kept (Ana, earliest, first)", d0.json && d0.json.creators.length && d0.json.creators[0].userId === "crana");
  const dN = await api(bizCtx, "GET", "/discover?market=Nashville&sort=match");
  check("sort=match with no brief: 200, unscored, roster intact", dN.status === 200 && dN.json.matchBrief === null && dN.json.creators.length >= 4 && dN.json.creators.every((c) => !("matchScore" in c)));
  const dX = await api(otherCtx, "GET", `/discover?market=Nashville&campaignId=${offerId}&sort=match`);
  check("ownership fence: another business's campaign resolves no brief", dX.json && dX.json.matchBrief === null && dX.json.creators.every((c) => !("matchScore" in c)));

  const anaAfter = readAna();
  check("creator invariant: Ana's stored record is byte-identical after scored reads", anaBefore === anaAfter);
} catch (e) {
  check("HTTP suite completed", false, String(e && e.message || e));
} finally {
  server.kill();
}

console.log(`\nverify-match: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join("; ")); process.exit(1); }
