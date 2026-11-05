#!/usr/bin/env node
// Build -95 verification: My Regulars + licence-expiry nudges
// (Tier 2 item 10, Jeff ordered via the strategy doc; Sig parity
// + proactive prompts per the 2026-11-03 standing directive).
//
// Proves, against a seeded throwaway store served by the real
// dev server on port 8973:
//   - a completed visit (post live) produces a Regular row with
//     the deal that ran and counted / recorded / intent as three
//     SEPARATE labeled figures (never one summed number);
//   - the business-private note saves, and is absent from the
//     creator's payloads and from another business's Regulars;
//   - Book again clones the last booking's terms into a direct
//     DRAFT (invisible to the creator), and a founding business's
//     draft still refuses publish under the Build -68 gate;
//   - the licence-expiry sweep fires licence_expiring on the
//     Build -87 rail at 14 days and 1 day out, exactly once per
//     threshold (idempotent on re-sweep), sandbox outbox only,
//     honoring the licenceExpiry Settings switch (suppressed),
//     and producing NOTHING for demo / tester records;
//   - Ask to renew routes into the creator-approved licensing
//     flow: a licence inside 14 days renews as a pending request
//     flagged renewal, creator approval starts a fresh 90 days,
//     a fresh paid post still refuses (standard licence), and a
//     freshly granted licence refuses a second request (409);
//   - Sig parity: business Sig answers Regulars + expiring
//     licences from real records with links to the real views,
//     Sig home chips carry both proactive prompts, creator Sig
//     names the pending licence/renewal requests behind its
//     count; source pins cover the operator flows, the new tab,
//     the Settings switch, and the stamp.
//
// Run: node scripts/verify-build95.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8973;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b95.dev";
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
const hash = crypto.scryptSync("fixture-pass-95", salt, 64).toString("hex");
const DAY = 86400000;
const now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const biz = (id, name, over = {}) => putUser({ id, role: "business", email: `${id}@b95.dev`, name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), phone: "+15550001111", business: { businessName: name, category: "Restaurant", plan: "growth", planId: "growth", accessState: "active" }, ...over });
const creator = (id, handle, over = {}) => putUser({ id, role: "creator", email: `${id}@b95.dev`, name: over.name || `Creator ${id}`, passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), creator: { handle, followerCount: 3000, categories: ["Food & Drink"], localAudiencePct: 70, licensingFee: 80, tierBand: "Locals" }, ...over });

biz("biz1", "B95 Bistro");
biz("biz2", "B95 Second");
biz("bizf", "B95 Founding", { business: { businessName: "B95 Founding", category: "Restaurant", plan: "growth", planId: "growth", accessState: "founding" } });
biz("bizt", "B95 Tester Biz", { tester: true });
biz("biz3", "B95 Quiet", { notifyPrefs: { licenceExpiry: false } });
creator("cr1", "b95casey", { name: "Casey Creator" });
creator("cr2", "b95paid", { name: "Paige Paid" });
data["user:cr2"].creator.licensingFee = 120;
creator("crdemo", "b95demo", { name: "Demo Dee", tester: true, demoShowcase: "nashville-2026-11" });
creator("crtester", "b95tester", { name: "Tess Tester", tester: true });

