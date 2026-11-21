// verify-build232.mjs — Build -232: the market-segment send
// button actually sends.
// Jeff hit it live on 2026-11-21: Admin → Messages → Send to
// many → pick Auckland, paste the approved group invite, tap
// "Send to segment" — and NOTHING happened. No error, no
// toast, no campaign record, no message in the creator's
// thread. The thread reply box (same endpoint) worked fine.
// Root cause, proven in this suite's Part B harness against
// the pre-fix handler shape: adminMsgSendCompose gated the
// send on the browser's native window.confirm() popup. In
// any browser that suppresses or auto-dismisses native
// dialogs (automated browsers, some webviews), confirm()
// silently returns false without ever appearing, so the
// handler returned before the POST — zero observable effect.
// This suite proves:
//   A. Source pins — the handler no longer touches
//      window.confirm; the confirmation is an in-page two-tap
//      arm that snapshots market + body; the send posts
//      { body, templateId, market } to the SAME route the
//      thread reply uses; the result line reports all four
//      counts (sent / emailSent / emailFailed / emailSuppressed).
//   B. Client harness — the real handler, extracted from
//      public/app.js and run against a stub DOM + api:
//      first tap arms and posts nothing; second tap sends
//      exactly once with the right payload and paints the
//      counts; editing the words or switching the market
//      disarms; an empty message stops with words; a failed
//      POST shows the error and re-enables the button; and
//      window.confirm is never invoked even when present.
//   C. Server fixture — a { market, body } POST against the
//      local fixture lands in the finished Auckland creator's
//      thread only, returns the four counts, and writes ONE
//      pmcampaign receipt (the record the "Sent to many" book
//      reads), like the Nov 9 sends.
// Run: node scripts/verify-build232.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build232-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "build232-admin-fixture-password";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");
const root = process.cwd();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const fnStart = appJs.indexOf("async function adminMsgSendCompose(btn) {");
const fnEnd = appJs.indexOf("async function adminMsgSendReply");
const handlerSrc = appJs.slice(fnStart, fnEnd);
{
  check("handler located in app.js", fnStart >= 0 && fnEnd > fnStart, `${fnStart}..${fnEnd}`);
  check("handler never touches window.confirm (the -232 root cause)",
    // Code only: the handler's own comment names the old call
    // while explaining the bug, so strip // comment lines first.
    !/window\.confirm|\bconfirm\s*\(/.test(handlerSrc.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")),
    handlerSrc.match(/.{0,40}confirm.{0,40}/)?.[0] || "");
  check("handler arms in-page via segmentArm snapshot of market + body",
    handlerSrc.includes("adminMsg.segmentArm") && handlerSrc.includes("arm.market !== market") && handlerSrc.includes("arm.body !== body"), "");
  check("handler posts { body, templateId, market } to the thread-reply route",
    handlerSrc.includes('api("POST", "/admin/platform-messages", payload)') && handlerSrc.includes("const payload = { body, templateId: sel ? sel.value : \"blank\", market }"), "");
  check("a panel re-render starts the segment tool unarmed",
    appJs.slice(appJs.indexOf("async function renderAdminCampaigns163()"), appJs.indexOf("function adminCampOpenThread163")).includes("adminMsg.segmentArm = null"), "");
  check("result line reports all four counts",
    handlerSrc.includes("data.sent") && handlerSrc.includes("data.emailSent") && handlerSrc.includes("data.emailFailed") && handlerSrc.includes("data.emailSuppressed"), "");
  check("build stamp 232 in both homes",
    fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.21-232")
    && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes("2026.11.21-232"), "");
}

// --- B: client harness ----------------------------------------
console.log("== B: client harness (real handler, stub DOM) ==");
function makeWorld(apiImpl) {
  const els = {
    "admin-msg-body": { value: "  Kia ora Auckland — join the brand new Magpie Creators group!  " },
    "admin-msg-result": { textContent: "" },
    "admin-msg-market": { value: "Auckland" },
    "admin-msg-template": { value: "blank" },
  };
  const posts = [];
  let confirmCalls = 0;
  const ctx = {
    console,
    adminMsg: { segmentMarket: "Auckland", segmentArm: null, lastTemplateFill: null },
    document: { getElementById: (id) => els[id] || null },
    // The dialog that ate the live send: present, and it
    // answers "no" the way an auto-dismissed popup does. The
    // fixed handler must never call it at all.
    window: { confirm: () => { confirmCalls += 1; return false; } },
    api: async (m, p, payload) => { posts.push({ m, p, payload }); return apiImpl(payload); },
    renderAdminMessages: async () => {},
    renderAdminCampaigns163: async () => {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(handlerSrc, ctx);
  return { ctx, els, posts, confirmCalls: () => confirmCalls };
}
const OK = async () => ({ sent: 1, emailSent: 1, emailFailed: 0, emailSuppressed: 2 });
{
  const w = makeWorld(OK);
  const btn = { disabled: false, textContent: "Send to segment" };
  const bodyText = w.els["admin-msg-body"].value.trim();
  await w.ctx.adminMsgSendCompose(btn);
  check("first tap arms and posts NOTHING", w.posts.length === 0, JSON.stringify(w.posts));
  check("first tap relabels the button as the confirm", btn.textContent === "Confirm send to Auckland", btn.textContent);
  check("first tap explains the send in the result line",
    w.els["admin-msg-result"].textContent.includes("every finished creator in Auckland"), w.els["admin-msg-result"].textContent);
  await w.ctx.adminMsgSendCompose(btn);
  check("second tap sends exactly once, to the thread-reply route",
    w.posts.length === 1 && w.posts[0].m === "POST" && w.posts[0].p === "/admin/platform-messages", JSON.stringify(w.posts));
  check("payload is { body (trimmed), templateId, market }",
    w.posts.length === 1 && w.posts[0].payload.body === bodyText && w.posts[0].payload.market === "Auckland" && w.posts[0].payload.templateId === "blank",
    JSON.stringify(w.posts[0] && w.posts[0].payload));
  check("result line shows sent + email sent/failed/suppressed",
    /Sent to 1 creator in Auckland/.test(w.els["admin-msg-result"].textContent)
    && w.els["admin-msg-result"].textContent.includes("1 sent, 0 failed, 2 already opted out"), w.els["admin-msg-result"].textContent);
  check("window.confirm was never invoked", w.confirmCalls() === 0, `${w.confirmCalls()} calls`);
}
{
  // Editing the words after arming must disarm.
  const w = makeWorld(OK);
  const btn = { disabled: false, textContent: "Send to segment" };
  await w.ctx.adminMsgSendCompose(btn);
  w.els["admin-msg-body"].value = "Edited words — a different message entirely.";
  await w.ctx.adminMsgSendCompose(btn);
  check("editing the message after arming re-arms instead of sending", w.posts.length === 0, JSON.stringify(w.posts));
  await w.ctx.adminMsgSendCompose(btn);
  check("the next tap sends the EDITED words", w.posts.length === 1 && w.posts[0].payload.body === "Edited words — a different message entirely.", JSON.stringify(w.posts));
}
{
  // Switching the market after arming must disarm.
  const w = makeWorld(OK);
  const btn = { disabled: false, textContent: "Send to segment" };
  await w.ctx.adminMsgSendCompose(btn);
  w.els["admin-msg-market"].value = "Nashville";
  await w.ctx.adminMsgSendCompose(btn);
  check("switching the market after arming re-arms instead of sending", w.posts.length === 0, JSON.stringify(w.posts));
  check("the re-arm names the NEW market", btn.textContent === "Confirm send to Nashville", btn.textContent);
}
{
  // Empty message stops with words, never a silent nothing.
  const w = makeWorld(OK);
  const btn = { disabled: false, textContent: "Send to segment" };
  w.els["admin-msg-body"].value = "   ";
  await w.ctx.adminMsgSendCompose(btn);
  check("empty message: no POST, plain-words stop", w.posts.length === 0 && w.els["admin-msg-result"].textContent === "Write a message first.", w.els["admin-msg-result"].textContent);
}
{
  // A failed POST shows the error and leaves the button usable.
  const w = makeWorld(async () => { throw new Error("Unknown market"); });
  const btn = { disabled: false, textContent: "Send to segment" };
  await w.ctx.adminMsgSendCompose(btn);
  await w.ctx.adminMsgSendCompose(btn);
  check("failed POST: error shown, button re-enabled and relabelled",
    w.els["admin-msg-result"].textContent === "Unknown market" && btn.disabled === false && btn.textContent === "Send to segment",
    `${w.els["admin-msg-result"].textContent} | disabled=${btn.disabled} | label=${btn.textContent}`);
  await w.ctx.adminMsgSendCompose(btn);
  check("after a failure the next tap re-arms (no blind send)", w.posts.length === 1, `${w.posts.length} posts`);
}

// --- C: server fixture ----------------------------------------
console.log("== C: server fixture (the route the form posts to) ==");
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body, rawPath) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: rawPath || url.pathname,
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
const PW = "fixture-password-1";
const uniq = () => Math.random().toString(36).slice(2, 9);
const admin = makeClient();
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin login succeeds", r.status === 200, `got ${r.status}`);
}
async function registerCreator(name, handle, market) {
  const c = makeClient();
  const email = `${handle.replace(/[^a-z0-9]/gi, "")}-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: PW, market, city: market, handle,
    categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: 5000, avgViews: 1500, localAudiencePct: 70,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (r.status !== 201) throw new Error("creator register failed: " + JSON.stringify(r.data));
  return { client: c, email, id: r.data.user.id, handle };
}
async function approve(id) {
  const r = await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  if (r.status !== 200) throw new Error("approve failed: " + JSON.stringify(r.data));
}
const ak = await registerCreator("Auck One", "auckone232", "Auckland"); await approve(ak.id);
const nv = await registerCreator("Nash One", "nashone232", "Nashville"); await approve(nv.id);
{
  const inviteBody = "Fixture invite: the brand new Magpie Creators group is open — https://www.facebook.com/groups/1820148515703356";
  const before = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
  const seg = await admin("POST", "/api/admin/platform-messages", { market: "Auckland", body: inviteBody, templateId: "blank" });
  check("segment POST: 201, sent = the one finished Auckland creator",
    seg.status === 201 && seg.data.sent === 1 && seg.data.scope === "segment" && seg.data.market === "Auckland",
    `${seg.status} ${JSON.stringify(seg.data).slice(0, 200)}`);
  check("segment POST: all four counts ride the response",
    typeof seg.data.emailSent === "number" && typeof seg.data.emailFailed === "number" && typeof seg.data.emailSuppressed === "number",
    JSON.stringify(seg.data).slice(0, 200));
  const after = (await admin("GET", "/api/admin/message-campaigns")).data.campaigns || [];
  const entry = after.find((c) => c.body === inviteBody);
  check("campaign receipt: exactly ONE new segment entry with the exact copy",
    !!entry && entry.kind === "segment" && entry.reconstructed === false && after.length === before.length + 1,
    JSON.stringify(entry).slice(0, 240));
  check("campaign receipt: recipient is the Auckland creator only",
    !!entry && entry.recipientCount === 1 && (entry.recipients || []).map((p) => p.id).join(",") === ak.id,
    JSON.stringify(entry && entry.recipients).slice(0, 200));
  const akThread = await admin("GET", `/api/admin/platform-messages?creatorId=${ak.id}`);
  check("the message is IN the Auckland creator's thread",
    (akThread.data.messages || []).some((m) => m.body === inviteBody), JSON.stringify(akThread.data).slice(0, 200));
  const nvThread = await admin("GET", `/api/admin/platform-messages?creatorId=${nv.id}`);
  check("the Nashville creator's thread is untouched",
    !(nvThread.data.messages || []).some((m) => m.body === inviteBody), "");
  const rows = await store.list("pmcampaign:");
  check("the receipt is a pmcampaign record in the store",
    rows.some((r) => r.value && r.value.body === inviteBody && r.value.market === "Auckland"), `${rows.length} pmcampaign rows`);
}

console.log(`\nverify-build232: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
