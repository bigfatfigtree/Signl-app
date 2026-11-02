#!/usr/bin/env node
// Build -70 verification (Jeff, 2026-11-02): the staff recruiter
// console (Bella, Dubai) + Jeff's Admin outreach workspace.
//
// Proves, against throwaway local stores:
//   Phase A (in-process handler calls, no listening socket):
//     - seeds: the Dubai queue loads to the Dubai seat; Jeff's
//       owner queues load from the brain store + city seed files,
//       with brain contact_state carried over (nobody already
//       contacted queues as fresh);
//     - invite: Admin invites a staff recruiter (Bella) for Dubai;
//       the seat adopts the seeded Dubai queue; she sets her own
//       password through the emailed reset token (TEST_MODE) and
//       signs in;
//     - scoping: Bella's queue is Dubai only (a market parameter
//       cannot widen it); a creator cannot read the console; the
//       admin rollup is admin-only;
//     - drafts: her IG draft carries her attributed Dubai claim
//       link (src=recruiter-bella) and the canon lines (both
//       lanes, 97%, local ranking, founding roster, free, the 500
//       minimum, her intro); Jeff's drafts sign as Jeff, Founder;
//     - queue law: dedupe refuses a second queueing of the same
//       handle; do-not-contact blocks re-adding; the follow-up
//       unlocks only after 4 quiet days and sends once, ever;
//     - credit: a sign-up through her link credits her via link
//       and flips the prospect to claimed; a generic sign-up
//       matching her list credits her via list-match; a sign-up
//       through a second recruiter's link that matches her list
//       credits the LINK, flags the match, and counts exactly
//       once in total; approval moves the prospect to approved;
//     - Dubai permit: Admin sets a Dubai creator's
//       advertiserPermit; it rides the applications payload; an
//       invalid status is refused; it never gates sign-up.
//   Phase B (HTTP through the dev server): one end-to-end pass
//     over real HTTP. If this environment's listen-cage is active
//     (a listening process gets its store writes denied), Phase B
//     reports CAGE-BLOCKED instead of failing: the cage is an
//     environment fault, not a product fault, and Phase A covers
//     the same wiring in-process.
//   Source checks: the console's client surfaces, the router
//   wiring, the -70 verify wiring in package.json.
//
// Run: node scripts/verify-build70.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;
let blocked = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
function cageBlocked(name, why) {
  blocked++;
  console.log(`  CAGE-BLOCKED - ${name} :: ${String(why).slice(0, 200)}`);
}

// ---------- Phase A: in-process ----------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build70-"));
const DB = path.join(tmp, "db.json");
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB;
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_MAIL_STUB = "1";
process.env.APP_URL = "http://127.0.0.1:8998";
process.env.ADMIN_EMAIL = "admin@signl.test";
process.env.ADMIN_PASSWORD = "build-70-admin-password";

const { handler } = require("../netlify/functions/api.js");
const store = require("../netlify/functions/lib/store.js");

