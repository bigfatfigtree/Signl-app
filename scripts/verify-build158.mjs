// verify-build158.mjs — Build -158: Category default-all.
//   Magpie ranks creators by local audience, not niche, so most
//   creators belong in nearly ALL categories. This build:
//   CLAIM: the claim draft seeds all 12 categories on first render
//     (catsSeeded guard — an intentional untick-all is never
//     re-seeded) with the friends-and-family explainer copy.
//   FORM: the full founding form pre-ticks every c-cat checkbox
//     (comp categories untouched) with the ticked-all helper line.
//   MAGGIE: the finish flow pre-seeds all categories, gains the
//     "My page is only about one thing" action (categoriesLocked),
//     the summary line for the lock, and the categories gap is
//     skipped entirely when locked.
//   PROFILE: the editor carries the more-categories helper line.
//   SERVER: PATCH /me/profile persists categoriesLocked +
//     catPromptSeenAt/catPromptChoice; no save path re-adds
//     categories; the coach ladder's categories step is done when
//     locked (even with 1 category) with the new why-line; the
//     concierge stops asking for categories when locked.
//   BACKFILL: GET /sig/prompts returns the one-time catbackfill
//     card for an approved, unseen, unlocked creator under 12
//     categories (winning over no step / the categories step only).
// Run: node scripts/verify-build158.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build158-${Date.now()}.json`);
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

