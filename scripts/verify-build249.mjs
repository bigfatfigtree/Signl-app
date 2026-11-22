// verify-build249.mjs — Build -249: the creator sign-up fixes
// from Jeff's own live test (2026-11-21 ~22:38 ET, he signed up
// as @fholioapp and sent five screenshots with five directives).
//
//   1. The confirmation screen said "You're in." over three
//      paragraphs. She has APPLIED. The rebuild is visual-first:
//      "You've applied.", a 3-step what-happens-next (Applied →
//      We review by hand → Approved, your full dashboard opens),
//      the big local-followers stat card, and NO number/position
//      language (no founding band, no founding order, no "N out
//      of 10") per Jeff's NO-NUMBER RULE.
//   2. His Finish tap sat on "Working..." — register awaited the
//      whole downstream fan-out (recruiter scan, auto-decision,
//      completion events, wishlist/roster, a live SMTP send) on
//      the request path. The -246 pattern now applies: commit,
//      queue one signupfanout job, respond; the background drain
//      runs the fan-out, and the confirmation email sends under
//      the -246 claim protocol — exactly once.
//   3. The post-agreement checkbox spelled out one deal's terms
//      (1 post + 1 story, 48 hours, 30 days). It is now a general
//      agreement to follow each accepted offer's own terms, with
//      the consent version stamped (POST_AGREEMENT_VERSION).
//   4. The follower step's "We can't look up Instagram counts
//      automatically" confession is a neutral fill-in note now.
//   5. Step 2's optional stall-capture email is gone: email is
//      asked once, at the final step. Categories start unchecked
//      on both signup doors, and the push reminder moved out of
//      the form onto the confirmation screen.
//
// This suite proves, at production scale with the -246 Blobs
// latency model (the -243 lesson: an instant store hides this
// whole class):
//   A. Source pins for every fix above.
//   B. The REAL confirmation renderer (vm) in EN and ES: new
//      headline, the 3 steps, the stat card, zero banned
//      number/position strings; Step 2 renders no email field
//      and no pre-ticked category; Step 4 carries the new
//      agreement and no push prompt.
//   C. A quick-claim register returns with ZERO fan-out effects
//      landed (no confirmation, no decision, job queued), then
//      the drain delivers exactly one confirmation; a re-drain
//      sends nothing more; a signup whose queue write was lost
//      is reconciled by the same drain and still gets exactly
//      one; two racing drains still send exactly one.
//   D. The auto-decision still lands (in the drain): the Rule A
//      evidenced claim is approved there, gets the approval
//      email exactly once, and NO confirmation email.
//   E. A full-form signup's profile_completed event fires in
//      the drain, once; a business signup's confirmation sends
//      in the drain, once.
//   F. A failing confirmation retries across drains and parks
//      as failed after 5 attempts with a signup_fanout_failed
//      event; the consent gate still refuses a signup without
//      the post agreement, in the new wording; the zero-follower
//      guards still refuse.
// Run: node scripts/verify-build249.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build249-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.SIGNL_MAIL_STUB = "1";
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify-admin-pass-123";
process.env.APP_URL = "https://app.magpielocal.com";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";

// --- Seed the event log at production scale BEFORE boot -----
const seedDb = {};
{
  const now = Date.now();
  const span = 21 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < 5200; i += 1) {
    const iso = new Date(now - Math.floor((i * span) / 5200)).toISOString();
    const key = `event:${iso}:${String(900000 - i).padStart(6, "0")}`;
    seedDb[key] = { id: key, type: "session_started", createdAt: iso, actorId: null, actorRole: null, subjectId: null, market: null, data: {} };
  }
}
fs.writeFileSync(DB_PATH, JSON.stringify(seedDb));

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");
const { runSignupFanout249 } = require("../netlify/functions/lib/router.js");
const root = process.cwd();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const count = (src, needle) => src.split(needle).length - 1;
const seg = (src, a, b) => { const i = src.indexOf(a); if (i < 0) return ""; const j = b ? src.indexOf(b, i + a.length) : -1; return src.slice(i, j > i ? j : undefined); };

