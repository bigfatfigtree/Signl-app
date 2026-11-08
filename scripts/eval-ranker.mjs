#!/usr/bin/env node
// Offline ranker evaluation harness (Build -149, Phase 3
// readiness). THE JUDGE for the learned match ranker — it runs
// locally, never in a request path, and never writes to the
// store. It reads a training-pairs file (the Admin export
// dataset `training_pairs` in JSONL, or the synthetic fixture
// under scripts/fixtures/) and answers one question honestly:
// is there enough real pick history to train on, and if so,
// does a learned ranker beat the hand-set formula on picks it
// never saw?
//
// Usage:
//   node scripts/eval-ranker.mjs --file <pairs.jsonl>
//   node scripts/eval-ranker.mjs --file <pairs.json>   (JSON array also accepted)
//   options: --min-picks N (default 200) --min-briefs N (default 30)
//            --train-share F (default 0.8, time-ordered)
//
// Method (documented in docs/phase3-ranker.md):
//   - Groups are impressions; a group is "labeled" when at
//     least one shown creator was picked.
//   - Below the volume floor the verdict is NOT ENOUGH DATA
//     with the real counts — training on less would memorize,
//     not learn (Jeff's ruling, 2026-11-08).
//   - Above it: groups are split BY TIME (earliest train,
//     latest test — never a random split, which leaks the
//     future into the past). A pointwise logistic regression
//     on the formula's own feature parts (dependency-free
//     gradient descent, fixed hyper-parameters, zero init —
//     fully deterministic) learns P(picked). Both rankers are
//     scored on the held-out groups: pairwise win rate (the
//     picked creator ranked above each unpicked shown
//     creator; ties count half), mean rank of the picked
//     creator (ties broken by the shown order), top-3 hit
//     rate.
//   - The hand formula's score is RECOMPUTED from each row's
//     stored feature vector with the live weights imported
//     from netlify/functions/lib/match.js, so the harness
//     always judges the formula as it exists today, not as it
//     was when the impression was captured.
//   - ACTIVATION RULE: a learned win here is a candidate for
//     Jeff's review, nothing more. Learned weights ship only
//     when this harness beats the formula on held-out REAL
//     data AND Jeff approves. This script changes nothing.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { WEIGHTS } = require("../netlify/functions/lib/match.js");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const FILE = opt("file", null);
const MIN_PICKS = Math.max(1, parseInt(opt("min-picks", "200"), 10) || 200);
const MIN_BRIEFS = Math.max(1, parseInt(opt("min-briefs", "30"), 10) || 30);
const TRAIN_SHARE = Math.min(0.95, Math.max(0.5, Number(opt("train-share", "0.8")) || 0.8));

if (!FILE) {
  console.error("usage: node scripts/eval-ranker.mjs --file <training-pairs.jsonl> [--min-picks 200] [--min-briefs 30]");
  process.exit(2);
}

