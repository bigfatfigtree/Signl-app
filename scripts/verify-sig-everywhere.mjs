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

// --- partner Sig is grounded in the summary payload only
const sigSurface = region("function partnerSigActions", "// Shared in-app notifications block");
check("partner Sig surface code found", sigSurface.length > 500);
check("partner Sig reads the funnel stages", sigSurface.includes("d.creators.stages") && sigSurface.includes("d.businesses.stages"));
check("partner Sig reads per-market funnels", sigSurface.includes("d.markets.map") || sigSurface.includes("for (const m of d.markets)"));
check("partner Sig reads earnings + links from the payload", sigSurface.includes("d.earnings") && sigSurface.includes("d.links.map"));
check("partner Sig makes no API calls (read-only)", !sigSurface.includes("api(") && !sigSurface.includes("fetch("), "found a network call in the partner Sig surface");
check("partner Sig has no write verb", !/method:\s*"POST"|method:\s*"PATCH"|method:\s*"DELETE"/.test(sigSurface));
check("partner Sig actions route to existing tabs only", ["Links", "Businesses", "Account", "Performance"].every((t) => sigSurface.includes(`tab: "${t}"`) || sigSurface.includes(`'${t}'`)));
check("partner Sig carries the read-only line", sigSurface.includes("I never send or change anything"));
check("partner Sig keeps the accrued honesty label", sigSurface.includes("labeled accrued until a payment actually happens"));
check("partner Sig labels the at-fill line modeled", sigSurface.includes("Modeled, not promised"));
check("partner Sig notes Spanish is staged", sigSurface.includes("Spanish is staged for a later partner release"));
check("partner Sig empty state uses the fills-in voice", sigSurface.includes("partnerFillsIn("));
check("partner Sig presence rides the shared hero stack", sigSurface.includes("sigHeroMediaHtml()"));

// --- admin Sig: existing endpoints only, real-count items
const adminSig = region("function adminSigItems", "async function loadAdminPartners");
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
