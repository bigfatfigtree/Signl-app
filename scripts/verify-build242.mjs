// verify-build242.mjs — Build -242: two small copy fixes under
// Jeff's rulings of 2026-11-21.
//   1. The platform-message email notice names no person
//      (Jeff, 16:48: "Make the notice generic, just Magpie").
//      The -239 line named the thread sender, but the notice
//      never checks who actually sent from the team thread, so
//      it could misattribute. First body line is now the fixed
//      "You have a new message from Magpie."; the message itself
//      says who it is from. Subject, preview quote, deep link
//      and closing line are unchanged.
//   2. The cold invite emails drop the sign-up-order language
//      (Jeff's no-numbers rule, extended 16:52 on his "least
//      confusing for the creator" standard): campaignMarket-
//      Paragraph no longer says creators join "in sign-up
//      order", and the crossover email no longer says "your
//      spot is held in sign-up order" — it carries the plain
//      founding line instead. (The task brief named campaign-
//      Email for the second change; the line actually lives in
//      crossoverEmail, which is where it was removed.)
// The -241 lifecycle cleanup stays clean. No store writes:
// the builders are pure.
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

console.log("== Build -242: generic message notice + invite emails drop sign-up order ==");
// Build -243 note (2026-11-21): the stamp moved on the same day
// (the Review card/list/table views and bulk approve joined the
// same day's work); the pin is both homes agree and >= 242, the
// house relaxation for same-day follow-on builds.
check("build stamp is >= 2026.11.21-242 and agrees in both homes",
  (() => { const a = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").match(/BUILD_ID = "2026\.11\.21-(\d+)"/); const b = fs.readFileSync(path.join(root, "public/index.html"), "utf8").match(/window\.__SIGNL_BUILD__ = "2026\.11\.21-(\d+)"/); return !!a && !!b && a[1] === b[1] && Number(a[1]) >= 242; })(), "");

// --- 1. platform message notice: generic, no name -----------------
const note = router.platformMessageEmail({ id: "u242a" }, "Loved the spread you posted from the market shoot.");
check("notice first line is the generic Magpie line",
  note.text.split("\n")[0] === "You have a new message from Magpie.", note.text.split("\n")[0]);
check("notice names no person anywhere",
  !note.text.includes("Maggie") && !note.text.includes("Jeff") && !note.text.includes("sent you a message")
  && !note.subject.includes("Maggie") && !note.subject.includes("Jeff"), note.text.slice(0, 200));
check("notice keeps its subject, preview quote, deep link and closing line",
  note.subject === "You have a new message on Magpie"
  && note.text.includes("\"Loved the spread you posted from the market shoot.\"")
  && note.text.includes("Read and reply in Magpie:\nhttps://app.magpielocal.com/?open=messages")
  && note.text.includes("This email is only a notification; the conversation lives in Magpie."), "");
check("notice stays generic even when a sender name is passed",
  router.platformMessageEmail({ id: "u242b" }, "See you Saturday.", "Jeff").text.split("\n")[0] === "You have a new message from Magpie.", "");

// --- 2. invite emails: no sign-up order ---------------------------
const vb = router.campaignEmail({ name: "Maya Reed", handle: "maya757", market: "Virginia Beach", opener: "your Oceanfront food posts" });
check("founding email (Virginia Beach): no sign-up order anywhere", !vb.text.includes("sign-up order") && !vb.subject.includes("sign-up order"), vb.text.slice(0, 300));
check("founding email (Virginia Beach): Hampton Roads paragraph reads naturally without the order claim",
  vb.text.includes("Hampton Roads is a founding market: sign-ups are open now and offers open as the founding roster fills. Founding creators are joining now, and the first ones in get seen first when businesses start choosing."), "");
const rva = router.campaignEmail({ name: "", handle: "rvabites", market: "Richmond", opener: "your Carytown posts" });
check("founding email (Richmond): no sign-up order anywhere", !rva.text.includes("sign-up order") && !rva.subject.includes("sign-up order"), rva.text.slice(0, 300));
check("founding email (Richmond): market paragraph reads naturally without the order claim",
  rva.text.includes("Richmond is a founding market: sign-ups are open now and offers open city by city as the roster fills. Founding creators are joining now, and the first ones in get seen first when businesses start choosing."), "");
const xo = router.crossoverEmail({ name: "Jordan Lee", handle: "jordancreates", market: "Richmond", opener: "your GRIN campaign posts" });
check("crossover email: no sign-up order anywhere", !xo.text.includes("sign-up order") && !xo.subject.includes("sign-up order"), xo.text.slice(0, 300));
check("crossover email: plain founding line replaces the held-spot claim, claim ask intact",
  xo.text.includes("Your founding profile is free. You would be a founding creator here, and that standing never expires. Claim yours here, it takes about two minutes:"), "");
check("invite emails carry no em dashes", !vb.text.includes("—") && !rva.text.includes("—") && !xo.text.includes("—"), "");

// --- 3. the -241 lifecycle cleanup stays clean --------------------
const banned = (t) => !t.includes("sign-up order") && !/in the first \d+/.test(t) && !/first \d+ (creators|founding)/.test(t);
const listed = { id: "u242c", name: "Casey Creator", email: "c242@fixtures.dev", role: "creator", status: "approved", market: "Nashville", city: "Nashville", creator: { handle: "c242", categories: ["Food & Drink"] } };
check("lifecycle emails stay clean (claim, signup, reminder, approval)",
  banned(router.claimConfirmationEmail(listed, 50).text)
  && banned(router.signupConfirmationEmail(listed, 100).text)
  && banned(router.profileCompletionReminderEmail(listed).text)
  && banned(router.approvalEmail(listed, 50).text), "");

// --- source: the old strings are gone from router.js --------------
const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("source: no email copy states sign-up order (old literals gone)",
  !routerSrc.includes("from Magpie sent you a message.")
  && !routerSrc.includes("in sign-up order, and the first ones in")
  && !routerSrc.includes("join in sign-up order")
  && !routerSrc.includes("your spot is held in sign-up order"), "");

console.log(`\nverify-build242: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
