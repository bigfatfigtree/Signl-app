// Server-rendered share/index meta for public creator profiles
// (Jeff's ruling, 2026-10-23: approved + profile-complete creator
// pages are indexable and carry real title/OG meta in the served
// HTML, not just after client JS runs).
//
// Pure functions only: the router decides WHO qualifies (the exact
// same lookup the /api/c/<handle> route uses, so the page and the
// API can never disagree) and hands this module the profile facts;
// this module only rewrites the app shell's head. Anything that is
// not an approved, complete profile gets the shell back untouched
// (generic title, noindex), exactly as before.

const { videoEmbedFor } = require("./video-embed");

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Title and description mirror the client-side share shell
// (applyProfileShareShell in public/app.js) so the server-rendered
// head and the in-app head never tell two different stories.
function profilePageMeta(profile) {
  const place = profile.place || "";
  const title = `${profile.name} (@${profile.handle}) on SIGNL${place ? ` | ${place}` : ""}`;
  const pct = typeof profile.localAudiencePct === "number" ? profile.localAudiencePct : null;
  // Multi-market (2026-11-01): the other markets the creator is
  // ranked in ride the description when they are real (the
  // router only passes listed markets: home plus shares at or
  // above the listing floor). At most two are named, strongest
  // first (listedMarketsFor already orders them that way).
  const others = (Array.isArray(profile.listedMarkets) ? profile.listedMarkets : [])
    .filter((e) => e && !e.home && typeof e.pct === "number")
    .slice(0, 2);
  const also = others.length
    ? ` Also ranked in ${others.map((e) => `${e.market} (${e.pct}% of their audience)`).join(" and ")}.`
    : "";
  const description = `${profile.name} is a founding creator on SIGNL in ${place || "their market"}${profile.tierBand ? ` (${profile.tierBand} tier)` : ""}.${pct !== null ? ` ${pct}% of their audience is local.` : ""}${also} Local businesses comp creators for honest posts.`;
  return { title, description };
}

// Structured data for the profile page (SEO/AEO audit, 2026-10-25):
// a ProfilePage whose mainEntity is the creator as a Person, built
// ONLY from the same already-public facts the meta tags carry
// (name, handle, place, tier/local reach via the description,
// cover photo). JSON.stringify output is safe inside a <script>
// block once "</" is neutralized, so a hostile name can never
// break out of the tag.
//
// Multi-market + rate card (2026-11-01): three additions, each
// only when the router hands over the real fact: the creator's
// categories as knowsAbout; the markets they are ranked in as
// the service area of their booking offer; and their listed
// paid rate as that offer's price (the rate card is public on
// the finished profile, so the offer states exactly what the
// page states). No rate listed means no offer node at all:
// structured data never invents a price.
function profileJsonLd(profile, meta, canonical, image) {
  const person = {
    "@type": "Person",
    name: String(profile.name || ""),
    alternateName: `@${profile.handle || ""}`,
    url: canonical,
    description: meta.description,
  };
  if (image) person.image = image;
  if (profile.place) person.homeLocation = { "@type": "Place", name: String(profile.place) };
  const categories = (Array.isArray(profile.categories) ? profile.categories : []).filter((x) => typeof x === "string" && x);
  if (categories.length) person.knowsAbout = categories;
  const listed = (Array.isArray(profile.listedMarkets) ? profile.listedMarkets : [])
    .filter((e) => e && typeof e.market === "string" && e.market);
  if (typeof profile.paidRate === "number" && profile.paidRate > 0) {
    const service = {
      "@type": "Service",
      name: "Paid creator booking: one post plus one story",
      provider: { "@type": "Person", name: String(profile.name || ""), alternateName: `@${profile.handle || ""}` },
    };
    if (listed.length) service.areaServed = listed.map((e) => ({ "@type": "Place", name: String(e.market) }));
    if (categories.length) service.serviceType = categories;
    person.makesOffer = {
      "@type": "Offer",
      price: profile.paidRate,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      itemOffered: service,
    };
  }
  const ld = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: canonical,
    name: meta.title,
    description: meta.description,
    mainEntity: person,
  };
  return JSON.stringify(ld).replace(/<\//g, "<\\/");
}

