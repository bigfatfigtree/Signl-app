#!/usr/bin/env node
// verify-build81.mjs — Build -81: SIG ANSWERS ARE FULLY LINKED
// (Jeff, 2026-11-02, from Chelsea's Sig view: creator cards
// showed Invite/Save, but "you should be able to just go to the
// profile and see them all"; generalized: "needs to be the
// case for any answer Sig has — if it's giving something to
// show, it needs to have all necessary links.").
//
// Proved here:
//   - source: creator cards carry data-sigprofile (the card
//     body is the walk to the full profile, same destination
//     as a Discover tap) with a visible "View profile"
//     affordance; the wire handler navigates via
//     openCreatorProfile and never fires when the tap lands
//     on Invite/Save (the data-sigcard guard); offer cards
//     carry data-sigoffer to the creator Offers tab (Invited
//     segment for a direct invite); sigLinkGo maps every
//     sigdata destination key; home chips render as walks;
//     B1's success action jumps to the created offer; B3
//     carries a Results walk; sigdata exports the linked
//     answerer and the router passes the link through.
//   - live links: business numbers digest -> biz-results;
//     business roster answer -> biz-discover; creator numbers
//     digest -> cr-numbers; creator rate answer -> cr-profile;
//     admin needs-attention -> admin-applications (the
//     console's OWN tab; console Sig stays read-only); admin
//     overdue answer -> admin-compliance.
//   - plain facts stay plain: visits-left, momentum total and
//     a bare admin count return NO link (no fake links).
//   - fencing unchanged: the demo card a Sig tap would open
//     carries the same userId Discover hands the allowlisted
//     viewer, and a non-allowlisted business still never
//     receives demo people at all.
//   - stamp reads 2026.11.02-82 in build.js + index.html.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, extra = "") {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ---------- source ----------
{
  const app = read("public/app.js");
  const sigdata = read("netlify/functions/lib/sigdata.js");
  const router = read("netlify/functions/lib/router.js");
  const css = read("public/theme-v2.css");
  check("stamp: build id is 2026.11.02-82", read("netlify/functions/lib/build.js").includes('"2026.11.02-82"') && read("public/index.html").includes("2026.11.02-82"));
  check("source: creator card body carries the profile walk (data-sigprofile + View profile)", app.includes('data-sigprofile="${esc(c.userId)}"') && app.includes("sig-ccard-view") && app.includes("View profile"));
  check("source: card tap navigates via openCreatorProfile (the Discover door)", app.includes('querySelectorAll("[data-sigprofile]")') && app.includes("openCreatorProfile(uid)"));
  check("source: the profile door finds Sig's cohort even before Discover opens (sigOpData fallback)", app.includes("state.sigOpData && state.sigOpData.cards"));
  check("source: Invite/Save keep their own tap (data-sigcard guard before navigating)", app.includes('ev.target.closest("[data-sigcard]")') && app.includes('data-sigcard="${ti}:${ci}:invite"') && app.includes('data-sigcard="${ti}:${ci}:save"'));
  check("source: offer card body carries its walk (data-sigoffer, Invited segment for direct invites)", app.includes('data-sigoffer="${esc(p.mode || "")}"') && app.includes('state.crOffersSeg = "invited"') && app.includes("View offer"));
  check("source: sigLinkGo maps the destination keys for all three roles", app.includes("function sigLinkGo") && app.includes('"biz-results"') && app.includes('"cr-earnings"') && app.includes('"admin-applications"') && app.includes('"admin-partners"') && app.includes('"admin-compliance"'));
  check("source: admin walks land only on console tabs (no business/creator surface in the admin cases)", app.includes('case "admin-applications": return go("dashboard", "Applications")') && app.includes('case "admin-partners": return go("dashboard", "Partners")') && app.includes('case "admin-compliance": return go("dashboard", "Compliance")'));
  check("source: linked answers become the turn's action in the ask submit path", app.includes("pending.actions = [{ label: reply.link.label, primary: true"));
  check("source: home chips render as walks (data-sigchip + sigChipDest)", app.includes("data-sigchip") && app.includes("function sigChipDest"));
  check("source: B1 success jumps to the created offer", app.includes("jumpToOffer(created.id)"));
  check("source: B3 readout carries the Results walk", app.includes('ST("See Results", "Ver Resultados")'));
  check("source: cards and linked chips read as tappable (CSS)", css.includes(".sig-ccard[data-sigprofile]") && css.includes("cursor: pointer") && css.includes(".sig-chip-link"));
  check("source: sigdata linked answerer ships (linked helper + raw export)", sigdata.includes("function linked(") && sigdata.includes("answerFactsRaw") && sigdata.includes('"admin-applications"') && sigdata.includes('"biz-results"') && sigdata.includes('"cr-numbers"'));
  check("source: router passes the link through /sig/ask", router.includes("answerFactsRaw") && router.includes("dl ? { link: dl }"));
}

