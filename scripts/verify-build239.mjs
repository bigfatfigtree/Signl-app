// verify-build239.mjs — Build -239: the email-journey audit
// punch list, items 2–10 (Jeff approved the full list,
// 2026-11-21). Build -238 fixed the three ?open= deep links;
// this build generalizes the landing system and closes the
// business silence the audit found.
//
//   2. Email arrivals skip the intro film (Jeff's ruling):
//      ANY arrival carrying a query param paints the sign-in
//      surface first and marks the film seen. The plain cold
//      root visit keeps the locked F2 film (Build -219a),
//      untouched.
//   3. The notify.js family deep-links: open targets for
//      visits / offers / deals / applications / licences /
//      counter / discover ride the -238 stash (generalized in
//      applyPendingOpen238), and every rail email body links
//      at the surface its own words name.
//   4. Compliance reminders (stages 1–3) carry the visits link.
//   5. The offer-nudge email carries the offer-card link.
//   6. Business silence closed: (a) a business registration
//      and a site safety-net application both send the
//      applicant a confirmation email; (b) the Admin Review
//      handler's mail branch covers businesses — approval and
//      rejection, business-worded, the approval linking at
//      the business profile and its offers home.
//   7. The -238 stash is hardened across tabs: localStorage
//      envelope, 30-minute expiry, read when the per-tab
//      sessionStorage copy is absent.
//   8. platformMessageEmail's sender line names the actual
//      thread sender: Maggie for team messages, not a
//      hard-coded Jeff.
//   9. The staff notice carries the Counter deep link.
//  10. No email path still serves the film after item 2
//      (every email link now carries a param), so the film
//      itself is unchanged — no poster-first work needed.
//
// Proven here:
//   A. Client source pins — the generalized stash (dual
//      write, cross-tab read, consume), the new target
//      branches, the signed-in + logged-out boot blocks and
//      their exact notices, the any-param film rule, and the
//      plain-visit film lock intact.
//   B. Builder fixtures — the REAL notify render for every
//      event type links its named target and no bare root;
//      the REAL router builders (platform message, compliance
//      x3, post-performance pair, signup/claim confirmations,
//      win-back, the three new business builders) carry the
//      right links and no em dashes.
//   C. Router source pins — the wiring: offer-nudge link,
//      staff-notice link, review-handler business branches,
//      both confirmation call sites, zero bare-root
//      "Open Magpie:" lines left in email bodies.
//   D. Behavioral — a business registers and IS emailed a
//      confirmation; an admin approval emails the business;
//      a rejection emails the business; a safety-net
//      application emails the applicant (event data proves
//      the send) while the honeypot still sends nothing.
// Run: node scripts/verify-build239.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build239-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.SIGNL_MAIL_STUB = "1";
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["verify", "admin", "pass"].join("-");
process.env.APP_URL = "https://app.magpielocal.com";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const router = require("../netlify/functions/lib/router.js");
const notifyLib = require("../netlify/functions/lib/notify.js");
const { handler } = require("../netlify/functions/api.js");
const root = process.cwd();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const count = (src, needle) => src.split(needle).length - 1;
const noEmDash = (t) => !String(t).includes("—");

// --- A: client source pins ------------------------------------
console.log("== A: client source pins (public/app.js) ==");
const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

check("stash TTL is 30 minutes (the sign-in link's own lifetime)",
  appSrc.includes("const PENDING_OPEN_TTL_239 = 30 * 60 * 1000;"), "");
check("stash dual-writes the localStorage envelope",
  appSrc.includes("localStorage.setItem(PENDING_OPEN_KEY_238, JSON.stringify({ t: target, exp: Date.now() + PENDING_OPEN_TTL_239 }))"), "");
check("helper falls back to the cross-tab envelope (parse + expiry)",
  appSrc.includes("const env = JSON.parse(raw);")
  && appSrc.includes('if (env && typeof env.t === "string" && env.exp && Date.now() < env.exp) target = env.t;'), "");
check("helper consumes BOTH stores",
  appSrc.includes("sessionStorage.removeItem(PENDING_OPEN_KEY_238)")
  && appSrc.includes("localStorage.removeItem(PENDING_OPEN_KEY_238)"), "");

