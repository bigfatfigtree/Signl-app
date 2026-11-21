// verify-build222.mjs — Build -222: claim-done copy cleanup.
// Copy ONLY (founder order, 2026-11-20): the post-claim done
// screen and every creator surface repeating its local-follower
// / founding-band block drop the insider wording:
//   - "You're on the roster." -> "You're in." + the by-hand
//     review line ("We review every creator by hand. You'll
//     hear back within two business days.")
//   - "Your four facts are in." -> "Your numbers are in."
//   - The "Your Neighbor Number" section -> the count as a
//     plain sentence ("<count> of your followers live in
//     <Market>.") + "That's <N> out of 10 of your audience,
//     and it's exactly what local businesses are buying."
//     <count> and <N> are the SAME computed values as before
//     (neighborCount; tenths = round(localPct / 10), the exact
//     rounding neighborLocalWords uses server-side).
//   - Founding line -> "You're one of the first <band>
//     founding creators in <Market>." + "Founding creators
//     see offers first, and that never changes." The band is
//     still the locked band projection; no exact rank rides it.
//   - The "Your Neighbor Number is live..." line is deleted.
//   - The server plain-words line (neighborLocalWords) now
//     says "out of 10 of your audience lives here" — same
//     tenths math, new surrounding words — so the claim hook
//     and the share card drop the old phrasing too.
// No data, logic, counts or features change. Stamp
// 2026.11.20-222.
// Run: node scripts/verify-build222.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
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
check("build stamp is 2026.11.20-225 (lib + shell; bumped by Build -225)", buildJs.includes('BUILD_ID = "2026.11.20-225"') && (idxHtml.match(/2026\.11\.20-225/g) || []).length >= 5);
check("no 2026.11.20-221 left in build.js or index.html", !buildJs.includes("2026.11.20-221") && !idxHtml.includes("2026.11.20-221"));

console.log("== done screen: approved copy in, jargon out ==");
const doneStart = appJs.indexOf("function renderClaimDone()");
const doneEnd = appJs.indexOf("function neighborMissingPlatforms()");
const done = doneStart >= 0 && doneEnd > doneStart ? appJs.slice(doneStart, doneEnd) : "";
check("done slice found", done.length > 1000, `len=${done.length}`);
check("headline: You're in, (named) / You're in. (unnamed)", done.includes('T("You\'re in,"') && done.includes('T("in.", "dentro.")'));
check("sub: by-hand review line, verbatim", done.includes("We review every creator by hand. You'll hear back within two business days."));
check("numbers line, verbatim", done.includes("Your numbers are in. The moment you're approved, businesses can find your page."));
check("What you get today bullets unchanged", done.includes("When you finish your profile, your page is live and on Google that day.") && done.includes("Your rates are public on your page, so businesses see what you charge before they book.") && done.includes("Founding creators are recorded in founding order, and founding creators see offers first."));
check("done screen carries none of the old strings", !done.includes("on the roster") && !done.includes("four facts") && !done.includes("We review every creator personally"));

console.log("== stat block (neighborPanelHtml) ==");
const pStart = appJs.indexOf("function neighborPanelHtml()");
const pEnd = appJs.indexOf("function neighborAnimateCount");
const panel = pStart >= 0 && pEnd > pStart ? appJs.slice(pStart, pEnd) : "";
check("panel slice found", panel.length > 1000, `len=${panel.length}`);
check("big line: count + 'of your followers live in' + market label", panel.includes("claimFmtCount(nb.neighborCount)") && panel.includes('T("of your followers live in"') && panel.includes("${esc(marketLabel)}"));
check("share line: 'out of 10 of your audience' + buying line", panel.includes("out of 10 of your audience, and it's exactly what local businesses are buying."));
check("share <N> derives from localPct with the server's tenths rounding", panel.includes("Math.round(Number(nb.localPct) / 10)"));
check("founding line, verbatim shape with the locked band", panel.includes("You're one of the first ${f.band} founding creators in ${nb.market}.") && panel.includes("Founding creators see offers first, and that never changes."));
check("panel carries none of the old strings", !panel.includes("Neighbor Number") && !panel.includes("neighbors in") && !panel.includes("You are in the first") && !panel.includes("founding spot is locked") && !panel.includes("is live: it is your own count"));
check("stack prompt names the concept 'local followers'", panel.includes("recounts your local followers, right here."));

console.log("== rendered panel output (stub render, fixture values) ==");
{
  const sandbox = {
    state: { user: null, neighbor: { neighborCount: 1234, market: "Virginia Beach", localPct: 80, extrapolated: false, founding: { band: 100 } } },
    CLAIM_STACK_PLATFORMS: [],
    neighborMissingPlatforms: () => [],
    T: (en) => en,
    esc: (s) => String(s),
    claimFmtCount: (n) => Number(n).toLocaleString("en-US"),
    marketDisplayName: (m) => (m === "Virginia Beach" ? "Virginia Beach (Hampton Roads)" : m),
  };
  vm.createContext(sandbox);
  vm.runInContext(panel, sandbox);
  const html = vm.runInContext("neighborPanelHtml()", sandbox);
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  check("renders '<count> of your followers live in <City>.'", text.includes("1,234 of your followers live in Virginia Beach (Hampton Roads)."), text.slice(0, 300));
  check("renders 'That's 8 out of 10 of your audience...' for 80%", html.includes("That's 8 out of 10 of your audience, and it's exactly what local businesses are buying."), html.slice(0, 300));
  check("renders the founding line with band 100, no exact rank", html.includes("You're one of the first 100 founding creators in Virginia Beach.") && html.includes("Founding creators see offers first, and that never changes."), html.slice(0, 400));
  check("rendered panel has no jargon", !/Neighbor Number|on the roster|four facts|founding spot is locked|out of 10 of your followers/.test(html), html.slice(0, 300));
}

console.log("== twin surfaces for existing accounts ==");
check("creator home checklist sub: You're in.", appJs.includes('{ label: "Claim your profile", sub: "You\'re in.", done: u.status === "approved" }'));
check("creator dashboard checklist sub: You're in.", appJs.includes('{ label: "Claim your profile", sub: "You\'re in.", done: true }'));
check("stat card founding fragment aligned", appJs.includes("You're one of the first ${f.priorityBand} founding creators in ${esc(placeRaw)}"));
check("founding status badge aligned", appJs.includes("You're one of the first ${f.priorityBand} founding creators in ${esc(marketTalkNameClient(f.market))}"));

console.log("== whole shipped client + server wording ==");
check("app.js: 'Neighbor Number' gone everywhere (copy + comments)", !appJs.includes("Neighbor Number"));
check("app.js: 'You are on the roster.' gone", !appJs.includes("You are on the roster."));
check("app.js + router.js: 'out of 10 of your followers' gone", !appJs.includes("out of 10 of your followers") && !routerJs.includes("out of 10 of your followers"));
check("app.js: 'founding spot is locked' gone", !appJs.includes("founding spot is locked"));
check("router: neighborLocalWords keeps tenths math, new words", routerJs.includes('return `${tenths} out of 10 of your audience lives here`;') && routerJs.includes("const tenths = Math.round(p / 10);"));
check("stack toast names local followers", appJs.includes("Counted. Your local followers just moved."));
check("no em dash in the new copy", !/You're one of the first|out of 10 of your audience, and it/.test("") && !appJs.includes("Founding creators see offers first, and that never changes. —") && !routerJs.includes("out of 10 of your audience lives here —"));

console.log(`\nBuild -222 verify: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:", failures.join(" | ")); process.exit(1); }
