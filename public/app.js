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
  app.innerHTML = `
  <section class="panel" style="max-width:640px;margin:20px auto">
    <div class="flex-between">
      <div style="display:flex;gap:16px;align-items:flex-start">
        ${p.photoUrl ? `<img class="profile-photo" src="${esc(p.photoUrl)}" alt="">` : `<span class="profile-photo avatar-initial">${esc((p.name || "?").trim().charAt(0).toUpperCase() || "?")}</span>`}
        <div>
          <h2 style="margin:0">${esc(p.name)}</h2>
          <p class="muted" style="margin:4px 0">@<a href="${esc(p.instagramUrl)}" target="_blank" rel="noopener">${esc(p.handle)}</a> &middot; ${place}${!p.unlisted && p.city ? ` &middot; ${esc(p.city)}` : ""}${p.neighborhood ? ` &middot; ${esc(p.neighborhood)}` : ""}</p>
        </div>
      </div>
      <span class="badge ok" style="font-size:0.95rem;padding:6px 14px">Founding Creator</span>
    </div>
    <p class="mt">${p.localAudiencePct === null || p.localAudiencePct === undefined ? "Local audience not reported yet" : `<strong>${p.localAudiencePct}%</strong> of their followers are local <span class="badge info">${esc(p.localAudienceSource || "Self-reported")}</span>`}</p>
    <p>${scoreBadge(p.localImpactScore)}${p.momentumPoints ? ` <span class="badge info">Momentum ${p.momentumPoints} pts</span>` : ""} <span class="badge tier">${esc(p.tierBand || "")}</span></p>
    <p class="small">${audienceLineHtml(p)}</p>
    ${p.foundingBand ? `<p><span class="badge tier" style="padding:6px 14px">In the first ${p.foundingBand} founding creators in ${place}</span></p>` : ""}
    ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
    ${p.compCategories && p.compCategories.length ? `<p class="small muted">Open to comps: ${p.compCategories.map(esc).join(", ")}</p>` : ""}
    ${bestWorkHtml(p.bestWork)}
    ${trackRecordHtml(p)}
    ${reviewsHtml(p)}
    ${visitIncludesHtml(p.visitIncludes)}
    <p class="small muted">SIGNL connects local businesses with local creators. Businesses comp a meal or a service, creators post honestly within 48 hours and disclose the comp, and every post is tracked. No business can ever require a positive post.</p>
    <div class="cta-row" style="justify-content:flex-start">
      ${state.user ? `<a class="btn ghost" href="#" onclick="return go('dashboard')">Back to my dashboard</a>` : `<a class="btn" href="#" onclick="return go('join-creator')">Become a Founding Creator</a> <a class="btn ghost" href="#" onclick="return go('for-businesses')">For Businesses</a>`}
    </div>
  </section>`;
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
    <p class="small">Points decide the order businesses see you in. You earn them for completing your profile, delivering posts on time, great reviews, posts that run as ads, and recruiting creators. Late posts, no-shows, and a redeemed visit with no post cost you points.${m.floorApplied ? " Your total never drops below zero." : ""}</p>
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

