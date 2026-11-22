// verify-build243.mjs — Build -243: Admin Review card / list /
// table views + mass approval (Jeff, 2026-11-21: "Push through
// the builds for me to mass approve").
//
//   - The Review sections get a Card / List / Table toggle over
//     the SAME pending queue (Card is the one-by-one deck).
//   - List (compact rows) and Table (name/handle, city,
//     followers, local %, profile complete, claimed date) carry
//     a checkbox per record, a select-all over what is on
//     screen, and Approve selected.
//   - Records under the 500 follower minimum are flagged red
//     in all three views.
//   - HARD REQUIREMENT: bulk approval runs the SAME per-record
//     server-side decision path as a single approval
//     (applyReviewDecision243), one record at a time, so every
//     approved creator gets their own approval email, their
//     own events, and the -239 duplicate guard per record.
//
// Proven here:
//   A. Source pins — the shared decision core exists once, the
//      single route delegates to it, the bulk route is approve
//      only and sequential; the client carries the three-view
//      toggle, both pending renderers, the bulk bar, the table
//      columns, and the under-500 flags.
//   B. Behavioral — mass-approving 3 fixture creators runs 3
//      separate approval paths (3 application_approved events,
//      3 approval_email_sent events, one per record, subject
//      intact); re-running the same bulk sends no second email
//      (the -239 guard); an under-minimum creator in a bulk is
//      HELD (still pending, stamped, held event, no email)
//      while the rest of the batch still runs; a business in a
//      bulk gets its own approval email; a bogus id is skipped
//      without stopping the batch; empty and reject bulks are
//      refused; the single path still approves and rejects.
// Run: node scripts/verify-build243.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build243-${Date.now()}.json`);
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
const { handler } = require("../netlify/functions/api.js");
// Build -246: approval fan-out (the approval email, recruiter
// credit, roster drop) moved off the request path into a drain
// the background function runs. This suite's contract is
// unchanged (every approved record gets its own approval email,
// exactly once, guard intact); it runs the drain at the points
// where -243 expected the email to have landed inline.
const { runApprovalFanout246 } = require("../netlify/functions/lib/router.js");
const root = process.cwd();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const count = (src, needle) => src.split(needle).length - 1;

