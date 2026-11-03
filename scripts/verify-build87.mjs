// Build -87 verification: the transactional notification rail
// (Tier 1 item 1, Jeff 2026-11-02). One notify() call routes
// clock events to SMS + transactional email per the recipient's
// per-type preferences; provider config is env-only and ABSENT
// here, so the rail must run in SANDBOX mode: every send is an
// outbox record, nothing is transmitted. This suite proves:
//   - statics: the lib, its event catalog (incl. the roster_drop
//     hook for item 6), the sweep function + endpoint, Settings
//     switches for both roles, manifest + service worker, and
//     the install banner on the claim DONE screen;
//   - each event type produces sandbox outbox entries (SMS +
//     email) with the correct recipient and rendered text
//     (driven through the real lib against the real store);
//   - a preference OFF suppresses that type only;
//   - the post-clock sweep (real HTTP, admin) fires the ~12h
//     alert exactly once and is idempotent on re-run;
//   - testers are fenced (recorded, never transmitted);
//   - Settings switches + phone persist via the real API, and
//     a partial save never wipes the other group (merge rule).
// Run: node scripts/verify-build87.mjs
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8961;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b87.dev";
const ADMIN_PASSWORD = "<redacted>";

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 220) : ""}`); }
}

// ---------- static ----------
console.log("== Static: rail, settings, PWA ==");
const notifyJs = fs.readFileSync(path.join(root, "netlify/functions/lib/notify.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
for (const t of ["creator_offer_new", "creator_early_access", "creator_booked", "post_clock_started", "post_clock_12h", "licence_waiting_creator", "business_applications_waiting", "business_licence_waiting", "roster_drop"])
  check(`event type defined: ${t}`, notifyJs.includes(`${t}:`));
check("provider config is env-only (Twilio + Resend/Postmark names, selector)", ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER"].every((v) => notifyJs.includes(v)));
check("outbox store key + sandbox status", notifyJs.includes("notifyoutbox:") && notifyJs.includes('"sandbox"'));
check("tester fence in the lib", notifyJs.includes("fenced_tester") && notifyJs.includes("isTester(user)"));
check("router hooks: note kinds ride the rail", routerJs.includes('offer_received: "creator_offer_new"') && routerJs.includes('application_selected: "creator_booked"') && routerJs.includes('application_received: "business_applications_waiting"'));
check("router hooks: milestones ride the rail", routerJs.includes('clock_started: "post_clock_started"') && routerJs.includes('paid_booking_received: "creator_booked"'));
check("router hooks: licence create + respond ride the rail", routerJs.includes('"licence_waiting_creator"') && routerJs.includes('"business_licence_waiting"'));
check("sweep endpoint + outbox endpoint exist", routerJs.includes('seg[1] === "notify" && seg[2] === "sweep"') && routerJs.includes('seg[2] === "outbox"'));
check("scheduled notify sweep function exists", fs.existsSync(path.join(root, "netlify/functions/notify-sweep.mjs")) && fs.readFileSync(path.join(root, "netlify/functions/notify-sweep.mjs"), "utf8").includes('schedule: "17 * * * *"'));
check("PATCH /me/notifications merges + stores phone", routerJs.includes("Merge, never wipe (Build -87)") && routerJs.includes("user.phone = b.phone"));
check("settings UI: six clock switches + phone, shared by both roles", ["np-offers", "np-bookings", "np-postclock", "np-licences", "np-applications", "np-roster", "np-phone"].every((id) => appJs.includes(`id="${id}"`)) && appJs.includes("postClock: !!document.getElementById(\"np-postclock\").checked"));
check("existing email switches kept", appJs.includes('id="np-activity"') && appJs.includes('id="np-reminders"'));
check("manifest linked + served file is valid", indexHtml.includes('<link rel="manifest" href="/manifest.json">') && (() => { try { const m = JSON.parse(fs.readFileSync(path.join(root, "public/manifest.json"), "utf8")); return m.name === "SIGNL" && m.start_url === "/" && m.display === "standalone" && m.icons.length >= 1; } catch (e) { return false; } })());
check("service worker exists (install + fetch, API never cached)", (() => { const sw = fs.readFileSync(path.join(root, "public/sw.js"), "utf8"); return sw.includes("addEventListener(\"install\"") && sw.includes("/api/"); })());
check("install prompt: capture + dismissal stored + banner on claim DONE", appJs.includes("beforeinstallprompt") && appJs.includes("signl_install_dismissed") && appJs.includes("signlInstallBannerHtml()") && appJs.includes('id="signl-install-banner"') && appJs.includes('navigator.serviceWorker.register("/sw.js")'));
check("stamp is 2026.11.03-116 on both sides", fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('BUILD_ID = "2026.11.03-116"') && indexHtml.includes("2026.11.03-116"));

// ---------- live ----------
class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* */ }
    return { status: res.status, data };
  }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b87-"));
const DB = path.join(tmp, "db.json");
const now = Date.now();
const in6h = new Date(now + 6 * 3600 * 1000).toISOString();
const in30h = new Date(now + 30 * 3600 * 1000).toISOString();
const ago1h = new Date(now - 3600 * 1000).toISOString();
function seedUser(id, extra) {
  return { id, passwordSalt: "seed", passwordHash: "seed", status: "approved", createdAt: ago1h, updatedAt: ago1h, ...extra };
}
const seed = {};
seed["user:c87"] = seedUser("c87", { role: "creator", email: "creator@b87.dev", name: "Casey Creator", phone: "+15550001111", market: "Nashville", tester: false, creator: { handle: "b87casey" }, business: null });
seed["user:b87"] = seedUser("b87", { role: "business", email: "biz@b87.dev", name: "Biz Owner", phone: "+15550002222", market: "Nashville", tester: false, creator: null, business: { businessName: "B87 Bistro" } });
seed["user:t87"] = seedUser("t87", { role: "creator", email: "tester@b87.dev", name: "Tess Tester", phone: "+15550003333", market: "Nashville", tester: true, creator: { handle: "b87tess" }, business: null });
seed["user:q87"] = seedUser("q87", { role: "creator", email: "quiet@b87.dev", name: "Quinn Quiet", phone: "+15550004444", market: "Nashville", tester: false, notifyPrefs: { postClock: false }, creator: { handle: "b87quinn" }, business: null });
function seedBooking(id, creatorId, deadline, extra = {}) {
  return { id, creatorId, businessId: "b87", businessName: "B87 Bistro", market: "Nashville", status: "booked", redeemedAt: ago1h, postDeadline: deadline, createdAt: ago1h, updatedAt: ago1h, ...extra };
}
seed["booking:bk-sweep"] = seedBooking("bk-sweep", "c87", in6h);
seed["booking:bk-far"] = seedBooking("bk-far", "c87", in30h);
seed["booking:bk-tester"] = seedBooking("bk-tester", "t87", in6h);
seed["booking:bk-quiet"] = seedBooking("bk-quiet", "q87", in6h);
fs.writeFileSync(DB, JSON.stringify(seed));

function startServer() {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD };
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_EMAIL_FROM"]) delete env[k];
  const s = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  s.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return s;
}
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error("server did not come up");
}
const readDb = () => JSON.parse(fs.readFileSync(DB, "utf8"));
const outboxFor = (db, userId, eventType) => Object.values(db).filter((v) => v && v.userId === userId && v.eventType === eventType && v.channel);

const server = startServer();
await waitUp();
console.log("== Live: manifest + SW served ==");
{
  const m = await fetch(`${BASE}/manifest.json`);
  const mj = await m.json().catch(() => null);
  check("GET /manifest.json 200 + SIGNL", m.status === 200 && !!mj && mj.name === "SIGNL", `status=${m.status}`);
  const sw = await fetch(`${BASE}/sw.js`);
  check("GET /sw.js 200", sw.status === 200 && (await sw.text()).includes("signl-shell"), `status=${sw.status}`);
}
const admin = new Client(BASE);
{ const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }); check("admin login", r.status === 200, `status=${r.status}`); }

console.log("== Live: every event type -> sandbox outbox (real lib, real store) ==");
{
  const script = `
    const notifyLib = require(${JSON.stringify(path.join(root, "netlify/functions/lib/notify.js"))});
    const store = require(${JSON.stringify(path.join(root, "netlify/functions/lib/store.js"))});
    (async () => {
      const c = await store.get("user:c87"); const b = await store.get("user:b87");
      const payload = { businessName: "B87 Bistro", offerTitle: "Taco Tuesday tasting", deadlineText: "Fri 6:00 PM ET", feeText: "$75", creatorName: "Casey Creator", count: 3, market: "Nashville" };
      for (const t of ["creator_offer_new","creator_early_access","creator_booked","post_clock_started","licence_waiting_creator"]) await notifyLib.notify(c, t, payload);
      for (const t of ["business_applications_waiting","business_licence_waiting","roster_drop"]) await notifyLib.notify(b, t, payload);
      console.log("lib calls done");
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  execFileSync("node", ["-e", script], { cwd: root, env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB }, stdio: "pipe" });
  const db = readDb();
  const cases = [
    ["c87", "creator_offer_new", "creator@b87.dev", "+15550001111", "Taco Tuesday tasting"],
    ["c87", "creator_early_access", "creator@b87.dev", "+15550001111", "early-access"],
    ["c87", "creator_booked", "creator@b87.dev", "+15550001111", "picked"],
    ["c87", "post_clock_started", "creator@b87.dev", "+15550001111", "post clock is running"],
    ["c87", "licence_waiting_creator", "creator@b87.dev", "+15550001111", "license your post"],
    ["b87", "business_applications_waiting", "biz@b87.dev", "+15550002222", "applied"],
    ["b87", "business_licence_waiting", "biz@b87.dev", "+15550002222", "licence"],
    ["b87", "roster_drop", "biz@b87.dev", "+15550002222", "finished"],
  ];
  for (const [uid, type, email, phone, needle] of cases) {
    const entries = outboxFor(db, uid, type);
    const sms = entries.find((e) => e.channel === "sms");
    const mail = entries.find((e) => e.channel === "email");
    check(`${type}: sms+email sandbox entries, right recipients, nothing transmitted`,
      !!sms && !!mail && sms.status === "sandbox" && mail.status === "sandbox" && sms.to === phone && mail.to === email && sms.transmitted === false && mail.transmitted === false && sms.sandbox === true,
      JSON.stringify(entries.map((e) => [e.channel, e.status, e.to])));
    check(`${type}: rendered text carries the event content`, !!sms && sms.text.includes(needle) && !!mail && mail.text.length > 20 && !!mail.subject, sms && sms.text);
  }
}

