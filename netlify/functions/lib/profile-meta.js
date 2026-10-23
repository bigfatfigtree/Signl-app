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
  const description = `${profile.name} is a founding creator on SIGNL in ${place || "their market"}${profile.tierBand ? ` (${profile.tierBand} tier)` : ""}. Local businesses comp creators for honest posts.`;
  return { title, description };
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
  const tags = [
    `<meta property="og:title" content="${escHtml(title)}">`,
    `<meta property="og:description" content="${escHtml(description)}">`,
    `<meta property="og:type" content="profile">`,
    `<meta property="og:url" content="${escHtml(`${origin}/c/${profile.handle}`)}">`,
    image ? `<meta property="og:image" content="${escHtml(image)}">` : null,
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${escHtml(title)}">`,
    `<meta name="twitter:description" content="${escHtml(description)}">`,
    image ? `<meta name="twitter:image" content="${escHtml(image)}">` : null,
  ].filter(Boolean).join("\n");
  html = html.replace(/<\/title>/, `</title>\n${tags}`);
  return html;
}

module.exports = { buildProfilePageHtml, profilePageMeta };
