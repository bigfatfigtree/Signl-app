// Build -226 UPDATE PASS client verification: final feed cards
// (straddle overlay, gradient city, price once, creator chips,
// checks row), the match badge + explainer sheet, favorites and
// the Saved area against the landed server contract
// (POST /favorites { kind, id }; GET /favorites { creators,
// businesses, offers, savedIds }), final profile heroes with
// aligned stats and account columns, the business Photos section
// and editor, CTA and label sweeps, Spanish twins, and the four
// reviewer fixes (stats contract fields, walkthrough platform
// reason, ES walkthrough body, license-ask cancel).
import { readFileSync } from "node:fs";
import vm from "node:vm";

const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("../public/theme-v3.css", import.meta.url), "utf8");
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok -", name); }
  else { fail++; console.log("  FAIL -", name); }
}
const count = (s, sub) => String(s).split(sub).length - 1;

const start = appJs.indexOf("/* BUILD226-START */");
const end = appJs.indexOf("/* BUILD226-END */");
const mod = appJs.slice(start, end);
const updStart = appJs.indexOf("/* Build -226 UPDATE PASS");
const upd = appJs.slice(updStart, end);
check("update module present inside the BUILD226 markers", updStart > start && updStart < end);
check("no em dash or en dash in the update module", !/[—–]/.test(upd));
check("update module carries no hard-coded local image paths (photos ride payload URLs)", !/src="\/[^"]*\.(png|jpe?g|webp)/.test(upd));

