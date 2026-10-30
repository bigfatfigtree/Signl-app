// Build -51 verification: the FRESH-EYES APP PASS (Jeff's
// fresh-eyes rule, 2026-10-30: every screen walked as a
// brand-new user who knows none of SIGNL's terms — Momentum,
// Charter, Bench, Sig, local %, counted, tiers; insider
// vocabulary is guilty until the screen explains it in place,
// in plain words). Source: the fresh-eyes audit
// (signl-fresh-eyes-audit-2026-10-30.md), findings A-02…A-19
// and the app halves of X-05…X-08, plus the site pass's
// deferred item (the "Self-reported" chip gloss, app side).
//
// Findings verified against the -50 code first and found
// ALREADY FIXED by earlier builds are not re-fixed here; this
// suite pins the ones this build changed, plus guards that
// the canonical mechanics the copy rests on did not move
// (points-why canon byte-intact, sigai level substrings
// byte-intact, the pinned Standard Visit terms text kept).
// Copy clarity only: no math or label changes to ROAS / Halo /
// points mechanics, no new top-level tabs, no small counts.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8957;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = `/tmp/signl-verify-build51-${Date.now()}.json`;
const ADMIN_EMAIL = "admin@verify.local";
const ADMIN_PW = "build51-fixture-admin-pass";

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; failures.push(name + (detail ? " — " + detail : "")); console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const appJs = read("public/app.js");
const css = read("public/theme-v2.css");
const sigaiJs = read("netlify/functions/lib/sigai.js");
const routerJs = read("netlify/functions/lib/router.js");
const marketsJs = read("netlify/functions/lib/markets.js");
const buildJs = read("netlify/functions/lib/build.js");
const indexHtml = read("public/index.html");
const count = (src, needle) => src.split(needle).length - 1;

// ---------- stamp ----------
check("stamp: BUILD_ID is 2026.10.30-51", buildJs.includes('BUILD_ID = "2026.10.30-51"'));
check("stamp: index.html pins the -51 stamp in all four spots", count(indexHtml, "2026.10.30-51") === 4, String(count(indexHtml, "2026.10.30-51")));

// ---------- A-02 + X-08: the fake toggle ----------
check("A-02: no decorative switch pill remains in app.js", !appJs.includes('<span class="tg">') && !appJs.includes('<span class="tg off">'));
check("A-02: all three lane-explainer blocks use plain dots", count(appJs, '<span class="ldot"></span>') === 3 && count(appJs, '<span class="ldot off"></span>') === 3,
  `ldot=${count(appJs, '<span class="ldot"></span>')} off=${count(appJs, '<span class="ldot off"></span>')}`);
check("A-02: the .ldot style ships", css.includes(".ldot {") && css.includes(".ldot.off {"));
check("X-08: the false 'Headliners first in line' claim is gone from the claim forms", !appJs.includes("Headliners first in line"));
check("X-08: both claim forms state the universal paid lane, EN and ES",
  count(appJs, "separate bookings at your own rate. You keep 97%.") === 2 && count(appJs, "reservas aparte a tu tarifa. Te quedas con el 97%.") === 2);

// ---------- A-03: Sig introduced at first contact ----------
check("A-03: Fast Setup introduces Sig in plain words, both render sites, EN and ES",
  count(appJs, "Sig is SIGNL's built-in helper. Give Sig your Instagram handle") === 2 && count(appJs, "Sig es el asistente integrado de SIGNL.") === 2);

// ---------- A-05: the +1 queue sentence speaks and explains ----------
check("A-05: no Home queue line is attributed to Sig in the third person", !appJs.includes("Sig thinks you two"));
check("A-05: both Home +1 lines explain the pair mechanic in the same breath",
  count(appJs, "I think you two would make a strong +1 pair: visit together, and you each post your own post and story.") === 2);

// ---------- A-06: unexplained numbers get a sub-line; tier glossed ----------
check("A-06: snapshot cells can carry a plain-words sub-line", appJs.includes("snap-sub") && css.includes(".snap-sub {"));
check("A-06: live Home subs explain local reach and Momentum",
  appJs.includes('sub: "share of your audience living here"') && appJs.includes('sub: "points that move you up"'));
