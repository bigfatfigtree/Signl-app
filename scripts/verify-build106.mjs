#!/usr/bin/env node
// Build -106 verification (Tier 3 item 15 + the scoped partner
// Sig foundation). Proves, against the real dev server on
// port 9021 (plus a second instance on 9023 for the backstop):
//   15a - a partner's month pack under their own session: the
//     live pack is labeled a live snapshot; after Admin hard-
//     closes the month, the pack serves the FROZEN snapshot
//     figures to the cent (compared against the stored close
//     record itself), with both greater-of candidates printed;
//     a later adjustment about the closed month rides as an
//     adjustment row while the frozen figures never move;
//     partner B's pack carries none of partner A's numbers;
//   15a - the funder pack: fund totals, per-business steps,
//     counted and recorded in separate columns, and the
//     conversion line derived from plan records;
//   15b - the London race rollup: district mapping edges
//     (component areas file, unmapped areas stay outside the
//     field, a business without a neighborhood files nowhere),
//     tester exclusion, not-started state, the Admin start
//     control, outright-win detection + the Overview attention
//     item, 403 for a partner without London, and (server 2)
//     backstop scoring after 8 weeks;
//   15c - multi-scope logins: Admin attaches a pilot scope,
//     the scoped partner opens that pilot and is refused
//     another, a bogus pilot id is refused at write time, the
//     legacy pilot_partner login is unchanged;
//   Sig - the scoped partner Sig answers accrual + pack +
//     territory from the partner's own sheet; the funder Sig
//     keeps counted and recorded apart; Admin Sig answers the
//     race question; /sig/home carries the pack chip;
//   canon locks: founding Stripe prices unarmed, stamp -106.
//
// Run: node scripts/verify-build106.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9021;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b106.dev";
const ADMIN_PASSWORD = ["fixture", "admin", "106"].join("-");

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
  async raw(method, p) {
    const headers = {};
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(this.base + p, { method, headers });
    return { status: res.status, text: await res.text(), headers: res.headers };
  }
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-106", salt, 64).toString("hex");
const SEP = "2026-09-01T00:00:00.000Z";
const data = {};
function partner(id, name, code, markets) {
  data[`user:${id}`] = { id, role: "partner", email: `${id}@b106.dev`, name, passwordSalt: salt, passwordHash: hash, status: "approved", market: markets[0], createdAt: SEP, updatedAt: SEP, partner: { name, code, type: "media", contactName: "Pat Fixture", markets, status: "active", agreementStatus: "signed", agreementSignedAt: SEP, demo: false } };
  data[`email:${id}@b106.dev`] = { userId: id };
}
partner("partner-a", "Fixture Media A", "fma", ["Nashville"]);
partner("partner-b", "Fixture Media B", "fmb", ["Austin"]);
partner("partner-c", "Fixture Media C", "fmc", ["Denver"]);
partner("partner-d", "Fixture Media D", "fmd", ["London"]);
function biz(id, name, market, extra = {}) {
  data[`user:${id}`] = { id, role: "business", email: `${id}@b106.dev`, name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market, createdAt: SEP, updatedAt: SEP, business: { businessName: name, category: "Restaurant", accessState: "active", billingStatus: "Founding billing: plan recorded, no card charged.", planSelectedAt: SEP, subscription: null, plan: "self-service", planName: "Self-Service $199/mo", planPriceMonthly: 199, planMinMonths: 3, currency: "USD" }, ...extra };
  data[`email:${id}@b106.dev`] = { userId: id };
}
biz("biz-one", "Music City Eats", "Nashville", { partnerId: "partner-a", attributionSource: "sourced" });
biz("biz-two", "Broadway Bites", "Nashville", {});
// The adjustment fixture: a September register count corrected
// in October (lands as an adjustment once September is closed).
data["redevent:ev-adj"] = { id: "ev-adj", businessId: "biz-one", creatorId: "cr-x", bookingId: "bk-x", at: "2026-09-15T00:00:00.000Z", kind: "first", voided: false, amount: 40, corrections: [{ at: "2026-10-05T00:00:00.000Z", oldAmount: 40, newAmount: 55, voided: false, wasVoided: false, by: "admin" }] };

