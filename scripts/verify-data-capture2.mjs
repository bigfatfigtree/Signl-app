// Data captures round 2 verification (Build -145; Data Audit
// 2026-11-07 items 5-7 + loss-map sweep + Admin Data view +
// Suggestions panel).
//
// Boots the fixture server with the Maggie AI flag OFF and
// proves, reading the local store file back:
//   5. the daily snapshot record (snapshot:{yyyy-mm-dd}) with
//      market x category cuts, idempotent per day, forceable;
//   6. audience_updated on a profile save with from/to on the
//      stack and per-platform local %, and NO event when a save
//      changes no audience field;
//   7. pageview:{day}:{userId} counters on /c/* (public page
//      and the claim tier);
//   8. the swept loss-map item profile_view (in-app book-me
//      views by someone other than the creator);
//   9. /admin/stats/data (matrix, funnel, backlog, reliability,
//      capture health), the raw exports, and the Suggestions
//      panel API: gap/waiting/backlog/search suggestions,
//      dismiss persistence, and resurfacing when the underlying
//      numbers materially change.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = fs.mkdtempSync("/tmp/signl-capture2-") + "/db.json";
const SEED_PW = "verify-capture2-pass";
const SEED_SALT = "verifycapture2salt";
const SEED_HASH = crypto.scryptSync(SEED_PW, SEED_SALT, 64).toString("hex");
const TODAY = new Date().toISOString().slice(0, 10);
const NOW_ISO = new Date().toISOString();
function creatorSeed(id, email, name, handle, market, opts = {}) {
  const cats = opts.categories || ["Food & Drink"];
  return {
    id, role: "creator", email, name, passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: opts.status || "approved", market, city: opts.city || market, state: opts.state || "TN", createdAt: opts.createdAt || "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", tester: false,
    creator: { handle, platform: "Instagram", handleNormalized: handle, city: opts.city || market, state: opts.state || "TN", categories: cats, compCategories: ["Restaurant meals"], tierBand: "Locals", audienceStack: { instagram: opts.total || 9000 }, totalAudience: opts.total || 9000, followerCount: opts.total || 9000, localAudiencePct: opts.localPct || 75, paidRate: 150, compOpen: true, couponOpen: true, profileComplete: opts.complete !== false, publicPage: true, bio: `${name}, daily.` },
  };
}
{
  const seed = {};
  seed["config:markets"] = { flags: { Nashville: true, Austin: true } };
  seed["user:bizactive"] = { id: "bizactive", role: "business", email: "active@fixtures.dev", name: "Active Owner", passwordHash: SEED_HASH, passwordSalt: SEED_SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", tester: false, businessOnboarded: true, business: { businessName: "Active Kitchen", legalName: "Active Kitchen LLC", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Seeded active business." } };
  seed["user:bizpending"] = { id: "bizpending", role: "business", email: "pending@fixtures.dev", name: "Pending Owner", passwordHash: SEED_HASH, passwordSalt: SEED_SALT, status: "pending", market: "Nashville", city: "Nashville", createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z", tester: false, business: { businessName: "Pending Tacos", category: "Restaurant" } };
  seed["email:active@fixtures.dev"] = { userId: "bizactive" };
  seed["email:pending@fixtures.dev"] = { userId: "bizpending" };
  seed["user:crnash1"] = creatorSeed("crnash1", "nash1@fixtures.dev", "Nash Food One", "nashfoodone", "Nashville", { localPct: 88, total: 12000 });
  seed["user:crnash2"] = creatorSeed("crnash2", "nash2@fixtures.dev", "Nash Eats Two", "nashfoodtwo", "Nashville", { localPct: 70, total: 9000 });
  seed["user:craustin"] = creatorSeed("craustin", "austin@fixtures.dev", "Austin Tunes", "austintunes", "Austin", { categories: ["Music"], localPct: 85, total: 8000 });
  seed["user:crpending1"] = creatorSeed("crpending1", "pend1@fixtures.dev", "Pending One", "pendingone", "Nashville", { status: "pending", createdAt: "2026-11-05T00:00:00.000Z" });
  seed["user:crpending2"] = creatorSeed("crpending2", "pend2@fixtures.dev", "Pending Two", "pendingtwo", "Nashville", { status: "pending", createdAt: "2026-11-06T00:00:00.000Z" });
  for (const [id, email] of [["crnash1", "nash1@fixtures.dev"], ["crnash2", "nash2@fixtures.dev"], ["craustin", "austin@fixtures.dev"], ["crpending1", "pend1@fixtures.dev"], ["crpending2", "pend2@fixtures.dev"]]) seed[`email:${email}`] = { userId: id };
  // Six creators from an unlisted city (the typed-city backlog):
  // five ordinary sign-ups plus one claimed-but-unfinished page.
  for (let i = 1; i <= 5; i++) {
    const id = `crclark${i}`;
    seed[`user:${id}`] = creatorSeed(id, `clark${i}@fixtures.dev`, `Clarksville ${i}`, `clarksville${i}`, "Not listed yet", { city: "Clarksville", complete: false, total: 1200 });
    seed[`email:clark${i}@fixtures.dev`] = { userId: id };
  }
  seed["user:crclaim"] = creatorSeed("crclaim", "claim@fixtures.dev", "Clarksville Claim", "clarkclaim", "Not listed yet", { city: "Clarksville", complete: false, total: 640 });
  // Genuinely unfinished under the computed completeness rules:
  // no local % reported yet, so the finished-profile gates stay
  // shut and /c/clarkclaim serves the claim tier.
  seed["user:crclaim"].creator.localAudiencePct = null;
  seed["email:claim@fixtures.dev"] = { userId: "crclaim" };
  seed["offer:offer1"] = { id: "offer1", businessId: "bizactive", market: "Nashville", category: "Restaurant", kind: "paid", cashRate: 200, title: "Taco Tuesday launch", status: "open", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
  seed["offer:offeraustin"] = { id: "offeraustin", businessId: "bizactive", market: "Austin", category: "Restaurant", kind: "paid", cashRate: 200, title: "Austin opening night", status: "open", createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" };
  seed["booking:bk1"] = { id: "bk1", offerId: "offer1", businessId: "bizactive", creatorId: "crnash1", market: "Nashville", status: "completed", createdAt: "2026-10-05T00:00:00.000Z", redeemedAt: "2026-10-06T00:00:00.000Z" };
  seed["booking:bk2"] = { id: "bk2", offerId: "offer1", businessId: "bizactive", creatorId: "crnash1", market: "Nashville", status: "completed", createdAt: "2026-10-07T00:00:00.000Z", redeemedAt: "2026-10-08T00:00:00.000Z" };
  seed["post:p1"] = { id: "p1", bookingId: "bk1", creatorId: "crnash1", url: "https://instagram.com/p/one", submittedAt: "2026-10-06T12:00:00.000Z", onTime: true };
  seed["post:p2"] = { id: "p2", bookingId: "bk2", creatorId: "crnash1", url: "https://instagram.com/p/two", submittedAt: "2026-10-09T12:00:00.000Z", onTime: false };
  seed["favorite:bizactive:crnash2"] = { createdAt: NOW_ISO };
  seed["cityrequest:req1"] = { city: "Franklin", region: "TN", handle: "franklinfoodie", createdAt: "2026-11-01T00:00:00.000Z" };
  fs.writeFileSync(DB, JSON.stringify(seed));
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok -", name);
  else { failures++; console.log("  FAIL -", name, extra || ""); }
}
function readDb() { return JSON.parse(fs.readFileSync(DB, "utf8")); }
function readEvents(type) {
  const db = readDb();
  return Object.entries(db)
    .filter(([k, v]) => k.startsWith("event:") && v && v.type === type)
    .map(([, v]) => v)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
}
function client() {
  const jar = new Map();
  return async (method, p, body, base) => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of sc) { const pair = line.split(";")[0]; const i = pair.indexOf("="); if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); } }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  };
}
async function waitUp(base) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base + "/api/bootstrap"); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

