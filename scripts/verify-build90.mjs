#!/usr/bin/env node
// Build -90 verification: the creator completion trio (Tier 1
// item 5, Jeff ordered 2026-11-02). Three parts, all in the
// creator surfaces of public/app.js; server behavior (Build -65
// gate math, Build -63 stored shares, Build -85 claim) does not
// change. This suite proves:
//   (a) the four gate fields live in their own top card headed
//       "Finish these four to get booked" with the everything-
//       below-is-optional line, the Finish/checklist actions
//       anchor-scroll to that card, and saving the four fields
//       through the profile write completes the gate exactly as
//       before (invisible before, discoverable + able to apply
//       after);
//   (b) the multi-market section explains itself ABOVE the rows
//       ("Optional", the 5% floor in plain words), defaults to
//       ONE row, adds/removes rows, uses the claim form's
//       grouped searchable market picker, and saved two-market
//       data round-trips through the profile write unchanged;
//   (c) a zero-offer approved creator's board is the founding
//       empty state (their standing in their own market + the
//       email promise + the one useful action while anything is
//       incomplete) and never the "looked through 0 offers"
//       end card, while a creator WITH an offer sees the normal
//       board.
// Run: node scripts/verify-build90.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8964;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b90.dev";
const ADMIN_PASSWORD = "Verify90Admin!1";
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 240) : ""}`); }
}
function segment(text, startNeedle, endNeedle) {
  const a = text.indexOf(startNeedle);
  const b = a < 0 ? -1 : text.indexOf(endNeedle, a + startNeedle.length);
  return a < 0 || b < 0 ? "" : text.slice(a, b);
}

// ---------- static: the client surfaces ----------
console.log("== Static: the three creator surfaces ==");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const formSeg = segment(appJs, "function creatorProfileHtml(u)", "function myRatingHtml(card)");
check("profile editor found in app.js", formSeg.length > 4000, `len=${formSeg.length}`);

// (a) the four-basics card
const basicsAt = formSeg.indexOf('id="profile-basics"');
const aboutAt = formSeg.indexOf('"About you"');
const basicsSeg = basicsAt >= 0 && aboutAt > basicsAt ? formSeg.slice(basicsAt, aboutAt) : "";
check("(a) four-basics card exists and is the first group in the form",
  basicsAt >= 0 && basicsAt < aboutAt && formSeg.indexOf('class="fgroup') === formSeg.indexOf('class="fgroup tint" id="profile-basics"') || (basicsAt >= 0 && basicsAt < aboutAt && formSeg.slice(0, basicsAt).lastIndexOf('class="fgroup') === -1),
  `basicsAt=${basicsAt} aboutAt=${aboutAt}`);
check("(a) card is headed 'Finish these four to get booked'",
  basicsSeg.includes('class="four-basics-heading"') && basicsSeg.includes("Finish these four to get booked"));
check("(a) card carries the everything-below-is-optional line",
  basicsSeg.includes("Everything below is optional"));
check("(a) card holds the home-city field", basicsSeg.includes('id="p-city"') || basicsSeg.includes('id="p-city-text"'));
check("(a) card holds the audience/stacked-followers fields",
  basicsSeg.includes("Your audience size") && basicsSeg.includes('id="p-stack-total"') && basicsSeg.includes("SIGNL starts at 500 total followers across your platforms"));
check("(a) card holds the categories picker", basicsSeg.includes("What you create in") && basicsSeg.includes("${cats}"));
check("(a) card holds the local % field", basicsSeg.includes('id="p-localpct"'));
check("(a) the four gate fields render once (no duplicate gate inputs below)",
  (appJs.match(/id="p-localpct"/g) || []).length === 1 && (appJs.match(/id="p-stack-total"/g) || []).length === 1);
const goSeg = segment(appJs, "function goFinishProfile()", "function gateCardHtml(u)");
check("(a) goFinishProfile anchor-scrolls to the four-basics card",
  goSeg.includes('document.getElementById("profile-basics")') && goSeg.includes("scrollIntoView"));
const gateSeg = segment(appJs, "function gateCardHtml(u)", "// ---------- Overhaul V2");
check("(a) the offers gate card's Finish button uses the anchor action", gateSeg.includes('onclick="return goFinishProfile()"'));
const completionSeg = segment(appJs, "function profileCompletionHtml(u)", "function momentumHtml(u)");
check("(a) the dashboard checklist card's Finish button uses the anchor action",
  completionSeg.includes('onclick="return goFinishProfile()"') && completionSeg.includes("Finish my profile"));

// (b) multi-market rows
const helpAt = formSeg.indexOf('id="p-am-help"');
const rowsAt = formSeg.indexOf('id="p-am-rows"');
check("(b) the Optional explanation sits ABOVE the rows in DOM order",
  helpAt >= 0 && rowsAt > helpAt);
const helpSeg = helpAt >= 0 ? formSeg.slice(helpAt, rowsAt > helpAt ? rowsAt : helpAt + 900) : "";
check("(b) explanation opens with 'Optional.' and states the 5% floor in plain words",
  helpSeg.includes("Optional.") && helpSeg.includes("At 5% or more you are listed and ranked in that market too"));
check("(b) one row by default when nothing is saved",
  formSeg.includes("(rows.length ? rows : [{}])"));
check("(b) 'Add another market' adds rows and rows are removable",
  formSeg.includes('id="p-am-add"') && formSeg.includes('onclick="return amAddRow()"') && appJs.includes("function amAddRow()") && appJs.includes("function amRemoveRow(btn)") && appJs.includes("host.appendChild(tmp.firstElementChild)"));
const amOptsSeg = segment(appJs, "function audienceMarketOptions(", "// Multi-market audience rows");
check("(b) rows use the claim picker's grouped-by-country options",
  amOptsSeg.includes("<optgroup") && amOptsSeg.includes("byCountry"));
const amRowSeg = segment(appJs, "function amRowHtml(", "function amRowCount()");
check("(b) each row carries the claim search-then-pick pattern",
  amRowSeg.includes('class="p-am-search"') && amRowSeg.includes("filterAmOptions(this)") && amRowSeg.includes("Search markets, for example: Dubai") && amRowSeg.includes('class="p-am-market"'));
check("(b) the row filter hides emptied country groups like the claim filter",
  appJs.includes("function filterAmOptions(input)") && segment(appJs, "function filterAmOptions(input)", "// The search box above the market picker").includes("optgroup"));
check("(b) the save still reads the same per-market share shape",
  appJs.includes('row.querySelector(".p-am-market")') && appJs.includes('row.querySelector(".p-am-pct")') && appJs.includes("audienceMarkets: Array.from"));

// (c) founding empty state
const emptySeg = segment(appJs, "function offersEmptyLine()", "function boardError(");
check("(c) founding line names the roster standing + market (market not open)",
  emptySeg.includes("You are on the founding roster for") && emptySeg.includes("state.user.founding.marketLive === false"));
check("(c) founding line carries the email promise (market not open)",
  emptySeg.includes("we email you the moment the first business posts"));
check("(c) approved creators get the founding standing + email promise even when the market reads live",
  emptySeg.includes("You are an approved founding creator in") && emptySeg.includes("we email you the moment a new one posts"));
check("(c) the empty panel is the named founding empty state",
  emptySeg.includes('class="empty-state founding-empty"') && emptySeg.includes("function foundingOffersEmptyHtml(") && emptySeg.includes("No offers yet in"));
check("(c) the empty state offers the one useful action while anything is incomplete",
  emptySeg.includes("function foundingEmptyActionHtml()") && emptySeg.includes("Finish your profile") && emptySeg.includes("Add your rates") && emptySeg.includes("goFinishProfile()"));
const emptyRendered = emptySeg.split("\n").filter((l) => l.includes("return `")).join("\n");
check("(c) zero-state rendered copy contains no '0 offers' phrasing",
  !emptyRendered.includes("0 offers") && !emptyRendered.includes("looked through"), emptyRendered.slice(0, 200));
