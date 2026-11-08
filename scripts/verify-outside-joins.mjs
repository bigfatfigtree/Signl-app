// Outside joins verification (Build -147; decision-layer spec
// 2026-11-08 §2 + §4 Phase 2). Boots the fixture server and
// proves, reading the local store file back:
//   1. the token-gated import endpoint (403 without auth) and
//      per-kind counts for sends / roster prospects / replies /
//      bounces / forms;
//   2. field-for-field fidelity of imported events (a send's
//      event carries the source record's email, handle, lane,
//      message id, template, and its OWN send date as ts);
//   3. idempotency: the whole batch re-POSTed writes nothing;
//   4. typed-city market resolution (a Clarksville send lands
//      on Nashville, the raw city preserved);
//   5. the prospect mirror: one record per handle, markets
//      unioned (Raleigh AND Charlotte on one record, separate
//      markets), prospect_verified once per market;
//   6. identity resolution for bounces/replies by email;
//   7. the conversion join: prospect -> creator by email and
//      by handle, outreach_converted events with days-to-
//      convert, and user records byte-identical afterwards
//      (the join never mutates a user);
//   8. forms: city-request lands as a cityrequest record the
//      Data view backlog reads; business-application lands as
//      a bizapp record; creator-application is event-only;
//   9. the Data view's outside section counts, and M1's
//      receipts carrying prospectsVerified / prospectsContacted;
//  10. the Netlify forms webhook: 401 without the token, a
//      submission lands, a duplicate delivery dedupes;
//  11. the honesty scan: no Gmail open/click metric identifier
//      exists anywhere in the shipped code.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = fs.mkdtempSync("/tmp/signl-outside-") + "/db.json";
const SEED_PW = "verify-outside-pass";
const SEED_SALT = "verifyoutsidesalt";
const SEED_HASH = crypto.scryptSync(SEED_PW, SEED_SALT, 64).toString("hex");
const SWEEP = "proof-sweep-token";
const FORM_TOKEN = "proof-form-token";

