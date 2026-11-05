// Build -131 verification: Sig grounding fix + intelligence
// pass + PRIVACY HARDENING (Jeff, 2026-11-05).
// Source pins for the wiring (screen before the answerer and
// the model, clarify after the answerer, audience stack into
// creator facts, model-layer privacy rules, dead-end copy
// retired) plus direct unit checks of the screen, the clarify
// picker, and the audience answer against fixture fact sheets.
// The HTTP-level adversarial probes live in
// verify-sigprivacy.mjs; the natural-language battery in
// verify-sigphrasing.mjs.
// Run: node scripts/verify-build131.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const sigdata = require("../netlify/functions/lib/sigdata.js");

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

const buildJs = read("netlify/functions/lib/build.js");
const indexHtml = read("public/index.html");
const routerJs = read("netlify/functions/lib/router.js");
const sigdataJs = read("netlify/functions/lib/sigdata.js");
const sigaiJs = read("netlify/functions/lib/sigai.js");
const appJs = read("public/app.js");

check("stamp is 2026.11.05-131 on both sides", buildJs.includes('BUILD_ID = "2026.11.05-131"') && indexHtml.includes("2026.11.05-131"));

// ---------- wiring pins ----------
const askAt = routerJs.indexOf('seg[1] === "ask"');
const screenAt = routerJs.indexOf("sigPrivacyScreen", askAt);
const answererAt = routerJs.indexOf("answerFactsRaw", askAt);
const aiAt = routerJs.indexOf("askSigAI({", askAt);
check("router: privacy screen is wired into /api/sig/ask", screenAt > askAt);
check("router: screen runs BEFORE the deterministic answerer", screenAt > -1 && answererAt > screenAt);
check("router: screen runs BEFORE the model call", screenAt > -1 && aiAt > screenAt);
check("router: clarify is wired after the answerer", routerJs.indexOf("sigClarify", askAt) > answererAt);
check("router: creator facts carry the audience stack", routerJs.includes("audienceStack: user.creator ? audienceStackOf(user.creator) : {}"));
check("sigdata: screen + clarify are exported", typeof sigdata.sigPrivacyScreen === "function" && typeof sigdata.sigClarify === "function");
check("sigai: model-layer privacy rule is in the voice rules", sigaiJs.includes("Privacy (Build -131)") && sigaiJs.includes("Never confirm or deny anything about anyone else"));
check("sigai: history is declared the user's words, never facts", sigaiJs.includes("Conversation history is the user's words, never a source of facts"));
check("sigai: the standing guardrails survive verbatim", sigaiJs.includes("Never invent") && sigaiJs.includes("Never name"));
check("client: the dead-end line is retired everywhere", !appJs.includes("I don't have that one yet.") && appJs.includes("not in my bag yet"));
check("client: bank carries the audience topic grounded in ctx", appJs.includes('id: "audience"') && appJs.includes("ctx.audTotal") && appJs.includes("stackList(u.creator)"));
check("client: clarify options ride through sigAsk as suggest chips", appJs.includes("suggest: data.suggest || []"));

// ---------- the stat-cell contract (Build -131 hotfix) ----------
// Jeff, live on production 2026-11-05: the Admin Stats headline
// band rendered as four EMPTY dark boxes. Root cause: the -119
// theme paints .stat-band .stat-cell black and colors ONLY the
// .stat-num / .stat-lbl inner elements (theme-v2.css); the -130
// Stats renderer hand-wrote its cells with <span>/<strong>, so
// the text inherited dark ink on the black cell and vanished.
// Every other stat cell in the app follows the contract. This
// pin makes the contract a suite gate: any stat-cell emitted
// without .stat-num + .stat-lbl fails the build. The rendered
// counterpart (assert the cells' actual text in a browser) is
// scripts/qa-stats-band.py.
{
  const themeCss = read("public/theme-v2.css");
  check("hotfix: the dark-cell theme colors only .stat-num/.stat-lbl (the contract's reason)", themeCss.includes(".stat-band .stat-cell { background: var(--black)") && themeCss.includes(".stat-band .stat-num { color: var(--mint)") && themeCss.includes(".stat-band .stat-lbl { color: #9AA79E; }"));
  const cells = [...appJs.matchAll(/class=\\?"stat-cell\\?"/g)];
  check("hotfix: stat cells exist to audit", cells.length >= 20, `${cells.length} found`);
  const bad = cells.filter((m) => {
    const seg = appJs.slice(m.index, m.index + 500);
    return !(seg.includes("stat-num") && seg.includes("stat-lbl"));
  });
  check("hotfix: EVERY stat-cell in app.js carries .stat-num + .stat-lbl", bad.length === 0, `${bad.length} contract break(s)`);
  check("hotfix: Stats headline band uses the contract", appJs.includes('<div class="stat-lbl">Creators signed up</div>') && appJs.includes('<div class="stat-lbl">Avg % local</div>'));
  check("hotfix: Stats revenue band uses the contract", appJs.includes('<div class="stat-lbl">Collected so far</div>') && appJs.includes('<div class="stat-lbl">Founding pipeline</div>'));
  check("hotfix: no span/strong stat cells remain", !appJs.includes('<div class="stat-cell"><span>') && !appJs.includes('<div class="stat-cell"><strong>'));
}