async function registerCreator(name, handle, market, opts) {
  const o = opts || {};
  const c = makeClient();
  const email = o.email || `${handle.replace(/[^a-z0-9]/gi, "")}-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: PW, market, city: o.city || market, handle,
    categories: o.categories || ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: o.followers || 5000, avgViews: 1500, localAudiencePct: o.pct == null ? 70 : o.pct,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (r.status !== 201) throw new Error("creator register failed: " + JSON.stringify(r.data));
  return { client: c, email, id: r.data.user.id, handle };
}
async function approve(id) {
  const r = await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  if (r.status !== 200) throw new Error("approve failed: " + JSON.stringify(r.data));
}
// Direct record tuning (same pattern as verify-build157's
// setTester): set exact creator fields the ladder reads.
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
const NEW_WHY = "Your followers are your neighbors — they'd watch you enjoy almost anything local. Creators here average about 7 categories, and each one is another kind of business that can find you.";

// --- E: source pins ------------------------------------------
console.log("== E: source pins ==");
{
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("stamp 2026.11.09-158 on both asset URLs", (indexHtml.match(/2026\.11\.09-158/g) || []).length === 2, `count=${(indexHtml.match(/2026\.11\.09-158/g) || []).length}`);
  check("claim draft carries the catsSeeded guard", appJs.includes("catsSeeded: false") && appJs.includes("d.catsSeeded = true"), "");
  check("claim render seeds all categories from boot", appJs.includes("d.cats = [...state.boot.creatorCategories]"), "");
  check("claim headline copy present (EN + ES)", appJs.includes("Almost everything you post counts here.") && appJs.includes("Casi todo lo que publicas cuenta aquí."), "");
  check("claim body + microline copy present", appJs.includes("So we've ticked everything for you.") && appJs.includes("Every ticked category is another kind of local business that can find you."), "");
  const catLine = appJs.split("\n").find((l) => l.includes('name="c-cat"')) || "";
  const compLine = appJs.split("\n").find((l) => l.includes('name="c-comp"')) || "";
  check("join form c-cat renders checked", catLine.includes("checked"), catLine.slice(0, 160));
  check("join form c-comp is NOT pre-ticked (out of scope stays untouched)", compLine.length > 0 && !compLine.includes("checked"), compLine.slice(0, 160));
  check("join form ticked-all helper present", appJs.includes("We've ticked all of them — most creators here keep nearly all."), "");
  check("profile editor helper present", appJs.includes("More ticked categories means more kinds of businesses can find you."), "");
  check("Maggie finish flow: pre-seed + one-thing action + lock summary", appJs.includes("sel.push(...state.boot.creatorCategories)") && appJs.includes("My page is only about one thing") && appJs.includes("f.data.patch.categoriesLocked = true") && appJs.includes("Categories: settled"), "");
  check("Maggie finish flow: categories gap skipped when locked", appJs.includes('id === "categories" && (state.user.creator || {}).categoriesLocked === true'), "");
  check("backfill card: three actions wired client-side", appJs.includes('s.type === "catbackfill"') && appJs.includes("data-cat-all") && appJs.includes("data-cat-pick") && appJs.includes("data-cat-one") && appJs.includes('catPromptChoice: "onething"'), "");
  check("server: PATCH persists the lock + prompt-seen fields", routerJs.includes("c.categoriesLocked = b.categoriesLocked === true") && routerJs.includes("c.catPromptSeenAt = new Date().toISOString()"), "");
  check("server: catBackfillView + prompts priority present", routerJs.includes("function catBackfillView(user)") && routerJs.includes("const bf = catBackfillView(user)"), "");
  check("server: coach why-line is the new copy", routerJs.includes(NEW_WHY), "");
}

// --- A + B: PATCH /me/profile persistence ----------------------
console.log("== A/B: profile PATCH ==");
const PA = await registerCreator("Pat Patch", "patpatch158", "Virginia Beach", { categories: ["Food & Drink"] });
await approve(PA.id);
await login(PA);
{
  const r = await PA.client("PATCH", "/api/me/profile", { categories: ["Food & Drink", "Music"], categoriesLocked: false, catPromptSeen: true, catPromptChoice: "all" });
  check("PATCH answers 200 with the user", r.status === 200 && !!r.data.user, `got ${r.status}`);
  const stored = await store.get(`user:${PA.id}`);
  const c = (stored && stored.creator) || {};
  check("categories persist exactly as sent", JSON.stringify(c.categories) === JSON.stringify(["Food & Drink", "Music"]), JSON.stringify(c.categories));
  check("categoriesLocked persists (false)", c.categoriesLocked === false, String(c.categoriesLocked));
  check("catPromptSeenAt is stamped", typeof c.catPromptSeenAt === "string" && !Number.isNaN(Date.parse(c.catPromptSeenAt)), String(c.catPromptSeenAt));
  check("catPromptChoice persists", c.catPromptChoice === "all", String(c.catPromptChoice));
  const bad = await PA.client("PATCH", "/api/me/profile", { catPromptSeen: true, catPromptChoice: "bogus" });
  const stored2 = await store.get(`user:${PA.id}`);
  check("an off-list catPromptChoice never overwrites", bad.status === 200 && stored2.creator.catPromptChoice === "all", String(stored2.creator.catPromptChoice));
  const lock = await PA.client("PATCH", "/api/me/profile", { categoriesLocked: true });
  const stored3 = await store.get(`user:${PA.id}`);
  check("categoriesLocked persists (true)", lock.status === 200 && stored3.creator.categoriesLocked === true, "");
  const fewer = await PA.client("PATCH", "/api/me/profile", { categories: ["Music"] });
  const stored4 = await store.get(`user:${PA.id}`);
  check("B: a save with fewer categories never re-adds (stored stays as sent)", fewer.status === 200 && JSON.stringify(stored4.creator.categories) === JSON.stringify(["Music"]), JSON.stringify(stored4.creator.categories));
  check("B: the fewer-categories save leaves the lock alone", stored4.creator.categoriesLocked === true, "");
}

// --- C: coach ladder categories step ----------------------------
console.log("== C: coach ladder ==");
// Both ladder fixtures carry catPromptSeenAt so the backfill
// card (which by design wins over the categories step) stays out
// of the way and the ladder itself is what surfaces.
const UNLOCKED = await registerCreator("Uma Unlocked", "umaunlocked158", "Virginia Beach", { categories: ["Food & Drink"] });
await approve(UNLOCKED.id);
await tuneCreator(UNLOCKED.id, { categories: ["Food & Drink"], catPromptSeenAt: "2026-11-09T00:00:00.000Z", audienceStack: FULL_STACK, followerCount: 5000, totalAudience: 10000, localAudiencePct: 70, paidRate: 100 });
await login(UNLOCKED);
const LOCKED = await registerCreator("Lena Locked", "lenalocked158", "Virginia Beach", { categories: ["Food & Drink"] });
await approve(LOCKED.id);
await tuneCreator(LOCKED.id, { categories: ["Food & Drink"], categoriesLocked: true, catPromptSeenAt: "2026-11-09T00:00:00.000Z", audienceStack: FULL_STACK, followerCount: 5000, totalAudience: 10000, localAudiencePct: 70, paidRate: 100 });
await login(LOCKED);
{
  const r1 = await UNLOCKED.client("GET", "/api/sig/prompts");
  const co1 = r1.data && r1.data.coaching;
  check("unlocked with 1 category: the categories step is offered", r1.status === 200 && !!co1 && co1.type === "categories", JSON.stringify(co1).slice(0, 200));
  check("...with the new why-line, verbatim", !!co1 && co1.why === NEW_WHY, co1 && co1.why);
  const r2 = await LOCKED.client("GET", "/api/sig/prompts");
  const co2 = r2.data && r2.data.coaching;
  check("locked with 1 category: the categories step is done (never offered)", r2.status === 200 && (!co2 || co2.type !== "categories"), JSON.stringify(co2).slice(0, 200));
}

// --- D: backfill prompt -----------------------------------------
console.log("== D: backfill ==");
async function backfillReady(handle, cats, extra) {
  const f = await registerCreator(handle, handle, "Virginia Beach", { categories: cats.slice(0, 8) });
  await approve(f.id);
  await tuneCreator(f.id, { categories: cats, audienceStack: FULL_STACK, followerCount: 5000, totalAudience: 10000, localAudiencePct: 70, paidRate: 100, bestWork: ["https://example.com/post"], ...(extra || {}) });
  await login(f);
  return f;
}
const BF = await backfillReady("bfthree158", ["Food & Drink", "Music", "Sports"]);
const BF_LOCKED = await backfillReady("bflocked158", ["Food & Drink", "Music", "Sports"], { categoriesLocked: true });
const ALL12 = ["Food & Drink", "Nightlife", "Beauty & Grooming", "Fitness & Wellness", "Health & Wellness", "Retail & Shopping", "Attractions & Events", "Local Services", "Lifestyle", "Sports", "Music", "Other"];
const BF_FULL = await backfillReady("bffull158", ALL12);
{
  const r = await BF.client("GET", "/api/sig/prompts");
  const co = r.data && r.data.coaching;
  check("3 categories, unseen + unlocked: the catbackfill card is returned", r.status === 200 && !!co && co.type === "catbackfill", JSON.stringify(co).slice(0, 200));
  check("...with the headline, counts and target the client needs", !!co && co.headline === "Almost everything you post counts here." && co.catCount === 3 && co.catTotal === 12 && co.target === "categories" && /You're in 3 of 12 categories/.test(co.why || ""), co && co.why);
  const seen = await BF.client("PATCH", "/api/me/profile", { catPromptSeen: true, catPromptChoice: "pick" });
  check("the pick tap records (200)", seen.status === 200, `got ${seen.status}`);
  const r2 = await BF.client("GET", "/api/sig/prompts");
  check("after catPromptSeenAt is set: NO catbackfill", r2.status === 200 && (!r2.data.coaching || r2.data.coaching.type !== "catbackfill"), JSON.stringify(r2.data.coaching).slice(0, 160));
  const r3 = await BF_LOCKED.client("GET", "/api/sig/prompts");
  check("when locked: NO catbackfill", r3.status === 200 && (!r3.data.coaching || r3.data.coaching.type !== "catbackfill"), JSON.stringify(r3.data.coaching).slice(0, 160));
  const r4 = await BF_FULL.client("GET", "/api/sig/prompts");
  check("at 12 categories: NO catbackfill", r4.status === 200 && (!r4.data.coaching || r4.data.coaching.type !== "catbackfill"), JSON.stringify(r4.data.coaching).slice(0, 160));
}

// --- F: Build -158 fix pass -------------------------------------
console.log("== F: fix-pass guards ==");
{
  // Register path cap: the full form sending all 12 must store 12.
  const REG12 = await registerCreator("Reg Twelve", "regtwelve158", "Virginia Beach", { categories: ALL12 });
  const regStored = await store.get(`user:${REG12.id}`);
  const regCats = (regStored && regStored.creator && regStored.creator.categories) || [];
  check("register with all 12 categories stores all 12", JSON.stringify(regCats) === JSON.stringify(ALL12), JSON.stringify(regCats));

  // Snooze silence: an incomplete-rate creator is offered the rate
  // step, snoozes it via the coaching act, and then must see NO
  // card at all — the backfill must not break the snooze.
  const SNOOZED = await registerCreator("Sue Snoozed", "suesnoozed158", "Virginia Beach", { categories: ["Food & Drink", "Music", "Sports"] });
  await approve(SNOOZED.id);
  await tuneCreator(SNOOZED.id, { categories: ["Food & Drink", "Music", "Sports"], audienceStack: FULL_STACK, followerCount: 5000, totalAudience: 10000, localAudiencePct: 70, paidRate: null, bestWork: ["https://example.com/post"] });
  await login(SNOOZED);
  const s1 = await SNOOZED.client("GET", "/api/sig/prompts");
  check("snooze fixture: the rate step is offered before snooze", s1.status === 200 && !!s1.data.coaching && s1.data.coaching.type === "rate", JSON.stringify(s1.data.coaching).slice(0, 160));
  const sAct = await SNOOZED.client("POST", "/api/sig/coaching/act", { action: "snooze" });
  check("snooze fixture: snooze act answers ok", sAct.status === 200, `got ${sAct.status}`);
  const s2 = await SNOOZED.client("GET", "/api/sig/prompts");
  check("snoozed creator with 3 categories gets NO catbackfill (no card at all)", s2.status === 200 && s2.data.coaching === null, JSON.stringify(s2.data.coaching).slice(0, 160));

  // Delivered-booking silence: a ladder-complete creator (the
  // backfillReady tuning completes every step) with a delivered
  // booking and 3 categories must see NO card at all.
  const DELIV = await backfillReady("bfdeliv158", ["Food & Drink", "Music", "Sports"]);
  await store.set("booking:bkdeliv158", { id: "bkdeliv158", creatorId: DELIV.id, post: { url: "https://example.com/post", createdAt: "2026-11-08T00:00:00.000Z" } });
  const d1 = await DELIV.client("GET", "/api/sig/prompts");
  check("ladder-complete creator with a delivered booking and 3 categories gets NO catbackfill (no card at all)", d1.status === 200 && d1.data.coaching === null, JSON.stringify(d1.data.coaching).slice(0, 160));
}

console.log(`\nverify-build158: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