// App-style bottom navigation for small screens (Jeff, 2026-10-18):
// the top link row wrapped and broke on phones, so on mobile the nav
// lives in a fixed bottom tab bar, with the sections of the signed-in
// experience one tap away. Desktop keeps the top nav.
function renderBottomNav() {
  if (!bottomnav) return;
  const item = (glyph, label, onclick, active) => `
    <button class="bn-item ${active ? "on" : ""}" onclick="${onclick}">
      <span class="bn-glyph">${glyph}</span><span class="bn-label">${label}</span>
    </button>`;
  const v = state.view;
  const t = state.tab;
  if (!state.user) {
    bottomnav.innerHTML =
      item("&#8962;", "Home", "return go('home')", v === "home") +
      item("&#10010;", "Join", "return go('join-creator')", v === "join-creator") +
      item("&#10132;", "Sign in", "return go('signin')", v === "signin") +
      item("&#9636;", "Businesses", "return go('for-businesses')", v === "for-businesses" || v === "join-business");
    return;
  }
  const u = state.user;
  if (u.status !== "approved" || u.role === "admin") {
    let items = "";
    if (u.role === "admin") {
      items =
        item("&#9636;", "Requests", "return go('dashboard','Applications')", t === "Applications" || !t) +
        item("&#9673;", "Markets", "return go('dashboard','Markets')", t === "Markets") +
        item("&#9776;", "Events", "return go('dashboard','Event Log')", t === "Event Log") +
        item("&#8721;", "Stats", "return go('dashboard','Stats')", t === "Stats");
    } else {
      items = item("&#9733;", "Status", "return go('dashboard')", true);
    }
    bottomnav.innerHTML = items + item("&#8617;", "Sign out", "signOut()", false);
    return;
  }
  if (u.role === "creator") {
    const live = !!(u.founding && u.founding.marketLive);
    if (!live) {
      bottomnav.innerHTML =
        item("&#9733;", "Status", "return go('dashboard')", true) +
        item("&#8617;", "Sign out", "signOut()", false);
      return;
    }
    bottomnav.innerHTML =
      item("&#9679;", "Profile", "return go('dashboard','Profile')", t === "Profile" || !t) +
      item("&#9670;", "Offers", "return go('dashboard','Offers')", t === "Offers") +
      item("&#10003;", "My Visits", "return go('dashboard','My Visits')", t === "My Visits") +
      item("&#9993;", "Messages", "return go('dashboard','Messages')", t === "Messages") +
      item("&#8617;", "Sign out", "signOut()", false);
    return;
  }
  // business (reachable in test mode; business accounts open at launch)
  bottomnav.innerHTML =
    item("&#9673;", "Discover", "return go('dashboard','Discover')", t === "Discover" || !t) +
    item("&#9670;", "Offers", "return go('dashboard','My Offers')", t === "My Offers") +
    item("&#10003;", "Visits", "return go('dashboard','Visits & Posts')", t === "Visits & Posts") +
    item("&#9993;", "Messages", "return go('dashboard','Messages')", t === "Messages") +
    item("&#8617;", "Sign out", "signOut()", false);
}

