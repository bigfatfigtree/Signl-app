#!/usr/bin/env node
// Build -199 fixture suite: the UX compaction pass.
// Jeff (2026-11-18, from his phone on Admin Stats): "The way
// you are giving me this data is awful. Just constant scrolls
// and not really helpful to view this way. Anywhere that is
// like this please clean up and make it more compact and easy
// to toggle and navigate these sections. This is for admin
// and partner and business and creator profiles that have any
// kind of long scrolling text that can be cleaned up and
// toggled or buttons or drop downs or whatever."
// The pass is PRESENTATION ONLY. Its kit (theme-v3.css,
// Build -199 block): .table-wrap.ct199 keeps a data table a
// real table at phone width instead of the theme-v2 stacked
// blocks; .ux-seg199 stretches a segmented switch across one
// row; .ux-note hides a long explanation behind a "How this
// counts" tap; [data-uxmore] caps a long list behind a Show
// all toggle; [data-uxfold] folds a secondary panel. The
// record tables Jeff ordered stacked on 2026-10-25
// (applications, Finish Engine roster, Events log, creators
// list) are NOT opted in and keep the stacked treatment.
// Sign-ups by source (Build -197) renders through the kit:
// one segmented row for the windows, a compact table, and the
// referrer block retitled "AI assistants and referrals" so
// the AI-led sign-ups are findable (Jeff: "I can't find where
// it tells me if ai lead to the signups"). No counting, data,
// copy meaning, pricing, artwork, or behavior changes: the
// rendered before/after number parity is proven in the
// build's QA record; this suite pins the wiring.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const theme3Css = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");
const theme2Css = fs.readFileSync(path.join(ROOT, "public/theme-v2.css"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

console.log("== source: build stamp consistency ==");
const bid = (buildJs.match(/exports\.BUILD_ID = "([^"]+)"/) || [])[1];
check("BUILD_ID present", !!bid);
check("shell stamp matches BUILD_ID everywhere", !!bid && indexHtml.includes(`window.__SIGNL_BUILD__ = "${bid}"`) && (indexHtml.match(new RegExp(bid.replace(/\./g, "\\."), "g")) || []).length >= 5);

console.log("== source: the compaction kit (theme-v3.css) ==");
check("ct199 table variant exists", theme3Css.includes(".table-wrap.ct199 table { border-collapse: collapse; }"));
check("ct199 keeps the header row at phone width", theme3Css.includes(".table-wrap.ct199 thead { display: table-header-group; }"));
check("ct199 keeps cells as cells at phone width", theme3Css.includes(".table-wrap.ct199 th, .table-wrap.ct199 td { display: table-cell;"));
check("ct199 rows stay rows at phone width", theme3Css.includes(".table-wrap.ct199 tr { display: table-row; width: auto; }"));
check("segmented switch stretches to one row", theme3Css.includes(".segsw.ux-seg199 { display: flex; width: 100%; box-sizing: border-box; }"));
check("note toggle styles exist", theme3Css.includes(".ux-note-btn {") && theme3Css.includes(".ux-note {"));
check("show-all hidden rows are really hidden", theme3Css.includes(".ux-extra[hidden] { display: none !important; }"));
check("fold styles exist", theme3Css.includes("[data-uxfold].ux-closed .uxfold-body { display: none; }"));
check("the stacked record-table rule itself is untouched", theme2Css.includes(".table-wrap table, .table-wrap tbody, .table-wrap tr, .table-wrap td { display: block; width: 100%; box-sizing: border-box; }") && theme2Css.includes(".table-wrap table tr:first-child:has(> th) { display: none; }"));

console.log("== source: the JS helpers ==");
check("segSw takes the optional stretch class", appJs.includes("function segSw(options, current, fn, cls)"));
check("uxNote / uxNoteHtml exist", appJs.includes("function uxNote(btn)") && appJs.includes("function uxNoteHtml(text)"));
check("uxMore / uxMoreBtn exist", appJs.includes("function uxMore(btn)") && appJs.includes("function uxMoreBtn(total)"));
check("uxFold exists", appJs.includes("function uxFold(btn)"));
check("helpers fetch and count nothing", !/function ux(More|Note|Fold)\(btn\) \{[^}]*api\(/.test(appJs));

console.log("== source: Sign-ups by source through the kit ==");
check("window switch is the segmented control", appJs.includes('"src197SetWin", "ux-seg199"'));
check("source table is a compact table", appJs.includes('<div class="table-wrap ct199"><table>'));
check("referrals retitled so AI sign-ups are findable", appJs.includes("AI assistants and referrals"));
check("the old 'Arrived from' heading is gone", !appJs.includes("<h4 style=\"margin:16px 0 6px\">Arrived from</h4>"));
check("referrals say where AI assistants show up", appJs.includes("This is where AI assistants like ChatGPT show up"));
check("referral rows are capped behind Show all", appJs.includes("data-uxmore") && appJs.includes("uxMoreBtn(refs.length)"));

console.log("== source: record tables keep the stacked treatment ==");
check("applications table not opted in", appJs.includes('<table class="apps-table">') && !appJs.includes("apps-table ct199"));
check("events log not opted in", !appJs.includes("ev-table ct199"));
check("creators list table not opted in", !/adminCreators130RowsHtml[\s\S]{0,4000}ct199/.test(appJs.slice(appJs.indexOf("function adminCreators130RowsHtml"), appJs.indexOf("function adminCreators130RowsHtml") + 4000)));

console.log("== source: folds and caps are wired ==");
check("Stats foot panels fold", (appJs.match(/data-uxfold/g) || []).length >= 2);
check("Data view lists are capped", (appJs.match(/data-uxmore/g) || []).length >= 6 && (appJs.match(/uxMoreBtn\(/g) || []).length >= 6);
check("markets intro shrunk behind a note", appJs.includes("Sign-up is open everywhere; a city is flagged when two of three tripwires hit."));

console.log(`\nverify-build199: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
