#!/usr/bin/env node
// Build -196 fixture suite: Maggie's new face.
// Jeff (2026-11-17, "go ahead and update"): Maggie's artwork
// becomes the pop art magpie he picked that night — the
// option-8 bird (same face, lashes, earring, polka-dot
// scarf) now wearing a blue-to-green pop art shirt, on a
// plain cream background, no text. The six tiles in
// public/assets/maggie-pop are crops of that ONE approved
// image, resolved through the same single MAGGIE_CHAR
// reference every Maggie surface already uses, so the swap
// is one constant. The 2026-11-07 character-sheet tiles stay
// on disk in public/assets/maggie-char, untouched, and the
// swap reverses by pointing the constant back. Her motion
// stays code (CSS transforms on the real artwork, never a
// redraw); this build also puts the existing gentle charBob
// idle on the FAB — her main entry point — and rests it
// under prefers-reduced-motion. No behavior, prompt, data
// scoping, or copy changes: this suite pins the stamp, the
// constant, the tiles, the unchanged mood maps, and the
// FAB animation + reduced-motion coverage.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const theme3Css = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

console.log("== source: build stamp ==");
check("BUILD_ID is 2026.11.18-196", buildJs.includes('exports.BUILD_ID = "2026.11.18-196"'));
check("shell stamp is 2026.11.18-196", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-196"') && (indexHtml.match(/2026\.11\.18-196/g) || []).length >= 5);

console.log("== source: the swap ==");
check("MAGGIE_CHAR names the pop art tile folder", appJs.includes('const MAGGIE_CHAR = "/assets/maggie-pop"'));
check("no code names the old tile folder as a path anymore", !appJs.includes('"/assets/maggie-char"') && !appJs.includes("src=\"/assets/maggie-char"));
check("character mode still stands (SIG_MARK_MODE character)", appJs.includes('const SIG_MARK_MODE = "character"'));
check("the mood maps are unchanged (same states, same tile names)", appJs.includes('const MAGGIE_CHAR_STILL = { idle: "curious.jpg", think: "curious.jpg", listen: "listen.jpg", talk: "chirp.jpg", greet: "greet.jpg", celebrate: "hearts.jpg" }') && appJs.includes('const MAGGIE_CHAR_AVA = { greet: "greet.jpg", celebrate: "hearts.jpg", think: "chirp.jpg", talk: "chirp.jpg", chirp: "chirp.jpg", cool: "cool.jpg", listen: "listen.jpg" }'));
check("every Maggie surface still resolves through the one reference", ["sigMarkHtml", "sigAvatarHtml", "sigHeroMediaHtml", "sigCelebMediaHtml", "sigOrbMedia130", "maggieCharListenSet"].every((fn) => appJs.includes(`function ${fn}`)) && (appJs.match(/\$\{MAGGIE_CHAR\}\//g) || []).length >= 6);

console.log("== assets: the new tiles ship, the old ones stay ==");
const size = (dir, rel) => { const p = path.join(ROOT, "public/assets", dir, rel); return fs.existsSync(p) ? fs.statSync(p).size : -1; };
for (const tile of ["curious.jpg", "greet.jpg", "chirp.jpg", "listen.jpg", "hearts.jpg", "cool.jpg"]) {
  check(`new tile ships: maggie-pop/${tile} (sane weight)`, size("maggie-pop", tile) > 5000 && size("maggie-pop", tile) <= 400000, `${size("maggie-pop", tile)} bytes`);
  check(`old tile kept for reversibility: maggie-char/${tile}`, size("maggie-char", tile) > 5000, `${size("maggie-char", tile)} bytes`);
}

console.log("== motion: she idles at her front door too ==");
check("the FAB face carries the gentle charBob idle", theme3Css.includes("#agent-fab img.maggie-char-img { width: 32px; height: 32px; border-radius: 50%; animation: charBob 4.4s ease-in-out infinite; }"));
check("charBob is the soft bob + slight tilt (translateY + rotate, scale-guarded)", theme3Css.includes("@keyframes charBob { 0%, 100% { transform: scale(1.07) translateY(0) rotate(0deg); } 50% { transform: scale(1.07) translateY(-2.4%) rotate(.6deg); } }"));
check("the hero + chat-head idles are untouched", theme3Css.includes(".maggie-char-hero .maggie-char-poster { transform-origin: 50% 62%; animation: charBob 3.8s ease-in-out infinite; }") && theme3Css.includes(".maggie-char-head img { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 50%; animation: charBob 4.4s ease-in-out infinite; }"));
check("reduced motion rests the FAB with the rest of her surfaces", theme3Css.includes("#agent-fab img.maggie-char-img, .maggie-char-head img, .maggie-char-hero .maggie-char-poster, .sig-celeb-media.maggie-char-celeb img, .sig-ava-char img { animation: none !important; }"));

console.log(`\nverify-build196: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
