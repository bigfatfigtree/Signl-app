// Build -182 verification: the Instagram follow block in the
// claim flow. Placement law (research, 2026-11-16): the claim
// itself stays at the Build -85 shape (three short screens and
// a done state, nothing else), so the block lives on the DONE
// screen only, as an honor-system invitation — no API in the
// app can confirm a follow (IG prefill reads public profile
// tags; IG connect OAuth-verifies the creator's OWN account),
// so the block never gates, checks, or records anything.
// Run: node scripts/verify-build182.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8961;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `signl-verify-build182-${Date.now()}.json`);
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

console.log("== source pins ==");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
check("build stamp is 2026.11.16-182", buildJs.includes("2026.11.16-182"));
check("follow block builder exists", appJs.includes("function magpieIgFollowHtml()"));
check("the link is the real Magpie Instagram", appJs.includes('href="https://instagram.com/magpielocal"') && appJs.includes('target="_blank" rel="noopener"'));
check("dismissal mirrors the install banner (localStorage, once)", appJs.includes('localStorage.getItem("magpie_ig_follow_dismissed")') && appJs.includes("function dismissMagpieIgFollow()"));
check("copy is T()-wrapped in both languages", appJs.includes('T("Follow Magpie on Instagram", "Sigue a Magpie en Instagram")') && appJs.includes('T("Not now", "Ahora no")'));
const doneSrc = appJs.slice(appJs.indexOf("function renderClaimDone()"), appJs.indexOf("function renderClaimDone()") + 4000);
check("the block renders on the DONE screen", doneSrc.includes("${magpieIgFollowHtml()}"));
for (const step of ["renderClaimWelcome", "renderClaimFacts", "renderClaimMarkets", "renderClaimAccount"]) {
  const src = appJs.slice(appJs.indexOf(`function ${step}(`), appJs.indexOf(`function ${step}(`) + 6000);
  check(`${step} carries NO follow block (claim steps stay clean)`, !src.includes("magpieIgFollowHtml()"));
}
check("no follow state is written to any server record", !/igFollow|followedMagpie|followsMagpie/.test(fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8")));

let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL: "jeff@joinsignl.com", ADMIN_PASSWORD: "build182-admin-pass", APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() { if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; } }

try {
  startServer();
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const res = await fetch(BASE + "/api/bootstrap"); up = res.ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 250)); }
  check("dev server boots", up);
  const served = await (await fetch(BASE + "/app.js")).text();
  check("the served app.js carries the block (what creators actually load)", served.includes("magpieIgFollowHtml") && served.includes("https://instagram.com/magpielocal"));
  console.log(`\nverify-build182: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
} finally {
  await stopServer();
}
