// verify-emaildedupe.mjs — Lifecycle email de-duplication
// (Jeff, 2026-11-13). One milestone, one email.
//
// THE BUG (Jeff's screenshots, creator Demecia Tatum, Columbus,
// 2026-11-13 morning): a quick claim at 5:48 fired the claim
// confirmation email; finishing the profile in the same sitting
// fired the Finish Moment platform message AND its notification
// email at 5:49, repeating the booking-page news with a
// lowercase first name and an excerpt severed mid-word
// (".../c/demecia What"); Jeff's approval then fired a third
// email. Three emails for one signup, two a minute apart.
//
// THE FIX (router.js):
//   - sendPlatformMessage holds the email ping when a lifecycle
//     email (claim/signup confirmation, approval, sign-in link,
//     welcome) was SENT to the same user within the prior 4
//     hours; the in-app message always lands, and every hold is
//     logged as platform_message_email_suppressed.
//   - platformMessageEmail's excerpt takes the body's first
//     block and otherwise cuts at a word boundary with an
//     ellipsis — never mid-word, never a dangling fragment.
//   - The Finish Engine's {firstName} slot renders display
//     case (greetingNameCapitalized) even when the stored name
//     was typed lowercase.
//   - The approval email is untouched and still fires on the
//     approval action alone.
//
// Run: node scripts/verify-emaildedupe.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-emaildedupe-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.SIGNL_MAIL_STUB = "1";
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "fixture-admin-pass-1";
process.env.APP_URL = "https://app.magpielocal.com";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_VERIFY_TOKEN = "fixture-verify-token";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const events = require("../netlify/functions/lib/events.js");
const router = require("../netlify/functions/lib/router.js");
const { handler } = require("../netlify/functions/api.js");
const root = path.join(process.cwd());

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body),
      isBase64Encoded: false,
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
async function eventsFor(userId, type) {
  return (await allEvents()).filter((e) => e.subjectId === userId && (!type || e.type === type));
}
async function emailsSentTo(userId) {
  return (await eventsFor(userId)).filter((e) => /_email_sent$/.test(e.type));
}
async function platformMessagesFor(userId) {
  const rows = await store.list("message:");
  return rows.map((r) => r.value).filter((m) => m && m.platform && m.toId === userId);
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const admin = makeClient();

// --- A: source pins -------------------------------------------------
console.log("== A: source pins ==");
{
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("guard lives in the shared platform-message send path", routerJs.includes("recentLifecycleEmail") && routerJs.includes("platform_message_email_suppressed"), "");
  check("suppression window is 4 hours", routerJs.includes("PLATFORM_PING_SUPPRESS_WINDOW_MS = 4 * 60 * 60 * 1000"), "");
  check("lifecycle set names claim/approval/sign-in kinds", routerJs.includes('"signup_confirmation_email_sent"') && routerJs.includes('"approval_email_sent"') && routerJs.includes('"signin_link_email_sent"'), "");
  check("old raw 120-char slice is gone from the excerpt builder", !routerJs.includes('slice(0, 120).replace(/\\s+/g, " ")'), "");
  check("approval sends are still called directly (no guard on the approval path)", (routerJs.match(/deliverEmail\("approval"/g) || []).length === 2, "");
}

const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
check("admin login succeeds", login.status === 200, `got ${login.status}`);

// --- (i) Demecia: claim, then finish in the same sitting ------------
console.log("== (i) claim + finish within minutes: exactly one email ==");
const dem = makeClient();
const claim = await dem("POST", "/api/auth/register", {
  role: "creator", quickClaim: true, email: "demecia@fixtures.dev", password: "claim-pass-1234",
  market: "Not listed yet", customCity: "Columbus", customCountry: "United States", handle: "demecia", ...AGREE,
});
check("quick claim registers (201)", claim.status === 201, JSON.stringify(claim.data).slice(0, 200));
const demId = claim.data.user && claim.data.user.id;
{
  const sent = await emailsSentTo(demId);
  check("the claim fires exactly one email: the claim confirmation",
    sent.length === 1 && sent[0].type === "signup_confirmation_email_sent" && sent[0].data.subject === "Your Magpie founding spot is claimed",
    JSON.stringify(sent.map((e) => e.type)));
}
const finish = await dem("PATCH", "/api/me/profile", {
  name: "demecia tatum", // typed lowercase, exactly as in Jeff's screenshot
  categories: ["Food & Drink"],
  audienceStack: { instagram: 3000 },
  localAudiencePct: 55,
  bio: "Columbus food and neighborhood spots.",
});
check("finishing the gate fields flips the profile complete", finish.status === 200 && finish.data.user.creator.profileComplete === true, JSON.stringify(finish.data).slice(0, 200));
const demMsgs = await platformMessagesFor(demId);
check("the finish moment message lands in the platform thread", demMsgs.length === 1, `${demMsgs.length}`);
const demBody = demMsgs.length ? demMsgs[0].body : "";
check("finish moment opens with a capitalized first name", demBody.startsWith("Demecia, you finished."), demBody.slice(0, 60));
check("finish moment carries the live booking page line", demBody.includes("Your booking page is live: https://app.magpielocal.com/c/demecia"), demBody.slice(0, 200));
{
  const finishEvents = await eventsFor(demId, "finish_moment_sent");
  check("finish_moment_sent is logged once", finishEvents.length === 1, `${finishEvents.length}`);
  const pings = await eventsFor(demId, "platform_message_email_sent");
  check("NO notification email is sent for the finish moment", pings.length === 0, `${pings.length}`);
  const supp = await eventsFor(demId, "platform_message_email_suppressed");
  check("the hold is recorded as platform_message_email_suppressed, naming the claim email",
    supp.length === 1 && supp[0].data.reason === "recent_lifecycle_email" && supp[0].data.lifecycleKind === "signup_confirmation" && supp[0].data.messageId === demMsgs[0].id,
    JSON.stringify(supp).slice(0, 240));
  const sent = await emailsSentTo(demId);
  check("journey total after claim+finish is exactly 1 email", sent.length === 1, JSON.stringify(sent.map((e) => e.type)));
}

// --- (iv-a) the excerpt of Demecia's real finish body ---------------
console.log("== (iv) excerpt: capitalized, whole words, no fragment ==");
{
  const rec = await store.get(`user:${demId}`);
  const mail = router.platformMessageEmail(rec, demBody);
  const quoted = (mail.text.split("\n").find((l) => l.startsWith('"')) || "");
  check("the notification excerpt is the clean first block",
    quoted === '"Demecia, you finished. Your profile is complete."', quoted);
  check("the excerpt has no dangling fragment and no glued URL line",
    !quoted.includes("What") && !quoted.includes("/c/demecia"), quoted);
}

// --- (iii) approval still fires, on Jeff's action alone -------------
console.log("== (iii) approval after claim+finish still emails ==");
{
  const before = (await emailsSentTo(demId)).length;
  const review = await admin("POST", "/api/admin/review", { userId: demId, decision: "approve" });
  check("admin approval succeeds", review.status === 200, `${review.status} ${JSON.stringify(review.data).slice(0, 160)}`);
  const sent = await emailsSentTo(demId);
  const approvals = await eventsFor(demId, "approval_email_sent");
  check("the approval email fires", approvals.length === 1, `${approvals.length}`);
  check("journey total is 2 emails (claim + approval), spaced by the approval action",
    sent.length === before + 1 && sent.length === 2, JSON.stringify(sent.map((e) => e.type)));
}

// --- (ii) no recent lifecycle email: the ping still sends -----------
console.log("== (ii) platform message with no recent lifecycle email ==");
async function seedApprovedCreator(id, email, name, handle) {
  const rec = {
    id, role: "creator", email, name, status: "approved", market: "Nashville", city: "Nashville",
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    creator: { handle, tierBand: "Locals", categories: ["Food & Drink"], localAudiencePct: 60, audienceStack: { instagram: 2400 }, followerCount: 2400, totalAudience: 2400, profileComplete: true, publicPage: true },
  };
  await store.set(`user:${id}`, rec);
  await store.set(`email:${email}`, { userId: id });
  return rec;
}
await seedApprovedCreator("dedupe-bea", "bea@fixtures.dev", "Bea Baker", "beabakes");
{
  const send = await admin("POST", "/api/admin/platform-messages", { creatorId: "dedupe-bea", body: "A plain note from the team about next week." });
  check("admin send reports the ping sent, none suppressed",
    send.status === 201 && send.data.emailSent === 1 && send.data.emailSuppressed === 0 && send.data.emailFailed === 0,
    `${send.status} ${JSON.stringify(send.data)}`);
  const pings = await eventsFor("dedupe-bea", "platform_message_email_sent");
  check("platform_message_email_sent is logged for her", pings.length === 1, `${pings.length}`);
}

// --- window edges: 5h-old lifecycle send pings; 1h-old holds --------
console.log("== window edges ==");
await seedApprovedCreator("dedupe-cleo", "cleo@fixtures.dev", "Cleo Ray", "cleoray");
await events.logEvent({ type: "signup_confirmation_email_sent", actorId: "dedupe-cleo", actorRole: "creator", subjectId: "dedupe-cleo", market: "Nashville", data: { kind: "signup_confirmation", to: "cleo@fixtures.dev" }, ts: new Date(Date.now() - 5 * 3600000).toISOString() });
{
  const send = await admin("POST", "/api/admin/platform-messages", { creatorId: "dedupe-cleo", body: "Following up with a fresh note." });
  check("a lifecycle email 5h old does NOT hold the ping (outside the window)",
    send.status === 201 && send.data.emailSent === 1 && send.data.emailSuppressed === 0, JSON.stringify(send.data));
}
await seedApprovedCreator("dedupe-dee", "dee@fixtures.dev", "Dee Fox", "deefox");
await events.logEvent({ type: "approval_email_sent", actorId: "dedupe-dee", actorRole: "creator", subjectId: "dedupe-dee", market: "Nashville", data: { kind: "approval", to: "dee@fixtures.dev" }, ts: new Date(Date.now() - 1 * 3600000).toISOString() });
{
  const send = await admin("POST", "/api/admin/platform-messages", { creatorId: "dedupe-dee", body: "A note right after your approval." });
  check("a lifecycle email 1h old holds the ping, counted as suppressed not failed",
    send.status === 201 && send.data.emailSent === 0 && send.data.emailSuppressed === 1 && send.data.emailFailed === 0, JSON.stringify(send.data));
  const msgs = await platformMessagesFor("dedupe-dee");
  check("the in-app message still lands while its ping is held", msgs.length === 1 && msgs[0].body === "A note right after your approval.", `${msgs.length}`);
  const supp = await eventsFor("dedupe-dee", "platform_message_email_suppressed");
  check("the hold names the approval email as the reason", supp.length === 1 && supp[0].data.lifecycleKind === "approval", JSON.stringify(supp).slice(0, 200));
}

// --- (iv-b) excerpt unit checks --------------------------------------
console.log("== (iv) excerpt unit checks ==");
function previewOf(body) {
  const mail = router.platformMessageEmail({ email: "x@fixtures.dev" }, body);
  const line = mail.text.split("\n").find((l) => l.startsWith('"')) || "";
  return line.slice(1, -1); // strip the wrapping quotes
}
{
  const flat = (s) => s.replace(/\s+/g, " ").trim();
  // Long single paragraph (the Golden Ticket shape).
  const longBody = "Quick one. When you finished your Magpie profile you got two Golden Tickets, founding seats you can hand to two creators by name. The seat is held for them until Nashville launches, and when they finish, it earns you 100 points, which moves you up when businesses search.";
  const p1 = previewOf(longBody);
  const core1 = p1.replace(/…$/, "");
  check("long body: excerpt is capped at the limit and marked with an ellipsis",
    p1.length <= 121 && p1.endsWith("…"), `${p1.length} ${p1.slice(-30)}`);
  check("long body: the cut lands on a word boundary (next char is a space)",
    flat(longBody).startsWith(core1) && flat(longBody)[core1.length] === " ", JSON.stringify(p1.slice(-30)));
  // Mid-word trap: a long token straddling the old 120-char cut.
  const trap = `${"abcdefghij ".repeat(10)}supercalifragilisticexpialidocious and then a good deal more text follows here to round it out fully.`;
  const p2 = previewOf(trap);
  const core2 = p2.replace(/…$/, "");
  check("mid-word trap: no severed token in the excerpt",
    !p2.includes("supercalifrag") && flat(trap).startsWith(core2) && flat(trap)[core2.length] === " ", JSON.stringify(p2.slice(-40)));
  // Stub opener block falls back to the whole body.
  const stub = `Yes!\n\n${"Here is the longer explanation that follows the short opener and keeps going with more detail for the creator to read. ".repeat(2)}`;
  const p3 = previewOf(stub);
  check("stub opener: excerpt uses the whole body, still word-boundary cut",
    p3.startsWith("Yes! Here is the longer explanation") && p3.endsWith("…"), p3.slice(0, 60));
  // Short body passes through untouched.
  check("short body: excerpt is the body itself, no ellipsis", previewOf("See you Tuesday.") === "See you Tuesday.", previewOf("See you Tuesday."));
  // The screenshot body shape, verbatim structure.
  const shot = "Demecia, you finished. Your profile is complete.\n\nYour booking page is live: https://app.magpielocal.com/c/demecia\n\nWhat turned on: businesses can now find you and book you.";
  check("screenshot shape: excerpt stops at the first block, no 'What' fragment",
    previewOf(shot) === "Demecia, you finished. Your profile is complete.", previewOf(shot));
}

console.log(`\nverify-emaildedupe: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
