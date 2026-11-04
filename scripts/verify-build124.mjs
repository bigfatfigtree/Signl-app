#!/usr/bin/env node
// Build -124 verification (Jeff, 2026-11-04): "Let's try A but
// I like the pencil drawing and orb — so keep them handy so if
// I don't like A, we use them." Sig's face swaps from the V4
// beanie-kid render to Concept A — the painterly portrait from
// ~/workspace/research_notes/sig-concepts-2026-11-04/ — on every
// surface where Sig's face appears, app AND marketing site.
//   A. one swappable reference: SIG_ART = "/assets/sig-a" in
//      app.js; every face resolves through it or the literal
//      head-idle paths (tab, rail, FAB, More rows), all repointed.
//   V. stills only: Concept A has no clips, so SIG_ART_VIDEO is
//      false and both attach points (sigHeroSet, sigCelebKick)
//      are gated — the stills carry every state, no request ever
//      goes out for a clip that does not exist.
//   L. legacy kept: the full V4 set (stills + clips) survives at
//      public/assets/sig-v4-legacy/ — a revert, or a later swap
//      to the ink companion (C) or the orb (D), is a folder of
//      derived stills + repointing SIG_ART and the literals.
//   F. fallbacks untouched: the C and D concept masters still
//      sit in the research folder, unmodified.
//   H. server: boots; every sig-a still serves 200; the retired
//      /assets/sig-v4/ path serves nothing; the shell stamp is
//      consistent between build.js and index.html. (The literal
//      stamp step is NOT pinned here: Builds -122/-123 are
//      landing in parallel in this tree and the stamp roll rides
//      with the sequence — consistency is what -124 owns.)
// The rendered proof (pill size, round crops, four roles) lives
// in ~/workspace/research_notes/signl-build124-qa/.
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
check("SIG_ART names the Concept A folder", appJs.includes('const SIG_ART = "/assets/sig-a";'));
check("every dynamic face resolves through SIG_ART (avatar, hero, stills, celeb)", count(appJs, "${SIG_ART}/") >= 8, String(count(appJs, "${SIG_ART}/")));
check("the literal head-idle paths (More row, tab, rail, FAB) point at sig-a, none at sig-v4", count(appJs, 'src="/assets/sig-a/head-idle.webp"') >= 4 && count(appJs, 'src="/assets/sig-v4/head-idle.webp"') === 0, String(count(appJs, 'src="/assets/sig-a/head-idle.webp"'))); // 5 placements at -124; Build -125's nav rewrite consolidated the duplicate More renderer, leaving 4 — the invariant is the folder, the count rides with the nav model
check("SIG_HEAD still maps the five states to head crops", appJs.includes('const SIG_HEAD = { "": "head-idle", greet: "head-greet", think: "head-think", talk: "head-talk", celebrate: "head-celebrate" }'));
check("alt/labels unchanged: avatars still carry aria-label Sig", appJs.includes('role="img" aria-label="Sig"'));
check("no user-facing reference to the V4 folder remains in app.js", !appJs.includes("/assets/sig-v4/"), "");
check("stamp is consistent between build.js and index.html", !!stamp && indexHtml.includes(stamp), String(stamp));

// ---------- V: stills only ----------
part("V: stills only");
check("SIG_ART_VIDEO is false", appJs.includes("const SIG_ART_VIDEO = false;"));
check("sigHeroSet lands on the still when video is off (same path as reduced motion)", appJs.includes("if (!SIG_ART_VIDEO || sigReducedMotion())"));
check("sigCelebKick never attaches a clip for a stills-only character", appJs.includes('if (!SIG_ART_VIDEO) return; // stills-only character (Build -124): the celebrate still stands'));
check("the clip machinery survives for a future character (attach code untouched)", appJs.includes('video.innerHTML = `<source src="${SIG_ART}/${name}.webm" type="video/webm"><source src="${SIG_ART}/${name}.mp4" type="video/mp4">`'));
check("the think state still swaps to the think still", appJs.includes('if (mode === "think")') && appJs.includes("${SIG_ART}/still-think.webp"));

// ---------- L + F: assets on disk ----------
part("L: assets on disk");
const sigA = (rel) => path.join(root, "public/assets/sig-a", rel);
const legacy = (rel) => path.join(root, "public/assets/sig-v4-legacy", rel);
const sizeOf = (p) => (fs.existsSync(p) ? fs.statSync(p).size : -1);
const isWebp = (p) => { try { const b = fs.readFileSync(p); return b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP"; } catch (e) { return false; } };
for (const f of ["hero.webp", "still-greet.webp", "still-think.webp", "still-talk.webp", "still-celebrate.webp", "head-idle.webp", "head-greet.webp", "head-think.webp", "head-talk.webp", "head-celebrate.webp"]) {
  check(`Concept A still ships in sig-a: ${f}`, sizeOf(sigA(f)) > 0 && sizeOf(sigA(f)) <= 120000 && isWebp(sigA(f)), `${sizeOf(sigA(f))} bytes`);
}
for (const f of ["hero.webp", "still-greet.webp", "still-think.webp", "still-talk.webp", "still-celebrate.webp", "head-idle.webp", "head-greet.webp", "head-think.webp", "head-talk.webp", "head-celebrate.webp", "idle.webm", "idle.mp4", "talk.webm", "talk.mp4", "greet.webm", "greet.mp4", "celebrate.webm", "celebrate.mp4"]) {
  check(`V4 legacy kept intact: ${f}`, sizeOf(legacy(f)) > 0, `${sizeOf(legacy(f))} bytes`);
}
part("F: fallbacks untouched");
const concepts = path.join(os.homedir(), "workspace/research_notes/sig-concepts-2026-11-04");
for (const f of ["sig-concept-a-grounded-portrait.png", "sig-concept-c-ink-companion.png", "sig-concept-d-the-orb.png", "sig-concept-b-signal-mark.png"]) {
  check(`concept master still handy: ${f}`, sizeOf(path.join(concepts, f)) > 0, `${sizeOf(path.join(concepts, f))} bytes`);
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
  for (const f of ["hero.webp", "still-think.webp", "still-celebrate.webp", "head-idle.webp", "head-greet.webp", "head-think.webp", "head-talk.webp", "head-celebrate.webp"]) {
    const res = await fetch(BASE + "/assets/sig-a/" + f);
    check(`serves 200: /assets/sig-a/${f}`, res.status === 200, String(res.status));
  }
  const retired = await fetch(BASE + "/assets/sig-v4/head-idle.webp");
  const retiredBody = Buffer.from(await retired.arrayBuffer());
  check("the retired /assets/sig-v4/ path serves no stale face (shell fallback only, never the webp)", !(retiredBody.slice(0, 4).toString() === "RIFF" && retiredBody.slice(8, 12).toString() === "WEBP"), `${retired.status}, ${retiredBody.length} bytes`);
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