// ---------- server-rendered profile body (Build -64) ----------
// The finished profile used to arrive as an empty shell: the
// served body was literally "Loading SIGNL..." and every fact
// waited on the ~1.4 MB app bundle plus an API call (UX audit
// B1, the flagship fix of this build). The router now hands this
// module the same tier-0 payload the client renders from, and
// the profile's core content ships IN the HTML: photo-first
// header, chips, local reach, the audience bar, one merged Work
// grid, the rate card, and the booking CTA. The app bundle is
// deferred on these pages, so first paint never waits on it;
// when the app boots it re-renders the same page from the API
// exactly as before. Copy here mirrors renderPublicProfile in
// public/app.js on purpose: plain words only, no level/proof
// internals, no founding-sequence chip.
const WORK_SEG_COLORS = ["#006AFC", "#03C9AB", "#2FE07E", "#019BFC", "#5F7265", "#006AFC"];

function normWorkUrl(u) {
  return String(u || "").replace(/\/+$/, "").toLowerCase();
}

// One merged Work list (Build -64): the portfolio sample, the
// featured posts, and the creator's own best-work links were
// three near-identical sections; they are one grid now. Embeds
// first (they carry the real imagery), then link tiles, deduped
// by URL so a post the creator both featured and listed appears
// once.
// Build -79: a best-work link that parses as a video (the shared
// parser in lib/video-embed.js; the router also stamps the same
// descriptor on the card as w.embed) joins the embeds, so the
// video itself shows on the profile and plays in place. A link
// the parser does not know stays the tile it has always been.
function profileWorkItems(p) {
  const items = [];
  const seen = new Set();
  if (p.portfolioSample && p.portfolioSample.url) {
    const emb = videoEmbedFor(p.portfolioSample.url);
    items.push({ kind: "embed", url: p.portfolioSample.url, embedUrl: (emb && emb.embedUrl) || p.portfolioSample.embedUrl, embedAspect: (emb && emb.aspect) || "portrait", platform: (emb && emb.platform) || p.primaryPlatformLabel || "Instagram", tag: "Portfolio sample" });
    seen.add(normWorkUrl(p.portfolioSample.url));
  }
  for (const f of Array.isArray(p.featuredPosts) ? p.featuredPosts : []) {
    if (!f || !f.url || seen.has(normWorkUrl(f.url))) continue;
    const emb = videoEmbedFor(f.url);
    items.push({ kind: "embed", url: f.url, embedUrl: (emb && emb.embedUrl) || f.embedUrl, embedAspect: (emb && emb.aspect) || "portrait", platform: (emb && emb.platform) || p.primaryPlatformLabel || "Instagram", tag: "Featured post" });
    seen.add(normWorkUrl(f.url));
  }
  for (const w of Array.isArray(p.pastWork) ? p.pastWork : []) {
    if (!w || !w.url || seen.has(normWorkUrl(w.url))) continue;
    const emb = w.embed || videoEmbedFor(w.url);
    if (emb && emb.embedUrl) {
      items.push({ kind: "embed", url: w.url, embedUrl: emb.embedUrl, embedAspect: emb.aspect || "portrait", platform: emb.platform || w.platform || "", tag: emb.platform || w.platform || "Video" });
    } else {
      items.push({ kind: "tile", url: w.url, label: w.label || "Watch", platform: w.platform || "" });
    }
    seen.add(normWorkUrl(w.url));
  }
  return items;
}

