// verify-build228.mjs — Build -228: the admin nav regression fix.
// Jeff (2026-11-21 01:21-01:25 ET): his admin sign-in opened the
// Sell/HQ drawer on every screen — every admin destination was
// gone from his menu — and the Sell drawer itself showed Your
// account / Manage / Sign out twice, with a home icon on
// Contacts. Trace (git, verified):
//   - Duplication: Build -219b (e0444f8, unified hamburger
//     menus) added the "Your seat" row group to bdOpenDrawer168
//     duplicating the pill actions Build -193 (15e540c) placed
//     in bdIdentity193's identity block.
//   - Admin loss: openHamburger137 and the top-bar menu button
//     routed on bdShellActive() alone (seat active + not the
//     creator shell + not the staff view). state.shell is unset
//     at boot, so an admin with an HQ seat got the Sell drawer
//     everywhere, including Admin Home; the complete admin
//     branch inside hamburgerGroups137 was dead code for him.
//   - Contacts icon: bnIcon() had no "book" glyph; its fallback
//     is the home glyph, so every "book" call site rendered
//     Home.
// Fixes pinned here (public/app.js):
//   - bdMenuDrawerApplies() gates the drawer: non-admin seat
//     holders unchanged; an admin gets the drawer only in Sell
//     mode (state.shell === "bizdev"), the admin menu elsewhere.
//     Both entry points (openHamburger137, renderTopBar2) use it.
//   - bdIdentity193 renders no pill row (avatar, name, seat line
//     only); the "Your seat" rows are the single canonical set.
//   - bnIcon carries a real "book" glyph.
//   - hamburgerGroups137: creator "Find offers" row and
//     business "Start a new campaign" rows removed (the menu
//     pill is each destination's only carrier); the admin
//     branch gains "Biz Dev home" for seat holders.
//   - menuIdentityCard187 renders no account/profile button;
//     the dual-role side-switch stays.
//   - everythingGroups125: admin gains SEO / AI search and
//     Deleted accounts; pilot and recruiter gain Your account.
//   - railItems: the admin rail gains Deleted.
// Full rendered proof (independent reviewer, Playwright at
// 390x844, per-destination counts in every shell):
// ~/workspace/build227-review/RESULTS.md (the review ran under
// the -227 folder name before this build took -228).
// Stamp 2026.11.21-228.
// Run: node scripts/verify-build228.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const buildJs = read("netlify/functions/lib/build.js");
const idxHtml = read("public/index.html");
const appJs = read("public/app.js");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 220) : ""}`); }
}
function fnWindow(name) {
  const start = appJs.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const next = appJs.indexOf("\nfunction ", start + 10);
  const nextAsync = appJs.indexOf("\nasync function ", start + 10);
  let end = appJs.length;
  if (next > 0) end = Math.min(end, next);
  if (nextAsync > 0) end = Math.min(end, nextAsync);
  return appJs.slice(start, end);
}

console.log("== stamp ==");
check("build stamp is 2026.11.21-228 (lib + shell)", buildJs.includes('BUILD_ID = "2026.11.21-228"') && (idxHtml.match(/2026\.11\.21-228/g) || []).length >= 5, `index count=${(idxHtml.match(/2026\.11\.21-228/g) || []).length}`);
check("no 2026.11.21-227 left in build.js or index.html", !buildJs.includes("2026.11.21-227") && !idxHtml.includes("2026.11.21-227"));

console.log("== admin routing ==");
const gate = fnWindow("bdMenuDrawerApplies");
check("bdMenuDrawerApplies exists and keys the admin case on the Sell shell", gate.includes('u.role === "admin"') && gate.includes('state.shell === "bizdev"'), gate.slice(0, 160));
check("bdShellActive itself is unchanged", fnWindow("bdShellActive").includes('state.shell !== "creator"') && fnWindow("bdShellActive").includes('state.view !== "staff"'));
check("openHamburger137 delegates through the gate", fnWindow("openHamburger137").includes("bdMenuDrawerApplies()"));
check("renderTopBar2 menu button delegates through the gate", fnWindow("renderTopBar2").includes('bdMenuDrawerApplies() ? `<button') && fnWindow("renderTopBar2").includes('onclick="return bdOpenDrawer168()"'));

console.log("== Sell drawer ==");
const ident = fnWindow("bdIdentity193");
check("bdIdentity193 renders no pill row", !ident.includes("menu-idcard187-acts") && !ident.includes("btn ghost small-btn"), "");
check("bdIdentity193 keeps avatar, name and seat line", ident.includes("selfAvatarUrl122(u)") && ident.includes("stateLine") && ident.includes("esc(u.name"), "");
const drawer = fnWindow("bdOpenDrawer168");
check("drawer seat rows are the canonical set (Your account / Manage / Sign out, once each)",
  (drawer.match(/"Your account"/g) || []).length === 1 && (drawer.match(/"Manage"/g) || []).length === 1 && (drawer.match(/"Sign out"/g) || []).length === 1, "");
check("bnIcon carries a real book glyph (Contacts)", appJs.includes("book: `<"));

console.log("== hamburger sets ==");
const ham = fnWindow("hamburgerGroups137");
check("admin branch carries Biz Dev home for seat holders", ham.includes('"Biz Dev home"') && ham.includes("bdGoShell()"), "");
check("admin branch carries the full platform set", ["SEO / AI search", "Deleted accounts", "Markets", "Review", "Stats", "Your account", "Sign out"].every((s) => ham.includes(s)), "");
check("creator groups carry no Find offers row (pill only)", !ham.slice(ham.indexOf('u.role === "creator"'), ham.indexOf('u.role === "business"')).includes('"Find Offers"'), "");
const card = fnWindow("menuIdentityCard187");
check("identity card renders no account/profile button", !/onclick="\$\{profAct\}"/.test(card) && !card.includes("profTab"), "");
check("identity card keeps the side-switch button", card.includes("switchSide180()"), "");

console.log("== Everything panel + rail ==");
const ev = fnWindow("everythingGroups125");
check("admin Everything panel carries SEO / AI search and Deleted accounts", ev.includes('"SEO / AI search"') && ev.includes('"Deleted accounts"'), "");
check("admin rail carries Deleted", fnWindow("railItems").includes('"Deleted", "return go(\'dashboard\',\'Deleted\')"'), "");

console.log(`\nverify-build228: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("failures: " + failures.join(" | "));
process.exit(failed ? 1 : 0);
