// Campus identity verification: optional university capture, the
// campus badge on every creator surface, same-school referral
// cohorts, and admin visibility. Run: node scripts/verify-campus.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { UNIVERSITY_OPTIONS, normalizeUniversity, sameUniversity, campusBadgeText } = require("../netlify/functions/lib/router.js");

const PORT = 8941;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = ["verify", "admin", "pass", "123"].join("-");
const DB = path.join(os.tmpdir(), `signl-verify-campus-${Date.now()}.json`);
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (v) jar.set(k, v); else jar.delete(k);
      }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, data };
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

async function stopServer() {
  try { server.kill("SIGTERM"); } catch (e) { /* already stopped */ }
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

function fullCreatorBody(overrides) {
  return {
    role: "creator",
    name: "Campus Creator",
    email: "campus@example.com",
    password: "campus-pass-1234",
    market: "Hampton Roads",
    city: "Virginia Beach",
    handle: "campuscreator",
    followerCount: 4200,
    localAudiencePct: 64,
    categories: ["Food & Drink"],
    ...AGREE,
    ...overrides,
  };
}

try {
  check("unit: the known-school list carries all 16 launch-market schools", UNIVERSITY_OPTIONS.length === 16 && UNIVERSITY_OPTIONS.includes("VCU") && UNIVERSITY_OPTIONS.includes("Georgetown University"), JSON.stringify(UNIVERSITY_OPTIONS));
  check("unit: full school names normalize to the canonical badge value", normalizeUniversity("Virginia Commonwealth University") === "VCU" && normalizeUniversity(" GWU ") === "George Washington University" && normalizeUniversity("College of William & Mary") === "William & Mary");
  check("unit: free-text schools survive and same-school matching is case-insensitive", normalizeUniversity("Old Dominion University") === "Old Dominion University" && sameUniversity("vcu", "Virginia Commonwealth University") && campusBadgeText("VCU") === "Campus: VCU");

  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const boot = await client()("GET", "/api/bootstrap");
  check("bootstrap ships the university datalist", Array.isArray(boot.data.universities) && boot.data.universities.length === 16 && boot.data.universities.includes("Howard University"), JSON.stringify(boot.data.universities));

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  const lead = client();
  const leadReg = await lead("POST", "/api/auth/register", fullCreatorBody({
    name: "Campus Lead",
    email: "campuslead@example.com",
    handle: "campuslead",
    university: "Virginia Commonwealth University",
  }));
  check("full signup accepts a university and canonicalizes it on both record levels", leadReg.status === 201 && leadReg.data.user.university === "VCU" && leadReg.data.user.creator.university === "VCU", JSON.stringify(leadReg.data.user));
  check("university is optional color, not a profile-completion gate", leadReg.status === 201 && leadReg.data.user.creator.profileComplete === true && leadReg.data.user.profileCompletion.complete === true, JSON.stringify(leadReg.data.user && leadReg.data.user.profileCompletion));
  const leadId = leadReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: leadId, decision: "approve" });

  const same = client();
  const sameReg = await same("POST", "/api/auth/register", fullCreatorBody({
    name: "Same School",
    email: "sameschool@example.com",
    handle: "sameschool",
    university: "VCU",
    referredBy: "campuslead",
  }));
  check("same-school referred creator registers", sameReg.status === 201, JSON.stringify(sameReg.data));
  const sameId = sameReg.data.user.id;

  const other = client();
  const otherReg = await other("POST", "/api/auth/register", fullCreatorBody({
    name: "Other School",
    email: "otherschool@example.com",
    handle: "otherschool",
    city: "Norfolk",
    university: "Duke University",
    referredBy: "campuslead",
  }));
  check("different-school referred creator registers", otherReg.status === 201, JSON.stringify(otherReg.data));
  const otherId = otherReg.data.user.id;

  let leadMe = await lead("GET", "/api/auth/me");
  check("dashboard referral payload groups only same-school referrals into the campus crew", !!leadMe.data.user.momentum.campusCrew && leadMe.data.user.momentum.campusCrew.university === "VCU" && leadMe.data.user.momentum.campusCrew.count === 1 && leadMe.data.user.momentum.campusCrew.approved === 0, JSON.stringify(leadMe.data.user.momentum));
  check("campus cohort does not change the flat referral counts", leadMe.data.user.momentum.signups === 2 && leadMe.data.user.momentum.approved === 0, JSON.stringify(leadMe.data.user.momentum));

  await admin("POST", "/api/admin/review", { userId: sameId, decision: "approve" });
  await admin("POST", "/api/admin/review", { userId: otherId, decision: "approve" });
  leadMe = await lead("GET", "/api/auth/me");
  check("campus crew approved count follows approvals inside the same-school slice", !!leadMe.data.user.momentum.campusCrew && leadMe.data.user.momentum.campusCrew.approved === 1 && leadMe.data.user.momentum.approved === 2, JSON.stringify(leadMe.data.user.momentum));

  const claimer = client();
  const claim = await claimer("POST", "/api/auth/register", {
    role: "creator",
    quickClaim: true,
    email: "campusclaim@example.com",
    password: "campus-pass-1234",
    market: "Hampton Roads",
    handle: "campusclaim",
    ...AGREE,
  });
  check("quick claim step 1 needs no university and stores it blank", claim.status === 201 && claim.data.user.university === "" && claim.data.user.creator.university === "", JSON.stringify(claim.data.user));
  const completed = await claimer("PATCH", "/api/me/profile", {
    name: "Campus Claim",
    city: "Virginia Beach",
    audienceStack: { instagram: 2600 },
    categories: ["Food & Drink"],
    localAudiencePct: 58,
    university: "GWU",
  });
  check("profile completion can add a university and mirrors it on both record levels", completed.status === 200 && completed.data.user.university === "George Washington University" && completed.data.user.creator.university === "George Washington University", JSON.stringify(completed.data.user));
  check("adding a university in step 2 completes the profile normally", completed.status === 200 && completed.data.user.profileCompletion.complete === true && completed.data.user.creator.profileComplete === true, JSON.stringify(completed.data.user && completed.data.user.profileCompletion));
  const claimerId = claim.data.user.id;
  await admin("POST", "/api/admin/review", { userId: claimerId, decision: "approve" });
  const cleared = await claimer("PATCH", "/api/me/profile", { university: "" });
  check("profile edit can clear the university from both record levels", cleared.status === 200 && cleared.data.user.university === "" && cleared.data.user.creator.university === "", JSON.stringify(cleared.data.user));

  const business = client();
  const bizReg = await business("POST", "/api/auth/register", {
    role: "business",
    name: "Campus Biz Owner",
    businessName: "Campus Table",
    email: "campusbiz@example.com",
    password: "campus-pass-1234",
    market: "Hampton Roads",
    city: "Norfolk",
    category: "Restaurant",
    planId: "growth",
    agreedTerms: true,
  });
  const businessId = bizReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: businessId, decision: "approve" });
  const activated = await admin("POST", "/api/admin/businesses/activate", { userId: businessId });
  check("business fixture approved and activated", activated.status === 200 && activated.data.user.business.accessState === "active", JSON.stringify(activated.data));

  const discovery = await business("GET", "/api/discover?market=Hampton%20Roads");
  const leadCard = (discovery.data.creators || []).find((c) => c.userId === leadId);
  check("discovery card carries the university and campus badge at card and profile level", !!leadCard && leadCard.university === "VCU" && leadCard.campusBadge === "Campus: VCU" && leadCard.profile.university === "VCU", JSON.stringify(leadCard));

  const pub = await client()("GET", "/api/c/campuslead");
  check("public /c/ profile carries the university and campus badge", pub.status === 200 && pub.data.profile.university === "VCU" && pub.data.profile.campusBadge === "Campus: VCU", JSON.stringify(pub.data));

  const offer = await business("POST", "/api/offers", { title: "Campus tasting", whatComped: "Dinner for two", dollarCap: 90, spots: 1 });
  check("open offer fixture publishes", offer.status === 201, JSON.stringify(offer.data));
  const applied = await lead("POST", `/api/offers/${offer.data.offer.id}/apply`, {});
  check("campus lead applies to the open offer", applied.status === 201, JSON.stringify(applied.data));
  const stack = await business("GET", `/api/offers/${offer.data.offer.id}/applications`);
  const stackRow = (stack.data.applications || []).find((a) => a.creatorId === leadId);
  check("business applicant stack carries the university and campus badge", !!stackRow && stackRow.creator.university === "VCU" && stackRow.creator.campusBadge === "Campus: VCU", JSON.stringify(stackRow));

  const apps = await admin("GET", "/api/admin/applications");
  const adminRow = [...(apps.data.pending || []), ...(apps.data.decided || [])].find((u) => u.id === leadId);
  check("admin applications carry the university, badge, and campus crew", !!adminRow && adminRow.university === "VCU" && adminRow.creator.university === "VCU" && adminRow.campusBadge === "Campus: VCU" && adminRow.momentum.campusCrew && adminRow.momentum.campusCrew.count === 1, JSON.stringify(adminRow));

  const events = await admin("GET", "/api/admin/events?limit=500&type=application_submitted");
  const leadEvent = (events.data.events || []).find((e) => e.subjectId === leadId);
  check("application_submitted event records the university", !!leadEvent && leadEvent.data.university === "VCU", JSON.stringify(leadEvent && leadEvent.data));

  const appJsRes = await fetch(BASE + "/app.js");
  const appJs = await appJsRes.text();
  check("client ships signup and profile university fields with datalists", appJs.includes("jc-university") && appJs.includes("p-university") && appJs.includes("universityDatalistHtml"), "");
  check("client ships the campus badge and exact campus crew line", appJs.includes("campusBadgeHtml") && appJs.includes("Your campus crew:") && appJs.includes("Campus: VCU") === false && appJs.includes("m.campusCrew.university"), "");
  check("client ships university in admin application details", appJs.includes("University:") && appJs.includes("u.creator.university || u.university"), "");
} catch (e) {
  failed += 1;
  failures.push("suite error: " + e.message);
  console.log("  FAIL  suite error :: " + e.message);
} finally {
  await stopServer();
}

console.log(`\nCampus verification: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("Failures: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
