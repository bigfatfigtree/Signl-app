#!/usr/bin/env node
// Build -187 fixture suite: signup UX polish.
// Jeff (2026-11-16) signed up Tropical Oasis as a national
// business and landed on what read as the account settings page:
// renderBusinessFoundingStatus appended the full accountHtml
// panel (signed-in-as, change-password form, delete my account)
// under the pending status card. This suite pins the fix:
//  - source: no register handler routes to Account/Settings, and
//    the pending landings carry no account-settings form;
//  - serialized views: the REAL landing renderers, evaluated
//    with the API-returned users from fresh registrations,
//    produce the welcome / what-happens-next state per role and
//    never the account view;
//  - API: all three signup flows (creator quick + full, market
//    business, national business, conversation business) still
//    register as pending records with unchanged rules.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8947;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify187-admin-pass";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "signl-verify187-"));
const DB = path.join(TMP, "db.json");

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const seg = (src, a, b) => { const i = src.indexOf(a); if (i < 0) return ""; const j = b ? src.indexOf(b, i + a.length) : -1; return src.slice(i, j > i ? j : undefined); };

// ---------------- source pins ----------------
console.log("== source: build stamp ==");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
check("BUILD_ID is 2026.11.16-187", buildJs.includes('exports.BUILD_ID = "2026.11.16-187"'));
check("shell stamp is 2026.11.16-187 (4 refs)", (indexHtml.match(/2026\.11\.16-187/g) || []).length === 4 && indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.16-187"'));

console.log("== source: the landing defect is gone ==");
const fbzSeg = seg(appJs, "function renderBusinessFoundingStatus()", "// ---------- founding business preview");
check("founding status renderer exists", fbzSeg.length > 500);
check("founding status does NOT append accountHtml", !fbzSeg.includes("accountHtml("), "accountHtml still called in the pending business landing");
check("founding status carries no Change password / Delete my account", !fbzSeg.includes("Change password") && !fbzSeg.includes("Delete my account"));
check("founding status is a welcome state (pending-home + Welcome to Magpie)", fbzSeg.includes('id="pending-home"') && fbzSeg.includes("Welcome to Magpie"));
check("founding status explains what happens next + what you can do now", fbzSeg.includes("What happens next") && fbzSeg.includes("What you can do now"));
check("founding status keeps a one-line signed-in-as note only (fbz-account)", fbzSeg.includes('id="fbz-account"') && fbzSeg.includes("You are signed in as"));
check("both business branches rebuilt (national + market welcome)", (fbzSeg.match(/Welcome to Magpie/g) || []).length === 2);

const pendSeg = seg(appJs, "function renderPending()", "async function uploadPendingPhoto");
check("creator pending is a welcome state", pendSeg.includes("Welcome to Magpie") && pendSeg.includes('id="pending-home"'));
check("creator pending explains what happens next + what you can do now", pendSeg.includes("What happens next") && pendSeg.includes("What you can do now"));
check("creator pending carries no accountHtml", !pendSeg.includes("accountHtml("));

console.log("== source: no register path routes to the account section ==");
const handlers = {
  doRegisterCreator: seg(appJs, "async function doRegisterCreator(e)", "function renderForBusinesses()"),
  doQuickClaim: seg(appJs, "async function doQuickClaim(e)", "// ---------- Done: you're on the roster"),
  registerBusiness: seg(appJs, "async function registerBusiness(e)", "// Founding price hierarchy"),
  jbConvoFile: seg(appJs, "async function jbConvoFile()", "// Build -181: the business form's scope choice"),
  submitAddSide180: seg(appJs, "async function submitAddSide180(e, role)", "// The standalone Your account view"),
};
for (const [name, s] of Object.entries(handlers)) {
  check(`${name}: handler found`, s.length > 200);
  check(`${name}: never routes to Account/Settings tab`, !s.includes("'Account'") && !s.includes('"Account"') && !s.includes("'Settings'") && !s.includes('"Settings"'), "register handler names the account section");
  check(`${name}: never renders accountHtml`, !s.includes("accountHtml("));
}
check("doRegisterCreator resets the tab (lands on home/pending, not a leftover tab)", handlers.doRegisterCreator.includes('state.view = "dashboard"') && handlers.doRegisterCreator.includes("state.tab = null"));
check("registerBusiness lands on dashboard with tab reset", handlers.registerBusiness.includes('state.view = "dashboard"') && handlers.registerBusiness.includes("state.tab = null"));
check("jbConvoFile lands on dashboard with tab reset", handlers.jbConvoFile.includes('state.view = "dashboard"') && handlers.jbConvoFile.includes("state.tab = null"));
check("doQuickClaim lands on the claim done state (step 5)", handlers.doQuickClaim.includes("state.claimStep = 5"));

console.log("== source: routing + progress polish ==");
const renderSeg = seg(appJs, "async function render()", "// ---------------- logged-out views");
check("render(): pending business -> founding status, pending creator -> pending home", renderSeg.includes('u.role === "business" ? renderBusinessFoundingStatus() : renderPending()'));
check("render(): claim done state wins for the claim session", renderSeg.includes("state.claimStep === 5 && state.claimDone") && renderSeg.includes("renderClaimDone()"));
check("claim progress is labeled in words (Step N of 4)", seg(appJs, "function claimDots(step)", "function claimResolve").includes("Step ${step} of 4") || appJs.includes("Step ${step} of 4"));
check("business form explains the flow up front", appJs.includes("one short form, about 2 minutes"));
check("national brands are told to skip the plans at the scope question", appJs.includes("pick National here and ignore the plans above"));
check("conversation signup shows its progress", appJs.includes("Question ${st.idx + 1} of ${steps.length}"));
check("accountHtml still exists for the real Settings surface", appJs.includes("function accountHtml(u)") && appJs.includes("function renderSettingsTab()"));

// ---------------- serialized landing views ----------------
// Evaluate the REAL landing renderers in a vm with stubbed
// helpers and the users the API returns below. This asserts the
// rendered text a fresh signup actually lands on.
function landingHtml(fnName, user, extraStubs = {}) {
  const src = fnName === "renderBusinessFoundingStatus" ? fbzSeg : fnName === "renderPending" ? pendSeg : seg(appJs, "function renderClaimDone()", "function neighborMissingPlatforms");
  const sandbox = {
    state: { user, boot: { email: { enabled: false }, markets: [] }, claimDone: { firstName: "Fixture", total: 6000, complete: true, under: false }, claimStep: 5, sigCelebrate: false, neighbor: null, lang: "" },
    app: { innerHTML: "" },
    esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
    T: (en) => en,
    wsHead: (t, o) => `<h1>${t}</h1><p>${(o && o.sub) || ""}</p>`,
    unlistedLabel: () => "Not listed yet",
    marketTalkNameClient: (m) => (m === "Virginia Beach" ? "Hampton Roads" : m),
    marketDisplayName: (m) => m,
    marketResolvedNote: () => "",
    unlistedPlace: (u) => u.city || "",
    fmtNum: (n) => String(n),
    claimFmtCount: (n) => String(n),
    CREATOR_FREE_LINE: "Joining Magpie is free for creators. Always.",
    claimPayoffHtml: () => "<div>payoff</div>",
    growRosterHtml: () => "",
    sigCelebMediaHtml: () => "",
    initPendingMarket: () => {},
    neighborPanelHtml: () => "",
    signlInstallBannerHtml: () => "",
    magpieIgFollowHtml: () => "",
    marketOptions: () => "",
    cityOptions: () => "",
    setTimeout: () => {},
    ...extraStubs,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src + `\n;${fnName}();`, sandbox, { timeout: 5000 });
  return sandbox.app.innerHTML;
}
const NOT_ACCOUNT = (html) => !html.includes("Change password") && !html.includes("Delete my account") && !html.includes("<h3>Your account</h3>");

// ---------------- API end-to-end ----------------
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stdout.write(`[server-err] ${d}`));
}
function stopServer() { return new Promise((res) => { if (!server) return res(); server.once("exit", () => res()); server.kill("SIGTERM"); setTimeout(res, 3000); }); }
function waitUp(tries = 60) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      const req = http.get(`${BASE}/api/bootstrap`, (r) => { r.resume(); resolve(r.statusCode === 200); });
      req.on("error", () => { if (n <= 0) resolve(false); else setTimeout(() => attempt(n - 1), 250); });
    };
    attempt(tries);
  });
}
function client() {
  let cookie = "";
  return async (method, p, body) => {
    const r = await fetch(`${BASE}${p}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: r.status, data };
  };
}

async function main() {
  startServer();
  check("dev server up", await waitUp());

  console.log("== api: register all flows ==");
  const qc = await client()("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "qc187@fixtures.dev", password: "fixture-pass-187", handle: "qc187fixture", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true });
  check("creator quick claim registers pending", qc.status === 201 || qc.status === 200, JSON.stringify(qc.data).slice(0, 160));
  const qcUser = qc.data.user;
  check("quick claim user is a pending creator", !!qcUser && qcUser.role === "creator" && qcUser.status === "pending", JSON.stringify(qcUser).slice(0, 160));

  const full = await client()("POST", "/api/auth/register", { role: "creator", name: "Full Fixture", email: "full187@fixtures.dev", password: "fixture-pass-187", market: "Nashville", city: "Nashville", handle: "full187fixture", primaryPlatform: "instagram", followerCount: 6000, audienceStack: { instagram: 6000 }, localAudiencePct: 60, categories: ["Food & Drink"], agreedTerms: true });
  const fullUser = full.data.user;
  check("creator full form registers pending", !!fullUser && fullUser.role === "creator" && fullUser.status === "pending", JSON.stringify(full.data).slice(0, 200));

  const mkt = await client()("POST", "/api/auth/register", { role: "business", name: "Market Owner", email: "mkt187@fixtures.dev", password: "fixture-pass-187", businessName: "Market Fixture Shop", market: "Nashville", city: "Nashville", category: "Restaurant", planId: "self-service", agreedTerms: true });
  const mktUser = mkt.data.user;
  check("market business registers pending", !!mktUser && mktUser.role === "business" && mktUser.status === "pending", JSON.stringify(mkt.data).slice(0, 200));

  const nat = await client()("POST", "/api/auth/register", { role: "business", scope: "national", name: "Nat Owner", email: "nat187@fixtures.dev", password: "fixture-pass-187", businessName: "Nat Fixture Brands LLC", brandName: "Nat Fixture", website: "https://example.com", category: "Retail", agreedTerms: true });
  const natUser = nat.data.user;
  check("national business registers pending with national scope", !!natUser && natUser.role === "business" && natUser.status === "pending" && natUser.business && natUser.business.scope === "national", JSON.stringify(nat.data).slice(0, 240));

  const convo = await client()("POST", "/api/auth/register", { role: "business", applicationSource: "conversation", name: "Convo Owner", email: "convo187@fixtures.dev", password: "fixture-pass-187", businessName: "Convo Fixture Shop", market: "Nashville", city: "Nashville", category: "Retail", planId: "self-service", agreedTerms: true });
  check("conversation business registers pending", !!convo.data.user && convo.data.user.status === "pending", JSON.stringify(convo.data).slice(0, 160));

  console.log("== serialized landings per role ==");
  const natHtml = landingHtml("renderBusinessFoundingStatus", natUser);
  check("national landing: welcome + what happens next + what you can do now", natHtml.includes("Welcome to Magpie") && natHtml.includes("What happens next") && natHtml.includes("What you can do now"), natHtml.slice(0, 200));
  check("national landing: NOT the account view", NOT_ACCOUNT(natHtml), natHtml.slice(0, 200));
  check("national landing: names the brand, one primary action", natHtml.includes("Nat Fixture") && natHtml.includes("Sign out for now"));

  const mktHtml = landingHtml("renderBusinessFoundingStatus", mktUser);
  check("market landing: welcome + what happens next + what you can do now", mktHtml.includes("Welcome to Magpie") && mktHtml.includes("What happens next") && mktHtml.includes("What you can do now"));
  check("market landing: NOT the account view", NOT_ACCOUNT(mktHtml));
  check("market landing: founding list + plan interest preserved", mktHtml.includes("Founding business list,") && mktHtml.includes("Plan interest"));

  const pendHtml = landingHtml("renderPending", fullUser);
  check("creator (full) landing: welcome + what happens next + what you can do now", pendHtml.includes("Welcome to Magpie") && pendHtml.includes("What happens next") && pendHtml.includes("What you can do now"), pendHtml.slice(0, 200));
  check("creator (full) landing: NOT the account view", NOT_ACCOUNT(pendHtml));

  const qcPendHtml = landingHtml("renderPending", qcUser);
  check("creator (quick, returning) landing: welcome state, NOT the account view", qcPendHtml.includes("Welcome to Magpie") && NOT_ACCOUNT(qcPendHtml));

  const doneHtml = landingHtml("renderClaimDone", qcUser);
  check("creator (quick, just finished) landing: roster done state, NOT the account view", doneHtml.includes("You're on the roster") && NOT_ACCOUNT(doneHtml), doneHtml.slice(0, 200));
  check("claim done state keeps its next-step actions", doneHtml.includes("Add your rates and best work") && doneHtml.includes("Go to my dashboard"));

  console.log("== scope addition: locked nav items (Jeff, 2026-11-16) ==");
  const lockSeg = seg(appJs, "function businessAccessState(u)", "function renderNav()");
  check("navLock187 + navLockedTap187 exist beside businessAccessState", lockSeg.includes("function navLock187(tab)") && lockSeg.includes("function navLockedTap187(note)"));
  check("pending lock note names approval", lockSeg.includes("Unlocks when your application is approved."));
  check("national founding lock note names activation", lockSeg.includes("Unlocks when Magpie activates your account."));
  check("national lock covers Discover, Favorites and NatDiscover only", lockSeg.includes('tab === "Discover"') && lockSeg.includes('tab === "Favorites"') && lockSeg.includes('tab === "NatDiscover"'));
  const navLockFor = (user, tab) => {
    const sandbox = { state: { user }, bdShellActive: () => false, showToast: () => {} };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(lockSeg + `\n;navLock187(${JSON.stringify(tab)});`, sandbox, { timeout: 5000 });
    return vm.runInContext(`navLock187(${JSON.stringify(tab)})`, sandbox, { timeout: 5000 });
  };
  check("pending business: every destination locked on approval", navLockFor(mktUser, "Discover") === "Unlocks when your application is approved." && navLockFor(mktUser, "Settings") === "Unlocks when your application is approved." && navLockFor(natUser, "Home") === "Unlocks when your application is approved.");
  check("pending creator: destinations locked on approval", navLockFor(qcUser, "Profile") === "Unlocks when your application is approved." && navLockFor(fullUser, "Find Offers") === "Unlocks when your application is approved.");
  const natApproved = { ...natUser, status: "approved" };
  check("approved national founding: Discover/Favorites/NatDiscover locked on activation", navLockFor(natApproved, "Discover") === "Unlocks when Magpie activates your account." && navLockFor(natApproved, "Favorites") === "Unlocks when Magpie activates your account." && navLockFor(natApproved, "NatDiscover") === "Unlocks when Magpie activates your account.");
  check("approved national founding: working surfaces stay unlocked", navLockFor(natApproved, "Home") === "" && navLockFor(natApproved, "Campaign Setup") === "" && navLockFor(natApproved, "Profile") === "" && navLockFor(natApproved, "Messages") === "");
  const natActive = { ...natUser, status: "approved", business: { ...natUser.business, accessState: "active" } };
  check("active national: discovery unlocked", navLockFor(natActive, "Discover") === "" && navLockFor(natActive, "NatDiscover") === "");
  const mktApproved = { ...mktUser, status: "approved" };
  check("approved market founding: discovery stays unlocked (roster renders while founding)", navLockFor(mktApproved, "Discover") === "" && navLockFor(mktApproved, "Campaign Setup") === "");
  const fullApproved = { ...fullUser, status: "approved" };
  check("approved creator: nothing locked", navLockFor(fullApproved, "Find Offers") === "" && navLockFor(fullApproved, "Earnings") === "");
  check("hamburger rows render the lock (grayed + note, no navigation)", seg(appJs, "function hamburgerRowHtml137(r)", "function openHamburger137()").includes("nav-locked187") && seg(appJs, "function hamburgerRowHtml137(r)", "function openHamburger137()").includes("navLockedTap187"));
  check("everything rows render the lock", seg(appJs, "function everythingRowHtml125(r)", "function openEverything125()").includes("nav-locked187"));
  check("identity menu rows carry their tab and render the lock", seg(appJs, "function identityMenuRows126()", "function openIdentityMenu126()").includes("sub, tab, act:") && seg(appJs, "function openIdentityMenu126()", "function closeIdentityMenu126()").includes("navLock187(r.tab)"));
  check("rail/bar items render the lock with the note line", seg(appJs, "function tabBarHtml()", "// The slim V3 top bar").includes("tab-locked187") && seg(appJs, "function tabBarHtml()", "// The slim V3 top bar").includes("lbl-lock"));
  check("national tab strip locks Find creators while founding", seg(appJs, "function natTabsHtml(active)", "function renderNationalBusinessDash()").includes('navLock187("NatDiscover")'));
  const themeV3 = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");
  check("locked styles ship (nav-locked187 + tab-locked187 + lbl-lock)", themeV3.includes(".nav-locked187") && themeV3.includes(".tab-locked187") && themeV3.includes(".lbl-lock"));

  console.log("== scope addition: verification copy matches the mechanism ==");
  // The mechanism (netlify/functions/lib/national.js): verification
  // is a manual admin action — an admin ticks a three-item
  // checklist (website resolves and belongs to the brand, name
  // matches, a real store exists) and the server stamps
  // verifiedAt/verifiedBy. Nothing fetches the website; only
  // national accounts can be verified at all.
  const nationalJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/national.js"), "utf8");
  check("mechanism pin: verify is admin-only with a human checklist", nationalJs.includes('action === "verify"') && nationalJs.includes("Finish the verification checklist first") && nationalJs.includes("verifiedBy: user.id"));
  check("mechanism pin: market businesses carry no Verified brand check", nationalJs.includes("Only a national account carries the Verified brand check."));
  check("pending national step names the by-hand check", natHtml.includes("a person on the Magpie team checks your website and your store by hand"), natHtml.slice(0, 300));
  check("pending national step drops the old claim", !natHtml.includes("we check your website and your store"));
  check("app copy: no surface still promises the unqualified check", !appJs.includes("we check your website") && !appJs.includes("Magpie checks your website") && !appJs.includes("Magpie checks that your website"));
  check("app copy: national head + home panel name the by-hand check", appJs.includes("a person on the Magpie team checks your website and store by hand") && appJs.includes("A person on the Magpie team checks by hand that your website is really yours"));
  check("publish gate copy names the by-hand check, no speed promise", nationalJs.includes("A person on the Magpie team checks your website and your store by hand, and then your campaigns can go out.") && !nationalJs.includes("Verification is quick"));

  console.log("== scope addition 2: admin applications split ==");
  // Source pins: two sections, per-section search + body, the
  // cross-reference in the row, the server-side linkedSide.
  check("applications render two sections (Business first, Creator second)", appJs.includes('sectionHtml("business", "Business applications")') && appJs.includes('sectionHtml("creator", "Creator applications")') && appJs.indexOf('sectionHtml("business"') < appJs.indexOf('sectionHtml("creator"'));
  check("each section carries its own search input + body", appJs.includes('id="apps-search-${role}"') && appJs.includes('id="apps-body-${role}"') && appJs.includes("function adminAppSectionBody187(role)") && appJs.includes("function adminAppSearchApply187(role)"));
  check("each section shows its own counts (pending first)", appJs.includes("<strong>${d.pend.length} pending</strong> &middot; ${d.dec.length} decided"));
  check("per-section Deck/List views", appJs.includes("adminAppViewByRole187") && appJs.includes("function adminDeckHtml(pend, role)"));
  check("list rows cross-reference the dual-role other side", seg(appJs, "async function loadApplications()", "// ---------- Admin: Applications sections").includes("Dual account") && seg(appJs, "async function loadApplications()", "// ---------- Admin: Applications sections").includes("see ${u.linkedSide.role === \"business\" ? \"Business\" : \"Creator\"} applications"));
  check("per-record actions still render per row (approve, reject, activate, tester)", (() => { const s = seg(appJs, "async function loadApplications()", "// ---------- Admin: Applications sections"); return s.includes("reviewApp('${u.id}','approve')") && s.includes("toggleRejectEditor('${u.id}')") && s.includes("activateBusiness('${u.id}')") && s.includes("setTester('${u.id}'"); })());
  const routerJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");
  check("applications payload names the dual-role sibling (role, status, label)", seg(routerJs, 'if (method === "GET" && seg[1] === "applications")', "Find a user (Build -116").includes("pub.linkedSide = { role: sib.role, status: sib.status, label }"));

  // API: a dual-role pair + the section partition over the payload.
  const dualCr = client();
  const dualReg = await dualCr("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "dual187@fixtures.dev", password: "fixture-pass-187", handle: "dual187", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true });
  check("dual fixture: creator side registers pending", !!dualReg.data.user && dualReg.data.user.status === "pending", JSON.stringify(dualReg.data).slice(0, 160));
  const dualSide = await dualCr("POST", "/api/auth/add-side", { role: "business", name: "Dual Owner", businessName: "Dual Fixture Bakery", category: "Bakery", market: "Nashville", agreedTerms: true, agreedPostCompliance: true });
  check("dual fixture: business side added pending, linked back", !!dualSide.data.user && dualSide.data.user.role === "business" && dualSide.data.user.status === "pending" && !!dualSide.data.user.linkedAccountId, JSON.stringify(dualSide.data).slice(0, 200));
  const adm = client();
  const admLogin = await adm("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login works", admLogin.status === 200, String(admLogin.status));
  const appsRes = await adm("GET", "/api/admin/applications");
  const allRows = [...(appsRes.data.pending || []), ...(appsRes.data.decided || [])];
  const bizRows = allRows.filter((u) => u.role === "business");
  const crRows = allRows.filter((u) => u.role === "creator");
  check("section partition: every queue record is in exactly one role set", bizRows.length + crRows.length <= allRows.length && bizRows.every((u) => !crRows.includes(u)), `biz=${bizRows.length} cr=${crRows.length} all=${allRows.length}`);
  check("section counts agree with the payload (business pending includes the fixture set)", bizRows.filter((u) => u.status === "pending").length === (appsRes.data.pending || []).filter((u) => u.role === "business").length && crRows.filter((u) => u.status === "pending").length === (appsRes.data.pending || []).filter((u) => u.role === "creator").length);
  const dualBizRow = bizRows.find((u) => u.id === (dualSide.data.user || {}).id);
  const dualCrRow = crRows.find((u) => u.id === (dualReg.data.user || {}).id);
  check("business section record cross-references the creator side (role, identity, status)", !!dualBizRow && !!dualBizRow.linkedSide && dualBizRow.linkedSide.role === "creator" && dualBizRow.linkedSide.status === "pending" && dualBizRow.linkedSide.label === "@dual187", JSON.stringify(dualBizRow && dualBizRow.linkedSide));
  check("creator section record cross-references the business side (role, identity, status)", !!dualCrRow && !!dualCrRow.linkedSide && dualCrRow.linkedSide.role === "business" && dualCrRow.linkedSide.status === "pending" && dualCrRow.linkedSide.label === "Dual Fixture Bakery", JSON.stringify(dualCrRow && dualCrRow.linkedSide));
  check("unlinked records carry no cross-reference", !!mktUser && !allRows.find((u) => u.id === mktUser.id).linkedSide && !allRows.find((u) => u.id === qcUser.id).linkedSide);

  console.log("== scope addition 3: conversations, national framing, national home ==");
  const natJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/national.js"), "utf8");
  check("national lane carries no founding-list framing in its gates", !natJs.includes("Your account is on the founding list"), "");
  check("server founding refusal branches by scope (national variant exists)", routerJs.includes("FOUNDING_BUSINESS_MESSAGE_NATIONAL187") && routerJs.includes("function foundingBusinessMessage187(u)") && routerJs.includes("Your brand is not active yet."));
  const natC = client();
  await natC("POST", "/api/auth/login", { email: "nat187@fixtures.dev", password: "fixture-pass-187" });
  const msgNat = await natC("GET", "/api/messages");
  const msgNatBody = JSON.stringify(msgNat.data);
  check("pending national business hitting messages gets the NATIONAL refusal (no plan, no line, no founding list)", msgNat.status === 403 && !/founding list|place in line|your plan/i.test(msgNatBody) && msgNatBody.includes("not active yet"), msgNatBody.slice(0, 160));
  const mktC = client();
  await mktC("POST", "/api/auth/login", { email: "mkt187@fixtures.dev", password: "fixture-pass-187" });
  const msgMkt = await mktC("GET", "/api/messages");
  const msgMktBody = JSON.stringify(msgMkt.data);
  check("pending market business hitting messages keeps the market founding answer", msgMkt.status === 403 && msgMktBody.includes("founding list"), msgMktBody.slice(0, 120));
  const natPatch = await natC("PATCH", "/api/me/profile", { brandName: "Nat Fixture", logoUrl: "https://example.com/logo.png", brandAbout: "Liquid vitamins, bottled." });
  check("founding national business CAN save its brand page fields (the -80 whitelist covers national page fields)", natPatch.status === 200, JSON.stringify(natPatch.data).slice(0, 160));
  const natPatchBad = await natC("PATCH", "/api/me/profile", { brandAbout: "ok", averageTicket: 42 });
  check("founding national business still cannot save plan/product settings pre-activation", natPatchBad.status === 403, JSON.stringify(natPatchBad.data).slice(0, 160));
  check("national founding Conversations is an honest empty state (no status notice)", appJs.includes("function renderNatFoundingMessages187()") && appJs.includes("No conversations yet") && appJs.includes('isFoundingBusiness(u) ? renderNatFoundingMessages187() : loadThreads()'));
  check("national pending landing carries no founding-list framing", !seg(appJs, 'if (bz.scope === "national") {', "What you can do now").includes("founding list") && seg(appJs, 'if (bz.scope === "national") {', "What you can do now").includes("Your application is in review."));
  check("national home founding panel uses the review-verification-activation order", appJs.includes("Your application is approved. Your account is not active yet.") && appJs.includes("brand verification, checked by hand below, and then activation by Magpie"));
  check("national home campaigns zero state is human copy, not the debug stats line", appJs.includes("No campaigns yet. Your first one takes a few minutes: say what creators get, what you ask, and how many you will pick.") && appJs.includes("zeroCampaigns"));
  check("national head: avatar cannot squash (flex:none) and head is name + one status line", appJs.includes("flex:none;border-radius:50%") && appJs.includes("const statusLine =") && !seg(appJs, "function natHeadHtml", "function natCampaignRowHtml").includes("Not verified yet: a person on the Magpie team checks"));
  check("Maggie bank: market-open answers branch for national accounts", appJs.includes("Your national account is not in a market queue."));

  console.log("== scope addition 4: Maggie identity, flows, next steps ==");
  check("side switch clears the other side's Maggie queue, thread and national cache", seg(appJs, "async function switchSide180()", "function closeAddSide180").includes("state.sigQueue = null") && seg(appJs, "async function switchSide180()", "function closeAddSide180").includes("state.sigThread = []") && seg(appJs, "async function switchSide180()", "function closeAddSide180").includes("state.natMe = null"));
  check("Maggie flow buttons close the sheet before navigating (no dead taps)", seg(appJs, "function sigBoxFlow(i)", "// The top of every role home").includes("closeSigSheet137(); f.act();"));
  check("pending business gets no Maggie walk-to flows", seg(appJs, "function sigFlowsFor()", "function sigCtx()").includes('if (u.status === "pending") return [];'));
  check("national business flows name the national tabs", seg(appJs, "function sigFlowsFor()", "function sigCtx()").includes('go("dashboard", "NatNew")') && seg(appJs, "function sigFlowsFor()", "function sigCtx()").includes('go("dashboard", "NatBrand")'));
  check("bank walk-to labels resolve per scope (national gets Start a campaign)", appJs.includes('flow: (c) => c.national ? "Start a campaign" : (c.status === "pending" ? null : "Post an offer")'));
  check("national home builds Maggie's queue from the business side only", appJs.includes("state.sigQueue = nq;") && appJs.includes("Brand verification is done by a person on the Magpie team"));

  console.log("== scope addition 5: the composer ==");
  check("national composer carries the Maggie card in every state", seg(appJs, "function natComposerHtml(c)", "function natComposerBody()").includes("natMaggieCard187()") && appJs.includes("Draft this with Maggie"));
  check("Maggie's composer draft fills empty fields only", seg(appJs, "function natMaggieDraft187()", "function natAskMaggie187()").includes("if (el.value.trim()) kept.push") && seg(appJs, "function natMaggieDraft187()", "function natAskMaggie187()").includes("left your typed words alone"));
  check("fresh national composer fields carry examples as placeholders, never values", seg(appJs, "function natComposerHtml(c)", "function natComposerBody()").includes('id="nc-title" value="${esc((c && c.title) || "")}" placeholder=') && seg(appJs, "function natComposerHtml(c)", "function natComposerBody()").includes('id="nc-get" value="${esc((c && c.whatYouGet) || "")}" placeholder='));
  check("picks field explains itself in one line", appJs.includes("Creators raise a hand to say they are interested. This is how many of them you will pick"));
  check("national preview renders through the real creator card renderer", seg(appJs, "function natPreviewRefresh187()", "function natPreviewToggle187").includes("nationalCampaignCardHtml(natPreviewCampaign187())"));
  check("market composer rail preview renders through the real mirror card renderer", appJs.includes("function offerRailPreview187()") && appJs.includes("mirrorOfferCardHtml(offerPreviewOffer(), { preview: true })") && appJs.includes('id="offer-peek-rail187"'));
  check("Ask Maggie from the composer carries the draft in her context", appJs.includes("state.sigCampaignCtx187") && seg(appJs, "function sigCtx()", "// The canon bank").includes("ctx.campaignDraft = state.sigCampaignCtx187"));

  console.log("== scope additions 6 + 7: shell type, menu pattern, center + ==");
  const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  check("Inter loads with the shell fonts (same Google Fonts pattern)", indexHtml.includes("family=Inter:wght@400;500;600;700"));
  check("shell type treatment pins (Inter on nav, quiet group headers, active pill, identity card, plus, rail primary)", themeV3.includes("font-family: 'Inter', system-ui, sans-serif") && themeV3.includes(".ev125-group h5") && themeV3.includes(".row-on187") && themeV3.includes(".menu-idcard187") && themeV3.includes(".tab-plus187") && themeV3.includes(".rail-primary187"));
  check("menu ends with the identity card; dual-role switch lives there in plain words", appJs.includes("${menuIdentityCard187(u, name)}") && appJs.includes("Switch to your ${other} side") && appJs.includes("function menuIdentityStateLine187(u)"));
  check("center + destinations per role (business composer, national composer, creator find offers)", seg(appJs, "const plus187 = (() => {", "const barIdx = {};").includes('go(\'dashboard\',\'Campaign Setup\')') && seg(appJs, "const plus187 = (() => {", "const barIdx = {};").includes('go(\'dashboard\',\'NatNew\')') && seg(appJs, "const plus187 = (() => {", "const barIdx = {};").includes('go(\'dashboard\',\'Find Offers\')'));
  check("pending + explains the unlock instead of navigating", seg(appJs, "const plus187 = (() => {", "const barIdx = {};").includes("navLockedTap187('Unlocks when your application is approved.')"));
  check("the + is labeled under the button (Campaign / Offers)", appJs.includes('class="tab-item tab-bar137 tab-plus187"') && seg(appJs, "const plus187 = (() => {", "const barIdx = {};").includes('label: "Campaign"') && seg(appJs, "const plus187 = (() => {", "const barIdx = {};").includes('label: "Offers"'));

  await stopServer();
  console.log(`\nverify-build187: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await stopServer(); process.exit(1); });
