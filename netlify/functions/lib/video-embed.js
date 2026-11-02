// Shared video embed parser (Build -79, Jeff: Best Work examples
// must show the actual video on the profile, click to play,
// inside the platform).
//
// One parser, one descriptor shape, every surface: the router
// stamps the descriptor onto each best-work card it serves
// (bestWorkCards), the server-rendered public profile reads it
// in profile-meta.js, and public/app.js carries a mirror of this
// exact function for the in-app renders. A URL that does not
// parse to a known video embed returns null and every renderer
// falls back to the plain link card it has always drawn, so a
// bad or non-video URL can never break a profile.
//
// Descriptor: { platform, kind, embedUrl, aspect }
//   platform: "Instagram" | "TikTok" | "YouTube"
//   kind:     "post" | "reel" | "video" | "short"
//   aspect:   "portrait" (IG, TikTok, YouTube Shorts) | "wide" (YouTube 16:9)

function videoEmbedFor(url) {
  let u;
  try {
    u = new URL(String(url || ""));
  } catch (e) {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  const seg = u.pathname.split("/").filter(Boolean);

  if (host === "instagram.com") {
    const type = String(seg[0] || "").toLowerCase();
    const id = seg[1] || "";
    if (!["p", "reel", "reels", "tv"].includes(type) || !/^[A-Za-z0-9_-]{5,40}$/.test(id)) return null;
    const normType = type === "reels" ? "reel" : type;
    return {
      platform: "Instagram",
      kind: normType === "p" ? "post" : "reel",
      embedUrl: `https://www.instagram.com/${normType}/${id}/embed`,
      aspect: "portrait",
    };
  }

  if (host === "tiktok.com") {
    const id = seg[2] || "";
    if (String(seg[0] || "").charAt(0) !== "@" || String(seg[1] || "").toLowerCase() !== "video" || !/^\d{3,}$/.test(id)) return null;
    return {
      platform: "TikTok",
      kind: "video",
      embedUrl: `https://www.tiktok.com/embed/v2/${id}`,
      aspect: "portrait",
    };
  }

  if (host === "youtube.com" || host === "youtu.be") {
    let id = "";
    let kind = "video";
    if (host === "youtu.be") {
      id = seg[0] || "";
    } else if (String(seg[0] || "").toLowerCase() === "watch") {
      id = u.searchParams.get("v") || "";
    } else if (String(seg[0] || "").toLowerCase() === "shorts") {
      id = seg[1] || "";
      kind = "short";
    } else if (String(seg[0] || "").toLowerCase() === "embed" || String(seg[0] || "").toLowerCase() === "live") {
      id = seg[1] || "";
    }
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    return {
      platform: "YouTube",
      kind,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      aspect: kind === "short" ? "portrait" : "wide",
    };
  }

  return null;
}

module.exports = { videoEmbedFor };
