// End-to-end verification of admin applicant visibility (Jeff,
// 2026-10-21). Approval is no longer the quality gate (the quick
// claim holds a founding spot with almost nothing on file; profile
// completion is the gate), so the admin applications view must
// show Jeff the right things at a glance:
//   - each queue row's Details carry the signup source
//     (signupSource, from ?src=) and the referral origin
//     (referredBy, from ?ref=) when the record has them, and
//     nothing when it does not;
//   - a summary strip counts, per launch market plus All:
//     Pending / Approved / Approved + profile complete, computed
//     server-side from the records. An approved quick claim counts
//     in Approved but NOT in Approved + profile complete; testers
//     and businesses never count.
// Run: node scripts/verify-admin.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8951;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";
const DB = path.join(os.tmpdir(), `signl-verify-admin-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`);
  }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (v) jar.set(k, v); else jar.delete(k);
      }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data };
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + "/api/bootstrap");
      if (res.ok) return true;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: {
    ...process.env,
    SIGNL_LOCAL: "1",
    SIGNL_LOCAL_DB: DB,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    APP_URL: BASE,
    SIGNL_TEST_ALLOW_BUSINESS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

async function quickClaim(handle, market, extra = {}) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", quickClaim: true,
    email: `${handle}@example.com`, password: "<MASKED_SECRET_002>",
    market, handle, ...AGREE, ...extra,
  });
  if (reg.status !== 201) throw new Error(`quick claim ${handle} failed: ${JSON.stringify(reg.data)}`);
  return { client: c, id: reg.data.user.id, user: reg.data.user };
}

async function fullSignup(handle, market, city) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name: `Full ${handle}`, email: `${handle}@example.com`, password: "<MASKED_SECRET_002>",
    market, city, handle,
    followerCount: 4200, localAudiencePct: 61, categories: ["Food & Drink"],
    ...AGREE,
  });
  if (reg.status !== 201) throw new Error(`full signup ${handle} failed: ${JSON.stringify(reg.data)}`);
  return { client: c, id: reg.data.user.id, user: reg.data.user };
}

