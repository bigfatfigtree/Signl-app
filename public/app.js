// SIGNL app (app.joinsignl.com). Single-page client for the SIGNL API.
"use strict";

const state = {
  user: null,
  boot: null, // markets, tiers, categories, plans
  view: "home",
  tab: null,
  prefill: null, // claim-link prefill: sanitized ?handle=&market=&tier=
  publicHandle: null, // set when the URL is /c/<handle>
  preview: null, // admin Business Preview session (see enterPreview)
  discover: [],
  threads: [],
  activeThread: null, // other user id
  counterCode: "",
};

const app = document.getElementById("app");
const topnav = document.getElementById("topnav");
const bottomnav = document.getElementById("bottomnav");
const PAID_COMP = "Paid cash campaigns";

function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Creator referral (Jeff, 2026-10-18): a visitor who arrived through
// a creator's invite link (?ref=<handle>) carries that credit through
// to their registration, so the inviting creator is credited.
function storedRef() {
  try { return localStorage.getItem("signl_ref") || ""; } catch (e) { return ""; }
}

// Claim-link prefill (Jeff, 2026-10-19): per-target links from email
// and partner channels arrive as ?handle=<ig>&market=<name>&tier=<band>
// and pre-fill the creator sign-up form, so a creator we already know
// lands on a half-completed application instead of a cold form. The
// params only ever FILL fields: they never submit the form, never skip
// the human review, and anything that does not exactly match the
// published market and tier lists is silently ignored. (DM copy is
// unchanged by design: DMs still carry the generic link.)
function sanitizeClaimHandle(v) {
  return String(v || "").trim().replace(/^@/, "").replace(/[^A-Za-z0-9._]/g, "").slice(0, 30);
}

function parseClaimParams(params) {
  const out = {};
  const handle = sanitizeClaimHandle(params.get("handle"));
  if (handle) out.handle = handle;
  const marketRaw = String(params.get("market") || "").trim().slice(0, 60);
  if (marketRaw && state.boot) {
    const m = state.boot.markets.find((x) => x.name === marketRaw || x.id === marketRaw);
    if (m) out.market = m.name;
    else if (marketRaw === unlistedLabel()) out.market = marketRaw;
  }
  const tierRaw = String(params.get("tier") || "").trim().slice(0, 20);
  if (tierRaw && state.boot && state.boot.tiers.some((t) => t.id === tierRaw)) out.tier = tierRaw;
  return out;
}

// Public creator profile (Jeff, 2026-10-19): an approved creator's
// shareable page, app.joinsignl.com/c/<handle>. The server answers a
// whitelist payload for approved creators only; everyone else reads
// as "not public". The roster itself stays private: this is one
// creator's own link, never a listing.
function publicProfileUrl(u) {
  const handle = u && u.creator && u.creator.handle;
  return handle ? `https://app.joinsignl.com/c/${encodeURIComponent(handle)}` : "";
}

async function copyPublicProfile() {
  const el = document.getElementById("pp-copied");
  try {
    await navigator.clipboard.writeText(publicProfileUrl(state.user));
    if (el) el.textContent = "Copied.";
  } catch (e) {
    if (el) el.textContent = "Copy the link from the box above.";
  }
  return false;
}

async function renderPublicProfile() {
  const handle = state.publicHandle || "";
  app.innerHTML = `<section class="panel center" style="max-width:560px;margin:40px auto"><p class="muted">Loading @${esc(handle)}...</p></section>`;
  let p = null;
  try {
    const data = await api("GET", "/c/" + encodeURIComponent(handle));
    p = data.profile;
  } catch (e) { p = null; }
  if (!p) {
    app.innerHTML = `
    <section class="panel center" style="max-width:560px;margin:40px auto">
      <h2>Profile not public</h2>
      <p class="muted">There is no public SIGNL profile at this link. The creator may still be in review, or the link may be wrong.</p>
      <div class="cta-row" style="justify-content:center">
        ${state.user ? `<a class="btn" href="#" onclick="return go('dashboard')">Back to my dashboard</a>` : `<a class="btn" href="#" onclick="return go('join-creator')">Become a Founding Creator</a>`}
      </div>
    </section>`;
    return;
  }
  const place = p.unlisted ? esc(p.city) : esc(p.market);
  const initial = esc((p.name || "?").trim().charAt(0).toUpperCase() || "?");
  app.innerHTML = `
  <div style="max-width:720px;margin:20px auto">
    <div class="creator-card full">
      <div class="cc-photo">
        ${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="">` : `<div class="cc-mono"><span>${initial}</span></div>`}
        ${p.tierBand ? `<span class="cc-tier">${esc(p.tierBand)}</span>` : ""}
        ${p.paidRate ? `<span class="cc-paid">Paid bookings: $${esc(String(p.paidRate))}</span>` : ""}
      </div>
      <div class="cc-body">
        <div class="cc-id">
          <div class="cc-name">${esc(p.name)}</div>
          <div class="cc-handle">@<a href="${esc(p.instagramUrl)}" target="_blank" rel="noopener">${esc(p.handle)}</a></div>
          <div class="cc-chips">
            <span class="cc-chip market">${place}</span>
            ${!p.unlisted && p.city ? `<span class="cc-chip">${esc(p.city)}</span>` : ""}
            ${p.neighborhood ? `<span class="cc-chip">${esc(p.neighborhood)}</span>` : ""}
            <span class="cc-chip">Founding Creator</span>
            ${p.foundingBand ? `<span class="cc-chip">In the first ${p.foundingBand} founding creators in ${place}</span>` : ""}
          </div>
        </div>
        <p>${scoreBadge(p.localImpactScore)}${p.momentumPoints ? ` <span class="badge info">Momentum ${p.momentumPoints} pts</span>` : ""}</p>
        <div class="cc-local">
          ${p.localAudiencePct === null || p.localAudiencePct === undefined
            ? `<div class="lbl">Local audience not reported yet</div>`
            : `<div class="big">${p.localAudiencePct}%</div><div class="lbl">of their followers are local</div><div class="src">${esc(p.localAudienceSource || "Self-reported")}</div>`}
        </div>
        <div class="cc-meta">
          <div><div class="k">Stacked audience</div><div class="v">${fmtNum(totalAudienceOf(p))}</div></div>
        </div>
        ${stackList(p).length ? `<div class="cc-platforms">${stackList(p).map((x) => `<span class="cc-plat">${esc(x.label)} ${fmtNum(x.count)}</span>`).join("")}</div>` : ""}
      </div>
    </div>
    <section class="panel" style="margin-top:20px">
    ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
    ${p.compCategories && p.compCategories.length ? `<p class="small muted">Open to comps: ${p.compCategories.map(esc).join(", ")}</p>` : ""}
    <p class="small">${p.paidRate ? `<span class="badge tier">Paid bookings: $${esc(String(p.paidRate))}</span> ` : ""}${p.compOpen === false ? `<span class="badge warn">Paid visits only</span>` : `<span class="badge info">Open to comp visits</span>`}</p>
    ${p.paidRate ? `<p class="small muted">Businesses can also book this creator at her listed rate: the business pays the rate plus 3%, she keeps 97% of her rate, and SIGNL holds the payment until the post is live.</p>` : ""}
    ${bestWorkHtml(p.bestWork)}
    ${trackRecordHtml(p)}
    ${reviewsHtml(p)}
    ${visitIncludesHtml(p.visitIncludes)}
    <p class="small muted">SIGNL connects local businesses with local creators. Businesses comp a meal or a service, creators post honestly within 48 hours and disclose the comp, and every post is tracked. No business can ever require a positive post.</p>
    <div class="cta-row" style="justify-content:flex-start">
      ${state.user ? `<a class="btn ghost" href="#" onclick="return go('dashboard')">Back to my dashboard</a>` : `<a class="btn" href="#" onclick="return go('join-creator')">Become a Founding Creator</a> <a class="btn ghost" href="#" onclick="return go('for-businesses')">For Businesses</a>`}
    </div>
    </section>
  </div>`;
}

function inviteUrlFor(u) {
  const handle = u && u.creator && u.creator.handle;
  return handle ? `https://app.joinsignl.com/?ref=${encodeURIComponent(handle)}` : "";
}

function growRosterHtml(u) {
  const link = inviteUrlFor(u);
  if (!link) return "";
  const place = u.market === unlistedLabel() ? (u.city || "your city") : u.market;
  const m = u.momentum || { signups: 0, approved: 0, points: 0 };
  return `
    <div class="panel mt" style="text-align:left">
      <h3 style="margin-top:0">Grow your roster</h3>
      <p class="small">Founding rosters fill by invitation. Share your personal invite link with other creators in ${esc(place)}: anyone who signs up through your link is credited to you.</p>
      <div class="field"><label>Your invite link</label><input type="text" readonly value="${esc(link)}" onclick="this.select()"></div>
      <p class="small"><strong>Your roster:</strong> ${m.signups} ${m.signups === 1 ? "creator" : "creators"} joined through your link &middot; ${m.approved} approved &middot; <strong>${m.points} Momentum points</strong></p>
      <p class="small">Creators who build a roster get seen first when businesses start choosing in your market. Points: +3 when a creator joins through your link, +10 when they are approved.</p>
      <p class="small muted">Tap the link to select it, copy it, and send it to a creator who should be on the founding roster with you.</p>
    </div>`;
}

// Momentum (expanded, Jeff 2026-10-19): one computed currency. The
// dashboard shows the total, the ways-to-earn checklist with live
// done/available state, and the ledger that explains the total. All
// of it comes from the server payload (state.user.momentum), which
// is computed from stored records only.
function momentumHtml(u) {
  const m = u && u.momentum;
  if (!m) return "";
  const checklist = (m.checklist || []).map((item) => `
    <div class="earn-row ${item.done ? "done" : ""}">
      <span class="earn-state">${item.done ? "&#10003;" : "+"}</span>
      <span class="earn-label">${esc(item.label)}${item.detail ? ` <span class="muted">(${esc(item.detail)})</span>` : ""}</span>
      <span class="earn-points">${item.points > 0 ? "+" + item.points : item.points} pts</span>
    </div>`).join("");
  const ledger = (m.ledger || []).slice().reverse().slice(0, 30).map((e) => `
    <div class="earn-row">
      <span class="earn-label">${esc(e.label)}${e.at ? ` <span class="muted">${esc(fmtDate(e.at))}</span>` : ""}</span>
      <span class="earn-points ${e.points < 0 ? "neg" : ""}">${e.points > 0 ? "+" + e.points : e.points}</span>
    </div>`).join("");
  return `
  <div class="panel mt" style="text-align:left">
    <div class="flex-between"><h3 style="margin:0">Momentum</h3><span class="badge info" style="font-size:1rem;padding:6px 14px">${m.points} points</span></div>
    <p class="small">Points decide the order businesses see you in. You earn them for completing your profile, delivering posts on time, reviewing businesses after completed visits, posts that run as ads, and recruiting creators. Late posts, no-shows, and a redeemed visit with no post cost you points.${m.floorApplied ? " Your total never drops below zero." : ""}</p>
    <h4 style="margin:14px 0 6px">Ways to earn</h4>
    ${checklist || `<p class="small muted">Loading...</p>`}
    ${ledger ? `<h4 style="margin:16px 0 6px">Points history</h4>${ledger}` : ""}
    <p class="small muted" style="margin-top:12px">Watch out: a post delivered late is -10. A no-show is -25. Redeeming a comp and never posting is -50, and it closes your account to future offers.</p>
  </div>`;
}

