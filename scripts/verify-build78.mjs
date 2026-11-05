#!/usr/bin/env node
// verify-build78.mjs — Build -78: the SIG CLEAN-EXECUTION pass
// (Jeff, from the Cirqle screenshot: "We need to make sure Sig
// works this cleanly for businesses and for creators.")
//
// The pattern under test: one plain-words request EXECUTES.
// (1) A confirmation line states what was found and SIGNL's
// ranking basis (how local the audience is — never ROAS, never
// follower-count ranking), then (2) ranked result cards with
// photos, the key metric first, and a working action button on
// each card, and (3) the Sig home greets with the asker's real
// live state from the sigdata layer.
//
// This suite proves, against the live server:
//   - source: the card renderers, the local-reach sort, the
//     basis line, the creator earn flow, /sig/home wiring and
//     the greeting all ship in the client; sigdata exports the
//     home-state builder; the router serves /sig/home.
//   - business find: discover (the exact endpoint and payload
//     the Sig card run reads) returns real Nashville cards with
//     photos, local % and totals, and the local-reach leader is
//     computable from the returned data (95% local demo creator
//     leads the demo set on local share).
//   - invite from a Sig card = the founding draft: a direct
//     invite POSTed the way the card's Invite path ends up
//     (through the B1 flow) lands as status "draft", and the
//     /sig/home draft chip flips on.
//   - campaign-draft request: POST /offers (what "draft a
//     campaign" commits) creates the draft; /sig/home answers
//     "1 draft in progress" and the visits chip stays true.
//   - founding fencing inside Sig: a non-allowlisted business
//     never sees a demo creator in discover (the card source),
//     and a Save attempt on a demo creator 404s; the
//     allowlisted viewer (Chelsea Friday Furniture, exact name)
//     sees the demo set with photos.
//   - creator side: /sig/home chips carry the creator's real
//     state (Momentum, profile state); the deterministic
//     answerer still answers number-first; the offer/finish/
//     earn card paths ship in source.
//   - admin: /sig/home returns no chips (read-only console Sig).
//   - stamp reads 2026.11.05-132 in build.js + index.html.
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
  check("stamp: build id is 2026.11.05-132", read("netlify/functions/lib/build.js").includes('"2026.11.05-132"') && read("public/index.html").includes("2026.11.05-132"));
  check("source: confirmation line states the local-audience ranking basis", app.includes("ranked by how local their audience is"));
  check("source: creator cards render with the local metric first", app.includes("sigCreatorCardHtml") && app.includes("sig-ccard-local") && app.includes("total followers"));
  check("source: cards sort by local share, not followers", app.includes("sigLocalPct(b) - sigLocalPct(a)"));
  check("source: card actions are wired in the thread", app.includes("data-sigcard") && app.includes("sigCardsHtmlFor"));
  check("source: plain-request criteria parse (food creators near me)", app.includes("sigB2ParseCrit") && app.includes("sigB2FlowStart"));
  check("source: who-should-I-invite runs the ranked find", app.includes('"who should i invite"'));
  check("source: draft-a-campaign phrasing routes to the campaign flow", app.includes('"draft a campaign"'));
  check("source: offer cards with Apply and Pass ship", app.includes("sigOfferCardHtml") && app.includes("sigC1Pass"));
  check("source: creator earn flow reads real records", app.includes("sigC5Run") && app.includes("/me/performance-readout") && app.includes("/license-requests"));
  check("source: Sig home greeting + pick-up line ship", app.includes('"/sig/home"') && app.includes("Where should we pick up?") && app.includes("sigCreatorStartersHtml"));
  check("source: sigdata builds home chips from the fact sheet", sigdata.includes("buildHomeState") && sigdata.includes("in progress"));
  check("source: router serves GET /sig/home", router.includes('seg[1] === "home"') && router.includes("buildHomeState"));
}