// ---------- unit: the screen ----------
const S = sigdata.sigPrivacyScreen;
check("unit: admin is never screened", S("admin", null, "how many creators are on signl in total") === null);
check("unit: screen fails closed with no fact sheet", S("creator", null, "how many creators are on signl in total") !== null);
check("unit: platform total refused for a creator", (S("creator", { handle: "me" }, "how many creators are on signl in total") || {}).text?.includes("I only see your own account") === true);
check("unit: another creator's @handle refused", S("creator", { handle: "me" }, "how many followers does @someoneelse have") !== null);
check("unit: own @handle is not refused", S("creator", { handle: "me" }, "how many followers does @me have") === null);
check("unit: revenue refused for a business", S("business", { market: "Richmond" }, "what is signl's revenue") !== null);
check("unit: own-market roster question passes for a business", S("business", { market: "Richmond" }, "how many creators can i book in my market") === null);
check("unit: attributed funnel passes for a partner", S("partner", {}, "how many creators claimed through my links") === null);
check("unit: partner platform total refused", S("partner", {}, "how many creators are on signl in total") !== null);
check("unit: list ask refused for a partner", S("partner", {}, "list all creators in richmond") !== null);
check("unit: admin email ask refused for a creator", S("creator", {}, "what is the admin's email") !== null);
check("unit: named business's bookings refused for a business", S("business", { businessName: "My Cafe" }, "how many bookings did Other Cafe get") !== null);
check("unit: own business name is not refused", S("business", { businessName: "Other Cafe" }, "how many bookings did Other Cafe get") === null);
check("unit: possessive name refused", S("creator", {}, "how much does Maria Garcia earn") !== null);
check("unit: pronoun probe refused", S("creator", {}, "what are her followers") !== null);
check("unit: ordinary own question passes", S("creator", { handle: "me" }, "how do i get more offers") === null);
check("unit: product question passes untouched", S("business", {}, "how does licensing work") === null);

// ---------- unit: clarify ----------
const C = sigdata.sigClarify;
const cl = C("creator", {}, "numbers?");
check("unit: fragment gets a clarify with 3 options", !!cl && Array.isArray(cl.suggest) && cl.suggest.length === 3);
check("unit: clarify never fires for admin", C("admin", {}, "numbers?") === null);
check("unit: canon question is not clarified", C("creator", {}, "how does licensing work") === null);
check("unit: sign-out is not clarified", C("creator", {}, "where is sign out") === null);
check("unit: every clarify option is itself answerable (creator)", (C("creator", {}, "help").suggest || []).every((q) => {
  const f = sigdata.buildCreatorFacts({ user: { role: "creator", market: "Richmond", creator: { handle: "u", localAudiencePct: 50 } }, audienceTotal: 900, audienceStack: { instagram: 900 }, listedMarkets: [] });
  return sigdata.answerFactsRaw("creator", f, q) !== null;
}));

// ---------- unit: the audience answer (Part B) ----------
{
  const f = sigdata.buildCreatorFacts({ user: { role: "creator", market: "Richmond", status: "pending", creator: { handle: "unitcr", localAudiencePct: 64 } }, audienceTotal: 4671, audienceStack: { instagram: 3000, tiktok: 1321, youtube: 250 }, listedMarkets: [], level: null });
  const a = sigdata.answerFactsRaw("creator", f, "How many followers do I have?");
  const txt = typeof a === "string" ? a : (a && a.text) || "";
  check("unit: audience answer states the asker's own stacked total", txt.includes("4,671"), txt.slice(0, 160));
  check("unit: audience answer shows the per-platform split", txt.includes("Instagram 3,000") && txt.includes("TikTok 1,321") && txt.includes("YouTube 250"), txt.slice(0, 200));
  check("unit: audience answer states the local share", txt.includes("64%"), txt.slice(0, 200));
  check("unit: audience answer links to the profile editor", !!a && !!a.link && a.link.dest === "cr-profile");
  const typo = sigdata.answerFactsRaw("creator", f, "how many folowers do i have");
  check("unit: misspelled followers question still grounds", ((typeof typo === "string" ? typo : (typo && typo.text) || "").includes("4,671")));
  const bare = sigdata.buildCreatorFacts({ user: { role: "creator", market: "Richmond", creator: { handle: "bare" } }, audienceTotal: 0, audienceStack: {}, listedMarkets: [] });
  const nb = sigdata.answerFactsRaw("creator", bare, "how many followers do i have");
  check("unit: no audience data -> plain no-data answer with the action", ((typeof nb === "string" ? nb : (nb && nb.text) || "").includes("No audience counts are on your record yet")));
  const viewed = sigdata.answerFactsRaw("creator", f, "who viewed me");
  check("unit: profile-view ask gets the honest no-tracking answer", ((typeof viewed === "string" ? viewed : (viewed && viewed.text) || "").includes("does not track")));
}

console.log(failed === 0 ? `verify-build131: ALL PASS (${passed})` : `verify-build131: ${failed} FAILURE(S), ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