try {
  check("dev server comes up", await waitForServer());

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login 200", adminLogin.status === 200, String(adminLogin.status));
  const approve = async (id) => {
    const r = await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
    if (r.status !== 200) throw new Error(`approve ${id} failed: ${JSON.stringify(r.data)}`);
  };

  // ---------- seed the roster ----------
  // Hampton Roads: 2 pending (one with source + referrer, one plain),
  // 1 approved quick claim (profile incomplete), 1 approved full
  // signup (profile complete), 1 approved business (never counted).
  const refd = await quickClaim("admrefd", "Hampton Roads", { signupSource: "moms", referredBy: "admsponsor" });
  const plain = await quickClaim("admplain", "Hampton Roads");
  const hrInc = await quickClaim("admhrinc", "Hampton Roads");
  await approve(hrInc.id);
  const hrFull = await fullSignup("admhrfull", "Hampton Roads", "Norfolk");
  await approve(hrFull.id);
  // Richmond: 1 approved full signup (complete).
  const ricFull = await fullSignup("admricfull", "Richmond", "Richmond");
  await approve(ricFull.id);
  // Raleigh: 1 pending quick claim.
  await quickClaim("admral", "Raleigh");
  // Washington DC: 1 approved complete creator, then moved to Tester.
  const dc = await fullSignup("admdc", "Washington DC", "Washington DC");
  await approve(dc.id);
  const testerRes = await admin("POST", "/api/admin/tester", { userId: dc.id, tester: true });
  check("admin can mark the DC creator as tester", testerRes.status === 200 && testerRes.data.user.tester === true, JSON.stringify(testerRes.data).slice(0, 160));
  // A business in Hampton Roads, approved: must not enter any count.
  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", businessName: "Adm Testaurant", email: "admbiz@example.com",
    password: "<MASKED_SECRET_003>", market: "Hampton Roads", city: "Virginia Beach", category: "Restaurant", planId: "growth",
    agreedTerms: true,
  });
  check("business registers (201)", bizReg.status === 201, JSON.stringify(bizReg.data).slice(0, 160));
  await approve(bizReg.data.user.id);

  // ---------- admin payload: row-level source + referrer ----------
  const apps = await admin("GET", "/api/admin/applications");
  check("admin applications returns a summary object", !!apps.data.summary && Array.isArray(apps.data.summary.markets), JSON.stringify(Object.keys(apps.data || {})));
  const rows = [...((apps.data && apps.data.pending) || []), ...((apps.data && apps.data.decided) || [])];
  const refdRow = rows.find((r) => r.id === refd.id);
  check("row payload carries the stored signupSource", !!refdRow && refdRow.signupSource === "moms", JSON.stringify(refdRow && refdRow.signupSource));
  check("row payload carries the stored referral origin", !!refdRow && refdRow.referredBy === "admsponsor", JSON.stringify(refdRow && refdRow.referredBy));
  const plainRow = rows.find((r) => r.id === plain.id);
  check("row payload omits signupSource when the record has none", !!plainRow && plainRow.signupSource === undefined, JSON.stringify(plainRow && Object.keys(plainRow)));
  check("row payload omits referredBy when the record has none", !!plainRow && plainRow.referredBy === undefined, JSON.stringify(plainRow && plainRow.referredBy));
  const hrIncRow = rows.find((r) => r.id === hrInc.id);
  check("approved quick claim sits in decided as approved", !!hrIncRow && hrIncRow.status === "approved", JSON.stringify(hrIncRow && hrIncRow.status));

  // ---------- summary strip counts ----------
  const s = apps.data.summary || { markets: [], all: {} };
  const byMarket = Object.fromEntries((s.markets || []).map((m) => [m.market, m]));
  check("summary covers exactly the four launch markets", s.markets.length === 4 && ["Hampton Roads", "Richmond", "Raleigh", "Washington DC"].every((n) => !!byMarket[n]), JSON.stringify((s.markets || []).map((m) => m.market)));
  check("Raleigh row is labeled Raleigh/The Triangle", !!byMarket["Raleigh"] && byMarket["Raleigh"].label === "Raleigh/The Triangle", JSON.stringify(byMarket["Raleigh"]));
  const hr = byMarket["Hampton Roads"] || {};
  check("HR counts: 2 pending, 2 approved, 1 approved + complete (business excluded)", hr.pending === 2 && hr.approved === 2 && hr.approvedComplete === 1, JSON.stringify(hr));
  const ric = byMarket["Richmond"] || {};
  check("Richmond counts: 0 pending, 1 approved, 1 approved + complete", ric.pending === 0 && ric.approved === 1 && ric.approvedComplete === 1, JSON.stringify(ric));
  const ral = byMarket["Raleigh"] || {};
  check("Raleigh counts: 1 pending, 0 approved, 0 approved + complete", ral.pending === 1 && ral.approved === 0 && ral.approvedComplete === 0, JSON.stringify(ral));
  const dcRow = byMarket["Washington DC"] || {};
  check("DC counts: tester excluded, so 0 pending, 0 approved, 0 approved + complete", dcRow.pending === 0 && dcRow.approved === 0 && dcRow.approvedComplete === 0, JSON.stringify(dcRow));
  check("All row: 3 pending, 3 approved, 2 approved + complete", s.all.pending === 3 && s.all.approved === 3 && s.all.approvedComplete === 2, JSON.stringify(s.all));

  // ---------- static client wiring ----------
  const appJs = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public", "app.js"), "utf8");
  check("queue row Details render the Via referral label", appJs.includes("Via referral: @${esc(u.referredBy)}"));
  check("queue row Details render the Source label", appJs.includes("Source: ${esc(u.signupSource)}"));
  check("applications view renders the roster counts strip", appJs.includes("Founding roster counts") && appJs.includes("Approved + profile complete") && appJs.includes("summaryStrip"));
  check("strip copy names the launch number without em dashes", appJs.includes("Approved + profile complete is the launch number") && !appJs.includes("launch number: only those creators show up for businesses. —"));
} finally {
  server.kill("SIGKILL");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nverify-admin: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