// ---------- sandbox ----------
let esMode = false;
let confirmResult = true;
const store = new Map();
const els = {};
function elStub(id) {
  if (!els[id]) els[id] = { id, className: "", innerHTML: "", textContent: "", style: {}, value: "", classList: { toggle: () => {}, add: () => {}, remove: () => {} }, setAttribute: () => {}, getAttribute: () => null, addEventListener: () => {}, appendChild: () => {}, querySelector: () => null, remove: () => { delete els[id]; } };
  return els[id];
}
let lastSheet = null;
let apiImpl = async () => ({});
const apiCalls = [];
const sandbox = {
  console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  fetch: () => Promise.resolve({ ok: true, json: async () => ({}) }),
  state: {
    user: { id: "u1", name: "Maya Reyes", role: "business" },
    lang: "en", j226rev: {}, j226range: null, j226biz: null, j226cr: null, j226booking: null,
    discover: [], openOffers: [], bizGalleryV: 0, bizProfileView: null,
  },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  },
  document: {
    getElementById: (id) => elStub(id),
    createElement: () => ({ id: "", className: "", innerHTML: "", style: {}, addEventListener: () => {}, remove: () => {} }),
    body: { appendChild: (el) => { lastSheet = el; els[el.id] = el; } },
  },
  Notification: { permission: "denied" },
  window: { confirm: () => confirmResult, scrollTo: () => {} },
  esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;"),
  fmtPrice: (n) => (Number(n) % 1 ? Number(n).toFixed(2) : String(Math.round(Number(n)))),
  fmtNum: (n) => String(Number(n) || 0),
  fmtFull: (n) => Math.round(Number(n) || 0).toLocaleString("en-US"),
  fmtDate: (ts) => new Date(ts).toISOString().slice(0, 10),
  fmtDay: (ts) => new Date(ts).toISOString().slice(0, 10),
  fmtDayFull: (ts) => new Date(ts).toISOString().slice(0, 10),
  primaryMetaClient: () => ({ platform: "Instagram", handle: "@maya" }),
  primaryLabelClient: (p) => (p ? String(p).charAt(0).toUpperCase() + String(p).slice(1) : "Instagram"),
  PRIMARY_PLATFORMS_CLIENT: ["Instagram", "TikTok", "YouTube"],
  deliverablesOfClient: () => "",
  deliverablePhraseClient: () => "the visit",
  disclosureLine: () => "Paid partnership with the business. #ad",
  successCheckHtml: () => "OK",
  couponSummaryClient: () => "",
  PLATFORM_LABELS_ALL: { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" },
  stackList: (profile) => {
    const chans = (profile && profile.channels) || (profile && profile.profile && profile.profile.channels) || [];
    return chans.map((c) => ({ platform: c.platform, label: c.label, handle: c.handle || "", count: c.followers, localPct: c.localPct, url: c.url || "" }));
  },
  workItemsOf: () => [],
  videoEmbedFor: () => null,
  currencySymbolForMarket: () => "$",
  sigLang: () => (esMode ? "es" : "en"),
  T: (en, es) => (esMode && es ? es : en),
  ST: (en, es) => (esMode && es ? es : en),
  mirrorPriceLine: (o) => (o.kind === "paid" ? { main: "$" + (o.cashRate || 0) + " paid", sub: "" } : { main: "$" + (o.dollarCap || 0) + " comped", sub: "" }),
  api: (m, p, b) => { apiCalls.push({ m, p, b }); return apiImpl(m, p, b); },
  showToast: () => {},
  go: () => false,
  render: () => {},
  applyToOffer: () => false,
  requestLicense: async () => { const a = sandbox.window.confirm("Ask for the license?"); return a; },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(mod, sandbox);
const M = sandbox;

// ---------- fixtures (server payload shapes, as landed) ----------
const CREATOR = {
  userId: "cr1", name: "Priya Nair", city: "Nashville", neighborhood: "East Nashville", market: "Nashville",
  photoUrl: "https://img.example/priya.jpg",
  photos: ["https://img.example/priya.jpg", "https://img.example/p2.jpg", "https://img.example/p3.jpg"],
  profile: { categories: ["Food", "Lifestyle"], compOpen: true, couponOpen: false, paidRate: 150, bio: "Nashville food, honestly.", localAudiencePct: 62, avgViews: 4200 },
  channels: [
    { platform: "instagram", label: "Instagram", handle: "@priyaeats", url: "https://instagram.com/priyaeats", followers: 12400, localPct: 62 },
    { platform: "tiktok", label: "TikTok", handle: "@priyaeats", url: "https://tiktok.com/@priyaeats", followers: 9100, localPct: 55 },
  ],
  totalAudience: 21500,
  ratingAvg: 4.9, ratingCount: 12,
  trackRecord: { visitsCompleted: 7 },
  matchScore: 92,
  matchReasons: ["62% of her audience is in Nashville", "Posts your kind of thing"],
  match: {
    score: 92,
    reasons: ["62% of her audience is in Nashville", "Posts your kind of thing"],
    parts: { localPct: 88, category: 95, budget: 80, reliability: 100, momentum: 64, trackBonus: 5 },
    inputs: [
      { key: "local", label: "Local audience", value: 88 },
      { key: "category", label: "Category fit", value: 95 },
      { key: "budget", label: "Rate fit", value: 80 },
      { key: "reliability", label: "On-time record", value: 100 },
      { key: "momentum", label: "Momentum", value: 64 },
    ],
  },
  isFavorite: false,
};
const BIZCARD = {
  userId: "biz1", businessId: "biz1", name: "Juniper Table", businessName: "Juniper Table",
  category: "Restaurant", market: "Nashville", city: "Nashville", neighborhood: "The Gulch",
  about: "Seasonal plates, natural wine.", photoUrl: "https://img.example/juniper.jpg",
  photos: ["https://img.example/juniper.jpg", "https://img.example/j2.jpg"],
  channels: [{ platform: "instagram", label: "Instagram", handle: "@junipertable", url: "https://instagram.com/junipertable", followers: null, localPct: null }],
  viewerSaved: true,
};
const OFFER = {
  id: "of1", businessId: "biz1", businessName: "Juniper Table", businessCity: "Nashville", businessNeighborhood: "The Gulch",
  category: "Restaurant", title: "Dinner for two, on us", kind: "comp", dollarCap: 75, spots: 3, filledCount: 1,
  distanceBand: "1.2 mi", businessImageUrl: "https://img.example/juniper.jpg", businessImageIsLogo: false,
  viewerSaved: false, businessViewerSaved: false,
  businessTrackRecord: { visitsHosted: 4, creatorsReturned: 2, onTimePct: 100 },
};

// ---------- item 1: creator feed card, final structure ----------
const card = M.feedCreatorCard226Html(CREATOR);
check("creator card: final card shell + full-bleed photo", card.includes('data-u226="creator-card"') && card.includes('class="u226-photo"') && card.includes('src="https://img.example/priya.jpg"'));
check("creator card: straddle overlay carries name, category, gradient city", card.includes('class="u226-straddle j226-heroid"') && card.includes("Priya Nair") && card.includes("Food") && card.includes('<span class="u226-citygrad">East Nashville, Nashville</span>'));
check("creator card: price shown once", count(card, "$150") === 1 && card.includes("paid visit rate"));
check("creator card: chips are local %, local followers count, total followers", card.includes("62% local") && card.includes("12,693 local followers") && card.includes("21.5k total followers"));
check("creator card: checks row states, no amount in the Paid check", card.includes('data-u226="checks"') && count(card, "u226-check on") === 2 && count(card, "u226-check") >= 3);
const checksSlice = card.slice(card.indexOf('data-u226="checks"'), card.indexOf('data-u226="checks"') + 700);
check("creator card: Paid check carries no price", !checksSlice.includes("$150") && checksSlice.includes("Paid"));
check("creator card: Book [first name] primary + See profile secondary", card.includes("Book Priya") && card.includes("See profile") && card.includes("u226-secondary"));
check("creator card: bookmark button present, unsaved state", card.includes('data-u226="fav-btn"') && card.includes('data-fav-type="creator"') && card.includes('aria-pressed="false"'));
check("creator card: no neighbors wording, no Create an offer", !/neighbors/i.test(card) && !card.includes("Create an offer"));

// ---------- item 1: offer feed card ----------
const ocard = M.feedOfferCard226Html(OFFER);
check("offer card: business photo full-bleed + straddle with gradient city", ocard.includes('<img src="https://img.example/juniper.jpg"') && ocard.includes('class="u226-straddle j226-heroid"') && ocard.includes('<span class="u226-citygrad">The Gulch, Nashville</span>'));
check("fix 1: offer card article carries no colliding mirror/j226 classes", ocard.startsWith('<article class="u226-card" data-u226="offer-card">') && !ocard.includes("mirror-card") && !ocard.includes("j226-hero-card") && !ocard.includes("mirror-lead") && !ocard.includes("mirror-cover") && !ocard.includes("mirror-body") && !ocard.includes("mirror-price") && !ocard.includes("mirror-acts"));
check("fix 1: the row rule still exists for journey hero cards but requires both colliding classes, so it can never match a u226 card", /\.mirror-card\.j226-hero-card \{[^}]*flex-direction: row/.test(themeCss));
check("fix 1: saved offers render through the same fixed card", M.savedView226Html({ offers: [OFFER] }).includes('<article class="u226-card" data-u226="offer-card">'));
check("fix 2: offer card business name taps through to the business profile", ocard.includes("openBusiness226('biz1')") && ocard.includes('class="u226-namelink"'));
check("offer card: price shown once", count(ocard, "$75") === 1);
check("offer card: Apply primary + See full offer secondary", ocard.includes(">Apply</button>") && ocard.includes("See full offer"));
check("offer card: track strip renders when a record exists", ocard.includes("mirror-track") && ocard.includes("creator visits hosted here"));
check("offer card: no track strip without a record", !M.feedOfferCard226Html({ ...OFFER, businessTrackRecord: null }).includes("mirror-track"));
check("offer card: bookmark rides viewerSaved (unsaved)", ocard.includes('data-fav-type="offer"') && ocard.includes('aria-pressed="false"'));
check("offer card: bookmark filled when viewerSaved", M.feedOfferCard226Html({ ...OFFER, viewerSaved: true }).includes('aria-pressed="true"'));
check("offer card: no neighbors wording, no Create an offer", !/neighbors/i.test(ocard) && !ocard.includes("Create an offer"));

// ---------- item 1: business card (Saved + feeds) ----------
const bcard = M.feedBusinessCard226Html(BIZCARD);
check("business card: straddle + gradient city + See open offers", bcard.includes('data-u226="business-card"') && bcard.includes('<span class="u226-citygrad">The Gulch, Nashville</span>') && bcard.includes("See open offers"));
check("business card: bookmark filled from viewerSaved", bcard.includes('data-fav-type="business"') && bcard.includes('aria-pressed="true"'));

// ---------- item 2: match badge + explainer sheet ----------
check("match badge: score, MATCH label, info affordance, opens the sheet", card.includes('class="u226-matchbadge"') && card.includes('<span class="u226-matchscore">92</span>') && card.includes("MATCH") && card.includes("openMatchInfo226('cr1')"));
lastSheet = null;
M.openMatchInfo226("cr1");
const sheet = lastSheet ? lastSheet.innerHTML : "";
check("match sheet: opens through the sheet host with the explainer", sheet.includes('data-u226="match-sheet"') && sheet.includes("What is a match score?") && sheet.includes("scored out of 100"));
check("match sheet: the five inputs with this creator's values", ["Local audience", "Category fit", "Rate fit", "On-time record", "Momentum"].every((s) => sheet.includes(s)) && [88, 95, 80, 100, 64].every((v) => sheet.includes('<strong class="u226-inputval">' + v + "</strong>")));
check("match sheet: her reason lines + why line + star note + Got it", sheet.includes("62% of her audience is in Nashville") && sheet.includes("Posts your kind of thing") && sheet.includes("Why") && sheet.includes("Priya") && sheet.includes("scores") && sheet.includes("92") && sheet.includes("The star rating from past visits lives on their profile.") && sheet.includes("Got it"));
check("match badge: flat matchScore fallback renders without the match object", M.feedCreatorCard226Html({ ...CREATOR, match: null }).includes('<span class="u226-matchscore">92</span>'));
check("match badge: absent when no score rides the payload", !M.feedCreatorCard226Html({ ...CREATOR, match: null, matchScore: null, matchReasons: [] }).includes("u226-matchbadge"));
check("match badge also rides the creator profile hero", M.heroCreator226Html(CREATOR).includes("u226-matchbadge"));
check("match badge also rides the business profile hero when a score rides", M.heroBusiness226Html({ ...BIZCARD, match: { score: 77, reasons: [], parts: null } }).includes('<span class="u226-matchscore">77</span>'));

// ---------- item 4: creator profile hero ----------
const hero = M.heroCreator226Html(CREATOR);
check("creator hero: full-bleed photo with the white fade carrying identity", hero.includes('data-u226="creator-hero"') && hero.includes('class="u226-herophoto"') && hero.includes('class="u226-fade"') && hero.includes("Nashville food, honestly."));
check("fix 5d: creator hero shows the FIRST name only (locked render 24-v8)", hero.includes('<div class="u226-heroname">Priya</div>') && !hero.includes("Priya Nair"));
check("fix 5e: stats row is label above number (locked renders)", hero.indexOf('data-u226="stats-row"') > -1 && hero.indexOf("u226-statlbl", hero.indexOf('data-u226="stats-row"')) < hero.indexOf("u226-statnum", hero.indexOf('data-u226="stats-row"')));
check("creator hero: star rating in the fade (profiles keep stars)", hero.includes("&#9733; 4.9") && hero.includes("12") && hero.includes("visits"));
check("creator hero: Book [first name] in the fade + social icons", hero.includes("Book Priya") && hero.includes("u226-socials") && hero.includes("u226-soc"));
check("creator hero: stats row under the photo, Local followers first, gradient only on the local count", hero.includes('data-u226="stats-row"') && hero.indexOf("u226-herophoto") < hero.indexOf('data-u226="stats-row"') && hero.includes('<div class="u226-statnum grad">12,693</div>') && hero.includes("Local followers") && hero.includes("21.5k") && hero.includes("Followers in all"));
check("creator hero: no neighbors wording anywhere", !/neighbors/i.test(hero) && !hero.includes("Neighbors here"));

// ---------- item 4: accounts in aligned columns ----------
const accts = M.accounts226Html(CREATOR, { public: true });
check("accounts: fixed rows with platform, handle, per-platform total, local count in gradient", accts.includes("u226-accrow") && accts.includes("@priyaeats") && accts.includes("12,400") && accts.includes("7,688 local") && accts.includes("9,100") && accts.includes("5,005 local"));
check("accounts: all-platforms total + highlighted local total in the head line", accts.includes("21,500 followers in all") && accts.includes('<span class="u226-gradtext">12,693 local followers</span>'));

// ---------- item 4: Photos sections ----------
const photos = M.photos226Html(CREATOR.photos, { public: true });
check("creator Photos: heading + the whole gallery, cover first", photos.includes(">Photos</h3>") && count(photos, "u226-photoimg") === 3 && photos.indexOf("priya.jpg") < photos.indexOf("p2.jpg"));
check("creator Photos (app): heading present", M.photos226Html(CREATOR.photos, { app: true }).includes(">Photos</h4>"));
const bizEditorUser = { id: "biz1", role: "business", business: { businessName: "Juniper Table", photos: ["https://img.example/juniper.jpg", "https://img.example/j2.jpg"], photoCount: 2, hasPhoto: true } };
check("business Photos source: payload photos ride through", JSON.stringify(M.bizPhotosOf226(bizEditorUser, null)) === JSON.stringify(bizEditorUser.business.photos));
const editor = M.bizPhotosEditor226Html(bizEditorUser, null);
check("business editor: Your photos + cover tag + make cover + remove + add", editor.includes('data-u226="biz-photos-editor"') && editor.includes("Your photos") && editor.includes("Cover") && editor.includes("Make cover") && editor.includes("Remove") && editor.includes("Add photo"));
const bizHero = M.heroBusiness226Html(BIZCARD);
check("business hero: fade carries name, about, See open offers; bookmark saved", bizHero.includes('data-u226="business-hero"') && bizHero.includes("Juniper Table") && bizHero.includes("Seasonal plates, natural wine.") && bizHero.includes("See open offers") && bizHero.includes('aria-pressed="true"'));

// ---------- fix 2: business profile view is wired end to end ----------
check("fix 2: heroBusiness226Html has a real call site (profile composer)", count(appJs, "heroBusiness226Html(") >= 2 && appJs.includes("businessProfile226Html(biz)"));
check("fix 2: journey router dispatches j226-business and fetches /api/businesses/", appJs.includes('view === "j226-business"') && appJs.includes('j226Go("j226-business"') && appJs.includes('api("GET", "/businesses/"'));
check("fix 2: See open offers paths route to the profile (openBusinessSaved226 + offer detail name)", appJs.slice(appJs.indexOf("function openBusinessSaved226"), appJs.indexOf("function openBusinessSaved226") + 200).includes("openBusiness226(id)") && appJs.slice(appJs.indexOf("function offerDetail226Html"), appJs.indexOf("function offerDetail226Html") + 1600).includes("openBusiness226"));
M.openBusiness226("biz1");
check("fix 2: openBusiness226 sets the journey id for the business view", sandbox.state.j226id === "biz1");
const BIZPROFILE = { ...BIZCARD, businessTrackRecord: { visitsHosted: 4, creatorsReturned: 2, onTimePct: 100 }, openOffers: [OFFER] };
apiImpl = async (m, p) => (m === "GET" && p === "/businesses/biz1" ? { business: BIZPROFILE } : {});
apiCalls.length = 0;
const fetchedBiz = await M.fetchBusiness226("biz1");
check("fix 2: fetchBusiness226 calls GET /api/businesses/:id and returns the business", apiCalls.some((c) => c.m === "GET" && c.p === "/businesses/biz1") && !!fetchedBiz && fetchedBiz.businessName === "Juniper Table");
const bizProfile = M.businessProfile226Html(BIZPROFILE);
check("fix 2: profile renders the v8 hero with live bookmark + on-page See open offers scroll", bizProfile.includes('data-u226="business-profile"') && bizProfile.includes('data-u226="business-hero"') && bizProfile.includes('data-fav-type="business"') && bizProfile.includes('aria-pressed="true"') && bizProfile.includes("scrollBizOffers226()"));
check("fix 2: profile hero stats lift visitsHosted from the track record", bizProfile.includes("Visits hosted") && bizProfile.includes('<div class="u226-statnum">4</div>'));
check("fix 2: profile renders the Photos section from business.photos", bizProfile.includes(">Photos</h4>") && bizProfile.includes('src="https://img.example/juniper.jpg"') && bizProfile.includes('src="https://img.example/j2.jpg"'));
check("fix 2: profile renders open offers as saveable, applicable offer cards", bizProfile.includes('id="u226-biz-offers"') && bizProfile.includes('data-u226="offer-card"') && bizProfile.includes(">Apply</button>") && bizProfile.includes('data-fav-type="offer"'));
check("fix 2: profile with no open offers says so plainly", M.businessProfile226Html({ ...BIZCARD, openOffers: [] }).includes("No open offers right now."));
esMode = true;
check("fix 2 ES: profile headings twin", M.businessProfile226Html({ ...BIZCARD, openOffers: [] }).includes("Ofertas abiertas") && M.businessProfile226Html({ ...BIZCARD, openOffers: [] }).includes("No hay ofertas abiertas ahora."));
esMode = false;

// ---------- fix 3: menu identity line, no em dash, ES twin ----------
check("fix 3: the em dash status string is gone from app.js", !appJs.includes("— your market is open"));
check("fix 3: marketLive line rebuilt with a period and a Spanish twin", appJs.includes('Creator in ${u.market || "your market"}. Your market is open') && appJs.includes("Tu mercado está abierto"));

// ---------- fix 5: gradient primary, circular badge, icon bookmark ----------
check("fix 5a: primary buttons carry the Magpie gradient", /\.btn\.u226-primary \{[^}]*background: var\(--grad\)/.test(themeCss) && /\.btn\.u226-primary:hover \{[^}]*background: var\(--grad\)/.test(themeCss) && card.includes('class="btn u226-primary"') && ocard.includes('class="btn u226-primary"'));
check("fix 5b: match badge is the circular gradient score badge", /\.u226-matchbadge \{[^}]*background: var\(--grad\)[^}]*border-radius: 50%/.test(themeCss));
check("fix 5c: bookmark is an icon circle with an accessible label", /\.u226-favbtn \{[^}]*border-radius: 50%/.test(themeCss) && card.includes('class="u226-favic"') && card.includes('aria-label="Save"') && !card.includes("&#9825;"));

