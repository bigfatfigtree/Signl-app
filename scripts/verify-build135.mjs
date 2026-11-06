// Build -135 verification: the fresh-eyes UX pass over the
// Build -134 shopping surfaces (Jeff, 2026-11-06: "make sure
// this is all intuitive and easy to navigate for a first time
// user"). Static pins for the plain-words canon this pass set:
// preview toggles in plain words, Shelf sort/tier/comp labels a
// stranger can read, the deck teach line only in Cards mode,
// the compare tray saying why a column is Top match, PDP rights
// and the 97%/3% split explained in place, the Mirror's paid
// line explaining the 3%, and the Charter early-access gloss.
// Run: node scripts/verify-build135.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; failures.push(name); console.error(`FAIL ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}
const slice = (s, fn, len = 4000) => { const i = s.indexOf(fn); return i < 0 ? "" : s.slice(i, i + len); };

const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");

// ---------- stamp ----------
check("stamp is 2026.11.06-135 and identical in build.js + index.html",
  buildJs.includes('BUILD_ID = "2026.11.06-135"') && indexHtml.includes("2026.11.06-135"));

// ---------- setup preview toggles ----------
check("creator preview toggles read in plain words: Your card / Top of your page",
  appJs.includes("creatorPreviewSetView('business')\">Your card</button>") &&
  appJs.includes("creatorPreviewSetView('public')\">Top of your page</button>"));
check("creator preview: the confusing 'See your public page top' is gone",
  !appJs.includes("See your public page top"));
check("creator preview helper says what businesses see, in plain words",
  appJs.includes("This is what businesses see, drawn from the fields on this page"));
check("business preview toggles keep the parallel pair (See it as a creator / See it as a business)",
  appJs.includes("offerPreviewSetView('creator')\">See it as a creator</button>") &&
  appJs.includes("offerPreviewSetView('business')\">See it as a business</button>"));

// ---------- Shelf header + filters ----------
check("shelf sort: every option is plain words a stranger can read",
  appJs.includes('<option value="local" selected>Best local fit (most local first)</option>') &&
  appJs.includes('<option value="">Founding order (first to join)</option>') &&
  appJs.includes('<option value="score">Impact score (local reach + record)</option>') &&
  appJs.includes('<option value="momentum">Reliability (Momentum)</option>') &&
  !appJs.includes(">Local Impact Score</option>") && !appJs.includes(">Momentum</option>") && !appJs.includes(">Founding order</option>"));
check("shelf tier filter explains itself: Tier (their audience size)",
  appJs.includes("<label>Tier (their audience size)</label>") && !appJs.includes("<label>Tier</label>"));
check("shelf comp filter is plain words: Would accept as a comped visit",
  appJs.includes("<label>Would accept as a comped visit</label>") && !appJs.includes("(comp fit)"));
check("preview twin (previewDiscoverHtml) carries the same plain labels as loadDiscover",
  appJs.includes('<label>Tier (their audience size)</label><select id="pvf-tier">') &&
  appJs.includes('<option value="">Founding order (first to join)</option><option value="score">Impact score (local reach + record)</option><option value="momentum">Reliability (Momentum)</option>'));
check("deck teach line renders only in Cards mode (it describes one-at-a-time browsing)",
  appJs.includes('mode === "cards" ? deckTeachHtml("discover") : ""'));

// ---------- compare tray ----------
check("tray says why a column is Top match, in place",
  appJs.includes("Top match = the highest share of local followers."));

// ---------- PDP: rights + money in plain words ----------
const wyg = slice(appJs, "function whatYouGetHtml", 3000);
const buy = slice(appJs, "function buyBoxHtml", 3000);
check("pdp What you get: comped rights in plain words, no 'native share' at the point of booking",
  wyg.includes("Comped visits stay on their own page only.") && !wyg.includes("native share"));
check("pdp buy box: comped lane in plain words too",
  buy.includes("1 post + 1 story on their own page only.") && !buy.includes("native share"));
check("pdp buy box: the 3% is explained where the money is stated",
  buy.includes("You pay the rate + 3% (card and transfer fees). They keep 97%."));

// ---------- Mirror ----------
check("mirror: the paid card explains the 3% next to the 97%",
  appJs.includes('sub: "a paid booking: you keep 97% (3% covers card + transfer fees)"'));
check("mirror + boards: Charter early-access line carries its plain-words gloss (3 surfaces)",
  (appJs.match(/the founding class \(creators approved before their market launched\)/g) || []).length === 3 &&
  !appJs.includes("Charter creators, the founding class, see new offers first"));

console.log(`\nBuild -135 verify: ${passed} passed, ${failed} failed`);
if (failed) { console.error("Failures:", failures.join(" | ")); process.exit(1); }
