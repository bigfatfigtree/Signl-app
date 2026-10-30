#!/usr/bin/env node
// Build 2026.10.30-40 verification: Creator Messaging + Email Ping.
// The SIGNL team gets a platform thread inside every creator's
// existing Messages surface: Admin sends to one creator or to a
// market's finished creators (one individual thread each), the
// Golden Ticket template prefills the composer, every send is an
// Event Log record, and every admin send also pings the creator
// by email on the hello@ lane ("You have a new message on SIGNL",
// a short preview, a link to the Messages view). The ping is a
// notification only: a failed transport never blocks the in-app
// message. Creators can reply in the thread; replies surface in
// Admin's view with an unread count and a platform_message_reply
// event. The mail stub (SIGNL_MAIL_STUB=1, spawned server only)
// makes send/failure deterministic: "stubfail" addresses fail.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8950;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "build40-admin@signl.local";
const ADMIN_PASSWORD = ["build40", "admin", "pass"].join("-");
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} :: ${detail}`); }
}

function client() {
  const jar = new Map();
  const call = async (method, path, body) => {
    const headers = { "content-type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const part of sc) { const pair = part.split(";")[0]; const i = pair.indexOf("="); if (i > -1) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  return call;
}

async function waitUp() {
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.status) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
}

async function makeCreator(admin, { name, email, handle, market, approve = true }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market, city: market,
    handle, followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"], primaryPlatform: "instagram", ...AGREE,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  if (approve) await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  return { client: c, id: reg.data.user.id, email, handle };
}

async function makeIncompleteCreator(admin, { email, handle, market }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email, password: "claim-pass-1234", market, handle, ...AGREE,
  });
  if (reg.status !== 201) throw new Error(`quick claim ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  return { client: c, id: reg.data.user.id, email, handle };
}

async function eventsOf(admin, type) {
  const r = await admin("GET", `/api/admin/events?limit=2000&type=${encodeURIComponent(type)}`);
  return (r.data && r.data.events) || [];
}

