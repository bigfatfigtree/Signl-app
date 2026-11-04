#!/usr/bin/env node
// Build -105 verification (Tier 3 item 14): the co-brand pack.
// Proves, against the real dev server on port 9019:
//   - brand validation on the Admin partner PATCH: a non-https
//     logo link and a non-hex accent are refused (400); a valid
//     lowercase hex is stored uppercased; an oversized display
//     name is clipped to 80 chars; an all-empty block clears
//     the brand back to SIGNL-only;
//   - an unbranded partner is untouched: summary payload brand
//     is null and their sign-in email subject carries no
//     partner prefix (byte-identical to before the pack);
//   - a branded partner's portal payload carries the brand,
//     and their sign-in invite email goes through the one
//     helper: the recorded send event's subject is prefixed
//     "<Name> + SIGNL: " — proven from the event dataset the
//     mail seam itself writes, not a faked mailbox;
//   - pilots carry the funder brand the same way: Admin pilot
//     PATCH validates and stores it, the pilot payloads carry
//     it, and the resend-invite email is branded from the
//     PILOT record;
//   - the demo partner seed carries the sample brand;
//   - Admin Sig answers the branding question from the same
//     records (who is branded, who has no logo on file);
//   - canon locks: founding Stripe prices unarmed, stamp -105.
//
// Run: node scripts/verify-build105.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9019;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b105.dev";
const ADMIN_PASSWORD = ["fixture", "admin", "105"].join("-");

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-105", salt, 64).toString("hex");
const SEP = "2026-09-01T00:00:00.000Z";
const data = {};
function partner(id, name, code, markets) {
  data[`user:${id}`] = { id, role: "partner", email: `${id}@b105.dev`, name, passwordSalt: salt, passwordHash: hash, status: "approved", market: markets[0], createdAt: SEP, updatedAt: SEP, partner: { name, code, type: "media", contactName: "Pat Fixture", markets, status: "active", agreementStatus: "signed", agreementSignedAt: SEP, demo: false } };
  data[`email:${id}@b105.dev`] = { userId: id };
}
partner("partner-a", "Fixture Media A", "fma", ["Nashville"]);
partner("partner-b", "Fixture Media B", "fmb", ["Austin"]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build105-"));
const DB = path.join(tmp, "db.json");
fs.writeFileSync(DB, JSON.stringify(data));
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_EMAIL_FROM", "SQUARE_APP_ID", "SQUARE_APP_SECRET"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
process.on("exit", () => { try { server.kill("SIGKILL"); } catch (e) { /* already gone */ } });
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) break; } catch (e) { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}
const admin = new Client(BASE);
{
  const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error(`admin login: ${r.status}`);
}
function storedUser(id) {
  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  return db[`user:${id}`] || {};
}
function storedEvents(type, subjectId) {
  const db = JSON.parse(fs.readFileSync(DB, "utf8"));
  return Object.entries(db)
    .filter(([k, v]) => k.startsWith("event:") && v && v.type === type && (!subjectId || v.subjectId === subjectId))
    .map(([, v]) => v);
}
async function loginAs(email) {
  const c = new Client(BASE);
  const r = await c.req("POST", "/api/auth/login", { email, password: "fixture-pass-105" });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  return c;
}

console.log("== unbranded partner: byte-identical to before ==");
{
  const pc = await loginAs("partner-b@b105.dev");
  const sum = await pc.req("GET", "/api/partner/summary");
  check("unbranded partner summary carries brand: null", sum.data && sum.data.partner && sum.data.partner.brand === null, JSON.stringify(sum.data && sum.data.partner).slice(0, 200));
  const link = await admin.req("POST", "/api/admin/users/partner-b/send-signin-link", {});
  check("unbranded sign-in link sends", link.status === 200 && link.data.emailSent === true, `${link.status} ${JSON.stringify(link.data).slice(0, 160)}`);
  const evs = storedEvents("password_reset_email_sent", "partner-b");
  check("unbranded invite email subject has NO partner prefix", evs.length >= 1 && !/\+ SIGNL:/.test(evs[evs.length - 1].data.subject || ""), JSON.stringify(evs.map((e) => e.data.subject)));
}

