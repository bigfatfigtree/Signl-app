// Prompting Systems (Build -148; spec 2026-11-08 §6 + §7):
// Maggie's proactive business campaign prompts + the creator
// success coaching ladder + Admin visibility.
//
// Boots the fixture server with the Maggie AI flag OFF and
// proves, reading the local store file back:
//   - campaign prompt triggers: new_business fires (approved
//     >= 3 days, zero offers), starving_offer fires against the
//     market median, founding businesses get nothing, a waiting
//     decision suppresses, and < 2 qualifying creators in a
//     market suppresses (never pad);
//   - campaign_prompt_shown fires exactly once per prompt;
//     re-reads return the same card;
//   - "Show me others" re-runs one band down with new creators;
//   - dismiss snoozes the family 30 days; two consecutive
//     dismissals silence prompting 14 days; two prompts in a
//     week hit the weekly cap;
//   - promptId threading: act "use" -> POST /deals with
//     sourceBrief.promptId -> creator accepts -> the materialized
//     offer carries it, the prompt record closes as used with the
//     offer id, and campaign_prompt_used fires at both stages;
//     the same threading through POST /offers directly;
//   - the coaching ladder in spec order (market -> platform ->
//     local -> rate -> categories -> first post), completion
//     detected from the creator's own record change (typed-city
//     resolution after a profile PATCH), the 3-day snooze, and
//     graduation (ladder complete + delivered booking = silence);
//   - the evidence gate: below the cell minimum the rate step's
//     why-line cites NO statistic; above it (seeded impression ->
//     pick history) the why-line carries the real ratio;
//   - Admin: /admin/stats/data carries the prompting rollup and
//     the campaign_prompts export answers;
//   - auth: signed-out 401s, cross-role 403s.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = fs.mkdtempSync("/tmp/signl-prompting-") + "/db.json";
const SEED_PW = "verify-prompting-pass";
const SEED_SALT = "verify985prompting";
const SEED_HASH = crypto.scryptSync(SEED_PW, SEED_SALT, 64).toString("hex");
const TODAY = new Date().toISOString().slice(0, 10);
const NOW_ISO = new Date().toISOString();
const daysAgoIso = (d) => new Date(Date.now() - d * 86400000).toISOString();

