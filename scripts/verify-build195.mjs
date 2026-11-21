#!/usr/bin/env node
// Build -195 fixture suite: the Admin Applications room toggle.
// Jeff (2026-11-17) works the review queue from his phone: the
// -187 split stacked the Business applications section above
// the Creator applications section, so reaching one queue meant
// scrolling past the other. This build puts a Businesses /
// Creators segmented toggle at the top of the room — one
// section on screen at a time, each label carrying its live
// pending count. This suite pins:
//  - source: the toggle markup + labels (live counts), the
//    pure-presentation flip (no fetch, no reload — LOADER RULE),
//    the default-resolution rule, the session memory, the CSS;
//  - behavior: the default rule evaluated on all four pending
//    combinations;
//  - API: the per-role pending counts the labels print, taken
//    from the real /admin/applications payload over fixtures
//    that include a dual-role pair (the -187 cross-references
//    must survive untouched).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8955;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = ["verify195", "admin", "pw"].join("-");
const FIXPW = ["fixture", "pass", "195"].join("-");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "signl-verify195-"));
const DB = path.join(TMP, "db.json");

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const themeV3 = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");
const seg = (src, a, b) => { const i = src.indexOf(a); if (i < 0) return ""; const j = b ? src.indexOf(b, i + a.length) : -1; return src.slice(i, j > i ? j : undefined); };