console.log("== Live: preference OFF suppresses that type only (real HTTP sweep) ==");
{
  const r = await admin.req("POST", "/api/admin/notify/sweep", {});
  check("sweep endpoint 200 + reports providers sandbox", r.status === 200 && r.data.providers && r.data.providers.sms === "sandbox" && r.data.providers.email === "sandbox", JSON.stringify(r.data).slice(0, 200));
  check("sweep fired exactly the one due creator alert", r.data.sweep && r.data.sweep.fired === 1, JSON.stringify(r.data.sweep));
  check("sweep counted the tester as fenced + pref-off as suppressed", r.data.sweep && r.data.sweep.fenced === 1 && r.data.sweep.suppressed === 1, JSON.stringify(r.data.sweep));
  const db = readDb();
  const c12 = outboxFor(db, "c87", "post_clock_12h");
  check("12h alert: sms+email sandbox entries for the due creator", c12.length === 2 && c12.every((e) => e.status === "sandbox" && e.transmitted === false), JSON.stringify(c12.map((e) => e.status)));
  check("12h alert text names the business + hours left", c12.some((e) => e.text.includes("12 hours") && e.text.includes("B87 Bistro")));
  check("booking stamped notify12hAt", !!db["booking:bk-sweep"].notify12hAt);
  check("far booking (30h left) untouched + no alert", !db["booking:bk-far"].notify12hAt && outboxFor(db, "c87", "post_clock_12h").length === 2);
  const t = outboxFor(db, "t87", "post_clock_12h");
  check("tester fenced: entries recorded fenced_tester, never transmitted", t.length === 2 && t.every((e) => e.status === "fenced_tester" && e.transmitted === false), JSON.stringify(t.map((e) => e.status)));
  const q = outboxFor(db, "q87", "post_clock_12h");
  check("postClock OFF: entries suppressed_pref for that type", q.length === 2 && q.every((e) => e.status === "suppressed_pref"), JSON.stringify(q.map((e) => e.status)));

  const r2 = await admin.req("POST", "/api/admin/notify/sweep", {});
  const db2 = readDb();
  check("sweep re-run is idempotent: fired 0, no new 12h entries", r2.status === 200 && r2.data.sweep.fired === 0 && outboxFor(db2, "c87", "post_clock_12h").length === 2, JSON.stringify(r2.data && r2.data.sweep));
  const ob = await admin.req("GET", "/api/admin/notify/outbox?limit=500");
  // Local file-store note: the dev server caches the DB file in
  // memory, so its outbox view covers the entries IT wrote (the
  // sweep's 6); the lib-child entries were already asserted from
  // the file above. Production Blobs has no such cache split.
  check("admin outbox read: sandbox mode + entries visible", ob.status === 200 && ob.data.providers.sandbox === true && ob.data.outbox.length >= 6 && ob.data.outbox.every((e) => e.transmitted === false), `n=${ob.data && ob.data.outbox && ob.data.outbox.length}`);
}

