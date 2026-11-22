// Build -247 verification: the Momentum view text cut (Jeff,
// 2026-11-21 20:01 ET, on the live -245 Momentum screenshot:
// "Still too much text just pasted on a screen"; and the
// visual-first rule the same evening: screens are more visual
// than text, explanations live behind info buttons, bars and
// tap sheets, never pasted onto the page as paragraphs).
//
// The cut, asserted here:
//   - the POINTS_WHY_LONG paragraph no longer renders on the
//     Momentum view, and its const is retired entirely;
//   - the "Earned for on-time posts..." prose paragraph is gone
//     from the panel; its one conditional fact (the floor) stays
//     as its own short line, shown only when it applies;
//   - the view keeps exactly what Jeff kept: the number card
//     with its next-step line, the ladder meter with the points
//     pill, the computed gap line, the one list line, and the
//     Ways to earn rows;
//   - the "not money, never a booking" fact moved into the blue
//     check explainer sheet (the -245 tap sheet), EN + ES, as
//     one short line;
//   - presentation only: points math, thresholds, the derive,
//     the moments and Maggie's numbers are untouched.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; failures.push(name + (detail ? " — " + detail : "")); console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const appJs = read("public/app.js");
const routerJs = read("netlify/functions/lib/router.js");
const buildJs = read("netlify/functions/lib/build.js");
const indexHtml = read("public/index.html");

function slice(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) return "";
  const b = endMarker ? src.indexOf(endMarker, a + startMarker.length) : -1;
  return src.slice(a, b < 0 ? undefined : b);
}
const count = (src, needle) => src.split(needle).length - 1;

// ---------- stamp ----------
const stampNum = (s) => { const m = /2026\.11\.21-(\d+)/.exec(s || ""); return m ? Number(m[1]) : 0; };
check("stamp: BUILD_ID is -247 or later", stampNum(buildJs) >= 247, buildJs.slice(0, 120));
check("stamp: shell __SIGNL_BUILD__ is -247 or later", stampNum(indexHtml) >= 247);

// ---------- the cut ----------
check("cut: POINTS_WHY_LONG is retired (no const, no render, nowhere in app.js)",
  !appJs.includes("POINTS_WHY_LONG"));
check("cut: the long paragraph text itself is gone from the client",
  !appJs.includes("Points are priority. They move you up the list businesses choose from when you apply"));
check("cut: the Earned-for prose paragraph is gone",
  !appJs.includes("Earned for on-time posts, a complete profile, reviews and invites."));

const panel = slice(appJs, "function momentumHtml(u)", "function fmtNum");
check("panel: still renders the meter, the points pill, Ways to earn and Points history",
  panel.includes("momentumMeter226Html(m)") && panel.includes("badge info")
  && panel.includes("Ways to earn") && panel.includes("Points history"));
check("panel: the floor fact survives as its own conditional line, not a paragraph tail",
  panel.includes("m.floorApplied") && panel.includes("Your total never drops below zero.")
  && !panel.includes("Earned for"));

const meter = slice(appJs, "function momentumMeter226Html(m)", "function momentumHtml(u)");
check("meter: all four levels still marked (Starter 0, Regular 100, Standout 300, Cornerstone 750)",
  ["Starter 0", "Regular 100", "Standout 300", "Cornerstone 750"].every((s) => meter.includes(s)));
check("meter: thresholds untouched (cap 750, check at 300)",
  meter.includes("const cap = 750") && meter.includes("pts >= 300") && meter.includes("const gap = 300 - pts"));
check("meter: the computed gap line stays (EN + ES)",
  meter.includes("points to the blue check. Inviting creators is the fastest way.")
  && meter.includes("puntos para la insignia azul. Invitar creadoras es la forma más rápida."));
check("meter: the one list line stays (EN + ES)",
  meter.includes("More Momentum, higher on the list businesses see.")
  && meter.includes("Más Momentum, más arriba en la lista que ven los negocios."));

const tab = slice(appJs, "function renderMomentumTab()", "// Creator Earnings");
check("tab: the number card stays with its next-step line",
  tab.includes("Your Momentum") && tab.includes("Next:") && tab.includes("momentumHtml(u)"));

// ---------- the relocation ----------
// Build -250 re-pin (flagged): the sheet function gained (mode, points)
// params for the state-aware wording; the slice anchor follows the new
// signature. Every content pin below is unchanged and runs in full.
const sheet = slice(appJs, "function blueCheckSheet226Html(", "function openBlueCheck226(");
check("sheet: the not-money line moved here (EN)",
  sheet.includes("Points are not money, and they never promise a booking."));
check("sheet: the not-money line moved here (ES)",
  sheet.includes("Los puntos no son dinero y nunca prometen una reserva."));
check("sheet: the -245 sheet facts are intact (300, 18 hours early, never bought, EN + ES)",
  sheet.includes("300 Momentum points") && sheet.includes("18 hours early") && sheet.includes("earned, never bought")
  && sheet.includes("300 puntos de Momentum") && sheet.includes("18 horas antes") && sheet.includes("nunca se compra"));

// ---------- presentation only: math + canon untouched ----------
const derive = slice(routerJs, "function blueCheckFromPoints(points)", "\n}\n");
check("math: blueCheckFromPoints is still the pure ledger-points derive at the same threshold constant",
  derive.includes("(Number(points) || 0) >= BLUE_CHECK_POINTS"));
check("canon: POINTS_WHY_SHORT still defined once and still rendered on its other surfaces",
  count(appJs, "const POINTS_WHY_SHORT = ") === 1 && count(appJs, "${POINTS_WHY_SHORT}") >= 3);
check("copy: no em dashes in the changed view or sheet",
  !panel.includes("—") && !sheet.includes("—"));

console.log(`\nverify-build247: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
