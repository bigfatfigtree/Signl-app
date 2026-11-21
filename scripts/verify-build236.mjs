// verify-build236.mjs — Build -236: the two residual pay-copy
// holdouts an independent reviewer found after Build -235,
// plus the Spanish server-side proof gap -235 left open.
//   1. sigai.js canon, payout-setup paragraph: it ended by
//      denying any payout date ("payout setup promises no
//      payout date") directly under the canonical timing line.
//      It now ends with the canonical timing itself: a creator
//      is paid after their post is live and verified, within
//      48 hours, once their payout details are set up.
//   2. sigdata.js creator fact-sheet summary: "(recorded
//      means the bookings on file, paid outside the app)" now
//      reads "(recorded means the bookings on file, paid
//      after the post is live and verified, within 48 hours,
//      once payout details are set up)".
//   3. Server-side Spanish: sigdata's creator answerer now
//      carries a Spanish payout-timing branch ("cuando me
//      pagan" and twins) returning the canonical ES timing,
//      so Maggie's server layer proves the ES answer too, not
//      only the client bank (-235 proved ES at the bank only).
// Proven here:
//   A. Source pins — the fixed spots carry the canonical
//      wording and none of the banned phrases; the ES branch
//      and its canonical ES sentence are pinned in sigdata;
//      the build stamp is 2026.11.21-236 in both homes.
//   B. Server fixture EN — a finished creator asking Maggie
//      (POST /api/sig/ask) about earnings gets the data answer
//      carrying the canonical EN timing, no banned phrasing.
//   C. Server fixture ES — the same creator, language set to
//      Spanish, asking "cuando me pagan" gets a data answer
//      carrying the canonical ES timing ("dentro de 48
//      horas"), no banned phrasing.
// Run: node scripts/verify-build236.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build236-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify236-admin-pw";
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

const EN_CANON = "paid after your post is live and verified, within 48 hours, once your payout details are set up";
const ES_CANON = "Te pagan después de que tu publicación esté activa y verificada, dentro de 48 horas, una vez que tus datos de pago estén configurados.";
const BANNED = ["no payout date", "promises no payout", "paid outside the app", "payouts run outside the app", "never promises"];

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
const sigdataSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
const sigaiSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");
check("sigai payout-setup paragraph no longer denies a payout date",
  !sigaiSrc.includes("payout setup promises no payout date"), "");
check("sigai payout-setup paragraph ends on the canonical timing",
  sigaiSrc.includes("Paid bookings are recorded in the app, and a creator is paid after their post is live and verified, within 48 hours, once their payout details are set up."), "");
check("sigai canon keeps the canonical timing line above it",
  sigaiSrc.includes("a creator is paid after their post is live and verified, within 48 hours, once their payout details are set up. Answer every payout-timing question with exactly that timing."), "");
check("sigdata summary drops the paid-outside-the-app claim",
  !sigdataSrc.includes("paid outside the app"), "");
check("sigdata summary carries the canonical timing",
  sigdataSrc.includes("recorded means the bookings on file, paid after the post is live and verified, within 48 hours, once payout details are set up"), "");
check("sigdata carries the Spanish payout-timing branch",
  sigdataSrc.includes('"cuando me pagan"') && sigdataSrc.includes(ES_CANON), "");
// Build -237: the exact -236 pin is relaxed to "both homes
// agree, >= 236" (same pattern -236 applied to -235's pin):
// the stamp moves with every build; what this suite owns is
// that the two homes never disagree.
check("build stamp: both homes agree, >= 236 (relaxed by Build -237)",
  (() => { const n = (s) => { const m = String(s).match(/2026\.11\.21-(\d+)/); return m ? Number(m[1]) : 0; };
    const a = n(fs.readFileSync(path.join(root, "public/index.html"), "utf8"));
    const b = n(fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8"));
    return a >= 236 && a === b; })(), "");

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
  const email = `pay236-${uniq()}@fixtures.dev`;
  const r = await creator("POST", "/api/auth/register", {
    role: "creator", name: "Pay Fixture", email, password: PW, market: "Auckland", city: "Auckland", handle: `pay236_${uniq()}`,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: 5000, avgViews: 1500, localAudiencePct: 70,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("creator fixture registers", r.status === 201, `got ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  if (r.status === 201) {
    const a = await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
    check("creator fixture approved", a.status === 200, `got ${a.status}`);
  }
  // B: EN server ask (kept from -235's server fixture)
  const askEn = await creator("POST", "/api/sig/ask", { q: "how much have I earned?" });
  check("EN: Maggie earnings ask returns a data answer", askEn.status === 200 && askEn.data.source === "data",
    `${askEn.status} ${JSON.stringify(askEn.data).slice(0, 200)}`);
  const textEn = (askEn.data && askEn.data.text) || "";
  check("EN: Maggie earnings answer carries the canonical timing", textEn.includes(`For paid bookings, you are ${EN_CANON}.`), textEn.slice(0, 260));
  check("EN: Maggie earnings answer has no banned phrasing", !BANNED.some((b) => textEn.toLowerCase().includes(b)), textEn.slice(0, 260));

  // C: ES server ask (the -235 proof gap, now closed server-side)
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

console.log(`\nverify-build236: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
