// Spanish layers verification (spec: files/signl-spanish-layers-
// spec-2026-10-28.md). Sections per layer: S2 (Spanish reach %),
// then S1/S3/S4 as they ship. Run: node scripts/verify-spanish.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8943;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = ["verify", "admin", "pass", "123"].join("-");
const DB = path.join(os.tmpdir(), `signl-verify-spanish-${Date.now()}.json`);
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
    return { status: res.status, data };
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

async function stopServer() {
  try { server.kill("SIGTERM"); } catch (e) { /* already stopped */ }
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const creator = client();
  const reg = await creator("POST", "/api/auth/register", {
    role: "creator", name: "Spanish Creator", email: "spanish@fixtures.dev", password: "spanish-pass-1234",
    market: "Hampton Roads", city: "Virginia Beach", handle: "spanishcreator",
    followerCount: 5200, localAudiencePct: 61, categories: ["Food & Drink"], ...AGREE,
  });
  check("creator fixture registers profile-complete", reg.status === 201 && reg.data.user.profileCompletion.complete === true, JSON.stringify(reg.data.user && reg.data.user.profileCompletion));
  const creatorId = reg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: creatorId, decision: "approve" });

  const business = client();
  const bizReg = await business("POST", "/api/auth/register", {
    role: "business", name: "Spanish Biz Owner", businessName: "La Mesa", email: "spanishbiz@fixtures.dev",
    password: "spanish-pass-1234", market: "Hampton Roads", city: "Norfolk", category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  await admin("POST", "/api/admin/review", { userId: bizReg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: bizReg.data.user.id });

  // ---------- S2: Spanish reach as a number ----------
  const s2Set = await creator("PATCH", "/api/me/profile", { spanishAudiencePct: 40 });
  check("S2: setting 40 stores 40 on the creator record", s2Set.status === 200 && s2Set.data.user.creator.spanishAudiencePct === 40, JSON.stringify(s2Set.data.user && s2Set.data.user.creator));
  const s2Card = await business("GET", "/api/discover?market=Hampton%20Roads");
  const card = (s2Card.data.creators || []).find((c) => c.userId === creatorId);
  check("S2: the Discover card profile carries the number", !!card && card.profile.spanishAudiencePct === 40, JSON.stringify(card && card.profile.spanishAudiencePct));
  const s2Pub = await client()("GET", "/api/c/spanishcreator");
  check("S2: the public profile payload carries the number beside local %", s2Pub.status === 200 && s2Pub.data.profile.spanishAudiencePct === 40 && s2Pub.data.profile.localAudiencePct === 61, JSON.stringify(s2Pub.data.profile));
  const s2Clamp = await creator("PATCH", "/api/me/profile", { spanishAudiencePct: 140 });
  check("S2: 140 clamps to 100", s2Clamp.status === 200 && s2Clamp.data.user.creator.spanishAudiencePct === 100, JSON.stringify(s2Clamp.data.user.creator.spanishAudiencePct));
  const s2Junk = await creator("PATCH", "/api/me/profile", { spanishAudiencePct: "abc" });
  check("S2: non-numeric input resolves to null without an error", s2Junk.status === 200 && s2Junk.data.user.creator.spanishAudiencePct === null, JSON.stringify(s2Junk.status));
  const s2Set2 = await creator("PATCH", "/api/me/profile", { spanishAudiencePct: 40 });
  const s2Omit = await creator("PATCH", "/api/me/profile", { bio: "Creadora de contenido en Virginia Beach, en inglés y español, desde 2021." });
  check("S2: a save that omits the field leaves the stored value untouched", s2Set2.status === 200 && s2Omit.status === 200 && s2Omit.data.user.creator.spanishAudiencePct === 40, JSON.stringify(s2Omit.data.user.creator.spanishAudiencePct));
  const s2Clear = await creator("PATCH", "/api/me/profile", { spanishAudiencePct: null });
  const s2Pub2 = await client()("GET", "/api/c/spanishcreator");
  check("S2: clearing returns the field to null on the record and the public payload", s2Clear.status === 200 && s2Clear.data.user.creator.spanishAudiencePct === null && s2Pub2.data.profile.spanishAudiencePct === null, "");
  const s2Me = await creator("GET", "/api/auth/me");
  check("S2: profile completion is untouched by the field (complete before, during, after)", s2Me.data.user.profileCompletion.complete === true, JSON.stringify(s2Me.data.user.profileCompletion));

  // ---------- S3: business language preference ----------
  const bizId = bizReg.data.user.id;
  const s3Es = await business("PATCH", "/api/me/profile", { preferredLanguage: "es" });
  check("S3: business PATCH stores preferredLanguage es", s3Es.status === 200 && s3Es.data.user.business.preferredLanguage === "es", JSON.stringify(s3Es.data.user && s3Es.data.user.business));
  const s3Apps = await admin("GET", "/api/admin/applications");
  const s3Row = [...(s3Apps.data.pending || []), ...(s3Apps.data.decided || [])].find((u) => u.id === bizId);
  check("S3: Admin applications carry the business language flag", !!s3Row && s3Row.preferredLanguage === "es", JSON.stringify(s3Row && s3Row.preferredLanguage));
  const s3Fr = await business("PATCH", "/api/me/profile", { preferredLanguage: "fr" });
  check("S3: an unsupported language is ignored, never an error, stored value kept", s3Fr.status === 200 && s3Fr.data.user.business.preferredLanguage === "es", JSON.stringify(s3Fr.status));
  const s3En = await business("PATCH", "/api/me/profile", { preferredLanguage: "en" });
  check("S3: switching back to English stores en", s3En.status === 200 && s3En.data.user.business.preferredLanguage === "en", "");

  const fa = client();
  const s3App = await fa("POST", "/api/founding-application", { business_name: "Taqueria Sol", contact_name: "Maria Sol", email: "maria@taqueriasol.example", city: "San Juan, PR", lang: "es" });
  check("S3: a founding application carrying lang=es is accepted", s3App.status === 200 && s3App.data.ok === true && !!s3App.data.id, JSON.stringify(s3App.data));
  const s3Events = await admin("GET", "/api/admin/events?limit=500&type=founding_application_received");
  const s3Event = (s3Events.data.events || []).find((e) => e.data && e.data.bizappId === s3App.data.id);
  check("S3: the application event records lang es", !!s3Event && s3Event.data.lang === "es", JSON.stringify(s3Event && s3Event.data));
  const s3AppNoLang = await fa("POST", "/api/founding-application", { business_name: "Plain Diner", contact_name: "Pat", email: "pat@plaindiner.example", city: "Norfolk, VA" });
  const s3Events2 = await admin("GET", "/api/admin/events?limit=500&type=founding_application_received");
  const s3Event2 = (s3Events2.data.events || []).find((e) => e.data && e.data.bizappId === s3AppNoLang.data.id);
  check("S3: an application without lang records no language", s3AppNoLang.status === 200 && !!s3Event2 && (s3Event2.data.lang === null || s3Event2.data.lang === undefined), JSON.stringify(s3Event2 && s3Event2.data));
  const s3Bad = await fa("POST", "/api/founding-application", { lang: "es" });
  check("S3: the malformed-payload 400 contract is unchanged by the lang field", s3Bad.status === 400, JSON.stringify(s3Bad.status));

  const routerSrcS3 = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "netlify", "functions", "lib", "router.js"), "utf8");
  check("S3: Sig carries the business Spanish state line", routerSrcS3.includes("This business owner prefers Spanish. Answer in Spanish."), "");

  const appJsRes = await fetch(BASE + "/app.js");
  const appJs = await appJsRes.text();
  check("S2: client ships the panel field, the save handler, and the display phrase", appJs.includes("lane-spanish-pct") && appJs.includes("laneSpanishPctSave") && appJs.includes("Spanish-speaking audience"), "");
  check("S3: client ships the business language control and Admin marker", appJs.includes("bp-lang") && appJs.includes("preferredLanguage") && appJs.includes("Prefers Spanish"), "");
} catch (e) {
  failed += 1;
  failures.push("suite error: " + e.message);
  console.log("  FAIL  suite error :: " + e.message);
} finally {
  await stopServer();
}

console.log(`\nSpanish layers verification: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("Failures: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