// --- A: source pins -------------------------------------------
console.log("== A: source pins ==");
check("build stamp is 2026.11.21-249 and agrees in both homes",
  (() => { const a = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").match(/BUILD_ID = "2026\.11\.21-(\d+)"/); const b = fs.readFileSync(path.join(root, "public/index.html"), "utf8").match(/window\.__SIGNL_BUILD__ = "2026\.11\.21-(\d+)"/); return !!a && !!b && a[1] === b[1] && Number(a[1]) === 249; })(), "");

const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const bgSrc = fs.readFileSync(path.join(root, "netlify/functions/admin-home-refresh-background.js"), "utf8");

check("server: the signup fan-out exists (queue, drain, reconcile) and is exported",
  routerSrc.includes("async function queueSignupFanout249(user, quickClaim)")
  && routerSrc.includes("async function runSignupFanout249()")
  && routerSrc.includes("async function reconcileSignupFanout249(out)")
  && routerSrc.includes("runSignupFanout249,"), "");
check("server: the background function runs the signup drain in its own guarded block",
  bgSrc.includes("runSignupFanout249") && bgSrc.includes("Magpie signup fan-out drain:"), "");
const registerSeg = seg(routerSrc, "async function handleRegister(", "async function handleSwitchSide(");
check("server: register queues the fan-out and holds NO fan-out work itself",
  registerSeg.includes("await queueSignupFanout249(user, quickClaim)")
  && !registerSeg.includes("applyAutoDecision(")
  && !registerSeg.includes("onCreatorRegistered(")
  && !registerSeg.includes('deliverEmail("signup_confirmation"')
  && !registerSeg.includes("recordRosterDrop(")
  && !registerSeg.includes("alertWishlistBusinesses(")
  && !registerSeg.includes("maybeFireFinishMoment("), "");
check("server: register still commits its own events (application_submitted, plan_selected)",
  registerSeg.includes('type: "application_submitted"') && registerSeg.includes('type: "plan_selected"'), "");
check("server: the drain sends the confirmation under a preSendCheck claim gate",
  seg(routerSrc, "async function runSignupFanout249()", "// Does an existing job settle").includes("preSendCheck"), "");
check("server: the consent version is stamped (constant, user record, creator record, event)",
  routerSrc.includes('const POST_AGREEMENT_VERSION = "offers-v1-249";')
  && routerSrc.includes("postAgreementVersion: role === \"creator\" ? POST_AGREEMENT_VERSION : null")
  && count(routerSrc, "postAgreementVersion: b.agreedPostCompliance === true ? POST_AGREEMENT_VERSION : null") === 2
  && registerSeg.includes("postAgreementVersion: user.creator.postAgreementVersion || null"), "");
check("server: the -230 refusal carries the new general wording",
  routerSrc.includes("Please agree to the post agreement: follow the terms of each offer you accept on Magpie.")
  && !routerSrc.includes("you post honestly and disclose the comp, within 48 hours of the visit.\"),"), "");

const doneSeg = seg(appSrc, "function renderClaimDone()", "// ---------- Build -156");
const nbSeg = seg(appSrc, "function neighborPanelHtml()", "function neighborAnimateCount");
check("client: the confirmation headline is You've applied (EN + ES), never You're in",
  doneSeg.includes("You've applied,") && doneSeg.includes("Ya aplicaste,")
  && !doneSeg.includes("You're in,") && !doneSeg.includes("Ya estás dentro"), "");
check("client: the 3-step what-happens-next is on the confirmation screen",
  doneSeg.includes("claimNextSteps249Html()")
  && appSrc.includes("We review by hand") && appSrc.includes("Revisamos a mano")
  && appSrc.includes("Your full dashboard opens: offers, visits, wallet and stats.")
  && appSrc.includes("Se abre tu panel completo: ofertas, visitas, billetera y estadísticas."), "");
check("client: the text-heavy What-you-get block is gone from the confirmation screen",
  !appSrc.includes('id="claim-what-you-get"') && !doneSeg.includes("recorded in founding order"), "");
check("client: the stat card keeps the big local-followers number, number-free founding line",
  nbSeg.includes('id="nb-big"') && nbSeg.includes("of your followers live in")
  && nbSeg.includes("You're a founding creator in") && nbSeg.includes("that standing never expires"), "");
check("client: NO number/position language in the stat panel (no band, no out-of-10)",
  !nbSeg.includes("one of the first") && !nbSeg.includes("out of 10 of your audience")
  && !nbSeg.includes("f.band") && !nbSeg.includes("nbShareLine"), "");
check("client: the Maggie stack card survives, compact (one line + the form)",
  nbSeg.includes("Want a bigger number? Add your") && nbSeg.includes('id="nb-plat"') && nbSeg.includes('id="nb-plat-count"')
  && !nbSeg.includes("Every platform you add recounts"), "");
const factsSeg = seg(appSrc, "function renderClaimFacts()", "// ---------- Screen 3: another market?");
check("client: Step 2 renders NO stall-capture email field anymore",
  !factsSeg.includes("stallCapture226Html") && !factsSeg.includes("jc-email-stall"), "");
check("client: Step 2 categories start unchecked (no boot-category seeding)",
  !appSrc.includes("d.cats = [...state.boot.creatorCategories]")
  && factsSeg.includes("Tick everything that fits what you post.")
  && !appSrc.includes("So we've ticked everything for you"), "");
check("client: the full-join form's categories start unchecked too",
  !appSrc.includes('id="c-cat-all" checked') && !appSrc.includes('name="c-cat" value="${esc(c)}" checked')
  && !appSrc.includes("We've ticked all of them"), "");
const accountSeg = seg(appSrc, "function renderClaimAccount()", "async function doQuickClaim");
check("client: the push reminder is OUT of the claim form and ON the confirmation screen",
  !accountSeg.includes("pushReminder226Html")
  && doneSeg.includes('pushReminder226Html("creator", "claim")'), "");
check("client: the post agreement is the general per-offer wording on BOTH doors (EN + ES)",
  count(appSrc, "I will follow the terms of each offer I accept on Magpie.") === 2
  && count(appSrc, "seguiré los términos de cada oferta que acepte en Magpie.") === 2
  && !appSrc.includes("keep the post live for at least 30 days"), "");
check("client: the lookup note is a neutral fill-in instruction, no confession",
  appSrc.includes("Enter your ${label} count from your profile. You can fix it any time.")
  && !appSrc.includes("can't look up") && !appSrc.includes("No podemos buscar los conteos"), "");
check("client: the Terms/Privacy agreement is untouched on the claim account screen",
  accountSeg.includes("c85-agree-terms") && accountSeg.includes("Terms of Service") && accountSeg.includes("Privacy Policy"), "");

// --- B: the REAL renderers in a vm ----------------------------
console.log("== B: rendered confirmation screen (real functions, EN + ES) ==");
function doneHtmlFor(lang, neighbor) {
  const src = [
    seg(appSrc, "function T(", "\nfunction "),
    seg(appSrc, "function esc(", "\nfunction "),
    seg(appSrc, "function claimFmtCount(", "\nfunction "),
    seg(appSrc, "function claimNextSteps249Html()", "function renderClaimDone()"),
    seg(appSrc, "function renderClaimDone()", "// ---------- Build -156"),
    seg(appSrc, "function neighborMissingPlatforms()", "function neighborAnimateCount"),
    seg(appSrc, "function pushDismissed226(role, context)", "function pushReminder226Html("),
    seg(appSrc, "function pushReminder226Html(role, context)", "function refreshPushCards226("),
  ].join("\n");
  const sandbox = {
    state: {
      lang,
      user: { market: "Virginia Beach", creator: { audienceStack: { instagram: 1565 } } },
      claimDone: { firstName: "Jeff", total: 1800, complete: true, under: false },
      neighbor,
      boot: { push: null },
    },
    app: { innerHTML: "" },
    CLAIM_STACK_PLATFORMS: [{ id: "instagram", label: "Instagram followers" }, { id: "tiktok", label: "TikTok followers" }],
    marketDisplayName: (m) => m,
    signlInstallBannerHtml: () => "",
    magpieIgFollowHtml: () => "",
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout: () => {},
    window: {},
    document: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(src + "\n;renderClaimDone();", sandbox, { timeout: 5000 });
  return sandbox.app.innerHTML;
}
const NB = { neighborCount: 865, market: "Virginia Beach", localPct: 48, founding: { band: 100, position: 7 } };
const doneEn = doneHtmlFor("", NB);
check("render EN: headline reads You've applied, Jeff.",
  doneEn.includes("You've applied,") && doneEn.includes("Jeff."), doneEn.slice(0, 160));
check("render EN: the 3 steps render (Applied done, review by hand, dashboard opens)",
  doneEn.includes('id="claim-next-steps"') && doneEn.includes("Applied") && doneEn.includes("We review by hand")
  && doneEn.includes("within two business days") && doneEn.includes("Your full dashboard opens: offers, visits, wallet and stats."), "");
check("render EN: the stat card shows 865 of your followers live in Virginia Beach",
  doneEn.includes('id="nb-big">865<') && doneEn.includes("of your followers live in") && doneEn.includes("Virginia Beach"), "");
check("render EN: founding standing stated with NO numbers (no first-100, no position, no out-of-10)",
  doneEn.includes("You're a founding creator in Virginia Beach.")
  && !doneEn.includes("first 100") && !doneEn.includes("out of 10") && !doneEn.includes("founding order"), "");
check("render EN: the push reminder card is present on the confirmation screen",
  doneEn.includes("Turn on notifications"), "");
const doneEs = doneHtmlFor("es", NB);
check("render ES: headline + steps + stat card in Spanish, still no number language",
  doneEs.includes("Ya aplicaste,") && doneEs.includes("Revisamos a mano")
  && doneEs.includes("Se abre tu panel completo") && doneEs.includes("de tus seguidores viven en")
  && !doneEs.includes("de cada 10") && !doneEs.includes("primeras 100"), doneEs.slice(0, 160));
const doneNoNb = doneHtmlFor("", null);
check("render EN (no neighbor view): screen still complete without the stat card",
  doneNoNb.includes("You've applied,") && doneNoNb.includes('id="claim-next-steps"') && !doneNoNb.includes('id="nb-panel"'), "");

// --- C–F: behavior at production scale -------------------------
console.log("== C: register is fast and lands NOTHING downstream; the drain delivers exactly once ==");
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method, path: url.pathname, headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body), isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = res.body; }
    return { status: res.statusCode, data };
  };
}
async function allEvents() {
  const rows = await store.list("event:");
  return rows.map((r) => r.value).filter(Boolean);
}
const sentFor = async (userId, kind) => (await allEvents()).filter((e) => e.subjectId === userId && e.type === `${kind}_email_sent`);
const eventsFor = async (userId, type) => (await allEvents()).filter((e) => e.subjectId === userId && e.type === type);
const jobFor = (userId) => store.get(`signupfanout:${userId}`);

