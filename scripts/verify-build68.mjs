#!/usr/bin/env node
// Build -68 verification (Jeff, 2026-11-01): the BUSINESS
// SHELL rebuild. Approved founding businesses get the full
// rail and the real views; campaigns save as drafts for
// opening day and can never go live before activation; Sig
// is front and center with business starters and plan-fact
// answers; public profiles center, carry follower counts
// beside every market percentage, key the headline number to
// the viewed market, and show the creator's first name (plus
// pronouns when set).
//
// Proves, against a throwaway local store:
//   - server gate: approved founding can browse / favorite /
//     hold drafts; pending founding is refused everywhere;
//     bookings, messages and business-home stay refused for
//     every founding business;
//   - founding offers are drafts by law (create with
//     draft:false still lands as draft, direct drafts never
//     notify or appear for the creator, publish refuses with
//     the founding answer even in a LIVE market, rebook and
//     select refuse too);
//   - the -67 demo fence holds inside founding Discover
//     (allowlisted founding business sees the demos mixed with
//     real creators; a non-allowlisted founding business sees
//     none; a direct offer to a demo is refused);
//   - the Sig bank resolves the four business questions with
//     founding-honest, plan-true answers, and POST /sig/ask
//     answers 200 for a founding business;
//   - profiles: the payload carries firstName + pronouns; the
//     server page renders first name, counts beside the local
//     % and on every also-ranked chip, the named-market card;
//     a ?market= context swaps the headline and rotates the
//     chips; profile-meta's view resolver falls back to home
//     for unlisted or below-floor markets; a no-total profile
//     degrades to "% of followers" with no fake count;
//   - view-as: the walkthrough reads (discover, demo profile,
//     offers) all render on Chelsea's record and a draft save
//     inside the view refuses read-only;
//   - source checks for the shell: rail order (Sig second),
//     Campaigns label, no "Set up your first month" anywhere,
//     baseline labels in their single home, founding composer
//     copy, Sig starters, the -68 stamp.
//
// Run: node scripts/verify-build68.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const require = createRequire(path.join(root, "package.json"));
const PORT = 8997;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = ["signl", "admin", "68"].join("-");
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };
const READ_ONLY_BIT = "viewing this account read-only";
const DEMO_HANDLES = ["tesstastestn", "wadehensleymusic", "priyaathome", "marcusbellshoots", "delladoes615", "colebrandtfit", "hannahandthem", "rubygetsglam", "elithackereats", "noraseesnashville", "samswhitfieldhome", "gracetembostyle"];

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
  async raw(p) {
    const headers = {};
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + p, { headers });
    return { status: res.status, text: await res.text() };
  }
}

function startServer(db, port) {
  const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: db, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: `http://127.0.0.1:${port}`, ADMIN_EMAIL, ADMIN_PASSWORD };
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

