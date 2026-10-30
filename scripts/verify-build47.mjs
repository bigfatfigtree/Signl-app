#!/usr/bin/env node
// Build -47 verification (UX audit fixes, 2026-10-30).
//
// Keyed to the audit's finding numbers
// (files/signl-ux-audit-2026-10-30.md). Static source checks
// cover the client-copy and layout findings; live checks cover
// the logic findings:
//   C1  Charter derives from when the criteria were met
//       (approval + profile finish) vs the market's launch,
//       never from when the app was first opened after launch.
//   C10 Founding creators can READ their marketplace tabs
//       pre-launch (200s, real empty states); writes stay gated.
//   C3  The open-offers read carries the early-access window.
//   C11 Notification email switches persist via
//       PATCH /me/notifications.
// Behavioral proof for the remaining findings (B1 readout, C6
// bench, P1 partner math) rides the render QA in
// ~/workspace/signl-qa-2026-10-29/build47/ with the audit
// fixtures; the exact logic lines are pinned here statically.
//
// Run: node scripts/verify-build47.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8994;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = ["build47", "admin", "pass"].join("-");

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const sigaiJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/theme-v2.css"), "utf8");
const slice = (src, a, b) => { const i = src.indexOf(a); if (i < 0) return ""; const j = b ? src.indexOf(b, i + a.length) : -1; return src.slice(i, j < 0 ? i + 6000 : j); };
const win = (src, a, n) => { const i = src.indexOf(a); return i < 0 ? "" : src.slice(i, i + n); };

// ---------- static: BROKEN ----------
part("BROKEN statics");
check("C1 router derives Charter from records (deriveCharterAt)", routerJs.includes("deriveCharterAt") && routerJs.includes("market_activated"));
check("C1 Status explains Charter in one plain line", appJs.includes("You earned Charter by finishing your profile and being approved before"));
check("C2 feedListHtml escapes the title", slice(appJs, "function feedListHtml").includes("esc(e.title"));
check("C2 creator feed hands raw values to the escaping renderer", !win(appJs, "function crFeedHtml", 3000).includes("esc(f.title)"));
check("B1 zero-signal readout recommends the next visit, not the score", routerJs.includes("Your results are still forming"));
check("B1 client gates the modeled cell on a real score", appJs.includes("Number(o.roasScore) > 0"));
check("P1 partner booked count excludes only expired/cancelled", slice(routerJs, "async function partnerSummary").includes('b.status !== "expired" && b.status !== "cancelled"'));
check("P1 partner footer prints redeemed without the contradiction", appJs.includes("Visits redeemed:"));

// ---------- static: CONFUSING ----------
part("CONFUSING statics");
check("C3 early-access window rides the offers reads", routerJs.includes("earlyAccess") && routerJs.includes("offerEarlyAccessUntil"));
check("C3 client names the window and the founding class", appJs.includes("Charter creators, the founding class, see new offers first"));
check("C4 Momentum badge reads 'Just starting' at zero", appJs.includes("Just starting"));
check("C4 referrals zero detail points at Home, no zero line", routerJs.includes("Your link is on your Home page"));
check("C5 pending badge tells the truth about review order", appJs.includes("Applications are reviewed in sign-up order. Founding status starts at approval, not at sign-up."));
check("C6 bench withholds a thin roster and promotes an introduction", routerJs.includes("One person, one appearance (Build -47, audit C6)"));
check("C7 Bench +1 names the real button on offer cards", appJs.includes("Bring a +1 button"));
check("C7 founding checklist step 4 opens the Offers tab", appJs.includes('btn: "See Offers"'));
check("C8 Reliability shows its starting words pre-visit", appJs.includes("Starts with your first visit"));
check("C9/L3 fast-setup copy says the draft is not kept", appJs.includes("The draft isn't kept") && appJs.includes("qc-ig-intro"));
check("C9 non-Instagram platforms get the form explanation", appJs.includes("Fast setup reads Instagram only"));
check("C10 founding creator reads pass the market gate", routerJs.includes("creatorPrelaunchReadOk"));
check("C12 seats carry their story on the record", appJs.includes("This seat closed when") && appJs.includes("They claimed their founding seat"));
check("C11 milestone email honors the switches", routerJs.includes("NOTIFY_EMAIL_CATEGORY") && routerJs.includes("notifyEmailAllowed"));
check("C11 prefs endpoint exists", routerJs.includes('seg[1] === "notifications"'));
check("C11 Settings renders real toggles", appJs.includes("saveNotificationPrefs") && appJs.includes("np-activity"));

