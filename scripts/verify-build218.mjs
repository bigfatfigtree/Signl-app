// Build -218 proof suite — Jeff's 2026-11-20 live-walk defect
// batch (Workstreams A + E), each fix proven against the real
// handler on a seeded store, plus the static wirings:
//
// 1. Push (E): POST /api/me/push/devices accepts the bridge's
//    { token, platform } payload on a signed-in session,
//    upserts per (user, token), GET lists masked devices,
//    DELETE removes; bad payloads and anonymous calls refuse.
//    The bridge ships as public/native-bridge.js, posts to the
//    contract route, index.html loads it, and app.js calls
//    MagpieNative.initPush() and defines window.magpieNativeRoute.
// 2. Counts (item 2): discoverReconciliation218 keeps ONE
//    basis — bookable = bookableAtHome + listedFromElsewhere,
//    finishing = approvedHome - approvedComplete — proven with
//    a home creator, a listed-from-elsewhere creator, and an
//    approved-but-unfinished home creator.
// 3. Garbled record (item 3): the handle repair now also
//    repairs a name that is an exact copy of the broken handle
//    (the production Austin shape), and never touches a typed
//    name. Intake guards refuse URL-junk names and a language
//    ("Spanish") typed as a city.
// 4. Review view (items 1 + 9): the Applications landing no
//    longer mounts the Home furniture (no admin-home121 grid,
//    no totals strip, no Sig side panel); the rail repaints
//    from renderAdmin.
// 5. Wallet (item 6): the client renders the Paid out card
//    from m.paidOut, and /me/money carries paidOut.
// 6. Sig fallback (item 4): the nextstep topics and the
//    scoped-state fallback helpers are wired in both banks.
// 7. Discover cards (item 8): the action dock is in normal
//    flow (no sticky overlay) and the photo crop anchors high.
// 8. Deep links (D): public/.well-known serves both files as
//    JSON with the placeholder values intact, and netlify.toml
//    pins their content type.
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (cond, label, extra = "") => { if (cond) { passed += 1; console.log("  PASS", label); } else { failed += 1; console.log("  FAIL", label, extra); } };

// ---------- seed ----------
const dir = fs.mkdtempSync("/tmp/signl-verify218-");
const DB = path.join(dir, "db.json");
const PW = "verify-218-pass", SALT = "verify218salt";
const HASH = crypto.scryptSync(PW, SALT, 64).toString("hex");
const T0 = "2026-11-20T00:00:00.000Z";
function creatorSeed(id, email, name, creator, extra = {}) {
  return {
    id, role: "creator", email, name, passwordHash: HASH, passwordSalt: SALT,
    status: "approved", market: "Nashville", city: "Nashville", state: "TN",
    createdAt: T0, updatedAt: T0, tester: false, termsVersion: "2026-10", termsAcceptedAt: T0,
    creator, business: null, partner: null, ...extra,
  };
}
const complete = (handle, extra = {}) => ({ handle, primaryPlatform: "instagram", categories: ["Food & Drink"], audienceStack: { instagram: 9000 }, followerCount: 9000, totalAudience: 9000, localAudiencePct: 75, profileComplete: true, ...extra });
const db = {};
db["config:markets"] = { flags: { Nashville: true, "Virginia Beach": true, Austin: true } };
db["user:admin1"] = { id: "admin1", role: "admin", email: "jeff@joinsignl.com", name: "Jeff Rimmer", status: "approved", createdAt: T0, updatedAt: T0, passwordHash: HASH, passwordSalt: SALT };
db["email:jeff@joinsignl.com"] = { userId: "admin1" };
db["session:verify-token"] = { userId: "admin1", createdAt: T0, expiresAt: "2027-01-01T00:00:00.000Z" };
db["session:creator-token"] = { userId: "crpush", createdAt: T0, expiresAt: "2027-01-01T00:00:00.000Z" };
// Push-test creator (Austin home; not part of the Nashville math).
db["user:crpush"] = creatorSeed("crpush", "push@fixtures.dev", "Push Tester", complete("pushtester"), { market: "Austin", city: "Austin", state: "TX" });
db["email:push@fixtures.dev"] = { userId: "crpush" };
// Nashville reconciliation fixtures.
db["user:crhome"] = creatorSeed("crhome", "home@fixtures.dev", "Home Creator", complete("homecreator"));
db["email:home@fixtures.dev"] = { userId: "crhome" };
db["user:crvisitor"] = creatorSeed("crvisitor", "visitor@fixtures.dev", "Visitor Creator", complete("visitorcreator", { audienceMarkets: [{ market: "Nashville", pct: 40, active: true }] }), { market: "Virginia Beach", city: "Virginia Beach", state: "VA" });
db["email:visitor@fixtures.dev"] = { userId: "crvisitor" };
db["user:crhalf"] = creatorSeed("crhalf", "half@fixtures.dev", "Half Done", { handle: "halfcreator", primaryPlatform: "instagram", categories: [], audienceStack: { instagram: 3000 }, followerCount: 3000, totalAudience: 3000, localAudiencePct: 40, profileComplete: false });
db["email:half@fixtures.dev"] = { userId: "crhalf" };
// The production garbled shape: name is an exact copy of the
// broken handle; the real handle survives in platformLinks.
db["user:crbig"] = creatorSeed("crbig", "big@fixtures.dev", "_r=1&_t=ZT-9B3OKX5mPWw", { handle: "_r=1&_t=ZT-9B3OKX5mPWw", primaryPlatform: "tiktok", tiktokHandle: "_r=1&_t=ZT-9B3OKX5mPWw", platformLinks: { tiktok: { url: "https://www.tiktok.com/@realbigcreator" } }, categories: ["Fitness"], audienceStack: { tiktok: 2249000 }, followerCount: 0, totalAudience: 2249000, localAudiencePct: 100 }, { market: "Austin", city: "Austin", state: "TX" });
db["email:big@fixtures.dev"] = { userId: "crbig" };
fs.writeFileSync(DB, JSON.stringify(db));

