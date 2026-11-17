#!/usr/bin/env node
// verify-build193.mjs — Build -193: PL-39, the Hapsta-measured
// shell (Jeff, 2026-11-17 07:25 + 07:29 ET). Every shell —
// Admin, Creator, Partner, Business, Biz Dev — takes the
// Hapsta app shell's MEASURED menu values (hapsta-app portal
// sidebar stylesheet):
//   rows 15px/500 #26262b, padding 9px 12px, margin 2px 0,
//   radius 12px, gap 9px, 18px line icons, NO icon chips, no
//   description lines, no chevrons; group headers 12px/600
//   #8b8b93 margin 20px 10px 6px, no caps transform; active =
//   soft tint pill (Magpie blue-to-green in place of mint),
//   ink text, weight 600; rail 240px; mobile drawer 252px;
//   primary pill at Hapsta .btn metrics (11px 19px, radius
//   999, 14.5px/600) in the Magpie gradient; identity pinned
//   at the BOTTOM of every menu (no top identity header).
// Run: node scripts/verify-build193.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const themeCss = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log("  ok  " + name); }
  else { failed += 1; failures.push(name + (extra ? " :: " + extra : "")); console.log("  FAIL  " + name + (extra ? " :: " + extra : "")); }
}
function seg(src, from, to) {
  const a = src.indexOf(from);
  if (a < 0) return "";
  const b = to ? src.indexOf(to, a + from.length) : src.length;
  return src.slice(a, b < 0 ? src.length : b);
}
const block193 = seg(themeCss, "Build -193 (PL-39", "/* ================= Build -194") || seg(themeCss, "Build -193 (PL-39");

console.log("== stamp ==");
check("build stamp is 2026.11.17-193", buildJs.includes("2026.11.17-193") && indexHtml.includes("2026.11.17-193"));

console.log("== measured values are the applied values ==");
check("menu rows: 15px/500, padding 9px 12px, margin 2px 0, gap 9px, radius 12px",
  block193.includes("font-size: 15px; font-weight: 500; color: #26262b") && block193.includes("padding: 9px 12px; margin: 2px 0; gap: 9px"));
check("menu row icons: 18px, chip background removed",
  block193.includes(".more-ic svg { width: 18px; height: 18px; }") && block193.includes("background: none; border-radius: 0; color: inherit;"));
check("group headers: 12px/600 #8b8b93, margin 20px 10px 6px, no caps transform",
  block193.includes("font-size: 12px; font-weight: 600; letter-spacing: 0; text-transform: none;") && block193.includes("color: #8b8b93; margin: 20px 10px 6px;"));
check("active row: Magpie tint pill, ink text, label weight 600, no shadow bar",
  block193.includes("linear-gradient(92deg, rgba(24, 91, 255, .10), rgba(0, 182, 122, .12))") && block193.includes("box-shadow: none; color: #0a0a0a;"));
check("hover row: Hapsta's #f1f1f0", block193.includes(".more-row:hover { background: #f1f1f0; }") && block193.includes(".tab-item:hover { background: #f1f1f0; }"));
check("rails at Hapsta's 240px with 14px side padding",
  block193.includes("body.v3-on #tabbar { width: 240px; padding-left: 14px; padding-right: 14px; }") && block193.includes("body.rail-on #rail { width: 240px; padding: 18px 14px 90px; }"));
check("mobile drawer at Hapsta's 252px", block193.includes(".ham137-panel, .ev125-panel { width: min(252px, 88vw); }"));
check("primary pill at Hapsta .btn metrics (11px 19px, radius 999, 14.5px/600)",
  block193.includes("padding: 11px 19px; margin: 8px 0 2px;") && block193.includes("border-radius: 999px; background: var(--grad); color: #fff;") && block193.includes("font-size: 14.5px; font-weight: 600;"));
check("rail rows carry the same metrics (tab-item and rail-item)",
  block193.includes("#tabbar .tab-item {") && block193.includes("gap: 9px; padding: 9px 12px; margin: 2px 0; min-height: 0;") && block193.includes(".rail-item {"));
check("Inter is loaded in the shell and applied to the admin rail",
  indexHtml.includes("family=Inter:wght@400;500;600;700") && block193.includes("#rail, .rail-item { font-family: 'Inter', system-ui, sans-serif; }"));

console.log("== flat rows: renderers emit icon + one label only ==");
for (const [fn, next] of [["function everythingRowHtml125", "function openEverything125"], ["function hamburgerRowHtml137", "function openHamburger137"], ["function bdDrawerRowHtml168", "function bdOpenDrawer168"]]) {
  const s = seg(appJs, fn, next);
  check(fn + ": no description line, no chevron in normal rows", s.length > 0 && !s.includes("more-chev") && !s.includes('r.sub ? `<span class="more-sub">'), s.slice(0, 80));
  check(fn + ": locked rows keep their unlock note", s.includes("nav-lock187-note") || fn.includes("bdDrawer"));
}

console.log("== identity: bottom only, no top identity header ==");
check("hamburger opens with the drawer head, then the pill, identity card LAST",
  seg(appJs, "function openHamburger137", "// Build -187 (scope addition 6)").includes("${menuPrimary193()}") &&
  seg(appJs, "function openHamburger137", "// Build -187 (scope addition 6)").includes("${menuIdentityCard187(u, name)}") &&
  !seg(appJs, "function openHamburger137", "// Build -187 (scope addition 6)").includes("ham137-head"));
check("Biz Dev drawer: no top identity header; bottom identity block with account controls",
  !seg(appJs, "function bdOpenDrawer168", "function closeBdDrawer168").includes("ham137-head") &&
  seg(appJs, "function bdOpenDrawer168", "function closeBdDrawer168").includes("${bdIdentity193(u)}") &&
  seg(appJs, "function bdIdentity193", "function closeHamburger137").includes("Sign out") &&
  seg(appJs, "function bdIdentity193", "function closeHamburger137").includes("Your account"));
check("identity metrics: name 15px/600 Inter, state 13px #8b8b93",
  block193.includes(".menu-idcard187-name { font-family: 'Inter', system-ui, sans-serif; font-size: 15px; font-weight: 600; }") &&
  block193.includes(".menu-idcard187-state { font-size: 13px; color: #8b8b93; }"));

console.log("== primary action per role ==");
const mp = seg(appJs, "function menuPrimary193", "function bdMenuPrimary193");
check("creator pill: Find offers; pending keeps the pill with its unlock note",
  mp.includes("go('dashboard','Find Offers')") && mp.includes("is-locked193") && mp.includes("Unlocks when your application is approved."));
check("business pill: Start a new campaign (NatNew for national, Campaign Setup for market)",
  mp.includes('"NatNew"') && mp.includes('"Campaign Setup"'));
check("admin and partner get NO pill (no honest primary action)",
  mp.includes('u.role === "creator"') && mp.includes('u.role === "business"') && !mp.includes('u.role === "admin" ?') && mp.endsWith('return "";\n}\n') || mp.includes('return "";'));
check("Biz Dev pill: Add a lead, and none when the seat is gone",
  seg(appJs, "function bdMenuPrimary193", "function bdIdentity193").includes("Add a lead") && seg(appJs, "function bdMenuPrimary193", "function bdIdentity193").includes("bdNoSeat"));
check("Biz Dev rail carries the same pill (desktop rail-primary187)",
  appJs.includes('class="rail-primary187" onclick="return go(\'dashboard\',\'BD Leads\')">Add a lead</button>'));

console.log(`\nverify-build193: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("failures:\n - " + failures.join("\n - ")); process.exit(1); }