const booking = (id, businessId, creatorId, over = {}) => {
  data[`booking:${id}`] = { id, offerId: `off-${id}`, businessId, businessName: (data[`user:${businessId}`].business || {}).businessName || "", creatorId, creatorName: (data[`user:${creatorId}`] || {}).name || "", creatorHandle: (data[`user:${creatorId}`].creator || {}).handle || "", market: "Nashville", category: "Restaurant", kind: "comp", title: "Visit", whatComped: "Meal for two, on us", covers: 2, dollarCap: 100, status: "completed", redeemedAt: iso(now0 - 9 * DAY), createdAt: iso(now0 - 10 * DAY), updatedAt: iso(now0 - 8 * DAY), redemptions: null, ...over };
};
const post = (id, bookingId, businessId, creatorId, over = {}) => {
  data[`post:${id}`] = { id, bookingId, businessId, creatorId, url: `https://www.instagram.com/p/${id}/`, createdAt: iso(now0 - 8 * DAY), submittedAt: iso(now0 - 8 * DAY), reportedAt: iso(now0 - 8 * DAY), views: 5000, likes: 300, shares: 40, saves: 60, onTime: true, ...over };
};
const licence = (id, businessId, creatorId, postId, bookingId, endsMs, over = {}) => {
  data[`license:${id}`] = { id, postId, bookingId, businessId, businessName: (data[`user:${businessId}`].business || {}).businessName || "", creatorId, creatorHandle: (data[`user:${creatorId}`].creator || {}).handle || "", fee: 80, businessTotal: 82.4, creatorNet: 77.6, licenseDays: 90, status: "granted", escrowState: "released", createdAt: iso(now0 - 80 * DAY), respondedAt: iso(now0 - 80 * DAY), windowEndsAt: iso(endsMs), ...over };
};

// cr1 at biz1: two completed comp visits; the LAST carries a
// granted licence ending in 10 days, the older one a granted
// licence ending in 20 hours.
booking("bk1", "biz1", "cr1", { title: "Comp dinner", redemptions: { count: 7, basketTotal: 210 } });
post("p1", "bk1", "biz1", "cr1");
data["post:p1"].license = { requestId: "lic1", fee: 80, grantedAt: iso(now0 - 80 * DAY), windowEndsAt: iso(now0 + 10 * DAY), status: "granted" };
data["offer:off-bk1"] = { id: "off-bk1", businessId: "biz1", creatorId: "cr1", lane: "direct", kind: "comp", status: "filled", title: "Comp dinner", whatComped: "Meal for two, on us", dollarCap: 100, spots: 1, createdAt: iso(now0 - 11 * DAY), updatedAt: iso(now0 - 11 * DAY) };
licence("lic1", "biz1", "cr1", "p1", "bk1", now0 + 10 * DAY);
booking("bk2", "biz1", "cr1", { title: "Comp brunch", createdAt: iso(now0 - 40 * DAY), redeemedAt: iso(now0 - 39 * DAY), updatedAt: iso(now0 - 38 * DAY) });
post("p2", "bk2", "biz1", "cr1", { createdAt: iso(now0 - 39 * DAY), submittedAt: iso(now0 - 39 * DAY), reportedAt: iso(now0 - 39 * DAY), views: 1000, likes: 50, shares: 5, saves: 5 });
data["post:p2"].license = { requestId: "lic2", fee: 80, grantedAt: iso(now0 - 89 * DAY), windowEndsAt: iso(now0 + 20 * 3600000), status: "granted" };
licence("lic2", "biz1", "cr1", "p2", "bk2", now0 + 20 * 3600000);
// cr2 at biz1: a paid visit 80 days ago (standard licence ends
// in 10 days) and a fresh paid visit today.
booking("bk3", "biz1", "cr2", { kind: "paid", title: "Paid dinner", createdAt: iso(now0 - 82 * DAY), redeemedAt: iso(now0 - 81 * DAY), updatedAt: iso(now0 - 80 * DAY), paidLane: { rate: 200, businessTotal: 206, creatorNet: 194, platformFee: 12, licenseDays: 90, escrowState: "released" } });
post("p3", "bk3", "biz1", "cr2", { createdAt: iso(now0 - 80 * DAY), submittedAt: iso(now0 - 80 * DAY), reportedAt: iso(now0 - 80 * DAY), views: 2000, likes: 90, shares: 8, saves: 12 });
booking("bk4", "biz1", "cr2", { kind: "paid", title: "Paid lunch", createdAt: iso(now0 - 1 * DAY), redeemedAt: iso(now0 - 12 * 3600000), updatedAt: iso(now0), paidLane: { rate: 200, businessTotal: 206, creatorNet: 194, platformFee: 12, licenseDays: 90, escrowState: "released" } });
post("p4", "bk4", "biz1", "cr2", { createdAt: iso(now0), submittedAt: iso(now0), reportedAt: iso(now0), views: 300, likes: 20, shares: 2, saves: 3 });
// Fenced records: demo + tester creators at biz1, a tester
// business's visit + licence, a founding business's visit, a
// second business's visit with cr1, a quiet (switch off)
// business's licence ending in 5 days.
booking("bkd", "biz1", "crdemo", { title: "Demo visit" });
post("pd", "bkd", "biz1", "crdemo");
licence("licd", "biz1", "crdemo", "pd", "bkd", now0 + 12 * 3600000);
booking("bkt", "biz1", "crtester", { title: "Tester visit" });
post("pt", "bkt", "biz1", "crtester");
booking("bkf", "bizf", "cr1", { title: "Founding visit" });
post("pf", "bkf", "bizf", "cr1");
booking("bkb2", "biz2", "cr1", { title: "Second biz visit" });
post("pb2", "bkb2", "biz2", "cr1", { views: 10, likes: 1, shares: 0, saves: 0 });
booking("bktb", "bizt", "cr1", { title: "Tester biz visit" });
post("ptb", "bktb", "bizt", "cr1");
licence("lictb", "bizt", "cr1", "ptb", "bktb", now0 + 2 * DAY);
booking("bk3b", "biz3", "cr1", { title: "Quiet visit" });
post("p3b", "bk3b", "biz3", "cr1");
licence("lic3", "biz3", "cr1", "p3b", "bk3b", now0 + 5 * DAY);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build95-"));
const DB = path.join(tmp, "db.json");
fs.writeFileSync(DB, JSON.stringify(data));
const readDb = () => JSON.parse(fs.readFileSync(DB, "utf8"));
const outboxFor = (db, userId, eventType) => Object.values(db).filter((v) => v && v.userId === userId && v.eventType === eventType && v.channel);