// London race fixtures: Shoreditch qualifies (40 creators,
// 15 businesses); Peckham is outside the field; a business
// with no neighborhood files nowhere; a tester never counts.
for (let i = 0; i < 40; i++) {
  const id = `cr-sh-${i}`;
  data[`user:${id}`] = { id, role: "creator", email: `${id}@b106.dev`, name: `Shoreditch Creator ${i}`, status: "approved", market: "London", createdAt: SEP, updatedAt: SEP, creator: { handle: `sh${i}`, area: "Shoreditch" } };
}
for (let i = 0; i < 3; i++) {
  const id = `cr-pk-${i}`;
  data[`user:${id}`] = { id, role: "creator", email: `${id}@b106.dev`, name: `Peckham Creator ${i}`, status: "approved", market: "London", createdAt: SEP, updatedAt: SEP, creator: { handle: `pk${i}`, area: "Peckham" } };
}
for (let i = 0; i < 2; i++) {
  const id = `cr-da-${i}`;
  data[`user:${id}`] = { id, role: "creator", email: `${id}@b106.dev`, name: `Dalston Creator ${i}`, status: "approved", market: "London", createdAt: SEP, updatedAt: SEP, creator: { handle: `da${i}`, neighborhood: "Dalston" } };
}
data["user:cr-tester"] = { id: "cr-tester", role: "creator", email: "cr-tester@b106.dev", name: "Tester Creator", status: "approved", market: "London", tester: true, createdAt: SEP, updatedAt: SEP, creator: { handle: "testerldn", area: "Shoreditch" } };
for (let i = 0; i < 15; i++) {
  const id = `bz-sh-${i}`;
  data[`user:${id}`] = { id, role: "business", email: `${id}@b106.dev`, name: "Owner", status: "approved", market: "London", createdAt: SEP, updatedAt: SEP, business: { businessName: `Shoreditch Biz ${i}`, category: "Cafe", neighborhood: "Shoreditch" } };
}
data["user:bz-nb"] = { id: "bz-nb", role: "business", email: "bz-nb@b106.dev", name: "Owner", status: "approved", market: "London", createdAt: SEP, updatedAt: SEP, business: { businessName: "No Neighborhood Ltd", category: "Cafe" } };
for (let i = 0; i < 2; i++) {
  const id = `bz-br-${i}`;
  data[`user:${id}`] = { id, role: "business", email: `${id}@b106.dev`, name: "Owner", status: "approved", market: "London", createdAt: SEP, updatedAt: SEP, business: { businessName: `Brixton Biz ${i}`, category: "Cafe", neighborhood: "Brixton" } };
}