function profileWorkHtml(p) {
  const items = profileWorkItems(p);
  if (!items.length) return "";
  const cells = items.map((it) => {
    if (it.kind === "embed") {
      return `<div class="work-cell${it.embedAspect === "wide" ? " wide" : ""}"><div class="work-ph"><span class="work-ph-mark">${escHtml(it.platform || "Video")}</span><span class="work-ph-note">Post loading</span></div><iframe src="${escHtml(it.embedUrl || "")}" loading="lazy" frameborder="0" scrolling="no" allowtransparency="true" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${escHtml(it.tag)} by @${escHtml(p.handle)}" onload="this.parentNode.classList.add('on')"></iframe><span class="work-tag">${escHtml(it.tag)}</span></div>`;
    }
    return `<a class="work-cell tile" href="${escHtml(it.url)}" target="_blank" rel="noopener"><span class="work-ph-mark">${escHtml(it.platform || "Post")}</span><span class="work-tile-label">${escHtml(it.label)}</span><span class="work-go">View post</span></a>`;
  }).join("");
  return `
      <h3 class="bookme-h">Work</h3>
      <div class="work-grid">${cells}</div>
      <p class="small muted">Posts ${escHtml(p.name)} picked to show their work. They are the creator's own posts, not SIGNL visits.</p>`;
}

// ---------- profile header facts (Build -66) ----------
// Jeff (2026-11-01): the profile's top bar answers two things
// next to the name and photo: where else this creator is (quick
// links to their socials) and how big they are, local first.
// Both facts ride the book-me payload at every tier now (see
// bookMePayload in the router); this module only renders them.
// Links come from the payload's socialLinks, which the router
// builds from stored handles only, so a platform with nothing
// on the record simply never appears here. The local number is
// the home-market share on this public page (the in-app render
// swaps in the browsed market's share; the big block below
// keeps its Self-reported label either way), and the followers
// number is the stacked total in compact form. A fact that does
// not exist renders nothing: no zero, no placeholder.
function fmtFollowers(n) {
  const v = Math.floor(Number(n) || 0);
  if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(v);
}

// ---------- Build -68: viewed market, follower counts, first name ----------
// The headline local number is keyed to the market the viewer
// is looking in. This public page has no signed-in viewer, so
// the only context is a ?market= the router passes through as
// p.viewMarket; it counts only when the creator is actually
// listed there (a listedMarkets entry), and anything else
// falls back to the home share, exactly like the in-app
// render. Counts are arithmetic on the creator's own
// self-reported share and total: pct of total, compact format.
function profileViewOf(p) {
  const listed = (Array.isArray(p.listedMarkets) ? p.listedMarkets : []).filter((m) => m && typeof m.pct === "number");
  const homeEntry = listed.find((m) => m.home) || null;
  const home = { market: homeEntry ? homeEntry.market : (p.market || ""), pct: typeof p.localAudiencePct === "number" ? p.localAudiencePct : (homeEntry ? homeEntry.pct : null), home: true };
  const cand = typeof p.viewMarket === "string" ? p.viewMarket.trim().toLowerCase() : "";
  if (cand) {
    const hit = listed.find((m) => String(m.market).toLowerCase() === cand);
    if (hit) return { market: hit.market, pct: hit.pct, home: !!hit.home };
  }
  return home;
}
function followersForPct(pct, total) {
  if (typeof pct !== "number" || typeof total !== "number" || !(total > 0)) return null;
  return fmtFollowers(Math.round((pct / 100) * total));
}
// The public name line: first name only (Build -68), pronouns
// beside it when the creator set them. A record with no real
// first name (missing, or the name is just the handle) renders
// exactly as it did before.
function profileDisplayName(p) {
  if (p.firstName) return p.pronouns ? `${p.firstName} · ${p.pronouns}` : String(p.firstName);
  return p.name || "";
}

function profileHeaderSocialsHtml(p) {
  const links = (Array.isArray(p.socialLinks) ? p.socialLinks : []).filter((s) => s && s.url && s.label);
  if (!links.length) return "";
  return `<div class="bookme-socials-row">${links.map((s) => `<a class="bm-soc" href="${escHtml(s.url)}" target="_blank" rel="noopener">${escHtml(s.label)}</a>`).join("")}</div>`;
}

