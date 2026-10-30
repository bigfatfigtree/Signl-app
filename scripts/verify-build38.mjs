#!/usr/bin/env node
// Build 2026.10.30-39 verification (Jeff, 2026-10-29, from his own
// phone): two jobs.
//   JOB 1 — the labeled LEFT RAIL is the nav for every login at
//   every width. Admin already had it (Build -28); creators,
//   businesses and partners had a bottom tab bar on phones and a
//   rail only from 768px up. Now the #tabbar chrome is a slim 72px
//   labeled rail on phones and the same 232px rail from 768px up:
//   same destinations per role, same badges, new placement only.
//   The DOM-level proof (rail geometry per role at 390px and at
//   desktop, bottom bar absent) runs in the Playwright QA script
//   (~/workspace/signl-qa-2026-10-29/build38/qa38.py); this suite
//   pins the CSS/JS contract it renders from.
//   JOB 2 — the app-wide "30 to 90" sweep: no opening date or
//   window is promised anywhere in user-facing copy (Jeff's
//   screenshot showed "Hampton Roads opens in the next 30 to 90
//   days" twice on creator Home). Approved replacements: founding
//   status + "We email you the moment it opens" (creator side) /
//   "Businesses sign up when we are ready to launch" (business
//   side). The launchWindow field is gone from both API payloads
//   that carried it, and the campaign paragraph no longer promises
//   a November / Black Friday launch either.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8948;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "build38-admin@signl.local";
const ADMIN_PASSWORD = "build38-admin-pass";