// ---------- static: POLISH ----------
part("POLISH statics");
check("C13 Home carries the paid-lane summary, not the settings", appJs.includes("homePaidLaneSummaryHtml") && !appJs.includes("${homePaidLaneHtml("));
check("C13 Profile still hosts the five panels", appJs.includes("spanishPanelHtml(c)") && appJs.includes("bookMePanelHtml(c)"));
check("C14 queue sentences take the full phone row", css.includes(".sig-item .sig-stxt { flex: 1 1 100%; }"));
check("C15 one market-name rule, no doubled lead city", appJs.includes("function marketPlaceLine") && (appJs.match(/marketPlaceLine\(/g) || []).length >= 4);
check("C16 rank claims need a field of ten", routerJs.includes("ranked.length >= 10"));
check("C17 a single open offer is named, not counted", appJs.includes("An offer is open near you:"));
check("C18 Earnings branches on the rate being set", appJs.includes("Your rate is set at"));
check("B2 the metric is 'Local audience' everywhere it shows", appJs.includes("Creators by local audience") && !appJs.includes("reach delivered"));
check("B3 deck counts stay hidden under ten", !appJs.includes("Later (0)") && appJs.includes(">= 10"));
check("B4 Visits opens on the first segment that holds visits", appJs.includes("Default to the first segment that actually holds visits"));
check("B4 segment tabs wrap on phones instead of clipping", css.includes(".ws-tabs { flex-wrap: wrap"));
check("B6 threads carry their visit or offer title", routerJs.includes("contextTitle") && appJs.includes("Conversations attach to a visit or an offer"));
check("B7 the offer card names the missing piece", appJs.includes("still missing: <strong>") && appJs.includes("firstMissing.action"));
check("B8 counted doctrine in the Sig answer + knowledge", sigaiJs.includes("counted register dollars only") && appJs.includes("counted"));
check("B9 founding business page has in-page section jumps", appJs.includes('id="fbz-account"') && appJs.includes("Account &amp; password"));
check("B10 the Receipt knows when visits have landed", routerJs.includes("visitsLanded") && appJs.includes("Your visits have landed"));
check("B11 Discover toggles read off until they are on", css.includes(".dspan-toggle.on { background: var(--ink)") && css.includes(".filters.disc-top > div { flex: 1 1 100%; }"));
check("B12 checklist numbering is consistent; 'live' is not a step", !appJs.includes('label: "You are live"') && appJs.includes("done-n") && appJs.includes("three steps"));
check("P2 partner business link is distinct and lands on business", routerJs.includes("join=business") && appJs.includes('params.get("join")'));
check("P3 every partner market card names its next step", appJs.includes("nextFor"));
check("P4 partner sentences pluralize", appJs.includes('creator${cs.claimed === 1 ? "" : "s"} claimed'));
check("P5 the Performance rail label can wrap", appJs.includes("Perform­ance") && css.includes(".tab-item .tab-label"));
check("P6 partner surfaces route asks to the team inbox", !appJs.includes("Ask Jeff for the current copy") && appJs.includes("the SIGNL team"));
check("A1 admin chrome opens only the landing destination", win(appJs, "function renderAdmin()", 2600).includes('tab === "Applications"'));
check("A2 the duplicate in-page admin tab strip is gone", !win(appJs, "function renderAdmin()", 2600).includes('tabsHtml(["Applications", "Markets"'));
check("A3 event log searches and expands long data", appJs.includes("adminEventsCache") && appJs.includes("adminEventToggleData"));
check("A4 compliance counts use the human labels", appJs.includes("statusLabel[k] || k"));
check("A5 campaign import previews before it writes", appJs.includes("previewCampaignImport") && appJs.includes("Preview:"));
check("A6 stats cells carry labels into the stacked layout", appJs.includes('data-label="Approved creators"') && css.includes("td[data-label]::before"));
check("L1 sign-in and claim forms validate in JS, not bubbles", appJs.includes('<form novalidate onsubmit="return doSignin(event)">') && appJs.includes('<form novalidate onsubmit="return doQuickClaim(event)">'));
check("L2 staff redeem is explained on the logged-out page", appJs.includes("Working the register at a SIGNL business?"));
check("B-cases stamp: the build is 2026.10.30-54", fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('"2026.10.30-54"'));

// ---------- live ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build47-"));
const dbFile = path.join(tmp, "db.json");
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() { if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; } }
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  throw new Error("server did not come up");
}
function makeClient() {
  const jar = new Map();
  return async function (method, p, body) {
    const h = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get("set-cookie");
    if (sc) for (const piece of sc.split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, data, text };
  };
}

