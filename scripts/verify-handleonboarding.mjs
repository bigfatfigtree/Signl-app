// SIGNL verify: Instagram handle onboarding, Phase 2 wiring
// (Jeff, 2026-10-28; spec signl-handle-onboarding-spec-2026-10-28).
//
// Covers what Phase 2 added on top of the Phase 1 service
// (verify-igprefill.mjs covers the service itself):
//   - POST /api/ig-prefill suggest mode: the deterministic
//     one-play rule served from the endpoint (opening beats
//     everything, Attraction is an event night, food plus
//     weekend-heavy is Weekend Fill, food alone and everything
//     else is Build Regulars);
//   - draft mode input discipline: an unparseable handle is a
//     200 with draft null and reason invalid_handle (the client
//     degrades to the question ladder, never an error wall);
//   - the endpoint NEVER writes: after a batch of draft and
//     suggest calls from a signed-in business session, the DB
//     gains no records of any kind (start-blank / unconfirmed
//     exit write nothing by construction; the only writes in
//     the whole feature are the confirmed PATCHes below);
//   - the confirmed save paths the flows use: a business PATCH
//     carrying exactly sigBSetupCommit's payload shape (name,
//     category, city, about, asset packet with the pulled photo
//     as logo and the handle) lands whole; a creator PATCH
//     carrying sigCSetupCommit's payload (name + followerCount)
//     lands in the audience stack, and the never-prefill fields
//     (local %, Spanish %) stay untouched by it;
//   - client wiring, source level (the browser QA drives the
//     real flows): both Sig intents route to the setup flows,
//     the step dispatcher knows bsetup/csetup, the suggestion
//     routes into sigB1Start with the play seeded, and B1
//     honors a seeded play instead of re-asking;
//   - rate limiting: on a fresh server, the 21st lookup from
//     one IP inside the window is a 429.
// Live draft fetches against the real Instagram route stay
// opt-in (SIGNL_IG_LIVE=1), exactly like Phase 1.
//
// Uses scripts/dev-server.mjs with a throwaway local DB file
// and SIGNL_TEST_ALLOW_BUSINESS=1, like the other suites.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8963;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "admin-password-123";
const LIVE = process.env.SIGNL_IG_LIVE === "1";

let passed = 0;
const failures = [];
function check(label, cond, detail = "") {
  if (cond) { passed++; console.log(`PASS  ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label} ${detail}`); }
}
const uniq = () => Math.random().toString(36).slice(2, 9);

function makeClient() {
  const jar = new Map();
  const api = async function (method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const part of setCookie.split(/,(?=[^;]+=)/)) {
      const m = part.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data, text };
  };
  return api;
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up");
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-handle-"));
const dbFile = path.join(tmp, "db.json");
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  server = null;
}
const dbKeys = () => Object.keys(JSON.parse(fs.readFileSync(dbFile, "utf8")));