function profileHeaderStatsHtml(p) {
  const stats = [];
  const view = profileViewOf(p);
  if (typeof view.pct === "number") {
    const cnt = followersForPct(view.pct, p.totalAudience);
    stats.push(`<div class="bm-stat bm-stat-local"><span class="bm-num">${view.pct}%</span><span class="bm-lbl">${view.home ? "local" : `local · ${escHtml(view.market)}`}</span>${cnt ? `<span class="bm-sub">${cnt} followers</span>` : ""}</div>`);
  }
  if (typeof p.totalAudience === "number" && p.totalAudience > 0) {
    stats.push(`<div class="bm-stat bm-stat-fol"><span class="bm-num">${fmtFollowers(p.totalAudience)}</span><span class="bm-lbl">followers</span></div>`);
  }
  if (!stats.length) return "";
  return `<div class="bookme-stats">${stats.join("")}</div>`;
}

function profileBodyHtml(p, place) {
  const initial = escHtml((String(p.name || "?").trim().charAt(0) || "?").toUpperCase());
  // Market chips, deduped (audit F4): the place chip and the
  // city chip said the same market twice in two cases. The city
  // rides only when it adds information the place does not
  // already carry.
  const placeNorm = String(place || "").toLowerCase();
  const cityNorm = String(p.city || "").toLowerCase();
  const cityChip = p.city && !p.unlisted && cityNorm && !placeNorm.includes(cityNorm) && !cityNorm.includes(placeNorm.replace(/,.*$/, ""))
    ? `<span class="cc-chip">${escHtml(p.city)}</span>` : "";
  const rateRows = (Array.isArray(p.rateCard) ? p.rateCard : []).map((r) => `
        <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #DFE7DF">
          <span><strong>${escHtml(r.label)}</strong><br><span class="small muted">${escHtml(r.detail || "")}</span></span>
          <span style="white-space:nowrap"><strong>${r.price ? "$" + Number(r.price).toLocaleString("en-US") : "Open"}</strong></span>
        </div>`).join("");
  const bd = p.audienceBreakdown;
  const breakdown = bd && Array.isArray(bd.segments) && bd.segments.length ? `
      <div style="margin:14px 0 0">
        <div style="display:flex;height:14px;border-radius:999px;overflow:hidden;background:#E3F5EA" role="img" aria-label="Where this creator's audience lives">
          ${[...bd.segments].sort((a, b) => (a.market === profileViewOf(p).market ? -1 : b.market === profileViewOf(p).market ? 1 : b.pct - a.pct)).map((s, i) => `<span style="display:block;width:${s.pct}%;background:${WORK_SEG_COLORS[i] || "#5F7265"}"></span>`).join("")}
        </div>
        <p class="small muted" style="margin:6px 0 0">Where their audience lives: ${[...bd.segments].sort((a, b) => (a.market === profileViewOf(p).market ? -1 : b.market === profileViewOf(p).market ? 1 : b.pct - a.pct)).map((s) => { const cnt = followersForPct(s.pct, p.totalAudience); return `${escHtml(s.market)} ${s.pct}%${cnt ? ` &middot; ${cnt} followers` : ""}`; }).join(" &middot; ")}${bd.elsewherePct > 0 ? ` &middot; everywhere else ${bd.elsewherePct}%` : ""}. Self-reported by the creator.</p>
      </div>` : "";
  const proof = p.proof && p.proof.visitsCompleted > 0 ? `
      <div class="wcard" style="margin:14px 0 0"><p style="margin:0"><span class="badge ok">Verified on SIGNL</span></p><p style="margin:8px 0 0"><strong>${p.proof.visitsCompleted} visit${p.proof.visitsCompleted === 1 ? "" : "s"} completed</strong> &middot; ${p.proof.onTimePosts} on time</p></div>` : "";
  return `
  <div class="public-profile bookme theme-${escHtml(p.pageTheme || "ink")}" style="max-width:720px;margin:20px auto">
    <div class="bookme-cover${p.photoUrl ? " has-photo" : " no-photo"}">
      ${p.photoUrl ? `<img class="bookme-banner" src="${escHtml(p.photoUrl)}" alt="">` : `<div class="cc-mono bookme-mono"><span>${initial}</span></div>`}
      <div class="bookme-cover-id">
        <div class="bookme-id-row">
          <div class="bookme-id-main">
            <div class="cc-name bookme-name">${escHtml(profileDisplayName(p))}</div>
            <div class="bookme-handle">@${escHtml(p.handle)} &middot; ${escHtml(p.primaryPlatformLabel || "Instagram")}</div>
            ${profileHeaderSocialsHtml(p)}
            ${p.charter ? `<span class="charter-seal sm">Charter Creator</span>` : ""}
          </div>
          ${profileHeaderStatsHtml(p)}
        </div>
      </div>
    </div>
    ${p.realPeopleChecked ? `<p class="small" style="margin:10px 0 0"><span class="badge ok">Checked by a person</span> Real posts, real local life.</p>` : ""}
    <section class="panel bookme-body">
      <div class="cc-chips">
        <span class="cc-chip market">${escHtml(place)}</span>
        ${cityChip}
        ${p.neighborhood ? `<span class="cc-chip">${escHtml(p.neighborhood)}</span>` : ""}
        ${p.campusBadge ? `<span class="cc-chip">${escHtml(p.campusBadge)}</span>` : ""}
        ${p.tierBand ? `<span class="cc-chip">${escHtml(p.tierBand)}</span>` : ""}
        ${p.isRealtor ? `<span class="cc-chip">Realtor</span>` : ""}
        ${p.charter ? "" : `<span class="cc-chip">Founding Creator</span>`}
        ${(Array.isArray(p.listedMarkets) ? p.listedMarkets : []).filter((m) => m.market !== profileViewOf(p).market).map((m) => { const cnt = followersForPct(m.pct, p.totalAudience); return `<span class="cc-chip">Also ranked in ${escHtml(m.market)} &middot; ${m.pct}%${cnt ? ` &middot; ${cnt} followers` : " of followers"}</span>`; }).join("")}
      </div>
      ${p.pitchLine ? `<p class="bookme-pitch" style="font-size:1.05rem;margin:10px 0 0"><em>${escHtml(p.pitchLine)}</em></p>` : ""}
      ${p.bio ? `<p class="bookme-bio">${escHtml(p.bio)}</p>` : ""}
      <div class="cc-local">
        ${profileViewOf(p).pct === null || profileViewOf(p).pct === undefined
          ? `<div class="lbl">Local audience not reported yet</div>`
          : `<div class="big">${profileViewOf(p).pct}%</div><div class="lbl">of their audience is local to ${escHtml(profileViewOf(p).market)}</div>${followersForPct(profileViewOf(p).pct, p.totalAudience) ? `<div style="font-weight:800;margin-top:2px">${followersForPct(profileViewOf(p).pct, p.totalAudience)} followers</div>` : ""}<div class="src">${(p.localAudienceSource || "Self-reported") === "Self-reported" ? "Self-reported: the creator's own number" : escHtml(p.localAudienceSource)}</div>`}
      </div>
      ${breakdown}
      ${proof}
      ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${escHtml(x)}</span>`).join(" ")}</p>` : ""}
      ${profileWorkHtml(p)}
      <h3 class="bookme-h">Rate card</h3>
      <div class="tint-block" style="margin-top:0">
        ${rateRows || `<p class="small muted" style="margin:0">This creator takes bookings through SIGNL; rates are set on their dashboard.</p>`}
        <p class="small" style="margin:10px 0 0"><strong>Businesses:</strong> <a class="tlink" href="/">sign in</a> to book on SIGNL.</p>
        <p class="small muted">Bookings through SIGNL carry the Visit Guarantee and payment protection: payment is held until the post is live. Deals arranged outside SIGNL carry neither.</p>
        <p class="small muted">Bookings that start on SIGNL stay on SIGNL.</p>
      </div>
    </section>
    <div class="bookme-sticky"><span class="bs-name">Book ${escHtml(p.firstName || p.name)} on SIGNL</span><a class="btn bs-btn" href="/">Book on SIGNL</a></div>
  </div>`;
}

function buildProfilePageHtml(shellHtml, profile) {
  const { title, description } = profilePageMeta(profile);
  const origin = profile.origin || "https://app.joinsignl.com";
  const image = profile.photoUrl
    ? (String(profile.photoUrl).startsWith("http") ? profile.photoUrl : `${origin}${profile.photoUrl}`)
    : null;
  let html = String(shellHtml == null ? "" : shellHtml);
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escHtml(title)}</title>`);
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${escHtml(description)}$2`);
  html = html.replace(/(<meta name="robots" content=")noindex(")/, "$1index, follow$2");
  // Build -64: when the router hands over the profile payload,
  // the body ships with the page and the app bundle defers, so
  // first paint never waits on app.js. Without a payload the
  // shell goes back exactly as before.
  if (profile.body) {
    const place = profile.place || "";
    html = html.replace(/(<main id="app">)[\s\S]*?(<\/main>)/, (m, open, close) => `${open}${profileBodyHtml({ ...profile.body, viewMarket: profile.viewMarket || null, photoUrl: profile.body.photoUrl ? (String(profile.body.photoUrl).startsWith("http") ? profile.body.photoUrl : `${origin}${profile.body.photoUrl}`) : null }, place)}${close}`);
    html = html.replace(/<script src="\/app\.js/, '<script defer src="/app.js');
  }
  const canonical = `${origin}/c/${profile.handle}`;
  const tags = [
    `<link rel="canonical" href="${escHtml(canonical)}">`,
    `<meta property="og:title" content="${escHtml(title)}">`,
    `<meta property="og:description" content="${escHtml(description)}">`,
    `<meta property="og:type" content="profile">`,
    `<meta property="og:url" content="${escHtml(canonical)}">`,
    image ? `<meta property="og:image" content="${escHtml(image)}">` : null,
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escHtml(title)}">`,
    `<meta name="twitter:description" content="${escHtml(description)}">`,
    image ? `<meta name="twitter:image" content="${escHtml(image)}">` : null,
    `<script type="application/ld+json">${profileJsonLd(profile, { title, description }, canonical, image)}</script>`,
  ].filter(Boolean).join("\n");
  html = html.replace(/<\/title>/, `</title>\n${tags}`);
  return html;
}

