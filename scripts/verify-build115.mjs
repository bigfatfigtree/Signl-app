#!/usr/bin/env node
// Build -115 verification (post-approval polish + no-dead-ends,
// Jeff 2026-11-03): the approval email rewritten shorter and
// cleaner (prize first, one plain step, real links, free line,
// launch hype), the day-3 reminder to the same standard, the 9
// audit quick-polish items, and the no-dead-ends sweep: every
// save confirms visibly, empty states carry a next step.
//
// Proves, without any network:
//   S. source pins: the stamp; the new approval/reminder copy
//      and links; the publicpage completion item; detailFor's
//      hasBookedVisit; the client surfaces (Sig copy, checklist
//      info rows, sign-in order, empty states, save toasts, the
//      ?open= deep links); FOUNDING_STRIPE_PRICES env-or-empty.
//   U. unit: the REAL approval email (listed + unlisted) and
//      reminder carry the new copy within the shorter word
//      budget and none of the old checklist bulk; the computed
//      completion keeps the same four gate items with the new
//      optional publicpage row; the Build -114 branded wrapper
//      still renders the new text.
//
// Run: node scripts/verify-build115.mjs

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

process.env.SIGNL_MAIL_STUB = "1";
const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
function seg(src, from, to) {
  const a = src.indexOf(from);
  const b = to ? src.indexOf(to, a + 1) : src.length;
  return a < 0 ? "" : src.slice(a, b < 0 ? src.length : b);
}
const words = (t) => t.split(/\s+/).filter(Boolean).length;

