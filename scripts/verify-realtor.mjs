// Realtor layer verification: the optional profession flag, the
// realtor-only neighborhood tags (stored as farmAreas) and
// brokerage attribution on the public profile, the listing proof
// sheet's honesty gates, admin visibility, and the guarantee that
// a non-realtor profile is untouched. Run: node scripts/verify-realtor.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { cleanProfession, cleanFarmAreas, creatorIsRealtor } = require("../netlify/functions/lib/router.js");
const { PROFESSIONS, REALTOR_PROFESSION } = require("../netlify/functions/lib/markets.js");

const PORT = 8961;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";
const DB = path.join(os.tmpdir(), `signl-verify-realtor-${Date.now()}.json`);
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

function fullCreatorBody(overrides) {
  return {
    role: "creator",
    name: "Realtor Creator",
    email: "realtor@fixtures.dev",
    password: "<MASKED_SECRET_002>",
    market: "Hampton Roads",
    city: "Virginia Beach",
    handle: "realtorcreator",
    followerCount: 4200,
    localAudiencePct: 64,
    categories: ["Food & Drink"],
    ...AGREE,
    ...overrides,
  };
}

try {
  // ---------- unit: taxonomy + sanitizers ----------
  check("unit: the profession list is the everyday-language set with Real estate agent in it", PROFESSIONS.length === 8 && REALTOR_PROFESSION === "Real estate agent" && PROFESSIONS.includes("Real estate agent") && PROFESSIONS.includes("Food & drink") && PROFESSIONS.includes("Photographer / videographer"), JSON.stringify(PROFESSIONS));
  check("unit: cleanProfession keeps listed values, blanks junk and missing", cleanProfession("Real estate agent") === "Real estate agent" && cleanProfession(" Student ") === "Student" && cleanProfession("Wizard") === "" && cleanProfession(undefined) === "" && cleanProfession(42) === "");
  check("unit: creatorIsRealtor keys off the profession value only", creatorIsRealtor({ profession: "Real estate agent" }) === true && creatorIsRealtor({ profession: "Student" }) === false && creatorIsRealtor({}) === false && creatorIsRealtor(null) === false);
  check("unit: farm tags sanitize: trim, collapse, dedupe case-insensitive, cap 3, cap 60 chars", JSON.stringify(cleanFarmAreas(["  Ghent ", "ghent", "Ocean   Lakes", "Town Center", "Fourth"])) === JSON.stringify(["Ghent", "Ocean Lakes", "Town Center"]) && cleanFarmAreas(["x".repeat(90)])[0].length === 60, JSON.stringify(cleanFarmAreas(["  Ghent ", "ghent", "Ocean   Lakes", "Town Center", "Fourth"])));
  check("unit: farm tags accept a comma string and blank input", JSON.stringify(cleanFarmAreas("Ghent, Ocean Lakes")) === JSON.stringify(["Ghent", "Ocean Lakes"]) && JSON.stringify(cleanFarmAreas(undefined)) === "[]" && JSON.stringify(cleanFarmAreas(["", "  "])) === "[]");

  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const boot = await client()("GET", "/api/bootstrap");
  check("bootstrap ships the profession list for the signup and edit selects", Array.isArray(boot.data.professions) && boot.data.professions.length === 8 && boot.data.professions.includes("Real estate agent"), JSON.stringify(boot.data.professions));

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  // ---------- realtor: profession at signup, layer via profile edit ----------
  const realtor = client();
  const rReg = await realtor("POST", "/api/auth/register", fullCreatorBody({
    name: "Rae Realtor",
    email: "rae@fixtures.dev",
    handle: "raerealtor",
    profession: "Real estate agent",
  }));
  check("full signup stores the realtor profession on the creator record", rReg.status === 201 && rReg.data.user.creator.profession === "Real estate agent", JSON.stringify(rReg.data.user && rReg.data.user.creator));
  check("profession does not gate profile completeness", rReg.status === 201 && rReg.data.user.creator.profileComplete === true && rReg.data.user.profileCompletion.complete === true, JSON.stringify(rReg.data.user && rReg.data.user.profileCompletion));
  check("realtor layer starts empty at signup (neighborhoods and brokerage are profile-edit fields)", rReg.status === 201 && JSON.stringify(rReg.data.user.creator.farmAreas) === "[]" && rReg.data.user.creator.brokerage === "", JSON.stringify(rReg.data.user.creator));
  const realtorId = rReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: realtorId, decision: "approve" });

  const pubBefore = await client()("GET", "/api/c/raerealtor");
  check("public payload flags the realtor with empty layer values before the edit", pubBefore.status === 200 && pubBefore.data.profile.profession === "Real estate agent" && pubBefore.data.profile.isRealtor === true && JSON.stringify(pubBefore.data.profile.farmAreas) === "[]" && pubBefore.data.profile.brokerage === "", JSON.stringify(pubBefore.data.profile));

  const layerSave = await realtor("PATCH", "/api/me/profile", {
    farmAreas: ["  Ghent ", "ghent", "Ocean   Lakes", "Town Center", "Fourth One"],
    brokerage: "  Harbor   Lights Realty  ",
  });
  check("profile edit saves sanitized neighborhoods (dedupe, collapse, cap 3) and brokerage (collapse, trim)", layerSave.status === 200 && JSON.stringify(layerSave.data.user.creator.farmAreas) === JSON.stringify(["Ghent", "Ocean Lakes", "Town Center"]) && layerSave.data.user.creator.brokerage === "Harbor Lights Realty", JSON.stringify(layerSave.data.user.creator));

  const pub = await client()("GET", "/api/c/raerealtor");
  check("public /c/ payload carries the neighborhoods and brokerage for a realtor", pub.status === 200 && pub.data.profile.isRealtor === true && JSON.stringify(pub.data.profile.farmAreas) === JSON.stringify(["Ghent", "Ocean Lakes", "Town Center"]) && pub.data.profile.brokerage === "Harbor Lights Realty", JSON.stringify(pub.data.profile));
  check("proof-sheet source numbers are the real stored ones (stacked audience, local pct with source)", pub.status === 200 && pub.data.profile.totalAudience === 4200 && pub.data.profile.localAudiencePct === 64 && pub.data.profile.localAudienceSource === "Self-reported", JSON.stringify(pub.data.profile));
  check("proof-sheet gated metrics are null/zero in the payload, never invented (rating below 3, no posts yet)", pub.status === 200 && pub.data.profile.ratingAvg === null && pub.data.profile.ratingCount === 0 && pub.data.profile.trackRecord.postsDelivered === 0 && pub.data.profile.trackRecord.visitsCompleted === 0, JSON.stringify(pub.data.profile));

  const apps = await admin("GET", "/api/admin/applications");
  const adminRow = [...(apps.data.pending || []), ...(apps.data.decided || [])].find((u) => u.id === realtorId);
  check("admin applications carry the profession so realtor claims are visible", !!adminRow && adminRow.creator.profession === "Real estate agent", JSON.stringify(adminRow && adminRow.creator));

  const events = await admin("GET", "/api/admin/events?limit=500&type=application_submitted");
  const rEvent = (events.data.events || []).find((e) => e.subjectId === realtorId);
  check("application_submitted event records the profession", !!rEvent && rEvent.data.profession === "Real estate agent", JSON.stringify(rEvent && rEvent.data));

  // switching profession away retires the public layer, keeps the typed values on the record
  const away = await realtor("PATCH", "/api/me/profile", { profession: "Other" });
  check("profile edit can change the profession", away.status === 200 && away.data.user.creator.profession === "Other", JSON.stringify(away.data.user.creator));
  const pubAway = await client()("GET", "/api/c/raerealtor");
  check("public layer retires when the profession leaves real estate (record keeps the values)", pubAway.status === 200 && pubAway.data.profile.isRealtor === false && JSON.stringify(pubAway.data.profile.farmAreas) === "[]" && pubAway.data.profile.brokerage === "" && JSON.stringify(away.data.user.creator.farmAreas) === JSON.stringify(["Ghent", "Ocean Lakes", "Town Center"]) && away.data.user.creator.brokerage === "Harbor Lights Realty", JSON.stringify(pubAway.data.profile));
  const back = await realtor("PATCH", "/api/me/profile", { profession: "Real estate agent" });
  const pubBack = await client()("GET", "/api/c/raerealtor");
  check("switching back to real estate restores the layer from the kept values", back.status === 200 && pubBack.status === 200 && pubBack.data.profile.isRealtor === true && pubBack.data.profile.brokerage === "Harbor Lights Realty", JSON.stringify(pubBack.data.profile));

  // ---------- non-realtor: unchanged ----------
  const plain = client();
  const pReg = await plain("POST", "/api/auth/register", fullCreatorBody({
    name: "Plain Foodie",
    email: "plain@fixtures.dev",
    handle: "plainfoodie",
  }));
  check("signup without a profession stores it blank and still completes", pReg.status === 201 && pReg.data.user.creator.profession === "" && pReg.data.user.creator.profileComplete === true, JSON.stringify(pReg.data.user && pReg.data.user.creator));
  const plainId = pReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: plainId, decision: "approve" });
  const plainSave = await plain("PATCH", "/api/me/profile", { farmAreas: ["Ghent"], brokerage: "Should Not Surface LLC" });
  check("a non-realtor can store layer values without error", plainSave.status === 200, JSON.stringify(plainSave.data));
  const plainPub = await client()("GET", "/api/c/plainfoodie");
  check("non-realtor public payload: not flagged, layer values never surface", plainPub.status === 200 && plainPub.data.profile.profession === "" && plainPub.data.profile.isRealtor === false && JSON.stringify(plainPub.data.profile.farmAreas) === "[]" && plainPub.data.profile.brokerage === "", JSON.stringify(plainPub.data.profile));

  const junk = client();
  const jReg = await junk("POST", "/api/auth/register", fullCreatorBody({
    name: "Junk Profession",
    email: "junk@fixtures.dev",
    handle: "junkprofession",
    profession: "Wizard",
  }));
  check("an unlisted profession at signup is stored blank, signup unaffected", jReg.status === 201 && jReg.data.user.creator.profession === "", JSON.stringify(jReg.data.user && jReg.data.user.creator));

  // ---------- quick claim defaults ----------
  const claimer = client();
  const claim = await claimer("POST", "/api/auth/register", {
    role: "creator",
    quickClaim: true,
    email: "realtorclaim@fixtures.dev",
    password: "<MASKED_SECRET_002>",
    market: "Hampton Roads",
    handle: "realtorclaim",
    ...AGREE,
  });
  check("quick claim stores the realtor layer blank", claim.status === 201 && claim.data.user.creator.profession === "" && JSON.stringify(claim.data.user.creator.farmAreas) === "[]" && claim.data.user.creator.brokerage === "", JSON.stringify(claim.data.user && claim.data.user.creator));
  const claimSave = await claimer("PATCH", "/api/me/profile", {
    name: "Claim Realtor",
    city: "Virginia Beach",
    audienceStack: { instagram: 2600 },
    categories: ["Food & Drink"],
    localAudiencePct: 58,
    profession: "Real estate agent",
    farmAreas: "Ghent, Ocean Lakes",
    brokerage: "Claim Realty Group",
  });
  check("profile completion can set the profession, neighborhoods (comma string), and brokerage in one save", claimSave.status === 200 && claimSave.data.user.creator.profession === "Real estate agent" && JSON.stringify(claimSave.data.user.creator.farmAreas) === JSON.stringify(["Ghent", "Ocean Lakes"]) && claimSave.data.user.creator.brokerage === "Claim Realty Group", JSON.stringify(claimSave.data.user && claimSave.data.user.creator));

  // ---------- client strings ----------
  const appJsRes = await fetch(BASE + "/app.js");
  const appJs = await appJsRes.text();
  check("client ships the profession selects on signup and profile edit", appJs.includes("jc-profession") && appJs.includes("p-profession") && appJs.includes("professionOptionsHtml"), "");
  check("client ships the realtor edit block with the neighborhoods label", appJs.includes("p-realtor-block") && appJs.includes("Your neighborhoods (up to 3)") && appJs.includes("p-brokerage") && appJs.includes("syncRealtorFields"), "");
  check("public profile renders the Realtor chip, the Neighborhoods row, and the Brokered by line, all realtor-gated", appJs.includes("Realtor</span>") && appJs.includes("Neighborhoods:") && appJs.includes("Brokered by") && appJs.includes("p.isRealtor && p.farmAreas") && appJs.includes("p.isRealtor && p.brokerage"), "");
  check("client ships the listing proof sheet: owner action, proof route, verified footer", appJs.includes("Listing proof sheet") && appJs.includes("renderPublicProof") && appJs.includes("public-proof") && appJs.includes("Activity verified by SIGNL") && appJs.includes("/proof"), "");
  check("proof renderer gates the rating and activity counts instead of printing them unconditionally", appJs.includes("p.ratingCount >= 3") && appJs.includes("tr.postsDelivered > 0") && appJs.includes("tr.visitsCompleted > 0"), "");
  check("client ships the profession in admin application details", appJs.includes("Profession:") && appJs.includes("u.creator.profession"), "");
  check("no user-facing string says farm: the old label is gone from the client", !appJs.includes("Farm neighborhoods") && !appJs.includes("your farm") && !appJs.includes("as your farm"), "");
  const proofBody = appJs.slice(appJs.indexOf("async function renderPublicProof"), appJs.indexOf("function inviteUrlFor"));
  check("no em dashes anywhere in the proof sheet renderer", proofBody.length > 500 && !proofBody.includes("\u2014"), "");

  const cssRes = await fetch(BASE + "/theme-v2.css");
  const css = await cssRes.text();
  check("stylesheet ships the proof sheet layout and the print rules", css.includes(".proof-sheet") && css.includes("@media print") && css.includes(".no-print"), "");
} catch (e) {
  failed += 1;
  failures.push("suite error: " + e.message);
  console.log("  FAIL  suite error :: " + e.message);
} finally {
  await stopServer();
}

console.log(`\nRealtor verification: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("Failures: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
