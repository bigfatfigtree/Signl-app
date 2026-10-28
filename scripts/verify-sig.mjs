// Sig verification (2026-10-27, "He needs to be a real AI").
//
// Two proofs:
//  1. THE BANK: the deterministic canon bank + semantic matcher,
//     extracted verbatim from public/app.js, must resolve a
//     battery of realistic questions (40+ per side, messy
//     phrasings and typos included, Jeff's exact "How do I make
//     money" first) to the right topic. The bank is Sig's
//     fallback brain, so it has to be right on its own.
//  2. THE AI PATH: the app server is booted with the AI provider
//     pointed at a local OpenAI-compatible stub. POST
//     /api/sig/ask must return source "ai" with the model's text,
//     the stub must receive a system prompt carrying the locked
//     canon ($199/$349/$699, 97%, local reach) plus the asker's
//     own state, a dead provider must degrade to source
//     "unavailable" (never a 500), and signed-out calls get 401.
//     In production the provider credentials are injected by
//     Netlify AI Gateway; this suite proves the wire end to end.
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = 8927;
const STUB_PORT = 8928;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = fs.mkdtempSync("/tmp/signl-sig-") + "/db.json";

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok -", name);
  else { failures++; console.log("  FAIL -", name, extra || ""); }
}

// ---------- 1. The bank battery ----------
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const start = appJs.indexOf("function sigBankFor");
const end = appJs.indexOf("// SIGBANK-END");
if (start < 0 || end < 0) { console.log("FAIL - bank markers not found in app.js"); process.exit(1); }
const bankCode = appJs.slice(start, end);
const sandbox = { VISIT_GUARANTEE_LINE: "Visit Guarantee: if a booked creator does not show up or does not post, that visit does not count against your monthly visits. It is replaced." };
vm.createContext(sandbox);
vm.runInContext(bankCode + "\nthis.__sig = { sigBankFor, sigMatch };", sandbox);
const { sigBankFor, sigMatch } = sandbox.__sig;

