#!/usr/bin/env node
// Build -111 verification (Phase B experience audit, Jeff 2026-11-03):
//   B1 LONDON #AD BLOCKER, NAMED + FIXABLE — the server has named
//     this blocker since Build -89 (deliveryBlockers: "ad label
//     missing", delivery + paid escrow held, POST /posts/:id/
//     ad-label as the fix), but the visit card never rendered it:
//     a London creator could do everything visible and still be
//     blocked invisibly (rendered QA, pre-fix: no blocker text,
//     no fix UI on the card). Now: the creator's card names it
//     with a pre-filled caption box + Confirm the ad label (one
//     tap, riding the -89 endpoint); the business's card names
//     it and says the fix is the creator's; Sig prompts it at
//     deadline class on the creator home queue; in-app creator
//     FAQ + server Sig (both roles) state the rule and the path.
//   B2 LONDON VISIT CARD CURRENCY — the visit card header cap and
//     the deal block's comp worth render in the booking market's
//     currency (£ for London), not a hard-coded $.
//   B3 RECRUITER QUEUE ORIENTATION — the staff recruiter Queue
//     (first rendered QA this phase) opens with one plain line:
//     what the list is, work one at a time, copy/send from your
//     own app, mark sent here, nothing sends from the console.
//   B4 CAMPAIGN GUIDE TITLE — the one-sentence guide's parser no
//     longer leaves the pay word in the drafted title
//     ("weekend brunch push, comped" -> "Weekend brunch push").
//   Canon locks: LICENSE_WINDOW_DAYS 90, FOUNDING_STRIPE_PRICES
//     env-or-empty, stamp 2026.11.05-131.
//
// Run: node scripts/verify-build111.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import crypto from "node:crypto";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8992;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";

let passed = 0;
let failed = 0;
let currentPart = "boot";
const fails = [];
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const count = (s, sub) => s.split(sub).length - 1;

// ---------- source pins ----------
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const sigdataJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");

part("B1 source: blocker named + fixable on the visit card");
check("creator card renders the named blocker with a caption box + confirm action", appJs.includes("Ad label missing.</strong> UK rules count this London post as an ad") && appJs.includes('id="adlabel-caption-') && appJs.includes("Confirm the ad label"));
check("the caption pre-fill does the work: #ad line in front when the stored caption lacks it", appJs.includes('const adCap = /#ad\\b/i.test(post.caption || "") ? post.caption : (disclosureLine(b)'));
check("the blocker renders only from the server's own deliveryBlockers fact", appJs.includes('(b.deliveryBlockers || []).includes("ad label missing")'));
check("business card names the blocker and assigns the fix to the creator", appJs.includes("The creator fixes it on their own visit card by confirming the caption; there is nothing for you to do."));
check("confirmAdLabel rides the Build -89 endpoint and surfaces refusals beside the button", appJs.includes("async function confirmAdLabel(postId, bookingId)") && appJs.includes("/ad-label`, { caption:") && appJs.includes('document.getElementById("adlabel-note-" + bookingId)'));
check("creator home queue prompts the blocker at deadline class with a Done-segment focus action", appJs.includes("Ad label missing on your London post for") && appJs.includes('state.visitsSeg = "done"; state.visitFocus = b.id'));
check("in-app creator FAQ carries the ad label entry with the fix flow", appJs.includes('id: "adlabel"') && appJs.includes("tap Confirm the ad label") && appJs.includes('flow("Fix the ad label"'));
check("sigGo routes cr-visits-done to the Done segment", appJs.includes('case "cr-visits-done": state.visitsSeg = "done"'));

part("B1 source: server Sig states rule + path for both roles");
check("creator Sig answer: rule, blocker name, card fix, delivered on verify", sigdataJs.includes("blocked as Ad label missing and does not count as delivered yet") && sigdataJs.includes("tap Confirm the ad label") && sigdataJs.includes('"cr-visits-done"'));
check("business Sig answer: blocker named, money held on paid, fix is the creator's", sigdataJs.includes("the money stays held behind the same blocker") && sigdataJs.includes("The creator fixes it on their own visit card"));
check("server blocker + endpoint untouched (Build -89 canon)", routerJs.includes('out.push("ad label missing")') && routerJs.includes('seg[2] === "ad-label"'));

part("B2 source: visit card money in the booking market's currency");
check("deal block comp worth uses currencySymbolForMarket(b.market)", appJs.includes('worth ${currencySymbolForMarket(b.market)}${fmtMoney(b.dollarCap)}'));
check("visit card header cap uses currencySymbolForMarket(b.market)", appJs.includes('(cap ${currencySymbolForMarket(b.market)}${fmtMoney(b.dollarCap)})'));

part("B3 source: recruiter queue orientation line");
check("queue opens with the plain what/how/nothing-sends line", appJs.includes("Your list of creators to invite to SIGNL in") && appJs.includes("Nothing sends from this console itself."));

part("B4 source: guide title drops the pay word");
check("campaignGuideParse strips a trailing pay word from the drafted title", appJs.includes('.replace(/[,\\s]+(comped|comp|paid|cash|coupon)\\s*$/i, "")'));