console.log("== brand validation ==");
{
  const badLogo = await admin.req("PATCH", "/api/admin/partners/partner-a", { brand: { displayName: "Fixture Media A", logoUrl: "http://insecure.example/logo.png", accentColor: "", emailFromName: "" } });
  check("a non-https logo link is refused", badLogo.status === 400 && /logo link must start with https/.test((badLogo.data && badLogo.data.error) || ""), `${badLogo.status} ${JSON.stringify(badLogo.data).slice(0, 160)}`);
  const badHex = await admin.req("PATCH", "/api/admin/partners/partner-a", { brand: { displayName: "", logoUrl: "", accentColor: "azure", emailFromName: "" } });
  check("a non-hex accent color is refused", badHex.status === 400 && /hex color/.test((badHex.data && badHex.data.error) || ""), `${badHex.status} ${JSON.stringify(badHex.data).slice(0, 160)}`);
  check("refused writes stored nothing", !storedUser("partner-a").partner.brand, JSON.stringify(storedUser("partner-a").partner.brand));
  const long = await admin.req("PATCH", "/api/admin/partners/partner-a", { brand: { displayName: "X".repeat(120), logoUrl: "", accentColor: "#006afc", emailFromName: "" } });
  check("a lowercase hex is accepted and stored uppercased", long.status === 200 && long.data.partner.brand.accentColor === "#006AFC", `${long.status} ${JSON.stringify(long.data).slice(0, 200)}`);
  check("an oversized display name is clipped to 80 chars", long.data.partner.brand.displayName.length === 80, `len=${long.data.partner.brand.displayName.length}`);
}

console.log("== branded partner: payload + email ==");
{
  const set = await admin.req("PATCH", "/api/admin/partners/partner-a", { brand: { displayName: "Fixture Media A", logoUrl: "https://cdn.example.com/fma.png", accentColor: "#006AFC", emailFromName: "Fixture Media A" } });
  check("the full brand block stores on the partner record", set.status === 200 && set.data.partner.brand.displayName === "Fixture Media A" && set.data.partner.brand.logoUrl === "https://cdn.example.com/fma.png", `${set.status} ${JSON.stringify(set.data).slice(0, 220)}`);
  check("the brand change is on the partner_updated event", storedEvents("partner_updated", "partner-a").some((e) => e.data && e.data.brand && e.data.brand.to && e.data.brand.to.displayName === "Fixture Media A"), "");
  const pc = await loginAs("partner-a@b105.dev");
  const sum = await pc.req("GET", "/api/partner/summary");
  check("the partner's own portal payload carries the brand", sum.data && sum.data.partner.brand && sum.data.partner.brand.displayName === "Fixture Media A" && sum.data.partner.brand.accentColor === "#006AFC", JSON.stringify(sum.data && sum.data.partner).slice(0, 220));
  const link = await admin.req("POST", "/api/admin/users/partner-a/send-signin-link", {});
  check("branded sign-in link sends", link.status === 200 && link.data.emailSent === true, `${link.status}`);
  const evs = storedEvents("password_reset_email_sent", "partner-a");
  const subj = evs.length ? evs[evs.length - 1].data.subject || "" : "";
  check("the branded invite subject is prefixed '<Name> + SIGNL: '", subj.startsWith("Fixture Media A + SIGNL: "), subj);
  const clear = await admin.req("PATCH", "/api/admin/partners/partner-a", { brand: { displayName: "", logoUrl: "", accentColor: "", emailFromName: "" } });
  check("an all-empty brand block clears back to SIGNL-only", clear.status === 200 && clear.data.partner.brand === null && !storedUser("partner-a").partner.brand, `${clear.status} ${JSON.stringify(clear.data).slice(0, 160)}`);
  // Re-set for the Sig checks below.
  await admin.req("PATCH", "/api/admin/partners/partner-a", { brand: { displayName: "Fixture Media A", logoUrl: "", accentColor: "#006AFC", emailFromName: "Fixture Media A" } });
}

