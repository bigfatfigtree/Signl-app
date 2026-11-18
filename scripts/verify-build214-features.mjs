#!/usr/bin/env node
// Build -214 fixture suite: Book the Block, Maggie the Agent,
// the Creator Money page, and the item-38 display fix (stacked
// totals everywhere a creator's audience number appears).
//
// Asserts BEHAVIOR on a live fixture server:
// - the Block roster is the Find-creators population, ranked
//   band-first then local followers in the business's market;
// - bundle booking goes through the POST /offers gates: a
//   founding business in a not-live market gets DRAFTS (and no
//   creator notification), an active business in a live market
//   gets OPEN offers (and the notification);
// - the proof board counts check-ins / posts / redemptions /
//   neighbors reached from the records;
// - Maggie's pitch sweep creates pair-scoped pitches from listed
//   facts only (caps + privacy: a third party never sees them);
// - /me/money returns real zeros + the one next action;
// - the admin applications payload carries the stacked total so
//   the Review list renders 3,367, not the Instagram-only 234.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

const routerJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const themeCss = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");

console.log("== stamp ==");
check("BUILD_ID is 2026.11.18-214", buildJs.includes('exports.BUILD_ID = "2026.11.18-214"'));
check("shell stamp matches", indexHtml.includes('window.__SIGNL_BUILD__ = "2026.11.18-214"') && (indexHtml.match(/2026\.11\.18-214/g) || []).length >= 5);

console.log("== F0: stacked totals (item 38 display half) ==");
check("admin Review list row renders the stacked total (adminKnownTotal)", appJs.includes("fmtNum(adminKnownTotal(u))} followers"));
check("admin account detail renders the stacked total", (appJs.match(/fmtNum\(adminKnownTotal\(u\)\)\} followers/g) || []).length >= 2);
check("adminKnownTotal walks totalAudience -> rollup -> stack sum -> followerCount",
  appJs.includes("c.totalAudience") && appJs.includes("c.audienceStack") && appJs.includes("Object.values(stack).reduce"));
check("no admin surface still renders followerCount as the headline number", !appJs.includes("fmtNum(u.creator.followerCount)} followers"));
check("server export rows use the stacked total", routerJs.includes("totalAudience: creatorTotalAudience(c)"));
check("accountant CSV tiers from the stacked total", routerJs.includes("tierForFollowers(creatorTotalAudience(c))"));

console.log("== architecture (static) ==");
check("pitch sweep joins the fire-and-forget preamble (never awaited)", routerJs.includes("await maybeRunBlockPitchSweep213(); } catch (e) { /* pitch sweep is best-effort on the request path */ }"));
check("pitch sweep claims its durable stamp before running", routerJs.includes('await store.set("config:blockPitchSweep213", { lastRunAt: nowIso() });\n  await runBlockPitchSweep213();'));
check("pitch reads go through list (allPitches213), no serial per-key scan in the sweep", routerJs.includes('store.list("pitch:")'));
check("bundle offers reuse the founding draft law", routerJs.includes("const wantsDraft = !marketLive || isFoundingBusiness(bizUser);"));
check("bundle paid gate mirrors POST /offers (floor + card)", routerJs.includes("cashRate < paidFloorForMarket(user.market)") && routerJs.includes("connect.connectConfigured() && !businessCardOnFile(user)"));
check("money endpoint uses the slim own-records math (cc definitions, no admin prep)", routerJs.includes("Slim money math") && routerJs.includes("myBookings") && routerJs.includes("ccMoney(x.paidLane.creatorNet)"));
check("market-cell roster cards use the stacked total (M1)", routerJs.includes("followers: creatorTotalAudience(u.creator)"));
check("pitch sweep + for-me exclude tester businesses (M2)", routerJs.includes('u.status === "approved" && !isTester(u) && u.market && u.business') && routerJs.includes('x.status === "approved" && !isTester(x) && x.business'));
check("pitch sweep has a bounded per-pass cap (M3)", routerJs.includes("PITCH_PASS_CAP213"));
check("client ships the Block tab, home panels and money top", appJs.includes("renderBlockTab213") && appJs.includes("loadBlockHome213") && appJs.includes("moneyTopHtml213") && appJs.includes('"Book the Block"'));
check("Block styles shipped", themeCss.includes(".btb-hero") && themeCss.includes(".money-next") && themeCss.includes(".mp-card"));

