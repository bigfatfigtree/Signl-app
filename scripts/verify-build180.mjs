// Build -180 verification: DUAL-ROLE ACCOUNTS (one email, one
// sign-in, a business side AND a creator side, with an in-app
// switch). Jeff's order 2026-11-16 ("Why isn't the toggle
// built. Go ahead"); spec: goal hidden_files/
// dual-role-toggle-spec-2026-11-16.md. Chelsea Moubarak's case
// is the fixture spine: an approved BUSINESS account whose
// creator claim used to bounce off "you already have an
// account."
//
// Layers:
//   1. Source pins (stamps, client switch/add-side wiring,
//      server routes + the dual_role_password code).
//   2. API end-to-end against the dev server: Chelsea's claim
//      with a wrong password (structured 409, nothing created),
//      with her account password (creator side created pending,
//      business side untouched, link mutual, email index still
//      on the primary), role-already-held 409, switch round
//      trip, signed-in add-side, password-change sync across
//      both sides, counts (one creator record, one business
//      record), admin search showing the link, and Maggie
//      scoping probed BOTH ways with a recording AI stub (the
//      context sent for one side must never contain the other
//      side's facts).
// Run: node scripts/verify-build180.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const PORT = 8941;
const STUB_PORT = 8942;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "build180-admin-pass";
const DB = path.join(os.tmpdir(), `signl-verify-build180-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

// ---------------- source pins ----------------
console.log("== source pins ==");
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const idxHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("build stamp is 2026.11.16-180 (lib + shell)", buildJs.includes("2026.11.16-180") && idxHtml.includes("2026.11.16-180"));
check("client: switch + add-side functions exist", appJs.includes("async function switchSide180()") && appJs.includes("function openAddSide180(role)") && appJs.includes("async function submitAddSide180(e, role)"));
check("client: menu rows name both directions", appJs.includes("Switch to your creator side") && appJs.includes("Switch to your business side") && appJs.includes("Add a creator side") && appJs.includes("Add a business side"));
check("client: claim + join forms handle dual_role_password", (appJs.match(/dual_role_password/g) || []).length >= 3);
check("client: admin card shows the dual badge", appJs.includes("Dual account:"));
check("server: add-side + switch-side routes registered", routerJs.includes('"add-side"') && routerJs.includes('"switch-side"'));
check("server: structured dual_role_password refusal", routerJs.includes('code: "dual_role_password"'));
check("server: linked sibling integrity check present", routerJs.includes("function linkedSiblingOf(user)"));
function fnBody(src, name) {
  const i = src.indexOf(`function ${name}`);
  if (i < 0) return "";
  const open = src.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth += 1;
    else if (src[j] === "}") { depth -= 1; if (depth === 0) return src.slice(i, j + 1); }
  }
  return "";
}
const newFns180 = ["linkedSiblingOf", "withLinkedSide", "syncLinkedPassword", "handleSwitchSide", "handleAddSide"].map((n) => fnBody(routerJs, n)).join("\n");
check("server: -180 functions located for the LOADER pin", newFns180.includes("linkedSiblingOf") && newFns180.includes("handleAddSide"));
check("server: no prefix scans in the new -180 functions (LOADER RULE)", !/\.list\(|allUsers\(/.test(newFns180));

// ---------------- AI stub (records payloads) ----------------
let stubHits = 0;
const stubPayloads = [];
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    stubHits += 1;
    stubPayloads.push(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "STUB AI ANSWER" } }] }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));

// ---------------- dev server harness ----------------
function client() {
  const jar = new Map();
  return async (method, p, body) => {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, data };
  };
}
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1", SIG_AI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`, SIG_AI_API_KEY: "stub-key", SIG_AI_MODEL: "stub-model" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
function readDb() { return JSON.parse(fs.readFileSync(DB, "utf8")); }
function usersWithEmail(db, email) {
  return Object.entries(db).filter(([k, v]) => k.startsWith("user:") && v && v.email === email).map(([, v]) => v);
}

const CHELSEA_EMAIL = "chelsea@fixtures.dev";
const CHELSEA_PW = "chelsea-pass-123";
const BIZ_NAME = "Fixture Friday Furniture";

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200, JSON.stringify(adminLogin.data).slice(0, 120));

  console.log("== Chelsea's case: approved business, then the creator claim ==");
  const bizReg = await client()("POST", "/api/auth/register", {
    role: "business", name: "Chelsea Fixture", email: CHELSEA_EMAIL, password: CHELSEA_PW,
    businessName: BIZ_NAME, category: "Retail", market: "Nashville", city: "Nashville", agreedTerms: true,
  });
  check("business registers (pending)", bizReg.status === 201 && bizReg.data.user.role === "business" && bizReg.data.user.status === "pending", JSON.stringify(bizReg.data).slice(0, 200));
  const bizId = bizReg.data.user.id;
  const appr = await admin("POST", "/api/admin/review", { userId: bizId, decision: "approve" });
  check("business approved through the normal review", appr.status === 200 && appr.data.user.status === "approved", JSON.stringify(appr.data).slice(0, 160));

  const wrong = await client()("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: CHELSEA_EMAIL, password: "not-her-password-1",
    handle: "fixturefriday", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true,
  });
  check("claim with a WRONG password -> 409 dual_role_password", wrong.status === 409 && wrong.data.code === "dual_role_password", JSON.stringify(wrong.data).slice(0, 200));
  check("wrong-password claim created nothing", usersWithEmail(readDb(), CHELSEA_EMAIL).length === 1);

  const claim = await client()("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: CHELSEA_EMAIL, password: CHELSEA_PW,
    handle: "fixturefriday", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true,
  });
  check("claim with her account password -> creator side created", (claim.status === 201 || claim.status === 200) && claim.data.user.role === "creator", JSON.stringify(claim.data).slice(0, 200));
  const creatorId = claim.data.user && claim.data.user.id;
  check("creator side lands PENDING (normal review still applies)", claim.data.user.status === "pending", claim.data.user.status);
  check("claim response names the business side", !!claim.data.user.linkedSide && claim.data.user.linkedSide.role === "business" && claim.data.user.linkedSide.status === "approved", JSON.stringify(claim.data.user.linkedSide || {}));

  const db1 = readDb();
  const fam = usersWithEmail(db1, CHELSEA_EMAIL);
  const bizRec = fam.find((u) => u.id === bizId);
  const creRec = fam.find((u) => u.id === creatorId);
  check("exactly two records for the email (one per side)", fam.length === 2);
  check("link is mutual", !!bizRec && !!creRec && bizRec.linkedAccountId === creatorId && creRec.linkedAccountId === bizId);
  check("business side untouched (name, status, payload)", bizRec.status === "approved" && bizRec.business.businessName === BIZ_NAME);
  check("both sides share one password hash", bizRec.passwordHash === creRec.passwordHash && bizRec.passwordSalt === creRec.passwordSalt);
  check("email index still points at the primary (business) record", db1[`email:${CHELSEA_EMAIL}`] && db1[`email:${CHELSEA_EMAIL}`].userId === bizId);

  const dupeSide = await client()("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: CHELSEA_EMAIL, password: CHELSEA_PW,
    handle: "fixturefriday2", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true,
  });
  check("claiming a role the account already holds -> standing 409", dupeSide.status === 409 && dupeSide.data.code !== "dual_role_password", JSON.stringify(dupeSide.data).slice(0, 160));
  check("still exactly two records", usersWithEmail(readDb(), CHELSEA_EMAIL).length === 2);

  console.log("== admin sees both sides on one account ==");
  const search = await admin("GET", `/api/admin/users/search?q=${encodeURIComponent("chelsea@fixtures")}`);
  const rows = (search.data.users || []).filter((u) => u.email === CHELSEA_EMAIL);
  check("admin search returns both sides", rows.length === 2, JSON.stringify(search.data).slice(0, 200));
  check("both admin rows carry the link", rows.every((u) => !!u.linkedAccountId));

  console.log("== sign in, approve the creator side, switch ==");
  const chelsea = client();
  const login = await chelsea("POST", "/api/auth/login", { email: CHELSEA_EMAIL, password: CHELSEA_PW });
  check("sign-in lands on the primary (business) side", login.status === 200 && login.data.user.role === "business", JSON.stringify(login.data).slice(0, 160));
  check("login response names the creator side", !!login.data.user.linkedSide && login.data.user.linkedSide.role === "creator");
  const apprCreator = await admin("POST", "/api/admin/review", { userId: creatorId, decision: "approve" });
  check("creator side approved through the normal review", apprCreator.status === 200 && apprCreator.data.user.status === "approved");
  const sw1 = await chelsea("POST", "/api/auth/switch-side", {});
  check("switch to creator side", sw1.status === 200 && sw1.data.user.role === "creator" && sw1.data.user.id === creatorId, JSON.stringify(sw1.data).slice(0, 160));
  const meCreator = await chelsea("GET", "/api/auth/me");
  check("session now reads as the creator", meCreator.data.user.role === "creator" && meCreator.data.user.creator.handle === "fixturefriday");
  check("creator session names the business side", !!meCreator.data.user.linkedSide && meCreator.data.user.linkedSide.role === "business");
  // Give the creator side a distinctive audience for the Maggie probes.
  const patch = await chelsea("PATCH", "/api/me/profile", { audienceStack: { instagram: 12345 }, localAudiencePct: 60 });
  check("creator audience stack saves (12,345)", patch.status === 200, JSON.stringify(patch.data).slice(0, 160));
  const sw2 = await chelsea("POST", "/api/auth/switch-side", {});
  check("switch back to the business side", sw2.status === 200 && sw2.data.user.role === "business" && sw2.data.user.id === bizId);
  const meBiz = await chelsea("GET", "/api/auth/me");
  check("business session intact after the round trip", meBiz.data.user.business.businessName === BIZ_NAME && meBiz.data.user.status === "approved");

  console.log("== Maggie scoping, probed both ways ==");
  const hitsBefore = stubHits;
  const askBiz = await chelsea("POST", "/api/sig/ask", { q: "What should I focus on this week?" });
  check("business-side ask answered", askBiz.status === 200, JSON.stringify(askBiz.data).slice(0, 160));
  const bizPayload = stubPayloads.slice(hitsBefore).join("\n");
  check("business-side Maggie context reached the model", stubHits > hitsBefore);
  check("business context carries the business name", bizPayload.includes(BIZ_NAME));
  check("business context has NO creator handle", !bizPayload.includes("fixturefriday"));
  check("business context has NO creator follower count", !bizPayload.includes("12345") && !bizPayload.includes("12,345"));
  const hitsMid = stubHits;
  await chelsea("POST", "/api/auth/switch-side", {});
  const askCre = await chelsea("POST", "/api/sig/ask", { q: "What should I focus on this week?" });
  check("creator-side ask answered", askCre.status === 200, JSON.stringify(askCre.data).slice(0, 160));
  const crePayload = stubPayloads.slice(hitsMid).join("\n");
  check("creator-side Maggie context reached the model", stubHits > hitsMid);
  check("creator context carries her own follower count (own-scope control)", crePayload.includes("12,345"));
  check("creator context has NO business name", !crePayload.includes(BIZ_NAME));
  await chelsea("POST", "/api/auth/switch-side", {});

  console.log("== password change syncs to both sides ==");
  const chg = await chelsea("POST", "/api/auth/change-password", { currentPassword: CHELSEA_PW, newPassword: "chelsea-new-pass-456" });
  check("password change succeeds on the business side", chg.status === 200, JSON.stringify(chg.data).slice(0, 160));
  const db2 = readDb();
  const fam2 = usersWithEmail(db2, CHELSEA_EMAIL);
  check("both records carry the new hash", fam2.length === 2 && fam2[0].passwordHash === fam2[1].passwordHash);
  const oldLogin = await client()("POST", "/api/auth/login", { email: CHELSEA_EMAIL, password: CHELSEA_PW });
  check("old password refused", oldLogin.status === 401, String(oldLogin.status));
  const newLogin = await client()("POST", "/api/auth/login", { email: CHELSEA_EMAIL, password: "chelsea-new-pass-456" });
  check("new password signs in (to the primary side)", newLogin.status === 200 && newLogin.data.user.role === "business");

  console.log("== signed-in add-a-side (creator adds a business) ==");
  const carol = client();
  const carolReg = await carol("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "carol@fixtures.dev", password: "carol-pass-123",
    handle: "carolfixture", primaryPlatform: "tiktok", market: "Nashville", agreedTerms: true,
  });
  check("single-role creator registers clean (no link fields)", carolReg.status === 201 && !carolReg.data.user.linkedSide, JSON.stringify(carolReg.data).slice(0, 160));
  const noSwitch = await carol("POST", "/api/auth/switch-side", {});
  check("single-role switch -> 409 one-side message", noSwitch.status === 409, JSON.stringify(noSwitch.data).slice(0, 160));
  const addBiz = await carol("POST", "/api/auth/add-side", {
    role: "business", name: "Carol Fixture", businessName: "Carol Fixture Studio", category: "Retail",
    market: "Nashville", city: "Nashville", agreedTerms: true,
  });
  check("add-side creates the business side + lands on it", addBiz.status === 201 && addBiz.data.user.role === "business" && addBiz.data.user.status === "pending", JSON.stringify(addBiz.data).slice(0, 200));
  check("add-side response names the creator side", !!addBiz.data.user.linkedSide && addBiz.data.user.linkedSide.role === "creator");
  const addAgain = await carol("POST", "/api/auth/add-side", { role: "business", name: "Carol Fixture", businessName: "Second Studio", market: "Nashville", agreedTerms: true });
  check("adding a side the account already holds -> 409", addAgain.status === 409, JSON.stringify(addAgain.data).slice(0, 160));
  const backAgain = await carol("POST", "/api/auth/switch-side", {});
  check("new dual account switches back to the creator side", backAgain.status === 200 && backAgain.data.user.role === "creator");

  console.log("== counts stay honest ==");
  const db3 = readDb();
  const all = Object.values(db3).filter((v) => v && typeof v === "object" && v.id && v.role);
  const chelseaCreators = all.filter((u) => u.email === CHELSEA_EMAIL && u.role === "creator");
  const chelseaBiz = all.filter((u) => u.email === CHELSEA_EMAIL && u.role === "business");
  check("Chelsea counts once as a creator and once as a business", chelseaCreators.length === 1 && chelseaBiz.length === 1);
  const searchAll = await admin("GET", `/api/admin/users/search?q=${encodeURIComponent("fixtures.dev")}`);
  check("admin totals see each side exactly once", (searchAll.data.users || []).filter((u) => u.email === CHELSEA_EMAIL).length === 2, `total=${searchAll.data.total}`);

  console.log(`\nverify-build180: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
} finally {
  await stopServer();
  stub.close();
}
