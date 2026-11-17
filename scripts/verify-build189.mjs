#!/usr/bin/env node
// verify-build189.mjs — Build -189: the full-platform audit
// fold-in, Wave 2 (shell + design system + surface fixes).
// Pins per punch-list item:
//   PL-08 national one nav system + Maggie on National Home
//   PL-09 composer unification (dedupe, contrast, no blue border)
//   PL-11 creator counts: one labeled definition per surface +
//         the listed-from-elsewhere reconciliation (fixture)
//   PL-16 admin rooms open on skeletons, never bare "Loading..."
//   PL-25 design tokens: white + blue-to-green, one font system
//   PL-26 one primary button (black pill)
//   PL-27 custom controls on Find offers / Find creators /
//         Admin Biz Dev + Stats filters
//   PL-28 duplicated Find H1s removed
//   PL-29b editor per-section saves + trimmed microcopy
//   PL-30 no-photo creator cards carry the local-% treatment
//   PL-31 Stats: plain-language receipts, real chart, no leaks
//   PL-32 Requests: dev-only demo/test loaders, card-styled
//         Finish Engine, room re-scoped
//   PL-33 admin mobile pill row retired
//   PL-34 partner one nav system, unified labels
//   PL-35 Partner Home header matches the role pattern
//   PL-36 Biz Dev designed empty states
//   PL-38 retired campaign lane labeled as history
//   PL-39 shell pass: quiet menu rows, identity card at the
//         bottom of every menu, active marker in menus, rail
//         group labels, full bottom-bar labels
//   P3 cluster: PL-41/43/44/45/47/49/50/51/52/53/54/55/56/57/
//         58/60/62/64/65/66/67/69/70/71/72/73/74/76/79 pins +
//         PL-61 partner QR fixture + PL-49 queue-order unit
// Run: node scripts/verify-build189.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = path.join(os.tmpdir(), `signl-verify-build189-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PW = ["verify189", "admin", "pw"].join("-");
const PW = ["verify189", "user", "pw"].join("-");
process.env.ADMIN_PASSWORD = ADMIN_PW;
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
// PL-62's fixture needs the Connect rail "configured" so the
// route reaches the unsupported-country branch; the branch
// answers before any Stripe call, so a fake key never leaves
// the process.
process.env.STRIPE_SECRET_KEY = "sk_test_fake189";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const auth = require("../netlify/functions/lib/auth.js");
const sigdata = require("../netlify/functions/lib/sigdata.js");
const { handler } = require("../netlify/functions/api.js");

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log("  ok  " + name); }
  else { failed += 1; failures.push(name + (extra ? " :: " + extra : "")); console.log("  FAIL  " + name + (extra ? " :: " + extra : "")); }
}
function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({ httpMethod: method, path: url.pathname, headers, queryStringParameters: Object.fromEntries(url.searchParams.entries()), body: body === undefined ? null : JSON.stringify(body), isBase64Encoded: false });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let parsed = null;
    try { parsed = JSON.parse(res.body || "null"); } catch (e) { /* raw */ }
    return { status: res.statusCode, data: parsed, raw: res.body || "", headers: res.headers || {} };
  };
}
const seg = (src, a, b) => { const i = src.indexOf(a); if (i < 0) return ""; const j = b ? src.indexOf(b, i + a.length) : -1; return src.slice(i, j > i ? j : undefined); };

// ---------------- source pins ----------------
console.log("== source pins ==");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");
const bizJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/bizdev.js"), "utf8");
const sigJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/sigdata.js"), "utf8");
const buildJs = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/build.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const themeCss = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");
const theme2Css = fs.readFileSync(path.join(ROOT, "public/theme-v2.css"), "utf8");
const stylesCss = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

check("stamp: BUILD_ID is 2026.11.17-189", buildJs.includes('exports.BUILD_ID = "2026.11.17-189"'));
check("stamp: shell carries 2026.11.17-189 x5 (styles.css cache-bust moved with its content)", (indexHtml.match(/2026\.11\.17-189/g) || []).length === 5);

