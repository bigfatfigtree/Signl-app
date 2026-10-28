// Sig activation layer verification (Jeff, 2026-10-28).
//
// Proves the server half of Sig's proactive prompts:
//  1. The Discover musician filter's three modes (attribute,
//     perform, create) return exactly the cohorts Sig's idea
//     sentences count, and an unknown mode falls through
//     unfiltered.
//  2. businessHome's home.sigSignals equals the inventory of
//     the business's own market computed the way Discover
//     computes its roster — including absolute zeros in a
//     market with no matching inventory, which is what makes
//     the client suppress those prompts.
// Run: node scripts/verify-activation.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8951;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "test-admin-password-123";
const DB = path.join(os.tmpdir(), `signl-verify-activation-${Date.now()}.json`);
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

function creatorBody(overrides) {
  return {
    role: "creator",
    name: "Fixture Creator",
    email: "fixture@fixtures.dev",
    password: "password123",
    market: "Hampton Roads",
    city: "Virginia Beach",
    handle: "fixturecreator",
    followerCount: 4200,
    localAudiencePct: 64,
    categories: ["Food & Drink"],
    ...AGREE,
    ...overrides,
  };
}

async function seedCreator(admin, overrides) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", creatorBody(overrides));
  if (reg.status !== 201) throw new Error("creator seed failed: " + JSON.stringify(reg.data));
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  return { client: c, id: reg.data.user.id, handle: overrides.handle };
}

