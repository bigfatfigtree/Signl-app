#!/usr/bin/env node
// BUILD 2026.10.29-33 verification (Jeff, 2026-10-29):
//   1) Portfolio Sample Post: ONE existing Instagram post,
//      validated, stored, and carried on the book-me payload
//      and the Local List, always labeled a sample.
//   2) Sig Writes Your Pitch: the draft is composed from the
//      creator's real record only (categories, local %, streets;
//      absent fields never appear); the saved line rides the
//      book-me payload.
//   3) Golden Ticket Invites: two named tickets per finished
//      creator; issuing is gated on a finished, approved
//      profile; the public landing read shows the seat held by
//      name; claiming through registration flips the ticket and
//      credits the issuer through referredBy; a foreign-market
//      or bogus ticket changes nothing; unused tickets read
//      expired once the market is live.
// Run: node scripts/verify-build33.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8943;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = ["build33", "admin", "pass"].join("-");
const DB = path.join(os.tmpdir(), `signl-verify-build33-${Date.now()}.json`);
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

async function makeCreator(admin, { name, email, handle, market = "Richmond", city = "Richmond", followers = 3200, localPct = 82, categories = ["Food & Drink"], approve = true, extra = {} }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market, city,
    handle, followerCount: followers, localAudiencePct: localPct, categories,
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
    ...extra,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  if (approve) await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  return { client: c, id: reg.data.user.id, handle, user: reg.data.user };
}

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const anon = client();

  // ---------- fixtures ----------
  const paula = await makeCreator(admin, { name: "Pitch Paula", email: "paula@fixtures.dev", handle: "pitchpaula" });
  await paula.client("PATCH", "/api/me/profile", { streets: ["Granby Street", "Colley Avenue"], publicPage: true });

  // ---------- 1) Portfolio Sample Post ----------
  const badSample = await paula.client("PATCH", "/api/me/profile", { portfolioSample: "https://example.com/not-a-post" });
  check("sample: a non-Instagram link is refused", badSample.status === 400, JSON.stringify(badSample.data).slice(0, 160));
  const goodSample = await paula.client("PATCH", "/api/me/profile", { portfolioSample: "https://www.instagram.com/reel/CxYz123AbC/" });
  check("sample: a real Instagram reel link saves, normalized",
    goodSample.status === 200 && goodSample.data.user.creator.portfolioSample === "https://www.instagram.com/reel/CxYz123AbC/",
    JSON.stringify(goodSample.data.user && goodSample.data.user.creator && goodSample.data.user.creator.portfolioSample));
  const pubPage = await anon("GET", "/api/c/pitchpaula");
  const ps = (pubPage.data.profile || {}).portfolioSample || {};
  check("sample: the book-me payload carries the sample with its embed URL",
    pubPage.status === 200 && ps.url === "https://www.instagram.com/reel/CxYz123AbC/" && typeof ps.embedUrl === "string" && ps.embedUrl.endsWith("embed"),
    JSON.stringify(ps));
  const ll = await anon("GET", "/api/public/local-list?market=Richmond");
  const llEntry = ((ll.data.categories || []).flatMap((c) => c.creators || [])).find((c) => c.handle === "pitchpaula");
  check("sample: the Local List payload carries the sample link",
    !!llEntry && llEntry.portfolioSample === "https://www.instagram.com/reel/CxYz123AbC/", JSON.stringify(llEntry || null).slice(0, 240));

  // ---------- 2) Sig Writes Your Pitch ----------
  const draftRes = await paula.client("GET", "/api/me/pitch-draft");
  const draft = (draftRes.data || {}).draft || "";
  check("pitch: Sig's draft is built from the real record (categories, local %, first street)",
    draftRes.status === 200 && draft.includes("Food & Drink") && draft.includes("82%") && draft.includes("Granby Street"),
    draft);
  const minimal = await makeCreator(admin, { name: "Minimal Mo", email: "mo@fixtures.dev", handle: "minimalmo", followers: 900, localPct: 82, categories: ["Lifestyle"] });
  await minimal.client("PATCH", "/api/me/profile", { localAudiencePct: null });
  const moDraft = await minimal.client("GET", "/api/me/pitch-draft");
  check("pitch: a record without local % or streets drafts a line with neither invented",
    moDraft.status === 200 && !((moDraft.data || {}).draft || "").includes("% of my audience") && !((moDraft.data || {}).draft || "").includes("Usually found"),
    JSON.stringify(moDraft.data));
  const pitchSave = await paula.client("PATCH", "/api/me/profile", { pitchLine: "Taco trucks and late nights, Richmond first." });
  check("pitch: the creator's own line saves through the profile PATCH",
    pitchSave.status === 200 && pitchSave.data.user.creator.pitchLine === "Taco trucks and late nights, Richmond first.",
    JSON.stringify(pitchSave.data.user && pitchSave.data.user.creator && pitchSave.data.user.creator.pitchLine));
  const pubPage2 = await anon("GET", "/api/c/pitchpaula");
  check("pitch: the saved line rides the book-me payload",
    (pubPage2.data.profile || {}).pitchLine === "Taco trucks and late nights, Richmond first.",
    JSON.stringify(pubPage2.data.profile && pubPage2.data.profile.pitchLine));

  // ---------- 3) Golden Ticket Invites ----------
  const unfinished = await makeCreator(admin, { name: "Pending Pete", email: "pete@fixtures.dev", handle: "pendingpete", approve: false });
  const gatedIssue = await unfinished.client("POST", "/api/me/golden-tickets", { name: "Someone" });
  check("tickets: an unfinished or unapproved creator cannot issue", gatedIssue.status === 400 || gatedIssue.status === 403, JSON.stringify(gatedIssue.data).slice(0, 200));
  const gt0 = await paula.client("GET", "/api/me/golden-tickets");
  check("tickets: a finished creator starts with two remaining and can issue",
    gt0.status === 200 && gt0.data.remaining === 2 && gt0.data.canIssue === true && (gt0.data.tickets || []).length === 0,
    JSON.stringify(gt0.data).slice(0, 200));
  const t1 = await paula.client("POST", "/api/me/golden-tickets", { name: "Best Friend Bea" });
  check("tickets: the first ticket issues with a claim link path",
    t1.status === 201 && t1.data.ticket.status === "issued" && t1.data.ticket.name === "Best Friend Bea" && (t1.data.ticket.linkPath || "").includes("ticket="),
    JSON.stringify(t1.data).slice(0, 240));
  const t2 = await paula.client("POST", "/api/me/golden-tickets", { name: "Second Seat Sam" });
  check("tickets: the second ticket issues", t2.status === 201, JSON.stringify(t2.data).slice(0, 160));
  const t3 = await paula.client("POST", "/api/me/golden-tickets", { name: "Third Wheel" });
  check("tickets: a third ticket is refused, the limit is two", t3.status === 400, JSON.stringify(t3.data).slice(0, 160));
  const ticketId = t1.data.ticket.id;
  const landing = await anon("GET", `/api/public/golden-ticket/${ticketId}`);
  check("tickets: the public landing read shows the seat held by name, with the issuer's handle and no other data",
    landing.status === 200 && landing.data.ticket.name === "Best Friend Bea" && landing.data.ticket.status === "issued" && landing.data.ticket.issuerHandle === "pitchpaula" && !("issuerId" in landing.data.ticket) && !("email" in landing.data.ticket),
    JSON.stringify(landing.data).slice(0, 240));
  const landing404 = await anon("GET", "/api/public/golden-ticket/nope-not-real");
  check("tickets: an unknown ticket reads 404", landing404.status === 404, JSON.stringify(landing404.data).slice(0, 120));

  // Claim through registration: referral credit rides referredBy.
  const bea = await makeCreator(admin, { name: "Bea Friend", email: "bea@fixtures.dev", handle: "beafriend", approve: false, extra: { goldenTicket: ticketId } });
  check("tickets: claiming registration credits the issuer through referredBy",
    bea.user.referredBy === "pitchpaula", JSON.stringify({ referredBy: bea.user.referredBy }));
  const gtAfter = await paula.client("GET", "/api/me/golden-tickets");
  const claimed = (gtAfter.data.tickets || []).find((t) => t.id === ticketId);
  check("tickets: the claimed ticket flips to claimed on the issuer's list",
    !!claimed && claimed.status === "claimed" && !!claimed.claimedAt, JSON.stringify(claimed || null));
  const landingAfter = await anon("GET", `/api/public/golden-ticket/${ticketId}`);
  check("tickets: the landing read shows claimed after the claim", landingAfter.data.ticket.status === "claimed", JSON.stringify(landingAfter.data).slice(0, 160));

  // A ticket from another market claims nothing.
  const nash = await makeCreator(admin, { name: "Nash Nate", email: "nate@fixtures.dev", handle: "nashnate", market: "Nashville", city: "Nashville", approve: false, extra: { goldenTicket: t2.data.ticket.id } });
  check("tickets: a Richmond ticket claimed from a Nashville sign-up changes nothing",
    nash.user.referredBy !== "pitchpaula", JSON.stringify({ referredBy: nash.user.referredBy || null }));
  const gtForeign = await paula.client("GET", "/api/me/golden-tickets");
  const samTicket = (gtForeign.data.tickets || []).find((t) => t.id === t2.data.ticket.id);
  check("tickets: the foreign-market ticket stays issued", !!samTicket && samTicket.status === "issued", JSON.stringify(samTicket || null));

  // A bogus ticket id never blocks a sign-up.
  const bogus = await makeCreator(admin, { name: "Bogus Bob", email: "bob@fixtures.dev", handle: "bogusbob", approve: false, extra: { goldenTicket: "deadbeef-not-a-ticket" } });
  check("tickets: a bogus ticket id never blocks a sign-up", !!bogus.id && bogus.user.referredBy !== "pitchpaula", JSON.stringify(bogus.user).slice(0, 160));

  // Quiet expiry at launch: flip Richmond live and the unclaimed ticket reads expired.
  const toggle = await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });
  check("setup: Richmond flips live", toggle.status === 200 && toggle.data.live === true, JSON.stringify(toggle.data).slice(0, 120));
  const gtLive = await paula.client("GET", "/api/me/golden-tickets");
  const samLive = (gtLive.data.tickets || []).find((t) => t.id === t2.data.ticket.id);
  const beaLive = (gtLive.data.tickets || []).find((t) => t.id === ticketId);
  check("tickets: an unused ticket reads expired once the market is live; a claimed one stays claimed",
    !!samLive && samLive.status === "expired" && !!beaLive && beaLive.status === "claimed",
    JSON.stringify(gtLive.data.tickets || []).slice(0, 300));
  const landingLive = await anon("GET", `/api/public/golden-ticket/${t2.data.ticket.id}`);
  check("tickets: the landing read agrees, expired at launch", landingLive.data.ticket.status === "expired", JSON.stringify(landingLive.data).slice(0, 160));

  // Clearing the sample works.
  const cleared = await paula.client("PATCH", "/api/me/profile", { portfolioSample: null });
  check("sample: clearing the sample stores null",
    cleared.status === 200 && cleared.data.user.creator.portfolioSample === null,
    JSON.stringify(cleared.data.user.creator.portfolioSample));

  // ---------- source contracts ----------
  const appSrc = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const srcChecks = [
    ["client: the portfolio sample is labeled, never a SIGNL visit", appSrc.includes("Portfolio sample") && appSrc.includes("A portfolio sample, not a SIGNL visit.")],
    ["client: the sample editor ships on the book-me panel", appSrc.includes("lane-sample") && appSrc.includes("laneSampleSave")],
    ["client: the pitch editor + Sig draft button ship", appSrc.includes("Draft it with Sig") && appSrc.includes("pitchDraftFill") && appSrc.includes('"/me/pitch-draft"')],
    ["client: the pitch line renders on the public page", appSrc.includes("p.pitchLine")],
    ["client: Golden Tickets render on the founding home with the held-by-name line", appSrc.includes("Your Golden Tickets") && appSrc.includes("Seat held for them")],
    ["client: registration carries the golden ticket", appSrc.includes("goldenTicket: storedTicket() || undefined")],
    ["client: the claim landing banner states the held seat by name", appSrc.includes("A founding seat is held for")],
  ];
  for (const [name, ok] of srcChecks) check(name, ok);
  for (const f of ["local-list-virginia-beach.html", "local-list-nashville.html", "local-list-miami.html", "local-list-denver.html"]) {
    const pageSrc = fs.readFileSync(path.join(SITE, f), "utf8");
    check(`site: ${f} renders the portfolio sample, labeled not a SIGNL visit`, pageSrc.includes("Portfolio sample") && pageSrc.includes("not a SIGNL visit") && pageSrc.includes("c.portfolioSample"));
  }

  console.log(`\nverify-build33: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
} catch (e) {
  console.error("verify-build33 crashed:", e);
  process.exitCode = 1;
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
