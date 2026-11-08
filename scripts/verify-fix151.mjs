// Build -151 proof suite — the six health-report defects, each
// proven against the real handler on a seeded store:
//
// 1. Profile completion: /admin/applications rows carry the
//    canonical profileCompleteOf value (the stored cache flag
//    is seeded WRONG both ways on purpose), and the payload's
//    own summary agrees with the rows creator-by-creator.
// 2. Suggestions: the GET payload is aggregate-memoized — a
//    repeat read costs a small fraction of the build — and the
//    client carries the timeout/retry + tester-fenced Revenue
//    definition (source-wired, behavior in rendered QA).
// 3. "V" business: a business whose stored name is a fragment
//    renders on the creator board under a category/market
//    label, never the bare letter; one-letter names are
//    refused at sign-up.
// 4. Preview Wallet: the preview dashboard payload carries
//    everything the Wallet renders (plan, paid-lane budget,
//    receipt numbers) and the client wires the Wallet step.
// 5. Handles: normalizeHandle unit cases (share-link query
//    tails, fragments, full URLs, bare "@"), the register
//    write path (share link refused in plain words; a pasted
//    profile URL stored clean), and the sweep-context repair
//    (dry-run writes nothing; the run repairs only what the
//    record itself proves, is idempotent, deletes nobody).
// 6. Partners seats + Social: a demo partner org (excluded
//    from the money books on purpose) still serves its detail
//    + team seats instead of "Partner not found"; the Social
//    payload serves all three channels from the one metric
//    source and the client names the empty state honestly.
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (cond, label, extra = "") => { if (cond) { passed += 1; console.log("  PASS", label); } else { failed += 1; console.log("  FAIL", label, extra); } };

// ---------- seed ----------
const dir = fs.mkdtempSync("/tmp/signl-verify151-");
const DB = path.join(dir, "db.json");
const PW = "verify-151-pass", SALT = "verify151salt";
const HASH = crypto.scryptSync(PW, SALT, 64).toString("hex");
const T0 = "2026-11-05T00:00:00.000Z";
function creatorSeed(id, email, name, creator, extra = {}) {
  return {
    id, role: "creator", email, name, passwordHash: HASH, passwordSalt: SALT,
    status: "approved", market: "Nashville", city: "Nashville", state: "TN",
    createdAt: T0, updatedAt: T0, tester: false, termsVersion: "2026-10", termsAcceptedAt: T0,
    creator, business: null, partner: null, ...extra,
  };
}
const completeCreator = { handle: "goodcreator", primaryPlatform: "instagram", categories: ["Food & Drink"], audienceStack: { instagram: 9000 }, followerCount: 9000, totalAudience: 9000, localAudiencePct: 75, profileComplete: false /* stale cache: computed truth is TRUE */ };
const db = {};
db["config:markets"] = { flags: { Nashville: true, "Virginia Beach": true } };
db["user:admin1"] = { id: "admin1", role: "admin", email: "jeff@joinsignl.com", name: "Jeff Rimmer", status: "approved", createdAt: T0, updatedAt: T0, passwordHash: HASH, passwordSalt: SALT };
db["email:jeff@joinsignl.com"] = { userId: "admin1" };
db["session:verify-token"] = { userId: "admin1", createdAt: T0, expiresAt: "2027-01-01T00:00:00.000Z" };
db["session:creator-token"] = { userId: "crgood", createdAt: T0, expiresAt: "2027-01-01T00:00:00.000Z" };