const CREATOR_QS = [
  ["How do I make money", "money"], ["how do i make money on here", "money"], ["can I make money doing this", "money"], ["how do i earn", "money"], ["what can I earn", "money"], ["how do creators make money", "money"], ["is there money in this", "money"], ["ways to earn on signl", "money"],
  ["when do i get paid", "payout"], ["how do payouts work", "payout"], ["when do I get paid for a booking", "payout"], ["how do i get paid", "payout"], ["how do I get paid out", "payout"],
  ["how do I set my rate", "rates"], ["what should I charge", "rates"], ["how much can I charge for a post", "rates"], ["can I change my rate", "rates"],
  ["what is local reach", "localreach"], ["what does local reach mean", "localreach"], ["how is my local reach calculated", "localreach"], ["why does local reach matter", "localreach"],
  ["how does momentum work", "momentum"], ["how do I earn points", "momentum"], ["what are momentum points", "momentum"], ["how do i get more momemtum", "momentum"], ["what do points do", "momentum"],
  ["what tier am I", "tiers"], ["how do tiers work", "tiers"], ["what is a headliner", "tiers"],
  ["how does a visit work", "visits"], ["what is a visit code", "visits"], ["how do I check in at a visit", "visits"], ["how do visits work", "visits"],
  ["what do I owe after a visit", "owe"], ["what do I have to post", "owe"], ["what are the deliverables", "owe"],
  ["I can't make my visit tomorrow", "cantmake"], ["what if I have to cancel a visit", "cantmake"], ["something came up, can I reschedule a visit", "cantmake"],
  ["what is a license request", "licensing"], ["how does licensing work", "licensing"], ["can a business reuse my post", "licensing"],
  ["what do I need to finish my profile", "profilegate"], ["why can't businesses see me", "profilegate"], ["how do I complete my profile", "profilegate"], ["am I showing up to businesses", "profilegate"],
  ["how do referrals work", "invites"], ["how do I invite other creators", "invites"], ["what do I get for inviting people", "invites"],
  ["how do I get offers", "offers"], ["why am I not getting any offers", "offers"], ["how do I get booked", "offers"], ["where do I find work", "offers"],
  ["do I review the business", "reviews"], ["how do ratings work", "reviews"],
  ["when does my market open", "markets"], ["when will signl launch in my city", "markets"], ["is my market open", "markets"],
  ["how do I change my password", "help"], ["how do I talk to a human", "help"],
];
const BUSINESS_QS = [
  ["what does it cost", "cost"], ["how much is SIGNL", "cost"], ["how much does it cost per month", "cost"], ["what is the pricing", "cost"], ["how much do I pay per month", "cost"],
  ["what's the difference between growth and managed", "plans"], ["which plan should I pick", "plans"], ["what does the growth plan include", "plans"],
  ["how does signl work", "howitworks"], ["how does this work for my business", "howitworks"], ["what is signl", "howitworks"],
  ["is this ugc", "ugc"], ["can I reuse a creator's post", "ugc"], ["can I run their post as an ad", "ugc"], ["can I use their photos in my marketing", "ugc"],
  ["how do paid bookings work", "paidlane"], ["how much do creators charge", "paidlane"], ["do creators set their own rates", "paidlane"],
  ["how do I invite a creator", "invite"], ["where do I find creators", "invite"],
  ["how fast do I have to answer applicants", "applicants"], ["how long do I have to decide on applicants", "applicants"], ["what's the deadline to answer an applicant", "applicants"],
  ["what if a creator doesn't show up", "noshow"], ["what happens if a creator ghosts", "noshow"], ["the creator never posted, what now", "noshow"],
  ["can I ask for a positive post", "honesty"], ["can I approve the post before it goes live", "honesty"], ["can I require a positive review", "honesty"],
  ["how does redeeming a visit work", "redeem"], ["how do I enter a visit code", "redeem"], ["my staff lost the counter code, what do we do", "redeem"],
  ["how do I see my results", "metrics"], ["how do I track my results", "metrics"], ["when do the numbers show up", "metrics"],
  ["when does my market open", "marketbiz"], ["can I join now", "marketbiz"], ["is my city live yet", "marketbiz"],
  ["how do I reset my password", "help"], ["how do I change the staff pin", "help"],
];
let bankPass = 0, bankTotal = 0;
for (const [side, qs] of [["creator", CREATOR_QS], ["business", BUSINESS_QS]]) {
  for (const [q, want] of qs) {
    bankTotal++;
    const m = sigMatch(q, side === "business");
    if (m.topic && m.topic.id === want) bankPass++;
    else console.log(`  FAIL - [${side}] "${q}" -> ${m.topic ? m.topic.id : "FALLBACK"} (want ${want})`);
  }
}
check(`bank battery: ${bankPass}/${bankTotal} resolve to the right topic`, bankPass === bankTotal);
check("bank battery is at least 40 questions per side", CREATOR_QS.length >= 40 && BUSINESS_QS.length >= 40, `${CREATOR_QS.length}/${BUSINESS_QS.length}`);
// Canon hygiene: no em dashes in any bank answer; money is mechanics only.
{
  const ctx = { biz: false, live: false, profileComplete: false, missing: ["city", "audience"] };
  let bad = 0;
  for (const biz of [false, true]) for (const t of sigBankFor(biz)) {
    const a = typeof t.a === "function" ? t.a({ ...ctx, biz }) : t.a;
    if (a.includes("—")) { bad++; console.log("  FAIL - em dash in", t.id); }
  }
  check("no em dashes in any bank answer", bad === 0);
  const money = sigMatch("How do I make money", false).topic;
  const a = money.a(ctx);
  check("Jeff's exact question gets the two-lane money answer", a.includes("comped visits") && a.includes("paid bookings") && a.includes("97%"), a);
  const gib = sigMatch("asdf qwer zxcv", false);
  check("gibberish falls back (no topic)", gib.topic === null);
}