async function seedBusiness(admin, overrides) {
  const b = client();
  const reg = await b("POST", "/api/auth/register", {
    role: "business",
    name: "Fixture Owner",
    businessName: "Fixture Business",
    email: "biz@fixtures.dev",
    password: "password123",
    market: "Hampton Roads",
    city: "Norfolk",
    category: "Salon & Barbershop",
    planId: "growth",
    agreedTerms: true,
    ...overrides,
  });
  if (reg.status !== 201) throw new Error("business seed failed: " + JSON.stringify(reg.data));
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  const act = await admin("POST", "/api/admin/businesses/activate", { userId: reg.data.user.id });
  if (act.status !== 200) throw new Error("business activation failed: " + JSON.stringify(act.data));
  return { client: b, id: reg.data.user.id };
}

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  // ----- Hampton Roads roster: 2 students (same school), 3 musicians
  // (one perform, one create, one attribute-only), 1 Spanish creator.
  const stu1 = await seedCreator(admin, { name: "Student One", email: "stu1@fixtures.dev", handle: "studentone", university: "Old Dominion University", universityStatus: "Current student" });
  const stu2 = await seedCreator(admin, { name: "Student Two", email: "stu2@fixtures.dev", handle: "studenttwo", university: "Old Dominion University", universityStatus: "Current student" });
  const player = await seedCreator(admin, { name: "Live Player", email: "player@fixtures.dev", handle: "liveplayer" });
  await player.client("PATCH", "/api/me/profile", { musician: true, musicPerform: true });
  const maker = await seedCreator(admin, { name: "Track Maker", email: "maker@fixtures.dev", handle: "trackmaker" });
  await maker.client("PATCH", "/api/me/profile", { musician: true, musicCreate: true });
  const plain = await seedCreator(admin, { name: "Plain Musician", email: "plainm@fixtures.dev", handle: "plainmusician" });
  await plain.client("PATCH", "/api/me/profile", { musician: true });
  const habla = await seedCreator(admin, { name: "Habla Creador", email: "habla@fixtures.dev", handle: "hablacreador" });
  await habla.client("PATCH", "/api/me/profile", { spanishContent: true });

  // ----- Richmond: one plain creator, no musicians, no campus, no Spanish.
  const rich = await seedCreator(admin, { name: "Richmond Plain", email: "rich@fixtures.dev", handle: "richmondplain", market: "Richmond", city: "Richmond" });

  const spa = await seedBusiness(admin, { businessName: "Serenity Spa", email: "spa@fixtures.dev" });
  await spa.client("PATCH", "/api/me/profile", { about: "A calm day spa in Norfolk." });
  const richBiz = await seedBusiness(admin, { businessName: "Richmond Goods", email: "richbiz@fixtures.dev", market: "Richmond", city: "Richmond", category: "Retail" });
  const nashBiz = await seedBusiness(admin, { businessName: "Empty Market Bar", email: "nashbiz@fixtures.dev", market: "Nashville", city: "Nashville", category: "Bar" });

  // ---------- Discover musician modes ----------
  const all = await spa.client("GET", "/api/discover?market=Hampton%20Roads");
  check("unfiltered Discover returns the full Hampton Roads roster (6)", all.status === 200 && (all.data.creators || []).length === 6, JSON.stringify((all.data.creators || []).map((c) => c.handle)));
  const mus = await spa.client("GET", "/api/discover?market=Hampton%20Roads&musician=1");
  check("musician=1 returns exactly the 3 musician-flagged creators", mus.status === 200 && (mus.data.creators || []).length === 3 && [player.id, maker.id, plain.id].every((id) => (mus.data.creators || []).some((c) => c.userId === id)), JSON.stringify((mus.data.creators || []).map((c) => c.handle)));
  const perf = await spa.client("GET", "/api/discover?market=Hampton%20Roads&musician=perform");
  check("musician=perform returns only the live performer", perf.status === 200 && (perf.data.creators || []).length === 1 && perf.data.creators[0].userId === player.id, JSON.stringify(perf.data.creators));
  const cre = await spa.client("GET", "/api/discover?market=Hampton%20Roads&musician=create");
  check("musician=create returns only the music maker", cre.status === 200 && (cre.data.creators || []).length === 1 && cre.data.creators[0].userId === maker.id, JSON.stringify(cre.data.creators));
  const bogus = await spa.client("GET", "/api/discover?market=Hampton%20Roads&musician=bogus");
  check("an unknown musician mode falls through unfiltered", bogus.status === 200 && (bogus.data.creators || []).length === 6, JSON.stringify((bogus.data.creators || []).length));
  const richMus = await richBiz.client("GET", "/api/discover?market=Richmond&musician=1");
  check("musician=1 in a zero-musician market returns zero results (the prompt-suppression fact)", richMus.status === 200 && (richMus.data.creators || []).length === 0, JSON.stringify(richMus.data.creators));

  // ---------- sigSignals ----------
  const spaHome = await spa.client("GET", "/api/me/business-home");
  const s = spaHome.data && spaHome.data.home && spaHome.data.home.sigSignals;
  check("business home carries sigSignals", spaHome.status === 200 && !!s, JSON.stringify(spaHome.data).slice(0, 200));
  check("sigSignals roster counts the Discover roster (6)", !!s && s.roster === 6, JSON.stringify(s));
  check("sigSignals campus counts both badged students (2)", !!s && s.campus === 2, JSON.stringify(s));
  check("sigSignals campusTop names the largest cohort with its count", !!s && !!s.campusTop && s.campusTop.name === "Old Dominion University" && s.campusTop.count === 2, JSON.stringify(s && s.campusTop));
  check("sigSignals musician counts mirror the Discover modes (3 / 1 / 1)", !!s && s.musicians === 3 && s.musiciansPerform === 1 && s.musiciansCreate === 1, JSON.stringify(s));
  check("sigSignals spanish counts the Spanish-flagged creator (1)", !!s && s.spanish === 1, JSON.stringify(s));
  check("sigSignals fresh counts profiles completed within 14 days (all 6)", !!s && s.fresh === 6, JSON.stringify(s));

  const richHome = await richBiz.client("GET", "/api/me/business-home");
  const rs = richHome.data && richHome.data.home && richHome.data.home.sigSignals;
  check("zero-inventory market: roster 1 with musicians/campus/spanish all exactly 0", !!rs && rs.roster === 1 && rs.musicians === 0 && rs.musiciansPerform === 0 && rs.musiciansCreate === 0 && rs.campus === 0 && rs.spanish === 0 && rs.campusTop === null, JSON.stringify(rs));

  const nashHome = await nashBiz.client("GET", "/api/me/business-home");
  const ns = nashHome.data && nashHome.data.home && nashHome.data.home.sigSignals;
  check("empty market: every signal is 0 and campusTop is null", !!ns && ns.roster === 0 && ns.campus === 0 && ns.musicians === 0 && ns.spanish === 0 && ns.fresh === 0 && ns.campusTop === null, JSON.stringify(ns));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) console.log("failures:", failures.join(" | "));
  await stopServer();
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error("suite error:", err);
  await stopServer();
  process.exit(1);
}
