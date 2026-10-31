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
  const description = `${profile.name} is a founding creator on SIGNL in ${place || "their market"}${profile.tierBand ? ` (${profile.tierBand} tier)` : ""}.${pct !== null ? ` ${pct}% of their audience is local.` : ""} Local businesses comp creators for honest posts.`;
  return { title, description };
}

// Structured data for the profile page (SEO/AEO audit, 2026-10-25):
// a ProfilePage whose mainEntity is the creator as a Person, built
// ONLY from the same already-public facts the meta tags carry
// (name, handle, place, tier/local reach via the description,
// cover photo). JSON.stringify output is safe inside a <script>
// block once "</" is neutralized, so a hostile name can never
// break out of the tag.
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

module.exports = { buildProfilePageHtml, profilePageMeta, buildClaimPageHtml, claimPageMeta };