// ---------- 1b. The V4 asset model (Jeff, 2026-10-28) ----------
// Sig is a rendered character delivered as generated video:
// the Sig-tab hero is a video stack over the hero still, small
// placements are head-crop stills, think has no clip, greet and
// celebrate are one-shots on their existing triggers, reduced
// motion means stills everywhere, and a failed clip must leave
// its poster standing. These checks pin that model plus the
// production weight budgets from the port plan.
console.log("== V4 asset model ==");
const themeCss = fs.readFileSync(path.join(ROOT, "public/theme-v2.css"), "utf8");
const asset = (rel) => path.join(ROOT, "public/assets/sig-v4", rel);
const sizeOf = (rel) => (fs.existsSync(asset(rel)) ? fs.statSync(asset(rel)).size : -1);
check("the SVG character is retired from every surface", !appJs.includes("sigSvgHtml") && !appJs.includes("sig-musician") && !themeCss.includes("sig-ava-svg") && !fs.existsSync(path.join(ROOT, "public/assets/sig-musician.svg")));
check("small Sig is the head-crop still of the state (sigAvatarHtml -> sig-ava-img webp, no video)", appJs.includes("SIG_HEAD") && appJs.includes("head-greet") && appJs.includes("head-think") && appJs.includes("head-talk") && appJs.includes("head-celebrate") && appJs.includes("sig-ava-img") && !appJs.slice(appJs.indexOf("function sigAvatarHtml"), appJs.indexOf("const SIG_AVATAR_HTML")).includes("<video"));
check("the bottom tab icon is the idle head crop", appJs.includes('class="tab-sig-img" src="/assets/sig-v4/head-idle.webp"'));
const heroSlice = appJs.slice(appJs.indexOf("function sigHeroMediaHtml"), appJs.indexOf("const SIG_HERO_CLIPS"));
check("hero markup is a video stack over the hero poster, think still included", heroSlice.includes('data-sig-hero-video') && heroSlice.includes("muted") && heroSlice.includes("playsinline") && heroSlice.includes("autoplay") && heroSlice.includes('preload="none"') && heroSlice.includes('poster="${SIG_V4}/hero.webp"') && heroSlice.includes("still-think.webp"));
check("hero markup ships NO clip sources (only the visible state's clips attach, in sigHeroSet)", !heroSlice.includes("<source") && appJs.includes('video.innerHTML = `<source src="${SIG_V4}/${name}.webm" type="video/webm"><source src="${SIG_V4}/${name}.mp4" type="video/mp4">`'));
check("only idle and talk loop; greet and celebrate are one-shots", appJs.includes('video.loop = name === "idle" || name === "talk"') && appJs.includes('const SIG_HERO_CLIPS = { idle: 1, talk: 1, greet: 1, celebrate: 1 }'));
check("think has NO clip: the think state swaps the video out for the think still", appJs.includes('if (mode === "think")') && !appJs.slice(appJs.indexOf("const SIG_HERO_CLIPS"), appJs.indexOf("let sigHeroMode")).includes("think"));
check("one-shots return to idle on ended", appJs.includes('addEventListener("ended"') && appJs.includes('if (m === "greet" || m === "celebrate") sigHeroSet("idle")'));
check("reduced motion: stills everywhere, driven by the matchMedia gate", appJs.includes("function sigReducedMotion()") && appJs.includes('matchMedia("(prefers-reduced-motion: reduce)")') && themeCss.includes("prefers-reduced-motion: reduce"));
check("a failed clip hides itself and leaves its poster (error listener)", appJs.includes('addEventListener("error"') && appJs.includes('hasAttribute("data-sig-hero-video")'));
check("the queue card still records its one-shot moods for the hero (triggers unchanged)", appJs.includes('sigQueueBeat = "celebrate"') && appJs.includes('sigQueueBeat = "greet"') && appJs.includes("state.sigCelebrate = false"));
check("the claim win hook renders the celebrate clip component and kicks it once", appJs.includes("function sigCelebMediaHtml()") && appJs.includes("setTimeout(sigCelebKick, 30)"));
check("hero + celeb media CSS ships (stack, ring, hidden guards beat the layer display rules)", themeCss.includes(".sig-hero-media") && themeCss.includes(".sig-celeb-media") && themeCss.includes("video[hidden]") && themeCss.includes("img[hidden]"));
for (const f of ["hero.webp", "still-greet.webp", "still-think.webp", "still-talk.webp", "still-celebrate.webp", "head-idle.webp", "head-greet.webp", "head-think.webp", "head-talk.webp", "head-celebrate.webp"]) {
  check(`still ships: ${f}`, sizeOf(f) > 0 && sizeOf(f) <= 120000, `${sizeOf(f)} bytes`);
}
for (const [f, cap] of [["idle.webm", 800000], ["idle.mp4", 800000], ["talk.webm", 400000], ["talk.mp4", 400000], ["greet.webm", 400000], ["greet.mp4", 400000], ["celebrate.webm", 400000], ["celebrate.mp4", 400000]]) {
  check(`clip inside its weight budget: ${f} <= ${cap}`, sizeOf(f) > 0 && sizeOf(f) <= cap, `${sizeOf(f)} bytes`);
}

