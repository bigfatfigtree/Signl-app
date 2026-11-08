# Phase 3 — the learned match ranker: data, judge, and the activation rule

Build -149 (data program step 5 of 5). The match score today is a
hand-weighted formula (`netlify/functions/lib/match.js`:
0.35·local + 0.20·category + 0.15·budget + 0.15·reliability +
0.15·momentum, + track bonus ≤ 8). That formula is the cold start.
Its successor — weights **learned** from what businesses actually
picked and what those picks delivered — is deliberately not built
yet. What this build ships is everything the learned model needs
and everything that will judge it:

1. **The food** — a training-set builder that joins every captured
   match impression to its pick and delivery outcomes.
2. **The judge** — an offline evaluation harness that trains a
   candidate ranker on old picks and scores it against the formula
   on newer picks it never saw.
3. **The decision loop's memory** — suggestion outcome matching, so
   the Admin Suggestions layer also accumulates acted → outcome
   history (its own future ranking data).

## The activation rule (hard)

> Learned weights ship **only** when `scripts/eval-ranker.mjs`,
> run on **real** exported training pairs, beats the hand formula
> on held-out picks **and Jeff approves**. A win on synthetic data
> proves the harness, never the product. Nothing in this build
> changes any live score, ranking, or surface.

## Training pairs

**Builder:** `netlify/functions/lib/training.js`
(`buildTrainingRows`, pure and deterministic — same inputs, same
rows, deduped on impression id + creator id, safe to re-export at
any time).

**Export:** Admin → Stats → Data → `training_pairs`
(JSONL is the harness's format; JSON and CSV also offered). The
Data view states the current volume in plain words — rows,
match lists, picks, briefs with a pick — because tonight the
honest count is near zero and the machinery is the deliverable.

**The join.** Each `match_impression` event (captured since
Build -144) carries the brief and the shown creators with their
full feature vectors (`match.parts`). Outcomes join two ways:

- **Campaign briefs** (impression's subject is an offer): a shown
  creator was *picked* if they applied to that offer
  (application, not withdrawn), were selected, or hold a booking
  on it — the same evidence join the coaching evidence gate uses.
- **Find briefs** (no campaign): through the offers the *same
  business* composed from that brief within 7 days, identified by
  the `sourceBrief` threading (Builds -144/-145/-146) — the
  offer's direct target, its applicants, and its bookings are the
  picks. The bridge is the stored brief, never inferred from
  offer content.

**Row schema** (one row per impression × shown creator):

| field | meaning |
|---|---|
| `impressionId`, `creatorId`, `ts` | the impression and the creator shown |
| `briefSource`, `campaignId`, `via`, `joinVia` | how the brief ran (`campaign`/`filters`/…) and how its outcome joined (`campaign`/`source_brief`) |
| `market`, `category`, `kind`, `budget` | the brief's context (market is the market name as captured — Raleigh and Charlotte are always separate markets) |
| `rank`, `shownCount` | the creator's position in the shown list and the list's size |
| `score` | the formula's score at capture time |
| `features` | the score's ingredient vector, verbatim from `match.parts`: `localPct`, `category` (+signal/label), `budget` (+signal), `reliability` (+basis, deliveries, onTimePct), `momentum` (points), `trackBonus`, `trackReach`, `trackPosts`, `trackRedemptions` |
| `picked` | 1/0 |
| `pickStage` | `applied` \| `selected` \| `booked` \| `direct` \| null — the strongest stage reached |
| `offerId` | the offer the pick joined through |
| `delivery` | `on_time` \| `late` \| `no_show` \| null — null while the visit's story is unfinished; an unfinished visit is never a label. `no_show` comes from the compliance ladder's own marks (window expired unused, or a counted silent no-show) |

## The judge — `scripts/eval-ranker.mjs`

Offline only. Never in a request path, never writes to the store.

```
node scripts/eval-ranker.mjs --file pairs.jsonl [--min-picks 200] [--min-briefs 30] [--train-share 0.8]
```

- **Volume floor (path a).** Below **200 picked outcomes** across
  **30 distinct briefs with a pick**, the verdict is
  `NOT ENOUGH DATA` with the real counts printed. Training below
  the floor would memorize, not learn.
- **Time-ordered split (path b).** Labeled briefs sort by time;
  the earliest `train-share` train, the latest are held out. A
  random split would leak the future into the past.
- **The candidate.** Pointwise logistic regression on the
  formula's own parts (scaled to ~[0,1]; local % null → 0, as the
  formula treats an unreported share; momentum → min(100,
  points)/100; track bonus → /8), full-batch gradient descent,
  learning rate 0.5, 3000 epochs, L2 1e-3, zero init — no
  dependencies, fully deterministic. (3000 epochs is measured,
  not guessed: at a few hundred, the descent under-reports
  quieter features and can flip their sign.)
- **The formula's side** is recomputed from each row's stored
  features with the live weights imported from `lib/match.js`, so
  the judge always faces the formula as it exists today.
- **Metrics** on held-out briefs (≥2 shown, ≥1 pick): pairwise
  win rate (picked ranked above each unpicked shown creator;
  ties count half), mean rank of the picked creator (ties broken
  by shown order), top-3 hit rate. The verdict line compares
  pairwise wins.

**Synthetic fixture.** `scripts/gen-synthetic-training.mjs`
writes `scripts/fixtures/synthetic-training-pairs.jsonl` — fake
briefs whose picks follow a *different* truth than the formula
(reliability- and local-led, Momentum nearly irrelevant), with
scores/parts computed by the real `computeMatchScore`. Every row
carries `synthetic: true`; the harness warns when it reads the
file. It exists so path (b) is proven working today. It never
enters the store or an export.

## Suggestion outcome matching

When Jeff takes a suggestion's door, the act endpoint stamps
`outcome.actedAt`. `runSuggestionOutcomeSweep()` (router) then
checks, inside **7 days**, for the downstream fact and stamps
`outcome.status` = `achieved` / `not_yet` / `window_expired`,
logging `suggestion_outcome` on terminal stamps. It runs
opportunistically on API traffic (throttled to one pass per 6
hours), via `POST /api/admin/suggestions/outcomes/sweep`
(sweep-token or admin), and daily from
`netlify/functions/suggestion-outcome-sweep.mjs`.

Kinds with a clean signal: **waiting** (the named queue shrank),
**recruit** (the cell's supply rose), **gate** (the market's
bookable count rose), **cooling** (the named creator took an own
action — E1's definition), **quiet** (the starving offer drew an
application / the dormant business published), **curriculum**
(≥5 asks in the cluster inside the window and the
unanswered+fallback share fell below the receipt's).

Kinds that stay **manual** — never stamped, because no clean
7-day signal exists and a stamped guess is worse than none:
**gap, funnel, backlog, pricing, pricing_gap**.
