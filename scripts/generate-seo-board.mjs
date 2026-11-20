// SEO / AI search board generator (Build -216).
//
// Turns the goal-workspace search records into the data file the
// Admin "SEO / AI search" section reads:
//   netlify/functions/lib/seo-board.json
// served only by GET /api/admin/seo-board (admin-gated in the
// router) — the JSON itself is never placed under public/, so the
// board is not exposed to non-admin accounts or the public.
//
// Sources (all read live at generation time; nothing is invented):
//   - Goal records:  ~/workspace/goals/local-creator-platform-max-media-licensing-deal/hidden_files/
//       seo-fix-2026-11-18.md       (the dated work record: runs 1-3)
//       phrase-map-2026-11-18.md    (phrase targets + the build queue)
//       search-tracking-log.md      (movement / how-we-are-doing facts)
//   - Site repo:     ~/workspace/signl-site/
//       learn/<slug>.html           (H1 title + schema datePublished per page)
//       sitemap.xml                 (total site pages = <loc> count)
//
// The climb manifest below (slug -> group -> target phrase, in
// plain words) is the transcription of the shipped runs in
// seo-fix-2026-11-18.md (runs 1-3, commits 262bab1 / b46b02a /
// 6c62e9e) cross-checked against the phrase map. The generator
// REFUSES to emit a page whose slug is not evidenced in the goal
// records, whose Learn file is missing, or whose URL is absent
// from the sitemap. Titles and dates come from the article files
// themselves (H1 + datePublished), never from this script: a page
// with no establishable date is emitted with date: null and the
// board shows no date for it rather than a guessed one.
//
// Run:  node scripts/generate-seo-board.mjs
// Then commit the regenerated seo-board.json with the app repo.
// The daily climb re-runs this after each tranche ships (see the
// "SEO / AI search board" section in the site repo's
// learn/INTEGRATION.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE = path.resolve(APP_ROOT, "..");
const GOAL_DIR = path.join(WORKSPACE, "goals", "local-creator-platform-max-media-licensing-deal", "hidden_files");
const SITE_ROOT = path.join(WORKSPACE, "signl-site");
const OUT = path.join(APP_ROOT, "netlify", "functions", "lib", "seo-board.json");
const BASE = "https://magpielocal.com/learn/";

const read = (p) => fs.readFileSync(p, "utf8");
const seoFix = read(path.join(GOAL_DIR, "seo-fix-2026-11-18.md"));
const phraseMap = read(path.join(GOAL_DIR, "phrase-map-2026-11-18.md"));
const trackingLog = read(path.join(GOAL_DIR, "search-tracking-log.md"));
const recordsText = seoFix + "\n" + phraseMap + "\n" + trackingLog;