// ---------- 2. The AI path, against a local stub provider ----------
let stubMode = "ok";
let lastRequest = null;
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    lastRequest = JSON.parse(body || "{}");
    if (stubMode !== "ok") { res.writeHead(500, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "down" })); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Two ways: comped visits, and paid bookings at your listed rate, where you keep 97%." } }] }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));

function client() {
  const jar = new Map();
  return async (method, p, body) => {
    const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  };
}
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/api/bootstrap"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
}
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: ROOT,
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL: "jeff@joinsignl.com", ADMIN_PASSWORD: "verify-admin-pass-123", APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1", SIG_AI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`, SIG_AI_API_KEY: "stub-key", SIG_AI_MODEL: "stub-model" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
try {
  check("server boots", await waitUp());
  const anon = client();
  const denied = await anon("POST", "/api/sig/ask", { q: "How do I make money" });
  check("signed-out ask is refused (401)", denied.status === 401, String(denied.status));

  const creator = client();
  const rc = await creator("POST", "/api/auth/register", { role: "creator", name: "Sig Creator", email: "sig@fixtures.dev", password: "creator-pass-123", market: "Richmond", city: "Richmond", handle: "sigeats", tierBand: "Neighbors", followerCount: 900, localAudiencePct: 80, categories: ["Food & Drink"], agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true });
  check("creator registered", rc.status === 201 || rc.status === 200, JSON.stringify(rc.data).slice(0, 200));
  const ans = await creator("POST", "/api/sig/ask", { q: "How do I make money" });
  check("AI answers (source ai)", ans.status === 200 && ans.data.source === "ai", JSON.stringify(ans.data).slice(0, 200));
  check("AI text passes through", typeof ans.data.text === "string" && ans.data.text.includes("97%"));
  const sys = lastRequest && lastRequest.messages && lastRequest.messages[0] ? lastRequest.messages[0].content : "";
  check("system prompt carries locked canon", sys.includes("$199") && sys.includes("$349") && sys.includes("$699") && sys.includes("97%") && sys.includes("local reach"), sys.slice(0, 120));
  check("system prompt carries guardrails", sys.includes("Never invent") && sys.includes("Never name") || sys.includes("Never name or discuss"), sys.slice(0, 120));
  check("system prompt carries the asker's state", sys.includes("Richmond"), sys.slice(-200));
  check("the question reached the model", JSON.stringify(lastRequest.messages).includes("How do I make money"));
  check("model is the configured one", lastRequest.model === "stub-model");

  stubMode = "fail";
  const degraded = await creator("POST", "/api/sig/ask", { q: "How do I make money" });
  check("dead provider degrades to unavailable, HTTP 200", degraded.status === 200 && degraded.data.source === "unavailable", JSON.stringify(degraded.data).slice(0, 200));
  stubMode = "ok";

  const business = client();
  const rb = await business("POST", "/api/auth/register", { role: "business", name: "Sig Owner", businessName: "Sig Cafe", email: "sigbiz@fixtures.dev", password: "business-pass-123", market: "Richmond", city: "Richmond", category: "Coffee & Bakery", planId: "self-service", agreedTerms: true });
  check("business registered", rb.status === 201 || rb.status === 200, JSON.stringify(rb.data).slice(0, 200));
  const bans = await business("POST", "/api/sig/ask", { q: "What does it cost?" });
  check("business gets an AI answer too", bans.status === 200 && bans.data.source === "ai", JSON.stringify(bans.data).slice(0, 200));
  check("business state rides along", (lastRequest.messages[0].content || "").includes("business"), "");
} finally {
  server.kill("SIGTERM");
  stub.close();
}
console.log(failures === 0 ? "verify-sig: ALL PASS" : `verify-sig: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