// ---------- server ----------
const PORT = 8978;
const DB = path.join(os.tmpdir(), `signl-b78-${Date.now()}.json`);
const env = {
  ...process.env, PORT: String(PORT), SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB,
  SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1",
  ADMIN_EMAIL: "admin@fixtures.dev", ADMIN_PASSWORD: "fixture-admin-pass",
  SESSION_SECRET: "b78-fixture-secret",
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
  // A plain founding business (never demo-allowlisted) and the
  // allowlisted demo viewer (exact-name rule, Builds -67/-74).
  const plain = await registerBusiness("plain78@fixtures.dev", "Riverfront Outfitters");
  const chelsea = await registerBusiness("chelsea78@fixtures.dev", "Chelsea Friday Furniture");
  check("both businesses register", plain.r.status === 201 && chelsea.r.status === 201, `plain=${plain.r.status} chelsea=${chelsea.r.status}`);
  for (const b of [plain, chelsea]) await admin.req("POST", "/api/admin/review", { userId: b.r.data.user.id, decision: "approve" });

  // A real Nashville creator with a Food & Drink card profile.
  const casey = new Client();
  const cr = await casey.req("POST", "/api/auth/register", {
    email: "casey78@fixtures.dev", password: "fixture-pass-1", name: "Casey Rivers", role: "creator",
    handle: "casey78", followerCount: 3000, localAudiencePct: 80, categories: ["Food & Drink"],
    city: "Nashville", market: "Nashville",
    agreedAge18: true, agreedTerms: true, agreedPromoUse: true, agreedNoGuarantee: true, agreedContentRights: true,
  });
  check("real creator registers", cr.status === 201, `status=${cr.status} ${JSON.stringify(cr.data).slice(0, 140)}`);
  await admin.req("POST", "/api/admin/review", { userId: cr.data.user.id, decision: "approve" });
  await casey.req("PATCH", "/api/me/profile", { paidRate: 120, licensingFee: 40, categories: ["Food & Drink"], ageConfirmed: true });

  const load = await admin.req("POST", "/api/admin/demo-showcase/load", {});
  check("demo showcase loads", load.status === 200, `status=${load.status}`);

  // --- deterministic answers still number-first ---
  {
    const ask = await plain.c.req("POST", "/api/sig/ask", { q: "how many visits do i have left" });
    check("deterministic answerer: visits answer leads with the number", ask.status === 200 && ask.data.source === "data" && /^\s*5\b/.test(String(ask.data.text || "")), `status=${ask.status} ${JSON.stringify(ask.data).slice(0, 160)}`);
    const askC = await casey.req("POST", "/api/sig/ask", { q: "how many momentum points do i have" });
    check("deterministic answerer: creator momentum leads with the number", askC.status === 200 && askC.data.source === "data" && /^\s*\d+\s+Momentum points/.test(String(askC.data.text || "")), `status=${askC.status} ${JSON.stringify(askC.data).slice(0, 160)}`);
    const askR = await casey.req("POST", "/api/sig/ask", { q: "what is my rate and my licensing fee" });
    check("deterministic answerer: rate answer carries the stored licensing fee (licensingFee field)", askR.status === 200 && askR.data.source === "data" && String(askR.data.text || "").includes("$120") && String(askR.data.text || "").includes("$40"), `status=${askR.status} ${JSON.stringify(askR.data).slice(0, 200)}`);
  }

  // --- Sig home: business chips are the real state ---
  {
    const home = await plain.c.req("GET", "/api/sig/home");
    const chips = (home.data && home.data.chips) || [];
    check("business /sig/home: founding chip + true counts only", home.status === 200 && home.data.displayName === "Riverfront Outfitters"
      && chips.some((x) => x.includes("Founding list"))
      && chips.some((x) => x.includes("5 visits left"))
      && chips.some((x) => x.includes("1 creator on your Nashville roster"))
      && !chips.some((x) => /draft/.test(x)), `status=${home.status} chips=${JSON.stringify(chips)}`);
  }

  // --- founding fencing inside Sig's card source ---
  let demoId = null;
  {
    const d = await plain.c.req("GET", "/api/discover?market=Nashville");
    const handles = ((d.data && d.data.creators) || []).map((c) => (c.profile || {}).handle);
    check("fencing: plain business discover has the real creator and zero demo people", d.status === 200 && handles.includes("casey78") && !handles.some((h) => DEMO_HANDLES.includes(h)), `handles=${JSON.stringify(handles)}`);
    const dc = await chelsea.c.req("GET", "/api/discover?market=Nashville");
    const cards = (dc.data && dc.data.creators) || [];
    const demoCards = cards.filter((c) => DEMO_HANDLES.includes((c.profile || {}).handle));
    const eli = cards.find((c) => (c.profile || {}).handle === "elithackereats");
    demoId = eli && eli.userId;
    check("allowlisted business sees the demo set with photos and local %", dc.status === 200 && demoCards.length === 12 && !!eli && eli.profile.localAudiencePct === 95 && !!eli.photoUrl, `demo=${demoCards.length} eli=${JSON.stringify(eli && eli.profile)}`);
    const leader = demoCards.slice().sort((a, b) => ((Number((b.profile || {}).localAudiencePct) || 0) - (Number((a.profile || {}).localAudiencePct) || 0)) || ((Number(b.totalAudience) || 0) - (Number(a.totalAudience) || 0)))[0];
    check("local-share ranking is computable from card data (95% local leads)", !!leader && (leader.profile || {}).localAudiencePct === 95, `leader=${leader && leader.profile.handle}`);
    const fav = await plain.c.req("POST", "/api/favorites", { creatorId: demoId });
    check("fencing: Save on a demo creator refuses for a non-allowlisted business", fav.status === 404, `status=${fav.status}`);
  }

  // --- invite from a Sig card lands as a draft invite ---
  {
    const inv = await chelsea.c.req("POST", "/api/offers", { title: "Card invite", whatComped: "Brunch for two on us", kind: "comp", dollarCap: 80, spots: 1, creatorId: cr.data.user.id, draft: false });
    check("invite from a Sig card lands as a draft invite (founding law)", inv.status === 201 && inv.data.offer && inv.data.offer.status === "draft", `status=${inv.status} ${JSON.stringify(inv.data).slice(0, 160)}`);
    const toDemo = await chelsea.c.req("POST", "/api/offers", { title: "Demo invite", whatComped: "A meal on us", kind: "comp", dollarCap: 75, spots: 1, creatorId: demoId, draft: true });
    check("fencing: an invite aimed at a demo creator is refused (demo people are look-only)", toDemo.status === 400, `status=${toDemo.status} ${JSON.stringify(toDemo.data).slice(0, 140)}`);
  }

  // --- campaign-draft request creates the draft ---
  {
    const o = await plain.c.req("POST", "/api/offers", { title: "Slow Tuesday campaign", whatComped: "Dinner for two on us", kind: "comp", dollarCap: 90, spots: 2, draft: false });
    check("campaign-draft request creates a real draft", o.status === 201 && o.data.offer && o.data.offer.status === "draft", `status=${o.status}`);
    const home = await plain.c.req("GET", "/api/sig/home");
    const chips = (home.data && home.data.chips) || [];
    check("/sig/home reflects the new draft and the untouched visits", chips.some((x) => x.includes("1 draft in progress")) && chips.some((x) => x.includes("5 visits left")), `chips=${JSON.stringify(chips)}`);
  }

  // --- creator Sig home state ---
  {
    const home = await casey.req("GET", "/api/sig/home");
    const chips = (home.data && home.data.chips) || [];
    check("creator /sig/home: Momentum and profile state from real records", home.status === 200 && home.data.displayName === "Casey"
      && chips.some((x) => x.includes("Momentum points"))
      && chips.some((x) => x.includes("Profile")), `status=${home.status} chips=${JSON.stringify(chips)}`);
    const offers = await casey.req("GET", "/api/offers");
    check("creator offers read (the C1 card source) returns cleanly", offers.status === 200 && Array.isArray(offers.data.offers), `status=${offers.status}`);
  }

  // --- admin stays read-only ---
  {
    const home = await admin.req("GET", "/api/sig/home");
    check("admin /sig/home: no chips, read-only", home.status === 200 && home.data.role === "admin" && (home.data.chips || []).length === 0, `status=${home.status} ${JSON.stringify(home.data).slice(0, 120)}`);
  }
} catch (e) {
  check("suite completed without throwing", false, String(e && e.stack || e).slice(0, 400));
} finally {
  srv.kill("SIGTERM");
  try { fs.rmSync(DB, { force: true }); } catch (e) { /* ignore */ }
}
console.log(`\nverify-build78: ${pass} passed, ${fail} failed`);
if (failures.length) console.log("failures:", failures.join(" | "));
process.exit(fail ? 1 : 0);
