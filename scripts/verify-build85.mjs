// Build -85 verification: the claim flow simplification
// (Jeff, 2026-11-02). The claim door is three short screens
// (photo welcome / four gate facts / email + password) and a
// done state, replacing the one-shot quick-claim form. Server
// behavior must be IDENTICAL: the flow posts to the same
// endpoints the old quick claim and the Finish Engine use
// (POST /auth/register with quickClaim: true, then PATCH
// /me/profile for the facts). This suite proves:
//   - the client ships the three screens + done state, with the
//     lanes stated as facts (no radio/lane controls anywhere in
//     the claim slice) and the unresolved-handle path rendering
//     a handle field, never an error wall;
//   - attribution (signupSource, referredBy) rides the register
//     payload into the stored record, and signupPath stays
//     "quick_claim";
//   - the facts land through the profile write and complete the
//     profile under the exact Build -65 gate math;
//   - a 1..499 known total keeps the profile unfinished and a
//     manual approval is refused 422 with the plain minimum
//     line (the under-minimum hold), exactly as before;
//   - a zero-count claim still approves (0 = not stated);
//   - grandfathered pre-ruling records are untouched by the
//     hold and stay complete.
// Run: node scripts/verify-build85.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8941;
const BASE = `http://127.0.0.1:${PORT}`;
const PORT2 = 8942;
const BASE2 = `http://127.0.0.1:${PORT2}`;
const ADMIN_EMAIL = "admin@b85.dev";
const ADMIN_PASSWORD = "<redacted>";
const MIN_LINE = "SIGNL starts at 500 total followers across your platforms.";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 220) : ""}`); }
}

// ---------- static: the client surface ----------
console.log("== Static: the three-screen claim surface ==");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const sliceStart = appJs.indexOf("// ---------- claim flow (Build -85");
const sliceEnd = appJs.indexOf("function renderJoinCreator()");
const slice = sliceStart >= 0 && sliceEnd > sliceStart ? appJs.slice(sliceStart, sliceEnd) : "";
check("claim slice found in app.js", slice.length > 4000, `len=${slice.length}`);
check("all three screens + done state render", ["renderClaimWelcome", "renderClaimFacts", "renderClaimAccount", "renderClaimDone"].every((f) => slice.includes(`function ${f}(`)));
check("renderQuickClaim dispatches the steps", slice.includes("function renderQuickClaim()") && slice.includes("renderClaimWelcome()") && slice.includes("renderClaimFacts()"));
check("welcome: invitation headline + one button", slice.includes("You're invited,") && slice.includes("Claim my page") && (slice.match(/Claim my page/g) || []).length === 1);
check("welcome: real photo band (default + per-city)", slice.includes("/assets/claim/welcome.jpg") && slice.includes("claimPhotoFor") && fs.existsSync(path.join(root, "public", "assets", "claim", "welcome.jpg")) && fs.existsSync(path.join(root, "public", "assets", "claim", "city-nashville.jpg")));
check("lanes stated once as facts", slice.includes("Hosted visits: a local business treats you, you post honestly.") && slice.includes("Paid bookings at your rate. You keep 97%."));
check("lanes are NOT controls (no radios, no lane bullets, no lane select)", !slice.includes('type="radio"') && !slice.includes('class="lrow"') && !slice.includes('name="lane"') && !slice.includes("openToPaidCampaigns"));
check("unresolved path: one handle field + a gentle prompt, no error wall", slice.includes('id="c85-handle"') && slice.includes("Add your handle so businesses can find your page.") && !slice.includes("could not find") && !slice.includes("No account found"));
check("facts screen: per-platform rows for all 7 stack platforms", ["instagram", "tiktok", "youtube", "facebook", "x", "linkedin", "snapchat"].every((p) => slice.includes(`{ id: "${p}"`)) && slice.includes("CLAIM_STACK_PLATFORMS"));
check("facts screen: live counted line + the plain under-500 line", slice.includes("Counted so far:") && slice.includes(MIN_LINE));
check("facts screen: the local % is one slider", slice.includes('type="range"') && slice.includes('id="c85-localpct"'));
check("account screen: Finish button + the founding-roster wording", slice.includes("Finish — join the founding roster"));
check("done state: roster headline + the two-day line + the optional button", slice.includes("You're on the roster,") && slice.includes("We review every creator personally. You'll hear within two business days.") && slice.includes("Add your rates and best work"));
check("submit: same register payload discipline (quickClaim + attribution)", slice.includes("quickClaim: true") && slice.includes("signupSource: storedSrc() || undefined") && slice.includes("referredBy: storedRef() || undefined") && slice.includes("goldenTicket: storedTicket() || undefined") && slice.includes('lang: state.lang === "es" ? "es" : undefined'));
check("facts land through the existing profile write", slice.includes('api("PATCH", "/me/profile", patch)') && slice.includes("patch.audienceStack") && slice.includes("patch.localAudiencePct") && slice.includes("patch.categories"));
check("stamp is 2026.11.02-106 on both sides", fs.readFileSync(path.join(root, "netlify", "functions", "lib", "build.js"), "utf8").includes('BUILD_ID = "2026.11.02-106"') && fs.readFileSync(path.join(root, "public", "index.html"), "utf8").includes("2026.11.02-106"));

// ---------- live: the exact client sequence ----------
class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}
function startServer(db, port) {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL, ADMIN_PASSWORD };
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
function storedUser(dbFile, id) {
  const data = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  return data[`user:${id}`] || null;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b85-"));
const DB = path.join(tmp, "db.json");
const DB2 = path.join(tmp, "db2.json");

console.log("== Phase 1: the new flow's exact request sequence ==");
const server = startServer(DB, PORT);
await waitUp(BASE);
const admin = new Client(BASE);
{
  const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", r.status === 200 && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
}
async function claimRegister(email, handle, extra = {}) {
  const c = new Client(BASE);
  const r = await c.req("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email, password: "<redacted>", market: "Nashville",
    handle, primaryPlatform: "instagram", agreedTerms: true, ...extra,
  });
  return { c, r };
}

// Claim A: the full walk (register -> facts PATCH -> complete).
const a = await claimRegister("maya@b85.dev", "b85maya", { signupSource: "email", referredBy: "b85ref" });
check("A: claim registers (201, pending)", a.r.status === 201 && a.r.data.user.status === "pending", `status=${a.r.status}`);
check("A: quick claim starts unfinished", a.r.data.user.creator.profileComplete === false);
{
  const rec = storedUser(DB, a.r.data.user.id);
  check("A: attribution survived into the stored record", !!rec && rec.signupSource === "email" && rec.referredBy === "b85ref", JSON.stringify(rec && { s: rec.signupSource, r: rec.referredBy }));
  check("A: signupPath is quick_claim", !!rec && rec.creator.signupPath === "quick_claim", rec && rec.creator.signupPath);
}
{
  const p = await a.c.req("PATCH", "/api/me/profile", { name: "Maya Chen", city: "Nashville", categories: ["Food & Drink"], localAudiencePct: 62, audienceStack: { instagram: 900, tiktok: 300 } });
  check("A: facts PATCH accepted", p.status === 200, `status=${p.status}`);
  const me = await a.c.req("GET", "/api/auth/me");
  const u = me.data.user;
  check("A: profile complete under the Build -65 gate", u.profileCompletion && u.profileCompletion.complete === true && u.creator.profileComplete === true, JSON.stringify(u.profileCompletion && u.profileCompletion.missing));
  check("A: facts stored (city, categories, local %, stacked total)", u.city === "Nashville" && (u.creator.categories || []).includes("Food & Drink") && u.creator.localAudiencePct === 62 && u.creator.totalAudience === 1200, JSON.stringify({ city: u.city, total: u.creator.totalAudience }));
  check("A: display name landed", u.name === "Maya Chen", u.name);
  const ev = await admin.req("GET", "/api/admin/events?type=profile_completed&limit=500");
  check("A: profile_completed event fired once", ((ev.data && ev.data.events) || []).filter((e) => e.subjectId === u.id).length === 1);
  const conf = await admin.req("GET", "/api/admin/events?type=signup_confirmation_email_queued&limit=500");
  check("A: claim confirmation email queued (server behavior unchanged)", ((conf.data && conf.data.events) || []).filter((e) => e.subjectId === u.id).length === 1);
}

// Claim B: a known 1..499 total (the under-minimum hold).
const b = await claimRegister("small@b85.dev", "b85small", { signupSource: "dm" });
await b.c.req("PATCH", "/api/me/profile", { city: "Nashville", categories: ["Food & Drink"], localAudiencePct: 40, audienceStack: { instagram: 300 } });
{
  const me = await b.c.req("GET", "/api/auth/me");
  check("B: 300 total keeps the profile unfinished", me.data.user.creator.profileComplete === false);
  const aud = ((me.data.user.profileCompletion || {}).items || []).find((i) => i.id === "audience");
  check("B: checklist audience detail states the minimum + the counted 300", !!aud && aud.done === false && aud.detail.includes(MIN_LINE) && aud.detail.includes("300"), aud && aud.detail);
  const ap = await admin.req("POST", "/api/admin/review", { userId: b.r.data.user.id, decision: "approve" });
  check("B: manual approval of a known 300 is refused 422 with the plain line", ap.status === 422 && !!(ap.data && ap.data.error && ap.data.error.includes(MIN_LINE)), `status=${ap.status}`);
  const apps = await admin.req("GET", "/api/admin/applications");
  const row = (apps.data.pending || []).find((u) => u.id === b.r.data.user.id);
  check("B: record stays pending with the under-minimum stamp", !!row && !!row.underMinimum && row.underMinimum.total === 300);
}

// Claim C: no counts at all (0 = not stated) still approves.
const cc = await claimRegister("zero@b85.dev", "b85zero", {});
await cc.c.req("PATCH", "/api/me/profile", { city: "Nashville", categories: ["Music"], localAudiencePct: 55 });
{
  const ap = await admin.req("POST", "/api/admin/review", { userId: cc.r.data.user.id, decision: "approve" });
  check("C: a zero-count claim still approves (never a dead end)", ap.status === 200 && ap.data.user.status === "approved", `status=${ap.status}`);
}
server.kill("SIGTERM");
await new Promise((r) => setTimeout(r, 400));

console.log("== Phase 2: grandfathered records are untouched ==");
function seedCreator(id, { name, email, market, city, handle, status, createdAt, total, complete }) {
  return {
    id, role: "creator", email, name, passwordSalt: "seed", passwordHash: "seed",
    status, tester: false, market, city, state: null, country: "United States", createdAt, updatedAt: createdAt,
    reviewedAt: status === "pending" ? null : createdAt, reviewedBy: status === "pending" ? null : "seed",
    termsVersion: "2026-10-19", termsAcceptedAt: createdAt, marketingEmailConsent: false, marketingConsentAt: null,
    creator: {
      handle, primaryPlatform: "instagram", followerCount: total, audienceStack: { instagram: total }, totalAudience: total,
      avgViews: 0, tierBand: "Neighbors", suggestedTier: "Neighbors", computedTier: "Neighbors",
      categories: ["Food & Drink"], compCategories: [], openToPaidCampaigns: false, compOpen: true,
      paidRate: null, licensingFee: null, bio: "Grandfathered seed creator, here before the minimum.", bestWork: [], maxVisitsPerWeek: 3, neighborhood: "",
      localAudiencePct: 60, profileComplete: complete, profileCompletedAt: complete ? createdAt : null, publicPage: true,
    },
    business: null,
  };
}
{
  const data = {};
  data["user:seed-b85-grand"] = seedCreator("seed-b85-grand", { name: "Grand Pending", email: "grandpending@b85.dev", market: "Virginia Beach", city: "Virginia Beach", handle: "b85grand", status: "pending", createdAt: "2026-10-21T12:00:00.000Z", total: 300, complete: false });
  fs.writeFileSync(DB2, JSON.stringify(data));
}
const server2 = startServer(DB2, PORT2);
await waitUp(BASE2);
const admin2 = new Client(BASE2);
await admin2.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
{
  const ap = await admin2.req("POST", "/api/admin/review", { userId: "seed-b85-grand", decision: "approve" });
  check("grandfather: a pre-ruling 300-total record still approves by hand (the hold never reaches it)", ap.status === 200 && ap.data.user.status === "approved", `status=${ap.status}`);
}
server2.kill("SIGTERM");

console.log(`\nverify-build85: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("failures:", failures.join(" | ")); process.exit(1); }