// PL-25: the token pass.
check("PL-25: orange-red accent is gone from theme-v3", !themeCss.includes("#FF4D00") && themeCss.includes("--accent: #006AFC"));
check("PL-25: app background token is pure white", themeCss.includes("--bg: #FFFFFF"));
check("PL-25: one font system (no Manrope anywhere)", !theme2Css.includes("Manrope") && !stylesCss.includes("Manrope") && !themeCss.includes("Manrope"));
check("PL-25: styles.css gradient is the canon logo gradient", stylesCss.includes("linear-gradient(92deg, #006AFC, #0AA6C2, #00B67A, #2FE07E)"));
check("PL-25: form group tint panels render white", themeCss.includes(".fgroup.tint { background: #fff; }"));
// PL-26: one primary button.
check("PL-26: ws-primary renders as the black pill", themeCss.includes(".btn.ws-primary { background: var(--black)") && !themeCss.includes(".btn.ws-primary { background: var(--grad)") && !theme2Css.includes(".counter-cta .btn.ws-primary { background: var(--mint)"));
// PL-08: national one nav system.
check("PL-08: national rail set is the national destination set", (() => { const i = appJs.indexOf("if (isNat178) {"); const s = appJs.slice(i, i + 1500); return s.includes('tab: "NatDiscover"') && s.includes('tab: "NatBrand"') && s.includes('label: "Brand profile"') && !s.includes('tab: "My Visits"') && !s.includes('tab: "Visits & Posts"') && !s.includes('tab: "Plan"'); })());
check("PL-08: the national in-page strip is retired", appJs.slice(appJs.indexOf("function natTabsHtml(active)"), appJs.indexOf("function natTabsHtml(active)") + 400).includes('return "";'));
check("PL-08: National Home leads with the Maggie card", seg(appJs, "function renderNationalBusinessDash", "function natEditCampaign").includes("sigHomeTopHtml()"));
check("PL-08: no duplicate in-card New campaign button on National Home", !seg(appJs, "function loadNatHome", "async function loadNatCampaigns").includes(">New campaign</button>"));
check("PL-08+44: National Home explains hand-raising in place", appJs.includes("Creators raise a hand to say they are interested. Nothing is booked and nothing ships until you pick."));
// PL-09: composer unification.
check("PL-09: template list dedupes against the play cards", seg(appJs, "function campStartRowsHtml", "function campRailHtml").includes("seenTpl189"));
check("PL-09: the one-off blue border on the Maggie guide box is gone", !seg(appJs, "function campaignGuideHtml", "function bizTemplatesHtml").includes("border:2px solid #006AFC"));
check("PL-09: both composers carry the shared white form class", appJs.includes('class="panel camp-form189" id="offer-composer"') && appJs.includes('class="camp-form189" onsubmit="return natSaveCampaign'));
check("PL-09: selected radio rows read dark on the selected fill", themeCss.includes("background: var(--accent-soft) !important; color: var(--ink) !important;"));
// PL-11: labels in place.
check("PL-11: Admin Markets card defines the launch count in place", appJs.includes("the launch count: approved creators who call this market home"));
check("PL-11: listed-from-elsewhere is explained on the card", appJs.includes("whose home market is elsewhere"));
check("PL-11: server rows carry creatorsListedFromElsewhere", routerJs.includes("creatorsListedFromElsewhere"));
// PL-16: skeletons, never a bare Loading...
check("PL-16: renderAdmin opens rooms on a skeleton", (() => { const s = appJs.slice(appJs.indexOf("function renderAdmin() {"), appJs.indexOf("function renderAdmin() {") + 3200); return s.includes('skelHtml("Loading this room..."') && !s.includes('<p class="muted">Loading...</p>'); })());
check("PL-16: skeleton wrapper carries real height", themeCss.includes(".skel-wrap { min-height: 120px; }"));
// PL-33: admin pill row retired.
check("PL-33: syncAdminSecbar121 only ever removes the row", (() => { const s = appJs.slice(appJs.indexOf("function syncAdminSecbar121()"), appJs.indexOf("function syncAdminSecbar121()") + 500); return s.includes("bar.remove()") && !s.includes("createElement"); })());
check("PL-33: the secbar can never render under the admin shell", themeCss.includes("body.admin-on #admin-secbar { display: none !important; }"));
// PL-34: partner one system + labels.
check("PL-34: the partner in-page pill strip is retired", appJs.slice(appJs.indexOf("function partnerStrip119(tab)"), appJs.indexOf("function partnerStrip119(tab)") + 300).includes('return "";'));
check("PL-34: bar label for Performance is Reports", appJs.includes('Performance: "Reports"'));
check("PL-34: Businesses keeps its full name in the bar", appJs.includes('RAIL_SHORT["Businesses"] = "Businesses"'));
check("PL-34: the Performance page title is Reports", appJs.includes('wsHead("Reports"'));
check("PL-34: business Start reads Start a campaign", appJs.includes('RAIL_SHORT["Campaign Setup"] = "Start a campaign"'));
check("PL-34: business Find reads Find creators", appJs.includes('Discover: "Find creators"'));
// PL-35: Partner Home header.
check("PL-35: Partner Home title is Home with a greeting line", (() => { const s = seg(appJs, "function partnerHomeHtml", "function partnerLinksHtml"); return s.includes('wsHead("Home"') && s.includes("home-greet") && s.includes("hg-hi"); })());
check("PL-45: the modeled-share line lives on Wallet only, not Home", !seg(appJs, "function partnerHomeHtml", "function partnerEarningsHtml").includes("atFill") && seg(appJs, "function partnerEarningsHtml", "function partnerLinksHtml").includes("atFill"));
// PL-39: shell pass.
check("PL-39: menu identity card carries the avatar", seg(appJs, "function menuIdentityCard187", "function openHamburger137").includes("mi-ava189"));
check("PL-39: Everything rows mark the current destination", seg(appJs, "function everythingRowHtml125", "function everythingGroups125").includes("row-on187"));
check("PL-39: rails carry group labels", appJs.includes("function railGroup189") && themeCss.includes(".rail-group189"));
check("PL-39: menu rows are quiet (no chevron, no heavy tile)", themeCss.includes(".more-row .more-chev { display: none; }") && themeCss.includes(".more-row {\n  border: 0; background: transparent; box-shadow: none; border-radius: 12px;"));
// PL-27: custom controls.
check("PL-27: Find creators selects carry the app treatment", appJs.includes('id="f-market" class="ctl189"') && appJs.includes('id="f-tier" class="ctl189"'));
check("PL-27: Biz Dev filter selects carry the app treatment", appJs.includes('<select class="ctl189" onchange="abdSetLeadFilter('));
check("PL-27: Stats filter selects carry the app treatment", appJs.includes('class="ctl189" onchange="ccSetPeriod') && appJs.includes('class="ctl189" onchange="astSetFilter'));
check("PL-27: the control treatment exists in CSS", themeCss.includes("select.ctl189") && themeCss.includes(".rail-row input[type=\"radio\"]"));
// PL-28: duplicated titles gone.
check("PL-28: no duplicated Find titles in the sub-header rows", !appJs.includes('<span class="tb-title">Find offers</span>') && !appJs.includes('<span class="tb-title">Find creators</span>'));
// PL-29: editor.
check("PL-29a: the pitch helper reads Maggie, never Sig", appJs.includes('T("Draft it with Maggie"') && !appJs.includes("Draft it with Sig"));
check("PL-29b: five per-section save rows in the editor", (appJs.match(/sec-save189/g) || []).length >= 5);
check("PL-29b: the save bar never clips content", themeCss.includes("#tab-body form .save-bar { margin-bottom: 14px;"));
// PL-30: no-photo treatment.
check("PL-30: no-photo cards carry the gradient local-% visual", appJs.includes("cc-mono189") && appJs.includes("dcard-mono189") && themeCss.includes(".cc-photo.no-photo, .dcard-photo.no-photo {") && themeCss.includes("background: var(--grad) !important; border: 0;"));
check("PL-30: the Find creators shelf tile gets the same treatment", appJs.includes("shelf-nophoto189") && themeCss.includes(".shelf-photo .shelf-nophoto189"));
// PL-31: Stats language.
check("PL-31: receipts render in plain words", seg(appJs, "function astReceiptLine", "function astLoadSuggestions").includes("words189") && seg(appJs, "function astReceiptLine", "function astLoadSuggestions").includes("the oldest has waited"));
check("PL-31: the UI-philosophy meta-paragraph is gone", !appJs.includes("Every button is a door, not a trigger"));
check("PL-31: the signups chart is a real chart (axis + fill)", appJs.includes("function astChart189") && appJs.includes("astChart189(buckets)"));
// PL-32: Requests room.
check("PL-32: demo/test loaders are behind the dev-only gate", appJs.includes("const devPanels189") && appJs.includes("if (devPanels189)"));
check("PL-32: the room names itself the finishing room", appJs.includes("The finishing room: approved creators whose profiles are not finished yet"));
check("PL-32: the Finish Engine renders as a card", seg(appJs, "function adminFinishPanelHtml", "async function refreshAdminFinishPanel").includes('class="panel"'));
// PL-36: Biz Dev empty states.
check("PL-36: designed empty states exist and carry actions", appJs.includes("function abdEmpty189") && appJs.includes('abdEmpty189("search", "No leads match those filters"'));
check("PL-36: no bare one-line empties remain in the fresh book", !appJs.includes(">No seats yet.<") && !appJs.includes('DNC list</h4><p class="muted">None.</p>'));
// PL-38: retired lane.
check("PL-38: a retired lane's stored error is labeled history", appJs.includes("Retired lane:") && appJs.includes("history, not the current state"));
// PL-41: founding Status copy.
check("PL-41: Status names what opens when, no dead-end line", appJs.includes("Offers land the day your market opens, and visits follow from there") && !appJs.includes("Nothing is live yet and nothing is due. Your profile, your messages and Maggie are open now."));
// PL-43: plan fallback.
check("PL-43: a missing stored plan name falls back honestly", appJs.includes('"No plan picked yet"') && appJs.includes("planObj189"));
// PL-47: BD home dedupe + progress up top.
check("PL-47: queue drops doors already on today's route", appJs.includes("stopIds189") && appJs.includes("queue189"));
check("PL-47: founding progress renders above Today's visits", (() => { const s = seg(appJs, "async function bdLoadHome", "async function bdCoachSend"); const a = s.indexOf("founding progress"); const b = s.indexOf("Today's visits"); return a > 0 && b > a; })());
// PL-49: queue order (source side).
check("PL-49: home chips are bucketed decisions, messages, gaps, expiry, status", sigJs.includes("one queue order for business and") && sigJs.includes("waiting on your reply"));
check("PL-49: the home endpoint feeds the unread count", routerJs.includes("facts.unreadThreads = await unreadThreadCount(user)"));
// PL-50: first-use glosses.
check("PL-50: Deals and Folders explain themselves in place", appJs.includes("A deal is a one-to-one offer between one business and one creator") && appJs.includes("Folders are labels you make"));
// PL-51: register wording.
check("PL-51: the till question is asked in plain words everywhere", appJs.includes("What do you use at the register? (optional)") && routerJs.includes('"Tell us what you use at the register"') && !routerJs.includes("Tell us which till you run"));
check("PL-51: the founding badge carries no em dash", appJs.includes("Founding offer: $100 credit, and your first month is") && !appJs.includes("FOUNDING: $100 CREDIT"));
// PL-52: Applicants naming.
check("PL-52: the business rail row is Applicants", appJs.includes('add("a", "inbox", "Applicants"'));
check("PL-52: the applicants page head is Applicants", appJs.includes('wsHead("Applicants", { sub: "Creators waiting on your decision." })') && !seg(appJs, "async function renderRequestsTab", "function reqFiltered").includes('wsHead("Requests"'));
// PL-53: market lock + tier gloss.
check("PL-53: Find creators market options respect the account", appJs.includes("function discoverMarketOptions189"));
check("PL-53: tiers are glossed in place", appJs.includes("Tiers are audience-size bands, smallest to biggest"));
// PL-54: national reports distinction.
check("PL-54: reports lead with the home vs listed distinction", appJs.includes("Two views of the same hands"));
// PL-55: partner brand logo fails soft.
check("PL-55: a dead partner logo removes itself instead of showing broken", appJs.includes('class="pt-brand-logo" src="${esc(brand.logoUrl)}" alt="" onerror="this.remove()"'));
// PL-56: admin menu order + the missing Markets row.
check("PL-56: the Everything panel carries the Markets row", seg(appJs, "function everythingGroups125", "function openEverything125").includes('"Markets", "Every market, ranked"'));
// PL-57: HQ Sell layering named.
check("PL-57: the BD drawer names Sell mode for the HQ seat", appJs.includes("Sell mode (your HQ seat)"));
// PL-58: queue reasons.
check("PL-58: generic queue reasons are gone", !bizJs.includes("Easy to reach") && !bizJs.includes("Owner's name is on file") && !bizJs.includes("In your book, ready when you are"));
check("PL-58: specific reasons survive", bizJs.includes("Warm intro") && bizJs.includes("Their follow-up is late"));
// PL-60: categories refuse loudly.
check("PL-60: an unknown category refuses the save, naming the values", routerJs.includes("These categories are not on the list"));
// PL-62: concierge payout state.
check("PL-62: unsupported payout country answers a concierge state", routerJs.includes("concierge: true") && routerJs.includes("handled with help from the Magpie team"));
check("PL-62: the client shows the concierge message as information", appJs.includes("if (data && data.message) { laneErr(data.message); return false; }"));
// PL-64/65: one brand, no signed-in footer.
check("PL-64: the floated brand lockup stands down beside the rail", themeCss.includes("body.v3-on .tb2-brand { display: none !important; }"));
check("PL-65: the marketing footer never renders inside the app", themeCss.includes("body.v3-on .footer, body.v3-slim .footer { display: none !important; }"));
// PL-66: desktop width.
check("PL-66: national home goes two-column on desktop", themeCss.includes("#nat-home { display: grid; grid-template-columns: 1fr 1fr;"));
// PL-67: phone type floor.
check("PL-67: phone body type steps up", themeCss.includes("body.v3-on, body.v3-slim { font-size: 15.5px; }"));
// PL-69: Find offers rail honesty.
check("PL-69: empty categories hide; distance bands fold away", appJs.includes("catCount(x) > 0 || cat === x") && appJs.includes("rail-details189"));
// PL-70: national composer examples.
check("PL-70: composer placeholders show real examples", appJs.includes('placeholder="For example: Try our best seller, free"') && themeCss.includes(".camp-form189 input::placeholder"));
check("PL-08: the founding lock on national Find creators survives in the shell", seg(appJs, "function navLock187", "function navLockedTap187").includes('tab === "NatDiscover"') && seg(appJs, "function tabBarHtml", "function renderBottomNav").includes("navLock187(it.tab)"));
// PL-71: next-steps dedupe.
check("PL-71: the till prompt leaves the Next list when the checklist shows", appJs.includes('t.indexOf("Tell us which till you run") === 0'));
check("PL-71: founding Home drops its About nudge beside the checklist", appJs.includes('(it.text || "").indexOf("Your business page has no story yet") === 0'));
// PL-72: market-named placeholders.
check("PL-72: neighborhood placeholders name the reader's own market", (appJs.match(/For example: a neighborhood in \$\{esc\(u\.market/g) || []).length >= 2 && !appJs.includes("virginiabeach eatslocal"));
// PL-73: Stats filter width.
check("PL-73: Stats selects size to their content", themeCss.includes(".sr-sel select { min-width: 168px; }"));
// PL-74: Stats internals.
check("PL-74: the Square panel states connection, not credentials", appJs.includes("Square is connected on the server") && !appJs.includes("Server does not carry the Square app credentials"));
check("PL-74: funnel bars carry the brand gradient", themeCss.includes(".fn2-bar i { background: var(--grad) !important; }"));
// PL-76: BD header names book + seat.
check("PL-76: BD home header shows Viewing + seat", appJs.includes("Viewing: ${esc(d.rep.marketName)} · Your seat: ${esc(d.rep.repCode"));
// PL-79: opaque sticky headers.
check("PL-79: sticky bars are opaque, no blur", themeCss.includes("#topbar2, #tabbar { -webkit-backdrop-filter: none; backdrop-filter: none; }"));

// ---------------- fixtures ----------------
console.log("== fixtures ==");
async function user(id, role, name, email, extra = {}) {
  const { salt, hash } = auth.hashPassword(PW);
  const rec = { id, role, name, email, passwordSalt: salt, passwordHash: hash, status: "approved", createdAt: "2026-11-10T00:00:00.000Z", ...extra };
  await store.set(`user:${id}`, rec);
  await store.set(`email:${email}`, { userId: id });
  return rec;
}
const ADMIN = "v189-admin";
await user(ADMIN, "admin", "Jeff Rimmer", "jeff@joinsignl.com");
{ const h = auth.hashPassword(ADMIN_PW); const a = await store.get(`user:${ADMIN}`); a.passwordSalt = h.salt; a.passwordHash = h.hash; await store.set(`user:${ADMIN}`, a); }

function creatorRec(id, market, extra = {}) {
  return {
    id, role: "creator", name: `Creator ${id}`, email: `${id}@fixtures.dev`, status: "approved",
    market, city: market, createdAt: "2026-11-10T00:00:00.000Z", reviewedAt: "2026-11-11T00:00:00.000Z",
    creator: {
      handle: `h_${id}`, categories: ["Food & Drink"], localAudiencePct: 55,
      audienceStack: { instagram: 5000 }, followerCount: 5000, totalAudience: 5000,
      hasPhoto: false, bio: "", bestWork: [], publicPage: true, profileComplete: true,
      ...(extra.creator || {}),
    },
    ...(extra.user || {}),
  };
}
// PL-11 known composition: one NYC-home creator; one Nashville-home
// creator ALSO listed in NYC (20% audience share there).
await store.set("user:v189-nyc-home", creatorRec("v189-nyc-home", "New York City"));
await store.set("user:v189-nash-else", creatorRec("v189-nash-else", "Nashville", { creator: { audienceMarkets: [{ market: "New York City", pct: 20 }] } }));
// PL-60/62 creator: Dubai market (no self-serve payout country),
// rate listed so the payout step is reachable.
await user("v189-dubai", "creator", "Dubai Creator", "dubai189@fixtures.dev", { market: "Dubai", city: "Dubai", creator: { handle: "dubai189", categories: ["Food & Drink"], localAudiencePct: 40, audienceStack: { instagram: 8000 }, followerCount: 8000, totalAudience: 8000, hasPhoto: false, bio: "", bestWork: [], publicPage: true, profileComplete: true, paidRate: 150 } });
await store.set("email:dubai189@fixtures.dev", { userId: "v189-dubai" });
// PL-61 partner.
await user("v189-partner", "partner", "Pat Partner", "partner189@fixtures.dev", { market: "Nashville", partner: { name: "Fixture Media Co", code: "FIXTURE189", type: "media", contactName: "Pat Partner", markets: ["Nashville"], status: "active", agreementStatus: "signed", agreementSignedAt: "2026-11-01T00:00:00.000Z", demo: false } });

const admin = makeClient(); await admin("POST", "/api/auth/login", { email: "jeff@joinsignl.com", password: ADMIN_PW });

// ---------------- PL-11 fixture ----------------
console.log("== PL-11 counts fixture ==");
{
  const mk = await admin("GET", "/api/admin/markets");
  const nyc = (mk.data.markets || []).find((m) => m.name === "New York City");
  check("NYC approved (home-market definition) counts the NYC-home creator", !!nyc && nyc.creatorsApproved === 1, JSON.stringify(nyc || {}).slice(0, 240));
  check("NYC listed count includes the creator listed from Nashville", !!nyc && nyc.creatorsListed === 2, JSON.stringify(nyc || {}).slice(0, 240));
  check("NYC row reports exactly 1 listed-from-elsewhere (the reconciliation)", !!nyc && nyc.creatorsListedFromElsewhere === 1, JSON.stringify(nyc || {}).slice(0, 240));
  const nash = (mk.data.markets || []).find((m) => m.name === "Nashville");
  check("Nashville approved counts its home creator; its elsewhere count is 0", !!nash && nash.creatorsApproved === 1 && nash.creatorsListedFromElsewhere === 0, JSON.stringify(nash || {}).slice(0, 240));
}

// ---------------- PL-60 fixture ----------------
console.log("== PL-60 categories fixture ==");
{
  const c = makeClient(); await c("POST", "/api/auth/login", { email: "dubai189@fixtures.dev", password: PW });
  const bad = await c("PATCH", "/api/me/profile", { categories: ["Food & Drink", "Bogus Category 189"] });
  check("an unknown category refuses the save with a 400 naming it", bad.status === 400 && /Bogus Category 189/.test(bad.data.error || ""), `status=${bad.status} ${JSON.stringify(bad.data).slice(0, 200)}`);
  const rec = await store.get("user:v189-dubai");
  check("nothing was saved by the refused PATCH", JSON.stringify(rec.creator.categories) === JSON.stringify(["Food & Drink"]), JSON.stringify(rec.creator.categories));
  const good = await c("PATCH", "/api/me/profile", { categories: ["Food & Drink", "Nightlife"] });
  check("a fully canonical category list still saves", good.status === 200, `status=${good.status} ${JSON.stringify(good.data).slice(0, 160)}`);
}

// ---------------- PL-62 fixture ----------------
console.log("== PL-62 payout concierge fixture ==");
{
  const c = makeClient(); await c("POST", "/api/auth/login", { email: "dubai189@fixtures.dev", password: PW });
  const r = await c("POST", "/api/me/payouts/start", {});
  check("Dubai payout start answers 200 with the concierge state, not a 503", r.status === 200 && r.data.concierge === true && /Magpie team/.test(r.data.message || ""), `status=${r.status} ${JSON.stringify(r.data).slice(0, 240)}`);
}

// ---------------- PL-61 fixture ----------------
console.log("== PL-61 partner QR fixture ==");
{
  const p = makeClient(); await p("POST", "/api/auth/login", { email: "partner189@fixtures.dev", password: PW });
  const qr = await p("GET", "/api/partner/qr?kind=creator&market=Nashville");
  check("partner QR renders an SVG on this codebase (the 501 premise does not reproduce)", qr.status === 200 && String(qr.headers["Content-Type"] || "").includes("image/svg+xml") && qr.raw.includes("<svg"), `status=${qr.status} ct=${qr.headers["Content-Type"]}`);
}

// ---------------- PL-49 unit ----------------
console.log("== PL-49 queue order unit ==");
{
  const facts = {
    unreadThreads: 2, localAudiencePct: null, headlineSet: false, breakdownSet: false,
    headlineMissing: true, publicPage: false, profileComplete: false, offersOpen: 3,
    directInvites: 1, postsOwed: 0, founding: false, marketLive: false,
  };
  const home = sigdata.buildHomeState("creator", facts);
  const chips = home.chips || [];
  const iMsg = chips.findIndex((c) => /waiting on your reply/.test(c));
  const iGap = chips.findIndex((c) => /Add your local audience/.test(c));
  const iDec = chips.findIndex((c) => /invite/.test(c));
  check("decisions come before messages, messages before profile gaps", iDec >= 0 && iMsg > iDec && iGap > iMsg, chips.join(" | "));
  const noMsg = sigdata.buildHomeState("creator", { ...facts, unreadThreads: 0 });
  check("no unread threads, no message chip is invented", !(noMsg.chips || []).some((c) => /waiting on your reply/.test(c)), (noMsg.chips || []).join(" | "));
}

console.log(`\nBUILD189 VERIFY: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