// ---------- live fixture server ----------
const DB = fs.mkdtempSync("/tmp/signl-build214-") + "/db.json";
const PW = "verify-build214-features-pass";
const SALT = "verifybuild214salt";
const HASH = crypto.scryptSync(PW, SALT, 64).toString("hex");
const nowMs = Date.now();
const iso = (ms) => new Date(ms).toISOString();
function seedDb(marketLive) {
  const seed = {};
  const mk = (u) => { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; };
  mk({ id: "admin213", role: "admin", email: "admin@fixtures.dev", name: "Fixture Admin", passwordHash: HASH, passwordSalt: SALT, status: "approved", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: iso(nowMs) });
  // Founding business (accessState not active), Nashville, ZIP 37201.
  mk({ id: "biz213", role: "business", email: "biz@fixtures.dev", name: "Biz Owner", passwordHash: HASH, passwordSalt: SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(nowMs - 20 * 86400000), updatedAt: iso(nowMs), tester: false, business: { businessName: "Fixture Tacos", category: "Restaurant", zip: "37201", accessState: "founding" } });
  // Active business (for the live-market phase).
  mk({ id: "bizlive213", role: "business", email: "bizlive@fixtures.dev", name: "Live Owner", passwordHash: HASH, passwordSalt: SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(nowMs - 20 * 86400000), updatedAt: iso(nowMs), tester: false, business: { businessName: "Live Cantina", category: "Restaurant", zip: "37201", accessState: "active" } });
  const creatorBase = { role: "creator", passwordHash: HASH, passwordSalt: SALT, market: "Nashville", city: "Nashville", createdAt: iso(nowMs - 30 * 86400000), updatedAt: iso(nowMs), tester: false };
  // Near creator: same ZIP as the business, 1,500 stacked, 60% local -> 900 local followers.
  mk({ ...creatorBase, id: "crnear213", email: "near@fixtures.dev", name: "Near Creator", status: "approved", creator: { handle: "nearfx", zip: "37201", categories: ["Food & Drink"], audienceStack: { instagram: 1000, tiktok: 500 }, totalAudience: 1500, followerCount: 1000, localAudiencePct: 60, hasPhoto: true, bio: "Nashville food and neighborhood stories, posted weekly.", profileComplete: true, paidRate: null } });
  // Far creator: no band, 5,000 stacked, 20% local -> 1,000 local followers (more local, still ranked second: band wins).
  mk({ ...creatorBase, id: "crfar213", email: "far@fixtures.dev", name: "Far Creator", status: "approved", creator: { handle: "farfx", zip: "37013", categories: ["Music"], audienceStack: { instagram: 5000 }, totalAudience: 5000, followerCount: 5000, localAudiencePct: 20, hasPhoto: true, bio: "Music and shows around Nashville and beyond.", profileComplete: true, paidRate: 150 } });
  // Incomplete approved creator: never on the roster.
  mk({ ...creatorBase, id: "crinc213", email: "inc@fixtures.dev", name: "Incomplete Creator", status: "approved", creator: { handle: "incfx", zip: "37201", categories: ["Food & Drink"], audienceStack: { instagram: 900 }, totalAudience: 900, followerCount: 900, localAudiencePct: null, hasPhoto: false, profileComplete: false } });
  // The @themamabekah shape: pending, five channels, Instagram only 234 of a 3,367 stack.
  mk({ ...creatorBase, id: "crbekah213", email: "bekah@fixtures.dev", name: "Bekah Fixture", status: "pending", market: "Houston", city: "Houston", creator: { handle: "themamabekah", categories: ["Family"], audienceStack: { instagram: 234, youtube: 1900, tiktok: 999, facebook: 232, linkedin: 2 }, totalAudience: 3367, followerCount: 234, localAudiencePct: 70, hasPhoto: true, profileComplete: true } });
  // Proof fixtures: one completed comp booking for biz213 via a block offer, checked in, posted, 7 redemptions.
  seed["offer:off213"] = { id: "off213", businessId: "biz213", businessName: "Fixture Tacos", market: "Nashville", creatorId: "crnear213", lane: "direct", kind: "comp", title: "Block tasting", whatComped: "Dinner for two", dollarCap: 75, status: "open", blockId: "blk213", createdAt: iso(nowMs - 6 * 86400000), updatedAt: iso(nowMs - 6 * 86400000) };
  seed["booking:bk213"] = { id: "bk213", offerId: "off213", businessId: "biz213", businessName: "Fixture Tacos", creatorId: "crnear213", market: "Nashville", kind: "comp", title: "Block tasting", whatComped: "Dinner for two", dollarCap: 75, status: "completed", createdAt: iso(nowMs - 6 * 86400000), updatedAt: iso(nowMs - 2 * 86400000), redeemedAt: iso(nowMs - 3 * 86400000), redemptions: { count: 7 } };
  seed["post:post213"] = { id: "post213", bookingId: "bk213", creatorId: "crnear213", businessId: "biz213", url: "https://example.invalid/post", verifiedAt: iso(nowMs - 2 * 86400000), createdAt: iso(nowMs - 2 * 86400000) };
  // Tester business (M2): approved, Nashville — must never be pitched or listed to creators.
  mk({ id: "biztest213", role: "business", email: "biztest@fixtures.dev", name: "Test Owner", passwordHash: HASH, passwordSalt: SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(nowMs - 20 * 86400000), updatedAt: iso(nowMs), tester: true, business: { businessName: "Test Biz", category: "Restaurant", zip: "37201", accessState: "active" } });
  // Paid money fixtures for crfar213 (via bizlive213): one held booking, one released booking, one granted license.
  seed["booking:bkheld213"] = { id: "bkheld213", businessId: "bizlive213", businessName: "Live Cantina", creatorId: "crfar213", market: "Nashville", kind: "paid", title: "Paid set", status: "accepted", paidLane: { rate: 150, creatorNet: 145.5, businessTotal: 150, escrowState: "held", bookedAt: iso(nowMs - 3 * 86400000) }, createdAt: iso(nowMs - 3 * 86400000), updatedAt: iso(nowMs - 3 * 86400000) };
  seed["booking:bkrel213"] = { id: "bkrel213", businessId: "bizlive213", businessName: "Live Cantina", creatorId: "crfar213", market: "Nashville", kind: "paid", title: "Paid set two", status: "completed", paidLane: { rate: 150, creatorNet: 145.5, businessTotal: 150, escrowState: "released", releasedAt: iso(nowMs - 86400000), funds: { state: "released" } }, createdAt: iso(nowMs - 5 * 86400000), updatedAt: iso(nowMs - 86400000) };
  seed["license:lic213"] = { id: "lic213", bookingId: "bkrel213", businessId: "bizlive213", creatorId: "crfar213", status: "granted", creatorNet: 50, businessTotal: 55, grantedAt: iso(nowMs - 86400000), createdAt: iso(nowMs - 2 * 86400000), updatedAt: iso(nowMs - 86400000) };
  seed["config:markets"] = { flags: marketLive ? { Nashville: true } : {} };
  fs.writeFileSync(DB, JSON.stringify(seed));
}

