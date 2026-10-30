#!/usr/bin/env node
// BUILD 2026.10.30-39 verification (Jeff, 2026-10-29):
// Part A: the founding business page drops every roster count
// and all thin-market framing. GET /api/me/roster-preview now
// carries category presence only (canonical categories with at
// least one finished creator in the business's market), and the
// shipped client contains no totals, no "of N" roster strings,
// and no stand-ins copy. The founding pricing strip and the
// unsaved-offer label ride unchanged from -29.
// Part B: the creator city unlock meter prints no raw counts
// below the double-digit threshold: bar plus qualitative state
// only; a percentage of the founding goal is gated on the
// finished count reaching 10 in the client source.
// Part C: the Charter Creator card. A named founding class,
// never a numbered one: no sign-up sequence, no cohort count,
// no rank on the card; the flex statistic is the creator's own
// local reach %. Eligibility (approved + finished profile +
// market not yet launched) stamps creator.charter/charterAt on
// the record, visible in Admin applications, permanent across
// the market opening; a creator who finishes after launch and
// a creator who is not approved get no seal.
// Run: node scripts/verify-nocounts-charter.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8937;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pass-123";
const DB = path.join(os.tmpdir(), `signl-verify-nocounts-${Date.now()}.json`);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) { const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); if (v) jar.set(k, v); else jar.delete(k); }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, data };
  }
  return call;
}

let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 350)); server = null; }
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function makeCreator(admin, { name, email, handle, followers, localPct, categories, approve = true }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle, followerCount: followers, localAudiencePct: localPct, categories,
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  if (approve) await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  return { client: c, id: reg.data.user.id, handle };
}