// ---------- source checks ----------
console.log("== Source: the shell, the copy, the stamp ==");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const metaJs = fs.readFileSync(path.join(root, "netlify/functions/lib/profile-meta.js"), "utf8");
check("stamp is 2026.11.02-108", fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes("2026.11.02-108") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.02-108"));
check("no 'Set up your first month' anywhere in the shell", !appJs.includes("Set up your first month"));
check("business rail: Sig directly under Home", appJs.includes('...extra(["Home", "Sig", "Discover"])'));
check("rail parity: approved business is full chrome", appJs.includes('u.role === "business" || businessAccessState(u) === "active"'));
check("Campaigns split into two rail rows in Build -97 (setup + tracking, tab ids kept)", appJs.includes('label: "Set up a campaign", sub: "Build a new campaign, step by step or with Sig.", tab: "Campaign Setup"') && appJs.includes('label: "Your campaigns", sub: "Current and past campaigns, who applied, and what they did.", tab: "My Offers"') && appJs.includes('RAIL_SHORT["My Offers"] = "Campaigns"'));
check("router no longer walls approved founding into the status page", !appJs.includes("if (isFoundingBusiness(u)) return renderBusinessFoundingStatus();"));
check("founding home is the 3-block build", appJs.includes("loadFoundingBusinessHome") && appJs.includes("foundingFirstMonthCardHtml") && appJs.includes("You're in. "));
check("founding one-card states exist", appJs.includes("renderFoundingVisitsTab") && appJs.includes("renderFoundingResultsTab") && appJs.includes("renderFoundingContentTab") && appJs.includes("renderFoundingMessagesTab"));
check("composer: founding submit + lane names + moment row", appJs.includes("Save invite for opening day") && appJs.includes("Save for opening day") && appJs.includes("Post an open call") && appJs.includes("Invite a creator") && appJs.includes("What is your first month built around?"));
check("draft cards wear the opening-day label", appJs.includes("Saved for opening day"));
check("Drafts segment exists", appJs.includes("offersSetSeg('drafts')"));
{
  const rcSeg = appJs.slice(appJs.indexOf("function receiptSettingsHtml"), appJs.indexOf("async function receiptSaveBaseline"));
  check("baseline lives in Proof Controls with the new labels", rcSeg.includes("One of your usual open days") && rcSeg.includes("About how many customers on that day?") && rcSeg.includes("your usual open day") && !appJs.includes("Usual tables or customers"));
}
check("Sig draft card wired to the play machinery", appJs.includes("sigDraftCardHtml") && appJs.includes("foundingOpenSigDraft"));
check("Sig starters: the five business jobs", appJs.includes("sigBizStartersHtml") && appJs.includes("Draft my first campaign") && appJs.includes("Find creators near me") && appJs.includes("How will my results be counted?"));
check("Sig bank: business topics added", appJs.includes('id: "myplan"') && appJs.includes('id: "campaigns"') && appJs.includes('id: "counting"') && appJs.includes('id: "opens"'));
check("Sig B1 commit: draft result gets the founding-honest line", appJs.includes("is saved as a draft for opening day"));
check("profile: viewed-market resolver + first name in app.js", appJs.includes("function profileViewMarket") && appJs.includes("function profileDisplayName") && appJs.includes("followersForPct"));
check("profile: centering hook present", appJs.includes('classList.toggle("profile-view"') && fs.readFileSync(path.join(root, "public/theme-v2.css"), "utf8").includes("body.profile-view main"));
check("server gate: founding-open sections named", routerJs.includes("FOUNDING_OPEN_SECTIONS"));
check("server: founding create force-drafts", routerJs.includes("|| isFoundingBusiness(user);"));
check("server: founding publish refused by name", routerJs.includes("this draft stays saved for opening day"));
check("server: rebook + select refuse founding", routerJs.includes("invites stay drafts for opening day") && routerJs.includes("nothing to select yet"));
check("server: pronouns save + payload", routerJs.includes("b.pronouns !== undefined") && routerJs.includes("payload.firstName = firstNameOf"));
check("profile-meta: view resolver + counts exported", metaJs.includes("function profileViewOf") && metaJs.includes("followersForPct"));

// ---------- profile-meta unit checks ----------
console.log("== Profiles: view resolver, counts, names (unit) ==");
const pm = require(path.join(root, "netlify/functions/lib/profile-meta.js"));
const LATOYA_LISTED = [
  { market: "Richmond", pct: 50, home: true },
  { market: "Washington DC", pct: 47 },
  { market: "Baltimore", pct: 25 },
  { market: "Las Vegas", pct: 18 },
];
check("resolver: no context = home headline", pm.profileViewOf({ listedMarkets: LATOYA_LISTED, localAudiencePct: 50, market: "Richmond" }).market === "Richmond");
{
  const v = pm.profileViewOf({ listedMarkets: LATOYA_LISTED, localAudiencePct: 50, market: "Richmond", viewMarket: "Washington DC" });
  check("resolver: DC context swaps headline", v.market === "Washington DC" && v.pct === 47 && v.home === false, JSON.stringify(v));
}
check("resolver: unlisted market falls back to home", pm.profileViewOf({ listedMarkets: LATOYA_LISTED, localAudiencePct: 50, market: "Richmond", viewMarket: "Austin" }).market === "Richmond");
check("resolver: home named explicitly = home", pm.profileViewOf({ listedMarkets: LATOYA_LISTED, localAudiencePct: 50, market: "Richmond", viewMarket: "Richmond" }).home === true);
check("counts: 47% of 10K = 4.7K", pm.followersForPct(47, 10000) === "4.7K");
check("counts: 50% of 10K = 5K", pm.followersForPct(50, 10000) === "5K");
check("counts: 25% of 10K = 2.5K", pm.followersForPct(25, 10000) === "2.5K");
check("counts: 18% of 10K = 1.8K", pm.followersForPct(18, 10000) === "1.8K");
check("counts: no total = no count", pm.followersForPct(47, 0) === null && pm.followersForPct(47, null) === null && pm.followersForPct(null, 10000) === null);
check("name: first name + pronouns", pm.profileDisplayName({ name: "LaToya Gay", firstName: "LaToya", pronouns: "she/her" }) === "LaToya · she/her");
check("name: first name alone", pm.profileDisplayName({ name: "LaToya Gay", firstName: "LaToya", pronouns: null }) === "LaToya");
check("name: handle-only record unchanged", pm.profileDisplayName({ name: "ugcbylatoyagay", firstName: null, pronouns: null }) === "ugcbylatoyagay");

// ---------- Sig bank battery ----------
console.log("== Sig: the bank answers the business questions ==");
{
  const start = appJs.indexOf("function sigBankFor");
  const end = appJs.indexOf("// SIGBANK-END");
  check("bank markers present", start >= 0 && end > start);
  const sandbox = { VISIT_GUARANTEE_LINE: "Visit Guarantee line." };
  vm.createContext(sandbox);
  vm.runInContext(appJs.slice(start, end) + "\nthis.__sig = { sigBankFor, sigMatch };", sandbox);
  const { sigMatch } = sandbox.__sig;
  const ctx = { biz: true, live: false, founding: true, market: "Nashville", planName: "Self-Service", planPrice: 199, planVisits: 5, planCredit: 100, profileComplete: false, missing: [], status: "approved", charter: false };
  const answer = (q) => {
    const m = sigMatch(q, true);
    if (!m.topic) return { id: null, text: "" };
    return { id: m.topic.id, text: typeof m.topic.a === "function" ? m.topic.a(ctx) : m.topic.a };
  };
  const plan = answer("what does my plan include?");
  check("Sig: plan question resolves to myplan", plan.id === "myplan", plan.id || "no topic");
  check("Sig: plan answer carries HER plan facts", plan.text.includes("Self-Service") && plan.text.includes("$199") && plan.text.includes("5 creator visits"), plan.text.slice(0, 160));
  check("Sig: plan answer is founding-honest", plan.text.includes("$100 founding credit") && plan.text.includes("Nothing is due"), plan.text.slice(0, 200));
  const camp = answer("how do campaigns work?");
  check("Sig: campaigns question resolves", camp.id === "campaigns", camp.id || "no topic");
  check("Sig: campaigns answer is plain + founding-honest", camp.text.includes("Post an open call") && camp.text.includes("invite goes only to them") && camp.text.includes("drafts for opening day"), camp.text.slice(0, 200));
  const book = answer("who can i book?");
  check("Sig: who-can-I-book resolves to invite", book.id === "invite", book.id || "no topic");
  check("Sig: book answer points to Find creators with roster framing", book.text.includes("Find creators") && book.text.includes("founding roster is still joining"), book.text.slice(0, 200));
  const counting = answer("how will my results be counted?");
  check("Sig: counting question resolves", counting.id === "counting", counting.id || "no topic");
  check("Sig: counting answer names the receipt + Proof Controls", counting.text.includes("receipt") && counting.text.includes("Proof Controls") && counting.text.includes("never blended"), counting.text.slice(0, 200));
  const opens = answer("what happens when Nashville opens?");
  check("Sig: opens question resolves", opens.id === "opens", opens.id || "no topic");
  check("Sig: opens answer is the opening-day story", opens.text.includes("email you the day Nashville opens") && opens.text.includes("founding rate"), opens.text.slice(0, 200));
  const hw = answer("how does signl work for a business?");
  check("Sig: how-it-works keeps its topic + gains the founding suffix", hw.id === "howitworks" && hw.text.includes("saves as a draft for opening day"), hw.id || "no topic");
}

// ---------- live behavior ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build68-"));
const DB = path.join(tmp, "db.json");
console.log("== Behavior: founding gate, drafts by law, demo fence, view-as ==");
const server = startServer(DB, PORT);
process.on("exit", () => { try { server.kill("SIGKILL"); } catch (e) { /* already gone */ } });
await waitUp(BASE);
const admin = new Client(BASE);
{
  const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin login", r.status === 200 && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
}
async function registerBusiness(email, businessName, market, planId, category = "Retail") {
  const c = new Client(BASE);
  const r = await c.req("POST", "/api/auth/register", {
    role: "business", name: "Owner", businessName, email, password: "fixture-password-68",
    market, category, planId, neighborhood: "East Nashville", about: "Fixture business.", agreedTerms: true,
  });
  return { c, r };
}
const chelsea = await registerBusiness("chelsea68@fixtures.dev", "Chelsea Friday Furniture", "Nashville", "self-service");
const chelseaId = chelsea.r.data.user.id;
const maple = await registerBusiness("maple68@fixtures.dev", "Maple Street Coffee", "Nashville", "growth", "Coffee & Bakery");
const pendingBiz = await registerBusiness("pending68@fixtures.dev", "Pending Pizza", "Nashville", "self-service", "Restaurant");
for (const [label, id] of [["Chelsea", chelseaId], ["Maple", maple.r.data.user.id]]) {
  const r = await admin.req("POST", "/api/admin/review", { userId: id, decision: "approve" });
  check(`admin approves ${label} (founding)`, r.status === 200 && r.data.user.status === "approved", `status=${r.status}`);
}
// A real finished Nashville creator.
const realCreator = new Client(BASE);
let realCreatorId = null;
{
  const r = await realCreator.req("POST", "/api/auth/register", {
    role: "creator", name: "Real Nashville", email: "realnash68@fixtures.dev", password: "fixture-password-68",
    market: "Nashville", city: "Nashville", handle: "realnash68", followerCount: 3000,
    localAudiencePct: 80, categories: ["Food & Drink"], ...AGREE,
  });
  realCreatorId = r.data.user.id;
  await admin.req("POST", "/api/admin/review", { userId: realCreatorId, decision: "approve" });
  await realCreator.req("PATCH", "/api/me/profile", { publicPage: true });
  check("real Nashville creator ready", r.status === 201, `status=${r.status}`);
}
// The LaToya-shaped creator: Richmond home 50%, DC 47%,
// Baltimore 25%, Las Vegas 18%, 10K total, pronouns set.
const latoya = new Client(BASE);
{
  const r = await latoya.req("POST", "/api/auth/register", {
    role: "creator", name: "LaToya Gay", email: "latoya68@fixtures.dev", password: "fixture-password-68",
    market: "Richmond", city: "Richmond", handle: "latoyafixture68", followerCount: 10000,
    localAudiencePct: 50, categories: ["Lifestyle"], ...AGREE,
  });
  check("LaToya-shaped creator registers", r.status === 201, `status=${r.status}`);
  await admin.req("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
  const pp = await latoya.req("PATCH", "/api/me/profile", {
    publicPage: true, pronouns: "she/her",
    audienceMarkets: [
      { market: "Washington DC", pct: 47 },
      { market: "Baltimore", pct: 25 },
      { market: "Las Vegas", pct: 18 },
    ],
  });
  check("LaToya profile patch (markets + pronouns) saves", pp.status === 200, `status=${pp.status} ${JSON.stringify(pp.data).slice(0, 160)}`);
}

// --- the gate ---
{
  const d = await chelsea.c.req("GET", "/api/discover?market=Nashville");
  check("approved founding CAN browse Discover", d.status === 200 && Array.isArray(d.data.creators), `status=${d.status}`);
  const fav = await chelsea.c.req("POST", "/api/favorites", { creatorId: realCreatorId });
  check("approved founding CAN favorite", fav.status === 200 && fav.data.isFavorite === true, `status=${fav.status} ${JSON.stringify(fav.data).slice(0, 120)}`);
  const pd = await pendingBiz.c.req("GET", "/api/discover?market=Nashville");
  check("pending founding still refused Discover", pd.status === 403, `status=${pd.status}`);
  const po = await pendingBiz.c.req("POST", "/api/offers", { title: "Nope", whatComped: "x", kind: "comp", dollarCap: 60, spots: 1 });
  check("pending founding still refused offers", po.status === 403, `status=${po.status}`);
  const bk = await chelsea.c.req("GET", "/api/bookings");
  check("founding still refused bookings", bk.status === 403, `status=${bk.status}`);
  const ms = await chelsea.c.req("GET", "/api/messages");
  check("founding still refused messages", ms.status === 403, `status=${ms.status}`);
  const bh = await chelsea.c.req("GET", "/api/me/business-home");
  // Build -80 (Jeff): the business PAGE opens for founding (her
  // card, editor, and preview read this payload); bookings and
  // messages above stay refused exactly as before.
  check("founding CAN load business-home for her page (Build -80)", bh.status === 200 && !!bh.data.business && bh.data.business.accessState === "founding", `status=${bh.status}`);
}

// --- drafts by law ---
let draftId = null;
let directDraftId = null;
{
  const o = await chelsea.c.req("POST", "/api/offers", { title: "Opening week tour", whatComped: "A tour and a shop on us", kind: "comp", dollarCap: 100, spots: 3, draft: false });
  check("founding create with draft:false still lands as draft", o.status === 201 && o.data.offer && o.data.offer.status === "draft", `status=${o.status} ${JSON.stringify(o.data).slice(0, 160)}`);
  draftId = o.data.offer && o.data.offer.id;
  const dd = await chelsea.c.req("POST", "/api/offers", { title: "Direct invite draft", whatComped: "Brunch for two on us", kind: "comp", dollarCap: 80, spots: 1, creatorId: realCreatorId, draft: false });
  check("founding direct invite also lands as draft", dd.status === 201 && dd.data.offer && dd.data.offer.status === "draft", `status=${dd.status}`);
  directDraftId = dd.data.offer && dd.data.offer.id;
  const mine = await chelsea.c.req("GET", "/api/offers");
  check("founding reads its own drafts back", mine.status === 200 && (mine.data.offers || []).some((x) => x.id === draftId && x.status === "draft"), `status=${mine.status}`);
  const creatorOffers = await realCreator.req("GET", "/api/offers");
  const visible = (creatorOffers.data.offers || []).some((x) => x.id === directDraftId);
  check("the direct draft is invisible to its creator", creatorOffers.status === 200 && !visible, `status=${creatorOffers.status} visible=${visible}`);
  const pub = await chelsea.c.req("POST", `/api/offers/${draftId}/publish`, {});
  check("founding publish refuses with the founding answer", pub.status === 403 && String((pub.data || {}).error || "").includes("founding list"), `status=${pub.status} ${JSON.stringify(pub.data).slice(0, 160)}`);
  const rb = await chelsea.c.req("POST", "/api/offers/rebook", { creatorId: realCreatorId });
  check("founding rebook refuses", rb.status === 403, `status=${rb.status} ${JSON.stringify(rb.data).slice(0, 140)}`);
  const ask = await chelsea.c.req("POST", "/api/sig/ask", { q: "what does my plan include?" });
  check("POST /sig/ask answers 200 for a founding business", ask.status === 200 && !!(ask.data && ask.data.source), `status=${ask.status} ${JSON.stringify(ask.data).slice(0, 140)}`);
}

// --- the demo fence inside founding Discover ---
{
  const load = await admin.req("POST", "/api/admin/demo-showcase/load", {});
  check("demo showcase loads", load.status === 200, `status=${load.status}`);
  const d = await chelsea.c.req("GET", "/api/discover?market=Nashville");
  const handles = (d.data.creators || []).map((c) => (c.profile || {}).handle);
  check("allowlisted founding business sees demos in Discover", DEMO_HANDLES.every((h) => handles.includes(h)), handles.slice(0, 16).join(","));
  check("real creators mix with the demos", handles.includes("realnash68"), handles.slice(0, 16).join(","));
  const dm = await maple.c.req("GET", "/api/discover?market=Nashville");
  const mHandles = (dm.data.creators || []).map((c) => (c.profile || {}).handle);
  check("non-allowlisted founding business sees NO demos", !DEMO_HANDLES.some((h) => mHandles.includes(h)), mHandles.slice(0, 16).join(","));
  const demoProfile = await chelsea.c.req("GET", "/api/c/tesstastestn");
  const demoId = demoProfile.data && demoProfile.data.profile && demoProfile.data.profile.creatorUserId;
  check("demo profile resolves for the allowlisted business", demoProfile.status === 200 && !!demoId, `status=${demoProfile.status}`);
  if (demoId) {
    const toDemo = await chelsea.c.req("POST", "/api/offers", { title: "Demo invite", whatComped: "A meal on us", kind: "comp", dollarCap: 75, spots: 1, creatorId: demoId, draft: true });
    const opened = toDemo.data && toDemo.data.offer && toDemo.data.offer.status === "open";
    check("a real offer to a demo never opens", !opened && (toDemo.status >= 400 || (toDemo.data.offer && toDemo.data.offer.status === "draft")), `status=${toDemo.status} ${JSON.stringify(toDemo.data).slice(0, 140)}`);
  }
}

// --- view-as: the walkthrough on Chelsea's record ---
{
  const enter = await admin.req("POST", `/api/admin/businesses/${chelseaId}/view`, {});
  check("admin enters view of Chelsea", enter.status === 200, `status=${enter.status}`);
  const d = await admin.req("GET", "/api/discover?market=Nashville");
  const handles = (d.data.creators || []).map((c) => (c.profile || {}).handle);
  check("view-as: Discover renders with demos + real mixed", d.status === 200 && handles.includes("tesstastestn") && handles.includes("realnash68"), `status=${d.status}`);
  const prof = await admin.req("GET", "/api/c/tesstastestn");
  check("view-as: a demo profile opens", prof.status === 200 && !!(prof.data.profile && prof.data.profile.handle === "tesstastestn"), `status=${prof.status}`);
  const offers = await admin.req("GET", "/api/offers");
  check("view-as: Campaigns reads render (drafts visible)", offers.status === 200 && (offers.data.offers || []).some((x) => x.id === draftId), `status=${offers.status}`);
  const save = await admin.req("POST", "/api/offers", { title: "View save attempt", whatComped: "x", kind: "comp", dollarCap: 60, spots: 1, draft: true });
  check("view-as: the draft SAVE refuses read-only (by design)", save.status === 403 && String((save.data || {}).error || "").includes(READ_ONLY_BIT), `status=${save.status} ${JSON.stringify(save.data).slice(0, 140)}`);
  const exit = await admin.req("POST", "/api/auth/exit-view", {});
  check("exit view restores admin", exit.status === 200 && exit.data.user && exit.data.user.role === "admin", `status=${exit.status}`);
}

// --- live market: activation, not the live flag, is the bar ---
{
  const tog = await admin.req("POST", "/api/admin/markets/toggle", { market: "Nashville", live: true });
  check("admin flips Nashville live (fixture)", tog.status === 200, `status=${tog.status}`);
  const o = await chelsea.c.req("POST", "/api/offers", { title: "Live-market draft", whatComped: "A shop on us", kind: "comp", dollarCap: 90, spots: 2, draft: false });
  check("in a LIVE market a founding create STILL lands as draft", o.status === 201 && o.data.offer && o.data.offer.status === "draft", `status=${o.status}`);
  const liveDraftId = o.data.offer && o.data.offer.id;
  const pub = await chelsea.c.req("POST", `/api/offers/${liveDraftId}/publish`, {});
  check("in a LIVE market founding publish STILL refuses", pub.status === 403 && String((pub.data || {}).error || "").includes("founding list"), `status=${pub.status} ${JSON.stringify(pub.data).slice(0, 160)}`);
  const rb = await chelsea.c.req("POST", "/api/offers/rebook", { creatorId: realCreatorId });
  check("in a LIVE market founding rebook STILL refuses", rb.status === 403, `status=${rb.status}`);
}

// --- profiles over HTTP ---
{
  const anon = new Client(BASE);
  const payload = await anon.req("GET", "/api/c/latoyafixture68");
  const p = payload.data && payload.data.profile;
  check("profile payload carries firstName + pronouns", !!p && p.firstName === "LaToya" && p.pronouns === "she/her", JSON.stringify(p && { firstName: p.firstName, pronouns: p.pronouns }));
  check("profile payload carries the 10K total + listed markets", !!p && p.totalAudience === 10000 && (p.listedMarkets || []).some((m) => m.market === "Washington DC" && m.pct === 47), JSON.stringify(p && p.listedMarkets));
  const page = await anon.raw("/c/latoyafixture68");
  check("server page renders", page.status === 200 && page.text.includes("bookme-name"), `status=${page.status}`);
  check("server page: first name + pronouns in the header", page.text.includes("LaToya · she/her"), page.text.slice(page.text.indexOf("bookme-name"), page.text.indexOf("bookme-name") + 120));
  check("server page: header stat carries the count", page.text.includes("5K followers"), "");
  check("server page: card names the home market", page.text.includes("of their audience is local to Richmond"), "");
  check("server page: DC chip carries its count", page.text.includes("Also ranked in Washington DC &middot; 47% &middot; 4.7K followers"), "");
  check("server page: breakdown line carries counts", page.text.includes("Washington DC 47% &middot; 4.7K followers"), "");
  const dc = await anon.raw("/c/latoyafixture68?market=Washington%20DC");
  check("server page ?market=DC: headline swaps to 47%", dc.text.includes('<span class="bm-num">47%</span>') && dc.text.includes("of their audience is local to Washington DC"), "");
  check("server page ?market=DC: home joins the chips with its count", dc.text.includes("Also ranked in Richmond &middot; 50% &middot; 5K followers") && !dc.text.includes("Also ranked in Washington DC &middot;"), "");
}

server.kill("SIGTERM");
console.log(`\nBuild -68: ${passed} passed, ${failed} failed`);
if (fails.length) console.log("Failures:\n - " + fails.join("\n - "));
process.exit(failed ? 1 : 0);
