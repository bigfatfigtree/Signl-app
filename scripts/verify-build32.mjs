#!/usr/bin/env node
// BUILD 2026.10.29-32 verification (Jeff, 2026-10-29):
//   1) Menu of Moments: bootstrap carries the moment list; the
//      moment is stored on the business application and on
//      offers; the business PATCH validates it.
//   2) Apply by Conversation: the SAME register path files the
//      application with applicationSource "conversation"; the
//      form path reads "form".
//   3) Neighborhood Anchor: the first founding business in a
//      category + neighborhood carries the permanent badge in
//      Admin and on its own founding preview; the second does
//      not; a different neighborhood earns its own. No lockout:
//      the second business registers and reads normally.
//   4) Your Three Streets: creator PATCH stores up to 3 deduped
//      streets, NOT a completeness gate, and they ride the
//      book-me payload and the Local List payload.
//   5) Your Last Ad, Graded: client source carries the tool on
//      the app founding page and the site businesses page, with
//      the honest-arithmetic labels and the founding CTA.
// Run: node scripts/verify-build32.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8942;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = ["build32", "admin", "pass"].join("-");
const DB = path.join(os.tmpdir(), `signl-verify-build32-${Date.now()}.json`);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const SITE = path.join(ROOT, "..", "signl-site");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  async function call(method, p, body, headers) {
    const h = { ...(headers || {}) };
    if (body && typeof body === "object") h["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers: h, body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, data, headers: res.headers };
  }
  return call;
}

let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE },
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