async function makeBusiness({ businessName, email, market, city, category, planId }) {
  const b = client();
  const reg = await b("POST", "/api/auth/register", {
    role: "business", name: "Owner " + businessName, businessName, email,
    password: "business-pass-123", market, city, category, planId,
    neighborhood: "", about: "", agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
  return { client: b, id: reg.data.user.id };
}

try {
  startServer();
  check("dev server boots in production shape", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // ---------- Part A fixtures: Richmond roster across two categories ----------
  const quinn = await makeCreator(admin, { name: "Charter Quinn", email: "quinn@fixtures.dev", handle: "charterquinn", followers: 900, localPct: 90, categories: ["Food & Drink"] });
  await makeCreator(admin, { name: "Charter Rob", email: "rob@fixtures.dev", handle: "charterrob", followers: 6000, localPct: 70, categories: ["Food & Drink"] });
  await makeCreator(admin, { name: "Fitness Fran", email: "fran@fixtures.dev", handle: "fitnessfran", followers: 2400, localPct: 65, categories: ["Fitness & Wellness"] });

  const biz = await makeBusiness({ businessName: "Counts Kitchen", email: "kitchen@fixtures.dev", market: "Richmond", city: "Richmond", category: "Restaurant", planId: "growth" });
  const preview = await biz.client("GET", "/api/me/roster-preview");
  check("A: founding business reads the preview (200)", preview.status === 200, JSON.stringify(preview.data).slice(0, 200));
  check("A: categories are the canonical presence set, in canonical order (Food & Drink, Fitness & Wellness)",
    JSON.stringify(preview.data.categories) === JSON.stringify(["Food & Drink", "Fitness & Wellness"]),
    JSON.stringify(preview.data.categories));
  check("A: payload has no totals, no shown count, no creator list, no market roster figure anywhere",
    !("totalInMarket" in preview.data) && !("shown" in preview.data) && !("creators" in preview.data) && !JSON.stringify(preview.data).includes("totalInMarket"),
    JSON.stringify(preview.data).slice(0, 200));

  const emptyBiz = await makeBusiness({ businessName: "Nashville Counts", email: "nash@fixtures.dev", market: "Nashville", city: "Nashville", category: "Retail", planId: "self-service" });
  const emptyPreview = await emptyBiz.client("GET", "/api/me/roster-preview");
  check("A: a market with no finished creators answers an empty category list (the client renders the recruiting set)",
    emptyPreview.status === 200 && Array.isArray(emptyPreview.data.categories) && emptyPreview.data.categories.length === 0,
    JSON.stringify(emptyPreview.data).slice(0, 200));

  // ---------- Part C: charter, positive ----------
  const q1 = await quinn.client("GET", "/api/me/founding");
  const charter1 = q1.data && q1.data.buzz ? q1.data.buzz.charter : null;
  check("C: an approved, finished creator in a pre-launch market carries buzz.charter with a stamp",
    !!(charter1 && typeof charter1.at === "string" && charter1.at.length >= 10), JSON.stringify(q1.data && q1.data.buzz));
  const q2 = await quinn.client("GET", "/api/me/founding");
  const charter2 = q2.data && q2.data.buzz ? q2.data.buzz.charter : null;
  check("C: the charter stamp is persisted, identical on the second read (stored, not recomputed)",
    !!(charter1 && charter2 && charter2.at === charter1.at), JSON.stringify({ a: charter1, b: charter2 }));
  const apps = await admin("GET", "/api/admin/applications");
  const decided = (apps.data && apps.data.decided) || [];
  const quinnRow = decided.find((x) => x.id === quinn.id) || {};
  check("C: the flag is stored on the creator record and visible in Admin (creator.charter + charterAt)",
    !!(quinnRow.creator && quinnRow.creator.charter === true && quinnRow.creator.charterAt === (charter1 && charter1.at)),
    JSON.stringify(quinnRow.creator || {}).slice(0, 200));
  check("C: the creator's own card profile carries the seal flag after stamping",
    !!(q2.data && q2.data.card && q2.data.card.profile && q2.data.card.profile.charter === true),
    JSON.stringify(q2.data && q2.data.card && q2.data.card.profile).slice(0, 200));

  // ---------- Part C: negatives ----------
  const pete = await makeCreator(admin, { name: "Pending Pete", email: "pete@fixtures.dev", handle: "pendingpete", followers: 1500, localPct: 80, categories: ["Food & Drink"], approve: false });
  const peteFounding = await pete.client("GET", "/api/me/founding");
  check("C: a creator who is not approved cannot even read the founding payload (still under review)",
    peteFounding.status === 403, JSON.stringify(peteFounding.data).slice(0, 160));
  const apps2 = await admin("GET", "/api/admin/applications");
  const peteRow = (((apps2.data && apps2.data.pending) || []).find((x) => x.id === pete.id)) || {};
  check("C: the unapproved creator's record carries no charter flag and no stamp",
    !!(peteRow.creator && peteRow.creator.charter !== true && !peteRow.creator.charterAt),
    JSON.stringify(peteRow.creator || {}).slice(0, 200));

  const lara = await makeCreator(admin, { name: "Late Lara", email: "lara@fixtures.dev", handle: "latelara", followers: 3200, localPct: 77, categories: ["Food & Drink"] });
  const toggle = await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });
  check("C: admin can flip Richmond live for the post-launch negative", toggle.status === 200 && toggle.data.live === true, JSON.stringify(toggle.data).slice(0, 160));
  const laraFounding = await lara.client("GET", "/api/me/founding");
  const laraCharter = laraFounding.data && laraFounding.data.buzz ? laraFounding.data.buzz.charter : undefined;
  check("C: a creator who finishes after the market launched gets no charter seal",
    laraFounding.status === 200 && laraCharter === null, JSON.stringify(laraFounding.data && laraFounding.data.buzz));
  const q3 = await quinn.client("GET", "/api/me/founding");
  const charter3 = q3.data && q3.data.buzz ? q3.data.buzz.charter : null;
  check("C: charter earned before launch is permanent: it survives the market opening with the same stamp",
    !!(charter3 && charter1 && charter3.at === charter1.at), JSON.stringify({ a: charter1, c: charter3 }));

  // ---------- client + server source pins ----------
  const appJs = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const fStart = appJs.indexOf("function renderBusinessFoundingStatus");
  const fEnd = appJs.indexOf("function renderPending()", fStart);
  const fSlice = fStart > -1 && fEnd > fStart ? appJs.slice(fStart, fEnd) : "";
  check("A: founding business slice exists", fSlice.length > 1000, `slice ${fSlice.length}`);
  check("A: NO roster totals or 'of N' strings anywhere in the founding slice",
    !fSlice.includes("totalInMarket") && !fSlice.includes("Showing the top") && !fSlice.includes("finished a profile in") && !fSlice.includes("of ${total}"), "");
  check("A: NO thin-market copy anywhere in the shipped client or server bundle",
    !appJs.includes("will never be padded with stand-ins") && !fSlice.includes("roster is being built now") && !fSlice.includes("No founding creator in"), "");
  check("A: categories render with the recruiting fallback and the founding scarcity line",
    fSlice.includes("foundingCategoriesHtml") && fSlice.includes("Categories recruiting now") && fSlice.includes("Founding businesses get first access to the roster when"), "");
  check("A: the local-reach explainer ships with its example clearly labeled and the exact approved example figures",
    fSlice.includes("foundingLocalReachHtml") && fSlice.includes("Example: a 2,000-follower creator whose audience is 90% local outranks a 50,000-follower account at 12% local") && fSlice.includes("Ranked by local reach, not followers"), "");
  check("A: the explainer names no real creator and no handle (no @ in the explainer block)",
    (() => { const s = appJs.indexOf("function foundingLocalReachHtml"); const e = appJs.indexOf("function foundingFirstOfferHtml", s); const b = s > -1 && e > s ? appJs.slice(s, e) : ""; return b.length > 0 && !b.includes("@"); })(), "");
  check("A: Sig first-offer preview kept, labeled unsaved; founding pricing strip kept verbatim",
    fSlice.includes("Your first offer is already drafted") && fSlice.includes("Nothing is saved, nothing is sent") && fSlice.includes("Nothing is due now.") && fSlice.includes("Businesses activate at market launch") && fSlice.includes("Locked founding rates"), "");
  check("A: no em dashes in the founding business slice", fSlice.length > 0 && !fSlice.includes("—"), "");

  const uStart = appJs.indexOf("function creatorUnlockHtml");
  const uEnd = appJs.indexOf("function creatorCharterCardHtml", uStart) > uStart ? appJs.indexOf("function creatorCharterCardHtml", uStart) : appJs.indexOf("The Momentum payoff", uStart);
  const uSlice = uStart > -1 && uEnd > uStart ? appJs.slice(uStart, uEnd) : "";
  check("B: unlock meter renders the qualitative early state (Founding class forming)",
    uSlice.includes("Founding class forming"), `slice ${uSlice.length}`);
  check("B: unlock meter prints NO raw counts (no 'X of bar', no approved count, no 'to go')",
    !uSlice.includes("to go") && !uSlice.includes("of ${un.launchBar}") && !uSlice.includes("${un.complete} of") && !uSlice.includes("${un.approved}"), uSlice.slice(0, 300));
  check("B: the percentage readout is gated on the finished count reaching double digits (>= 10) in client code",
    uSlice.includes("un.complete >= 10") && uSlice.includes("% of the founding goal"), "");
  check("B: no em dashes in the unlock meter code", uSlice.length > 0 && !uSlice.includes("—"), "");

  const cStart = appJs.indexOf("function creatorCharterCardHtml");
  const cEnd = appJs.indexOf("function creatorStatCardHtml", cStart);
  const cSlice = cStart > -1 && cEnd > cStart ? appJs.slice(cStart, cEnd) : "";
  check("C: charter card renders from buzz.charter inside the excitement layer composition",
    appJs.includes("creatorCharterCardHtml(u, card, f, buzz, placeRaw)") && cSlice.includes("if (!buzz.charter) return"), "");
  check("C: card names the class (Charter Creator, market, Founding Class of 2026) and carries the seal",
    cSlice.includes("Charter Creator") && cSlice.includes("Founding Class of 2026") && cSlice.includes("charter-seal") && cSlice.includes("Share my Charter card"), "");
  check("C: the flex statistic is the creator's own local reach % from their profile",
    cSlice.includes("${pct}%") && cSlice.includes("p.localAudiencePct"), "");
  check("C: the share payload carries the charter line and the creator's invite link",
    cSlice.includes("I am a Charter Creator on SIGNL in") && cSlice.includes("inviteUrlFor(u)"), "");
  check("C: scarcity line states founding status closes at launch, with no date and no count",
    cSlice.includes("Founding status closes when") && cSlice.includes("launches. This seal is yours for good"), "");
  check("C: card carries NO rank, NO cohort count, NO sign-up sequence (no localRank, no '#' rank render, no cohort wording)",
    !cSlice.includes("localRank") && !cSlice.includes("cohort") && !cSlice.includes("#${"), "");
  check("C: no em dashes in the charter card code", cSlice.length > 0 && !cSlice.includes("—"), "");
  check("C: the permanent seal rides the profile badges (stat card via buzz, profile headers via the stored flag)",
    appJs.includes('${buzz.charter ? "Charter Creator" : "Founding Creator"}') && appJs.includes('${p.charter ? "Charter Creator" : "Founding Creator"}'), "");
  check("C: charter styles ship in theme-v2.css (ink card, mint seal)",
    fs.readFileSync(path.join(ROOT, "public", "theme-v2.css"), "utf8").includes(".charter-card") && fs.readFileSync(path.join(ROOT, "public", "theme-v2.css"), "utf8").includes(".charter-seal"), "");

  const routerSrc = fs.readFileSync(path.join(ROOT, "netlify", "functions", "lib", "router.js"), "utf8");
  check("server bundle carries no totalInMarket anywhere (BUILD -30)", !routerSrc.includes("totalInMarket") && !appJs.includes("totalInMarket"), "");
  check("server stamps the charter flag on the creator record inside creatorBuzz",
    routerSrc.includes("rec.creator.charter = true") && routerSrc.includes("rec.creator.charterAt = at"), "");
  check("the forbidden Momentum phrase stays out of the client (feed is newest-first)",
    !appJs.includes("see paid campaigns first") && !appJs.includes("paid campaigns first"), "");
  check("build stamp is 2026.10.30-44 on both sides",
    fs.readFileSync(path.join(ROOT, "netlify", "functions", "lib", "build.js"), "utf8").includes("2026.10.30-44")
    && fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8").includes("2026.10.30-44"), "");
} catch (e) {
  failed += 1;
  failures.push("suite crashed: " + e.message);
  console.error(e);
} finally {
  await stopServer();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
  console.log(`\nverify-nocounts-charter: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log("failures:\n - " + failures.join("\n - "));
  process.exit(failed ? 1 : 0);
}
