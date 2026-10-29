#!/usr/bin/env node
// Build 2026.10.29-37 verification: LinkedIn Full Citizen.
// A LinkedIn-first creator is equal end to end: visit proof
// validates on their own primary platform (and rejects other
// platforms' links), the book-me Tier-2 reveal includes
// LinkedIn beside the other channels under the same toggle,
// the pro-categories moment surfaces LinkedIn in the signup
// and profile platform steps, and the Local List labels the
// platform plainly. No API or verification claims anywhere:
// LinkedIn local reach stays self-reported like everyone's.
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8947;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "build37-admin@signl.local";
const ADMIN_PASSWORD = ["build37", "admin", "pass"].join("-");
const WEBHOOK_SECRET = ["whsec", "test", "build37"].join("_");
function signWebhook(raw) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${raw}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} :: ${detail}`); }
}

function client() {
  const jar = new Map();
  const call = async (method, path, body) => {
    const headers = { "content-type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const part of sc) { const pair = part.split(";")[0]; const i = pair.indexOf("="); if (i > -1) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  call.raw = async (method, path, rawBody, headers = {}) => {
    const res = await fetch(BASE + path, { method, headers, body: rawBody === null ? undefined : rawBody });
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  return call;
}

async function waitUp() {
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.status) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
}

async function makeCreator(admin, { name, email, handle, platform = "instagram", extra = {} }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle, followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"], primaryPlatform: platform,
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true, ...extra,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await c("PATCH", "/api/me/profile", { publicPage: true });
  return { client: c, id: reg.data.user.id, handle };
}

async function makeBusiness(admin, { name, businessName, email }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "business", name, businessName, email, password: "business-pass-123", market: "Richmond", city: "Richmond",
    category: "Restaurant", planId: "growth", neighborhood: "Carytown", agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: reg.data.user.id });
  return { client: c, id: reg.data.user.id };
}

// A redeemed booking ready for proof, via a direct comped offer
// the creator accepts (the standard direct-offer path).
async function redeemedBooking(biz, creator) {
  const off = await biz.client("POST", "/api/offers", { title: "Proof Night", whatComped: "Dinner", dollarCap: 50, creatorId: creator.id, spots: 1 });
  if (off.status !== 201) throw new Error(`offer failed: ${JSON.stringify(off.data)}`);
  const acc = await creator.client("POST", `/api/offers/${off.data.offer.id}/accept`, {});
  if (acc.status !== 200 && acc.status !== 201) throw new Error(`accept failed: ${JSON.stringify(acc.data)}`);
  const bk = acc.data.booking;
  // The business confirm is itself a redemption path
  // (redeemMethod "business confirmed"), which starts the
  // 48-hour proof clock.
  const conf = await biz.client("POST", `/api/bookings/${bk.id}/confirm`, {});
  if (conf.status !== 200 && conf.status !== 201) throw new Error(`confirm failed: ${JSON.stringify(conf.data)}`);
  return bk.id;
}

let server;
try {
  const dir = mkdtempSync(join(tmpdir(), "signl-build37-"));
  server = spawn(process.execPath, ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: join(dir, "db.json"), ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, STRIPE_SECRET_KEY: "sk_test_fake_build37", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await waitUp();

  const admin = client();
  const login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(login.data)}`);
  await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });

  const biz = await makeBusiness(admin, { name: "Biz Owner", businessName: "Proof Kitchen", email: "biz@proof.dev" });
  const lena = await makeCreator(admin, { name: "Linked Lena", email: "lena@fixtures.dev", handle: "lenalinkedin", platform: "linkedin" });
  const iggy = await makeCreator(admin, { name: "Iggy Grams", email: "iggy@fixtures.dev", handle: "iggygrams", platform: "instagram" });
  const tessa = await makeCreator(admin, { name: "Tik Tessa", email: "tessa@fixtures.dev", handle: "tessatoks", platform: "tiktok" });

  // (1) Visit proof on the creator's OWN primary platform.
  const bkLena = await redeemedBooking(biz, lena);
  const wrongDomain = await lena.client("POST", "/api/posts", { bookingId: bkLena, url: "https://www.instagram.com/p/ABC123/" });
  check("(1) a LinkedIn-primary creator cannot prove with an Instagram link",
    wrongDomain.status === 400 && /LinkedIn/.test(wrongDomain.data.error || ""), `${wrongDomain.status} ${JSON.stringify(wrongDomain.data).slice(0, 160)}`);
  const liPost = await lena.client("POST", "/api/posts", { bookingId: bkLena, url: "https://www.linkedin.com/posts/lenalinkedin_great-night-activity-7312345678901234567-abCd" });
  check("(1) a LinkedIn post link validates for a LinkedIn-primary creator",
    liPost.status === 200 || liPost.status === 201, `${liPost.status} ${JSON.stringify(liPost.data).slice(0, 160)}`);
  const bkIggy = await redeemedBooking(biz, iggy);
  const igPost = await iggy.client("POST", "/api/posts", { bookingId: bkIggy, url: "https://www.instagram.com/p/C8kQ2mPxT4a/" });
  check("(1) Instagram stays the default proof for Instagram-primary creators",
    igPost.status === 200 || igPost.status === 201, `${igPost.status} ${JSON.stringify(igPost.data).slice(0, 160)}`);
  const bkTessa = await redeemedBooking(biz, tessa);
  const ttWrong = await tessa.client("POST", "/api/posts", { bookingId: bkTessa, url: "https://www.youtube.com/watch?v=abc123" });
  check("(1) a TikTok-primary creator cannot prove with a YouTube link",
    ttWrong.status === 400 && /TikTok/.test(ttWrong.data.error || ""), `${ttWrong.status} ${JSON.stringify(ttWrong.data).slice(0, 160)}`);
  const ttPost = await tessa.client("POST", "/api/posts", { bookingId: bkTessa, url: "https://www.tiktok.com/@tessatoks/video/7312345678901234567" });
  check("(1) a TikTok post link validates for a TikTok-primary creator",
    ttPost.status === 200 || ttPost.status === 201, `${ttPost.status} ${JSON.stringify(ttPost.data).slice(0, 160)}`);

  // (2) Book-me Tier-2 reveal includes LinkedIn, toggle rules.
  // Tier 2 = paid + active: the subscription lands by signed
  // webhook, the same setup Build -31's suite uses.
  const evt = { id: "evt_build37", type: "customer.subscription.created", data: { object: { id: "sub_build37", customer: "cus_build37", status: "active", current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, metadata: { businessId: biz.id }, items: { data: [{ price: { id: "price_1USRLcJ5DCULBlmAajXPmJjr" } }] } } } };
  const raw = JSON.stringify(evt);
  const wh = await client().raw("POST", "/api/stripe/webhook", raw, { "Content-Type": "application/json", "stripe-signature": signWebhook(raw) });
  if (wh.status !== 200) throw new Error(`webhook failed: ${JSON.stringify(wh.data)}`);
  const bmBiz = await biz.client("GET", "/api/c/lenalinkedin");
  const links = (bmBiz.data && bmBiz.data.profile && bmBiz.data.profile.socialLinks) || (bmBiz.data && bmBiz.data.socialLinks) || [];
  check("(2) the paid-business reveal includes LinkedIn beside the other channels",
    bmBiz.status === 200 && links.some((l) => l.platform === "linkedin" && /linkedin\.com/.test(l.url)),
    JSON.stringify(links).slice(0, 240));
  await lena.client("PATCH", "/api/me/profile", { showSocials: false });
  const bmHidden = await biz.client("GET", "/api/c/lenalinkedin");
  const linksHidden = (bmHidden.data && bmHidden.data.profile && bmHidden.data.profile.socialLinks) || [];
  check("(2) the creator toggle hides the reveal, LinkedIn included",
    bmHidden.status === 200 && linksHidden.length === 0 && bmHidden.data.profile.socialsHiddenByCreator === true,
    JSON.stringify(bmHidden.data && bmHidden.data.profile && bmHidden.data.profile.socialLinks));
  await lena.client("PATCH", "/api/me/profile", { showSocials: true });

  // (5) Local List platform label.
  const list = await client()("GET", "/api/public/local-list?market=Richmond");
  const food = list.data && (list.data.categories || []).find((c) => c.name === "Food & Drink");
  const lenaEntry = food && food.creators.find((c) => c.handle === "lenalinkedin");
  check("(5) the Local List labels a LinkedIn-primary creator's platform plainly",
    !!lenaEntry && lenaEntry.primaryPlatformLabel === "LinkedIn" && lenaEntry.primaryPlatform === "linkedin",
    JSON.stringify(lenaEntry));

  // Client source checks.
  const appJs = readFileSync(join(ROOT, "public/app.js"), "utf8");
  check("(4) the pro-categories moment ships in the signup and profile platform steps",
    appJs.includes("A lot of pros here run on LinkedIn.") && appJs.includes("proHintSync") && appJs.includes("jc-pro-hint") && appJs.includes("p-pro-hint"), "missing pro hint");
  check("(4) the nudge never forces a platform: no preselect override in the hint code",
    !/proHintSync[\s\S]{0,400}primaryPlatform\s*=/.test(appJs), "hint mutates platform");
  check("(1) the proof form names the creator's own platform, not Instagram for everyone",
    appJs.includes("primaryLabelClient((state.user && state.user.creator && state.user.creator.primaryPlatform)") && !appJs.includes("Link to your Instagram post or reel"), "proof label not dynamic");
  check("(6) honesty: the proof disclosure no longer claims Instagram-only proof",
    !appJs.includes("visit proof is an Instagram post link for now"), "stale disclosure");
  check("(3) LinkedIn sits in the profile social rows like the other channels",
    appJs.includes('id="p-linkedin"') && appJs.includes('id="p-facebook"') && appJs.includes('id="p-x"'), "profile rows missing");
} catch (e) {
  failures.push(`suite crashed: ${e.message}`);
  console.error(e);
} finally {
  if (server) server.kill("SIGTERM");
}

console.log(`\nverify-build37: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