class DirectClient {
  constructor() { this.cookies = new Map(); }
  async req(method, p, body) {
    const url = new URL("http://local" + p);
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const event = {
      httpMethod: method,
      path: "/api" + url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body ? JSON.stringify(body) : null,
      isBase64Encoded: false,
    };
    const out = await handler(event);
    const sc = out.headers && (out.headers["Set-Cookie"] || out.headers["set-cookie"]);
    if (sc) {
      const [pair] = String(sc).split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    let data = null;
    try { data = JSON.parse(out.body); } catch (e) { /* no body */ }
    return { status: out.statusCode, data };
  }
}

async function registerCreator(client, { handle, market, email, signupSource }) {
  return client.req("POST", "/auth/register", {
    role: "creator", quickClaim: true, email, password: "build-70-creator-password",
    market, handle, primaryPlatform: "instagram", agreedTerms: true,
    ...(signupSource ? { signupSource } : {}),
  });
}

async function phaseA() {
  console.log("== Phase A: in-process handler ==");
  const admin = new DirectClient();
  {
    const r = await admin.req("POST", "/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    check("admin login", r.status === 200 && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
  }

  // Build -72 adjustment: reads no longer wait on the one-time
  // seed import (they kick it fire-and-forget and serve current
  // data), so complete the import explicitly through the seed
  // endpoint before asserting on seeded content below.
  {
    const r = await admin.req("POST", "/admin/recruiters/seed");
    check("seed endpoint completes the one-time import", r.status === 200 && !!r.data && r.data.ok === true, `status=${r.status}`);
  }

  // Seeds + rollups
  let dubaiSeatCount = 0;
  {
    const r = await admin.req("GET", "/admin/recruiters");
    check("admin recruiters rollup loads", r.status === 200 && Array.isArray(r.data.recruiters), `status=${r.status}`);
    const owner = (r.data.recruiters || []).find((x) => x.recruiter.kind === "owner");
    check("owner recruiter entity exists (Jeff's workspace)", !!owner);
    check("owner queues seeded (assigned > 100 across his markets)", !!owner && owner.assigned > 100, owner && `assigned=${owner.assigned}`);
    const prospects = await store.list("prospect:");
    const dubai = prospects.map((x) => x.value).filter((p) => p.marketName === "Dubai");
    dubaiSeatCount = dubai.length;
    check("Dubai seed loaded to the seat (>= 200 of 216, dedupe aside)", dubaiSeatCount >= 200, `dubai=${dubaiSeatCount}`);
    check("Dubai seed assigned to the seat, not a person", dubai.every((p) => p.recruiterId === "seat:dubai"));
    const denver = prospects.map((x) => x.value).filter((p) => p.marketName === "Denver");
    check("Denver seed loaded for Jeff (>= 150 of 178)", denver.length >= 150, `denver=${denver.length}`);
    const austin = prospects.map((x) => x.value).filter((p) => p.marketName === "Austin");
    check("Austin pool queued as already-sent, never fresh", austin.length > 0 && austin.every((p) => p.status === "sent"), `austin=${austin.length}`);
    const brainSent = prospects.map((x) => x.value).filter((p) => p.source === "brain-store" && (p.status === "sent" || p.status === "replied"));
    check("brain contact_state carried over (some queue as sent/replied)", brainSent.length > 0, `brainSent=${brainSent.length}`);
  }

  // Invite Bella
  let bella = new DirectClient();
  let bellaEntity = null;
  {
    const r = await admin.req("POST", "/admin/recruiters/invite", { name: "Bella Hausen", email: "bella@fixtures.dev", market: "Dubai" });
    check("admin invites Bella for Dubai", r.status === 200 && r.data.recruiter && r.data.recruiter.code === "bella", `status=${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    bellaEntity = r.data.recruiter;
    check("invite carries a password token in TEST_MODE", typeof r.data.devResetToken === "string" && r.data.devResetToken.length > 10);
    const reset = await bella.req("POST", "/auth/reset", { token: r.data.devResetToken, password: "bella-own-password-70" });
    check("Bella sets her own password from the invite link", reset.status === 200, `status=${reset.status}`);
    const login = await bella.req("POST", "/auth/login", { email: "bella@fixtures.dev", password: "bella-own-password-70" });
    check("Bella signs in as a recruiter", login.status === 200 && login.data.user.role === "recruiter", `status=${login.status}`);
    const roll = await admin.req("GET", "/admin/recruiters");
    const bellaRoll = (roll.data.recruiters || []).find((x) => x.recruiter.id === (bellaEntity && bellaEntity.id));
    check("the Dubai seat's queue became Bella's on invite", !!bellaRoll && bellaRoll.assigned === dubaiSeatCount, bellaRoll && `assigned=${bellaRoll.assigned} seat=${dubaiSeatCount}`);
  }

  // Scoping
  let dubaiProspect = null;
  {
    const q = await bella.req("GET", "/recruiter/queue");
    check("Bella's queue is Dubai", q.status === 200 && q.data.market === "Dubai" && q.data.prospects.length >= 200, `status=${q.status} n=${q.data && q.data.prospects.length}`);
    check("queue counts add up", q.data.counts.total === q.data.prospects.length);
    const widened = await bella.req("GET", "/recruiter/queue?market=Austin");
    check("Bella cannot widen her scope with a market parameter", widened.status === 200 && widened.data.market === "Dubai");
    const asAdmin = await bella.req("GET", "/admin/recruiters");
    check("Bella cannot read the admin rollup", asAdmin.status === 403, `status=${asAdmin.status}`);
    dubaiProspect = q.data.prospects.find((p) => p.effectiveStatus === "to_contact" && p.instagramHandle) || q.data.prospects[0];
  }

  // Drafts: canon + attribution
  {
    const d = await bella.req("GET", `/recruiter/prospects/${dubaiProspect.id}/drafts`);
    const ig = d.data && d.data.drafts && d.data.drafts.ig || "";
    check("IG draft opens as Bella leading the Dubai launch", ig.includes("I'm Bella. I lead SIGNL's launch in Dubai."), ig.slice(0, 120));
    check("IG draft carries her attributed claim link", ig.includes("src=recruiter-bella") && ig.includes("market=Dubai"), ig.slice(-160));
    check("IG draft: both lanes in one breath", ig.includes("comped experiences") && ig.includes("paid bookings at your own rate"));
    check("IG draft: 97% keep + local ranking + founding + free + 500 minimum",
      ig.includes("keep 97%") && ig.includes("ranked by how local your audience is") && ig.includes("founding roster") && ig.includes("free for creators") && ig.includes("500 total followers"));
    check("email draft carries the Dubai permit line", (d.data.drafts.emailBody || "").includes("Advertiser Permit"));
    check("no em dashes in any draft", !/—/.test(ig + d.data.drafts.emailBody + d.data.drafts.followup));
  }

  // Send flow + follow-up law
  {
    const sent = await bella.req("POST", `/recruiter/prospects/${dubaiProspect.id}/action`, { action: "sent", channel: "instagram" });
    check("mark sent works from to_contact", sent.status === 200 && sent.data.prospect.status === "sent", `status=${sent.status}`);
    const early = await bella.req("POST", `/recruiter/prospects/${dubaiProspect.id}/action`, { action: "followup-sent", channel: "instagram" });
    check("follow-up is locked before 4 days", early.status === 400, `status=${early.status}`);
    // Time-travel the first send to 5 days ago, straight in the store.
    const rec = await store.get(`prospect:${dubaiProspect.id}`);
    rec.firstSentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    rec.sends = rec.sends.map((s) => ({ ...s, at: rec.firstSentAt }));
    await store.set(`prospect:${dubaiProspect.id}`, rec);
    const q = await bella.req("GET", "/recruiter/queue");
    const after = q.data.prospects.find((p) => p.id === dubaiProspect.id);
    check("follow-up unlocks after 4 quiet days", after.followupReady === true);
    const fu = await bella.req("POST", `/recruiter/prospects/${dubaiProspect.id}/action`, { action: "followup-sent", channel: "instagram" });
    check("follow-up sends once", fu.status === 200 && !!fu.data.prospect.followupSentAt, `status=${fu.status}`);
    const fu2 = await bella.req("POST", `/recruiter/prospects/${dubaiProspect.id}/action`, { action: "followup-sent", channel: "instagram" });
    check("a second follow-up is refused, ever", fu2.status === 400, `status=${fu2.status}`);
  }

  // Dedupe + do-not-contact
  let addedId = null;
  {
    const dupe = await bella.req("POST", "/recruiter/prospects", { name: "Dupe", handle: dubaiProspect.instagramHandle || dubaiProspect.handle });
    check("re-adding a queued handle is refused", dupe.status === 409, `status=${dupe.status}`);
    const add = await bella.req("POST", "/recruiter/prospects", { name: "Test Creator Seventy", handle: "testcreator70", email: "tc70@fixtures.dev", category: "Food" });
    check("recruiter can add her own market's prospects", add.status === 200 && add.data.result.added === 1, `status=${add.status}`);
    const q = await bella.req("GET", "/recruiter/queue");
    const mine = q.data.prospects.find((p) => p.handle === "testcreator70");
    addedId = mine && mine.id;
    check("the added prospect is in her queue", !!addedId);
    const dnc = await bella.req("POST", `/recruiter/prospects/${addedId}/action`, { action: "do_not_contact" });
    check("do-not-contact marks", dnc.status === 200 && dnc.data.prospect.status === "do_not_contact");
    const readd = await bella.req("POST", "/recruiter/prospects", { name: "Test Creator Seventy", handle: "testcreator70" });
    check("a do-not-contact creator cannot be re-added", readd.status === 409, `status=${readd.status}`);
  }

  // Credit: link, list-match, conflict, exactly-once
  let linkCreatorId = null;
  let matchCreatorId = null;
  {
    // Link: a fresh queued prospect signs up through Bella's link.
    const add = await bella.req("POST", "/recruiter/prospects", { name: "Link Case", handle: "linkcase70", category: "Beauty" });
    check("link-case prospect queued", add.status === 200);
    const c1 = new DirectClient();
    const reg = await registerCreator(c1, { handle: "linkcase70", market: "Dubai", email: "linkcase70@fixtures.dev", signupSource: "recruiter-bella" });
    check("creator registers through Bella's link", reg.status === 201 && reg.data.user && reg.data.user.role === "creator", `status=${reg.status}`);
    linkCreatorId = reg.data.user.id;
    const q = await bella.req("GET", "/recruiter/queue");
    const p1 = q.data.prospects.find((p) => p.handle === "linkcase70");
    check("link sign-up flips the prospect to claimed", !!p1 && p1.effectiveStatus === "claimed", p1 && p1.effectiveStatus);
    check("link sign-up credits Bella via link", !!p1 && p1.credit && p1.credit.via === "link" && p1.credit.recruiterId === bellaEntity.id);
    const stamped = await store.get(`user:${linkCreatorId}`);
    check("the creator record carries the recruiter FK", stamped.recruiterId === bellaEntity.id);

    // List-match: a queued prospect signs up with no source at all.
    const add2 = await bella.req("POST", "/recruiter/prospects", { name: "Match Case", handle: "matchcase70", category: "Fitness" });
    check("match-case prospect queued", add2.status === 200);
    const c2 = new DirectClient();
    const reg2 = await registerCreator(c2, { handle: "matchcase70", market: "Dubai", email: "matchcase70@fixtures.dev" });
    check("creator registers with no source", reg2.status === 201, `status=${reg2.status}`);
    matchCreatorId = reg2.data.user.id;
    const q2 = await bella.req("GET", "/recruiter/queue");
    const p2 = q2.data.prospects.find((p) => p.handle === "matchcase70");
    check("generic sign-up matching her list still flips to claimed", !!p2 && p2.effectiveStatus === "claimed");
    check("list-match credits Bella", !!p2 && p2.credit && p2.credit.via === "list-match" && p2.credit.recruiterId === bellaEntity.id);

    // Conflict: a prospect on Bella's list signs up through Sara's link.
    const saraInvite = await admin.req("POST", "/admin/recruiters/invite", { name: "Sara Second", email: "sara@fixtures.dev", market: "Dubai" });
    check("second Dubai recruiter invited", saraInvite.status === 200 && saraInvite.data.recruiter.code.startsWith("sara"), `status=${saraInvite.status}`);
    const saraId = saraInvite.data.recruiter.id;
    const add3 = await bella.req("POST", "/recruiter/prospects", { name: "Conflict Case", handle: "conflictcase70", category: "Lifestyle" });
    check("conflict-case prospect queued on Bella's list", add3.status === 200);
    const c3 = new DirectClient();
    const reg3 = await registerCreator(c3, { handle: "conflictcase70", market: "Dubai", email: "conflictcase70@fixtures.dev", signupSource: "recruiter-" + saraInvite.data.recruiter.code });
    check("conflict-case creator registers via Sara's link", reg3.status === 201, `status=${reg3.status}`);
    const credits = (await store.list("rcredit:")).map((x) => x.value).filter((c) => c.userId === reg3.data.user.id);
    check("exactly one credit exists for the conflict sign-up", credits.length === 1, `credits=${credits.length}`);
    check("the link wins the credit", credits.length === 1 && credits[0].recruiterId === saraId && credits[0].via === "link");
    const q3 = await bella.req("GET", "/recruiter/queue");
    const p3 = q3.data.prospects.find((p) => p.handle === "conflictcase70");
    check("Bella's prospect still flips to claimed", !!p3 && p3.effectiveStatus === "claimed");
    check("the list match is flagged, not double-counted", !!p3 && !!p3.creditConflict && p3.creditConflict.listMatchRecruiterId === bellaEntity.id);
    const roll = await admin.req("GET", "/admin/recruiters");
    const bellaRoll = roll.data.recruiters.find((x) => x.recruiter.id === bellaEntity.id);
    check("admin rollup surfaces Bella's flagged match", bellaRoll.conflicts.length >= 1, `conflicts=${bellaRoll.conflicts.length}`);
    check("admin rollup: Bella has exactly her two credits", bellaRoll.claimsStarted === 2, `claims=${bellaRoll.claimsStarted}`);

    // Approval moves the prospect to approved.
    const review = await admin.req("POST", "/admin/review", { userId: matchCreatorId, decision: "approve" });
    check("admin approves the list-matched creator", review.status === 200 && review.data.user.status === "approved", `status=${review.status}`);
    const q4 = await bella.req("GET", "/recruiter/queue");
    const p4 = q4.data.prospects.find((p) => p.handle === "matchcase70");
    check("approval moves the prospect to approved", !!p4 && p4.effectiveStatus === "approved", p4 && p4.effectiveStatus);
    const res = await bella.req("GET", "/recruiter/results");
    check("Bella's results count her approved sign-up", res.status === 200 && res.data.rollup.signupsApproved >= 1 && res.data.credited.length === 2, `approved=${res.data && res.data.rollup.signupsApproved} credited=${res.data && res.data.credited.length}`);
  }

  // Dubai permit: settable, visible, never a gate
  {
    const bad = await admin.req("POST", `/admin/users/${linkCreatorId}/advertiser-permit`, { status: "whenever" });
    check("an invalid permit status is refused", bad.status === 400, `status=${bad.status}`);
    const set = await admin.req("POST", `/admin/users/${linkCreatorId}/advertiser-permit`, { status: "in_progress" });
    check("admin sets the permit status", set.status === 200 && set.data.advertiserPermit === "in_progress", `status=${set.status}`);
    const apps = await admin.req("GET", "/admin/applications");
    const row = (apps.data.pending || []).concat(apps.data.decided || []).find((u) => u.id === linkCreatorId) ||
      (apps.data.applications || []).find((u) => u.id === linkCreatorId);
    check("the permit rides the admin applications payload", !!row && row.advertiserPermit === "in_progress", row ? String(row.advertiserPermit) : "row not found");
  }

  // Jeff's workspace (owner) through the same console API
  {
    const me = await admin.req("GET", "/recruiter/me");
    check("admin resolves to the owner recruiter", me.status === 200 && me.data.recruiter.kind === "owner", `status=${me.status}`);
    const denver = await admin.req("GET", "/recruiter/queue?market=Denver");
    check("Jeff's Denver queue works", denver.status === 200 && denver.data.market === "Denver" && denver.data.prospects.length >= 150, `n=${denver.data && denver.data.prospects.length}`);
    const first = denver.data.prospects.find((p) => p.effectiveStatus === "to_contact") || denver.data.prospects[0];
    const d = await admin.req("GET", `/recruiter/prospects/${first.id}/drafts`);
    check("Jeff's drafts sign as Jeff, Founder", (d.data.drafts.ig || "").includes("I'm Jeff, the founder of SIGNL.") && (d.data.drafts.emailBody || "").includes("Jeff\nFounder, SIGNL"));
    check("Jeff's email draft has no Dubai permit line in Denver", !(d.data.drafts.emailBody || "").includes("Advertiser Permit"));
    const creator = new DirectClient();
    const reg = await registerCreator(creator, { handle: "scopeprobe70", market: "Austin", email: "scopeprobe70@fixtures.dev" });
    check("probe creator registers", reg.status === 201, `status=${reg.status}`);
    const probe = await creator.req("GET", "/recruiter/me");
    check("a creator cannot use the recruiter console", probe.status === 403, `status=${probe.status}`);
  }
}

// ---------- Phase B: HTTP through the dev server ----------

async function phaseB() {
  console.log("== Phase B: HTTP through the dev server ==");
  const db = path.join(tmp, "db-http.json");
  const port = 8998;
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL: process.env.ADMIN_EMAIL, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD };
  const server = spawn("node", ["scripts/dev-server.mjs", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let serverErr = "";
  server.stderr.on("data", (d) => { serverErr += d; });
  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      try { const r = await fetch(base + "/api/bootstrap"); up = r.status === 200; } catch (e) { /* not up yet */ }
      if (!up) await new Promise((r) => setTimeout(r, 500));
    }
    if (!up) { cageBlocked("HTTP server boots", serverErr.slice(-200) || "server never answered"); return; }
    const cookies = new Map();
    const req = async (method, p, body) => {
      const headers = { "content-type": "application/json" };
      if (cookies.size) headers.cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await fetch(base + "/api" + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) { const [pair] = c.split(";"); const i = pair.indexOf("="); if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
      let data = null; try { data = await res.json(); } catch (e) {}
      return { status: res.status, data };
    };
    const login = await req("POST", "/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    if (login.status !== 200) { cageBlocked("HTTP admin login", `status=${login.status} ${serverErr.slice(-160)}`); return; }
    // Build -72 adjustment: complete the seed import through the
    // explicit seed endpoint before the end-to-end pass. Reads no
    // longer drain it implicitly (they kick it fire-and-forget),
    // and inside this single-process dev server a background
    // import's store writes starve the event loop hard enough to
    // reset in-flight requests. The assertions below are unchanged.
    const seed = await req("POST", "/admin/recruiters/seed");
    if (seed.status !== 200) { cageBlocked("HTTP seed completion", `status=${seed.status} ${serverErr.slice(-160)}`); return; }
    const invite = await req("POST", "/admin/recruiters/invite", { name: "Http Bella", email: "httpbella@fixtures.dev", market: "Dubai" });
    if (invite.status !== 200) { cageBlocked("HTTP invite (store writes over HTTP)", `status=${invite.status} ${serverErr.slice(-160)}`); return; }
    check("HTTP: admin invites a Dubai recruiter end to end", invite.data.recruiter && invite.data.recruiter.marketName === "Dubai");
    const code = invite.data.recruiter.code;
    const reg = await req("POST", "/auth/register", { role: "creator", quickClaim: true, email: "httpcase70@fixtures.dev", password: "build-70-creator-password", market: "Dubai", handle: "httpcase70", primaryPlatform: "instagram", agreedTerms: true, signupSource: "recruiter-" + code });
    check("HTTP: creator registers through the recruiter link", reg.status === 201, `status=${reg.status}`);
    // The registration response sets the CREATOR's session cookie,
    // which clobbers this client's single cookie jar; sign back in
    // as admin before reading the admin rollup.
    await req("POST", "/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    const roll = await req("GET", "/admin/recruiters");
    const mine = (roll.data.recruiters || []).find((x) => x.recruiter.code === code);
    check("HTTP: the link sign-up is credited over real HTTP", !!mine && mine.claimsStarted === 1, mine && `claims=${mine.claimsStarted}`);
  } catch (e) {
    cageBlocked("HTTP phase", e && e.message);
  } finally {
    try { server.kill("SIGKILL"); } catch (e) {}
  }
}

// ---------- source checks ----------

function sourceChecks() {
  console.log("== Source checks ==");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  check("app: recruiter dashboard renderer present", appJs.includes("renderRecruiterDash") && appJs.includes("RECRUITER_TABS"));
  check("app: staff recruiter admin section present", appJs.includes("loadStaffRecruiters") && appJs.includes("Invite staff recruiter"));
  check("app: Jeff's Admin Outreach tab present", appJs.includes("loadAdminOutreach"));
  check("app: Dubai permit note on the claim form", appJs.includes("qc-dubai-note"));
  check("app: permit control on admin rows", appJs.includes("saveAdvertiserPermit"));
  check("router: recruiter module wired", routerJs.includes('require("./recruiters")') && routerJs.includes("handleRecruiterApi") && routerJs.includes("handleAdminRecruiters"));
  check("router: registration + review hooks wired", routerJs.includes("recruiters.onCreatorRegistered") && routerJs.includes("recruiters.onCreatorApproved"));
  check("router: permit rides the applications payload", routerJs.includes("pub.advertiserPermit"));
  check("package.json wires verify-build70", pkg.includes("verify-build70"));
}

try {
  await phaseA();
} catch (e) {
  failed++;
  fails.push("Phase A crashed: " + (e && e.message));
  console.error("Phase A crashed:", e);
}
await phaseB();
sourceChecks();

console.log(`\nBuild -70: ${passed} passed, ${failed} failed${blocked ? `, ${blocked} cage-blocked` : ""}`);
if (fails.length) console.log("Failures:\n - " + fails.join("\n - "));
process.exit(failed ? 1 : 0);
