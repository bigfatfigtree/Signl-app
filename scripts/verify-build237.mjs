// verify-build237.mjs — Build -237: the last pay-copy
// holdouts found by the Build -236 sweep join the canonical
// payout timing. Canonical meaning, everywhere: a creator is
// paid after their post is live and verified, within 48
// hours, once their payout details are set up. No serving
// surface may say payouts run outside the app, that setup or
// the app promises no payout date, or any variant denial.
// The six spot-groups fixed here:
//   1. public/app.js Settings "Payout details" panel: "Payouts
//      run outside the app for now… nothing in the app
//      promises a payout date." -> the canonical timing.
//   2. public/app.js client payout-setup explainer (UK + US):
//      "…settled with help until the payout rail fully opens,
//      so setup promises no payout date." -> the setup facts
//      (Stripe, identity checks, brief first-payout hold) are
//      kept; the tail now ends on the canonical timing.
//   3. public/app.js payout explainer HTML (UK fn, US Help,
//      US payout step): "Payout setup promises no payout
//      date, and the app does not promise a payout date."
//      -> the canonical timing.
//   4. sigdata.js payouts-not-set-up fact line: "…settled
//      with help until the payout rail fully opens; no
//      payout date is promised." -> the canonical timing,
//      worded third-person (the not-set-up state IS the
//      "once your payout details are set up" condition).
//   5. sigdata.js server payout-setup answers (UK + US):
//      same treatment as group 2.
//   6. public/app.js partner commission view: "No payout
//      date is promised." No partner/commission payout
//      timing exists anywhere else in the app or the site
//      (searched both repos), so the denial sentence is
//      DELETED and the rest of the line left intact; no
//      commission timing is invented.
// Spanish parity: none of the six spot-groups has an ES twin
// in its surface (the client explainers, the Settings panel
// and the sigdata answers are hard-coded English strings;
// their action labels carry ST() but the bodies do not), so
// there is no twin to fix. The ES canonical sentence stays
// pinned where it already lives (sigdata ES branch, client
// QA/bank) and is re-proven by the server ES fixture below.
// Proven here:
//   A. Source pins — every fixed spot carries the canonical
//      wording (or, for group 6, lacks the denial while the
//      rest of the line survives); none of the banned denial
//      variants appears in any serving source (public/app.js,
//      sigdata.js, sigai.js); the build stamp is
//      2026.11.21-237 in both homes.
//   B. Server fixture EN — kept from -236: a finished creator
//      asking Maggie (POST /api/sig/ask) about earnings gets
//      the canonical EN timing, no banned phrasing.
//   C. Server fixture ES — kept from -236: the same creator,
//      language set to Spanish, asking "cuando me pagan" gets
//      the canonical ES timing, no banned phrasing.
// Run: node scripts/verify-build237.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build237-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify237-admin-pw";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_MAIL_STUB = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const { handler } = require("../netlify/functions/api.js");
const root = process.cwd();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const count = (src, needle) => src.split(needle).length - 1;

const EN_CANON = "paid after your post is live and verified, within 48 hours, once your payout details are set up";
const ES_CANON = "Te pagan después de que tu publicación esté activa y verificada, dentro de 48 horas, una vez que tus datos de pago estén configurados.";
const BANNED = ["no payout date", "promises no payout", "does not promise a payout date", "paid outside the app", "payouts run outside the app", "never promises a payout date", "until your post is live, then releases", "release the money only when the post is live", "settled with help until the payout rail fully opens"];

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const sigdataSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
const sigaiSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");
check("group 1: Settings payout panel carries the canonical timing",
  appSrc.includes(`booked at your rate, you keep 97%. You are ${EN_CANON}.`), "");
check("group 2: client payout-setup explainer (UK + US) ends on the canonical timing",
  count(appSrc, `Paid bookings are recorded in the app, and you are ${EN_CANON}.`) === 2,
  `count=${count(appSrc, `Paid bookings are recorded in the app, and you are ${EN_CANON}.`)}`);
check("group 3: payout explainer HTML (all three spots) carries the canonical timing",
  count(appSrc, `Paid bookings are recorded in the app. You are ${EN_CANON}.`) === 3,
  `count=${count(appSrc, `Paid bookings are recorded in the app. You are ${EN_CANON}.`)}`);
