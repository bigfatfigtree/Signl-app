// verify-build168.mjs — Build -168: the left slide-out drawer
// on phones (Jeff, 2026-11-09, Fly.io console as the reference:
// "for mobile we should have the hamburger menu move to the
// left on all dashboards — and it slides out as people use it
// like this one").
//
// THE CHANGE: on phone widths (max-width 767.98px, the app's
// own breakpoint) the full-menu surfaces stop being bottom
// sheets and become LEFT DRAWERS — full height, min(84vw,
// 340px), the Magpie logo at the top with a clear ✕ at the
// drawer's top right, the overlay's dim as the scrim, sliding
// in/out on transforms:
//   - the hamburger panel (creator / business / partner /
//     admin groups) — openHamburger137 / closeHamburger137;
//   - the Everything panel (pilot + recruiter shells) —
//     openEverything125 / closeEverything125;
//   - the Biz Dev shell's Menu — bdMenuTap168: phones open
//     bdOpenDrawer168 (the shell's full destination set),
//     desktop keeps going to the BD Menu page.
// Desktop is unchanged (the panels keep their top-right card;
// the drawer head row is display:none there) and the bottom
// bars are untouched (PRIMARY_TABS_125 pinned below).
//
// This suite pins the source contracts the rendered QA then
// proves on screen (~/workspace/xmedium-qa/signl_build168_qa.py:
// the OPENED drawer at 390px for every role, label visibility
// + contrast asserted, X / scrim / destination closes).
// Run: node scripts/verify-build168.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build168-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify168-admin-pw";
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const { handler } = require("../netlify/functions/api.js");
const root = process.cwd();
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/theme-v3.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