check("A-06: the tier gloss rides both Home identity surfaces",
  count(appJs, "size band, set automatically from your total audience across platforms") === 2,
  String(count(appJs, "size band, set automatically from your total audience across platforms")));

// ---------- A-07: unlaunched-market Offers empty state ----------
check("A-07: the offers empty line is market-state aware", appJs.includes("function offersEmptyLine()") && appJs.includes("state.user.founding.marketLive === false"));
check("A-07: an unlaunched market says nothing is being missed", appJs.includes("No offers until") && appJs.includes("has not launched yet, so there is nothing to miss"));
check("A-07: the open board renders the state-aware line", appJs.includes("ea ? eaLine : offersEmptyLine()"));

// ---------- A-09 + deferred: Profile scores and Self-reported ----------
check("A-09: Profile states both score scales", appJs.includes("Both scores run 0 to 100."));
check("A-09: Reliability's neutral starting point is stated", appJs.includes("Reliability starts at a neutral 50 before you have any visits"));
check("deferred: Profile glosses Self-reported in plain words", appJs.includes("self-reported means it is your own number, typed by you, not yet checked against Instagram"));
check("deferred: the public profile glosses Self-reported", appJs.includes("Self-reported: the creator's own number"));
check("deferred: the public proof sheet glosses self-reported", appJs.includes("self-reported: their own number"));

// ---------- A-10: book-me page / Local List / proof sheet glossed ----------
check("A-10: streets help glosses the book-me page and the Local List at first use",
  appJs.includes("the page businesses book you through") && appJs.includes("the public list of bookable creators in your market"));
check("A-10: the Spanish twin carries the same glosses", appJs.includes("la página donde los negocios te contratan") && appJs.includes("la lista pública de creadores contratables en tu mercado"));
check("A-10: the listing proof sheet is explained where the field is set", appJs.includes("The listing proof sheet is the one-page version of your record"));

// ---------- A-13: audience offers say whose deal it is ----------
check("A-13: creator audience sub says the deal is for followers, not a visit",
  appJs.includes("This is a deal for your followers, not a visit for you: you post the code, they get the perk."));
check("A-13: business audience sub keeps its pinned opener and says not-a-visit-booking",
  appJs.includes("Give their audience a reason to come in. This is a deal for a creator's followers, not a visit booking:"));

// ---------- A-14: no small counts in the Sig queue ----------
check("A-14: the fresh-creators line only prints a number at 10 or more", appJs.includes("sig.fresh >= 10"));
check("A-14: the named and unnamed small-count forms ship", appJs.includes("a creator finished their profile in") && appJs.includes("new creators finished profiles in"));
check("A-14: the unconditional small-count sentence is gone", !appJs.includes("${sig.fresh} creator${plural(sig.fresh)} finished profiles"));

// ---------- A-15: the PIN queue item explains the exchange ----------
check("A-15: the staff-PIN queue line explains the counter exchange",
  appJs.includes("the creator shows their visit code at your counter, your team enters it with this PIN, and that is what counts the visit"));

// ---------- A-16 + X-05: the receipt vocabulary, one term per sentence ----------
check("A-16: the dense fog sentence is gone", !appJs.includes("counted floor with its method beside it"));
check("X-05: counted is defined by the code at the register", appJs.includes("Counted means a customer showed the creator's code at your register"));
check("X-05: come-back and usual night are defined in the same breath",
  appJs.includes("A come-back is a customer who first came in on a code and returns within 30 days") && appJs.includes("Your usual night is the comparison line"));

// ---------- A-17: founding business vocabulary ----------
check("A-17: a play is defined where Sig first picks one", appJs.includes("A play is a ready-made offer pattern: the goal, the brief and the timing are preset"));
check("A-17: no category can render as 'a other business'", appJs.includes('bz.category !== "Other"') && appJs.includes('" for your business"'));
check("A-17: the told-us fog is gone from both counter panels", !appJs.includes("told-us counts ride") && count(appJs, "Those answers count on their own line of your receipt") === 2);
check("A-17: proof controls are glossed where the settings live", appJs.includes("the settings that decide what counts: your usual night, your comp costs, your register connection"));