const helperAt = appSrc.indexOf("function applyPendingOpen238()");
const helperBlock = helperAt >= 0 ? appSrc.slice(helperAt, helperAt + 4200) : "";
for (const [target, role, tab] of [
  ["profile", "business", "Profile"],
  ["visits", "creator", "My Visits"],
  ["visits", "business", "Visits & Posts"],
  ["offers", "creator", "Find Offers"],
  ["offers", "business", "My Offers"],
  ["deals", "creator", "Offers"],
  ["deals", "business", "My Offers"],
  ["applications", "business", "My Offers"],
  ["licences", "creator", "Earnings"],
  ["licences", "business", "Visits & Posts"],
  ["counter", "business", "Counter"],
  ["discover", "business", "Discover"],
]) {
  check(`helper branch: ${target} for a ${role} lands on ${tab}`,
    helperBlock.includes(`target === "${target}" && state.user.role === "${role}"`)
    && helperBlock.includes(`state.tab = "${tab}";`), "");
}
check("helper sets the segment state for business deals + applicants and creator deals",
  helperBlock.includes('if (target === "deals" && state.user.role === "business") {\n    state.offersSeg = "deals";')
  && helperBlock.includes('state.offersSeg = "applicants";')
  && helperBlock.includes('state.crOffersSeg = "deals";'), "");

check("generalized target list is the seven new targets",
  appSrc.includes('const OPEN_TARGETS_239 = ["visits", "offers", "deals", "applications", "licences", "counter", "discover"];'), "");
check("signed-in generalized arrival rides stash + apply",
  appSrc.includes('if (state.user && (OPEN_TARGETS_239.includes(openParam238) || (openParam238 === "profile" && state.user.role === "business")))'), "");
check("logged-out generalized arrival stashes and paints sign-in",
  appSrc.includes("if (!state.user && OPEN_TARGETS_239.includes(openParam238))")
  && appSrc.includes("state.googleNotice = OPEN_NOTICES_239[openParam238] || \"\";"), "");
for (const [t, notice] of [
  ["visits", "Sign in and we will take you straight to your visits."],
  ["offers", "Sign in and we will take you straight to the offer this email is about."],
  ["deals", "Sign in and we will take you straight to the deal this email is about."],
  ["applications", "Sign in and we will take you straight to the applications waiting on you."],
  ["licences", "Sign in and we will take you straight to the licence this email is about."],
  ["counter", "Sign in and we will take you straight to your Counter."],
  ["discover", "Sign in and we will take you straight to Find creators."],
]) {
  check(`logged-out notice for ${t} is the exact approved copy`,
    appSrc.includes(`${t}: "${notice}"`), "");
}
check("any-param arrival skips the film (signin first paint + intro marked seen)",
  appSrc.includes('if (!state.user && state.view === "home" && location.search.length > 1) {\n      state.view = "signin";\n      introMarkSeen();\n    }'), "");
check("the plain cold open still defaults to the locked film",
  appSrc.includes('const INTRO_CUT = "/assets/intro/intro-film-v5.mp4";')
  && appSrc.includes("if (state.introSkipped) return renderHome();\n    return renderIntro();"), "");
check("no new notice copy carries an em dash",
  !/OPEN_NOTICES_239 = \{[^}]*—/.test(appSrc), "");