// ---------- boot ----------
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = PW;
process.env.SIGNL_SWEEP_TOKEN = "proof-sweep-" + "token";
for (const k of ["SIG_AI_BASE_URL", "SIG_AI_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MAGGIE_AI_ENABLED", "MAGGIE_AI_MODEL"]) process.env[k] = "";
const router = require("../netlify/functions/lib/router.js");
const { handler } = require("../netlify/functions/api.js");

async function call(method, p, { cookie = "verify-token", body = null } = {}) {
  const [pathname, qs] = p.split("?");
  const queryStringParameters = {};
  if (qs) for (const pair of qs.split("&")) { const i = pair.indexOf("="); queryStringParameters[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1)); }
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = `signl_session=${cookie}`;
  const out = await handler({ httpMethod: method, path: pathname, headers, queryStringParameters, body: body ? JSON.stringify(body) : null, isBase64Encoded: false });
  let data = null;
  try { data = JSON.parse(out.body); } catch { /* downloads etc. */ }
  return { status: out.statusCode, data };
}
const readDb = () => JSON.parse(fs.readFileSync(DB, "utf8"));
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/theme-v2.css"), "utf8");

// ---------- 1. push devices ----------
console.log("push devices (Workstream E)");
{
  const token = "fcm-token-abcdef1234567890";
  const post = await call("POST", "/api/me/push/devices", { cookie: "creator-token", body: { token, platform: "android" } });
  ok(post.status === 200 && post.data && post.data.ok === true && post.data.registered === true, "POST /api/me/push/devices accepts the bridge payload", JSON.stringify(post));
  const stored = Object.entries(readDb()).filter(([k]) => k.startsWith("pushdevice:crpush:"));
  ok(stored.length === 1 && stored[0][1].token === token && stored[0][1].platform === "android", "the device record lands under pushdevice:{user}:{hash}");
  const again = await call("POST", "/api/me/push/devices", { cookie: "creator-token", body: { token, platform: "android" } });
  ok(again.status === 200 && Object.keys(readDb()).filter((k) => k.startsWith("pushdevice:crpush:")).length === 1, "re-registering the same token upserts, never duplicates");
  const list = await call("GET", "/api/me/push/devices", { cookie: "creator-token" });
  ok(list.status === 200 && list.data.devices.length === 1 && list.data.devices[0].tokenTail === "567890" && !JSON.stringify(list.data).includes(token), "GET lists own devices with the token masked");
  const badPlatform = await call("POST", "/api/me/push/devices", { cookie: "creator-token", body: { token, platform: "smoke-signal" } });
  ok(badPlatform.status === 400, "an unknown platform is refused");
  const shortToken = await call("POST", "/api/me/push/devices", { cookie: "creator-token", body: { token: "short", platform: "ios" } });
  ok(shortToken.status === 400, "a truncated token is refused");
  const anon = await call("POST", "/api/me/push/devices", { cookie: null, body: { token, platform: "ios" } });
  ok(anon.status === 401 || anon.status === 403, "an anonymous registration is refused", String(anon.status));
  const del = await call("DELETE", "/api/me/push/devices", { cookie: "creator-token", body: { token } });
  const after = await call("GET", "/api/me/push/devices", { cookie: "creator-token" });
  ok(del.status === 200 && after.data.devices.length === 0, "DELETE removes the device");
}

