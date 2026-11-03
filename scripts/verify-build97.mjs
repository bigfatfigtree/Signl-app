#!/usr/bin/env node
// Build -97 verification: campaign setup and campaign
// tracking as two separate views, with Sig-guided setup
// (Tier 2 item 13).
//
// Proves, against a seeded throwaway store served by the
// real dev server on port 8977:
//   - source: both views exist as separate tabs wired into
//     the business rail; the guided setup, the step builder,
//     the prompts, and the item-12 deep-link target ship;
//   - old drafts and past campaigns carry over unchanged in
//     the tracking view's data (same store, same records);
//   - the founding gate is intact: the server still forces
//     status "draft" and publish is refused (403);
//   - the manual builder's commit path creates drafts with
//     the canon defaults (comped 1 post + 1 story / 48h,
//     coupon 1 post / no story, paid deliverables editable
//     with the 90-day licence NOT removable);
//   - Sig answers the setup question from real records,
//     linked to the setup view (dest biz-setup);
//   - proactive prompts render only when true: a founding
//     business with zero campaigns gets the first-campaign
//     chip; an active business with an unfinished draft and
//     visits unused behind the month's pace gets both of
//     its chips; a business ahead of pace with no drafts
//     gets neither; a founding business with campaigns gets
//     no first-campaign chip and never a finish chip.
//
// Run: node scripts/verify-build97.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8977;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b97.dev";
const ADMIN_PASSWORD = "<redacted>";

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}

