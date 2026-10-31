// Build 2026.10.31-61 verification: Halo, the modeled
// influence layer inside the SIGNL ROAS Score (Jeff's order,
// 2026-10-30). Spec: signl-halo-model-2026-10-30.md.
//
// Halo estimates the UNCOUNTED remainder of a post's pull:
// effective views (engagement weighted) x the creator's local
// share x the platform intent rate, recognized on a 90-day
// maturation curve, minus the firsts the register already
// counted for that visit, floored at zero, valued at the
// business's average check. The headline figure blends
// counted + Halo estimated; the counted-only score, the
// floor sentence, and the labeled split all survive, and the
// public Proof Card carries no Halo at all.
//
// The fixture mirrors the spec's worked example: Amy's post
// (10,000 views, 100 likes, 10 comments, 5 shares, 82% local)
// inside the -39 Kitchen cohort (615 counted back over 344
// all in, counted score 1.8). At 45 days the model must
// recognize ~27.7 of its ~34.0 ultimate visits, count 4 of
// them as already counted, and blend the rest into the
// headline: about 23.7 Halo visits, about $1,351 at the
// register average check of $57 (firsts only), headline
// about 5.7x against the counted-only 1.8x, which must not
// move. These are the spec's worked-example numbers exactly.
//
// Calibration: the rate tunes toward the published capture
// target (modeled ultimate = 3x counted) by a damped,
// step-capped move. A too-small sample logs a skipped run
// (never a silent no-op); a matured, counted-heavy sample
// moves the rate by the capped step and logs old and new.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8915;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = `/tmp/signl-verify-build45-${Date.now()}.json`;
const ADMIN_EMAIL = "admin@verify.local";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DAY = 86400000;

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; failures.push(name + (detail ? " — " + detail : "")); console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

function client() {
  const jar = new Map();
  async function call(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (jar.size) headers.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, data, headers: res.headers };
  }
  return call;
}

