#!/usr/bin/env node
// SYNTHETIC training-pairs fixture generator (Build -149).
//
// This file generates FAKE data, on purpose, clearly labeled:
// every row carries `synthetic: true` and the output lives at
// scripts/fixtures/synthetic-training-pairs.jsonl. It exists
// for exactly one reason — to prove scripts/eval-ranker.mjs
// works end-to-end (path b: train + held-out verdict) today,
// while the real training set is still near-empty. Synthetic
// rows NEVER enter the store or any export; the harness warns
// when it reads them and its verdict on them proves the
// harness only.
//
// The generating process is deliberately NOT the hand
// formula: in this fake world, businesses pick mostly on
// reliability and local share, track record matters, and
// Momentum barely moves the choice — while the formula
// weights Momentum and category far higher. A learner that
// recovers the true weights should therefore beat the formula
// on held-out briefs, which is the behavior the harness must
// be able to detect. Scores and parts on every row are
// computed by the REAL computeMatchScore from lib/match.js,
// so the fixture's feature vectors are exactly production-
// shaped.
//
// Deterministic: a seeded PRNG, fixed counts. Re-running
// reproduces the identical file.
//
//   node scripts/gen-synthetic-training.mjs [--out path] [--briefs 420]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { computeMatchScore } = require("../netlify/functions/lib/match.js");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : dflt; };
const OUT = opt("out", path.join(ROOT, "scripts", "fixtures", "synthetic-training-pairs.jsonl"));
const N_BRIEFS = Math.max(50, parseInt(opt("briefs", "420"), 10) || 420);

// mulberry32 — small deterministic PRNG.
let seedState = 0x5eed149;
function rnd() {
  seedState |= 0; seedState = (seedState + 0x6D2B79F5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5; // ~N(0, ~0.4)

const MARKETS = ["Nashville", "Austin", "Dallas", "Chicago", "Denver", "Seattle"];
const BIZ_CATS = ["Restaurant", "Fitness Studio", "Salon & Beauty", "Retail & Shops"];
const CREATOR_CATS = ["Food & Drink", "Fitness & Wellness", "Beauty & Grooming", "Lifestyle", "Nightlife", "Music"];
const DAY0 = Date.parse("2026-10-09T12:00:00.000Z");

const rows = [];
for (let bi = 0; bi < N_BRIEFS; bi++) {
  const market = pick(MARKETS);
  const bizCat = pick(BIZ_CATS);
  const kind = rnd() < 0.3 ? "comp" : "paid";
  const budget = kind === "paid" ? pick([100, 150, 200, 250, 300]) : null;
  const brief = { market, category: bizCat, categoryKind: "business", kind, budget };
  const ts = new Date(DAY0 + Math.floor((bi / N_BRIEFS) * 30) * 86400000 + Math.floor(rnd() * 3600000)).toISOString();
  const impressionId = `synth-imp-${String(bi + 1).padStart(4, "0")}`;
  const nShown = 5 + Math.floor(rnd() * 4);
  const shown = [];
  for (let ci = 0; ci < nShown; ci++) {
    const proven = rnd() < 0.65;
    // Reliability gets real spread in this fake world (a
    // creator's on-time record runs from poor to perfect) —
    // without variance in the feature there is nothing for a
    // learner to find, whatever the true weight is.
    const postsOnTime = proven ? Math.floor(rnd() * 13) : Math.floor(rnd() * 2);
    const postsLate = proven ? Math.floor(rnd() * 9) : Math.floor(rnd() * 1);
    const trackPosts = proven && rnd() < 0.5 ? 1 + Math.floor(rnd() * 5) : 0;
    const creator = {
      categories: [pick(CREATOR_CATS)],
      compCategories: ["Restaurant meals"],
      paidRate: pick([0, 100, 125, 150, 200, 250, 350]),
      localPctInMarket: rnd() < 0.1 ? null : Math.round(5 + rnd() * 93),
      momentumPoints: Math.floor(Math.pow(rnd(), 1.6) * 180),
      redeemed: postsOnTime + postsLate + Math.floor(rnd() * 2),
      postsOnTime,
      postsLate,
      track: { reach: trackPosts ? Math.floor(rnd() * 22000) : 0, posts: trackPosts, redemptions: trackPosts },
    };
    const { score, parts } = computeMatchScore(brief, creator);
    // The fake world's true pick utility: reliability and
    // local share dominate, track record counts, Momentum is
    // nearly irrelevant, category matters a little.
    const utility =
      0.50 * (parts.reliability / 100) +
      0.30 * ((parts.localPct || 0) / 100) +
      0.10 * (parts.trackBonus / 8) +
      0.08 * (parts.category / 100) +
      0.05 * (parts.budget / 100) +
      0.02 * (Math.min(100, parts.momentum) / 100) +
      gauss() * 0.13;
    shown.push({ creatorId: `synth-cr-${bi}-${ci}`, score, parts, utility });
  }
  const ranked = [...shown].sort((a, b) => b.utility - a.utility);
  const nPicks = rnd() < 0.25 ? 2 : 1;
  const pickedIds = new Set(ranked.slice(0, nPicks).map((s) => s.creatorId));
  shown.forEach((s, idx) => {
    const isPick = pickedIds.has(s.creatorId);
    rows.push({
      synthetic: true,
      impressionId,
      creatorId: s.creatorId,
      ts,
      actorId: "synth-biz",
      briefSource: "campaign",
      campaignId: `synth-camp-${bi + 1}`,
      via: "matches",
      joinVia: isPick ? "campaign" : null,
      market,
      category: bizCat,
      kind,
      budget,
      rank: idx + 1,
      shownCount: nShown,
      score: s.score,
      features: {
        localPct: s.parts.localPct, category: s.parts.category, categorySignal: s.parts.categorySignal,
        budget: s.parts.budget, budgetSignal: s.parts.budgetSignal, reliability: s.parts.reliability,
        reliabilityBasis: s.parts.reliabilityBasis, deliveries: s.parts.deliveries, onTimePct: s.parts.onTimePct,
        momentum: s.parts.momentum, trackBonus: s.parts.trackBonus, trackReach: s.parts.trackReach,
        trackPosts: s.parts.trackPosts, trackRedemptions: s.parts.trackRedemptions,
      },
      picked: isPick ? 1 : 0,
      pickStage: isPick ? "booked" : null,
      offerId: isPick ? `synth-camp-${bi + 1}` : null,
      delivery: isPick ? (rnd() < 0.7 ? "on_time" : rnd() < 0.66 ? "late" : "no_show") : null,
    });
  });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const picks = rows.filter((r) => r.picked).length;
console.log(`synthetic fixture written: ${OUT}`);
console.log(`  ${rows.length} rows · ${N_BRIEFS} briefs · ${picks} picks — SYNTHETIC, harness-proof only, never product data.`);