const endSeg = segment(appJs, "function offersEndHtml", "// ---------- creator-side preview");
check("(c) the deck end card returns the founding state at zero, before any recap copy",
  endSeg.includes("if (!all.length || !total) return foundingOffersEmptyHtml();") && endSeg.indexOf("return foundingOffersEmptyHtml()") < endSeg.indexOf("You looked through"));
const boardSeg = segment(appJs, "async function loadOpenBoard()", "// One offer card, two surfaces");
check("(c) the board's zero branch renders the founding state (early-access line rides inside it)",
  boardSeg.includes("if (!data.offers.length)") && boardSeg.includes("foundingOffersEmptyHtml(eaLine)"));
check("(c) the non-zero board still renders real offer cards",
  boardSeg.includes("renderOpenBoard()") && appJs.includes("function renderOpenBoard()") && segment(appJs, "function renderOpenBoard()", "function offersEndHtml").includes("offerFeedCardHtml"));

// canon guards
check("canon: stamp is 2026.11.02-90 on both sides",
  fs.readFileSync(path.join(root, "netlify", "functions", "lib", "build.js"), "utf8").includes('BUILD_ID = "2026.11.02-90"') && fs.readFileSync(path.join(root, "public", "index.html"), "utf8").includes("2026.11.02-90"));
