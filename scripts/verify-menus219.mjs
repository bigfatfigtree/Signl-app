// verify-menus219.mjs - Build -219b: unified hamburger menus.
//
// Data-level proof (no browser) that the shared hamburger
// carries every destination from the checkpoint v2 menu spec
// (menu-coverage.md, derived from route-inventory.md) for all
// eight shells: creator, business (local), business (national),
// admin, partner (license), partner in a pilot scope / pilot
// partner (Impact Portal), Biz Dev (Rep Home drawer form) and
// recruiter. Method: source composition audit, the same idiom
// as verify-navparity - it slices each role's branch out of
// hamburgerGroups137() (and bdOpenDrawer168() for the rep
// shell) and asserts every spec tab id, label, group, value
// word and tag is present in that branch, plus the cross-shell
// wirings (top-bar trigger, identity actions, bottom bars
// untouched).

import fs from "node:fs";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/theme-v3.css", import.meta.url), "utf8");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  PASS", name); }
  else { failed++; failures.push(name); console.log("  FAIL", name, detail ? `:: ${detail}` : ""); }
}
function fnWindow(name) {
  const a = app.indexOf(`function ${name}(`);
  if (a < 0) return "";
  const rest = app.slice(a + 10);
  const m = rest.search(/\n(?:async )?function [A-Za-z0-9_]+\(/);
  return m > 0 ? app.slice(a, a + 10 + m) : app.slice(a);
}
// Slice one role branch out of hamburgerGroups137 by its
// branch markers, in the order the branches are written.
const ham = fnWindow("hamburgerGroups137");
const MARKERS = [
  ["creator", 'if (u.role === "creator") {'],
  ["national", 'if (u.role === "business" && u.business && u.business.scope === "national") {'],
  ["business", '\n  if (u.role === "business") {'],
  ["partner", 'if (u.role === "partner" && !state.pilotScopeId) {'],
  ["pilot", 'if (u.role === "pilot_partner" || (u.role === "partner" && state.pilotScopeId)) {'],
  ["recruiter", 'if (u.role === "recruiter") {'],
  ["admin", 'if (u.role === "admin") {'],
];
const blocks = {};
MARKERS.forEach(([key, marker], i) => {
  const a = ham.indexOf(marker);
  const b = i + 1 < MARKERS.length ? ham.indexOf(MARKERS[i + 1][1]) : ham.length;
  blocks[key] = a >= 0 ? ham.slice(a, b > a ? b : ham.length) : "";
});

const SPEC = {
  creator: {
    groups: ["Your work", "Money & page", "Standing", "Account"],
    tabs: ["Dashboard", "Find Offers", "Offers", "My Visits", "Messages", "Earnings", "Profile", "Sig", "Numbers", "Momentum", "Bench", "Status", "Settings", "Help"],
    labels: ["Home", "Find offers", "My offers", "Visits", "Messages", "Wallet", "My profile", "Maggie", "Stats", "Momentum", "Bench", "Founding status", "Biz Dev home", "Settings", "Help", "Talk to support", "Sign out"],
    words: ["Your market", "Guides", "Founding only", "Seat holders", "Email", "bdGoShell()", "mailto:hello@magpielocal.com", "signOut()"],
  },
  business: {
    groups: ["Sell", "Run", "Account"],
    tabs: ["Home", "Sig", "Discover", "Block", "Campaign Setup", "My Offers", "Requests", "Favorites", "Visits & Posts", "Counter", "Regulars", "Content", "Messages", "Profile", "Plan", "Analytics", "Settings", "Help"],
    labels: ["Home", "Maggie", "Find creators", "Book the Block", "Start a new campaign", "Your campaigns", "Applicants", "Saved creators", "Visits & Posts", "Counter", "My Regulars", "Posts & licenses", "Messages", "Business profile", "Wallet", "Stats", "Settings", "Help", "Sign out"],
    words: ["Near your door", "Redeem", "In Your campaigns", "Seat holders", "goApplicants()", "bdGoShell()", "signOut()"],
  },
  national: {
    groups: ["Start", "Campaigns", "Account"],
    tabs: ["Home", "Sig", "NatCampaigns", "NatNew", "NatDiscover", "NatReports", "NatBrand", "Messages", "Settings", "Help"],
    labels: ["Home", "Maggie", "Campaigns", "Start a new campaign", "Find creators", "Reports", "Brand profile", "Messages", "Settings", "Help", "Sign out"],
    words: ["signOut()"],
    absent: ["Plan", "Counter", "Regulars", "Favorites"],
  },
  partner: {
    groups: ["Start", "Your market", "Money", "Grow", "Account"],
    tabs: ["Home", "Sig", "Markets", "Creators", "Businesses", "Messages", "Earnings", "Performance", "Links", "Team", "Account", "Help"],
    labels: ["Home", "Maggie", "Markets", "Creators", "Businesses", "Messages", "Wallet", "Fund terms", "Payout schedule", "Reports", "Links & assets", "Team", "Impact Portal: your pilot scopes", "Account", "Help", "Sign out"],
    words: ["In Wallet", "Team admins", "Pilot", "ptEarnGo125('fund')", "ptEarnGo125('returns')", "enterPilotScope(", "signOut()"],
  },
  pilot: {
    groups: ["Your pilot", "Account"],
    tabs: ["Overview", "Businesses", "Results", "Report", "Sig", "Team", "Help", "Account", "__partner_scope_exit"],
    labels: ["Overview", "Businesses", "Results", "Report", "Maggie", "Team", "Help", "Your account", "Partner view", "Sign out"],
    words: ["Your numbers", "To share", "Team admins", "Scoped partners", "signOut()"],
  },
  recruiter: {
    groups: ["Your console"],
    tabs: ["Queue", "Outreach", "Results", "Sig", "Help", "Account"],
    labels: ["Queue", "Outreach", "Results", "Maggie", "Help", "Your account", "Sign out"],
    words: ["signOut()"],
  },
  admin: {
    groups: ["Start", "Review & people", "Partners & programs", "Watch", "Run the platform", "System"],
    tabs: ["Home", "Sig", "Applications", "Requests", "Messages", "Markets", "Creators", "Recruiters", "Outreach", "Partners", "National", "Biz Dev", "Campaign", "Stats", "Compliance", "Event Log", "Marketing", "Learn", "SEO / AI search", "Social", "Automations", "Templates", "Team", "Account"],
    labels: ["Home", "Maggie", "Review", "Requests", "Messages", "Markets", "Creators", "Recruiters", "Outreach", "Partners", "National", "Biz Dev", "Campaign", "Stats", "Compliance", "Event Log", "Marketing", "Learn", "SEO / AI search", "Social", "Automations", "Templates", "Team", "Preview as business", "Business dashboard", "Preview as creator", "Preview as partner", "Your account", "Sign out"],
    words: ["Walk the app", "Founding view", "Read only", "enterPreview()", "enterPreviewDashboard()", "adminPreviewAs126('creator')", "adminPreviewAs126('partner')", "adminTabsAllowed138()", "signOut()"],
  },
};

console.log("unified hamburger: per-shell coverage (checkpoint v2 spec)");
for (const [role, spec] of Object.entries(SPEC)) {
  const blk = blocks[role] || "";
  check(`${role}: branch found`, blk.length > 200, `len=${blk.length}`);
  check(`${role}: every spec group present`, spec.groups.every((g) => blk.includes(`title: "${g}"`)), spec.groups.filter((g) => !blk.includes(`title: "${g}"`)).join(","));
  check(`${role}: every spec tab id present`, spec.tabs.every((t) => blk.includes(`"${t}"`)), spec.tabs.filter((t) => !blk.includes(`"${t}"`)).join(","));
  check(`${role}: every spec label present`, spec.labels.every((l) => blk.includes(`"${l}"`)), spec.labels.filter((l) => !blk.includes(`"${l}"`)).join(","));
  check(`${role}: value words, tags and actions present`, spec.words.every((w) => blk.includes(w)), spec.words.filter((w) => !blk.includes(w)).join(","));
  if (spec.absent) check(`${role}: market-only destinations absent`, spec.absent.every((t) => !blk.includes(`"${t}"`)), spec.absent.filter((t) => blk.includes(`"${t}"`)).join(","));
}

// Biz Dev: the rep drawer's groups are that shell's form of
// the shared menu.
console.log("unified hamburger: Biz Dev (Rep Home drawer)");
{
  const bd = fnWindow("bdOpenDrawer168");
  const tabs = ["BD Home", "BD Leads", "BD Contacts", "BD Orders", "BD Kit", "BD Money", "BD Menu", "Account"];
  const labels = ["Home", "My Leads", "Contacts", "Orders", "Seller Kit", "My Money", "Claim link, city & PIN", "Your account", "My creator side", "Manage", "Sign out"];
  check("bizdev: drawer source found", bd.length > 200, `len=${bd.length}`);
  check("bizdev: every spec tab id present", tabs.every((t) => bd.includes(`"${t}"`)), tabs.filter((t) => !bd.includes(`"${t}"`)).join(","));
  check("bizdev: every spec label present", labels.every((l) => bd.includes(`"${l}"`)), labels.filter((l) => !bd.includes(`"${l}"`)).join(","));
  check("bizdev: groups Sell + Your seat", bd.includes('title: "Sell"') && bd.includes('title: "Your seat"'));
  check("bizdev: shell exits wired (Manage for admin, My creator side otherwise)",
    bd.includes("return bdGoManage161()") && bd.includes("return bdGoCreator()"));
  check("bizdev: seat-gone collapse kept", bd.includes("state.bdNoSeat"));
  const bdi = fnWindow("bdIdentity193");
  check("bizdev: identity line carries the rep code", bdi.includes("repCode") && bdi.includes("Biz Dev") && bdi.includes("Sell mode (your HQ seat)"));
}

console.log("unified hamburger: cross-shell wiring");
{
  const open = fnWindow("openHamburger137");
  check("openHamburger delegates the Biz Dev shell to its drawer", open.includes("if (bdShellActive()) return bdOpenDrawer168();"));
  check("hamburger still ends with the pinned identity card", open.includes("${menuIdentityCard187(u, name)}"));
  const top = fnWindow("renderTopBar2");
  check("top-bar menu button opens the unified hamburger for every shell",
    top.includes('onclick="return openHamburger137()"') && top.includes('onclick="return bdOpenDrawer168()"'));
  check("top-bar menu button no longer opens the Everything panel", !top.includes("openEverything125"));
  const idc = fnWindow("menuIdentityCard187");
  check("identity action: admin goes to Account, never Settings",
    idc.includes('"Account"') && !idc.includes('? "Settings"') && idc.includes('"Your account"'));
  check("identity action: partner reads Account, creator/business read Profile and account",
    idc.includes('"Profile and account"') && idc.includes('? "Account"'));
  const isl = fnWindow("menuIdentityStateLine187");
  check("identity lines: pilot is Impact Portal, recruiter is Recruiter, business founding names the place",
    isl.includes('"Impact Portal"') && isl.includes('"Recruiter"') && isl.includes("foundingBizPlace(u)"));
  const row = fnWindow("hamburgerRowHtml137");
  check("rows render value words and tags on the right edge", row.includes("r.status") && row.includes("r.tag") && row.includes("ev219-tag"));
  check("tag pill style exists", css.includes(".ev219-tag"));
  check("no em dash in any new hamburger copy", !ham.includes("—"));
  const mp = fnWindow("menuPrimary193");
  check("primary pills unchanged: creator Find offers, business Start a new campaign, none for admin/partner/pilot/recruiter",
    mp.includes("go('dashboard','Find Offers')") && mp.includes("Start a new campaign") && mp.includes('return "";'));
  check("Everything panel left functional", app.includes("function everythingGroups125()") && app.includes("function openEverything125()"));
  const prim = (app.match(/const PRIMARY_TABS_125 = \{([\s\S]*?)\n\};/) || [])[1] || "";
  check("bottom bars untouched (daily jobs only)",
    prim.includes('creator: ["Dashboard", "Find Offers", "Sig", "Earnings", "Offers"]')
    && prim.includes('business: ["Home", "Discover", "Sig", "Plan", "Campaign Setup"]')
    && prim.includes('partner: ["Home", "Businesses", "Sig", "Performance", "__menu137"]')
    && prim.includes('pilot: ["Overview", "Businesses", "Results", "Report"]')
    && prim.includes('recruiter: ["Queue", "Outreach", "Results", "Sig", "Help"]'));
}

console.log(`\nverify-menus219: ${passed} passed, ${failed} failed`);
if (failed) { console.log("failures:", failures.join(" | ")); process.exit(1); }
