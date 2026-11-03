#!/usr/bin/env node
// Build -98 verification: the Build -96 receipt regression fix
// (generatedAt renamed to exportedAt), Tier 2 quick-win items
// 11a (app part), 11g, and 11h, plus the creator-terms and
// service-provider site links (item 4).
//
// Proves, against a seeded throwaway store served by the real
// dev server on port 8978:
//   - the receipt export field is exportedAt everywhere the
//     Monthly Receipt uses it, and the receipt renderer slice
//     verify-build34 inspects carries no generated claim word;
//   - Sig (deterministic answerer) answers, per role: payout
//     setup paperwork for a creator (linked to Profile), the
//     rate starting points for a creator's tier and their
//     never-overwrite rule for a creator who already set rates,
//     London defaults in pounds, and creator terms with the
//     terms-page link for creator AND business; a partner has
//     no Sig facts in this app (buildSigFacts returns creator,
//     business, and admin sheets only), so 11g/11h and the
//     claim block carry no partner meaning;
//   - proactive Sig home chips render only when true: a
//     creator with paid activity and no payout setup, who is
//     finished with blank rates, gets both Build -98 chips; a
//     creator who is payout-ready with rates set gets neither;
//     a creator with no paid activity and an unfinished
//     profile gets neither (silence when nothing is true);
//   - defaults never migrate: after all those reads, the
//     blank creator's stored record still carries no paidRate
//     and no licensingFee, and the set creator's stored rates
//     are byte-identical to the seed;
//   - source + renderer behaviour for the claim done block,
//     the lane editor pre-fill, and the payout explainer
//     (shown before first setup, ack-gated, gone once setup
//     has started or finished).
//
// Run: node scripts/verify-build98.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8978;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b98.dev";
const ADMIN_PASSWORD = "b98-admin-pass-123";

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
const hash = crypto.scryptSync("fixture-pass-98", salt, 64).toString("hex");
const DAY = 86400000;
const now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const creator = (id, handle, over = {}) => putUser({
  id, role: "creator", email: `${id}@b98.dev`, name: `Creator ${id}`, passwordSalt: salt, passwordHash: hash,
  status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY),
  creator: { handle, followerCount: 3000, totalAudience: 3000, audienceStack: { instagram: 3000 }, categories: ["Food & Drink"], localAudiencePct: 70, tierBand: "Locals" },
  ...over,
});
// Blank rates, finished profile, one paid booking on record,
// payouts not started: both Build -98 prompts are true.
creator("crblank", "b98blank");
// Set rates, payouts ready, paid activity too: neither prompt.
creator("crset", "b98set", { creator: { handle: "b98set", followerCount: 22000, totalAudience: 22000, audienceStack: { instagram: 22000 }, categories: ["Food & Drink"], localAudiencePct: 70, tierBand: "Headliners", paidRate: 500, licensingFee: 200, payouts: { status: "ready", ready: true, missing: [] } } });
// London, blank rates: defaults render in pounds.
creator("crlondon", "b98london", { market: "London", city: "London" });
// Quiet: no paid activity, profile unfinished (no categories,
// no local share): neither prompt may fire.
creator("crquiet", "b98quiet", { creator: { handle: "b98quiet", followerCount: 900, totalAudience: 900, audienceStack: { instagram: 900 }, categories: [], localAudiencePct: null, tierBand: "Neighbors" } });
putUser({ id: "biz1", role: "business", email: "biz1@b98.dev", name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), business: { businessName: "B98 Table", category: "Restaurant", plan: "growth", planId: "growth", accessState: "founding" } });