let server;
try {
  const dir = mkdtempSync(join(tmpdir(), "signl-build40-"));
  server = spawn(process.execPath, ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: join(dir, "db.json"), SIGNL_MAIL_STUB: "1", ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await waitUp();

  const admin = client();
  const login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(login.data)}`);
  await admin("POST", "/api/admin/markets/toggle", { market: "Nashville", live: true });
  await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });

  const nashA = await makeCreator(admin, { name: "Nash Amy", email: "nasha@fixtures.dev", handle: "nashamy", market: "Nashville" });
  const nashB = await makeCreator(admin, { name: "Nash Ben", email: "stubfail-nashb@fixtures.dev", handle: "nashben", market: "Nashville" });
  const richC = await makeCreator(admin, { name: "Rich Cara", email: "richc@fixtures.dev", handle: "richcara", market: "Richmond" });
  const nashPending = await makeCreator(admin, { name: "Nash Pete", email: "nashp@fixtures.dev", handle: "nashpete", market: "Nashville", approve: false });
  const nashIncomplete = await makeIncompleteCreator(admin, { email: "nashi@fixtures.dev", handle: "nashinc", market: "Nashville" });
  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", businessName: "Threadless Kitchen", email: "biz@fixtures.dev", password: "business-pass-123",
    market: "Nashville", city: "Nashville", category: "Restaurant", planId: "growth", neighborhood: "East Nashville", agreedTerms: true,
  });
  if (bizReg.status !== 201) throw new Error(`business failed: ${JSON.stringify(bizReg.data)}`);
  await admin("POST", "/api/admin/review", { userId: bizReg.data.user.id, decision: "approve" });

  // Templates.
  const templates = await admin("GET", "/api/admin/message-templates");
  const gt = (templates.data.templates || []).find((t) => t.id === "golden_ticket");
  check("templates: the Golden Ticket reminder ships with the {market} slot",
    templates.status === 200 && !!gt && gt.body.includes("two Golden Tickets") && gt.body.includes("{market}"),
    JSON.stringify(templates.data).slice(0, 200));
  check("templates: a blank template exists",
    (templates.data.templates || []).some((t) => t.id === "blank" && t.body === ""), JSON.stringify(templates.data).slice(0, 200));

  // Guards.
  const creatorSend = await nashA.client("POST", "/api/admin/platform-messages", { creatorId: nashA.id, body: "hi" });
  check("guard: a creator cannot use the admin send route", creatorSend.status === 403, `${creatorSend.status}`);
  const creatorOverview = await nashA.client("GET", "/api/admin/platform-messages");
  check("guard: a creator cannot read the admin platform view", creatorOverview.status === 403, `${creatorOverview.status}`);
  const bizReply = await biz("POST", "/api/messages", { toUserId: "signl-team", body: "hello?" });
  check("guard: a business cannot write to the platform peer", bizReply.status === 403, `${bizReply.status} ${JSON.stringify(bizReply.data).slice(0, 120)}`);
  const emptySend = await admin("POST", "/api/admin/platform-messages", { creatorId: nashA.id, body: "   " });
  check("guard: an empty message is refused", emptySend.status === 400, `${emptySend.status}`);
  const badTemplate = await admin("POST", "/api/admin/platform-messages", { creatorId: nashA.id, body: "hi", templateId: "nope" });
  check("guard: an unknown template is refused", badTemplate.status === 400, `${badTemplate.status}`);
  const pendingSend = await admin("POST", "/api/admin/platform-messages", { creatorId: nashPending.id, body: "hi" });
  check("guard: a pending creator cannot be messaged", pendingSend.status === 400, `${pendingSend.status}`);
  const bizTarget = await admin("POST", "/api/admin/platform-messages", { creatorId: bizReg.data.user.id, body: "hi" });
  check("guard: a business is not a platform-message target", bizTarget.status === 404, `${bizTarget.status}`);

  // (1) Single send: thread, sender identity, email ping, event log.
  const bodyA = "Quick one. When you finished your SIGNL profile you got two Golden Tickets, founding seats you can hand to two creators by name. The seat is held for them until Nashville launches, and when they finish, it earns you 100 points.";
  const send1 = await admin("POST", "/api/admin/platform-messages", { creatorId: nashA.id, body: bodyA, templateId: "golden_ticket" });
  check("(1) single send reports one recipient, email sent, none failed",
    send1.status === 201 && send1.data.sent === 1 && send1.data.emailSent === 1 && send1.data.emailFailed === 0,
    `${send1.status} ${JSON.stringify(send1.data)}`);
  const listA = await nashA.client("GET", "/api/messages");
  const threadA = (listA.data.threads || []).find((t) => t.platform);
  check("(1) the creator's Messages list carries the platform thread, sender shown as SIGNL",
    !!threadA && threadA.otherName === "SIGNL" && threadA.otherRole === "platform" && threadA.otherId === "signl-team",
    JSON.stringify(listA.data.threads).slice(0, 240));
  const convoA = await nashA.client("GET", "/api/messages?with=signl-team");
  check("(1) the thread holds the message, flagged platform, from the SIGNL peer",
    convoA.data.messages.length === 1 && convoA.data.messages[0].platform === true && convoA.data.messages[0].fromId === "signl-team" && convoA.data.messages[0].body === bodyA,
    JSON.stringify(convoA.data).slice(0, 240));
  const sentEvents = await eventsOf(admin, "platform_message_sent");
  check("(1) the send is in the Event Log with recipient, scope and template",
    sentEvents.some((e) => e.data && e.data.toId === nashA.id && e.data.scope === "single" && e.data.templateId === "golden_ticket" && e.actorRole === "admin"),
    JSON.stringify(sentEvents).slice(0, 240));
  const pingEvents = await eventsOf(admin, "platform_message_email_sent");
  check("(1) the email ping fired with the exact subject to the creator",
    pingEvents.some((e) => e.subjectId === nashA.id && e.data && e.data.subject === "You have a new message on SIGNL" && e.data.to === "nasha@fixtures.dev"),
    JSON.stringify(pingEvents).slice(0, 240));

  // (2) The badge: increments once per thread, clears on read.
  const notes1 = await nashA.client("GET", "/api/notifications");
  check("(2) the Messages badge increments for the unread platform thread",
    notes1.data.badges && notes1.data.badges.messages === 1, JSON.stringify(notes1.data.badges));
  const send2 = await admin("POST", "/api/admin/platform-messages", { creatorId: nashA.id, body: "Second note, same thread." });
  const notes2 = await nashA.client("GET", "/api/notifications");
  check("(2) a second message in the same thread does not stack the badge",
    send2.status === 201 && notes2.data.badges && notes2.data.badges.messages === 1, JSON.stringify(notes2.data.badges));
  await nashA.client("POST", "/api/notifications/read", {});
  const notes3 = await nashA.client("GET", "/api/notifications");
  check("(2) the badge clears when the creator reads their notifications",
    notes3.data.badges && notes3.data.badges.messages === 0, JSON.stringify(notes3.data.badges));

  // (3) Email failure never blocks the in-app message.
  const sendB = await admin("POST", "/api/admin/platform-messages", { creatorId: nashB.id, body: "Your ping will fail; this message must still land." });
  check("(3) a failed ping still returns a successful send, failure counted",
    sendB.status === 201 && sendB.data.sent === 1 && sendB.data.emailSent === 0 && sendB.data.emailFailed === 1,
    `${sendB.status} ${JSON.stringify(sendB.data)}`);
  const convoB = await nashB.client("GET", "/api/messages?with=signl-team");
  check("(3) the in-app message is stored despite the failed ping",
    convoB.data.messages.length === 1 && convoB.data.messages[0].platform === true,
    JSON.stringify(convoB.data).slice(0, 200));
  const failEvents = await eventsOf(admin, "platform_message_email_not_sent");
  check("(3) the failure is logged loudly as an email_not_sent event with its reason",
    failEvents.some((e) => e.subjectId === nashB.id && e.data && /stub/.test(e.data.reason || "")),
    JSON.stringify(failEvents).slice(0, 240));

  // (4) Segment fan-out: finished creators in the market only,
  // one individual thread each.
  const seg = await admin("POST", "/api/admin/platform-messages", { market: "Nashville", body: "Segment note for finished Nashville creators.", templateId: "golden_ticket" });
  const segIds = (seg.data.recipients || []).slice().sort();
  check("(4) the segment reaches exactly the market's finished creators",
    seg.status === 201 && seg.data.sent === 2 && JSON.stringify(segIds) === JSON.stringify([nashA.id, nashB.id].sort()),
    `${seg.status} ${JSON.stringify(seg.data)}`);
  check("(4) the segment reports its own email outcomes (one sent, one stub-failed)",
    seg.data.emailSent === 1 && seg.data.emailFailed === 1, JSON.stringify(seg.data));
  const convoA2 = await nashA.client("GET", "/api/messages?with=signl-team");
  const convoB2 = await nashB.client("GET", "/api/messages?with=signl-team");
  check("(4) each recipient's copy lives in their OWN thread",
    convoA2.data.messages.length === 3 && convoB2.data.messages.length === 2
      && convoA2.data.messages[0].threadId !== convoB2.data.messages[0].threadId
      && convoA2.data.messages[2].body === "Segment note for finished Nashville creators."
      && convoB2.data.messages[1].body === "Segment note for finished Nashville creators.",
    `A=${convoA2.data.messages.length} B=${convoB2.data.messages.length}`);
  const listC = await richC.client("GET", "/api/messages");
  check("(4) a finished creator in another market gets nothing",
    !(listC.data.threads || []).some((t) => t.platform), JSON.stringify(listC.data.threads).slice(0, 160));
  const listP = await nashPending.client("GET", "/api/messages");
  const listI = await nashIncomplete.client("GET", "/api/messages");
  check("(4) pending and approved-but-unfinished creators are excluded",
    !(listP.data.threads || []).some((t) => t.platform) && !(listI.data.threads || []).some((t) => t.platform),
    "pending/incomplete received a platform thread");
  const segEvents = await eventsOf(admin, "platform_message_segment");
  check("(4) the fan-out itself is an Event Log record with market and count",
    segEvents.some((e) => e.data && e.data.market === "Nashville" && e.data.recipients === 2 && e.data.templateId === "golden_ticket"),
    JSON.stringify(segEvents).slice(0, 200));
  const segSent = (await eventsOf(admin, "platform_message_sent")).filter((e) => e.data && e.data.scope === "segment");
  check("(4) every fanned-out send is individually logged",
    segSent.length === 2 && segSent.every((e) => e.data.segmentMarket === "Nashville"),
    JSON.stringify(segSent).slice(0, 200));

  // (5) Creator reply: lands in Admin, unread until opened.
  const reply = await nashA.client("POST", "/api/messages", { toUserId: "signl-team", body: "Got it — my two are coming." });
  check("(5) a creator can reply in the platform thread",
    reply.status === 201 && reply.data.message.platform === true && reply.data.message.toId === "signl-team",
    `${reply.status} ${JSON.stringify(reply.data).slice(0, 200)}`);
  const overview1 = await admin("GET", "/api/admin/platform-messages");
  const threadRowA = (overview1.data.threads || []).find((t) => t.creatorId === nashA.id);
  check("(5) the reply surfaces in Admin's view as unread",
    !!threadRowA && threadRowA.unreadReplies === 1 && threadRowA.creatorName === "Nash Amy",
    JSON.stringify(overview1.data.threads).slice(0, 240));
  check("(5) the overview offers only markets with finished creators",
    Array.isArray(overview1.data.markets) && overview1.data.markets.includes("Nashville") && overview1.data.markets.includes("Richmond"),
    JSON.stringify(overview1.data.markets));
  const detail = await admin("GET", `/api/admin/platform-messages?creatorId=${nashA.id}`);
  check("(5) opening the thread in Admin returns the full conversation",
    detail.status === 200 && detail.data.messages.some((m) => m.fromId === nashA.id && m.body === "Got it — my two are coming."),
    `${detail.status} ${JSON.stringify(detail.data).slice(0, 240)}`);
  const overview2 = await admin("GET", "/api/admin/platform-messages");
  const threadRowA2 = (overview2.data.threads || []).find((t) => t.creatorId === nashA.id);
  check("(5) opening the thread clears Admin's unread count",
    !!threadRowA2 && threadRowA2.unreadReplies === 0, JSON.stringify(threadRowA2));
  const replyEvents = await eventsOf(admin, "platform_message_reply");
  check("(5) the reply is an Event Log record",
    replyEvents.some((e) => e.actorId === nashA.id && e.actorRole === "creator"),
    JSON.stringify(replyEvents).slice(0, 200));
  const adminReply = await admin("POST", "/api/admin/platform-messages", { creatorId: nashA.id, body: "Perfect — send them over." });
  const convoA3 = await nashA.client("GET", "/api/messages?with=signl-team");
  check("(5) an Admin reply from the thread view lands in the same thread",
    adminReply.status === 201 && convoA3.data.messages.length === 5 && convoA3.data.messages[4].fromId === "signl-team",
    `len=${convoA3.data.messages.length}`);

  // (6) Pre-launch: Denver is never toggled live in this suite.
  // The platform thread must work there anyway (it is the whole
  // point: founding creators get messaged before launch), while
  // person-to-person messaging stays behind the launch gate.
  const denD = await makeCreator(admin, { name: "Den Dana", email: "dend@fixtures.dev", handle: "dendana", market: "Denver" });
  const sendD = await admin("POST", "/api/admin/platform-messages", { creatorId: denD.id, body: "Denver is still founding — this thread works anyway." });
  check("(6) Admin can message a finished creator in a market that has not launched",
    sendD.status === 201 && sendD.data.sent === 1, `${sendD.status} ${JSON.stringify(sendD.data)}`);
  const listD = await denD.client("GET", "/api/messages");
  check("(6) a pre-launch creator can open their Messages and see the platform thread",
    listD.status === 200 && (listD.data.threads || []).some((t) => t.platform && t.otherName === "SIGNL"),
    `${listD.status} ${JSON.stringify(listD.data).slice(0, 200)}`);
  const convoD = await denD.client("GET", "/api/messages?with=signl-team");
  check("(6) a pre-launch creator can read the platform thread",
    convoD.status === 200 && convoD.data.messages.length === 1,
    `${convoD.status} ${JSON.stringify(convoD.data).slice(0, 160)}`);
  const notesD = await denD.client("GET", "/api/notifications");
  check("(6) the badge counts the platform thread pre-launch too",
    notesD.data.badges && notesD.data.badges.messages === 1, JSON.stringify(notesD.data.badges));
  const replyD = await denD.client("POST", "/api/messages", { toUserId: "signl-team", body: "Reading you from Denver." });
  check("(6) a pre-launch creator can reply to the SIGNL team",
    replyD.status === 201 && replyD.data.message.platform === true, `${replyD.status} ${JSON.stringify(replyD.data).slice(0, 160)}`);
  const personRead = await denD.client("GET", `/api/messages?with=${nashA.id}`);
  check("(6) person-to-person threads stay gated pre-launch (read)",
    personRead.status === 403, `${personRead.status}`);
  const personSend = await denD.client("POST", "/api/messages", { toUserId: nashA.id, body: "psst" });
  check("(6) person-to-person threads stay gated pre-launch (send)",
    personSend.status === 403, `${personSend.status}`);

  // Source checks: the email contract and the client surfaces.
  const routerJs = readFileSync(join(ROOT, "netlify/functions/lib/router.js"), "utf8");
  check("(7) the ping email contract: exact subject, sender line, 120-char preview, messages link",
    routerJs.includes('subject: "You have a new message on SIGNL"') && routerJs.includes("Jeff from SIGNL sent you a message.")
      && routerJs.includes("slice(0, 120)") && routerJs.includes("?open=messages"), "email builder drifted");
  const appJs = readFileSync(join(ROOT, "public/app.js"), "utf8");
  check("(8) the creator thread renders distinctly as the SIGNL team",
    appJs.includes("SIGNL team") && appJs.includes("thread-platform") && appJs.includes("platform-msg"), "thread rendering missing");
  check("(8) the email link lands on Messages (boot param) and opens the platform thread",
    appJs.includes('params.get("open") === "messages"') && appJs.includes('state.activeThread = "signl-team"'), "boot deep link missing");
  check("(8) Admin compose ships in Requests: panel, per-creator Message button, template picker",
    appJs.includes("Creator messages") && appJs.includes("adminMsgComposeTo") && appJs.includes("admin-msg-template") && appJs.includes("renderAdminMessages"), "admin compose missing");
  const buildJs = readFileSync(join(ROOT, "netlify/functions/lib/build.js"), "utf8");
  const indexHtml = readFileSync(join(ROOT, "public/index.html"), "utf8");
  check("(9) the build stamp is 2026.10.30-44 on server and shell",
    buildJs.includes('BUILD_ID = "2026.10.30-44"') && indexHtml.includes("2026.10.30-44"), "stamp mismatch");
} catch (e) {
  failures.push(`suite crashed: ${e.message}`);
  console.error(e);
} finally {
  if (server) server.kill("SIGTERM");
}

console.log(`\nverify-build40: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