// Scale: 200 users + 1,300 prospects + 900 campaign recipients,
// seeded straight into the store (no latency yet).
{
  const base = { role: "creator", status: "approved", market: "Nashville", city: "Nashville", createdAt: new Date(Date.now() - 86400000).toISOString(), creator: { handle: "seed", followerCount: 2000, audienceStack: { instagram: 2000 }, totalAudience: 2000, categories: ["Food & Drink"], localAudiencePct: 50 } };
  for (let i = 0; i < 200; i += 1) {
    const id = `usr_seed249_${String(i).padStart(3, "0")}`;
    await store.set(`user:${id}`, { ...base, id, email: `seed249_${i}@fixtures.dev`, name: `Seed ${i}`, creator: { ...base.creator, handle: `seed249_${i}` } });
  }
  for (let i = 0; i < 1300; i += 1) {
    const id = `prosp_seed249_${String(i).padStart(4, "0")}`;
    await store.set(`prospect:${id}`, { id, name: `Seed Prospect ${i}`, status: "sent", linkedUserId: null, marketName: "Nashville", handles: [`seedprosp${i}`] });
  }
  for (let i = 0; i < 900; i += 1) {
    const id = `camp_seed249_${String(i).padStart(4, "0")}`;
    await store.set(`campaign-recipient:${id}`, { id, status: "sent", handle: `camp${i}`, email: `camp${i}@fixtures.dev`, market: "Nashville" });
  }
  check("production scale seeded: 5,200 events, 1,300 prospects, 200 users, 900 campaign recipients",
    (await store.listKeys("event:")).length >= 5200 && (await store.listKeys("prospect:")).length >= 1300
    && (await store.listKeys("user:")).length >= 200 && (await store.listKeys("campaign-recipient:")).length >= 900, "");
}