db["user:crgood"] = creatorSeed("crgood", "good@fixtures.dev", "Good Creator", { ...completeCreator });
db["email:good@fixtures.dev"] = { userId: "crgood" };
// Incomplete (no categories), stored cache says complete — the
// payload must still say NOT finished.
db["user:crhalf"] = creatorSeed("crhalf", "half@fixtures.dev", "Half Done", { handle: "halfcreator", primaryPlatform: "instagram", categories: [], audienceStack: { instagram: 3000 }, followerCount: 3000, totalAudience: 3000, localAudiencePct: 40, profileComplete: true /* stale cache: computed truth is FALSE */ });
db["email:half@fixtures.dev"] = { userId: "crhalf" };
// Repair fixtures: the four production shapes.
db["user:crjulie"] = creatorSeed("crjulie", "julie@fixtures.dev", "Julie Rochefort", { handle: "https://www.instagram.com/jewls1082/", primaryPlatform: "instagram", instagramUrl: "https://instagram.com/https://www.instagram.com/jewls1082/", primaryProfileUrl: "https://instagram.com/https://www.instagram.com/jewls1082/", categories: ["Food & Drink"], audienceStack: { instagram: 5000 }, followerCount: 5000, totalAudience: 5000, localAudiencePct: 60 });
db["email:julie@fixtures.dev"] = { userId: "crjulie" };
db["user:crbig"] = creatorSeed("crbig", "big@fixtures.dev", "Big Creator", { handle: "_r=1&_t=ZT-9B3OKX5mPWw", primaryPlatform: "tiktok", tiktokHandle: "_r=1&_t=ZT-9B3OKX5mPWw", tiktokUrl: "https://www.tiktok.com/@_r=1&_t=ZT-9B3OKX5mPWw", primaryProfileUrl: "https://www.tiktok.com/@_r=1&_t=ZT-9B3OKX5mPWw", platformLinks: { tiktok: { url: "https://www.tiktok.com/@realbigcreator" } }, categories: ["Fitness"], audienceStack: { tiktok: 2249000 }, followerCount: 0, totalAudience: 2249000, localAudiencePct: 100 });
db["email:big@fixtures.dev"] = { userId: "crbig" };
db["user:crfrag"] = creatorSeed("crfrag", "jonah@fixtures.dev", "Jonah Phillips", { handle: "exln=MXIxcXZvZjNvNmRmdg==", primaryPlatform: "tiktok", tiktokHandle: "exln=MXIxcXZvZjNvNmRmdg==", tiktokUrl: "https://www.tiktok.com/@exln=MXIxcXZvZjNvNmRmdg==", primaryProfileUrl: "https://www.tiktok.com/@exln=MXIxcXZvZjNvNmRmdg==", categories: ["Music"], audienceStack: { tiktok: 4000 }, followerCount: 0, totalAudience: 4000, localAudiencePct: 55 });
db["email:jonah@fixtures.dev"] = { userId: "crfrag" };
db["user:crcandy"] = creatorSeed("crcandy", "candy@fixtures.dev", "Candy Bee", { handle: "@", primaryPlatform: "instagram", instagramUrl: "https://instagram.com/mccandybee", primaryProfileUrl: "https://instagram.com/@", categories: ["Beauty"], audienceStack: { instagram: 2500 }, followerCount: 2500, totalAudience: 2500, localAudiencePct: 70 });
db["email:candy@fixtures.dev"] = { userId: "crcandy" };

// Businesses: the fragment record, a real plan business, a tester.
function bizSeed(id, email, name, business, extra = {}) {
  return { id, role: "business", email, name, passwordHash: HASH, passwordSalt: SALT, status: "approved", market: "Nashville", city: "Nashville", createdAt: T0, updatedAt: T0, tester: false, creator: null, partner: null, business, ...extra };
}
db["user:bizv"] = bizSeed("bizv", "v@fixtures.dev", "V Person", { businessName: "V", category: "Food & Drink", plan: "self-service" });
db["email:v@fixtures.dev"] = { userId: "bizv" };
db["user:bizreal"] = bizSeed("bizreal", "chelsea@fixtures.dev", "Chelsea Friday", { businessName: "Chelsea Friday Furniture", category: "Other", plan: "growth" });
db["email:chelsea@fixtures.dev"] = { userId: "bizreal" };
db["user:biztester"] = bizSeed("biztester", "saltline@fixtures.dev", "Salt Line", { businessName: "Salt Line Test Kitchen", category: "Food & Drink", plan: "managed" }, { tester: true });
db["email:saltline@fixtures.dev"] = { userId: "biztester" };
db["offer:offv"] = { id: "offv", businessId: "bizv", businessName: "V", market: "Nashville", category: "Food & Drink", title: "Dinner for two, on us", kind: "comp", whatComped: "Dinner for two", covers: 2, dollarCap: 500, spots: 2, status: "open", createdAt: "2026-11-01T00:00:00.000Z", windowStartAt: "2026-11-06T00:00:00.000Z", windowEndAt: "2026-11-20T00:00:00.000Z", applicationsCloseAt: "2026-11-15T00:00:00.000Z" };