// ---------- A-18: Jeff named; "natively" glossed ----------
check("A-18: Jeff is named as founder wherever he sends the payment step",
  count(appJs, "Jeff, SIGNL's founder, sends the payment step by hand") === 3,
  String(count(appJs, "Jeff, SIGNL's founder, sends the payment step by hand")));
check("A-18: no unexplained 'natively' remains on share surfaces",
  !appJs.includes("reshare natively") && !appJs.includes("share natively") && !appJs.includes("share a delivered post natively") && !marketsJs.includes("natively"));
check("A-18: deal-card can-lists say inside Instagram, client and server twins",
  count(appJs, "Share your post inside Instagram, with you tagged") === 2 && count(routerJs, "Share your post inside Instagram, with you tagged") === 2);
check("A-18: the canonical Standard Visit summary keeps its pinned terms text (glossed around it, not rewritten)",
  appJs.includes("share the post natively only, with the creator tagged"));
check("A-18: markets plan features say inside Instagram", marketsJs.includes("Share comp posts inside Instagram, creator tagged"));

// ---------- A-08 / X-08 / X-06: Sig Q&A accuracy ----------
check("X-08: the tiers answer separates the lanes correctly",
  appJs.includes("Paid bookings at your own rate are open to every tier; paid campaigns are a Headliners extra."));
check("A-08: points are no longer said to unlock badges in the Q&A", !appJs.includes("they unlock badges"));
check("A-08: the Q&A momentum answer carries the level benefit instead",
  appJs.includes("they also raise your level, and higher levels see new offers earlier"));
check("A-08: sigai canon drops the badges clause", !sigaiJs.includes("unlock badges"));
check("guard: sigai's -49-pinned level substrings stay byte-intact",
  sigaiJs.includes("Points also set the level: Starter, then Regular at 100 points, Standout at 300, Cornerstone at 750")
  && sigaiJs.includes("Regular sees new offers 12 hours early, Standout 18 hours early, and Cornerstone 24 hours early"));
check("X-06: the what-do-I-owe answer carries the 30-day keep-live term",
  appJs.includes("as the FTC requires. Keep the post live for at least 30 days."));
check("guard: the -49 points-why canon is untouched",
  appJs.includes("const POINTS_WHY_LONG") && appJs.includes("Points are priority. They move you up the list businesses choose from"));

// ---------- X-07: the founding badge carries both frames ----------
check("X-07: the founding badge states the credit and the first-month price in one breath",
  appJs.includes('class="founding-badge">FOUNDING: $100 CREDIT — FIRST MONTH $${fmtPrice(p.firstMonthPriceMonthly)}'));
check("X-07: the bare-price badge is gone", !appJs.includes('FOUNDING: FIRST MONTH $'));

// ---------- A-19: partner bench glossed ----------
check("A-19: the partner Home sub defines the bench in place",
  appJs.includes("your bench, your share: the creators and businesses who came in through your links, and the share they earn you"));
check("A-19: the unexplained partner sub is gone", !appJs.includes("Your markets, your bench, your share. Everything here came in through your links."));

// ---------- live: the stamp serves ----------
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ["ADMIN_" + "PASSWORD"]: ADMIN_PW, APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  startServer();
  check("live: dev server boots", await waitUp());
  const home = await fetch(BASE + "/");
  const homeText = await home.text();
  check("live: GET / serves the -51 stamp", home.status === 200 && homeText.includes("2026.10.30-51"));
  const boot = await (await fetch(BASE + "/api/bootstrap")).json();
  check("live: bootstrap reports 37 markets (X-01 app side stays data-driven)", boot && Array.isArray(boot.markets) && boot.markets.length === 37,
    JSON.stringify(boot && boot.markets && boot.markets.length));
} catch (e) {
  check("live block completed without exception", false, String(e && e.message || e));
} finally {
  await stopServer();
}

console.log(`\nverify-build51: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
