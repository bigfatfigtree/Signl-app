#!/usr/bin/env node
// Build -185 fixture suite: the dormant win-back sweep.
// Seeds approved creators + businesses through the real API,
// then time-shifts their records in the DB (lastSignInAt /
// reviewedAt / createdAt anchors, booking + post records, a
// winback cap stamp, a fresh lifecycle email event) and runs
// the compliance sweep endpoint, which now also runs
// runWinbackSweep. Asserts exactly who got nudged and who was
// skipped, and that a second run sends nothing again.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8941;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = ["admin", "pass", "185"].join("-");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "signl-verify185-"));
const DB = path.join(TMP, "db.json");

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };
const readDb = () => JSON.parse(fs.readFileSync(DB, "utf8"));
const writeDb = (db) => fs.writeFileSync(DB, JSON.stringify(db, null, 1));
const daysAgo = (d) => new Date(Date.now() - d * 86400e3).toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => { const s = String(d); if (/error/i.test(s)) process.stdout.write(`[server] ${s}`); });
  server.stderr.on("data", (d) => process.stdout.write(`[server-err] ${d}`));
}
function stopServer() { return new Promise((res) => { if (!server) return res(); server.once("exit", () => res()); server.kill("SIGTERM"); setTimeout(res, 3000); }); }
function waitUp(tries = 60) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      const req = http.get(`${BASE}/api/bootstrap`, (r) => { r.resume(); resolve(r.statusCode === 200); });
      req.on("error", () => { if (n <= 0) resolve(false); else setTimeout(() => attempt(n - 1), 250); });
    };
    attempt(tries);
  });
}
function client() {
  let cookie = "";
  return async (method, p, body) => {
    const r = await fetch(`${BASE}${p}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = r.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: r.status, data };
  };
}

async function main() {
  console.log("== unit: the win-back email branches on the real scope field ==");
  const router = createRequire(import.meta.url)("../netlify/functions/lib/router.js");
  const natMail = router.winBackEmail({ name: "Trop Fixture", email: "nat@fixtures.dev", role: "business", market: "National", business: { scope: "national", businessName: "Trop Fixture" } });
  check("national business gets the national copy", natMail.text.includes("your national founding account is still held"), natMail.text.slice(0, 160));
  check("national copy never says 'in National'", !natMail.text.includes("in National"));
  const mktMail = router.winBackEmail({ name: "Local Fixture", email: "loc@fixtures.dev", role: "business", market: "Nashville", business: { scope: "market", businessName: "Local Fixture" } });
  check("market business keeps the market copy", mktMail.text.includes("your founding business spot in Nashville is still held"), mktMail.text.slice(0, 160));

  startServer();
  check("dev server up", await waitUp());
  const adm = client();
  check("admin login", (await adm("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).status === 200);

  const mkCreator = async (email, handle) => {
    const r = await client()("POST", "/api/auth/register", { role: "creator", quickClaim: true, email, password: "fixture-pass-185", handle, primaryPlatform: "instagram", market: "Nashville", agreedTerms: true });
    return r.data.user;
  };
  const mkBusiness = async (email, name) => {
    const r = await client()("POST", "/api/auth/register", { role: "business", name: "Owner " + name, email, password: "fixture-pass-185", businessName: name, category: "Retail", market: "Nashville", city: "Nashville", planId: "launch", agreedTerms: true });
    return r.data.user;
  };
  const approve = async (u) => { const r = await adm("POST", "/api/admin/review", { userId: u.id, decision: "approve" }); check(`approve ${u.email}`, r.status === 200 && r.data.user.status === "approved", JSON.stringify(r.data).slice(0, 120)); };
  const finishProfile = async (email) => {
    const c = client();
    await c("POST", "/api/auth/login", { email, password: "fixture-pass-185" });
    const r = await c("PATCH", "/api/me/profile", { city: "Nashville", categories: ["Food & Drink"], localAudiencePct: 85, audienceStack: { instagram: 12000 } });
    check(`finish profile ${email}`, r.status === 200, JSON.stringify(r.data).slice(0, 120));
  };

  console.log("== seed the cast ==");
  const c1 = await mkCreator("c1@fixtures.dev", "c1fixture"); await approve(c1); await finishProfile("c1@fixtures.dev"); // dormant + finished -> nudged
  const c2 = await mkCreator("c2@fixtures.dev", "c2fixture"); await approve(c2);   // active -> nothing
  const c3 = await mkCreator("c3@fixtures.dev", "c3fixture"); await approve(c3); await finishProfile("c3@fixtures.dev"); // dormant + booked -> skipped
  const c4 = await mkCreator("c4@fixtures.dev", "c4fixture");                      // pending -> excluded
  const c5 = await mkCreator("c5@fixtures.dev", "c5fixture"); await approve(c5); await finishProfile("c5@fixtures.dev"); // 13 days -> not yet
  const c7 = await mkCreator("c7@fixtures.dev", "c7fixture"); await approve(c7);   // dormant but UNFINISHED -> Finish Engine's lane, excluded
  const t1 = await mkCreator("t1@fixtures.dev", "t1fixture"); await approve(t1);   // tester -> excluded
  const b1 = await mkBusiness("b1@fixtures.dev", "B1 Fixture Goods"); await approve(b1); // dormant -> emailed
  const b2 = await mkBusiness("b2@fixtures.dev", "B2 Fixture Goods"); await approve(b2); // capped -> skipped
  const b3 = await mkBusiness("b3@fixtures.dev", "B3 Fixture Goods"); await approve(b3); // lifecycle email 1h ago -> suppressed
  const b4 = await mkBusiness("b4@fixtures.dev", "B4 Fixture Goods"); await approve(b4); // redeemed, post owed -> skipped
  const b5 = await mkBusiness("b5@fixtures.dev", "B5 Fixture Goods"); await approve(b5); // redeemed + posted -> emailed
  // A dormant NATIONAL business is seeded at the DB layer below
  // (built by national.buildNationalBusinessUser, the same
  // constructor the admin-created and self-serve flows use):
  // it must be emailed, with the national copy (unit-proven above).
  const c8client = client();
  const c8 = await mkCreator("c8@fixtures.dev", "c8fixture"); await approve(c8);
  await c8client("POST", "/api/auth/login", { email: "c8@fixtures.dev", password: "fixture-pass-185" });
  check("finish profile c8@fixtures.dev", (await c8client("PATCH", "/api/me/profile", { city: "Nashville", categories: ["Food & Drink"], localAudiencePct: 85, audienceStack: { instagram: 12000 } })).status === 200);
  // c8 keeps this session cookie across the restart below: a live
  // session from 20 days ago. Loading /auth/me must refresh the
  // activity stamp, so the sweep leaves c8 alone (review fix D2).

  console.log("== time-shift the records ==");
  await stopServer();
  const db = readDb();
  const setUser = (id, patch) => { const k = `user:${id}`; db[k] = { ...db[k], ...patch }; };
  const dormant = { lastSignInAt: daysAgo(20), reviewedAt: daysAgo(30), createdAt: daysAgo(40) };
  for (const u of [c1, c3, c7, b1, b2, b3, b4, b5, c8]) setUser(u.id, dormant);
  const nationalLib = createRequire(import.meta.url)("../netlify/functions/lib/national.js");
  const nb = nationalLib.buildNationalBusinessUser({ email: "nb@fixtures.dev", name: "Nat Fixture", businessName: "Nat Fixture Brands", brandName: "Nat Fixture", category: "Retail" }, { nowIso: () => new Date().toISOString(), termsVersion: null });
  nb.status = "approved";
  db[`user:${nb.id}`] = { ...nb, ...dormant };
  db[`email:${nb.email}`] = { userId: nb.id };
  setUser(c2.id, { lastSignInAt: daysAgo(2), reviewedAt: daysAgo(30), createdAt: daysAgo(40) });
  setUser(c4.id, { lastSignInAt: daysAgo(20), reviewedAt: null, createdAt: daysAgo(40) });
  setUser(c5.id, { lastSignInAt: daysAgo(13), reviewedAt: daysAgo(30), createdAt: daysAgo(40) });
  setUser(t1.id, { ...dormant, tester: true });
  db[`winback:${b2.id}`] = { lastSentAt: daysAgo(10), role: "business" };
  const evId = "11111111-2222-3333-4444-555555555555";
  const today = new Date().toISOString().slice(0, 10);
  db[`event:${today}:${evId}`] = { id: evId, ts: hoursAgo(1), type: "approval_email_sent", actorId: b3.id, actorRole: "business", subjectId: b3.id, market: "Nashville", data: { kind: "approval" } };
  db["booking:bk-c3"] = { id: "bk-c3", creatorId: c3.id, businessId: b1.id, status: "booked", redeemedAt: null, createdAt: daysAgo(3) };
  // NOTE: bk-c3 names b1 as its business — that would obligate
  // b1 too. Point it at a non-cast business id instead.
  db["booking:bk-c3"].businessId = "business-not-in-cast";
  db["booking:bk-b4"] = { id: "bk-b4", creatorId: c1.id, businessId: b4.id, status: "redeemed", redeemedAt: daysAgo(2), createdAt: daysAgo(5) };
  // bk-b4 names c1 as its creator with the post outstanding —
  // that would obligate c1 too. Point it at a non-cast creator.
  db["booking:bk-b4"].creatorId = "creator-not-in-cast";
  db["booking:bk-b5"] = { id: "bk-b5", creatorId: "creator-not-in-cast", businessId: b5.id, status: "redeemed", redeemedAt: daysAgo(6), createdAt: daysAgo(9) };
  db["post:p-b5"] = { id: "p-b5", bookingId: "bk-b5", creatorId: "creator-not-in-cast", url: "https://example.com/post", submittedAt: daysAgo(5) };
  writeDb(db);
  startServer();
  check("server restarts on the shifted db", await waitUp());
  const adm2 = client();
  await adm2("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  console.log("== a live session loading /auth/me counts as activity ==");
  const me = await c8client("GET", "/api/auth/me");
  check("c8's session still valid after the shift", me.status === 200, JSON.stringify(me.data).slice(0, 120));
  const c8Rec = readDb()[`user:${c8.id}`];
  check("/auth/me refreshed c8's activity stamp", Math.abs(Date.now() - Date.parse(c8Rec.lastSignInAt)) < 120000, c8Rec.lastSignInAt);

  console.log("== run the sweep ==");
  const sweep = await adm2("POST", "/api/admin/compliance/sweep", {});
  check("sweep responds with a winback summary", sweep.status === 200 && !!sweep.data.winback, JSON.stringify(sweep.data).slice(0, 200));
  const wb = (sweep.data && sweep.data.winback) || {};
  check("one creator nudged", wb.sentCreators === 1, JSON.stringify(wb));
  check("three businesses emailed (b1 + b5 + national)", wb.sentBusinesses === 3, JSON.stringify(wb));
  check("one suppression (b3)", wb.suppressed === 1, JSON.stringify(wb));
  check("two active-booking skips (c3 + b4)", wb.skippedActiveBooking === 2, JSON.stringify(wb));
  check("one monthly-cap skip (b2)", wb.skippedCap === 1, JSON.stringify(wb));

  const db2 = readDb();
  const msgsTo = (id) => Object.values(db2).filter((v) => v && v.toId === id && v.platform && /Maggie here from the Magpie team/.test(v.body || ""));
  check("Maggie message landed for the dormant creator", msgsTo(c1.id).length === 1 && /Maggie here from the Magpie team/.test(msgsTo(c1.id)[0].body || ""), JSON.stringify(msgsTo(c1.id)).slice(0, 160));
  check("no message for the active creator", msgsTo(c2.id).length === 0);
  check("no message for the booked creator", msgsTo(c3.id).length === 0);
  check("no message for the pending creator", msgsTo(c4.id).length === 0);
  check("no message for the 13-day creator", msgsTo(c5.id).length === 0);
  check("no message for the tester", msgsTo(t1.id).length === 0);
  check("no message for the unfinished creator (Finish Engine's lane)", msgsTo(c7.id).length === 0);
  check("no message for the session-active creator (activity stamp)", msgsTo(c8.id).length === 0);
  check("no winback stamp for the unfinished creator", !db2[`winback:${c7.id}`]);
  check("winback stamps: c1 + b1 + b5 + national stamped", !!db2[`winback:${c1.id}`] && !!db2[`winback:${b1.id}`] && !!db2[`winback:${b5.id}`] && !!db2[`winback:${nb.id}`]);
  check("b2's cap stamp is still the OLD one (~10 days)", Math.abs(Date.parse((db2[`winback:${b2.id}`] || {}).lastSentAt) - (Date.now() - 10 * 86400e3)) < 3600e3, (db2[`winback:${b2.id}`] || {}).lastSentAt);
  check("b3 has NO winback stamp (suppressed before stamping)", !db2[`winback:${b3.id}`]);
  check("b4 has NO winback stamp (booking skip)", !db2[`winback:${b4.id}`]);
  const wbEvents = Object.values(db2).filter((v) => v && v.type === "winback_sent");
  check("winback_sent events recorded for the four sends", wbEvents.length === 4, String(wbEvents.length));
  const supEvents = Object.values(db2).filter((v) => v && v.type === "winback_suppressed" && v.subjectId === b3.id);
  check("b3's suppression is logged, not silent", supEvents.length === 1);

  console.log("== the sign-in stamp moves on a real sign-in ==");
  const c2Login = await client()("POST", "/api/auth/login", { email: "c2@fixtures.dev", password: "fixture-pass-185" });
  check("c2 signs in", c2Login.status === 200, JSON.stringify(c2Login.data).slice(0, 120));
  const c2Rec = readDb()[`user:${c2.id}`];
  check("lastSignInAt updated to now", Math.abs(Date.now() - Date.parse(c2Rec.lastSignInAt)) < 120000, c2Rec.lastSignInAt);

  console.log("== a second sweep sends nothing again ==");
  const sweep2 = await adm2("POST", "/api/admin/compliance/sweep", {});
  const wb2 = (sweep2.data && sweep2.data.winback) || {};
  check("second run: zero sends", wb2.sentCreators === 0 && wb2.sentBusinesses === 0, JSON.stringify(wb2));
  const db3 = readDb();
  check("c1 still has exactly one Maggie message", Object.values(db3).filter((v) => v && v.toId === c1.id && v.platform && /Maggie here from the Magpie team/.test(v.body || "")).length === 1);

  await stopServer();
  console.log(`\nverify-build185: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error("SUITE ERROR:", e); await stopServer(); process.exit(1); });
