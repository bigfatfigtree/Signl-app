#!/usr/bin/env node
// Build -200 fixture suite: Maggie's avatar framing fix.
// Jeff (2026-11-18, from his Admin Home screenshot): in the
// circular profile crop you cannot see enough of Maggie —
// the Build -198 crops are so tight her beak clips at the
// circle's edge and she does not read as a bird. "Needs to
// be shifted right so you can see she's a bird." A
// front-facing version was tried and Jeff rejected it
// ("looks awful from front"), so this build changes NOTHING
// about the artwork or her pose: the same approved master,
// the same side view, only wider crops — the whole profile
// (beak, head, gradient wing, tail) inside the circle with
// the beak clear of the edge. The wide tiles ship in
// public/assets/maggie-kaws-wide and MAGGIE_CHAR repoints
// to them (a fresh path because the app serves the tiles
// with a 24h cache); the -198 crops and every earlier tile
// set stay on disk untouched, so the swap reverses by
// pointing the constant back. Animation, behavior, prompts,
// data-scoping and copy are untouched — theme-v3.css is not
// in this build's diff at all, and this suite re-pins the
// -198 motion wiring to prove it.
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
check("BUILD_ID is 2026.11.18-200", buildJs.includes('exports.BUILD_ID = "2026.11.18-200"'));
check("shell stamp is 2026.11.18-200", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-200"') && (indexHtml.match(/2026\.11\.18-200/g) || []).length >= 5);

console.log("== source: the reframe ==");
check("MAGGIE_CHAR names the wide tile folder", appJs.includes('const MAGGIE_CHAR = "/assets/maggie-kaws-wide"'));
check("no code names a retired tile folder as the constant", !appJs.includes('const MAGGIE_CHAR = "/assets/maggie-kaws"') && !appJs.includes('const MAGGIE_CHAR = "/assets/maggie-pop"') && !appJs.includes('const MAGGIE_CHAR = "/assets/maggie-char"'));
check("character mode still stands (SIG_MARK_MODE character)", appJs.includes('const SIG_MARK_MODE = "character"'));
check("the mood maps are unchanged (same states, same tile names)", appJs.includes('const MAGGIE_CHAR_STILL = { idle: "curious.jpg", think: "curious.jpg", listen: "listen.jpg", talk: "chirp.jpg", greet: "greet.jpg", celebrate: "hearts.jpg" }') && appJs.includes('const MAGGIE_CHAR_AVA = { greet: "greet.jpg", celebrate: "hearts.jpg", think: "chirp.jpg", talk: "chirp.jpg", chirp: "chirp.jpg", cool: "cool.jpg", listen: "listen.jpg" }'));
check("every Maggie surface still resolves through the one reference", ["sigMarkHtml", "sigAvatarHtml", "sigHeroMediaHtml", "sigCelebMediaHtml", "sigOrbMedia130", "maggieCharListenSet"].every((fn) => appJs.includes(`function ${fn}`)) && (appJs.match(/\$\{MAGGIE_CHAR\}\//g) || []).length >= 6);

console.log("== assets: the wide tiles ship, every earlier set stays ==");
const size = (dir, rel) => { const p = path.join(ROOT, "public/assets", dir, rel); return fs.existsSync(p) ? fs.statSync(p).size : -1; };
const bytes = (dir, rel) => fs.readFileSync(path.join(ROOT, "public/assets", dir, rel));
for (const tile of ["curious.jpg", "greet.jpg", "chirp.jpg", "listen.jpg", "hearts.jpg", "cool.jpg"]) {
  check(`wide tile ships: maggie-kaws-wide/${tile} (sane weight)`, size("maggie-kaws-wide", tile) > 5000 && size("maggie-kaws-wide", tile) <= 400000, `${size("maggie-kaws-wide", tile)} bytes`);
  check(`the wide ${tile} is a real reframe, not a copy of the -198 crop`, !bytes("maggie-kaws-wide", tile).equals(bytes("maggie-kaws", tile)));
  check(`retired tiles kept for reversibility: maggie-kaws/${tile} + maggie-pop/${tile} + maggie-char/${tile}`, size("maggie-kaws", tile) > 5000 && size("maggie-pop", tile) > 5000 && size("maggie-char", tile) > 5000, `kaws ${size("maggie-kaws", tile)} / pop ${size("maggie-pop", tile)} / char ${size("maggie-char", tile)} bytes`);
}
check("greet/chirp/cool still share the one portrait crop", bytes("maggie-kaws-wide", "greet.jpg").equals(bytes("maggie-kaws-wide", "chirp.jpg")) && bytes("maggie-kaws-wide", "greet.jpg").equals(bytes("maggie-kaws-wide", "cool.jpg")));

console.log("== motion: untouched from -198 (idle everywhere + talking state) ==");
check("the small slots idle with the gentle charBob", theme3Css.includes("img.maggie-char-img { animation: charBob 4.4s ease-in-out infinite; }"));
check("charBob is the soft bob + slight tilt (translateY + rotate, scale-guarded)", theme3Css.includes("@keyframes charBob { 0%, 100% { transform: scale(1.07) translateY(0) rotate(0deg); } 50% { transform: scale(1.07) translateY(-2.4%) rotate(.6deg); } }"));
check("charTalk is the quicker bounce with alternating tilt (scale-guarded)", theme3Css.includes("@keyframes charTalk { 0%, 100% { transform: scale(1.07) translateY(0) rotate(-1.4deg); } 25% { transform: scale(1.07) translateY(-3.4%) rotate(0deg); } 50% { transform: scale(1.07) translateY(0) rotate(1.4deg); } 75% { transform: scale(1.07) translateY(-3.4%) rotate(0deg); } }"));
check("the chat-box head talks while the box wears .is-talking", theme3Css.includes(".sigbox130.is-talking .maggie-char-head img { animation: charTalk .9s ease-in-out infinite; }"));
check("sigBoxSend wears .is-talking for exactly the reply (set before the ask, removed in finally)", appJs.includes('const boxEl = thread.closest("[data-sigbox]");') && appJs.includes('if (boxEl) boxEl.classList.add("is-talking");') && appJs.includes('try { reply = await sigAsk(text); } finally { if (boxEl) boxEl.classList.remove("is-talking"); }'));
check("reduced motion rests every loop", theme3Css.includes("#agent-fab img.maggie-char-img, img.maggie-char-img, .maggie-char-head img, .maggie-char-hero .maggie-char-poster, .sig-celeb-media.maggie-char-celeb img, .sig-ava-char img { animation: none !important; }"));

console.log(`\nverify-build200: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
