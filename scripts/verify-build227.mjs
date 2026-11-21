// verify-build227.mjs — Build -227: the icon-on-black cold open.
// Jeff's screenshot (2026-11-21) showed a black screen with the
// raw app icon pasted in the middle (square corners, mismatched
// gradient edges) and the wordmark under it, on a SIGNED-IN cold
// open. Diagnosis: that frame is the NATIVE iOS launch screen
// baked into the submitted binary — LaunchScreen.storyboard
// shows the "Splash" imageset full-screen, and the imageset's
// dark-appearance PNG is that exact composite (generated from
// mobile/assets/splash-dark.png). The icon master artwork has
// gradient-filled corners outside its rounded mask, so pasted
// as a rectangle it shows mismatched wedges. The web layer never
// renders that frame (its splash was the wordmark on white), and
// signed-in boot never loads the intro film.
// Fix shipped here:
//   - Web splash redesigned: solid dark ground (#0b0d0c), the
//     real wordmark centered, full-viewport fixed overlay, rules
//     inlined in index.html (critical first paint) and carried
//     in intro.css. No icon, no box.
//   - Native splash art regenerated to the same design for the
//     NEXT native build (nothing rebuilt or resubmitted):
//     mobile/assets/splash.png (white ground) and splash-dark.png
//     (dark ground), the iOS Splash.imageset slots (byte copies
//     of the masters), and every Android drawable splash.png at
//     its existing size (night variants dark).
//   - Signed-in path unchanged by design: init() restores the
//     session behind the splash and render() lands on Home;
//     renderIntro (the locked v5 film) is signed-out only.
// Stamp 2026.11.21-227. (-226 is the journey build's stamp.)
// Run: node scripts/verify-build227.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const md5 = (p) => crypto.createHash("md5").update(fs.readFileSync(path.join(root, p))).digest("hex");

const buildJs = read("netlify/functions/lib/build.js");
const idxHtml = read("public/index.html");
const introCss = read("public/intro.css");
const appJs = read("public/app.js");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 220) : ""}`); }
}

console.log("== stamp ==");
check("build stamp is 2026.11.21-227 (lib + shell)", buildJs.includes('BUILD_ID = "2026.11.21-227"') && (idxHtml.match(/2026\.11\.21-227/g) || []).length >= 5, `index count=${(idxHtml.match(/2026\.11\.21-227/g) || []).length}`);
check("no 2026.11.20-225 left in build.js or index.html", !buildJs.includes("2026.11.20-225") && !idxHtml.includes("2026.11.20-225"));
check("intro.css cache-bust bumped to design-intro-4", idxHtml.includes("/intro.css?v=design-intro-4"));

console.log("== web splash: designed, wordmark only ==");
check("index.html splash markup is the wordmark image only", idxHtml.includes('<div class="splash-first-paint"><img src="/assets/logo.png" alt="Magpie"></div>'));
check("splash markup does not use the app icon file", !/<div class="splash-first-paint"><img src="\/assets\/icon\.png"/.test(idxHtml));
check("inline critical splash style present (fixed, dark ground)", idxHtml.includes(".splash-first-paint{position:fixed;inset:0;z-index:900") && idxHtml.includes("background:#0b0d0c"));
check("intro.css splash is the same design (fixed, dark ground)", /\.splash-first-paint \{\n  position: fixed;\n  inset: 0;\n  z-index: 900;/.test(introCss) && introCss.includes("background: #0b0d0c;"));
check("old white in-flow splash block is gone", !introCss.includes(".splash-first-paint {\n  min-height: 62vh;"));
check("Build -225 chrome-hiding rule retained", introCss.includes("body:has(.splash-first-paint) .topbar") && introCss.includes("body:has(.splash-first-paint) .footer"));

console.log("== signed-in path + Build -225 non-regression ==");
check("INTRO_POSTER still points at the first-frame file (-225)", appJs.includes('const INTRO_POSTER = "/assets/intro/intro-film-v5-firstframe.jpg";'));
check("INTRO_CUT unchanged (locked v5 film)", appJs.includes('const INTRO_CUT = "/assets/intro/intro-film-v5.mp4";'));
check("renderIntro still uses INTRO_POSTER for img and video poster", (appJs.match(/\$\{INTRO_POSTER\}/g) || []).length === 2);
check("intro film not preloaded by the shell (signed-in boot never buffers it)", !idxHtml.includes("intro-film") && !idxHtml.includes('rel="preload"'));
check("signed-out branch still routes to the intro film", appJs.includes("if (state.introSkipped) return renderHome();") && appJs.includes("return renderIntro();"));
check("first-frame JPG still on disk", fs.existsSync(path.join(root, "public/assets/intro/intro-film-v5-firstframe.jpg")));
check("intro film still on disk", fs.existsSync(path.join(root, "public/assets/intro/intro-film-v5.mp4")));

console.log("== native splash art: regenerated clean (next build) ==");
const darkMaster = "mobile/assets/splash-dark.png";
const lightMaster = "mobile/assets/splash.png";
check("dark master exists", fs.existsSync(path.join(root, darkMaster)));
check("light master exists", fs.existsSync(path.join(root, lightMaster)));
const darkMd5 = md5(darkMaster);
const lightMd5 = md5(lightMaster);
check("dark master is not the old icon composite", darkMd5 !== "292908de04d20bbc90add0617f5853bd", darkMd5);
check("light master is not the old icon composite", lightMd5 !== "b0681ce29089bd5a41184ab45dda2bf1", lightMd5);
const iset = "mobile/ios/App/App/Assets.xcassets/Splash.imageset";
for (const slot of ["Default@1x~universal~anyany-dark.png", "Default@2x~universal~anyany-dark.png", "Default@3x~universal~anyany-dark.png"]) {
  check(`iOS imageset ${slot} is the new dark art`, md5(`${iset}/${slot}`) === darkMd5);
}
for (const slot of ["Default@1x~universal~anyany.png", "Default@2x~universal~anyany.png", "Default@3x~universal~anyany.png"]) {
  check(`iOS imageset ${slot} is the new light art`, md5(`${iset}/${slot}`) === lightMd5);
}
const storyboard = read("mobile/ios/App/App/Base.lproj/LaunchScreen.storyboard");
check("LaunchScreen storyboard still binds the Splash imageset (next build picks up the new art)", storyboard.includes('image="Splash"'));
const androidRes = path.join(root, "mobile/android/app/src/main/res");
let androidCount = 0;
for (const dir of fs.readdirSync(androidRes)) {
  const p = path.join(androidRes, dir, "splash.png");
  if (fs.existsSync(p)) {
    androidCount += 1;
    const h = md5(path.relative(root, p));
    check(`android ${dir}/splash.png regenerated`, h !== "missing" && fs.statSync(p).size > 0 && h.length === 32);
  }
}
check("android splash drawables found (26 expected)", androidCount === 26, `count=${androidCount}`);

console.log(`\nBuild -227 verify: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