check("canon: the 500 minimum line still rides the basics card",
  basicsSeg.includes("<strong>SIGNL starts at 500 total followers across your platforms</strong>"));

// ---------- live: gate math + round-trip + boards ----------
class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}
function startServer(db, port) {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL, ADMIN_PASSWORD };
  const s = spawn("node", ["scripts/dev-server.mjs", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  s.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return s;
}
async function waitUp(base) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not come up on ${base}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b90-"));
const DB = path.join(tmp, "db.json");
console.log("== Live: the gate, the shares, the boards ==");
const server = startServer(DB, PORT);
try {
  await waitUp(BASE);
  const admin = new Client(BASE);
  const login = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", login.status === 200 && login.data.user && login.data.user.role === "admin", `status=${login.status}`);

  // The founding business (approved + activated, Nashville).
  const biz = new Client(BASE);
  const bizReg = await biz.req("POST", "/api/auth/register", {
    role: "business", name: "Nash Owner", businessName: "B90 Tacos", email: "b90biz@fixtures.dev",
    password: "Verify90Biz!1", market: "Nashville", city: "Nashville", category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  check("business registers", bizReg.status === 201, `status=${bizReg.status}`);
  const bizId = bizReg.data.user.id;
  await admin.req("POST", "/api/admin/review", { userId: bizId, decision: "approve" });
  const act = await admin.req("POST", "/api/admin/businesses/activate", { userId: bizId });
  check("business approved + activated", act.status === 200 && act.data.user.business.accessState === "active", `status=${act.status}`);

  // The unfinished creator: nothing counted yet.
  const cr = new Client(BASE);
  const crReg = await cr.req("POST", "/api/auth/register", {
    role: "creator", name: "B90 Creator", email: "b90creator@fixtures.dev", password: "Verify90Cr!1",
    market: "Nashville", city: "Nashville", handle: "b90creator", followerCount: 0,
    localAudiencePct: 60, categories: ["Food & Drink"], ...AGREE,
  });
  check("(a) unfinished creator registers incomplete", crReg.status === 201 && crReg.data.user.creator.profileComplete === false, `status=${crReg.status} complete=${crReg.data.user && crReg.data.user.creator && crReg.data.user.creator.profileComplete}`);
  const crId = crReg.data.user.id;
  const crApprove = await admin.req("POST", "/api/admin/review", { userId: crId, decision: "approve" });
  check("(a) creator approved while unfinished (0 = not stated)", crApprove.status === 200 && crApprove.data.user.status === "approved", `status=${crApprove.status}`);
  const discBefore = await biz.req("GET", "/api/discover?market=Nashville");
  check("(a) unfinished creator is invisible to businesses", !(discBefore.data.creators || []).some((c) => c.userId === crId));
  const boardBefore = await cr.req("GET", "/api/open-offers");
  check("(c) zero-offer precondition: the approved creator's board payload is empty", boardBefore.status === 200 && (boardBefore.data.offers || []).length === 0, `n=${(boardBefore.data.offers || []).length}`);

  // Finish through the card: the exact profile write the editor
  // sends (city, stacked audience, categories, local %).
  const save = await cr.req("PATCH", "/api/me/profile", {
    city: "Nashville",
    followerCount: 9000,
    audienceStack: { instagram: 9000 },
    categories: ["Food & Drink"],
    localAudiencePct: 60,
  });
  check("(a) saving the four basics returns 200", save.status === 200, `status=${save.status}`);
  const meAfter = await cr.req("GET", "/api/auth/me");
  check("(a) the gate completes identically (Build -65 math)",
    meAfter.data.user.creator.profileComplete === true && meAfter.data.user.profileCompletion.complete === true,
    `complete=${meAfter.data.user.creator.profileComplete}`);
  check("(a) the 500 gate reads the stacked total (9,000 counted)",
    meAfter.data.user.creator.totalAudience === 9000, `total=${meAfter.data.user.creator.totalAudience}`);
  const discAfter = await biz.req("GET", "/api/discover?market=Nashville");
  check("(a) finished creator becomes visible/bookable in discovery",
    (discAfter.data.creators || []).some((c) => c.userId === crId));

  // (b) two-market round-trip through the same write.
  const mmSave = await cr.req("PATCH", "/api/me/profile", {
    audienceMarkets: [{ market: "Austin", pct: 20 }, { market: "Denver", pct: 10 }],
  });
  check("(b) two-market save stores both shares in order",
    mmSave.status === 200 && JSON.stringify(mmSave.data.user.creator.audienceMarkets) === JSON.stringify([{ market: "Austin", pct: 20 }, { market: "Denver", pct: 10 }]),
    JSON.stringify(mmSave.data.user && mmSave.data.user.creator && mmSave.data.user.creator.audienceMarkets));
  const meMm = await cr.req("GET", "/api/auth/me");
  check("(b) saved two-market data reads back unchanged",
    JSON.stringify(meMm.data.user.creator.audienceMarkets) === JSON.stringify([{ market: "Austin", pct: 20 }, { market: "Denver", pct: 10 }]),
    JSON.stringify(meMm.data.user.creator.audienceMarkets));
  const founding = await cr.req("GET", "/api/me/founding");
  check("(b) the dashboard card lists home + both saved markets at/above the 5% floor",
    JSON.stringify(((founding.data.card || {}).listedMarkets || []).map((e) => [e.market, e.pct])) === JSON.stringify([["Nashville", 60], ["Austin", 20], ["Denver", 10]]),
    JSON.stringify((founding.data.card || {}).listedMarkets));
  const noWipe = await cr.req("PATCH", "/api/me/profile", { bio: "Round-trip guard bio, long enough to matter here." });
  check("(b) a save without the rows never wipes the stored shares",
    noWipe.status === 200 && JSON.stringify(noWipe.data.user.creator.audienceMarkets) === JSON.stringify([{ market: "Austin", pct: 20 }, { market: "Denver", pct: 10 }]),
    JSON.stringify(noWipe.data.user && noWipe.data.user.creator && noWipe.data.user.creator.audienceMarkets));

  // (c) with an offer, the normal board answers.
  const offer = await biz.req("POST", "/api/offers", { title: "B90 tasting night", whatComped: "Tasting menu for two", dollarCap: 100, spots: 2, visitWindow: "Any evening this week" });
  check("(c) business posts an open offer", offer.status === 201 && offer.data.offer.status === "open", `status=${offer.status}`);
  const boardAfter = await cr.req("GET", "/api/open-offers");
  check("(c) a creator WITH an offer sees it on the normal board",
    (boardAfter.data.offers || []).some((o) => o.id === offer.data.offer.id), `n=${(boardAfter.data.offers || []).length}`);
  const apply = await cr.req("POST", `/api/offers/${offer.data.offer.id}/apply`, {});
  check("(a/c) the finished creator can apply (bookable the same way as before)",
    apply.status === 200 || apply.status === 201, `status=${apply.status} ${JSON.stringify(apply.data).slice(0, 160)}`);
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
}

console.log(`\nBuild -90 verify: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
