#!/usr/bin/env node
// Build -93 verification: Admin creator funnel instrumentation
// (Tier 1 item 9, Jeff ordered 2026-11-02).
//
// Proves, against a seeded throwaway store served by the real dev
// server on port 8968:
//   - GET /admin/command/funnel returns per-market counts for the
//     four stages (claimed, approved, finished, first offer taken)
//     that exactly match the seeded stages in two markets, with
//     step-to-step percentages;
//   - "finished" is approved + profileCompleteOf (the Build -65
//     gate), including a grandfathered pre-2026-11-01 record whose
//     audience is under 500 but complete under its own standard;
//   - "first offer taken" means a live booking (not a bare
//     application, not a cancelled booking, not a +1 companion
//     booking, not a booking from a tester business);
//   - tester accounts and a Build -67 demo showcase creator are
//     excluded from every stage, even with ?testers=1;
//   - markets sort by claimed count, the all-markets totals row is
//     the sum of the market rows, unlisted creators are reported
//     apart and are not in the totals, and a market with no
//     creators shows zeros with null percentages (no error);
//   - non-admin and anonymous callers are refused;
//   - source: the Admin Stats/Command Center surface renders the
//     funnel section (Overview, under the sign-up board, and the
//     Markets view) from this endpoint; the build stamp is
//     unchanged (no stamp bump in this lane).
//
// Run: node scripts/verify-build93.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8968;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "build93-admin-pass";

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}