// Production latency wrapper (the -246 model).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const orig = { get: store.get, set: store.set, del: store.del, list: store.list, listKeys: store.listKeys, getMany: store.getMany };
store.get = async (k) => { await sleep(40); return orig.get(k); };
store.set = async (k, v) => { await sleep(40); return orig.set(k, v); };
store.del = async (k) => { await sleep(40); return orig.del(k); };
store.listKeys = async (p) => { const out = await orig.listKeys(p); await sleep(40 * Math.max(1, Math.ceil(out.length / 1000))); return out; };
store.list = async (p) => { const out = await orig.list(p); await sleep(40 * Math.max(1, Math.ceil(out.length / 1000))); return out; };
store.getMany = async (keys) => { await sleep(40 * Math.max(1, Math.ceil((keys || []).length / 12))); return orig.getMany(keys); };
function unwrapStore() { Object.assign(store, orig); }

// Warm-up: one ordinary admin read so per-request preamble
// jobs and memos settle before the measured calls.
const admin = makeClient();
const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
check("admin signs in", login.status === 200, `${login.status}`);
await admin("GET", "/api/admin/applications");

async function claimCreator(handle, email, extra = {}) {
  const c = makeClient();
  const t0 = Date.now();
  const reg = await c("POST", "/api/auth/register", { role: "creator", quickClaim: true, handle, market: "Nashville", email, password: `${handle}-pass-123`, agreedTerms: true, agreedPostCompliance: true, followerCount: 2400, localAudiencePct: 55, audienceStack: { instagram: 2400, tiktok: 800 }, categories: ["Food & Drink"], ...extra });
  return { client: c, reg, ms: Date.now() - t0, id: reg.data && reg.data.user && reg.data.user.id };
}

