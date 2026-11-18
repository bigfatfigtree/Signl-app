#!/usr/bin/env node
// Build -204 fixture suite: Maggie's face is now the real
// Magpie logo. Jeff (2026-11-18): "Use the real logo in
// the app, park the bird." The KAWS-style vinyl magpie of
// Builds -198/-200 is retired as her face (Jeff found the
// look creepy and rejected every drawn replacement the
// same day), and no new character art ships: the bird for
// social and merch is parked. The six tiles in
// public/assets/maggie-logo are built from the ONE real
// logo file (public/assets/logo.png, byte-identical to
// the marketing site's canonical logo): the round slots
// wear the bird-in-g lifted from the logo's own pixels
// (extracted by connected-component mask from the logo
// artwork, never redrawn, retyped or distorted), and the
// celebration tile wears the full wordmark as-is, all on
// the same clean light background the retired tiles
// used. MAGGIE_CHAR repoints to the new folder (a fresh
// path because the app serves tiles at max-age=86400);
// every retired tile set stays on disk untouched, so the
// swap reverses by pointing the constant back. Name,
// voice, copy, prompts, data-scoping, counting and
// pricing are untouched, and her motion is untouched —
// theme-v3.css carries no rule change in this build, and
// this suite re-pins the -198 motion wiring to prove it.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const theme3Css = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

console.log("== source: build stamp ==");
check("BUILD_ID is 2026.11.18-207", buildJs.includes('exports.BUILD_ID = "2026.11.18-207"'));
check("shell stamp is 2026.11.18-207", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-207"') && (indexHtml.match(/2026\.11.18-207/g) || []).length >= 5);

console.log("== source: the logo swap ==");
check("MAGGIE_CHAR names the logo tile folder", appJs.includes('const MAGGIE_CHAR = "/assets/maggie-logo"'));
check("no code names a retired tile folder as the constant", !appJs.includes('const MAGGIE_CHAR = "/assets/maggie-kaws-wide"') && !appJs.includes('const MAGGIE_CHAR = "/assets/maggie-kaws"') && !appJs.includes('const MAGGIE_CHAR = "/assets/maggie-pop"') && !appJs.includes('const MAGGIE_CHAR = "/assets/maggie-char"'));
check("character mode still stands (SIG_MARK_MODE character)", appJs.includes('const SIG_MARK_MODE = "character"'));
check("the mood maps are unchanged (same states, same tile names)", appJs.includes('const MAGGIE_CHAR_STILL = { idle: "curious.jpg", think: "curious.jpg", listen: "listen.jpg", talk: "chirp.jpg", greet: "greet.jpg", celebrate: "hearts.jpg" }') && appJs.includes('const MAGGIE_CHAR_AVA = { greet: "greet.jpg", celebrate: "hearts.jpg", think: "chirp.jpg", talk: "chirp.jpg", chirp: "chirp.jpg", cool: "cool.jpg", listen: "listen.jpg" }'));
check("every Maggie surface still resolves through the one reference", ["sigMarkHtml", "sigAvatarHtml", "sigHeroMediaHtml", "sigCelebMediaHtml", "sigOrbMedia130", "maggieCharListenSet"].every((fn) => appJs.includes(`function ${fn}`)) && (appJs.match(/\$\{MAGGIE_CHAR\}\//g) || []).length >= 6);

console.log("== assets: the logo tiles ship, every earlier set stays ==");
const size = (dir, rel) => { const p = path.join(ROOT, "public/assets", dir, rel); return fs.existsSync(p) ? fs.statSync(p).size : -1; };
const bytes = (dir, rel) => fs.readFileSync(path.join(ROOT, "public/assets", dir, rel));
const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");
check("the source logo is the canonical real logo file", md5(fs.readFileSync(path.join(ROOT, "public/assets/logo.png"))) === "705a562a0c758790553fd6c496ab5943");
for (const tile of ["curious.jpg", "greet.jpg", "chirp.jpg", "listen.jpg", "hearts.jpg", "cool.jpg"]) {
  check(`logo tile ships: maggie-logo/${tile} (sane weight)`, size("maggie-logo", tile) > 5000 && size("maggie-logo", tile) <= 400000, `${size("maggie-logo", tile)} bytes`);
  check(`the logo ${tile} is new artwork, not a copy of the retired vinyl tile`, !bytes("maggie-logo", tile).equals(bytes("maggie-kaws-wide", tile)));
  check(`retired tiles kept for reversibility: maggie-kaws-wide/${tile} + maggie-kaws/${tile} + maggie-pop/${tile} + maggie-char/${tile}`, size("maggie-kaws-wide", tile) > 5000 && size("maggie-kaws", tile) > 5000 && size("maggie-pop", tile) > 5000 && size("maggie-char", tile) > 5000, `wide ${size("maggie-kaws-wide", tile)} / kaws ${size("maggie-kaws", tile)} / pop ${size("maggie-pop", tile)} / char ${size("maggie-char", tile)} bytes`);
}
check("the five round-slot tiles share the one bird-in-g composition", ["greet.jpg", "chirp.jpg", "cool.jpg", "listen.jpg"].every((t) => bytes("maggie-logo", t).equals(bytes("maggie-logo", "curious.jpg"))));
check("the celebration tile is the distinct wordmark composition", !bytes("maggie-logo", "hearts.jpg").equals(bytes("maggie-logo", "curious.jpg")));

console.log("== motion: untouched from -198 (idle everywhere + talking state) ==");
check("the small slots idle with the gentle charBob", theme3Css.includes("img.maggie-char-img { animation: charBob 4.4s ease-in-out infinite; }"));
check("charBob is the soft bob + slight tilt (translateY + rotate, scale-guarded)", theme3Css.includes("@keyframes charBob { 0%, 100% { transform: scale(1.07) translateY(0) rotate(0deg); } 50% { transform: scale(1.07) translateY(-2.4%) rotate(.6deg); } }"));
check("charTalk is the quicker bounce with alternating tilt (scale-guarded)", theme3Css.includes("@keyframes charTalk { 0%, 100% { transform: scale(1.07) translateY(0) rotate(-1.4deg); } 25% { transform: scale(1.07) translateY(-3.4%) rotate(0deg); } 50% { transform: scale(1.07) translateY(0) rotate(1.4deg); } 75% { transform: scale(1.07) translateY(-3.4%) rotate(0deg); } }"));
check("the chat-box head talks while the box wears .is-talking", theme3Css.includes(".sigbox130.is-talking .maggie-char-head img { animation: charTalk .9s ease-in-out infinite; }"));
check("sigBoxSend wears .is-talking for exactly the reply (set before the ask, removed in finally)", appJs.includes('const boxEl = thread.closest("[data-sigbox]");') && appJs.includes('if (boxEl) boxEl.classList.add("is-talking");') && appJs.includes('try { reply = await sigAsk(text); } finally { if (boxEl) boxEl.classList.remove("is-talking"); }'));
check("reduced motion rests every loop", theme3Css.includes("#agent-fab img.maggie-char-img, img.maggie-char-img, .maggie-char-head img, .maggie-char-hero .maggie-char-poster, .sig-celeb-media.maggie-char-celeb img, .sig-ava-char img { animation: none !important; }"));

console.log(`\nverify-build204: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
