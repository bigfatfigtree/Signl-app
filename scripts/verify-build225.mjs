// verify-build225.mjs — Build -225: intro poster fix.
// The old INTRO_POSTER (intro-film-v5-poster.jpg) was the film's
// LAST frame (a washed fake sign-in screen), shown full-screen
// while the 5.6 MB film buffered; the film then hard-cut to its
// real first frame. Fix (web layer only):
//   - New asset public/assets/intro/intro-film-v5-firstframe.jpg,
//     extracted from frame 0 of intro-film-v5.mp4 with ffmpeg
//     (720x1280, same dimensions as the film). The old poster
//     file is untouched on disk.
//   - INTRO_POSTER in public/app.js repointed to the new file.
//     One constant; no other intro logic changes (INTRO_CUT,
//     timers, skip, sign-in handoff all byte-identical).
//   - Splash tidy (intro.css): while .splash-first-paint is in
//     the DOM, the static top bar and footer are hidden via a
//     :has() rule scoped to the splash's presence; first render
//     removes the splash and the chrome returns. No JS change.
// Stamp 2026.11.20-225.
// Run: node scripts/verify-build225.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const idxHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const introCss = fs.readFileSync(path.join(root, "public/intro.css"), "utf8");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 220) : ""}`); }
}

console.log("== stamp ==");
check("build stamp is 2026.11.20-225 (lib + shell)", buildJs.includes('BUILD_ID = "2026.11.20-225"') && (idxHtml.match(/2026\.11\.20-225/g) || []).length >= 5, `index count=${(idxHtml.match(/2026\.11\.20-225/g) || []).length}`);
check("no 2026.11.20-224 left in build.js or index.html", !buildJs.includes("2026.11.20-224") && !idxHtml.includes("2026.11.20-224"));

console.log("== intro poster ==");
check("INTRO_POSTER points at the first-frame file", appJs.includes('const INTRO_POSTER = "/assets/intro/intro-film-v5-firstframe.jpg";'));
check("INTRO_POSTER no longer points at the old poster", !appJs.includes('const INTRO_POSTER = "/assets/intro/intro-film-v5-poster.jpg";'));
check("INTRO_CUT unchanged", appJs.includes('const INTRO_CUT = "/assets/intro/intro-film-v5.mp4";'));
check("renderIntro still uses INTRO_POSTER for img and video poster", (appJs.match(/\$\{INTRO_POSTER\}/g) || []).length === 2, `count=${(appJs.match(/\$\{INTRO_POSTER\}/g) || []).length}`);

console.log("== assets on disk ==");
const ffPath = path.join(root, "public/assets/intro/intro-film-v5-firstframe.jpg");
const ffStat = fs.existsSync(ffPath) ? fs.statSync(ffPath) : null;
check("first-frame JPG exists on disk", !!ffStat);
check("first-frame JPG is a real JPEG (SOI marker)", !!ffStat && fs.readFileSync(ffPath)[0] === 0xff && fs.readFileSync(ffPath)[1] === 0xd8);
check("first-frame JPG has real size (>50 KB)", !!ffStat && ffStat.size > 50000, ffStat ? `size=${ffStat.size}` : "missing");
check("old poster file still on disk, untouched", fs.existsSync(path.join(root, "public/assets/intro/intro-film-v5-poster.jpg")));
check("intro film still on disk", fs.existsSync(path.join(root, "public/assets/intro/intro-film-v5.mp4")));

console.log("== splash tidy ==");
check("splash hide rule present, keyed to splash presence", introCss.includes("body:has(.splash-first-paint) .topbar") && introCss.includes("body:has(.splash-first-paint) .footer"));
check("splash block itself unchanged", introCss.includes(".splash-first-paint {\n  min-height: 62vh;"));
check("index.html splash markup unchanged", idxHtml.includes('<div class="splash-first-paint"><img src="/assets/logo.png" alt="Magpie"></div>'));

console.log(`\nBuild -225 verify: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
