// End-to-end verification of the SIGNL two-step claim flow
// (Jeff, 2026-10-20). Spawns the dev server with a throwaway
// local database, then walks:
//   quick claim (handle + market + email + password + checkboxes)
//   -> pending, profileComplete=false -> admin approves ->
//   approved but INVISIBLE (no /c/ page, no discovery, offers
//   refused both ways) -> profile completed via PATCH -> the flip
//   to complete opens every gate -> a second claimer who never
//   finishes gets exactly ONE day-3 reminder from the sweep ->
//   the admin backfill endpoint audits the roster.
// The full-form sign-up path is exercised alongside to prove it
// still lands complete. Email copy is asserted on the exported
// builders (bodies are never stored), the same pattern the other
// suites use.
// Run: node scripts/verify-quickclaim.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { approvalEmail, claimConfirmationEmail, profileCompletionReminderEmail, profileCompletionFor } = require("../netlify/functions/lib/router.js");

const PORT = 8933;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-quickclaim-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`);
  }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
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
    return { status: res.status, headers: res.headers, data };
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + "/api/bootstrap");
      if (res.ok) return true;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: {
    ...process.env,
    SIGNL_LOCAL: "1",
    SIGNL_LOCAL_DB: DB,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    APP_URL: BASE,
    SIGNL_TEST_ALLOW_BUSINESS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  // ---------- email copy (unit level, exported builders) ----------
  const claimUser = { name: "quickclaim757", email: "q@fixtures.dev", market: "Hampton Roads", city: "", creator: { handle: "quickclaim757", tierBand: "Neighbors", categories: [], localAudiencePct: null, audienceStack: {}, followerCount: 0, totalAudience: 0, bestWork: [], bio: "", hasPhoto: false, neighborhood: "" } };
  const claimMail = claimConfirmationEmail(claimUser, 100);
  check("claim email subject is the claimed-spot framing", claimMail.subject === "Your SIGNL founding spot is claimed", claimMail.subject);
  check("claim email carries the 2-business-day approval promise", claimMail.text.includes("decision or a clear status within 2 business days"));
  check("claim email says the profile is finished after approval", claimMail.text.includes("that is when you finish your profile"));
  check("claim email carries the referral link and signs as Jeff", claimMail.text.includes("https://app.joinsignl.com/?ref=quickclaim757") && claimMail.text.includes("\nJeff\nFounder, SIGNL\n"), claimMail.text);
  check("claim email has no em dashes", !claimMail.text.includes("—") && !claimMail.text.includes("–"));

  const approvalMail = approvalEmail({ name: "Quick Claim", email: "q@fixtures.dev", market: "Hampton Roads", city: "Norfolk", creator: { handle: "quickclaim757", tierBand: "Locals", categories: ["Food & Drink"], localAudiencePct: 55, audienceStack: { instagram: 3000 }, followerCount: 3000, totalAudience: 3000, bestWork: [], bio: "", hasPhoto: false, neighborhood: "" } }, 100);
  check("approval email leads with finishing the profile to be launch-ready", approvalMail.text.includes("finish your profile to be launch-ready"), approvalMail.text);
  check("approval email carries the completion checklist with Momentum values", approvalMail.text.includes("[needed to go live]") && approvalMail.text.includes("Add your profile photo (+10 Momentum points)") && approvalMail.text.includes("Report your local audience % (+5 Momentum points)"), approvalMail.text);
  check("approval email links into the completion flow", approvalMail.text.includes("Sign in and open the Profile tab: https://app.joinsignl.com"));
  check("approval email carries the referral link with +3/+10 and the ordering line", approvalMail.text.includes("https://app.joinsignl.com/?ref=quickclaim757") && approvalMail.text.includes("+3 when a creator joins through your link") && approvalMail.text.includes("+10 when they are approved") && approvalMail.text.includes("Momentum points order the creator list businesses see"), approvalMail.text);
  check("approval email states founding spots lock in sign-up order and signs as Jeff", approvalMail.text.includes("Founding spots lock in sign-up order") && approvalMail.text.includes("\nJeff\nFounder, SIGNL\n"), approvalMail.text);
  check("approval email has no em dashes", !approvalMail.text.includes("—") && !approvalMail.text.includes("–"));

  const reminderMail = profileCompletionReminderEmail(claimUser);
  check("reminder email subject + still-to-do list from the computed missing set", reminderMail.subject === "Finish your SIGNL profile to be launch-ready" && reminderMail.text.includes("Still to do: your home city, your audience counts, your content categories, your local audience %."), reminderMail.text);
  check("reminder email has no em dashes and signs as Jeff", !reminderMail.text.includes("—") && reminderMail.text.includes("\nJeff\nFounder, SIGNL\n"));

  const completionOfClaim = profileCompletionFor(claimUser);
  check("computed completion for a bare claim: incomplete, all four gate items missing", completionOfClaim.complete === false && JSON.stringify(completionOfClaim.missing) === JSON.stringify(["city", "audience", "categories", "local"]), JSON.stringify(completionOfClaim.missing));

  // ---------- step one: the quick claim ----------
  const claimer = client();
  const claim = await claimer("POST", "/api/auth/register", {
    role: "creator",
    quickClaim: true,
    email: "quickclaim@fixtures.dev",
    password: "claim-pass-1234",
    market: "Hampton Roads",
    handle: "quickclaim757",
    referredBy: "foundingfriend",
    ...AGREE,
  });
  check("quick claim registration returns 201", claim.status === 201, JSON.stringify(claim.data));
  const claimerId = claim.data.user && claim.data.user.id;
  check("quick claim starts pending", claim.data.user && claim.data.user.status === "pending");
  check("quick claim is flagged profileComplete=false, signupPath quick_claim", !!claim.data.user && claim.data.user.creator.profileComplete === false && claim.data.user.creator.signupPath === "quick_claim", JSON.stringify(claim.data.user && claim.data.user.creator));
  check("quick claim name falls back to the handle", claim.data.user && claim.data.user.name === "quickclaim757", claim.data.user && claim.data.user.name);
  check("quick claim referral credit persisted (claim links with ?ref= keep working)", claim.data.user && claim.data.user.referredBy === "foundingfriend");
  check("quick claim payload carries profileCompletion (incomplete, 0 of 4 essentials)", !!claim.data.user.profileCompletion && claim.data.user.profileCompletion.complete === false && claim.data.user.profileCompletion.requiredDone === 0 && claim.data.user.profileCompletion.requiredTotal === 4, JSON.stringify(claim.data.user.profileCompletion));

  const noHandle = await client()("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "nohandle@fixtures.dev", password: "claim-pass-1234", market: "Hampton Roads", ...AGREE });
  check("quick claim without a handle is refused (400)", noHandle.status === 400, String(noHandle.status));
  const noTerms = await client()("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "noterms@fixtures.dev", password: "claim-pass-1234", market: "Hampton Roads", handle: "noterms", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: false });
  check("quick claim without the terms agreement is refused (400)", noTerms.status === 400, String(noTerms.status));
  const bizClaim = await client()("POST", "/api/auth/register", { role: "business", quickClaim: true, email: "bizclaim@fixtures.dev", password: "claim-pass-1234", market: "Hampton Roads", handle: "bizclaim", ...AGREE });
  check("quickClaim does not bypass the business form (400 without business fields)", bizClaim.status === 400, String(bizClaim.status));

  // The old full form, untouched: lands complete.
  const full = client();
  const fullReg = await full("POST", "/api/auth/register", {
    role: "creator",
    name: "Full Form",
    email: "fullform@fixtures.dev",
    password: "full-pass-1234",
    market: "Hampton Roads",
    city: "Virginia Beach",
    handle: "fullform757",
    followerCount: 8400,
    localAudiencePct: 62,
    categories: ["Food & Drink"],
    ...AGREE,
  });
  check("full-form registration still returns 201 and lands complete", fullReg.status === 201 && fullReg.data.user.creator.profileComplete === true && fullReg.data.user.creator.signupPath === "full" && fullReg.data.user.profileCompletion.complete === true, JSON.stringify(fullReg.data.user && fullReg.data.user.creator));
  const fullId = fullReg.data.user.id;

  // An unlisted quick claim: the typed city counts, the rest waits.
  const unl = client();
  const unlReg = await unl("POST", "/api/auth/register", {
    role: "creator",
    quickClaim: true,
    email: "tulsa@fixtures.dev",
    password: "claim-pass-1234",
    market: "Not listed yet",
    customCity: "Tulsa",
    customCountry: "United States",
    handle: "tulsaclaims",
    ...AGREE,
  });
  check("unlisted quick claim registers with its typed city and stays incomplete (city not among the missing)", unlReg.status === 201 && unlReg.data.user.city === "Tulsa" && unlReg.data.user.creator.profileComplete === false && !unlReg.data.user.profileCompletion.missing.includes("city"), JSON.stringify(unlReg.data.user && unlReg.data.user.profileCompletion));

  // ---------- admin approval ----------
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");
  const apps = await admin("GET", "/api/admin/applications");
  const pendingClaim = (apps.data.pending || []).find((u) => u.id === claimerId);
  check("admin queue shows the claim as an incomplete profile", !!pendingClaim && pendingClaim.creator.profileComplete === false, JSON.stringify(pendingClaim && pendingClaim.creator));
  const approveClaim = await admin("POST", "/api/admin/review", { userId: claimerId, decision: "approve" });
  check("admin approves the quick claim", approveClaim.status === 200 && approveClaim.data.user.status === "approved");
  const approveFull = await admin("POST", "/api/admin/review", { userId: fullId, decision: "approve" });
  check("admin approves the full-form creator", approveFull.status === 200 && approveFull.data.user.status === "approved");

  const events1 = await admin("GET", "/api/admin/events?limit=500&type=signup_confirmation_email_queued");
  check("claim confirmation email queued at sign-up", (events1.data.events || []).some((e) => e.subjectId === claimerId));
  const events2 = await admin("GET", "/api/admin/events?limit=500&type=approval_email_queued");
  check("approval email queued on approval", (events2.data.events || []).some((e) => e.subjectId === claimerId));
  const eventsPc = await admin("GET", "/api/admin/events?limit=500&type=profile_completed");
  check("no profile_completed event for the quick claim yet (the full form has one)", !(eventsPc.data.events || []).some((e) => e.subjectId === claimerId) && (eventsPc.data.events || []).some((e) => e.subjectId === fullId));

  // ---------- the offer gate: approved but invisible ----------
  const anon = client();
  const pubBefore = await anon("GET", "/api/c/quickclaim757");
  check("public /c/ page 404s for an approved but incomplete creator (identical to pending)", pubBefore.status === 404, String(pubBefore.status));

  const business = client();
  const regB = await business("POST", "/api/auth/register", {
    role: "business",
    name: "Verify Owner",
    businessName: "Claim Gate Table",
    email: "gatebiz@fixtures.dev",
    password: "business-pass-123",
    market: "Hampton Roads",
    city: "Norfolk",
    category: "Restaurant",
    planId: "growth",
    agreedTerms: true,
  });
  const businessId = regB.data.user.id;
  await admin("POST", "/api/admin/review", { userId: businessId, decision: "approve" });
  const activateB = await admin("POST", "/api/admin/businesses/activate", { userId: businessId });
  check("business approved + activated", activateB.status === 200 && activateB.data.user.business.accessState === "active");

  const disc1 = await business("GET", "/api/discover?market=Hampton%20Roads");
  check("discovery hides the incomplete creator, shows the complete one", !(disc1.data.creators || []).some((c) => c.userId === claimerId) && (disc1.data.creators || []).some((c) => c.userId === fullId), JSON.stringify((disc1.data.creators || []).map((c) => c.userId)));

  const directBlocked = await business("POST", "/api/offers", { title: "Too soon", whatComped: "Dinner for two", dollarCap: 75, spots: 1, creatorId: claimerId });
  check("direct offer to an incomplete creator is refused (400, unfinished profile)", directBlocked.status === 400 && /not finished their founding profile/.test(directBlocked.data.error || ""), JSON.stringify(directBlocked.data));
  const paidBlocked = await business("POST", "/api/bookings/paid", { creatorId: claimerId, whatComped: "Paid visit" });
  check("paid booking of an incomplete creator is refused (400)", paidBlocked.status === 400, JSON.stringify(paidBlocked.data));

  const openOffer = await business("POST", "/api/offers", { title: "Open tasting night", whatComped: "Tasting menu for two", dollarCap: 75, spots: 1, visitWindow: "Any evening this week" });
  check("business posts an open offer", openOffer.status === 201, JSON.stringify(openOffer.data));
  const openOfferId = openOffer.data.offer.id;
  const applyBlocked = await claimer("POST", `/api/offers/${openOfferId}/apply`, {});
  check("incomplete creator cannot apply to an open offer (403)", applyBlocked.status === 403 && /Finish your founding profile/.test(applyBlocked.data.error || ""), JSON.stringify(applyBlocked.data));

  // The claimer can still sign in and see the checklist.
  const meInc = await claimer("GET", "/api/auth/me");
  check("incomplete creator signs in and carries the checklist payload", meInc.status === 200 && meInc.data.user.profileCompletion && meInc.data.user.profileCompletion.complete === false && meInc.data.user.creator.profileComplete === false);

  // ---------- step two: finish the profile ----------
  const partial = await claimer("PATCH", "/api/me/profile", { city: "Norfolk" });
  check("partial completion moves progress (city done, still incomplete)", partial.status === 200 && partial.data.user.profileCompletion.complete === false && !partial.data.user.profileCompletion.missing.includes("city") && partial.data.user.profileCompletion.requiredDone === 1, JSON.stringify(partial.data.user && partial.data.user.profileCompletion));
  const finish = await claimer("PATCH", "/api/me/profile", {
    name: "Quinn Claim",
    categories: ["Food & Drink"],
    audienceStack: { instagram: 3000, tiktok: 1200 },
    localAudiencePct: 55,
    bio: "Norfolk food and neighborhood spots, posted honestly and often.",
    neighborhood: "Ghent",
  });
  check("finishing the gate fields flips profileComplete=true with a completion stamp", finish.status === 200 && finish.data.user.creator.profileComplete === true && !!finish.data.user.creator.profileCompletedAt && finish.data.user.profileCompletion.complete === true, JSON.stringify(finish.data.user && finish.data.user.creator));
  check("completion flow records the real name", finish.data.user.name === "Quinn Claim", finish.data.user.name);
  const eventsPc2 = await admin("GET", "/api/admin/events?limit=500&type=profile_completed");
  const flipEvent = (eventsPc2.data.events || []).find((e) => e.subjectId === claimerId);
  check("the completion flip is logged as profile_completed via completion_flow", !!flipEvent && flipEvent.data.via === "completion_flow", JSON.stringify(flipEvent && flipEvent.data));

  const pubAfter = await anon("GET", "/api/c/quickclaim757");
  check("public /c/ page serves 200 once complete", pubAfter.status === 200 && pubAfter.data.profile && pubAfter.data.profile.handle === "quickclaim757", String(pubAfter.status));
  const disc2 = await business("GET", "/api/discover?market=Hampton%20Roads");
  check("discovery shows the creator once complete", (disc2.data.creators || []).some((c) => c.userId === claimerId));
  const applyOk = await claimer("POST", `/api/offers/${openOfferId}/apply`, {});
  check("completed creator can apply to the open offer (201)", applyOk.status === 201, JSON.stringify(applyOk.data));
  const directOk = await business("POST", "/api/offers", { title: "Welcome dinner", whatComped: "Dinner for two", dollarCap: 75, spots: 1, creatorId: claimerId });
  check("direct offer lands once the profile is complete (201)", directOk.status === 201, JSON.stringify(directOk.data));

  // ---------- the day-3 reminder: once, and only when due ----------
  const late = client();
  const lateReg = await late("POST", "/api/auth/register", {
    role: "creator",
    quickClaim: true,
    email: "latefinisher@fixtures.dev",
    password: "claim-pass-1234",
    market: "Hampton Roads",
    handle: "latefinisher757",
    ...AGREE,
  });
  const lateId = lateReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: lateId, decision: "approve" });

  const sweepEarly = await admin("POST", "/api/admin/compliance/sweep", { now: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString() });
  check("reminder sweep at day 2 sends nothing", sweepEarly.status === 200 && sweepEarly.data.profileReminders && sweepEarly.data.profileReminders.sent === 0, JSON.stringify(sweepEarly.data.profileReminders));
  const sweepDue = await admin("POST", "/api/admin/compliance/sweep", { now: new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString() });
  check("reminder sweep at day 4 sends exactly one (the unfinished claimer only)", sweepDue.status === 200 && sweepDue.data.profileReminders && sweepDue.data.profileReminders.sent === 1, JSON.stringify(sweepDue.data.profileReminders));
  const remEvents = await admin("GET", "/api/admin/events?limit=500&type=profile_completion_reminder_email_queued");
  check("reminder email queued for the unfinished claimer, not for anyone complete", (remEvents.data.events || []).filter((e) => e.subjectId === lateId).length === 1 && !(remEvents.data.events || []).some((e) => e.subjectId === claimerId), JSON.stringify((remEvents.data.events || []).map((e) => e.subjectId)));
  const sweepAgain = await admin("POST", "/api/admin/compliance/sweep", { now: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString() });
  check("reminder never fires twice (day 6 sweep sends 0)", sweepAgain.status === 200 && sweepAgain.data.profileReminders.sent === 0, JSON.stringify(sweepAgain.data.profileReminders));

  // ---------- backfill audit ----------
  const backfill = await admin("POST", "/api/admin/profile-backfill", {});
  check("backfill endpoint answers with an audit", backfill.status === 200 && !!backfill.data.audit, JSON.stringify(backfill.data));
  const audit = backfill.data.audit || {};
  check("backfill audit counts the roster honestly (4 creators: 2 complete, 2 incomplete)", audit.creators === 4 && audit.complete === 2 && audit.incomplete === 2, JSON.stringify(audit));
  check("backfill audit names the one approved-but-incomplete creator with their missing fields", Array.isArray(audit.approvedIncomplete) && audit.approvedIncomplete.length === 1 && audit.approvedIncomplete[0].handle === "latefinisher757" && audit.approvedIncomplete[0].missing.includes("categories"), JSON.stringify(audit.approvedIncomplete));
  const bfEvents = await admin("GET", "/api/admin/events?limit=500&type=profile_backfill_completed");
  check("backfill run is logged as an event", (bfEvents.data.events || []).length >= 1);

  // ---------- client ships the two-step surfaces ----------
  const appJsRes = await fetch(BASE + "/app.js");
  const appJs = await appJsRes.text();
  check("client ships the quick claim form + the full-form escape hatch", appJs.includes("Claim your founding spot") && appJs.includes("Claim my founding spot") && appJs.includes("Prefer to complete everything now?") && appJs.includes("quickClaim: true"), "");
  check("client ships the completion checklist card + pending claimed copy", appJs.includes("profileCompletionHtml") && appJs.includes("Finish your profile to be launch-ready") && appJs.includes("Your spot is claimed") && appJs.includes("Needed to go live"), "");
} finally {
  server.kill("SIGTERM");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nQuick claim verification: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("Failures: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
