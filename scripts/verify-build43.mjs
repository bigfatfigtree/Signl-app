#!/usr/bin/env node
// Build 2026.10.30-43 verification. Jeff's morning batch:
//   ITEM 1 — Golden Ticket explainer: the panel must print the
//     REAL awards, in the units and labels the creator's own
//     Points surface uses: +100 when a creator you invite
//     finishes signing up (INVITE_FINISH_POINTS[0]), +25 when
//     their invites finish ([1]), +10 Momentum when an invite
//     gets approved (referralApproved), +3 Momentum when a
//     creator joins through your link (referralSignup). Nothing
//     is ever awarded for a click or a share. This suite pins
//     the panel's numbers to the live /me/points payload AND to
//     the server constants, so copy and code cannot drift.
//   ITEM 2 — Bench visibility: the Bench page carries the same
//     "Show me to other creators" switch as Profile, driving the
//     SAME creator.showToCreators flag through the same PATCH.
//     Both directions verified against the roster, exact search,
//     and the viewer's own bench payload, in a launched market
//     and in the founding state.
//   ITEM 3 — ROAS presentation: Score v2 MATH is unchanged
//     (the -39 cohort still computes 615 over 344 = 1.8), and
//     the payload gains presentation data only: weeklyCounted
//     buckets summing to every dollar rung this month, and
//     cohort summaries carrying the fields a tapped month
//     expands with. Source checks pin the visual blocks, the
//     info topics, the explorable rows, and the credit panel
//     with its approved concierge wording (never a live POS
//     claim).
// Run: node scripts/verify-build43.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8955;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "build43-admin@signl.local";
const ADMIN_PASSWORD = ["build43", "admin", "pass"].join("-");
const DB = path.join(os.tmpdir(), `signl-verify-build43-${Date.now()}.json`);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
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

