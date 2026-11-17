#!/usr/bin/env node
// verify-build190.mjs — Build -190: the PL-09 blocker fix.
// The market composer is rebuilt on the national composer's
// pattern (review NO-SHIP on -189, one blocker):
//   - ONE start path: the Maggie guide sits inside the
//     composer panel (the national Maggie-card slot); the form
//     follows in the same panel.
//   - Plays, guidance templates and the kind starters fold
//     into ONE picker in the form's first step
//     (campPickerHtml); nothing stacks above the form, and
//     the rail keeps photo / preview / plan only.
//   - Audience offers + the redemption log move to their
//     management home, Your campaigns (loadMyOffers); the
//     "Already made one?" signpost card leaves the composer.
//   - Rider: applyPlayToDraft called a render function that
//     exists nowhere (the click threw; no re-render, no
//     toast). It now re-renders through loadCampaignSetup,
//     lands on the brief step, and the toast fires.
//     applyTemplate confirms with a toast too.
//   - The -189 PL-09 defect fixes survive: "Grand Opening"
//     exactly once (dedupe), selected-row contrast, no blue
//     border, shared camp-form189 class on both composers.
// The rendered end-to-end proof (real play click, toast,
// drafted brief visible, audience block at its new home)
// lives in the qa189 harness (biz-composer-d / biz-offers-d).
// Run: node scripts/verify-build190.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const themeCss = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log("  ok  " + name); }
  else { failed += 1; failures.push(name + (extra ? " :: " + extra : "")); console.log("  FAIL  " + name + (extra ? " :: " + extra : "")); }
}
const seg = (src, a, b) => { const i = src.indexOf(a); if (i < 0) return ""; const j = b ? src.indexOf(b, i + a.length) : -1; return src.slice(i, j > i ? j : undefined); };

check("stamp: BUILD_ID is 2026.11.17-190", buildJs.includes('exports.BUILD_ID = "2026.11.17-190"'));
check("stamp: shell carries 2026.11.17-190 x5", (indexHtml.match(/2026\.11\.17-190/g) || []).length === 5);
check("stamp: no -189 stamp remains in the shell", !indexHtml.includes("2026.11.17-189") && !buildJs.includes("2026.11.17-189"));

// ---- PL-09 restructure: one start path ----
const composer = seg(appJs, "async function loadCampaignSetup", "// ---------- Build -97: Your campaigns");
check("PL-09: composer renders (segment found)", composer.length > 5000);
check("PL-09: the Maggie guide renders inside the composer panel", (() => {
  const panel = composer.indexOf('id="offer-composer"');
  const guide = composer.indexOf("${campaignGuideHtml()}");
  const form = composer.indexOf('<form onsubmit="return createOfferV2(event)">');
  return panel >= 0 && guide > panel && guide < form;
})());
check("PL-09: the guide no longer stacks above the layout", composer.indexOf("${campaignGuideHtml()}") > composer.indexOf('class="camp-wrap"'));
check("PL-09: no Templates card section above the form", !composer.includes("${bizTemplatesHtml()}") && !composer.includes(">Templates</h3>"));
check("PL-09: bizTemplatesHtml survives for its other surface (Business Home)", appJs.includes("function bizTemplatesHtml()") && (appJs.match(/bizTemplatesHtml\(\)/g) || []).length >= 2);
check("PL-09: the picker opens the form's first step", (() => {
  const form = composer.indexOf('<form onsubmit="return createOfferV2(event)">');
  const picker = composer.indexOf("${campPickerHtml(mode, g)}");
  const title = composer.indexOf('id="o2-title"');
  return form >= 0 && picker > form && picker < title;
})());
check("PL-09: the picker folds plays + templates + kind starters into one block", (() => {
  const pk = seg(appJs, "function campPickerHtml", "function campRailHtml");
  return pk.includes('id="camp-picker190"') && pk.includes("campStartRowsHtml(mode, g)")
    && pk.includes("startOfferTemplate('${kind}')")
    && pk.includes('kindRow190("comp"') && pk.includes('kindRow190("paid"')
    && pk.includes('kindRow190("coupon"') && pk.includes('kindRow190("open"');
})());
check("PL-09: the rail no longer carries the play/template group", (() => {
  const rail = seg(appJs, "function campRailHtml", "// ---------- offer composer v2");
  return !rail.includes("campStartRowsHtml") && !rail.includes("Start from a play or template")
    && rail.includes("bizOfferPhotoHtml()") && rail.includes("packageSummaryHtml");
})());

// ---- Relocation: Audience offers + redemption log ----
check("PL-09: the audience block is gone from the composer", !composer.includes('id="aud-block"') && !composer.includes("loadAudienceBlock()"));
check("PL-09: the signpost card is gone from the composer", !composer.includes("Already made one?"));
check("PL-09: the audience block renders at its new home (Your campaigns)", (() => {
  const home = seg(appJs, "async function loadMyOffers", "// Offers list state");
  return home.includes('id="aud-block"') && home.includes("loadAudienceBlock()");
})());
check("PL-09: the audience block itself is untouched (create + redemption log intact)", (() => {
  const aud = seg(appJs, "async function loadAudienceBlock", "async function audCreateStandalone");
  return aud.includes("Audience offers") && aud.includes("Log an audience redemption") && aud.includes("audCreateStandalone()");
})());
check("PL-09: creator My offers keeps its own audience block", seg(appJs, "async function loadCreatorOffers", "// ---------- Deals: the Offer Card").includes('id="aud-block"'));

// ---- Rider: the play click path ----
check("rider: the dead render call exists nowhere in the app", !appJs.includes("renderMyOffersPage"));
check("rider: applyPlayToDraft re-renders through the composer and confirms", (() => {
  const fn = seg(appJs, "function applyPlayToDraft", "function composerPlaysHtml");
  return fn.includes("loadCampaignSetup()") && fn.includes("showToast(") && fn.includes("Play set:");
})());
check("rider: applying a play lands on the brief step where its drafting shows", seg(appJs, "function applyPlayToDraft", "function composerPlaysHtml").includes("state.campaignStep = 2"));
check("rider: applyTemplate confirms with a toast", seg(appJs, "function applyTemplate", "// The live coaching").includes("showToast("));

// ---- Carried -189 PL-09 defect fixes ----
check("PL-09 (carried): template list still dedupes against the plays", seg(appJs, "function campStartRowsHtml", "function campPickerHtml").includes("seenTpl189"));
check("PL-09 (carried): Grand Opening is a single play", (appJs.match(/name: "Grand Opening"/g) || []).length === 1);
check("PL-09 (carried): no blue border on the Maggie guide box", !seg(appJs, "function campaignGuideHtml", "function campaignGuideRender").includes("border:2px solid #006AFC"));
check("PL-09 (carried): both composers carry the shared white form class", appJs.includes('class="panel camp-form189" id="offer-composer"') && appJs.includes('class="camp-form189" onsubmit="return natSaveCampaign'));
check("PL-09 (carried): selected radio rows keep dark text on the selected fill", themeCss.includes(".radio-chip:has(input:checked)") && themeCss.includes("color: var(--ink) !important"));

console.log(`\nBUILD190 VERIFY: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
