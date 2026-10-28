// Campus identity verification: optional university capture, the
// campus badge on every creator surface, same-school referral
// cohorts, and admin visibility. Run: node scripts/verify-campus.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { UNIVERSITY_OPTIONS, normalizeUniversity, sameUniversity, campusBadgeText, normalizeUniversityStatus, universityStatusOfRecord, universityStatusLabel, campusBadgeFor, resolveUniversity, collegesData } = require("../netlify/functions/lib/router.js");

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
    email: "campus@fixtures.dev",
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
  check("unit: student status normalizes labels and slugs, junk becomes unset", normalizeUniversityStatus("Current student") === "current_student" && normalizeUniversityStatus("current_student") === "current_student" && normalizeUniversityStatus("Alumni") === "alumni" && normalizeUniversityStatus("Not a student") === "not_student" && normalizeUniversityStatus("bogus") === "" && normalizeUniversityStatus(undefined) === "");
  check("unit: the badge gate passes current students only", campusBadgeFor({ creator: { university: "VCU", universityStatus: "current_student" } }) === "Campus: VCU" && campusBadgeFor({ creator: { university: "VCU", universityStatus: "alumni" } }) === null && campusBadgeFor({ creator: { university: "VCU", universityStatus: "not_student" } }) === null && campusBadgeFor({ creator: { university: "VCU" } }) === null && campusBadgeFor({ creator: { universityStatus: "current_student" } }) === null);
  check("unit: status labels render for admin", universityStatusLabel("current_student") === "Current student" && universityStatusLabel("alumni") === "Alumni" && universityStatusLabel("not_student") === "Not a student" && universityStatusLabel("") === "");
  check("unit: the bundled IPEDS dataset carries 6,000+ institutions", collegesData().list.length > 6000, String(collegesData().list.length));
  check("unit: alias resolves to the shipped canonical with dataset city/state", (() => { const r = resolveUniversity("VCU"); return r.name === "VCU" && r.verified === true && r.city === "Richmond" && r.state === "VA"; })(), JSON.stringify(resolveUniversity("VCU")));
  check("unit: the dataset's own name for an override school collapses to the same canonical", resolveUniversity("Virginia Commonwealth University").name === "VCU" && resolveUniversity("North Carolina State University at Raleigh").name === "NC State University" && resolveUniversity("University of North Carolina at Chapel Hill").name === "UNC Chapel Hill");
  check("unit: a non-launch dataset school resolves by name and by dataset alias", (() => { const byName = resolveUniversity("James Madison University"); const byAlias = resolveUniversity("JMU"); return byName.name === "James Madison University" && byName.verified === true && byName.city === "Harrisonburg" && byName.state === "VA" && byAlias.name === "James Madison University" && byAlias.verified === true; })(), JSON.stringify(resolveUniversity("JMU")));
  check("unit: free entry stays as typed and unverified; empty stays empty", (() => { const r = resolveUniversity("Tiny Made Up College"); const e = resolveUniversity(""); return r.name === "Tiny Made Up College" && r.verified === false && e.name === ""; })());

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
    email: "campuslead@fixtures.dev",
    handle: "campuslead",
    university: "Virginia Commonwealth University",
    universityStatus: "Current student",
  }));
  check("full signup accepts a university and canonicalizes it on both record levels", leadReg.status === 201 && leadReg.data.user.university === "VCU" && leadReg.data.user.creator.university === "VCU", JSON.stringify(leadReg.data.user));
  check("signup status round-trips normalized on both record levels", leadReg.status === 201 && leadReg.data.user.universityStatus === "current_student" && leadReg.data.user.creator.universityStatus === "current_student", JSON.stringify(leadReg.data.user));
  check("university is optional color, not a profile-completion gate", leadReg.status === 201 && leadReg.data.user.creator.profileComplete === true && leadReg.data.user.profileCompletion.complete === true, JSON.stringify(leadReg.data.user && leadReg.data.user.profileCompletion));
  const leadId = leadReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: leadId, decision: "approve" });

  const same = client();
  const sameReg = await same("POST", "/api/auth/register", fullCreatorBody({
    name: "Same School",
    email: "sameschool@fixtures.dev",
    handle: "sameschool",
    university: "VCU",
    referredBy: "campuslead",
  }));
  check("same-school referred creator registers", sameReg.status === 201, JSON.stringify(sameReg.data));
  const sameId = sameReg.data.user.id;

  const other = client();
  const otherReg = await other("POST", "/api/auth/register", fullCreatorBody({
    name: "Other School",
    email: "otherschool@fixtures.dev",
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
    email: "campusclaim@fixtures.dev",
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
    email: "campusbiz@fixtures.dev",
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
  check("admin applications carry the student status", !!adminRow && adminRow.universityStatus === "current_student" && adminRow.creator.universityStatus === "current_student", JSON.stringify(adminRow));

  const events = await admin("GET", "/api/admin/events?limit=500&type=application_submitted");
  const leadEvent = (events.data.events || []).find((e) => e.subjectId === leadId);
  check("application_submitted event records the university", !!leadEvent && leadEvent.data.university === "VCU", JSON.stringify(leadEvent && leadEvent.data));

  // ---------- student-status gate: alumni and unset earn no badge ----------
  const alum = client();
  const alumReg = await alum("POST", "/api/auth/register", fullCreatorBody({
    name: "Campus Alum", email: "campusalum@fixtures.dev", handle: "campusalum",
    university: "VCU", universityStatus: "alumni",
  }));
  check("alumni signup stores the status on both record levels", alumReg.status === 201 && alumReg.data.user.universityStatus === "alumni" && alumReg.data.user.creator.universityStatus === "alumni", JSON.stringify(alumReg.data.user));
  const alumId = alumReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: alumId, decision: "approve" });
  const alumPub = await client()("GET", "/api/c/campusalum");
  check("alumni public /c/ profile: university yes, campus badge NO", alumPub.status === 200 && alumPub.data.profile.university === "VCU" && alumPub.data.profile.campusBadge === null, JSON.stringify(alumPub.data.profile));
  const alumMe = await alum("GET", "/api/auth/me");
  check("alumni own payload carries no badge", !!alumMe.data.user && alumMe.data.user.creator.universityStatus === "alumni", JSON.stringify(alumMe.data.user && alumMe.data.user.creator));
  const discovery2 = await business("GET", "/api/discover?market=Hampton%20Roads");
  const alumCard = (discovery2.data.creators || []).find((c) => c.userId === alumId);
  check("alumni discovery card: university yes, campus badge NO", !!alumCard && alumCard.university === "VCU" && alumCard.campusBadge === null, JSON.stringify(alumCard));

  const nostat = client();
  const nostatReg = await nostat("POST", "/api/auth/register", fullCreatorBody({
    name: "No Status", email: "campusnostatus@fixtures.dev", handle: "campusnostatus",
    university: "VCU",
  }));
  const nostatId = nostatReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: nostatId, decision: "approve" });
  const nostatPub = await client()("GET", "/api/c/campusnostatus");
  check("unset status: university recorded, status blank, campus badge NO", nostatReg.status === 201 && nostatReg.data.user.universityStatus === "" && nostatPub.status === 200 && nostatPub.data.profile.campusBadge === null, JSON.stringify(nostatPub.data.profile));

  // profile edit flips the gate both ways
  const flip1 = await alum("PATCH", "/api/me/profile", { universityStatus: "current_student" });
  check("profile edit to current student round-trips on both record levels", flip1.status === 200 && flip1.data.user.universityStatus === "current_student" && flip1.data.user.creator.universityStatus === "current_student", JSON.stringify(flip1.data.user));
  const alumPub2 = await client()("GET", "/api/c/campusalum");
  check("badge appears once the alum becomes a current student", alumPub2.status === 200 && alumPub2.data.profile.campusBadge === "Campus: VCU", JSON.stringify(alumPub2.data.profile));
  const flip2 = await alum("PATCH", "/api/me/profile", { universityStatus: "Not a student" });
  const alumPub3 = await client()("GET", "/api/c/campusalum");
  check("badge disappears when status leaves current student (label form normalizes too)", flip2.status === 200 && flip2.data.user.universityStatus === "not_student" && alumPub3.status === 200 && alumPub3.data.profile.campusBadge === null, JSON.stringify(alumPub3.data.profile));

  const apps2 = await admin("GET", "/api/admin/applications");
  const alumRow = [...(apps2.data.pending || []), ...(apps2.data.decided || [])].find((u) => u.id === alumId);
  check("admin payload: alumni status carried, badge null", !!alumRow && alumRow.universityStatus === "not_student" && alumRow.creator.universityStatus === "not_student" && alumRow.campusBadge === null, JSON.stringify(alumRow));

  // ---------- dataset-driven resolution over HTTP ----------
  const served = await client()("GET", "/data/us-colleges.json");
  check("the client dataset is served and slim", served.status === 200 && Array.isArray(served.data) && served.data.length > 6000 && !!served.data.find((r) => r.n === "Virginia Commonwealth University" && (r.a || []).includes("VCU")), String(served.status));

  const variant = client();
  const variantReg = await variant("POST", "/api/auth/register", fullCreatorBody({
    name: "Variant Spelling", email: "campusvariant@fixtures.dev", handle: "campusvariant",
    university: "Virginia Commonwealth University", referredBy: "campuslead",
  }));
  check("dataset-name variant stores the shipped canonical plus dataset city/state, verified", variantReg.status === 201 && variantReg.data.user.university === "VCU" && variantReg.data.user.creator.university === "VCU" && variantReg.data.user.universityCity === "Richmond" && variantReg.data.user.universityState === "VA" && variantReg.data.user.universityUnverified === false && variantReg.data.user.creator.universityUnverified === false, JSON.stringify(variantReg.data.user));
  const leadMe2 = await lead("GET", "/api/auth/me");
  check("campus crew groups variants of the same school together", !!leadMe2.data.user.momentum.campusCrew && leadMe2.data.user.momentum.campusCrew.count === 2, JSON.stringify(leadMe2.data.user.momentum));

  const jmu = client();
  const jmuReg = await jmu("POST", "/api/auth/register", fullCreatorBody({
    name: "JMU Creator", email: "campusjmu@fixtures.dev", handle: "campusjmu",
    university: "JMU",
  }));
  check("a dataset alias outside the launch 16 resolves to the dataset canonical", jmuReg.status === 201 && jmuReg.data.user.university === "James Madison University" && jmuReg.data.user.universityCity === "Harrisonburg" && jmuReg.data.user.universityUnverified === false, JSON.stringify(jmuReg.data.user));

  const free = client();
  const freeReg = await free("POST", "/api/auth/register", fullCreatorBody({
    name: "Free Entry", email: "campusfree@fixtures.dev", handle: "campusfree",
    university: "Tiny Made Up College",
  }));
  const freeId = freeReg.data.user.id;
  check("unmatched free entry is stored as typed and flagged on both record levels", freeReg.status === 201 && freeReg.data.user.university === "Tiny Made Up College" && freeReg.data.user.universityUnverified === true && freeReg.data.user.creator.universityUnverified === true, JSON.stringify(freeReg.data.user));
  const apps3 = await admin("GET", "/api/admin/applications");
  const freeRow = [...(apps3.data.pending || []), ...(apps3.data.decided || [])].find((u) => u.id === freeId);
  check("admin payload carries the unverified flag", !!freeRow && freeRow.universityUnverified === true && freeRow.creator.universityUnverified === true, JSON.stringify(freeRow));
  const freeFix = await free("PATCH", "/api/me/profile", { university: "VCU" });
  check("editing a free entry into a dataset school clears the flag and stores city/state", freeFix.status === 200 && freeFix.data.user.university === "VCU" && freeFix.data.user.universityUnverified === false && freeFix.data.user.creator.universityUnverified === false && freeFix.data.user.universityCity === "Richmond", JSON.stringify(freeFix.data.user));

  // ---------- U1: Discover campus filter + universities facet ----------
  const u1All = await business("GET", "/api/discover?market=Hampton%20Roads");
  check("U1: discover response carries the universities facet", Array.isArray(u1All.data.universities), JSON.stringify(u1All.data.universities));
  check("U1: facet lists only schools with current-student roster creators (VCU x1)", JSON.stringify(u1All.data.universities) === JSON.stringify([{ name: "VCU", count: 1 }]), JSON.stringify(u1All.data.universities));
  const u1Vcu = await business("GET", "/api/discover?market=Hampton%20Roads&university=VCU");
  check("U1: filtering by VCU returns exactly the current student", (u1Vcu.data.creators || []).length === 1 && u1Vcu.data.creators[0].userId === leadId, JSON.stringify((u1Vcu.data.creators || []).map((c) => c.userId)));
  check("U1: the alumnus at the same school never matches the campus filter", !(u1Vcu.data.creators || []).some((c) => c.userId === alumId), "");
  const u1Alias = await business("GET", "/api/discover?market=Hampton%20Roads&university=" + encodeURIComponent("Virginia Commonwealth University"));
  check("U1: an alias spelling canonicalizes onto the stored school", (u1Alias.data.creators || []).length === 1 && u1Alias.data.creators[0].userId === leadId, "");
  const u1Duke = await business("GET", "/api/discover?market=Hampton%20Roads&university=" + encodeURIComponent("Duke University"));
  check("U1: a school with roster creators but no current students filters to zero", (u1Duke.data.creators || []).length === 0, JSON.stringify((u1Duke.data.creators || []).map((c) => c.userId)));
  const u1Preview = await admin("GET", "/api/admin/preview/discover?market=Hampton%20Roads&university=VCU");
  check("U1: admin preview discover answers with the same filter and facet", (u1Preview.data.creators || []).length === 1 && Array.isArray(u1Preview.data.universities), JSON.stringify(u1Preview.data.universities));

  // ---------- U3: business campus flag (Open to student creators) ----------
  const u3On = await business("PATCH", "/api/me/profile", { studentOpen: true });
  check("U3: business profile PATCH stores studentOpen on the business record", u3On.status === 200 && u3On.data.user.business.studentOpen === true, JSON.stringify(u3On.data.user && u3On.data.user.business));
  const u3Unrelated = await business("PATCH", "/api/me/profile", { about: "A campus table, updated." });
  check("U3: an unrelated profile save never clears the flag", u3Unrelated.status === 200 && u3Unrelated.data.user.business.studentOpen === true, JSON.stringify(u3Unrelated.data.user && u3Unrelated.data.user.business));
  const u3Feed = await lead("GET", "/api/offers");
  const u3Offer = (u3Feed.data.offers || []).find((o) => o.businessId === businessId);
  check("U3: the creator offers feed carries businessStudentOpen for a flagged business", !!u3Offer && JSON.stringify(u3Offer.businessStudentOpen) === JSON.stringify({ open: true }), JSON.stringify(u3Offer && u3Offer.businessStudentOpen));
  const u3Off = await business("PATCH", "/api/me/profile", { studentOpen: false });
  const u3FeedOff = await lead("GET", "/api/offers");
  const u3OfferOff = (u3FeedOff.data.offers || []).find((o) => o.businessId === businessId);
  check("U3: switching the flag off returns the offers attach to null", u3Off.status === 200 && u3Off.data.user.business.studentOpen === false && !!u3OfferOff && u3OfferOff.businessStudentOpen === null, JSON.stringify(u3OfferOff && u3OfferOff.businessStudentOpen));

  // ---------- U2: Campus Lead (5 same-school current-student approved referrals) ----------
  const lead2 = client();
  const lead2Reg = await lead2("POST", "/api/auth/register", fullCreatorBody({
    name: "Duke Lead", email: "dukelead@fixtures.dev", handle: "dukelead",
    university: "Duke University", universityStatus: "Current student",
  }));
  const lead2Id = lead2Reg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: lead2Id, decision: "approve" });
  const u2Ref = async (n, overrides) => {
    const c = client();
    const r = await c("POST", "/api/auth/register", fullCreatorBody({
      name: "Duke Ref " + n, email: `dukeref${n}@fixtures.dev`, handle: `dukeref${n}`,
      university: "Duke University", universityStatus: "Current student", referredBy: "dukelead",
      ...overrides,
    }));
    return { client: c, id: r.data.user.id };
  };
  const refs = [];
  for (let i = 1; i <= 4; i++) refs.push(await u2Ref(i, {}));
  const alumRef = await u2Ref(5, { universityStatus: "alumni" });
  const otherRef = await u2Ref(6, { university: "VCU" });
  let lead2Me = await lead2("GET", "/api/auth/me");
  check("U2: no Campus Lead count before approvals land", !!lead2Me.data.user.ladder.campusLead && lead2Me.data.user.ladder.campusLead.count === 0 && lead2Me.data.user.ladder.campusLead.qualified === false, JSON.stringify(lead2Me.data.user.ladder.campusLead));
  for (const r of refs) await admin("POST", "/api/admin/review", { userId: r.id, decision: "approve" });
  lead2Me = await lead2("GET", "/api/auth/me");
  check("U2: four same-school current-student approvals count, not yet qualified", lead2Me.data.user.ladder.campusLead.count === 4 && lead2Me.data.user.ladder.campusLead.qualified === false && lead2Me.data.user.ladder.campusLead.needed === 1, JSON.stringify(lead2Me.data.user.ladder.campusLead));
  check("U2: momentum summary carries the same campusLead block", JSON.stringify(lead2Me.data.user.momentum.campusLead) === JSON.stringify(lead2Me.data.user.ladder.campusLead), JSON.stringify(lead2Me.data.user.momentum.campusLead));
  await admin("POST", "/api/admin/review", { userId: alumRef.id, decision: "approve" });
  await admin("POST", "/api/admin/review", { userId: otherRef.id, decision: "approve" });
  lead2Me = await lead2("GET", "/api/auth/me");
  check("U2: an alumnus at the school and a current student elsewhere never count", lead2Me.data.user.ladder.campusLead.count === 4 && lead2Me.data.user.ladder.campusLead.qualified === false, JSON.stringify(lead2Me.data.user.ladder.campusLead));
  const fifth = await u2Ref(7, {});
  await admin("POST", "/api/admin/review", { userId: fifth.id, decision: "approve" });
  lead2Me = await lead2("GET", "/api/auth/me");
  check("U2: the fifth qualifying referral earns Campus Lead", lead2Me.data.user.ladder.campusLead.count === 5 && lead2Me.data.user.ladder.campusLead.qualified === true && lead2Me.data.user.ladder.campusLead.university === "Duke University", JSON.stringify(lead2Me.data.user.ladder.campusLead));
  check("U2: the Campus Lead badge rides the badges array", (lead2Me.data.user.badges || []).some((b) => b.id === "campus_lead" && b.kind === "campus" && b.university === "Duke University"), JSON.stringify(lead2Me.data.user.badges));
  check("U2: Campus Lead pays no Momentum of its own (no campus entry ever lands in the ledger)", !(lead2Me.data.user.momentum.ledger || []).some((e) => String(e.kind).includes("campus")) && lead2Me.data.user.momentum.signups === 7 && lead2Me.data.user.momentum.approved === 7, JSON.stringify((lead2Me.data.user.momentum.ledger || []).map((e) => e.kind)));
  const lead2Flip = await lead2("PATCH", "/api/me/profile", { universityStatus: "alumni" });
  const lead2Me2 = await lead2("GET", "/api/auth/me");
  check("U2: the status is computed, so an alumnus referrer loses it on the next read", lead2Flip.status === 200 && lead2Me2.data.user.ladder.campusLead === null && !(lead2Me2.data.user.badges || []).some((b) => b.id === "campus_lead"), JSON.stringify(lead2Me2.data.user.ladder.campusLead));
  check("U2: profile completion is untouched by the layer", lead2Me.data.user.profileCompletion.complete === true, JSON.stringify(lead2Me.data.user.profileCompletion));

  // ---------- U4: Sig campus-moment prompts (client season table) ----------
  const appSrcU4 = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public", "app.js"), "utf8");
  const seasonsMatch = appSrcU4.match(/const CAMPUS_SEASONS = (\[[\s\S]*?\n\];)/);
  check("U4: client ships the campus season table", !!seasonsMatch, "");
  const CAMPUS_SEASONS_U4 = seasonsMatch ? Function("return " + seasonsMatch[1].replace(/;$/, ""))() : [];
  const seasonAt = (m, d) => { const cur = m * 100 + d; for (const s of CAMPUS_SEASONS_U4) { if (cur >= s.from[0] * 100 + s.from[1] && cur <= s.to[0] * 100 + s.to[1]) return s.id; } return null; };
  check("U4: season windows match the generic academic calendar", seasonAt(8, 15) === "move_in" && seasonAt(10, 28) === "homecoming" && seasonAt(1, 10) === "spring_start" && seasonAt(5, 1) === "graduation" && seasonAt(12, 25) === null && seasonAt(6, 15) === null, JSON.stringify(CAMPUS_SEASONS_U4.map((s) => s.id)));
  check("U4: prompt copy names no school and states no month or date", CAMPUS_SEASONS_U4.every((s) => !UNIVERSITY_OPTIONS.some((u) => s.text.includes(u)) && !/January|February|March|April|May|June|July|August|September|October|November|December|\d/.test(s.text)), JSON.stringify(CAMPUS_SEASONS_U4.map((s) => s.text)));
  check("U4: the prompt is gated on the business student flag and dismisses per season", appSrcU4.includes("bz.studentOpen === true") && appSrcU4.includes("signl_campus_prompt:") && appSrcU4.includes("campusSeasonNow()") && appSrcU4.includes("data-sqx"), "");

  const appJsRes = await fetch(BASE + "/app.js");
  const appJs = await appJsRes.text();
  check("U1: client ships the university filter on Discover and its preview twin", appJs.includes("f-university") && appJs.includes("discoverUniversity") && appJs.includes("syncUniversityOptions") && appJs.includes("pvf-university"), "");
  check("client ships dataset autocomplete on signup and profile university fields", appJs.includes("jc-university") && appJs.includes("p-university") && appJs.includes("setupUniversityAutocomplete") && appJs.includes("/data/us-colleges.json") && !appJs.includes("universityDatalistHtml"), "");
  check("client ships the unverified marker for admin", appJs.includes("(unverified)"), "");
  check("client ships the campus badge and exact campus crew line", appJs.includes("campusBadgeHtml") && appJs.includes("Your campus crew:") && appJs.includes("Campus: VCU") === false && appJs.includes("m.campusCrew.university"), "");
  check("client ships university in admin application details", appJs.includes("University:") && appJs.includes("u.creator.university || u.university"), "");
  check("client ships the student-status selects and admin suffix", appJs.includes("jc-university-status") && appJs.includes("p-university-status") && appJs.includes("universityStatusSuffix") && appJs.includes("Your university (if you are a student now)"), "");
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