let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function makeCreator(admin, { name, email, handle }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle, followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"],
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await c("PATCH", "/api/me/profile", { publicPage: true });
  return { client: c, id: reg.data.user.id, handle, user: reg.data.user };
}
async function makeBusiness(admin, { name, businessName, email, planId = "growth" }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "business", name, businessName, email, password: "business-pass-123", market: "Richmond", city: "Richmond",
    category: "Restaurant", planId, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: reg.data.user.id });
  return { client: c, id: reg.data.user.id, user: reg.data.user };
}
async function makeBooking(biz, creator, title) {
  const off = await biz.client("POST", "/api/offers", { title, whatComped: "Dinner for two", dollarCap: 60, spots: 1, includesAlcohol: false, creatorId: creator.id });
  if (off.status !== 201) throw new Error(`offer failed: ${JSON.stringify(off.data)}`);
  const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
  if (acc.status !== 201) throw new Error(`accept failed: ${JSON.stringify(acc.data)}`);
  await biz.client("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
  return acc.data.booking;
}
async function completeVisit(creator, booking, slug) {
  const post = await creator.client("POST", "/api/posts", { bookingId: booking.id, url: `https://www.instagram.com/p/${slug}/`, includesDisclosure: true });
  if (post.status !== 201) throw new Error(`post failed: ${JSON.stringify(post.data)}`);
  return post.data.post;
}
async function logFirst(biz, bookingId, amount) {
  const r = await biz.client("POST", `/api/bookings/${bookingId}/code-uses`, { count: 1, amount });
  if (r.status !== 201) throw new Error(`code-use failed: ${JSON.stringify(r.data)}`);
  return r.data;
}

// The model, replicated from the spec (signl-halo-model):
// effective views, intent prior, 82% local, and the
// normalized saturating maturation curve (exponential
// approach, 21-day half-life, exactly 1.0 on day 90).
const EFF = 10000 + 100 * 2 + 10 * 8 + 5 * 15; // 10,355
const ULTIMATE = EFF * 0.004 * 0.82;          // 33.9644
const maturity = (ageDays) => ageDays <= 0 ? 0 : ageDays >= 90 ? 1 : (1 - Math.pow(2, -ageDays / 21)) / (1 - Math.pow(2, -90 / 21));

try {
  startServer();
  check("dev server boots", await waitUp());
  const boot = await fetch(BASE + "/api/bootstrap");
  check("bootstrap carries the -45 build stamp", boot.headers.get("x-signl-build") === "2026.10.31-61", String(boot.headers.get("x-signl-build")));
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const anon = client();
  await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });

  // ---------- the Kitchen cohort (the -39 fixture) ----------
  const amy = await makeCreator(admin, { name: "Halo Amy", email: "amy45@fixtures.dev", handle: "haloamy" });
  const ben = await makeCreator(admin, { name: "Halo Ben", email: "ben45@fixtures.dev", handle: "haloben" });
  const kitchen = await makeBusiness(admin, { name: "Kai Owner", businessName: "Halo Kitchen", email: "kai45@fixtures.dev" });

  await kitchen.client("PATCH", "/api/me/profile", { discountEnabled: true, discountPct: 10 });
  const bk1 = await makeBooking(kitchen, amy, "Halo Night One");
  await kitchen.client("PATCH", "/api/me/profile", { discountEnabled: false });
  await completeVisit(amy, bk1, "V45ONE");
  const f1 = await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  await kitchen.client("POST", "/api/me/passes/redeem", { code: f1.issuedPass.code, amount: 45 });
  await amy.client("POST", `/api/bookings/${bk1.id}/performance`, { views: 10000, likes: 100, comments: 10, shares: 5 });
  await kitchen.client("POST", `/api/bookings/${bk1.id}/comp-cost`, { amount: 30 });

  const bk2 = await makeBooking(kitchen, amy, "Halo Night Two");
  await completeVisit(amy, bk2, "V45TWO");
  await logFirst(kitchen, bk2.id, 50);
  await logFirst(kitchen, bk2.id, 50);
  await logFirst(kitchen, bk2.id, 50);
  await kitchen.client("POST", `/api/bookings/${bk2.id}/comp-cost`, { amount: 25 });
  const bk3 = await makeBooking(kitchen, ben, "Halo Night Three");
  await completeVisit(ben, bk3, "V45THREE");
  await logFirst(kitchen, bk3.id, 20);
  await logFirst(kitchen, bk3.id, 20);
  await logFirst(kitchen, bk3.id, 20);
  await kitchen.client("POST", `/api/bookings/${bk3.id}/comp-cost`, { confirmedZero: true });

  // ---------- age zero: the blend is the counted score ------
  const r0 = await kitchen.client("GET", "/api/me/receipt");
  const cur0 = r0.data.receipt.scoreV2.current;
  check("age zero: a brand-new post has recognized nothing yet (Halo adds 0)",
    cur0.halo && cur0.halo.estDollars === 0 && cur0.halo.estVisits === 0,
    JSON.stringify(cur0.halo));
  check("age zero: the headline IS the counted score (1.8x) and the v2 fields are untouched",
    cur0.score === 1.8 && cur0.headline && cur0.headline.score === 1.8 && cur0.headline.haloDollars === 0 && cur0.countedBack === 615 && cur0.cost.total === 344,
    JSON.stringify({ score: cur0.score, headline: cur0.headline, back: cur0.countedBack }));
  check("age zero: the model block states its version, rate, and confidence plainly",
    cur0.halo.model && cur0.halo.model.intentRate === 0.004 && /Halo v1/.test(cur0.halo.version) && cur0.halo.confidence && cur0.halo.confidence.level === "early" && /Halo is young/.test(cur0.halo.confidence.words),
    JSON.stringify(cur0.halo.model) + " " + JSON.stringify(cur0.halo.confidence));
  const v1row0 = cur0.visits.find((v) => v.bookingId === bk1.id);
  check("age zero: the per-visit Halo block rides the visit row (effective views 10,355, ultimate 33.96)",
    v1row0 && v1row0.halo && v1row0.halo.effViews === EFF && v1row0.halo.ultimateVisits === 33.96 && v1row0.halo.estDollars === 0,
    JSON.stringify(v1row0 && v1row0.halo));
  const home0 = await kitchen.client("GET", "/api/me/business-home");
  check("home: the business Home subset carries the headline fields (blend ready, zero at age zero)",
    home0.data.home.roasV2 && home0.data.home.roasV2.score === 1.8 && home0.data.home.roasV2.headlineScore === 1.8 && home0.data.home.roasV2.haloDollars === 0,
    JSON.stringify(home0.data.home && home0.data.home.roasV2));

  // ---------- de-dup: counted past the model means zero -----
  const dee = await makeCreator(admin, { name: "Dedup Dee", email: "dee45@fixtures.dev", handle: "dedupdee" });
  const diner = await makeBusiness(admin, { name: "Dee Owner", businessName: "Dedup Diner", email: "diner45@fixtures.dev" });
  const bkD = await makeBooking(diner, dee, "Dedup Night");
  await completeVisit(dee, bkD, "V45DEDUP");
  await dee.client("POST", `/api/bookings/${bkD.id}/performance`, { views: 100, likes: 0, comments: 0, shares: 0 });
  for (let i = 0; i < 5; i++) await logFirst(diner, bkD.id, 40);
  await diner.client("POST", `/api/bookings/${bkD.id}/comp-cost`, { amount: 20 });
  const rD = await diner.client("GET", "/api/me/receipt");
  const curD = rD.data.receipt.scoreV2.current;
  const dRow = curD.visits.find((v) => v.bookingId === bkD.id);
  check("de-dup: 5 counted firsts against a 0.33-visit model leaves Halo at exactly zero, forever",
    dRow && dRow.halo && dRow.halo.estVisits === 0 && dRow.halo.estDollars === 0 && curD.halo.estDollars === 0 && curD.headline.score === curD.score,
    JSON.stringify({ row: dRow && dRow.halo, cohort: curD.halo, headline: curD.headline, score: curD.score }));

  // ---------- shift the Kitchen 45 days into the past -------
  await stopServer();
  const SHIFT = 45 * DAY;
  const shiftIso = (iso) => (iso ? new Date(Date.parse(iso) - SHIFT).toISOString() : iso);
  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  for (const [key, rec] of Object.entries(db)) {
    if (!rec || typeof rec !== "object") continue;
    if ((key.startsWith("booking:") || key.startsWith("post:") || key.startsWith("redevent:") || key.startsWith("pass:")) && rec.businessId === kitchen.id) {
      for (const f of ["updatedAt", "createdAt", "submittedAt", "reportedAt", "at", "issuedAt", "expiresAt", "redeemedAt"]) if (rec[f]) rec[f] = shiftIso(rec[f]);
    }
    if (key === `user:${kitchen.id}` && rec.business) rec.business.activatedAt = shiftIso(rec.business.activatedAt);
  }
  fs.writeFileSync(DB, JSON.stringify(db));
  startServer();
  check("dev server restarts on the shifted record", await waitUp());

  const shiftedMonth = new Date(Date.now() - SHIFT).toISOString().slice(0, 7);
  const r45 = await kitchen.client("GET", "/api/me/receipt");
  const old = (r45.data.receipt.scoreV2.cohorts || []).find((c) => c.month === shiftedMonth);
  const expM = maturity(45);                       // 0.8154
  const expRecognized = ULTIMATE * expM;           // 27.69
  const expHaloVisits = Math.round((expRecognized - 4) * 10) / 10; // 23.7 (4 counted firsts de-duped)
  const expAvgCheck = 570 / 10;                    // $57: firsts spend over firsts, the register's average check
  const expHaloDollars = expHaloVisits * expAvgCheck; // 1,350.9
  const expHeadline = (615 + expHaloDollars) / 344;   // ~5.72
  check("maturation: at 45 days the cohort carries the modeled remainder (about 23.7 visits, about $1,351)",
    !!old && Math.abs(old.haloDollars - expHaloDollars) <= 6 && old.haloDollars > 1000,
    JSON.stringify({ cohort: old && { haloDollars: old.haloDollars, headlineScore: old.headlineScore }, expected: expHaloDollars }));
  check("maturation: the headline blends to about 5.7x while the counted-only score stands at 1.8x",
    !!old && Math.abs(old.headlineScore - expHeadline) <= 0.25 && old.score === 1.8 && old.countedBack === 615,
    JSON.stringify({ headline: old && old.headlineScore, counted: old && old.score, expected: expHeadline }));
  check("maturation: the trailing-three line stays counted-only (null under two scored months; built from counted fields only)",
    r45.data.receipt.scoreV2.trailing3 === null,
    JSON.stringify(r45.data.receipt.scoreV2.trailing3));

  // ---------- the Proof Card: views yes, Halo never ---------
  const proofAmy = await amy.client("GET", "/api/me/proof-card");
  const haloKeys = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) { if (/halo/i.test(k)) haloKeys.push(k); walk(v); }
  })(proofAmy.data);
  check("proof card: no Halo field anywhere in the public payload (no estimates travel)",
    haloKeys.length === 0, haloKeys.join(","));
  check("proof card: the creator's views roll up across campaigns (10,000 this year, none this week or month)",
    proofAmy.data.proof.viewsRollup && proofAmy.data.proof.viewsRollup.year === 10000 && proofAmy.data.proof.viewsRollup.allTime === 10000 && proofAmy.data.proof.viewsRollup.week === 0 && proofAmy.data.proof.viewsRollup.month === 0,
    JSON.stringify(proofAmy.data.proof.viewsRollup));

  // ---------- calibration: too small logs a skipped run -----
  const anonCal = await anon("POST", "/api/admin/halo/calibrate", {});
  check("calibration: the run refuses anonymous callers", anonCal.status === 403, String(anonCal.status));
  const skipRun = await admin("POST", "/api/admin/halo/calibrate", {});
  check("calibration: a too-small sample logs a skipped run with its reason (no silent drift)",
    skipRun.status === 200 && skipRun.data.calibration && skipRun.data.calibration.kind === "skipped" && /Needs 30 matured posts and 100 counted firsts/.test(skipRun.data.calibration.reason || "") && skipRun.data.calibration.oldRate === 0.004 && skipRun.data.calibration.newRate === 0.004 && skipRun.data.calibration.samplePosts === 1 && skipRun.data.calibration.sampleCounted === 4,
    JSON.stringify(skipRun.data).slice(0, 300));
  const haloState1 = await admin("GET", "/api/admin/halo");
  check("calibration: the admin read shows the model, the sample stats, and the logged skip (rate unmoved)",
    haloState1.data.halo && haloState1.data.halo.model.intentRate === 0.004 && haloState1.data.halo.stats.samplePosts === 1 && haloState1.data.halo.stats.countedFirsts === 4 && (haloState1.data.halo.log || []).length >= 1 && haloState1.data.halo.log[0].kind === "skipped",
    JSON.stringify(haloState1.data).slice(0, 300));

  // ---------- calibration: a matured sample moves the rate --
  // Inject 40 matured posts for the Kitchen, each with 4
  // counted firsts at $50 against only 100 views: modeled
  // ultimate (47.08) runs far under the capture target of 3x
  // counted (164), so the damped step toward the target,
  // capped at x1.25, must land exactly on 0.004 x 1.25 =
  // 0.005, logged as an adjustment.
  await stopServer();
  const db2 = JSON.parse(fs.readFileSync(DB, "utf8"));
  const iso40 = new Date(Date.now() - 40 * DAY).toISOString();
  for (let i = 0; i < 40; i++) {
    const bid = `bkcal${i}`;
    db2[`booking:${bid}`] = { id: bid, businessId: kitchen.id, creatorId: amy.id, status: "completed", createdAt: iso40, updatedAt: iso40 };
    db2[`post:postcal${i}`] = { id: `postcal${i}`, bookingId: bid, businessId: kitchen.id, creatorId: amy.id, submittedAt: iso40, views: 100, likes: 0, comments: 0, shares: 0, reportedAt: iso40 };
    for (let j = 0; j < 4; j++) {
      db2[`redevent:evcal${i}_${j}`] = { id: `evcal${i}_${j}`, bookingId: bid, businessId: kitchen.id, kind: "first", at: iso40, amount: 50, voided: false };
    }
  }
  fs.writeFileSync(DB, JSON.stringify(db2));
  startServer();
  check("dev server restarts on the injected calibration sample", await waitUp());
  const adjRun = await admin("POST", "/api/admin/halo/calibrate", {});
  check("calibration: a counted-heavy matured sample moves the rate by the capped damped step (0.004 -> 0.005), logged",
    adjRun.status === 200 && adjRun.data.calibration && adjRun.data.calibration.kind === "adjustment" && adjRun.data.calibration.oldRate === 0.004 && adjRun.data.calibration.newRate === 0.005 && adjRun.data.calibration.samplePosts >= 30 && adjRun.data.calibration.sampleCounted >= 100,
    JSON.stringify(adjRun.data).slice(0, 320));
  const haloState2 = await admin("GET", "/api/admin/halo");
  check("calibration: the new rate persists on the model record and both runs stay in the log",
    haloState2.data.halo.model.intentRate === 0.005 && (haloState2.data.halo.log || []).length >= 2 && haloState2.data.halo.log.some((r) => r.kind === "skipped") && haloState2.data.halo.log.some((r) => r.kind === "adjustment"),
    JSON.stringify(haloState2.data).slice(0, 320));

  // ---------- source contracts ----------
  const appSrc = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const routerSrc = fs.readFileSync(path.join(ROOT, "netlify", "functions", "lib", "router.js"), "utf8");
  const scoreBlock = appSrc.slice(appSrc.indexOf("function scoreV2Html"), appSrc.indexOf("function receiptHtml"));
  const roasInfo = appSrc.slice(appSrc.indexOf("const ROAS_INFO"), appSrc.indexOf("};", appSrc.indexOf("const ROAS_INFO")));
  const calFn = fs.readFileSync(path.join(ROOT, "netlify", "functions", "halo-calibrate.mjs"), "utf8");
  const srcChecks = [
    ["client: the split prints with both labels on the Receipt (Counted at register / Halo estimated)", scoreBlock.includes("Counted at register") && scoreBlock.includes("Halo estimated")],
    ["client: the floor sentence survives verbatim in the blended head", scoreBlock.includes("came back through your register from") && scoreBlock.includes("counted dollar by dollar")],
    ["client: the stacked back bar carries the Halo segment class", scoreBlock.includes('cls: "halo"')],
    ["client: no caused or generated claim language in the score block", !/caused|generated/.test(scoreBlock)],
    ["client: the info sheet still carries exactly twelve topics (Halo explains itself in the split, not a thirteenth topic)", (roasInfo.match(/title: "/g) || []).length === 12],
    ["client: the Proof Card renders the views rollup line", appSrc.includes("viewsRollup") && appSrc.includes("across every campaign")],
    ["server: the version line for Halo is stated in the model record", routerSrc.includes("Halo v1") && routerSrc.includes("runHaloCalibration")],
    ["server: the trailing-three aggregate is built from counted fields only (no Halo input)", (() => { const t = routerSrc.slice(routerSrc.indexOf("const trailing3"), routerSrc.indexOf("const current = { ...cohorts[0]")); return t.includes("countedBack") && !/halo/i.test(t); })()],
    ["job: the weekly calibration function is scheduled and calls the admin route", /schedule/.test(calFn) && calFn.includes("/api/admin/halo/calibrate")],
  ];
  for (const [name, ok] of srcChecks) check(name, ok);

  console.log(`\nverify-build45: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
} catch (e) {
  console.error("verify-build45 crashed:", e);
  process.exitCode = 1;
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
