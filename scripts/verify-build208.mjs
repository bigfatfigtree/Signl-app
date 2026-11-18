#!/usr/bin/env node
// Build -208 fixture suite: the -202 review follow-up fixes.
// Pins, on the REAL code paths (fixture server, not replicas):
//   D1 — Admin Social cross-post grouping fires on the real
//        lib/social-seed.json texts (IG "Link in bio" vs FB raw
//        URL). The -202 check passed on synthetic identical texts;
//        this suite reads the shipped seed through the live
//        /admin/social payload, so it cannot pass that way again.
//   D2 — the Find creators reconciliation line renders on the
//        ADMIN PREVIEW discover surface too: the payload carries
//        data.reconciliation and public/app.js consumes it into
//        #pv-discover-count with the same line the real path
//        renders at #discover-count.
//   D5 — suggestion candidates say Review, never Applications.
//   §6a — layers first column is "All sign-ups" with the basis
//        note; what is counted does not change.
//   Charlottesville — layers and the outside-listed panel use the
//        SAME region label (state preferred) from one helper.
//   D3 — the stray QA artifact files from merge a47ad95 are gone.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const seedPosts = JSON.parse(fs.readFileSync(path.join(ROOT, "netlify/functions/lib/social-seed.json"), "utf8")).posts;