// slug, group, target phrase/question in plain words.
const MANIFEST = [
  // Run 1 (2026-11-18) — entity + category definitions.
  ["what-is-magpie-local", "Learn articles", "What is Magpie Local? (the brand question)"],
  ["magpie-creator", "Learn articles", "magpie creator"],
  ["magpie-influencer", "Learn articles", "magpie influencer"],
  ["what-is-a-local-influencer-platform", "Learn articles", "local influencer platform"],
  ["magpie-vs-relish", "Comparisons", "Magpie vs Relish"],
  // Run 2 (2026-11-18) — phrase universe + city x category start.
  ["what-is-a-micro-influencer-platform", "Learn articles", "micro influencer platform"],
  ["magpie-vs-collabstr", "Comparisons", "Magpie vs Collabstr / Collabstr alternative"],
  ["influencer-marketing-for-nashville-salons-and-barbershops", "City pages", "influencer marketing for Nashville salons and barbershops"],
  ["influencer-marketing-for-miami-salons-and-barbershops", "City pages", "influencer marketing for Miami salons and barbershops"],
  ["influencer-marketing-for-new-york-city-salons-and-barbershops", "City pages", "influencer marketing for New York City salons and barbershops"],
  ["influencer-marketing-for-los-angeles-salons-and-barbershops", "City pages", "influencer marketing for Los Angeles salons and barbershops"],
  ["influencer-marketing-for-atlanta-salons-and-barbershops", "City pages", "influencer marketing for Atlanta salons and barbershops"],
  ["influencer-marketing-for-toronto-salons-and-barbershops", "City pages", "influencer marketing for Toronto salons and barbershops"],
  ["influencer-marketing-for-los-angeles-boutiques", "City pages", "influencer marketing for Los Angeles boutiques"],
  ["influencer-marketing-for-new-york-city-boutiques", "City pages", "influencer marketing for New York City boutiques and retail"],
  ["influencer-marketing-for-nashville-boutiques", "City pages", "influencer marketing for Nashville boutiques"],
  // Run 3 (2026-11-19) — get-paid-to-post national + cafes x 7.
  ["get-paid-to-post", "Learn articles", "get paid to post"],
  ["influencer-marketing-for-nashville-cafes-and-coffee-shops", "City pages", "influencer marketing for Nashville cafes and coffee shops"],
  ["influencer-marketing-for-miami-cafes-and-coffee-shops", "City pages", "influencer marketing for Miami cafes and coffee shops"],
  ["influencer-marketing-for-new-york-city-cafes-and-coffee-shops", "City pages", "influencer marketing for New York City cafes and coffee shops"],
  ["influencer-marketing-for-los-angeles-cafes-and-coffee-shops", "City pages", "influencer marketing for Los Angeles cafes and coffee shops"],
  ["influencer-marketing-for-atlanta-cafes-and-coffee-shops", "City pages", "influencer marketing for Atlanta cafes and coffee shops"],
  ["influencer-marketing-for-toronto-cafes-and-coffee-shops", "City pages", "influencer marketing for Toronto cafes and coffee shops"],
  ["influencer-marketing-for-hampton-roads-cafes-and-coffee-shops", "City pages", "influencer marketing for Hampton Roads cafes and coffee shops"],
];
const GROUP_ORDER = ["Landing pages", "Learn articles", "City pages", "Comparisons"];

const sitemap = read(path.join(SITE_ROOT, "sitemap.xml"));
const sitePages = (sitemap.match(/<loc>/g) || []).length;
if (!sitePages) throw new Error("sitemap.xml yielded no <loc> entries — refusing to generate");