check("build stamp is 2026.11.21-239 in both homes",
  fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('BUILD_ID = "2026.11.21-239"')
  && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.21-239"'), "");

// --- B: builder fixtures --------------------------------------
console.log("== B: builder fixtures (notify rail + router builders) ==");
const EXPECTED_OPEN = {
  creator_offer_new: "offers", creator_early_access: "offers", creator_booked: "visits",
  post_clock_started: "visits", post_clock_12h: "visits", licence_waiting_creator: "licences",
  business_applications_waiting: "applications", business_licence_waiting: "licences",
  roster_drop: "discover", licence_expiring: "licences",
  creator_deal_new: "deals", creator_deal_countered: "deals", creator_deal_resolved: "deals", creator_deal_expired: "deals",
  business_deal_countered: "deals", business_deal_resolved: "deals", business_deal_expired: "deals",
  creator_match_alert: "offers", creator_coupon_expired: "visits",
};
const payload = { businessName: "Biz", offerTitle: "Title", creatorName: "Casey", endsOn: "Friday", postTitle: "A post", count: 2, market: "Nashville" };
for (const [type, target] of Object.entries(EXPECTED_OPEN)) {
  const r = notifyLib.render(type, payload);
  check(`notify ${type} email links ?open=${target} and no bare root`,
    r.email.includes(`https://app.magpielocal.com/?open=${target}`)
    && !/app\.magpielocal\.com(?!\/\?)/.test(r.email), r.email.slice(-140));
}

const fakeCreator = { id: "u239a", name: "Casey Creator", email: "c239@fixtures.dev", role: "creator", status: "approved", market: "Nashville", creator: { handle: "c239", categories: ["Food & Drink"] } };
const pm = router.platformMessageEmail(fakeCreator, "A sample message from the Magpie team.");
check("platform message email names Maggie (the team thread's actual sender)",
  pm.text.split("\n")[0] === "Maggie from Magpie sent you a message.", pm.text.split("\n")[0]);
check("platform message email honours an explicit sender and never hard-codes Jeff",
  router.platformMessageEmail(fakeCreator, "Hi.", "Sam").text.split("\n")[0] === "Sam from Magpie sent you a message."
  && !pm.text.includes("Jeff from Magpie sent you"), "");

const fakeBooking = { businessName: "Cafe Fixture", postDeadline: new Date(Date.now() + 86400000).toISOString(), whatComped: "Dinner for two", dollarCap: 85 };
for (const stage of [1, 2, 3]) {
  const m = router.complianceReminderEmail(fakeCreator, fakeBooking, stage);
  check(`compliance reminder stage ${stage} carries the visits link`,
    m.text.includes("Open My Visits: https://app.magpielocal.com/?open=visits") && noEmDash(m.text), m.subject);
}
check("post-performance emails link My Visits",
  router.postPerformanceEmail(fakeCreator, fakeBooking).text.includes("Sign in: https://app.magpielocal.com/?open=visits")
  && router.postPerformanceUpdateEmail(fakeCreator, fakeBooking).text.includes("Sign in: https://app.magpielocal.com/?open=visits"), "");
check("signup + claim confirmations link the status page",
  router.signupConfirmationEmail(fakeCreator, 100).text.includes("https://app.magpielocal.com/?open=status")
  && router.claimConfirmationEmail(fakeCreator, 100).text.includes("https://app.magpielocal.com/?open=status"), "");
check("win-back links the profile it asks them to finish",
  router.winBackEmail({ ...fakeCreator, role: "business", business: { businessName: "Biz" } }).text.includes("Sign in here: https://app.magpielocal.com/?open=profile"), "");

const fakeBiz = { id: "u239b", name: "Sam Owner", email: "b239@fixtures.dev", role: "business", status: "pending", market: "Nashville", business: { businessName: "Sam's Tacos" } };
const bizApproval = router.businessApprovalEmail(fakeBiz);
check("business approval email links profile + offers and carries no em dash",
  bizApproval.text.includes("Finish your business profile: https://app.magpielocal.com/?open=profile")
  && bizApproval.text.includes("See your offers home: https://app.magpielocal.com/?open=offers")
  && bizApproval.text.includes("Nothing is charged until your market opens to bookings.")
  && noEmDash(bizApproval.text) && noEmDash(bizApproval.subject), bizApproval.text.slice(0, 200));
const bizConfirmAcct = router.businessApplicationConfirmationEmail({ first: "Sam", businessName: "Sam's Tacos", placeLine: "Nashville is a founding market.", hasAccount: true });
check("business confirmation (account path) carries the status sign-in link",
  bizConfirmAcct.subject === "Your Magpie founding business application is in"
  && bizConfirmAcct.text.includes("Sign in any time to check your status: https://app.magpielocal.com/?src=email")
  && bizConfirmAcct.text.includes("reviewed by a person")
  && noEmDash(bizConfirmAcct.text), "");
const bizConfirmNoAcct = router.businessApplicationConfirmationEmail({ first: "Sam", businessName: "Sam's Tacos", hasAccount: false });
check("business confirmation (site path) promises the sign-in by email instead of a link it cannot use",
  bizConfirmNoAcct.text.includes("When you are approved, we email you again with your sign-in and your next steps.")
  && !bizConfirmNoAcct.text.includes("?src=email")
  && noEmDash(bizConfirmNoAcct.text), "");
const bizRejection = router.businessRejectionEmail(fakeBiz);
check("business rejection email is honest, brief and human",
  bizRejection.text.includes("reviewed by a person, and it is not a fit for this round")
  && bizRejection.text.includes("Reply to this email and a person will look again.")
  && noEmDash(bizRejection.text), "");

// --- C: router source pins ------------------------------------
console.log("== C: router source pins (wiring) ==");
const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("offer-nudge email carries the offer-card link",
  routerSrc.includes("Open the offer card: https://app.magpielocal.com/?open=offers"), "");
check("staff notice carries the Counter link",
  routerSrc.includes("Open the Counter: https://app.magpielocal.com/?open=counter"), "");
check("review handler has BOTH business mail branches",
  routerSrc.includes('if (b.decision === "reject" && target.role === "business")')
  && routerSrc.includes('if (b.decision === "approve" && target.role === "business")')
  && routerSrc.includes("const mail = businessApprovalEmail(target);")
  && routerSrc.includes("const mail = businessRejectionEmail(target);"), "");
check("business confirmation is wired at BOTH application doors (registration + safety net)",
  count(routerSrc, "businessApplicationConfirmationEmail({") === 2, `count=${count(routerSrc, "businessApplicationConfirmationEmail({")}`);
check("safety net records the applicant send outcome",
  routerSrc.includes("applicantEmailSent, applicantEmailReason") && routerSrc.includes("applicantEmailSent, lang: rec.lang || null"), "");
check("morning-after email links the visit",
  routerSrc.includes("Open Magpie: https://app.magpielocal.com/?open=visits"), "");
check("zero bare-root Open Magpie lines remain in router email bodies",
  !routerSrc.includes('"Open Magpie: https://app.magpielocal.com"'), "");

// --- D: behavioral fixtures -----------------------------------
console.log("== D: behavioral (register, review, safety net) ==");
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method, path: url.pathname, headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body), isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = res.body; }
    return { status: res.statusCode, data };
  };
}
async function allEvents() {
  const rows = await store.list("event:");
  return rows.map((r) => r.value).filter(Boolean);
}
async function emailsSentTo(userId) {
  return (await allEvents()).filter((e) => e.subjectId === userId && /_email_sent$/.test(e.type));
}

