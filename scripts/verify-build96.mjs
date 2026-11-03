#!/usr/bin/env node
// Build -96 verification: the forwardable Monthly Receipt
// export + standing availability on the business profile
// (Tier 2 item 11e/11f; Sig parity + proactive prompts per the
// 2026-11-03 standing directive).
//
// Proves, against a seeded throwaway store served by the real
// dev server on port 8975:
//   - the export's counted figures EQUAL the on-screen
//     Receipt's Score v2 current-month figures for the same
//     month (same records, same cohort helper), and counted /
//     recorded / intent ride as three SEPARATE sections with
//     exact fixture figures, never summed;
//   - visits used / rolled over follow the plan allowance math;
//     the founding credit state reads banked for a founding
//     business, applied in the activation month and used after,
//     for an active one; licence end dates held ride the export;
//   - a zero-activity month exports honest zeros with no sample
//     data anywhere in it; an invalid month is a 400; a creator
//     is refused; the CSV download carries the same sections in
//     order under the business name + month;
//   - standing availability: the founding PATCH allowlist still
//     refuses non-page fields (403), accepts standingAvailability,
//     normalizes full day names, refuses a junk shape (400), and
//     clears on null; the summary round-trips to the business
//     home payload and to the creator-facing offer board, and a
//     business that never set it shows null, never a broken line;
//   - Sig parity per role: business Sig answers the receipt
//     (linked to Results) and standing hours (linked to the
//     business page) from real records, set and unset; creator
//     Sig answers a named business's hours from the real record,
//     linked to the offers view;
//   - proactive prompts render only when true: Sig home chips
//     for unset availability and a ready receipt appear for the
//     business with real last-month activity, and NEITHER appears
//     for the business with hours set and no activity.
//
// Run: node scripts/verify-build96.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8975;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b96.dev";
const ADMIN_PASSWORD = "<redacted>";

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
  async raw(p) {
    const res = await fetch(this.base + p, { headers: { cookie: this.cookieHeader() } });
    return { status: res.status, headers: res.headers, text: await res.text() };
  }
}

function startServer(db, port) {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL, ADMIN_PASSWORD };
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_EMAIL_FROM"]) delete env[k];
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
const hash = crypto.scryptSync("fixture-pass-96", salt, 64).toString("hex");
const DAY = 86400000;
const now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const curKey = iso(now0).slice(0, 7);
const [cy, cm] = curKey.split("-").map(Number);
const prevMid = Date.UTC(cy, cm - 2, 15, 12, 0, 0); // the 15th of last month, UTC noon
const prevKey = iso(prevMid).slice(0, 7);
const prevLabel = new Date(Date.UTC(cy, cm - 2, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const actMs = now0 - 40 * DAY;
const actKey = iso(actMs).slice(0, 7);
const AVAIL = { days: ["Fri", "Sat", "Sun"], hours: "12 to 4", appointments: "Tue to Thu by appointment" };
const AVAIL_LINE = "Open Fri to Sun, 12 to 4 · Tue to Thu by appointment";

const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const biz = (id, name, over = {}) => putUser({ id, role: "business", email: `${id}@b96.dev`, name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), phone: "+15550001111", business: { businessName: name, category: "Restaurant", plan: "growth", planId: "growth", accessState: "active" }, ...over });
const creator = (id, handle, over = {}) => putUser({ id, role: "creator", email: `${id}@b96.dev`, name: over.name || `Creator ${id}`, passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), creator: { handle, followerCount: 3000, categories: ["Food & Drink"], localAudiencePct: 70, licensingFee: 80, tierBand: "Locals" }, ...over });

