#!/usr/bin/env node
// verify-build194.mjs — Build -194: the PL-39 delta fix for the
// two measured misses the -193 review caught.
//   B1: menu rows computed borderRadius 16px (theme-v2's
//       body.v3-on .more-row, specificity 0,2,1, outranked the
//       -193 rule's 0,2,0). The -194 block in theme-v3.css scopes
//       the radius rule to the menu panels at 0,3,1.
//   B2: the identity avatar measured 44px in menus / 40px at the
//       rail foot; Hapsta's .avatar is 52px. Both are 52px now.
// HARDENING (the point of this suite): -193 pinned the radius by
// source string and shipped a false "matched". Every style
// assertion below reads COMPUTED styles from a rendered page
// (scripts/verify-build194-probe.py, Playwright + the local dev
// server + seeded fixture users, one per shell) — no source
// string is ever accepted as evidence of a rendered value. The
// only source checks here are the build stamp, which is not a
// style.
// Run: node scripts/verify-build194.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log("  ok  " + name); }
  else { failed += 1; failures.push(name + (extra ? " :: " + extra : "")); console.log("  FAIL  " + name + (extra ? " :: " + extra : "")); }
}

console.log("== stamp ==");
check("BUILD_ID is 2026.11.17-194", buildJs.includes('exports.BUILD_ID = "2026.11.17-194"'));
check("shell carries 2026.11.17-194 x5", (indexHtml.match(/2026\.11\.17-194/g) || []).length === 5);
check("no -193 stamp remains in build lib or shell", !buildJs.includes("2026.11.17-193") && !indexHtml.includes("2026.11.17-193"));

console.log("== rendered probe (computed styles, not source strings) ==");
let metrics = null;
try {
  const out = execFileSync("python3", [path.join(ROOT, "scripts/verify-build194-probe.py")],
    { cwd: ROOT, timeout: 600000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("PROBE194 "));
  if (line) metrics = JSON.parse(line.slice("PROBE194 ".length));
} catch (e) {
  console.log("  probe error: " + String(e && e.message || e).slice(0, 300));
}
check("rendered probe produced metrics for all shells", !!metrics && Object.keys(metrics).length >= 12,
  metrics ? Object.keys(metrics).join(",") : "no metrics");

const MENUS = ["creator", "business", "national", "partner", "bizdev", "admin"];
const near = (v, target, tol) => typeof v === "number" && Math.abs(v - target) <= tol;

if (metrics) {
  for (const role of MENUS) {
    const m = metrics[role + "_menu"];
    check(`${role} menu: panel rendered with rows`, !!m && !m.missing && m.rows.length >= 3,
      m ? (m.missing || `${m.rows.length} rows`) : "absent");
    if (!m || m.missing) continue;
    check(`${role} menu: EVERY row computes borderRadius 12px`,
      m.rows.every((r) => r.radius === "12px"), [...new Set(m.rows.map((r) => r.radius))].join(","));
    check(`${role} menu: every row height is 37px`,
      m.rows.every((r) => near(r.h, 37, 1)), [...new Set(m.rows.map((r) => r.h))].join(","));
    check(`${role} menu: rows compute Inter 15px/500`,
      m.rows.every((r) => r.fontSize === "15px" && r.fontWeight === "500" && /Inter/.test(r.fontFamily)),
      [...new Set(m.rows.map((r) => `${r.fontSize}/${r.fontWeight}/${r.fontFamily}`))].join(" | ").slice(0, 160));
    // Pitch: 37px rows with 2px margins — 41px margin-box, which
    // renders as 39px top-to-top (adjacent margins collapse).
    // Hapsta's own reference panel measures the same 39px.
    check(`${role} menu: row pitch holds (39px top-to-top, 41px margin-box)`,
      near(m.pitch, 39, 1) && m.rows.every((r) => r.marginTop === "2px"),
      `top-to-top ${m.pitch}, margins ${[...new Set(m.rows.map((r) => r.marginTop))].join(",")}`);
    check(`${role} menu: identity avatar computes 52px`,
      !!m.avatar && near(m.avatar.w, 52, 0.6) && near(m.avatar.h, 52, 0.6) && m.avatar.cw === "52px" && m.avatar.ch === "52px",
      JSON.stringify(m.avatar));
    check(`${role} menu: identity name 15px/600, state line 13px #8b8b93`,
      !!m.idName && m.idName.size === "15px" && m.idName.weight === "600" &&
      !!m.idState && m.idState.size === "13px" && m.idState.color === "rgb(139, 139, 147)",
      JSON.stringify([m.idName, m.idState]));
    check(`${role} menu: no icon chips, no chevrons (computed)`,
      m.rows.every((r) => (r.chev === null || r.chev === "none") && (r.chipBg === "rgba(0, 0, 0, 0)" || r.chipBg === "transparent")),
      [...new Set(m.rows.map((r) => `${r.chev}/${r.chipBg}`))].join(" | ").slice(0, 160));
    check(`${role} menu: active pill present, identity block last, images loaded`,
      !!m.activeBg && m.activeBg.includes("linear-gradient") && m.identityLast === true && m.imgsOk === true,
      JSON.stringify({ active: !!m.activeBg, last: m.identityLast, imgs: m.imgsOk }));
    if (m.header) check(`${role} menu: group header 12px/600 #8b8b93, no caps transform`,
      m.header.size === "12px" && m.header.weight === "600" && m.header.color === "rgb(139, 139, 147)" && m.header.transform === "none",
      JSON.stringify(m.header));
  }
  // Desktop rails: the creator rail in full, every rail for radius.
  const rail = metrics["creator_rail"];
  check("creator rail: rendered with rows", !!rail && !rail.missing && rail.rows.length >= 3);
  if (rail && !rail.missing) {
    const vis = rail.rows.filter((r) => r.h > 0);
    check("creator rail: every visible row computes borderRadius 12px",
      vis.length > 0 && vis.every((r) => r.radius === "12px"), [...new Set(vis.map((r) => r.radius))].join(","));
    // Rail rows carry their type on the LABEL (the -193 rail rule
    // sets 15px/500 on .tab-label, not on .tab-item itself), so the
    // font assertion reads the label's computed style.
    check("creator rail: first row height 37px, label Inter 15px",
      near(vis[0].h, 37, 1) && vis[0].labelSize === "15px" && /Inter/.test(vis[0].labelFamily),
      JSON.stringify(vis[0]).slice(0, 160));
    check("creator rail: rail-foot identity avatar (.tu-ava) computes 52px",
      !!rail.avatar && near(rail.avatar.w, 52, 0.6) && near(rail.avatar.h, 52, 0.6) && rail.avatar.cw === "52px",
      JSON.stringify(rail.avatar));
  }
  for (const role of ["admin", "business", "partner", "bizdev", "national"]) {
    const r = metrics[role + "_rail"];
    if (!r || r.missing) { check(`${role} rail: rendered`, false, "absent"); continue; }
    const vis = r.rows.filter((x) => x.h > 0);
    check(`${role} rail: every visible row computes borderRadius 12px`,
      vis.length > 0 && vis.every((x) => x.radius === "12px"), [...new Set(vis.map((x) => x.radius))].join(","));
    if (r.avatar) check(`${role} rail: rail-foot avatar computes 52px`,
      near(r.avatar.w, 52, 0.6) && near(r.avatar.h, 52, 0.6), JSON.stringify(r.avatar));
  }
}

console.log(`\nverify-build194: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("failures:\n - " + failures.join("\n - ")); process.exit(1); }
