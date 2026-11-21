// verify-build238.mjs — Build -238: email deep links
// (/?open=profile, /?open=status, /?open=messages) keep their
// destination when the visitor is logged out.
// The bug: the approval email ("Finish your profile:
// https://app.magpielocal.com/?open=profile", "Your founding
// status page: ...?open=status") and the platform-message
// notification email (/?open=messages) link at those params,
// but init() in public/app.js only honoured them when
// state.user already existed at boot. A newly approved creator
// tapping the link logged out got the intro film (muted, no
// controls, so no sound), then the sign-in form, then the
// default dashboard tab — never her profile. Jeff's ruling:
// the acceptance email takes the creator DIRECTLY to her own
// profile: sign in first if needed, then straight there. No
// message page, no video in between. The intro film itself
// stays locked for plain signed-out visits (Build -219a).
// The fix (public/app.js only; the email copy in router.js is
// byte-identical, the links already pointed at the right
// params):
//   1. init() reads the open param once (openParam238); valid
//      targets are exactly "messages", "profile", "status".
//      Signed-in handling is unchanged.
//   2. Logged out with a valid target: the target is stashed
//      in sessionStorage (magpie_pending_open), state.view is
//      set to "signin" so the first paint is the sign-in
//      surface (render() checks the signin view before the
//      intro branch), a plain-words one-shot notice is set on
//      state.googleNotice for renderSignin to show and
//      consume, and introMarkSeen() runs so the film cannot
//      replay later in the session.
//   3. ONE helper, applyPendingOpen238(), applies the stash
//      with the SAME role guards as the signed-in boot code
//      (messages: creator or business, creators landing on the
//      signl-team thread; profile/status: creators only; a
//      role that does not fit just clears the stash). It is
//      called from doSignin, from the ?signinlink= consume
//      block, and at boot when a live session is present with
//      no open param (the Google sign-in return).
// Proven here:
//   A. Source pins — the stash write on logged-out open
//      arrival, the signin view plus the three exact notice
//      strings, introMarkSeen() on that path, the helper and
//      its role guards and consume-once read, the helper's
//      three call sites, the signed-in blocks kept, and the
//      plain-visit path (render() signin check before the
//      intro branch, renderIntro still the logged-out
//      default) untouched. Build stamp 2026.11.21-238 in
//      both homes.
//   B. Template fixtures — the REAL exported approvalEmail
//      still carries the ?open=profile and ?open=status links
//      and its -231 community block (the GROUP_URL join line
//      and the +10 Momentum line), and the REAL exported
//      platformMessageEmail still carries ?open=messages.
//
// Build -239 adjustments (2026-11-21, same-day follow-on):
//   - The three signed-in boot conditionals use the literal
//     params.get("open") === ... form again (the -238 refactor
//     to openParam238 === ... cost one check each in the
//     legacy verify-build40 / verify-build115 source pins;
//     behavior is identical, openParam238 still serves the
//     logged-out and -239 boot paths). The three signed-in
//     pins below pin the literal form.
//   - The helper gained a fourth call site (the generalized
//     signed-in arrival in -239), so the call-site pin counts
//     5 occurrences including the definition.
//   - The stamp pin is "both homes agree, >= 238": -239
//     bumped the stamp to 2026.11.21-239.
// Run: node scripts/verify-build238.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

process.env.SIGNL_LOCAL = "1";
process.env.APP_URL = "https://app.magpielocal.com";

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
const count = (src, needle) => src.split(needle).length - 1;

// --- A: source pins ------------------------------------------
console.log("== A: source pins (public/app.js) ==");
const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

check("open param is read once into openParam238",
  appSrc.includes('const openParam238 = (params.get("open") || "").trim();'), "");
check("signed-in messages block kept exactly (tab + signl-team thread)",
  appSrc.includes('if (params.get("open") === "messages" && state.user && (state.user.role === "creator" || state.user.role === "business"))')
  && appSrc.includes('if (state.user.role === "creator") state.activeThread = "signl-team";'), "");
check("signed-in profile block kept (creators only)",
  appSrc.includes('if (params.get("open") === "profile" && state.user && state.user.role === "creator")'), "");
check("signed-in status block kept (creators only)",
  appSrc.includes('if (params.get("open") === "status" && state.user && state.user.role === "creator")'), "");

const loggedOutAt = appSrc.indexOf('if (!state.user && (openParam238 === "messages" || openParam238 === "profile" || openParam238 === "status"))');
check("logged-out open arrival block exists", loggedOutAt >= 0, "");
const loggedOutBlock = loggedOutAt >= 0 ? appSrc.slice(loggedOutAt, loggedOutAt + 1400) : "";
check("logged-out arrival stashes the target",
  loggedOutBlock.includes("stashPendingOpen238(openParam238);"), loggedOutBlock.slice(0, 200));
check("logged-out arrival sets the signin view (first paint is sign-in, no film)",
  loggedOutBlock.includes('state.view = "signin";'), "");
check("profile notice is the exact approved copy",
  loggedOutBlock.includes('state.googleNotice = "You are approved. Sign in and we will take you straight to your profile so you can finish it.";'), "");