async function makeBusiness(admin, { businessName, email, category, neighborhood, moment, applicationSource }) {
  const b = client();
  const reg = await b("POST", "/api/auth/register", {
    role: "business", name: "Owner " + businessName, businessName, email,
    password: "business-pass-123", market: "Richmond", city: "Richmond", category,
    planId: "self-service", neighborhood: neighborhood || "", about: "",
    ...(moment ? { moment } : {}), ...(applicationSource ? { applicationSource } : {}),
    agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
  return { client: b, id: reg.data.user.id, user: reg.data.user };
}

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const anon = client();

  // ---------- 1) moments in bootstrap ----------
  const boot = await anon("GET", "/api/bootstrap");
  const moments = (boot.data && boot.data.moments) || [];
  check("moments: bootstrap carries the six moments with their play names",
    moments.length === 6 && moments.some((m) => m.id === "slow_weeknight" && m.play === "The Slow Tuesday Fix") && moments.some((m) => m.id === "tourist_weekend" && m.play === "The Tourist Weekend"),
    JSON.stringify(moments).slice(0, 240));

  // ---------- 2) application source + moment on the record ----------
  const formBiz = await makeBusiness(admin, { businessName: "Form Foods", email: "form@fixtures.dev", category: "Restaurant", neighborhood: "Lakeside", moment: "slow_weeknight" });
  check("apply: the form path stamps applicationSource 'form'",
    formBiz.user.business.applicationSource === "form", JSON.stringify(formBiz.user.business).slice(0, 240));
  check("moments: the application moment is stored on the business record",
    formBiz.user.business.moment === "slow_weeknight", JSON.stringify(formBiz.user.business).slice(0, 240));
  const convoBiz = await makeBusiness(admin, { businessName: "Convo Cafe", email: "convo@fixtures.dev", category: "Coffee & Bakery", neighborhood: "Lakeside", applicationSource: "conversation" });
  check("apply by conversation: the same register path stamps applicationSource 'conversation' on the same record shape",
    convoBiz.user.business.applicationSource === "conversation" && convoBiz.user.business.accessState === "founding" && !!convoBiz.user.business.plan,
    JSON.stringify(convoBiz.user.business).slice(0, 240));
  const bogusBiz = await makeBusiness(admin, { businessName: "Bogus Books", email: "bogus@fixtures.dev", category: "Retail", neighborhood: "", moment: "whenever" });
  check("moments: an unknown moment on the application stores null, never the raw string",
    bogusBiz.user.business.moment === null, JSON.stringify(bogusBiz.user.business).slice(0, 200));

  // ---------- business PATCH moment discipline ----------
  const setM = await formBiz.client("PATCH", "/api/me/profile", { moment: "game_day" });
  check("moments: the business PATCH sets a valid moment", setM.status === 200 && setM.data.user.business.moment === "game_day", JSON.stringify(setM.data).slice(0, 200));
  const keepM = await formBiz.client("PATCH", "/api/me/profile", { moment: "bogus" });
  check("moments: an invalid PATCH moment is ignored and the stored value kept", keepM.status === 200 && keepM.data.user.business.moment === "game_day", JSON.stringify(keepM.data).slice(0, 200));
  const clearM = await formBiz.client("PATCH", "/api/me/profile", { moment: null });
  check("moments: a null PATCH moment clears the standing moment", clearM.status === 200 && !("moment" in (clearM.data.user.business || {})) || (clearM.data.user.business || {}).moment == null, JSON.stringify(clearM.data).slice(0, 200));

  // ---------- 3) Neighborhood Anchor ----------
  const anchorA = await makeBusiness(admin, { businessName: "Anchor Ale House", email: "anchora@fixtures.dev", category: "Bar", neighborhood: "Downtown" });
  const anchorB = await makeBusiness(admin, { businessName: "Second Saloon", email: "anchorb@fixtures.dev", category: "Bar", neighborhood: "Downtown" });
  const anchorC = await makeBusiness(admin, { businessName: "Uptown Bar", email: "anchorc@fixtures.dev", category: "Bar", neighborhood: "Uptown" });
  const apps = await admin("GET", "/api/admin/applications");
  const everyone = [...(apps.data.pending || []), ...(apps.data.decided || [])];
  const byId = (id) => everyone.find((u) => u.id === id) || {};
  check("anchor: Admin sees the permanent badge on the FIRST founding business in the category + neighborhood",
    ((byId(anchorA.id).business || {}).anchor || {}).label === "Founding Anchor — Bar, Downtown",
    JSON.stringify((byId(anchorA.id).business || {}).anchor || null));
  check("anchor: the second business in the same category + neighborhood carries NO badge (and joined normally)",
    !((byId(anchorB.id).business || {}).anchor) && (byId(anchorB.id).business || {}).businessName === "Second Saloon",
    JSON.stringify((byId(anchorB.id).business || {})).slice(0, 200));
  check("anchor: a different neighborhood earns its own badge",
    ((byId(anchorC.id).business || {}).anchor || {}).label === "Founding Anchor — Bar, Uptown",
    JSON.stringify((byId(anchorC.id).business || {}).anchor || null));
  const prevA = await anchorA.client("GET", "/api/me/roster-preview");
  check("anchor: the founding preview returns viewerAnchor for the badge holder",
    prevA.status === 200 && ((prevA.data.viewerAnchor || {}).label === "Founding Anchor — Bar, Downtown"),
    JSON.stringify(prevA.data.viewerAnchor || null));
  const prevB = await anchorB.client("GET", "/api/me/roster-preview");
  check("anchor: the founding preview returns no anchor for the second business",
    prevB.status === 200 && !prevB.data.viewerAnchor, JSON.stringify(prevB.data).slice(0, 200));
  const apps2 = await admin("GET", "/api/admin/applications");
  const everyone2 = [...(apps2.data.pending || []), ...(apps2.data.decided || [])];
  const a2 = everyone2.find((u) => u.id === anchorA.id) || {};
  check("anchor: the stamp is permanent across recomputation (same label, same stamped time)",
    ((a2.business || {}).anchor || {}).label === "Founding Anchor — Bar, Downtown" && ((a2.business || {}).anchor || {}).at === ((byId(anchorA.id).business || {}).anchor || {}).at,
    JSON.stringify((a2.business || {}).anchor || null));

  // ---------- 4) Your Three Streets ----------
  const cr = client();
  const reg = await cr("POST", "/api/auth/register", {
    role: "creator", name: "Street Stella", email: "stella@fixtures.dev", password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle: "streetstella", followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"],
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  check("streets: creator fixture registers", reg.status === 201, JSON.stringify(reg.data).slice(0, 200));
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  const stSave = await cr("PATCH", "/api/me/profile", { streets: ["Granby Street", " 21st Street ", "Granby Street", "Colley Avenue", "One Too Many"], publicPage: true });
  check("streets: the PATCH stores at most 3, trimmed and deduped",
    stSave.status === 200 && JSON.stringify(stSave.data.user.creator.streets) === JSON.stringify(["Granby Street", "21st Street", "Colley Avenue"]),
    JSON.stringify(stSave.data.user && stSave.data.user.creator && stSave.data.user.creator.streets));
  const pubPage = await anon("GET", "/api/c/streetstella");
  check("streets: the book-me payload carries My streets",
    pubPage.status === 200 && JSON.stringify((pubPage.data.profile || {}).streets) === JSON.stringify(["Granby Street", "21st Street", "Colley Avenue"]),
    JSON.stringify(pubPage.data).slice(0, 260));
  const ll = await anon("GET", "/api/public/local-list?market=Richmond");
  const llEntry = ((ll.data.categories || []).flatMap((c) => c.creators || [])).find((c) => c.handle === "streetstella");
  check("streets: the Local List payload carries the streets for the opted-in creator",
    !!llEntry && JSON.stringify(llEntry.streets) === JSON.stringify(["Granby Street", "21st Street", "Colley Avenue"]),
    JSON.stringify(llEntry || null).slice(0, 260));
  const stClear = await cr("PATCH", "/api/me/profile", { streets: [] });
  check("streets: an empty save clears the list (the Sig/Home nudge returns)",
    stClear.status === 200 && JSON.stringify(stClear.data.user.creator.streets) === JSON.stringify([]),
    JSON.stringify(stClear.data.user.creator.streets));

  // ---------- 5) offer moment (needs a live market + active business) ----------
  await admin("POST", "/api/admin/review", { userId: formBiz.id, decision: "approve" });
  const act = await admin("POST", "/api/admin/businesses/activate", { userId: formBiz.id });
  check("setup: admin activates the form business", act.status === 200, JSON.stringify(act.data).slice(0, 160));
  const toggle = await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });
  check("setup: Richmond flips live", toggle.status === 200 && toggle.data.live === true, JSON.stringify(toggle.data).slice(0, 120));
  const offerRes = await formBiz.client("POST", "/api/offers", { title: "Game Day Wings Night", whatComped: "Wings for two on us", includes: "Wings for two", spots: 2, dollarCap: 100, covers: 2, moment: "game_day" });
  check("moments: an offer created with a moment stores it on the record",
    offerRes.status === 201 && offerRes.data.offer.moment === "game_day", JSON.stringify(offerRes.data).slice(0, 240));
  const offerBogus = await formBiz.client("POST", "/api/offers", { title: "Quiet Tuesday Tasting", whatComped: "Tasting for two on us", includes: "Tasting for two", spots: 1, dollarCap: 80, covers: 2, moment: "whenever" });
  check("moments: an offer with an unknown moment stores null, never the raw string",
    offerBogus.status === 201 && offerBogus.data.offer.moment === null, JSON.stringify(offerBogus.data).slice(0, 240));
  const myOffers = await formBiz.client("GET", "/api/offers");
  const listed = (myOffers.data.offers || myOffers.data || []).find ? (myOffers.data.offers || []).find((o) => o.id === (offerRes.data.offer || {}).id) : null;
  check("moments: the moment reads back on the business's offer list",
    !!listed && listed.moment === "game_day", JSON.stringify(myOffers.data).slice(0, 240));

  // ---------- 6) client + site source contracts ----------
  const appSrc = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const srcChecks = [
    ["client: the First Month Plan names its play (The Slow Tuesday Fix ships in the moment list)", appSrc.includes("The Slow Tuesday Fix")],
    ["client: the founding page asks the moment (picker on the First Month Plan)", appSrc.includes("What is this first month about?")],
    ["client: Your Last Ad, Graded renders on the founding page", appSrc.includes("Your last ad, graded") && appSrc.includes("gradeLastAd")],
    ["client: the grading verdicts are honest restatements, no projections", appSrc.includes("Grade: unproven") && appSrc.includes("It is not a projection of results")],
    ["client: Apply by Conversation ships (chat files through the register path)", appSrc.includes("Apply by conversation") && appSrc.includes('applicationSource: "conversation"')],
    ["client: the join form carries the moment select", appSrc.includes('id="jb-moment"')],
    ["client: the composer asks the moment", appSrc.includes('name="o2-moment"') && appSrc.includes("payload.moment")],
    ["client: the anchor badge renders from viewerAnchor", appSrc.includes("viewerAnchor") && appSrc.includes("Founding Anchor")],
    ["client: anchor copy states the no-lockout truth", appSrc.includes("It never blocks anyone")],
    ["client: three streets field + save + Sig nudge ship", appSrc.includes("Your three streets") && appSrc.includes('"p-street-"') && appSrc.includes("cr_streets")],
    ["client: My streets renders on the public profile", appSrc.includes("My streets:")],
  ];
  for (const [name, ok] of srcChecks) check(name, ok);
  const bizSite = fs.readFileSync(path.join(SITE, "businesses.html"), "utf8");
  check("site: Your Last Ad, Graded ships on businesses.html with the founding application CTA",
    bizSite.includes("gradeLastAdSite") && bizSite.includes("Your last ad,") && bizSite.includes("Apply for a founding spot"),
    "businesses.html missing the widget");
  for (const f of ["local-list-virginia-beach.html", "local-list-nashville.html", "local-list-miami.html", "local-list-denver.html"]) {
    const pageSrc = fs.readFileSync(path.join(SITE, f), "utf8");
    check(`site: ${f} renders My streets from the payload`, pageSrc.includes("My streets:") && pageSrc.includes("c.streets"));
  }

  console.log(`\nverify-build32: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
} catch (e) {
  console.error("verify-build32 crashed:", e);
  process.exitCode = 1;
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
