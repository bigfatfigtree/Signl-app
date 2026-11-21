// verify-build224.mjs — Build -224: last two rendered
// "founding roster" leftovers cleaned to the plain
// "founding creator" treatment (follow-on to -222/-223).
// Copy ONLY (founder order, 2026-11-20):
//   - Menu identity line (creator, market not live):
//     "Creator on the founding roster for <market>"
//     -> "Founding creator in <market>".
//   - Offers empty line (founding, market not live):
//     "You are on the founding roster for <market>."
//     -> "You are a founding creator in <market>.",
//     remainder of the paragraph byte-identical.
// Both functions are English-only plain strings (no T()/ST()
// wrappers, no Spanish twin). No data, logic, counts or
// features change. US spelling. No em dashes introduced.
// Stamp 2026.11.20-224.
// Run: node scripts/verify-build224.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const idxHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 220) : ""}`); }
}

console.log("== stamp ==");
check("build stamp is 2026.11.20-224 (lib + shell)", buildJs.includes('BUILD_ID = "2026.11.20-224"') && (idxHtml.match(/2026\.11\.20-224/g) || []).length >= 5, `index count=${(idxHtml.match(/2026\.11\.20-224/g) || []).length}`);
check("no 2026.11.20-223 left in build.js or index.html", !buildJs.includes("2026.11.20-223") && !idxHtml.includes("2026.11.20-223"));

console.log("== menu identity line ==");
const menuStart = appJs.indexOf("function menuIdentityStateLine187");
const menuEnd = appJs.indexOf("function menuIdentityCard187");
const menu = menuStart >= 0 && menuEnd > menuStart ? appJs.slice(menuStart, menuEnd) : "";
check("menu identity slice found", menu.length > 500, `len=${menu.length}`);
check("menu: Founding creator in <market>", menu.includes('`Founding creator in ${u.market || "your market"}`'));
check("menu slice contains 'Founding creator in'", menu.includes("Founding creator in"));
check("menu slice carries no 'on the founding roster'", !menu.includes("on the founding roster"));
check("menu: old string gone", !menu.includes("Creator on the founding roster for"));

console.log("== offers empty line ==");
const offStart = appJs.indexOf("function offersEmptyLine()");
const offEnd = appJs.indexOf("function foundingEmptyActionHtml()");
const off = offStart >= 0 && offEnd > offStart ? appJs.slice(offStart, offEnd) : "";
check("offers slice found", off.length > 500, `len=${off.length}`);
check("offers: You are a founding creator in <market>.", off.includes("You are a founding creator in ${esc(mkt)}."));
check("offers: unchanged remainder of the paragraph", off.includes("Offers land here the moment the market opens, founding creators see every offer first, and we email you the moment the first business posts. There is nothing to miss until then."));
check("offers: full paragraph verbatim", off.includes("`<p>You are a founding creator in ${esc(mkt)}. Offers land here the moment the market opens, founding creators see every offer first, and we email you the moment the first business posts. There is nothing to miss until then.</p>`"));
check("offers slice carries no 'on the founding roster'", !off.includes("on the founding roster"));
check("offers: old string gone", !off.includes("You are on the founding roster for"));

console.log("== no em dash introduced ==");
check("no em dash in the new menu line", !"Founding creator in ${u.market || \"your market\"}".includes("—"));
check("no em dash in the new offers paragraph", !"You are a founding creator in ${esc(mkt)}. Offers land here the moment the market opens, founding creators see every offer first, and we email you the moment the first business posts. There is nothing to miss until then.".includes("—"));

console.log(`\nBuild -224 verify: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
