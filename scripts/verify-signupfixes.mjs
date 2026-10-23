// End-to-end verification of the SIGNL signup-flow fix bundle
// (2026-10-22, built from the signup flow audit):
//   F2  a PENDING creator can fix a wrong market from the pending
//       screen (POST /me/market, canonical + unlisted validation,
//       pending-only; approved creators are refused).
//   F4  a human admin rejection emails the creator (reason
//       category when supplied, generic line otherwise);
//       auto-decision rejections stay silent, exactly as before;
//       rejected accounts get no pending-flow emails after.
//   F9  the un-completion guard: pure client helpers predict the
//       flip (local % cleared, categories removed, audience
//       zeroed) and the full-signup all-zero warning; the server
//       truth is unchanged, so a confirmed save still flips.
//   F1  the local % estimator helper copy ships under both local %
//       fields (mitigation; the gate itself stays), and ask-once:
//       a stored local % carries into completion, the gate checks
//       presence, not re-entry.
//   F3  the picker disclosure line ships at all three primary
//       platform pickers (mitigation; the IG-only proof rule is
//       unchanged).
// Run: node scripts/verify-signupfixes.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { rejectionEmail, REJECTION_REASONS } = require("../netlify/functions/lib/router.js");

const PORT = 8963;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-admin-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-signupfixes-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`);
  }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (v) jar.set(k, v); else jar.delete(k);
      }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data };
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + "/api/bootstrap");
      if (res.ok) return true;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: {
    ...process.env,
    SIGNL_LOCAL: "1",
    SIGNL_LOCAL_DB: DB,
    ADMIN_EMAIL,
    [["ADMIN", "PASSWORD"].join("_")]: ADMIN_PW,
    APP_URL: BASE,
    SIGNL_TEST_ALLOW_BUSINESS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  const eventsOf = async (type) => {
    const r = await admin("GET", `/api/admin/events?limit=500&type=${encodeURIComponent(type)}`);
    return (r.data && r.data.events) || [];
  };
  const quickClaim = async (email, handle, market) => {
    const c = client();
    const r = await c("POST", "/api/auth/register", { role: "creator", quickClaim: true, email, password: "claim-" + "pass-1234", market, handle, ...AGREE });
    return { c, r };
  };

  // ---------- F4 unit level: the rejection email copy ----------
  check("rejection reason categories are exactly the fixed five", JSON.stringify(REJECTION_REASONS) === JSON.stringify(["Not local enough", "Audience too small for this wave", "Content not a fit", "Market not open yet", "Other"]), JSON.stringify(REJECTION_REASONS));
  const rejUser = { name: "Rej Tester", email: "rej@fixtures.dev", market: "Hampton Roads", city: "Norfolk", creator: { handle: "rejtester" } };
  const withReason = rejectionEmail(rejUser, "Not local enough");
  check("rejection email subject says the outcome plainly", withReason.subject === "Your founding application: not a fit for this round", withReason.subject);
  check("rejection email with a reason names the category in plain words", withReason.text.includes("The honest reason: your audience is not local enough to your market yet."), withReason.text);
  check("rejection email invites reapplying when their market expands", withReason.text.includes("apply again when your market expands"));
  check("rejection email signs as Jeff / Founder, SIGNL", withReason.text.includes("\nJeff\nFounder, SIGNL\nhello@joinsignl.com"));
  const noReason = rejectionEmail(rejUser, null);
  check("rejection email without a reason carries the kind generic line and no reason line", !noReason.text.includes("The honest reason") && noReason.text.includes("not about the quality of your work"), noReason.text);
  const bogusReason = rejectionEmail(rejUser, "Bogus reason");
  check("an unknown reason value reads as no reason given", bogusReason.text === noReason.text);
  const unlMail = rejectionEmail({ ...rejUser, market: "Not listed yet", city: "Tulsa" }, "Market not open yet");
  check("rejection email for an unlisted creator names their city", unlMail.text.includes("Founding Creator in Tulsa"), unlMail.text);
  const lockRe = /\block(ed|s|ing)?\b/i;
  check("rejection email has no em dashes and no lock language", !withReason.text.includes("—") && !noReason.text.includes("—") && !lockRe.test(withReason.text) && !lockRe.test(withReason.subject));

  // ---------- F2: wrong-market fix, pending only ----------
  const m = await quickClaim("wrongmarket@fixtures.dev", "wrongmarket757", "Hampton Roads");
  check("wrong-market claim registers pending in Hampton Roads (the default mistake)", m.r.status === 201 && m.r.data.user.status === "pending" && m.r.data.user.market === "Hampton Roads", JSON.stringify(m.r.data.user && { status: m.r.data.user.status, market: m.r.data.user.market }));
  const mId = m.r.data.user.id;

  const anonMove = await client()("POST", "/api/me/market", { market: "Raleigh", city: "Raleigh" });
  check("market change signed out is refused (401)", anonMove.status === 401, String(anonMove.status));

  const noCity = await m.c("POST", "/api/me/market", { market: "Richmond" });
  check("market change without a city in the new market is refused (400, city stays consistent)", noCity.status === 400, JSON.stringify(noCity.data));
  const wrongCity = await m.c("POST", "/api/me/market", { market: "Richmond", city: "Norfolk" });
  check("a city from another market is refused (400, canonical validation)", wrongCity.status === 400, JSON.stringify(wrongCity.data));
  const badMarket = await m.c("POST", "/api/me/market", { market: "Atlantis", city: "Atlantis" });
  check("an unknown market is refused (400)", badMarket.status === 400, JSON.stringify(badMarket.data));

  const moved = await m.c("POST", "/api/me/market", { market: "Raleigh", city: "Raleigh" });
  check("pending creator moves Hampton Roads -> Raleigh", moved.status === 200 && moved.data.user.market === "Raleigh" && moved.data.user.city === "Raleigh" && moved.data.user.country === "United States", JSON.stringify(moved.data.user && { market: moved.data.user.market, city: moved.data.user.city, country: moved.data.user.country }));
  check("the change is stamped on the record (marketChangedAt)", typeof moved.data.user.marketChangedAt === "string" && moved.data.user.marketChangedAt.length > 0);

  const unlNoCountry = await m.c("POST", "/api/me/market", { market: "Not listed yet", customCity: "Tulsa" });
  check("the unlisted path still requires a typed country (400)", unlNoCountry.status === 400, JSON.stringify(unlNoCountry.data));
  const unlMoved = await m.c("POST", "/api/me/market", { market: "Not listed yet", customCity: "Tulsa", customCountry: "United States", customState: "ok" });
  check("pending creator moves to the unlisted typed-city path (state uppercased)", unlMoved.status === 200 && unlMoved.data.user.market === "Not listed yet" && unlMoved.data.user.city === "Tulsa" && unlMoved.data.user.country === "United States" && unlMoved.data.user.state === "OK", JSON.stringify(unlMoved.data.user && { market: unlMoved.data.user.market, city: unlMoved.data.user.city, state: unlMoved.data.user.state }));
  const backListed = await m.c("POST", "/api/me/market", { market: "Raleigh", city: "Raleigh" });
  check("and back to a listed market (city validated again)", backListed.status === 200 && backListed.data.user.market === "Raleigh" && backListed.data.user.city === "Raleigh");

  const mEvents = (await eventsOf("market_changed")).filter((e) => e.subjectId === mId);
  check("market changes are logged as events with from/to", mEvents.some((e) => e.data.from === "Hampton Roads" && e.data.to === "Raleigh") && mEvents.some((e) => e.data.from === "Raleigh" && e.data.to === "Not listed yet"), JSON.stringify(mEvents.map((e) => e.data)));

  // A business cannot use the creator route.
  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", { role: "business", name: "Fix Owner", businessName: "Market Fix Cafe", email: "fixbiz@fixtures.dev", password: "business-" + "pass-123", market: "Hampton Roads", city: "Norfolk", category: "Restaurant", planId: "growth", agreedTerms: true });
  const bizId = bizReg.data.user && bizReg.data.user.id;
  check("business registers pending", bizReg.status === 201 && bizReg.data.user.status === "pending", JSON.stringify(bizReg.data));
  const bizMove = await biz("POST", "/api/me/market", { market: "Raleigh", city: "Raleigh" });
  check("business market change is refused (403, creators only)", bizMove.status === 403, String(bizMove.status));

  // ---------- F4: human rejection emails; auto stays silent ----------
  const ra = await quickClaim("rejalpha@fixtures.dev", "rejalpha757", "Hampton Roads");
  const raId = ra.r.data.user.id;
  const rejA = await admin("POST", "/api/admin/review", { userId: raId, decision: "reject" });
  check("admin rejects creator A without a reason", rejA.status === 200 && rejA.data.user.status === "rejected", JSON.stringify(rejA.data));
  check("rejection email queued exactly once for A", (await eventsOf("rejection_email_queued")).filter((e) => e.subjectId === raId).length === 1);
  const rejEventA = (await eventsOf("application_rejected")).find((e) => e.subjectId === raId);
  check("A's rejection event carries no reason", !!rejEventA && !(rejEventA.data && rejEventA.data.rejectionReason), JSON.stringify(rejEventA && rejEventA.data));

  const rb = await quickClaim("rejbeta@fixtures.dev", "rejbeta757", "Hampton Roads");
  const rbId = rb.r.data.user.id;
  const rejB = await admin("POST", "/api/admin/review", { userId: rbId, decision: "reject", reason: "Market not open yet" });
  check("admin rejects creator B with a reason category", rejB.status === 200 && rejB.data.user.status === "rejected");
  check("rejection email queued exactly once for B", (await eventsOf("rejection_email_queued")).filter((e) => e.subjectId === rbId).length === 1);
  const rejEventB = (await eventsOf("application_rejected")).find((e) => e.subjectId === rbId);
  check("B's rejection event carries the reason category", !!rejEventB && rejEventB.data && rejEventB.data.rejectionReason === "Market not open yet", JSON.stringify(rejEventB && rejEventB.data));
  const appsAfter = await admin("GET", "/api/admin/applications");
  const decidedB = (appsAfter.data.decided || []).find((u) => u.id === rbId);
  check("admin payload shows B's stored rejection reason", !!decidedB && decidedB.rejectionReason === "Market not open yet", JSON.stringify(decidedB && decidedB.rejectionReason));
  const meB = await rb.c("GET", "/api/auth/me");
  check("the rejection reason never leaks into the creator's own payload", meB.status === 200 && !("rejectionReason" in meB.data.user));

  const rc = await quickClaim("rejgamma@fixtures.dev", "rejgamma757", "Hampton Roads");
  const rcId = rc.r.data.user.id;
  await admin("POST", "/api/admin/review", { userId: rcId, decision: "reject", reason: "Bogus reason" });
  check("a bogus reason still rejects and emails, with no reason stored", (await eventsOf("rejection_email_queued")).filter((e) => e.subjectId === rcId).length === 1 && !(await eventsOf("application_rejected")).find((e) => e.subjectId === rcId).data.rejectionReason);

  const auto = await quickClaim("spamclaim@example.com", "spamclaim757", "Hampton Roads");
  check("example.com claim auto-rejects at sign-up", auto.r.status === 201 && auto.r.data.user.status === "rejected", JSON.stringify(auto.r.data.user && auto.r.data.user.status));
  const autoId = auto.r.data.user.id;
  check("auto-decision rejection sends NO rejection email", (await eventsOf("rejection_email_queued")).filter((e) => e.subjectId === autoId).length === 0 && (await eventsOf("rejection_email_sent")).filter((e) => e.subjectId === autoId).length === 0);

  const rejBiz = await admin("POST", "/api/admin/review", { userId: bizId, decision: "reject" });
  check("admin rejects the business", rejBiz.status === 200 && rejBiz.data.user.status === "rejected");
  check("business rejection sends no rejection email (creators only)", (await eventsOf("rejection_email_queued")).filter((e) => e.subjectId === bizId).length === 0);

  // Rejected accounts receive no further pending-flow emails: the
  // day-3 profile reminder sweep targets approved creators only,
  // and this pins that rejected records stay out of it for good.
  const sweep = await admin("POST", "/api/admin/compliance/sweep", { now: new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString() });
  check("reminder sweep at day 4 sends nothing (nobody eligible, rejected included)", sweep.status === 200 && sweep.data.profileReminders && sweep.data.profileReminders.sent === 0, JSON.stringify(sweep.data.profileReminders));
  const remEvents = await eventsOf("profile_completion_reminder_email_queued");
  check("no profile reminder email queued for any rejected account", !remEvents.some((e) => [raId, rbId, rcId, autoId].includes(e.subjectId)), JSON.stringify(remEvents.map((e) => e.subjectId)));

  // ---------- F2 tail: once decided, the market is set ----------
  const approveM = await admin("POST", "/api/admin/review", { userId: mId, decision: "approve" });
  check("admin approves the moved creator", approveM.status === 200 && approveM.data.user.status === "approved");
  const lateMove = await m.c("POST", "/api/me/market", { market: "Richmond", city: "Richmond" });
  check("approved creator market change is refused (403) and points at hello@", lateMove.status === 403 && /hello@joinsignl\.com/.test(lateMove.data.error || ""), JSON.stringify(lateMove.data));

  // ---------- F1 ask-once: stored local % carries into completion ----------
  const d = await quickClaim("askonce@fixtures.dev", "askonce757", "Hampton Roads");
  const dId = d.r.data.user.id;
  await admin("POST", "/api/admin/review", { userId: dId, decision: "approve" });
  const pctOnly = await d.c("PATCH", "/api/me/profile", { localAudiencePct: 55 });
  check("partial save stores the local % (local gate item done, still incomplete)", pctOnly.status === 200 && pctOnly.data.user.creator.localAudiencePct === 55 && pctOnly.data.user.profileCompletion.complete === false && !pctOnly.data.user.profileCompletion.missing.includes("local"), JSON.stringify(pctOnly.data.user && pctOnly.data.user.profileCompletion));
  const finish = await d.c("PATCH", "/api/me/profile", { city: "Norfolk", categories: ["Food & Drink"], audienceStack: { instagram: 1200 } });
  check("completion without re-entering the local % flips complete, value carried", finish.status === 200 && finish.data.user.profileCompletion.complete === true && finish.data.user.creator.profileComplete === true && finish.data.user.creator.localAudiencePct === 55, JSON.stringify(finish.data.user && { complete: finish.data.user.profileCompletion && finish.data.user.profileCompletion.complete, pct: finish.data.user.creator.localAudiencePct }));

  // ---------- F9 server truth: a confirmed save still flips ----------
  const cleared = await d.c("PATCH", "/api/me/profile", { localAudiencePct: null });
  check("clearing the local % still flips the profile incomplete server-side (the guard warns, never blocks)", cleared.status === 200 && cleared.data.user.profileCompletion.complete === false && cleared.data.user.creator.localAudiencePct === null, JSON.stringify(cleared.data.user && cleared.data.user.profileCompletion));

  // ---------- client: guard helpers exercised directly ----------
  const appJs = await (await fetch(BASE + "/app.js")).text();
  const extractFn = (name) => {
    const start = appJs.indexOf(`function ${name}(`);
    if (start < 0) return null;
    const end = appJs.indexOf("\n}\n", start);
    if (end < 0) return null;
    return new Function(`${appJs.slice(start, end + 3)}\nreturn ${name};`)();
  };
  const uncompleteWarnings = extractFn("uncompleteWarnings");
  const zeroAudienceWarnings = extractFn("zeroAudienceWarnings");
  check("client ships the pure guard helpers", typeof uncompleteWarnings === "function" && typeof zeroAudienceWarnings === "function");
  if (uncompleteWarnings && zeroAudienceWarnings) {
    check("guard: an incomplete profile saving anything gets no warning", uncompleteWarnings(false, { localPctBlank: true, categoryCount: 0, stackTotal: 0 }).length === 0);
    const wPct = uncompleteWarnings(true, { localPctBlank: true, categoryCount: 2, stackTotal: 900 });
    check("guard: clearing the local % warns, naming the offline consequence", wPct.length === 1 && wPct[0].includes("local audience %") && wPct[0].includes("offline to businesses"), JSON.stringify(wPct));
    const wCats = uncompleteWarnings(true, { localPctBlank: false, categoryCount: 0, stackTotal: 900 });
    check("guard: removing all categories warns", wCats.length === 1 && wCats[0].includes("categories"), JSON.stringify(wCats));
    const wStack = uncompleteWarnings(true, { localPctBlank: false, categoryCount: 2, stackTotal: 0 });
    check("guard: zeroing the audience warns", wStack.length === 1 && wStack[0].includes("audience count"), JSON.stringify(wStack));
    check("guard: all three flips at once warn three times", uncompleteWarnings(true, { localPctBlank: true, categoryCount: 0, stackTotal: 0 }).length === 3);
    check("guard: a neutral complete-profile save warns zero times", uncompleteWarnings(true, { localPctBlank: false, categoryCount: 2, stackTotal: 900 }).length === 0);
    const wZero = zeroAudienceWarnings(0);
    check("signup guard: an all-zero stack warns the profile will not be bookable", wZero.length === 1 && wZero[0].includes("will not be bookable"), JSON.stringify(wZero));
    check("signup guard: any positive count warns zero times", zeroAudienceWarnings(1200).length === 0);
    check("guard copy has no em dashes", ![...wPct, ...wCats, ...wStack, ...wZero].some((l) => l.includes("—")));
  }

  // ---------- client: shipped surfaces ----------
  check("pending screen ships the Wrong market? form wired to /me/market", appJs.includes("Wrong market?") && appJs.includes('id="pm-market"') && appJs.includes('id="pm-custom-wrap"') && appJs.includes("togglePendingMarket") && appJs.includes("syncPendingMarketChoice") && appJs.includes("savePendingMarket") && appJs.includes('"/me/market"'));
  check("profile form tells approved creators the market path (email hello@)", appJs.includes("Wrong market? Email hello@joinsignl.com and we will move it for you."));
  check("admin ships the reject reason picker with the fixed categories", appJs.includes("toggleRejectEditor") && appJs.includes("confirmRejectApp") && appJs.includes('id="rej-reason-${u.id}"') && appJs.includes("named in their rejection email") && appJs.includes("<option>Audience too small for this wave</option>"));
  check("profile save wires the guard: warnings computed, inline confirm, photo failure named", appJs.includes("uncompleteWarnings(wasProfileComplete") && appJs.includes('confirmSaveWarning("save-warn"') && appJs.includes('id="save-warn"') && appJs.includes("photoFailed") && appJs.includes("Your new photo did not upload"));
  check("full signup wires the zero-audience warning before submit", appJs.includes("zeroAudienceWarnings(signupStackTotal())") && appJs.includes('confirmSaveWarning("jc-save-warn"') && appJs.includes('id="jc-save-warn"'));
  check("picker disclosure ships verbatim at all three pickers", appJs.includes("Heads up: visit proof is an Instagram post link for now, so SIGNL visits get posted on Instagram.") && appJs.includes('id="qc-proof-note"') && appJs.includes('id="jc-proof-note"') && appJs.includes('id="p-proof-note"') && appJs.includes('syncProofDisclosure("qc-platform", "qc-proof-note")') && appJs.includes('syncProofDisclosure("jc-platform", "jc-proof-note")') && appJs.includes('onchange="syncPPlatform()"'));
  check("local % estimator help ships once as a constant and renders under both local % fields", appJs.includes("Insights, then Audience, then your top cities") && appJs.includes("Add up the share in the cities in your market area") && appJs.includes("A rough number is fine: it is labeled Self-reported everywhere it appears") && (appJs.match(/\$\{LOCAL_PCT_HELP\}/g) || []).length === 2);
  check("profile edit prefills the stored local % (ask once)", appJs.includes('value="${c.localAudiencePct === null || c.localAudiencePct === undefined ? "" : c.localAudiencePct}"'));
} finally {
  server.kill("SIGTERM");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nSignup fixes verification: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("Failures: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
