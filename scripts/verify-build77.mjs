#!/usr/bin/env node
// Build -77 verification (Jeff, 2026-11-02): the Impact Portal —
// pilot funding partners. A funder puts up a fund that pays for
// first creator visits at businesses it chose in one city; the
// partner gets its own read-only login scoped to its one pilot.
//
// Proves, against a throwaway local store seeded with real
// records (a pilot, four chosen businesses, a completed paid
// booking with register events, a comp booking with a business
// tally, a post):
//   - the fund ledger: the first pilot-linked paid booking
//     charges the fund exactly once at the booked rate; manual
//     entries add and remove; booking entries cannot be removed;
//     spent/remaining math holds everywhere it is shown;
//   - status derivation: stored steps stand, and real records
//     advance them (booked -> visited -> posted), a live plan
//     reads "continued", a name-only business stays unlinked;
//   - counted vs recorded: register events count as counted
//     (voided events never count), a booking tally counts as
//     recorded, and the two are never summed in any payload;
//   - the fences: a partner sees only its own pilot, cannot
//     write, cannot read Admin; a business cannot read the
//     portal; pilot reads never move the Command Center counts;
//   - Admin: create pilot + invite (partner sets own password),
//     add businesses (linked + name-only, duplicates refused),
//     set steps, close the pilot;
//   - the report totals equal the overview totals equal the
//     ledger, because all three come from the same computation;
//   - source: the shell wiring, the portal renderers, the plain
//     words glosses, and the -77 stamp.
//
// Run: node scripts/verify-build77.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8993;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "signl-admin-test-77";

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
    const res = await fetch(this.base + "/api" + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}

function startServer(db, port) {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL, ADMIN_PASSWORD };
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

