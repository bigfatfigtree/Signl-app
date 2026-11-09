// verify-build159.mjs — Build -159: founding-page 500 fix.
//   GET /api/me/founding (and every other read of a creator card)
//   500ed whenever the creator's STORED best-work list contained
//   an entry that fails save-time validation — a non-platform
//   URL, an over-long string, a fourth link — because
//   bestWorkCards dereferenced validateBestWork(...).links and
//   the failure shape has no links. Fresh profile saves validate
//   strictly, so only legacy/imported records carry the poison,
//   but a read path must never throw on stored data.
//   THE FIX: bestWorkCards builds its cards from
//   storedBestWorkLinks — the stored entries that pass the same
//   per-link checks, in stored order, deduped, capped at 3.
//   Entries that fail are skipped (treated as absent); valid
//   records render exactly as before. The save path stays
//   strict: PATCH /me/profile still 400s a bad list.
// Run: node scripts/verify-build159.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build159-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["fixture", "admin", "1"].join("-");
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");
const root = path.join(process.cwd());

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

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

async function registerCreator(name, handle, market) {
  const c = makeClient();
  const email = `${handle.replace(/[^a-z0-9]/gi, "")}-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: PW, market, city: market, handle,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: 5000, avgViews: 1500, localAudiencePct: 70,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (r.status !== 201) throw new Error("creator register failed: " + JSON.stringify(r.data));
  return { client: c, email, id: r.data.user.id, handle };
}
async function approve(id) {
  const r = await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  if (r.status !== 200) throw new Error("approve failed: " + JSON.stringify(r.data));
}
// Direct record tuning: write stored creator fields the way a
// legacy/imported record would carry them — this is exactly how
// poisoned best-work data exists in production.
async function tuneCreator(id, patch) {
  const u = await store.get(`user:${id}`);
  u.creator = { ...(u.creator || {}), ...patch };
  await store.set(`user:${id}`, u);
  return u;
}
async function login(fixture) {
  const r = await fixture.client("POST", "/api/auth/login", { email: fixture.email, password: PW });
  if (r.status !== 200) throw new Error("creator login failed: " + JSON.stringify(r.data));
}
const FULL_STACK = { instagram: 5000, tiktok: 3000, youtube: 2000 };
const IG_REEL = "https://www.instagram.com/reel/qa159reel/";
const IG_POST = "https://www.instagram.com/p/qa159post/";
const TT_VIDEO = "https://www.tiktok.com/@qa159/video/7312345678901234567";
const YT_VIDEO = "https://www.youtube.com/watch?v=qa159video";
const LI_POST = "https://www.linkedin.com/posts/qa159-activity-1234567890";
const POISON = "https://example.com/post";
const LONG_URL = "https://www.instagram.com/reel/" + "a".repeat(300) + "/";

async function poisonedCreator(handle, bestWork) {
  const f = await registerCreator("Pat Poison", handle, "Virginia Beach");
  await approve(f.id);
  await tuneCreator(f.id, { bestWork, audienceStack: FULL_STACK, followerCount: 5000, totalAudience: 10000, localAudiencePct: 70, paidRate: 100, publicPage: true });
  await login(f);
  return f;
}

// --- E: source pins ------------------------------------------
console.log("== E: source pins ==");
{
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("stamp 2026.11.09-159 on both asset URLs", (indexHtml.match(/2026\.11\.09-159/g) || []).length === 2, `count=${(indexHtml.match(/2026\.11\.09-159/g) || []).length}`);
  check("read path filters stored links per-entry (storedBestWorkLinks)", routerJs.includes("function storedBestWorkLinks(creator)"), "");
  check("bestWorkCards no longer dereferences the all-or-nothing validator", !routerJs.includes("validateBestWork(creator && creator.bestWork).links"), "");
  check("save path still rejects an invalid list with 400", routerJs.includes('if (!v.ok) return err(400, v.error);'), "");
}

// --- A: GET /api/me/founding on poisoned records ---------------
console.log("== A: founding endpoint ==");
{
  const A1 = await poisonedCreator("poisononly159", [POISON]);
  const r1 = await A1.client("GET", "/api/me/founding");
  check("A1 non-platform URL only: founding answers 200 (was 500)", r1.status === 200, `got ${r1.status} ${JSON.stringify(r1.data).slice(0, 160)}`);
  check("A1: the card's bestWork is an empty list", !!r1.data.card && Array.isArray(r1.data.card.bestWork) && r1.data.card.bestWork.length === 0, JSON.stringify(r1.data.card && r1.data.card.bestWork));

  const A2 = await poisonedCreator("poisonmixed159", [IG_REEL, POISON, TT_VIDEO]);
  const r2 = await A2.client("GET", "/api/me/founding");
  const bw2 = (r2.data.card && r2.data.card.bestWork) || [];
  check("A2 mixed valid + poison: founding answers 200", r2.status === 200, `got ${r2.status}`);
  check("A2: only the valid entries render, in stored order", bw2.length === 2 && bw2[0].url === IG_REEL && bw2[1].url === TT_VIDEO, JSON.stringify(bw2).slice(0, 220));
  check("A2: card platforms/labels are the real ones", bw2.length === 2 && bw2[0].platform === "Instagram" && bw2[0].label === "Watch: Instagram reel" && bw2[1].platform === "TikTok", JSON.stringify(bw2).slice(0, 220));

  const A3 = await poisonedCreator("validtrio159", [IG_POST, YT_VIDEO, LI_POST]);
  const r3 = await A3.client("GET", "/api/me/founding");
  const bw3 = (r3.data.card && r3.data.card.bestWork) || [];
  check("A3 fully valid record: founding answers 200", r3.status === 200, `got ${r3.status}`);
  check("A3: all three cards render exactly as before", bw3.length === 3 && bw3[0].platform === "Instagram" && bw3[1].platform === "YouTube" && bw3[2].platform === "LinkedIn" && bw3.every((c) => "embed" in c), JSON.stringify(bw3).slice(0, 220));

  const A4 = await poisonedCreator("poisonstring159", IG_POST);
  const r4 = await A4.client("GET", "/api/me/founding");
  check("A4 bestWork stored as a bare string: founding answers 200", r4.status === 200, `got ${r4.status}`);
  check("A4: the card's bestWork is an empty list", !!r4.data.card && Array.isArray(r4.data.card.bestWork) && r4.data.card.bestWork.length === 0, JSON.stringify(r4.data.card && r4.data.card.bestWork));

  const A5 = await poisonedCreator("poisonfour159", [IG_POST, YT_VIDEO, LI_POST, TT_VIDEO]);
  const r5 = await A5.client("GET", "/api/me/founding");
  const bw5 = (r5.data.card && r5.data.card.bestWork) || [];
  check("A5 four valid links stored: founding answers 200, capped at 3", r5.status === 200 && bw5.length === 3 && bw5[2].url === LI_POST, `got ${r5.status} n=${bw5.length}`);

  const A6 = await poisonedCreator("poisonlong159", [LONG_URL, IG_POST]);
  const r6 = await A6.client("GET", "/api/me/founding");
  const bw6 = (r6.data.card && r6.data.card.bestWork) || [];
  check("A6 over-long entry + valid entry: 200, only the valid card renders", r6.status === 200 && bw6.length === 1 && bw6[0].url === IG_POST, `got ${r6.status} ${JSON.stringify(bw6).slice(0, 160)}`);

  const A7 = await poisonedCreator("poisondupe159", [IG_POST, IG_POST, TT_VIDEO]);
  const r7 = await A7.client("GET", "/api/me/founding");
  const bw7 = (r7.data.card && r7.data.card.bestWork) || [];
  check("A7 duplicate entries: 200, deduped like the validator", r7.status === 200 && bw7.length === 2 && bw7[0].url === IG_POST && bw7[1].url === TT_VIDEO, `got ${r7.status} n=${bw7.length}`);

  // --- B: the public page (the other bestWorkCards consumer) ---
  console.log("== B: public profile page ==");
  const rb = await A2.client("GET", `/c/${A2.handle}`, undefined, `/c/${A2.handle}`);
  const html = typeof rb.data === "string" ? rb.data : JSON.stringify(rb.data);
  check("B poisoned creator's public page answers 200 (was 500)", rb.status === 200, `got ${rb.status}`);
  check("B: the valid best-work link is on the page", html.includes(IG_REEL), html.slice(0, 160));
  check("B: the poisoned URL is nowhere on the page", !html.includes("example.com"), "");

  // --- C: the save path is unchanged ---------------------------
  console.log("== C: save path strictness ==");
  const bad = await A2.client("PATCH", "/api/me/profile", { bestWork: [POISON] });
  check("C: PATCH with a non-platform link still 400s", bad.status === 400, `got ${bad.status}`);
  const good = await A2.client("PATCH", "/api/me/profile", { bestWork: [YT_VIDEO] });
  check("C: PATCH with a valid list still saves (200)", good.status === 200, `got ${good.status}`);
  const stored = await store.get(`user:${A2.id}`);
  check("C: the saved list is stored verbatim", JSON.stringify((stored.creator || {}).bestWork) === JSON.stringify([YT_VIDEO]), JSON.stringify((stored.creator || {}).bestWork));
  const rAfter = await A2.client("GET", "/api/me/founding");
  const bwAfter = (rAfter.data.card && rAfter.data.card.bestWork) || [];
  check("C: after the save, founding renders the saved card", rAfter.status === 200 && bwAfter.length === 1 && bwAfter[0].url === YT_VIDEO, `got ${rAfter.status}`);
}

console.log(`\nverify-build159: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