part("canon locks");
check("LICENSE_WINDOW_DAYS still 90", routerJs.includes("const LICENSE_WINDOW_DAYS = 90"));
check("FOUNDING_STRIPE_PRICES stays env-or-empty (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'));
check("build stamp is 2026.11.05-131 on both sides", fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('exports.BUILD_ID = "2026.11.05-131"') && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.05-131"'));

// ---------- Sig answerer (in-process) ----------
part("Sig answerer: ad label, both roles");
const sigdata = createRequire(import.meta.url)("../netlify/functions/lib/sigdata.js");
{
  const cr = sigdata.answerFacts("creator", { role: "creator" }, "my london post says ad label missing, what do I do", []);
  check("creator Sig answers with rule + card fix", !!cr && cr.includes("Ad label missing") && cr.includes("Confirm the ad label"), String(cr));
  const crRaw = sigdata.answerFactsRaw("creator", { role: "creator" }, "ad label missing", []);
  check("creator Sig answer links to the Done segment fix", !!crRaw && typeof crRaw === "object" && crRaw.link && crRaw.link.dest === "cr-visits-done", JSON.stringify(crRaw && crRaw.link));
  const biz = sigdata.answerFacts("business", { role: "business" }, "why is my london visit blocked on an ad label", []);
  check("business Sig answers with blocker + creator-owned fix", !!biz && biz.includes("Ad label missing") && biz.includes("nothing for you to do"), String(biz));
}

// ---------- live flow: seeded London pair ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b111-"));
const dbFile = path.join(tmp, "db.json");
{
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
  const DAY = 86400000, now0 = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const data = {};
  const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
  const pw = { passwordSalt: salt, passwordHash: hash };
  putUser({ id: "lonbiz", role: "business", email: "lonbiz@b111.dev", name: "London Owner", ...pw, status: "approved", market: "London", city: "London", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), business: { businessName: "B111 London Cafe", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Brunch cafe." } });
  putUser({ id: "loncr", role: "creator", email: "loncr@b111.dev", name: "Lola London", ...pw, status: "approved", market: "London", city: "London", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), creator: { handle: "lolalondon111", followerCount: 4000, categories: ["Food & Drink"], localAudiencePct: 72, paidRate: 200, licensingFee: 80, tierBand: "Locals", primaryPlatform: "instagram" } });
  data["booking:lonbk"] = { id: "lonbk", offerId: null, businessId: "lonbiz", businessName: "B111 London Cafe", creatorId: "loncr", creatorName: "Lola London", creatorHandle: "lolalondon111", market: "London", category: "Restaurant", kind: "comp", title: "Weekend brunch", whatComped: "Brunch for two", covers: 2, dollarCap: 100, status: "completed", code: "LONB111", codeStatus: "burned", redeemedAt: iso(now0 - 2 * DAY), postDeadline: iso(now0 + 5 * DAY), createdAt: iso(now0 - 4 * DAY), updatedAt: iso(now0 - 1 * DAY) };
  data["post:lonpost"] = { id: "lonpost", bookingId: "lonbk", businessId: "lonbiz", creatorId: "loncr", url: "https://www.instagram.com/p/lonb111/", platform: "instagram", caption: "Great brunch at the cafe today", adLabelVerified: false, createdAt: iso(now0 - 1 * DAY), submittedAt: iso(now0 - 1 * DAY), onTime: true };
  fs.writeFileSync(dbFile, JSON.stringify(data));
}
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() { if (!server) return; server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; }
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  throw new Error("server did not come up");
}
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const piece of setCookie.split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data, text };
  };
}

try {
  startServer();
  await waitUp();
  const cr = makeClient();
  const crLogin = await cr("POST", "/api/auth/login", { email: "loncr@b111.dev", password: "qa-pass-1234" });
  check("London creator login", crLogin.status === 200, `${crLogin.status}`);
  const biz = makeClient();
  const bizLogin = await biz("POST", "/api/auth/login", { email: "lonbiz@b111.dev", password: "qa-pass-1234" });
  check("London business login", bizLogin.status === 200, `${bizLogin.status}`);

  part("B1 live: blocker present on both sides' booking payloads");
  const crBooks = await cr("GET", "/api/bookings");
  const crBk = (crBooks.data.bookings || []).find((b) => b.id === "lonbk");
  check("creator booking carries deliveryBlockers with the named blocker", !!crBk && (crBk.deliveryBlockers || []).includes("ad label missing"), JSON.stringify(crBk && crBk.deliveryBlockers));
  const bizBooks = await biz("GET", "/api/bookings");
  const bizBk = (bizBooks.data.bookings || []).find((b) => b.id === "lonbk");
  check("business booking carries the same named blocker", !!bizBk && (bizBk.deliveryBlockers || []).includes("ad label missing"), JSON.stringify(bizBk && bizBk.deliveryBlockers));

  part("B1 live: fix path refuses without #ad, verifies with it");
  const bad = await cr("POST", "/api/posts/lonpost/ad-label", { caption: "Great brunch at the cafe today" });
  check("a caption without #ad is refused in plain words and verifies nothing", bad.status === 400 && /does not carry #ad/.test(JSON.stringify(bad.data)), `${bad.status} ${JSON.stringify(bad.data).slice(0, 200)}`);
  const good = await cr("POST", "/api/posts/lonpost/ad-label", { caption: "#ad — comped by B111 London Cafe through SIGNL. Great brunch at the cafe today" });
  check("a caption with #ad up front verifies the label", good.status === 200 && good.data.post.adLabelVerified === true, `${good.status} ${JSON.stringify(good.data).slice(0, 200)}`);
  const after = await cr("GET", "/api/bookings");
  const afterBk = (after.data.bookings || []).find((b) => b.id === "lonbk");
  check("after the fix the blocker is gone: the visit counts as delivered", !!afterBk && !(afterBk.deliveryBlockers || []).includes("ad label missing"), JSON.stringify(afterBk && afterBk.deliveryBlockers));
} catch (e) {
  failed++; fails.push("exception: " + e.message);
  console.error("EXCEPTION", e);
} finally {
  await stopServer();
}

console.log(`\nBuild -111 (Phase B) verification: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
