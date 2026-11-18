#!/usr/bin/env node
// Build -207 fixture suite: the ship-all bundle on top of navy -206.
// Pins: the -207 stamp; navy Maggie tiles preserved (Build -206's
// suite keeps its own checks — here only that the merge kept the
// navy folder + MAGGIE_CHAR); the H compaction leftovers from -203
// (partner editor cards, Biz Dev admin panels, Event Log labels);
// Charlottesville as an official market (roster, states, resolver,
// canonical name) and the flag-gated, Charlottesville-only refile
// pass that files stranded unlisted records through the app's own
// data path; the Learn sync's bounded-concurrency upserts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const marketsJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/markets.js"), "utf8");

console.log("== stamp -207 ==");
check("BUILD_ID is 2026.11.18-207", buildJs.includes('exports.BUILD_ID = "2026.11.18-207"'));
check("shell stamp is 2026.11.18-207 x5", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-207"') && (indexHtml.match(/2026\.11\.18-207/g) || []).length >= 5);

console.log("== navy -206 preserved through the merge ==");
check("MAGGIE_CHAR points at the navy tiles", appJs.includes('const MAGGIE_CHAR = "/assets/maggie-logo-navy";'));
check("all six navy tiles on disk", ["chirp", "cool", "curious", "greet", "hearts", "listen"].every((n) => fs.existsSync(path.join(ROOT, `public/assets/maggie-logo-navy/${n}.jpg`))));

console.log("== H leftovers: partner editor + Biz Dev caps + Event Log labels ==");
check("partner editor cards capped at 2 via the -203 kit", appJs.includes("const cards = uxCap203(cardsArr206, 2);"));
check("Biz Dev market panels capped at 3", appJs.includes("${uxCap203((d.markets || []).map((m) =>"));
check("Biz Dev commission per-rep rows capped at 6", appJs.includes("uxCap203((d.liability.perRep || []).map((r) =>"));
check("Biz Dev rep rows capped at 6", appJs.includes("uxCap203((d.reps || []).map((r) =>"));
check("Biz Dev rep-added leads waiting check capped at 6", appJs.includes("uxCap203(d.pendingLeads.map((l) =>"));
check("Biz Dev do-not-contact rows capped at 8", appJs.includes("uxCap203((d.dnc || []).map((r) =>"));
check("Event Log renders human-readable labels", appJs.includes("const EVENT_LABELS_206 = {") && appJs.includes("function eventTypeLabel206(t)") && appJs.includes('title="${esc(e.type)}">${esc(eventTypeLabel206(e.type))}'));
check("Event Log label map covers the common codes", ["user_signed_in", "booking_created", "claim_hook_view", "bdev_lead_added"].every((t) => appJs.includes(`${t}: "`)));

console.log("== Charlottesville market ==");
const { MARKETS, MARKET_STATES, resolveTypedCity } = require(path.join(ROOT, "netlify/functions/lib/markets.js"));
const { canonicalMarketName } = require(path.join(ROOT, "netlify/functions/lib/audience-markets.js"));
const cv = MARKETS.find((m) => m.id === "charlottesville");
check("roster is 48 markets", MARKETS.length === 48, String(MARKETS.length));
check("Charlottesville market record exists", !!cv && cv.name === "Charlottesville" && cv.label === "Charlottesville, Virginia" && cv.country === "United States");
check("Charlottesville city list carries the metro", !!cv && ["Charlottesville", "Crozet", "Keswick", "Palmyra", "Scottsville", "Ruckersville"].every((c) => cv.cities.includes(c)));
check("MARKET_STATES maps charlottesville to VA", JSON.stringify(MARKET_STATES.charlottesville) === JSON.stringify(["VA"]));
check("canonicalMarketName resolves Charlottesville", canonicalMarketName("Charlottesville") === "Charlottesville");
const r1 = resolveTypedCity("Charlottesville", { state: "Virginia", country: "United States" });
check("typed Charlottesville + VA hint resolves unique", r1.status === "unique" && r1.market === "Charlottesville", JSON.stringify(r1));
const r2 = resolveTypedCity("Charlottesville", {});
check("bare typed Charlottesville resolves unique", r2.status === "unique" && r2.market === "Charlottesville", JSON.stringify(r2));
const r3 = resolveTypedCity("Crozet", { state: "Virginia", country: "United States" });
check("typed Crozet + VA hint files into Charlottesville", r3.status === "unique" && r3.market === "Charlottesville", JSON.stringify(r3));

console.log("== Charlottesville refile pass (the app's own data path) ==");
check("refile pass exists and is flag-gated", routerJs.includes("async function maybeRefileCharlottesville207()") && routerJs.includes('const REFILE207_KEY = "config:refile207";') && routerJs.includes("const claim = await store.get(REFILE207_KEY);") && routerJs.includes("if (claim && claim.done) { refile207Done = true; return; }"));
check("refile pass claims before scanning and cannot race itself", routerJs.includes("let refile207InFlight = false;") && routerJs.includes('await store.set(REFILE207_KEY, { started: true, startedAt: nowIso() });'));
check("refile pass is narrowed to Charlottesville only", routerJs.includes('const REFILE207_MARKET = "Charlottesville";') && routerJs.includes('if (res.market !== REFILE207_MARKET) { diag.skippedOtherMarket += 1; continue; }'));
check("refile pass stamps the sweep's filing shape", routerJs.includes('target.marketResolvedFrom = "refile_loader207";') && routerJs.includes('via: "refile_loader207"'));
check("refile pass is invoked fire-and-forget in the preamble", routerJs.includes("await maybeRefileCharlottesville207(); } catch (e) { /* refile is best-effort off the request path */ }"));
check("refile diagnostic rides /api/verify/counts", routerJs.includes("refile207 = await store.get(REFILE207_DIAG_KEY)") && routerJs.includes("marketfix: marketfix173, refile207"));
check("refile pass is exported for suites", routerJs.includes("maybeRefileCharlottesville207,"));

console.log("== garbled handles: every render site gated (follow-up sweep) ==");
check("admin creator table name cell uses handleLabel", appJs.includes('${handleLabel(c.handle) ? `<div class="muted small">${esc(handleLabel(c.handle))}</div>` : ""}'));
check("no raw @${esc(c.handle/p.handle)} renders remain in app.js (creator + prospect surfaces)", !/@\$\{esc\((c|p)\.handle/.test(appJs), (appJs.match(/@\$\{esc\((c|p)\.handle/g) || []).join(","));
const profileMetaJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/profile-meta.js"), "utf8");
check("server public pages gate the handle through metaHandle", profileMetaJs.includes("function metaHandle(h)") && profileMetaJs.includes("META_HANDLE_SHAPE") && !profileMetaJs.includes("(@${profile.handle}) on Magpie"));

console.log("== Learn sync concurrency ==");
check("learn sync upserts run at bounded concurrency", routerJs.includes("await mapBounded202(entries, 12, async ([fileKey, m]) => {"));

console.log(`\nverify-build207: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