const PORT = 9313;
const BASE = `http://127.0.0.1:${PORT}`;
function client() {
  const jar = new Map();
  return async (method, p, body, headers = {}) => {
    const h = { ...headers };
    if (body) h["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) { const pair = c.split(";")[0]; const i = pair.indexOf("="); if (i > -1) jar.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, json };
  };
}
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function boot() {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_MAIL_STUB: "1", APP_URL: BASE, SIGNL_SWEEP_TOKEN: "suite-sweep-token-213" };
  for (const k of ["SIG_AI_API_KEY", "SIG_AI_BASE_URL", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MAGGIE_AI_ENABLED", "NETLIFY_BLOBS_SITE_ID", "NETLIFY_BLOBS_TOKEN"]) delete env[k];
  const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: ROOT, env, stdio: "ignore" });
  for (let i = 0; i < 120; i++) { try { const r = await fetch(BASE + "/api/boot"); if (r.status < 500) break; } catch (e) {} await sleepMs(250); }
  return server;
}
const login = async (c, email) => c("POST", "/api/auth/login", { email, password: PW });

try {
  seedDb(false);
  let server = await boot();
  console.log("== behavior: founding phase (market not live) ==");
  const biz = client();
  const lb = await login(biz, "biz@fixtures.dev");
  check("business sign-in", lb.status === 200, `${lb.status}`);
  const gb = await biz("GET", "/api/block");
  check("GET /block answers for a business", gb.status === 200 && Array.isArray(gb.json.roster), `${gb.status}`);
  const rosterIds = (gb.json.roster || []).map((m) => m.userId);
  check("roster is the bookable population (incomplete + pending excluded)", rosterIds.includes("crnear213") && rosterIds.includes("crfar213") && !rosterIds.includes("crinc213") && !rosterIds.includes("crbekah213"), rosterIds.join(","));
  check("ranked band-first, then local followers (near beats far despite fewer local followers)", rosterIds[0] === "crnear213" && rosterIds[1] === "crfar213", rosterIds.join(","));
  const near = (gb.json.roster || []).find((m) => m.userId === "crnear213") || {};
  check("near creator: band + stacked local math (1,500 x 60% = 900)", near.band === "Same neighborhood" && near.totalAudience === 1500 && near.localFollowers === 900, JSON.stringify(near).slice(0, 200));
  const far = (gb.json.roster || []).find((m) => m.userId === "crfar213") || {};
  check("far creator: no band, local math still shown (5,000 x 20% = 1,000)", far.band === null && far.localFollowers === 1000, JSON.stringify(far).slice(0, 200));
  check("founding state is honest (founding=true, marketLive=false)", gb.json.founding === true && gb.json.marketLive === false);

  const book = await biz("POST", "/api/block/book", { creatorIds: ["crnear213", "crfar213"], kind: "comp", title: "Weekend tasting", whatComped: "Dinner for two", dollarCap: 75 });
  check("bundle booking accepted", book.status === 201, `${book.status} ${JSON.stringify(book.json).slice(0, 160)}`);
  check("founding law: every invite is a draft for opening day", (book.json.results || []).every((r) => r.status === "draft") && book.json.block.drafted === 2, JSON.stringify(book.json.results));
  const db1 = JSON.parse(fs.readFileSync(DB, "utf8"));
  const blockOffers = Object.values(db1).filter((x) => x && x.blockId && x.id !== "off213");
  check("offers stored with the block stamp", blockOffers.length === 2 && blockOffers.every((o) => o.status === "draft" && o.lane === "direct"), `${blockOffers.length}`);
  const notifToCreators = Object.entries(db1).filter(([k, v]) => k.startsWith("note:") && v && (v.userId === "crnear213" || v.userId === "crfar213") && v.kind === "offer_received");
  check("drafts never notify creators", notifToCreators.length === 0, `${notifToCreators.length}`);

  const proof = await biz("GET", "/api/block/proof");
  check("proof board counts from the records (1 in, 1 post, 7 redeemed, 900 reached)", proof.json && proof.json.totals && proof.json.totals.checkedIn === 1 && proof.json.totals.postsLive === 1 && proof.json.totals.redeemed === 7 && proof.json.totals.neighborsReached === 900, JSON.stringify(proof.json && proof.json.totals));
  check("proof row flags the Block booking", (proof.json.rows || []).some((r) => r.fromBlock === true));

  const cr = client();
  const lc = await login(cr, "near@fixtures.dev");
  check("creator sign-in", lc.status === 200, `${lc.status}`);
  const forb = await cr("GET", "/api/block");
  check("creators cannot read the business Block", forb.status === 403, `${forb.status}`);
  const forMe = await cr("GET", "/api/block/for-me");
  const myBiz = (forMe.json.businesses || []).find((x) => x.businessId === "biz213") || {};
  check("creator's flipped view: business near my followers, my local count", forMe.status === 200 && myBiz.band === "Same neighborhood" && myBiz.yourLocalFollowers === 900, JSON.stringify(myBiz).slice(0, 200));
  check("for-me never lists the tester business (M2)", !(forMe.json.businesses || []).some((x) => x.businessId === "biztest213"));

  const money = await cr("GET", "/api/me/money");
  check("money page: real numbers, comp value separate ($75 visit, not cash)", money.status === 200 && money.json.made === 0 && money.json.onItsWay === 0 && money.json.compValue === 75, JSON.stringify(money.json).slice(0, 240));
  const farMoneyC = client(); await login(farMoneyC, "far@fixtures.dev");
  const farMoney = await farMoneyC("GET", "/api/me/money");
  check("money page: held/released/license math (145.50 held, 195.50 made + paid out)", farMoney.status === 200 && farMoney.json.onItsWay === 145.5 && farMoney.json.made === 195.5 && farMoney.json.paidOut === 195.5, JSON.stringify(farMoney.json).slice(0, 240));
  const farStats = await farMoneyC("GET", "/api/me/stats");
  check("money page agrees with the Stats page (one set of numbers)", farStats.json && farStats.json.stats && farStats.json.stats.money.held.total === farMoney.json.onItsWay && farStats.json.stats.money.released.total === farMoney.json.made && farStats.json.stats.money.paidOut === farMoney.json.paidOut, JSON.stringify(farStats.json && farStats.json.stats && farStats.json.stats.money).slice(0, 200));
  check("money page: far creator's one next action is add a channel", farMoney.json.next && farMoney.json.next.key === "channel", JSON.stringify(farMoney.json.next));
  check("money page: exactly one next action (set the paid rate)", money.json.next && money.json.next.key === "rate" && !!money.json.next.title, JSON.stringify(money.json.next));
  check("money page: founding line state (marketLive=false)", money.json.marketLive === false);

  // Maggie's sweep runs fire-and-forget off ordinary traffic:
  // poll the creator's pitches until the pass lands.
  let pitches = null;
  for (let i = 0; i < 24 && !pitches; i++) {
    await biz("GET", "/api/block").catch(() => {});
    const pm = await cr("GET", "/api/me/pitches");
    if (pm.json && (pm.json.pitches || []).length) pitches = pm.json;
    else await sleepMs(500);
  }
  check("Maggie pitched the near creator to the business", !!pitches && pitches.thisWeek >= 1, pitches ? `${pitches.thisWeek}` : "none");
  const pitch = pitches && pitches.pitches[0];
  check("pitch text carries the real facts (900 followers, Nashville)", !!pitch && /900/.test(pitch.text) && /Nashville/.test(pitch.text), pitch ? pitch.text.slice(0, 160) : "");
  check("pitch names the business to the creator", !!pitch && /Maggie pitched you to .+: 900 of your followers are in Nashville/.test(pitch.text), pitch ? pitch.text.slice(0, 160) : "");
  const farC = client();
  await login(farC, "far@fixtures.dev");
  const farPitches = await farC("GET", "/api/me/pitches");
  check("privacy wall: the far creator never sees the near creator's pitch", !(farPitches.json.pitches || []).some((p) => p.id === (pitch && pitch.id)));
  const dbNow = JSON.parse(fs.readFileSync(DB, "utf8"));
  check("the sweep never pitches for the tester business (M2)", !Object.entries(dbNow).some(([k, v]) => k.startsWith("pitch:") && v && v.businessId === "biztest213"));
  if (pitch) {
    const sv = await cr("POST", `/api/me/pitches/${pitch.id}`, { action: "save" });
    check("pitch save answers ok", sv.status === 200 && sv.json.ok === true, `${sv.status}`);
    const after = await cr("GET", "/api/me/pitches");
    check("saved pitch reads back saved", (after.json.pitches || []).some((p) => p.id === pitch.id && p.saved === true));
    const dm = await cr("POST", `/api/me/pitches/${pitch.id}`, { action: "dismiss" });
    check("pitch dismiss answers ok", dm.status === 200, `${dm.status}`);
    const afterDm = await cr("GET", "/api/me/pitches");
    check("dismissed pitch leaves the list", !(afterDm.json.pitches || []).some((p) => p.id === pitch.id));
  }

  const adm = client();
  await login(adm, "admin@fixtures.dev");
  const apps = await adm("GET", "/api/admin/applications");
  const bekah = [...(apps.json.pending || []), ...(apps.json.decided || [])].find((x) => x.id === "crbekah213");
  check("F0 payload: admin applications carry the stacked total (3,367, not 234)", !!bekah && bekah.creator && (bekah.creator.totalAudience === 3367 || (bekah.creator.audienceStack && Object.values(bekah.creator.audienceStack).reduce((s, v) => s + v, 0) === 3367)), bekah ? JSON.stringify(bekah.creator).slice(0, 200) : "missing");
  server.kill("SIGKILL");
  await sleepMs(400);

  console.log("== behavior: live phase (market live, active business) ==");
  // Flip Nashville live in the same store, restart, and book as
  // the ACTIVE business: the founding law no longer applies.
  const dbLive = JSON.parse(fs.readFileSync(DB, "utf8"));
  dbLive["config:markets"] = { flags: { Nashville: true } };
  fs.writeFileSync(DB, JSON.stringify(dbLive));
  server = await boot();
  const bizL = client();
  const ll = await login(bizL, "bizlive@fixtures.dev");
  check("active business sign-in", ll.status === 200, `${ll.status}`);
  const gb2 = await bizL("GET", "/api/block");
  check("live state reads live (marketLive=true, founding=false)", gb2.json.marketLive === true && gb2.json.founding === false, JSON.stringify({ ml: gb2.json.marketLive, f: gb2.json.founding }));
  const book2 = await bizL("POST", "/api/block/book", { creatorIds: ["crnear213"], kind: "comp", title: "Live weekend tasting", whatComped: "Dinner for two", dollarCap: 75 });
  check("live booking sends an OPEN invite", book2.status === 201 && (book2.json.results || []).some((r) => r.status === "open") && book2.json.block.sent === 1, JSON.stringify(book2.json).slice(0, 200));
  const db2 = JSON.parse(fs.readFileSync(DB, "utf8"));
  const notif2 = Object.entries(db2).filter(([k, v]) => k.startsWith("note:") && v && v.userId === "crnear213" && v.kind === "offer_received");
  check("open invite notifies the creator", notif2.length >= 1, `${notif2.length}`);
  const book3 = await bizL("POST", "/api/block/book", { creatorIds: ["crnear213"], kind: "comp", title: "Live weekend tasting", whatComped: "Dinner for two", dollarCap: 75 });
  check("an identical open bundle invite is skipped, never duplicated", book3.status === 201 && (book3.json.results || []).some((r) => r.status === "skipped"), JSON.stringify(book3.json).slice(0, 200));
  server.kill("SIGKILL");
} catch (e) {
  check(`suite error: ${e && e.message}`, false);
} finally {
  console.log(`\nverify-build214-features: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