function fmtNum(n) {
  if (n === null || n === undefined) return "n/a";
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

// Money at full precision (the ROAS surfaces): dollars and
// cents, thousands separated. fmtNum abbreviates counts; money
// in a return calculation never abbreviates.
function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "n/a";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- audience stacking (Jeff, 2026-10-19) ----------
// A creator's audience is the SUM of their platforms, and every
// surface shows the total plus where it lives. Payloads carry the
// stack as an array of { platform, label, count }; the creator's own
// stored record carries it as a map, so normalize both shapes here.
function stackList(source) {
  if (!source) return [];
  if (Array.isArray(source.audienceStack)) return source.audienceStack.filter((p) => p && p.count > 0);
  if (source.audienceStack && typeof source.audienceStack === "object") {
    const labels = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", x: "X", linkedin: "LinkedIn", youtube: "YouTube" };
    return Object.entries(source.audienceStack)
      .filter(([, n]) => Number(n) > 0)
      .map(([platform, count]) => ({ platform, label: labels[platform] || platform, count: Number(count) }))
      .sort((a, b) => b.count - a.count);
  }
  return [];
}

function totalAudienceOf(source) {
  if (!source) return 0;
  if (typeof source.totalAudience === "number") return source.totalAudience;
  const list = stackList(source);
  if (list.length) return list.reduce((s, p) => s + p.count, 0);
  return (source.profile && source.profile.followerCount) || source.followerCount || 0;
}

function stackChipsHtml(source) {
  const list = stackList(source);
  if (!list.length) return "";
  return `<span class="stack-chips">${list.map((p) => `<span class="stack-chip">${esc(p.label)} ${fmtNum(p.count)}</span>`).join(" ")}</span>`;
}

function audienceLineHtml(source) {
  const total = totalAudienceOf(source);
  return `<strong>${fmtNum(total)}</strong> total audience ${stackChipsHtml(source)}`;
}

// The Standard Visit, as the server defines it (bootstrap carries
// the single source of truth; the fallback text mirrors it).
function standardVisit() {
  return (state.boot && state.boot.standardVisit) || {
    summary: "Every SIGNL visit includes: 1 post or reel + 2 stories within 48 hours of the visit, honest and disclosed, live at least 30 days, with tracked delivery proof. Content rights follow the business's plan.",
  };
}

function visitIncludesHtml(summary) {
  const text = summary || standardVisit().summary;
  return `<div class="showcase-block"><h4>Every SIGNL visit includes</h4><p class="small muted">${esc(text)}</p></div>`;
}

// Content rights by business plan, mirroring the server's
// visitRightsForPlan. The creator's offer checklist prefers the
// server-attached rights on the offer itself; this is the fallback
// and the composer's own-plan line.
function rightsForPlan(planId) {
  if (planId === "growth" || planId === "managed") {
    return {
      can: ["Share your post with you tagged", "Repost it on their own feed", "Run it as an ad while their SIGNL account is active (the ad right ends if their account ends)"],
      cannot: ["Edit your post"],
    };
  }
  return {
    can: ["Share your post with you tagged"],
    cannot: ["Edit it", "Post it as their own content", "Run it as an ad"],
  };
}

// Compliance standing banner for creators (paused / banned).
function standingBannerHtml(u) {
  const st = u && u.standing;
  if (!st || !st.state || st.state === "good") return "";
  if (st.state === "paused") {
    return `<div class="notice"><strong>Your account is paused.</strong> A post from a comped visit is past due. Paste the post link under My Visits and your account unpauses automatically. Until then, businesses see you greyed out and cannot send you new offers.</div>`;
  }
  if (st.state === "banned") {
    return `<div class="error-box"><strong>Your account is closed to offers.</strong> ${esc(st.reason || "A comped visit was redeemed and no post was delivered.")}<br>Questions: hello@joinsignl.com</div>`;
  }
  return "";
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function hoursLeft(deadline) {
  if (!deadline) return null;
  const ms = Date.parse(deadline) - Date.now();
  return ms / 3600000;
}

function renderNav() {
  if (!state.user) {
    topnav.innerHTML = `
      <a href="#" onclick="return go('signin')">Sign in</a>
      <a href="#" onclick="return go('join-creator')">Join as a Founding Creator</a>
      <a href="#" onclick="return go('for-businesses')">For Businesses</a>`;
  } else {
    const u = state.user;
    const label = u.role === "business" && u.business ? u.business.businessName : u.name;
    topnav.innerHTML = `
      <span class="muted small">${esc(label)} &middot; ${esc(u.role)}</span>
      <a href="#" onclick="return go('dashboard')">Dashboard</a>
      <button class="linklike" onclick="signOut()">Sign out</button>`;
  }
  renderBottomNav();
}

// Bottom-nav icons: one inline SVG set, stroke in currentColor, so
// every item renders identically on every phone. The old HTML-entity
// glyphs were the wonkiness Jeff screenshotted (2026-10-20): the
// sign-out arrow rendered as a washed-out blue emoji on iOS, labels
// clipped, and the translucent bar fought the browser chrome.
function bnIcon(name) {
  const paths = {
    home: `<path d="M3 10.8 12 3l9 7.8"/><path d="M5.2 9.4V21h13.6V9.4"/><path d="M9.5 21v-6h5v6"/>`,
    profile: `<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c1.4-3.9 4.4-5.4 7.5-5.4s6.1 1.5 7.5 5.4"/>`,
    offers: `<path d="M3.5 12V4.5H11l9.5 9.5-7.5 7.5z"/><circle cx="8" cy="9.2" r="1.5"/>`,
    visits: `<circle cx="12" cy="12" r="8.6"/><path d="m8.4 12.4 2.5 2.5 4.7-5.2"/>`,
    messages: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>`,
    status: `<path d="m12 3.2 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 9.6l6-.9z"/>`,
    signout: `<path d="M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9"/><path d="m16 16.5 4.5-4.5L16 7.5"/><path d="M20.5 12H9"/>`,
    join: `<circle cx="12" cy="12" r="8.6"/><path d="M12 8.2v7.6M8.2 12h7.6"/>`,
    signin: `<path d="M15 3h3.5A1.5 1.5 0 0 1 20 4.5v15A1.5 1.5 0 0 1 18.5 21H15"/><path d="m10.5 16.5 4.5-4.5-4.5-4.5"/><path d="M15 12H3.5"/>`,
    building: `<rect x="4.5" y="3" width="15" height="18" rx="1"/><path d="M9.5 21v-4h5v4"/><path d="M8 7h2m4 0h2M8 10.8h2m4 0h2"/>`,
    requests: `<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9.3 4.5a2.7 2.7 0 0 1 5.4 0"/><path d="M9 11h6M9 15h4"/>`,
    pin: `<path d="M12 21.2S5 15.3 5 9.9a7 7 0 0 1 14 0c0 5.4-7 11.3-7 11.3z"/><circle cx="12" cy="9.9" r="2.6"/>`,
    list: `<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/>`,
    stats: `<path d="M3.5 20.5h17"/><path d="M6.5 20.5v-7M12 20.5V4.5M17.5 20.5v-10"/>`,
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.home}</svg>`;
}

// App-style bottom navigation for small screens (Jeff, 2026-10-18):
// the top link row wrapped and broke on phones, so on mobile the nav
// lives in a fixed bottom tab bar, with the sections of the signed-in
// experience one tap away. Desktop keeps the top nav.
function renderBottomNav() {
  if (!bottomnav) return;
  const item = (icon, label, onclick, active) => `
    <button class="bn-item ${active ? "on" : ""}" onclick="${onclick}">
      <span class="bn-icon">${bnIcon(icon)}</span><span class="bn-label">${label}</span>
    </button>`;
  const v = state.view;
  const t = state.tab;
  if (!state.user) {
    bottomnav.innerHTML =
      item("home", "Home", "return go('home')", v === "home") +
      item("join", "Join", "return go('join-creator')", v === "join-creator") +
      item("signin", "Sign in", "return go('signin')", v === "signin") +
      item("building", "Businesses", "return go('for-businesses')", v === "for-businesses" || v === "join-business");
    return;
  }
  const u = state.user;
  if (u.status !== "approved" || u.role === "admin") {
    let items = "";
    if (u.role === "admin") {
      items =
        item("requests", "Requests", "return go('dashboard','Applications')", t === "Applications" || !t) +
        item("pin", "Markets", "return go('dashboard','Markets')", t === "Markets") +
        item("list", "Events", "return go('dashboard','Event Log')", t === "Event Log") +
        item("stats", "Stats", "return go('dashboard','Stats')", t === "Stats");
    } else {
      items = item("status", "Status", "return go('dashboard')", true);
    }
    bottomnav.innerHTML = items + item("signout", "Sign out", "signOut()", false);
    return;
  }
  if (u.role === "creator") {
    const live = !!(u.founding && u.founding.marketLive);
    if (!live) {
      // Founding creators (Jeff's tab set, 2026-10-20): Dashboard /
      // Profile / Status / Sign out, mirroring the founding tabs.
      bottomnav.innerHTML =
        item("home", "Dashboard", "return go('dashboard','Dashboard')", t === "Dashboard" || !t || (t !== "Profile" && t !== "Status")) +
        item("profile", "Profile", "return go('dashboard','Profile')", t === "Profile") +
        item("status", "Status", "return go('dashboard','Status')", t === "Status") +
        item("signout", "Sign out", "signOut()", false);
      return;
    }
    bottomnav.innerHTML =
      item("home", "Dashboard", "return go('dashboard','Dashboard')", t === "Dashboard" || !t) +
      item("profile", "Profile", "return go('dashboard','Profile')", t === "Profile") +
      item("offers", "Offers", "return go('dashboard','Offers')", t === "Offers") +
      item("visits", "My Visits", "return go('dashboard','My Visits')", t === "My Visits") +
      item("messages", "Messages", "return go('dashboard','Messages')", t === "Messages") +
      item("signout", "Sign out", "signOut()", false);
    return;
  }
  // business (reachable in test mode; business accounts open at launch)
  bottomnav.innerHTML =
    item("pin", "Discover", "return go('dashboard','Discover')", t === "Discover" || !t) +
    item("offers", "Offers", "return go('dashboard','My Offers')", t === "My Offers") +
    item("visits", "Visits", "return go('dashboard','Visits & Posts')", t === "Visits & Posts") +
    item("messages", "Messages", "return go('dashboard','Messages')", t === "Messages") +
    item("signout", "Sign out", "signOut()", false);
}

function go(view, tab) {
  // Any navigation leaves Business Preview: the mode is a single
  // deliberate walk, and the admin lands back on the normal console.
  if (state.preview) { stopPreviewCountdown(); state.preview = null; }
  stopHomeCountdown();
  state.view = view;
  if (tab) state.tab = tab;
  render();
  return false;
}

async function render() {
  renderNav();
  if (state.view === "public-profile") return renderPublicProfile();
  const u = state.user;
  if (!u) {
    if (state.view === "join-creator") return renderJoinCreator();
    if (state.view === "for-businesses" || state.view === "join-business") return renderForBusinesses();
    if (state.view === "signin") return renderSignin();
    return renderHome();
  }
  if (u.status === "pending") return renderPending();
  if (u.status === "rejected") return renderRejected();
  return renderDashboard();
}

// ---------------- logged-out views ----------------

function renderHome() {
  app.innerHTML = `
  <section class="hero">
    <h1>Local creators.<br><span class="grad-text">Real regulars.</span></h1>
    <p>SIGNL connects local businesses with local creators and everyday people nearby. The business comps a meal or a service, the creator posts honestly within 48 hours, and every visit and post is tracked. No national reach games. National platforms sell reach. We sell regulars.</p>
    <div class="cta-row">
      <a class="btn" href="#" onclick="return go('join-creator')">Become a Founding Creator</a>
      <a class="btn ghost" href="#" onclick="return go('for-businesses')">For Businesses</a>
    </div>
    <p class="small muted mt">Founding creator sign-up is open now in all 39 markets, across 12 countries and territories. Markets open to businesses in the next 30 to 90 days. Don't see your city? Sign up anyway: new markets open where creator sign-ups pile up, and early sign-ups hold founding standing when their city opens.</p>
  </section>
  <section class="grid cols-3 mt">
    <div class="card"><h3>1. Build your founding profile</h3><p class="muted">Creators sign up now and build their full profile: your market, your audience, what share of it is local. Early sign-ups hold founding status and priority when businesses start searching.</p></div>
    <div class="card"><h3>2. Your market opens</h3><p class="muted">When your market opens to businesses, we email you. Businesses browse the founding roster in your market and see what share of each creator's audience is actually local.</p></div>
    <div class="card"><h3>3. Visit, comped, honest post</h3><p class="muted">The creator books a visit and gets a one-time code, redeemed in the app at the visit. The clock starts there: an honest post, with disclosure, within 48 hours.</p></div>
  </section>
  <section class="panel mt">
    <h3>The rules, up front</h3>
    <p>Posts are honest, always. A business can never require a positive post, a rating, or specific words. Creators disclose every comp, as the FTC requires. If a post does not land in 48 hours, the business gets a replacement visit.</p>
  </section>`;
}

function unlistedLabel() {
  return (state.boot && state.boot.unlistedMarket) || "Not listed yet";
}

// "City, Country" for an unlisted creator. Records from before the
// country field fall back to their stored state, so nobody's place
// loses its second half.
function unlistedPlace(rec) {
  const region = rec.country || rec.state || "";
  return `${rec.city || ""}${region ? ", " + region : ""}`;
}

// Market options are grouped by country (United States first, then the
// rest alphabetically), cities alphabetical inside each country, so the
// picker stays scannable as SIGNL goes universal (39 markets, 2026-10-18).
function marketOptions(selected, forJoin) {
  const byCountry = {};
  for (const m of state.boot.markets) {
    const country = m.country || "United States";
    (byCountry[country] = byCountry[country] || []).push(m);
  }
  const countries = Object.keys(byCountry).sort((a, b) => (a === "United States" ? -1 : b === "United States" ? 1 : a.localeCompare(b)));
  const groups = countries.map((country) => {
    const opts = [...byCountry[country]]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => `<option value="${esc(m.name)}" ${m.name === selected ? "selected" : ""}>${esc(m.label)}</option>`)
      .join("");
    return `<optgroup label="${esc(country)}">${opts}</optgroup>`;
  }).join("");
  return forJoin ? groups + `<option value="${esc(unlistedLabel())}">My city is not listed yet</option>` : groups;
}

// The search box above the market picker filters the grouped options
// live; if the current selection gets filtered out, the first match
// takes over so the city list below never disagrees with the market.
function filterMarketOptions() {
  const input = document.getElementById("jc-market-search");
  const sel = document.getElementById("jc-market");
  if (!input || !sel) return;
  const q = input.value.trim().toLowerCase();
  let firstMatch = null;
  for (const opt of sel.querySelectorAll("option")) {
    if (opt.value === unlistedLabel()) continue;
    const hit = !q || opt.textContent.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q);
    opt.hidden = !hit;
    if (hit && !firstMatch) firstMatch = opt;
  }
  for (const grp of sel.querySelectorAll("optgroup")) {
    grp.hidden = ![...grp.querySelectorAll("option")].some((o) => !o.hidden);
  }
  const current = sel.selectedOptions && sel.selectedOptions[0];
  if (q && firstMatch && current && current.hidden) {
    sel.value = firstMatch.value;
    syncMarketChoice();
  }
}

// When a joiner picks "My city is not listed yet", the market city
// dropdown swaps for their own typed city + country: nobody is turned
// away, and their sign-up counts toward opening their city.
function syncMarketChoice() {
  const m = document.getElementById("jc-market");
  if (!m) return;
  const unlisted = m.value === unlistedLabel();
  const cityWrap = document.getElementById("jc-city-wrap");
  const customWrap = document.getElementById("jc-custom-wrap");
  if (cityWrap) cityWrap.style.display = unlisted ? "none" : "";
  if (customWrap) { customWrap.style.display = unlisted ? "" : "none"; customWrap.style.gridColumn = unlisted ? "1 / -1" : ""; }
  if (!unlisted) document.getElementById("jc-city").innerHTML = cityOptions(m.value);
}

function cityOptions(marketName, selected) {
  const m = state.boot.markets.find((x) => x.name === marketName) || state.boot.markets[0];
  return m.cities.map((c) => `<option value="${esc(c)}" ${c === selected ? "selected" : ""}>${esc(c)}</option>`).join("");
}

function renderSignin() {
  app.innerHTML = `
  <section class="panel" style="max-width:460px;margin:30px auto">
    <h2>Sign in</h2>
    <div id="form-error"></div>
    <form onsubmit="return doSignin(event)">
      <div class="field"><label>Email</label><input type="email" id="si-email" required autocomplete="email"></div>
      <div class="field"><label>Password</label><input type="password" id="si-password" required autocomplete="current-password"></div>
      <button class="btn" type="submit" style="width:100%">Sign in</button>
    </form>
    <p class="small muted mt">New to SIGNL? <a href="#" onclick="return go('join-creator')">Join as a founding creator</a>. Businesses: <a href="#" onclick="return go('for-businesses')">join the founding business list</a>.</p>
  </section>`;
}

async function doSignin(e) {
  e.preventDefault();
  try {
    const data = await api("POST", "/auth/login", {
      email: document.getElementById("si-email").value,
      password: document.getElementById("si-password").value,
    });
    state.user = data.user;
    state.view = "dashboard";
    render();
  } catch (err) {
    document.getElementById("form-error").innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
  return false;
}

async function signOut() {
  try { await api("POST", "/auth/logout", {}); } catch (e) { /* ignore */ }
  state.user = null;
  state.view = "home";
  render();
}

function suggestedTierId(followers) {
  const n = Number(followers) || 0;
  if (n >= 15000) return "Headliners";
  if (n >= 2000) return "Locals";
  return "Neighbors";
}

function signupStackTotal() {
  let total = parseInt((document.getElementById("jc-followers") || {}).value, 10) || 0;
  for (const id of ["jc-stack-tiktok", "jc-stack-facebook", "jc-stack-x", "jc-stack-linkedin", "jc-stack-youtube"]) {
    const el = document.getElementById(id);
    if (el) total += parseInt(el.value, 10) || 0;
  }
  return total;
}

// Tier bands are fully automatic (Jeff, 2026-10-19): the band is
// derived from the total audience across platforms, at sign-up and
// on every profile save. Nobody picks or confirms their own band,
// so the form shows it as a read-only line that follows the counts.
function syncSuggestedTier() {
  const total = signupStackTotal();
  const line = document.getElementById("jc-tier-line");
  if (line) line.textContent = total > 0
    ? `Your band: ${suggestedTierId(total)}, set automatically from your total audience across platforms (${total.toLocaleString()} total).`
    : "Your band is set automatically from your total audience across platforms.";
  syncPaidOption();
}

// Paid cash campaigns are a Headliners-tier option: the checkbox block
// only appears while the automatic band is Headliners.
function syncPaidOption() {
  const wrap = document.getElementById("jc-paid-wrap");
  if (wrap) wrap.style.display = suggestedTierId(signupStackTotal()) === "Headliners" ? "" : "none";
}

function profileStackTotal() {
  const ids = ["p-followers", "p-stack-tiktok", "p-stack-facebook", "p-stack-x", "p-stack-linkedin", "p-stack-youtube"];
  return ids.reduce((s, id) => s + (parseInt((document.getElementById(id) || {}).value, 10) || 0), 0);
}

function syncPaidOptionProfile() {
  const wrap = document.getElementById("p-paid-wrap");
  if (wrap) wrap.style.display = suggestedTierId(profileStackTotal()) === "Headliners" ? "" : "none";
}

function renderJoinCreator() {
  const cats = state.boot.creatorCategories.map((c) => `<label><input type="checkbox" name="c-cat" value="${esc(c)}"> ${esc(c)}</label>`).join("");
  const comps = state.boot.compCategories.map((c) => `<label><input type="checkbox" name="c-comp" value="${esc(c)}"> ${esc(c)}</label>`).join("");
  const pf = state.prefill || {};
  const pfMarket = pf.market || "Hampton Roads";
  const hasPrefill = !!(pf.handle || pf.market || pf.tier);
  app.innerHTML = `
  <section class="panel" style="max-width:680px;margin:10px auto">
    <h2>Become a Founding Creator</h2>
    <p class="muted">SIGNL is opening market by market, and creators are signing up first. Build your full founding profile now: when your market opens to businesses in the next 30 to 90 days, we email you, and founding creators get priority when businesses search. This is not a waitlist form; this is your real profile. City not listed yet? Pick "My city is not listed yet" below and sign up anyway: your sign-up counts toward opening your city, and you hold founding standing there.</p>
    ${hasPrefill ? `<div class="notice blue">Your invite link told us a head start: we pre-filled what it carried below. Check it, finish the rest, and your profile goes into the review queue.</div>` : ""}
    <div id="form-error"></div>
    <form onsubmit="return doRegisterCreator(event)">
      <div class="form-2col">
        <div class="field"><label>Full name</label><input id="jc-name" required autocomplete="name"></div>
        <div class="field"><label>Email (how we reach you at launch)</label><input type="email" id="jc-email" required autocomplete="email"></div>
      </div>
      <div class="field"><label>Password (10+ characters)</label><input type="password" id="jc-password" required minlength="10" autocomplete="new-password"></div>
      <div class="form-2col">
        <div class="field"><label>Your market</label><input id="jc-market-search" placeholder="Search markets, for example: Dubai" oninput="filterMarketOptions()" style="margin-bottom:6px"><select id="jc-market" onchange="syncMarketChoice()">${marketOptions(pfMarket, true)}</select><p class="small muted">Markets are grouped by country. Don't see your city? Pick "My city is not listed yet" and sign up anyway.</p></div>
        <div class="field" id="jc-city-wrap"><label>Your home city</label><select id="jc-city">${cityOptions(pfMarket)}</select></div>
        <div id="jc-custom-wrap" style="display:none">
          <div class="field"><label>Your city</label><input id="jc-city-text" placeholder="For example: Tulsa"></div>
          <div class="field"><label>Your country</label><input id="jc-country-text" placeholder="For example: United States"></div>
          <div class="field"><label>Your state or province (optional)</label><input id="jc-state-text" placeholder="Optional, for example: OK"></div>
          <p class="small muted">SIGNL is not open there yet. Your sign-up counts: when enough creators in your city sign up, we open there, and founding sign-ups go first.</p>
        </div>
      </div>
      <div class="field"><label>Your neighborhood or area (optional)</label><input id="jc-neighborhood" placeholder="For example: Oceanfront, Ghent, Town Center" maxlength="80"><p class="small muted">The part of town you actually post from. Businesses search by neighborhood, so this helps the right ones find you.</p></div>
      <div class="form-2col">
        <div class="field"><label>Instagram handle (required)</label><input id="jc-handle" placeholder="yourhandle" required value="${esc(pf.handle || "")}" oninput="document.getElementById('jc-ig-link').textContent = this.value ? 'instagram.com/' + this.value.replace(/^@/, '') : ''"><p class="small muted" id="jc-ig-link"></p></div>
        <div class="field"><label>TikTok handle (optional)</label><input id="jc-tiktok" placeholder="yourhandle"></div>
      </div>
      <div class="field"><label>YouTube channel (optional)</label><input id="jc-youtube" placeholder="Channel name or URL"></div>
      <div class="form-2col">
        <div class="field"><label>Facebook profile or Page (optional)</label><input id="jc-facebook" placeholder="facebook.com/yourpage or full URL"></div>
        <div class="field"><label>X (Twitter) handle or URL (optional)</label><input id="jc-x" placeholder="yourhandle or x.com/yourhandle"></div>
      </div>
      <div class="field"><label>LinkedIn profile (optional)</label><input id="jc-linkedin" placeholder="linkedin.com/in/yourname or full URL"></div>
      <div class="form-2col">
        <div class="field"><label>Instagram followers (required)</label><input type="number" id="jc-followers" min="0" required placeholder="For example 8400" oninput="syncSuggestedTier()"></div>
        <div class="field"><label>Your tier band</label><p id="jc-tier-line" style="margin:6px 0">Your band is set automatically from your total audience across platforms.</p><p class="small muted">Neighbors 500 to 2k &middot; Locals 2k to 15k &middot; Headliners 15k and up. Nobody picks their own band; it updates itself as your counts change.</p></div>
      </div>
      <div class="field"><label>Your audience on other platforms (optional)</label>
        <div class="form-2col">
          <div class="field"><label>TikTok followers</label><input type="number" id="jc-stack-tiktok" min="0" placeholder="Optional" oninput="syncSuggestedTier()"></div>
          <div class="field"><label>Facebook followers</label><input type="number" id="jc-stack-facebook" min="0" placeholder="Optional" oninput="syncSuggestedTier()"></div>
          <div class="field"><label>X followers</label><input type="number" id="jc-stack-x" min="0" placeholder="Optional" oninput="syncSuggestedTier()"></div>
          <div class="field"><label>LinkedIn connections</label><input type="number" id="jc-stack-linkedin" min="0" placeholder="Optional" oninput="syncSuggestedTier()"></div>
          <div class="field"><label>YouTube subscribers</label><input type="number" id="jc-stack-youtube" min="0" placeholder="Optional" oninput="syncSuggestedTier()"></div>
        </div>
        <p class="small muted">SIGNL stacks your audience: your tier and your profile read your TOTAL across every platform, not just Instagram. Add the ones you use; skip the rest.</p>
      </div>
      <div class="form-2col">
        <div class="field"><label>Typical post views (optional)</label><input type="number" id="jc-avgviews" min="0" placeholder="For example 6000"></div>
        <div class="field"><label>What share of your followers live in your market? (%)</label>
          <input type="number" id="jc-localpct" min="0" max="100" required placeholder="For example 60">
          <p class="small muted">Be honest. This shows on your profile labeled Self-reported until Instagram verification is available. It is the number businesses care about most.</p>
        </div>
      </div>
      <div class="field"><label>Top audience cities (optional)</label><input id="jc-topcities" placeholder="For example: Virginia Beach, Norfolk, Chesapeake"><p class="small muted">Up to 5, comma separated.</p></div>
      <div class="field"><label>What do you create in? (pick at least one)</label><div class="checkrow">${cats}</div></div>
      <div class="field"><label>Comps you would accept (optional)</label><div class="checkrow">${comps}</div></div>
      <div class="field" id="jc-paid-wrap" style="display:none">
        <label style="font-weight:500"><input type="checkbox" id="jc-paid" style="width:auto"> <strong>Paid cash campaigns</strong> (Headliners tier): on top of comps, businesses can hire me for paid campaigns when a business runs one.</label>
        <p class="small muted">Paid campaigns depend on the business and the campaign. Comps are always part of SIGNL; cash work is extra when it is offered.</p>
      </div>
      <div class="field"><label>Short bio</label><textarea id="jc-bio" rows="2" placeholder="What do you post, where do you go, what do you love locally?"></textarea></div>
      <div class="field"><label>Profile photo (optional, add now or later)</label><input type="file" id="jc-photo" accept="image/png,image/jpeg,image/webp"><p class="small muted">PNG, JPEG, or WebP, under 2.5 MB. Businesses see this on your profile when your market opens.</p></div>
      <div class="notice blue">The deal, in plain words:
        <ul style="margin:8px 0 0;padding-left:18px">
          <li>A business comps you a meal or service. You post your honest experience within 48 hours of the visit and disclose the comp. Nobody can ask you for a positive post. Ever.</li>
          <li>Your check-off is the post link: you paste it in the app under My Visits. The link is the proof.</li>
          <li>Post within 48 hours for full credit. One week is the hard stop: a late post inside the week still counts, and reminders land at 48 hours, day 5, and day 6.</li>
          <li>At one week with no post, your account pauses. A post in the second week still lands and unpauses you, with the missed deadline on your record. At two weeks with no post, your account closes to future offers. Showing up matters here.</li>
        </ul>
      </div>
      <div class="field"><label style="font-weight:500"><input type="checkbox" id="jc-agree-honest" style="width:auto" required> I understand no business can require me to post positively. My posts stay my honest opinion.</label></div>
      <div class="field"><label style="font-weight:500"><input type="checkbox" id="jc-agree-ftc" style="width:auto" required> I agree to clearly disclose every comp in my posts, as the FTC requires.</label></div>
      <div class="field"><label style="font-weight:500"><input type="checkbox" id="jc-agree-compliance" style="width:auto" required> I agree to post within 48 hours of every comped visit for full credit and paste the post link in the app. I understand one week is the hard stop: a redeemed visit with no post pauses my account at one week and closes it at two.</label></div>
      <div class="field"><label style="font-weight:500"><input type="checkbox" id="jc-agree-terms" style="width:auto" required> I agree to the <a href="https://joinsignl.com/terms.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="https://joinsignl.com/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>, and I agree SIGNL can email me about my account, launch updates and offers. I can unsubscribe from marketing emails at any time.</label></div>
      <button class="btn" type="submit" style="width:100%">Create my founding profile</button>
      <p class="small muted mt">Every application is reviewed by a person. Founding spots are limited in every market, and priority goes in sign-up order.</p>
    </form>
  </section>`;
  // Claim-link prefill, applied to the live form: the handle link
  // preview and the unlisted-city swap when the link named no listed
  // market. (The ?tier= param is still parsed, but bands are fully
  // automatic now, so it fills nothing.) Filling only; nothing here
  // submits anything.
  if (pf.handle) {
    const linkEl = document.getElementById("jc-ig-link");
    if (linkEl) linkEl.textContent = "instagram.com/" + pf.handle;
  }
  if (pf.market === unlistedLabel()) syncMarketChoice();
}

function readPhotoInput(inputId) {
  return new Promise((resolve) => {
    const input = document.getElementById(inputId);
    if (!input || !input.files || !input.files[0]) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(input.files[0]);
  });
}

async function uploadPhotoInput(inputId) {
  const dataUrl = await readPhotoInput(inputId);
  if (!dataUrl) return false;
  try {
    await api("POST", "/me/photo", { dataUrl });
    return true;
  } catch (e) {
    return false; // non-fatal: the creator can add it from their profile
  }
}

async function doRegisterCreator(e) {
  e.preventDefault();
  const errBox = (msg) => {
    document.getElementById("form-error").innerHTML = `<div class="error-box">${esc(msg)}</div>`;
    window.scrollTo(0, 0);
  };
  const cats = Array.from(document.querySelectorAll("input[name=c-cat]:checked")).map((x) => x.value);
  const comps = Array.from(document.querySelectorAll("input[name=c-comp]:checked")).map((x) => x.value);
  if (!cats.length) { errBox("Pick at least one category you create in."); return false; }
  if (!document.getElementById("jc-agree-honest").checked) { errBox("Please confirm the honest-post rule."); return false; }
  if (!document.getElementById("jc-agree-ftc").checked) { errBox("Please confirm the FTC disclosure agreement."); return false; }
  if (!document.getElementById("jc-agree-compliance").checked) { errBox("Please confirm the post rule: post within 48 hours for full credit, paste the link, one week is the hard stop, and a redeemed visit with no post pauses at one week and closes at two."); return false; }
  const stackFromForm = { instagram: parseInt(document.getElementById("jc-followers").value, 10) || 0 };
  for (const [id, platform] of [["jc-stack-tiktok", "tiktok"], ["jc-stack-facebook", "facebook"], ["jc-stack-x", "x"], ["jc-stack-linkedin", "linkedin"], ["jc-stack-youtube", "youtube"]]) {
    const v = parseInt(document.getElementById(id).value, 10) || 0;
    if (v > 0) stackFromForm[platform] = v;
  }
  if (!document.getElementById("jc-agree-terms").checked) { errBox("Please agree to the Terms of Service and email consent so we can reach you at launch."); return false; }
  const autoBand = suggestedTierId(signupStackTotal());
  const paidBox = document.getElementById("jc-paid");
  if (autoBand === "Headliners" && paidBox && paidBox.checked && !comps.includes(PAID_COMP)) comps.push(PAID_COMP);
  const topCities = document.getElementById("jc-topcities").value.split(",").map((x) => x.trim()).filter(Boolean);
  const marketVal = document.getElementById("jc-market").value;
  const isUnlisted = marketVal === unlistedLabel();
  const customCity = isUnlisted ? document.getElementById("jc-city-text").value.trim() : "";
  const customCountry = isUnlisted ? document.getElementById("jc-country-text").value.trim() : "";
  const customState = isUnlisted ? document.getElementById("jc-state-text").value.trim() : "";
  if (isUnlisted && !customCity) { errBox("Tell us your city, so your sign-up counts toward opening SIGNL there."); return false; }
  if (isUnlisted && !customCountry) { errBox("Tell us your country, so your sign-up counts toward opening SIGNL there."); return false; }
  try {
    const data = await api("POST", "/auth/register", {
      role: "creator",
      name: document.getElementById("jc-name").value,
      email: document.getElementById("jc-email").value,
      password: document.getElementById("jc-password").value,
      market: marketVal,
      city: isUnlisted ? undefined : document.getElementById("jc-city").value,
      neighborhood: document.getElementById("jc-neighborhood").value,
      customCity: isUnlisted ? customCity : undefined,
      customCountry: isUnlisted ? customCountry : undefined,
      customState: isUnlisted ? customState : undefined,
      handle: document.getElementById("jc-handle").value,
      tiktokHandle: document.getElementById("jc-tiktok").value,
      youtubeChannel: document.getElementById("jc-youtube").value,
      facebookUrl: document.getElementById("jc-facebook").value,
      xHandle: document.getElementById("jc-x").value,
      linkedinUrl: document.getElementById("jc-linkedin").value,
      followerCount: parseInt(document.getElementById("jc-followers").value, 10) || 0,
      audienceStack: stackFromForm,
      avgViews: parseInt(document.getElementById("jc-avgviews").value, 10) || 0,
      localAudiencePct: Number(document.getElementById("jc-localpct").value),
      topAudienceCities: topCities,
      categories: cats,
      compCategories: comps,
      bio: document.getElementById("jc-bio").value,
      agreedHonestPosts: true,
      agreedFtcDisclosure: true,
      agreedPostCompliance: true,
      agreedTerms: true,
      referredBy: storedRef() || undefined,
    });
    state.user = data.user;
    await uploadPhotoInput("jc-photo");
    try {
      const me = await api("GET", "/auth/me");
      state.user = me.user;
    } catch (e2) { /* keep the registration response */ }
    state.view = "dashboard";
    render();
  } catch (err) {
    errBox(err.message);
  }
  return false;
}

function renderForBusinesses() {
  const plans = state.boot.plans.map((p) => `
    <div class="plan-card">
      <div class="price">$${p.priceMonthly}<span class="small muted">/mo</span></div>
      <strong>${esc(p.name)}</strong>
      <p class="small muted">${p.minMonths}-month minimum, then month to month.</p>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    </div>`).join("");
  app.innerHTML = `
  <section class="panel" style="max-width:680px;margin:10px auto">
    <h2>For Businesses: founding list, not accounts. Yet.</h2>
    <p>SIGNL is building its founding creator rosters first, market by market. Business accounts open when your market launches, in the next 30 to 90 days. Until then, founding businesses join by list, not by account.</p>
    <p><strong>Why join the list now:</strong> the price on this page is the founding price. Join the founding business list and you lock it in. When your market opens, your account activates at founding pricing while later businesses pay the standard rate.</p>
    <div class="plan-cards">${plans}</div>
    <div class="notice blue mt">Founding pricing: Self-Service $299/mo, Growth $599/mo, Managed $999/mo, 3-month minimum, then month to month. Joining the list costs nothing and charges nothing. It holds your price and your place in your market's launch.</div>
    <a class="btn" style="width:100%;text-align:center" href="https://joinsignl.com/businesses.html">Join the founding business list</a>
    <p class="small muted mt">The list lives on joinsignl.com. When your market launches we will email you there and open your account here, with the founding roster in your market ready to browse.</p>
    <p class="small muted">Creator sign-up is separate and open now: <a href="#" onclick="return go('join-creator')">become a founding creator</a>. The creator roster itself is not public; only businesses with activated accounts in a launched market can browse it.</p>
  </section>`;
}

function selectPlan(id) {
  document.getElementById("jb-plan").value = id;
  document.querySelectorAll(".plan-card").forEach((el) => el.classList.remove("selected"));
  const el = document.getElementById("plan-" + id);
  if (el) el.classList.add("selected");
  const hidden = document.getElementById("me-plan");
  if (hidden) hidden.value = id;
}

function renderPending() {
  const u = state.user;
  const f = u.founding || {};
  const isCreator = u.role === "creator";
  const isUnlisted = isCreator && u.market === unlistedLabel();
  const place = isUnlisted ? esc(unlistedPlace(u)) : esc(u.market);
  app.innerHTML = `
  <section class="panel center" style="max-width:560px;margin:40px auto">
    <h2>${isCreator ? "Founding profile received" : "Application received"}</h2>
    <p>Thanks, ${esc(u.name)}. ${isCreator ? `Your founding creator profile for <strong>${place}</strong> is built and in the review queue. Every founding application gets a decision or a clear status within 2 business days.` : "Every SIGNL application is reviewed by a person before accounts activate. Yours is in the queue."}</p>
    ${isCreator && f.queueBand ? `<p><span class="badge info">${isUnlisted ? `You are in the first ${f.queueBand} to sign up in ${esc(u.city)}` : `You are in the first ${f.queueBand} founding creators in ${esc(u.market)}`}</span></p>` : ""}
    <p class="muted">${isCreator
      ? isUnlisted
        ? `SIGNL is not open in ${esc(u.city)} yet, and your sign-up counts toward opening it: we open new markets where creator sign-ups pile up, and founding sign-ups there go first. Every application is reviewed by a person. The moment you are approved, your founding status page opens here, and we will email you at ${esc(u.email)} the moment ${esc(u.city)} opens. Sign back in any time to check your status.${state.boot && state.boot.email && state.boot.email.enabled ? ` A confirmation email is on its way to ${esc(u.email)}.` : ""}`
        : `Every application is reviewed by a person. The moment you are approved, your founding status page opens here, and we will email you at ${esc(u.email)} when ${esc(u.market)} opens to businesses in the next 30 to 90 days. Sign back in any time to check your status.${state.boot && state.boot.email && state.boot.email.enabled ? ` A confirmation email is on its way to ${esc(u.email)}.` : ""}`
      : "Sign back in any time to check your status; your dashboard opens the moment you are approved."}</p>
    ${isCreator && !(u.creator && u.creator.hasPhoto) ? `
    <div style="text-align:left">
      <div class="field"><label>Add your profile photo now (optional)</label><input type="file" id="pending-photo" accept="image/png,image/jpeg,image/webp"></div>
      <button class="btn small-btn" onclick="return uploadPendingPhoto(event)">Upload photo</button> <span id="pending-photo-ok" class="saved"></span>
    </div>` : ""}
    ${isCreator ? growRosterHtml(u) : ""}
    <div class="mt"><button class="btn ghost" onclick="signOut()">Sign out</button></div>
  </section>`;
}

async function uploadPendingPhoto(e) {
  e.preventDefault();
  const ok = await uploadPhotoInput("pending-photo");
  const el = document.getElementById("pending-photo-ok");
  if (el) el.textContent = ok ? "Photo added to your profile." : "That photo did not upload. You can add it later from your profile.";
  if (ok && state.user && state.user.creator) state.user.creator.hasPhoto = true;
  return false;
}

function renderRejected() {
  app.innerHTML = `
  <section class="panel center" style="max-width:560px;margin:40px auto">
    <h2>Not a fit right now</h2>
    <p>Your application was not approved for this round. Markets open in waves, and you are welcome to apply again when your market expands.</p>
    <p class="muted">Questions: hello@joinsignl.com</p>
    <button class="btn ghost" onclick="signOut()">Sign out</button>
  </section>`;
}

// ---------------- dashboards ----------------

function renderDashboard() {
  const u = state.user;
  if (u.role === "admin" && state.preview) return renderPreview();
  if (u.role === "admin") return renderAdmin();
  if (u.role === "creator") return renderCreatorDash();
  return renderBusinessDash();
}

function tabsHtml(tabs, active) {
  return `<div class="tabs">${tabs.map((t) => `<button class="${t === active ? "active" : ""}" onclick="go('dashboard','${esc(t)}')">${esc(t)}</button>`).join("")}</div>`;
}

function scoreBadge(score) {
  if (score === null || score === undefined) return `<span class="badge info">Impact score pending</span>`;
  return `<span class="badge ok">Local Impact Score ${score}</span>`;
}

// Every social link a creator provided, rendered the same way wherever
// a profile is displayed (founding page, business discovery).
function socialLinksHtml(p) {
  const links = [];
  if (p.instagramUrl) links.push(`<a href="${esc(p.instagramUrl)}" target="_blank" rel="noopener">Instagram</a>`);
  if (p.tiktokUrl) links.push(`<a href="${esc(p.tiktokUrl)}" target="_blank" rel="noopener">TikTok</a>`);
  if (p.youtubeChannel) links.push(/^https?:\/\//i.test(p.youtubeChannel) ? `<a href="${esc(p.youtubeChannel)}" target="_blank" rel="noopener">YouTube</a>` : `YouTube: ${esc(p.youtubeChannel)}`);
  if (p.facebookUrl) links.push(`<a href="${esc(p.facebookUrl)}" target="_blank" rel="noopener">Facebook</a>`);
  if (p.xUrl) links.push(`<a href="${esc(p.xUrl)}" target="_blank" rel="noopener">X</a>`);
  if (p.linkedinUrl) links.push(`<a href="${esc(p.linkedinUrl)}" target="_blank" rel="noopener">LinkedIn</a>`);
  return links.join(" &middot; ");
}

// ---------- creator showcase: photo, best work, track record, reviews ----------
// One set of renderers for every surface that shows a creator (public
// profile page, discovery card, full profile view, the creator's own
// profile, and the admin Business Preview), so what a business sees
// is identical everywhere. All data comes from the server payloads,
// which compute everything from stored records only.

function starsHtml(n) {
  const full = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return `<span class="stars" title="${full} out of 5 stars">${"★".repeat(full)}${"☆".repeat(5 - full)}</span>`;
}

// ---------- paid lane + review links (Jeff, 2026-10-19) ----------
// Two lanes, one roster. These renderers read only the normalized
// payload fields (profile.paidRate: number or null; profile.compOpen:
// boolean) so every surface states the creator's booking terms the
// same way: her listed rate with a "Paid bookings" marker when she
// charges, and her comp-open state either way.
function paidLaneBadgesHtml(p) {
  if (!p) return "";
  let out = "";
  if (p.paidRate) out += ` <span class="badge tier">Paid bookings: $${esc(String(p.paidRate))}</span>`;
  out += p.compOpen === false
    ? ` <span class="badge warn">Paid visits only</span>`
    : ` <span class="badge info">Open to comp visits</span>`;
  return out;
}

// The business's public review pages, as a courtesy block. The
// server sends [{key,label,url}] only when links exist, so this
// renders nothing at all for businesses without them. No points
// attach to external reviews, anywhere, ever.
function reviewLinksBlockHtml(links) {
  if (!links || !links.length) return "";
  return `<div class="showcase-block"><h4>Their review pages</h4><p class="small" style="margin:0">${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(" &middot; ")}</p><p class="small muted" style="margin:4px 0 0">If you want to leave them a public review too, these are their pages. Entirely your call, and never part of the deal.</p></div>`;
}

// Book a paid visit at the creator's listed rate (real surface).
async function bookPaidVisit(creatorId) {
  const c = (state.discover || []).find((x) => x.userId === creatorId);
  const p = c && c.profile ? c.profile : {};
  const rate = p.paidRate;
  if (!rate) { alert("That creator has not listed a paid rate."); return; }
  const total = Math.round(rate * 1.03 * 100) / 100;
  const net = Math.round(rate * 0.97 * 100) / 100;
  if (!confirm(`Book a paid visit with ${c ? c.name : "this creator"} at their listed rate of $${rate}?\n\nYou pay $${total} (the rate plus 3%). They keep $${net} (97% of their rate). SIGNL holds the payment and releases it when their post is live. Comp-only is always fine too: paid is only for booking this specific creator.`)) return;
  try {
    const data = await api("POST", "/bookings/paid", { creatorId });
    state.tab = "Visits & Posts";
    render();
    setTimeout(() => alert(`Paid visit booked. The code is ${data.booking.code}; the creator shows it at the visit and the 48 hour post clock starts at redemption. Payment state: ${data.booking.paidLane.paymentNote}`), 50);
  } catch (err) { alert(err.message); }
}

// Preview twin of the paid booking: a simulation with the real fee
// math, zero writes (the server route enforces it).
async function previewPaidBooking(creatorId) {
  try {
    const data = await api("POST", "/admin/preview/paid-booking", { creatorId });
    const bk = data.booking;
    alert(`PREVIEW paid booking (simulation)\n\nCreator rate: $${bk.rate}\nYou pay: $${bk.businessTotal} (rate + 3%)\nCreator keeps: $${bk.creatorNet} (97% of her rate)\nSIGNL fee: $${bk.platformFee} total, split evenly\nEscrow: held by SIGNL until the post is live\n\n${bk.paymentNote}\n${bk.note}`);
  } catch (err) { alert(err.message); }
}

// Creator reviews the business after a completed visit: +10
// Momentum at ANY star rating (honest reviews, never paid praise).
async function submitBusinessReview(e, bookingId) {
  e.preventDefault();
  const stars = document.getElementById("bizrev-stars-" + bookingId).value;
  const text = document.getElementById("bizrev-text-" + bookingId).value;
  try {
    await api("POST", `/bookings/${bookingId}/review-business`, { stars: Number(stars), text });
    loadMyVisits("creator");
  } catch (err) { alert(err.message); }
  return false;
}

// The creator's uploaded photo, or a brand-styled initial tile when
// they have not added one yet.
function avatarHtml(card, cls) {
  if (card.photoUrl) return `<img class="${cls}" src="${esc(card.photoUrl)}" alt="">`;
  const initial = esc((card.name || "?").trim().charAt(0).toUpperCase() || "?");
  return `<span class="${cls} avatar-initial" aria-hidden="true">${initial}</span>`;
}

// Best work renders as labeled outbound link cards ("Watch: Instagram
// reel"). Third-party players are never embedded.
function bestWorkHtml(list, compact) {
  if (!list || !list.length) return "";
  const cards = list.map((w) => `<a class="work-card" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer"><span class="work-play">&#9654;</span><span>${esc(w.label)}</span><span class="work-host">${esc(w.platform)}</span></a>`).join("");
  if (compact) return `<div class="work-row">${cards}</div>`;
  return `<div class="showcase-block"><h4>Best work</h4><div class="work-row">${cards}</div></div>`;
}

// The SIGNL track record: real visits, posts, and on-time record from
// completed platform bookings only. Before any activity the honest
// zero state shows instead of numbers.
function trackRecordHtml(card) {
  const tr = card.trackRecord;
  if (!tr) return "";
  if (tr.isNew) {
    return `<div class="showcase-block"><h4>SIGNL track record</h4><p class="muted">New to SIGNL: no visits yet.${card.foundingBand ? ` Founding creator, first ${card.foundingBand} in ${esc(card.market || "")}.` : ""} Every completed visit, delivered post, and on-time record appears here as it happens, computed from real bookings only.</p></div>`;
  }
  const names = (tr.businessesWorkedWith || []).map(esc).join(", ");
  return `<div class="showcase-block"><h4>SIGNL track record</h4>
    <div class="stat-row">
      <div class="stat"><div class="num">${tr.visitsCompleted}</div><div class="lbl">Visits completed</div></div>
      <div class="stat"><div class="num">${tr.postsDelivered}</div><div class="lbl">Posts delivered</div></div>
      <div class="stat"><div class="num">${tr.onTimePct === null || tr.onTimePct === undefined ? "—" : tr.onTimePct + "%"}</div><div class="lbl">On time</div></div>
      ${typeof tr.contentViews === "number" ? `<div class="stat"><div class="num">${fmtNum(tr.contentViews)}</div><div class="lbl">Content views (creator-reported)</div></div>` : ""}
    </div>
    ${names ? `<p class="small muted">Worked with: ${names}</p>` : ""}</div>`;
}

// Business reviews appear only when a real review exists (a business
// reviewed a completed visit). Nothing is ever seeded or averaged in.
function reviewsHtml(card) {
  const sum = card.reviewSummary || { count: 0, average: null };
  if (!sum.count) return "";
  const items = (card.reviews || []).map((r) => `
    <div class="review-item">
      <div>${starsHtml(r.stars)} <strong>${esc(r.businessName)}</strong> <span class="muted small">${esc(fmtDate(r.createdAt))}</span></div>
      ${r.comment ? `<p style="margin:6px 0 0">${esc(r.comment)}</p>` : ""}
    </div>`).join("");
  return `<div class="showcase-block"><h4>Business reviews</h4>
    <p>${starsHtml(sum.average)} <strong>${esc(String(sum.average))}</strong> average from ${sum.count} business review${sum.count === 1 ? "" : "s"} after completed visits.</p>
    ${items}</div>`;
}

function creatorShowcaseHtml(card) {
  return bestWorkHtml(card.bestWork) + trackRecordHtml(card) + reviewsHtml(card);
}

// The full creator profile view: what a business opens from a
// discovery card (and what the admin preview opens). Built entirely
// from the same card payload discovery returns, so the detail view
// can never disagree with the card.
function creatorProfileDetailHtml(c, preview) {
  const p = c.profile || {};
  const localTxt = p.localAudiencePct === null || p.localAudiencePct === undefined
    ? "Local audience not reported yet"
    : `${p.localAudiencePct}% local audience <span class="badge info">${esc(p.localAudienceSource || "Self-reported")}</span>`;
  const initial = esc((c.name || "?").trim().charAt(0).toUpperCase() || "?");
  return `
  <div class="panel">
    <p><button class="btn small-btn ghost" onclick="${preview ? "previewBackToResults()" : "backToDiscover()"}">&larr; Back to results</button></p>
    <div class="creator-card full">
      <div class="cc-photo">
        ${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="">` : `<div class="cc-mono"><span>${initial}</span></div>`}
        ${p.tierBand ? `<span class="cc-tier">${esc(p.tierBand)}</span>` : ""}
        ${p.paidRate ? `<span class="cc-paid">Paid bookings: $${esc(String(p.paidRate))}</span>` : ""}
      </div>
      <div class="cc-body">
        <div class="cc-id">
          <div class="cc-name">${esc(c.name)}</div>
          <div class="cc-handle">@<a href="${esc(p.instagramUrl || "")}" target="_blank" rel="noopener">${esc(p.handle || "")}</a></div>
          <div class="cc-chips">
            <span class="cc-chip market">${esc(c.market)}</span>
            ${c.city ? `<span class="cc-chip">${esc(c.city)}</span>` : ""}
            ${c.neighborhood ? `<span class="cc-chip">${esc(c.neighborhood)}</span>` : ""}
            ${c.foundingBand ? `<span class="cc-chip">Founding creator, first ${c.foundingBand} in market</span>` : ""}
          </div>
        </div>
        <p>${scoreBadge(c.localImpactScore)}${p.openToPaidCampaigns ? ` <span class="badge tier">Open to paid campaigns</span>` : ""}${paidLaneBadgesHtml(p)}${c.momentum && c.momentum.points ? ` <span class="badge info">Momentum ${c.momentum.points} pts</span>` : ""}</p>
        <div class="cc-local">
          ${p.localAudiencePct === null || p.localAudiencePct === undefined
            ? `<div class="lbl">Local audience not reported yet</div>`
            : `<div class="big">${p.localAudiencePct}%</div><div class="lbl">of their followers are local</div><div class="src">${esc(p.localAudienceSource || "Self-reported")}</div>`}
        </div>
        <div class="cc-meta">
          <div><div class="k">Total audience (all platforms)</div><div class="v">${fmtNum(totalAudienceOf(c))}</div></div>
          <div><div class="k">Typical views</div><div class="v">${fmtNum(p.avgViews)}</div></div>
        </div>
        ${stackList(c).length ? `<div class="cc-platforms">${stackList(c).map((x) => `<span class="cc-plat">${esc(x.label)} ${fmtNum(x.count)}</span>`).join("")}</div>` : ""}
      </div>
    </div>
    ${c.standing === "paused" ? `<p><span class="badge warn">Paused: a late post is outstanding</span> <span class="small muted">Greyed out in search and unable to take new offers until the post is delivered.</span></p>` : ""}
    ${c.bookedUp ? `<p><span class="badge info">Booked up this week</span> <span class="small muted">At their weekly visit max. Offers can still be sent; accepting reopens next week.</span></p>` : ""}
    ${visitIncludesHtml(c.visitIncludes)}
    ${c.scoreComponents ? `<p class="small muted">Local Impact Score, in the open: local audience ${c.scoreComponents.localAudiencePct}% &middot; reliability ${c.scoreComponents.reliability} (${esc(c.scoreComponents.reliabilityBasis)}) &middot; engagement ${c.scoreComponents.engagement}.</p>` : ""}
    ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
    ${p.compCategories && p.compCategories.filter((x) => x !== PAID_COMP).length ? `<p class="small muted">Open to comps: ${p.compCategories.filter((x) => x !== PAID_COMP).map(esc).join(", ")}</p>` : ""}
    ${p.topAudienceCities && p.topAudienceCities.length ? `<p class="small muted">Top audience cities: ${p.topAudienceCities.map(esc).join(", ")}</p>` : ""}
    ${p.bio ? `<p>${esc(p.bio)}</p>` : ""}
    <p class="small">${socialLinksHtml(p)}</p>
    ${creatorShowcaseHtml(c)}
    <div class="cta-row" style="justify-content:flex-start">
      ${preview
        ? `<button class="btn" onclick="previewStartOffer('${c.userId}')">Send this creator an offer (preview)</button>${p.paidRate ? ` <button class="btn ghost" onclick="previewPaidBooking('${c.userId}')">Preview paid booking ($${esc(String(p.paidRate))})</button>` : ""}`
        : `<button class="btn" onclick="startOffer('${c.userId}')">Send offer</button>${p.paidRate ? ` <button class="btn" onclick="bookPaidVisit('${c.userId}')">Book paid visit ($${esc(String(p.paidRate))})</button>` : ""} <button class="btn ghost" onclick="openThread('${c.userId}')">Message</button>`}
    </div>
    ${p.paidRate ? `<p class="small muted">Paid bookings: this creator lists a paid rate of $${esc(String(p.paidRate))} for the same Standard Visit. You pay the rate plus 3%, she keeps 97% of her rate, and SIGNL holds the payment until her post is live. Comp-only is always fine too.</p>` : ""}
    ${preview ? `<p class="small muted">Preview: an offer sent from here is a simulation. It never reaches ${esc(c.name)} and nothing is saved.</p>` : ""}
    ${preview && c.trackRecord && c.trackRecord.postsDelivered > 0 ? `
    <div class="showcase-block"><h4>Ad use (preview)</h4>
      <p class="small muted">On Growth and Managed plans, a business can run a delivered post as an ad while its account is active. In the real app that logs the use, notifies the creator, and awards +25 Momentum. Here it is a simulation: nothing is logged and no points move.</p>
      <button class="btn small-btn ghost" onclick="previewAdUse('${c.userId}')">Use a delivered post in an ad (preview)</button> <span id="pv-aduse-note" class="saved"></span>
    </div>` : ""}
  </div>`;
}

async function previewAdUse(userId) {
  const note = document.getElementById("pv-aduse-note");
  try {
    const data = await api("POST", "/admin/preview/ad-use", { creatorId: userId, planId: state.preview ? state.preview.planId : "growth" });
    if (note) note.textContent = (data.adUse && data.adUse.note) || "Simulated.";
  } catch (err) {
    if (note) note.textContent = err.message;
  }
}

function openCreatorProfile(userId) {
  const c = (state.discover || []).find((x) => x.userId === userId);
  const el = document.getElementById("tab-body");
  if (!c || !el) return;
  el.innerHTML = creatorProfileDetailHtml(c, false);
  window.scrollTo(0, 0);
}

function backToDiscover() {
  loadDiscover();
}

function creatorCard(c, viewer, opts) {
  opts = opts || {};
  const p = c.profile || {};
  const localTxt = p.localAudiencePct === null || p.localAudiencePct === undefined
    ? "Local audience not reported yet"
    : `${p.localAudiencePct}% local audience <span class="badge info">${esc(p.localAudienceSource || "Self-reported")}</span>`;
  const tr = c.trackRecord;
  const trackLine = tr
    ? (tr.isNew
      ? `<span class="badge info">New to SIGNL: no visits yet</span>`
      : `<span class="muted">${tr.visitsCompleted} visits completed &middot; ${tr.postsDelivered} posts delivered &middot; ${tr.onTimePct === null || tr.onTimePct === undefined ? "—" : tr.onTimePct + "% on time"}</span>`)
    : "";
  const reviewLine = c.reviewSummary && c.reviewSummary.count
    ? ` ${starsHtml(c.reviewSummary.average)} <strong>${esc(String(c.reviewSummary.average))}</strong> <span class="muted">(${c.reviewSummary.count} review${c.reviewSummary.count === 1 ? "" : "s"})</span>`
    : "";
  // v2 .creator-card anatomy: one component for discovery, the public
  // profile hero, and the profile detail header (DESIGN-SYSTEM.md).
  // Same data, same words, same handlers; only the layout changed.
  const initial = esc((c.name || "?").trim().charAt(0).toUpperCase() || "?");
  return `
  <div class="creator-card${c.standing === "paused" ? " paused" : ""}">
    <div class="cc-photo">
      ${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="">` : `<div class="cc-mono"><span>${initial}</span></div>`}
      ${p.tierBand ? `<span class="cc-tier">${esc(p.tierBand)}</span>` : ""}
      ${p.paidRate ? `<span class="cc-paid">Paid bookings: $${esc(String(p.paidRate))}</span>` : ""}
    </div>
    <div class="cc-id">
      <div class="cc-name">${esc(c.name)}</div>
      <div class="cc-handle">@${esc(p.handle || "")}</div>
      <div class="cc-chips">
        <span class="cc-chip market">${esc(c.market)}</span>
        ${c.city ? `<span class="cc-chip">${esc(c.city)}</span>` : ""}
        ${c.neighborhood ? `<span class="cc-chip">${esc(c.neighborhood)}</span>` : ""}
        ${c.foundingBand ? `<span class="cc-chip">Founding creator, first ${c.foundingBand} in market</span>` : ""}
      </div>
    </div>
    <div class="cc-local">
      ${p.localAudiencePct === null || p.localAudiencePct === undefined
        ? `<div class="lbl">Local audience not reported yet</div>`
        : `<div class="big">${p.localAudiencePct}%</div><div class="lbl">of their followers are local</div><div class="src">${esc(p.localAudienceSource || "Self-reported")}</div>`}
    </div>
    <div class="cc-meta">
      <div><div class="k">Stacked audience</div><div class="v">${fmtNum(totalAudienceOf(c))}</div></div>
      <div><div class="k">Typical views</div><div class="v">${fmtNum(p.avgViews)}</div></div>
    </div>
    ${stackList(c).length ? `<div class="cc-platforms">${stackList(c).map((x) => `<span class="cc-plat">${esc(x.label)} ${fmtNum(x.count)}</span>`).join("")}</div>` : ""}
    ${c.standing === "paused" ? `<p><span class="badge warn">Paused: a late post is outstanding</span> <span class="small muted">This creator is greyed out and cannot take new offers until the post is delivered.</span></p>` : ""}
    ${c.bookedUp ? `<p><span class="badge info">Booked up this week</span> <span class="small muted">At their weekly visit max. You can still send offers; they can accept next week.</span></p>` : ""}
    <p>${scoreBadge(c.localImpactScore)}${p.openToPaidCampaigns ? ` <span class="badge tier">Open to paid campaigns</span>` : ""}${paidLaneBadgesHtml(p)}${c.momentum && c.momentum.points ? ` <span class="badge info">Momentum ${c.momentum.points} pts</span>` : ""}</p>
    ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
    ${p.compCategories && p.compCategories.filter((x) => x !== PAID_COMP).length ? `<p class="small muted">Open to comps: ${p.compCategories.filter((x) => x !== PAID_COMP).map(esc).join(", ")}</p>` : ""}
    ${p.bio ? `<p class="small muted">${esc(p.bio)}</p>` : ""}
    <p class="small">${socialLinksHtml(p)}</p>
    ${bestWorkHtml(c.bestWork, true)}
    ${trackLine || reviewLine ? `<div class="cc-track">${trackLine}${reviewLine}</div>` : ""}
    <p class="small muted">Every SIGNL visit: 1 post or reel + 2 stories within 48 hours, tracked as proof. Content rights follow your plan.</p>
    <div class="cc-actions">
      ${opts.preview
        ? `<button class="btn small-btn" onclick="previewViewCreator('${c.userId}')">View profile</button>
           <button class="btn small-btn ghost" onclick="previewStartOffer('${c.userId}')">Send preview offer</button>${p.paidRate ? `
           <button class="btn small-btn ghost" onclick="previewPaidBooking('${c.userId}')">Preview paid booking ($${esc(String(p.paidRate))})</button>` : ""}`
        : `<button class="btn small-btn" onclick="startOffer('${c.userId}')">Send offer</button>${p.paidRate ? `
           <button class="btn small-btn" onclick="bookPaidVisit('${c.userId}')">Book paid visit ($${esc(String(p.paidRate))})</button>` : ""}
           <button class="btn small-btn ghost" onclick="openCreatorProfile('${c.userId}')">View profile</button>
           <button class="btn small-btn ghost" onclick="openThread('${c.userId}')">Message</button>
           <button class="heart ${c.isFavorite ? "on" : ""}" title="Save to favorites" onclick="toggleFav('${c.userId}')">${c.isFavorite ? "&#10084;" : "&#9825;"}</button>`}
    </div>
  </div>`;
}

// ---------- creator ----------

const LIVE_CREATOR_TABS = ["Dashboard", "Profile", "Offers", "My Visits", "Messages"];
const FOUNDING_TABS = ["Dashboard", "Profile", "Status"];

function renderCreatorDash() {
  const u = state.user;
  const marketLive = !!(u.founding && u.founding.marketLive);
  if (!marketLive) { stopHomeCountdown(); return renderFoundingHome(); }
  let tab = state.tab || "Dashboard";
  if (!LIVE_CREATOR_TABS.includes(tab)) tab = "Dashboard";
  state.tab = tab;
  if (tab !== "Dashboard") stopHomeCountdown();
  let body = "";
  if (tab === "Dashboard") body = `<div id="creator-home"><p class="muted">Loading your dashboard...</p></div>`;
  if (tab === "Profile") body = creatorProfileHtml(u) + momentumHtml(u) + growRosterHtml(u);
  app.innerHTML = `
    <h2>Creator dashboard <span class="badge ok">Founding Creator, ${esc(u.market)}</span></h2>
    ${standingBannerHtml(u)}
    ${tabsHtml(LIVE_CREATOR_TABS, tab)}
    <div id="tab-body">${body}</div>`;
  if (tab === "Dashboard") loadCreatorHome();
  if (tab === "Profile") setTimeout(loadMyScore, 10);
  if (tab === "Offers") loadCreatorOffers();
  if (tab === "My Visits") loadMyVisits("creator");
  if (tab === "Messages") loadThreads();
}

// The approved creator's home before their market activates. It is
// a real tabbed interface now (Jeff, 2026-10-20: Dashboard / Profile
// / Status, mirroring the bottom nav), because founding creators are
// the entire audience until markets open and the old single status
// page hid the Home blocks from every one of them. Dashboard leads
// with the home blocks; the full founding status detail lives under
// Status; Profile is the same profile form founding creators already
// use. Data comes from GET /me/founding (which also powers the score).
function renderFoundingHome() {
  const u = state.user;
  let tab = state.tab || "Dashboard";
  if (!FOUNDING_TABS.includes(tab)) tab = "Dashboard";
  state.tab = tab;
  const placeBadge = u.market === unlistedLabel() ? esc(u.city || u.market) : esc(u.market);
  let body = "";
  if (tab === "Dashboard") body = `<div id="founding-dash"><p class="muted">Loading your dashboard...</p></div>`;
  if (tab === "Status") body = `<h3 style="margin-top:0">Your founding status</h3><div id="founding-body"><p class="muted">Loading your founding profile...</p></div>`;
  if (tab === "Profile") body = creatorProfileHtml(u);
  app.innerHTML = `
    <h2>Creator dashboard <span class="badge ok">Founding Creator, ${placeBadge}</span></h2>
    ${standingBannerHtml(u)}
    ${tabsHtml(FOUNDING_TABS, tab)}
    <div id="tab-body">${body}</div>`;
  if (tab === "Dashboard") loadFoundingDashboard();
  if (tab === "Status") loadFoundingStatus();
  if (tab === "Profile") setTimeout(loadMyScore, 10);
}

// The founding Dashboard tab: greeting, a compact founding status
// card (the full detail is one tap away under Status), the metric
// band and paid lane panel, Momentum, and the roster block.
async function loadFoundingDashboard() {
  const el = document.getElementById("founding-dash");
  if (!el) return;
  try {
    const data = await api("GET", "/me/founding");
    if (!document.getElementById("founding-dash")) return; // navigated away mid-load
    const f = data.founding;
    const card = data.card;
    const p = card.profile || {};
    state.user.founding = f;
    const u = state.user;
    const isUnl = !!f.unlisted;
    const place = isUnl ? esc(unlistedPlace(f)) : esc(f.market);
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const firstName = (u.name || "").trim().split(" ")[0] || u.name || "";
    el.innerHTML = `
    <p class="ui-kicker">Creator dashboard &middot; ${place}</p>
    <h3 class="home-title">${esc(greet)}, ${esc(firstName)}.</h3>
    <p class="ui-sub">${isUnl ? `${esc(f.city)} opens when sign-ups pile up. Until then, this is your home: your numbers, your paid lane, and your roster.` : `${esc(f.market)} opens to businesses in the next ${esc(f.launchWindow)}. Until then, this is your home: your numbers, your paid lane, and your roster.`}</p>
    <div class="panel">
      <div class="flex-between">
        <div>
          <h3 style="margin:0">${esc(u.name)} <span class="muted">@${esc(p.handle || "")}</span></h3>
          <p class="muted small">${isUnl ? place : `${esc(f.market)} &middot; ${esc(f.city)}`}</p>
        </div>
        <span class="badge ok" style="font-size:0.95rem;padding:6px 14px">Founding Creator, ${isUnl ? esc(f.city) : esc(f.market)}</span>
      </div>
      <p class="small">${p.localAudiencePct}% local audience &middot; ${esc(p.tierBand || "")} tier &middot; ${fmtNum(totalAudienceOf(card))} total audience${f.priorityBand ? ` &middot; in the first ${f.priorityBand} founding creators in ${place}` : ""}</p>
      <p style="margin-bottom:0">${scoreBadge(card.localImpactScore)}</p>
      <div class="home-actions"><button class="btn small-btn ghost" onclick="return go('dashboard','Status')">See your full status</button></div>
    </div>
    ${homeFoundingBlocksHtml(card, u)}
    ${momentumHtml(u)}
    ${growRosterHtml(u)}`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

// The founding Status tab: the full founding status detail (status,
// market, tier, local audience and source, Impact Score, reliability,
// audience stack, what happens next), unchanged from the old
// founding page, now hosted under its own tab.
async function loadFoundingStatus() {
  const el = document.getElementById("founding-body");
  if (!el) return;
  try {
    const data = await api("GET", "/me/founding");
    const f = data.founding;
    const card = data.card;
    const p = card.profile || {};
    state.user.founding = f;
    const isUnl = !!f.unlisted;
    const place = isUnl ? esc(unlistedPlace(f)) : esc(f.market);
    el.innerHTML = `
    <div class="panel">
      <div class="flex-between">
        <div>
          <h3 style="margin:0">${esc(state.user.name)} <span class="muted">@${esc(p.handle || "")}</span></h3>
          <p class="muted small">${isUnl ? place : `${esc(f.market)} &middot; ${esc(f.city)}`}</p>
        </div>
        <span class="badge ok" style="font-size:0.95rem;padding:6px 14px">Founding Creator, ${isUnl ? esc(f.city) : esc(f.market)}</span>
      </div>
      <div class="grid cols-2 mt">
        <div>
          ${card.photoUrl ? `<img class="profile-photo" src="${esc(card.photoUrl)}" alt="Your profile photo">` : `<div class="photo-placeholder">No photo yet. Add one in your profile below; businesses see it when ${isUnl ? esc(f.city) : esc(f.market)} opens.</div>`}
          <p>${p.localAudiencePct}% local audience <span class="badge info">${esc(p.localAudienceSource || "Self-reported")}</span></p>
          <p>${scoreBadge(card.localImpactScore)}</p>
          ${card.scoreComponents ? `<p class="small muted">Reliability ${card.scoreComponents.reliability} &middot; ${esc(card.scoreComponents.reliabilityBasis)}</p>` : ""}
        </div>
        <div>
          <p class="small"><strong>${fmtNum(totalAudienceOf(card))}</strong> total audience &middot; ${esc(p.tierBand || "")} tier ${p.avgViews ? "&middot; " + fmtNum(p.avgViews) + " typical views" : ""}</p>
          ${stackList(card).length ? `<p class="small">${stackChipsHtml(card)}</p>` : ""}
          ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
          ${p.openToPaidCampaigns ? `<p class="small"><span class="badge tier">Open to paid campaigns</span></p>` : ""}
          <p class="small">${paidLaneBadgesHtml(p)}</p>
          ${p.compCategories && p.compCategories.filter((x) => x !== PAID_COMP).length ? `<p class="small muted">Open to comps: ${p.compCategories.filter((x) => x !== PAID_COMP).map(esc).join(", ")}</p>` : ""}
          ${p.neighborhood ? `<p class="small muted">Neighborhood: ${esc(p.neighborhood)}</p>` : ""}
          ${p.topAudienceCities && p.topAudienceCities.length ? `<p class="small muted">Top audience cities: ${p.topAudienceCities.map(esc).join(", ")}</p>` : ""}
          ${p.bio ? `<p class="small muted">${esc(p.bio)}</p>` : ""}
          <p class="small">
            ${socialLinksHtml(p)}
          </p>
        </div>
      </div>
    </div>
    ${isUnl ? `
    <div class="panel">
      <h3 style="margin-top:0">${esc(f.city)} opens when sign-ups pile up</h3>
      <p>SIGNL is not open in ${place} yet. Your sign-up is counted: we open new markets where creator sign-ups pile up, and when ${esc(f.city)} opens, its founding sign-ups are first in line for offers. We email you at <strong>${esc(state.user.email)}</strong> the moment it opens.</p>
      ${f.priorityBand ? `<p><span class="badge tier" style="font-size:0.95rem;padding:6px 14px">You are in the first ${f.priorityBand} to sign up in ${esc(f.city)}</span></p>
      <p class="muted">You signed up early, and it counts: founding creators in a new market are ordered by sign-up time, earliest first.</p>` : ""}
      <p class="muted">Keep your profile current in the meantime; when ${esc(f.city)} opens, your local audience percentage is what businesses look at first.</p>
    </div>` : `
    <div class="panel">
      <h3 style="margin-top:0">${esc(f.market)} opens to businesses in the next ${esc(f.launchWindow)}</h3>
      <p>Your market is not taking business offers yet, and that is on purpose: SIGNL opens each market with its founding roster in place. The moment ${esc(f.market)} opens, we email you at <strong>${esc(state.user.email)}</strong>.</p>
      ${f.priorityBand ? `<p><span class="badge tier" style="font-size:0.95rem;padding:6px 14px">You are in the first ${f.priorityBand} founding creators in ${esc(f.market)}</span></p>
      <p class="muted">You signed up early, and it counts: when businesses search the ${esc(f.market)} roster, founding creators are ordered by sign-up time, earliest first.</p>` : ""}
      <p class="muted">Offers, visits, and messages unlock here the day your market activates. Keep your profile current in the meantime; your local audience percentage is what businesses look at first.</p>
    </div>`}`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

// ---------------- creator home (dashboard concept merge, 2026-10-20) ----------------
// The creator's first screen, in the founding home (pre-launch
// blocks) and as the live dashboard's Dashboard tab. Built from the
// concept Jeff approved, fed ONLY by data the app already has:
// /bookings, /offers, /me/founding, and state.user.momentum. No
// estimated reach, no invented ranking scores, no instant-money
// framing: paid cash stays in its own piles, labeled with the
// real hold, and comp value is never summed into cash.
// Mobile first (Jeff, hard requirement): every block below is a
// single stacked column at phone width; the CSS only widens.

let homeTickTimer = null;
function startHomeCountdown() {
  stopHomeCountdown();
  tickHomeCountdowns();
  homeTickTimer = setInterval(tickHomeCountdowns, 1000);
}
function stopHomeCountdown() {
  if (homeTickTimer) { clearInterval(homeTickTimer); homeTickTimer = null; }
}
function homeDurCore(ms) {
  if (!Number.isFinite(ms)) return "";
  const a = Math.abs(ms);
  const d = Math.floor(a / 86400000), h = Math.floor((a % 86400000) / 3600000), m = Math.floor((a % 3600000) / 60000), s = Math.floor((a % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
function tickHomeCountdowns() {
  document.querySelectorAll(".home-tick").forEach((el) => {
    const t = Date.parse(el.dataset.target || "");
    if (!t) return;
    const diff = t - Date.now();
    el.textContent = homeDurCore(diff) + (diff < 0 && el.dataset.mode === "post" ? " overdue" : "");
  });
}

// The money piles, computed from the creator's own bookings: paid
// cash released, paid cash still held, paid cash refunded, and
// comp value received (the face value of comps actually redeemed,
// at the businesses' stated caps). Cash and comp never mix.
function homeMoney(bookings) {
  let released = 0, held = 0, refunded = 0, compValue = 0, paidCount = 0;
  for (const b of bookings) {
    if (b.redeemedAt && !b.honorReportedAt) compValue += Number(b.dollarCap) || 0;
    const lane = b.paidLane;
    if (lane) {
      paidCount += 1;
      if (lane.escrowState === "released") released += Number(lane.creatorNet) || 0;
      else if (lane.escrowState === "refunded") refunded += Number(lane.creatorNet) || 0;
      else held += Number(lane.creatorNet) || 0;
    }
  }
  const round = (n) => Math.round(n * 100) / 100;
  return { released: round(released), held: round(held), refunded: round(refunded), compValue: round(compValue), paidCount };
}

// The current on-time streak, counted from real delivered posts:
// walk the posts newest first and stop at the first late one.
// The Momentum engine pays +25 at every 5 in a row; this only
// displays the count those stored posts prove.
function homeStreak(bookings) {
  const posts = bookings.filter((b) => b.post).map((b) => b.post)
    .sort((a, b) => (String(a.submittedAt) < String(b.submittedAt) ? -1 : 1));
  let streak = 0;
  for (let i = posts.length - 1; i >= 0; i--) {
    if (posts[i].onTime) streak += 1; else break;
  }
  return { delivered: posts.length, streak };
}

// The next visit that needs the creator: a running post clock
// first, then a code waiting to be redeemed, then a paid visit
// whose money is still in its post-proof hold.
function homeActiveBooking(bookings) {
  const live = bookings.filter((b) => b.status !== "expired" && !b.honorReportedAt);
  const clock = live.filter((b) => b.redeemedAt && !b.post)
    .sort((a, b) => (String(a.postDeadline || "") < String(b.postDeadline || "") ? -1 : 1));
  if (clock.length) return clock[0];
  const booked = live.filter((b) => !b.redeemedAt && b.codeStatus === "issued")
    .sort((a, b) => (String(a.redeemBy || a.createdAt || "") < String(b.redeemBy || b.createdAt || "") ? -1 : 1));
  if (booked.length) return booked[0];
  const held = live.filter((b) => b.post && b.paidLane && b.paidLane.escrowState === "held")
    .sort((a, b) => (String(a.createdAt || "") < String(b.createdAt || "") ? -1 : 1));
  return held[0] || null;
}

function homeTrackerHtml(b) {
  const paidDone = b.paidLane ? b.paidLane.escrowState === "released" : !!(b.post && b.post.verifiedAt);
  const steps = [
    { label: "Visit confirmed", done: true, current: false },
    { label: "Redeemed in app", done: !!b.redeemedAt, current: !b.redeemedAt },
    { label: "Add live post link", done: !!b.post, current: !!b.redeemedAt && !b.post },
    { label: b.paidLane ? "Post verified, money released" : "Post verified", done: paidDone, current: !!b.post && !paidDone },
  ];
  return `<div class="home-steps">${steps.map((s) => `
    <div class="home-step ${s.done ? "done" : ""} ${s.current ? "current" : ""}">
      <span class="hs-dot">${s.done ? "&#10003;" : ""}</span><span>${esc(s.label)}</span>
    </div>`).join("")}</div>`;
}

function homeActiveVisitHtml(b) {
  if (!b) {
    return `
  <section class="panel">
    <p class="ui-kicker">Active visit</p>
    <h3 class="home-h">No active visit right now</h3>
    <p class="small muted">When you accept an offer, the visit, its one-time code, and its 48 hour post clock live here, front and center.</p>
    <div class="home-actions"><button class="btn small-btn" onclick="return go('dashboard','Offers')">See offers</button></div>
  </section>`;
  }
  const lane = b.paidLane;
  const clockRunning = !!b.redeemedAt && !b.post;
  const awaitingRedeem = !b.redeemedAt && b.codeStatus === "issued";
  let clockBlock = "";
  if (clockRunning) {
    const diff = Date.parse(b.postDeadline || "") - Date.now();
    clockBlock = `
    <p class="ui-kicker" style="margin-top:14px">Time left to post</p>
    <div class="home-count home-tick" data-mode="post" data-target="${esc(b.postDeadline || "")}">${esc(homeDurCore(diff))}${diff < 0 ? " overdue" : ""}</div>
    <p class="small muted">Post by ${esc(fmtDate(b.postDeadline))}. Paste the post link under My Visits and the visit checks off.</p>`;
  } else if (awaitingRedeem) {
    clockBlock = `
    <p class="small" style="margin-top:12px">Your redemption window closes <strong>${esc(fmtDate(b.redeemBy))}</strong> (<span class="countdown home-tick" data-target="${esc(b.redeemBy || "")}">${esc(homeDurCore(Date.parse(b.redeemBy || "") - Date.now()))}</span> left). Come any time inside the window; no appointment needed. Your 48 hour post clock starts the moment staff redeem your code.</p>`;
  } else if (b.post && lane && lane.escrowState === "held") {
    const releaseTxt = lane.proofAt ? fmtDate(new Date(Date.parse(lane.proofAt) + 48 * 3600 * 1000).toISOString()) : "48 hours after your post proof lands";
    clockBlock = `
    <p class="small" style="margin-top:12px"><strong>Your post is in.</strong> The paid money for this visit is held by SIGNL and releases ${esc(releaseTxt)}. Nothing else is owed on this visit.</p>`;
  }
  const codeBlock = b.codeStatus === "issued" ? `
    <div class="home-visit-grid">
      <div>
        <p class="small muted" style="margin-bottom:0">Your one-time visit code. Show this at the visit; staff redeem it in the app and your 48 hour clock starts at that moment.</p>
        <div class="code-display">${esc(b.code)}</div>
        ${b.redeemBy ? `<p class="small"><strong>Use by ${esc(fmtDate(b.redeemBy))}</strong>. If the window passes unused, the offer expires and counts as a no-show.</p>` : ""}
      </div>
      <div class="qr-box"><img src="/api/bookings/${b.id}/qr" alt="QR code for ${esc(b.code)}" onerror="this.parentElement.style.display='none'"></div>
    </div>` : (b.redeemedAt ? `
    <p class="small muted">Code ${esc(b.code)} was redeemed ${esc(fmtDate(b.redeemedAt))} and is burned. It can never be used again.</p>` : "");
  const actionBlock = clockRunning
    ? `<div class="home-actions"><button class="btn small-btn" onclick="return go('dashboard','My Visits')">Paste your post link</button></div>`
    : awaitingRedeem
      ? `<div class="home-actions">${b.checkinAt ? `<span class="small">You checked in at ${esc(fmtDate(b.checkinAt))}. Waiting for the business to confirm.</span>` : `<button class="btn small-btn ghost" onclick="homeCheckIn('${b.id}')">I am here (check in)</button>`}<button class="btn small-btn" onclick="return go('dashboard','My Visits')">Visit details</button></div>`
      : "";
  return `
  <section class="panel">
    <div class="flex-between">
      <p class="ui-kicker" style="margin:0">Active visit</p>
      ${lane ? `<span class="badge tier">Paid visit</span>` : `<span class="badge info">Comp visit</span>`}
    </div>
    <h3 class="home-h">${esc(b.title)} at ${esc(b.businessName)}</h3>
    <p class="small muted" style="margin:0">Comp: ${esc(b.whatComped)} (cap $${b.dollarCap})${lane ? ` &middot; Your rate $${lane.rate}: you receive $${lane.creatorNet}` : ""}</p>
    ${homeTrackerHtml(b)}
    ${clockBlock}
    ${codeBlock}
    ${actionBlock}
  </section>`;
}

async function homeCheckIn(bookingId) {
  try { await api("POST", `/bookings/${bookingId}/checkin`, {}); loadCreatorHome(); }
  catch (err) { alert(err.message); }
}

async function homeAcceptOffer(e, offerId) {
  e.preventDefault();
  try {
    const data = await api("POST", `/offers/${offerId}/accept`, {});
    const useBy = data.booking && data.booking.redeemBy ? ` Use it any time by ${fmtDate(data.booking.redeemBy)}; no appointment needed.` : "";
    alert(`Booked. Your one-time code is ${data.booking.code}.${useBy} Show it at the visit; staff redeem it in the app and your 48 hour post clock starts.`);
    loadCreatorHome();
  } catch (err) { alert(err.message); }
  return false;
}

// Opportunities picked for you: the same open offers the Offers
// tab lists, ordered the honest way: sent directly to you first,
// then the most spots still open. Every card spells out the deal
// (compensation, the Standard Visit deliverables, the business's
// plan rights, the window) before any accept button.
function homeOpportunitiesHtml(offers, u) {
  const ranked = offers.slice().sort((a, b) => {
    const ta = a.creatorId === u.id ? 0 : 1;
    const tb = b.creatorId === u.id ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return ((b.spots || 0) - (b.bookedCount || 0)) - ((a.spots || 0) - (a.bookedCount || 0));
  });
  if (!ranked.length) {
    return `
  <section class="panel">
    <p class="ui-kicker">Opportunities</p>
    <h3 class="home-h">No open offers right now</h3>
    <p class="small muted">When businesses in ${esc(u.market)} send offers, the best fits land here first. Your local audience percentage is what businesses look at hardest; keep it current in your profile.</p>
  </section>`;
  }
  const cards = ranked.slice(0, 3).map((o) => {
    const rights = o.visitRights || rightsForPlan(o.businessPlan);
    const left = Math.max(0, (o.spots || 0) - (o.bookedCount || 0));
    return `
    <div class="card home-opp mb">
      <div class="flex-between"><strong>${esc(o.title)}</strong><span class="badge tier">${esc(o.businessName)}</span></div>
      ${o.creatorId ? `<p style="margin:8px 0 0"><span class="badge ok">Sent directly to you</span></p>` : ""}
      <p class="small"><strong>You get:</strong> ${esc(o.whatComped)} (comp cap $${o.dollarCap})</p>
      <p class="small"><strong>You post:</strong> 1 post or reel + 2 stories within 48 hours of your visit, honest, with the comp disclosed. The post stays live at least 30 days, and you check off by pasting the post link in My Visits.</p>
      <p class="small"><strong>They can:</strong> ${rights.can.map(esc).join("; ")}<br><strong>They can't:</strong> ${rights.cannot.map(esc).join("; ")}</p>
      <p class="small muted">Deadline: ${o.windowMode === "thisweek" ? "visit this week, the window ends Sunday" : "visit any time within 7 days of accepting"}. ${left} of ${o.spots} spot${o.spots === 1 ? "" : "s"} left.${o.visitWindow ? ` Note from the business: ${esc(o.visitWindow)}` : ""}</p>
      <form onsubmit="return homeAcceptOffer(event, '${o.id}')">
        <button class="btn small-btn" type="submit">Accept and get my code</button>
      </form>
    </div>`;
  }).join("");
  return `
  <section class="panel">
    <p class="ui-kicker">Opportunities picked for you</p>
    <h3 class="home-h">Open offers in ${esc(u.market)}</h3>
    <p class="small muted">Sent to you first, then the open offers with the most spots left. The full deal is on every card before you accept anything.</p>
    ${cards}
    ${ranked.length > 3 ? `<div class="home-actions"><button class="btn small-btn ghost" onclick="return go('dashboard','Offers')">See all ${ranked.length} offers</button></div>` : ""}
  </section>`;
}

// Your local signal: the proof businesses read on your profile,
// from the same card /me/founding returns. Register actions only
// appear when a business has actually reported a tally.
function homeLocalSignalHtml(card, bookings) {
  const p = (card && card.profile) || {};
  const tr = (card && card.trackRecord) || {};
  const comp = (card && card.scoreComponents) || null;
  const tallyCount = bookings.reduce((s, b) => s + (b.redemptions ? b.redemptions.count || 0 : 0), 0);
  const tallyTotal = bookings.reduce((s, b) => s + (b.redemptions ? b.redemptions.basketTotal || 0 : 0), 0);
  const { delivered, streak } = homeStreak(bookings);
  return `
  <section class="panel">
    <p class="ui-kicker">Your local signal</p>
    <h3 class="home-h">The proof businesses see</h3>
    <div class="ui-row"><span class="k">Local audience</span><span class="v">${p.localAudiencePct === null || p.localAudiencePct === undefined ? "Not reported yet" : p.localAudiencePct + "%"}</span></div>
    <div class="ui-row"><span class="k">Local Impact Score</span><span class="v">${card && card.localImpactScore !== null && card.localImpactScore !== undefined ? card.localImpactScore + " / 100" : "Pending"}</span></div>
    ${comp ? `<div class="ui-row"><span class="k">Reliability in your score</span><span class="v">${esc(String(comp.reliability))}</span></div>
    <p class="small muted">${esc(comp.reliabilityBasis || "")}</p>` : ""}
    <div class="ui-row"><span class="k">On-time delivery</span><span class="v">${tr.onTimePct === null || tr.onTimePct === undefined ? "No posts yet" : tr.onTimePct + "%"}</span></div>
    <div class="ui-row"><span class="k">Track record</span><span class="v">${tr.visitsCompleted || 0} visits &middot; ${tr.postsDelivered || 0} posts</span></div>
    <div class="ui-row"><span class="k">Register actions</span><span class="v">${tallyCount ? `${tallyCount} customers &middot; $${fmtMoney(tallyTotal)} rung up` : "None reported yet"}</span></div>
    ${delivered ? `<div class="ui-row"><span class="k">On-time streak</span><span class="v">${streak} in a row</span></div>
    <p class="small muted">Every 5 on-time posts in a row earns a +25 Momentum streak bonus. The count above is counted from your delivered posts, newest first.</p>` : ""}
    <div class="home-actions"><button class="btn small-btn ghost" onclick="return go('dashboard','Profile')">View your full profile</button></div>
  </section>`;
}

// The paid lane, shown the same way in the founding home and the
// live Dashboard tab: comp on or off, the creator's own rate with the
// keep-97-percent math at that rate, and the honest hold line.
function homePaidLaneHtml(creator, footerHtml) {
  const c = creator || {};
  const compOpen = c.compOpen !== false;
  const rate = typeof c.paidRate === "number" && c.paidRate > 0 ? c.paidRate : null;
  const keep = rate ? Math.round(rate * 0.97 * 100) / 100 : null;
  const total = rate ? Math.round(rate * 1.03 * 100) / 100 : null;
  return `
  <section class="panel">
    <p class="ui-kicker">Paid lane</p>
    <h3 class="home-h">Comp and paid, your choice</h3>
    <p class="small"><strong>Comp visits:</strong> ${compOpen ? "on. Businesses can comp you experiences for honest posts, and every completed visit builds your track record." : "off. You are paid-only right now, and that is always fine."}</p>
    <p class="small"><strong>Your paid rate:</strong> ${rate ? `$${rate} for one paid Standard Visit. A business pays $${fmtMoney(total)} (your rate + 3%), and you keep $${fmtMoney(keep)}, which is 97% of your rate.` : "not set. Set one in your profile (minimum $50) and businesses can book you at your rate for a paid visit."}</p>
    <p class="small muted">Paid visits are recorded in the app, no card charged. SIGNL holds the payment until your post is live, and releases it 48 hours after your proof lands. Comp-only is always fine, forever.</p>
    ${footerHtml || ""}
  </section>`;
}

function homeMoneyHtml(money) {
  return `
  <section class="panel">
    <p class="ui-kicker">Money</p>
    <h3 class="home-h">Cash and comps, kept separate</h3>
    <div class="home-money">
      <div class="hm-pile"><div class="hm-num">$${fmtMoney(money.released)}</div><div class="hm-lbl">Paid cash released (paid visits delivered, hold passed)</div></div>
      <div class="hm-pile"><div class="hm-num">$${fmtMoney(money.held)}</div><div class="hm-lbl">Paid cash held by SIGNL: it releases 48 hours after your post proof lands</div></div>
      <div class="hm-pile"><div class="hm-num">$${fmtMoney(money.compValue)}</div><div class="hm-lbl">Comp value received (face value of comps you redeemed: experiences, not cash)</div></div>
    </div>
    ${money.refunded ? `<p class="small muted">$${fmtMoney(money.refunded)} went back to businesses from paid visits that resolved without delivery.</p>` : ""}
    <p class="small muted">These piles are the app's own ledger of your paid work: paid visits are recorded here, no card charged, and comp value is never counted as cash.</p>
  </section>`;
}

function homeComingUpHtml(bookings) {
  const items = [];
  for (const b of bookings) {
    if (b.honorReportedAt) continue;
    if (!b.redeemedAt && b.codeStatus === "issued" && b.status !== "expired") {
      items.push({ at: b.redeemBy, label: `Redeem your visit at ${b.businessName}`, detail: b.title });
    } else if (b.redeemedAt && !b.post) {
      items.push({ at: b.postDeadline, label: `Post due for ${b.businessName}`, detail: b.title });
    }
    if (b.post && b.post.performanceRequestedAt && !b.post.reportedAt) {
      items.push({ at: b.post.performanceRequestedAt, label: `Post numbers requested by ${b.businessName}`, detail: "Reporting them earns +5 Momentum" });
    }
    if (b.paidLane && b.paidLane.escrowState === "held" && b.paidLane.proofAt) {
      items.push({ at: new Date(Date.parse(b.paidLane.proofAt) + 48 * 3600 * 1000).toISOString(), label: `Paid money releases from ${b.businessName}`, detail: `$${fmtMoney(b.paidLane.creatorNet)} when the 48 hour hold passes` });
    }
  }
  items.sort((a, b) => (String(a.at || "") < String(b.at || "") ? -1 : 1));
  const rows = items.slice(0, 5).map((it) => `
    <div class="ui-row"><span class="k">${esc(it.label)}<br><span class="small muted">${esc(it.detail || "")}</span></span><span class="v">${esc(fmtDate(it.at))}</span></div>`).join("");
  return `
  <section class="panel">
    <p class="ui-kicker">Coming up</p>
    <h3 class="home-h">Your next deadlines</h3>
    ${rows || `<p class="small muted">Nothing scheduled. Accepted visits, post deadlines, and payout holds land here.</p>`}
    <div class="home-actions"><button class="btn small-btn ghost" onclick="return go('dashboard','My Visits')">Open My Visits</button></div>
  </section>`;
}

// The pre-launch slice of the home: the numbers a founding creator
// already has (Momentum, local audience, impact, total audience)
// plus the paid lane panel, above the Momentum detail.
function homeFoundingBlocksHtml(card, u) {
  const p = (card && card.profile) || {};
  const m = (u && u.momentum) || { points: 0 };
  return `
  <div class="stat-band home-metrics">
    <div class="stat-cell"><div class="stat-num"><em>${m.points}</em></div><div class="stat-lbl">Momentum points (they set your order in business search when your market opens)</div></div>
    <div class="stat-cell"><div class="stat-num">${p.localAudiencePct === null || p.localAudiencePct === undefined ? "Not set" : p.localAudiencePct + "%"}</div><div class="stat-lbl">Local audience (the number businesses look at first)</div></div>
    <div class="stat-cell"><div class="stat-num">${card && card.localImpactScore !== null && card.localImpactScore !== undefined ? card.localImpactScore : "New"}</div><div class="stat-lbl">Local Impact Score, out of 100</div></div>
    <div class="stat-cell"><div class="stat-num">${fmtNum(totalAudienceOf(card))}</div><div class="stat-lbl">Total audience across your platforms</div></div>
  </div>
  ${homePaidLaneHtml(u.creator, `<p class="small muted" style="margin-bottom:0">Change either setting in the Profile tab.</p>`)}`;
}

async function loadCreatorHome() {
  const el = document.getElementById("creator-home");
  if (!el) return;
  const u = state.user;
  try {
    const [bkData, offData, fData] = await Promise.all([
      api("GET", "/bookings"),
      api("GET", "/offers"),
      api("GET", "/me/founding"),
    ]);
    if (!document.getElementById("creator-home")) return; // navigated away mid-load
    const bookings = bkData.bookings || [];
    const offers = offData.offers || [];
    const card = fData.card || {};
    const tr = card.trackRecord || {};
    const money = homeMoney(bookings);
    const m = u.momentum || { points: 0 };
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const firstName = (u.name || "").trim().split(" ")[0] || u.name || "";
    el.innerHTML = `
    <p class="ui-kicker">Creator dashboard &middot; ${esc(u.market)}</p>
    <h3 class="home-title">${esc(greet)}, ${esc(firstName)}.</h3>
    <p class="ui-sub">Your active visit, your offers, and your money, in one place.</p>
    <div class="stat-band home-metrics">
      <div class="stat-cell"><div class="stat-num">$${fmtMoney(money.released)}</div><div class="stat-lbl">Paid cash released (paid visits delivered, hold passed)</div></div>
      <div class="stat-cell"><div class="stat-num">$${fmtMoney(money.compValue)}</div><div class="stat-lbl">Comp value received (experiences, not cash)</div></div>
      <div class="stat-cell"><div class="stat-num">${tr.onTimePct === null || tr.onTimePct === undefined ? "New" : tr.onTimePct + "%"}</div><div class="stat-lbl">On-time posts (${tr.postsDelivered || 0} delivered)</div></div>
      <div class="stat-cell"><div class="stat-num"><em>${m.points}</em></div><div class="stat-lbl">Momentum points (your order in business search)</div></div>
    </div>
    ${homeActiveVisitHtml(homeActiveBooking(bookings))}
    ${homeOpportunitiesHtml(offers, u)}
    ${homeLocalSignalHtml(card, bookings)}
    ${homePaidLaneHtml(u.creator, `<div class="home-actions"><button class="btn small-btn ghost" onclick="return go('dashboard','Profile')">Edit in your profile</button></div>`)}
    ${homeMoneyHtml(money)}
    ${momentumHtml(u)}
    ${homeComingUpHtml(bookings)}`;
    startHomeCountdown();
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function creatorProfileHtml(u) {
  const c = u.creator || {};
  const cats = state.boot.creatorCategories.map((x) => `<label><input type="checkbox" name="p-cat" value="${esc(x)}" ${c.categories && c.categories.includes(x) ? "checked" : ""}> ${esc(x)}</label>`).join("");
  const comps = state.boot.compCategories.map((x) => `<label><input type="checkbox" name="p-comp" value="${esc(x)}" ${c.compCategories && c.compCategories.includes(x) ? "checked" : ""}> ${esc(x)}</label>`).join("");
  const stackVal = (id) => (c.audienceStack && c.audienceStack[id]) || (id === "instagram" ? c.followerCount || 0 : 0);
  const stackRows = [
    ["instagram", "Instagram followers", "p-followers"],
    ["tiktok", "TikTok followers", "p-stack-tiktok"],
    ["facebook", "Facebook followers", "p-stack-facebook"],
    ["x", "X followers", "p-stack-x"],
    ["linkedin", "LinkedIn connections", "p-stack-linkedin"],
    ["youtube", "YouTube subscribers", "p-stack-youtube"],
  ];
  return `
  <div class="panel">
    <div class="flex-between">
      <div>
        <h3 style="margin:0">${esc(u.name)} <span class="muted">@${esc(c.handle || "")}</span></h3>
        <p class="muted small">${esc(u.market)} &middot; ${esc(u.city || "")}${c.neighborhood ? ` &middot; ${esc(c.neighborhood)}` : ""}</p>
      </div>
      <div id="my-score"><span class="badge info">Loading score...</span></div>
    </div>
    <p class="small muted">Your Local Impact Score is computed only from your stored profile and your real visit history on SIGNL. Your local audience figure shows as <strong>Self-reported</strong> until Instagram verification is available.</p>
    ${u.status === "approved" && c.handle ? `
    <div class="field"><label>Your public profile</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="text" readonly value="${esc(publicProfileUrl(u))}" onclick="this.select()" style="flex:1;min-width:220px">
        <button type="button" class="btn small-btn" onclick="return copyPublicProfile()">Copy link</button>
        <a class="btn small-btn ghost" href="${esc(publicProfileUrl(u))}" target="_blank" rel="noopener">View</a>
        <span id="pp-copied" class="saved"></span>
      </div>
      <p class="small muted">Share this link anywhere, including your Instagram bio. Visitors see your name, handle, market and neighborhood, tier, follower count, categories, local audience share, Local Impact Score, Momentum points, and founding standing. Your email and account details are never shown, and there is no public roster: this page exists only at your link.</p>
    </div>` : ""}
    <div id="form-error"></div>
    <form onsubmit="return doUpdateCreator(event)">
      <div class="field"><label>Profile photo</label>
        ${c.hasPhoto ? `<img class="profile-photo" src="/api/users/${esc(u.id)}/photo" alt="Your profile photo">` : `<div class="photo-placeholder">No photo yet.</div>`}
        <input type="file" id="p-photo" accept="image/png,image/jpeg,image/webp">
        <p class="small muted">Pick a new photo and save to replace it. PNG, JPEG, or WebP, under 2.5 MB.</p>
      </div>
      <div class="form-2col">
        <div class="field"><label>Instagram handle</label><input id="p-handle" value="${esc(c.handle || "")}"></div>
        ${u.market === unlistedLabel()
          ? `<div class="field"><label>Your city (not an open market yet)</label><input id="p-city-text" value="${esc(u.city || "")}"></div>
             <div class="field"><label>Your country</label><input id="p-country-text" value="${esc(u.country || "")}"></div>
             <div class="field"><label>Your state or province (optional)</label><input id="p-state-text" value="${esc(u.state || "")}"></div>`
          : `<div class="field"><label>Home city (${esc(u.market)})</label><select id="p-city">${cityOptions(u.market, u.city || "")}</select></div>`}
      </div>
      <div class="field"><label>Your neighborhood or area</label><input id="p-neighborhood" value="${esc(c.neighborhood || "")}" placeholder="Optional, for example: Oceanfront, Ghent, Town Center" maxlength="80"><p class="small muted">Businesses search by neighborhood. Keep it to the area you actually post from.</p></div>
      <div class="form-2col">
        <div class="field"><label>TikTok handle</label><input id="p-tiktok" value="${esc(c.tiktokHandle || "")}" placeholder="Optional"></div>
        <div class="field"><label>YouTube channel</label><input id="p-youtube" value="${esc(c.youtubeChannel || "")}" placeholder="Optional"></div>
      </div>
      <div class="form-2col">
        <div class="field"><label>Facebook profile or Page</label><input id="p-facebook" value="${esc(c.facebookUrl || "")}" placeholder="Optional"></div>
        <div class="field"><label>X (Twitter) handle or URL</label><input id="p-x" value="${esc(c.xHandle || "")}" placeholder="Optional"></div>
      </div>
      <div class="field"><label>LinkedIn profile URL</label><input id="p-linkedin" value="${esc(c.linkedinUrl || "")}" placeholder="Optional"></div>
      <div class="field"><label>Your tier band</label><p style="margin:6px 0"><strong id="p-tier-band">${esc(c.tierBand || "")}</strong></p><p class="small muted">Set automatically from your total audience across platforms. It updates itself when your counts below change; nobody picks their own band.</p></div>
      <div class="field"><label>Your audience, platform by platform</label>
        <div class="form-2col">
          ${stackRows.map(([id, label, inputId]) => `<div class="field"><label>${label}</label><input type="number" id="${inputId}" min="0" value="${stackVal(id)}" oninput="syncStackTotal()"></div>`).join("")}
        </div>
        <p class="small muted">Total audience: <strong id="p-stack-total">${fmtNum(totalAudienceOf(c))}</strong> across every platform. Businesses see the total and the breakdown. Skip any platform you do not use (leave it at 0). Completing 3 or more platforms earns Momentum points.</p>
      </div>
      <div class="field"><label>Max visits per week</label><input type="number" id="p-maxvisits" min="1" max="7" value="${c.maxVisitsPerWeek || 3}"><p class="small muted">Your pace, your call: 1 to 7 comped visits a week. At your max, offers still arrive but accepting waits until next week, and businesses see you as booked up this week.</p></div>
      <div class="form-2col">
        <div class="field"><label>Typical post views</label><input type="number" id="p-avgviews" min="0" value="${c.avgViews || 0}"></div>
        <div class="field"><label>Local audience share (%)</label><input type="number" id="p-localpct" min="0" max="100" value="${c.localAudiencePct === null || c.localAudiencePct === undefined ? "" : c.localAudiencePct}"></div>
      </div>
      <div class="field"><label>Top audience cities</label><input id="p-topcities" value="${esc((c.topAudienceCities || []).join(", "))}" placeholder="Up to 5, comma separated"></div>
      <div class="field"><label>What you create in</label><div class="checkrow">${cats}</div></div>
      <div class="field"><label>Comps you would accept</label><div class="checkrow">${comps}</div></div>
      <div class="field" id="p-paid-wrap" style="display:${c.tierBand === "Headliners" ? "" : "none"}">
        <label style="font-weight:500"><input type="checkbox" id="p-paid" style="width:auto" ${c.openToPaidCampaigns ? "checked" : ""}> <strong>Paid cash campaigns</strong> (Headliners tier): businesses can hire me for paid campaigns when a business runs one, on top of comps.</label>
      </div>
      <div class="showcase-block">
        <h4>How businesses can book you</h4>
        <div class="field">
          <label style="font-weight:500"><input type="checkbox" id="p-comp-open" style="width:auto" ${c.compOpen === false ? "" : "checked"}> Accept comp visits. Businesses comp you the experience and you post honestly within 48 hours. Creators who accept comps get more offers and more free experiences, and every completed visit earns Momentum points. Momentum lifts you in business search and builds the track record that gets you trusted and booked, including first access to paid bookings.</label>
        </div>
        <div class="field"><label>Set a paid rate (optional). Businesses can book you at your listed rate for a paid visit, and you keep 97% of it. Paid-only is fine too, but paid-only creators receive fewer offers.</label>
          <input type="number" id="p-paid-rate" min="50" step="1" placeholder="For example: 250" value="${c.paidRate ? esc(String(c.paidRate)) : ""}">
          <p class="small muted">Your rate in dollars for one paid Standard Visit. The business pays your rate plus 3%, SIGNL holds the payment, and it releases to you when your post is live. Minimum $50. Leave blank for no paid bookings.</p>
        </div>
      </div>
      <div class="field"><label>Best work (up to 3 links)</label>
        ${[0, 1, 2].map((i) => `<input id="p-work-${i}" type="url" placeholder="https://www.instagram.com/reel/... or a TikTok or YouTube link" value="${esc((c.bestWork || [])[i] || "")}" style="margin-bottom:8px">`).join("")}
        <p class="small muted">Your strongest posts, shown on your public profile and to businesses in search results as Watch cards. Instagram, TikTok, or YouTube links only. Clear a box to remove that link.</p>
      </div>
      <div class="field"><label>Bio</label><textarea id="p-bio" rows="2">${esc(c.bio || "")}</textarea></div>
      <button class="btn" type="submit">Save profile</button> <span id="save-ok" class="saved"></span>
    </form>
    <div id="my-showcase"></div>
  </div>`;
}

function fillMyShowcase(card) {
  const sc = document.getElementById("my-showcase");
  if (sc && card) {
    sc.innerHTML = `<div class="showcase-block"><h4>How businesses see your profile</h4><p class="small muted">Your best work, SIGNL track record, and business reviews, exactly as they appear on your public profile and in business search. The track record and reviews come only from real completed visits on SIGNL.</p>${creatorShowcaseHtml(card)}</div>`;
  }
}

async function loadMyScore() {
  try {
    // The founding endpoint returns the creator's own card with the
    // computed score; it works before and after their market activates.
    const data = await api("GET", "/me/founding");
    const mine = data.card;
    const el = document.getElementById("my-score");
    if (el && mine) el.innerHTML = scoreBadge(mine.localImpactScore) + (mine.scoreComponents ? `<div class="small muted mt">Local ${mine.scoreComponents.localAudiencePct}% (${esc(mine.scoreComponents.localAudienceSource)}) &middot; Reliability ${mine.scoreComponents.reliability} &middot; ${esc(mine.scoreComponents.reliabilityBasis)}</div>` : "");
    fillMyShowcase(mine);
  } catch (e) { /* non-fatal */ }
}

function syncStackTotal() {
  const total = profileStackTotal();
  const el = document.getElementById("p-stack-total");
  if (el) el.textContent = fmtNum(total);
  const band = document.getElementById("p-tier-band");
  if (band) band.textContent = suggestedTierId(total);
  syncPaidOptionProfile();
}

async function doUpdateCreator(e) {
  e.preventDefault();
  const cats = Array.from(document.querySelectorAll("input[name=p-cat]:checked")).map((x) => x.value);
  const comps = Array.from(document.querySelectorAll("input[name=p-comp]:checked")).map((x) => x.value);
  const paidBox = document.getElementById("p-paid");
  if (suggestedTierId(profileStackTotal()) === "Headliners" && paidBox && paidBox.checked && !comps.includes(PAID_COMP)) comps.push(PAID_COMP);
  const pctRaw = document.getElementById("p-localpct").value;
  try {
    const uploaded = await uploadPhotoInput("p-photo");
    const cityEl = document.getElementById("p-city");
    const cityTextEl = document.getElementById("p-city-text");
    const data = await api("PATCH", "/me/profile", {
      handle: document.getElementById("p-handle").value,
      city: cityEl ? cityEl.value : cityTextEl ? cityTextEl.value : undefined,
      neighborhood: document.getElementById("p-neighborhood").value,
      state: document.getElementById("p-state-text") ? document.getElementById("p-state-text").value : undefined,
      country: document.getElementById("p-country-text") ? document.getElementById("p-country-text").value : undefined,
      tiktokHandle: document.getElementById("p-tiktok").value,
      youtubeChannel: document.getElementById("p-youtube").value,
      facebookUrl: document.getElementById("p-facebook").value,
      xHandle: document.getElementById("p-x").value,
      linkedinUrl: document.getElementById("p-linkedin").value,
      maxVisitsPerWeek: parseInt(document.getElementById("p-maxvisits").value, 10) || 3,
      compOpen: document.getElementById("p-comp-open").checked,
      paidRate: (() => { const v = document.getElementById("p-paid-rate").value.trim(); return v === "" ? null : Number(v); })(),
      followerCount: parseInt(document.getElementById("p-followers").value, 10) || 0,
      audienceStack: (() => {
        const s = { instagram: parseInt(document.getElementById("p-followers").value, 10) || 0 };
        for (const [id, platform] of [["p-stack-tiktok", "tiktok"], ["p-stack-facebook", "facebook"], ["p-stack-x", "x"], ["p-stack-linkedin", "linkedin"], ["p-stack-youtube", "youtube"]]) {
          const v = parseInt(document.getElementById(id).value, 10) || 0;
          if (v > 0) s[platform] = v;
        }
        return s;
      })(),
      avgViews: parseInt(document.getElementById("p-avgviews").value, 10) || 0,
      localAudiencePct: pctRaw === "" ? null : Number(pctRaw),
      topAudienceCities: document.getElementById("p-topcities").value.split(",").map((x) => x.trim()).filter(Boolean),
      categories: cats,
      compCategories: comps,
      bestWork: [0, 1, 2].map((i) => { const el = document.getElementById("p-work-" + i); return el ? el.value : ""; }),
      bio: document.getElementById("p-bio").value,
    });
    state.user = data.user;
    if (uploaded && state.user.creator) state.user.creator.hasPhoto = true;
    document.getElementById("save-ok").textContent = "Saved.";
    loadMyScore();
  } catch (err) {
    document.getElementById("form-error").innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
  return false;
}

async function loadCreatorOffers() {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/offers");
    if (!data.offers.length) {
      el.innerHTML = `<div class="panel center"><h3>No offers yet</h3><p class="muted">When businesses in ${esc(state.user.market)} send offers, they land here. Keep your local audience percentage current: it is what businesses look at first.</p></div>`;
      return;
    }
    el.innerHTML = data.offers.map((o) => { const rights = o.visitRights || rightsForPlan(o.businessPlan); return `
      <div class="card mb">
        <div class="flex-between"><strong>${esc(o.title)}</strong><span class="badge tier">${esc(o.businessName)}</span></div>
        <div class="showcase-block">
          <h4>The deal, in plain words</h4>
          <p class="small"><strong>You get:</strong> ${esc(o.whatComped)} (comp cap $${o.dollarCap}) &middot; ${o.bookedCount}/${o.spots} spots booked &middot; ${o.creatorId ? "Sent directly to you" : "Open to your market"}</p>
          <p class="small"><strong>You post:</strong> 1 post or reel + 2 stories within 48 hours of your visit, honest, with the comp disclosed. The post stays live at least 30 days. You check off by pasting the post link in My Visits.</p>
          <p class="small"><strong>They can:</strong> ${rights.can.map(esc).join("; ")}</p>
          <p class="small"><strong>They can't:</strong> ${rights.cannot.map(esc).join("; ")}</p>
        </div>
        ${reviewLinksBlockHtml(o.businessReviewLinks)}
        <p class="small muted">Redemption window: ${o.windowMode === "thisweek" ? "this week, ends Sunday" : "any time within 7 days of accepting"}. No appointment: you show up inside the window with your code.${o.visitWindow ? ` Note from the business: ${esc(o.visitWindow)}` : ""}</p>
        <form onsubmit="return acceptOffer(event, '${o.id}')">
          <button class="btn small-btn" type="submit">Accept and get my code</button>
        </form>
        ${o.creatorId ? `<button class="btn small-btn danger" onclick="declineOffer('${o.id}')">Decline</button>` : ""}
        <button class="btn small-btn ghost" onclick="openThread('${o.businessId}')">Message business</button>
      </div>`; }).join("");
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function acceptOffer(e, offerId) {
  e.preventDefault();
  try {
    const data = await api("POST", `/offers/${offerId}/accept`, {});
    state.tab = "My Visits";
    render();
    const useBy = data.booking && data.booking.redeemBy ? ` Use it any time by ${fmtDate(data.booking.redeemBy)}; no appointment needed.` : "";
    setTimeout(() => alert(`Booked. Your one-time code is ${data.booking.code}.${useBy} Show it at the visit; staff redeem it in the app and your 48 hour post clock starts.`), 50);
  } catch (err) {
    alert(err.message);
  }
  return false;
}

async function declineOffer(offerId) {
  if (!confirm("Decline this offer?")) return;
  try {
    await api("POST", `/offers/${offerId}/decline`, {});
    loadCreatorOffers();
  } catch (err) { alert(err.message); }
}

async function loadMyVisits(role) {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/bookings");
    if (!data.bookings.length) {
      el.innerHTML = `<div class="panel center"><h3>No visits yet</h3><p class="muted">${role === "creator" ? "Accept an offer and your visit, code, and post deadline will live here." : "Bookings from your offers will live here."}</p></div>`;
      return;
    }
    el.innerHTML = data.bookings.map((b) => visitCard(b, role)).join("");
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function postStateBadge(stateName, b) {
  switch (stateName) {
    case "submitted_on_time": return `<span class="badge ok">Post submitted on time</span>`;
    case "submitted_late": return `<span class="badge warn">Post submitted late</span>`;
    case "overdue": return `<span class="badge bad">Post overdue</span>`;
    case "awaiting_post": {
      const h = hoursLeft(b.postDeadline);
      return `<span class="badge warn">Post due in <span class="countdown">${h !== null ? h.toFixed(1) : ""}h</span></span>`;
    }
    default: return `<span class="badge info">Booked, not yet redeemed</span>`;
  }
}

// Compliance status line, shared by both roles: the same stored
// facts the sweep acts on (Redeemed / Post due / Posted / Late /
// Missed), rendered from the server's compliance object.
function complianceBadge(b) {
  const c = b.compliance;
  if (!c) return postStateBadge(b.postState, b);
  const when = (iso) => (iso ? fmtDate(iso) : "");
  switch (c.status) {
    case "posted_on_time": return `<span class="badge ok">Posted on time</span>`;
    case "posted_late": return `<span class="badge warn">Posted late (delivered)</span>`;
    case "post_due": return `<span class="badge warn">Post due by ${esc(when(c.deadline))}</span>`;
    case "overdue": return `<span class="badge bad">Post overdue: hard stop ${esc(when(c.pauseAt))}</span>`;
    case "paused": return `<span class="badge bad">Creator paused: past the one-week hard stop</span>`;
    case "missed": return `<span class="badge bad">Missed: no post delivered</span>`;
    case "expired": return `<span class="badge bad">Window expired unused</span>`;
    case "honor_reported": return `<span class="badge warn">Reported: business didn't honor (clock voided)</span>`;
    default: return postStateBadge(b.postState, b);
  }
}

async function submitHonorReport(e, bookingId) {
  e.preventDefault();
  const reason = document.getElementById("honor-" + bookingId).value.trim();
  if (!reason) { alert("Add a short reason: what happened at the business?"); return false; }
  try {
    await api("POST", `/bookings/${bookingId}/honor-report`, { reason });
    loadMyVisits("creator");
  } catch (err) { alert(err.message); }
  return false;
}

function visitCard(b, role) {
  const post = b.post;
  let html = `
  <div class="card visit-card mb">
    <div class="flex-between"><strong>${esc(b.title)}</strong>${complianceBadge(b)}</div>
    <p class="small muted">${role === "creator" ? esc(b.businessName) : "@" + esc(b.creatorHandle) + " (" + esc(b.creatorName) + ")"} &middot; ${esc(b.market)} &middot; Comp: ${esc(b.whatComped)} (cap $${b.dollarCap}) &middot; Visit: ${esc(b.visitDate || b.visitWindow || "Flexible")}</p>`;
  if (b.paidLane) {
    const lane = b.paidLane;
    const escrowBadge = lane.escrowState === "released"
      ? `<span class="badge ok">Payment released</span>`
      : lane.escrowState === "refunded"
        ? `<span class="badge warn">Payment refunded</span>`
        : `<span class="badge info">Payment held by SIGNL</span>`;
    html += role === "creator"
      ? `<p class="small"><span class="badge tier">Paid visit</span> Your rate $${lane.rate}: you receive $${lane.creatorNet} (97% of your rate). ${escrowBadge}<br><span class="muted">${esc(lane.paymentNote)}${lane.escrowState === "held" && lane.proofAt ? " Your post is in; the escrow releases 48 hours after proof." : ""}${lane.escrowState === "refunded" ? " This visit resolved without delivery, so the business was refunded." : ""}</span></p>`
      : `<p class="small"><span class="badge tier">Paid visit</span> Creator rate $${lane.rate} &middot; you pay $${lane.businessTotal} (rate + 3%) &middot; the creator receives $${lane.creatorNet}. ${escrowBadge}<br><span class="muted">${esc(lane.paymentNote)}</span></p>`;
  }
  if (b.creatorCode) {
    // The discount is the business's opt-in, stamped on the
    // booking: their percentage when they turned code discounts
    // on, 0 when they did not. At 0 the code is a counting code
    // only and the copy must never promise a percentage off.
    const pct = typeof b.discountPct === "number" ? b.discountPct : 0;
    if (role === "creator") {
      html += pct > 0
        ? `
    <div class="showcase-block">
      <h4>Your audience code at ${esc(b.businessName)}: ${esc(b.creatorCode)}</h4>
      <p class="small" style="margin:0">Share it in your post: your audience gets ${pct}% off when they use it at ${esc(b.businessName)}, and every use is tracked back to this visit. It is how the business sees the customers your post actually sent through the door, and it feeds your SIGNL track record.</p>
    </div>`
        : `
    <div class="showcase-block">
      <h4>Your audience code at ${esc(b.businessName)}: ${esc(b.creatorCode)}</h4>
      <p class="small" style="margin:0">Share it in your post so the business can count the customers it sends through the door: every use is tracked back to this visit, and it feeds your SIGNL track record. This business has not turned on a code discount, so there is no percentage off to promise; the code is how your visit gets counted.</p>
    </div>`;
    } else {
      html += pct > 0
        ? `<p class="small">Audience code for this visit: <strong>${esc(b.creatorCode)}</strong> (${pct}% off for customers who use it, your chosen code discount). It is rung up at your own register; report the tally on this card after the visit and it feeds the visit's SIGNL ROAS Score.</p>`
        : `<p class="small">Audience code for this visit: <strong>${esc(b.creatorCode)}</strong>. You have not turned on a code discount, so it is a counting code only: no percentage off for customers who use it. It is rung up at your own register; report the tally on this card after the visit and it feeds the visit's SIGNL ROAS Score.</p>`;
    }
  }
  if (role === "creator" && b.codeStatus === "issued") {
    html += `
    <div class="grid cols-2">
      <div>
        <p class="small muted" style="margin-bottom:0">Your one-time visit code. Show this at the visit; staff redeem it in the app and your 48 hour clock starts at that moment.</p>
        <div class="code-display">${esc(b.code)}</div>
        ${b.redeemBy ? `<p class="small"><strong>Use by ${esc(fmtDate(b.redeemBy))}</strong>. Come any time inside your window; no appointment needed. If the window passes unused, the offer expires and counts as a no-show.</p>` : ""}
        ${b.checkinAt ? `<p class="small">You checked in at ${fmtDate(b.checkinAt)}. Waiting for the business to confirm.</p>` : `<button class="btn small-btn ghost" onclick="checkIn('${b.id}')">I am here (check in)</button>`}
      </div>
      <div class="qr-box"><img src="/api/bookings/${b.id}/qr" alt="QR code for ${esc(b.code)}" onerror="this.parentElement.style.display='none'"></div>
    </div>`;
  }
  if (role === "creator" && b.status === "expired") {
    html += `<p class="small">This offer's window passed without a redemption, so it expired. It counts as a no-show on your Momentum. If something went wrong, tell us at hello@joinsignl.com.</p>`;
  }
  if (b.honorReportedAt) {
    html += role === "creator"
      ? `<p class="small">You reported that this business did not honor the comp (${esc(fmtDate(b.honorReportedAt))}). The visit is void: no post is owed, the clock is stopped, and it cannot hurt your standing. The SIGNL team has the report.</p>`
      : `<p class="small">The creator reported that this comp was not honored. The visit is void and under SIGNL review.</p>`;
  } else if (role === "creator" && !post && b.status !== "expired") {
    html += `
    <form onsubmit="return submitHonorReport(event, '${b.id}')">
      <div class="field"><label>Business didn't honor this comp?</label><input id="honor-${b.id}" maxlength="280" placeholder="What happened, in one line"></div>
      <button class="btn small-btn danger" type="submit">Report: the business didn't honor this</button>
      <p class="small muted">Filing this voids the visit: no post is owed, the compliance clock stops, and it cannot hurt your standing. It flags the business for the SIGNL team. It is never shown publicly.</p>
    </form>`;
  }
  if (role === "business" && b.codeStatus === "issued") {
    html += `<p class="small">Booking code <strong>${esc(b.code)}</strong>. Redeem it at the Counter tab when the creator is with you${b.checkinAt ? ", or confirm the visit below (creator checked in " + fmtDate(b.checkinAt) + ")" : ", or confirm the visit below if the code cannot be scanned"}.</p>
    <button class="btn small-btn" onclick="confirmVisit('${b.id}')">Confirm visit and start the 48h clock</button>`;
  }
  if (b.redeemedAt) {
    html += `<p class="small muted">Redeemed ${fmtDate(b.redeemedAt)} (${b.redeemMethod === "business_confirm" ? "business confirmed" : "code at counter"}). Post deadline: <strong>${fmtDate(b.postDeadline)}</strong>.</p>`;
  }
  if (role === "creator" && b.redeemedAt && !post) {
    const late = b.compliance && (b.compliance.status === "overdue" || b.compliance.status === "paused" || b.compliance.status === "missed");
    html += `
    <form onsubmit="return submitPost(event, '${b.id}')">
      <h4 style="margin:10px 0 4px">Post your proof</h4>
      ${late ? `<p class="small"><strong>This post is past its 48 hour deadline.</strong> Post within 48 hours for full credit. One week is the hard stop: inside the week it still counts as delivered late, and even after the pause a post inside the second week unpauses you, though the missed deadline stays on your record. No link, no check-off.</p>` : `<p class="small muted">Your check-off is the post link itself. Paste it here and the visit is marked delivered${b.compliance && b.compliance.deadline ? ` (deadline ${esc(fmtDate(b.compliance.deadline))})` : ""}. Post within 48 hours for full credit; one week is the hard stop.</p>`}
      <div class="field"><label>Link to your Instagram post or reel</label><input id="post-url-${b.id}" type="url" placeholder="https://www.instagram.com/p/..." required></div>
      <label style="font-weight:500"><input type="checkbox" id="post-disc-${b.id}" style="width:auto"> My post clearly discloses the comp (for example #ad or "comped by the business"), as the FTC requires.</label>
      <p class="small muted">Post your honest experience. Nobody can require a positive post.</p>
      <button class="btn small-btn" type="submit">Submit post</button>
    </form>`;
  }
  if (role === "business" && b.compliance && b.compliance.status === "missed") {
    html += `<p class="small">This visit's comp was redeemed and no post was ever delivered. The creator's account has been closed to future offers. ${b.replacementRequestedAt ? "" : "You can request a replacement visit below."}</p>`;
  }
  if (post) {
    html += `<p class="small">Post: <a href="${esc(post.url)}" target="_blank" rel="noopener">${esc(post.url)}</a> &middot; submitted ${fmtDate(post.submittedAt)} (${post.hoursAfterRedeem}h after redemption) ${post.verifiedAt ? "&middot; <span class='saved'>Verified by the business</span>" : ""}</p>`;
    if (post.adUseDeclaredAt) {
      html += `<p class="small"><span class="badge ok">Running as an ad</span> Declared ${fmtDate(post.adUseDeclaredAt)}. The creator was notified and earned +25 Momentum.${role === "business" ? " This right lasts while your account is active." : ""}</p>`;
    } else if (role === "business") {
      const myPlan = state.user && state.user.business ? state.user.business.plan : null;
      if (myPlan === "growth" || myPlan === "managed") {
        html += `<button class="btn small-btn ghost" onclick="declareAdUse('${post.id}')">Use in an ad</button> <span class="small muted">Included in your plan while your account is active. The creator is notified and earns +25 Momentum.</span>`;
      } else {
        html += `<p class="small muted">Ad use is a Growth and Managed feature. Your plan covers sharing this post natively, with the creator tagged.</p>`;
      }
    }
    if (role === "business" && !post.verifiedAt) html += `<button class="btn small-btn ghost" onclick="verifyPost('${post.id}')">Verify post is live</button>`;
    if (post.reportedAt) {
      const nums = [["views", post.views], ["likes", post.likes], ["comments", post.comments], ["shares", post.shares]]
        .filter(([, v]) => typeof v === "number")
        .map(([k, v]) => `${fmtNum(v)} ${k}`)
        .join(" &middot; ");
      html += role === "business"
        ? `<p class="small">Your comp produced <strong>${nums}</strong> (creator-reported).</p>`
        : `<p class="small">You reported ${nums} (+5 Momentum). Thanks: numbers like these are what bring businesses back.</p>`;
    } else if (role === "creator" && post.performanceRequestedAt) {
      html += `
    <form onsubmit="return submitPostPerformance(event, '${b.id}')">
      <h4 style="margin:10px 0 4px">Add post numbers</h4>
      <p class="small muted">A week in, how did the post do? Optional numbers; reporting earns +5 Momentum points, and they price the media side of the business's SIGNL ROAS Score.</p>
      <div class="form-2col">
        <div class="field"><label>Views</label><input type="number" id="perf-views-${b.id}" min="0" placeholder="Optional"></div>
        <div class="field"><label>Likes</label><input type="number" id="perf-likes-${b.id}" min="0" placeholder="Optional"></div>
        <div class="field"><label>Comments</label><input type="number" id="perf-comments-${b.id}" min="0" placeholder="Optional"></div>
        <div class="field"><label>Shares</label><input type="number" id="perf-shares-${b.id}" min="0" placeholder="Optional"></div>
      </div>
      <button class="btn small-btn" type="submit">Report numbers (+5 Momentum)</button>
    </form>`;
    }
  }
  if (post && b.roas && (b.redemptions || post.reportedAt)) {
    const r = b.roas;
    const scoreLine = `<strong>SIGNL ROAS Score: ${r.score === null ? "n/a yet" : r.score.toFixed(2) + "&times;"}</strong> <span class="muted">(our own model)</span> &middot; $${fmtMoney(r.registerValue)} tracked through the code + $${fmtMoney(r.mediaValue)} modeled media value, against $${fmtMoney(r.compCost)} comp at cost + $${fmtMoney(r.discountCost)} code discounts${r.allInScore !== null && r.allInScore !== undefined ? ` &middot; all-in ${r.allInScore.toFixed(2)}&times; with the plan counted` : ""}`;
    html += role === "business"
      ? `<p class="small">${scoreLine}.</p>`
      : `<p class="small">${b.redemptions ? `Your code brought <strong>${b.redemptions.count} customer${b.redemptions.count === 1 ? "" : "s"}, $${fmtMoney(b.redemptions.basketTotal)} rung up</strong> at ${esc(b.businessName)}. ` : ""}${scoreLine}.</p>`;
  }
  if (role === "business" && post) {
    html += `
    <form onsubmit="return submitCodeRedemptions(event, '${b.id}')">
      <h4 style="margin:10px 0 4px">Code redemptions at your register</h4>
      <p class="small muted">Customers who used ${b.creatorCode ? `<strong>${esc(b.creatorCode)}</strong>` : "the creator's audience code"} at your register. Report the running tally (it replaces the last one) and, if you know it, what the comp actually cost you; both feed this visit's SIGNL ROAS Score, our own model.</p>
      <div class="form-2col">
        <div class="field"><label>Customers who used the code</label><input type="number" id="redeem-count-${b.id}" min="0" placeholder="0" value="${b.redemptions ? b.redemptions.count : ""}"></div>
        <div class="field"><label>Total rung up with the code ($)</label><input type="number" id="redeem-basket-${b.id}" min="0" step="0.01" placeholder="0.00" value="${b.redemptions ? b.redemptions.basketTotal : ""}"></div>
        <div class="field"><label>What the comp cost you ($) (optional)</label><input type="number" id="redeem-cost-${b.id}" min="0" step="0.01" placeholder="At your cost" value="${typeof b.compCostActual === "number" ? b.compCostActual : ""}"></div>
      </div>
      <button class="btn small-btn" type="submit">Report tally</button>
      ${b.redemptions ? `<span class="small muted">Last reported ${fmtDate(b.redemptions.reportedAt)}.</span>` : ""}
    </form>`;
  }
  if (role === "business" && b.postState === "overdue" && !b.replacementRequestedAt) {
    html += `<button class="btn small-btn danger" onclick="requestReplacement('${b.id}')">Request replacement visit</button>`;
  }
  if (b.replacementRequestedAt) html += `<p class="small">Replacement requested ${fmtDate(b.replacementRequestedAt)}. SIGNL will line up a substitute creator.</p>`;
  if (role === "creator" && b.status === "completed") {
    if (b.businessReview) {
      html += `<div class="review-item"><span class="small muted">Your review of ${esc(b.businessName)}</span><br>${starsHtml(b.businessReview.stars)} <span class="small">${esc(b.businessReview.text || "")}</span> <span class="saved">+10 Momentum earned</span></div>`;
    } else {
      html += `
    <form onsubmit="return submitBusinessReview(event, '${b.id}')">
      <h4 style="margin:10px 0 4px">Review this business</h4>
      <p class="small muted">Optional, and honest is the whole point: leaving a review earns +10 Momentum at any star rating. SIGNL never pays for positive reviews, and nobody can ask you for one.</p>
      <div class="form-2col">
        <div class="field"><label>Your rating</label><select id="bizrev-stars-${b.id}"><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option></select></div>
        <div class="field"><label>Your words (optional)</label><input id="bizrev-text-${b.id}" maxlength="500" placeholder="How was the visit, honestly?"></div>
      </div>
      <button class="btn small-btn" type="submit">Leave review (+10 Momentum)</button>
    </form>`;
    }
    html += reviewLinksBlockHtml(b.businessReviewLinks);
  }
  const otherId = role === "creator" ? b.businessId : b.creatorId;
  html += `<div class="mt"><button class="btn small-btn ghost" onclick="openThread('${otherId}')">Message</button></div></div>`;
  return html;
}

async function checkIn(bookingId) {
  try { await api("POST", `/bookings/${bookingId}/checkin`, {}); loadMyVisits("creator"); }
  catch (err) { alert(err.message); }
}

async function confirmVisit(bookingId) {
  if (!confirm("Confirm this visit happened? This starts the creator's 48 hour post clock.")) return;
  try { await api("POST", `/bookings/${bookingId}/confirm`, {}); loadMyVisits("business"); }
  catch (err) { alert(err.message); }
}

async function requestReplacement(bookingId) {
  if (!confirm("Request a replacement visit for this overdue post?")) return;
  try { await api("POST", `/bookings/${bookingId}/replacement`, {}); loadMyVisits("business"); }
  catch (err) { alert(err.message); }
}

async function submitPost(e, bookingId) {
  e.preventDefault();
  const disc = document.getElementById("post-disc-" + bookingId);
  if (!disc.checked) { alert("Confirm the disclosure first. Every SIGNL post must disclose the comp."); return false; }
  try {
    await api("POST", "/posts", { bookingId, url: document.getElementById("post-url-" + bookingId).value, includesDisclosure: true });
    loadMyVisits("creator");
  } catch (err) { alert(err.message); }
  return false;
}

async function verifyPost(postId) {
  try { await api("POST", `/posts/${postId}/verify`, {}); loadMyVisits("business"); }
  catch (err) { alert(err.message); }
}

async function submitPostPerformance(e, bookingId) {
  e.preventDefault();
  try {
    const views = document.getElementById("perf-views-" + bookingId).value;
    const likes = document.getElementById("perf-likes-" + bookingId).value;
    const commentsEl = document.getElementById("perf-comments-" + bookingId);
    const sharesEl = document.getElementById("perf-shares-" + bookingId);
    await api("POST", `/bookings/${bookingId}/performance`, {
      views: views === "" ? null : parseInt(views, 10),
      likes: likes === "" ? null : parseInt(likes, 10),
      comments: !commentsEl || commentsEl.value === "" ? null : parseInt(commentsEl.value, 10),
      shares: !sharesEl || sharesEl.value === "" ? null : parseInt(sharesEl.value, 10),
    });
    loadMyVisits("creator");
  } catch (err) { alert(err.message); }
  return false;
}

async function submitCodeRedemptions(e, bookingId) {
  e.preventDefault();
  try {
    const count = document.getElementById("redeem-count-" + bookingId).value;
    const basket = document.getElementById("redeem-basket-" + bookingId).value;
    const cost = document.getElementById("redeem-cost-" + bookingId).value;
    await api("POST", `/bookings/${bookingId}/code-redemptions`, {
      count: count === "" ? 0 : parseInt(count, 10),
      basketTotal: basket === "" ? 0 : parseFloat(basket),
      compCostActual: cost === "" ? null : parseFloat(cost),
    });
    loadMyVisits("business");
  } catch (err) { alert(err.message); }
  return false;
}

async function declareAdUse(postId) {
  if (!confirm("Use this post in an ad? Your plan covers ad use while your account is active. The creator is notified and earns +25 Momentum.")) return;
  try { await api("POST", `/posts/${postId}/ad-use`, {}); loadMyVisits("business"); }
  catch (err) { alert(err.message); }
}

// ---------- business ----------

function renderBusinessDash() {
  const u = state.user;
  const tab = state.tab || "Discover";
  state.tab = tab;
  app.innerHTML = `
    <h2>${esc(u.business.businessName)}</h2>
    <p class="muted small" style="margin-top:-8px">${esc(u.market)} &middot; ${esc(u.business.planName)} &middot; ${esc(u.business.billingStatus)}</p>
    ${tabsHtml(["Discover", "My Offers", "Counter", "Visits & Posts", "Plan", "Messages"], tab)}
    <div id="tab-body"></div>`;
  if (tab === "Discover") loadDiscover();
  if (tab === "My Offers") loadMyOffers();
  if (tab === "Counter") renderCounter();
  if (tab === "Visits & Posts") loadMyVisits("business");
  if (tab === "Plan") renderPlanTab();
  if (tab === "Messages") loadThreads();
}

async function loadDiscover() {
  const el = document.getElementById("tab-body");
  const u = state.user;
  el.innerHTML = `
    <div class="filters">
      <div><label>Market</label><select id="f-market">${marketOptions(u.market)}</select></div>
      <div><label>Neighborhood / area</label><input id="f-neighborhood" placeholder="For example: Oceanfront, Ghent"></div>
      <div><label>Tier</label><select id="f-tier"><option value="">All tiers</option>${state.boot.tiers.map((t) => `<option>${esc(t.id)}</option>`).join("")}</select></div>
      <div><label>Category</label><select id="f-category"><option value="">All categories</option>${state.boot.creatorCategories.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
      <div><label>Search</label><input id="f-q" placeholder="Name or handle"></div>
    </div>
    <div class="filters">
      <div><label>Would accept (comp fit)</label><select id="f-comp"><option value="">Any comp</option>${state.boot.compCategories.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
      <div><label>Total audience min</label><input type="number" id="f-fmin" min="0" placeholder="Any"></div>
      <div><label>Total audience max</label><input type="number" id="f-fmax" min="0" placeholder="Any"></div>
      <div><label>Min % followers in market</label><input type="number" id="f-minlocal" min="0" max="100" placeholder="Any"></div>
      <div><label>Sort by</label><select id="f-sort"><option value="">Founding order</option><option value="score">Local Impact Score</option><option value="momentum">Momentum (roster standing)</option></select></div>
      <div><label>&nbsp;</label><label style="font-weight:500"><input type="checkbox" id="f-paid" style="width:auto"> Has a paid rate (paid bookings) only</label></div>
      <div><label>&nbsp;</label><button class="btn small-btn" style="width:100%" onclick="runDiscover()">Search</button></div>
    </div>
    <div id="discover-results"><p class="muted">Loading creators in ${esc(u.market)}...</p></div>`;
  runDiscover();
}

async function runDiscover() {
  const el = document.getElementById("discover-results");
  const params = new URLSearchParams();
  const market = document.getElementById("f-market").value;
  const tier = document.getElementById("f-tier").value;
  const category = document.getElementById("f-category").value;
  const q = document.getElementById("f-q").value;
  if (market) params.set("market", market);
  if (tier) params.set("tier", tier);
  if (category) params.set("category", category);
  if (q) params.set("q", q);
  const neighborhood = document.getElementById("f-neighborhood").value.trim();
  const comp = document.getElementById("f-comp").value;
  const fmin = document.getElementById("f-fmin").value;
  const fmax = document.getElementById("f-fmax").value;
  const minlocal = document.getElementById("f-minlocal").value;
  const sort = document.getElementById("f-sort").value;
  if (neighborhood) params.set("neighborhood", neighborhood);
  if (comp) params.set("compCategory", comp);
  if (fmin) params.set("followersMin", fmin);
  if (fmax) params.set("followersMax", fmax);
  if (minlocal) params.set("minLocalPct", minlocal);
  if (sort) params.set("sort", sort);
  if (document.getElementById("f-paid").checked) params.set("paid", "1");
  try {
    const data = await api("GET", "/discover?" + params.toString());
    state.discover = data.creators;
    if (!data.creators.length) {
      el.innerHTML = `<div class="panel center"><h3>No approved creators match yet</h3><p class="muted">SIGNL is building the founding roster in this market now. Creators who sign up and get approved will appear here automatically.</p></div>`;
      return;
    }
    el.innerHTML = `<div class="creator-grid">${data.creators.map((c) => creatorCard(c, state.user)).join("")}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function toggleFav(creatorId) {
  try { await api("POST", "/favorites", { creatorId }); runDiscover(); }
  catch (err) { alert(err.message); }
}

function startOffer(creatorId) {
  state.tab = "My Offers";
  state.offerTarget = creatorId;
  render();
}

// Composer suggestion chips (Jeff, 2026-10-19): the Standard Visit
// package is pre-loaded and shown as a plain summary, comps are
// suggested by the creator's tier, dates are one tap. The underlying
// offer fields and API do not change.
function compSuggestions(tierBand) {
  const all = [
    { label: "Meal for one", comp: "Meal for one, on us", cap: 50 },
    { label: "Meal for two", comp: "Meal for two, on us", cap: 100 },
    { label: "Experience for two", comp: "Experience for two, on us", cap: 175 },
  ];
  if (tierBand === "Neighbors") return [all[0], { label: "Dessert + drinks", comp: "Dessert and drinks for one, on us", cap: 35 }];
  if (tierBand === "Locals") return [all[1], { label: "Brunch for two", comp: "Brunch for two, on us", cap: 80 }];
  if (tierBand === "Headliners") return [all[2], { label: "Meal for two + signature", comp: "Meal for two plus a signature item, on us", cap: 125 }];
  return all;
}

// Redemption windows (Jeff, 2026-10-19 r2): no appointments
// anywhere on SIGNL. An accepted offer is redeemed inside a
// window: 7 days from accepting (default) or this week, ending
// Sunday. The chips set the mode select; the free-text field is
// just an optional note for the creator.
function chipsRowHtml(kind, prefix, tierBand) {
  if (kind === "comp") {
    return `<div class="chip-row">${compSuggestions(tierBand).map((s) => `<button type="button" class="chip" onclick="setCompChip('${prefix}', ${JSON.stringify(s.comp)}, ${s.cap})">${esc(s.label)} (~$${s.cap})</button>`).join("")}</div>`;
  }
  return `<div class="chip-row"><button type="button" class="chip" onclick="setWindowMode('${prefix}', '7days')">Use within 7 days</button><button type="button" class="chip" onclick="setWindowMode('${prefix}', 'thisweek')">This week (ends Sunday)</button></div>`;
}

function setCompChip(prefix, comp, cap) {
  const c = document.getElementById(prefix + "-comped");
  const k = document.getElementById(prefix + "-cap");
  if (c) c.value = comp;
  if (k) k.value = cap;
}

function setWindowMode(prefix, mode) {
  const el = document.getElementById(prefix + "-windowmode");
  if (el) el.value = mode;
}

function windowModeFieldHtml(prefix) {
  return `<div class="field"><label>Redemption window (no appointments: the creator comes any time inside it)</label><select id="${prefix}-windowmode"><option value="7days">Use within 7 days of accepting</option><option value="thisweek">This week (ends Sunday)</option></select>${chipsRowHtml("window", prefix)}</div>`;
}

function packageSummaryHtml(planId, planName) {
  const rights = rightsForPlan(planId);
  return `<div class="showcase-block"><h4>Every offer is the Standard Visit</h4>
    <p class="small">${esc(standardVisit().summary)}</p>
    <p class="small"><strong>Your plan${planName ? ` (${esc(planName)})` : ""} covers:</strong> ${rights.can.map(esc).join("; ")}. They can't: ${rights.cannot.map(esc).join("; ")}.</p>
    <p class="small muted">Tip: creators post more when they can bring a guest. Meal-for-two comps outperform solo comps.</p>
  </div>`;
}

async function loadMyOffers() {
  const el = document.getElementById("tab-body");
  const target = state.offerTarget ? state.discover.find((c) => c.userId === state.offerTarget) : null;
  const myPlan = state.user && state.user.business ? state.user.business.plan : null;
  const planObj = (state.boot ? state.boot.plans : []).find((p) => p.id === myPlan);
  let html = `
  <div class="panel">
    <h3>Create a comp offer</h3>
    <div id="form-error"></div>
    ${packageSummaryHtml(myPlan, planObj ? planObj.name : null)}
    <form onsubmit="return createOffer(event)">
      <input type="hidden" id="o-creator" value="${target ? esc(target.userId) : ""}">
      ${target ? `<div class="notice blue">Sending directly to <strong>${esc(target.name)}</strong> (@${esc(target.profile.handle)}). <a href="#" onclick="state.offerTarget=null; loadMyOffers(); return false;">Make it an open offer instead</a></div>` : `<p class="small muted">Leave this open and any approved creator in ${esc(state.user.market)} can book it, or pick a creator in Discover and tap Send offer.</p>`}
      <div class="field"><label>Offer title</label><input id="o-title" required placeholder="For example: Dinner for two on us"></div>
      <div class="field"><label>Exactly what is comped</label><input id="o-comped" required placeholder="For example: Two entrees and two drinks for the creator and a guest">${chipsRowHtml("comp", "o", target && target.profile ? target.profile.tierBand : null)}<p class="small muted">Suggestions by ${target ? "this creator's tier" : "tier"}; type anything custom.</p></div>
      <div class="form-2col">
        <div class="field"><label>Dollar cap ($)</label><input type="number" id="o-cap" min="1" required placeholder="75"></div>
        <div class="field"><label>Spots (creators who can book)</label><input type="number" id="o-spots" min="1" value="1" required></div>
      </div>
      ${windowModeFieldHtml("o")}
      <div class="field"><label>Window note for the creator (optional)</label><input id="o-window" placeholder="For example: Evenings are best"></div>
      <p class="small muted">Reminder: you can describe the experience, never the opinion. Posts stay honest, and creators disclose the comp.</p>
      <button class="btn" type="submit">Publish offer</button>
    </form>
  </div>
  <div id="offer-list"><p class="muted">Loading your offers...</p></div>`;
  el.innerHTML = html;
  try {
    const data = await api("GET", "/offers");
    const list = document.getElementById("offer-list");
    if (!data.offers.length) { list.innerHTML = `<p class="muted">No offers yet. Your first offer goes out above.</p>`; return; }
    list.innerHTML = data.offers.map((o) => `
      <div class="card mb">
        <div class="flex-between"><strong>${esc(o.title)}</strong><span class="badge ${o.status === "open" ? "ok" : "warn"}">${esc(o.status)}</span></div>
        <p>${esc(o.whatComped)}</p>
        <p class="small muted">Cap $${o.dollarCap} &middot; ${esc(o.visitWindow || "Flexible window")} &middot; ${o.bookedCount}/${o.spots} booked ${o.creatorHandle ? "&middot; Sent to @" + esc(o.creatorHandle) : "&middot; Open offer"}</p>
      </div>`).join("");
  } catch (err) {
    document.getElementById("offer-list").innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function createOffer(e) {
  e.preventDefault();
  try {
    await api("POST", "/offers", {
      title: document.getElementById("o-title").value,
      whatComped: document.getElementById("o-comped").value,
      dollarCap: parseInt(document.getElementById("o-cap").value, 10),
      spots: parseInt(document.getElementById("o-spots").value, 10),
      visitWindow: document.getElementById("o-window").value,
      windowMode: document.getElementById("o-windowmode").value,
      creatorId: document.getElementById("o-creator").value || null,
    });
    state.offerTarget = null;
    loadMyOffers();
  } catch (err) {
    document.getElementById("form-error").innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
  return false;
}

// ---------- counter ----------

function renderCounter(prefill) {
  const el = document.getElementById("tab-body");
  const code = prefill || state.counterCode || "";
  el.innerHTML = `
  <div class="panel" style="max-width:560px;margin:0 auto">
    <h3>Counter check-in</h3>
    <p class="muted">The creator shows their code or QR at the visit. Scan the QR with any phone camera (it lands back here), or type the short code. One tap burns the code and starts the 48 hour post clock. Your register is never involved: ring the comp in your own system the way you normally do.</p>
    <form onsubmit="return counterLookup(event)">
      <div class="field"><label>Booking code</label><input id="counter-code" value="${esc(code)}" placeholder="SGNL-XXXXXX" style="text-transform:uppercase;font-family:Archivo;font-weight:700;letter-spacing:0.06em" required></div>
      <button class="btn" type="submit" style="width:100%">Look up booking</button>
    </form>
    <div id="counter-result" class="mt"></div>
  </div>`;
  if (code) setTimeout(() => counterLookup(null, code), 30);
}

async function counterLookup(e, preset) {
  if (e) e.preventDefault();
  const code = (preset || document.getElementById("counter-code").value).trim().toUpperCase();
  state.counterCode = code;
  const el = document.getElementById("counter-result");
  try {
    const data = await api("POST", "/counter/lookup", { code });
    const b = data.booking;
    if (b.redeemedAt) {
      el.innerHTML = `<div class="error-box">This code was already redeemed at ${fmtDate(b.redeemedAt)}. Codes work once.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="card">
        <div class="flex-between"><strong>${esc(b.creatorName)}</strong><span class="badge tier">@${esc(b.creatorHandle)}</span></div>
        <p>${esc(b.title)}: ${esc(b.whatComped)}</p>
        <p class="small muted">Comp cap $${b.dollarCap} &middot; Visit date: ${esc(b.visitDate || b.visitWindow || "Flexible")} &middot; Code ${esc(b.code)}</p>
        <p class="small">Check the person in front of you matches the creator, then redeem. The code burns and the 48 hour post clock starts now.</p>
        <button class="btn" style="width:100%" onclick="counterRedeem('${esc(code)}')">Redeem and start the clock</button>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
  return false;
}

async function counterRedeem(code) {
  const el = document.getElementById("counter-result");
  try {
    const data = await api("POST", "/counter/redeem", { code });
    const b = data.booking;
    el.innerHTML = `<div class="notice blue">Redeemed. ${esc(b.creatorName)}'s post is due by <strong>${fmtDate(b.postDeadline)}</strong>. Ring the comp in your own system, up to the $${b.dollarCap} cap. Track the post under Visits &amp; Posts.</div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

// ---------- plan tab ----------

function renderPlanTab() {
  const el = document.getElementById("tab-body");
  const u = state.user;
  const rl = u.business.reviewLinks || {};
  const plans = state.boot.plans.map((p) => `
    <div class="plan-card ${u.business.plan === p.id ? "selected" : ""}" id="plan-${esc(p.id)}" onclick="selectPlan('${esc(p.id)}')">
      <div class="price">$${p.priceMonthly}<span class="small muted">/mo</span></div>
      <strong>${esc(p.name)}</strong>
      <p class="small muted">${p.minMonths}-month minimum, then month to month.</p>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      ${u.business.plan === p.id ? `<p class="saved mt">Your current plan</p>` : ""}
    </div>`).join("");
  el.innerHTML = `
  <div class="panel">
    <h3>Your plan</h3>
    <p>Current plan: <strong>${esc(u.business.planName)}</strong>, selected ${fmtDate(u.business.planSelectedAt)}.</p>
    <p class="muted">${esc(u.business.billingStatus)}</p>
    <div class="plan-cards">${plans}</div>
    <input type="hidden" id="me-plan" value="${esc(u.business.plan)}">
    <button class="btn mt" onclick="savePlan()">Save plan selection</button>
    <p class="small muted mt">Card billing through Stripe is wired in at launch. Until then your selection is recorded and your founding spot is held.</p>
  </div>
  <div class="panel mt">
    <h3>Your public review pages</h3>
    <p class="small muted">Optional. When a creator completes a visit with you, your review pages appear in their visit flow as a courtesy ("Their review pages"), one tap out. Nothing is ever required, and no points attach to reviews left there.</p>
    <div class="form-2col">
      <div class="field"><label>Google review link</label><input id="rl-google" type="url" value="${esc(rl.google || "")}" placeholder="https://g.page/r/..."></div>
      <div class="field"><label>Yelp page link</label><input id="rl-yelp" type="url" value="${esc(rl.yelp || "")}" placeholder="https://www.yelp.com/biz/..."></div>
      <div class="field"><label>TripAdvisor page link</label><input id="rl-tripadvisor" type="url" value="${esc(rl.tripadvisor || "")}" placeholder="https://www.tripadvisor.com/..."></div>
      <div class="field"><label>Facebook page link</label><input id="rl-facebook" type="url" value="${esc(rl.facebook || "")}" placeholder="https://www.facebook.com/..."></div>
    </div>
    <button class="btn" onclick="saveMyReviewLinks()">Save review pages</button> <span id="rl-ok" class="saved"></span>
    ${u.business.plan === "managed" ? `
    <h3 class="mt">Monthly creator talent budget</h3>
    <p class="small muted">Your coordinator spends this on paid creator bookings for you. It is a spending cap and an authorization, not a deposit: each booking escrows on its own, and SIGNL holds each payment until the post is live.</p>
    <div class="field"><label>Budget per month ($)</label><input type="number" id="me-talent-budget" min="0" step="1" value="${esc(String(u.business.monthlyTalentBudget == null ? 500 : u.business.monthlyTalentBudget))}"></div>
    <button class="btn" onclick="saveTalentBudget()">Save budget</button> <span id="tb-ok" class="saved"></span>` : ""}
  </div>
  <div class="panel mt">
    <h3>Audience code discount</h3>
    <p class="small muted">Every creator who visits you gets a personal audience code, and the code counts the customers their post sends you whether or not it carries a discount. A discount is entirely your choice: it is off unless you turn it on, and the percentage is yours to pick (5 to 50). Nothing is ever applied by default. New bookings carry the setting you save here; bookings already made keep the setting they were created with.</p>
    <label style="font-weight:500"><input type="checkbox" id="me-discount-enabled" style="width:auto" ${u.business.discountEnabled ? "checked" : ""}> Offer a discount when customers use a creator's code</label>
    <div class="field" style="margin-top:8px"><label>Discount percent (%)</label><input type="number" id="me-discount-pct" min="5" max="50" step="1" value="${esc(String(u.business.discountPct == null ? ((state.boot.roasModel && state.boot.roasModel.suggestedDiscountPct) || 20) : u.business.discountPct))}"></div>
    <p class="small muted">Most businesses that turn this on start at ${esc(String((state.boot.roasModel && state.boot.roasModel.suggestedDiscountPct) || 20))}%. With codes off, the creator's card shows the code as a counting code and promises their audience nothing.</p>
    <button class="btn" onclick="saveMyDiscount()">Save code discount</button> <span id="disc-ok" class="saved"></span>
  </div>`;
}

async function saveMyDiscount() {
  try {
    const pctRaw = document.getElementById("me-discount-pct").value;
    const data = await api("PATCH", "/me/profile", {
      discountEnabled: document.getElementById("me-discount-enabled").checked,
      discountPct: pctRaw === "" ? undefined : Number(pctRaw),
    });
    state.user = data.user;
    document.getElementById("disc-ok").textContent = "Saved.";
  } catch (err) { alert(err.message); }
}

async function saveMyReviewLinks() {
  try {
    const data = await api("PATCH", "/me/profile", {
      reviewLinks: {
        google: document.getElementById("rl-google").value,
        yelp: document.getElementById("rl-yelp").value,
        tripadvisor: document.getElementById("rl-tripadvisor").value,
        facebook: document.getElementById("rl-facebook").value,
      },
    });
    state.user = data.user;
    document.getElementById("rl-ok").textContent = "Saved.";
  } catch (err) { alert(err.message); }
}

async function saveTalentBudget() {
  try {
    const data = await api("PATCH", "/me/profile", { monthlyTalentBudget: Number(document.getElementById("me-talent-budget").value) });
    state.user = data.user;
    document.getElementById("tb-ok").textContent = "Saved.";
  } catch (err) { alert(err.message); }
}

async function savePlan() {
  try {
    const data = await api("POST", "/me/plan", { planId: document.getElementById("me-plan").value });
    state.user = data.user;
    render();
  } catch (err) { alert(err.message); }
}

// ---------- messages ----------

function openThread(otherId) {
  state.tab = "Messages";
  state.activeThread = otherId;
  render();
}

async function loadThreads() {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/messages");
    state.threads = data.threads;
    let html = `<div class="grid cols-2"><div>`;
    if (!data.threads.length && !state.activeThread) {
      html += `<div class="panel center"><h3>No conversations yet</h3><p class="muted">${state.user.role === "business" ? "Find a creator in Discover and tap Message." : "Message a business from an offer or a visit."}</p></div>`;
    } else {
      html += `<div class="thread-list">${data.threads.map((t) => `
        <div class="thread-item" onclick="openThread('${t.otherId}')">
          <strong>${esc(t.otherBusinessName || t.otherName)}</strong> ${t.otherHandle ? `<span class="muted">@${esc(t.otherHandle)}</span>` : ""}
          <div class="small muted">${esc((t.lastMessage.body || "").slice(0, 90))}</div>
        </div>`).join("")}</div>`;
    }
    html += `</div><div id="thread-view">`;
    html += state.activeThread ? `<p class="muted">Loading conversation...</p>` : `<p class="muted">Pick a conversation.</p>`;
    html += `</div></div>`;
    el.innerHTML = html;
    if (state.activeThread) loadConversation(state.activeThread);
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function loadConversation(otherId) {
  const el = document.getElementById("thread-view");
  if (!el) return;
  try {
    const data = await api("GET", "/messages?with=" + encodeURIComponent(otherId));
    el.innerHTML = `
      <div id="msg-list">${data.messages.map((m) => `
        <div class="msg ${m.fromId === state.user.id ? "mine" : ""}">
          <div class="meta">${m.fromId === state.user.id ? "You" : "Them"} &middot; ${fmtDate(m.createdAt)}</div>
          ${esc(m.body)}
        </div>`).join("") || '<p class="muted">No messages yet. Say hello.</p>'}</div>
      <form onsubmit="return sendMessage(event, '${otherId}')" class="mt">
        <div class="field"><textarea id="msg-body" rows="2" placeholder="Write a message..." required></textarea></div>
        <button class="btn small-btn" type="submit">Send</button>
        <button class="btn small-btn ghost" type="button" onclick="loadConversation('${otherId}')">Refresh</button>
      </form>`;
    const list = document.getElementById("msg-list");
    list.scrollTop = list.scrollHeight;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function sendMessage(e, otherId) {
  e.preventDefault();
  try {
    await api("POST", "/messages", { toUserId: otherId, body: document.getElementById("msg-body").value });
    loadConversation(otherId);
  } catch (err) { alert(err.message); }
  return false;
}

// ---------- admin ----------

function renderAdmin() {
  const tab = state.tab || "Applications";
  state.tab = tab;
  app.innerHTML = `
    <h2>SIGNL Admin</h2>
    <div class="panel preview-cta">
      <div><strong>Business Preview</strong><p class="muted small" style="margin:4px 0 0">Walk the app exactly as a business does: the founding plans, roster search with every filter, full creator profiles, the offer composer, and the business dashboard with bookings, codes, tracking and returns. Offers sent in preview are simulations that never reach a creator and are never saved.</p></div>
      <button class="btn" onclick="enterPreview()">Preview as business &rarr;</button>
      <button class="btn ghost" onclick="enterPreviewDashboard()">Business dashboard &rarr;</button>
    </div>
    ${tabsHtml(["Applications", "Markets", "Recruiters", "Event Log", "Compliance", "Campaign", "Stats"], tab)}
    <div id="tab-body"><p class="muted">Loading...</p></div>`;
  if (tab === "Applications") loadApplications();
  if (tab === "Markets") loadMarkets();
  if (tab === "Recruiters") loadLeaderboard();
  if (tab === "Event Log") loadEvents();
  if (tab === "Compliance") loadCompliance();
  if (tab === "Campaign") loadCampaign();
  if (tab === "Stats") loadStats();
}

// Creator outreach campaigns (Jeff, 2026-10-19): the outreach
// email sends from inside the app (its own SMTP transport), so
// there is no per-send approval card. This tab is the control
// surface for BOTH campaigns: queue counts, the last error if a
// run stopped, recent sends, and the Arm / Pause switch per
// campaign. The founding campaign pitches a founding creator
// spot; the crossover campaign (added later the same day) pitches
// creators already on national platforms the additive local
// layer, and its imports skip any address the founding campaign
// already holds. Recipients are imported by pasting a JSON array
// into the box on the campaign's section, which posts to the
// admin import endpoint; sending runs on the 30-minute scheduled
// sweep, inside the 08:00-21:00 ET window, in batches of 8,
// under a global daily ceiling of 40 sends per ET day across
// all campaigns (it protects the sending domain).
const CAMPAIGN_SECTIONS = [
  { key: "founding", suffix: "", id: "founding-creators-2026-10", title: "Founding creators", blurb: "The founding creator email: a founding spot in their market, comped local experiences for honest posts within 48 hours, and a live founding profile from day one." },
  { key: "crossover", suffix: "-crossover", id: "founding-crossover-2026-10", title: "Platform crossover creators", blurb: "For creators already working national platforms like Grin, Cohley, or Momfluence. The pitch is additive and non-exclusive: keep those deals, SIGNL is the local layer on top. Imports skip any address the founding campaign already holds, so nobody receives both emails." },
];

async function loadCampaign() {
  const el = document.getElementById("tab-body");
  try {
    const sections = [];
    for (const meta of CAMPAIGN_SECTIONS) {
      const data = await api("GET", "/admin/campaign?campaignId=" + encodeURIComponent(meta.id));
      sections.push(campaignSectionHtml(meta, data));
    }
    el.innerHTML = `
      <h3 style="margin:0 0 8px">Creator outreach campaigns</h3>
      <p class="small muted">Both campaigns send through the same sweep: up to 8 emails per campaign every 30 minutes while armed, only between 8:00 and 21:00 ET. One daily ceiling covers both together: 40 sends per day (ET) across all campaigns, to protect the sending domain. Hitting it is normal; the queues wait for the next day. A queue auto-pauses when it empties.</p>
      ${sections.join("")}`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function campaignSectionHtml(meta, data) {
  const c = data.campaign || {};
  const counts = data.counts || {};
  const sends = (data.recentSends || []).map((s) => `
    <div class="card mb">
      <div class="flex-between"><strong>${esc(s.name || s.handle || s.email)}</strong><span class="badge ok">Sent</span></div>
      <p class="small muted">@${esc(s.handle || "")} &middot; ${esc(s.market || "")} &middot; ${esc(s.email)}${s.sentAt ? ` &middot; ${esc(fmtDate(s.sentAt))}` : ""}</p>
    </div>`).join("");
  return `
    <div class="flex-between mt"><h3 style="margin:0">${esc(meta.title)}</h3><span class="badge ${c.armed ? "ok" : "info"}">${c.armed ? "Armed" : "Paused"}</span></div>
    <p class="small muted" style="margin-top:8px">Campaign <strong>${esc(c.id || meta.id)}</strong>. ${esc(meta.blurb)}${c.lastRunAt ? ` Last sweep: ${esc(fmtDate(c.lastRunAt))}.` : ""} Send window is ${c.windowOpenNow ? "open now" : "closed right now"}.</p>
    ${c.lastError ? `<div class="error-box">${esc(c.lastError)}</div>` : ""}
    <p class="small">Queued: <strong>${counts.queued || 0}</strong> &middot; Sent: <strong>${counts.sent || 0}</strong> &middot; Bounced: <strong>${counts.bounced || 0}</strong> &middot; Skipped: <strong>${counts.skipped || 0}</strong> &middot; Total: <strong>${counts.total || 0}</strong> &middot; Sent today: <strong>${c.sentToday != null ? c.sentToday : 0} of ${c.dailyCeiling || 40} (daily ceiling)</strong></p>
    <button class="btn ${c.armed ? "danger" : ""}" onclick="toggleCampaignArm(${c.armed ? "false" : "true"}, '${meta.id}')">${c.armed ? "Pause campaign" : "Arm campaign"}</button>
    <div id="campaign-note${meta.suffix}" class="small saved"></div>
    <h3 class="mt">Import recipients</h3>
    <p class="small muted">Paste a JSON array of recipient objects: email, handle, market and opener are required; name is optional. Imported addresses join this campaign's queue; nothing sends until the campaign is armed.</p>
    <div class="field"><label>Paste recipients (JSON array)</label><textarea id="campaign-import-text${meta.suffix}" rows="8" placeholder='[{"email":"creator@example.com","name":"Casey","handle":"casey","market":"Richmond","opener":"your Carytown posts"}]'></textarea></div>
    <button class="btn" onclick="importCampaignRecipients('${meta.key}')">Import recipients</button>
    <div id="campaign-import-note${meta.suffix}" class="small saved"></div>
    ${sends ? `<h3 class="mt">Recent sends</h3>${sends}` : `<p class="muted mt">No sends yet.</p>`}`;
}

async function toggleCampaignArm(arm, campaignId) {
  try {
    await api("POST", arm ? "/admin/campaign/arm" : "/admin/campaign/disarm", { campaignId: campaignId || "founding-creators-2026-10" });
    loadCampaign();
  } catch (err) {
    for (const meta of CAMPAIGN_SECTIONS) {
      const note = document.getElementById("campaign-note" + meta.suffix);
      if (note && (!campaignId || meta.id === campaignId)) note.textContent = err.message;
    }
  }
}

// Paste-import for a campaign queue: the operator pastes a JSON
// array into the campaign's box, we parse it here (a parse failure
// shows an inline error and calls nothing), then POST the same
// payload the admin import endpoint has always taken and show its
// counts.
async function importCampaignRecipients(sectionKey) {
  const meta = CAMPAIGN_SECTIONS.find((s) => s.key === sectionKey) || CAMPAIGN_SECTIONS[0];
  const box = document.getElementById("campaign-import-text" + meta.suffix);
  const note = document.getElementById("campaign-import-note" + meta.suffix);
  let recipients;
  try {
    recipients = JSON.parse(box ? box.value : "");
  } catch (e) {
    if (note) note.textContent = "That is not valid JSON. Fix the pasted list and try again; nothing was imported.";
    return;
  }
  if (!Array.isArray(recipients)) {
    if (note) note.textContent = "Paste a JSON array of recipients (it starts with [ and ends with ]). Nothing was imported.";
    return;
  }
  try {
    const payload = meta.key === "crossover"
      ? { campaignId: "founding-crossover-2026-10", recipients }
      : { campaignId: "founding-creators-2026-10", recipients };
    const data = await api("POST", "/admin/campaign/import", payload);
    let summary = `Imported ${data.imported || 0} · Duplicates ${data.duplicates || 0} · Skipped ${data.skipped || 0} · Invalid ${(data.invalid || []).length}`;
    if (data.crossCampaign) summary += ` · ${data.crossCampaign} already in the founding campaign`;
    await loadCampaign();
    const fresh = document.getElementById("campaign-import-note" + meta.suffix);
    if (fresh) fresh.textContent = summary;
  } catch (err) {
    if (note) note.textContent = err.message;
  }
}

// Post compliance (Jeff, 2026-10-19): every redeemed visit by
// status, with the sweep trigger and the reinstate action for
// banned creators. All of it is a read over the same records the
// sweep acts on; reinstatement is the only write here.
async function loadCompliance() {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/admin/compliance");
    const statusLabel = {
      booked: "Booked, not redeemed",
      post_due: "Post due",
      posted_on_time: "Posted on time",
      posted_late: "Posted late (delivered)",
      overdue: "Overdue, inside the week",
      paused: "Past the hard stop, creator paused",
      missed: "Missed: no post delivered",
      expired: "Window expired unused (no-show)",
      honor_reported: "Business didn't honor: clock voided",
    };
    const rows = (data.visits || []).map((r) => `
      <div class="card mb">
        <div class="flex-between"><strong>${esc(r.title)}</strong><span class="badge ${r.status === "posted_on_time" ? "ok" : r.status === "posted_late" || r.status === "post_due" ? "warn" : r.status === "booked" ? "info" : "bad"}">${esc(statusLabel[r.status] || r.status)}</span></div>
        <p class="small muted">Creator: <strong>${esc(r.creatorName)}</strong> (@${esc(r.creatorHandle)}) &middot; Business: ${esc(r.businessName)} &middot; Market: ${esc(r.market)}</p>
        <p class="small">Redeemed: ${r.redeemedAt ? esc(fmtDate(r.redeemedAt)) : "not yet"} &middot; Post deadline: ${r.postDeadline ? esc(fmtDate(r.postDeadline)) : "n/a"} &middot; Hard stop: ${r.pauseAt ? esc(fmtDate(r.pauseAt)) : "n/a"} &middot; Ban lands: ${r.banAt ? esc(fmtDate(r.banAt)) : "n/a"}</p>
        ${r.proofUrl ? `<p class="small">Proof: <a href="${esc(r.proofUrl)}" target="_blank" rel="noopener">${esc(r.proofUrl)}</a>${r.proofSubmittedAt ? ` &middot; submitted ${esc(fmtDate(r.proofSubmittedAt))}` : ""}</p>` : ""}
        ${r.honorReportedAt ? `<p class="small">Honor report ${esc(fmtDate(r.honorReportedAt))}: &ldquo;${esc(r.honorReason || "")}&rdquo; This visit's compliance clock is void.</p>` : ""}
        <p class="small">Creator standing: <strong>${esc(r.creatorStanding)}</strong></p>
        ${r.creatorStanding === "banned" ? `<button class="btn small-btn" onclick="reinstateCreator('${r.creatorId}')">Reinstate creator</button>` : ""}
        ${r.creatorStanding === "paused" ? `<button class="btn small-btn ghost" onclick="reinstateCreator('${r.creatorId}')">Unpause creator</button>` : ""}
      </div>`).join("");
    const bizRows = (data.businesses || []).map((bz) => `
      <div class="card mb">
        <div class="flex-between"><strong>${esc(bz.businessName)}</strong><span class="badge ${bz.warning ? "bad" : "warn"}">${bz.reports} honor report${bz.reports === 1 ? "" : "s"}${bz.warning ? " &middot; WARNING" : ""}</span></div>
        <p class="small muted">Latest reason: &ldquo;${esc(bz.lastReason || "")}&rdquo; &middot; ${bz.lastAt ? esc(fmtDate(bz.lastAt)) : ""}</p>
        ${bz.warning ? `<p class="small">Two or more creators say this business did not honor a comp. Review before their next offers go out.</p>` : ""}
      </div>`).join("");
    el.innerHTML = `
      <div class="flex-between"><h3 style="margin:0">Post compliance</h3><button class="btn small-btn" onclick="runSweepNow()">Run sweep now</button></div>
      <p class="small muted" style="margin-top:8px">The sweep runs on a schedule and sends the 48-hour reminder, the day-5 reminder, and the day-6 final warning; it pauses creators at the one-week hard stop and bans at two weeks when a redeemed comp never gets a post. Counts: ${Object.entries(data.counts || {}).map(([k, v]) => `${esc(k)} ${v}`).join(" &middot; ") || "none yet"}</p>
      <div id="sweep-note" class="small saved"></div>
      ${rows || `<p class="muted">No redeemed visits yet. Compliance rows appear here the moment a comp is redeemed.</p>`}
      ${bizRows ? `<h3 class="mt">Businesses with honor reports</h3><p class="small muted">Creator reports that a business did not honor a comp. Admin only; there is no public surface for this.</p>${bizRows}` : ""}`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function runSweepNow() {
  const note = document.getElementById("sweep-note");
  try {
    const data = await api("POST", "/admin/compliance/sweep", {});
    const s = data.sweep || {};
    if (note) note.textContent = `Sweep ran: ${(s.reminder1 || 0) + (s.reminder2 || 0) + (s.reminder3 || 0)} reminder(s), ${s.paused || 0} pause(s), ${s.banned || 0} ban(s), ${s.expired || 0} window expiration(s), ${s.performance || 0} performance request(s).`;
    loadCompliance();
  } catch (err) {
    if (note) note.textContent = err.message;
  }
}

async function reinstateCreator(userId) {
  if (!confirm("Reinstate this creator? Their account returns to good standing and they can take offers again. The missed visit stays on their record.")) return;
  try {
    await api("POST", "/admin/compliance/reinstate", { userId });
    loadCompliance();
  } catch (err) { alert(err.message); }
}

async function loadMarkets() {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/admin/markets");
    el.innerHTML = `
      <p class="muted small">A market that is not live shows creators their founding status page only: no offers, no discovery, no business accounts. Activating a market opens the marketplace there. Founding creators keep sign-up-order priority in discovery.</p>
      ${data.testMode ? `<div class="error-box">TEST MODE is on (SIGNL_TEST_ALLOW_BUSINESS): every market reads live and business registration is open. Never run production this way.</div>` : ""}
      <div class="table-wrap panel"><table>
        <tr><th>Market</th><th>Status</th><th>Approved creators</th><th>Pending creators</th><th>Approved businesses</th><th>Action</th></tr>
        ${data.markets.map((m) => `<tr>
          <td><strong>${esc(m.name)}</strong><br><span class="muted small">${esc(m.label)} &middot; ${esc(m.country || "United States")}</span></td>
          <td>${m.live ? `<span class="badge ok">Live</span>` : `<span class="badge info">Founding only</span>`}</td>
          <td>${m.creatorsApproved}</td><td>${m.creatorsPending}</td><td>${m.businessesApproved}</td>
          <td><button class="btn small-btn ${m.live ? "danger" : ""}" onclick="toggleMarket('${esc(m.name)}', ${m.live ? "false" : "true"})">${m.live ? "Deactivate" : "Activate market"}</button></td>
        </tr>`).join("")}
      </table></div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function toggleMarket(market, live) {
  if (!confirm(`${live ? "Activate" : "Deactivate"} the ${market} market?`)) return;
  try {
    await api("POST", "/admin/markets/toggle", { market, live });
    loadMarkets();
  } catch (err) { alert(err.message); }
}

async function loadApplications() {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/admin/applications");
    const row = (u) => {
      const standing = u.role === "creator"
        ? (u.foundingPriority ? `<br><span class="badge tier">Founding priority #${u.foundingPriority}</span>` : u.queuePosition ? `<br><span class="badge info">Queue #${u.queuePosition} in market</span>` : "")
        : "";
      const detail = u.role === "creator" && u.creator
        ? `@${esc(u.creator.handle)} &middot; ${fmtNum(u.creator.followerCount)} followers &middot; ${esc(u.creator.tierBand)} &middot; Local: ${u.creator.localAudiencePct === null ? "not reported" : u.creator.localAudiencePct + "% (Self-reported)"} &middot; ${(u.creator.categories || []).map(esc).join(", ")} &middot; Photo: ${u.creator.hasPhoto ? "yes" : "no"} &middot; Socials: IG${u.creator.tiktokHandle ? ", TikTok" : ""}${u.creator.youtubeChannel ? ", YouTube" : ""}${u.creator.facebookUrl ? ", Facebook" : ""}${u.creator.xUrl ? ", X" : ""}${u.creator.linkedinUrl ? ", LinkedIn" : ""}${u.creator.neighborhood ? ` &middot; Area: ${esc(u.creator.neighborhood)}` : ""}${u.referredBy ? ` &middot; via @${esc(u.referredBy)}` : ""}${u.momentum && u.momentum.signups ? ` &middot; Momentum: ${u.momentum.points} pts (${u.momentum.signups} joined, ${u.momentum.approved} approved)` : ""}`
        : u.role === "business" && u.business
          ? `${esc(u.business.businessName)} &middot; ${esc(u.business.category)} &middot; ${esc(u.business.planName)}`
          : "";
      return `<tr>
        <td><strong>${esc(u.name)}</strong><br><span class="muted small">${esc(u.email)}</span></td>
        <td>${esc(u.role)}${standing}</td><td>${esc(u.market)}<br><span class="muted small">${esc(u.city || "")}${u.market === unlistedLabel() ? (u.country ? ", " + esc(u.country) : u.state ? ", " + esc(u.state) : "") : (u.state ? ", " + esc(u.state) : "")}</span></td>
        <td class="small">${detail}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td>${u.status === "pending"
          ? `<button class="btn small-btn" onclick="reviewApp('${u.id}','approve')">Approve</button> <button class="btn small-btn danger" onclick="reviewApp('${u.id}','reject')">Reject</button>`
          : `<span class="badge ${u.status === "approved" ? "ok" : "bad"}">${esc(u.status)}</span>${u.role === "creator" && u.tester ? ` <span class="badge warn">Tester</span>` : ""}${u.role === "creator" && u.status === "approved" ? `<br><button class="btn small-btn ghost" style="margin-top:6px" onclick="setTester('${u.id}', ${u.tester ? "false" : "true"})">${u.tester ? "Move to roster" : "Move to Tester"}</button>` : ""}`}${u.role === "business" && u.business ? `<br><button class="btn small-btn ghost" style="margin-top:6px" onclick="toggleReviewLinks('${u.id}')">Review links</button><div id="rl-edit-${u.id}" style="display:none;margin-top:8px;min-width:260px">${["google", "yelp", "tripadvisor", "facebook"].map((k) => `<div class="field"><label>${esc(k)}</label><input id="rl-${k}-${u.id}" type="url" value="${esc((u.business.reviewLinks || {})[k] || "")}" placeholder="https://"></div>`).join("")}<button class="btn small-btn" onclick="saveReviewLinks('${u.id}')">Save review links</button></div><br><button class="btn small-btn ghost" style="margin-top:6px" onclick="toggleDiscountEditor('${u.id}')">Code discount</button><div id="disc-edit-${u.id}" style="display:none;margin-top:8px;min-width:260px"><label style="font-weight:500"><input type="checkbox" id="disc-enabled-${u.id}" style="width:auto" ${u.business.discountEnabled ? "checked" : ""}> Code discounts on (business's opt-in)</label><div class="field"><label>Discount percent (5 to 50)</label><input id="disc-pct-${u.id}" type="number" min="5" max="50" step="1" value="${esc(String(u.business.discountPct == null ? 20 : u.business.discountPct))}"></div><button class="btn small-btn" onclick="saveDiscountSetting('${u.id}')">Save code discount</button></div>` : ""}</td>
      </tr>`;
    };
    el.innerHTML = `
      <h3>Pending (${data.pending.length})</h3>
      ${data.pending.length ? `<div class="table-wrap panel"><table><tr><th>Applicant</th><th>Type</th><th>Market</th><th>Details</th><th>Applied</th><th>Decision</th></tr>${data.pending.map(row).join("")}</table></div>` : `<p class="muted">No pending applications.</p>`}
      <h3 class="mt">Decided (${data.decided.length})</h3>
      ${data.decided.length ? `<div class="table-wrap panel"><table><tr><th>Applicant</th><th>Type</th><th>Market</th><th>Details</th><th>Applied</th><th>Status</th></tr>${data.decided.map(row).join("")}</table></div>` : `<p class="muted">None yet.</p>`}`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function loadLeaderboard() {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/admin/leaderboard");
    const rows = data.leaderboard || [];
    el.innerHTML = `
      <p class="muted small">Recruiters ranked by Momentum points: +3 for every creator who signs up through their invite link, +10 more when that creator is approved. Points come only from stored sign-up records.</p>
      ${rows.length ? `<div class="table-wrap panel"><table>
        <tr><th>#</th><th>Creator</th><th>Handle</th><th>Market</th><th>Sign-ups via link</th><th>Approved</th><th>Momentum points</th></tr>
        ${rows.map((r, i) => `<tr><td>${i + 1}</td><td><strong>${esc(r.name)}</strong></td><td>@${esc(r.handle)}</td><td>${esc(r.market)}</td><td>${r.signups}</td><td>${r.approved}</td><td><strong>${r.points}</strong></td></tr>`).join("")}
      </table></div>` : `<p class="muted">No creator has a credited sign-up yet. Leaderboard rows appear as soon as someone joins through an invite link.</p>`}`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function reviewApp(userId, decision) {
  try {
    await api("POST", "/admin/review", { userId, decision });
    loadApplications();
  } catch (err) { alert(err.message); }
}

// Tester designation (Jeff, 2026-10-19): an approved creator moved
// to Tester keeps signing in and using the creator side to test the
// app, but businesses never see them: discovery excludes them, their
// public profile page 404s, campaign sends skip their email, and
// roster / approved counts leave them out. Moving back to the
// roster restores all of it.
// Admin-side editor for a business's public review-page links
// (the founding application side of the field; businesses can also
// edit their own from the Plan tab). Host-validated server-side.
function toggleReviewLinks(userId) {
  const el = document.getElementById("rl-edit-" + userId);
  if (el) el.style.display = el.style.display === "none" ? "" : "none";
}

async function saveReviewLinks(userId) {
  try {
    await api("POST", "/admin/review-links", {
      userId,
      links: {
        google: document.getElementById("rl-google-" + userId).value,
        yelp: document.getElementById("rl-yelp-" + userId).value,
        tripadvisor: document.getElementById("rl-tripadvisor-" + userId).value,
        facebook: document.getElementById("rl-facebook-" + userId).value,
      },
    });
    loadApplications();
  } catch (err) { alert(err.message); }
}

// Admin-side editor for a business's audience-code discount
// setting (the founding-application side of the field; the
// business can also set its own from the Plan tab). Discounts
// are opt-in; the server validates the percentage range.
function toggleDiscountEditor(userId) {
  const el = document.getElementById("disc-edit-" + userId);
  if (el) el.style.display = el.style.display === "none" ? "" : "none";
}

async function saveDiscountSetting(userId) {
  try {
    const pctRaw = document.getElementById("disc-pct-" + userId).value;
    await api("POST", "/admin/discount-setting", {
      userId,
      enabled: document.getElementById("disc-enabled-" + userId).checked,
      pct: pctRaw === "" ? undefined : Number(pctRaw),
    });
    loadApplications();
  } catch (err) { alert(err.message); }
}

async function setTester(userId, tester) {
  const msg = tester
    ? "Move this creator to Tester? They keep full creator access for testing, but businesses will not see them, their public profile page comes down, campaign sends skip them, and roster counts exclude them."
    : "Move this creator back to the active roster? Businesses will see them in discovery again, their public profile page returns, and roster counts will include them.";
  if (!confirm(msg)) return;
  try {
    await api("POST", "/admin/tester", { userId, tester });
    loadApplications();
  } catch (err) { alert(err.message); }
}

async function loadEvents() {
  const el = document.getElementById("tab-body");
  try {
    const type = document.getElementById("ev-type") ? document.getElementById("ev-type").value : "";
    const data = await api("GET", "/admin/events?limit=300" + (type ? "&type=" + encodeURIComponent(type) : ""));
    const types = [...new Set(data.events.map((e) => e.type))].sort();
    el.innerHTML = `
      <div class="filters">
        <div><label>Event type</label><select id="ev-type" onchange="loadEvents()"><option value="">All types</option>${types.map((t) => `<option ${t === type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      </div>
      <p class="muted small">${data.total} events, newest first. Every state change in the product writes one of these. This is the dataset.</p>
      <div class="table-wrap panel"><table>
        <tr><th>When</th><th>Type</th><th>Actor</th><th>Market</th><th>Data</th></tr>
        ${data.events.map((e) => `<tr><td class="small">${fmtDate(e.ts)}</td><td><span class="badge info">${esc(e.type)}</span></td><td class="small">${esc(e.actorRole || "")}</td><td class="small">${esc(e.market || "")}</td><td class="small">${esc(JSON.stringify(e.data || {}))}</td></tr>`).join("")}
      </table></div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function loadStats() {
  const el = document.getElementById("tab-body");
  try {
    const s = await api("GET", "/admin/stats");
    el.innerHTML = `
      <div class="panel"><div class="stat-row">
        <div class="stat"><div class="num">${s.users.creators}</div><div class="lbl">Creators</div></div>
        <div class="stat"><div class="num">${s.users.businesses}</div><div class="lbl">Businesses</div></div>
        <div class="stat"><div class="num">${s.users.pending}</div><div class="lbl">Pending</div></div>
        <div class="stat"><div class="num">${s.users.testers || 0}</div><div class="lbl">Testers (excluded from roster counts)</div></div>
        <div class="stat"><div class="num">${s.offers}</div><div class="lbl">Offers</div></div>
        <div class="stat"><div class="num">${s.bookings.redeemed}</div><div class="lbl">Visits redeemed</div></div>
        <div class="stat"><div class="num">${s.posts.total}</div><div class="lbl">Posts</div></div>
        <div class="stat"><div class="num">${s.posts.onTimeRate === null ? "n/a" : s.posts.onTimeRate + "%"}</div><div class="lbl">Posts on time</div></div>
      </div></div>
      <div class="table-wrap panel"><table>
        <tr><th>Market</th><th>Approved creators</th><th>Approved businesses</th><th>Bookings</th><th>Posts</th></tr>
        ${Object.entries(s.perMarket).map(([m, v]) => `<tr><td>${esc(m)}</td><td>${v.creators}</td><td>${v.businesses}</td><td>${v.bookings}</td><td>${v.posts}</td></tr>`).join("")}
      </table></div>
      ${s.unlistedByCity && s.unlistedByCity.length ? `
      <h3 class="mt">Sign-ups in cities not open yet</h3>
      <p class="muted small">Creators who signed up from outside the listed markets, counted per city and country. This is the demand signal for where to open next.</p>
      <div class="table-wrap panel"><table>
        <tr><th>City, country</th><th>Creator sign-ups</th></tr>
        ${s.unlistedByCity.map((r) => `<tr><td>${esc(r.place)}</td><td>${r.creators}</td></tr>`).join("")}
      </table></div>` : ""}`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

// ---------------- business preview (admin) ----------------
// Jeff (2026-10-19): a test run of the business journey inside the
// real app. The admin sees the founding plans a business picks from,
// searches the real roster with every live filter, opens the full
// rich creator profile, and runs the offer composer end to end. The
// composer is a simulation: the server validates and confirms but
// writes nothing, so no creator ever sees a preview offer and no
// count or metric moves. Every preview screen carries the PREVIEW
// banner; Exit preview (or any navigation) returns to the admin
// console cleanly.
function enterPreview() {
  if (!state.user || state.user.role !== "admin") return;
  state.preview = { step: "plans", planId: "self-service", market: "Hampton Roads", creators: null, creator: null, targetId: "", sent: [], confirmation: null, dashboard: null };
  state.view = "dashboard";
  render();
}

// Straight to the business dashboard (the tracking + returns walk).
function enterPreviewDashboard() {
  enterPreview();
  if (state.preview) previewToDashboard();
}

function exitPreview() {
  stopPreviewCountdown();
  state.preview = null;
  state.tab = "Applications";
  render();
}

function renderPreview() {
  const pv = state.preview;
  if (!pv) return renderAdmin();
  if (pv.step !== "dashboard") stopPreviewCountdown();
  const stepLabel = {
    plans: "Step 1 of 4: the plans a business picks from",
    discover: "Step 2 of 4: search the roster",
    profile: "Step 3 of 4: the full creator profile",
    offer: "Step 4 of 4: the offer composer (simulation)",
    dashboard: "The business dashboard: bookings, codes, tracking and returns",
  }[pv.step] || "";
  const planName = pv.step === "dashboard" && pv.dashboard
    ? pv.dashboard.plan.name
    : (state.boot.plans.find((p) => p.id === pv.planId) || {}).name || "";
  const navBtn = (step, label) => `<button class="${pv.step === step || (step === "discover" && (pv.step === "profile" || pv.step === "offer")) ? "active" : ""}" onclick="previewNavTo('${step}')">${label}</button>`;
  app.innerHTML = `
  <div class="preview-banner">
    <span class="preview-tag">PREVIEW</span>
    <span><strong>Previewing as a business.</strong> Everything here is what a business sees. Offers sent in preview are simulations: they never reach a creator and nothing is saved.</span>
    <button class="btn small-btn" onclick="exitPreview()">Exit preview</button>
  </div>
  <div class="tabs">${navBtn("plans", "Plans")}${navBtn("discover", "Discover")}${navBtn("dashboard", "Dashboard")}</div>
  <p class="muted small">${esc(stepLabel)} &middot; Plan: ${esc(planName)} &middot; Market: ${esc(pv.market)}</p>
  <div id="preview-main"></div>`;
  const main = document.getElementById("preview-main");
  if (pv.step === "plans") main.innerHTML = previewPlansHtml();
  else if (pv.step === "discover") { main.innerHTML = previewDiscoverHtml(); if (pv.creators) renderPreviewResults(); else runPreviewDiscover(); }
  else if (pv.step === "profile" && pv.creator) main.innerHTML = creatorProfileDetailHtml(pv.creator, true);
  else if (pv.step === "offer") main.innerHTML = previewOfferHtml();
  else if (pv.step === "dashboard") { main.innerHTML = pv.dashboard ? previewDashboardHtml(pv.dashboard) : `<section class="panel"><p class="muted">Loading the dashboard...</p></section>`; if (pv.dashboard) startPreviewCountdown(); else loadPreviewDashboard(); }
  else main.innerHTML = previewPlansHtml();
}

function previewNavTo(step) {
  const pv = state.preview;
  if (!pv) return;
  if (step === "dashboard") return previewToDashboard();
  stopPreviewCountdown();
  pv.step = step;
  renderPreview();
}

function previewPlansHtml() {
  const pv = state.preview;
  const plans = state.boot.plans.map((p) => `
    <div class="plan-card ${pv.planId === p.id ? "selected" : ""}" onclick="previewPickPlan('${p.id}')">
      <div class="price">$${p.priceMonthly}<span class="small muted">/mo</span></div>
      <strong>${esc(p.name)}</strong>
      <p class="small muted">${p.minMonths}-month minimum, then month to month.</p>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    </div>`).join("");
  return `
  <section class="panel">
    <h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> What a business sees first: the founding plans</h3>
    <p class="muted">A business joins the founding list and picks a plan (recorded at sign-up, no card charged during founding); when their market activates, they land in Discover with the founding roster ready. Pick a plan and a market, then walk the roster exactly as they would.</p>
    <div class="field"><label>Market to preview</label><select id="pv-market">${state.boot.markets.map((m) => `<option ${pv.market === m.name ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div>
    <div class="plan-cards">${plans}</div>
    <p class="mt"><button class="btn" onclick="previewToDiscover()">Continue as this business: search the roster &rarr;</button>
    <button class="btn ghost" onclick="previewToDashboard()">Skip ahead: the business dashboard &rarr;</button></p>
    <p class="small muted">Preview discovery works in every market, live or not, so a market can be test-driven before it opens. Real businesses only search their own market once it is live.</p>
  </section>`;
}

function previewPickPlan(id) {
  const m = document.getElementById("pv-market");
  if (m) state.preview.market = m.value;
  state.preview.planId = id;
  renderPreview();
}

function previewToDiscover() {
  const m = document.getElementById("pv-market");
  if (m) state.preview.market = m.value;
  state.preview.step = "discover";
  state.preview.creators = null;
  renderPreview();
}

function previewDiscoverHtml() {
  const pv = state.preview;
  return `
  <section class="panel">
    <h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> Discover: the roster a business searches</h3>
    <p class="muted small">Every filter a real business gets, answered by the same server code, over the real approved roster.</p>
    <div class="filters">
      <div><label>Market</label><select id="pvf-market">${state.boot.markets.map((m) => `<option ${pv.market === m.name ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div>
      <div><label>Neighborhood / area</label><input id="pvf-neighborhood" placeholder="For example: Oceanfront, Ghent"></div>
      <div><label>Tier</label><select id="pvf-tier"><option value="">All tiers</option>${state.boot.tiers.map((t) => `<option>${esc(t.id)}</option>`).join("")}</select></div>
      <div><label>Category</label><select id="pvf-category"><option value="">All categories</option>${state.boot.creatorCategories.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
      <div><label>Search</label><input id="pvf-q" placeholder="Name or handle"></div>
    </div>
    <div class="filters">
      <div><label>Would accept (comp fit)</label><select id="pvf-comp"><option value="">Any comp</option>${state.boot.compCategories.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
      <div><label>Total audience min</label><input type="number" id="pvf-fmin" min="0" placeholder="Any"></div>
      <div><label>Total audience max</label><input type="number" id="pvf-fmax" min="0" placeholder="Any"></div>
      <div><label>Min % followers in market</label><input type="number" id="pvf-minlocal" min="0" max="100" placeholder="Any"></div>
      <div><label>Sort by</label><select id="pvf-sort"><option value="">Founding order</option><option value="score">Local Impact Score</option><option value="momentum">Momentum (roster standing)</option></select></div>
      <div><label>&nbsp;</label><label style="font-weight:500"><input type="checkbox" id="pvf-paid" style="width:auto"> Has a paid rate (paid bookings) only</label></div>
      <div><label>&nbsp;</label><button class="btn small-btn" style="width:100%" onclick="runPreviewDiscover()">Search</button></div>
    </div>
    <div id="pv-results"><p class="muted">Loading creators...</p></div>
  </section>
  ${previewSentHtml()}`;
}

function previewSentHtml() {
  const pv = state.preview;
  if (!pv || !pv.sent.length) return "";
  return `<section class="panel"><h4 style="margin-top:0">Sent in this preview session (${pv.sent.length})</h4><p class="small muted">Simulations only. Stored nowhere, seen by no creator, counted nowhere.</p>${pv.sent.map((o) => `<p class="small">&middot; <strong>${esc(o.title)}</strong> &rarr; ${o.creatorHandle ? "@" + esc(o.creatorHandle) : "open offer"} &middot; cap $${o.dollarCap} &middot; ${esc(o.visitWindow || "Flexible window")}</p>`).join("")}</section>`;
}

async function runPreviewDiscover() {
  const el = document.getElementById("pv-results");
  const val = (id) => { const n = document.getElementById(id); return n ? n.value : ""; };
  const params = new URLSearchParams();
  const market = val("pvf-market");
  if (market) { params.set("market", market); state.preview.market = market; }
  const neighborhood = val("pvf-neighborhood").trim();
  const tier = val("pvf-tier");
  const category = val("pvf-category");
  const q = val("pvf-q");
  const comp = val("pvf-comp");
  const fmin = val("pvf-fmin");
  const fmax = val("pvf-fmax");
  const minlocal = val("pvf-minlocal");
  const sort = val("pvf-sort");
  if (neighborhood) params.set("neighborhood", neighborhood);
  if (tier) params.set("tier", tier);
  if (category) params.set("category", category);
  if (q) params.set("q", q);
  if (comp) params.set("compCategory", comp);
  if (fmin) params.set("followersMin", fmin);
  if (fmax) params.set("followersMax", fmax);
  if (minlocal) params.set("minLocalPct", minlocal);
  if (sort) params.set("sort", sort);
  const paidBox = document.getElementById("pvf-paid");
  if (paidBox && paidBox.checked) params.set("paid", "1");
  try {
    const data = await api("GET", "/admin/preview/discover?" + params.toString());
    state.preview.creators = data.creators || [];
    renderPreviewResults();
  } catch (err) {
    if (el) el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function renderPreviewResults() {
  const el = document.getElementById("pv-results");
  if (!el) return;
  const list = state.preview.creators || [];
  if (!list.length) {
    el.innerHTML = `<div class="panel center"><h3>No approved creators match yet</h3><p class="muted">This is the same empty state a business sees while a market's founding roster is still filling.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="creator-grid">${list.map((c) => creatorCard(c, state.user, { preview: true })).join("")}</div>`;
}

async function previewViewCreator(userId) {
  try {
    const data = await api("GET", "/admin/preview/creator/" + encodeURIComponent(userId));
    state.preview.creator = data.creator;
    state.preview.step = "profile";
    renderPreview();
    window.scrollTo(0, 0);
  } catch (err) { alert(err.message); }
}

function previewBackToResults() {
  state.preview.step = "discover";
  renderPreview();
}

function previewStartOffer(userId) {
  state.preview.targetId = userId || "";
  state.preview.confirmation = null;
  state.preview.step = "offer";
  renderPreview();
  window.scrollTo(0, 0);
}

function previewOfferHtml() {
  const pv = state.preview;
  const target = pv.targetId
    ? (pv.creators || []).find((c) => c.userId === pv.targetId) || (pv.creator && pv.creator.userId === pv.targetId ? pv.creator : null)
    : null;
  const planObj = (state.boot.plans || []).find((p) => p.id === pv.planId);
  return `
  <section class="panel">
    <h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> Send an offer (simulation)</h3>
    ${pv.confirmation ? `<div class="notice blue">${pv.confirmation}</div>` : ""}
    ${target
      ? `<div class="notice">Sending directly to <strong>${esc(target.name)}</strong> (@${esc((target.profile || {}).handle || "")}). <a href="#" onclick="previewStartOffer(''); return false;">Make it an open offer instead</a></div>`
      : `<p class="small muted">An open offer: any approved creator in ${esc(pv.market)} could book it in the real app. Or go back to the roster and pick a creator to target.</p>`}
    ${packageSummaryHtml(pv.planId, planObj ? planObj.name : null)}
    <div id="pv-form-error"></div>
    <form onsubmit="return previewSendOffer(event)">
      <div class="field"><label>Offer title</label><input id="pvo-title" required placeholder="For example: Dinner for two on us"></div>
      <div class="field"><label>Exactly what is comped</label><input id="pvo-comped" required placeholder="For example: Two entrees and two drinks for the creator and a guest">${chipsRowHtml("comp", "pvo", target && target.profile ? target.profile.tierBand : null)}</div>
      <div class="form-2col">
        <div class="field"><label>Dollar cap ($)</label><input type="number" id="pvo-cap" min="1" required placeholder="75"></div>
        <div class="field"><label>Spots (creators who can book)</label><input type="number" id="pvo-spots" min="1" value="1" required></div>
      </div>
      ${windowModeFieldHtml("pvo")}
      <div class="field"><label>Window note for the creator (optional)</label><input id="pvo-window" placeholder="For example: Evenings are best"></div>
      <p class="small muted">The real composer carries the same honesty reminder: describe the experience, never the opinion. Posts stay honest, and creators disclose the comp.</p>
      <button class="btn" type="submit">Send preview offer</button>
      <button class="btn ghost" type="button" onclick="previewBackToResults()">Back to the roster</button>
    </form>
  </section>
  ${previewSentHtml()}`;
}

async function previewSendOffer(e) {
  e.preventDefault();
  const pv = state.preview;
  try {
    const data = await api("POST", "/admin/preview/offers", {
      title: document.getElementById("pvo-title").value,
      whatComped: document.getElementById("pvo-comped").value,
      dollarCap: parseInt(document.getElementById("pvo-cap").value, 10),
      spots: parseInt(document.getElementById("pvo-spots").value, 10),
      visitWindow: document.getElementById("pvo-window").value,
      windowMode: document.getElementById("pvo-windowmode").value,
      creatorId: pv.targetId || null,
      market: pv.market,
    });
    pv.sent.unshift(data.offer);
    const o = data.offer;
    pv.confirmation = `Simulation sent: &ldquo;${esc(o.title)}&rdquo; ${o.creatorHandle ? `to @${esc(o.creatorHandle)}` : "as an open offer"}. In the real app it would now sit in the creator's Offers tab. Here it went nowhere: no creator was contacted, nothing was saved, and no count moved.`;
    renderPreview();
  } catch (err) {
    const el = document.getElementById("pv-form-error");
    if (el) el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
  return false;
}

// ---------------- business preview dashboard (admin) ----------------
// Jeff (2026-10-19): the business home, walked inside preview. One
// simulated Growth-plan business, bookings across the real approved
// roster in every lifecycle state, the counter staff view, and the
// tracking + returns summary. The server builds it read-only per
// request (GET /admin/preview/dashboard): nothing is saved, no event
// is logged, and the bookings exist only on this screen.
function previewToDashboard() {
  const pv = state.preview;
  if (!pv) return;
  pv.step = "dashboard";
  renderPreview();
}

async function loadPreviewDashboard() {
  const pv = state.preview;
  try {
    const data = await api("GET", "/admin/preview/dashboard");
    if (!state.preview || state.preview.step !== "dashboard") return;
    pv.dashboard = data.dashboard;
    renderPreview();
  } catch (err) {
    const main = document.getElementById("preview-main");
    if (main) main.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

let pvCountdownTimer = null;
function startPreviewCountdown() {
  stopPreviewCountdown();
  tickPreviewCountdowns();
  pvCountdownTimer = setInterval(tickPreviewCountdowns, 30000);
}
function stopPreviewCountdown() {
  if (pvCountdownTimer) { clearInterval(pvCountdownTimer); pvCountdownTimer = null; }
}
function pvDurCore(ms) {
  const a = Math.abs(ms);
  const d = Math.floor(a / 86400000), h = Math.floor((a % 86400000) / 3600000), m = Math.floor((a % 3600000) / 60000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function tickPreviewCountdowns() {
  document.querySelectorAll(".pv-tick").forEach((el) => {
    const t = Date.parse(el.dataset.target || "");
    if (!t) return;
    const diff = t - Date.now();
    if (el.dataset.kind === "left") el.textContent = diff > 0 ? `${pvDurCore(diff)} left` : `${pvDurCore(-diff)} past the deadline`;
    else el.textContent = diff > 0 ? `in ${pvDurCore(diff)}` : "now";
  });
}

function pvStateBadge(b) {
  const map = {
    booked: `<span class="badge info">${esc(b.stateLabel)}</span>`,
    post_due: `<span class="badge info">${esc(b.stateLabel)}</span>`,
    posted_on_time: `<span class="badge ok">${esc(b.stateLabel)}</span>`,
    posted_late: `<span class="badge warn">${esc(b.stateLabel)}</span>`,
    overdue: `<span class="badge bad">${esc(b.stateLabel)}</span>`,
  };
  return map[b.state] || `<span class="badge">${esc(b.stateLabel)}</span>`;
}

function pvStars(n) {
  return `<span class="stars">${"&#9733;".repeat(n)}${"&#9734;".repeat(5 - n)}</span>`;
}

function pvChecklistHtml(b) {
  const rows = (b.checklist || []).map((it) => {
    const mark = it.state === "done" ? "&#10003;" : it.state === "overdue" ? "!" : "&middot;";
    return `<div class="earn-row ${it.state === "done" ? "done" : ""}"><span class="earn-state">${mark}</span><span class="earn-label">${esc(it.label)}<br><span class="small muted">${esc(it.detail)}</span></span></div>`;
  }).join("");
  return `<div class="showcase-block"><h4>The Standard Visit checklist</h4>${rows}</div>`;
}

function pvBookingCard(b) {
  const methodLabel = b.redeemMethod === "business_confirm" ? "business confirmed in the app (no code)" : "staff scanned the code at the counter";
  let html = `
  <div class="card visit-card mb">
    <div class="flex-between"><strong>${esc(b.title)}</strong>${pvStateBadge(b)}</div>
    <p class="small muted">@${esc(b.creatorHandle)} (${esc(b.creatorName)})${b.creatorTier ? ` &middot; ${esc(b.creatorTier)}` : ""} &middot; ${esc(b.market)} &middot; Comp: ${esc(b.whatComped)} (cap $${b.dollarCap}${b.compCostModeled ? `, at cost $${b.compCostModeled} modeled` : ""}) &middot; Window: ${esc(b.visitWindow || "Flexible")}</p>`;
  if (b.state === "booked") {
    html += `
    <div class="grid cols-2">
      <div>
        <p class="small muted" style="margin-bottom:0">The visit credential, exactly as issued. The creator shows the code or the QR; staff redeem it in the app and the 48 hour post clock starts at that moment.</p>
        <div class="code-display">${esc(b.code)}</div>
        <p class="small"><strong>Redeem by ${esc(fmtDate(b.redeemBy))}</strong>. Any time inside the window, no appointment. If the window passes unused, the booking expires as a no-show.</p>
      </div>
      <div class="qr-box">${b.qrSvg || ""}</div>
    </div>`;
  }
  if (b.redeemedAt) {
    html += `<p class="small muted">Redeemed ${esc(fmtDate(b.redeemedAt))} (${esc(methodLabel)}). Code ${esc(b.code)} is burned. Post deadline: <strong>${esc(fmtDate(b.postDeadline))}</strong>.</p>`;
  }
  if (b.state === "post_due") {
    html += `<p class="small">Post clock: <span class="countdown pv-tick" data-kind="left" data-target="${esc(b.postDeadline)}"></span> of the 48 hours. The creator sees the same countdown in My Visits.</p>`;
  }
  if (b.state === "overdue") {
    html += `<div class="notice"><strong>This visit needs attention.</strong> ${(b.alerts || []).map((a) => `<br>${esc(a)}`).join("")}<br>Hard stop <span class="countdown pv-tick" data-kind="until" data-target="${esc(b.pauseAt)}"></span> (${esc(fmtDate(b.pauseAt))}).</div>
    <button class="btn small-btn" disabled>Request a replacement visit</button> <span class="small muted">In the live app this asks SIGNL for a replacement creator for the burned visit. Disabled in preview.</span>`;
  }
  if (b.post) {
    const p = b.post;
    html += `<p class="small">Post: <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a> &middot; submitted ${esc(fmtDate(p.submittedAt))} (${p.hoursAfterRedeem}h after redemption) &middot; ${p.onTime ? `<span class="saved">On time</span>` : `<span style="color:var(--amber)">Delivered late</span>`} &middot; comp disclosed</p>`;
    if (p.reportedAt) {
      html += `<p class="small">Your comp produced <strong>${fmtNum(p.views)} views &middot; ${fmtNum(p.likes)} likes &middot; ${fmtNum(p.comments || 0)} comments &middot; ${fmtNum(p.shares || 0)} shares</strong> (creator-reported ${esc(fmtDate(p.reportedAt))}).</p>`;
    }
    if (b.creatorCode) {
      html += `<p class="small">Audience code for this creator: <strong>${esc(b.creatorCode)}</strong>${b.discountPct > 0 ? ` (${b.discountPct}% off, the discount this business turned on)` : " (counting code only: this business has not turned on a code discount)"}. It is shared in the post and rung up at your own register; the tally below is what the business reported back.</p>`;
    }
    if (b.redemptions) {
      html += `<p class="small">Code tally: <strong>${b.redemptions.count} customers used it, $${fmtMoney(b.redemptions.basketTotal)} rung up</strong> at the register.</p>`;
    }
    if (b.roas) {
      const r = b.roas;
      html += `<p class="small"><strong>SIGNL ROAS Score: ${r.score === null ? "n/a" : r.score.toFixed(2) + "&times;"}</strong> <span class="muted">(our own model)</span> &middot; $${fmtMoney(r.registerValue)} tracked at the register + $${fmtMoney(r.mediaValue)} modeled media value, against $${fmtMoney(r.compCost)} comp at cost + $${fmtMoney(r.discountCost)} code discounts${r.allInScore !== null ? ` &middot; all-in ${r.allInScore.toFixed(2)}&times; with the plan counted` : ""}.</p>`;
    }
    html += `
    <form onsubmit="return pvReportRedemptions(event, '${b.id}')">
      <div class="form-2col">
        <div class="field"><label>Code redemptions (simulation)</label><input type="number" id="pv-redeem-count-${b.id}" min="0" value="${b.redemptions ? b.redemptions.count : 0}"></div>
        <div class="field"><label>Total rung up with the code ($) (simulation)</label><input type="number" id="pv-redeem-basket-${b.id}" min="0" step="0.01" value="${b.redemptions ? b.redemptions.basketTotal : 0}"></div>
      </div>
      <button class="btn small-btn ghost" type="submit">Preview the score with this tally</button>
      <span class="small" id="pv-redeem-result-${b.id}"></span>
      <p class="small muted">Simulation only: in the live app the business reports this tally on the visit and it is saved. Here nothing is recorded, and the dashboard keeps its original tallies.</p>
    </form>`;
    html += `<button class="btn small-btn ghost" disabled>Use in an ad</button> <span class="small muted">Your Growth plan includes ad use while your account is active; the creator is notified and earns +25 Momentum. Disabled in preview; try it live from the creator profile's showcase.</span>`;
  }
  if (b.review) {
    html += `<div class="review-item"><span class="small muted">Your review of this creator</span><br>${pvStars(b.review.stars)} <span class="small">${esc(b.review.text)}</span></div>`;
  }
  html += pvChecklistHtml(b);
  html += `</div>`;
  return html;
}

function pvStaffPanelHtml(d) {
  const booked = (d.bookings || []).find((b) => b.state === "booked");
  const redeemed = (d.bookings || []).find((b) => b.state === "post_due");
  if (!booked) return "";
  return `
  <section class="panel">
    <h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> What staff see at the counter</h3>
    <p class="muted small">The Counter screen, read-only. In the live app this is the whole job: the creator shows their code or QR, staff look it up, one tap redeems it and starts the 48 hour clock. The register is never involved; staff ring the comp in your own system the way they normally do.</p>
    <div class="grid cols-2">
      <div class="card">
        <div class="field"><label>Booking code</label><input value="${esc(booked.code)}" disabled style="text-transform:uppercase;font-family:Archivo;font-weight:700;letter-spacing:0.06em"></div>
        <div class="card" style="margin-top:10px">
          <div class="flex-between"><strong>${esc(booked.creatorName)}</strong><span class="badge tier">@${esc(booked.creatorHandle)}</span></div>
          <p class="small">${esc(booked.title)}: ${esc(booked.whatComped)}</p>
          <p class="small muted">Comp cap $${booked.dollarCap} &middot; Window: ${esc(booked.visitWindow || "Flexible")} &middot; Code ${esc(booked.code)}</p>
          <p class="small">Check the person in front of you matches the creator, then redeem. The code burns and the 48 hour post clock starts now.</p>
          <button class="btn" style="width:100%" disabled>Redeem and start the clock</button>
          <p class="small muted" style="margin-bottom:0">Read-only in preview. No code shown anywhere in preview can actually be redeemed.</p>
        </div>
      </div>
      <div>
        ${redeemed ? `<div class="error-box">This code was already redeemed at ${esc(fmtDate(redeemed.redeemedAt))}. Codes work once.</div>
        <p class="small muted">That is what staff see if a burned code is entered again, here for ${esc(redeemed.title)} (@${esc(redeemed.creatorHandle)}). One code, one visit, no double comps.</p>` : ""}
        <div class="card">
          <strong>No code? No problem.</strong>
          <p class="small">If the creator is standing there but the code cannot be scanned, staff confirm the visit from the booking instead. The same 48 hour clock starts, and the booking is marked "business confirmed", like the Sunday supper club visit in the list below. The creator also gets an "I am here" check-in button on their side.</p>
        </div>
      </div>
    </div>
  </section>`;
}

// The Managed-plan talent budget panel (Jeff, 2026-10-19): a
// SECOND simulated business on Managed, so the Growth dashboard
// above it stays untouched. Shows the budget set for the month,
// what the coordinator has spent on paid bookings this cycle, and
// what remains, with each paid booking's fee math and escrow
// state. Simulated like everything in preview: zero writes.
function pvManagedHtml(mv) {
  const b = mv.budget;
  const rows = (b.paidBookings || []).map((pb) => `
    <div class="review-item">
      <strong>@${esc(pb.creatorHandle)}</strong> (${esc(pb.creatorName)}) &middot; paid visit at her listed rate of $${esc(String(pb.rate))}<br>
      <span class="small">Business paid $${esc(String(pb.businessTotal))} (rate + 3%) &middot; creator receives $${esc(String(pb.creatorNet))} &middot; SIGNL fee $${esc(String(pb.platformFee))}, split evenly &middot; ${pb.escrowState === "released" ? `<span class="badge ok">Escrow released</span>` : `<span class="badge info">Escrow held</span>`} <span class="muted">${esc(pb.escrowNote)}</span></span>
    </div>`).join("");
  return `
  <section class="panel">
    <div class="flex-between">
      <div><h3 style="margin:0">${esc(mv.business.name)}</h3><p class="muted small" style="margin:4px 0 0">${esc(mv.business.category)} &middot; ${esc(mv.business.market)} &middot; a second simulated business, shown so the Managed budget has somewhere honest to live</p></div>
      <span class="badge info">${esc(mv.plan.name)} plan &middot; $${mv.plan.priceMonthly}/mo &middot; ${mv.plan.visitsPerMonth} visits/mo</span>
    </div>
    <h4>Monthly creator talent budget</h4>
    <div class="stat-row">
      <div class="stat"><div class="num">$${fmtNum(b.monthlyTalentBudget)}</div><div class="lbl">Budget set for the month</div></div>
      <div class="stat"><div class="num">$${fmtNum(b.spentThisMonth)}</div><div class="lbl">Spent on paid bookings</div></div>
      <div class="stat"><div class="num">$${fmtNum(b.remaining)}</div><div class="lbl">Remaining this month</div></div>
    </div>
    <p class="small muted">${esc(b.note)}</p>
    ${mv.discountCodes && !mv.discountCodes.enabled ? `<p class="small muted"><strong>Audience-code discounts: off.</strong> Harbor Table has not turned code discounts on, so its creator codes are counting codes only: they track the customers a post sends in, and promise no percentage off. Turning them on, and picking the percentage, is the business's call whenever it wants.</p>` : ""}
    ${rows || `<p class="small muted">No paid bookings yet this month.</p>`}
    <p class="small muted">Paid bookings are the optional lane: a specific creator at her own listed rate, 6% total fee split evenly (business +3%, creator keeps 97%). Comp-only is always fine, forever. ${b.paidBookings && b.paidBookings.length ? esc(b.paidBookings[0].paymentNote) : ""}</p>
  </section>`;
}

// Preview code redemptions (Jeff, 2026-10-19): the business
// reports a register tally against a simulated delivered visit
// and sees the SIGNL ROAS Score move. The server recomputes in
// memory and saves nothing; the result line says so.
async function pvReportRedemptions(e, bookingId) {
  e.preventDefault();
  const out = document.getElementById("pv-redeem-result-" + bookingId);
  try {
    const count = document.getElementById("pv-redeem-count-" + bookingId).value;
    const basket = document.getElementById("pv-redeem-basket-" + bookingId).value;
    const data = await api("POST", "/admin/preview/code-redemptions", {
      bookingId,
      count: count === "" ? 0 : parseInt(count, 10),
      basketTotal: basket === "" ? 0 : parseFloat(basket),
    });
    const r = data.booking.roas;
    const agg = data.roas;
    if (out) out.textContent = ` With that tally, this visit scores ${r.score === null ? "n/a" : r.score.toFixed(2) + "x"} and the dashboard total becomes ${agg.score === null ? "n/a" : agg.score.toFixed(2) + "x"} (all-in ${agg.allInScore === null ? "n/a" : agg.allInScore.toFixed(2) + "x"}). Nothing was saved.`;
  } catch (err) {
    if (out) out.textContent = " " + err.message;
  }
  return false;
}

// Business Home (dashboard concept merge, Jeff 2026-10-20): the
// first screen of the preview dashboard, rendered from the `home`
// object the server computes over the same simulated bookings:
// headline metrics, the attention list, the visit pipeline, plan
// pace, the content that is working (ranked by register tallies),
// and next visits. Simulation only, like the whole preview.
function pvHomeHtml(d) {
  const h = d.home;
  if (!h) return "";
  const stages = [
    [h.pipeline.invited, "Invited", "Bookings created"],
    [h.pipeline.claimed, "Claimed", "Codes issued"],
    [h.pipeline.visitSet, "Visit set", "Windows open"],
    [h.pipeline.clockRunning, "48h clock", "Visits redeemed"],
    [h.pipeline.live, "Live", "Posts delivered"],
  ];
  const attention = h.attention && h.attention.length ? `
    <div class="notice" style="margin-top:16px"><strong>${h.attention.length} item${h.attention.length === 1 ? "" : "s"} need your attention.</strong>
    ${h.attention.map((a) => `<br><strong>${esc(a.label)}:</strong> ${esc(a.detail)}`).join("")}</div>`
    : `<div class="notice blue" style="margin-top:16px"><strong>Nothing needs your attention.</strong> Every visit is on track.</div>`;
  const content = (h.topContent || []).map((c) => `
    <div class="ui-row"><span class="k"><strong>${esc(c.title)}</strong> with @${esc(c.creatorHandle)}<br><span class="small muted">${fmtNum(c.views)} views &middot; ${fmtNum(c.likes)} likes &middot; ${c.onTime ? "posted on time" : "posted late"}${c.roasScore !== null && c.roasScore !== undefined ? ` &middot; SIGNL ROAS ${c.roasScore.toFixed(2)}&times;` : ""}</span></span><span class="v">${c.redemptions ? `${c.redemptions.count} code uses<br>$${fmtMoney(c.redemptions.basketTotal)} rung up` : "No tally yet"}</span></div>`).join("");
  const next = (h.nextVisits || []).map((n) => `
    <div class="ui-row"><span class="k"><strong>${esc(n.title)}</strong> with @${esc(n.creatorHandle)}<br><span class="small muted">${esc(n.stateLabel)}</span></span><span class="v">${esc(n.whenLabel)}<br><span class="pv-tick" data-kind="left" data-target="${esc(n.when || "")}"></span></span></div>`).join("");
  return `
  <section class="panel">
    <h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> Business home</h3>
    <p class="small muted">The first screen a business opens: what is happening, what needs attention, and what it is returning. Built from the same simulated visits as everything below it.</p>
    <div class="stat-band home-metrics">
      <div class="stat-cell"><div class="stat-num">${h.visitsUsed}<span class="small muted"> of ${h.visitsAllowance}</span></div><div class="stat-lbl">Creator visits booked this month (${h.visitsRemaining} left on the plan)</div></div>
      <div class="stat-cell"><div class="stat-num">${h.postsLive}</div><div class="stat-lbl">Posts live</div></div>
      <div class="stat-cell"><div class="stat-num grad-text">${h.roasScore === null ? "n/a" : h.roasScore.toFixed(2) + "&times;"}</div><div class="stat-lbl">SIGNL ROAS Score (register tallies plus modeled media value)</div></div>
      <div class="stat-cell"><div class="stat-num">${h.onTimeRatePct === null ? "n/a" : h.onTimeRatePct + "%"}</div><div class="stat-lbl">Posts on time</div></div>
    </div>
    ${attention}
    <h4>Visit pipeline</h4>
    <div class="pv-funnel">${stages.map(([n, label, sub]) => `<div class="pv-stage"><div class="pv-stage-num">${n}</div><div class="pv-stage-lbl">${label}</div><div class="pv-stage-sub">${sub}</div></div>`).join("")}</div>
    <p class="small muted">Each stage counts the simulated bookings that have reached it, from invitation to a live post.</p>
    <h4>Plan pace</h4>
    <div class="flex-between"><span class="small"><strong>${esc(d.plan.name)} plan:</strong> ${h.visitsUsed} of ${h.visitsAllowance} visits booked this month</span><span class="badge ${h.planPacePct >= 100 ? "warn" : "info"}">${h.planPacePct}%</span></div>
    <div class="meter" style="margin-top:8px"><i style="width:${Math.min(100, h.planPacePct)}%"></i></div>
    ${content ? `<h4>Content that is working</h4>
    <p class="small muted">Delivered posts ranked by the register action they produced: the code tallies reported on each visit, with views as supporting detail.</p>${content}` : ""}
    ${next ? `<h4>Next visits</h4>${next}` : ""}
  </section>`;
}

function previewDashboardHtml(d) {
  const s = d.summary;
  const plan = d.plan;
  if (!d.bookings || !d.bookings.length) {
    return `<section class="panel"><h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> The business dashboard</h3><p class="muted">No approved creators yet, so there is no roster to simulate bookings over. Approve founding creators and the dashboard fills in.</p></section>`;
  }
  return `
  <section class="panel">
    <div class="flex-between">
      <div><h3 style="margin:0">${esc(d.business.name)}</h3><p class="muted small" style="margin:4px 0 0">${esc(d.business.category)} &middot; ${esc(d.business.market)} &middot; ${esc(s.cycleLabel)} cycle</p></div>
      <span class="badge info">${esc(plan.name)} plan &middot; $${plan.priceMonthly}/mo &middot; ${plan.visitsPerMonth} visits/mo</span>
    </div>
    <p class="small muted" style="margin-bottom:0">The dashboard a business lives in: who is booked, the codes, redemption, the post clock, delivered posts, and what it all returned. Every booking below is simulated over the real founding roster, with simulated visit data. Nothing here is saved, and no creator is contacted.</p>
  </section>
  ${pvHomeHtml(d)}
  <section class="panel">
    <h3 style="margin-top:0">Tracking and returns, ${esc(s.cycleLabel)}</h3>
    <div class="stat-row">
      <div class="stat"><div class="num">${s.visitsUsed}<span class="small muted"> of ${s.visitsAllowance}</span></div><div class="lbl">Visits booked this month</div></div>
      <div class="stat"><div class="num">${s.postsDelivered}</div><div class="lbl">Posts delivered</div></div>
      <div class="stat"><div class="num">${s.onTimeRatePct === null ? "n/a" : s.onTimeRatePct + "%"}</div><div class="lbl">On-time rate (${s.postsOnTime} on time, ${s.postsLate} late)</div></div>
      <div class="stat"><div class="num">${fmtNum(s.totalViews)}</div><div class="lbl">Total content views</div></div>
      <div class="stat"><div class="num">$${fmtNum(s.compValueGiven)}</div><div class="lbl">Comp given, at cost (modeled)</div></div>
    </div>
    <p class="small muted">${s.postsInFlight} post still inside its 48 hour clock, ${s.postsOverdue} overdue in the late window, ${s.visitsRemaining} visits left on the ${esc(plan.name)} allowance this month.</p>
    <p class="small muted">${esc(s.compValueBasis)}. The figures below are on simulated data, shown so the shape of the returns math is visible; live figures replace them as real visits complete.</p>
    ${s.roas ? `
    <div class="showcase-block"><h4>${esc(s.roas.label)}</h4>
      <div class="stat-row">
        <div class="stat"><div class="num grad-text">${s.roas.score === null ? "n/a" : s.roas.score.toFixed(2) + "&times;"}</div><div class="lbl">SIGNL ROAS Score</div></div>
        <div class="stat"><div class="num grad-text">${s.roas.allInScore === null ? "n/a" : s.roas.allInScore.toFixed(2) + "&times;"}</div><div class="lbl">All-in, with the plan counted</div></div>
        <div class="stat"><div class="num">$${fmtMoney(s.roas.registerValue)}</div><div class="lbl">Register value, tracked through creator codes (${s.roas.redemptions.count} redemptions, $${fmtMoney(s.roas.redemptions.basketTotal)} rung up)</div></div>
        <div class="stat"><div class="num">$${fmtMoney(s.roas.mediaValue)}</div><div class="lbl">Media value, modeled at the published rates</div></div>
        <div class="stat"><div class="num">$${fmtMoney(s.roas.compCost + s.roas.discountCost)}</div><div class="lbl">Visit costs: $${fmtMoney(s.roas.compCost)} comps at cost + $${fmtMoney(s.roas.discountCost)} code discounts</div></div>
      </div>
      <p class="small muted" style="margin-bottom:0">${esc(s.roas.registerBasis)} ${esc(s.roas.mediaBasis)}${s.roas.planKnown ? ` The all-in score also counts the ${esc(plan.name)} plan allocation of $${fmtMoney(s.roas.planAllocation)} across the delivered visits.` : ""} This is SIGNL's own return model, not an ad platform's: the register side is spend we can point at, the media side is priced in the open.</p>
      ${d.business.discountCodes && d.business.discountCodes.enabled ? `<p class="small" style="margin-bottom:0"><strong>Audience-code discounts: on.</strong> ${esc(d.business.name)} turned code discounts on and chose ${d.business.discountCodes.pct}% off: that was their call and their percentage, which is why the tallies above carry a discount cost. Codes are always optional; a business that leaves them off still gets the code and the count, with no discount promised.</p>` : ""}
    </div>` : ""}
    <div class="showcase-block"><h4>Your plan's content rights</h4>
      <p class="small" style="margin:0 0 4px"><span class="rules">With the ${esc(plan.name)} plan you can:</span> share a delivered post with the creator tagged; repost it on your own feed; run it as an ad while your SIGNL account is active (the ad right ends if the account ends).</p>
      <p class="small muted" style="margin:0">You can never edit a creator's post. Rights follow your plan and are shown to the creator before they accept, so there are no surprises on either side.</p>
    </div>
  </section>
  ${pvStaffPanelHtml(d)}
  ${d.managedView ? pvManagedHtml(d.managedView) : ""}
  <section class="panel">
    <h3 style="margin-top:0">Bookings (${d.bookings.length})</h3>
    ${d.bookings.map((b) => pvBookingCard(b)).join("")}
    <p class="small muted">End of the simulated roster. In the live app this list is the business's Visits &amp; Posts tab, fed by real bookings, real codes and real proof links.</p>
  </section>`;
}

// ---------------- init ----------------

(async function init() {
  try {
    state.boot = await api("GET", "/bootstrap");
    try {
      const me = await api("GET", "/auth/me");
      state.user = me.user;
    } catch (e) { state.user = null; }
    const params = new URLSearchParams(location.search);
    const refParam = params.get("ref");
    if (refParam) {
      try { localStorage.setItem("signl_ref", refParam.trim().replace(/^@/, "").slice(0, 40)); } catch (e) { /* storage unavailable */ }
    }
    const claim = parseClaimParams(params);
    if (claim.handle || claim.market || claim.tier) {
      state.prefill = claim;
      // A claim link is an invitation to the form itself: a logged-out
      // visitor lands on the sign-up, pre-filled. Signed-in visitors
      // keep their normal landing, and nothing ever auto-submits.
      if (!state.user) state.view = "join-creator";
    }
    // A public profile URL (/c/<handle>) wins over every other view:
    // the page must render the same for logged-out and signed-in
    // visitors alike.
    const cMatch = location.pathname.match(/^\/c\/([^/]+)\/?$/);
    if (cMatch) {
      let h = cMatch[1];
      try { h = decodeURIComponent(h); } catch (e) { /* keep raw */ }
      // Light tidy only; the server sanitizes authoritatively.
      state.publicHandle = h.trim().replace(/^@/, "").slice(0, 40) || h;
      state.view = "public-profile";
    }
    const code = params.get("code");
    if (code && state.user && state.user.role === "business") {
      state.tab = "Counter";
      state.counterCode = code.toUpperCase();
      state.view = "dashboard";
    }
    render();
    if (code && state.user && state.user.role === "business" && state.tab === "Counter") {
      setTimeout(() => renderCounter(code.toUpperCase()), 60);
    }
  } catch (e) {
    app.innerHTML = `<div class="error-box" style="max-width:560px;margin:40px auto">SIGNL could not load. ${esc(e.message)}</div>`;
  }
})();
