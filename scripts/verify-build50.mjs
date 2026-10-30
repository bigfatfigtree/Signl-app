#!/usr/bin/env node
// Build 2026.10.30-53 verification: the Finish Engine.
// Jeff approved v2 onboarding ideas #1 (finish-or-no-paid-work),
// #2 (the booking page turns on at finish), #3 (first look for
// founding finishers), #5 (Sig finishes it with you by message)
// and #8 (the stalled-profile rescue sequence) on 2026-10-30.
// Ideas #4, #6 and #7 were excluded and are not built.
//
// Coverage: static source contracts + copy scans (both lanes in
// touch 1's first breath, no forbidden claims, no em dashes in
// the default copy); the rescue sequence (audience = approved +
// unfinished only, day 0 / +3 / +7 spacing from touch 1, the
// three-touch cap, stop-on-finish, stop-on-opt-out, touch 3 held
// in a launched market, the Admin off switch, templates editable
// and honored); the Sig Concierge state machine (question order =
// the gate fields, answers write to the real profile, opportunistic
// multi-field replies, pause + resume, local % never prefilled and
// always the creator's own number); the finish moment (exactly
// once across paths, the real booking-page link, Charter claimed
// only where the -47 criteria support it).
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8955;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "build50-admin@signl.local";
const ADMIN_PASSWORD = ["build50", "admin", "pass"].join("-");
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const DAY = 24 * 60 * 60 * 1000;

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