const PORT = 8957;
const base = `http://127.0.0.1:${PORT}`;
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: ROOT,
  env: {
    ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL: "jeff@joinsignl.com", ADMIN_PASSWORD: "verify-admin-pass-123", APP_URL: base, SIGNL_TEST_ALLOW_BUSINESS: "1",
    SIG_AI_BASE_URL: "", SIG_AI_API_KEY: "", OPENAI_API_KEY: "", OPENAI_BASE_URL: "", OPENROUTER_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "",
    MAGGIE_AI_ENABLED: "", MAGGIE_AI_MODEL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  check("fixture server boots (AI off)", await waitUp(base));
  const admin = client();
  const ra = await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "verify-admin-pass-123" }, base);
  check("admin signed in", ra.status === 200);
  const biz = client();
  const rb = await biz("POST", "/api/auth/login", { email: "active@fixtures.dev", password: SEED_PW }, base);
  check("business signed in", rb.status === 200, JSON.stringify(rb.data).slice(0, 160));
  const creator = client();
  const rc = await creator("POST", "/api/auth/login", { email: "nash1@fixtures.dev", password: SEED_PW }, base);
  check("creator signed in", rc.status === 200);

  // ---------- 5. Daily snapshot ----------
  console.log("== item 5: daily snapshot ==");
  const sweep1 = await admin("POST", "/api/admin/snapshot/sweep", {}, base);
  check("snapshot sweep endpoint answers ok", sweep1.status === 200 && sweep1.data.ok === true, JSON.stringify(sweep1.data).slice(0, 200));
  const snap = readDb()[`snapshot:${TODAY}`];
  check("snapshot record written for today", !!snap && snap.date === TODAY, JSON.stringify(Object.keys(readDb()).filter((k) => k.startsWith("snapshot:"))));
  check("snapshot totals: 9 approved / 8 complete creators (all but the unfinished claim), 2 bookings, 1 on-time post", !!snap && snap.totals.creators.approved === 9 && snap.totals.creators.complete === 8 && snap.totals.bookings.total === 2 && snap.totals.posts.onTime === 1, JSON.stringify(snap && snap.totals));
  check("snapshot matrix: Nashville Food & Drink supply 2 / demand 1", !!snap && snap.matrix.Nashville && snap.matrix.Nashville["Food & Drink"] && snap.matrix.Nashville["Food & Drink"].supply === 2 && snap.matrix.Nashville["Food & Drink"].demand === 1, JSON.stringify(snap && snap.matrix && snap.matrix.Nashville));
  check("snapshot matrix: Austin Food & Drink demand 1 with supply 0 (the gap cell)", !!snap && snap.matrix.Austin && snap.matrix.Austin["Food & Drink"] && snap.matrix.Austin["Food & Drink"].demand === 1 && snap.matrix.Austin["Food & Drink"].supply === 0, JSON.stringify(snap && snap.matrix && snap.matrix.Austin));
  check("snapshot matrix: Austin Music supply 1", !!snap && snap.matrix.Austin && snap.matrix.Austin.Music && snap.matrix.Austin.Music.supply === 1, JSON.stringify(snap && snap.matrix && snap.matrix.Austin));
  check("snapshot carries the typed-city backlog (Clarksville, 6)", !!snap && (snap.unlistedByCity || []).some((r) => /Clarksville/.test(r.place) && r.creators === 6), JSON.stringify(snap && snap.unlistedByCity));
  const sweep2 = await admin("POST", "/api/admin/snapshot/sweep", {}, base);
  check("same-day re-run is a no-op (append-only, never overwritten)", sweep2.status === 200 && sweep2.data.sweep && sweep2.data.sweep.wrote === false, JSON.stringify(sweep2.data).slice(0, 200));
  const sweep3 = await admin("POST", "/api/admin/snapshot/sweep", { force: true }, base);
  check("forced re-run rewrites today's record", sweep3.status === 200 && sweep3.data.sweep && sweep3.data.sweep.wrote === true, JSON.stringify(sweep3.data).slice(0, 200));

  // ---------- 7. Pageview counters ----------
  console.log("== item 7: pageview counters ==");
  const pv1 = await fetch(base + "/c/nashfoodone");
  check("public creator page serves 200", pv1.status === 200, String(pv1.status));
  const pv2 = await fetch(base + "/c/nashfoodone");
  check("public creator page serves 200 again", pv2.status === 200);
  const pvRec = readDb()[`pageview:${TODAY}:crnash1`];
  check("pageview counter for the public page incremented to 2", !!pvRec && pvRec.views === 2 && (pvRec.claimViews || 0) === 0, JSON.stringify(pvRec));
  const pv3 = await fetch(base + "/c/clarkclaim");
  check("claim-tier page serves 200", pv3.status === 200, String(pv3.status));
  const pvClaim = readDb()[`pageview:${TODAY}:crclaim`];
  check("claim-tier view counted in the same daily record (claimViews 1)", !!pvClaim && pvClaim.views === 1 && pvClaim.claimViews === 1, JSON.stringify(pvClaim));

  // ---------- 8 (sweep). In-app profile views ----------
  console.log("== item 8 sweep: profile_view ==");
  const view = await biz("GET", "/api/c/nashfoodtwo", undefined, base);
  check("business book-me read answers 200", view.status === 200, JSON.stringify(view.data).slice(0, 120));
  const pvs = readEvents("profile_view");
  check("profile_view logged once: business -> creator, via bookme", pvs.length === 1 && pvs[0].actorId === "bizactive" && pvs[0].subjectId === "crnash2" && pvs[0].data.via === "bookme", JSON.stringify(pvs).slice(0, 240));
  await creator("GET", "/api/c/nashfoodone", undefined, base);
  check("a creator's own page view logs nothing", readEvents("profile_view").length === 1, `saw ${readEvents("profile_view").length}`);

  // ---------- 6. audience_updated ----------
  console.log("== item 6: audience_updated ==");
  const patch = await creator("PATCH", "/api/me/profile", { audienceStack: { instagram: 15000, tiktok: 2000 }, platformLocalPct: { instagram: 55 } }, base);
  check("profile save with audience changes answers 200", patch.status === 200, JSON.stringify(patch.data).slice(0, 200));
  const aud = readEvents("audience_updated").filter((e) => e.subjectId === "crnash1");
  check("exactly one audience_updated for the save", aud.length === 1, `saw ${aud.length}`);
  const a0 = aud[0] || { data: {} };
  check("audience_updated source is profile_save", a0.data.source === "profile_save", JSON.stringify(a0.data).slice(0, 200));
  check("stack from/to ride the event (instagram 12000->15000, tiktok 0->2000)", !!a0.data.changes && !!a0.data.changes.stack && a0.data.changes.stack.instagram && a0.data.changes.stack.instagram.from === 12000 && a0.data.changes.stack.instagram.to === 15000 && a0.data.changes.stack.tiktok && a0.data.changes.stack.tiktok.to === 2000, JSON.stringify(a0.data.changes));
  check("the full new stack + total ride the event", a0.data.stack && a0.data.stack.instagram === 15000 && a0.data.stack.tiktok === 2000 && a0.data.totalAudience === 17000, JSON.stringify(a0.data.stack));
  check("per-platform local % from/to rides the event (instagram -> 55)", !!a0.data.changes && !!a0.data.changes.platformLocalPct && !!a0.data.changes.platformLocalPct.instagram && a0.data.changes.platformLocalPct.instagram.to === 55, JSON.stringify(a0.data.changes && a0.data.changes.platformLocalPct));
  const patch2 = await creator("PATCH", "/api/me/profile", { bio: "A brand new bio line." }, base);
  check("profile save with no audience change answers 200", patch2.status === 200, JSON.stringify(patch2.data).slice(0, 160));
  check("no second audience_updated when nothing audience-shaped moved", readEvents("audience_updated").filter((e) => e.subjectId === "crnash1").length === 1, `saw ${readEvents("audience_updated").length}`);

  // ---------- Funnel feedstock: zero-result searches ----------
  console.log("== funnel feedstock: zero-result searches ==");
  for (let i = 0; i < 3; i++) await biz("GET", "/api/discover?market=Austin&category=" + encodeURIComponent("Underwater Basket Weaving"), undefined, base);
  const zs = readEvents("discover_search").filter((e) => e.data && e.data.zeroResults);
  check("three zero-result searches captured", zs.length === 3, `saw ${zs.length}`);

  // ---------- 9. Admin Data view payload ----------
  console.log("== item 9: /admin/stats/data ==");
  const dv = await admin("GET", "/api/admin/stats/data?days=30", undefined, base);
  check("data view answers 200", dv.status === 200, JSON.stringify(dv.data).slice(0, 160));
  const dd = dv.data || {};
  check("data matrix: Austin Food & Drink demand 1 / supply 0", !!dd.matrix && !!dd.matrix.Austin && dd.matrix.Austin["Food & Drink"] && dd.matrix.Austin["Food & Drink"].demand === 1 && dd.matrix.Austin["Food & Drink"].supply === 0, JSON.stringify(dd.matrix && dd.matrix.Austin));
  check("funnel carries all 8 stages", Array.isArray(dd.funnel && dd.funnel.stages) && dd.funnel.stages.length === 8, JSON.stringify((dd.funnel || {}).stages || []).slice(0, 200));
  check("funnel searches stage counts the captured zero-result searches", !!dd.funnel && (dd.funnel.stages.find((s) => s.key === "searches") || {}).n >= 3, JSON.stringify((dd.funnel || {}).stages));
  check("funnel zero-result gaps name Austin / Underwater Basket Weaving x3", !!dd.funnel && (dd.funnel.zeroResultGaps || []).some((g) => g.market === "Austin" && g.count === 3), JSON.stringify(dd.funnel && dd.funnel.zeroResultGaps));
  check("funnel capturing-since is dated (searches began today)", !!dd.funnel && !!dd.funnel.capturingSince && dd.funnel.capturingSince.searches === TODAY, JSON.stringify(dd.funnel && dd.funnel.capturingSince));
  check("backlog carries the seeded city request (Franklin)", !!dd.backlog && (dd.backlog.cityRequests || []).some((r) => r.city === "Franklin"), JSON.stringify(dd.backlog && dd.backlog.cityRequests));
  check("reliability: crnash1's 1-of-2 on-time lands in the 50-79% band", !!dd.reliability && dd.reliability.byOnTime["50-79%"] >= 1 && dd.reliability.byDeliveries["1-2"] >= 1, JSON.stringify(dd.reliability));
  const audCap = (dd.health && dd.health.captures || []).find((c) => c.type === "audience_updated");
  check("capture health: audience_updated counted in range, since today", !!audCap && audCap.inRange >= 1 && audCap.since === TODAY, JSON.stringify(audCap));
  check("snapshot trend includes today", (dd.snapshots || []).some((s) => s.date === TODAY), JSON.stringify(dd.snapshots));

  // ---------- 9b. Exports ----------
  console.log("== item 9: exports ==");
  const expJson = await admin("GET", "/api/admin/stats/data/export?dataset=audience_updates&format=json", undefined, base);
  const expRows = Array.isArray(expJson.data) ? expJson.data : [];
  check("audience_updates JSON export returns the captured event", expJson.status === 200 && expRows.length >= 1 && expRows[0].type === "audience_updated" && expRows[0].data && expRows[0].data.source === "profile_save", JSON.stringify(expJson.data).slice(0, 240));
  const expCsv = await admin("GET", "/api/admin/stats/data/export?dataset=creators&format=csv", undefined, base);
  const csvText = (expCsv.data && expCsv.data.raw) || "";
  check("creators CSV export lists the seeded creators", expCsv.status === 200 && csvText.includes("austintunes") && csvText.includes("nashfoodone"), csvText.slice(0, 200));
  check("creators CSV export carries NO password material", !csvText.includes("passwordHash") && !csvText.includes(SEED_HASH), "credential leak in export");
  const expSnap = await admin("GET", "/api/admin/stats/data/export?dataset=snapshots&format=json", undefined, base);
  check("snapshots JSON export returns today's snapshot", expSnap.status === 200 && Array.isArray(expSnap.data) && expSnap.data.some((s) => s.date === TODAY), JSON.stringify(expSnap.data).slice(0, 160));
  const exp404 = await admin("GET", "/api/admin/stats/data/export?dataset=nope&format=csv", undefined, base);
  check("unknown dataset 404s", exp404.status === 404, String(exp404.status));

  // ---------- Addendum 2. Suggestions ----------
  console.log("== addendum 2: suggestions ==");
  const sug = await admin("GET", "/api/admin/suggestions", undefined, base);
  check("suggestions answer 200, template text with AI off (phrased false)", sug.status === 200 && sug.data.phrased === false, JSON.stringify(sug.data).slice(0, 200));
  const ids = (sug.data.suggestions || []).map((s) => s.id);
  check("gap suggestion present: Austin Food & Drink", ids.includes("gap:Austin:Food & Drink"), ids.join(" | "));
  check("waiting suggestion present: creators", ids.includes("waiting:creators"), ids.join(" | "));
  check("backlog suggestion present: Clarksville", ids.some((i) => i.startsWith("city:Clarksville")), ids.join(" | "));
  check("funnel-leak suggestion present: the zero-result Austin searches", ids.some((i) => i.startsWith("search:Austin:")), ids.join(" | "));
  const gapSug = (sug.data.suggestions || []).find((s) => s.id === "gap:Austin:Food & Drink") || {};
  check("gap suggestion carries its receipt (supply 0, demand 1)", !!gapSug.receipt && gapSug.receipt.supply === 0 && gapSug.receipt.demand === 1, JSON.stringify(gapSug));
  const dis1 = await admin("POST", "/api/admin/suggestions/dismiss", { id: "gap:Austin:Food & Drink" }, base);
  check("dismiss answers ok", dis1.status === 200 && dis1.data.ok === true, JSON.stringify(dis1.data).slice(0, 120));
  const sug2 = await admin("GET", "/api/admin/suggestions", undefined, base);
  const ids2 = (sug2.data.suggestions || []).map((s) => s.id);
  check("dismissed gap suggestion stays dismissed", !ids2.includes("gap:Austin:Food & Drink") && ids2.includes("waiting:creators"), ids2.join(" | "));
  const dis2 = await admin("POST", "/api/admin/suggestions/dismiss", { id: "waiting:creators" }, base);
  check("dismiss waiting answers ok", dis2.status === 200 && dis2.data.ok === true);
  const sug3 = await admin("GET", "/api/admin/suggestions", undefined, base);
  check("dismissed waiting suggestion stays dismissed", !(sug3.data.suggestions || []).some((s) => s.id === "waiting:creators"), JSON.stringify(sug3.data.suggestions || []).slice(0, 200));
  const approve = await admin("POST", "/api/admin/review", { userId: "crpending1", decision: "approve" }, base);
  check("admin approves one pending creator (the numbers move)", approve.status === 200, JSON.stringify(approve.data).slice(0, 160));
  const sug4 = await admin("GET", "/api/admin/suggestions", undefined, base);
  const waitBack = (sug4.data.suggestions || []).find((s) => s.id === "waiting:creators");
  check("waiting suggestion resurfaces once its numbers changed (count 1)", !!waitBack && waitBack.receipt && waitBack.receipt.count === 1, JSON.stringify(sug4.data.suggestions || []).slice(0, 300));
  check("both dismissals were logged as suggestion_dismissed events", readEvents("suggestion_dismissed").length === 2, `saw ${readEvents("suggestion_dismissed").length}`);
} finally {
  server.kill("SIGTERM");
}

console.log(failures === 0 ? "verify-data-capture2: ALL PASS" : `verify-data-capture2: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