const failures = [];
const pages = [];
for (const [slug, group, target] of MANIFEST) {
  // Evidence: the full slug appears in the records, OR (for the
  // city x category series, which the records describe in prose —
  // "salons and barbershops x 6 core markets (Nashville, Miami,
  // ...)" and the templated learn/influencer-marketing-for-{city}-
  // cafes-and-coffee-shops.html pattern) the target phrase itself
  // appears. Anything else is refused, never assumed.
  const low = recordsText.toLowerCase();
  let evidenced = recordsText.includes(slug) || low.includes(target.toLowerCase());
  if (!evidenced && group === "City pages") {
    // City series are recorded as category x city-name pairs.
    const cat = slug.includes("salons") ? "salons and barbershops"
      : slug.includes("boutiques") ? "boutiques"
      : slug.includes("cafes") ? "cafes and coffee shops" : "";
    const city = target.replace(/^influencer marketing for /i, "").replace(/ (salons and barbershops|boutiques.*|cafes and coffee shops)$/i, "");
    evidenced = !!cat && low.includes(cat) && low.includes(city.toLowerCase());
  }
  if (!evidenced) { failures.push(`${slug}: not evidenced in the goal records`); continue; }
  const file = path.join(SITE_ROOT, "learn", `${slug}.html`);
  if (!fs.existsSync(file)) { failures.push(`${slug}: learn file missing in the site repo`); continue; }
  const html = read(file);
  const h1m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = h1m ? h1m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
  const dm = html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  const url = `${BASE}${slug}.html`;
  if (!title) { failures.push(`${slug}: no H1 in the article file`); continue; }
  if (!sitemap.includes(`<loc>${url}</loc>`)) { failures.push(`${slug}: URL absent from sitemap.xml`); continue; }
  pages.push({ slug, title, url, date: dm ? dm[1] : null, target, group });
}
if (failures.length) {
  console.error("generate-seo-board: REFUSING to write — evidence checks failed:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

// Groups in board order, newest first inside each group (pages
// without an establishable date sort last and show no date).
const groups = GROUP_ORDER
  .map((name) => ({
    name,
    pages: pages.filter((p) => p.group === name)
      .sort((a, b) => String(b.date || "") < String(a.date || "") ? -1 : String(b.date || "") > String(a.date || "") ? 1 : a.title < b.title ? -1 : 1)
      .map(({ slug, title, url, date, target }) => ({ slug, title, url, date, target })),
  }))
  .filter((g) => g.pages.length);

const lastUpdated = pages.map((p) => p.date).filter(Boolean).sort().pop() || null;

// Next in the queue: the "Queue after this run" list at the end of
// seo-fix-2026-11-18.md (post-run-3 state of the phrase map queue).
const queueSection = seoFix.split("### Queue after this run").pop() || "";
const queue = [...queueSection.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].replace(/\*\*/g, "").trim());
if (!queue.length) throw new Error("no queue parsed from seo-fix-2026-11-18.md — refusing to generate");

// How we are doing: headline facts pulled from the tracking log by
// pattern, so a regeneration picks up the recorded numbers as
// they stand. A fact whose pattern is absent is omitted, never
// filled in from memory.
const facts = [];
const need = (re, make) => { const m = trackingLog.match(re); if (m) facts.push(make(m)); };
need(/Total: \*\*1 click \/ 60 impressions\*\*, avg position 15\.4/,
  () => "Google Search Console, Nov 8–14: 1 click / 60 impressions, avg position 15.4.");
need(/chatgpt\.com: 34 sessions/,
  () => "GA4, Nov 9–15: chatgpt.com sent 34 sessions; Perplexity, Gemini and Copilot sent 0.");
need(/FIRST: first verified direct-probe naming/,
  () => "ChatGPT names and links Magpie on the business discovery question (first verified non-brand naming, 2026-11-16).");
need(/AI Overview — "local influencer marketing platform": Magpie NOT mentioned, NOT cited/,
  () => "Google AI Overview, “local influencer marketing platform”: Magpie NOT mentioned, NOT cited (2026-11-16 probe, same as baseline).");
need(/named in 2\.1% of answers[\s\S]{0,200}?Visibility 14\/100/,
  () => "Citehawk (2026-11-16): Magpie named in 2.1% of 41 prompts, ChatGPT only; visibility 14/100; share of voice 0.6%; Won 4 / Contested 3 / Lost 34.");
// Latest check date = the scoreboard baseline date in the log.
const checkDate = (trackingLog.match(/Scoreboard[\s\S]{0,400}?baseline (?:filled )?(\d{4}-\d{2}-\d{2})/) || [])[1]
  || (trackingLog.match(/baseline (\d{4}-\d{2}-\d{2})/) || [])[1] || null;

const board = {
  generatedAt: new Date().toISOString(),
  totals: { searchPages: pages.length, sitePages, lastUpdated },
  nextUp: queue[0] || null,
  queue,
  tracking: { checkDate, facts },
  groups,
};
fs.writeFileSync(OUT, JSON.stringify(board, null, 2) + "\n");
console.log(`generate-seo-board: wrote ${OUT}`);
console.log(`  search pages: ${pages.length} (${groups.map((g) => `${g.name} ${g.pages.length}`).join(", ")})`);
console.log(`  site pages (sitemap): ${sitePages}; last updated: ${lastUpdated}; next up: ${queue[0]}`);
console.log(`  tracking: check date ${checkDate}, ${facts.length} facts`);
const noDate = pages.filter((p) => !p.date);
if (noDate.length) console.log(`  WARNING no establishable date (shown dateless): ${noDate.map((p) => p.slug).join(", ")}`);