// --- A: source pins -------------------------------------------
console.log("== A: source pins ==");
check("build stamp is >= 2026.11.21-243 and agrees in both homes",
  (() => { const a = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").match(/BUILD_ID = "2026\.11\.21-(\d+)"/); const b = fs.readFileSync(path.join(root, "public/index.html"), "utf8").match(/window\.__SIGNL_BUILD__ = "2026\.11\.21-(\d+)"/); return !!a && !!b && a[1] === b[1] && Number(a[1]) >= 243; })(), "");

const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("the shared decision core exists (applyReviewDecision243)",
  routerSrc.includes("async function applyReviewDecision243(b)"), "");
check("the decision write happens in exactly one place",
  count(routerSrc, 'type: b.decision === "approve" ? "application_approved" : "application_rejected"') === 1, "");
check("the single route delegates to the core",
  routerSrc.includes('if (method === "POST" && seg[1] === "review" && seg.length === 2)')
  && routerSrc.includes("const out = await applyReviewDecision243(parseBody(event));"), "");
check("the bulk route exists and calls the core per record, in order",
  routerSrc.includes('seg[2] === "bulk"')
  && routerSrc.includes('const out = await applyReviewDecision243({ userId: id, decision: "approve" });'), "");
check("the bulk route is approve only, capped, and refuses an empty selection",
  routerSrc.includes("Bulk is approve only. Rejections stay one at a time.")
  && routerSrc.includes("Approve at most 100 at a time.")
  && routerSrc.includes("No applications were selected."), "");
check("the bulk route logs one summary event",
  routerSrc.includes('type: "applications_bulk_approved"'), "");

const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
check("client: the toggle offers Card, List and Table",
  appSrc.includes("adminAppSetView('card', '${role}')\">Card</button>")
  && appSrc.includes("adminAppSetView('list', '${role}')\">List</button>")
  && appSrc.includes("adminAppSetView('table', '${role}')\">Table</button>"), "");
check("client: both pending renderers and the bulk flow exist",
  appSrc.includes("function adminAppListPending243(pend, role)")
  && appSrc.includes("function adminAppTablePending243(pend, role)")
  && appSrc.includes("function adminAppApproveSelected243(role)")
  && appSrc.includes('api("POST", "/admin/review/bulk", { userIds: chunkIds }, { deadlineMs: 60000 })'), "");
check("client: checkboxes and select-all are wired",
  appSrc.includes("onchange=\"adminAppToggleSel243('${role}', '${u.id}', this.checked)\"")
  && appSrc.includes("onchange=\"adminAppToggleAll243('${role}', this.checked)\"")
  && appSrc.includes("Approve selected"), "");
check("client: the table carries the six review columns",
  appSrc.includes("<th>Name / handle</th><th>City</th><th>Followers</th><th>Local %</th><th>Profile complete</th><th>Claimed</th>"), "");
check("client: under-500 records are flagged in card, list and table",
  appSrc.includes("Under the 500 minimum: ${fmtNum(under)} followers")
  && appSrc.includes("apps-row-under243")
  && appSrc.includes("apps-listrow243${under !== null ? \" under\" : \"\"}")
  && appSrc.includes("<span class=\"badge bad\">Under 500</span>"), "");
check("client: the bulk confirm names the per-record email promise",
  appSrc.includes("each one gets their own approval email"), "");
check("client: no em dashes in the new Review copy",
  !appSrc.slice(appSrc.indexOf("Review List and Table views + bulk approve (Build -243)"), appSrc.indexOf("function adminAppSearchApply187")).includes("—"), "");

// --- B: behavioral ---------------------------------------------
console.log("== B: behavioral (bulk approval runs the single path per record) ==");
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
const eventsFor = async (userId, type) => (await allEvents()).filter((e) => e.subjectId === userId && e.type === type);
const emailsSentTo = async (userId) => (await allEvents()).filter((e) => e.subjectId === userId && /_email_sent$/.test(e.type));

const admin = makeClient();
const login = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
check("admin signs in", login.status === 200, `${login.status}`);

async function claimCreator(handle, followers) {
  const c = makeClient();
  const reg = await c("POST", "/api/auth/register", { role: "creator", quickClaim: true, handle, market: "Nashville", email: `${handle}@fixtures.dev`, password: [handle, "pass", "123"].join("-"), agreedTerms: true, agreedPostCompliance: true, followerCount: followers, localAudiencePct: 40 });
  return { client: c, reg, id: reg.data && reg.data.user && reg.data.user.id };
}

const trio = [];
for (const h of ["bulkone243", "bulktwo243", "bulkthree243"]) {
  const f = await claimCreator(h, 1200);
  check(`fixture creator ${h} claims a spot`, f.reg.status === 201 && !!f.id, `${f.reg.status}`);
  trio.push(f);
}
const under = await claimCreator("bulkunder243", 300);
check("fixture under-minimum creator claims a spot", under.reg.status === 201 && !!under.id, `${under.reg.status}`);
const solo = await claimCreator("bulksolo243", 1500);
const rej = await claimCreator("bulkrej243", 1500);

const bizClient = makeClient();
const bizReg = await bizClient("POST", "/api/auth/register", { role: "business", name: "Bea Owner", email: "bea243@fixtures.dev", password: ["bea243", "pass", "123"].join("-"), businessName: "Bea's Books", category: "Retail", market: "Nashville", city: "Nashville", agreedTerms: true });
const bizId = bizReg.data && bizReg.data.user && bizReg.data.user.id;
check("fixture business registers", bizReg.status === 201 && !!bizId, `${bizReg.status}`);

// The headline proof: one bulk call, three separate approval paths.
const bulk1 = await admin("POST", "/api/admin/review/bulk", { userIds: trio.map((f) => f.id) });
await runApprovalFanout246();
check("bulk approve of 3 returns 200 with approved=3, held=0, total=3",
  bulk1.status === 200 && bulk1.data.approved === 3 && bulk1.data.held === 0 && bulk1.data.total === 3,
  `${bulk1.status} ${JSON.stringify(bulk1.data).slice(0, 200)}`);
check("every bulk result is its own approved outcome carrying the approved record",
  Array.isArray(bulk1.data.results) && bulk1.data.results.length === 3
  && bulk1.data.results.every((r) => r.outcome === "approved" && r.user && r.user.status === "approved"), "");
let apprEventsOk = true;
let apprEmailsOk = true;
for (const f of trio) {
  const ev = await eventsFor(f.id, "application_approved");
  if (ev.length !== 1) apprEventsOk = false;
  const mails = (await emailsSentTo(f.id)).filter((e) => e.type === "approval_email_sent");
  if (mails.length !== 1 || !mails[0].data || mails[0].data.subject !== "You are approved. Welcome to Magpie.") apprEmailsOk = false;
}
check("3 separate application_approved events ran, one per record", apprEventsOk, "");
check("3 separate approval emails were sent, one per record, subject intact", apprEmailsOk, "");
const summaries = (await allEvents()).filter((e) => e.type === "applications_bulk_approved");
check("one bulk summary event was logged for the batch",
  summaries.length === 1 && summaries[0].data && summaries[0].data.requested === 3 && summaries[0].data.approved === 3 && summaries[0].data.held === 0 && summaries[0].data.skipped === 0,
  JSON.stringify(summaries.map((e) => e.data)));

// The -239 guard holds per record under bulk.
const bulk2 = await admin("POST", "/api/admin/review/bulk", { userIds: trio.map((f) => f.id) });
await runApprovalFanout246();
let guardOk = bulk2.status === 200;
for (const f of trio) {
  const mails = (await emailsSentTo(f.id)).filter((e) => e.type === "approval_email_sent");
  if (mails.length !== 1) guardOk = false;
}
check("re-running the same bulk approves again but sends NO second approval email (the -239 guard)", guardOk, `${bulk2.status}`);

// A held record does not stop the batch, and the batch does not free it.
const bulk3 = await admin("POST", "/api/admin/review/bulk", { userIds: ["usr_missing243", under.id, bizId] });
await runApprovalFanout246();
const outcomeOf = (id) => (bulk3.data.results || []).find((r) => r.userId === id) || {};
check("mixed bulk: the bogus id is skipped, the under-minimum creator is held, the business is approved",
  bulk3.status === 200 && outcomeOf("usr_missing243").outcome === "skipped"
  && outcomeOf(under.id).outcome === "held" && outcomeOf(bizId).outcome === "approved",
  `${bulk3.status} ${JSON.stringify(bulk3.data).slice(0, 260)}`);
const underRec = await store.get(`user:${under.id}`);
check("the held creator stays pending, stamped underMinimum, with a held event and no approval email",
  !!underRec && underRec.status === "pending" && !!underRec.underMinimum
  && (await eventsFor(under.id, "application_held_under_minimum")).length >= 1
  && (await emailsSentTo(under.id)).filter((e) => e.type === "approval_email_sent").length === 0, "");
check("the business in the bulk got its own approval email",
  (await emailsSentTo(bizId)).some((e) => e.type === "approval_email_sent"), "");

// Refusals at the route door.
const bulkEmpty = await admin("POST", "/api/admin/review/bulk", { userIds: [] });
check("an empty bulk selection is refused with a 400", bulkEmpty.status === 400, `${bulkEmpty.status}`);
const bulkReject = await admin("POST", "/api/admin/review/bulk", { userIds: [solo.id], decision: "reject" });
check("a bulk rejection is refused with a 400 (rejections stay one at a time)", bulkReject.status === 400, `${bulkReject.status}`);
const soloRec = await store.get(`user:${solo.id}`);
check("the refused bulk rejection left its target untouched and pending",
  !!soloRec && soloRec.status === "pending", soloRec && soloRec.status);
const nonAdmin = await trio[0].client("POST", "/api/admin/review/bulk", { userIds: [solo.id] });
check("a non-admin caller cannot use the bulk route", nonAdmin.status >= 400, `${nonAdmin.status}`);

// The single path still works, both directions.
const singleApprove = await admin("POST", "/api/admin/review", { userId: solo.id, decision: "approve" });
await runApprovalFanout246();
check("the single approval path still approves, with its approval email",
  singleApprove.status === 200 && singleApprove.data.user.status === "approved"
  && (await emailsSentTo(solo.id)).some((e) => e.type === "approval_email_sent"), `${singleApprove.status}`);
const singleReject = await admin("POST", "/api/admin/review", { userId: rej.id, decision: "reject" });
check("the single rejection path still rejects, with its rejection email",
  singleReject.status === 200 && singleReject.data.user.status === "rejected"
  && (await emailsSentTo(rej.id)).some((e) => e.type === "rejection_email_sent"), `${singleReject.status}`);

// The queue reflects it all.
const apps = await admin("GET", "/api/admin/applications");
const pendIds = ((apps.data && apps.data.pending) || []).map((u) => u.id);
check("the applications queue shows the held creator still pending and the approved trio gone",
  pendIds.includes(under.id) && trio.every((f) => !pendIds.includes(f.id)), "");

console.log(`\nverify-build243: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