function creatorSeed(id, email, name, handle, market, createdAt) {
  return {
    id, role: "creator", email, name, passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: "approved", market, city: market, state: "TN", createdAt, updatedAt: createdAt, tester: false,
    creator: { handle, platform: "Instagram", handleNormalized: handle, city: market, state: "TN", categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", audienceStack: { instagram: 9000 }, totalAudience: 9000, followerCount: 9000, localAudiencePct: 75, paidRate: 150, compOpen: true, couponOpen: true, profileComplete: true, publicPage: true, bio: `${name}, daily.` },
  };
}
{
  const seed = {};
  seed["config:markets"] = { flags: { Nashville: true, Austin: true } };
  seed["user:bizactive"] = { id: "bizactive", role: "business", email: "active@fixtures.dev", name: "Active Owner", passwordHash: SEED_HASH, passwordSalt: SEED_SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", tester: false, businessOnboarded: true, business: { businessName: "Active Kitchen", legalName: "Active Kitchen LLC", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Seeded active business." } };
  seed["email:active@fixtures.dev"] = { userId: "bizactive" };
  // Joins by EMAIL on 2026-11-05 (first touch 2026-11-02 15:00 -> 2 full days).
  seed["user:crjoinmail"] = creatorSeed("crjoinmail", "joined-by-email@fixtures.dev", "Mail Joiner", "mailjoiner", "Nashville", "2026-11-05T00:00:00.000Z");
  seed["email:joined-by-email@fixtures.dev"] = { userId: "crjoinmail" };
  // Joins by HANDLE on 2026-11-04 (first touch 2026-11-03 15:00 -> under a day, 0).
  seed["user:crjoinhandle"] = creatorSeed("crjoinhandle", "other@fixtures.dev", "Handle Joiner", "handlejoiner", "Austin", "2026-11-04T00:00:00.000Z");
  seed["email:other@fixtures.dev"] = { userId: "crjoinhandle" };
  seed["offer:offeraustin"] = { id: "offeraustin", businessId: "bizactive", market: "Austin", category: "Restaurant", kind: "paid", cashRate: 200, title: "Austin opening night", status: "open", createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" };
  // Three zero-result briefed searches for Austin x Food & Drink
  // (the M1 composite trigger), in the real capture's shape.
  for (let i = 0; i < 3; i++) {
    const id = crypto.randomUUID();
    seed[`event:2026-11-05:${id}`] = { id, ts: `2026-11-05T1${i}:00:00.000Z`, type: "discover_search", actorId: "bizactive", actorRole: "business", subjectId: null, market: "Austin", data: { filters: { market: "Austin", category: "Food & Drink" }, resultCount: 0, zeroResults: true, briefed: false } };
  }
  fs.writeFileSync(DB, JSON.stringify(seed));
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok -", name);
  else { failures++; console.log("  FAIL -", name, extra || ""); }
}
function readDb() { return JSON.parse(fs.readFileSync(DB, "utf8")); }
function readEvents(type) {
  const db = readDb();
  return Object.entries(db)
    .filter(([k, v]) => k.startsWith("event:") && v && v.type === type)
    .map(([, v]) => v)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
}
function client() {
  const jar = new Map();
  return async (method, p, body, hdrs) => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "), ...(hdrs || {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  };
}
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base + "/api/bootstrap"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

const PORT = 8963;
const base = `http://127.0.0.1:${PORT}`;
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: ROOT,
  env: {
    ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL: "jeff@joinsignl.com", ADMIN_PASSWORD: "verify-admin-pass-123", APP_URL: base, SIGNL_TEST_ALLOW_BUSINESS: "1",
    SIGNL_SWEEP_TOKEN: SWEEP, SIGNL_FORM_TOKEN: FORM_TOKEN,
    SIG_AI_BASE_URL: "", SIG_AI_API_KEY: "", OPENAI_API_KEY: "", OPENAI_BASE_URL: "", OPENROUTER_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "",
    MAGGIE_AI_ENABLED: "", MAGGIE_AI_MODEL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

const BATCH = { items: [
  { kind: "send", importKey: "gmail:proof-msg-1", handle: "outreachhandle1", email: "joined-by-email@fixtures.dev", market: "Nashville", cityRaw: "Nashville", lane: "gmail", messageId: "proof-msg-1", template: "variant-b", sentAt: "2026-11-02T15:00:00.000Z", note: "proof send one" },
  { kind: "send", importKey: "gmail:proof-msg-2", handle: "handlejoiner", email: null, market: "Austin", cityRaw: "Austin", lane: "gmail", messageId: "proof-msg-2", template: null, sentAt: "2026-11-03T15:00:00.000Z", note: null },
  { kind: "send", importKey: "gmail:proof-msg-3", handle: "austprospect1", email: "ap1@fixtures.dev", market: "Austin", cityRaw: "Austin", lane: "gmail", messageId: "proof-msg-3", template: null, sentAt: "2026-11-04T15:00:00.000Z", note: null },
  { kind: "send", importKey: "gmail:proof-msg-4", handle: "dmfriend", email: null, market: "London", cityRaw: "London", lane: "dm", messageId: "mid.$proof", template: null, sentAt: "2026-11-05T15:00:00.000Z", note: null },
  { kind: "send", importKey: "gmail:proof-msg-5", handle: "clarksvillecreator", email: null, market: "Clarksville", cityRaw: "Clarksville", lane: "gmail", messageId: "proof-msg-5", template: null, sentAt: "2026-11-06T15:00:00.000Z", note: null },
  { kind: "prospect", importKey: "roster:proof.json:outreachhandle1", handle: "outreachhandle1", name: "Out Reach", email: "joined-by-email@fixtures.dev", market: "Nashville", category: "food", followers: 5000, followersDetail: "Instagram 5,000", localEvidence: "Nashville bio", lane: "email", emailSource: "bio", mxVerified: true, verifiedAt: "2026-11-07T00:00:00.000Z", rosterFile: "proof-roster.json" },
  { kind: "prospect", importKey: "roster:proof.json:austprospect1", handle: "austprospect1", name: "Austin One", email: "ap1@fixtures.dev", market: "Austin", category: "food", followers: 12000, followersDetail: null, localEvidence: "Austin bio", lane: "email", emailSource: "bio", mxVerified: true, verifiedAt: "2026-11-07T00:00:00.000Z", rosterFile: "proof-roster.json" },
  { kind: "prospect", importKey: "roster:proof.json:austprospect2", handle: "austprospect2", name: "Austin Two", email: null, market: "Austin", category: "fitness", followers: 8000, followersDetail: null, localEvidence: "Austin bio", lane: "dm", emailSource: null, mxVerified: null, verifiedAt: "2026-11-07T00:00:00.000Z", rosterFile: "proof-roster.json" },
  { kind: "prospect", importKey: "roster:proof.json:dualmarket-raleigh", handle: "dualmarket", name: "Dual Market", email: null, market: "Raleigh", category: "food", followers: 3000, followersDetail: null, localEvidence: "Raleigh bio", lane: "email", emailSource: "bio", mxVerified: true, verifiedAt: "2026-11-07T00:00:00.000Z", rosterFile: "proof-roster.json" },
  { kind: "prospect", importKey: "roster:proof.json:dualmarket-charlotte", handle: "dualmarket", name: "Dual Market", email: null, market: "Charlotte", category: "food", followers: 3000, followersDetail: null, localEvidence: "Charlotte bio", lane: "email", emailSource: "bio", mxVerified: true, verifiedAt: "2026-11-07T00:00:00.000Z", rosterFile: "proof-roster.json" },
  { kind: "bounce", importKey: "mds:ap1@fixtures.dev", handle: null, email: "ap1@fixtures.dev", market: null, at: "2026-11-05T09:00:00.000Z", bounceClass: "hard", enhancedCode: "5.1.1", smtpCode: "550", noticeId: "notice-1" },
  { kind: "bounce", importKey: "mds:dmfriend", handle: "dmfriend", email: null, market: null, at: "2026-11-05T10:00:00.000Z", bounceClass: "soft", enhancedCode: "5.2.2", smtpCode: "552", noticeId: "notice-2" },
  { kind: "reply", importKey: "reply:proof:austprospect2", handle: "austprospect2", email: null, market: "Austin", at: "2026-11-06T09:00:00.000Z", outcome: "interested", source: "state_records", threadRef: "thread-1", summary: "Asked about launch timing" },
  { kind: "reply", importKey: "reply:proof:byemail", handle: null, email: "joined-by-email@fixtures.dev", market: null, at: "2026-11-06T10:00:00.000Z", outcome: "question", source: "state_records", threadRef: "thread-2", summary: "Asked how rates work" },
  { kind: "form", importKey: "gmail:proof-form-1", formType: "city-request", at: "2026-11-06T12:00:00.000Z", fields: { city: "Franklin", region: "TN", handle: "franklinfoodie", email: "" }, source: "netlify_form", sourceRef: "gmail:proof-form-1" },
  { kind: "form", importKey: "gmail:proof-form-2", formType: "business-application", at: "2026-11-06T12:05:00.000Z", fields: { businessName: "Proof Tacos", category: "Restaurant", type: "Food truck", contactName: "Pat Proof", email: "pat@prooftacos.dev", phone: "", city: "Franklin, TN", tierInterest: "Growth" }, source: "netlify_form", sourceRef: "gmail:proof-form-2" },
  { kind: "form", importKey: "gmail:proof-form-3", formType: "creator-application", at: "2026-11-06T12:10:00.000Z", fields: { name: "Casey", handle: "caseycreates", email: "casey@fixtures.dev", city: "Franklin, TN" }, source: "netlify_form", sourceRef: "gmail:proof-form-3" },
] };

try {
  check("fixture server boots", await waitUp());
  const anon = client();
  const usersBefore = JSON.stringify(Object.entries(readDb()).filter(([k]) => k.startsWith("user:")).sort());

  console.log("== auth ==");
  const noAuth = await anon("POST", "/api/admin/imports/outside", BATCH);
  check("import endpoint refuses anonymous calls (403)", noAuth.status === 403, String(noAuth.status));
  const badToken = await anon("POST", "/api/admin/imports/outside", BATCH, { "x-signl-sweep-token": "wrong" });
  check("import endpoint refuses a wrong sweep token (403)", badToken.status === 403, String(badToken.status));

  console.log("== import batch 1 ==");
  const imp = await anon("POST", "/api/admin/imports/outside", BATCH, { "x-signl-sweep-token": SWEEP });
  check("import answers 200 with the sweep token", imp.status === 200, JSON.stringify(imp.data).slice(0, 200));
  const c = imp.data.counts || {};
  check("counts: sends 5 received / 5 written / 0 skipped", c.send && c.send.received === 5 && c.send.written === 5 && c.send.skipped === 0, JSON.stringify(c.send));
  check("counts: prospects 5 / 5 / 0", c.prospect && c.prospect.received === 5 && c.prospect.written === 5 && c.prospect.skipped === 0, JSON.stringify(c.prospect));
  check("counts: bounces 2/2, replies 2/2, forms 3/3", c.bounce && c.bounce.written === 2 && c.reply && c.reply.written === 2 && c.form && c.form.written === 3, JSON.stringify(c));

  console.log("== event fidelity ==");
  const sends = readEvents("outreach_sent");
  check("5 outreach_sent events in the log", sends.length === 5, String(sends.length));
  const s1 = sends.find((e) => e.data && e.data.message_id === "proof-msg-1");
  check("sample send matches the source record field-for-field", !!s1 && s1.ts === "2026-11-02T15:00:00.000Z" && s1.market === "Nashville" && s1.subjectId === "outprospect:outreachhandle1" && s1.data.source === "gmail_lane" && s1.data.email === "joined-by-email@fixtures.dev" && s1.data.handle === "outreachhandle1" && s1.data.lane === "gmail" && s1.data.template === "variant-b" && s1.data.cityRaw === "Nashville" && s1.data.note === "proof send one", JSON.stringify(s1));
  const dbKeys = Object.keys(readDb());
  check("the send event is keyed on its own send date (event:2026-11-02:)", !!s1 && dbKeys.some((k) => k === `event:2026-11-02:${s1.id}`), "");
  const s5 = sends.find((e) => e.data && e.data.message_id === "proof-msg-5");
  check("typed-city resolution: the Clarksville send lands on Nashville, raw city preserved", !!s5 && s5.market === "Nashville" && s5.data.cityRaw === "Clarksville", JSON.stringify(s5 && { market: s5.market, cityRaw: s5.data.cityRaw }));
  const s4 = sends.find((e) => e.data && e.data.message_id === "mid.$proof");
  check("DM send carries the dm lane and dm_lane source", !!s4 && s4.data.lane === "dm" && s4.data.source === "dm_lane", JSON.stringify(s4 && s4.data));

  console.log("== prospect mirror ==");
  const db1 = readDb();
  const prospects = Object.entries(db1).filter(([k]) => k.startsWith("outprospect:")).map(([, v]) => v);
  check("7 prospect mirror records (one per handle)", prospects.length === 7, String(prospects.length));
  const dual = db1["outprospect:dualmarket"];
  check("dual-market record: Raleigh + Charlotte unioned, both verified, primary stays first", !!dual && dual.markets.length === 2 && dual.markets.includes("Raleigh") && dual.markets.includes("Charlotte") && dual.verifiedMarkets.length === 2 && dual.market === "Raleigh", JSON.stringify(dual));
  check("5 prospect_verified events (one per handle x market)", readEvents("prospect_verified").length === 5, String(readEvents("prospect_verified").length));
  const oh1 = db1["outprospect:outreachhandle1"];
  check("send + roster merge on one record (contacted AND verified, email kept)", !!oh1 && oh1.contacted === true && !!oh1.verifiedAt && oh1.email === "joined-by-email@fixtures.dev" && oh1.firstContactAt === "2026-11-02T15:00:00.000Z", JSON.stringify(oh1));

  console.log("== bounces + replies resolve identity ==");
  const ap1 = db1["outprospect:austprospect1"];
  check("email-only bounce resolved to austprospect1 and stamped hard / count 1", !!ap1 && ap1.bounceClass === "hard" && ap1.bounceCode === "5.1.1" && ap1.bounceCount === 1, JSON.stringify(ap1));
  const dmf = db1["outprospect:dmfriend"];
  check("soft bounce stamped on dmfriend", !!dmf && dmf.bounceClass === "soft" && dmf.bounceCount === 1, JSON.stringify(dmf));
  check("2 outreach_bounced events", readEvents("outreach_bounced").length === 2, "");
  const ap2 = db1["outprospect:austprospect2"];
  check("reply stamped on austprospect2 (interested)", !!ap2 && ap2.replyOutcome === "interested" && ap2.replyThreadRef === "thread-1", JSON.stringify(ap2));
  check("email-only reply resolved to outreachhandle1 (question)", !!oh1 && oh1.replyOutcome === "question", JSON.stringify(oh1 && oh1.replyOutcome));
  check("2 prospect_replied events with the brief's outcome enum", readEvents("prospect_replied").length === 2 && readEvents("prospect_replied").every((e) => ["interested", "question", "not_now", "declined", "converted"].includes(e.data.outcome)), "");

  console.log("== forms land as demand ==");
  const cityReqs = Object.values(db1).filter((v) => v && v.city === "Franklin" && v.source === "netlify_form");
  check("city-request became a cityrequest record (Franklin, handle kept)", cityReqs.length === 1 && cityReqs[0].handle === "franklinfoodie", JSON.stringify(cityReqs));
  const bizapps = Object.values(db1).filter((v) => v && v.businessName === "Proof Tacos");
  check("business-application became a bizapp record (source netlify-form)", bizapps.length === 1 && bizapps[0].source === "netlify-form" && bizapps[0].email === "pat@prooftacos.dev", JSON.stringify(bizapps));
  check("3 form_received events (incl. the event-only creator-application)", readEvents("form_received").length === 3, String(readEvents("form_received").length));
  check("creator-application wrote NO demand record", Object.values(db1).filter((v) => v && (v.handle === "caseycreates" || v.city === "Franklin, TN")).length === 1, "");

  console.log("== idempotent re-run ==");
  const countsBefore = { sent: readEvents("outreach_sent").length, verified: readEvents("prospect_verified").length, forms: readEvents("form_received").length, prospects: Object.keys(readDb()).filter((k) => k.startsWith("outprospect:")).length, cityreqs: Object.keys(readDb()).filter((k) => k.startsWith("cityrequest:")).length };
  const imp2 = await anon("POST", "/api/admin/imports/outside", BATCH, { "x-signl-sweep-token": SWEEP });
  const c2 = imp2.data.counts || {};
  check("re-run: every kind fully skipped, nothing written", Object.values(c2).every((x) => x.written === 0 && x.skipped === x.received), JSON.stringify(c2));
  const countsAfter = { sent: readEvents("outreach_sent").length, verified: readEvents("prospect_verified").length, forms: readEvents("form_received").length, prospects: Object.keys(readDb()).filter((k) => k.startsWith("outprospect:")).length, cityreqs: Object.keys(readDb()).filter((k) => k.startsWith("cityrequest:")).length };
  check("re-run: store counts unchanged", JSON.stringify(countsBefore) === JSON.stringify(countsAfter), JSON.stringify({ countsBefore, countsAfter }));

  console.log("== conversion join ==");
  const joinRes = await anon("POST", "/api/admin/imports/outside", { items: [], join: true }, { "x-signl-sweep-token": SWEEP });
  check("join reports 2 conversions", joinRes.status === 200 && joinRes.data.join && joinRes.data.join.joined === 2, JSON.stringify(joinRes.data.join));
  const conv = readEvents("outreach_converted");
  check("2 outreach_converted events", conv.length === 2, String(conv.length));
  const convMail = conv.find((e) => e.data && e.data.handle === "outreachhandle1");
  check("email join: outreachhandle1 -> crjoinmail, 2 full days to convert, event on the signup date", !!convMail && convMail.data.userId === "crjoinmail" && convMail.data.joinedOn === "email" && convMail.data.daysToConvert === 2 && convMail.ts === "2026-11-05T00:00:00.000Z", JSON.stringify(convMail));
  const convHandle = conv.find((e) => e.data && e.data.handle === "handlejoiner");
  check("handle join: handlejoiner -> crjoinhandle, same-day conversion (0 days)", !!convHandle && convHandle.data.userId === "crjoinhandle" && convHandle.data.joinedOn === "handle" && convHandle.data.daysToConvert === 0, JSON.stringify(convHandle));
  const db2 = readDb();
  check("join stamped on the prospect records only", db2["outprospect:outreachhandle1"].joinedUserId === "crjoinmail" && db2["outprospect:handlejoiner"].joinedUserId === "crjoinhandle", "");
  const usersAfter = JSON.stringify(Object.entries(db2).filter(([k]) => k.startsWith("user:")).sort());
  check("user records are byte-identical after the whole import (join never mutates a user)", usersBefore === usersAfter, "");
  const join2 = await anon("POST", "/api/admin/imports/outside", { items: [], join: true }, { "x-signl-sweep-token": SWEEP });
  check("second join run converts nobody new", join2.data.join && join2.data.join.joined === 0, JSON.stringify(join2.data.join));

  console.log("== data view + M1 receipts ==");
  const admin = client();
  const ra = await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "verify-admin-pass-123" });
  check("admin signed in", ra.status === 200, String(ra.status));
  const dv = await admin("GET", "/api/admin/stats/data?days=30");
  const ox = dv.data.outside || {};
  check("outside sends: 5 total (4 gmail + 1 dm), capturing since the first send date", !!ox.sends && ox.sends.total === 5 && ox.sends.byLane.gmail === 4 && ox.sends.byLane.dm === 1 && ox.sends.since === "2026-11-02", JSON.stringify(ox.sends));
  check("outside prospects: 7 total, 4 verified, 5 contacted, 2 joined", !!ox.prospects && ox.prospects.total === 7 && ox.prospects.verified === 4 && ox.prospects.contacted === 5 && ox.prospects.joined === 2, JSON.stringify(ox.prospects));
  check("outside forms: 3 imported, 1 city request record, 1 business application record", !!ox.forms && ox.forms.imported === 3 && ox.forms.cityRequests === 1 && ox.forms.businessApplications === 1, JSON.stringify(ox.forms));
  check("outside replies: 2 (interested 1, question 1); bounces: 2 (hard 1, soft 1)", !!ox.replies && ox.replies.total === 2 && ox.replies.byOutcome.interested === 1 && ox.replies.byOutcome.question === 1 && !!ox.bounces && ox.bounces.total === 2 && ox.bounces.byClass.hard === 1 && ox.bounces.byClass.soft === 1, JSON.stringify({ replies: ox.replies, bounces: ox.bounces }));
  check("the imported city request shows in the Data view backlog", (dv.data.backlog.cityRequests || []).some((r) => r.city === "Franklin" && r.handle === "franklinfoodie"), JSON.stringify(dv.data.backlog));
  const sug = await admin("GET", "/api/admin/suggestions");
  const rec = (sug.data.suggestions || []).find((s) => s.id === "recruit:Austin:Food & Drink");
  check("M1 recruit card for Austin x Food & Drink is on the board", !!rec, JSON.stringify((sug.data.suggestions || []).map((s) => s.id)));
  check("M1 receipts now carry the prospect universe (2 verified in Austin, 2 contacted)", !!rec && rec.receipt.prospectsVerified === 2 && rec.receipt.prospectsContacted === 2, JSON.stringify(rec && rec.receipt));

  console.log("== forms webhook ==");
  const whNo = await anon("POST", "/api/forms/netlify", { form_name: "city-request", data: { city: "Murfreesboro", state: "TN", contact: "@murfreesfood" }, created_at: "2026-11-07T10:00:00.000Z" });
  check("webhook refuses a missing token (401)", whNo.status === 401, String(whNo.status));
  const wh = await anon("POST", "/api/forms/netlify?token=" + FORM_TOKEN, { form_name: "city-request", data: { city: "Murfreesboro", state: "TN", contact: "@murfreesfood" }, created_at: "2026-11-07T10:00:00.000Z" });
  check("webhook accepts with the token and writes the record", wh.status === 200 && wh.data.ok === true && !!wh.data.id, JSON.stringify(wh.data).slice(0, 160));
  const db3 = readDb();
  const whRec = wh.data.id ? db3[`cityrequest:${wh.data.id}`] : null;
  check("webhook city request on file (handle normalized, source netlify_form)", !!whRec && whRec.city === "Murfreesboro" && whRec.handle === "murfreesfood" && whRec.source === "netlify_form", JSON.stringify(whRec));
  const whDup = await anon("POST", "/api/forms/netlify?token=" + FORM_TOKEN, { form_name: "city-request", data: { city: "Murfreesboro", state: "TN", contact: "@murfreesfood" }, created_at: "2026-11-07T10:00:00.000Z" });
  check("duplicate webhook delivery dedupes", whDup.status === 200 && whDup.data.deduped === true && Object.keys(readDb()).filter((k) => k.startsWith("cityrequest:")).length === Object.keys(db3).filter((k) => k.startsWith("cityrequest:")).length, JSON.stringify(whDup.data));

  console.log("== honesty scan ==");
  const forbidden = ["openRate", "clickRate", "openedAt", "clickedAt", "gmailOpen", "gmailClick", "open_rate", "click_rate", "trackOpens", "trackClicks"];
  for (const f of ["netlify/functions/lib/router.js", "netlify/functions/lib/events.js", "public/app.js", "scripts/import-outside.mjs"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    const hits = forbidden.filter((w) => src.includes(w));
    check(`no Gmail open/click metric identifier in ${f}`, hits.length === 0, hits.join(","));
  }
} finally {
  server.kill("SIGTERM");
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