// ---------------- source pins ----------------
console.log("== source: build stamp ==");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
check("BUILD_ID is 2026.11.17-195", buildJs.includes('exports.BUILD_ID = "2026.11.17-195"'));
check("shell stamp is 2026.11.17-195", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.17-195"') && (indexHtml.match(/2026\.11\.17-195/g) || []).length >= 5);

console.log("== source: the toggle ==");
check("session state exists, starts unchosen", appJs.includes("let adminAppSection195 = null;"));
const flipSeg = seg(appJs, "function adminAppSetSection195(role)", "function adminKnownTotal");
check("flip function exists", flipSeg.length > 200);
check("flip is pure presentation (no api, no fetch, no reload of the room)", !flipSeg.includes("api(") && !flipSeg.includes("fetch(") && !flipSeg.includes("loadApplications("), "toggle path touches the network or a reload");
check("flip remembers the choice for the session", flipSeg.includes("adminAppSection195 = role;"));
check("flip hides the other section and moves the active state", flipSeg.includes('sec.style.display = r === role ? "" : "none"') && flipSeg.includes('btn.classList.toggle("on", r === role)') && flipSeg.includes('setAttribute("aria-selected"'));
const loadSeg = seg(appJs, "async function loadApplications()", "// ---------- Admin: Applications sections");
check("toggle markup is the segsw family, full width class", loadSeg.includes('class="segsw apps-seg195"'));
check("Businesses label carries the live business pending count", loadSeg.includes("Businesses &middot; ${state.adminAppsByRole187.business.pend.length} pending"));
check("Creators label carries the live creator pending count", loadSeg.includes("Creators &middot; ${state.adminAppsByRole187.creator.pend.length} pending"));
check("toggle buttons wire to the flip with stable ids", loadSeg.includes('id="apps-seg-btn-business"') && loadSeg.includes('id="apps-seg-btn-creator"') && loadSeg.includes("onclick=\"adminAppSetSection195('business')\"") && loadSeg.includes("onclick=\"adminAppSetSection195('creator')\""));
check("toggle renders above both sections", loadSeg.indexOf("${toggleHtml195}") > -1 && loadSeg.indexOf("${toggleHtml195}") < loadSeg.indexOf('sectionHtml("business"'));
check("the inactive section renders hidden, the active one does not", loadSeg.includes('role === adminAppSection195 ? "" : " style=\\"display:none\\""'));
check("default resolution: the pending-holding section opens; both/neither opens Businesses", loadSeg.includes('adminAppSection195 = cPend195 > 0 && bPend195 === 0 ? "creator" : "business"'));
check("a session choice is never overridden by the default", loadSeg.includes("if (!adminAppSection195) {"));
check("both sections still render (nothing dropped, Other block kept)", loadSeg.includes('sectionHtml("business", "Business applications")') && loadSeg.includes('sectionHtml("creator", "Creator applications")') && loadSeg.includes("${otherHtml}"));
check("per-section search + Deck/List survive inside the sections", loadSeg.includes('id="apps-search-${role}"') && loadSeg.includes("adminAppSetView('deck', '${role}')") && loadSeg.includes("adminAppSetView('list', '${role}')"));
check("CSS: the wide segmented rule ships in theme-v3", themeV3.includes(".segsw.apps-seg195") && themeV3.includes("flex: 1 1 0"));

console.log("== behavior: the default rule on all four combinations ==");
const ruleSrc = (() => { const m = loadSeg.match(/adminAppSection195 = (cPend195 > 0 && bPend195 === 0 \? "creator" : "business");/); return m ? m[1] : ""; })();
check("default rule extractable for evaluation", ruleSrc.length > 0);
if (ruleSrc) {
  const pick = (b, c) => vm.runInNewContext(`(function(bPend195, cPend195){ return ${ruleSrc}; })(${b}, ${c})`);
  check("only businesses pending -> Businesses", pick(2, 0) === "business");
  check("only creators pending -> Creators", pick(0, 3) === "creator");
  check("both pending -> Businesses (the first section)", pick(2, 3) === "business");
  check("neither pending -> Businesses (the first section)", pick(0, 0) === "business");
}

// ---------------- API end-to-end ----------------
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stdout.write(`[server-err] ${d}`));
}
function stopServer() { return new Promise((res) => { if (!server) return res(); server.once("exit", () => res()); server.kill("SIGTERM"); setTimeout(res, 3000); }); }
function waitUp(tries = 60) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      const req = http.get(`${BASE}/api/bootstrap`, (r) => { r.resume(); resolve(r.statusCode === 200); });
      req.on("error", () => { if (n <= 0) resolve(false); else setTimeout(() => attempt(n - 1), 250); });
    };
    attempt(tries);
  });
}
function client() {
  let cookie = "";
  return async (method, p, body) => {
    const r = await fetch(`${BASE}${p}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: r.status, data };
  };
}

async function main() {
  startServer();
  check("dev server up", await waitUp());

  console.log("== api: fixtures ==");
  const crA = client();
  const regA = await crA("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "cra195@fixtures.dev", password: FIXPW, handle: "cra195", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true });
  check("creator A registers pending", !!regA.data.user && regA.data.user.status === "pending", JSON.stringify(regA.data).slice(0, 140));
  const crB = client();
  const regB = await crB("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "crb195@fixtures.dev", password: FIXPW, handle: "crb195", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true });
  check("creator B registers pending", !!regB.data.user && regB.data.user.status === "pending");
  const dual = client();
  const dualReg = await dual("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "dual195@fixtures.dev", password: FIXPW, handle: "dual195", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true });
  const dualSide = await dual("POST", "/api/auth/add-side", { role: "business", name: "Dual Owner", businessName: "Dual Fixture Bakery 195", category: "Bakery", market: "Nashville", agreedTerms: true, agreedPostCompliance: true });
  check("dual fixture: both sides pending and linked", !!dualReg.data.user && !!dualSide.data.user && dualSide.data.user.status === "pending" && !!dualSide.data.user.linkedAccountId, JSON.stringify(dualSide.data).slice(0, 160));
  const biz = client();
  const regBiz = await biz("POST", "/api/auth/register", { role: "business", name: "Biz Owner", email: "biz195@fixtures.dev", password: FIXPW, businessName: "Biz Fixture Shop 195", market: "Nashville", city: "Nashville", category: "Restaurant", planId: "self-service", agreedTerms: true });
  check("business registers pending", !!regBiz.data.user && regBiz.data.user.status === "pending", JSON.stringify(regBiz.data).slice(0, 140));

  const adm = client();
  const admLogin = await adm("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login works", admLogin.status === 200, String(admLogin.status));
  const rev = await adm("POST", "/api/admin/review", { userId: (regB.data.user || {}).id, decision: "approve" });
  check("creator B approved (a decided record)", rev.status === 200, JSON.stringify(rev.data).slice(0, 140));

  console.log("== api: the counts the toggle labels print ==");
  const appsRes = await adm("GET", "/api/admin/applications");
  const pend = appsRes.data.pending || [];
  const dec = appsRes.data.decided || [];
  const bPend = pend.filter((u) => u.role === "business").length;
  const cPend = pend.filter((u) => u.role === "creator").length;
  const bDec = dec.filter((u) => u.role === "business").length;
  const cDec = dec.filter((u) => u.role === "creator").length;
  check("business pending = 2 (fixture business + dual business side)", bPend === 2, `got ${bPend}`);
  check("creator pending = 2 (creator A + dual creator side)", cPend === 2, `got ${cPend}`);
  check("creator decided = 1 (approved creator B)", cDec === 1, `got ${cDec}`);
  check("business decided = 0", bDec === 0, `got ${bDec}`);
  check("labels would read 'Businesses · 2 pending' / 'Creators · 2 pending'", bPend === 2 && cPend === 2);
  check("with both queues holding pendings, the default rule opens Businesses", vm.runInNewContext(`(function(bPend195, cPend195){ return ${ruleSrc}; })(${bPend}, ${cPend})`) === "business");

  console.log("== api: the -187 cross-references survive ==");
  const allRows = [...pend, ...dec];
  const dualBizRow = allRows.find((u) => u.id === (dualSide.data.user || {}).id);
  const dualCrRow = allRows.find((u) => u.id === (dualReg.data.user || {}).id);
  check("business record cross-references the creator side", !!dualBizRow && !!dualBizRow.linkedSide && dualBizRow.linkedSide.role === "creator" && dualBizRow.linkedSide.status === "pending", JSON.stringify(dualBizRow && dualBizRow.linkedSide));
  check("creator record cross-references the business side", !!dualCrRow && !!dualCrRow.linkedSide && dualCrRow.linkedSide.role === "business" && dualCrRow.linkedSide.status === "pending", JSON.stringify(dualCrRow && dualCrRow.linkedSide));

  await stopServer();
  console.log(`\nverify-build195: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await stopServer(); process.exit(1); });