// Fixture A: the timed, measured signup. Fixture B: the
// stranded signup (its queue write is deleted before the first
// drain, so only reconciliation can save its email).
const fxA = await claimCreator("fast249a", "fast249a@fixtures.dev");
check("A: quick claim registers 201", fxA.reg.status === 201 && !!fxA.id, `${fxA.reg.status}`);
console.log(`  .. A register round trip at production scale: ${fxA.ms}ms (pre-249 measured 14,379ms cold / 1,305ms warm in the same model)`);
check("A: register returns fast (fan-out is off the path)", fxA.ms < 3000, `${fxA.ms}ms`);
check("A: NO confirmation email has sent when the response lands", (await sentFor(fxA.id, "signup_confirmation")).length === 0, "");
check("A: a signup fan-out job is queued, pending", await jobFor(fxA.id).then((j) => !!j && j.state === "pending" && j.role === "creator" && j.quickClaim === true), "");
{
  const rec = await store.get(`user:${fxA.id}`);
  check("A: the consent audit trail carries the new version + timestamp",
    !!rec && rec.postAgreementVersion === "offers-v1-249" && !!rec.postComplianceAcceptedAt
    && !!rec.creator && rec.creator.postAgreementVersion === "offers-v1-249" && rec.creator.agreedPostCompliance === true, "");
  check("A: the application_submitted event carries the consent version",
    (await eventsFor(fxA.id, "application_submitted")).some((e) => e.data && e.data.postAgreementVersion === "offers-v1-249"), "");
}
const fxB = await claimCreator("stranded249b", "stranded249b@fixtures.dev");
check("B: quick claim registers 201", fxB.reg.status === 201 && !!fxB.id, `${fxB.reg.status}`);
unwrapStore();
await store.del(`signupfanout:${fxB.id}`); // the lost queue write
check("B: its queue write is gone (the stranding is real)", (await store.get(`signupfanout:${fxB.id}`)) == null, "");

// The FIRST drain in this process: reconciliation runs here.
const drain1 = await runSignupFanout249();
check("drain 1: reconciliation re-queued the stranded signup", drain1.reconciled >= 1, JSON.stringify(drain1));
check("A: exactly one confirmation email after the drain", (await sentFor(fxA.id, "signup_confirmation")).length === 1, "");
check("B: exactly one confirmation email after reconciliation + drain", (await sentFor(fxB.id, "signup_confirmation")).length === 1, "");
check("A + B: jobs settled done/sent", await jobFor(fxA.id).then((j) => !!j && j.state === "done" && j.sent === true) && await jobFor(fxB.id).then((j) => !!j && j.state === "done" && j.sent === true), "");
const drain2 = await runSignupFanout249();
check("drain 2 (idempotence): still exactly one confirmation each", (await sentFor(fxA.id, "signup_confirmation")).length === 1 && (await sentFor(fxB.id, "signup_confirmation")).length === 1, JSON.stringify(drain2));

// Racing drains: two drains at the same time, one pending job.
const fxR = await claimCreator("race249r", "race249r@fixtures.dev");
check("R: quick claim registers 201", fxR.reg.status === 201 && !!fxR.id, `${fxR.reg.status}`);
await Promise.all([runSignupFanout249(), runSignupFanout249()]);
check("R: two racing drains still send exactly one confirmation", (await sentFor(fxR.id, "signup_confirmation")).length === 1, "");

console.log("== D: the auto-decision lands in the drain, not on the request path ==");
const ruleA = await claimCreator("xoxoerinsmith", "xoxoerinsmith@gmail.com", { market: "Richmond" });
check("Rule A: registers 201 and the RESPONSE still reads pending (the decision moved off the path)",
  ruleA.reg.status === 201 && ruleA.reg.data.user.status === "pending", `${ruleA.reg.status}/${ruleA.reg.data && ruleA.reg.data.user && ruleA.reg.data.user.status}`);