// ---------- item 3: favorites against the landed contract ----------
const favServer = new Set();
apiImpl = async (m, p, b) => {
  if (m === "POST" && p === "/favorites") {
    const key = b.kind + ":" + b.id;
    const on = !favServer.has(key);
    if (on) favServer.add(key); else favServer.delete(key);
    const ids = { creators: [], businesses: [], offers: [] };
    for (const k of favServer) { const [t, id] = k.split(":"); ids[t === "creator" ? "creators" : t === "business" ? "businesses" : "offers"].push(id); }
    return { saved: on, isFavorite: on, kind: b.kind, id: b.id, savedIds: ids };
  }
  if (m === "GET" && p === "/favorites") return { favorites: [CREATOR], creators: [CREATOR], businesses: [BIZCARD], offers: [OFFER], savedIds: { creators: ["cr1"], businesses: ["biz1"], offers: ["of1"] } };
  if (m === "POST" && p === "/me/photo/cover") return { ok: true, photoCount: 2, photos: ["https://img.example/j2.jpg", "https://img.example/juniper.jpg"] };
  return {};
};
sandbox.state.openOffers = [OFFER];
apiCalls.length = 0;
await M.toggleFav226("offer", "of1", null);
const post1 = apiCalls.find((c) => c.m === "POST" && c.p === "/favorites");
check("favorites: toggle posts the landed { kind, id } body", !!post1 && post1.b.kind === "offer" && post1.b.id === "of1" && Object.keys(post1.b).length === 2);
check("favorites: server saved state lands in the cache + on the offer", M.favCache226()["offer:of1"] === true && OFFER.viewerSaved === true);
check("favorites: filled bookmark renders from cache on revisit", M.favBtn226Html("offer", "of1", undefined).includes('aria-pressed="true"') && M.favBtn226Html("offer", "of1", undefined).includes("Saved"));
await M.toggleFav226("offer", "of1", null);
check("favorites: second toggle unsaves everywhere", M.favCache226()["offer:of1"] === undefined && OFFER.viewerSaved === false);