async function makeCreator(admin, { name, email, handle, market = "Richmond", extra = {} }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market, city: market,
    handle, followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"], primaryPlatform: "instagram",
    ...AGREE, ...extra,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await c("PATCH", "/api/me/profile", { publicPage: true });
  return { client: c, id: reg.data.user.id, handle, user: reg.data.user };
}
async function makeBusiness(admin, { name, businessName, email, planId = "growth" }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "business", name, businessName, email, password: "business-pass-123", market: "Richmond", city: "Richmond",
    category: "Restaurant", planId, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: reg.data.user.id });
  return { client: c, id: reg.data.user.id, user: reg.data.user };
}
async function makeBooking(biz, creator, title) {
  const off = await biz.client("POST", "/api/offers", { title, whatComped: "Dinner for two", dollarCap: 60, spots: 1, includesAlcohol: false, creatorId: creator.id });
  if (off.status !== 201) throw new Error(`offer failed: ${JSON.stringify(off.data)}`);
  const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
  if (acc.status !== 201) throw new Error(`accept failed: ${JSON.stringify(acc.data)}`);
  await biz.client("POST", `/api/bookings/${acc.data.booking.id}/confirm`, {});
  return acc.data.booking;
}
async function completeVisit(creator, booking, slug) {
  const post = await creator.client("POST", "/api/posts", { bookingId: booking.id, url: `https://www.instagram.com/p/${slug}/`, includesDisclosure: true });
  if (post.status !== 201) throw new Error(`post failed: ${JSON.stringify(post.data)}`);
  return post.data.post;
}
async function logFirst(biz, bookingId, amount) {
  const r = await biz.client("POST", `/api/bookings/${bookingId}/code-uses`, { count: 1, amount });
  if (r.status !== 201) throw new Error(`code-use failed: ${JSON.stringify(r.data)}`);
  return r.data;
}

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  const boot = await admin("GET", "/api/bootstrap");
  check("stamp: API responses carry 2026.10.30-48", boot.headers.get("x-signl-build") === "2026.10.30-48", String(boot.headers.get("x-signl-build")));
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });

  // ---------- ITEM 1: ticket claim -> the real points ----------
  const ivy = await makeCreator(admin, { name: "Ticket Ivy", email: "ivy43@fixtures.dev", handle: "ticketivy43" });
  const issue = await ivy.client("POST", "/api/me/golden-tickets", { name: "Jade Joiner" });
  check("tickets: a finished creator issues a named ticket", issue.status === 201 && issue.data.ticket && issue.data.ticket.id, JSON.stringify(issue.data).slice(0, 200));
  const mine = await ivy.client("GET", "/api/me/golden-tickets");
  check("tickets: exactly two exist; one out leaves one", mine.data.remaining === 1 && (mine.data.tickets || []).length === 1, JSON.stringify(mine.data).slice(0, 200));

  const jade = client();
  const jadeReg = await jade("POST", "/api/auth/register", {
    role: "creator", name: "Jade Joiner", email: "jade43@fixtures.dev", password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle: "jadejoiner43", followerCount: 4100, localAudiencePct: 77, categories: ["Food & Drink"], primaryPlatform: "instagram",
    goldenTicket: issue.data.ticket.id, ...AGREE,
  });
  check("tickets: the named claim registers through the ticket", jadeReg.status === 201, JSON.stringify(jadeReg.data).slice(0, 200));
  await admin("POST", "/api/admin/review", { userId: jadeReg.data.user.id, decision: "approve" });
  await jade("PATCH", "/api/me/profile", { publicPage: true });
  const mineAfter = await ivy.client("GET", "/api/me/golden-tickets");
  check("tickets: the ticket flips to claimed", (mineAfter.data.tickets || [])[0] && mineAfter.data.tickets[0].status === "claimed", JSON.stringify(mineAfter.data.tickets).slice(0, 200));

  const pts = await ivy.client("GET", "/api/me/points");
  const pd = pts.data;
  const gen1 = (pd.byGeneration || [])[0] || {};
  check("points: a finished invite in the line pays the gen-1 award (100)",
    gen1.count === 1 && gen1.pointsEach === 100 && gen1.points === 100 && pd.linePoints === 100,
    JSON.stringify({ gen1, linePoints: pd.linePoints }));
  const ways = Object.fromEntries((pd.waysToEarn || []).map((w) => [w.label, w.points]));
  check("points: the creator's own surface prices every award the panel prints",
    ways["A creator you invite finishes signing up"] === 100
    && ways["Their invites finish signing up"] === 25
    && ways["One more step out"] === 10
    && ways["An invite gets approved"] === 10,
    JSON.stringify(ways));

  // ---------- ITEM 2: bench toggle, both directions ----------
  const casey = await makeCreator(admin, { name: "Bench Casey", email: "casey43@fixtures.dev", handle: "benchcasey43" });
  const drew = await makeCreator(admin, { name: "Bench Drew", email: "drew43@fixtures.dev", handle: "benchdrew43" });
  const drewBench1 = await drew.client("GET", "/api/me/bench");
  check("bench: launched market opens the roster and Casey is on it by default",
    drewBench1.data.state === "bench" && (drewBench1.data.creators || []).some((c) => c.handle === "benchcasey43"),
    JSON.stringify({ state: drewBench1.data.state, handles: (drewBench1.data.creators || []).map((c) => c.handle) }));
  check("bench: the viewer's own flag rides the payload, default on", drewBench1.data.showToCreators === true, JSON.stringify(drewBench1.data.showToCreators));
  await casey.client("PATCH", "/api/me/profile", { showToCreators: false });
  const caseyBench = await casey.client("GET", "/api/me/bench");
  check("bench: hiding flips the viewer's own payload flag", caseyBench.data.showToCreators === false, JSON.stringify(caseyBench.data.showToCreators));
  const drewBench2 = await drew.client("GET", "/api/me/bench");
  check("bench: hidden means off the roster", !(drewBench2.data.creators || []).some((c) => c.handle === "benchcasey43"), JSON.stringify((drewBench2.data.creators || []).map((c) => c.handle)));
  const lookupHidden = await drew.client("GET", "/api/me/bench/lookup?q=" + encodeURIComponent("@benchcasey43"));
  check("bench: hidden means out of exact search", lookupHidden.status === 200 && !lookupHidden.data.creator, JSON.stringify(lookupHidden.data).slice(0, 160));
  await casey.client("PATCH", "/api/me/profile", { showToCreators: true });
  const drewBench3 = await drew.client("GET", "/api/me/bench");
  const lookupBack = await drew.client("GET", "/api/me/bench/lookup?q=" + encodeURIComponent("@benchcasey43"));
  check("bench: showing again restores roster and search",
    (drewBench3.data.creators || []).some((c) => c.handle === "benchcasey43") && !!lookupBack.data.creator,
    JSON.stringify({ handles: (drewBench3.data.creators || []).map((c) => c.handle), lookup: !!lookupBack.data.creator }));
  // Founding state (Virginia Beach is not launched): the flag
  // the Bench-page switch binds to rides that payload too.
  const vbA = await makeCreator(admin, { name: "VB Ana", email: "vbana43@fixtures.dev", handle: "vbana43", market: "Virginia Beach" });
  const vbBench = await vbA.client("GET", "/api/me/bench");
  check("bench: the founding payload carries the same flag, default on",
    vbBench.data.state === "founding" && vbBench.data.showToCreators === true,
    JSON.stringify({ state: vbBench.data.state, flag: vbBench.data.showToCreators }));
  await vbA.client("PATCH", "/api/me/profile", { showToCreators: false });
  const vbBench2 = await vbA.client("GET", "/api/me/bench");
  check("bench: the founding flag flips the same way", vbBench2.data.showToCreators === false, JSON.stringify(vbBench2.data.showToCreators));

  // ---------- ITEM 3: the -39 cohort, payload additions ----------
  const amy = await makeCreator(admin, { name: "Score Amy", email: "amy43@fixtures.dev", handle: "scoreamy43" });
  const ben = await makeCreator(admin, { name: "Score Ben", email: "ben43@fixtures.dev", handle: "scoreben43" });
  const kitchen = await makeBusiness(admin, { name: "Kai Owner", businessName: "Score Kitchen 43", email: "kai43@fixtures.dev" });
  await kitchen.client("PATCH", "/api/me/profile", { discountEnabled: true, discountPct: 10 });
  const bk1 = await makeBooking(kitchen, amy, "Score Night One");
  await kitchen.client("PATCH", "/api/me/profile", { discountEnabled: false });
  await completeVisit(amy, bk1, "V43ONE");
  const f1 = await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  await kitchen.client("POST", "/api/me/passes/redeem", { code: f1.issuedPass.code, amount: 45 });
  await amy.client("POST", `/api/bookings/${bk1.id}/performance`, { views: 10000, likes: 100, comments: 10, shares: 5 });
  await kitchen.client("POST", `/api/bookings/${bk1.id}/comp-cost`, { amount: 30 });
  const bk2 = await makeBooking(kitchen, amy, "Score Night Two");
  await completeVisit(amy, bk2, "V43TWO");
  await logFirst(kitchen, bk2.id, 50);
  await logFirst(kitchen, bk2.id, 50);
  await logFirst(kitchen, bk2.id, 50);
  await kitchen.client("POST", `/api/bookings/${bk2.id}/comp-cost`, { amount: 25 });
  const bk3 = await makeBooking(kitchen, ben, "Score Night Three");
  await completeVisit(ben, bk3, "V43THREE");
  await logFirst(kitchen, bk3.id, 20);
  await logFirst(kitchen, bk3.id, 20);
  await logFirst(kitchen, bk3.id, 20);
  await kitchen.client("POST", `/api/bookings/${bk3.id}/comp-cost`, { confirmedZero: true });

  const rc = (await kitchen.client("GET", "/api/me/receipt")).data.receipt;
  const cur = rc.scoreV2.current;
  check("roas: the Score v2 math is untouched (615 back over 344 all in = 1.8)",
    cur.countedBack === 615 && cur.cost.total === 344 && cur.score === 1.8,
    JSON.stringify({ back: cur.countedBack, total: cur.cost.total, score: cur.score }));
  const weeks = rc.scoreV2.weeklyCounted || [];
  const weekSum = weeks.reduce((a, w) => a + w.total, 0);
  check("roas: weekly counted buckets cover the month and sum to every dollar rung this month (615: firsts and the came-back together)",
    weeks.length >= 4 && weeks.every((w) => typeof w.label === "string" && typeof w.total === "number" && typeof w.customers === "number" && typeof w.returns === "number")
    && weekSum === 615 && weeks.reduce((a, w) => a + w.customers, 0) === 10 && weeks.reduce((a, w) => a + w.returns, 0) === 1,
    JSON.stringify({ weeks: weeks.length, weekSum, customers: weeks.reduce((a, w) => a + w.customers, 0), returns: weeks.reduce((a, w) => a + w.returns, 0) }));
  const curSummary = (rc.scoreV2.cohorts || []).find((c) => c.month === cur.month) || {};
  check("roas: the current month's summary carries what its expansion prints",
    curSummary.countedBack === 615 && curSummary.countedCustomers === 10 && curSummary.countedEvents === 11 && curSummary.costTotal === 344 && curSummary.cameBackReturns === 1,
    JSON.stringify(curSummary));
  check("roas: prior-month summaries carry the expansion fields too",
    (rc.scoreV2.cohorts || []).length === 3 && (rc.scoreV2.cohorts || []).every((c) => "countedCustomers" in c && "countedEvents" in c && "costTotal" in c && "cameBackReturns" in c),
    JSON.stringify(rc.scoreV2.cohorts).slice(0, 300));

  // ---------- FIX A: one ROAS label ----------
  const home43 = (await kitchen.client("GET", "/api/me/business-home")).data.home;
  check("fixA: Business Home carries Score v2 for its stat cell, the same figure as the Receipt",
    !!home43.roasV2 && home43.roasV2.score === 1.8 && home43.roasV2.state === "counting" && home43.roasV2.countedBack === 615 && home43.roasV2.putIn === 344,
    JSON.stringify(home43.roasV2));
  check("fixA: the legacy figure in the same payload is labeled a modeled estimate",
    !!home43.roas && home43.roas.label === "Modeled estimate, our own model",
    home43.roas && home43.roas.label);

  // ---------- source contracts ----------
  const appSrc = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const routerSrc = fs.readFileSync(path.join(ROOT, "netlify", "functions", "lib", "router.js"), "utf8");
  const sigSrc = fs.readFileSync(path.join(ROOT, "netlify", "functions", "lib", "sigai.js"), "utf8");
  const slice = (from, to) => { const a = appSrc.indexOf(from); const b = appSrc.indexOf(to, a); return a > -1 && b > a ? appSrc.slice(a, b) : ""; };
  const gtPanel = slice("async function loadGoldenTickets", "async function gtIssue");
  const benchBlock = slice("function benchVisibilityHtml", "function benchFilter");
  const creditBlock = slice("function creditPanelHtml", "function scoreV2Html");
  const scoreBlock = slice("function scoreV2Html", "function receiptHtml");
  const srcChecks = [
    ["stamp: build stamp is 2026.10.30-48 on server and shell",
      fs.readFileSync(path.join(ROOT, "netlify", "functions", "lib", "build.js"), "utf8").includes('BUILD_ID = "2026.10.30-48"')
      && fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8").includes("2026.10.30-48")],
    ["tickets: the panel leads with the two seats being only yours to give",
      gtPanel.includes("Two seats, and only you can give them") && gtPanel.includes("You hold exactly two tickets") && gtPanel.includes("held in their name until the market launches")],
    ["tickets: the panel prints the four real awards with the points surface's own labels",
      gtPanel.includes("A creator you invite finishes signing up") && gtPanel.includes("+100 points")
      && gtPanel.includes("Their invites finish signing up") && gtPanel.includes("+25 points")
      && gtPanel.includes("An invite gets approved") && gtPanel.includes("+10 points")
      && gtPanel.includes("A creator joins through your link") && gtPanel.includes("+3 points")],
    ["tickets: the panel states nothing is paid for a click or a share",
      gtPanel.includes("Nothing is paid for a click or a share")],
    ["tickets: the printed numbers still equal the server constants",
      routerSrc.includes("const INVITE_FINISH_POINTS = [100, 25, 10]") && routerSrc.includes("referralSignup: 3") && routerSrc.includes("referralApproved: 10")],
    ["bench: the Bench page renders its own visibility switch in both states",
      (appSrc.match(/\$\{benchVisibilityHtml\(data\)\}/g) || []).length === 2 && benchBlock.includes('id="bench-creators"') && benchBlock.includes("Show me to other creators")],
    ["bench: the switch states the off consequence in one plain line",
      benchBlock.includes("Turning this off removes you from the roster, introductions, exact search, and +1 picking")],
    ["bench: the switch drives the same flag through the same PATCH",
      benchBlock.includes('api("PATCH", "/me/profile", { showToCreators: on })') && benchBlock.includes("state.bench.showToCreators = on") && benchBlock.includes("state.user = data.user")],
    ["roas: the score leads with a visual figure and in-vs-back bars",
      scoreBlock.includes("roas-big") && scoreBlock.includes("Back through your register") && scoreBlock.includes("All in, what you put in") && scoreBlock.includes("roasBarRow")],
    ["roas: the counted-by-week chart renders from the payload series",
      scoreBlock.includes("Counted at your register, by week") && scoreBlock.includes("weeklyCounted") && scoreBlock.includes("roasWeekChart")],
    ["roas: came-backs are visual (returns of firsts with the segment bar)",
      scoreBlock.includes("roas-seg") && scoreBlock.includes("Came back")],
    ["roas: months, visits and creators expand in place",
      (scoreBlock.match(/<details class="roas-x"/g) || []).length >= 3 && scoreBlock.includes("Your months") && scoreBlock.includes("before your plan")],
    ["roas: every figure carries an info button into one shared popover",
      ["score", "back", "week", "cameback", "costs", "media", "tally", "months", "visits", "creators", "forming"].every((t) => scoreBlock.includes(`roasInfoBtn("${t}")`))
      && scoreBlock.includes('roasBarRow("Back through your register", "back"') && scoreBlock.includes('roasBarRow("All in, what you put in", "putin"')
      && appSrc.includes("function showRoasInfo") && appSrc.includes('id="roas-info-pop"')],
    ["roas: the info text exists for all twelve topics",
      (() => { const a = appSrc.indexOf("const ROAS_INFO"); const b = appSrc.indexOf("function roasInfoBtn", a); const block = a > -1 && b > a ? appSrc.slice(a, b) : ""; return ["score", "back", "putin", "week", "cameback", "costs", "media", "tally", "months", "visits", "creators", "forming"].every((t) => new RegExp(`\\n  ${t}: \\{ title:`).test(block)) && (block.match(/title: "/g) || []).length === 12; })()],
    ["credit: the three steps spell out how a visit earns its credit",
      creditBlock.includes("Every creator post carries that creator's own code") && creditBlock.includes("shows the code at the register when they pay") && creditBlock.includes("counts in your score, dollar by dollar")],
    ["credit: the tally is sold as about 30 seconds at close-out, linked to the visit cards",
      creditBlock.includes("the tally takes about 30 seconds") && creditBlock.includes("Visits &amp; Posts")],
    ["credit: the register plug-in uses the approved concierge words only",
      creditBlock.includes("we plug into your POS with you on the setup call, one tap on your end, we stay on the line until your panel says connected; if your system isn't one we connect to yet, your codes start counting on the register you already have")],
    ["credit: nothing claims a live POS integration exists",
      !/Square|integrates with|integration is live|connected to your POS/i.test(creditBlock)],
    ["copy: no em dashes in the new blocks",
      ![gtPanel, benchBlock, creditBlock].some((b) => b.includes("—"))],
    ["copy: the score block keeps the -39 honesty strings",
      scoreBlock.includes("counted dollar by dollar") && scoreBlock.includes("Your score starts when there is enough counted to mean something") && !/caused|generated/.test(scoreBlock)],
    ["fixA: no surface labels a legacy figure with the ROAS name",
      !appSrc.includes("<strong>SIGNL ROAS Score") && !appSrc.includes("SIGNL ROAS Score (register tallies")
      && !appSrc.includes("SIGNL ROAS Score — starts") && !appSrc.includes("SIGNL ROAS ${")
      && !appSrc.includes('label: "ROAS score"') && !appSrc.includes(">SIGNL ROAS Score</div>")
      && !appSrc.includes("feeds the visit's SIGNL ROAS Score") && !appSrc.includes("completes this visit's SIGNL ROAS Score")],
    ["fixA: the legacy figures wear the modeled-estimate name where they render",
      (appSrc.match(/<strong>Modeled estimate:/g) || []).length === 2 && appSrc.includes('label: "Modeled estimate"')
      && appSrc.includes("Modeled estimate (register tallies plus modeled media value)") && appSrc.includes("modeled est. ${c.roasScore")],
    ["fixA: the Home cell renders v2 when the payload carries it",
      slice("function roasCellHtml", "// ---------- business dashboard").includes("h.roasV2") && slice("function roasCellHtml", "// ---------- business dashboard").includes("SIGNL ROAS Score · ${esc(v2.stateLabel")],
    ["fixA: the live Home snapshot carries the v2 figure under its name and state",
      slice("const snapCells = hasNumbers", "const caughtLinks").includes("h.roasV2.score") && slice("const snapCells = hasNumbers", "const caughtLinks").includes("SIGNL ROAS Score · ${h.roasV2.stateLabel")],
    ["fixA: the server labels only Score v2 with the ROAS name",
      routerSrc.includes('label: "Modeled estimate, our own model"') && routerSrc.includes('version: "Score v2", label: ROAS_LABEL') && routerSrc.includes("roasV2,")],
    ["fixB: no copy promises points for approving a license or being approved by a business",
      !sigSrc.includes("approving a license") && !appSrc.includes("+25 when you approve a license") && !appSrc.includes("+25 for approving a license")
      && !appSrc.includes("approving one earns +25") && !appSrc.includes("when a business approves you")],
    ["fixB: Sig canon and the Q&A state the real +25 trigger, a business running the post as an ad",
      sigSrc.includes("+25 when a business runs your post as an ad") && (appSrc.match(/runs your post as an ad/g) || []).length >= 3
      && appSrc.includes("+10 when a creator you invited is approved")],
    ["fixB: the ledger itself is untouched (amounts and triggers unchanged)",
      routerSrc.includes("adUse: 25") && routerSrc.includes("referralApproved: 10") && routerSrc.includes("adUseDeclaredAt")],
  ];
  for (const [name, ok] of srcChecks) check(name, ok);

  console.log(`\nverify-build43: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
} catch (e) {
  console.error("verify-build43 crashed:", e);
  process.exitCode = 1;
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
