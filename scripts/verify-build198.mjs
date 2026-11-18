#!/usr/bin/env node
// Build -198 fixture suite: Maggie's new face, animated
// everywhere, with a talking state.
// Jeff (2026-11-18, on the KAWS-style magpie: "I like this
// one. Give it a magpie t shirt. And animate it everywhere
// on the site when it talks etc."; final art picked minutes
// later): Maggie's artwork becomes the matte vinyl magpie —
// black head, the X eye in the blue-to-green gradient, the
// real Magpie logo across her black t-shirt — cropped into
// six tiles in public/assets/maggie-kaws, resolved through
// the same single MAGGIE_CHAR reference every Maggie
// surface already uses, so the swap is one constant. The
// Build -196 pop art tiles (public/assets/maggie-pop) and
// the 2026-11-07 character-sheet tiles
// (public/assets/maggie-char) stay on disk untouched, and
// the swap reverses by pointing the constant back.
// Her motion stays code (CSS transforms on the real
// artwork, never a redraw), and this build closes the two
// motion gaps Jeff's "everywhere" names: (1) the small
// slots — the phone bottom-bar Maggie tab disc, the rail
// face, the More-row faces — idle with the same gentle
// charBob as her heads and hero (until now the tab disc sat
// frozen); (2) a TALKING state: a quicker charTalk loop
// (small bounce, tilt alternating sides) that runs while
// she is answering — on the chat-box head via the
// .is-talking class sigBoxSend wears for exactly the
// length of the reply, on the live thread avatar via the
// existing talk mood, and on the hero for as long as its
// talk mode lasts — then settles back to idle.
// prefers-reduced-motion rests every loop, the new ones
// included. No behavior, prompt, data-scoping, or copy
// changes: this suite pins the stamp, the constant, the
// tiles, the unchanged mood maps, and the animation wiring.
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
check("BUILD_ID is 2026.11.18-198", buildJs.includes('exports.BUILD_ID = "2026.11.18-198"'));
check("shell stamp is 2026.11.18-198", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-198"') && (indexHtml.match(/2026\.11\.18-198/g) || []).length >= 5);

console.log("== source: the swap ==");
check("MAGGIE_CHAR names the vinyl tile folder", appJs.includes('const MAGGIE_CHAR = "/assets/maggie-kaws"'));
check("no code names a retired tile folder as the constant", !appJs.includes('const MAGGIE_CHAR = "/assets/maggie-pop"') && !appJs.includes('const MAGGIE_CHAR = "/assets/maggie-char"'));
check("character mode still stands (SIG_MARK_MODE character)", appJs.includes('const SIG_MARK_MODE = "character"'));
check("the mood maps are unchanged (same states, same tile names)", appJs.includes('const MAGGIE_CHAR_STILL = { idle: "curious.jpg", think: "curious.jpg", listen: "listen.jpg", talk: "chirp.jpg", greet: "greet.jpg", celebrate: "hearts.jpg" }') && appJs.includes('const MAGGIE_CHAR_AVA = { greet: "greet.jpg", celebrate: "hearts.jpg", think: "chirp.jpg", talk: "chirp.jpg", chirp: "chirp.jpg", cool: "cool.jpg", listen: "listen.jpg" }'));
check("every Maggie surface still resolves through the one reference", ["sigMarkHtml", "sigAvatarHtml", "sigHeroMediaHtml", "sigCelebMediaHtml", "sigOrbMedia130", "maggieCharListenSet"].every((fn) => appJs.includes(`function ${fn}`)) && (appJs.match(/\$\{MAGGIE_CHAR\}\//g) || []).length >= 6);

console.log("== assets: the new tiles ship, the old ones stay ==");
const size = (dir, rel) => { const p = path.join(ROOT, "public/assets", dir, rel); return fs.existsSync(p) ? fs.statSync(p).size : -1; };
for (const tile of ["curious.jpg", "greet.jpg", "chirp.jpg", "listen.jpg", "hearts.jpg", "cool.jpg"]) {
  check(`new tile ships: maggie-kaws/${tile} (sane weight)`, size("maggie-kaws", tile) > 5000 && size("maggie-kaws", tile) <= 400000, `${size("maggie-kaws", tile)} bytes`);
  check(`retired tiles kept for reversibility: maggie-pop/${tile} + maggie-char/${tile}`, size("maggie-pop", tile) > 5000 && size("maggie-char", tile) > 5000, `pop ${size("maggie-pop", tile)} / char ${size("maggie-char", tile)} bytes`);
}

console.log("== motion: idle everywhere, including the tab disc ==");
check("the small slots idle with the gentle charBob", theme3Css.includes("img.maggie-char-img { animation: charBob 4.4s ease-in-out infinite; }"));
check("the FAB sizing rule from -196 stands", theme3Css.includes("#agent-fab img.maggie-char-img { width: 32px; height: 32px; border-radius: 50%; animation: charBob 4.4s ease-in-out infinite; }"));
check("charBob is the soft bob + slight tilt (translateY + rotate, scale-guarded)", theme3Css.includes("@keyframes charBob { 0%, 100% { transform: scale(1.07) translateY(0) rotate(0deg); } 50% { transform: scale(1.07) translateY(-2.4%) rotate(.6deg); } }"));
check("the head + hero idles are untouched", theme3Css.includes(".maggie-char-head img { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: 50%; animation: charBob 4.4s ease-in-out infinite; }") && theme3Css.includes(".maggie-char-hero .maggie-char-poster { transform-origin: 50% 62%; animation: charBob 3.8s ease-in-out infinite; }"));

console.log("== motion: the talking state ==");
check("charTalk is the quicker bounce with alternating tilt (scale-guarded)", theme3Css.includes("@keyframes charTalk { 0%, 100% { transform: scale(1.07) translateY(0) rotate(-1.4deg); } 25% { transform: scale(1.07) translateY(-3.4%) rotate(0deg); } 50% { transform: scale(1.07) translateY(0) rotate(1.4deg); } 75% { transform: scale(1.07) translateY(-3.4%) rotate(0deg); } }"));
check("the live thread avatar talks with charTalk (talk mood)", theme3Css.includes(".sig-thread .sig-turn.sig:last-child .sig-ava-char.sig-mood-talk img,\n.sigbox-thread .sig-turn.sig:last-child .sig-ava-char.sig-mood-talk img { animation: charTalk .9s ease-in-out infinite; }"));
check("the hero talks with charTalk for as long as talk mode lasts", theme3Css.includes(".maggie-char-hero[data-mode=\"talk\"] .maggie-char-poster { animation: charTalk .9s ease-in-out infinite; }"));
check("the chat-box head talks while the box wears .is-talking", theme3Css.includes(".sigbox130.is-talking .maggie-char-head img { animation: charTalk .9s ease-in-out infinite; }"));
check("sigBoxSend wears .is-talking for exactly the reply (set before the ask, removed in finally)", appJs.includes('const boxEl = thread.closest("[data-sigbox]");') && appJs.includes('if (boxEl) boxEl.classList.add("is-talking");') && appJs.includes('try { reply = await sigAsk(text); } finally { if (boxEl) boxEl.classList.remove("is-talking"); }'));
check("the other hero states keep their motion (think sway, greet hop, celebrate wiggle, listen tilt)", theme3Css.includes('.maggie-char-hero[data-mode="think"] .maggie-char-poster { animation: charSway 3.2s ease-in-out infinite; }') && theme3Css.includes('.maggie-char-hero[data-mode="greet"] .maggie-char-poster { animation: charHop .95s ease-out 1, charBob 3.8s ease-in-out .95s infinite; }') && theme3Css.includes('.maggie-char-hero[data-mode="celebrate"] .maggie-char-poster { animation: charWiggle .6s ease-in-out 3, charBob 3.8s ease-in-out 1.8s infinite; }') && theme3Css.includes('.maggie-char-hero[data-mode="listen"] .maggie-char-poster { animation: charListen 4.5s ease-in-out infinite; }'));
check("reduced motion rests every loop, the new ones included", theme3Css.includes("#agent-fab img.maggie-char-img, img.maggie-char-img, .maggie-char-head img, .maggie-char-hero .maggie-char-poster, .sig-celeb-media.maggie-char-celeb img, .sig-ava-char img { animation: none !important; }"));

console.log(`\nverify-build198: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