function startServer(db, port) {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL, ADMIN_PASSWORD };
  const s = spawn("node", ["scripts/dev-server.mjs", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  s.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return s;
}
async function waitUp(base) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not come up on ${base}`);
}

// ---------- seeded store ----------
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-93", salt, 64).toString("hex");
const TS = "2026-11-02T12:00:00.000Z"; // after the 500-minimum ruling -> the gate minimum applies
const OLD = "2026-10-15T12:00:00.000Z"; // before the ruling -> grandfathered standard
const complete = (handle, extra = {}) => ({ handle, followerCount: 3000, categories: ["Food & Drink"], localAudiencePct: 72, ...extra });
const incomplete = (handle) => ({ handle, followerCount: 900, categories: ["Food & Drink"] }); // no local % -> unfinished
const creator = (id, market, status, creatorObj, over = {}) => ({
  id, role: "creator", email: `${id}@fixtures.dev`, name: `Creator ${id}`,
  passwordSalt: salt, passwordHash: hash, status, market, city: market,
  createdAt: TS, updatedAt: TS, tester: false, creator: creatorObj, ...over,
});
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };

// Businesses: one real, one tester.
putUser({ id: "biz-real", role: "business", email: "biz@fixtures.dev", name: "Real Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: TS, updatedAt: TS, business: { businessName: "Real Bistro", category: "Restaurant", accessState: "active" } });
putUser({ id: "biz-tester", role: "business", email: "biztester@fixtures.dev", name: "Tester Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Austin", city: "Austin", createdAt: TS, updatedAt: TS, tester: true, business: { businessName: "Tester Bistro", category: "Restaurant", accessState: "active" } });

// Nashville: claimed-only / approved-unfinished / finished /
// finished+taken / finished+applied-only / finished+cancelled,
// plus an excluded tester and an excluded demo showcase creator.
putUser(creator("nash-claimed", "Nashville", "pending", incomplete("nashclaimed")));
putUser(creator("nash-unfinished", "Nashville", "approved", incomplete("nashunfinished")));
putUser(creator("nash-finished", "Nashville", "approved", complete("nashfinished")));
putUser(creator("nash-taken", "Nashville", "approved", complete("nashtaken")));
putUser(creator("nash-applied", "Nashville", "approved", complete("nashapplied")));
putUser(creator("nash-cancelled", "Nashville", "approved", complete("nashcancelled")));
putUser(creator("nash-tester", "Nashville", "approved", complete("nashtester"), { tester: true }));
putUser(creator("nash-demo", "Nashville", "approved", complete("tesstastestn"), { tester: true, demoShowcase: "nashville-2026-11" }));

// Austin: finished+taken / grandfathered finished / claimed-only /
// finished whose only booking came from a tester business.
putUser(creator("aus-taken", "Austin", "approved", complete("austaken")));
putUser(creator("aus-grandfathered", "Austin", "approved", { handle: "ausgrand", followerCount: 120, categories: ["Food & Drink"], localAudiencePct: 65 }, { createdAt: OLD }));
putUser(creator("aus-claimed", "Austin", "pending", incomplete("ausclaimed")));
putUser(creator("aus-testerbiz", "Austin", "approved", complete("austesterbiz")));

// Unlisted: no market yet — reported apart, never in the totals.
putUser(creator("unl-one", "Not listed yet", "pending", incomplete("unlone"), { city: "Clarksville" }));

const booking = (id, creatorId, market, over = {}) => {
  data[`booking:${id}`] = { id, offerId: `offer-${id}`, businessId: "biz-real", creatorId, market, kind: "comp", status: "booked", createdAt: TS, updatedAt: TS, ...over };
};
booking("bk-taken", "nash-taken", "Nashville");
booking("bk-cancelled", "nash-cancelled", "Nashville", { status: "cancelled" });
booking("bk-plusone", "nash-finished", "Nashville", { collabRole: "plusone" });
booking("bk-tester", "nash-tester", "Nashville");
booking("bk-demo", "nash-demo", "Nashville");
booking("bk-aus-taken", "aus-taken", "Austin", { status: "completed" });
booking("bk-aus-testerbiz", "aus-testerbiz", "Austin", { businessId: "biz-tester" });
data["application:app-applied"] = { id: "app-applied", offerId: "offer-x", businessId: "biz-real", creatorId: "nash-applied", market: "Nashville", status: "applied", createdAt: TS, updatedAt: TS };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build93-"));
const DB = path.join(tmp, "db.json");
fs.writeFileSync(DB, JSON.stringify(data));

const EXPECTED = {
  Nashville: { claimed: 6, approved: 5, finished: 4, firstOfferTaken: 1, rates: { approvedFromClaimed: 83.3, finishedFromApproved: 80, firstOfferTakenFromFinished: 25 } },
  Austin: { claimed: 4, approved: 3, finished: 3, firstOfferTaken: 1, rates: { approvedFromClaimed: 75, finishedFromApproved: 100, firstOfferTakenFromFinished: 33.3 } },
  totals: { claimed: 10, approved: 8, finished: 7, firstOfferTaken: 2, rates: { approvedFromClaimed: 80, finishedFromApproved: 87.5, firstOfferTakenFromFinished: 28.6 } },
};

console.log("== Build -93: creator funnel ==");
const server = startServer(DB, PORT);
try {
  await waitUp(BASE);
  const admin = new Client(BASE);
  const login = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", login.status === 200 && login.data.user && login.data.user.role === "admin", `status=${login.status}`);

  const r = await admin.req("GET", "/api/admin/command/funnel");
  check("funnel endpoint answers 200 for admin", r.status === 200, `status=${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  const f = r.data || {};
  const byMarket = Object.fromEntries((f.markets || []).map((m) => [m.market, m]));
  for (const [name, exp] of Object.entries(EXPECTED)) {
    const row = name === "totals" ? f.totals : byMarket[name];
    check(`${name}: counts claimed/approved/finished/firstOfferTaken = ${exp.claimed}/${exp.approved}/${exp.finished}/${exp.firstOfferTaken}`,
      !!row && row.claimed === exp.claimed && row.approved === exp.approved && row.finished === exp.finished && row.firstOfferTaken === exp.firstOfferTaken,
      JSON.stringify(row));
    check(`${name}: step-to-step percentages ${exp.rates.approvedFromClaimed}/${exp.rates.finishedFromApproved}/${exp.rates.firstOfferTakenFromFinished}`,
      !!row && JSON.stringify(row.rates) === JSON.stringify(exp.rates), row && JSON.stringify(row.rates));
  }
  check("markets sorted by claimed count (Nashville first, Austin second)",
    !!f.markets && f.markets[0].market === "Nashville" && f.markets[1].market === "Austin",
    f.markets && f.markets.slice(0, 3).map((m) => `${m.market}:${m.claimed}`).join(","));
  const sum = (k) => (f.markets || []).reduce((s, m) => s + m[k], 0);
  check("totals row is the sum of the market rows",
    !!f.totals && ["claimed", "approved", "finished", "firstOfferTaken"].every((k) => f.totals[k] === sum(k)),
    `totals=${JSON.stringify(f.totals)} sums=${JSON.stringify({ claimed: sum("claimed"), approved: sum("approved"), finished: sum("finished"), firstOfferTaken: sum("firstOfferTaken") })}`);
  const zero = byMarket["Chicago"];
  check("a market with zero creators shows zeros and null percentages, not an error",
    !!zero && zero.claimed === 0 && zero.approved === 0 && zero.finished === 0 && zero.firstOfferTaken === 0
    && zero.rates.approvedFromClaimed === null && zero.rates.finishedFromApproved === null && zero.rates.firstOfferTakenFromFinished === null,
    JSON.stringify(zero));
  check("every market in the roster has a funnel row", Array.isArray(f.markets) && f.markets.length >= 30, `rows=${f.markets && f.markets.length}`);
  check("unlisted creators reported apart (1 claimed, 0 approved) and out of the totals",
    !!f.unlisted && f.unlisted.claimed === 1 && f.unlisted.approved === 0 && f.totals.claimed === 10,
    JSON.stringify(f.unlisted));
  check("definitions ride the payload in plain words",
    !!f.definitions && /creator record in the market/.test(f.definitions.claimed) && /profile gate/.test(f.definitions.finished) && /live booking/.test(f.definitions.firstOfferTaken) && /Applying alone does not count/.test(f.definitions.firstOfferTaken),
    JSON.stringify(f.definitions));
  check("payload states testers/demo are excluded", !!f.filters && f.filters.testersIncluded === false && /demo showcase/.test(f.filters.excludedByDefault || ""), JSON.stringify(f.filters));

  const withTesters = await admin.req("GET", "/api/admin/command/funnel?testers=1");
  check("?testers=1 cannot inflate the funnel (counts unchanged)",
    withTesters.status === 200 && withTesters.data.totals.claimed === 10 && withTesters.data.totals.firstOfferTaken === 2,
    JSON.stringify(withTesters.data && withTesters.data.totals));

  // Reconciliation with the sign-up board (Build -53): per market,
  // funnel claimed == board creators signedUp, approved ==
  // approved, finished == profileFinished.
  const stats = await admin.req("GET", "/api/admin/stats");
  const board = Object.fromEntries(((stats.data.signupBoard || {}).markets || []).map((m) => [m.market, m.creators]));
  check("funnel reconciles with the sign-up board (Nashville + Austin signedUp/approved/finished)",
    !!board.Nashville && !!board.Austin
    && byMarket.Nashville.claimed === board.Nashville.signedUp && byMarket.Nashville.approved === board.Nashville.approved && byMarket.Nashville.finished === board.Nashville.profileFinished
    && byMarket.Austin.claimed === board.Austin.signedUp && byMarket.Austin.approved === board.Austin.approved && byMarket.Austin.finished === board.Austin.profileFinished,
    JSON.stringify(board));

  // Non-admin access is refused.
  const creatorClient = new Client(BASE);
  const clogin = await creatorClient.req("POST", "/api/auth/login", { email: "nash-finished@fixtures.dev", password: "fixture-pass-93" });
  check("seeded creator can sign in (refusal below is the admin gate, not the login)", clogin.status === 200, `status=${clogin.status}`);
  const denied = await creatorClient.req("GET", "/api/admin/command/funnel");
  check("creator access to the funnel is refused (403)", denied.status === 403, `status=${denied.status}`);
  const anon = await new Client(BASE).req("GET", "/api/admin/command/funnel");
  check("anonymous access to the funnel is refused (401/403)", anon.status === 401 || anon.status === 403, `status=${anon.status}`);
} finally {
  server.kill();
}

// ---------- source checks ----------
console.log("== Source checks ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("Admin renders the funnel section from the endpoint", appJs.includes("ccFunnelHtml") && appJs.includes("Creator funnel by market") && appJs.includes("/admin/command/funnel"), "");
  const overviewSrc = appJs.slice(appJs.indexOf("function ccOverviewHtml("));
  check("funnel section sits under the sign-up board on Overview", overviewSrc.indexOf("adminSignupBoardHtml(s.signupBoard)") >= 0 && overviewSrc.indexOf("adminSignupBoardHtml(s.signupBoard)") < overviewSrc.indexOf("ccFunnelHtml(funnel)"), "");
  check("funnel section carries the plain-words stage key", appJs.includes("First offer taken") && appJs.includes("left out of every stage, always"), "");
  check("server computes the funnel from creator + booking records (profileCompleteOf, live-booking test)", routerJs.includes("ccFunnel") && routerJs.includes("profileCompleteOf") && routerJs.includes('bk.collabRole === "plusone"'), "");
  check("build stamp is 2026.11.02-103 on both sides",
    fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('exports.BUILD_ID = "2026.11.02-103"')
    && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.02-103"'), "");
}

console.log(`\nBuild -93 verify: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