const paidBooking = (id, creatorId) => {
  data[`booking:${id}`] = { id, offerId: `off-${id}`, businessId: "biz1", businessName: "B98 Table", creatorId, creatorName: `Creator ${creatorId}`, creatorHandle: creatorId, market: "Nashville", category: "Restaurant", kind: "paid", title: "Paid visit", status: "booked", redeemedAt: null, createdAt: iso(now0 - 2 * DAY), updatedAt: iso(now0 - 2 * DAY), paidLane: { rate: 250, creatorNet: 242.5, escrowState: "held" } };
};
paidBooking("bk-blank", "crblank");
paidBooking("bk-set", "crset");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build98-"));
const DB = path.join(tmp, "db.json");
fs.writeFileSync(DB, JSON.stringify(data));

console.log("== Build -98: Sig answers, per role (live) ==");
const server = startServer(DB, PORT);
try {
  await waitUp(BASE);
  const login = async (id) => { const c = new Client(BASE); const r = await c.req("POST", "/api/auth/login", { email: `${id}@b98.dev`, password: "fixture-pass-98" }); if (r.status !== 200) throw new Error(`login ${id}: ${r.status}`); return c; };
  const crBlank = await login("crblank");
  const crSet = await login("crset");
  const crLondon = await login("crlondon");
  const crQuiet = await login("crquiet");
  const biz1 = await login("biz1");

  const askPay = await crBlank.req("POST", "/api/sig/ask", { q: "What will payout setup ask me?", history: [] });
  check("creator Sig: payout setup answer is deterministic, covers identity, address, bank, tax, 1099-K, the first-payout hold, and the settled-with-help honesty line",
    askPay.status === 200 && askPay.data.source === "data"
    && /identity details/.test(askPay.data.text) && /your address/.test(askPay.data.text) && /bank account/.test(askPay.data.text)
    && /tax information/.test(askPay.data.text) && /1099-K/.test(askPay.data.text) && /held briefly while identity checks clear/.test(askPay.data.text)
    && /settled with help until the payout rail fully opens/.test(askPay.data.text) && /not set up yet on your record/.test(askPay.data.text),
    JSON.stringify(askPay.data).slice(0, 300));
  check("creator Sig: payout answer is linked to the payout surface on Profile",
    askPay.data.link && askPay.data.link.dest === "cr-profile", JSON.stringify(askPay.data.link || null));

  const askStart = await crBlank.req("POST", "/api/sig/ask", { q: "What is my starting rate?", history: [] });
  check("creator Sig: starting points for a blank Locals creator are $225 paid and $150 licensing, editable and never a mandate, linked to Profile",
    askStart.status === 200 && askStart.data.source === "data" && askStart.data.text.includes("$225") && askStart.data.text.includes("$150")
    && /starting point/.test(askStart.data.text) && /not a price you have to use/.test(askStart.data.text) && /nothing is saved until you save/.test(askStart.data.text)
    && askStart.data.link && askStart.data.link.dest === "cr-profile",
    JSON.stringify(askStart.data).slice(0, 300));

  const askSet = await crSet.req("POST", "/api/sig/ask", { q: "What is my starting rate?", history: [] });
  check("creator Sig: a creator who already set rates hears that starting points never overwrite them, with their own $500 rate named",
    askSet.status === 200 && askSet.data.source === "data" && /already set/.test(askSet.data.text) && /never overwrite/.test(askSet.data.text) && askSet.data.text.includes("$500"),
    JSON.stringify(askSet.data).slice(0, 300));

  const askLon = await crLondon.req("POST", "/api/sig/ask", { q: "What is my starting rate?", history: [] });
  check("creator Sig: a London creator's starting points render in pounds (market currency, floor respected)",
    askLon.status === 200 && askLon.data.source === "data" && askLon.data.text.includes("£225") && askLon.data.text.includes("£150"),
    JSON.stringify(askLon.data).slice(0, 300));

  const askTerms = await crBlank.req("POST", "/api/sig/ask", { q: "Where are the creator terms in plain words?", history: [] });
  check("creator Sig: a terms question carries the creator-terms page link, in the text and as the walk",
    askTerms.status === 200 && askTerms.data.source === "data" && askTerms.data.text.includes("https://joinsignl.com/creator-terms.html")
    && askTerms.data.link && askTerms.data.link.dest === "cr-terms",
    JSON.stringify(askTerms.data).slice(0, 300));

  const askTermsBiz = await biz1.req("POST", "/api/sig/ask", { q: "What are the creator terms?", history: [] });
  check("business Sig: a creator-terms question carries the same terms-page link",
    askTermsBiz.status === 200 && askTermsBiz.data.source === "data" && askTermsBiz.data.text.includes("https://joinsignl.com/creator-terms.html")
    && askTermsBiz.data.link && askTermsBiz.data.link.dest === "cr-terms",
    JSON.stringify(askTermsBiz.data).slice(0, 300));

  console.log("== Build -98: proactive prompts, real records only ==");
  const chipsOf = async (c) => { const h = await c.req("GET", "/api/sig/home"); return (h.data && h.data.chips) || []; };
  const chipsBlank = await chipsOf(crBlank);
  check("prompt: paid activity without payout setup gets the payout chip",
    chipsBlank.some((c) => c === "Set up payouts"), JSON.stringify(chipsBlank));
  check("prompt: finished profile with blank rates gets the rate-card chip",
    chipsBlank.some((c) => c === "Set your rate card"), JSON.stringify(chipsBlank));
  const chipsSet = await chipsOf(crSet);
  check("silence: payout-ready with rates set gets NEITHER Build -98 chip",
    !chipsSet.some((c) => c === "Set up payouts") && !chipsSet.some((c) => c === "Set your rate card"), JSON.stringify(chipsSet));
  const chipsQuiet = await chipsOf(crQuiet);
  check("silence: no paid activity and an unfinished profile gets NEITHER Build -98 chip",
    !chipsQuiet.some((c) => c === "Set up payouts") && !chipsQuiet.some((c) => c === "Set your rate card"), JSON.stringify(chipsQuiet));

  console.log("== Build -98: defaults never migrate stored records ==");
  const meBlank = await crBlank.req("GET", "/api/auth/me");
  check("the blank creator's own payload still shows no paid rate and no licensing fee after every read above",
    meBlank.status === 200 && !(meBlank.data.user.creator.paidRate > 0) && !(meBlank.data.user.creator.licensingFee > 0),
    JSON.stringify(meBlank.data && meBlank.data.user && meBlank.data.user.creator).slice(0, 200));
  const stored = JSON.parse(fs.readFileSync(DB, "utf8"));
  const storedBlank = stored["user:crblank"].creator;
  const storedSet = stored["user:crset"].creator;
  check("the stored blank record was never written with a default rate or fee (no migration)",
    !("paidRate" in storedBlank) && !("licensingFee" in storedBlank), JSON.stringify(storedBlank).slice(0, 200));
  check("the stored set record's rates are exactly the seed (500 paid, 200 licensing)",
    storedSet.paidRate === 500 && storedSet.licensingFee === 200, JSON.stringify(storedSet).slice(0, 200));
} finally {
  server.kill();
}

