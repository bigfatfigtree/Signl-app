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
    email: `${handle}@fixtures.dev`, password: "<MASKED_SECRET_002>",
    market, handle, ...AGREE, ...extra,
  });
  if (reg.status !== 201) throw new Error(`quick claim ${handle} failed: ${JSON.stringify(reg.data)}`);
  return { client: c, id: reg.data.user.id, user: reg.data.user };
}

async function fullSignup(handle, market, city) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name: `Full ${handle}`, email: `${handle}@fixtures.dev`, password: "<MASKED_SECRET_002>",
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
    role: "business", name: "Biz Owner", businessName: "Adm Testaurant", email: "admbiz@fixtures.dev",
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
  check("summary covers exactly the four launch markets", s.markets.length === 4 && ["Virginia Beach", "Richmond", "Raleigh", "Washington DC"].every((n) => !!byMarket[n]), JSON.stringify((s.markets || []).map((m) => m.market)));
  check("Raleigh row is labeled Raleigh/The Triangle", !!byMarket["Raleigh"] && byMarket["Raleigh"].label === "Raleigh/The Triangle", JSON.stringify(byMarket["Raleigh"]));
  const hr = byMarket["Virginia Beach"] || {};
  check("Virginia Beach counts (fixtures claimed under the legacy Hampton Roads name): 2 pending, 2 approved, 1 approved + complete (business excluded)", hr.pending === 2 && hr.approved === 2 && hr.approvedComplete === 1, JSON.stringify(hr));
  const ric = byMarket["Richmond"] || {};
  check("Richmond counts: 0 pending, 1 approved, 1 approved + complete", ric.pending === 0 && ric.approved === 1 && ric.approvedComplete === 1, JSON.stringify(ric));
  const ral = byMarket["Raleigh"] || {};
  check("Raleigh counts: 1 pending, 0 approved, 0 approved + complete", ral.pending === 1 && ral.approved === 0 && ral.approvedComplete === 0, JSON.stringify(ral));
  const dcRow = byMarket["Washington DC"] || {};
  check("DC counts: tester excluded, so 0 pending, 0 approved, 0 approved + complete", dcRow.pending === 0 && dcRow.approved === 0 && dcRow.approvedComplete === 0, JSON.stringify(dcRow));
  check("All row: 3 pending, 3 approved, 2 approved + complete", s.all.pending === 3 && s.all.approved === 3 && s.all.approvedComplete === 2, JSON.stringify(s.all));

  // ---------- tester toggles + offer close (dead-button fix, 2026-10-24) ----------
  // The Admin "Move to Tester" and My Offers "Close offer" buttons
  // shipped dead in the live app: both handlers gated on the native
  // confirm() dialog as their first statement and returned silently
  // when it never surfaced. These checks pin the full path the
  // buttons drive (route, event, Stats count, close semantics) plus
  // the served-bundle wiring below.
  const statsTesters = async () => {
    const r = await admin("GET", "/api/admin/stats");
    return r.data && r.data.users ? r.data.users.testers : null;
  };
  const eventCount = async (type) => {
    const r = await admin("GET", `/api/admin/events?type=${encodeURIComponent(type)}&limit=2000`);
    return (r.data.events || []).length;
  };
  check("stats tester count starts at 1 (the DC creator)", (await statsTesters()) === 1, String(await statsTesters()));
  const markCreator = await admin("POST", "/api/admin/tester", { userId: hrFull.id, tester: true });
  check("mark creator tester: 200, flag set, creator_marked_tester event fires, stats count moves to 2",
    markCreator.status === 200 && markCreator.data.user.tester === true && (await eventCount("creator_marked_tester")) >= 2 && (await statsTesters()) === 2,
    `${markCreator.status} testers=${await statsTesters()}`);
  const unmarkCreator = await admin("POST", "/api/admin/tester", { userId: hrFull.id, tester: false });
  check("unmark creator tester: flag clears, creator_unmarked_tester event fires, stats count back to 1",
    unmarkCreator.status === 200 && unmarkCreator.data.user.tester === false && (await eventCount("creator_unmarked_tester")) === 1 && (await statsTesters()) === 1,
    `${unmarkCreator.status} testers=${await statsTesters()}`);
  const markBiz = await admin("POST", "/api/admin/tester", { userId: bizReg.data.user.id, tester: true });
  check("mark business tester: 200, flag set, business_marked_tester event fires, stats count moves to 2",
    markBiz.status === 200 && markBiz.data.user.tester === true && (await eventCount("business_marked_tester")) === 1 && (await statsTesters()) === 2,
    `${markBiz.status} ${JSON.stringify(markBiz.data).slice(0, 160)} testers=${await statsTesters()}`);
  const unmarkBiz = await admin("POST", "/api/admin/tester", { userId: bizReg.data.user.id, tester: false });
  check("unmark business tester: flag clears, business_unmarked_tester event fires, stats count back to 1",
    unmarkBiz.status === 200 && unmarkBiz.data.user.tester === false && (await eventCount("business_unmarked_tester")) === 1 && (await statsTesters()) === 1,
    `${unmarkBiz.status} testers=${await statsTesters()}`);
  await admin("POST", "/api/admin/businesses/activate", { userId: bizReg.data.user.id });
  const closeFixture = await biz("POST", "/api/offers", { title: "Close me fixture", whatComped: "Dinner for two", dollarCap: 60, spots: 1 });
  check("close fixture offer opens", closeFixture.status === 201 && closeFixture.data.offer.status === "open", `${closeFixture.status} ${JSON.stringify(closeFixture.data).slice(0, 160)}`);
  const close1 = await biz("POST", `/api/offers/${closeFixture.data.offer.id}/close`, {});
  check("close offer: 200 and the offer reads closed", close1.status === 200 && close1.data.offer.status === "closed", `${close1.status} ${JSON.stringify(close1.data).slice(0, 160)}`);
  const close2 = await biz("POST", `/api/offers/${closeFixture.data.offer.id}/close`, {});
  check("second close is a clean 409 error, not a silent no-op", close2.status === 409 && /already closed/.test(close2.data.error || ""), `${close2.status} ${JSON.stringify(close2.data).slice(0, 160)}`);

  // ---------- clickable Requests cards + required social link (Jeff, 2026-10-26) ----------
  // Jeff, from his phone, on the pending card: "I need to be able
  // to see the profile and click on it and they should have to
  // link instagram so I can verify their page." Pins:
  //   - the applications payload carries a computed primary
  //     profile URL for every creator row, so the card's handle
  //     renders as a real link to the creator's actual page;
  //   - a pasted profile LINK normalizes to the clean handle at
  //     intake (Instagram and TikTok forms), so the stored record
  //     links correctly;
  //   - an application with no primary handle is refused by the
  //     server (the client refuses too; static checks below);
  //   - GET /admin/creators/:id serves the full business-shaped
  //     profile for a PENDING applicant (the public /c/ page
  //     cannot), admin only.
  const urlForm = client();
  const urlFormReg = await urlForm("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "admurlform@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", handle: "https://www.instagram.com/admurlform/", ...AGREE,
  });
  check("quick claim accepts a pasted Instagram profile link (201)", urlFormReg.status === 201, `${urlFormReg.status} ${JSON.stringify(urlFormReg.data).slice(0, 160)}`);
  const tokForm = client();
  const tokFormReg = await tokForm("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "admtokform@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", handle: "https://www.tiktok.com/@admtokform", primaryPlatform: "tiktok", ...AGREE,
  });
  check("quick claim accepts a pasted TikTok profile link (201)", tokFormReg.status === 201, `${tokFormReg.status} ${JSON.stringify(tokFormReg.data).slice(0, 160)}`);

  const apps2 = await admin("GET", "/api/admin/applications");
  const rows2 = [...((apps2.data && apps2.data.pending) || []), ...((apps2.data && apps2.data.decided) || [])];
  const urlRow = rows2.find((r) => r.id === (urlFormReg.data.user || {}).id);
  check("URL-form claim stores the clean handle", !!urlRow && !!urlRow.creator && urlRow.creator.handle === "admurlform", JSON.stringify(urlRow && urlRow.creator && urlRow.creator.handle));
  check("applications payload carries the computed Instagram profile URL", !!urlRow && !!urlRow.creator && urlRow.creator.primaryProfileUrl === "https://instagram.com/admurlform" && urlRow.creator.instagramUrl === "https://instagram.com/admurlform", JSON.stringify(urlRow && urlRow.creator && { p: urlRow.creator.primaryProfileUrl, ig: urlRow.creator.instagramUrl }));
  const tokRow = rows2.find((r) => r.id === (tokFormReg.data.user || {}).id);
  check("TikTok URL-form claim stores the clean handle + TikTok profile URL", !!tokRow && !!tokRow.creator && tokRow.creator.handle === "admtokform" && tokRow.creator.primaryProfileUrl === "https://www.tiktok.com/@admtokform", JSON.stringify(tokRow && tokRow.creator && { h: tokRow.creator.handle, p: tokRow.creator.primaryProfileUrl }));
  const plainRow2 = rows2.find((r) => r.id === plain.id);
  check("plain claim row also carries its profile URL", !!plainRow2 && !!plainRow2.creator && plainRow2.creator.primaryProfileUrl === "https://instagram.com/admplain", JSON.stringify(plainRow2 && plainRow2.creator && plainRow2.creator.primaryProfileUrl));

  const noHandle = client();
  const noHandleRes = await noHandle("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "admnohandle@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", handle: "", ...AGREE,
  });
  check("quick claim with an empty handle is refused (400, handle required)", noHandleRes.status === 400 && /handle is required/.test(noHandleRes.data.error || ""), `${noHandleRes.status} ${JSON.stringify(noHandleRes.data).slice(0, 160)}`);
  const atOnlyRes = await noHandle("POST", "/api/auth/register", {
    role: "creator", quickClaim: true, email: "admatonly@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", handle: " @ ", ...AGREE,
  });
  check("quick claim with only an @ is refused (400)", atOnlyRes.status === 400, `${atOnlyRes.status} ${JSON.stringify(atOnlyRes.data).slice(0, 160)}`);
  const fullNoHandle = client();
  const fullNoHandleRes = await fullNoHandle("POST", "/api/auth/register", {
    role: "creator", name: "No Handle", email: "admfullnohandle@fixtures.dev", password: "<MASKED_SECRET_002>",
    market: "Hampton Roads", city: "Norfolk", followerCount: 900, localAudiencePct: 40, categories: ["Food & Drink"], ...AGREE,
  });
  check("full signup with no handle is refused (400, handle required)", fullNoHandleRes.status === 400 && /handle is required/.test(fullNoHandleRes.data.error || ""), `${fullNoHandleRes.status} ${JSON.stringify(fullNoHandleRes.data).slice(0, 160)}`);

  const profPending = await admin("GET", `/api/admin/creators/${plain.id}`);
  check("admin profile view serves a PENDING applicant (200)", profPending.status === 200, `${profPending.status} ${JSON.stringify(profPending.data).slice(0, 160)}`);
  const pc = profPending.data.creator || {};
  check("admin profile payload is the business card shape (profile.handle + computed profile URL + status)",
    pc.userId === plain.id && !!pc.profile && pc.profile.handle === "admplain" && pc.profile.primaryProfileUrl === "https://instagram.com/admplain" && pc.applicationStatus === "pending",
    JSON.stringify({ u: pc.userId, h: pc.profile && pc.profile.handle, p: pc.profile && pc.profile.primaryProfileUrl, s: pc.applicationStatus }));
  const profDecided = await admin("GET", `/api/admin/creators/${hrInc.id}`);
  check("admin profile view serves a decided applicant too (approved)", profDecided.status === 200 && profDecided.data.creator && profDecided.data.creator.applicationStatus === "approved", `${profDecided.status}`);
  const profBiz = await biz("GET", `/api/admin/creators/${plain.id}`);
  check("admin profile view refuses a non-admin session (403)", profBiz.status === 403, String(profBiz.status));
  const profMissing = await admin("GET", "/api/admin/creators/00000000-0000-0000-0000-000000000000");
  check("admin profile view 404s an unknown creator id", profMissing.status === 404, String(profMissing.status));

  // Leaderboard rows carry the same profile URL, so the handle
  // links there too. A sponsor + one recruit credited to them.
  await quickClaim("admsponsor", "Hampton Roads");
  await quickClaim("admrecruit", "Hampton Roads", { referredBy: "admsponsor" });
  const lb = await admin("GET", "/api/admin/leaderboard");
  const lbRow = (lb.data.leaderboard || []).find((r) => r.handle === "admsponsor");
  check("leaderboard row carries the sponsor's profile URL", !!lbRow && lbRow.primaryProfileUrl === "https://instagram.com/admsponsor", JSON.stringify(lbRow && lbRow.primaryProfileUrl));

  // ---------- static client wiring ----------
  const appJs = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public", "app.js"), "utf8");
  check("queue row Details render the Via referral label", appJs.includes("Via referral: @${esc(u.referredBy)}"));
  check("queue row Details render the Source label", appJs.includes("Source: ${esc(u.signupSource)}"));
  check("applications view renders the roster counts strip", appJs.includes("Founding roster counts") && appJs.includes("Approved + profile complete") && appJs.includes("summaryStrip"));
  check("strip copy names the launch number without em dashes", appJs.includes("Approved + profile complete is the launch number") && !appJs.includes("launch number: only those creators show up for businesses. —"));
  check("dead-button fix: admin rows render the tester toggle for creators AND businesses with the working handler",
    appJs.includes("setTester('${u.id}'") && appJs.includes("'creator')") && appJs.includes("'business')") && (appJs.match(/Move to Tester/g) || []).length >= 2,
    "");
  const stBody = appJs.slice(appJs.indexOf("async function setTester"), appJs.indexOf("async function setTester") + 1800);
  const coBody = appJs.slice(appJs.indexOf("async function closeOffer"), appJs.indexOf("async function closeOffer") + 800);
  check("dead-button fix: My Offers renders Close offer with the working handler, and both handlers confirm through the DOM sheet (no native confirm gate)",
    appJs.includes("closeOffer('${o.id}')") && appJs.includes("function showConfirmSheet") &&
    stBody.includes("await showConfirmSheet(") && !stBody.includes("!confirm(") &&
    coBody.includes("await showConfirmSheet(") && !coBody.includes("!confirm("),
    "");
  // Clickable Requests cards + required social link (Jeff, 2026-10-26).
  check("Requests card renders the applicant handle as an external link to their real page",
    appJs.includes(`<a href="\${esc(u.creator.primaryProfileUrl)}" target="_blank" rel="noopener">@\${esc(u.creator.handle)}</a>`),
    "");
  check("Requests cards render a View profile action wired to the admin profile view",
    appJs.includes("onclick=\"adminViewCreator('${u.id}')\">View profile</button>") && appJs.includes("async function adminViewCreator") && appJs.includes('"/admin/creators/" + encodeURIComponent(userId)') && appJs.includes("Shown exactly as a business sees this profile."),
    "");
  check("Leaderboard renders the recruiter handle as an external link when the payload carries a URL",
    appJs.includes("r.primaryProfileUrl ? `<a href=\"${esc(r.primaryProfileUrl)}\" target=\"_blank\" rel=\"noopener\">@${esc(r.handle)}</a>`"),
    "");
  check("claim + full-join handle fields carry the view-your-page guidance",
    (appJs.match(/Paste your handle or a link to your page, so businesses and our team can view your page\./g) || []).length >= 2,
    "");
  check("both application submits normalize the handle client-side and refuse an empty one",
    appJs.includes("function normalizeHandleClient") && appJs.includes("const qcHandle = normalizeHandleClient") && appJs.includes("const jcHandle = normalizeHandleClient") && appJs.includes("handle is required: paste your handle or a link to your page."),
    "");
} finally {
  server.kill("SIGKILL");
  try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
}

console.log(`\nverify-admin: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