async function makeIncompleteCreator(admin, { email, handle, market }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email, password: "claim-pass-1234", market, handle, ...AGREE,
  });
  if (reg.status !== 201) throw new Error(`quick claim ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  return { client: c, id: reg.data.user.id, email, handle };
}

async function platformMessages(creatorClient) {
  const r = await creatorClient("GET", "/api/messages?with=signl-team");
  const out = [];
  const threads = (r.data && r.data.threads) || [];
  for (const t of threads) for (const m of (t.messages || [])) if (m.fromId === "signl-team") out.push(m);
  if (!out.length && r.data && Array.isArray(r.data.messages)) for (const m of r.data.messages) if (m.fromId === "signl-team") out.push(m);
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

async function eventsOf(admin, type, subjectId) {
  const r = await admin("GET", `/api/admin/events?limit=2000&type=${encodeURIComponent(type)}`);
  const all = (r.data && r.data.events) || [];
  return subjectId ? all.filter((e) => e.subjectId === subjectId) : all;
}

async function meCreator(creatorClient) {
  const r = await creatorClient("GET", "/api/auth/me");
  return (r.data && r.data.user) || null;
}

// ---------- static contracts ----------
const routerSrc = readFileSync(join(ROOT, "netlify/functions/lib/router.js"), "utf8");
const appSrc = readFileSync(join(ROOT, "public/app.js"), "utf8");
const buildJs = readFileSync(join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = readFileSync(join(ROOT, "public/index.html"), "utf8");

check("stamp: build stamp is 2026.10.30-53 on server and shell",
  buildJs.includes('BUILD_ID = "2026.10.30-53"') && indexHtml.includes("2026.10.30-53"));
check("server: the finish engine section exists with all three components",
  routerSrc.includes("runFinishEngineSweep") && routerSrc.includes("handleFinishEngineReply") && routerSrc.includes("maybeFireFinishMoment") && routerSrc.includes("startFinishConcierge"));
check("server: admin finish-engine routes exist (state, toggle, templates, arm)",
  routerSrc.includes('seg[1] === "finish-engine"') && routerSrc.includes("finish_engine_toggled") && routerSrc.includes("finish_engine_templates_saved"));
check("client: the Admin Finish Engine panel exists with toggle, copy editor and concierge arm",
  appSrc.includes("admin-finish-panel") && appSrc.includes("adminFinishToggle") && appSrc.includes("adminFinishSaveTemplates") && appSrc.includes("adminFinishStartConcierge"));

const tplStart = routerSrc.indexOf("FINISH_ENGINE_DEFAULT_TEMPLATES");
const tplEnd = routerSrc.indexOf("FINISH_OPTOUT_RE");
const tplBlock = tplStart > -1 && tplEnd > tplStart ? routerSrc.slice(tplStart, tplEnd) : "";
check("copy: default templates block found", !!tplBlock);
const rescue1 = (tplBlock.match(/rescue1: "([^"]*)"/) || [])[1] || "";
check("copy: touch 1 leads with both lanes (comped visit + paid work) in the first breath",
  rescue1.includes("comped visit") && rescue1.includes("paid work at your own rate") && rescue1.includes("keep 97%"), rescue1.slice(0, 160));
check("copy: no em dashes in the default engine copy", !tplBlock.includes("—"));
check("copy: no invented activity in the default engine copy",
  !/businesses are (looking|browsing|waiting)|offers are waiting|waiting for you|guaranteed/i.test(tplBlock));
check("copy: touch 3 carries the founding first look and the closing window",
  tplBlock.includes("founding status for good") && tplBlock.includes("full day before everyone else") && tplBlock.includes("window closes the day the market opens"));
check("copy: the finish moment template is slotted, not hardcoded",
  tplBlock.includes("{pageLine}") && tplBlock.includes("{turnedOnLine}") && tplBlock.includes("{charterLine}"));
check("server: touch 3 is gated on the market not having launched",
  routerSrc.includes("market_launched_before_touch3") && routerSrc.includes("marketLaunchedByFlag(u.market)"));
check("server: the concierge asks only gate fields (no photo)",
  routerSrc.includes('CONCIERGE_FIELD_ORDER = ["handle", "city", "audience", "categories", "local"]'));

let server;
try {
  const dir = mkdtempSync(join(tmpdir(), "signl-build50-"));
  server = spawn(process.execPath, ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: join(dir, "db.json"), SIGNL_MAIL_STUB: "1", SIGNL_TEST_ALLOW_BUSINESS: "1", ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await waitUp();

  const admin = client();
  const login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(login.data)}`);
  await admin("POST", "/api/admin/markets/toggle", { market: "Denver", live: true });

  const T0 = Date.now();
  const sweepAt = async (days) => {
    const r = await admin("POST", "/api/admin/compliance/sweep", { now: new Date(T0 + days * DAY + 3600000).toISOString() });
    return r.data && r.data.finishEngine;
  };

  const A = await makeIncompleteCreator(admin, { email: "b50a@fixtures.dev", handle: "b50optout", market: "Nashville" });
  const B = await makeIncompleteCreator(admin, { email: "b50b@fixtures.dev", handle: "b50steps", market: "Nashville" });
  const C = await makeIncompleteCreator(admin, { email: "b50c@fixtures.dev", handle: "b50denver", market: "Denver" });
  const D = await makeIncompleteCreator(admin, { email: "b50d@fixtures.dev", handle: "b50pause", market: "Nashville" });
  const E = await makeIncompleteCreator(admin, { email: "b50e@fixtures.dev", handle: "b50mega", market: "Nashville" });
  const J = await makeIncompleteCreator(admin, { email: "b50j@fixtures.dev", handle: "b50quiet", market: "Nashville" });
  const G = await makeIncompleteCreator(admin, { email: "b50g@fixtures.dev", handle: "b50patch", market: "Nashville" });

  // F: a full-form registration completes at signup.
  const fc = client();
  const freg = await fc("POST", "/api/auth/register", {
    role: "creator", name: "Fay Full", email: "b50f@fixtures.dev", password: "creator-pass-123", market: "Nashville", city: "Nashville",
    handle: "b50full", followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"], primaryPlatform: "instagram", ...AGREE,
  });
  if (freg.status !== 201) throw new Error(`full form failed: ${JSON.stringify(freg.data)}`);
  const F = { client: fc, id: freg.data.user.id, email: "b50f@fixtures.dev", handle: "b50full" };
  const fEvents = await eventsOf(admin, "finish_moment_sent", F.id);
  check("finish moment: a full-form signup fires it once, via signup", fEvents.length === 1 && fEvents[0].data && fEvents[0].data.via === "signup", JSON.stringify(fEvents).slice(0, 200));
  // The message is sent at the finish moment; a still-pending
  // creator reads it the moment they are approved (the app's
  // standing review gate covers every message surface).
  await admin("POST", "/api/admin/review", { userId: F.id, decision: "approve" });
  const fMsgs = await platformMessages(F.client);
  check("finish moment: the signup finisher's thread carries the message with the page-off line (not yet public)",
    fMsgs.length === 1 && fMsgs[0].body.includes("Your booking page turns on in your Profile") && fMsgs[0].body.includes(`/c/b50full`), JSON.stringify(fMsgs).slice(0, 240));
  check("finish moment: no founding claim in a message composed before approval",
    fMsgs.length === 1 && !fMsgs[0].body.includes("founding status"), fMsgs.length ? fMsgs[0].body.slice(0, 200) : "no message");

  // ---------- rescue sequence: touch 1 ----------
  const s3 = await sweepAt(3);
  check("sequence: the day-3 sweep sends touch 1 to the approved unfinished audience",
    !!s3 && s3.touch1 === 7, JSON.stringify(s3));
  const aMsgs1 = await platformMessages(A.client);
  check("sequence: touch 1 lands in the platform thread with both lanes",
    aMsgs1.length === 1 && aMsgs1[0].body.includes("no business can book you") && aMsgs1[0].body.includes("comped visit") && aMsgs1[0].body.includes("keep 97%"), JSON.stringify(aMsgs1).slice(0, 240));
  const aPings = (await eventsOf(admin, "platform_message_email_sent")).filter((e) => e.data && e.data.to === A.email);
  check("sequence: touch 1 carries the -40 email ping", aPings.length >= 1, `${aPings.length}`);
  const s3b = await sweepAt(3.1);
  check("sequence: a repeat sweep inside the spacing sends nothing new", !!s3b && s3b.touch1 === 0 && s3b.touch2 === 0, JSON.stringify(s3b));

  // ---------- opt-out ----------
  await A.client("POST", "/api/messages", { toUserId: "signl-team", body: "STOP" });
  const aOpt = await eventsOf(admin, "finish_rescue_opted_out", A.id);
  check("opt-out: a STOP reply exits the creator and logs it", aOpt.length === 1, `${aOpt.length}`);

  // ---------- concierge: step by step (B) ----------
  await B.client("POST", "/api/messages", { toUserId: "signl-team", body: "yes please" });
  let bMsgs = await platformMessages(B.client);
  check("concierge: a consent reply starts the flow with the opener and the first (city) question, and writes nothing from the consent itself",
    bMsgs.length === 2 && bMsgs[1].body.includes("one question at a time") && bMsgs[1].body.includes("Which city do you call home") && !bMsgs[1].body.includes("simpler way"), JSON.stringify(bMsgs.map((m) => m.body)).slice(0, 300));
  let bMe = await meCreator(B.client);
  check("concierge: the consent reply did not become the city", !!bMe && !bMe.city, bMe && bMe.city);
  await B.client("POST", "/api/messages", { toUserId: "signl-team", body: "Nashville" });
  bMsgs = await platformMessages(B.client);
  bMe = await meCreator(B.client);
  check("concierge: the city answer writes to the real profile and the audience question follows",
    !!bMe && bMe.city === "Nashville" && bMsgs[bMsgs.length - 1].body.includes("How many followers"), `${bMe && bMe.city} :: ${bMsgs.length ? bMsgs[bMsgs.length - 1].body.slice(0, 120) : ""}`);
  await B.client("POST", "/api/messages", { toUserId: "signl-team", body: "about 9000" });
  bMe = await meCreator(B.client);
  check("concierge: the audience answer writes the stack (9000 on the primary platform)",
    !!bMe && bMe.creator && (bMe.creator.totalAudience === 9000 || (bMe.creator.audienceStack && bMe.creator.audienceStack.instagram === 9000)), JSON.stringify(bMe && bMe.creator && { t: bMe.creator.totalAudience, s: bMe.creator.audienceStack }));
  bMsgs = await platformMessages(B.client);
  check("concierge: the categories question follows the audience answer",
    bMsgs[bMsgs.length - 1].body.includes("What do you post about"), bMsgs[bMsgs.length - 1].body.slice(0, 120));
  await B.client("POST", "/api/messages", { toUserId: "signl-team", body: "food" });
  bMe = await meCreator(B.client);
  check("concierge: the category answer writes canonical categories; local % is still the creator's to give (null, never prefilled)",
    !!bMe && Array.isArray(bMe.creator.categories) && bMe.creator.categories.includes("Food & Drink") && (bMe.creator.localAudiencePct === null || bMe.creator.localAudiencePct === undefined), JSON.stringify(bMe && bMe.creator && { cats: bMe.creator.categories, local: bMe.creator.localAudiencePct }));
  bMsgs = await platformMessages(B.client);
  const localQ = bMsgs[bMsgs.length - 1].body;
  check("concierge: the local % question asks for the creator's own estimate and suggests no number",
    localQ.includes("your own estimate") && !/\blike \d+%|\bsay \d+%|around \d+%/.test(localQ), localQ.slice(0, 200));
  await B.client("POST", "/api/messages", { toUserId: "signl-team", body: "70" });
  bMe = await meCreator(B.client);
  check("concierge: the bare-number local answer is stored as the creator's own 70%",
    !!bMe && bMe.creator.localAudiencePct === 70, `${bMe && bMe.creator.localAudiencePct}`);
  check("concierge: the profile now reads complete", !!bMe && (bMe.creator.profileComplete === true || bMe.profileComplete === true), JSON.stringify(bMe && { pc: bMe.creator.profileComplete }));
  const bFinish = await eventsOf(admin, "finish_moment_sent", B.id);
  check("finish moment: crossing the gate inside the concierge fires it exactly once, via sig_concierge",
    bFinish.length === 1 && bFinish[0].data && bFinish[0].data.via === "sig_concierge" && bFinish[0].data.charter === true, JSON.stringify(bFinish).slice(0, 200));
  bMsgs = await platformMessages(B.client);
  const bFinishMsg = bMsgs[bMsgs.length - 1];
  check("finish moment: the closing message names the founding first look (approved + finished before Nashville opens)",
    bFinishMsg.body.includes("founding status for good") && bFinishMsg.body.includes("full day before everyone else"), bFinishMsg.body.slice(0, 240));
  const bCharter = await eventsOf(admin, "sig_concierge_completed", B.id);
  check("concierge: the completion transition is in the Event Log", bCharter.length === 1, `${bCharter.length}`);

  // ---------- concierge: one mega reply (E) ----------
  await E.client("POST", "/api/messages", { toUserId: "signl-team", body: "I'm in Nashville, 12k on instagram, mostly food and music, about 65% local" });
  const eMe = await meCreator(E.client);
  check("concierge: a volunteered multi-field reply fills every gate field at once",
    !!eMe && eMe.city === "Nashville" && eMe.creator.totalAudience === 12000 && eMe.creator.localAudiencePct === 65 && eMe.creator.categories.includes("Food & Drink") && eMe.creator.categories.includes("Music"),
    JSON.stringify(eMe && { city: eMe.city, t: eMe.creator.totalAudience, l: eMe.creator.localAudiencePct, cats: eMe.creator.categories }));
  const eFinish = await eventsOf(admin, "finish_moment_sent", E.id);
  check("finish moment: the mega-reply finisher gets exactly one finish moment", eFinish.length === 1, `${eFinish.length}`);

  // ---------- concierge: pause + resume (D) ----------
  await D.client("POST", "/api/messages", { toUserId: "signl-team", body: "ok go ahead" });
  await D.client("POST", "/api/messages", { toUserId: "signl-team", body: "later" });
  let dMsgs = await platformMessages(D.client);
  check("concierge: a pause reply parks the flow with a plain confirmation",
    dMsgs[dMsgs.length - 1].body.includes("pick up right where we left off"), dMsgs[dMsgs.length - 1].body.slice(0, 160));
  const dCountBefore = dMsgs.length;

  // ---------- finish via PATCH with the page switched on (G) ----------
  await G.client("PATCH", "/api/me/profile", { city: "Nashville", audienceStack: { instagram: 5000 }, categories: ["Music"], localAudiencePct: 55, publicPage: true });
  const gFinish = await eventsOf(admin, "finish_moment_sent", G.id);
  check("finish moment: a normal profile save fires it once, via profile", gFinish.length === 1 && gFinish[0].data && gFinish[0].data.via === "profile", JSON.stringify(gFinish).slice(0, 200));
  const gMsgs = await platformMessages(G.client);
  const gFinishMsg = gMsgs[gMsgs.length - 1];
  check("finish moment: with the book-me page on, the message carries the real live link",
    gFinishMsg.body.includes("Your booking page is live:") && gFinishMsg.body.includes(`${BASE}/c/b50patch`), gFinishMsg.body.slice(0, 240));
  await G.client("PATCH", "/api/me/profile", { bio: "A longer bio written after finishing, well over forty characters for the points layer." });
  const gFinish2 = await eventsOf(admin, "finish_moment_sent", G.id);
  check("finish moment: later saves never fire it again", gFinish2.length === 1, `${gFinish2.length}`);

  // ---------- spacing: touch 2 at +6d goes only to C and J ----------
  const s6 = await sweepAt(6);
  check("sequence: touch 2 fires at touch 1 + 3 days for the still-unfinished (C and J only)",
    !!s6 && s6.touch2 === 2, JSON.stringify(s6));
  dMsgs = await platformMessages(D.client);
  check("sequence: a creator inside the concierge gets no rescue touches", dMsgs.length === dCountBefore, `${dMsgs.length} vs ${dCountBefore}`);
  const aMsgsAfter = await platformMessages(A.client);
  check("opt-out: the opted-out creator receives nothing further", aMsgsAfter.length === 1, `${aMsgsAfter.length}`);

  // ---------- touch 3 at +10d: J gets it, C is held (Denver launched) ----------
  const s10 = await sweepAt(10);
  check("sequence: touch 3 fires for the unlaunched-market creator and is held for the launched one",
    !!s10 && s10.touch3 === 1 && s10.touch3HeldLaunched === 1, JSON.stringify(s10));
  const cMsgs = await platformMessages(C.client);
  check("sequence: the launched-market creator stops at two touches", cMsgs.length === 2, `${cMsgs.length}`);
  const cClosed = await eventsOf(admin, "finish_rescue_closed", C.id);
  check("sequence: the held touch 3 is logged as closed, not sent", cClosed.length === 1, `${cClosed.length}`);
  const jMsgs = await platformMessages(J.client);
  check("sequence: touch 3 carries the founding first look copy",
    jMsgs.length === 3 && jMsgs[2].body.includes("founding status for good"), `${jMsgs.length} :: ${jMsgs.length === 3 ? jMsgs[2].body.slice(0, 120) : ""}`);
  const s20 = await sweepAt(20);
  const jMsgsAfter = await platformMessages(J.client);
  check("sequence: the three-touch cap holds forever", !!s20 && s20.touch1 === 0 && jMsgsAfter.length === 3, `${jMsgsAfter.length}`);

  // ---------- resume after pause (D) ----------
  await D.client("POST", "/api/messages", { toUserId: "signl-team", body: "Nashville" });
  dMsgs = await platformMessages(D.client);
  check("concierge: a paused flow resumes where it left off (the city answer advances to the audience question)",
    dMsgs[dMsgs.length - 1].body.includes("How many followers"), dMsgs[dMsgs.length - 1].body.slice(0, 160));

  // ---------- Admin surface ----------
  const fe = await admin("GET", "/api/admin/finish-engine");
  check("admin: the finish engine state reads back with counts and roster",
    fe.status === 200 && fe.data.finishEngine && fe.data.finishEngine.enabled === true && fe.data.finishEngine.counts.finishMoments >= 4
      && (fe.data.finishEngine.roster || []).some((r) => r.id === A.id && r.optedOut === true),
    JSON.stringify(fe.data).slice(0, 240));
  const feGuard = await B.client("GET", "/api/admin/finish-engine");
  check("admin: a creator cannot read the finish engine state", feGuard.status === 403, `${feGuard.status}`);

  // ---------- off switch + template edits (H) ----------
  const H = await makeIncompleteCreator(admin, { email: "b50h@fixtures.dev", handle: "b50late", market: "Nashville" });
  await admin("POST", "/api/admin/finish-engine", { enabled: false });
  const sOff = await sweepAt(30);
  const hMsgsOff = await platformMessages(H.client);
  check("admin: with the engine off, sweeps send nothing", !!sOff && sOff.touch1 === 0 && hMsgsOff.length === 0, `${hMsgsOff.length}`);
  await admin("POST", "/api/admin/finish-engine", { enabled: true });
  const custom = "TESTCOPY opening for {firstName}. Your profile is not finished, so no business can book you yet, not for a comped visit and not for paid work at your own rate where you keep 97%. Reply and Sig will finish it with you.";
  const tplSave = await admin("POST", "/api/admin/finish-engine", { templates: { rescue1: custom } });
  check("admin: template edits save (prefill-and-edit)", tplSave.status === 200, `${tplSave.status}`);
  const s31 = await sweepAt(31);
  const hMsgs = await platformMessages(H.client);
  check("admin: the edited copy is what the engine sends",
    !!s31 && s31.touch1 >= 1 && hMsgs.length === 1 && hMsgs[0].body.startsWith("TESTCOPY opening for"), JSON.stringify(s31) + " :: " + (hMsgs.length ? hMsgs[0].body.slice(0, 80) : "none"));

  // ---------- Admin-armed concierge (I) ----------
  const I = await makeIncompleteCreator(admin, { email: "b50i@fixtures.dev", handle: "b50armed", market: "Nashville" });
  const arm = await admin("POST", "/api/admin/finish-engine", { action: "start_concierge", creatorId: I.id });
  check("admin: arming the concierge succeeds for an unfinished creator", arm.status === 200, `${arm.status} ${JSON.stringify(arm.data).slice(0, 120)}`);
  const iMsgs = await platformMessages(I.client);
  check("admin: the armed concierge opens with the offer and the first question",
    iMsgs.length === 1 && iMsgs[0].body.includes("finish your profile with you right here") && iMsgs[0].body.includes("Which city do you call home"), JSON.stringify(iMsgs).slice(0, 240));
  await I.client("POST", "/api/messages", { toUserId: "signl-team", body: "Nashville" });
  const iMsgs2 = await platformMessages(I.client);
  check("admin: the armed concierge takes answers like the rescue-started one",
    iMsgs2.length === 2 && iMsgs2[1].body.includes("How many followers"), `${iMsgs2.length}`);
  const armDone = await admin("POST", "/api/admin/finish-engine", { action: "start_concierge", creatorId: F.id });
  check("admin: arming a finished creator is refused", armDone.status === 400, `${armDone.status}`);

  console.log(`\nverify-build50: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log("FAILURES:", failures.join(" | ")); process.exitCode = 1; }
} catch (e) {
  console.error("verify-build50 error:", e);
  process.exitCode = 1;
} finally {
  if (server) server.kill();
}
