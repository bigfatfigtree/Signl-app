// verify-build240.mjs — Build -240: Jeff's copy ruling on the
// approval email (2026-11-21, added mid-build to the -239
// bundle and shipped stacked on it because -239 was already
// live): "We don't say what number they are." The approval
// email must not state the creator's founding number or
// position: the "first N founding creators" statement and the
// "founding spots are held in sign-up order / shown to
// businesses in that order" statement are removed from BOTH
// approvalEmail branches (listed market + unlisted city).
// Everything else in the email is unchanged, including the
// -239 subject ("You are approved. Welcome to Magpie."), the
// ?open=profile / ?open=status links, and the unlisted
// branch's first-in-line-for-offers line (no number in it).
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

console.log("== Build -240: approval email carries no founding number ==");
check("build stamp is 2026.11.21-240 in both homes",
  fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('BUILD_ID = "2026.11.21-240"')
  && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.21-240"'), "");

const listed = { id: "u240a", name: "Casey Creator", email: "c240@fixtures.dev", role: "creator", status: "approved", market: "Nashville", city: "Nashville", creator: { handle: "c240", categories: ["Food & Drink"] } };
const unlisted = { ...listed, id: "u240b", market: "Not listed yet", city: "Tulsa", state: "OK" };
for (const [label, fixture] of [["listed", listed], ["unlisted", unlisted]]) {
  const m = router.approvalEmail(fixture, 50); // band 50 is the "first 50" case itself
  check(`${label}: no "first 50" statement`, !m.text.includes("first 50") && !m.subject.includes("first 50"), m.text.slice(0, 200));
  check(`${label}: no "sign-up order" statement`, !m.text.includes("sign-up order"), "");
  check(`${label}: no founding number in any form`, !/in the first \d+/.test(m.text) && !/first \d+ founding/.test(m.text), "");
  check(`${label}: no shown-in-that-order statement`, !m.text.includes("shown to businesses in that order"), "");
  check(`${label}: the rest of the email is intact (links, free line, sign-off)`,
    m.text.includes("Finish your profile: https://app.magpielocal.com/?open=profile")
    && m.text.includes("Your founding status page: https://app.magpielocal.com/?open=status")
    && m.text.includes("Magpie is free for creators. Always.")
    && m.text.includes("Jeff"), "");
}
check("listed: subject is the -239 restored subject",
  router.approvalEmail(listed, 50).subject === "You are approved. Welcome to Magpie.", "");
check("unlisted: subject still names the city",
  router.approvalEmail(unlisted, 50).subject === "You are approved: founding creator for Tulsa", "");
check("unlisted: first-in-line-for-offers line kept (it states no number)",
  router.approvalEmail(unlisted, 50).text.includes("When Tulsa opens, founding sign-ups are first in line for offers."), "");

const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const approvalAt = routerSrc.indexOf("function approvalEmail(");
const approvalBlock = approvalAt >= 0 ? routerSrc.slice(approvalAt, approvalAt + 7000) : "";
check("source: the approvalEmail body itself is free of both statements",
  approvalBlock.length > 1000 && !approvalBlock.includes("sign-up order") && !/first \$\{band\}/.test(approvalBlock), "");

console.log(`\nverify-build240: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
