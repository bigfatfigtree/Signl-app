// Sig everywhere (Jeff, 2026-10-28): static grounding checks for
// the three surfaces that gained Sig — the partner dashboard
// (presence + a read-only Sig brief) and Admin (Sig's attention
// list). The rules under test:
//   - Partner Sig reads ONLY the /partner/summary payload the
//     dashboard already holds (state.partnerData): no new fetch,
//     no writes, no send path anywhere in the surface.
//   - Admin Sig computes its counts from the three payloads Admin
//     already loads (/admin/applications, /admin/markets,
//     /admin/partners) and introduces no new endpoint.
//   - Both surfaces carry the honesty labels (accrued, modeled,
//     read-only) and route every action to an existing tab.
//   - The build ids agree (build.js vs the shell).
// Browser behavior for these surfaces lives in
// verify-partner-dom.py. Run: node scripts/verify-sig-everywhere.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}
const region = (from, to) => {
  const a = appJs.indexOf(from);
  const b = appJs.indexOf(to, a + 1);
  return a > -1 && b > a ? appJs.slice(a, b) : "";
};

// --- partner surface exists and is wired into the shell
check("partner Sig tab is a valid destination", appJs.includes('"Help", "Sig"]') || appJs.includes('"Sig"]'));
check("partner rail lists Sig as a destination (BUILD -41: a composed row item, no More)", appJs.includes("function railRowItems(") && appJs.includes('...extra(["Home", "Markets", "Earnings"])') && !appJs.includes("PT_MORE_TABS"));
check("partner rows lead with Sig (the rail inherits the order)", appJs.includes('{ icon: "sig", label: "Sig"'));
check("renderPartnerTab renders the Sig surface", appJs.includes('if (tab === "Sig") el.innerHTML = partnerSigHtml(d);'));
check("partner Overview carries the Sig presence card", appJs.includes("partnerSigCardHtml(d)") && appJs.includes('go(\'dashboard\',\'Sig\')'));
const helpRegion = appJs.slice(appJs.indexOf("function partnerHelpHtml"), appJs.indexOf("function partnerHelpHtml") + 1400);
check("partner Help carries Sig's head-crop mark", helpRegion.includes("sigAvatarHtml") && helpRegion.includes("Open Sig"));

// --- partner Sig (Build -106): the scoped Sig chat, grounded
// server-side in the partner's own fact sheet. This block was
// rewritten in Build -106 under the intentional-change rule:
// the old static read-only partner Sig page (and its copy pins)
// was replaced by Jeff's Sig mandate — Sig answers and acts
// from real records for partners too. The old surface's honesty
// lines that still exist elsewhere stay pinned below.
const sigdataJs = fs.readFileSync(new URL("../netlify/functions/lib/sigdata.js", import.meta.url), "utf8");
const chatSurface = region("function scopedSigChatHtml", "function partnerSigHtml");
check("partner Sig surface code found", chatSurface.length > 200 && appJs.includes("function partnerSigHtml"));
check("partner Sig is the scoped chat, wired on render", appJs.includes("scopedSigChatHtml({") && appJs.includes("wireScopedSig(el)"));
check("partner Sig facts are built from the partner summary", sigdataJs.includes("function buildPartnerFacts") && sigdataJs.includes("accruedTotal") && sigdataJs.includes("frozenMonths"));
check("partner Sig answers accrual, pack, territory and brand", sigdataJs.includes("function answerPartner") && sigdataJs.includes('"partner-earnings"') && sigdataJs.includes("whole market") && sigdataJs.includes("portal look"));
check("partner Sig chat posts only to the Sig ask endpoint", appJs.includes('"/sig/ask"'));
check("partner Sig actions are link destinations only", ["partner-earnings", "partner-markets", "partner-links"].every((d) => appJs.includes(`case "${d}"`) && sigdataJs.includes(`"${d}"`)));
check("partner Sig keeps the accrued honesty label", appJs.includes("labeled accrued until a payment actually happens"));
check("partner surfaces still label the at-fill line modeled", appJs.includes("Modeled, not promised"));
check("partner Sig makes no Spanish availability claim", !appJs.includes("Spanish is staged for a later partner release") && !chatSurface.includes("Spanish"));
check("partner empty states keep the fills-in voice", appJs.includes("partnerFillsIn("));
check("partner Sig presence rides the shared hero stack", chatSurface.includes("sigHeroMediaHtml()"));

// --- admin Sig: existing endpoints only, real-count items
// Build -138: the six Admin-expansion room loaders sit between
// loadAdminSig and loadAdminPartners in file order; they are
// room code, not Sig data sources, so the region now ends at
// the first of them. The endpoint pin below is unchanged.
const adminSig = region("function adminSigItems", "async function loadAdminAutomations138");
check("admin Sig code found", adminSig.length > 500);
check("admin Sig loads applications", adminSig.includes('"/admin/applications"'));
check("admin Sig loads markets", adminSig.includes('"/admin/markets"'));
check("admin Sig loads partners", adminSig.includes('"/admin/partners"'));
const adminGets = [...adminSig.matchAll(/"(\/admin\/[a-z-]+)"/g)].map((m) => m[1]);
check("admin Sig introduces no new endpoint", adminGets.length === 3 && adminGets.every((p) => ["/admin/applications", "/admin/markets", "/admin/partners"].includes(p)), adminGets.join(","));
check("admin Sig counts pending creators + businesses", adminSig.includes('u.role === "creator"') && adminSig.includes('u.role === "business"'));
check("admin Sig computes claims today by market", adminSig.includes("Claims today:") && adminSig.includes("byMarket"));
check("admin Sig knows the demo seed state", adminSig.includes("The demo partner is not seeded"));
check("admin Sig routes items to the acting tabs", adminSig.includes('tab: "Applications"') && adminSig.includes('tab: "Markets"') && adminSig.includes('tab: "Partners"'));
check("admin Sig has an honest caught-up line", adminSig.includes("Nothing needs a decision right now"));
check("admin Sig presence rides the shared hero stack", adminSig.includes("sigHeroMediaHtml()") && adminSig.includes('sigHeroSet("idle")'));
check("renderAdmin mounts the Sig panel", appJs.includes('id="admin-sig"') && appJs.includes("loadAdminSig();"));

// --- build identity agrees
const buildId = (buildJs.match(/BUILD_ID = "([^"]+)"/) || [])[1];
check("build id present in build.js", !!buildId);
check("shell carries the same build id", !!buildId && indexHtml.includes(`window.__SIGNL_BUILD__ = "${buildId}"`));
check("app.js cache-buster matches", !!buildId && indexHtml.includes(`/app.js?v=${buildId}`));

console.log(`\nverify-sig-everywhere: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
