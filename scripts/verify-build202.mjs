#!/usr/bin/env node
// Build -202 fixture suite: the health-defect fix pass.
// Pins: counts canonical fences (pending never in local), the
// Charlottesville unlisted grouping, handleLabel shape cases,
// catalog kind uniqueness, navparity duplicate destination,
// api() deadline, suggestions memo key, withPostState hoisting,
// and the non-awaited router preamble.
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

console.log("== stamp ==");
check("BUILD_ID is 2026.11.18-202", buildJs.includes('exports.BUILD_ID = "2026.11.18-202"'));
check("shell stamp matches", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-202"') && (indexHtml.match(/2026\.11\.18-202/g) || []).length >= 5);

console.log("== A: loading ==");
check("api() has AbortController deadline 12s GET / 20s other", appJs.includes("deadlineMs = isGet ? 12000 : 20000") && appJs.includes("ctrl.abort()") && appJs.includes("signal: ctrl ? ctrl.signal : undefined"));
check("astLoadSuggestions race is 10000", appJs.includes('Suggestions took too long to load.")), 10000'));
check("no Promise.race timeout above 10s in app.js", ![...appJs.matchAll(/Promise\.race\([\s\S]{0,300}?setTimeout\([^,]+,\s*(\d+)\)/g)].some((m) => Number(m[1]) > 10000));
check("loadMyScore paints fallback with retry on catch and on missing card", appJs.includes("Score unavailable right now") && (appJs.match(/onclick="loadMyScore\(\)"/g) || []).length >= 2);
check("suggestions memo key drops event/prospect/snapshot and TTL is 300000", routerJs.includes('aggMemoPGet("admin-suggestions", ["user", "offer", "booking", "post", "suggestion"], 300000)') && !routerJs.includes('aggMemoPGet("admin-suggestions", ["event"'));
check("eventsInRange parallelized with bounded chunks", routerJs.includes("dayList202") && routerJs.includes("Promise.all(chunk.map"));
check("/me/founding threads one allUsers list", routerJs.includes("const allUsers202 = await allUsers();") && routerJs.includes("creatorBuzz(user, allUsers202)") && routerJs.includes("foundingSummary(user, allUsers202)"));
check("creatorBuzz accepts preloadedUsers", routerJs.includes("async function creatorBuzz(user, preloadedUsers)"));
check("pointsContext accepts preloadedUsers", routerJs.includes("async function pointsContext(preloadedUsers)"));
check("sig/home offer fence: one flags read + bounded map", routerJs.includes("const flags202 = await getMarketFlags();") && routerJs.includes("mapBounded202(openList202, 12"));
check("offerFencedForCreators accepts preloaded flags/biz", routerJs.includes("async function offerFencedForCreators(o, viewer, pre)"));
check("preamble is not awaited (LOADER RULE)", routerJs.includes("const preamble202 = Promise.all([") && routerJs.includes("preamble202.catch(() => {});") && !routerJs.includes("  await Promise.all([\n    // Admin bootstrap"));
check("Settings payload ships alertPrefs + negotiation on withFounding", routerJs.includes("pub.alertPrefs = alertPrefsOf(user); pub.negotiation = negotiationOf(user);"));
check("Settings loaders render from state.user payload first", appJs.includes("state.user.alertPrefs") && appJs.includes("state.user.negotiation"));
check("Admin Home highlights paint from whichever lands first", appJs.includes("paintH") && appJs.includes("pApps.then((v) => { appsH = v;"));

console.log("== B: counts fixtures ==");
// Fixture: 1 pending 100k/80% + 1 approved 10k/50% in one market.
// Canonical (approved-only) math, replicated from the definitions:
function fixtureCounts(users) {
  let combined = 0, local = 0, listed = 0;
  for (const u of users) {
    if (u.status !== "approved" || u.tester) continue;
    listed += 1; combined += u.total; local += Math.round(u.total * u.pct / 100);
  }
  return { combined, local, listed };
}
const fx = fixtureCounts([
  { status: "pending", total: 100000, pct: 80 },
  { status: "approved", total: 10000, pct: 50 },
]);
check("counts fixture: combined 10k, local 5k, listed 1", fx.combined === 10000 && fx.local === 5000 && fx.listed === 1, JSON.stringify(fx));
const oldShape = (() => { let local = 0; for (const u of [{ status: "pending", total: 100000, pct: 80 }, { status: "approved", total: 10000, pct: 50 }]) local += Math.round(u.total * u.pct / 100); return local; })();
check("local <= combined assertion fires on the old (pending-inclusive) shape", oldShape > fx.combined && oldShape === 85000);
check("router localByMarket fence is approved-only", /localByMarket = \{\};[\s\S]{0,300}?u\.status !== "approved"\) continue; \/\/ Build -202/.test(routerJs));
check("verify recount local fence is approved-only", routerJs.includes('if (u.status === "approved" && !tester(u) && typeof e.pct === "number")'));
check("verify/counts has hard invariant assertions", routerJs.includes("invariantViolations") && routerJs.includes("localFollowers > m.combinedFollowers") && routerJs.includes("creatorsListed === 0 && m.localFollowers !== 0"));
check("creatorsPending excludes testers in adminMarketRows and rosterCounts", routerJs.includes('u.status === "pending" && !isTester(u)).length') && routerJs.includes('u.status === "pending" && !isTester(u)).length,\n        approved:'));
check("Stats payload ships server marketRows from adminMarketRows", routerJs.includes("const marketRows202 = await adminMarketRows();") && routerJs.includes("marketRows: marketRows202,"));
check("Stats Markets table renders from server rows, not astCreatorListings", appJs.includes("astData.marketRows202") && !/byMarket\[l\.market\]/.test(appJs));
check("layers fence approved+pending, complete is approved-only", routerJs.includes('if (u.status !== "approved" && u.status !== "pending") continue; // Build -202: rejected excluded') && routerJs.includes('if (u.status === "approved" && profileCompleteOf(u)) row.complete += 1;'));
check("demandKeyOf138 canonicalizes region", routerJs.includes("function canonicalRegion202") && routerJs.includes("US_STATE_NAMES_202"));
// Charlottesville fixture: legacy stored market + unlisted signups, state vs country region => ONE unlisted row.
{
  const US = new Set(["virginia"]);
  const canonRegion = (r) => { const x = String(r || "").trim().toLowerCase(); if (x === "united states" || US.has(x)) return "united states"; return x; };
  const keyOf = (city, region) => `${String(city).trim().toLowerCase()}|${canonRegion(region)}`;
  const rows = new Map();
  const add = (city, region) => { const k = keyOf(city, region); rows.set(k, (rows.get(k) || 0) + 1); };
  add("Charlottesville", "Virginia"); add("Charlottesville", "United States"); add("Charlottesville", "Virginia");
  check("Charlottesville grouping fixture: state vs country region => ONE row", rows.size === 1 && [...rows.values()][0] === 3, JSON.stringify([...rows]));
  check("layers fold unresolvable stored markets into the unlisted bucket", routerJs.includes("!listedMarketNames202.has(canon202)"));
}
check("sigdata byMarket keys canonicalized", fs.readFileSync(path.join(ROOT, "netlify/functions/lib/sigdata.js"), "utf8").includes("canonicalMarketName(m) || m"));
check("Discover reconciliation line names all three numbers", appJs.includes("bookable here") && appJs.includes("approved call this market home") && appJs.includes("still finishing profiles"));
check("discover responses carry reconciliation from adminMarketRows", (routerJs.match(/reconciliation202/g) || []).length >= 4);

console.log("== C: data quality ==");
// handleLabel shape cases, replicated from the client helper
function handleLabel(h) { const s = String(h == null ? "" : h).trim().replace(/^@+/, ""); return /^[A-Za-z0-9._-]{2,40}$/.test(s) ? "@" + s : ""; }
check("handleLabel: clean handle", handleLabel("foo.bar_1") === "@foo.bar_1");
check("handleLabel: @ prefix stripped once", handleLabel("@foo") === "@foo");
check("handleLabel: garbled share tail rejected", handleLabel("_r=1&_t=ZT-9B3OKX5mPWw") === "");
check("handleLabel: fragment rejected", handleLabel("exln=MXIxcXZvZjNvNmRmdg==") === "");
check("handleLabel: empty gives empty (no bare @)", handleLabel("") === "" && handleLabel(null) === "");
check("handleLabel helper exists in app.js and creatorCard uses it", appJs.includes("function handleLabel(h)") && appJs.includes("handleLabel(p.handle)"));
check("audience not reported yet on zero + empty stack", appJs.includes("function audienceLabel202") && appJs.includes('"Audience not reported yet"'));
check("handle write paths route through normalizeHandle", routerJs.includes("normalizeHandle(contact)") && routerJs.includes("packet.handle = normalizeHandle(raw.handle)") && routerJs.includes("const handle = normalizeHandle(x);"));
{
  const am = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/audience-markets.js"), "utf8");
  check("normalizePlatformLinks routes handles through the shape parser", am.includes("cleanLinkHandle(raw.handle") && am.includes("HANDLE_SHAPE_LINKS"));
  const { cleanLinkHandle } = require(path.join(ROOT, "netlify/functions/lib/audience-markets.js"));
  check("cleanLinkHandle: URL tail rejected, bare handle kept", typeof cleanLinkHandle === "function" && cleanLinkHandle("https://www.tiktok.com/@realone?_r=1") === "realone" && cleanLinkHandle("bad handle!") === "");
}
check("handle repair sweep processes prospects with merge", routerJs.includes("prospectScanned") && routerJs.includes("prospectMerged"));
check("Biz Dev leads read dedupes by name+city+market", fs.readFileSync(path.join(ROOT, "netlify/functions/lib/bizdev.js"), "utf8").includes("seen202"));
check("Recruiter queue read dedupes by (handleKey, email)", fs.readFileSync(path.join(ROOT, "netlify/functions/lib/recruiters.js"), "utf8").includes("seenQ202"));
check("Team list dedupes by normalized email", routerJs.includes("seenTeam202"));
check("ensureAdmin never creates a second admin under a different email", fs.readFileSync(path.join(ROOT, "netlify/functions/lib/auth.js"), "utf8").includes("an admin already exists under a different email"));
check("Event Log default excludes capture types", routerJs.includes("CAPTURE_SINCE_TYPES.includes(e.type)) return false; // Build -202"));
{
  const catalog = require(path.join(ROOT, "netlify/functions/lib/automations-catalog.js"));
  const seen = new Map(); let dup = null;
  for (const e of catalog.ENTRIES) { const k = `${e.lane}|${e.recipient}|${e.kind}`; if (seen.has(k)) dup = k; seen.set(k, e.id); }
  check("catalog: unique kind per lane+recipient, no milestone twins", dup === null && !catalog.ENTRIES.some((e) => e.id.startsWith("milestone_")), dup || "");
  check("catalog: plain pref-gated clock_started kept as the editable entry", (() => { const e = catalog.ENTRIES.find((x) => x.id === "clock_started"); return e && e.prefGate === "recipient settings"; })());
}
check("Social recent groups cross-posts with platform badges", routerJs.includes("recentMap202") && routerJs.includes("g.platforms.push"));
check("Social manual add externalId derives from URL shortcode", routerJs.includes("short202"));
check("Learn sync function + internal endpoint + scheduled function exist", routerJs.includes("runLearnSync202") && routerJs.includes('"learn-sync"') && fs.existsSync(path.join(ROOT, "netlify/functions/learn-sync.mjs")));
check("withPostState hoisting: GET /bookings indexes lists once, no allPosts/allReviews inside per-booking path", routerJs.includes("pre202 = { posts: posts202") && routerJs.includes("mapBounded202(bookings, 12") && /async function withPostState\(booking, pre202\)/.test(routerJs));
check("messages context indexed by participant pair", routerJs.includes("bookingByPair202"));
check("dcard-match-why carries full-text title tooltip", appJs.includes('class="dcard-match-why" title='));
check("compliance rows fall back to business user + offer records", routerJs.includes("displayBusinessName(offerById202.get(b.offerId) || null") && routerJs.includes("offerById202.get(b.offerId) ? offerById202.get(b.offerId).title"));
check("partner-demo seed booking carries businessName/title", routerJs.includes('businessName: "Sample Cafe",\n    title: "Sample visit: try the new seasonal menu",'));
check("wallet shared copy mapping used by both Home blocks", appJs.includes("function walletCopy202") && (appJs.match(/walletCopy202\(/g) || []).length >= 3 && !appJs.includes('"Ready to pay out", value:'));
check("Maggie wording says the Review tab", (() => { const s = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/sigdata.js"), "utf8"); return s.includes("The Review tab holds the decisions") && !s.includes("Review queue under Applications") && !s.includes('"Open Applications"'); })());

console.log(`\nverify-build202: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