console.log("== stamp ==");
check("BUILD_ID is 2026.11.18-209 (shipping stamp; build -208 content)", buildJs.includes('exports.BUILD_ID = "2026.11.18-209"'));
check("shell stamp matches", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-209"') && (indexHtml.match(/2026\.11\.18-209/g) || []).length >= 5);

console.log("== D3: stray QA artifacts removed ==");
for (const p of [".qa136-audit", ".qa136-run", ".qa138", ".qa139", ".qa140", ".qamatch", ".vtmp", "scripts/qa-audit136.py", "scripts/qa-build136.py", "scripts/qa-build136b.py"]) {
  check(`removed from tree: ${p}`, !fs.existsSync(path.join(ROOT, p)));
}

console.log("== D2 (static): preview renders the reconciliation line ==");
check("previewDiscoverHtml carries a count element", appJs.includes('id="pv-discover-count"'));
{
  const start = appJs.indexOf("async function runPreviewDiscover()");
  const seg = appJs.slice(start, start + 4000);
  check("runPreviewDiscover consumes data.reconciliation", seg.includes("data.reconciliation") && seg.includes("pv-discover-count"), seg.slice(0, 200));
  check("preview line format matches the real path's line", seg.includes("bookable here") && seg.includes("approved call this market home") && seg.includes("still finishing profiles") && seg.includes("finished and bookable-ready at home"));
}
check("real path still renders its line at #discover-count", appJs.includes('getElementById("discover-count")') && appJs.includes("state.discoverReconciliation202 = data.reconciliation || null"));

console.log("== D5: suggestions say Review ==");
check("no suggestion text says 'sit in Applications'", !routerJs.includes("They sit in Applications."));
check("no suggestion action is labelled 'Open Applications'", !routerJs.includes('label: "Open Applications"'));
check("waiting candidates say 'They sit in Review.' with an Open Review door", routerJs.includes("They sit in Review.") && routerJs.includes('label: "Open Review", route: "applications"'));

console.log("== §6a: layers basis is unmistakable ==");
check("layers first column renamed to All sign-ups", appJs.includes("<th>All sign-ups</th>") && appJs.includes('data-label="All sign-ups"'));
check("layers panel carries the basis note", appJs.includes("All sign-ups counts every creator record in the row") && appJs.includes("matches the Approved column here"));
check("layers counting itself unchanged (creators increments for every non-tester creator record)", routerJs.includes("row.creators += 1;"));

console.log("== Charlottesville (static): one shared display helper ==");
check("shared helper exists and prefers the state name", routerJs.includes("function unlistedDisplayByKey208") && routerJs.includes("function unlistedDisplayPlace208") && routerJs.includes("US_STATE_NAMES_202.has(st.toLowerCase())"));
check("stats layers + outside panel + board + aggregates all read the shared helper", (routerJs.match(/unlistedDisplayByKey208\(/g) || []).length >= 3 && (routerJs.match(/unlistedDisp208\.get\(/g) || []).length >= 4);

// ---------- live fixture server ----------
const DB = fs.mkdtempSync("/tmp/signl-build208-") + "/db.json";
const SEED_PW = "verify-build208-pass";
const SEED_SALT = "verifybuild208salt";
const SEED_HASH = crypto.scryptSync(SEED_PW, SEED_SALT, 64).toString("hex");
function creatorSeed(id, email, name, handle, market, opts = {}) {
  return {
    id, role: "creator", email, name, passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: opts.status || "approved", market, city: opts.city || market, state: opts.state, country: opts.country,
    createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", tester: false,
    creator: { handle, platform: "Instagram", handleNormalized: handle, city: opts.city || market, state: opts.state || "VA", categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", audienceStack: { instagram: opts.total || 9000 }, totalAudience: opts.total || 9000, followerCount: opts.total || 9000, localAudiencePct: opts.localPct == null ? 75 : opts.localPct, paidRate: 150, compOpen: true, couponOpen: true, profileComplete: true, publicPage: true, bio: `${name}, daily.` },
  };
}
{
  const seed = {};
  seed["config:recruiterKitEmailV1Sent"] = { version: 1, claimedAt: "2026-10-20T00:00:00.000Z", completedAt: "2026-10-20T00:00:00.000Z", recipients: [] };
  const put = (u) => { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; };
  // Virginia Beach: 3 approved, complete, bookable at home.
  put(creatorSeed("crvb1", "vb1@fixtures.dev", "VB One", "vbone", "Virginia Beach", { total: 12000, localPct: 80 }));
  put(creatorSeed("crvb2", "vb2@fixtures.dev", "VB Two", "vbtwo", "Virginia Beach", { total: 9000, localPct: 70 }));
  put(creatorSeed("crvb3", "vb3@fixtures.dev", "VB Three", "vbthree", "Virginia Beach", { total: 6000, localPct: 60 }));
  // Charlottesville: 1 legacy stored-market record (country only),
  // 2 unlisted sign-ups (one state-only, one country-only).
  put(creatorSeed("crcvlegacy", "cvlegacy@fixtures.dev", "CV Legacy", "cvlegacy", "Charlottesville", { city: "Charlottesville", country: "United States" }));
  put(creatorSeed("crcvstate", "cvstate@fixtures.dev", "CV State", "cvstate", "Not listed yet", { city: "Charlottesville", state: "Virginia" }));
  put(creatorSeed("crcvcountry", "cvcountry@fixtures.dev", "CV Country", "cvcountry", "Not listed yet", { city: "Charlottesville", country: "United States" }));
  // One pending creator so the waiting suggestion fires (D5 live).
  put(creatorSeed("crpend208", "pend208@fixtures.dev", "Pending 208", "pending208", "Virginia Beach", { status: "pending" }));
  fs.writeFileSync(DB, JSON.stringify(seed));
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
const PORT = 8971;
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
  check("fixture server boots", await waitUp(base));
  const admin = client();
  const ra = await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "verify-admin-pass-123" }, base);
  check("admin signed in", ra.status === 200, JSON.stringify(ra.data).slice(0, 160));

  console.log("== D1 (live): grouping fires on the REAL seed texts ==");
  const soc = await admin("GET", "/api/admin/social", undefined, base);
  check("social payload answers 200", soc.status === 200, String(soc.status));
  const recent = (soc.data && soc.data.recent) || [];
  const igTotal = seedPosts.filter((p) => p.platform === "instagram" && p.status !== "queued").length;
  const fbTotal = seedPosts.filter((p) => p.platform === "facebook" && p.status !== "queued").length;
  const grouped = recent.filter((r) => (r.platforms || []).length > 1);
  // Same-timestamp pairs in the shipped seed are the cross-posts.
  const byTs = {};
  for (const p of seedPosts) { if (p.status === "queued") continue; (byTs[p.postedAt] = byTs[p.postedAt] || new Set()).add(p.platform); }
  const pairCount = Object.values(byTs).filter((s) => s.size > 1).length;
  check(`every real cross-post pair groups into one row (${pairCount} pairs)`, grouped.length === pairCount, `grouped=${grouped.length} recent=${recent.length}`);
  check("recent rows = posts - grouped pairs", recent.length === (igTotal + fbTotal) - pairCount, `recent=${recent.length} ig=${igTotal} fb=${fbTotal}`);
  check("every grouped row carries both platform badges", grouped.every((r) => r.platforms.includes("instagram") && r.platforms.includes("facebook")), JSON.stringify(grouped.map((r) => r.platforms)));
  check("grouped rows keep both per-platform records", grouped.every((r) => (r.groupedPosts || []).length === r.platforms.length));
  const chIg = ((soc.data && soc.data.channels) || []).find((c) => c.platform === "instagram") || {};
  const chFb = ((soc.data && soc.data.channels) || []).find((c) => c.platform === "facebook") || {};
  check("channel totals unchanged by grouping", !!chIg.totals && chIg.totals.posts === igTotal && !!chFb.totals && chFb.totals.posts === fbTotal, JSON.stringify({ ig: chIg.totals, fb: chFb.totals }));

  console.log("== D2 (live): preview payload carries the reconciliation ==");
  const pv = await admin("GET", "/api/admin/preview/discover?market=" + encodeURIComponent("Virginia Beach"), undefined, base);
  check("preview discover answers 200", pv.status === 200, String(pv.status));
  const rc = (pv.data && pv.data.reconciliation) || null;
  check("reconciliation: 3 bookable, 3 approved home, 3 complete, 0 finishing", !!rc && rc.bookable === 3 && rc.approvedHome === 3 && rc.approvedComplete === 3 && rc.finishing === 0, JSON.stringify(rc));
  check("preview cards = bookable count", !!pv.data && (pv.data.creators || []).length === 3, `cards=${pv.data && (pv.data.creators || []).length}`);

  console.log("== D5 (live): the waiting suggestion says Review ==");
  const sug = await admin("GET", "/api/admin/suggestions", undefined, base);
  const wait = ((sug.data && sug.data.suggestions) || []).find((s) => s.id === "waiting:creators");
  check("waiting suggestion present", !!wait, JSON.stringify(((sug.data || {}).suggestions || []).map((s) => s.id)));
  check("waiting text says 'They sit in Review.'", !!wait && /They sit in Review\./.test(wait.text), wait && wait.text);
  check("waiting door is labelled Open Review", !!wait && !!wait.action && wait.action.label === "Open Review", JSON.stringify(wait && wait.action));

  console.log("== Charlottesville + layers (live payload) ==");
  const st = await admin("GET", "/api/admin/stats", undefined, base);
  check("stats answers 200", st.status === 200, String(st.status));
  const layerRows = ((st.data && st.data.layers && st.data.layers.markets) || []);
  const cvRows = layerRows.filter((r) => /Charlottesville/.test(r.market || ""));
  check("Charlottesville appears exactly once in layers", cvRows.length === 1, JSON.stringify(layerRows.map((r) => r.market)));
  check("layers label uses the state name", cvRows.length === 1 && cvRows[0].market === "Charlottesville, Virginia", cvRows.length && cvRows[0].market);
  check("layers counts all 3 records, 3 approved, 3 finished", cvRows.length === 1 && cvRows[0].creators === 3 && cvRows[0].approved === 3 && cvRows[0].complete === 3, JSON.stringify(cvRows[0] || {}));
  const outside = (st.data && st.data.unlistedByCity) || [];
  const cvOut = outside.filter((r) => /Charlottesville/.test(r.place || ""));
  check("outside panel: one Charlottesville row with the SAME label", cvOut.length === 1 && cvOut[0].place === "Charlottesville, Virginia" && cvOut[0].creators === 2, JSON.stringify(cvOut));
} finally {
  server.kill("SIGTERM");
}
console.log(`\nverify-build208: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