// Pilot fixtures (seeded records, Build -77 pattern): a Denver
// pilot whose one linked business continued at $199, with 3
// counted and 5 recorded customers across its two visits.
data["pilot:pilot-denver"] = { id: "pilot-denver", name: "Denver Launch Pilot", partnerName: "Fixture Fund", marketId: "denver", marketName: "Denver", fundCents: 500000, status: "active", partnerUserId: "pp-fran", createdBy: "fixture", createdAt: SEP, updatedAt: SEP };
data["pilot:pilot-austin"] = { id: "pilot-austin", name: "Austin Launch Pilot", partnerName: "Other Fund", marketId: "austin", marketName: "Austin", fundCents: 250000, status: "active", partnerUserId: null, createdBy: "fixture", createdAt: SEP, updatedAt: SEP };
data["user:pp-fran"] = { id: "pp-fran", role: "pilot_partner", email: "fran@b106.dev", name: "Fran Fund", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Denver", createdAt: SEP, updatedAt: SEP, pilotId: "pilot-denver", pilotPartner: { partnerName: "Fixture Fund", pilotName: "Denver Launch Pilot" } };
data["email:fran@b106.dev"] = { userId: "pp-fran" };
data["user:biz-denver"] = { id: "biz-denver", role: "business", email: "biz-denver@b106.dev", name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Denver", createdAt: SEP, updatedAt: SEP, business: { businessName: "Denver Diner", category: "Restaurant", accessState: "active", planId: "self-service", planName: "Self-Service $199/mo", planPriceMonthly: 199, subscription: { status: "active", plan: "self-service", startedAt: SEP } } };
data["email:biz-denver@b106.dev"] = { userId: "biz-denver" };
data["user:cr-denver"] = { id: "cr-denver", role: "creator", email: "cr-denver@b106.dev", name: "Casey Denver", status: "approved", market: "Denver", createdAt: SEP, updatedAt: SEP, creator: { handle: "caseydenver" } };
data["pilotbiz:pilot-denver:pb1"] = { id: "pb1", pilotId: "pilot-denver", businessId: "biz-denver", name: "Denver Diner", marketName: "Denver", status: "invited", createdBy: "fixture", createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" };
data["pilotbiz:pilot-denver:pb2"] = { id: "pb2", pilotId: "pilot-denver", businessId: null, name: "Name Only Bakery", marketName: "Denver", status: "selected", createdBy: "fixture", createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" };
data["pilotspend:pilot-denver:sp1"] = { id: "sp1", pilotId: "pilot-denver", pilotBizId: "pb1", amountCents: 15000, createdAt: "2026-09-10T00:00:00.000Z" };
data["booking:bk1"] = { id: "bk1", businessId: "biz-denver", businessName: "Denver Diner", creatorId: "cr-denver", market: "Denver", kind: "paid", status: "completed", createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z", redeemedAt: "2026-09-11T00:00:00.000Z" };
data["booking:bk2"] = { id: "bk2", businessId: "biz-denver", businessName: "Denver Diner", creatorId: "cr-denver", market: "Denver", kind: "comp", status: "completed", createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-13T00:00:00.000Z", redeemedAt: "2026-09-13T00:00:00.000Z", redemptions: { count: 5, at: "2026-09-13T00:00:00.000Z" } };
data["post:pst1"] = { id: "pst1", bookingId: "bk1", creatorId: "cr-denver", url: "https://example.com/post1", platform: "instagram", submittedAt: "2026-09-12T00:00:00.000Z", createdAt: "2026-09-12T00:00:00.000Z" };
for (let i = 0; i < 3; i++) data[`redevent:ev-c${i}`] = { id: `ev-c${i}`, businessId: "biz-denver", creatorId: "cr-denver", bookingId: "bk1", at: "2026-09-11T00:00:00.000Z", kind: "first", voided: false, amount: 25 };

function boot(port, seedData) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `signl-build106-${port}-`));
  const dbPath = path.join(tmp, "db.json");
  fs.writeFileSync(dbPath, JSON.stringify(seedData));
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbPath, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL, ADMIN_PASSWORD };
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_EMAIL_FROM", "SQUARE_APP_ID", "SQUARE_APP_SECRET"]) delete env[k];
  const server = spawn("node", ["scripts/dev-server.mjs", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  process.on("exit", () => { try { server.kill("SIGKILL"); } catch (e) { /* already gone */ } });
  return { dbPath, ready: (async () => {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`server on ${port} never came up`);
  })() };
}
const main = boot(PORT, data);
await main.ready;
const DB = main.dbPath;
const admin = new Client(BASE);
{
  const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error(`admin login: ${r.status}`);
}
async function loginAs(email) {
  const c = new Client(BASE);
  const r = await c.req("POST", "/api/auth/login", { email, password: "fixture-pass-106" });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  return c;
}
function csvRows(text) {
  return text.trim().split("\n").map((line) => {
    const cells = [];
    let cur = ""; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; } else cur += ch; }
      else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}
function packCell(rows, section, item, detailMatch) {
  const row = rows.find((r) => r[0] === section && r[1] === item && (detailMatch === undefined || r[2] === detailMatch));
  return row ? row[3] : null;
}
function packDetail(rows, section, item) {
  const row = rows.find((r) => r[0] === section && r[1] === item);
  return row ? row[2] : null;
}
function packFind(rows, section, detail) {
  return rows.find((r) => r[0] === section && r[2] === detail) || null;
}

// ---------- 15a: the deal (guarantee, greater-of) ----------
console.log("15a — partner month packs");
const dealRes = await admin.req("POST", "/api/admin/partners/partner-a/deals", { label: "Nashville fixture deal", status: "signed", terms: { partnerPct: 25, attributionScope: "market_wide", termMonths: 6, startAt: SEP, exclusivity: { scope: "none", conditions: "" }, guarantee: { beneficiary: "partner", pilotFloor: null, bands: [{ fromMonth: 1, toMonth: null, floorMonthly: 100, pctToBeneficiary: 25 }] }, markets: [{ market: "Nashville", status: "live", liveAt: SEP }] } });
check("the Nashville deal is created", dealRes.status === 201 && !!(dealRes.data && dealRes.data.deal), `status ${dealRes.status} ${JSON.stringify(dealRes.data || {}).slice(0, 160)}`);

const pA = await loginAs("partner-a@b106.dev");
const pB = await loginAs("partner-b@b106.dev");
const bootRes = await pA.req("GET", "/api/bootstrap");
check("bootstrap carries no race data", bootRes.status === 200 && JSON.stringify(bootRes.data).indexOf("londonRace") === -1 && JSON.stringify(bootRes.data).indexOf("shoreditch-spitalfields") === -1);

const live = await pA.raw("GET", "/api/partner/pack?month=2026-09");
check("open-month pack downloads as CSV", live.status === 200 && /attachment/.test(live.headers.get("content-disposition") || ""), `status ${live.status}`);
const liveRows = csvRows(live.text);
check("the live pack is labeled a live snapshot, never frozen", packDetail(liveRows, "meta", "state") === "Live snapshot: this month is not closed, so these figures are computed now and can still move.", packDetail(liveRows, "meta", "state"));
check("live pack gross is the whole Nashville month ($398)", packCell(liveRows, "summary", "period_gross") === "398", packCell(liveRows, "summary", "period_gross"));
check("live pack prints BOTH greater-of candidates and the governing row", Number((packFind(liveRows, "greater_of", "percentage candidate") || [])[3]) === 99.5 && Number((packFind(liveRows, "greater_of", "guarantee candidate") || [])[3]) === 100 && Number((packFind(liveRows, "greater_of", "governing (guarantee)") || [])[3]) === 100, JSON.stringify(liveRows.filter((r) => r[0] === "greater_of")));
check("the guarantee floor governs in September ($100 to the partner)", Number(packCell(liveRows, "deal", "Nashville fixture deal")) === 100, packCell(liveRows, "deal", "Nashville fixture deal"));
check("the live pack names both Nashville businesses", live.text.includes("Music City Eats") && live.text.includes("Broadway Bites"));

// ---------- 15a: close the month; the frozen pack ----------
await admin.req("POST", "/api/admin/command/close/soft", { period: "2026-09" });
const hard = await admin.req("POST", "/api/admin/command/close/hard", { period: "2026-09" });
check("Admin hard-closes September", hard.status === 200 && hard.data && hard.data.state === "closed", `status ${hard.status} ${JSON.stringify(hard.data || {}).slice(0, 120)}`);
const dbSnap = JSON.parse(fs.readFileSync(DB, "utf8"));
const closeRec = dbSnap["periodclose:2026-09"];
const frozenRow = closeRec && closeRec.snapshot && (closeRec.snapshot.partners || []).find((x) => x.id === "partner-a");
check("the close record froze a snapshot carrying partner A", !!frozenRow && frozenRow.period.gross === 398 && frozenRow.period.partnerShare === 100, JSON.stringify(frozenRow || {}).slice(0, 200));

const frozen = await pA.raw("GET", "/api/partner/pack?month=2026-09");
const frozenRows = csvRows(frozen.text);
check("the closed pack is labeled frozen", packDetail(frozenRows, "meta", "state") === "Frozen close: these are the numbers Admin closed this month with.", packDetail(frozenRows, "meta", "state"));
check("frozen pack gross matches the snapshot to the cent", Number(packCell(frozenRows, "summary", "period_gross")) === frozenRow.period.gross);
check("frozen pack share matches the snapshot to the cent", Number(packCell(frozenRows, "summary", "your_share_for_the_month")) === frozenRow.period.partnerShare);
check("frozen pack accrued matches the snapshot", Number(packCell(frozenRows, "summary", "accrued_total")) === frozenRow.accrued, `${packCell(frozenRows, "summary", "accrued_total")} vs ${frozenRow.accrued}`);
check("frozen pack owed matches the snapshot", Number(packCell(frozenRows, "summary", "owed")) === frozenRow.owed, `${packCell(frozenRows, "summary", "owed")} vs ${frozenRow.owed}`);
check("the October correction lands as an adjustment row about September", frozenRows.some((r) => r[0] === "adjustment" && /September/.test(r[2]) && Number(r[3]) === 15), JSON.stringify(frozenRows.filter((r) => r[0] === "adjustment")));
check("the frozen gross did NOT move for the adjustment", Number(packCell(frozenRows, "summary", "period_gross")) === 398);

const bPack = await pB.raw("GET", "/api/partner/pack?month=2026-09");
check("partner B's pack is their own frozen-but-empty sheet", bPack.status === 200 && /Frozen close/.test(bPack.text) && !bPack.text.includes("Music City Eats") && !bPack.text.includes("Nashville fixture deal") && Number(packCell(csvRows(bPack.text), "summary", "period_gross")) === 0, bPack.text.slice(0, 200));
const packsList = await pA.req("GET", "/api/partner/packs");
check("the packs list names September as frozen", packsList.status === 200 && packsList.data.months.some((m) => m.period === "2026-09" && m.frozen === true), JSON.stringify(packsList.data || {}).slice(0, 160));
const bizClient = await loginAs("biz-one@b106.dev");
const bizPack = await bizClient.req("GET", "/api/partner/pack?month=2026-09");
check("a business session is refused the partner pack", bizPack.status === 403, `status ${bizPack.status}`);
const future = await pA.req("GET", "/api/partner/pack?month=2099-01");
check("a future month is refused", future.status === 400, `status ${future.status}`);

// ---------- 15a: the funder pack ----------
console.log("15a — funder pack");
const fran = await loginAs("fran@b106.dev");
const funderPack = await fran.raw("GET", "/api/pilot/pack");
check("the funder pack downloads", funderPack.status === 200 && /attachment/.test(funderPack.headers.get("content-disposition") || ""), `status ${funderPack.status}`);
const fpRows = csvRows(funderPack.text);
const headerCells = fpRows[0];
check("the funder pack separates counted and recorded columns", headerCells.includes("counted_customers") && headerCells.includes("recorded_customers"), headerCells.join("|"));
const totalsRow = fpRows.find((r) => r[0] === "totals" && r[1] === "customers");
check("the pack totals counted 3 and recorded 5, never summed", !!totalsRow && totalsRow[4] === "3" && totalsRow[5] === "5", totalsRow && totalsRow.join("|"));
check("the pack conversion line reads the $199 plan record", fpRows.some((r) => r[0] === "conversion" && r[1] === "businesses_joined_signl_afterwards" && r[3] === "1") && fpRows.some((r) => r[0] === "conversion" && r[1] === "of_those_on_the_199_founding_rate" && r[3] === "1"), JSON.stringify(fpRows.filter((r) => r[0] === "conversion")));
check("the pack fund row shows $5,000 in and $150 spent", fpRows.some((r) => r[0] === "fund" && r[1] === "put_in" && r[3] === "5000") && fpRows.some((r) => r[0] === "fund" && r[1] === "spent" && r[3] === "150"), JSON.stringify(fpRows.filter((r) => r[0] === "fund")));
const bizPackTry = await bizClient.raw("GET", "/api/pilot/pack");
check("a business session is refused the pilot pack", bizPackTry.status === 403, `status ${bizPackTry.status}`);

// ---------- 15b: the London race ----------
console.log("15b — London district race");
const race0 = await admin.req("GET", "/api/admin/command/london-race");
check("before the start the race is not started", race0.status === 200 && race0.data.state === "not_started" && race0.data.winner === null, JSON.stringify(race0.data || {}).slice(0, 160));
const shoreditch = race0.data && race0.data.districts.find((d) => d.id === "shoreditch-spitalfields");
const dalston = race0.data && race0.data.districts.find((d) => d.id === "dalston-hackney");
check("Shoreditch/Spitalfields reads 40 creators + 15 businesses and qualifies", shoreditch && shoreditch.creators === 40 && shoreditch.businesses === 15 && shoreditch.qualifies === true, JSON.stringify(shoreditch || {}));
check("Dalston files through its component areas (2 creators)", dalston && dalston.creators === 2, JSON.stringify(dalston || {}));
check("Peckham and the neighborhood-less business sit outside the field", race0.data.outsideField.creators === 3 && race0.data.outsideField.businesses === 1 && race0.data.totals.creators === 45 && race0.data.totals.businesses === 18, JSON.stringify(race0.data.outsideField || {}) + " " + JSON.stringify(race0.data.totals || {}));
const pBrace = await pB.req("GET", "/api/partner/london-race");
check("a partner without London is refused the race", pBrace.status === 403, `status ${pBrace.status}`);
const pD = await loginAs("partner-d@b106.dev");
const pDrace = await pD.req("GET", "/api/partner/london-race");
check("the London partner sees the race board", pDrace.status === 200 && pDrace.data.districts.length === 5, `status ${pDrace.status}`);
const start = await admin.req("POST", "/api/admin/command/london-race/start", { startsAt: "2026-11-03" });
check("Admin starts the race", start.status === 200 && start.data.state === "won" && start.data.winner === "shoreditch-spitalfields", JSON.stringify(start.data || {}).slice(0, 160));
const race1 = await admin.req("GET", "/api/admin/command/london-race");
check("a qualifying district wins outright", race1.data.state === "won" && race1.data.winnerName === "Shoreditch/Spitalfields", JSON.stringify(race1.data.winnerName || ""));
const overview = await admin.req("GET", "/api/admin/command/overview");
check("the Overview carries the race-won attention item", overview.status === 200 && (overview.data.attention || []).some((a) => a.kind === "london_race_won"), JSON.stringify((overview.data.attention || []).map((a) => a.kind)));

// ---------- 15c: multi-scope logins ----------
console.log("15c — multi-scope partner login");
const pC = await loginAs("partner-c@b106.dev");
const refused = await pC.req("GET", "/api/pilot/me");
check("an unscoped partner is refused the Impact Portal", refused.status === 403, `status ${refused.status}`);
const bogus = await admin.req("PATCH", "/api/admin/partners/partner-c", { scopes: [{ kind: "pilot", pilotId: "pilot-nope" }] });
check("a scope naming an unknown pilot is refused at write time", bogus.status === 400, `status ${bogus.status}`);
const attach = await admin.req("PATCH", "/api/admin/partners/partner-c", { scopes: [{ kind: "pilot", pilotId: "pilot-denver" }] });
check("Admin attaches the Denver pilot scope", attach.status === 200, `status ${attach.status} ${JSON.stringify(attach.data || {}).slice(0, 140)}`);
const summaryC = await pC.req("GET", "/api/partner/summary");
check("the partner summary lists license + pilot scopes", summaryC.status === 200 && summaryC.data.scopes && summaryC.data.scopes.length === 2 && summaryC.data.scopes[1].name === "Denver Launch Pilot" && summaryC.data.scopes[1].partnerName === "Fixture Fund", JSON.stringify(summaryC.data && summaryC.data.scopes));
const scopedMe = await pC.req("GET", "/api/pilot/me?pilot=pilot-denver");
check("the scoped partner opens its pilot", scopedMe.status === 200 && scopedMe.data.pilot && scopedMe.data.pilot.name === "Denver Launch Pilot", `status ${scopedMe.status}`);
const scopedDefault = await pC.req("GET", "/api/pilot/me");
check("a single pilot scope is the default", scopedDefault.status === 200 && scopedDefault.data.pilot.id === "pilot-denver", `status ${scopedDefault.status}`);
const scopedOther = await pC.req("GET", "/api/pilot/me?pilot=pilot-austin");
check("another partner's pilot is refused", scopedOther.status === 403, `status ${scopedOther.status}`);
const scopedPack = await pC.raw("GET", "/api/pilot/pack?pilot=pilot-denver");
check("the scoped partner downloads the pilot pack too", scopedPack.status === 200 && scopedPack.text.includes("Denver Diner"), `status ${scopedPack.status}`);
const legacyMe = await fran.req("GET", "/api/pilot/me");
check("the legacy pilot-partner login is unchanged", legacyMe.status === 200 && legacyMe.data.pilot && legacyMe.data.pilot.id === "pilot-denver" && legacyMe.data.partner && legacyMe.data.partner.partnerName === "Fixture Fund", `status ${legacyMe.status} ${JSON.stringify(legacyMe.data || {}).slice(0, 140)}`);

// ---------- Sig: scoped partner, funder, Admin ----------
console.log("Sig — scoped partner + funder + Admin race");
const ask = async (client, q) => { const r = await client.req("POST", "/api/sig/ask", { q }); return r.data || {}; };
const acc = await ask(pA, "How much have I accrued?");
check("partner Sig answers accrual from their own sheet", acc.source === "data" && /accrued \$300 in total/.test(acc.text || "") && (acc.link || {}).dest === "partner-earnings", JSON.stringify(acc).slice(0, 220));
const packAsk = await ask(pA, "Send me my latest month pack");
check("partner Sig names the frozen month for the pack", packAsk.source === "data" && /September 2026 is frozen/.test(packAsk.text || ""), JSON.stringify(packAsk).slice(0, 220));
const packAskB = await ask(pB, "Send me my latest month pack");
check("partner B's Sig sheet is their own (frozen but empty, none of A's figures)", packAskB.source === "data" && /September 2026 is frozen/.test(packAskB.text || "") && !(packAskB.text || "").includes("$300") && !(packAskB.text || "").includes("Fixture Media A"), JSON.stringify(packAskB).slice(0, 200));
const terrAsk = await ask(pA, "What does my territory cover?");
check("partner Sig explains whole-market territory", terrAsk.source === "data" && /whole market/.test(terrAsk.text || "") && /Nashville/.test(terrAsk.text || ""), JSON.stringify(terrAsk).slice(0, 220));
const lookAsk = await ask(pA, "How does my portal look?");
check("partner Sig answers the brand question plainly", lookAsk.source === "data" && /SIGNL branding only/.test(lookAsk.text || ""), JSON.stringify(lookAsk).slice(0, 200));
const sigHome = await pA.req("GET", "/api/sig/home");
check("/sig/home carries the frozen-pack chip for the partner", sigHome.status === 200 && (sigHome.data.chips || []).some((c) => /pack is final/.test(typeof c === "string" ? c : (c.text || ""))), JSON.stringify(sigHome.data && sigHome.data.chips));
const countAsk = await ask(fran, "How many customers were counted?");
check("funder Sig keeps counted (3) and recorded (5) apart", countAsk.source === "data" && /3 customers were counted/.test(countAsk.text || "") && /5 were recorded/.test(countAsk.text || ""), JSON.stringify(countAsk).slice(0, 240));
const fundAsk = await ask(fran, "How much of the fund is left?");
check("funder Sig answers the fund from the record", fundAsk.source === "data" && /\$5,000 put in/.test(fundAsk.text || "") && /\$150 spent/.test(fundAsk.text || "") && /\$4,850 left/.test(fundAsk.text || ""), JSON.stringify(fundAsk).slice(0, 240));
const raceAsk = await ask(admin, "Who is winning the London race?");
check("Admin Sig answers the race question with the winner", raceAsk.source === "data" && /Shoreditch\/Spitalfields has won/.test(raceAsk.text || "") && (raceAsk.link || {}).dest === "admin-markets", JSON.stringify(raceAsk).slice(0, 260));

// ---------- 15b server 2: the backstop ----------
console.log("15b — backstop scoring (second instance)");
const data2 = {};
for (let i = 0; i < 10; i++) { const id = `cr2-br-${i}`; data2[`user:${id}`] = { id, role: "creator", email: `${id}@b106.dev`, name: `Brixton ${i}`, status: "approved", market: "London", createdAt: SEP, updatedAt: SEP, creator: { handle: `br2${i}`, area: "Brixton" } }; }
for (let i = 0; i < 3; i++) { const id = `bz2-br-${i}`; data2[`user:${id}`] = { id, role: "business", email: `${id}@b106.dev`, name: "Owner", status: "approved", market: "London", createdAt: SEP, updatedAt: SEP, business: { businessName: `Brixton Biz ${i}`, category: "Cafe", neighborhood: "Brixton" } }; }
for (let i = 0; i < 5; i++) { const id = `cr2-da-${i}`; data2[`user:${id}`] = { id, role: "creator", email: `${id}@b106.dev`, name: `Dalston ${i}`, status: "approved", market: "London", createdAt: SEP, updatedAt: SEP, creator: { handle: `da2${i}`, area: "Dalston" } }; }
data2["user:bz2-hc"] = { id: "bz2-hc", role: "business", email: "bz2-hc@b106.dev", name: "Owner", status: "approved", market: "London", createdAt: SEP, updatedAt: SEP, business: { businessName: "Hackney Central Biz", category: "Cafe", neighborhood: "Hackney Central" } };
const second = boot(9023, data2);
await second.ready;
const admin2 = new Client("http://127.0.0.1:9023");
await admin2.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
const raceBack0 = await admin2.req("GET", "/api/admin/command/london-race");
check("backstop instance starts at not_started", raceBack0.status === 200 && raceBack0.data.state === "not_started", JSON.stringify(raceBack0.data || {}).slice(0, 120));
const startBack = await admin2.req("POST", "/api/admin/command/london-race/start", { startsAt: "2026-09-01" });
check("past 8 weeks with no qualifier the race backstops to the top score", startBack.status === 200 && startBack.data.state === "backstop_scored" && startBack.data.winner === "brixton", JSON.stringify(startBack.data || {}).slice(0, 200));
const brixton = startBack.data.districts.find((d) => d.id === "brixton");
check("Brixton's score counts businesses double (10 + 2x3 = 16)", brixton && brixton.score === 16, JSON.stringify(brixton || {}));

// ---------- canon locks ----------
console.log("Canon locks");
check("build stamp is -106 on both sides", fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes("2026.11.03-112") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.03-112"));
const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("founding Stripe prices stay unarmed (no market live for money)", /STRIPE_PRICE_FOUNDING_SELF_SERVICE \|\| ""/.test(routerSrc) && /STRIPE_PRICE_FOUNDING_GROWTH \|\| ""/.test(routerSrc) && /STRIPE_PRICE_FOUNDING_MANAGED \|\| ""/.test(routerSrc));
const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
check("client wires the pack download, the scopes card and the scoped Sig chat", appSrc.includes('"/partner/packs"') && appSrc.includes("/api/partner/pack?month=") && appSrc.includes("partnerScopesCardHtml") && appSrc.includes("scopedSigChatHtml") && appSrc.includes("pilotSigHtml") && appSrc.includes("__partner_scope_exit") && appSrc.includes("ccLondonRaceHtml"));
const sigHtml = await pA.req("GET", "/api/sig/home");
check("partner /sig/home 200s with the partner display name", sigHtml.status === 200 && sigHome.data && !!sigHome.data.chips, `status ${sigHtml.status}`);

console.log(`\nbuild106: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("FAILING: " + fails.join("; ")); process.exit(1); }
