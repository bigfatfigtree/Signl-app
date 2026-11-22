// verify-build223.mjs — Build -223: founding-home, claim-hook
// and creator-email copy cleanup (leftovers from -222).
// Copy ONLY (founder order, 2026-11-20): the same plain-words
// treatment as -222 applied to three leftovers:
//   - Founding home hero: "You are on the founding roster"
//     -> "You are a founding creator", "lock your founding
//     spot" -> "hold your place".
//   - Pre-claim hook: count labels drop "neighbors" for
//     "of your followers live in" / "potential local
//     followers", "Your founding spot in" -> "Your place as
//     a founding creator in", CTA "Claim my founding spot"
//     -> "Claim my place".
//   - Creator emails: approval subject -> "You are in.
//     Welcome to Magpie.", "roster" invite/benefits wording
//     -> "founding circle" / "your standing", recruiter and
//     rejection lines drop "founding roster" / "roster".
// No data, logic, counts or features change. US spelling.
// No em dashes in email copy. Stamp 2026.11.20-223.
// Run: node scripts/verify-build223.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const idxHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 220) : ""}`); }
}

console.log("== stamp ==");
check("build stamp is 2026.11.20-225 (lib + shell; bumped by Build -225)", buildJs.includes('BUILD_ID = "2026.11.20-225"') && (idxHtml.match(/2026\.11\.20-225/g) || []).length >= 5, `index count=${(idxHtml.match(/2026\.11\.20-225/g) || []).length}`);
check("no 2026.11.20-223 left in build.js or index.html", !buildJs.includes("2026.11.20-223") && !idxHtml.includes("2026.11.20-223"));

console.log("== founding home hero ==");
const fhStart = appJs.indexOf("function renderFoundingHome()");
const fhEnd = appJs.indexOf("function receiptFoundingHtml()");
const fh = fhStart >= 0 && fhEnd > fhStart ? appJs.slice(fhStart, fhEnd) : "";
check("founding home slice found", fh.length > 1000, `len=${fh.length}`);
check("hero (unlisted): founding creator + hold your place", fh.includes("You are a founding creator, and ${f.city} is building right now. Finish your profile to hold your place. First pick goes to completed founding profiles."));
check("hero (listed): founding creator in market", fh.includes("You are a founding creator in ${marketTalkNameClient(f.market)}. We email you the moment it opens."));
check("hero fallback: You are a founding creator.", fh.includes('"You are a founding creator."'));
check("founding home carries no 'on the founding roster' or 'founding spot'", !fh.includes("on the founding roster") && !fh.includes("founding spot"));

console.log("== pre-claim hook ==");
const hookStart = appJs.indexOf("function renderClaimHook()");
const hookEnd = appJs.indexOf("function claimHookGo()");
const hook = hookStart >= 0 && hookEnd > hookStart ? appJs.slice(hookStart, hookEnd) : "";
check("hook slice found", hook.length > 500, `len=${hook.length}`);
check("count label (live): of your followers live in", hook.includes("T(`of your followers live in ${marketLabel}`, `de tus seguidores viven en ${marketLabel}`)"));
check("count label (extrapolated): potential local followers in", hook.includes("T(`potential local followers in ${marketLabel}`, `seguidores locales potenciales en ${marketLabel}`)"));
check("founding line opener: Your place as a founding creator in", hook.includes('${T("Your place as a founding creator in", "Tu lugar como creadora fundadora en")}'));
// Build -250 re-pin (Jeff's NO-NUMBER rule, -249 reviewer addition): the
// founding-order clause was deliberately REMOVED from this line; the pin
// now holds the new second half verbatim and asserts the old language
// (and the server "N out of 10" localWords line) is gone from the hook.
check("founding line second half (number-free, -250)", hook.includes("is waiting. Founding creators see offers first.") && !hook.includes("recorded in founding order") && !hook.includes("localWords"));
check("CTA: Claim my place", hook.includes('T("Claim my place", "Reclamar mi lugar")'));
// Note: the bare substring "neighbors in" also occurs in the
// untouched inversion line ("but fewer neighbors in ..."),
// which is out of scope for -223, so the absence check is
// pinned to the old count-label template itself.
check("hook old labels gone", !hook.includes("T(`neighbors in ${marketLabel}`") && !hook.includes("`neighbors in ${marketLabel}`") && !hook.includes("total potential neighbors") && !hook.includes("Your founding spot in") && !hook.includes("Claim my founding spot"));

console.log("== creator emails ==");
const emStart = routerJs.indexOf("function rosterBenefitsLines");
const emEnd = routerJs.indexOf("function sweepMemoFresh", routerJs.indexOf("function recruiterKitEmail"));
const emailRegion = emStart >= 0 && emEnd > emStart ? routerJs.slice(emStart, emEnd) : "";
check("email region slice found (benefits through recruiter kit, incl. approval + rejection)", emailRegion.length > 1000 && emailRegion.includes("function approvalEmail") && emailRegion.includes("function rejectionEmail") && emailRegion.includes("function recruiterKitEmail"), `len=${emailRegion.length}`);
// Build -239 fold-in B (2026-11-21): the subject was deliberately changed to
// "You are approved. Welcome to Magpie." (the Jess case); these pins follow.
check("approval subject, verbatim", emailRegion.includes('const subject = "You are approved. Welcome to Magpie.";'));
check("no em dash in the new email subject", !"You are approved. Welcome to Magpie.".includes("—") && !emailRegion.includes('const subject = "You are approved. Welcome to Magpie. —'));
check("approval invite: founding circle + your standing", emailRegion.includes("Grow your founding circle in ${place}: your invite link is ${inviteUrl}. Creators who join through it are credited to you: +3 when a creator joins through your link, +10 when they are approved, and your standing is part of the order they see."));
check("benefits: founding circle opener", emailRegion.includes("Grow your founding circle in ${place}, and get seen first:"));
check("benefits: credited to you", emailRegion.includes("is credited to you, and you earn Momentum points"));
check("benefits: bigger circle + your standing", emailRegion.includes("A bigger circle moves you up: when businesses in your market start choosing creators, your standing is part of the order they see."));
check("recruiter: founding creator in place", emailRegion.includes("You are a Magpie founding creator in ${place}, approved before the market opens"));
check("recruiter: founding creator either way", emailRegion.includes("You are a founding creator either way, and first pick of offers stays yours."));
check("rejection: wave of founding creators", emailRegion.includes("your audience is still small for this wave of founding creators"));
check("rejection: this round is being built around", emailRegion.includes("your content is not the fit this round is being built around"));
check("rejection: we start with the creators closest", emailRegion.includes("we start with the creators closest to the businesses opening first"));
const oldEmailStrings = [
  "welcome to the Magpie founding roster",
  "Grow your roster",
  "credited to your roster",
  "A bigger roster moves you up",
  "roster standing is part of the order they see",
  "You are on the Magpie founding roster",
  "You are on the founding roster either way",
  "wave of the founding roster",
  "this round of the roster is being built around",
  "founding rosters start with",
];
for (const old of oldEmailStrings) {
  check(`email region: old string absent: ${old}`, !emailRegion.includes(old));
}

console.log(`\nBuild -223 verify: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