console.log("== Build -95: My Regulars (live) ==");
const server = startServer(DB, PORT);
try {
  await waitUp(BASE);
  const admin = new Client(BASE);
  check("admin login", (await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).status === 200);
  const biz1 = new Client(BASE);
  check("biz1 login", (await biz1.req("POST", "/api/auth/login", { email: "biz1@b95.dev", password: "fixture-pass-95" })).status === 200);
  const biz2 = new Client(BASE);
  await biz2.req("POST", "/api/auth/login", { email: "biz2@b95.dev", password: "fixture-pass-95" });
  const bizF = new Client(BASE);
  await bizF.req("POST", "/api/auth/login", { email: "bizf@b95.dev", password: "fixture-pass-95" });
  const cr1 = new Client(BASE);
  await cr1.req("POST", "/api/auth/login", { email: "cr1@b95.dev", password: "fixture-pass-95" });

  const reg = await biz1.req("GET", "/api/me/regulars");
  check("GET /me/regulars 200 for the business", reg.status === 200, `status=${reg.status}`);
  const rows = reg.data.regulars || [];
  check("exactly the two real creators are Regulars (demo + tester creators excluded)", rows.length === 2 && rows.every((r) => ["cr1", "cr2"].includes(r.creatorId)), JSON.stringify(rows.map((r) => r.creatorId)));
  const r1 = rows.find((r) => r.creatorId === "cr1");
  check("cr1 row: 2 completed visits, last is the Comp dinner", !!r1 && r1.visits === 2 && r1.lastTitle === "Comp dinner" && r1.lastBookingId === "bk1", JSON.stringify(r1 && { v: r1.visits, t: r1.lastTitle }));
  check("cr1 deal: comp with the comp text + cap, native share only (1 post + 1 story)", !!r1 && r1.deal.kind === "comp" && r1.deal.line.includes("Meal for two, on us") && r1.deal.line.includes("$100") && r1.deal.rightsLine.includes("1 post + 1 story"), JSON.stringify(r1 && r1.deal));
  check("cr1 results keep the three classes SEPARATE (counted / recorded / intent keys, exact figures)",
    !!r1 && JSON.stringify(Object.keys(r1.results).sort()) === JSON.stringify(["counted", "intent", "recorded"])
    && r1.results.counted.customers === 7 && r1.results.counted.registerDollars === 210
    && r1.results.recorded.views === 5000 && r1.results.recorded.likes === 300
    && r1.results.intent.shares === 40 && r1.results.intent.saves === 60 && r1.results.intent.total === 100,
    JSON.stringify(r1 && r1.results));
  const r2 = rows.find((r) => r.creatorId === "cr2");
  check("cr2 row: paid deal at the $200 rate with the standard licence line", !!r2 && r2.deal.kind === "paid" && r2.deal.line.includes("$200") && r2.deal.rightsLine.includes("standard license") && r2.deal.rightsLine.includes("90 days"), JSON.stringify(r2 && r2.deal));
  check("cr2 row: no register tally reads as counted null, never a zero-filled fake", !!r2 && r2.results.counted === null, JSON.stringify(r2 && r2.results));
  check("regulars are business-only (creator refused)", (await cr1.req("GET", "/api/me/regulars")).status === 403);

  console.log("== Build -95: the private note ==");
  const NOTE = "NOTESECRET95 brunch crowd regular";
  const put = await biz1.req("PUT", "/api/me/regulars/cr1/note", { note: NOTE });
  check("note saves for a real Regular pair", put.status === 200 && (put.data.regulars || []).find((r) => r.creatorId === "cr1").note === NOTE, `status=${put.status}`);
  check("note for a non-Regular pair is refused (404)", (await biz1.req("PUT", "/api/me/regulars/cr2xxx/note", { note: "x" })).status === 404);
  const reg2 = await biz2.req("GET", "/api/me/regulars");
  const b2r1 = (reg2.data.regulars || []).find((r) => r.creatorId === "cr1");
  check("the other business's row for the same creator carries NO note", !!b2r1 && b2r1.note === "" && !JSON.stringify(reg2.data).includes("NOTESECRET95"), JSON.stringify(b2r1 && b2r1.note));
  const crBookings = await cr1.req("GET", "/api/bookings");
  const crLicences = await cr1.req("GET", "/api/license-requests");
  const crMe = await cr1.req("GET", "/api/auth/me");
  check("the note is absent from every creator-side payload", ![crBookings, crLicences, crMe].some((r) => JSON.stringify(r.data || {}).includes("NOTESECRET95")));
  const dbAfterNote = readDb();
  check("the note lives only at regularnote:{biz}:{creator}", !!dbAfterNote["regularnote:biz1:cr1"] && dbAfterNote["regularnote:biz1:cr1"].note === NOTE && !dbAfterNote["regularnote:biz2:cr1"]);

  console.log("== Build -95: Sig home chips (proactive prompts, real records only) ==");
  const home = await biz1.req("GET", "/api/sig/home");
  const chips = (home.data && home.data.chips) || [];
  check("chip: a licence ending soon", chips.some((c) => /licence.*ending soon/i.test(c)), JSON.stringify(chips));
  check("chip: Regulars to book again", chips.some((c) => /Regulars? to book again/i.test(c)), JSON.stringify(chips));

  console.log("== Build -95: Book again (draft clone, founding gates) ==");
  const ba = await biz1.req("POST", "/api/me/regulars/cr1/book-again", {});
  check("book again creates an offer (201)", ba.status === 201, `status=${ba.status} ${JSON.stringify(ba.data).slice(0, 200)}`);
  const draft = ba.data.offer || {};
  check("the clone is a DIRECT DRAFT cloning the last booking's terms", draft.status === "draft" && draft.lane === "direct" && draft.kind === "comp" && draft.creatorId === "cr1" && draft.title === "Comp dinner" && draft.whatComped === "Meal for two, on us" && draft.dollarCap === 100 && draft.rebookOfBookingId === "bk1" && draft.publishedAt === null, JSON.stringify(draft).slice(0, 300));
  const crOffers = await cr1.req("GET", "/api/offers");
  check("the draft is invisible to the creator (nothing sent)", !(crOffers.data.offers || []).some((o) => o.id === draft.id), `creator offers=${(crOffers.data.offers || []).length}`);
  const baF = await bizF.req("POST", "/api/me/regulars/cr1/book-again", {});
  check("a founding business can also book again into a draft", baF.status === 201 && baF.data.offer.status === "draft", `status=${baF.status}`);
  const pubF = await bizF.req("POST", `/api/offers/${baF.data.offer.id}/publish`, {});
  check("the founding gate still refuses publish of that draft (403)", pubF.status === 403 && /founding list/.test(JSON.stringify(pubF.data)), `status=${pubF.status}`);

  console.log("== Build -95: licences expiring surface ==");
  const exp = await biz1.req("GET", "/api/me/licences-expiring");
  const expRows = exp.data.licences || [];
  check("three licences inside the window (granted x2 + paid standard), exact end dates",
    expRows.length === 3
    && expRows.some((l) => l.postId === "p1" && l.kind === "licensed" && l.windowEndsAt === iso(now0 + 10 * DAY))
    && expRows.some((l) => l.postId === "p2" && l.daysLeft <= 1)
    && expRows.some((l) => l.postId === "p3" && l.kind === "standard" && l.daysLeft >= 9 && l.daysLeft <= 10),
    JSON.stringify(expRows.map((l) => [l.postId, l.kind, l.daysLeft])));
  check("the fresh paid post (90 days left) is NOT on the expiring surface", !expRows.some((l) => l.postId === "p4"));
  check("the demo creator's licence is NOT on the surface", !expRows.some((l) => l.postId === "pd"));

  console.log("== Build -95: Ask to renew routes into the creator-approved flow ==");
  const renew = await biz1.req("POST", "/api/posts/p1/license-request", {});
  check("renewal request created while the granted licence has 10 days left (201, flagged renewal)", renew.status === 201 && renew.data.licenseRequest.status === "pending" && renew.data.licenseRequest.renewal === true && renew.data.licenseRequest.fee === 80, `status=${renew.status} ${JSON.stringify(renew.data).slice(0, 220)}`);
  const freshPaid = await biz1.req("POST", "/api/posts/p4/license-request", {});
  check("a fresh paid post still refuses: the standard licence is already included (400)", freshPaid.status === 400 && /already includes/.test(JSON.stringify(freshPaid.data)), `status=${freshPaid.status}`);
  const t0 = Date.now();
  const approve = await cr1.req("POST", `/api/license-requests/${renew.data.licenseRequest.id}/respond`, { decision: "approve" });
  const endsMs = approve.data && approve.data.licenseRequest ? Date.parse(approve.data.licenseRequest.windowEndsAt) : 0;
  check("creator approval starts a FRESH 90 days (never longer)", approve.status === 200 && approve.data.licenseRequest.status === "granted" && endsMs > t0 + 89 * DAY && endsMs < t0 + 91 * DAY, JSON.stringify(approve.data).slice(0, 200));
  const again = await biz1.req("POST", "/api/posts/p1/license-request", {});
  check("a second request against the fresh grant is refused (409)", again.status === 409, `status=${again.status}`);
  const plain = await biz2.req("POST", "/api/posts/pb2/license-request", {});
  check("a first (non-renewal) request on another business's comped post still works, unflagged", plain.status === 201 && plain.data.licenseRequest.renewal === false, `status=${plain.status}`);

  console.log("== Build -95: Sig parity answers ==");
  const askReg = await biz1.req("POST", "/api/sig/ask", { q: "Who are my regulars?", history: [] });
  check("business Sig names the real Regulars and links to the Regulars view",
    askReg.status === 200 && askReg.data.source === "data" && /Casey Creator/.test(askReg.data.text) && askReg.data.link && askReg.data.link.dest === "biz-regulars",
    JSON.stringify(askReg.data).slice(0, 260));
  const askLic = await biz1.req("POST", "/api/sig/ask", { q: "Are any of my licenses expiring?", history: [] });
  check("business Sig names an expiring licence with its exact end date, linked to Posts and licenses",
    askLic.status === 200 && askLic.data.source === "data" && askLic.data.text.includes(iso(now0 + 10 * DAY).slice(0, 10)) && askLic.data.link && askLic.data.link.dest === "biz-content",
    JSON.stringify(askLic.data).slice(0, 260));
  const askCr = await cr1.req("POST", "/api/sig/ask", { q: "What licence requests are waiting on me?", history: [] });
  check("creator Sig names the pending licence requests and links to Earnings",
    askCr.status === 200 && askCr.data.source === "data" && /B95 Second/.test(askCr.data.text) && askCr.data.link && askCr.data.link.dest === "cr-earnings",
    JSON.stringify(askCr.data).slice(0, 260));

  console.log("== Build -95: licence-expiry sweep (rail, idempotent, fenced) ==");
  const sweep1 = await admin.req("POST", "/api/admin/notify/sweep", { now: iso(now0) });
  check("sweep 200 + licence sweep summary present", sweep1.status === 200 && !!sweep1.data.licenceSweep, JSON.stringify(sweep1.data).slice(0, 220));
  const ls1 = sweep1.data.licenceSweep || {};
  check("sweep fired: 14-day x2 (granted + standard) and 1-day x1 (granted), quiet business suppressed", ls1.fired14 === 2 && ls1.fired1 === 1 && ls1.suppressed === 1, JSON.stringify(ls1));
  let db = readDb();
  const entries = outboxFor(db, "biz1", "licence_expiring");
  check("outbox: 3 alerts x sms+email for biz1, sandbox only, nothing transmitted", entries.length === 6 && entries.every((e) => e.status === "sandbox" && e.transmitted === false && e.sandbox === true), JSON.stringify(entries.map((e) => [e.channel, e.status])));
  check("alert text carries the exact end date", entries.some((e) => e.text.includes(new Date(now0 + 10 * DAY).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" }))), (entries[0] || {}).text);
  check("demo creator's licence produced NOTHING (no alert mentions the demo)", !entries.some((e) => /Demo Dee/.test(e.text)) && !Object.values(db).some((v) => v && v.eventType === "licence_expiring" && /Demo Dee/.test(v.text || "")));
  check("tester business produced NOTHING (no outbox rows at all)", outboxFor(db, "bizt", "licence_expiring").length === 0 && !Object.values(db).some((v) => v && v.userId === "bizt" && v.channel));
  const quiet = outboxFor(db, "biz3", "licence_expiring");
  check("Settings switch OFF: the quiet business's alert is suppressed_pref, never transmitted", quiet.length === 2 && quiet.every((e) => e.status === "suppressed_pref" && e.transmitted === false), JSON.stringify(quiet.map((e) => e.status)));
  check("fired markers stamped on the licence records", !!db["license:lic1"].expiryAlerts && !!db["license:lic1"].expiryAlerts.d14 && !!db["license:lic2"].expiryAlerts.d1 && !!db["post:p3"].standardLicenceAlerts && !!db["post:p3"].standardLicenceAlerts.d14, "");
  const sweep2 = await admin.req("POST", "/api/admin/notify/sweep", { now: iso(now0) });
  const ls2 = sweep2.data.licenceSweep || {};
  db = readDb();
  check("re-sweep is idempotent: nothing new fired, outbox unchanged", ls2.fired14 === 0 && ls2.fired1 === 0 && outboxFor(db, "biz1", "licence_expiring").length === 6, JSON.stringify(ls2));
  const sweep3 = await admin.req("POST", "/api/admin/notify/sweep", { now: iso(now0 + 9 * DAY) });
  const ls3 = sweep3.data.licenceSweep || {};
  db = readDb();
  check("9 days later the 1-day threshold fires for the two 14-day licences (exactly once each)", ls3.fired1 === 2 && outboxFor(db, "biz1", "licence_expiring").length === 10, JSON.stringify(ls3));

  console.log("== Build -95: Settings switch persists (merge rule) ==");
  const patch = await biz2.req("PATCH", "/api/me/notifications", { licenceExpiry: false, phone: "+15550009999" });
  check("licenceExpiry switch saves via PATCH /me/notifications", patch.status === 200 && patch.data.notifyPrefs.licenceExpiry === false && patch.data.phone === "+15550009999", JSON.stringify(patch.data).slice(0, 200));
  const patch2 = await biz2.req("PATCH", "/api/me/notifications", { emailMessages: false });
  check("a partial save does not wipe the licenceExpiry switch", patch2.status === 200 && patch2.data.notifyPrefs.licenceExpiry === false && patch2.data.notifyPrefs.emailMessages === false, JSON.stringify(patch2.data).slice(0, 200));
} finally {
  server.kill();
}

// ---------- source checks ----------
console.log("== Source checks ==");
{
  const notifyJs = fs.readFileSync(path.join(root, "netlify/functions/lib/notify.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const sigdataJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
  const sigaiJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("rail: licence_expiring event on its own licenceExpiry switch", notifyJs.includes('licence_expiring: { prefKey: "licenceExpiry"') && notifyJs.includes('"licenceExpiry"'));
  check("router: regulars + licences-expiring endpoints and the sweep wired into the notify sweep", routerJs.includes('seg[1] === "regulars"') && routerJs.includes('seg[1] === "licences-expiring"') && routerJs.includes("runLicenceExpirySweep(opts)") && routerJs.includes("standardLicenceAlerts"));
  check("router: renewal allowance is 14 days and flags the request", routerJs.includes("RENEWAL_WINDOW_MS = 14 * 86400000") && routerJs.includes("renewal: isRenewal"));
  check("canon locks untouched: founding prices + founding Stripe prices stay env-or-empty (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""') && fs.readFileSync(path.join(root, "netlify/functions/lib/markets.js"), "utf8").includes("priceMonthly: 199") && fs.readFileSync(path.join(root, "netlify/functions/lib/markets.js"), "utf8").includes("priceMonthly: 699"));
  check("app: Regulars is its own tab + rail row + view", appJs.includes('"Regulars"') && appJs.includes('label: "My Regulars"') && appJs.includes("function renderRegularsTab()") && appJs.includes('if (tab === "Regulars") renderRegularsTab();'));
  check("app: licence-expiry card + ask-to-renew on Posts and licenses", appJs.includes('id="biz-lic-expiry"') && appJs.includes("function askRenewLicense(") && appJs.includes("loadLicenceExpiryCard()"));
  check("app: Settings switch for licence expiry", appJs.includes('id="np-licenceexpiry"') && appJs.includes("licenceExpiry: !!document.getElementById(\"np-licenceexpiry\").checked"));
  check("app: Sig operator flows exist for both roles", appJs.includes("async function sigB95Regulars()") && appJs.includes("async function sigB95Licences()") && appJs.includes("async function sigC95Licences()") && appJs.includes("sigB95Regulars()") && appJs.includes("sigC95Licences()"));
  check("app: Sig links + chips route to the real views", appJs.includes('case "biz-regulars": return go("dashboard", "Regulars");') && appJs.includes('t.includes("book again")') && appJs.includes('t.includes("ending soon")'));
  check("app: Home Sig queue carries both proactive prompts", appJs.includes("licencesExpiringPromise") && appJs.includes("regularsPromise") && appJs.includes("Ask to renew") && appJs.includes("Book again copies the last deal into a draft"));
  check("sigdata: business facts + answerer branches + home chips", sigdataJs.includes("licencesExpiring") && sigdataJs.includes("regularsCount") && sigdataJs.includes('"biz-regulars"') && sigdataJs.includes("to book again") && sigdataJs.includes("pendingLicenses"));
  check("sigai canon: Regulars + licence renewal lines", sigaiJs.includes("My Regulars: a creator who completes a visit") && sigaiJs.includes("Licence expiry and renewal:"));
  check("no em dashes in the new Regulars / licence copy", ["Book again copies the last visit's deal into a new draft in Campaigns.", "When a licence ends, you can no longer repost that post or run it as an ad."].every((l) => !l.includes("—") && !l.includes("–")));
  check("build stamp is 2026.11.05-132 on both sides",
    fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('exports.BUILD_ID = "2026.11.05-132"')
    && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.05-132"'), "");
}

console.log(`\nBuild -95 verify: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
