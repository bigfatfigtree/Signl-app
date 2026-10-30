// Build -48 verification: the business Results Receipt is
// restructured into SUBTABS (Jeff's verdict on the -43 layout,
// 2026-10-30: "Should be subtabs within results page to break
// this down simple and then charts and graphs and visual
// components"). The -43/-45 components were right; the single
// long stacked page was wrong.
//
// The Receipt card (inside the existing Results destination,
// no new top-level navigation) now renders five subtabs via
// the existing wsTabs bar when a score exists on the page:
//   Overview      - score head (v2 + Halo blend, floor line,
//                   vs bars), media + tally lines, the ledger
//                   summary, the Google block
//   Over time     - came-backs block, counted-by-week chart,
//                   months/cohorts + trailing three
//   Creators      - this month's visits (details, comp-cost
//                   capture), per-creator bars
//   Costs         - the itemized all-in cost block
//   How it counts - "How SIGNL gets credit" panel, capture-gap
//                   panel, method/version line
// All five panels render in one pass and switch by class, so
// details/form state survives; the selected tab is module
// state, so loadReceipt re-renders (comp-cost saves, the Sig
// capture-gap deep link) land back on the same tab. The shared
// info popover renders once, outside every panel. Without a
// score (founding / nothing counted) the Receipt keeps its
// exact prior single explainer layout: no tabs, no empties.
// Score math, payload fields, honesty strings: untouched.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8916;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = `/tmp/signl-verify-build48-${Date.now()}.json`;
const ADMIN_EMAIL = "admin@verify.local";
const ADMIN_PASSWORD = "verify-admin-pass-123";

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; failures.push(name + (detail ? " — " + detail : "")); console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