// Claim-tier page meta (Build -61, 2026-10-31): a creator who
// just claimed holds a live booking page from that moment, and a
// link they paste into their bio should unfurl as them, not as a
// generic SIGNL card. Same tag set as the finished page, two
// differences: the copy says the page is a founding page whose
// booking opens at launch, and robots stays noindex (the shell's
// own value): indexing starts when the finished, approved
// profile takes over under the 2026-10-23 ruling above. No
// JSON-LD: the page carries no ratings, counts, or offers yet.
function claimPageMeta(profile) {
  const place = profile.place || "";
  const named = profile.name && profile.name !== profile.handle ? `${profile.name} (@${profile.handle})` : `@${profile.handle}`;
  const title = `${named} on SIGNL${place ? ` | ${place}` : ""}`;
  const description = `${named} is a founding creator on SIGNL in ${place || "their market"}. Their booking page is live: local businesses book local creators for honest posts, and founding creators get the first look when businesses start booking.`;
  return { title, description };
}

function buildClaimPageHtml(shellHtml, profile) {
  const { title, description } = claimPageMeta(profile);
  const origin = profile.origin || "https://app.joinsignl.com";
  let html = String(shellHtml == null ? "" : shellHtml);
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escHtml(title)}</title>`);
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${escHtml(description)}$2`);
  const canonical = `${origin}/c/${profile.handle}`;
  const tags = [
    `<link rel="canonical" href="${escHtml(canonical)}">`,
    `<meta property="og:title" content="${escHtml(title)}">`,
    `<meta property="og:description" content="${escHtml(description)}">`,
    `<meta property="og:type" content="profile">`,
    `<meta property="og:url" content="${escHtml(canonical)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escHtml(title)}">`,
    `<meta name="twitter:description" content="${escHtml(description)}">`,
  ].join("\n");
  html = html.replace(/<\/title>/, `</title>\n${tags}`);
  return html;
}

module.exports = { buildProfilePageHtml, profilePageMeta, buildClaimPageHtml, claimPageMeta, profileBodyHtml, profileWorkItems, fmtFollowers, profileHeaderSocialsHtml, profileHeaderStatsHtml, profileViewOf, followersForPct, profileDisplayName };