// Saved area rendering from the GET shape
const savedHost = elStub("u226-saved-body");
await M.loadSaved226();
check("saved: creators, businesses and offers render in the final cards", savedHost.innerHTML.includes('data-u226="creator-card"') && savedHost.innerHTML.includes('data-u226="business-card"') && savedHost.innerHTML.includes('data-u226="offer-card"'));
check("saved: grouped headings present", savedHost.innerHTML.includes("Saved creators") && savedHost.innerHTML.includes("Saved businesses") && savedHost.innerHTML.includes("Saved offers"));
check("saved: savedIds seed the cache so bookmarks render filled on revisit", M.favCache226()["creator:cr1"] === true && M.favCache226()["business:biz1"] === true);
check("saved: rendered cards show filled bookmarks", savedHost.innerHTML.includes('aria-pressed="true"'));
const emptyHtml = M.savedView226Html({});
check("saved: empty state copy", emptyHtml.includes('data-u226="saved-empty"') && emptyHtml.includes("Nothing saved yet") && emptyHtml.includes("Tap the bookmark on any card or profile"));
check("saved: feed-top Saved button wired", M.savedFeedButton226Html().includes("openSaved226()") && M.savedFeedButton226Html().includes("Saved"));

// Business gallery ops ride the creator gallery endpoints
sandbox.state.user = bizEditorUser;
apiCalls.length = 0;
M.bizGalleryMakeCover226(1);
await new Promise((r) => setTimeout(r, 10));
const coverCall = apiCalls.find((c) => c.p === "/me/photo/cover");
check("business gallery: make-cover posts { slot } to /me/photo/cover and state updates", !!coverCall && coverCall.b.slot === 1 && bizEditorUser.business.photos[0] === "https://img.example/j2.jpg");

