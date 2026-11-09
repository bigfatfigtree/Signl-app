// verify-build171.mjs — Build -171: the phone top bar,
// rearranged (Jeff, 2026-11-09, correcting -168 the same
// afternoon: "i meant for it to go in the top left — the
// hamburger menu — and the logo goes to top right now — on
// all dashboards").
//
// THE CHANGE (CSS only, public/theme-v3.css): at phone
// widths (max-width 767.98px) the slim top bar (.tb2 —
// creator / business / partner / pilot shells and the Biz
// Dev seller shell) and the admin top row (.tr) put the
// HAMBURGER first (top-left) and the Magpie lockup last
// (top-right). .tb2-actions unwraps (display:contents) so
// the hamburger inside it can take the first flex slot; the
// identity chip, help and Messages/stats shortcuts keep the
// middle. Desktop is untouched — every -171 rule lives in
// the phone media query.
//
// This suite pins the source contracts; the rendered QA
// (~/workspace/xmedium-qa/signl_build171_qa.py) proves the
// geometry on screen: hamburger leftmost, logo rightmost,
// no overlaps, one logo per bar, the top-left hamburger
// opens the -168 drawer, per role at 390px.
// Run: node scripts/verify-build171.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build171-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = "verify171-admin-pw";
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
      if (head.startsWith("@")) {
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
const inMedia = (r, needle) => r.media.some((m) => m.replace(/\s+/g, "").includes(needle.replace(/\s+/g, "")));
const inPhone = (r) => inMedia(r, "max-width: 767.98px");
const phoneRules = (sel) => rules.filter((r) => r.selector === sel && inPhone(r));
const lastPhone = (sel) => { const rs = phoneRules(sel); return rs[rs.length - 1]; };

// ---------- the -171 phone arrangement (.tb2 shells) ----------
const actions = lastPhone(".tb2-actions");
check("phone: .tb2-actions unwraps (display:contents) so its hamburger can lead the row",
  !!actions && /display:\s*contents/.test(actions.body), actions && actions.body);
const burger = lastPhone(".tb2-burger137, .tb2-ev125");
check("phone: the top-bar hamburger takes the first slot (order 1)",
  !!burger && /order:\s*1/.test(burger.body), burger && burger.body);
const tb2brand = lastPhone(".tb2-brand");
check("phone: the .tb2 lockup takes the last slot (order 5) pinned right (margin-left auto)",
  !!tb2brand && /order:\s*5/.test(tb2brand.body) && /margin-left:\s*auto/.test(tb2brand.body), tb2brand && tb2brand.body);
const tb2id = lastPhone(".tb2-id");
check("phone: the identity chip follows the hamburger and gives up its auto margin",
  !!tb2id && /order:\s*2/.test(tb2id.body) && /margin-left:\s*0/.test(tb2id.body), tb2id && tb2id.body);
const msgBtn = lastPhone(".tb2-actions > .tb2-btn:not(.tb2-burger137):not(.tb2-ev125)");
check("phone: the Messages shortcut keeps a middle slot (order 4)",
  !!msgBtn && /order:\s*4/.test(msgBtn.body), msgBtn && msgBtn.body);

// ---------- the -171 phone arrangement (admin .tr row) ----------
const trBurger = lastPhone(".tr-ev125");
check("phone: the admin row's hamburger takes the first slot (order 1)",
  !!trBurger && /order:\s*1/.test(trBurger.body) && /margin-left:\s*0/.test(trBurger.body), trBurger && trBurger.body);
const trBrand = lastPhone(".tr-brand");
check("phone: the admin row's lockup takes the last slot (order 5) pinned right",
  !!trBrand && /order:\s*5/.test(trBrand.body) && /margin-left:\s*auto/.test(trBrand.body), trBrand && trBrand.body);
const trId = lastPhone(".tr-id");
check("phone: the admin identity chip follows the hamburger (order 2, no auto margin)",
  !!trId && /order:\s*2/.test(trId.body) && /margin-left:\s*0/.test(trId.body), trId && trId.body);

// ---------- the arrangement is phone-only (desktop untouched) ----------
check("no -171 order rule lives outside the phone media query",
  rules.every((r) => !(/order:\s*5/.test(r.body) && (r.selector === ".tb2-brand" || r.selector === ".tr-brand")) || inPhone(r)));
check("desktop lockup strip untouched: the >=1024 .tb2 float still right-aligns and hides the bar's other children",
  rules.some((r) => inMedia(r, "min-width: 1024px") && r.selector === "body.v3-on .tb2-in" && /justify-content:\s*flex-end/.test(r.body))
  && rules.some((r) => inMedia(r, "min-width: 1024px") && r.selector === "body.v3-on .tb2-id, body.v3-on .tb2-help130, body.v3-on .tb2-actions" && /display:\s*none/.test(r.body)));
check("desktop admin row untouched: the >=1024 lockup still sits against the right cluster",
  rules.some((r) => inMedia(r, "min-width: 1024px") && r.selector === ".tr-brand" && /margin-left:\s*auto/.test(r.body)));
check("the toprow hamburger stays phone-only furniture (hidden >=768px, as before)",
  rules.some((r) => inMedia(r, "min-width: 768px") && r.selector.includes(".tr-ev125") && /display:\s*none/.test(r.body)));

// ---------- app.js: the markup the arrangement stands on ----------
check("renderTopBar2 still emits ONE lockup and the hamburger inside .tb2-actions",
  (appJs.match(/class="tb2-brand mbrand"/g) || []).length === 1
  && appJs.includes('class="tb2-btn tb2-burger137" onclick="return openHamburger137()"')
  && appJs.includes('class="tb2-btn tb2-ev125" onclick="return openEverything125()"'));
check("renderTopRow still emits ONE lockup and its hamburger in .tr-right",
  (appJs.match(/class="tr-brand mbrand"/g) || []).length === 1
  && appJs.includes('class="tr-ev125" onclick="return openHamburger137()"'));
check("the -168 drawer wiring the hamburger opens is intact",
  appJs.includes("function drawer168HeadHtml(closeFn)")
  && appJs.includes("function bdMenuTap168()")
  && appJs.includes('window.matchMedia("(max-width: 767.98px)")'));

// ---------- the bottom bars are NOT redesigned ----------
const primBlock = (appJs.match(/const PRIMARY_TABS_125 = \{[\s\S]*?\};/) || [""])[0];
check("bottom-bar canon untouched: creator bar is Home · Find · Maggie · Wallet · Offers",
  primBlock.includes('creator: ["Dashboard", "Find Offers", "Sig", "Earnings", "Offers"]'));
check("bottom-bar canon untouched: business bar is Home · Find · Maggie · Wallet · Start",
  primBlock.includes('business: ["Home", "Discover", "Sig", "Plan", "Campaign Setup"]'));
check("bottom-bar canon untouched: partner bar keeps its Menu slot",
  primBlock.includes('partner: ["Home", "Businesses", "Sig", "Performance", "__menu137"]'));

// ---------- smoke: the app still boots and serves its shell ----------
async function call(method, p) {
  const res = await handler({ httpMethod: method, path: p, headers: {}, queryStringParameters: {}, body: null, isBase64Encoded: false });
  return { status: res.statusCode, body: res.body || "" };
}
const boot = await call("GET", "/api/bootstrap");
check("GET /api/bootstrap answers 200", boot.status === 200, String(boot.status));
check("index.html loads app.js and theme-v3.css (theme-v3.css is the file this build touches)",
  indexHtml.includes("/app.js?v=") && indexHtml.includes("/theme-v3.css?v="));

console.log(`\nverify-build171: ${passed} passed, ${failed} failed`);
if (failures.length) console.log("failures:", failures.join(" | "));
process.exit(failed ? 1 : 0);
