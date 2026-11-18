#!/usr/bin/env node
// Build -209 fixture suite: D1-R — Admin Social grouped cross-post
// rows must RENDER both platform names, not just carry them in the
// payload. Build -208 grouped the payload (platforms: [...],
// groupedPosts) but postRow headed every row with the lead post's
// singular p.platform, so the -208 suite passed on payload checks
// while Jeff still saw one platform per row. This suite therefore
// exercises the CLIENT RENDERER itself: it extracts the shipped
// loadAdminSocial138() from public/app.js, runs it in a VM against
// (a) the live /admin/social payload from the fixture server and
// (b) synthetic grouped payloads, and asserts the RENDERED row
// headings. A payload-only pass cannot ship this again.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const LABEL = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };
const headingOf = (p) => [...new Set((p.platforms && p.platforms.length ? p.platforms : [p.platform]).filter(Boolean))].map((pl) => LABEL[pl] || pl).join(" + ");

console.log("== stamp ==");
check("BUILD_ID is 2026.11.18-212", buildJs.includes('exports.BUILD_ID = "2026.11.18-212"'));
check("shell stamp matches", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-212"') && (indexHtml.match(/2026\.11\.18-212/g) || []).length >= 5);

console.log("== D1-R (static): the renderer reads p.platforms ==");
const socStart = appJs.indexOf("async function loadAdminSocial138()");
const socEnd = appJs.indexOf("async function a138SoDraft()");
const socSlice = socStart >= 0 && socEnd > socStart ? appJs.slice(socStart, socEnd) : "";
check("loadAdminSocial138 slice found", socSlice.length > 2000, `len=${socSlice.length}`);
check("postRow heading is built from p.platforms, joined with ' + '", socSlice.includes("p.platforms") && socSlice.includes('.join(" + ")') && socSlice.includes("platLabel209(p)"));
check("no renderer in the Social surface still heads a post row with the singular p.platform label", !socSlice.includes("label[p.platform]"));
check("postRow is the single row renderer for both the queue and Recent posts", (socSlice.match(/\.map\(postRow\)/g) || []).length === 2);

// ---------- live fixture server: the real grouped payload ----------
const DB = fs.mkdtempSync("/tmp/signl-build209-") + "/db.json";
const SEED_PW = "verify-build209-pass";
const SEED_SALT = "verifybuild209salt";
const SEED_HASH = crypto.scryptSync(SEED_PW, SEED_SALT, 64).toString("hex");
{
  const seed = {};
  seed["config:recruiterKitEmailV1Sent"] = { version: 1, claimedAt: "2026-10-20T00:00:00.000Z", completedAt: "2026-10-20T00:00:00.000Z", recipients: [] };
  const u = {
    id: "cr209", role: "creator", email: "one@fixtures.dev", name: "Fixture One", passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: "approved", market: "Virginia Beach", city: "Virginia Beach", createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", tester: false,
    creator: { handle: "fixtureone", platform: "Instagram", handleNormalized: "fixtureone", city: "Virginia Beach", state: "VA", categories: ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals", audienceStack: { instagram: 9000 }, totalAudience: 9000, followerCount: 9000, localAudiencePct: 75, paidRate: 150, compOpen: true, couponOpen: true, profileComplete: true, publicPage: true, bio: "Fixture." },
  };
  seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id };
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
const PORT = 8973;
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

// ---------- the renderer harness: shipped code, stubbed edges ----------
const el = { innerHTML: "" };
const sandbox = {
  console,
  __payload: null,
  document: { getElementById: (id) => (id === "tab-body" ? el : null) },
  api: async () => sandbox.__payload,
  esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  fmtFull: (n) => Number(n || 0).toLocaleString("en-US"),
  a138When: (t) => String(t || ""),
  a138Err: (target, e) => { target.innerHTML = "ERROR: " + (e && e.message); },
};
let renderSocial = null;
try {
  vm.createContext(sandbox);
  vm.runInContext(socSlice + "\nthis.__load209 = loadAdminSocial138;", sandbox);
  renderSocial = async (payload) => {
    sandbox.__payload = payload;
    el.innerHTML = "";
    await sandbox.__load209();
    return el.innerHTML;
  };
} catch (e) {
  check("renderer slice loads in the harness", false, String(e && e.message));
}
const rowHeadings = (html) => html.split('<div class="a138-row">').slice(1).map((seg) => { const m = seg.match(/<strong>([^<]*)<\/strong>/); return m ? m[1] : null; });

try {
  check("fixture server boots", await waitUp(base));
  const admin = client();
  const ra = await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: "verify-admin-pass-123" }, base);
  check("admin signed in", ra.status === 200, JSON.stringify(ra.data).slice(0, 160));

  console.log("== D1-R (live payload): grouped rows exist to render ==");
  const soc = await admin("GET", "/api/admin/social", undefined, base);
  check("social payload answers 200", soc.status === 200, String(soc.status));
  const payload = soc.data || {};
  const recent = payload.recent || [];
  const queued = payload.queued || [];
  const grouped = recent.filter((r) => (r.platforms || []).length > 1);
  check("payload carries grouped cross-post rows", grouped.length >= 1, `grouped=${grouped.length} recent=${recent.length}`);

  console.log("== D1-R (RENDERED): headings name every platform on the row ==");
  check("renderer harness is live", typeof renderSocial === "function");
  if (renderSocial) {
    const html = await renderSocial(payload);
    const headings = rowHeadings(html);
    const expected = [...queued, ...recent].map(headingOf);
    check("rendered row count = queued + recent rows", headings.length === expected.length, `rendered=${headings.length} expected=${expected.length}`);
    check("every rendered heading matches its row's platforms, in payload order", headings.length === expected.length && headings.every((h, i) => h === expected[i]), JSON.stringify({ headings, expected }).slice(0, 400));
    check("every grouped row's rendered heading names BOTH platforms", grouped.length >= 1 && grouped.every((r) => { const h = headings[[...queued, ...recent].indexOf(r)]; return h && h.includes("Instagram") && h.includes("Facebook") && h.includes(" + "); }), JSON.stringify(headings).slice(0, 300));
    check("single-platform rows keep the single label (no ' + ')", recent.filter((r) => (r.platforms || []).length <= 1).every((r) => { const h = headings[[...queued, ...recent].indexOf(r)]; return h === headingOf(r) && !h.includes("+"); }));

    console.log("== D1-R (RENDERED, synthetic): order, singles, legacy rows ==");
    const post = (over) => ({ platform: "instagram", postedAt: "2026-10-26T12:02:36-04:00", text: "A cross-post.", url: null, metrics: { likes: 1, comments: 2, shares: 3 }, ...over });
    const synth = {
      channels: [], queued: [], drafts: [], canDraft: false, canApprove: false,
      recent: [
        post({ platforms: ["facebook", "instagram"], groupedPosts: [post({ platform: "facebook" }), post({})] }),
        post({ platform: "facebook", platforms: ["facebook"] }),
        post({ platform: "linkedin" }),
      ],
    };
    const sHead = rowHeadings(await renderSocial(synth));
    check("payload order is honoured: [facebook, instagram] renders 'Facebook + Instagram'", sHead[0] === "Facebook + Instagram", JSON.stringify(sHead));
    check("single-platform row renders the single label only", sHead[1] === "Facebook", JSON.stringify(sHead));
    check("a row with no platforms list falls back to its own platform label", sHead[2] === "LinkedIn", JSON.stringify(sHead));
    const qHead = rowHeadings(await renderSocial({ channels: [], recent: [], drafts: [], canDraft: false, canApprove: false, queued: [post({ platform: "instagram", postedAt: null, status: "queued" })] }));
    check("queued rows (no platforms list) still render their single label", qHead.length === 1 && qHead[0] === "Instagram", JSON.stringify(qHead));
  }
} finally {
  server.kill("SIGTERM");
}
console.log(`\nverify-build209: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
