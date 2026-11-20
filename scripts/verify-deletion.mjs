// Account deletion verification (Build -132, shipped
// standalone ahead of the P0 batch on Jeff's 2026-11-05 order;
// SEMANTICS CHANGED by Build -219c on Jeff's 2026-11-20 order:
// deletion is a SOFT delete, never a one-way door. The record
// is preserved and flagged `accountDeleted`, access dies
// (sessions, tokens, email index), every surface excludes the
// account, trading settles as before but keeps its records,
// and an admin restores the account from Admin -> Deleted
// accounts, returning it to its prior status with sign-in
// working again. The hard-erase pins this suite used to carry
// (record gone, email index gone for good, bookings
// anonymised, staff PIN erased) are replaced below by the
// soft-delete equivalents. The confirmation email copy is
// unchanged from the hard-erase era, per the -219c scope, and
// its pins stay. Sig walks, never deletes.
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
const VERIFY_TOKEN = "deletion-fixture-token";
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
const server = boot(PORT, DB, { SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_VERIFY_TOKEN: VERIFY_TOKEN });
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

// Surface probes (Build -219c): the checker-key counts and the
// public Local List — two surfaces that must drop a deleted
// account and take it back on restore.
async function countsNow() {
  const r = await fetch(BASE + "/api/verify/counts", { headers: { "x-signl-verify-token": VERIFY_TOKEN } });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function localListText() {
  const r = await fetch(BASE + "/api/public/local-list?market=" + encodeURIComponent("Hampton Roads"));
  return r.text();
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
  const buildId = (read("netlify/functions/lib/build.js").match(/BUILD_ID = "([^"]+)"/) || [])[1];
  check("pin: build stamp consistent between build.js and index.html", !!buildId && read("public/index.html").includes(buildId), String(buildId));
  check("pin: self-serve screen is nested in accountHtml with the type-DELETE gate", appJs.includes("deleteAccountHtml(u)") && appJs.includes('id="delacct-confirm"') && appJs.includes('api("DELETE", "/me/account"'));
  check("pin: admin card carries the delete action with its own confirm", appJs.includes("adminDeleteAccountPrompt") && appJs.includes("/delete-account"));
  check("pin: card servicing row carries delete with its own prefixed prompt host (Build -133)", appJs.includes("adminDeleteAccountPrompt('${u.id}', '${prefix}-${u.id}')") && appJs.includes("id=\"admin-delacct-${prefix}-${u.id}\""));
  check("pin: Sig delete walk is wired server-side before the answerer", routerJs.indexOf("delete my account") > -1 && routerJs.includes("cr-settings") && routerJs.includes("biz-settings"));
  check("pin: canon banks answer delete with the walk, not support", (appJs.match(/id: "delete-account"/g) || []).length >= 2);
  check("pin (219c): the deletion routine is the SOFT delete, exported with restore", routerJs.includes("async function softDeleteAccount") && routerJs.includes("async function restoreAccount219c") && routerJs.includes("softDeleteAccount(user, \"self\")") && routerJs.includes("softDeleteAccount(target, \"admin\")"));
  check("pin (219c): no anonymised booking rewrite survives in the router", !routerJs.includes("A deleted creator") && !routerJs.includes("A deleted business"));
  check("pin (219c): allUsers filters flagged accounts centrally", routerJs.includes('return (await listMemoized210("user:")).filter((u) => !isAccountDeleted(u))'));
  check("pin (219c): delete confirm copy says an admin can restore the account", appJs.includes("An admin can restore your account if this was a mistake") && appJs.includes("An admin can restore it later from Deleted accounts"));
  check("pin (219c): Admin Deleted view is wired (menu row, loader, endpoints)", appJs.includes('"Deleted accounts"') && appJs.includes("loadAdminDeleted219c") && appJs.includes('"/admin/deleted-accounts"') && appJs.includes("/restore-account"));

  // ---------- the email copy (unit, on the exported builder) ----------
  // Unchanged in -219c, per the order's scope.
  const mail = routerLib.accountDeletionEmail();
  check("email: subject confirms deletion", mail.subject === "Your Magpie account has been deleted");
  check("email: thanks them for being part of the community", mail.text.includes("Thank you for being part of the Magpie community"));
  check("email: carries the sign-in link", mail.text.includes("https://app.magpielocal.com/"));
  check("email: copy kept from the hard-erase era (unchanged per the -219c scope)", mail.text.includes("gone for good") && mail.text.includes("Nothing from the old one carries over"));
  check("email: no em dashes anywhere", !mail.text.includes("—") && !mail.subject.includes("—"));

  // ---------- fixtures ----------
  const du = uniq();
  const D = await registerCreator(`delcr${du}`, `delcr${du}@fixtures.dev`);
  check("fixture creator registered", !!D.user, JSON.stringify(D.res.data).slice(0, 160));
  await approve(D.user.id);
  const BD = await registerBusiness(`Delete Biz ${du}`, `delbiz${du}@fixtures.dev`);
  check("fixture business registered", !!BD.user, JSON.stringify(BD.res.data).slice(0, 160));
  await approve(BD.user.id);
  // A founding business cannot trade (the founding gate); the
  // admin activation is what opens its product access, and the
  // in-flight deal below needs a business that can trade.
  const actBiz = await admin("POST", "/api/admin/businesses/activate", { userId: BD.user.id });
  check("fixture business activated by admin", actBiz.status === 200, JSON.stringify(actBiz.data).slice(0, 160));
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

  // A message thread between the business and the creator: the
  // counterpart list must drop the creator while deleted and
  // bring the thread back on restore.
  const msg = await BD.client("POST", "/api/messages", { toUserId: D.user.id, body: "Fixture thread hello" });
  check("fixture message thread created", msg.status === 201, JSON.stringify(msg.data).slice(0, 160));
  const threadsBefore = await BD.client("GET", "/api/messages");
  check("counterpart list shows the creator before deletion", (threadsBefore.data.threads || []).some((t) => t.otherId === D.user.id));

  // Sign-in link control: the keeper's email DOES resolve.
  const ctrl = await client()("POST", "/api/auth/signin-link", { email: `keep${du}@fixtures.dev` });
  check("control: sign-in link token issued for a live account (test hook)", !!(ctrl.data && ctrl.data.devSigninToken), JSON.stringify(ctrl.data).slice(0, 120));

  // Surface baselines before deletion.
  const countsBefore = await countsNow();
  const signedUpBefore = countsBefore.data && countsBefore.data.totals ? countsBefore.data.totals.creatorsSignedUp : null;
  check("counts surface answers before deletion", countsBefore.status === 200 && typeof signedUpBefore === "number", JSON.stringify(countsBefore.data).slice(0, 160));
  check("Local List shows the creator before deletion", (await localListText()).includes(`delcr${du}`));
  const appsBefore = await admin("GET", "/api/admin/applications");
  check("admin Creators/Review data shows the creator before deletion", [...(appsBefore.data.pending || []), ...(appsBefore.data.decided || [])].some((u) => u.id === D.user.id));

  // ---------- self-serve soft delete ----------
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
  const recAfter = db[`user:${D.user.id}`];
  check("db: user record PRESERVED, flagged accountDeleted (via self, prior status kept)", !!recAfter && !!recAfter.accountDeleted && recAfter.accountDeleted.via === "self" && recAfter.accountDeleted.priorStatus === "approved" && !!recAfter.accountDeleted.at, JSON.stringify(recAfter && recAfter.accountDeleted).slice(0, 200));
  check("db: profile data survives on the preserved record", !!(recAfter && recAfter.creator && recAfter.creator.handle === `delcr${du}`));
  check("db: email index removed (no sign-in by that address)", !db[`email:delcr${du}@fixtures.dev`]);
  check("db: every session for the user erased", !Object.entries(db).some(([k, v]) => k.startsWith("session:") && v && v.userId === D.user.id));
  check("db: notifications addressed to the user are PRESERVED for a restore", Object.keys(db).some((k) => k.startsWith(`note:${D.user.id}:`)));

  const bizDeals = await BD.client("GET", "/api/deals");
  const theDeal = (bizDeals.data.deals || []).find((d) => d.id === (deal.data.deal && deal.data.deal.id));
  check("in-flight deal closed by the deletion (record kept, withdrawn)", !!theDeal && theDeal.status === "withdrawn", theDeal && theDeal.status);
  const dbDeal = readDb()[`vdeal:${deal.data.deal && deal.data.deal.id}`];
  check("db: the withdrawn deal record is kept, marked account_deleted", !!dbDeal && dbDeal.status === "withdrawn" && dbDeal.withdrawReason === "account_deleted");

  const countsAfter = await countsNow();
  check("counts: the deleted creator drops out of the signed-up total", countsAfter.data.totals && countsAfter.data.totals.creatorsSignedUp === signedUpBefore - 1, `before=${signedUpBefore} after=${countsAfter.data.totals && countsAfter.data.totals.creatorsSignedUp}`);
  check("Local List drops the creator while deleted", !(await localListText()).includes(`delcr${du}`));
  const appsAfter = await admin("GET", "/api/admin/applications");
  check("admin Creators/Review data drops the creator while deleted", ![...(appsAfter.data.pending || []), ...(appsAfter.data.decided || [])].some((u) => u.id === D.user.id));
  const threadsAfter = await BD.client("GET", "/api/messages");
  check("counterpart list drops the creator while deleted", !(threadsAfter.data.threads || []).some((t) => t.otherId === D.user.id));

  // The deletion events: one anonymised account_deleted, and
  // the confirmation email's send event addressed to the
  // fixture address (the send happens before the flag lands).
  const evDel = await admin("GET", "/api/admin/events?type=account_deleted&limit=50");
  const delEvents = (evDel.data.events || []).filter((e) => e.data && e.data.via === "self");
  check("anonymised deletion event logged (via self)", delEvents.length >= 1, JSON.stringify(evDel.data).slice(0, 200));
  const evJson = JSON.stringify(delEvents[0] || {});
  check("deletion event carries NO pii (no email, no name, no user id)", !evJson.includes("@fixtures.dev") && !evJson.includes("Delete Fixture") && !evJson.includes(D.user.id), evJson.slice(0, 240));
  const evMail = await admin("GET", "/api/admin/events?type=account_deletion_email_sent&limit=50");
  check("confirmation email was sent at deletion time", (evMail.data.events || []).some((e) => JSON.stringify(e).includes(`delcr${du}@fixtures.dev`)), JSON.stringify(evMail.data).slice(0, 200));

  // ---------- admin Deleted view + restore ----------
  const delList = await admin("GET", "/api/admin/deleted-accounts");
  const delRow = (delList.data.accounts || []).find((a) => a.id === D.user.id);
  check("Deleted view lists the account (handle, email, role, market, via)", !!delRow && delRow.handle === `delcr${du}` && delRow.email === `delcr${du}@fixtures.dev` && delRow.role === "creator" && delRow.deletedVia === "self" && !!delRow.deletedAt, JSON.stringify(delList.data).slice(0, 240));
  const delListAnon = await client()("GET", "/api/admin/deleted-accounts");
  check("Deleted view is admin-only", delListAnon.status === 401 || delListAnon.status === 403, String(delListAnon.status));

  const restoreKeeper = await admin("POST", `/api/admin/users/${K.user.id}/restore-account`, {});
  check("restoring a live account is a safe error, not a crash", restoreKeeper.status === 409, String(restoreKeeper.status));
  const mailEventsBeforeRestore = (await admin("GET", "/api/admin/events?type=account_deletion_email_sent&limit=50")).data.events || [];
  const restored = await admin("POST", `/api/admin/users/${D.user.id}/restore-account`, {});
  check("admin restore succeeds", restored.status === 200 && restored.data.restored === true, JSON.stringify(restored.data).slice(0, 160));
  const restoredAgain = await admin("POST", `/api/admin/users/${D.user.id}/restore-account`, {});
  check("a second restore is a safe error, not a crash (idempotent-safe)", restoredAgain.status === 409, String(restoredAgain.status));

  const dbR = readDb();
  check("db: restore cleared the flag and kept the record", !!dbR[`user:${D.user.id}`] && !dbR[`user:${D.user.id}`].accountDeleted);
  check("db: restore returned the prior status", dbR[`user:${D.user.id}`] && dbR[`user:${D.user.id}`].status === "approved", dbR[`user:${D.user.id}`] && dbR[`user:${D.user.id}`].status);
  check("db: restore rebuilt the email login index", !!(dbR[`email:delcr${du}@fixtures.dev`] && dbR[`email:delcr${du}@fixtures.dev`].userId === D.user.id));
  const loginBack = await client()("POST", "/api/auth/login", { email: `delcr${du}@fixtures.dev`, password: "password123" });
  check("sign-in works again after restore", loginBack.status === 200 && !!(loginBack.data && loginBack.data.user), String(loginBack.status));
  const pubBack = await client()("GET", `/api/c/delcr${du}`);
  check("public /c/ page is back after restore", pubBack.status === 200, String(pubBack.status));
  const countsBack = await countsNow();
  check("counts: the restored creator is back in the signed-up total", countsBack.data.totals && countsBack.data.totals.creatorsSignedUp === signedUpBefore, `before=${signedUpBefore} back=${countsBack.data.totals && countsBack.data.totals.creatorsSignedUp}`);
  check("Local List shows the creator again after restore", (await localListText()).includes(`delcr${du}`));
  const appsBack = await admin("GET", "/api/admin/applications");
  check("admin Creators/Review data shows the creator again, still approved", [...(appsBack.data.pending || []), ...(appsBack.data.decided || [])].some((u) => u.id === D.user.id && u.status === "approved"));
  const threadsBack = await BD.client("GET", "/api/messages");
  check("counterpart list shows the creator again after restore", (threadsBack.data.threads || []).some((t) => t.otherId === D.user.id));
  const delListBack = await admin("GET", "/api/admin/deleted-accounts");
  check("Deleted view no longer lists the restored account", !(delListBack.data.accounts || []).some((a) => a.id === D.user.id));
  const evRes = await admin("GET", "/api/admin/events?type=account_restored&limit=50");
  check("account_restored event logged with the admin as actor", (evRes.data.events || []).some((e) => e.subjectId === D.user.id && !!e.actorId), JSON.stringify(evRes.data).slice(0, 200));
  const mailEventsAfterRestore = (await admin("GET", "/api/admin/events?type=account_deletion_email_sent&limit=50")).data.events || [];
  check("no email is sent on restore", mailEventsAfterRestore.length === mailEventsBeforeRestore.length, `${mailEventsBeforeRestore.length} -> ${mailEventsAfterRestore.length}`);

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

  // ---------- admin soft delete (business, with a staff PIN) ----------
  const pinSet = await BD.client("POST", "/api/me/staff/pin", { pin: "1234" });
  check("fixture business staff PIN set before deletion", pinSet.status === 200, JSON.stringify(pinSet.data).slice(0, 120));
  const admNoWord = await admin("POST", `/api/admin/users/${BD.user.id}/delete-account`, {});
  check("admin delete without the word is refused", admNoWord.status === 400, String(admNoWord.status));
  const admGone = await admin("POST", `/api/admin/users/${BD.user.id}/delete-account`, { confirmText: "DELETE" });
  check("admin delete succeeds with DELETE", admGone.status === 200 && admGone.data.deleted === true, JSON.stringify(admGone.data).slice(0, 160));
  const admAgain = await admin("POST", `/api/admin/users/${BD.user.id}/delete-account`, { confirmText: "DELETE" });
  check("deleting an already deleted account is refused, not repeated", admAgain.status === 400, String(admAgain.status));
  const db2 = readDb();
  const bizRec = db2[`user:${BD.user.id}`];
  check("db: admin-deleted business record PRESERVED, flagged via admin", !!bizRec && !!bizRec.accountDeleted && bizRec.accountDeleted.via === "admin" && bizRec.accountDeleted.priorStatus === "approved");
  check("db: business email index removed while deleted", !db2[`email:delbiz${du}@fixtures.dev`]);
  check("db: staff PIN record is PRESERVED for a restore", !!db2[`staffpin:${BD.user.id}`], JSON.stringify(Object.keys(db2).filter((k) => k.includes(BD.user.id))).slice(0, 200));
  const bizLoginAfter = await client()("POST", "/api/auth/login", { email: `delbiz${du}@fixtures.dev`, password: "password123" });
  check("deleted business cannot sign in", bizLoginAfter.status !== 200, String(bizLoginAfter.status));
  const evDel2 = await admin("GET", "/api/admin/events?type=account_deleted&limit=50");
  check("anonymised deletion event logged (via admin)", (evDel2.data.events || []).some((e) => e.data && e.data.via === "admin"));
  const evMail2 = await admin("GET", "/api/admin/events?type=account_deletion_email_sent&limit=50");
  check("admin delete also sent the confirmation email", (evMail2.data.events || []).some((e) => JSON.stringify(e).includes(`delbiz${du}@fixtures.dev`)));
  const bizRestored = await admin("POST", `/api/admin/users/${BD.user.id}/restore-account`, {});
  check("admin restore brings the business back", bizRestored.status === 200 && bizRestored.data.restored === true, JSON.stringify(bizRestored.data).slice(0, 160));
  const bizLoginBack = await client()("POST", "/api/auth/login", { email: `delbiz${du}@fixtures.dev`, password: "password123" });
  check("business sign-in works again after restore", bizLoginBack.status === 200, String(bizLoginBack.status));
  const adminMe = await admin("GET", "/api/auth/me");
  const admDelSelf = await admin("POST", `/api/admin/users/${adminMe.data.user.id}/delete-account`, { confirmText: "DELETE" });
  check("an admin account can never be deleted from the card", admDelSelf.status === 400, String(admDelSelf.status));

  console.log(failed === 0 ? `verify-deletion: ALL PASS (${passed})` : `verify-deletion: ${failed} FAILURE(S), ${passed} passed`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  server.kill("SIGTERM");
  serverB.kill("SIGTERM");
}