// ---------- item 6: filter panels vs renders 26/27 (source) ----------
const discPanel = appJs.slice(appJs.indexOf("async function loadDiscover"), appJs.indexOf("async function loadDiscover") + 14000);
check("creators filter: Sort group first, Must-haves directly under it", discPanel.indexOf("Sort by") > -1 && discPanel.indexOf("Must-haves") > discPanel.indexOf("Sort by") && discPanel.indexOf("Must-haves") < discPanel.indexOf("Match to a campaign"));
check("creators filter: categories render from the canonical list with count slots", discPanel.includes("state.boot.creatorCategories.map") && discPanel.includes("data-dcat-count"));
const offPanel = appJs.slice(appJs.indexOf('class="df-label">Sort<'), appJs.indexOf('class="df-label">Sort<') + 4000);
check("offers filter: Sort, then kind, category, distance in render order", offPanel.indexOf("The offer") > -1 && offPanel.indexOf("The offer") < offPanel.indexOf("Category") && offPanel.indexOf("Category") < offPanel.indexOf("Distance from you"));

// ---------- item 5: CTA + label sweeps (source) ----------
check("sweep: 'Create an offer' exists only as the composer heading (once)", count(appJs, "Create an offer") === 1 && appJs.slice(appJs.indexOf("Create an offer") - 200, appJs.indexOf("Create an offer")).includes("<h3"));
check("sweep: 'Create this offer' submit exists once", count(appJs, "Create this offer") === 1);
check("sweep: update module has no neighbors wording and no Create an offer", !/neighbors/i.test(upd) && !upd.includes("Create an offer"));
check("sweep: menu gains a Saved destination (both grouped menus + identity rows)", count(appJs, "openSaved226()") >= 4 && appJs.includes("Your saved businesses and offers"));