// Demo partner org + one team seat.
db["user:partnerdemo"] = { id: "partnerdemo", role: "partner", email: "demo@fixtures.dev", name: "Demo Partner", passwordHash: HASH, passwordSalt: SALT, status: "approved", market: "Virginia Beach", createdAt: T0, updatedAt: T0, tester: false, creator: null, business: null, partner: { name: "Demo Media Group", type: "media", code: "demo", markets: ["Virginia Beach"], sharePct: 60, status: "active", agreementStatus: "unsigned", demo: true } };
db["email:demo@fixtures.dev"] = { userId: "partnerdemo" };
db["user:seat1"] = { id: "seat1", role: "partner", email: "seat@fixtures.dev", name: "Seat Person", passwordHash: HASH, passwordSalt: SALT, status: "approved", createdAt: T0, updatedAt: T0, creator: null, business: null, partner: { teamOf: "partnerdemo", name: "Seat Person" } };
db["email:seat@fixtures.dev"] = { userId: "seat1" };
fs.writeFileSync(DB, JSON.stringify(db));

// ---------- boot ----------
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = PW;
process.env.SIGNL_SWEEP_TOKEN = "proof-sweep-token";
for (const k of ["SIG_AI_BASE_URL", "SIG_AI_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MAGGIE_AI_ENABLED", "MAGGIE_AI_MODEL"]) process.env[k] = "";
const store = require("../netlify/functions/lib/store.js");
const counts = { get: 0, getManyKeys: 0, listValues: 0 };
const origGet = store.get.bind(store), origGetMany = store.getMany.bind(store), origList = store.list.bind(store);
store.get = async (k) => { counts.get += 1; return origGet(k); };
store.getMany = async (ks) => { counts.getManyKeys += ks.length; return origGetMany(ks); };
store.list = async (p) => { const rows = await origList(p); counts.listValues += rows.length; return rows; };
const fetches = () => counts.get + counts.getManyKeys + counts.listValues;
const resetCounts = () => { counts.get = 0; counts.getManyKeys = 0; counts.listValues = 0; };
const router = require("../netlify/functions/lib/router.js");
const { handler } = require("../netlify/functions/api.js");

async function call(method, p, { cookie = "verify-token", token = false, body = null } = {}) {
  const [pathname, qs] = p.split("?");
  const queryStringParameters = {};
  if (qs) for (const pair of qs.split("&")) { const i = pair.indexOf("="); queryStringParameters[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1)); }
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = `signl_session=${cookie}`;
  if (token) headers["x-signl-sweep-token"] = "proof-sweep-token";
  const out = await handler({ httpMethod: method, path: pathname, headers, queryStringParameters, body: body ? JSON.stringify(body) : null, isBase64Encoded: false });
  let data = null;
  try { data = JSON.parse(out.body); } catch { /* downloads etc. */ }
  return { status: out.statusCode, data };
}
const readDb = () => JSON.parse(fs.readFileSync(DB, "utf8"));
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");

console.log("verify-fix151: six health-report defects");

// ---------- 5a. normalizeHandle unit cases ----------
const nh = router.normalizeHandle;
ok(nh("https://www.tiktok.com/@someuser?_r=1&_t=ZT-9B3OKX5mPWw") === "someuser", "nh: TikTok URL with share query yields the handle", nh("https://www.tiktok.com/@someuser?_r=1&_t=ZT-9B3OKX5mPWw"));
ok(nh("_r=1&_t=ZT-9B3OKX5mPWw") === "", "nh: bare query tail is no handle");
ok(nh("exln=MXIxcXZvZjNvNmRmdg==") === "", "nh: share fragment is no handle");
ok(nh("@") === "", "nh: bare @ is no handle");
ok(nh("https://www.instagram.com/jewls1082/") === "jewls1082", "nh: full Instagram URL yields the handle");
ok(nh("instagram.com/foo.bar") === "foo.bar", "nh: bare-domain URL yields the handle");
ok(nh("@plainhandle") === "plainhandle", "nh: @handle passes through");
ok(nh("plainhandle") === "plainhandle", "nh: bare handle passes through");
ok(nh("https://www.linkedin.com/in/jane-doe/") === "jane-doe", "nh: LinkedIn /in/ yields the handle");
ok(nh("https://x.com/SomeUser/status/123456789") === "SomeUser", "nh: X post URL yields the handle, not the post id");
ok(nh("https://www.tiktok.com/@user.name/video/7300000000000000000") === "user.name", "nh: TikTok video URL yields the handle, not the video id");