function loadRows(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return [];
  if (text.startsWith("[")) return JSON.parse(text);
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

const rows = loadRows(FILE);
const synthetic = rows.some((r) => r.synthetic === true) || /synthetic/i.test(path.basename(FILE));
const groups = new Map();
for (const r of rows) {
  if (!r || !r.impressionId || !r.creatorId) continue;
  if (!groups.has(r.impressionId)) groups.set(r.impressionId, []);
  groups.get(r.impressionId).push(r);
}
const labeled = [...groups.entries()].filter(([, rs]) => rs.some((r) => r.picked === 1));
const pickedTotal = rows.filter((r) => r.picked === 1).length;

console.log(`eval-ranker: ${path.basename(FILE)}`);
console.log(`  rows ${rows.length} · impressions ${groups.size} · labeled briefs ${labeled.length} · picked rows ${pickedTotal}`);
if (synthetic) console.log("  WARNING: this file is SYNTHETIC fixture data — it proves the harness, it says nothing about the product.");

if (pickedTotal < MIN_PICKS || labeled.length < MIN_BRIEFS) {
  console.log("");
  console.log("VERDICT: NOT ENOUGH DATA");
  console.log(`  Training unlocks at ${MIN_PICKS} picked outcomes across ${MIN_BRIEFS} distinct briefs with a pick.`);
  console.log(`  On file now: ${pickedTotal} picked outcomes across ${labeled.length} briefs.`);
  console.log("  The correct move is to keep capturing impressions and picks; a model trained below this floor would memorize, not learn.");
  process.exit(0);
}

// ---- features ------------------------------------------------
// The formula's own parts, scaled to ~[0,1]. Missing local %
// is 0 in the formula (an unreported share is not a share) and
// is 0 here; momentum enters the formula as min(100, points).
function featureVec(r) {
  const f = r.features || {};
  const num = (v, dflt = 0) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
  return [
    num(f.localPct) / 100,
    num(f.category) / 100,
    num(f.budget) / 100,
    num(f.reliability) / 100,
    Math.min(100, num(f.momentum)) / 100,
    num(f.trackBonus) / 8,
  ];
}
const FEATURE_NAMES = ["localPct", "category", "budget", "reliability", "momentum", "trackBonus"];

// The hand formula, recomputed from the stored parts with the
// live weights (match.js): base = round(sum w_i * part_i),
// score = clamp(base + trackBonus, 0, 100).
function formulaScore(r) {
  const f = r.features || {};
  const num = (v, dflt = 0) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
  const base = Math.round(
    WEIGHTS.local * num(f.localPct) +
    WEIGHTS.category * num(f.category) +
    WEIGHTS.budget * num(f.budget) +
    WEIGHTS.reliability * num(f.reliability) +
    WEIGHTS.momentum * Math.min(100, num(f.momentum))
  );
  return Math.max(0, Math.min(100, base + num(f.trackBonus)));
}

// ---- time-ordered split --------------------------------------
const ordered = labeled
  .map(([id, rs]) => ({ id, rs, ts: Math.min(...rs.map((r) => Date.parse(r.ts || "") || 0)) }))
  .sort((a, b) => a.ts - b.ts || String(a.id).localeCompare(String(b.id)));
const cut = Math.max(1, Math.floor(ordered.length * TRAIN_SHARE));
const trainGroups = ordered.slice(0, cut);
const testGroups = ordered.slice(cut).filter((g) => g.rs.length >= 2);
if (!testGroups.length) {
  console.log("");
  console.log("VERDICT: NOT ENOUGH DATA");
  console.log("  Every labeled brief landed in the training share; no held-out brief with a real choice remains to judge on.");
  process.exit(0);
}

// ---- logistic regression (pointwise, deterministic) ---------
function trainLR(groupsList) {
  const X = [];
  const Y = [];
  for (const g of groupsList) for (const r of g.rs) { X.push(featureVec(r)); Y.push(r.picked === 1 ? 1 : 0); }
  const d = FEATURE_NAMES.length;
  const w = new Array(d).fill(0);
  let b = 0;
  // 3000 full-batch epochs: at a few hundred the descent is
  // still mid-flight and can report a backwards weight for a
  // feature whose signal is real but quieter than local share
  // (measured on the synthetic fixture: reliability's weight
  // only turns true after ~1000). Offline and deterministic,
  // so thorough wins over fast.
  const LR = 0.5, EPOCHS = 3000, L2 = 1e-3;
  const sig = (z) => 1 / (1 + Math.exp(-z));
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < X.length; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const err = sig(z) - Y[i];
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= LR * (gw[j] / X.length + L2 * w[j]);
    b -= LR * (gb / X.length);
  }
  return { w, b, predict: (r) => { const x = featureVec(r); let z = b; for (let j = 0; j < d; j++) z += w[j] * x[j]; return sig(z); } };
}
const model = trainLR(trainGroups);

// ---- scoring --------------------------------------------------
function evaluate(groupsList, scoreFn) {
  let pairs = 0, wins = 0, rankSum = 0, pickCount = 0, top3 = 0;
  for (const g of groupsList) {
    const scored = g.rs.map((r) => ({ r, s: scoreFn(r) })).sort((a, b) => (b.s - a.s) || (a.r.rank - b.r.rank));
    const rankOf = new Map(scored.map((x, i) => [x.r, i + 1]));
    for (const x of scored) {
      if (x.r.picked !== 1) continue;
      pickCount += 1;
      rankSum += rankOf.get(x.r);
      if (rankOf.get(x.r) <= 3) top3 += 1;
      for (const y of scored) {
        if (y.r.picked === 1) continue;
        pairs += 1;
        if (x.s > y.s) wins += 1;
        else if (x.s === y.s) wins += 0.5;
      }
    }
  }
  return {
    pairwise: pairs ? wins / pairs : 0,
    meanRank: pickCount ? rankSum / pickCount : 0,
    top3: pickCount ? top3 / pickCount : 0,
    pairs, pickCount,
  };
}
const learned = evaluate(testGroups, model.predict);
const formula = evaluate(testGroups, formulaScore);

const pct = (n) => `${(n * 100).toFixed(1)}%`;
console.log("");
console.log(`train briefs ${trainGroups.length} · held-out briefs ${testGroups.length} (time-ordered split, no leakage)`);
console.log("");
console.log("  model              pairwise wins   mean rank of pick   top-3 hit rate");
console.log(`  hand formula       ${pct(formula.pairwise).padStart(13)}   ${formula.meanRank.toFixed(2).padStart(17)}   ${pct(formula.top3).padStart(14)}`);
console.log(`  learned (LR)       ${pct(learned.pairwise).padStart(13)}   ${learned.meanRank.toFixed(2).padStart(17)}   ${pct(learned.top3).padStart(14)}`);
console.log("");
console.log("  learned weights (on scaled parts): " + FEATURE_NAMES.map((n, i) => `${n} ${model.w[i].toFixed(2)}`).join(" · ") + ` · bias ${model.b.toFixed(2)}`);
console.log("");
if (learned.pairwise > formula.pairwise) {
  console.log("VERDICT: LEARNED BEATS FORMULA on held-out pairwise wins.");
  console.log(synthetic
    ? "  On SYNTHETIC data this only proves the harness works. Activation requires the same win on REAL exported pairs, plus Jeff's approval."
    : "  This is a candidate for Jeff's activation review — nothing ships automatically, and learned weights go live only with his approval.");
} else {
  console.log("VERDICT: FORMULA HOLDS — the learned ranker does not beat the hand-set weights on held-out picks.");
  console.log("  The formula stays. Re-run as pick volume grows; the verdict is only ever as good as the data behind it.");
}
process.exit(0);