// ---------- tiny CSS reader: rules with their media context ----------
function cssRules(cssText) {
  const rules = [];
  const stack = [];
  let i = 0;
  let prelude = "";
  while (i < cssText.length) {
    const ch = cssText[i];
    if (ch === "{") {
      const head = prelude.trim();
      prelude = "";
      if (head.startsWith("@media")) { stack.push(head); i += 1; continue; }
      if (head.startsWith("@")) { // @keyframes etc: record and skip body
        let depth = 1; i += 1;
        const start = i;
        while (i < cssText.length && depth > 0) { if (cssText[i] === "{") depth += 1; else if (cssText[i] === "}") depth -= 1; i += 1; }
        rules.push({ selector: head, body: cssText.slice(start, i - 1), media: stack.slice() });
        continue;
      }
      let depth = 1; i += 1;
      const start = i;
      while (i < cssText.length && depth > 0) { if (cssText[i] === "{") depth += 1; else if (cssText[i] === "}") depth -= 1; i += 1; }
      rules.push({ selector: head, body: cssText.slice(start, i - 1), media: stack.slice() });
      continue;
    }
    if (ch === "}") { stack.pop(); i += 1; prelude = ""; continue; }
    prelude += ch; i += 1;
  }
  return rules;
}
const rules = cssRules(css.replace(/\/\*[\s\S]*?\*\//g, ""));
const inMedia = (r, needle) => r.media.some((m) => m.includes(needle));
const phoneRule = (sel) => rules.find((r) => r.selector === sel && inMedia(r, "max-width: 767.98px"));
const deskRule = (sel) => rules.find((r) => r.selector === sel && inMedia(r, "min-width: 768px"));
const baseRule = (sel) => rules.find((r) => r.selector === sel && r.media.length === 0);

// ---------- the drawer placement: phones ----------
for (const sel of [".ham137-panel", ".ev125-panel"]) {
  const r = phoneRule(sel);
  check(`phone: ${sel} is a left drawer (left anchored, top+bottom pinned)`,
    !!r && /left:\s*0/.test(r.body) && /top:\s*0/.test(r.body) && /bottom:\s*0/.test(r.body), r && r.body);
  check(`phone: ${sel} width is ~84vw capped (min(84vw, 340px))`,
    !!r && /width:\s*min\(84vw,\s*340px\)/.test(r.body), r && r.body);
  check(`phone: ${sel} slides in on a transform (drawerIn168), no bottom-sheet rise`,
    !!r && /animation:\s*drawerIn168/.test(r.body) && !/vxSheetUp/.test(r.body) && !/max-height:\s*88vh/.test(r.body), r && r.body);
  const d = deskRule(sel);
  check(`desktop: ${sel} keeps the top-right card (unchanged)`,
    !!d && /top:\s*14px/.test(d.body) && /right:\s*14px/.test(d.body) && /width:\s*400px/.test(d.body), d && d.body);
}
// ---------- the shared drawer pieces ----------
check("keyframes drawerIn168 slides from translateX(-104%) to 0",
  rules.some((r) => r.selector === "@keyframes drawerIn168" && /translateX\(-104%\)/.test(r.body) && /translateX\(0\)/.test(r.body)));
check("keyframes drawerOut168 slides back out to translateX(-104%)",
  rules.some((r) => r.selector === "@keyframes drawerOut168" && /translateX\(-104%\)/.test(r.body)));
check("closing state: both panels animate out under .drawer168-closing",
  rules.some((r) => r.selector.includes(".drawer168-closing") && r.selector.includes(".ham137-panel") && /drawerOut168/.test(r.body))
  && rules.some((r) => r.selector.includes(".drawer168-closing") && r.selector.includes(".ev125-panel") && /drawerOut168/.test(r.body)));
check("scroll lock: body.drawer168-open hides overflow",
  rules.some((r) => r.selector === "body.drawer168-open" && /overflow:\s*hidden/.test(r.body)));
const headBase = baseRule(".drawer168-head");
check("drawer head row is display:none outside the phone block (desktop untouched)",
  !!headBase && /display:\s*none/.test(headBase.body));
const headPhone = phoneRule(".drawer168-head");
check("drawer head row renders as a flex bar on phones",
  !!headPhone && /display:\s*flex/.test(headPhone.body));
check("the ✕ is a real 44px tap target on phones",
  (() => { const r = phoneRule(".drawer168-x"); return !!r && /width:\s*44px/.test(r.body) && /height:\s*44px/.test(r.body); })());
check("panels' own head ✕ buttons hide on phones (the drawer head carries the one ✕)",
  rules.some((r) => inMedia(r, "max-width: 767.98px") && r.selector.includes(".ham137-head .linklike") && /display:\s*none/.test(r.body))
  && rules.some((r) => inMedia(r, "max-width: 767.98px") && r.selector.includes(".ev125-head .linklike") && /display:\s*none/.test(r.body)));
check("reduced motion: the drawer panels do not animate",
  rules.some((r) => inMedia(r, "prefers-reduced-motion: reduce") && r.selector.includes(".ham137-panel") && /animation:\s*none/.test(r.body)));

// ---------- app.js: the open/close wiring ----------
check("drawer head: logo + labelled ✕ wired to the panel's own close",
  appJs.includes('function drawer168HeadHtml(closeFn)')
  && appJs.includes('class="brand-lockup drawer168-brand"')
  && appJs.includes('class="drawer168-x"')
  && appJs.includes('aria-label="Close menu"'));
check("hamburger panel carries the drawer head and locks scroll on open",
  appJs.includes('${drawer168HeadHtml("closeHamburger137")}')
  && /el\.id = "hamburger137";[\s\S]{0,2400}drawer168Lock\(\);/.test(appJs));
check("Everything panel carries the drawer head and locks scroll on open",
  appJs.includes('${drawer168HeadHtml("closeEverything125")}')
  && /el\.id = "everything-panel125";[\s\S]{0,2400}drawer168Lock\(\);/.test(appJs));
check("both closes route through the animated dismiss",
  /function closeHamburger137\(\) \{\s*const el = document\.getElementById\("hamburger137"\);\s*if \(el\) drawer168Dismiss\(el\);/.test(appJs)
  && /function closeEverything125\(\) \{\s*const el = document\.getElementById\("everything-panel125"\);\s*if \(el\) drawer168Dismiss\(el\);/.test(appJs));
check("dismiss: instant off phones, animated drawer168-closing on phones",
  appJs.includes('function drawer168Dismiss(el)')
  && appJs.includes('el.classList.add("drawer168-closing")')
  && appJs.includes('function drawer168Mobile()')
  && appJs.includes('window.matchMedia("(max-width: 767.98px)")'));
check("reopen kills the outgoing panel on the spot (no duplicate overlays)",
  appJs.includes('const old137 = document.getElementById("hamburger137");')
  && appJs.includes('const old125 = document.getElementById("everything-panel125");'));
check("scrim tap still closes all three menu overlays",
  (appJs.match(/e\.target === el\) (closeHamburger137|closeEverything125|closeBdDrawer168)\(\)/g) || []).length === 3);
check("unlock only fires when no menu overlay remains",
  appJs.includes('function drawer168Unlock()')
  && appJs.includes('!document.getElementById("bd-drawer168")'));

// ---------- app.js: the Biz Dev drawer ----------
check("bdMenuTap168: phones open the drawer, desktop keeps the BD Menu page",
  /function bdMenuTap168\(\) \{\s*if \(!drawer168Mobile\(\)\) return go\("dashboard", "BD Menu"\);\s*return bdOpenDrawer168\(\);/.test(appJs));
check("the BD phone bar's Menu item calls bdMenuTap168 (bar order + labels untouched)",
  appJs.includes('tab === "BD Menu" ? "return bdMenuTap168()"'));
check("the BD rail item calls bdMenuTap168 too",
  appJs.includes('add("a", "menu", "Menu", "return bdMenuTap168()", t === "BD Menu");'));
check("BD drawer carries the shell's full destination set",
  appJs.includes('dest("home", "Home"') && appJs.includes('dest("users", "My Leads"')
  && appJs.includes('dest("deck", "Seller Kit"') && appJs.includes('dest("stats", "My Money"')
  && appJs.includes('dest("menu", "Menu & PIN"') && appJs.includes('"Your account"'));
check("BD drawer: admin gets Manage, a rep gets My creator side, sign out always rides",
  appJs.includes('"Manage"') && appJs.includes('return bdGoManage161()')
  && appJs.includes('"My creator side"') && appJs.includes('return bdGoCreator()')
  && appJs.includes('bdDrawerRowHtml168'));
check("BD drawer only opens inside the rep shell",
  appJs.includes('if (!u || !bdShellActive()) return false;'));

// ---------- the bottom bars are NOT redesigned ----------
const primBlock = (appJs.match(/const PRIMARY_TABS_125 = \{[\s\S]*?\};/) || [""])[0];
check("bottom-bar canon untouched: creator bar is Home · Find · Maggie · Wallet · Offers",
  primBlock.includes('creator: ["Dashboard", "Find Offers", "Sig", "Earnings", "Offers"]'));
check("bottom-bar canon untouched: business bar is Home · Find · Maggie · Wallet · Start",
  primBlock.includes('business: ["Home", "Discover", "Sig", "Plan", "Campaign Setup"]'));
check("bottom-bar canon untouched: partner bar keeps its Menu slot",
  primBlock.includes('partner: ["Home", "Businesses", "Sig", "Performance", "__menu137"]'));
check("the partner bar Menu slot and the top-bar burger still open the hamburger",
  appJs.includes('class="tab-item tab-bar137 tab-menu137"') && appJs.includes("tb2-burger137"));

// ---------- smoke: the app still boots and serves its shell ----------
async function call(method, p) {
  const res = await handler({ httpMethod: method, path: p, headers: {}, queryStringParameters: {}, body: null, isBase64Encoded: false });
  return { status: res.statusCode, body: res.body || "" };
}
const boot = await call("GET", "/api/bootstrap");
check("GET /api/bootstrap answers 200", boot.status === 200, String(boot.status));
check("index.html loads app.js and theme-v3.css (the two files this build touches)",
  indexHtml.includes("/app.js?v=") && indexHtml.includes("/theme-v3.css?v="));

console.log(`\nverify-build168: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("failures:", failures.join(" | "));
process.exit(failed ? 1 : 0);