// ---------- server ----------
const PORT = 8981;
const DB = path.join(os.tmpdir(), `signl-b81-${Date.now()}.json`);
const env = {
  ...process.env, PORT: String(PORT), SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB,
  SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1",
  ADMIN_EMAIL: "admin@fixtures.dev", ADMIN_PASSWORD: "fixture-admin-pass",
  SESSION_SECRET: "b81-fixture-secret",
};
const srv = spawn(process.execPath, ["scripts/dev-server.mjs"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let srvLog = "";
srv.stdout.on("data", (d) => { srvLog += d; });
srv.stderr.on("data", (d) => { srvLog += d; });
const BASE = `http://127.0.0.1:${PORT}`;
class Client {
  constructor() { this.jar = new Map(); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    const cookie = [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get("set-cookie");
    if (sc) for (const part of sc.split(/,(?=[^;]+?=)/)) { const m = /^([^=]+)=([^;]*)/.exec(part.trim()); if (m) this.jar.set(m[1], m[2]); }
    let data = null; try { data = await res.json(); } catch (e) { /* not json */ }
    return { status: res.status, data };
  }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/api/bootstrap"); if (r.ok) return; } catch (e) { /* not up */ } await sleep(300); }
  throw new Error("server did not come up: " + srvLog.slice(-400));
}
const DEMO_HANDLES = ["tesstastestn", "wadehensleymusic", "priyaathome", "marcusbellshoots", "delladoes615", "colebrandtfit", "hannahandthem", "rubygetsglam", "elithackereats", "noraseesnashville", "samswhitfieldhome", "gracetembostyle"];

try {
  await waitUp();
  const admin = new Client();
  const al = await admin.req("POST", "/api/auth/login", { email: "admin@fixtures.dev", password: "fixture-admin-pass" });
  check("admin login", al.status === 200, `status=${al.status}`);

  async function registerBusiness(email, businessName) {
    const c = new Client();
    const r = await c.req("POST", "/api/auth/register", { role: "business", name: "Owner", businessName, email, password: "fixture-pass-1", market: "Nashville", category: "Retail", planId: "self-service", neighborhood: "East Nashville", about: "Fixture business.", agreedTerms: true });
    return { c, r };
  }
  const plain = await registerBusiness("plain81@fixtures.dev", "Riverfront Outfitters");
  const chelsea = await registerBusiness("chelsea81@fixtures.dev", "Chelsea Friday Furniture");
  check("both businesses register", plain.r.status === 201 && chelsea.r.status === 201, `plain=${plain.r.status} chelsea=${chelsea.r.status}`);
  for (const b of [plain, chelsea]) await admin.req("POST", "/api/admin/review", { userId: b.r.data.user.id, decision: "approve" });

  const casey = new Client();
  const cr = await casey.req("POST", "/api/auth/register", {
    email: "casey81@fixtures.dev", password: "fixture-pass-1", name: "Casey Rivers", role: "creator",
    handle: "casey81", followerCount: 3000, localAudiencePct: 80, categories: ["Food & Drink"],
    city: "Nashville", market: "Nashville",
    agreedAge18: true, agreedTerms: true, agreedPromoUse: true, agreedNoGuarantee: true, agreedContentRights: true,
  });
  check("real creator registers", cr.status === 201, `status=${cr.status} ${JSON.stringify(cr.data).slice(0, 140)}`);
  await admin.req("POST", "/api/admin/review", { userId: cr.data.user.id, decision: "approve" });
  await casey.req("PATCH", "/api/me/profile", { paidRate: 120, licensingFee: 40, categories: ["Food & Drink"], ageConfirmed: true });

  const load = await admin.req("POST", "/api/admin/demo-showcase/load", {});
  check("demo showcase loads", load.status === 200, `status=${load.status}`);

  // --- linked answers: business ---
  {
    const ask = await plain.c.req("POST", "/api/sig/ask", { q: "show me my numbers" });
    check("business numbers digest carries the Results walk", ask.status === 200 && ask.data.source === "data" && ask.data.link && ask.data.link.dest === "biz-results", `status=${ask.status} ${JSON.stringify(ask.data).slice(0, 200)}`);
    const roster = await plain.c.req("POST", "/api/sig/ask", { q: "who can i book in my market" });
    check("business roster answer carries the Discover walk", roster.status === 200 && roster.data.source === "data" && roster.data.link && roster.data.link.dest === "biz-discover", `status=${roster.status} ${JSON.stringify(roster.data).slice(0, 200)}`);
    const plain1 = await plain.c.req("POST", "/api/sig/ask", { q: "how many visits do i have left" });
    check("plain fact stays plain: visits-left carries NO link", plain1.status === 200 && plain1.data.source === "data" && !plain1.data.link, `status=${plain1.status} ${JSON.stringify(plain1.data).slice(0, 160)}`);
  }

  // --- linked answers: creator ---
  {
    const ask = await casey.req("POST", "/api/sig/ask", { q: "show me my numbers" });
    check("creator numbers digest carries the Your-numbers walk", ask.status === 200 && ask.data.source === "data" && ask.data.link && ask.data.link.dest === "cr-numbers", `status=${ask.status} ${JSON.stringify(ask.data).slice(0, 200)}`);
    const rate = await casey.req("POST", "/api/sig/ask", { q: "what is my rate and my licensing fee" });
    check("creator rate answer carries the Profile walk (rates live on Profile)", rate.status === 200 && rate.data.source === "data" && rate.data.link && rate.data.link.dest === "cr-profile", `status=${rate.status} ${JSON.stringify(rate.data).slice(0, 200)}`);
    const plain2 = await casey.req("POST", "/api/sig/ask", { q: "how many momentum points do i have" });
    check("plain fact stays plain: momentum total carries NO link", plain2.status === 200 && plain2.data.source === "data" && !plain2.data.link, `status=${plain2.status} ${JSON.stringify(plain2.data).slice(0, 160)}`);
  }

  // --- linked answers: admin (console's own tabs only) ---
  {
    const att = await admin.req("POST", "/api/sig/ask", { q: "what needs my attention" });
    check("admin needs-attention carries the Review queue walk (console's own tab)", att.status === 200 && att.data.source === "data" && att.data.link && att.data.link.dest === "admin-applications" && att.data.link.label === "Open the Review queue", `status=${att.status} ${JSON.stringify(att.data).slice(0, 220)}`);
    const od = await admin.req("POST", "/api/sig/ask", { q: "are any posts overdue" });
    check("admin overdue answer carries the Compliance walk", od.status === 200 && od.data.source === "data" && od.data.link && od.data.link.dest === "admin-compliance", `status=${od.status} ${JSON.stringify(od.data).slice(0, 200)}`);
    const cnt = await admin.req("POST", "/api/sig/ask", { q: "how many creators do we have in total" });
    check("plain fact stays plain: a bare admin count carries NO link", cnt.status === 200 && cnt.data.source === "data" && !cnt.data.link, `status=${cnt.status} ${JSON.stringify(cnt.data).slice(0, 160)}`);
  }

  // --- the card tap target is the Discover identity, fencing intact ---
  {
    const d = await plain.c.req("GET", "/api/discover?market=Nashville");
    const handles = ((d.data && d.data.creators) || []).map((c) => (c.profile || {}).handle);
    check("fencing: plain business discover has the real creator and zero demo people", d.status === 200 && handles.includes("casey81") && !handles.some((h) => DEMO_HANDLES.includes(h)), `handles=${JSON.stringify(handles)}`);
    const dc = await chelsea.c.req("GET", "/api/discover?market=Nashville");
    const cards = (dc.data && dc.data.creators) || [];
    const eli = cards.find((c) => (c.profile || {}).handle === "elithackereats");
    check("demo card carries the userId the Sig card tap opens (same id Discover uses)", !!eli && typeof eli.userId === "string" && eli.userId.length > 0, `eli=${JSON.stringify(eli && { userId: eli.userId })}`);
    const real = cards.find((c) => (c.profile || {}).handle === "casey81");
    check("real card in the same result set also carries its userId", !!real && real.userId === cr.data.user.id, `real=${JSON.stringify(real && { userId: real.userId })}`);
  }
} catch (e) {
  check("suite completed without a harness error", false, String(e && e.message || e));
} finally {
  srv.kill("SIGTERM");
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`\nverify-build81: ${pass} passed, ${fail} failed`);
if (failures.length) console.log("failures:\n - " + failures.join("\n - "));
process.exit(fail ? 1 : 0);