function go(view, tab) {
  // Any navigation leaves Business Preview: the mode is a single
  // deliberate walk, and the admin lands back on the normal console.
  if (state.preview) { stopPreviewCountdown(); state.preview = null; }
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
  if (n >= 15000) return "Creators";
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

// Paid cash campaigns are a Creators-tier option: the checkbox block
// only appears while the automatic band is Creators.
function syncPaidOption() {
  const wrap = document.getElementById("jc-paid-wrap");
  if (wrap) wrap.style.display = suggestedTierId(signupStackTotal()) === "Creators" ? "" : "none";
}

function profileStackTotal() {
  const ids = ["p-followers", "p-stack-tiktok", "p-stack-facebook", "p-stack-x", "p-stack-linkedin", "p-stack-youtube"];
  return ids.reduce((s, id) => s + (parseInt((document.getElementById(id) || {}).value, 10) || 0), 0);
}

function syncPaidOptionProfile() {
  const wrap = document.getElementById("p-paid-wrap");
  if (wrap) wrap.style.display = suggestedTierId(profileStackTotal()) === "Creators" ? "" : "none";
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
        <div class="field"><label>Your tier band</label><p id="jc-tier-line" style="margin:6px 0">Your band is set automatically from your total audience across platforms.</p><p class="small muted">Neighbors 500 to 2k &middot; Locals 2k to 15k &middot; Creators 15k and up. Nobody picks their own band; it updates itself as your counts change.</p></div>
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
        <label style="font-weight:500"><input type="checkbox" id="jc-paid" style="width:auto"> <strong>Paid cash campaigns</strong> (Creators tier): on top of comps, businesses can hire me for paid campaigns when a business runs one.</label>
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
  if (autoBand === "Creators" && paidBox && paidBox.checked && !comps.includes(PAID_COMP)) comps.push(PAID_COMP);
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
    <p>Thanks, ${esc(u.name)}. ${isCreator ? `Your founding creator profile for <strong>${place}</strong> is built and in the review queue.` : "Every SIGNL application is reviewed by a person before accounts activate. Yours is in the queue."}</p>
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
  return `
  <div class="panel">
    <p><button class="btn small-btn ghost" onclick="${preview ? "previewBackToResults()" : "backToDiscover()"}">&larr; Back to results</button></p>
    <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      ${avatarHtml(c, "profile-photo")}
      <div style="flex:1;min-width:240px">
        <h3 style="margin:0">${esc(c.name)}</h3>
        <p class="muted" style="margin:4px 0">@<a href="${esc(p.instagramUrl || "")}" target="_blank" rel="noopener">${esc(p.handle || "")}</a> &middot; ${esc(c.market)}${c.city ? ` &middot; ${esc(c.city)}` : ""}${c.neighborhood ? ` &middot; ${esc(c.neighborhood)}` : ""}</p>
        <p>${scoreBadge(c.localImpactScore)}${p.openToPaidCampaigns ? ` <span class="badge tier">Open to paid campaigns</span>` : ""}${c.momentum && c.momentum.points ? ` <span class="badge info">Momentum ${c.momentum.points} pts</span>` : ""} <span class="badge tier">${esc(p.tierBand || "")}</span>${c.foundingBand ? ` <span class="badge tier">Founding creator, first ${c.foundingBand} in market</span>` : ""}</p>
        <p>${localTxt}</p>
      </div>
    </div>
    <div class="stat-row mt">
      <div class="stat"><div class="num">${fmtNum(totalAudienceOf(c))}</div><div class="lbl">Total audience (all platforms)</div></div>
      <div class="stat"><div class="num">${fmtNum(p.avgViews)}</div><div class="lbl">Typical views</div></div>
      <div class="stat"><div class="num">${p.localAudiencePct === null || p.localAudiencePct === undefined ? "—" : p.localAudiencePct + "%"}</div><div class="lbl">Followers local (${esc(p.localAudienceSource || "Self-reported")})</div></div>
    </div>
    ${stackList(c).length ? `<p class="small muted">Where the audience lives: ${stackList(c).map((x) => `${esc(x.label)} ${fmtNum(x.count)}`).join(" &middot; ")}</p>` : ""}
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
        ? `<button class="btn" onclick="previewStartOffer('${c.userId}')">Send this creator an offer (preview)</button>`
        : `<button class="btn" onclick="startOffer('${c.userId}')">Send offer</button> <button class="btn ghost" onclick="openThread('${c.userId}')">Message</button>`}
    </div>
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
  return `
  <div class="card${c.standing === "paused" ? " paused" : ""}">
    <div class="flex-between">
      <div>${avatarHtml(c, "avatar")}<strong>${esc(c.name)}</strong> <span class="muted">@${esc(p.handle || "")}</span></div>
      ${opts.preview ? "" : `<button class="heart ${c.isFavorite ? "on" : ""}" title="Save to favorites" onclick="toggleFav('${c.userId}')">${c.isFavorite ? "&#10084;" : "&#9825;"}</button>`}
    </div>
    <p class="small muted">${esc(c.market)} &middot; ${esc(c.city || "")}${c.neighborhood ? ` &middot; ${esc(c.neighborhood)}` : ""} &middot; ${esc(p.tierBand || "")} &middot; ${fmtNum(totalAudienceOf(c))} total audience &middot; ${fmtNum(p.avgViews)} avg views${c.foundingBand ? ` &middot; Founding creator, first ${c.foundingBand} in market` : ""}</p>
    <p class="small">${stackChipsHtml(c)}</p>
    ${c.standing === "paused" ? `<p><span class="badge warn">Paused: a late post is outstanding</span> <span class="small muted">This creator is greyed out and cannot take new offers until the post is delivered.</span></p>` : ""}
    ${c.bookedUp ? `<p><span class="badge info">Booked up this week</span> <span class="small muted">At their weekly visit max. You can still send offers; they can accept next week.</span></p>` : ""}
    <p>${localTxt}</p>
    <p>${scoreBadge(c.localImpactScore)}${p.openToPaidCampaigns ? ` <span class="badge tier">Open to paid campaigns</span>` : ""}${c.momentum && c.momentum.points ? ` <span class="badge info">Momentum ${c.momentum.points} pts</span>` : ""}</p>
    ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
    ${p.compCategories && p.compCategories.filter((x) => x !== PAID_COMP).length ? `<p class="small muted">Open to comps: ${p.compCategories.filter((x) => x !== PAID_COMP).map(esc).join(", ")}</p>` : ""}
    ${p.bio ? `<p class="small muted">${esc(p.bio)}</p>` : ""}
    <p class="small">${socialLinksHtml(p)}</p>
    ${bestWorkHtml(c.bestWork, true)}
    ${trackLine || reviewLine ? `<p class="small">${trackLine}${reviewLine}</p>` : ""}
    <p class="small muted">Every SIGNL visit: 1 post or reel + 2 stories within 48 hours, tracked as proof. Content rights follow your plan.</p>
    <div class="cta-row" style="justify-content:flex-start">
      ${opts.preview
        ? `<button class="btn small-btn" onclick="previewViewCreator('${c.userId}')">View profile</button>
           <button class="btn small-btn ghost" onclick="previewStartOffer('${c.userId}')">Send preview offer</button>`
        : `<button class="btn small-btn" onclick="startOffer('${c.userId}')">Send offer</button>
           <button class="btn small-btn ghost" onclick="openCreatorProfile('${c.userId}')">View profile</button>
           <button class="btn small-btn ghost" onclick="openThread('${c.userId}')">Message</button>`}
    </div>
  </div>`;
}

// ---------- creator ----------

function renderCreatorDash() {
  const u = state.user;
  const marketLive = !!(u.founding && u.founding.marketLive);
  if (!marketLive) return renderFoundingHome();
  const tab = state.tab || "Profile";
  state.tab = tab;
  let body = "";
  if (tab === "Profile") body = creatorProfileHtml(u) + momentumHtml(u) + growRosterHtml(u);
  app.innerHTML = `
    <h2>Creator dashboard <span class="badge ok">Founding Creator, ${esc(u.market)}</span></h2>
    ${standingBannerHtml(u)}
    ${tabsHtml(["Profile", "Offers", "My Visits", "Messages"], tab)}
    <div id="tab-body">${body}</div>`;
  if (tab === "Profile") setTimeout(loadMyScore, 10);
  if (tab === "Offers") loadCreatorOffers();
  if (tab === "My Visits") loadMyVisits("creator");
  if (tab === "Messages") loadThreads();
}

// The approved creator's home before their market activates: founding
// status, launch window, priority position, and their full profile.
// Data comes from GET /me/founding (which also powers the score).
function renderFoundingHome() {
  app.innerHTML = `
    <h2>Your founding status</h2>
    ${standingBannerHtml(state.user)}
    <div id="founding-body"><p class="muted">Loading your founding profile...</p></div>
    <div id="founding-profile"></div>`;
  loadFounding();
}

async function loadFounding() {
  const el = document.getElementById("founding-body");
  const profEl = document.getElementById("founding-profile");
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
    el.innerHTML += momentumHtml(state.user) + growRosterHtml(state.user);
    profEl.innerHTML = `<h3 class="mt">Your profile</h3>` + creatorProfileHtml(state.user);
    fillMyShowcase(card);
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
      <div class="field" id="p-paid-wrap" style="display:${c.tierBand === "Creators" ? "" : "none"}">
        <label style="font-weight:500"><input type="checkbox" id="p-paid" style="width:auto" ${c.openToPaidCampaigns ? "checked" : ""}> <strong>Paid cash campaigns</strong> (Creators tier): businesses can hire me for paid campaigns when a business runs one, on top of comps.</label>
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
  if (suggestedTierId(profileStackTotal()) === "Creators" && paidBox && paidBox.checked && !comps.includes(PAID_COMP)) comps.push(PAID_COMP);
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
  <div class="card mb">
    <div class="flex-between"><strong>${esc(b.title)}</strong>${complianceBadge(b)}</div>
    <p class="small muted">${role === "creator" ? esc(b.businessName) : "@" + esc(b.creatorHandle) + " (" + esc(b.creatorName) + ")"} &middot; ${esc(b.market)} &middot; Comp: ${esc(b.whatComped)} (cap $${b.dollarCap}) &middot; Visit: ${esc(b.visitDate || b.visitWindow || "Flexible")}</p>`;
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
      const nums = `${typeof post.views === "number" ? fmtNum(post.views) + " views" : ""}${typeof post.views === "number" && typeof post.likes === "number" ? " &middot; " : ""}${typeof post.likes === "number" ? fmtNum(post.likes) + " likes" : ""}`;
      html += role === "business"
        ? `<p class="small">Your comp produced <strong>${nums}</strong> (creator-reported).</p>`
        : `<p class="small">You reported ${nums} (+5 Momentum). Thanks: numbers like these are what bring businesses back.</p>`;
    } else if (role === "creator" && post.performanceRequestedAt) {
      html += `
    <form onsubmit="return submitPostPerformance(event, '${b.id}')">
      <h4 style="margin:10px 0 4px">Add post numbers</h4>
      <p class="small muted">A week in, how did the post do? Two optional numbers; reporting earns +5 Momentum points.</p>
      <div class="form-2col">
        <div class="field"><label>Views</label><input type="number" id="perf-views-${b.id}" min="0" placeholder="Optional"></div>
        <div class="field"><label>Likes</label><input type="number" id="perf-likes-${b.id}" min="0" placeholder="Optional"></div>
      </div>
      <button class="btn small-btn" type="submit">Report numbers (+5 Momentum)</button>
    </form>`;
    }
  }
  if (role === "business" && b.postState === "overdue" && !b.replacementRequestedAt) {
    html += `<button class="btn small-btn danger" onclick="requestReplacement('${b.id}')">Request replacement visit</button>`;
  }
  if (b.replacementRequestedAt) html += `<p class="small">Replacement requested ${fmtDate(b.replacementRequestedAt)}. SIGNL will line up a substitute creator.</p>`;
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
    await api("POST", `/bookings/${bookingId}/performance`, {
      views: views === "" ? null : parseInt(views, 10),
      likes: likes === "" ? null : parseInt(likes, 10),
    });
    loadMyVisits("creator");
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
      <div><label>&nbsp;</label><label style="font-weight:500"><input type="checkbox" id="f-paid" style="width:auto"> Open to paid campaigns only</label></div>
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
    el.innerHTML = `<div class="grid cols-2">${data.creators.map((c) => creatorCard(c, state.user)).join("")}</div>`;
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
  if (tierBand === "Creators") return [all[2], { label: "Meal for two + signature", comp: "Meal for two plus a signature item, on us", cap: 125 }];
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
  </div>`;
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
      <div><strong>Business Preview</strong><p class="muted small" style="margin:4px 0 0">Walk the app exactly as a business does: the founding plans, roster search with every filter, full creator profiles, and the offer composer. Offers sent in preview are simulations that never reach a creator and are never saved.</p></div>
      <button class="btn" onclick="enterPreview()">Preview as business &rarr;</button>
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

// Creator outreach campaign (Jeff, 2026-10-19): the founding
// creator email sends from inside the app (its own SMTP transport),
// so there is no per-send approval card. This tab is the control
// surface: queue counts, the last error if a run stopped, recent
// sends, and the Arm / Pause switch. Recipients are imported by
// pasting a JSON array into the box on this tab, which posts to
// the admin import endpoint; sending runs on the 30-minute
// scheduled sweep, inside the 08:00-21:00 ET window, in batches
// of 8, capped at 80 sends for the campaign.
async function loadCampaign() {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/admin/campaign");
    const c = data.campaign || {};
    const counts = data.counts || {};
    const sends = (data.recentSends || []).map((s) => `
      <div class="card mb">
        <div class="flex-between"><strong>${esc(s.name || s.handle || s.email)}</strong><span class="badge ok">Sent</span></div>
        <p class="small muted">@${esc(s.handle || "")} &middot; ${esc(s.market || "")} &middot; ${esc(s.email)}${s.sentAt ? ` &middot; ${esc(fmtDate(s.sentAt))}` : ""}</p>
      </div>`).join("");
    el.innerHTML = `
      <div class="flex-between"><h3 style="margin:0">Creator outreach campaign</h3><span class="badge ${c.armed ? "ok" : "info"}">${c.armed ? "Armed" : "Paused"}</span></div>
      <p class="small muted" style="margin-top:8px">Campaign <strong>${esc(c.id || "")}</strong>. The sweep sends up to ${c.batchSize || 8} emails every 30 minutes while armed, only between ${c.window ? c.window.startHour : 8}:00 and ${c.window ? c.window.endHour : 21}:00 ET. Hard cap: ${c.sendCap || 80} sends. The queue auto-pauses when it empties.${c.lastRunAt ? ` Last sweep: ${esc(fmtDate(c.lastRunAt))}.` : ""} Send window is ${c.windowOpenNow ? "open now" : "closed right now"}.</p>
      ${c.lastError ? `<div class="error-box">${esc(c.lastError)}</div>` : ""}
      <p class="small">Queued: <strong>${counts.queued || 0}</strong> &middot; Sent: <strong>${counts.sent || 0}</strong> &middot; Bounced: <strong>${counts.bounced || 0}</strong> &middot; Skipped: <strong>${counts.skipped || 0}</strong> &middot; Total: <strong>${counts.total || 0}</strong></p>
      <button class="btn ${c.armed ? "danger" : ""}" onclick="toggleCampaignArm(${c.armed ? "false" : "true"})">${c.armed ? "Pause campaign" : "Arm campaign"}</button>
      <div id="campaign-note" class="small saved"></div>
      <h3 class="mt">Import recipients</h3>
      <p class="small muted">Paste a JSON array of recipient objects: email, handle, market and opener are required; name is optional. Imported addresses join the queue; nothing sends until the campaign is armed.</p>
      <div class="field"><label>Paste recipients (JSON array)</label><textarea id="campaign-import-text" rows="8" placeholder='[{"email":"creator@example.com","name":"Casey","handle":"casey","market":"Richmond","opener":"your Carytown posts"}]'></textarea></div>
      <button class="btn" onclick="importCampaignRecipients()">Import recipients</button>
      <div id="campaign-import-note" class="small saved"></div>
      ${sends ? `<h3 class="mt">Recent sends</h3>${sends}` : `<p class="muted mt">No sends yet.</p>`}`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function toggleCampaignArm(arm) {
  const note = document.getElementById("campaign-note");
  try {
    await api("POST", arm ? "/admin/campaign/arm" : "/admin/campaign/disarm", {});
    loadCampaign();
  } catch (err) {
    if (note) note.textContent = err.message;
  }
}

// Paste-import for the campaign queue: the operator pastes a JSON
// array of recipients, we parse it here (a parse failure shows an
// inline error and calls nothing), then POST the same payload the
// admin import endpoint has always taken and show its counts.
async function importCampaignRecipients() {
  const box = document.getElementById("campaign-import-text");
  const note = document.getElementById("campaign-import-note");
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
    const data = await api("POST", "/admin/campaign/import", { campaignId: "founding-creators-2026-10", recipients });
    const summary = `Imported ${data.imported || 0} · Duplicates ${data.duplicates || 0} · Skipped ${data.skipped || 0} · Invalid ${(data.invalid || []).length}`;
    await loadCampaign();
    const fresh = document.getElementById("campaign-import-note");
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
          : `<span class="badge ${u.status === "approved" ? "ok" : "bad"}">${esc(u.status)}</span>${u.role === "creator" && u.tester ? ` <span class="badge warn">Tester</span>` : ""}${u.role === "creator" && u.status === "approved" ? `<br><button class="btn small-btn ghost" style="margin-top:6px" onclick="setTester('${u.id}', ${u.tester ? "false" : "true"})">${u.tester ? "Move to roster" : "Move to Tester"}</button>` : ""}`}</td>
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
    <p class="mt"><button class="btn" onclick="previewToDiscover()">Continue as this business: search the roster &rarr;</button></p>
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
      <div><label>&nbsp;</label><label style="font-weight:500"><input type="checkbox" id="pvf-paid" style="width:auto"> Open to paid campaigns only</label></div>
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
  el.innerHTML = `<div class="grid cols-2">${list.map((c) => creatorCard(c, state.user, { preview: true })).join("")}</div>`;
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
