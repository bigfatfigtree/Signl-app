#!/usr/bin/env node
// Build -114 verification (branded system email, Jeff 2026-11-03):
// every transactional email that flows through the router's
// deliverEmail now also carries a branded HTML alternative: the
// real SIGNL logo (served from the app's own public assets) over
// the locked site gradient band, with the plain-text wording set
// as the body, unchanged. The text part, subjects and copy are
// untouched; sends that call sendEmail directly without an html
// part (campaign outreach, the internal application notice)
// keep their plain shape.
//
// Proves, without any network:
//   S. source pins: the stamp; deliverEmail builds the HTML part
//      from the same text it sends; email.js exports the wrapper,
//      assembles multipart/alternative only when an html part is
//      present, and keeps the single-part text shape otherwise;
//      FOUNDING_STRIPE_PRICES stays env-or-empty.
//   U. unit: the wrapper output for the REAL approval email
//      (router.approvalEmail) carries the logo img (exact URL,
//      alt, width), all four gradient stops, the 600px card, and
//      the approval wording verbatim with the app link turned
//      into an anchor; the claim-confirmation and password-reset
//      (sign-in link) emails wrap the same way; HTML in a body
//      is escaped, never injected; sendEmail under the mail stub
//      accepts an html part and still reports sent.
//
// Run: node scripts/verify-build114.mjs

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

// ---------- S: source pins ----------
part("S: source pins");
const emailJs = fs.readFileSync(path.join(root, "netlify/functions/lib/email.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
check("stamp is 2026.11.06-139", indexHtml.includes("2026.11.06-139") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.06-139"));
check("deliverEmail passes a branded HTML part built from the same text", routerJs.includes("html: brandedEmailHtml(text)"));
check("router imports brandedEmailHtml from the email layer", routerJs.includes("brandedEmailHtml } = require(\"./email\")"));
check("email.js exports the wrapper and the logo URL", emailJs.includes("brandedEmailHtml") && emailJs.includes("EMAIL_LOGO_URL"));
check("the logo URL is the app's own served asset", emailJs.includes('EMAIL_LOGO_URL = "https://app.joinsignl.com/assets/logo.png"'));
check("multipart assembles only when an html part is present", emailJs.includes("multipart/alternative") && emailJs.includes('contentHeaders = ["Content-Type: text/plain; charset=utf-8"]'));
check("the app asset the URL points at exists in public/", fs.existsSync(path.join(root, "public/assets/logo.png")));
check("FOUNDING_STRIPE_PRICES stays env-or-empty (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'));

// ---------- U: the wrapper on the real templates ----------
part("U: wrapper on real templates");
const { brandedEmailHtml, EMAIL_LOGO_URL, sendEmail } = require(path.join(root, "netlify/functions/lib/email.js"));
const router = require(path.join(root, "netlify/functions/lib/router.js"));

const creator = { name: "Jay Photos", email: "jay@example.com", role: "creator", market: "Austin", city: "Austin", creator: { handle: "photo.jay" } };
const approval = router.approvalEmail(creator, 25);
check("approval subject unchanged", approval.subject === "You are approved: welcome to the SIGNL founding roster", approval.subject);
const html = brandedEmailHtml(approval.text);
check("HTML part is a full document", html.startsWith("<!DOCTYPE html>") && html.includes("</html>"));
check("logo img carries the exact served URL, alt and width", html.includes(`<img src="${EMAIL_LOGO_URL}" width="160" alt="SIGNL"`));
check("gradient band carries all four locked stops", ["#006AFC", "#019BFC", "#03C9AB", "#2FE07E"].every((c) => html.includes(c)));
check("card is email-safe width on white", html.includes("max-width:600px") && html.includes("background-color:#FFFFFF"));
check("approval wording survives verbatim into the HTML body", html.includes("Good news: your application was reviewed and approved. You are now a Founding Creator in Austin"));
check("the app link becomes a tappable anchor (Build -115: the finish-profile deep link)", html.includes('<a href="https://app.joinsignl.com/?open=profile"'));
check("sign-off survives", html.includes("National platforms sell reach. We sell regulars."));

const claim = router.claimConfirmationEmail(creator, 25);
const claimHtml = brandedEmailHtml(claim.text);
check("claim confirmation wraps with the same shell", claimHtml.includes(`src="${EMAIL_LOGO_URL}"`) && claimHtml.includes("max-width:600px"));

const reset = router.passwordResetEmail(creator, "https://app.joinsignl.com/reset?token=abc123");
const resetHtml = brandedEmailHtml(reset.text);
check("sign-in/reset email wraps and its link is an anchor", resetHtml.includes(`src="${EMAIL_LOGO_URL}"`) && resetHtml.includes('<a href="https://app.joinsignl.com/reset?token=abc123"'));

const evil = brandedEmailHtml('Hello <script>alert("x")</script> & goodbye');
check("body HTML is escaped, never injected", !evil.includes("<script>") && evil.includes("&lt;script&gt;") && evil.includes("&amp; goodbye"));

const stubbed = await sendEmail({ to: "jay@example.com", subject: "t", text: "body", html });
check("sendEmail under the stub accepts an html part and reports sent", stubbed.sent === true, JSON.stringify(stubbed));
const stubPlain = await sendEmail({ to: "jay@example.com", subject: "t", text: "body" });
check("sendEmail without an html part still reports sent (plain path intact)", stubPlain.sent === true, JSON.stringify(stubPlain));

console.log(`\nverify-build114: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