// ---------- seed ----------
function pw(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { passwordSalt: salt, passwordHash: hash };
}
const T = {
  pilotA: "2026-10-20T12:00:00.000Z",
  biz: "2026-10-21T12:00:00.000Z",
  booking: "2026-10-25T12:00:00.000Z",
  visit: "2026-10-26T12:00:00.000Z",
  post: "2026-10-27T12:00:00.000Z",
};
const IDS = {
  pilotA: crypto.randomUUID(),
  partnerA: crypto.randomUUID(),
  bizA: crypto.randomUUID(),
  bizB: crypto.randomUUID(),
  bizC: crypto.randomUUID(),
  bizE: crypto.randomUUID(),
  creator: crypto.randomUUID(),
  pbA: crypto.randomUUID(),
  pbB: crypto.randomUUID(),
  pbC: crypto.randomUUID(),
  pbD: crypto.randomUUID(),
  bookingA: crypto.randomUUID(),
  bookingC: crypto.randomUUID(),
  postA: crypto.randomUUID(),
};
function bizUser(id, email, name, businessName, market, extra) {
  return Object.assign({
    id, role: "business", email, name, ...pw("biz-pass-77"),
    status: "approved", market, createdAt: T.pilotA, updatedAt: T.pilotA,
    creator: null,
    business: { businessName, category: "Restaurants", planId: "self-service", planName: "Self-Service", accessState: "founding", subscription: null },
  }, extra || {});
}
const seed = {};
seed[`user:${IDS.partnerA}`] = {
  id: IDS.partnerA, role: "pilot_partner", email: "partner@langley.test", name: "Dana Langley",
  ...pw("partner-a-pass-77"), status: "approved", tester: false, market: "Virginia Beach",
  createdAt: T.pilotA, updatedAt: T.pilotA, creator: null, business: null,
  pilotId: IDS.pilotA, pilotPartner: { partnerName: "Langley Federal Credit Union", pilotName: "Hampton Roads Pilot" },
};
seed[`email:partner@langley.test`] = { userId: IDS.partnerA };
seed[`user:${IDS.bizA}`] = bizUser(IDS.bizA, "owner@harbortable.test", "Harbor Owner", "Harbor Table", "Virginia Beach");
seed[`email:owner@harbortable.test`] = { userId: IDS.bizA };
seed[`user:${IDS.bizB}`] = bizUser(IDS.bizB, "owner@boardwalktacos.test", "Taco Owner", "Boardwalk Tacos", "Virginia Beach", {
  business: { businessName: "Boardwalk Tacos", category: "Restaurants", planId: "self-service", planName: "Self-Service", accessState: "founding", subscription: { status: "active", plan: "self-service", startedAt: T.post } },
});
seed[`email:owner@boardwalktacos.test`] = { userId: IDS.bizB };
seed[`user:${IDS.bizC}`] = bizUser(IDS.bizC, "owner@seasidesalon.test", "Salon Owner", "Seaside Salon", "Virginia Beach");
seed[`email:owner@seasidesalon.test`] = { userId: IDS.bizC };
seed[`user:${IDS.bizE}`] = bizUser(IDS.bizE, "owner@musiccityeats.test", "Nashville Owner", "Music City Eats", "Nashville");
seed[`email:owner@musiccityeats.test`] = { userId: IDS.bizE };
seed[`user:${IDS.creator}`] = {
  id: IDS.creator, role: "creator", email: "casey@creator.test", name: "Casey Rivers",
  ...pw("creator-pass-77"), status: "approved", market: "Virginia Beach", createdAt: T.pilotA, updatedAt: T.pilotA,
  business: null, creator: { handle: "caseyeatsvb", displayName: "Casey Rivers" },
};
seed[`email:casey@creator.test`] = { userId: IDS.creator };
seed[`pilot:${IDS.pilotA}`] = {
  id: IDS.pilotA, name: "Hampton Roads Pilot", partnerName: "Langley Federal Credit Union",
  marketId: "virginia-beach", marketName: "Virginia Beach", fundCents: 500000, status: "active",
  partnerUserId: IDS.partnerA, createdBy: null, createdAt: T.pilotA, updatedAt: T.pilotA,
};
const pb = (id, businessId, name, status) => ({
  id, pilotId: IDS.pilotA, businessId, name, marketName: "Virginia Beach",
  status, createdBy: null, createdAt: T.biz, updatedAt: T.biz,
});
seed[`pilotbiz:${IDS.pilotA}:${IDS.pbA}`] = pb(IDS.pbA, IDS.bizA, "Harbor Table", "invited");
seed[`pilotbiz:${IDS.pilotA}:${IDS.pbB}`] = pb(IDS.pbB, IDS.bizB, "Boardwalk Tacos", "invited");
seed[`pilotbiz:${IDS.pilotA}:${IDS.pbC}`] = pb(IDS.pbC, IDS.bizC, "Seaside Salon", "invited");
seed[`pilotbiz:${IDS.pilotA}:${IDS.pbD}`] = pb(IDS.pbD, null, "Not Yet Joined Bakery", "selected");
seed[`booking:${IDS.bookingA}`] = {
  id: IDS.bookingA, businessId: IDS.bizA, businessName: "Harbor Table", creatorId: IDS.creator,
  market: "Virginia Beach", kind: "paid", status: "completed",
  createdAt: T.booking, updatedAt: T.visit, redeemedAt: T.visit, codeStatus: "redeemed",
  paidLane: { rate: 150, businessTotal: 154.5, creatorNet: 145.5, platformFee: 4.5, escrowState: "released" },
  redemptions: null,
};
seed[`booking:${IDS.bookingC}`] = {
  id: IDS.bookingC, businessId: IDS.bizC, businessName: "Seaside Salon", creatorId: IDS.creator,
  market: "Virginia Beach", kind: "comp", status: "completed",
  createdAt: T.booking, updatedAt: T.visit, redeemedAt: T.visit, codeStatus: "redeemed",
  redemptions: { count: 4, basketTotal: 210 },
};
seed[`post:${IDS.postA}`] = {
  id: IDS.postA, bookingId: IDS.bookingA, businessId: IDS.bizA, creatorId: IDS.creator,
  market: "Virginia Beach", url: "https://www.instagram.com/p/harbor77/", platform: "instagram",
  submittedAt: T.post, createdAt: T.post, reportedAt: T.post, views: 8200, likes: 300, comments: 12, shares: 4,
};
for (let i = 0; i < 3; i++) {
  const id = crypto.randomUUID();
  seed[`redevent:${id}`] = { id, bookingId: IDS.bookingA, businessId: IDS.bizA, creatorId: IDS.creator, kind: "first", amount: 40, at: T.visit };
}
{
  const ret = crypto.randomUUID();
  seed[`redevent:${ret}`] = { id: ret, bookingId: IDS.bookingA, businessId: IDS.bizA, creatorId: IDS.creator, kind: "return", amount: 25, at: T.post };
  const vd = crypto.randomUUID();
  seed[`redevent:${vd}`] = { id: vd, bookingId: IDS.bookingA, businessId: IDS.bizA, creatorId: IDS.creator, kind: "first", amount: 999, at: T.visit, voided: true };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build77-"));
const DB = path.join(tmp, "db.json");
fs.writeFileSync(DB, JSON.stringify(seed));
const server = startServer(DB, PORT);
try {
  await waitUp(BASE);

  const admin = new Client(BASE);
  {
    const r = await admin.req("POST", "/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    check("admin login", r.status === 200 && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
  }

  // ---------- Command Center baseline ----------
  let statsBefore = null;
  {
    const r = await admin.req("GET", "/admin/stats");
    check("admin stats read", r.status === 200 && r.data.perMarket, `status=${r.status}`);
    statsBefore = r.data.perMarket["Virginia Beach"].businesses;
    check("stats baseline: 3 approved VB businesses", statsBefore === 3, `got=${statsBefore}`);
  }

  // ---------- Admin pilot list + ledger ----------
  let pilotListRow = null;
  {
    const r = await admin.req("GET", "/admin/pilots");
    check("admin pilots list", r.status === 200 && Array.isArray(r.data.pilots), `status=${r.status}`);
    pilotListRow = (r.data.pilots || []).find((p) => p.id === IDS.pilotA);
    check("pilot A listed", !!pilotListRow);
    check("auto spend: first paid booking charged the fund once ($150)", pilotListRow && pilotListRow.fund.spentCents === 15000, pilotListRow && `spent=${pilotListRow.fund.spentCents}`);
    check("fund math: $5,000 in, $4,850 left", pilotListRow && pilotListRow.fund.committedCents === 500000 && pilotListRow.fund.remainingCents === 485000);
    check("counts: 4 chosen, 2 visits done, 1 post live", pilotListRow && pilotListRow.counts.businesses === 4 && pilotListRow.counts.visitsDone === 2 && pilotListRow.counts.postsLive === 1, pilotListRow && JSON.stringify(pilotListRow.counts));
    check("counts: counted 3 (voided + return excluded), recorded 4, never summed", pilotListRow && pilotListRow.counts.countedCustomers === 3 && pilotListRow.counts.recordedCustomers === 4);
    check("counts: 1 business joined SIGNL (continued)", pilotListRow && pilotListRow.counts.continued === 1);
  }
  {
    // A second read must not double-charge the booking.
    const r = await admin.req("GET", "/admin/pilots");
    const row = (r.data.pilots || []).find((p) => p.id === IDS.pilotA);
    check("auto spend is idempotent across reads", row && row.fund.spentCents === 15000, row && `spent=${row.fund.spentCents}`);
  }

  // ---------- Partner A: scoped reads ----------
  const partnerA = new Client(BASE);
  {
    const r = await partnerA.req("POST", "/auth/login", { email: "partner@langley.test", password: "partner-a-pass-77" });
    check("partner A login, role pilot_partner", r.status === 200 && r.data.user && r.data.user.role === "pilot_partner", `status=${r.status}`);
  }
  {
    const r = await partnerA.req("GET", "/pilot/me");
    check("partner /pilot/me is pilot A", r.status === 200 && r.data.pilot && r.data.pilot.id === IDS.pilotA && r.data.partner.partnerName === "Langley Federal Credit Union", `status=${r.status}`);
  }
  let overview = null;
  {
    const r = await partnerA.req("GET", "/pilot/overview");
    overview = r.data;
    check("overview fund matches admin list", r.status === 200 && r.data.fund.spentCents === 15000 && r.data.fund.remainingCents === 485000);
    check("overview counts match admin list", JSON.stringify(r.data.counts) === JSON.stringify(pilotListRow.counts), JSON.stringify(r.data.counts));
  }
  {
    const r = await partnerA.req("GET", "/pilot/businesses");
    const by = Object.fromEntries((r.data.businesses || []).map((b) => [b.name, b]));
    check("businesses: Harbor Table derived to Post live", by["Harbor Table"] && by["Harbor Table"].step === "posted", by["Harbor Table"] && by["Harbor Table"].step);
    check("businesses: Boardwalk Tacos derived to Joined SIGNL", by["Boardwalk Tacos"] && by["Boardwalk Tacos"].step === "continued");
    check("businesses: Seaside Salon derived to Visit done", by["Seaside Salon"] && by["Seaside Salon"].step === "visited");
    check("businesses: name-only bakery stays Chosen + unlinked", by["Not Yet Joined Bakery"] && by["Not Yet Joined Bakery"].step === "selected" && by["Not Yet Joined Bakery"].linked === false);
    check("businesses: Harbor Table spend is the $150 booking", by["Harbor Table"] && by["Harbor Table"].spendCents === 15000);
    check("businesses: no other business leaks in", (r.data.businesses || []).length === 4);
  }
  {
    const r = await partnerA.req("GET", "/pilot/results");
    const by = Object.fromEntries((r.data.businesses || []).map((b) => [b.name, b]));
    const harbor = by["Harbor Table"] || {};
    check("results: Harbor counted 3, recorded 0", harbor.countedCustomers === 3 && harbor.recordedCustomers === 0, JSON.stringify(harbor));
    check("results: Harbor post carries its link and views", (harbor.posts || []).length === 1 && harbor.posts[0].url.includes("harbor77") && harbor.posts[0].views === 8200);
    check("results: post names its creator", (harbor.posts || [])[0] && harbor.posts[0].creatorHandle === "caseyeatsvb");
    const salon = by["Seaside Salon"] || {};
    check("results: Seaside counted 0, recorded 4 (tally stays its own line)", salon.countedCustomers === 0 && salon.recordedCustomers === 4);
    check("results totals: counted 3 + recorded 4, separate fields", r.data.totals.countedCustomers === 3 && r.data.totals.recordedCustomers === 4);
  }
  {
    const r = await partnerA.req("GET", "/pilot/report");
    check("report fund == overview fund", JSON.stringify(r.data.fund) === JSON.stringify(overview.fund));
    check("report counts == overview counts", JSON.stringify(r.data.counts) === JSON.stringify(overview.counts));
    const spendSum = (r.data.businesses || []).reduce((a, b) => a + b.spendCents, 0);
    check("report business spend sums to the ledger total", spendSum === r.data.fund.spentCents, `sum=${spendSum} spent=${r.data.fund.spentCents}`);
    check("report carries the period from pilot start", r.data.period && r.data.period.from === T.pilotA);
  }

  // ---------- Fences ----------
  {
    const w = await partnerA.req("POST", "/pilot/overview", {});
    check("partner writes refused (read-only portal)", w.status === 405, `status=${w.status}`);
    const a = await partnerA.req("GET", "/admin/pilots");
    check("partner cannot read Admin pilots", a.status === 403, `status=${a.status}`);
    const anon = new Client(BASE);
    const n = await anon.req("GET", "/pilot/me");
    check("anon portal read is 401", n.status === 401, `status=${n.status}`);
  }
  {
    const biz = new Client(BASE);
    const login = await biz.req("POST", "/auth/login", { email: "owner@harbortable.test", password: "biz-pass-77" });
    check("business login", login.status === 200 && login.data.user.role === "business", `status=${login.status}`);
    const p = await biz.req("GET", "/pilot/me");
    check("business cannot read the portal", p.status === 403, `status=${p.status}`);
    check("business user payload carries no pilot data", !("pilotId" in login.data.user) && !("pilotPartner" in login.data.user) && !JSON.stringify(login.data.user).includes("pilot"));
  }

  // ---------- Admin mutations ----------
  {
    const dup = await admin.req("POST", `/admin/pilots/${IDS.pilotA}/businesses`, { businessId: IDS.bizA });
    check("duplicate business add refused", dup.status === 409, `status=${dup.status}`);
    const st = await admin.req("POST", `/admin/pilots/${IDS.pilotA}/businesses/${IDS.pbD}/status`, { status: "invited" });
    check("admin sets a stored step", st.status === 200 && st.data.business.status === "invited", `status=${st.status}`);
    const r = await partnerA.req("GET", "/pilot/businesses");
    const bakery = (r.data.businesses || []).find((b) => b.name === "Not Yet Joined Bakery");
    check("partner sees the new step", bakery && bakery.step === "invited");
  }
  let manualSpendId = null;
  {
    const add = await admin.req("POST", `/admin/pilots/${IDS.pilotA}/spend`, { amount: 200, note: "Second visit deposit" });
    check("manual spend added", add.status === 200 && add.data.spend && add.data.spend.amountCents === 20000, `status=${add.status}`);
    manualSpendId = add.data.spend && add.data.spend.id;
    const r = await partnerA.req("GET", "/pilot/overview");
    check("manual spend moves the fund: $350 spent, $4,650 left", r.data.fund.spentCents === 35000 && r.data.fund.remainingCents === 465000, JSON.stringify(r.data.fund));
    const detail = await admin.req("GET", `/admin/pilots/${IDS.pilotA}`);
    const bookingEntry = (detail.data.spends || []).find((s) => s.kind === "booking");
    check("ledger shows the booking entry", !!bookingEntry && bookingEntry.amountCents === 15000);
    const refuse = await admin.req("POST", `/admin/pilots/${IDS.pilotA}/spend/${bookingEntry.id}/remove`, {});
    check("booking entries cannot be removed", refuse.status === 400, `status=${refuse.status}`);
    const rm = await admin.req("POST", `/admin/pilots/${IDS.pilotA}/spend/${manualSpendId}/remove`, {});
    check("manual entry removed", rm.status === 200, `status=${rm.status}`);
    const r2 = await partnerA.req("GET", "/pilot/overview");
    check("fund returns to $150 spent after removal", r2.data.fund.spentCents === 15000);
  }

  // ---------- Second pilot: create + invite + isolation ----------
  let pilotBId = null;
  {
    const r = await admin.req("POST", "/admin/pilots", {
      partnerName: "Music City Credit Union", contactName: "Pat Partner",
      email: "pat@musiccity.test", market: "Nashville", fund: 2500,
    });
    check("admin creates pilot B", r.status === 200 && r.data.pilot && r.data.pilot.marketName === "Nashville", `status=${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    pilotBId = r.data.pilot && r.data.pilot.id;
    check("invite carries a password token in TEST_MODE", typeof r.data.devResetToken === "string" && r.data.devResetToken.length > 10);
    const partnerB = new Client(BASE);
    const reset = await partnerB.req("POST", "/auth/reset", { token: r.data.devResetToken, password: "partner-b-pass-77" });
    check("partner B sets her own password from the invite", reset.status === 200, `status=${reset.status}`);
    const login = await partnerB.req("POST", "/auth/login", { email: "pat@musiccity.test", password: "partner-b-pass-77" });
    check("partner B login", login.status === 200 && login.data.user.role === "pilot_partner", `status=${login.status}`);
    const me = await partnerB.req("GET", "/pilot/me");
    check("partner B sees pilot B only", me.status === 200 && me.data.pilot.id === pilotBId && me.data.pilot.id !== IDS.pilotA);
    const ov = await partnerB.req("GET", "/pilot/overview");
    check("pilot B fund is its own: $2,500, nothing spent, no businesses", ov.data.fund.committedCents === 250000 && ov.data.fund.spentCents === 0 && ov.data.counts.businesses === 0, JSON.stringify(ov.data));
    const addE = await admin.req("POST", `/admin/pilots/${pilotBId}/businesses`, { businessId: IDS.bizE });
    check("admin adds a Nashville business to pilot B", addE.status === 200, `status=${addE.status}`);
    const bl = await partnerB.req("GET", "/pilot/businesses");
    check("pilot B now lists exactly its one business", (bl.data.businesses || []).length === 1 && bl.data.businesses[0].name === "Music City Eats");
    const al = await partnerA.req("GET", "/pilot/businesses");
    check("pilot A still lists exactly its four", (al.data.businesses || []).length === 4);
  }

  // ---------- Close + fund edit ----------
  {
    const patch = await admin.req("PATCH", `/admin/pilots/${pilotBId}`, { fund: 3000, status: "closed" });
    check("admin edits fund and closes pilot B", patch.status === 200 && patch.data.pilot.status === "closed", `status=${patch.status}`);
    const partnerB = new Client(BASE);
    await partnerB.req("POST", "/auth/login", { email: "pat@musiccity.test", password: "partner-b-pass-77" });
    const ov = await partnerB.req("GET", "/pilot/overview");
    check("closed pilot still reads, with the new fund", ov.status === 200 && ov.data.fund.committedCents === 300000, `status=${ov.status}`);
  }

  // ---------- Command Center fence, after everything ----------
  {
    const r = await admin.req("GET", "/admin/stats");
    const after = r.data.perMarket["Virginia Beach"].businesses;
    check("Command Center business count unmoved by pilot work", after === statsBefore, `before=${statsBefore} after=${after}`);
    const nash = r.data.perMarket["Nashville"].businesses;
    check("Command Center Nashville count is the seeded business only", nash === 1, `got=${nash}`);
  }
} finally {
  server.kill("SIGTERM");
}

// ---------- source pins ----------
console.log("== Source ==");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
check("stamp is 2026.11.02-84", buildJs.includes('BUILD_ID = "2026.11.02-84"'));
check("router mounts the partner API", routerJs.includes('seg[0] === "pilot"') && routerJs.includes("pilots.handlePilotApi"));
check("router mounts the admin API", routerJs.includes('seg[1] === "pilots"') && routerJs.includes("pilots.handleAdminPilots"));
check("shell routes pilot partners to their dash", appJs.includes('if (u.role === "pilot_partner") return renderPilotDash();'));
check("portal renderers exist", appJs.includes("function renderPilotDash()") && appJs.includes("function loadPilotReport(") && appJs.includes("function pilotHelpHtml()"));
check("admin pilots UI exists", appJs.includes("function loadAdminPilots()") && appJs.includes("function apCreate()"));
check("counted glossed in plain words", appJs.includes("Counted</strong> means the customer used the creator's code at the till"));
check("reach honesty line present", appJs.includes("Reach not tracked yet"));
check("portal named Impact Portal in partner copy", appJs.includes("Impact Portal"));

console.log(`\nBuild -77 verify: ${passed} passed, ${failed} failed`);
if (failed) { console.error("Failing:", fails.join(" | ")); process.exit(1); }