const admin = makeClient();
const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
check("admin signs in", login.status === 200, `${login.status}`);

const bizClient = makeClient();
const reg = await bizClient("POST", "/api/auth/register", { role: "business", name: "Sam Owner", email: "sam239@fixtures.dev", password: ["sam239", "pass", "123"].join("-"), businessName: "Sam's Tacos", category: "Food & Drink", market: "Nashville", city: "Nashville", agreedTerms: true });
check("business registration succeeds", reg.status === 201, `${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
const bizId = reg.data && reg.data.user && reg.data.user.id;
const regMails = bizId ? await emailsSentTo(bizId) : [];
check("the registering business IS emailed a confirmation (signup_confirmation_email_sent)",
  regMails.some((e) => e.type === "signup_confirmation_email_sent"), JSON.stringify(regMails.map((e) => e.type)));

const approve = await admin("POST", "/api/admin/review", { userId: bizId, decision: "approve" });
check("admin approval of the business succeeds", approve.status === 200, `${approve.status}`);
const apprMails = bizId ? await emailsSentTo(bizId) : [];
check("the approved business IS emailed its approval (approval_email_sent)",
  apprMails.some((e) => e.type === "approval_email_sent"), JSON.stringify(apprMails.map((e) => e.type)));

const biz2Client = makeClient();
const reg2 = await biz2Client("POST", "/api/auth/register", { role: "business", name: "Pat Baker", email: "pat239@fixtures.dev", password: ["pat239", "pass", "123"].join("-"), businessName: "Pat's Bakery", category: "Food & Drink", market: "Nashville", city: "Nashville", agreedTerms: true });
const biz2Id = reg2.data && reg2.data.user && reg2.data.user.id;
const reject = await admin("POST", "/api/admin/review", { userId: biz2Id, decision: "reject" });
check("admin rejection of the business succeeds", reject.status === 200, `${reject.status}`);
const rejMails = biz2Id ? await emailsSentTo(biz2Id) : [];
check("the rejected business IS emailed its rejection (rejection_email_sent)",
  rejMails.some((e) => e.type === "rejection_email_sent"), JSON.stringify(rejMails.map((e) => e.type)));

const fa = makeClient();
const app1 = await fa("POST", "/api/founding-application", { business_name: "Proof Tacos", contact_name: "Pat Proof", email: "pat@prooftacos239.dev", city: "Norfolk, VA" });
check("safety-net application is accepted", app1.status === 200 && app1.data && app1.data.ok === true, `${app1.status} ${JSON.stringify(app1.data).slice(0, 160)}`);
const faEvents = (await allEvents()).filter((e) => e.type === "founding_application_received" && e.data && e.data.bizappId === (app1.data && app1.data.id));
check("the safety-net applicant IS emailed (event data: applicantEmailSent true)",
  faEvents.length === 1 && faEvents[0].data.applicantEmailSent === true, JSON.stringify(faEvents.map((e) => e.data)));
const honey = await fa("POST", "/api/founding-application", { business_name: "Bot Biz", contact_name: "Bot", email: "bot@fixtures.dev", city: "Nowhere", "bot-field": "spam" });
const honeyEvents = (await allEvents()).filter((e) => e.type === "founding_application_received" && e.data && e.data.email === "bot@fixtures.dev");
check("the honeypot still stores nothing and emails nobody",
  honey.status === 200 && honeyEvents.length === 0, `${honey.status} events=${honeyEvents.length}`);

// --- E: fold-ins (approval subject + guard, reply locks, -238 literals) ---
console.log("== E: fold-ins ==");
check("Fold-in B: the creator approval subject says approved again",
  router.approvalEmail(fakeCreator, null).subject === "You are approved. Welcome to Magpie.",
  router.approvalEmail(fakeCreator, null).subject);
check("Fold-in B: the duplicate-approval guard exists and both approval routes consult it",
  routerSrc.includes("async function approvalEmailAlreadySent239(userId)")
  && count(routerSrc, "await approvalEmailAlreadySent239(") === 2, "");
check("Fold-in A: the signed-in boot blocks read the open param literally again",
  appSrc.includes('params.get("open") === "messages"')
  && appSrc.includes('params.get("open") === "profile"')
  && appSrc.includes('params.get("open") === "status"'), "");
check("Fold-in C: the thread reply locks in flight (guard, disabled button, sending label)",
  appSrc.includes("let adminMsgReplyInFlight239 = false;")
  && appSrc.includes("if (adminMsgReplyInFlight239) return false;")
  && appSrc.includes('btn.textContent = "Sending...";'), "");
check("Fold-in C: the reply box clears only on success",
  appSrc.includes('await api("POST", "/admin/platform-messages", payload);\n    if (ta) ta.value = "";'), "");
check("Fold-in C: the segment send locks during the send itself",
  appSrc.includes("let adminMsgSegmentInFlight239 = false;")
  && appSrc.includes("if (adminMsgSegmentInFlight239) return false;")
  && appSrc.includes("adminMsgSegmentInFlight239 = true;"), "");

// --- F: behavioral (duplicate approval guard) ------------------
console.log("== F: behavioral (one approval email per creator) ==");
const creatorClient = makeClient();
const creg = await creatorClient("POST", "/api/auth/register", { role: "creator", quickClaim: true, handle: "dana239", market: "Nashville", email: "dana239@fixtures.dev", password: ["dana239", "pass", "123"].join("-"), agreedTerms: true, followerCount: 1200, localAudiencePct: 40 });
check("fixture creator claims a spot", creg.status === 201, `${creg.status} ${JSON.stringify(creg.data).slice(0, 200)}`);
const cId = creg.data && creg.data.user && creg.data.user.id;
const approvalSends = async () => (await emailsSentTo(cId)).filter((e) => e.type === "approval_email_sent");
const approve1 = await admin("POST", "/api/admin/review", { userId: cId, decision: "approve" });
const sentAfter1 = await approvalSends();
check("first approval sends exactly one approval email, with the restored subject",
  approve1.status === 200 && sentAfter1.length === 1 && sentAfter1[0].data && sentAfter1[0].data.subject === "You are approved. Welcome to Magpie.",
  `${approve1.status} sends=${sentAfter1.length} subject=${sentAfter1[0] && sentAfter1[0].data && sentAfter1[0].data.subject}`);
const approve2 = await admin("POST", "/api/admin/review", { userId: cId, decision: "approve" });
const sentAfter2 = await approvalSends();
check("a second approve tap still succeeds but does NOT resend the approval email",
  approve2.status === 200 && approve2.data.user.status === "approved" && sentAfter2.length === 1,
  `${approve2.status} sends=${sentAfter2.length}`);

console.log(`\nverify-build239: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