biz("bizf", "B96 Founding Fork", { business: { businessName: "B96 Founding Fork", category: "Restaurant", plan: "growth", planId: "growth", accessState: "founding" } });
biz("bizact", "B96 Active Table", { business: { businessName: "B96 Active Table", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", activatedAt: iso(actMs) } });
biz("biz2", "B96 Second Supper", { business: { businessName: "B96 Second Supper", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", standingAvailability: AVAIL } });
biz("biz3", "B96 Quiet Corner");
creator("cr1", "b96casey", { name: "Casey Creator" });

const booking = (id, businessId, creatorId, over = {}) => {
  data[`booking:${id}`] = { id, offerId: `off-${id}`, businessId, businessName: (data[`user:${businessId}`].business || {}).businessName || "", creatorId, creatorName: (data[`user:${creatorId}`] || {}).name || "", creatorHandle: (data[`user:${creatorId}`].creator || {}).handle || "", market: "Nashville", category: "Restaurant", kind: "comp", title: "Visit", whatComped: "Meal for two, on us", covers: 2, dollarCap: 100, status: "completed", redeemedAt: iso(now0 - 1 * DAY), createdAt: iso(now0 - 2 * DAY), updatedAt: iso(now0 - 1 * DAY), redemptions: null, ...over };
};
const post = (id, bookingId, businessId, creatorId, over = {}) => {
  data[`post:${id}`] = { id, bookingId, businessId, creatorId, url: `https://www.instagram.com/p/${id}/`, createdAt: iso(now0 - 1 * DAY), submittedAt: iso(now0 - 1 * DAY), reportedAt: iso(now0 - 1 * DAY), views: 5000, likes: 300, shares: 40, saves: 60, onTime: true, ...over };
};
const redevent = (id, bookingId, businessId, creatorId, kind, amount, atMs) => {
  data[`redevent:${id}`] = { id, bookingId, businessId, creatorId, kind, channel: "code", amount, passId: null, at: iso(atMs), by: businessId, via: "owner", flagged: false };
};

// bizf last month: one completed visit, $60 counted, a reported
// post (900 views, 5 shares, 7 saves).
booking("bk-prev", "bizf", "cr1", { title: "Last month dinner", createdAt: iso(prevMid - DAY), redeemedAt: iso(prevMid), updatedAt: iso(prevMid) });
post("p-prev", "bk-prev", "bizf", "cr1", { createdAt: iso(prevMid), submittedAt: iso(prevMid), reportedAt: iso(prevMid), views: 900, likes: 40, shares: 5, saves: 7 });
redevent("ev-prev", "bk-prev", "bizf", "cr1", "first", 60, prevMid);
// bizf this month: one completed visit (2 firsts $120 + $80, one
// return $45), a reported post (4000 views, 200 likes, 30
// shares, 50 saves), a granted licence ending in 30 days, and a
// second comp booking created this month (visits used = 2).
booking("bk-cur", "bizf", "cr1", { title: "This month dinner" });
post("p-cur", "bk-cur", "bizf", "cr1", { views: 4000, likes: 200, shares: 30, saves: 50 });
data["post:p-cur"].license = { requestId: "lic-f", fee: 80, grantedAt: iso(now0 - 60 * DAY), windowEndsAt: iso(now0 + 30 * DAY), status: "granted" };
data["license:lic-f"] = { id: "lic-f", postId: "p-cur", bookingId: "bk-cur", businessId: "bizf", businessName: "B96 Founding Fork", creatorId: "cr1", creatorHandle: "b96casey", fee: 80, businessTotal: 82.4, creatorNet: 77.6, licenseDays: 90, status: "granted", escrowState: "released", createdAt: iso(now0 - 60 * DAY), respondedAt: iso(now0 - 60 * DAY), windowEndsAt: iso(now0 + 30 * DAY) };
redevent("ev-c1", "bk-cur", "bizf", "cr1", "first", 120, now0 - DAY);
redevent("ev-c2", "bk-cur", "bizf", "cr1", "first", 80, now0 - DAY);
redevent("ev-c3", "bk-cur", "bizf", "cr1", "return", 45, now0 - DAY);
booking("bk-cur2", "bizf", "cr1", { title: "Booked, not yet visited", status: "booked", redeemedAt: null, createdAt: iso(Date.UTC(cy, cm - 1, 2, 12, 0, 0)), updatedAt: iso(Date.UTC(cy, cm - 1, 2, 12, 0, 0)) });
// The creator-facing board: one open offer from biz2 (hours
// set), one from biz3 (never set).
data["offer:off-open1"] = { id: "off-open1", businessId: "biz2", status: "open", kind: "comp", market: "Nashville", category: "Restaurant", title: "Weekend tasting", whatComped: "Tasting menu for two", dollarCap: 120, spots: 3, targetTiers: ["Locals"], createdAt: iso(now0 - 3 * DAY), updatedAt: iso(now0 - 3 * DAY) };
data["offer:off-open2"] = { id: "off-open2", businessId: "biz3", status: "open", kind: "comp", market: "Nashville", category: "Restaurant", title: "Quiet lunch", whatComped: "Lunch for two", dollarCap: 60, spots: 2, targetTiers: ["Locals"], createdAt: iso(now0 - 3 * DAY), updatedAt: iso(now0 - 3 * DAY) };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build96-"));
const DB = path.join(tmp, "db.json");
fs.writeFileSync(DB, JSON.stringify(data));

console.log("== Build -96: the Monthly Receipt export (live) ==");
const server = startServer(DB, PORT);
try {
  await waitUp(BASE);
  const bizF = new Client(BASE);
  check("bizf login", (await bizF.req("POST", "/api/auth/login", { email: "bizf@b96.dev", password: "fixture-pass-96" })).status === 200);
  const bizAct = new Client(BASE);
  await bizAct.req("POST", "/api/auth/login", { email: "bizact@b96.dev", password: "fixture-pass-96" });
  const biz2 = new Client(BASE);
  await biz2.req("POST", "/api/auth/login", { email: "biz2@b96.dev", password: "fixture-pass-96" });
  const biz3 = new Client(BASE);
  await biz3.req("POST", "/api/auth/login", { email: "biz3@b96.dev", password: "fixture-pass-96" });
  const cr1 = new Client(BASE);
  await cr1.req("POST", "/api/auth/login", { email: "cr1@b96.dev", password: "fixture-pass-96" });

  const expR = await bizF.req("GET", "/api/me/receipt-export");
  check("GET /me/receipt-export 200 for the business, default month is the Receipt's month (current)", expR.status === 200 && expR.data.export && expR.data.export.month === curKey, `status=${expR.status} month=${expR.data && expR.data.export && expR.data.export.month}`);
  const exp = expR.data.export;
  check("export header: business name + month label + founding plan ($349 Growth, 10 visits)",
    exp.businessName === "B96 Founding Fork" && exp.monthLabel === new Date(Date.UTC(cy, cm - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) && exp.plan.priceMonthly === 349 && exp.plan.visitsPerMonth === 10, JSON.stringify(exp.plan));
  check("three SEPARATE sections with exact fixture figures (counted / recorded / intent, no merged total)",
    JSON.stringify(Object.keys(exp).filter((k) => ["counted", "recorded", "intent"].includes(k)).sort()) === JSON.stringify(["counted", "intent", "recorded"])
    && exp.counted.customers === 2 && exp.counted.registerDollars === 245 && exp.counted.registerEvents === 3 && exp.counted.cameBacks === 1 && exp.counted.cameBackDollars === 45
    && exp.recorded.views === 4000 && exp.recorded.likes === 200 && exp.recorded.reportedPosts === 1
    && exp.intent.shares === 30 && exp.intent.saves === 50 && exp.intent.total === 80
    && !("total" in exp) && exp.tallyFacts === null,
    JSON.stringify({ c: exp.counted, r: exp.recorded, i: exp.intent }));
  const receipt = await bizF.req("GET", "/api/me/receipt");
  const sv = receipt.data && receipt.data.receipt && receipt.data.receipt.scoreV2 && receipt.data.receipt.scoreV2.current;
  check("export counted EQUALS the on-screen Receipt's Score v2 current month (same records)",
    !!sv && exp.counted.customers === sv.countedCustomers && exp.counted.registerDollars === sv.countedBack && exp.counted.registerEvents === sv.countedEvents,
    JSON.stringify({ exp: exp.counted, sv: sv && { c: sv.countedCustomers, b: sv.countedBack, e: sv.countedEvents } }));
  check("visits: used 2 of 19 (base 10 + 9 rolled over from last month's 1 used), 17 left",
    exp.visits.used === 2 && exp.visits.base === 10 && exp.visits.carriedIn === 9 && exp.visits.allowance === 19 && exp.visits.remaining === 17, JSON.stringify(exp.visits));
  check("founding credit: banked and unused for a founding business, $100 stated",
    exp.credit.state === "banked" && exp.credit.total === 100 && exp.credit.appliedThisMonth === 0 && exp.credit.line.includes("$100 founding credit is banked"), JSON.stringify(exp.credit));
  check("licences held ride the export with the exact end date",
    exp.licences.length === 1 && exp.licences[0].creatorHandle === "b96casey" && exp.licences[0].windowEndsAt === iso(now0 + 30 * DAY), JSON.stringify(exp.licences));
  check("hasActivity is true for the current month", exp.hasActivity === true);

  const prevR = await bizF.req("GET", `/api/me/receipt-export?month=${prevKey}`);
  const prev = prevR.data.export;
  check("last month's export: its own real figures (1 customer, $60 counted, 900 views, intent 12, 1 visit used)",
    prevR.status === 200 && prev.counted.customers === 1 && prev.counted.registerDollars === 60 && prev.recorded.views === 900 && prev.intent.total === 12 && prev.visits.used === 1 && prev.hasActivity === true, JSON.stringify({ c: prev.counted, r: prev.recorded, i: prev.intent, v: prev.visits }));

  const zeroR = await bizF.req("GET", "/api/me/receipt-export?month=2020-01");
  const zero = zeroR.data.export;
  check("a zero-activity month exports honest zeros (and no sample story leaks in)",
    zeroR.status === 200 && zero.counted.customers === 0 && zero.counted.registerDollars === 0 && zero.counted.registerEvents === 0
    && zero.recorded.views === 0 && zero.recorded.reportedPosts === 0 && zero.intent.total === 0 && zero.visits.used === 0
    && zero.hasActivity === false && !/sample/i.test(JSON.stringify(zeroR.data)), JSON.stringify(zero.counted));
  check("an invalid month is a 400", (await bizF.req("GET", "/api/me/receipt-export?month=2026-13")).status === 400);
  check("the export is business-only (creator refused)", (await cr1.req("GET", "/api/me/receipt-export")).status === 403);

  const actExpR = await bizAct.req("GET", `/api/me/receipt-export?month=${actKey}`);
  check("active business, activation month: the $100 founding credit was APPLIED ($249 charged)",
    actExpR.data.export.credit.state === "applied" && actExpR.data.export.credit.appliedThisMonth === 100 && actExpR.data.export.credit.line.includes("applied this month"), JSON.stringify(actExpR.data.export.credit));
  const actCurR = await bizAct.req("GET", "/api/me/receipt-export");
  check("active business, current month: the credit reads USED (first charged month named)",
    actCurR.data.export.credit.state === "used" && actCurR.data.export.credit.line.includes("was used in your first charged month"), JSON.stringify(actCurR.data.export.credit));

  console.log("== Build -96: the CSV download ==");
  const csv = await bizF.raw(`/api/me/receipt-export/csv?month=${curKey}`);
  check("CSV 200 with a csv content type and the receipt filename",
    csv.status === 200 && /text\/csv/.test(csv.headers.get("content-type") || "") && (csv.headers.get("content-disposition") || "").includes(`signl-receipt-${curKey}.csv`), `${csv.status} ${csv.headers.get("content-type")} ${csv.headers.get("content-disposition")}`);
  check("CSV carries business + month and the three sections IN ORDER, never summed",
    csv.text.includes("B96 Founding Fork") && csv.text.includes("COUNTED (counted at the register") && csv.text.includes("Register dollars counted,245") && csv.text.includes("Came-back dollars (part of the register dollars above),45")
    && csv.text.indexOf("COUNTED") < csv.text.indexOf("RECORDED") && csv.text.indexOf("RECORDED") < csv.text.indexOf("INTENT")
    && csv.text.includes("Visits rolled over into this month,9") && csv.text.includes("Ends " + iso(now0 + 30 * DAY).slice(0, 10))
    && csv.text.includes("never added together"), csv.text.slice(0, 300));

  console.log("== Build -96: Sig home chips (proactive, real records only) ==");
  const homeF = await bizF.req("GET", "/api/sig/home");
  const chipsF = (homeF.data && homeF.data.chips) || [];
  check("chip: standing hours unset prompts the founding business", chipsF.some((c) => c === "Set your standing hours"), JSON.stringify(chipsF));
  check("chip: last month's receipt is ready (real activity last month)", chipsF.some((c) => c === `${prevLabel} receipt is ready to forward`), JSON.stringify(chipsF));
  const home2 = await biz2.req("GET", "/api/sig/home");
  const chips2 = (home2.data && home2.data.chips) || [];
  check("NEITHER chip for the business with hours set and no activity (silence when nothing is true)",
    !chips2.some((c) => /standing hours/i.test(c)) && !chips2.some((c) => /receipt is ready/i.test(c)), JSON.stringify(chips2));

  console.log("== Build -96: standing availability (PATCH allowlist + round-trip) ==");
  const bogus = await bizF.req("PATCH", "/api/me/profile", { bogusField96: "x" });
  check("founding PATCH allowlist still refuses a non-page field (403, whole save refused)", bogus.status === 403, `status=${bogus.status}`);
  const junk = await bizF.req("PATCH", "/api/me/profile", { standingAvailability: "junk" });
  check("a junk availability shape is refused (400)", junk.status === 400, `status=${junk.status}`);
  const setR = await bizF.req("PATCH", "/api/me/profile", { standingAvailability: { days: ["Friday", "Sat", "Sun"], hours: "12 to 4", appointments: "Tue to Thu by appointment" } });
  check("standing availability SAVES through the allowlist, full day names normalized to the stored set",
    setR.status === 200 && JSON.stringify(setR.data.user.business.standingAvailability.days) === JSON.stringify(["Fri", "Sat", "Sun"]) && setR.data.user.business.standingAvailability.hours === "12 to 4",
    `status=${setR.status} ${JSON.stringify(setR.data && setR.data.user && setR.data.user.business.standingAvailability)}`);
  const homeBiz = await bizF.req("GET", "/api/me/business-home");
  check("the summary round-trips to the business home payload, word for word (Chelsea's shape)",
    homeBiz.data.business.availability && homeBiz.data.business.availability.summary === AVAIL_LINE, JSON.stringify(homeBiz.data.business.availability));
  const clearR = await bizF.req("PATCH", "/api/me/profile", { standingAvailability: null });
  const homeBiz2 = await bizF.req("GET", "/api/me/business-home");
  check("a null save CLEARS it cleanly (no broken state anywhere)",
    clearR.status === 200 && !clearR.data.user.business.standingAvailability && homeBiz2.data.business.availability === null, `status=${clearR.status}`);
  await bizF.req("PATCH", "/api/me/profile", { standingAvailability: AVAIL });

  console.log("== Build -96: creator-facing round-trip (the offer board) ==");
  const offers = await cr1.req("GET", "/api/open-offers");
  const offs = offers.data.offers || [];
  const o1 = offs.find((o) => o.id === "off-open1");
  const o2 = offs.find((o) => o.id === "off-open2");
  check("the offer from the business WITH hours carries the exact summary line", !!o1 && o1.businessAvailability === AVAIL_LINE, JSON.stringify(o1 && o1.businessAvailability));
  check("the offer from the business WITHOUT hours carries null (nothing renders)", !!o2 && o2.businessAvailability === null, JSON.stringify(o2 && o2.businessAvailability));

  console.log("== Build -96: Sig parity answers ==");
  const askRcpt = await bizF.req("POST", "/api/sig/ask", { q: "Can I forward my monthly receipt?", history: [] });
  check("business Sig serves the receipt answer from real records, linked to Results",
    askRcpt.status === 200 && askRcpt.data.source === "data" && askRcpt.data.text.includes(`${prevLabel} receipt is ready to forward`) && /three separate sections/.test(askRcpt.data.text) && askRcpt.data.link && askRcpt.data.link.dest === "biz-results",
    JSON.stringify(askRcpt.data).slice(0, 300));
  const askHrs = await bizF.req("POST", "/api/sig/ask", { q: "What are my standing hours?", history: [] });
  check("business Sig reads back the saved standing hours, linked to the business page",
    askHrs.status === 200 && askHrs.data.source === "data" && askHrs.data.text.includes(AVAIL_LINE) && askHrs.data.link && askHrs.data.link.dest === "biz-profile",
    JSON.stringify(askHrs.data).slice(0, 300));
  const askHrs3 = await biz3.req("POST", "/api/sig/ask", { q: "What are my standing hours?", history: [] });
  check("business Sig for a business that never set hours says so plainly, linked to the page",
    askHrs3.status === 200 && askHrs3.data.source === "data" && /have not set standing availability yet/.test(askHrs3.data.text) && askHrs3.data.link && askHrs3.data.link.dest === "biz-profile",
    JSON.stringify(askHrs3.data).slice(0, 300));
  const askCr = await cr1.req("POST", "/api/sig/ask", { q: "When is B96 Second Supper open?", history: [] });
  check("creator Sig answers the named business's hours from the real record, linked to the offers view",
    askCr.status === 200 && askCr.data.source === "data" && askCr.data.text.includes("B96 Second Supper") && askCr.data.text.includes(AVAIL_LINE) && askCr.data.link && askCr.data.link.dest === "cr-offers",
    JSON.stringify(askCr.data).slice(0, 300));
} finally {
  server.kill();
}

// ---------- source checks ----------
console.log("== Source checks ==");
{
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const sigdataJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
  const sigaiJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("router: export endpoints + CSV served from the export builder", routerJs.includes('seg[1] === "receipt-export"') && routerJs.includes("monthlyReceiptExportFor") && routerJs.includes("monthlyReceiptCsv(exp)") && routerJs.includes("sample story"));
  check("router: the export never calls the sample story builder", !routerJs.slice(routerJs.indexOf("async function monthlyReceiptExportFor"), routerJs.indexOf("function csvCell")).includes("sampleResultsFor("));
  check("router: allowlist carries standingAvailability + the business branch normalizes it", routerJs.includes('"moment", "standingAvailability"') && routerJs.includes("normalizeStandingAvailability(b.standingAvailability)"));
  check("router: offer board payload carries businessAvailability from the record", routerJs.includes("businessAvailability: biz && biz.business ? standingAvailabilitySummary(biz.business.standingAvailability) : null"));
  check("router: Sig facts carry availability + receiptReady (activity-gated) for business, businessAvailability for creator", routerJs.includes("availability: standingAvailabilityView(user.business || {})") && routerJs.includes("receiptReady: await (async () => {") && routerJs.includes("const businessAvailability = await (async () => {"));
  check("canon locks untouched: founding Stripe prices stay env-or-empty (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'));
  check("app: the export card lives in the Receipt with month picker, CSV link and print view", appJs.includes('id="biz-receipt-export"') && appJs.includes("function receiptExportHtml(exp)") && appJs.includes("/me/receipt-export/csv?month=") && appJs.includes("function receiptExportPrint()") && appJs.includes("loadReceiptExport();"));
  check("app: availability editor card + save scope on the business page", appJs.includes('id="bp-availability"') && appJs.includes("bp-av-day-") && appJs.includes('onclick="saveBusinessProfile(\'availability\')"') && appJs.includes('scope === "availability"'));
  check("app: the creator offer card shows the hours line only when set", appJs.includes("o.businessAvailability ? `<p class=\"small muted\">When you can come:"));
  check("app: composer pre-fills timing from standing availability ONLY on untouched draft keys (per-offer edits win)", appJs.includes("if (dft.window === undefined) dft.window = avSummary;") && appJs.includes("if (dft.briefTiming === undefined) dft.briefTiming = avSummary;"));
  check("app: Sig operator serves both items + the confirm-first set flow is wired into sigOpStep", appJs.includes("async function sigB96Receipt()") && appJs.includes("async function sigB96AvailabilityStart()") && appJs.includes('if (f.id === "b96avail") return sigB96AvailStep(f, text, norm);') && appJs.includes("function parseAvailabilityText(text)"));
  check("app: Sig links + chips route to the real views", appJs.includes('case "biz-profile": return go("dashboard", "Profile");') && appJs.includes('t.includes("standing hours")') && appJs.includes('t.includes("receipt is ready")'));
  check("app: Home queue carries both proactive prompts", appJs.includes("receiptPrevPromise") && appJs.includes("receipt is ready to forward: counted, recorded, and intent figures in three separate sections") && appJs.includes("Standing hours not set"));
  check("sigdata: facts + answerer branches + home chips for both items", sigdataJs.includes("availabilitySet") && sigdataJs.includes("receiptReady: d.receiptReady || null") && sigdataJs.includes("businessAvailability: (d.businessAvailability || [])") && sigdataJs.includes('"biz-profile"') && sigdataJs.includes('"Set your standing hours"') && sigdataJs.includes("receipt is ready to forward`);"));
  check("sigai canon: standing availability + monthly receipt export lines", sigaiJs.includes("Standing availability: a business can set its usual open days") && sigaiJs.includes("Monthly receipt export: from Results"));
  check("no em dashes in the new copy", ["Forward this month's receipt", "When creators can come", "Three different kinds of numbers. They are never added together."].every((l) => !l.includes("—") && !l.includes("–")));
  check("build stamp is 2026.11.02-98 on both sides",
    fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('exports.BUILD_ID = "2026.11.02-98"')
    && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.02-98"'), "");
}

console.log(`\nBuild -96 verify: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
