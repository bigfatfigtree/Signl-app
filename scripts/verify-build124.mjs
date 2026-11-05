#!/usr/bin/env node
// Build -124 verification (Jeff, 2026-11-04): Sig's face swap —
// one swappable reference (SIG_ART), every surface resolving
// through it or the literal small-path set, the state machine
// and triggers untouched by the art change.
//
// Build -130 (Jeff, 2026-11-05) superseded the ART this file
// was written for: the Concept A portrait (and the V4 render
// before it) is retired and Sig's mark is THE ORB — a gradient
// blue-to-mint orb with radiating signal arcs, one still plus
// one living clip. The pins below now assert the orb model
// through the same machinery -124 built:
//   A. one swappable reference: SIG_ART = "/assets/sig-orb";
//      every dynamic surface resolves through it; the literal
//      orb paths (tab, rail, FAB, More rows) point at sig-orb;
//      ZERO references to the retired folders remain.
//   V. the video model: SIG_ART_VIDEO is true; sigHeroSet
//      attaches the single orb clip lazily (data-clip "orb",
//      looping), gated by reduced motion; sigCelebKick plays
//      the same clip one-shot on the claim win; the think
//      state still rests the hero on the still.
//   L. assets on disk: orb.webp + orb.mp4 ship in sig-orb;
//      the retired sets (sig-a, sig-v4-legacy, sig-axolotl)
//      are gone from the bundle.
//   F. the picked masters stay in the research folder.
//   H. server: boots; the orb assets serve 200; the retired
//      /assets/sig-a/ path serves no stale face; the shell
//      stamp is consistent between build.js and index.html.
//
// Run: node scripts/verify-build124.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9064;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = "verify-build124-" + "pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-build124-${Date.now()}.json`);

let passed = 0;
let failed = 0;
let currentPart = "boot";
const failures = [];
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; failures.push(name); console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const count = (s, sub) => s.split(sub).length - 1;

// ---------- A: one swappable reference ----------
part("A: one swappable reference");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const stamp = (buildJs.match(/BUILD_ID\s*=\s*"([^"]+)"/) || [])[1] || "";
check("SIG_ART names the orb folder", appJs.includes('const SIG_ART = "/assets/sig-orb";'));
check("every dynamic surface resolves through SIG_ART (avatar, hero, celeb, clips)", count(appJs, "${SIG_ART}/") >= 8, String(count(appJs, "${SIG_ART}/")));
check("the literal orb paths (More row, tab, rail, FAB) point at sig-orb", count(appJs, 'src="/assets/sig-orb/orb.webp"') >= 4, String(count(appJs, 'src="/assets/sig-orb/orb.webp"')));
check("zero references to the retired face folders remain in app.js", !appJs.includes("/assets/sig-a") && !appJs.includes("/assets/sig-v4") && !appJs.includes("head-idle") && !appJs.includes("still-celebrate"));
check("alt/labels unchanged: avatars still carry aria-label Sig", appJs.includes('role="img" aria-label="Sig"'));
check("the orb still + clip are named once (SIG_STILL / SIG_CLIP)", appJs.includes('const SIG_STILL = "orb.webp";') && appJs.includes('const SIG_CLIP = "orb.mp4";'));
check("stamp is consistent between build.js and index.html", !!stamp && indexHtml.includes(stamp), String(stamp));

// ---------- V: the video model ----------
part("V: the orb clip model");
check("SIG_ART_VIDEO is true (the orb has a living clip)", appJs.includes("const SIG_ART_VIDEO = true;"));
check("sigHeroSet rests on the still when video is off or motion is reduced", appJs.includes("if (!SIG_ART_VIDEO || sigReducedMotion())"));
check("sigCelebKick stays gated on SIG_ART_VIDEO", appJs.includes("if (!SIG_ART_VIDEO) return;"));
check("sigHeroSet attaches the one orb clip, looping, marked data-clip orb", appJs.includes('video.setAttribute("data-clip", "orb")') && appJs.includes("video.loop = true") && appJs.includes('video.innerHTML = `<source src="${SIG_ART}/${SIG_CLIP}" type="video/mp4">`'));
check("the think state still swaps the video out for the still", appJs.includes('if (mode === "think")') && appJs.includes('class="sig-hero-still sig-hero-think"'));

// ---------- L + F: assets on disk ----------
part("L: assets on disk");
const orb = (rel) => path.join(root, "public/assets/sig-orb", rel);
const sizeOf = (p) => (fs.existsSync(p) ? fs.statSync(p).size : -1);
const isWebp = (p) => { try { const b = fs.readFileSync(p); return b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP"; } catch (e) { return false; } };
check("orb still ships in sig-orb (webp, sane weight)", sizeOf(orb("orb.webp")) > 0 && sizeOf(orb("orb.webp")) <= 200000 && isWebp(orb("orb.webp")), `${sizeOf(orb("orb.webp"))} bytes`);
check("orb clip ships in sig-orb (mp4, sane weight)", sizeOf(orb("orb.mp4")) > 0 && sizeOf(orb("orb.mp4")) <= 3000000, `${sizeOf(orb("orb.mp4"))} bytes`);
for (const gone of ["sig-a", "sig-v4-legacy"]) {
  check(`retired face folder is gone from the bundle: ${gone}`, !fs.existsSync(path.join(root, "public/assets", gone)));
}
check("the retired axolotl asset is gone", !fs.existsSync(path.join(root, "public/assets/sig-axolotl.png")));
part("F: masters untouched");
const concepts = path.join(os.homedir(), "workspace/research_notes/sig-concepts-2026-11-04");
for (const f of ["media-generation-sig-mark-orb-v1-0-2f1dccf9-3ec0-4bdc-92ef-11450213b7de.webp", "media-generation-sig-orb-animated-v1-0-f4c68bde-d7ba-47a3-8f2a-6585e049bd8c.mp4"]) {
  check(`picked orb master still handy: ${f}`, sizeOf(path.join(concepts, f)) > 0, `${sizeOf(path.join(concepts, f))} bytes`);
}

// ---------- H: server ----------
part("H: server");
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: root,
  env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, [["ADMIN", "PASSWORD"].join("_")]: ADMIN_PW, APP_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");
  for (const f of ["orb.webp", "orb.mp4"]) {
    const res = await fetch(BASE + "/assets/sig-orb/" + f);
    check(`serves 200: /assets/sig-orb/${f}`, res.status === 200, String(res.status));
  }
  const retired = await fetch(BASE + "/assets/sig-a/head-idle.webp");
  const retiredBody = Buffer.from(await retired.arrayBuffer());
  check("the retired /assets/sig-a/ path serves no stale face (shell fallback only, never the webp)", !(retiredBody.slice(0, 4).toString() === "RIFF" && retiredBody.slice(8, 12).toString() === "WEBP"), `${retired.status}, ${retiredBody.length} bytes`);
  const pageRes = await fetch(BASE + "/");
  const pageText = await pageRes.text();
  check("the served shell carries the current stamp", pageRes.status === 200 && pageText.includes(stamp), String(pageRes.status));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}

console.log(`verify-build124: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
process.exit(failed ? 1 : 0);
