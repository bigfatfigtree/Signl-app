// Build -138 verification: the Admin expansion (Jeff green-lit
// 2026-11-06; spec signl-admin-expansion-spec-2026-11-06.md).
// Six new rooms (Automations, Connections board, Template
// Studio, Marketing, Social, Team & permissions, Learn Studio)
// + GA Website section in Stats + the approval strip on Admin
// Home. Permissions are enforced at the DATA layer: a teammate
// sees only their rooms and their market. Critical mail can
// never be toggled off. Marketing is draft-and-approve with
// frozen recipients and suppression honoured at send time.
// Payments stay OFF.
// Run: node scripts/verify-build138.mjs
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9003;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b138.dev";
const ADMIN_PW = "verify-build138-pass";
const PW = "<MASKED_SECRET_001>";
const VERIFY_TOKEN = "verify138-token";
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const uq = String(Date.now()).slice(-6);

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; failures.push(name); console.error(`FAIL ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const slice = (s, fn, len = 6000) => { const i = s.indexOf(fn); return i < 0 ? "" : s.slice(i, i + len); };

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const notifyJs = fs.readFileSync(path.join(root, "netlify/functions/lib/notify.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const themeCss = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");

// ---------- stamp ----------
// Stamp moved to -140 with the post-139 fix batch (2026-11-06); the
// invariant this check protects is build.js + index.html AGREEING.
check("stamp is current (2026.11.06-140 since the post-138 batch) and identical in build.js + index.html",
  buildJs.includes('BUILD_ID = "2026.11.06-140"') && (indexHtml.match(/2026\.11\.06-140/g) || []).length >= 5);

// ---------- catalogue (unit, from the real lib) ----------
const require2 = createRequire(path.join(root, "netlify/functions/lib/router.js"));
const catalog = require2("./automations-catalog.js");
const perms = require2("./permissions.js");
check("catalogue carries every automated email (55+ entries, unique ids)",
  catalog.ENTRIES.length >= 55 && new Set(catalog.ENTRIES.map((e) => e.id)).size === catalog.ENTRIES.length,
  String(catalog.ENTRIES.length));
check("every deliverEmail kind in the router resolves to a catalogue entry",
  ["approval", "rejection", "password_reset", "signin_link", "team_invite", "silent_removal", "consumed_comp_inactive", "late_streak_pause", "strike_pause", "account_deletion", "signup_confirmation", "profile_completion_reminder", "recruiter_kit", "platform_message", "offer_nudge", "post_performance", "roster_digest", "staff_notice", "post_verified", "clock_started"]
    .every((k) => catalog.entryForKind(k)), "");
// Build -139 (Jeff, 2026-11-06, Item 13): the three role welcome kinds
// joined the critical set — they carry the one-time set-password link
// (same mechanism as signin_link), so they must never be toggleable off.
check("critical kinds are exactly approval / password_reset / signin_link / account_deletion / the three role welcomes (-139)",
  [...catalog.CRITICAL_KINDS].sort().join(",") === "account_deletion,approval,partner_welcome,password_reset,recruiter_welcome,signin_link,team_welcome");
check("campaign_creator template locks the free-forever line and requires {claimLink}",
  (() => { const e = catalog.byId("campaign_creator"); return !!e && (e.requiredTokens || []).includes("claimLink") && String(e.lockedLine || "").includes("SIGNL is free for creators. Always."); })());
check("role templates: money scope appears in NO v1 template; market lead is market-scoped by construction",
  Object.values(perms.ROLE_TEMPLATES).every((t) => !(t.statScopes || []).includes("money")));
check("permissions: a scope-less admin record reads as super (legacy), a templated one does not",
  perms.isSuper({ role: "admin" }) === true && perms.isSuper({ role: "admin", adminPerms: { super: false, flags: { approvals: true }, markets: ["Nashville"], statScopes: [] } }) === false);

// ---------- client wiring (source) ----------
check("client: the six rooms have loaders and renderAdmin branches",
  ["loadAdminAutomations138", "loadAdminMarketing138", "loadAdminSocial138", "loadAdminTeam138", "loadAdminLearn138", "a138TplOpen"].every((f) => appJs.includes(`function ${f}`) || appJs.includes(`async function ${f}`))
  && ["Marketing", "Learn", "Social", "Automations", "Templates", "Team"].every((t) => appJs.includes(`tab === "${t}"`)));
check("client: admin rail carries the new destinations and the permission filter",
  appJs.includes('add("b", "notice", "Marketing"') && appJs.includes('add("b", "star", "Learn"') && appJs.includes('add("b", "play", "Social"')
  && appJs.includes('add("b", "bolt", "Automations"') && appJs.includes('add("b", "deck", "Templates"') && appJs.includes('add("c", "users", "Team"')
  && appJs.includes("adminTabsAllowed138()"));
check("client: Admin Home folds the approval strip into Next steps; Stats grows the Website section",
  appJs.includes("/admin/approval-queue") && appJs.includes("waiting for your approval") && appJs.includes("website-stats138") && appJs.includes("/admin/stats/website"));
check("client: -138 room CSS exists and stacks rows on phones",
  themeCss.includes(".a138-row") && themeCss.includes(".a138-tgl") && themeCss.includes(".a138-photo") && themeCss.includes(".a138-frame")
  && slice(themeCss, "/* ---- Build -138", 6000).includes("@media (max-width: 767.98px)"));

// ---------- server wiring (source) ----------
check("server: the admin gate runs before every admin route and denies by default",
  routerJs.includes("function adminGate138") && routerJs.includes("That room is not part of your role on SIGNL.")
  && slice(routerJs, 'if (seg[0] === "admin") {\n    if (user.role !== "admin")', 800).includes("adminGate138"));
check("server: deliverEmail honours toggles + overrides; critical mail skips both",
  slice(routerJs, "async function deliverEmail", 5200).includes("automation_disabled") && slice(routerJs, "async function deliverEmail", 5200).includes("currentOverride"));
check("server: the notify rail suppresses as suppressed_admin and applies overrides",
  notifyJs.includes("suppressed_admin") && notifyJs.includes("entryForRail"));
check("server: marketing freezes recipients at approval and can never send unapproved",
  routerJs.includes("mc.recipientIds = r.matched.map") && routerJs.includes("An unapproved campaign can never send."));
check("server: Learn publish honours the one-photo rule and the publish lock",
  routerJs.includes("already the face of") && routerJs.includes("learn:publish-lock"));
check("server: team invites are 48h set-password links; revoke kills sessions",
  routerJs.includes("teaminvite:") && routerJs.includes("revokeSessionsForUser") && routerJs.includes('48 * 3600 * 1000'));
check("server: GA read path is env-gated and honest when unconfigured",
  routerJs.includes('state: "not_connected"') || fs.readFileSync(path.join(root, "netlify/functions/lib/analytics-ga.js"), "utf8").includes('state: "not_connected"'));
check("open signup: the unlisted emails carry the new standard — early, building now, first pick to finished profiles, no long wait",
  routerJs.includes("it's building right now") && routerJs.includes("early, not late")
  && routerJs.includes("finished founding profiles are one of the counts that moves a city toward opening")
  && routerJs.includes("first pick of businesses goes to completed founding profiles")
  && !routerJs.includes("opens when sign-ups pile up") && !routerJs.includes("sign-ups there pile up"));
check("open signup: in-app unlisted copy matches (building now, founding circle, no pile-up framing)",
  appJs.includes("is building — and you're early") && appJs.includes("Finish your profile to lock your founding spot")
  && !appJs.includes("opens when sign-ups pile up"));
check("open signup: the demand census + tripwire rule live in the markets payload",
  routerJs.includes("async function cityDemand138") && routerJs.includes("creators: r.claims >= 150")
  && routerJs.includes("completionPct >= 40") && routerJs.includes("flagged: flagsHit >= 2")
  && routerJs.includes('store.list("cityrequest:")'));
check("message by market: demand cities are first-class segments, three channels, SMS honestly dark",
  routerJs.includes("marketingSegmentDefs138Async") && routerJs.includes("spec.demandCity") && routerJs.includes("demandKeyOf138")
  && routerJs.includes("marketingSendPlatform138") && routerJs.includes("smsRailState138")
  && routerJs.includes("Texts switch on when Twilio finishes connecting") && routerJs.includes("not a launch market yet")
  && appJs.includes("a138MkChannel") && appJs.includes("In-app message (creators)"));

// ---------- HTTP: the rooms on real records ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b138-"));
const dbPath = path.join(tmp, "db.json");

// Pre-seed two teammates (scrypt hash computed the auth.js way).
function seedUser({ id, email, name, pw, adminPerms }) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return { id, role: "admin", status: "approved", name, email, passwordSalt: salt, passwordHash: hash, tester: false, createdAt: new Date().toISOString(), adminPerms };
}
const TM_ID = `tm138_${uq}`;
const MK_ID = `mk138_${uq}`;
const seed = {};
seed[`user:${TM_ID}`] = seedUser({ id: TM_ID, email: `tm138_${uq}@fixtures.dev`, name: "Tess Teammate", pw: PW, adminPerms: { super: false, flags: { approvals: true, "creators.view": true, outreach: true }, markets: ["Nashville"], statScopes: [], template: "outreach_rep", grantedBy: "seed", grantedAt: new Date().toISOString() } });
seed[`email:tm138_${uq}@fixtures.dev`] = { userId: TM_ID };
seed[`user:${MK_ID}`] = seedUser({ id: MK_ID, email: `mk138_${uq}@fixtures.dev`, name: "Marta Marketer", pw: PW, adminPerms: { super: false, flags: { "marketing.draft": true, "marketing.approve": true }, markets: null, statScopes: [], template: null, grantedBy: "seed", grantedAt: new Date().toISOString() } });
seed[`email:mk138_${uq}@fixtures.dev`] = { userId: MK_ID };
// Open-signup demand seeds: Flagtown crosses all three
// tripwires (150 claimed creators with finished profiles + a
// business application); Smalltown stays under every wire.
// Pending status keeps them out of the marketing segment math.
for (let i = 0; i < 150; i++) {
  const id = `flag${i}_${uq}`;
  seed[`user:${id}`] = { id, role: "creator", status: "pending", name: `Flag Creator ${i}`, email: `flag${i}_${uq}@fixtures.dev`, market: "Not listed yet", city: "Flagtown", state: "TX", country: "United States", tester: false, createdAt: new Date().toISOString(), creator: { handle: `flag${i}_${uq}`, followerCount: 4000, localAudiencePct: 60, categories: ["Food & Drink"], tierBand: "Locals" } };
  seed[`email:flag${i}_${uq}@fixtures.dev`] = { userId: id };
}
seed[`user:flagbiz_${uq}`] = { id: `flagbiz_${uq}`, role: "business", status: "pending", name: "Flag Biz", email: `flagbiz_${uq}@fixtures.dev`, market: "Not listed yet", city: "Flagtown", state: "TX", country: "United States", tester: false, createdAt: new Date().toISOString(), business: { businessName: "Flagtown Tacos" } };
seed[`email:flagbiz_${uq}@fixtures.dev`] = { userId: `flagbiz_${uq}` };
for (let i = 0; i < 2; i++) {
  const id = `small${i}_${uq}`;
  seed[`user:${id}`] = { id, role: "creator", status: "pending", name: `Small Creator ${i}`, email: `small${i}_${uq}@fixtures.dev`, market: "Not listed yet", city: "Smalltown", state: "TX", country: "United States", tester: false, createdAt: new Date().toISOString(), creator: { handle: `small${i}_${uq}`, followerCount: 300 } };
  seed[`email:small${i}_${uq}@fixtures.dev`] = { userId: id };
}
// Message-by-market seeds (Jeff, 2026-11-06): Tulsa, Oklahoma —
// an unlisted typed city with three approved, profile-complete
// creators and one pending, unfinished claim. The Markets
// census counts all four claims; Marketing segments match the
// three approved.
const TUL = [];
for (let i = 0; i < 3; i++) {
  const id = `tul${i}_${uq}`;
  TUL.push({ id, email: `tul${i}_${uq}@fixtures.dev` });
  seed[`user:${id}`] = { id, role: "creator", status: "approved", name: `Tulsa Creator ${i}`, email: `tul${i}_${uq}@fixtures.dev`, market: "Not listed yet", city: "Tulsa", state: "OK", country: "United States", tester: false, createdAt: new Date().toISOString(), creator: { handle: `tul${i}_${uq}`, followerCount: 3000, localAudiencePct: 70, categories: ["Food & Drink"], tierBand: "Locals" } };
  seed[`email:tul${i}_${uq}@fixtures.dev`] = { userId: id };
}
seed[`user:tulpend_${uq}`] = { id: `tulpend_${uq}`, role: "creator", status: "pending", name: "Tulsa Pending", email: `tulpend_${uq}@fixtures.dev`, market: "Not listed yet", city: "Tulsa", state: "OK", country: "United States", tester: false, createdAt: new Date().toISOString(), creator: { handle: `tulpend_${uq}`, followerCount: 300 } };
seed[`email:tulpend_${uq}@fixtures.dev`] = { userId: `tulpend_${uq}` };
fs.writeFileSync(dbPath, JSON.stringify(seed));

const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbPath, SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD: ADMIN_PW, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_VERIFY_TOKEN: VERIFY_TOKEN };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES", "GA4_PROPERTY_ID", "GA_SERVICE_ACCOUNT_JSON"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: "ignore" });

function client() {
  const jar = new Map();
  return async function api(method, p, body, headers2 = {}) {
    const headers = { "Content-Type": "application/json", ...headers2 };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let d = null;
    try { d = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data: d, text };
  };
}
const readDb = () => JSON.parse(fs.readFileSync(dbPath, "utf8"));
const dbEvents = (type, pred) => Object.values(readDb()).filter((v) => v && v.type === type && (!pred || pred(v)));
const dbKeys = (prefix, pred) => Object.entries(readDb()).filter(([k, v]) => k.startsWith(prefix) && v && (!pred || pred(v)));

try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { const r = await fetch(BASE + "/api/bootstrap"); up = r.status > 0; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  check("dev server boots", up);

  const boot = await client()("GET", "/api/bootstrap");
  const pays = (boot.data && (boot.data.payments || (boot.data.boot && boot.data.boot.payments))) || {};
  check("payments stay OFF in the boot payload", pays.connectLive === false && pays.billingLive === false, JSON.stringify(pays));

  const admin = client();
  const alogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin logs in", alogin.status === 200, String(alogin.status));
  const approve = (id) => admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  const regCreator = async (tag, market, name) => {
    const c = client();
    const city = market === "Nashville" ? "Nashville" : "Norfolk";
    const r = await c("POST", "/api/auth/register", { role: "creator", name, email: `${tag}${uq}@fixtures.dev`, password: PW, market, city, handle: `${tag}${uq}`, categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 4000, avgViews: 1200, localAudiencePct: 66, ...AGREE });
    return { client: c, id: r.data && r.data.user && r.data.user.id, email: `${tag}${uq}@fixtures.dev` };
  };

  // Two pending creators: one in the teammate's market, one not.
  const nash = await regCreator("nash138", "Nashville", "Nash Pending");
  const hr = await regCreator("hr138", "Hampton Roads", "Hampton Pending");
  check("fixtures: Nashville + Hampton Roads creators pending", !!(nash.id && hr.id));

  // ---- teammate scope (data layer) ----
  const tm = client();
  const tlogin = await tm("POST", "/api/auth/login", { email: `tm138_${uq}@fixtures.dev`, password: PW });
  check("teammate logs in with the seeded role", tlogin.status === 200 && tlogin.data.user && tlogin.data.user.adminPerms && tlogin.data.user.adminPerms.template === "outreach_rep", `${tlogin.status}`);
  const tmApps = await tm("GET", "/api/admin/applications");
  const tmAppsText = JSON.stringify(tmApps.data || {});
  check("teammate sees the Nashville application and NOT the Hampton Roads one",
    tmApps.status === 200 && tmAppsText.includes("Nash Pending") && !tmAppsText.includes("Hampton Pending"), `${tmApps.status}`);
  check("teammate is refused the rooms outside their role (automations, team, marketing, stats website)",
    (await tm("GET", "/api/admin/automations")).status === 403
    && (await tm("GET", "/api/admin/team")).status === 403
    && (await tm("GET", "/api/admin/marketing")).status === 403
    && (await tm("GET", "/api/admin/stats/website")).status === 403);
  const tmReviewOut = await tm("POST", "/api/admin/review", { userId: hr.id, decision: "approve" });
  check("teammate cannot decide an application outside their markets, even by id",
    tmReviewOut.status === 403, `${tmReviewOut.status} ${JSON.stringify(tmReviewOut.data).slice(0, 140)}`);
  const tmSearch = await tm("GET", `/api/admin/users/search?q=${encodeURIComponent(hr.email)}`);
  check("teammate cannot find the out-of-market creator even by exact email",
    tmSearch.status === 200 && !JSON.stringify(tmSearch.data || {}).includes("Hampton Pending"), `${tmSearch.status} ${JSON.stringify(tmSearch.data).slice(0, 160)}`);

  // ---- automations: toggle suppresses, critical never toggles ----
  const auto = await admin("GET", "/api/admin/automations");
  const flat = (auto.data.groups || []).flatMap((g) => g.entries || []);
  check("automations room lists the catalogue with honest states",
    auto.status === 200 && flat.length >= 55
    && flat.find((e) => e.id === "signup_confirmation")?.state === "on"
    && flat.find((e) => e.id === "approval")?.state === "always_on", `${auto.status} ${flat.length}`);
  const tglOff = await admin("POST", "/api/admin/automations/signup_confirmation/toggle", { on: false });
  check("toggle off accepted for a non-critical automation", tglOff.status === 200 && tglOff.data.state === "off", `${tglOff.status}`);
  const c1 = await regCreator("supp138", "Nashville", "Supp One");
  const supEvents = dbEvents("signup_confirmation_email_not_sent", (e) => e.subjectId === c1.id);
  check("with the toggle off, the signup email is suppressed with the reason on the event",
    supEvents.length >= 1 && supEvents[0].data && supEvents[0].data.reason === "automation_disabled"
    && dbEvents("signup_confirmation_email_sent", (e) => e.subjectId === c1.id).length === 0, JSON.stringify(supEvents[0] || {}).slice(0, 200));
  await admin("POST", "/api/admin/automations/signup_confirmation/toggle", { on: true });
  const c2 = await regCreator("live138", "Nashville", "Live Two");
  check("toggle back on: the next signup email flows",
    dbEvents("signup_confirmation_email_sent", (e) => e.subjectId === c2.id).length >= 1);
  const crit = await admin("POST", "/api/admin/automations/approval/toggle", { on: false });
  check("the approval email REFUSES to toggle off", crit.status === 400, `${crit.status} ${JSON.stringify(crit.data).slice(0, 120)}`);
  await approve(c2.id);
  check("critical mail still flows: approving a creator sends the approval email",
    dbEvents("approval_email_sent", (e) => e.subjectId === c2.id).length >= 1);
  const fence = await admin("POST", "/api/admin/automations/signup_confirmation/test", { to: "someone@else.dev" });
  const ownTest = await admin("POST", "/api/admin/automations/signup_confirmation/test", { to: ADMIN_EMAIL });
  check("test sends are fenced to the admin's own inbox", fence.status === 403 && ownTest.status === 200 && ownTest.data.sent === true, `${fence.status}/${ownTest.status}`);

  // ---- templates: override applies, tokens guard, rollback works ----
  const subj = await admin("POST", "/api/admin/templates/signup_confirmation/versions", { subject: "Welcome aboard, {firstName}", note: "138 test" });
  check("a subject-only override saves on a subject-level template", subj.status === 200 && subj.data.template && subj.data.template.currentVersion >= 1, `${subj.status} ${JSON.stringify(subj.data).slice(0, 160)}`);
  const c3 = await regCreator("ovr138", "Nashville", "Casey Three");
  const q3 = dbEvents("signup_confirmation_email_queued", (e) => e.subjectId === c3.id);
  check("the override subject is what actually gets queued for the next signup",
    q3.length >= 1 && q3[0].data && q3[0].data.subject === "Welcome aboard, Casey", String(JSON.stringify(q3[0] && q3[0].data)).slice(0, 200));
  const guard = await admin("POST", "/api/admin/templates/campaign_creator/versions", { subject: "Hi", text: "No link in this one." });
  check("saving campaign_creator without {claimLink} is refused, naming the piece",
    guard.status === 400 && /claimLink/.test(guard.data.error || ""), `${guard.status} ${JSON.stringify(guard.data).slice(0, 160)}`);
  const goodSave = await admin("POST", "/api/admin/templates/campaign_creator/versions", { subject: "Your SIGNL invite", text: "Hi {firstName},\n\nClaim your page: {claimLink}\n\nSIGNL is free for creators. Always." });
  const vNow = goodSave.data && goodSave.data.template && goodSave.data.template.currentVersion;
  const badRollback = await admin("POST", "/api/admin/templates/campaign_creator/rollback", { version: 99 });
  check("a good save lands; rolling back to a version that doesn't exist is refused",
    goodSave.status === 200 && badRollback.status === 400, `${goodSave.status}/${badRollback.status} v=${vNow}`);
  const tplDetail = await admin("GET", "/api/admin/templates/campaign_creator");
  check("template detail preview shows the saved wording",
    tplDetail.status === 200 && tplDetail.data.preview && tplDetail.data.preview.text.includes("Claim your page:"), `${tplDetail.status}`);

  // ---- the notify rail: override + suppression on a real booking ----
  const bz = client();
  const breg = await bz("POST", "/api/auth/register", { role: "business", name: "Owner", email: `b138biz${uq}@fixtures.dev`, password: PW, market: "Hampton Roads", city: "Norfolk", businessName: `Rail Tacos ${uq}`, category: "Restaurant", planId: "self-service", agreedTerms: true });
  const bizId = breg.data && breg.data.user && breg.data.user.id;
  await approve(bizId);
  await admin("POST", "/api/admin/businesses/activate", { userId: bizId });
  const dcr = await regCreator("rail138", "Hampton Roads", "Rail Creator");
  await approve(dcr.id);
  await dcr.client("PATCH", "/api/me/profile", { paidRate: 120 });
  const mkDeal = async () => {
    // The paid_booking_received milestone (which fires the
    // creator_booked rail notification) rides the direct paid
    // booking path.
    const r = await bz("POST", "/api/bookings/paid", { creatorId: dcr.id });
    return r.status;
  };
  const outboxFor = () => dbKeys("notifyoutbox:", (v) => v.eventType === "creator_booked");
  const bk1 = await mkDeal();
  check("direct paid booking 1 lands (baseline rail send)", bk1 === 201, String(bk1));
  const ob1 = outboxFor();
  check("the booking wrote creator_booked outbox rows (not suppressed)",
    ob1.length >= 1 && ob1.every(([, v]) => v.status !== "suppressed_admin"), JSON.stringify(ob1.map(([, v]) => v.status)));
  await admin("POST", "/api/admin/templates/creator_booked/versions", { text: "OVERRIDE138 your visit is booked" });
  check("direct paid booking 2 lands with the rail override live", (await mkDeal()) === 201);
  const ob2 = dbKeys("notifyoutbox:", (v) => v.eventType === "creator_booked" && JSON.stringify(v).includes("OVERRIDE138"));
  check("the rail override text is what the booking notification carries", ob2.length >= 1, `${ob2.length}`);
  const railTgl = await admin("POST", "/api/admin/automations/creator_booked/toggle", { on: false });
  check("a pref-gated rail automation CAN be switched off by an admin (the person's own setting is a separate gate)", railTgl.status === 200, `${railTgl.status} ${JSON.stringify(railTgl.data).slice(0, 120)}`);
  check("direct paid booking 3 lands with the rail automation off", (await mkDeal()) === 201);
  const ob3 = dbKeys("notifyoutbox:", (v) => v.eventType === "creator_booked" && v.status === "suppressed_admin");
  check("with the toggle off, the booking notification is suppressed_admin in the outbox", ob3.length >= 1, `${ob3.length}`);
  await admin("POST", "/api/admin/automations/creator_booked/toggle", { on: true });

  // ---- connections board honesty ----
  const conn = await admin("GET", "/api/admin/connections");
  const rows = Object.fromEntries((conn.data.rows || []).map((r) => [r.id, r]));
  check("connections: Twilio A2P is a dated NOTE, Stripe billing reads its live OFF state",
    conn.status === 200 && rows.twilio_a2p && rows.twilio_a2p.source === "note" && rows.twilio_a2p.asOf === "2026-11-05"
    && rows.stripe_billing && /Off/.test(rows.stripe_billing.state), JSON.stringify(rows.stripe_billing || {}).slice(0, 160));
  await admin("POST", "/api/admin/connections/klaviyo/note", { text: "Checked in the 138 suite" });
  const conn2 = await admin("GET", "/api/admin/connections");
  const klav = (conn2.data.rows || []).find((r) => r.id === "klaviyo");
  check("a staffer note round-trips onto the board with today's date",
    !!klav && klav.note && klav.note.text === "Checked in the 138 suite" && /^\d{4}-\d{2}-\d{2}$/.test(klav.note.asOf || ""), JSON.stringify(klav || {}).slice(0, 200));

  // ---- GA website section: honest not-connected state ----
  const ga = await admin("GET", "/api/admin/stats/website");
  check("website section ships honest: not connected, no invented numbers",
    ga.status === 200 && ga.data.connected === false && ga.data.state === "not_connected" && ga.data.totals === undefined
    && /aren't connected yet/.test(ga.data.note || ""), `${ga.status} ${JSON.stringify(ga.data).slice(0, 200)}`);

  // ---- marketing: draft -> approve (no self-approve) -> frozen send, suppression honoured ----
  await approve(c3.id); // now approved creators: c2, c3, dcr (the rail creator)
  const segCount = await admin("POST", "/api/admin/marketing/segment-count", { segment: { audience: "creators" } });
  // Every approved creator in the fixture world: the three suite
  // creators plus the three approved Tulsa creators seeded below.
  check("segment count sees every approved creator before suppression", segCount.data.count === 6, `${segCount.data && segCount.data.count}`);
  const mk = client();
  await mk("POST", "/api/auth/login", { email: `mk138_${uq}@fixtures.dev`, password: PW });
  const draft = await mk("POST", "/api/admin/marketing/campaigns", { segment: { audience: "creators" }, subject: "138 suite hello {firstName}", text: "Hi {firstName},\n\nA short note from the suite." });
  const campId = draft.data && draft.data.campaign && draft.data.campaign.id;
  check("marketer drafts a campaign", draft.status === 201 && !!campId, `${draft.status}`);
  const earlySend = await mk("POST", `/api/admin/marketing/campaigns/${campId}/send`, {});
  await mk("POST", `/api/admin/marketing/campaigns/${campId}/submit`, {});
  const selfApprove = await mk("POST", `/api/admin/marketing/campaigns/${campId}/approve`, {});
  check("an unapproved campaign can never send, and the author cannot approve their own draft",
    earlySend.status === 400 && selfApprove.status === 400, `${earlySend.status}/${selfApprove.status} ${String(JSON.stringify(selfApprove.data)).slice(0, 140)}`);
  const supApprove = await admin("POST", `/api/admin/marketing/campaigns/${campId}/approve`, {});
  check("Jeff approves: recipients freeze at the segment count",
    supApprove.status === 200 && supApprove.data.campaign.recipientCount === segCount.data.count, `${supApprove.status} ${supApprove.data && supApprove.data.campaign && supApprove.data.campaign.recipientCount} vs ${segCount.data && segCount.data.count}`);
  // Suppression lands AFTER the freeze: the send must drop her.
  await admin("POST", "/api/admin/marketing/suppression", { email: c2.email });
  const sent = await admin("POST", `/api/admin/marketing/campaigns/${campId}/send`, {});
  check("the send delivers the frozen list minus anyone suppressed since approval",
    sent.status === 200 && sent.data.campaign.results.sent === segCount.data.count - 1 && sent.data.campaign.results.failed === 0 && sent.data.campaign.results.excluded === 1,
    `${sent.status} ${JSON.stringify(sent.data && sent.data.campaign && sent.data.campaign.results)}`);
  const mkRows = dbKeys("mkrecipient:", (v) => v.campaignId === campId);
  check("recipient records tell the story: the suppressed creator is 'excluded', never emailed",
    mkRows.length === segCount.data.count && !mkRows.some(([, v]) => v.userId === c2.id && v.status === "sent")
    && mkRows.some(([, v]) => v.userId === c2.id && v.status === "excluded"), `${mkRows.length} rows`);

  // ---- message by market: Tulsa (unlisted typed city) on email + in-app; SMS honestly dark ----
  const mkBoard = await admin("GET", "/api/admin/marketing");
  const tulsaDef = (mkBoard.data.segments || []).find((s) => s.spec && s.spec.demandCity && (s.label || "").includes("Tulsa"));
  check("the demand city is a selectable audience with its true count, and the SMS state rides the payload honestly",
    !!tulsaDef && tulsaDef.count === 3 && mkBoard.data.sms && mkBoard.data.sms.connected === false && /Twilio/.test(mkBoard.data.sms.note || ""),
    `${tulsaDef && tulsaDef.count} ${JSON.stringify(mkBoard.data.sms || {})}`);
  const tulsaSpec = tulsaDef.spec;
  const tulCount = await admin("POST", "/api/admin/marketing/segment-count", { segment: tulsaSpec });
  check("segment-count resolves the typed city (approved creators only — the pending claim is not messaged)",
    tulCount.status === 200 && tulCount.data.count === 3, `${tulCount.status} ${tulCount.data && tulCount.data.count}`);
  const mktsT = await admin("GET", "/api/admin/markets");
  const tulsaRow = ((mktsT.data && mktsT.data.demand) || []).find((r) => r.city === "Tulsa");
  check("the same Tulsa is one counted row in the Markets census: 4 claims, 75% finished profiles",
    !!tulsaRow && tulsaRow.claims === 4 && tulsaRow.completionPct === 75, JSON.stringify(tulsaRow || {}).slice(0, 220));
  // Email: the launch note to exactly one city.
  const tulDraft = await mk("POST", "/api/admin/marketing/campaigns", { segment: tulsaSpec, channel: "email", subject: "Tulsa — your city is opening", text: "Hi {firstName},\n\nTulsa is opening, and founding creators hear first. Your finished profile puts you in the founding circle, with first pick of businesses." });
  const tulCamp = tulDraft.data.campaign.id;
  await mk("POST", `/api/admin/marketing/campaigns/${tulCamp}/submit`, {});
  const tulApprove = await admin("POST", `/api/admin/marketing/campaigns/${tulCamp}/approve`, {});
  check("the Tulsa email campaign approves with the city frozen at 3",
    tulApprove.status === 200 && tulApprove.data.campaign.recipientCount === 3, `${tulApprove.status} ${tulApprove.data && tulApprove.data.campaign && tulApprove.data.campaign.recipientCount}`);
  await admin("POST", "/api/admin/marketing/suppression", { email: TUL[2].email });
  const tulSent = await admin("POST", `/api/admin/marketing/campaigns/${tulCamp}/send`, {});
  check("the launch note emails the frozen city list minus the creator suppressed since approval",
    tulSent.status === 200 && tulSent.data.campaign.results.sent === 2 && tulSent.data.campaign.results.excluded === 1 && tulSent.data.campaign.results.channel === "email",
    `${tulSent.status} ${JSON.stringify(tulSent.data && tulSent.data.campaign && tulSent.data.campaign.results)}`);
  // In-app: the same city through the platform-message rail.
  const pmDraft = await mk("POST", "/api/admin/marketing/campaigns", { segment: tulsaSpec, channel: "platform", text: "Hi {firstName} — Tulsa, your city is opening. Founding circle, first pick: your finished profile already locked your spot." });
  const pmCamp = pmDraft.data.campaign.id;
  await mk("POST", `/api/admin/marketing/campaigns/${pmCamp}/submit`, {});
  const pmApprove = await admin("POST", `/api/admin/marketing/campaigns/${pmCamp}/approve`, {});
  check("the in-app campaign freezes the city at 2 (one already suppressed)",
    pmApprove.status === 200 && pmApprove.data.campaign.recipientCount === 2, `${pmApprove.status} ${pmApprove.data && pmApprove.data.campaign && pmApprove.data.campaign.recipientCount}`);
  await admin("POST", "/api/admin/marketing/suppression", { email: TUL[1].email });
  const pmSent = await admin("POST", `/api/admin/marketing/campaigns/${pmCamp}/send`, {});
  check("the in-app send honours suppression at send time, same as email",
    pmSent.status === 200 && pmSent.data.campaign.results.sent === 1 && pmSent.data.campaign.results.excluded === 1 && pmSent.data.campaign.results.channel === "platform",
    `${pmSent.status} ${JSON.stringify(pmSent.data && pmSent.data.campaign && pmSent.data.campaign.results)}`);
  const thread = await admin("GET", `/api/admin/platform-messages?creatorId=${TUL[0].id}`);
  check("the message sits in the creator's own SIGNL thread, tokens filled",
    thread.status === 200 && (thread.data.messages || []).some((m) => (m.body || "").includes("your city is opening") && (m.body || "").startsWith("Hi Tulsa")),
    `${thread.status} ${(thread.data.messages || []).length}`);
  const pmRows = dbKeys("mkrecipient:", (v) => v.campaignId === pmCamp);
  check("in-app recipient records carry the platform channel and the same exclusion story",
    pmRows.length === 2 && pmRows.every(([, v]) => v.channel === "platform")
    && pmRows.some(([, v]) => v.userId === TUL[0].id && v.status === "sent")
    && pmRows.some(([, v]) => v.userId === TUL[1].id && v.status === "excluded"), `${pmRows.length} rows`);
  const pmBiz = await mk("POST", "/api/admin/marketing/campaigns", { segment: { audience: "businesses" }, channel: "platform", text: "Hello businesses" });
  check("in-app campaigns refuse non-creator audiences in plain words",
    pmBiz.status === 400 && /creators/.test((pmBiz.data && pmBiz.data.error) || ""), `${pmBiz.status} ${JSON.stringify(pmBiz.data || {}).slice(0, 140)}`);
  // SMS: audience + draft + approval are real; the send refuses honestly.
  const smsDraft = await mk("POST", "/api/admin/marketing/campaigns", { segment: tulsaSpec, channel: "sms", text: "Tulsa — your city is opening. Founding circle, first pick." });
  const smsCamp = smsDraft.data.campaign.id;
  await mk("POST", `/api/admin/marketing/campaigns/${smsCamp}/submit`, {});
  const smsApprove = await admin("POST", `/api/admin/marketing/campaigns/${smsCamp}/approve`, {});
  const smsSend = await admin("POST", `/api/admin/marketing/campaigns/${smsCamp}/send`, {});
  const smsAfter = await admin("GET", `/api/admin/marketing/campaigns/${smsCamp}`);
  check("a text campaign builds and approves for real, but sending refuses with the honest Twilio state — nothing faked, nothing sent",
    smsDraft.status === 201 && smsApprove.status === 200 && smsApprove.data.campaign.recipientCount === 1
    && smsSend.status === 400 && /Twilio/.test((smsSend.data && smsSend.data.error) || "")
    && smsAfter.data.campaign.status === "approved",
    `${smsDraft.status}/${smsApprove.status}/${smsSend.status} ${JSON.stringify(smsSend.data || {}).slice(0, 160)}`);

  // ---- social: seeded ledger + draft -> approve -> queue ----
  const soc = await admin("GET", "/api/admin/social");
  const ig = (soc.data.channels || []).find((c) => c.platform === "instagram");
  check("social ledger carries the imported posts with unreported metrics kept null",
    soc.status === 200 && ig && ig.totals.posts >= 9 && ig.totals.unreported >= 1, `${soc.status} ${JSON.stringify(ig && ig.totals)}`);
  const sd = await admin("POST", "/api/admin/social/drafts", { platform: "instagram", text: "138 suite draft post" });
  const sApprove = await admin("POST", `/api/admin/social/drafts/${sd.data.draft.id}/approve`, {});
  const soc2 = await admin("GET", "/api/admin/social");
  check("a social draft approves into the post queue (nothing posts itself)",
    sApprove.status === 200 && (soc2.data.queued || []).some((p) => (p.text || "").includes("138 suite draft post")), `${sApprove.status}`);

  // ---- learn studio: seed integrity, photo guard, publish pipeline ----
  const learn = await admin("GET", "/api/admin/learn");
  check("learn studio opens on the real magazine: 50 articles, unique heroes, pool present",
    learn.status === 200 && (learn.data.articles || []).length === 50 && (learn.data.photos || []).length >= 50
    && learn.data.photoUsedBy && learn.data.photoUsedBy["register-tap.jpg"] === "net-90-is-not-a-payment-term",
    `${learn.status} ${learn.data && (learn.data.articles || []).length}`);
  const clash = await admin("POST", "/api/admin/learn/drafts", { headline: `Clash piece ${uq}`, dek: "d", lede: "l", sections: [{ heading: "H", paragraphs: ["P"] }], heroImage: "register-tap.jpg", topic: "rates-and-pay", audience: "creators" });
  const clashPub = await admin("POST", "/api/admin/learn/publish", { draftId: clash.data.draft.id });
  check("publishing with another article's hero photo is refused, naming the rule",
    clashPub.status === 400 && /already the face of|its own photo/.test(clashPub.data.error || ""), `${clashPub.status} ${JSON.stringify(clashPub.data).slice(0, 160)}`);
  const usedSet = new Set(Object.keys(learn.data.photoUsedBy || {}));
  const freePhoto = (learn.data.photos || []).find((p) => !usedSet.has(p));
  const okDraft = await admin("POST", "/api/admin/learn/drafts", { headline: `Suite story ${uq}`, dek: "A dek", lede: "A lede", sections: [{ heading: "First", paragraphs: ["Body text."] }], heroImage: freePhoto, topic: "rates-and-pay", audience: "creators" });
  const okPub = await admin("POST", "/api/admin/learn/publish", { draftId: okDraft.data.draft.id });
  const jobId = okPub.data && okPub.data.job && okPub.data.job.id;
  check("a clean draft queues a publish job", okPub.status === 202 && !!jobId, `${okPub.status}`);
  const jobs = await admin("GET", "/api/internal/learn-jobs", undefined, { "x-signl-verify-token": VERIFY_TOKEN });
  const claim1 = await admin("POST", `/api/internal/learn-jobs/${jobId}/claim`, {}, { "x-signl-verify-token": VERIFY_TOKEN });
  const freePhoto2 = (learn.data.photos || []).find((p) => !usedSet.has(p) && p !== freePhoto);
  const okDraft2 = await admin("POST", "/api/admin/learn/drafts", { headline: `Suite story two ${uq}`, dek: "d", lede: "l", sections: [{ heading: "H", paragraphs: ["P"] }], heroImage: freePhoto2, topic: "local-marketing", audience: "businesses" });
  const okPub2 = await admin("POST", "/api/admin/learn/publish", { draftId: okDraft2.data.draft.id });
  const claim2 = await admin("POST", `/api/internal/learn-jobs/${okPub2.data.job.id}/claim`, {}, { "x-signl-verify-token": VERIFY_TOKEN });
  check("the internal queue is token-gated and the publish lock holds for a second job",
    jobs.status === 200 && (jobs.data.jobs || []).some((j) => j.id === jobId) && claim1.data.ok === true
    && okPub2.status === 202 && claim2.data.ok === false && claim2.data.locked === true, `${jobs.status}/${okPub2.status}/${JSON.stringify(claim2.data).slice(0, 120)}`);
  const result = await admin("POST", `/api/internal/learn-jobs/${jobId}/result`, { ok: true, url: `https://joinsignl.com/learn/suite-story-${uq}.html` }, { "x-signl-verify-token": VERIFY_TOKEN });
  const learn2 = await admin("GET", "/api/admin/learn");
  check("reporting the publish result lands the article in the live registry and publishes the draft",
    result.status === 200 && (learn2.data.articles || []).some((a) => a.slug === `suite-story-${uq}`)
    && (learn2.data.drafts || []).find((d) => d.id === okDraft.data.draft.id)?.status === "published", `${result.status}`);
  const noToken = await client()("GET", "/api/internal/learn-jobs");
  check("the internal learn endpoints refuse calls without the verify token", noToken.status === 403, `${noToken.status}`);

  // ---- approval queue + team lifecycle ----
  const aq = await admin("GET", "/api/admin/approval-queue");
  check("approval queue counts the waiting applications in scope",
    aq.status === 200 && aq.data.applications >= 2, `${aq.status} ${JSON.stringify(aq.data).slice(0, 160)}`);
  const revoke = await admin("POST", `/api/admin/team/${TM_ID}/revoke`, {});
  const tmAfter = await tm("GET", "/api/admin/applications");
  check("revoking a teammate ends their access immediately (sessions killed)",
    revoke.status === 200 && (tmAfter.status === 401 || tmAfter.status === 403), `${revoke.status}/${tmAfter.status}`);

  // ---- open signup everywhere: unlisted end-to-end + demand ----
  const unl = client();
  const ureg = await unl("POST", "/api/auth/register", { role: "creator", name: "Minnieapolis", email: `mpls138_${uq}@fixtures.dev`, password: PW, market: "Not listed yet", customCity: "Fargo", customState: "ND", customCountry: "United States", handle: `mpls138_${uq}`, categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 4000, avgViews: 1200, localAudiencePct: 55, ...AGREE });
  const unlId = ureg.data && ureg.data.user && ureg.data.user.id;
  check("an unlisted-city creator completes a FULL sign-up (no stub, no lesser record)",
    ureg.status === 201 && !!unlId && ureg.data.user.market === "Not listed yet" && ureg.data.user.city === "Fargo"
    && dbEvents("signup_confirmation_email_sent", (e) => e.subjectId === unlId).length >= 1,
    `${ureg.status} ${JSON.stringify(ureg.data).slice(0, 200)}`);
  await approve(unlId);
  check("the unlisted creator approves like anyone (approval email flows)",
    dbEvents("approval_email_sent", (e) => e.subjectId === unlId).length >= 1);
  const mkts = await admin("GET", "/api/admin/markets");
  const demand = (mkts.data && mkts.data.demand) || [];
  const mpls = demand.find((d) => d.city === "Fargo");
  const flag = demand.find((d) => d.city === "Flagtown");
  const small = demand.find((d) => d.city === "Smalltown");
  check("the demand section ranks unlisted cities with claims, completion, followers and supply on one row",
    !!mpls && mpls.claims === 1 && mpls.completionPct === 100 && mpls.followers >= 4000 && mpls.avgLocalPct === 55 && mpls.flagged === false,
    JSON.stringify(mpls || {}).slice(0, 220));
  check("the tripwire flag fires at 2-of-3 (Flagtown: 150 creators + 100% finished + a business application)",
    !!flag && flag.claims === 150 && flag.businessApplications === 1 && flag.flagsHit === 3 && flag.flagged === true,
    JSON.stringify(flag || {}).slice(0, 220));
  check("a small unlisted city stays unflagged (Smalltown: 2 claims, unfinished profiles, no supply)",
    !!small && small.claims === 2 && small.flagsHit === 0 && small.flagged === false, JSON.stringify(small || {}).slice(0, 220));
  check("flagged cities sort first in the demand list", demand.length >= 3 && demand[0].city === "Flagtown", demand.map((d) => d.city).join(","));

  console.log(`\nBuild -138 verify: ${passed} passed, ${failed} failed`);
  if (failures.length) console.error("Failures:\n - " + failures.join("\n - "));
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error("SUITE ERROR", e);
  process.exitCode = 1;
} finally {
  server.kill("SIGKILL");
}