const WINDOW_RE = /30\s*(to|-|–|—)\s*90|30 a 90|90 días|launches in November|Black Friday/i;

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} :: ${detail}`); }
}

function client() {
  const jar = new Map();
  const call = async (method, path, body) => {
    const headers = { "content-type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const part of sc) { const pair = part.split(";")[0]; const i = pair.indexOf("="); if (i > -1) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
  return call;
}

async function waitUp() {
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.status) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
}

const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ---------- Part A: source contract (no server) ----------
const appJs = read("public/app.js");
const indexHtml = read("public/index.html");
const themeCss = read("public/theme-v2.css");
const routerJs = read("netlify/functions/lib/router.js");
const sigaiJs = read("netlify/functions/lib/sigai.js");

// JOB 2: zero timing-window strings in any user-facing source.
for (const [label, src] of [["public/app.js", appJs], ["public/index.html", indexHtml], ["netlify/functions/lib/router.js", routerJs], ["netlify/functions/lib/sigai.js", sigaiJs]]) {
  check(`no opening-window phrasing anywhere in ${label}`, !WINDOW_RE.test(src));
}
check("the launchWindow field is gone from the client", !appJs.includes("launchWindow"));
check("the launchWindow field and its constant are gone from the server", !routerJs.includes("launchWindow") && !routerJs.includes("LAUNCH_WINDOW_TEXT"));
check("creator Home greeting states founding status and the opening email", appJs.includes("is a founding market. We email you the moment it opens."));
check("creator founding hero card title states founding status", appJs.includes("is a founding market`, meta: `We email you at"));
check("creator Sig answer promises no window, keeps the opening email", appJs.includes("Your market is a founding market, and you get an email the moment it opens."));
check("business Sig answer uses the approved business-side line", appJs.includes("Businesses sign up when we are ready to launch, market by market as each founding roster completes."));
check("business founding notice uses the approved business-side line", appJs.includes("Your market has not launched yet.") && appJs.includes("Businesses sign up when we are ready to launch. Draft offers now;"));
check("signup copy promises priority, not a window (EN + ES)", appJs.includes("When your market opens, founding creators get priority.") && appJs.includes("Cuando tu mercado abra, los creadores fundadores tienen prioridad."));
check("pending status copy promises no window (EN + ES)", appJs.includes("opens to businesses. Sign back in any time to check your status.") && appJs.includes("abra para los negocios. Entra cuando quieras para ver tu estado."));

// The campaign paragraph, unit level (same require path as verify-campaign).
{
  process.env.SIGNL_LOCAL = "1";
  process.env.SIGNL_LOCAL_DB = join(mkdtempSync(join(tmpdir(), "signl-build38-unit-")), "db.json");
  const require = createRequire(import.meta.url);
  const { campaignEmail } = require("../netlify/functions/lib/router.js");
  const hr = campaignEmail({ name: "Maya Reed", handle: "maya757", market: "Hampton Roads", opener: "your Oceanfront food posts" });
  const rva = campaignEmail({ name: "", handle: "rvabites", market: "Richmond", opener: "your Carytown posts" });
  check("campaign email (Hampton Roads) carries the founding paragraph and no launch date", hr.text.includes("Hampton Roads is a founding market: sign-ups are open now and offers open as the founding roster fills.") && !WINDOW_RE.test(hr.text), hr.text.slice(0, 400));
  check("campaign email (other markets) carries the founding paragraph and no window", rva.text.includes("Richmond is a founding market: sign-ups are open now and offers open city by city as the roster fills.") && !WINDOW_RE.test(rva.text));
}

// JOB 1: the CSS contract the DOM QA renders from.
check("phone chrome is a fixed 72px left rail, not a bottom bar", themeCss.includes("body.v3-on #tabbar { display: block; position: fixed; left: 0; top: 0; right: auto; bottom: 0; width: 72px;"));
check("the old fixed-bottom tab bar rule is gone", !themeCss.includes("body.v3-on #tabbar { display: block; position: fixed; left: 0; right: 0; bottom: 0;"));
check("content sits beside the phone rail (72px offset, definite width)", themeCss.includes("body.v3-on main { margin-left: 72px; width: calc(100% - 72px); }"));
check("phone main no longer reserves bottom-bar clearance", themeCss.includes("@media (max-width: 767.98px) { body.v3-on main { padding-bottom: 44px; } }"));
check("rail items stack in a column at every width", themeCss.includes("#tabbar .tab-main { display: flex; flex-direction: column; gap: 2px; }"));
check("desktop keeps the 232px rail and its content offset", themeCss.includes("width: 232px") && themeCss.includes("body.v3-on main { margin-left: 232px; padding-left: 24px; padding-right: 24px; width: calc(100% - 232px); }"));
check("rail labels stay visible text at every width", themeCss.includes(".tab-item .tab-label { font-size: 0.68rem; font-weight: 600;"));
check("badges still ride the rail items", appJs.includes('class="tab-badge"') && themeCss.includes(".tab-badge { position: absolute; top: -4px; right: -8px;"));
check("index.html still mounts the nav containers", indexHtml.includes('id="tabbar"') && indexHtml.includes('id="topbar2"'));
// Phone-fit companions the visual QA caught beside the slimmer
// content column: auto-fit grid floors shrink to the container,
// and the founding "first 100" sentence-badge may wrap.
check("phone grid floors shrink to the container (no past-edge cards)", themeCss.includes("minmax(min(300px, 100%), 1fr)") && themeCss.includes("minmax(min(240px, 100%), 1fr)"));
check("the founding sentence-badge wraps instead of overflowing", themeCss.includes(".badge.badge-line { white-space: normal; }") && appJs.includes('class="badge tier badge-line"'));

// Destinations per role are exactly the pre--38 sets (placement fix, not an IA change).
{
  const start = appJs.indexOf("function tabItemsFor(");
  const end = appJs.indexOf("function moreRowsFor(", start);
  const slice = appJs.slice(start, end);
  const partnerAt = slice.indexOf('u.role === "partner"');
  const bizCr = slice.slice(0, partnerAt);
  const partner = slice.slice(partnerAt);
  check("creator destinations unchanged: Home, Offers, Sig, More", bizCr.includes('label: "Home", tab: "Dashboard"') && bizCr.includes('label: "Offers", tab: "Offers"') && (bizCr.match(/label: "Sig"/g) || []).length === 2 && (bizCr.match(/label: "More", tab: "More"/g) || []).length === 2, slice.slice(0, 300));
  check("business destinations unchanged: Home, Find creators, Sig, More", bizCr.includes('label: "Find creators", tab: "Discover"'));
  check("partner destinations unchanged: Home, Markets, Earnings, More", partner.includes('label: "Home", tab: "Home"') && partner.includes('label: "Markets", tab: "Markets"') && partner.includes('label: "Earnings", tab: "Earnings"') && partner.includes('label: "More", tab: "More"'));
}

// Build stamp.
check("build stamp is 2026.10.30-39 on both sides", read("netlify/functions/lib/build.js").includes("2026.10.30-39") && indexHtml.includes("2026.10.30-39"));

// ---------- Part B: live API contract (production shape, no test override) ----------
let server;
try {
  const dir = mkdtempSync(join(tmpdir(), "signl-build38-"));
  server = spawn(process.execPath, ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: join(dir, "db.json"), ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await waitUp();

  const anon = client();
  const boot = await anon("GET", "/api/bootstrap");
  check("bootstrap answers", boot.status === 200, String(boot.status));
  check("bootstrap publishes no launch window", boot.data && boot.data.launch && boot.data.launch.launchWindow === undefined, JSON.stringify(boot.data && boot.data.launch));
  check("server stamps the -38 build on API responses", boot.headers.get("x-signl-build") === "2026.10.30-39", String(boot.headers.get("x-signl-build")));

  const admin = client();
  const login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(login.data)}`);

  const cr = client();
  const reg = await cr("POST", "/api/auth/register", {
    role: "creator", name: "Rail Rena", email: "rena@fixtures.dev", password: "creator-pass-123",
    market: "Richmond", city: "Richmond", handle: "railrena", followerCount: 3200, localAudiencePct: 82,
    categories: ["Food & Drink"], primaryPlatform: "instagram",
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("founding creator registers", reg.status === 201, JSON.stringify(reg.data).slice(0, 200));
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });

  const founding = await cr("GET", "/api/me/founding");
  check("founding payload answers for the approved creator", founding.status === 200, String(founding.status));
  check("founding payload carries no launch window", founding.data && founding.data.founding && founding.data.founding.launchWindow === undefined, JSON.stringify(founding.data && founding.data.founding).slice(0, 200));

  const gated = await cr("GET", "/api/offers");
  check("pre-launch offers stay gated (403)", gated.status === 403, String(gated.status));
  check("the gate message promises no window and points at the opening email", !WINDOW_RE.test((gated.data && gated.data.error) || "") && /moment it opens/.test((gated.data && gated.data.error) || ""), String(gated.data && gated.data.error));
} catch (e) {
  failures.push("suite crashed: " + e.message);
  console.error(e);
} finally {
  if (server) server.kill();
}

console.log(`\nverify-build38: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