// ---------- source + renderer checks ----------
console.log("== Source checks ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const sigdataJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
  const sigaiJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");

  check("(0) receipt rename: the export builder stamps exportedAt, and no generatedAt remains in the receipt export builder",
    routerJs.includes("exportedAt: nowIso(),")
    && !routerJs.slice(routerJs.indexOf("async function monthlyReceiptExportFor"), routerJs.indexOf("function csvCell")).includes("generatedAt"));
  const receiptSlice = appJs.slice(appJs.indexOf("function receiptHtml"), appJs.indexOf("function proofSectionHtml"));
  check("(0) receipt rename: the renderer slice verify-build34 inspects has no caused/generated/drove word and reads exp.exportedAt",
    !/caused|generated|drove/.test(receiptSlice) && receiptSlice.includes("exp.exportedAt") && receiptSlice.includes("line says came back"));

  check("(1) claim done: the What you get today block lives inside the one done card, before the profile button, with the three facts and no counts",
    appJs.includes('id="claim-what-you-get"')
    && appJs.slice(appJs.indexOf("function renderClaimDone()"), appJs.indexOf("function claimGoProfile()")).includes("When you finish your profile, your page is live and on Google that day.")
    && appJs.slice(appJs.indexOf("function renderClaimDone()"), appJs.indexOf("function claimGoProfile()")).includes("Your rates are public on your page")
    && appJs.slice(appJs.indexOf("function renderClaimDone()"), appJs.indexOf("function claimGoProfile()")).includes("recorded in founding order")
    && appJs.slice(appJs.indexOf("function renderClaimDone()"), appJs.indexOf("function claimGoProfile()")).includes("signlInstallBannerHtml()")
    && (appJs.slice(appJs.indexOf("function renderClaimDone()"), appJs.indexOf("function claimGoProfile()")).match(/c85-card/g) || []).length === 1);

  check("(2) defaults: the tier table and the pre-fill helper ship, with the showcase-median numbers",
    appJs.includes("RATE_STARTING_DEFAULTS") && appJs.includes("Neighbors: { paidRate: 120, licensingFee: 80 }")
    && appJs.includes("Locals: { paidRate: 225, licensingFee: 150 }") && appJs.includes("Headliners: { paidRate: 425, licensingFee: 280 }")
    && appJs.includes("function rateStartingDefaults(c)") && sigdataJs.includes("RATE_STARTING_98"));
  check("(2) defaults: the lane editor pre-fills ONLY blank boxes (a set rate or fee wins) and labels them a starting point",
    appJs.includes("const rateShown = rate || defaults.paidRate;") && appJs.includes("const feeShown = fee || defaults.licensingFee;")
    && appJs.includes('value="${rateShown}"') && appJs.includes('value="${feeShown}"')
    && appJs.includes('id="lane-starting-line"') && appJs.includes("Starting point for") && appJs.includes("Change it to whatever you charge")
    && appJs.includes("not a price you have to use"));
  check("(2) defaults: no server writer was added for them (router never writes a rateStarting value onto a record)",
    !routerJs.includes("rateStarting"));

  // Renderer behaviour, in the verify-connect style: run the
  // shipped functions with stubbed globals.
  const grab = (re) => { const mm = appJs.match(re); return mm ? mm[0] : ""; };
  const escStub = (s) => String(s == null ? "" : s);
  const mkDefaults = (floor) => new Function("suggestedTierId", "totalAudienceOf", "ownPaidFloor",
    `${grab(/const RATE_STARTING_DEFAULTS = \{[\s\S]*?\};/)}
${grab(/function rateTierFor\(c\) \{[\s\S]*?\n\}/)}
${grab(/function rateStartingDefaults\(c\) \{[\s\S]*?\n\}/)}
return rateStartingDefaults;`)(
    (n) => (n >= 15000 ? "Headliners" : n >= 2000 ? "Locals" : "Neighbors"),
    (s) => (s && typeof s.totalAudience === "number" ? s.totalAudience : 0),
    () => floor);
  const defs = mkDefaults(50);
  check("(2) renderer: defaults resolve per tier band from tierBand or stacked audience",
    defs({ tierBand: "Neighbors" }).paidRate === 120 && defs({ tierBand: "Neighbors" }).licensingFee === 80
    && defs({ tierBand: "Locals" }).paidRate === 225 && defs({ tierBand: "Locals" }).licensingFee === 150
    && defs({ tierBand: "Headliners" }).paidRate === 425 && defs({ tierBand: "Headliners" }).licensingFee === 280
    && defs({ totalAudience: 900 }).tier === "Neighbors" && defs({ totalAudience: 20000 }).tier === "Headliners");
  check("(2) renderer: defaults respect the paid floor (a higher floor wins)",
    mkDefaults(500)({ tierBand: "Neighbors" }).paidRate === 500);

  const mkStep = (live) => new Function("esc", "state",
    `${grab(/function laneRateOf\(c\) \{[\s\S]*?\n\}/)}\n${grab(/function paymentsLive\(\) \{[\s\S]*?\n\}/)}\n${grab(/function payoutsStepHtml\(c\) \{[\s\S]*?\n\}/)}\nreturn payoutsStepHtml;`)(escStub, { boot: { payments: { connectLive: live } }, user: { id: "u98" } });
  const stepOn = mkStep(true);
  const first = stepOn({ paidRate: 100, payouts: { status: "not_started", ready: false, missing: [] } });
  check("(3) renderer: before first setup the explainer shows, with Stripe's asks, 1099-K, the hold, the honesty line, and a Got it ack",
    first.includes('id="payout-explainer"') && first.includes("identity details") && first.includes("1099-K")
    && first.includes("held briefly while identity checks clear") && first.includes("settled with help until the payout rail fully opens")
    && first.includes("ackPayoutExplainer()") && first.includes("Set up payouts"));
  check("(3) renderer: once setup has started or finished, no explainer (pending and ready stay clean)",
    !stepOn({ paidRate: 100, payouts: { status: "pending", ready: false, missing: ["your bank account"] } }).includes("payout-explainer")
    && !stepOn({ paidRate: 100, payouts: { status: "ready", ready: true, missing: [] } }).includes("payout-explainer"));
  globalThis.localStorage = { getItem: () => "1" };
  let ackedOut = "";
  try { ackedOut = stepOn({ paidRate: 100, payouts: { status: "not_started", ready: false, missing: [] } }); } finally { delete globalThis.localStorage; }
  check("(3) renderer: after the creator taps Got it (ack stored), the explainer does not show again before setup",
    !ackedOut.includes("payout-explainer") && ackedOut.includes("Set up payouts"));
  check("(3) explainer is reachable again from Help, with the shared explainer and the payout QA",
    appJs.includes('id="help-payout-section"') && appJs.includes("payoutExplainerHtml()") && appJs.includes("What will payout setup ask me?"));

  check("(4) Help links both new site pages for creators",
    appJs.includes("https://joinsignl.com/creator-terms.html") && appJs.includes("Creator terms in plain words")
    && appJs.includes("https://joinsignl.com/for-service-providers.html") && appJs.includes("SIGNL for service providers"));
  check("(4) Sig linking: the cr-terms walk opens the terms page, chips route the two new prompts to Profile, and the operator flows ship",
    appJs.includes('case "cr-terms": window.open("https://joinsignl.com/creator-terms.html"')
    && appJs.includes('t.includes("set up payouts")') && appJs.includes('t.includes("rate card")')
    && appJs.includes("function sigC98Payout()") && appJs.includes("function sigC98Rates()") && appJs.includes("function sigC98Terms()"));
  check("sigdata: the three deterministic branches and both home chips ship",
    sigdataJs.includes('"cr-terms"') && sigdataJs.includes("1099-K") && sigdataJs.includes("rateStarting: rateStartingFor(")
    && sigdataJs.includes('chips.push("Set up payouts")') && sigdataJs.includes('chips.push("Set your rate card")'));
  check("sigai canon: payout paperwork, starting defaults, and the terms link lines",
    sigaiJs.includes("Payout setup paperwork") && sigaiJs.includes("Rate-card starting defaults") && sigaiJs.includes("creator terms link goes with the answer"));
  check("canon locks untouched: founding Stripe prices stay env-or-empty (no market live for money)",
    routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'));
  check("no em dashes in the new copy",
    ["What you get today", "Starting point for", "What payout setup will ask for, and why", "Creator terms in plain words", "Set your rate card"].every((l) => !l.includes("—") && !l.includes("–")));
  check("build stamp is 2026.11.02-103 on both sides",
    fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('exports.BUILD_ID = "2026.11.02-103"')
    && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.02-103"'), "");
}

console.log(`\nBuild -98 verify: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