// ---------- S: source pins ----------
part("S: source pins");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
check("stamp is 2026.11.05-133", indexHtml.includes("2026.11.05-133") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.05-133"));

const approvalSeg = seg(routerJs, "function approvalEmail(", "// ---------- rejection email");
check("approval: one plain step, the four basics named", approvalSeg.includes("Four basics make you visible to businesses: your home city, your audience counts, at least one content category, and your local audience %."));
check("approval: real links (profile, status, booking page)", approvalSeg.includes("Finish your profile: https://app.joinsignl.com/?open=profile") && approvalSeg.includes("Your founding status page: https://app.joinsignl.com/?open=status") && approvalSeg.includes("Your public booking page is already live: https://app.joinsignl.com/c/${handle}"));
check("approval: one plain Momentum gloss", approvalSeg.includes("Momentum is the priority score that orders the list businesses see"));
check("approval: the bracketed points checklist is gone", !approvalSeg.includes("completionChecklistLines") && !approvalSeg.includes("[needed to go live]") && !routerJs.includes("Sign in and open the Profile tab"));
check("approval: invite compressed inline, rosterBenefitsLines untouched for claim/signup", approvalSeg.includes("Grow your roster in ${place}: your invite link is") && seg(routerJs, "function rosterBenefitsLines(", "async function foundingSummary").includes("+3 when a creator joins through your link"));

const reminderSeg = seg(routerJs, "function profileCompletionReminderEmail(", "function silentRemovalEmail");
check("reminder: finish link + booking page link, checklist bulk dropped", reminderSeg.includes("Finish it here: https://app.joinsignl.com/?open=profile") && reminderSeg.includes("Your public booking page is already live: https://app.joinsignl.com/c/${handle}") && !reminderSeg.includes("completionChecklistLines"));

check("completion: publicpage step exists, optional, reads the stored flag", routerJs.includes('{ id: "publicpage", label: "Turn on your public booking page", points: null, done: c.publicPage === true, required: false }'));
check("momentum detail: hasBookedVisit computed from the creator's bookings", routerJs.includes("hasBookedVisit: myBookings.length > 0") && routerJs.includes("hasBookedVisit: false"));
check("FOUNDING_STRIPE_PRICES stays env-or-empty (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'));

check("client: publicpage earn row deep-links to the book-me panel", appJs.includes('case "publicpage": return { tab: "Profile", scroll: "bookme-panel" }'));
check("client: penalties footer renders only once a visit is booked", seg(appJs, "function momentumHtml(u)", "function fmtNum").includes("m.hasBookedVisit") && appJs.includes("Late post −10 &middot; No-show −25 &middot; Redeemed, never posted −50."));
check("client: Sig queue caught-up line is role-aware, business string verbatim", appJs.includes("When an offer lands, a visit needs you, or a business replies, it shows up here.") && appJs.includes("When a creator applies, a visit needs you, or a post lands, it shows up here."));
check("client: Sig chat opener speaks creator for creators", appJs.includes("how visits and points run, what you earn, when your market opens"));
check("client: checklist renders info rows and founding step 4 is one", seg(appJs, "function checklistHtml(steps)", "function wireChecklist").includes("s.info") && appJs.includes('info: "Opens at launch"'));
const signinSeg = seg(appJs, "function renderSignin()", "async function doSignin");
check("client: sign-in join lines sit above the staff redeem button", signinSeg.indexOf("Join as a founding creator") > -1 && signinSeg.indexOf("Join as a founding creator") < signinSeg.indexOf("Redeem a creator visit"));
check("client: founding Offers empty state always carries an action", seg(appJs, "function foundingEmptyActionHtml()", "function foundingOffersEmptyHtml").includes("Share your invite") && appJs.includes("Finish your profile") && appJs.includes("Add your rates"));
check("client: direct-offers empty points at the Open offers board", appJs.includes("Offers open to every creator in your market are right below, under Open offers."));
check("client: wallet Cash empty card carries a next step (Build -125 Wallet supersedes the Earnings empty card)", appJs.includes("No cash yet") && appJs.includes("Paid bookings you complete pay out here, in cash.") && appJs.includes("Set your paid rate") && appJs.includes("See offers"));
check("client: lane saves confirm with a toast", seg(appJs, "async function laneSave(patch)", "function laneToggleSpanish").includes('showToast("Saved.")'));
check("client: receipt opt-in confirms and reverts on failure", seg(appJs, "async function receiptSaveOptIn()", "function proofControlsHtml").includes('showToast("Saved.")') && appJs.includes("el.checked = !want"));
check("client: founding ZIP, claim rate and moment saves confirm", seg(appJs, "async function foundingSaveZip()", "// Menu of Moments").includes("showToast") && seg(appJs, "async function saveClaimRate()", "function renderPending()").includes("showToast") && seg(appJs, "async function foundingSetMoment(id)", "// Your first month, planned").includes("showToast"));
check("client: admin queue saves confirm", seg(appJs, "async function saveAttribution(userId)", "async function fileUnderMarket").includes('showToast("Saved.")') && seg(appJs, "async function saveReviewLinks(userId)", "async function saveDiscountSetting").includes('showToast("Saved.")') && seg(appJs, "async function saveDiscountSetting(userId)", "async function setTester").includes('showToast("Saved.")') && seg(appJs, "async function saveAdvertiserPermit(userId, status)").includes('showToast("Saved.")'));
check("client: under-500 held screen drops the word counted", appJs.includes("your total right now is") && !appJs.includes("counted total right now"));
check("client: ?open=profile and ?open=status land creators on the named tab", appJs.includes('params.get("open") === "profile"') && appJs.includes('params.get("open") === "status"'));

// ---------- U: the real email builders ----------
part("U: email builders");
const router = require(path.join(root, "netlify/functions/lib/router.js"));
const { brandedEmailHtml } = require(path.join(root, "netlify/functions/lib/email.js"));

const listed = { name: "Quick Claim", email: "q@fixtures.dev", market: "Hampton Roads", city: "Norfolk", creator: { handle: "quickclaim757", tierBand: "Locals", categories: ["Food & Drink"], localAudiencePct: 55, audienceStack: { instagram: 3000 }, followerCount: 3000, totalAudience: 3000, bestWork: [], bio: "", hasPhoto: false, neighborhood: "" } };
const aListed = router.approvalEmail(listed, 100);
check("approval (listed): subject unchanged", aListed.subject === "You are approved: welcome to the SIGNL founding roster", aListed.subject);
check("approval (listed): lead sentence verbatim", aListed.text.includes("Good news: your application was reviewed and approved. You are now a Founding Creator in Hampton Roads"));
check("approval (listed): shorter than the old 398 words", words(aListed.text) < 300, `${words(aListed.text)} words`);
check("approval (listed): prize, step, gloss, hype, free line, invite all present", aListed.text.includes("first 100 founding creators") && aListed.text.includes("finish your profile to be launch-ready") && aListed.text.includes("Momentum is the priority score") && aListed.text.includes("founding creators get first pick of every offer") && aListed.text.includes(router.CREATOR_FREE_LINE) && aListed.text.includes("+3 when a creator joins through your link") && aListed.text.includes("+10 when they are approved") && aListed.text.includes("roster standing is part of the order they see"), aListed.text);
check("approval (listed): no checklist bulk, no em dashes, no lock language", !aListed.text.includes("[needed to go live]") && !aListed.text.includes("—") && !/\block(ed|s|ing)?\b/i.test(aListed.text));

const unlisted = { name: "Tulsa Creator", email: "t@fixtures.dev", market: "Not listed yet", city: "Tulsa", creator: { handle: "tulsaeats", tierBand: "Locals" } };
const aUnlisted = router.approvalEmail(unlisted, 100);
check("approval (unlisted): shorter than the old 380 words, hype lands founding-first", words(aUnlisted.text) < 290 && aUnlisted.text.includes("the moment Tulsa opens, we email you again, founding creators first"), `${words(aUnlisted.text)} words`);

const bare = { name: "quickclaim757", email: "q@fixtures.dev", market: "Hampton Roads", city: "", creator: { handle: "quickclaim757", tierBand: "Neighbors", categories: [], localAudiencePct: null, audienceStack: {}, followerCount: 0, totalAudience: 0, bestWork: [], bio: "", hasPhoto: false, neighborhood: "" } };
const rem = router.profileCompletionReminderEmail(bare);
check("reminder: subject + computed still-to-do line unchanged", rem.subject === "Finish your SIGNL profile to be launch-ready" && rem.text.includes("Still to do: your home city, your audience counts, your content categories, your local audience %."), rem.text);
check("reminder: about half the old 204 words", words(rem.text) <= 130, `${words(rem.text)} words`);
check("reminder: finish link + booking page link present, no checklist bulk", rem.text.includes("https://app.joinsignl.com/?open=profile") && rem.text.includes("https://app.joinsignl.com/c/quickclaim757") && !rem.text.includes("[needed to go live]"));

const completion = router.profileCompletionFor(bare);
check("completion: gate unchanged (4 required, same missing set)", completion.requiredTotal === 4 && JSON.stringify(completion.missing) === JSON.stringify(["city", "audience", "categories", "local"]), JSON.stringify(completion.missing));
const ppItem = (completion.items || []).find((i) => i.id === "publicpage");
check("completion: publicpage row present, optional, not done without the flag", !!ppItem && ppItem.required === false && ppItem.done === false);
const completionOn = router.profileCompletionFor({ ...bare, creator: { ...bare.creator, publicPage: true } });
check("completion: publicpage reads done once the page is on", ((completionOn.items || []).find((i) => i.id === "publicpage") || {}).done === true);

const html = brandedEmailHtml(aListed.text);
check("wrapper: the new approval text still renders branded (logo, card, tappable links)", html.includes("https://app.joinsignl.com/assets/logo.png") && html.includes("max-width:600px") && html.includes('<a href="https://app.joinsignl.com/?open=profile"') && html.includes('<a href="https://app.joinsignl.com/c/quickclaim757"'), html.slice(0, 200));

console.log(`\nBuild -115 verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