check("status notice is the exact approved copy",
  loggedOutBlock.includes('state.googleNotice = "Sign in and we will take you straight to your founding status page.";'), "");
check("messages notice is the exact approved copy",
  loggedOutBlock.includes('state.googleNotice = "Sign in to read your message from the Magpie team.";'), "");
check("logged-out arrival marks the intro seen so the film cannot replay this session",
  loggedOutBlock.includes("introMarkSeen();"), "");

check("stash key is magpie_pending_open in sessionStorage",
  appSrc.includes('const PENDING_OPEN_KEY_238 = "magpie_pending_open";')
  && appSrc.includes("sessionStorage.setItem(PENDING_OPEN_KEY_238, target)"), "");
check("helper is defined exactly once",
  count(appSrc, "function applyPendingOpen238()") === 1,
  `count=${count(appSrc, "function applyPendingOpen238()")}`);
const helperAt = appSrc.indexOf("function applyPendingOpen238()");
const helperBlock = helperAt >= 0 ? appSrc.slice(helperAt, helperAt + 1800) : "";
check("helper consumes the stash (removeItem before routing)",
  helperBlock.includes("sessionStorage.removeItem(PENDING_OPEN_KEY_238)"), "");
check("helper keeps the stash when there is no session yet",
  helperBlock.includes("if (!state.user) return false;"), "");
check("helper role guard: messages is creator or business, creators on the signl-team thread",
  helperBlock.includes('target === "messages" && (state.user.role === "creator" || state.user.role === "business")')
  && helperBlock.includes('if (state.user.role === "creator") state.activeThread = "signl-team";'), "");
check("helper role guard: profile is creators only",
  helperBlock.includes('target === "profile" && state.user.role === "creator"'), "");
check("helper role guard: status is creators only",
  helperBlock.includes('target === "status" && state.user.role === "creator"'), "");
check("helper is applied in doSignin (before render)",
  appSrc.includes("applyPendingOpen238(); // Build -238: an email deep link stashed while logged out lands now"), "");
check("helper is applied in the ?signinlink= consume block",
  appSrc.includes("applyPendingOpen238(); // Build -238: a stashed email deep link lands now, same as a password sign-in"), "");
check("helper is applied at boot when a live session exists and no open param is present",
  appSrc.includes("if (state.user && !openParam238) applyPendingOpen238();"), "");
check("helper has the three -238 call sites plus the -239 generalized signed-in arrival (and its definition)",
  count(appSrc, "applyPendingOpen238()") === 5,
  `count=${count(appSrc, "applyPendingOpen238()")}`);

const renderAt = appSrc.indexOf("async function render()");
const renderHead = renderAt >= 0 ? appSrc.slice(renderAt, renderAt + 3200) : "";
check("render() checks the signin view before the intro branch",
  renderHead.indexOf('if (state.view === "signin") return renderSignin();') >= 0
  && renderHead.indexOf('if (state.view === "signin") return renderSignin();') < renderHead.indexOf("return renderIntro();"), "");
check("plain logged-out visit still defaults to renderIntro (the locked film)",
  renderHead.includes("return renderIntro();")
  && appSrc.includes('const INTRO_CUT = "/assets/intro/intro-film-v5.mp4";'), "");
check("no notice copy carries an em dash",
  !/googleNotice = "[^"]*—/.test(appSrc), "");

{
  const buildId = (fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").match(/BUILD_ID = "([^"]+)"/) || [])[1] || "";
  const shellId = (fs.readFileSync(path.join(root, "public/index.html"), "utf8").match(/window\.__SIGNL_BUILD__ = "([^"]+)"/) || [])[1] || "";
  const num = Number((buildId.split("-").pop() || "0"));
  check("build stamp agrees in both homes and is >= 238 (bumped by -239)",
    buildId === shellId && num >= 238, `server=${buildId} shell=${shellId}`);
}

// --- B: template fixtures (real router exports) ---------------
console.log("== B: template fixtures (approvalEmail / platformMessageEmail) ==");
const fakeCreator = { id: "u238a", name: "Casey Creator", email: "c238@fixtures.dev", role: "creator", status: "approved", market: "Hampton Roads", city: "Norfolk", creator: { handle: "c238", tierBand: "Locals", categories: ["Food & Drink"], localAudiencePct: 60, followerCount: 3000 } };
const approval = router.approvalEmail(fakeCreator, 100);
check("approval email still links ?open=profile",
  approval.text.includes("https://app.magpielocal.com/?open=profile"), approval.text.slice(0, 300));
check("approval email still links ?open=status",
  approval.text.includes("https://app.magpielocal.com/?open=status"), "");
check("approval email still carries the -231 community join line (GROUP_URL)",
  approval.text.includes("Join here: https://www.facebook.com/groups/1820148515703356"), "");
check("approval email still carries the -231 +10 Momentum line",
  approval.text.includes("That earns you +10 Momentum."), "");
const note = router.platformMessageEmail(fakeCreator, "A sample message from the Magpie team.");
check("platform-message notification email still links ?open=messages",
  note.text.includes("https://app.magpielocal.com/?open=messages"), note.text.slice(0, 300));

console.log(`\nverify-build238: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