function client() {
  const jar = new Map();
  async function call(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (jar.size) headers.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) {
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

async function makeCreator(admin, { name, email, handle }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle, followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"],
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
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
  const boot = await fetch(BASE + "/api/bootstrap");
  check("bootstrap carries the -48 build stamp", boot.headers.get("x-signl-build") === "2026.10.30-55", String(boot.headers.get("x-signl-build")));
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });

  // ---------- scored business (the -39/-45 Kitchen fixture) ----------
  const amy = await makeCreator(admin, { name: "Tab Amy", email: "amy48@fixtures.dev", handle: "tabamy" });
  const ben = await makeCreator(admin, { name: "Tab Ben", email: "ben48@fixtures.dev", handle: "tabben" });
  const kitchen = await makeBusiness(admin, { name: "Kai Owner", businessName: "Tab Kitchen", email: "kai48@fixtures.dev" });
  await kitchen.client("PATCH", "/api/me/profile", { discountEnabled: true, discountPct: 10 });
  const bk1 = await makeBooking(kitchen, amy, "Tab Night One");
  await kitchen.client("PATCH", "/api/me/profile", { discountEnabled: false });
  await completeVisit(amy, bk1, "V48ONE");
  const f1 = await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  await logFirst(kitchen, bk1.id, 90);
  await kitchen.client("POST", "/api/me/passes/redeem", { code: f1.issuedPass.code, amount: 45 });
  await amy.client("POST", `/api/bookings/${bk1.id}/performance`, { views: 10000, likes: 100, comments: 10, shares: 5 });
  await kitchen.client("POST", `/api/bookings/${bk1.id}/comp-cost`, { amount: 30 });
  const bk2 = await makeBooking(kitchen, amy, "Tab Night Two");
  await completeVisit(amy, bk2, "V48TWO");
  await logFirst(kitchen, bk2.id, 50);
  await logFirst(kitchen, bk2.id, 50);
  await logFirst(kitchen, bk2.id, 50);
  await kitchen.client("POST", `/api/bookings/${bk2.id}/comp-cost`, { amount: 25 });
  const bk3 = await makeBooking(kitchen, ben, "Tab Night Three");
  await completeVisit(ben, bk3, "V48THREE");
  await logFirst(kitchen, bk3.id, 20);
  await logFirst(kitchen, bk3.id, 20);
  await logFirst(kitchen, bk3.id, 20);
  await kitchen.client("POST", `/api/bookings/${bk3.id}/comp-cost`, { confirmedZero: true });

  const rk = await kitchen.client("GET", "/api/me/receipt");
  const receipt = rk.data.receipt || {};
  const cur = receipt.scoreV2 && receipt.scoreV2.current;
  check("scored fixture: the payload behind the tabs is unchanged (615 counted, 344 all in, 1.8x)",
    !!cur && cur.countedBack === 615 && cur.cost && cur.cost.total === 344 && cur.score === 1.8,
    JSON.stringify(cur && { back: cur.countedBack, total: cur.cost && cur.cost.total, score: cur.score }));
  check("scored fixture: every tab's data is in the one payload (weeks, cohorts, creators, visits, halo)",
    Array.isArray(receipt.scoreV2.weeklyCounted) && receipt.scoreV2.weeklyCounted.some((w) => w.total > 0)
    && (receipt.scoreV2.cohorts || []).length >= 1 && (cur.creators || []).length >= 2 && (cur.visits || []).length === 3
    && !!cur.halo && typeof cur.versionLine === "string" && cur.versionLine.length > 0,
    JSON.stringify({ weeks: (receipt.scoreV2.weeklyCounted || []).length, cohorts: (receipt.scoreV2.cohorts || []).length, creators: (cur.creators || []).length, visits: (cur.visits || []).length }));
  check("scored fixture: the ledger summary the Overview tab carries is present (firsts tracked; the $45 return rides its row)",
    (receipt.ledger || []).length === 3 && receipt.trackedSpend === 570 && (receipt.ledger || []).some((l) => l.returns > 0 && l.returnSpend === 45),
    JSON.stringify({ ledger: (receipt.ledger || []).length, tracked: receipt.trackedSpend }));

  // ---------- forming business ----------
  const fay = await makeCreator(admin, { name: "Form Fay", email: "fay48@fixtures.dev", handle: "formfay" });
  const formingBiz = await makeBusiness(admin, { name: "Flo Owner", businessName: "Forming Fork", email: "flo48@fixtures.dev" });
  const bkF = await makeBooking(formingBiz, fay, "Forming Night");
  await completeVisit(fay, bkF, "V48FORM");
  await logFirst(formingBiz, bkF.id, 40);
  await formingBiz.client("POST", `/api/bookings/${bkF.id}/comp-cost`, { amount: 20 });
  const rf = await formingBiz.client("GET", "/api/me/receipt");
  const curF = rf.data.receipt && rf.data.receipt.scoreV2 && rf.data.receipt.scoreV2.current;
  check("forming fixture: one counted visit stays forming, with its reasons (tabs render, panels fill in)",
    !!curF && curF.state === "forming" && (curF.formingReasons || []).length > 0,
    JSON.stringify(curF && { state: curF.state, reasons: (curF.formingReasons || []).length }));

  // ---------- fresh business: no score, no tabs ----------
  const freshBiz = await makeBusiness(admin, { name: "New Owner", businessName: "Fresh Plate", email: "new48@fixtures.dev" });
  const rn = await freshBiz.client("GET", "/api/me/receipt");
  const curN = rn.data.receipt && rn.data.receipt.scoreV2 && rn.data.receipt.scoreV2.current;
  const anyScored = ((rn.data.receipt && rn.data.receipt.scoreV2 && rn.data.receipt.scoreV2.cohorts) || []).some((c) => c.score !== null);
  check("fresh fixture: nothing counted means no score content, so the client keeps the no-tabs explainer",
    !curN || (((curN.visits || []).length === 0) && !curN.tallyFacts && !(curN.countedBack > 0) && !anyScored),
    JSON.stringify(curN && { visits: (curN.visits || []).length, back: curN.countedBack }));

  // ---------- source contracts ----------
  const appSrc = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(ROOT, "public", "theme-v2.css"), "utf8");
  const slice = (from, to) => { const a = appSrc.indexOf(from); const b = appSrc.indexOf(to, a); return a > -1 && b > a ? appSrc.slice(a, b) : ""; };
  const receiptBlock = slice("function receiptHtml", "// ---------- Points and Your Line");
  const scoreBlock = slice("function scoreV2Html", "function receiptHtml");
  const creditBlock = slice("function creditPanelHtml", "function scoreV2Html");
  const count = (s, sub) => (s.match(new RegExp(sub.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  const srcChecks = [
    ["stamp: build stamp is 2026.10.30-55 on server and shell",
      fs.readFileSync(path.join(ROOT, "netlify", "functions", "lib", "build.js"), "utf8").includes('BUILD_ID = "2026.10.30-55"')
      && fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8").includes("2026.10.30-55")],
    ["tabs: the Receipt renders the subtab bar with the five plain labels",
      receiptBlock.includes("wsTabs(") && ["Overview", "Over time", "Creators", "Costs", "How it counts"].every((l) => receiptBlock.includes(`label: "${l}"`))],
    ["tabs: five panels render in one pass, one per tab, switched by class",
      ["overview", "time", "creators", "costs", "counts"].every((t) => receiptBlock.includes(`data-rc="${t}"`))
      && count(receiptBlock, 'class="rc-panel') === 5 && cssSrc.includes(".rc-panel { display: none; }") && cssSrc.includes(".rc-panel.on { display: block; }")],
    ["tabs: switching is state plus class toggles, never a rebuild (details and forms survive)",
      appSrc.includes("function receiptSetTab") && appSrc.includes('p.classList.toggle("on"') && appSrc.includes("let receiptTab = ")],
    ["map: Overview holds the score head, media/tally lines, ledger summary and Google block",
      receiptBlock.includes('data-rc="overview">${sv.head}${sv.side}${ledgerHtml}${googleHtml}')],
    ["map: Over time holds the came-backs, week chart and months parts",
      scoreBlock.includes('overTime: `${cbBlock}${weekBlock}${monthsBlock}`') && receiptBlock.includes('data-rc="time">${sv.overTime')],
    ["map: Creators holds this month's visits and the per-creator bars",
      receiptBlock.includes('data-rc="creators">${sv.creators') && scoreBlock.includes("This month's visits") && scoreBlock.includes("Who brought them")],
    ["map: Costs holds the itemized all-in block, and the ledger pointer names the tab",
      receiptBlock.includes('data-rc="costs">${sv.costs') && scoreBlock.includes("What it cost, all in") && receiptBlock.includes('under the Costs tab')],
    ["map: How it counts holds the credit panel, the capture-gap panel and the version line",
      receiptBlock.includes('data-rc="counts">${creditPanelHtml(r)}${sv.gapPanel}') && receiptBlock.includes("${esc(sv.versionLine)}") && creditBlock.includes("How SIGNL gets credit")],
    ["map: the score returns named parts now, not the old single stacked page",
      scoreBlock.includes("return {") && scoreBlock.includes("gapPanel:") && !scoreBlock.includes('ui-kicker">Your score') && receiptBlock.includes('ui-kicker">Your score')],
    ["popover: the shared info sheet renders once, outside every panel, and no longer inside the credit panel",
      count(receiptBlock, "${roasInfoPopHtml()}") === 1 && !creditBlock.includes("roasInfoPopHtml") && appSrc.includes('id="roas-info-pop"')],
    ["founding: without a score the Receipt keeps its explainer layout and renders no tab bar",
      receiptBlock.includes("const hasScore") && receiptBlock.includes("This is the screen your first visits pay into")
      && receiptBlock.includes(": `${creditPanelHtml(r)}${ledgerHtml}${googleHtml}`;")],
    ["empty rule: a tab with nothing yet gets one plain fills-in line, never an empty panel",
      receiptBlock.includes("Your counted weeks, came-backs and months land here") && receiptBlock.includes("Each visit, and the creator who brought it, lands here") && receiptBlock.includes("Your itemized costs land here")],
    ["deep link: the Sig capture-gap action selects the How it counts tab before it scrolls",
      appSrc.includes('receiptTab = "counts"') && slice("See the check", "Counting looks thin").includes("loadReceipt()")],
    ["deep link: comp-cost saves re-render through loadReceipt, so the Creators tab selection persists",
      appSrc.includes("let receiptTab = ") && slice("async function saveVisitCompCost", "function v2CostCaptureHtml").includes("loadReceipt()")],
    ["untouched: Proof Controls stays in the settings block below the Receipt, unmoved and unrenamed",
      appSrc.includes("function receiptSettingsHtml") && appSrc.includes("function proofControlsHtml") && receiptBlock.includes("${receiptSettingsHtml(r)}")],
    ["untouched: the honesty strings ride along verbatim (floor line, split labels, forming reasons)",
      scoreBlock.includes("counted dollar by dollar") && scoreBlock.includes("Counted at register") && scoreBlock.includes("Halo estimated") && scoreBlock.includes("Your score starts when there is enough counted to mean something")],
  ];
  for (const [name, ok] of srcChecks) check(name, ok);

  console.log(`\nverify-build48: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
} catch (e) {
  console.error("verify-build48 crashed:", e);
  process.exitCode = 1;
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
