// verify-navparity.mjs — Build -130 (Part 9E): navigation parity guard.
//
// Jeff's live Admin review (2026-11-05) found the drift class
// this script exists to kill: the phone bar showed a "Wallet"
// Admin does not have (its tap fell through to a creator view),
// the desktop rail did not show it, and the "Creators" phone
// stop landed on a placeholder with nothing to do. From now on,
// per role, the destination sets must agree across the desktop
// rail, the phone bars and the Everything panel, and every
// destination must have a real renderer somewhere in the client.
//
// Method: source composition audit (the same idiom as the other
// verify-* source checks). It reads the single sources each
// surface is composed from — railItems() for Admin,
// moreRowsFor()/tabItemsFor() for the other roles,
// everythingGroups125() for the panel — and compares the sets.
// The rendered walk (Playwright) is the second half of the
// guard; this script is the half that runs in the suite.

import fs from "node:fs";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/theme-v3.css", import.meta.url), "utf8");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  PASS", name); }
  else { failed++; failures.push(name); console.log("  FAIL", name, detail ? `:: ${detail}` : ""); }
}
// The source of one top-level function, cut at the next
// top-level function declaration.
function fnWindow(name) {
  const a = app.indexOf(`function ${name}(`);
  if (a < 0) return "";
  const rest = app.slice(a + 10);
  const m = rest.search(/\n(?:async )?function [A-Za-z0-9_]+\(/);
  return m > 0 ? app.slice(a, a + 10 + m) : app.slice(a);
}
function roleBlock(src, role, roles) {
  const marker = `u.role === "${role}"`;
  const a = src.indexOf(marker);
  if (a < 0) return "";
  let b = src.length;
  for (const r2 of roles) {
    if (r2 === role) continue;
    const j = src.indexOf(`u.role === "${r2}"`, a + marker.length);
    if (j > a && j < b) b = j;
  }
  return src.slice(a, b);
}
const tabsOf = (src) => [...src.matchAll(/tab:\s*"([^"]+)"/g)].map((m) => m[1]);
const rTabsOf = (src) => [...src.matchAll(/R\("[^"]+",\s*"[^"]+",\s*"[^"]*",\s*"([^"]+)"/g)].map((m) => m[1]);
const onTabsOf = (src) => [...src.matchAll(/t === "([^"]+)"/g)].map((m) => m[1]);

// ---------------- Admin ----------------
const railItemsSrc = fnWindow("railItems");
const railAdminRaw = roleBlock(railItemsSrc, "admin", ["admin", "creator", "business", "partner"]);
const railAdmin = railAdminRaw.slice(0, railAdminRaw.indexOf("return items;") + 13);
const railLabels = [...railAdmin.matchAll(/add\("[abc]",\s*"[^"]+",\s*"([^"]+)"/g)].map((m) => m[1]);
check("admin rail source found", railLabels.length >= 10, railLabels.join(","));

const primariesMatch = app.match(/ADMIN_RAIL_PRIMARY_125 = \[([^\]]+)\]/);
const primaries = primariesMatch ? [...primariesMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
check("phone-bar primaries are all real rail destinations",
  primaries.length === 4 && primaries.every((l) => railLabels.includes(l)), primaries.join(","));

const renderAdminSrc = fnWindow("renderAdmin");
const dispatched = new Set([...renderAdminSrc.matchAll(/tab === "([^"]+)"/g)].map((m) => m[1]));
check("every Admin rail destination has a renderAdmin branch",
  railLabels.every((l) => dispatched.has(l)),
  railLabels.filter((l) => !dispatched.has(l)).join(","));

const evSrc = fnWindow("everythingGroups125");
const evAdmin = roleBlock(evSrc, "admin", ["admin", "creator", "business", "partner"]);
const evTabs = [...tabsOf(evAdmin), ...rTabsOf(evAdmin)];
check("every Admin Everything-panel destination is a real rail destination",
  evTabs.every((t) => railLabels.includes(t)), evTabs.filter((t) => !railLabels.includes(t)).join(","));
check("Admin Everything panel carries Creators and Stats",
  evAdmin.includes('"Creators"') && evAdmin.includes('"Stats"'));
check("Admin has no Wallet destination anywhere",
  !railAdmin.includes("Wallet") && !evAdmin.includes("Wallet") && !primaries.includes("Wallet")
  && !app.includes("adminWalletGo125") && !app.includes("rail-label-short"),
  "");
check("no stale ccTab creators/markets routings remain",
  !/ccTab\s*=\s*["'](creators|markets|overview)["']/.test(app), "");
const secbar = fnWindow("syncAdminSecbar121");
check("Admin section bar composes from railItems with no inserted chips",
  secbar.includes("railItems()") && !secbar.includes("ccTab") && !secbar.includes("Creators</button>"), "");
check("Creators tab loader exists and renders a real view",
  app.includes("async function loadAdminCreators130()") && app.includes("adminViewCreator("), "");
check("Stats renders charts + the books, no Command Center shell, no forming placeholder",
  app.includes("async function loadStats()") && app.includes("astRender()") && app.includes("ccSetTab('money')")
  && !app.includes("ccFormingHtml") && !app.includes("Command Center</h2>"), "");

// ---------------- Other roles ----------------
const moreRows = fnWindow("moreRowsFor");
const tabItems = fnWindow("tabItemsFor");
check("role destination sources found", moreRows.length > 500 && tabItems.length > 200 && evSrc.length > 500, "");

// The renderer universe: the whole client minus the destination
// definition sources. A destination named nowhere else is an
// orphan — a surface entry with nothing behind it.
let rendererUniverse = app
  .replace(moreRows, "").replace(tabItems, "").replace(evSrc, "").replace(railItemsSrc, "");

const roles = ["business", "creator", "partner"];
// Partner's rail also comes from PARTNER_TABS + the partner
// block of railItems(); both are destination sources, so they
// join the partner rail set (and leave the universe).
const partnerTabsMatch = app.match(/PARTNER_TABS = \[([^\]]+)\]/);
const partnerTabs = partnerTabsMatch ? [...partnerTabsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
const railPartner = roleBlock(railItemsSrc, "partner", ["admin", "creator", "business", "partner"]);
rendererUniverse = rendererUniverse.replace(railPartner, "");
// State-conditional destinations whose rail is composed outside
// moreRowsFor: a founding creator's Status rides the railItems
// status rail; the panel row renders only in that same state.
const STATE_CONDITIONAL = { creator: ["Status"], business: [], partner: [] };

for (const role of roles) {
  const moreBlock = roleBlock(moreRows, role, [...roles, "recruiter", "pilot_partner"]);
  const tabBlock = roleBlock(tabItems, role, [...roles, "recruiter", "pilot_partner"]);
  const evBlock = roleBlock(evSrc, role, [...roles, "recruiter", "pilot_partner"]);
  const railSet = new Set([...tabsOf(moreBlock), ...tabsOf(tabBlock), ...(STATE_CONDITIONAL[role] || [])]);
  if (role === "partner") { for (const t of partnerTabs) railSet.add(t); for (const t of tabsOf(railPartner)) railSet.add(t); }
  // Sub-views a rail item itself names in its active condition
  // (e.g. business Discover carries Favorites) are reachable
  // destinations of that rail item, not panel-only orphans.
  for (const t of onTabsOf(tabBlock)) railSet.add(t);
  const evSet = new Set([...tabsOf(evBlock), ...rTabsOf(evBlock)]);
  check(`${role}: rail source carries destinations`, railSet.size >= 5, [...railSet].join(","));
  check(`${role}: every Everything destination is in the rail set`,
    [...evSet].every((t) => railSet.has(t)), [...evSet].filter((t) => !railSet.has(t)).join(","));
  check(`${role}: every rail destination has a renderer (no orphans)`,
    [...railSet].every((t) => rendererUniverse.includes(`"${t}"`)), [...railSet].filter((t) => !rendererUniverse.includes(`"${t}"`)).join(","));
}

// Desktop completeness (Part 6): the rail composition includes
// the secondary destinations inline, not only in a panel.
const tabBar = fnWindow("tabBarHtml");
check("desktop rail composes primary + secondary destinations from tabItemsFor",
  tabBar.includes("tabItemsFor()") && tabBar.includes("tab-secondary") && tabBar.includes("tab-grouplabel"), "");
check("no role's Everything trigger renders on desktop (CSS gate kept)",
  /\.tab-ev125,\s*\.tr-ev125\s*\{\s*display:\s*none\s*!important/.test(css), "");

console.log(`\nverify-navparity: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