// ---------- 1. completion agreement ----------
const apps = await call("GET", "/api/admin/applications");
ok(apps.status === 200, "applications payload loads", `status ${apps.status}`);
const rows = [...(apps.data.pending || []), ...(apps.data.decided || [])];
const raw = readDb();
let agree = 0, agreeN = 0;
for (const row of rows) {
  if (row.role !== "creator") continue;
  agreeN += 1;
  const truth = router.profileCompleteOf(raw[`user:${row.id}`]);
  if (row.profileComplete === truth && row.creator && row.creator.profileComplete === truth) agree += 1;
}
ok(agreeN >= 6 && agree === agreeN, `every creator row's profileComplete equals the canonical computation (${agree}/${agreeN})`);
const rowGood = rows.find((r) => r.id === "crgood");
const rowHalf = rows.find((r) => r.id === "crhalf");
ok(rowGood && rowGood.profileComplete === true, "stale-false cache: complete creator reads complete");
ok(rowHalf && rowHalf.profileComplete === false, "stale-true cache: incomplete creator reads not finished");
const sumAll = apps.data.summary && apps.data.summary.all;
const rowCount = rows.filter((r) => r.role === "creator" && r.status === "approved" && !r.tester && r.profileComplete).length;
ok(sumAll && sumAll.approvedComplete === rowCount, `summary approvedComplete (${sumAll && sumAll.approvedComplete}) equals the row-by-row count (${rowCount})`);
// search serializer carries the same stamp
const search = await call("GET", "/api/admin/users/search?q=goodcreator");
const sRow = (search.data.users || []).find((u) => u.id === "crgood");
ok(sRow && sRow.profileComplete === true, "users/search rows carry the same canonical stamp");

// ---------- 2. suggestions memo + revenue definition (client wiring) ----------
const sug1 = await call("GET", "/api/admin/suggestions");
ok(sug1.status === 200 && Array.isArray(sug1.data.suggestions), "suggestions payload returns");
// Force a cold rebuild: any store write invalidates the memo
// (a direct write here stands in for a dismiss landing).
await store.set("config:memo-bump-151", { at: new Date().toISOString() });
resetCounts();
const sugCold = await call("GET", "/api/admin/suggestions");
const buildCost = fetches();
resetCounts();
const sug2 = await call("GET", "/api/admin/suggestions");
const memoCost = fetches();
ok(sugCold.status === 200, "cold suggestions rebuild returns");
ok(buildCost > 100 && memoCost < buildCost / 3, `repeat suggestions read is memoized (cold build ${buildCost} fetches, repeat ${memoCost})`);
ok(JSON.stringify((sug2.data.suggestions || []).map((s) => s.id)) === JSON.stringify((sug1.data.suggestions || []).map((s) => s.id)), "memoized payload is the same board");
ok(appJs.includes('new Promise((_, reject) => setTimeout(() => reject(new Error("Suggestions took too long to load."))'), "client: suggestions load has a timeout");
ok(appJs.includes("Try again</button>") && appJs.includes("astLoadSuggestions(); return false"), "client: suggestions failure is a named, retryable state");
ok(appJs.includes('businesses: rows.filter((u) => u.role === "business" && !u.tester)'), "client: Stats businesses carry the tester fence");
ok(appJs.includes('if (!id || !planRate(id)) continue;'), "client: Revenue counts only plans that resolve in the book");
const bizRows = rows.filter((r) => r.role === "business");
ok(bizRows.find((r) => r.id === "biztester").tester === true && bizRows.find((r) => r.id === "bizreal").tester !== true, "applications rows expose the tester flag the fence reads");

