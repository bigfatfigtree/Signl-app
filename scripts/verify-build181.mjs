// Build -181 verification: SELF-SERVE NATIONAL SIGNUP + the
// creator-facing brand identity rule.
// Jeff's correction 2026-11-16: he expected businesses to sign
// up THEMSELVES and pick National; -178 shipped admin-created
// only. Now the business form carries a scope choice; National
// creates the same record shape the admin create builds, lands
// pending, and stays invisible to creators until an admin
// verifies the brand in the National room.
// Jeff's exact case is the fixture spine: a brand signs up with
// its own email as "Tropical Oasis" (operated by a differently
// named company + a named contact), picks National, lands
// pending + unverified, then admin verifies and it behaves
// exactly like an admin-created national account.
// Identity rule: creators see the BRAND name and logo only —
// never the operator company's legal name, the contact's
// personal name, or the account email — on the feed, the
// campaign page, the brand profile, or notifications.
// Run: node scripts/verify-build181.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const national = require("../netlify/functions/lib/national.js");

const PORT = 8953;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "build181-admin-pass";
const DB = path.join(os.tmpdir(), `signl-verify-build181-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

// ---------------- source pins + unit ----------------
console.log("== source pins + unit ==");
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8");
check("build stamp is 2026.11.16-181", buildJs.includes("2026.11.16-181"));
check("client: scope choice ships in the business form", appJs.includes("Where do you operate?") && appJs.includes("National: we operate across markets") && appJs.includes("jbScopeSync181"));
check("client: registerBusiness sends scope national", appJs.includes('scope: isNational181 ? "national" : undefined'));
check("unit: brandDisplayName never falls back to the personal name", national.brandDisplayName({ name: "John Personal", business: {} }) === "" && national.brandDisplayName({ name: "John Personal", business: { brandName: "Tropical Oasis" } }) === "Tropical Oasis");
const bpv = national.brandProfileView({ id: "x", role: "business", market: "National", city: "", business: { scope: "national", businessName: "Operator Holdings LLC", brandName: "Tropical Oasis", verifiedAt: "2026-11-16T00:00:00.000Z" } }, []);
check("unit: brand profile view carries brand name, NOT the operator legal name", bpv.brandName === "Tropical Oasis" && !("businessName" in bpv) && !JSON.stringify(bpv).includes("Operator Holdings"));

// ---------------- API end-to-end ----------------
function client() {
  const jar = new Map();
  return async (method, p, body) => {
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
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  };
}
let server = null;
function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() { if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); server = null; } }
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { const res = await fetch(BASE + "/api/bootstrap"); if (res.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
}
function readDb() { return JSON.parse(fs.readFileSync(DB, "utf8")); }

const BRAND_EMAIL = "brand@fixtures.dev";
const CONTACT_NAME = "John Fixtureperson";
const OPERATOR_NAME = "Fixture Holdings LLC";
const BRAND_NAME = "Tropical Oasis";

try {
  startServer();
  check("dev server boots", await waitUp());
  const admin = client();
  await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  console.log("== Jeff's case: the brand signs ITSELF up as National ==");
  const reg = await client()("POST", "/api/auth/register", {
    role: "business", scope: "national", name: CONTACT_NAME, email: BRAND_EMAIL, password: "oasis-pass-123",
    businessName: OPERATOR_NAME, brandName: BRAND_NAME, website: "https://tropicaloasis.example.com",
    category: "Retail", about: "Liquid vitamins and collagen, shipped nationwide.",
    focusMarkets: ["Nashville", "Miami", "National", "Atlantis"], agreedTerms: true, agreedPostCompliance: true,
  });
  check("self-serve national signup -> 201 pending", reg.status === 201 && reg.data.user.status === "pending", JSON.stringify(reg.data).slice(0, 240));
  const brandId = reg.data.user.id;
  const biz = reg.data.user.business || {};
  check("record shape: scope national + sentinel market", biz.scope === "national" && reg.data.user.market === "National", reg.data.user.market);
  check("record shape: plan null, founding access, unverified", biz.plan === null && biz.accessState === "founding" && !biz.verifiedAt);
  check("record shape: brand name + cleaned focus markets", biz.brandName === BRAND_NAME && JSON.stringify(biz.focusMarkets) === JSON.stringify(["Nashville", "Miami"]), JSON.stringify(biz.focusMarkets));
  check("record shape: website kept (validator-normalized), category kept", /^https:\/\/tropicaloasis\.example\.com\/?$/.test(biz.website || "") && biz.category === "Retail", biz.website + " / " + biz.category);
  check("signup response does not leak a plan price", reg.data.user.business.planName === null && reg.data.user.business.planPriceMonthly === null);

  const badSite = await client()("POST", "/api/auth/register", {
    role: "business", scope: "national", name: "Bad Site", email: "badsite@fixtures.dev", password: "badsite-pass-1",
    businessName: "Bad Site Brand Co", website: "not a website", agreedTerms: true, agreedPostCompliance: true,
  });
  check("national signup with a junk website -> 400", badSite.status === 400, String(badSite.status));

  console.log("== parity with an admin-created national account ==");
  const admCreate = await admin("POST", "/api/admin/national/accounts", {
    email: "admbrand@fixtures.dev", businessName: "Admin Made Co", brandName: "Admin Made Brand",
    website: "https://adminmade.example.com", about: "Made by an admin.", focusMarkets: ["Nashville"], currency: "USD", country: "United States",
  });
  check("admin create still works", admCreate.status === 201, JSON.stringify(admCreate.data).slice(0, 160));
  const selfRec = readDb()[`user:${brandId}`];
  const admRec = readDb()[`user:${admCreate.data.account.id}`];
  const shapeKeys = ["scope", "plan", "planName", "planPriceMonthly", "planMinMonths", "billingStatus", "accessState", "verifiedAt", "verifiedBy", "discountEnabled"];
  check("self-serve and admin-created records share the national shape", shapeKeys.every((k) => JSON.stringify(selfRec.business[k]) === JSON.stringify(admRec.business[k])), shapeKeys.map((k) => `${k}: ${JSON.stringify(selfRec.business[k])} vs ${JSON.stringify(admRec.business[k])}`).join("; "));

  console.log("== the verification gate has no self-serve bypass ==");
  const appr = await admin("POST", "/api/admin/review", { userId: brandId, decision: "approve" });
  check("self-serve brand approved through the normal review", appr.status === 200 && appr.data.user.status === "approved");
  const brand = client();
  const brandLogin = await brand("POST", "/api/auth/login", { email: BRAND_EMAIL, password: "oasis-pass-123" });
  check("brand signs in with the password IT chose", brandLogin.status === 200, JSON.stringify(brandLogin.data).slice(0, 140));
  const natMe = await brand("GET", "/api/national/me");
  check("/national/me: national account, unverified, plan null", natMe.status === 200 && natMe.data.account.scope === "national" && natMe.data.account.verified === false && natMe.data.account.plan === null, JSON.stringify(natMe.data).slice(0, 200));
  const draft = await brand("POST", "/api/national/campaigns", { title: "Try our liquid vitamins, free", whatYouGet: "3 Tropical Oasis products of your choice, free", whatWeAsk: "Post 1 video and 1 story about your honest experience, and tag the brand.", picksCount: 2, raiseByAt: "2999-01-01T00:00:00.000Z", details: "We ship within a week of your pick.", categories: ["Health & Wellness"] });
  check("draft saves", draft.status === 201, JSON.stringify(draft.data).slice(0, 160));
  const campId = draft.data.campaign.id;
  const pubEarly = await brand("POST", `/api/national/campaigns/${campId}/publish`, {});
  check("publish refused while still founding (not activated)", pubEarly.status === 400 && /not active yet|activat/i.test(pubEarly.data.error || ""), JSON.stringify(pubEarly.data).slice(0, 200));
  const actEarly = await admin("POST", "/api/admin/businesses/activate", { userId: brandId });
  check("activation alone opens the account shell", actEarly.status === 200 && actEarly.data.user.business.accessState === "active");
  const pubUnverified = await brand("POST", `/api/national/campaigns/${campId}/publish`, {});
  check("publish STILL refused while unverified (the gate itself)", pubUnverified.status === 400 && /verif/i.test(pubUnverified.data.error || ""), JSON.stringify(pubUnverified.data).slice(0, 200));

  // A finished, approved creator sees NOTHING of this brand yet.
  const creator = client();
  const creReg = await creator("POST", "/api/auth/register", { role: "creator", quickClaim: true, email: "watcher@fixtures.dev", password: "watcher-pass-1", handle: "watcherfixture", primaryPlatform: "instagram", market: "Nashville", agreedTerms: true });
  await admin("POST", "/api/admin/review", { userId: creReg.data.user.id, decision: "approve" });
  await creator("PATCH", "/api/me/profile", { audienceStack: { instagram: 6000 }, localAudiencePct: 60, categories: ["Health & Wellness"], city: "Nashville" });
  const feedBefore = await creator("GET", "/api/national/feed");
  check("creator feed: unverified brand's campaign invisible", !(feedBefore.data.campaigns || []).some((c) => c.id === campId));

  console.log("== the brand PROFILE is behind the same fence (review fix) ==");
  const profEarly = await creator("GET", `/api/national/brands/${brandId}`);
  check("creator: unverified brand's profile is a 404", profEarly.status === 404, `status=${profEarly.status} ${JSON.stringify(profEarly.data).slice(0, 120)}`);
  const profOwner = await brand("GET", `/api/national/brands/${brandId}`);
  check("the brand itself can always read its own profile", profOwner.status === 200 && profOwner.data.brand.brandName === BRAND_NAME, `status=${profOwner.status}`);
  const bizViewer = client();
  const bizReg = await bizViewer("POST", "/api/auth/register", { role: "business", name: "Viewer Owner", email: "bizviewer@fixtures.dev", password: "viewer-pass-123", businessName: "Viewer Fixture Shop", market: "Nashville", city: "Nashville", category: "Retail", planId: "self-service", agreedTerms: true });
  check("market business viewer registers", bizReg.status === 201, JSON.stringify(bizReg.data).slice(0, 120));
  const profBiz = await bizViewer("GET", `/api/national/brands/${brandId}`);
  check("an unrelated business: unverified brand's profile is a 404 too", profBiz.status === 404, `status=${profBiz.status}`);
  const profAnon = await client()("GET", `/api/national/brands/${brandId}`);
  check("signed-out: profile is not public", profAnon.status === 401 || profAnon.status === 404, `status=${profAnon.status}`);

  console.log("== admin verifies; the brand behaves like an admin-created one ==");
  const verify = await admin("POST", `/api/admin/national/accounts/${brandId}/verify`, { checklist: { websiteResolves: true, nameMatches: true, storeExists: true } });
  check("admin verify stamps the self-serve brand", verify.status === 200 && verify.data.account.verified === true, JSON.stringify(verify.data).slice(0, 160));
  const profSave = await brand("PATCH", "/api/me/profile", { logoUrl: "https://tropicaloasis.example.com/logo.png" });
  check("brand saves its logo", profSave.status === 200, JSON.stringify(profSave.data).slice(0, 140));
  const pub = await brand("POST", `/api/national/campaigns/${campId}/publish`, {});
  check("publish opens once verified + activated + logo set", pub.status === 200 && pub.data.campaign.status === "open", JSON.stringify(pub.data).slice(0, 200));

  console.log("== identity: creators see the brand name and logo ONLY ==");
  const feed = await creator("GET", "/api/national/feed");
  const card = (feed.data.campaigns || []).find((c) => c.id === campId);
  check("feed card present after publish", !!card);
  const feedJson = JSON.stringify(feed.data);
  check("feed: brand name + logo show", !!card && card.brandName === BRAND_NAME && card.logoUrl === "https://tropicaloasis.example.com/logo.png");
  check("feed: NO operator legal name", !feedJson.includes(OPERATOR_NAME));
  check("feed: NO contact personal name", !feedJson.includes(CONTACT_NAME));
  check("feed: NO account email", !feedJson.includes(BRAND_EMAIL));
  const page = await creator("GET", `/api/national/campaigns/${campId}`);
  const pageJson = JSON.stringify(page.data);
  check("campaign page: brand block is brand-only", page.status === 200 && page.data.brand.brandName === BRAND_NAME && !("businessName" in page.data.brand), JSON.stringify(page.data.brand || {}).slice(0, 200));
  check("campaign page: NO operator name, personal name, or email anywhere", !pageJson.includes(OPERATOR_NAME) && !pageJson.includes(CONTACT_NAME) && !pageJson.includes(BRAND_EMAIL));
  const profile = await creator("GET", `/api/national/brands/${brandId}`);
  const profJson = JSON.stringify(profile.data);
  check("brand profile: brand name + verified line", profile.status === 200 && profile.data.brand.brandName === BRAND_NAME && profile.data.brand.verifiedLine === "Verified by Magpie");
  check("brand profile: NO operator name, personal name, or email anywhere", !profJson.includes(OPERATOR_NAME) && !profJson.includes(CONTACT_NAME) && !profJson.includes(BRAND_EMAIL));

  console.log("== market signup is unchanged ==");
  const mkt = await client()("POST", "/api/auth/register", { role: "business", name: "Local Owner", email: "localshop@fixtures.dev", password: "business-pass-123", businessName: "Local Fixture Shop", market: "Nashville", city: "Nashville", category: "Restaurant", planId: "self-service", agreedTerms: true });
  check("one-market business signup still records its plan", mkt.status === 201 && mkt.data.user.business.plan === "self-service" && mkt.data.user.market === "Nashville" && mkt.data.user.business.scope !== "national", JSON.stringify(mkt.data).slice(0, 200));

  console.log(`\nverify-build181: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exitCode = 1; }
} finally {
  await stopServer();
}