// ---------- 1b. bridge adoption (static) ----------
console.log("bridge adoption");
{
  const bridge = fs.readFileSync(path.join(ROOT, "public/native-bridge.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  ok(bridge.includes('fetch("/api/me/push/devices"'), "the shipped bridge posts to the verified contract route");
  ok(!bridge.includes("/api/devices/push-token"), "the dead push-token route is gone from the bridge");
  ok(indexHtml.includes('<script src="/native-bridge.js" defer></script>'), "index.html loads the bridge");
  ok(appJs.includes("window.MagpieNative.initPush"), "app.js calls MagpieNative.initPush() after sign-in");
  ok(appJs.includes("window.magpieNativeRoute = function"), "app.js defines window.magpieNativeRoute(path)");
  const src = fs.readFileSync(path.join(ROOT, "mobile/bridge/magpie-native-bridge.js"), "utf8");
  ok(src === bridge, "public/native-bridge.js is the mobile/bridge source, byte for byte");
}

// ---------- 2. reconciliation ----------
console.log("discover reconciliation (item 2)");
{
  const rc = await router.discoverReconciliation218("Nashville");
  ok(rc && rc.bookable === 2, "bookable counts home + listed (2)", JSON.stringify(rc));
  ok(rc && rc.bookableAtHome === 1, "bookableAtHome counts only the home roster (1)");
  ok(rc && rc.listedFromElsewhere === 1, "listedFromElsewhere is the difference (1)");
  ok(rc && rc.approvedHome === 2 && rc.approvedComplete === 1, "approved home 2, finished 1 (one still finishing)");
  ok(rc && rc.bookable === rc.bookableAtHome + rc.listedFromElsewhere, "one basis: bookable = bookableAtHome + listedFromElsewhere");
}

// ---------- 3. garbled record: repair + guards ----------
console.log("garbled record repair and intake guards (items 3 + 7)");
{
  const run = await call("POST", "/api/admin/repairs/handles", { body: {} });
  ok(run.status === 200, "the handle repair runs for an admin session", JSON.stringify(run).slice(0, 200));
  const rec = readDb()["user:crbig"];
  ok(rec && rec.creator.handle === "realbigcreator", "the broken handle is repaired from the record's own profile link");
  ok(rec && rec.name === "realbigcreator", "a name that was an exact copy of the broken handle is repaired with it", rec && rec.name);
  const typed = readDb()["user:crhome"];
  ok(typed && typed.name === "Home Creator", "a typed name is never touched by the repair");
  ok(router.nameLooksLikeUrlJunk("_r=1&_t=ZT-9B3OKX5mPWw") === true && router.nameLooksLikeUrlJunk("Maria Garcia") === false && router.nameLooksLikeUrlJunk("https://x.com/@a") === true, "the URL-junk name guard reads junk and names correctly");
  ok(router.cityLooksLikeLanguage218("Spanish") === true && router.cityLooksLikeLanguage218("spanish") === true && router.cityLooksLikeLanguage218("Austin") === false && router.cityLooksLikeLanguage218("Spanish Fort") === false, "the language-as-city guard is exact, not substring");
  const junk = await call("POST", "/auth/register", { cookie: null, body: { role: "creator", email: "junk@fixtures.dev", password: "longenoughpw", name: "_r=1&_t=ZT-9B3OKX5mPWw", market: "Nashville", agreedTerms: true, handle: "somehandle", primaryPlatform: "instagram", audienceStack: { instagram: 1000 }, localAudiencePct: 50, categories: ["Food & Drink"] } });
  ok(junk.status === 400 && /pasted link/.test(junk.data && junk.data.error || ""), "register refuses a URL-junk name in plain words", JSON.stringify(junk).slice(0, 200));
  const esp = await call("POST", "/auth/register", { cookie: null, body: { role: "creator", email: "esp@fixtures.dev", password: "longenoughpw", name: "Real Person", market: "Not listed yet", customCity: "Spanish", customCountry: "United States", agreedTerms: true, handle: "realperson", primaryPlatform: "instagram", audienceStack: { instagram: 1200 }, localAudiencePct: 40, categories: ["Food & Drink"] } });
  ok(esp.status === 400 && /language, not a city/.test(esp.data && esp.data.error || ""), "register refuses a language typed as a city", JSON.stringify(esp).slice(0, 200));
}

// ---------- 4. Review view ----------
console.log("admin Review view (items 1 + 9)");
{
  ok(!appJs.includes('class="admin-home121"'), "the Applications landing no longer mounts the Home work grid");
  ok(!appJs.includes('id="admin-totals126"'), "the platform totals strip no longer renders above the queue");
  ok(appJs.includes("Loading the review queue..."), "Review paints its own queue skeleton");
  ok(appJs.includes("try { renderRail(); }"), "renderAdmin repaints the rail from the tab it actually rendered");
}

// ---------- 5. wallet ----------
console.log("wallet Paid out (item 6)");
{
  const money = await call("GET", "/api/me/money", { cookie: "creator-token" });
  ok(money.status === 200 && money.data && typeof money.data.paidOut === "number", "/me/money carries paidOut", JSON.stringify(money).slice(0, 160));
  ok(appJs.includes('kpiCard("Paid out", `$${fmtMoney(m.paidOut || 0)}`'), "the Wallet top block renders the Paid out card from m.paidOut");
  ok(appJs.includes('<div class="kpi-grid c3">'), "the money grid carries all three cards");
}

// ---------- 6. sig fallback ----------
console.log("sig scoped fallback (item 4)");
{
  ok((appJs.match(/id: "nextstep"/g) || []).length === 2, "both banks carry the nextstep topic");
  ok(appJs.includes("function sigNextStepsText218(c)"), "the scoped next-steps helper exists");
  ok(appJs.includes("return sigFallbackReply(match, ctx);"), "the bank route passes the asker's context into the fallback");
  ok(appJs.includes("answers from it (open items, next steps) instead of"), "the fallback leads with scoped state when the asker has open items");
}

// ---------- 7. discover cards ----------
console.log("discover card controls (item 8)");
{
  const block = css.slice(css.indexOf(".stk-actions {"), css.indexOf("}", css.indexOf(".stk-actions {")));
  ok(!/position:\s*sticky/.test(block) && !/bottom:/.test(block), "the action dock is in normal flow, never floating over the photo");
  ok(/\.dcard-photo img \{[^}]*object-position: 50% 22%/.test(css), "the photo crop anchors toward the top of the frame");
}

// ---------- 8. deep links ----------
// Build -219 change (ship-sequence order, 2026-11-20): the placeholder
// association files are HELD OUT of the deploy. Publishing literal
// NEEDS_JEFFS_TEAM_ID / NEEDS_SIGNING_CERT values would serve invalid files
// the platforms cache. The canonical templates stay in mobile/deep-links/;
// the real files land in public/.well-known only when Jeff supplies his
// Team ID and the Play signing SHA-256 at submission. The netlify.toml
// content-type pins stay, ready for those files.
console.log("deep links (Workstream D, held out at -219)");
{
  ok(!fs.existsSync(path.join(ROOT, "public/.well-known/apple-app-site-association")), "placeholder AASA is held out of public/ until Jeff's Team ID lands");
  ok(!fs.existsSync(path.join(ROOT, "public/.well-known/assetlinks.json")), "placeholder assetlinks.json is held out of public/ until the signing fingerprint lands");
  const aasaTpl = JSON.parse(fs.readFileSync(path.join(ROOT, "mobile/deep-links/apple-app-site-association"), "utf8"));
  ok(!!aasaTpl && !!aasaTpl.applinks, "the canonical AASA template is preserved in mobile/deep-links/");
  const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  ok(toml.includes('for = "/.well-known/apple-app-site-association"') && toml.includes('for = "/.well-known/assetlinks.json"'), "netlify.toml pins the JSON content type on both paths");
}

console.log(`\nverify-build218: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