// ---------- CSS: final structure + legibility on every variant ----------
check("css: straddle overlay overlaps the seam", /\.u226-straddle \{[^}]*margin: -24px 14px 0/.test(themeCss));
check("css: gradient city text", /\.u226-citygrad[^{]*\{[^}]*background-clip: text/.test(themeCss));
check("css: secondary actions are solid white with dark text (legible on gradient cards too)", /\.u226-secondary \{[^}]*background: #fff !important[^}]*color: #0B2B4F !important/.test(themeCss));
check("css: lead offer card body stays white under the gradient variant", themeCss.includes(".mirror-card.j226-hero-card.u226-card.mirror-lead { background: #fff; }"));
check("css: hero fade is a white gradient at the photo bottom", /\.u226-fade \{[^}]*linear-gradient\(to bottom/.test(themeCss));
check("css: hero bleeds flush inside panels", themeCss.includes(".panel > .u226-hero { margin: -20px -20px 18px; }"));
check("css: stats share one size; accounts are fixed aligned columns", /\.u226-statnum \{[^}]*font-size: 1.45rem/.test(themeCss) && /\.u226-accrow \{[^}]*grid-template-columns:/.test(themeCss));
check("css: match badge + saved bookmark sit on the photo", themeCss.includes(".u226-matchbadge {") && themeCss.includes(".u226-favbtn {") && themeCss.includes(".u226-inputbar"));

// ---------- reviewer fix 1: stats contract fields ----------
const STATS = {
  totals: { bookings: 3, countedCustomers: 12, registerSpendCents: 34000, visitCostCents: 8500, engagement: { views: 900, likes: 90, comments: 20, shares: 15, saves: 35, total: 160 }, roi: 4.0 },
  campaigns: [{ offerId: "of1", title: "Dinner for two, on us", bookings: 3, countedCustomers: 12, registerSpendCents: 34000, visitCostCents: 8500, engagement: { total: 160 }, roi: 4.0 }],
  creators: [{ creatorId: "cr1", creatorName: "Priya Nair", bookings: 3, countedCustomers: 12, engagement: { total: 160 } }],
};
const norm = M.bizStatsNorm226(STATS);
check("stats norm: spent reads visitCostCents, back reads registerSpendCents, roi rides through", norm.totals.spent === 85 && norm.totals.back === 340 && norm.totals.roi === 4.0 && norm.totals.counted === 12 && norm.totals.engagements === 160);
const statsHtml = M.bizStats226Html(norm);
check("stats header: shows the overall return multiple from roi", statsHtml.includes("4.0 times back at the register") && !statsHtml.includes("Your overall return forms once counted register spend lands"));
check("stats rows: campaign shows the real spent, not $0", statsHtml.includes("$85 spent") && statsHtml.includes("4.0x back") && !statsHtml.includes("$0 spent"));
check("stats rows: creator visits read bookings", statsHtml.includes("Priya Nair") && statsHtml.includes("3 visits"));

// ---------- reviewer fix 2 + 3: walkthrough platform reason + ES body ----------
const TERMS = {
  deliverablesText: "One post and one story", postWindowHours: 48, postDeadlineAt: "2026-11-22T15:00:00Z",
  keepUpDays: 45, keepUpUntil: "2027-01-04T15:00:00Z",
  platform: { name: "Instagram", source: "business" },
  license: { state: "ask", priceCents: 7500, endsAt: null }, visitCostCents: 8500,
};
const BK = {
  id: "bk1", businessId: "biz1", businessName: "Juniper Table", creatorId: "cr1", creatorName: "Priya Nair",
  kind: "comp", status: "booked", lane: "direct", whatComped: "Dinner for two", dollarCap: 75,
  windowStartAt: "2026-11-20T00:00:00Z", windowEndAt: "2026-11-23T00:00:00Z",
  redeemedAt: "2026-11-20T15:00:00Z", terms: TERMS, post: null,
};
const walkBizSrc = M.walkthrough226Html(BK);
check("walkthrough (business source): reason says the business asked for it", walkBizSrc.includes("Juniper Table asked for this one on Instagram."));
check("walkthrough (business source): no biggest-local-audience line, no switch", !walkBizSrc.includes("biggest local audience") && !walkBizSrc.includes("Use a different platform"));
const walkLocal = M.walkthrough226Html({ ...BK, terms: { ...TERMS, platform: { name: "TikTok", source: "largest_local" } } });
check("walkthrough (largest local): biggest-local-audience line, no business-asked line", walkLocal.includes("TikTok is your biggest local audience.") && !walkLocal.includes("asked for this one"));
const pinnedBiz = M.pinnedVisit226Html([BK]);
check("doorway pinned visit: same business-asked reason", pinnedBiz.includes("Juniper Table asked for this one on Instagram.") && !pinnedBiz.includes("biggest local audience"));
const doneBiz = M.visitDone226Html(BK);
check("doorway steps: same business-asked reason", doneBiz.includes("Juniper Table asked for this one on Instagram."));
esMode = true;
const walkEs = M.walkthrough226Html(BK);
check("ES walkthrough: step body fully Spanish (headers, reason, step text)", walkEs.includes("Paso 1") && walkEs.includes("Publícalo en Instagram") && walkEs.includes("Juniper Table pidió esta en Instagram.") && walkEs.includes("Tu opinión honesta, en tus palabras. Nadie la aprueba antes.") && walkEs.includes("Los mismos tres pasos, en cada visita.") && walkEs.includes("Paso 2 · Pega el enlace aquí"));
check("ES walkthrough: no English step body left", !walkEs.includes("Your honest take, in your words") && !walkEs.includes("The same three steps, every visit") && !walkEs.includes("asked for this one on"));
const doneEs = M.visitDone226Html(BK);
check("ES doorway: step bodies Spanish", doneEs.includes("Tu opinión honesta, en tus palabras. Etiqueta a") && doneEs.includes("Pega el enlace aquí.") && doneEs.includes("Lo que recibiste"));
esMode = false;

// ---------- fix 4: mention-code line has a Spanish twin ----------
const BKW = { ...BK, creatorCode: "PRIYAEATS-95N2", audienceCode: { code: "PRIYAEATS-95N2", line: "Mention code PRIYAEATS-95N2 at Juniper Table so this visit counts." } };
const walkCodeEn = M.walkthrough226Html(BKW);
check("fix 4: EN walkthrough keeps the mention-code sentence", walkCodeEn.includes("Mention code PRIYAEATS-95N2 at Juniper Table so this visit counts."));
esMode = true;
const walkCodeEs = M.walkthrough226Html(BKW);
check("fix 4: ES walkthrough shows the Spanish mention-code sentence, no English one", walkCodeEs.includes("Menciona el código PRIYAEATS-95N2 en Juniper Table para que esta visita cuente.") && !walkCodeEs.includes("Mention code"));
const walkParseEs = M.walkthrough226Html({ ...BK, audienceCode: { line: "Mention code ABC-1 at Juniper Table so this visit counts." } });
check("fix 4: server line alone still localizes (parsed fallback)", walkParseEs.includes("Menciona el código ABC-1 en Juniper Table"));
esMode = false;

// ---------- reviewer fix 4: license ask cancel leaves state unchanged ----------
sandbox.state.j226booking = { ...BK, post: { id: "p1", url: "https://example.com/p", platform: "Instagram" } };
const licMsg = elStub("j226-lic-msg-bk1");
licMsg.textContent = "";
confirmResult = false;
await M.bizCompleteAsk226("bk1");
check("license ask: cancelling the confirm leaves the ask state unchanged", licMsg.textContent === "");
confirmResult = true;
await M.bizCompleteAsk226("bk1");
check("license ask: confirming prints the Asked line", licMsg.textContent.includes("Asked. She says yes or no"));

// ---------- item 5: Spanish twins for the new strings ----------
esMode = true;
const cardEs = M.feedCreatorCard226Html(CREATOR);
check("ES card: Book, chips, checks and secondary all twin", cardEs.includes("Reservar Priya") && cardEs.includes("seguidores locales") && cardEs.includes("seguidores en total") && cardEs.includes("Cortesía") && cardEs.includes("Ver perfil"));
const heroEs = M.heroCreator226Html(CREATOR);
check("ES hero: Local followers label twins", heroEs.includes("Seguidores locales") && !heroEs.includes("Local followers"));
check("ES saved: empty state twins", M.savedView226Html({}).includes("Nada guardado todavía"));
check("ES match sheet: heading + first input twin", M.matchSheet226Html({ score: 92, name: "Priya Nair", reasons: [], parts: CREATOR.match.parts, inputs: CREATOR.match.inputs }).includes("¿Qué es un puntaje de coincidencia?") && M.matchSheet226Html({ score: 92, name: "Priya Nair", reasons: [], parts: CREATOR.match.parts, inputs: CREATOR.match.inputs }).includes("Audiencia local"));
esMode = false;

console.log("\nverify-build226-update-client: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