// ---------- 3. the "V" business ----------
const board = await call("GET", "/api/open-offers", { cookie: "creator-token" });
ok(board.status === 200, "creator board loads", `status ${board.status} ${JSON.stringify(board.data).slice(0, 120)}`);
const vOffer = (board.data.offers || []).find((o) => o.id === "offv");
ok(!!vOffer, "the fragment business's offer is on the board");
ok(vOffer && vOffer.businessName !== "V" && vOffer.businessName === "Food & Drink business in Nashville", `fragment name renders as a category/market label (got "${vOffer && vOffer.businessName}")`);
ok(router.displayBusinessName({ businessName: "V", category: "Food & Drink", market: "Nashville" }, null) === "Food & Drink business in Nashville", "displayBusinessName: fragment falls back to the label");
ok(router.displayBusinessName({ businessName: "Old Name" }, { business: { businessName: "New Name" } }) === "New Name", "displayBusinessName: the live record name wins over the stamped one");
const badBiz = await call("POST", "/api/auth/register", { cookie: null, body: { role: "business", email: "newbiz@fixtures.dev", password: "longenoughpw", name: "New Biz", businessName: "V", market: "Nashville", city: "Nashville", agreedTerms: true } });
ok(badBiz.status === 400 && /real name/.test(badBiz.data.error || ""), "sign-up refuses a one-letter business name in plain words", `${badBiz.status} ${badBiz.data && badBiz.data.error}`);

// ---------- 4. preview wallet ----------
const prev = await call("GET", "/api/admin/preview/dashboard");
ok(prev.status === 200 && prev.data.dashboard, "preview dashboard payload loads");
const pd = prev.data.dashboard || {};
ok(pd.plan && pd.plan.name && typeof pd.plan.priceMonthly === "number", "wallet Plan segment has its plan state");
ok(pd.managedView && pd.managedView.budget && pd.managedView.budget.paidBookings.length > 0, "wallet Bookings segment has paid-lane escrow state");
ok(pd.summary && pd.summary.roas && typeof pd.summary.roas.registerValue === "number", "wallet Receipts segment has the cycle's receipt numbers");
ok(appJs.includes('navBtn("wallet", "Wallet")'), "client: preview nav carries Wallet");
ok(appJs.includes("function previewWalletHtml(d)"), "client: the Wallet step renders");
ok(appJs.includes('pv.step === "wallet"'), "client: the Wallet step is routed");

// ---------- 5b. register write path ----------
const claim = await call("POST", "/api/auth/register", { cookie: null, body: { role: "creator", quickClaim: true, email: "claim@fixtures.dev", password: "longenoughpw", handle: "https://www.tiktok.com/@sharejunk?_r=1&_t=ZT-9B3OKX5mPWw", primaryPlatform: "tiktok", market: "Nashville", agreedTerms: true } });
ok(claim.status === 201 || (claim.data && claim.data.user), "claim from a pasted profile URL succeeds", `${claim.status} ${JSON.stringify(claim.data).slice(0, 160)}`);
const afterClaim = readDb();
const claimUser = Object.values(afterClaim).find((u) => u && u.email === "claim@fixtures.dev");
ok(claimUser && claimUser.creator && claimUser.creator.handle === "sharejunk", `claim stored the extracted handle (got "${claimUser && claimUser.creator && claimUser.creator.handle}")`);
const claimBad = await call("POST", "/api/auth/register", { cookie: null, body: { role: "creator", quickClaim: true, email: "claimbad@fixtures.dev", password: "longenoughpw", handle: "_r=1&_t=ZT-9B3OKX5mPWw", primaryPlatform: "tiktok", market: "Nashville", agreedTerms: true } });
ok(claimBad.status === 400 && /share link/.test(claimBad.data.error || ""), "claim from a bare share tail is refused in plain words", `${claimBad.status} ${claimBad.data && claimBad.data.error}`);