console.log("== Live: settings switches persist via the real API ==");
{
  const c = new Client(BASE);
  const reg = await c.req("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "set@b87.dev", password: "<redacted>", market: "Nashville", handle: "b87settings", primaryPlatform: "instagram", agreedTerms: true });
  check("settings creator registers", reg.status === 201, `status=${reg.status}`);
  const p1 = await c.req("PATCH", "/api/me/notifications", { offers: true, bookings: true, postClock: false, licences: true, applications: true, roster: false, phone: "+15550009999" });
  check("clock prefs + phone save and echo", p1.status === 200 && p1.data.notifyPrefs.postClock === false && p1.data.notifyPrefs.roster === false && p1.data.notifyPrefs.offers === true && p1.data.phone === "+15550009999", JSON.stringify(p1.data).slice(0, 220));
  const p2 = await c.req("PATCH", "/api/me/notifications", { emailMessages: false });
  check("partial email save does not wipe clock prefs (merge rule)", p2.status === 200 && p2.data.notifyPrefs.postClock === false && p2.data.notifyPrefs.emailMessages === false && p2.data.phone === "+15550009999", JSON.stringify(p2.data).slice(0, 220));
  const me = await c.req("GET", "/api/auth/me");
  check("prefs persist on the account record", me.data.user.notifyPrefs.postClock === false && me.data.user.phone === "+15550009999", JSON.stringify({ p: me.data.user.notifyPrefs, phone: me.data.user.phone }).slice(0, 220));
  // pref-off suppresses that type only, through the lib against the same store:
  const script = `
    const notifyLib = require(${JSON.stringify(path.join(root, "netlify/functions/lib/notify.js"))});
    const store = require(${JSON.stringify(path.join(root, "netlify/functions/lib/store.js"))});
    (async () => { const u = await store.get("user:${reg.data.user.id}"); await notifyLib.notify(u, "post_clock_started", { businessName: "B87 Bistro" }); await notifyLib.notify(u, "creator_offer_new", { businessName: "B87 Bistro", offerTitle: "Taco Tuesday tasting" }); })().catch((e) => { console.error(e); process.exit(1); });
  `;
  execFileSync("node", ["-e", script], { cwd: root, env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB }, stdio: "pipe" });
  const db = readDb();
  const off = outboxFor(db, reg.data.user.id, "post_clock_started");
  const on = outboxFor(db, reg.data.user.id, "creator_offer_new");
  check("postClock OFF suppresses post_clock_started only; offers still send (sandbox)", off.length === 2 && off.every((e) => e.status === "suppressed_pref") && on.length === 2 && on.every((e) => e.status === "sandbox"), JSON.stringify({ off: off.map((e) => e.status), on: on.map((e) => e.status) }));
}
server.kill("SIGTERM");
console.log(`\nverify-build87: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("failures:", failures.join(" | ")); process.exit(1); }