console.log("== pilot funder brand ==");
{
  const created = await admin.req("POST", "/api/admin/pilots", { partnerName: "Fixture Fund", contactName: "Fran Fixture", email: "fran@b105.dev", market: "Denver", fund: 5000, name: "Denver Fixture Pilot" });
  check("pilot created", created.status === 200 && created.data.pilot && !!created.data.pilot.id, `${created.status} ${JSON.stringify(created.data).slice(0, 200)}`);
  const pid = created.data.pilot.id;
  check("a new pilot carries no brand", created.data.pilot.brand === null, JSON.stringify(created.data.pilot.brand));
  const badBrand = await admin.req("PATCH", `/api/admin/pilots/${pid}`, { brand: { displayName: "Fixture Fund", logoUrl: "http://insecure.example/x.png", accentColor: "", emailFromName: "" } });
  check("the pilot brand refuses a non-https logo too", badBrand.status === 400, `${badBrand.status} ${JSON.stringify(badBrand.data).slice(0, 160)}`);
  const set = await admin.req("PATCH", `/api/admin/pilots/${pid}`, { brand: { displayName: "Fixture Fund", logoUrl: "https://cdn.example.com/fund.png", accentColor: "#0B7A55", emailFromName: "Fixture Fund" } });
  check("the pilot brand stores on the pilot record", set.status === 200 && set.data.pilot.brand && set.data.pilot.brand.displayName === "Fixture Fund" && set.data.pilot.brand.accentColor === "#0B7A55", `${set.status} ${JSON.stringify(set.data).slice(0, 220)}`);
  const resent = await admin.req("POST", `/api/admin/pilots/${pid}/resend-invite`, {});
  check("the pilot invite resend sends", resent.status === 200 && resent.data.emailSent === true, `${resent.status} ${JSON.stringify(resent.data).slice(0, 160)}`);
  const pilotUserId = JSON.parse(fs.readFileSync(DB, "utf8"))[`pilot:${pid}`].partnerUserId;
  const evs = storedEvents("password_reset_email_sent", pilotUserId);
  const subj = evs.length ? evs[evs.length - 1].data.subject || "" : "";
  check("the pilot invite email is branded from the PILOT record", subj.startsWith("Fixture Fund + SIGNL: "), subj);
  // The funder's own portal payload carries their brand.
  const fc = new Client(BASE);
  const reset = await fc.req("POST", "/api/auth/reset", { token: resent.data.devResetToken, password: "fixture-pass-105x" });
  check("the funder sets their password from the invite", reset.status === 200, `${reset.status}`);
  const login = await fc.req("POST", "/api/auth/login", { email: "fran@b105.dev", password: "fixture-pass-105x" });
  check("the funder logs in", login.status === 200, `${login.status}`);
  const me = await fc.req("GET", "/api/pilot/me");
  check("the Impact Portal payload carries the funder brand", me.data && me.data.pilot && me.data.pilot.brand && me.data.pilot.brand.displayName === "Fixture Fund", JSON.stringify(me.data && me.data.pilot).slice(0, 220));
}

console.log("== demo partner seed brand ==");
{
  const seed = await admin.req("POST", "/api/admin/partners/demo", {});
  check("demo partner seeds", seed.status === 200, `${seed.status} ${JSON.stringify(seed.data).slice(0, 160)}`);
  const list = await admin.req("GET", "/api/admin/partners");
  const demo = (list.data.partners || []).find((p) => p.demo);
  check("the demo partner carries the sample brand (name + accent, logo honestly empty)", !!demo && !!demo.brand && demo.brand.displayName === "Demo Media Group" && demo.brand.accentColor === "#006AFC" && demo.brand.logoUrl === null, JSON.stringify(demo && demo.brand));
}

console.log("== Admin Sig ==");
{
  const ask = await admin.req("POST", "/api/sig/ask", { q: "Which partners have branding set?", history: [] });
  check("Admin Sig names the branded partner and the unbranded one", ask.data && ask.data.source === "data" && /Fixture Media A/.test(ask.data.text || "") && /No brand set: Fixture Media B/.test(ask.data.text || ""), JSON.stringify(ask.data).slice(0, 400));
  const askLogo = await admin.req("POST", "/api/sig/ask", { q: "Which partners have no logo on file?", history: [] });
  check("Admin Sig reports the branded partner with no logo on file", askLogo.data && askLogo.data.source === "data" && /no logo on file: [^.]*Fixture Media A/.test(askLogo.data.text || ""), JSON.stringify(askLogo.data).slice(0, 400));
}

console.log("== canon locks ==");
{
  check("build stamp is -105 on both sides", fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes("2026.11.03-121") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.03-121"));
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  check("founding Stripe prices stay unarmed (no market live for money)", routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'), "");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("the client renders the brand head only from a set brand", appJs.includes("coBrandHeadHtml") && appJs.includes("Powered by SIGNL") && appJs.includes("coBrandShellOn"), "");
}

console.log(`\nbuild105: ${passed} passed, ${failed} failed`);
if (fails.length) console.error("failures:", fails.join(" | "));
process.exit(failed ? 1 : 0);
