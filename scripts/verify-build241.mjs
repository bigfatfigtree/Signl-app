// verify-build241.mjs — Build -241: Jeff's copy ruling from
// -240 ("We don't say what number they are", 2026-11-21) reaches
// the two creator emails the -240 ship flagged:
//   - claimConfirmationEmail: the band line stated the creator's
//     sign-up number ("You are in the first N creators to sign
//     up...") and that "Founding spots are held in sign-up
//     order". Both are out, in the listed-market and
//     unlisted-city branches; the line now keeps only the
//     founding standing, which never expires. Everything else
//     in the email is unchanged.
//   - profileCompletionReminderEmail: "your founding spot is
//     held in sign-up order" is out; the finish-your-profile
//     ask is intact.
// The same band statement also came out of the sibling signup
// confirmation email (signupConfirmationEmail, both branches):
// it is the other half of the signup pair (the router sends it
// instead of the claim confirmation for full signups), and it
// carried the identical "first N creators to sign up" line.
// Approval stays clean (proven in full by verify-build240).
// No store writes: the builders are pure.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const router = require("../netlify/functions/lib/router.js");
const root = process.cwd();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const banned = (t) => !t.includes("sign-up order") && !/in the first \d+/.test(t) && !/first \d+ (creators|founding)/.test(t);

console.log("== Build -241: claim, signup and reminder emails carry no number or order ==");
check("build stamp is 2026.11.21-241 in both homes",
  fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('BUILD_ID = "2026.11.21-241"')
  && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.21-241"'), "");

const listed = { id: "u241a", name: "Casey Creator", email: "c241@fixtures.dev", role: "creator", status: "pending", market: "Nashville", city: "Nashville", creator: { handle: "c241", categories: ["Food & Drink"] } };
const unlisted = { ...listed, id: "u241b", market: "Not listed yet", city: "Tulsa", state: "OK" };

// --- claim confirmation (band 50 is the "first 50" case itself) ---
for (const [label, fixture, place] of [["listed", listed, "Nashville"], ["unlisted", unlisted, "Tulsa"]]) {
  const m = router.claimConfirmationEmail(fixture, 50);
  check(`claim ${label}: no number, no sign-up order`, banned(m.text) && banned(m.subject), m.text.slice(0, 300));
  check(`claim ${label}: founding standing line kept, without the number`,
    m.text.includes(`You are a founding creator in ${place}, and that founding standing never expires.`), "");
  check(`claim ${label}: the rest of the email is intact`,
    m.subject === "Your Magpie founding spot is claimed"
    && m.text.includes("is claimed, and your application is in the review queue.")
    && m.text.includes("What happens next: when you are approved, we email you again")
    && m.text.includes("Sign in any time to check your status: https://app.magpielocal.com/?open=status")
    && m.text.includes(router.CREATOR_FREE_LINE)
    && m.text.includes("National platforms sell reach. We sell regulars."), "");
}
check("claim with no band still renders and carries no founding line",
  (() => { const m = router.claimConfirmationEmail(listed, null); return banned(m.text) && !m.text.includes("founding standing never expires"); })(), "");

// --- signup confirmation (the sibling half of the signup pair) ---
for (const [label, fixture, place] of [["listed", listed, "Nashville"], ["unlisted", unlisted, "Tulsa"]]) {
  const m = router.signupConfirmationEmail(fixture, 100);
  check(`signup ${label}: no number, no sign-up order`, banned(m.text) && banned(m.subject), m.text.slice(0, 300));
  check(`signup ${label}: founding standing line kept, without the number`,
    m.text.includes(`You are a founding creator in ${place}, and that founding standing never expires.`), "");
  check(`signup ${label}: the rest of the email is intact`,
    m.subject === "Your Magpie founding creator profile is in"
    && m.text.includes("Sign in any time to check your status: https://app.magpielocal.com/?open=status")
    && m.text.includes(router.CREATOR_FREE_LINE), "");
}

// --- profile completion reminder ---
const approvedListed = { ...listed, id: "u241c", status: "approved" };
const approvedUnlisted = { ...unlisted, id: "u241d", status: "approved" };
for (const [label, fixture, place] of [["listed", approvedListed, "Nashville"], ["unlisted", approvedUnlisted, "Tulsa"]]) {
  const m = router.profileCompletionReminderEmail(fixture);
  check(`reminder ${label}: no sign-up order anywhere`, banned(m.text) && banned(m.subject), m.text.slice(0, 300));
  check(`reminder ${label}: opening line keeps the ask, drops the order claim`,
    m.text.includes(`You are approved as a Founding Creator in ${place}. One step is still open: finish your profile, so businesses can see you and send you offers.`), "");
  check(`reminder ${label}: the rest of the email is intact`,
    m.subject === "Finish your Magpie profile to be launch-ready"
    && m.text.includes("Still to do:")
    && m.text.includes("Finish it here: https://app.magpielocal.com/?open=profile"), "");
}

// --- approval stays clean (full proof lives in verify-build240) ---
check("approval still carries no number or order (listed + unlisted)",
  banned(router.approvalEmail(listed, 50).text) && banned(router.approvalEmail(unlisted, 50).text), "");

// --- source: the four lifecycle email bodies are free of both statements ---
const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const starts = ["function signupConfirmationEmail(", "function claimConfirmationEmail(", "function profileCompletionReminderEmail(", "function approvalEmail("].map((s) => routerSrc.indexOf(s));
check("source: all four email builders found", starts.every((i) => i >= 0), JSON.stringify(starts));
for (let i = 0; i < starts.length; i += 1) {
  const end = i + 1 < starts.length ? starts[i + 1] : starts[i] + 7000;
  const block = routerSrc.slice(starts[i], end);
  check(`source: ${["signupConfirmationEmail", "claimConfirmationEmail", "profileCompletionReminderEmail", "approvalEmail"][i]} body is free of both statements`,
    block.length > 500 && !block.includes("sign-up order") && !/first \$\{band\}/.test(block) && !/in the first \$\{/.test(block), "");
}

console.log(`\nverify-build241: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