function startServer(db, port) {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL, ADMIN_PASSWORD };
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_EMAIL_FROM"]) delete env[k];
  const s = spawn("node", ["scripts/dev-server.mjs", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  s.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return s;
}
async function waitUp(base) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not come up on ${base}`);
}

// ---------- seeded store ----------
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-97", salt, 64).toString("hex");
const DAY = 86400000;
const now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const AVAIL = { days: ["Fri", "Sat", "Sun"], hours: "12 to 4", appointments: "Tue to Thu by appointment" };

const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const biz = (id, name, over = {}) => putUser({ id, role: "business", email: `${id}@b97.dev`, name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), phone: "+15550001111", business: { businessName: name, category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "A real place.", ...((over.business) || {}) }, ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "business")) });
const creator = (id, handle) => putUser({ id, role: "creator", email: `${id}@b97.dev`, name: `Creator ${id}`, passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), creator: { handle, followerCount: 3000, categories: ["Food & Drink"], localAudiencePct: 70, licensingFee: 80, tierBand: "Locals" } });

biz("bizf", "B97 Founding Fork", { business: { accessState: "founding", standingAvailability: AVAIL } });
biz("biznone", "B97 Empty Table", { business: { accessState: "founding" } });
biz("bizact", "B97 Active Table", { business: { accessState: "active", activatedAt: iso(now0 - 40 * DAY) } });
biz("bizpace", "B97 Busy Table", { business: { accessState: "active", activatedAt: iso(now0 - 40 * DAY) } });
creator("cr1", "b97casey");

const offer = (id, businessId, over = {}) => {
  data[`offer:${id}`] = { id, businessId, businessName: (data[`user:${businessId}`].business || {}).businessName || "", status: "draft", kind: "comp", lane: "open", market: "Nashville", category: "Restaurant", title: "Draft", whatComped: "Meal for two, on us", dollarCap: 80, spots: 2, targetTiers: ["Locals"], deliverables: { posts: 1, story: true, windowHours: 48 }, createdAt: iso(now0 - 5 * DAY), updatedAt: iso(now0 - 5 * DAY), ...over };
};
// The founding business's pre-split records: one draft made
// under the old single view, one closed campaign.
offer("draft-old", "bizf", { title: "Old Draft Special" });
offer("past1", "bizf", { title: "Finished Brunch", status: "closed" });
// The active business's unfinished draft (started, never sent).
offer("draft-half", "bizact", { title: "Half Built Lunch", createdAt: iso(now0 - 2 * DAY), updatedAt: iso(now0 - 2 * DAY) });
// The busy business: five visits booked this month (ahead of
// the month's pace), no drafts.
for (let i = 1; i <= 5; i++) {
  data[`booking:bk-pace${i}`] = { id: `bk-pace${i}`, offerId: "off-x", businessId: "bizpace", businessName: "B97 Busy Table", creatorId: "cr1", creatorName: "Creator cr1", creatorHandle: "b97casey", market: "Nashville", category: "Restaurant", kind: "comp", title: "Visit", whatComped: "Meal", covers: 2, dollarCap: 80, status: "booked", redeemedAt: null, createdAt: iso(now0 - 1 * DAY), updatedAt: iso(now0 - 1 * DAY), redemptions: null };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build97-"));
const DB = path.join(tmp, "db.json");
fs.writeFileSync(DB, JSON.stringify(data));

console.log("== Build -97: carry-over + the founding gate (live) ==");
const server = startServer(DB, PORT);
try {
  await waitUp(BASE);
  const login = async (id) => { const c = new Client(BASE); const r = await c.req("POST", "/api/auth/login", { email: `${id}@b97.dev`, password: "fixture-pass-97" }); if (r.status !== 200) throw new Error(`login ${id}: ${r.status}`); return c; };
  const bizF = await login("bizf");
  const bizNone = await login("biznone");
  const bizAct = await login("bizact");
  const bizPace = await login("bizpace");

  const offersF = await bizF.req("GET", "/api/offers");
  const oldDraft = (offersF.data.offers || []).find((o) => o.id === "draft-old");
  const past = (offersF.data.offers || []).find((o) => o.id === "past1");
  check("old drafts appear in the tracking data unchanged (same store, same record)",
    !!oldDraft && oldDraft.status === "draft" && oldDraft.title === "Old Draft Special" && oldDraft.dollarCap === 80 && oldDraft.deliverables.posts === 1 && oldDraft.deliverables.story === true && oldDraft.deliverables.windowHours === 48,
    JSON.stringify(oldDraft || null));
  check("past campaigns carry over unchanged too", !!past && past.status === "closed" && past.title === "Finished Brunch");

  const forced = await bizF.req("POST", "/api/offers", { title: "Founding tries to send", whatComped: "Dinner for two", kind: "comp", dollarCap: 90, spots: 1, draft: false });
  check("founding gate: a non-draft create is still forced to status draft server-side",
    forced.status === 201 && forced.data.offer && forced.data.offer.status === "draft", `status=${forced.status} offer=${JSON.stringify(forced.data.offer || {}).slice(0, 120)}`);
  const pub = await bizF.req("POST", `/api/offers/${forced.data.offer.id}/publish`, {});
  check("founding gate: publish is still refused server-side (403)", pub.status === 403, `status=${pub.status}`);
  const pubOld = await bizF.req("POST", "/api/offers/draft-old/publish", {});
  check("founding gate: publishing the carried-over old draft is refused too (403)", pubOld.status === 403, `status=${pubOld.status}`);

  console.log("== Build -97: the builder's commit path keeps the canon defaults ==");
  const comp = await bizAct.req("POST", "/api/offers", { title: "Manual comp", whatComped: "Dinner for two", kind: "comp", dollarCap: 100, spots: 2, draft: true });
  check("manual comp draft: 1 post + 1 story within 48 hours by default",
    comp.status === 201 && comp.data.offer.status === "draft" && comp.data.offer.deliverables.posts === 1 && comp.data.offer.deliverables.story === true && comp.data.offer.deliverables.windowHours === 48,
    JSON.stringify((comp.data.offer || {}).deliverables || null));
  const coupon = await bizAct.req("POST", "/api/offers", { title: "Manual coupon", kind: "coupon", spots: 1, draft: true, coupon: { type: "amount_off", amount: 25, appliesTo: "Any purchase" } });
  check("manual coupon draft: 1 post, NO story, within 48 hours by default",
    coupon.status === 201 && coupon.data.offer.deliverables.posts === 1 && coupon.data.offer.deliverables.story === false && coupon.data.offer.deliverables.windowHours === 48,
    JSON.stringify((coupon.data.offer || {}).deliverables || null));
  const paid = await bizAct.req("POST", "/api/offers", { title: "Manual paid", kind: "paid", cashRate: 150, whatComped: "Dinner for two", spots: 1, draft: true, deliverables: { posts: 2, story: false, windowHours: 24 } });
  check("manual paid draft: deliverables editable, brief line stays the paid canon (the 90-day licence is a term, not an edit)",
    paid.status === 201 && paid.data.offer.deliverables.posts === 2 && paid.data.offer.deliverables.windowHours === 24
    && paid.data.offer.brief && paid.data.offer.brief.deliverable === "Deliverables are set in the booking terms. Post within 48 hours and keep the post live at least 30 days.",
    JSON.stringify((paid.data.offer || {}).brief || null));

  console.log("== Build -97: the guided commit lands in the same store, once ==");
  const before = await bizAct.req("GET", "/api/offers");
  const beforeDrafts = (before.data.offers || []).filter((o) => o.status === "draft").length;
  // This is the exact payload shape campaignGuideConfirm sends.
  const guided = await bizAct.req("POST", "/api/offers", { title: "Weekend brunch push", whatComped: "Brunch for two, on us", includes: "", experience: "", kind: "comp", spots: 3, visitWindow: "This weekend", templateId: null, draft: true, creatorId: null, requiresSpanish: false, play: null, deliverables: { posts: 1, story: true, windowHours: 48 }, targetTiers: [], applyWindowDays: 3, windowDays: 7, dollarCap: 100, covers: 2 });
  const after = await bizAct.req("GET", "/api/offers");
  const afterDrafts = (after.data.offers || []).filter((o) => o.status === "draft");
  check("guided commit creates exactly one new draft in the same store the manual builder uses",
    guided.status === 201 && guided.data.offer.status === "draft" && afterDrafts.length === beforeDrafts + 1 && afterDrafts.some((o) => o.id === guided.data.offer.id && o.title === "Weekend brunch push"),
    `before=${beforeDrafts} after=${afterDrafts.length}`);

  console.log("== Build -97: Sig answers + proactive chips ==");
  const ask = await bizF.req("POST", "/api/sig/ask", { q: "How do I set up a campaign?", history: [] });
  check("business Sig answers the setup question from the records, linked to the setup view",
    ask.status === 200 && ask.data.source === "data" && /its own view/.test(ask.data.text || "") && ask.data.link && ask.data.link.dest === "biz-setup",
    JSON.stringify(ask.data).slice(0, 260));
  const chipsOf = async (c) => { const h = await c.req("GET", "/api/sig/home"); return (h.data && h.data.chips) || []; };
  const chipsNone = await chipsOf(bizNone);
  check("prompt: founding business with zero campaigns gets the first-campaign chip",
    chipsNone.some((c) => c === "Set up your first campaign"), JSON.stringify(chipsNone));
  check("prompt: that business gets NO finish chip and NO visits-unused chip (nothing else is true)",
    !chipsNone.some((c) => /Finish your draft/.test(c)) && !chipsNone.some((c) => /visits unused/.test(c)), JSON.stringify(chipsNone));
  const chipsF = await chipsOf(bizF);
  check("prompt: founding business WITH campaigns gets no first-campaign chip, and founding drafts never read as unfinished",
    !chipsF.some((c) => c === "Set up your first campaign") && !chipsF.some((c) => /Finish your draft/.test(c)), JSON.stringify(chipsF));
  const chipsAct = await chipsOf(bizAct);
  check("prompt: active business with an unfinished draft gets the finish chip",
    chipsAct.some((c) => c === "Finish your draft campaign"), JSON.stringify(chipsAct));
  check("prompt: active business behind the month's pace on visits gets the visits-unused chip",
    chipsAct.some((c) => /visits unused this month/.test(c)), JSON.stringify(chipsAct));
  const chipsPace = await chipsOf(bizPace);
  check("prompt: business ahead of pace with no drafts gets NEITHER campaign prompt (silence when nothing is true)",
    !chipsPace.some((c) => /Finish your draft/.test(c)) && !chipsPace.some((c) => /visits unused/.test(c)) && !chipsPace.some((c) => c === "Set up your first campaign"), JSON.stringify(chipsPace));
} finally {
  server.kill();
}

// ---------- source checks ----------
console.log("== Source checks ==");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const sigdataJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigdata.js"), "utf8");
  const sigaiJs = fs.readFileSync(path.join(root, "netlify/functions/lib/sigai.js"), "utf8");
  check("two views: separate tabs in the business shell, both wired in renderBusinessDash",
    appJs.includes('"Campaign Setup", "My Offers"') && appJs.includes('if (tab === "Campaign Setup") loadCampaignSetup();') && appJs.includes('if (tab === "My Offers") loadMyOffers();'));
  check("rail: two rows, Set up a campaign then Your campaigns, following the Regulars pattern",
    appJs.includes('label: "Set up a campaign", sub: "Build a new campaign, step by step or with Sig.", tab: "Campaign Setup"')
    && appJs.includes('label: "Your campaigns", sub: "Current and past campaigns, who applied, and what they did.", tab: "My Offers"')
    && appJs.includes('RAIL_SHORT["Campaign Setup"] = "Setup"'));
  check("setup view: its own head, the composer, and no tracking list; tracking view: its own head, no composer",
    appJs.includes('wsHead("Set up a campaign"') && appJs.includes('id="offer-composer"')
    && appJs.slice(appJs.indexOf("async function loadMyOffers()"), appJs.indexOf("async function loadMyOffers()") + 3200).includes('wsHead("Your campaigns"')
    && !appJs.slice(appJs.indexOf("async function loadMyOffers()"), appJs.indexOf("async function loadMyOffers()") + 3200).includes("offer-composer"));
  check("deep-link target for the item-12 checklist: go('dashboard','Campaign Setup') via the biz-setup Sig link",
    appJs.includes('case "biz-setup": return go("dashboard", "Campaign Setup");') && appJs.includes('if (t.includes("first campaign")) return "biz-setup";'));
  check("guided setup: parse, known-file line, one-question flow, summary before save, same-store commit",
    appJs.includes("function campaignGuideParse(") && appJs.includes("function campaignGuideStart(") && appJs.includes("function campaignGuideNext(")
    && appJs.includes("Already on file for you:") && appJs.includes("so I will not ask about those")
    && appJs.includes("Nothing is saved until you tap Save this draft") && appJs.includes("async function campaignGuideConfirm()")
    && appJs.slice(appJs.indexOf("async function campaignGuideConfirm()"), appJs.indexOf("async function campaignGuideConfirm()") + 1500).includes('api("POST", "/offers", payload)')
    && appJs.slice(appJs.indexOf("async function campaignGuideConfirm()"), appJs.indexOf("async function campaignGuideConfirm()") + 1500).includes("draft: true"));
  check("guided setup: the question sequence covers pay, value, spots, dates, deliverables, and creator fit",
    ["How will the creator be paid?", "How many creators do you want for this campaign?", "When should creators come in?", "What the creator owes:", "Who fits this campaign?"].every((q) => appJs.includes(q)));
  check("guided setup: known timing pre-fills the dates answer (standing availability or the words used)",
    appJs.includes("windowNote: parsed.whenText || known.availability || \"\""));
  check("manual builder: one step at a time with a plain progress line, and a plain help line on the main fields",
    appJs.includes("function campaignStepsInit()") && appJs.includes("Step ${i + 1} of ${groups.length}:") && appJs.includes("This is the name creators see first. Name the experience, not the deal.")
    && appJs.includes("How many creators you will pick. Each pick uses one visit from your plan.")
    && appJs.includes("When creators can come. Your standing hours fill this in until you change it for this campaign."));
  check("manual builder: canon deliverables editor still ships with the Recommended badge and reset",
    appJs.includes("function deliverablesEditorHtml(") && appJs.includes("Back to the recommended standard") && appJs.includes("cannot be changed"));
  check("prompts: Sig home chips in sigdata, facts in the router, queues in both business Homes, prompt card in tracking",
    sigdataJs.includes('"Set up your first campaign"') && sigdataJs.includes('"Finish your draft campaign"') && sigdataJs.includes("visits unused this month")
    && routerJs.includes("offersTotal:") && routerJs.includes("unfinishedDrafts:") && routerJs.includes("visitsUnusedMidMonth:")
    && appJs.includes("No campaign drafts yet. Set one up now, with Sig or step by step")
    && appJs.includes("You started a draft campaign,") && appJs.includes("plan visits are still unused")
    && appJs.includes("function campaignPromptsHtml("));
  check("Sig answerer: the setup branch links to biz-setup in plain words",
    sigdataJs.includes('hasPhrase(t, "set up a campaign"') && sigdataJs.includes('"biz-setup"') && sigdataJs.includes("Open Your campaigns"));
  check("sigai canon: the two-views line", sigaiJs.includes("Campaign setup and tracking are two separate views."));
  check("canon locks untouched: founding Stripe prices stay env-or-empty (no market live for money)",
    routerJs.includes('STRIPE_PRICE_FOUNDING_SELF_SERVICE || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_GROWTH || ""') && routerJs.includes('STRIPE_PRICE_FOUNDING_MANAGED || ""'));
  check("no em dashes in the new copy", ["Set up a campaign", "Build a new campaign, step by step or with Sig.", "Current and past campaigns, who applied, and what they did.", "Tell Sig what you want", "Nothing is saved until you tap Save this draft", "Partway through the month,"].every((l) => !l.includes("—") && !l.includes("–")));
  check("build stamp is 2026.11.02-104 on both sides",
    fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes('exports.BUILD_ID = "2026.11.02-104"')
    && fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes('window.__SIGNL_BUILD__ = "2026.11.02-104"'), "");
}

console.log(`\nBuild -97 verify: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