try {
  // ---------- client wiring (source level) ----------
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("client: business intent routes 'set me up' to the business handle setup",
    appJs.includes('has("set me up", "set up my business"') && appJs.includes('sigSetupStart("business")'), "");
  check("client: creator intent routes 'set me up' to the creator handle setup",
    appJs.includes('sigSetupStart("creator")') && appJs.includes('"set up from instagram", "use my instagram"'), "");
  check("client: the step dispatcher knows bsetup and csetup",
    appJs.includes('if (f.id === "bsetup" || f.id === "csetup") return sigSetupStep(f, text, norm);'), "");
  check("client: the suggestion routes into a live B1 draft with the play seeded",
    appJs.includes("sigB1Start({ play: play.id, briefGoal: play.goal, spots: play.spots"), "");
  check("client: B1 honors a seeded play instead of asking the play question twice",
    appJs.includes("if (d.play && sigPlay(d.play)) { sigB1AskTitle(); return; }"), "");
  check("client: both sides save only through PATCH /me/profile at confirm time",
    appJs.includes('api("PATCH", "/me/profile", { businessName: v.businessName, category: f.data.category, city: f.data.city') &&
    appJs.includes('api("PATCH", "/me/profile", patch)'), "");
  check("client: the ownership line rides the summaries in both languages",
    appJs.includes("Pulled from your public profile. It does not prove the account is yours.") &&
    appJs.includes("Tomado de tu perfil público. No prueba que la cuenta sea tuya."), "");
  check("client: all four form surfaces mount the assist card",
    ["igAssistCardHtml(\"qc\", \"creator\", { handleFrom: true })", "igAssistCardHtml(\"jc\", \"creator\")", "igAssistCardHtml(\"jb\", \"business\")", "igAssistCardHtml(\"bp\", \"business\")"].every((s) => appJs.includes(s)), "");
  check("client: creator commit never sends a never-prefill field",
    !/sigCSetupCommit[\s\S]{0,900}localAudiencePct/.test(appJs) && !/sigCSetupCommit[\s\S]{0,900}spanishAudiencePct/.test(appJs), "");

  // ---------- HTTP: endpoint behavior ----------
  startServer();
  await waitUp();
  const anon = makeClient();

  const sug = async (signals) => (await anon("POST", "/api/ig-prefill", { suggest: signals })).data.suggestion;
  check("suggest: an opening beats every other signal",
    (await sug({ category: "Restaurant", opening: true, weekendHeavy: true })).play === "grand_opening", "");
  check("suggest: an Attraction is an event night",
    (await sug({ category: "Attraction" })).play === "event_night", "");
  check("suggest: food plus weekend-heavy is Weekend Fill",
    (await sug({ category: "Coffee & Bakery", weekendHeavy: true })).play === "weekend_fill", "");
  check("suggest: food without the weekend signal is Build Regulars",
    (await sug({ category: "Restaurant" })).play === "build_regulars", "");
  check("suggest: an unlisted kind of business is Build Regulars",
    (await sug({ category: "Retail" })).play === "build_regulars", "");
  const barSug = await sug({ category: "Bar", liveMusic: true });
  check("suggest: live music is an event night, and every answer carries its label and reason",
    barSug.play === "event_night" && barSug.playLabel === "Event Night" && typeof barSug.reason === "string" && barSug.reason.length > 0,
    JSON.stringify(barSug));

  const bad = await anon("POST", "/api/ig-prefill", { handle: "not a handle!!", side: "creator" });
  check("draft mode: an unparseable handle is a calm 200 with draft null and reason invalid_handle",
    bad.status === 200 && bad.data.draft === null && bad.data.reason === "invalid_handle", JSON.stringify(bad.data));
  const empty = await anon("POST", "/api/ig-prefill", { side: "business" });
  check("draft mode: a missing handle resolves the same way",
    empty.status === 200 && empty.data.draft === null && empty.data.reason === "invalid_handle", JSON.stringify(empty.data));

  // ---------- HTTP: the endpoint never writes ----------
  const bizClient = makeClient();
  const bizEmail = `biz-${uniq()}@fixtures.dev`;
  const reg = await bizClient("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", email: bizEmail, password: "password123",
    market: "Hampton Roads", city: "Norfolk", businessName: "Handle Kitchen", category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business register failed: ${reg.status} ${JSON.stringify(reg.data)}`);
  const keysBefore = dbKeys().sort();
  for (let i = 0; i < 4; i++) {
    await bizClient("POST", "/api/ig-prefill", { suggest: { category: "Restaurant", weekendHeavy: i % 2 === 0 } });
    await bizClient("POST", "/api/ig-prefill", { handle: "bad handle " + i, side: "business" });
  }
  const keysAfter = dbKeys().sort();
  check("unconfirmed lookups write zero records: the DB key set is byte-identical after draft and suggest calls",
    JSON.stringify(keysBefore) === JSON.stringify(keysAfter),
    `before ${keysBefore.length} keys, after ${keysAfter.length}`);

  // ---------- HTTP: the confirmed save paths ----------
  const ogLogo = "https://scontent.cdninstagram.com/v/t51.2885-19/handle-kitchen.jpg";
  const saved = await bizClient("PATCH", "/api/me/profile", {
    businessName: "Handle Kitchen", category: "Restaurant", city: "Virginia Beach", about: "Wood-fired everything, dogs welcome.",
    assetPacket: { logoUrl: ogLogo, links: [], talkingPoints: "Wood-fired everything, dogs welcome.", handle: "handlekitchen", hashtags: [] },
  });
  check("business confirm save: the setup PATCH lands whole",
    saved.status === 200 && saved.data.user.business.businessName === "Handle Kitchen" &&
    saved.data.user.business.city === undefined && saved.data.user.city === "Virginia Beach" &&
    saved.data.user.business.about === "Wood-fired everything, dogs welcome." &&
    saved.data.user.business.assetPacket.handle === "handlekitchen" &&
    saved.data.user.business.assetPacket.logoUrl === ogLogo,
    JSON.stringify(saved.data).slice(0, 300));

  const crClient = makeClient();
  const crHandle = `handle${uniq()}`;
  // A quick claim is the creator this flow serves: an account
  // that starts with a handle and nothing else filled.
  const crReg = await crClient("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: `${crHandle}@fixtures.dev`, password: "password123",
    market: "Virginia Beach", handle: crHandle, primaryPlatform: "instagram",
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (crReg.status !== 201) throw new Error(`creator register failed: ${crReg.status} ${JSON.stringify(crReg.data)}`);
  const crSaved = await crClient("PATCH", "/api/me/profile", { name: "Signl", followerCount: 993 });
  const cc = crSaved.data.user && crSaved.data.user.creator;
  check("creator confirm save: name and the Instagram count land in the audience stack",
    crSaved.status === 200 && crSaved.data.user.name === "Signl" && cc && cc.followerCount === 993 && (cc.audienceStack || {}).instagram === 993,
    JSON.stringify(crSaved.data).slice(0, 300));
  check("creator confirm save: the never-prefill fields stay exactly as they were (unset)",
    cc && (cc.localAudiencePct === null || cc.localAudiencePct === undefined) && (cc.spanishAudiencePct === null || cc.spanishAudiencePct === undefined),
    JSON.stringify(cc && { local: cc.localAudiencePct, spanish: cc.spanishAudiencePct }));

  // ---------- rate limit (fresh process: the counter is in-memory) ----------
  await stopServer();
  startServer();
  await waitUp();
  const rl = makeClient();
  let firstOk = 0;
  let got429At = -1;
  for (let i = 1; i <= 22; i++) {
    const r = await rl("POST", "/api/ig-prefill", { suggest: { category: "Other" } });
    if (r.status === 200 && i <= 20) firstOk++;
    if (r.status === 429 && got429At === -1) got429At = i;
  }
  check("rate limit: 20 lookups pass, the 21st from the same IP is a 429",
    firstOk === 20 && got429At === 21, `firstOk=${firstOk} got429At=${got429At}`);

  // ---------- live draft fetch (opt-in, like Phase 1) ----------
  if (LIVE) {
    // Fresh process: the rate-limit block above deliberately
    // exhausted this IP's window on the previous instance.
    await stopServer();
    startServer();
    await waitUp();
    const live = await anon("POST", "/api/ig-prefill", { handle: "joinsignl", side: "creator" });
    const d = live.data && live.data.draft;
    check("LIVE: the endpoint returns the real @joinsignl creator draft",
      live.status === 200 && !!d && d.fields.displayName.value === "Signl" && typeof d.fields.followerCount.value === "number",
      JSON.stringify(live.data).slice(0, 200));
    check("LIVE: the endpoint's creator draft carries no never-prefill field",
      !!d && !("localAudiencePct" in d.fields) && !("spanishAudiencePct" in d.fields) && !("paidRate" in d.fields) && !("licensingFee" in d.fields), "");
    const liveBiz = await anon("POST", "/api/ig-prefill", { handle: "jsheaphoto22", side: "business" });
    check("LIVE: the endpoint returns the real business draft for @jsheaphoto22",
      liveBiz.status === 200 && !!liveBiz.data.draft && /Jessica Shea/.test(liveBiz.data.draft.fields.businessName.value || ""),
      JSON.stringify(liveBiz.data).slice(0, 200));
  } else {
    console.log("SKIP  live endpoint checks (set SIGNL_IG_LIVE=1 to run them)");
  }
} finally {
  await stopServer();
}

console.log(`\nhandleonboarding: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