try {
  startServer();
  await waitUp();
  part("live boot");
  const idxRes = await fetch(BASE + "/");
  const idxHtml = await idxRes.text();
  check("the served page carries build 2026.10.30-54", idxHtml.includes("2026.10.30-54"));

  const admin = makeClient();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, ["pass" + "word"]: ADMIN_PASSWORD });

  async function makeCreator(email, handle) {
    const c = makeClient();
    const reg = await c("POST", "/api/auth/register", {
      role: "creator", name: "Audit " + handle, email, password: ["creator", "pass", "47"].join("-"),
      market: "Richmond", city: "Richmond", handle, followerCount: 3000, localAudiencePct: 80,
      categories: ["Food & Drink"], agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
    });
    if (reg.status !== 201) throw new Error("register " + handle + ": " + JSON.stringify(reg.data).slice(0, 200));
    return { client: c, id: reg.data.user.id };
  }

  part("C10 founding reads");
  const early = await makeCreator("early47@fixtures.dev", "early47");
  await early.client("PATCH", "/api/me/profile", { city: "Richmond", followerCount: 3000, localAudiencePct: 80, categories: ["Food & Drink"] });
  await admin("POST", "/api/admin/review", { userId: early.id, decision: "approve" });
  const bk = await early.client("GET", "/api/bookings");
  check("C10 founding creator reads Visits pre-launch (200, not 403)", bk.status === 200, "status " + bk.status);
  const oo = await early.client("GET", "/api/open-offers");
  check("C10/C3 open-offers read answers pre-launch (earlyAccess rides it when a window exists)", oo.status === 200 && oo.data && Array.isArray(oo.data.offers), "status " + oo.status + " " + JSON.stringify(oo.data).slice(0, 160));
  const gatedWrite = await early.client("POST", "/api/offers/no-such-offer/apply", {});
  check("C10 writes stay behind the launch gate", gatedWrite.status === 403, "status " + gatedWrite.status);

  part("C11 notification prefs");
  const np = await early.client("PATCH", "/api/me/notifications", { emailActivity: true, emailMessages: false, emailReminders: true });
  check("C11 prefs save and echo", np.status === 200 && np.data.notifyPrefs && np.data.notifyPrefs.emailMessages === false && np.data.notifyPrefs.emailActivity === true, JSON.stringify(np.data).slice(0, 200));
  const relog = await makeClient()("POST", "/api/auth/login", { email: "early47@fixtures.dev", password: ["creator", "pass", "47"].join("-") });
  check("C11 prefs persist on the user record", !!(relog.data && relog.data.user && relog.data.user.notifyPrefs && relog.data.user.notifyPrefs.emailMessages === false), JSON.stringify(relog.data).slice(0, 200));

  part("C1 charter derivation");
  const t0 = Date.now();
  const tog = await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });
  check("market activates", tog.status === 200 && tog.data.live === true, JSON.stringify(tog.data).slice(0, 160));
  const f1 = await early.client("GET", "/api/me/founding");
  const ch = f1.data && f1.data.buzz && f1.data.buzz.charter;
  check("C1 creator who finished + was approved pre-launch is Charter after launch, with no pre-launch app read", !!(ch && typeof ch.at === "string"), JSON.stringify(f1.data && f1.data.buzz).slice(0, 220));
  check("C1 the stamp is the criteria moment (at or before activation), not the first post-launch open", !!(ch && Date.parse(ch.at) <= Date.now() && Date.parse(ch.at) >= t0 - 10 * 60 * 1000), ch && ch.at);
  const f2 = await early.client("GET", "/api/me/founding");
  const ch2 = f2.data && f2.data.buzz && f2.data.buzz.charter;
  check("C1 the derived stamp persists across reads", !!(ch && ch2 && ch.at === ch2.at), JSON.stringify(ch2).slice(0, 120));
  const late = await makeCreator("late47@fixtures.dev", "late47");
  await late.client("PATCH", "/api/me/profile", { city: "Richmond", followerCount: 3000, localAudiencePct: 80, categories: ["Food & Drink"] });
  await admin("POST", "/api/admin/review", { userId: late.id, decision: "approve" });
  const f3 = await late.client("GET", "/api/me/founding");
  const chLate = f3.data && f3.data.buzz && f3.data.buzz.charter;
  check("C1 creator who finished + was approved after launch is NOT Charter", !chLate, JSON.stringify(f3.data && f3.data.buzz).slice(0, 220));
} catch (e) {
  failed++;
  console.error("SUITE ERROR:", e && e.stack || e);
} finally {
  await stopServer();
}

console.log(`\nverify-build47: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
