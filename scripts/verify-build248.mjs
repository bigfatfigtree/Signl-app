// verify-build248.mjs — Build -248: desktop parity. The desktop
// app wears the approved mobile design laid out wide (renders
// Jeff approved 2026-11-21, ~/workspace/magpie-concepts/
// desktop-parity-2026-11-21/), plus Jeff's same-night
// correction (21:01): both desktop feeds carry a persistent
// left filter column inside the content area — search at the
// top of the column, then the mobile panel's filter set in
// its locked order (Sort, Must-haves directly under Sort,
// Category with all twelve canonical categories, the rest,
// Clear all last) — and the card grids narrow beside it
// without shrinking the cards below the mobile card's
// proportions. The Your Lineup panel stays out of desktop
// Find creators (Jeff's decision). Profiles split main +
// right rail, the Wallet's next-move card sits beside the
// money cards, Results tiles run four across with paired
// charts, Momentum gains the business-eye rail. Everything
// is additive at desktop widths; mobile is untouched.
// These are source pins; the rendered proof lives in
// scripts/qa-build248.py + docs/build-248-proof/.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");
const css248 = css.slice(css.indexOf("Build -248 (Jeff, 2026-11-21): DESKTOP PARITY"));

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 220) : ""}`); }
}

console.log("== Build -248: desktop parity + the filter-column correction ==");
check("build stamp is >= 2026.11.21-248 and agrees in both homes",
  (() => { const a = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").match(/BUILD_ID = "2026\.11\.21-(\d+)"/); const b = fs.readFileSync(path.join(root, "public/index.html"), "utf8").match(/window\.__SIGNL_BUILD__ = "2026\.11\.21-(\d+)"/); return !!a && !!b && a[1] === b[1] && Number(a[1]) >= 248; })(), "");

// --- the filter column (Jeff's correction) -------------------
check("discover rail carries the column search at its top",
  app.includes('id="f-q-rail"') && app.includes("discQInputRail248(this)") && app.includes('class="df-group rail-search248"'));
check("column search writes through to the main search input",
  app.includes('function discQInputRail248(el)') && app.includes('document.getElementById("f-q")'));
check("offers rail carries the column search at its top",
  app.includes('id="fo-q-rail"') && app.includes("foQInputRail248(this)"));
check("offers column search refocuses the column field, not the main one",
  app.includes("state.foQRailFocus248") && app.includes('document.getElementById("fo-q-rail")'));
check("discover column order: Must-haves, then Category, then Match to a campaign",
  (() => { const body = app.slice(app.indexOf("async function loadDiscover()"), app.indexOf("function lineupDismissKey")); const mh = body.indexOf('<div class="df-label">Must-haves</div>'); const cat = body.indexOf('<div class="df-label">Category</div>'); const camp = body.indexOf('<div class="df-label">Match to a campaign</div>'); return mh > 0 && cat > mh && camp > cat; })(), "");
check("both rails end their groups with a desktop Clear all",
  (app.match(/rail-clear248/g) || []).length >= 2 && app.includes('onclick="return discClearAll()">Clear all') && app.includes('onclick="return foClearAll()">Clear all'));
check("column pieces are hidden below desktop width (mobile unchanged)",
  css.includes(".rail-search248, .rail-clear248 { display: none; }"));
check("desktop column: 300px rail beside the grid on both feeds",
  css248.includes(".shop-layout:has(> #disc-rail), .shop-layout:has(> #fo-rail) { grid-template-columns: 300px minmax(0, 1fr); }"));
check("desktop column: search group shows, main search row stands down",
  css248.includes(".rail-search248 { display: block; }")
  && css248.includes(".shop-layout:has(> #disc-rail) .shop-searchrow, .shop-layout:has(> #fo-rail) .shop-searchrow { display: none; }"));
check("desktop feeds: cards two across beside the column, one across on narrow desktops",
  css248.includes('#discover-results .shelf-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }')
  && css248.includes('#cr-findoffers .mirror-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }')
  && css248.includes("@media (min-width: 1024px) and (max-width: 1279px)"));
check("desktop Find creators: the Lineup panel stays out",
  css248.includes("#lineup-slot { display: none; }"));
check("the phone rail is still the bottom sheet (base drawer rules intact)",
  css.includes(".shop-rail {\n    display: block; position: fixed; left: 0; right: 0; bottom: 0;"));

// --- the wide layouts ----------------------------------------
check("creator profile: two-column shell + Standout rail card hooks",
  app.includes('class="panel pdp248"') && app.includes("pdpStandout248Html") && app.includes("pdp248-railslot"));
check("business profile: two-column shell hook",
  app.includes('class="bizp248"'));
check("wallet: money-top wrap hook", app.includes('class="wallet248-top"'));
check("results: charts wrap hook", app.includes('class="charts248"'));
check("momentum: main + business-eye rail hooks",
  app.includes("momRail248Html") && app.includes('class="mom248"') && app.includes("How businesses see you"));
check("desktop CSS: profile, wallet, results and momentum grids present",
  css248.includes(".pdp248 {") && css248.includes(".bizp248 {") && css248.includes(".wallet248-top {")
  && css248.includes(".j226-tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); }")
  && css248.includes(".charts248 {") && css248.includes(".mom248 {"));
check("desktop-only pieces stay hidden below desktop width",
  css.includes(".pdp248-onlyd, .mom248-rail { display: none; }"));

console.log(`\nverify-build248: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
