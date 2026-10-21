// Referral ladder v2 + SIGNL Elite (Jeff, 2026-10-21): badges and
// bonus Momentum points only, no guarantees, nothing stored. This
// suite exercises the computed ladder inside createMomentum with
// in-memory fixtures:
//   - milestones count APPROVED referrals only (testers, banned,
//     rejected and self-referrals never count)
//   - a milestone unlocks only when the referral who tripped it
//     has delivered their first post; pending pays nothing
//   - bonuses are Momentum ledger entries with distinct kinds
//     (referral_milestone_1/3/5/10) and stack with the base
//     +3/+10 referral points
//   - SIGNL Elite is computed: 10+ on-time posts AND rating >= 4.5
//     across >= 5 ratings AND good standing; it is lost when the
//     inputs drop, and it never mints points by itself
// Run: node scripts/verify-ladder.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createMomentum, REFERRAL_MILESTONES, ELITE_RULE } = require("../netlify/functions/lib/router.js");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

let seq = 0;
function creator(handle, extra = {}) {
  seq += 1;
  const base = {
    id: `u-${handle}`,
    role: "creator",
    status: "approved",
    email: `${handle}@x.test`,
    name: handle,
    market: "Hampton Roads",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    creator: { handle, hasPhoto: false, bio: "", neighborhood: "", localAudiencePct: null, audienceStack: {}, bestWork: [], followerCount: 0 },
  };
  return { ...base, ...extra, creator: { ...base.creator, ...(extra.creator || {}) } };
}
function referred(handle, referrer, day, extra = {}) {
  return creator(handle, {
    referredBy: referrer,
    createdAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    reviewedAt: `2026-10-${String(day).padStart(2, "0")}T01:00:00.000Z`,
    ...extra,
  });
}
function post(creatorId, day, onTime = true) {
  return { id: `p-${creatorId}-${day}`, creatorId, bookingId: `b-${creatorId}-${day}`, submittedAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`, onTime };
}
function review(creatorId, stars, n) {
  return { id: `r-${creatorId}-${n}`, creatorId, stars, createdAt: "2026-10-15T00:00:00.000Z" };
}
function engine(users, posts = [], reviews = []) {
  return createMomentum({ users, bookings: [], posts, reviews, bizReviews: [] });
}

check("milestone table is the v2 table (badges + points only)", JSON.stringify(REFERRAL_MILESTONES.map((m) => [m.milestone, m.name, m.bonus])) === JSON.stringify([[1, "Connector", 25], [3, "Super Connector", 50], [5, "Roster Builder", 75], [10, "City Lead", 150]]));
check("elite rule constants", ELITE_RULE.minOnTimePosts === 10 && ELITE_RULE.minRatingAvg === 4.5 && ELITE_RULE.minRatings === 5);

// --- counts: sign-ups vs approved, pending unlock ---
{
  const r = creator("referrer1");
  const a = referred("alpha", "referrer1", 2);
  const b = referred("bravo", "referrer1", 3);
  const pendingSignup = referred("charlie", "referrer1", 4, { status: "pending" });
  const m = engine([r, a, b, pendingSignup]);
  const l = m.ladderFor(r);
  check("counts: signups 3, approvedReferrals 2", l.signups === 3 && l.approvedReferrals === 2, JSON.stringify({ s: l.signups, a: l.approvedReferrals }));
  check("milestone 1 reached but pending unlock (tripping referral has no post)", l.milestones[0].state === "pending_unlock" && l.milestones[0].trippingHandle === "alpha", JSON.stringify(l.milestones[0]));
  check("milestone 3 not reached at 2 approved", l.milestones[1].state === "not_reached");
  check("no badges and no bonus while pending", l.badges.length === 0 && !m.detailFor(r).ledger.some((e) => e.kind.startsWith("referral_milestone")));
  check("next points at milestone 1 pending", l.next && l.next.milestone === 1 && l.next.state === "pending_unlock");
}

// --- unlock on the tripping referral's first post; idempotent ---
{
  const r = creator("referrer2");
  const a = referred("alpha2", "referrer2", 2);
  const m = engine([r, a], [post("u-alpha2", 5)]);
  const l = m.ladderFor(r);
  check("milestone 1 unlocked once the tripping referral posts", l.milestones[0].state === "unlocked");
  check("Connector badge present", l.badges.some((b) => b.id === "connector" && b.kind === "milestone"));
  const d1 = m.detailFor(r);
  const bonus = d1.ledger.filter((e) => e.kind === "referral_milestone_1");
  check("bonus entry: kind referral_milestone_1, +25, dated at the first post", bonus.length === 1 && bonus[0].points === 25 && bonus[0].at === "2026-10-05T12:00:00.000Z", JSON.stringify(bonus));
  const d2 = m.detailFor(r);
  check("idempotent: repeated reads never double-pay", d2.points === d1.points && d2.ledger.filter((e) => e.kind === "referral_milestone_1").length === 1);
  check("total = +3 signup + +10 approval + +25 bonus", d1.points === 38, String(d1.points));
}

// --- a non-tripping referral's post does not unlock early ---
{
  const r = creator("referrer3");
  const a = referred("a3", "referrer3", 2);
  const b = referred("b3", "referrer3", 3);
  const c = referred("c3", "referrer3", 4);
  const m = engine([r, a, b, c], [post("u-a3", 5), post("u-b3", 6)]);
  const l = m.ladderFor(r);
  check("milestone 1 unlocked (trip a3 posted)", l.milestones[0].state === "unlocked");
  check("milestone 3 stays pending: trip c3 has not posted even though a3/b3 have", l.milestones[1].state === "pending_unlock" && l.milestones[1].trippingHandle === "c3", JSON.stringify(l.milestones[1]));
}

// --- exclusions: tester, banned, rejected, self by email ---
{
  const r = creator("referrer4");
  const good = referred("good4", "referrer4", 2);
  const tester = referred("tester4", "referrer4", 3, { tester: true });
  const banned = referred("banned4", "referrer4", 4, { status: "banned" });
  const rejected = referred("rej4", "referrer4", 5, { status: "rejected" });
  const selfByEmail = referred("self4", "referrer4", 6, { email: "referrer4@x.test" });
  const m = engine([r, good, tester, banned, rejected, selfByEmail], [post("u-good4", 7), post("u-tester4", 7), post("u-self4", 7)]);
  const l = m.ladderFor(r);
  check("only the genuine approved referral counts (tester/banned/rejected/self excluded)", l.approvedReferrals === 1, String(l.approvedReferrals));
  check("milestone 1 unlocks on the genuine referral alone", l.milestones[0].state === "unlocked" && l.badges.length === 1);
}

// --- full ladder math at 10 ---
{
  const r = creator("referrer5");
  const crew = [];
  const posts = [];
  for (let i = 1; i <= 10; i++) {
    crew.push(referred(`crew${i}`, "referrer5", i + 1));
    posts.push(post(`u-crew${i}`, 20));
  }
  const m = engine([r, ...crew], posts);
  const l = m.ladderFor(r);
  check("all four milestones unlocked at 10 posting referrals", l.milestones.every((x) => x.state === "unlocked"));
  check("four milestone badges, no elite without ratings/posts of their own", l.badges.length === 4 && !l.badges.some((b) => b.kind === "elite"));
  const d = m.detailFor(r);
  check("total = 10x3 signups + 10x10 approvals + (25+50+75+150) bonuses = 430", d.points === 430, String(d.points));
  check("bonus kinds are distinct per milestone", [1, 3, 5, 10].every((n) => d.ledger.some((e) => e.kind === `referral_milestone_${n}`)));
  check("next is null at the top of the ladder", l.next === null);
}

// --- SIGNL Elite matrix ---
function eliteFixture({ postsN = 10, stars = [5, 5, 4, 5, 4], standing = null, status = "approved" } = {}) {
  const e = creator("elite1", { status, ...(standing ? { standing } : {}) });
  const posts = [];
  for (let i = 1; i <= postsN; i++) posts.push(post("u-elite1", i, true));
  const reviews = stars.map((s, i) => review("u-elite1", s, i));
  return { e, m: engine([e], posts, reviews) };
}
{
  const { e, m } = eliteFixture({});
  const l = m.ladderFor(e);
  check("elite: 10 on-time posts + 4.6 avg over 5 ratings qualifies", l.elite.qualified === true && l.badges.some((b) => b.kind === "elite" && b.name === "SIGNL Elite"), JSON.stringify(l.elite));
  check("elite mints no points: total is the posts' own 200 + 2 streak bonuses (250)", m.detailFor(e).points === 250, String(m.detailFor(e).points));
}
{
  const { e, m } = eliteFixture({ postsN: 9 });
  check("elite: 9 on-time posts does not qualify", m.ladderFor(e).elite.qualified === false);
}
{
  const { e, m } = eliteFixture({ stars: [5, 4, 4, 5, 4] });
  check("elite: 4.4 average does not qualify", m.ladderFor(e).elite.qualified === false);
}
{
  const { e, m } = eliteFixture({ stars: [5, 5, 5, 5] });
  check("elite: 4 ratings does not qualify (needs 5)", m.ladderFor(e).elite.qualified === false);
}
{
  const { e, m } = eliteFixture({ standing: { state: "paused", at: "2026-10-10T00:00:00.000Z" } });
  check("elite: paused standing does not qualify", m.ladderFor(e).elite.qualified === false);
}
{
  const { e, m } = eliteFixture({ stars: [5, 5, 4, 5, 4, 1] });
  check("elite: a later low rating drops the average and the badge is lost", m.ladderFor(e).elite.qualified === false && !m.badgesFor(e).some((b) => b.kind === "elite"));
}
{
  const { e, m } = eliteFixture({ stars: [] });
  const withRatings = eliteFixture({});
  check("elite purity: ratings change no Momentum points", m.detailFor(e).points === withRatings.m.detailFor(withRatings.e).points);
}

// --- a creator with no referrals is untouched ---
{
  const solo = creator("solo1");
  const m = engine([solo]);
  const l = m.ladderFor(solo);
  check("no referrals: ladder empty, no badges, no bonus entries", l.approvedReferrals === 0 && l.badges.length === 0 && !m.detailFor(solo).ledger.some((e) => e.kind.startsWith("referral_milestone")));
  const sum = m.summaryFor(solo);
  check("summaryFor still carries signups/approved/points (campusCrew rides along from the campus build)", sum.signups === 0 && sum.approved === 0 && sum.points === 0 && "campusCrew" in sum);
}

// --- client copy guards ---
{
  const appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf-8");
  const ladderBlock = appJs.slice(appJs.indexOf("function ladderHtml"), appJs.indexOf("function paidLaneBadgesHtml"));
  check("dashboard ladder copy present with the four badges and bonuses", ladderBlock.includes("Referral badges") && ladderBlock.includes("Connector badge, +25") && ladderBlock.includes("City Lead, +150"));
  check("ladder copy carries no em dash", !ladderBlock.includes("—") && !ladderBlock.includes("–"));
  check("GA4 loader present with Jeff's property id", appJs.includes("G-0V1YPFCTSD") && appJs.includes("googletagmanager.com/gtag/js"));
  check("badgesHtml renders the elite badge distinctly", appJs.includes('class="badge elite">SIGNL Elite'));
}

console.log(`\nverify-ladder: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
