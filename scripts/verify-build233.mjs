// Build -233 verification: social accounts on profiles render the
// platform's real icon (inline SVG glyph), never letter initials
// (Jeff, 2026-11-21: "just use icons for the social accounts. That's
// confusing as hell."). Covers the profile hero social row (creator
// + business), the Social accounts channel rows, and the aligned
// accounts columns; handles and follower counts (total + local)
// stay beside the icons. Sandbox pattern follows
// verify-build226-update-client.mjs.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const buildJs = readFileSync(new URL("../netlify/functions/lib/build.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok -", name); }
  else { fail++; console.log("  FAIL -", name); }
}
const count = (s, sub) => String(s).split(sub).length - 1;

// ---------- stamp ----------
// Build -234: the exact -233 pin is relaxed to "both homes
// agree, >= 233" (same pattern -233 applied to -232's pin):
// the stamp moves with every build; what this suite owns is
// that the two homes never disagree.
check("stamp: index.html and build.js agree, >= 233 (relaxed by Build -234)",
  (() => { const n = (s) => { const m = String(s).match(/2026\.11\.21-(\d+)/); return m ? Number(m[1]) : 0; };
    const a = n(indexHtml); const b = n(buildJs); return a >= 233 && a === b; })());

// ---------- sandbox ----------
let esMode = false;
const store = new Map();
const els = {};
function elStub(id) {
  if (!els[id]) els[id] = { id, className: "", innerHTML: "", textContent: "", style: {}, value: "", classList: { toggle: () => {}, add: () => {}, remove: () => {} }, setAttribute: () => {}, getAttribute: () => null, addEventListener: () => {}, appendChild: () => {}, querySelector: () => null, remove: () => { delete els[id]; } };
  return els[id];
}
let lastSheet = null;
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
  window: { confirm: () => true, scrollTo: () => {} },
  esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;"),
  fmtPrice: (n) => (Number(n) % 1 ? Number(n).toFixed(2) : String(Math.round(Number(n)))),
  fmtNum: (n) => { if (n === null || n === undefined) return "n/a"; if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M"; if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k"; return String(n); },
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
  PLATFORM_LABELS_ALL: { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", x: "X", linkedin: "LinkedIn", youtube: "YouTube", snapchat: "Snapchat", pinterest: "Pinterest", reddit: "Reddit", twitch: "Twitch", kick: "Kick", threads: "Threads", bluesky: "Bluesky", discord: "Discord", spotify: "Spotify", patreon: "Patreon", substack: "Substack", website: "Website" },
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
  api: async () => ({}),
  showToast: () => {},
  go: () => false,
  render: () => {},
  applyToOffer: () => false,
  requestLicense: async () => true,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const start = appJs.indexOf("/* BUILD226-START */");
const end = appJs.indexOf("/* BUILD226-END */");
vm.runInContext(appJs.slice(start, end), sandbox);
const M = sandbox;

// ---------- fixtures: a creator on many platforms ----------
const CREATOR = {
  userId: "cr1", name: "Priya Nair", city: "Nashville", neighborhood: "East Nashville", market: "Nashville",
  photoUrl: "https://img.example/priya.jpg",
  photos: ["https://img.example/priya.jpg"],
  profile: { categories: ["Food", "Lifestyle"], compOpen: true, couponOpen: true, paidRate: 150, bio: "Nashville food, honestly.", localAudiencePct: 62, avgViews: 4200 },
  channels: [
    { platform: "instagram", label: "Instagram", handle: "@priyaeats", url: "https://instagram.com/priyaeats", followers: 12400, localPct: 62 },
    { platform: "tiktok", label: "TikTok", handle: "@priyaeats", url: "https://tiktok.com/@priyaeats", followers: 9100, localPct: 55 },
    { platform: "youtube", label: "YouTube", handle: "@priyaeats", url: "https://youtube.com/@priyaeats", followers: 5200, localPct: 48 },
    { platform: "x", label: "X", handle: "@priyaeats", url: "https://x.com/priyaeats", followers: 2100, localPct: 40 },
    { platform: "facebook", label: "Facebook", handle: "@priyaeats", url: "https://facebook.com/priyaeats", followers: 1800, localPct: 70 },
    { platform: "linkedin", label: "LinkedIn", handle: "priya-nair", url: "https://linkedin.com/in/priya-nair", followers: 640, localPct: 30 },
  ],
  totalAudience: 31240,
  ratingAvg: 4.9, ratingCount: 12,
  trackRecord: { visitsCompleted: 7 },
  matchScore: 92,
  isFavorite: false,
};
const BIZ = {
  userId: "biz1", businessId: "biz1", name: "Juniper Table", businessName: "Juniper Table",
  category: "Restaurant", market: "Nashville", city: "Nashville", neighborhood: "The Gulch",
  about: "Seasonal plates, natural wine.", photoUrl: "https://img.example/juniper.jpg",
  photos: ["https://img.example/juniper.jpg"],
  channels: [
    { platform: "instagram", label: "Instagram", handle: "@junipertable", url: "https://instagram.com/junipertable", followers: 8400, localPct: 71 },
    { platform: "facebook", label: "Facebook", handle: "@junipertable", url: "https://facebook.com/junipertable", followers: 3200, localPct: 80 },
    { platform: "tiktok", label: "TikTok", handle: "@junipertable", url: "https://tiktok.com/@junipertable", followers: 1500, localPct: 66 },
  ],
  viewerSaved: true,
};

// ---------- glyph map ----------
const PLATFORMS = ["instagram", "tiktok", "youtube", "x", "twitter", "facebook", "threads", "twitch", "snapchat", "linkedin", "pinterest", "reddit", "bluesky", "discord", "spotify", "patreon", "substack", "kick", "website"];
const glyphs = {};
for (const p of PLATFORMS) glyphs[p] = M.chanGlyph226(p);
check("glyph: every supported platform returns an SVG", PLATFORMS.every((p) => glyphs[p].includes('<svg class="chan-glyph"') && glyphs[p].includes('viewBox="0 0 24 24"')));
check("glyph: all platforms distinct (twitter aliases x)", new Set(PLATFORMS.map((p) => glyphs[p])).size === PLATFORMS.length - 1 && glyphs.twitter === glyphs.x);
check("glyph: instagram reads as camera (rounded square + lens + dot)", glyphs.instagram.includes("<rect") && glyphs.instagram.includes("<circle") && glyphs.instagram.includes('cx="17.3"'));
check("glyph: youtube is the play button (white rounded rect, red triangle)", glyphs.youtube.includes('fill="#FF0000"') && glyphs.youtube.includes("<rect"));
check("glyph: tiktok is the note (filled path, no letters)", glyphs.tiktok.includes("<path") && !/[A-Za-z]{2}<\/svg>/.test(glyphs.tiktok));
check("glyph: unknown platform falls back to the globe icon, never letters", M.chanGlyph226("myspace") === glyphs.website && M.chanGlyph226("") === glyphs.website);
check("glyph: no glyph is a letter badge", PLATFORMS.every((p) => !/>\s*[A-Z]{1,3}\s*<\/svg>/.test(glyphs[p])));

// ---------- creator hero social row ----------
const hero = M.heroCreator226Html(CREATOR);
const socRow = hero.slice(hero.indexOf('class="u226-socials"'), hero.indexOf('class="u226-socials"') + 4000);
check("hero: social row present with one icon per channel (5 max)", hero.includes('class="u226-socials"') && count(socRow, 'class="u226-soc"') === 5);
check("hero: every badge is an SVG glyph", count(socRow, '<svg class="chan-glyph"') === 5);
check("hero: no letter initials inside any badge", !/u226-soc"[^>]*>\s*[A-Z]{1,3}\s*</.test(socRow) && !socRow.includes(">IG<") && !socRow.includes(">TT<") && !socRow.includes(">YT<"));
check("hero: badges keep platform colors", socRow.includes("background:#E1306C") && socRow.includes("background:#111111") && socRow.includes("background:#FF0000") && socRow.includes("background:#1877F2"));
check("hero: Book Priya + identity layout unchanged", hero.includes("Book Priya") && hero.includes('class="u226-fade"'));

// ---------- business hero social row ----------
const bhero = M.heroBusiness226Html(BIZ);
check("business hero: social row uses icons too", bhero.includes('class="u226-socials"') && count(bhero, '<svg class="chan-glyph"') === 3 && !/u226-soc"[^>]*>\s*[A-Z]{1,3}\s*</.test(bhero));

// ---------- Social accounts channel rows ----------
const chans = M.channels226Html(CREATOR, { app: true });
check("channel rows: one row per account, each led by an SVG icon tile", count(chans, 'class="j226-chanrow"') === 6 && count(chans, '<svg class="chan-glyph"') === 6);
check("channel rows: no letter initials in the tiles", !/j226-chanmark"[^>]*>\s*[A-Z]{1,3}\s*</.test(chans));
check("channel rows: platform name + handle stay beside the icon", chans.includes("Instagram") && chans.includes("@priyaeats") && chans.includes("LinkedIn"));
check("channel rows: follower counts + local % stay beside the icon", chans.includes("12.4k") && chans.includes("followers") && chans.includes("62%") && chans.includes("local"));

// ---------- accounts columns ----------
const accts = M.accounts226Html(CREATOR, { public: true });
check("accounts: every row carries the platform icon chip", count(accts, 'class="u226-accicon"') === 6 && count(accts, '<svg class="chan-glyph"') === 6);
check("accounts: columns intact (handle, total, local in gradient)", accts.includes("@priyaeats") && accts.includes("12,400") && accts.includes("7,688 local") && accts.includes("31,240 followers in all"));

// ---------- Spanish twins ----------
esMode = true;
const chansEs = M.channels226Html(CREATOR, { app: true });
check("ES: channel rows keep icons and Spanish counts", count(chansEs, '<svg class="chan-glyph"') === 6 && chansEs.includes("seguidores"));
esMode = false;

// ---------- source pins ----------
check("source: no renderer still emits the letter mark text", !appJs.includes('${esc(mark[0])}</span>') && appJs.includes("chanGlyph226(c.platform)"));
check("source: CHAN_ICON_226 covers the full platform label set", ["instagram", "tiktok", "youtube", "x", "facebook", "threads", "twitch", "snapchat", "linkedin", "pinterest", "reddit", "bluesky", "discord", "spotify", "patreon", "substack", "kick", "website"].every((p) => appJs.includes(p + ": `<")));

console.log(`\nverify-build233: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