check("Rule A: no approval email and no decision event at response time",
  (await sentFor(ruleA.id, "approval")).length === 0 && (await eventsFor(ruleA.id, "application_approved")).length === 0, "");
await runSignupFanout249();
{
  const rec = await store.get(`user:${ruleA.id}`);
  check("Rule A: the drain approved the evidenced claim", !!rec && rec.status === "approved", rec && rec.status);
  check("Rule A: exactly one approval email, and NO confirmation email",
    (await sentFor(ruleA.id, "approval")).length === 1 && (await sentFor(ruleA.id, "signup_confirmation")).length === 0, "");
}

console.log("== E: full-form completion + business confirmation land in the drain ==");
const full = makeClient();
const fullReg = await full("POST", "/api/auth/register", { role: "creator", name: "Full Form 249", email: "full249@fixtures.dev", password: "full249-pass-123", market: "Nashville", city: "Nashville", handle: "full249", primaryPlatform: "instagram", followerCount: 3000, localAudiencePct: 50, categories: ["Food & Drink"], agreedTerms: true, agreedPostCompliance: true, agreedHonestPosts: true, agreedFtcDisclosure: true });
const fullId = fullReg.data && fullReg.data.user && fullReg.data.user.id;
check("full-form: registers 201", fullReg.status === 201 && !!fullId, `${fullReg.status}`);
check("full-form: NO profile_completed event at response time", (await eventsFor(fullId, "profile_completed")).length === 0, "");
const biz = makeClient();
const bizReg = await biz("POST", "/api/auth/register", { role: "business", name: "Bea Owner", email: "bea249@fixtures.dev", password: "bea249-pass-123", businessName: "Bea's Books 249", category: "Retail", market: "Nashville", city: "Nashville", agreedTerms: true });
const bizId = bizReg.data && bizReg.data.user && bizReg.data.user.id;
check("business: registers 201", bizReg.status === 201 && !!bizId, `${bizReg.status}`);
check("business: NO confirmation email at response time", (await sentFor(bizId, "signup_confirmation")).length === 0, "");
await runSignupFanout249();
check("full-form: profile_completed fired exactly once, in the drain", (await eventsFor(fullId, "profile_completed")).length === 1, "");
check("full-form: exactly one confirmation email", (await sentFor(fullId, "signup_confirmation")).length === 1, "");
check("business: exactly one confirmation email, in the drain", (await sentFor(bizId, "signup_confirmation")).length === 1, "");

console.log("== F: failure handling + the gates that must not move ==");
const fxF = await claimCreator("fail249f", "stubfail249f@fixtures.dev");
check("F: failing-send signup registers 201", fxF.reg.status === 201 && !!fxF.id, `${fxF.reg.status}`);
for (let i = 0; i < 5; i += 1) await runSignupFanout249();
check("F: zero confirmations sent to the failing address", (await sentFor(fxF.id, "signup_confirmation")).length === 0, "");
{
  const j = await jobFor(fxF.id);
  check("F: the job parks as failed after 5 attempts, named by an event",
    !!j && j.state === "failed" && (await eventsFor(fxF.id, "signup_fanout_failed")).length === 1, j && j.state);
}
const noAgree = makeClient();
const refused = await noAgree("POST", "/api/auth/register", { role: "creator", quickClaim: true, handle: "noagree249", market: "Nashville", email: "noagree249@fixtures.dev", password: "noagree249-pass-1", agreedTerms: true, followerCount: 2400, localAudiencePct: 55 });
check("gate: a signup without the post agreement is refused, in the new wording",
  refused.status === 400 && /post agreement/i.test(JSON.stringify(refused.data)) && /terms of each offer/i.test(JSON.stringify(refused.data)), `${refused.status} ${JSON.stringify(refused.data).slice(0, 160)}`);
const zero = makeClient();
const zeroReg = await zero("POST", "/api/auth/register", { role: "creator", quickClaim: true, handle: "zero249", market: "Nashville", email: "zero249@fixtures.dev", password: "zero249-pass-123", agreedTerms: true, agreedPostCompliance: true, followerCount: 0, localAudiencePct: 55 });
check("gate: the zero-follower guard still refuses (the -215/-220 validation is intact)",
  zeroReg.status === 400, `${zeroReg.status}`);

console.log(`\nverify-build249: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