function creatorSeed(id, email, name, handle, market, opts = {}) {
  const cats = opts.categories || ["Food & Drink"];
  return {
    id, role: "creator", email, name, passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: opts.status || "approved", market, city: opts.city === undefined ? market : opts.city, state: opts.state || "TN",
    createdAt: opts.createdAt || "2026-09-02T00:00:00.000Z", updatedAt: opts.updatedAt || "2026-09-02T00:00:00.000Z", tester: false,
    ...(opts.approvedAt ? { approvedAt: opts.approvedAt } : {}),
    creator: { handle, platform: "Instagram", handleNormalized: handle, city: opts.city === undefined ? market : opts.city, state: opts.state || "TN", categories: cats, compCategories: ["Restaurant meals"], tierBand: "Locals", audienceStack: opts.stack || { instagram: opts.total || 9000 }, totalAudience: opts.total || 9000, followerCount: opts.total || 9000, localAudiencePct: opts.localPct === undefined ? 75 : opts.localPct, paidRate: opts.rate === undefined ? 150 : opts.rate, compOpen: true, couponOpen: true, profileComplete: true, publicPage: true, bio: `${name} posts daily about local spots and good food.` , bestWork: opts.bestWork || [], hasPhoto: true },
  };
}
function bizSeed(id, email, name, bizName, market, opts = {}) {
  return {
    id, role: "business", email, name, passwordHash: SEED_HASH, passwordSalt: SEED_SALT,
    status: opts.status || "approved", market, city: market, createdAt: opts.createdAt || "2026-09-01T00:00:00.000Z", updatedAt: opts.updatedAt || "2026-09-01T00:00:00.000Z", tester: false, businessOnboarded: true,
    ...(opts.approvedAt ? { approvedAt: opts.approvedAt } : {}),
    business: { businessName: bizName, legalName: `${bizName} LLC`, category: opts.category || "Restaurant", plan: "growth", planId: "growth", ...(opts.founding ? {} : { accessState: "active" }), about: opts.about === undefined ? "Seeded business." : opts.about },
  };
}
{
  const seed = {};
  seed["config:markets"] = { flags: { Nashville: true, Austin: true } };
  seed["config:recruiterKitEmailV1Sent"] = { version: 1, claimedAt: "2026-10-20T00:00:00.000Z", completedAt: "2026-10-20T00:00:00.000Z", recipients: [] };
  const put = (u) => { seed[`user:${u.id}`] = u; seed[`email:${u.email}`] = { userId: u.id }; };
  // Nashville Food & Drink roster (six, so bands have depth).
  put(creatorSeed("crA", "a@fixtures.dev", "Ana Alvarez", "anaeats", "Nashville", { localPct: 90, total: 20000, rate: 100, bestWork: ["https://instagram.com/p/1"] }));
  put(creatorSeed("crB", "b@fixtures.dev", "Ben Baker", "benbites", "Nashville", { localPct: 80, total: 9000, rate: 200, bestWork: ["https://instagram.com/p/2"] }));
  put(creatorSeed("crC", "c@fixtures.dev", "Cleo Chen", "cleocooks", "Nashville", { localPct: 70, total: 5000, rate: 300, bestWork: ["https://instagram.com/p/3"] }));
  put(creatorSeed("crD", "d@fixtures.dev", "Dee Dawson", "deedishes", "Nashville", { localPct: 85, total: 8000, rate: null, bestWork: ["https://instagram.com/p/4"] }));
  put(creatorSeed("crE", "e@fixtures.dev", "Eli Evans", "elieats", "Nashville", { localPct: 60, total: 6000, rate: 250, bestWork: ["https://instagram.com/p/5"] }));
  put(creatorSeed("crF", "f@fixtures.dev", "Fay Fox", "fayfeasts", "Nashville", { localPct: 40, total: 4000, rate: 175, bestWork: ["https://instagram.com/p/6"] }));
  put(creatorSeed("crNew", "new@fixtures.dev", "Nia New", "nianew", "Nashville", { localPct: 95, total: 30000, rate: 150, approvedAt: daysAgoIso(1), bestWork: ["https://instagram.com/p/7"] }));
  // Austin: exactly one qualifying creator (suppression proof).
  put(creatorSeed("crAustin1", "atx1@fixtures.dev", "Austin One", "atxone", "Austin", { localPct: 88, total: 7000, rate: 150, bestWork: ["https://instagram.com/p/8"] }));
  // Coaching fixtures.
  put(creatorSeed("crLadder", "ladder@fixtures.dev", "Larry Ladder", "larryladder", "Not listed yet", { city: "", stack: { instagram: 9000 }, total: 9000, localPct: null, rate: null, categories: ["Food & Drink"], bestWork: [] }));
  put(creatorSeed("crRateBelow", "ratebelow@fixtures.dev", "Rita Below", "ritabelow", "Denver", { stack: { instagram: 5000, tiktok: 3000, youtube: 2000 }, total: 10000, localPct: 65, rate: null, categories: ["Food & Drink", "Nightlife"], bestWork: ["https://instagram.com/p/9"] }));
  put(creatorSeed("crRateAbove", "rateabove@fixtures.dev", "Rita Above", "ritaabove", "Nashville", { stack: { instagram: 5000, tiktok: 3000, youtube: 2000 }, total: 10000, localPct: 65, rate: null, categories: ["Food & Drink", "Nightlife"], bestWork: ["https://instagram.com/p/10"] }));
  put(creatorSeed("crGrad", "grad@fixtures.dev", "Gail Grad", "gailgrad", "Nashville", { stack: { instagram: 5000, tiktok: 3000, youtube: 2000 }, total: 10000, localPct: 70, rate: 200, categories: ["Food & Drink", "Nightlife"], bestWork: ["https://instagram.com/p/11"] }));
  // Businesses.
  put(bizSeed("bizNew", "biznew@fixtures.dev", "New Owner", "New Kitchen", "Nashville", { createdAt: daysAgoIso(10), approvedAt: daysAgoIso(10) }));
  put(bizSeed("bizDismiss", "bizdismiss@fixtures.dev", "Dee Owner", "Dismiss Diner", "Nashville", { createdAt: daysAgoIso(10), approvedAt: daysAgoIso(10) }));
  put(bizSeed("bizStarve", "bizstarve@fixtures.dev", "Stu Owner", "Starve Steakhouse", "Nashville", { createdAt: daysAgoIso(30), approvedAt: daysAgoIso(30) }));
  put(bizSeed("bizOther", "bizother@fixtures.dev", "Ollie Owner", "Other Eatery", "Nashville", { createdAt: daysAgoIso(30), approvedAt: daysAgoIso(30) }));
  put(bizSeed("bizWait", "bizwait@fixtures.dev", "Walt Owner", "Waiting Wok", "Nashville", { createdAt: daysAgoIso(10), approvedAt: daysAgoIso(10) }));
  put(bizSeed("bizSparse", "bizsparse@fixtures.dev", "Sue Owner", "Sparse Spoon", "Austin", { createdAt: daysAgoIso(10), approvedAt: daysAgoIso(10) }));
  put(bizSeed("bizFounding", "bizfounding@fixtures.dev", "Fran Owner", "Founding Fork", "Nashville", { founding: true, createdAt: daysAgoIso(10), approvedAt: daysAgoIso(10) }));
  put(bizSeed("bizEvidence", "bizevidence@fixtures.dev", "Eve Owner", "Evidence Eats", "Nashville", { createdAt: daysAgoIso(40), approvedAt: daysAgoIso(40) }));
  put(bizSeed("bizCap", "bizcap@fixtures.dev", "Cap Owner", "Cap Cafe", "Nashville", { createdAt: daysAgoIso(10), approvedAt: daysAgoIso(10) }));
  // Offers + applications for the starving / waiting fixtures.
  seed["offer:offStarve"] = { id: "offStarve", businessId: "bizStarve", businessName: "Starve Steakhouse", market: "Nashville", category: "Restaurant", kind: "comp", title: "Quiet Steak Night", status: "open", spots: 3, dollarCap: 80, createdAt: daysAgoIso(6), updatedAt: daysAgoIso(6), publishedAt: daysAgoIso(6) };
  seed["offer:offOther"] = { id: "offOther", businessId: "bizOther", businessName: "Other Eatery", market: "Nashville", category: "Restaurant", kind: "comp", title: "Busy Brunch", status: "open", spots: 3, dollarCap: 60, createdAt: daysAgoIso(6), updatedAt: daysAgoIso(6), publishedAt: daysAgoIso(6) };
  seed["offer:offWait"] = { id: "offWait", businessId: "bizWait", businessName: "Waiting Wok", market: "Nashville", category: "Restaurant", kind: "comp", title: "Wok Night", status: "open", spots: 2, dollarCap: 50, createdAt: daysAgoIso(2), updatedAt: daysAgoIso(2), publishedAt: daysAgoIso(2) };
  seed["offer:offEvidence"] = { id: "offEvidence", businessId: "bizEvidence", businessName: "Evidence Eats", market: "Nashville", category: "Restaurant", kind: "paid", title: "Evidence Dinner", status: "closed", spots: 2, cashRate: 200, createdAt: daysAgoIso(20), updatedAt: daysAgoIso(20), publishedAt: daysAgoIso(20) };
  const app = (id, offerId, businessId, creatorId, status) => { seed[`application:${id}`] = { id, offerId, businessId, creatorId, status: status || "applied", createdAt: daysAgoIso(3), updatedAt: daysAgoIso(3) }; };
  app("appOther1", "offOther", "bizOther", "crA");
  app("appOther2", "offOther", "bizOther", "crB");
  app("appWait1", "offWait", "bizWait", "crC");
  // Evidence cell (Nashville x Food & Drink): 32 shown rows on one
  // campaign brief, 16 with a rate (8 picked = 50%), 16 without
  // (3 picked = 18.75%) -> ratio 2.7, both arms >= 10, rows >= 30.
  const shown = [];
  for (let i = 1; i <= 16; i++) shown.push({ creatorId: `evW${i}`, score: 80, parts: { budgetSignal: "fits" } });
  for (let i = 1; i <= 16; i++) shown.push({ creatorId: `evN${i}`, score: 60, parts: { budgetSignal: "norate" } });
  seed[`event:${TODAY}:evidence0001`] = { id: "evidence0001", ts: NOW_ISO, type: "match_impression", actorId: "bizEvidence", actorRole: "business", subjectId: "offEvidence", market: "Nashville", data: { brief: { source: "campaign", campaignId: "offEvidence", market: "Nashville", category: "Restaurant", kind: "paid", budget: 200 }, via: "discover", shown } };
  for (let i = 1; i <= 8; i++) app(`appEvW${i}`, "offEvidence", "bizEvidence", `evW${i}`, "selected");
  for (let i = 1; i <= 3; i++) app(`appEvN${i}`, "offEvidence", "bizEvidence", `evN${i}`, "selected");
  // Graduation: crGrad has a delivered booking (post live).
  seed["booking:bkGrad"] = { id: "bkGrad", offerId: "offOther", businessId: "bizOther", creatorId: "crGrad", creatorName: "Gail Grad", market: "Nashville", status: "booked", createdAt: daysAgoIso(9), redeemedAt: daysAgoIso(8), post: { url: "https://instagram.com/p/grad", createdAt: daysAgoIso(7), onTime: true } };
  fs.writeFileSync(DB, JSON.stringify(seed));
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok -", name);
  else { failures++; console.log("  FAIL -", name, extra || ""); }
}
function readDb() { return JSON.parse(fs.readFileSync(DB, "utf8")); }
function readEvents(type, actorId) {
  const db = readDb();
  return Object.entries(db).filter(([k, v]) => k.startsWith("event:") && v && v.type === type && (!actorId || v.actorId === actorId)).map(([, v]) => v);
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
async function login(email) {
  const c = client();
  const r = await c("POST", "/api/auth/login", { email, password: SEED_PW }, base);
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return c;
}

const PORT = 8963;
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

  console.log("== auth gates ==");
  const anon = client();
  const rAnon = await anon("GET", "/api/sig/prompts", undefined, base);
  check("prompts refuse the signed-out (401)", rAnon.status === 401, String(rAnon.status));

  console.log("== campaign prompts: triggers + suppression ==");
  const bizNew = await login("biznew@fixtures.dev");
  const g1 = await bizNew("GET", "/api/sig/prompts", undefined, base);
  const p1 = g1.data.campaignPrompt;
  check("new_business prompt fires for an approved 10-day business with zero offers", !!p1, JSON.stringify(g1.data).slice(0, 240));
  check("trigger is new_business", !!p1 && p1.trigger === "new_business", p1 && p1.trigger);
  check("card names >= 2 creators, every score >= 55, every why-line non-empty", !!p1 && p1.creators.length >= 2 && p1.creators.every((c) => c.score >= 55 && c.why && c.name), JSON.stringify(p1 && p1.creators).slice(0, 240));
  check("headline speaks first-campaign, budget line is honest comp copy", !!p1 && /first campaign/i.test(p1.headline) && /comped visit/i.test(p1.budgetLine), p1 && p1.headline);
  check("no invented results anywhere on the card", !!p1 && !/roas|results|sales|guarantee/i.test(JSON.stringify(p1)));
  const shownBizNew = () => readEvents("campaign_prompt_shown", "bizNew");
  check("campaign_prompt_shown logged exactly once", shownBizNew().length === 1, String(shownBizNew().length));
  const g1b = await bizNew("GET", "/api/sig/prompts", undefined, base);
  check("re-read returns the SAME prompt, still one shown event", !!g1b.data.campaignPrompt && g1b.data.campaignPrompt.id === p1.id && shownBizNew().length === 1);

  const bizStarve = await login("bizstarve@fixtures.dev");
  const gs = await bizStarve("GET", "/api/sig/prompts", undefined, base);
  check("starving_offer prompt fires (0 applications vs market median 2)", !!gs.data.campaignPrompt && gs.data.campaignPrompt.trigger === "starving_offer", JSON.stringify(gs.data).slice(0, 240));
  check("starving headline names the quiet offer", !!gs.data.campaignPrompt && /Quiet Steak Night/.test(gs.data.campaignPrompt.headline), gs.data.campaignPrompt && gs.data.campaignPrompt.headline);

  const bizSparse = await login("bizsparse@fixtures.dev");
  const gsp = await bizSparse("GET", "/api/sig/prompts", undefined, base);
  check("<2 qualifying creators in Austin = NO prompt (never pad)", gsp.data.campaignPrompt === null && readEvents("campaign_prompt_shown", "bizSparse").length === 0, JSON.stringify(gsp.data).slice(0, 160));
  const bizWait = await login("bizwait@fixtures.dev");
  const gw = await bizWait("GET", "/api/sig/prompts", undefined, base);
  check("a waiting decision suppresses the prompt", gw.data.campaignPrompt === null, JSON.stringify(gw.data).slice(0, 160));
  const bizFounding = await login("bizfounding@fixtures.dev");
  const gf = await bizFounding("GET", "/api/sig/prompts", undefined, base);
  check("founding business gets no campaign prompt", gf.data.campaignPrompt === null, JSON.stringify(gf.data).slice(0, 160));

  console.log("== show me others ==");
  const firstIds = p1.creators.map((c) => c.userId);
  const ro = await bizNew("POST", "/api/sig/prompts/act", { promptId: p1.id, action: "others" }, base);
  const others = ro.data.prompt && ro.data.prompt.creators;
  check("others returns a fresh band: >= 2 creators, none repeated", !!others && others.length >= 2 && others.every((c) => !firstIds.includes(c.userId)), JSON.stringify(others).slice(0, 240));

  console.log("== promptId threading: use -> deal -> accepted offer ==");
  const ru = await bizNew("POST", "/api/sig/prompts/act", { promptId: p1.id, action: "use" }, base);
  check("use returns the composer draft + sourceBrief with promptId", !!ru.data.draft && !!ru.data.sourceBrief && ru.data.sourceBrief.promptId === p1.id, JSON.stringify(ru.data).slice(0, 240));
  check("campaign_prompt_used logged at composer_opened", readEvents("campaign_prompt_used", "bizNew").some((e) => e.data && e.data.stage === "composer_opened"));
  const deal = await bizNew("POST", "/api/deals", { creatorId: "crA", kind: "comp", title: ru.data.draft.title, dollarCap: 75, whatComped: ru.data.draft.ask, sourceBrief: ru.data.sourceBrief }, base);
  check("deal created from the prompt brief", deal.status === 200 || deal.status === 201, JSON.stringify(deal.data).slice(0, 200));
  const dealId = deal.data.deal && deal.data.deal.id;
  const crA = await login("a@fixtures.dev");
  const acc = await crA("POST", `/api/deals/${dealId}/respond`, { action: "accept" }, base);
  check("creator accepts the deal", acc.status === 200, JSON.stringify(acc.data).slice(0, 200));
  const dbAfterDeal = readDb();
  const promptRec = dbAfterDeal[`campaignprompt:${p1.id}`];
  const materialized = Object.values(dbAfterDeal).find((v) => v && v.sourceBrief && v.sourceBrief.promptId === p1.id && v.businessId === "bizNew" && v.dealId);
  check("materialized offer carries sourceBrief.promptId", !!materialized, "");
  check("prompt record closed as used with the offer id", !!promptRec && promptRec.status === "used" && !!promptRec.offerId, JSON.stringify(promptRec).slice(0, 200));
  check("campaign_prompt_used logged at offer_created with the offer id", readEvents("campaign_prompt_used", "bizNew").some((e) => e.data && e.data.stage === "offer_created" && e.data.offerId === (promptRec && promptRec.offerId)));

  console.log("== POST /offers threading + weekly cap (bizCap) ==");
  const bizCap = await login("bizcap@fixtures.dev");
  const gc1 = await bizCap("GET", "/api/sig/prompts", undefined, base);
  const cp1 = gc1.data.campaignPrompt;
  check("cap fixture: first prompt fires", !!cp1, JSON.stringify(gc1.data).slice(0, 200));
  const cu = await bizCap("POST", "/api/sig/prompts/act", { promptId: cp1.id, action: "use" }, base);
  const off = await bizCap("POST", "/api/offers", { title: cu.data.draft.title, whatComped: cu.data.draft.ask, kind: cu.data.draft.kind, spots: cu.data.draft.spots, dollarCap: 60, covers: 2, sourceBrief: cu.data.sourceBrief }, base);
  check("composer create from the prompt answers 201", off.status === 201, JSON.stringify(off.data).slice(0, 240));
  const dbCap = readDb();
  const capOffer = off.data.offer && dbCap[`offer:${off.data.offer.id}`];
  check("POST /offers stores sourceBrief.promptId", !!capOffer && !!capOffer.sourceBrief && capOffer.sourceBrief.promptId === cp1.id, JSON.stringify(capOffer && capOffer.sourceBrief));
  check("prompt record closed as used via the composer path", !!dbCap[`campaignprompt:${cp1.id}`] && dbCap[`campaignprompt:${cp1.id}`].status === "used" && dbCap[`campaignprompt:${cp1.id}`].offerId === off.data.offer.id);
  check("campaign_prompt_used offer_created logged for the composer path", readEvents("campaign_prompt_used", "bizCap").some((e) => e.data && e.data.stage === "offer_created"));
  const gc2 = await bizCap("GET", "/api/sig/prompts", undefined, base);
  const cp2 = gc2.data.campaignPrompt;
  check("second prompt of the week fires (new creator in market)", !!cp2 && cp2.id !== cp1.id, JSON.stringify(gc2.data).slice(0, 200));
  if (cp2) {
    await bizCap("POST", "/api/sig/prompts/act", { promptId: cp2.id, action: "dismiss" }, base);
    const gc3 = await bizCap("GET", "/api/sig/prompts", undefined, base);
    check("third prompt blocked by the 2/week cap (streak 1, no silence, no snooze)", gc3.data.campaignPrompt === null && readEvents("campaign_prompt_shown", "bizCap").length === 2, JSON.stringify(gc3.data).slice(0, 160));
  }

  console.log("== dismiss: family snooze + two-dismissal silence ==");
  const bizDismiss = await login("bizdismiss@fixtures.dev");
  const gd1 = await bizDismiss("GET", "/api/sig/prompts", undefined, base);
  const dp1 = gd1.data.campaignPrompt;
  check("dismiss fixture: first prompt fires", !!dp1, JSON.stringify(gd1.data).slice(0, 200));
  await bizDismiss("POST", "/api/sig/prompts/act", { promptId: dp1.id, action: "dismiss" }, base);
  check("campaign_prompt_dismissed logged", readEvents("campaign_prompt_dismissed", "bizDismiss").length === 1);
  const stAfter1 = readDb()[`promptstate:bizDismiss`];
  check("family snoozed ~30 days", !!stAfter1 && !!stAfter1.familyDismissedUntil[dp1.family] && Date.parse(stAfter1.familyDismissedUntil[dp1.family]) > Date.now() + 29 * 86400000);
  const gd2 = await bizDismiss("GET", "/api/sig/prompts", undefined, base);
  const dp2 = gd2.data.campaignPrompt;
  check("next prompt is a DIFFERENT family (snoozed family skipped)", !!dp2 && dp2.family !== dp1.family, dp2 && dp2.family);
  if (dp2) {
    await bizDismiss("POST", "/api/sig/prompts/act", { promptId: dp2.id, action: "dismiss" }, base);
    const stAfter2 = readDb()[`promptstate:bizDismiss`];
    check("two consecutive dismissals silence prompting ~14 days", !!stAfter2 && !!stAfter2.silencedUntil && Date.parse(stAfter2.silencedUntil) > Date.now() + 13 * 86400000, JSON.stringify(stAfter2).slice(0, 200));
    const gd3 = await bizDismiss("GET", "/api/sig/prompts", undefined, base);
    check("silenced business sees no prompt", gd3.data.campaignPrompt === null);
  }

  console.log("== snooze (Later) ==");
  const gs2 = await bizStarve("POST", "/api/sig/prompts/act", { promptId: gs.data.campaignPrompt.id, action: "snooze" }, base);
  check("snooze answers ok", gs2.status === 200 && !!gs2.data.ok, JSON.stringify(gs2.data).slice(0, 120));
  check("campaign_prompt_snoozed logged", readEvents("campaign_prompt_snoozed", "bizStarve").length === 1);
  const gs3 = await bizStarve("GET", "/api/sig/prompts", undefined, base);
  check("snoozed prompt stays hidden", gs3.data.campaignPrompt === null);

  console.log("== coaching ladder ==");
  const crLadder = await login("ladder@fixtures.dev");
  const c1 = await crLadder("GET", "/api/sig/prompts", undefined, base);
  check("ladder starts at market for an unlisted creator", !!c1.data.coaching && c1.data.coaching.type === "market", JSON.stringify(c1.data).slice(0, 240));
  check("creator_step_offered logged for market", readEvents("creator_step_offered", "crLadder").some((e) => e.data && e.data.step === "market"));
  const patch = await crLadder("PATCH", "/api/me/profile", { city: "Nashville" }, base);
  check("profile PATCH (typed city) answers", patch.status === 200, JSON.stringify(patch.data).slice(0, 160));
  const c2 = await crLadder("GET", "/api/sig/prompts", undefined, base);
  check("market step completes from the record change (creator_step_done)", readEvents("creator_step_done", "crLadder").some((e) => e.data && e.data.step === "market" && typeof e.data.timeToDoneMs === "number"));
  check("next step is platform, naming the biggest missing platform (TikTok)", !!c2.data.coaching && c2.data.coaching.type === "platform" && /TikTok/.test(c2.data.coaching.headline), JSON.stringify(c2.data.coaching).slice(0, 200));
  const cs = await crLadder("POST", "/api/sig/coaching/act", { action: "snooze" }, base);
  check("coaching snooze answers ok + event logged", cs.status === 200 && readEvents("creator_step_snoozed", "crLadder").length === 1);
  const c3 = await crLadder("GET", "/api/sig/prompts", undefined, base);
  check("snoozed step stays hidden (3-day snooze)", c3.data.coaching === null, JSON.stringify(c3.data).slice(0, 160));

  console.log("== evidence gate ==");
  const crBelow = await login("ratebelow@fixtures.dev");
  const cb = await crBelow("GET", "/api/sig/prompts", undefined, base);
  check("rate step offered (Denver creator, empty cell)", !!cb.data.coaching && cb.data.coaching.type === "rate", JSON.stringify(cb.data).slice(0, 240));
  check("below the cell minimum the why-line cites NO statistic", !!cb.data.coaching && !/as often/.test(cb.data.coaching.why) && /can only book a rate that is listed/.test(cb.data.coaching.why), cb.data.coaching && cb.data.coaching.why);
  const crAbove = await login("rateabove@fixtures.dev");
  const ca = await crAbove("GET", "/api/sig/prompts", undefined, base);
  check("above the gate the why-line carries the real ratio (2.7x)", !!ca.data.coaching && ca.data.coaching.type === "rate" && /2\.7x as often/.test(ca.data.coaching.why), ca.data.coaching && ca.data.coaching.why);

  console.log("== graduation ==");
  const crGrad = await login("grad@fixtures.dev");
  const cg = await crGrad("GET", "/api/sig/prompts", undefined, base);
  check("ladder complete + delivered booking = coaching stops", cg.data.coaching === null, JSON.stringify(cg.data).slice(0, 160));

  console.log("== cross-role gates ==");
  const r403a = await crA("POST", "/api/sig/prompts/act", { promptId: "x", action: "dismiss" }, base);
  check("creator cannot act on campaign prompts (403)", r403a.status === 403, String(r403a.status));
  const r403b = await bizNew("POST", "/api/sig/coaching/act", { action: "snooze" }, base);
  check("business cannot act on coaching (403)", r403b.status === 403, String(r403b.status));

  console.log("== admin visibility ==");
  const ad = await admin("GET", "/api/admin/stats/data", undefined, base);
  const pr = ad.data.prompting;
  check("data view carries the prompting rollup", !!pr && !!pr.campaign && !!pr.coaching, JSON.stringify(ad.data).slice(0, 160));
  check("campaign counts reflect the run (shown >= 4, dismissed >= 2, used >= 2)", !!pr && pr.campaign.shown >= 4 && pr.campaign.dismissed >= 2 && pr.campaign.used >= 2, JSON.stringify(pr && pr.campaign));
  check("coaching rollup: offered/done counted, live distribution present", !!pr && pr.coaching.offered >= 3 && pr.coaching.done >= 1 && typeof pr.coaching.distribution === "object", JSON.stringify(pr && pr.coaching).slice(0, 240));
  const ex = await admin("GET", "/api/admin/stats/data/export?dataset=campaign_prompts&format=json", undefined, base);
  check("campaign_prompts export answers with the shown events", ex.status === 200 && Array.isArray(ex.data) && ex.data.some((r) => r.type === "campaign_prompt_shown"), String(ex.status));

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL GREEN");
} catch (e) {
  failures++;
  console.log("  FAIL - harness error:", e && e.message);
} finally {
  server.kill("SIGKILL");
}
process.exit(failures ? 1 : 0);
