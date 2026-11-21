// verify-build235.mjs — Build -235: every payout-timing
// statement says the canonical thing, in English and Spanish:
// a creator is paid after their post is live and verified,
// within 48 hours, once their payout details are set up.
// The wrong claims it replaces: payouts "run outside the app",
// the app "never promises a payout date" (sigdata earnings
// answer + sigai canon), and the client earn-more line that
// repeated the outside-the-app claim in both languages.
// The fix, proven here:
//   A. Source pins — the three banned phrases (and the
//      outside-the-app variant) are absent from sigdata.js,
//      sigai.js and public/app.js; the canonical EN wording
//      is present in the sigdata earnings answer and the
//      sigai canon; the canonical EN + ES sentences are
//      present in the client QA/Maggie payout answers (Help
//      QA, the Sig bank payout topic, the earn-more line),
//      each ES twin carried by the file's ST(en, es) pattern;
//      the build stamp is 2026.11.21-235 in both homes.
//   B. Bank fixture — the deterministic Sig bank (extracted
//      from public/app.js exactly like verify-sig) resolves
//      "when do I get paid" to the payout topic and returns
//      the canonical EN timing; with the language stub set
//      to Spanish it resolves "cuando me pagan" to the same
//      topic and returns the canonical ES timing.
//   C. Server fixture — a finished creator asking Maggie
//      (POST /api/sig/ask) about their earnings gets the
//      data answer carrying the canonical timing, never the
//      old outside-the-app / no-payout-date clause.
// Run: node scripts/verify-build235.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build235-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify235-admin-pw";
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
const BANNED = ["until your post is live, then releases", "release the money only when the post is live", "never promises a payout date", "payouts run outside the app", "Payouts for paid bookings run outside the app"];

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
const sigdataSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
const sigaiSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");
const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
for (const [label, src] of [["sigdata.js", sigdataSrc], ["sigai.js", sigaiSrc], ["public/app.js", appSrc]]) {
  check(`${label}: no banned payout phrasing`, !BANNED.some((b) => src.includes(b)),
    BANNED.filter((b) => src.includes(b)).join(" | "));
}
check("sigdata earnings answer carries the canonical timing",
  sigdataSrc.includes(`For paid bookings, you are ${EN_CANON}.`), "");
check("sigai canon carries the canonical timing",
  sigaiSrc.includes("a creator is paid after their post is live and verified, within 48 hours, once their payout details are set up."), "");
check("client Help QA carries the canonical EN timing", appSrc.includes(`You are ${EN_CANON}.`), "");
check("client Help QA carries the ES twin (ST pattern)", appSrc.includes(ES_CANON), "");
check("Sig bank payout answer carries the canonical EN timing",
  appSrc.includes(`You are ${EN_CANON}. Your Wallet keeps the record`), "");
check("Sig bank payout answer carries the ES twin (ST pattern)",
  appSrc.includes(ES_CANON) && appSrc.includes("Tu Billetera guarda el registro"), "");
check("earn-more line carries the canonical timing in EN and ES",
  appSrc.includes(`For paid bookings, you are ${EN_CANON}.`) && appSrc.includes("En las reservas pagadas, te pagan después de que tu publicación esté activa y verificada, dentro de 48 horas"), "");
check("Sig bank payout topic matches the Spanish ask", appSrc.includes('"cuando me pagan"'), "");
check("build stamp is 2026.11.21-235 in both homes",
  fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('BUILD_ID = "2026.11.21-235"')
  && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.21-235"'), "");

// --- B: bank fixture (EN + ES) --------------------------------
console.log("== B: Sig bank fixture (EN + ES payout answers) ==");
{
  const start = appSrc.indexOf("function sigBankFor");
  const end = appSrc.indexOf("// SIGBANK-END");
  check("bank markers found in app.js", start >= 0 && end > start, `${start}..${end}`);
  const langState = { es: false };
  const sandbox = {
    VISIT_GUARANTEE_LINE: "Visit Guarantee: if a booked creator does not show up or does not post, that visit does not count against your monthly visits. It is replaced.",
    ST: (en, es) => (langState.es && es ? es : en),
  };
  vm.createContext(sandbox);
  vm.runInContext(appSrc.slice(start, end) + "\nthis.__sig = { sigBankFor, sigMatch };", sandbox);
  const { sigMatch } = sandbox.__sig;
  const ctx = { biz: false, live: false, profileComplete: true, missing: [] };

  const enMatch = sigMatch("when do I get paid", false);
  check("EN ask resolves to the payout topic", !!enMatch.topic && enMatch.topic.id === "payout",
    enMatch.topic ? enMatch.topic.id : "FALLBACK");
  const enAnswer = enMatch.topic ? (typeof enMatch.topic.a === "function" ? enMatch.topic.a(ctx) : enMatch.topic.a) : "";
  check("EN payout answer carries the canonical timing", enAnswer.includes(`You are ${EN_CANON}.`), enAnswer.slice(0, 200));
  check("EN payout answer has no banned phrasing", !BANNED.some((b) => enAnswer.includes(b)), "");

  langState.es = true;
  const esMatch = sigMatch("cuando me pagan", false);
  check("ES ask resolves to the payout topic", !!esMatch.topic && esMatch.topic.id === "payout",
    esMatch.topic ? esMatch.topic.id : "FALLBACK");
  const esAnswer = esMatch.topic ? (typeof esMatch.topic.a === "function" ? esMatch.topic.a(ctx) : esMatch.topic.a) : "";
  check("ES payout answer carries the canonical timing", esAnswer.includes(ES_CANON), esAnswer.slice(0, 200));
  check("ES payout answer has no banned phrasing", !BANNED.some((b) => esAnswer.includes(b)), "");
}

// --- C: server fixture (Maggie data path) ----------------------
console.log("== C: server fixture (POST /api/sig/ask as a creator) ==");
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
  const email = `pay235-${uniq()}@fixtures.dev`;
  const r = await creator("POST", "/api/auth/register", {
    role: "creator", name: "Pay Fixture", email, password: PW, market: "Auckland", city: "Auckland", handle: `pay235_${uniq()}`,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: 5000, avgViews: 1500, localAudiencePct: 70,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("creator fixture registers", r.status === 201, `got ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  if (r.status === 201) {
    const a = await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
    check("creator fixture approved", a.status === 200, `got ${a.status}`);
  }
  const ask = await creator("POST", "/api/sig/ask", { q: "how much have I earned?" });
  check("Maggie earnings ask returns a data answer", ask.status === 200 && ask.data.source === "data",
    `${ask.status} ${JSON.stringify(ask.data).slice(0, 200)}`);
  const text = (ask.data && ask.data.text) || "";
  check("Maggie earnings answer carries the canonical timing", text.includes(`For paid bookings, you are ${EN_CANON}.`), text.slice(0, 260));
  check("Maggie earnings answer has no banned phrasing", !BANNED.some((b) => text.includes(b)), text.slice(0, 260));
}

console.log(`\nverify-build235: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
