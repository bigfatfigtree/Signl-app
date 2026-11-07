// Account deletion verification (Build -132, shipped
// standalone ahead of the P0 batch on Jeff's 2026-11-05 order).
// Fixture user -> self-serve delete -> the record, the email
// index, every session, the public /c/ page and the sign-in
// lookup are all gone; the anonymised deletion event carries
// no PII; the confirmation email fired (event log) and its
// copy carries the thank-you and the sign-in link and no
// em dash (unit-pinned on the exported builder). The Admin
// hard-erase runs the same routine. Sig walks, never deletes.
// Run: node scripts/verify-deletion.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const routerLib = require("../netlify/functions/lib/router.js");

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = 8951;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "test-admin-password-123";
const DB = path.join(os.tmpdir(), `signl-verify-deletion-${Date.now()}.json`);
fs.writeFileSync(DB, "{}");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 240) : ""}`); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const readDb = () => JSON.parse(fs.readFileSync(DB, "utf8"));

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

function boot(port, db, extraEnv) {
  const s = spawn("node", ["scripts/dev-server.mjs", String(port)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: `http://127.0.0.1:${port}`, SIGNL_MAIL_STUB: "1", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  s.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return s;
}
const server = boot(PORT, DB, { SIGNL_TEST_ALLOW_BUSINESS: "1" });
// Boot B has NO test flag: TEST_MODE forces every market
// "live" (isMarketLive), which would make Sig's pre-launch
// warning unreachable. On boot B no market flags are set, so
// every market is unlaunched, exactly like production today.
const PORTB = 8952;
const BASEB = `http://127.0.0.1:${PORTB}`;
const DBB = path.join(os.tmpdir(), `signl-verify-deletion-b-${Date.now()}.json`);
fs.writeFileSync(DBB, "{}");
const serverB = boot(PORTB, DBB, {});
async function waitUpB() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASEB + "/api/bootstrap"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
}
function clientB() {
  const jar = new Map();
  return async (method, p, body) => {
    const res = await fetch(BASEB + p, { method, headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  };
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const uniq = () => Math.random().toString(36).slice(2, 8);
async function registerCreator(handle, email) {
  const c = client();
  const r = await c("POST", "/api/auth/register", { role: "creator", name: "Delete Fixture", email, password: "password123", market: "Hampton Roads", city: "Norfolk", handle, categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 3000, avgViews: 900, localAudiencePct: 62, ...AGREE });
  return { client: c, res: r, user: r.data && r.data.user };
}
async function registerBusiness(name, email) {
  const c = client();
  const r = await c("POST", "/api/auth/register", { role: "business", name: "Owner Fixture", email, password: "password123", market: "Hampton Roads", city: "Norfolk", businessName: name, category: "Restaurant", planId: "self-service", agreedTerms: true });
  return { client: c, res: r, user: r.data && r.data.user };
}

try {
  check("server boots", await waitUp());
  const admin = client();
  const ral = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin logs in", ral.status === 200);
  const approve = async (id) => admin("POST", "/api/admin/review", { userId: id, decision: "approve" });

  // ---------- source pins ----------
  const appJs = read("public/app.js");
  const routerJs = read("netlify/functions/lib/router.js");
  check("pin: stamp is 2026.11.06-139 on both sides", read("netlify/functions/lib/build.js").includes('BUILD_ID = "2026.11.06-139"') && read("public/index.html").includes("2026.11.06-139"));
  check("pin: self-serve screen is nested in accountHtml with the type-DELETE gate", appJs.includes("deleteAccountHtml(u)") && appJs.includes('id="delacct-confirm"') && appJs.includes('api("DELETE", "/me/account"'));
  check("pin: admin card carries the delete action with its own confirm", appJs.includes("adminDeleteAccountPrompt") && appJs.includes("/delete-account"));
  check("pin: card servicing row carries delete with its own prefixed prompt host (Build -133)", appJs.includes("adminDeleteAccountPrompt('${u.id}', '${prefix}-${u.id}')") && appJs.includes("id=\"admin-delacct-${prefix}-${u.id}\""));
  check("pin: Sig delete walk is wired server-side before the answerer", routerJs.indexOf("delete my account") > -1 && routerJs.includes("cr-settings") && routerJs.includes("biz-settings"));
  check("pin: canon banks answer delete with the walk, not support", (appJs.match(/id: "delete-account"/g) || []).length >= 2);

  // ---------- the email copy (unit, on the exported builder) ----------
  const mail = routerLib.accountDeletionEmail();
  check("email: subject confirms deletion", mail.subject === "Your SIGNL account has been deleted");
  check("email: thanks them for being part of the community", mail.text.includes("Thank you for being part of the SIGNL community"));
  check("email: carries the sign-in link", mail.text.includes("https://app.joinsignl.com/"));
  check("email: states the data does not survive", mail.text.includes("gone for good") && mail.text.includes("Nothing from the old one carries over"));
  check("email: no em dashes anywhere", !mail.text.includes("—") && !mail.subject.includes("—"));

  // ---------- fixtures ----------
  const du = uniq();
  const D = await registerCreator(`delcr${du}`, `delcr${du}@fixtures.dev`);
  check("fixture creator registered", !!D.user, JSON.stringify(D.res.data).slice(0, 160));
  await approve(D.user.id);
  const BD = await registerBusiness(`Delete Biz ${du}`, `delbiz${du}@fixtures.dev`);
  check("fixture business registered", !!BD.user, JSON.stringify(BD.res.data).slice(0, 160));
  await approve(BD.user.id);
  const K = await registerCreator(`keep${du}`, `keep${du}@fixtures.dev`);
  await approve(K.user.id);

  // The public page only resolves once the creator turns it
  // on (creator.publicPage), through the profile route.
  await D.client("PATCH", "/api/me/profile", { publicPage: true });
  const pubBefore = await client()("GET", `/api/c/delcr${du}`);
  check("public /c/ page live before deletion", pubBefore.status === 200, String(pubBefore.status));
  const meBefore = await D.client("GET", "/api/auth/me");
  check("fixture session live before deletion", !!(meBefore.data && meBefore.data.user));

  // An in-flight deal from the business to the creator: it
  // must close when the creator deletes.
  const deal = await BD.client("POST", "/api/deals", { creatorId: D.user.id, kind: "comp", title: "Fixture deal", dollarCap: 60, expiresInHours: 48 });
  check("in-flight deal created", deal.status === 201 && deal.data.deal && deal.data.deal.status === "pending", JSON.stringify(deal.data).slice(0, 200));

  // Sign-in link control: the keeper's email DOES resolve.
  const ctrl = await client()("POST", "/api/auth/signin-link", { email: `keep${du}@fixtures.dev` });
  check("control: sign-in link token issued for a live account (test hook)", !!(ctrl.data && ctrl.data.devSigninToken), JSON.stringify(ctrl.data).slice(0, 120));

  // ---------- self-serve delete ----------
  const noWord = await D.client("DELETE", "/api/me/account", {});
  check("delete without the word DELETE is refused", noWord.status === 400, String(noWord.status));
  const wrongWord = await D.client("DELETE", "/api/me/account", { confirmText: "delete" });
  check("delete with the wrong word is refused", wrongWord.status === 400, String(wrongWord.status));
  const gone = await D.client("DELETE", "/api/me/account", { confirmText: "DELETE" });
  check("self-serve delete succeeds with DELETE", gone.status === 200 && gone.data.deleted === true, JSON.stringify(gone.data).slice(0, 160));

  const meAfter = await D.client("GET", "/api/auth/me");
  check("the deleting session is signed out immediately", !(meAfter.data && meAfter.data.user));
  const pubAfter = await client()("GET", `/api/c/delcr${du}`);
  check("public /c/ page is gone (404)", pubAfter.status === 404, String(pubAfter.status));
  const linkAfter = await client()("POST", "/api/auth/signin-link", { email: `delcr${du}@fixtures.dev` });
  check("sign-in lookup finds no account (no token issued)", !(linkAfter.data && linkAfter.data.devSigninToken), JSON.stringify(linkAfter.data).slice(0, 120));
  const loginAfter = await client()("POST", "/api/auth/login", { email: `delcr${du}@fixtures.dev`, password: "password123" });
  check("old credentials no longer sign in", loginAfter.status !== 200, String(loginAfter.status));

  const db = readDb();
  check("db: user record erased", !db[`user:${D.user.id}`]);
  check("db: email index erased", !db[`email:delcr${du}@fixtures.dev`]);
  check("db: every session for the user erased", !Object.entries(db).some(([k, v]) => k.startsWith("session:") && v && v.userId === D.user.id));
  check("db: no notifications remain addressed to the user", !Object.keys(db).some((k) => k.startsWith(`note:${D.user.id}:`)));

  const bizDeals = await BD.client("GET", "/api/deals");
  const theDeal = (bizDeals.data.deals || []).find((d) => d.id === (deal.data.deal && deal.data.deal.id));
  check("in-flight deal closed by the deletion", !!theDeal && theDeal.status === "withdrawn", theDeal && theDeal.status);

  // The deletion events: one anonymised account_deleted, and
  // the confirmation email's send event addressed to the
  // (now erased) fixture address.
  const evDel = await admin("GET", "/api/admin/events?type=account_deleted&limit=50");
  const delEvents = (evDel.data.events || []).filter((e) => e.data && e.data.via === "self");
  check("anonymised deletion event logged (via self)", delEvents.length >= 1, JSON.stringify(evDel.data).slice(0, 200));
  const evJson = JSON.stringify(delEvents[0] || {});
  check("deletion event carries NO pii (no email, no name, no user id)", !evJson.includes("@fixtures.dev") && !evJson.includes("Delete Fixture") && !evJson.includes(D.user.id), evJson.slice(0, 240));
  const evMail = await admin("GET", "/api/admin/events?type=account_deletion_email_sent&limit=50");
  check("confirmation email was sent at deletion time", (evMail.data.events || []).some((e) => JSON.stringify(e).includes(`delcr${du}@fixtures.dev`)), JSON.stringify(evMail.data).slice(0, 200));

  // ---------- Sig's deletion conversation (Jeff, 2026-11-05):
  // ---------- one reminder, one pre-launch warning, then the
  // ---------- route; a second ask gets the route only. Runs
  // ---------- on boot B, where no market is live (production
  // ---------- truth today), so the warning must fire. ------
  check("boot B up (unlaunched markets)", await waitUpB());
  const adminB = clientB();
  await adminB("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const approveB = async (id) => adminB("POST", "/api/admin/review", { userId: id, decision: "approve" });
  const regCreatorB = async (handle, email) => {
    const c = clientB();
    const r = await c("POST", "/api/auth/register", { role: "creator", name: "Sig Fixture", email, password: "password123", market: "Richmond", city: "Richmond", handle, categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", followerCount: 3000, avgViews: 900, localAudiencePct: 62, ...AGREE });
    return { client: c, user: r.data && r.data.user };
  };
  const regBizB = async (name, email) => {
    const c = clientB();
    const r = await c("POST", "/api/auth/register", { role: "business", name: "Owner Fixture", email, password: "password123", market: "Richmond", city: "Richmond", businessName: name, category: "Restaurant", planId: "self-service", agreedTerms: true });
    return { client: c, user: r.data && r.data.user };
  };
  const KB = await regCreatorB(`sigcr${du}`, `sigcr${du}@fixtures.dev`);
  await approveB(KB.user.id);
  const sig = await KB.client("POST", "/api/sig/ask", { q: "how do I delete my account" });
  const sigText = (sig.data && sig.data.text) || "";
  check("(a) creator first ask: answered by the deterministic walk", sig.status === 200 && sig.data.source === "data" && !!sig.data.link && sig.data.link.dest === "cr-settings", JSON.stringify(sig.data).slice(0, 240));
  check("(a) creator first ask: the one honest reminder (free always, founding status, Momentum, referral link)", sigText.includes("free for creators, always") && sigText.includes("founding creator status") && sigText.includes("Momentum") && sigText.includes("referral link"), sigText.slice(0, 260));
  check("(a) creator first ask: pre-launch warning (launching soon, founding status lost, no dates)", sigText.includes("launching soon") && sigText.includes("losing your early, founding status"), sigText.slice(0, 260));
  check("(a) creator first ask: then the route and what the screen asks", sigText.includes("Settings") && sigText.includes("Delete my account") && sigText.includes("type DELETE"), sigText.slice(0, 260));
  const kMe = await KB.client("GET", "/api/auth/me");
  check("Sig did NOT delete the asker", !!(kMe.data && kMe.data.user));

  const sig2 = await KB.client("POST", "/api/sig/ask", { q: "yes, delete my account", history: [{ who: "user", text: "how do I delete my account" }, { who: "sig", text: sigText }] });
  const sig2Text = (sig2.data && sig2.data.text) || "";
  check("(c) second ask: route is given again with the link", sig2.status === 200 && sig2Text.includes("Settings") && sig2.data.link && sig2.data.link.dest === "cr-settings", JSON.stringify(sig2.data).slice(0, 240));
  check("(c) second ask: NO repeated pitch (no reminder, no warning)", !sig2Text.includes("Momentum") && !sig2Text.includes("launching soon") && !sig2Text.includes("free for creators") && !sig2Text.includes("founding status"), sig2Text.slice(0, 260));

  const BQ = await regBizB(`Quiz Biz ${du}`, `quizbiz${du}@fixtures.dev`);
  await approveB(BQ.user.id);
  const sigB = await BQ.client("POST", "/api/sig/ask", { q: "how do I delete my account" });
  const sigBText = (sigB.data && sigB.data.text) || "";
  check("(b) business first ask: founding rate + banked credit loss line", sigBText.includes("founding rate locked") && sigBText.includes("$100 first-month credit") && sigBText.includes("lost"), sigBText.slice(0, 260));
  check("(b) business first ask: pre-launch warning + route with the business link", sigBText.includes("launching soon") && sigBText.includes("Settings") && sigB.data.link && sigB.data.link.dest === "biz-settings", JSON.stringify(sigB.data).slice(0, 240));

  // ---------- admin hard-erase ----------
  const admNoWord = await admin("POST", `/api/admin/users/${BD.user.id}/delete-account`, {});
  check("admin erase without the word is refused", admNoWord.status === 400, String(admNoWord.status));
  const admGone = await admin("POST", `/api/admin/users/${BD.user.id}/delete-account`, { confirmText: "DELETE" });
  check("admin erase succeeds with DELETE", admGone.status === 200 && admGone.data.deleted === true, JSON.stringify(admGone.data).slice(0, 160));
  const db2 = readDb();
  check("db: admin-erased business record gone", !db2[`user:${BD.user.id}`] && !db2[`email:delbiz${du}@fixtures.dev`]);
  check("db: staff PIN and proof kit erased with the business", !db2[`staffpin:${BD.user.id}`] && !db2[`proofkit:${BD.user.id}`]);
  const evDel2 = await admin("GET", "/api/admin/events?type=account_deleted&limit=50");
  check("anonymised deletion event logged (via admin)", (evDel2.data.events || []).some((e) => e.data && e.data.via === "admin"));
  const evMail2 = await admin("GET", "/api/admin/events?type=account_deletion_email_sent&limit=50");
  check("admin erase also sent the confirmation email", (evMail2.data.events || []).some((e) => JSON.stringify(e).includes(`delbiz${du}@fixtures.dev`)));
  const adminMe = await admin("GET", "/api/auth/me");
  const admDelSelf = await admin("POST", `/api/admin/users/${adminMe.data.user.id}/delete-account`, { confirmText: "DELETE" });
  check("an admin account can never be erased from the card", admDelSelf.status === 400, String(admDelSelf.status));

  console.log(failed === 0 ? `verify-deletion: ALL PASS (${passed})` : `verify-deletion: ${failed} FAILURE(S), ${passed} passed`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  server.kill("SIGTERM");
  serverB.kill("SIGTERM");
}