check("group 4: sigdata not-set-up fact line carries the canonical timing (third person)",
  sigdataSrc.includes(`Paid bookings are recorded in the app, and a creator is paid after their post is live and verified, within 48 hours, once their payout details are set up.`), "");
check("group 5: sigdata payout-setup answers (UK + US) end on the canonical timing",
  count(sigdataSrc, `Paid bookings are recorded in the app, and you are ${EN_CANON}.`) === 2,
  `count=${count(sigdataSrc, `Paid bookings are recorded in the app, and you are ${EN_CANON}.`)}`);
check("group 6: partner commission denial sentence is deleted",
  !appSrc.includes("No payout date is promised."), "");
check("group 6: the rest of the commission line is intact",
  appSrc.includes("commissions are paid once") && appSrc.includes("opens for payments and businesses start paying.</p>"), "");
for (const [label, src] of [["public/app.js", appSrc], ["sigdata.js", sigdataSrc], ["sigai.js", sigaiSrc]]) {
  check(`${label}: no banned payout-denial phrasing anywhere`,
    !BANNED.some((b) => src.toLowerCase().includes(b)),
    BANNED.filter((b) => src.toLowerCase().includes(b)).join(" | "));
}
check("ES canonical sentence still pinned in sigdata (ES branch) and the client QA",
  sigdataSrc.includes(ES_CANON) && appSrc.includes(ES_CANON), "");
check("build stamp is 2026.11.21-237 in both homes",
  fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('BUILD_ID = "2026.11.21-237"')
  && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.21-237"'), "");

// --- B + C: server fixtures (Maggie data path) ----------------
console.log("== B/C: server fixtures (POST /api/sig/ask as a creator, EN + ES) ==");
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body, rawPath) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: rawPath || url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body),
      isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = res.body; }
    return { status: res.statusCode, data };
  };
}
const PW = "fixture-password-1";
const uniq = () => Math.random().toString(36).slice(2, 9);
const admin = makeClient();
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin login succeeds", r.status === 200, `got ${r.status}`);
}
const creator = makeClient();
{
  const email = `pay237-${uniq()}@fixtures.dev`;
  const r = await creator("POST", "/api/auth/register", {
    role: "creator", name: "Pay Fixture", email, password: PW, market: "Auckland", city: "Auckland", handle: `pay237_${uniq()}`,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: 5000, avgViews: 1500, localAudiencePct: 70,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("creator fixture registers", r.status === 201, `got ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  if (r.status === 201) {
    const a = await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
    check("creator fixture approved", a.status === 200, `got ${a.status}`);
  }
  const askEn = await creator("POST", "/api/sig/ask", { q: "how much have I earned?" });
  check("EN: Maggie earnings ask returns a data answer", askEn.status === 200 && askEn.data.source === "data",
    `${askEn.status} ${JSON.stringify(askEn.data).slice(0, 200)}`);
  const textEn = (askEn.data && askEn.data.text) || "";
  check("EN: Maggie earnings answer carries the canonical timing", textEn.includes(`For paid bookings, you are ${EN_CANON}.`), textEn.slice(0, 260));
  check("EN: Maggie earnings answer has no banned phrasing", !BANNED.some((b) => textEn.toLowerCase().includes(b)), textEn.slice(0, 260));

  const lang = await creator("PATCH", "/api/me/profile", { lang: "es" });
  check("ES: creator language preference set to Spanish", lang.status === 200 && lang.data.user && lang.data.user.lang === "es",
    `${lang.status} ${JSON.stringify(lang.data && lang.data.user && lang.data.user.lang)}`);
  const askEs = await creator("POST", "/api/sig/ask", { q: "cuando me pagan" });
  check("ES: Maggie payout ask returns a data answer", askEs.status === 200 && askEs.data.source === "data",
    `${askEs.status} ${JSON.stringify(askEs.data).slice(0, 200)}`);
  const textEs = (askEs.data && askEs.data.text) || "";
  check("ES: Maggie payout answer carries the canonical ES timing", textEs.includes(ES_CANON) && textEs.includes("dentro de 48 horas"), textEs.slice(0, 260));
  check("ES: Maggie payout answer has no banned phrasing", !BANNED.some((b) => textEs.toLowerCase().includes(b)), textEs.slice(0, 260));
}

console.log(`\nverify-build237: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