// ---------- 5c. the repair ----------
const dry = await call("POST", "/api/admin/repairs/handles", { cookie: null, token: true, body: { dryRun: true } });
ok(dry.status === 200 && dry.data.repair, "repair dry-run answers under sweep auth", `status ${dry.status}`);
const dryRep = dry.data.repair || { changed: [], unrecoverable: [] };
const dryMap = Object.fromEntries(dryRep.changed.map((c) => [c.userId, c]));
ok(dryMap.crjulie && dryMap.crjulie.after === "jewls1082" && dryMap.crjulie.before === "https://www.instagram.com/jewls1082/", "dry-run: Julie's URL handle recovers to jewls1082");
ok(dryMap.crbig && dryMap.crbig.after === "realbigcreator", "dry-run: the query-tail record recovers from its own platform link");
ok(dryMap.crcandy && dryMap.crcandy.after === "mccandybee", "dry-run: the bare-@ record recovers from its Instagram URL");
ok(dryRep.unrecoverable.some((u) => u.userId === "crfrag"), "dry-run: the fragment with no usable link is reported, not guessed");
const dryDb = readDb();
ok(dryDb["user:crjulie"].creator.handle === "https://www.instagram.com/jewls1082/", "dry-run wrote nothing");
const run = await call("POST", "/api/admin/repairs/handles", { cookie: null, token: true, body: {} });
ok(run.status === 200 && run.data.repair && run.data.repair.changed.length === 3, `repair run fixes exactly the recoverable three (got ${run.data && run.data.repair && run.data.repair.changed.length})`);
const runDb = readDb();
ok(runDb["user:crjulie"].creator.handle === "jewls1082" && runDb["user:crjulie"].creator.instagramUrl === "https://instagram.com/jewls1082", "Julie's record repaired, URL rebuilt clean");
ok(runDb["user:crbig"].creator.handle === "realbigcreator" && runDb["user:crbig"].creator.tiktokHandle === "realbigcreator", "the 2.2M record repaired from its own link");
ok(runDb["user:crfrag"].creator.handle === "exln=MXIxcXZvZjNvNmRmdg==", "the unrecoverable record is byte-identical (never guessed, never deleted)");
ok(runDb["config:handleRepair151"] && runDb["config:handleRepair151"].changed.length === 3, "the before/after audit is stored");
const again = await call("POST", "/api/admin/repairs/handles", { cookie: null, token: true, body: {} });
ok(again.data.repair.changed.length === 0 && again.data.repair.unrecoverable.length === 1, "repair is idempotent: second run changes nothing");
const noAuth = await call("POST", "/api/admin/repairs/handles", { cookie: null, body: {} });
ok(noAuth.status === 401 || noAuth.status === 403, "repair refuses anonymous callers", `status ${noAuth.status}`);

// ---------- 6a. partner seats ----------
const detail = await call("GET", "/api/admin/command/partners/partnerdemo?period=2026-11");
ok(detail.status === 200, "demo partner detail loads (was 404 Partner not found)", `status ${detail.status} ${detail.data && detail.data.error}`);
ok(detail.data && detail.data.excludedFromBooks === true && detail.data.deals.length === 0, "demo detail is identity-only: no deals, no money");
ok(detail.data && detail.data.team && detail.data.team.seats.some((s) => s.seatId === "seat1"), "team seats load for the demo org");
const ghost = await call("GET", "/api/admin/command/partners/nosuchpartner?period=2026-11");
ok(ghost.status === 404, "a genuinely unknown partner still 404s");

// ---------- 6b. social ----------
const social = await call("GET", "/api/admin/social");
ok(social.status === 200 && Array.isArray(social.data.channels), "social payload loads");
const chans = Object.fromEntries((social.data.channels || []).map((c) => [c.platform, c]));
ok(chans.instagram && chans.facebook && chans.linkedin, "all three channels ride the one payload");
ok(Array.isArray(chans.facebook.series) && Array.isArray(chans.linkedin.series), "Facebook/LinkedIn read the same metric series as Instagram");
ok(appJs.includes("no count on file yet"), "client: an uncounted channel says so instead of a bare dash");

console.log(`\nverify-fix151: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
